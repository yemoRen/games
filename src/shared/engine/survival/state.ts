/*
 * state.ts — 持久化游戏状态：花名册 / 背包 / 装备 / 货币 / 避难所 / 势力。
 *
 * 纯函数 mutators（不可变更新），UI 层可丢进 React state。
 * 与 extraction 引擎解耦：bankLoot 把入库战利品折算成材料 + 废土币。
 */
import type { Attributes } from '@shared/types/cultivator';
import type { LootItem, CombatBonus } from '@shared/engine/extraction';
import { generateSurvivor, aggregateTraitCombat, makeProtagonist, type SurvivorProfile } from './chargen';
import {
  type GearItem,
  type MaterialItem,
  type MaterialKind,
  type CraftRecipe,
  type GearSlot,
  RECIPES,
  SHELTER_FACILITIES,
  FACTIONS,
  computeShelterBonuses,
  materialCount,
  rollGear,
  MATERIAL_LABEL,
} from './economy';
import { type RNG, mulberry32 } from './rng';
import type { Injury, SurvivorStatus } from './recovery';
import {
  freshStatus,
  recoverAll as recoverAllImpl,
  applyMedicine,
  treatInjury as treatInjuryImpl,
  applyPostSortie as applyPostSortieImpl,
  applyNearDeath as applyNearDeathImpl,
  MED_DURATION_MIN,
} from './recovery';

export interface EquipSlots {
  weapon?: string;
  armor?: string;
  accessory?: string;
}

export interface SurvivalGameState {
  version: number;
  createdAt: string;
  survivors: SurvivorProfile[];
  activeSurvivorId: string | null;
  survivorStatus: Record<string, SurvivorStatus>;
  materials: MaterialItem[];
  gear: GearItem[];
  equipped: Record<string, EquipSlots>;
  medicines: Record<string, number>;
  coins: number;
  facilities: Record<string, number>;
  factionRep: Record<string, number>;
  recruits: SurvivorProfile[];
  sortieHistory: SortieLog[];
  log: string[];
  // === 任选扩展字段（兑换码记录、世界种子、Mirage 解锁等） ===
  claimedQuests?: string[];
  worldSeed?: number;
  mirageUnlocked?: boolean;
  premiumCoins?: number;
  redeemedCodes?: string[];
}

export interface SortieLog {
  id: string;
  at: string;
  survivorName: string;
  zoneName: string;
  outcome: 'success' | 'death' | 'timeout';
  bankedValue: number;
  bankedItems: number;
  enemyFaced?: string;
  rescued?: boolean;
}

const SAVE_VERSION = 1;
const START_COINS = 120;
const START_MEDICINES = { bandage: 3, antibiotic: 2, medkit: 1 };

/** 战团成员上限（含主角） */
export const WARBAND_CAP = 10;

function emptyFacilities(): Record<string, number> {
  const o: Record<string, number> = {};
  for (const f of SHELTER_FACILITIES) o[f.id] = 0;
  return o;
}
function emptyFactionRep(): Record<string, number> {
  const o: Record<string, number> = {};
  for (const f of FACTIONS) o[f.id] = 0;
  return o;
}

function seedMaterials(): MaterialItem[] {
  const kit: { kind: MaterialKind; name: string; qty: number }[] = [
    { kind: 'metal', name: '废金属', qty: 4 },
    { kind: 'electronics', name: '电路板', qty: 2 },
    { kind: 'chems', name: '医用试剂', qty: 2 },
    { kind: 'food', name: '压缩口粮', qty: 3 },
  ];
  return kit.map((k, i) => ({
    id: `mat-seed-${i}`,
    name: k.name,
    kind: k.kind,
    value: 5,
    quantity: k.qty,
  }));
}

export function newGame(rng: RNG): SurvivalGameState {
  const now = Date.now();
  const s1 = generateSurvivor(rng, { name: '老周' });
  const s2 = generateSurvivor(rng, { name: '小满' });
  const status: Record<string, SurvivorStatus> = {};
  status[s1.id] = freshStatus(s1, now);
  status[s2.id] = freshStatus(s2, now);
  return {
    version: SAVE_VERSION,
    createdAt: new Date(now).toISOString(),
    survivors: [s1, s2],
    activeSurvivorId: s1.id,
    survivorStatus: status,
    materials: seedMaterials(),
    gear: [],
    equipped: {},
    medicines: { ...START_MEDICINES },
    coins: START_COINS,
    facilities: emptyFacilities(),
    factionRep: emptyFactionRep(),
    recruits: [],
    sortieHistory: [],
    log: ['【系统】避难所已建立，开始末世求生。'],
  };
}

