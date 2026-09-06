/*
 * affixes.ts — 废土词条 / 稀有度体系（白-绿-蓝-紫-黄-橙-红）。
 *
 * 设计意图（呼应最初游戏「用颜色区分词条阶级」）：
 *  - 7 阶稀有度，配色与最初游戏完全一致：白(普通) → 绿 → 蓝 → 紫 → 黄 → 橙 → 红(传说)，
 *    阶级逐级提升：数值更强、出现概率更低。
 *  - 敌人 / 掉落装备都从同一套 tier 体系取词缀；副本危险度(dangerLevel)决定可达的最高阶
 *    与词缀数量——危险度越高，遇到的敌人词缀越狠、掉落的装备阶级越高。
 *
 * 关于「对接 creation-v2 词条库」：creation-v2 的 AffixRarity 只有 4 阶且依赖整套
 * creation-tag / 监听器 / 能量预算管线，直接拉入会拖垮本搜打撤模块。这里沿用其
 * 「稀有度 → 权重 → 词缀数量 → 数值缩放」的分层思想，但落到自包含的废土词条模型，
 * 保证可复现、可 lint、低风险。
 */

import type { Attributes } from '@shared/types/cultivator';
import type { GearItem, GearSlot } from './economy';
import { type RNG, pick, pickN, weightedPick } from './rng';

// ===== 7 阶稀有度（颜色即阶级） =====

export type AffixTierKey =
  | 'white'
  | 'green'
  | 'blue'
  | 'purple'
  | 'yellow'
  | 'orange'
  | 'red';

export interface AffixTier {
  key: AffixTierKey;
  /** 0..6，数字越大阶级越高 */
  tier: number;
  /** 中文阶级名（白/绿/蓝/紫/黄/橙/红） */
  label: string;
  /** 阶级配色（与最初游戏一致） */
  color: string;
  /** 抽取权重（越高阶越稀有） */
  weight: number;
  /** 该阶级词缀数值倍率（逐级提升） */
  affixMag: number;
  /** 阶级后缀（用于装备命名，如「·蓝」） */
  suffix: string;
}

export const AFFIX_TIERS: AffixTier[] = [
  { key: 'white', tier: 0, label: '白', color: '#cbd5e1', weight: 40, affixMag: 1.0, suffix: '·白' },
  { key: 'green', tier: 1, label: '绿', color: '#4ade80', weight: 28, affixMag: 1.4, suffix: '·绿' },
  { key: 'blue', tier: 2, label: '蓝', color: '#38bdf8', weight: 18, affixMag: 1.9, suffix: '·蓝' },
  { key: 'purple', tier: 3, label: '紫', color: '#c084fc', weight: 10, affixMag: 2.5, suffix: '·紫' },
  { key: 'yellow', tier: 4, label: '黄', color: '#facc15', weight: 4, affixMag: 3.2, suffix: '·黄' },
  { key: 'orange', tier: 5, label: '橙', color: '#fb923c', weight: 1.5, affixMag: 4.0, suffix: '·橙' },
  { key: 'red', tier: 6, label: '红', color: '#f87171', weight: 0.5, affixMag: 5.0, suffix: '·红' },
];

export function tierByTier(tier: number): AffixTier {
  return AFFIX_TIERS[Math.max(0, Math.min(AFFIX_TIERS.length - 1, Math.round(tier)))];
}

export function tierColor(tier: number): string {
  return tierByTier(tier).color;
}

export function tierLabel(tier: number): string {
  return tierByTier(tier).label;
}

/** 按阶级 key 取配色（词条天赋着色用） */
export function affixColor(key: AffixTierKey): string {
  return AFFIX_TIERS.find((t) => t.key === key)?.color ?? '#cbd5e1';
}

/** 按阶级 key 取中文阶级名（词条天赋着色用） */
export function affixLabel(key: AffixTierKey): string {
  return AFFIX_TIERS.find((t) => t.key === key)?.label ?? '白';
}

/** UI 用的图例（白-绿-蓝-紫-黄-橙-红） */
export const RARITY_LEGEND = AFFIX_TIERS.map((t) => ({ label: t.label, color: t.color }));

// ===== 词条定义（敌人 / 装备共用一套分层思想） =====

export type AffixKind = 'offense' | 'defense' | 'utility';

export interface SurvivalAffix {
  id: string;
  name: string;
  /** 描述模板，{n} 会被最终数值替换 */
  desc: string;
  /** 属性增量（按 affixMag 缩放） */
  modifiers?: Partial<Attributes>;
  /** 战斗增益（按 affixMag 缩放）：仅 hpBonus/critBonus/lootLuck */
  combat?: { hpBonus?: number; critBonus?: number; lootLuck?: number };
  weight: number;
  /** 仅在该阶级及以上才会出现（高价值词缀锁高阶） */
  minTier?: number;
  kind: AffixKind;
}

