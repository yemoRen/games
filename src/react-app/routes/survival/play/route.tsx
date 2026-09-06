/**
 * 全民求生・系统搜打撤 — 主玩法 Hub（Phase 2 + 3 整合界面）
 *
 * 仿原游戏「底部常驻导航」：角色 / 背包 / 基地 / 出击。
 * 全部状态走 @shared/engine/survival，并通过 localStorage 持久化（刷新不丢）。
 * 出击页复用 extraction 引擎跑真实战斗，并把入库物资/废土币写回存档。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from '@app/components/router/AppLink';
import { useNavigate } from 'react-router';
import type { Attributes } from '@shared/types/cultivator';
import type {
  SurvivalGameState,
  GearSlot,
  SurvivorTrait,
} from '@shared/engine/survival';
import {
  newGame,
  bankLoot,
  addRecruit,
  acceptRecruit,
  dismissRecruit,
  equipGear,
  unequipGear,
  applyFailureGearLoss,
  setQuickSlot,
  craftGear,
  craftCost,
  canCraft,
  upgradeFacility,
  nextUpgradeCost,
  investFaction,
  nextFactionCost,
  buildSortieLoadout,
  computeShelterBonuses,
  RECIPES,
  SHELTER_FACILITIES,
  FACTIONS,
  MATERIAL_LABEL,
  attrLabel,
  rarityLabel,
  rarityColor,
  recruitFee,
  dismissSurvivor,
  treatNearDeathWithCoins,
  WARBAND_CAP,
  NEAR_DEATH_TREAT_COST,
  applyMedicineToSurvivor,
  type RNG,
  seededRng,
  chance,
  applySortieResult,
  recoverAll as _recoverAll,
  MEDICINES,
  MAIN_EQUIP_SLOTS,
  QUICK_SLOTS,
  THROWABLES,
  RAID_PACK_CAPACITY,
  GEAR_SLOT_LABEL,
  LOOT_MEDICINE_MAP,
  xpNeededForLevel,
  allocateFreePoint,
  chooseTraitPick,
  recycleGear,
  gearAttrBonus,
} from '@shared/engine/survival';
import {
  createRun,
  search,
  rollRescue,
  extract,
  getZone,
  DANGER_ZONES,
  addCarriedLoot,
  resolveEncounter,
  lootCorpse,
  consumeCarriedItem,
  advanceBranch,
  goToExtract,
  leaveExtract,
  dropCarried,
  moveToSecure,
  takeFromSecure,
  bankSecureIntoBanked,
  timeLeft,
  fmtClock,
  zoneSearchLeft,
  RUN_TIME_LIMIT_SEC,
  MAX_ZONE_SEARCHES,
  SECURE_BOX_SLOTS,
  FIGHT_AMMO_COST,
  MAP_BRANCH_COUNT,
  type ExtractionRunState,
  type EncounterAction,
} from '@shared/engine/extraction';
import { generateSurvivor } from '@shared/engine/survival/chargen';
import { loadGame, saveGame, clearSave } from '@shared/engine/survival';
import { INJURY_LABEL, INJURY_DESC } from '@shared/engine/survival/recovery';
import { getCurrentUser } from '@shared/engine/survival/account';
import { MenuDrawer } from '../menu/MenuDrawer';
import {
  rollGearDrop,
  tierColor,
  RARITY_LEGEND,
  affixColor,
  affixLabel,
} from '@shared/engine/survival/affixes';

/**
 * 词条说明：点击展开小气泡（移动端友好），点击其他区域自动关闭，不遮挡屏幕。
 * 取代原先鼠标 hover 才显示的 title 提示。
 */
function TraitBonusText({ trait }: { trait: SurvivorTrait }) {
  const mods = (Object.keys(trait.modifiers) as (keyof Attributes)[])
    .filter((k) => (trait.modifiers[k] ?? 0) !== 0)
    .map((k) => `${attrLabel(k)} +${trait.modifiers[k]}`);
  const combat: string[] = [];
  if (trait.combat?.hpBonus) combat.push(`气血 +${trait.combat.hpBonus}`);
  if (trait.combat?.critBonus) combat.push(`暴击 +${Math.round(trait.combat.critBonus * 100)}%`);
  if (trait.combat?.lootLuck) combat.push(`搜刮 +${Math.round(trait.combat.lootLuck * 100)}%`);
  if (trait.combat?.startHpRatio) combat.push(`初始血量 +${Math.round(trait.combat.startHpRatio * 100)}%`);
  if (mods.length === 0 && combat.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-1 border-t border-zinc-700 pt-1.5">
      {mods.map((m) => (
        <div key={m} className="text-emerald-300">{m}</div>
      ))}
      {combat.map((c) => (
        <div key={c} className="text-sky-300">{c}</div>
      ))}
    </div>
  );
}

function TraitChip({ trait }: { trait: SurvivorTrait }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const color = affixColor(trait.quality);
  return (
    <span ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded border px-2 py-0.5 text-[11px]"
        style={{ color, borderColor: `${color}66`, backgroundColor: `${color}1a` }}
      >
        {trait.name}
        <span className="ml-1 opacity-70" style={{ color }}>{affixLabel(trait.quality)}</span>
      </button>
      {open && (
        <span
          role="dialog"
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-30 mt-1 w-60 rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-[11px] leading-relaxed text-zinc-200 shadow-xl"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium" style={{ color }}>{trait.name}</span>
            <span className="rounded px-1 text-[10px]" style={{ color, border: `1px solid ${color}66` }}>
              {affixLabel(trait.quality)}阶词条
            </span>
          </div>
          <div className="text-zinc-400">{trait.description}</div>
          <TraitBonusText trait={trait} />
        </span>
      )}
    </span>
  );
}

type Tab = 'character' | 'inventory' | 'base' | 'sortie';

const TABS: { id: Tab; label: string }[] = [
  { id: 'character', label: '角色' },
  { id: 'inventory', label: '背包' },
  { id: 'base', label: '基地' },
  { id: 'sortie', label: '出击' },
];

const DANGER_LABEL: Record<number, string> = {
  1: '危1·安全',
  2: '危2·谨慎',
  3: '危3·凶险',
  4: '危4·高危',
  5: '危5·死地',
  6: '危6·禁区',
};

