/**
 * KingOfTheHill (KoTH) — single static capture zone, cumulative hold time wins.
 *
 * Simpler than Hardpoint (no rotation, no contention freeze) — it's the
 * classic "hold the point" mode where a team must accumulate 180 seconds
 * of uninterrupted control across the match.
 *
 * Key differences from Hardpoint:
 *   - Single zone, placed at arena center
 *   - "Crown" visible above the zone
 *   - While your team holds: "CROWNED" overlay pulses
 *   - Contested freezes both teams' scoring, but NOT progress decay
 *
 * Design choice: score is presented as a progress bar toward victory,
 * not an abstract number. Players can see "45%" — much more readable.
 */

import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { announce } from '@/ui/Announcer';
import { TEAM_BLUE, TEAM_RED } from '@/config/constants';

export interface KothState {
  zone: {
    position: THREE.Vector3;
    radius: number;
    mesh: THREE.Object3D | null;
  };
  holdTarget: number;         // seconds to win (default 180)
  holdBlue: number;
  holdRed: number;
  elapsed: number;
  holder: 'blue' | 'red' | null;
  contested: boolean;
  playersInZone: { blue: number; red: number };
  ended: boolean;
  winner: 'blue' | 'red' | 'draw' | null;
  scene: THREE.Scene | null;
}

let state: KothState | null = null;

// ─────────────────────────────────────────────────────────────────────
//  VISUAL
// ─────────────────────────────────────────────────────────────────────

