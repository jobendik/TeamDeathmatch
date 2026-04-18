/**
 * Recoil — per-weapon pattern-based recoil for the player.
 *
 * The feel you're going for: each weapon has a distinctive shape to its
 * kick. The first 3-5 shots of an AR should be controllable with a steady
 * mouse-down pull; later shots become chaotic so sustained fire is worse
 * than controlled bursts. A good player learns the pattern and counters it.
 *
 * Implementation:
 *  - Each weapon has an array of kicks (pitch, yaw) per shot. After the
 *    array ends, the last entry is reused (or you can add wobble).
 *  - The pattern index resets if the player stops firing for PATTERN_RESET_TIME.
 *  - After RECOVERY_DELAY of no firing, the accumulated visual kick returns
 *    to zero via smoothed lerp. This is the "camera settles back" effect.
 *  - ADS multiplies the whole pattern by ADS_RECOIL_MUL (smaller kicks while aiming).
 *  - Recovery only pulls pitch back UP (toward rest). If the player counter-
 *    pulled down below rest, we leave their pitch alone — that's their control.
 *
 * Bots deliberately do NOT use this. Their `HumanAim` + `aimError` + jitter
 * + panicSpray already produce natural-looking spray. Pattern recoil is
 * specifically a PLAYER skill expression.
 */

import { gameState } from '@/core/GameState';
import type { WeaponId } from '@/config/weapons';

export interface RecoilKick {
  pitch: number; // radians (positive = camera kicks up visually)
  yaw: number;   // radians (positive = camera kicks right)
}

/**
 * Patterns. These are starting values — hand-tune by feel.
 * Tuning advice:
 *  - Keep first 2-3 shots nearly vertical for controllability
 *  - Introduce horizontal drift around shot 5-7 for spray punishment
 *  - Heavy-hitters (sniper, shotgun, rocket) are single big kicks
 */
const RECOIL_PATTERNS: Partial<Record<WeaponId, RecoilKick[]>> = {
  pistol: [
    { pitch: 0.020, yaw: 0.002 },
    { pitch: 0.024, yaw: -0.003 },
    { pitch: 0.026, yaw: 0.004 },
  ],

  smg: [
    // Classic SMG: manageable first few shots, then scattered
    { pitch: 0.012, yaw: 0.001 },
    { pitch: 0.014, yaw: -0.003 },
    { pitch: 0.016, yaw: 0.004 },
    { pitch: 0.018, yaw: -0.005 },
    { pitch: 0.020, yaw: 0.006 },
    { pitch: 0.022, yaw: -0.007 },
    { pitch: 0.020, yaw: 0.008 },
    { pitch: 0.018, yaw: -0.008 },
    { pitch: 0.016, yaw: 0.010 },
    { pitch: 0.014, yaw: -0.011 },
  ],

  assault_rifle: [
    // AK-like pattern: strong up for 6 shots, then left drift, then snake
    { pitch: 0.024, yaw: 0.001 },
    { pitch: 0.026, yaw: -0.001 },
    { pitch: 0.028, yaw: 0.002 },
    { pitch: 0.030, yaw: 0.003 },
    { pitch: 0.032, yaw: -0.002 },
    { pitch: 0.030, yaw: -0.004 },
    { pitch: 0.028, yaw: -0.007 },
    { pitch: 0.024, yaw: -0.010 },
    { pitch: 0.020, yaw: -0.012 },
    { pitch: 0.018, yaw: -0.010 },
    { pitch: 0.016, yaw: 0.008 },
    { pitch: 0.014, yaw: 0.012 },
    { pitch: 0.012, yaw: -0.006 },
    { pitch: 0.012, yaw: 0.014 },
  ],

  shotgun: [
    { pitch: 0.065, yaw: 0.006 },
  ],

  sniper_rifle: [
    { pitch: 0.140, yaw: 0.008 }, // HUGE — forces scope re-acquire
  ],

  rocket_launcher: [
    { pitch: 0.090, yaw: 0.0 },
  ],

  knife: [],
  unarmed: [],
};

interface RecoilState {
  shotIdx: number;
  accumPitch: number; // total un-recovered pitch kick
  accumYaw: number;
  lastFireTime: number;
}

