/**
 * CameraShake — Trauma-based screen shake.
 *
 * Pattern from Squirrel Eiserloh's "Math for Game Programmers: Juice It or Lose It" talk.
 * Trauma value (0..1) decays over time. Actual shake amount is trauma² so high-trauma
 * events feel dramatic but small ones don't add noise.
 *
 * Multiple concurrent shake sources stack via max() not sum (prevents runaway shake
 * when many things happen at once — 3 explosions shouldn't shake 3× harder than 1).
 *
 * Output is added to camera pitch/yaw/roll each frame. Falls off with distance for
 * world-space sources (explosions, distant gunfire).
 */

import * as THREE from 'three';
import { gameState } from '@/core/GameState';

export type ShakeKind =
  | 'hit'           // bullet impact on player
  | 'land'          // hard landing
  | 'explosion'     // grenade/rocket nearby
  | 'shot'          // own weapon recoil shake
  | 'sprint_step'   // heavy footfall during sprint
  | 'death'         // dramatic shake on player death
  | 'low_hp'        // sustained tremble at very low health
  | 'killcam';      // smooth zoom shake

interface ShakeChannel {
  trauma: number;
  decay: number;        // per-second decay rate
  maxAngle: number;     // max angular displacement when trauma=1 (radians)
  maxOffset: number;    // max positional offset when trauma=1
  noiseSeed: number;    // unique offset into Perlin noise
  freq: number;         // shake frequency multiplier
}

const channels: Map<ShakeKind, ShakeChannel> = new Map();

const CHANNEL_DEFAULTS: Record<ShakeKind, Omit<ShakeChannel, 'trauma' | 'noiseSeed'>> = {
  hit:         { decay: 4.0, maxAngle: 0.04, maxOffset: 0.05, freq: 28 },
  land:        { decay: 5.5, maxAngle: 0.08, maxOffset: 0.10, freq: 22 },
  explosion:   { decay: 2.5, maxAngle: 0.10, maxOffset: 0.15, freq: 32 },
  shot:        { decay: 12,  maxAngle: 0.015, maxOffset: 0.02, freq: 40 },
  sprint_step: { decay: 8.0, maxAngle: 0.008, maxOffset: 0.015, freq: 14 },
  death:       { decay: 1.2, maxAngle: 0.18, maxOffset: 0.0, freq: 20 },
  low_hp:      { decay: 0.0, maxAngle: 0.012, maxOffset: 0.0, freq: 8 },
  killcam:     { decay: 1.5, maxAngle: 0.025, maxOffset: 0.0, freq: 12 },
};

let elapsedNoise = 0;
let _seedCounter = 1;

function getOrCreate(kind: ShakeKind): ShakeChannel {
  let ch = channels.get(kind);
  if (!ch) {
    ch = {
      ...CHANNEL_DEFAULTS[kind],
      trauma: 0,
      noiseSeed: (_seedCounter++) * 137.5,
    };
    channels.set(kind, ch);
  }
  return ch;
}

/**
 * Add trauma to a shake channel. Stacking uses max() — not additive.
 * intensity: 0..1 (clamped). Multiple events of same kind don't compound, they raise the floor.
 */
export function addTrauma(kind: ShakeKind, intensity: number): void {
  const ch = getOrCreate(kind);
  ch.trauma = Math.max(ch.trauma, Math.min(1, intensity));
}

/**
 * World-space trauma — falls off with distance from player.
 * Used for explosions, distant gunfire (suppression effect).
 */
export function addWorldTrauma(kind: ShakeKind, worldPos: THREE.Vector3, baseIntensity: number, falloffRadius: number): void {
  const dist = gameState.player.position.distanceTo(worldPos as any);
  if (dist > falloffRadius) return;
  const t = baseIntensity * (1 - dist / falloffRadius);
  addTrauma(kind, t);
}

/** Sustain trauma at a level (doesn't decay). Use for low-HP heartbeat tremble. */
export function setSustainedTrauma(kind: ShakeKind, intensity: number): void {
  const ch = getOrCreate(kind);
  ch.trauma = Math.min(1, intensity);
}

/**
 * Cheap pseudo-Perlin: smoothed noise from sin combinations.
 * Returns value in [-1, 1].
 */
function smoothNoise(t: number, seed: number): number {
  const a = Math.sin(t * 1.7 + seed);
  const b = Math.sin(t * 2.31 + seed * 1.3 + 0.5);
  const c = Math.sin(t * 0.93 + seed * 0.7 + 1.2);
  return (a * 0.5 + b * 0.3 + c * 0.2);
}

