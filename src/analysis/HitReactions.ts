/**
 * HitReactions — procedural visible stagger when a bot takes damage.
 *
 * The problem: bots have `applyAimFlinch` which disrupts their INTERNAL aim,
 * but the bot's BODY doesn't react visually. This makes combat feel sterile —
 * in a AAA game, when you shoot an enemy, their body jerks. They stumble.
 * You see the impact. Here, they just keep walking until they die.
 *
 * Solution: a per-agent transform offset applied to the render component.
 * When hit, we add a short-lived offset + rotation wobble that decays quickly.
 * This piggybacks on existing syncRC pattern without requiring new animations.
 *
 * Design notes:
 *  - Keep offsets SMALL. Overreaction looks goofy.
 *  - Scale by damage fraction so light hits barely shake and heavy hits
 *    visibly rock the target.
 *  - Direction matters: the hit impulse should push the bot away from the
 *    attacker along the horizontal plane.
 *  - Decay is fast (0.2-0.3s) so the bot can keep moving without looking
 *    stuck.
 *  - Headshots get a vertical component (head snaps back) on top.
 */

import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import type { TDMAgent } from '@/entities/TDMAgent';

interface ReactionState {
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  rollZ: number;       // body roll (lean from impact)
  pitchX: number;      // body pitch (headshot head-snap)
  life: number;        // remaining duration
  maxLife: number;
}

const reactions = new WeakMap<TDMAgent, ReactionState>();

const DEFAULT_DURATION = 0.22;
const HEADSHOT_DURATION = 0.35;
const MAX_OFFSET = 0.14;   // meters of body displacement
const MAX_ROLL = 0.22;     // radians
const MAX_PITCH = 0.28;    // radians (for headshots — head snap back)

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

  // Impulse direction: from attacker toward bot
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

  const intensity = 0.4 + dmgFrac * 0.9; // baseline + damage-scaled
  const offsetMag = MAX_OFFSET * intensity;
  const rollMag = MAX_ROLL * intensity * 0.7;

  // Get or create reaction state. We ADD to existing if already staggering
  // (so rapid hits compound, feeling like getting melted).
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

  // Roll: bot tilts away from the impact direction (right-handed coordinate intuition)
  const rollSign = impX * impZ > 0 ? 1 : -1;
  r.rollZ += rollSign * rollMag * (0.7 + Math.random() * 0.6);

  if (isHeadshot) {
    r.pitchX -= MAX_PITCH * intensity * 0.9; // head snaps back/up
    r.offsetY = Math.max(r.offsetY, 0.06);
    r.maxLife = HEADSHOT_DURATION;
    r.life = Math.max(r.life, HEADSHOT_DURATION);
  } else {
    r.maxLife = Math.max(r.maxLife, DEFAULT_DURATION);
    r.life = Math.max(r.life, DEFAULT_DURATION);
  }

  // Clamp so compound hits don't explode
  r.offsetX = THREE.MathUtils.clamp(r.offsetX, -MAX_OFFSET * 1.8, MAX_OFFSET * 1.8);
  r.offsetZ = THREE.MathUtils.clamp(r.offsetZ, -MAX_OFFSET * 1.8, MAX_OFFSET * 1.8);
  r.rollZ = THREE.MathUtils.clamp(r.rollZ, -MAX_ROLL * 1.5, MAX_ROLL * 1.5);
  r.pitchX = THREE.MathUtils.clamp(r.pitchX, -MAX_PITCH * 1.2, MAX_PITCH * 1.2);
}

// Temp quaternion for composing body rotation with reaction wobble
const _baseQ = new THREE.Quaternion();
const _reactionQ = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Called each frame AFTER YUKA's entity update has synced positions.
 * Applies reaction offsets on top. Call from GameLoop.
 */
export function updateHitReactions(dt: number): void {
  for (const ag of gameState.agents) {
    if (ag === gameState.player) continue;
    const r = reactions.get(ag);
    if (!r) continue;

    if (r.life <= 0) {
      // Reset the visual offset cleanly
      if (ag.renderComponent) {
        // Don't snap; syncRC will overwrite position/quaternion next frame anyway.
      }
      reactions.delete(ag);
      continue;
    }

    if (ag.isDead || !ag.renderComponent) {
      reactions.delete(ag);
      continue;
    }

    // Decay
    r.life -= dt;
    const t = Math.max(0, r.life / r.maxLife);
    // Ease-out cubic: fast at start, slow at end
    const easing = t * t * t;

    // Apply offsets to render component on top of YUKA's sync
    const rc = ag.renderComponent;
    rc.position.x += r.offsetX * easing;
    rc.position.y += r.offsetY * easing;
    rc.position.z += r.offsetZ * easing;

    // Compose reaction rotation with body rotation
    _baseQ.copy(rc.quaternion);
    _euler.set(r.pitchX * easing, 0, r.rollZ * easing, 'YXZ');
    _reactionQ.setFromEuler(_euler);
    rc.quaternion.multiplyQuaternions(_baseQ, _reactionQ);
  }
}

export function clearHitReactions(): void {
  // WeakMap can't be iterated; next frame updateHitReactions handles any
  // stale entries via isDead checks. Explicit clear not needed.
}