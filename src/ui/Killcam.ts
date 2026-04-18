import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import type { TDMAgent } from '@/entities/TDMAgent';
import { dom } from './DOMElements';

interface CamSnapshot {
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  time: number;
}

const HISTORY_DURATION = 3.5;
const snapshots = new Map<TDMAgent, CamSnapshot[]>();

let active = false;
let killcamStart = 0;
let killcamDuration = 3.2;
let target: TDMAgent | null = null;
let killcamEl: HTMLDivElement | null = null;

let savedCamPos = new THREE.Vector3();
let savedCamRot = new THREE.Euler();

function ensureUI(): HTMLDivElement {
  if (killcamEl) return killcamEl;
  killcamEl = document.createElement('div');
  killcamEl.id = 'killcam';
  killcamEl.innerHTML = `
    <div class="kc-frame">
      <div class="kc-bar-top">
        <span class="kc-label">KILLCAM</span>
        <span class="kc-killer" id="kcKiller"></span>
      </div>
      <div class="kc-bar-bottom">
        <div class="kc-vignette"></div>
      </div>
    </div>
  `;
  document.body.appendChild(killcamEl);
  return killcamEl;
}

/**
 * Called every frame to record agent positions.
 */
export function recordKillcamSnapshot(): void {
  const now = gameState.worldElapsed;
  for (const ag of gameState.agents) {
    if (ag === gameState.player || ag.isDead || !ag.active) continue;
    let arr = snapshots.get(ag);
    if (!arr) { arr = []; snapshots.set(ag, arr); }

    // Compute yaw from rotation quaternion
    const qY = ag.rotation.y ?? 0;
    const qW = ag.rotation.w ?? 1;
    const yaw = 2 * Math.atan2(qY, qW);

    arr.push({
      pos: new THREE.Vector3(ag.position.x, ag.position.y + 1.6, ag.position.z),
      yaw,
      pitch: 0,
      time: now,
    });

    // Trim old
    while (arr.length > 0 && now - arr[0].time > HISTORY_DURATION) arr.shift();
  }
}

/**
 * Trigger the killcam.
 */
export function startKillcam(killer: TDMAgent | null): void {
  if (!killer || killer.isDead) return;
  const arr = snapshots.get(killer);
  if (!arr || arr.length < 5) return;

  active = true;
  target = killer;
  killcamStart = gameState.worldElapsed;

  const ui = ensureUI();
  ui.classList.add('on');
  const nameEl = document.getElementById('kcKiller');
  if (nameEl) nameEl.textContent = `KILLED BY ${killer.name.toUpperCase()}`;

  // Save current camera state to restore later
  savedCamPos.copy(gameState.camera.position);
  savedCamRot.copy(gameState.camera.rotation);
}

export function stopKillcam(): void {
  active = false;
  target = null;
  if (killcamEl) killcamEl.classList.remove('on');
  // Restore camera (Player.ts will overwrite anyway on respawn)
}

export function isKillcamActive(): boolean { return active; }

/**
 * Update killcam camera position — call from game loop while active.
 */
export function updateKillcam(dt: number): boolean {
  if (!active || !target) return false;

  const elapsed = gameState.worldElapsed - killcamStart;
  if (elapsed >= killcamDuration) {
    stopKillcam();
    return false;
  }

  const arr = snapshots.get(target);
  if (!arr || arr.length === 0) {
    stopKillcam();
    return false;
  }

  // Map elapsed (0..duration) onto the snapshot history (last 3s before death)
  const t = elapsed / killcamDuration;
  // We want to play from -3s to 0s in the snapshots
  const targetTime = arr[arr.length - 1].time - HISTORY_DURATION + t * HISTORY_DURATION;

  // Find nearest snapshots and interpolate
  let prev = arr[0];
  let next = arr[arr.length - 1];
  for (let i = 0; i < arr.length - 1; i++) {
    if (arr[i].time <= targetTime && arr[i + 1].time >= targetTime) {
      prev = arr[i];
      next = arr[i + 1];
      break;
    }
  }
  const segT = (targetTime - prev.time) / Math.max(0.001, next.time - prev.time);
  const pos = new THREE.Vector3().lerpVectors(prev.pos, next.pos, Math.max(0, Math.min(1, segT)));
  const yaw = THREE.MathUtils.lerp(prev.yaw, next.yaw, segT);

  // Position camera behind the killer's shoulder
  const offsetX = -Math.sin(yaw) * 1.2;
  const offsetZ = -Math.cos(yaw) * 1.2;
  gameState.camera.position.set(pos.x + offsetX, pos.y + 0.5, pos.z + offsetZ);

  // Look in killer's facing direction
  const lookTarget = new THREE.Vector3(
    pos.x + Math.sin(yaw) * 5,
    pos.y - 0.2,
    pos.z + Math.cos(yaw) * 5,
  );
  gameState.camera.lookAt(lookTarget);

  return true;
}

