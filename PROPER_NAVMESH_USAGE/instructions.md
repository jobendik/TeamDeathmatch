# Navmesh Integration Instructions for a GPT

## Goal

Implement navmesh-based navigation in my FPS game using **YUKA** in the same overall style as the official YUKA FPS showcase.

The implementation must support:

1. Loading a navmesh as a separate asset
2. Bot pathfinding
3. Bot path following
4. Continuous navmesh clamping every frame
5. Height correction from the current navmesh region plane
6. Optional click-to-move debug mode
7. Optional debug helpers for convex regions, graph, and current path
8. Clean integration into an existing FPS project, without rewriting the whole architecture

---

## Core Principle

Do **not** treat the navmesh as just a route generator.

The correct YUKA runtime pattern is:

1. Load navmesh with `YUKA.NavMeshLoader`
2. Keep `currentRegion` on every navmesh-controlled entity
3. Keep `previousPosition` and `currentPosition`
4. Run steering and movement normally
5. Then call `navMesh.clampMovement(...)` every frame
6. Save the returned region back into `currentRegion`
7. Adjust the entity height using `currentRegion.plane.distanceToPoint(position)`
8. Use `FollowPathBehavior` **and** `OnPathBehavior` together

That runtime pattern is the single most important thing.

---

## Non-Negotiable Rules

### Loading
- Load the navmesh as a separate `.glb` or `.gltf` file
- Use `YUKA.NavMeshLoader`
- Start with:
  - `mergeConvexRegions: false`
  - `epsilonCoplanarTest: 0.25`

### Runtime State Per Moving Agent
Every navmesh-controlled entity must have:
- `currentRegion`
- `currentPosition`
- `previousPosition`
- `path` or equivalent path storage

### Runtime Movement
Every frame:
- update position from movement / steering
- call `clampMovement()`
- update `currentRegion`
- save `previousPosition`
- correct height from `currentRegion.plane`

### Steering
For bots, use at least:
- `FollowPathBehavior`
- `OnPathBehavior`

`SeekBehavior` can exist too, but it must not replace navmesh following.

### Path Flow
Pathfinding and path following must be separate steps:
- Step 1: compute a path
- Step 2: push the path waypoints into `FollowPathBehavior.path`
- Step 3: activate `FollowPathBehavior` and `OnPathBehavior`

### Failure Handling
If no path is found:
- fail clearly
- do not silently fall back to raw seeking through walls

### Project Discipline
- Adapt to the current codebase
- Prefer minimal, focused files
- Do not replace existing systems unless necessary
- Do not invent a brand-new AI architecture if the current one can be extended

---

## The Correct Mental Model

The navmesh is used for **three** different jobs:

1. **Path planning**  
   `navMesh.findPath(from, to)`

2. **Movement constraints**  
   `navMesh.clampMovement(...)`

3. **Ground alignment**  
   `currentRegion.plane.distanceToPoint(position)`

If the implementation only does job 1, it is incomplete.

---

## Architecture To Implement

Create or adapt the following pieces.

### 1. `NavConfig`
A dedicated navigation config module

### 2. `NavMeshManager`
Responsible for:
- loading the navmesh
- exposing `getRegionForPoint`
- exposing `findPath`
- exposing `clampMovement`
- optionally building helpers

### 3. `NavAgentRuntime`
A small runtime helper attached to each bot or navmesh-controlled actor:
- steering setup
- path setup
- clamp-to-navmesh update
- height correction

### 4. `PathPlanner`
Simple wrapper around `navMesh.findPath()`
Can be synchronous or task-queue based

### 5. Bot Navigation Glue
A thin integration layer that:
- requests path
- applies path to steering
- checks arrival
- clears path when complete

### 6. Optional Click-To-Move Debug Controller
Only for debug/testing

---

## Required Runtime Behaviors

### FollowPathBehavior
Must be configured with:
- `nextWaypointDistance`

### OnPathBehavior
Must:
- use the exact same path object as `FollowPathBehavior.path`
- be active while following
- have a radius and weight

