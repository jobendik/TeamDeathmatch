# TeamDeathmatch AI / NavMesh Debug Dump

Generated: 4/19/2026, 12:13:17 PM


## 1. NavMesh health

total regions: 1543
components   : 58
main component size: 945 (61.2%)
component sizes (largest-first): [945,74,52,52,40,40,30,22,12,12]
vertices/region: min=3 max=3 avg=3.00
half-edges with twin: 3268 (higher = better connectivity)
mesh AABB: x[-65.5, 65.5] y[0.0, 0.0] z[-65.5, 65.5]

## 2. Arena geometry

wallMeshes (visual, in scene)       : 0
arenaColliders (used by NavMeshBuilder): 0
colliders (used by player collision) : 0
yukaObs (ObstacleAvoidanceBehavior)  : 0
⚠ arenaColliders is EMPTY — procedural arena is disabled.
  The runtime NavMeshBuilder would produce a wall-less grid.
  Baked arena_navmesh.gltf is the only real source of walls.

## 3. Spawn positions — main-component membership

| name | team | pos | regionFound | inMainComponent |
| --- | --- | --- | --- | --- |
| Player | 0 | (-48.00, 0.00, -40.00) | true | true |
| Falcon | 0 | (-40.00, 0.00, -48.00) | true | true |
| Blaze | 0 | (-48.00, 0.00, -40.00) | true | true |
| Storm | 0 | (-35.20, 0.00, -38.72) | true | true |
| Ghost | 0 | (-38.72, 0.00, -35.20) | true | true |
| Hawk | 0 | (-48.00, 0.00, -48.00) | true | true |
| Demon | 1 | (38.72, 0.00, 38.72) | true | true |
| Inferno | 1 | (35.20, 0.00, 42.24) | true | true |
| Hammer | 1 | (42.24, 0.00, 35.20) | true | true |
| Fang | 1 | (40.00, 0.00, 44.00) | true | true |
| Specter | 1 | (44.00, 0.00, 40.00) | true | true |
| Viper | 1 | (48.00, 0.00, 48.00) | true | true |


## 4. Per-agent runtime snapshot

| name | team | HP | dead | pos | speed | maxS | reg | main | path | pend | follow |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Falcon | 0 | ? | false | (38.25, 0.00, -31.66) | 5.07 | 5.20 | ✓ | ✓ | 6 |  | ✓ |
| Blaze | 0 | ? | false | (8.49, 0.00, -41.28) | 4.92 | 5.20 | ✓ | ✓ | 4 |  | ✓ |
| Storm | 0 | ? | false | (42.89, 0.00, -60.48) | 6.00 | 6.00 | ✓ | ✓ | 13 |  | ✓ |
| Ghost | 0 | ? | false | (-44.00, 0.00, -31.34) | 3.00 | 4.00 | ✓ | ✗ | 0 |  |  |
| Hawk | 0 | ? | false | (46.34, 0.00, -25.64) | 5.98 | 6.50 | ✓ | ✓ | 7 |  | ✓ |
| Demon | 1 | ? | false | (-21.60, 0.00, 18.69) | 5.18 | 5.20 | ✓ | ✓ | 4 |  | ✓ |
| Inferno | 1 | ? | false | (-14.62, 0.00, 11.11) | 5.05 | 5.20 | ✓ | ✓ | 6 |  | ✓ |
| Hammer | 1 | ? | false | (-18.53, 0.00, 24.38) | 5.31 | 6.00 | ✓ | ✓ | 6 |  | ✓ |
| Fang | 1 | ? | false | (49.45, 0.00, 49.42) | 3.30 | 3.30 | ✓ | ✓ | 0 |  |  |
| Specter | 1 | ? | false | (33.57, 0.00, 23.05) | 2.00 | 4.00 | ✓ | ✓ | 0 |  |  |
| Viper | 1 | ? | false | (-32.08, 0.00, 23.29) | 6.49 | 6.50 | ✓ | ✓ | 3 |  | ✓ |


## 5. Steering behaviors per agent

### agent: Falcon (team 0)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 0.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (0.00, 0.00, 0.00) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Falcon |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | true | 1.00 | wpN=6 |
| OnPathBehavior | true | 0.40 |  |

### agent: Blaze (team 0)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 0.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (0.00, 0.00, 0.00) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Blaze |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | true | 1.00 | wpN=4 |
| OnPathBehavior | true | 0.40 |  |

### agent: Storm (team 0)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 0.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (-43.73, 0.00, -45.51) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Storm |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | true | 1.00 | wpN=13 |
| OnPathBehavior | true | 0.40 |  |

### agent: Ghost (team 0)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 0.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 1.40 | (-35.14, 0.00, -32.60) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.20 | evader=Inferno |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | false | 1.00 | wpN=0 |
| OnPathBehavior | false | 0.40 |  |

### agent: Hawk (team 0)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 0.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (0.00, 0.00, 0.00) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Hawk |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | true | 1.00 | wpN=7 |
| OnPathBehavior | true | 0.40 |  |

### agent: Demon (team 1)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 0.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (0.00, 0.00, 0.00) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Demon |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | true | 1.00 | wpN=4 |
| OnPathBehavior | true | 0.40 |  |

### agent: Inferno (team 1)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 0.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (0.00, 0.00, 0.00) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Inferno |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | true | 1.00 | wpN=6 |
| OnPathBehavior | true | 0.40 |  |

### agent: Hammer (team 1)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 0.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (0.00, 0.00, 0.00) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Hammer |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | true | 1.00 | wpN=6 |
| OnPathBehavior | true | 0.40 |  |

### agent: Fang (team 1)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 1.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (0.00, 0.00, 0.00) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Fang |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | false | 1.00 | wpN=0 |
| OnPathBehavior | false | 0.40 |  |

### agent: Specter (team 1)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 0.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 1.40 | (42.33, 0.00, 21.22) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.20 | evader=Hawk |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | false | 1.00 | wpN=0 |
| OnPathBehavior | false | 0.40 |  |

### agent: Viper (team 1)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 0.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (13.00, 0.00, 9.11) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Viper |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | true | 1.00 | wpN=3 |
| OnPathBehavior | true | 0.40 |  |


## 6. Random path smoke-test

smoke test: 25/25 paths succeeded (0 failed)

## 7. findPath cross-check

Falcon     @ (38.25, 0.00, -31.66) → has path (6 wps) | to Blaze: 2 waypoints
Blaze      @ (8.49, 0.00, -41.28) → has path (4 wps) | to Falcon: 2 waypoints
Storm      @ (42.89, 0.00, -60.48) → has path (13 wps) | to Falcon: 4 waypoints
Ghost      @ (-44.00, 0.00, -31.34) → no path | to Falcon: 0 waypoints
Hawk       @ (46.34, 0.00, -25.64) → has path (7 wps) | to Falcon: 5 waypoints
Demon      @ (-21.60, 0.00, 18.69) → has path (4 wps) | to Falcon: 10 waypoints

## 8. Position-vs-obstacle cross-check

No arenaColliders (cannot test).

## 9. Goal / brain state

> ❌ Error in section: brain?.subgoals is not a function


## 10. Summary / likely failure mode

• arenaColliders empty AND navmesh sparse → bots will walk through walls.

--- End of Report ---
