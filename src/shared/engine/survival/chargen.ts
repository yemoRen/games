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
import type { AffixTierKey } from './affixes';
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
  /** 词条品质（决定着色，白<绿<蓝<紫<黄<橙<红） */
  quality: AffixTierKey;
}

export interface SurvivorProfile {
  id: string;
  name: string;
  origin: string;
  age: number;
  rarity: SurvivorRarity;
  attributes: Attributes;
  /**
   * 初始六维「基础属性」（v1.1.0）：不含词条加成、升级加点、装备/buff 加成。
   * 仅「重塑六维」会改写它；旧存档缺省时由 ensureBaseAttributes 迁移补齐。
   */
  baseAttributes?: Attributes;
  traits: SurvivorTrait[];
  power: number;
  tier: number;
  tierName: string;
  /** 招募时支付的货币价值（遣散时返还 1/3），未招募/主角可为空 */
  recruitValue?: number;
  /** 是否为玩家注册代号生成的主角（不可遣散） */
  isProtagonist?: boolean;
  // ===== 等级 / 经验（v1.0.2，旧存档缺省视为 Lv.1 / 0） =====
  /** 当前等级 */
  level?: number;
  /** 当前经验值（升到 xpNeededForLevel(level) 即升级） */
  xp?: number;
  /** 待分配的自由六维属性点（每级 +3） */
  freePoints?: number;
  /** 升级触发的词条三选一候选（选定后清空） */
  pendingTraitPick?: SurvivorTrait[];
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
    quality: 'green',
    tag: 'scavenger',
  },
  {
    id: 'iron-skin',
    name: '铁布衫',
    description: '皮糙肉厚，挨打更扛。',
    modifiers: { endurance: 4, vitality: 2 },
    combat: { hpBonus: 25 },
    quality: 'blue',
    tag: 'tank',
  },
  {
    id: 'berserker',
    name: '暴烈',
    description: '越是绝境越凶，暴击更狠。',
    modifiers: { strength: 4 },
    combat: { critBonus: 0.18 },
    quality: 'purple',
    tag: 'damage',
  },
  {
    id: 'sprinter',
    name: '飞毛腿',
    description: '跑得快，先手与闪避占优。',
    modifiers: { speed: 4, vitality: 1 },
    combat: { startHpRatio: 0.15 },
    quality: 'green',
    tag: 'agile',
  },
  {
    id: 'field-medic',
    name: '战地医护',
    description: '懂急救，状态更稳。',
    modifiers: { willpower: 3, vitality: 2 },
    combat: { hpBonus: 15 },
    quality: 'blue',
    tag: 'support',
  },
  {
    id: 'marksman',
    name: '神枪手',
    description: '眼力极佳，感知拉满。',
    modifiers: { spirit: 5, willpower: 1 },
    combat: { critBonus: 0.1 },
    quality: 'blue',
    tag: 'ranged',
  },
  {
    id: 'wasteland-born',
    name: '废土之子',
    description: '生于末世，根基扎实。',
    modifiers: { vitality: 3, endurance: 2, speed: 1 },
    quality: 'green',
    tag: 'survivor',
  },
  {
    id: 'ex-soldier',
    name: '退役兵',
    description: '受过正规训练，攻防均衡。',
    modifiers: { strength: 3, endurance: 2, willpower: 2 },
    combat: { critBonus: 0.05 },
    quality: 'green',
    tag: 'soldier',
  },
  {
    id: 'scav-lord',
    name: '囤积癖',
    description: '见啥都顺手牵羊。',
    modifiers: { spirit: 2, speed: 2 },
    combat: { lootLuck: 0.15 },
    quality: 'green',
    tag: 'hoarder',
  },
  {
    id: 'iron-will',
    name: '钢铁意志',
    description: '心志如铁，精神抗性高。',
    modifiers: { willpower: 5, spirit: 2 },
    quality: 'purple',
    tag: 'mental',
  },
  {
    id: 'big-eater',
    name: '大胃王',
    description: '吃得多长得壮，气血厚。',
    modifiers: { vitality: 5 },
    combat: { hpBonus: 20 },
    quality: 'blue',
    tag: 'tank',
  },
  {
    id: 'lucky-devil',
    name: '天选倒霉蛋',
    description: '运气离谱，常有意料之喜。',
    modifiers: { spirit: 1, willpower: 1 },
    combat: { lootLuck: 0.2, critBonus: 0.05 },
    quality: 'purple',
    tag: 'luck',
  },
  {
    id: 'quiet',
    name: '闷葫芦',
    description: '少言寡语，隐蔽性强。',
    modifiers: { speed: 2, willpower: 2 },
    combat: { lootLuck: 0.08 },
    quality: 'green',
    tag: 'stealth',
  },
  {
    id: 'born-leader',
    name: '天生领袖',
    description: '气场强大，队伍核心。',
    modifiers: { willpower: 3, strength: 2 },
    quality: 'blue',
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

// 幸存者姓名：姓 + 名（1~2 字）随机组合，组合空间极大，几乎不会重复
const SURNAMES = [
  '王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴',
  '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗',
  '梁', '宋', '郑', '谢', '韩', '唐', '冯', '于', '董', '萧',
  '程', '曹', '袁', '邓', '许', '傅', '沈', '曾', '彭', '吕',
  '苏', '卢', '蒋', '蔡', '贾', '丁', '魏', '薛', '叶', '阎',
  '余', '潘', '杜', '戴', '夏', '钟', '汪', '田', '任', '姜',
  '范', '方', '石', '姚', '谭', '廖', '邹', '熊', '金', '陆',
  '郝', '孔', '白', '崔', '康', '毛', '邱', '秦', '江', '顾',
  '侯', '邵', '孟', '龙', '万', '段', '钱', '汤', '尹', '黎',
];
const GIVEN_CHARS = [
  '伟', '强', '磊', '军', '勇', '杰', '涛', '明', '超', '平',
  '刚', '志', '建', '国', '海', '山', '峰', '飞', '鹏', '宇',
  '辰', '浩', '轩', '睿', '昊', '泽', '然', '远', '航', '逸',
  '朗', '凯', '瑞', '嘉', '鸿', '翔', '博', '斌', '辉', '耀',
  '震', '虎', '岩', '松', '柏', '枫', '霖', '文', '武', '宁',
  '康', '安', '乐', '福', '德', '才', '俊', '彦', '哲', '思',
  '云', '川', '石', '铁', '锋', '钢', '龙', '狼', '鹰', '雷',
  '炎', '寒', '漠', '霜', '岩', '峰', '岩', '虎', '山', '河',
];

function randomName(rng: RNG): string {
  const surname = pick(rng, SURNAMES);
  // 1 字名或 2 字名各半，2 字名不重复取字
  const len = randInt(rng, 1, 2);
  const given: string[] = [];
  let guard = 0;
  while (given.length < len && guard++ < 20) {
    const c = pick(rng, GIVEN_CHARS);
    if (!given.includes(c)) given.push(c);
  }
  return surname + given.join('');
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
  // v1.1.0：rolled = 初始基础属性（词条加成前），持久化到 baseAttributes 供「重塑六维」使用
  const rolled = emptyAttributes();
  for (const k of ALL_ATTR_KEYS) {
    rolled[k] = randInt(rng, 6, 15) + info.attrBonus;
  }
  const base: Attributes = { ...rolled };

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
    baseAttributes: rolled,
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
  quality: 'purple',
};

/** 按 id 取词条池中的词条（升级三选一 / 主角固定天赋等场景复用） */
export function traitById(id: string): SurvivorTrait {
  const t = TRAIT_POOL.find((x) => x.id === id);
  if (!t) throw new Error(`未知词条: ${id}`);
  return t;
}

export const PROTAGONIST_BASE_ATTR = 15;

/**
 * v1.0.10：创建主角时已移除的附加词条（退役兵 / 战地医护）。
 * 旧存档读取时据此从主角身上剥离，避免历史角色仍带着两条额外天赋。
 * 注意：仅作用于主角（isProtagonist），普通幸存者随机到这些词条不受影响。
 */
export const DEPRECATED_PROTAGONIST_TRAIT_IDS: readonly string[] = ['ex-soldier', 'field-medic'];

// ===== 升级词条三选一（系统流设定） =====

/** 词条品质抽取权重（白/绿常见，紫稀有，橙红极稀有——当前池仅到紫，高档位预留给未来新词条） */
const TRAIT_PICK_WEIGHT: Record<string, number> = {
  white: 8,
  green: 6,
  blue: 3.5,
  purple: 1.5,
  yellow: 0.8,
  orange: 0.3,
  red: 0.1,
};

/**
 * 生成升级词条候选（三选一）：
 *  - 排除角色已拥有的词条 id；
 *  - 按品质权重随机（绿 > 蓝 > 紫），品质越稀有权重越低；
 *  - 候选之间不重复；池不足时返回实际可提供的数量。
 */
export function rollTraitCandidates(rng: RNG, excludeIds: string[] = [], count = 3): SurvivorTrait[] {
  const remaining = TRAIT_POOL.filter((t) => !excludeIds.includes(t.id));
  const picked: SurvivorTrait[] = [];
  while (picked.length < count && remaining.length > 0) {
    const t = weightedPick(
      rng,
      remaining.map((x) => ({ value: x, weight: TRAIT_PICK_WEIGHT[x.quality] ?? 1 })),
    );
    picked.push(t);
    remaining.splice(remaining.indexOf(t), 1);
  }
  return picked;
}

export function makeProtagonist(name: string): SurvivorProfile {
  // v1.1.0：baseAttributes 记录「词条加成前」的初始基础属性（主角全 15）
  const baseAttributes = emptyAttributes();
  for (const k of ALL_ATTR_KEYS) baseAttributes[k] = PROTAGONIST_BASE_ATTR;
  const attributes: Attributes = { ...baseAttributes };
  // v1.0.10：主角只保留「末世主角」一条身份词条，不再附带退役兵 / 战地医护
  const traits = [PROTAGONIST_TRAIT];
  for (const t of traits) {
    for (const k of ALL_ATTR_KEYS) {
      const delta = (t.modifiers as Record<string, number | undefined>)[k];
      if (delta) attributes[k] += delta;
    }
  }
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
    baseAttributes,
    traits,
    power,
    tier,
    tierName,
    recruitValue: 0,
    isProtagonist: true,
  };
}

/** 词条六维加成合计（用于从「当前属性」反推初始基础属性） */
export function traitModifierSum(traits: SurvivorTrait[]): Attributes {
  const sum = emptyAttributes();
  for (const t of traits ?? []) {
    for (const k of ALL_ATTR_KEYS) {
      const d = (t.modifiers as Record<string, number | undefined>)[k];
      if (d) sum[k] += d;
    }
  }
  return sum;
}

/**
 * 补齐 baseAttributes（v1.1.0 迁移用）。
 * 旧存档没有该字段时，以「当前属性 − 词条加成」回填；
 * 若该成员已有升级加点，这部分会被算进 base（一次性近似，重随时会一并重掷）。
 */
export function ensureBaseAttributes(p: SurvivorProfile): SurvivorProfile {
  if (p.baseAttributes) return p;
  const tm = traitModifierSum(p.traits ?? []);
  const base = emptyAttributes();
  for (const k of ALL_ATTR_KEYS) {
    base[k] = (p.attributes?.[k] ?? 0) - tm[k];
  }
  return { ...p, baseAttributes: base };
}
