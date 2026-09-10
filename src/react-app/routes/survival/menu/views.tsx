/*
 * menu/views.tsx — 末世行止菜单各子页面实现。
 *
 * 每个 subView 接收统一签名：(state, mutate, setState) => JSX.Element，
 * mutate(fn) 走不可变更新、setState 直接替换（极少用）。
 * 实现原则：能复用真实引擎的就复用（医疗/任务/战绩/招募集合），
 * 否则保持轻量占位（拍卖/赌战等需后端支持的项）。
 */
import { useEffect, useMemo, useState } from 'react';
import { ResetSaveDialog } from '../components/ResetSaveDialog';
import { attrLabel, rarityLabel, rarityColor, tierColor, tierNameFromTier, ALL_ATTR_KEYS, rollTraitCandidates, type SurvivorTrait } from '@shared/engine/survival/chargen';
import { affixColor, affixLabel } from '@shared/engine/survival/affixes';
import type { AffixTierKey } from '@shared/engine/survival/affixes';
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
  // v1.1.0：菜园种子
  seedStock,
  buySeeds,
  gardenCropValue,
  gardenCropProfit,
  emptyGardenPlots,
  createProtagonistGame,
  // v1.1.0：行动点 / 重塑六维 / 市场出售
  ACTION_POINT_CAP,
  actionPointView,
  trySpendActionPoints,
  sortieActionPointCost,
  REROLL_ATTR_COST,
  REROLL_TRAIT_COST,
  rerollBaseAttributes,
  rerollTrait,
  // v1.1.0 补充：GM 调试工具
  verifyGmKey,
  gmGrantXp,
  gmGrantCoins,
  gmGrantActionPoints,
  materialSellPrice,
  gearSellPrice,
  sellMaterials,
  recycleGear,
} from '@shared/engine/survival/state';
import type { RNG } from '@shared/engine/survival/rng';
import {
  RECIPES,
  MATERIAL_LABEL,
  materialCount,
  FACTIONS,
  type MaterialItem,
} from '@shared/engine/survival/economy';
import { INJURY_LABEL, regenPerMinute, timeToFullSeconds } from '@shared/engine/survival/recovery';
import { generateSurvivor } from '@shared/engine/survival/chargen';
// v1.1.0：漫游 = 模拟一次完整副本（同源结算）
import { simulateWanderSortie, type WanderReport } from '@shared/engine/survival/wander';
import { createRun, search, rollRescue, fight, extract, mulberry32, sumValue } from '@shared/engine/extraction';
import { DANGER_ZONES } from '@shared/engine/extraction/content';

type Mutate = (fn: (s: SurvivalGameState) => SurvivalGameState) => void;
type SetState = React.Dispatch<React.SetStateAction<SurvivalGameState>>;

interface ViewProps {
  state: SurvivalGameState;
  mutate: Mutate;
  setState: SetState;
  rng: RNG;
  /** v1.0.10 补充：重置存档（含退出出击）。由避难所 Hub 注入；缺省时退化为仅重建档案 */
  onResetGame?: (name: string) => void;
}

