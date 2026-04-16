import * as THREE from 'three';
import type { TDMAgent } from '@/entities/TDMAgent';
import { TEAM_BLUE, TEAM_RED, type TeamId, BLUE_SPAWNS, RED_SPAWNS } from '@/config/constants';
import { gameState } from './GameState';

export type GameMode = 'tdm' | 'ffa' | 'ctf' | 'elimination' | 'br';

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
  if (gameState.mode === 'ffa' || gameState.mode === 'br') return true;
  if (gameState.mode === 'elimination') {
    return a.team !== b.team;
  }
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
  return spawns[Math.floor(Math.random() * spawns.length)];
}

export function getPlayerSpawn(): [number, number, number] {
  const spawns = gameState.mode === 'ffa' ? [...BLUE_SPAWNS, ...RED_SPAWNS] : BLUE_SPAWNS;
  return spawns[0];
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
