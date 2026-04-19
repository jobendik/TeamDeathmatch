/**
 * ScreenFX — lightweight CSS-overlay replacement for PostProcess effects.
 *
 * Same gameplay-facing API as PostFX (`triggerHit`, `triggerKill`, `setLowHp`,
 * `update`) but driven by composited DOM layers instead of GPU shaders.
 * This costs essentially zero frame time vs ~20–70 ms for the full
 * EffectComposer path and keeps the game responsive on integrated GPUs.
 *
 * Layers (stacked over the canvas, z-indexed just below the HUD):
 *   • vignette  — permanent radial darkening at the edges.
 *   • hit       — red inner-edge flash when hit.
 *   • lowhp     — pulsing red edge + slight desaturation when HP is low.
 *   • kill      — brief bright white flash on a kill.
 *
 * All transitions driven by rAF-free direct opacity writes from update(dt).
 */

export interface ScreenFX {
  triggerHit: (intensity?: number) => void;
  triggerKill: () => void;
  setLowHp: (t: number) => void;
  update: (dt: number) => void;
  /** No-op for ScreenFX (kept to satisfy the PostFX shape). */
  resize?: () => void;
  /** Hide/show the entire screen-fx stack at runtime. */
  setEnabled: (on: boolean) => void;
  /** Present for PostFX; absent here — GameLoop uses this to decide render path. */
  composer?: undefined;
}

// Competitive-FPS default: a very subtle vignette. The old value (0.45
// opacity over a 45%-75% gradient) was heavy enough that players
// mistook it for a sniper scope overlay at match start. Modern shooters
// keep this almost imperceptible.
let _vignetteOpacity = 0.18;

export function initScreenFX(): ScreenFX {
  const root = document.createElement('div');
  root.id = 'screenFX';
  root.style.cssText = [
    'position:fixed',
    'inset:0',
    'pointer-events:none',
    'z-index:5',              // above canvas, below HUD (HUD uses 10+)
    'overflow:hidden',
    'contain:strict',
  ].join(';');

  // ── Vignette — always on, GPU-composited radial gradient. ──
  // Very soft: transparent across 70% of the frame, gentle edge darken.
  const vignette = document.createElement('div');
  vignette.style.cssText = [
    'position:absolute',
    'inset:0',
    'background:radial-gradient(ellipse at center, transparent 70%, rgba(0,0,0,0.55) 100%)',
    `opacity:${_vignetteOpacity}`,
    'will-change:opacity',
  ].join(';');
  root.appendChild(vignette);

  // ── Hit-flash layer — red edge vignette that fades out. ──
  const hit = document.createElement('div');
  hit.style.cssText = [
    'position:absolute',
    'inset:0',
    'background:radial-gradient(ellipse at center, transparent 20%, rgba(220,20,20,0.85) 100%)',
    'opacity:0',
    'will-change:opacity',
    'mix-blend-mode:screen',
  ].join(';');
  root.appendChild(hit);

  // ── Low-HP layer — stronger pulsing red edge + desaturation. ──
  const lowhp = document.createElement('div');
  lowhp.style.cssText = [
    'position:absolute',
    'inset:0',
    'background:radial-gradient(ellipse at center, transparent 25%, rgba(180,0,0,0.9) 100%)',
    'opacity:0',
    'will-change:opacity,filter',
    'mix-blend-mode:screen',
  ].join(';');
  root.appendChild(lowhp);

  // ── Kill-flash layer — brief bright white punch. ──
  const kill = document.createElement('div');
  kill.style.cssText = [
    'position:absolute',
    'inset:0',
    'background:rgba(255,255,245,0.35)',
    'opacity:0',
    'will-change:opacity',
    'mix-blend-mode:screen',
  ].join(';');
  root.appendChild(kill);

  // Apply a *real* desaturation on the canvas when low HP — cheap, uses
  // the compositor's backdrop filter, no extra draw calls.
  const canvasEl = document.querySelector('canvas') as HTMLCanvasElement | null;
  const applyCanvasFilter = (lowHpT: number) => {
    if (!canvasEl) return;
    if (lowHpT < 0.02) { canvasEl.style.filter = ''; return; }
    const sat = 1 - 0.45 * lowHpT;
    const contrast = 1 + 0.05 * lowHpT;
    canvasEl.style.filter = `saturate(${sat.toFixed(3)}) contrast(${contrast.toFixed(3)})`;
  };

  document.body.appendChild(root);

  // ── State ──
  let hitPulse = 0;         // 0..1
  let killPulse = 0;        // 0..1
  let lowHp = 0;            // 0..1 — set externally, not decayed by update
  let time = 0;
  let enabled = true;

  return {
    triggerHit(intensity = 0.55) {
      hitPulse = Math.max(hitPulse, Math.min(1, intensity));
    },
    triggerKill() {
      killPulse = Math.max(killPulse, 0.8);
    },
    setLowHp(t: number) {
      lowHp = Math.max(0, Math.min(1, t));
    },
    update(dt: number) {
      if (!enabled) return;
      time += dt;

      hitPulse = Math.max(0, hitPulse - dt * 2.5);
      killPulse = Math.max(0, killPulse - dt * 4);

      hit.style.opacity = hitPulse > 0.001 ? hitPulse.toFixed(3) : '0';
      kill.style.opacity = killPulse > 0.001 ? killPulse.toFixed(3) : '0';

      if (lowHp > 0.01) {
        // Pulse at ~1.6 Hz, stronger as HP gets critical.
        const pulse = 0.6 + 0.4 * Math.sin(time * 10);
        lowhp.style.opacity = (lowHp * pulse * 0.85).toFixed(3);
      } else {
        lowhp.style.opacity = '0';
      }

      applyCanvasFilter(lowHp);
    },
    setEnabled(on: boolean) {
      enabled = on;
      root.style.display = on ? '' : 'none';
      if (!on && canvasEl) canvasEl.style.filter = '';
    },
  };
}

/** Adjust permanent vignette strength (0 = off, ~0.4 = FPS default, 1 = heavy). */
export function setVignetteStrength(v: number): void {
  _vignetteOpacity = Math.max(0, Math.min(1, v));
  const root = document.getElementById('screenFX');
  const vig = root?.firstElementChild as HTMLElement | undefined;
  if (vig) vig.style.opacity = String(_vignetteOpacity);
}
