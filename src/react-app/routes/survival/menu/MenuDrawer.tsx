/**
 * MenuDrawer.tsx — 末世行止（仿原游戏「万界行止」）侧滑抽屉。
 *
 * 从避难所（/survival/play）右侧滑出，不离开避难所、不重新加载；
 * 关闭即返回避难所。复用 views.tsx 的各子页面，数据与避难所同源
 * （经 play 页的 state/mutate/setState，统一走 per-account 存档）。
 */
import { useState, type ReactNode } from 'react';
import type { RNG } from '@shared/engine/survival/rng';
import { mulberry32 } from '@shared/engine/survival/rng';
import type { SurvivalGameState } from '@shared/engine/survival/state';
import {
  ViewGarden,
  ViewTactics,
  ViewSkills,
  ViewFactionSkills,
  ViewBattleLog,
  ViewExplorationNotes,
  ViewWandering,
  ViewMirage,
  ViewRerollTrait,
  ViewQuests,
  ViewMarket,
  ViewRecycle,
  ViewPremiumShop,
  ViewAuction,
  ViewLeaderboard,
  ViewWager,
  ViewArena,
  ViewNews,
  ViewRedeem,
  ViewMerit,
  ViewCommunity,
  ViewFeedback,
  ViewSettings,
  ViewRecruits,
  ViewMedical,
  ViewCraft,
} from './views';

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  group: string;
  Component: React.FC<{
    state: SurvivalGameState;
    mutate: (fn: (s: SurvivalGameState) => SurvivalGameState) => void;
    setState: React.Dispatch<React.SetStateAction<SurvivalGameState>>;
    rng: RNG;
  }>;
}

const MENU: { group: string; items: MenuItem[] }[] = [
  {
    group: '生存',
    items: [
      { id: 'medical', label: '医疗中心', icon: '🏥', group: '生存', Component: ViewMedical },
      { id: 'recruits', label: '幸存者花名册', icon: '🧑‍🤝‍🧑', group: '生存', Component: ViewRecruits },
      { id: 'garden', label: '避难所·菜园', icon: '🌱', group: '生存', Component: ViewGarden },
      { id: 'craft', label: '医疗·制作台', icon: '⚗️', group: '生存', Component: ViewCraft },
      { id: 'tactics', label: '战术手册', icon: '📓', group: '生存', Component: ViewTactics },
      { id: 'skills', label: '掌握技能', icon: '⚔️', group: '生存', Component: ViewSkills },
      { id: 'faction-skills', label: '战团技能', icon: '🏛️', group: '生存', Component: ViewFactionSkills },
      { id: 'battle-log', label: '全部战绩', icon: '📜', group: '生存', Component: ViewBattleLog },
      { id: 'notes', label: '探险札记', icon: '🗒️', group: '生存', Component: ViewExplorationNotes },
    ],
  },
  {
    group: '机遇',
    items: [
      { id: 'wandering', label: '漫游搜打撤', icon: '🗺️', group: '机遇', Component: ViewWandering },
      { id: 'mirage', label: '蜃景密室', icon: '🌀', group: '机遇', Component: ViewMirage },
      { id: 'reroll', label: '重塑天赋', icon: '🎲', group: '机遇', Component: ViewRerollTrait },
      { id: 'quests', label: '任务中心', icon: '📋', group: '机遇', Component: ViewQuests },
    ],
  },
  {
    group: '交易',
    items: [
      { id: 'market', label: '废土市场', icon: '🛒', group: '交易', Component: ViewMarket },
      { id: 'recycle', label: '鉴物回收', icon: '♻️', group: '交易', Component: ViewRecycle },
      { id: 'shop', label: '英雄商城', icon: '✨', group: '交易', Component: ViewPremiumShop },
      { id: 'auction', label: '拍卖行', icon: '🔨', group: '交易', Component: ViewAuction },
    ],
  },
  {
    group: '争锋',
    items: [
      { id: 'leaderboard', label: '英雄榜', icon: '🏆', group: '争锋', Component: ViewLeaderboard },
      { id: 'wager', label: '末世赌局', icon: '🎰', group: '争锋', Component: ViewWager },
      { id: 'arena', label: '擂台切磋', icon: '🥊', group: '争锋', Component: ViewArena },
    ],
  },
  {
    group: '情报',
    items: [{ id: 'news', label: '世界传闻', icon: '📰', group: '情报', Component: ViewNews }],
  },
  {
    group: '系统',
    items: [
      { id: 'redeem', label: '兑换码', icon: '🎁', group: '系统', Component: ViewRedeem },
      { id: 'merit', label: '救济簿', icon: '📖', group: '系统', Component: ViewMerit },
      { id: 'community', label: '幸存者社群', icon: '💬', group: '系统', Component: ViewCommunity },
      { id: 'feedback', label: '意见反馈', icon: '📮', group: '系统', Component: ViewFeedback },
      { id: 'settings', label: '系统设置', icon: '⚙️', group: '系统', Component: ViewSettings },
    ],
  },
];