/** 已结算、可直接展示与应用的词缀实例 */
export interface AppliedAffix {
  id: string;
  name: string;
  tier: number;
  tierKey: AffixTierKey;
  color: string;
  /** 展示名，如「凶暴·蓝」 */
  label: string;
  /** 最终描述（{n} 已替换） */
  text: string;
  modifiers?: Partial<Attributes>;
  combat?: { hpBonus?: number; critBonus?: number; lootLuck?: number };
}

// ===== 敌人词缀池（作用于敌人战斗单元） =====

export const ENEMY_AFFIXES: SurvivalAffix[] = [
  { id: 'ea-ferocious', name: '凶暴', desc: '力量 +{n}', modifiers: { strength: 3 }, weight: 12, kind: 'offense' },
  { id: 'ea-bloodthirsty', name: '嗜血', desc: '暴击 +{n}%', combat: { critBonus: 0.03 }, weight: 10, kind: 'offense' },
  { id: 'ea-ironhide', name: '铁甲', desc: '耐力 +{n}', modifiers: { endurance: 3 }, weight: 12, kind: 'defense' },
  { id: 'ea-tough', name: '重甲', desc: '气血 +{n}', combat: { hpBonus: 10 }, weight: 10, kind: 'defense' },
  { id: 'ea-swift', name: '迅捷', desc: '敏捷 +{n}', modifiers: { speed: 4 }, weight: 11, kind: 'utility' },
  { id: 'ea-sensor', name: '感知', desc: '感知 +{n}', modifiers: { spirit: 3 }, weight: 10, kind: 'utility' },
  { id: 'ea-rage', name: '狂怒', desc: '力量 +{n}/暴击 +{n}%', modifiers: { strength: 2 }, combat: { critBonus: 0.04 }, weight: 8, minTier: 2, kind: 'offense' },
  { id: 'ea-regen', name: '再生', desc: '体质 +{n}/气血 +{n}', modifiers: { vitality: 3 }, combat: { hpBonus: 8 }, weight: 8, minTier: 2, kind: 'defense' },
  { id: 'ea-savage', name: '凶性', desc: '力量 +{n}/暴击 +{n}%', modifiers: { strength: 3 }, combat: { critBonus: 0.05 }, weight: 6, minTier: 3, kind: 'offense' },
  { id: 'ea-steelbone', name: '钢骨', desc: '耐力 +{n}/气血 +{n}', modifiers: { endurance: 5 }, combat: { hpBonus: 20 }, weight: 5, minTier: 3, kind: 'defense' },
  { id: 'ea-apex', name: '巅峰', desc: '全属性 +{n}/暴击 +{n}%', modifiers: { vitality: 3, strength: 3, speed: 2 }, combat: { critBonus: 0.06 }, weight: 3, minTier: 4, kind: 'offense' },
  { id: 'ea-unbroken', name: '不灭', desc: '气血 +{n}', combat: { hpBonus: 40 }, weight: 3, minTier: 5, kind: 'defense' },
];

// ===== 装备掉落词缀池（更贴近「制造的词条」） =====

export const GEAR_AFFIXES: SurvivalAffix[] = [
  { id: 'ga-kevlar', name: '凯夫拉衬层', desc: '耐力 +{n}', modifiers: { endurance: 4 }, weight: 10, kind: 'defense' },
  { id: 'ga-power', name: '动力核心', desc: '力量 +{n}', modifiers: { strength: 4 }, weight: 10, kind: 'offense' },
  { id: 'ga-reflex', name: '反射神经', desc: '敏捷 +{n}', modifiers: { speed: 4 }, weight: 10, kind: 'utility' },
  { id: 'ga-optics', name: '瞄准镜组', desc: '感知 +{n}', modifiers: { spirit: 4 }, weight: 10, kind: 'utility' },
  { id: 'ga-vitality', name: '强韧骨架', desc: '体质 +{n}', modifiers: { vitality: 4 }, weight: 10, kind: 'defense' },
  { id: 'ga-focus', name: '镇定剂', desc: '意志 +{n}', modifiers: { willpower: 4 }, weight: 10, kind: 'utility' },
  { id: 'ga-letal', name: '致命一击', desc: '暴击 +{n}%', combat: { critBonus: 0.04 }, weight: 8, minTier: 2, kind: 'offense' },
  { id: 'ga-armor', name: '强化装甲', desc: '气血 +{n}', combat: { hpBonus: 14 }, weight: 8, minTier: 2, kind: 'defense' },
  { id: 'ga-scav', name: '搜刮直觉', desc: '搜刮运势 +{n}%', combat: { lootLuck: 0.1 }, weight: 7, minTier: 1, kind: 'utility' },
  { id: 'ga-titan', name: '泰坦合金', desc: '耐力 +{n}/体质 +2', modifiers: { endurance: 5, vitality: 2 }, weight: 5, minTier: 3, kind: 'defense' },
  { id: 'ga-overcharge', name: '过载', desc: '力量 +{n}/暴击 +{n}%', modifiers: { strength: 4 }, combat: { critBonus: 0.05 }, weight: 5, minTier: 3, kind: 'offense' },
  { id: 'ga-mythic', name: '神话锻造', desc: '气血 +{n}/暴击 +{n}%', combat: { hpBonus: 30, critBonus: 0.06 }, weight: 3, minTier: 5, kind: 'defense' },
];

