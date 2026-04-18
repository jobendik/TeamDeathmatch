/**
 * Suppression — makes getting shot AT (not just getting hit) feel dangerous.
 *
 * Detection:
 *  - Bots firing hitscan call checkSuppressionFromShot() with their ray.
 *  - We compute the perpendicular distance from the player to the shot line.
 *    If within SUPPRESS_RADIUS (but not an actual hit), player is suppressed.
 *  - Projectile bullets (rockets, grenades) are sampled each frame.
 *
 * Effects on the player:
 *  - Visual: a DOM overlay with vignette + desaturation pulses up with level.
 *  - Mechanical: player's shots get a spread multiplier.
 *
 * Bots already have their own suppression in Perception.checkAudioAwareness.
 */

import * as THREE from 'three';
import { gameState } from '@/core/GameState';

interface SuppressionState {
  level: number;
  lastPulseTime: number;
  overlayEl: HTMLDivElement | null;
}

const state: SuppressionState = {
  level: 0,
  lastPulseTime: -999,
  overlayEl: null,
};

const SUPPRESS_RADIUS = 3.0;
const MIN_MISS_RADIUS = 0.55;
const SUPPRESS_PER_EVENT = 0.22;
const DECAY_RATE = 0.7;
const MAX_ACCURACY_PENALTY = 0.55;
const MAX_OVERLAY_OPACITY = 0.55;

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
  if (dist < MIN_MISS_RADIUS) return;

  const proximity = 1 - (dist - MIN_MISS_RADIUS) / (SUPPRESS_RADIUS - MIN_MISS_RADIUS);
  state.level = Math.min(1, state.level + SUPPRESS_PER_EVENT * proximity);
  state.lastPulseTime = gameState.worldElapsed;
}

/**
 * Called each frame from the game loop.
 */
export function updateSuppression(dt: number): void {
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
        state.level = Math.min(1, state.level + SUPPRESS_PER_EVENT * proximity * 1.4 * dt);
        state.lastPulseTime = gameState.worldElapsed;
      }
    }
  }

  state.level = Math.max(0, state.level - dt * DECAY_RATE);

  const overlay = ensureOverlay();
  const op = state.level * MAX_OVERLAY_OPACITY;
  overlay.style.opacity = String(op.toFixed(3));

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
