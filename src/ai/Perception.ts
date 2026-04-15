import * as THREE from 'three';
import * as YUKA from 'yuka';
import { gameState } from '@/core/GameState';
import type { TDMAgent } from '@/entities/TDMAgent';
import type { EnemyMemory, SightingSource, TeamCallout } from './AITypes';
import { pushEnemyKnowledge } from './TacticalBlackboard';

const tmpHeading = new YUKA.Vector3();
const tmpToTarget = new YUKA.Vector3();

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function getAgentId(ag: TDMAgent): string {
  return `${ag.team}:${ag.name}`;
}

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

export function getVisibilityScore(ag: TDMAgent, target: TDMAgent): number {
  if (ag.isDead || target.isDead) return 0;

  const dist = ag.position.distanceTo(target.position);
  if (dist > ag.visionRange * 1.15) return 0;

  tmpToTarget.subVectors(target.position, ag.position).normalize();
  tmpHeading.set(0, 0, 1).applyRotation(ag.rotation);
  const dot = tmpHeading.dot(tmpToTarget);
  const minDot = Math.cos(ag.visionFOV * 0.55);
  const hardMinDot = Math.cos(ag.visionFOV * 0.72);

  if (dot < hardMinDot) return 0;

  const fovScore = clamp01((dot - minDot) / (1 - minDot || 1));
  const distScore = clamp01(1 - dist / (ag.visionRange * 1.05));
  const trackingBonus = ag.currentTarget === target ? 0.15 + ag.trackingTime * 0.1 : 0;
  const motorBonus = ag.trackingSkill * 0.08;
  const occlusionPenalty = isOccluded(ag.position, target.position) ? 0.55 : 0;

  return clamp01(fovScore * 0.55 + distScore * 0.35 + trackingBonus + motorBonus - occlusionPenalty);
}

export function canSee(ag: TDMAgent, target: TDMAgent): boolean {
  return getVisibilityScore(ag, target) >= 0.52;
}

function getOrCreateMemory(owner: TDMAgent, target: TDMAgent): EnemyMemory {
  const id = getAgentId(target);
  let mem = owner.enemyMemories.get(id);
  if (!mem) {
    mem = {
      enemyId: id,
      enemyName: target.name,
      enemyTeam: target.team,
      lastSeenPos: target.position.clone(),
      predictedPos: target.position.clone(),
      lastVelocity: new YUKA.Vector3(),
      certainty: 0,
      visibility: 0,
      source: 'visual',
      lastUpdateTime: -10,
      uncertaintyRadius: 8,
      threat: 0,
      wasVisible: false,
    };
    owner.enemyMemories.set(id, mem);
  }
  return mem;
}

function getMemoryById(owner: TDMAgent, id: string | null): EnemyMemory | null {
  if (!id) return null;
  return owner.enemyMemories.get(id) ?? null;
}

export function getEnemyMemory(owner: TDMAgent, target: TDMAgent | null): EnemyMemory | null {
  if (!target) return null;
  return getMemoryById(owner, getAgentId(target));
}

function updateVisualMemory(owner: TDMAgent, target: TDMAgent, dt: number): EnemyMemory {
  const mem = getOrCreateMemory(owner, target);
  const visibility = getVisibilityScore(owner, target);

  mem.lastVelocity.copy(target.velocity as YUKA.Vector3);
  mem.lastSeenPos.copy(target.position);
  mem.predictedPos.copy(target.position).add(mem.lastVelocity.clone().multiplyScalar(0.18 + target.position.distanceTo(owner.position) * 0.01));
  mem.source = 'visual';
  mem.visibility = visibility;
  mem.certainty = clamp01(Math.max(mem.certainty * 0.82, visibility * 0.9 + 0.08 + owner.motorSkill * 0.08));
  mem.lastUpdateTime = gameState.worldElapsed;
  mem.uncertaintyRadius = lerp(1.4, 7.5, 1 - mem.certainty);
  mem.threat = clamp01(mem.threat * 0.7 + (target === owner.lastAttacker ? 0.55 : 0.18 + visibility * 0.45));
  mem.wasVisible = visibility > 0.52;

  owner.lastKnownPos.copy(mem.lastSeenPos);
  owner.hasLastKnown = true;
  owner.lastVisibleEnemyTime = gameState.worldElapsed;

  if (dt > 0 && owner.currentTarget === target) {
    owner.targetCertainty = Math.max(owner.targetCertainty, mem.certainty);
  }

  return mem;
}

