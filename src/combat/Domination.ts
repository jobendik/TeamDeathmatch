/**
 * Domination — 3 capture zones, score ticks for held zones.
 *
 * Rules:
 *   - 3 zones (A, B, C) placed on the map
 *   - Stand in a zone to capture — contested when both teams present
 *   - Per second held: +1 score per zone
 *   - First team to 200 (configurable) wins, or highest at time limit
 *   - Capture time scales with number of attackers (solo ~8s, 3+ ~3s)
 *
 * Integration:
 *   - Register 'domination' in GameModes.ts GameMode union
 *   - GameLoop calls updateDomination(dt)
 *   - HUD reads domZoneState() for the zone UI widget
 *   - Bots: BRBrain/AIController receive objective pressure hints
 *     (nearby zones become priority positions)
 */

import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { announce } from '@/ui/Announcer';
import { TEAM_BLUE, type TeamId } from '@/config/constants';

export type DomZoneId = 'A' | 'B' | 'C';
export type Team = 'blue' | 'red' | null;

function teamIdToTeam(id: TeamId): Team {
  return id === TEAM_BLUE ? 'blue' : 'red';
}

export interface DomZone {
  id: DomZoneId;
  position: THREE.Vector3;
  radius: number;
  capProgress: number;      // 0-100
  capProgressTeam: Team;    // which team's progress is this
  owner: Team;              // who currently holds it
  playersInZone: { blue: number; red: number };
  contested: boolean;
}

export interface DomState {
  zones: DomZone[];
  scoreBlue: number;
  scoreRed: number;
  scoreLimit: number;
  timeLimit: number;       // seconds
  elapsed: number;
  tickAccumulator: number;
  winner: Team | 'draw' | null;
  ended: boolean;
  // Visual meshes per zone (ring + pillar)
  zoneMeshes: Map<DomZoneId, THREE.Object3D>;
}

let state: DomState | null = null;

// Default zone positions — override via configureDominationZones()
const DEFAULT_ZONES: Array<{ id: DomZoneId; pos: [number, number, number] }> = [
  { id: 'A', pos: [-25, 0.1, 0] },
  { id: 'B', pos: [0, 0.1, 0] },
  { id: 'C', pos: [25, 0.1, 0] },
];

const ZONE_RADIUS = 5.5;
const BASE_CAP_TIME = 8.0;    // seconds alone
const SCORE_TICK_INTERVAL = 1.0;
const SCORE_PER_ZONE = 1;

// ─────────────────────────────────────────────────────────────────────
//  VISUAL ZONES
// ─────────────────────────────────────────────────────────────────────

function makeZoneVisual(zone: DomZone, scene: THREE.Scene): THREE.Object3D {
  const group = new THREE.Group();
  group.position.copy(zone.position);

  // Outer ring decal
  const ringGeo = new THREE.RingGeometry(zone.radius - 0.3, zone.radius, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  group.add(ring);
  group.userData.ringMat = ringMat;

  // Fill disc
  const fillGeo = new THREE.CircleGeometry(zone.radius, 64);
  const fillMat = new THREE.MeshBasicMaterial({
    color: 0x666666, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false,
  });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.02;
  group.add(fill);
  group.userData.fillMat = fillMat;

  // Letter pillar
  const pillarGeo = new THREE.BoxGeometry(0.6, 4, 0.6);
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x888888, emissive: 0x222222, roughness: 0.7, metalness: 0.3,
  });
  const pillar = new THREE.Mesh(pillarGeo, pillarMat);
  pillar.position.y = 2;
  group.add(pillar);
  group.userData.pillarMat = pillarMat;

  // Floating letter (sprite)
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = 'white';
  ctx.font = 'bold 200px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(zone.id, 128, 140);

  const tex = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.position.y = 5.5;
  sprite.scale.set(3, 3, 1);
  group.add(sprite);

  scene.add(group);
  return group;
}

function updateZoneColor(zone: DomZone, visual: THREE.Object3D): void {
  const userData = visual.userData;
  const ringMat = userData.ringMat as THREE.MeshBasicMaterial;
  const fillMat = userData.fillMat as THREE.MeshBasicMaterial;
  const pillarMat = userData.pillarMat as THREE.MeshStandardMaterial;

  let color: number;
  let emissive: number;
  if (zone.contested) {
    color = 0xffff44;
    emissive = 0x664400;
  } else if (zone.owner === 'blue') {
    color = 0x4a9eff;
    emissive = 0x113366;
  } else if (zone.owner === 'red') {
    color = 0xff5544;
    emissive = 0x661111;
  } else if (zone.capProgressTeam) {
    color = zone.capProgressTeam === 'blue' ? 0x6abfff : 0xff8877;
    emissive = zone.capProgressTeam === 'blue' ? 0x222244 : 0x442222;
  } else {
    color = 0x888888;
    emissive = 0x222222;
  }

  ringMat.color.setHex(color);
  fillMat.color.setHex(color);
  pillarMat.color.setHex(color);
  pillarMat.emissive.setHex(emissive);

  // Pulse when contested
  const pulse = zone.contested ? 0.7 + 0.3 * Math.sin(performance.now() * 0.01) : 1;
  ringMat.opacity = 0.35 + 0.25 * pulse;
  fillMat.opacity = 0.12 + (zone.capProgress / 100) * 0.25;
}

