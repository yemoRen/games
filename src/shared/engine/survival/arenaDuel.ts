/*
 * arenaDuel.ts — 擂台切磋（本地 1v1 模拟对决）的引擎封装。
 *
 * 设计要点：
 *  - 复用 battle-v5 正式战斗单元链路（buildSurvivorUnit），让切磋完全等同于真实遇怪战斗的数值体系。
 *  - 切磋属性只取「角色自身六维 + 已装备装备属性」：buildArenaLoadout 刻意排除避难所/势力（基地页）
 *    提供的各类属性 buff（驻防全属性加成、势力声望、搜刮运势等），即「角色页面所展示的属性」。
 *  - 满血开局：对决单位以双方满血开局（initializeCurrentResourcesToMax），不继承成员当前残血，杜绝借切磋刷血。
 *  - 对决在「战斗存档（BattleSaveV1）」上逐步推进，绝不改动 SurvivalGameState 中的任何成员数据；
 *    因此切磋结束即「恢复至对决前状态」是天然成立的（双方都是全新拷贝）。
 *  - prepareArenaDuel 仅负责把两位战团成员构造成战斗单位并开局；arenaStep 推进一回合。
 */

import type { SurvivalGameState } from './state';
import { buildArenaLoadout } from './state';
import { buildSurvivorUnit } from './combatAdapter';
import { BattleRuntime } from '@shared/engine/battle-v5/runtime/BattleRuntime';
import {
  createDuelSession,
  stepDuel,
  type DuelSession,
  type DuelRoundResolution,
} from '@shared/engine/battle-v5/round/BattleAutoResolver';

export interface ArenaDuelHandle {
  session: DuelSession;
  /** 选手 A 的战团成员 id（同时也是 battle 内 player 单位 id） */
  idA: string;
  /** 选手 B 的战团成员 id（同时也是 battle 内 opponent 单位 id） */
  idB: string;
}

/**
 * 用两位战团成员「角色六维 + 装备属性」（不含基地页 buff）构建 battle-v5 战斗单位，
 * 开启一场可逐步推进的 1v1 对决。返回 null 表示成员不存在或两人相同。
 */
export function prepareArenaDuel(
  state: SurvivalGameState,
  idA: string,
  idB: string,
): ArenaDuelHandle | null {
  if (idA === idB) return null;
  const loadA = buildArenaLoadout(state, idA);
  const loadB = buildArenaLoadout(state, idB);
  if (!loadA || !loadB) return null;

  const runtime = new BattleRuntime();
  const a = buildSurvivorUnit(loadA.profile, loadA.attributes, loadA.bonus, runtime);
  const b = buildSurvivorUnit(loadB.profile, loadB.attributes, loadB.bonus, runtime);

  // 满血开局：无论成员当前真实血量多少，对决一律以满血开始（buildSurvivorUnit 默认即满血，
  // 这里显式再置一次，确保「不继承残血、避免刷血」的语义稳定，即使上游默认行为变化也不受影响）。
  // 对决单位是从存档全新拷贝、全程不写回 SurvivalGameState，故结束后成员真实状态完全不变。
  a.initializeCurrentResourcesToMax();
  b.initializeCurrentResourcesToMax();

  const session = createDuelSession({
    battleId: `arena-${idA}-${idB}-${Date.now()}`,
    player: a,
    opponent: b,
    runtime,
  });
  return { session, idA, idB };
}

/** 推进对决一回合，返回本回合结算（含新存档 / 交战序列 / 状态帧 / 胜负）。 */
export function arenaStep(session: DuelSession): DuelRoundResolution {
  return stepDuel(session);
}
