/**
 * ContextualPerception — perception modifiers that make bots FEEL human.
 *
 * Real humans don't have uniform perception. Their awareness changes based on:
 *  - What they're doing (reloading = vulnerable, tunnel vision)
 *  - Their emotional state (scared = overreact, confident = over-commit)
 *  - Recent events (just got shot = hyper-vigilant in that direction)
 *  - Biological limits (can't see behind you, harder to hear through walls)
 *
 * This module layers on top of Perception.ts without replacing it.
 * Call `getContextualVisionMod(ag)` before doing canSee checks, and
 * `shouldBotHesitate(ag, target)` before committing to engagement.
 */

import * as YUKA from 'yuka';
import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import type { TDMAgent } from '@/entities/TDMAgent';
import { isOccluded } from './Perception';

export interface ContextualModifiers {
  /** Multiplier on vision range — drops during reload, rises under alert */
  rangeMul: number;
  /** Multiplier on FOV — narrows during tunnel-vision moments */
  fovMul: number;
  /** Extra reaction delay in seconds — simulates processing time */
  extraReaction: number;
  /** Probability the bot fails to register a sighting this frame (0..1) */
  missChance: number;
}

/**
 * Compute contextual perception modifiers for a given agent.
 * Call once per AI tick — the result is cheap to apply to canSee().
 */
export function getContextualVisionMod(ag: TDMAgent): ContextualModifiers {
  const mods: ContextualModifiers = {
    rangeMul: 1,
    fovMul: 1,
    extraReaction: 0,
    missChance: 0,
  };

  const p = ag.personality;
  if (!p) return mods;

  // ── Reloading: head-down, reduced awareness ──
  if (ag.isReloading) {
    mods.rangeMul *= 0.75;
    mods.fovMul *= 0.8;
    mods.missChance += 0.15;
    // Disciplined bots reload with awareness; panicky ones go heads-down
    mods.fovMul *= (0.85 + p.triggerDiscipline * 0.2);
  }

  // ── Tunnel vision during high-intensity combat ──
  // When tracking a target in a sustained engagement, peripheral awareness drops
  if (ag.currentTarget && ag.trackingTime > 1.5) {
    const tunnel = p.tunnelVision;
    const sustained = Math.min(1, (ag.trackingTime - 1.5) / 3);
    mods.fovMul *= 1 - sustained * tunnel * 0.35;
    // But their range INCREASES toward the target they're focused on
    mods.rangeMul *= 1 + sustained * 0.15;
    // They're blind-spotted for new threats
    mods.missChance += sustained * tunnel * 0.25;
  }

  // ── Pressure / panic reduces awareness ──
  if (ag.pressureLevel > 0.3) {
    const panic = p.panicSprayFactor;
    mods.fovMul *= 1 - ag.pressureLevel * panic * 0.25;
    mods.extraReaction += ag.pressureLevel * panic * 0.1;
    mods.missChance += ag.pressureLevel * panic * 0.15;
  }

  // ── High alert: hyper-vigilant, sees more ──
  if (ag.alertLevel > 60) {
    mods.rangeMul *= 1.12;
    mods.fovMul *= 1.08;
    mods.missChance *= 0.6;
  }

  // ── Low HP: darting eyes, less focused ──
  const hpRatio = ag.hp / ag.maxHP;
  if (hpRatio < 0.35) {
    mods.missChance += 0.08;
    // Skill partially compensates
    mods.missChance *= (1.3 - p.skill * 0.6);
  }

  // ── Tilt after dying / being humiliated ──
  if (ag.tiltLevel > 0.3) {
    mods.extraReaction += ag.tiltLevel * 0.15;
    mods.missChance += ag.tiltLevel * 0.1;
  }

  // ── Crouching bots see further (stable stance, careful) ──
  if (ag.isBotCrouching) {
    mods.rangeMul *= 1.1;
    mods.missChance *= 0.85;
  }

  return mods;
}

/**
 * Should the bot hesitate before engaging this target?
 * Real players pause when:
 *  - Target just appeared around a corner (processing time)
 *  - Target is unexpected (not where they thought)
 *  - Ammo is low (thinking about whether to push or reload)
 *  - HP is low AND target looks healthy
 *
 * Returns hesitation duration in seconds (0 = no hesitation).
 */
