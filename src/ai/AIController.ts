import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { TEAM_BLUE } from '@/config/constants';
import type { TDMAgent } from '@/entities/TDMAgent';
import { findBestTarget, canSee, broadcastEnemyPosition, checkAudioAwareness, countNearbyAllies } from './Perception';
import { evalFuzzy } from './FuzzyLogic';
import { findCoverFrom, pushOutOfWall } from './CoverSystem';
import { hitscanShot, shotgunBlast, spawnRocket } from '@/combat/Hitscan';
import { spawnMuzzleFlash } from '@/combat/Particles';
import { spawnGrenade } from '@/combat/Hitscan';
import { keepInside } from '@/entities/Player';

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

  // Under-fire penalty
  const timeSinceDamage = gameState.worldElapsed - ag.lastDamageTime;
  if (timeSinceDamage < 1.5) error *= 1.4;

  // Moving penalty (slight)
  if (ag.stateName === 'ENGAGE' || ag.stateName === 'TEAM_PUSH') error *= 1.1;

  return error;
}

/**
 * AI shooting — uses hitscan like the player for instant-hit combat.
 */
function aiShoot(ag: TDMAgent, target: TDMAgent): void {
  if (ag.isDead || !target || target.isDead) return;

  const o = new THREE.Vector3(ag.position.x, 0.9, ag.position.z);
  const tPos = new THREE.Vector3(target.position.x, 1.0, target.position.z);

  const d = tPos.clone().sub(o).normalize();
  const dist = o.distanceTo(tPos);

  // Apply effective aim error
  const err = getEffectiveAimError(ag, target, dist);
  d.x += (Math.random() - 0.5) * err;
  d.y += (Math.random() - 0.5) * err * 0.4;
  d.z += (Math.random() - 0.5) * err;
  d.normalize();

  const col = ag.team === TEAM_BLUE ? 0x60a5fa : 0xff6644;

  // Muzzle flash on the agent's model
  const muzzlePos = new THREE.Vector3(ag.position.x + d.x * 0.6, 1.0, ag.position.z + d.z * 0.6);
  spawnMuzzleFlash(muzzlePos, col);

  // Use the actual weapon's hitscan system
  if (ag.weaponId === 'shotgun') {
    shotgunBlast(o, d, 'ai', ag.team, col);
  } else if (ag.weaponId === 'rocket_launcher') {
    spawnRocket(o, d, 'ai', ag.team, col);
  } else {
    hitscanShot(o, d, 'ai', ag.team, ag.weaponId, col);
  }
  ag.ammo--;
}

// ═══════════════════════════════════════════
//  COMBAT STRAFING — more dynamic & unpredictable
// ═══════════════════════════════════════════

function updateStrafing(ag: TDMAgent, dt: number): void {
  ag.strafeTimer -= dt;
  if (ag.strafeTimer <= 0) {
    // Class-specific strafe patterns
    if (ag.botClass === 'flanker') {
      // Flankers change direction very often, highly unpredictable
      ag.strafeDir *= -1;
      ag.strafeTimer = 0.15 + Math.random() * 0.3;
    } else if (ag.botClass === 'assault') {
      // Assault alternates quickly, aggressive side-stepping
      if (Math.random() < 0.7) ag.strafeDir *= -1;
      ag.strafeTimer = 0.2 + Math.random() * 0.4;
    } else if (ag.botClass === 'sniper') {
      // Snipers strafe slowly, methodical repositioning
      if (Math.random() < 0.5) ag.strafeDir *= -1;
      ag.strafeTimer = 0.6 + Math.random() * 1.0;
    } else {
      // Riflemen — balanced
      if (Math.random() < 0.6) ag.strafeDir *= -1;
      ag.strafeTimer = 0.25 + Math.random() * 0.6;
    }
  }
}

// ═══════════════════════════════════════════
//  DAMAGE REACTION
// ═══════════════════════════════════════════