export function activeSurvivor(state: SurvivalGameState): SurvivorProfile | null {
  return state.survivors.find((s) => s.id === state.activeSurvivorId) ?? null;
}

/**
 * 注册代号时创建的首发存档：仅含一名以玩家代号命名的主角，属性均衡固定。
 * 其余避难所/物资等沿用 newGame 的初始化。
 */
export function createProtagonistGame(name: string, now: number = Date.now()): SurvivalGameState {
  const base = newGame(mulberry32((now >>> 0) || 1));
  const hero = makeProtagonist(name);
  const status: Record<string, SurvivorStatus> = {
    [hero.id]: freshStatus(hero, now),
  };
  return {
    ...base,
    survivors: [hero],
    activeSurvivorId: hero.id,
    survivorStatus: status,
    log: [`【系统】代号「${name}」已在避难所登记，开启末世求生。`, ...base.log].slice(0, 50),
  };
}

export function getGear(state: SurvivalGameState, id: string): GearItem | undefined {
  return state.gear.find((g) => g.id === id);
}

/** 招募费用随花名册规模递增 */
export function recruitCost(state: SurvivalGameState): number {
  return 60 + (state.survivors.length - 2) * 40;
}

export function canRecruit(state: SurvivalGameState): boolean {
  return state.coins >= recruitCost(state);
}

export function recruitSurvivor(
  state: SurvivalGameState,
  rng: RNG,
): SurvivalGameState {
  const cost = recruitCost(state);
  if (state.coins < cost) return state;
  const s = generateSurvivor(rng);
  return {
    ...state,
    coins: state.coins - cost,
    survivors: [...state.survivors, s],
    log: [`【招募】新幸存者 ${s.name} 加入避难所（${s.tierName}）。`, ...state.log].slice(0, 50),
  };
}

/** 入库战利品：折算废土币 + 转为材料进背包 */
export function bankLoot(
  state: SurvivalGameState,
  banked: LootItem[],
): SurvivalGameState {
  if (banked.length === 0) return state;
  let coins = state.coins;
  const materials = [...state.materials];
  const gear = [...state.gear];
  let gearCount = 0;
  for (const item of banked) {
    // 装备掉落：入库为可装备库存（带阶级词缀），不折算为材料/币
    if (item.gear) {
      gear.push(item.gear);
      gearCount += 1;
      continue;
    }
    coins += item.value;
    const kind = inferMaterialKind(item.name);
    const existing = materials.find((m) => m.kind === kind && m.name === item.name);
    if (existing) {
      existing.quantity += 1;
      existing.value = Math.max(existing.value, item.value);
    } else {
      materials.push({
        id: `mat-${item.id}`,
        name: item.name,
        kind,
        value: item.value,
        quantity: 1,
      });
    }
  }
  const gearNote = gearCount > 0 ? `，缴获装备 ${gearCount} 件` : '';
  return {
    ...state,
    coins,
    materials,
    gear,
    log: [`【入库】${banked.length} 件物资折算 ${banked.reduce((s, b) => s + (b.gear ? 0 : b.value), 0)} 废土币${gearNote}。`, ...state.log].slice(0, 50),
  };
}

function inferMaterialKind(name: string): MaterialKind {
  if (/药|试剂|血清|针/.test(name)) return 'chems';
  if (/口粮|食物|罐头/.test(name)) return 'food';
  if (/电子|芯片|电路/.test(name)) return 'electronics';
  if (/异变|组织|肉/.test(name)) return 'mutant';
  if (/金属|零件|钢|枪|甲/.test(name)) return 'metal';
  return 'misc';
}

// ===== 装备 =====

