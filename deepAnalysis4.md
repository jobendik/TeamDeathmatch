# Deep Analysis 4 — Verified Findings

**Date**: 2026-04-18  
**Scope**: Full codebase audit (core, config, combat, AI, entities, movement, rendering, UI, audio, BR, world)  
**Method**: Parallel module-level audits with manual verification of every finding  
**Result**: 12 verified findings (3 HIGH, 5 MEDIUM, 4 LOW)

---

## HIGH SEVERITY

---

### 1. PingSystem.ts — Wrong Y component in enemy ping detection

**File**: `src/ui/PingSystem.ts` line 70  
**Category**: Logic Error

```typescript
const toAg = new THREE.Vector3(
  ag.position.x - cam.position.x,
  1 - cam.position.y,               // ← BUG: should be ag.position.y
  ag.position.z - cam.position.z
);
```

- **Issue**: The Y component calculates `1 - cam.position.y` instead of `ag.position.y - cam.position.y`. This means the direction vector from camera to enemy has a hardcoded Y=1 origin instead of the actual enemy's Y position. The resulting `forward.dot(toAg)` angle comparison is unreliable — enemies that are in front of the player may not be detected as ping targets (and vice versa) depending on camera elevation.
- **Fix**: Change to `ag.position.y - cam.position.y`.

---

### 2. RoundSummary.ts — XP progress bar breaks on level-up

**File**: `src/ui/RoundSummary.ts` lines 117-118  
**Category**: Logic Error

```typescript
const xpPct  = (prog.xp    / (prog.level  * XP_PER_LEVEL)) * 100;
const startPct = (startXP  / (startLevel * XP_PER_LEVEL)) * 100;
```

- **Issue**: `startPct` is calculated against `startLevel`'s XP requirement, but `xpPct` is calculated against the NEW `prog.level`'s requirement. When the player levels up, the bar animates *backwards* (e.g. from 80% down to 8%) because the two percentages are on different scales.
- **Example**: Level 5 with 400/500 XP (80%) → earns 200 → Level 6 with 100/600 XP (16.7%). Bar animates from 80% → 16.7%, which looks like a regression.
- **Fix**: Detect level-up and animate to 100% first, then flash the level-up badge and set to the new percentage. Or compute both percentages against a common scale (e.g., total cumulative XP).

---

### 3. LootSystem.ts — Player death drops use mismatched item IDs

**File**: `src/br/LootSystem.ts` lines 326-331 vs `src/br/Inventory.ts` lines 191-198  
**Category**: Logic Error (ID mismatch)

`resolveLootVisual()` checks for **short** IDs:
```typescript
if (items.some((it) => it.id === 'arm_b'))  return 'armor_vest';
if (items.some((it) => it.id === 'sh_b'))   return 'shield_potion';
if (items.some((it) => it.id === 'heal_b')) return 'healthkit';
// ...
```

But `dumpInventoryOnDeath()` in Inventory.ts creates items with **long** IDs:
```typescript
items.push({ id: 'heal_small', ... });   // not 'heal_s'
items.push({ id: 'shield_big', ... });   // not 'sh_b'
items.push({ id: 'armor_big', ... });    // not 'arm_b'
```

- **Issue**: When the **player** dies in BR, their death-dropped heals, shields, and armor never match in `resolveLootVisual()`, so they all render with the fallback `'ammo_crate'` visual. Bot death drops use short IDs and are unaffected. Ground-spawned loot from `buildItem()` also uses short IDs and is unaffected.
- **Fix**: Standardize on one ID format. Either change `dumpInventoryOnDeath` to emit short IDs (`'heal_s'`, `'sh_b'`, `'arm_b'`) or update `resolveLootVisual` to also match long IDs.

---

## MEDIUM SEVERITY

---

### 4. AgentAnimations.ts — Direction fallthrough when f=0 and r=0

**File**: `src/rendering/AgentAnimations.ts` lines 459-510  
**Category**: Edge Case Bug

```typescript
function pickDirectionalSet(forward, right, prefix) {
  const f = Math.abs(forward) < 0.2 ? 0 : (forward > 0 ? 1 : -1);
  const r = Math.abs(right)   < 0.2 ? 0 : (right   > 0 ? 1 : -1);

  if (prefix === 'run') {
    if (f === 1 && r === -1) return 'runForwardLeft';
    // ... all directional cases ...
    if (r === -1) return 'runLeft';
    return 'runRight';  // ← fallthrough when f=0 && r=0
  }
  // same pattern for walk, sprint, crouchWalk
}
```

- **Issue**: When both forward and right inputs are below the 0.2 deadzone threshold, `f` and `r` are both 0. No directional case matches, so the function falls through to the default `return '*Right'`. The caller `chooseMovementAnimation` guards against `speed < 0.12` (returns idle), but an agent with speed 0.13–0.19 and both components below 0.2 will hit this fallthrough, playing a rightward run/walk animation while nearly stationary.
- **Fix**: Add an early return: `if (f === 0 && r === 0) return 'idle';` at the top of `pickDirectionalSet`, or handle the (0,0) case before checking prefix.

---

### 5. Streaks.ts — Dead variable in activateRapidFire

**File**: `src/combat/Streaks.ts` line 78  
**Category**: Dead Code

```typescript
function activateRapidFire(): void {
  if (streak.rapidFireActive) return;
  const wep = WEAPONS[gameState.pWeaponId];  // ← never used
  streak.rapidFireActive = true;
  streak.rapidFireExpiry = gameState.worldElapsed + 10;
  showStreakRewardNotif('⚡', 'RAPID FIRE', '20% faster fire rate for 10s');
}
```

