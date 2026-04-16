import * as THREE from 'three';
import { gameState } from '@/core/GameState';

/**
 * Shrinking play zone for Battle Royale.
 * Storm damages players outside the circle; circle shrinks every phase.
 */

export interface ZonePhase {
  waitTime: number;   // seconds before shrink starts
  shrinkTime: number; // seconds to complete shrink
  finalRadius: number;
  damagePerSec: number;
}

const PHASES: ZonePhase[] = [
  { waitTime: 120, shrinkTime: 60, finalRadius: 180, damagePerSec: 1 },
  { waitTime: 90,  shrinkTime: 45, finalRadius: 100, damagePerSec: 3 },
  { waitTime: 60,  shrinkTime: 30, finalRadius: 50,  damagePerSec: 6 },
  { waitTime: 45,  shrinkTime: 20, finalRadius: 20,  damagePerSec: 12 },
  { waitTime: 30,  shrinkTime: 15, finalRadius: 5,   damagePerSec: 25 },
];

export interface ZoneState {
  active: boolean;
  phaseIndex: number;
  phaseStartTime: number;
  currentCenter: THREE.Vector2;
  currentRadius: number;
  targetCenter: THREE.Vector2;
  targetRadius: number;
  mesh: THREE.Mesh | null;
}

export const zone: ZoneState = {
  active: false,
  phaseIndex: 0,
  phaseStartTime: 0,
  currentCenter: new THREE.Vector2(0, 0),
  currentRadius: 250,
  targetCenter: new THREE.Vector2(0, 0),
  targetRadius: 250,
  mesh: null,
};

export function startZone(): void {
  zone.active = true;
  zone.phaseIndex = 0;
  zone.phaseStartTime = gameState.worldElapsed;
  zone.currentRadius = 250;
  zone.targetRadius = 250;
  zone.currentCenter.set(0, 0);
  zone.targetCenter.set(0, 0);
  // TODO: create mesh (large ring/cylinder with storm shader)
}

export function updateZone(dt: number): void {
  if (!zone.active) return;
  // TODO: step through phases, lerp radius, apply damage to players outside
}

export function isOutsideZone(x: number, z: number): boolean {
  const dx = x - zone.currentCenter.x;
  const dz = z - zone.currentCenter.y;
  return dx * dx + dz * dz > zone.currentRadius * zone.currentRadius;
}
