/**
 * 全民求生·系统搜打撤 — 独立落地页（Landing）。
 *
 * 与万界道友完全并列的独立游戏入口：废土风视觉，自带账号体系。
 * 借鉴原游戏登录页「顶部标识 + 大标题 + slogan + 居中卡片 + 页脚互链」的结构，
 * 但视觉换成收打撤末世元素（深岩灰 / 毒绿 / 锈橙 / 警示红、硬朗等宽字、辐射意象）。
 */
import { useState } from 'react';
import Link from '@app/components/router/AppLink';
import { useNavigate } from 'react-router';
import { getCurrentUser, logout } from '@shared/engine/survival/account';

function HazardMark() {
  return (
    <div className="relative flex h-24 w-24 items-center justify-center rounded-full border border-dashed border-amber-500/50 bg-zinc-900/60 shadow-[0_0_40px_-8px_rgba(245,158,11,0.35)]">
      <span className="absolute text-5xl text-amber-500/80" aria-hidden>
        ☢
      </span>
      <span className="relative z-10 text-lg font-bold tracking-widest text-emerald-400">
        求生
      </span>
    </div>
  );
}

const PHASES = [
  {
    icon: '🛰',
    title: '搜',
    desc: '潜入废弃公寓、医院、地铁与禁区，搜刮材料、装备与补给。危险等级越高，掉落阶级越高。',
  },
  {
    icon: '⚔',
    title: '打',
    desc: '遭遇作战无人机、重装暴徒与废土狙击手。敌人词缀随区域难度逐阶提升——白绿蓝紫黄橙红。',
  },
  {
    icon: '🏃',
    title: '撤',
    desc: '带足物资即刻撤离，回基地折算废土币、入库装备。撤离失败则丢失全部携带物。',
  },
];

export default function SurvivalLanding() {
  const navigate = useNavigate();
  const [user, setUser] = useState<string | null>(() => getCurrentUser());

  const onLogout = () => {
    logout();
    setUser(null);
  };

  const enterShelter = () => {
    // 未登录先去核验身份，登录后直奔避难所（各自账号有独立存档）
    navigate(getCurrentUser() ? '/survival/play' : '/survival/login');
  };

  return (
    <div className="relative min-h-[100svh] overflow-hidden bg-zinc-950 text-zinc-200">
      {/* 背景：扫描线 + 暗角 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.6) 0px, rgba(255,255,255,0.6) 1px, transparent 1px, transparent 3px)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 50% -10%, rgba(16,185,129,0.10), transparent 60%), radial-gradient(100% 60% at 50% 120%, rgba(245,158,11,0.08), transparent 55%)',
        }}
      />

      <div className="relative mx-auto flex min-h-[100svh] w-full max-w-3xl flex-col justify-center px-4 py-10">
        {/* 账号条 */}
        <div className="mb-8 flex items-center justify-between">
          <span className="font-mono text-[0.7rem] tracking-[0.4em] text-zinc-600">
            WASTELAND · EXTRACTION PROTOCOL
          </span>
          <div className="flex items-center gap-2 text-sm">
            {user ? (
              <>
                <span className="text-emerald-400">▣ 归队 {user}</span>
                <button
                  onClick={onLogout}
                  className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:border-rose-500 hover:text-rose-300"
                >
                  登出
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/survival/login"
                  className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
                >
                  登录
                </Link>
                <Link
                  href="/survival/signup"
                  className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
                >
                  注册
                </Link>
              </>
            )}
          </div>
        </div>

        {/* 标识 / 标题 */}
        <header className="text-center">
          <div className="mb-5 flex justify-center">
            <HazardMark />
          </div>
          <h1 className="font-mono text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl">
            全民求生
            <span className="text-emerald-400"> · </span>
            <span className="text-amber-400">系统搜打撤</span>
          </h1>
          <p className="mt-4 text-sm tracking-[0.25em] text-rose-400/80 sm:text-base">
            末世已至 · 搜刮 · 交战 · 撤离
          </p>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-zinc-400 sm:text-base">
            文明崩塌之后，幸存者退守据点。你将继续潜入废墟搜刮物资、击退变异威胁，
            并在每一次撤离中把同伴带回——活下去，是唯一的任务。
          </p>
        </header>

        {/* 主行动 */}
        <div className="mt-9 flex flex-col items-center gap-3">
          <button
            onClick={enterShelter}
            className="group w-full max-w-sm rounded-lg border border-emerald-500/60 bg-emerald-600 px-6 py-3.5 text-base font-semibold text-white shadow-[0_0_30px_-6px_rgba(16,185,129,0.6)] transition hover:bg-emerald-500"
          >
            进入避难所 ▶
          </button>
          <Link
            href="/survival/play"
            className="text-sm text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
          >
            或前往「避难所」浏览末世行止
          </Link>
        </div>

        {/* 搜 / 打 / 撤 三阶段 */}
        <section className="mt-11 grid gap-3 sm:grid-cols-3">
          {PHASES.map((p) => (
            <div
              key={p.title}
              className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 transition hover:border-emerald-500/40"
            >
              <div className="flex items-center gap-2">
                <span className="text-2xl" aria-hidden>
                  {p.icon}
                </span>
                <h3 className="text-lg font-semibold text-zinc-100">{p.title}</h3>
              </div>
              <p className="mt-2 text-xs leading-6 text-zinc-400">{p.desc}</p>
            </div>
          ))}
        </section>

        {/* 资源体系 */}
        <section className="mt-5 grid grid-cols-2 gap-2 text-xs text-zinc-400 sm:grid-cols-4">
          {[
            ['🪙 废土币', '撤离入库折算'],
            ['🧰 物资材料', '改装备用'],
            ['🛡 阶级装备', '白→红七阶'],
            ['🧑‍🤝‍🧑 战团', '救援即入列'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
              <div className="text-zinc-200">{k}</div>
              <div className="mt-0.5 text-zinc-500">{v}</div>
            </div>
          ))}
        </section>

        {/* 页脚 */}
        <footer className="mt-12 border-t border-zinc-800 pt-5 text-center text-xs text-zinc-600">
          本作账号与存档仅保存在本机浏览器 · 数据不上传
          <div className="mt-1 text-zinc-700">
            © 末世协议 · SYSTEM EXTRACTION
          </div>
        </footer>
      </div>
    </div>
  );
}
