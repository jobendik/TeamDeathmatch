/**
 * Finishers — cinematic melee executions from behind.
 *
 * Mechanics:
 *   - Hold melee (V) while within 1.6m of an enemy's back cone → initiate finisher
 *   - During finisher: player is locked, camera swings to cinematic angle,
 *     brief slow-mo (0.5x), 2-3 second animation, bonus XP on kill
 *   - Target is suppressed (cannot move/shoot) for the duration
 *   - If target is damaged by anyone else mid-finisher, it completes early
 *
 * Integration points:
 *   - Input: V hold → tryInitiateFinisher()
 *   - Player movement: locked during finisher.active
 *   - Combat.ts: dealDmgAgent blocked on target during finisher (kill applied at climax)
 *   - Rendering: cinematic camera override
 *   - XP: +200 "Brutal" bonus, +1 finisher accolade
 *
 * Back-cone check: target must be facing away (player-to-target angle
 * vs target's forward direction within 110°)
 */

import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { dealDmgAgent } from '@/combat/Combat';
import { awardAccountXP, profileMutate } from '@/core/PlayerProfile';
import { announce } from '@/ui/Announcer';

const FINISHER_RANGE = 1.8;
const FINISHER_BACK_CONE_DEG = 110;
const FINISHER_DURATION = 2.6;
const FINISHER_DAMAGE_TIME = 1.9;   // when in the animation the lethal hit lands
const TIME_SCALE_DURING = 0.55;
const XP_REWARD = 250;

interface FinisherState {
  active: boolean;
  phase: 'init' | 'executing' | 'climax' | 'exit';
  t: number;
  target: any | null;          // TDMAgent (avoiding circular import)
  targetStartPos: THREE.Vector3;
  targetStartQuat: THREE.Quaternion;
  attackerStartPos: THREE.Vector3;
  attackerStartPitch: number;
  attackerStartYaw: number;
  cameraBase: THREE.Vector3;
  lethalDelivered: boolean;
  variant: 'stab' | 'snap_neck' | 'tackle';
}

export const finisherState: FinisherState = {
  active: false,
  phase: 'init',
  t: 0,
  target: null,
  targetStartPos: new THREE.Vector3(),
  targetStartQuat: new THREE.Quaternion(),
  attackerStartPos: new THREE.Vector3(),
  attackerStartPitch: 0,
  attackerStartYaw: 0,
  cameraBase: new THREE.Vector3(),
  lethalDelivered: false,
  variant: 'stab',
};

// Original time scale to restore
let cachedTimeScale = 1;

// ─────────────────────────────────────────────────────────────────────
//  DETECTION
// ─────────────────────────────────────────────────────────────────────

function isTargetInBackCone(attacker: THREE.Object3D, target: THREE.Object3D): boolean {
  const toAttacker = new THREE.Vector3().subVectors(attacker.position, target.position);
  toAttacker.y = 0;
  if (toAttacker.lengthSq() < 1e-4) return false;
  toAttacker.normalize();

  const targetFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(target.quaternion);
  targetFwd.y = 0;
  if (targetFwd.lengthSq() < 1e-4) return false;
  targetFwd.normalize();

  // Attacker should be BEHIND target: dot(toAttacker, targetFwd) is negative
  const dot = toAttacker.dot(targetFwd);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
  // Behind = angle > 180 - halfCone/2
  // dot < 0 means attacker is behind; dot near -1 means directly behind
  return dot < 0 && angle > (180 - FINISHER_BACK_CONE_DEG / 2);
}

/**
 * Find a valid finisher target near the player, or null.
 */
export function findFinisherTarget(): any | null {
  const player = gameState.player;
  if (!player || !player.renderComponent) return null;
  if (player.hp <= 0) return null;
  if (finisherState.active) return null;

  const pPos = player.renderComponent.position;
  let best: any = null;
  let bestDist = FINISHER_RANGE;

  const agents = gameState.agents ?? [];
  for (const agent of agents) {
    if (!agent || agent.hp <= 0) continue;
    if (agent.team === player.team) continue;
    if (!agent.renderComponent) continue;

    const dist = agent.renderComponent.position.distanceTo(pPos);
    if (dist > bestDist) continue;
    if (!isTargetInBackCone(player.renderComponent, agent.renderComponent)) continue;

    best = agent;
    bestDist = dist;
  }

  return best;
}

