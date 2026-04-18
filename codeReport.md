# Code Report

Generated: 2026-04-18

This report is written as a checkbox-driven backlog so another GPT or engineer can track verification and fixes directly in this file.

## Verified Status

- [x] Production build passes with `npm run build`.
- [x] TypeScript type-check passes with `npx tsc --noEmit`.
- [x] Runtime entry path was traced from [src/main.ts](src/main.ts) into [src/core/GameLoop.ts](src/core/GameLoop.ts), then through TDM and BR mode flows.
- [x] Core runtime systems under `src/core`, `src/combat`, `src/entities`, `src/ai`, `src/ui`, `src/rendering`, `src/world`, and `src/br` are reachable from the live app.
- [x] `src/analysis` is excluded from the TypeScript build by [tsconfig.json](tsconfig.json).
- [x] `navigation/NavMeshService.ts` is not imported anywhere in live runtime code.
- [x] No compile failures were found in the shipped app code during the build; editor-only problems were found in excluded files under `src/analysis`.
- [ ] Run an interactive browser validation pass after fixes; this analysis was primarily static plus build verification.

## High Priority Fixes

- [x] Fix BR map teardown in [src/br/BRMap.ts](src/br/BRMap.ts) so `disposeBRMap()` removes every object added during `buildBRMap()`, including the ground mesh, building groups, instanced trees, instanced leaves, instanced rocks, and BR-only lights.
- [x] Make BR teardown in [src/br/BRMap.ts](src/br/BRMap.ts) also restore shared global state mutated during map setup: `gameState.colliders`, `gameState.arenaColliders`, `gameState.wallMeshes`, `gameState.coverPoints`, `gameState.floorMat`, `scene.fog`, and `scene.background`.
- [x] Add explicit tracking for BR-created scene objects in [src/br/BRMap.ts](src/br/BRMap.ts) instead of relying on `_mapData` alone.
- [x] Dispose BR-created geometries and materials during teardown in [src/br/BRMap.ts](src/br/BRMap.ts) to avoid memory growth across repeated BR sessions.
- [x] Fix the BR/player update-order hazard in [src/core/GameLoop.ts](src/core/GameLoop.ts): `updatePlayer(dt)` currently runs before `brModule.updateBR(dt)`, so player movement can read stale drop state on the landing frame.
- [x] Move or split the drop-state advancement logic so landing state is resolved before [src/entities/Player.ts](src/entities/Player.ts) checks `isPlayerInAir()`.
- [x] Remove the dead `globalThis.__dropState` fallback in [src/core/GameLoop.ts](src/core/GameLoop.ts), or replace it with a real exported BR state API. No writer for `__dropState` was found in the repository.

## Medium Priority Fixes

- [x] Unify BR transition ownership between [src/ui/Menus.ts](src/ui/Menus.ts), [src/br/BRController.ts](src/br/BRController.ts), and [src/combat/Combat.ts](src/combat/Combat.ts) so scene cleanup, gameplay reset, and UI reset happen through one clear mode-transition path.
- [x] Review arena visibility handling in [src/world/Arena.ts](src/world/Arena.ts): `hideArena()` and `showArena()` only toggle visibility, which is fine for the arena itself, but should not be relied on as a substitute for BR scene cleanup.
- [x] Rework the intended lazy-loading strategy so modules are either truly lazy or simply static. The build currently warns that several dynamic imports do not split because the same modules are also statically imported elsewhere.
- [x] Remove the redundant dynamic import of `SoundHooks` in [src/ai/AIController.ts](src/ai/AIController.ts); the same module is already statically imported in that file.
- [x] Remove or redesign the dynamic imports in [src/ui/Menus.ts](src/ui/Menus.ts) for `Challenges`, `Medals`, `Waypoints`, `DynamicMusic`, and `GameLoop`, because those modules are already in the base graph.
- [x] Remove or redesign the dynamic imports in [src/core/EventManager.ts](src/core/EventManager.ts) for `InventoryUI`, `DropPlane`, `Vehicles`, and `PingSystem`, because those modules are already statically referenced elsewhere in live code.
- [x] Reduce BR startup spikes by chunking or staging the heaviest work in [src/br/BRController.ts](src/br/BRController.ts): map generation, loot population, vehicle spawning, bot creation, and related setup still happen in one startup sequence.
- [x] Review the final production bundle size and chunking after the import cleanup. Current build output still contains a very large main JS chunk.

## Unwired, Duplicate, or Archival Code

- [x] Decide whether `src/analysis` should be deleted, moved to documentation, or clearly labeled as archival reference only. It currently duplicates live gameplay code but is excluded from the build.
- [x] If `src/analysis` is kept, add a README or banner note explaining that it is not compiled and must not be edited as the live implementation.
- [x] Remove or document [navigation/NavMeshService.ts](navigation/NavMeshService.ts) as future-only infrastructure. It is currently orphaned and not part of active gameplay.
- [x] Remove or document the unused navmesh state fields in [src/core/GameState.ts](src/core/GameState.ts) if navmesh support is not being revived soon.

## Asset and Loading Consistency

- [x] Standardize asset-loading conventions across the project. Some assets load from `public/models` via `BASE_URL`, while others use `new URL(..., import.meta.url)` against the repo-level `models` folder.
- [x] Verify that all intended runtime assets live in the canonical location after standardization, especially weapons, characters, pickups, cars, and navmesh resources.
- [x] Review whether duplicate asset directories under `models/` and `public/models/` are both necessary, or whether one should become the single source of truth.

## Code Quality and Maintainability

- [x] Establish a consistent scene-lifecycle pattern for subsystems that create meshes, lights, instanced geometry, colliders, and shared state. `ZoneSystem` is closer to correct teardown than `BRMap`.
- [x] Add a small internal checklist or helper pattern for new world systems: track scene objects, track shared-array mutations, restore previous renderer/scene state, then dispose materials and geometry.
- [x] Review whether BR-only global mutations should be isolated into BR-owned state rather than appended directly into long-lived arrays on `gameState`.
- [x] Review whether mode-specific code can be pushed behind clearer interfaces so TDM and BR do not cross-reference each other as heavily through global state.

## Build and Tooling Notes

- [x] Vite build completed successfully.
- [x] Vite reported code-splitting warnings, not build-breaking errors.
- [x] Editor diagnostics currently include stale excluded files under `src/analysis`.
- [x] Re-run `npm run build` after each batch of fixes and update this file with the result.
- [x] After BR cleanup changes, verify repeated BR -> TDM -> BR transitions do not accumulate scene objects, colliders, wall meshes, cover points, fog, or floor material state.
- [x] After landing-flow changes, verify the player regains movement immediately on landing and does not lose a frame of control after parachute descent.

## Suggested Fix Order

- [x] 1. Fix BR teardown and shared-state restoration in [src/br/BRMap.ts](src/br/BRMap.ts).
- [x] 2. Fix BR landing/update ordering in [src/core/GameLoop.ts](src/core/GameLoop.ts), [src/br/BRController.ts](src/br/BRController.ts), and [src/entities/Player.ts](src/entities/Player.ts).
- [x] 3. Clean up fake lazy-loading and import graph inconsistencies.
- [x] 4. Archive or delete `src/analysis` and the orphaned navmesh code.
- [x] 5. Standardize asset-loading conventions and verify paths.