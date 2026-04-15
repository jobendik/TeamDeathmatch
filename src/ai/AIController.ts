import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { TEAM_BLUE } from '@/config/constants';
import { WEAPONS } from '@/config/weapons';
import type { TDMAgent } from '@/entities/TDMAgent';
import {
  broadcastEnemyPosition,
  canSee,
  countNearbyAllies,
  findBestTarget,
  getEnemyMemory,
  getInvestigationPosition,
  getPredictedAimPoint,
  updatePerception,
} from './Perception';
import { evalFuzzy } from './FuzzyLogic';
import { findCoverFrom, pushOutOfWall } from './CoverSystem';
import { hitscanShot, shotgunBlast, spawnGrenade, spawnRocket } from '@/combat/Hitscan';
import { spawnMuzzleFlash } from '@/combat/Particles';
import { keepInside } from '@/entities/Player';
import { decayTacticalBoards, getTeamBoard, noteTeamIntent, updateBoardFromAgent } from './TacticalBlackboard';

const tmpVec3 = new THREE.Vector3();
const tmpAim = new THREE.Vector3();
const tmpLat = new THREE.Vector3();
let lastBoardDecayMark = -1;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function decayTeamBoardsOncePerTick(dt: number): void {
  const mark = Math.floor(gameState.worldElapsed * 1000);
  if (mark === lastBoardDecayMark) return;
  lastBoardDecayMark = mark;
  decayTacticalBoards(dt);
}

function updateEmotion(ag: TDMAgent, dt: number): void {
  const sinceDamage = gameState.worldElapsed - ag.lastDamageTime;
  const hurt = 1 - ag.hp / ag.maxHP;

  if (sinceDamage < 0.8) ag.stress = Math.min(100, ag.stress + dt * 55 + ag.recentDamage * 0.08);
  else ag.stress = Math.max(5, ag.stress - dt * (10 + ag.patience * 8));

  ag.tilt = Math.max(0, ag.tilt - dt * (5 + ag.discipline * 6));
  if (ag.killStreak >= 2) ag.tilt = Math.min(100, ag.tilt + dt * 3);
  if (hurt > 0.55 && sinceDamage < 1.2) ag.tilt = Math.min(100, ag.tilt + dt * 6);

  if (ag.currentTarget && ag.hp / ag.maxHP > 0.65) ag.confidence = Math.min(100, ag.confidence + dt * 1.5);
  if (hurt > 0.45) ag.confidence = Math.max(10, ag.confidence - dt * 1.8);
}

function getEffectiveAimError(ag: TDMAgent, target: TDMAgent, dist: number, visible: boolean): number {
  let error = ag.aimError;
  const weapon = WEAPONS[ag.weaponId];

  const stabilityFactor = 1.5 - ag.aimStability * 0.8;
  error *= stabilityFactor;

  if (dist > weapon.range * 0.8) error *= 1 + (dist - weapon.range * 0.8) * 0.015;
  if (!visible) error *= 1.6;

  error *= 1 + (1 - ag.motorSkill) * 0.55;
  error *= 1 + (1 - ag.trackingSkill) * 0.35;
  error *= 1 + (ag.stress / 100) * 0.55;

  if (ag.confidence > 70) error *= 0.88;
  else if (ag.confidence < 30) error *= 1.12;

  const timeSinceDamage = gameState.worldElapsed - ag.lastDamageTime;
  if (timeSinceDamage < 1.2) error *= 1.22;

  if (ag.stateName === 'ENGAGE' || ag.stateName === 'TEAM_PUSH') {
    error *= weapon.movePenalty;
  }

  if (target === ag.lastAttacker && dist < 10 && ag.stress > 40) error *= 1.18;
  return error;
}

function setAimPhase(ag: TDMAgent, phase: TDMAgent['aimPhase']): void {
  if (ag.aimPhase === phase) return;
  ag.aimPhase = phase;
  ag.aimPhaseTime = 0;
}

function beginTargetAcquisition(ag: TDMAgent, target: TDMAgent): void {
  ag.aimTargetId = `${target.team}:${target.name}`;
  ag.aimOvershoot = 0.2 + Math.random() * (0.5 + (1 - ag.motorSkill) * 0.55);
  ag.aimLateralSign = Math.random() < 0.5 ? -1 : 1;
  ag.fireDisciplineTimer = 0.03 + (1 - ag.discipline) * 0.22 + Math.random() * 0.06;
  setAimPhase(ag, 'acquire');
}

