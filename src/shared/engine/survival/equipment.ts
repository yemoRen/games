/*
 * equipment.ts — 战团成员装备栏定义（6 主槽 + 3 快捷槽）与战局背包规则。
 *
 * 设计要点（搜打撤核心）：
 *  - 常驻穿戴（6 主槽）：一直生效，属性永久加成；撤离失败时按概率掉落。
 *  - 快捷槽（3 个）：战斗中一键使用，不用翻背包。
 *  - 战局背包：独立于穿戴栏，每次开局为空；撤离成功入库，失败/阵亡全部清零。
 */

import type { GearSlot } from './economy';

// ===== 主装备槽（6 个，常驻穿戴，永久生效） =====

/** 主槽键名与 GearSlot 完全一致，可直接用 gear.slot 索引 */
export type MainSlotKey = GearSlot;

export interface MainSlotSpec {
  key: MainSlotKey;
  label: string;
  icon: string;
  desc: string;
}

export const MAIN_EQUIP_SLOTS: MainSlotSpec[] = [
  { key: 'weapon', label: '主武器', icon: '🔫', desc: '步枪 / 霰弹枪 / 砍刀 / 弓弩，主要输出位' },
  { key: 'offWeapon', label: '副武器', icon: '🔪', desc: '手枪 / 匕首，应急补刀，冷却更快' },
  { key: 'head', label: '头部', icon: '🪖', desc: '安全帽 / 防暴头盔，减爆头伤害，附带探测' },
  { key: 'armor', label: '躯干护甲', icon: '🦺', desc: '防刺背心 / 防弹甲，最大减伤核心槽位' },
  { key: 'legs', label: '腿部', icon: '🥾', desc: '战术靴 / 减震护腿，提升移动与撤离速度' },
  { key: 'accessory', label: '饰品', icon: '⌚', desc: '生存手表 / 探测雷达，搜刮爆率与预警' },
];

export const MAIN_SLOT_MAP: Record<MainSlotKey, MainSlotSpec> = MAIN_EQUIP_SLOTS.reduce(
  (acc, s) => {
    acc[s.key] = s;
    return acc;
  },
  {} as Record<MainSlotKey, MainSlotSpec>,
);

// ===== 快捷消耗槽（3 个） =====

export type QuickSlotKey = 'quickMed' | 'quickThrow' | 'quickBuff';

export interface QuickSlotSpec {
  key: QuickSlotKey;
  label: string;
  icon: string;
  desc: string;
}

export const QUICK_SLOTS: QuickSlotSpec[] = [
  { key: 'quickMed', label: '医疗', icon: '💊', desc: '急救包 / 绷带 / 血清，战斗中回血' },
  { key: 'quickThrow', label: '投掷物', icon: '💣', desc: '手雷 / 烟雾弹 / 闪光弹，断后掩护撤离' },
  { key: 'quickBuff', label: '增益补给', icon: '🧪', desc: '能量饮料 / 兴奋剂，临时战斗 buff' },
];

export const QUICK_SLOT_MAP: Record<QuickSlotKey, QuickSlotSpec> = QUICK_SLOTS.reduce(
  (acc, s) => {
    acc[s.key] = s;
    return acc;
  },
  {} as Record<QuickSlotKey, QuickSlotSpec>,
);

// ===== 投掷物（快捷·投掷槽） =====

export type ThrowableId = 'grenade' | 'smoke' | 'flash';

export interface ThrowableSpec {
  id: ThrowableId;
  name: string;
  description: string;
  /** 废土币估值 */
  value: number;
  /** 撤离辅助：提高撤离成功率（烟雾/闪光用于断后） */
  extractBonus?: number;
}

export const THROWABLES: ThrowableSpec[] = [
  { id: 'grenade', name: '破片手雷', description: '高爆伤害，清场用。', value: 45 },
  {
    id: 'smoke',
    name: '烟雾弹',
    description: '遮蔽视野，大幅提升撤离成功率。',
    value: 35,
    extractBonus: 0.25,
  },
  {
    id: 'flash',
    name: '闪光弹',
    description: '致盲敌人，便于脱离接触。',
    value: 30,
    extractBonus: 0.15,
  },
];

export function getThrowable(id: string): ThrowableSpec | undefined {
  return THROWABLES.find((t) => t.id === id);
}

// ===== 战局背包 =====

/** 战局背包容量上限：每次开局为空，撤离成功才入库，失败则全部清零 */
export const RAID_PACK_CAPACITY = 12;

// ===== 撤离失败：穿戴装备掉落 =====

/** 撤离失败时单件穿戴装备的基础掉落概率 */
export const GEAR_DROP_BASE_CHANCE = 0.35;

/**
 * 单件装备的掉落概率。
 * 阶级越高越显眼 → 略增掉落率；饰品（探测/幸运类）可显著降低掉落率。
 */
export function gearDropChance(tier: number, trinketReduce = 0): number {
  const safeTier = Math.max(0, Math.min(6, tier ?? 0));
  const tierFactor = 1 + safeTier * 0.03;
  return Math.max(0.05, GEAR_DROP_BASE_CHANCE * tierFactor - trinketReduce);
}
