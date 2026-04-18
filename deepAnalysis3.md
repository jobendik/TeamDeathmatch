# Deep Analysis 3 — Verified Findings

Every finding below was cross-checked against actual source code.  
False positives from automated scans have been removed.

---

## HIGH Severity

### 1. Particles.ts — Geometry never disposed for non-pooled particles (GPU memory leak)
- **File**: [Particles.ts](src/combat/Particles.ts#L537)
- **Code** (cleanup path):
```ts
(p.mesh.material as THREE.Material).dispose();   // ✅ material disposed
scene.remove(p.mesh);                             // mesh removed…
// ❌ p.mesh.geometry.dispose() — MISSING
```
- **Issue**: When non-pooled particles expire, their material is disposed but their **geometry is never disposed**. This affects:
  - `spawnTracer()` — creates 2 new `CylinderGeometry` per bullet (lines 169, 182)
  - `spawnMuzzleFlash()` — creates a new `SphereGeometry` per AI shot (line 205)
  - `spawnDeath()` — creates 2 new `RingGeometry` per death (lines 235, 246)
- **Impact**: At 600 RPM, ~20 geometry objects leak per second. Over a 10-minute match, thousands of unreleased GPU buffer objects accumulate, causing frame drops and potential OOM.
- **Fix**: Add `p.mesh.geometry.dispose();` before `scene.remove(p.mesh)` in the non-pool cleanup path (line 537) and the pool-overflow cleanup path (line 533).

---

### 2. src/analysis/ — Entire directory is dead code (4 TypeScript files)
- **File**: [src/analysis/](src/analysis/)
- **Files**: `DynamicMusic.ts`, `HitReactions.ts`, `Recoil.ts`, `Suppression.ts`
- **Issue**: These 4 modules are **never imported** by any file in the project. They are older/alternate versions of modules that live in `src/combat/` and `src/audio/`. Zero imports confirmed via workspace-wide grep.
- **Impact**: Dead code bloat; TypeScript still compiles them; potential confusion during development (editing the wrong file).
- **Fix**: Delete entire `src/analysis/` directory (keep the markdown files if desired, or move them to project root docs).

---

### 3. MovementController.ts — endSlide() at line 332 doesn't reset isCrouching
- **File**: [MovementController.ts](src/movement/MovementController.ts#L332)
- **Code**:
```ts
// Line 158: tryStartSlide() sets isCrouching = true
movement.isCrouching = true;

// Line 162: endSlide() does NOT reset isCrouching
function endSlide(): void {
  movement.isSliding = false;
  movement.slideTimer = 0;
  movement.slideCooldown = 1.2;
  // ❌ movement.isCrouching = false; — MISSING
}

// Line 331–332: natural slide expiry / airborne check
if (movement.slideTimer <= 0 || !movement.isGrounded) {
  endSlide();   // isCrouching stays true!
}
```
- **Issue**: When a slide ends naturally (timer expires) or the player jumps mid-slide, `endSlide()` is called but `isCrouching` remains `true`. Compare with the manual crouch-toggle path at lines 229–230 which correctly resets both.
- **Impact**: Player stays crouched after every slide until they manually toggle crouch. Jumping during a slide leaves the player crouched in mid-air.
- **Fix**: Add `movement.isCrouching = false;` at the end of `endSlide()`.

---

## MEDIUM Severity

### 4. Player.ts — Reload cancel by sprint doesn't reset pReloadTimer (instant reload exploit)
- **File**: [Player.ts](src/entities/Player.ts#L195)
- **Code**:
```ts
if (movement.isSprinting || movement.isTacSprinting) {
  gameState.pReloading = false;
  dom.reloadBar.classList.remove('on');
  dom.reloadText.classList.remove('on');
  // ❌ gameState.pReloadTimer = 0; — MISSING
}
gameState.pReloadTimer += dt;
```
- **Issue**: When a reload is cancelled by sprinting, `pReloading` is set false but `pReloadTimer` is NOT reset. The timer retains its accumulated value. On the next reload, `pReloadTimer` continues from where it left off — e.g., cancelling at 1.8s of a 2.0s reload gives a near-instant next reload.
- **Impact**: Exploit: sprint-cancel near the end of reload → start reload again → completes almost instantly. Unintended mechanic that gives skilled players infinite rapid reloads.
- **Fix**: Add `gameState.pReloadTimer = 0;` after the cancel block (alongside the DOM cleanup).

---

### 5. Player.ts — Spawn regen and passive regen stack; double updateHUD() per frame
- **File**: [Player.ts](src/entities/Player.ts#L322)
- **Code**:
```ts
// Spawn regen (line 322): +10 hp/s near spawn
if (player.position.distanceTo(player.spawnPos) < 8) {
  gameState.pHP = Math.min(100, gameState.pHP + dt * 10);
  player.hp = gameState.pHP;
  updateHUD();   // call #1
}

// Passive regen (line 330): +8–20 hp/s after 5s no damage
if (!gameState.pDead && gameState.pHP < 100 && gameState.pHP > 0) {
  const timeSinceDmg = gameState.worldElapsed - gameState.pLastDamageTime;
  if (timeSinceDmg > 5) {
    const regenRate = 8 + Math.min(12, (timeSinceDmg - 5) * 4);
    gameState.pHP = Math.min(100, gameState.pHP + dt * regenRate);
    player.hp = gameState.pHP;
    updateHUD();   // call #2
  }
}
```
- **Issue**: Both regen sources fire independently. Near spawn + 5s since last damage → both apply, giving up to 30 hp/s. Also `updateHUD()` is called twice per frame.
- **Impact**: Unintentional double-regen near spawn; wasted updateHUD call every frame while regenerating.
- **Fix**: Make spawn regen and passive regen mutually exclusive via `else if`, and hoist `updateHUD()` below both blocks.

---

### 6. AIController.ts — _footstepTimers Map never cleaned up
- **File**: [AIController.ts](src/ai/AIController.ts#L21)
- **Code**:
```ts
const _footstepTimers = new Map<string, number>();   // keyed by ag.name

// Line 322: entries added, never deleted
_footstepTimers.set(ag.name, timer);
```
- **Issue**: The map accumulates entries for every agent that has ever existed. Dead/respawned agents keep their old key. While agent names are reused across respawns (so the leak is bounded to the number of unique names), no cleanup path exists for mode transitions or match resets.
- **Impact**: Minor memory leak; map entries persist across match restarts without page reload.
- **Fix**: Add `_footstepTimers.clear()` to the match reset / round start path.

---

### 7. Medals.ts — _lastPlayerDeathTime accessed before first set
- **File**: [Medals.ts](src/ui/Medals.ts#L125)
- **Code**:
```ts
// Line 125: READ before first death
if (matchState.lastKilledBy === victim && now - (gameState as any)._lastPlayerDeathTime < 30) {

// Line 152: first WRITE (only on player death)
(gameState as any)._lastPlayerDeathTime = gameState.worldElapsed;
```
- **Issue**: `_lastPlayerDeathTime` is a dynamically-attached `as any` property. If `onPlayerKill()` is called before any player death, `_lastPlayerDeathTime` is `undefined`, making `now - undefined` evaluate to `NaN`. The condition `NaN < 30` is `false`, so no crash, but the revenge medal check silently fails.
- **Impact**: Revenge medal never triggers on the first kill after match start (edge case). Also a type-safety concern with the `as any` dynamic property.
- **Fix**: Initialize in GameState or guard with `typeof` check.

---

### 8. SoundHooks.ts — Footstep pitch logic only adjusts jitter amplitude, not base pitch
- **File**: [SoundHooks.ts](src/audio/SoundHooks.ts#L119)
- **Code**:
```ts
const pitch = sprintMul > 0.7 ? -0.06 : 0.04; // comment: "deeper for sprint"
Audio.play(id, { volume: vol, pitchJitter: 0.08 + pitch });
// Sprint: pitchJitter = 0.02 (less variation)
// Walk:   pitchJitter = 0.12 (more variation)
```
- **Issue**: The variable named `pitch` is added to `pitchJitter`, not passed as the `pitch` parameter. The AudioManager uses `pitchJitter` to randomize pitch around 1.0, so this only changes the randomization range — not the base pitch. Sprint footsteps are NOT actually deeper; they just have less pitch variation.
- **Impact**: Audio design intent ("deeper for sprint, lighter for walk") is not achieved. Sprint and walk footsteps have the same base pitch.
- **Fix**: Pass `pitch` as a separate `pitch` option: `Audio.play(id, { volume: vol, pitch: sprintMul > 0.7 ? 0.94 : 1.04, pitchJitter: 0.08 })`.

---

### 9. Pickups.ts — Weapon stat application duplicated instead of calling applyWeaponToAgent()
- **File**: [Pickups.ts](src/combat/Pickups.ts#L276)
- **Code**:
```ts
// Pickups.ts lines 276–284 — inline copy:
ag.weaponId = p.weaponId;
ag.damage = newWep.damage;
ag.fireRate = newWep.fireRate;
ag.burstSize = newWep.burstSize;
ag.burstDelay = newWep.burstDelay;
ag.reloadTime = newWep.reloadTime;
ag.magSize = newWep.magSize;
ag.ammo = newWep.magSize;
ag.aimError = newWep.aimError;

// Combat.ts line 120 — canonical version:
function applyWeaponToAgent(ag: TDMAgent, weaponId: WeaponId): void { ... }
```
- **Issue**: Identical logic exists in `Combat.ts` as `applyWeaponToAgent()`. If a new weapon property is added to the canonical function, the Pickups inline copy will silently miss it.
- **Impact**: Maintenance risk; divergent behavior if new weapon stats are added.
- **Fix**: Import and call `applyWeaponToAgent(ag, p.weaponId)` instead of inline assignment.

---

### 10. WeaponViewmodel.ts — AnimationMixer stopped but internal cache not cleaned
- **File**: [WeaponViewmodel.ts](src/rendering/WeaponViewmodel.ts#L874)
- **Code**:
```ts
if (currentViewmodelMixer) {
  currentViewmodelMixer.stopAllAction();
  currentViewmodelMixer = null;
  // ❌ THREE.AnimationUtils.uncacheClip / uncacheRoot — not called
}
```
- **Issue**: Three.js internally caches animation roots and clips in global registries (`PropertyBinding`, `AnimationObjectGroup`). Without calling `uncacheRoot()` or `uncacheClip()`, old animation data accumulates in Three.js's internal caches across weapon switches.
- **Impact**: Minor memory leak in Three.js internals; negligible in short matches.
- **Fix**: Before nulling the mixer, call `THREE.AnimationUtils.uncacheRoot(currentWeaponMesh)` to clean internal caches.

---

## LOW Severity

### 11. HUD.ts — lastActiveSlot written every frame but never read
- **File**: [HUD.ts](src/ui/HUD.ts#L15)
- **Code**:
```ts
let lastActiveSlot = -1;        // line 15 — initialized
// ...
lastActiveSlot = gameState.pActiveSlot;  // line 96 — written every frame
// NEVER READ anywhere
```
- **Issue**: Dead variable. Assigned every frame in `updateHUD()` but never consumed.
- **Fix**: Remove the variable and the assignment.

---

### 12. Streaks.ts — rapidFireOrigRate stored and reset but never read
- **File**: [Streaks.ts](src/combat/Streaks.ts#L24)
- **Code**:
```ts
rapidFireOrigRate: number;             // line 24 — declared
streak.rapidFireOrigRate = wep.fireRate;  // line 81 — stored on activation
streak.rapidFireOrigRate = 0;           // line 160 — reset on expiry
// NEVER READ — getStreakFireRateMult() returns hardcoded 0.8
```
- **Issue**: `rapidFireOrigRate` was intended to restore the original fire rate after Rapid Fire expires, but `getStreakFireRateMult()` returns a hardcoded `0.8` multiplier instead. The stored value is dead.
- **Fix**: Remove `rapidFireOrigRate` from streak state, or use it in the expiry handler to restore the rate.

---

### 13. SoldierMesh.ts — emissiveIntensity set to 0.15 then immediately overwritten
- **File**: [SoldierMesh.ts](src/rendering/SoldierMesh.ts#L16)
- **Code**:
```ts
const mat = new THREE.MeshStandardMaterial({
  color, roughness: 0.3, metalness: 0.3,
  emissive: color, emissiveIntensity: 0.15,  // ← set here
});
// ...
mat.emissiveIntensity = isEnemy ? 0.3 : 0.1;  // ← overwritten here
```
- **Issue**: Constructor value `0.15` is immediately overwritten. Wasted initialization.
- **Fix**: Remove `emissiveIntensity` from the constructor, or set the correct value directly.

---

### 14. HUD.ts — weaponName.textContent redundantly set in both branches
- **File**: [HUD.ts](src/ui/HUD.ts#L43)
- **Code**:
```ts
if (isUnarmed || isKnife) {
  dom.ammoTxt.textContent = '—';
  dom.ammoMax.textContent = '';
  dom.weaponName.textContent = wep.name;    // ← set here
} else {
  dom.ammoTxt.textContent = String(gameState.pAmmo);
  dom.ammoMax.textContent = '/ ' + wep.magSize + ' [' + gameState.pAmmoReserve + ']';
  dom.weaponName.textContent = wep.name;    // ← same value, set again
}
```
- **Issue**: `dom.weaponName.textContent = wep.name` appears in both branches.
- **Fix**: Hoist it above the `if`.

---

## Summary

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | HIGH | Particles.ts | Geometry never disposed → GPU memory leak |
| 2 | HIGH | src/analysis/ | 4 dead TypeScript files (never imported) |
| 3 | HIGH | MovementController.ts | endSlide() doesn't reset isCrouching |
| 4 | MEDIUM | Player.ts | Reload cancel doesn't reset timer → instant reload exploit |
| 5 | MEDIUM | Player.ts | Spawn + passive regen stack; double updateHUD |
| 6 | MEDIUM | AIController.ts | _footstepTimers Map never cleaned |
| 7 | MEDIUM | Medals.ts | _lastPlayerDeathTime accessed before set |
| 8 | MEDIUM | SoundHooks.ts | Footstep pitch logic only adjusts jitter |
| 9 | MEDIUM | Pickups.ts | Weapon stats duplicated vs applyWeaponToAgent |
| 10 | MEDIUM | WeaponViewmodel.ts | AnimationMixer cache not cleaned |
| 11 | LOW | HUD.ts | lastActiveSlot dead variable |
| 12 | LOW | Streaks.ts | rapidFireOrigRate dead variable |
| 13 | LOW | SoldierMesh.ts | emissiveIntensity overwritten immediately |
| 14 | LOW | HUD.ts | weaponName set redundantly in both branches |

**Total: 14 verified findings** (3 HIGH, 7 MEDIUM, 4 LOW)
