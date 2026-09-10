/*
 * survival/wander.ts — 漫游搜打撤（模拟一次完整副本）
 *
 * 设计目标：漫游不是「无损白嫖」的一次结算，而是让出击者**真的下一次副本**——
 * 走与手动出击完全相同的建局流程（起始血量/护甲/弹药/已带伤势），
 * 并执行「搜刮 → 遇敌 → 战斗 → 再搜刮 → 撤离」的模拟循环，
 * 最后按手动出击同样的口径结算：
 *   · 入库战利品（撤离失败则只保留安全箱）
 *   · 搜刮废土币入账（失败则遗失）
 *   · 战斗经验（applySortieResult 内：仅撤离成功才入账）
 *   · 掉血回写、战后伤势带回、阵亡/超时进入濒死
 *   · 失败时按概率被夺走已穿戴装备（applyFailureGearLoss）
 * 出击同样消耗行动点；行动点不足或角色濒死时直接拒绝（不产生任何收益）。
 */
import type { Attributes } from '@shared/types/cultivator';
import {
  createRun,
  search,
  extract,
  rollRescue,
  sumValue,
  resolveBagFull,
  resolveEncounter,
  lootCorpse,
  moveToNode,
  zoneNeighbors,
  zoneSearchLeft,
  goToExtract,
  type ExtractionRunState,
  type DangerZone,
} from '../extraction';
import { DANGER_ZONES } from '../extraction/content';
import type { GearItem } from './economy';
import type { Injury } from './recovery';
import { generateSurvivor } from './chargen';
import type { RNG } from './rng';
import { mulberry32 } from './rng';
import {
  buildSortieLoadout,
  bankLoot,
  addRecruit,
  applySortieResult,
  applyFailureGearLoss,
  trySpendActionPoints,
  sortieActionPointCost,
  meetsDangerLevelReq,
  DANGER_LEVEL_REQ,
  computeShelterBonuses,
} from './state';
import type { SurvivalGameState } from './state';

/** 模拟一次副本最多执行几步动作（搜刮 / 转移 / 战斗都算一步） */
const WANDER_MAX_STEPS = 14;
/** 血量低于此比例时模拟「见好就收、主动撤离」 */
const WANDER_RETREAT_HP_PCT = 0.4;
/** 血量低于此比例时遭遇改为「潜行绕行」而非硬拼 */
const WANDER_SNEAK_HP_PCT = 0.35;
/**
 * 出击前血量低于此比例则拒绝派出。
 * ⚠️ 必须 ≥ WANDER_RETREAT_HP_PCT —— 否则会出现「血量在 30%~40% 之间的死区」：
 * 通过最低检查后，模拟循环第一步就因 HP < 40% 触发主动撤离而 break，
 * 整局什么也不做就 extract() 出来，行动点白扣且零收益。
 * 设为 0.4 = 撤退阈值，彻底消除该死区：低于 40% 一律拦截让玩家先治疗。
 */
const WANDER_MIN_HP_PCT = 0.4;

export interface WanderReport {
  ok: boolean;
  /** 失败原因（ok 为 false 时有值）：行动点不足 / 角色濒死 / 未指定出击者 */
  reason?: string;
  survivorName: string;
  zoneName: string;
  dangerLevel: number;
  /** 本次消耗的行动点 */
  apCost: number;
  outcome: 'success' | 'death' | 'timeout';
  /** 入库件数 / 估值 */
  items: number;
  value: number;
  /** 搜刮到的废土币（撤离成功才入账） */
  credits: number;
  /** 战斗获得的经验（撤离成功才入账） */
  xp: number;
  hpBefore: number;
  hpAfter: number;
  maxHp: number;
  /** 本局新增的伤势 */
  injuries: Injury[];
  enemyFaced?: string;
  rescued: boolean;
  /** 撤离失败被夺走的装备件数 */
  lostGear: number;
  /** 是否进入濒死 */
  dying: boolean;
  /** 一行式战报（写入存档的 wanderLog） */
  line: string;
}

export interface WanderOptions {
  /** 指定区域；不传则随机挑一张大地图 */
  zone?: DangerZone;
  /** 随机源 */
  rng: RNG;
  now?: number;
}

