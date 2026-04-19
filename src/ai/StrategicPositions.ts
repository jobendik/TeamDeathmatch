import * as YUKA from 'yuka';
import type { TDMAgent } from '@/entities/TDMAgent';
import { gameState } from '@/core/GameState';
import { TEAM_BLUE } from '@/config/constants';
import { ARENA_MARGIN } from '@/config/constants';
import { isInsideWall, pushOutOfWall } from './CoverSystem';

/**
 * Strategic positions are map-knowledge waypoints that bots prefer
 * based on their archetype. This replaces pure random wander with
 * intelligent patrol routes.
 */

export type PositionType = 'power' | 'sniper_nest' | 'choke' | 'flank_route' | 'cover';

export interface StrategicPosition {
  pos: YUKA.Vector3;
  type: PositionType;
  /** -1 = blue-biased, 0 = neutral, 1 = red-biased */
  teamBias: number;
  /** Engagement angle this position controls (radians, 0 = north) */
  controlsAngle: number;
}

/**
 * Handcrafted strategic positions mapped to the existing arena layout.
 * Positions reference actual wall/pillar locations from Arena.ts.
 */
export const STRATEGIC_POSITIONS: StrategicPosition[] = [
  // ── Power positions (central high-value spots) ──
  { pos: new YUKA.Vector3(0, 0, 0),       type: 'power', teamBias: 0, controlsAngle: 0 },
  { pos: new YUKA.Vector3(8, 0, 0),        type: 'power', teamBias: 0, controlsAngle: Math.PI / 2 },
  { pos: new YUKA.Vector3(-8, 0, 0),       type: 'power', teamBias: 0, controlsAngle: -Math.PI / 2 },
  { pos: new YUKA.Vector3(0, 0, 8),        type: 'power', teamBias: 0, controlsAngle: 0 },
  { pos: new YUKA.Vector3(0, 0, -8),       type: 'power', teamBias: 0, controlsAngle: Math.PI },

  // ── Sniper nests (behind long walls with sightlines) ──
  { pos: new YUKA.Vector3(-37, 0, -3),     type: 'sniper_nest', teamBias: -0.5, controlsAngle: Math.PI / 2 },
  { pos: new YUKA.Vector3(37, 0, 3),       type: 'sniper_nest', teamBias: 0.5, controlsAngle: -Math.PI / 2 },
  { pos: new YUKA.Vector3(-30, 0, -20),    type: 'sniper_nest', teamBias: -0.3, controlsAngle: Math.PI * 0.75 },
  { pos: new YUKA.Vector3(30, 0, 20),      type: 'sniper_nest', teamBias: 0.3, controlsAngle: -Math.PI * 0.25 },

  // ── Choke points (mid-lane walls and intersections) ──
  { pos: new YUKA.Vector3(-22, 0, 2),      type: 'choke', teamBias: -0.2, controlsAngle: Math.PI / 2 },
  { pos: new YUKA.Vector3(22, 0, -2),      type: 'choke', teamBias: 0.2, controlsAngle: -Math.PI / 2 },
  { pos: new YUKA.Vector3(2, 0, -22),      type: 'choke', teamBias: -0.2, controlsAngle: 0 },
  { pos: new YUKA.Vector3(-2, 0, 22),      type: 'choke', teamBias: 0.2, controlsAngle: Math.PI },

  // ── Flank routes (wide arcs around the map) ──
  { pos: new YUKA.Vector3(-42, 0, 25),     type: 'flank_route', teamBias: -0.4, controlsAngle: Math.PI * 0.7 },
  { pos: new YUKA.Vector3(42, 0, -25),     type: 'flank_route', teamBias: 0.4, controlsAngle: -Math.PI * 0.3 },
  { pos: new YUKA.Vector3(25, 0, -42),     type: 'flank_route', teamBias: -0.4, controlsAngle: Math.PI * 0.2 },
  { pos: new YUKA.Vector3(-25, 0, 42),     type: 'flank_route', teamBias: 0.4, controlsAngle: -Math.PI * 0.8 },

  // ── Cover positions (near scatter blocks) ──
  { pos: new YUKA.Vector3(-12, 0, 12),     type: 'cover', teamBias: 0, controlsAngle: Math.PI * 0.75 },
  { pos: new YUKA.Vector3(12, 0, -12),     type: 'cover', teamBias: 0, controlsAngle: -Math.PI * 0.25 },
  { pos: new YUKA.Vector3(-12, 0, -12),    type: 'cover', teamBias: -0.3, controlsAngle: -Math.PI * 0.75 },
  { pos: new YUKA.Vector3(12, 0, 12),      type: 'cover', teamBias: 0.3, controlsAngle: Math.PI * 0.25 },

  // ── Corner fort positions ──
  { pos: new YUKA.Vector3(-44, 0, -40),    type: 'cover', teamBias: -0.8, controlsAngle: Math.PI * 0.75 },
  { pos: new YUKA.Vector3(44, 0, 40),      type: 'cover', teamBias: 0.8, controlsAngle: -Math.PI * 0.25 },
  { pos: new YUKA.Vector3(-44, 0, 40),     type: 'cover', teamBias: -0.3, controlsAngle: -Math.PI * 0.75 },
  { pos: new YUKA.Vector3(44, 0, -40),     type: 'cover', teamBias: 0.3, controlsAngle: Math.PI * 0.25 },
];

