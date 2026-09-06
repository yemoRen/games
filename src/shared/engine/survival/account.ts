/**
 * account.ts — 收打撤（全民求生·系统搜打撤）本地账号体系。
 *
 * 与万界道友的 better-auth 后端完全独立：仅用 localStorage 持久化，
 * 让收打撤成为「自带账号」的独立游戏，无需触碰原游戏基础设施。
 * 密码做简单哈希（djb2 + 盐），仅用于离线演示，非安全级加密。
 */
import type { RNG } from './rng';

const ACCOUNTS_KEY = 'wasteland-accounts-v1';
const CURRENT_KEY = 'wasteland-current-user-v1';
const PW_SALT = 'wasteland://sys-extract';

export interface WastelandAccount {
  name: string;
  pwHash: string;
  createdAt: string;
}

export interface AccountResult {
  ok: boolean;
  error?: string;
}

function hashPassword(pw: string): string {
  const src = PW_SALT + pw;
  let h = 5381;
  for (let i = 0; i < src.length; i++) {
    h = ((h << 5) + h + src.charCodeAt(i)) | 0;
  }
  // 再叠加一次长度与首字符，降低碰撞
  h = (h ^ (pw.length * 2654435761)) >>> 0;
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

function readAccounts(): WastelandAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WastelandAccount[]) : [];
  } catch {
    return [];
  }
}

function writeAccounts(list: WastelandAccount[]): void {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota */
  }
}

export function accountExists(name: string): boolean {
  const n = name.trim();
  return readAccounts().some((a) => a.name === n);
}

export function register(name: string, password: string): AccountResult {
  const n = name.trim();
  if (n.length < 2) return { ok: false, error: '代号至少 2 个字符。' };
  if (password.length < 4) return { ok: false, error: '口令至少 4 位。' };
  if (accountExists(n)) return { ok: false, error: '该代号已在避难所登记。' };
  const list = readAccounts();
  list.push({ name: n, pwHash: hashPassword(password), createdAt: new Date().toISOString() });
  writeAccounts(list);
  localStorage.setItem(CURRENT_KEY, n);
  return { ok: true };
}

export function login(name: string, password: string): AccountResult {
  const n = name.trim();
  const acc = readAccounts().find((a) => a.name === n);
  if (!acc) return { ok: false, error: '查无此代号，请先登记。' };
  if (acc.pwHash !== hashPassword(password)) return { ok: false, error: '口令错误。' };
  localStorage.setItem(CURRENT_KEY, n);
  return { ok: true };
}

export function logout(): void {
  localStorage.removeItem(CURRENT_KEY);
}

export function getCurrentUser(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

/**
 * 仅用于测试/演示：随机生成一个代号账号（不写入，返回可用凭据）。
 */
export function suggestCallsign(rng: RNG): string {
  const prefixes = ['拾荒者', '夜枭', '铁锈', '余烬', '断线', '游隼', '盐粒', '废都'];
  const suffix = 10 + Math.floor(rng() * 89);
  return `${prefixes[Math.floor(rng() * prefixes.length)]}${suffix}`;
}
