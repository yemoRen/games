/**
 * 全民求生・系统搜打撤 — 出击/撤离 玩法页（Phase 1 最小可玩 Demo）
 *
 * 这是一个独立顶层路由（/sortie），不依赖游戏场景注册表，也不走后端：
 * 前端直接 import @shared 的 extraction 引擎在浏览器里跑真实战斗（battle-v5）。
 *
 * 循环：选幸存者 + 区域 → 出击 → 反复「搜刮一轮」（可能触发真实战斗）→ 决定「立即撤离」入库。
 * 死亡/撤离：阵亡则未撤离物资全失；撤离成功则携带物资入库（据点资产保留）。
 */
import { useRef, useState } from 'react';
import Link from '@app/components/router/AppLink';
import {
  createRun,
  extract,
  fight,
  mulberry32,
  search,
  DANGER_ZONES,
  getZone,
  SURVIVOR_PRESETS,
} from '@shared/engine/extraction';
import type { ExtractionRunState } from '@shared/engine/extraction';

const DANGER_LABEL: Record<number, string> = {
  1: '危1·安全',
  2: '危2·谨慎',
  3: '危3·凶险',
  4: '危4·高危',
  5: '危5·死地',
};

export default function SortiePage() {
  const [survivorIdx, setSurvivorIdx] = useState(0);
  const [zoneId, setZoneId] = useState(DANGER_ZONES[0].id);
  const [seed, setSeed] = useState('');
  const [run, setRun] = useState<ExtractionRunState | null>(null);
  const runRef = useRef<ExtractionRunState | null>(null);
  const rngRef = useRef<() => number>(Math.random);

  const sync = () =>
    setRun(runRef.current ? structuredClone(runRef.current) : null);

  const start = () => {
    const survivor = SURVIVOR_PRESETS[survivorIdx];
    const zone = getZone(zoneId);
    runRef.current = createRun(survivor, zone);
    const s = seed.trim();
    rngRef.current = s ? mulberry32((Number(s) >>> 0) || 1) : Math.random;
    sync();
  };

  const doSearch = () => {
    const s = runRef.current;
    if (!s || s.phase !== 'searching') return;
    search(s, rngRef.current);
    const enemy = s.encounter?.enemy;
    if (enemy) fight(s, enemy, rngRef.current);
    sync();
  };

  const doExtract = () => {
    const s = runRef.current;
    if (!s || s.phase === 'dead' || s.phase === 'extracted') return;
    extract(s);
    sync();
  };

  const reset = () => {
    runRef.current = null;
    setRun(null);
  };

  const hp = run?.condition.resources.hp;
  const carried = run?.carriedLoot ?? [];
  const carriedValue = carried.reduce((a, b) => a + b.value, 0);
  const banked = run?.bankedLoot ?? [];
  const bankedValue = banked.reduce((a, b) => a + b.value, 0);
  const isOver = run?.phase === 'dead' || run?.phase === 'extracted';
  const hpPct =
    hp && (hp.max ?? 0) > 0
      ? Math.max(0, (hp.current / (hp.max ?? 0)) * 100)
      : 0;
  const hpColor = hpPct > 50 ? 'bg-emerald-500' : hpPct > 25 ? 'bg-amber-500' : 'bg-rose-600';

  return (
    <div className="min-h-[100svh] bg-zinc-950 px-4 py-6 text-zinc-200 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-wide text-emerald-400">
              全境求生 · 系统搜打撤
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              搜刮物资 → 真实战斗 → 撤离入库。贪则富，怯则安，死则空。
            </p>
          </div>
          <Link
            href="/"
            className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            返回首页
          </Link>
        </header>

        {!run && (
          <ConfigPanel
            survivorIdx={survivorIdx}
            setSurvivorIdx={setSurvivorIdx}
            zoneId={zoneId}
            setZoneId={setZoneId}
            seed={seed}
            setSeed={setSeed}
            onStart={start}
          />
        )}

        {run && (
          <div className="space-y-4">
            {/* 状态条 */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-zinc-400">
                    幸存者：<span className="text-zinc-100">{run.survivor.name}</span>
                  </div>
                  <div className="mt-0.5 text-sm text-zinc-400">
                    区域：<span className="text-zinc-100">{run.zone.name}</span>
                    <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-amber-300">
                      {DANGER_LABEL[run.zone.dangerLevel] ?? `危${run.zone.dangerLevel}`}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-zinc-500">携带估值</div>
                  <div className="text-lg font-semibold text-emerald-400">
                    {carriedValue} <span className="text-xs text-zinc-500">废土币</span>
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs text-zinc-500">
                  <span>生命</span>
                  <span>
                    {hp?.current ?? 0} / {hp?.max ?? 0}
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded bg-zinc-800">
                  <div
                    className={`h-full ${hpColor} transition-all`}
                    style={{ width: `${hpPct}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
              {/* 叙事日志 */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <h2 className="mb-2 text-sm font-medium text-zinc-300">行动记录</h2>
                <div className="max-h-[360px] space-y-1 overflow-y-auto pr-1 font-mono text-[13px] leading-relaxed">
                  {run.log.map((line, i) => (
                    <p
                      key={i}
                      className={
                        line.startsWith('⚔')
                          ? 'text-rose-300'
                          : line.startsWith('✔')
                            ? 'text-emerald-300'
                            : line.startsWith('【生存系统】')
                              ? 'text-sky-300'
                              : 'text-zinc-400'
                      }
                    >
                      {line}
                    </p>
                  ))}
                </div>
              </div>

              {/* 携带栏 */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <h2 className="mb-2 flex items-center justify-between text-sm font-medium text-zinc-300">
                  <span>携带物资</span>
                  <span className="text-xs text-zinc-500">{carried.length} 件</span>
                </h2>
                {carried.length === 0 ? (
                  <p className="text-sm text-zinc-600">尚未搜到任何物资。</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {carried.map((it, i) => (
                      <li
                        key={`${it.id}-${i}`}
                        className="flex items-center justify-between border-b border-zinc-800/60 py-1"
                      >
                        <span className="text-zinc-300">【{it.name}】</span>
                        <span className="text-emerald-400">{it.value}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 border-t border-zinc-800 pt-2 text-xs text-zinc-500">
                  已入库：<span className="text-emerald-400">{bankedValue}</span> 废土币（{banked.length} 件）
                </p>
              </div>
            </div>

            {/* 操作 */}
            {!isOver ? (
              <div className="flex gap-3">
                <button
                  onClick={doSearch}
                  className="flex-1 rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white hover:bg-emerald-500"
                >
                  🛰 搜刮一轮
                </button>
                <button
                  onClick={doExtract}
                  className="flex-1 rounded-lg bg-sky-700 px-4 py-3 font-medium text-white hover:bg-sky-600"
                >
                  🏃 立即撤离
                </button>
              </div>
            ) : (
              <ResultBanner run={run} carriedValue={carriedValue} bankedValue={bankedValue}>
                <div className="flex gap-3">
                  <button
                    onClick={start}
                    className="flex-1 rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white hover:bg-emerald-500"
                  >
                    再次出击
                  </button>
                  <button
                    onClick={reset}
                    className="rounded-lg border border-zinc-700 px-4 py-3 text-zinc-300 hover:bg-zinc-800"
                  >
                    更换配置
                  </button>
                </div>
              </ResultBanner>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ConfigPanel(props: {
  survivorIdx: number;
  setSurvivorIdx: (i: number) => void;
  zoneId: string;
  setZoneId: (id: string) => void;
  seed: string;
  setSeed: (s: string) => void;
  onStart: () => void;
}) {
  return (
    <div className="space-y-5 rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">选择幸存者</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {SURVIVOR_PRESETS.map((s, i) => (
            <button
              key={s.name}
              onClick={() => props.setSurvivorIdx(i)}
              className={`rounded-lg border p-3 text-left transition ${
                props.survivorIdx === i
                  ? 'border-emerald-500 bg-emerald-500/10'
                  : 'border-zinc-700 hover:border-zinc-500'
              }`}
            >
              <div className="font-medium text-zinc-100">{s.name}</div>
              <div className="mt-1 grid grid-cols-3 gap-x-2 text-[11px] text-zinc-500">
                <span>体{s.attributes.vitality}</span>
                <span>力{s.attributes.strength}</span>
                <span>神{s.attributes.spirit}</span>
                <span>耐{s.attributes.endurance}</span>
                <span>速{s.attributes.speed}</span>
                <span>志{s.attributes.willpower}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">选择危险区域</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {DANGER_ZONES.map((z) => (
            <button
              key={z.id}
              onClick={() => props.setZoneId(z.id)}
              className={`rounded-lg border p-3 text-left transition ${
                props.zoneId === z.id
                  ? 'border-emerald-500 bg-emerald-500/10'
                  : 'border-zinc-700 hover:border-zinc-500'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-100">{z.name}</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-amber-300">
                  {DANGER_LABEL[z.dangerLevel] ?? `危${z.dangerLevel}`}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{z.flavor}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-zinc-400">
          随机种子（可选，留空则随机；同种子可复现）
        </label>
        <input
          value={props.seed}
          onChange={(e) => props.setSeed(e.target.value)}
          placeholder="例如 42"
          className="w-32 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-200 outline-none focus:border-emerald-500"
        />
        <button
          onClick={props.onStart}
          className="ml-auto rounded-lg bg-emerald-600 px-6 py-2.5 font-medium text-white hover:bg-emerald-500"
        >
          出击 ▶
        </button>
      </section>
    </div>
  );
}

function ResultBanner(props: {
  run: ExtractionRunState;
  carriedValue: number;
  bankedValue: number;
  children: React.ReactNode;
}) {
  const success = props.run.phase === 'extracted';
  return (
    <div
      className={`rounded-lg border p-5 ${
        success
          ? 'border-emerald-700 bg-emerald-900/30'
          : 'border-rose-800 bg-rose-900/30'
      }`}
    >
      <h2
        className={`mb-1 text-lg font-semibold ${
          success ? 'text-emerald-300' : 'text-rose-300'
        }`}
      >
        {success ? '✔ 撤离成功' : '✘ 行动失败'}
      </h2>
      <p className="mb-3 text-sm text-zinc-300">
        {success
          ? `物资已安全入库，估值 ${props.bankedValue} 废土币。`
          : `未撤离的 ${props.carriedValue} 废土币物资已遗失，据点资产不受影响。`}
      </p>
      {props.children}
    </div>
  );
}
