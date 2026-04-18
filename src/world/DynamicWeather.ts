/**
 * DynamicWeather — mid-match transitions between weather presets.
 *
 * Problem: existing Lights.ts rolls a random weather preset at scene reset.
 * Players never see weather change. Missed atmospheric opportunity.
 *
 * Solution: probabilistic mid-match weather shifts with smooth multi-channel
 * interpolation (fog density/color, ambient intensity, directional color,
 * sky tint, precipitation intensity).
 *
 * Shift types:
 *   - Storm rolling in: clear → overcast → storm → rain
 *   - Storm clearing: rain → overcast → clear
 *   - Fog descending: clear → fog
 *   - Dawn → noon → dusk → night (time-of-day)
 *
 * Transitions take 30-60 seconds so they feel natural. One transition per
 * match typical, two maximum.
 *
 * Particle systems (rain, snow, dust) drive off a single `precipitation`
 * channel that can smoothly crossfade types.
 *
 * Integration:
 *   - initDynamicWeather(scene, renderer) once at match start
 *   - updateDynamicWeather(dt) from GameLoop
 *   - readWeatherState() for UI / sound (rain audio volume tracks intensity)
 */

import * as THREE from 'three';

export type WeatherPreset = 'clear' | 'overcast' | 'storm' | 'rain' | 'fog' | 'snow' | 'dusk' | 'night' | 'dawn';

interface WeatherChannels {
  skyTop: THREE.Color;
  skyBottom: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;
  ambientColor: THREE.Color;
  ambientIntensity: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  sunAngle: number;         // radians above horizon (0 = sunset, pi/2 = noon)
  rainIntensity: number;    // 0-1
  snowIntensity: number;    // 0-1
  windSpeed: number;        // m/s
  lightningChancePerSec: number;
}

const PRESETS: Record<WeatherPreset, WeatherChannels> = {
  clear: {
    skyTop: new THREE.Color(0x4a90ff), skyBottom: new THREE.Color(0xbfe0ff),
    fogColor: new THREE.Color(0xd0e5ff), fogDensity: 0.0025,
    ambientColor: new THREE.Color(0xf0f5ff), ambientIntensity: 0.55,
    sunColor: new THREE.Color(0xffeedd), sunIntensity: 1.4,
    sunAngle: 1.1, rainIntensity: 0, snowIntensity: 0,
    windSpeed: 1.5, lightningChancePerSec: 0,
  },
  overcast: {
    skyTop: new THREE.Color(0x657585), skyBottom: new THREE.Color(0x9daab5),
    fogColor: new THREE.Color(0x9daab5), fogDensity: 0.009,
    ambientColor: new THREE.Color(0xb0c0d0), ambientIntensity: 0.75,
    sunColor: new THREE.Color(0xa5b0c0), sunIntensity: 0.45,
    sunAngle: 0.9, rainIntensity: 0, snowIntensity: 0,
    windSpeed: 4, lightningChancePerSec: 0,
  },
  storm: {
    skyTop: new THREE.Color(0x2a3040), skyBottom: new THREE.Color(0x556070),
    fogColor: new THREE.Color(0x4a5565), fogDensity: 0.022,
    ambientColor: new THREE.Color(0x606878), ambientIntensity: 0.45,
    sunColor: new THREE.Color(0x80889a), sunIntensity: 0.2,
    sunAngle: 0.8, rainIntensity: 0.85, snowIntensity: 0,
    windSpeed: 12, lightningChancePerSec: 0.12,
  },
  rain: {
    skyTop: new THREE.Color(0x445565), skyBottom: new THREE.Color(0x7a8898),
    fogColor: new THREE.Color(0x6b7888), fogDensity: 0.015,
    ambientColor: new THREE.Color(0x8090a0), ambientIntensity: 0.55,
    sunColor: new THREE.Color(0x90a0b0), sunIntensity: 0.3,
    sunAngle: 0.85, rainIntensity: 0.55, snowIntensity: 0,
    windSpeed: 6, lightningChancePerSec: 0.02,
  },
  fog: {
    skyTop: new THREE.Color(0xc0c0c5), skyBottom: new THREE.Color(0xe0e0e5),
    fogColor: new THREE.Color(0xdadbe0), fogDensity: 0.05,
    ambientColor: new THREE.Color(0xe0e0e8), ambientIntensity: 0.85,
    sunColor: new THREE.Color(0xffffff), sunIntensity: 0.4,
    sunAngle: 0.7, rainIntensity: 0, snowIntensity: 0,
    windSpeed: 0.5, lightningChancePerSec: 0,
  },
  snow: {
    skyTop: new THREE.Color(0x7a8a9a), skyBottom: new THREE.Color(0xc8d0d8),
    fogColor: new THREE.Color(0xb0b8c0), fogDensity: 0.012,
    ambientColor: new THREE.Color(0xd0d8e0), ambientIntensity: 0.8,
    sunColor: new THREE.Color(0xf0f0ff), sunIntensity: 0.8,
    sunAngle: 0.6, rainIntensity: 0, snowIntensity: 0.6,
    windSpeed: 3, lightningChancePerSec: 0,
  },
  dusk: {
    skyTop: new THREE.Color(0x2a1a3a), skyBottom: new THREE.Color(0xff7744),
    fogColor: new THREE.Color(0xcc6633), fogDensity: 0.008,
    ambientColor: new THREE.Color(0xff9966), ambientIntensity: 0.4,
    sunColor: new THREE.Color(0xff5522), sunIntensity: 1.2,
    sunAngle: 0.12, rainIntensity: 0, snowIntensity: 0,
    windSpeed: 2, lightningChancePerSec: 0,
  },
  night: {
    skyTop: new THREE.Color(0x05080f), skyBottom: new THREE.Color(0x101828),
    fogColor: new THREE.Color(0x0a1020), fogDensity: 0.018,
    ambientColor: new THREE.Color(0x404860), ambientIntensity: 0.35,
    sunColor: new THREE.Color(0x5060a0), sunIntensity: 0.2, // "moon"
    sunAngle: 1.2, rainIntensity: 0, snowIntensity: 0,
    windSpeed: 1, lightningChancePerSec: 0,
  },
  dawn: {
    skyTop: new THREE.Color(0x3a2050), skyBottom: new THREE.Color(0xff9966),
    fogColor: new THREE.Color(0xdd8855), fogDensity: 0.012,
    ambientColor: new THREE.Color(0xffaa77), ambientIntensity: 0.5,
    sunColor: new THREE.Color(0xff6622), sunIntensity: 1.0,
    sunAngle: 0.15, rainIntensity: 0, snowIntensity: 0,
    windSpeed: 1.5, lightningChancePerSec: 0,
  },
};

