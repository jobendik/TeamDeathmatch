/**
 * BRBrain — Battle-Royale-specific intelligence layer.
 *
 * Bolted on top of the base AI. Gives bots the concepts a real BR player
 * thinks about but a generic FPS bot doesn't:
 *
 *  - THREAT ASSESSMENT: how dangerous is this enemy to me RIGHT NOW?
 *  - OPPORTUNITY: is this enemy a cleanup kill? Are they mid-fight?
 *  - FIGHT DETECTION: are two other bots shooting each other? Go third-party.
 *  - GEAR MATCH: do I have the right weapon for this engagement range?
 *  - COMMITMENT: should I push, trade, or disengage based on win odds?
 *  - CONSUMABLE USE: heal/shield when safe, not when bleeding mid-gunfight.
 *  - ENDGAME POSITIONING: hold angles, seek elevation, don't run in circles.
 *
 * The brain exposes small helper fns; BRBots consults them to pick phases
 * and to modulate combat behaviour via the base AI.
 */

import * as YUKA from 'yuka';
import { gameState } from '@/core/GameState';
import type { TDMAgent } from '@/entities/TDMAgent';
import { WEAPONS, type WeaponId } from '@/config/weapons';
import { canSee, isOccluded } from '@/ai/Perception';
import { zone, isOutsideZone, distanceToZoneEdge } from './ZoneSystem';
import { getBRMapData, buildingGrid } from './BRMap';
import { botGrid, type BRBotState } from './BRBots';

// ─────────────────────────────────────────────────────────────────────
//  THREAT / OPPORTUNITY
// ─────────────────────────────────────────────────────────────────────

/**
 * Win-probability estimate [0..1] for `me` vs `enemy` in a straight fight,
 * right now, given current HP, weapons, distance, and personality.
 */
export function winProbability(me: TDMAgent, enemy: TDMAgent): number {
  const myWep = WEAPONS[me.weaponId];
  const enWep = WEAPONS[enemy.weaponId];
  const dist = me.position.distanceTo(enemy.position);

  // HP ratio — scaled, not linear (wounded enemy is BIG advantage)
  const myHpR = me.hp / me.maxHP;
  const enHpR = enemy.hp / enemy.maxHP;
  let p = 0.5 + (myHpR - enHpR) * 0.6;

  // Weapon advantage at this range
  const myRangeFit = weaponRangeFitness(me.weaponId, dist);
  const enRangeFit = weaponRangeFitness(enemy.weaponId, dist);
  p += (myRangeFit - enRangeFit) * 0.2;

  // Raw DPS ratio (ignoring reload — a tiebreaker)
  const myDPS = myWep.damage / Math.max(0.1, myWep.fireRate);
  const enDPS = enWep.damage / Math.max(0.1, enWep.fireRate);
  p += (myDPS - enDPS) / Math.max(myDPS + enDPS, 1) * 0.08;

  // Ammo check — empty gun is a death sentence
  if (me.ammo <= 0 && !me.isReloading) p -= 0.25;
  if (enemy.ammo <= 0 && !enemy.isReloading) p += 0.15;

  // Personality — confident bots estimate themselves higher
  if (me.personality) {
    p += me.personality.aggressionBias * 0.05;
    p += (me.confidence - 50) / 500;
  }

  return Math.max(0.02, Math.min(0.98, p));
}

function weaponRangeFitness(id: WeaponId, dist: number): number {
  // 0 = terrible at this range, 1 = ideal
  switch (id) {
    case 'knife':         return dist < 3 ? 1 : 0;
    case 'pistol':        return dist < 20 ? 0.6 : dist < 35 ? 0.3 : 0.1;
    case 'smg':           return dist < 18 ? 0.95 : dist < 30 ? 0.6 : 0.2;
    case 'shotgun':       return dist < 10 ? 1.0 : dist < 15 ? 0.5 : 0.05;
    case 'assault_rifle': return dist < 10 ? 0.7 : dist < 50 ? 1.0 : 0.5;
    case 'sniper_rifle':  return dist < 12 ? 0.2 : dist < 30 ? 0.6 : 1.0;
    case 'rocket_launcher': return dist < 5 ? 0.1 : dist < 40 ? 0.9 : 0.4;
    default:              return 0.1;
  }
}

// ─────────────────────────────────────────────────────────────────────
//  FIGHT DETECTION  (third-partying)
// ─────────────────────────────────────────────────────────────────────

