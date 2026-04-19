I'll read the full codebase carefully, trace the runtime, and give you a grounded diagnosis plus drop-in debug tooling and surgical fixes. I'm going to be explicit about what I can verify from the code you shared versus what I can't.

Before anything: **I don't have `GameLoop.ts`, `GameState.ts` (only referenced), or the actual `arena_navmesh.gltf` file.** A couple of my hypotheses specifically depend on those, and I'll flag them as "needs verification" rather than assert them.

---

## 1. System understanding

Here's what the code actually does, end-to-end.

**Navmesh lifecycle (`main.ts`)**
1. Try to load a baked file `/models/arena_navmesh.gltf` via `NavMeshManager.load()` (which calls `YUKA.NavMeshLoader` with `mergeConvexRegions:false, epsilonCoplanarTest:0.25`).
2. On failure, run `buildNavMeshBlob()` — a runtime grid-sampler in `NavMeshBuilder.ts` that rasterizes `gameState.arenaColliders` at 2m cells, builds a shared-vertex mesh, GLTF-exports it to a blob URL, and loads that.
3. Wrap the navmesh in an `AsyncPathPlanner` (a `YUKA.TaskQueue` wrapper).

**Per agent (`AgentFactory.mkAgent` + `TDMAgent`)**
1. Add six steering behaviors to `Vehicle.steering`: `WanderBehavior`, `ArriveBehavior`, `SeekBehavior`, `FleeBehavior`, `PursuitBehavior`, `ObstacleAvoidanceBehavior`. `ObstacleAvoidance.weight = 3`.
2. Instantiate a `NavAgentRuntime`, which appends *two more* behaviors to the same steering stack: `FollowPathBehavior` and `OnPathBehavior` (sharing a single path object). That's **eight behaviors on one vehicle**.
3. `initFromSpawn(spawnPos)` sets `position/previousPosition/currentPosition` and calls `recoverRegion()` to resolve `currentRegion`. If it fails, it walks `REGION_SEARCH_RADII = [1, 3, 6, 10]` and finally `snapToRegion()` (projects onto the closest face).

**Goal/evaluator architecture**
- Evaluators: `AttackEvaluator`, `SurviveEvaluator`, `ReloadEvaluator`, `SeekHealthEvaluator`, `GetWeaponEvaluator`, `HuntEvaluator`, `HoldAngleEvaluator`, `PatrolEvaluator`.
- `brain.arbitrate()` is called from `AIController.updateAI` when `decisionTimer` expires AND `shouldReplan(ag)` returns true. The winning evaluator's `setGoal()` runs `brain.clearSubgoals()` and `brain.addSubgoal(new ThatGoal(ag))`.
- Each top-level goal (Patrol, Attack, Hunt, Survive, …) activates its own subgoals and manages `navRuntime`. "Movement" goals (Patrol, MoveToPosition, Retreat, TakeCover, Flank, SeekPickup, HoldAngle) request a path via `pathPlanner.findPath(ag, from, to, callback)`; "combat" goals (EngageCombat, Peek, TeamPush) directly drive `seekB/pursuitB`.
- The callback signature is `(vehicle, path) => vehicle.navRuntime.applyPath(path)`, which pushes waypoints into `FollowPathBehavior.path`, activates FollowPath+OnPath, and zeroes `WanderBehavior.weight` once.

**Per-frame clamp**
- `NavAgentRuntime.update()` runs `stayOnNavMesh()` (clampMovement + plane height correction) then checks arrival and clears path. `AIController.updateAI` contains a comment `// NavMesh clamping is handled by GameLoop after entityManager.update() moves entities.` — **I can't see where that's wired up**; this matters.

---

## 2. Root-cause hypotheses, ranked

I'll rank by likelihood of contributing to the symptoms, with confidence level.

### H1. ObstacleAvoidance weight is too high and treats wide rectangular walls as enormous spheres — **HIGH confidence, this alone explains "runs away from nothing"**

In `Arena.ts > addWall()`:
```ts
const ob = new YUKA.GameEntity();
ob.position.set(x, 0.5, z);
ob.boundingRadius = Math.max(w, d) * 0.6;   // <-- sphere radius derived from the wall's *largest* axis
```
Then in `AgentFactory`:
```ts
ag.avoidB = new YUKA.ObstacleAvoidanceBehavior(gameState.yukaObs);
ag.avoidB.weight = 3;
```