function injectMemory(owner: TDMAgent, enemy: TDMAgent, pos: YUKA.Vector3, certainty: number, source: SightingSource): EnemyMemory {
  const mem = getOrCreateMemory(owner, enemy);
  mem.lastSeenPos.copy(pos);
  mem.predictedPos.copy(pos);
  mem.source = source;
  mem.visibility = source === 'callout' ? mem.visibility * 0.6 : mem.visibility;
  mem.certainty = Math.max(mem.certainty, clamp01(certainty));
  mem.lastUpdateTime = gameState.worldElapsed;
  mem.uncertaintyRadius = lerp(2.5, 10, 1 - mem.certainty);
  mem.wasVisible = false;
  owner.lastKnownPos.copy(pos);
  owner.hasLastKnown = true;
  return mem;
}

function applyCalloutToAlly(ally: TDMAgent, enemy: TDMAgent, callout: TeamCallout): void {
  if (!ally.teamCallout) ally.teamCallout = new YUKA.Vector3();
  ally.teamCallout.copy(callout.pos);
  ally.teamCalloutTime = callout.createdAt;
  ally.teamCalloutCertainty = callout.certainty;
  ally.activeCallout = callout;
  ally.alertLevel = Math.min(100, ally.alertLevel + 10 + callout.certainty * 20);
  ally.investigatePos = callout.pos.clone();
  injectMemory(ally, enemy, callout.pos, callout.certainty * ally.calloutTrust, 'callout');
}

export function broadcastEnemyPosition(spotter: TDMAgent, enemy: TDMAgent): void {
  const mem = getEnemyMemory(spotter, enemy);
  if (!mem || mem.certainty < 0.46) return;
  if (gameState.worldElapsed - spotter.teamCalloutTime < 0.55 + (1 - spotter.communicationAccuracy) * 0.45) return;

  const distToEnemy = spotter.position.distanceTo(enemy.position);
  const calloutRange = 36;
  const baseError = lerp(1.2, 6.5, 1 - mem.certainty) + distToEnemy * (1 - spotter.communicationAccuracy) * 0.03;
  const noisyPos = new YUKA.Vector3(
    enemy.position.x + (Math.random() - 0.5) * baseError,
    0,
    enemy.position.z + (Math.random() - 0.5) * baseError,
  );

  const certainty = clamp01(mem.certainty * spotter.communicationAccuracy * (0.8 + Math.random() * 0.18));
  const callout: TeamCallout = {
    enemyId: getAgentId(enemy),
    enemyName: enemy.name,
    pos: noisyPos,
    certainty,
    createdAt: gameState.worldElapsed,
    source: 'callout',
  };

  for (const ally of gameState.agents) {
    if (ally === spotter || ally === gameState.player || ally.isDead) continue;
    if (ally.team !== spotter.team) continue;
    if (ally.position.distanceTo(spotter.position) > calloutRange) continue;
    if (Math.random() > 0.75 + ally.calloutTrust * 0.2) continue;
    applyCalloutToAlly(ally, enemy, callout);
  }

  spotter.teamCalloutTime = gameState.worldElapsed;
  pushEnemyKnowledge(spotter.team, noisyPos, certainty);
}

