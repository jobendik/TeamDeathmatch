import type { BotClass } from '@/config/classes';
import { gameState } from '@/core/GameState';

/**
 * Per-bot personality — overlays on top of class config to create
 * individual variation. Two snipers can now play very differently.
 *
 * Biases are OFFSETS from class default in range roughly [-0.5, +0.5].
 * Skill/quirks are absolute values in [0, 1].
 */
export interface Personality {
  archetype: string;

  // ── Behavioral biases (offsets) ──
  aggressionBias: number;     // shifts fuzzy aggression output
  patienceBias: number;       // willingness to hold angles
  teamworkBias: number;       // sticks with squad vs lone wolf
  cautionBias: number;        // retreat threshold
  egoismBias: number;         // chases kills vs supports

  // ── Skill ──
  skill: number;              // 0.3 (newbie) .. 0.95 (pro)
  reactionModifier: number;   // -0.15 .. +0.3 added to reactionTime

  // ── Movement / engagement ──
  peekFrequency: number;      // 0..1 (likes to peek vs hold)
  repositionFrequency: number;// 0..1 (restless vs static)
  triggerDiscipline: number;  // 0 sprays .. 1 taps
  prefersFlank: number;       // 0..1
  prefersCover: number;       // 0..1

  // ── Aim character (fed to HumanAim) ──
  microJitter: number;        // radians/frame baseline tremor amplitude
  overshootTendency: number;  // 0..1 — how much a flick overshoots
  trackingResponsiveness: number; // 0..1 — aim spring stiffness
  settleSpeed: number;        // 0..1 — how quickly oscillation dampens
  leadErrorBias: number;      // systematic over/under-lead (-1..+1)

  // ── Emotional ──
  flinchFactor: number;       // 0..1 — damage disrupts aim
  panicSprayFactor: number;   // 0..1 — under fire, sprays more
  tiltFactor: number;         // 0..1 — temp skill loss after dying
  revengeBias: number;        // 0..1 — hunts their killer
  confidenceVolatility: number; // swing magnitude on confidence events

  // ── Bursting ──
  burstLengthVariance: number; // 0..1 — irregular burst lengths
  trigHappy: number;           // 0..1 — pulls trigger on uncertain sightings

  // ── Team comms ──
  calloutReliability: number;  // 0..1 — position noise when calling out
  calloutDelay: number;        // base delay in seconds before callout fires

  // ── Perception quirks ──
  attentionSpan: number;       // 0..1 — how long they stay focused on an area
  preAimBias: number;          // 0..1 — pre-aims corners on approach
  tunnelVision: number;        // 0..1 — locks onto current target
}

/**
 * Archetypes — core personality templates. Each bot picks one and
 * gets small randomization on top so no two are identical.
 */
