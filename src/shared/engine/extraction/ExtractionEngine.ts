/**
 * Phase 1 — 搜打撤核心引擎（v1.0.1 出击玩法重做版）
 *
 * 核心循环：搜(搜刮) → 遭遇事件 → 决策(开战/绕行/投掷脱离/突围) → 打(自动回合战斗) → 撤(撤离结算)。
 *
 * v1.0.1 增量（对局搜索出击页设计）：
 *  - 对局倒计时：RUN_TIME_LIMIT_SEC 内完成搜打撤，时间耗尽未撤离 → 直接判定阵亡（timeout）。
 *  - 时间就是风险：每次行动消耗对局时间；越接近封锁，遭遇概率越高。
 *  - 多区域转移：每区最多搜 MAX_ZONE_SEARCHES 次，搜完必须转移。
 *  - 遭遇抉择：遭遇不再自动开战，强制玩家四选一（开战/潜行/投掷脱离/突围撤离）。
 *  - 弹药与护甲：交战消耗弹药；弹药不足被迫肉搏；护甲按承伤比例吸收损耗。
 *  - 安全箱：SECURE_BOX_SLOTS 格，阵亡也 100% 保留（搜打撤保底设计）。
 *  - 尸体搜刮：战斗胜利后可搜刮敌方尸体获取战利品。
 *  - 场景叙事：state.scene 承载当前场景文本（区别于底部滚动日志）。
 *
 * 引擎复用（不重写）：
 *  - 战斗：battle-v5 的 resolveDuelToCompletion（真实伤害/回合/胜负判定）
 *  - 状态：CultivatorCondition（hp/mp/毒性/创伤）作为「单次出击 survival 状态」
 */

import { Unit } from '@shared/engine/battle-v5/units/Unit';
import { AttributeType } from '@shared/engine/battle-v5/core/types';
import type { UnitId } from '@shared/engine/battle-v5/core/types';
import { BattleRuntime } from '@shared/engine/battle-v5/runtime/BattleRuntime';
import { resolveDuelToCompletion } from '@shared/engine/battle-v5/round/BattleAutoResolver';
import type { AutomaticDuelResolutionV1 } from '@shared/engine/battle-v5/round/BattleAutoResolver';
import type { CultivatorCondition } from '@shared/types/condition';
import { SYSTEM_LINES } from '@shared/theme/survival';
import {
  buildSurvivorUnit,
  buildEnemyUnit,
} from '@shared/engine/survival/combatAdapter';
import {
  rollEnemyAffixes,
  aggregateEnemyAffixes,
  rollGearDrop,
} from '@shared/engine/survival/affixes';
import { RAID_PACK_CAPACITY } from '@shared/engine/survival/equipment';
import type {
  BattleReplayEntry,
  BattleRoundEntry,
  DangerZone,
  EncounterAction,
  EnemyArchetype,
  ExtractOutcome,
  ExtractionRunState,
  ExtractionSummary,
  LootItem,
  SurvivorLoadout,
} from './types';
import {
  ACTION_COST,
  FIGHT_AMMO_COST,
  MAP_BRANCH_COUNT,
  MAX_ZONE_SEARCHES,
  RUN_TIME_LIMIT_SEC,
  SECURE_BOX_SLOTS,
} from './types';
import type { Attributes } from '@shared/types/cultivator';

const ATTRIBUTE_MAP: Array<[keyof Attributes, AttributeType]> = [
  ['vitality', AttributeType.VITALITY],
  ['strength', AttributeType.STRENGTH],
  ['spirit', AttributeType.SPIRIT],
  ['endurance', AttributeType.ENDURANCE],
  ['speed', AttributeType.SPEED],
  ['willpower', AttributeType.WILLPOWER],
];

/** 构造一个可参战的 Unit（属性→战斗属性，自带普攻兜底） */
function buildUnit(
  runtime: BattleRuntime,
  id: string,
  name: string,
  attrs: Attributes,
  currentHp?: number,
): Unit {
  const baseAttrs = {} as Record<AttributeType, number>;
  for (const [key, attrType] of ATTRIBUTE_MAP) {
    baseAttrs[attrType] = attrs[key];
  }
  const unit = new Unit(id as UnitId, name, baseAttrs, { runtime });
  unit.updateDerivedStats();
  unit.initializeCurrentResourcesToMax();
  if (typeof currentHp === 'number') {
    unit.initializeResources({ hp: currentHp });
  }
  return unit;
}

/** 构造一份全新的 in-run 状态（复用 condition 结构） */
function freshCondition(maxHp: number, maxMp: number): CultivatorCondition {
  return {
    version: 1,
    resources: {
      hp: { current: maxHp, max: maxHp },
      mp: { current: maxMp, max: maxMp },
    },
    gauges: { pillToxicity: 0 },
    tracks: {
      tempering: {
        vitality: { level: 0, progress: 0 },
        spirit: { level: 0, progress: 0 },
        wisdom: { level: 0, progress: 0 },
        speed: { level: 0, progress: 0 },
        willpower: { level: 0, progress: 0 },
      },
      marrowWash: { version: 1, level: 0, progress: 0 },
    },
    counters: {
      longTermPillUsesByRealm: {},
      cultivationPillUsesByRealm: {},
      longevityPillUsesByRealm: {},
    },
    statuses: [],
    timestamps: {},
  };
}

function sumValue(items: LootItem[]): number {
  return items.reduce((acc, it) => acc + it.value * (it.qty ?? 1), 0);
}

/** 单件战利品在战局背包中占一格的判定：相同 id 的物品自动堆叠（不额外占格） */
function isSameStack(a: LootItem, b: LootItem): boolean {
  return a.id === b.id;
}

// ===== 对局时钟 =====

/** 对局内时钟文本 [mm:ss]（用于日志时间戳） */
export function fmtClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** 写入一条带对局时间戳的日志 */
function plog(state: ExtractionRunState, text: string): void {
  state.log.push(`[${fmtClock(state.elapsedSec)}] ${text}`);
}

/** 对局剩余时间（秒） */
export function timeLeft(state: ExtractionRunState): number {
  return Math.max(0, RUN_TIME_LIMIT_SEC - state.elapsedSec);
}

/**
 * 消耗对局时间。时间耗尽且尚未撤离 → phase='timeout'（等同阵亡结算）。
 * 只在 searching 阶段生效，避免覆盖 dead/extracted 等终态。
 */
