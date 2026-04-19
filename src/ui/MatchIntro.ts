/**
 * MatchIntro — cinematic pre-match opening.
 *
 * Problem: current match start is abrupt — you load, you're in, go.
 * AAA shooters (MW, Battlefield, Apex) all open with a quick cinematic:
 * team roster card, map name + game mode slate, short camera sweep over
 * the arena before handing control to the player.
 *
 * Design:
 *   - Phase 1 (0-2.0s): Map name slate + mode tag ("WAREHOUSE · DOMINATION")
 *   - Phase 2 (2.0-5.5s): Camera sweep along a predefined path over the arena
 *   - Phase 3 (5.5-7.5s): Team rosters side-by-side (left blue, right red),
 *                        with player row highlighted
 *   - Phase 4 (7.5-8.5s): "FIGHT" slate → fade to gameplay
 *
 * Optional speed-ups:
 *   - SPACE to skip to next phase
 *   - ESC or double-click to skip entire intro
 *
 * Integration:
 *   - MatchIntro.play(opts) returns a Promise that resolves when intro is done
 *   - During intro: gameState._introActive = true blocks input
 *   - Camera override: intro controls camera position/rotation directly
 *   - Call from match start, BEFORE unlocking the player
 */

import * as THREE from 'three';
import { gameState } from '@/core/GameState';

export interface MatchIntroOptions {
  mapName: string;
  modeLabel: string;
  teamBlue: Array<{ name: string; level?: number; isPlayer?: boolean }>;
  teamRed: Array<{ name: string; level?: number; isPlayer?: boolean }>;
  arena?: {
    // Camera path — start/mid/end positions + look-at targets
    // If omitted, a default circular sweep above arena center is used.
    cameraPath?: Array<{ pos: THREE.Vector3; lookAt: THREE.Vector3; t: number }>;
  };
  camera: THREE.PerspectiveCamera;
  onSkip?: () => void;
}

interface IntroState {
  active: boolean;
  skipRequested: boolean;
  startTime: number;
  phase: 'map' | 'sweep' | 'rosters' | 'fight' | 'done';
  opts: MatchIntroOptions | null;
  overlay: HTMLDivElement | null;
  cameraRestore: { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number } | null;
  keyListener: ((e: KeyboardEvent) => void) | null;
}

const introState: IntroState = {
  active: false,
  skipRequested: false,
  startTime: 0,
  phase: 'map',
  opts: null,
  overlay: null,
  cameraRestore: null,
  keyListener: null,
};

// Phase timings (seconds). The intro is now map → sweep → rosters,
// with a crisp cut into gameplay — no FIGHT slate and no fade-out.
const T_MAP_END = 2.0;
const T_SWEEP_END = 5.5;
const T_ROSTERS_END = 7.5;

// ─────────────────────────────────────────────────────────────────────
//  OVERLAY DOM
// ─────────────────────────────────────────────────────────────────────