// Plausible transitions (directed graph)
const TRANSITIONS: Record<WeatherPreset, WeatherPreset[]> = {
  clear: ['overcast', 'fog', 'dusk'],
  overcast: ['clear', 'rain', 'storm', 'fog'],
  storm: ['rain', 'overcast'],
  rain: ['overcast', 'storm'],
  fog: ['clear', 'overcast'],
  snow: ['overcast', 'clear'],
  dusk: ['night'],
  night: ['dawn'],
  dawn: ['clear'],
};

// ─────────────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────────────

interface DynamicWeatherState {
  scene: THREE.Scene | null;
  currentPreset: WeatherPreset;
  targetPreset: WeatherPreset;
  current: WeatherChannels;
  origin: WeatherChannels;
  target: WeatherChannels;
  transitionT: number;       // 0-1
  transitionDuration: number; // seconds
  transitioning: boolean;
  matchElapsed: number;
  nextShiftAttempt: number;  // seconds
  transitionsThisMatch: number;

  fog: THREE.FogExp2 | null;
  ambient: THREE.AmbientLight | null;
  sun: THREE.DirectionalLight | null;

  rainSystem: RainSystem | null;
  snowSystem: SnowSystem | null;
  lightningCooldown: number;
}

const state: DynamicWeatherState = {
  scene: null,
  currentPreset: 'clear',
  targetPreset: 'clear',
  current: cloneChannels(PRESETS.clear),
  origin: cloneChannels(PRESETS.clear),
  target: cloneChannels(PRESETS.clear),
  transitionT: 0,
  transitionDuration: 0,
  transitioning: false,
  matchElapsed: 0,
  nextShiftAttempt: 45, // first shift possible after 45s
  transitionsThisMatch: 0,
  fog: null,
  ambient: null,
  sun: null,
  rainSystem: null,
  snowSystem: null,
  lightningCooldown: 0,
};