const GEAR_SLOT_NAMES: Record<GearSlot, string> = {
  weapon: '主武器',
  offWeapon: '副武器',
  head: '头部',
  armor: '护甲',
  legs: '腿部',
  accessory: '配件',
};

const GEAR_SLOT_BASE: Record<GearSlot, Partial<Attributes>> = {
  weapon: { strength: 3, spirit: 1 },
  offWeapon: { strength: 2, speed: 1 },
  head: { spirit: 2, willpower: 2 },
  armor: { endurance: 3, vitality: 1 },
  legs: { speed: 3, endurance: 1 },
  accessory: { speed: 2, willpower: 2 },
};

// ===== 阶级抽取（随副本难度提升） =====

/**
 * 依副本危险度抽一个阶级。
 * 危险度越高，可达最高阶越高，且权重分布整体向高阶偏移（gamma 随危险度增大），
 * 所以高难副本里遇到的词缀阶级明显更狠；运势 luckBias 进一步放大高阶权重。
 */
export function rollTier(rng: RNG, dangerLevel: number, luckBias = 0): number {
  const maxTier = Math.max(0, Math.min(AFFIX_TIERS.length - 1, Math.round(dangerLevel)));
  const gamma = 0.15 + 0.18 * Math.max(0, dangerLevel) + luckBias;
  const candidates: { value: number; weight: number }[] = [];
  for (let t = 0; t <= maxTier; t++) {
    const base = AFFIX_TIERS[t].weight;
    const weight = base * (1 + gamma * t);
    candidates.push({ value: t, weight });
  }
  return weightedPick(rng, candidates);
}

function scaleModifiers(
  mods: Partial<Attributes> | undefined,
  mag: number,
): Partial<Attributes> | undefined {
  if (!mods) return undefined;
  const out: Partial<Attributes> = {};
  for (const k of Object.keys(mods) as (keyof Attributes)[]) {
    out[k] = Math.round((mods[k] ?? 0) * mag);
  }
  return out;
}

function scaleCombat(
  c: SurvivalAffix['combat'],
  mag: number,
): AppliedAffix['combat'] | undefined {
  if (!c) return undefined;
  const out: NonNullable<AppliedAffix['combat']> = {};
  if (c.hpBonus) out.hpBonus = Math.round(c.hpBonus * mag);
  if (c.critBonus) out.critBonus = Number((c.critBonus * mag).toFixed(3));
  if (c.lootLuck) out.lootLuck = Number((c.lootLuck * mag).toFixed(3));
  return Object.keys(out).length ? out : undefined;
}

function instantiate(def: SurvivalAffix, tier: number): AppliedAffix {
  const t = tierByTier(tier);
  const mag = t.affixMag;
  const modifiers = scaleModifiers(def.modifiers, mag);
  const combat = scaleCombat(def.combat, mag);
  // 按出现顺序收集展示数值：属性增量(整数) → 战斗增益(气血整数/暴击或运势百分比)
  const displayValues: number[] = [];
  if (modifiers) {
    for (const k of Object.keys(modifiers) as (keyof Attributes)[]) {
      displayValues.push(modifiers[k] ?? 0);
    }
  }
  if (combat) {
    if (combat.hpBonus != null) displayValues.push(combat.hpBonus);
    if (combat.critBonus != null) displayValues.push(Math.round(combat.critBonus * 100));
    if (combat.lootLuck != null) displayValues.push(Math.round(combat.lootLuck * 100));
  }
  let text = def.desc;
  for (const v of displayValues) {
    text = text.replace('{n}', String(v));
  }
  return {
    id: def.id,
    name: def.name,
    tier,
    tierKey: t.key,
    color: t.color,
    label: `${def.name}${t.suffix}`,
    text,
    modifiers,
    combat,
  };
}