// ─────────────────────────────────────────────────────────────────────
//  INITIATION
// ─────────────────────────────────────────────────────────────────────

export function tryInitiateFinisher(): boolean {
  const target = findFinisherTarget();
  if (!target) return false;
  const player = gameState.player;
  if (!player?.renderComponent) return false;

  finisherState.active = true;
  finisherState.phase = 'init';
  finisherState.t = 0;
  finisherState.target = target;
  finisherState.targetStartPos.copy(target.renderComponent!.position);
  finisherState.targetStartQuat.copy(target.renderComponent!.quaternion);
  finisherState.attackerStartPos.copy(player.renderComponent!.position);
  finisherState.attackerStartPitch = gameState.camera?.rotation.x ?? 0;
  finisherState.attackerStartYaw = gameState.camera?.rotation.y ?? 0;
  finisherState.cameraBase.copy(gameState.camera?.position ?? player.renderComponent!.position);
  finisherState.lethalDelivered = false;

  const variants: Array<'stab' | 'snap_neck' | 'tackle'> = ['stab', 'snap_neck', 'tackle'];
  finisherState.variant = variants[Math.floor(Math.random() * variants.length)];

  // Mark target suppressed
  target._finisherSuppressed = true;
  target._finisherBy = player;

  // Cache and apply time scale
  cachedTimeScale = gameState.timeScale ?? 1;
  gameState.timeScale = TIME_SCALE_DURING;

  // Lock player movement
  gameState._finisherLockMovement = true;

  // Play sound
  import('@/audio/SoundHooks').then(s => {
    try { (s as any).playMelee?.() ?? (s as any).playHit?.(); } catch { /* */ }
  }).catch(() => { /* */ });

  return true;
}

// ─────────────────────────────────────────────────────────────────────
//  UPDATE (called from GameLoop)
// ─────────────────────────────────────────────────────────────────────

export function updateFinisher(dt: number): void {
  if (!finisherState.active) return;

  // Advance using real time (ignore timeScale so we're not slow-mo on our own timer)
  finisherState.t += dt / Math.max(0.1, gameState.timeScale ?? 1);

  const t = finisherState.t;
  const player = gameState.player;
  const target = finisherState.target;
  const camera = gameState.camera as THREE.Camera | undefined;

  if (!player?.renderComponent || !target?.renderComponent) {
    endFinisher();
    return;
  }

  // Phase 1: position snap (0 - 0.25s)
  if (t < 0.3) {
    // Snap player behind target
    const targetFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(target.renderComponent!.quaternion);
    const behindOffset = targetFwd.multiplyScalar(-1.1);
    const desiredPos = target.renderComponent!.position.clone().add(behindOffset);
    player.renderComponent!.position.lerp(desiredPos, 0.25);

    // Face attacker toward target
    const toTarget = target.renderComponent!.position.clone().sub(player.renderComponent!.position);
    const desiredYaw = Math.atan2(toTarget.x, toTarget.z);
    if (camera) {
      (camera as any).rotation.y = desiredYaw;
      (camera as any).rotation.x = -0.12;
    }
  }

  // Phase 2: cinematic camera swing (0.3 - 1.8s)
  if (t >= 0.3 && t < 2.1) {
    if (camera) {
      const orbitT = (t - 0.3) / 1.8;
      const orbitAngle = -Math.PI * 0.15 + orbitT * Math.PI * 0.6;
      const orbitRadius = 2.4;
      const orbitHeight = 1.5 + Math.sin(orbitT * Math.PI) * 0.4;

      const targetFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(target.renderComponent!.quaternion);
      const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), targetFwd);
      const camOffset = side.multiplyScalar(Math.sin(orbitAngle) * orbitRadius)
                            .add(targetFwd.clone().multiplyScalar(-Math.cos(orbitAngle) * orbitRadius * 0.8));
      camOffset.y = orbitHeight;

      const desiredCamPos = target.renderComponent!.position.clone().add(camOffset);
      camera.position.lerp(desiredCamPos, 0.15);
      camera.lookAt(target.renderComponent!.position.x, target.renderComponent!.position.y + 1.2, target.renderComponent!.position.z);
    }
  }

  // Lethal hit at climax
  if (!finisherState.lethalDelivered && t >= FINISHER_DAMAGE_TIME) {
    finisherState.lethalDelivered = true;
    deliverLethal();
  }

  // End animation
  if (t >= FINISHER_DURATION) {
    endFinisher();
  }
}

