import * as THREE from 'three';
import * as YUKA from 'yuka';
import { gameState } from '@/core/GameState';

const NAVMESH_PATH = `${import.meta.env.BASE_URL}models/navmesh.glb`;

class NavMeshService {
  private navMesh: YUKA.NavMesh | null = null;
  private helper: THREE.Object3D | null = null;
  private loadingPromise: Promise<YUKA.NavMesh | null> | null = null;

  async load(): Promise<YUKA.NavMesh | null> {
    if (this.navMesh) return this.navMesh;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      try {
        const loader = new YUKA.NavMeshLoader();
        const navMesh = await loader.load(NAVMESH_PATH);
        this.navMesh = navMesh;
        gameState.navMesh = navMesh;
        console.info('[NavMeshService] NavMesh loaded:', NAVMESH_PATH);
        return navMesh;
      } catch (err) {
        console.error('[NavMeshService] Failed to load navmesh:', err);
        this.navMesh = null;
        gameState.navMesh = null;
        return null;
      }
    })();

    return this.loadingPromise;
  }

  getNavMesh(): YUKA.NavMesh | null {
    return this.navMesh;
  }

  hasNavMesh(): boolean {
    return !!this.navMesh;
  }

  clearDebugHelper(): void {
    if (this.helper) {
      gameState.scene.remove(this.helper);
      this.helper = null;
    }
  }

  createDebugHelper(): THREE.Object3D | null {
    if (!this.navMesh) return null;

    this.clearDebugHelper();

    const helper = createNavMeshHelper(this.navMesh);
    helper.visible = false;
    this.helper = helper;
    gameState.scene.add(helper);

    return helper;
  }

  setDebugVisible(visible: boolean): void {
    if (this.helper) {
      this.helper.visible = visible;
    }
  }

  findPath(from: YUKA.Vector3, to: YUKA.Vector3): YUKA.Vector3[] {
    if (!this.navMesh) return [to.clone()];
    try {
      return this.navMesh.findPath(from, to) ?? [to.clone()];
    } catch (err) {
      console.warn('[NavMeshService] findPath failed, falling back to direct target.', err);
      return [to.clone()];
    }
  }

  clampPoint(point: YUKA.Vector3): YUKA.Vector3 {
    if (!this.navMesh) return point.clone();

    try {
      const region = this.navMesh.getRegionForPoint(point, 1);
      if (!region) return point.clone();

      const closest = new YUKA.Vector3();
      region.getClosestPointToPoint(point, closest);
      return closest;
    } catch {
      return point.clone();
    }
  }

  getRandomPoint(): YUKA.Vector3 | null {
    if (!this.navMesh) return null;

    try {
      const regionCount = this.navMesh.regions.length;
      if (regionCount === 0) return null;

      const region = this.navMesh.regions[Math.floor(Math.random() * regionCount)];
      if (!region || region.polygon.centroid === undefined) return null;

      return region.centroid.clone();
    } catch {
      return null;
    }
  }
}

function createNavMeshHelper(navMesh: YUKA.NavMesh): THREE.Object3D {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({ color: 0x00ffff });

  for (const region of navMesh.regions) {
    const vertices = region.edge?.polygon?.vertices ?? region.polygon?.vertices ?? [];
    if (!vertices.length) continue;

    const points: THREE.Vector3[] = [];
    for (const v of vertices) {
      points.push(new THREE.Vector3(v.x, v.y + 0.05, v.z));
    }
    points.push(new THREE.Vector3(vertices[0].x, vertices[0].y + 0.05, vertices[0].z));

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    group.add(line);
  }

  return group;
}

export const navMeshService = new NavMeshService();
