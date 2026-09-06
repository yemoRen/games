/*
 * recovery.ts — 末世 HP 恢复系统。
 *
 * 设计目标：让受伤的幸存者「不能立刻再出击」。
 *
 * 恢复公式（每分钟）：
 *   rate = (5 + 体质 * 0.3) * (1 + 医疗站等级 * 0.5)
 *   rate *= (1 + 战团/避难所恢复加成)
 *   rate *= max(0.1, 1 - 累加伤势惩罚)
 *   若医疗消耗品激活中：rate *= 2
 *
 * 时间戳驱动恢复：UI 加载/切换 tab 时按 now - lastRecoveredAt 计算
 * 一次性结算，避免每帧 setState。
 */

import type { SurvivalGameState } from './state';
import type { SurvivorProfile } from './chargen';
import { aggregateTraitCombat } from './chargen';
import type { Attributes } from '@shared/types/cultivator';
import { computeShelterBonuses } from './economy';

export type Injury = 'fracture' | 'infection' | 'bleeding' | 'shellShock';

export const INJURY_LABEL: Record<Injury, string> = {
  fracture: '骨折',
  infection: '感染',
  bleeding: '失血',
  shellShock: '震伤',
};

export const INJURY_DESC: Record<Injury, string> = {
  fracture: '行动迟缓，恢复速度 -25%',
  infection: '病毒侵蚀，恢复速度 -50%',
  bleeding: '持续失血，恢复速度 -35%',
  shellShock: '精神受创，恢复速度 -15%',
};

export const INJURY_PENALTY: Record<Injury, number> = {
  fracture: 0.25,
  infection: 0.5,
  bleeding: 0.35,
  shellShock: 0.15,
};

export interface SurvivorStatus {
  currentHp: number;
  maxHp: number;
  injuries: Injury[];
  lastRecoveredAt: string; // ISO
  medActiveUntil?: string; // ISO — 医疗品 2x 恢复窗口
  /** 濒死截止时间（ISO）。存在表示正处于「撤离失败」后的濒死状态，需救治，超时则真正离世 */
  dyingUntil?: string;
  /** 出击前是否满血（决定是否允许立刻再出击） */
  sortieReady: boolean;
}

/** 撤离失败后的濒死宽限期（分钟）：超时未救治则成员真正离世 */
export const NEAR_DEATH_GRACE_MIN = 10;

const BASE_REGEN_RATIO = 0.008; // 0.8% maxHp/min
const VITALITY_PER_POINT = 0.4; // 每点体质 +0.4 HP/min
const MED_MULTIPLIER = 2;
const MED_DURATION_MIN = 5;

/** 由六维属性推导 battle-v5 气血上限（与 createCombatUnitFromCultivator 同公式） */
function deriveMaxHp(attrs: Attributes, hpBonus = 0): number {
  return Math.round(400 + attrs.vitality * 20 + attrs.endurance * 3 + hpBonus);
}

/** 给幸存者建立初始 status（满血、刚建档） */
export function freshStatus(survivor: SurvivorProfile, now: number, baseMaxHp = 600): SurvivorStatus {
  // baseMaxHp 仅作兜底；实际以 battle-v5 公式 + 词条气血为准，保证恢复/战斗同口径
  const traitC = aggregateTraitCombat(survivor.traits);
  const maxHp = Math.max(baseMaxHp, deriveMaxHp(survivor.attributes, traitC.hpBonus));
  return {
    currentHp: maxHp,
    maxHp,
    injuries: [],
    lastRecoveredAt: new Date(now).toISOString(),
    sortieReady: true,
  };
}

