# Deep Analysis 5 — Verified Findings

> Generated after 6 parallel module audits + manual verification against source code.
> All exports/imports cross-referenced. False alarms eliminated.

---

## HIGH Severity

### 1. EventManager.ts — Grenade cook checks wrong counter for smoke/flash

**Lines 243–244** — `startCookGrenade()` only checks `pGrenades`, ignoring `pSmokes` and `pFlashbangs`:

```ts
function startCookGrenade(): void {
  if (gameState.pDead) return;
  if (gameState.pGrenades <= 0) return;   // ← BUG: only checks frag count
  // ...
}
```

When `pGrenadeType === 'smoke'`, the player can cook even with 0 smokes (because they have frags). `releaseGrenade()` then decrements `pSmokes` to **-1**. Conversely, a player with smokes but 0 frags is blocked from throwing.

**Fix** — Check the correct counter for the selected type:
```ts
const count = gameState.pGrenadeType === 'smoke' ? gameState.pSmokes
            : gameState.pGrenadeType === 'flash' ? gameState.pFlashbangs
            : gameState.pGrenades;
if (count <= 0) return;
```

---

### 2. Combat.ts — `pSmokes` / `pFlashbangs` never reset on respawn or match start

**Lines 547 and 648** — Both respawn and `resetMatch` reset `pGrenades` to 2 but never touch `pSmokes` or `pFlashbangs`:

```ts
// respawn (line 547):
gameState.pGrenades = 2;
// pSmokes, pFlashbangs — NOT RESET

// resetMatch (line 648):
gameState.pGrenades = defaults.playerStartsArmed ? 2 : 0;
// pSmokes, pFlashbangs — NOT RESET
```

