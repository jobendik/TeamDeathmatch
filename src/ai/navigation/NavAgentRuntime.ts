import * as YUKA from 'yuka';
import { NAV_CONFIG } from './NavConfig';
import type { NavMeshManager } from './NavMeshManager';

export class NavAgentRuntime {
  owner: YUKA.Vehicle;
  navManager: NavMeshManager;

  currentRegion: any = null;
  currentPosition = new YUKA.Vector3();
  previousPosition = new YUKA.Vector3();
  path: YUKA.Vector3[] | null = null;
  pathPending: boolean = false;

  followPathBehavior: YUKA.FollowPathBehavior;
  onPathBehavior: YUKA.OnPathBehavior;

  constructor(owner: YUKA.Vehicle, navManager: NavMeshManager) {
    this.owner = owner;
    this.navManager = navManager;

    this.followPathBehavior = new YUKA.FollowPathBehavior();
    this.followPathBehavior.active = false;
    this.followPathBehavior.nextWaypointDistance = NAV_CONFIG.NEXT_WAYPOINT_DISTANCE;

    // Showcase-style external arrive tuning hack on internal YUKA private var:
    (this.followPathBehavior as any)._arrive.deceleration = NAV_CONFIG.ARRIVE_DECELERATION;

    this.onPathBehavior = new YUKA.OnPathBehavior();
    this.onPathBehavior.active = false;
    this.onPathBehavior.path = this.followPathBehavior.path;
    this.onPathBehavior.radius = NAV_CONFIG.PATH_RADIUS;
    this.onPathBehavior.weight = NAV_CONFIG.ON_PATH_WEIGHT;

    // We add these directly. Seek, arrive etc are still used for short-range combat!
    this.owner.steering.add(this.followPathBehavior);
    this.owner.steering.add(this.onPathBehavior);
  }

  initFromSpawn(spawnPosition: YUKA.Vector3): void {
    this.owner.position.copy(spawnPosition);
    this.previousPosition.copy(this.owner.position);
    this.currentPosition.copy(this.owner.position);

    if (this.navManager.navMesh) {
      this.currentRegion = this.navManager.getRegionForPoint(
        this.owner.position,
        NAV_CONFIG.REGION_EPSILON
      );

      // Progressively widen the search if the spawn point is slightly off the mesh.
      if (!this.currentRegion) {
        this.currentRegion = this.navManager.getRegionForPoint(this.owner.position, 3);
      }
      if (!this.currentRegion) {
        console.warn(`[NavAgentRuntime] Entity spawned off-navmesh at ${spawnPosition.x.toFixed(2)}, ${spawnPosition.y.toFixed(2)}, ${spawnPosition.z.toFixed(2)}`);
      }
    }
  }

  applyPath(path: YUKA.Vector3[]): boolean {
    this.pathPending = false;
    if (!path || path.length === 0) return false;

    this.path = path;
    this.followPathBehavior.path.clear();

    for (const waypoint of path) {
      this.followPathBehavior.path.add(waypoint);
    }

    this.followPathBehavior.active = true;
    this.onPathBehavior.active = true;

    // Temporarily disable wander when following a path
    const wanderB = this.owner.steering.behaviors.find(b => b instanceof YUKA.WanderBehavior);
    if (wanderB) wanderB.weight = 0;

    return true;
  }

  clearPath(): void {
    this.pathPending = false;
    this.path = null;
    this.followPathBehavior.active = false;
    this.onPathBehavior.active = false;
    this.followPathBehavior.path.clear();
  }

  atPosition(target: YUKA.Vector3): boolean {
    const toleranceSq =
      NAV_CONFIG.ARRIVE_TOLERANCE * NAV_CONFIG.ARRIVE_TOLERANCE;
    return this.owner.position.squaredDistanceTo(target) <= toleranceSq;
  }

  stayOnNavMesh(): void {
    if (!this.navManager.navMesh) return;

    this.currentPosition.copy(this.owner.position);

    this.currentRegion = this.navManager.clampMovement(
      this.currentRegion,
      this.previousPosition,
      this.currentPosition,
      this.owner.position
    );

    if (!this.currentRegion) {
      // Entity fell off the navmesh — try to snap back to the nearest region.
      this.currentRegion = this.navManager.getRegionForPoint(this.owner.position, 3);
      if (this.currentRegion) {
        // Reset previousPosition so the next clamp starts from a valid location.
        this.previousPosition.copy(this.owner.position);
      }
      return;
    }

    this.previousPosition.copy(this.owner.position);

    const distance = (this.currentRegion as any).plane.distanceToPoint(this.owner.position);
    this.owner.position.y -= distance * NAV_CONFIG.HEIGHT_CHANGE_FACTOR;
  }

  update(): void {
    this.stayOnNavMesh();

    if (this.path && this.path.length > 0) {
      const last = this.path[this.path.length - 1];
      if (this.atPosition(last)) {
        this.clearPath();
      }
    }
  }
}
