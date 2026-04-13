import * as YUKA from 'yuka';
import { ARENA_MARGIN } from '@/config/constants';
import { gameState } from '@/core/GameState';
import { isOccluded } from './Perception';
import type { TDMAgent } from '@/entities/TDMAgent';
import { WEAPONS } from '@/config/weapons';

/**
 * Check if a world position is inside any wall/pillar collider.
 * Uses arenaColliders (slightly expanded) so agents don't target positions
 * that keepInside would push them out of.
 */
export function isInsideWall(x: number, z: number): boolean {
  if (Math.abs(x) > ARENA_MARGIN || Math.abs(z) > ARENA_MARGIN) return true;
  for (const c of gameState.arenaColliders) {
    if (c.type === 'box') {
      if (Math.abs(x - c.x) < c.hw && Math.abs(z - c.z) < c.hd) return true;
    } else {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) return true;
    }
  }
  return false;
}

/**
 * Push a position out of any wall it's inside. Returns a safe position.
 */
export function pushOutOfWall(x: number, z: number): { x: number; z: number } {
  for (const c of gameState.arenaColliders) {
    if (c.type === 'box') {
      const dx = x - c.x;
      const dz = z - c.z;
      const ox = c.hw - Math.abs(dx);
      const oz = c.hd - Math.abs(dz);
      if (ox >= 0 && oz >= 0) {
        if (ox < oz) x = c.x + Math.sign(dx || 1) * (c.hw + 0.3);
        else z = c.z + Math.sign(dz || 1) * (c.hd + 0.3);
      }
    } else {
      const dx = x - c.x;
      const dz = z - c.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < c.r * c.r) {
        const dist = Math.sqrt(distSq) || 1;
        x = c.x + (dx / dist) * (c.r + 0.3);
        z = c.z + (dz / dist) * (c.r + 0.3);
      }
    }
  }
  x = Math.max(-ARENA_MARGIN + 1, Math.min(ARENA_MARGIN - 1, x));
  z = Math.max(-ARENA_MARGIN + 1, Math.min(ARENA_MARGIN - 1, z));
  return { x, z };
}

/**
 * Find the best cover point — considers sightlines, distance to threat, teammates, and pickups.
 */
export function findCoverFrom(ag: TDMAgent, threat: YUKA.Vector3): YUKA.Vector3 | null {
  let bestCover: YUKA.Vector3 | null = null;
  let bestScore = -Infinity;

  for (const cp of gameState.coverPoints) {
    const distToAgent = ag.position.distanceTo(cp);
    const distToThreat = cp.distanceTo(threat);
    if (distToAgent > 35) continue;
    if (!isOccluded(cp, threat)) continue;

    // Base score: close to agent, far from threat
    let score = distToThreat * 0.3 - distToAgent * 0.7;

    // Bonus: cover near teammates (safety in numbers)
    for (const ally of gameState.agents) {
      if (ally === ag || ally.isDead || ally.team !== ag.team) continue;
      const allyDist = ally.position.distanceTo(cp);
      if (allyDist < 15) score += 3;
    }

    // Bonus: cover near active health pickups when HP is low
    if (ag.hp < ag.maxHP * 0.5) {
      for (const p of gameState.pickups) {
        if (!p.active || p.t !== 'health') continue;
        const pickupDist = cp.distanceTo(new YUKA.Vector3(p.x, 0, p.z));
        if (pickupDist < 12) score += 8;
      }
    }

    // Penalty: cover too close to another enemy
    for (const enemy of gameState.agents) {
      if (enemy.isDead || enemy.team === ag.team) continue;
      const enemyDist = enemy.position.distanceTo(cp);
      if (enemyDist < 8) score -= 15;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCover = cp;
    }
  }

  return bestCover;
}

/**
 * Find aggressive cover — cover that still has a sightline to the target (peek potential).
 */
export function findPeekCover(ag: TDMAgent, targetPos: YUKA.Vector3): YUKA.Vector3 | null {
  let bestCover: YUKA.Vector3 | null = null;
  let bestScore = -Infinity;

  for (const cp of gameState.coverPoints) {
    const distToAgent = ag.position.distanceTo(cp);
    if (distToAgent > 25) continue;

    // We want cover that is close BUT has nearby positions with LOS to target
    // Check if a position ~2 units from cover toward the target has LOS
    const toTarget = new YUKA.Vector3().subVectors(targetPos, cp).normalize();
    const peekPos = new YUKA.Vector3(
      cp.x + toTarget.x * 2.5,
      0,
      cp.z + toTarget.z * 2.5,
    );

    // The cover point itself should be occluded
    if (!isOccluded(cp, targetPos)) continue;

    // But the peek position should NOT be occluded (we can shoot from there)
    if (isOccluded(peekPos, targetPos)) continue;

    const distToTarget = cp.distanceTo(targetPos);
    let score = -distToAgent * 0.5;
    // Prefer cover at our class's preferred range
    score -= Math.abs(distToTarget - ag.preferredRange) * 0.3;

    if (score > bestScore) {
      bestScore = score;
      bestCover = cp;
    }
  }

  return bestCover;
}