/**
 * 抽 N 条敌人词缀。N 与阶级都随副本危险度提升：
 * 危险度越高 → 词缀越多、单条阶级越高 → 敌人越凶。
 */
export function rollEnemyAffixes(rng: RNG, dangerLevel: number): AppliedAffix[] {
  const count = Math.min(4, 1 + Math.floor(dangerLevel / 2));
  const out: AppliedAffix[] = [];
  for (let i = 0; i < count; i++) {
    const tier = rollTier(rng, dangerLevel, 0.15);
    const pool = ENEMY_AFFIXES.filter((a) => (a.minTier ?? 0) <= tier);
    const def = weightedPick(
      rng,
      pool.map((a) => ({ value: a, weight: a.weight })),
    );
    out.push(instantiate(def, tier));
  }
  return out;
}

/** 把敌人词缀聚合成「属性增量 + 战斗加成」，供 buildEnemyUnit 应用。 */
export function aggregateEnemyAffixes(
  affixes: AppliedAffix[],
): { attributes: Partial<Attributes>; hpBonus: number; critBonus: number } {
  const attributes: Partial<Attributes> = {};
  let hpBonus = 0;
  let critBonus = 0;
  for (const a of affixes) {
    if (a.modifiers) {
      for (const k of Object.keys(a.modifiers) as (keyof Attributes)[]) {
        attributes[k] = (attributes[k] ?? 0) + (a.modifiers[k] ?? 0);
      }
    }
    if (a.combat) {
      hpBonus += a.combat.hpBonus ?? 0;
      critBonus += a.combat.critBonus ?? 0;
    }
  }
  return { attributes, hpBonus, critBonus };
}

/**
 * 随机掉落一件装备（带阶级词缀）。阶级随副本危险度提升。
 * 返回可直接放进 carriedLoot 的 LootItem（gear 字段携带完整 GearItem）。
 */
export function rollGearDrop(rng: RNG, dangerLevel: number, luckBias = 0.1): LootItemGear {
  const tier = rollTier(rng, dangerLevel, luckBias);
  const t = tierByTier(tier);
  const slot = pick(rng, ['weapon', 'armor', 'accessory'] as GearSlot[]);
  const slotName = GEAR_SLOT_NAMES[slot];

  const affixCount = 1 + (tier >= 3 ? 1 : 0) + (tier >= 6 ? 1 : 0);
  const pool = GEAR_AFFIXES.filter((a) => (a.minTier ?? 0) <= tier);
  const chosen = pickN(rng, pool, affixCount);

  const modifiers: Partial<Attributes> = { ...GEAR_SLOT_BASE[slot] };
  const combat: NonNullable<AppliedAffix['combat']> = {};
  const affixInstances: AppliedAffix[] = [];
  const affixStrings: string[] = [];

  for (const def of chosen) {
    const inst = instantiate(def, tier);
    affixInstances.push(inst);
    affixStrings.push(inst.text);
    if (inst.modifiers) {
      for (const k of Object.keys(inst.modifiers) as (keyof Attributes)[]) {
        modifiers[k] = (modifiers[k] ?? 0) + (inst.modifiers[k] ?? 0);
      }
    }
    if (inst.combat) {
      combat.hpBonus = (combat.hpBonus ?? 0) + (inst.combat.hpBonus ?? 0);
      combat.critBonus = (combat.critBonus ?? 0) + (inst.combat.critBonus ?? 0);
      combat.lootLuck = (combat.lootLuck ?? 0) + (inst.combat.lootLuck ?? 0);
    }
  }

  const gear: GearItem = {
    id: `drop-${Date.now().toString(36)}-${Math.floor(rng() * 1e6).toString(36)}`,
    name: `${t.label}阶${slotName}`,
    slot,
    rarity: t.label,
    modifiers,
    affixes: affixStrings,
    combat: Object.keys(combat).length ? combat : undefined,
    value: Math.round(40 + tier * 30 + affixInstances.length * 20),
    tier,
    tierColor: t.color,
    rarityName: t.label,
  };

  return {
    id: `loot-${gear.id}`,
    name: gear.name,
    kind: 'gear',
    value: gear.value,
    tier,
    rarityName: t.label,
    gear,
    affixes: affixInstances,
  };
}

/** rollGearDrop 的返回类型（LootItem 在 extraction/types 中定义，这里用结构化等价） */
export interface LootItemGear {
  id: string;
  name: string;
  kind: 'gear';
  value: number;
  tier: number;
  rarityName: string;
  gear: GearItem;
  affixes: AppliedAffix[];
}
