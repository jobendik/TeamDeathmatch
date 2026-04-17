import * as THREE from 'three';
import * as YUKA from 'yuka';
import { gameState } from '@/core/GameState';
import { TEAM_BLUE } from '@/config/constants';
import type { TDMAgent } from '@/entities/TDMAgent';
import {
  findBestTarget, canSee, checkAudioAwareness,
  countNearbyAllies, updateEnemyMemory, decayEnemyMemory,
} from './Perception';
import { evalFuzzy } from './FuzzyLogic';
import { findCoverFrom, pushOutOfWall } from './CoverSystem';
import { hitscanShot, shotgunBlast, spawnRocket, spawnGrenade } from '@/combat/Hitscan';
import { spawnMuzzleFlash } from '@/combat/Particles';
import { keepInside } from '@/entities/Player';
import { updateAim, getAimDirection } from './HumanAim';
import { deliverPendingCallouts, queueCallout } from './TeamIntel';

const _muzzlePos = new THREE.Vector3();

let _lastCalloutFrame = -1;
function deliverCalloutsOncePerFrame(): void {
  if (_lastCalloutFrame !== gameState.perceptionFrame) {
    _lastCalloutFrame = gameState.perceptionFrame;
    deliverPendingCallouts();
  }
}

/** Fire the agent's weapon using the simulated crosshair direction. */
function aiShoot(ag: TDMAgent): void {
  if (ag.isDead || !ag.currentTarget || ag.currentTarget.isDead) return;
  if (ag.weaponId === 'unarmed') return;

  const { dir, origin } = getAimDirection(ag);
  const col = ag.team === TEAM_BLUE ? 0x60a5fa : 0xff6644;

  _muzzlePos.set(origin.x + dir.x * 0.6, 1.0, origin.z + dir.z * 0.6);
  spawnMuzzleFlash(_muzzlePos.clone(), col);

  if (ag.weaponId === 'shotgun') {
    shotgunBlast(origin.clone(), dir.clone(), 'ai', ag.team, col, ag);
  } else if (ag.weaponId === 'rocket_launcher') {
    spawnRocket(origin.clone(), dir.clone(), 'ai', ag.team, col, ag);
  } else {
    hitscanShot(origin.clone(), dir.clone(), 'ai', ag.team, ag.weaponId, col, ag);
  }
  ag.ammo--;
}

function updateStrafing(ag: TDMAgent, dt: number): void {
  ag.strafeTimer -= dt;
  if (ag.strafeTimer > 0) return;

  const p = ag.personality;
  const repos = p ? p.repositionFrequency : 0.5;

  const baseInterval = 0.3 + (1 - repos) * 0.7;
  const flipChance = 0.4 + repos * 0.4;

  if (Math.random() < flipChance) ag.strafeDir *= -1;
  ag.strafeTimer = baseInterval * (0.6 + Math.random() * 0.8);
}

function updateDamagePressure(ag: TDMAgent, dt: number): void {
  const timeSinceDamage = gameState.worldElapsed - ag.lastDamageTime;
  const p = ag.personality;

  if (timeSinceDamage < 0.3) {
    ag.strafeDir *= -1;
    ag.strafeTimer = 0.4;
  }

  const recentDamageRatio = ag.recentDamage / ag.maxHP;
  const recency = Math.max(0, 1 - timeSinceDamage / 3);
  const baseP = recentDamageRatio * recency * 2;
  const flinch = p ? p.flinchFactor : 0.3;
  ag.pressureLevel = Math.min(1, baseP * (0.8 + flinch * 0.6));
  ag.underPressure = ag.pressureLevel > 0.25;

  if (ag.pressureLevel > 0.5 && ag.shootTimer < 0.1 && p) {
    if (p.panicSprayFactor < 0.5) {
      ag.shootTimer += ag.pressureLevel * 0.08;
    }
  }

  if (ag.underPressure) {
    ag.fuzzyAggr = Math.max(0, ag.fuzzyAggr - ag.pressureLevel * 25);
  }

  ag.recentDamage = Math.max(0, ag.recentDamage - dt * 20);
}

function updateTilt(ag: TDMAgent, dt: number): void {
  if (ag.tiltLevel > 0) {
    ag.tiltLevel = Math.max(0, ag.tiltLevel - dt * 0.05);
  }
  if (ag.grudge && gameState.worldElapsed > ag.grudgeExpiry) {
    ag.grudge = null;
  }
}

function tryThrowGrenade(ag: TDMAgent, target: TDMAgent, dist: number): boolean {
  if (ag.grenades <= 0 || ag.grenadeCooldown > 0) return false;
  if (dist < 5 || dist > 30) return false;

  const p = ag.personality;
  const aggroMul = p ? (1 + p.aggressionBias * 0.5) : 1;

  const shouldThrow =
    (dist > 10 && dist < 25 && ag.stateName === 'COVER') ||
    (ag.nearbyAllies >= 2 && ag.confidence > 50 && Math.random() < 0.04 * aggroMul) ||
    (ag.stateName === 'ENGAGE' && dist > 12 && Math.random() < 0.02 * aggroMul);

  if (!shouldThrow) return false;

  const o = new THREE.Vector3(ag.position.x, 1.2, ag.position.z);
  const tPos = new THREE.Vector3(target.position.x, 0, target.position.z);
  const d = tPos.clone().sub(o).normalize();
  const throwNoise = 0.08 + (p ? (1 - p.skill) * 0.15 : 0.07);
  d.x += (Math.random() - 0.5) * throwNoise;
  d.z += (Math.random() - 0.5) * throwNoise;
  d.normalize();

  spawnGrenade(o, d, 'ai', ag.team, ag);
  ag.grenades--;
  ag.grenadeCooldown = 8 + Math.random() * 4;
  return true;
}

