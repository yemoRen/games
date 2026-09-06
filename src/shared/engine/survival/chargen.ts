/*
 * chargen.ts — Phase 2 数值重构：幸存者随机生成（属性 + 词条）。
 *
 * 设计原则（呼应原游戏「随机生成属性词条」）：
 *  - 六维基础属性随机生成（引擎消费 Attributes，键名与 battle-v5 完全一致）。
 *  - 按稀有度抽取 1~3 条「词条 / Trait」，词条可改属性、给战斗增益、带风味描述。
 *  - 由属性+词条推导「战力」与「段位」，构成数值骨架。
 *  - 全程由 RNG 驱动，同种子可复现（便于测试与平衡）。
 */
import type { Attributes } from '@shared/types/cultivator';
import {
  type RNG,
  emptyAttributes,
  pick,
  pickN,
  randInt,
  weightedPick,
} from './rng';

export type SurvivorRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface SurvivorTrait {
  id: string;
  name: string;
  description: string;
  /** 属性增量（叠加进基础属性） */
  modifiers: Partial<Attributes>;
  /** 战斗增益（在搜打撤中生效） */
  combat?: {
    hpBonus?: number;
    critBonus?: number;
    lootLuck?: number;
    startHpRatio?: number;
  };
  tag: string;
}

export interface SurvivorProfile {
  id: string;
  name: string;
  origin: string;
  age: number;
  rarity: SurvivorRarity;
  attributes: Attributes;
  traits: SurvivorTrait[];
  power: number;
  tier: number;
  tierName: string;
  /** 招募时支付的货币价值（遣散时返还 1/3），未招募/主角可为空 */
  recruitValue?: number;
  /** 是否为玩家注册代号生成的主角（不可遣散） */
  isProtagonist?: boolean;
}

const ATTR_LABEL: Record<keyof Attributes, string> = {
  vitality: '体质',
  strength: '力量',
  spirit: '感知',
  endurance: '耐力',
  speed: '敏捷',
  willpower: '意志',
};

export function attrLabel(key: keyof Attributes): string {
  return ATTR_LABEL[key];
}

export const ALL_ATTR_KEYS: (keyof Attributes)[] = [
  'vitality',
  'strength',
  'spirit',
  'endurance',
  'speed',
  'willpower',
];

const RARITY_INFO: Record<
  SurvivorRarity,
  { label: string; weight: number; attrBonus: number; traitCount: number; color: string }
> = {
  common: { label: '普通', weight: 60, attrBonus: 0, traitCount: 1, color: '#9ca3af' },
  rare: { label: '精锐', weight: 28, attrBonus: 3, traitCount: 2, color: '#38bdf8' },
  epic: { label: '精英', weight: 10, attrBonus: 6, traitCount: 2, color: '#c084fc' },
  legendary: { label: '传奇', weight: 2, attrBonus: 10, traitCount: 3, color: '#fbbf24' },
};

export function rarityColor(r: SurvivorRarity): string {
  return RARITY_INFO[r].color;
}

export function rarityLabel(r: SurvivorRarity): string {
  return RARITY_INFO[r].label;
}