let _shakePitch = 0;
let _shakeYaw = 0;
let _shakeRoll = 0;
let _shakeOffsetX = 0;
let _shakeOffsetY = 0;

/**
 * Update all shake channels. Call once per frame BEFORE camera positioning in Player.ts.
 * Returns the accumulated camera offset to apply.
 */
export function updateCameraShake(dt: number): {
  pitch: number;
  yaw: number;
  roll: number;
  offsetX: number;
  offsetY: number;
} {
  elapsedNoise = (elapsedNoise + dt) % 1e4;

  let totalPitch = 0;
  let totalYaw = 0;
  let totalRoll = 0;
  let totalOffX = 0;
  let totalOffY = 0;

  for (const ch of channels.values()) {
    if (ch.trauma <= 0.001) continue;

    // Decay (skip for sustained channels)
    if (ch.decay > 0) {
      ch.trauma = Math.max(0, ch.trauma - ch.decay * dt);
    }

    // trauma² gives high-trauma events disproportionate weight
    const shake = ch.trauma * ch.trauma;
    const t = elapsedNoise * ch.freq;

    totalPitch += smoothNoise(t, ch.noiseSeed) * ch.maxAngle * shake;
    totalYaw   += smoothNoise(t, ch.noiseSeed + 50) * ch.maxAngle * shake;
    totalRoll  += smoothNoise(t, ch.noiseSeed + 100) * ch.maxAngle * 0.6 * shake;
    totalOffX  += smoothNoise(t, ch.noiseSeed + 150) * ch.maxOffset * shake;
    totalOffY  += smoothNoise(t, ch.noiseSeed + 200) * ch.maxOffset * shake;
  }

  // Smooth output a touch so it doesn't feel jittery at low intensity
  _shakePitch += (totalPitch - _shakePitch) * Math.min(1, dt * 30);
  _shakeYaw   += (totalYaw   - _shakeYaw)   * Math.min(1, dt * 30);
  _shakeRoll  += (totalRoll  - _shakeRoll)  * Math.min(1, dt * 30);
  _shakeOffsetX += (totalOffX - _shakeOffsetX) * Math.min(1, dt * 30);
  _shakeOffsetY += (totalOffY - _shakeOffsetY) * Math.min(1, dt * 30);

  return {
    pitch: _shakePitch,
    yaw: _shakeYaw,
    roll: _shakeRoll,
    offsetX: _shakeOffsetX,
    offsetY: _shakeOffsetY,
  };
}

/** Reset all shake — call on respawn / scene transitions. */
export function clearAllShake(): void {
  for (const ch of channels.values()) ch.trauma = 0;
  _shakePitch = _shakeYaw = _shakeRoll = 0;
  _shakeOffsetX = _shakeOffsetY = 0;
}

// ─────────────────────────────────────────────────────────────────────
//  CONVENIENCE WRAPPERS — semantic API for game systems
// ─────────────────────────────────────────────────────────────────────

export function shakeOnHit(damageFraction: number): void {
  // damageFraction: 0..1 of max HP
  addTrauma('hit', Math.min(1, damageFraction * 2.5 + 0.2));
}

export function shakeOnLand(fallDistance: number): void {
  // 4m+ feels like a real impact
  if (fallDistance < 1.5) return;
  const intensity = Math.min(1, (fallDistance - 1.5) / 6);
  addTrauma('land', intensity);
}

export function shakeOnExplosion(worldPos: THREE.Vector3, blastRadius: number): void {
  addWorldTrauma('explosion', worldPos, 1.0, blastRadius * 5);
}

export function shakeOnShot(weaponRecoilStrength: number): void {
  // weaponRecoilStrength: 0..1 from the weapon's recoilRot
  addTrauma('shot', Math.min(1, weaponRecoilStrength * 4));
}

export function shakeOnSprintStep(): void {
  addTrauma('sprint_step', 0.4);
}

export function shakeOnDeath(): void {
  addTrauma('death', 1.0);
}

export function updateLowHpShake(hpRatio: number): void {
  // Trembling kicks in below 30% HP, peaks at 0
  if (hpRatio < 0.3) {
    setSustainedTrauma('low_hp', 1 - hpRatio / 0.3);
  } else {
    setSustainedTrauma('low_hp', 0);
  }
}