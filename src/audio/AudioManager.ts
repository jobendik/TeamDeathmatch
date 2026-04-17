/**
 * AudioManager — Web Audio API mixer.
 *
 * Two modes:
 *   - SYNTH (default): procedurally generated sounds. Works with zero assets.
 *   - SAMPLES: drop in WAVs/OGGs at /public/audio/<name>.wav and they take over.
 *
 * 3D spatial audio for world events (shots, footsteps), 2D for UI.
 *
 * Drop real assets later — register them in REAL_SOUND_URLS and they'll
 * automatically replace the synth versions.
 */

import * as THREE from 'three';
import { gameState } from '@/core/GameState';

type SoundCategory = 'sfx' | 'voice' | 'music' | 'ui';

interface SoundDef {
  category: SoundCategory;
  /** Base volume 0..1 */
  volume: number;
  /** If true, can play overlapping copies */
  polyphonic?: boolean;
  /** Synth function used when no sample is loaded */
  synth: (ctx: AudioContext, dest: AudioNode) => number; // returns duration
}

interface PlayOpts {
  /** World position for 3D positional audio. Omit for 2D. */
  pos?: THREE.Vector3 | { x: number; y: number; z: number };
  /** 0..1 multiplier on top of base volume */
  volume?: number;
  /** Random pitch variation, e.g. 0.1 = ±5% */
  pitchJitter?: number;
  /** Override pitch */
  pitch?: number;
}

// ─────────────────────────────────────────────────────────────────────
//  CORE
// ─────────────────────────────────────────────────────────────────────

class AudioMgr {
  ctx: AudioContext | null = null;
  listener: AudioListener | null = null;
  masterGain!: GainNode;
  busSfx!: GainNode;
  busVoice!: GainNode;
  busMusic!: GainNode;
  busUi!: GainNode;
  compressor!: DynamicsCompressorNode;

  private samples = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private playingLoops = new Map<string, AudioBufferSourceNode>();

  enabled = true;
  initialized = false;

  // User-adjustable
  masterVolume = 0.7;
  sfxVolume = 1.0;
  voiceVolume = 1.0;
  musicVolume = 0.5;

