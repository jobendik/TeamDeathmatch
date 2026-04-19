# TeamDeathmatch AI / NavMesh Debug Dump

Generated: 4/19/2026, 12:10:26 PM


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
| Player | 0 | (-48.00, 0.00, -48.00) | true | true |
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
| Falcon | 0 | ? | false | (-61.75, 0.00, -53.86) | 2.86 | 2.86 | ✓ | ✓ | 0 | ✓ |  |
| Blaze | 0 | ? | false | (-38.86, 0.00, -47.50) | 4.15 | 5.20 | ✓ | ✗ | 0 | ✓ |  |
| Storm | 0 | ? | false | (-15.00, 0.00, -32.48) | 6.00 | 6.00 | ✓ | ✗ | 0 | ✓ |  |
| Ghost | 0 | ? | false | (-11.15, 0.00, -26.19) | 2.20 | 2.20 | ✓ | ✓ | 0 | ✓ |  |
| Hawk | 0 | ? | false | (-64.50, 0.00, -56.94) | 3.57 | 3.58 | ✓ | ✓ | 0 | ✓ |  |
| Demon | 1 | ? | false | (30.16, 0.00, 65.00) | 5.20 | 5.20 | ✓ | ✓ | 0 | ✓ |  |
| Inferno | 1 | ? | false | (64.99, 0.00, 65.00) | 5.20 | 5.20 | ✓ | ✓ | 0 | ✓ |  |
| Hammer | 1 | ? | false | (64.96, 0.00, 65.00) | 6.00 | 6.00 | ✓ | ✓ | 0 | ✓ |  |
| Fang | 1 | ? | false | (-12.13, 0.00, 26.62) | 6.00 | 6.00 | ✓ | ✓ | 0 | ✓ |  |
| Specter | 1 | ? | false | (27.50, 0.00, 44.50) | 4.00 | 4.00 | ✓ | ✗ | 0 | ✓ |  |
| Viper | 1 | ? | false | (-27.82, 0.00, 65.00) | 6.50 | 6.50 | ✓ | ✓ | 0 | ✓ |  |


## 5. Steering behaviors per agent

### agent: Falcon (team 0)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 1.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (-53.58, 0.00, -33.22) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Falcon |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | false | 1.00 | wpN=0 |
| OnPathBehavior | false | 0.40 |  |

### agent: Blaze (team 0)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 1.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (-37.10, 0.00, -49.20) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Blaze |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | false | 1.00 | wpN=0 |
| OnPathBehavior | false | 0.40 |  |

### agent: Storm (team 0)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 1.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (-13.19, 0.00, -30.60) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Storm |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | false | 1.00 | wpN=0 |
| OnPathBehavior | false | 0.40 |  |

### agent: Ghost (team 0)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 1.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (0.00, 0.00, 0.00) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Ghost |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | false | 1.00 | wpN=0 |
| OnPathBehavior | false | 0.40 |  |

### agent: Hawk (team 0)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 1.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (-54.53, 0.00, -37.05) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Hawk |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | false | 1.00 | wpN=0 |
| OnPathBehavior | false | 0.40 |  |

### agent: Demon (team 1)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 1.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (47.85, 0.00, 53.78) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Demon |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | false | 1.00 | wpN=0 |
| OnPathBehavior | false | 0.40 |  |

### agent: Inferno (team 1)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 1.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (57.40, 0.00, 56.95) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Inferno |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | false | 1.00 | wpN=0 |
| OnPathBehavior | false | 0.40 |  |

### agent: Hammer (team 1)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 1.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (53.52, 0.00, 55.61) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Hammer |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | false | 1.00 | wpN=0 |
| OnPathBehavior | false | 0.40 |  |

### agent: Fang (team 1)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 1.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (12.82, 0.00, 50.53) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Fang |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | false | 1.00 | wpN=0 |
| OnPathBehavior | false | 0.40 |  |

### agent: Specter (team 1)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 1.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (27.20, 0.00, 43.34) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Specter |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | false | 1.00 | wpN=0 |
| OnPathBehavior | false | 0.40 |  |

### agent: Viper (team 1)
| type | active | weight | extra |
| --- | --- | --- | --- |
| WanderBehavior | true | 1.00 |  |
| ArriveBehavior | true | 0.00 |  |
| SeekBehavior | true | 0.00 | (0.00, 0.00, 0.00) |
| FleeBehavior | true | 0.00 |  |
| PursuitBehavior | true | 0.00 | evader=Viper |
| ObstacleAvoidanceBehavior | true | 1.20 |  |
| FollowPathBehavior | false | 1.00 | wpN=0 |
| OnPathBehavior | false | 0.40 |  |


## 6. Random path smoke-test

smoke test: 25/25 paths succeeded (0 failed)

## 7. findPath cross-check

Falcon     @ (-61.75, 0.00, -53.86) → no path | to Blaze: 0 waypoints
Blaze      @ (-38.86, 0.00, -47.50) → no path | to Falcon: 0 waypoints
Storm      @ (-15.00, 0.00, -32.48) → no path | to Falcon: 0 waypoints
Ghost      @ (-11.15, 0.00, -26.19) → no path | to Falcon: 5 waypoints
Hawk       @ (-64.50, 0.00, -56.94) → no path | to Falcon: 2 waypoints
Demon      @ (30.16, 0.00, 65.00) → no path | to Falcon: 5 waypoints

## 8. Position-vs-obstacle cross-check

No arenaColliders (cannot test).

## 9. Goal / brain state

> ❌ Error in section: brain?.subgoals is not a function


## 10. Summary / likely failure mode

• arenaColliders empty AND navmesh sparse → bots will walk through walls.

--- End of Report ---
