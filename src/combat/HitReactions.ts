/**
 * HitReactions — procedural visible stagger when a bot takes damage.
 *
 * Bots have applyAimFlinch which disrupts their internal aim, but their
 * body doesn't react visually. This adds a per-agent transform offset
 * applied to the render component. When hit, a short-lived offset + rotation
 * wobble decays quickly and piggybacks on existing syncRC pattern.
 */

import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import type { TDMAgent } from '@/entities/TDMAgent';

interface ReactionState {
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  rollZ: number;
  pitchX: number;
  life: number;
  maxLife: number;
}

const reactions = new WeakMap<TDMAgent, ReactionState>();

const DEFAULT_DURATION = 0.22;
const HEADSHOT_DURATION = 0.35;
const MAX_OFFSET = 0.14;
const MAX_ROLL = 0.22;
const MAX_PITCH = 0.28;

/**
 * Called from Combat.dealDmgAgent() when a bot takes damage.
 */
export function applyHitReaction(
  ag: TDMAgent,
  damage: number,
  attackerPos: { x: number; z: number } | null,
  isHeadshot: boolean,
): void {
  if (ag.isDead) return;
  if (!ag.renderComponent) return;

  const dmgFrac = Math.min(1, damage / Math.max(1, ag.maxHP));

  let impX = 0;
  let impZ = 0;
  if (attackerPos) {
    const dx = ag.position.x - attackerPos.x;
    const dz = ag.position.z - attackerPos.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.01) {
      impX = dx / len;
      impZ = dz / len;
    }
  }

  const intensity = 0.4 + dmgFrac * 0.9;
  const offsetMag = MAX_OFFSET * intensity;
  const rollMag = MAX_ROLL * intensity * 0.7;

  let r = reactions.get(ag);
  if (!r) {
    r = {
      offsetX: 0, offsetY: 0, offsetZ: 0,
      rollZ: 0, pitchX: 0,
      life: 0, maxLife: DEFAULT_DURATION,
    };
    reactions.set(ag, r);
  }

  r.offsetX += impX * offsetMag;
  r.offsetZ += impZ * offsetMag;

  const rollSign = impX * impZ > 0 ? 1 : -1;
  r.rollZ += rollSign * rollMag * (0.7 + Math.random() * 0.6);

  if (isHeadshot) {
    r.pitchX -= MAX_PITCH * intensity * 0.9;
    r.offsetY = Math.max(r.offsetY, 0.06);
    r.maxLife = HEADSHOT_DURATION;
    r.life = Math.max(r.life, HEADSHOT_DURATION);
  } else {
    r.maxLife = Math.max(r.maxLife, DEFAULT_DURATION);
    r.life = Math.max(r.life, DEFAULT_DURATION);
  }

  r.offsetX = THREE.MathUtils.clamp(r.offsetX, -MAX_OFFSET * 1.8, MAX_OFFSET * 1.8);
  r.offsetZ = THREE.MathUtils.clamp(r.offsetZ, -MAX_OFFSET * 1.8, MAX_OFFSET * 1.8);
  r.rollZ = THREE.MathUtils.clamp(r.rollZ, -MAX_ROLL * 1.5, MAX_ROLL * 1.5);
  r.pitchX = THREE.MathUtils.clamp(r.pitchX, -MAX_PITCH * 1.2, MAX_PITCH * 1.2);
}

const _baseQ = new THREE.Quaternion();
const _reactionQ = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Called each frame AFTER YUKA's entity update has synced positions.
 */
export function updateHitReactions(dt: number): void {
  for (const ag of gameState.agents) {
    if (ag === gameState.player) continue;
    const r = reactions.get(ag);
    if (!r) continue;

    if (r.life <= 0) {
      reactions.delete(ag);
      continue;
    }

    if (ag.isDead || !ag.renderComponent) {
      reactions.delete(ag);
      continue;
    }

    r.life -= dt;
    const t = Math.max(0, r.life / r.maxLife);
    const easing = t * t * t;

    const rc = ag.renderComponent;
    rc.position.x += r.offsetX * easing;
    rc.position.y += r.offsetY * easing;
    rc.position.z += r.offsetZ * easing;

    _baseQ.copy(rc.quaternion);
    _euler.set(r.pitchX * easing, 0, r.rollZ * easing, 'YXZ');
    _reactionQ.setFromEuler(_euler);
    rc.quaternion.multiplyQuaternions(_baseQ, _reactionQ);
  }
}