/** 计算单人恢复速率（HP/分钟）。UI 显示用。 */
export function regenPerMinute(survivor: SurvivorProfile, status: SurvivorStatus, state: SurvivalGameState, now: number): number {
  const medLevel = state.facilities['medbay'] ?? 0;
  const bonuses = computeShelterBonuses(state.facilities, state.factionRep);

  let rate = status.maxHp * BASE_REGEN_RATIO + survivor.attributes.vitality * VITALITY_PER_POINT;
  rate *= 1 + 0.5 * medLevel;
  rate *= 1 + bonuses.recoveryBonus;
  const injuryPenalty = status.injuries.reduce((acc, inj) => acc + INJURY_PENALTY[inj], 0);
  rate *= Math.max(0.1, 1 - injuryPenalty);
  if (status.medActiveUntil && new Date(status.medActiveUntil).getTime() > now) {
    rate *= MED_MULTIPLIER;
  }
  return rate;
}

/** 应用单人时间戳恢复（不可变）。返回新 status。 */
export function recoverOne(
  survivor: SurvivorProfile,
  status: SurvivorStatus,
  state: SurvivalGameState,
  now: number,
): SurvivorStatus {
  // 处于濒死状态：不自动恢复，等待救治（真正死亡由 recoverAll 在宽限到期时处理）
  if (status.dyingUntil && new Date(status.dyingUntil).getTime() > now) {
    return status;
  }
  if (status.currentHp >= status.maxHp) {
    // 已满血：仅更新时间戳
    return { ...status, lastRecoveredAt: new Date(now).toISOString(), sortieReady: true };
  }
  const last = new Date(status.lastRecoveredAt).getTime();
  const minutes = Math.max(0, (now - last) / 60000);
  if (minutes < 0.05) return status; // <3 秒跳过

  const rate = regenPerMinute(survivor, status, state, now);
  const heal = Math.floor(rate * minutes);
  if (heal <= 0) return status;

  const nextHp = Math.min(status.maxHp, status.currentHp + heal);
  return {
    ...status,
    currentHp: nextHp,
    lastRecoveredAt: new Date(now).toISOString(),
    sortieReady: nextHp >= status.maxHp * 0.95,
  };
}

/** 一次性结算全部幸存者的恢复；返回新 state 或原 state（无变化）。 */
export function recoverAll(state: SurvivalGameState, now: number = Date.now()): SurvivalGameState {
  const next: Record<string, SurvivorStatus> = { ...state.survivorStatus };
  let changed = false;
  const deadIds: string[] = [];

  for (const s of state.survivors) {
    const cur = state.survivorStatus[s.id];
    if (!cur) {
      next[s.id] = freshStatus(s, now);
      changed = true;
      continue;
    }
    // 濒死宽限到期 → 真正离世，移出战团
    if (cur.dyingUntil && new Date(cur.dyingUntil).getTime() <= now) {
      deadIds.push(s.id);
      delete next[s.id];
      changed = true;
      continue;
    }
    const upd = recoverOne(s, cur, state, now);
    if (upd !== cur) {
      next[s.id] = upd;
      changed = true;
    }
  }

  if (!changed) return state;

  // 处理真正离世的成员：移出战团、卸装备、必要时改派出击者
  let survivors = state.survivors;
  let equipped = state.equipped;
  let activeSurvivorId = state.activeSurvivorId;
  const logs: string[] = [];
  if (deadIds.length > 0) {
    const deadNames = new Map(state.survivors.filter((s) => deadIds.includes(s.id)).map((s) => [s.id, s.name]));
    survivors = state.survivors.filter((s) => !deadIds.includes(s.id));
    equipped = { ...state.equipped };
    for (const id of deadIds) delete equipped[id];
    if (activeSurvivorId && deadIds.includes(activeSurvivorId)) {
      activeSurvivorId = survivors[0]?.id ?? null;
    }
    for (const id of deadIds) {
      logs.push(`【阵亡】${deadNames.get(id) ?? '幸存者'} 因伤重未及救治，离开了战团。`);
    }
  }

  return {
    ...state,
    survivors,
    equipped,
    activeSurvivorId,
    survivorStatus: next,
    log: logs.length > 0 ? [...logs, ...state.log].slice(0, 50) : state.log,
  };
}

