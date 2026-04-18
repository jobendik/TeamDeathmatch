# Integration patches

These are the edits to existing files needed to wire the 4 new systems in.
They're small — keep them in one place for easy review.

## 1. `src/core/EventManager.ts`

At the top, add the import:

```ts
import { applyPlayerRecoil } from '@/combat/Recoil';
import { getSuppressionSpreadMul } from '@/combat/Suppression';
```

In `onShoot()`, replace the existing `err` calculation and the part that
records `gameState.pShootTimer` with this (keeping surrounding logic intact):

```ts
  // ... existing code up to the aimPoint/origin/dir setup ...

  const errMul = gameState.isADS ? 0.35 : gameState.keys.shift ? 1.35 : 1.0;
  const firstShotBonus = (gameState.pAmmo === gameState.pMaxAmmo || gameState.pFirstShotReady) ? 0.5 : 1;
  const spreadAccum = gameState.pSpreadAccum;
  const suppressMul = getSuppressionSpreadMul();   // ← NEW
  const err = wep.aimError * errMul * firstShotBonus * suppressMul + spreadAccum * 0.012;

  // ... rest of onShoot unchanged, but right AFTER the fire action
  //     (after hitscanShot/spawnRocket/shotgunBlast) and BEFORE `fireViewmodel()`:

  applyPlayerRecoil(pWeaponId);                    // ← NEW

  // Track last-shot time for dynamic music
  (gameState as any)._lastShotTime = gameState.worldElapsed;  // ← NEW

  fireViewmodel();
  // ... rest of onShoot unchanged
```

## 2. `src/combat/Hitscan.ts`

Add import at top:

```ts
import { checkSuppressionFromShot } from './Suppression';
```

Inside `hitscanShot()`, right after `const endPoint = origin.clone()...`:

```ts
  const endPoint = origin.clone().add(dir.clone().normalize().multiplyScalar(hitDist));

  // Suppress the player if this non-player shot passed close by
  checkSuppressionFromShot(origin, dir, hitDist, ownerType);   // ← NEW

  spawnTracer(origin, endPoint, col);
```

## 3. `src/combat/Combat.ts`

Add import at top:

```ts
import { applyHitReaction } from '@/ai/HitReactions';
```

In `dealDmgAgent()`, right after `if (attacker) ag.lastAttacker = attacker;`:

```ts
  if (attacker) ag.lastAttacker = attacker;

  // Visible body stagger (bot hit reaction) — hooks into the render component  ← NEW
  const attackerPos = attacker ? { x: attacker.position.x, z: attacker.position.z } : null;
  const wasHS = Boolean((ag as any)._lastHitWasHeadshot);
  applyHitReaction(ag, dmg, attackerPos, wasHS);
```

## 4. `src/core/GameLoop.ts`

Add imports:

```ts
import { updatePlayerRecoilRecovery } from '@/combat/Recoil';
import { updateSuppression } from '@/combat/Suppression';
import { updateHitReactions } from '@/ai/HitReactions';
import { updateDynamicMusic, startDynamicMusic } from '@/audio/DynamicMusic';
```

Inside `animate()`, inside the `if (!frozen && dt > 0)` block, these calls
should happen in this order to match the existing pipeline:

```ts
  // ... existing entity manager update, keepInside etc ...

  // Suppression samples bullet positions — must run AFTER projectile update
  // but BEFORE hit reactions apply visual offsets on top of YUKA sync.
  updateSuppression(dt);                                   // ← NEW

  // Hit reactions piggyback on YUKA's already-synced render components.
  // MUST come after entityManager.update() so YUKA's sync has happened first.
  updateHitReactions(dt);                                  // ← NEW

  // Recoil recovery pulls the camera back toward rest.
  updatePlayerRecoilRecovery(dt);                          // ← NEW

  // Dynamic music — run after everything else so it reads final state.
  updateDynamicMusic(dt);                                  // ← NEW
```

## 5. `src/ui/Menus.ts`

In `startMatchFromMenu()`, replace the existing `Audio.startAmbientMusic()`
call with:

```ts
  // Audio.startAmbientMusic();  ← REMOVE this line
  const { startDynamicMusic } = await import('@/audio/DynamicMusic');  // ← NEW
  startDynamicMusic();                                                   // ← NEW
```

## 6. `src/combat/Combat.ts` (reset hooks)

In `resetMatch()`, near where streaks are cleared, add:

```ts
  import { resetPlayerRecoil } from '@/combat/Recoil';
  import { resetSuppression } from '@/combat/Suppression';
  // ...
  resetPlayerRecoil();
  resetSuppression();
```

(or at the top of the file as regular imports, adding the calls inside
`resetMatch()` where the other state resets happen)

---

That's all the wiring. Total diff footprint: ~30 lines across 5 files.