/**
 * Calculate a flanking position — circle around behind the target through cover.
 * Much smarter than the old perpendicular offset.
 */
export function findFlankPosition(ag: TDMAgent, targetPos: YUKA.Vector3): YUKA.Vector3 | null {
  const toTarget = new YUKA.Vector3().subVectors(targetPos, ag.position);
  const len = toTarget.length();
  if (len < 1) return null;
  toTarget.normalize();

  // Try to get behind the target by combining perpendicular + forward offset
  const side = Math.random() > 0.5 ? 1 : -1;
  const perpX = -toTarget.z * side;
  const perpZ = toTarget.x * side;

  // Arc around: perpendicular + slightly behind target
  const flankDist = 10 + Math.random() * 8;
  const behindDist = 5 + Math.random() * 5;

  const fx = targetPos.x + perpX * flankDist - toTarget.x * behindDist;
  const fz = targetPos.z + perpZ * flankDist - toTarget.z * behindDist;

  let clampedX = Math.max(-ARENA_MARGIN, Math.min(ARENA_MARGIN, fx));
  let clampedZ = Math.max(-ARENA_MARGIN, Math.min(ARENA_MARGIN, fz));

  // Ensure the flank position isn't inside a wall
  if (isInsideWall(clampedX, clampedZ)) {
    const pushed = pushOutOfWall(clampedX, clampedZ);
    clampedX = pushed.x;
    clampedZ = pushed.z;
  }
  const flankPos = new YUKA.Vector3(clampedX, 0, clampedZ);

  // Verify the flank position isn't blocked — if it is, try the other side
  if (isOccluded(flankPos, targetPos)) {
    let altFx = targetPos.x - perpX * flankDist - toTarget.x * behindDist;
    let altFz = targetPos.z - perpZ * flankDist - toTarget.z * behindDist;
    altFx = Math.max(-ARENA_MARGIN, Math.min(ARENA_MARGIN, altFx));
    altFz = Math.max(-ARENA_MARGIN, Math.min(ARENA_MARGIN, altFz));
    if (isInsideWall(altFx, altFz)) {
      const pushed = pushOutOfWall(altFx, altFz);
      altFx = pushed.x;
      altFz = pushed.z;
    }
    return new YUKA.Vector3(altFx, 0, altFz);
  }

  return flankPos;
}

/**
 * Find a good sniper position — far from enemy, behind cover, with long sightlines.
 */
export function findSniperNest(ag: TDMAgent, targetPos: YUKA.Vector3): YUKA.Vector3 | null {
  let bestPos: YUKA.Vector3 | null = null;
  let bestScore = -Infinity;

  for (const cp of gameState.coverPoints) {
    const distToAgent = ag.position.distanceTo(cp);
    if (distToAgent > 40) continue;

    const distToTarget = cp.distanceTo(targetPos);
    // Snipers want 25-50 range
    if (distToTarget < 20 || distToTarget > 55) continue;

    // Must have LOS from a peek position
    const toTarget = new YUKA.Vector3().subVectors(targetPos, cp).normalize();
    const peekPos = new YUKA.Vector3(cp.x + toTarget.x * 2, 0, cp.z + toTarget.z * 2);

    if (isOccluded(peekPos, targetPos)) continue;

    let score = distToTarget * 0.3 - distToAgent * 0.3;
    // Bonus if far from enemies
    for (const enemy of gameState.agents) {
      if (enemy.isDead || enemy.team === ag.team) continue;
      if (enemy.position.distanceTo(cp) > 20) score += 5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestPos = cp;
    }
  }

  return bestPos;
}

/**
 * Find the nearest active pickup of a given type.
 * For 'weapon' type, finds the best upgrade available.
 */
export function findNearestPickup(ag: TDMAgent, type: 'health' | 'ammo' | 'weapon'): YUKA.Vector3 | null {
  let bestPos: YUKA.Vector3 | null = null;
  let bestDist = Infinity;
  let bestScore = -Infinity;

  for (const p of gameState.pickups) {
    if (!p.active) continue;

    if (type === 'weapon') {
      // For weapon pickups, find the most desirable upgrade
      if (p.t !== 'weapon' || !p.weaponId) continue;
      const wep = WEAPONS[p.weaponId];
      const cur = WEAPONS[ag.weaponId];
      if (!wep || wep.desirability <= cur.desirability) continue;
      const d = ag.position.distanceTo(new YUKA.Vector3(p.x, 0, p.z));
      const score = wep.desirability - d * 0.5;
      if (score > bestScore) {
        bestScore = score;
        bestPos = new YUKA.Vector3(p.x, 0, p.z);
      }
    } else {
      if (p.t !== type) continue;
      const d = ag.position.distanceTo(new YUKA.Vector3(p.x, 0, p.z));
      if (d < bestDist) {
        bestDist = d;
        bestPos = new YUKA.Vector3(p.x, 0, p.z);
      }
    }
  }

  return bestPos;
}