// ─────────────────────────────────────────────────────────────────────
//  INITIALIZATION
// ─────────────────────────────────────────────────────────────────────

export function initDomination(
  scene: THREE.Scene,
  zoneOverrides?: Array<{ id: DomZoneId; pos: [number, number, number] }>,
  scoreLimit: number = 200,
  timeLimit: number = 600,
): DomState {
  const zoneDefs = zoneOverrides ?? DEFAULT_ZONES;
  const zones: DomZone[] = zoneDefs.map(z => ({
    id: z.id,
    position: new THREE.Vector3(z.pos[0], z.pos[1], z.pos[2]),
    radius: ZONE_RADIUS,
    capProgress: 0,
    capProgressTeam: null,
    owner: null,
    playersInZone: { blue: 0, red: 0 },
    contested: false,
  }));

  const zoneMeshes = new Map<DomZoneId, THREE.Object3D>();
  for (const z of zones) {
    zoneMeshes.set(z.id, makeZoneVisual(z, scene));
  }

  state = {
    zones,
    scoreBlue: 0,
    scoreRed: 0,
    scoreLimit,
    timeLimit,
    elapsed: 0,
    tickAccumulator: 0,
    winner: null,
    ended: false,
    zoneMeshes,
  };

  createDomHud();
  announce('DOMINATION', { sub: 'Capture A, B, C to score', tier: 'large', duration: 3 });
  return state;
}

// ─────────────────────────────────────────────────────────────────────
//  UPDATE
// ─────────────────────────────────────────────────────────────────────

function getAllCombatants(): Array<{ team: Team; pos: THREE.Vector3; alive: boolean }> {
  const out: Array<{ team: Team; pos: THREE.Vector3; alive: boolean }> = [];
  const player = gameState.player;
  if (player && player.hp > 0 && player.renderComponent) {
    out.push({ team: teamIdToTeam(player.team), pos: player.renderComponent.position, alive: true });
  }
  const agents = gameState.agents ?? [];
  for (const a of agents) {
    if (!a || a.hp <= 0 || !a.renderComponent) continue;
    out.push({ team: teamIdToTeam(a.team), pos: a.renderComponent.position, alive: true });
  }
  return out;
}