const state: RecoilState = {
  shotIdx: 0,
  accumPitch: 0,
  accumYaw: 0,
  lastFireTime: -999,
};

const PATTERN_RESET_TIME = 0.4;    // pause before pattern resets to shot 0
const RECOVERY_DELAY = 0.12;        // time after last shot before recovery starts
const RECOVERY_SPEED = 8;           // how fast the accumulated kick returns
const ADS_RECOIL_MUL = 0.55;        // ADS reduces recoil by ~45%
const CROUCH_RECOIL_MUL = 0.85;     // crouching slightly steadies

/**
 * Called from EventManager.onShoot() immediately after a successful shot.
 */
export function applyPlayerRecoil(weaponId: WeaponId): void {
  const pattern = RECOIL_PATTERNS[weaponId];
  if (!pattern || pattern.length === 0) return;

  const now = gameState.worldElapsed;
  if (now - state.lastFireTime > PATTERN_RESET_TIME) {
    state.shotIdx = 0;
  }
  state.lastFireTime = now;

  const idx = Math.min(state.shotIdx, pattern.length - 1);
  const kick = pattern[idx];

  // Modifiers
  let mul = 1;
  if (gameState.isADS) mul *= ADS_RECOIL_MUL;
  // Crouch check — pull from movement module if available
  // (Small optional steady bonus; safe to skip if crouch state not exposed)
  // We'll leave crouch off to keep this module dependency-free.

  // Natural variance so two identical shots don't feel identical
  const pitchJitter = 0.88 + Math.random() * 0.24;
  const yawJitter   = 0.75 + Math.random() * 0.5;

  const pitchKick = kick.pitch * mul * pitchJitter;
  const yawKick   = kick.yaw   * mul * yawJitter;

  // Apply to camera. In this project, camera.rotation.order is 'YXZ' with
  // pitch = cameraPitch. Positive cameraPitch = looking UP. So add.
  gameState.cameraPitch += pitchKick;
  gameState.cameraYaw   += yawKick;

  // Clamp pitch so it doesn't punch through the ceiling
  gameState.cameraPitch = Math.min(gameState.cameraPitch, 1.3);

  // Track accumulated for recovery
  state.accumPitch += pitchKick;
  state.accumYaw   += yawKick;

  state.shotIdx++;
}

/**
 * Called every frame from the game loop.
 *
 * Behavior:
 *  - Only recovers after RECOVERY_DELAY of no firing.
 *  - Only pulls pitch DOWN (toward rest) if accumPitch > 0.
 *    If the player pulled their mouse down below rest (overcorrection),
 *    accumPitch can become effectively "consumed" and we stop touching pitch.
 *  - Yaw recovery is much gentler and only applied ~30% strength so
 *    horizontal kicks stay as felt corrections, not auto-returned.
 */
export function updatePlayerRecoilRecovery(dt: number): void {
  const now = gameState.worldElapsed;
  if (now - state.lastFireTime < RECOVERY_DELAY) return;
  if (state.accumPitch <= 0 && Math.abs(state.accumYaw) < 0.0001) return;

  const k = Math.min(1, RECOVERY_SPEED * dt);

  // Pitch: pull camera back down the amount of accumulated upward kick
  if (state.accumPitch > 0) {
    const pitchBack = state.accumPitch * k;
    gameState.cameraPitch -= pitchBack;
    state.accumPitch -= pitchBack;
    if (state.accumPitch < 0.0005) state.accumPitch = 0;
  }

  // Yaw: gentle recenter, don't fight the player's aim
  if (Math.abs(state.accumYaw) > 0.0005) {
    const yawBack = state.accumYaw * k * 0.3;
    gameState.cameraYaw -= yawBack;
    state.accumYaw -= yawBack;
  } else {
    state.accumYaw = 0;
  }
}

export function resetPlayerRecoil(): void {
  state.shotIdx = 0;
  state.accumPitch = 0;
  state.accumYaw = 0;
  state.lastFireTime = -999;
}

/**
 * Exposed so the HUD can show a dynamic crosshair that reflects accumulated
 * recoil (wider crosshair during sustained fire). Optional integration.
 */
export function getRecoilSpreadContribution(): number {
  return Math.min(6, state.accumPitch * 60); // tunable scale
}