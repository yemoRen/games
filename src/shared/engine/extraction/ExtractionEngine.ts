/**
 * Phase 1 — 搜打撤核心引擎（最小可玩 Demo 版）
 *
 * 这是换皮设计里「最关键的增量」：把原游戏被动的秘境产出，
 * 升级为「搜(搜刮) → 打(战斗) → 撤(撤离结算)」主动循环。
 *
 * 引擎复用（不重写）：
 *  - 战斗：battle-v5 的 resolveDuelToCompletion（真实伤害/回合/胜负判定）
 *  - 状态：CultivatorCondition（hp/mp/毒性/创伤）作为「单次出击 survival 状态」
 *
 * 注意：Demo 中幸存者/敌人直接用 battle-v5 的 Unit 构建（属性→战斗属性，
 * 自带普攻兜底），以最小代价跑通真实战斗。接入正式游戏时，把幸存者换成
 * 完整 Cultivator 走 createCombatUnitFromCultivator 即可，引擎逻辑不变。
 */

import { Unit } from '@shared/engine/battle-v5/units/Unit';
import { AttributeType } from '@shared/engine/battle-v5/core/types';
import type { UnitId } from '@shared/engine/battle-v5/core/types';
import { BattleRuntime } from '@shared/engine/battle-v5/runtime/BattleRuntime';
import { resolveDuelToCompletion } from '@shared/engine/battle-v5/round/BattleAutoResolver';
import type { CultivatorCondition } from '@shared/types/condition';
import { SYSTEM_LINES } from '@shared/theme/survival';
import {
  buildSurvivorUnit,
  buildEnemyUnit,
} from '@shared/engine/survival/combatAdapter';
import {
  rollEnemyAffixes,
  aggregateEnemyAffixes,
  rollGearDrop,
} from '@shared/engine/survival/affixes';
import type {
  DangerZone,
  EnemyArchetype,
  ExtractOutcome,
  ExtractionRunState,
  ExtractionSummary,
  LootItem,
  SurvivorLoadout,
} from './types';
import type { Attributes } from '@shared/types/cultivator';

const ATTRIBUTE_MAP: Array<[keyof Attributes, AttributeType]> = [
  ['vitality', AttributeType.VITALITY],
  ['strength', AttributeType.STRENGTH],
  ['spirit', AttributeType.SPIRIT],
  ['endurance', AttributeType.ENDURANCE],
  ['speed', AttributeType.SPEED],
  ['willpower', AttributeType.WILLPOWER],
];

/** 构造一个可参战的 Unit（属性→战斗属性，自带普攻兜底） */
function buildUnit(
  runtime: BattleRuntime,
  id: string,
  name: string,
  attrs: Attributes,
  currentHp?: number,
): Unit {
  const baseAttrs = {} as Record<AttributeType, number>;
  for (const [key, attrType] of ATTRIBUTE_MAP) {
    baseAttrs[attrType] = attrs[key];
  }
  const unit = new Unit(id as UnitId, name, baseAttrs, { runtime });
  unit.updateDerivedStats();
  unit.initializeCurrentResourcesToMax();
  if (typeof currentHp === 'number') {
    unit.initializeResources({ hp: currentHp });
  }
  return unit;
}

/** 构造一份全新的 in-run 状态（复用 condition 结构） */
function freshCondition(maxHp: number, maxMp: number): CultivatorCondition {
  return {
    version: 1,
    resources: {
      hp: { current: maxHp, max: maxHp },
      mp: { current: maxMp, max: maxMp },
    },
    gauges: { pillToxicity: 0 },
    tracks: {
      tempering: {
        vitality: { level: 0, progress: 0 },
        spirit: { level: 0, progress: 0 },
        wisdom: { level: 0, progress: 0 },
        speed: { level: 0, progress: 0 },
        willpower: { level: 0, progress: 0 },
      },
      marrowWash: { version: 1, level: 0, progress: 0 },
    },
    counters: {
      longTermPillUsesByRealm: {},
      cultivationPillUsesByRealm: {},
      longevityPillUsesByRealm: {},
    },
    statuses: [],
    timestamps: {},
  };
}

function sumValue(items: LootItem[]): number {
  return items.reduce((acc, it) => acc + it.value, 0);
}

