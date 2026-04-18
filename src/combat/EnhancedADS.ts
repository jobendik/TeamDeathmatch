/**
 * EnhancedADS — scope overlays, ADS accuracy multiplier, and idle sway.
 *
 * Works alongside the existing isADS / FOV logic in MovementController.
 * Adds the visual scope overlay and perk-aware accuracy modifier.
 *
 * Integration:
 *   - Call initEnhancedADS() once at bootstrap (after DOM is ready)
 *   - Replace `gameState.isADS = true/false` in EventManager with beginADS/endADS
 *   - Call updateOverlay() from GameLoop each frame
 *   - Use adsAccuracyMul() in spread calculations (EventManager / Hitscan)
 */

import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { getActivePerkHooks } from '@/config/Loadouts';
import { playADSIn } from '@/audio/SoundHooks';

// ─────────────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────────────

let overlayEl: HTMLDivElement | null = null;
let vignetteEl: HTMLDivElement | null = null;
let adsProgress = 0;          // 0=hip, 1=fully ADS (smoothed)

// Idle sway to simulate holding breath
let swayT  = 0;
let swayT2 = 0;
const SWAY_AMP  = 0.0007;   // radians — barely visible
const SWAY_FREQ = 0.55;

// ─────────────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────────────

export function initEnhancedADS(): void {
  if (overlayEl) return;

  // Scope overlay (sniper)
  overlayEl = document.createElement('div');
  overlayEl.id = 'adsOverlay';
  overlayEl.style.cssText = `
    position: fixed; inset: 0;
    z-index: 12;
    pointer-events: none;
    display: none;
    align-items: center;
    justify-content: center;
  `;

  overlayEl.innerHTML = `
    <svg id="sniperScopeSvg" viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg"
        style="width:min(800px,100vmin);height:min(800px,100vmin);pointer-events:none;display:none;">
      <defs>
        <radialGradient id="lensGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stop-color="rgba(10,20,35,0)"/>
          <stop offset="100%" stop-color="rgba(0,8,20,0.4)"/>
        </radialGradient>
        <mask id="scopeMask">
          <circle cx="400" cy="400" r="226" fill="white"/>
        </mask>
      </defs>
      <!-- Black fill outside lens -->
      <rect x="0" y="0" width="800" height="800" fill="black"/>
      <!-- Lens tint -->
      <circle cx="400" cy="400" r="226" fill="url(#lensGrad)"/>
      <!-- Crosshairs (masked to lens) -->
      <g mask="url(#scopeMask)" stroke="#b8d8f0" stroke-width="0.8" opacity="0.9">
        <line x1="0"   y1="400" x2="376" y2="400"/>
        <line x1="424" y1="400" x2="800" y2="400"/>
        <line x1="400" y1="0"   x2="400" y2="376"/>
        <line x1="400" y1="424" x2="400" y2="800"/>
        <!-- Mil-dot range markers -->
        <circle cx="340" cy="400" r="2.5" fill="#b8d8f0" stroke="none"/>
        <circle cx="370" cy="400" r="2.5" fill="#b8d8f0" stroke="none"/>
        <circle cx="430" cy="400" r="2.5" fill="#b8d8f0" stroke="none"/>
        <circle cx="460" cy="400" r="2.5" fill="#b8d8f0" stroke="none"/>
        <circle cx="400" cy="340" r="2.5" fill="#b8d8f0" stroke="none"/>
        <circle cx="400" cy="370" r="2.5" fill="#b8d8f0" stroke="none"/>
        <circle cx="400" cy="430" r="2.5" fill="#b8d8f0" stroke="none"/>
        <circle cx="400" cy="460" r="2.5" fill="#b8d8f0" stroke="none"/>
      </g>
      <!-- Center reticle -->
      <circle cx="400" cy="400" r="2" fill="#ff3030" opacity="0.85"/>
      <!-- Lens rim -->
      <circle cx="400" cy="400" r="226" fill="none" stroke="#0a1c2e" stroke-width="4"/>
      <circle cx="400" cy="400" r="230" fill="none" stroke="rgba(160,210,255,0.07)" stroke-width="1.5"/>
    </svg>
  `;

  document.body.appendChild(overlayEl);

  // Subtle dark vignette for non-sniper ADS
  vignetteEl = document.createElement('div');
  vignetteEl.id = 'adsVignette';
  vignetteEl.style.cssText = `
    position: fixed; inset: 0;
    z-index: 11;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.08s ease;
    background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.38) 100%);
  `;
  document.body.appendChild(vignetteEl);
}

// ─────────────────────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────────────────────

/** Begin ADS — sets isADS, plays sound, respects finisher lock. */
export function beginADS(weaponId: string): void {
  if (gameState._finisherLockMovement) return;
  if (weaponId === 'knife' || weaponId === 'unarmed') return;
  gameState.isADS = true;
  playADSIn();
}

/** End ADS. */
export function endADS(): void {
  gameState.isADS = false;
}

/**
 * Returns the spread accuracy multiplier for the current ADS state.
 * Accounts for transition progress and Steady Aim perk.
 * 1.0 = full hip spread; ~0.35 = fully ADS; lower with Steady Aim.
 */
export function adsAccuracyMul(): number {
  if (!gameState.isADS) return 1.0;
  const hooks = getActivePerkHooks();
  const base = hooks.steadyAim && gameState.pWeaponId === 'sniper_rifle' ? 0.08 : 0.35;
  // Slightly less accurate during transition (adsProgress: 0→1 as ADS settles)
  return base + (1.0 - base) * (1 - adsProgress) * 0.55;
}

/**
 * FOV is already managed by MovementController. Stub preserved
 * for forward-compatibility if that logic is moved here later.
 */
export function updateADSFov(
  _camera: THREE.PerspectiveCamera,
  _dt: number,
  _hipFov: number,
): void { /* handled by MovementController */ }

/**
 * Minimal idle sway when in ADS (barely visible, reduced by Steady Aim).
 * Modifies gameState.cameraYaw/cameraPitch directly.
 */
export function applyADSSway(_camera: THREE.PerspectiveCamera, dt: number): void {
  if (!gameState.isADS) return;
  const hooks = getActivePerkHooks();
  const amp = hooks.steadyAim ? SWAY_AMP * 0.15 : SWAY_AMP;
  swayT  += dt * SWAY_FREQ;
  swayT2 += dt * SWAY_FREQ * 1.4;
  gameState.cameraYaw    += Math.sin(swayT)       * amp;
  gameState.cameraPitch  += Math.sin(swayT2 * 0.8) * amp * 0.5;
}

/**
 * Called every frame from GameLoop.
 * Shows/hides scope overlay and vignette based on ADS + weapon state.
 */
export function updateOverlay(): void {
  const isADS    = gameState.isADS;
  const isSniper = gameState.pWeaponId === 'sniper_rifle';

  // Smooth ADS progress
  adsProgress += ((isADS ? 1 : 0) - adsProgress) * 0.2;

  if (isADS && isSniper) {
    // Full scope overlay
    if (overlayEl) {
      overlayEl.style.display = 'flex';
      const scopeSvg = document.getElementById('sniperScopeSvg') as SVGElement | null;
      if (scopeSvg) scopeSvg.style.display = 'block';
    }
    if (vignetteEl) vignetteEl.style.opacity = '0';
  } else {
    // Hide scope
    if (overlayEl) overlayEl.style.display = 'none';
    // Subtle vignette for non-sniper ADS
    if (vignetteEl) vignetteEl.style.opacity = isADS ? String(adsProgress * 0.55) : '0';
  }
}
