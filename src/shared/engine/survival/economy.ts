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

export type GearSlot = 'weapon' | 'armor' | 'accessory';

export const GEAR_SLOT_LABEL: Record<GearSlot, string> = {
  weapon: '武器',
  armor: '护甲',
  accessory: '配件',
};

export interface GearCombatBonus {
  hpBonus?: number;
  critBonus?: number;
  lootLuck?: number;
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

interface GearAffix {
  id: string;
  name: string;
  modifiers: Partial<Attributes>;
  /** 描述模板，{n} 会被数值替换 */
  desc: string;
  weight: number;
}

const GEAR_AFFIXES: GearAffix[] = [
  { id: 'kevlar', name: '凯夫拉衬层', modifiers: { endurance: 4 }, desc: '耐力 +{n}', weight: 10 },
  { id: 'power-core', name: '动力核心', modifiers: { strength: 4 }, desc: '力量 +{n}', weight: 10 },
  { id: 'reflex', name: '反射神经', modifiers: { speed: 4 }, desc: '敏捷 +{n}', weight: 10 },
  { id: 'optics', name: '瞄准镜组', modifiers: { spirit: 4 }, desc: '感知 +{n}', weight: 10 },
  { id: 'vitality-boost', name: '强韧骨架', modifiers: { vitality: 4 }, desc: '体质 +{n}', weight: 10 },
  { id: 'focus', name: '镇定剂', modifiers: { willpower: 4 }, desc: '意志 +{n}', weight: 10 },
  { id: 'titan', name: '泰坦合金', modifiers: { endurance: 3, vitality: 2 }, desc: '耐力 +{n}/体质 +2', weight: 5 },
  { id: 'sharpened', name: '开刃处理', modifiers: { strength: 3, speed: 1 }, desc: '力量 +{n}/敏捷 +1', weight: 5 },
  { id: 'scout', name: '侦察模块', modifiers: { spirit: 3, speed: 2 }, desc: '感知 +{n}/敏捷 +2', weight: 5 },
];

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
    upgradeCost: [40, 80, 140, 220, 320],
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
    upgradeCost: [50, 100, 160, 240, 340],
    lootPerLevel: 0,
    hpPerLevel: 12,
    discountPerLevel: 0,
    recoveryPerLevel: 0.5,
    attrPerLevel: {},
  },
  {
    id: 'workshop',
    name: '改装工坊',
    description: '制造改装更便宜。',
    maxLevel: 5,
    upgradeCost: [60, 110, 180, 260, 360],
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
    upgradeCost: [55, 105, 170, 250, 350],
    lootPerLevel: 0,
    hpPerLevel: 0,
    discountPerLevel: 0,
    recoveryPerLevel: 0,
    attrPerLevel: { vitality: 1, strength: 1 },
  },
  {
    id: 'garden',
    name: '避难所菜园',
    description: '种植草药/口粮，定期收成换医疗品。',
    maxLevel: 5,
    upgradeCost: [30, 70, 120, 200, 300],
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
    attrPerRepLevel: { endurance: 1, vitality: 1 },
  },
  {
    id: 'silver-hand',
    name: '银手商会',
    description: '掌控废土贸易，富甲一方。',
    attrPerRepLevel: { willpower: 1, spirit: 1 },
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
  const chosen = pickN(rng, GEAR_AFFIXES, recipe.affixCount);
  for (const a of chosen) {
    const magnitude = randInt(rng, 1, 4) + (recipe.rarity === '精英' ? 1 : 0);
    affixes.push(a.desc.replace('{n}', String(magnitude)));
    for (const k of Object.keys(a.modifiers) as (keyof Attributes)[]) {
      modifiers[k] = (modifiers[k] ?? 0) + (a.modifiers[k] ?? 0) * (magnitude / 4);
    }
  }
  // 取整
  const rounded: Partial<Attributes> = {};
  for (const k of Object.keys(modifiers) as (keyof Attributes)[]) {
    rounded[k] = Math.round(modifiers[k] ?? 0);
  }
  // 战斗词条：半数概率附加一条（气血/暴击/搜刮运势），让「正式装备词条」进入 battle-v5
  const combat: GearCombatBonus = {};
  const combatAffixes: string[] = [];
  if (rng() < 0.5) {
    const roll = randInt(rng, 0, 2);
    const mag = recipe.rarity === '精英' ? 1.5 : 1;
    if (roll === 0) {
      const v = Math.round(randInt(rng, 8, 16) * mag);
      combat.hpBonus = v;
      combatAffixes.push(`气血 +${v}`);
    } else if (roll === 1) {
      const v = Number((0.04 + rng() * 0.04) * mag).toFixed(3);
      combat.critBonus = Number(v);
      combatAffixes.push(`暴击 +${Math.round(Number(v) * 100)}%`);
    } else {
      const v = Number((0.1 * mag).toFixed(2));
      combat.lootLuck = v;
      combatAffixes.push(`搜刮运势 +${Math.round(v * 100)}%`);
    }
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
    affixes: [...affixes, ...combatAffixes],
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
