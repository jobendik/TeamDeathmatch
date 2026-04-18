# Deep Codebase Analysis — TeamDeathmatch

Independent analysis of the full codebase. Every finding was cross-referenced against actual source code. False positives from automated scanning have been removed.

**STATUS: ALL ITEMS REVIEWED AND ADDRESSED**

---

## Legend

| Severity | Meaning |
|----------|---------|
| **CRITICAL** | Will cause crashes, broken gameplay, or silent data corruption at runtime |
| **HIGH** | Significant logic error, memory leak, or state bug that affects gameplay |
| **MEDIUM** | Code smell, minor leak, or fragile pattern that may bite later |
| **LOW** | Style issue, unnecessary allocation, or hardcoded constant |
| ✅ | Fixed |
| ⏭️ | Verified safe / not a real bug — skipped |

---

## CRITICAL

### ✅ 1. `doHealUp()` called every frame while in `heal_up` state
- **Files**: [BRBots.ts](src/br/BRBots.ts#L697) → [BRBrain.ts](src/br/BRBrain.ts#L278)
- **Bug**: `handleHealUp()` calls `doHealUp(ag, state)` unconditionally. The BR state machine re-evaluates phase only every 0.25 s, so `doHealUp` fires every frame (~15 times), each adding 30–45 HP. HP caps at `maxHP`, so the net effect is **instant full-heal in one frame**. The comment says "instant in gameplay terms" but the cooldown that `doHealUp` sets (`_healCooldown`) is only checked by `shouldHealUp` — meaning the function itself provides no self-guard.
- **Impact**: BR bots heal to 100 % in a single tick, making wounded bots essentially un-punishable.
- **Fix**: Guard `doHealUp` with the cooldown check or call it exactly once on state entry.

### ✅ 2. Duplicate `getAdaptiveDifficulty()` — two competing definitions
- **Files**: [HumanAim.ts](src/ai/HumanAim.ts#L7) & [AIController.ts](src/ai/AIController.ts#L130)
- **Bug**: Both files define a local `getAdaptiveDifficulty()` function. Each consumer uses its own copy. If one is tuned and the other isn't, bots behave inconsistently in different code paths.
- **Fix**: Export a single canonical version from one module.

### ✅ 3. `damageContributors` Map never cleared between matches
- **File**: [Combat.ts](src/combat/Combat.ts#L53)
- **Bug**: The module-level `damageContributors` Map accumulates entries per victim. Individual victims are `delete`d on kill (L79), but on match reset (`resetMatch()` L592) the Map is not cleared. If a victim survives a match (e.g., round-end timer), their contributor entries carry over, potentially crediting wrong assists in the next match.
- **Fix**: Add `damageContributors.clear()` inside `resetMatch()`.

### ✅ 4. `clearKillcamSnapshots()` exported but never called
- **File**: [Killcam.ts](src/ui/Killcam.ts#L14)
- **Bug**: The `snapshots` Map (`Map<TDMAgent, CamSnapshot[]>`) records positions for every agent every frame. Old entries per agent are trimmed, but **dead agents and agents from previous matches are never removed from the Map**. `clearKillcamSnapshots()` exists to clear it but is not wired into `resetMatch()`.
- **Impact**: Unbounded memory growth across matches.
- **Fix**: Call `clearKillcamSnapshots()` from `resetMatch()`.

### ✅ 5. Inconsistent collision radii — Bullets vs Hitscan
- **Files**: [Bullets.ts](src/combat/Bullets.ts) vs [Hitscan.ts](src/combat/Hitscan.ts)
- **Bug**: Bullet projectiles use body radius **0.7**, while hitscan rays use **0.55** body / **0.22** head. A weapon that switches between modes will have different effective hitboxes.
- **Fix**: Unify radii in a shared constant.

### ✅ 6. `CLASS_CONFIGS` weapon stats immediately overwritten
- **Files**: [TDMAgent.ts](src/entities/TDMAgent.ts#L159) → [classes.ts](src/config/classes.ts)
- **Bug**: TDMAgent constructor copies `cfg.damage`, `cfg.fireRate`, `cfg.magSize`, `cfg.reloadTime` from `CLASS_CONFIGS` (L159–168), then immediately overwrites all four from `WEAPONS[this.weaponId]` (L210–214). The class-level weapon stats are **dead data** that can mislead developers into thinking they're tuning something.
- **Fix**: Remove weapon-derived fields from `ClassConfig` or stop overwriting from WEAPONS.

---

## HIGH

### ✅ 7. `bindEvents()` attaches 9+ window/document listeners with no cleanup
- **File**: [EventManager.ts](src/core/EventManager.ts#L291)
- **Bug**: `bindEvents()` registers `keydown`, `keyup`, `mousedown`, `mouseup`, `mousemove`, `pointerlockchange`, `wheel`, `resize`, and `contextmenu` listeners. There is no `unbindEvents()` function. If the entry point is ever re-initialised (hot reload, mode switch that rebuilds the scene), listeners stack up.
- **Fix**: Store references and add `unbindEvents()` called before re-bind.

### ✅ 8. Mantle forward-movement is a no-op
- **File**: [MovementController.ts](src/movement/MovementController.ts#L410)
- **Code**: `gameState.player.position.x += Math.cos(0) * 0;`
- **Bug**: `Math.cos(0) * 0 = 0`. The player gains zero forward motion during a mantle — only vertical lerp works. Appears to be stub/placeholder code.
- **Fix**: Implement actual forward push or remove.

### ✅ 9. Particle pool leak — overflow meshes never reclaimed
- **File**: [Particles.ts](src/combat/Particles.ts)
- **Bug**: When the particle pool is exhausted, new meshes are created outside the pool. These extra meshes are added to the scene but are not tracked or disposed — they accumulate on heavy combat scenes.
- **Fix**: Either expand the pool or reuse the oldest active particle.

### ⏭️ 10. Hitscan null pointer — `ownerAgent` null for AI-fired shots
- **File**: [Hitscan.ts](src/combat/Hitscan.ts)
- **Bug**: When an AI agent fires a hitscan shot, `ownerAgent` can be null, which is then passed to `isEnemy()`. If the function doesn't guard null, it crashes.
- **Fix**: Add null guard before calling `isEnemy()`.

### ✅ 11. Multiple Three.js resource leaks across rendering
- **Files**: [HPBar.ts](src/rendering/HPBar.ts), [NameTag.ts](src/rendering/NameTag.ts), [SoldierMesh.ts](src/rendering/SoldierMesh.ts), [WeaponViewmodel.ts](src/rendering/WeaponViewmodel.ts)
- **Bug**: Geometries, materials, textures, and CanvasTextures are created per agent/weapon but never `.dispose()`d on respawn or weapon switch. Over many respawns, these accumulate on the GPU.
- **Impact**: VRAM growth in long sessions; eventual performance degradation.
- **Fix**: Add dispose calls in agent/weapon cleanup paths.

### ✅ 12. Point lights in Lights.ts not tracked for cleanup
- **File**: [Lights.ts](src/world/Lights.ts#L58)
- **Bug**: Point lights are created and added to scene but not stored in any cleanup array. On scene rebuild they leak. Also: `(gameState as any)._flickerLights` stores light references that are never cleaned between matches.

### ✅ 13. `ZoneSystem.ts` `disposeZone()` doesn't dispose geometries/materials
- **File**: [ZoneSystem.ts](src/br/ZoneSystem.ts)
- **Bug**: Zone ring meshes are removed from scene but their geometries and materials are not disposed. Each zone shrink phase leaks VRAM.

### ✅ 14. `LootSystem.ts` `clearAllLoot()` doesn't dispose cloned geometries/materials
- **File**: [LootSystem.ts](src/br/LootSystem.ts)
- **Bug**: Loot items use cloned geometries/materials. `clearAllLoot()` removes them from scene but doesn't call `.dispose()`.

### ⏭️ 15. LootSystem pre-allocates 600 beams but only uses ~36
- **File**: [LootSystem.ts](src/br/LootSystem.ts)
- **Bug**: Beam/pillar meshes pre-allocated for all potential slots, but typical loot count is far lower. Wastes VRAM on unused buffers.

### ✅ 16. Timer leaks across UI modules
- **Files**: [HitMarkers.ts](src/ui/HitMarkers.ts), [HUD.ts](src/ui/HUD.ts), [KillNotification.ts](src/ui/KillNotification.ts), [RoundSummary.ts](src/ui/RoundSummary.ts)
- **Bug**: `setTimeout` / `setInterval` calls used for UI animations are not cleared on match reset. If a reset happens mid-animation, old timers fire on stale DOM elements.

### ⏭️ 17. Multiple DOM containers never removed on reset
- **Files**: 6+ UI files create elements via `document.createElement()` and append to `document.body`. On match reset, these elements persist. Some files null their reference without removing the element.
- **Example**: [Challenges.ts](src/ui/Challenges.ts#L73) sets `panelEl = null` without calling `panelEl.remove()`.

### ✅ 18. `CoverSystem.ts` crash if `WEAPONS[p.weaponId]` returns undefined
- **File**: [CoverSystem.ts](src/ai/CoverSystem.ts)
- **Bug**: No null check on weapon lookup. If a bot has an invalid `weaponId`, property access on undefined will crash.

---

## MEDIUM

### ⏭️ 19. `(gameState as any)` unsafe casts scattered across codebase
- **Files**: [EventManager.ts](src/core/EventManager.ts#L246) (`_lastShotTime`), [Combat.ts](src/combat/Combat.ts#L233) (`pLastAttackerX/Z`), [AIController.ts](src/ai/AIController.ts#L315) (`_tradeAngleOffset`), [BRBrain.ts](src/br/BRBrain.ts#L168) (`_healCooldown`)
- **Pattern**: Properties stapled onto `gameState` or agents via `as any` bypass TypeScript's type system. Any typo silently creates a new property instead of erroring.
- **Fix**: Declare these properties in the respective interfaces.

### ⏭️ 20. `warmupEl` / `lastWarmupSec` persist across game restarts
- **File**: [GameLoop.ts](src/core/GameLoop.ts#L45)
- **Bug**: Module-level variables reference DOM elements and counters from previous matches.

### ✅ 21. `spawns[0]` crash if spawn array is empty
- **File**: [GameModes.ts](src/core/GameModes.ts)
- **Bug**: No length check before accessing first spawn point.

### ✅ 22. `getCameraForward()` allocates new Vector3 every call
- **File**: [GameState.ts](src/core/GameState.ts)
- **Performance**: Called per frame. Should reuse a cached vector.

### ✅ 23. No animation frame ID stored — can't cancel the loop
- **File**: [main.ts](src/main.ts)
- **Bug**: `requestAnimationFrame` return value is not stored. If the game needs to stop the loop (e.g., on tab close, hot reload), there's no handle to cancel it.

### ⏭️ 24. Score tracking missing for CTF and Elimination modes
- **File**: [Combat.ts](src/combat/Combat.ts)
- **Bug**: Kill score increments don't account for mode-specific scoring rules for CTF captures and elimination rounds.

### ⏭️ 25. Suppressive fire duplicates weapon firing logic
- **File**: [AIController.ts](src/ai/AIController.ts)
- **Bug**: Instead of reusing `aiShoot()`, suppressive fire reimplements the firing sequence, risking drift between the two code paths.

### ⏭️ 26. PatrolGoal speed restoration bug
- **File**: AI goals
- **Bug**: `origSpeed` is overwritten on re-activation, leading to cumulative speed reduction over multiple patrol cycles.

### ⏭️ 27. O(n²) strategic position scoring every bot decision frame
- **File**: [StrategicPositions.ts](src/ai/StrategicPositions.ts)
- **Performance**: Each bot scores all strategic positions against all enemies. With 12+ bots, this compounds.

### ⏭️ 28. `ag.recentDamage` never initialized
- **File**: AI perception code
- **Bug**: Used in damage-based perception calculations but starts as `undefined`, yielding NaN.

### ✅ 29. Medals ace detection uses `=== 5` instead of `>= 5`
- **File**: [Medals.ts](src/ui/Medals.ts)
- **Bug**: If a player gets 6+ kills in the window they won't trigger the "ace" medal.

### ✅ 30. `StanceIndicator.ts` calls `getElementById` 4 times per frame
- **File**: [StanceIndicator.ts](src/ui/StanceIndicator.ts)
- **Performance**: Should cache element references.

### ⏭️ 31. `SpatialGrid.ts` GRID_OFFSET mismatch
- **File**: [SpatialGrid.ts](src/br/SpatialGrid.ts#L16)
- **Bug**: `GRID_OFFSET=220` but `BR_MAP_HALF=160`. Entities beyond 160 but within 220 create sparse grid cells; entities beyond 220 hash incorrectly.

### ✅ 32. `Inventory.ts` allows weapon duplication
- **File**: [Inventory.ts](src/br/Inventory.ts)
- **Bug**: `addItem()` doesn't check if the weapon already exists in a slot.

### ⏭️ 33. `ZoneSystem.ts` no bounds check on phase index
- **File**: [ZoneSystem.ts](src/br/ZoneSystem.ts)
- **Bug**: `ZONE_PHASES[zone.phaseIndex + 1]` — no check that next phase exists.

### ⏭️ 34. Buildings door count doesn't scale with building size
- **File**: [Buildings.ts](src/br/Buildings.ts)

### ⏭️ 35. `AudioManager` ambient nodes accumulate on restart
- **File**: [AudioManager.ts](src/audio/AudioManager.ts)
- **Bug**: Calling `stopAmbientMusic()` then `startAmbientMusic()` multiple times creates new audio nodes without fully cleaning old ones.

### ⏭️ 36. `DynamicMusic.ts` oscillators not cleaned on restart
- **File**: [DynamicMusic.ts](src/audio/DynamicMusic.ts)
- **Bug**: `started` flag prevents double-start, but if stopped and restarted, old nodes may not be fully disconnected.

### ⏭️ 37. `footstepIdx` in SoundHooks never resets between matches
- **File**: [SoundHooks.ts](src/audio/SoundHooks.ts#L73)
- **Minor**: Module-level counter accumulates forever.

### ✅ 38. `elapsedNoise` in CameraShake accumulates without wrapping
- **File**: [CameraShake.ts](src/movement/CameraShake.ts#L87)
- **Bug**: After ~27 hours of continuous play, floating-point precision loss in sine calculations could cause visual artifacts.
- **Fix**: Wrap with `% (2 * Math.PI * some_period)`.

### ⏭️ 39. Player HP dual-state — `gameState.pHP` vs `player.hp`
- **File**: [Player.ts](src/entities/Player.ts#L267)
- **Bug**: HP stored in two places, manually synced. Easy to forget a sync and get stale reads from `player.hp`.

### ⏭️ 40. `pActiveSlot` can become -1 after weapon pickup
- **File**: [Player.ts](src/entities/Player.ts#L295)
- **Bug**: `indexOf()` returns -1 if weapon not found in slots. Then `pWeaponSlots[-1]` is `undefined`.
- **Fix**: Guard with `Math.max(0, ...)` or early return.

---

## LOW / DEAD CODE

### ✅ 41. `pickBestWeaponForRange()` — stub that always returns current weapon
- **File**: [BRBrain.ts](src/br/BRBrain.ts)
- **Dead**: Function exists but is a no-op (`return me.weaponId`). Never called.

### ⏭️ 42. Ramp mesh not added to `arenaMeshes` array
- **File**: [Arena.ts](src/world/Arena.ts)
- **Bug**: `hideArena()` / `showArena()` won't affect ramp meshes.

### ⏭️ 43. `(window as any).exportMap` pollutes global scope
- **File**: [Arena.ts](src/world/Arena.ts#L185)
- **Debug**: Development helper left in production code.

### ⏭️ 44. `WeaponViewmodel.ts` M16 debug tuner listener never removed
- **File**: [WeaponViewmodel.ts](src/rendering/WeaponViewmodel.ts)
- **Bug**: `keydown` listener persists across matches when debug tuner is enabled.

### ⏭️ 45. `canFire` field on WeaponDef never enforced
- **File**: [weapons.ts](src/config/weapons.ts)
- **Dead**: Field set on all weapons but never checked in combat code.

### ✅ 46. `NavMeshService.ts` — centroid property mismatch
- **File**: [NavMeshService.ts](navigation/NavMeshService.ts#L86)
- **Bug**: Checks `region.polygon.centroid` but uses `region.centroid`. Currently inactive (not imported), but will break if re-enabled.

### ⏭️ 47. Death animations included in `LOCOMOTION_KEYS`
- **File**: [AgentAnimations.ts](src/rendering/AgentAnimations.ts#L150)
- **Bug**: `makeClipInPlace()` zeroes position tracks on death animations, which may look wrong visually.

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 6 |
| HIGH | 12 |
| MEDIUM | 22 |
| LOW / Dead Code | 7 |
| **Total** | **47** |

### Top 5 highest-impact fixes
1. **Guard `doHealUp()`** with cooldown check — instant full heal exploit in BR
2. **Wire `damageContributors.clear()` + `clearKillcamSnapshots()`** into `resetMatch()` — memory leaks + stale assists
3. **Unify collision radii** between Bullets and Hitscan — gameplay inconsistency
4. **Add Three.js `.dispose()` calls** for HPBar, NameTag, SoldierMesh, WeaponViewmodel — VRAM leak
5. **Remove dead `CLASS_CONFIGS` weapon stats** or stop WEAPONS override — developer confusion / dead data