function spendTime(state: ExtractionRunState, sec: number): void {
  if (state.phase !== 'searching') return;
  state.elapsedSec += sec;
  if (state.elapsedSec >= RUN_TIME_LIMIT_SEC) {
    state.elapsedSec = RUN_TIME_LIMIT_SEC;
    state.phase = 'timeout';
    state.encounter = undefined;
    state.scene =
      '⏰ 对局时间耗尽！\n封锁区外墙永久关闭，救援频道一片死寂……\n你没能赶上撤离窗口，未入库物资与本次行动全部作废（安全箱除外）。';
    plog(state, '⏰ 警告：对局时间耗尽，未能撤离，判定阵亡！');
  }
}

/** 当前区域剩余搜索次数 */
export function zoneSearchLeft(state: ExtractionRunState): number {
  return Math.max(0, MAX_ZONE_SEARCHES - (state.zoneSearches[state.zone.id] ?? 0));
}

// ===== 战局背包 =====

/**
 * 把一件战利品放入战局背包：相同 id 的物品自动堆叠（qty+1），不额外占用格子。
 * 仅当背包「格子数」（不同 id 的堆叠数量）未满时才能放入。
 * 装备掉落 id 唯一，因此每件装备独立占一格。
 * 返回是否成功放入。
 */
export function addCarriedLoot(state: ExtractionRunState, item: LootItem): boolean {
  if (state.phase !== 'searching') return false;
  // 相同物品直接堆叠到已有格子：永远允许，且不占用新格子（容量只限制「不同物品种类数」）
  const existing = state.carriedLoot.find((l) => isSameStack(l, item));
  if (existing) {
    existing.qty = (existing.qty ?? 1) + 1;
    return true;
  }
  if (state.carriedLoot.length >= RAID_PACK_CAPACITY) return false;
  state.carriedLoot.push({ ...item, qty: item.qty ?? 1 });
  return true;
}

/** 战局背包现有堆叠总数量（用于展示） */
export function carriedQty(state: ExtractionRunState): number {
  return state.carriedLoot.reduce((acc, it) => acc + (it.qty ?? 1), 0);
}

/** 丢弃一件战局背包物资（腾出负重） */
export function dropCarried(state: ExtractionRunState, index: number): void {
  if (state.phase !== 'searching') return;
  if (index < 0 || index >= state.carriedLoot.length) return;
  const [it] = state.carriedLoot.splice(index, 1);
  if (it) plog(state, `🗑 丢弃了【${it.name}】。`);
}

/** 把战局背包中的一件物资整格移入安全箱（阵亡也保留）。返回是否成功 */
export function moveToSecure(state: ExtractionRunState, index: number): boolean {
  if (state.phase !== 'searching') return false;
  const it = state.carriedLoot[index];
  if (!it) return false;
  const slot = state.secureBox.findIndex((s) => s === null);
  if (slot < 0) {
    plog(state, '🛡 安全箱已满，无法再放入。');
    return false;
  }
  state.carriedLoot.splice(index, 1);
  state.secureBox[slot] = it;
  plog(state, `🛡 【${it.name}】已放入安全箱（阵亡也保留）。`);
  return true;
}

/** 从安全箱取回一件到战局背包（需要背包有空格）。返回是否成功 */
export function takeFromSecure(state: ExtractionRunState, slot: number): boolean {
  if (state.phase !== 'searching') return false;
  const it = state.secureBox[slot];
  if (!it) return false;
  if (state.carriedLoot.length >= RAID_PACK_CAPACITY) {
    plog(state, '🎒 战局背包已满，无法从安全箱取回。');
    return false;
  }
  state.secureBox[slot] = null;
  state.carriedLoot.push(it);
  plog(state, `🎒 已从安全箱取回【${it.name}】。`);
  return true;
}

/** 安全箱物资转入已入库（撤离成功 / 阵亡保底结算时调用） */
export function bankSecureIntoBanked(state: ExtractionRunState): void {
  const kept = state.secureBox.filter((s): s is LootItem => s !== null);
  if (kept.length > 0) {
    state.bankedLoot.push(...kept);
    state.secureBox = state.secureBox.map(() => null);
  }
}

// ===== 开局 =====

/**
 * 派生大地图某个分支区域的有效区域（v1.0.2）：
 *  - 名称 = 大地图 · 分支名；
 *  - 有效危险度随分支深度提升（每 3 区 +1，封顶 9）——搜刮品质 / 敌人词缀 / 遭遇率同步水涨船高；
 *  - 最后一区（霸主区）敌人池替换为地图专属霸主。
 */
export function branchZone(map: DangerZone, idx: number): DangerZone {
  if (!map.branches || map.branches.length === 0) return map;
  const last = map.branches.length - 1;
  const br = map.branches[Math.max(0, Math.min(idx, last))];
  const isBossFloor = idx >= last;
  return {
    ...map,
    id: br.id,
    name: `${map.name}·${br.name}`,
    dangerLevel: Math.min(9, map.dangerLevel + Math.floor(idx / 3)),
    flavor: br.flavor,
    enemies: isBossFloor && map.bossEnemy ? [map.bossEnemy] : map.enemies,
  };
}

/** 当前是否处于霸主分支区（每图第 MAP_BRANCH_COUNT 区） */
export function isBossBranch(state: ExtractionRunState): boolean {
  const len = state.map.branches?.length ?? 0;
  return len > 0 && state.branchIndex >= len - 1;
}

/**
 * 进入危险区域，建立一次出击（状态机从 idle → searching）。
 * startArmor / startAmmo：由 caller 依据穿戴装备推算（护甲槽阶级→耐久，武器阶级→弹药）。
 * 入局即位于大地图第 1 分支区；用 advanceBranch 逐区深入。
 */
