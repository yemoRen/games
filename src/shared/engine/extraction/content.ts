/**
 * Phase 1 — Demo 内容资产（最小可玩 Demo 用）
 *
 * 这些都是「内容数据」，不是引擎逻辑。后续接入真实游戏时，从 DB / 配置表读取即可，
 * 引擎代码（ExtractionEngine.ts）不依赖这里的任何具体数值。
 *
 * 注：装备掉落由 ExtrationEngine.search 的 rollGearDrop 动态生成（带阶级词缀，
 * 阶级随区域危险度提升），因此 lootTable 主要承载材料/消耗品，gear 偶发点缀即可。
 */

import type {
  DangerZone,
  EnemyArchetype,
  LootItem,
  SurvivorLoadout,
} from './types';

const attr = (
  vitality: number,
  strength: number,
  spirit: number,
  endurance: number,
  speed: number,
  willpower: number,
) => ({ vitality, strength, spirit, endurance, speed, willpower });

/** 幸存者预设（对应原「凝气成形」随机角色，这里给几个手设档位做 Demo） */
export const SURVIVOR_PRESETS: SurvivorLoadout[] = [
  { name: '老兵·老周', attributes: attr(12, 14, 6, 11, 9, 8) },
  { name: '飞毛腿·阿速', attributes: attr(8, 9, 7, 7, 16, 9) },
  { name: '拾荒妹·小满', attributes: attr(10, 8, 12, 9, 11, 13) },
];

/** 战利品池片段 */
const LOOT: Record<string, LootItem> = {
  scrap: { id: 'scrap', name: '废金属', kind: 'material', value: 5 },
  meds: { id: 'meds', name: '绷带', kind: 'consumable', value: 12 },
  can: { id: 'can', name: '罐头', kind: 'consumable', value: 8 },
  ammo: { id: 'ammo', name: '弹药', kind: 'material', value: 10 },
  parts: { id: 'parts', name: '电子零件', kind: 'material', value: 18 },
  gear: { id: 'gear', name: '防弹背心', kind: 'gear', value: 45 },
  credits: { id: 'credits', name: '废土币', kind: 'currency', value: 25 },
  serum: { id: 'serum', name: '抗辐射血清', kind: 'consumable', value: 30 },
  battery: { id: 'battery', name: '高能电池', kind: 'material', value: 22 },
  alloy: { id: 'alloy', name: '军用合金', kind: 'material', value: 35 },
  coolant: { id: 'coolant', name: '冷却剂', kind: 'consumable', value: 16 },
  medkit: { id: 'medkit', name: '急救包', kind: 'consumable', value: 40 },
  blueprint: { id: 'blueprint', name: '科技蓝图', kind: 'material', value: 60 },
};

/** 敌人原型（对应原 enemy-generation 产出的敌人；Demo 用手设档位）
 *  调参原则：低危区敌人明显偏弱（可正面击退），高危区（尤其 boss）致命，
 *  以此形成「风险/回报」梯度——这正是搜打撤的核心张力。 */
const ENEMIES: Record<string, EnemyArchetype> = {
  zombie: {
    id: 'zombie',
    name: '游荡尸群',
    attributes: attr(6, 7, 2, 5, 4, 3),
    threatNote: '数量多但迟钝，靠力量碾压',
  },
  mutant: {
    id: 'mutant',
    name: '变种犬',
    attributes: attr(5, 6, 3, 5, 12, 4),
    threatNote: '高敏捷，先手凶猛',
  },
  raider: {
    id: 'raider',
    name: '掠夺者',
    attributes: attr(8, 9, 6, 8, 8, 7),
    threatNote: '装备精良，均衡而危险',
  },
  drone: {
    id: 'drone',
    name: '作战无人机',
    attributes: attr(4, 8, 12, 5, 10, 6),
    threatNote: '远程火力压制，感知极强',
  },
  brute: {
    id: 'brute',
    name: '重装暴徒',
    attributes: attr(12, 12, 3, 14, 4, 6),
    threatNote: '血厚甲硬，缠斗消耗极大',
  },
  sniper: {
    id: 'sniper',
    name: '废土狙击手',
    attributes: attr(6, 10, 14, 6, 9, 8),
    threatNote: '一击致命，暴击极高',
  },
  scavenger: {
    id: 'scavenger',
    name: '流窜拾荒客',
    attributes: attr(7, 7, 7, 7, 9, 8),
    threatNote: '灵活难缠，抢了就跑',
  },
  boss: {
    id: 'boss',
    name: '变异巨兽',
    attributes: attr(20, 18, 6, 16, 7, 8),
    threatNote: '区域霸主，建议绕行或组队',
    boss: true,
  },
  warlord: {
    id: 'warlord',
    name: '战争领主',
    attributes: attr(22, 22, 16, 18, 12, 14),
    threatNote: '禁区统治者，词缀叠加后堪称死神',
    boss: true,
  },
};