The central wall is 14×2.5 (`addWall(0,1.8,0,14,3.6,2.5)`), so its `boundingRadius = 8.4`. YUKA's ObstacleAvoidance does a forward-facing box sweep and steers perpendicular to avoid anything whose sphere intersects the sweep. An 8.4m sphere around a 14m-wide wall centered at (0,0) means **bots approaching anywhere near the map center get kicked sideways with weight 3 — three times harder than their seek or follow-path force**. That's your "running opposite direction" symptom: FollowPath says "go through here", Avoid says "no, hard left", and Avoid wins 3-to-1.

This also explains bots freezing: when they're approximately equidistant from two large sphere obstacles, the avoidance forces oppose each other, and Seek/FollowPath are not strong enough to push through.

### H2. `FollowPath`/`OnPath` are never cleared by some goals, so they keep pulling toward a stale waypoint while combat behaviors try to pull sideways — **HIGH confidence**

Walk the steering behaviors that turn off:
- `EngageCombatGoal.execute` zeroes wander/arrive/flee and drives seek+pursuit. It does **not** touch `followPathBehavior.active` or `onPathBehavior.active`, nor call `clearPath()`.
- `PeekGoal`, `TeamPushGoal` — same.

So if the sequence is `PatrolGoal (path active) → target spotted → AttackTargetGoal → EngageCombatGoal`, the handoff is:
- `PatrolGoal.terminate()` clears path ✅ (good)

That particular path cleared correctly because the top-level goal changed. But there are scenarios where path stays active:
- `AttackTargetGoal` adds `[PeekGoal, TakeCoverGoal]` — `TakeCoverGoal.activate()` *fires a new async path request*. Before the callback arrives, `FollowPath.path` still holds the **previous** cover's waypoints from the prior cover cycle. Seek (weight 1.4) fights FollowPath (weight 1.0).
- Any time `pathPending=true` but the task queue hasn't executed yet, any goal that drives seek/pursuit will fight the last stale path.

### H3. `AsyncPathPlanner.update()` may not be getting called every frame — **MEDIUM confidence, needs verification**

`AsyncPathPlanner` owns a `YUKA.TaskQueue`. Tasks only execute when `taskQueue.update()` runs. I can see `main.ts` assigns it to `gameState.pathPlanner` but nothing in the files you shared calls `gameState.pathPlanner.update()` per frame. `updateAI` calls `brain.execute()` and `brain.arbitrate()`, but pathfinding is dispatched via the queue.

If the queue isn't drained, **every path request sits pending forever**. `navRuntime.path` stays null, goals' execute() perpetually wait in `pathPending` mode while bots rely on wander + strafe + avoid — which would produce exactly "stands still or moves randomly". Please grep your `GameLoop.ts` for `pathPlanner.update` — if it's missing, that's a silent killer.

### H4. `NavMeshBuilder.ts` rasterizes platforms and ramps as *blocked* cells, creating holes in the mesh — **MEDIUM-HIGH confidence** (given the fallback path is what usually runs)

```ts
if (col.type === 'box') {
  if (Math.abs(cx - col.x) < col.hw && Math.abs(cz - col.z) < col.hd) {
    blocked[r * cols + c] = 1;
    break;
  }
}
```

`arenaColliders` includes platform boxes and per-ramp-step boxes (`addPlatform` pushes both). All of them carry `yTop`. The builder ignores `yTop`, so it treats "walk-on-top" colliders as walls. Result: the navmesh is Swiss cheese around the four platforms at (-14,-14), (14,14), (-38,-38), (38,38), and along each ramp — 5 extra holes per platform from the step colliders. Those holes create **disconnected islands** (the platform area, plus the ramp stairway cells) that bots can path *around* fine, but any pickup/cover/strategic point placed on those coordinates becomes unreachable, and paths through them detour strangely.

This doesn't alone stop movement, but combined with H1 and H2 it produces the "unpredictable / wrong direction / stuck" feel.

### H5. `MoveToPositionGoal` reports COMPLETED on pathfinding failure — **MEDIUM confidence**

```ts
if (!ag.navRuntime.path && !ag.navRuntime.pathPending) {
  this.status = YUKA.Goal.STATUS.COMPLETED;
}
```

