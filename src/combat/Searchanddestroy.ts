/**
 * Search & Destroy — plant/defuse bomb mode, no respawns.
 *
 * The most tactical, high-stakes mode in a shooter's rotation. Single life
 * per round. Winners take the round. First team to 4 rounds wins the match
 * (best of 7).
 *
 * Rules:
 *   - 5v5 (or N vN), one team attacking, one defending
 *   - Attackers: reach bomb site, plant the bomb (5s hold), defend until detonation (35s)
 *   - Defenders: kill all attackers, OR defuse planted bomb (7s hold)
 *   - No respawns — dead players spectate
 *   - Round ends when:
 *     1. All of one team is dead (surviving team wins)
 *     2. Bomb detonates (attackers win)
 *     3. Bomb is defused (defenders win)
 *     4. Round timer expires with no plant (defenders win)
 *   - Teams swap sides at half-match
 *
 * This implementation provides a single-site version (Site A). Multi-site is
 * a trivial extension: duplicate the BombSite and allow planting at either.
 *
 * Integration:
 *   - GameMode 'sd' — updateSd(dt) from GameLoop
 *   - Player input: E to plant/defuse (hold)
 *   - AgentFactory must NOT respawn dead agents during active round
 *   - Disable field upgrades that require respawn
 */

import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { announce } from '@/ui/Announcer';
import { TEAM_BLUE } from '@/config/constants';

// ─────────────────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────────────────

export interface SdConfig {
  roundsToWin: number;        // default 4 (best of 7)
  roundTimeLimit: number;     // seconds before bomb auto-forfeit (default 120)
  plantTime: number;          // seconds to plant (default 5)
  defuseTime: number;         // seconds to defuse (default 7)
  bombTimer: number;          // seconds after plant until detonation (default 35)
  swapAfterRound: number;     // round after which teams swap (default = halfway)
  siteRadius: number;
  attackerSpawn: THREE.Vector3;
  defenderSpawn: THREE.Vector3;
  bombSite: THREE.Vector3;
}

const DEFAULTS: SdConfig = {
  roundsToWin: 4,
  roundTimeLimit: 120,
  plantTime: 5,
  defuseTime: 7,
  bombTimer: 35,
  swapAfterRound: 4,
  siteRadius: 3.5,
  attackerSpawn: new THREE.Vector3(-30, 0, 20),
  defenderSpawn: new THREE.Vector3(30, 0, -20),
  bombSite: new THREE.Vector3(0, 0, 0),
};

export type Team = 'blue' | 'red';
export type Role = 'attacker' | 'defender';

export interface SdState {
  config: SdConfig;
  round: number;
  roundBlue: number;
  roundRed: number;
  roundStartTime: number;     // seconds in match time when round started
  elapsed: number;            // total match time
  roundElapsed: number;       // time within current round
  roundPhase: 'prep' | 'live' | 'planted' | 'ended';
  roundWinner: Team | null;
  attackerTeam: Team;         // which team is currently attacking
  // Bomb state
  bombPlanted: boolean;
  bombPlantedAt: number;      // roundElapsed when planted
  bombPosition: THREE.Vector3 | null;
  defuseProgress: number;     // 0 to defuseTime
  plantProgress: number;      // 0 to plantTime
  currentPlanter: any | null;
  currentDefuser: any | null;
  // Match over
  matchEnded: boolean;
  winner: Team | 'draw' | null;
  // Visual meshes
  siteMesh: THREE.Object3D | null;
  bombMesh: THREE.Object3D | null;
  scene: THREE.Scene | null;
}

let state: SdState | null = null;

// Prep phase duration (loadout/buy time equivalent)
const PREP_TIME = 10;

// ─────────────────────────────────────────────────────────────────────
//  VISUALS
// ─────────────────────────────────────────────────────────────────────