function deliverLethal(): void {
  const player = gameState.player;
  const target = finisherState.target;
  if (!player || !target) return;

  // Apply lethal damage. `isMelee` / `isFinisher` flags let Combat score it properly
  const damage = 9999;
  target._finisherSuppressed = false; // unlock so damage actually registers
  try {
    dealDmgAgent(target, damage, player);
  } catch {
    // Fallback: hard-kill
    target.hp = 0;
    if (typeof target.onDeath === 'function') {
      try { target.onDeath(player); } catch { /* */ }
    }
  }

  // XP + accolade
  awardAccountXP(XP_REWARD, 'finisher');
  profileMutate((p) => {
    p.career.finishers = (p.career.finishers ?? 0) + 1;
  });

  announce('FINISHER', {
    sub: `+${XP_REWARD} XP · Brutal`,
    tier: 'large',
    color: '#ff2266',
    duration: 2,
  });

  // Impact sound
  import('@/audio/SoundHooks').then(s => {
    try { (s as any).playHeadshot?.() ?? (s as any).playHit?.(); } catch { /* */ }
  }).catch(() => { /* */ });
}

function endFinisher(): void {
  // Restore
  gameState.timeScale = cachedTimeScale;
  gameState._finisherLockMovement = false;

  const target = finisherState.target;
  if (target) {
    target._finisherSuppressed = false;
    target._finisherBy = null;
  }

  finisherState.active = false;
  finisherState.phase = 'exit';
  finisherState.target = null;
}

/**
 * Abort the current finisher (e.g. player took critical damage).
 */
export function abortFinisher(): void {
  if (!finisherState.active) return;
  endFinisher();
}

// ─────────────────────────────────────────────────────────────────────
//  PROMPT UI — "Hold V to Execute" when in range
// ─────────────────────────────────────────────────────────────────────

let promptEl: HTMLDivElement | null = null;

function ensurePrompt(): HTMLDivElement {
  if (promptEl) return promptEl;
  promptEl = document.createElement('div');
  promptEl.id = 'finisherPrompt';
  document.body.appendChild(promptEl);
  const s = document.createElement('style');
  s.textContent = `
    #finisherPrompt {
      position: fixed; left: 50%; top: 60%;
      transform: translateX(-50%);
      z-index: 9;
      pointer-events: none;
      display: none;
      color: #ff2266;
      font-family: 'Consolas', monospace;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.25em;
      text-shadow: 0 0 8px rgba(255,34,102,0.7), 0 0 16px rgba(255,34,102,0.4);
      padding: 8px 18px;
      background: linear-gradient(90deg, transparent, rgba(30,0,10,0.7), transparent);
      border-top: 1px solid rgba(255,34,102,0.5);
      border-bottom: 1px solid rgba(255,34,102,0.5);
      animation: finPulse 1s ease-in-out infinite;
    }
    #finisherPrompt.show { display: block; }
    @keyframes finPulse {
      0%, 100% { opacity: 0.7; }
      50% { opacity: 1; }
    }
  `;
  document.head.appendChild(s);
  return promptEl;
}

export function updateFinisherPrompt(): void {
  const el = ensurePrompt();
  if (finisherState.active) {
    el.classList.remove('show');
    return;
  }
  const target = findFinisherTarget();
  if (target) {
    el.innerHTML = `◢ HOLD [V] TO EXECUTE ◣`;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}

// ─────────────────────────────────────────────────────────────────────
//  INPUT — V key hold detection
// ─────────────────────────────────────────────────────────────────────

let vHoldStart = 0;
const V_HOLD_REQUIRED_MS = 220;

export function onMeleeKeyDown(): void {
  vHoldStart = performance.now();
}

export function onMeleeKeyUp(): void {
  vHoldStart = 0;
}

/**
 * Call every frame to poll the finisher key hold.
 */
export function pollFinisherInput(): void {
  if (finisherState.active) return;
  if (vHoldStart === 0) return;
  if (performance.now() - vHoldStart >= V_HOLD_REQUIRED_MS) {
    tryInitiateFinisher();
    vHoldStart = 0;
  }
}

export function initFinishers(): void {
  ensurePrompt();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && !e.repeat) onMeleeKeyDown();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyV') onMeleeKeyUp();
  });
}