export function createRun(
  survivor: SurvivorLoadout,
  zone: DangerZone,
  startHp?: number,
  startArmor?: { current: number; max: number },
  startAmmo?: number,
): ExtractionRunState {
  const runtime = new BattleRuntime();
  // 有完整档案+战斗加成时，走正式 battle-v5 战斗单元；否则退化为属性直转。
  let unit: Unit;
  if (survivor.profile && survivor.bonus) {
    unit = buildSurvivorUnit(survivor.profile, survivor.attributes, survivor.bonus, runtime);
  } else {
    unit = buildUnit(runtime, 'survivor', survivor.name, survivor.attributes);
  }
  const condition = freshCondition(unit.getMaxHp(), unit.getMaxMp());
  if (typeof startHp === 'number') {
    condition.resources.hp.current = Math.max(0, Math.min(unit.getMaxHp(), Math.round(startHp)));
  }
  const armor = startArmor ?? { current: 0, max: 0 };
  const map = zone;
  const startZone = branchZone(map, 0);
  return {
    survivor,
    zone: startZone,
    map,
    branchIndex: 0,
    condition,
    carriedLoot: [],
    bankedLoot: [],
    phase: 'searching',
    searchCount: 0,
    log: [SYSTEM_LINES.missionReady, SYSTEM_LINES.enterZone, `进入【${startZone.name}】：${startZone.flavor}`],
    rescuedThisRun: false,
    elapsedSec: 0,
    ammo: Math.max(0, Math.round(startAmmo ?? 24)),
    armor,
    zoneSearches: {},
    secureBox: Array.from({ length: SECURE_BOX_SLOTS }, () => null),
    atExtract: false,
    battles: [],
    xpGained: 0,
    buffCharges: 0,
    scene: [
      '【生存系统】任务简报：',
      `目标区域【${startZone.name}】—— ${startZone.flavor}`,
      `本图共 ${MAP_BRANCH_COUNT} 个分支区域，越深入越危险，最后一区盘踞着地图霸主。`,
      `对局时长 ${Math.round(RUN_TIME_LIMIT_SEC / 60)} 分钟，时间耗尽未撤离将判定阵亡。`,
      '每次搜索 / 深入都会消耗时间；越接近封锁，遭遇越频繁。',
      '安全箱内的物资即使阵亡也会保留，撤离成功才能带走背包物资。',
    ].join('\n'),
  };
}

// ===== 战利品发放 =====

/** 战利品 id=ammo 时直接装填进弹匣（不占背包格） */
const AMMO_LOOT_GRANT = 10;

/**
 * 把一张战利品表条目实际发放到对局（弹药→弹匣；装备→带阶级掉落；其余入背包）。
 * 返回给场景/日志使用的描述文本；背包满时返回 null。
 */
function grantLoot(state: ExtractionRunState, raw: LootItem, rng: () => number, luck = 0): string | null {
  const item: LootItem =
    raw.kind === 'gear' && !raw.gear
      ? rollGearDrop(rng, state.zone.dangerLevel, luck * 0.2)
      : raw;
  if (item.id === 'ammo') {
    state.ammo += AMMO_LOOT_GRANT;
    return `【弹药】×${AMMO_LOOT_GRANT}（已装填进弹匣，余 ${state.ammo} 发）`;
  }
  const tierNote = item.rarityName ? `(${item.rarityName}阶 · 估值 ${item.value})` : `(估值 ${item.value})`;
  if (!addCarriedLoot(state, item)) return null;
  return `【${item.name}】${tierNote}`;
}

// ===== 搜刮 =====

/** 搜刮阶段：随机获得物资；有概率触发遭遇事件（不再自动开战，强制抉择） */
export function search(state: ExtractionRunState, rng: () => number = Math.random, luck = 0): void {
  if (state.phase !== 'searching' || state.encounter || state.atExtract) return;
  const searched = state.zoneSearches[state.zone.id] ?? 0;
  if (searched >= MAX_ZONE_SEARCHES) {
    state.scene = `【${state.zone.name}】已经被你翻了个底朝天。\n此地已被搜刮干净，需要前往下一处区域。`;
    plog(state, `本区域已搜刮干净（${MAX_ZONE_SEARCHES}/${MAX_ZONE_SEARCHES}），请前往下一区域。`);
    return;
  }
  spendTime(state, ACTION_COST.search);
  if (state.phase !== 'searching') return;

  // 搜刮运势（词条/装备/避难所聚合）：整数保底额外次数 + 小数部分概率额外一次
  const base = 1 + Math.floor(rng() * 2);
  const extra = Math.floor(luck) + (rng() < luck % 1 ? 1 : 0);
  const gained: string[] = [];
  for (let i = 0; i < base + extra; i++) {
    const raw = state.zone.lootTable[Math.floor(rng() * state.zone.lootTable.length)];
    const text = grantLoot(state, raw, rng, luck);
    if (text) gained.push(text);
  }
  // 装备掉落：危险度越高，越可能搜到带阶级词缀的装备（白-绿-蓝-紫-黄-橙-红）
  const gearChance = 0.25 + state.zone.dangerLevel * 0.04;
  if (rng() < gearChance) {
    const drop = rollGearDrop(rng, state.zone.dangerLevel, luck * 0.2);
    const affixText = drop.affixes.map((a) => a.text).join('、');
    if (addCarriedLoot(state, drop)) {
      gained.push(`【${drop.name}】(${drop.rarityName}阶，估值 ${drop.value})${affixText ? ` 词缀：${affixText}` : ''}`);
    }
  }
  state.zoneSearches[state.zone.id] = searched + 1;
  state.searchCount++;
  const left = zoneSearchLeft(state);
  for (const g of gained) plog(state, `搜索区域，获得：${g}`);

  // 遭遇判定：基础概率 + 时间压力（越接近封锁越危险）
  const enemy = rollEncounter(state, rng);
  if (enemy) {
    const intro = encounterIntro(state, enemy, rng);
    state.encounter = { enemy, intro };
    state.scene = intro;
    plog(state, `⚠ 听见脚步声，遭遇【${enemy.name}】！`);
    return;
  }

  const lootText = gained.length > 0 ? gained.join('\n') : '一无所获……只有风穿过破碎的窗棂。';
  state.scene = [
    `你压低身位，翻检【${state.zone.name}】的残骸。`,
    '【系统提示】：你开始搜索这片区域。',
    '──',
    `✅ 搜索成功：`,
    lootText,
    '',
    `本区剩余搜索机会：${left}/${MAX_ZONE_SEARCHES}${left === 0 ? '（搜完需转移下一区域）' : ''}`,
  ].join('\n');
}

// ===== 遭遇 =====

const ENCOUNTER_DIRS = ['楼道转角', '坍塌的墙后', '浓雾深处', '翻覆的车辆旁', '地铁阴影里', '货架倒塌的缺口'];