const ARCHETYPES: Omit<Personality, 'skill' | 'reactionModifier'>[] = [
  {
    archetype: 'Rusher',
    aggressionBias: 0.35, patienceBias: -0.3, teamworkBias: -0.1, cautionBias: -0.35, egoismBias: 0.3,
    peekFrequency: 0.8, repositionFrequency: 0.85, triggerDiscipline: 0.3,
    prefersFlank: 0.7, prefersCover: 0.25,
    microJitter: 0.0055, overshootTendency: 0.6, trackingResponsiveness: 0.7, settleSpeed: 0.45, leadErrorBias: 0.1,
    flinchFactor: 0.35, panicSprayFactor: 0.7, tiltFactor: 0.55, revengeBias: 0.75, confidenceVolatility: 0.7,
    burstLengthVariance: 0.6, trigHappy: 0.75,
    calloutReliability: 0.55, calloutDelay: 0.55,
    attentionSpan: 0.4, preAimBias: 0.3, tunnelVision: 0.55,
  },
  {
    archetype: 'Anchor',
    aggressionBias: -0.25, patienceBias: 0.45, teamworkBias: 0.25, cautionBias: 0.3, egoismBias: -0.1,
    peekFrequency: 0.25, repositionFrequency: 0.2, triggerDiscipline: 0.8,
    prefersFlank: 0.1, prefersCover: 0.85,
    microJitter: 0.003, overshootTendency: 0.2, trackingResponsiveness: 0.55, settleSpeed: 0.8, leadErrorBias: -0.05,
    flinchFactor: 0.2, panicSprayFactor: 0.25, tiltFactor: 0.2, revengeBias: 0.25, confidenceVolatility: 0.3,
    burstLengthVariance: 0.2, trigHappy: 0.25,
    calloutReliability: 0.85, calloutDelay: 0.4,
    attentionSpan: 0.85, preAimBias: 0.85, tunnelVision: 0.4,
  },
  {
    archetype: 'Picker', // patient marksman
    aggressionBias: -0.1, patienceBias: 0.35, teamworkBias: 0.05, cautionBias: 0.2, egoismBias: 0.15,
    peekFrequency: 0.5, repositionFrequency: 0.35, triggerDiscipline: 0.9,
    prefersFlank: 0.2, prefersCover: 0.7,
    microJitter: 0.0022, overshootTendency: 0.15, trackingResponsiveness: 0.5, settleSpeed: 0.85, leadErrorBias: 0.0,
    flinchFactor: 0.3, panicSprayFactor: 0.1, tiltFactor: 0.25, revengeBias: 0.3, confidenceVolatility: 0.35,
    burstLengthVariance: 0.15, trigHappy: 0.2,
    calloutReliability: 0.8, calloutDelay: 0.5,
    attentionSpan: 0.75, preAimBias: 0.75, tunnelVision: 0.55,
  },
  {
    archetype: 'Support', // team-oriented trader
    aggressionBias: 0.05, patienceBias: 0.1, teamworkBias: 0.45, cautionBias: 0.15, egoismBias: -0.3,
    peekFrequency: 0.45, repositionFrequency: 0.5, triggerDiscipline: 0.65,
    prefersFlank: 0.25, prefersCover: 0.55,
    microJitter: 0.0035, overshootTendency: 0.3, trackingResponsiveness: 0.62, settleSpeed: 0.65, leadErrorBias: 0.05,
    flinchFactor: 0.3, panicSprayFactor: 0.4, tiltFactor: 0.3, revengeBias: 0.4, confidenceVolatility: 0.4,
    burstLengthVariance: 0.35, trigHappy: 0.45,
    calloutReliability: 0.9, calloutDelay: 0.35,
    attentionSpan: 0.65, preAimBias: 0.55, tunnelVision: 0.3,
  },
  {
    archetype: 'Lurker', // sneaky, patient, flanker
    aggressionBias: 0.1, patienceBias: 0.3, teamworkBias: -0.2, cautionBias: 0.25, egoismBias: 0.25,
    peekFrequency: 0.35, repositionFrequency: 0.6, triggerDiscipline: 0.7,
    prefersFlank: 0.85, prefersCover: 0.6,
    microJitter: 0.004, overshootTendency: 0.35, trackingResponsiveness: 0.6, settleSpeed: 0.7, leadErrorBias: 0.0,
    flinchFactor: 0.35, panicSprayFactor: 0.35, tiltFactor: 0.4, revengeBias: 0.35, confidenceVolatility: 0.45,
    burstLengthVariance: 0.4, trigHappy: 0.5,
    calloutReliability: 0.5, calloutDelay: 0.8,
    attentionSpan: 0.55, preAimBias: 0.4, tunnelVision: 0.5,
  },
  {
    archetype: 'Wildcard', // chaotic, unpredictable
    aggressionBias: 0.25, patienceBias: -0.2, teamworkBias: -0.05, cautionBias: -0.25, egoismBias: 0.35,
    peekFrequency: 0.7, repositionFrequency: 0.9, triggerDiscipline: 0.2,
    prefersFlank: 0.5, prefersCover: 0.3,
    microJitter: 0.008, overshootTendency: 0.75, trackingResponsiveness: 0.75, settleSpeed: 0.35, leadErrorBias: -0.1,
    flinchFactor: 0.5, panicSprayFactor: 0.85, tiltFactor: 0.6, revengeBias: 0.6, confidenceVolatility: 0.85,
    burstLengthVariance: 0.85, trigHappy: 0.85,
    calloutReliability: 0.35, calloutDelay: 0.7,
    attentionSpan: 0.25, preAimBias: 0.2, tunnelVision: 0.7,
  },
  {
    archetype: 'Veteran', // well-rounded, skilled, composed
    aggressionBias: 0.05, patienceBias: 0.15, teamworkBias: 0.2, cautionBias: 0.1, egoismBias: 0.0,
    peekFrequency: 0.5, repositionFrequency: 0.5, triggerDiscipline: 0.7,
    prefersFlank: 0.4, prefersCover: 0.6,
    microJitter: 0.002, overshootTendency: 0.2, trackingResponsiveness: 0.7, settleSpeed: 0.85, leadErrorBias: 0.0,
    flinchFactor: 0.15, panicSprayFactor: 0.2, tiltFactor: 0.15, revengeBias: 0.3, confidenceVolatility: 0.25,
    burstLengthVariance: 0.3, trigHappy: 0.3,
    calloutReliability: 0.9, calloutDelay: 0.35,
    attentionSpan: 0.8, preAimBias: 0.7, tunnelVision: 0.35,
  },
  {
    archetype: 'Rookie', // inexperienced, jumpy
    aggressionBias: 0.1, patienceBias: -0.1, teamworkBias: 0.1, cautionBias: -0.05, egoismBias: 0.1,
    peekFrequency: 0.6, repositionFrequency: 0.6, triggerDiscipline: 0.25,
    prefersFlank: 0.3, prefersCover: 0.45,
    microJitter: 0.009, overshootTendency: 0.8, trackingResponsiveness: 0.5, settleSpeed: 0.3, leadErrorBias: -0.2,
    flinchFactor: 0.65, panicSprayFactor: 0.9, tiltFactor: 0.7, revengeBias: 0.5, confidenceVolatility: 0.8,
    burstLengthVariance: 0.7, trigHappy: 0.8,
    calloutReliability: 0.4, calloutDelay: 0.75,
    attentionSpan: 0.35, preAimBias: 0.2, tunnelVision: 0.65,
  },
];

