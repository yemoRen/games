/**
 * 最小可玩 Demo 运行入口（搜打撤核心循环可玩验证）
 *
 * 运行： bun run src/shared/engine/extraction/demo.ts
 * 不依赖数据库 / Redis / NATS，仅复用 battle-v5 与 condition。
 */

import { SURVIVOR_PRESETS, DANGER_ZONES, getZone } from './content';
import { runAutoExtraction, mulberry32 } from './ExtractionEngine';
import type { ExtractOutcome } from './types';

function printScenario(title: string, survivorIdx: number, zoneId: string, seed: number): void {
  const survivor = SURVIVOR_PRESETS[survivorIdx];
  const zone = getZone(zoneId);
  const { state, summary } = runAutoExtraction({
    survivor,
    zone,
    rng: mulberry32(seed),
    maxSearches: 3,
  });

  console.log('\n' + '='.repeat(64));
  console.log(`场景：${title}`);
  console.log('='.repeat(64));
  for (const line of state.log) {
    console.log('  ' + line);
  }
  const outcomeText: Record<ExtractOutcome, string> = {
    success: '✔ 撤离成功',
    death: '✘ 阵亡（未撤离物资全失）',
    timeout: '✘ 超时封锁（未撤离物资全失）',
  };
  console.log('-'.repeat(64));
  console.log(
    `结算：${outcomeText[summary.outcome]} | 搜刮 ${summary.searches} 次 | ` +
      `生命 ${summary.hpLeft}/${summary.hpMax} | ` +
      `入库估值 ${summary.bankedValue} 废土币`,
  );
}

console.log('══════════════════════════════════════════════════════════════');
console.log('  《全民求生・系统搜打撤》— Phase 0/1 最小可玩 Demo');
console.log('  引擎复用：battle-v5（真实战斗）+ CultivatorCondition（in-run 状态）');
console.log('══════════════════════════════════════════════════════════════');

// 1) 稳健档：老兵进废弃公寓，低风险高胜率
printScenario('稳健探索：老兵·老周 → 废弃公寓', 0, 'apartment', 12345);

// 2) 高风险高回报：拾荒妹 → 地下研究所（可能阵亡丢装）
printScenario('豪赌：拾荒妹·小满 → 地下研究所', 2, 'research', 777);

// 2.5) 正面击退演示：老兵 → 废弃医院（低危区可正面作战）
printScenario('正面作战：老兵·老周 → 废弃医院', 0, 'hospital', 2024);

// 3) 复现性验证：同种子同结果
printScenario('复现校验（同种子 42）：飞毛腿·阿速 → 军事检查站', 1, 'military', 42);
printScenario('复现校验（同种子 42）：飞毛腿·阿速 → 军事检查站', 1, 'military', 42);

console.log('\n可用区域：', DANGER_ZONES.map((z) => `${z.name}(危${z.dangerLevel})`).join(' / '));
console.log('可用幸存者：', SURVIVOR_PRESETS.map((s) => s.name).join(' / '));
console.log('\nDemo 结束。');
