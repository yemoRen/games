/**
 * Phase 1 — 搜打撤核心类型
 *
 * 设计意图（见 docs/reskin-design-全民求生-系统搜打撤.md）：
 * - 把原「被动秘境产出」升级为「搜(搜刮) → 打(战斗) → 撤(撤离结算)」主动循环。
 * - 单次出击的生存状态直接复用 CultivatorCondition（hp/mp/毒性/创伤），
 *   即 condition.ts 成为「本局 in-run 状态」。
 * - 撤离结算：成功→本局物资入库；死亡/超时→仅丢本局未撤离物资（保留据点资产）。
 */

import type { Attributes } from '@shared/types/cultivator';
import type { CultivatorCondition } from '@shared/types/condition';
import type { SurvivorProfile } from '@shared/engine/survival/chargen';
import type { GearItem, GearSlot } from '@shared/engine/survival/economy';
import type { AppliedAffix } from '@shared/engine/survival/affixes';
import type { Injury } from '@shared/engine/survival/recovery';

/**
 * 搜打撤战斗加成（来自词条 / 装备 / 避难所）。
 *  - hpBonus / critBonus 进入 battle-v5（作为 MAX_HP / CRIT_RATE 加值）
 *  - lootLuck / startHpRatio 属于「搜打撤」层收益（搜刮运势 / 出击初始血量头领）
 */
export interface CombatBonus {
  hpBonus: number;
  critBonus: number;
  lootLuck: number;
  startHpRatio: number;
  /** v1.0.2 特殊词条：经验获取加成（0.1 = +10%） */
  xpBonus?: number;
  /** v1.0.2 特殊词条：金币获取加成（0.1 = +10%） */
  coinBonus?: number;
}

/** 出击状态机阶段 */
export type ExtractionPhase =
  | 'idle' // 在据点
  | 'searching' // 搜刮中
  | 'combat' // 交战中
  | 'extracted' // 已撤离（成功）
  | 'dead' // 阵亡
  | 'timeout'; // 超时封锁

// ===== 对局常量（搜-打-撤核心循环的节奏锚点） =====

/** 对局总时长（秒）：时间耗尽未撤离 → 直接判定阵亡（40 分钟，足够推完 10 分支抵达霸主） */
export const RUN_TIME_LIMIT_SEC = 40 * 60;
/** 同一区域最多搜索次数，搜完必须转移（防止原地无限刷物资） */
export const MAX_ZONE_SEARCHES = 3;
/** 安全箱格子数：安全箱内物品即使阵亡也不会丢失（搜打撤保底设计） */
export const SECURE_BOX_SLOTS = 2;

/** 行动时间消耗（秒）——「时间就是风险」：每一次搜索、移动都在逼近封锁 */
export const ACTION_COST = {
  search: 30, // 搜索当前区域
  move: 45, // 前往下一区域
  sneak: 35, // 潜行绕行
  throwEscape: 20, // 投掷物脱离
  fight: 60, // 一场交战
  corpseLoot: 15, // 搜刮敌方尸体
  travel: 60, // 奔赴撤离点 / 突围
  leaveExtract: 15, // 放弃撤离返回搜刮
} as const;

/** 单场交战消耗的弹药；弹药不足则被迫近身肉搏（先挨一刀） */
export const FIGHT_AMMO_COST = 5;

/** 当前未决策的遭遇：强制玩家抉择（搜打撤的灵魂） */
export interface RunEncounter {
  enemy: EnemyArchetype;
  /** 遭遇叙事文本 */
  intro: string;
}

/** 遭遇抉择动作 */
export type EncounterAction = 'fight' | 'sneak' | 'throw' | 'extract';

export type LootKind = 'material' | 'consumable' | 'gear' | 'currency';

export interface LootItem {
  id: string;
  name: string;
  kind: LootKind;
  /** 废土币估值 */
  value: number;
  /** 稀有度阶级（白-绿-蓝-紫-黄-橙-红，0..6），装备掉落才有 */
  tier?: number;
  /** 阶级中文名（白/绿/…），用于展示 */
  rarityName?: string;
  /** 若本件是装备掉落，携带完整 GearItem 入库 */
  gear?: GearItem;
  /** 已结算词缀实例（彩色展示用） */
  affixes?: AppliedAffix[];
  /** 堆叠数量：相同 id 的物品自动合并为一格，不额外占用背包格子 */
  qty?: number;
}

