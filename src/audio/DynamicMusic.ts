/**
 * DynamicMusic — three-layer intensity music system.
 *
 * Three layers:
 *   ambient  — always active, low drone, subtle pad
 *   tension  — mid-range pulsing, kicks in when enemies are nearby
 *   combat   — driving low-end + sharp transients, during active engagement
 *
 * Intensity is a 0-1 float computed each frame from:
 *   - Time since player's last damage taken
 *   - Time since player's last shot fired
 *   - Number of enemies visible (proximity-based)
 *   - Player HP
 *   - Suppression level
 */

import { gameState } from '@/core/GameState';
import { Audio } from './AudioManager';
import { getSuppressionLevel } from '@/combat/Suppression';

interface Layer {
  nodes: OscillatorNode[];
  gain: GainNode | null;
  targetVol: number;
  currentVol: number;
  maxVol: number;
}

const layers: Record<'ambient' | 'tension' | 'combat', Layer> = {
  ambient: { nodes: [], gain: null, targetVol: 0, currentVol: 0, maxVol: 0.12 },
  tension: { nodes: [], gain: null, targetVol: 0, currentVol: 0, maxVol: 0.10 },
  combat:  { nodes: [], gain: null, targetVol: 0, currentVol: 0, maxVol: 0.15 },
};

let started = false;
let lastIntensity = 0;

export function startDynamicMusic(): void {
  if (started) return;
  if (!Audio.ctx) Audio.init();
  if (!Audio.ctx) return;
  started = true;

  const ctx = Audio.ctx;

  // ── AMBIENT: low sine drone, very slow pulse ──
  {
    const l = layers.ambient;
    l.gain = ctx.createGain();
    l.gain.gain.value = 0;
    l.gain.connect(Audio.busMusic);

    for (const f of [55, 55.4, 82.4]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const oscGain = ctx.createGain();
      oscGain.gain.value = f > 60 ? 0.5 : 0.8;
      osc.connect(oscGain);
      oscGain.connect(l.gain);
      osc.start();
      l.nodes.push(osc);
    }

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.12;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.35;
    lfo.connect(lfoG);
    lfoG.connect(l.gain.gain);
    lfo.start();
    l.nodes.push(lfo);
  }

  // ── TENSION: mid-range sawtooth + filtered, arpeggio LFO ──
  {
    const l = layers.tension;
    l.gain = ctx.createGain();
    l.gain.gain.value = 0;
    l.gain.connect(Audio.busMusic);

    for (const f of [220, 261.6, 329.6]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = 0.08;
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = f * 2;
      filt.Q.value = 4;
      osc.connect(filt);
      filt.connect(og);
      og.connect(l.gain);
      osc.start();
      l.nodes.push(osc);
    }

    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = 1.0;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.6;
    lfo.connect(lfoG);
    lfoG.connect(l.gain.gain);
    lfo.start();
    l.nodes.push(lfo);
  }

  // ── COMBAT: driving low saw + high stab, faster LFO ──
  {
    const l = layers.combat;
    l.gain = ctx.createGain();
    l.gain.gain.value = 0;
    l.gain.connect(Audio.busMusic);

    for (const f of [55, 82.4, 110]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = f < 80 ? 0.18 : 0.08;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 380;
      filt.Q.value = 2;
      osc.connect(filt);
      filt.connect(og);
      og.connect(l.gain);
      osc.start();
      l.nodes.push(osc);
    }

    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 2.3;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 1.2;
    lfo.connect(lfoG);
    lfoG.connect(l.gain.gain);
    lfo.start();
    l.nodes.push(lfo);
  }

  layers.ambient.targetVol = layers.ambient.maxVol;
}

function computeIntensity(): number {
  if (gameState.mainMenuOpen || gameState.pDead) return 0;

  const now = gameState.worldElapsed;
  const player = gameState.player;

  const timeSinceHit = now - (player.lastDamageTime ?? -999);
  const damageSignal = Math.max(0, 1 - timeSinceHit / 4);

  let nearbyEnemies = 0;
  const enemyRange2 = 35 * 35;
  for (const ag of gameState.agents) {
    if (ag === player || ag.isDead) continue;
    const enemy = gameState.mode === 'ffa' || gameState.mode === 'br'
      ? true
      : ag.team !== player.team;
    if (!enemy) continue;
    const dx = ag.position.x - player.position.x;
    const dz = ag.position.z - player.position.z;
    if (dx * dx + dz * dz < enemyRange2) nearbyEnemies++;
  }
  const enemySignal = Math.min(1, nearbyEnemies / 3);

  const suppressSignal = getSuppressionLevel();

  const hpRatio = gameState.pHP / 100;
  const hpSignal = hpRatio < 0.5 ? (0.5 - hpRatio) * 2 : 0;

  const timeSinceShot = gameState.pShootTimer > 0
    ? 0
    : now - ((gameState as any)._lastShotTime ?? 999);
  const shotSignal = Math.max(0, 1 - (timeSinceShot as number) / 6);

  const intensity = Math.min(1,
    damageSignal * 0.45 +
    suppressSignal * 0.35 +
    enemySignal * 0.30 +
    shotSignal * 0.20 +
    hpSignal * 0.15,
  );

  return intensity;
}

export function updateDynamicMusic(dt: number): void {
  if (!started) return;
  if (!Audio.ctx || !layers.ambient.gain) return;

  const target = computeIntensity();

  const smoothing = target > lastIntensity ? 1.5 : 0.6;
  lastIntensity = lastIntensity + (target - lastIntensity) * Math.min(1, dt * smoothing);
  const intensity = lastIntensity;

  layers.ambient.targetVol = layers.ambient.maxVol * (1 - intensity * 0.3);
  layers.tension.targetVol = layers.tension.maxVol *
    Math.max(0, Math.min(1, (intensity - 0.15) / 0.4));
  layers.combat.targetVol = layers.combat.maxVol *
    Math.max(0, Math.min(1, (intensity - 0.55) / 0.35));

  for (const l of Object.values(layers)) {
    if (!l.gain) continue;
    const diff = l.targetVol - l.currentVol;
    l.currentVol += diff * Math.min(1, dt * 2.2);
    l.gain.gain.value = l.currentVol;
  }
}

export function stopDynamicMusic(): void {
  for (const l of Object.values(layers)) {
    for (const n of l.nodes) {
      try { n.stop(); } catch {}
    }
    l.nodes.length = 0;
    if (l.gain) l.gain.disconnect();
    l.gain = null;
    l.currentVol = 0;
    l.targetVol = 0;
  }
  started = false;
  lastIntensity = 0;
}
