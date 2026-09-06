/**
 * 收打撤注册页（废土风）。
 * 借鉴原游戏 AuthPageShell 的「居中虚线卡片 + 标题/lead + 页脚互链」结构，视觉换末世元素。
 */
import { useState } from 'react';
import Link from '@app/components/router/AppLink';
import { useNavigate } from 'react-router';
import { register, suggestCallsign } from '@shared/engine/survival/account';
import type { RNG } from '@shared/engine/survival/rng';
import { mulberry32 } from '@shared/engine/survival/rng';
import { createProtagonistGame, saveGame } from '@shared/engine/survival';

export default function SurvivalSignup() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const fillCallsign = () => {
    const rng: RNG = mulberry32(Date.now() >>> 0);
    setName(suggestCallsign(rng));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== confirm) {
      setErr('两次口令不一致。');
      return;
    }
    const res = register(name, pw);
    if (!res.ok) {
      setErr(res.error ?? '注册失败。');
      return;
    }
    // 注册即生成以代号为名的主角，写入当前账号存档（各账号独立进度）
    saveGame(createProtagonistGame(name));
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
          <p className="mt-2 text-sm text-rose-400/80 tracking-[0.2em]">建立幸存者档案</p>
        </header>

        <section className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/70 p-6 shadow-lg">
          <Link
            href="/survival"
            className="mb-4 inline-flex items-center text-sm text-zinc-400 transition-colors hover:text-emerald-400"
          >
            [← 返回末世首页]
          </Link>

          <h2 className="text-xl font-semibold text-zinc-100">登记代号</h2>
          <p className="mt-1 text-sm text-zinc-400">在避难所名册上留下你的代号与口令。</p>

          <form className="mt-5 space-y-4" onSubmit={submit}>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs text-zinc-500">代号</label>
                <button
                  type="button"
                  onClick={fillCallsign}
                  className="text-xs text-emerald-400 hover:underline"
                >
                  随机代号
                </button>
              </div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="至少 2 个字符"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">口令</label>
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="至少 4 位"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">确认口令</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="再次输入"
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
              建立档案并进入 ▶
            </button>
          </form>
        </section>

        <div className="mt-5 text-center text-sm text-zinc-500">
          已有代号？
          <Link href="/survival/login" className="ml-1 text-emerald-400 hover:underline">
            直接登录
          </Link>
        </div>
      </div>
    </div>
  );
}