/** 危险区域（对应原「秘境」）。危险度 1..6，越高产出越豪华、敌人词缀越狠。 */
export const DANGER_ZONES: DangerZone[] = [
  {
    id: 'apartment',
    name: '废弃公寓',
    dangerLevel: 1,
    flavor: '坍塌的居民楼，物资不多但相对安全。',
    lootTable: [LOOT.scrap, LOOT.can, LOOT.meds, LOOT.credits],
    enemies: [ENEMIES.zombie],
    extractTimeSec: 90,
  },
  {
    id: 'hospital',
    name: '废弃医院',
    dangerLevel: 2,
    flavor: '药品与血清的宝库，但尸群盘踞。',
    lootTable: [LOOT.meds, LOOT.serum, LOOT.ammo, LOOT.credits],
    enemies: [ENEMIES.zombie, ENEMIES.mutant],
    extractTimeSec: 120,
  },
  {
    id: 'outskirts',
    name: '城郊废墟',
    dangerLevel: 3,
    flavor: '流浪者据点，掠夺者与拾荒客出没。',
    lootTable: [LOOT.scrap, LOOT.ammo, LOOT.can, LOOT.credits, LOOT.meds],
    enemies: [ENEMIES.raider, ENEMIES.scavenger, ENEMIES.mutant],
    extractTimeSec: 135,
  },
  {
    id: 'military',
    name: '军事检查站',
    dangerLevel: 3,
    flavor: '军械与防具，掠夺者重兵把守。',
    lootTable: [LOOT.gear, LOOT.ammo, LOOT.parts, LOOT.credits],
    enemies: [ENEMIES.raider, ENEMIES.drone, ENEMIES.mutant],
    extractTimeSec: 150,
  },
  {
    id: 'subway',
    name: '地铁隧道',
    dangerLevel: 4,
    flavor: '幽暗迷宫，重装暴徒与变异生物伏击。',
    lootTable: [LOOT.parts, LOOT.battery, LOOT.meds, LOOT.credits, LOOT.coolant],
    enemies: [ENEMIES.brute, ENEMIES.mutant, ENEMIES.zombie],
    extractTimeSec: 180,
  },
  {
    id: 'research',
    name: '地下研究所',
    dangerLevel: 5,
    flavor: '高危区，传说有变异巨兽与顶级科技。',
    lootTable: [LOOT.serum, LOOT.parts, LOOT.gear, LOOT.credits, LOOT.blueprint],
    enemies: [ENEMIES.raider, ENEMIES.boss, ENEMIES.drone],
    extractTimeSec: 240,
  },
  {
    id: 'nuclear',
    name: '核爆禁区',
    dangerLevel: 6,
    flavor: '废土尽头，战争领主坐镇，掉宝最丰也最致命。',
    lootTable: [LOOT.alloy, LOOT.blueprint, LOOT.gear, LOOT.credits, LOOT.medkit],
    enemies: [ENEMIES.warlord, ENEMIES.brute, ENEMIES.drone, ENEMIES.mutant],
    extractTimeSec: 300,
  },
];

export function getZone(id: string): DangerZone {
  const zone = DANGER_ZONES.find((z) => z.id === id);
  if (!zone) throw new Error(`未知危险区域: ${id}`);
  return zone;
}
