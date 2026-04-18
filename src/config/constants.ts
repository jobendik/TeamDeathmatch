/** Arena and game constants */
export const ARENA_HALF = 58;
export const ARENA_MARGIN = ARENA_HALF - 1.5;
export const SCORE_LIMIT = 10;
export const RESPAWN_TIME = 3;

/** Team identifiers */
export const TEAM_BLUE = 0 as const;
export const TEAM_RED = 1 as const;
export type TeamId = typeof TEAM_BLUE | typeof TEAM_RED;

/** Team display colors (hex) */
export const TEAM_COLORS: Record<TeamId, number> = {
  [TEAM_BLUE]: 0x38bdf8,
  [TEAM_RED]: 0xef4444,
};

/** Team display names */
export const TEAM_NAMES: Record<TeamId, string> = {
  [TEAM_BLUE]: 'BLUE',
  [TEAM_RED]: 'RED',
};

/** Spawn positions per team */
export const BLUE_SPAWNS: [number, number, number][] = [
  [-48, 0, -48], [-44, 0, -52], [-52, 0, -44],
  [-40, 0, -48], [-48, 0, -40], [-52, 0, -52],
];

export const RED_SPAWNS: [number, number, number][] = [
  [48, 0, 48], [44, 0, 52], [52, 0, 44],
  [40, 0, 48], [48, 0, 40], [52, 0, 52],
];

/** Agent hitbox radii (shared between Bullets and Hitscan) */
export const BODY_HIT_RADIUS = 0.55;
export const HEAD_HIT_RADIUS = 0.22;