function shouldReplan(ag: TDMAgent): boolean {
  if (gameState.worldElapsed >= ag.commitmentUntil) return true;
  if (ag.currentTarget?.isDead) return true;
  if (ag.recentDamage > ag.maxHP * 0.3) return true;
  return false;
}

function setCommitment(ag: TDMAgent, seconds: number): void {
  ag.commitmentUntil = gameState.worldElapsed + seconds;
}

export function updateAI(ag: TDMAgent, dt: number): void {
  if (ag === gameState.player || ag.isDead) return;

  deliverCalloutsOncePerFrame();

  ag.stateTime += dt;
  updateStrafing(ag, dt);
  updateDamagePressure(ag, dt);
  updateTilt(ag, dt);
  decayEnemyMemory(ag, dt);
  updateAim(ag, dt);

  if (gameState.pDead && ag.currentTarget === gameState.player) {
    ag.currentTarget = null;
    ag.hasTarget = false;
    ag.trackingTime = 0;
    ag.burstCount = 0;
  }

  // Stuck detection
  const movedDist = ag.position.distanceTo(ag.lastStuckCheckPos);
  if (movedDist < 0.15) ag.stuckTime += dt;
  else ag.stuckTime = 0;

  if (Math.random() < 0.1) ag.lastStuckCheckPos.copy(ag.position);
  if (ag.stuckTime > 0.8) {
    ag.stuckTime = 0;
    ag.hasLastKnown = false;
    ag.currentCover = null;
    ag.seekingPickup = false;
    ag.seekPickupPos = null;
    const pushed = pushOutOfWall(ag.position.x, ag.position.z);
    if (ag.seekB) {
      (ag.seekB as any).target.set(
        pushed.x + (Math.random() - 0.5) * 4,
        0,
        pushed.z + (Math.random() - 0.5) * 4,
      );
      ag.seekB.weight = 2;
    }
    ag.stateName = 'PATROL';
    ag.brain.clearSubgoals();
    ag.brain.arbitrate();
    setCommitment(ag, 1.5);
  }

  if (ag.grenadeCooldown > 0) ag.grenadeCooldown -= dt;

  checkAudioAwareness(ag);

  ag.allyCheckTimer -= dt;
  if (ag.allyCheckTimer <= 0) {
    ag.allyCheckTimer = 0.8 + Math.random() * 0.4;
    ag.nearbyAllies = countNearbyAllies(ag, 20);
  }

  const { target, dist } = findBestTarget(ag);
  const hadTarget = ag.hasTarget;

  if (target) {
    const prevTarget = ag.currentTarget;
    ag.currentTarget = target;
    ag.lastKnownPos.copy(target.position);
    ag.hasLastKnown = true;
    ag.alertLevel = Math.min(100, ag.alertLevel + dt * 30);

    updateEnemyMemory(ag, target, 'visual');

    if (!hadTarget || prevTarget !== target) {
      queueCallout(ag, target);
    }

    if (hadTarget && prevTarget === target) ag.trackingTime += dt;
    else ag.trackingTime = 0;

    if (!hadTarget) {
      const p = ag.personality;
      const skillMod = p ? (1.3 - p.skill * 0.6) : 1.0;
      const tiltMod = 1 + ag.tiltLevel * 0.4;
      ag.reactionTimer = ag.reactionTime * skillMod * tiltMod * (0.7 + Math.random() * 0.6);
      ag.hasTarget = true;
    }
    ag.reactionTimer = Math.max(0, ag.reactionTimer - dt);

    if (ag.pursuitB && target) (ag.pursuitB as any).evader = target;

    evalFuzzy(ag, dist);

    const canReact = ag.reactionTimer <= 0;

    if (ag.underPressure && ag.hp < ag.maxHP * 0.55) {
      ag.currentCover = ag.currentTarget ? findCoverFrom(ag, ag.currentTarget.position) : ag.currentCover;
    }

    // Decision making with commitment
    ag.decisionTimer -= dt;
    if (ag.decisionTimer <= 0 && shouldReplan(ag)) {
      const baseInterval = ag.underPressure ? 0.1 + Math.random() * 0.1 : 0.2 + Math.random() * 0.25;
      const p = ag.personality;
      const commitScale = p ? (1 + p.patienceBias) : 1;
      ag.decisionTimer = baseInterval * commitScale;

      const myTeamScore = gameState.teamScores[ag.team];
      const enemyTeamScore = gameState.teamScores[ag.team === TEAM_BLUE ? 1 : 0];
      const scoreDiff = myTeamScore - enemyTeamScore;
      if (scoreDiff < -3) ag.fuzzyAggr = Math.min(100, ag.fuzzyAggr + 15);
      if (scoreDiff > 5 && ag.hp / ag.maxHP < 0.5) ag.fuzzyAggr = Math.max(0, ag.fuzzyAggr - 10);

      ag.brain.arbitrate();
      const baseCommit = 0.6 + (p?.patienceBias ?? 0) * 0.8;
      setCommitment(ag, Math.max(0.3, baseCommit));
    }

    // ── Shooting ──
    if (ag.weaponId === 'unarmed') {
      // unarmed: cannot shoot
    } else if (canReact && canSee(ag, target)) {
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
        if (ag.team === gameState.player.team) {
          const distToPlayer = ag.position.distanceTo(gameState.player.position);
          if (distToPlayer < 25 && Math.random() < 0.3) {
            import('@/audio/SoundHooks').then(s =>
              s.playBotCallout('reload', new THREE.Vector3(ag.position.x, 1.6, ag.position.z))
            );
          }
        }
        if (ag.stateName !== 'COVER' && ag.stateName !== 'RETREAT') {
          const cover = findCoverFrom(ag, target.position);
          if (cover) ag.currentCover = cover;
        }
      } else {
        // Panic skip — only when heavily pressured AND personality is disciplined
        const p = ag.personality;
        const pressureSkip =
          ag.pressureLevel > 0.7 &&
          p !== null &&
          Math.random() < ag.pressureLevel * 0.3 * (1 - p.panicSprayFactor);

        if (!pressureSkip) {
          ag.shootTimer -= dt;
          if (ag.shootTimer <= 0) {
            // Personality-modulated burst size
            const effectiveBurst = p
              ? Math.max(1, Math.round(ag.burstSize * (1 + (Math.random() - 0.5) * p.burstLengthVariance * 0.8)))
              : ag.burstSize;

            if (ag.burstCount < effectiveBurst) {
              ag.burstTimer -= dt;
              if (ag.burstTimer <= 0) {
                aiShoot(ag);
                ag.burstCount++;
                ag.burstTimer = ag.burstDelay;
              }
            } else {
              ag.burstCount = 0;
              // Disciplined bots pause longer between bursts
              const discPause = p ? (p.triggerDiscipline * 0.15) : 0.05;
              ag.shootTimer = ag.fireRate + discPause + Math.random() * 0.12;
            }
          }
        }
      }
    } else if (canReact && ag.hasLastKnown && ag.alertLevel > 60 && !ag.isReloading && ag.ammo > 3) {
      // Suppressive fire
      const p = ag.personality;
      const suppress = p ? (0.25 + p.trigHappy * 0.4) : 0.3;
      if (!ag.underPressure || Math.random() < 0.15) {
        const timeSinceTarget = ag.stateTime;
        if (timeSinceTarget < 1.5 && Math.random() < suppress) {
          ag.shootTimer -= dt;
          if (ag.shootTimer <= 0) {
            const { dir, origin } = getAimDirection(ag);
            const col = ag.team === TEAM_BLUE ? 0x60a5fa : 0xff6644;
            const mz = new THREE.Vector3(origin.x + dir.x * 0.6, 1.0, origin.z + dir.z * 0.6);
            spawnMuzzleFlash(mz, col);
            hitscanShot(origin.clone(), dir.clone(), 'ai', ag.team, ag.weaponId, col, ag);
            ag.ammo--;
            ag.shootTimer = ag.fireRate * 1.5;
          }
        }
      }
    }
  } else {
    // No target
    ag.hasTarget = false;
    ag.currentTarget = null;
    ag.trackingTime = 0;
    ag.alertLevel = Math.max(0, ag.alertLevel - dt * 15);

    // Smart reload — top up the magazine when no enemy visible and ammo < 60%
    if (!ag.isReloading && ag.weaponId !== 'unarmed' && ag.weaponId !== 'knife') {
      if (ag.ammo < ag.magSize * 0.6 && Math.random() < 0.02) {
        ag.isReloading = true;
        ag.reloadTimer = ag.reloadTime;
      }
    }

    const timeSinceDmg = gameState.worldElapsed - ag.lastDamageTime;
    if (timeSinceDmg < 1.5 && ag.lastAttacker && !ag.lastAttacker.isDead) {
      ag.lastKnownPos.copy(ag.lastAttacker.position);
      ag.hasLastKnown = true;
      ag.alertLevel = 80;
    }

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
    if (ag.decisionTimer <= 0 && shouldReplan(ag)) {
      ag.decisionTimer = 0.3 + Math.random() * 0.3;
      ag.brain.arbitrate();
      setCommitment(ag, 0.8);
    }
  }

  ag.brain.execute();

  // Passive spawn-heal only in arena modes (not BR — spawn positions are random)
  if (gameState.mode !== 'br' && ag.position.distanceTo(ag.spawnPos) < 8) {
    ag.hp = Math.min(ag.maxHP, ag.hp + dt * 15);
  }

  keepInside(ag);
}
