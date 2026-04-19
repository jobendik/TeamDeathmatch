import * as YUKA from 'yuka';

export class NavMeshManager {
  navMesh: YUKA.NavMesh | null = null;

  async load(url: string): Promise<YUKA.NavMesh> {
    this.navMesh = await new YUKA.NavMeshLoader().load(url, {
      epsilonCoplanarTest: 0.25,
      mergeConvexRegions: false // Ensures correct YUKA behavior across small height diffs
    });

    console.log(`[NavMeshManager] Successfully loaded navmesh from ${url} with ${this.navMesh.regions.length} regions.`);
    return this.navMesh;
  }

  requireNavMesh(): YUKA.NavMesh {
    if (!this.navMesh) {
      throw new Error('NavMeshManager: navMesh not loaded');
    }
    return this.navMesh;
  }

  private getClosestRegion(point: YUKA.Vector3): any {
    const navMesh = this.requireNavMesh() as any;
    if (typeof navMesh.getClosestRegion === 'function') {
      return navMesh.getClosestRegion(point);
    }

    let bestRegion: any = null;
    let bestDistanceSq = Number.POSITIVE_INFINITY;

    for (const region of navMesh.regions ?? []) {
      const centroid = region?.centroid;
      if (!centroid) continue;

      const distanceSq = centroid.squaredDistanceTo(point);
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestRegion = region;
      }
    }

    return bestRegion;
  }

  getRegionForPoint(point: YUKA.Vector3, epsilon = 1): any {
    return this.requireNavMesh().getRegionForPoint(point, epsilon);
  }

  projectPoint(point: YUKA.Vector3, epsilon = 1): YUKA.Vector3 {
    const region = this.getRegionForPoint(point, epsilon) ?? this.getClosestRegion(point);
    if (!region?.getClosestPointToPoint) {
      return point.clone();
    }

    const projectedPoint = new YUKA.Vector3();
    region.getClosestPointToPoint(point, projectedPoint);
    return projectedPoint;
  }

  findPath(from: YUKA.Vector3, to: YUKA.Vector3): YUKA.Vector3[] {
    const safeFrom = this.projectPoint(from);
    const safeTo = this.projectPoint(to);
    return this.requireNavMesh().findPath(safeFrom, safeTo);
  }

  clampMovement(
    currentRegion: any,
    previousPosition: YUKA.Vector3,
    currentPosition: YUKA.Vector3,
    resultPosition: YUKA.Vector3
  ): any {
    return this.requireNavMesh().clampMovement(
      currentRegion,
      previousPosition,
      currentPosition,
      resultPosition
    );
  }
}
