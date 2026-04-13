import * as THREE from 'three';
import * as YUKA from 'yuka';
import { gameState } from '@/core/GameState';
import type { TDMAgent } from '@/entities/TDMAgent';

/**
 * Check if line-of-sight between two positions is blocked by walls.
 */
export function isOccluded(from: YUKA.Vector3, to: YUKA.Vector3): boolean {
  const origin = new THREE.Vector3(from.x, 0.9, from.z);
  const target = new THREE.Vector3(to.x, 1.0, to.z);
  const dir = target.clone().sub(origin);
  const dist = dir.length();
  if (dist < 0.01) return false;
  gameState.raycaster.set(origin, dir.normalize());
  const hits = gameState.raycaster.intersectObjects(gameState.wallMeshes, false);
  return hits.length > 0 && hits[0].distance < dist;
}

/**
 * Check if an agent can see a target (range, FOV, and occlusion).
 */
export function canSee(ag: TDMAgent, target: TDMAgent): boolean {
  if (ag.isDead || target.isDead) return false;
  const dist = ag.position.distanceTo(target.position);
  if (dist > ag.visionRange) return false;

  // FOV check
  const toTarget = new YUKA.Vector3().subVectors(target.position, ag.position).normalize();
  const heading = new YUKA.Vector3(0, 0, 1).applyRotation(ag.rotation);
  const dot = heading.dot(toTarget);
  if (dot < Math.cos(ag.visionFOV * 0.5)) return false;

  // Occlusion check
  return !isOccluded(ag.position, target.position);
}

/**
 * Broadcast an enemy sighting to nearby teammates.
 * Simulates callouts — teammates within range get alerted to the enemy position.
 */
export function broadcastEnemyPosition(spotter: TDMAgent, enemy: TDMAgent): void {
  const calloutRange = 30; // teammates within 30 units get the callout

  for (const ally of gameState.agents) {
    if (ally === spotter || ally === gameState.player || ally.isDead) continue;
    if (ally.team !== spotter.team) continue;

    const distToSpotter = ally.position.distanceTo(spotter.position);
    if (distToSpotter < calloutRange) {
      // Teammate receives callout
      if (!ally.teamCallout) ally.teamCallout = new YUKA.Vector3();
      ally.teamCallout.copy(enemy.position);
      ally.teamCalloutTime = gameState.worldElapsed;
      ally.alertLevel = Math.min(100, ally.alertLevel + 20);
    }
  }
}

/**
 * Check if agent can "hear" nearby gunfire (even without LOS).
 * Also detects when the agent is being shot at via recent damage.
 */
export function checkAudioAwareness(ag: TDMAgent): void {
  if (ag.isDead) return;

  // If recently damaged, immediately become alert and face the attacker
  const timeSinceDmg = gameState.worldElapsed - ag.lastDamageTime;
  if (timeSinceDmg < 0.5 && ag.lastAttacker && !ag.lastAttacker.isDead) {
    ag.alertLevel = Math.min(100, ag.alertLevel + 40);
    if (!ag.hasTarget) {
      ag.lastKnownPos.copy(ag.lastAttacker.position);
      ag.hasLastKnown = true;
    }
    return;
  }

  // Hear projectiles (rockets, grenades) nearby
  const hearRange = 25;
  for (const bullet of gameState.bullets) {
    if (bullet.ownerTeam === ag.team) continue;
    const bx = bullet.mesh.position.x;
    const bz = bullet.mesh.position.z;
    const dx = ag.position.x - bx;
    const dz = ag.position.z - bz;
    if (dx * dx + dz * dz < hearRange * hearRange) {
      ag.alertLevel = Math.min(100, ag.alertLevel + 8);
      if (!ag.hasTarget && !ag.hasLastKnown) {
        ag.lastKnownPos.set(bx, 0, bz);
        ag.hasLastKnown = true;
      }
      break;
    }
  }
}

/**
 * Score a potential target based on multiple factors.
 * Higher score = better target to engage.
 */
function scoreTarget(ag: TDMAgent, target: TDMAgent, dist: number): number {
  let score = 0;

  // Distance factor — prefer targets at our preferred range
  const rangeDiff = Math.abs(dist - ag.preferredRange);
  score -= rangeDiff * 0.5;

  // Low HP targets — focus fire to secure kills
  const hpRatio = target.hp / target.maxHP;
  if (hpRatio < 0.3) score += 40;       // Almost dead — prioritize!
  else if (hpRatio < 0.5) score += 20;   // Wounded — good target
  else if (hpRatio < 0.75) score += 5;

  // Threat level — prioritize anyone shooting at us
  if (target === ag.lastAttacker) score += 25;

  // Class priority — snipers are high-value targets
  if (target.botClass === 'sniper') score += 15;

  // Already tracking this target — continuity bonus (don't keep switching)
  if (target === ag.currentTarget) score += 20;

  // Close targets get a bonus (survival instinct)
  if (dist < 8) score += 15;

  // Penalize switching to far targets when already engaged close
  if (ag.currentTarget && ag.currentTarget !== target) {
    const currentDist = ag.position.distanceTo(ag.currentTarget.position);
    if (currentDist < 15 && dist > 25) score -= 30;
  }

  return score;
}

/**
 * Find the best target using multi-factor scoring instead of just closest-distance.
 */
export function findBestTarget(ag: TDMAgent): { target: TDMAgent | null; dist: number } {
  let bestTarget: TDMAgent | null = null;
  let bestScore = -Infinity;
  let bestDist = Infinity;

  for (const other of gameState.agents) {
    if (other === ag || other.team === ag.team || other.isDead) continue;
    if (!canSee(ag, other)) continue;

    const d = ag.position.distanceTo(other.position);
    const score = scoreTarget(ag, other, d);

    if (score > bestScore) {
      bestScore = score;
      bestTarget = other;
      bestDist = d;
    }
  }

  return { target: bestTarget, dist: bestDist };
}

/**
 * Count nearby alive teammates.
 */
export function countNearbyAllies(ag: TDMAgent, range: number): number {
  let count = 0;
  for (const ally of gameState.agents) {
    if (ally === ag || ally.isDead || ally.team !== ag.team) continue;
    if (ag.position.distanceTo(ally.position) < range) count++;
  }
  return count;
}
