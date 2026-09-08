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
  ZoneNode,
  ZoneGraph,
} from './types';
import { MAP_BRANCH_COUNT, EXTRACT_POINT_COUNT } from './types';

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
export const LOOT: Record<string, LootItem> = {
  scrap: { id: 'scrap', name: '废金属', kind: 'material', value: 5 },
  meds: { id: 'meds', name: '绷带', kind: 'consumable', value: 12 },
  can: { id: 'can', name: '罐头', kind: 'consumable', value: 8 },
  ammo: { id: 'ammo', name: '弹药', kind: 'material', value: 10 },
  parts: { id: 'parts', name: '电子零件', kind: 'material', value: 18 },
  gear: { id: 'gear', name: '防弹背心', kind: 'gear', value: 45 },
  credits: { id: 'credits', name: '废土币', kind: 'currency', value: 1, qty: 25 },
  serum: { id: 'serum', name: '抗辐射血清', kind: 'consumable', value: 30 },
  battery: { id: 'battery', name: '高能电池', kind: 'material', value: 22 },
  alloy: { id: 'alloy', name: '军用合金', kind: 'material', value: 35 },
  coolant: { id: 'coolant', name: '冷却剂', kind: 'consumable', value: 16 },
  medkit: { id: 'medkit', name: '急救包', kind: 'consumable', value: 40 },
  blueprint: { id: 'blueprint', name: '科技蓝图', kind: 'material', value: 60 },
  stim: { id: 'stim', name: '兴奋剂', kind: 'consumable', value: 22 },
  nutrient: { id: 'nutrient', name: '营养剂', kind: 'consumable', value: 18 },
  nanogel: { id: 'nanogel', name: '纳米凝胶', kind: 'consumable', value: 60 },
  splint: { id: 'splint', name: '夹板绷带', kind: 'consumable', value: 25 },
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

/** 危险区域（对应原「秘境」）。v1.0.10：7 张图依次对应危险度 危1..危7，越高产出越豪华、敌人词缀越狠。 */
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
    bossEnemy: ENEMIES.scrapKing,
    branches: branches('outskirts', [
      ['公路收费站', '横杆早已砸断，收费亭成了狙击位。'],
      ['抛锚车队', '逃难车队长龙，后备箱里常有遗落的行李。'],
      ['加油站废墟', '油罐区警戒线还挂着，火星就是灾难。'],
      ['汽车旅馆', '房间按小时计费——现在按命计费。'],
      ['流浪者营地', '篝火余烬未冷，住户去向不明。'],
      ['废弃农田', '枯死的玉米地里藏着灌溉渠与地窖。'],
      ['修车厂', '千斤顶与残骸之间，拾荒客最爱的淘金地。'],
      ['仓储棚户', '成排的货棚，铁皮墙后别有洞天。'],
      ['哨戒塔楼', '废墟帮的瞭望塔——登顶即暴露，风景绝佳。'],
      ['拾荒王大帐', '铁钩与猎物挂满帐帘，王座由废车壳铸成。'],
    ]),
  },
  {
    id: 'military',
    name: '军事检查站',
    dangerLevel: 4,
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
    dangerLevel: 5,
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
    dangerLevel: 6,
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
    dangerLevel: 7,
    flavor: '废土尽头，战争领主坐镇，掉宝最丰也最致命。',
    lootTable: [LOOT.alloy, LOOT.blueprint, LOOT.gear, LOOT.credits, LOOT.medkit, LOOT.nanogel, LOOT.serum, LOOT.chempack, LOOT.flash],
    enemies: [ENEMIES.warlord, ENEMIES.brute, ENEMIES.drone, ENEMIES.mutant],
    extractTimeSec: 300,
    bossEnemy: ENEMIES.warlord,
    branches: branches('nuclear', [
      ['辐射缓冲带', '辐射读数在盖革计数器上碎成连续的长音。'],
      ['死城街道', '橱窗里的模特还保持着逃跑的姿势。'],
      ['融毁车辆带', '玻璃化车壳黏在路面上，像蜡泪。'],
      ['通风竖井', '井壁滚烫，热风把辐射尘吹成金色的雾。'],
      ['地下管廊', '管线网络如迷宫，图纸在这里比枪有用。'],
      ['冷却塔基座', '巨塔的阴影里，温度反而更低——也更安静。'],
      ['反应堆外围', '铅制屏障倾倒在地，谁挪动了它们？'],
      ['控制棒舱室', '仪表盘全部爆表，唯独一台还在走时。'],
      ['熔毁核心区', '岩浆般的核心余烬仍在呼吸。'],
      ['领主王座', '战争领主端坐于核心之上——废土尽头，它即秩序。'],
    ]),
  },
];

