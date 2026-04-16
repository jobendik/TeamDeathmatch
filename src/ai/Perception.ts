import * as THREE from 'three';
import * as YUKA from 'yuka';
import { gameState } from '@/core/GameState';
import type { TDMAgent, EnemyMemoryEntry } from '@/entities/TDMAgent';
import { isEnemy } from '@/core/GameModes';

const _origin = new THREE.Vector3();
const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _toTarget = new YUKA.Vector3();
const _heading = new YUKA.Vector3();

const PERCEPTION_STAGGER = 3;

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

export function canSee(ag: TDMAgent, target: TDMAgent): boolean {
  if (ag.isDead || target.isDead) return false;
  if (!isEnemy(ag, target)) return false;
  const dist = ag.position.distanceTo(target.position);
  if (dist > ag.visionRange) return false;

  _toTarget.subVectors(target.position, ag.position).normalize();
  _heading.set(0, 0, 1).applyRotation(ag.rotation);
  const dot = _heading.dot(_toTarget);
  // Personality-modulated FOV (tunnel-visioned bots have narrower effective FOV)
  const tunnelPenalty = ag.personality ? ag.personality.tunnelVision * 0.15 : 0;
  const effectiveFOV = ag.visionFOV * (1 - tunnelPenalty);
  if (dot < Math.cos(effectiveFOV * 0.5)) return false;

  return !isOccluded(ag.position, target.position);
}

export function shouldRunPerception(ag: TDMAgent): boolean {
  return (gameState.perceptionFrame + ag.perceptionSlot) % PERCEPTION_STAGGER === 0;
}

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

export function decayEnemyMemory(ag: TDMAgent, dt: number): void {
  const now = gameState.worldElapsed;
  const toDelete: string[] = [];

  // Personality: high attention-span bots remember longer
  const attentionMul = ag.personality ? (1.3 - ag.personality.attentionSpan * 0.5) : 1;

  for (const [name, entry] of ag.enemyMemory) {
    const age = now - entry.lastSeenTime;
    const baseDecay = entry.source === 'visual' ? 0.15 : 0.3;
    entry.confidence = Math.max(0, entry.confidence - dt * baseDecay * attentionMul);

    if (age > 2 && entry.wasMoving && entry.confidence > 0.1) {
      entry.lastSeenPos.x += entry.lastVelocity.x * dt * 0.3;
      entry.lastSeenPos.z += entry.lastVelocity.z * dt * 0.3;
    }

    if (entry.confidence <= 0 || age > 20) toDelete.push(name);
  }

  for (const name of toDelete) ag.enemyMemory.delete(name);
}

/**
 * Legacy broadcast — kept as a fallback but AIController now uses queueCallout
 * from TeamIntel.ts. This function still exists for any code that imports it.
 */
export function broadcastEnemyPosition(spotter: TDMAgent, enemy: TDMAgent): void {
  // Delegation preserved for compatibility but AIController queues via TeamIntel directly.
  // We still update spotter's own memory from visual source.
  updateEnemyMemory(spotter, enemy, 'visual');
}

export function checkAudioAwareness(ag: TDMAgent): void {
  if (ag.isDead) return;

  const timeSinceDmg = gameState.worldElapsed - ag.lastDamageTime;
  if (timeSinceDmg < 0.5 && ag.lastAttacker && !ag.lastAttacker.isDead) {
    ag.alertLevel = Math.min(100, ag.alertLevel + 40);
    updateEnemyMemory(ag, ag.lastAttacker, 'damage');
    if (!ag.hasTarget) {
      // Damage-based LKP gets noise — you don't know exactly where they shot from
      const noise = 3 + (ag.personality ? (1 - ag.personality.skill) * 5 : 3);
      ag.lastKnownPos.set(
        ag.lastAttacker.position.x + (Math.random() - 0.5) * noise,
        0,
        ag.lastAttacker.position.z + (Math.random() - 0.5) * noise,
      );
      ag.hasLastKnown = true;
    }
    return;
  }

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
        const noise = 4;
        ag.lastKnownPos.set(
          bullet.mesh.position.x + (Math.random() - 0.5) * noise,
          0,
          bullet.mesh.position.z + (Math.random() - 0.5) * noise,
        );
        ag.hasLastKnown = true;
      }
      break;
    }
  }
}

function scoreTarget(ag: TDMAgent, target: TDMAgent, dist: number): number {
  let score = 0;

  const rangeDiff = Math.abs(dist - ag.preferredRange);
  score -= rangeDiff * 0.5;

  const hpRatio = target.hp / target.maxHP;
  if (hpRatio < 0.3) score += 40;
  else if (hpRatio < 0.5) score += 20;
  else if (hpRatio < 0.75) score += 5;

  if (target === ag.lastAttacker) score += 25;
  if (target.botClass === 'sniper') score += 15;

  // Tunnel-visioned bots strongly stick with current target
  const tunnel = ag.personality ? ag.personality.tunnelVision : 0.4;
  if (target === ag.currentTarget) score += 20 + tunnel * 25;

  if (dist < 8) score += 15;

  if (ag.currentTarget && ag.currentTarget !== target) {
    const currentDist = ag.position.distanceTo(ag.currentTarget.position);
    if (currentDist < 15 && dist > 25) score -= 30;
  }

  const mem = ag.enemyMemory.get(target.name);
  if (mem && mem.confidence > 0.5) score += 10;

  // Grudge: prioritize the one who killed us
  if (ag.grudge === target) {
    const revenge = ag.personality ? ag.personality.revengeBias : 0.4;
    score += 30 * revenge;
  }

  return score;
}

export function findBestTarget(ag: TDMAgent): { target: TDMAgent | null; dist: number } {
  if (ag.currentTarget && !ag.currentTarget.isDead && canSee(ag, ag.currentTarget)) {
    const d = ag.position.distanceTo(ag.currentTarget.position);
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
