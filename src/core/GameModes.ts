import * as THREE from 'three';
import * as YUKA from 'yuka';
import type { TDMAgent } from '@/entities/TDMAgent';
import { TEAM_BLUE, TEAM_RED, type TeamId, BLUE_SPAWNS, RED_SPAWNS, ARENA_MARGIN } from '@/config/constants';
import { BR_MAP_MARGIN } from '@/br/BRConfig';
import { gameState } from './GameState';

const SPAWN_SAMPLE_Y = 1.25;
const SPAWN_RAY_FAR = 6;
const SPAWN_NEAR_WALL = 2.8;
const SPAWN_LERP_STEPS = [0, 0.12, 0.24, 0.36, 0.48, 0.6] as const;
const spawnProbe = new YUKA.Vector3();
const spawnProjected = new THREE.Vector3();
const spawnRay = new THREE.Raycaster();
const spawnDirs = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(1, 0, 1).normalize(),
  new THREE.Vector3(-1, 0, 1).normalize(),
  new THREE.Vector3(1, 0, -1).normalize(),
  new THREE.Vector3(-1, 0, -1).normalize(),
];

let cachedMainIslandNavMesh: any = null;
let cachedMainIslandRegions: Set<any> | null = null;

export type GameMode = 'tdm' | 'ffa' | 'ctf' | 'elimination' | 'br'
  | 'domination' | 'hardpoint' | 'koth' | 'sd' | 'training';

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
    case 'domination': return 'DOM';
    case 'hardpoint': return 'HP';
    case 'koth': return 'KOTH';
    case 'sd': return 'S&D';
    case 'training': return 'TRAINING';
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

export function resolveArenaSpawn(spawn: [number, number, number], team?: TeamId): [number, number, number] {
  if (!gameState.navMeshManager.navMesh) return spawn;

  const mainIsland = getMainIslandRegions();
  let bestSpawn = spawn;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const t of SPAWN_LERP_STEPS) {
    const sampleX = THREE.MathUtils.lerp(spawn[0], 0, t);
    const sampleZ = THREE.MathUtils.lerp(spawn[2], 0, t);
    const projected = projectSpawn(sampleX, sampleZ);
    if (!projected) continue;

    let score = scoreSpawnOpenness(projected[0], projected[2]);

    if (projected[3] && mainIsland?.has(projected[3])) score += 60;
    else score -= 120;

    const inwardDist = Math.hypot(projected[0] - spawn[0], projected[2] - spawn[2]);
    score -= inwardDist * 0.7;

    if (team === TEAM_BLUE) score -= (projected[0] + projected[2]) * 0.08;
    else if (team === TEAM_RED) score += (projected[0] + projected[2]) * 0.08;

    if (score > bestScore) {
      bestScore = score;
      bestSpawn = [projected[0], spawn[1], projected[2]];
    }
  }

  return bestSpawn;
}

/** Score spawns by distance from enemies — pick the safest one with some randomness. */
function pickSafestSpawn(spawns: [number, number, number][], self: TDMAgent): [number, number, number] {
  if (spawns.length === 0) return [0, 0, 0];
  if (spawns.length === 1) return resolveArenaSpawn(spawns[0], self.team);

  const resolvedSpawns = spawns.map((sp) => resolveArenaSpawn(sp, self.team));
  const scored = resolvedSpawns.map(sp => {
    let minDist = Infinity;
    for (const ag of gameState.agents) {
      if (ag === self || ag.isDead || !ag.active) continue;
      if (!isFreeForAll() && ag.team === self.team) continue;
      const dx = ag.position.x - sp[0];
      const dz = ag.position.z - sp[2];
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < minDist) minDist = d;
    }
    const openness = scoreSpawnOpenness(sp[0], sp[2]);
    return { sp, score: minDist + openness * 0.35 };
  });
  // Sort by distance (farthest from enemies = safest) and pick from top 3 with randomness
  scored.sort((a, b) => b.score - a.score);
  const topN = Math.min(3, scored.length);
  return scored[Math.floor(Math.random() * topN)].sp;
}

