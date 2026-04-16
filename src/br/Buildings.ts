/**
 * Buildings — Fortnite-style procedural buildings with MERGED geometry.
 *
 * Performance: each building = 2 draw calls (walls + accents) instead of 30+.
 * Uses BufferGeometryUtils.mergeGeometries to batch all wall panels, all
 * floors, all accent pieces into single meshes.
 *
 * Visual: bright Fortnite palette, colored roofs, visible windows, proportioned.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BUILDING_PALETTES } from './BRConfig';

export interface WallCollider {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export interface Building {
  cx: number;
  cz: number;
  width: number;
  depth: number;
  floors: number;
  mesh: THREE.Group;
  lootSpots: THREE.Vector3[];
  /** Pre-computed bounding for collision. */
  hw: number;
  hd: number;
  /** World-space door entry points (just outside the doorway). */
  doorPositions: { x: number; z: number }[];
  /** Per-wall colliders with gaps for doorways. */
  wallColliders: WallCollider[];
}

const FLOOR_H = 3.2;
const WALL_T = 0.3;
const _box = new THREE.BoxGeometry(1, 1, 1);

/**
 * Build one building. All geometry is merged into 2-3 meshes total.
 */
export function createBuilding(
  cx: number, cz: number,
  width: number, depth: number,
  floors: number,
): Building {
  const palette = BUILDING_PALETTES[Math.floor(Math.random() * BUILDING_PALETTES.length)];
  const group = new THREE.Group();
  group.name = `Bldg_${cx|0}_${cz|0}`;

  const wallGeos: THREE.BufferGeometry[] = [];
  const accentGeos: THREE.BufferGeometry[] = [];
  const roofGeos: THREE.BufferGeometry[] = [];
  const lootSpots: THREE.Vector3[] = [];

  const totalH = floors * FLOOR_H;
  const hw = width / 2;
  const hd = depth / 2;

  for (let f = 0; f < floors; f++) {
    const yBase = f * FLOOR_H;

    // Floor plate (f>0)
    if (f > 0) {
      pushBox(wallGeos, cx, yBase, cz, width - WALL_T, 0.15, depth - WALL_T);
    }

    // 4 walls with window cutouts
    buildWall(wallGeos, accentGeos, cx, yBase, cz - hd, width, FLOOR_H, WALL_T, 'z', f === 0);
    buildWall(wallGeos, accentGeos, cx, yBase, cz + hd, width, FLOOR_H, WALL_T, 'z', false);
    buildWall(wallGeos, accentGeos, cx - hw, yBase, cz, depth, FLOOR_H, WALL_T, 'x', false);
    buildWall(wallGeos, accentGeos, cx + hw, yBase, cz, depth, FLOOR_H, WALL_T, 'x', f === 0);

    // Accent trim at ceiling level
    pushBox(accentGeos, cx, yBase + FLOOR_H - 0.04, cz, width + 0.05, 0.06, depth + 0.05);

    // Loot spots (2-3 per floor)
    const spots = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < spots; i++) {
      lootSpots.push(new THREE.Vector3(
        cx + (Math.random() - 0.5) * (width - 3),
        yBase + 0.4,
        cz + (Math.random() - 0.5) * (depth - 3),
      ));
    }
  }

  // Roof — slightly overhanging, colored
  const roofH = 0.5;
  pushBox(roofGeos, cx, totalH, cz, width + 1.2, roofH, depth + 1.2);
  // Roof ridge
  if (Math.random() < 0.6) {
    pushBox(roofGeos, cx, totalH + roofH, cz, width * 0.3, 0.8, depth + 0.5);
  }

  // ── Merge and create meshes ──
  const wallMat = new THREE.MeshStandardMaterial({
    color: palette.wall, roughness: 0.75, metalness: 0.1,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: palette.accent, roughness: 0.4, metalness: 0.3,
    emissive: palette.accent, emissiveIntensity: 0.12,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: palette.roof, roughness: 0.65, metalness: 0.15,
  });

  if (wallGeos.length > 0) {
    const merged = mergeGeometries(wallGeos, false);
    if (merged) {
      const m = new THREE.Mesh(merged, wallMat);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
  }
  if (accentGeos.length > 0) {
    const merged = mergeGeometries(accentGeos, false);
    if (merged) {
      const m = new THREE.Mesh(merged, accentMat);
      m.castShadow = false;
      group.add(m);
    }
  }
  if (roofGeos.length > 0) {
    const merged = mergeGeometries(roofGeos, false);
    if (merged) {
      const m = new THREE.Mesh(merged, roofMat);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // Dispose individual geos (merged copies data)
  for (const g of [...wallGeos, ...accentGeos, ...roofGeos]) g.dispose();

  // Door entry points — just outside each doorway
  // Wall 1 (south, z-hd): door opens along -Z
  // Wall 4 (east, x+hw): door opens along +X
  const doorPositions: { x: number; z: number }[] = [
    { x: cx, z: cz - hd - 1.0 },
    { x: cx + hw + 1.0, z: cz },
  ];

  // ── Per-wall colliders with door gaps ──
  const wallColliders: WallCollider[] = [];
  const pad = 0.15; // extra thickness so player can't clip through

  // Helper: compute colliders for one wall, splitting at door if needed
  function addWallColliders(
    wallCx: number, wallCz: number,
    wallLength: number, wallAxis: 'x' | 'z', hasDoor: boolean,
  ): void {
    const wt = WALL_T + pad; // collision thickness
    if (!hasDoor) {
      // Solid wall — single box
      if (wallAxis === 'z') {
        wallColliders.push({ x: wallCx, z: wallCz, hw: wallLength / 2 + pad, hd: wt / 2 });
      } else {
        wallColliders.push({ x: wallCx, z: wallCz, hw: wt / 2, hd: wallLength / 2 + pad });
      }
      return;
    }
    // Wall with door — split into left and right of door gap
    const segs = Math.max(1, Math.floor(wallLength / 3.5));
    const segW = wallLength / segs;
    const doorIdx = Math.floor(segs / 2);
    const doorStart = -wallLength / 2 + doorIdx * segW;
    const doorEnd = doorStart + segW;

    // Left portion (from wall start to door start)
    const leftLen = doorStart + wallLength / 2; // = doorIdx * segW
    if (leftLen > 0.1) {
      const leftCenter = -wallLength / 2 + leftLen / 2;
      if (wallAxis === 'z') {
        wallColliders.push({ x: wallCx + leftCenter, z: wallCz, hw: leftLen / 2, hd: wt / 2 });
      } else {
        wallColliders.push({ x: wallCx, z: wallCz + leftCenter, hw: wt / 2, hd: leftLen / 2 });
      }
    }

    // Right portion (from door end to wall end)
    const rightLen = wallLength / 2 - doorEnd; // = (segs - doorIdx - 1) * segW
    if (rightLen > 0.1) {
      const rightCenter = doorEnd + rightLen / 2;
      if (wallAxis === 'z') {
        wallColliders.push({ x: wallCx + rightCenter, z: wallCz, hw: rightLen / 2, hd: wt / 2 });
      } else {
        wallColliders.push({ x: wallCx, z: wallCz + rightCenter, hw: wt / 2, hd: rightLen / 2 });
      }
    }
  }

  // Same order as buildWall calls:
  addWallColliders(cx, cz - hd, width, 'z', true);   // south wall — has door
  addWallColliders(cx, cz + hd, width, 'z', false);   // north wall
  addWallColliders(cx - hw, cz, depth, 'x', false);   // west wall
  addWallColliders(cx + hw, cz, depth, 'x', true);    // east wall — has door

  return { cx, cz, width, depth, floors, mesh: group, lootSpots, hw, hd, doorPositions, wallColliders };
}

/**
 * Build a wall along one axis with window/door cutouts.
 * Pushes box geometries into the arrays (doesn't create meshes).
 */
function buildWall(
  wallGeos: THREE.BufferGeometry[],
  accentGeos: THREE.BufferGeometry[],
  cx: number, yBase: number, cz: number,
  length: number, height: number, thickness: number,
  axis: 'x' | 'z',
  hasDoor: boolean,
): void {
  const segs = Math.max(1, Math.floor(length / 3.5));
  const segW = length / segs;
  const yMid = yBase + height / 2;

  for (let i = 0; i < segs; i++) {
    const t = -length / 2 + segW / 2 + i * segW;
    const sx = axis === 'z' ? cx + t : cx;
    const sz = axis === 'z' ? cz : cz + t;

    const w = axis === 'z' ? segW : thickness;
    const d = axis === 'z' ? thickness : segW;

    // Door in center on ground floor; windows randomly on upper
    const isDoor = hasDoor && (i === Math.floor(segs / 2));
    const isWindow = !isDoor && Math.random() < 0.4;

    if (!isDoor && !isWindow) {
      // Solid wall panel
      pushBox(wallGeos, sx, yMid, sz, w, height, d);
    } else if (isDoor) {
      // Above door
      const doorH = 2.4;
      const aboveH = height - doorH;
      if (aboveH > 0.2) {
        pushBox(wallGeos, sx, yBase + doorH + aboveH / 2, sz, w, aboveH, d);
      }
      // Side pillars
      const pillarW = segW * 0.2;
      const pw = axis === 'z' ? pillarW : thickness;
      const pd = axis === 'z' ? thickness : pillarW;
      pushBox(wallGeos, axis === 'z' ? sx - segW / 2 + pillarW / 2 : sx, yBase + doorH / 2, axis === 'z' ? sz : sz - segW / 2 + pillarW / 2, pw, doorH, pd);
      pushBox(wallGeos, axis === 'z' ? sx + segW / 2 - pillarW / 2 : sx, yBase + doorH / 2, axis === 'z' ? sz : sz + segW / 2 - pillarW / 2, pw, doorH, pd);
      // Door frame accent
      const frameW = axis === 'z' ? segW * 0.65 : thickness + 0.04;
      const frameD = axis === 'z' ? thickness + 0.04 : segW * 0.65;
      pushBox(accentGeos, sx, yBase + doorH, sz, frameW, 0.08, frameD);
    } else {
      // Window
      const sillH = 1.0;
      const winH = 1.2;
      const aboveH = height - sillH - winH;
      // Below sill
      pushBox(wallGeos, sx, yBase + sillH / 2, sz, w, sillH, d);
      // Above window
      if (aboveH > 0.15) {
        pushBox(wallGeos, sx, yBase + sillH + winH + aboveH / 2, sz, w, aboveH, d);
      }
      // Side pillars
      const openW = segW * 0.55;
      const sideW = (segW - openW) / 2;
      const spw = axis === 'z' ? sideW : thickness;
      const spd = axis === 'z' ? thickness : sideW;
      pushBox(wallGeos, axis === 'z' ? sx - segW / 2 + sideW / 2 : sx, yBase + sillH + winH / 2, axis === 'z' ? sz : sz - segW / 2 + sideW / 2, spw, winH, spd);
      pushBox(wallGeos, axis === 'z' ? sx + segW / 2 - sideW / 2 : sx, yBase + sillH + winH / 2, axis === 'z' ? sz : sz + segW / 2 - sideW / 2, spw, winH, spd);
      // Window sill accent
      const acW = axis === 'z' ? openW + 0.08 : thickness + 0.04;
      const acD = axis === 'z' ? thickness + 0.04 : openW + 0.08;
      pushBox(accentGeos, sx, yBase + sillH, sz, acW, 0.06, acD);
    }
  }
}

/** Helper: create a box geometry positioned at (x,y,z) with size (w,h,d). */
function pushBox(arr: THREE.BufferGeometry[], x: number, y: number, z: number, w: number, h: number, d: number): void {
  const g = _box.clone();
  g.scale(w, h, d);
  g.translate(x, y, z);
  arr.push(g);
}
