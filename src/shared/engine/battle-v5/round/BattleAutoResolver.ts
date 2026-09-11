import { GameplayTags } from '@shared/engine/shared/tag-domain';
import type { AbilitySelectionStrategy } from '../abilities/AbilitySelectionStrategy';
import { ActiveSkill } from '../abilities/ActiveSkill';
import { BattleRoster } from '../core/BattleRoster';
import { peekQueuedAction } from '../core/runtimeState';
import { restoreBattleSave } from '../persistence/BattleStateCodec';
import type { BattleSaveV1 } from '../persistence/types';
import type { BattleRuntime } from '../runtime/BattleRuntime';
import type { UnitStateSnapshot } from '../systems/state/types';
import { TargetSelectionSystem } from '../systems/TargetSelectionSystem';
import type {
  TeamVictoryResult,
  TerminalTeamVictoryResult,
} from '../systems/TeamVictorySystem';
import type { Unit } from '../units/Unit';
import type { BattleStateTimelineV3, CombatSequenceV3 } from '../v3/types';
import { resolveLegalBasicAttack } from './BasicAttackResolver';
import { initializeBattle } from './BattleLifecycleResolver';
import { resolveBattleRound, sealRoundCommandSet } from './BattleRoundResolver';
import { resolveLegalQueuedAction } from './QueuedActionResolver';
import type { BattleActionIntentV1, RoundCommandSetV1 } from './types';

export interface AutomaticBattleResolutionV1 {
  readonly outcome: TerminalTeamVictoryResult;
  readonly rounds: number;
  readonly sequences: CombatSequenceV3[];
  readonly stateTimeline: BattleStateTimelineV3;
  readonly finalSnapshots: Readonly<Record<string, UnitStateSnapshot>>;
  readonly finalSave: BattleSaveV1;
}

export interface AutomaticDuelResolutionV1 {
  readonly winner: string;
  readonly loser: string;
  readonly turns: number;
  readonly sequences: CombatSequenceV3[];
  readonly stateTimeline: BattleStateTimelineV3;
  readonly winnerSnapshot: UnitStateSnapshot;
  readonly loserSnapshot: UnitStateSnapshot;
  readonly finalSave: BattleSaveV1;
}

export function resolveDuelToCompletion(input: {
  battleId: string;
  player: Unit;
  opponent: Unit;
  runtime: BattleRuntime;
}): AutomaticDuelResolutionV1 {
  if (input.player.teamId === input.opponent.teamId) {
    throw new Error('Duel units must belong to different teams');
  }
  const result = resolveBattleToCompletion({
    battleId: input.battleId,
    roster: BattleRoster.fromDuel(input.player, input.opponent),
    runtime: input.runtime,
  });
  const winner = result.outcome.winnerTeamId === input.opponent.teamId
    ? input.opponent
    : input.player;
  const loser = winner === input.player ? input.opponent : input.player;
  const winnerSnapshot = result.finalSnapshots[winner.id];
  const loserSnapshot = result.finalSnapshots[loser.id];
  if (!winnerSnapshot || !loserSnapshot) {
    throw new Error('Battle final state is missing a duel participant');
  }
  return {
    winner: winner.id,
    loser: loser.id,
    turns: result.rounds,
    sequences: result.sequences,
    stateTimeline: result.stateTimeline,
    winnerSnapshot,
    loserSnapshot,
    finalSave: result.finalSave,
  };
}

/** 单回合对决结算的返回类型（与 resolveBattleRound 一致）。 */
export type DuelRoundResolution = ReturnType<typeof resolveBattleRound>;

/**
 * 可逐步推进的 1v1 对决会话。
 * save 为第 0 回合权威存档；之后每调用一次 stepDuel 推进一回合。
 * 对决完全在战斗存档上模拟，不会改动任何真实成员数据。
 */
export interface DuelSession {
  readonly battleId: string;
  save: BattleSaveV1;
  readonly selectionStrategies: ReadonlyMap<string, AbilitySelectionStrategy>;
  readonly playerId: string;
  readonly opponentId: string;
  /** 第 0 回合（开局）状态帧，用于开战前的展示。 */
  readonly initialTimeline: BattleStateTimelineV3;
}

/**
 * 用两名战斗单位创建一场可逐步推进的对决会话。
 * 双方 teamId 必须不同（构建单位时通常已按各自 id 区分）。
 */
export function createDuelSession(input: {
  battleId: string;
  player: Unit;
  opponent: Unit;
  runtime: BattleRuntime;
}): DuelSession {
  if (input.player.teamId === input.opponent.teamId) {
    throw new Error('Duel units must belong to different teams');
  }
  const roster = BattleRoster.fromDuel(input.player, input.opponent);
  const selectionStrategies = new Map<string, AbilitySelectionStrategy>();
  for (const unit of roster.getAllUnits()) {
    selectionStrategies.set(unit.id, unit.abilities.getSelectionStrategy());
  }
  const initialized = initializeBattle({
    battleId: input.battleId,
    roster,
    runtime: input.runtime,
  });
  return {
    battleId: input.battleId,
    save: initialized.save,
    selectionStrategies,
    playerId: input.player.id,
    opponentId: input.opponent.id,
    initialTimeline: initialized.stateTimeline,
  };
}

/**
 * 推进对决一回合：自动为双方生成行动意图并执行单回合结算。
 * 返回本回合结果（含下一回合存档 / 交战序列 / 状态帧 / 胜负判定）。
 */
