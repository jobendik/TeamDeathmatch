/**
 * Hardpoint — rotating hill/zone, hold it to score.
 *
 * Rules:
 *   - Single active hardpoint at any time
 *   - Rotates between N positions every 60 seconds
 *   - While zone is UNCONTESTED and one team is inside: +1 point/sec
 *   - Contested = frozen
 *   - First team to 250 (configurable) wins
 *
 * This is a natural fit for Warzone TDM's existing arena — it funnels fights
 * into fast, reactive engagements.
 *
 * Integration: identical to Domination.ts — register as a GameMode, have
 * GameLoop tick updateHardpoint(dt), and expose getHardpointPriority() for AI.
 */

import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { announce } from '@/ui/Announcer';

export interface HardpointPosition {
  id: string;
  position: THREE.Vector3;
  radius: number;
  name: string;
}

export interface HardpointState {
  positions: HardpointPosition[];
  activeIndex: number;
  timeOnPoint: number;      // how long current point has been active
  rotateInterval: number;   // seconds before rotation
  scoreBlue: number;
  scoreRed: number;
  scoreLimit: number;
  elapsed: number;
  contested: boolean;
  holder: 'blue' | 'red' | null;
  playersInPoint: { blue: number; red: number };
  ended: boolean;
  winner: 'blue' | 'red' | 'draw' | null;
  mesh: THREE.Object3D | null;
  scene: THREE.Scene | null;
}

let state: HardpointState | null = null;

const DEFAULT_POSITIONS: HardpointPosition[] = [
  { id: 'crossfire', name: 'CROSSFIRE', position: new THREE.Vector3(-15, 0.1, -10), radius: 5.5 },
  { id: 'bunker', name: 'BUNKER', position: new THREE.Vector3(0, 0.1, 15), radius: 5.5 },
  { id: 'overwatch', name: 'OVERWATCH', position: new THREE.Vector3(18, 0.1, -8), radius: 5.5 },
  { id: 'center', name: 'CENTER', position: new THREE.Vector3(0, 0.1, -2), radius: 5.5 },
  { id: 'eastyard', name: 'EAST YARD', position: new THREE.Vector3(22, 0.1, 12), radius: 5.5 },
];

// ─────────────────────────────────────────────────────────────────────

function makeHardpointVisual(scene: THREE.Scene, pos: HardpointPosition): THREE.Object3D {
  const group = new THREE.Group();
  group.position.copy(pos.position);

  // Tall holographic cylinder
  const cylGeo = new THREE.CylinderGeometry(pos.radius, pos.radius, 8, 48, 1, true);
  const cylMat = new THREE.MeshBasicMaterial({
    color: 0xffcc44, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
  });
  const cyl = new THREE.Mesh(cylGeo, cylMat);
  cyl.position.y = 4;
  group.add(cyl);
  (group as any).userData.cylMat = cylMat;

  // Ground ring
  const ringGeo = new THREE.RingGeometry(pos.radius - 0.3, pos.radius + 0.1, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffcc44, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  group.add(ring);
  (group as any).userData.ringMat = ringMat;

  // Inner disc
  const discGeo = new THREE.CircleGeometry(pos.radius, 64);
  const discMat = new THREE.MeshBasicMaterial({
    color: 0xffcc44, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.03;
  group.add(disc);
  (group as any).userData.discMat = discMat;

  // Animated beacon beam
  const beamGeo = new THREE.CylinderGeometry(0.6, 0.1, 40, 16, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffcc44, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 20;
  group.add(beam);
  (group as any).userData.beamMat = beamMat;

  scene.add(group);
  return group;
}

function updateHardpointVisual(): void {
  if (!state?.mesh) return;
  const ud = (state.mesh as any).userData;
  const cylMat = ud.cylMat as THREE.MeshBasicMaterial;
  const ringMat = ud.ringMat as THREE.MeshBasicMaterial;
  const discMat = ud.discMat as THREE.MeshBasicMaterial;
  const beamMat = ud.beamMat as THREE.MeshBasicMaterial;

  let color = 0xffcc44;
  if (state.contested) color = 0xffaa00;
  else if (state.holder === 'blue') color = 0x4a9eff;
  else if (state.holder === 'red') color = 0xff5544;

  cylMat.color.setHex(color);
  ringMat.color.setHex(color);
  discMat.color.setHex(color);
  beamMat.color.setHex(color);

  // Pulse
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.005);
  beamMat.opacity = 0.25 + pulse * 0.3;
  discMat.opacity = 0.08 + pulse * 0.12;

  // Rotation
  state.mesh.rotation.y += 0.008;
}

// ─────────────────────────────────────────────────────────────────────

export function initHardpoint(
  scene: THREE.Scene,
  positions?: HardpointPosition[],
  scoreLimit: number = 250,
  rotateInterval: number = 60,
): HardpointState {
  state = {
    positions: positions ?? DEFAULT_POSITIONS,
    activeIndex: 0,
    timeOnPoint: 0,
    rotateInterval,
    scoreBlue: 0,
    scoreRed: 0,
    scoreLimit,
    elapsed: 0,
    contested: false,
    holder: null,
    playersInPoint: { blue: 0, red: 0 },
    ended: false,
    winner: null,
    mesh: null,
    scene,
  };

  state.mesh = makeHardpointVisual(scene, state.positions[0]);
  createHardpointHud();
  announce('HARDPOINT', {
    sub: `Hold the hill · First to ${scoreLimit}`,
    tier: 'high', duration: 3,
  });
  announceRotation(state.positions[0].name);
  return state;
}

function rotateHardpoint(): void {
  if (!state || !state.scene) return;
  state.activeIndex = (state.activeIndex + 1) % state.positions.length;
  state.timeOnPoint = 0;
  state.contested = false;
  state.holder = null;

  // Dispose old mesh, create new one
  if (state.mesh) {
    state.mesh.parent?.remove(state.mesh);
    state.mesh.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material?.dispose();
      }
    });
  }
  state.mesh = makeHardpointVisual(state.scene, state.positions[state.activeIndex]);
  announceRotation(state.positions[state.activeIndex].name);
}