function encounterIntro(state: ExtractionRunState, enemy: EnemyArchetype, rng: () => number): string {
  const dir = ENCOUNTER_DIRS[Math.floor(rng() * ENCOUNTER_DIRS.length)];
  const affixNote =
    enemy.affixes && enemy.affixes.length > 0
      ? `\n敌方词条：${enemy.affixes.map((a) => a.label).join('、')}`
      : '';
  const ammoNote =
    state.ammo >= FIGHT_AMMO_COST ? '' : `\n（⚠ 弹药不足 ${FIGHT_AMMO_COST} 发，开战将被迫近身肉搏）`;
  return [
    '⚠️ 遭遇事件！',
    `一名【${enemy.name}】从${dir}冲了出来——${enemy.threatNote ?? '来者不善'}。${affixNote}`,
    `你现在可以选择：${ammoNote}`,
    '🔹【主动开战】消耗弹药，开启回合战斗',
    '🔹【潜行绕行】消耗时间，有概率被发现；失败将被迫交战',
    '🔹【投掷物脱离】消耗烟雾弹/闪光弹，必定脱离纠缠',
    '🔹【突围撤离点】放弃搜刮，直奔撤离位置',
  ].join('\n');
}

/** 按区域危险度抽一个敌人原型并结算其词缀（不做概率门控） */
function pickEnemy(state: ExtractionRunState, rng: () => number): EnemyArchetype {
  const base = state.zone.enemies[Math.floor(rng() * state.zone.enemies.length)];
  const affixes = rollEnemyAffixes(rng, state.zone.dangerLevel);
  const { attributes, hpBonus, critBonus } = aggregateEnemyAffixes(affixes);
  const effectiveAttributes: Attributes = { ...base.attributes };
  for (const k of Object.keys(attributes) as (keyof Attributes)[]) {
    effectiveAttributes[k] = (effectiveAttributes[k] ?? 0) + (attributes[k] ?? 0);
  }
  return {
    ...base,
    attributes: effectiveAttributes,
    bonus: { hpBonus, critBonus },
    affixes,
  };
}

/**
 * 按区域危险度 + 对局时间压力随机判定是否遭遇敌人。
 * 时间越晚遭遇概率越高（惩罚「贪物资」的玩家）。
 */
export function rollEncounter(state: ExtractionRunState, rng: () => number = Math.random): EnemyArchetype | null {
  const timePressure = 0.18 * (state.elapsedSec / RUN_TIME_LIMIT_SEC);
  // 霸主区：遭遇率显著提升（且敌人池已替换为霸主）
  const bossFloor = isBossBranch(state);
  const chance = bossFloor
    ? Math.min(0.95, 0.6 + state.zone.dangerLevel * 0.04 + timePressure)
    : Math.min(0.85, 0.22 + state.zone.dangerLevel * 0.11 + timePressure);
  if (rng() >= chance) return null;
  return pickEnemy(state, rng);
}

/**
 * 遭遇抉择：强制玩家四选一（搜打撤的灵魂）。
 *  - fight：进入回合战斗（弹药不足则肉搏）
 *  - sneak：消耗时间潜行；失败被迫交战
 *  - throw：消耗投掷物（UI 负责扣库存），必定脱离
 *  - extract：突围奔赴撤离点
 */
export function resolveEncounter(state: ExtractionRunState, action: EncounterAction, rng: () => number = Math.random): void {
  const enc = state.encounter;
  if (!enc || state.phase !== 'searching') return;
  switch (action) {
    case 'fight': {
      fight(state, enc.enemy, rng);
      break;
    }
    case 'sneak': {
      spendTime(state, ACTION_COST.sneak);
      if (state.phase !== 'searching') return;
      // 精英/Boss 更难绕开
      const successP = enc.enemy.boss ? 0.35 : 0.72;
      if (rng() < successP) {
        state.encounter = undefined;
        state.scene = `你贴着断墙，压低呼吸从侧翼绕行……\n【${enc.enemy.name}】在废墟间逡巡片刻，最终没有发现你的踪迹。\n危险暂时解除，但时间已悄悄流逝。`;
        plog(state, `潜行成功，绕开了【${enc.enemy.name}】。`);
      } else {
        plog(state, `潜行失败！【${enc.enemy.name}】发现了你，被迫交战！`);
        state.scene = `你的脚步惊动了碎石——【${enc.enemy.name}】猛地转头锁定了你！\n退路已断，只能迎战！`;
        fight(state, enc.enemy, rng);
      }
      break;
    }
    case 'throw': {
      spendTime(state, ACTION_COST.throwEscape);
      if (state.phase !== 'searching') return;
      state.encounter = undefined;
      state.scene = '烟雾弹炸开，浓白的烟雾瞬间吞没了敌人的视野。\n你借着烟幕低姿疾走，甩开了纠缠。\n（投掷物已消耗）';
      plog(state, '💥 投掷物脱离成功，甩开了敌人。');
      break;
    }
    case 'extract': {
      spendTime(state, ACTION_COST.travel);
      if (state.phase !== 'searching') return;
      state.encounter = undefined;
      state.atExtract = true;
      state.scene = '你不再恋战，转身冲向撤离信号区……\n🚁 你已抵达撤离点！救援直升机正在接近。\n【确认撤离】带走背包物资；【继续搜刮】贪心者自负风险。';
      plog(state, '🚁 突围成功，已抵达撤离点。');
      break;
    }
  }
}

// ===== 救援 =====

/**
 * 救援事件：搜刮时按概率生成一个可招募集合成员。
 * npcGenerator 由 caller 注入（charge.ts.generateSurvivor），
 * 保持 extraction 引擎与生存系统的解耦。
 */
export function rollRescue(
  state: ExtractionRunState,
  rng: () => number,
  npcGenerator: () => import('@shared/engine/survival/chargen').SurvivorProfile,
): import('@shared/engine/survival/chargen').SurvivorProfile | null {
  if (state.rescuedThisRun) return null;
  if (state.phase !== 'searching') return null;
  // 低概率 + 危险度越高救援越容易（因为更危险的地方遇难者也越多）
  const chance = 0.10 + state.zone.dangerLevel * 0.04;
  if (rng() >= chance) return null;
  const npc = npcGenerator();
  state.rescuedThisRun = true;
  plog(state, `❗ 发现被困幸存者【${npc.name}】（${npc.tierName}）—— 决定带回基地。`);
  state.carriedNpc = npc;
  return npc;
}

// ===== 战斗 =====

