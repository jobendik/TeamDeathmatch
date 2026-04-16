/**
 * ObjectPool — pre-allocates Three.js meshes and reuses them.
 * Eliminates per-frame allocations for particles, tracers, impacts, etc.
 *
 * Usage:
 *   const pool = new MeshPool(scene, geometry, material, 200);
 *   const mesh = pool.acquire();  // get a pre-made mesh
 *   pool.release(mesh);           // return it
 */

import * as THREE from 'three';

export class MeshPool {
  private available: THREE.Mesh[] = [];
  private active = new Set<THREE.Mesh>();
  private scene: THREE.Scene;
  private geo: THREE.BufferGeometry;
  private mat: THREE.Material;

  constructor(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, prealloc: number) {
    this.scene = scene;
    this.geo = geo;
    this.mat = mat;
    for (let i = 0; i < prealloc; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.visible = false;
      scene.add(m);
      this.available.push(m);
    }
  }

  acquire(): THREE.Mesh {
    let m = this.available.pop();
    if (!m) {
      m = new THREE.Mesh(this.geo, this.mat.clone());
      this.scene.add(m);
    }
    m.visible = true;
    m.scale.setScalar(1);
    (m.material as THREE.MeshBasicMaterial).opacity = 1;
    this.active.add(m);
    return m;
  }

  release(m: THREE.Mesh): void {
    m.visible = false;
    this.active.delete(m);
    this.available.push(m);
  }

  releaseAll(): void {
    for (const m of this.active) {
      m.visible = false;
      this.available.push(m);
    }
    this.active.clear();
  }

  get activeCount(): number { return this.active.size; }
  get poolSize(): number { return this.available.length + this.active.size; }
}

/**
 * LightPool — same concept for PointLights.
 */
export class LightPool {
  private available: THREE.PointLight[] = [];
  private active = new Set<THREE.PointLight>();
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, prealloc: number, color = 0xffffff, intensity = 1, dist = 6) {
    this.scene = scene;
    for (let i = 0; i < prealloc; i++) {
      const l = new THREE.PointLight(color, 0, dist);
      l.visible = false;
      scene.add(l);
      this.available.push(l);
    }
  }

  acquire(color: number, intensity: number, dist: number): THREE.PointLight {
    let l = this.available.pop();
    if (!l) {
      l = new THREE.PointLight(color, intensity, dist);
      this.scene.add(l);
    } else {
      l.color.setHex(color);
      l.intensity = intensity;
      l.distance = dist;
      l.visible = true;
    }
    this.active.add(l);
    return l;
  }

  release(l: THREE.PointLight): void {
    l.visible = false;
    l.intensity = 0;
    this.active.delete(l);
    this.available.push(l);
  }

  releaseAll(): void {
    for (const l of this.active) { l.visible = false; l.intensity = 0; this.available.push(l); }
    this.active.clear();
  }
}
