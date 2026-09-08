/*
 * menu/views.tsx — 末世行止菜单各子页面实现。
 *
 * 每个 subView 接收统一签名：(state, mutate, setState) => JSX.Element，
 * mutate(fn) 走不可变更新、setState 直接替换（极少用）。
 * 实现原则：能复用真实引擎的就复用（医疗/任务/战绩/招募集合），
 * 否则保持轻量占位（拍卖/赌战等需后端支持的项）。
 */
import { useEffect, useMemo, useState } from 'react';
import { attrLabel, rarityLabel } from '@shared/engine/survival/chargen';
import type { Attributes } from '@shared/types/cultivator';
import type { SurvivalGameState, SortieLog } from '@shared/engine/survival/state';
import {
  bankLoot,
  craftGear,
  buyMedicine,
  applyMedicineToSurvivor,
  acceptRecruit,
  dismissRecruit,
  addRecruit,
  applySortieResult,
  MEDICINES,
  type MedicineSpec,
  MED_CRAFT_RECIPES,
  canCraftMedicine,
  craftMedicine,
  recruitFee,
  treatNearDeathWithCoins,
  NEAR_DEATH_TREAT_COST,
  WARBAND_CAP,
  todayQuestsProgress,
  claimQuest,
  buildSortieLoadout,
  recoverAll,
  GARDEN_CROPS,
  plantGardenCrop,
  harvestGardenPlot,
  clearGardenPlot,
  emptyGardenPlots,
  createProtagonistGame,
} from '@shared/engine/survival/state';
import type { RNG } from '@shared/engine/survival/rng';
import {
  RECIPES,
  MATERIAL_LABEL,
  materialCount,
  FACTIONS,
} from '@shared/engine/survival/economy';
import { INJURY_LABEL, regenPerMinute, timeToFullSeconds } from '@shared/engine/survival/recovery';
import { generateSurvivor } from '@shared/engine/survival/chargen';
import { createRun, search, rollRescue, fight, extract, mulberry32, sumValue } from '@shared/engine/extraction';
import { DANGER_ZONES } from '@shared/engine/extraction/content';

type Mutate = (fn: (s: SurvivalGameState) => SurvivalGameState) => void;
type SetState = React.Dispatch<React.SetStateAction<SurvivalGameState>>;

interface ViewProps {
  state: SurvivalGameState;
  mutate: Mutate;
  setState: SetState;
  rng: RNG;
}

const Section: React.FC<{ title: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode }> = ({ title, subtitle, children, right }) => (
  <div className="space-y-4">
    <div className="flex items-end justify-between gap-4 border-b border-zinc-800 pb-3">
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
      </div>
      {right}
    </div>
    {children}
  </div>
);

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={`rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm ${className ?? ''}`}>{children}</div>
);

const Pill: React.FC<{ children: React.ReactNode; tone?: 'green' | 'red' | 'amber' | 'sky' | 'stone' }> = ({ children, tone = 'stone' }) => {
  const map: Record<string, string> = {
    green: 'bg-emerald-900/40 text-emerald-300',
    red: 'bg-rose-900/40 text-rose-300',
    amber: 'bg-amber-900/40 text-amber-300',
    sky: 'bg-sky-900/40 text-sky-300',
    stone: 'bg-zinc-800 text-zinc-200',
  };
  return <span className={`inline-block rounded px-2 py-0.5 text-xs ${map[tone]}`}>{children}</span>;
};

const AttrBar: React.FC<{ label: string; value: number; max: number }> = ({ label, value, max }) => (
  <div className="flex items-center gap-2 text-xs">
    <span className="w-10 text-zinc-400">{label}</span>
    <div className="h-1.5 flex-1 overflow-hidden rounded bg-zinc-800">
      <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </div>
    <span className="w-8 text-right font-mono text-zinc-200">{value}</span>
  </div>
);

const hpBar = (current: number, max: number) => {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  const tone = pct > 60 ? 'bg-emerald-950/300' : pct > 30 ? 'bg-amber-950/300' : 'bg-rose-950/300';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-6 text-zinc-400">HP</span>
      <div className="h-2 flex-1 overflow-hidden rounded bg-zinc-800">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 text-right font-mono text-zinc-200">{current}/{max}</span>
    </div>
  );
};

