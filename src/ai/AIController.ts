import * as THREE from 'three';
import * as YUKA from 'yuka';
import { gameState } from '@/core/GameState';
import { TEAM_BLUE } from '@/config/constants';
import type { TDMAgent } from '@/entities/TDMAgent';
import { findBestTarget, canSee, broadcastEnemyPosition, checkAudioAwareness, countNearbyAllies, updateEnemyMemory, decayEnemyMemory } from './Perception';
import { evalFuzzy } from './FuzzyLogic';
import { findCoverFrom, pushOutOfWall } from './CoverSystem';
import { hitscanShot, shotgunBlast, spawnRocket } from '@/combat/Hitscan';
import { spawnMuzzleFlash } from '@/combat/Particles';
import { spawnGrenade } from '@/combat/Hitscan';
import { keepInside } from '@/entities/Player';
import { WEAPONS } from '@/config/weapons';

// ── Cached temporaries for hot-loop use ──
const _shootOrigin = new THREE.Vector3();
const _shootTarget = new THREE.Vector3();
const _shootDir = new THREE.Vector3();
const _muzzlePos = new THREE.Vector3();
const _suppressDir = new THREE.Vector3();
const _suppressOrigin = new THREE.Vector3();
const _suppressMuzzle = new THREE.Vector3();

// ═══════════════════════════════════════════
//  AIM SYSTEM — human-like tracking & leading
// ═══════════════════════════════════════════

function getEffectiveAimError(ag: TDMAgent, target: TDMAgent, dist: number): number {
  let error = ag.aimError;

  // Tracking bonus: accuracy improves over time
  const trackBonus = Math.min(ag.trackingTime * 0.6, 0.7);
  error *= (1 - trackBonus);

  // Distance penalty
  if (dist > 25) error *= 1 + (dist - 25) * 0.015;

  // Confidence bonus
  if (ag.confidence > 70) error *= 0.8;
  else if (ag.confidence < 30) error *= 1.2;

  // Under-fire penalty — scales with pressure intensity
  if (ag.pressureLevel > 0.3) {
    error *= 1.0 + ag.pressureLevel * 0.6; // up to 1.6x at max pressure
  }

  // Moving penalty
  if (ag.stateName === 'ENGAGE' || ag.stateName === 'TEAM_PUSH') error *= 1.1;

  return error;
}

/**
 * AI shooting — uses hitscan like the player for instant-hit combat.
 * Unarmed bots cannot fire.
 */
function aiShoot(ag: TDMAgent, target: TDMAgent): void {
  if (ag.isDead || !target || target.isDead) return;
  if (ag.weaponId === 'unarmed') return; // cannot shoot without a weapon

  _shootOrigin.set(ag.position.x, 0.9, ag.position.z);
  _shootTarget.set(target.position.x, 1.0, target.position.z);

  _shootDir.subVectors(_shootTarget, _shootOrigin).normalize();
  const dist = _shootOrigin.distanceTo(_shootTarget);

  // Apply effective aim error
  const err = getEffectiveAimError(ag, target, dist);
  _shootDir.x += (Math.random() - 0.5) * err;
  _shootDir.y += (Math.random() - 0.5) * err * 0.4;
  _shootDir.z += (Math.random() - 0.5) * err;
  _shootDir.normalize();

  const col = ag.team === TEAM_BLUE ? 0x60a5fa : 0xff6644;

  _muzzlePos.set(ag.position.x + _shootDir.x * 0.6, 1.0, ag.position.z + _shootDir.z * 0.6);
  spawnMuzzleFlash(_muzzlePos.clone(), col);

  if (ag.weaponId === 'shotgun') {
    shotgunBlast(_shootOrigin.clone(), _shootDir.clone(), 'ai', ag.team, col, ag);
  } else if (ag.weaponId === 'rocket_launcher') {
    spawnRocket(_shootOrigin.clone(), _shootDir.clone(), 'ai', ag.team, col, ag);
  } else {
    hitscanShot(_shootOrigin.clone(), _shootDir.clone(), 'ai', ag.team, ag.weaponId, col, ag);
  }
  ag.ammo--;
}

// ═══════════════════════════════════════════
//  COMBAT STRAFING
// ═══════════════════════════════════════════

