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
import type { GearItem } from '@shared/engine/survival/economy';
import type { AppliedAffix } from '@shared/engine/survival/affixes';

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
}

/** 出击状态机阶段 */
export type ExtractionPhase =
  | 'idle' // 在据点
  | 'searching' // 搜刮中
  | 'combat' // 交战中
  | 'extracted' // 已撤离（成功）
  | 'dead' // 阵亡
  | 'timeout'; // 超时封锁

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
}

export interface SurvivorLoadout {
  name: string;
  attributes: Attributes;
  /** 完整档案：由 buildSortieLoadout 提供；缺失则退化为「属性直转」旧路径 */
  profile?: SurvivorProfile;
  /** 战斗加成（词条/装备/避难所聚合）：由 buildSortieLoadout 提供 */
  bonus?: CombatBonus;
}

export interface ExtractionRunState {
  survivor: SurvivorLoadout;
  zone: DangerZone;
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
  /** 叙事日志 */
  log: string[];
  /** 是否已救援过（防止单次出击多次救援） */
  rescuedThisRun: boolean;
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
