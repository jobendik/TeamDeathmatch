import * as YUKA from 'yuka';

export class NavMeshManager {
  navMesh: YUKA.NavMesh | null = null;

  /** Set of region objects that belong to the largest connected component. */
  mainComponent: Set<any> = new Set();
  /** Region -> component-index map (0 = main / largest). */
  regionToComponent: Map<any, number> = new Map();
  /** All components sorted largest first. */
  components: any[][] = [];

  async load(url: string): Promise<YUKA.NavMesh> {
    this.navMesh = await new YUKA.NavMeshLoader().load(url, {
      epsilonCoplanarTest: 0.25,
      mergeConvexRegions: false // Ensures correct YUKA behavior across small height diffs
    });

    this.computeComponents();

    console.log(
      `[NavMeshManager] Successfully loaded navmesh from ${url} with ` +
      `${this.navMesh.regions.length} regions, ` +
      `${this.components.length} component(s), ` +
      `main component = ${this.mainComponent.size} regions.`
    );
    return this.navMesh;
  }

  /**
   * Walk the navmesh half-edge structure to find connected components of
   * regions. The largest component is treated as the primary walkable area;
   * smaller ones (isolated ledges, tops of walls, stranded platforms baked
   * into arena_navmesh.gltf) are ignored for spawning and pathfinding.
   */
  private computeComponents(): void {
    this.components = [];
    this.mainComponent = new Set();
    this.regionToComponent = new Map();
    if (!this.navMesh) return;

    const regions = this.navMesh.regions;
    const idx = new Map<any, number>();
    regions.forEach((r, i) => idx.set(r, i));

    const adj: number[][] = regions.map(() => []);
    for (let i = 0; i < regions.length; i++) {
      let e: any = (regions[i] as any).edge;
      let guard = 0;
      do {
        const twin = e?.twin;
        const nr = twin?.polygon ?? twin?.face ?? twin?.region ?? null;
        if (nr && idx.has(nr)) {
          const j = idx.get(nr)!;
          if (j !== i) adj[i].push(j);
        }
        e = e?.next;
        if (++guard > 2000) break;
      } while (e && e !== (regions[i] as any).edge);
    }

    const visited = new Uint8Array(regions.length);
    const comps: number[][] = [];
    for (let i = 0; i < regions.length; i++) {
      if (visited[i]) continue;
      const c: number[] = [];
      const stack = [i];
      visited[i] = 1;
      while (stack.length) {
        const n = stack.pop()!;
        c.push(n);
        for (const m of adj[n]) if (!visited[m]) { visited[m] = 1; stack.push(m); }
      }
      comps.push(c);
    }
    comps.sort((a, b) => b.length - a.length);

    this.components = comps.map((c) => c.map((i) => regions[i]));
    for (let ci = 0; ci < this.components.length; ci++) {
      for (const r of this.components[ci]) this.regionToComponent.set(r, ci);
    }
    if (this.components.length) {
      for (const r of this.components[0]) this.mainComponent.add(r);
    }
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

  /**
   * Find the closest region BELONGING TO THE MAIN COMPONENT. This is what
   * the YUKA showcase lab does — spawns and targets that land on isolated
   * islands (tops of walls, stranded platforms) are snapped back to the
   * walkable floor before use.
   */
  getClosestMainComponentRegion(point: YUKA.Vector3): any {
    if (this.mainComponent.size === 0) return this.getClosestRegion(point);

    let best: any = null;
    let bestDistSq = Number.POSITIVE_INFINITY;
    const tmp = new YUKA.Vector3();
    for (const region of this.mainComponent) {
      const centroid = (region as any)?.centroid;
      if (!centroid) continue;
      const approxSq = centroid.squaredDistanceTo(point);
      if (approxSq >= bestDistSq) continue;
      // Cheap centroid pruning; then take the true closest-point distance for a
      // better tie-break near borders
      if (typeof region.getClosestPointToPoint === 'function') {
        region.getClosestPointToPoint(point, tmp);
        const d = tmp.squaredDistanceTo(point);
        if (d < bestDistSq) {
          bestDistSq = d;
          best = region;
        }
      } else if (approxSq < bestDistSq) {
        bestDistSq = approxSq;
        best = region;
      }
    }
    return best;
  }

  getRegionForPoint(point: YUKA.Vector3, epsilon = 1): any {
    return this.requireNavMesh().getRegionForPoint(point, epsilon);
  }

  /**
   * Project a point onto the navmesh. If the containing region is NOT in
   * the main component (e.g. the caller passed in a position that has
   * landed on the top of a wall from a stale bake), snap to the nearest
   * main-component region instead.
   */
  projectPoint(point: YUKA.Vector3, epsilon = 1): YUKA.Vector3 {
    let region = this.getRegionForPoint(point, epsilon);
    // Reject regions outside the main component — they are isolated baked
    // geometry and cannot be pathed to/from.
    if (region && this.mainComponent.size > 0 && !this.mainComponent.has(region)) {
      region = null;
    }
    if (!region) {
      region = this.getClosestMainComponentRegion(point) ?? this.getClosestRegion(point);
    }
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