  init(): void {
    if (this.initialized) return;
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.listener = this.ctx.listener;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 24;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.25;
      this.compressor.connect(this.ctx.destination);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(this.compressor);

      this.busSfx = this.ctx.createGain();
      this.busSfx.gain.value = this.sfxVolume;
      this.busSfx.connect(this.masterGain);

      this.busVoice = this.ctx.createGain();
      this.busVoice.gain.value = this.voiceVolume;
      this.busVoice.connect(this.masterGain);

      this.busMusic = this.ctx.createGain();
      this.busMusic.gain.value = this.musicVolume;
      this.busMusic.connect(this.masterGain);

      this.busUi = this.ctx.createGain();
      this.busUi.gain.value = 0.8;
      this.busUi.connect(this.masterGain);

      this.initialized = true;

      // Try to load real assets if present
      this.preloadRealAssets();
    } catch (e) {
      console.warn('[Audio] Failed to init:', e);
      this.enabled = false;
    }
  }

  /** Web Audio requires a user gesture to start. Call on first click/key. */
  async resume(): Promise<void> {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  setMaster(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain) this.masterGain.gain.value = this.masterVolume;
  }
  setSfx(v: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    if (this.busSfx) this.busSfx.gain.value = this.sfxVolume;
  }
  setMusic(v: number): void {
    this.musicVolume = Math.max(0, Math.min(1, v));
    if (this.busMusic) this.busMusic.gain.value = this.musicVolume;
  }

  // ── Sample loading ──

  private async preloadRealAssets(): Promise<void> {
    const BASE = (import.meta as any).env?.BASE_URL ?? '/';
    for (const [id, file] of Object.entries(REAL_SOUND_URLS)) {
      this.loadSample(id, `${BASE}audio/${file}`).catch(() => {
        // Silent fail — synth fallback will be used
      });
    }
  }

  async loadSample(id: string, url: string): Promise<AudioBuffer | null> {
    if (this.samples.has(id)) return this.samples.get(id)!;
    const existing = this.loading.get(id);
    if (existing) return existing;
    if (!this.ctx) return null;

    const promise = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const arr = await res.arrayBuffer();
        const buf = await this.ctx!.decodeAudioData(arr);
        this.samples.set(id, buf);
        return buf;
      } catch {
        return null;
      }
    })();
    this.loading.set(id, promise);
    return promise;
  }

  // ── Listener position update (called from game loop) ──

  updateListener(pos: THREE.Vector3, forward: THREE.Vector3, up = new THREE.Vector3(0, 1, 0)): void {
    if (!this.listener) return;
    if (this.listener.positionX) {
      this.listener.positionX.value = pos.x;
      this.listener.positionY.value = pos.y;
      this.listener.positionZ.value = pos.z;
      this.listener.forwardX.value = forward.x;
      this.listener.forwardY.value = forward.y;
      this.listener.forwardZ.value = forward.z;
      this.listener.upX.value = up.x;
      this.listener.upY.value = up.y;
      this.listener.upZ.value = up.z;
    } else {
      // Old API
      (this.listener as any).setPosition(pos.x, pos.y, pos.z);
      (this.listener as any).setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  // ── Play ──

  play(id: string, opts: PlayOpts = {}): void {
    if (!this.enabled || !this.ctx || !this.initialized) return;
    const def = SOUNDS[id];
    if (!def) return;

    const bus =
      def.category === 'sfx' ? this.busSfx :
      def.category === 'voice' ? this.busVoice :
      def.category === 'music' ? this.busMusic : this.busUi;

    // Per-call gain
    const callGain = this.ctx.createGain();
    callGain.gain.value = (opts.volume ?? 1) * def.volume;

    let dest: AudioNode = bus;

    // 3D positional
    if (opts.pos) {
      const panner = this.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 4;
      panner.maxDistance = 80;
      panner.rolloffFactor = 1.4;
      if (panner.positionX) {
        panner.positionX.value = opts.pos.x;
        panner.positionY.value = opts.pos.y;
        panner.positionZ.value = opts.pos.z;
      } else {
        (panner as any).setPosition(opts.pos.x, opts.pos.y, opts.pos.z);
      }
      panner.connect(callGain);
      callGain.connect(bus);
      dest = panner;
    } else {
      callGain.connect(bus);
      dest = callGain;
    }

    // Sample available?
    const buf = this.samples.get(id);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const pitch = opts.pitch ?? (1 + (opts.pitchJitter ?? 0) * (Math.random() - 0.5) * 2);
      src.playbackRate.value = pitch;
      src.connect(dest);
      src.start();
    } else {
      // Fall back to synth
      def.synth(this.ctx, dest);
    }
  }

  /** Start a looping sound. Call stopLoop(id) to end. */
  loop(id: string, volume = 1): void {
    if (!this.enabled || !this.ctx) return;
    if (this.playingLoops.has(id)) return;
    const buf = this.samples.get(id);
    if (!buf) return; // Loops require real samples; synth loops are too expensive

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g);
    g.connect(this.busSfx);
    src.start();
    this.playingLoops.set(id, src);
  }

  stopLoop(id: string): void {
    const src = this.playingLoops.get(id);
    if (src) {
      src.stop();
      this.playingLoops.delete(id);
    }
  }
}

export const Audio = new AudioMgr();

// ─────────────────────────────────────────────────────────────────────
//  SYNTH PRIMITIVES
//  These build sounds using oscillators + noise + envelopes when no
//  real sample is loaded. They're not great — they're functional.
// ─────────────────────────────────────────────────────────────────────

