import * as YUKA from 'yuka';
import { gameState } from '@/core/GameState';
import type { TDMAgent } from '@/entities/TDMAgent';

const NAVMESH_PATH = '/models/navmesh.glb';
const WAYPOINT_REACHED_DIST = 1.25;
const DESTINATION_REACHED_DIST = 2.5;
const DEFAULT_REPATH_INTERVAL = 0.6;

function vecNear(a: YUKA.Vector3, b: YUKA.Vector3, eps = 1.5): boolean {
  return a.distanceTo(b) <= eps;
}

function clonePath(points: YUKA.Vector3[]): YUKA.Vector3[] {
  return points.map((p) => new YUKA.Vector3().copy(p));
}

function fallbackDirectTarget(target: YUKA.Vector3): YUKA.Vector3 {
  return new YUKA.Vector3(target.x, 0, target.z);
}

export async function initNavMesh(): Promise<void> {
  if (gameState.navMeshLoading || gameState.navMeshLoaded) return;

  gameState.navMeshLoading = true;

  try {
    const loader = new YUKA.NavMeshLoader();
    const navMesh = await loader.load(NAVMESH_PATH);
    gameState.navMesh = navMesh;
    gameState.navMeshLoaded = true;
    console.info('[NavMesh] Loaded:', NAVMESH_PATH, 'regions=', navMesh.regions.length);
  } catch (error) {
    console.warn('[NavMesh] Failed to load navmesh. Falling back to legacy steering.', error);
    gameState.navMesh = null;
    gameState.navMeshLoaded = false;
  } finally {
    gameState.navMeshLoading = false;
  }
}

export function clearAgentNavigation(ag: TDMAgent): void {
  ag.navPath.length = 0;
  ag.navWaypointIndex = 0;
  ag.navDestination = null;
  ag.navMode = 'none';
  ag.navRepathTimer = 0;

  if (ag.arriveB) ag.arriveB.weight = 0;
}

export function requestAgentPath(
  ag: TDMAgent,
  destination: YUKA.Vector3,
  mode: 'arrive' | 'seek' = 'arrive',
  tolerance = DESTINATION_REACHED_DIST,
  forceRepath = false,
): void {
  const cleanDestination = fallbackDirectTarget(destination);

  const sameTarget = ag.navDestination && vecNear(ag.navDestination, cleanDestination, 1.25);
  if (!forceRepath && sameTarget && ag.navPath.length > 0) {
    ag.navMode = mode;
    ag.navTolerance = tolerance;
    return;
  }

  ag.navDestination = cleanDestination.clone();
  ag.navMode = mode;
  ag.navTolerance = tolerance;
  ag.navRepathTimer = DEFAULT_REPATH_INTERVAL;

  if (!gameState.navMeshLoaded || !gameState.navMesh) {
    ag.navPath = [cleanDestination.clone()];
    ag.navWaypointIndex = 0;
    return;
  }

  const start = new YUKA.Vector3(ag.position.x, 0, ag.position.z);
  const path = gameState.navMesh.findPath(start, cleanDestination);

  if (path.length >= 2) {
    const usable = clonePath(path.slice(1));
    ag.navPath = usable;
    ag.navWaypointIndex = 0;
    ag.navCurrentRegion = gameState.navMesh.getRegionForPoint(start, 1) || gameState.navMesh.getClosestRegion(start);
  } else if (path.length === 1) {
    ag.navPath = clonePath(path);
    ag.navWaypointIndex = 0;
  } else {
    ag.navPath = [cleanDestination.clone()];
    ag.navWaypointIndex = 0;
  }
}

export function updateAgentNavigation(ag: TDMAgent, dt: number): void {
  if (!ag.navDestination || ag.navMode === 'none') return;

  ag.navRepathTimer -= dt;
  if (
    ag.navRepathTimer <= 0 &&
    gameState.navMeshLoaded &&
    gameState.navMesh &&
    ag.navDestination &&
    ag.stateName !== 'ENGAGE' &&
    ag.stateName !== 'TEAM_PUSH' &&
    ag.stateName !== 'PEEK'
  ) {
    requestAgentPath(ag, ag.navDestination, ag.navMode, ag.navTolerance, true);
  }

  const finalDestination = ag.navDestination;
  if (ag.position.distanceTo(finalDestination) <= ag.navTolerance) {
    clearAgentNavigation(ag);
    return;
  }

  if (ag.navPath.length === 0) {
    ag.navPath.push(finalDestination.clone());
    ag.navWaypointIndex = 0;
  }

  let currentWaypoint = ag.navPath[Math.min(ag.navWaypointIndex, ag.navPath.length - 1)];

  while (currentWaypoint && ag.position.distanceTo(currentWaypoint) <= WAYPOINT_REACHED_DIST) {
    ag.navWaypointIndex += 1;
    if (ag.navWaypointIndex >= ag.navPath.length) {
      currentWaypoint = finalDestination;
      break;
    }
    currentWaypoint = ag.navPath[ag.navWaypointIndex];
  }

  const target = currentWaypoint || finalDestination;

  if (ag.arriveB) {
    ag.arriveB.target.copy(target);
    ag.arriveB.weight = ag.navMode === 'arrive' ? 1.45 : 0.9;
  }

  if (ag.seekB && ag.navMode === 'seek') {
    ag.seekB.target.copy(target);
    ag.seekB.weight = 1.1;
  }
}