export function stepDuel(session: DuelSession): DuelRoundResolution {
  const commandSet = createAutomaticCommandSet(session.save, session.selectionStrategies);
  return resolveBattleRound(
    session.save,
    sealRoundCommandSet(session.save, commandSet),
  );
}

/**
 * Resolves a complete deterministic battle by repeatedly feeding automatic
 * intents into the same single-round resolver used by realtime matches.
 */
export function resolveBattleToCompletion(input: {
  battleId: string;
  roster: BattleRoster;
  runtime: BattleRuntime;
}): AutomaticBattleResolutionV1 {
  assertRuntimeMatchesRoster(input.roster, input.runtime);
  const allUnits = input.roster.getAllUnits();
  const selectionStrategies = new Map(
    allUnits.map((unit) => [
      unit.id,
      unit.abilities.getSelectionStrategy(),
    ]),
  );
  const initialized = initializeBattle({
    battleId: input.battleId,
    roster: input.roster,
    runtime: input.runtime,
  });
  let save: BattleSaveV1 = initialized.save;
  const sequences: CombatSequenceV3[] = [...initialized.sequences];
  const frames = [...initialized.stateTimeline.frames];
  let outcome: TeamVictoryResult = { battleEnded: false };

  while (!outcome.battleEnded) {
    const commandSet = createAutomaticCommandSet(save, selectionStrategies);
    const resolution = resolveBattleRound(
      save,
      sealRoundCommandSet(save, commandSet),
    );
    sequences.push(...resolution.sequences);
    frames.push(...resolution.stateTimeline.frames);
    outcome = resolution.outcome;
    save = resolution.save;
  }
  const terminalOutcome: TerminalTeamVictoryResult = outcome;

  const normalizedFrames = frames.map((frame, index) => ({
    ...frame,
    frameId: index + 1,
  }));
  const finalFrame = normalizedFrames[normalizedFrames.length - 1];
  return {
    outcome: terminalOutcome,
    rounds: save.checkpoint.round,
    sequences,
    stateTimeline: {
      unitIds: allUnits.map((unit) => unit.id),
      unitNames: Object.fromEntries(
        allUnits.map((unit) => [unit.id, unit.name]),
      ),
      frames: normalizedFrames,
    },
    finalSnapshots: finalFrame.units,
    finalSave: save,
  };
}

function createAutomaticCommandSet(
  save: BattleSaveV1,
  selectionStrategies: ReadonlyMap<string, AbilitySelectionStrategy>,
): RoundCommandSetV1 {
  const restored = restoreBattleSave(save);
  try {
    for (const unit of restored.roster.getAllUnits()) {
      const strategy = selectionStrategies.get(unit.id);
      if (strategy) unit.abilities.setSelectionStrategy(strategy);
    }
    const intents = Object.fromEntries(
      restored.roster.getLivingUnits().map((unit) => [
        unit.id,
        createAutomaticIntent(unit, restored.roster.getAllUnits()),
      ]),
    );
    const round = save.checkpoint.round + 1;
    return {
      version: 'round_command_set_v1',
      commandSetId: `${save.blueprint.battleId}:auto:${round}:${save.checkpoint.checkpointRevision}`,
      round,
      checkpointRevision: save.checkpoint.checkpointRevision,
      intents,
    };
  } finally {
    restored.runtime.dispose();
  }
}

function createAutomaticIntent(
  unit: Unit,
  allUnits: Unit[],
): BattleActionIntentV1 {
  const targetSystem = new TargetSelectionSystem();
  if (peekQueuedAction(unit)) {
    const queuedAction = resolveLegalQueuedAction(unit, allUnits);
    if (!queuedAction) {
      return { kind: 'skip', submittedBy: 'timeout' };
    }
    return {
      kind: 'basic_attack',
      targetUnitId: queuedAction.target.id,
      submittedBy: 'timeout',
    };
  }

  if (!unit.tags.hasTag(GameplayTags.STATUS.CONTROL.NO_SKILL)) {
    const candidates = unit.abilities
      .getAllAbilities()
      .filter((ability): ability is ActiveSkill =>
        ability instanceof ActiveSkill,
      )
      .flatMap((ability, order) => {
        const target = targetSystem
          .getTargetCandidates(unit, ability.targetPolicy, allUnits)
          .find((candidate) =>
            ability.canTrigger({ caster: unit, target: candidate }),
          );
        return target ? [{ ability, target, order }] : [];
      });
    const opponent = allUnits.find(
      (candidate) => candidate.teamId !== unit.teamId && candidate.isAlive(),
    ) ?? null;
    const selected = unit.abilities.getSelectionStrategy().select({
      caster: unit,
      opponent,
      candidates,
    });
    if (selected) {
      return {
        kind: 'ability',
        abilityId: selected.ability.id,
        targetUnitId: selected.target.id,
        submittedBy: 'timeout',
      };
    }
  }

  const basicAttack = resolveLegalBasicAttack(unit, allUnits);
  if (!basicAttack) {
    return { kind: 'skip', submittedBy: 'timeout' };
  }
  return {
    kind: 'basic_attack',
    targetUnitId: basicAttack.target.id,
    submittedBy: 'timeout',
  };
}

function assertRuntimeMatchesRoster(
  roster: BattleRoster,
  runtime: BattleRuntime,
): void {
  if (roster.getAllUnits().some((unit) => unit.runtime !== runtime)) {
    throw new Error('All battle units must belong to the supplied runtime');
  }
}