export function updateDomination(dt: number): void {
  if (!state || state.ended) return;

  state.elapsed += dt;
  state.tickAccumulator += dt;

  const combatants = getAllCombatants();

  // Update zone occupation
  for (const zone of state.zones) {
    const radiusSq = zone.radius * zone.radius;
    zone.playersInZone.blue = 0;
    zone.playersInZone.red = 0;
    for (const c of combatants) {
      if (!c.alive) continue;
      const dx = c.pos.x - zone.position.x;
      const dz = c.pos.z - zone.position.z;
      if (dx * dx + dz * dz <= radiusSq) {
        if (c.team === 'blue') zone.playersInZone.blue++;
        else if (c.team === 'red') zone.playersInZone.red++;
      }
    }

    zone.contested = zone.playersInZone.blue > 0 && zone.playersInZone.red > 0;

    // Capture progress logic
    if (zone.contested) {
      // Pause capture, keep current progress
    } else if (zone.playersInZone.blue > 0 && zone.owner !== 'blue') {
      const capSpeed = (100 / BASE_CAP_TIME) * Math.min(3, zone.playersInZone.blue * 0.8 + 0.2);
      if (zone.capProgressTeam === 'red') {
        // Reversing opposing capture
        zone.capProgress = Math.max(0, zone.capProgress - capSpeed * dt);
        if (zone.capProgress <= 0) {
          zone.capProgressTeam = 'blue';
        }
      } else {
        zone.capProgressTeam = 'blue';
        zone.capProgress += capSpeed * dt;
      }
      if (zone.capProgress >= 100) {
        const prevOwner = zone.owner;
        zone.owner = 'blue';
        zone.capProgress = 0;
        zone.capProgressTeam = null;
        announceCapture(zone, prevOwner);
      }
    } else if (zone.playersInZone.red > 0 && zone.owner !== 'red') {
      const capSpeed = (100 / BASE_CAP_TIME) * Math.min(3, zone.playersInZone.red * 0.8 + 0.2);
      if (zone.capProgressTeam === 'blue') {
        zone.capProgress = Math.max(0, zone.capProgress - capSpeed * dt);
        if (zone.capProgress <= 0) {
          zone.capProgressTeam = 'red';
        }
      } else {
        zone.capProgressTeam = 'red';
        zone.capProgress += capSpeed * dt;
      }
      if (zone.capProgress >= 100) {
        const prevOwner = zone.owner;
        zone.owner = 'red';
        zone.capProgress = 0;
        zone.capProgressTeam = null;
        announceCapture(zone, prevOwner);
      }
    } else if (zone.playersInZone.blue === 0 && zone.playersInZone.red === 0) {
      // Decay partial progress when empty
      if (zone.capProgress > 0) {
        zone.capProgress = Math.max(0, zone.capProgress - 6 * dt);
        if (zone.capProgress === 0) zone.capProgressTeam = null;
      }
    }

    // Update visual
    const visual = state.zoneMeshes.get(zone.id);
    if (visual) updateZoneColor(zone, visual);
  }

  // Score ticks
  if (state.tickAccumulator >= SCORE_TICK_INTERVAL) {
    state.tickAccumulator -= SCORE_TICK_INTERVAL;
    for (const zone of state.zones) {
      if (zone.owner === 'blue') state.scoreBlue += SCORE_PER_ZONE;
      else if (zone.owner === 'red') state.scoreRed += SCORE_PER_ZONE;
    }
  }

  // Win check
  if (state.scoreBlue >= state.scoreLimit) endMatch('blue');
  else if (state.scoreRed >= state.scoreLimit) endMatch('red');
  else if (state.elapsed >= state.timeLimit) {
    if (state.scoreBlue > state.scoreRed) endMatch('blue');
    else if (state.scoreRed > state.scoreBlue) endMatch('red');
    else endMatch('draw');
  }

  updateDomHud();
}

function announceCapture(zone: DomZone, prevOwner: Team): void {
  const team = zone.owner === 'blue' ? 'BLUE' : 'RED';
  const action = prevOwner ? 'STOLEN' : 'CAPTURED';
  announce(`${team} ${action} ${zone.id}`, {
    tier: 'medium',
    color: zone.owner === 'blue' ? '#4a9eff' : '#ff5544',
    duration: 2,
  });

  import('@/audio/SoundHooks').then(s => {
    try { (s as any).playCapture?.() ?? (s as any).playFlagPickup?.(); } catch { /* */ }
  }).catch(() => { /* */ });
}

function endMatch(winner: Team | 'draw'): void {
  if (!state) return;
  state.ended = true;
  state.winner = winner;

  const label = winner === 'draw' ? 'DRAW' : `${winner === 'blue' ? 'BLUE' : 'RED'} VICTORY`;
  announce(label, {
    sub: `${state.scoreBlue} : ${state.scoreRed}`,
    tier: 'large',
    color: winner === 'blue' ? '#4a9eff' : winner === 'red' ? '#ff5544' : '#ffcc44',
    duration: 5,
  });
}

// ─────────────────────────────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────────────────────────────

let hudEl: HTMLDivElement | null = null;

