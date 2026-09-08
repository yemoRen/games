/**
 * ResetSaveDialog — v1.0.10：重置存档时弹出的「重生者姓名」输入窗。
 *
 * 背景：重置存档会清空并重建主角，早期版本直接取「玩家代号 / 首位幸存者名」，
 * 老存档里这两个值常常取不到，导致重建后的主角叫「幸存者」。
 * 现在统一改为弹窗让玩家自己填，取不到代号也能正常命名。
 */
import { useEffect, useRef, useState } from 'react';

export interface ResetSaveDialogProps {
  /** 建议名（玩家代号 / 当前主角名），取不到时为空，由玩家自行输入 */
  defaultName: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

/** 姓名长度上限（与注册代号一致，避免超长破坏排版） */
const NAME_MAX = 12;

export function ResetSaveDialog({ defaultName, onCancel, onConfirm }: ResetSaveDialogProps) {
  const [name, setName] = useState(defaultName);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const n = name.trim();
    if (n.length < 1) {
      setErr('请输入重生者姓名（1~12 个字符）。');
      return;
    }
    onConfirm(n.slice(0, NAME_MAX));
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="重置存档 · 输入重生者姓名"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-zinc-100">重置存档</h3>
        <p className="mt-2 text-xs leading-5 text-zinc-400">
          避难所将被清空重建，物资、成员、设施与进度全部归零（不可撤销）。
          <br />
          请为重生后的自己起一个名字——他将作为新的主角重新登记。
        </p>

        <div className="mt-4">
          <label className="mb-1 block text-xs text-zinc-500">重生者姓名</label>
          <input
            ref={inputRef}
            value={name}
            maxLength={NAME_MAX}
            placeholder="输入姓名（1~12 字）"
            onChange={(e) => {
              setName(e.target.value);
              if (err) setErr(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
              }
            }}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          />
          {err ? <div className="mt-2 text-xs text-rose-400">⚠ {err}</div> : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded bg-stone-600 px-3 py-1.5 text-xs text-white hover:bg-stone-500"
          >
            取消
          </button>
          <button
            onClick={submit}
            className="rounded bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500"
          >
            确认重置并重生
          </button>
        </div>
      </div>
    </div>
  );
}