function createOverlay(opts: MatchIntroOptions): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.id = 'matchIntroOverlay';

  const rosterRow = (p: { name: string; level?: number; isPlayer?: boolean }) => `
    <div class="mi-player${p.isPlayer ? ' mi-player-you' : ''}">
      <div class="mi-player-lvl">${p.level ?? '—'}</div>
      <div class="mi-player-name">${p.name}</div>
    </div>
  `;

  overlay.innerHTML = `
    <div class="mi-vignette"></div>
    <div class="mi-fade"></div>
    <div class="mi-content">
      <div class="mi-phase-map" data-phase="map">
        <div class="mi-mapname">${opts.mapName}</div>
        <div class="mi-modetag">${opts.modeLabel}</div>
        <div class="mi-hbar"></div>
      </div>
      <div class="mi-phase-rosters" data-phase="rosters">
        <div class="mi-roster mi-roster-blue">
          <div class="mi-roster-head">BLUE TEAM</div>
          ${opts.teamBlue.map(rosterRow).join('')}
        </div>
        <div class="mi-vs">VS</div>
        <div class="mi-roster mi-roster-red">
          <div class="mi-roster-head">RED TEAM</div>
          ${opts.teamRed.map(rosterRow).join('')}
        </div>
      </div>
      <div class="mi-phase-fight" data-phase="fight">
        <div class="mi-fight">FIGHT</div>
      </div>
    </div>
    <div class="mi-skip-hint">Hold [SPACE] to skip · [ESC] fast skip</div>
  `;

  if (!document.getElementById('matchIntroStyle')) {
    const s = document.createElement('style');
    s.id = 'matchIntroStyle';
    s.textContent = `
      #matchIntroOverlay {
        position: fixed; inset: 0;
        z-index: 50;
        pointer-events: auto;
        font-family: 'Consolas', 'JetBrains Mono', monospace;
        color: #e0ecff;
        overflow: hidden;
      }
      .mi-vignette {
        position: absolute; inset: 0;
        background: radial-gradient(circle at center, transparent 30%, rgba(0,0,0,0.85) 100%);
        pointer-events: none;
      }
      .mi-fade {
        position: absolute; inset: 0;
        background: black;
        transition: opacity 0.2s ease;
        opacity: 0;
        pointer-events: none;
      }
      .mi-fade.hide { opacity: 0; pointer-events: none; }
      .mi-content { position: absolute; inset: 0; display: grid; place-items: center; }

      /* PHASE: MAP SLATE */
      .mi-phase-map {
        text-align: center;
        opacity: 0;
        transition: opacity 0.4s, transform 0.4s;
        transform: translateY(10px);
      }
      .mi-phase-map.show { opacity: 1; transform: translateY(0); }
      .mi-mapname {
        font-size: 72px; font-weight: 900;
        letter-spacing: 0.15em;
        text-shadow: 0 2px 20px rgba(0,0,0,0.9);
      }
      .mi-modetag {
        font-size: 20px; font-weight: 600;
        letter-spacing: 0.4em;
        color: #ffcc44;
        margin-top: 12px;
      }
      .mi-hbar {
        width: 340px; height: 2px; margin: 24px auto 0;
        background: linear-gradient(90deg, transparent, #ffcc44, transparent);
      }

      /* PHASE: ROSTERS */
      .mi-phase-rosters {
        display: none;
        grid-template-columns: 1fr auto 1fr;
        gap: 40px;
        align-items: stretch;
        max-width: 820px;
        width: 85%;
      }
      .mi-phase-rosters.show { display: grid; animation: miRosterIn 0.4s ease-out; }
      @keyframes miRosterIn {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .mi-roster {
        background: rgba(8,14,24,0.88);
        padding: 14px 18px;
        border-top: 3px solid;
        min-height: 240px;
      }
      .mi-roster-blue { border-top-color: #4a9eff; }
      .mi-roster-red { border-top-color: #ff5544; text-align: right; }
      .mi-roster-head {
        font-size: 12px; letter-spacing: 0.25em; font-weight: 700;
        margin-bottom: 14px; opacity: 0.9;
      }
      .mi-roster-blue .mi-roster-head { color: #4a9eff; }
      .mi-roster-red .mi-roster-head { color: #ff5544; }
      .mi-player {
        display: flex; align-items: center; gap: 10px;
        padding: 5px 0;
        border-bottom: 1px solid rgba(255,255,255,0.05);
      }
      .mi-roster-red .mi-player { flex-direction: row-reverse; }
      .mi-player-lvl {
        font-size: 11px; font-weight: 800;
        background: rgba(255,255,255,0.08);
        padding: 2px 7px; min-width: 28px;
        text-align: center;
        color: #ffcc44;
      }
      .mi-player-name { font-size: 14px; letter-spacing: 0.05em; }
      .mi-player-you {
        background: linear-gradient(90deg, rgba(255,204,68,0.15), transparent);
      }
      .mi-player-you .mi-player-name {
        color: #ffcc44; font-weight: 700;
      }
      .mi-roster-red .mi-player-you {
        background: linear-gradient(-90deg, rgba(255,204,68,0.15), transparent);
      }
      .mi-vs {
        font-size: 36px; font-weight: 900;
        align-self: center;
        letter-spacing: 0.08em;
        color: #ffcc44;
        text-shadow: 0 0 12px rgba(255,204,68,0.4);
      }

      /* PHASE: FIGHT */
      .mi-phase-fight { display: none; text-align: center; }
      .mi-phase-fight.show {
        display: block;
        animation: miFightIn 0.3s ease-out;
      }
      @keyframes miFightIn {
        0% { transform: scale(0.4); opacity: 0; }
        60% { transform: scale(1.3); opacity: 1; }
        100% { transform: scale(1); opacity: 1; }
      }
      .mi-fight {
        font-size: 140px; font-weight: 900;
        letter-spacing: 0.15em;
        color: #fff;
        text-shadow:
          0 0 30px rgba(255,80,80,0.8),
          0 0 60px rgba(255,80,80,0.4),
          0 4px 0 rgba(0,0,0,0.8);
      }

      /* Skip hint */
      .mi-skip-hint {
        position: absolute; bottom: 24px; left: 50%;
        transform: translateX(-50%);
        font-size: 10px; letter-spacing: 0.25em;
        color: rgba(255,255,255,0.4);
      }

      /* Hide everything for the sweep phase — camera does the talking */
      #matchIntroOverlay.sweep .mi-content > div { display: none; }
      #matchIntroOverlay.sweep .mi-skip-hint { opacity: 0.6; }
    `;
    document.head.appendChild(s);
  }

  document.body.appendChild(overlay);
  return overlay;
}