/**
 * Pick a strategic position weighted by bot archetype and team.
 * Returns null if no suitable position is found.
 */
export function getPreferredPosition(ag: TDMAgent): YUKA.Vector3 | null {
  const isBlue = ag.team === TEAM_BLUE;
  const teamSign = isBlue ? -1 : 1; // blue = negative bias, red = positive
  const isArenaPushMode = gameState.mode === 'tdm' || gameState.mode === 'elimination' || gameState.mode === 'training';

  const scored: { pos: YUKA.Vector3; score: number }[] = [];

  for (const sp of STRATEGIC_POSITIONS) {
    let score = 20; // base attractiveness

    // Team bias: prefer positions biased toward own team
    const biasDiff = sp.teamBias * teamSign;
    score += biasDiff * 30;

    if (isArenaPushMode) {
      const enemyProgress = isBlue ? (sp.pos.x + sp.pos.z) : -(sp.pos.x + sp.pos.z);
      const normalizedProgress = Math.max(-1, Math.min(1, enemyProgress / (ARENA_MARGIN * 1.6)));

      // In arena TDM, bots need a default forward objective so they don't mill around
      // their own side waiting for perfect intel.
      score += normalizedProgress * 18;
      if (sp.type === 'power' || sp.type === 'choke') score += 8;
      if (normalizedProgress < -0.2) score -= 14;
    }

    // Distance penalty: prefer closer positions (don't run across the entire map)
    const dist = ag.position.distanceTo(sp.pos);
    if (dist < 5) continue; // already here
    if (dist > 70) continue; // too far
    score -= dist * 0.3;

    // Archetype preferences
    switch (ag.botClass) {
      case 'sniper':
        if (sp.type === 'sniper_nest') score += 40;
        if (sp.type === 'cover') score += 15;
        if (sp.type === 'flank_route') score -= 10;
        break;
      case 'flanker':
        if (sp.type === 'flank_route') score += 35;
        if (sp.type === 'sniper_nest') score -= 15;
        if (sp.type === 'choke') score -= 5;
        break;
      case 'assault':
        if (sp.type === 'power') score += 30;
        if (sp.type === 'choke') score += 20;
        break;
      case 'rifleman':
      default:
        if (sp.type === 'choke') score += 20;
        if (sp.type === 'cover') score += 15;
        if (sp.type === 'power') score += 10;
        break;
    }

    // Avoid positions near known enemies
    for (const [, mem] of ag.enemyMemory) {
      if (mem.confidence > 0.3) {
        const enemyDist = sp.pos.distanceTo(mem.lastSeenPos);
        if (enemyDist < 8) score -= 25;
      }
    }

    // Avoid positions where nearby allies already are
    for (const ally of gameState.agents) {
      if (ally === ag || ally.isDead || ally.team !== ag.team) continue;
      const allyDist = sp.pos.distanceTo(ally.position);
      if (allyDist < 6) score -= 15;
    }

    if (score > 0) scored.push({ pos: sp.pos, score });
  }

  if (scored.length === 0) return null;

  // Weighted random selection from top candidates
  scored.sort((a, b) => b.score - a.score);
  const topN = Math.min(4, scored.length);
  const pick = scored[Math.floor(Math.random() * topN)];

  // Ensure position is not inside a wall
  if (isInsideWall(pick.pos.x, pick.pos.z)) {
    const safe = pushOutOfWall(pick.pos.x, pick.pos.z);
    return new YUKA.Vector3(safe.x, 0, safe.z);
  }

  return pick.pos.clone();
}