function announceRotation(name: string): void {
  announce('HILL MOVED', {
    sub: `New position: ${name}`,
    tier: 'medium',
    color: '#ffcc44',
    duration: 2.5,
  });
  import('@/audio/SoundHooks').then(s => {
    try { (s as any).playObjective?.() ?? (s as any).playAlert?.(); } catch { /* */ }
  }).catch(() => { /* */ });
}

// ─────────────────────────────────────────────────────────────────────

export function updateHardpoint(dt: number): void {
  if (!state || state.ended) return;

  state.elapsed += dt;
  state.timeOnPoint += dt;

  if (state.timeOnPoint >= state.rotateInterval) {
    rotateHardpoint();
  }

  const active = state.positions[state.activeIndex];
  const radiusSq = active.radius * active.radius;

  state.playersInPoint.blue = 0;
  state.playersInPoint.red = 0;

  const player = gameState.player;
  if (player && player.health > 0 && player.mesh) {
    const dx = player.mesh.position.x - active.position.x;
    const dz = player.mesh.position.z - active.position.z;
    if (dx * dx + dz * dz <= radiusSq) {
      if (player.team === 'blue') state.playersInPoint.blue++;
      else if (player.team === 'red') state.playersInPoint.red++;
    }
  }
  const agents = (gameState as any).agents ?? [];
  for (const a of agents) {
    if (!a || a.health <= 0 || !a.mesh) continue;
    const dx = a.mesh.position.x - active.position.x;
    const dz = a.mesh.position.z - active.position.z;
    if (dx * dx + dz * dz <= radiusSq) {
      if (a.team === 'blue') state.playersInPoint.blue++;
      else if (a.team === 'red') state.playersInPoint.red++;
    }
  }

  state.contested = state.playersInPoint.blue > 0 && state.playersInPoint.red > 0;

  if (state.contested) {
    state.holder = null;
  } else if (state.playersInPoint.blue > 0) {
    state.holder = 'blue';
    state.scoreBlue += dt;
  } else if (state.playersInPoint.red > 0) {
    state.holder = 'red';
    state.scoreRed += dt;
  } else {
    state.holder = null;
  }

  updateHardpointVisual();

  if (Math.floor(state.scoreBlue) >= state.scoreLimit) endMatch('blue');
  else if (Math.floor(state.scoreRed) >= state.scoreLimit) endMatch('red');

  updateHardpointHud();
}

function endMatch(winner: 'blue' | 'red' | 'draw'): void {
  if (!state) return;
  state.ended = true;
  state.winner = winner;
  const label = winner === 'draw' ? 'DRAW' : winner === 'blue' ? 'BLUE VICTORY' : 'RED VICTORY';
  announce(label, {
    sub: `${Math.floor(state.scoreBlue)} : ${Math.floor(state.scoreRed)}`,
    tier: 'high',
    color: winner === 'blue' ? '#4a9eff' : winner === 'red' ? '#ff5544' : '#ffcc44',
    duration: 5,
  });
}

// ─────────────────────────────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────────────────────────────

let hudEl: HTMLDivElement | null = null;

