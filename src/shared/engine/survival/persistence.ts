/*
 * persistence.ts — 浏览器端存档（localStorage）。
 * 服务端/Node 环境（如 demo、测试）无 localStorage，做好守卫，回退为空。
 *
 * 存档按「当前登录账号」隔离：每个账号拥有独立存档槽位，
 * 不同账号/密码对应不同的游戏进度。未登录时不读写（由玩法页登录门禁保证）。
 */
import type { SurvivalGameState } from './state';
import type { ExtractionRunState } from '../extraction/types';
import { emptyGardenPlots } from './state';
import { getCurrentUser } from './account';

const SAVE_PREFIX = 'wqqs-survival-save-v1:';
const RUN_PREFIX = 'wqqs-survival-run-v1:';

function slotKey(name: string): string {
  return `${SAVE_PREFIX}${name}`;
}

function runSlotKey(name: string): string {
  return `${RUN_PREFIX}${name}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* 某些环境访问 localStorage 会抛错 */
  }
  return null;
}

export function hasSave(): boolean {
  const s = getStorage();
  const name = getCurrentUser();
  if (!s || !name) return false;
  return s.getItem(slotKey(name)) != null;
}

export function loadGame(): SurvivalGameState | null {
  const s = getStorage();
  const name = getCurrentUser();
  if (!s || !name) return null;
  const raw = s.getItem(slotKey(name));
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as SurvivalGameState;
    if (data && data.version && Array.isArray(data.survivors)) {
      // 旧存档补齐菜园地块，避免切页种植后丢失
      if (!data.gardenPlots || data.gardenPlots.length === 0) {
        data.gardenPlots = emptyGardenPlots();
      }
      return data;
    }
  } catch {
    /* 损坏存档直接忽略 */
  }
  return null;
}

export function saveGame(state: SurvivalGameState): void {
  const s = getStorage();
  const name = getCurrentUser();
  if (!s || !name) return;
  try {
    s.setItem(slotKey(name), JSON.stringify(state));
  } catch {
    /* 配额溢出等忽略 */
  }
}

export function clearSave(): void {
  const s = getStorage();
  const name = getCurrentUser();
  if (!s || !name) return;
  s.removeItem(slotKey(name));
}

// ===== 出击对局（sortie run）独立存档：刷新/重进不退出出击 =====

/** 持久化当前出击对局（仅在进行中写入；终局由调用方负责清理） */
export function saveRun(name: string, run: ExtractionRunState): void {
  const s = getStorage();
  if (!s || !name) return;
  try {
    s.setItem(runSlotKey(name), JSON.stringify(run));
  } catch {
    /* 配额溢出等忽略 */
  }
}

/** 读取进行中的出击对局（无则返回 null） */
export function loadRun(name: string): ExtractionRunState | null {
  const s = getStorage();
  if (!s || !name) return null;
  const raw = s.getItem(runSlotKey(name));
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as ExtractionRunState;
    if (data && typeof data === 'object' && 'phase' in data && 'graph' in data) return data;
  } catch {
    /* 损坏存档直接忽略 */
  }
  return null;
}

/** 清除进行中的出击对局 */
export function clearRun(name: string): void {
  const s = getStorage();
  if (!s || !name) return;
  s.removeItem(runSlotKey(name));
}