function createDomHud(): void {
  if (hudEl) hudEl.remove();
  hudEl = document.createElement('div');
  hudEl.id = 'domHud';
  hudEl.innerHTML = `
    <div class="dom-scores">
      <div class="dom-score dom-blue"><span class="dom-team">BLU</span><span class="dom-num" id="domBlue">0</span></div>
      <div class="dom-score dom-red"><span class="dom-team">RED</span><span class="dom-num" id="domRed">0</span></div>
    </div>
    <div class="dom-zones">
      <div class="dom-zone" id="domZ-A"><div class="dom-zone-letter">A</div><div class="dom-zone-bar"><div class="dom-zone-fill"></div></div></div>
      <div class="dom-zone" id="domZ-B"><div class="dom-zone-letter">B</div><div class="dom-zone-bar"><div class="dom-zone-fill"></div></div></div>
      <div class="dom-zone" id="domZ-C"><div class="dom-zone-letter">C</div><div class="dom-zone-bar"><div class="dom-zone-fill"></div></div></div>
    </div>
  `;
  document.body.appendChild(hudEl);

  if (!document.getElementById('domHudStyle')) {
    const s = document.createElement('style');
    s.id = 'domHudStyle';
    s.textContent = `
      #domHud {
        position: fixed; top: 18px; left: 50%;
        transform: translateX(-50%);
        z-index: 7; pointer-events: none;
        display: flex; flex-direction: column; gap: 10px; align-items: center;
        font-family: 'Consolas', 'JetBrains Mono', monospace;
      }
      .dom-scores {
        display: flex; gap: 16px; align-items: center;
        background: rgba(8,14,24,0.88);
        padding: 8px 20px;
        border-radius: 2px;
        border-top: 1px solid rgba(255,255,255,0.1);
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      .dom-score { display: flex; align-items: center; gap: 10px; }
      .dom-team { font-size: 10px; font-weight: 700; letter-spacing: 0.22em; opacity: 0.7; }
      .dom-num { font-size: 22px; font-weight: 800; }
      .dom-blue .dom-num, .dom-blue .dom-team { color: #4a9eff; }
      .dom-red .dom-num, .dom-red .dom-team { color: #ff5544; }
      .dom-zones { display: flex; gap: 8px; }
      .dom-zone {
        width: 72px;
        background: rgba(8,14,24,0.85);
        padding: 5px 8px;
        text-align: center;
        border: 1px solid rgba(255,255,255,0.1);
      }
      .dom-zone.owner-blue { border-color: #4a9eff; }
      .dom-zone.owner-red { border-color: #ff5544; }
      .dom-zone.contested {
        border-color: #ffcc44;
        animation: domPulse 0.5s ease-in-out infinite alternate;
      }
      @keyframes domPulse {
        from { background: rgba(8,14,24,0.85); }
        to { background: rgba(80,60,10,0.85); }
      }
      .dom-zone-letter {
        font-size: 18px; font-weight: 800; color: #ccc; letter-spacing: 0.1em;
      }
      .dom-zone.owner-blue .dom-zone-letter { color: #4a9eff; }
      .dom-zone.owner-red .dom-zone-letter { color: #ff5544; }
      .dom-zone.contested .dom-zone-letter { color: #ffcc44; }
      .dom-zone-bar {
        height: 3px; margin-top: 4px;
        background: rgba(255,255,255,0.1);
        border-radius: 1px; overflow: hidden;
      }
      .dom-zone-fill {
        height: 100%;
        background: #888;
        transition: width 0.2s linear, background 0.2s;
      }
      .dom-zone.cap-blue .dom-zone-fill { background: #4a9eff; }
      .dom-zone.cap-red .dom-zone-fill { background: #ff5544; }
    `;
    document.head.appendChild(s);
  }
}

function updateDomHud(): void {
  if (!state || !hudEl) return;
  (document.getElementById('domBlue') as HTMLElement).textContent = String(state.scoreBlue);
  (document.getElementById('domRed') as HTMLElement).textContent = String(state.scoreRed);

  for (const zone of state.zones) {
    const zEl = document.getElementById(`domZ-${zone.id}`);
    if (!zEl) continue;
    zEl.className = 'dom-zone';
    if (zone.contested) zEl.classList.add('contested');
    else if (zone.owner === 'blue') zEl.classList.add('owner-blue');
    else if (zone.owner === 'red') zEl.classList.add('owner-red');

    if (zone.capProgressTeam === 'blue') zEl.classList.add('cap-blue');
    else if (zone.capProgressTeam === 'red') zEl.classList.add('cap-red');

    const fill = zEl.querySelector('.dom-zone-fill') as HTMLElement;
    if (fill) {
      const pct = zone.owner ? 100 : zone.capProgress;
      fill.style.width = `${pct}%`;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
//  PUBLIC QUERIES
// ─────────────────────────────────────────────────────────────────────

export function getDomState(): DomState | null { return state; }

/**
 * For AI — returns priority zones for a given team (uncontested or contested only).
 * BRBrain/AIController can use this to bias positioning.
 */
export function getPriorityZonesFor(team: Team): Array<{ pos: THREE.Vector3; priority: number }> {
  if (!state) return [];
  const results: Array<{ pos: THREE.Vector3; priority: number }> = [];
  for (const zone of state.zones) {
    let priority = 0;
    if (zone.owner !== team) priority += 3;           // capture opportunity
    if (zone.contested) priority += 2;                 // reinforce
    if (zone.owner === team && zone.playersInZone[team === 'blue' ? 'red' : 'blue']! > 0) priority += 4; // defend
    if (!zone.owner && !zone.contested) priority += 2; // easy grab
    if (priority > 0) results.push({ pos: zone.position.clone(), priority });
  }
  return results.sort((a, b) => b.priority - a.priority);
}

export function disposeDomination(): void {
  if (!state) return;
  for (const mesh of state.zoneMeshes.values()) {
    mesh.parent?.remove(mesh);
    mesh.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material?.dispose();
      }
    });
  }
  hudEl?.remove();
  hudEl = null;
  state = null;
}