If `findPath` returns `[]` (unreachable target — very likely given H4's holes), `applyPath` returns false early and `pathPending` goes false with `path` still null. On the next `execute()`, the goal marks itself COMPLETED. The caller (`HuntGoal`) then calls `targetSystem.update()` expecting arrival, but the bot never actually moved. This creates the "bot thinks it reached goal but didn't".

### H6. `AttackTargetGoal`'s typecast `this.status = this.executeSubgoals() as string;` — **LOW-MEDIUM confidence**

YUKA 0.7's `Goal.STATUS` uses string constants (`'active'|'completed'|'failed'|'inactive'`). `executeSubgoals()` returns a number enum in some YUKA versions, not a string. The cast might be papering over a type mismatch that causes the goal to appear inactive when it's actually mid-flight. If you're on `yuka@0.7.x`, status is string-based and this is fine. Worth verifying only if other fixes don't land.

### H7. `HuntEvaluator.setGoal` stores `ag.lastKnownPos` by reference then passes it into `MoveToPositionGoal` — safe (constructor clones) ✅

### H8. `keepInside(ag)` in `AIController` only runs when navmesh is absent — if the baked navmesh loaded but has bad data, bots can drift without fallback clamping — **LOW-MEDIUM**

---

## 3. Concrete evidence

| Symptom | Code location | Why |
|---|---|---|
| Wrong direction near walls | `Arena.ts` line ~275 (`ob.boundingRadius = Math.max(w,d)*0.6`) + `AgentFactory.ts` (`ag.avoidB.weight=3`) | 8m+ avoidance spheres with 3× weight |
| Stands still in open space | No visible call to `pathPlanner.update()` | Task queue never drained ⇒ no paths |
| Zigzags on straight line | Goals drive seek while FollowPath still active with stale waypoints | Two steering sources fight |
| Can't reach strategic positions | `STRATEGIC_POSITIONS` includes points near platforms at (-38,-38), (38,38) | Likely unreachable in runtime navmesh |
| "Completes" hunt without moving | `MoveToPositionGoal.execute` marks COMPLETED on empty path | Silent pathfind failure |
| Keeps trying to path into walls | `EngageCombatGoal` seek target only checks `isInsideWall`, not navmesh region | Inside-wall-pushed positions can still be on isolated regions |

---

## 4. Debug tooling to add

I've built a single drop-in debug module that gives you the light-green navmesh, per-bot overlays, pathfinding logs, click-to-move, and a keyboard-toggleable panel. Below the file I'll give you the surgical fixes.## 5. Exact code changes

Below are the minimal surgical patches. The debug file goes at `src/debug/NavDebug.ts`.

### Patch A — Wire debug in `src/main.ts`

Add after the agents/pickups build, before `animate()`:

```ts
// Debug (always imported; only activates when you call initNavDebug)
import { initNavDebug, updateNavDebug } from '@/debug/NavDebug';

// ... inside init(), right before animate():
if (import.meta.env.DEV || location.search.includes('debug')) {
  initNavDebug();
}
```

And in your `GameLoop.ts` (which I don't have) add **`updateNavDebug()`** as the very last thing each frame. **While you're in that file, please verify this line exists:**

```ts
gameState.pathPlanner?.update();
```

If it doesn't, **that is hypothesis H3 confirmed**. Add it immediately after `entityManager.update(delta)`.

### Patch B — Fix `ObstacleAvoidance` weights (`src/world/Arena.ts`)

The `yukaObs` sphere radii are far too large for non-square walls. Replace the two `ob.boundingRadius` lines:

```ts
// In addWall(): OLD
ob.boundingRadius = Math.max(w, d) * 0.6;
// NEW — use the *smaller* half-axis; large walls are modeled as many sparse obstacles, not one huge sphere
ob.boundingRadius = Math.min(w, d) * 0.5 + 0.35;

// In addPillar(): OLD
ob.boundingRadius = r + 0.5;
// NEW — a tighter fit; avoidance lookahead already pads this
ob.boundingRadius = r + 0.15;
```

### Patch C — Lower `ObstacleAvoidance` weight (`src/entities/AgentFactory.ts`)

```ts
// OLD
ag.avoidB.weight = 3;
// NEW — keep avoidance as an override only when actually on collision course, not a constant shove
ag.avoidB.weight = 1.2;
```

### Patch D — Have combat goals own their path state (`src/ai/goals/Goals.ts`)

Three small edits. Each one calls `navRuntime.clearPath()` on activate so no stale FollowPath survives:

```ts
// EngageCombatGoal.activate():
activate(): void {
  const ag = this.owner;
  ag.stateName = 'ENGAGE';
  ag.stateTime = 0;
  ag.navRuntime.clearPath();    // <-- add
  this.status = YUKA.Goal.STATUS.ACTIVE;
}

// PeekGoal.activate(): add the same clearPath() call at the end
// TeamPushGoal.activate(): add the same clearPath() call at the end
```

### Patch E — `MoveToPositionGoal` must FAIL on empty path (`src/ai/goals/Goals.ts`)

```ts
execute(): void {
  const ag = this.owner;
  if (ag.wanderB) ag.wanderB.weight = ag.navRuntime.path ? 0 : 1.0;
  if (ag.pursuitB) ag.pursuitB.weight = 0;
  if (ag.fleeB) ag.fleeB.weight = 0;
  if (ag.seekB) ag.seekB.weight = 0;
  if (ag.arriveB) ag.arriveB.weight = 0;

  if (!ag.navRuntime.path && !ag.navRuntime.pathPending) {
    // OLD: this.status = YUKA.Goal.STATUS.COMPLETED;
    // NEW: it never moved — fail so HuntGoal.replanIfFailed picks a different target
    this.status = YUKA.Goal.STATUS.FAILED;
  }
  if (ag.stateTime > 8) {
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}
```

Same fix is worth applying to `RetreatGoal`, `FlankGoal`, `TakeCoverGoal`, `SeekPickupGoal`, `HoldAngleGoal` — they all currently treat "no path found" as success. Change their post-path-fail status from `COMPLETED` to `FAILED` in the same way.

### Patch F — `NavMeshBuilder.ts` respect `yTop` (walk-on-top colliders)

```ts
// In the cell-marking loop, add the yTop check BEFORE the 'box' / circle tests:
for (const col of gameState.arenaColliders) {
  // Walk-on-top colliders (platforms, ramp steps) are not obstacles at navmesh level
  if (col.yTop !== undefined && col.yTop > 0) continue;   // <-- add

  if (col.type === 'box') {
    // ... unchanged
  }
}
```

This alone should reconnect the four platform "holes" and make the navmesh a single island.

### Patch G — Ensure `pathPlanner.update()` runs (likely needed in `GameLoop.ts`)

Somewhere after `entityManager.update(delta)` and before you call AI updates:

```ts
gameState.pathPlanner?.update();   // drain pending path requests
```

Without this, nothing gets paths.

### Patch H — Also update `navRuntime` every frame

After `entityManager.update(delta)`, loop through bots and call their runtime update. `AIController.updateAI` has a comment that says clamping is done in GameLoop; that implies something like:

```ts
for (const ag of gameState.agents) {
  if (ag === gameState.player || ag.isDead) continue;
  ag.navRuntime?.update();    // clampMovement + height correction + arrival check
}
```

If this loop is missing, bots are moving but never being clamped to the navmesh. Verify.

---

## 6. Why each change is needed

- **A**: Gives you eyes. Without it you're debugging blind.
- **B, C**: H1. The 3× weight on a too-large sphere makes avoidance the dominant force, which shoves bots away from walls they aren't going to hit. Cutting weight and sphere size lets Seek/FollowPath actually control direction.
- **D**: H2. Stops stale FollowPath waypoints from fighting Seek during combat transitions.
- **E**: H5. A silent no-path failure that looks like success is an invisible failure mode. Marking it FAILED lets `replanIfFailed` pick a new target.
- **F**: H4. Platforms stop being holes in the navmesh, islands collapse into one component, many unreachable regions become reachable.
- **G, H**: H3. If these aren't wired, **no pathfinding happens at all** and no navmesh clamping corrects drift. Whether it's wired is the single most important thing to verify.

---

## 7. Validation / test plan

Run the game with `?debug` in the URL and check these in order:

1. **Press F1** — is the light-green navmesh there, and is it where you expect? If it doesn't cover the arena floor, your baked navmesh is wrong; delete `arena_navmesh.gltf` so `NavMeshBuilder` runs, then reload.
2. **Press F2** — are there multiple colors? If yes, you have disconnected islands. After Patch F, this should show ONE color everywhere except legitimately isolated areas.
3. **Read the top panel stats** — `islands: 1 (main: N)` is the goal. `queue.len` should hover near 0; if it grows unboundedly, Patch G is needed.
4. **Press F3** — each bot should have a cyan path line. If every bot's panel says `path: none` forever, Patch G is needed.
5. **Press F4, then F6 through bots** — watch the log. You should see `[Path] Name from=… to=… waypoints=N`. `waypoints=0 ⚠UNREACHABLE` lines point at bad target selection; `from [off-navmesh]` lines mean a spawn/clamp bug.
6. **Press F5, then click somewhere on the navmesh** — selected bot should reroute there immediately. This isolates the *navigation* system from *AI decision making*. If click-to-move works but normal play is broken, the issue is in goals/evaluators, not in navigation. If click-to-move is also broken, it's navmesh/steering.
7. **Watch `steerings:` in the panel for a selected bot** — the list should be short during combat. If you see `FollowPathBehavior` AND `SeekBehavior` both present while engaging, Patch D isn't in yet.

### What should disappear after the fixes land

- "Running in opposite direction near walls" → gone after B + C
- "Bots frozen in the open" → gone after G (and possibly H)
- "Oscillating near corners" → reduced after B + C + D
- "Bot says it reached hunt target but didn't move" → gone after E
- Pickups/cover points at platform corners being unreachable → gone after F

### Remaining symptoms and what they mean

- If bots still pick bizarre hunt targets, the problem is in `findHuntTarget()` scoring, not navigation.
- If pathing is fine but aim is off, the issue is `HumanAim.ts`, not this system.
- If click-to-move works perfectly but auto-play bots wander aimlessly, evaluators' desirabilities need tuning — that's a separate, higher-level problem and the debug panel will already show it (`goal: PatrolGoal` forever when enemies are visible = AttackEvaluator desirability too low).

---

## 8. Optional further improvements for more human-like bots

These only make sense AFTER the basics land; don't stack changes:

1. **Path smoothing** — YUKA returns string-pulled polylines, which produce sharp turns at portal midpoints. A Chaikin-style 2-iteration smoother inside `applyPath()` (the YUKA showcase does this implicitly via `OnPathBehavior`) dramatically improves readability.
2. **Goal commitment stickiness** — you already have `commitmentUntil`. Raise the base commitment for Hunt/SeekPickup goals to ~1.5–2s so bots don't thrash between goals when desirabilities are close.
3. **Steering weight scheduler** — right now every goal sets weights imperatively in `execute()` and they can conflict subtly. Consider a single `SteeringProfile` object per goal with a typed shape (`{ wander, seek, pursuit, flee, arrive, followPath, onPath, avoid }`) that `execute()` applies in one atomic step. Eliminates entire classes of "forgot to zero that one" bugs.
4. **Spatial hash for perception staggering** — `countNearbyAllies` and the audio scan loops are O(N) per bot per frame; fine at 12 bots but you've noted bigger ambitions.
5. **Peek realism** — currently `PeekGoal` moves the bot toward target by 3 units from cover. That's a shuffle, not a peek. A proper peek arcs laterally past the cover edge based on which side of `ag.currentCover` the threat is on.
6. **Bake the navmesh properly once it's working** — runtime-building is fine for development, but bake it from Blender/Recast once and ship the GLTF. Your `whatWeLearned.md` already arrived at this conclusion; stick with it.

The debug file is saved and ready to drop into `src/debug/NavDebug.ts`:### Two honest caveats before you start

1. **I cannot 100% confirm H3 (missing `pathPlanner.update()`) or H8 (missing `navRuntime.update()` loop) without seeing `GameLoop.ts`.** These are the two cheapest things to check and the ones most likely to be the immediate blocker. Grep your code for `pathPlanner.update` first — if it returns zero hits, that is almost certainly why your bots stand still.

2. **The order I'd apply things in.** Do A first (debug visibility), then verify G and H (path planner and runtime updates actually run), then B+C (avoidance), then D (steering cleanup), then E (path-fail semantics), then F (navmesh holes). Don't try to land them all at once — the debug panel will tell you which layer still has a problem.