/** 六维属性 → 战斗风格点评（|差|≥3 才点评，最多 4 条） */
const ATTR_NOTE_DEFS: Array<{
  key: keyof Attributes;
  label: string;
  high: string;
  low: string;
}> = [
  { key: 'speed', label: '敏捷', high: '你总能抢先出手、从容走位，先手权牢牢在握', low: '你常常后手挨打，先手权在敌人手里，建议利用走位弥补' },
  { key: 'strength', label: '力量', high: '你的火力压制占据上风，正面硬拼不吃亏', low: '正面火力对拼处于劣势，拉开距离周旋才是正解' },
  { key: 'endurance', label: '耐力', high: '你的续航更持久，消耗战对你有利', low: '长时间缠斗对你不利，速战速决为上' },
  { key: 'vitality', label: '体质', high: '你的血量底盘更厚，容错率更高', low: '你的血量底盘偏薄，交战前记得用药把状态拉满' },
  { key: 'spirit', label: '灵性', high: '你的灵性更胜一筹，技能与暴击更加频繁', low: '敌人的灵性压制了你，技能与暴击频率会吃亏' },
  { key: 'willpower', label: '意志', high: '你的意志坚韧，更难被敌方节奏带偏', low: '敌人意志顽强，慎防陷入它擅长的持久消耗' },
];

/**
 * 从 battle-v5 决斗结果构建可展开的战斗回放：
 * 逐回合命中/暴击/闪避/护盾吸收文本 + 每回合双方生命 + 一段文字描写 + 六维属性点评。
 */
function buildBattleReplay(
  state: ExtractionRunState,
  enemy: EnemyArchetype,
  selfUnit: Unit,
  enemyUnit: Unit,
  duel: AutomaticDuelResolutionV1,
  won: boolean,
  logIndex: number,
): BattleReplayEntry {
  const selfId = selfUnit.id;
  const enemyId = enemyUnit.id;
  const selfName = state.survivor.name;

  // 初始生命（battle_init 帧；缺失时退化为当前状态）
  const initFrame = duel.stateTimeline.frames.find((f) => f.phase === 'battle_init');
  let hpSelf = initFrame?.units[selfId]?.hp.current ?? state.condition.resources.hp.current;
  let hpEnemy = initFrame?.units[enemyId]?.hp.current ?? 0;

  interface Agg {
    texts: string[];
    selfDmg: number;
    enemyDmg: number;
  }
  const byTurn = new Map<number, Agg>();
  const aggOf = (turn: number): Agg => {
    let a = byTurn.get(turn);
    if (!a) {
      a = { texts: [], selfDmg: 0, enemyDmg: 0 };
      byTurn.set(turn, a);
    }
    return a;
  };
  const hpByTurn = new Map<number, { self: number; enemy: number }>();

  let critSelf = 0;
  let dodgeSelf = 0;
  let biggestSelf = 0;
  let biggestEnemy = 0;
  let firstActor = '';

  for (const seq of duel.sequences) {
    const turn = seq.turn;
    if (turn >= 1 && seq.phase === 'action_pre' && seq.actor?.name && !firstActor) {
      firstActor = seq.actor.name;
    }
    if (turn < 1) continue;
    const agg = aggOf(turn);
    for (const fact of seq.facts) {
      if (fact.type === 'damage') {
        const src = fact.origin.kind === 'owned' ? fact.origin.owner.name : fact.origin.carrier.name;
        const critTag = fact.critical ? '（暴击！）' : '';
        const shieldTag = fact.shieldAbsorbed > 0 ? `，护盾吸收 ${fact.shieldAbsorbed}` : '';
        agg.texts.push(`${src} → ${fact.target.name}：-${fact.amount}${critTag}${shieldTag}`);
        if (fact.target.id === enemyId) {
          hpEnemy = fact.afterHp;
          agg.selfDmg += fact.amount;
          biggestSelf = Math.max(biggestSelf, fact.amount);
          if (fact.critical) critSelf++;
        } else {
          hpSelf = fact.afterHp;
          agg.enemyDmg += fact.amount;
          biggestEnemy = Math.max(biggestEnemy, fact.amount);
        }
      } else if (fact.type === 'defense' && fact.defense === 'dodge') {
        agg.texts.push(`${fact.target.name} 凭敏捷身法闪避了攻杀！`);
        if (fact.target.id === selfId) dodgeSelf++;
      } else if (fact.type === 'recovery' && fact.resource === 'hp') {
        agg.texts.push(`${fact.target.name} 恢复生命 ${fact.amount}`);
        if (fact.target.id === selfId) hpSelf = fact.after;
        else hpEnemy = fact.after;
      }
    }
    hpByTurn.set(turn, { self: hpSelf, enemy: hpEnemy });
  }

  // 逐回合生命快照（无动作的回合沿用上一回合值）
  const rounds: BattleRoundEntry[] = [];
  let lastSelf = hpSelf;
  let lastEnemy = hpEnemy;
  for (let t = 1; t <= duel.turns; t++) {
    const snap = hpByTurn.get(t);
    if (snap) {
      lastSelf = snap.self;
      lastEnemy = snap.enemy;
    }
    const agg = byTurn.get(t);
    rounds.push({
      round: t,
      text:
        agg && agg.texts.length > 0
          ? agg.texts.join('；')
          : '（双方试探周旋，未发生有效交互）',
      hpSelf: lastSelf,
      hpEnemy: lastEnemy,
    });
  }

  // 一段战斗文字描写
  const intro =
    firstActor === selfName
      ? `${selfName} 抢得先手，在【${enemy.name}】扑近之前先一步开火。`
      : `【${enemy.name}】抢先发难，${selfName} 就地翻滚脱离了第一波攻势。`;
  const mid =
    biggestSelf > 0
      ? `你打出的最重一击造成 ${biggestSelf} 点伤害${critSelf > 0 ? `，全场轰出 ${critSelf} 次暴击` : ''}。`
      : '你全程被火力压制，没能打出像样的还击。';
  const taken =
    biggestEnemy > 0
      ? `最险的一发让你失去 ${biggestEnemy} 点生命${dodgeSelf > 0 ? `——好在凭敏捷身法闪掉了 ${dodgeSelf} 次杀招` : ''}。`
      : '';
  const end = won
    ? `第 ${duel.turns} 回合，${enemy.name} 轰然倒地，废墟重归死寂。`
    : `第 ${duel.turns} 回合，你的枪声永远停在了这片废墟。`;
  const narrative = [intro, mid, taken, end].filter(Boolean).join(' ');

  // 六维属性交互点评
  const notes: string[] = [];
  for (const def of ATTR_NOTE_DEFS) {
    const mine = state.survivor.attributes[def.key] ?? 0;
    const theirs = enemy.attributes[def.key] ?? 0;
    const diff = mine - theirs;
    if (Math.abs(diff) >= 3) {
      notes.push(`${def.label} ${mine} : ${theirs} —— ${diff > 0 ? def.high : def.low}`);
    }
    if (notes.length >= 4) break;
  }

  return {
    logIndex,
    enemyName: enemy.name,
    affixes: enemy.affixes?.map((a) => a.label).join('、') ?? '',
    turns: duel.turns,
    win: won,
    boss: !!enemy.boss,
    rounds,
    narrative,
    attrNotes: notes,
    dmgDealt: [...byTurn.values()].reduce((a, b) => a + b.selfDmg, 0),
    dmgTaken: [...byTurn.values()].reduce((a, b) => a + b.enemyDmg, 0),
  };
}