/**
 * 模拟出击者下一次副本并结算全部后果。
 * 纯函数：返回新状态 + 战报；任何前置条件不满足时原样返回（ok=false）。
 */
export function simulateWanderSortie(
  state: SurvivalGameState,
  opts: WanderOptions,
): { state: SurvivalGameState; report: WanderReport } {
  const now = opts.now ?? Date.now();
  const rng = opts.rng;
  const emptyLine = '';

  const mk = (
    partial: Partial<WanderReport> & { ok: boolean; reason?: string },
  ): { state: SurvivalGameState; report: WanderReport } => ({
    state,
    report: {
      survivorName: '',
      zoneName: '',
      dangerLevel: 0,
      apCost: 0,
      outcome: 'success',
      items: 0,
      value: 0,
      credits: 0,
      xp: 0,
      hpBefore: 0,
      hpAfter: 0,
      maxHp: 0,
      injuries: [],
      rescued: false,
      lostGear: 0,
      dying: false,
      line: emptyLine,
      ...partial,
    },
  });

  const active = state.survivors.find((s) => s.id === state.activeSurvivorId);
  if (!active) return mk({ ok: false, reason: '未指定出击者' });

  const activeLevel = active.level ?? 1;

  const status = state.survivorStatus[active.id];
  if (status?.dyingUntil && new Date(status.dyingUntil).getTime() > now) {
    return mk({ ok: false, reason: `${active.name} 处于濒死状态，需先救治`, survivorName: active.name });
  }
  if (!status) return mk({ ok: false, reason: '角色状态缺失', survivorName: active.name });
  // 残血拒绝派出（避免白白消耗行动点），与「手动出击可自行冒险」不同，漫游是托管行为
  const statusMax = status.maxHp ?? 0;
  const statusHp = Math.round(status.currentHp ?? 0);
  if (statusMax > 0 && statusHp / statusMax < WANDER_MIN_HP_PCT) {
    return mk({
      ok: false,
      reason: `${active.name} 血量过低（${statusHp}/${statusMax}，${Math.round((statusHp / statusMax) * 100)}%），请先治疗或等待恢复`,
      survivorName: active.name,
    });
  }

  const loadout = buildSortieLoadout(state, active.id);
  if (!loadout) return mk({ ok: false, reason: '出击装配失败', survivorName: active.name });

  // 区域：不指定则随机抽取（仅限出击者等级可进入的危险度，避免 1 级被扔到危7）
  // 若调用方显式指定了越级区域，直接拒绝（不产生任何结算）
  if (opts.zone && !meetsDangerLevelReq(activeLevel, opts.zone.dangerLevel)) {
    return mk({
      ok: false,
      reason: `等级不足：进入「${opts.zone.name}」（危${opts.zone.dangerLevel}）需 Lv.${DANGER_LEVEL_REQ[opts.zone.dangerLevel] ?? 1}，当前 Lv.${activeLevel}`,
      survivorName: active.name,
      zoneName: opts.zone.name,
      dangerLevel: opts.zone.dangerLevel,
    });
  }
  const allowedZones = opts.zone
    ? [opts.zone]
    : DANGER_ZONES.filter((z) => meetsDangerLevelReq(activeLevel, z.dangerLevel));
  const zone = allowedZones.length > 0
    ? allowedZones[Math.floor(rng() * allowedZones.length)]
    : DANGER_ZONES[0];

  const apCost = sortieActionPointCost(zone.dangerLevel);
  // 先扣行动点：不足则整局不成立，避免"没花钱却拿收益"
  const paid = trySpendActionPoints(state, apCost, now);
  if (!paid) {
    return mk({
      ok: false,
      reason: `行动点不足：「${zone.name}」（危${zone.dangerLevel}）需 ${apCost} 点`,
      survivorName: active.name,
      zoneName: zone.name,
      dangerLevel: zone.dangerLevel,
      apCost,
    });
  }

  // ===== 建局：与手动出击 start() 完全同口径 =====
  const baseMax = status.maxHp ?? 0;
  const garrisonBonuses = computeShelterBonuses(state.facilities, state.factionRep);
  const garrisonAttrHp =
    ((garrisonBonuses.attrBonus.vitality ?? 0) + (garrisonBonuses.factionAttrBonus.vitality ?? 0)) * 20 +
    ((garrisonBonuses.attrBonus.endurance ?? 0) + (garrisonBonuses.factionAttrBonus.endurance ?? 0)) * 3;
  const eqMap = state.equipped[active.id] ?? {};
  const equippedGear: GearItem[] = (Object.values(eqMap) as (string | undefined)[])
    .filter((id): id is string => !!id)
    .map((id) => state.gear.find((g) => g.id === id))
    .filter((g): g is GearItem => !!g);
  const preSortieGearHp = equippedGear.reduce(
    (sum, g) =>
      sum + ((g.modifiers?.vitality ?? 0) * 20 + (g.modifiers?.endurance ?? 0) * 3) + (g.combat?.hpBonus ?? 0),
    0,
  );
  const baseNoGear = Math.max(0, baseMax - preSortieGearHp);
  const startMax = baseNoGear + garrisonAttrHp;
  let startHp = status.currentHp ?? 0;
  const headStart = Math.round(baseMax * (loadout.bonus?.startHpRatio ?? 0));
  startHp = Math.min(startHp + headStart, baseMax);
  startHp = Math.min(startHp + garrisonAttrHp, baseMax + garrisonAttrHp);

  const armorGear = eqMap.armor ? state.gear.find((g) => g.id === eqMap.armor) : undefined;
  const armorMax = armorGear ? 40 + (armorGear.tier ?? 0) * 30 : 0;
  const weaponGear = eqMap.weapon ? state.gear.find((g) => g.id === eqMap.weapon) : undefined;
  const startAmmo = 24 + (weaponGear ? (weaponGear.tier ?? 0) * 8 : 0);

  const seed = Math.floor(rng() * 2 ** 31);
  const runRng = mulberry32(seed);
  const run: ExtractionRunState = createRun(
    loadout,
    zone,
    startHp,
    { current: armorMax, max: armorMax },
    startAmmo,
    {
      equipped: equippedGear,
      injuries: status.injuries ?? [],
      startMaxHp: startMax,
      baseMaxHp: baseMax,
      rng: runRng,
      seed,
    },
  );

  // ===== 模拟循环：搜刮 → 遇敌就打 → 血量过低主动撤 =====
  const hpBefore = Math.round(status.currentHp ?? 0);
  const lootLuck = loadout.bonus?.lootLuck ?? 0;
  // phaseOf 经函数读取，避免 TS 把 run.phase 收窄成单一字面量
  const phaseOf = (r: ExtractionRunState): string => r.phase;
  const hpPctOf = (r: ExtractionRunState): number =>
    r.condition.resources.hp.current / (r.condition.resources.hp.max || 1);

  let enemyFaced: string | undefined;
  /** 遭遇处理：血少则尝试潜行脱离，否则正面开战；战后顺手搜尸 */
  const handleEncounter = () => {
    if (!run.encounter) return;
    enemyFaced = run.encounter.enemy.name;
    resolveEncounter(run, hpPctOf(run) < WANDER_SNEAK_HP_PCT ? 'sneak' : 'fight', runRng);
    if (run.corpse) lootCorpse(run, runRng);
  };

  let steps = 0;
  while (steps < WANDER_MAX_STEPS && phaseOf(run) === 'searching') {
    steps += 1;
    // 背包满（上一轮遗留的抉择）：放弃本轮拾取，继续跑
    if (run.pendingSearch) resolveBagFull(run, 'abandon', runRng);
    // 遭遇抉择（含转移伏击）
    if (run.encounter) {
      handleEncounter();
      continue;
    }
    // 血量过低：见好就收，冲撤离点
    if (hpPctOf(run) < WANDER_RETREAT_HP_PCT) {
      if (run.extractRevealed && !run.atExtract) goToExtract(run, runRng);
      break;
    }
    if (zoneSearchLeft(run) > 0) {
      search(run, runRng, lootLuck);
      rollRescue(run, runRng, () => generateSurvivor(runRng));
      if (run.pendingSearch) resolveBagFull(run, 'abandon', runRng);
      handleEncounter();
    } else {
      // 本区搜刮干净 → 往更深的相邻区转移（越深越危险，也越肥）
      const nb = zoneNeighbors(run);
      if (nb.length === 0) break;
      const deeper = nb.slice().sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));
      moveToNode(run, deeper[0].id, runRng);
      handleEncounter(); // 转移可能触发伏击
    }
  }
  // 步数用尽 / 主动撤退：能撤就撤
  if (phaseOf(run) === 'searching' && run.extractRevealed && !run.atExtract) goToExtract(run, runRng);
  if (phaseOf(run) === 'searching' || phaseOf(run) === 'combat') extract(run);

  const failed = phaseOf(run) === 'dead' || phaseOf(run) === 'timeout';
  if (failed) {
    // 安全箱 100% 保留（搜打撤保底设计）
    const kept = run.secureBox.filter((s): s is NonNullable<typeof s> => s !== null);
    if (kept.length > 0) {
      run.bankedLoot.push(...kept);
      run.secureBox = run.secureBox.map(() => null);
    }
  }

  // ===== 结算：与手动出击 persistRunResult 同口径 =====
  let next = bankLoot(paid, run.bankedLoot);
  const credits = failed ? 0 : Math.round(run.carriedCredits ?? 0);
  if (credits > 0) {
    next = { ...next, coins: next.coins + credits };
  }
  if (run.bankedNpc) next = addRecruit(next, run.bankedNpc);

  const finalHpRaw = run.condition.resources.hp.current;
  const settleMaxHp = run.baseMaxHp || run.condition.resources.hp.max || baseMax;
  const finalHp = Math.max(0, Math.min(settleMaxHp, Math.round(finalHpRaw)));
  const injuries: Injury[] = run.injuries ?? [];
  const xp = failed ? 0 : Math.round(run.xpGained ?? 0);

  const afterSortie = applySortieResult(next, {
    survivorId: active.id,
    survivorName: active.name,
    zoneName: zone.name,
    outcome: failed ? 'death' : 'success',
    bankedItems: run.bankedLoot.reduce((a, b) => a + (b.qty ?? 1), 0),
    bankedValue: sumValue(run.bankedLoot),
    enemyFaced,
    rescued: !!run.bankedNpc,
    xpGained: xp,
    finalHp,
    maxHp: settleMaxHp,
    injuries,
  });

  let final = afterSortie;
  let lostGear = 0;
  if (failed) {
    const r = applyFailureGearLoss(final, active.id, runRng);
    final = r.state;
    lostGear = r.lost.length;
  }

  const dying = !!final.survivorStatus[active.id]?.dyingUntil;
  const newInjuries = injuries.filter(
    (i) => !(status.injuries ?? []).includes(i),
  );

  const resultText = failed
    ? `撤离失败${dying ? '·濒死' : ''}${lostGear > 0 ? `·掉装 ${lostGear} 件` : ''}`
    : `撤离成功·入库 ${run.bankedLoot.length} 件${credits > 0 ? `·${credits} 币` : ''}${xp > 0 ? `·经验 +${xp}` : ''}`;
  const line = `[${new Date(now).toLocaleTimeString()}] ${active.name} → ${zone.name}（危${zone.dangerLevel}，-${apCost} AP）：${resultText}｜HP ${hpBefore} → ${finalHp}/${settleMaxHp}${
    newInjuries.length > 0 ? `｜新伤：${newInjuries.length}` : ''
  }`;

  final = {
    ...final,
    wanderLog: [line, ...(final.wanderLog ?? [])].slice(0, 10),
    log: [`【漫游】${line}`, ...final.log].slice(0, 50),
  };

  return {
    state: final,
    report: {
      ok: true,
      survivorName: active.name,
      zoneName: zone.name,
      dangerLevel: zone.dangerLevel,
      apCost,
      outcome: failed ? (run.phase === 'timeout' ? 'timeout' : 'death') : 'success',
      items: run.bankedLoot.length,
      value: sumValue(run.bankedLoot),
      credits,
      xp,
      hpBefore,
      hpAfter: finalHp,
      maxHp: settleMaxHp,
      injuries: newInjuries,
      enemyFaced,
      rescued: !!run.bankedNpc,
      lostGear,
      dying,
      line,
    },
  };
}

/** 漫游随机区域（供 UI 预览/说明用） */
export function pickWanderZone(rng: RNG, zones: DangerZone[]): DangerZone {
  return zones[Math.floor(rng() * zones.length)];
}

/** 六维展示辅助（UI 用，避免重复导入） */
export type WanderAttrs = Attributes;
