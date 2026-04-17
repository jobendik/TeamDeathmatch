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

  // Position camera over the killer's shoulder
  const offsetX = Math.sin(yaw) * 1.2;
  const offsetZ = Math.cos(yaw) * 1.2;
  gameState.camera.position.set(pos.x + offsetX, pos.y + 0.5, pos.z + offsetZ);

  // Look in killer's facing direction
  const lookTarget = new THREE.Vector3(
    pos.x - Math.sin(yaw) * 5,
    pos.y - 0.2,
    pos.z - Math.cos(yaw) * 5,
  );
  gameState.camera.lookAt(lookTarget);

  return true;
}

export function clearKillcamSnapshots(): void {
  snapshots.clear();
  active = false;
  target = null;
}