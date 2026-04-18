# Deep Analysis Report #2

Second comprehensive audit of the full codebase after all 47 findings from deepAnalysis.md were addressed. All findings below are verified against actual source code.

---

## CRITICAL

### 1. Shared decal geometry disposed — corrupts all bullet holes after 64
**File:** `src/combat/Particles.ts` ~L430-445  
**Issue:** `_decalGeo` is a single shared `BufferGeometry` used by all bullet hole decals. When the decal pool exceeds 64, old decals are evicted with `old.geometry.dispose()`. Since all decals share the same geometry, this disposes the geometry for ALL decals — subsequent rendering of any decal produces WebGL errors or invisible meshes.  
**Fix:** Either clone the geometry per decal, or skip `geometry.dispose()` on eviction (just remove from scene).

### 2. Raycaster.far never reset after hearing checks — breaks all bot vision
**File:** `src/ai/ContextualPerception.ts` L179  
**Issue:** `gameState.raycaster.far = dist` is set during hearing proximity checks, but never reset to `Infinity`. The shared raycaster is then used by `isOccluded()` in `Perception.ts`, which does NOT set `.far`. After any hearing check, all subsequent bot vision raycasts use a stale `.far` value — bots may fail to see enemies beyond that distance, or false-positive see through walls at short range.  
**Fix:** Reset `gameState.raycaster.far = Infinity` after the hearing raycast (or before `isOccluded`).

### 3. Rocket/grenade meshes leak geometry, material, and lights
**File:** `src/combat/Hitscan.ts` ~L311, L352, L362  
**Issue:** When rockets and grenades are removed from the scene (`scene.remove(mesh)`), their geometry, material, and child PointLights are never disposed. Each rocket creates a `CylinderGeometry`, `MeshStandardMaterial`, and `PointLight`. Each grenade creates a `SphereGeometry` and `MeshStandardMaterial`. Over a match, this leaks GPU memory continuously.  
**Fix:** Dispose geometry, material, and remove/dispose PointLight children before `scene.remove()`.

### 4. GameLoop merge artifact — nameTag visibility immediately overwritten  
**File:** `src/core/GameLoop.ts` L307  
**Issue:** Line 307 contains a merge artifact where two statements are on the same line: `if (ag.nameTag) ag.nameTag.visible = d2 < 35 * 35;if (ag.nameTag) {`. The first assignment (`visible = d2 < 35*35`) is immediately overwritten by the second block which sets visibility based on a 5-22m spotting range. The first condition is dead code.  
**Fix:** Remove the first `if (ag.nameTag) ag.nameTag.visible = d2 < 35 * 35;` statement entirely.

---

## HIGH

### 5. Bullets.ts is entirely dead code
**File:** `src/combat/Bullets.ts` (entire file)  
**Issue:** `spawnBullet` and `updateBullets` are exported but never imported anywhere in the codebase. The entire projectile-bullet system (firing, raycasting, hit detection, tracers) is unused — all weapons use the hitscan system in `Hitscan.ts` instead.  
**Fix:** Delete the file, or keep it clearly marked as unused/future.

### 6. Match memory never cleared between rounds
**File:** `src/ai/MatchMemory.ts` L75  
**Issue:** `clearMatchMemory()` is exported but never called anywhere. Zone danger scores, team kill timestamps, and engagement data accumulate indefinitely across match restarts.  
**Fix:** Call `clearMatchMemory()` from `resetMatch()` in `Combat.ts`.

### 7. Player engagement tracking is dead code
**File:** `src/ai/MatchMemory.ts` L49  
**Issue:** `registerPlayerEngagement()` and `getPlayerHotZone()` are exported but never imported. The entire player-camping-detection subsystem is unwired.  
**Fix:** Wire into kill/engagement flow, or remove.

### 8. Duplicate bot name "Blaze" across both teams
**File:** `src/entities/AgentFactory.ts` ~L185-200  
**Issue:** "Blaze" appears in both `blueNames` and `redNames` arrays. Since `enemyMemory` in the AI system is keyed by agent name, two agents named "Blaze" on opposing teams will have their memory entries collide, causing incorrect threat tracking.  
**Fix:** Rename one of them.