- **Issue**: `const wep` was used to set `streak.rapidFireOrigRate = wep.fireRate` which was removed in Analysis 3 Fix #12. The variable itself was left behind.
- **Fix**: Remove `const wep = WEAPONS[gameState.pWeaponId];`.

---

### 6. Killcam.ts — Saved camera state never restored

**File**: `src/ui/Killcam.ts` lines 22-23, 89-90  
**Category**: Dead Code

```typescript
let savedCamPos = new THREE.Vector3();   // line 22
let savedCamRot = new THREE.Euler();     // line 23

// In startKillcam():
savedCamPos.copy(gameState.camera.position);  // line 89 — saved
savedCamRot.copy(gameState.camera.rotation);  // line 90 — saved

// In stopKillcam():
// savedCamPos and savedCamRot are NEVER read or restored
```

- **Issue**: Camera state is saved on killcam start but never restored on stop. Comment says "Player.ts will overwrite anyway on respawn", confirming these are dead allocations.
- **Fix**: Remove both variables and the two `.copy()` lines.

---

### 7. EventManager.ts — `_lastShotTime` written but only consumer is dead module

**File**: `src/core/EventManager.ts` line 228  
**Category**: Dead Code

```typescript
(gameState as any)._lastShotTime = gameState.worldElapsed;
```

- **Issue**: This property is only read in `src/analysis/DynamicMusic.ts` (line 214), which is in the dead `analysis/` directory and is never imported anywhere in the live codebase.
- **Fix**: Remove the line.

---

### 8. MovementController.ts — `lastJumpTime` declared but never used

**File**: `src/movement/MovementController.ts` line 216  
**Category**: Dead Code

```typescript
let lastJumpTime = -1;
```

- **Issue**: Declared and initialized to -1 but never read or assigned anywhere else in the file.
- **Fix**: Remove the declaration.

---

## LOW SEVERITY

---

### 9. GameModes.ts — Redundant elimination branch in isEnemy()

**File**: `src/core/GameModes.ts` lines 33-36  
**Category**: Dead Code (redundant branch)

```typescript
if (gameState.mode === 'elimination') {
  return a.team !== b.team;        // ← same as fallthrough
}
return a.team !== b.team;          // ← identical
```

- **Issue**: The `elimination` check returns identical logic to the fallthrough. Either elimination was intended to have different behavior (and this is a latent bug), or the check is dead code.
- **Fix**: Remove the elimination-specific branch.

---

### 10. constants.ts — `SCORE_LIMIT` exported but never imported

**File**: `src/config/constants.ts` line 4  
**Category**: Dead Code

```typescript
export const SCORE_LIMIT = 10;
```

- **Issue**: Never imported or referenced anywhere. Score limits are set per-mode in `GameModes.ts` via `getModeDefaults()`.
- **Fix**: Remove the constant.

---

### 11. weapons.ts — `canFire` field defined but never checked

**File**: `src/config/weapons.ts` line 31 + every weapon definition  
**Category**: Dead Code (non-wired field)

```typescript
canFire: boolean;      // interface
canFire: false,        // unarmed
canFire: true,         // pistol, smg, assault_rifle, shotgun, sniper_rifle, rocket_launcher, knife
```

- **Issue**: The field is defined on the `WeaponDef` interface and set on all 8 weapons, but no code ever reads it. Weapon firing is gated by explicit `pWeaponId === 'unarmed'` checks in EventManager.ts instead.
- **Fix**: Remove `canFire` from the interface and all weapon definitions.

---

### 12. GameState.ts — `winnerText` set but never consumed

**File**: `src/core/GameState.ts` line 237, `src/combat/Combat.ts` line 590  
**Category**: Dead Code (non-wired property)

```typescript
// GameState.ts
winnerText: '',

// Combat.ts checkGameEnd()
gameState.winnerText = all[0].isPlayer ? 'VICTORY' : `WINNER: ${all[0].name}`;
```

- **Issue**: `winnerText` is set when FFA reaches score limit but is never read by `RoundSummary.ts` or any other UI. The round summary computes its own victory/defeat text independently.
- **Fix**: Remove the property from GameState and the assignment in `checkGameEnd()`.

---

## Summary

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | HIGH | PingSystem.ts | Wrong Y component in enemy ping detection |
| 2 | HIGH | RoundSummary.ts | XP bar visual regression on level-up |
| 3 | HIGH | LootSystem.ts / Inventory.ts | Player death drop item ID mismatch |
| 4 | MEDIUM | AgentAnimations.ts | pickDirectionalSet f=0,r=0 fallthrough |
| 5 | MEDIUM | Streaks.ts | Dead `const wep` in activateRapidFire |
| 6 | MEDIUM | Killcam.ts | savedCamPos/savedCamRot never restored |
| 7 | MEDIUM | EventManager.ts | `_lastShotTime` only reader is dead module |
| 8 | MEDIUM | MovementController.ts | `lastJumpTime` declared, never used |
| 9 | LOW | GameModes.ts | Redundant elimination branch in isEnemy() |
| 10 | LOW | constants.ts | `SCORE_LIMIT` exported, never imported |
| 11 | LOW | weapons.ts | `canFire` field defined, never checked |
| 12 | LOW | GameState.ts | `winnerText` set, never consumed |
