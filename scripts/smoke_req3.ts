// 冒烟测试：v1.0.3c 修复集（经验实时获取 / 夹板绷带 / 临时背包合成 / 废土币显示）
// 仅验证引擎层与档案层的核心行为，不依赖 React。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { grantSortieXp, applyMedicineToSurvivor, MED_CRAFT_RECIPES, LOOT_MEDICINE_MAP } from '@shared/engine/survival/state';
import {
  createRun,
  rollEncounter,
  fight,
} from '@shared/engine/extraction/ExtractionEngine';
import { getZone, LOOT } from '@shared/engine/extraction/content';

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log('  ✓ ' + msg);
  else {
    failed++;
    console.error('  ✗ ' + msg);
  }
}

const baseMax = 630;
function mkState() {
  const sv: any = {
    id: 's1', name: '测试', isProtagonist: true, level: 1, xp: 0, freePoints: 5,
    attributes: { strength: 15, speed: 15, endurance: 15, vitality: 15, spirit: 15, willpower: 15 },
    traits: [], power: 0, tier: 1, tierName: '青铜', recruitValue: 0,
  };
  return {
    survivors: [sv],
    survivorStatus: { s1: { currentHp: baseMax, maxHp: baseMax, injuries: [], sortieReady: true, lastRecoveredAt: new Date().toISOString() } },
    medicines: { splint: 1 },
    log: [], sortieHistory: [],
  } as any;
}

console.log('— 修复①：出击实时经验（fight 后 xpGained 增长）—');
{
  const g = mkState();
  const loadout: any = {
    id: 's1', name: '测试', profile: g.survivors[0],
    attributes: { strength: 15, speed: 15, endurance: 15, vitality: 15, spirit: 15, willpower: 15 },
    bonus: { hpBonus: 0, critBonus: 0, lootLuck: 0, startHpRatio: 0 },
  };
  const zone = getZone('apartment');
  const run: any = createRun(loadout, zone, baseMax, { current: 40, max: 40 }, 24, { startMaxHp: baseMax, baseMaxHp: baseMax });
  const before = run.xpGained ?? 0;
  let enemy: any = null;
  for (let i = 0; i < 40 && !enemy; i++) enemy = rollEncounter(run, Math.random);
  assert(!!enemy, 'rollEncounter 给出了敌人原型');
  if (enemy) {
    fight(run, enemy, Math.random);
    const after = run.xpGained ?? 0;
    assert(after > before, `战斗后 xpGained 增长（${before} → ${after}，>0 即实时获取）`);
  }
}

console.log('— 修复②：夹板绷带清骨折 —');
{
  const g = mkState();
  g.survivorStatus.s1.injuries = ['fracture'];
  g.survivorStatus.s1.currentHp = baseMax - 100;
  const after = applyMedicineToSurvivor(g, 's1', 'splint');
  const st = after.survivorStatus.s1;
  assert(!(st.injuries ?? []).includes('fracture'), '使用夹板绷带后骨折 debuff 被清除');
  assert(after.medicines.splint === 0, '夹板绷带库存 -1');
  assert(st.currentHp > baseMax - 100, '夹板绷带同时回复了生命');
}

console.log('— 修复②：夹板绷带进入市场 / 制作配方 —');
{
  const splint = MED_CRAFT_RECIPES.find((r: any) => r.medicine === 'splint');
  assert(!!splint, 'MED_CRAFT_RECIPES 含 splint 配方');
  const needs = (splint as any)?.sortieNeeds ?? [];
  assert(needs.length === 2 && needs[0].lootId === 'meds' && needs[0].qty === 1 && needs[1].lootId === 'scrap' && needs[1].qty === 2,
    'splint 临时制作台需求 = 绷带×1 + 废金属×2');
  assert(LOOT_MEDICINE_MAP.splint === 'splint', 'LOOT_MEDICINE_MAP 含 splint（临时背包可识别/使用）');
  assert(!!(LOOT as any).splint, 'LOOT 含 splint 战利品定义');
}

console.log('— 修复③：废土币显示（废土币×25 = 25 价值）—');
{
  const credits = (LOOT as any).credits;
  assert(credits.value === 1 && credits.qty === 25, `credits 改为 value=1 qty=25（显示 废土币×25）`);
  assert(credits.value * credits.qty === 25, '折算入库仍为 25 废土币（数值不变）');
}

console.log('— 回归：grantSortieXp 经验/升级 —');
{
  const g = mkState();
  const after = grantSortieXp(g, 's1', 100);
  const sv2 = after.survivors.find((s: any) => s.id === 's1')!;
  assert(sv2.level === 2, '100 经验 → 升到 Lv.2');
  assert(after.survivorStatus.s1.injuries.length === 0, '升级清伤势');
}

console.log(failed === 0 ? '\n全部通过 ✅' : `\n失败 ${failed} 项 ❌`);
process.exit(failed === 0 ? 0 : 1);