function updateAimController(ag: TDMAgent, target: TDMAgent, visible: boolean, dt: number): { aimPoint: THREE.Vector3; canFire: boolean } {
  const aimBase = getPredictedAimPoint(ag, target);
  const memory = getEnemyMemory(ag, target);
  const dist = ag.position.distanceTo(aimBase);
  const chestHeight = visible ? 1.0 : 0.9;
  const headChance = visible && ag.aimStability > 0.82 && ag.motorSkill > 0.82 && memory && memory.certainty > 0.88 && dist < 18;
  aimBase.y = headChance ? 1.55 : chestHeight;

  if (ag.aimTargetId !== `${target.team}:${target.name}`) {
    beginTargetAcquisition(ag, target);
  }

  ag.aimPhaseTime += dt;
  ag.fireDisciplineTimer = Math.max(0, ag.fireDisciplineTimer - dt);

  const lateral = tmpLat.set(-(aimBase.z - ag.position.z), 0, aimBase.x - ag.position.x);
  if (lateral.lengthSq() > 0.0001) lateral.normalize();

  const overshoot = ag.aimOvershoot * Math.max(0, 1 - ag.aimPhaseTime * 2.2) * ag.aimLateralSign;
  const panic = gameState.worldElapsed - ag.lastDamageTime < 0.22 && ag.stress > 35;
  if (panic) setAimPhase(ag, 'panic');

  const acquireTime = ag.reactionTime * lerp(1.15, 0.62, ag.motorSkill) * lerp(1.05, 0.88, ag.confidence / 100);
  const settleTime = lerp(0.16, 0.06, ag.discipline);

  switch (ag.aimPhase) {
    case 'search':
      ag.aimStability = Math.max(0, ag.aimStability - dt * 2);
      setAimPhase(ag, 'acquire');
      break;
    case 'acquire':
      ag.aimStability = clamp01(0.16 + (ag.aimPhaseTime / Math.max(0.05, acquireTime)) * 0.45);
      if (ag.aimPhaseTime >= acquireTime) setAimPhase(ag, 'settle');
      break;
    case 'settle':
      ag.aimStability = clamp01(0.5 + (ag.aimPhaseTime / Math.max(0.05, settleTime)) * 0.25 + ag.trackingSkill * 0.12);
      if (ag.aimPhaseTime >= settleTime) setAimPhase(ag, 'track');
      break;
    case 'track': {
      const memoryCert = memory?.certainty ?? 0;
      ag.aimStability = clamp01(0.7 + ag.motorSkill * 0.15 + ag.trackingSkill * 0.12 + memoryCert * 0.08 - (ag.stress / 100) * 0.18);
      if (visible && memory && memory.visibility < 0.58 && Math.random() < 0.06 + (1 - ag.discipline) * 0.08) {
        setAimPhase(ag, 'settle');
      }
      break;
    }
    case 'panic':
      ag.aimStability = clamp01(0.28 + ag.bravery * 0.18 - (ag.stress / 100) * 0.08);
      if (!panic) setAimPhase(ag, visible ? 'settle' : 'acquire');
      break;
  }

  const lateralOffset = lateral.multiplyScalar(overshoot);
  ag.aimPoint.set(aimBase.x + lateralOffset.x, aimBase.y + lateralOffset.y, aimBase.z + lateralOffset.z);
  const aimPoint = tmpAim.set(ag.aimPoint.x, ag.aimPoint.y, ag.aimPoint.z);

  let canFire = false;
  if (ag.aimPhase === 'panic') canFire = ag.fireDisciplineTimer <= 0;
  else if (ag.aimPhase === 'track') canFire = ag.fireDisciplineTimer <= 0;
  else if (ag.aimPhase === 'settle') canFire = ag.fireDisciplineTimer <= 0 && ag.discipline < 0.7;

  if (ag.weaponId === 'sniper_rifle') {
    canFire = canFire && ag.aimStability > 0.78;
  }

  return { aimPoint, canFire };
}

function aiShoot(ag: TDMAgent, target: TDMAgent, aimPoint: THREE.Vector3, visible: boolean): void {
  if (ag.isDead || target.isDead) return;

  const origin = tmpVec3.set(ag.position.x, 0.9, ag.position.z).clone();
  const dir = aimPoint.clone().sub(origin).normalize();
  const dist = origin.distanceTo(aimPoint);
  const err = getEffectiveAimError(ag, target, dist, visible);

  dir.x += (Math.random() - 0.5) * err;
  dir.y += (Math.random() - 0.5) * err * 0.45;
  dir.z += (Math.random() - 0.5) * err;
  dir.normalize();

  const col = ag.team === TEAM_BLUE ? 0x60a5fa : 0xff6644;
  const muzzlePos = new THREE.Vector3(ag.position.x + dir.x * 0.6, 1.0, ag.position.z + dir.z * 0.6);
  spawnMuzzleFlash(muzzlePos, col);

  if (ag.weaponId === 'shotgun') {
    shotgunBlast(origin, dir, 'ai', ag.team, col);
  } else if (ag.weaponId === 'rocket_launcher') {
    spawnRocket(origin, dir, 'ai', ag.team, col);
  } else {
    hitscanShot(origin, dir, 'ai', ag.team, ag.weaponId, col);
  }
  ag.ammo--;
}