function projectSpawn(x: number, z: number): [number, number, number, any] | null {
  spawnProbe.set(x, SPAWN_SAMPLE_Y, z);
  const projected = gameState.navMeshManager.projectPoint(spawnProbe, 1);
  const region = gameState.navMeshManager.getRegionForPoint(projected, 1)
    ?? gameState.navMeshManager.getRegionForPoint(projected, 3);

  if (!Number.isFinite(projected.x) || !Number.isFinite(projected.z)) {
    return null;
  }

  return [projected.x, projected.y, projected.z, region];
}

function scoreSpawnOpenness(x: number, z: number): number {
  if (gameState.wallMeshes.length === 0) return 0;

  spawnProjected.set(x, SPAWN_SAMPLE_Y, z);
  let score = 0;

  for (const dir of spawnDirs) {
    spawnRay.set(spawnProjected, dir);
    spawnRay.near = 0;
    spawnRay.far = SPAWN_RAY_FAR;
    const hit = spawnRay.intersectObjects(gameState.wallMeshes, false)[0];
    if (!hit) {
      score += 6;
      continue;
    }

    if (hit.distance < SPAWN_NEAR_WALL) {
      score -= (SPAWN_NEAR_WALL - hit.distance) * 18;
    } else {
      score += Math.min(4, hit.distance - SPAWN_NEAR_WALL);
    }
  }

  const toCenter = new THREE.Vector3(-x, 0, -z);
  if (toCenter.lengthSq() > 0.001) {
    toCenter.normalize();
    spawnRay.set(spawnProjected, toCenter);
    spawnRay.near = 0;
    spawnRay.far = SPAWN_RAY_FAR;
    const hit = spawnRay.intersectObjects(gameState.wallMeshes, false)[0];
    if (hit && hit.distance < SPAWN_NEAR_WALL + 0.5) {
      score -= 30;
    }
  }

  return score;
}

function getMainIslandRegions(): Set<any> | null {
  const navMesh = gameState.navMeshManager.navMesh;
  if (!navMesh) return null;
  if (cachedMainIslandNavMesh === navMesh && cachedMainIslandRegions) {
    return cachedMainIslandRegions;
  }

  const regions = navMesh.regions ?? [];
  const index = new Map<any, number>();
  regions.forEach((region, idx) => index.set(region, idx));
  const adjacency: number[][] = regions.map(() => []);

  for (let idx = 0; idx < regions.length; idx++) {
    let edge = regions[idx]?.edge;
    let guard = 0;
    while (edge) {
      const twinRegion = edge?.twin?.polygon ?? edge?.twin?.face ?? edge?.twin?.region ?? null;
      if (twinRegion && index.has(twinRegion)) {
        adjacency[idx].push(index.get(twinRegion)!);
      }
      edge = edge.next;
      if (edge === regions[idx].edge) break;
      if (++guard > 2000) break;
    }
  }

  const visited = new Uint8Array(regions.length);
  let largest: number[] = [];
  for (let idx = 0; idx < regions.length; idx++) {
    if (visited[idx]) continue;
    const stack = [idx];
    const component: number[] = [];
    visited[idx] = 1;
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of adjacency[current]) {
        if (!visited[next]) {
          visited[next] = 1;
          stack.push(next);
        }
      }
    }
    if (component.length > largest.length) largest = component;
  }

  cachedMainIslandNavMesh = navMesh;
  cachedMainIslandRegions = new Set(largest.map((idx) => regions[idx]));
  return cachedMainIslandRegions;
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
  return gameState.mode !== 'elimination' && gameState.mode !== 'br' && gameState.mode !== 'sd';
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
    case 'domination':
      return { matchTime: 600, scoreLimit: 200, playerStartsArmed: true };
    case 'hardpoint':
      return { matchTime: 600, scoreLimit: 250, playerStartsArmed: true };
    case 'koth':
      return { matchTime: 600, scoreLimit: 250, playerStartsArmed: true };
    case 'sd':
      return { matchTime: 150, scoreLimit: 4, playerStartsArmed: true };
    case 'training':
      return { matchTime: 0, scoreLimit: 0, playerStartsArmed: true };
    default:
      return { matchTime: 300, scoreLimit: 20, playerStartsArmed: true };
  }
}