function handleDamageReaction(ag: TDMAgent, dt: number): boolean {
  const timeSinceDamage = gameState.worldElapsed - ag.lastDamageTime;

  // Immediate dodge: if just hit, impulse strafe
  if (timeSinceDamage < 0.3) {
    ag.strafeDir *= -1; // immediately flip strafe
    ag.strafeTimer = 0.4;
    return true;
  }

  // Under heavy pressure: retreat if taking lots of damage
  if (ag.recentDamage > ag.maxHP * 0.4 && timeSinceDamage < 2) {
    return true; // signal to consider retreating
  }

  // Decay recent damage over time
  ag.recentDamage = Math.max(0, ag.recentDamage - dt * 20);

  return false;
}

// ═══════════════════════════════════════════
//  AI GRENADE THROWING
// ═══════════════════════════════════════════

function tryThrowGrenade(ag: TDMAgent, target: TDMAgent, dist: number): boolean {
  if (ag.grenades <= 0 || ag.grenadeCooldown > 0) return false;
  if (dist < 5 || dist > 30) return false; // too close (self-damage) or too far

  // Only throw when multiple enemies cluster or target is behind cover
  const shouldThrow =
    (dist > 10 && dist < 25 && ag.stateName === 'COVER') ||  // flush someone from cover
    (ag.nearbyAllies >= 2 && ag.confidence > 50) ||           // confident team push
    (ag.stateName === 'ENGAGE' && dist > 12 && Math.random() < 0.02); // occasional surprise

  if (!shouldThrow) return false;

  const o = new THREE.Vector3(ag.position.x, 1.2, ag.position.z);
  const tPos = new THREE.Vector3(target.position.x, 0, target.position.z);
  const d = tPos.clone().sub(o).normalize();

  // Add some inaccuracy
  d.x += (Math.random() - 0.5) * 0.15;
  d.z += (Math.random() - 0.5) * 0.15;
  d.normalize();

  spawnGrenade(o, d, 'ai', ag.team);
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
  const underPressure = handleDamageReaction(ag, dt);

  // ── Stuck detection ──
  // Check if agent has barely moved over the last ~0.5 seconds
  const movedDist = ag.position.distanceTo(ag.lastStuckCheckPos);
  if (movedDist < 0.15) {
    ag.stuckTime += dt;
  } else {
    ag.stuckTime = 0;
  }
  // Sample position every few frames
  if (Math.random() < 0.1) {
    ag.lastStuckCheckPos.copy(ag.position);
  }
  // If stuck for over 0.8s, break out
  if (ag.stuckTime > 0.8) {
    ag.stuckTime = 0;
    ag.hasLastKnown = false;
    ag.currentCover = null;
    ag.seekingPickup = false;
    ag.seekPickupPos = null;
    // Nudge away from nearest wall
    const pushed = pushOutOfWall(ag.position.x, ag.position.z);
    if (ag.seekB) {
      // Seek to a safe open position
      (ag.seekB as any).target.set(pushed.x + (Math.random() - 0.5) * 4, 0, pushed.z + (Math.random() - 0.5) * 4);
      ag.seekB.weight = 2;
    }
    ag.stateName = 'PATROL';
    // Force brain to re-evaluate
    ag.brain.clearSubgoals();
    ag.brain.arbitrate();
  }

  // ── Grenade cooldown ──
  if (ag.grenadeCooldown > 0) ag.grenadeCooldown -= dt;

  // ── Audio awareness — hear nearby gunfire ──
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
    ag.currentTarget = target;
    ag.lastKnownPos.copy(target.position);
    ag.hasLastKnown = true;
    ag.alertLevel = Math.min(100, ag.alertLevel + dt * 30);

    // Broadcast to teammates
    broadcastEnemyPosition(ag, target);

    // Track target — increases accuracy over time
    if (target === ag.currentTarget && hadTarget) {
      ag.trackingTime += dt;
    } else {
      ag.trackingTime = 0;
    }

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

    // ══════════════════════════════════
    //  DECISION MAKING (the brain)
    // ══════════════════════════════════
    ag.decisionTimer -= dt;
    if (ag.decisionTimer <= 0) {
      ag.decisionTimer = 0.15 + Math.random() * 0.2;

      const hpRatio = ag.hp / ag.maxHP;
      const ammoRatio = ag.ammo / ag.magSize;
      const lowHP = hpRatio < 0.3;
      const medHP = hpRatio < 0.55;
      const lowAmmo = ammoRatio < 0.2;
      const closeRange = dist < 10;
      const midRange = dist >= 10 && dist < 25;
      const longRange = dist >= 25;

      // Score awareness: more aggressive when losing, more cautious when ahead
      const myTeamScore = gameState.teamScores[ag.team];
      const enemyTeamScore = gameState.teamScores[ag.team === TEAM_BLUE ? 1 : 0];
      const scoreDiff = myTeamScore - enemyTeamScore;
      const losing = scoreDiff < -3;
      const winning = scoreDiff > 5;

      // Boost aggression when losing
      if (losing) ag.fuzzyAggr = Math.min(100, ag.fuzzyAggr + 15);
      if (winning && ag.hp / ag.maxHP < 0.5) ag.fuzzyAggr = Math.max(0, ag.fuzzyAggr - 10);

      // ══════════════════════════════════
      //  GOAL-DRIVEN DECISION (Think brain)
      // ══════════════════════════════════
      ag.decisionTimer -= dt;
      if (ag.decisionTimer <= 0) {
        ag.decisionTimer = 0.15 + Math.random() * 0.2;
        ag.brain.arbitrate();
      }
    }

    // ══════════════════════════════════
    //  SHOOTING
    // ══════════════════════════════════
    if (canReact && canSee(ag, target)) {
      // Try grenades in tactical situations
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
        // Set cover point — the brain will handle movement via ReloadEvaluator
        if (ag.stateName !== 'COVER' && ag.stateName !== 'RETREAT') {
          const cover = findCoverFrom(ag, target.position);
          if (cover) {
            ag.currentCover = cover;
          }
        }
      } else {
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
    } else if (canReact && ag.hasLastKnown && ag.alertLevel > 60 && !ag.isReloading && ag.ammo > 3) {
      // ── Suppressive fire: shoot at last known position briefly ──
      const timeSinceTarget = ag.stateTime;
      if (timeSinceTarget < 1.5 && Math.random() < 0.3) {
        ag.shootTimer -= dt;
        if (ag.shootTimer <= 0) {
          const suppressDir = new THREE.Vector3(
            ag.lastKnownPos.x - ag.position.x,
            0,
            ag.lastKnownPos.z - ag.position.z,
          ).normalize();
          // Worse accuracy for suppression
          suppressDir.x += (Math.random() - 0.5) * 0.15;
          suppressDir.z += (Math.random() - 0.5) * 0.15;
          suppressDir.normalize();

          const o = new THREE.Vector3(ag.position.x, 0.9, ag.position.z);
          const col = ag.team === TEAM_BLUE ? 0x60a5fa : 0xff6644;
          const muzzlePos = new THREE.Vector3(ag.position.x + suppressDir.x * 0.6, 1.0, ag.position.z + suppressDir.z * 0.6);
          spawnMuzzleFlash(muzzlePos, col);
          hitscanShot(o, suppressDir, 'ai', ag.team, ag.weaponId, col);
          ag.ammo--;
          ag.shootTimer = ag.fireRate * 1.5; // slower fire for suppression
        }
      }
    }
  } else {
    // ══════════════════════════════════
    //  NO TARGET VISIBLE — brain decides
    // ══════════════════════════════════
    ag.hasTarget = false;
    ag.currentTarget = null;
    ag.trackingTime = 0;
    ag.alertLevel = Math.max(0, ag.alertLevel - dt * 15);

    // Damage awareness: if shot recently, track the attacker
    const timeSinceDmg = gameState.worldElapsed - ag.lastDamageTime;
    if (timeSinceDmg < 1.5 && ag.lastAttacker && !ag.lastAttacker.isDead) {
      ag.lastKnownPos.copy(ag.lastAttacker.position);
      ag.hasLastKnown = true;
      ag.alertLevel = 80;
    }

    // Brain arbitration for non-combat decisions
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