function updateStrafing(ag: TDMAgent, dt: number): void {
  ag.strafeTimer -= dt;
  if (ag.strafeTimer <= 0) {
    if (ag.botClass === 'flanker') {
      ag.strafeDir *= -1;
      ag.strafeTimer = 0.15 + Math.random() * 0.3;
    } else if (ag.botClass === 'assault') {
      if (Math.random() < 0.7) ag.strafeDir *= -1;
      ag.strafeTimer = 0.2 + Math.random() * 0.4;
    } else if (ag.botClass === 'sniper') {
      if (Math.random() < 0.5) ag.strafeDir *= -1;
      ag.strafeTimer = 0.6 + Math.random() * 1.0;
    } else {
      if (Math.random() < 0.6) ag.strafeDir *= -1;
      ag.strafeTimer = 0.25 + Math.random() * 0.6;
    }
  }
}

// ═══════════════════════════════════════════
//  DAMAGE PRESSURE — now materially affects behavior
// ═══════════════════════════════════════════

function updateDamagePressure(ag: TDMAgent, dt: number): void {
  const timeSinceDamage = gameState.worldElapsed - ag.lastDamageTime;

  // Immediate dodge: if just hit, impulse strafe
  if (timeSinceDamage < 0.3) {
    ag.strafeDir *= -1;
    ag.strafeTimer = 0.4;
  }

  // Calculate pressure level (0-1)
  const recentDamageRatio = ag.recentDamage / ag.maxHP;
  const recency = Math.max(0, 1 - timeSinceDamage / 3);
  ag.pressureLevel = Math.min(1, recentDamageRatio * recency * 2);
  ag.underPressure = ag.pressureLevel > 0.25;

  // Pressure materially affects behavior:
  // 1. Fire discipline: under pressure, bots pause shooting more
  if (ag.pressureLevel > 0.5 && ag.shootTimer < 0.1) {
    ag.shootTimer += ag.pressureLevel * 0.08; // slight delay under fire
  }

  // 2. Aggression suppression: reduce fuzzy aggression under pressure
  if (ag.underPressure) {
    ag.fuzzyAggr = Math.max(0, ag.fuzzyAggr - ag.pressureLevel * 25);
  }

  // Decay recent damage over time
  ag.recentDamage = Math.max(0, ag.recentDamage - dt * 20);
}

// ═══════════════════════════════════════════
//  AI GRENADE THROWING
// ═══════════════════════════════════════════

function tryThrowGrenade(ag: TDMAgent, target: TDMAgent, dist: number): boolean {
  if (ag.grenades <= 0 || ag.grenadeCooldown > 0) return false;
  if (dist < 5 || dist > 30) return false;

  const shouldThrow =
    (dist > 10 && dist < 25 && ag.stateName === 'COVER') ||
    (ag.nearbyAllies >= 2 && ag.confidence > 50) ||
    (ag.stateName === 'ENGAGE' && dist > 12 && Math.random() < 0.02);

  if (!shouldThrow) return false;

  const o = new THREE.Vector3(ag.position.x, 1.2, ag.position.z);
  const tPos = new THREE.Vector3(target.position.x, 0, target.position.z);
  const d = tPos.clone().sub(o).normalize();
  d.x += (Math.random() - 0.5) * 0.15;
  d.z += (Math.random() - 0.5) * 0.15;
  d.normalize();

  spawnGrenade(o, d, 'ai', ag.team, ag);
  ag.grenades--;
  ag.grenadeCooldown = 8 + Math.random() * 4;
  return true;
}

// ═══════════════════════════════════════════
//  MAIN AI UPDATE
// ═══════════════════════════════════════════