export function equipGear(
  state: SurvivalGameState,
  survivorId: string,
  gearId: string,
): SurvivalGameState {
  const gear = getGear(state, gearId);
  if (!gear) return state;
  const current = state.equipped[survivorId] ?? {};
  // 同槽位旧装备若被替换，不会从 gear 列表删除（仍留在背包，可再换）
  const next: EquipSlots = { ...current, [gear.slot]: gearId };
  // 防止同一件装备同时装备给两个幸存者：从其人处卸下
  const equippedByOthers = Object.entries(state.equipped).filter(
    ([sid, slots]) => sid !== survivorId && Object.values(slots).includes(gearId),
  );
  const equipped = { ...state.equipped, [survivorId]: next };
  for (const [sid] of equippedByOthers) {
    const slots = equipped[sid];
    equipped[sid] = {
      weapon: slots.weapon === gearId ? undefined : slots.weapon,
      armor: slots.armor === gearId ? undefined : slots.armor,
      accessory: slots.accessory === gearId ? undefined : slots.accessory,
    };
  }
  return { ...state, equipped };
}

export function unequipGear(
  state: SurvivalGameState,
  survivorId: string,
  slot: GearSlot,
): SurvivalGameState {
  const current = state.equipped[survivorId] ?? {};
  return {
    ...state,
    equipped: { ...state.equipped, [survivorId]: { ...current, [slot]: undefined } },
  };
}

function equippedGearList(state: SurvivalGameState, survivorId: string): GearItem[] {
  const slots = state.equipped[survivorId] ?? {};
  return [slots.weapon, slots.armor, slots.accessory]
    .map((id) => (id ? getGear(state, id) : undefined))
    .filter((g): g is GearItem => !!g);
}

// ===== 制造改装 =====

export function canCraft(state: SurvivalGameState, recipe: CraftRecipe): boolean {
  const discount = computeShelterBonuses(state.facilities, state.factionRep).craftDiscount;
  const costCoins = Math.round(recipe.costCoins * (1 - discount));
  if (state.coins < costCoins) return false;
  for (const need of recipe.costMaterials) {
    if (materialCount(state.materials, need.kind) < need.qty) return false;
  }
  return true;
}

export function craftCost(state: SurvivalGameState, recipe: CraftRecipe) {
  const discount = computeShelterBonuses(state.facilities, state.factionRep).craftDiscount;
  return {
    coins: Math.round(recipe.costCoins * (1 - discount)),
    materials: recipe.costMaterials,
  };
}

export function craftGear(
  state: SurvivalGameState,
  rng: RNG,
  recipeId: string,
): { state: SurvivalGameState; gear?: GearItem } {
  const recipe = RECIPES.find((r) => r.id === recipeId);
  if (!recipe || !canCraft(state, recipe)) return { state };
  const { coins: costCoins } = craftCost(state, recipe);
  // 扣材料
  let materials = [...state.materials];
  for (const need of recipe.costMaterials) {
    let remaining = need.qty;
    for (const m of materials) {
      if (remaining <= 0) break;
      if (m.kind === need.kind) {
        const take = Math.min(m.quantity, remaining);
        m.quantity -= take;
        remaining -= take;
      }
    }
  }
  materials = materials.filter((m) => m.quantity > 0);
  const gear = rollGear(rng, recipe);
  return {
    state: {
      ...state,
      coins: state.coins - costCoins,
      materials,
      gear: [...state.gear, gear],
      log: [`【改装】造出 ${gear.name}（${gear.rarity}）：${gear.affixes.join('、')}。`, ...state.log].slice(0, 50),
    },
    gear,
  };
}

// ===== 避难所设施 =====

export function nextUpgradeCost(state: SurvivalGameState, facilityId: string): number | null {
  const spec = SHELTER_FACILITIES.find((f) => f.id === facilityId);
  if (!spec) return null;
  const lvl = state.facilities[facilityId] ?? 0;
  if (lvl >= spec.maxLevel) return null;
  return spec.upgradeCost[lvl];
}

export function upgradeFacility(
  state: SurvivalGameState,
  facilityId: string,
): SurvivalGameState {
  const cost = nextUpgradeCost(state, facilityId);
  if (cost == null || state.coins < cost) return state;
  const spec = SHELTER_FACILITIES.find((f) => f.id === facilityId)!;
  return {
    ...state,
    coins: state.coins - cost,
    facilities: { ...state.facilities, [facilityId]: (state.facilities[facilityId] ?? 0) + 1 },
    log: [`【建设】${spec.name} 升至 ${state.facilities[facilityId] + 1} 级。`, ...state.log].slice(0, 50),
  };
}

// ===== 势力 / 战团 =====

