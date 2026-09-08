/*
 * economy.ts — Phase 3 经济与势力：废土币、制造改装、避难所设施、战团/势力声望。
 *
 * 设计目标：
 *  - 废土币（wasteland coins）为唯一货币，由搜打撤入库物资折算而来。
 *  - 制造改装：消耗材料 + 废土币，按配方产出带随机词缀的装备（reuse 词条思想）。
 *  - 避难所：可升级的据点设施，提供驻防被动加成（搜刮运势、出击初始、改装折扣等）。
 *  - 势力/战团：可投资提升声望，声望带来全局加成（本版为简化模型）。
 */
import type { Attributes } from '@shared/types/cultivator';
import { type RNG, pickN, randInt } from './rng';

export type MaterialKind =
  | 'metal'
  | 'electronics'
  | 'chems'
  | 'mutant'
  | 'food'
  | 'misc';

export const MATERIAL_LABEL: Record<MaterialKind, string> = {
  metal: '金属 scraps',
  electronics: '电子元件',
  chems: '化工制剂',
  mutant: '异变组织',
  food: 'compact口粮',
  misc: '杂项物资',
};

export interface MaterialItem {
  id: string;
  name: string;
  kind: MaterialKind;
  value: number;
  quantity: number;
}

export type GearSlot =
  | 'weapon' // 主武器（右手）
  | 'offWeapon' // 副武器（左手）
  | 'head' // 头部
  | 'armor' // 躯干护甲
  | 'legs' // 腿部
  | 'accessory'; // 饰品 / 战术挂件

export const GEAR_SLOT_LABEL: Record<GearSlot, string> = {
  weapon: '主武器',
  offWeapon: '副武器',
  head: '头部',
  armor: '躯干护甲',
  legs: '腿部',
  accessory: '饰品',
};

export interface GearCombatBonus {
  hpBonus?: number;
  critBonus?: number;
  lootLuck?: number;
  xpBonus?: number;
  coinBonus?: number;
}

export interface GearItem {
  id: string;
  name: string;
  slot: GearSlot;
  rarity: string;
  modifiers: Partial<Attributes>;
  affixes: string[];
  /** 战斗词条：进入 battle-v5 的加成（与属性词条并行） */
  combat?: GearCombatBonus;
  value: number;
  /** 稀有度阶级（0..6，对应白-绿-蓝-紫-黄-橙-红） */
  tier?: number;
  /** 阶级配色（hex） */
  tierColor?: string;
  /** 阶级中文名（白/绿/…） */
  rarityName?: string;
}

/**
 * 制造词缀池（v1.0.2）：与掉落装备同规则 —— 词条只加特殊属性（生命/暴击/搜刮/经验/金币），
 * 不加六维；装备的六维来自配方 baseModifiers（灰字基础属性）。
 */
interface GearAffix {
  id: string;
  name: string;
  desc: string;
  weight: number;
  combat: GearCombatBonus;
}

const GEAR_AFFIXES: GearAffix[] = [
  { id: 'hp-boost', name: '强化装甲', desc: '生命值 +{n}', weight: 12, combat: { hpBonus: 18 } },
  { id: 'crit-boost', name: '致命一击', desc: '暴击率 +{n}%', weight: 9, combat: { critBonus: 0.03 } },
  { id: 'scav-sense', name: '搜刮直觉', desc: '搜刮运势 +{n}%', weight: 8, combat: { lootLuck: 0.08 } },
  { id: 'coin-sense', name: '拾荒嗅觉', desc: '金币获取 +{n}%', weight: 9, combat: { coinBonus: 0.1 } },
  { id: 'xp-boost', name: '实战淬炼', desc: '经验获取 +{n}%', weight: 7, combat: { xpBonus: 0.1 } },
  { id: 'titan-plating', name: '泰坦装甲', desc: '生命值 +{n}', weight: 5, combat: { hpBonus: 40 } },
];

/** 按倍率缩放特殊属性词条 */
function scaleGearCombat(c: GearCombatBonus, mag: number): GearCombatBonus {
  const out: GearCombatBonus = {};
  if (c.hpBonus) out.hpBonus = Math.round(c.hpBonus * mag);
  if (c.critBonus) out.critBonus = Number((c.critBonus * mag).toFixed(3));
  if (c.lootLuck) out.lootLuck = Number((c.lootLuck * mag).toFixed(3));
  if (c.xpBonus) out.xpBonus = Number((c.xpBonus * mag).toFixed(3));
  if (c.coinBonus) out.coinBonus = Number((c.coinBonus * mag).toFixed(3));
  return out;
}

export interface CraftRecipe {
  id: string;
  name: string;
  slot: GearSlot;
  costMaterials: { kind: MaterialKind; qty: number }[];
  costCoins: number;
  baseModifiers: Partial<Attributes>;
  affixCount: number;
  rarity: string;
}