/**
 * 交战阶段：用真实 battle-v5 引擎决出胜负，并把结果写回 in-run 状态。
 * v1.0.1：交战消耗弹药（不足则肉搏先挨一刀）；护甲按承伤比例吸收损耗；
 * 胜利后留下可搜刮的敌方尸体。
 * v1.0.2：生成逐回合战斗回放（battles）+ 霸主击杀额外战利品。
 */
export function fight(
  state: ExtractionRunState,
  enemy: EnemyArchetype,
  rng: () => number = Math.random,
): void {
  if (state.phase !== 'searching') return;
  state.encounter = undefined;
  state.phase = 'combat';

  const maxHp = state.condition.resources.hp.max ?? 0;
  // 弹药结算：足够 → 正常交战；不足 → 被迫肉搏，先被劈中一刀
  if (state.ammo >= FIGHT_AMMO_COST) {
    state.ammo -= FIGHT_AMMO_COST;
    plog(state, `🔫 交战消耗弹药 ${FIGHT_AMMO_COST} 发（余 ${state.ammo}）。`);
  } else {
    const meleePenalty = Math.max(1, Math.round(maxHp * 0.12));
    state.condition.resources.hp.current = Math.max(1, state.condition.resources.hp.current - meleePenalty);
    plog(state, `⚠ 弹药不足，被迫近身肉搏（先承受 ${meleePenalty} 点伤害）！`);
  }
  const hpBeforeFight = state.condition.resources.hp.current;

  const runtime = new BattleRuntime();
  // v1.0.2 增益药剂：出战前使用了增益补给（buffCharges>0）时，本场交战六维临时强化，消耗 1 次
  let effAttrs = state.survivor.attributes;
  if (state.buffCharges > 0) {
    state.buffCharges -= 1;
    effAttrs = {
      ...state.survivor.attributes,
      strength: (state.survivor.attributes.strength ?? 0) + 5,
      speed: (state.survivor.attributes.speed ?? 0) + 5,
      endurance: (state.survivor.attributes.endurance ?? 0) + 3,
      willpower: (state.survivor.attributes.willpower ?? 0) + 2,
    };
    plog(state, '🧪 增益药剂生效：力量/敏捷/耐力/意志临时提升（剩余备战 ' + state.buffCharges + ' 次）。');
  }
  // 有完整档案+战斗加成时走正式 battle-v5 战斗单元（装备/词条生效）；否则属性直转。
  let survivorUnit: Unit;
  if (state.survivor.profile && state.survivor.bonus) {
    survivorUnit = buildSurvivorUnit(
      state.survivor.profile,
      effAttrs,
      state.survivor.bonus,
      runtime,
      state.condition.resources.hp.current,
    );
  } else {
    survivorUnit = buildUnit(
      runtime,
      'survivor',
      state.survivor.name,
      effAttrs,
      state.condition.resources.hp.current,
    );
  }
  const enemyUnit = buildEnemyUnit(runtime, enemy);
  // v1.0.2 伤害类投掷物自动使用：快捷·投掷槽装备了破片手雷时，45% 概率战斗先手引爆
  if (state.quickThrow === 'grenade' && rng() < 0.45) {
    const dmg = Math.max(10, Math.round(enemyUnit.getMaxHp() * 0.2));
    enemyUnit.takeDamage(dmg);
    plog(state, `💣 你抢先拉开破片手雷掷向【${enemy.name}】，轰然爆炸造成 ${dmg} 点伤害！`);
  }
  const duel = resolveDuelToCompletion({
    battleId: 'extraction-duel',
    player: survivorUnit,
    opponent: enemyUnit,
    runtime,
  });
  const survivorWon = duel.winner === survivorUnit.id;
  const sSnap = survivorWon ? duel.winnerSnapshot : duel.loserSnapshot;
  const eSnap = survivorWon ? duel.loserSnapshot : duel.winnerSnapshot;
  const affixNote = enemy.affixes && enemy.affixes.length
    ? `〔${enemy.affixes.map((a) => a.label).join('、')}〕`
    : '';
  const battleLogIndex = state.log.length;
  plog(state, `⚔ 与【${enemy.name}】${affixNote}交战（${enemy.threatNote ?? ''}），历时 ${duel.turns} 回合`);
  // 战斗回放：逐回合交互 + 属性点评（UI 点击 ⚔ 行可展开）
  state.battles.push(
    buildBattleReplay(state, enemy, survivorUnit, enemyUnit, duel, survivorWon, battleLogIndex),
  );

  const hpAfterBattle = sSnap.hp.current;
  // 护甲承伤结算：本场生命损耗的一部分由护甲吸收（耐久同步损耗）
  const loss = Math.max(0, hpBeforeFight - hpAfterBattle);
  let absorbed = 0;
  if (state.armor.current > 0 && loss > 0) {
    absorbed = Math.min(state.armor.current, Math.ceil(loss * 0.35));
    state.armor.current -= absorbed;
  }

  state.condition.resources.hp.current = Math.min(sSnap.hp.max, hpAfterBattle + absorbed);
  state.condition.resources.hp.max = sSnap.hp.max;

  if (!sSnap.alive) {
    state.phase = 'dead';
    state.scene = `⚔【${enemy.name}】的最后一击击穿了你……\n你倒在了【${state.zone.name}】的废墟里。\n❌ 战斗失败：对局结束，本局背包物资全部丢失（安全箱保留）；身上穿戴装备有概率掉落。`;
    plog(state, SYSTEM_LINES.death);
    return;
  }

  state.phase = 'searching';
  const armorNote =
    absorbed > 0
      ? `防弹甲承受了大部分冲击（护甲耐久 -${absorbed}，余 ${state.armor.current}/${state.armor.max}）`
      : state.armor.max <= 0
        ? '你没有护甲防护，硬扛了伤害'
        : '护甲已碎裂，这次全靠血肉硬扛';
  if (state.armor.current <= 0 && state.armor.max > 0) {
    plog(state, '🛡 护甲耐久耗尽，已失去防护！');
  }
  state.corpse = { enemyName: enemy.name, boss: !!enemy.boss };
  // 击杀经验：与敌人强度/区域危险度挂钩（撤离成功才结算入角色）
  const xpGain = Math.round(
    (12 + state.zone.dangerLevel * 8) * (enemy.boss ? 3 : 1) * (0.8 + rng() * 0.4),
  );
  state.xpGained += xpGain;
  plog(state, `📈 击败【${enemy.name}】获得经验 +${xpGain}（撤离成功后结算）。`);
  // 霸主击杀奖励：额外掉落一件高阶装备（v1.0.2：保底品阶 ≥ 蓝，品阶概率向高阶偏移）
  if (enemy.boss) {
    plog(state, `👑 区域霸主【${enemy.name}】已被击倒！本图最深处宣告清理。`);
    const bonus = rollGearDrop(
      rng,
      Math.min(9, state.zone.dangerLevel + 3),
      0.8,
      Math.min(6, Math.max(2, state.zone.dangerLevel)),
    );
    if (addCarriedLoot(state, bonus)) {
      plog(state, `👑 霸主战利品：【${bonus.name}】（${bonus.rarityName}阶，估值 ${bonus.value}）。`);
    }
  }
  state.scene = [
    '⚔ 战斗爆发！',
    `${enemy.name} 扑击而来，${armorNote}。`,
    `你果断还击，枪声在废墟间回荡——历时 ${duel.turns} 回合。`,
    `✅ 战斗胜利：击倒【${enemy.name}】，你剩余生命 ${state.condition.resources.hp.current}/${state.condition.resources.hp.max}。`,
    '可以【搜刮敌方尸体】获取战利品。',
  ].join('\n');
  plog(
    state,
    `✔ 击退【${enemy.name}】（敌方残余生命 ${eSnap.hp.current}），你剩余生命 ${state.condition.resources.hp.current}/${state.condition.resources.hp.max}`,
  );
  // 交战消耗对局时间（放在末尾：胜利后仍可能因时间耗尽而 timeout）
  spendTime(state, ACTION_COST.fight + Math.floor(rng() * 20));
}

