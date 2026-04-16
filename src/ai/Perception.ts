import * as THREE from 'three';
import * as YUKA from 'yuka';
import { gameState } from '@/core/GameState';
import type { TDMAgent, EnemyMemoryEntry } from '@/entities/TDMAgent';
import { isEnemy } from '@/core/GameModes';

// ── Cached temporaries to avoid hot-loop allocations ──
const _origin = new THREE.Vector3();
const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _toTarget = new YUKA.Vector3();
const _heading = new YUKA.Vector3();

/** Number of frames between full perception sweeps for each agent */
const PERCEPTION_STAGGER = 3;

/**
 * Check if line-of-sight between two positions is blocked by walls.
 * Uses cached vectors to avoid allocations.
 */
export function isOccluded(from: YUKA.Vector3, to: YUKA.Vector3): boolean {
  _origin.set(from.x, 0.9, from.z);
  _target.set(to.x, 1.0, to.z);
  _dir.subVectors(_target, _origin);
  const dist = _dir.length();
  if (dist < 0.01) return false;
  _dir.normalize();
  gameState.raycaster.set(_origin, _dir);
  const hits = gameState.raycaster.intersectObjects(gameState.wallMeshes, false);
  return hits.length > 0 && hits[0].distance < dist;
}

/**
 * Check if an agent can see a target (range, FOV, and occlusion).
 */
export function canSee(ag: TDMAgent, target: TDMAgent): boolean {
  if (ag.isDead || target.isDead) return false;
  if (!isEnemy(ag, target)) return false;
  const dist = ag.position.distanceTo(target.position);
  if (dist > ag.visionRange) return false;

  // FOV check (reuse cached vectors)
  _toTarget.subVectors(target.position, ag.position).normalize();
  _heading.set(0, 0, 1).applyRotation(ag.rotation);
  const dot = _heading.dot(_toTarget);
  if (dot < Math.cos(ag.visionFOV * 0.5)) return false;

  // Occlusion check
  return !isOccluded(ag.position, target.position);
}

/**
 * Whether this agent should run a full perception sweep this frame.
 * Staggers expensive work across frames to reduce per-frame cost.
 */
export function shouldRunPerception(ag: TDMAgent): boolean {
  return (gameState.perceptionFrame + ag.perceptionSlot) % PERCEPTION_STAGGER === 0;
}

/**
 * Update tactical memory for a seen enemy.
 */
export function updateEnemyMemory(ag: TDMAgent, enemy: TDMAgent, source: 'visual' | 'audio' | 'callout' | 'damage'): void {
  const existing = ag.enemyMemory.get(enemy.name);
  const now = gameState.worldElapsed;

  if (existing) {
    existing.lastSeenPos.copy(enemy.position);
    existing.lastSeenTime = now;
    existing.source = source;
    existing.confidence = source === 'visual' ? 1.0 : source === 'damage' ? 0.9 : source === 'callout' ? 0.6 : 0.4;
    existing.wasMoving = enemy.velocity.length() > 0.5;
    existing.lastVelocity.copy(enemy.velocity);
    // Update threat based on enemy HP and distance
    const dist = ag.position.distanceTo(enemy.position);
    existing.threat = Math.max(0, 100 - dist * 1.5 - (enemy.hp / enemy.maxHP) * 20);
  } else {
    const entry: EnemyMemoryEntry = {
      lastSeenPos: new YUKA.Vector3().copy(enemy.position),
      lastSeenTime: now,
      source,
      confidence: source === 'visual' ? 1.0 : 0.5,
      threat: 50,
      wasMoving: enemy.velocity.length() > 0.5,
      lastVelocity: new YUKA.Vector3().copy(enemy.velocity),
    };
    ag.enemyMemory.set(enemy.name, entry);
  }
}

/**
 * Decay all enemy memory entries over time. Remove very stale ones.
 */
export function decayEnemyMemory(ag: TDMAgent, dt: number): void {
  const now = gameState.worldElapsed;
  const toDelete: string[] = [];

  for (const [name, entry] of ag.enemyMemory) {
    const age = now - entry.lastSeenTime;
    // Decay confidence based on source
    const decayRate = entry.source === 'visual' ? 0.15 : 0.3;
    entry.confidence = Math.max(0, entry.confidence - dt * decayRate);

    // If old and low confidence, predict position drift
    if (age > 2 && entry.wasMoving && entry.confidence > 0.1) {
      // Grow uncertainty — shift predicted position slightly
      entry.lastSeenPos.x += entry.lastVelocity.x * dt * 0.3;
      entry.lastSeenPos.z += entry.lastVelocity.z * dt * 0.3;
    }

    // Remove very stale entries
    if (entry.confidence <= 0 || age > 20) {
      toDelete.push(name);
    }
  }

  for (const name of toDelete) {
    ag.enemyMemory.delete(name);
  }
}

/**
 * Broadcast an enemy sighting to nearby teammates with confidence.
 */