export interface EnemyArchetype {
  id: string;
  name: string;
  attributes: Attributes;
  threatNote?: string;
  /** 是否为区域霸主（Boss） */
  boss?: boolean;
  /** 交战时动态附加的战斗加成（由 rollEncounter 按危险度结算） */
  bonus?: { hpBonus: number; critBonus: number };
  /** 交战时动态附加的词缀（展示用） */
  affixes?: AppliedAffix[];
}

export interface DangerZone {
  id: string;
  name: string;
  /** 1..5，越高产出越好、死亡丢装概率越高 */
  dangerLevel: number;
  flavor: string;
  lootTable: LootItem[];
  enemies: EnemyArchetype[];
  /** 撤离时限（秒，演示用） */
  extractTimeSec: number;
  /** 大地图分支区域（v1.0.2）：选择大地图后按分支推进，最后一区为霸主 */
  branches?: ZoneBranch[];
  /** 本图霸主（第 MAP_BRANCH_COUNT 区强制遭遇） */
  bossEnemy?: EnemyArchetype;
}

/** 每张大地图的分支区域数量（最后一区为霸主巢穴） */
export const MAP_BRANCH_COUNT = 10;

export interface ZoneBranch {
  /** 全局唯一：`${mapId}-${index}` */
  id: string;
  name: string;
  flavor: string;
}

export interface SurvivorLoadout {
  name: string;
  attributes: Attributes;
  /** 完整档案：由 buildSortieLoadout 提供；缺失则退化为「属性直转」旧路径 */
  profile?: SurvivorProfile;
  /** 战斗加成（词条/装备/避难所聚合）：由 buildSortieLoadout 提供 */
  bonus?: CombatBonus;
}

// ===== v1.0.3：本局临时穿戴（支持在临时背包里换装） =====

/** 本局某槽位正在穿戴的装备 */
export interface RunEquippedGear {
  slot: GearSlot;
  gear: GearItem;
  /** true = 本局在副本里换上的（撤离成功才入库并保留）；false = 出击前从基地带来的 */
  fromRun: boolean;
}

/** 六维深化派生值（v1.0.3）：由当前有效六维实时推导，供引擎与 UI 共用 */
export interface AttrEffects {
  /** 战局背包总格数 = 基础 12 + floor(力量/5) */
  packCapacity: number;
  /** 搜索/潜行等行动的耗时系数（敏捷越高越快） */
  timeScale: number;
  /** 潜行成功率加成（敏捷） */
  sneakBonus: number;
  /** 续航时限（分钟）= 耐力 × 2 —— 超出后开始判定疲惫 */
  staminaMinutes: number;
  /** 遇敌概率削减（感知预警） */
  encounterAvoid: number;
  /** 搜刮额外物资概率（感知） */
  lootExtraChance: number;
  /** 震伤概率抗性系数（意志） */
  shockResist: number;
  /** 失血概率抗性系数（体质） */
  bleedResist: number;
}

