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

  getRegionForPoint(point: YUKA.Vector3, epsilon = 1): any {
    return this.requireNavMesh().getRegionForPoint(point, epsilon);
  }

  findPath(from: YUKA.Vector3, to: YUKA.Vector3): YUKA.Vector3[] {
    return this.requireNavMesh().findPath(from, to);
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
