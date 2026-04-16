import * as YUKA from 'yuka';
import { gameState } from '@/core/GameState';
import { TEAM_BLUE, TEAM_RED, type TeamId } from '@/config/constants';

/**
 * Map is partitioned into coarse zones (12×12m). Each zone tracks
 * a danger score per team — higher = more deaths there for that team.
 *
 * Bots factor this into movement decisions, subtly avoiding hot zones.
 */

const ZONE_SIZE = 12;
const GRID_HALF = 5; // -60..60 → 11 zones per axis

interface ZoneData {
  blueDeaths: number;
  redDeaths: number;
  lastActivity: number;
  playerEngagements: number; // times the player engaged from this zone
}

const zones: Map<string, ZoneData> = new Map();

function zoneKey(x: number, z: number): string {
  const gx = Math.max(-GRID_HALF, Math.min(GRID_HALF, Math.round(x / ZONE_SIZE)));
  const gz = Math.max(-GRID_HALF, Math.min(GRID_HALF, Math.round(z / ZONE_SIZE)));
  return `${gx},${gz}`;
}

function getZone(x: number, z: number): ZoneData {
  const k = zoneKey(x, z);
  let z2 = zones.get(k);
  if (!z2) {
    z2 = { blueDeaths: 0, redDeaths: 0, lastActivity: 0, playerEngagements: 0 };
    zones.set(k, z2);
  }
  return z2;
}

/** Register a death — increments danger score for that team's zone. */
export function registerDeath(team: TeamId, x: number, z: number): void {
  const zone = getZone(x, z);
  if (team === TEAM_BLUE) zone.blueDeaths++;
  else zone.redDeaths++;
  zone.lastActivity = gameState.worldElapsed;
}

/** Register the player firing — used by bots to triangulate where you like to camp. */
export function registerPlayerEngagement(x: number, z: number): void {
  const zone = getZone(x, z);
  zone.playerEngagements++;
  zone.lastActivity = gameState.worldElapsed;
}

/**
 * Get a danger multiplier for a team at a position (0 = safe, 1 = very dangerous).
 * Uses decay so recent deaths matter more.
 */
export function getZoneDanger(team: TeamId, x: number, z: number): number {
  const zone = getZone(x, z);
  const timeSince = gameState.worldElapsed - zone.lastActivity;
  const recency = Math.max(0, 1 - timeSince / 60);
  const deaths = team === TEAM_BLUE ? zone.blueDeaths : zone.redDeaths;
  return Math.min(1, deaths * 0.2 * recency);
}

/** Zone likelihood that the player is currently nearby. */
export function getPlayerHotZone(x: number, z: number): number {
  const zone = getZone(x, z);
  const timeSince = gameState.worldElapsed - zone.lastActivity;
  const recency = Math.max(0, 1 - timeSince / 30);
  return Math.min(1, zone.playerEngagements * 0.15 * recency);
}

export function clearMatchMemory(): void {
  zones.clear();
}