const Section: React.FC<{ title: string; subtitle?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }> = ({ title, subtitle, children, right }) => (
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

const Card: React.FC<{ children: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ children, className, style }) => (
  <div className={`rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm ${className ?? ''}`} style={style}>{children}</div>
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

/** 段位徽标：按段位序号取配色与名称（白→红），文字+描边+底色同色系
 * 名称从 tier 推导，避免旧存档 stale tierName 与颜色不一致。
 */
const TierBadge: React.FC<{ tier: number; name?: string; size?: 'sm' | 'md' }> = ({ tier, size = 'md' }) => {
  const c = tierColor(tier);
  const name = tierNameFromTier(tier);
  const pad = size === 'sm' ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold ${pad}`}
      style={{ color: c, borderColor: `${c}66`, background: `${c}1a` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {name}
    </span>
  );
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
  const tone = pct > 60 ? 'bg-emerald-500' : pct > 30 ? 'bg-amber-400' : 'bg-rose-500';
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

// ===== 1. 避难所菜园（6 块地 · v1.1.0：种植消耗种子，种子在下方种子商店购买） =====
export const ViewGarden: React.FC<ViewProps> = ({ state, mutate }) => {
  const gardenLevel = state.facilities['garden'] ?? 0;
  // 旧存档可能没有 gardenPlots，用空 6 地块兜底；新存档与种植动作都走 persist
  const plots = state.gardenPlots && state.gardenPlots.length > 0 ? state.gardenPlots : emptyGardenPlots();
  const [sel, setSel] = useState<Record<number, string>>({}); // 每块地当前选中的作物
  const [now, setNow] = useState(0);
  // v1.1.0：铲除未成熟地块会损失种子，需内联二次确认
  const [confirmClear, setConfirmClear] = useState<number | null>(null);
  const [shopMsg, setShopMsg] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const cropName = (id: string | null) =>
    id ? (GARDEN_CROPS.find((c) => c.id === id)?.name ?? id) : '';
  const productLabel = (c: (typeof GARDEN_CROPS)[number]) =>
    c.yields ? `${MEDICINES.find((m) => m.id === c.yields)?.name ?? c.yields}×${c.qty}` : `+${c.coins} 废土币`;

  const doBuy = (cropId: string, qty: number) => {
    const crop = GARDEN_CROPS.find((c) => c.id === cropId);
    if (!crop) return;
    const total = crop.seedPrice * qty;
    if (state.coins < total) {
      setShopMsg(`⚠ 废土币不足，${crop.name}种子×${qty} 需 ${total} 币。`);
      return;
    }
    mutate((st) => buySeeds(st, cropId, qty));
    setShopMsg(`✅ 购入 ${crop.name}种子×${qty}，花费 ${total} 废土币。`);
  };

  return (
    <Section
      title="避难所·菜园"
      subtitle="6 块地，每块可任选一种作物种植。种植需消耗对应种子（成熟收获后回本并盈利）。种植状态已存档，切走再切回不会丢失。"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
        <Pill tone="sky">菜园等级 {gardenLevel}</Pill>
        <span className="text-xs text-zinc-400">每升 1 级收成时间 -10%（下限 30%）</span>
      </div>

      {/* ===== 种子商店 ===== */}
      <Card className="mb-4">
        <h3 className="font-semibold text-zinc-100">种子商店</h3>
        <p className="mt-1 text-xs text-zinc-400">
          种子价恒低于产物市价，差额即为你等待成熟应得的利润。未成熟就铲除会损失该颗种子。
        </p>
        {shopMsg && (
          <div
            className={`mt-2 rounded border px-2 py-1 text-xs ${
              shopMsg.startsWith('⚠')
                ? 'border-rose-800 bg-rose-950/30 text-rose-300'
                : 'border-emerald-800 bg-emerald-950/30 text-emerald-300'
            }`}
          >
            {shopMsg}
          </div>
        )}
        <div className="mt-3 space-y-1.5">
          {GARDEN_CROPS.map((c) => {
            const stock = seedStock(state, c.id);
            const value = gardenCropValue(c);
            const profit = gardenCropProfit(c);
            return (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-800 px-2 py-1.5"
              >
                <div className="min-w-0">
                  <div className="text-sm text-zinc-100">
                    {c.icon} {c.name}
                    <span className="ml-2 font-mono text-xs text-sky-300">库存 {stock}</span>
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {c.minutes} 分钟 → {productLabel(c)}（市价 {value} 币）· 种子 {c.seedPrice} 币 ·
                    净赚{' '}
                    <span className={profit > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {profit > 0 ? '+' : ''}
                      {profit}
                    </span>{' '}
                    币
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => doBuy(c.id, 1)}
                    disabled={state.coins < c.seedPrice}
                    className="rounded bg-stone-600 px-2 py-1 text-xs text-white hover:bg-stone-700 disabled:opacity-40"
                  >
                    ×1 / {c.seedPrice}
                  </button>
                  <button
                    onClick={() => doBuy(c.id, 5)}
                    disabled={state.coins < c.seedPrice * 5}
                    className="rounded bg-stone-700 px-2 py-1 text-xs text-white hover:bg-stone-600 disabled:opacity-40"
                  >
                    ×5 / {c.seedPrice * 5}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-[11px] text-zinc-500">当前废土币：{state.coins}</div>
      </Card>

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
                        {c.icon} {c.name}（{c.minutes} 分 →{' '}
                        {c.yields ? MEDICINES.find((m) => m.id === c.yields)?.name : `+${c.coins} 废土币`}
                        ）· 种子库存 {seedStock(state, c.id)}
                      </option>
                    ))}
                  </select>
                  {sel[idx] && seedStock(state, sel[idx]) === 0 && (
                    <div className="text-[11px] text-rose-300">
                      ⚠ 没有{cropName(sel[idx])}种子，请先在上方种子商店购买。
                    </div>
                  )}
                  <button
                    disabled={!sel[idx] || seedStock(state, sel[idx]) === 0}
                    onClick={() => {
                      if (!sel[idx]) return;
                      mutate((s) => plantGardenCrop(s, idx, sel[idx], Date.now()));
                      setSel((s) => ({ ...s, [idx]: '' }));
                    }}
                    className="w-full rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                    title={
                      !sel[idx]
                        ? '先选择作物'
                        : seedStock(state, sel[idx]) === 0
                          ? '缺少种子'
                          : `消耗 1 颗${cropName(sel[idx])}种子`
                    }
                  >
                    种植（消耗种子 ×1）
                  </button>
                </div>
              ) : (
                <div className="mt-3">
                  <div className="text-base font-semibold text-zinc-100">
                    {crop?.icon} {cropName(plot.cropId)}
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">收成：{crop ? productLabel(crop) : ''}</div>
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
                  {confirmClear === idx ? (
                    <div className="mt-2 rounded border border-rose-800 bg-rose-950/30 px-2 py-1.5">
                      <div className="text-[11px] text-rose-200">
                        {ready
                          ? '确认铲除？该地块将被清空。'
                          : '⚠ 作物尚未成熟，铲除将损失这颗种子，确认？'}
                      </div>
                      <div className="mt-1.5 flex gap-1.5">
                        <button
                          onClick={() => {
                            mutate((s) => clearGardenPlot(s, idx));
                            setConfirmClear(null);
                          }}
                          className="rounded bg-rose-600 px-2 py-1 text-[11px] text-white hover:bg-rose-700"
                        >
                          确认铲除
                        </button>
                        <button
                          onClick={() => setConfirmClear(null)}
                          className="rounded bg-zinc-700 px-2 py-1 text-[11px] text-white hover:bg-zinc-600"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmClear(idx)}
                      className="mt-2 w-full rounded border border-zinc-700 px-3 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800"
                    >
                      铲除重种
                    </button>
                  )}
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
    <Section
      title="⚗️ 医疗·制作台"
      subtitle="用废土材料合成医疗品，无副本也能补给。"
      right={<span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">就地补给</span>}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MED_CRAFT_RECIPES.map((r) => {
          const med = MEDICINES.find((m) => m.id === r.medicine);
          const ok = canCraftMedicine(state, r);
          return (
            <Card key={r.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div className="text-base font-semibold text-zinc-100">{r.name}</div>
                <span className="shrink-0 rounded-full bg-rose-900/40 px-2 py-0.5 text-[11px] text-rose-300">
                  {med ? `产出 ${med.name}` : r.medicine}
                </span>
              </div>
              <div className="mt-1 text-xs text-zinc-400">
                效果：{med ? `${Math.round(med.healPct * 100)}% 生命 +${med.healFlat}` : '—'}
              </div>
              <ul className="mt-3 space-y-1.5 text-xs">
                {r.costMaterials.map((c) => {
                  const have = materialCount(state.materials, c.kind);
                  const enough = have >= c.qty;
                  return (
                    <li
                      key={c.kind}
                      className="flex items-center justify-between rounded bg-zinc-950/60 px-2 py-1"
                    >
                      <span className={enough ? 'text-emerald-300' : 'text-rose-300'}>
                        {MATERIAL_LABEL[c.kind]}
                      </span>
                      <span className={enough ? 'font-mono text-emerald-300' : 'font-mono text-rose-300'}>
                        {have}/{c.qty}
                      </span>
                    </li>
                  );
                })}
                <li className="flex items-center justify-between rounded bg-zinc-950/60 px-2 py-1 text-zinc-300">
                  <span>废土币</span>
                  <span className="font-mono">⛁{r.costCoins}</span>
                </li>
              </ul>
              <button
                onClick={() => mutate((s) => craftMedicine(s, r.id))}
                disabled={!ok}
                className="mt-3 w-full rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {ok ? '合成' : '材料 / 币不足'}
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
  if (!active) return <Section title="📓 战术手册"><div className="text-zinc-400">未指定出击者。</div></Section>;
  return (
    <Section
      title="📓 战术手册"
      subtitle={
        <span>
          当前出击者：{active.name}（<TierBadge tier={active.tier} name={active.tierName} size="sm" />）
        </span>
      }
    >
      <Card>
        <h3 className="text-sm font-semibold text-zinc-200">六维基础属性</h3>
        <div className="mt-3 space-y-2">
          {(Object.keys(active.attributes) as (keyof Attributes)[]).map((k) => (
            <AttrBar key={k} label={attrLabel(k)} value={active.attributes[k]} max={30} />
          ))}
        </div>
      </Card>
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-200">被动技 · 战斗词条</h3>
          <span className="text-[11px] text-zinc-500">按品质着色</span>
        </div>
        {active.traits.length === 0 ? (
          <div className="mt-2 text-sm text-zinc-400">无词条。</div>
        ) : (
          <ul className="mt-3 space-y-2">
            {active.traits.map((t) => {
              const c = affixColor(t.quality);
              const qlabel = affixLabel(t.quality);
              const hasBonus =
                t.combat ||
                Object.keys(t.modifiers ?? {}).some(
                  (k) => (t.modifiers?.[k as keyof Attributes] ?? 0) !== 0,
                );
              return (
                <li
                  key={t.id}
                  className="rounded-lg border bg-zinc-950/40 p-3"
                  style={{ borderColor: `${c}66`, boxShadow: `inset 3px 0 0 ${c}` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium" style={{ color: c }}>
                      {t.name}
                    </div>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                      style={{ color: c, border: `1px solid ${c}88`, backgroundColor: `${c}1f` }}
                    >
                      {qlabel}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">{t.description}</div>
                  {hasBonus && (
                    <div className="mt-2 flex flex-wrap gap-1 text-xs">
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
              );
            })}
          </ul>
        )}
      </Card>
    </Section>
  );
};

// ===== 3. 掌握技能（词条总览） =====
// v1.1.3（攒）：① 词条按品质着色；② 花费废土币重洗单项词条（二次确认 + 三选一，且不重复已掌握项）
const traitStyle = (q: AffixTierKey): React.CSSProperties => {
  const c = affixColor(q);
  return { color: c, borderColor: `${c}88`, backgroundColor: `${c}1f` };
};

export const ViewSkills: React.FC<ViewProps> = ({ state, mutate, rng }) => {
  const [confirm, setConfirm] = useState<{ survivorId: string; traitId: string; traitName: string } | null>(null);
  const [options, setOptions] = useState<{ survivorId: string; traitId: string; list: SurvivorTrait[] } | null>(null);

  const beginReroll = (survivorId: string, t: SurvivorTrait) => {
    setOptions(null);
    setConfirm({ survivorId, traitId: t.id, traitName: t.name });
  };

  const doConfirm = () => {
    if (!confirm) return;
    const s = state.survivors.find((x) => x.id === confirm.survivorId);
    if (!s || state.coins < REROLL_TRAIT_COST) return;
    // 排除该成员已拥有的全部词条（含被重洗的那条），保证新候选不重复
    const exclude = s.traits.map((t) => t.id);
    const list = rollTraitCandidates(rng, exclude, 3);
    setOptions({ survivorId: confirm.survivorId, traitId: confirm.traitId, list });
    setConfirm(null);
  };

  const pickOption = (newTrait: SurvivorTrait) => {
    if (!options) return;
    mutate((s) => rerollTrait(s, options.survivorId, options.traitId, newTrait));
    setOptions(null);
  };

  return (
    <Section title="掌握技能" subtitle="全员词条与被动一览。可花费废土币重洗单项词条（新词条不会与已掌握项重复）。">
      <div className="space-y-3">
        {state.survivors.map((s) => (
          <Card key={s.id}>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-base font-semibold text-zinc-100">{s.name}</span>
                <TierBadge tier={s.tier} name={s.tierName} size="sm" />
                <span className="ml-1 text-xs text-zinc-400">· 战力 {s.power}</span>
              </div>
            </div>
            <ul className="mt-2 flex flex-wrap gap-1 text-xs">
              {s.traits.map((t) => (
                <li key={t.id} className="flex items-center gap-1 rounded border px-2 py-1" style={traitStyle(t.quality)}>
                  <span>{t.name}</span>
                  <span className="text-[10px] opacity-70">{affixLabel(t.quality)}</span>
                  <button
                    type="button"
                    onClick={() => beginReroll(s.id, t)}
                    className="ml-1 rounded bg-black/30 px-1 text-[10px] hover:bg-black/50"
                    title={`花费 ${REROLL_TRAIT_COST} 废土币重洗该词条`}
                  >重洗</button>
                </li>
              ))}
              {s.traits.length === 0 && <li className="text-zinc-400">（无被动技能）</li>}
            </ul>
          </Card>
        ))}
      </div>

      {/* 二次确认弹层 */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-lg">
            <h3 className="text-base font-semibold text-zinc-100">重洗词条确认</h3>
            <p className="mt-2 text-sm text-zinc-300">
              将花费 <span className="font-semibold text-amber-300">{REROLL_TRAIT_COST}</span> 废土币，
              把 <span className="font-semibold text-zinc-100">{confirm.traitName}</span> 重洗为从「未掌握词条」中抽出的 3 选 1。
            </p>
            <p className="mt-1 text-xs text-zinc-500">替换后不可撤销，且新词条不会与已掌握项重复。</p>
            {state.coins < REROLL_TRAIT_COST && (
              <p className="mt-2 text-xs text-rose-300">⚠ 废土币不足，还差 {REROLL_TRAIT_COST - state.coins} 币。</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirm(null)} className="rounded border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800">取消</button>
              <button
                type="button"
                disabled={state.coins < REROLL_TRAIT_COST}
                onClick={doConfirm}
                className="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-40 hover:bg-amber-500"
              >确认重洗</button>
            </div>
          </div>
        </div>
      )}

      {/* 三选一候选 */}
      {options && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-lg">
            <h3 className="text-base font-semibold text-zinc-100">选择重洗后的词条</h3>
            <p className="mt-1 text-xs text-zinc-500">选定后立即替换原词条，并扣除 {REROLL_TRAIT_COST} 废土币。</p>
            {options.list.length === 0 ? (
              <p className="mt-3 text-sm text-rose-300">已掌握全部词条，无可用候选。</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {options.list.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => pickOption(t)} className="w-full rounded-lg border px-3 py-2 text-left hover:bg-zinc-800" style={traitStyle(t.quality)}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{t.name}</span>
                        <span className="text-[10px] opacity-70">{affixLabel(t.quality)}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] opacity-80">{t.description}</div>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                        {Object.entries(t.modifiers).filter(([, v]) => v).map(([k, v]) => (
                          <span key={k}>{attrLabel(k as keyof Attributes)}+{v}</span>
                        ))}
                        {t.combat?.hpBonus && <span>气血+{t.combat.hpBonus}</span>}
                        {t.combat?.critBonus && <span>暴击+{Math.round(t.combat.critBonus * 100)}%</span>}
                        {t.combat?.lootLuck && <span>搜刮+{Math.round(t.combat.lootLuck * 100)}%</span>}
                        {t.combat?.startHpRatio && <span>初始HP+{Math.round(t.combat.startHpRatio * 100)}%</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setOptions(null)} className="rounded border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800">取消</button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
};

// ===== 4. 战团技能 =====
const FACTION_META: Record<string, { icon: string; accent: string }> = {
  'iron-wall': { icon: '🛡️', accent: '#f87171' },
  'silver-hand': { icon: '💰', accent: '#fbbf24' },
  'free-scouts': { icon: '🧭', accent: '#38bdf8' },
};

export const ViewFactionSkills: React.FC<ViewProps> = ({ state }) => (
  <Section title="🏛️ 战团技能" subtitle="投资势力声望，全战团获得永久属性加成（每级 +1 档）。">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {FACTIONS.map((f) => {
        const rep = state.factionRep[f.id] ?? 0;
        const meta = FACTION_META[f.id] ?? { icon: '🏳️', accent: '#9ca3af' };
        const bonusParts = Object.entries(f.attrPerRepLevel).map(
          ([k, v]) => `${attrLabel(k as keyof Attributes)}+${(v ?? 0) * rep}`,
        );
        return (
          <Card key={f.id} className="overflow-hidden" style={{ borderColor: `${meta.accent}55` }}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-2xl leading-none">{meta.icon}</span>
                <div>
                  <div className="text-base font-semibold text-zinc-100">{f.name}</div>
                  <div className="mt-0.5 text-xs text-zinc-400">{f.description}</div>
                </div>
              </div>
              <Pill tone={rep > 0 ? 'sky' : 'stone'}>声望 {rep}/5</Pill>
            </div>
            <div className="mt-3 flex gap-1">
              {[0, 1, 2, 3, 4].map((lv) => (
                <div
                  key={lv}
                  className="h-1.5 flex-1 rounded-full"
                  style={{ backgroundColor: lv < rep ? meta.accent : '#3f3f46' }}
                />
              ))}
            </div>
            <ul className="mt-3 space-y-1 text-xs">
              {Object.entries(f.attrPerRepLevel).map(([k, v]) => (
                <li
                  key={k}
                  className="flex items-center justify-between rounded bg-zinc-950/40 px-2 py-1"
                >
                  <span className="text-zinc-300">{attrLabel(k as keyof Attributes)}</span>
                  <span className="font-medium" style={{ color: meta.accent }}>+{v ?? 0} / 级</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 text-[11px] text-zinc-500">
              当前全团加成：{bonusParts.length ? bonusParts.join(' · ') : '—'}
            </div>
          </Card>
        );
      })}
    </div>
  </Section>
);

// ===== 5. 全部战绩 =====
const SORTIE_OUTCOME_META: Record<SortieLog['outcome'], { label: string; color: string; icon: string }> = {
  success: { label: '撤离成功', color: '#34d399', icon: '✅' },
  death: { label: '阵亡', color: '#f87171', icon: '💀' },
  timeout: { label: '超时撤离', color: '#fbbf24', icon: '⏳' },
};

export const ViewBattleLog: React.FC<ViewProps> = ({ state }) => (
  <Section title="📜 全部战绩" subtitle={`累计出击 ${state.sortieHistory.length} 次 · 展示最近 30 条`}>
    {state.sortieHistory.length === 0 ? (
      <Card><div className="text-sm text-zinc-400">尚无出击记录。前往「出击」体验首次搜打撤。</div></Card>
    ) : (
      <div className="space-y-2">
        {state.sortieHistory.slice(0, 30).map((s) => {
          const m = SORTIE_OUTCOME_META[s.outcome];
          const d = new Date(s.at);
          return (
            <Card key={s.id} className="!p-0 overflow-hidden">
              <div className="flex">
                <div className="w-1.5 shrink-0" style={{ backgroundColor: m.color }} />
                <div className="flex-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold text-zinc-100">{s.survivorName}</span>
                      <span className="text-zinc-500">→</span>
                      <span className="text-zinc-300">{s.zoneName}</span>
                    </div>
                    <span
                      className="shrink-0 rounded px-2 py-0.5 text-xs font-medium"
                      style={{ color: m.color, backgroundColor: `${m.color}22` }}
                    >
                      {m.icon} {m.label}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                    <span>🕒 {d.toLocaleDateString()} {d.toLocaleTimeString()}</span>
                    <span className="text-emerald-300/80">📦 入库 {s.bankedItems} 件</span>
                    <span className="text-amber-300/80">⛁ {s.bankedValue}</span>
                    {s.enemyFaced && <span>· 遭遇 {s.enemyFaced}</span>}
                    {s.rescued && (
                      <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">🤝 救援</span>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
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

// ===== 7. 漫游搜打撤（v1.1.0：模拟跑一次完整副本，结算与手动出击同源） =====
export const ViewWandering: React.FC<ViewProps> = ({ state, mutate, rng }) => {
  // 行动点实时恢复展示：每秒刷新本地时钟（不写存档，避免高频落盘）
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ap = actionPointView(state, now);
  const [report, setReport] = useState<WanderReport | null>(null);
  const [running, setRunning] = useState(false);
  const active = state.survivors.find((s) => s.id === state.activeSurvivorId);
  const remainClock = `${Math.floor(ap.remainMs / 60000)}:${String(
    Math.floor((ap.remainMs % 60000) / 1000),
  ).padStart(2, '0')}`;

  const runOnce = () => {
    if (!active) return;
    const { state: nextState, report: r } = simulateWanderSortie(state, { rng });
    if (!r.ok) {
      setReport(r);
      return;
    }
    setReport(r);
    mutate(() => nextState);
  };

  const logs = state.wanderLog ?? [];

  return (
    <Section
      title="漫游搜打撤"
      subtitle="派出击者自动下一次副本：会真的搜刮、遇敌、战斗、掉血、负伤，甚至阵亡濒死；结算规则与手动出击完全一致。"
    >
      <Card className="mb-3 !bg-zinc-900">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-zinc-300">
            ⚡ 行动点{' '}
            <span
              className={`font-mono font-semibold ${
                ap.current >= ACTION_POINT_CAP ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {ap.current}
            </span>
            <span className="text-zinc-500"> / {ap.cap}</span>
          </span>
          <span className="text-xs text-zinc-400">
            {ap.full ? '已满（暂停恢复）' : `下一点 ${remainClock} 后 · 每 5 分钟 +1`}
          </span>
        </div>
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => {
            setRunning(true);
            runOnce();
            setRunning(false);
          }}
          disabled={running || !active || ap.current < 6}
          className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          派出一支小队
        </button>
        <span className="text-xs text-zinc-400">
          消耗：危1 6 点 … 危7 12 点（区域随机，派出瞬间扣除）· 出击者：
          {active ? active.name : '未指定'}
        </span>
      </div>

      <div className="mb-4 rounded border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
        ⚠ 漫游并非无损：会按副本真实流程掉血、附加战后伤势，阵亡/超时同样进入<b>濒死</b>并可能
        <b>被夺走已穿戴装备</b>（安全箱内物品 100% 保留）。撤离失败时经验与搜刮废土币一律作废。
      </div>

      {report && !report.ok && (
        <div className="mb-3 rounded border border-rose-800 bg-rose-950/30 px-3 py-1.5 text-xs text-rose-300">
          {report.reason}
        </div>
      )}

      {report && report.ok && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-zinc-100">本局战报</h3>
            <Pill tone={report.outcome === 'success' ? 'green' : 'red'}>
              {report.outcome === 'success' ? '撤离成功' : report.outcome === 'timeout' ? '超时失败' : '阵亡'}
            </Pill>
          </div>
          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
            <div className="text-zinc-300">
              区域：<span className="text-zinc-100">{report.zoneName}</span>（危{report.dangerLevel}）· 消耗{' '}
              <span className="font-mono text-amber-300">{report.apCost}</span> 行动点
            </div>
            <div className="text-zinc-300">
              生命：
              <span className="font-mono text-zinc-100">
                {report.hpBefore} → {report.hpAfter}
              </span>
              <span className="text-zinc-500"> / {report.maxHp}</span>
            </div>
            <div className="text-zinc-300">
              入库：<span className="text-zinc-100">{report.items}</span> 件（估值{' '}
              <span className="font-mono text-amber-300">{report.value}</span>）
            </div>
            <div className="text-zinc-300">
              废土币：<span className="font-mono text-amber-300">+{report.credits}</span> · 经验：
              <span className="font-mono text-sky-300">+{report.xp}</span>
            </div>
            {report.enemyFaced && (
              <div className="text-zinc-300">
                遭遇：<span className="text-rose-300">{report.enemyFaced}</span>
              </div>
            )}
            {report.rescued && <div className="text-emerald-300">救出 1 名幸存者（已入花名册）</div>}
          </div>
          {(report.injuries.length > 0 || report.lostGear > 0 || report.dying) && (
            <div className="mt-2 space-y-1 text-xs">
              {report.injuries.length > 0 && (
                <div className="text-rose-300">
                  🩹 新增伤势：{report.injuries.map((i) => INJURY_LABEL[i]).join('、')}
                </div>
              )}
              {report.lostGear > 0 && <div className="text-rose-300">💀 被夺走装备 {report.lostGear} 件</div>}
              {report.dying && (
                <div className="text-rose-300">⚠ 已进入濒死状态，需救治后才能再次出击</div>
              )}
            </div>
          )}
        </Card>
      )}

      <div className="space-y-1">
        {logs.map((l, i) => (
          <div key={i} className="rounded bg-zinc-950 px-3 py-1 text-xs text-zinc-200">
            {l}
          </div>
        ))}
        {logs.length === 0 && <div className="text-sm text-zinc-500">还没有记录。</div>}
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

// ===== 9. 重塑六维（v1.1.0：取代旧「重塑天赋」，只重随初始基础六维） =====
export const ViewRerollAttributes: React.FC<ViewProps> = ({ state, mutate, rng }) => {
  // v1.1.0 补充：花费 500 币且不可逆，需要内联二次确认（window.confirm 在本壳内不可靠）
  const [confirming, setConfirming] = useState(false);
  const active = state.survivors.find((s) => s.id === state.activeSurvivorId);
  if (!active) {
    return (
      <Section title="重塑六维">
        <div className="text-zinc-400">未指定出击者。</div>
      </Section>
    );
  }
  const base = active.baseAttributes;
  const afford = state.coins >= REROLL_ATTR_COST;
  const doReroll = () => {
    if (!afford) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    mutate((s) => rerollBaseAttributes(s, active.id, rng));
    setConfirming(false);
  };
  return (
    <Section
      title="重塑六维"
      subtitle={
        <span>
          当前出击者：{active.name}（<TierBadge tier={active.tier} name={active.tierName} size="sm" />）
        </span>
      }
    >
      <Card>
        <div className="text-sm text-zinc-200">
          消耗 <span className="font-semibold text-amber-300">{REROLL_ATTR_COST}</span> 废土币，把{' '}
          <span className="text-zinc-100">{active.name}</span> 的
          <b> 初始六维基础属性 </b>重新随机（每项 6~20）。
        </div>
        <div className="mt-2 text-xs text-zinc-400">
          只重随「最原始的初始基础属性」——词条加成、升级加点、等级、经验、装备与伤势全部保留；段位随新战力重算。
        </div>
        {base ? (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {ALL_ATTR_KEYS.map((k) => (
              <div
                key={k}
                className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-center"
              >
                <div className="text-[11px] text-zinc-500">{attrLabel(k)}</div>
                <div className="font-mono text-sm text-zinc-100">{base[k]}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-xs text-zinc-500">（该存档尚未记录初始基础属性，重随时会自动补齐）</div>
        )}
        <div className="mt-3 text-xs text-zinc-400">
          费用：{REROLL_ATTR_COST} 废土币 · 当前余额 {state.coins}
        </div>
        {confirming ? (
          <div className="mt-3 rounded border border-amber-700 bg-amber-950/30 px-3 py-2">
            <div className="text-sm text-amber-200">
              ⚠ 确认消耗 {REROLL_ATTR_COST} 废土币，将 {active.name} 的初始六维基础属性全部重新随机（6~20）？
            </div>
            <div className="mt-1 text-xs text-amber-300/80">此操作不可撤销，可能抽到比现在更差的属性。</div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={doReroll}
                className="rounded bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-700"
              >
                确认重塑
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded bg-zinc-700 px-3 py-1 text-xs text-white hover:bg-zinc-600"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={doReroll}
            disabled={!afford}
            className="mt-3 rounded bg-amber-600 px-4 py-2 text-white hover:bg-amber-700 disabled:opacity-40"
          >
            消耗 {REROLL_ATTR_COST} 重塑六维
          </button>
        )}
        {!afford && (
          <p className="mt-2 text-xs text-rose-300">⚠ 废土币不足，还差 {REROLL_ATTR_COST - state.coins} 币。</p>
        )}
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
  // v1.1.0：出售区 —— 材料按基础价 ×2；装备按稀有度阶级浮动计价
  const [soldMsg, setSoldMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const equippedIds = useMemo(
    () =>
      new Set(
        Object.values(state.equipped).flatMap((slots) =>
          Object.values(slots).filter((x): x is string => typeof x === 'string'),
        ),
      ),
    [state.equipped],
  );
  const sellable = state.gear.filter((g) => !equippedIds.has(g.id));
  const selectedTotal = selected.reduce((acc, id) => {
    const g = state.gear.find((x) => x.id === id);
    return acc + (g ? gearSellPrice(g) : 0);
  }, 0);

  const doBuy = (id: MedicineSpec['id'], qty: number) => {
    const spec = MEDICINES.find((m) => m.id === id);
    if (!spec) return;
    mutate((s) => buyMedicine(s, id, qty));
    setBought(`✅ 已购买 ${spec.name}×${qty}，消耗 ${spec.costCoins * qty} 废土币（库存 +${qty}）。`);
    setPending(null);
    setSoldMsg(null);
  };

  const doSellMaterial = (m: MaterialItem, qty: number) => {
    const sell = Math.min(Math.floor(qty), m.quantity);
    if (sell <= 0) return;
    const gain = materialSellPrice(m) * sell;
    mutate((s) => sellMaterials(s, m.id, sell));
    setSoldMsg(`✅ 卖出 ${m.name}×${sell}，+${gain} 废土币。`);
    setBought(null);
  };

  const doSellGear = () => {
    if (selected.length === 0) return;
    const gain = selectedTotal;
    const n = selected.length;
    mutate((s) => recycleGear(s, selected));
    setSoldMsg(`✅ 卖出 ${n} 件装备，+${gain} 废土币。`);
    setBought(null);
    setSelected([]);
  };

  return (
    <Section title="废土市场" subtitle="从市集购入医疗物资，出售多余材料与仓库装备。">
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
          <h3 className="font-semibold text-zinc-100">出售物资</h3>
          <p className="mt-1 text-xs text-zinc-400">
            材料按基础价 ×2 回收；装备按稀有度阶级浮动计价（白 1.0× → 红 2.2×）。已穿戴的装备需先卸下。
          </p>
          {soldMsg && (
            <div className="mt-2 rounded border border-emerald-800 bg-emerald-950/30 px-2 py-1 text-xs text-emerald-300">
              {soldMsg}
            </div>
          )}

          <div className="mt-3">
            <div className="text-xs text-zinc-400">材料</div>
            <div className="mt-1.5 space-y-1.5">
              {state.materials.length === 0 && (
                <div className="text-xs text-zinc-500">暂无材料可出售。</div>
              )}
              {state.materials.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-2 rounded border border-zinc-800 px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-zinc-100">{m.name}</div>
                    <div className="text-[11px] text-zinc-500">
                      库存 ×{m.quantity} · 单价 {materialSellPrice(m)} 币
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => doSellMaterial(m, 1)}
                      className="rounded bg-stone-600 px-2 py-1 text-xs text-white hover:bg-stone-700"
                    >
                      ×1
                    </button>
                    <button
                      onClick={() => doSellMaterial(m, 5)}
                      className="rounded bg-stone-600 px-2 py-1 text-xs text-white hover:bg-stone-700"
                    >
                      ×5
                    </button>
                    <button
                      onClick={() => doSellMaterial(m, m.quantity)}
                      className="rounded bg-stone-700 px-2 py-1 text-xs text-white hover:bg-stone-600"
                    >
                      全部
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>仓库装备（{sellable.length} 件可出售）</span>
              <span>
                已选 {selected.length} 件 · 可得{' '}
                <span className="font-mono text-amber-300">{selectedTotal}</span> 币
              </span>
            </div>
            {sellable.length === 0 ? (
              <div className="mt-1.5 text-xs text-zinc-500">
                仓库没有可出售的装备（已穿戴的需先卸下）。
              </div>
            ) : (
              <div className="mt-1.5 max-h-56 space-y-1 overflow-y-auto pr-1">
                {sellable.map((g) => {
                  const on = selected.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      onClick={() =>
                        setSelected((prev) =>
                          on ? prev.filter((x) => x !== g.id) : [...prev, g.id],
                        )
                      }
                      className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left transition ${
                        on
                          ? 'border-amber-600 bg-amber-950/30'
                          : 'border-zinc-800 hover:border-zinc-600'
                      }`}
                    >
                      <span className="min-w-0">
                        <span
                          className="block truncate text-sm"
                          style={{ color: g.tierColor ?? '#e4e4e7' }}
                        >
                          {g.name}
                        </span>
                        <span className="block text-[11px] text-zinc-500">
                          {g.rarityName ?? g.rarity} · {g.affixes.length} 词条
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-xs text-amber-300">
                        {gearSellPrice(g)} 币
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <button
              onClick={doSellGear}
              disabled={selected.length === 0}
              className="mt-2 rounded bg-stone-600 px-3 py-1 text-xs text-white hover:bg-stone-700 disabled:opacity-40"
            >
              出售选中装备
            </button>
          </div>
        </Card>
      </div>
    </Section>
  );
};

// ===== 12. 装备改装（v1.1.0 由「鉴物回收」改名：本页是消耗材料造装备，出售请去废土市场） =====
export const ViewReforge: React.FC<ViewProps> = ({ state, mutate, rng }) => {
  return (
    <Section title="装备改装" subtitle="消耗材料随机改装为装备，有概率产出高稀有度词缀。">
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
const LEADERBOARD_MEDAL = ['🥇', '🥈', '🥉'];

export const ViewLeaderboard: React.FC<ViewProps> = ({ state }) => {
  // 战团上限 10 人，前 30 名为兜底；按战力降序
  const sorted = [...state.survivors].sort((a, b) => b.power - a.power).slice(0, 30);
  return (
    <Section title="🏆 英雄榜" subtitle={`战团悍将按战力排序（共 ${state.survivors.length} 人，展示前 30）`}>
      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-400">
              <th className="py-2 pl-3">排名</th>
              <th>姓名</th>
              <th>段位</th>
              <th className="text-right">战力</th>
              <th className="pr-3">词条</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => {
              return (
                <tr key={s.id} className="border-t border-zinc-800/70 transition-colors hover:bg-zinc-800/30">
                  <td className="py-2 pl-3 font-mono text-zinc-400">
                    {i < 3 ? <span className="text-lg">{LEADERBOARD_MEDAL[i]}</span> : i + 1}
                  </td>
                  <td className="font-semibold text-zinc-100">{s.name}</td>
                  <td><TierBadge tier={s.tier} name={s.tierName} size="sm" /></td>
                  <td className="text-right font-mono font-semibold text-amber-300">{s.power}</td>
                  <td className="pr-3 text-xs text-zinc-400">{s.traits.length} 条</td>
                </tr>
              );
            })}
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

// ===== 23b. GM 调试面板（v1.1.0：需密钥解锁） =====
const GM_UNLOCK_FLAG = 'wasteland-gm-unlocked';

function readGmUnlocked(): boolean {
  try {
    return window.localStorage.getItem(GM_UNLOCK_FLAG) === '1';
  } catch {
    return false;
  }
}

function writeGmUnlocked(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(GM_UNLOCK_FLAG, '1');
    else window.localStorage.removeItem(GM_UNLOCK_FLAG);
  } catch {
    /* 隐私模式等场景下忽略 */
  }
}

/** GM 加经验的固定额度 */
const GM_XP_AMOUNT = 200;
/** GM 加废土币的固定额度 */
const GM_COIN_AMOUNT = 500;

const GmPanel: React.FC<{ state: SurvivalGameState; mutate: Mutate }> = ({ state, mutate }) => {
  const [unlocked, setUnlocked] = useState(() => readGmUnlocked());
  const [keyInput, setKeyInput] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const active = state.survivors.find((s) => s.id === state.activeSurvivorId);

  const tryUnlock = () => {
    if (verifyGmKey(keyInput)) {
      writeGmUnlocked(true);
      setUnlocked(true);
      setErr(null);
      setKeyInput('');
      setToast('✅ GM 功能已解锁（本机记住，可随时锁定）。');
    } else {
      setErr('密钥错误，无法使用 GM 功能。');
    }
  };

  const lock = () => {
    writeGmUnlocked(false);
    setUnlocked(false);
    setToast(null);
  };

  if (!unlocked) {
    return (
      <Card>
        <h3 className="font-semibold text-zinc-100">GM 功能（未解锁）</h3>
        <div className="mt-1 text-xs text-zinc-400">
          输入 GM 密钥以启用调试功能（仅本机有效，不影响其他存档）。
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => {
              setKeyInput(e.target.value);
              setErr(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') tryUnlock();
            }}
            placeholder="请输入 GM 密钥"
            className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-zinc-500"
          />
          <button
            onClick={tryUnlock}
            disabled={keyInput.trim().length === 0}
            className="rounded bg-zinc-700 px-3 py-1 text-xs text-white hover:bg-zinc-600 disabled:opacity-40"
          >
            验证密钥
          </button>
        </div>
        {err && <div className="mt-2 text-xs text-rose-300">⚠ {err}</div>}
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-emerald-300">GM 功能（已解锁）</h3>
          <div className="mt-1 text-xs text-zinc-400">
            当前出击者：
            <span className="text-zinc-100">
              {active ? (
                <>
                  {active.name}（Lv.{active.level ?? 1} · <TierBadge tier={active.tier} name={active.tierName} size="sm" />）
                </>
              ) : (
                '未指定'
              )}
            </span>
          </div>
        </div>
        <button
          onClick={lock}
          className="shrink-0 rounded bg-zinc-700 px-3 py-1 text-xs text-white hover:bg-zinc-600"
        >
          锁定 GM
        </button>
      </div>

      {toast && <div className="mt-2 text-xs text-emerald-300">{toast}</div>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => {
            if (!active) return;
            mutate((s) => gmGrantXp(s, active.id, GM_XP_AMOUNT));
            setToast(`✅ ${active.name} 经验 +${GM_XP_AMOUNT}（满经验会自动升级并发放属性点）。`);
          }}
          disabled={!active}
          className="rounded bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          出击者经验 +{GM_XP_AMOUNT}
        </button>
        <button
          onClick={() => {
            mutate((s) => gmGrantCoins(s, GM_COIN_AMOUNT));
            setToast(`✅ 废土币 +${GM_COIN_AMOUNT}。`);
          }}
          className="rounded bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-700"
        >
          废土币 +{GM_COIN_AMOUNT}
        </button>
        <button
          onClick={() => {
            const before = state.actionPoints ?? 0;
            mutate((s) => gmGrantActionPoints(s));
            setToast(
              before >= 120
                ? `ℹ️ 行动点已是 ${before}/120，无需恢复。`
                : `✅ 行动点恢复至 ${before} → 120/120。`,
            );
          }}
          className="rounded bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-700"
        >
          恢复行动点 120
        </button>
      </div>
      <div className="mt-2 text-[11px] text-zinc-500">
        经验按正常升级流程结算：满经验升级会给自由属性点、触发词条三选一，并将状态回满。
      </div>
    </Card>
  );
};

// ===== 23. 系统设置 =====
export const ViewSettings: React.FC<ViewProps> = ({ state, mutate, onResetGame }) => {
  // v1.0.10：重置存档不再沿用「玩家代号」，改为弹窗输入重生者姓名
  const [resetOpen, setResetOpen] = useState(false);
  const suggestedName = (
    (state.playerCodename as string | undefined) ||
    state.survivors.find((s) => s.isProtagonist)?.name ||
    state.survivors[0]?.name ||
    ''
  ).trim();
  return (
    <Section title="系统设置">
      <Card>
        <h3 className="font-semibold text-zinc-100">存档</h3>
        <div className="mt-2 text-xs text-zinc-400">本存档创建于 {new Date(state.createdAt).toLocaleString()}。</div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setResetOpen(true)}
            className="rounded bg-rose-600 px-3 py-1 text-xs text-white hover:bg-rose-700"
          >重置存档</button>
          <span className="self-center text-xs text-zinc-500">
            清空当前避难所，重建一名新的主角（需输入重生者姓名，不可撤销）
          </span>
        </div>
        {resetOpen ? (
          <ResetSaveDialog
            defaultName={suggestedName}
            onCancel={() => setResetOpen(false)}
            onConfirm={(name) => {
              // v1.0.10 补充：优先走 Hub 的重置（会一并退出出击），避免重生主角仍处于副本中
              if (onResetGame) onResetGame(name);
              else mutate(() => createProtagonistGame(name));
              setResetOpen(false);
            }}
          />
        ) : null}
      </Card>

      {/* v1.1.0：GM 调试面板（需密钥解锁） */}
      <GmPanel state={state} mutate={mutate} />
    </Section>
  );
};

// ===== 24. 幸存者花名册（副本中找到、待招募的幸存者） =====
export const ViewRecruits: React.FC<ViewProps> = ({ state, mutate }) => {
  const full = state.survivors.length >= WARBAND_CAP;
  return (
    <Section
      title="🪪 幸存者花名册"
      subtitle={`目前 ${state.recruits.length} 名待招募 · 战团 ${state.survivors.length}/${WARBAND_CAP}`}
    >
      {state.recruits.length === 0 ? (
        <Card><div className="text-sm text-zinc-400">暂无待招募成员。出击搜打撤时，有概率在副本中救出幸存者，他们会先进入这里的花名册，用废土币招募后加入战团。越厉害的幸存者招募费越高。</div></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {state.recruits.map((r) => {
            const fee = recruitFee(r.tier);
            const canAfford = state.coins >= fee && !full;
            const rc = rarityColor(r.rarity);
            return (
              <Card key={r.id} className="overflow-hidden" style={{ borderColor: `${rc}55` }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold" style={{ color: rc }}>{r.name}</span>
                      <Pill tone="stone">{rarityLabel(r.rarity)}</Pill>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-zinc-400">
                      <TierBadge tier={r.tier} name={r.tierName} size="sm" /> · 战力 {r.power}
                    </div>
                    {r.traits.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1">
                        {r.traits.map((t) => {
                          const c = affixColor(t.quality as AffixTierKey);
                          return (
                            <li
                              key={t.id}
                              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs"
                              style={{ color: c, backgroundColor: `${c}22`, border: `1px solid ${c}55` }}
                            >
                              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />
                              {t.name}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[11px] text-zinc-500">招募费</span>
                    <span className={`text-sm font-semibold ${canAfford ? 'text-emerald-400' : 'text-rose-400'}`}>⛁ {fee}</span>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => mutate((s) => acceptRecruit(s, r.id))}
                    disabled={!canAfford}
                    className="flex-1 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                    title={full ? '战团已满，需先遣散' : state.coins < fee ? '废土币不足' : ''}
                  >招募入团</button>
                  <button
                    onClick={() => mutate((s) => dismissRecruit(s, r.id))}
                    className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
                  >放走</button>
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
                  <div className="flex items-center gap-1 text-xs text-zinc-400">
                    <TierBadge tier={s.tier} name={s.tierName} size="sm" /> · 体质 {s.attributes.vitality}
                  </div>
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