export function checkAudioAwareness(ag: TDMAgent): void {
  if (ag.isDead) return;

  const timeSinceDmg = gameState.worldElapsed - ag.lastDamageTime;
  if (timeSinceDmg < 0.7 && ag.lastAttacker && !ag.lastAttacker.isDead) {
    const attackerPos = ag.lastAttacker.position.clone();
    const certainty = clamp01(0.5 + (0.7 - timeSinceDmg) * 0.35);
    injectMemory(ag, ag.lastAttacker, attackerPos, certainty, 'damage');
    ag.alertLevel = Math.min(100, ag.alertLevel + 28);
    ag.stress = Math.min(100, ag.stress + 8);
    return;
  }

  const hearRange = 26 + ag.curiosity * 6;
  for (const bullet of gameState.bullets) {
    if (bullet.ownerTeam === ag.team) continue;
    const bx = bullet.mesh.position.x;
    const bz = bullet.mesh.position.z;
    const dx = ag.position.x - bx;
    const dz = ag.position.z - bz;
    const distSq = dx * dx + dz * dz;
    if (distSq > hearRange * hearRange) continue;

    const dist = Math.sqrt(distSq);
    const certainty = clamp01(0.18 + (1 - dist / hearRange) * 0.42 + ag.curiosity * 0.08);
    const noisyPos = new YUKA.Vector3(
      bx + (Math.random() - 0.5) * (4 + dist * 0.08),
      0,
      bz + (Math.random() - 0.5) * (4 + dist * 0.08),
    );

    const heardEnemy = gameState.agents.find((other) => other.team !== ag.team && !other.isDead && other.position.distanceTo(noisyPos) < 12);
    if (heardEnemy) {
      injectMemory(ag, heardEnemy, noisyPos, certainty, 'audio');
    } else if (!ag.hasLastKnown) {
      ag.lastKnownPos.copy(noisyPos);
      ag.hasLastKnown = true;
    }

    ag.alertLevel = Math.min(100, ag.alertLevel + 6 + certainty * 10);
    break;
  }
}

export function decayPerception(ag: TDMAgent, dt: number): void {
  for (const [id, mem] of ag.enemyMemories) {
    const age = gameState.worldElapsed - mem.lastUpdateTime;
    const decay = mem.wasVisible ? 0.04 : mem.source === 'callout' ? 0.085 : 0.07;
    mem.certainty = clamp01(mem.certainty - dt * decay - Math.max(0, age - 1.5) * dt * 0.01);
    mem.visibility = clamp01(mem.visibility - dt * 0.2);
    mem.uncertaintyRadius = Math.min(18, mem.uncertaintyRadius + dt * (mem.source === 'audio' ? 2.6 : 1.8));
    mem.predictedPos.add(mem.lastVelocity.clone().multiplyScalar(dt * 0.75));
    mem.wasVisible = false;

    if (mem.certainty <= 0.02 || age > 12) {
      ag.enemyMemories.delete(id);
    }
  }

  if (ag.teamCallout && gameState.worldElapsed - ag.teamCalloutTime > 5) {
    ag.teamCallout = null;
    ag.teamCalloutCertainty = 0;
    ag.activeCallout = null;
  }
}

function scoreTarget(ag: TDMAgent, target: TDMAgent, mem: EnemyMemory | null, dist: number, visible: boolean): number {
  let score = 0;

  const hpRatio = target.hp / target.maxHP;
  const rangeDiff = Math.abs(dist - ag.preferredRange);
  score -= rangeDiff * 0.35;
  score += visible ? 20 : 0;
  score += mem ? mem.certainty * 35 + mem.visibility * 20 + mem.threat * 18 : 0;
  if (hpRatio < 0.3) score += 16;
  else if (hpRatio < 0.55) score += 8;
  if (target === ag.lastAttacker) score += 15;
  if (target.botClass === 'sniper') score += 10;
  if (ag.currentTarget === target) score += 18 + ag.trackingTime * 4;
  if (dist < 8) score += 10;
  if (!visible) score -= (1 - (mem?.certainty ?? 0)) * 16;
  score += ag.discipline * 4;
  score -= ag.stress * 0.05;

  return score;
}