export function nextFactionCost(state: SurvivalGameState, factionId: string): number | null {
  const rep = state.factionRep[factionId] ?? 0;
  if (rep >= 5) return null;
  return 50 + rep * 30;
}

export function investFaction(
  state: SurvivalGameState,
  factionId: string,
): SurvivalGameState {
  const cost = nextFactionCost(state, factionId);
  if (cost == null || state.coins < cost) return state;
  const spec = FACTIONS.find((f) => f.id === factionId)!;
  return {
    ...state,
    coins: state.coins - cost,
    factionRep: { ...state.factionRep, [factionId]: (state.factionRep[factionId] ?? 0) + 1 },
    log: [`【势力】与 ${spec.name} 声望提升至 ${state.factionRep[factionId] + 1} 级。`, ...state.log].slice(0, 50),
  };
}

// ===== 出击装配 =====

/**
 * 由存档 + 幸存者推导「出击者」六维属性：
 * 基础属性 + 已装备词缀 + 避难所/势力加成。
 */
export function buildLoadout(
  state: SurvivalGameState,
  survivorId: string,
): { name: string; attributes: Attributes } | null {
  const profile = state.survivors.find((s) => s.id === survivorId);
  if (!profile) return null;
  const bonuses = computeShelterBonuses(state.facilities, state.factionRep);
  const attrs: Attributes = { ...profile.attributes };
  for (const g of equippedGearList(state, survivorId)) {
    for (const k of Object.keys(g.modifiers) as (keyof Attributes)[]) {
      attrs[k] += g.modifiers[k] ?? 0;
    }
  }
  for (const k of Object.keys(bonuses.attrBonus) as (keyof Attributes)[]) {
    attrs[k] += bonuses.attrBonus[k] ?? 0;
  }
  for (const k of Object.keys(bonuses.factionAttrBonus) as (keyof Attributes)[]) {
    attrs[k] += bonuses.factionAttrBonus[k] ?? 0;
  }
  return { name: profile.name, attributes: attrs };
}

// ===== 出击战斗加成聚合（词条 + 装备 + 避难所） =====

/** 已装备装备的战斗词条汇总 */
export function aggregateGearCombat(state: SurvivalGameState, survivorId: string): CombatBonus {
  let hpBonus = 0;
  let critBonus = 0;
  let lootLuck = 0;
  for (const g of equippedGearList(state, survivorId)) {
    const c = g.combat;
    if (!c) continue;
    hpBonus += c.hpBonus ?? 0;
    critBonus += c.critBonus ?? 0;
    lootLuck += c.lootLuck ?? 0;
  }
  return { hpBonus, critBonus, lootLuck, startHpRatio: 0 };
}

/**
 * 推导「完整出击单元」：档案 + 已结算属性 + 战斗加成。
 * 供搜打撤引擎走 createCombatUnitFromCultivator 正式链路（装备/词条进入 battle-v5）。
 */
export function buildSortieLoadout(
  state: SurvivalGameState,
  survivorId: string,
): { name: string; attributes: Attributes; profile: SurvivorProfile; bonus: CombatBonus } | null {
  const profile = state.survivors.find((s) => s.id === survivorId);
  if (!profile) return null;
  const loadout = buildLoadout(state, survivorId);
  if (!loadout) return null;
  const traitC = aggregateTraitCombat(profile.traits);
  const gearC = aggregateGearCombat(state, survivorId);
  const bonuses = computeShelterBonuses(state.facilities, state.factionRep);
  const bonus: CombatBonus = {
    hpBonus: traitC.hpBonus + gearC.hpBonus + bonuses.startHpBonus,
    critBonus: traitC.critBonus + gearC.critBonus,
    lootLuck: traitC.lootLuck + gearC.lootLuck + bonuses.lootLuck,
    startHpRatio: traitC.startHpRatio,
  };
  return { name: profile.name, attributes: loadout.attributes, profile, bonus };
}

export { computeShelterBonuses, MATERIAL_LABEL, RECIPES, SHELTER_FACILITIES, FACTIONS };

// ===== 医疗消耗品 =====

export interface MedicineSpec {
  id: 'bandage' | 'antibiotic' | 'medkit';
  name: string;
  heal: number;
  /** 治疗伤势的效果（清除指定伤势） */
  treats?: Injury[];
  costCoins: number;
  description: string;
}