export interface MenuDrawerProps {
  state: SurvivalGameState;
  mutate: (fn: (s: SurvivalGameState) => SurvivalGameState) => void;
  setState: React.Dispatch<React.SetStateAction<SurvivalGameState>>;
  /** v1.0.10 补充：重置存档（含退出出击），由调用方（避难所 Hub）实现 */
  onResetGame?: (name: string) => void;
  open: boolean;
  onClose: () => void;
}

export function MenuDrawer(props: MenuDrawerProps) {
  const { state, mutate, setState, onResetGame, open, onClose } = props;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rng] = useState<RNG>(() => mulberry32(Date.now() >>> 0));

  const close = () => {
    setActiveId(null);
    onClose();
  };

  const active = activeId ? MENU.flatMap((g) => g.items).find((it) => it.id === activeId) : null;

  // 渲染各子页面需要的公共 props
  const viewProps = {
    state,
    mutate,
    setState,
    rng,
    onResetGame,
  } as const;

  return (
    <>
      {/* 右侧滑出抽屉：进入避难所后从「末世行止」触发，关闭即返回避难所 */}
      <div
        className={`fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`}
        aria-hidden={!open}
      >
        {/* 遮罩 */}
        <div
          onClick={close}
          className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
        />
        {/* 抽屉面板（右侧滑入） */}
        <aside
          className={`absolute right-0 top-0 flex h-full w-[min(92vw,420px)] flex-col bg-zinc-950 shadow-2xl transition-transform duration-300 ease-out ${
            open ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur">
            {active ? (
              <button
                onClick={() => setActiveId(null)}
                className="text-sm text-zinc-300 hover:text-zinc-100"
              >
                ← 返回末世行止
              </button>
            ) : (
              <h1 className="text-lg font-semibold text-zinc-100">末世行止</h1>
            )}
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              {active && (
                <span className="flex items-center gap-1 text-xs">
                  <span aria-hidden>{active.icon}</span>
                  <span>{active.label}</span>
                </span>
              )}
              <button
                onClick={close}
                className="rounded bg-zinc-800 px-3 py-1 text-xs text-white hover:bg-zinc-700"
              >
                关闭
              </button>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">
            {active ? (
              <ActiveView item={active} props={viewProps} />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {MENU.map((g) => (
                  <section
                    key={g.group}
                    className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm"
                  >
                    <h2 className="border-b border-zinc-800 pb-2 text-sm font-semibold text-zinc-200">
                      {g.group}
                    </h2>
                    <ul className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      {g.items.map((it) => (
                        <li key={it.id}>
                          <button
                            onClick={() => setActiveId(it.id)}
                            className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-left hover:border-emerald-600 hover:bg-emerald-950/30"
                          >
                            <span aria-hidden className="text-base">
                              {it.icon}
                            </span>
                            <span className="text-zinc-100">{it.label}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </main>
        </aside>
      </div>
    </>
  );
}

function ActiveView({
  item,
  props,
}: {
  item: MenuItem;
  props: {
    state: SurvivalGameState;
    mutate: (fn: (s: SurvivalGameState) => SurvivalGameState) => void;
    setState: React.Dispatch<React.SetStateAction<SurvivalGameState>>;
    rng: RNG;
  };
}) {
  const Comp = item.Component;
  return <Comp {...props} /> as ReactNode;
}