export function updatePerception(ag: TDMAgent, dt: number): void {
  decayPerception(ag, dt);
  checkAudioAwareness(ag);

  for (const other of gameState.agents) {
    if (other === ag || other.isDead || other.team === ag.team) continue;
    if (getVisibilityScore(ag, other) >= 0.26) {
      updateVisualMemory(ag, other, dt);
    }
  }

  // Keep a softer investigate position from the strongest stale memory.
  const bestMemory = getStrongestMemory(ag);
  if (bestMemory && bestMemory.certainty > 0.18) {
    ag.investigatePos = bestMemory.predictedPos.clone();
    ag.lastKnownPos.copy(bestMemory.predictedPos);
    ag.hasLastKnown = true;
  } else if (ag.teamCallout) {
    ag.investigatePos = ag.teamCallout.clone();
  } else if (!ag.currentTarget) {
    ag.investigatePos = null;
  }
}

export function getStrongestMemory(ag: TDMAgent): EnemyMemory | null {
  let best: EnemyMemory | null = null;
  let bestScore = -Infinity;
  for (const mem of ag.enemyMemories.values()) {
    const age = gameState.worldElapsed - mem.lastUpdateTime;
    const score = mem.certainty * 2.2 + mem.threat * 1.5 + mem.visibility * 0.75 - age * 0.06;
    if (score > bestScore) {
      bestScore = score;
      best = mem;
    }
  }
  return best;
}

export function getInvestigationPosition(ag: TDMAgent): YUKA.Vector3 | null {
  if (ag.investigatePos) return ag.investigatePos.clone();
  if (ag.teamCallout) return ag.teamCallout.clone();
  const mem = getStrongestMemory(ag);
  return mem ? mem.predictedPos.clone() : null;
}

export function findBestTarget(ag: TDMAgent): { target: TDMAgent | null; dist: number; visible: boolean; certainty: number } {
  let bestTarget: TDMAgent | null = null;
  let bestScore = -Infinity;
  let bestDist = Infinity;
  let bestVisible = false;
  let bestCertainty = 0;

  for (const other of gameState.agents) {
    if (other === ag || other.team === ag.team || other.isDead) continue;

    const visibility = getVisibilityScore(ag, other);
    const visible = visibility >= 0.52;
    const mem = ag.enemyMemories.get(getAgentId(other)) ?? null;

    if (!visible && (!mem || mem.certainty < 0.12)) continue;

    const refPos = visible ? other.position : (mem?.predictedPos ?? other.position);
    const dist = ag.position.distanceTo(refPos);
    const score = scoreTarget(ag, other, mem, dist, visible);

    if (score > bestScore) {
      bestScore = score;
      bestTarget = other;
      bestDist = dist;
      bestVisible = visible;
      bestCertainty = visible ? Math.max(visibility, mem?.certainty ?? 0) : (mem?.certainty ?? 0);
    }
  }

  return { target: bestTarget, dist: bestDist, visible: bestVisible, certainty: bestCertainty };
}

export function getPredictedAimPoint(ag: TDMAgent, target: TDMAgent): YUKA.Vector3 {
  const mem = getEnemyMemory(ag, target);
  if (!mem) return target.position.clone();

  const targetVisible = canSee(ag, target);
  if (targetVisible) return mem.predictedPos.clone();

  const blend = clamp01(mem.certainty * 0.8 + 0.15);
  return new YUKA.Vector3(
    mem.predictedPos.x * blend + mem.lastSeenPos.x * (1 - blend),
    mem.predictedPos.y * blend + mem.lastSeenPos.y * (1 - blend),
    mem.predictedPos.z * blend + mem.lastSeenPos.z * (1 - blend),
  );
}

export function countNearbyAllies(ag: TDMAgent, range: number): number {
  let count = 0;
  for (const ally of gameState.agents) {
    if (ally === ag || ally.isDead || ally.team !== ag.team) continue;
    if (ag.position.distanceTo(ally.position) < range) count++;
  }
  return count;
}
