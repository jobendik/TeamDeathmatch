import * as YUKA from 'yuka';
import { NAV_CONFIG } from './NavConfig';
import type { NavMeshManager } from './NavMeshManager';

const REGION_SEARCH_RADII = [NAV_CONFIG.REGION_EPSILON, 3, 6, 10] as const;

export class NavAgentRuntime {
  owner: YUKA.Vehicle;
  navManager: NavMeshManager;

  currentRegion: any = null;
  currentPosition = new YUKA.Vector3();
  previousPosition = new YUKA.Vector3();
  path: YUKA.Vector3[] | null = null;
  pathPending: boolean = false;
  missingRegionLogged: boolean = false;

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
    this.clearPath();
    this.owner.position.copy(spawnPosition);
    this.previousPosition.copy(this.owner.position);
    this.currentPosition.copy(this.owner.position);
    this.missingRegionLogged = false;

    if (!this.navManager.navMesh) return;

    // Try to find the region the spawn is in. If the spawn is off-mesh
    // (e.g. inside a hole or outside the baked mesh), resolveRegion will
    // horizontally project to the nearest region and snap the agent onto it.
    // This guarantees we never enter the frame loop with currentRegion=null.
    if (!this.recoverRegion('spawn')) {
      console.warn(
        `[NavAgentRuntime] Spawn ${this.owner.position.x.toFixed(1)},${this.owner.position.z.toFixed(1)} has no reachable navmesh region at all — bot will stand still.`
      );
    }
  }

  /**
   * Find the region the agent is "on". YUKA's `getRegionForPoint(pt, epsilon)`
   * ONLY uses `epsilon` as a vertical (Y) tolerance — it is NOT a horizontal
   * search radius. So we first try an in-plane containment check with a generous
   * vertical tolerance, and if that fails we fall back to NavMeshManager's
   * global `getClosestRegion` / `projectPoint` which really does a horizontal
   * nearest-point search across all regions.
   */
  private resolveRegion(): { region: any; snapped: YUKA.Vector3 | null } {
    const navMesh = this.navManager.navMesh as any;
    if (!navMesh) return { region: null, snapped: null };

    const mainComponent = this.navManager.mainComponent;
    const isInMain = (region: any) =>
      region != null && (mainComponent.size === 0 || mainComponent.has(region));

    // In-polygon (fast path) — try several Y tolerances for tall meshes,
    // but reject regions that are on isolated baked islands (tops of
    // walls/pillars): those are non-walkable stranded polygons.
    for (const yTol of REGION_SEARCH_RADII) {
      const region = navMesh.getRegionForPoint(this.owner.position, yTol);
      if (region && isInMain(region)) return { region, snapped: null };
    }

    // Horizontal nearest-region fallback on the MAIN component only.
    const projected = this.navManager.projectPoint(this.owner.position);
    let region = navMesh.getRegionForPoint(projected, 1);
    if (!isInMain(region)) {
      region = this.navManager.getClosestMainComponentRegion(projected);
    }

    return { region, snapped: region ? projected : null };
  }

  private snapToRegion(region: any, snapped?: YUKA.Vector3 | null): void {
    if (!region?.getClosestPointToPoint) return;

    const closestPoint = snapped ?? new YUKA.Vector3();
    if (!snapped) {
      region.getClosestPointToPoint(this.owner.position, closestPoint);
    }
    this.owner.position.copy(closestPoint);
    this.currentPosition.copy(closestPoint);
    this.previousPosition.copy(closestPoint);
  }

  private recoverRegion(reason: string): boolean {
    if (!this.navManager.navMesh) return false;

    const { region, snapped } = this.resolveRegion();
    if (!region) {
      if (!this.missingRegionLogged) {
        console.warn(
          `[NavAgentRuntime] No navmesh region for ${reason} at ${this.owner.position.x.toFixed(2)}, ${this.owner.position.y.toFixed(2)}, ${this.owner.position.z.toFixed(2)}`
        );
        this.missingRegionLogged = true;
      }
      return false;
    }

    this.currentRegion = region;
    this.snapToRegion(region, snapped);
    this.missingRegionLogged = false;
    return true;
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

  /**
   * Run YUKA.NavMesh.clampMovement but NEVER let it propagate —
   * any exception is treated as "region geometry corrupted for this step":
   * we simply drop the current region and rely on the next frame's
   * recoverRegion() to snap us back on.
   */
  private safeClamp(): any {
    try {
      return this.navManager.clampMovement(
        this.currentRegion,
        this.previousPosition,
        this.currentPosition,
        this.owner.position
      );
    } catch (err) {
      console.warn('[NavAgentRuntime] clampMovement threw — forcing region recovery.', err);
      return null;
    }
  }

  stayOnNavMesh(): void {
    if (!this.navManager.navMesh) return;

    if (!this.currentRegion && !this.recoverRegion('movement clamp')) {
      // Still off-mesh. Keep previousPosition in sync with current so the
      // next successful region-recovery starts from a sane baseline.
      this.previousPosition.copy(this.owner.position);
      return;
    }

    this.currentPosition.copy(this.owner.position);

    let clamped = this.safeClamp();

    // If the clamp failed or dropped the region (agent left the mesh), try
    // once to recover and re-clamp with the rediscovered region.
    if (!clamped) {
      if (!this.recoverRegion('post-clamp recovery')) {
        this.currentRegion = null;
        this.previousPosition.copy(this.owner.position);
        return;
      }
      this.currentPosition.copy(this.owner.position);
      clamped = this.safeClamp();
      if (!clamped) {
        this.currentRegion = null;
        this.previousPosition.copy(this.owner.position);
        return;
      }
    }

    this.currentRegion = clamped;
    this.previousPosition.copy(this.owner.position);

    // Height-plane correction
    const plane = (this.currentRegion as any)?.plane;
    if (plane) {
      const distance = plane.distanceToPoint(this.owner.position);
      this.owner.position.y -= distance * NAV_CONFIG.HEIGHT_CHANGE_FACTOR;
    }
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
