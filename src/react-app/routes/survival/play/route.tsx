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
  EquipSlots,
  GearSlot,
} from '@shared/engine/survival';
import {
  newGame,
  bankLoot,
  addRecruit,
  acceptRecruit,
  dismissRecruit,
  equipGear,
  unequipGear,
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
  type RNG,
  seededRng,
  chance,
  applySortieResult,
  recoverAll as _recoverAll,
} from '@shared/engine/survival';
import {
  createRun,
  search,
  rollEncounter,
  rollRescue,
  fight,
  extract,
  getZone,
  DANGER_ZONES,
  type ExtractionRunState,
} from '@shared/engine/extraction';
import { generateSurvivor } from '@shared/engine/survival/chargen';
import { loadGame, saveGame, clearSave } from '@shared/engine/survival';
import { INJURY_LABEL } from '@shared/engine/survival/recovery';
import { getCurrentUser } from '@shared/engine/survival/account';
import { MenuDrawer } from '../menu/MenuDrawer';
import {
  rollGearDrop,
  tierColor,
  RARITY_LEGEND,
} from '@shared/engine/survival/affixes';

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
};

function attrBars(attrs: Attributes) {
  const max = Math.max(20, ...Object.values(attrs));
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-[12px]">
      {(Object.keys(attrs) as (keyof Attributes)[]).map((k) => (
        <div key={k}>
          <div className="flex justify-between text-zinc-400">
            <span>{attrLabel(k)}</span>
            <span className="text-zinc-200">{attrs[k]}</span>
          </div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-zinc-800">
            <div
              className="h-full bg-emerald-500/70"
              style={{ width: `${Math.min(100, (attrs[k] / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
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

export default function SurvivalHub() {
  const [state, setState] = useState<SurvivalGameState>(() => {
    const loaded = loadGame() ?? newGame(seededRng(Date.now()));
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

      {/* 主内容 */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        {tab === 'character' && (
          <CharacterPanel state={state} mutate={mutate} rng={Math.random as RNG} />
        )}
        {tab === 'inventory' && <InventoryPanel state={state} mutate={mutate} rng={Math.random as RNG} />}
        {tab === 'base' && <BasePanel state={state} mutate={mutate} rng={Math.random as RNG} />}
        {tab === 'sortie' && (
          <SortiePanel state={state} setState={setState} onExit={() => goToTab('character')} />
        )}
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
                <div className="mt-2 flex flex-wrap gap-1">
                  {st.injuries.map((inj) => (
                    <span key={inj} className="rounded bg-rose-900/40 px-1.5 py-0.5 text-[11px] text-rose-300">
                      {INJURY_LABEL[inj]}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3">{attrBars(s.attributes)}</div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {s.traits.map((t) => (
                  <span
                    key={t.id}
                    title={t.description}
                    className="rounded border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[11px] text-zinc-300"
                  >
                    {t.name}
                  </span>
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
                    <span
                      key={t.id}
                      title={t.description}
                      className="rounded border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[11px] text-zinc-300"
                    >
                      {t.name}
                    </span>
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
  const equipped = (active ? state.equipped[active.id] : undefined) ?? ({} as EquipSlots);

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium text-zinc-300">背包物资</h2>

      {/* 材料 */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="mb-2 text-xs uppercase tracking-wider text-zinc-500">材料</h3>
        {state.materials.length === 0 ? (
          <p className="text-sm text-zinc-600">暂无材料，出击搜刮或拆解战利品获取。</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {state.materials.map((m) => (
              <div key={m.id} className="rounded border border-zinc-800 bg-zinc-950/50 p-2">
                <div className="text-sm text-zinc-200">{m.name}</div>
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  {MATERIAL_LABEL[m.kind]} · x{m.quantity} · ⛁{m.value}
                </div>
              </div>
            ))}
          </div>
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

      {/* 装备库 + 当前装备 */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wider text-zinc-500">装备库</h3>
          <span className="text-[11px] text-zinc-500">
            当前出击：{active?.name ?? '无'}
          </span>
        </div>
        {state.gear.length === 0 ? (
          <p className="text-sm text-zinc-600">尚未制造任何装备。</p>
        ) : (
          <ul className="space-y-2">
            {state.gear.map((g) => {
              const onActive = active && equipped[g.slot] === g.id;
              return (
                <li key={g.id} className="rounded border border-zinc-800 bg-zinc-950/50 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm text-zinc-100">{g.name}</span>
                      <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">
                        {g.rarity}·{slotLabel(g.slot)}
                      </span>
                    </div>
                    {active && (
                      onActive ? (
                        <button
                          onClick={() => mutate((s) => unequipGear(s, active.id, g.slot))}
                          className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-600"
                        >
                          卸下
                        </button>
                      ) : (
                        <button
                          onClick={() => mutate((s) => equipGear(s, active.id, g.id))}
                          className="rounded bg-emerald-700 px-2 py-1 text-xs text-white hover:bg-emerald-600"
                        >
                          装备
                        </button>
                      )
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
        )}
      </div>
    </section>
  );
}

function slotLabel(slot: GearSlot): string {
  return slot === 'weapon' ? '武器' : slot === 'armor' ? '护甲' : '配件';
}

// ===== 基地 =====
function BasePanel(props: {
  state: SurvivalGameState;
  mutate: (fn: (s: SurvivalGameState) => SurvivalGameState) => void;
  rng: RNG;
}) {
  const { state, mutate, rng } = props;
  const bonuses = computeShelterBonuses(state.facilities, state.factionRep);
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-300">避难所</h2>
        <button
          onClick={() => {
            clearSave();
            mutate(() => newGame(rng));
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
    setState((prev) => {
      let next = bankLoot(prev, s.bankedLoot);
      if (s.bankedNpc) next = addRecruit(next, s.bankedNpc);
      return applySortieResult(next, {
        survivorId: prof.id,
        survivorName: prof.name,
        zoneName: s.zone.name,
        outcome: s.phase === 'dead' ? 'death' : 'success',
        bankedItems: s.bankedLoot.length,
        bankedValue: s.bankedLoot.reduce((a, b) => a + b.value, 0),
        enemyFaced: s.log.find((l) => l.startsWith('⚔'))?.match(/【(.+?)】/)?.[1],
        rescued: !!s.bankedNpc,
        finalHp: s.condition.resources.hp.current,
        maxHp: s.condition.resources.hp.max ?? 0,
      });
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
    const r = createRun(loadout, zone, startHp);
    runRef.current = r;
    const s = seed.trim();
    rngRef.current = s ? seededRng(s) : (Math.random as RNG);
    sync();
  };

  const makeBonusLoot = (): ExtractionRunState['carriedLoot'][number] => {
    const zone = getZone(zoneId);
    // 瞭望塔额外掉落：直接产出一件带阶级词缀的装备（阶级随区域危险度提升）
    return rollGearDrop(rngRef.current, zone.dangerLevel, 0.25);
  };

  const doSearch = () => {
    const s = runRef.current;
    if (!s || s.phase !== 'searching') return;
    const lootLuck = active
      ? buildSortieLoadout(state, active.id)?.bonus.lootLuck ?? 0
      : 0;
    search(s, rngRef.current, lootLuck);
    // 救援事件：按概率带回幸存者
    if (active) {
      rollRescue(s, rngRef.current, () => generateSurvivor(rngRef.current));
    }
    const enemy = rollEncounter(s, rngRef.current);
    if (enemy) fight(s, enemy, rngRef.current);
    // 瞭望塔：搜刮运势额外掉落（词条/装备/避难所聚合）
    if (chance(rngRef.current, lootLuck)) {
      s.carriedLoot.push(makeBonusLoot());
      s.log.push('【系统】瞭望塔侦察生效，额外发现一批物资。');
    }
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
  const carriedValue = carried.reduce((a, b) => a + b.value, 0);
  const banked = run?.bankedLoot ?? [];
  const bankedValue = banked.reduce((a, b) => a + b.value, 0);
  const isOver = run?.phase === 'dead' || run?.phase === 'extracted';
  const hpPct = hp && (hp.max ?? 0) > 0 ? Math.max(0, (hp.current / (hp.max ?? 0)) * 100) : 0;
  const hpColor = hpPct > 50 ? 'bg-emerald-500' : hpPct > 25 ? 'bg-amber-500' : 'bg-rose-600';

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
                <div className={`h-full ${hpColor} transition-all`} style={{ width: `${hpPct}%` }} />
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <h2 className="mb-2 text-sm font-medium text-zinc-300">行动记录</h2>
              <div className="max-h-[340px] space-y-1 overflow-y-auto pr-1 font-mono text-[13px] leading-relaxed">
                {run.log.map((line, i) => (
                  <p
                    key={i}
                    className={
                      line.startsWith('⚔')
                        ? 'text-rose-300'
                        : line.startsWith('✔')
                          ? 'text-emerald-300'
                          : line.startsWith('【系统】')
                            ? 'text-sky-300'
                            : 'text-zinc-400'
                    }
                  >
                    {line}
                  </p>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <h2 className="mb-2 flex items-center justify-between text-sm font-medium text-zinc-300">
                <span>携带物资</span>
                <span className="text-xs text-zinc-500">{carried.length} 件</span>
              </h2>
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
                <ul className="space-y-1 text-sm">
                  {carried.map((it, i) => {
                    const color = it.tier != null ? tierColor(it.tier) : '#a1a1aa';
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
                            </span>
                          </span>
                          <span className="text-emerald-400">{it.value}</span>
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
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-3 border-t border-zinc-800 pt-2 text-xs text-zinc-500">
                已入库：<span className="text-emerald-400">{bankedValue}</span> 废土币（{banked.length} 件）
              </p>
            </div>
          </div>

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
            <div
              className={`rounded-lg border p-5 ${
                run.phase === 'extracted' ? 'border-emerald-700 bg-emerald-900/30' : 'border-rose-800 bg-rose-900/30'
              }`}
            >
              <h2 className={`mb-1 text-lg font-semibold ${run.phase === 'extracted' ? 'text-emerald-300' : 'text-rose-300'}`}>
                {run.phase === 'extracted' ? '✔ 撤离成功' : '✘ 撤离失败·幸存者濒死'}
              </h2>
              <p className="mb-3 text-sm text-zinc-300">
                {run.phase === 'extracted'
                  ? `物资已安全入库，估值 ${bankedValue} 废土币（已折算进基地货币）。`
                  : `未撤离的 ${carriedValue} 废土币物资已遗失；${active?.name ?? '出击者'} 重伤濒死，需在战团中用货币或医疗品救治，否则将离世。`}
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
                    if (s && (s.phase === 'dead' || s.phase === 'extracted') && !writtenRef.current) {
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
