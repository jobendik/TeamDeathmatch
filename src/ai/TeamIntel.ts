import * as YUKA from 'yuka';
import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import type { TDMAgent } from '@/entities/TDMAgent';
import { TEAM_BLUE, TEAM_RED, type TeamId } from '@/config/constants';
import { playBotCallout } from '@/audio/SoundHooks';

/**
 * A pending callout — a spotter saw an enemy and will tell the team
 * after their personal callout delay elapses. Arrives with positional
 * noise proportional to (1 - reliability).
 */
interface PendingCallout {
  team: TeamId;
  spotter: TDMAgent;
  enemyName: string;
  enemyId: TDMAgent;
  reportedPos: YUKA.Vector3; // noisy position
  reportedAtTime: number;     // when message fires
  createdAt: number;          // when it was queued
  certainty: number;          // inherited + degraded
}

const pending: PendingCallout[] = [];

// Spotter debounce — once a bot calls out an enemy, they wait before repeating
const lastCalloutForPair = new Map<string, number>(); // key = spotterName:enemyName

function pairKey(spotter: TDMAgent, enemy: TDMAgent): string {
  return `${spotter.name}:${enemy.name}`;
}

/**
 * Called by Perception when a bot sees an enemy.
 * Queues a callout that will be delivered after a delay, with positional noise.
 */
export function queueCallout(spotter: TDMAgent, enemy: TDMAgent): void {
  if (!spotter.personality) return;
  const p = spotter.personality;

  // Debounce — same spotter won't spam about the same enemy
  const key = pairKey(spotter, enemy);
  const last = lastCalloutForPair.get(key) ?? -999;
  const now = gameState.worldElapsed;
  if (now - last < 3 + Math.random() * 2) return;
  lastCalloutForPair.set(key, now);

  // Positional noise based on reliability + distance to enemy
  const distToEnemy = spotter.position.distanceTo(enemy.position);
  const distNoise = Math.min(4, distToEnemy * 0.06);
  const reliabilityNoise = (1 - p.calloutReliability) * 6;
  const noise = reliabilityNoise + distNoise;

  const reportedPos = new YUKA.Vector3(
    enemy.position.x + (Math.random() - 0.5) * noise,
    0,
    enemy.position.z + (Math.random() - 0.5) * noise,
  );

  // Certainty degrades with reliability
  const certainty = 0.4 + p.calloutReliability * 0.5;

  // Skill → slightly faster callout
  const skillSpeedup = (p.skill - 0.5) * 0.15;
  const delay = Math.max(0.15, p.calloutDelay - skillSpeedup + Math.random() * 0.15);

  pending.push({
    team: spotter.team,
    spotter,
    enemyName: enemy.name,
    enemyId: enemy,
    reportedPos,
    reportedAtTime: now + delay,
    createdAt: now,
    certainty,
  });
}

/**
 * Each frame, deliver any callouts whose delay has elapsed to teammates.
 * Teammates farther from the spotter receive degraded info (range falloff).
 */
export function deliverPendingCallouts(): void {
  const now = gameState.worldElapsed;
  for (let i = pending.length - 1; i >= 0; i--) {
    const c = pending[i];
    if (now < c.reportedAtTime) continue;
    let playedSpottedCallout = false;

    // Dead spotter → callout doesn't go through (they died mid-call)
    if (c.spotter.isDead) {
      pending.splice(i, 1);
      continue;
    }
    // Dead enemy → stale info, skip
    if (c.enemyId.isDead) {
      pending.splice(i, 1);
      continue;
    }

    // Deliver to teammates within comms range
    const commsRange = 45;
    for (const ally of gameState.agents) {
      if (ally === c.spotter) continue;
      if (ally.isDead) continue;
      if (gameState.mode === 'ffa') continue; // no teams in FFA
      if (ally.team !== c.team) continue;

      const distToSpotter = ally.position.distanceTo(c.spotter.position);
      if (distToSpotter > commsRange) continue;

      // Farther listeners get degraded info (simulates sparse voice comms)
      const rangeFactor = 1 - Math.min(1, distToSpotter / commsRange);
      const effectiveCertainty = c.certainty * (0.5 + rangeFactor * 0.5);

      // Receiver only updates if this info is better than what they already have
      const existing = ally.enemyMemory.get(c.enemyName);
      if (existing && existing.confidence > effectiveCertainty + 0.1) continue;

      if (!ally.teamCallout) ally.teamCallout = new YUKA.Vector3();
      ally.teamCallout.copy(c.reportedPos);
      ally.teamCalloutTime = now;

      if (!playedSpottedCallout && ally !== gameState.player) {
        const distToPlayer = ally.position.distanceTo(gameState.player.position);
        if (distToPlayer < 30 && Math.random() < 0.4) {
          const pitchBase = ally.personality ? 0.85 + ally.personality.aggressionBias * 0.3 : 1;
          playBotCallout('spotted', new THREE.Vector3(ally.position.x, 1.6, ally.position.z), pitchBase);
          playedSpottedCallout = true;
        }
      }

      // Alert bump — bigger for tunnel-visioned personalities receiving fresh info
      const alertBump = 18 + (1 - (ally.personality?.tunnelVision ?? 0.5)) * 12;
      ally.alertLevel = Math.min(100, ally.alertLevel + alertBump);

      // Seed memory (imperfectly)
      ally.enemyMemory.set(c.enemyName, {
        lastSeenPos: c.reportedPos.clone(),
        lastSeenTime: now,
        source: 'callout',
        confidence: effectiveCertainty,
        threat: existing?.threat ?? 50,
        wasMoving: true,
        lastVelocity: new YUKA.Vector3(),
      });
    }

    pending.splice(i, 1);
  }
}

/**
 * Clear all pending callouts (e.g. on match reset).
 */
export function clearTeamIntel(): void {
  pending.length = 0;
  lastCalloutForPair.clear();
}