export const RECIPES: CraftRecipe[] = [
  {
    id: 'recipe-armor',
    name: '拼装护甲',
    slot: 'armor',
    costMaterials: [{ kind: 'metal', qty: 3 }],
    costCoins: 20,
    baseModifiers: { endurance: 3 },
    affixCount: 1,
    rarity: '精锐',
  },
  {
    id: 'recipe-weapon',
    name: '改装步枪',
    slot: 'weapon',
    costMaterials: [
      { kind: 'metal', qty: 2 },
      { kind: 'electronics', qty: 1 },
    ],
    costCoins: 35,
    baseModifiers: { strength: 4, spirit: 2 },
    affixCount: 2,
    rarity: '精锐',
  },
  {
    id: 'recipe-accessory',
    name: '外骨骼配件',
    slot: 'accessory',
    costMaterials: [
      { kind: 'electronics', qty: 2 },
      { kind: 'chems', qty: 1 },
    ],
    costCoins: 30,
    baseModifiers: { speed: 3, willpower: 2 },
    affixCount: 1,
    rarity: '精英',
  },
];

// ===== 避难所设施 =====

export interface ShelterFacilitySpec {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  /** 每级升级所需废土币（index = 当前等级，0 表示尚未建造） */
  upgradeCost: number[];
  /** 每级提供的 loot 运势加成（百分点） */
  lootPerLevel: number;
  /** 每级提供的出击初始 HP 加成（绝对点数） */
  hpPerLevel: number;
  /** 每级提供的改装折扣（0~1，按材料/币比例） */
  discountPerLevel: number;
  /** 每级提供的恢复速率加成（百分点） */
  recoveryPerLevel: number;
  /** 每级提供的属性加成（叠加到出击者） */
  attrPerLevel: Partial<Attributes>;
}

export const SHELTER_FACILITIES: ShelterFacilitySpec[] = [
  {
    id: 'watchtower',
    name: '瞭望塔',
    description: '提前侦察，提升搜刮运势。',
    maxLevel: 5,
    upgradeCost: [200, 400, 700, 1100, 1600],
    lootPerLevel: 0.08,
    hpPerLevel: 0,
    discountPerLevel: 0,
    recoveryPerLevel: 0,
    attrPerLevel: {},
  },
  {
    id: 'medbay',
    name: '医疗站',
    description: '驻防整备，提升初始生命与恢复速率。',
    maxLevel: 5,
    upgradeCost: [250, 500, 800, 1200, 1700],
    lootPerLevel: 0,
    hpPerLevel: 0,
    discountPerLevel: 0,
    recoveryPerLevel: 0.2, // 单一来源：医疗站恢复加成只走 recoveryBonus（Lv5 = +100%，即 ×2，翻倍恢复）；原先另有硬编码 1+0.5×级 已移除
    attrPerLevel: {},
  },
  {
    id: 'workshop',
    name: '改装工坊',
    description: '制造改装更便宜。',
    maxLevel: 5,
    upgradeCost: [300, 550, 900, 1300, 1800],
    lootPerLevel: 0,
    hpPerLevel: 0,
    discountPerLevel: 0.1,
    recoveryPerLevel: 0,
    attrPerLevel: {},
  },
  {
    id: 'gym',
    name: '训练场',
    description: '日常操练，出击者属性微增。',
    maxLevel: 5,
    upgradeCost: [275, 525, 850, 1250, 1750],
    lootPerLevel: 0,
    hpPerLevel: 0,
    discountPerLevel: 0,
    recoveryPerLevel: 0,
    attrPerLevel: { vitality: 1, strength: 1, spirit: 1, endurance: 1, speed: 1, willpower: 1 },
  },
  {
    id: 'garden',
    name: '避难所菜园',
    description: '种植草药/口粮，定期收成换医疗品。',
    maxLevel: 5,
    upgradeCost: [150, 350, 600, 1000, 1500],
    lootPerLevel: 0,
    hpPerLevel: 0,
    discountPerLevel: 0,
    recoveryPerLevel: 0,
    attrPerLevel: {},
  },
];

// ===== 势力 / 战团 =====

export interface FactionSpec {
  id: string;
  name: string;
  description: string;
  /** 每级声望提供全队属性加成 */
  attrPerRepLevel: Partial<Attributes>;
}

export const FACTIONS: FactionSpec[] = [
  {
    id: 'iron-wall',
    name: '铁壁战团',
    description: '重装 survivors，崇尚硬碰硬。',
    attrPerRepLevel: { strength: 1, vitality: 1 },
  },
  {
    id: 'silver-hand',
    name: '银手商会',
    description: '掌控废土贸易，富甲一方。',
    attrPerRepLevel: { willpower: 1, endurance: 1 },
  },
  {
    id: 'free-scouts',
    name: '自由侦察兵',
    description: '机动灵活，消息灵通。',
    attrPerRepLevel: { speed: 1, spirit: 1 },
  },
];