/**
 * 从战局背包消耗一件道具（qty-1 或整格移除）。
 * 供 UI 实现「副本内使用搜到的回复类道具」；返回被消耗的物品。
 */
export function consumeCarriedItem(state: ExtractionRunState, index: number): LootItem | null {
  if (state.phase !== 'searching') return null;
  const it = state.carriedLoot[index];
  if (!it) return null;
  const q = it.qty ?? 1;
  if (q <= 1) state.carriedLoot.splice(index, 1);
  else it.qty = q - 1;
  return it;
}

/** 搜刮敌方尸体：战斗胜利后的额外战利品机会（霸主尸体必掉高阶装备） */
export function lootCorpse(state: ExtractionRunState, rng: () => number = Math.random): void {
  if (!state.corpse || state.phase !== 'searching') return;
  spendTime(state, ACTION_COST.corpseLoot);
  if (state.phase !== 'searching') return;
  const enemyName = state.corpse.enemyName;
  const wasBoss = !!state.corpse.boss;
  const picks = 1 + Math.floor(rng() * 2);
  const gained: string[] = [];
  for (let i = 0; i < picks; i++) {
    const raw = state.zone.lootTable[Math.floor(rng() * state.zone.lootTable.length)];
    const text = grantLoot(state, raw, rng, 0.1);
    if (text) gained.push(text);
  }
  // 霸主尸体：额外必掉一件高阶装备（保底品阶随地图危险度提升）
  if (wasBoss) {
    const drop = rollGearDrop(
      rng,
      Math.min(9, state.zone.dangerLevel + 2),
      0.6,
      Math.min(6, Math.max(1, state.zone.dangerLevel - 1)),
    );
    if (addCarriedLoot(state, drop)) {
      gained.push(`【${drop.name}】(${drop.rarityName}阶，估值 ${drop.value}) —— 霸主遗物！`);
      plog(state, `👑 霸主遗物：【${drop.name}】（${drop.rarityName}阶，估值 ${drop.value}）。`);
    }
  }
  state.corpse = undefined;
  const lootText = gained.length > 0 ? gained.join('\n') : '尸体上只有弹壳与血迹，一无所获。';
  state.scene = `你翻检【${enemyName}】的尸体……\n🩸 搜刮结果：\n${lootText}`;
  plog(state, `🩸 搜刮了【${enemyName}】的尸体。`);
}

// ===== 转移与撤离 =====

/** 前往下一区域：消耗时间、改变风险等级（zoneSearches 按区域独立累计，回来仍是搜干净的） */
export function moveToZone(state: ExtractionRunState, zone: DangerZone): void {
  if (state.phase !== 'searching' || state.encounter || state.atExtract) return;
  if (zone.id === state.zone.id) return;
  spendTime(state, ACTION_COST.move);
  if (state.phase !== 'searching') return;
  state.zone = zone;
  state.scene = [
    `你穿过废墟间的缝隙，转移到了【${zone.name}】。`,
    `${zone.flavor}`,
    `本区剩余搜索机会：${MAX_ZONE_SEARCHES}/${MAX_ZONE_SEARCHES}。`,
  ].join('\n');
  plog(state, `📍 转移至【${zone.name}】（危${zone.dangerLevel}）。`);
}

/**
 * 深入到本大地图的下一个分支区域（v1.0.2 主路线）：
 * 搜完 3 次 → 深入下一分支；第 MAP_BRANCH_COUNT 区为霸主领地。
 *
 * v1.0.2 转移伏击：分支未彻底探索（<MAX_ZONE_SEARCHES 次）就贸然深入，
 * 有概率被该区域残余的敌人纠缠 —— 且搜得越少概率越高（0 次约 55%，搜满 3 次必定安全）。
 */