### 9. FloatingDamage shared canvas corrupts multi-hit textures
**File:** `src/ui/FloatingDamage.ts` ~L30  
**Issue:** A single `_canvas` HTMLCanvasElement is reused for all damage number textures. If `spawnDamageNumber` is called multiple times in the same frame (e.g., shotgun pellets, explosion + bullet), the canvas is overwritten before previous textures are uploaded to GPU. Result: wrong numbers displayed on some damage popups.  
**Fix:** Create a small canvas pool, or create a new canvas per call and dispose after upload.

### 10. Spread accumulation not reset on weapon switch
**File:** `src/core/EventManager.ts` ~L125-170  
**Issue:** `pSpreadAccum` (hipfire bloom) is not reset when `switchWeapon()` is called. If a player fires a rapid weapon, building up spread, then switches to a sniper, the sniper inherits the accumulated bloom.  
**Fix:** Reset `gameState.pSpreadAccum = 0` in `switchWeapon()`.

### 11. Smoke clouds persist across match restarts  
**File:** `src/combat/Hitscan.ts` L406  
**Issue:** `_smokeClouds` array is module-level and never cleared on match reset. Active smoke grenades from the previous match remain visible and functional (blocking sight lines) in the new match.  
**Fix:** Add a reset function that clears `_smokeClouds` (removing meshes from scene) and call it from `resetMatch`.

### 12. Flash timer persists across match restarts
**File:** `src/combat/Hitscan.ts` L460  
**Issue:** `_flashTimer` is module-level and never reset on match restart. If a player is flashed at match end, the flash overlay persists into the next match.  
**Fix:** Reset `_flashTimer = 0` and hide the flash overlay element on match reset.

### 13. Visuals.ts nameTag non-null assertion crash
**File:** `src/rendering/Visuals.ts` L57  
**Issue:** `ag.nameTag!.visible = vis && !ag.isDead;` uses a non-null assertion, but `nameTag` is typed as `THREE.Sprite | null` and initialized to `null`. If `updateAgentVisuals` runs before agent factory sets up the nameTag (possible during async loading), this crashes.  
**Fix:** Use optional chaining: `ag.nameTag?.visible` or guard with `if (ag.nameTag)`.

### 14. Pause-menu restart skips medal and challenge reset
**File:** `src/ui/Menus.ts` L67  
**Issue:** `pauseRestart.onclick` calls only `resetMatch(gameState.mode)`. Compare with `startMatchFromMenu()` which also calls `resetMatchMedals()` and `rollChallenges(3)`. Restarting from pause leaves stale medals and completed challenges from the previous round.  
**Fix:** Add `resetMatchMedals()` and `rollChallenges(3)` to the pause-restart handler.

### 15. DBNO bleedout credits wrong killer
**File:** `src/combat/Combat.ts` ~L768  
**Issue:** When the player bleeds out during DBNO (Down But Not Out), `playerDied(gameState.player.lastAttacker)` is called, but `lastAttacker` is never set in `dealDmgPlayer` — it remains whatever it was from a previous death. The kill is credited to the wrong agent.  
**Fix:** Set `gameState.player.lastAttacker = attacker` in `dealDmgPlayer`.

### 16. Objectives mesh non-null assertion crash
**File:** `src/combat/Objectives.ts` L38  
**Issue:** `mesh!` non-null assertion will crash if `updateObjectiveVisibility()` is called before `buildObjectives()` creates the meshes (e.g., during mode setup ordering).  
**Fix:** Guard with `if (!mesh) return`.

### 17. Player cannot pick up ground pickups
**File:** `src/combat/Pickups.ts` L209  
**Issue:** The pickup proximity loop explicitly skips `gameState.player` with a `continue` statement. Bots can pick up ground items but the player cannot. No alternative pickup mechanism was found for the player.  
**Fix:** Remove the player skip, or implement a separate player pickup system (e.g., key-press interaction).