export function clearKillcamSnapshots(): void {
  snapshots.clear();
  active = false;
  target = null;
}

// ── Play of the Game replay ──
let potgActive = false;
let potgStart = 0;
const POTG_DURATION = 5;
let potgEl: HTMLDivElement | null = null;

function ensurePotgUI(): HTMLDivElement {
  if (potgEl) return potgEl;
  potgEl = document.createElement('div');
  potgEl.id = 'potg';
  potgEl.innerHTML = `
    <div class="potg-frame">
      <div class="potg-label">PLAY OF THE GAME</div>
      <div class="potg-name" id="potgName"></div>
    </div>
  `;
  potgEl.style.cssText = 'position:fixed;inset:0;z-index:800;display:none;pointer-events:none;';
  const frame = potgEl.querySelector('.potg-frame') as HTMLElement;
  frame.style.cssText = 'position:absolute;top:8%;left:50%;transform:translateX(-50%);text-align:center;font-family:var(--font);';
  const label = potgEl.querySelector('.potg-label') as HTMLElement;
  label.style.cssText = 'font-size:28px;font-weight:900;letter-spacing:6px;color:#ffcc33;text-shadow:0 0 20px #ffcc3366;';
  const name = potgEl.querySelector('.potg-name') as HTMLElement;
  name.style.cssText = 'font-size:18px;color:#fff;margin-top:6px;letter-spacing:2px;';
  document.body.appendChild(potgEl);
  return potgEl;
}

/**
 * Start the Play of the Game replay for a given agent.
 * Should be called just before showing round summary when a POTG agent exists.
 */
export function startPotgReplay(agent: TDMAgent): void {
  const arr = snapshots.get(agent);
  if (!arr || arr.length < 5) return;

  potgActive = true;
  potgStart = gameState.worldElapsed;
  target = agent;

  const ui = ensurePotgUI();
  ui.style.display = 'block';
  const nameEl = document.getElementById('potgName');
  if (nameEl) nameEl.textContent = agent === gameState.player ? 'YOU' : agent.name.toUpperCase();
}

export function isPotgActive(): boolean { return potgActive; }

export function updatePotgReplay(dt: number): boolean {
  if (!potgActive || !target) return false;

  const elapsed = gameState.worldElapsed - potgStart;
  if (elapsed >= POTG_DURATION) {
    potgActive = false;
    target = null;
    if (potgEl) potgEl.style.display = 'none';
    return false;
  }

  // Reuse killcam camera logic
  const arr = snapshots.get(target);
  if (!arr || arr.length === 0) {
    potgActive = false;
    if (potgEl) potgEl.style.display = 'none';
    return false;
  }

  const t = elapsed / POTG_DURATION;
  const targetTime = arr[arr.length - 1].time - HISTORY_DURATION + t * HISTORY_DURATION;

  let prev = arr[0];
  let next = arr[arr.length - 1];
  for (let i = 0; i < arr.length - 1; i++) {
    if (arr[i].time <= targetTime && arr[i + 1].time >= targetTime) {
      prev = arr[i]; next = arr[i + 1]; break;
    }
  }
  const segT = (targetTime - prev.time) / Math.max(0.001, next.time - prev.time);
  const pos = new THREE.Vector3().lerpVectors(prev.pos, next.pos, Math.max(0, Math.min(1, segT)));
  const yaw = THREE.MathUtils.lerp(prev.yaw, next.yaw, segT);

  const offsetX = -Math.sin(yaw) * 1.5;
  const offsetZ = -Math.cos(yaw) * 1.5;
  gameState.camera.position.set(pos.x + offsetX, pos.y + 0.6, pos.z + offsetZ);

  const lookTarget = new THREE.Vector3(
    pos.x + Math.sin(yaw) * 5,
    pos.y - 0.1,
    pos.z + Math.cos(yaw) * 5,
  );
  gameState.camera.lookAt(lookTarget);

  return true;
}

export function stopPotgReplay(): void {
  potgActive = false;
  target = null;
  if (potgEl) potgEl.style.display = 'none';
}