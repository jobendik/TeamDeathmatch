import { gameState } from '@/core/GameState';
import { dom } from './DOMElements';

const DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
type DirKey = typeof DIRS[number];

interface ArcState {
  el: HTMLElement;
  timer: number;
}

const arcStates = new Map<DirKey, ArcState>();

function ensureArcs(): void {
  if (arcStates.size > 0) return;
  const root = dom.dmgArcs;
  if (!root) return;
  for (const dir of DIRS) {
    const el = root.querySelector(`[data-dir="${dir}"]`) as HTMLElement;
    if (el) arcStates.set(dir, { el, timer: 0 });
  }
}

export function showDamageArc(sourceX: number, sourceZ: number): void {
  ensureArcs();
  const { player, cameraYaw } = gameState;
  const dx = sourceX - player.position.x;
  const dz = sourceZ - player.position.z;

  // Angle from player to source, world-space (atan2 yields -PI..PI)
  const worldAngle = Math.atan2(-dx, -dz);
  // Relative to camera yaw
  let rel = worldAngle - cameraYaw;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;

  // Map to 8-point compass
  let deg = (rel * 180) / Math.PI;
  if (deg < 0) deg += 360;
  const sector = Math.round(deg / 45) % 8;
  const dir = DIRS[sector];

  const state = arcStates.get(dir);
  if (!state) return;
  state.el.classList.add('on');
  state.timer = 0.7; // seconds visible
}

export function updateDamageArcs(dt: number): void {
  for (const state of arcStates.values()) {
    if (state.timer > 0) {
      state.timer -= dt;
      if (state.timer <= 0) state.el.classList.remove('on');
    }
  }
}