### 18. _lastHitWasHeadshot never cleaned on player agent  
**File:** `src/combat/Hitscan.ts` L106  
**Issue:** `(hitAgent as any)._lastHitWasHeadshot = isHeadshot` is set when the player is hit, but unlike bot agents (cleaned at L373), it's never deleted from the player. This stale flag can cause incorrect headshot indicators on subsequent hits.  
**Fix:** Delete/reset `_lastHitWasHeadshot` on the player after it's consumed.

### 19. BR stuck detector fires during endgame hold
**File:** `src/br/BRBots.ts` L786  
**Issue:** Bots holding position during BR endgame (standing still at their hold point) trigger the stuck detection after 1.2s of no movement. The stuck handler overrides the hold behavior, making bots abandon their tactical position.  
**Fix:** Skip stuck detection when bot is in `holdPosition` state.

---

## MEDIUM

### 20. POTG kill times never pruned
**File:** `src/combat/Combat.ts` ~L87  
**Issue:** `potgKillTimes` map stores every kill timestamp for every agent. While `times.filter(t => t >= cutoff)` is used for scoring, the original array is never pruned. In long matches with many kills, the array grows unbounded and the filter scans more entries each time.  
**Fix:** Prune entries older than `POTG_WINDOW` after each scoring pass.

### 21. Killcam shared target variable
**File:** `src/ui/Killcam.ts`  
**Issue:** The Killcam and Play-of-the-Game (POTG) systems share a `target` variable. Triggering POTG during a killcam (or vice versa) clobbers the camera target, causing the camera to snap to the wrong agent.  
**Fix:** Use separate target variables for each system.

### 22. HUD weapon class icon reparsed every frame
**File:** `src/ui/HUD.ts` ~L53  
**Issue:** `wcIcon.innerHTML` is set to an SVG string on every `updateHUD()` call, even when the weapon class hasn't changed. This forces the browser to re-parse and re-render the SVG every frame.  
**Fix:** Cache the current class and only update `innerHTML` when it changes.

### 23. CoverSystem per-call Vector3 allocations
**File:** `src/ai/CoverSystem.ts` L121  
**Issue:** `new YUKA.Vector3()` is allocated per cover point per `findCoverFrom()` call (~30 allocations per bot decision cycle). With 12 bots making frequent cover decisions, this creates significant GC pressure.  
**Fix:** Pre-allocate a temp vector at module scope and reuse it.

### 24. Goal system per-frame Vector3 allocations
**File:** `src/ai/goals/` (EngageCombat, Retreat, TeamPush, Peek goals)  
**Issue:** Multiple goals allocate `new YUKA.Vector3()` every frame in their `execute()` methods. With 12 bots each running goals at 60fps, this creates hundreds of allocations per second.  
**Fix:** Pre-allocate temp vectors at module scope.

### 25. AgentAnimations per-frame allocations
**File:** `src/rendering/AgentAnimations.ts`  
**Issue:** `new THREE.Vector3()` and `new THREE.Euler()` are created per agent per frame in the animation update loop.  
**Fix:** Use module-level temp objects.

### 26. Killcam per-frame allocations
**File:** `src/ui/Killcam.ts`  
**Issue:** `new THREE.Vector3()` per agent per frame during snapshot recording for POTG.  
**Fix:** Use a module-level temp vector.

### 27. Combat.ts wasHS variable shadowing
**File:** `src/combat/Combat.ts` ~L298/L307  
**Issue:** An inner `wasHS` declaration shadows the outer one, making the outer headshot check invisible within the inner scope. May cause incorrect headshot tracking in certain code paths.  
**Fix:** Rename the inner variable or restructure the logic.

### 28. Wallbang uses hardcoded 0.55 instead of BODY_HIT_RADIUS
**File:** `src/combat/Hitscan.ts` L172  
**Issue:** `bodyDist < 0.55` uses a magic number. `BODY_HIT_RADIUS` is already imported and equals `0.55`. If the constant is ever changed, wallbang hit detection will be out of sync.  
**Fix:** Replace `0.55` with `BODY_HIT_RADIUS`.