export interface ShelterBonuses {
  lootLuck: number;
  startHpBonus: number;
  craftDiscount: number;
  recoveryBonus: number;
  attrBonus: Attributes;
  factionAttrBonus: Attributes;
}

export function computeShelterBonuses(
  facilities: Record<string, number>,
  factionRep: Record<string, number>,
): ShelterBonuses {
  const attrBonus = {
    vitality: 0,
    strength: 0,
    spirit: 0,
    endurance: 0,
    speed: 0,
    willpower: 0,
  } as Attributes;
  const factionAttrBonus = { ...attrBonus };
  let lootLuck = 0;
  let startHpBonus = 0;
  let craftDiscount = 0;
  let recoveryBonus = 0;

  for (const f of SHELTER_FACILITIES) {
    const lvl = facilities[f.id] ?? 0;
    if (lvl <= 0) continue;
    lootLuck += f.lootPerLevel * lvl;
    startHpBonus += f.hpPerLevel * lvl;
    craftDiscount += f.discountPerLevel * lvl;
    recoveryBonus += f.recoveryPerLevel * lvl;
    for (const k of Object.keys(f.attrPerLevel) as (keyof Attributes)[]) {
      attrBonus[k] += (f.attrPerLevel[k] ?? 0) * lvl;
    }
  }
  for (const fac of FACTIONS) {
    const rep = factionRep[fac.id] ?? 0;
    if (rep <= 0) continue;
    for (const k of Object.keys(fac.attrPerRepLevel) as (keyof Attributes)[]) {
      factionAttrBonus[k] += (fac.attrPerRepLevel[k] ?? 0) * rep;
    }
  }

  return { lootLuck, startHpBonus, craftDiscount, recoveryBonus, attrBonus, factionAttrBonus };
}

let _gearId = 0;
function nextGearId(): string {
  _gearId += 1;
  return `gear-${Date.now().toString(36)}-${_gearId}`;
}

/**
 * 按配方制造一件装备。纯函数，rng 决定随机词缀。
 * 调用方需先确认材料/币充足（见 canCraft）。
 */
export function rollGear(rng: RNG, recipe: CraftRecipe): GearItem {
  const modifiers: Partial<Attributes> = { ...recipe.baseModifiers };
  const affixes: string[] = [];
  const combat: GearCombatBonus = {};
  const chosen = pickN(rng, GEAR_AFFIXES, recipe.affixCount);
  for (const a of chosen) {
    const magnitude = randInt(rng, 1, 4) + (recipe.rarity === '精英' ? 1 : 0);
    const c = scaleGearCombat(a.combat, magnitude / 2);
    // 展示文本（与掉落装备同风格：生命值整数，其余按百分数取整）
    const parts: string[] = [];
    if (c.hpBonus) parts.push(`生命值 +${c.hpBonus}`);
    if (c.critBonus) parts.push(`暴击率 +${Math.round(c.critBonus * 100)}%`);
    if (c.lootLuck) parts.push(`搜刮运势 +${Math.round(c.lootLuck * 100)}%`);
    if (c.xpBonus) parts.push(`经验获取 +${Math.round(c.xpBonus * 100)}%`);
    if (c.coinBonus) parts.push(`金币获取 +${Math.round(c.coinBonus * 100)}%`);
    if (parts.length > 0) affixes.push(parts.join('/'));
    combat.hpBonus = (combat.hpBonus ?? 0) + (c.hpBonus ?? 0);
    combat.critBonus = Number(((combat.critBonus ?? 0) + (c.critBonus ?? 0)).toFixed(3));
    combat.lootLuck = Number(((combat.lootLuck ?? 0) + (c.lootLuck ?? 0)).toFixed(3));
    combat.xpBonus = Number(((combat.xpBonus ?? 0) + (c.xpBonus ?? 0)).toFixed(3));
    combat.coinBonus = Number(((combat.coinBonus ?? 0) + (c.coinBonus ?? 0)).toFixed(3));
  }
  // 取整
  const rounded: Partial<Attributes> = {};
  for (const k of Object.keys(modifiers) as (keyof Attributes)[]) {
    rounded[k] = Math.round(modifiers[k] ?? 0);
  }
  const value = Math.round(
    recipe.costCoins +
      recipe.affixCount * 15 +
      Object.values(rounded).reduce((s, v) => s + (v ?? 0), 0) * 2 +
      (combat.hpBonus ?? 0) * 2 +
      (combat.critBonus ?? 0) * 200,
  );
  return {
    id: nextGearId(),
    name: recipe.name,
    slot: recipe.slot,
    rarity: recipe.rarity,
    modifiers: rounded,
    affixes,
    combat: Object.keys(combat).length ? combat : undefined,
    value,
  };
}

export function materialCount(
  materials: MaterialItem[],
  kind: MaterialKind,
): number {
  return materials
    .filter((m) => m.kind === kind)
    .reduce((s, m) => s + m.quantity, 0);
}
