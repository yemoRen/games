/**
 * 收打撤登录页（废土风）。
 * 借鉴原游戏 AuthPageShell 的「居中虚线卡片 + 标题/lead + 页脚互链」结构，视觉换末世元素。
 */
import { useState } from 'react';
import Link from '@app/components/router/AppLink';
import { useNavigate } from 'react-router';
import { login } from '@shared/engine/survival/account';

export default function SurvivalLogin() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const res = login(name, pw);
    if (!res.ok) {
      setErr(res.error ?? '登录失败。');
      return;
    }
    navigate('/survival/play');
  };

  return (
    <div className="relative flex min-h-[100svh] items-center justify-center bg-zinc-950 px-4 text-zinc-200">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.6) 0px, rgba(255,255,255,0.6) 1px, transparent 1px, transparent 3px)',
        }}
      />
      <div className="relative w-full max-w-md">
        <header className="mb-6 text-center">
          <p className="font-mono text-[0.7rem] tracking-[0.4em] text-zinc-600">
            WASTELAND · EXTRACTION PROTOCOL
          </p>
          <h1 className="mt-3 text-2xl font-bold text-zinc-50">
            全民求生 <span className="text-amber-400">·</span>{' '}
            <span className="text-emerald-400">系统搜打撤</span>
          </h1>
          <p className="mt-2 text-sm text-rose-400/80 tracking-[0.2em]">幸存者身份核验</p>
        </header>

        <section className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/70 p-6 shadow-lg">
          <Link
            href="/survival"
            className="mb-4 inline-flex items-center text-sm text-zinc-400 transition-colors hover:text-emerald-400"
          >
            [← 返回末世首页]
          </Link>

          <h2 className="text-xl font-semibold text-zinc-100">登录避难所</h2>
          <p className="mt-1 text-sm text-zinc-400">使用代号与口令进入你的避难所。</p>

          <form className="mt-5 space-y-4" onSubmit={submit}>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">代号</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如 拾荒者23"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">口令</label>
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="••••••"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
            </div>

            {err && (
              <div className="rounded-lg border border-rose-700/50 bg-rose-900/30 px-3 py-2 text-sm text-rose-300">
                ⚠ {err}
              </div>
            )}

            <button
              type="submit"
              className="w-full rounded-lg border border-emerald-500/60 bg-emerald-600 px-6 py-3 font-semibold text-white transition hover:bg-emerald-500"
            >
              核验并进入 ▶
            </button>
          </form>
        </section>

        <div className="mt-5 text-center text-sm text-zinc-500">
          还没有代号？
          <Link href="/survival/signup" className="ml-1 text-emerald-400 hover:underline">
            创建幸存者档案
          </Link>
        </div>
      </div>
    </div>
  );
}