function cloneChannels(c: WeatherChannels): WeatherChannels {
  return {
    skyTop: c.skyTop.clone(),
    skyBottom: c.skyBottom.clone(),
    fogColor: c.fogColor.clone(),
    fogDensity: c.fogDensity,
    ambientColor: c.ambientColor.clone(),
    ambientIntensity: c.ambientIntensity,
    sunColor: c.sunColor.clone(),
    sunIntensity: c.sunIntensity,
    sunAngle: c.sunAngle,
    rainIntensity: c.rainIntensity,
    snowIntensity: c.snowIntensity,
    windSpeed: c.windSpeed,
    lightningChancePerSec: c.lightningChancePerSec,
  };
}

function lerpChannels(out: WeatherChannels, a: WeatherChannels, b: WeatherChannels, t: number): void {
  const te = easeInOut(t);
  out.skyTop.lerpColors(a.skyTop, b.skyTop, te);
  out.skyBottom.lerpColors(a.skyBottom, b.skyBottom, te);
  out.fogColor.lerpColors(a.fogColor, b.fogColor, te);
  out.fogDensity = lerp(a.fogDensity, b.fogDensity, te);
  out.ambientColor.lerpColors(a.ambientColor, b.ambientColor, te);
  out.ambientIntensity = lerp(a.ambientIntensity, b.ambientIntensity, te);
  out.sunColor.lerpColors(a.sunColor, b.sunColor, te);
  out.sunIntensity = lerp(a.sunIntensity, b.sunIntensity, te);
  out.sunAngle = lerp(a.sunAngle, b.sunAngle, te);
  out.rainIntensity = lerp(a.rainIntensity, b.rainIntensity, te);
  out.snowIntensity = lerp(a.snowIntensity, b.snowIntensity, te);
  out.windSpeed = lerp(a.windSpeed, b.windSpeed, te);
  out.lightningChancePerSec = lerp(a.lightningChancePerSec, b.lightningChancePerSec, te);
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function easeInOut(t: number): number { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

// ─────────────────────────────────────────────────────────────────────
//  PRECIPITATION SYSTEMS
// ─────────────────────────────────────────────────────────────────────

class RainSystem {
  public mesh: THREE.Points;
  private velocities: Float32Array;
  private count: number;
  private radius: number;
  private intensity: number = 0;

  constructor(scene: THREE.Scene, count: number = 4000, radius: number = 100) {
    this.count = count;
    this.radius = radius;
    const positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * radius * 2;
      positions[i * 3 + 1] = Math.random() * 60;
      positions[i * 3 + 2] = (Math.random() - 0.5) * radius * 2;
      this.velocities[i * 3 + 0] = -2;
      this.velocities[i * 3 + 1] = -45;
      this.velocities[i * 3 + 2] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xaabbcc, size: 0.08, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(dt: number, intensity: number, windSpeed: number, cameraPos: THREE.Vector3): void {
    this.intensity = intensity;
    const mat = this.mesh.material as THREE.PointsMaterial;
    mat.opacity = intensity * 0.45;
    this.mesh.visible = intensity > 0.02;
    if (!this.mesh.visible) return;

    const posAttr = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      const ix = i * 3;
      arr[ix + 0] += this.velocities[ix + 0] * dt + windSpeed * dt * 0.3;
      arr[ix + 1] += this.velocities[ix + 1] * dt * (0.5 + intensity);
      // Respawn when below ground or too far
      if (arr[ix + 1] < 0) {
        arr[ix + 0] = cameraPos.x + (Math.random() - 0.5) * this.radius * 2;
        arr[ix + 1] = cameraPos.y + 40 + Math.random() * 20;
        arr[ix + 2] = cameraPos.z + (Math.random() - 0.5) * this.radius * 2;
      }
    }
    posAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

class SnowSystem {
  public mesh: THREE.Points;
  private velocities: Float32Array;
  private count: number;
  private radius: number;
  private phases: Float32Array;

  constructor(scene: THREE.Scene, count: number = 3000, radius: number = 80) {
    this.count = count;
    this.radius = radius;
    const positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * radius * 2;
      positions[i * 3 + 1] = Math.random() * 50;
      positions[i * 3 + 2] = (Math.random() - 0.5) * radius * 2;
      this.velocities[i * 3 + 1] = -1.2 - Math.random() * 0.5;
      this.phases[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.18, transparent: true, opacity: 0, depthWrite: false,
    });
    this.mesh = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(dt: number, intensity: number, windSpeed: number, cameraPos: THREE.Vector3, elapsed: number): void {
    const mat = this.mesh.material as THREE.PointsMaterial;
    mat.opacity = intensity * 0.7;
    this.mesh.visible = intensity > 0.02;
    if (!this.mesh.visible) return;

    const posAttr = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      const ix = i * 3;
      arr[ix + 0] += Math.sin(elapsed + this.phases[i]) * dt * 0.4 + windSpeed * dt * 0.15;
      arr[ix + 1] += this.velocities[ix + 1] * dt;
      arr[ix + 2] += Math.cos(elapsed + this.phases[i]) * dt * 0.4;
      if (arr[ix + 1] < 0) {
        arr[ix + 0] = cameraPos.x + (Math.random() - 0.5) * this.radius * 2;
        arr[ix + 1] = cameraPos.y + 30 + Math.random() * 20;
        arr[ix + 2] = cameraPos.z + (Math.random() - 0.5) * this.radius * 2;
      }
    }
    posAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────
//  LIGHTNING FLASH
// ─────────────────────────────────────────────────────────────────────

let lightningFlashEl: HTMLDivElement | null = null;

function ensureLightningOverlay(): HTMLDivElement {
  if (lightningFlashEl) return lightningFlashEl;
  lightningFlashEl = document.createElement('div');
  lightningFlashEl.id = 'lightningFlash';
  document.body.appendChild(lightningFlashEl);
  const s = document.createElement('style');
  s.textContent = `
    #lightningFlash {
      position: fixed; inset: 0;
      background: white;
      opacity: 0; pointer-events: none;
      z-index: 8;
      mix-blend-mode: screen;
    }
    #lightningFlash.flash {
      animation: lightningFlash 0.7s ease-out;
    }
    @keyframes lightningFlash {
      0% { opacity: 0; }
      4% { opacity: 0.85; }
      8% { opacity: 0.2; }
      14% { opacity: 0.7; }
      20% { opacity: 0; }
      100% { opacity: 0; }
    }
  `;
  document.head.appendChild(s);
  return lightningFlashEl;
}

function triggerLightning(): void {
  const el = ensureLightningOverlay();
  el.classList.remove('flash');
  // Force reflow to restart animation
  void el.offsetWidth;
  el.classList.add('flash');

  // Delayed thunder sound
  const thunderDelay = 600 + Math.random() * 1600;
  setTimeout(() => {
    import('@/audio/SoundHooks').then(s => {
      try { (s as any).playThunder?.() ?? (s as any).playExplosion?.(); } catch { /* */ }
    }).catch(() => { /* */ });
  }, thunderDelay);

  // Momentary sun intensity spike
  if (state.sun) {
    const baseI = state.sun.intensity;
    state.sun.intensity = baseI + 2.5;
    setTimeout(() => { if (state.sun) state.sun.intensity = baseI; }, 60);
    setTimeout(() => { if (state.sun) state.sun.intensity = baseI + 1.8; }, 160);
    setTimeout(() => { if (state.sun) state.sun.intensity = baseI; }, 220);
  }
}

// ─────────────────────────────────────────────────────────────────────
//  MAIN LIFECYCLE
// ─────────────────────────────────────────────────────────────────────

export function initDynamicWeather(
  scene: THREE.Scene,
  ambient: THREE.AmbientLight,
  sun: THREE.DirectionalLight,
  initialPreset: WeatherPreset = 'clear',
): void {
  state.scene = scene;
  state.ambient = ambient;
  state.sun = sun;

  // Ensure scene has exponential fog
  if (!(scene.fog instanceof THREE.FogExp2)) {
    scene.fog = new THREE.FogExp2(0xd0e5ff, 0.0025);
  }
  state.fog = scene.fog as THREE.FogExp2;

  state.currentPreset = initialPreset;
  state.targetPreset = initialPreset;
  state.current = cloneChannels(PRESETS[initialPreset]);
  state.origin = cloneChannels(PRESETS[initialPreset]);
  state.target = cloneChannels(PRESETS[initialPreset]);

  // Create precipitation systems
  state.rainSystem = new RainSystem(scene);
  state.snowSystem = new SnowSystem(scene);

  // Initialize background color
  (scene.background as any) = state.current.skyBottom.clone();

  applyCurrentToScene();
}

function applyCurrentToScene(): void {
  const c = state.current;
  if (state.fog) {
    state.fog.color.copy(c.fogColor);
    state.fog.density = c.fogDensity;
  }
  if (state.ambient) {
    state.ambient.color.copy(c.ambientColor);
    state.ambient.intensity = c.ambientIntensity;
  }
  if (state.sun) {
    state.sun.color.copy(c.sunColor);
    state.sun.intensity = c.sunIntensity;
    // Position sun based on angle (simplified: orbit in XZ from a fixed horizon)
    const dist = 100;
    state.sun.position.set(
      Math.cos(c.sunAngle) * dist * 0.6,
      Math.sin(c.sunAngle) * dist,
      Math.sin(c.sunAngle * 0.7) * dist * 0.4,
    );
  }
  if (state.scene?.background instanceof THREE.Color) {
    state.scene.background.copy(c.skyBottom);
  }
}

/**
 * Force a transition to the given preset.
 */
export function transitionTo(preset: WeatherPreset, durationSec: number = 35): void {
  if (preset === state.currentPreset && !state.transitioning) return;
  state.origin = cloneChannels(state.current);
  state.target = cloneChannels(PRESETS[preset]);
  state.targetPreset = preset;
  state.transitionT = 0;
  state.transitionDuration = durationSec;
  state.transitioning = true;
  state.transitionsThisMatch++;

  import('@/ui/Announcer').then(a => {
    a.announce(`WEATHER SHIFT`, {
      sub: preset.toUpperCase(),
      tier: 'small',
      color: '#8ab4f0',
      duration: 2,
    });
  }).catch(() => { /* */ });
}

/**
 * Try to trigger a random mid-match shift. Probabilistic.
 */
function attemptShift(): void {
  if (state.transitioning) return;
  if (state.transitionsThisMatch >= 2) return;

  const possibleTargets = TRANSITIONS[state.currentPreset] ?? [];
  if (possibleTargets.length === 0) return;

  // 30% chance at attempt time
  if (Math.random() > 0.3) {
    state.nextShiftAttempt = state.matchElapsed + 60;
    return;
  }

  const next = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
  const duration = 25 + Math.random() * 25;
  transitionTo(next, duration);
  state.nextShiftAttempt = state.matchElapsed + duration + 30 + Math.random() * 60;
}

export function updateDynamicWeather(dt: number, cameraPos?: THREE.Vector3): void {
  state.matchElapsed += dt;

  // Transition stepping
  if (state.transitioning) {
    state.transitionT += dt / state.transitionDuration;
    if (state.transitionT >= 1) {
      state.transitionT = 1;
      state.current = cloneChannels(state.target);
      state.currentPreset = state.targetPreset;
      state.transitioning = false;
    } else {
      lerpChannels(state.current, state.origin, state.target, state.transitionT);
    }
    applyCurrentToScene();
  }

  // Shift attempts
  if (state.matchElapsed >= state.nextShiftAttempt) {
    attemptShift();
  }

  // Precipitation
  const camPos = cameraPos ?? new THREE.Vector3();
  if (state.rainSystem) {
    state.rainSystem.update(dt, state.current.rainIntensity, state.current.windSpeed, camPos);
  }
  if (state.snowSystem) {
    state.snowSystem.update(dt, state.current.snowIntensity, state.current.windSpeed, camPos, state.matchElapsed);
  }

  // Lightning
  state.lightningCooldown -= dt;
  if (state.current.lightningChancePerSec > 0 && state.lightningCooldown <= 0) {
    if (Math.random() < state.current.lightningChancePerSec * dt * 2) {
      triggerLightning();
      state.lightningCooldown = 2 + Math.random() * 5;
    }
  }
}

export function readWeatherState(): Readonly<WeatherChannels> & { preset: WeatherPreset; transitioning: boolean } {
  return {
    ...state.current,
    preset: state.currentPreset,
    transitioning: state.transitioning,
  };
}

export function resetDynamicWeather(): void {
  state.matchElapsed = 0;
  state.nextShiftAttempt = 45;
  state.transitionsThisMatch = 0;
  state.transitioning = false;
  state.transitionT = 0;
}

export function disposeDynamicWeather(): void {
  state.rainSystem?.dispose();
  state.snowSystem?.dispose();
  state.rainSystem = null;
  state.snowSystem = null;
}