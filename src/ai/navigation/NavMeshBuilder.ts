/**
 * NavMeshBuilder — generates a flat walkable navmesh at runtime from the
 * arena's collision data, then packs it into a binary GLTF blob URL that
 * YUKA's NavMeshLoader can load.
 *
 * This replaces the static arena_navmesh.gltf file, which was baked from
 * arena.glb and no longer matches the procedural arena layout.  Generating
 * the navmesh from gameState.arenaColliders guarantees it is always in sync
 * with the walls, pillars and platforms that actually exist in the scene.
 *
 * Algorithm:
 *   1. Sample a 2D grid over the arena floor at NAV_CELL resolution.
 *   2. Mark each cell blocked if its centre lies inside any arenaCollider.
 *   3. Build a shared-vertex mesh from the walkable cells so adjacent cells
 *      share edge vertices → YUKA treats them as connected regions.
 *   4. Export via GLTFExporter → blob URL → YUKA NavMeshLoader.
 *
 * Winding: (tl, br, tr) + (tl, bl, br) → cross-product normal = (0,+1,0),
 * so all face normals point up, which YUKA's region plane queries expect.
 */

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { gameState } from '@/core/GameState';
import { ARENA_MARGIN } from '@/config/constants';

/** Grid cell size in metres. Larger = fewer regions, faster pathfinding. */
const NAV_CELL = 2.0;

export function buildNavMeshBlob(): Promise<string> {
  const half = ARENA_MARGIN; // ≈ 56.5
  const cols = Math.ceil((2 * half) / NAV_CELL);
  const rows = Math.ceil((2 * half) / NAV_CELL);

  // ── 1. Mark blocked cells ──────────────────────────────────────────
  const blocked = new Uint8Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = -half + (c + 0.5) * NAV_CELL;
      const cz = -half + (r + 0.5) * NAV_CELL;

      for (const col of gameState.arenaColliders) {
        // arenaColliders already include the agent-width padding (0.35–0.45 m)
        // so any cell whose centre is inside them is truly impassable.
        if (col.type === 'box') {
          if (Math.abs(cx - col.x) < col.hw && Math.abs(cz - col.z) < col.hd) {
            blocked[r * cols + c] = 1;
            break;
          }
        } else {
          const dx = cx - col.x;
          const dz = cz - col.z;
          if (dx * dx + dz * dz < col.r * col.r) {
            blocked[r * cols + c] = 1;
            break;
          }
        }
      }
    }
  }

  // ── 2. Build shared-vertex position array ─────────────────────────
  // Using one vertex per grid corner (shared between adjacent cells) so
  // YUKA recognises the shared edges as connected region boundaries.
  const vcols = cols + 1;
  const vrows = rows + 1;
  const verts = new Float32Array(vcols * vrows * 3);

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const vi = (r * vcols + c) * 3;
      verts[vi    ] = -half + c * NAV_CELL;
      verts[vi + 1] = 0;
      verts[vi + 2] = -half + r * NAV_CELL;
    }
  }

  // ── 3. Generate triangle indices (CCW, normal = +Y) ───────────────
  const idxList: number[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (blocked[r * cols + c]) continue;

      const tl = r       * vcols + c;
      const tr = r       * vcols + (c + 1);
      const bl = (r + 1) * vcols + c;
      const br = (r + 1) * vcols + (c + 1);

      // Triangle 1: tl → br → tr  (cross = (0,+1,0)) ✓
      // Triangle 2: tl → bl → br  (cross = (0,+1,0)) ✓
      idxList.push(tl, br, tr,  tl, bl, br);
    }
  }

  console.info(
    `[NavMeshBuilder] grid ${cols}×${rows}, walkable cells: ` +
    `${idxList.length / 6}, triangles: ${idxList.length / 3}`,
  );

  // ── 4. Pack into THREE.BufferGeometry ─────────────────────────────
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));

  const indexArr = idxList.length > 65535
    ? new Uint32Array(idxList)
    : new Uint16Array(idxList);
  geo.setIndex(new THREE.BufferAttribute(indexArr, 1));
  geo.computeVertexNormals();

  // Place inside a minimal scene so GLTFExporter bakes identity transform
  const navScene = new THREE.Scene();
  navScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));

  // ── 5. Export → blob URL ──────────────────────────────────────────
  return new Promise<string>((resolve, reject) => {
    new GLTFExporter().parse(
      navScene,
      (buf) => {
        const url = URL.createObjectURL(
          new Blob([buf as ArrayBuffer], { type: 'model/gltf-binary' }),
        );
        resolve(url);
      },
      reject,
      { binary: true },
    );
  });
}