export interface ExtractionRunState {
  survivor: SurvivorLoadout;
  zone: DangerZone;
  /** 当前大地图（branchIndex 推进的容器；zone 为其派生分支） */
  map: DangerZone;
  /** 当前分支区域序号（0 起；MAP_BRANCH_COUNT-1 为霸主区） */
  branchIndex: number;
  /** 单次出击 survival 状态（复用 condition） */
  condition: CultivatorCondition;
  /** 已搜刮、尚未撤离的物资（死亡/超时即遗失） */
  carriedLoot: LootItem[];
  /** 已安全入库的物资 */
  bankedLoot: LootItem[];
  /** 救援到的幸存者（仅 carry 中，撤离时入库到招募集合） */
  carriedNpc?: import('@shared/engine/survival/chargen').SurvivorProfile;
  /** 已安全撤离的幸存者（caller 转存到 state.recruits） */
  bankedNpc?: import('@shared/engine/survival/chargen').SurvivorProfile;
  phase: ExtractionPhase;
  searchCount: number;
  /** 叙事日志（带 [mm:ss] 对局时间戳） */
  log: string[];
  /** 是否已救援过（防止单次出击多次救援） */
  rescuedThisRun: boolean;
  // ===== v1.0.1 出击玩法扩展 =====
  /** 已消耗的对局时间（秒）；RUN_TIME_LIMIT_SEC - elapsedSec 为剩余时间 */
  elapsedSec: number;
  /** 弹药余量：每场交战消耗 FIGHT_AMMO_COST，弹药可通过对局内搜刮补给 */
  ammo: number;
  /** 护甲耐久：交战后按承伤比例吸收损耗，归零后失去保护 */
  armor: { current: number; max: number };
  /** 当前未决策的遭遇（有值时 UI 切换为抉择面板） */
  encounter?: RunEncounter;
  /** 各区域已搜索次数（key = zone.id，上限 MAX_ZONE_SEARCHES） */
  zoneSearches: Record<string, number>;
  /** 安全箱（SECURE_BOX_SLOTS 格）：阵亡也 100% 保留 */
  secureBox: (LootItem | null)[];
  /** 是否已抵达撤离点（抵达后二选一：确认撤离 / 继续搜刮） */
  atExtract: boolean;
  /** 当前场景叙事（多行文本，区别于底部滚动日志） */
  scene: string;
  /** 战斗胜利后可搜刮的敌方尸体（搜刮一次后清除；霸主尸体掉更高阶装备） */
  corpse?: { enemyName: string; boss?: boolean };
  /** 战斗回放记录（每场一场，对应 log 中 ⚔ 行；供 UI 展开） */
  battles: BattleReplayEntry[];
  /** 本次出击累计击杀经验（撤离成功才结算入角色） */
  xpGained: number;
  // ===== v1.0.2 追加 =====
  /** 出击前快捷·投掷槽装备的投掷物 id（伤害类手雷在战斗中概率自动使用） */
  quickThrow?: string;
  /** 增益药剂备战次数（UI 使用增益时 +1；每次交战消耗 1 次，属性临时提升） */
  buffCharges: number;
  // ===== v1.0.3 追加 =====
  /** 本局累积的伤势（战斗中按血量阶段产生 / 耐力透支产生），实时影响六维与战斗 */
  injuries: Injury[];
  /** 本局各槽位正在穿戴的装备（可被副本内临时换装改写） */
  equipped: RunEquippedGear[];
  /** 六维之外的固定加成（避难所/势力/词条等），换装时保持不变 */
  attrBonusFixed: Partial<Attributes>;
  /** 不含「装备战斗词条」的基础战斗加成（词条 + 避难所），换装时按当前装备重新叠加 */
  bonusBase: CombatBonus;
  /** 未经装备/加成的纯基础六维（debuff 削减的基数） */
  baseAttributes: Attributes;
  /** 上一次疲惫判定时的对局分钟数（避免同一分钟反复判定） */
  lastFatigueCheckMin?: number;
  // ===== v1.0.3 补丁：出击 HP 锚点 =====
  /** 出击起始「最大血量」= 档案持久 maxHp + 临时驻防加成（medbay 等），仅本局有效 */
  startMaxHp: number;
  /** 出击起始「持久 maxHp」（不含临时驻防加成），结算回写基地时以此为准，避免驻防加成泄漏进角色档案 */
  baseMaxHp: number;
  /** v1.0.3 新需求：出击途中分配体质点 / 选择带气血词条时，档案最大血量相对出击起点的增量。
   *  配合本局已穿戴装备的气血加成，作为副本战斗单位最大血量锚点，使加点 / 词条在副本内即时生效。 */
  profileMaxHpBonus: number;
}

// ===== 战斗回放（v1.0.2） =====

/** 单回合战斗摘要 */
export interface BattleRoundEntry {
  round: number;
  /** 本回合逐条交互文本（命中/暴击/闪避/护盾吸收） */
  text: string;
  /** 回合结束时己方生命 */
  hpSelf: number;
  /** 回合结束时敌方生命 */
  hpEnemy: number;
}

/** 一场战斗的完整回放：对应 run.log 中的一条 ⚔ 摘要行（logIndex 定位） */
export interface BattleReplayEntry {
  /** 对应 run.log 的下标（⚔ 摘要行） */
  logIndex: number;
  enemyName: string;
  /** 敌方词缀标签（逗号连接） */
  affixes: string;
  turns: number;
  win: boolean;
  boss: boolean;
  rounds: BattleRoundEntry[];
  /** 一段战斗文字描写 */
  narrative: string;
  /** 六维属性交互点评（如「敏捷 16 : 4 —— 你总能抢先出手……」） */
  attrNotes: string[];
  /** 己方总输出 */
  dmgDealt: number;
  /** 己方总承伤 */
  dmgTaken: number;
}

export type ExtractOutcome = 'success' | 'death' | 'timeout';

export interface ExtractionSummary {
  survivorName: string;
  zoneName: string;
  outcome: ExtractOutcome;
  searches: number;
  carriedValue: number;
  bankedValue: number;
  hpLeft: number;
  hpMax: number;
}
