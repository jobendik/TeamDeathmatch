import * as YUKA from 'yuka';
import { ARENA_MARGIN } from '@/config/constants';
import { gameState } from '@/core/GameState';

/**
 * Generate cover points near walls and pillars for AI use.
 */
export function buildCoverPoints(): void {
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
}