function createHardpointHud(): void {
  if (hudEl) hudEl.remove();
  hudEl = document.createElement('div');
  hudEl.id = 'hpHud';
  hudEl.innerHTML = `
    <div class="hp-top">
      <div class="hp-score hp-blue"><div class="hp-team">BLU</div><div class="hp-num" id="hpBlue">0</div></div>
      <div class="hp-point">
        <div class="hp-label">CURRENT HARDPOINT</div>
        <div class="hp-name" id="hpName">—</div>
        <div class="hp-timer-wrap"><div class="hp-timer-fill" id="hpTimerFill"></div></div>
      </div>
      <div class="hp-score hp-red"><div class="hp-team">RED</div><div class="hp-num" id="hpRed">0</div></div>
    </div>
  `;
  document.body.appendChild(hudEl);

  if (!document.getElementById('hpHudStyle')) {
    const s = document.createElement('style');
    s.id = 'hpHudStyle';
    s.textContent = `
      #hpHud {
        position: fixed; top: 18px; left: 50%;
        transform: translateX(-50%);
        z-index: 7; pointer-events: none;
        font-family: 'Consolas', 'JetBrains Mono', monospace;
      }
      .hp-top {
        display: flex; gap: 14px; align-items: stretch;
        background: rgba(8,14,24,0.9);
        border-top: 1px solid rgba(255,204,68,0.3);
        border-bottom: 1px solid rgba(255,204,68,0.3);
        padding: 8px 16px;
      }
      .hp-score {
        display: flex; flex-direction: column; align-items: center;
        min-width: 60px; justify-content: center;
      }
      .hp-team { font-size: 9px; letter-spacing: 0.22em; font-weight: 700; opacity: 0.7; }
      .hp-num { font-size: 22px; font-weight: 800; line-height: 1; }
      .hp-blue .hp-num, .hp-blue .hp-team { color: #4a9eff; }
      .hp-red .hp-num, .hp-red .hp-team { color: #ff5544; }
      .hp-point {
        min-width: 180px; text-align: center;
        display: flex; flex-direction: column; gap: 3px; justify-content: center;
      }
      .hp-label { font-size: 8px; letter-spacing: 0.25em; opacity: 0.55; }
      .hp-name {
        font-size: 14px; font-weight: 800; letter-spacing: 0.15em;
        color: #ffcc44;
        text-shadow: 0 0 8px rgba(255,204,68,0.4);
      }
      .hp-name.contested { color: #ff8844; animation: hpFlash 0.6s infinite; }
      .hp-name.blue { color: #4a9eff; }
      .hp-name.red { color: #ff5544; }
      @keyframes hpFlash {
        50% { opacity: 0.6; }
      }
      .hp-timer-wrap {
        height: 2px; background: rgba(255,255,255,0.15);
        border-radius: 1px; overflow: hidden;
      }
      .hp-timer-fill {
        height: 100%; width: 0%;
        background: linear-gradient(90deg, #ffcc44, #ff8833);
        transition: width 0.3s linear;
      }
    `;
    document.head.appendChild(s);
  }
}

function updateHardpointHud(): void {
  if (!state || !hudEl) return;
  (document.getElementById('hpBlue') as HTMLElement).textContent = String(Math.floor(state.scoreBlue));
  (document.getElementById('hpRed') as HTMLElement).textContent = String(Math.floor(state.scoreRed));
  const nameEl = document.getElementById('hpName') as HTMLElement;
  if (nameEl) {
    nameEl.textContent = state.positions[state.activeIndex].name;
    nameEl.className = 'hp-name';
    if (state.contested) nameEl.classList.add('contested');
    else if (state.holder === 'blue') nameEl.classList.add('blue');
    else if (state.holder === 'red') nameEl.classList.add('red');
  }
  const fill = document.getElementById('hpTimerFill') as HTMLElement;
  if (fill) {
    const pct = (state.timeOnPoint / state.rotateInterval) * 100;
    fill.style.width = `${pct}%`;
  }
}

// ─────────────────────────────────────────────────────────────────────
//  PUBLIC
// ─────────────────────────────────────────────────────────────────────

export function getHardpointState(): HardpointState | null { return state; }

export function getHardpointPriority(): { pos: THREE.Vector3; priority: number } | null {
  if (!state) return null;
  const active = state.positions[state.activeIndex];
  return { pos: active.position.clone(), priority: 10 };
}

export function disposeHardpoint(): void {
  if (!state) return;
  if (state.mesh) {
    state.mesh.parent?.remove(state.mesh);
    state.mesh.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material?.dispose();
      }
    });
  }
  hudEl?.remove();
  hudEl = null;
  state = null;
}