export const MEDICINES: MedicineSpec[] = [
  { id: 'bandage', name: '止血绷带', heal: 25, costCoins: 15, description: '立即回血 25，无伤势治疗。' },
  { id: 'antibiotic', name: '抗生素', heal: 15, treats: ['infection'], costCoins: 25, description: '立即回血 15，清除感染。' },
  { id: 'medkit', name: '急救箱', heal: 60, treats: ['bleeding', 'shellShock'], costCoins: 60, description: '立即回血 60，清除失血/震伤。' },
];

export function medicineQty(state: SurvivalGameState, id: MedicineSpec['id']): number {
  return state.medicines[id] ?? 0;
}

export function buyMedicine(state: SurvivalGameState, id: MedicineSpec['id'], qty = 1): SurvivalGameState {
  const spec = MEDICINES.find((m) => m.id === id);
  if (!spec) return state;
  const total = spec.costCoins * qty;
  if (state.coins < total) return state;
  return {
    ...state,
    coins: state.coins - total,
    medicines: { ...state.medicines, [id]: (state.medicines[id] ?? 0) + qty },
    log: [`【采购】购买 ${spec.name}×${qty}。`, ...state.log].slice(0, 50),
  };
}

export function applyMedicineToSurvivor(
  state: SurvivalGameState,
  survivorId: string,
  medicineId: MedicineSpec['id'],
  now: number = Date.now(),
): SurvivalGameState {
  const spec = MEDICINES.find((m) => m.id === medicineId);
  if (!spec) return state;
  if ((state.medicines[medicineId] ?? 0) <= 0) return state;
  const status = state.survivorStatus[survivorId];
  if (!status) return state;
  let nextStatus = applyMedicine(status, spec.heal, now);
  if (spec.treats) {
    for (const inj of spec.treats) {
      if (nextStatus.injuries.includes(inj)) {
        nextStatus = treatInjuryImpl(nextStatus, inj);
      }
    }
  }
  // 濒临死亡者用药即脱离濒死（止血/急救稳定伤势）
  if (nextStatus.dyingUntil) {
    nextStatus = {
      ...nextStatus,
      dyingUntil: undefined,
      injuries: nextStatus.injuries.filter((i) => i !== 'bleeding' && i !== 'fracture'),
    };
  }
  return {
    ...state,
    survivorStatus: { ...state.survivorStatus, [survivorId]: nextStatus },
    medicines: { ...state.medicines, [medicineId]: state.medicines[medicineId] - 1 },
    log: [`【医疗】使用 ${spec.name}（${spec.description}）。`, ...state.log].slice(0, 50),
  };
}

/** 用货币救治濒死成员（不消耗药品，按固定费用结算） */
export const NEAR_DEATH_TREAT_COST = 100;

export function treatNearDeathWithCoins(
  state: SurvivalGameState,
  survivorId: string,
  now: number = Date.now(),
): SurvivalGameState {
  const status = state.survivorStatus[survivorId];
  if (!status || !status.dyingUntil) return state; // 非濒死无需救治
  if (state.coins < NEAR_DEATH_TREAT_COST) return state;
  const member = state.survivors.find((s) => s.id === survivorId);
  const nextStatus: SurvivorStatus = {
    ...status,
    currentHp: Math.max(1, Math.round(status.maxHp * 0.5)),
    injuries: status.injuries.filter((i) => i !== 'bleeding' && i !== 'fracture'),
    dyingUntil: undefined,
    lastRecoveredAt: new Date(now).toISOString(),
    sortieReady: false,
  };
  return {
    ...state,
    coins: state.coins - NEAR_DEATH_TREAT_COST,
    survivorStatus: { ...state.survivorStatus, [survivorId]: nextStatus },
    log: [
      `【救治】花费 ${NEAR_DEATH_TREAT_COST} 废土币稳定了 ${member?.name ?? '幸存者'} 的伤势。`,
      ...state.log,
    ].slice(0, 50),
  };
}

// ===== 恢复（HP/伤势/医疗持续） =====

export function recoverAll(state: SurvivalGameState, now: number = Date.now()): SurvivalGameState {
  return recoverAllImpl(state, now);
}

export { MED_DURATION_MIN };

// ===== NPC 招募集合（副本发现的幸存者进入花名册，付费收编） =====

export function addRecruit(state: SurvivalGameState, npc: SurvivorProfile): SurvivalGameState {
  return {
    ...state,
    recruits: [...state.recruits, npc],
    log: [`【救援】发现可招募幸存者 ${npc.name}（${npc.tierName}）。`, ...state.log].slice(0, 50),
  };
}

