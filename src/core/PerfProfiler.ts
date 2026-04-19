/**
 * PerfProfiler — lightweight per-system frame timing.
 *
 * Usage:
 *   import { perf } from '@/core/PerfProfiler';
 *   perf.begin('updateAI');
 *   ...work...
 *   perf.end('updateAI');
 *
 * Toggle via window.__td.perf.enable() / .disable()
 * Dump a 60-frame summary with window.__td.perf.dump()
 */

interface Sample {
  total: number;        // accumulated ms
  calls: number;
  maxCall: number;      // single-call max ms
  startedAt: number;    // performance.now() marker
}

const samples = new Map<string, Sample>();
let enabled = false;
let frameTimer = 0;
let framesCollected = 0;

function getSample(name: string): Sample {
  let s = samples.get(name);
  if (!s) {
    s = { total: 0, calls: 0, maxCall: 0, startedAt: 0 };
    samples.set(name, s);
  }
  return s;
}

export const perf = {
  enable(): void {
    enabled = true;
    samples.clear();
    framesCollected = 0;
    frameTimer = performance.now();
    console.info('[perf] profiler ON — call __td.perf.dump() to see results');
  },

  disable(): void {
    enabled = false;
    console.info('[perf] profiler OFF');
  },

  isEnabled(): boolean { return enabled; },

  begin(name: string): void {
    if (!enabled) return;
    getSample(name).startedAt = performance.now();
  },

  end(name: string): void {
    if (!enabled) return;
    const s = getSample(name);
    if (s.startedAt === 0) return;
    const dt = performance.now() - s.startedAt;
    s.total += dt;
    s.calls++;
    if (dt > s.maxCall) s.maxCall = dt;
    s.startedAt = 0;
  },

  /** Call once per frame; tracks frame count for averages. */
  markFrame(): void {
    if (!enabled) return;
    framesCollected++;
  },

  /** Print a table of accumulated samples. */
  dump(): void {
    const wall = performance.now() - frameTimer;
    const frames = Math.max(1, framesCollected);
    const fps = (frames / (wall / 1000)).toFixed(1);
    const rows: { name: string; avgMs: number; maxMs: number; callsPerFrame: number; shareOfFrame: string }[] = [];
    const perFrameMs = wall / frames;

    samples.forEach((s, name) => {
      const avgMs = s.total / frames;
      rows.push({
        name,
        avgMs: +avgMs.toFixed(3),
        maxMs: +s.maxCall.toFixed(3),
        callsPerFrame: +(s.calls / frames).toFixed(2),
        shareOfFrame: `${((avgMs / perFrameMs) * 100).toFixed(1)}%`,
      });
    });
    rows.sort((a, b) => b.avgMs - a.avgMs);

    console.group(`[perf] ${frames} frames in ${wall.toFixed(0)}ms — ${fps} FPS, ${perFrameMs.toFixed(2)}ms/frame`);
    console.table(rows);
    console.groupEnd();

    // Reset accumulators for the next dump window.
    samples.forEach((s) => { s.total = 0; s.calls = 0; s.maxCall = 0; s.startedAt = 0; });
    framesCollected = 0;
    frameTimer = performance.now();
  },
};