function updateStrafing(ag: TDMAgent, dt: number): void {
  ag.strafeTimer -= dt;
  if (ag.strafeTimer > 0) return;

  const tempo = 0.18 + (1 - ag.patience) * 0.35 + Math.random() * 0.22;
  const flipChance = 0.4 + ag.peekBias * 0.22 + (ag.botClass === 'flanker' ? 0.18 : 0);

  if (Math.random() < flipChance) ag.strafeDir *= -1;
  ag.strafeTimer = tempo;
}

function handleDamageReaction(ag: TDMAgent, dt: number): boolean {
  const timeSinceDamage = gameState.worldElapsed - ag.lastDamageTime;

  if (timeSinceDamage < 0.25) {
    ag.strafeDir *= -1;
    ag.strafeTimer = 0.25 + Math.random() * 0.3;
    ag.hesitationTimer = 0.02 + (1 - ag.bravery) * 0.18;
    return true;
  }

  if (ag.recentDamage > ag.maxHP * 0.4 && timeSinceDamage < 2) return true;

  ag.recentDamage = Math.max(0, ag.recentDamage - dt * 20);
  ag.hesitationTimer = Math.max(0, ag.hesitationTimer - dt);
  return false;
}

function tryThrowGrenade(ag: TDMAgent, target: TDMAgent, dist: number, visible: boolean): boolean {
  if (ag.grenades <= 0 || ag.grenadeCooldown > 0) return false;
  if (dist < 7 || dist > 28) return false;

  const board = getTeamBoard(ag.team);
  const shouldThrow =
    (visible && ag.stateName === 'COVER' && dist > 10 && dist < 22) ||
    (board.intent === 'collapse' && ag.nearbyAllies >= 2 && ag.confidence > 45) ||
    (!visible && ag.targetCertainty > 0.55 && ag.discipline > 0.55 && Math.random() < 0.08);

  if (!shouldThrow) return false;

  const origin = new THREE.Vector3(ag.position.x, 1.2, ag.position.z);
  const aim = getPredictedAimPoint(ag, target);
  const dir = new THREE.Vector3(aim.x - origin.x, 0, aim.z - origin.z).normalize();
  dir.x += (Math.random() - 0.5) * 0.12;
  dir.z += (Math.random() - 0.5) * 0.12;
  dir.normalize();

  spawnGrenade(origin, dir, 'ai', ag.team);
  ag.grenades--;
  ag.grenadeCooldown = 8 + Math.random() * 4;
  return true;
}

function updateCombatTargetState(ag: TDMAgent, dt: number): { target: TDMAgent | null; dist: number; visible: boolean } {
  const previousTarget = ag.currentTarget;
  const result = findBestTarget(ag);
  const target = result.target;

  if (!target) {
    ag.hasTarget = false;
    ag.currentTarget = null;
    ag.currentTargetId = null;
    ag.targetCertainty = 0;
    ag.trackingTime = 0;
    return { target: null, dist: Infinity, visible: false };
  }

  const sameTarget = previousTarget === target;
  ag.currentTarget = target;
  ag.currentTargetId = `${target.team}:${target.name}`;
  ag.hasTarget = true;
  ag.targetCertainty = result.certainty;

  if (sameTarget) ag.trackingTime += dt;
  else {
    ag.trackingTime = 0;
    ag.reactionTimer = ag.reactionTime * lerp(1.15, 0.75, ag.motorSkill) * (0.8 + Math.random() * 0.45);
    beginTargetAcquisition(ag, target);
  }

  const aimPos = getPredictedAimPoint(ag, target);
  ag.lastKnownPos.copy(aimPos);
  ag.hasLastKnown = true;
  ag.investigatePos = aimPos.clone();
  return { target, dist: result.dist, visible: result.visible };
}

