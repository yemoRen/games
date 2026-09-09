// 冒烟测试：新需求①（实时经验/升级同步）+ 新需求②（副本换装仅改最大血量）
// 仅验证引擎层与档案层的核心数学，不依赖 React。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { grantSortieXp, allocateFreePoint, xpNeededForLevel } from '@shared/engine/survival/state';
import { deriveMaxHp } from '@shared/engine/survival/recovery';
import {
  createRun,
  effectiveRunMaxHp,
  recomputeRunMaxHp,
} from '@shared/engine/extraction/ExtractionEngine';
import { getZone } from '@shared/engine/extraction/content';

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log('  ✓ ' + msg);
  else {
    failed++;
    console.error('  ✗ ' + msg);
  }
}

const baseAttrs: any = { strength: 10, speed: 10, endurance: 10, vitality: 10, spirit: 10, willpower: 10 };
const baseMax = deriveMaxHp(baseAttrs); // 400 + 10*20 + 10*3 = 630

// 最小档案状态（仅含 grantSortieXp / allocateFreePoint 会读取的字段）
function mkState() {
  const sv: any = {
    id: 's1',
    name: '测试',
    isProtagonist: true,
    level: 1,
    xp: 0,
    freePoints: 5,
    attributes: { ...baseAttrs },
    traits: [],
    power: 0,
    tier: 1,
    tierName: '青铜',
    recruitValue: 0,
  };
  return {
    survivors: [sv],
    survivorStatus: {
      s1: { currentHp: baseMax, maxHp: baseMax, injuries: [], sortieReady: true, lastRecoveredAt: new Date().toISOString() },
    },
    log: [],
    sortieHistory: [],
    equipped: {},
    gear: [],
    factionRep: {},
    facilities: { medical: 0, armory: 0, market: 0, training: 0, workshop: 0, watchtower: 0, radio: 0, gym: 0, kitchen: 0, lounge: 0 },
  } as any;
}

console.log('— 需求②：副本换装仅改最大血量（pure helper）—');
{
  const mk = (startMax: number, equipHp: number, cur: number) => {
    const run: any = {
      startMaxHp: startMax,
      baseMaxHp: startMax,
      profileMaxHpBonus: 0,
      equipped: equipHp
        ? [
            {
              slot: 'armor',
              gear: { id: 'g', name: 'A', slot: 'armor', rarity: 'common', modifiers: {}, affixes: [], combat: { hpBonus: equipHp }, value: 1 },
              fromRun: true,
            },
          ]
        : [],
      condition: { resources: { hp: { current: cur, max: startMax } } },
    };
    return run as any;
  };

  const r1 = mk(100, 30, 100);
  assert(effectiveRunMaxHp(r1) === 130, '有效最大血量 = 起点100 + 装备30 = 130');
  recomputeRunMaxHp(r1);
  assert(r1.condition.resources.hp.max === 130, '换装后 max 升到 130');
  assert(r1.condition.resources.hp.current === 100, '换装后 current 不变（100，满血加 max 当前不变）');

  const r2 = mk(100, 30, 130);
  r2.equipped = [];
  recomputeRunMaxHp(r2);
  assert(r2.condition.resources.hp.max === 100, '卸下后 max 降回 100');
  assert(r2.condition.resources.hp.current === 100, '满血卸下后 current 同减到 100');

  const r3 = mk(100, 30, 50);
  r3.equipped = [];
  recomputeRunMaxHp(r3);
  assert(r3.condition.resources.hp.max === 100, '非满血卸下后 max 降到 100');
  assert(r3.condition.resources.hp.current === 50, '非满血卸下后 current 仍 50（不受影响）');

  const r4 = mk(100, 30, 130);
  r4.profileMaxHpBonus = 20;
  assert(effectiveRunMaxHp(r4) === 150, '加点后有效最大 = 130 + 20 = 150');
  recomputeRunMaxHp(r4);
  assert(r4.condition.resources.hp.max === 150 && r4.condition.resources.hp.current === 130, '加点后 max=150，current 保持 130（待 Hub 同步 +20）');
}

console.log('— 需求①：实时经验 / 升级（档案层）—');
{
  const g = mkState();
  const lvl = g.survivors[0].level ?? 1;
  const fp0 = g.survivors[0].freePoints ?? 0;
  const need = xpNeededForLevel(lvl); // Lv.1 -> 100
  const after = grantSortieXp(g, 's1', need);
  const sv2 = after.survivors.find((s: any) => s.id === 's1')!;
  assert(sv2.level === lvl + 1, `击杀获取恰好一级经验 → 等级 ${lvl}→${lvl + 1}`);
  assert((sv2.freePoints ?? 0) === fp0 + 3, `升级获得 +3 自由属性点（${fp0}→${fp0 + 3}）`);
  const st = after.survivorStatus.s1;
  assert(st.currentHp === st.maxHp, '升级后状态回复全满（currentHp == maxHp）');
  assert((st.injuries ?? []).length === 0, '升级后伤势清除');
  assert((sv2.pendingTraitPick ?? []).length === 3, '升级后生成词条三选一候选');

  const big = grantSortieXp(g, 's1', need * 3);
  const bigS = big.survivors.find((s: any) => s.id === 's1')!;
  assert(bigS.level >= lvl + 2, '大量经验可连升多级');
}

console.log('— 需求②/①：体质点 → 最大+当前一起提升（档案层）—');
{
  const g = mkState();
  const before = g.survivorStatus.s1;
  const after = allocateFreePoint(g, 's1', 'vitality');
  const aft = after.survivorStatus.s1;
  assert(aft.maxHp === before.maxHp + 20, `体质 +1 → 最大血量 +20（${before.maxHp}→${aft.maxHp}）`);
  assert(aft.currentHp === before.currentHp + 20, `体质 +1 → 当前血量同 +20（${before.currentHp}→${aft.currentHp}）`);
}

console.log('— 集成：createRun 含气血装备 → 副本 max 计入装备加成 —');
{
  try {
    const g = mkState();
    const loadout: any = {
      id: 's1',
      name: '测试',
      profile: g.survivors[0],
      attributes: { ...baseAttrs },
      bonus: { hpBonus: 0, critBonus: 0, lootLuck: 0, startHpRatio: 0 },
    };
    const gear: any = { id: 'hg', name: '强化护甲', slot: 'armor', rarity: 'rare', modifiers: {}, affixes: [], combat: { hpBonus: 40 }, value: 10, tier: 3 };
    const zone = getZone('apartment');
    const run = createRun(loadout, zone, 100, { current: 40, max: 40 }, 24, {
      equipped: [gear],
      startMaxHp: 600,
      baseMaxHp: 600,
    });
    assert(run.condition.resources.hp.max === 640, `createRun +40 气血装备 → 副本 max = 600 + 40 = ${run.condition.resources.hp.max}`);
    assert(run.profileMaxHpBonus === 0, 'profileMaxHpBonus 初始为 0');
  } catch (e) {
    failed++;
    console.error('  ✗ createRun 集成测试抛错: ' + (e as Error).message);
  }
}

console.log(failed === 0 ? '\n全部通过 ✅' : `\n失败 ${failed} 项 ❌`);
process.exit(failed === 0 ? 0 : 1);
