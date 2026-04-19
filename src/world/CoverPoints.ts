import * as YUKA from 'yuka';
import { ARENA_MARGIN } from '@/config/constants';
import { gameState } from '@/core/GameState';

const FALLBACK_COVER_POINTS: readonly [number, number][] = [
  [-37, -3], [37, 3], [-30, -20], [30, 20],
  [-22, 2], [22, -2], [2, -22], [-2, 22],
  [-12, 12], [12, -12], [-12, -12], [12, 12],
  [-44, -40], [44, 40], [-44, 40], [44, -40],
  [-20, 0], [20, 0], [0, -20], [0, 20],
];

const navPoint = new YUKA.Vector3();

/**
 * Generate cover points near walls and pillars for AI use.
 */
export function buildCoverPoints(): void {
  gameState.coverPoints.length = 0;

  for (const c of gameState.arenaColliders) {
    if (c.type === 'box') {
      const offsets: [number, number][] = [
        [c.hw + 1.2, 0],
        [-(c.hw + 1.2), 0],
        [0, c.hd + 1.2],
        [0, -(c.hd + 1.2)],
      ];
      for (const [ox, oz] of offsets) {
        const px = c.x + ox;
        const pz = c.z + oz;
        if (Math.abs(px) < ARENA_MARGIN && Math.abs(pz) < ARENA_MARGIN) {
          gameState.coverPoints.push(new YUKA.Vector3(px, 0, pz));
        }
      }
    } else {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 2) {
        const px = c.x + Math.cos(a) * (c.r + 1.2);
        const pz = c.z + Math.sin(a) * (c.r + 1.2);
        if (Math.abs(px) < ARENA_MARGIN && Math.abs(pz) < ARENA_MARGIN) {
          gameState.coverPoints.push(new YUKA.Vector3(px, 0, pz));
        }
      }
    }
  }

  if (gameState.coverPoints.length > 0) {
    return;
  }

  const seen = new Set<string>();
  for (const [x, z] of FALLBACK_COVER_POINTS) {
    let px = x;
    let pz = z;

    if (gameState.navMeshManager.navMesh) {
      navPoint.set(x, 0, z);
      const projected = gameState.navMeshManager.projectPoint(navPoint, 0.45);
      px = projected.x;
      pz = projected.z;
      if (!gameState.navMeshManager.getRegionForPoint(projected, 0.45)) {
        continue;
      }
    }

    if (Math.abs(px) >= ARENA_MARGIN || Math.abs(pz) >= ARENA_MARGIN) {
      continue;
    }

    const key = `${px.toFixed(1)}:${pz.toFixed(1)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    gameState.coverPoints.push(new YUKA.Vector3(px, 0, pz));
  }
}