/** 招募费用按段位阶梯（越厉害越贵） */
export function recruitFee(tier: number): number {
  return [50, 200, 800, 3000, 10000][Math.min(4, Math.max(0, tier - 1))] ?? 10000;
}

export function acceptRecruit(
  state: SurvivalGameState,
  recruitId: string,
  now: number = Date.now(),
): SurvivalGameState {
  const npc = state.recruits.find((r) => r.id === recruitId);
  if (!npc) return state;
  if (state.survivors.length >= WARBAND_CAP) return state; // 战团已满，无法招募
  const fee = recruitFee(npc.tier);
  if (state.coins < fee) return state;
  const status: Record<string, SurvivorStatus> = { ...state.survivorStatus };
  status[npc.id] = freshStatus(npc, now);
  // 记录招募价值，便于日后遣散返还
  const recruited: SurvivorProfile = { ...npc, recruitValue: fee };
  return {
    ...state,
    coins: state.coins - fee,
    survivors: [...state.survivors, recruited],
    survivorStatus: status,
    recruits: state.recruits.filter((r) => r.id !== recruitId),
    activeSurvivorId: state.activeSurvivorId ?? recruited.id,
    log: [`【招募】${npc.name}（${npc.tierName}）入伙，付费 ${fee} 废土币。`, ...state.log].slice(0, 50),
  };
}

/**
 * 遣散战团成员：移出战团、卸下装备、清除状态，并返还 1/3 招募价值。
 * 主角（玩家代号）不可遣散。
 */
export function dismissSurvivor(
  state: SurvivalGameState,
  survivorId: string,
): SurvivalGameState {
  const member = state.survivors.find((s) => s.id === survivorId);
  if (!member) return state;
  if (member.isProtagonist) {
    return {
      ...state,
      log: [`【遣散】主角 ${member.name} 是避难所的核心，不可遣散。`, ...state.log].slice(0, 50),
    };
  }
  const refund = Math.floor((member.recruitValue ?? 0) / 3);
  const survivors = state.survivors.filter((s) => s.id !== survivorId);
  const survivorStatus = { ...state.survivorStatus };
  delete survivorStatus[survivorId];
  const equipped = { ...state.equipped };
  delete equipped[survivorId];
  const activeSurvivorId =
    state.activeSurvivorId === survivorId ? (survivors[0]?.id ?? null) : state.activeSurvivorId;
  return {
    ...state,
    survivors,
    survivorStatus,
    equipped,
    coins: state.coins + refund,
    activeSurvivorId,
    log: [
      `【遣散】${member.name} 离开战团${refund > 0 ? `，返还 ${refund} 废土币（招募价值 1/3）` : ''}。`,
      ...state.log,
    ].slice(0, 50),
  };
}

export function dismissRecruit(state: SurvivalGameState, recruitId: string): SurvivalGameState {
  const npc = state.recruits.find((r) => r.id === recruitId);
  if (!npc) return state;
  return {
    ...state,
    recruits: state.recruits.filter((r) => r.id !== recruitId),
    log: [`【拒收】放走 ${npc.name}。`, ...state.log].slice(0, 50),
  };
}

// ===== 出击结算（回写 HP/伤势/战绩） =====

export interface SortieResultInput {
  survivorId: string;
  survivorName: string;
  zoneName: string;
  outcome: 'success' | 'death';
  bankedItems: number;
  bankedValue: number;
  enemyFaced?: string;
  rescued?: boolean;
  /** 该幸存者此次出击的最终 HP / maxHp（battle-v5 实际值） */
  finalHp: number;
  maxHp: number;
}

