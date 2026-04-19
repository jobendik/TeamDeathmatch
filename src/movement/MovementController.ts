/**
 * MovementController — modern FPS movement.
 *
 * Features:
 *  - Sprint with FOV kick + speed ramp
 *  - Crouch (toggle or hold) with hitbox change
 *  - Slide (sprint + crouch) with kinetic energy curve
 *  - Lean (Q/E) — camera-only roll + offset
 *  - Mantle: auto-vault low ledges when jumping into walls
 *  - Air control limited but present
 *  - Coyote time on edges
 *  - Head-bob phase tied to footstep cadence
 */

import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { FP } from '@/config/player';
import { WEAPONS } from '@/config/weapons';
import { playJump, playLand, playSlide, playFootstep, detectSurface } from '@/audio/SoundHooks';
import { dealDmgPlayer } from '@/combat/Combat';
import { getActivePerkHooks } from '@/config/Loadouts';
import { getFloorY } from '@/entities/Player';
import { shakeOnLand } from '@/movement/CameraShake';

export interface MovementState {
  isCrouching: boolean;
  crouchT: number;          // 0=standing, 1=fully crouched
  isSliding: boolean;
  slideTimer: number;
  slideDir: THREE.Vector3;
  slideStartSpeed: number;
  slideCooldown: number;

  leanDir: number;          // -1 left, 0 none, 1 right
  leanT: number;            // smoothed -1..1

  isSprinting: boolean;
  sprintT: number;          // smoothed 0..1

  isTacSprinting: boolean;
  tacSprintTimer: number;
  tacSprintCooldown: number;

  isGrounded: boolean;
  coyoteTimer: number;
  jumpBuffer: number;
  airTime: number;
  fallStartY: number;

  velocity: THREE.Vector3;
  bobPhase: number;
  footstepCooldown: number;

  fovBase: number;
  fovTarget: number;
  fovCurrent: number;

  headBobScale: number;

  cameraOffsetX: number;    // for lean
  cameraTilt: number;       // for lean roll
  moveSpeedMulOverride: number;  // override speed multiplier (field upgrades)
}

export const movement: MovementState = {
  isCrouching: false,
  crouchT: 0,
  isSliding: false,
  slideTimer: 0,
  slideDir: new THREE.Vector3(),
  slideStartSpeed: 0,
  slideCooldown: 0,

  leanDir: 0,
  leanT: 0,

  isSprinting: false,
  sprintT: 0,

  isTacSprinting: false,
  tacSprintTimer: 0,
  tacSprintCooldown: 0,

  isGrounded: true,
  coyoteTimer: 0,
  jumpBuffer: 0,
  airTime: 0,
  fallStartY: 0,

  velocity: new THREE.Vector3(),
  bobPhase: 0,
  footstepCooldown: 0,

  fovBase: 78,
  fovTarget: 78,
  fovCurrent: 78,

  headBobScale: 1,

  cameraOffsetX: 0,
  cameraTilt: 0,
  moveSpeedMulOverride: 1,
};

// ── Tunables ──
const STAND_HEIGHT = 1.6;
const CROUCH_HEIGHT = 1.05;
const CROUCH_SPEED_MULT = 0.55;
const ADS_SPEED_MULT = 0.6;
const SLIDE_DURATION = 0.7;
const SLIDE_INITIAL_BOOST = 1.5;
const SLIDE_FRICTION = 1.6;
const SLIDE_MIN_SPEED = 4;
const COYOTE_TIME = 0.12;
const JUMP_BUFFER_TIME = 0.15;
const MANTLE_MAX_HEIGHT = 1.4;
const MANTLE_REACH = 0.9;
const FOOTSTEP_INTERVAL_WALK = 0.45;
const FOOTSTEP_INTERVAL_RUN = 0.3;
const FOOTSTEP_INTERVAL_SPRINT = 0.24;
const FOV_SPRINT_BOOST = 8;
const FOV_ADS_REDUCTION = 22;
const LEAN_OFFSET = 0.35;
const LEAN_TILT = 0.18;
let strafeTiltSmooth = 0;

/**
 * Returns the effective player height (for camera + collision).
 */
export function getCurrentPlayerHeight(): number {
  return STAND_HEIGHT + (CROUCH_HEIGHT - STAND_HEIGHT) * movement.crouchT;
}

/**
 * Effective movement speed multiplier from current state.
 */