export function getZone(id: string): DangerZone {
  const zone = DANGER_ZONES.find((z) => z.id === id);
  if (!zone) throw new Error(`未知危险区域: ${id}`);
  return zone;
}

// ===== v1.0.5：固定 16 区池（危险度随图深度递增，由生成器按深度推导）=====
/**
 * 固定区域池：每局从中取全部 16 区，按随机连边排成一张分支图。
 * 区域"危险度"在生成时由其在图中的深度推导（越深越危险），因此模板只提供名称/风味。
 * 每局随机点：连边方式、2 个撤离点、霸主所在最深层节点。
 */
export const ZONE_POOL: { id: string; name: string; flavor: string }[] = [
  { id: 'z01', name: '锈蚀公路口', flavor: '断裂的护栏斜插进土里，远处有车灯残光一闪即灭。' },
  { id: 'z02', name: '塌方隧道', flavor: '塌落的混凝土把通道挤成一线天，风声像有人在低语。' },
  { id: 'z03', name: '废弃加油站', flavor: '油罐区警戒线还在，一点火星就是一片火海。' },
  { id: 'z04', name: '流浪者营地', flavor: '篝火余烬未冷，住户却不知去向。' },
  { id: 'z05', name: '地下水闸', flavor: '锈蚀的闸门半开，渗水声在黑暗里回荡。' },
  { id: 'z06', name: '断桥残骸', flavor: '桥面断口处垂着缆绳，对岸有什么在动。' },
  { id: 'z07', name: '尸横广场', flavor: '枯井般的喷泉池里漂着说不清的东西。' },
  { id: 'z08', name: '锈蚀车阵', flavor: '报废车辆挤作一团，车底总窸窣作响。' },
  { id: 'z09', name: '地下管廊', flavor: '管线网络如迷宫，图纸在这里比枪更有用。' },
  { id: 'z10', name: '坍塌商场', flavor: '扶梯停在半途，橱窗模特还摆着逃跑的姿势。' },
  { id: 'z11', name: '信号塔基', flavor: '塔顶灯仍在转，登顶即暴露，风景绝佳。' },
  { id: 'z12', name: '焚毁仓库', flavor: '焦黑货架间，铁钩挂着不明来路的肉块。' },
  { id: 'z13', name: '辐射苗圃', flavor: '玻璃化土地竟长出荧蓝的藤蔓，碰不得。' },
  { id: 'z14', name: '沉没站台', flavor: '积水没过脚踝，水面涟漪从黑暗中扩散而来。' },
  { id: 'z15', name: '医院侧楼', flavor: '走廊尽头的门后，心电监护仪还在长鸣。' },
  { id: 'z16', name: '深井竖坑', flavor: '井壁滚烫，热风把辐射尘吹成金色的雾。' },
];

/**
 * v1.0.10：图内「深度」= 距起点的层距，归一化到 1..7 展示。
 * 深度只驱动**遇怪难度 / 遇怪概率**（越深越容易撞上硬茬），与装备基础爆率无关。
 */
function normalizeDepth(raw: number, maxRaw: number): number {
  return Math.max(1, Math.min(7, 1 + Math.round((raw * 6) / Math.max(1, maxRaw))));
}