### 29. Grenade throw speed and fuse time hardcoded
**File:** `src/combat/Hitscan.ts`  
**Issue:** Grenade throw speed uses hardcoded `18` and fuse timer uses `life=2.5` instead of referencing `GRENADE_CONFIG.throwSpeed` and `GRENADE_CONFIG.fuseTime`. If config values are tuned, the actual behavior won't change.  
**Fix:** Use the config constants.

### 30. Smoke puff geometries are unique per explosion
**File:** `src/combat/Particles.ts` ~L310  
**Issue:** Each smoke puff uses `new SphereGeometry(0.3 + Math.random() * 0.4, ...)` with a random radius, creating a unique geometry per puff. These cannot be pooled or shared. A single explosion creates ~8 puffs.  
**Fix:** Use a fixed-size geometry and vary scale via `mesh.scale` instead.

### 31. Blood splatter material cloned but never disposed
**File:** `src/combat/Particles.ts` ~L475  
**Issue:** Blood splatter material is `_bloodMat.clone()` per splatter but the cloned material is never disposed when the splatter is removed.  
**Fix:** Dispose material on removal.

### 32. Shell casing material cloned but never disposed
**File:** `src/combat/Particles.ts` ~L141  
**Issue:** Same pattern as blood splatters — shell casing material is cloned per casing and never disposed.  
**Fix:** Dispose material on removal.

### 33. TDMAgent confidence not reset in resetTacticalState
**File:** `src/entities/TDMAgent.ts`  
**Issue:** `resetTacticalState()` resets many tactical fields but not `confidence`. A bot that built up high confidence in one life carries it into the next spawn.  
**Fix:** Reset `this.confidence = 0.5` (or default) in `resetTacticalState()`.

### 34. PatrolGoal time domain mismatch
**File:** `src/ai/goals/` ~L56  
**Issue:** `teamCalloutTime` is compared against `stateTime` but they use different time domains — `teamCalloutTime` uses world-elapsed time while `stateTime` is goal-local duration. The comparison may never or always trigger depending on match progress.  
**Fix:** Use consistent time references.

### 35. AITypes dead interfaces
**File:** `src/ai/AITypes.ts`  
**Issue:** `TeamTacticalBoard`, `TeamCallout`, and `EnemyMemory` interfaces are defined but never used — they were superseded by other definitions during development.  
**Fix:** Remove the dead interfaces.

### 36. TeamIntent unused values
**File:** `src/ai/AITypes.ts`  
**Issue:** `TeamIntent` type includes `'flank_left' | 'flank_right'` but these values are never assigned anywhere in the codebase. They add dead branches to any switch/if that handles them.  
**Fix:** Remove the unused values.

### 37. _pinchTarget allocated every collapse tick
**File:** `src/ai/AIController.ts` L123  
**Issue:** `_pinchTarget` is a `new YUKA.Vector3()` allocated on every BR zone-collapse tick for all bots.  
**Fix:** Pre-allocate at module scope.

### 38. BR DropPlane meshes not disposed on reset
**File:** `src/br/DropPlane.ts`  
**Issue:** `resetDrop()` removes plane meshes from the scene but does not dispose their geometries and materials (~26 child meshes per plane). Each BR match start leaks the previous plane's GPU resources.  
**Fix:** Traverse children and dispose geometry/material before removing.

### 39. BR SupplyDrop meshes not disposed on cleanup
**File:** `src/br/SupplyDrops.ts`  
**Issue:** Supply drop cleanup removes meshes without disposing ShaderMaterial, geometries, and PointLight for each drop.  
**Fix:** Dispose all GPU resources on cleanup.

### 40. BR BRBots renderComponent not disposed on clear
**File:** `src/br/BRBots.ts` L296  
**Issue:** `clearBRBots()` removes each bot's renderComponent from the scene but doesn't dispose child geometries and materials (29 bots × multiple meshes per bot).  
**Fix:** Traverse and dispose before removing.

### 41. BR BRBots LOD mesh swap leaks old mesh
**File:** `src/br/BRBots.ts` L327  
**Issue:** When swapping between LOD levels (high-detail ↔ low-detail), the old skeletal mesh children are removed but not disposed.  
**Fix:** Dispose old mesh's geometry/material on LOD swap.