/** 进入危险区域，建立一次出击（状态机从 idle → searching） */
export function createRun(survivor: SurvivorLoadout, zone: DangerZone, startHp?: number): ExtractionRunState {
  const runtime = new BattleRuntime();
  // 有完整档案+战斗加成时，走正式 battle-v5 战斗单元；否则退化为属性直转。
  let unit: Unit;
  if (survivor.profile && survivor.bonus) {
    unit = buildSurvivorUnit(survivor.profile, survivor.attributes, survivor.bonus, runtime);
  } else {
    unit = buildUnit(runtime, 'survivor', survivor.name, survivor.attributes);
  }
  const condition = freshCondition(unit.getMaxHp(), unit.getMaxMp());
  if (typeof startHp === 'number') {
    condition.resources.hp.current = Math.max(0, Math.min(unit.getMaxHp(), Math.round(startHp)));
  }
  return {
    survivor,
    zone,
    condition,
    carriedLoot: [],
    bankedLoot: [],
    phase: 'searching',
    searchCount: 0,
    log: [SYSTEM_LINES.missionReady, SYSTEM_LINES.enterZone, `进入【${zone.name}】：${zone.flavor}`],
    rescuedThisRun: false,
  };
}

/** 搜刮阶段：从区域战利品表随机获得 1~2 件物资，进入携带栏（未撤离） */
export function search(state: ExtractionRunState, rng: () => number = Math.random, luck = 0): void {
  if (state.phase !== 'searching') return;
  const base = 1 + Math.floor(rng() * 2);
  // 搜刮运势（词条/装备/避难所聚合）：整数保底额外次数 + 小数部分概率额外一次
  const extra = Math.floor(luck) + (rng() < luck % 1 ? 1 : 0);
  const picks = base + extra;
  for (let i = 0; i < picks; i++) {
    const item = state.zone.lootTable[Math.floor(rng() * state.zone.lootTable.length)];
    state.carriedLoot.push(item);
    state.log.push(`${SYSTEM_LINES.search} 获得【${item.name}】(估值 ${item.value})`);
  }
  // 装备掉落：危险度越高，越可能搜到带阶级词缀的装备（白-绿-蓝-紫-黄-橙-红）
  const gearChance = 0.25 + state.zone.dangerLevel * 0.04;
  if (rng() < gearChance) {
    const drop = rollGearDrop(rng, state.zone.dangerLevel, luck * 0.2);
    state.carriedLoot.push(drop);
    const affixText = drop.affixes.map((a) => a.text).join('、');
    state.log.push(
      `${SYSTEM_LINES.search} 搜出【${drop.name}】(${drop.rarityName}阶，估值 ${drop.value})${affixText ? ` 词缀：${affixText}` : ''}`,
    );
  }
  state.searchCount++;
}

/**
 * 按区域危险度随机抽一个敌人原型，并按危险度结算其词缀。
 * 危险度越高 → 敌人词缀阶级越高、数量越多（见 affixes.rollEnemyAffixes）。
 */
export function rollEncounter(state: ExtractionRunState, rng: () => number = Math.random): EnemyArchetype | null {
  const chance = 0.3 + state.zone.dangerLevel * 0.12;
  if (rng() >= chance) return null;
  const base = state.zone.enemies[Math.floor(rng() * state.zone.enemies.length)];
  const affixes = rollEnemyAffixes(rng, state.zone.dangerLevel);
  const { attributes, hpBonus, critBonus } = aggregateEnemyAffixes(affixes);
  const effectiveAttributes: Attributes = { ...base.attributes };
  for (const k of Object.keys(attributes) as (keyof Attributes)[]) {
    effectiveAttributes[k] = (effectiveAttributes[k] ?? 0) + (attributes[k] ?? 0);
  }
  return {
    ...base,
    attributes: effectiveAttributes,
    bonus: { hpBonus, critBonus },
    affixes,
  };
}

/**
 * 救援事件：搜刮时按概率生成一个可招募集合成员。
 * npcGenerator 由 caller 注入（charge.ts.generateSurvivor），
 * 保持 extraction 引擎与生存系统的解耦。
 */
export function rollRescue(
  state: ExtractionRunState,
  rng: () => number,
  npcGenerator: () => import('@shared/engine/survival/chargen').SurvivorProfile,
): import('@shared/engine/survival/chargen').SurvivorProfile | null {
  if (state.rescuedThisRun) return null;
  // 低概率 + 危险度越高救援越容易（因为更危险的地方遇难者也越多）
  const chance = 0.10 + state.zone.dangerLevel * 0.04;
  if (rng() >= chance) return null;
  const npc = npcGenerator();
  state.rescuedThisRun = true;
  state.log.push(`❗ 发现被困幸存者【${npc.name}】（${npc.tierName}）—— 决定带回基地。`);
  state.carriedNpc = npc;
  return npc;
}