/**
 * 生成本局分支图：从固定 16 区池构建节点 + 随机连边，保证连通（起点可达全部节点）。
 *  - 深度（1..7）：随机生成树 + 少量冗余边，得到每个节点距起点的层距，再归一化到 1..7。
 *    深度只影响**遇怪难度 / 遇怪概率**（威胁查表 + 敌人词缀），不影响装备爆率。
 *  - 危险度（危1..危7）：= 本图难度 `theme.dangerLevel`，全图恒定，只驱动**装备基础爆率**。
 *  - 霸主：层距最大的节点（并列随机取一），敌人池替换为地图霸主。
 *  - 撤离点：层距 [2, maxRaw-1] 范围内随机取 EXTRACT_POINT_COUNT 个（排除起点/霸主）。
 */
export function generateZoneGraph(theme: DangerZone, rng: () => number): ZoneGraph {
  const pool = ZONE_POOL;
  const n = pool.length; // 16
  const ids = pool.map((z) => z.id);
  const rawDepth = new Array<number>(n).fill(-1);
  const parent = new Array<number>(n).fill(-1);
  rawDepth[0] = 0;
  for (let i = 1; i < n; i++) {
    const done: number[] = [];
    for (let j = 0; j < i; j++) if (rawDepth[j] >= 0) done.push(j);
    const p = done[Math.floor(rng() * done.length)];
    parent[i] = p;
    rawDepth[i] = rawDepth[p] + 1;
  }
  const maxDepth = Math.max(...rawDepth);

  const edges: Record<string, string[]> = {};
  for (const id of ids) edges[id] = [];
  const addEdge = (a: string, b: string) => {
    if (a === b) return;
    if (!edges[a].includes(b)) edges[a].push(b);
    if (!edges[b].includes(a)) edges[b].push(a);
  };
  // 树边（保证连通）
  for (let i = 1; i < n; i++) addEdge(ids[i], ids[parent[i]]);
  // 少量横向 / 纵深冗余边，丰富路线
  const extra = Math.min(12, n);
  for (let k = 0; k < extra; k++) {
    const a = Math.floor(rng() * n);
    const b = Math.floor(rng() * n);
    if (Math.abs(rawDepth[a] - rawDepth[b]) <= 2) addEdge(ids[a], ids[b]);
  }

  // 霸主：深度最大者（并列随机取一）
  const deepIdx = ids.map((_, i) => i).filter((i) => rawDepth[i] === maxDepth);
  const bossIdx = deepIdx[Math.floor(rng() * deepIdx.length)];

  // 撤离点：深度 [2, maxDepth-1]，排除霸主/起点；不足则从其余节点补足
  const pick = (count: number, pred: (i: number) => boolean): number[] => {
    let arr = ids.map((_, i) => i).filter(pred);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    if (arr.length >= count) return arr.slice(0, count);
    const rest = ids.map((_, i) => i).filter((i) => i !== 0 && i !== bossIdx && !arr.includes(i));
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return [...arr, ...rest.slice(0, count - arr.length)];
  };
  const extractIdx = pick(
    EXTRACT_POINT_COUNT,
    (i) => rawDepth[i] >= 2 && rawDepth[i] <= maxDepth - 1 && i !== bossIdx,
  );

  // v1.0.10 修订：
  //  - danger = 本图难度（危1..危7），全图恒定 → 只驱动装备基础爆率；
  //  - depth  = 本区深度（1..7），随层距递增 → 只驱动遇怪难度 / 遇怪概率，并在区域后缀展示。
  // 例：废弃公寓全图 危1，但图内仍分 深度1..深度7；核爆禁区全图 危7，图内同样分 深度1..深度7。
  const mapDanger = Math.max(1, Math.min(7, Math.round(theme.dangerLevel ?? 1)));
  const nodes: ZoneNode[] = ids.map((_, i) => {
    const isBoss = i === bossIdx;
    return {
      id: ids[i],
      name: pool[i].name,
      flavor: pool[i].flavor,
      danger: mapDanger,
      depth: normalizeDepth(rawDepth[i], maxDepth),
      lootTable: theme.lootTable,
      enemies: isBoss ? (theme.bossEnemy ? [theme.bossEnemy, ...theme.enemies] : theme.enemies) : theme.enemies,
    };
  });

  return {
    startId: ids[0],
    nodes,
    edges,
    extractZones: extractIdx.map((i) => ids[i]),
    bossZoneId: ids[bossIdx],
  };
}
