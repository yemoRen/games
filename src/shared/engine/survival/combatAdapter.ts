/*
 * combatAdapter.ts — 把幸存者/敌人接入 battle-v5 的「正式战斗单元」构造链。
 *
 * 设计要点（回应「集成 createCombatUnitFromCultivator 让正式装备/词条进入 battle-v5」）：
 *  - 通过 createCombatUnitFromCultivator 构建 Unit（与原游戏 tower/sect 战斗同一条链路），
 *    让属性→派生属性（气血/攻击/防御/暴击…）的算法与原游戏完全一致。
 *  - 装备/词条/避难所的「战斗加成」（气血上限、暴击、搜刮运势、初始血量）在构建后
 *    以 AttributeModifier 形式注入：
 *      · hpBonus  → MAX_HP 固定加值（FIXED）
 *      · critBonus → CRIT_RATE 固定加值（FIXED）
 *  - lootLuck / startHpRatio 属于「搜打撤」层收益，由调用方在 search / 出击初始 HP 处消费，
 *    不进入战斗单位（战斗引擎不消费这两个概念）。
 */

import type { Attributes } from '@shared/types/cultivator';
import { REALM_STAGE_VALUES, REALM_VALUES } from '@shared/types/constants';
import type { CultivatorCondition } from '@shared/types/condition';
import { AttributeType, ModifierType } from '@shared/engine/battle-v5/core/types';
import { Unit } from '@shared/engine/battle-v5/units/Unit';
import { BattleRuntime } from '@shared/engine/battle-v5/runtime/BattleRuntime';
import { createCombatUnitFromCultivator } from '@shared/engine/battle-v5/adapters/CultivatorCombatAdapter';
import type {
  SurvivorProfile,
} from './chargen';
import type { CombatBonus, EnemyArchetype } from '@shared/engine/extraction';

/** 空 condition：createCombatUnitFromCultivator 内部会读 bodyCultivation 修饰，空态安全。 */
const EMPTY_CONDITION: CultivatorCondition = {
  version: 1,
  resources: {
    hp: { current: 1, max: 1 },
    mp: { current: 1, max: 1 },
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

/**
 * 把幸存者档案 + 已结算属性，转为 createCombatUnitFromCultivator 可消费的输入。
 * realm/realm_stage 仅作为占位（不影响无 sect/无神通时的派生属性；getRealmStageRank 容错 undefined）。
 */
export function survivorToCultivatorInput(
  profile: SurvivorProfile,
  attributes: Attributes,
): Parameters<typeof createCombatUnitFromCultivator>[0] {
  return {
    id: profile.id,
    name: profile.name,
    realm: REALM_VALUES[0],
    realm_stage: REALM_STAGE_VALUES[0],
    attributes,
    spiritual_roots: [],
    pre_heaven_fates: [],
    sect: undefined,
    skills: [],
    cultivations: [],
    equipped: { weapon: null, armor: null, accessory: null },
    condition: EMPTY_CONDITION,
    inventory: { artifacts: [] },
  };
}

/** 把战斗加成以 AttributeModifier 注入单位，并刷新派生属性。 */
export function applyCombatBonuses(unit: Unit, bonus: CombatBonus): void {
  if (bonus.hpBonus) {
    unit.attributes.addModifier({
      id: 'surv-hp-bonus',
      attrType: AttributeType.MAX_HP,
      type: ModifierType.FIXED,
      value: bonus.hpBonus,
      source: { sourceType: 'survivalBonus', carrierId: 'survival' },
    });
  }
  if (bonus.critBonus) {
    unit.attributes.addModifier({
      id: 'surv-crit-bonus',
      attrType: AttributeType.CRIT_RATE,
      type: ModifierType.FIXED,
      value: bonus.critBonus,
      source: { sourceType: 'survivalBonus', carrierId: 'survival' },
    });
  }
  // 注入后再刷新一次，让 maxHp 含 hpBonus
  unit.updateDerivedStats();
}

/**
 * 构建幸存者战斗单位（正式接入 battle-v5）。
 * @param carriedHp 出击起始血量；不传则满血（新建 run 时用）。
 */
export function buildSurvivorUnit(
  profile: SurvivorProfile,
  attributes: Attributes,
  bonus: CombatBonus,
  runtime: BattleRuntime,
  carriedHp?: number,
): Unit {
  const input = survivorToCultivatorInput(profile, attributes);
  const unit = createCombatUnitFromCultivator(input, false, runtime);
  applyCombatBonuses(unit, bonus);
  if (typeof carriedHp === 'number') {
    unit.initializeResources({ hp: carriedHp });
  }
  return unit;
}

/** 敌人同样走正式战斗单元链路，保证双方用同一套派生属性算法。 */
export function buildEnemyUnit(runtime: BattleRuntime, enemy: EnemyArchetype): Unit {
  const input = {
    id: enemy.id,
    name: enemy.name,
    realm: REALM_VALUES[0],
    realm_stage: REALM_STAGE_VALUES[0],
    attributes: enemy.attributes,
    spiritual_roots: [],
    pre_heaven_fates: [],
    sect: undefined,
    skills: [],
    cultivations: [],
    equipped: { weapon: null, armor: null, accessory: null },
    condition: EMPTY_CONDITION,
    inventory: { artifacts: [] },
  };
  const unit = createCombatUnitFromCultivator(input, false, runtime);
  // 敌人词缀带来的气血/暴击加成，以 AttributeModifier 注入（与幸存者同链路）
  if (enemy.bonus && (enemy.bonus.hpBonus || enemy.bonus.critBonus)) {
    applyCombatBonuses(unit, {
      hpBonus: enemy.bonus.hpBonus,
      critBonus: enemy.bonus.critBonus,
      lootLuck: 0,
      startHpRatio: 0,
    });
  }
  return unit;
}