export function updateAI(ag: TDMAgent, dt: number): void {
  if (ag === gameState.player || ag.isDead) return;

  // ── Update timers ──
  ag.stateTime += dt;
  updateStrafing(ag, dt);
  updateDamagePressure(ag, dt);
  decayEnemyMemory(ag, dt);

  if (gameState.pDead && ag.currentTarget === gameState.player) {
    ag.currentTarget = null;
    ag.hasTarget = false;
    ag.trackingTime = 0;
    ag.burstCount = 0;
  }

  // ── Stuck detection ──
  const movedDist = ag.position.distanceTo(ag.lastStuckCheckPos);
  if (movedDist < 0.15) {
    ag.stuckTime += dt;
  } else {
    ag.stuckTime = 0;
  }
  if (Math.random() < 0.1) {
    ag.lastStuckCheckPos.copy(ag.position);
  }
  if (ag.stuckTime > 0.8) {
    ag.stuckTime = 0;
    ag.hasLastKnown = false;
    ag.currentCover = null;
    ag.seekingPickup = false;
    ag.seekPickupPos = null;
    const pushed = pushOutOfWall(ag.position.x, ag.position.z);
    if (ag.seekB) {
      (ag.seekB as any).target.set(pushed.x + (Math.random() - 0.5) * 4, 0, pushed.z + (Math.random() - 0.5) * 4);
      ag.seekB.weight = 2;
    }
    ag.stateName = 'PATROL';
    ag.brain.clearSubgoals();
    ag.brain.arbitrate();
  }

  // ── Grenade cooldown ──
  if (ag.grenadeCooldown > 0) ag.grenadeCooldown -= dt;

  // ── Audio awareness ──
  checkAudioAwareness(ag);

  // ── Periodically count nearby allies ──
  ag.allyCheckTimer -= dt;
  if (ag.allyCheckTimer <= 0) {
    ag.allyCheckTimer = 0.8 + Math.random() * 0.4;
    ag.nearbyAllies = countNearbyAllies(ag, 20);
  }

  // ── Find target ──
  const { target, dist } = findBestTarget(ag);
  const hadTarget = ag.hasTarget;

  if (target) {
    const prevTarget = ag.currentTarget;
    ag.currentTarget = target;
    ag.lastKnownPos.copy(target.position);
    ag.hasLastKnown = true;
    ag.alertLevel = Math.min(100, ag.alertLevel + dt * 30);

    // Update tactical memory
    updateEnemyMemory(ag, target, 'visual');

    // Broadcast to teammates
    broadcastEnemyPosition(ag, target);

    // Track target
    if (hadTarget && prevTarget === target) ag.trackingTime += dt;
    else ag.trackingTime = 0;

    // Reaction delay on first sight
    if (!hadTarget) {
      ag.reactionTimer = ag.reactionTime * (0.7 + Math.random() * 0.6);
      ag.hasTarget = true;
    }
    ag.reactionTimer = Math.max(0, ag.reactionTimer - dt);

    // Set pursuit target
    if (ag.pursuitB && target) {
      (ag.pursuitB as any).evader = target;
    }

    // Evaluate fuzzy aggression
    evalFuzzy(ag, dist);

    const canReact = ag.reactionTimer <= 0;

    // Under heavy pressure: seek cover more aggressively
    if (ag.underPressure && ag.hp < ag.maxHP * 0.55) {
      ag.currentCover = ag.currentTarget ? findCoverFrom(ag, ag.currentTarget.position) : ag.currentCover;
    }

    // ══════════════════════════════════
    //  DECISION MAKING (the brain)
    // ══════════════════════════════════
    ag.decisionTimer -= dt;
    if (ag.decisionTimer <= 0) {
      // Under pressure: re-evaluate faster
      const decisionInterval = ag.underPressure ? 0.1 + Math.random() * 0.1 : 0.15 + Math.random() * 0.2;
      ag.decisionTimer = decisionInterval;

      // Score pressure: more aggressive when losing, more cautious when ahead
      const myTeamScore = gameState.teamScores[ag.team];
      const enemyTeamScore = gameState.teamScores[ag.team === TEAM_BLUE ? 1 : 0];
      const scoreDiff = myTeamScore - enemyTeamScore;
      if (scoreDiff < -3) ag.fuzzyAggr = Math.min(100, ag.fuzzyAggr + 15);
      if (scoreDiff > 5 && ag.hp / ag.maxHP < 0.5) ag.fuzzyAggr = Math.max(0, ag.fuzzyAggr - 10);

      ag.brain.arbitrate();
    }

    // ══════════════════════════════════
    //  SHOOTING (only if armed)
    // ══════════════════════════════════
    if (ag.weaponId === 'unarmed') {
      // Unarmed: don't try to shoot, just seek weapons
    } else if (canReact && canSee(ag, target)) {
      // Try grenades
      if (dist > 10 && ag.grenadeCooldown <= 0 && ag.grenades > 0) {
        tryThrowGrenade(ag, target, dist);
      }

      if (ag.isReloading) {
        ag.reloadTimer -= dt;
        if (ag.reloadTimer <= 0) {
          ag.isReloading = false;
          ag.ammo = ag.magSize;
        }
      } else if (ag.ammo <= 0) {
        ag.isReloading = true;
        ag.reloadTimer = ag.reloadTime;
        if (ag.stateName !== 'COVER' && ag.stateName !== 'RETREAT') {
          const cover = findCoverFrom(ag, target.position);
          if (cover) ag.currentCover = cover;
        }
      } else {
        // Fire discipline under pressure: occasionally skip shots
        const pressureSkip = ag.pressureLevel > 0.6 && Math.random() < ag.pressureLevel * 0.3;
        if (!pressureSkip) {
          ag.shootTimer -= dt;
          if (ag.shootTimer <= 0) {
            if (ag.burstCount < ag.burstSize) {
              ag.burstTimer -= dt;
              if (ag.burstTimer <= 0) {
                aiShoot(ag, target);
                ag.burstCount++;
                ag.burstTimer = ag.burstDelay;
              }
            } else {
              ag.burstCount = 0;
              ag.shootTimer = ag.fireRate + Math.random() * 0.12;
            }
          }
        }
      }
    } else if (canReact && ag.hasLastKnown && ag.alertLevel > 60 && !ag.isReloading && ag.ammo > 3) {
      // ── Suppressive fire (reduced under pressure) ──
      if (!ag.underPressure || Math.random() < 0.15) {
        const timeSinceTarget = ag.stateTime;
        if (timeSinceTarget < 1.5 && Math.random() < 0.3) {
          ag.shootTimer -= dt;
          if (ag.shootTimer <= 0) {
            _suppressDir.set(
              ag.lastKnownPos.x - ag.position.x,
              0,
              ag.lastKnownPos.z - ag.position.z,
            ).normalize();
            _suppressDir.x += (Math.random() - 0.5) * 0.15;
            _suppressDir.z += (Math.random() - 0.5) * 0.15;
            _suppressDir.normalize();

            _suppressOrigin.set(ag.position.x, 0.9, ag.position.z);
            const col = ag.team === TEAM_BLUE ? 0x60a5fa : 0xff6644;
            _suppressMuzzle.set(ag.position.x + _suppressDir.x * 0.6, 1.0, ag.position.z + _suppressDir.z * 0.6);
            spawnMuzzleFlash(_suppressMuzzle.clone(), col);
            hitscanShot(_suppressOrigin.clone(), _suppressDir.clone(), 'ai', ag.team, ag.weaponId, col, ag);
            ag.ammo--;
            ag.shootTimer = ag.fireRate * 1.5;
          }
        }
      }
    }
  } else {
    // ══════════════════════════════════
    //  NO TARGET VISIBLE
    // ══════════════════════════════════
    ag.hasTarget = false;
    ag.currentTarget = null;
    ag.trackingTime = 0;
    ag.alertLevel = Math.max(0, ag.alertLevel - dt * 15);

    const timeSinceDmg = gameState.worldElapsed - ag.lastDamageTime;
    if (timeSinceDmg < 1.5 && ag.lastAttacker && !ag.lastAttacker.isDead) {
      ag.lastKnownPos.copy(ag.lastAttacker.position);
      ag.hasLastKnown = true;
      ag.alertLevel = 80;
    }

    // Use tactical memory: investigate highest-confidence remembered enemy
    if (!ag.hasLastKnown) {
      let bestMemConf = 0;
      let bestMemPos: YUKA.Vector3 | null = null;
      for (const [, entry] of ag.enemyMemory) {
        if (entry.confidence > bestMemConf && entry.confidence > 0.2) {
          bestMemConf = entry.confidence;
          bestMemPos = entry.lastSeenPos;
        }
      }
      if (bestMemPos) {
        ag.lastKnownPos.copy(bestMemPos);
        ag.hasLastKnown = true;
        ag.alertLevel = Math.max(ag.alertLevel, 40);
      }
    }

    ag.decisionTimer -= dt;
    if (ag.decisionTimer <= 0) {
      ag.decisionTimer = 0.3 + Math.random() * 0.3;
      ag.brain.arbitrate();
    }
  }

  // ── Execute the goal-driven brain ──
  ag.brain.execute();

  // ── Regen when near spawn ──
  if (ag.position.distanceTo(ag.spawnPos) < 8) {
    ag.hp = Math.min(ag.maxHP, ag.hp + dt * 15);
  }

  // ── Keep inside arena ──
  keepInside(ag);
}