/** 交战阶段：用真实 battle-v5 引擎决出胜负，并把结果写回 in-run 状态 */
export function fight(
  state: ExtractionRunState,
  enemy: EnemyArchetype,
  _rng: () => number = Math.random,
): void {
  if (state.phase !== 'searching') return;
  state.phase = 'combat';
  const runtime = new BattleRuntime();
  // 有完整档案+战斗加成时走正式 battle-v5 战斗单元（装备/词条生效）；否则属性直转。
  let survivorUnit: Unit;
  if (state.survivor.profile && state.survivor.bonus) {
    survivorUnit = buildSurvivorUnit(
      state.survivor.profile,
      state.survivor.attributes,
      state.survivor.bonus,
      runtime,
      state.condition.resources.hp.current,
    );
  } else {
    survivorUnit = buildUnit(
      runtime,
      'survivor',
      state.survivor.name,
      state.survivor.attributes,
      state.condition.resources.hp.current,
    );
  }
  const enemyUnit = buildEnemyUnit(runtime, enemy);
  const duel = resolveDuelToCompletion({
    battleId: 'extraction-duel',
    player: survivorUnit,
    opponent: enemyUnit,
    runtime,
  });
  const survivorWon = duel.winner === survivorUnit.id;
  const sSnap = survivorWon ? duel.winnerSnapshot : duel.loserSnapshot;
  const eSnap = survivorWon ? duel.loserSnapshot : duel.winnerSnapshot;
  const affixNote = enemy.affixes && enemy.affixes.length
    ? `〔${enemy.affixes.map((a) => a.label).join('、')}〕`
    : '';
  state.log.push(
    `⚔ 与【${enemy.name}】${affixNote}交战（${enemy.threatNote ?? ''}），历时 ${duel.turns} 回合`,
  );
  state.condition.resources.hp.current = sSnap.hp.current;
  state.condition.resources.hp.max = sSnap.hp.max;
  if (!sSnap.alive) {
    state.phase = 'dead';
    state.log.push(SYSTEM_LINES.death);
    return;
  }
  state.phase = 'searching';
  state.log.push(
    `✔ 击退【${enemy.name}】（敌方残余生命 ${eSnap.hp.current}），你剩余生命 ${sSnap.hp.current}/${sSnap.hp.max}`,
  );
}

/** 撤离结算：成功→携带物资入库 + 救援到的幸存者也带回基地；死亡/超时→仅丢未撤离物资 */
export function extract(state: ExtractionRunState): ExtractOutcome {
  if (state.phase === 'dead') return 'death';
  if (state.phase === 'timeout') return 'timeout';
  state.bankedLoot.push(...state.carriedLoot);
  const bankedValue = sumValue(state.bankedLoot);
  state.carriedLoot = [];
  if (state.carriedNpc) {
    state.bankedNpc = state.carriedNpc;
    state.carriedNpc = undefined;
  }
  state.phase = 'extracted';
  state.log.push(`${SYSTEM_LINES.extractSuccess} 入库 ${state.bankedLoot.length} 件，估值 ${bankedValue} 废土币`);
  return 'success';
}

function buildSummary(state: ExtractionRunState, outcome: ExtractOutcome): ExtractionSummary {
  return {
    survivorName: state.survivor.name,
    zoneName: state.zone.name,
    outcome,
    searches: state.searchCount,
    carriedValue: sumValue(state.carriedLoot),
    bankedValue: sumValue(state.bankedLoot),
    hpLeft: state.condition.resources.hp.current,
    hpMax: state.condition.resources.hp.max ?? 0,
  };
}

/** 确定性随机（mulberry32），让 Demo 可复现 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 一键演示：搜几次 → 可能遭遇战斗 → 最终撤离。
 * 返回完整状态机 + 结算摘要，供上层（CLI / 前端 / 测试）消费。
 */
export function runAutoExtraction(opts: {
  survivor: SurvivorLoadout;
  zone: DangerZone;
  rng?: () => number;
  maxSearches?: number;
}): { state: ExtractionRunState; summary: ExtractionSummary } {
  const rng = opts.rng ?? Math.random;
  const state = createRun(opts.survivor, opts.zone);
  const maxSearches = opts.maxSearches ?? 3;
  let i = 0;
  while (i < maxSearches && state.phase === 'searching') {
    search(state, rng);
    const enemy = rollEncounter(state, rng);
    if (enemy) fight(state, enemy, rng);
    i++;
  }
  const outcome: ExtractOutcome = state.phase === 'dead' ? 'death' : extract(state);
  return { state, summary: buildSummary(state, outcome) };
}

export { sumValue };
