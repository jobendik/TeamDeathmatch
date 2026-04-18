/**
 * Suppression — makes getting shot AT (not just getting hit) feel dangerous.
 *
 * The concept: real combat isn't just damage trade math. When bullets crack
 * past your head you flinch, your ears ring, your aim wobbles, your vision
 * narrows. Battlefield figured this out in the 2000s and every AAA FPS
 * since has some version of it. Without it, getting shot at feels like a
 * videogame inconvenience. WITH it, breaking line-of-sight becomes a
 * moment-to-moment decision.
 *
 * Detection:
 *  - Bots firing hitscan call checkSuppressionFromShot() with their ray.
 *  - We compute the perpendicular distance from the player to the shot line
 *    within the shot's max range. If that distance is below SUPPRESS_RADIUS
 *    (and larger than an actual-hit radius), the player is being suppressed.
 *  - Projectile bullets (rockets, grenades) are in gameState.bullets and we
 *    sample their positions each frame.
 *
 * Effects on the player:
 *  - Visual: a DOM overlay with vignette + subtle blur + color desaturation
 *    pulses up with suppression level, fades down when it stops.
 *  - Mechanical: player's shots get a spread multiplier.
 *
 * Bots already have their own form of this in Perception.checkAudioAwareness
 * (near-miss suppression). We don't duplicate that here.
 */

import * as THREE from 'three';
import { gameState } from '@/core/GameState';

interface SuppressionState {
  level: number;          // 0-1
  lastPulseTime: number;
  overlayEl: HTMLDivElement | null;
}

const state: SuppressionState = {
  level: 0,
  lastPulseTime: -999,
  overlayEl: null,
};

// Tunables
const SUPPRESS_RADIUS = 3.0;         // meters — bullets within this zone count
const MIN_MISS_RADIUS = 0.55;        // smaller than this = actual hit, ignore
const SUPPRESS_PER_EVENT = 0.22;     // how much level gains per near-miss
const DECAY_RATE = 0.7;              // level decay per second
const MAX_ACCURACY_PENALTY = 0.55;   // +55% player spread at max suppression
const MAX_OVERLAY_OPACITY = 0.55;

// Cached temps
const _playerHead = new THREE.Vector3();
const _closestPoint = new THREE.Vector3();
const _toPlayer = new THREE.Vector3();
const _dirCache = new THREE.Vector3();

function ensureOverlay(): HTMLDivElement {
  if (state.overlayEl) return state.overlayEl;
  const el = document.createElement('div');
  el.id = 'suppressionOverlay';
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 3;
    pointer-events: none; opacity: 0;
    background:
      radial-gradient(ellipse at center,
        transparent 28%,
        rgba(40, 20, 10, 0.35) 62%,
        rgba(15, 8, 5, 0.85) 100%);
    mix-blend-mode: multiply;
    transition: opacity 0.18s ease-out;
    backdrop-filter: blur(0px) saturate(1);
    -webkit-backdrop-filter: blur(0px) saturate(1);
  `;
  document.body.appendChild(el);
  state.overlayEl = el;
  return el;
}

/**
 * Called from Hitscan.hitscanShot() when a NON-player fires.
 * `length` = actual distance the shot traveled (up to range or wall hit).
 */
export function checkSuppressionFromShot(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  length: number,
  ownerType: 'player' | 'ai',
): void {
  if (ownerType === 'player') return;
  if (gameState.pDead) return;

  _playerHead.set(
    gameState.player.position.x,
    gameState.pPosY + 1.1,
    gameState.player.position.z,
  );

  _toPlayer.subVectors(_playerHead, origin);
  _dirCache.copy(dir).normalize();

  const proj = _toPlayer.dot(_dirCache);
  if (proj < 0 || proj > length) return;

  _closestPoint.copy(origin).addScaledVector(_dirCache, proj);
  const dist = _closestPoint.distanceTo(_playerHead);

  if (dist > SUPPRESS_RADIUS) return;
  if (dist < MIN_MISS_RADIUS) return; // that was a hit, not a near-miss

  const proximity = 1 - (dist - MIN_MISS_RADIUS) / (SUPPRESS_RADIUS - MIN_MISS_RADIUS);
  state.level = Math.min(1, state.level + SUPPRESS_PER_EVENT * proximity);
  state.lastPulseTime = gameState.worldElapsed;
}

/**
 * Called each frame from the game loop.
 * Samples projectile bullets (rockets/grenades mid-flight) for suppression
 * contribution, decays the level, and updates the visual overlay.
 */
export function updateSuppression(dt: number): void {
  // Project-projectile sampling
  if (!gameState.pDead) {
    _playerHead.set(
      gameState.player.position.x,
      gameState.pPosY + 1.1,
      gameState.player.position.z,
    );

    const r2 = SUPPRESS_RADIUS * SUPPRESS_RADIUS;
    for (const b of gameState.bullets) {
      if (b.ownerType === 'player') continue;
      if (!b.isRocket && !b.isGrenade) continue;

      const dx = b.mesh.position.x - _playerHead.x;
      const dy = b.mesh.position.y - _playerHead.y;
      const dz = b.mesh.position.z - _playerHead.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r2 && d2 > MIN_MISS_RADIUS * MIN_MISS_RADIUS) {
        const d = Math.sqrt(d2);
        const proximity = 1 - (d - MIN_MISS_RADIUS) / (SUPPRESS_RADIUS - MIN_MISS_RADIUS);
        // Rockets/grenades suppress harder — they look scarier
        state.level = Math.min(1, state.level + SUPPRESS_PER_EVENT * proximity * 1.4 * dt);
        state.lastPulseTime = gameState.worldElapsed;
      }
    }
  }

  // Decay
  state.level = Math.max(0, state.level - dt * DECAY_RATE);

  // Visual overlay
  const overlay = ensureOverlay();
  const op = state.level * MAX_OVERLAY_OPACITY;
  overlay.style.opacity = String(op.toFixed(3));
  // Subtle camera wobble when heavily suppressed
  if (state.level > 0.4) {
    const wobble = (state.level - 0.4) * 0.015;
    gameState.cameraPitch += (Math.random() - 0.5) * wobble;
    gameState.cameraYaw += (Math.random() - 0.5) * wobble;
  }
}

/** Spread multiplier for the player's weapon — used by EventManager.onShoot. */
export function getSuppressionSpreadMul(): number {
  return 1 + state.level * MAX_ACCURACY_PENALTY;
}

/** 0-1 intensity — usable by post-process, HUD pulse, etc. */
export function getSuppressionLevel(): number {
  return state.level;
}

export function resetSuppression(): void {
  state.level = 0;
  if (state.overlayEl) state.overlayEl.style.opacity = '0';
}