// ─────────────────────────────────────────────────────────────────────
//  CAMERA SWEEP
// ─────────────────────────────────────────────────────────────────────

function defaultCameraPath(): Array<{ pos: THREE.Vector3; lookAt: THREE.Vector3; t: number }> {
  return [
    { pos: new THREE.Vector3(-30, 15, 30), lookAt: new THREE.Vector3(0, 2, 0), t: 0 },
    { pos: new THREE.Vector3(20, 22, 25), lookAt: new THREE.Vector3(0, 2, 0), t: 0.4 },
    { pos: new THREE.Vector3(30, 12, -10), lookAt: new THREE.Vector3(0, 2, 0), t: 0.75 },
    { pos: new THREE.Vector3(5, 6, -15), lookAt: new THREE.Vector3(0, 1.5, 0), t: 1 },
  ];
}

function interpolatePath(
  path: Array<{ pos: THREE.Vector3; lookAt: THREE.Vector3; t: number }>,
  t: number,
): { pos: THREE.Vector3; lookAt: THREE.Vector3 } {
  if (path.length === 0) {
    return { pos: new THREE.Vector3(), lookAt: new THREE.Vector3() };
  }
  if (t <= 0) return { pos: path[0].pos.clone(), lookAt: path[0].lookAt.clone() };
  if (t >= 1) {
    const last = path[path.length - 1];
    return { pos: last.pos.clone(), lookAt: last.lookAt.clone() };
  }

  // Find segment
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    if (t >= a.t && t <= b.t) {
      const segT = (t - a.t) / (b.t - a.t);
      const eased = segT < 0.5 ? 2 * segT * segT : 1 - Math.pow(-2 * segT + 2, 2) / 2;
      return {
        pos: a.pos.clone().lerp(b.pos, eased),
        lookAt: a.lookAt.clone().lerp(b.lookAt, eased),
      };
    }
  }
  return { pos: path[0].pos.clone(), lookAt: path[0].lookAt.clone() };
}

// ─────────────────────────────────────────────────────────────────────
//  MAIN API
// ─────────────────────────────────────────────────────────────────────

/**
 * Play the match intro. Returns when the intro completes (or is skipped).
 * Call BEFORE unlocking player input.
 */
