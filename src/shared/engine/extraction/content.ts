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
  ZoneBranch,
} from './types';
import { MAP_BRANCH_COUNT } from './types';

const attr = (
  vitality: number,
  strength: number,
  spirit: number,
  endurance: number,
  speed: number,
  willpower: number,
) => ({ vitality, strength, spirit, endurance, speed, willpower });

/** 生成一张大地图的分支区域（恰好 MAP_BRANCH_COUNT 个，id 前缀 = mapId） */
function branches(mapId: string, defs: Array<[name: string, flavor: string]>): ZoneBranch[] {
  if (defs.length !== MAP_BRANCH_COUNT) {
    throw new Error(`地图 ${mapId} 分支区域数量必须为 ${MAP_BRANCH_COUNT}，实际 ${defs.length}`);
  }
  return defs.map(([name, flavor], i) => ({ id: `${mapId}-${i}`, name, flavor }));
}

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
  stim: { id: 'stim', name: '兴奋剂', kind: 'consumable', value: 22 },
  nutrient: { id: 'nutrient', name: '营养剂', kind: 'consumable', value: 18 },
  nanogel: { id: 'nanogel', name: '纳米凝胶', kind: 'consumable', value: 60 },
  chempack: { id: 'chempack', name: '化学试剂', kind: 'material', value: 14 },
  ration: { id: 'ration', name: '压缩口粮', kind: 'material', value: 9 },
  // —— 投掷物（快捷·投掷槽来源）——
  grenade: { id: 'grenade', name: '破片手雷', kind: 'consumable', value: 45 },
  smoke: { id: 'smoke', name: '烟雾弹', kind: 'consumable', value: 35 },
  flash: { id: 'flash', name: '闪光弹', kind: 'consumable', value: 30 },
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
  // —— 大地图分支区域专属霸主（第 10 区强制遭遇）——
  landlord: {
    id: 'landlord',
    name: '楼王·腐化房东',
    attributes: attr(10, 11, 3, 9, 5, 5),
    threatNote: '盘踞公寓顶层多年的变异巨物，力量惊人',
    boss: true,
  },
  corpseKing: {
    id: 'corpseKing',
    name: '尸潮之主',
    attributes: attr(13, 12, 5, 11, 6, 6),
    threatNote: '整座医院的尸群都听它号令',
    boss: true,
  },
  scrapKing: {
    id: 'scrapKing',
    name: '拾荒王·铁钩',
    attributes: attr(14, 14, 7, 13, 9, 9),
    threatNote: '废墟帮的开创者，钩爪夺命',
    boss: true,
  },
  overseer: {
    id: 'overseer',
    name: '督战官·灰烬',
    attributes: attr(15, 15, 12, 14, 11, 12),
    threatNote: '末日当天仍未停止执行军令的钢铁之影',
    boss: true,
  },
  hiveMother: {
    id: 'hiveMother',
    name: '隧道巢母',
    attributes: attr(17, 15, 8, 15, 7, 7),
    threatNote: '整条地铁线的变异源头，虫卵铺满洞壁',
    boss: true,
  },
  specimenZero: {
    id: 'specimenZero',
    name: '实验体·零号',
    attributes: attr(20, 18, 10, 16, 8, 9),
    threatNote: '研究所最深处的禁忌造物，逃逸未遂却毁了整层',
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
    bossEnemy: ENEMIES.landlord,
    branches: branches('apartment', [
      ['公寓外围', '塌陷的花园，锈蚀的健身器材在风里吱呀作响。'],
      ['一楼大堂', '信箱倾倒，泛黄的邮件散落一地。'],
      ['二层住户', '户户虚掩，墙上还挂着泛黄的全家福。'],
      ['三层走廊', '地板每走一步都在呻吟，走廊尽头一片漆黑。'],
      ['天台水箱', '水箱早已干涸，从这里能望见半座死城。'],
      ['地下储藏室', '杂物堆积如山，霉味刺鼻，翻找费时但常有遗漏的物资。'],
      ['停车场夹层', '报废车辆挤作一团，偶尔有东西在车底窸窣。'],
      ['楼梯井深处', '手电光只能照出三步远，回声不对劲。'],
      ['顶层复式', '家具尽数掀翻——这里似乎被什么东西长期占据。'],
      ['楼王巢穴', '腐臭扑面。这层楼的"房东"，还没有搬走。'],
    ]),
  },
  {
    id: 'hospital',
    name: '废弃医院',
    dangerLevel: 2,
    flavor: '药品与血清的宝库，但尸群盘踞。',
    lootTable: [LOOT.meds, LOOT.serum, LOOT.stim, LOOT.nutrient, LOOT.chempack, LOOT.ammo, LOOT.credits],
    enemies: [ENEMIES.zombie, ENEMIES.mutant],
    extractTimeSec: 120,
    bossEnemy: ENEMIES.corpseKing,
    branches: branches('hospital', [
      ['门诊大厅', '候诊椅上坐满了"永不叫号"的病人。'],
      ['挂号走廊', '叫号屏还亮着一半，走廊两侧诊室门大开。'],
      ['药房柜台', '铁柜大多被撬开，但总有漏网的好东西。'],
      ['一层急诊', '担架横陈，抢救室的灯还闪着将灭的绿光。'],
      ['住院部一层', '病床排成长龙，帘子后面有动静。'],
      ['手术室区', '无影灯早已熄灭，器械盘里的东西却不是器械。'],
      ['住院部三层', '护理站的白板写着某床"情况稳定"——三天前。'],
      ['血库', '冷藏柜断电已久，血袋在暗处泛着不祥的色泽。'],
      ['院长办公室', '保险柜、遗书与一杯长霉的咖啡。'],
      ['尸潮之心', '整层楼的心跳声同频震动——尸潮之主就在此。'],
    ]),
  },
  {
    id: 'outskirts',
    name: '城郊废墟',
    dangerLevel: 3,
    flavor: '流浪者据点，掠夺者与拾荒客出没。',
    lootTable: [LOOT.scrap, LOOT.ammo, LOOT.can, LOOT.ration, LOOT.credits, LOOT.meds, LOOT.stim],
    enemies: [ENEMIES.raider, ENEMIES.scavenger, ENEMIES.mutant],
    extractTimeSec: 135,
  },
  {
    id: 'military',
    name: '军事检查站',
    dangerLevel: 3,
    flavor: '军械与防具，掠夺者重兵把守。',
    lootTable: [LOOT.gear, LOOT.ammo, LOOT.parts, LOOT.credits, LOOT.grenade],
    enemies: [ENEMIES.raider, ENEMIES.drone, ENEMIES.mutant],
    extractTimeSec: 150,
    bossEnemy: ENEMIES.overseer,
    branches: branches('military', [
      ['外围铁丝网', '锈丝网上挂着旧警报器，钻过时千万别碰响。'],
      ['哨卡岗亭', '沙袋工事后的岗亭里，执勤名单还压在桌上。'],
      ['装甲残骸带', '瘫痪的装甲车队列，炮塔仍指向来路。'],
      ['弹药堆场', '野战弹药箱堆叠如墙——撬开就是硬通货。'],
      ['车库维修间', '液压平台悬着一辆修到一半的运兵车。'],
      ['通讯机房', '无线电台沙沙作响，像是有人在循环呼叫。'],
      ['军官宿舍', '私人储物柜上着锁，里面有比军饷更好的东西。'],
      ['地下军械库', '防爆门半开，枪架上的军用装备近在眼前。'],
      ['指挥掩体', '沙盘上插着末日当天的兵力标记。'],
      ['督战官阵地', '机枪碉堡转动——督战官·灰烬仍在执行最后一条军令。'],
    ]),
  },
  {
    id: 'subway',
    name: '地铁隧道',
    dangerLevel: 4,
    flavor: '幽暗迷宫，重装暴徒与变异生物伏击。',
    lootTable: [LOOT.parts, LOOT.battery, LOOT.meds, LOOT.ration, LOOT.credits, LOOT.coolant, LOOT.nutrient],
    enemies: [ENEMIES.brute, ENEMIES.mutant, ENEMIES.zombie],
    extractTimeSec: 180,
    bossEnemy: ENEMIES.hiveMother,
    branches: branches('subway', [
      ['入站口大厅', '扶梯停在半途，闸机上的灰尘被人拨开过。'],
      ['检票闸机层', '单向闸门全数锈死，只有人工通道还开着。'],
      ['站台一号线', '列车永远停在了进站的半路上。'],
      ['行车隧道', '隧道风声忽大忽小——那不是风。'],
      ['侧线岔口', '岔道深处有微光，也可能是反光。'],
      ['维修工区', '工具墙整齐如初，值班表停在大停电那天。'],
      ['站台二号线', '积水没过脚踝，水面涟漪从黑暗中扩散而来。'],
      ['积水区段', '齐腰深的死水里，你的每一步都是钟声。'],
      ['隧道深处', '手机信号全无，洞壁上开始出现黏稠的分泌物。'],
      ['巢母洞窟', '虫卵铺满洞壁，每一次心跳都来自巢母本身。'],
    ]),
  },
  {
    id: 'research',
    name: '地下研究所',
    dangerLevel: 5,
    flavor: '高危区，传说有变异巨兽与顶级科技。',
    lootTable: [LOOT.serum, LOOT.nanogel, LOOT.chempack, LOOT.parts, LOOT.gear, LOOT.credits, LOOT.blueprint, LOOT.smoke],
    enemies: [ENEMIES.raider, ENEMIES.boss, ENEMIES.drone],
    extractTimeSec: 240,
    bossEnemy: ENEMIES.specimenZero,
    branches: branches('research', [
      ['地面废墟', '研究所的地上部分早已烧穿，电梯井是唯一入口。'],
      ['电梯井', '检修梯狭长幽深，每层门缝都透着不同的光。'],
      ['保安岗哨', '警卫室弹药充足——他们当年显然需要。'],
      ['实验层B1', '培养皿碎裂满地，标签写满编号与警告。'],
      ['细胞培养室', '培养舱里悬浮的东西，形状正在变化。'],
      ['动物实验区', '笼门从里面被撞开的痕迹遍布。'],
      ['数据机房', '服务器仍在低鸣，跑着一份永远完不成的分析。'],
      ['生化实验室', '气密门内侧的抓痕深达钢板。'],
      ['深层禁地', '警示灯全红——"严禁入内"在这里是最低级的警告。'],
      ['巨兽培养舱', '零号实验体睁开了眼睛。培养舱是它自己打开的。'],
    ]),
  },
  {
    id: 'nuclear',
    name: '核爆禁区',
    dangerLevel: 6,
    flavor: '废土尽头，战争领主坐镇，掉宝最丰也最致命。',
    lootTable: [LOOT.alloy, LOOT.blueprint, LOOT.gear, LOOT.credits, LOOT.medkit, LOOT.nanogel, LOOT.serum, LOOT.chempack, LOOT.flash],
    enemies: [ENEMIES.warlord, ENEMIES.brute, ENEMIES.drone, ENEMIES.mutant],
    extractTimeSec: 300,
  },
];

export function getZone(id: string): DangerZone {
  const zone = DANGER_ZONES.find((z) => z.id === id);
  if (!zone) throw new Error(`未知危险区域: ${id}`);
  return zone;
}
