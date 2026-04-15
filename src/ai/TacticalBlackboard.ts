import * as YUKA from 'yuka';
import { TEAM_BLUE, TEAM_RED, type TeamId } from '@/config/constants';
import { gameState } from '@/core/GameState';
import type { TDMAgent } from '@/entities/TDMAgent';
import type { TeamIntent, TeamTacticalBoard } from './AITypes';

const boards = new Map<TeamId, TeamTacticalBoard>([
  [TEAM_BLUE, { team: TEAM_BLUE, intent: 'hold', lastUpdate: -10, focusPos: null, pressure: 0, knownEnemyCount: 0, anchorName: null, traderName: null }],
  [TEAM_RED, { team: TEAM_RED, intent: 'hold', lastUpdate: -10, focusPos: null, pressure: 0, knownEnemyCount: 0, anchorName: null, traderName: null }],
]);

export function getTeamBoard(team: TeamId): TeamTacticalBoard {
  return boards.get(team)!;
}

function blendFocus(board: TeamTacticalBoard, pos: YUKA.Vector3, certainty: number): void {
  if (!board.focusPos) {
    board.focusPos = pos.clone();
    return;
  }
  const alpha = Math.max(0.18, Math.min(0.65, certainty));
  board.focusPos.set(
    board.focusPos.x + (pos.x - board.focusPos.x) * alpha,
    board.focusPos.y + (pos.y - board.focusPos.y) * alpha,
    board.focusPos.z + (pos.z - board.focusPos.z) * alpha,
  );
}

export function pushEnemyKnowledge(team: TeamId, pos: YUKA.Vector3, certainty: number): void {
  const board = getTeamBoard(team);
  blendFocus(board, pos, certainty);
  board.lastUpdate = gameState.worldElapsed;
  board.knownEnemyCount = Math.min(6, board.knownEnemyCount + 1);
  board.pressure = Math.min(1, board.pressure + certainty * 0.12);
}

export function noteTeamIntent(team: TeamId, intent: TeamIntent, focusPos?: YUKA.Vector3 | null, pressure?: number): void {
  const board = getTeamBoard(team);
  board.intent = intent;
  board.lastUpdate = gameState.worldElapsed;
  if (focusPos) blendFocus(board, focusPos, 0.5);
  if (typeof pressure === 'number') board.pressure = Math.max(0, Math.min(1, pressure));
}

export function decayTacticalBoards(dt: number): void {
  for (const board of boards.values()) {
    board.pressure = Math.max(0, board.pressure - dt * 0.06);
    if (board.knownEnemyCount > 0 && gameState.worldElapsed - board.lastUpdate > 3.5) {
      board.knownEnemyCount = Math.max(0, board.knownEnemyCount - 1);
    }
    if (board.focusPos && gameState.worldElapsed - board.lastUpdate > 8) {
      board.focusPos = null;
    }
    if (gameState.worldElapsed - board.lastUpdate > 5 && board.intent !== 'hold') {
      board.intent = board.pressure > 0.2 ? 'hunt' : 'hold';
    }
  }
}

export function updateBoardFromAgent(ag: TDMAgent): void {
  const board = getTeamBoard(ag.team);
  board.lastUpdate = gameState.worldElapsed;

  if (ag.tacticalRole === 'anchor') board.anchorName = ag.name;
  if (ag.tacticalRole === 'trader') board.traderName = ag.name;

  const lowHP = ag.hp / ag.maxHP < 0.4;
  const highPressure = ag.recentDamage > ag.maxHP * 0.2 || ag.stress > 55;

  if (lowHP && highPressure) {
    noteTeamIntent(ag.team, 'reset', ag.currentCover ?? ag.spawnPos, 0.35);
    return;
  }

  if (ag.currentTarget) {
    const focus = ag.hasLastKnown ? ag.lastKnownPos : ag.currentTarget.position;
    pushEnemyKnowledge(ag.team, focus, Math.max(0.4, ag.targetCertainty));

    if (ag.tacticalRole === 'flanker') {
      noteTeamIntent(ag.team, ag.preferredPeekSide === 'left' ? 'flank_left' : 'flank_right', focus, 0.65);
      return;
    }

    if (ag.nearbyAllies >= 2 && ag.confidence > 45 && !lowHP) {
      noteTeamIntent(ag.team, 'collapse', focus, 0.8);
    } else {
      noteTeamIntent(ag.team, 'hold', focus, 0.55);
    }
    return;
  }

  if (ag.hasLastKnown) {
    pushEnemyKnowledge(ag.team, ag.lastKnownPos, Math.max(0.25, ag.targetCertainty * 0.7));
    noteTeamIntent(ag.team, 'hunt', ag.lastKnownPos, 0.35);
    return;
  }

  if (board.pressure < 0.2) noteTeamIntent(ag.team, 'hold', board.focusPos, board.pressure);
}