export function advanceBranch(state: ExtractionRunState, rng: () => number = Math.random): void {
  if (state.phase !== 'searching' || state.encounter || state.atExtract) return;
  const len = state.map.branches?.length ?? 0;
  if (len === 0 || state.branchIndex >= len - 1) {
    state.scene = '你已站在本图最深处——霸主领地。这里没有更深的区域了。\n（击败霸主或就此撤离，自行决断。）';
    plog(state, '📍 已位于本图最深分支区。');
    return;
  }
  // 转移伏击判定：该分支搜刮次数越多，残余敌人越少，伏击概率越低
  const searched = state.zoneSearches[state.zone.id] ?? 0;
  if (searched < MAX_ZONE_SEARCHES) {
    const ambushChance = 0.55 * (1 - searched / MAX_ZONE_SEARCHES);
    if (rng() < ambushChance) {
      const enemy = pickEnemy(state, rng);
      state.encounter = {
        enemy,
        intro: [
          '⚠️ 转移遭袭！',
          `你收拾行装准备离开【${state.zone.name}】——但未探索彻底的区域里，残余的敌人循着你的动静追了上来！`,
          `一名【${enemy.name}】堵住了退路。${enemy.affixes?.length ? `\n敌方词条：${enemy.affixes.map((a) => a.label).join('、')}` : ''}`,
          '先解决纠缠，才能继续深入：',
          '🔹【主动开战】消耗弹药，开启回合战斗',
          '🔹【潜行绕行】消耗时间，有概率被发现；失败将被迫交战',
          '🔹【投掷物脱离】消耗烟雾弹/闪光弹，必定脱离纠缠',
          '🔹【突围撤离点】放弃深入，直奔撤离位置',
        ].join('\n'),
      };
      state.scene = state.encounter.intro;
      plog(state, `⚠ 转移途中被【${enemy.name}】纠缠（本分支仅搜刮 ${searched}/${MAX_ZONE_SEARCHES} 次）！`);
      return;
    }
  }
  spendTime(state, ACTION_COST.move);
  if (state.phase !== 'searching') return;
  state.branchIndex += 1;
  const nz = branchZone(state.map, state.branchIndex);
  state.zone = nz;
  const bossFloor = state.branchIndex >= len - 1;
  state.scene = [
    `你翻过残垣、沿废弃通道一路深入，抵达【${nz.name}】。`,
    nz.flavor,
    `路线进度：第 ${state.branchIndex + 1}/${MAP_BRANCH_COUNT} 区（危${nz.dangerLevel}）。`,
    ...(bossFloor ? ['⚠ 这里是霸主领地——每一次搜索都可能把它引来！'] : []),
  ].join('\n');
  plog(state, `📍 深入至【${nz.name}】（危${nz.dangerLevel}${bossFloor ? '·霸主区' : ''}）。`);
}

/** 主动奔赴撤离点：消耗时间 */
export function goToExtract(state: ExtractionRunState): void {
  if (state.phase !== 'searching' || state.encounter || state.atExtract) return;
  spendTime(state, ACTION_COST.travel);
  if (state.phase !== 'searching') return;
  state.atExtract = true;
  state.scene = '🚁 你已抵达撤离信号区，救援直升机正在接近。\n【确认撤离】结束本局，背包物资全部入库。\n【继续搜刮】放弃本次机会——贪心者自负风险。';
  plog(state, '🚁 已抵达撤离点，等待撤离确认。');
}

/** 放弃本次撤离，返回地图继续搜刮 */
export function leaveExtract(state: ExtractionRunState): void {
  if (state.phase !== 'searching' || !state.atExtract) return;
  spendTime(state, ACTION_COST.leaveExtract);
  if (state.phase !== 'searching') return;
  state.atExtract = false;
  state.scene = `你咬了咬牙，退出了撤离信号区。\n时间不等人——剩余 ${fmtClock(timeLeft(state))}。`;
  plog(state, '放弃了本次撤离机会，返回继续搜刮。');
}

// ===== 撤离结算 =====

/** 撤离结算：成功→携带+安全箱物资入库 + 救援到的幸存者也带回基地；死亡/超时→仅安全箱保底 */
export function extract(state: ExtractionRunState): ExtractOutcome {
  if (state.phase === 'dead') return 'death';
  if (state.phase === 'timeout') return 'timeout';
  bankSecureIntoBanked(state);
  state.bankedLoot.push(...state.carriedLoot);
  const bankedValue = sumValue(state.bankedLoot);
  state.carriedLoot = [];
  if (state.carriedNpc) {
    state.bankedNpc = state.carriedNpc;
    state.carriedNpc = undefined;
  }
  state.phase = 'extracted';
  state.log.push(`${SYSTEM_LINES.extractSuccess} 入库 ${state.bankedLoot.length} 件，估值 ${bankedValue} 废土币`);
  return 'success';
}

function buildSummary(state: ExtractionRunState, outcome: ExtractOutcome): ExtractionSummary {
  return {
    survivorName: state.survivor.name,
    zoneName: state.zone.name,
    outcome,
    searches: state.searchCount,
    carriedValue: sumValue(state.carriedLoot),
    bankedValue: sumValue(state.bankedLoot),
    hpLeft: state.condition.resources.hp.current,
    hpMax: state.condition.resources.hp.max ?? 0,
  };
}

/** 确定性随机（mulberry32），让 Demo 可复现 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 一键演示：搜几次 → 遭遇则自动开战 → 搜尸 → 最终撤离。
 * 返回完整状态机 + 结算摘要，供上层（CLI / 前端 / 测试）消费。
 */
export function runAutoExtraction(opts: {
  survivor: SurvivorLoadout;
  zone: DangerZone;
  rng?: () => number;
  maxSearches?: number;
}): { state: ExtractionRunState; summary: ExtractionSummary } {
  const rng = opts.rng ?? Math.random;
  const state = createRun(opts.survivor, opts.zone);
  const maxSearches = opts.maxSearches ?? 4;
  let i = 0;
  while (i < maxSearches && state.phase === 'searching') {
    search(state, rng);
    if (state.encounter) resolveEncounter(state, 'fight', rng);
    if (state.corpse) lootCorpse(state, rng);
    i++;
  }
  const outcome: ExtractOutcome =
    state.phase === 'dead' ? 'death' : state.phase === 'timeout' ? 'timeout' : extract(state);
  return { state, summary: buildSummary(state, outcome) };
}

export { sumValue };