export function playMatchIntro(opts: MatchIntroOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    if (introState.active) { resolve(); return; }

    introState.active = true;
    introState.skipRequested = false;
    introState.startTime = performance.now() / 1000;
    introState.phase = 'map';
    introState.opts = opts;
    introState.overlay = createOverlay(opts);

    // Cache camera state
    introState.cameraRestore = {
      pos: opts.camera.position.clone(),
      quat: opts.camera.quaternion.clone(),
      fov: opts.camera.fov,
    };

    // Lock input
    gameState._introActive = true;

    // Fade in the overlay, then trigger map phase
    requestAnimationFrame(() => {
      const fade = introState.overlay!.querySelector('.mi-fade') as HTMLElement;
      fade.classList.add('hide');
      const mapEl = introState.overlay!.querySelector('.mi-phase-map') as HTMLElement;
      mapEl.classList.add('show');
    });

    // Play sound
    import('@/audio/SoundHooks').then(s => {
      try { (s as any).playObjective?.() ?? (s as any).playAlert?.(); } catch { /* */ }
    }).catch(() => { /* */ });

    // Skip listener
    const keyListener = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Escape') {
        introState.skipRequested = true;
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', keyListener);
    introState.keyListener = keyListener;

    // Spin up update loop (separate from game loop — this runs independent of gameState.timeScale)
    let last = performance.now() / 1000;
    function tick() {
      if (!introState.active) return;
      const now = performance.now() / 1000;
      const dt = now - last;
      last = now;

      const elapsed = now - introState.startTime;
      stepIntro(elapsed, dt);

      if (introState.phase === 'done') {
        cleanup();
        resolve();
      } else {
        requestAnimationFrame(tick);
      }
    }
    requestAnimationFrame(tick);
  });
}

function stepIntro(elapsed: number, dt: number): void {
  if (!introState.opts || !introState.overlay) return;

  // Fast-skip: ESC key or second SPACE within 0.5s → go to fight phase
  // Normal skip: SPACE → advance to next phase
  if (introState.skipRequested) {
    introState.skipRequested = false;
    introState.opts.onSkip?.();
    // Jump to end
    introState.phase = 'done';
    return;
  }

  const opts = introState.opts;
  const overlay = introState.overlay;
  const mapEl = overlay.querySelector('.mi-phase-map') as HTMLElement;
  const rosterEl = overlay.querySelector('.mi-phase-rosters') as HTMLElement;
  const fightEl = overlay.querySelector('.mi-phase-fight') as HTMLElement;

  if (elapsed < T_MAP_END) {
    introState.phase = 'map';
    overlay.classList.remove('sweep');
  } else if (elapsed < T_SWEEP_END) {
    if (introState.phase !== 'sweep') {
      introState.phase = 'sweep';
      mapEl.classList.remove('show');
      overlay.classList.add('sweep');
    }
    // Camera sweep
    const path = opts.arena?.cameraPath ?? defaultCameraPath();
    const t = (elapsed - T_MAP_END) / (T_SWEEP_END - T_MAP_END);
    const sample = interpolatePath(path, t);
    opts.camera.position.copy(sample.pos);
    opts.camera.lookAt(sample.lookAt.x, sample.lookAt.y, sample.lookAt.z);
  } else if (elapsed < T_ROSTERS_END) {
    if (introState.phase !== 'rosters') {
      introState.phase = 'rosters';
      overlay.classList.remove('sweep');
      rosterEl.classList.add('show');
    }
  } else {
    // Rosters finished — end the intro immediately with no fade-out,
    // no black curtain, no FIGHT slate. Goes straight to gameplay.
    introState.phase = 'done';
  }
}

function cleanup(): void {
  const opts = introState.opts;
  if (opts && introState.cameraRestore) {
    opts.camera.position.copy(introState.cameraRestore.pos);
    opts.camera.quaternion.copy(introState.cameraRestore.quat);
    opts.camera.fov = introState.cameraRestore.fov;
    opts.camera.updateProjectionMatrix();
  }
  introState.overlay?.remove();
  introState.overlay = null;
  if (introState.keyListener) {
    window.removeEventListener('keydown', introState.keyListener);
    introState.keyListener = null;
  }
  introState.active = false;
  introState.cameraRestore = null;
  introState.opts = null;
  gameState._introActive = false;
}

export function isIntroActive(): boolean {
  return introState.active;
}

export function skipIntro(): void {
  introState.skipRequested = true;
}