function makeKothVisual(scene: THREE.Scene, pos: THREE.Vector3, radius: number): THREE.Object3D {
  const g = new THREE.Group();
  g.position.copy(pos);

  // Ground ring
  const ringGeo = new THREE.RingGeometry(radius - 0.2, radius + 0.2, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffcc44, transparent: true, opacity: 0.65,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  g.add(ring);
  (g as any).userData.ringMat = ringMat;

  // Fill disc
  const discGeo = new THREE.CircleGeometry(radius, 64);
  const discMat = new THREE.MeshBasicMaterial({
    color: 0xffcc44, transparent: true, opacity: 0.1,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.03;
  g.add(disc);
  (g as any).userData.discMat = discMat;

  // Rising holographic pillar
  const pillarGeo = new THREE.CylinderGeometry(radius * 0.15, radius * 0.15, 12, 16, 1, true);
  const pillarMat = new THREE.MeshBasicMaterial({
    color: 0xffcc44, transparent: true, opacity: 0.3,
    side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pillar = new THREE.Mesh(pillarGeo, pillarMat);
  pillar.position.y = 6;
  g.add(pillar);
  (g as any).userData.pillarMat = pillarMat;

  // Crown sprite on top
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffcc44';
  ctx.font = '180px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(255,204,68,0.6)';
  ctx.shadowBlur = 16;
  ctx.fillText('♛', 128, 140);
  const tex = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.position.y = 12.5;
  sprite.scale.set(3, 3, 1);
  g.add(sprite);

  scene.add(g);
  return g;
}

function updateKothVisual(): void {
  if (!state?.zone.mesh) return;
  const ud = state.zone.mesh.userData;
  const ringMat = ud.ringMat as THREE.MeshBasicMaterial;
  const discMat = ud.discMat as THREE.MeshBasicMaterial;
  const pillarMat = ud.pillarMat as THREE.MeshBasicMaterial;

  let color = 0xffcc44;
  if (state.contested) color = 0xff9933;
  else if (state.holder === 'blue') color = 0x4a9eff;
  else if (state.holder === 'red') color = 0xff5544;

  ringMat.color.setHex(color);
  discMat.color.setHex(color);
  pillarMat.color.setHex(color);

  const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.005);
  discMat.opacity = 0.08 + pulse * 0.15;
  pillarMat.opacity = 0.25 + pulse * 0.2;
}

// ─────────────────────────────────────────────────────────────────────
//  LIFECYCLE
// ─────────────────────────────────────────────────────────────────────

export function initKoth(
  scene: THREE.Scene,
  zonePosition: THREE.Vector3 = new THREE.Vector3(0, 0.1, 0),
  zoneRadius: number = 6,
  holdTargetSec: number = 180,
): KothState {
  state = {
    zone: {
      position: zonePosition.clone(),
      radius: zoneRadius,
      mesh: makeKothVisual(scene, zonePosition, zoneRadius),
    },
    holdTarget: holdTargetSec,
    holdBlue: 0,
    holdRed: 0,
    elapsed: 0,
    holder: null,
    contested: false,
    playersInZone: { blue: 0, red: 0 },
    ended: false,
    winner: null,
    scene,
  };

  createKothHud();
  announce('KING OF THE HILL', {
    sub: `Hold the crown · ${Math.floor(holdTargetSec / 60)}:${String(holdTargetSec % 60).padStart(2, '0')} target`,
    tier: 'large', duration: 3,
  });
  return state;
}

export function updateKoth(dt: number): void {
  if (!state || state.ended) return;
  state.elapsed += dt;

  const r = state.zone.radius;
  const rSq = r * r;
  state.playersInZone.blue = 0;
  state.playersInZone.red = 0;

  const player = gameState.player;
  if (player && player.hp > 0 && player.renderComponent) {
    const dx = player.renderComponent.position.x - state.zone.position.x;
    const dz = player.renderComponent.position.z - state.zone.position.z;
    if (dx * dx + dz * dz <= rSq) {
      if (player.team === TEAM_BLUE) state.playersInZone.blue++;
      else if (player.team === TEAM_RED) state.playersInZone.red++;
    }
  }
  const agents = gameState.agents ?? [];
  for (const a of agents) {
    if (!a || a.hp <= 0 || !a.renderComponent) continue;
    const dx = a.renderComponent.position.x - state.zone.position.x;
    const dz = a.renderComponent.position.z - state.zone.position.z;
    if (dx * dx + dz * dz <= rSq) {
      if (a.team === TEAM_BLUE) state.playersInZone.blue++;
      else if (a.team === TEAM_RED) state.playersInZone.red++;
    }
  }

  state.contested = state.playersInZone.blue > 0 && state.playersInZone.red > 0;

  let newHolder: 'blue' | 'red' | null = null;
  if (!state.contested) {
    if (state.playersInZone.blue > 0) newHolder = 'blue';
    else if (state.playersInZone.red > 0) newHolder = 'red';
  }

  // Announce holder changes
  if (newHolder !== state.holder && newHolder) {
    announce(`${newHolder.toUpperCase()} CROWNED`, {
      tier: 'medium',
      color: newHolder === 'blue' ? '#4a9eff' : '#ff5544',
      duration: 1.5,
    });
  }
  state.holder = newHolder;

  // Tick score
  if (state.holder === 'blue') state.holdBlue += dt;
  else if (state.holder === 'red') state.holdRed += dt;

  updateKothVisual();

  // Win check
  if (state.holdBlue >= state.holdTarget) endMatch('blue');
  else if (state.holdRed >= state.holdTarget) endMatch('red');

  updateKothHud();
}

function endMatch(winner: 'blue' | 'red' | 'draw'): void {
  if (!state) return;
  state.ended = true;
  state.winner = winner;
  const label = winner === 'draw' ? 'DRAW' : winner === 'blue' ? 'BLUE CROWNED' : 'RED CROWNED';
  announce(label, {
    sub: `${fmt(state.holdBlue)} : ${fmt(state.holdRed)}`,
    tier: 'large',
    color: winner === 'blue' ? '#4a9eff' : winner === 'red' ? '#ff5544' : '#ffcc44',
    duration: 5,
  });
}

function fmt(sec: number): string {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────────────────────────────

let hudEl: HTMLDivElement | null = null;

function createKothHud(): void {
  if (hudEl) hudEl.remove();
  hudEl = document.createElement('div');
  hudEl.id = 'kothHud';
  hudEl.innerHTML = `
    <div class="koth-wrap">
      <div class="koth-side koth-blue">
        <div class="koth-team">BLU</div>
        <div class="koth-time" id="kothBlue">0:00</div>
      </div>
      <div class="koth-center">
        <div class="koth-title">KING OF THE HILL</div>
        <div class="koth-progress">
          <div class="koth-progress-blue" id="kothBlueBar"></div>
          <div class="koth-progress-red" id="kothRedBar"></div>
          <div class="koth-progress-center"></div>
        </div>
        <div class="koth-status" id="kothStatus">NEUTRAL</div>
      </div>
      <div class="koth-side koth-red">
        <div class="koth-team">RED</div>
        <div class="koth-time" id="kothRed">0:00</div>
      </div>
    </div>
  `;
  document.body.appendChild(hudEl);

  if (!document.getElementById('kothHudStyle')) {
    const s = document.createElement('style');
    s.id = 'kothHudStyle';
    s.textContent = `
      #kothHud {
        position: fixed; top: 18px; left: 50%;
        transform: translateX(-50%);
        z-index: 7; pointer-events: none;
        font-family: 'Consolas', 'JetBrains Mono', monospace;
      }
      .koth-wrap {
        display: flex; gap: 14px; align-items: stretch;
        background: rgba(8,14,24,0.9);
        border-top: 1px solid rgba(255,204,68,0.3);
        border-bottom: 1px solid rgba(255,204,68,0.3);
        padding: 8px 16px;
      }
      .koth-side {
        min-width: 62px; text-align: center;
        display: flex; flex-direction: column; justify-content: center;
      }
      .koth-team { font-size: 9px; letter-spacing: 0.22em; font-weight: 700; opacity: 0.7; }
      .koth-time { font-size: 16px; font-weight: 800; line-height: 1.1; }
      .koth-blue .koth-team, .koth-blue .koth-time { color: #4a9eff; }
      .koth-red .koth-team, .koth-red .koth-time { color: #ff5544; }
      .koth-center {
        min-width: 240px; text-align: center;
        display: flex; flex-direction: column; gap: 4px;
      }
      .koth-title {
        font-size: 10px; letter-spacing: 0.3em;
        color: #ffcc44; opacity: 0.9;
      }
      .koth-progress {
        position: relative; height: 10px;
        background: rgba(255,255,255,0.08);
        overflow: hidden;
      }
      .koth-progress-blue {
        position: absolute; left: 0; top: 0; height: 100%; width: 0%;
        background: linear-gradient(90deg, #4a9eff, #6abfff);
        transition: width 0.3s ease-out;
      }
      .koth-progress-red {
        position: absolute; right: 0; top: 0; height: 100%; width: 0%;
        background: linear-gradient(-90deg, #ff5544, #ff7766);
        transition: width 0.3s ease-out;
      }
      .koth-progress-center {
        position: absolute; left: 50%; top: 0;
        width: 1px; height: 100%;
        background: rgba(255,255,255,0.3);
      }
      .koth-status {
        font-size: 10px; letter-spacing: 0.25em;
        font-weight: 700;
      }
      .koth-status.blue { color: #4a9eff; }
      .koth-status.red { color: #ff5544; }
      .koth-status.contested {
        color: #ff9933;
        animation: kothFlash 0.5s infinite alternate;
      }
      @keyframes kothFlash { from { opacity: 0.7; } to { opacity: 1; } }
    `;
    document.head.appendChild(s);
  }
}

function updateKothHud(): void {
  if (!state || !hudEl) return;
  (document.getElementById('kothBlue') as HTMLElement).textContent = fmt(state.holdBlue);
  (document.getElementById('kothRed') as HTMLElement).textContent = fmt(state.holdRed);

  const bluePct = Math.min(100, (state.holdBlue / state.holdTarget) * 100);
  const redPct = Math.min(100, (state.holdRed / state.holdTarget) * 100);
  (document.getElementById('kothBlueBar') as HTMLElement).style.width = `${bluePct / 2}%`;
  (document.getElementById('kothRedBar') as HTMLElement).style.width = `${redPct / 2}%`;

  const st = document.getElementById('kothStatus') as HTMLElement;
  st.className = 'koth-status';
  if (state.contested) { st.classList.add('contested'); st.textContent = 'CONTESTED'; }
  else if (state.holder === 'blue') { st.classList.add('blue'); st.textContent = 'BLUE HOLDS'; }
  else if (state.holder === 'red') { st.classList.add('red'); st.textContent = 'RED HOLDS'; }
  else st.textContent = 'NEUTRAL';
}

// ─────────────────────────────────────────────────────────────────────

export function getKothState(): KothState | null { return state; }

export function getKothPriority(): { pos: THREE.Vector3; priority: number } | null {
  if (!state) return null;
  return { pos: state.zone.position.clone(), priority: 10 };
}

export function disposeKoth(): void {
  if (!state) return;
  if (state.zone.mesh) {
    state.zone.mesh.parent?.remove(state.zone.mesh);
    state.zone.mesh.traverse(o => {
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