function doSuppressiveFire(ag: TDMAgent, dt: number): void {
  if (!ag.hasLastKnown || ag.ammo <= 0 || ag.isReloading) return;
  if (ag.targetCertainty < 0.45 || ag.alertLevel < 50) return;
  if (gameState.worldElapsed - ag.lastVisibleEnemyTime > 1.4) return;

  ag.shootTimer -= dt;
  if (ag.shootTimer > 0) return;

  const dir = new THREE.Vector3(
    ag.lastKnownPos.x - ag.position.x,
    0,
    ag.lastKnownPos.z - ag.position.z,
  ).normalize();
  dir.x += (Math.random() - 0.5) * 0.18;
  dir.z += (Math.random() - 0.5) * 0.18;
  dir.normalize();

  const origin = new THREE.Vector3(ag.position.x, 0.9, ag.position.z);
  const col = ag.team === TEAM_BLUE ? 0x60a5fa : 0xff6644;
  spawnMuzzleFlash(new THREE.Vector3(ag.position.x + dir.x * 0.6, 1.0, ag.position.z + dir.z * 0.6), col);
  hitscanShot(origin, dir, 'ai', ag.team, ag.weaponId, col);
  ag.ammo--;
  ag.shootTimer = ag.fireRate * 1.8;
}

export function updateAI(ag: TDMAgent, dt: number): void {
  if (ag === gameState.player || ag.isDead) return;

  decayTeamBoardsOncePerTick(dt);

  ag.stateTime += dt;
  updateEmotion(ag, dt);
  updateStrafing(ag, dt);
  const underPressure = handleDamageReaction(ag, dt);

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
      (ag.seekB as any).target.set(pushed.x + (Math.random() - 0.5) * 4, 0, pushed.z + (Math.random() - 0.5) * 4);
      ag.seekB.weight = 2;
    }
    ag.stateName = 'PATROL';
    ag.brain.clearSubgoals();
    ag.brain.arbitrate();
  }

  if (ag.grenadeCooldown > 0) ag.grenadeCooldown -= dt;
  if (ag.reactionTimer > 0) ag.reactionTimer -= dt;

  updatePerception(ag, dt);

  ag.allyCheckTimer -= dt;
  if (ag.allyCheckTimer <= 0) {
    ag.allyCheckTimer = 0.8 + Math.random() * 0.4;
    ag.nearbyAllies = countNearbyAllies(ag, 20);
  }

  const { target, dist, visible } = updateCombatTargetState(ag, dt);
  evalFuzzy(ag, dist);

  if (target) {
    ag.alertLevel = Math.min(100, ag.alertLevel + dt * (visible ? 24 : 10));
    updateBoardFromAgent(ag);
    if (visible) broadcastEnemyPosition(ag, target);
  } else {
    ag.alertLevel = Math.max(0, ag.alertLevel - dt * 14);
    if (ag.hp / ag.maxHP < 0.4 || underPressure) {
      noteTeamIntent(ag.team, 'reset', ag.currentCover ?? ag.spawnPos, 0.3);
    }
  }

  if (ag.pursuitB && target) {
    (ag.pursuitB as any).evader = target;
  }

  ag.decisionTimer -= dt;
  const canReact = ag.reactionTimer <= 0 && ag.hesitationTimer <= 0;
  if (ag.decisionTimer <= 0) {
    const base = target ? 0.16 : 0.26;
    ag.decisionTimer = base + Math.random() * 0.18 + (1 - ag.discipline) * 0.08;
    ag.brain.arbitrate();
  }

  if (target && canReact) {
    const { aimPoint, canFire } = updateAimController(ag, target, visible, dt);

    if (dist > 10 && ag.grenadeCooldown <= 0 && ag.grenades > 0) {
      tryThrowGrenade(ag, target, dist, visible);
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
        const cover = findCoverFrom(ag, ag.lastKnownPos);
        if (cover) ag.currentCover = cover;
      }
    } else if (canFire) {
      ag.shootTimer -= dt;
      if (ag.shootTimer <= 0) {
        if (ag.burstCount < ag.burstSize) {
          ag.burstTimer -= dt;
          if (ag.burstTimer <= 0) {
            aiShoot(ag, target, aimPoint, visible);
            ag.burstCount++;
            ag.burstTimer = ag.burstDelay;
            ag.stress = Math.min(100, ag.stress + 0.8);
          }
        } else {
          ag.burstCount = 0;
          const pause = ag.fireRate + Math.random() * 0.1 + (1 - ag.discipline) * 0.08;
          ag.shootTimer = pause;
        }
      }
    }
  } else if (canReact) {
    doSuppressiveFire(ag, dt);
  }

  if (!target) {
    ag.aimPhase = 'search';
    const investigatePos = getInvestigationPosition(ag);
    if (investigatePos) {
      ag.lastKnownPos.copy(investigatePos);
      ag.hasLastKnown = true;
    }
  }

  ag.brain.execute();

  if (ag.position.distanceTo(ag.spawnPos) < 8) {
    ag.hp = Math.min(ag.maxHP, ag.hp + dt * 15);
  }

  keepInside(ag);
}