### 42. Vehicle collision ignores circle colliders
**File:** `src/br/Vehicles.ts` L301  
**Issue:** Vehicle–world collision only checks `c.type === 'box'` colliders. Trees and rocks using `type: 'circle'` colliders are completely ignored — vehicles drive straight through them.  
**Fix:** Add circle collider distance check: `dx*dx + dz*dz < (c.r + vehicleRadius)²`.

### 43. LootSystem render slot children not disposed
**File:** `src/br/LootSystem.ts` ~L267  
**Issue:** When reassigning loot visuals to inventory slots, old render children are removed but geometries/materials are not disposed.  
**Fix:** Dispose before removing.

### 44. LootSystem grenade quantity always 1
**File:** `src/br/LootSystem.ts` ~L487  
**Issue:** Grenade loot quantity is `Math.random() * 1 | 0` which always evaluates to `0` (bitwise OR floors the `0.xxx` result). The intent was likely `(Math.random() * 3 | 0) + 1` or similar.  
**Fix:** Fix the random range expression.

### 45. BRController startBRMatch has no double-call guard
**File:** `src/br/BRController.ts`  
**Issue:** `startBRMatch()` is `async` but has no guard against being called while already running. Fast double-clicks on the start button can launch two overlapping BR matches.  
**Fix:** Add an `isStarting` flag guard.

### 46. BRHUD zone bar uses hardcoded divisor
**File:** `src/br/BRHUD.ts`  
**Issue:** Zone timer bar width uses hardcoded divisor `80` instead of the actual zone duration. A `total` variable is computed from zone config but never used in the width calculation.  
**Fix:** Use the `total` variable for the bar width calculation.

### 47. BRBots redundant zone pressure check
**File:** `src/br/BRBots.ts` L551  
**Issue:** A second zone-pressure condition is unreachable because the first condition already covers that case — the `else if` branch can never execute.  
**Fix:** Remove the redundant branch.

---

## LOW

### 48. Minimap spotting raycasts are O(enemies × allies) per frame
**File:** `src/ui/Minimap.ts`  
**Issue:** The `canSee` spotting check performs raycasts for every enemy–ally pair every frame. With 6v6, that's up to 36 raycasts per frame just for minimap dots.  
**Impact:** Performance — consider throttling to every 5-10 frames.

### 49. WeaponViewmodel debug tuner code in production
**File:** `src/rendering/WeaponViewmodel.ts`  
**Issue:** ~100 lines of debug tuner UI code (dat.GUI style position/rotation sliders) are compiled into every production build. They're gated behind a `tunerEnabled` flag but the code and imports still exist.  
**Impact:** Bundle size — consider extracting behind `import.meta.env.DEV` guard.

### 50. CoverSystem _pushResult declared but unused
**File:** `src/ai/CoverSystem.ts` L9  
**Issue:** `_pushResult` module-level temp YUKA.Vector3 is declared but never referenced.  
**Fix:** Remove.

### 51. ContextualPerception _temp declared but unused
**File:** `src/ai/ContextualPerception.ts` L32  
**Issue:** `_temp` YUKA.Vector3 is declared at module scope but never used.  
**Fix:** Remove.

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 4 |
| HIGH | 15 |
| MEDIUM | 28 |
| LOW | 4 |
| **Total** | **51** |

### Top Priority Fixes (highest gameplay/stability impact):
1. **#2** — Raycaster.far corruption (breaks ALL bot AI vision)
2. **#1** — Shared decal geometry disposal (visual corruption + WebGL errors)
3. **#4** — GameLoop merge artifact (nameTag logic broken)
4. **#15** — DBNO kills credited to wrong agent
5. **#8** — Duplicate "Blaze" name (corrupts enemy memory)
6. **#10** — Spread carries across weapons (gameplay feel)
7. **#6** — Match memory never cleared (AI degrades over time)
8. **#3** — Rocket/grenade GPU memory leak (performance degradation)