function attrBars(attrs: Attributes, bonus?: Partial<Attributes>) {
  const max = Math.max(20, ...Object.values(attrs));
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-[12px]">
      {(Object.keys(attrs) as (keyof Attributes)[]).map((k) => {
        const b = bonus?.[k] ?? 0;
        return (
          <div key={k}>
            <div className="flex justify-between text-zinc-400">
              <span>{attrLabel(k)}</span>
              <span className="text-zinc-200">
                {attrs[k]}
                {b !== 0 && <span className="text-emerald-400">(+{b})</span>}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-zinc-800">
              <div
                className="h-full bg-emerald-500/70"
                style={{ width: `${Math.min(100, (attrs[k] / max) * 100)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Coin({ n }: { n: number }) {
  return (
    <span className="rounded bg-zinc-800 px-2 py-0.5 text-sm font-semibold text-amber-300">
      ⛁ {n}
    </span>
  );
}

/** 简单分页：返回当前页切片与翻页控制。items 数量变化时自动收束越界页码。 */
function usePagination<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const slice = items.slice(safePage * pageSize, safePage * pageSize + pageSize);
  return { page: safePage, setPage, pageCount, slice };
}

function Pager({
  page,
  pageCount,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500">
      <button
        onClick={onPrev}
        disabled={page <= 0}
        className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-30"
      >
        ‹ 上一页
      </button>
      <span>
        第 {page + 1}/{pageCount} 页 · 共 {total} 件
      </span>
      <button
        onClick={onNext}
        disabled={page >= pageCount - 1}
        className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-30"
      >
        下一页 ›
      </button>
    </div>
  );
}

export default function SurvivalHub() {
  const [state, setState] = useState<SurvivalGameState>(() => {
    const loaded = loadGame() ?? newGame();
    return _recoverAll(loaded);
  });
  const [tab, setTab] = useState<Tab>('character');
  const goToTab = (t: Tab) => {
    // 切换 tab 前先结算一次时间戳恢复（事件回调中 setState，符合 lint 规则）
    setState((prev) => _recoverAll(prev));
    setTab(t);
  };

  const navigate = useNavigate();
  const [user] = useState(() => getCurrentUser());
  const [menuOpen, setMenuOpen] = useState(false);

  // 存档随状态变化持久化（按当前账号独立槽位，见 persistence.ts）
  useEffect(() => {
    saveGame(state);
  }, [state]);

  useEffect(() => {
    if (!user) navigate('/survival/login', { replace: true });
  }, [user, navigate]);

  // 未登录闸门：进入避难所前必须先通过幸存者核验（各账号独立存档）
  if (!user) {
    return (
      <div className="flex min-h-[100svh] items-center justify-center bg-zinc-950 text-zinc-400">
        未登录 · 正在跳转至幸存者核验…
      </div>
    );
  }

  const mutate = (fn: (s: SurvivalGameState) => SurvivalGameState) =>
    setState((prev) => fn(prev));

  return (
    <div className="flex min-h-[100svh] flex-col bg-zinc-950 text-zinc-200">
      {/* 顶部 HUD */}
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/survival" className="text-sm text-zinc-400 hover:text-zinc-200">
              ‹ 首页
            </Link>
            <h1 className="text-base font-semibold tracking-wide text-emerald-400">
              全境求生 · 系统搜打撤
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/survival/login" className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300">
              账号
            </Link>
            <Coin n={state.coins} />
          </div>
        </div>
      </header>

      {/* 主内容：四个面板常驻挂载，仅用 hidden 切换可见性——
          这样切到「角色/背包/基地」再切回「出击」时，出击中的 run 状态不会因卸载而丢失 */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <div className={tab === 'character' ? '' : 'hidden'}>
          <CharacterPanel state={state} mutate={mutate} rng={Math.random as RNG} />
        </div>
        <div className={tab === 'inventory' ? '' : 'hidden'}>
          <InventoryPanel state={state} mutate={mutate} rng={Math.random as RNG} />
        </div>
        <div className={tab === 'base' ? '' : 'hidden'}>
          <BasePanel state={state} mutate={mutate} />
        </div>
        <div className={tab === 'sortie' ? '' : 'hidden'}>
          <SortiePanel state={state} setState={setState} onExit={() => goToTab('character')} />
        </div>
      </main>

      {/* 底部常驻导航 */}
      <footer className="sticky bottom-0 z-10 border-t border-dashed border-zinc-700 bg-zinc-950/95">
        <nav className="mx-auto flex max-w-3xl items-stretch justify-around">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => goToTab(t.id)}
              className={`flex-1 py-3 text-sm tracking-wide transition ${
                tab === t.id
                  ? 'border-t-2 border-emerald-500 text-emerald-400'
                  : 'border-t-2 border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              [{t.label}]
            </button>
          ))}
          {/* 末世行止：从右侧滑出抽屉（不离开避难所、不重新加载） */}
          <button
            onClick={() => setMenuOpen(true)}
            className="relative flex-1 py-3 text-sm tracking-wide text-amber-300/90 hover:text-amber-200"
          >
            <span className="mr-1">‹</span>末世行止
            <span className="ml-1 text-[10px] text-amber-400/60">›</span>
          </button>
        </nav>
      </footer>

      {/* 末世行止侧滑抽屉 */}
      <MenuDrawer
        state={state}
        mutate={mutate}
        setState={setState}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      />
    </div>
  );
}

// ===== 角色 =====
function CharacterPanel(props: {
  state: SurvivalGameState;
  mutate: (fn: (s: SurvivalGameState) => SurvivalGameState) => void;
  rng: RNG;
}) {
  const { state, mutate } = props;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const full = state.survivors.length >= WARBAND_CAP;

  const warbandHp = (id: string) => {
    const st = state.survivorStatus[id];
    if (!st) return null;
    const pct = st.maxHp > 0 ? Math.max(0, Math.min(100, (st.currentHp / st.maxHp) * 100)) : 0;
    const tone = pct > 50 ? 'bg-emerald-500' : pct > 25 ? 'bg-amber-500' : 'bg-rose-600';
    return (
      <div className="mt-2">
        <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
          <span>生命</span>
          <span>{st.currentHp} / {st.maxHp}</span>
        </div>
        <div className="h-2 overflow-hidden rounded bg-zinc-800">
          <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-6">
      {/* ===== 战团成员 ===== */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-300">
            战团成员（{state.survivors.length} / {WARBAND_CAP}）
          </h2>
          {full && <span className="text-[11px] text-rose-400">战团已满，招募需先遣散</span>}
        </div>

        {state.survivors.map((s) => {
          const isActive = s.id === state.activeSurvivorId;
          const st = state.survivorStatus[s.id];
          const dyingUntil = st?.dyingUntil ? new Date(st.dyingUntil).getTime() : 0;
          const isDying = dyingUntil > now;
          const dyingLeft = isDying ? Math.ceil((dyingUntil - now) / 60000) : 0;
          return (
            <div
              key={s.id}
              className={`rounded-lg border p-4 transition ${
                isDying
                  ? 'border-rose-600 bg-rose-950/30'
                  : isActive
                    ? 'border-emerald-500 bg-emerald-500/5'
                    : 'border-zinc-800 bg-zinc-900'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-zinc-100">{s.name}</span>
                    {s.isProtagonist && (
                      <span className="rounded bg-amber-900/50 px-1.5 py-0.5 text-[11px] text-amber-300">主角</span>
                    )}
                    <span
                      className="rounded px-1.5 py-0.5 text-[11px]"
                      style={{ backgroundColor: `${rarityColor(s.rarity)}22`, color: rarityColor(s.rarity) }}
                    >
                      {rarityLabel(s.rarity)}
                    </span>
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">
                      {s.tierName}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {s.origin} · {s.age}岁 · 战力 {s.power}
                  </div>
                </div>
                <button
                  onClick={() => mutate((st2) => ({ ...st2, activeSurvivorId: s.id }))}
                  disabled={isDying}
                  className={`rounded px-3 py-1 text-xs ${
                    isActive
                      ? 'bg-emerald-600 text-white'
                      : isDying
                        ? 'cursor-not-allowed bg-zinc-800 text-zinc-600'
                        : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {isActive ? '出战中' : isDying ? '濒死' : '选为出击'}
                </button>
              </div>

              {warbandHp(s.id)}

              {isDying && (
                <div className="mt-2 rounded border border-rose-700 bg-rose-950/40 p-2 text-[12px] text-rose-200">
                  <div className="flex items-center justify-between gap-2">
                    <span>☠ 撤离失败·濒死，约 {dyingLeft} 分钟内未救治将真正离世</span>
                    <button
                      onClick={() => mutate((st2) => treatNearDeathWithCoins(st2, s.id))}
                      disabled={state.coins < NEAR_DEATH_TREAT_COST}
                      className={`rounded px-2 py-1 text-xs ${
                        state.coins >= NEAR_DEATH_TREAT_COST
                          ? 'bg-rose-600 text-white hover:bg-rose-500'
                          : 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      救治（⛁{NEAR_DEATH_TREAT_COST}）
                    </button>
                  </div>
                  <div className="mt-1 text-[11px] text-rose-300/80">也可用医疗品在「末世行止·医疗中心」救治。</div>
                </div>
              )}

              {st && st.injuries.length > 0 && !isDying && (
                <div className="mt-2 space-y-2">
                  <div className="text-[11px] text-rose-300/80">当前伤势（debuff）</div>
                  {st.injuries.map((inj) => {
                    const treatMeds = MEDICINES.filter(
                      (m) => m.treats?.includes(inj) && (state.medicines[m.id] ?? 0) > 0,
                    );
                    return (
                      <div key={inj} className="rounded border border-rose-800/50 bg-rose-950/20 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-medium text-rose-300">⚠ {INJURY_LABEL[inj]}</span>
                          <span className="text-[11px] text-rose-300/70">{INJURY_DESC[inj]}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                          {treatMeds.length > 0 ? (
                            <>
                              <span className="text-zinc-500">可用药物恢复：</span>
                              {treatMeds.map((m) => (
                                <button
                                  key={m.id}
                                  onClick={() => mutate((st2) => applyMedicineToSurvivor(st2, s.id, m.id))}
                                  className="rounded border border-emerald-800 bg-emerald-900/40 px-1.5 py-0.5 text-emerald-200 hover:bg-emerald-800/60"
                                >
                                  用 {m.name} 治疗
                                </button>
                              ))}
                            </>
                          ) : (
                            <span className="text-amber-400">无对应药物，请先采购或在「末世行止·医疗中心」救治。</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-3">{attrBars(s.attributes, gearAttrBonus(state, s.id))}</div>

              {/* 等级 / 经验 / 自由属性点 / 升级词条三选一（系统流） */}
              {(() => {
                const lvl = s.level ?? 1;
                const xp = s.xp ?? 0;
                const need = xpNeededForLevel(lvl);
                const fp = s.freePoints ?? 0;
                const cands = s.pendingTraitPick ?? [];
                return (
                  <div className="mt-2 rounded border border-sky-900/50 bg-zinc-950/50 p-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-sky-300">
                        Lv.{lvl}
                        <span className="ml-2 text-zinc-500">经验 {xp} / {need}</span>
                      </span>
                      {fp > 0 && (
                        <span className="rounded bg-amber-900/50 px-1.5 py-0.5 text-amber-300">
                          ⬆ 自由属性点 ×{fp}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded bg-zinc-800">
                      <div className="h-full bg-sky-500/70" style={{ width: `${Math.min(100, (xp / need) * 100)}%` }} />
                    </div>
                    {fp > 0 && (
                      <div className="mt-2">
                        <div className="mb-1 text-[10px] text-zinc-500">分配自由属性点（每点 +1）：</div>
                        <div className="flex flex-wrap gap-1">
                          {(Object.keys(s.attributes) as (keyof Attributes)[]).map((k) => (
                            <button
                              key={k}
                              onClick={() => mutate((st2) => allocateFreePoint(st2, s.id, k))}
                              className="rounded border border-amber-700/60 px-1.5 py-0.5 text-[10px] text-amber-200 hover:bg-amber-900/40"
                            >
                              {attrLabel(k)} +1
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {cands.length > 0 && (
                      <div className="mt-2 rounded border border-purple-800/60 bg-purple-950/20 p-2">
                        <div className="text-[11px] text-purple-300">
                          🔗【系统】检测到宿主等级提升……请选择词条强化（三选一）：
                        </div>
                        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
                          {cands.map((t, i) => (
                            <button
                              key={`${t.id}-${i}`}
                              onClick={() => mutate((st2) => chooseTraitPick(st2, s.id, i))}
                              className="rounded border p-2 text-left transition hover:bg-zinc-800/60"
                              style={{ borderColor: affixColor(t.quality) }}
                            >
                              <div className="text-xs font-medium" style={{ color: affixColor(t.quality) }}>
                                {affixLabel(t.quality)}·{t.name}
                              </div>
                              <div className="mt-0.5 text-[10px] leading-snug text-zinc-400">{t.description}</div>
                              <div className="mt-0.5 text-[10px] text-emerald-300">
                                {(Object.keys(t.modifiers) as (keyof Attributes)[])
                                  .filter((k) => (t.modifiers[k] ?? 0) !== 0)
                                  .map((k) => `${attrLabel(k)}+${t.modifiers[k]}`)
                                  .join(' ')}
                                {t.combat?.hpBonus ? ` 气血+${t.combat.hpBonus}` : ''}
                                {t.combat?.critBonus ? ` 暴击+${Math.round(t.combat.critBonus * 100)}%` : ''}
                                {t.combat?.lootLuck ? ` 搜刮+${Math.round(t.combat.lootLuck * 100)}%` : ''}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {s.traits.map((t) => (
                  <TraitChip key={t.id} trait={t} />
                ))}
                {!s.isProtagonist && (
                  <button
                    onClick={() => mutate((st2) => dismissSurvivor(st2, s.id))}
                    className="ml-auto rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:border-rose-600 hover:text-rose-300"
                  >
                    遣散{typeof s.recruitValue === 'number' && s.recruitValue > 0 ? `（返还 ⛁${Math.floor(s.recruitValue / 3)}）` : ''}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ===== 幸存者花名册（副本中找到、待招募） ===== */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-300">幸存者花名册（{state.recruits.length}）</h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            副本中救出的幸存者会来到这里，用废土币招募后加入战团。越厉害越贵；战团满员需先遣散腾位。
          </p>
        </div>

        {state.recruits.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/50 p-4 text-center text-sm text-zinc-600">
            暂无待招募幸存者。出击搜打撤时，有概率在副本中救出幸存者。
          </div>
        ) : (
          state.recruits.map((r) => {
            const fee = recruitFee(r.tier);
            const canAfford = state.coins >= fee && !full;
            return (
              <div key={r.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-100">{r.name}</span>
                      <span
                        className="rounded px-1.5 py-0.5 text-[11px]"
                        style={{ backgroundColor: `${rarityColor(r.rarity)}22`, color: rarityColor(r.rarity) }}
                      >
                        {rarityLabel(r.rarity)}
                      </span>
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">
                        {r.tierName}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {r.origin} · {r.age}岁 · 战力 {r.power}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <button
                      onClick={() => mutate((s) => acceptRecruit(s, r.id))}
                      disabled={!canAfford}
                      className={`rounded px-3 py-1 text-xs ${
                        canAfford
                          ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                          : 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      招募（⛁{fee}）
                    </button>
                    <button
                      onClick={() => mutate((s) => dismissRecruit(s, r.id))}
                      className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-zinc-500"
                    >
                      放走
                    </button>
                  </div>
                </div>
                <div className="mt-3">{attrBars(r.attributes)}</div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {r.traits.map((t) => (
                    <TraitChip key={t.id} trait={t} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

// ===== 背包 =====
function InventoryPanel(props: {
  state: SurvivalGameState;
  mutate: (fn: (s: SurvivalGameState) => SurvivalGameState) => void;
  rng: RNG;
}) {
  const { state, mutate, rng } = props;
  const active = state.survivors.find((s) => s.id === state.activeSurvivorId) ?? null;
  const matPage = usePagination(state.materials, 12);
  // 装备库：已被任意角色穿戴的装备不予显示（穿戴独立性，卸下后回归）；支持分类筛选 + 批量回收
  const [gearCat, setGearCat] = useState<'all' | GearSlot>('all');
  const [recycleSel, setRecycleSel] = useState<Record<string, boolean>>({});
  const [confirmRecycle, setConfirmRecycle] = useState(false);
  const equippedGearIds = new Set(
    Object.values(state.equipped).flatMap((slots) =>
      Object.values(slots).filter((x): x is string => typeof x === 'string'),
    ),
  );
  const ownedGear = state.gear.filter((g) => !equippedGearIds.has(g.id));
  const filteredGear = gearCat === 'all' ? ownedGear : ownedGear.filter((g) => g.slot === gearCat);
  const gearPage = usePagination(filteredGear, 6);
  const selectedGear = ownedGear.filter((g) => recycleSel[g.id]);
  const refundTotal = selectedGear.reduce((a, g) => a + g.value, 0);

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium text-zinc-300">背包物资</h2>

      {/* 材料 */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="mb-2 text-xs uppercase tracking-wider text-zinc-500">材料</h3>
        {state.materials.length === 0 ? (
          <p className="text-sm text-zinc-600">暂无材料，出击搜刮或拆解战利品获取。</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {matPage.slice.map((m) => (
                <div key={m.id} className="rounded border border-zinc-800 bg-zinc-950/50 p-2">
                  <div className="text-sm text-zinc-200">{m.name}</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    {MATERIAL_LABEL[m.kind]} · x{m.quantity} · ⛁{m.value}
                  </div>
                </div>
              ))}
            </div>
            <Pager
              page={matPage.page}
              pageCount={matPage.pageCount}
              total={state.materials.length}
              onPrev={() => matPage.setPage(matPage.page - 1)}
              onNext={() => matPage.setPage(matPage.page + 1)}
            />
          </>
        )}
      </div>

      {/* 装备 */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="mb-2 text-xs uppercase tracking-wider text-zinc-500">装备制造</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {RECIPES.map((r) => {
            const cost = craftCost(state, r);
            const ok = canCraft(state, r);
            return (
              <div key={r.id} className="rounded border border-zinc-800 bg-zinc-950/50 p-3">
                <div className="text-sm text-zinc-100">{r.name}</div>
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  ⛁{cost.coins} +{' '}
                  {cost.materials.map((m) => `${MATERIAL_LABEL[m.kind]}x${m.qty}`).join(' ')}
                </div>
                <button
                  disabled={!ok}
                  onClick={() => mutate((s) => craftGear(s, rng, r.id).state)}
                  className={`mt-2 w-full rounded px-2 py-1.5 text-xs font-medium ${
                    ok ? 'bg-sky-700 text-white hover:bg-sky-600' : 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                  }`}
                >
                  制造
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 装备栏：6 主槽（常驻穿戴）+ 3 快捷槽 */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wider text-zinc-500">
            装备栏 · {active?.name ?? '无成员'}
          </h3>
          <span className="text-[11px] text-zinc-500">6 主槽 + 3 快捷槽</span>
        </div>
        {!active ? (
          <p className="text-sm text-zinc-600">暂无战团成员。</p>
        ) : (
          <>
            {/* 6 个主装备槽 */}
            <div className="grid grid-cols-3 gap-2">
              {MAIN_EQUIP_SLOTS.map((slot) => {
                const gid = (state.equipped[active.id] ?? {})[slot.key];
                const g = gid ? state.gear.find((x) => x.id === gid) : undefined;
                return (
                  <div
                    key={slot.key}
                    className="rounded border border-zinc-800 bg-zinc-950/60 p-2"
                  >
                    <div className="text-[10px] text-zinc-500">
                      {slot.icon} {slot.label}
                    </div>
                    {g ? (
                      <>
                        <div
                          className="mt-0.5 truncate text-xs"
                          style={{ color: g.tierColor ?? '#e4e4e7' }}
                          title={g.name}
                        >
                          {g.name}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {g.rarityName ?? g.rarity}阶
                        </div>
                        <button
                          onClick={() => mutate((s) => unequipGear(s, active.id, slot.key))}
                          className="mt-1 w-full rounded bg-zinc-700 px-1 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-600"
                        >
                          卸下
                        </button>
                      </>
                    ) : (
                      <div className="mt-0.5 text-[11px] text-zinc-600">空</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 3 个快捷消耗槽 */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              {QUICK_SLOTS.map((qs) => {
                const cur = (state.equipped[active.id] ?? {})[qs.key];
                const opts =
                  qs.key === 'quickThrow'
                    ? THROWABLES.filter((t) => (state.throwables?.[t.id] ?? 0) > 0).map((t) => ({
                        id: t.id,
                        name: `${t.name}×${state.throwables?.[t.id] ?? 0}`,
                      }))
                    : MEDICINES.filter((m) => (state.medicines[m.id] ?? 0) > 0).map((m) => ({
                        id: m.id,
                        name: `${m.name}×${state.medicines[m.id] ?? 0}`,
                      }));
                return (
                  <div
                    key={qs.key}
                    className="rounded border border-zinc-800 bg-zinc-950/60 p-2"
                  >
                    <div className="text-[10px] text-zinc-500">
                      {qs.icon} {qs.label}
                    </div>
                    <select
                      value={cur ?? ''}
                      onChange={(e) =>
                        mutate((s) =>
                          setQuickSlot(s, active.id, qs.key, e.target.value || undefined),
                        )
                      }
                      className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[11px] text-zinc-200"
                    >
                      <option value="">—</option>
                      {opts.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-zinc-600">
              主槽装备常驻生效，撤离失败时有概率被夺走；快捷槽供战斗中一键使用。
            </p>
          </>
        )}
      </div>

      {/* 装备库（已穿戴的不显示；分类筛选 + 多选批量回收，两步确认防误触） */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wider text-zinc-500">装备库</h3>
          <span className="text-[11px] text-zinc-500">当前出击：{active?.name ?? '无'}</span>
        </div>
        <p className="mb-2 text-[11px] text-zinc-600">
          已被角色穿戴的装备不在此显示（穿戴独立），卸下后回归装备库。回收金额 = 装备自身价值。
        </p>
        {/* 分类筛选 */}
        <div className="mb-2 flex flex-wrap gap-1.5">
          {GEAR_CATS.map((c) => (
            <button
              key={c.key}
              onClick={() => { setGearCat(c.key); setConfirmRecycle(false); }}
              className={`rounded border px-2 py-0.5 text-[11px] transition ${
                gearCat === c.key
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        {state.gear.length === 0 ? (
          <p className="text-sm text-zinc-600">尚未获得任何装备。</p>
        ) : filteredGear.length === 0 ? (
          <p className="text-sm text-zinc-600">该分类下暂无可显示的装备。</p>
        ) : (
          <>
            <ul className="space-y-2">
              {gearPage.slice.map((g) => {
                const checked = !!recycleSel[g.id];
                return (
                  <li
                    key={g.id}
                    className={`rounded border p-3 transition ${
                      checked ? 'border-rose-700/60 bg-rose-950/10' : 'border-zinc-800 bg-zinc-950/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        {/* 多选框（批量回收用） */}
                        <button
                          onClick={() => { setRecycleSel((s0) => ({ ...s0, [g.id]: !s0[g.id] })); setConfirmRecycle(false); }}
                          title="勾选以加入批量回收"
                          className={`h-4 w-4 shrink-0 rounded border text-[10px] leading-none transition ${
                            checked
                              ? 'border-rose-500 bg-rose-600 text-white'
                              : 'border-zinc-600 text-transparent hover:border-zinc-400'
                          }`}
                        >
                          ✓
                        </button>
                        <span className="text-sm" style={{ color: g.tierColor ?? tierColor(g.tier ?? 0) }}>
                          {g.name}
                        </span>
                        <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">
                          {g.rarityName ?? g.rarity}·{GEAR_SLOT_LABEL[g.slot]}
                        </span>
                        <span className="shrink-0 text-[11px] text-zinc-500">⛁{g.value}</span>
                      </div>
                      {active && (
                        <button
                          onClick={() => mutate((s) => equipGear(s, active.id, g.id))}
                          className="shrink-0 rounded bg-emerald-700 px-2 py-1 text-xs text-white hover:bg-emerald-600"
                        >
                          装备
                        </button>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">{g.affixes.join('、')}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1.5">
                      {(Object.keys(g.modifiers) as (keyof Attributes)[])
                        .filter((k) => (g.modifiers[k] ?? 0) !== 0)
                        .map((k) => (
                          <span key={k} className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[11px] text-emerald-300">
                            {attrLabel(k)}+{g.modifiers[k]}
                          </span>
                        ))}
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pager
              page={gearPage.page}
              pageCount={gearPage.pageCount}
              total={filteredGear.length}
              onPrev={() => gearPage.setPage(gearPage.page - 1)}
              onNext={() => gearPage.setPage(gearPage.page + 1)}
            />
            {/* 批量回收（两步确认防误触） */}
            {selectedGear.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-800/60 bg-amber-950/20 p-2 text-xs">
                <span className="text-amber-200">
                  已选 {selectedGear.length} 件 · 回收可得 ⛁{refundTotal}
                </span>
                {!confirmRecycle ? (
                  <button
                    onClick={() => setConfirmRecycle(true)}
                    className="rounded bg-rose-700 px-3 py-1 font-medium text-white hover:bg-rose-600"
                  >
                    ♻ 回收选中
                  </button>
                ) : (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-rose-300">⚠ 再次确认：回收后装备永久消失！</span>
                    <button
                      onClick={() => {
                        mutate((s) => recycleGear(s, selectedGear.map((g) => g.id)));
                        setRecycleSel({});
                        setConfirmRecycle(false);
                      }}
                      className="rounded bg-rose-700 px-3 py-1 font-medium text-white hover:bg-rose-600"
                    >
                      确认回收
                    </button>
                    <button
                      onClick={() => setConfirmRecycle(false)}
                      className="rounded border border-zinc-600 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
                    >
                      取消
                    </button>
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** 装备库分类（全部 + 6 主槽位） */
const GEAR_CATS: Array<{ key: 'all' | GearSlot; label: string }> = [
  { key: 'all', label: '全部' },
  ...(Object.keys(GEAR_SLOT_LABEL) as GearSlot[]).map((k) => ({ key: k, label: GEAR_SLOT_LABEL[k] })),
];

// ===== 基地 =====
function BasePanel(props: {
  state: SurvivalGameState;
  mutate: (fn: (s: SurvivalGameState) => SurvivalGameState) => void;
}) {
  const { state, mutate } = props;
  const bonuses = computeShelterBonuses(state.facilities, state.factionRep);
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-300">避难所</h2>
        <button
          onClick={() => {
            clearSave();
            mutate(() => newGame());
          }}
          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
        >
          重置存档
        </button>
      </div>

      {/* 设施 */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="mb-2 text-xs uppercase tracking-wider text-zinc-500">设施升级</h3>
        <div className="space-y-2">
          {SHELTER_FACILITIES.map((f) => {
            const lvl = state.facilities[f.id] ?? 0;
            const cost = nextUpgradeCost(state, f.id);
            const maxed = cost == null;
            const can = !maxed && state.coins >= (cost ?? 0);
            return (
              <div key={f.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/50 p-3">
                <div className="min-w-0">
                  <div className="text-sm text-zinc-100">
                    {f.name} <span className="text-[11px] text-zinc-500">Lv.{lvl}/{f.maxLevel}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">{f.description}</div>
                </div>
                {maxed ? (
                  <span className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400">已满级</span>
                ) : (
                  <button
                    disabled={!can}
                    onClick={() => mutate((s) => upgradeFacility(s, f.id))}
                    className={`rounded px-3 py-1.5 text-xs font-medium ${
                      can ? 'bg-amber-600 text-white hover:bg-amber-500' : 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    升级 ⛁{cost}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 势力 */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="mb-2 text-xs uppercase tracking-wider text-zinc-500">势力 / 战团</h3>
        <div className="space-y-2">
          {FACTIONS.map((fac) => {
            const rep = state.factionRep[fac.id] ?? 0;
            const cost = nextFactionCost(state, fac.id);
            const maxed = cost == null;
            const can = !maxed && state.coins >= (cost ?? 0);
            return (
              <div key={fac.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/50 p-3">
                <div className="min-w-0">
                  <div className="text-sm text-zinc-100">
                    {fac.name} <span className="text-[11px] text-zinc-500">声望 {rep}/5</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">{fac.description}</div>
                </div>
                {maxed ? (
                  <span className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400">已信赖</span>
                ) : (
                  <button
                    disabled={!can}
                    onClick={() => mutate((s) => investFaction(s, fac.id))}
                    className={`rounded px-3 py-1.5 text-xs font-medium ${
                      can ? 'bg-purple-700 text-white hover:bg-purple-600' : 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    投资 ⛁{cost}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 驻防加成 */}
      <div className="rounded-lg border border-emerald-800/50 bg-emerald-900/20 p-4 text-sm">
        <h3 className="mb-1 text-xs uppercase tracking-wider text-emerald-300/70">驻防加成</h3>
        <div className="grid grid-cols-2 gap-2 text-zinc-300">
          <div>搜刮运势 +{(bonuses.lootLuck * 100).toFixed(0)}%</div>
          <div>出击初始HP +{bonuses.startHpBonus}</div>
          <div>改装折扣 -{(bonuses.craftDiscount * 100).toFixed(0)}%</div>
          <div>全队属性 +{Object.values(bonuses.attrBonus).reduce((a, b) => a + b, 0)}</div>
        </div>
      </div>
    </section>
  );
}

// ===== 出击（搜打撤）=====
function SortiePanel(props: {
  state: SurvivalGameState;
  setState: React.Dispatch<React.SetStateAction<SurvivalGameState>>;
  onExit: () => void;
}) {
  const { state, setState, onExit } = props;
  const active = state.survivors.find((s) => s.id === state.activeSurvivorId) ?? null;
  const [zoneId, setZoneId] = useState(DANGER_ZONES[0].id);
  const [seed, setSeed] = useState('');
  const [run, setRun] = useState<ExtractionRunState | null>(null);
  const runRef = useRef<ExtractionRunState | null>(null);
  const rngRef = useRef<RNG>(Math.random as RNG);
  // 出击结算是否已写回归档（避免阵亡/撤离两种结局重复写入，也避免漏写）
  const writtenRef = useRef(false);

  const sync = () => setRun(runRef.current ? structuredClone(runRef.current) : null);

  /** 把当前 run 的结局写回归档：入库物资 + 救援者入花名册 + 回写 HP/伤势/濒死 */
  const persistRunResult = useCallback(() => {
    const s = runRef.current;
    if (!s) return;
    const prof = s.survivor.profile;
    if (!prof) return;
    // 撤离成功才入库；阵亡/失败不入库（extract 内部已按 phase 处理）
    if (s.phase === 'searching' || s.phase === 'combat') extract(s);
    // 死亡/超时结算：战局背包清零，但安全箱 100% 保留（搜打撤保底设计）
    if (s.phase === 'dead' || s.phase === 'timeout') bankSecureIntoBanked(s);
    const failed = s.phase === 'dead' || s.phase === 'timeout';
    setState((prev) => {
      let next = bankLoot(prev, s.bankedLoot);
      if (s.bankedNpc) next = addRecruit(next, s.bankedNpc);
      let after = applySortieResult(next, {
        survivorId: prof.id,
        survivorName: prof.name,
        zoneName: s.zone.name,
        outcome: failed ? 'death' : 'success',
        bankedItems: s.bankedLoot.reduce((a, b) => a + (b.qty ?? 1), 0),
        bankedValue: s.bankedLoot.reduce((a, b) => a + b.value * (b.qty ?? 1), 0),
        enemyFaced: s.log.find((l) => l.includes('⚔'))?.match(/【(.+?)】/)?.[1],
        rescued: !!s.bankedNpc,
        finalHp: s.condition.resources.hp.current,
        maxHp: s.condition.resources.hp.max ?? 0,
        // 经验结算：仅撤离成功入账（applySortieResult 内部也会按 outcome 把关）
        xpGained: failed ? 0 : s.xpGained,
      });
      // 撤离失败 / 阵亡 / 超时：战局背包（carriedLoot）已由 extract 拦下不入库；
      // 身上常驻穿戴的装备还要按概率被搜刮者夺走。
      if (failed) {
        after = applyFailureGearLoss(after, prof.id, rngRef.current).state;
      }
      return after;
    });
  }, [setState]);

  const start = () => {
    if (!active) return;
    writtenRef.current = false;
    const loadout = buildSortieLoadout(state, active.id);
    if (!loadout) return;
    const zone = getZone(zoneId);
    const status = state.survivorStatus[active.id];
    // 持久 HP 作为出击起始；附加词条「初始血量」头领，封顶 persistMax（避难所 HP 加成已并入 bonus.hpBonus 进战斗单位）
    let startHp = status?.currentHp ?? 1;
    if (status && loadout.bonus) {
      const persistMax = Math.max(status.maxHp, 1);
      const headStart = Math.round(persistMax * (loadout.bonus.startHpRatio ?? 0));
      startHp = Math.min(status.currentHp + headStart, persistMax);
    }
    // 护甲耐久 / 弹药由穿戴装备推算：护甲阶级→耐久，武器阶级→携弹量
    const eq = state.equipped[active.id] ?? {};
    const armorGear = eq.armor ? state.gear.find((g) => g.id === eq.armor) : undefined;
    const armorMax = armorGear ? 40 + (armorGear.tier ?? 0) * 30 : 0;
    const weaponGear = eq.weapon ? state.gear.find((g) => g.id === eq.weapon) : undefined;
    const startAmmo = 24 + (weaponGear ? (weaponGear.tier ?? 0) * 8 : 0);
    const r = createRun(loadout, zone, startHp, { current: armorMax, max: armorMax }, startAmmo);
    runRef.current = r;
    const s = seed.trim();
    rngRef.current = s ? seededRng(s) : (Math.random as RNG);
    sync();
  };

  const makeBonusLoot = (): ExtractionRunState['carriedLoot'][number] => {
    // 瞭望塔额外掉落：按当前所在区域危险度产出一件带阶级词缀的装备
    const zone = runRef.current?.zone ?? getZone(zoneId);
    return rollGearDrop(rngRef.current, zone.dangerLevel, 0.25);
  };

  const doSearch = () => {
    const s = runRef.current;
    if (!s || s.phase !== 'searching' || s.encounter || s.atExtract) return;
    const lootLuck = active
      ? buildSortieLoadout(state, active.id)?.bonus.lootLuck ?? 0
      : 0;
    search(s, rngRef.current, lootLuck);
    if (s.phase !== 'searching') {
      sync();
      return;
    }
    if (!s.encounter) {
      // 救援事件：按概率带回幸存者（仅在未遭遇敌人的平静搜索中触发）
      if (active) {
        rollRescue(s, rngRef.current, () => generateSurvivor(rngRef.current));
      }
      // 瞭望塔：搜刮运势额外掉落（词条/装备/避难所聚合）
      if (chance(rngRef.current, lootLuck)) {
        addCarriedLoot(s, makeBonusLoot());
        s.log.push(`[${fmtClock(s.elapsedSec)}] 【系统】瞭望塔侦察生效，额外发现一批物资。`);
      }
    }
    sync();
  };

  /** 遭遇抉择：开战 / 潜行 / 投掷物脱离 / 突围撤离点 */
  const doEncounter = (action: EncounterAction) => {
    const s = runRef.current;
    if (!s || !s.encounter || s.phase !== 'searching') return;
    if (action === 'throw') {
      // 投掷物脱离：消耗基地库存的烟雾弹/闪光弹（无库存则不可用）
      if ((state.throwables?.smoke ?? 0) <= 0 && (state.throwables?.flash ?? 0) <= 0) return;
    }
    resolveEncounter(s, action, rngRef.current);
    if (action === 'throw') {
      // 扣库存：优先烟雾弹，其次闪光弹
      const used = (state.throwables?.smoke ?? 0) > 0 ? 'smoke' : 'flash';
      setState((prev) => ({
        ...prev,
        throwables: { ...prev.throwables, [used]: Math.max(0, (prev.throwables?.[used] ?? 0) - 1) },
      }));
      // 日志补一条消耗记录
      const rs = runRef.current;
      if (rs) {
        const name = used === 'smoke' ? '烟雾弹' : '闪光弹';
        rs.log.push(`[${fmtClock(rs.elapsedSec)}] 消耗【${name}】×1（基地库存同步扣减）。`);
      }
    }
    sync();
  };

  const doLootCorpse = () => {
    const s = runRef.current;
    if (!s || !s.corpse || s.phase !== 'searching') return;
    lootCorpse(s, rngRef.current);
    sync();
  };

  /** 深入到本大地图的下一个分支区域（搜完 3 次后推进路线，第 10 区为霸主） */
  const doAdvanceBranch = () => {
    const s = runRef.current;
    if (!s || s.phase !== 'searching' || s.encounter || s.atExtract) return;
    advanceBranch(s);
    sync();
  };

  const doGoExtract = () => {
    const s = runRef.current;
    if (!s || s.phase !== 'searching' || s.encounter || s.atExtract) return;
    goToExtract(s);
    sync();
  };

  const doLeaveExtract = () => {
    const s = runRef.current;
    if (!s || s.phase !== 'searching' || !s.atExtract) return;
    leaveExtract(s);
    sync();
  };

  const doDropCarried = (index: number) => {
    const s = runRef.current;
    if (!s || s.phase !== 'searching') return;
    dropCarried(s, index);
    sync();
  };

  const doToSecure = (index: number) => {
    const s = runRef.current;
    if (!s || s.phase !== 'searching') return;
    moveToSecure(s, index);
    sync();
  };

  const doFromSecure = (slot: number) => {
    const s = runRef.current;
    if (!s || s.phase !== 'searching') return;
    takeFromSecure(s, slot);
    sync();
  };

  /** 副本内使用搜到的回复类道具（绷带/急救包/血清等）：立即回血，消耗战局背包中的 1 件 */
  const applyCarriedMed = (index: number) => {
    const s = runRef.current;
    if (!s || s.phase !== 'searching') return;
    const it = s.carriedLoot[index];
    if (!it) return;
    const medId = LOOT_MEDICINE_MAP[it.id];
    const med = medId ? MEDICINES.find((m) => m.id === medId) : undefined;
    if (!med) return;
    const maxHp = s.condition.resources.hp.max ?? 0;
    const cur = s.condition.resources.hp.current;
    if (cur >= maxHp) return;
    const heal = Math.round(med.healPct * maxHp) + med.healFlat;
    const consumed = consumeCarriedItem(s, index);
    if (!consumed) return;
    s.condition.resources.hp.current = Math.min(maxHp, cur + heal);
    s.log.push(
      `[${fmtClock(s.elapsedSec)}] 💊 使用战利品【${it.name}】，恢复 ${heal} 点生命（${s.condition.resources.hp.current}/${maxHp}）。`,
    );
    sync();
  };

  const doExtract = () => {
    const s = runRef.current;
    if (!s || s.phase === 'dead' || s.phase === 'extracted') return;
    extract(s);
    sync();
    // 结算（入库物资 + 救援者入花名册 + 回写 HP/濒死）由 isOver 的 useEffect 统一写入，
    // 同时覆盖「撤离成功」与「阵亡/撤离失败」两种结局，避免阵亡时漏写导致血条仍满。
  };

  /** 出击途中使用药物恢复生命——只能使用已装备到「快捷·医疗槽」的药物 */
  const takeMedicine = () => {
    const s = runRef.current;
    if (!s || s.phase !== 'searching' || !active) return;
    // 仅允许使用快捷·医疗槽里装备的药品；库存不足或无装备则忽略
    const quickMedId = state.equipped[active.id]?.quickMed;
    if (!quickMedId) return;
    const spec = MEDICINES.find((m) => m.id === quickMedId);
    if (!spec) return;
    const have = state.medicines[quickMedId] ?? 0;
    if (have <= 0) return;
    const maxHp = s.condition.resources.hp.max ?? 0;
    const heal = Math.round(spec.healPct * maxHp) + spec.healFlat;
    const before = s.condition.resources.hp.current ?? 0;
    s.condition.resources.hp.current = Math.min(maxHp, before + heal);
    const gained = s.condition.resources.hp.current - before;
    s.log.push(`💊 使用【${spec.name}】，恢复 ${gained} 生命（${s.condition.resources.hp.current}/${maxHp}）`);
    sync();
    setState((prev) => ({
      ...prev,
      medicines: { ...prev.medicines, [quickMedId]: Math.max(0, (prev.medicines[quickMedId] ?? 0) - 1) },
    }));
  };

  const reset = () => {
    runRef.current = null;
    setRun(null);
    writtenRef.current = false;
  };

  // 出击结局统一结算：run 进入 dead / extracted 时写回归档一次。
  // 关键修复：阵亡（撤离失败）时 phase 先变 dead、summary 直接出现，不会经过 doExtract，
  // 故必须在此补写 applyNearDeath，否则战团血条仍显示出击前的满血、且再次出击也满血。
  useEffect(() => {
    const s = runRef.current;
    if (!s) return;
    if ((s.phase === 'dead' || s.phase === 'extracted') && !writtenRef.current) {
      writtenRef.current = true;
      persistRunResult();
    }
  }, [run, persistRunResult]);

  if (!active) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center text-zinc-400">
        请先在「角色」中选择一名出击幸存者。
      </div>
    );
  }

  const hp = run?.condition.resources.hp;
  const carried = run?.carriedLoot ?? [];
  const carriedValue = carried.reduce((a, b) => a + b.value * (b.qty ?? 1), 0);
  const banked = run?.bankedLoot ?? [];
  const bankedValue = banked.reduce((a, b) => a + b.value * (b.qty ?? 1), 0);
  const bankedQty = banked.reduce((a, b) => a + (b.qty ?? 1), 0);
  // 出击途中可使用的药物：仅限已装备到「快捷·医疗槽」的那种（且基地库存 > 0）
  const quickMedId = active ? state.equipped[active.id]?.quickMed : undefined;
  const equippedMed = quickMedId ? MEDICINES.find((m) => m.id === quickMedId) : undefined;
  const availableMeds =
    quickMedId && equippedMed && (state.medicines[quickMedId] ?? 0) > 0 ? [equippedMed] : [];
  const isOver = run?.phase === 'dead' || run?.phase === 'extracted' || run?.phase === 'timeout';
  const failed = run?.phase === 'dead' || run?.phase === 'timeout';
  /** ⚔ 摘要行下标 → 战斗回放（日志行内展开用） */
  const battleByLogIndex = new Map((run?.battles ?? []).map((b) => [b.logIndex, b]));
  const hpPct = hp && (hp.max ?? 0) > 0 ? Math.max(0, (hp.current / (hp.max ?? 0)) * 100) : 0;
  const hpColor = hpPct > 50 ? 'bg-emerald-500' : hpPct > 25 ? 'bg-amber-500' : 'bg-rose-600';
  // 对局状态栏派生值
  const left = run ? timeLeft(run) : 0;
  const urgent = left > 0 && left <= RUN_TIME_LIMIT_SEC * 0.2;
  const searchLeft = run ? zoneSearchLeft(run) : 0;
  const usedSearches = run ? run.zoneSearches[run.zone.id] ?? 0 : 0;
  const secureUsed = run ? run.secureBox.filter((x) => x !== null).length : 0;
  const throwableStock = (state.throwables?.smoke ?? 0) + (state.throwables?.flash ?? 0);

  const sortieBonus = active ? buildSortieLoadout(state, active.id)?.bonus : undefined;
  const activeStatus = active ? state.survivorStatus[active.id] : undefined;
  const activeDying = !!activeStatus?.dyingUntil;

  return (
    <section className="space-y-4">
      {!run && (
        <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <div className="text-sm text-zinc-400">
            出击者：<span className="text-zinc-100">{active.name}</span>
            <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-emerald-300">
              {active.tierName}
            </span>
          </div>
          {activeDying && (
            <div className="rounded border border-rose-700 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
              ⚠ 该成员正处于濒死状态，请先在「战团成员」中用货币或医疗品救治，再出击。
            </div>
          )}
          {sortieBonus && (
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded bg-emerald-900/40 px-2 py-1 text-emerald-300">
                气血上限 +{Math.round(sortieBonus.hpBonus)}
              </span>
              <span className="rounded bg-rose-900/40 px-2 py-1 text-rose-300">
                暴击 +{Math.round(sortieBonus.critBonus * 100)}%
              </span>
              <span className="rounded bg-sky-900/40 px-2 py-1 text-sky-300">
                搜刮运势 +{Math.round(sortieBonus.lootLuck * 100)}%
              </span>
              {sortieBonus.startHpRatio > 0 && (
                <span className="rounded bg-amber-900/40 px-2 py-1 text-amber-300">
                  初始血量 +{Math.round(sortieBonus.startHpRatio * 100)}%
                </span>
              )}
              <span className="rounded bg-zinc-800 px-2 py-1 text-zinc-400">
                由 createCombatUnitFromCultivator 构建
              </span>
            </div>
          )}
          <div>
            <h2 className="mb-2 text-sm font-medium text-zinc-300">选择危险区域</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {DANGER_ZONES.map((z) => (
                <button
                  key={z.id}
                  onClick={() => setZoneId(z.id)}
                  className={`rounded-lg border p-3 text-left transition ${
                    zoneId === z.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-zinc-700 hover:border-zinc-500'
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
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-zinc-400">随机种子（可选，同种子可复现）</label>
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="例如 42"
              className="w-32 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-200 outline-none focus:border-emerald-500"
            />
            <button
              onClick={start}
              className="ml-auto rounded-lg bg-emerald-600 px-6 py-2.5 font-medium text-white hover:bg-emerald-500"
            >
              出击 ▶
            </button>
          </div>
        </div>
      )}

      {run && (
        <>
          {/* ① 对局状态栏（常驻：时间 / 位置 / 撤离点 / 安全箱 + 生命护甲弹药负重） */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="text-zinc-400">
                ⏱ 对局剩余{' '}
                <span className={`font-mono text-sm font-semibold ${urgent ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {fmtClock(left)}
                </span>
                <span className="text-zinc-600"> / {fmtClock(RUN_TIME_LIMIT_SEC)}</span>
              </span>
              <span className="text-zinc-400">
                📍 <span className="text-zinc-100">{run.zone.name}</span>
                <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-amber-300">
                  {DANGER_LABEL[run.zone.dangerLevel] ?? `危${run.zone.dangerLevel}`}
                </span>
                <span className="ml-1 text-zinc-500">
                  搜刮 {usedSearches}/{MAX_ZONE_SEARCHES}
                </span>
              </span>
              <span className="text-zinc-400">
                🚁 撤离点：
                <span className={run.atExtract ? 'text-emerald-300' : 'text-sky-300'}>
                  {run.atExtract ? '已抵达' : '已开启'}
                </span>
              </span>
              <span className="text-zinc-400">
                🛡 安全箱：<span className="text-amber-300">{secureUsed}/{SECURE_BOX_SLOTS}</span>
              </span>
              <span className="ml-auto text-zinc-400">
                携带估值 <span className="font-semibold text-emerald-400">{carriedValue}</span> 废土币
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <div className="mb-1 flex justify-between text-zinc-500">
                  <span>❤ 生命</span>
                  <span className="text-zinc-200">{hp?.current ?? 0} / {hp?.max ?? 0}</span>
                </div>
                <div className="h-2 overflow-hidden rounded bg-zinc-800">
                  <div className={`h-full ${hpColor} transition-all`} style={{ width: `${hpPct}%` }} />
                </div>
              </div>
              <div className="flex items-end justify-between text-zinc-500">
                <span>🛡 护甲耐久</span>
                <span className="text-zinc-200">{run.armor.current} / {run.armor.max}</span>
              </div>
              <div className="flex items-end justify-between text-zinc-500">
                <span>🔫 弹药</span>
                <span className={run.ammo >= FIGHT_AMMO_COST ? 'text-zinc-200' : 'text-rose-400'}>
                  {run.ammo} 发
                </span>
              </div>
              <div className="flex items-end justify-between text-zinc-500">
                <span>🎒 负重</span>
                <span className="text-zinc-200">{carried.length} / {RAID_PACK_CAPACITY} 格</span>
              </div>
            </div>
          </div>

          {/* ② 场景叙事区（当前场景文本，区别于底部滚动日志） */}
          <div className="rounded-lg border border-sky-900/50 bg-zinc-950/70 p-4">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-sky-500/70">— 场景 —</div>
            <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-sky-100/90">
              {run.scene}
            </pre>
          </div>

          {/* ③ 操作按钮组：遭遇抉择 / 撤离点抉择 / 常规行动（三态互斥） */}
          {run.encounter ? (
            <div className="rounded-lg border border-rose-800 bg-rose-950/20 p-4">
              <h2 className="mb-1 text-sm font-semibold text-rose-300">⚠️ 遭遇敌人 —— 必须做出抉择</h2>
              <div className="mb-3 text-xs text-zinc-400">
                【{run.encounter.enemy.name}】
                {run.encounter.enemy.threatNote ? ` · ${run.encounter.enemy.threatNote}` : ''}
                {run.encounter.enemy.affixes && run.encounter.enemy.affixes.length > 0 && (
                  <span className="ml-2">
                    {run.encounter.enemy.affixes.map((a, i) => (
                      <span key={i} className="mr-1 rounded px-1" style={{ color: a.color }}>
                        {a.label}
                      </span>
                    ))}
                  </span>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  onClick={(e) => { doEncounter('fight'); e.currentTarget.blur(); }}
                  className="rounded-lg bg-rose-700 px-4 py-3 text-sm font-medium text-white hover:bg-rose-600"
                >
                  ⚔ 主动开战
                  {run.ammo < FIGHT_AMMO_COST && (
                    <span className="ml-1 text-[11px] text-rose-200">（弹药不足·被迫肉搏）</span>
                  )}
                </button>
                <button
                  onClick={(e) => { doEncounter('sneak'); e.currentTarget.blur(); }}
                  className="rounded-lg border border-zinc-600 px-4 py-3 text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  🌫 潜行绕行
                  <span className="ml-1 text-[11px] text-zinc-500">（耗时，可能暴露）</span>
                </button>
                <button
                  onClick={(e) => { doEncounter('throw'); e.currentTarget.blur(); }}
                  disabled={throwableStock <= 0}
                  className="rounded-lg border border-sky-700 bg-sky-900/30 px-4 py-3 text-sm text-sky-200 hover:bg-sky-800/40 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
                >
                  💣 投掷物脱离
                  <span className="ml-1 text-[11px] opacity-70">
                    （烟雾弹/闪光弹 库存×{throwableStock}）
                  </span>
                </button>
                <button
                  onClick={(e) => { doEncounter('extract'); e.currentTarget.blur(); }}
                  className="rounded-lg border border-amber-700 bg-amber-900/30 px-4 py-3 text-sm text-amber-200 hover:bg-amber-800/40"
                >
                  🚁 向撤离点突围
                  <span className="ml-1 text-[11px] opacity-70">（放弃搜刮）</span>
                </button>
              </div>
            </div>
          ) : run.atExtract && !isOver ? (
            <div className="rounded-lg border border-sky-800 bg-sky-950/20 p-4">
              <h2 className="mb-1 text-sm font-semibold text-sky-300">🚁 撤离信号区</h2>
              <p className="mb-3 text-xs text-zinc-400">
                救援直升机正在接近——确认撤离将结算本局；继续搜刮则放弃本次机会，贪心者自负风险。
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  onClick={(e) => { doExtract(); e.currentTarget.blur(); }}
                  className="rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white hover:bg-emerald-500"
                >
                  ✔ 确认撤离（估值 {carriedValue} 废土币）
                </button>
                <button
                  onClick={(e) => { doLeaveExtract(); e.currentTarget.blur(); }}
                  className="rounded-lg border border-zinc-600 px-4 py-3 text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  ↩ 返回继续搜刮
                </button>
              </div>
            </div>
          ) : !isOver ? (
            <div className="space-y-3">
              {run.corpse && (
                <button
                  onClick={(e) => { doLootCorpse(); e.currentTarget.blur(); }}
                  className="w-full rounded-lg border border-amber-800 bg-amber-950/30 px-4 py-2.5 text-sm text-amber-200 hover:bg-amber-900/40"
                >
                  🩸 搜刮【{run.corpse.enemyName}】的尸体
                  <span className="ml-1 text-[11px] opacity-70">（战斗胜利后的额外战利品）</span>
                </button>
              )}
              <div className="flex gap-3">
                <button
                  onClick={(e) => { doSearch(); e.currentTarget.blur(); }}
                  disabled={searchLeft <= 0}
                  className="flex-1 rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  🛰 搜索当前区域
                  <span className="ml-1 text-xs opacity-80">
                    （剩 {searchLeft}/{MAX_ZONE_SEARCHES} 次）
                  </span>
                </button>
                <button
                  onClick={(e) => { doGoExtract(); e.currentTarget.blur(); }}
                  className="flex-1 rounded-lg bg-sky-700 px-4 py-3 font-medium text-white hover:bg-sky-600"
                >
                  🏃 前往撤离点
                </button>
              </div>
              {searchLeft <= 0 && (
                <p className="text-center text-xs text-amber-500">
                  此地已被搜刮干净，请前往下一区域。
                </p>
              )}
              <div>
                <div className="mb-1.5 flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-500">
                  <span>本图路线：{run.map.name}（共 {MAP_BRANCH_COUNT} 区，越深入越危险）</span>
                  <span className="text-amber-400/80">第 {run.branchIndex + 1}/{MAP_BRANCH_COUNT} 区</span>
                </div>
                <div className="mb-2 flex flex-wrap gap-1">
                  {run.map.branches?.map((b, i) => {
                    const isBoss = i === MAP_BRANCH_COUNT - 1;
                    const cur = i === run.branchIndex;
                    const past = i < run.branchIndex;
                    return (
                      <span
                        key={b.id}
                        title={b.flavor}
                        className={`rounded border px-1.5 py-0.5 text-[10px] ${
                          cur
                            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                            : past
                              ? 'border-zinc-800 text-zinc-600'
                              : 'border-zinc-700 text-zinc-400'
                        }`}
                      >
                        {i + 1}. {b.name}
                        {isBoss && <span className="ml-0.5">👑</span>}
                      </span>
                    );
                  })}
                </div>
                <button
                  onClick={(e) => { doAdvanceBranch(); e.currentTarget.blur(); }}
                  disabled={run.branchIndex >= MAP_BRANCH_COUNT - 1}
                  className="w-full rounded-lg border border-sky-700 bg-sky-900/30 px-4 py-2.5 text-sm text-sky-200 hover:bg-sky-800/40 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
                >
                  🧭 深入下一区域
                  <span className="ml-1 text-[11px] opacity-70">
                    {run.branchIndex >= MAP_BRANCH_COUNT - 1
                      ? '（已位于霸主领地）'
                      : run.map.branches?.[run.branchIndex + 1]
                        ? `（下一站：${run.map.branches[run.branchIndex + 1].name}，消耗时间并提升风险）`
                        : ''}
                  </span>
                </button>
              </div>
            </div>
          ) : null}

          {/* 💊 快捷医疗（仅限快捷·医疗槽装备的药品） */}
          {!isOver && availableMeds.length > 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <h2 className="mb-2 flex items-center gap-1 text-sm font-medium text-zinc-300">
                💊 使用药物恢复
                <span className="text-[11px] font-normal text-zinc-500">
                  （仅限快捷·医疗槽已装备的药品，消耗基地库存）
                </span>
              </h2>
              <div className="flex flex-wrap gap-2">
                {availableMeds.map((m) => {
                  const maxHp = run?.condition.resources.hp.max ?? 0;
                  const heal = Math.round(m.healPct * maxHp) + m.healFlat;
                  const cur = run?.condition.resources.hp.current ?? 0;
                  const disabled = cur >= maxHp;
                  return (
                    <button
                      key={m.id}
                      onClick={(e) => { takeMedicine(); e.currentTarget.blur(); }}
                      disabled={disabled}
                      className="rounded-lg border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-xs text-emerald-200 hover:bg-emerald-800/60 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {m.name}
                      <span className="ml-1 opacity-70">×{state.medicines[m.id]}</span>
                      <span className="ml-1 text-emerald-400">+{heal}</span>
                      {disabled && <span className="ml-1 text-zinc-500">（已满）</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* ④ 本局临时背包 + 安全箱（与基地背包完全隔离） */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="mb-2 flex items-center justify-between text-sm font-medium text-zinc-300">
              <span>🎒 本局临时背包</span>
              <span className="text-xs text-zinc-500">
                {carried.length} / {RAID_PACK_CAPACITY} 格 · 估值 {carriedValue}
              </span>
            </h2>
            <p className="mb-2 text-[11px] text-amber-500/80">
              本局搜刮的战利品：撤离成功才入库，阵亡 / 超时将全部清零；安全箱内物资 100% 保留。穿戴装备不在本局背包内。
              回复类物资（绷带/急救包/血清等）可就地「💊 使用」，没用完的撤离成功后自动带回基地医疗背包。
            </p>
            <div className="mb-2 flex flex-wrap items-center gap-1 text-[11px] text-zinc-500">
              <span>阶级：</span>
              {RARITY_LEGEND.map((r) => (
                <span key={r.label} className="font-medium" style={{ color: r.color }}>
                  {r.label}
                </span>
              ))}
            </div>
            {carried.length === 0 ? (
              <p className="text-sm text-zinc-600">尚未搜到任何物资。</p>
            ) : (
              <ul className="max-h-[320px] space-y-1 overflow-y-auto pr-1 text-sm">
                {carried.map((it, i) => {
                  const color = it.tier != null ? tierColor(it.tier) : '#a1a1aa';
                  const qty = it.qty ?? 1;
                  return (
                    <li key={`${it.id}-${i}`} className="border-b border-zinc-800/60 py-1">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          {it.tier != null && (
                            <span
                              className="rounded px-1.5 py-0.5 text-xs font-medium"
                              style={{ color, border: `1px solid ${color}` }}
                            >
                              {it.rarityName}
                            </span>
                          )}
                          <span style={{ color: it.tier != null ? color : undefined }} className={it.tier != null ? 'font-medium' : 'text-zinc-300'}>
                            {it.name}
                            {qty > 1 && <span className="ml-1 text-emerald-400">×{qty}</span>}
                          </span>
                        </span>
                        <span className="text-emerald-400">{it.value * qty}</span>
                      </div>
                      {it.affixes && it.affixes.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {it.affixes.map((a, j) => (
                            <span key={j} className="rounded px-1 text-[11px]" style={{ color: a.color }}>
                              {a.text}
                            </span>
                          ))}
                        </div>
                      )}
                      {!isOver && (
                        <div className="mt-1 flex gap-1">
                          {LOOT_MEDICINE_MAP[it.id] && (
                            <button
                              onClick={() => applyCarriedMed(i)}
                              disabled={(hp?.current ?? 0) >= (hp?.max ?? 0)}
                              className="rounded border border-emerald-700/60 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
                              title="在本局内立即使用，恢复生命"
                            >
                              💊 使用
                            </button>
                          )}
                          <button
                            onClick={() => doToSecure(i)}
                            disabled={secureUsed >= SECURE_BOX_SLOTS}
                            className="rounded border border-amber-700/60 px-1.5 py-0.5 text-[10px] text-amber-300 hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
                          >
                            🛡 移入安全箱
                          </button>
                          <button
                            onClick={() => doDropCarried(i)}
                            className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-rose-600 hover:text-rose-300"
                          >
                            🗑 丢弃
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {/* 安全箱（阵亡 100% 保留） */}
            <div className="mt-3 rounded border border-amber-900/50 bg-amber-950/10 p-2">
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-amber-400/90">
                <span>🛡 安全箱（阵亡也保留的保底格）</span>
                <span>{secureUsed} / {SECURE_BOX_SLOTS}</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {run.secureBox.map((slotItem, si) =>
                  slotItem ? (
                    <button
                      key={si}
                      onClick={() => doFromSecure(si)}
                      disabled={isOver}
                      className="truncate rounded border border-amber-800/60 bg-zinc-950/60 px-1.5 py-1 text-left text-[11px] text-amber-200 hover:bg-amber-900/30 disabled:cursor-default"
                      title="点击取回战局背包"
                    >
                      {slotItem.name}
                      {(slotItem.qty ?? 1) > 1 && `×${slotItem.qty}`}
                      <span className="ml-1 text-zinc-500">（取回）</span>
                    </button>
                  ) : (
                    <div key={si} className="rounded border border-dashed border-zinc-800 px-1.5 py-1 text-[11px] text-zinc-600">
                      空格位
                    </div>
                  ),
                )}
              </div>
            </div>
            <p className="mt-3 border-t border-zinc-800 pt-2 text-xs text-zinc-500">
              已入库：<span className="text-emerald-400">{bankedValue}</span> 废土币（{bankedQty} 件）
            </p>
          </div>

          {/* ⑤ 系统消息日志（带对局时间戳） */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="mb-2 text-sm font-medium text-zinc-300">系统消息日志</h2>
            <div className="max-h-[300px] space-y-1 overflow-y-auto pr-1 font-mono text-[13px] leading-relaxed">
              {run.log.map((line, i) => {
                const m = line.match(/^\[(\d{2}:\d{2})\]\s*/);
                const body = m ? line.slice(m[0].length) : line;
                const tone =
                  body.startsWith('⚔') || body.startsWith('⚠') || body.startsWith('⏰')
                    ? 'text-rose-300'
                    : body.startsWith('✔') || body.startsWith('🚁') || body.startsWith('❗')
                      ? 'text-emerald-300'
                      : body.startsWith('【系统】') || body.startsWith('【生存系统】')
                        ? 'text-sky-300'
                        : 'text-zinc-400';
                const battle = battleByLogIndex.get(i);
                return (
                  <div key={i}>
                    <p className={tone}>
                      {m && <span className="mr-1 text-zinc-600">[{m[1]}]</span>}
                      {body}
                    </p>
                    {battle && (
                      <details className="my-1 rounded border border-rose-900/60 bg-rose-950/10 px-2 py-1">
                        <summary className="cursor-pointer select-none text-[11px] text-rose-300/90 hover:text-rose-200">
                          📊 展开战斗回放（{battle.rounds.length} 回合 · 输出 {battle.dmgDealt} / 承伤 {battle.dmgTaken}
                          {battle.win ? ' · 胜利' : ' · 战败'})
                        </summary>
                        <div className="mt-1.5 space-y-1.5">
                          {/* 六维属性交互点评 */}
                          {battle.attrNotes.length > 0 && (
                            <div className="rounded bg-zinc-900/70 p-1.5">
                              <div className="mb-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
                                六维属性与战斗
                              </div>
                              {battle.attrNotes.map((n, ni) => (
                                <p key={ni} className="text-[11px] text-sky-300/90">
                                  ◈ {n}
                                </p>
                              ))}
                            </div>
                          )}
                          {/* 逐回合交互 + 掉血 */}
                          {battle.rounds.map((r) => (
                            <div key={r.round} className="rounded bg-zinc-900/50 p-1.5">
                              <div className="flex items-center justify-between text-[10px] text-zinc-500">
                                <span>第 {r.round} 回合</span>
                                <span className="font-mono">
                                  ❤ 你 {r.hpSelf} ｜ 敌 {r.hpEnemy}
                                </span>
                              </div>
                              <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-300">{r.text}</p>
                            </div>
                          ))}
                          {/* 一段战斗描写 */}
                          <p className="rounded border-l-2 border-rose-700/60 bg-zinc-900/60 p-1.5 text-[11px] italic leading-relaxed text-zinc-300">
                            {battle.narrative}
                          </p>
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {isOver && (
            <div
              className={`rounded-lg border p-5 ${
                failed ? 'border-rose-800 bg-rose-900/30' : 'border-emerald-700 bg-emerald-900/30'
              }`}
            >
              <h2 className={`mb-1 text-lg font-semibold ${failed ? 'text-rose-300' : 'text-emerald-300'}`}>
                {run.phase === 'extracted'
                  ? '✔ 撤离成功'
                  : run.phase === 'timeout'
                    ? '⏰ 时间耗尽 · 未能撤离'
                    : '✘ 撤离失败 · 幸存者濒死'}
              </h2>
              <p className="mb-3 text-sm text-zinc-300">
                {run.phase === 'extracted'
                  ? `物资已安全入库，估值 ${bankedValue} 废土币（已折算进基地货币）。`
                  : run.phase === 'timeout'
                    ? `对局时间耗尽，救援未能抵达。未撤离的 ${carriedValue} 废土币物资已遗失（安全箱 ${secureUsed} 格物资已保底入库）；${active?.name ?? '出击者'} 重伤濒死，需在战团中救治。`
                    : `未撤离的 ${carriedValue} 废土币物资已遗失（安全箱 ${secureUsed} 格物资已保底入库）；${active?.name ?? '出击者'} 重伤濒死，需在战团中用货币或医疗品救治，否则将离世。`}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={start}
                  className="flex-1 rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white hover:bg-emerald-500"
                >
                  再次出击
                </button>
                <button
                  onClick={() => {
                    // 兜底：若 effect 尚未写回归档（极端时序），先补写再退出
                    const s = runRef.current;
                    if (s && (s.phase === 'dead' || s.phase === 'extracted' || s.phase === 'timeout') && !writtenRef.current) {
                      persistRunResult();
                    }
                    reset();
                    onExit();
                  }}
                  className="rounded-lg border border-zinc-700 px-4 py-3 text-zinc-300 hover:bg-zinc-800"
                >
                  返回
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
