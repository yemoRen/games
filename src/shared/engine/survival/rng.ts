/*
 * rng.ts — 搜打撤换皮用的轻量可复现随机数工具。
 * 与 creation-v2 的 hashSeed / mulberry32 同源，便于在引擎与前端复用。
 */
export type RNG = () => number;

/** FNV-1a 字符串哈希 → 32bit 无符号整数种子 */
export function hashSeed(seed: number | string): number {
  const input = String(seed);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32：小巧、确定性的 PRNG，给定种子可完全复现 */
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由任意种子字符串/数字得到一个 RNG（最常用的入口） */
export function seededRng(seed: number | string): RNG {
  return mulberry32(hashSeed(seed));
}

export function randInt(rng: RNG, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function randFloat(rng: RNG, min: number, max: number): number {
  return rng() * (max - min) + min;
}

export function pick<T>(rng: RNG, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** 不重复抽取 n 个 */
export function pickN<T>(rng: RNG, arr: readonly T[], n: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  const count = Math.min(n, pool.length);
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

export function chance(rng: RNG, p: number): boolean {
  return rng() < p;
}

/** 按权重抽取 */
export function weightedPick<T>(
  rng: RNG,
  items: readonly { value: T; weight: number }[],
): T {
  const total = items.reduce((s, it) => s + Math.max(0, it.weight), 0);
  let roll = rng() * total;
  for (const it of items) {
    roll -= Math.max(0, it.weight);
    if (roll <= 0) return it.value;
  }
  return items[items.length - 1].value;
}

export function emptyAttributes() {
  return {
    vitality: 0,
    strength: 0,
    spirit: 0,
    endurance: 0,
    speed: 0,
    willpower: 0,
  };
}