export function applySortieResult(state: SurvivalGameState, input: SortieResultInput, now: number = Date.now()): SurvivalGameState {
  const status = state.survivorStatus[input.survivorId];
  if (!status) return state;
  // 用持久化侧 maxHp 兜底：若 battle-v5 给出更大的 maxHp（装备/buff），采纳高值；
  // 但 finalHp 不得超出现有 maxHp。
  const nextMaxHp = Math.max(status.maxHp, input.maxHp);
  const finalHp = Math.max(0, Math.min(nextMaxHp, Math.round(input.finalHp)));
  const damageRatio = 1 - finalHp / Math.max(1, nextMaxHp);
  // 撤离失败/阵亡：幸存者回战团进入「濒死」状态，需救治；长期未救治才真正离世（见 recoverAll）
  const nextStatus = input.outcome === 'death'
    ? applyNearDeathImpl(status, now)
    : applyPostSortieImpl(status, finalHp, damageRatio, now);
  // 同步 maxHp
  nextStatus.maxHp = nextMaxHp;
  const logEntry: SortieLog = {
    id: `sl-${now}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date(now).toISOString(),
    survivorName: input.survivorName,
    zoneName: input.zoneName,
    outcome: input.outcome,
    bankedItems: input.bankedItems,
    bankedValue: input.bankedValue,
    enemyFaced: input.enemyFaced,
    rescued: input.rescued,
  };
  return {
    ...state,
    survivorStatus: { ...state.survivorStatus, [input.survivorId]: nextStatus },
    sortieHistory: [logEntry, ...state.sortieHistory].slice(0, 100),
  };
}

// ===== 任务 / 悬赏（轻量版） =====

export interface DailyQuest {
  id: string;
  name: string;
  desc: string;
  /** 完成条件：出击次数 */
  sortieTarget: number;
  rewardCoins: number;
  rewardMedicineId?: MedicineSpec['id'];
}

export const DAILY_QUESTS: DailyQuest[] = [
  { id: 'q1', name: '每日出击·3 次', desc: '今日完成 3 次搜打撤（任意区域、任意结果）。', sortieTarget: 3, rewardCoins: 80 },
  { id: 'q2', name: '远征·高危区域', desc: '今日完成 1 次危险等级 ≥4 的区域出击。', sortieTarget: 1, rewardCoins: 150, rewardMedicineId: 'antibiotic' },
  { id: 'q3', name: '搜刮行家', desc: '今日累计搜刮 ≥5 次。', sortieTarget: 5, rewardCoins: 60 },
];

export function todayQuestsProgress(state: SurvivalGameState): { quest: DailyQuest; done: number; target: number; doneGoal: boolean; claimed: boolean }[] {
  const today = new Date().toISOString().slice(0, 10);
  const todays = state.sortieHistory.filter((s) => s.at.slice(0, 10) === today);
  const totalSorties = todays.length;
  const highDangerSorties = todays.filter((s) => s.zoneName.includes('地下') || s.zoneName.includes('医院') || s.zoneName.includes('研究所') || s.zoneName.includes('军事')).length;
  const totalSearches = todays.reduce((acc) => acc + 2, 0); // 估算：每次出击按 2 次搜刮
  const claimed = (state as { claimedQuests?: string[] }).claimedQuests ?? [];
  return DAILY_QUESTS.map((q) => {
    let done = 0;
    if (q.id === 'q1') done = totalSorties;
    else if (q.id === 'q2') done = highDangerSorties;
    else if (q.id === 'q3') done = totalSearches;
    return {
      quest: q,
      done: Math.min(done, q.sortieTarget),
      target: q.sortieTarget,
      doneGoal: done >= q.sortieTarget,
      claimed: claimed.includes(today + ':' + q.id),
    };
  });
}

export function claimQuest(state: SurvivalGameState, questId: string): SurvivalGameState {
  const today = new Date().toISOString().slice(0, 10);
  const claimed = (state as { claimedQuests?: string[] }).claimedQuests ?? [];
  const key = today + ':' + questId;
  if (claimed.includes(key)) return state;
  const quest = DAILY_QUESTS.find((q) => q.id === questId);
  if (!quest) return state;
  const progress = todayQuestsProgress(state).find((p) => p.quest.id === questId);
  if (!progress || !progress.doneGoal) return state;
  const medicines = { ...state.medicines };
  if (quest.rewardMedicineId) medicines[quest.rewardMedicineId] = (medicines[quest.rewardMedicineId] ?? 0) + 1;
  return {
    ...state,
    coins: state.coins + quest.rewardCoins,
    medicines,
    log: [`【任务】完成「${quest.name}」，奖励 ${quest.rewardCoins} 废土币${quest.rewardMedicineId ? '+1 ' + (MEDICINES.find((m) => m.id === quest.rewardMedicineId)?.name ?? '') : ''}。`, ...state.log].slice(0, 50),
    claimedQuests: [...claimed, key],
  } as SurvivalGameState;
}