// ===== 1. 避难所菜园（6 块地，种植状态持久化到存档） =====
export const ViewGarden: React.FC<ViewProps> = ({ state, mutate }) => {
  const gardenLevel = state.facilities['garden'] ?? 0;
  // 旧存档可能没有 gardenPlots，用空 6 地块兜底；新存档与种植动作都走 persist
  const plots = state.gardenPlots && state.gardenPlots.length > 0 ? state.gardenPlots : emptyGardenPlots();
  const [sel, setSel] = useState<Record<number, string>>({}); // 每块地当前选中的作物
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const cropName = (id: string | null) =>
    id ? (GARDEN_CROPS.find((c) => c.id === id)?.name ?? id) : '';

  return (
    <Section
      title="避难所·菜园"
      subtitle="6 块地，每块可任选一种作物种植。成熟后收获换医疗品 / 废土币。种植状态已存档，切走再切回不会丢失。"
    >
      <div className="mb-3 flex items-center gap-2 text-sm text-zinc-300">
        <Pill tone="sky">菜园等级 {gardenLevel}</Pill>
        <span className="text-xs">每升 1 级收成时间 -10%（下限 30%）</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {plots.map((plot, idx) => {
          const crop = plot.cropId ? GARDEN_CROPS.find((c) => c.id === plot.cropId) : null;
          const ready = plot.readyAt != null && now >= plot.readyAt;
          const leftMin = plot.readyAt && !ready ? Math.max(0, Math.ceil((plot.readyAt - now) / 60_000)) : 0;
          return (
            <Card key={idx}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-100">第 {idx + 1} 块地</div>
                {!plot.cropId && <span className="text-xs text-zinc-500">空地</span>}
                {plot.cropId && !ready && <span className="text-xs text-amber-300">种植中…</span>}
                {ready && <span className="text-xs font-medium text-emerald-300">已成熟</span>}
              </div>

              {!plot.cropId ? (
                <div className="mt-3 space-y-2">
                  <select
                    value={sel[idx] ?? ''}
                    onChange={(e) => setSel((s) => ({ ...s, [idx]: e.target.value }))}
                    className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
                  >
                    <option value="">选择作物…</option>
                    {GARDEN_CROPS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.icon} {c.name}（{c.minutes} 分钟 →{' '}
                        {c.yields ? MEDICINES.find((m) => m.id === c.yields)?.name : `+${c.coins} 废土币`}）
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!sel[idx]}
                    onClick={() => {
                      if (!sel[idx]) return;
                      mutate((s) => plantGardenCrop(s, idx, sel[idx], Date.now()));
                      setSel((s) => ({ ...s, [idx]: '' }));
                    }}
                    className="w-full rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    种植
                  </button>
                </div>
              ) : (
                <div className="mt-3">
                  <div className="text-base font-semibold text-zinc-100">
                    {crop?.icon} {cropName(plot.cropId)}
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">
                    收成：
                    {crop?.yields
                      ? `${MEDICINES.find((m) => m.id === crop.yields)?.name}×${crop.qty}`
                      : `+${crop?.coins} 废土币`}
                  </div>
                  {ready ? (
                    <button
                      onClick={() => mutate((s) => harvestGardenPlot(s, idx, Date.now()))}
                      className="mt-3 w-full rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      收获
                    </button>
                  ) : (
                    <div className="mt-3 text-xs text-zinc-400">剩余约 {leftMin} 分钟成熟</div>
                  )}
                  <button
                    onClick={() => mutate((s) => clearGardenPlot(s, idx))}
                    className="mt-2 w-full rounded border border-zinc-700 px-3 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800"
                  >
                    铲除重种
                  </button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </Section>
  );
};

// ===== 1b. 医疗制作 =====
export const ViewCraft: React.FC<ViewProps> = ({ state, mutate }) => {
  return (
    <Section title="医疗·制作台" subtitle="用废土材料合成医疗品，无副本也能补给。">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MED_CRAFT_RECIPES.map((r) => {
          const med = MEDICINES.find((m) => m.id === r.medicine);
          const ok = canCraftMedicine(state, r);
          return (
            <Card key={r.id}>
              <div className="text-base font-semibold text-zinc-100">{r.name}</div>
              <div className="mt-1 text-xs text-zinc-400">
                产出：{med ? `${med.name}（${Math.round(med.healPct * 100)}%生命+${med.healFlat}）` : r.medicine}
              </div>
              <ul className="mt-2 space-y-1 text-xs">
                {r.costMaterials.map((c) => {
                  const have = materialCount(state.materials, c.kind);
                  return (
                    <li key={c.kind} className={have >= c.qty ? 'text-emerald-300' : 'text-rose-300'}>
                      {MATERIAL_LABEL[c.kind]} ×{c.qty}（持有 {have}）
                    </li>
                  );
                })}
                <li className="text-zinc-400">废土币 ⛁{r.costCoins}</li>
              </ul>
              <button
                onClick={() => mutate((s) => craftMedicine(s, r.id))}
                disabled={!ok}
                className="mt-3 w-full rounded bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-700 disabled:opacity-40"
              >
                {ok ? '合成' : '材料/币不足'}
              </button>
            </Card>
          );
        })}
      </div>
    </Section>
  );
};

// ===== 2. 战术手册 =====
export const ViewTactics: React.FC<ViewProps> = ({ state }) => {
  const active = state.survivors.find((s) => s.id === state.activeSurvivorId);
  if (!active) return <Section title="战术手册"><div className="text-zinc-400">未指定出击者。</div></Section>;
  return (
    <Section title="战术手册" subtitle={`当前出击者：${active.name}（${active.tierName}）`}>
      <Card>
        <h3 className="text-sm font-semibold text-zinc-200">六维基础属性</h3>
        <div className="mt-3 space-y-2">
          {(Object.keys(active.attributes) as (keyof Attributes)[]).map((k) => (
            <AttrBar key={k} label={attrLabel(k)} value={active.attributes[k]} max={30} />
          ))}
        </div>
      </Card>
      <Card>
        <h3 className="text-sm font-semibold text-zinc-200">被动技·战斗词条</h3>
        {active.traits.length === 0 ? (
          <div className="mt-2 text-sm text-zinc-400">无词条。</div>
        ) : (
          <ul className="mt-2 space-y-2 text-sm text-zinc-200">
            {active.traits.map((t) => (
              <li key={t.id} className="rounded bg-zinc-950 p-2">
                <div className="font-medium text-zinc-100">{t.name}</div>
                <div className="text-xs text-zinc-400">{t.description}</div>
                {(t.combat ||
                  Object.keys(t.modifiers ?? {}).some(
                    (k) => (t.modifiers?.[k as keyof Attributes] ?? 0) !== 0,
                  )) && (
                  <div className="mt-1 flex flex-wrap gap-1 text-xs">
                    {(Object.keys(t.modifiers ?? {}) as (keyof Attributes)[])
                      .filter((k) => (t.modifiers?.[k] ?? 0) !== 0)
                      .map((k) => (
                        <Pill key={k} tone="green">{attrLabel(k)} +{t.modifiers?.[k]}</Pill>
                      ))}
                    {t.combat?.hpBonus && <Pill tone="green">HP +{t.combat.hpBonus}</Pill>}
                    {t.combat?.critBonus && <Pill tone="amber">暴击 +{Math.round(t.combat.critBonus * 100)}%</Pill>}
                    {t.combat?.lootLuck && <Pill tone="sky">搜刮 +{Math.round(t.combat.lootLuck * 100)}%</Pill>}
                    {t.combat?.startHpRatio && <Pill>初始 HP +{Math.round(t.combat.startHpRatio * 100)}%</Pill>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Section>
  );
};

// ===== 3. 掌握技能（词条总览） =====
export const ViewSkills: React.FC<ViewProps> = ({ state }) => (
  <Section title="掌握技能" subtitle="全员词条与被动一览。">
    <div className="space-y-3">
      {state.survivors.map((s) => (
        <Card key={s.id}>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-base font-semibold text-zinc-100">{s.name}</span>
              <span className="ml-2 text-xs text-zinc-400">{s.tierName} · 战力 {s.power}</span>
            </div>
            <Pill tone="sky">{rarityLabel(s.rarity)}</Pill>
          </div>
          <ul className="mt-2 flex flex-wrap gap-1 text-xs">
            {s.traits.map((t) => (
              <li key={t.id} className="rounded bg-emerald-950/30 px-2 py-1 text-emerald-300">{t.name}</li>
            ))}
            {s.traits.length === 0 && <li className="text-zinc-400">（无被动技能）</li>}
          </ul>
        </Card>
      ))}
    </div>
  </Section>
);

// ===== 4. 战团技能 =====
export const ViewFactionSkills: React.FC<ViewProps> = ({ state }) => (
  <Section title="战团技能" subtitle="各势力达成特定声望后解锁的被动。">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {FACTIONS.map((f) => {
        const rep = state.factionRep[f.id] ?? 0;
        return (
          <Card key={f.id}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-base font-semibold text-zinc-100">{f.name}</div>
                <div className="text-xs text-zinc-400">{f.description}</div>
              </div>
              <Pill tone={rep > 0 ? 'sky' : 'stone'}>声望 {rep} / 5</Pill>
            </div>
            <ul className="mt-2 text-xs text-zinc-200">
              {Object.entries(f.attrPerRepLevel).map(([k, v]) => (
                <li key={k}>· 每级 全队 {attrLabel(k as keyof Attributes)} +{v}</li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  </Section>
);

// ===== 5. 全部战绩 =====
export const ViewBattleLog: React.FC<ViewProps> = ({ state }) => (
  <Section title="全部战绩" subtitle={`累计出击 ${state.sortieHistory.length} 次。`}>
    {state.sortieHistory.length === 0 ? (
      <Card><div className="text-sm text-zinc-400">尚无出击记录。前往「出击」体验首次搜打撤。</div></Card>
    ) : (
      <div className="space-y-2">
        {state.sortieHistory.slice(0, 30).map((s: SortieLog) => (
          <Card key={s.id} className="!p-3">
            <div className="flex items-center justify-between text-sm">
              <div>
                <span className="font-semibold text-zinc-100">{s.survivorName}</span>
                <span className="mx-1 text-zinc-500">→</span>
                <span>{s.zoneName}</span>
              </div>
              <Pill tone={s.outcome === 'success' ? 'green' : s.outcome === 'death' ? 'red' : 'amber'}>
                {s.outcome === 'success' ? '撤离成功' : s.outcome === 'death' ? '阵亡' : '超时'}
              </Pill>
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-400">
              <span>{new Date(s.at).toLocaleString()}</span>
              <span>入库 {s.bankedItems} 件 / {s.bankedValue} 废土币</span>
              {s.enemyFaced && <span>· 敌人 {s.enemyFaced}</span>}
              {s.rescued && <Pill tone="sky">救援</Pill>}
            </div>
          </Card>
        ))}
      </div>
    )}
  </Section>
);

// ===== 6. 探险日志（区域发现） =====
export const ViewExplorationNotes: React.FC<ViewProps> = ({ state }) => {
  const discovered = new Set(state.sortieHistory.map((s) => s.zoneName));
  return (
    <Section title="探险札记" subtitle="每次成功出击会解锁该区域的札记条目。">
      <div className="grid gap-3 sm:grid-cols-2">
        {DANGER_ZONES.map((z) => {
          const known = discovered.has(z.name);
          return (
            <Card key={z.id}>
              <div className="flex items-center justify-between">
                <div className="text-base font-semibold text-zinc-100">{known ? z.name : '【未探索】'}</div>
                <Pill tone={z.dangerLevel >= 4 ? 'red' : z.dangerLevel >= 2 ? 'amber' : 'green'}>危险 {z.dangerLevel}</Pill>
              </div>
              {known ? (
                <div className="mt-2 text-sm text-zinc-300">{z.flavor}</div>
              ) : (
                <div className="mt-2 text-sm text-zinc-500">完成该区域出击以解锁详细描述。</div>
              )}
            </Card>
          );
        })}
      </div>
    </Section>
  );
};

// ===== 7. 漫游搜打撤（自动出击） =====
export const ViewWandering: React.FC<ViewProps> = ({ state, mutate, rng }) => {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const runOnce = () => {
    const active = state.survivors.find((s) => s.id === state.activeSurvivorId);
    if (!active) return;
    const loadout = buildSortieLoadout(state, active.id);
    if (!loadout) return;
    const zone = DANGER_ZONES[Math.floor(rng() * DANGER_ZONES.length)];
    const seed = Math.floor(rng() * 2 ** 31);
    const localRng = mulberry32(seed);
    const run = createRun(loadout, zone);
    search(run, localRng);
    rollRescue(run, localRng, () => generateSurvivor(rng));
    const enemy = run.encounter?.enemy;
    if (enemy) fight(run, enemy, localRng);
    search(run, localRng);
    extract(run);
    const outcome = run.phase === 'dead' ? 'death' : 'success';
    const bankedValue = sumValue(run.bankedLoot);
    mutate((s) => {
      let ns = bankLoot(s, run.bankedLoot);
      if (run.bankedNpc) ns = addRecruit(ns, run.bankedNpc);
      return applySortieResult(ns, {
        survivorId: active.id,
        survivorName: active.name,
        zoneName: zone.name,
        outcome,
        bankedItems: run.bankedLoot.length,
        bankedValue,
        enemyFaced: enemy?.name,
        rescued: !!run.bankedNpc,
        finalHp: run.condition.resources.hp.current,
        maxHp: run.condition.resources.hp.max ?? 100,
      });
    });
    setLog([`[${new Date().toLocaleTimeString()}] ${active.name} → ${zone.name}：${outcome === 'success' ? `入库 ${run.bankedLoot.length} 件` : '阵亡，丢装'}`, ...log].slice(0, 10));
  };
  return (
    <Section title="漫游搜打撤" subtitle="随机选出击者+区域，自动跑一次出击。">
      <div className="mb-4 flex items-center gap-3">
        <button onClick={() => { setRunning(true); runOnce(); setRunning(false); }} disabled={running} className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700 disabled:opacity-40">
          派出一支小队
        </button>
        <span className="text-xs text-zinc-400">最近 10 次记录（仅本菜单会话内存）</span>
      </div>
      <div className="space-y-1">
        {log.map((l, i) => (
          <div key={i} className="rounded bg-zinc-950 px-3 py-1 text-xs text-zinc-200">{l}</div>
        ))}
        {log.length === 0 && <div className="text-sm text-zinc-500">还没有记录。</div>}
      </div>
    </Section>
  );
};

// ===== 8. 蜃景密室（高危特殊区域） =====
export const ViewMirage: React.FC<ViewProps> = ({ state, mutate, rng }) => {
  const unlockCost = 200;
  const alreadyUnlocked = (state as { mirageUnlocked?: boolean }).mirageUnlocked === true;
  const unlocked = alreadyUnlocked;
  const enter = () => {
    const active = state.survivors.find((s) => s.id === state.activeSurvivorId);
    if (!active) return;
    const loadout = buildSortieLoadout(state, active.id);
    if (!loadout) return;
    const zone = DANGER_ZONES[4] ?? DANGER_ZONES[DANGER_ZONES.length - 1]; // 地下研究所
    const seed = Math.floor(rng() * 2 ** 31);
    const localRng = mulberry32(seed);
    const run = createRun(loadout, zone);
    search(run, localRng);
    search(run, localRng);
    const enemy = run.encounter?.enemy;
    if (enemy) fight(run, enemy, localRng);
    rollRescue(run, localRng, () => generateSurvivor(rng));
    extract(run);
    const outcome = run.phase === 'dead' ? 'death' : 'success';
    mutate((s) => {
      let ns = bankLoot(s, run.bankedLoot);
      if (run.bankedNpc) ns = addRecruit(ns, run.bankedNpc);
      return applySortieResult(ns, {
        survivorId: active.id,
        survivorName: active.name,
        zoneName: zone.name,
        outcome,
        bankedItems: run.bankedLoot.length,
        bankedValue: sumValue(run.bankedLoot),
        enemyFaced: enemy?.name,
        rescued: !!run.bankedNpc,
        finalHp: run.condition.resources.hp.current,
        maxHp: run.condition.resources.hp.max ?? 100,
      });
    });
  };
  return (
    <Section title="蜃景密室" subtitle="危险等级 5 的扭曲时空，高风险高回报。">
      {!unlocked ? (
        <Card>
          <div className="text-sm text-zinc-200">解锁费用 {unlockCost} 废土币（一次性）。</div>
          <button
            onClick={() => state.coins >= unlockCost && mutate((s) => ({ ...s, coins: s.coins - unlockCost, mirageUnlocked: true } as SurvivalGameState))}
            disabled={state.coins < unlockCost}
            className="mt-3 rounded bg-purple-600 px-4 py-2 text-white hover:bg-purple-700 disabled:opacity-40"
          >
            消耗 {unlockCost} 进入
          </button>
        </Card>
      ) : (
        <Card>
          <div className="text-sm text-zinc-200">已解锁。每点一次按钮即派当前出击者跑一次最高危区域。</div>
          <button onClick={enter} className="mt-3 rounded bg-purple-600 px-4 py-2 text-white hover:bg-purple-700">进入蜃景密室</button>
        </Card>
      )}
    </Section>
  );
};

// ===== 9. 重塑天赋 =====
export const ViewRerollTrait: React.FC<ViewProps> = ({ state, mutate, rng }) => {
  const active = state.survivors.find((s) => s.id === state.activeSurvivorId);
  if (!active) return <Section title="重塑天赋"><div className="text-zinc-400">未指定出击者。</div></Section>;
  const cost = 80 + active.tier * 60;
  const reroll = () => {
    if (state.coins < cost) return;
    mutate((s) => {
      const idx = s.survivors.findIndex((x) => x.id === active.id);
      if (idx < 0) return s;
      const fresh = generateSurvivor(rng, { name: active.name });
      const next = [...s.survivors];
      next[idx] = fresh;
      return { ...s, survivors: next, coins: s.coins - cost, log: [`【重塑】${active.name} 天赋重置。`, ...s.log].slice(0, 50) };
    });
  };
  return (
    <Section title="重塑天赋" subtitle={`当前出击者：${active.name}（${active.tierName}）`}>
      <Card>
        <div className="text-sm text-zinc-200">保留名字/段位，词条与基础属性全部重随。</div>
        <div className="mt-2 text-xs text-zinc-400">费用：{cost} 废土币 · 当前余额 {state.coins}</div>
        <button onClick={reroll} disabled={state.coins < cost} className="mt-3 rounded bg-amber-600 px-4 py-2 text-white hover:bg-amber-700 disabled:opacity-40">
          消耗 {cost} 重塑
        </button>
      </Card>
    </Section>
  );
};

// ===== 10. 任务中心 =====
export const ViewQuests: React.FC<ViewProps> = ({ state, mutate }) => {
  const progress = useMemo(() => todayQuestsProgress(state), [state]);
  return (
    <Section title="任务中心" subtitle="每日悬赏：完成出击目标领取废土币与医疗物资。">
      <div className="space-y-3">
        {progress.map(({ quest, done, target, doneGoal, claimed }) => (
          <Card key={quest.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-zinc-100">{quest.name}</div>
                <div className="text-sm text-zinc-400">{quest.desc}</div>
                <div className="mt-2 text-xs text-zinc-400">进度 {done} / {target}</div>
              </div>
              <div className="text-right">
                <Pill tone={claimed ? 'stone' : doneGoal ? 'green' : 'amber'}>
                  {claimed ? '已领' : doneGoal ? '可领' : '进行中'}
                </Pill>
                <div className="mt-2 text-xs text-zinc-300">奖励 {quest.rewardCoins} 废土币{quest.rewardMedicineId && '+1 ' + (MEDICINES.find((m) => m.id === quest.rewardMedicineId)?.name ?? '')}</div>
                <button
                  onClick={() => mutate((s) => claimQuest(s, quest.id))}
                  disabled={!doneGoal || claimed}
                  className="mt-2 rounded bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-40"
                >领取</button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </Section>
  );
};

// ===== 11. 废土市场（NPC 交易） =====
export const ViewMarket: React.FC<ViewProps> = ({ state, mutate }) => {
  // v1.0.2：购买需二次确认防误触；支持批量 ×1 / ×5；确认后扣币入库
  const [pending, setPending] = useState<{ id: MedicineSpec['id']; qty: number } | null>(null);
  const [bought, setBought] = useState<string | null>(null);

  const doBuy = (id: MedicineSpec['id'], qty: number) => {
    const spec = MEDICINES.find((m) => m.id === id);
    if (!spec) return;
    mutate((s) => buyMedicine(s, id, qty));
    setBought(`✅ 已购买 ${spec.name}×${qty}，消耗 ${spec.costCoins * qty} 废土币（库存 +${qty}）。`);
    setPending(null);
  };

  return (
    <Section title="废土市场" subtitle="从市集购入医疗物资、卖出多余材料。">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <h3 className="font-semibold text-zinc-100">购入医疗品</h3>
          <p className="mt-1 text-xs text-zinc-400">
            当前废土币：<span className="font-medium text-zinc-200">{state.coins}</span>
          </p>
          {bought && <div className="mt-2 rounded border border-emerald-800 bg-emerald-950/30 px-2 py-1 text-xs text-emerald-300">{bought}</div>}
          <div className="mt-3 space-y-3">
            {MEDICINES.map((m) => {
              const stock = state.medicines[m.id] ?? 0;
              const isPending = pending?.id === m.id;
              const qty = isPending ? pending.qty : 1;
              const total = m.costCoins * qty;
              const afford = state.coins >= m.costCoins;
              const affordQty = state.coins >= total;
              return (
                <div key={m.id} className="rounded border border-zinc-800 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-zinc-100">
                        {m.name}
                        <span className="ml-2 text-xs text-zinc-400">库存 ×{stock}</span>
                      </div>
                      <div className="text-xs text-zinc-400">{m.description}</div>
                      <div className="mt-0.5 text-xs text-zinc-300">单价 {m.costCoins} 废土币</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {[1, 5].map((q) => (
                        <button
                          key={q}
                          onClick={() => { setPending({ id: m.id, qty: q }); setBought(null); }}
                          disabled={!afford}
                          className={`rounded px-2 py-1 text-xs transition ${
                            isPending && qty === q
                              ? 'bg-sky-700 text-white'
                              : 'bg-sky-600 text-white hover:bg-sky-700'
                          } disabled:opacity-40`}
                        >
                          ×{q}
                        </button>
                      ))}
                    </div>
                  </div>
                  {isPending && (
                    <div className="mt-2 flex items-center justify-between rounded border border-amber-700 bg-amber-950/30 px-2 py-1.5">
                      <span className="text-xs text-amber-300">
                        确认购买 {m.name}×{qty}？将消耗 <span className="font-semibold">{total}</span> 废土币
                        {!affordQty && '（废土币不足！）'}
                      </span>
                      <span className="flex gap-1">
                        <button
                          onClick={() => doBuy(m.id, qty)}
                          disabled={!affordQty}
                          className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-40"
                        >
                          确认购买
                        </button>
                        <button
                          onClick={() => setPending(null)}
                          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                        >
                          取消
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
        <Card>
          <h3 className="font-semibold text-zinc-100">回收材料（10 币/件）</h3>
          <p className="mt-1 text-xs text-zinc-400">将 1 件任意材料按 10 废土币出售（演示用，简化模型）。</p>
          <button
            onClick={() => mutate((s) => {
              if (s.materials.length === 0) return s;
              const next = [...s.materials];
              const m = next[0];
              const left = m.quantity - 1;
              const mats = left > 0 ? next.map((x, i) => i === 0 ? { ...x, quantity: left } : x) : next.filter((_, i) => i !== 0);
              return { ...s, materials: mats, coins: s.coins + 10, log: [`【回收】卖出 ${m.name}×1，+10 废土币。`, ...s.log].slice(0, 50) };
            })}
            disabled={state.materials.length === 0}
            className="mt-3 rounded bg-stone-600 px-3 py-1 text-xs text-white hover:bg-stone-700 disabled:opacity-40"
          >出售 1 件</button>
        </Card>
      </div>
    </Section>
  );
};

// ===== 12. 鉴物回收（消耗材料随机得装备） =====
export const ViewRecycle: React.FC<ViewProps> = ({ state, mutate, rng }) => {
  return (
    <Section title="鉴物回收" subtitle="消耗材料随机改装为装备，有概率产出高稀有度词缀。">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {RECIPES.map((r) => {
          const can = (() => {
            if (state.coins < r.costCoins) return false;
            for (const need of r.costMaterials) {
              const have = state.materials.filter((m) => m.kind === need.kind).reduce((acc, m) => acc + m.quantity, 0);
              if (have < need.qty) return false;
            }
            return true;
          })();
          return (
            <Card key={r.id}>
              <div className="flex items-center justify-between">
                <div className="font-semibold text-zinc-100">{r.name}</div>
                <Pill>{r.rarity}</Pill>
              </div>
              <div className="mt-2 text-xs text-zinc-400">
                费用 {r.costCoins} 币 · 材料 {r.costMaterials.map((m) => `${MATERIAL_LABEL[m.kind]}×${m.qty}`).join('、')}
              </div>
              <button
                onClick={() => mutate((s) => craftGear(s, rng, r.id).state)}
                disabled={!can}
                className="mt-3 rounded bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-700 disabled:opacity-40"
              >改装</button>
            </Card>
          );
        })}
      </div>
    </Section>
  );
};

// ===== 13. 英雄商城（钻石货币占位） =====
export const ViewPremiumShop: React.FC<ViewProps> = ({ state, mutate }) => {
  const items = [
    { id: 'p1', name: '传说幸存者召唤券', cost: 100, desc: '使用后获得一名传奇幸存者。' },
    { id: 'p2', name: '全队满血包', cost: 30, desc: '所有幸存者立即满血。' },
    { id: 'p3', name: '装备升星符', cost: 50, desc: '将一件装备升 1 级。' },
  ];
  const premium = (state as { premiumCoins?: number }).premiumCoins ?? 0;
  return (
    <Section title="英雄商城" subtitle="使用废土钻石（演示货币）购买稀有道具。">
      <Card className="mb-3 !bg-amber-950/30">
        <div className="text-sm text-amber-300">当前钻石：{premium}</div>
        <button onClick={() => mutate((s) => ({ ...s, premiumCoins: (premium ?? 0) + 10 } as SurvivalGameState))} className="mt-2 rounded bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-700">+10（演示按钮）</button>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <Card key={it.id}>
            <div className="font-semibold text-zinc-100">{it.name}</div>
            <div className="mt-1 text-xs text-zinc-400">{it.desc}</div>
            <button disabled className="mt-3 rounded bg-zinc-700 px-3 py-1 text-xs text-white">兑换（暂未开放）</button>
          </Card>
        ))}
      </div>
    </Section>
  );
};

// ===== 14. 拍卖行（占位） =====
export const ViewAuction: React.FC = () => (
  <Section title="拍卖行" subtitle="玩家间物品竞拍（需服务端，本地未启用）">
    <Card>
      <div className="text-sm text-zinc-300">
        拍卖行依赖实时出价与历史成交，本地单用户存档无法承载。功能已锁定以等待后端支持。
      </div>
      <div className="mt-3 text-xs text-zinc-500">建议路径：列表/出价/成交/历史</div>
    </Card>
  </Section>
);

// ===== 15. 英雄榜 =====
export const ViewLeaderboard: React.FC<ViewProps> = ({ state }) => {
  const sorted = [...state.survivors].sort((a, b) => b.power - a.power);
  return (
    <Section title="英雄榜" subtitle="按战力排序的花名册（前 30 名）。">
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-400">
              <th className="py-1">#</th>
              <th>姓名</th>
              <th>段位</th>
              <th>战力</th>
              <th>稀有度</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => (
              <tr key={s.id} className="border-t border-zinc-800">
                <td className="py-2 font-mono text-zinc-400">{i + 1}</td>
                <td className="font-medium">{s.name}</td>
                <td className="text-zinc-300">{s.tierName}</td>
                <td className="font-mono">{s.power}</td>
                <td><Pill>{rarityLabel(s.rarity)}</Pill></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Section>
  );
};

// ===== 16. 末世赌局（占位） =====
export const ViewWager: React.FC = () => (
  <Section title="末世赌局" subtitle="以废土币押注其他幸存者的 PvP 战斗结果">
    <Card>
      <div className="text-sm text-zinc-300">需 PvP 匹配与见证，本地未启用。</div>
    </Card>
  </Section>
);

// ===== 17. 擂台切磋（占位） =====
export const ViewArena: React.FC = () => (
  <Section title="擂台切磋" subtitle="与其他玩家 1v1 对决">
    <Card>
      <div className="text-sm text-zinc-300">需 PvP 匹配，本地未启用。</div>
    </Card>
  </Section>
);

// ===== 18. 世界传闻 =====
export const ViewNews: React.FC<ViewProps> = ({ state }) => {
  // 由战役历史 + 当前状态派生
  const messages: { tone: 'green' | 'red' | 'amber' | 'sky' | 'stone'; text: string }[] = [];
  const today = state.sortieHistory.filter((s) => s.at.slice(0, 10) === new Date().toISOString().slice(0, 10));
  if (today.length > 0) messages.push({ tone: 'sky', text: `今日共记录 ${today.length} 次出击，最近一次由 ${today[0].survivorName} 在【${today[0].zoneName}】执行。` });
  if (state.recruits.length > 0) messages.push({ tone: 'amber', text: `幸存者花名册里还有 ${state.recruits.length} 名待招募幸存者，用废土币招募后可入战团。` });
  if (state.survivors.some((s) => (state.survivorStatus[s.id]?.injuries.length ?? 0) > 0)) {
    messages.push({ tone: 'red', text: '部分队员带伤，请关注「医疗」面板。' });
  }
  const completed = state.sortieHistory.length;
  if (completed >= 5) messages.push({ tone: 'stone', text: `累计出击 ${completed} 次，已算是一名老练的拾荒人。` });
  if (state.coins >= 1000) messages.push({ tone: 'green', text: '废土币储备充裕，可以考虑升级避难所设施。' });
  if (messages.length === 0) messages.push({ tone: 'stone', text: '一切平静——末世最稀缺的奢侈品。' });
  return (
    <Section title="世界传闻" subtitle="系统从最近出击/避难所状态聚合而成的情报摘要。">
      <div className="space-y-2">
        {messages.map((m, i) => (
          <Card key={i} className="!p-3">
            <div className="flex items-start gap-2">
              <Pill tone={m.tone}>{m.tone === 'green' ? '利好' : m.tone === 'red' ? '警报' : m.tone === 'amber' ? '提醒' : m.tone === 'sky' ? '情报' : '日常'}</Pill>
              <div className="text-sm text-zinc-200">{m.text}</div>
            </div>
          </Card>
        ))}
      </div>
    </Section>
  );
};

// ===== 19. 兑换码 =====
export const ViewRedeem: React.FC<ViewProps> = ({ state, mutate }) => {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const apply = () => {
    const valid: Record<string, { coins: number; med?: 'bandage' | 'antibiotic' | 'medkit'; qty?: number }> = {
      'WASTELAND2026': { coins: 200, med: 'bandage', qty: 3 },
      'FIRSTSTEP': { coins: 100 },
      'LASTHOPE': { coins: 500, med: 'medkit', qty: 1 },
    };
    const used = (state as { redeemedCodes?: string[] }).redeemedCodes ?? [];
    if (!valid[code]) {
      setMsg('兑换码无效');
      return;
    }
    if (used.includes(code)) {
      setMsg('该兑换码已使用');
      return;
    }
    const r = valid[code];
    mutate((s) => {
      const ns: SurvivalGameState = { ...s, coins: s.coins + r.coins, redeemedCodes: [...used, code] } as SurvivalGameState;
      if (r.med) ns.medicines = { ...ns.medicines, [r.med]: (ns.medicines[r.med] ?? 0) + (r.qty ?? 1) };
      return ns;
    });
    setMsg(`兑换成功：+${r.coins} 废土币${r.med ? ` +${r.med}×${r.qty ?? 1}` : ''}`);
  };
  return (
    <Section title="兑换码" subtitle="输入官方兑换码获得物资。">
      <Card>
        <div className="flex items-center gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="输入兑换码"
            className="flex-1 rounded border border-zinc-700 px-3 py-2 text-sm"
          />
          <button onClick={apply} className="rounded bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700">兑换</button>
        </div>
        {msg && <div className="mt-2 text-xs text-zinc-300">{msg}</div>}
        <div className="mt-3 text-xs text-zinc-500">演示码：WASTELAND2026 / FIRSTSTEP / LASTHOPE</div>
      </Card>
    </Section>
  );
};

// ===== 20. 救济簿（捐赠/善举记录） =====
export const ViewMerit: React.FC<ViewProps> = ({ state }) => {
  const merit = state.sortieHistory.filter((s) => s.rescued).length;
  const deaths = state.sortieHistory.filter((s) => s.outcome === 'death').length;
  const recruits = state.recruits.length + merit;
  return (
    <Section title="救济簿" subtitle="系统自动统计你的善举与代价。">
      <Card>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-2xl font-bold text-emerald-300">{merit}</div>
            <div className="mt-1 text-xs text-zinc-400">累计救援</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-300">{recruits}</div>
            <div className="mt-1 text-xs text-zinc-400">待招募集合</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-rose-300">{deaths}</div>
            <div className="mt-1 text-xs text-zinc-400">队员牺牲</div>
          </div>
        </div>
      </Card>
      <div className="mt-3 text-xs text-zinc-500">* 仅统计本存档。多次出击叠加。</div>
    </Section>
  );
};

// ===== 21. 幸存者社群（占位） =====
export const ViewCommunity: React.FC = () => (
  <Section title="幸存者社群" subtitle="玩家交流群">
    <Card>
      <div className="text-sm text-zinc-300">本地单人版本不展示真实社群入口。正式版会接入官方 QQ/Discord 群链接。</div>
    </Card>
  </Section>
);

// ===== 22. 意见反馈（占位） =====
export const ViewFeedback: React.FC = () => (
  <Section title="意见反馈" subtitle="把体验上的问题告诉我们">
    <Card>
      <textarea rows={4} placeholder="写下你的建议…" className="w-full rounded border border-zinc-700 p-2 text-sm" disabled />
      <div className="mt-2 text-xs text-zinc-500">（演示版本：服务端未启用，正式环境会写入反馈表）</div>
    </Card>
  </Section>
);

// ===== 23. 系统设置 =====
export const ViewSettings: React.FC<ViewProps> = ({ state, mutate }) => {
  const [confirmReset, setConfirmReset] = useState(false);
  const seed = ((state as { worldSeed?: number }).worldSeed ?? new Date(state.createdAt).getTime()) || 1;
  return (
    <Section title="系统设置">
      <Card>
        <h3 className="font-semibold text-zinc-100">存档</h3>
        <div className="mt-2 text-xs text-zinc-400">本存档创建于 {new Date(state.createdAt).toLocaleString()}。</div>
        <div className="mt-3 flex gap-2">
          {confirmReset ? (
            <>
              <span className="self-center text-xs text-rose-300">确认重置？将清空并重建以玩家代号命名的主角（不可撤销）</span>
              <button
                onClick={() => {
                  mutate((s) => createProtagonistGame(s.playerCodename || s.survivors[0]?.name || '幸存者'));
                  setConfirmReset(false);
                }}
                className="rounded bg-rose-600 px-3 py-1 text-xs text-white hover:bg-rose-700"
              >确认</button>
              <button
                onClick={() => setConfirmReset(false)}
                className="rounded bg-stone-600 px-3 py-1 text-xs text-white hover:bg-stone-700"
              >取消</button>
            </>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="rounded bg-rose-600 px-3 py-1 text-xs text-white hover:bg-rose-700"
            >重置存档</button>
          )}
        </div>
      </Card>
      <Card>
        <h3 className="font-semibold text-zinc-100">世界种子</h3>
        <div className="mt-1 text-xs text-zinc-400">不同种子会让区域、敌人、战利品生成有微妙差异。</div>
        <div className="mt-3 flex items-center gap-2">
          <span className="font-mono text-sm">{seed}</span>
          <button
            onClick={() => mutate((s) => ({ ...s, worldSeed: Date.now() } as SurvivalGameState))}
            className="rounded bg-stone-600 px-3 py-1 text-xs text-white hover:bg-stone-700"
          >换种子</button>
        </div>
      </Card>
    </Section>
  );
};

// ===== 24. 幸存者花名册（副本中找到、待招募的幸存者） =====
export const ViewRecruits: React.FC<ViewProps> = ({ state, mutate }) => {
  const full = state.survivors.length >= WARBAND_CAP;
  return (
    <Section
      title="幸存者花名册"
      subtitle={`目前 ${state.recruits.length} 名待招募 · 战团 ${state.survivors.length}/${WARBAND_CAP}`}
    >
      {state.recruits.length === 0 ? (
        <Card><div className="text-sm text-zinc-400">暂无待招募成员。出击搜打撤时，有概率在副本中救出幸存者，他们会先进入这里的花名册，用废土币招募后加入战团。越厉害的幸存者招募费越高。</div></Card>
      ) : (
        <div className="space-y-2">
          {state.recruits.map((r) => {
            const fee = recruitFee(r.tier);
            const canAfford = state.coins >= fee && !full;
            return (
              <Card key={r.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-zinc-100">{r.name}</div>
                    <div className="text-xs text-zinc-400">{r.tierName} · 战力 {r.power}</div>
                    <ul className="mt-1 flex flex-wrap gap-1 text-xs">
                      {r.traits.map((t) => <li key={t.id} className="rounded bg-sky-950/40 px-1.5 py-0.5 text-sky-300">{t.name}</li>)}
                    </ul>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-zinc-400">招募费 {fee}</div>
                    <div className="mt-2 flex gap-1">
                      <button
                        onClick={() => mutate((s) => acceptRecruit(s, r.id))}
                        disabled={!canAfford}
                        className="rounded bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-40"
                        title={full ? '战团已满，需先遣散' : state.coins < fee ? '废土币不足' : ''}
                      >招募</button>
                      <button onClick={() => mutate((s) => dismissRecruit(s, r.id))} className="rounded bg-zinc-9500 px-3 py-1 text-xs text-white hover:bg-stone-600">放走</button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {full && <div className="text-xs text-rose-300">战团已满（{WARBAND_CAP} 人），无法招募新成员，请先在「战团成员」中遣散腾位。</div>}
    </Section>
  );
};

// ===== 25. 医疗中心（HP/伤势/药品） =====
export const ViewMedical: React.FC<ViewProps> = ({ state, mutate, setState }) => {
  const [now, setNow] = useState(0);
  // 每次进入页面应用一次时间戳恢复
  useEffect(() => {
    const healed = recoverAll(state);
    if (healed !== state) setState(healed);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Section title="医疗中心" subtitle="按时间戳结算全员恢复；伤势越重越慢。">
      <div className="space-y-3">
        {state.survivors.map((s) => {
          const status = state.survivorStatus[s.id];
          if (!status) return null;
          const rate = regenPerMinute(s, status, state, now);
          const eta = timeToFullSeconds(s, status, state, now);
          const etaText = eta === 0 ? '已满血' : eta === Number.POSITIVE_INFINITY ? '需要治疗' : `${Math.floor(eta / 60)} 分 ${eta % 60} 秒`;
          const dyingUntil = status.dyingUntil ? new Date(status.dyingUntil).getTime() : 0;
          const isDying = dyingUntil > now;
          const dyingLeft = isDying ? Math.ceil((dyingUntil - now) / 60000) : 0;
          return (
            <Card key={s.id}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-zinc-100">{s.name}</div>
                  <div className="text-xs text-zinc-400">{s.tierName} · 体质 {s.attributes.vitality}</div>
                </div>
                <div className="text-right text-xs text-zinc-400">
                  恢复速率 {rate.toFixed(2)}/分<br />
                  预计满血 {etaText}
                </div>
              </div>
              <div className="mt-3">{hpBar(status.currentHp, status.maxHp)}</div>
              {isDying && (
                <div className="mt-2 rounded border border-rose-800 bg-rose-950/30 p-2 text-xs text-rose-300">
                  <div className="flex items-center justify-between gap-2">
                    <span>☠ 濒死状态·约 {dyingLeft} 分钟内未救治将离世</span>
                    <button
                      onClick={() => mutate((st) => treatNearDeathWithCoins(st, s.id))}
                      disabled={state.coins < NEAR_DEATH_TREAT_COST}
                      className="rounded bg-rose-600 px-2 py-1 text-white hover:bg-rose-700 disabled:opacity-40"
                    >救治（{NEAR_DEATH_TREAT_COST} 币）</button>
                  </div>
                </div>
              )}
              {status.injuries.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1">
                  {status.injuries.map((inj) => (
                    <li key={inj}>
                      <Pill tone="red">{INJURY_LABEL[inj]}</Pill>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {MEDICINES.filter((m) => (state.medicines[m.id] ?? 0) > 0).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => mutate((st) => applyMedicineToSurvivor(st, s.id, m.id))}
                    className="rounded bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-700"
                  >使用 {m.name}（{Math.round(m.healPct * 100)}%生命+{m.healFlat}）</button>
                ))}
                {MEDICINES.every((m) => (state.medicines[m.id] ?? 0) === 0) && (
                  <span className="text-xs text-zinc-500">没有医疗品了，去「废土市场」购买</span>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </Section>
  );
};