/** 词条池：废土风味，覆盖属性、生存、搜刮等维度 */
const TRAIT_POOL: SurvivorTrait[] = [
  {
    id: 'scavenger',
    name: '拾荒本能',
    description: '废墟中总能翻到好东西，搜刮收益更高。',
    modifiers: { speed: 2, spirit: 1 },
    combat: { lootLuck: 0.25 },
    tag: 'scavenger',
  },
  {
    id: 'iron-skin',
    name: '铁布衫',
    description: '皮糙肉厚，挨打更扛。',
    modifiers: { endurance: 4, vitality: 2 },
    combat: { hpBonus: 25 },
    tag: 'tank',
  },
  {
    id: 'berserker',
    name: '暴烈',
    description: '越是绝境越凶，暴击更狠。',
    modifiers: { strength: 4 },
    combat: { critBonus: 0.18 },
    tag: 'damage',
  },
  {
    id: 'sprinter',
    name: '飞毛腿',
    description: '跑得快，先手与闪避占优。',
    modifiers: { speed: 4, vitality: 1 },
    combat: { startHpRatio: 0.15 },
    tag: 'agile',
  },
  {
    id: 'field-medic',
    name: '战地医护',
    description: '懂急救，状态更稳。',
    modifiers: { willpower: 3, vitality: 2 },
    combat: { hpBonus: 15 },
    tag: 'support',
  },
  {
    id: 'marksman',
    name: '神枪手',
    description: '眼力极佳，感知拉满。',
    modifiers: { spirit: 5, willpower: 1 },
    combat: { critBonus: 0.1 },
    tag: 'ranged',
  },
  {
    id: 'wasteland-born',
    name: '废土之子',
    description: '生于末世，根基扎实。',
    modifiers: { vitality: 3, endurance: 2, speed: 1 },
    tag: 'survivor',
  },
  {
    id: 'ex-soldier',
    name: '退役兵',
    description: '受过正规训练，攻防均衡。',
    modifiers: { strength: 3, endurance: 2, willpower: 2 },
    combat: { critBonus: 0.05 },
    tag: 'soldier',
  },
  {
    id: 'scav-lord',
    name: '囤积癖',
    description: '见啥都顺手牵羊。',
    modifiers: { spirit: 2, speed: 2 },
    combat: { lootLuck: 0.15 },
    tag: 'hoarder',
  },
  {
    id: 'iron-will',
    name: '钢铁意志',
    description: '心志如铁，精神抗性高。',
    modifiers: { willpower: 5, spirit: 2 },
    tag: 'mental',
  },
  {
    id: 'big-eater',
    name: '大胃王',
    description: '吃得多长得壮，气血厚。',
    modifiers: { vitality: 5 },
    combat: { hpBonus: 20 },
    tag: 'tank',
  },
  {
    id: 'lucky-devil',
    name: '天选倒霉蛋',
    description: '运气离谱，常有意料之喜。',
    modifiers: { spirit: 1, willpower: 1 },
    combat: { lootLuck: 0.2, critBonus: 0.05 },
    tag: 'luck',
  },
  {
    id: 'quiet',
    name: '闷葫芦',
    description: '少言寡语，隐蔽性强。',
    modifiers: { speed: 2, willpower: 2 },
    combat: { lootLuck: 0.08 },
    tag: 'stealth',
  },
  {
    id: 'born-leader',
    name: '天生领袖',
    description: '气场强大，队伍核心。',
    modifiers: { willpower: 3, strength: 2 },
    tag: 'leader',
  },
];

const ORIGINS = [
  '旧城贫民窟',
  '军用撤离点',
  '地下实验室',
  '公路驿站',
  '废墟商圈',
  '北方壁垒',
  '沼泽聚落',
  '天台棚户',
  '遗弃矿区',
  '沿海船坞',
];

const NAME_PREFIX = [
  '老',
  '小',
  '阿',
  '大',
  '疯',
  '独眼',
  '瘸腿',
  '铁',
  '冷',
  '夜',
  '瘦',
  '胖',
];
const NAME_CORE = [
  '周',
  '陈',
  '林',
  '赵',
  '钱',
  '孙',
  '李',
  '吴',
  '郑',
  '王',
  '雷',
  '岩',
  '刀',
  '枪',
  '狼',
  '鸦',
  '狐',
  '牛',
];
const NAME_SUFFIX = ['', '', '哥', '姐', '叔', '妹', '爷', '仔', '婆', '客'];

function randomName(rng: RNG): string {
  const p = pick(rng, NAME_PREFIX);
  const c = pick(rng, NAME_CORE);
  const s = pick(rng, NAME_SUFFIX);
  return `${p}${c}${s}`;
}

export function computePower(attributes: Attributes): number {
  return Math.round(
    attributes.vitality * 1.2 +
      attributes.strength * 1.0 +
      attributes.spirit * 1.0 +
      attributes.endurance * 1.1 +
      attributes.speed * 0.9 +
      attributes.willpower * 0.8,
  );
}

const TIERS: { min: number; name: string }[] = [
  { min: 0, name: '废土新人' },
  { min: 55, name: '资深拾荒者' },
  { min: 75, name: '战团骨干' },
  { min: 95, name: '钢铁幸存者' },
  { min: 120, name: '末世传奇' },
];