### Height Correction
After clamping:
- compute distance from entity position to `currentRegion.plane`
- subtract some fraction of that distance from the entity Y
- use smoothing, not teleport snapping, unless explicitly needed

---

## Expected Integration Points

### World / Game bootstrap
The world or equivalent game manager must:
- load the navmesh
- store it somewhere globally accessible to movement systems
- optionally build spatial index or helpers
- optionally initialize path planner

### Bot entity
Each bot should:
- own a `NavAgentRuntime`
- initialize its spawn region after spawn
- request paths from goals / actions / state machine
- call navmesh runtime update every frame

### Player entity
If the player also moves on the navmesh:
- the player should use the same clamping pattern
- player movement can stay input-driven, but clamping and height correction should still happen every frame

### Items / pickups / patrol points
Anything important for traversal should resolve a region with:
- `navMesh.getRegionForPoint(position, epsilon)`

---

## Strongly Recommended Implementation Pattern

### Path Request
When a bot needs to move:
1. build `from` from the bot's current position
2. build `to` from the target position
3. call planner
4. store returned path
5. feed waypoints to `FollowPathBehavior.path`
6. activate `FollowPathBehavior`
7. activate `OnPathBehavior`

### Path Completion
When bot reaches destination:
- deactivate `FollowPathBehavior`
- deactivate `OnPathBehavior`
- clear current path

### Spawn Initialization
When spawning:
- set `position`
- set `previousPosition = position`
- set `currentPosition = position`
- set `currentRegion = navMesh.getRegionForPoint(position, epsilon)`

If `currentRegion` is null, this must be treated as a real spawn failure.

---

## What Must Be Avoided

### Wrong
- Using navmesh only for `findPath()`
- Moving actor without `clampMovement()`
- Ignoring `currentRegion`
- Ignoring height correction
- Using `FollowPathBehavior` without `OnPathBehavior`
- Teleporting through waypoints
- Falling back to raw seek through walls when `findPath()` fails
- Leaving steering active after arrival
- Assuming disconnected islands are harmless
- Rebuilding the entire architecture just to add navmesh

### Correct
- Find path
- Follow path
- Clamp movement
- Update region
- Correct height
- Turn behaviors off after arrival

---

## Debug Features To Include

Provide optional developer helpers for:
- convex regions
- graph
- current path line
- current target point
- current region centroid if useful

Provide clear logs for:
- navmesh loaded
- spawn on valid region
- target click not on navmesh
- no path found
- path found with waypoint count
- path completed
- currentRegion lost

---

## Acceptance Checklist

Implementation is not complete until all of the following are true:

1. Navmesh loads successfully
2. A bot can spawn on a valid region
3. A bot can request a path to a reachable point
4. The bot follows the path using YUKA steering
5. The bot stays on the navmesh at runtime
6. The bot height follows the navmesh plane
7. Steering turns off when the bot reaches destination
8. Invalid targets fail cleanly
9. Debug helpers can be shown if enabled
10. Existing FPS architecture remains intact

---

## Recommended Working Defaults

Use these as initial defaults:

- `nextWaypointDistance = 0.5`
- `arriveDeceleration = 2`
- `arriveTolerance = 1.0`
- `pathRadius = 0.1`
- `onPathWeight = 1.0`
- `heightChangeFactor = 0.2`
- `regionEpsilon = 1.0`

These are good showcase-style defaults, not universal laws.

---

## Optional Upgrade Path

Once the basic system works, optionally add:
- async path planner queue
- travel cost lookup table between regions
- smarter AI item selection based on navmesh travel cost
- path debug overlays
- disconnected island detection
- automatic spawn-point validation against main component only

---

## Final Output Requirements

When doing the implementation:

1. Show exact file edits
2. Keep new files minimal
3. Do not change unrelated systems
4. At the end, summarize:
   - files created
   - files modified
   - optional next improvements

If there is uncertainty about how to adapt this to my project structure, preserve the existing structure and inject the smallest possible navmesh layer.
