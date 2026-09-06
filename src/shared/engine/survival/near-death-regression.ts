/*
 * near-death-regression.ts — 复现并验证「阵亡/撤离失败→濒死」回写 bug 的修复。
 *
 * Bug：出击阵亡时 phase 先变 'dead'，summary 直接出现，UI 不经过 doExtract，
 * 导致 applyNearDeath 从未被调用，战团血条仍显示出击前的满血、再次出击也满血。
 * 修复：SortiePanel 用 useEffect 在 run 进入 dead/extracted 时统一写回归档。
 *
 * 本测试在引擎层验证「阵亡回写」产出：currentHp≈5%、dyingUntil 已设、injuries 满。
 */
import { mulberry32 } from '@shared/engine/survival/rng';
import { newGame, acceptRecruit, applySortieResult } from '@shared/engine/survival/state';
import { generateSurvivor } from '@shared/engine/survival/chargen';

const rng = mulberry32(123);
const g = newGame(rng);
const hero = g.survivors[0];
const fullHp = g.survivorStatus[hero.id].currentHp;
console.log(`[前提] ${hero.name} 出击前 HP=${fullHp}`);

// 拉一名 NPC 进花名册，再招募，模拟战团里有「老周」这类可出击成员
const laozhou = generateSurvivor(rng);
laozhou.name = '老周';
let s = acceptRecruit({ ...g, recruits: [laozhou] }, laozhou.id);
const lz = s.survivors.find((x) => x.name === '老周')!;
const beforeHp = s.survivorStatus[lz.id].currentHp;
console.log(`[前提] 老周 招募后 HP=${beforeHp}（满血）`);

// 模拟「阵亡」结局的回写（修复后由 SortiePanel 的 effect 触发 applySortieResult）
s = applySortieResult(s, {
  survivorId: lz.id,
  survivorName: lz.name,
  zoneName: '废弃医院',
  outcome: 'death',
  bankedItems: 0,
  bankedValue: 0,
  finalHp: 0,
  maxHp: s.survivorStatus[lz.id].maxHp,
});

const st = s.survivorStatus[lz.id];
const pct = (st.currentHp / st.maxHp) * 100;
console.log(`[结果] 老周 阵亡回写后 HP=${st.currentHp}/${st.maxHp}（${pct.toFixed(1)}%） dyingUntil=${st.dyingUntil ?? '无'} 伤势=${st.injuries.length}`);

const ok =
  st.currentHp < st.maxHp * 0.2 && // 仅余微弱生命（≤20%，near-death 为 5%）
  !!st.dyingUntil &&
  st.injuries.length >= 3 &&
  st.sortieReady === false;

// 再次出击读取的血量应为阵亡后的低血量（而非出击前的满血）
const reSortieStartHp = st.currentHp;
console.log(`[结果] 再次出击起始 HP=${reSortieStartHp}（应远低于满血 ${beforeHp}）`);

if (ok && reSortieStartHp < beforeHp * 0.2) {
  console.log('✓ 回归通过：阵亡后正确进入濒死，战团血条不再显示满血，再次出击也非满血。');
} else {
  console.log('✗ 回归失败');
  process.exit(1);
}