export function broadcastEnemyPosition(spotter: TDMAgent, enemy: TDMAgent): void {
  const calloutRange = 30;

  for (const ally of gameState.agents) {
    if (ally === spotter || ally.isDead) continue;
    if (gameState.mode === 'ffa' || ally.team !== spotter.team) continue;

    const distToSpotter = ally.position.distanceTo(spotter.position);
    if (distToSpotter < calloutRange) {
      // Teammate receives callout with degraded confidence
      if (!ally.teamCallout) ally.teamCallout = new YUKA.Vector3();
      ally.teamCallout.copy(enemy.position);
      ally.teamCalloutTime = gameState.worldElapsed;
      ally.alertLevel = Math.min(100, ally.alertLevel + 20);

      // Also update ally's tactical memory via callout
      updateEnemyMemory(ally, enemy, 'callout');
    }
  }
}

/**
 * Check if agent can "hear" nearby gunfire or projectiles.
 */
export function checkAudioAwareness(ag: TDMAgent): void {
  if (ag.isDead) return;

  // If recently damaged, immediately become alert and face the attacker
  const timeSinceDmg = gameState.worldElapsed - ag.lastDamageTime;
  if (timeSinceDmg < 0.5 && ag.lastAttacker && !ag.lastAttacker.isDead) {
    ag.alertLevel = Math.min(100, ag.alertLevel + 40);
    updateEnemyMemory(ag, ag.lastAttacker, 'damage');
    if (!ag.hasTarget) {
      ag.lastKnownPos.copy(ag.lastAttacker.position);
      ag.hasLastKnown = true;
    }
    return;
  }

  // Hear projectiles (rockets, grenades) nearby — check only a few per frame
  const hearRange = 25;
  const hearRangeSq = hearRange * hearRange;
  const checkCount = Math.min(gameState.bullets.length, 5);
  for (let j = 0; j < checkCount; j++) {
    const bullet = gameState.bullets[j];
    if (bullet.ownerTeam === ag.team) continue;
    const dx = ag.position.x - bullet.mesh.position.x;
    const dz = ag.position.z - bullet.mesh.position.z;
    if (dx * dx + dz * dz < hearRangeSq) {
      ag.alertLevel = Math.min(100, ag.alertLevel + 8);
      if (!ag.hasTarget && !ag.hasLastKnown) {
        ag.lastKnownPos.set(bullet.mesh.position.x, 0, bullet.mesh.position.z);
        ag.hasLastKnown = true;
      }
      break;
    }
  }
}

/**
 * Score a potential target based on multiple factors.
 */
function scoreTarget(ag: TDMAgent, target: TDMAgent, dist: number): number {
  let score = 0;

  // Distance factor — prefer targets at our preferred range
  const rangeDiff = Math.abs(dist - ag.preferredRange);
  score -= rangeDiff * 0.5;

  // Low HP targets — focus fire to secure kills
  const hpRatio = target.hp / target.maxHP;
  if (hpRatio < 0.3) score += 40;
  else if (hpRatio < 0.5) score += 20;
  else if (hpRatio < 0.75) score += 5;

  // Threat level — prioritize anyone shooting at us
  if (target === ag.lastAttacker) score += 25;

  // Class priority — snipers are high-value targets
  if (target.botClass === 'sniper') score += 15;

  // Already tracking this target — continuity bonus
  if (target === ag.currentTarget) score += 20;

  // Close targets get a bonus (survival instinct)
  if (dist < 8) score += 15;

  // Penalize switching to far targets when already engaged close
  if (ag.currentTarget && ag.currentTarget !== target) {
    const currentDist = ag.position.distanceTo(ag.currentTarget.position);
    if (currentDist < 15 && dist > 25) score -= 30;
  }

  // Tactical memory bonus — target we've been tracking has higher priority
  const mem = ag.enemyMemory.get(target.name);
  if (mem && mem.confidence > 0.5) score += 10;

  return score;
}

/**
 * Find the best target using multi-factor scoring.
 * Time-sliced: only runs full sweep when shouldRunPerception returns true,
 * otherwise returns the current target if still valid.
 */
export function findBestTarget(ag: TDMAgent): { target: TDMAgent | null; dist: number } {
  // Quick check: is current target still valid?
  if (ag.currentTarget && !ag.currentTarget.isDead && canSee(ag, ag.currentTarget)) {
    const d = ag.position.distanceTo(ag.currentTarget.position);
    // Only do full re-evaluation on perception frames
    if (!shouldRunPerception(ag)) {
      return { target: ag.currentTarget, dist: d };
    }
  }

  let bestTarget: TDMAgent | null = null;
  let bestScore = -Infinity;
  let bestDist = Infinity;

  for (const other of gameState.agents) {
    if (other === ag || other.isDead) continue;
    if (!isEnemy(ag, other)) continue;
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
  const rangeSq = range * range;
  for (const ally of gameState.agents) {
    if (ally === ag || ally.isDead) continue;
    if (gameState.mode === 'ffa' || ally.team !== ag.team) continue;
    const dx = ag.position.x - ally.position.x;
    const dz = ag.position.z - ally.position.z;
    if (dx * dx + dz * dz < rangeSq) count++;
  }
  return count;
}