export interface FightInfo {
  /** Weighted centroid of the fight */
  pos: YUKA.Vector3;
  /** All participants (for avoidance/targeting) */
  participants: TDMAgent[];
  /** How recent — 0 = happening now, 1 = 3s stale */
  staleness: number;
  /** Summed HP loss in last window — bigger fight = higher urgency */
  intensity: number;
}

const fightCentroid = new YUKA.Vector3();

/**
 * Find the nearest ongoing fight (≥2 bots shooting each other) within
 * `radius` of `me`. `me` is excluded from participants.
 *
 * "Fighting" = agent took damage in the last 2s from someone who is
 * still alive and within 40m of them.
 */
export function findNearbyFight(me: TDMAgent, radius: number): FightInfo | null {
  const now = gameState.worldElapsed;
  const candidates = botGrid.queryRadius(me.position.x, me.position.z, radius);

  // Bucket currently-fighting pairs
  const fighters: TDMAgent[] = [];
  for (const c of candidates) {
    const a = c.obj;
    if (a === me || a.isDead) continue;
    const tSince = now - a.lastDamageTime;
    if (tSince > 2.2) continue;
    const att = a.lastAttacker;
    if (!att || att.isDead || att === me) continue;
    // Both still close enough to keep fighting
    if (a.position.distanceTo(att.position) > 40) continue;
    fighters.push(a);
  }
  if (fighters.length < 2) return null;

  // Cluster the centroid
  fightCentroid.set(0, 0, 0);
  let wSum = 0;
  for (const f of fighters) {
    const w = 1 + f.recentDamage * 0.05;
    fightCentroid.x += f.position.x * w;
    fightCentroid.z += f.position.z * w;
    wSum += w;
  }
  fightCentroid.x /= wSum;
  fightCentroid.z /= wSum;

  // Staleness = average time since last damage / 3s
  let totalStale = 0;
  let intensity = 0;
  for (const f of fighters) {
    totalStale += Math.min(1, (now - f.lastDamageTime) / 3);
    intensity += f.recentDamage;
  }
  const staleness = totalStale / fighters.length;

  return {
    pos: fightCentroid.clone(),
    participants: fighters,
    staleness,
    intensity,
  };
}

// ─────────────────────────────────────────────────────────────────────
//  POSITIONAL AWARENESS
// ─────────────────────────────────────────────────────────────────────

/**
 * Find a tactical hold position for endgame: near zone centre but with
 * cover nearby and ideally slightly elevated (near a building).
 *
 * Preference order:
 *  1. Building doorways inside the final circle
 *  2. Cover points inside the final circle
 *  3. Random position at ~30% radius from centre
 */
export function findEndgameHold(me: TDMAgent): YUKA.Vector3 | null {
  if (!zone.active) return null;

  const cx = zone.currentCenter.x;
  const cz = zone.currentCenter.y;
  const r  = zone.currentRadius;
  const targetR = Math.min(r * 0.55, 18);

  // Score candidates: cover points + building doors
  let best: YUKA.Vector3 | null = null;
  let bestScore = -Infinity;

  const cands: YUKA.Vector3[] = [];
  // Cover points inside zone
  for (const cp of gameState.coverPoints) {
    const dx = cp.x - cx;
    const dz = cp.z - cz;
    if (dx * dx + dz * dz > r * r) continue;
    cands.push(cp);
  }
  // Building doors near centre
  const nearBuildings = buildingGrid.queryRadius(cx, cz, r);
  for (const eb of nearBuildings) {
    for (const d of eb.obj.doorPositions) {
      cands.push(new YUKA.Vector3(d.x, 0, d.z));
    }
  }
  if (cands.length === 0) {
    // Fallback: random point near centre
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * targetR;
    return new YUKA.Vector3(cx + Math.cos(a) * rr, 0, cz + Math.sin(a) * rr);
  }

  for (const cand of cands) {
    const distToCenter = Math.hypot(cand.x - cx, cand.z - cz);
    const distToMe     = me.position.distanceTo(cand);
    // Score: close to centre, close to me, away from visible enemies
    let s = -Math.abs(distToCenter - targetR) * 0.8 - distToMe * 0.2;

    // Penalty for positions visible to known enemies
    for (const [, mem] of me.enemyMemory) {
      if (mem.confidence < 0.35) continue;
      if (!isOccluded(cand, mem.lastSeenPos)) s -= 12;
    }

    // Bonus if already occupied by a teammate (holding together)
    if (gameState.mode === 'br') {
      const nearby = botGrid.queryRadius(cand.x, cand.z, 6);
      for (const other of nearby) {
        if (other.obj === me) continue;
        if (other.obj.team === me.team && !other.obj.isDead) s += 4;
      }
    }

    if (s > bestScore) { bestScore = s; best = cand; }
  }
  return best;
}