After one match, stale (possibly negative from bug #1) counts carry into the next match.

**Fix** — Reset alongside `pGrenades` in both locations:
```ts
gameState.pSmokes = 1;
gameState.pFlashbangs = 1;
```

---

### 3. AI state machine — registered but never executed (entire `states/` dead)

**AgentFactory.ts lines 101–112** create a state machine per bot and register 10 states. But `AIController.ts` `updateAI()` only calls `ag.brain.execute()` (the GOAP system). **No code calls `ag.stateMachine.update()` or `.execute()`.**

```
grep: stateMachine.update → 0 results
grep: stateMachine.execute → 0 results
```

The entire `src/ai/states/index.ts` file (PatrolState, EngageState, RetreatState, CoverState, PeekState, FlankState, TeamPushState, GuardState, HealState, CollapseState) is dead code. The equivalent behavior lives in `src/ai/goals/Goals.ts` which IS wired.

**Fix** — Remove the state machine setup from AgentFactory and the `src/ai/states/` directory, or wire `ag.stateMachine.update()` into the AI loop if dual-system was intended.

---

### 4. AIController.ts:176 — Bot weapon swap always grants full magazine (infinite ammo)

```ts
ag.weaponId = targetWeapon;
// ...
ag.ammo = def.magSize;   // ← full ammo on every swap
```

When a bot runs dry (`ag.ammo <= 0`), they swap weapons and get a full magazine. When that runs dry, they swap back and get another full magazine. Bots effectively have infinite ammo.

**Fix** — Track ammo per weapon on the agent, or at minimum don't reset ammo to full on swap:
```ts
ag.ammo = Math.min(ag.ammo, def.magSize); // keep current ammo, capped to new mag
```

---

### 5. CameraShake.ts — Entire shake system is dead (never imported)

No file in the codebase imports anything from `CameraShake.ts`:

```
grep: import.*CameraShake → 0 results
```

Exported functions `updateCameraShake`, `shakeOnHit`, `shakeOnLand`, `shakeOnExplosion`, `shakeOnShot`, `shakeOnDeath`, `clearAllShake`, etc. are never called. The game has no camera shake.

**Fix** — Wire into:
- GameLoop → `updateCameraShake(dt)` each frame
- Combat hits → `shakeOnHit(damageFraction)`
- Explosions → `shakeOnExplosion(dist)`
- Landing → `shakeOnLand(intensity)`
- Firing → `shakeOnShot()`

---

### 6. LootSystem.ts — `clearAllLoot()` doesn't reset pool state flags → 2nd BR match broken

**Lines 552–575** — `clearAllLoot()` disposes geometry and clears arrays but never resets:

```ts
// Never reset:
_poolReady    // stays true → ensureRenderPool() early-returns on 2nd match
_visualsReady // stays true
_preloadPromise // stays set → preloadLootVisuals() early-returns
_freeInstanceSlots // empty after 1st match
```

Second BR match: no loot beams, no 3D loot models.

**Fix** — Add at end of `clearAllLoot()`:
```ts
_poolReady = false;
_visualsReady = false;
_preloadPromise = null;
_freeInstanceSlots = [];
```

---

### 7. RoundSummary.ts — "DEPLOY AGAIN" button missing music + waypoints + pings cleanup

**Lines 250–258** — The restart handler is missing several calls that `startMatchFromMenu()` (Menus.ts:30–47) does:

```ts
// Menus.ts startMatchFromMenu() calls:
rebuildWaypoints();        // ← missing from DEPLOY AGAIN
startDynamicMusic();       // ← missing from DEPLOY AGAIN
Audio.startEnvironmentAmbience(); // ← missing from DEPLOY AGAIN
// Also missing:
clearPings();              // pings leak across matches
clearFloatingDamage();     // 3D damage sprites leak
```

After "DEPLOY AGAIN": no dynamic music, stale waypoints, leftover pings.

**Fix** — Add the missing calls to the `rsBtn.onclick` handler.

---

### 8. Vehicles.ts:311 — Collision rewind overshoots by 50%

```ts
v.position.add(v.velocity.clone().multiplyScalar(dt));      // advance by dt
// ...
v.position.sub(v.velocity.clone().multiplyScalar(dt * 1.5)); // rewind by 1.5×dt
```

Net effect: vehicle teleports **0.5×dt backward** past its pre-collision position. Combined with `speed *= -0.3`, this creates jittery bouncing.

**Fix** — Rewind by exactly `dt`:
```ts
v.position.sub(v.velocity.clone().multiplyScalar(dt));
```

---

### 9. Pickups.ts — Player cannot pick up weapon pickups

**Lines 224–245** — The player proximity pickup block handles `'health'`, `'ammo'`, and `'grenade'` but has **no case for `'weapon'`**. The bot loop (line 246+) handles weapon pickups.

```ts
// Player proximity — no weapon case
if (p.t === 'health' && ...) { ... }
else if (p.t === 'ammo' && ...) { ... }
else if (p.t === 'grenade' && ...) { ... }
// weapon pickup: missing!
```

Players walk over weapon pickups and nothing happens.

**Fix** — Add a weapon pickup case for the player, similar to the bot weapon pickup logic.

---

## MEDIUM Severity

### 10. MovementController.ts:376 — Landing detection hardcoded to Y=0

```ts
if (!movement.isGrounded && gameState.pPosY <= 0.001) {  // landing
```

But `getFloorY()` can return non-zero values for elevated surfaces. A player landing on a raised platform (e.g. Y=2) will never trigger `pPosY <= 0.001`, so:
- No landing sound
- No fall damage
- `isGrounded` remains false

**Fix** — Compare against floor Y:
```ts
const floorY = getFloorY(gameState.player.position.x, gameState.player.position.z);
if (!movement.isGrounded && gameState.pPosY <= floorY + 0.001) {
```

Same for the airborne check on line 393:
```ts
if (gameState.pPosY > floorY + 0.05) {
```

---

### 11. Grenade config values defined but never used

**weapons.ts:119–123** — `GRENADE_CONFIG.maxGrenades` (2) and `GRENADE_CONFIG.cooldown` (8) are defined but never referenced:

```ts
export const GRENADE_CONFIG = {
  maxGrenades: 2,   // ← never used; hardcoded as 3 in Pickups.ts, 4 in Player.ts
  cooldown: 8,      // ← never used; hardcoded as 1.0 in EventManager.ts
};
```

Caps are inconsistent: Pickups.ts caps at 3, Player.ts caps at 4, config says 2.

**Fix** — Use `GRENADE_CONFIG.maxGrenades` in both files; use `GRENADE_CONFIG.cooldown` in EventManager.ts. Pick one consistent value.

---

### 12. ContextualPerception.ts:141 — Hesitation aggressionBias applied backwards

```ts
hesitation += 0.1 * (1 - p.aggressionBias + 0.3);
```

`aggressionBias` ranges ~-0.5 to +0.5. For a Rusher (+0.35): `1 - 0.35 + 0.3 = 0.95` (high hesitation). For an Anchor (-0.25): `1 + 0.25 + 0.3 = 1.55` (even more hesitation). Aggressive bots hesitate **more**, which is backwards.

**Fix** — Likely intended `(1 - (aggressionBias + 0.3))`:
```ts
hesitation += 0.1 * Math.max(0, 1 - (p.aggressionBias + 0.3));
```

---

### 13. Minimap.ts:121 — `_spotFrame++` inside agent loop — throttle varies with enemy count

```ts
for (const ag of agents) {
  // ...
  if (!isAlly) {
    if (!isUAVActive()) {
      if (_spotFrame++ % 6 === 0) {   // ← increments per ENEMY, not per frame
```

With 5 enemies the visibility recompute runs nearly every frame; with 1 enemy it runs every 6 frames.

**Fix** — Move `_spotFrame++` to the start of `drawMinimap()` before the agent loop.

---

### 14. WeaponViewmodel.ts:1466 — `mouseDeltaX/Y` zeroed inside viewmodel update

```ts
gameState.mouseDeltaX = 0;
gameState.mouseDeltaY = 0;
```

If any other system reads mouse deltas after `updateViewmodel` runs in the same frame, they see 0. Frame-order dependent — the game loop must call `updateViewmodel` last.

**Fix** — Move the delta reset to the end of the game loop frame, not inside viewmodel.

---

### 15. Pickups.ts:229 — Health pickup threshold ignores streak HP boosts

```ts
if (p.t === 'health' && gameState.pHP < 100 * 0.7) {
```

`activateJuggernaut()` can push max HP to 150, but pickup threshold is hardcoded to 70. A player at 80 HP with 150 max can't pick up health.

**Fix** — `gameState.pHP < gameState.player.maxHP * 0.7`

---

## LOW Severity

### 16. GameState.ts — `pBurstTimer` and `pJumpRequested` are dead state fields

```ts
pBurstTimer: 0,       // line 201 — never read or written elsewhere
pJumpRequested: false, // line 227 — never read or written elsewhere
```

**Fix** — Remove both fields.

---

### 17. GameState.ts + WeaponViewmodel.ts — `vmScene`/`vmCamera` dead writes

GameState declares `vmScene` and `vmCamera` (lines 121–122). WeaponViewmodel sets them (line 1349–1350). But the viewmodel uses its **own module-local** variables for rendering (lines 1641, 1646). The GameState copies are never read.

**Fix** — Remove `vmScene`/`vmCamera` from GameState and the writes in WeaponViewmodel.

---

### 18. TDMAgent/Goals/States — `combatMoveTimer` set but never read

```ts
// Set in TDMAgent constructor (235), resetTacticalState (334),
// Goals.ts (129), states/index.ts (39) — but NEVER READ anywhere
ag.combatMoveTimer = 0;
```

**Fix** — Remove the field and all writes.

---

### 19. Unused imports

| File | Unused Import |
|------|---------------|
| Combat.ts:5 | `BLUE_SPAWNS`, `RED_SPAWNS` |
| Combat.ts:37 | `playHeal` |
| Hitscan.ts:3 | `spawnMuzzleFlash` |
| Killcam.ts:4 | `dom` |
| Announcer.ts:1 | `dom` |
| Announcer.ts:2 | `gameState` |
| EventManager.ts:14 | `setCrouch` |
| BRBots.ts:56 | `winProbability` |

**Fix** — Remove unused names from each import statement.

---

### 20. Exported but never imported (dead API surface)

| File | Symbol |
|------|--------|
| GameLoop.ts:81 | `stopLoop()` |
| EventManager.ts:41–46 | `getKeyMap()`, `setKeybind()` |
| Combat.ts:107 | `getPotgTime()` |
| Perception.ts:107 | `broadcastEnemyPosition()` |
| HumanAim.ts:268 | `isAimOnTarget()` |
| MatchMemory.ts:49 | `registerPlayerEngagement()` |
| MatchMemory.ts:68 | `getPlayerHotZone()` |
| PingSystem.ts:158 | `clearPings()` (should be wired, not removed) |
| ObjectPool.ts | Entire file (`MeshPool`, `LightPool`) |

**Fix** — Remove exports or wire into consumers. `clearPings()` should be called from match reset logic (see #7).

---

## Summary

| # | Sev | File | Issue |
|---|-----|------|-------|
| 1 | HIGH | EventManager.ts | Grenade cook checks only frag count, not smoke/flash |
| 2 | HIGH | Combat.ts | `pSmokes`/`pFlashbangs` never reset on respawn/match start |
| 3 | HIGH | AI states/ | State machine registered but never executed — entire directory dead |
| 4 | HIGH | AIController.ts | Bot weapon swap grants full magazine → infinite ammo |
| 5 | HIGH | CameraShake.ts | Entire shake system unwired — never imported |
| 6 | HIGH | LootSystem.ts | `clearAllLoot` doesn't reset pool flags → 2nd BR match broken |
| 7 | HIGH | RoundSummary.ts | "DEPLOY AGAIN" missing music/waypoints/pings cleanup |
| 8 | HIGH | Vehicles.ts | Collision rewind overshoots 50% past pre-collision position |
| 9 | HIGH | Pickups.ts | Player can't pick up weapon pickups (no `'weapon'` case) |
| 10 | MED | MovementController.ts | Landing detection hardcoded Y=0, broken on raised surfaces |
| 11 | MED | weapons.ts / Pickups.ts | Grenade config unused, max caps inconsistent (2 vs 3 vs 4) |
| 12 | MED | ContextualPerception.ts | Hesitation aggressionBias applied backwards |
| 13 | MED | Minimap.ts | `_spotFrame++` inside agent loop — wrong throttle rate |
| 14 | MED | WeaponViewmodel.ts | `mouseDeltaX/Y` zeroed in viewmodel — frame-order fragile |
| 15 | MED | Pickups.ts | Health pickup threshold ignores streak HP boosts |
| 16 | LOW | GameState.ts | `pBurstTimer`, `pJumpRequested` — dead state fields |
| 17 | LOW | GameState.ts | `vmScene`/`vmCamera` — dead writes |
| 18 | LOW | TDMAgent.ts | `combatMoveTimer` — set but never read |
| 19 | LOW | Multiple | 8 unused imports |
| 20 | LOW | Multiple | 9 exported symbols never imported |
