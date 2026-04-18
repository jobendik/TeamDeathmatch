import * as THREE from 'three';
import type { TDMAgent } from '@/entities/TDMAgent';
import { TEAM_BLUE, TEAM_RED, type TeamId, BLUE_SPAWNS, RED_SPAWNS, ARENA_MARGIN } from '@/config/constants';
import { BR_MAP_MARGIN } from '@/br/BRConfig';
import { gameState } from './GameState';

export type GameMode = 'tdm' | 'ffa' | 'ctf' | 'elimination' | 'br';

/** True when the current mode has no team allegiance (FFA, BR). */
export function isFreeForAll(): boolean {
  return gameState.mode === 'ffa' || gameState.mode === 'br';
}

/** Returns the world boundary margin for the current mode. */
export function getWorldBoundary(): number {
  return gameState.mode === 'br' ? BR_MAP_MARGIN : ARENA_MARGIN;
}

export function getModeLabel(mode: GameMode = gameState.mode): string {
  switch (mode) {
    case 'ffa': return 'FFA';
    case 'ctf': return 'CTF';
    case 'elimination': return 'ELIM';
    case 'br': return 'BR';
    default: return 'TDM';
  }
}

export function isEnemy(a: TDMAgent, b: TDMAgent): boolean {
  if (a === b) return false;
  if (a.isDead || b.isDead) return false;
  if (isFreeForAll()) return true;
  return a.team !== b.team;
}

export function getSpawnPoints(team: TeamId): [number, number, number][] {
  if (gameState.mode === 'ffa') {
    return [...BLUE_SPAWNS, ...RED_SPAWNS];
  }
  return team === TEAM_BLUE ? BLUE_SPAWNS : RED_SPAWNS;
}

export function getSpawnForAgent(ag: TDMAgent): [number, number, number] {
  const spawns = getSpawnPoints(ag.team);
  return pickSafestSpawn(spawns, ag);
}

export function getPlayerSpawn(): [number, number, number] {
  const spawns = gameState.mode === 'ffa' ? [...BLUE_SPAWNS, ...RED_SPAWNS] : BLUE_SPAWNS;
  return pickSafestSpawn(spawns, gameState.player);
}

/** Score spawns by distance from enemies — pick the safest one with some randomness. */
function pickSafestSpawn(spawns: [number, number, number][], self: TDMAgent): [number, number, number] {
  if (spawns.length === 0) return [0, 0, 0];
  if (spawns.length === 1) return spawns[0];
  const scored = spawns.map(sp => {
    let minDist = Infinity;
    for (const ag of gameState.agents) {
      if (ag === self || ag.isDead || !ag.active) continue;
      if (!isFreeForAll() && ag.team === self.team) continue;
      const dx = ag.position.x - sp[0];
      const dz = ag.position.z - sp[2];
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < minDist) minDist = d;
    }
    return { sp, score: minDist };
  });
  // Sort by distance (farthest from enemies = safest) and pick from top 3 with randomness
  scored.sort((a, b) => b.score - a.score);
  const topN = Math.min(3, scored.length);
  return scored[Math.floor(Math.random() * topN)].sp;
}

export function getFacingYawTowardsArena(x: number, z: number): number {
  const dx = 0 - x;
  const dz = 0 - z;
  return Math.atan2(-dx, -dz);
}

export function getFlagBasePosition(team: TeamId): THREE.Vector3 {
  return team === TEAM_BLUE ? new THREE.Vector3(-48, 0, -48) : new THREE.Vector3(48, 0, 48);
}

export function getEnemyFlagTeam(team: TeamId): TeamId {
  return team === TEAM_BLUE ? TEAM_RED : TEAM_BLUE;
}

/** Whether respawning is allowed in the current mode */
export function allowsRespawn(): boolean {
  return gameState.mode !== 'elimination' && gameState.mode !== 'br';
}

export function getModeDefaults(mode: GameMode = gameState.mode): { matchTime: number; scoreLimit: number; playerStartsArmed: boolean } {
  switch (mode) {
    case 'ffa':
      return { matchTime: 360, scoreLimit: 15, playerStartsArmed: false };
    case 'ctf':
      return { matchTime: 420, scoreLimit: 3, playerStartsArmed: true };
    case 'elimination':
      return { matchTime: 180, scoreLimit: 3, playerStartsArmed: true };
    case 'br':
      return { matchTime: 900, scoreLimit: 1, playerStartsArmed: false };
    default:
      return { matchTime: 300, scoreLimit: 20, playerStartsArmed: true };
  }
}