export function shouldBotHesitate(ag: TDMAgent, target: TDMAgent): number {
  const p = ag.personality;
  if (!p) return 0;

  let hesitation = 0;

  // Novel target → longer processing
  const hadMemory = ag.enemyMemory.has(target.name);
  if (!hadMemory) {
    hesitation += 0.08 + (1 - p.skill) * 0.15;
  }

  // Unexpected angle — target memory was far from actual position
  const mem = ag.enemyMemory.get(target.name);
  if (mem) {
    const expectedDist = target.position.distanceTo(mem.lastSeenPos);
    if (expectedDist > 12) {
      // Target is way off from last known — surprise!
      hesitation += 0.15 * (1 - p.skill);
    }
  }

  // Low ammo → hesitation to reload vs push
  if (ag.ammo / Math.max(1, ag.magSize) < 0.25) {
    hesitation += 0.1 * (1 - p.aggressionBias + 0.3);
  }

  // David vs Goliath: we're hurt, they're healthy
  const ourHP = ag.hp / ag.maxHP;
  const theirHP = target.hp / target.maxHP;
  if (ourHP < 0.4 && theirHP > 0.8) {
    hesitation += 0.12 * (1 - p.aggressionBias);
  }

  // Grudge removes hesitation — they want blood
  if (ag.grudge === target) {
    hesitation *= 0.3;
  }

  // Confidence removes hesitation
  hesitation *= (1.3 - ag.confidence / 100 * 0.5);

  return Math.max(0, hesitation);
}

/**
 * Hearing falloff through walls — real humans hear muffled sounds through cover.
 * Returns 0..1 hearing attenuation (1 = clear, 0 = inaudible).
 */
export function getHearingAttenuation(
  listenerPos: YUKA.Vector3,
  sourcePos: YUKA.Vector3,
): number {
  const _origin = new THREE.Vector3(listenerPos.x, 1.0, listenerPos.z);
  const _target = new THREE.Vector3(sourcePos.x, 1.0, sourcePos.z);
  const dir = _target.clone().sub(_origin);
  const dist = dir.length();
  if (dist < 0.01) return 1;
  dir.normalize();

  gameState.raycaster.set(_origin, dir);
  gameState.raycaster.far = dist;
  const hits = gameState.raycaster.intersectObjects(gameState.wallMeshes, false);
  gameState.raycaster.far = Infinity;

  // Each wall between listener and source drops audibility by 50%
  let att = 1;
  for (const hit of hits) {
    if (hit.distance < dist) att *= 0.5;
    if (att < 0.1) break;
  }
  return att;
}

/**
 * "Check your six" behavior — periodically, bots should look around even
 * without a target. Returns a world direction they should glance at,
 * or null if no glance should happen this frame.
 */
const _glanceTimers = new WeakMap<TDMAgent, { next: number; dir: YUKA.Vector3 }>();
export function getGlanceDirection(ag: TDMAgent): YUKA.Vector3 | null {
  const p = ag.personality;
  if (!p) return null;
  if (ag.currentTarget) return null; // engaged, don't glance

  let state = _glanceTimers.get(ag);
  const now = gameState.worldElapsed;

  if (!state) {
    state = {
      next: now + 3 + Math.random() * 4,
      dir: new YUKA.Vector3(),
    };
    _glanceTimers.set(ag, state);
  }

  if (now < state.next) return null;

  // Disciplined/skilled bots glance more often
  const interval = 2 + (1 - p.attentionSpan) * 6 + Math.random() * 2;
  state.next = now + interval;

  // Prefer glancing toward recent damage source or memory
  if (ag.lastAttacker && !ag.lastAttacker.isDead) {
    state.dir.copy(ag.lastAttacker.position).sub(ag.position).normalize();
    return state.dir;
  }

  // Or toward the densest enemy memory
  let bestDir: YUKA.Vector3 | null = null;
  let bestConf = 0;
  for (const [, mem] of ag.enemyMemory) {
    if (mem.confidence > bestConf) {
      bestConf = mem.confidence;
      bestDir = mem.lastSeenPos;
    }
  }
  if (bestDir) {
    state.dir.copy(bestDir).sub(ag.position).normalize();
    return state.dir;
  }

  // Otherwise random glance
  const angle = Math.random() * Math.PI * 2;
  state.dir.set(Math.cos(angle), 0, Math.sin(angle));
  return state.dir;
}

/**
 * Suppression — when bullets are whizzing past, bots should flinch, break aim,
 * and take cover. This is a core element of human realism.
 */
export function applySuppression(ag: TDMAgent, bulletPassDist: number): void {
  if (!ag.personality) return;
  if (bulletPassDist > 4) return; // only very close rounds suppress

  const p = ag.personality;
  // Intensity: closer = stronger
  const intensity = Math.max(0, 1 - bulletPassDist / 4);
  const effect = intensity * (1.2 - p.skill * 0.6);

  // Flinch the aim away
  if (ag.aim) {
    ag.aim.flinchYaw += (Math.random() - 0.5) * effect * 0.4;
    ag.aim.flinchPitch += (Math.random() - 0.3) * effect * 0.2;
  }

  // Increase pressure
  ag.pressureLevel = Math.min(1, ag.pressureLevel + effect * 0.35);

  // Disciplined bots don't flinch as hard
  if (p.triggerDiscipline > 0.7) {
    ag.pressureLevel *= 0.7;
  }

  // Alert rise
  ag.alertLevel = Math.min(100, ag.alertLevel + effect * 20);
}