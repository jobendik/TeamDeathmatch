export const NAV_CONFIG = {
  // Waypoint must be larger than the agent's boundingRadius (0.65 in TDMAgent)
  // or the bot physically can't reach it without rubberbanding.
  NEXT_WAYPOINT_DISTANCE: 1.5,
  ARRIVE_DECELERATION: 2,
  // ARRIVE_TOLERANCE is used by goals to decide "am I there?" — keep loose.
  ARRIVE_TOLERANCE: 1.25,
  // OnPathBehavior radius. <0.5m is narrower than the agent — fights every
  // other behavior. 1.0m gives steering headroom without letting bots wander
  // fully off the corridor.
  PATH_RADIUS: 1.0,
  // Keep OnPath below any combat seek/pursuit weight (typically ~1.4) so a
  // spotted enemy can override the corridor.
  ON_PATH_WEIGHT: 0.4,
  HEIGHT_CHANGE_FACTOR: 0.2, // Amount of height correction per frame
  REGION_EPSILON: 1.0,
} as const;