function getSpeedMultiplier(): number {
  let mult = 1;
  if (movement.isCrouching) mult *= CROUCH_SPEED_MULT;
  if (gameState.isADS) mult *= ADS_SPEED_MULT;
  // Weapon-weight penalty (heavier weapons slow you down)
  const wep = WEAPONS[gameState.pWeaponId];
  if (wep && wep.movePenalty > 1) {
    mult /= wep.movePenalty;
  }
  return mult;
}

/**
 * Try to start a slide. Requires sprinting + grounded.
 */
function tryStartSlide(forward: THREE.Vector3): boolean {
  if (movement.isSliding) return false;
  if (!movement.isSprinting) return false;
  if (!movement.isGrounded) return false;
  if (movement.slideCooldown > 0) return false;

  movement.isSliding = true;
  movement.slideTimer = SLIDE_DURATION;
  movement.slideDir.copy(forward);
  movement.slideStartSpeed = FP.sprintSpeed * SLIDE_INITIAL_BOOST;
  movement.isCrouching = true;
  playSlide();
  return true;
}

function endSlide(): void {
  movement.isSliding = false;
  movement.slideTimer = 0;
  movement.slideCooldown = 1.2;
  movement.isCrouching = false;
}

/**
 * Try to mantle a low obstacle in front. Returns target Y if mantleable.
 */
function tryMantle(): number | null {
  // Cast forward at chest height — if we hit, check if there's empty space above
  const cam = gameState.camera;
  const forward = new THREE.Vector3(
    -Math.sin(gameState.cameraYaw),
    0,
    -Math.cos(gameState.cameraYaw),
  );

  const chestPos = new THREE.Vector3(
    gameState.player.position.x,
    gameState.pPosY + 1.0,
    gameState.player.position.z,
  );

  const rc = gameState.raycaster;
  rc.set(chestPos, forward);
  rc.near = 0;
  rc.far = MANTLE_REACH;
  const hits = rc.intersectObjects(gameState.wallMeshes, false);
  if (hits.length === 0) return null;

  // Hit something — check if top edge is reachable
  const hitObj = hits[0].object;
  const box = new THREE.Box3().setFromObject(hitObj);
  const topY = box.max.y;
  const groundY = gameState.pPosY;
  const heightAbove = topY - groundY;

  if (heightAbove < 0.4 || heightAbove > MANTLE_MAX_HEIGHT) return null;

  // Check there's clearance above the ledge
  const landingPos = chestPos.clone().add(forward.clone().multiplyScalar(MANTLE_REACH + 0.3));
  landingPos.y = topY + 0.5;
  rc.set(landingPos, new THREE.Vector3(0, 1, 0));
  rc.far = 1.0;
  const headHits = rc.intersectObjects(gameState.wallMeshes, false);
  if (headHits.length > 0) return null;

  return topY + 0.05;
}

// ── Input handlers ──

let mantleTarget: { x: number; y: number; z: number; t: number } | null = null;

export function setLean(dir: -1 | 0 | 1): void {
  movement.leanDir = dir;
}

export function requestJump(): void {
  movement.jumpBuffer = JUMP_BUFFER_TIME;
}

export function toggleCrouch(): void {
  // Crouch during slide = slide cancel
  if (movement.isSliding) {
    endSlide();
    movement.isCrouching = false;
    return;
  }
  movement.isCrouching = !movement.isCrouching;
}

export function setCrouch(on: boolean): void {
  // Crouch during slide = slide cancel (stand up, kill slide momentum)
  if (movement.isSliding && on) {
    endSlide();
    movement.isCrouching = false;
    return;
  }
  if (movement.isSliding && !on) return;
  movement.isCrouching = on;
}

/** Called on shift press while moving */
export function attemptSlide(): void {
  const forward = new THREE.Vector3(
    -Math.sin(gameState.cameraYaw),
    0,
    -Math.cos(gameState.cameraYaw),
  );
  tryStartSlide(forward);
}

// ── Main update ──

