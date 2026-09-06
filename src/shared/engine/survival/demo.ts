/*
 * demo.ts — 验证 survival 引擎（Phase 2 + 3）整链可用。
 * 运行：bun run src/shared/engine/survival/demo.ts
 */
import {
  seededRng,
  newGame,
  recruitSurvivor,
  bankLoot,
  craftGear,
  equipGear,
  upgradeFacility,
  investFaction,
  buildLoadout,
  computeShelterBonuses,
  RECIPES,
  SHELTER_FACILITIES,
  FACTIONS,
  attrLabel,
  rarityLabel,
  type SurvivalGameState,
} from '@shared/engine/survival';
import {
  createRun,
  search,
  fight,
  extract,
  getZone,
  DANGER_ZONES,
} from '@shared/engine/extraction';
import type { Attributes } from '@shared/types/cultivator';

function printAttrs(a: Attributes) {
  return (Object.keys(a) as (keyof Attributes)[])
    .map((k) => `${attrLabel(k)}${a[k]}`)
    .join(' ');
}

function printSurvivors(state: SurvivalGameState) {
  for (const s of state.survivors) {
    console.log(
      `  - ${s.name}（${rarityLabel(s.rarity)} / ${s.tierName} / 战力${s.power}）[${printAttrs(s.attributes)}]`,
    );
    console.log(`    词条：${s.traits.map((t) => t.name).join('、') || '无'}`);
  }
}

function runSortie(state: SurvivalGameState, zoneId: string, seed: number) {
  const survivor = state.survivors[0];
  const loadout = buildLoadout(state, survivor.id);
  if (!loadout) return;
  const zone = getZone(zoneId);
  const run = createRun(loadout, zone);
  const rng = seededRng(seed);
  for (let i = 0; i < 4 && run.phase === 'searching'; i++) {
    search(run, rng);
    const enemy = run.encounter?.enemy;
    if (enemy) fight(run, enemy, rng);
  }
  if (run.phase === 'searching') extract(run);
  const carried = run.carriedLoot.reduce((s, l) => s + l.value, 0);
  const banked = run.bankedLoot.reduce((s, l) => s + l.value, 0);
  console.log(
    `  出击 ${survivor.name} → ${zone.name}：${run.phase} | 携带${carried} 入库${banked} | HP ${run.condition.resources.hp.current}/${run.condition.resources.hp.max}`,
  );
  return bankLoot(state, run.bankedLoot);
}

console.log('=== 全民求生・系统搜打撤 Demo（Phase 2 + 3）===\n');

const rng = seededRng('seed-demo-2026');
let state = newGame();
console.log('初始幸存者：');
printSurvivors(state);
console.log(`  废土币：${state.coins} | 材料：${state.materials.map((m) => `${m.name}x${m.quantity}`).join(', ')}`);

console.log('\n[招募]');
state = recruitSurvivor(state, rng);
console.log(`  招募后花名册 ${state.survivors.length} 人，废土币 ${state.coins}`);

console.log('\n[出击-搜打撤] 区域：', DANGER_ZONES.map((z) => z.name).join(' / '));
for (const z of DANGER_ZONES.slice(0, 3)) {
  state = runSortie(state, z.id, 100 + z.dangerLevel) ?? state;
}

console.log(`\n[当前] 废土币 ${state.coins}，背包材料 ${state.materials.length} 种`);

console.log('\n[制造改装]');
const recipe = RECIPES[1]; // 改装步枪
const before = state.coins;
const { state: afterCraft, gear } = craftGear(state, rng, recipe.id);
state = afterCraft;
if (gear) {
  console.log(`  造出 ${gear.name}（${gear.rarity}）：词缀 ${gear.affixes.join('、')} | 属性 ${printAttrs(gear.modifiers as Attributes)}`);
  console.log(`  废土币 ${before} → ${state.coins}`);
  // 装备给首个幸存者
  state = equipGear(state, state.survivors[0].id, gear.id);
  console.log(`  已装备给 ${state.survivors[0].name}`);
} else {
  console.log('  材料/废土币不足，未造成功');
}

console.log('\n[避难所建设]');
for (const f of SHELTER_FACILITIES.slice(0, 2)) {
  state = upgradeFacility(state, f.id);
  console.log(`  ${f.name} → ${state.facilities[f.id]} 级`);
}

console.log('\n[势力投资]');
for (const fac of FACTIONS.slice(0, 1)) {
  state = investFaction(state, fac.id);
  console.log(`  ${fac.name} 声望 → ${state.factionRep[fac.id]} 级`);
}

const bonuses = computeShelterBonuses(state.facilities, state.factionRep);
console.log('\n[驻防加成]', JSON.stringify({
  搜刮运势: bonuses.lootLuck.toFixed(2),
  出击初始HP: bonuses.startHpBonus,
  改装折扣: bonuses.craftDiscount.toFixed(2),
}));

console.log('\n[重新推导出击者属性]');
const ld = buildLoadout(state, state.survivors[0].id);
if (ld) console.log(`  ${ld.name}：${printAttrs(ld.attributes)}`);

console.log(`\n最终废土币：${state.coins} | 装备库 ${state.gear.length} 件 | 日志 ${state.log.length} 条`);
console.log('\nDemo 结束 ✅');