/** Weighted archetype preferences per class — still feels class-y. */
const CLASS_ARCHETYPE_WEIGHTS: Record<BotClass, Record<string, number>> = {
  rifleman: { Veteran: 2, Anchor: 2, Support: 2, Picker: 1.5, Rookie: 1, Wildcard: 0.8, Rusher: 1, Lurker: 1 },
  assault:  { Rusher: 3, Wildcard: 1.5, Veteran: 1.5, Support: 1, Rookie: 1.2, Anchor: 0.3, Picker: 0.3, Lurker: 0.5 },
  sniper:   { Picker: 3, Anchor: 2, Veteran: 1.5, Lurker: 1, Support: 0.8, Rookie: 0.6, Rusher: 0.1, Wildcard: 0.3 },
  flanker:  { Lurker: 2.5, Rusher: 2, Wildcard: 1.8, Veteran: 1, Support: 0.7, Rookie: 0.8, Picker: 0.4, Anchor: 0.2 },
};

function pickWeighted<T>(weights: Record<string, number>, options: T[], keyFn: (t: T) => string): T {
  let total = 0;
  for (const opt of options) total += weights[keyFn(opt)] ?? 1;
  let r = Math.random() * total;
  for (const opt of options) {
    r -= weights[keyFn(opt)] ?? 1;
    if (r <= 0) return opt;
  }
  return options[0];
}

function jitter(v: number, amount: number): number {
  return v + (Math.random() - 0.5) * 2 * amount;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Build a personality. Each bot gets an archetype + individual noise
 * so even two Rushers feel distinct.
 */
export function makePersonality(botClass: BotClass): Personality {
  const weights = CLASS_ARCHETYPE_WEIGHTS[botClass];
  const base = pickWeighted(weights, ARCHETYPES, (a) => a.archetype);

  // Skill distribution: roughly normal around 0.55, range 0.3–0.92
  // Mixed lobby feels right.
  const skillRoll = (Math.random() + Math.random() + Math.random()) / 3;
  let skill = 0.3 + skillRoll * 0.62;

  // Apply bot difficulty scaling from settings
  // difficulty 0 → skill*0.6, difficulty 0.5 → skill*1.0, difficulty 1 → skill*1.3
  const diff = gameState?.botDifficulty ?? 0.5;
  const diffMul = 0.6 + diff * 0.7;
  skill = clamp01(skill * diffMul);

  // Lower skill → slower reactions
  const reactionModifier = (1 - skill) * 0.25 + (Math.random() - 0.5) * 0.08;

  return {
    archetype: base.archetype,
    aggressionBias: jitter(base.aggressionBias, 0.06),
    patienceBias: jitter(base.patienceBias, 0.06),
    teamworkBias: jitter(base.teamworkBias, 0.06),
    cautionBias: jitter(base.cautionBias, 0.05),
    egoismBias: jitter(base.egoismBias, 0.06),

    skill,
    reactionModifier,

    peekFrequency: clamp01(jitter(base.peekFrequency, 0.1)),
    repositionFrequency: clamp01(jitter(base.repositionFrequency, 0.1)),
    triggerDiscipline: clamp01(jitter(base.triggerDiscipline, 0.08)),
    prefersFlank: clamp01(jitter(base.prefersFlank, 0.1)),
    prefersCover: clamp01(jitter(base.prefersCover, 0.1)),

    // Aim character — scaled by skill so pros have cleaner aim
    microJitter: base.microJitter * (1.4 - skill * 0.7),
    overshootTendency: clamp01(base.overshootTendency * (1.3 - skill * 0.6)),
    trackingResponsiveness: clamp01(base.trackingResponsiveness * (0.6 + skill * 0.5)),
    settleSpeed: clamp01(base.settleSpeed * (0.6 + skill * 0.5)),
    leadErrorBias: jitter(base.leadErrorBias, 0.08),

    flinchFactor: clamp01(jitter(base.flinchFactor, 0.1)),
    panicSprayFactor: clamp01(jitter(base.panicSprayFactor, 0.1)),
    tiltFactor: clamp01(jitter(base.tiltFactor, 0.1)),
    revengeBias: clamp01(jitter(base.revengeBias, 0.1)),
    confidenceVolatility: clamp01(jitter(base.confidenceVolatility, 0.08)),

    burstLengthVariance: clamp01(jitter(base.burstLengthVariance, 0.1)),
    trigHappy: clamp01(jitter(base.trigHappy, 0.1)),

    calloutReliability: clamp01(jitter(base.calloutReliability, 0.08) * (0.6 + skill * 0.4)),
    calloutDelay: Math.max(0.15, jitter(base.calloutDelay, 0.2)),

    attentionSpan: clamp01(jitter(base.attentionSpan, 0.1)),
    preAimBias: clamp01(jitter(base.preAimBias, 0.1)),
    tunnelVision: clamp01(jitter(base.tunnelVision, 0.1)),
  };
}