export function updateMovement(dt: number): {
  desiredVelX: number;
  desiredVelZ: number;
  jumped: boolean;
} {
  const { keys } = gameState;
  let jumped = false;
  const _perkHooks = getActivePerkHooks();

  // ── Sprint detection ──
  // ── Slide cooldown ──
  if (movement.slideCooldown > 0) movement.slideCooldown -= dt;

  // ── Tactical sprint cooldown ──
  if (movement.tacSprintCooldown > 0) movement.tacSprintCooldown -= dt;

  const wantingToSprint = keys.shift && keys.w && !movement.isCrouching && !gameState.isADS && !gameState.mouseHeld;
  movement.isSprinting = wantingToSprint && movement.isGrounded;

  // Tactical sprint: faster tier with limited duration
  if (movement.isTacSprinting) {
    movement.tacSprintTimer -= dt;
    if (movement.tacSprintTimer <= 0 || !movement.isSprinting) {
      movement.isTacSprinting = false;
      movement.tacSprintCooldown = 5;
    }
  }

  movement.sprintT += ((movement.isSprinting ? 1 : 0) - movement.sprintT) * Math.min(1, dt * 8);

  // ── Crouch transition ──
  const targetCrouchT = movement.isCrouching || movement.isSliding ? 1 : 0;
  movement.crouchT += (targetCrouchT - movement.crouchT) * Math.min(1, dt * 12);

  // ── Lean ──
  const leanInput = movement.leanDir;
  movement.leanT += (leanInput - movement.leanT) * Math.min(1, dt * 10);
  movement.cameraOffsetX = movement.leanT * LEAN_OFFSET;

  // Strafe tilt — subtle camera roll when strafing
  const strafeInput = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  const strafeTiltTarget = strafeInput * 0.012 * (movement.isSprinting ? 1.5 : 1);
  strafeTiltSmooth += (strafeTiltTarget - strafeTiltSmooth) * Math.min(1, dt * 6);
  movement.cameraTilt = -movement.leanT * LEAN_TILT + strafeTiltSmooth;

  // ── FOV target ──
  let fovT = movement.fovBase;
  if (movement.isSprinting) fovT += FOV_SPRINT_BOOST * movement.sprintT;
  if (movement.isTacSprinting) fovT += 4;
  if (movement.isSliding) fovT += FOV_SPRINT_BOOST * 1.4;
  if (gameState.isADS) {
    const adsAmount = gameState.pWeaponId === 'sniper_rifle' ? 1 : 0.6;
    fovT -= FOV_ADS_REDUCTION * adsAmount;
  }
  movement.fovTarget = fovT;
  movement.fovCurrent += (movement.fovTarget - movement.fovCurrent) * Math.min(1, dt * 9);
  if (gameState.camera.fov !== movement.fovCurrent) {
    gameState.camera.fov = movement.fovCurrent;
    gameState.camera.updateProjectionMatrix();
  }

  // ── Movement input ──
  let desiredVelX = 0;
  let desiredVelZ = 0;

  if (movement.isSliding) {
    // Slide: friction-decayed forward momentum, small input influence
    movement.slideTimer -= dt;
    const tNorm = movement.slideTimer / SLIDE_DURATION;
    const speedNow = movement.slideStartSpeed * tNorm * tNorm + SLIDE_MIN_SPEED * (1 - tNorm * tNorm);
    desiredVelX = movement.slideDir.x * speedNow;
    desiredVelZ = movement.slideDir.z * speedNow;

    if (movement.slideTimer <= 0 || !movement.isGrounded) {
      endSlide();
    }
  } else {
    const forward = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
    const strafe = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);

    if (forward || strafe) {
      const baseSpeed = movement.isSprinting
        ? (movement.isTacSprinting ? FP.sprintSpeed * 1.25 : FP.sprintSpeed)
        : FP.moveSpeed;
      const spd = baseSpeed * getSpeedMultiplier() * (_perkHooks.moveSpeedMul ?? 1) * movement.moveSpeedMulOverride;
      let mx = (-Math.sin(gameState.cameraYaw)) * forward + (Math.cos(gameState.cameraYaw)) * strafe;
      let mz = (-Math.cos(gameState.cameraYaw)) * forward + (-Math.sin(gameState.cameraYaw)) * strafe;
      const len = Math.hypot(mx, mz) || 1;
      mx /= len;
      mz /= len;

      // Air control reduces strafe authority
      const airMul = movement.isGrounded ? 1 : 0.45;
      desiredVelX = mx * spd * airMul;
      desiredVelZ = mz * spd * airMul;
    }
  }

  // ── Velocity smoothing for momentum ──
  const accel = movement.isGrounded ? 22 : 9;
  movement.velocity.x += (desiredVelX - movement.velocity.x) * Math.min(1, dt * accel);
  movement.velocity.z += (desiredVelZ - movement.velocity.z) * Math.min(1, dt * accel);

  // ── Jump / coyote / buffer ──
  if (movement.isGrounded) movement.coyoteTimer = COYOTE_TIME;
  else movement.coyoteTimer = Math.max(0, movement.coyoteTimer - dt);

  movement.jumpBuffer = Math.max(0, movement.jumpBuffer - dt);

  if (movement.jumpBuffer > 0 && movement.coyoteTimer > 0 && !movement.isCrouching && !movement.isSliding) {
    gameState.pVelY = FP.jumpVelocity * (_perkHooks.jumpHeightMul ?? 1);
    movement.jumpBuffer = 0;
    movement.coyoteTimer = 0;
    jumped = true;
    playJump();
  }

  // ── Landing detection ──
  const floorY = getFloorY(gameState.player.position.x, gameState.player.position.z);
  if (!movement.isGrounded && gameState.pPosY <= floorY + 0.001) {
    const fallDist = movement.fallStartY - gameState.pPosY;
    const intensity = Math.min(1, fallDist / 6);
    playLand(intensity);
    shakeOnLand(fallDist);
    if (fallDist > 4) {
      // Hard landing — camera punch downward
      gameState.cameraPitch -= intensity * 0.06;
    }
    // Fall damage: anything above 5m deals increasing damage
    if (fallDist > 5) {
      const fallDmg = Math.round((fallDist - 5) * 10 * (_perkHooks.fallDamageMul ?? 1));
      dealDmgPlayer(fallDmg, null);
    }
    movement.airTime = 0;
  }

  if (gameState.pPosY > floorY + 0.05) {
    if (movement.isGrounded) movement.fallStartY = gameState.pPosY;
    movement.isGrounded = false;
    movement.airTime += dt;
  } else {
    movement.isGrounded = true;
  }

  // ── Mantle ──
  if (mantleTarget) {
    mantleTarget.t += dt * 4;
    const t = Math.min(1, mantleTarget.t);
    const eased = 1 - Math.pow(1 - t, 3);
    gameState.pPosY = THREE.MathUtils.lerp(gameState.pPosY, mantleTarget.y, eased);
    if (t >= 1) {
      gameState.pPosY = mantleTarget.y;
      gameState.pVelY = 0;
      // Push player forward on mantle completion
      const fwd = 0.6;
      gameState.player.position.x += -Math.sin(gameState.cameraYaw) * fwd;
      gameState.player.position.z += -Math.cos(gameState.cameraYaw) * fwd;
      mantleTarget = null;
    }
  } else if (jumped || (!movement.isGrounded && gameState.pVelY < 1 && movement.airTime > 0.1)) {
    const target = tryMantle();
    if (target !== null) {
      mantleTarget = {
        x: gameState.player.position.x,
        y: target,
        z: gameState.player.position.z,
        t: 0,
      };
    }
  }

  // ── Footsteps ──
  movement.footstepCooldown -= dt;
  const speedNow = Math.hypot(movement.velocity.x, movement.velocity.z);
  if (movement.isGrounded && speedNow > 1.5 && movement.footstepCooldown <= 0) {
    let interval = FOOTSTEP_INTERVAL_WALK;
    if (movement.isSprinting) interval = FOOTSTEP_INTERVAL_SPRINT;
    else if (speedNow > FP.moveSpeed * 0.7) interval = FOOTSTEP_INTERVAL_RUN;
    if (movement.isCrouching) interval *= 1.6; // softer, slower

    movement.footstepCooldown = interval;
    if (!movement.isCrouching) {
      const surf = detectSurface(gameState.camera.position);
      playFootstep(undefined as any, true, movement.sprintT, surf);
    }
    movement.bobPhase += Math.PI;
  }

  // Use desired velocity for the actual move step
  return {
    desiredVelX: movement.velocity.x,
    desiredVelZ: movement.velocity.z,
    jumped,
  };
}

/** Get camera offset from movement (for view sway). */
export function getCameraOffset(): { x: number; y: number; tilt: number; bob: number } {
  const speed = Math.hypot(movement.velocity.x, movement.velocity.z);
  const moving = speed > 0.5 && movement.isGrounded && !movement.isSliding;
  const bobAmt = moving ? (movement.isSprinting ? 0.05 : 0.025) * movement.headBobScale : 0;
  const bobY = Math.abs(Math.sin(movement.bobPhase * 0.5)) * bobAmt;
  const bobX = Math.sin(movement.bobPhase) * bobAmt * 0.4;
  return {
    x: movement.cameraOffsetX + bobX,
    y: bobY,
    tilt: movement.cameraTilt,
    bob: movement.bobPhase,
  };
}