export function tierFromPower(power: number): { tier: number; name: string } {
  let tier = 1;
  let name = TIERS[0].name;
  for (let i = 0; i < TIERS.length; i++) {
    if (power >= TIERS[i].min) {
      tier = i + 1;
      name = TIERS[i].name;
    }
  }
  return { tier, name };
}

let _idCounter = 0;
function nextId(rng: RNG): string {
  _idCounter += 1;
  return `sv-${Date.now().toString(36)}-${_idCounter}-${Math.floor(rng() * 1e6).toString(36)}`;
}

export interface GenerateOptions {
  /** 指定稀有度（用于测试 / 招募定价），不指定则按权重抽取 */
  rarity?: SurvivorRarity;
  /** 固定名字（不指定则随机） */
  name?: string;
}

/**
 * 生成一个幸存者。纯函数：完全由 rng 决定，可复现。
 */
export function generateSurvivor(rng: RNG, opts: GenerateOptions = {}): SurvivorProfile {
  const rarity: SurvivorRarity =
    opts.rarity ??
    weightedPick(
      rng,
      (Object.keys(RARITY_INFO) as SurvivorRarity[]).map((r) => ({
        value: r,
        weight: RARITY_INFO[r].weight,
      })),
    );
  const info = RARITY_INFO[rarity];

  // 1) 基础六维：每维在 6~15 浮动，再加稀有度整体加成
  const base = emptyAttributes();
  for (const k of ALL_ATTR_KEYS) {
    base[k] = randInt(rng, 6, 15) + info.attrBonus;
  }

  // 2) 抽取词条并叠加属性增量
  const traitCount = info.traitCount;
  const traits = pickN(rng, TRAIT_POOL, traitCount);
  for (const t of traits) {
    for (const k of ALL_ATTR_KEYS) {
      const delta = (t.modifiers as Record<string, number | undefined>)[k];
      if (delta) base[k] += delta;
    }
  }

  // 3) 战力 / 段位
  const power = computePower(base);
  const { tier, name: tierName } = tierFromPower(power);

  return {
    id: nextId(rng),
    name: opts.name ?? randomName(rng),
    origin: pick(rng, ORIGINS),
    age: randInt(rng, 17, 58),
    rarity,
    attributes: base,
    traits,
    power,
    tier,
    tierName,
  };
}

/** 词条的战斗增益汇总（供搜打撤引擎使用） */
export function aggregateTraitCombat(traits: SurvivorTrait[]): {
  hpBonus: number;
  critBonus: number;
  lootLuck: number;
  startHpRatio: number;
} {
  const out = { hpBonus: 0, critBonus: 0, lootLuck: 0, startHpRatio: 0 };
  for (const t of traits) {
    if (!t.combat) continue;
    out.hpBonus += t.combat.hpBonus ?? 0;
    out.critBonus += t.combat.critBonus ?? 0;
    out.lootLuck += t.combat.lootLuck ?? 0;
    out.startHpRatio += t.combat.startHpRatio ?? 0;
  }
  return out;
}

/**
 * 主角（以玩家代号命名的首发可培养角色）。
 * 六维「均衡且固定」（每维同基线），不随机、不附带属性词条，
 * 留待后续培养成长。
 */
const PROTAGONIST_TRAIT: SurvivorTrait = {
  id: 'protagonist',
  name: '末世主角',
  description: '避难所名册上的登记者，资质均衡，成长潜力全凭日后培养。',
  modifiers: {},
  tag: 'protagonist',
};

export const PROTAGONIST_BASE_ATTR = 15;

export function makeProtagonist(name: string): SurvivorProfile {
  const attributes = emptyAttributes();
  for (const k of ALL_ATTR_KEYS) attributes[k] = PROTAGONIST_BASE_ATTR;
  const power = computePower(attributes);
  const { tier, name: tierName } = tierFromPower(power);
  return {
    id: `protagonist-${name}`,
    name,
    origin: '避难所登记者',
    age: 25,
    // 紫（精英）品质，资质均衡固定，留待后续培养成长
    rarity: 'epic',
    attributes,
    traits: [PROTAGONIST_TRAIT],
    power,
    tier,
    tierName,
    recruitValue: 0,
    isProtagonist: true,
  };
}

