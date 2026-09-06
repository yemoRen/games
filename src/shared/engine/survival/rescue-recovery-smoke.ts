/*
 * rescue-recovery-smoke.ts — HP 恢复 + 救援事件的快速冒烟测试。
 *
 * 不进 React / 不进路由，纯引擎验证：
 *  1. 出击前 HP=full，结束后回写 HP；
 *  2. 恢复公式：体质的加成、医疗站加成、药物加速、伤势减益；
 *  3. 救援事件：rollRescue 在一次出击中最多 1 次、extract 把 NPC 推进 bankedNpc。
 */
import { mulberry32 } from '@shared/engine/survival/rng';
import { newGame, buildLoadout, acceptRecruit, applySortieResult, applyMedicineToSurvivor, buyMedicine } from '@shared/engine/survival/state';
import { recoverAll, regenPerMinute, timeToFullSeconds } from '@shared/engine/survival/recovery';
import { createRun, search, rollRescue, fight, extract, sumValue } from '@shared/engine/extraction';
import { generateSurvivor } from '@shared/engine/survival/chargen';
import { DANGER_ZONES } from '@shared/engine/extraction/content';

function fmtHp(s: { currentHp: number; maxHp: number }) {
  return `${s.currentHp}/${s.maxHp}`;
}

const rng = mulberry32(42);
const initial = newGame();
const s0 = initial.survivors[0];
const status0 = initial.survivorStatus[s0.id];
console.log(`[1] 新游戏：${s0.name} (体质 ${s0.attributes.vitality}) HP=${fmtHp(status0)}`);

// 出击到中等危险区域
const loadout = buildLoadout(initial, s0.id)!;
const zone = DANGER_ZONES[1]; // 废弃医院
const run = createRun(loadout, zone);
console.log(`[2] 出击初始 HP=${run.condition.resources.hp.current}/${run.condition.resources.hp.max}`);

const localRng = mulberry32(7);
search(run, localRng);
// 救援触发（自己注入 npcGenerator）
const npc = rollRescue(run, localRng, () => generateSurvivor(rng));
console.log(`[3] 救援触发：${npc?.name ?? '无'}（${npc?.tierName}）`);

// 战斗
const enemy = run.encounter?.enemy;
if (enemy) fight(run, enemy, localRng);
console.log(`[4] 战后 HP=${run.condition.resources.hp.current}/${run.condition.resources.hp.max}`);

// 撤离
extract(run);
console.log(`[5] 撤离：banked=${run.bankedLoot.length} (${sumValue(run.bankedLoot)}) npc带出=${run.bankedNpc?.name ?? '无'}`);

// 回写 HP/伤势
let after1 = applySortieResult(initial, {
  survivorId: s0.id,
  survivorName: s0.name,
  zoneName: zone.name,
  outcome: 'success',
  bankedItems: run.bankedLoot.length,
  bankedValue: sumValue(run.bankedLoot),
  rescued: !!run.bankedNpc,
  finalHp: run.condition.resources.hp.current,
  maxHp: run.condition.resources.hp.max ?? 100,
});
console.log(`[6] 回写后 HP=${fmtHp(after1.survivorStatus[s0.id])} 伤势=${JSON.stringify(after1.survivorStatus[s0.id].injuries)}`);

// 接受招募 NPC
if (run.bankedNpc) after1 = { ...after1, recruits: [...after1.recruits, run.bankedNpc] };
if (after1.recruits.length > 0) {
  const beforeFee = after1.coins;
  after1 = acceptRecruit(after1, after1.recruits[0].id);
  console.log(`[7] 招募 ${after1.survivors[after1.survivors.length - 1].name}：扣 ${beforeFee - after1.coins} 币，幸存者 ${after1.survivors.length} 名`);
} else {
  console.log(`[7] 本次出击未救援到幸存者，跳过招募步骤`);
}

// 恢复公式（无伤/无药/无医疗站）
const survivor = after1.survivors[after1.survivors.length - 1];
const st = after1.survivorStatus[survivor.id];
console.log(`[8] 基础恢复速率：${regenPerMinute(survivor, st, after1, Date.now()).toFixed(2)} HP/分（体质 ${survivor.attributes.vitality}）`);

// 加医疗站 Lv3
const after2 = { ...after1, facilities: { ...after1.facilities, medbay: 3 } };
const st2 = after2.survivorStatus[survivor.id];
console.log(`[9] 医疗站 Lv3 后：${regenPerMinute(survivor, st2, after2, Date.now()).toFixed(2)} HP/分`);

// 加伤势（重测）
const after3 = { ...after2 };
after3.survivorStatus[survivor.id] = { ...st2, injuries: ['fracture', 'bleeding'] };
console.log(`[10] 加 2 伤势：${regenPerMinute(survivor, after3.survivorStatus[survivor.id], after3, Date.now()).toFixed(2)} HP/分`);

// 用药物立即回血
let after4 = buyMedicine(after3, 'medkit', 1);
after4 = applyMedicineToSurvivor(after4, survivor.id, 'medkit');
console.log(`[11] 用急救箱后 HP=${fmtHp(after4.survivorStatus[survivor.id])} medActiveUntil=${after4.survivorStatus[survivor.id].medActiveUntil}`);

// 时间推进模拟恢复（用 5 分钟的毫秒）
const future = Date.now() + 5 * 60_000;
const recovered = recoverAll(after4, future);
const recSt = recovered.survivorStatus[survivor.id];
console.log(`[12] 5 分钟后 HP=${fmtHp(recSt)}（伤势 ${recSt.injuries.length} 项）`);

// 满血预计
const eta = timeToFullSeconds(survivor, recSt, recovered, Date.now());
console.log(`[13] 满血还需 ${eta === 0 ? '已满' : eta === Number.POSITIVE_INFINITY ? '需要先治愈伤势' : `${Math.floor(eta / 60)} 分 ${eta % 60} 秒`}`);

console.log('✓ 救援+恢复冒烟测试完成');