/**
 * Is the bot currently in a good spot for its role? Used to decide
 * whether to sit tight vs. reposition.
 */
export function isPositionAdvantaged(me: TDMAgent): boolean {
  if (!me.currentTarget) return false;
  // Good = enemy can be seen and we're closer to cover than they are
  if (!canSee(me, me.currentTarget)) return false;
  const myCoverDist = nearestCoverDist(me.position);
  const enCoverDist = nearestCoverDist(me.currentTarget.position);
  return myCoverDist + 2 < enCoverDist;
}

function nearestCoverDist(pos: YUKA.Vector3): number {
  let best = 999;
  for (const cp of gameState.coverPoints) {
    const d = pos.distanceTo(cp);
    if (d < best) best = d;
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────
//  CONSUMABLE USE
// ─────────────────────────────────────────────────────────────────────

/**
 * A bot chooses to "heal up" when:
 *  - HP < 75% AND
 *  - No visible enemy within 30m AND
 *  - Not outside the zone AND
 *  - Hasn't taken damage in last 3s
 *
 * Healing gives +35 HP instantly; represents chugging a bandage/shield.
 * Cooldown prevents spam (8-14s).
 */
export function shouldHealUp(me: TDMAgent, state: BRBotState): boolean {
  if (me.hp >= me.maxHP * 0.75) return false;
  if (gameState.worldElapsed - me.lastDamageTime < 3) return false;
  if (isOutsideZone(me.position.x, me.position.z)) return false;
  if ((state as any)._healCooldown && gameState.worldElapsed < (state as any)._healCooldown) return false;

  // Check for visible threats
  for (const ag of gameState.agents) {
    if (ag === me || ag.isDead || ag.team === me.team) continue;
    if (me.position.distanceTo(ag.position) < 30 && canSee(me, ag)) return false;
  }
  return true;
}

export function doHealUp(me: TDMAgent, state: BRBotState): void {
  const amount = 30 + Math.random() * 15;
  me.hp = Math.min(me.maxHP, me.hp + amount);
  (state as any)._healCooldown = gameState.worldElapsed + 9 + Math.random() * 5;
}

// ─────────────────────────────────────────────────────────────────────
//  WEAPON SWAPPING FOR RANGE
// ─────────────────────────────────────────────────────────────────────

/**
 * Pick the best weapon this bot has for the current engagement range.
 * Currently bots hold a single weapon slot — this hooks for future
 * multi-slot inventories. Returns current weapon if no swap needed.
 */
export function pickBestWeaponForRange(me: TDMAgent, dist: number): WeaponId {
  // Single-slot bots — no-op
  return me.weaponId;
}

// ─────────────────────────────────────────────────────────────────────
//  DECIDE: SHOULD I ENGAGE THIS ENEMY?
// ─────────────────────────────────────────────────────────────────────

export interface EngagementDecision {
  action: 'push' | 'trade' | 'disengage' | 'flank';
  reason: string;
}

/**
 * Given a visible enemy, decide the correct response. This is the core
 * of "play like a human" — don't just shoot; weigh the fight.
 */
export function decideEngagement(me: TDMAgent, enemy: TDMAgent): EngagementDecision {
  const dist = me.position.distanceTo(enemy.position);
  const win  = winProbability(me, enemy);
  const rangeFit = weaponRangeFitness(me.weaponId, dist);
  const p = me.personality;

  // Hard disengage conditions
  if (me.weaponId === 'knife' && dist > 4) {
    return { action: 'disengage', reason: 'knife-vs-ranged' };
  }
  if (win < 0.25) {
    return { action: 'disengage', reason: 'lowwin' };
  }
  if (me.hp < me.maxHP * 0.25 && dist > 8) {
    return { action: 'disengage', reason: 'critical-hp' };
  }

  // Range mismatch → flank to reduce distance (or widen it for snipers)
  if (rangeFit < 0.35 && win > 0.3) {
    return { action: 'flank', reason: 'range-mismatch' };
  }

  // Strong advantage → push
  if (win > 0.65 && me.hp > me.maxHP * 0.55) {
    return { action: 'push', reason: 'winning' };
  }

  // Personality — aggressive bots push more, cautious trade
  if (p && p.aggressionBias > 0.15 && win > 0.45) {
    return { action: 'push', reason: 'personality-push' };
  }
  if (p && p.cautionBias > 0.15 && win < 0.55) {
    return { action: 'trade', reason: 'personality-trade' };
  }

  return { action: 'trade', reason: 'even-fight' };
}