function whiteNoise(ctx: AudioContext, duration: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, sr * duration, sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function envelope(g: GainNode, t: number, attack: number, decay: number, peak: number): void {
  const p = g.gain;
  p.cancelScheduledValues(t);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function gunshot(ctx: AudioContext, dest: AudioNode, freq: number, dur: number, body: number): number {
  const t = ctx.currentTime;

  // Body: low-frequency thump
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq * 2.5, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur);
  const oscG = ctx.createGain();
  envelope(oscG, t, 0.001, dur * 0.6, body);
  osc.connect(oscG).connect(dest);
  osc.start(t);
  osc.stop(t + dur);

  // Crack: filtered noise burst
  const noise = ctx.createBufferSource();
  noise.buffer = whiteNoise(ctx, dur + 0.05);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 1200;
  const noiseG = ctx.createGain();
  envelope(noiseG, t, 0.001, dur * 0.4, 0.6);
  noise.connect(filter).connect(noiseG).connect(dest);
  noise.start(t);
  noise.stop(t + dur);

  return dur;
}

// ─────────────────────────────────────────────────────────────────────
//  SOUND LIBRARY
// ─────────────────────────────────────────────────────────────────────

const SOUNDS: Record<string, SoundDef> = {
  // ── Weapons (synthesized fallbacks) ──
  shot_pistol:   { category: 'sfx', volume: 0.55, polyphonic: true,
    synth: (ctx, d) => gunshot(ctx, d, 320, 0.12, 0.7) },
  shot_smg:      { category: 'sfx', volume: 0.45, polyphonic: true,
    synth: (ctx, d) => gunshot(ctx, d, 280, 0.10, 0.6) },
  shot_ar:       { category: 'sfx', volume: 0.50, polyphonic: true,
    synth: (ctx, d) => gunshot(ctx, d, 240, 0.13, 0.75) },
  shot_shotgun:  { category: 'sfx', volume: 0.65, polyphonic: true,
    synth: (ctx, d) => gunshot(ctx, d, 140, 0.22, 0.95) },
  shot_sniper:   { category: 'sfx', volume: 0.75, polyphonic: true,
    synth: (ctx, d) => gunshot(ctx, d, 180, 0.30, 1.0) },
  shot_rocket:   { category: 'sfx', volume: 0.7, polyphonic: true,
    synth: (ctx, d) => gunshot(ctx, d, 90, 0.45, 1.0) },

  // ── Impacts ──
  impact_body:   { category: 'sfx', volume: 0.5, polyphonic: true,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const noise = ctx.createBufferSource();
      noise.buffer = whiteNoise(ctx, 0.08);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 2;
      const g = ctx.createGain();
      envelope(g, t, 0.002, 0.06, 0.7);
      noise.connect(f).connect(g).connect(d);
      noise.start(t); noise.stop(t + 0.1);
      return 0.1;
    },
  },
  impact_headshot: { category: 'sfx', volume: 0.8, polyphonic: true,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      // Higher-pitch ping
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2200, t);
      osc.frequency.exponentialRampToValueAtTime(800, t + 0.08);
      const g = ctx.createGain();
      envelope(g, t, 0.001, 0.1, 0.5);
      osc.connect(g).connect(d);
      osc.start(t); osc.stop(t + 0.15);
      return 0.15;
    },
  },
  impact_wall:   { category: 'sfx', volume: 0.4, polyphonic: true,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const noise = ctx.createBufferSource();
      noise.buffer = whiteNoise(ctx, 0.05);
      const f = ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 2000;
      const g = ctx.createGain();
      envelope(g, t, 0.001, 0.04, 0.4);
      noise.connect(f).connect(g).connect(d);
      noise.start(t); noise.stop(t + 0.06);
      return 0.06;
    },
  },

  // ── Mechanical ──
  reload:        { category: 'sfx', volume: 0.45,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      // Click-clack
      for (const offset of [0, 0.18, 0.32]) {
        const noise = ctx.createBufferSource();
        noise.buffer = whiteNoise(ctx, 0.04);
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 5;
        const g = ctx.createGain();
        envelope(g, t + offset, 0.001, 0.05, 0.3);
        noise.connect(f).connect(g).connect(d);
        noise.start(t + offset); noise.stop(t + offset + 0.06);
      }
      return 0.4;
    },
  },
  weapon_swap:   { category: 'sfx', volume: 0.4,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const noise = ctx.createBufferSource();
      noise.buffer = whiteNoise(ctx, 0.08);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 800; f.Q.value = 3;
      const g = ctx.createGain();
      envelope(g, t, 0.001, 0.08, 0.35);
      noise.connect(f).connect(g).connect(d);
      noise.start(t); noise.stop(t + 0.1);
      return 0.1;
    },
  },
  empty_click:   { category: 'sfx', volume: 0.4,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const noise = ctx.createBufferSource();
      noise.buffer = whiteNoise(ctx, 0.02);
      const f = ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 3000;
      const g = ctx.createGain();
      envelope(g, t, 0.001, 0.02, 0.5);
      noise.connect(f).connect(g).connect(d);
      noise.start(t); noise.stop(t + 0.03);
      return 0.03;
    },
  },

  // ── Movement ──
  footstep:      { category: 'sfx', volume: 0.25, polyphonic: true,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const noise = ctx.createBufferSource();
      noise.buffer = whiteNoise(ctx, 0.08);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 250;
      const g = ctx.createGain();
      envelope(g, t, 0.005, 0.06, 0.5);
      noise.connect(f).connect(g).connect(d);
      noise.start(t); noise.stop(t + 0.1);
      return 0.1;
    },
  },
  jump:          { category: 'sfx', volume: 0.3,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const noise = ctx.createBufferSource();
      noise.buffer = whiteNoise(ctx, 0.1);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 400;
      const g = ctx.createGain();
      envelope(g, t, 0.005, 0.08, 0.5);
      noise.connect(f).connect(g).connect(d);
      noise.start(t); noise.stop(t + 0.12);
      return 0.12;
    },
  },
  land:          { category: 'sfx', volume: 0.45,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const noise = ctx.createBufferSource();
      noise.buffer = whiteNoise(ctx, 0.12);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 200;
      const g = ctx.createGain();
      envelope(g, t, 0.002, 0.1, 0.7);
      noise.connect(f).connect(g).connect(d);
      noise.start(t); noise.stop(t + 0.15);
      return 0.15;
    },
  },
  slide:         { category: 'sfx', volume: 0.5,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const noise = ctx.createBufferSource();
      noise.buffer = whiteNoise(ctx, 0.6);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 1.5;
      const g = ctx.createGain();
      const peak = 0.5;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.03);
      g.gain.linearRampToValueAtTime(peak * 0.7, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      noise.connect(f).connect(g).connect(d);
      noise.start(t); noise.stop(t + 0.62);
      return 0.6;
    },
  },

  // ── Damage / health ──
  hit_taken:     { category: 'sfx', volume: 0.55,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.2);
      const g = ctx.createGain();
      envelope(g, t, 0.001, 0.18, 0.4);
      osc.connect(g).connect(d);
      osc.start(t); osc.stop(t + 0.22);
      return 0.22;
    },
  },
  heal:          { category: 'sfx', volume: 0.45,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440 + i * 220, t + i * 0.04);
        const g = ctx.createGain();
        envelope(g, t + i * 0.04, 0.005, 0.12, 0.25);
        osc.connect(g).connect(d);
        osc.start(t + i * 0.04); osc.stop(t + i * 0.04 + 0.15);
      }
      return 0.25;
    },
  },
  pickup:        { category: 'sfx', volume: 0.4,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, t);
      osc.frequency.linearRampToValueAtTime(880, t + 0.08);
      const g = ctx.createGain();
      envelope(g, t, 0.005, 0.1, 0.35);
      osc.connect(g).connect(d);
      osc.start(t); osc.stop(t + 0.12);
      return 0.12;
    },
  },

  // ── UI ──
  ui_hover:      { category: 'ui', volume: 0.25,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 800;
      const g = ctx.createGain();
      envelope(g, t, 0.005, 0.05, 0.2);
      osc.connect(g).connect(d);
      osc.start(t); osc.stop(t + 0.06);
      return 0.06;
    },
  },
  ui_confirm:    { category: 'ui', volume: 0.4,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.linearRampToValueAtTime(660, t + 0.06);
      const g = ctx.createGain();
      envelope(g, t, 0.005, 0.08, 0.4);
      osc.connect(g).connect(d);
      osc.start(t); osc.stop(t + 0.1);
      return 0.1;
    },
  },
  ui_deny:       { category: 'ui', volume: 0.4,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.linearRampToValueAtTime(110, t + 0.12);
      const g = ctx.createGain();
      envelope(g, t, 0.005, 0.12, 0.35);
      osc.connect(g).connect(d);
      osc.start(t); osc.stop(t + 0.15);
      return 0.15;
    },
  },

  // ── Medals / announcer (tonal stingers) ──
  medal_silver: { category: 'voice', volume: 0.5,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      for (const [f, off] of [[523, 0], [659, 0.08]]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle'; osc.frequency.value = f;
        const g = ctx.createGain();
        envelope(g, t + off, 0.005, 0.18, 0.4);
        osc.connect(g).connect(d);
        osc.start(t + off); osc.stop(t + off + 0.2);
      }
      return 0.3;
    },
  },
  medal_gold: { category: 'voice', volume: 0.55,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      for (const [f, off] of [[523, 0], [659, 0.08], [784, 0.16]]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle'; osc.frequency.value = f;
        const g = ctx.createGain();
        envelope(g, t + off, 0.005, 0.22, 0.45);
        osc.connect(g).connect(d);
        osc.start(t + off); osc.stop(t + off + 0.25);
      }
      return 0.42;
    },
  },
  medal_epic: { category: 'voice', volume: 0.65,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      for (const [f, off] of [[523, 0], [659, 0.06], [784, 0.12], [1047, 0.20]]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth'; osc.frequency.value = f;
        const g = ctx.createGain();
        envelope(g, t + off, 0.005, 0.3, 0.4);
        osc.connect(g).connect(d);
        osc.start(t + off); osc.stop(t + off + 0.32);
      }
      return 0.55;
    },
  },
  victory: { category: 'voice', volume: 0.7,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const notes: [number, number][] = [[523, 0], [659, 0.15], [784, 0.30], [1047, 0.50]];
      for (const [f, off] of notes) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle'; osc.frequency.value = f;
        const g = ctx.createGain();
        envelope(g, t + off, 0.005, 0.4, 0.5);
        osc.connect(g).connect(d);
        osc.start(t + off); osc.stop(t + off + 0.45);
      }
      return 1.0;
    },
  },
  defeat: { category: 'voice', volume: 0.6,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const notes: [number, number][] = [[440, 0], [392, 0.2], [330, 0.4]];
      for (const [f, off] of notes) {
        const osc = ctx.createOscillator();
        osc.type = 'sine'; osc.frequency.value = f;
        const g = ctx.createGain();
        envelope(g, t + off, 0.005, 0.5, 0.5);
        osc.connect(g).connect(d);
        osc.start(t + off); osc.stop(t + off + 0.55);
      }
      return 0.95;
    },
  },

  // ── Voice callouts (placeholder beeps; swap with TTS lines) ──
  voice_enemy_spotted: { category: 'voice', volume: 0.5,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth'; osc.frequency.value = 660;
      const g = ctx.createGain();
      envelope(g, t, 0.005, 0.12, 0.3);
      osc.connect(g).connect(d);
      osc.start(t); osc.stop(t + 0.14);
      return 0.14;
    },
  },
  voice_need_help: { category: 'voice', volume: 0.5,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      for (const off of [0, 0.1]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth'; osc.frequency.value = 440;
        const g = ctx.createGain();
        envelope(g, t + off, 0.005, 0.1, 0.3);
        osc.connect(g).connect(d);
        osc.start(t + off); osc.stop(t + off + 0.12);
      }
      return 0.22;
    },
  },
  voice_reloading: { category: 'voice', volume: 0.45,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth'; osc.frequency.value = 330;
      const g = ctx.createGain();
      envelope(g, t, 0.005, 0.15, 0.3);
      osc.connect(g).connect(d);
      osc.start(t); osc.stop(t + 0.17);
      return 0.17;
    },
  },

  // ── Heartbeat (low HP) ──
  heartbeat: { category: 'sfx', volume: 0.5,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      for (const off of [0, 0.12]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(60, t + off);
        const g = ctx.createGain();
        envelope(g, t + off, 0.005, 0.1, 0.7);
        osc.connect(g).connect(d);
        osc.start(t + off); osc.stop(t + off + 0.13);
      }
      return 0.25;
    },
  },

  // ── Explosions ──
  explosion: { category: 'sfx', volume: 0.8, polyphonic: true,
    synth: (ctx, d) => {
      const t = ctx.currentTime;
      const noise = ctx.createBufferSource();
      noise.buffer = whiteNoise(ctx, 0.6);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(800, t);
      f.frequency.exponentialRampToValueAtTime(80, t + 0.5);
      const g = ctx.createGain();
      envelope(g, t, 0.005, 0.55, 1.0);
      noise.connect(f).connect(g).connect(d);
      noise.start(t); noise.stop(t + 0.6);

      // Sub-bass thump
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(80, t);
      osc.frequency.exponentialRampToValueAtTime(30, t + 0.3);
      const og = ctx.createGain();
      envelope(og, t, 0.001, 0.3, 0.8);
      osc.connect(og).connect(d);
      osc.start(t); osc.stop(t + 0.32);
      return 0.6;
    },
  },
};

/**
 * Real asset URLs. Drop files into /public/audio/<filename> and they'll
 * be loaded automatically and replace the synth versions.
 *
 * Recommended pack: Kenney's "Impact Sounds", "Sci-fi Sounds", and
 * "Music Loops" (CC0). Or any pack with .wav / .ogg shorts.
 */
export const REAL_SOUND_URLS: Record<string, string> = {
  // shot_pistol: 'shot_pistol.wav',
  // shot_ar: 'shot_ar.wav',
  // ...
};