function makeSiteVisual(scene: THREE.Scene, pos: THREE.Vector3, radius: number): THREE.Object3D {
  const g = new THREE.Group();
  g.position.copy(pos);

  // Outer danger ring
  const ringGeo = new THREE.RingGeometry(radius - 0.15, radius + 0.2, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xff3344, transparent: true, opacity: 0.55,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);
  (g as any).userData.ringMat = ringMat;

  // Hazard stripes sprite (A label)
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  // Hazard tape pattern
  const gradient = ctx.createLinearGradient(0, 0, 256, 0);
  gradient.addColorStop(0, 'rgba(0,0,0,0.8)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.8)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  ctx.save();
  ctx.translate(128, 128);
  ctx.rotate(-Math.PI / 4);
  for (let i = -200; i < 200; i += 30) {
    ctx.fillStyle = i % 60 === 0 ? '#ffcc00' : '#222';
    ctx.fillRect(i, -200, 15, 400);
  }
  ctx.restore();
  ctx.fillStyle = '#ff3344';
  ctx.font = 'bold 140px "Consolas", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 6;
  ctx.strokeText('A', 128, 128);
  ctx.fillText('A', 128, 128);

  const tex = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.position.y = 6;
  sprite.scale.set(3.5, 3.5, 1);
  g.add(sprite);

  scene.add(g);
  return g;
}

function makeBombVisual(scene: THREE.Scene, pos: THREE.Vector3): THREE.Object3D {
  const g = new THREE.Group();
  g.position.copy(pos);
  g.position.y = 0.15;

  const boxGeo = new THREE.BoxGeometry(0.4, 0.3, 0.3);
  const boxMat = new THREE.MeshStandardMaterial({
    color: 0x222222, emissive: 0xff2222, roughness: 0.6, metalness: 0.5,
  });
  const box = new THREE.Mesh(boxGeo, boxMat);
  g.add(box);
  (g as any).userData.boxMat = boxMat;

  // Blinking light sprite on top
  const lightGeo = new THREE.SphereGeometry(0.04, 8, 8);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  const light = new THREE.Mesh(lightGeo, lightMat);
  light.position.y = 0.18;
  g.add(light);
  (g as any).userData.lightMat = lightMat;

  scene.add(g);
  return g;
}

function updateBombVisual(): void {
  if (!state?.bombMesh || !state.bombPlanted) return;
  const ud = state.bombMesh!.userData;
  const lightMat = ud.lightMat as THREE.MeshBasicMaterial;
  const boxMat = ud.boxMat as THREE.MeshStandardMaterial;

  // Blink faster as timer approaches
  const remaining = state.config.bombTimer - (state.roundElapsed - state.bombPlantedAt);
  const blinkRate = Math.max(1, 10 - remaining * 0.2);
  const blink = Math.sin(performance.now() * blinkRate * 0.005) > 0;
  lightMat.color.setHex(blink ? 0xff2222 : 0x330000);
  boxMat.emissive.setHex(blink ? 0xff2222 : 0x331111);
}

// ─────────────────────────────────────────────────────────────────────
//  LIFECYCLE
// ─────────────────────────────────────────────────────────────────────

export function initSd(
  scene: THREE.Scene,
  config: Partial<SdConfig> = {},
  attackerTeam: Team = 'blue',
): SdState {
  const fullConfig: SdConfig = { ...DEFAULTS, ...config };

  state = {
    config: fullConfig,
    round: 0,
    roundBlue: 0,
    roundRed: 0,
    roundStartTime: 0,
    elapsed: 0,
    roundElapsed: 0,
    roundPhase: 'prep',
    roundWinner: null,
    attackerTeam,
    bombPlanted: false,
    bombPlantedAt: 0,
    bombPosition: null,
    defuseProgress: 0,
    plantProgress: 0,
    currentPlanter: null,
    currentDefuser: null,
    matchEnded: false,
    winner: null,
    siteMesh: makeSiteVisual(scene, fullConfig.bombSite, fullConfig.siteRadius),
    bombMesh: null,
    scene,
  };

  createSdHud();
  startRound();
  return state;
}

function startRound(): void {
  if (!state) return;
  state.round++;
  state.roundElapsed = 0;
  state.roundPhase = 'prep';
  state.roundWinner = null;
  state.bombPlanted = false;
  state.bombPlantedAt = 0;
  state.bombPosition = null;
  state.defuseProgress = 0;
  state.plantProgress = 0;
  state.currentPlanter = null;
  state.currentDefuser = null;

  // Remove old bomb mesh if any
  if (state.bombMesh) {
    state.bombMesh.parent?.remove(state.bombMesh);
    state.bombMesh = null;
  }

  // Side swap
  if (state.round > 1 && (state.round - 1) === state.config.swapAfterRound) {
    state.attackerTeam = state.attackerTeam === 'blue' ? 'red' : 'blue';
    announce('SIDES SWAPPED', { tier: 'large', duration: 3 });
  }

  // Revive all agents (respawn for round start)
  const agents = gameState.agents ?? [];
  for (const a of agents) {
    if (a) {
      a.hp = a.maxHP ?? 100;
      if (a.renderComponent) a.renderComponent.visible = true;
    }
  }
  if (gameState.player) {
    gameState.player.hp = gameState.player.maxHP ?? 100;
    if (gameState.player.renderComponent) gameState.player.renderComponent.visible = true;
  }

  announce(`ROUND ${state.round}`, {
    sub: state.attackerTeam === 'blue' ? 'BLUE ATTACKS' : 'RED ATTACKS',
    tier: 'large',
    color: '#ffcc44',
    duration: 3,
  });
}

// ─────────────────────────────────────────────────────────────────────
//  UPDATE
// ─────────────────────────────────────────────────────────────────────

function countAliveByTeam(): { blue: number; red: number } {
  const out = { blue: 0, red: 0 };
  const player = gameState.player;
  if (player && player.hp > 0) {
    if (player.team === TEAM_BLUE) out.blue++;
    else out.red++;
  }
  const agents = gameState.agents ?? [];
  for (const a of agents) {
    if (!a || a.hp <= 0) continue;
    if (a.team === TEAM_BLUE) out.blue++;
    else out.red++;
  }
  return out;
}

function findPlantingAttacker(): any | null {
  if (!state) return null;
  const siteSq = state.config.siteRadius * state.config.siteRadius;

  const allPotentials: any[] = [];
  if (gameState.player && gameState.player.hp > 0 && (gameState.player.team as unknown) === state.attackerTeam) {
    allPotentials.push(gameState.player);
  }
  const agentsPl = gameState.agents ?? [];
  for (const a of agentsPl) {
    if (!a || a.hp <= 0) continue;
    if ((a.team as unknown) !== state.attackerTeam) continue;
    allPotentials.push(a);
  }

  for (const p of allPotentials) {
    if (!p.renderComponent) continue;
    const dx = p.renderComponent.position.x - state.config.bombSite.x;
    const dz = p.renderComponent.position.z - state.config.bombSite.z;
    if (dx * dx + dz * dz > siteSq) continue;
    // Must be attempting to plant (player: holding E; bot: explicit flag)
    if (p === gameState.player && (gameState as any).inputState?.interact) return p;
    if (p !== gameState.player && (p as any)._sdPlanting) return p;
  }
  return null;
}

function findDefusingDefender(): any | null {
  if (!state || !state.bombPosition) return null;
  const defuseSq = 2.5 * 2.5;
  const defenderTeam: Team = state.attackerTeam === 'blue' ? 'red' : 'blue';

  const pool: any[] = [];
  if (gameState.player && gameState.player.hp > 0 && (gameState.player.team as unknown) === defenderTeam) {
    pool.push(gameState.player);
  }
  const agents = gameState.agents ?? [];
  for (const a of agents) {
    if (!a || a.hp <= 0) continue;
    if ((a.team as unknown) !== defenderTeam) continue;
    pool.push(a);
  }

  for (const p of pool) {
    if (!p.renderComponent) continue;
    const dx = p.renderComponent.position.x - state.bombPosition.x;
    const dz = p.renderComponent.position.z - state.bombPosition.z;
    if (dx * dx + dz * dz > defuseSq) continue;
    if (p === gameState.player && (gameState as any).inputState?.interact) return p;
    if (p !== gameState.player && (p as any)._sdDefusing) return p;
  }
  return null;
}

export function updateSd(dt: number): void {
  if (!state || state.matchEnded) return;
  state.elapsed += dt;
  state.roundElapsed += dt;

  // Prep phase → live
  if (state.roundPhase === 'prep' && state.roundElapsed >= PREP_TIME) {
    state.roundPhase = 'live';
    announce('GO!', { tier: 'large', duration: 1.2, color: '#22d66a' });
    return;
  }

  if (state.roundPhase !== 'live' && state.roundPhase !== 'planted') {
    updateSdHud();
    return;
  }

  // Check team elimination
  const alive = countAliveByTeam();
  const defenderTeam: Team = state.attackerTeam === 'blue' ? 'red' : 'blue';
  const attackerAlive = state.attackerTeam === 'blue' ? alive.blue : alive.red;
  const defenderAlive = defenderTeam === 'blue' ? alive.blue : alive.red;

  if (attackerAlive === 0 && !state.bombPlanted) {
    endRound(defenderTeam, 'elimination');
    return;
  }
  if (defenderAlive === 0 && state.bombPlanted) {
    // Attackers still need bomb to detonate — but having no defenders means autowin
    endRound(state.attackerTeam, 'elimination');
    return;
  }
  if (defenderAlive === 0 && !state.bombPlanted) {
    endRound(state.attackerTeam, 'elimination');
    return;
  }

  // Planting
  if (state.roundPhase === 'live' && !state.bombPlanted) {
    const planter = findPlantingAttacker();
    if (planter) {
      if (state.currentPlanter !== planter) {
        state.currentPlanter = planter;
        state.plantProgress = 0;
      }
      state.plantProgress += dt;
      if (state.plantProgress >= state.config.plantTime) {
        // Planted!
        state.bombPlanted = true;
        state.bombPlantedAt = state.roundElapsed;
        state.bombPosition = planter.renderComponent.position.clone();
        state.bombPosition!.y = 0;
        state.bombMesh = makeBombVisual(state.scene!, state.bombPosition!);
        state.roundPhase = 'planted';
        state.plantProgress = 0;
        state.currentPlanter = null;
        announce('BOMB PLANTED', { sub: `${state.config.bombTimer}s`, tier: 'large', color: '#ff3344', duration: 3 });
        import('@/audio/SoundHooks').then(s => {
          try { (s as any).playObjective?.(); } catch { /* */ }
        }).catch(() => { /* */ });
      }
    } else {
      state.plantProgress = Math.max(0, state.plantProgress - dt * 2);
      state.currentPlanter = null;
    }
  }

  // Defusing
  if (state.roundPhase === 'planted') {
    const defuser = findDefusingDefender();
    if (defuser) {
      if (state.currentDefuser !== defuser) {
        state.currentDefuser = defuser;
        state.defuseProgress = 0;
      }
      state.defuseProgress += dt;
      if (state.defuseProgress >= state.config.defuseTime) {
        announce('BOMB DEFUSED', { tier: 'large', color: '#22d66a', duration: 2.5 });
        endRound(defenderTeam, 'defuse');
        return;
      }
    } else {
      state.defuseProgress = Math.max(0, state.defuseProgress - dt * 1.5);
      state.currentDefuser = null;
    }

    // Bomb timer
    const elapsed = state.roundElapsed - state.bombPlantedAt;
    if (elapsed >= state.config.bombTimer) {
      // Detonate!
      triggerDetonation();
      endRound(state.attackerTeam, 'detonation');
      return;
    }
    updateBombVisual();
  }

  // Round time limit (defenders win if no plant happens)
  if (state.roundPhase === 'live' && state.roundElapsed >= state.config.roundTimeLimit) {
    announce('TIME', { sub: 'Defenders win', tier: 'medium', color: '#4a9eff', duration: 2.5 });
    endRound(defenderTeam, 'timeout');
    return;
  }

  updateSdHud();
}

function triggerDetonation(): void {
  if (!state?.bombPosition) return;
  const scene = state.scene;
  if (!scene) return;
  // Explosion particle burst
  const sphereGeo = new THREE.SphereGeometry(0.5, 16, 16);
  const sphereMat = new THREE.MeshBasicMaterial({
    color: 0xff8800, transparent: true, opacity: 1, blending: THREE.AdditiveBlending,
  });
  const sphere = new THREE.Mesh(sphereGeo, sphereMat);
  sphere.position.copy(state.bombPosition);
  sphere.position.y = 1;
  scene.add(sphere);

  const start = performance.now();
  function animate() {
    const t = (performance.now() - start) / 1000;
    if (t > 1.2) {
      scene!.remove(sphere); sphereGeo.dispose(); sphereMat.dispose();
      return;
    }
    sphere.scale.setScalar(1 + t * 18);
    sphereMat.opacity = Math.max(0, 1 - t);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  import('@/audio/SoundHooks').then(s => {
    try { (s as any).playExplosion?.() ?? (s as any).playThunder?.(); } catch { /* */ }
  }).catch(() => { /* */ });

  // Damage anyone within blast radius (optional — mainly it's the round end)
  const blastRadius = 8;
  const blastSq = blastRadius * blastRadius;
  const allTargets: any[] = [gameState.player, ...(gameState.agents ?? [])].filter(Boolean);
  for (const t of allTargets) {
    if (!t.renderComponent || t.hp <= 0) continue;
    const dx = t.renderComponent.position.x - state.bombPosition.x;
    const dz = t.renderComponent.position.z - state.bombPosition.z;
    if (dx * dx + dz * dz <= blastSq) {
      t.hp = 0; // bomb kills everyone in radius
    }
  }
}

function endRound(winner: Team, method: 'elimination' | 'defuse' | 'detonation' | 'timeout'): void {
  if (!state) return;
  state.roundPhase = 'ended';
  state.roundWinner = winner;
  if (winner === 'blue') state.roundBlue++;
  else state.roundRed++;

  const reason = method === 'elimination' ? 'ELIMINATION' :
                 method === 'defuse' ? 'BOMB DEFUSED' :
                 method === 'detonation' ? 'BOMB DETONATED' : 'TIME';

  announce(`${winner === 'blue' ? 'BLUE' : 'RED'} ROUND`, {
    sub: reason,
    tier: 'medium',
    color: winner === 'blue' ? '#4a9eff' : '#ff5544',
    duration: 3,
  });

  // Match end check
  if (state.roundBlue >= state.config.roundsToWin) endMatch('blue');
  else if (state.roundRed >= state.config.roundsToWin) endMatch('red');
  else {
    setTimeout(() => startRound(), 3500);
  }
}

function endMatch(winner: Team | 'draw'): void {
  if (!state) return;
  state.matchEnded = true;
  state.winner = winner;
  announce(winner === 'draw' ? 'DRAW' : `${winner === 'blue' ? 'BLUE' : 'RED'} VICTORY`, {
    sub: `${state.roundBlue} : ${state.roundRed}`,
    tier: 'large',
    color: winner === 'blue' ? '#4a9eff' : winner === 'red' ? '#ff5544' : '#ffcc44',
    duration: 6,
  });
}

// ─────────────────────────────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────────────────────────────

let hudEl: HTMLDivElement | null = null;

function createSdHud(): void {
  if (hudEl) hudEl.remove();
  hudEl = document.createElement('div');
  hudEl.id = 'sdHud';
  hudEl.innerHTML = `
    <div class="sd-wrap">
      <div class="sd-side sd-blue"><div class="sd-team">BLU</div><div class="sd-rounds" id="sdBlue">0</div></div>
      <div class="sd-center">
        <div class="sd-round" id="sdRound">ROUND 1</div>
        <div class="sd-status" id="sdStatus">PREP</div>
        <div class="sd-timer-wrap"><div class="sd-timer-fill" id="sdTimer"></div></div>
      </div>
      <div class="sd-side sd-red"><div class="sd-team">RED</div><div class="sd-rounds" id="sdRed">0</div></div>
    </div>
    <div class="sd-prompt" id="sdPrompt"></div>
  `;
  document.body.appendChild(hudEl);

  if (!document.getElementById('sdHudStyle')) {
    const s = document.createElement('style');
    s.id = 'sdHudStyle';
    s.textContent = `
      #sdHud {
        position: fixed; top: 18px; left: 50%;
        transform: translateX(-50%);
        z-index: 7; pointer-events: none;
        font-family: 'Consolas', 'JetBrains Mono', monospace;
      }
      .sd-wrap {
        display: flex; gap: 20px; align-items: stretch;
        background: rgba(8,14,24,0.92);
        padding: 8px 20px;
        border-top: 1px solid rgba(255,204,68,0.3);
      }
      .sd-side {
        min-width: 55px; text-align: center;
        display: flex; flex-direction: column; justify-content: center;
      }
      .sd-team { font-size: 9px; letter-spacing: 0.25em; opacity: 0.7; }
      .sd-rounds { font-size: 26px; font-weight: 800; }
      .sd-blue .sd-rounds, .sd-blue .sd-team { color: #4a9eff; }
      .sd-red .sd-rounds, .sd-red .sd-team { color: #ff5544; }
      .sd-center {
        min-width: 220px; text-align: center;
        display: flex; flex-direction: column; gap: 4px; justify-content: center;
      }
      .sd-round { font-size: 11px; letter-spacing: 0.3em; color: #ffcc44; opacity: 0.9; }
      .sd-status { font-size: 14px; font-weight: 800; letter-spacing: 0.15em; color: #e0ecff; }
      .sd-status.planted { color: #ff3344; animation: sdFlash 0.6s infinite; }
      @keyframes sdFlash { 50% { opacity: 0.5; } }
      .sd-timer-wrap {
        height: 2px; background: rgba(255,255,255,0.15);
      }
      .sd-timer-fill {
        height: 100%; width: 100%;
        background: linear-gradient(90deg, #22d66a, #ff3344);
        transition: width 0.3s linear;
      }
      .sd-prompt {
        position: absolute; left: 50%; bottom: -80px;
        transform: translateX(-50%);
        font-size: 12px; letter-spacing: 0.2em;
        color: #ffcc44;
        background: rgba(8,14,24,0.9);
        padding: 6px 16px;
        border: 1px solid #ffcc44;
        display: none;
      }
      .sd-prompt.show { display: block; }
    `;
    document.head.appendChild(s);
  }
}

function updateSdHud(): void {
  if (!state || !hudEl) return;
  (document.getElementById('sdBlue') as HTMLElement).textContent = String(state.roundBlue);
  (document.getElementById('sdRed') as HTMLElement).textContent = String(state.roundRed);
  (document.getElementById('sdRound') as HTMLElement).textContent =
    `ROUND ${state.round} · ${state.attackerTeam === 'blue' ? 'BLU ATK' : 'RED ATK'}`;

  const statusEl = document.getElementById('sdStatus') as HTMLElement;
  statusEl.className = 'sd-status';
  const timerEl = document.getElementById('sdTimer') as HTMLElement;

  if (state.roundPhase === 'prep') {
    const remaining = Math.max(0, PREP_TIME - state.roundElapsed);
    statusEl.textContent = `PREP ${remaining.toFixed(1)}s`;
    timerEl.style.width = `${(remaining / PREP_TIME) * 100}%`;
  } else if (state.roundPhase === 'live') {
    const remaining = Math.max(0, state.config.roundTimeLimit - state.roundElapsed);
    const mm = Math.floor(remaining / 60);
    const ss = Math.floor(remaining % 60);
    statusEl.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
    timerEl.style.width = `${(remaining / state.config.roundTimeLimit) * 100}%`;
  } else if (state.roundPhase === 'planted') {
    const elapsed = state.roundElapsed - state.bombPlantedAt;
    const remaining = Math.max(0, state.config.bombTimer - elapsed);
    statusEl.textContent = `BOMB: ${remaining.toFixed(1)}s`;
    statusEl.classList.add('planted');
    timerEl.style.width = `${(remaining / state.config.bombTimer) * 100}%`;
  } else if (state.roundPhase === 'ended') {
    statusEl.textContent = 'ROUND END';
  }

  // Prompt for player
  const promptEl = document.getElementById('sdPrompt') as HTMLElement;
  const player = gameState.player;
  if (player && player.hp > 0 && player.renderComponent) {
    const defenderTeam: Team = state.attackerTeam === 'blue' ? 'red' : 'blue';
    const pTeam = player.team as unknown as Team;
    const bombSite = state.config.bombSite;
    const dx = player.renderComponent.position.x - bombSite.x;
    const dz = player.renderComponent.position.z - bombSite.z;
    const atSite = (dx * dx + dz * dz) < (state.config.siteRadius * state.config.siteRadius);

    if (state.roundPhase === 'live' && pTeam === state.attackerTeam && atSite && !state.bombPlanted) {
      promptEl.classList.add('show');
      const pct = Math.round((state.plantProgress / state.config.plantTime) * 100);
      promptEl.textContent = state.plantProgress > 0.05
        ? `PLANTING... ${pct}%`
        : '▶ HOLD [E] TO PLANT';
    } else if (state.roundPhase === 'planted' && pTeam === defenderTeam && state.bombPosition) {
      const bdx = player.renderComponent.position.x - state.bombPosition.x;
      const bdz = player.renderComponent.position.z - state.bombPosition.z;
      const atBomb = (bdx * bdx + bdz * bdz) < 6.25;
      if (atBomb) {
        promptEl.classList.add('show');
        const pct = Math.round((state.defuseProgress / state.config.defuseTime) * 100);
        promptEl.textContent = state.defuseProgress > 0.05
          ? `DEFUSING... ${pct}%`
          : '▶ HOLD [E] TO DEFUSE';
      } else {
        promptEl.classList.remove('show');
      }
    } else {
      promptEl.classList.remove('show');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────

export function getSdState(): SdState | null { return state; }

export function getSdObjectivePriority(team: Team): { pos: THREE.Vector3; priority: number } | null {
  if (!state) return null;
  if (state.bombPlanted && state.bombPosition) {
    return { pos: state.bombPosition.clone(), priority: 10 };
  }
  return { pos: state.config.bombSite.clone(), priority: 9 };
}

export function disposeSd(): void {
  if (!state) return;
  if (state.siteMesh) {
    state.siteMesh.parent?.remove(state.siteMesh);
    state.siteMesh.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material?.dispose();
      }
    });
  }
  if (state.bombMesh) {
    state.bombMesh.parent?.remove(state.bombMesh);
  }
  hudEl?.remove();
  hudEl = null;
  state = null;
}