/** 出击结束回写 HP（不可变）；按伤害比例追加伤势。 */
export function applyPostSortie(
  status: SurvivorStatus,
  finalHp: number,
  damageRatio: number, // 0~1
  now: number = Date.now(),
): SurvivorStatus {
  const injuries = [...status.injuries];
  // 损失越多越容易挂彩
  if (damageRatio > 0.3 && !injuries.includes('fracture')) injuries.push('fracture');
  if (damageRatio > 0.5 && !injuries.includes('bleeding')) injuries.push('bleeding');
  if (damageRatio > 0.75 && !injuries.includes('shellShock')) injuries.push('shellShock');
  return {
    ...status,
    currentHp: Math.max(0, Math.round(finalHp)),
    injuries,
    // 成功回战团即脱离濒死（若之前处于撤离失败后的濒死状态）
    dyingUntil: undefined,
    lastRecoveredAt: new Date(now).toISOString(),
    sortieReady: finalHp >= status.maxHp * 0.95 && injuries.length === 0,
  };
}

/** 阵亡回写（满伤势 + 重伤） */
export function applyPostDeath(status: SurvivorStatus, now: number = Date.now()): SurvivorStatus {
  return {
    ...status,
    currentHp: Math.max(1, Math.round(status.maxHp * 0.2)),
    injuries: ['fracture', 'bleeding', 'shellShock'],
    lastRecoveredAt: new Date(now).toISOString(),
    sortieReady: false,
  };
}

/**
 * 撤离失败回写：幸存者回战团进入「濒死」状态（仅余微弱生命、满身伤势、限时救治）。
 * 若宽限期内未用药/付费救治，由 recoverAll 判定其真正离世并移出战团。
 */
export function applyNearDeath(status: SurvivorStatus, now: number = Date.now()): SurvivorStatus {
  const until = new Date(now + NEAR_DEATH_GRACE_MIN * 60_000).toISOString();
  return {
    ...status,
    currentHp: Math.max(1, Math.round(status.maxHp * 0.05)),
    injuries: ['fracture', 'bleeding', 'shellShock'],
    dyingUntil: until,
    lastRecoveredAt: new Date(now).toISOString(),
    sortieReady: false,
  };
}

/** 使用医疗品：立即回血 + 开启恢复加速窗口 */
export function applyMedicine(
  status: SurvivorStatus,
  healAmount: number,
  now: number = Date.now(),
): SurvivorStatus {
  const until = new Date(now + MED_DURATION_MIN * 60_000).toISOString();
  const nextHp = Math.min(status.maxHp, status.currentHp + healAmount);
  return {
    ...status,
    currentHp: nextHp,
    medActiveUntil: until,
    lastRecoveredAt: new Date(now).toISOString(),
    sortieReady: nextHp >= status.maxHp * 0.95 && status.injuries.length === 0,
  };
}

/** 治疗一处伤势（医疗站 Lv3 启用 / 药品消耗） */
export function treatInjury(status: SurvivorStatus, injury: Injury): SurvivorStatus {
  return {
    ...status,
    injuries: status.injuries.filter((i) => i !== injury),
    sortieReady: status.currentHp >= status.maxHp * 0.95 && status.injuries.length - 1 === 0,
  };
}

/** 估计「满血还需多久」(秒)。负数 = 已满血。 */
export function timeToFullSeconds(
  survivor: SurvivorProfile,
  status: SurvivorStatus,
  state: SurvivalGameState,
  now: number,
): number {
  if (status.currentHp >= status.maxHp) return 0;
  const rate = regenPerMinute(survivor, status, state, now);
  if (rate <= 0.01) return Number.POSITIVE_INFINITY;
  const minutes = (status.maxHp - status.currentHp) / rate;
  return Math.ceil(minutes * 60);
}

export { MED_DURATION_MIN, MED_MULTIPLIER };