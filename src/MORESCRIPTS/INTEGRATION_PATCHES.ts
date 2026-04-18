// ═══════════════════════════════════════════════════════════════════════
//  WARZONE TDM — AAA UPGRADE INTEGRATION PATCHES
// ═══════════════════════════════════════════════════════════════════════
//
//  This file documents every change needed in your existing codebase to
//  plug in the 12 new systems. Each patch section shows the TARGET FILE,
//  the EXISTING CODE to find, and the NEW CODE to replace it with.
//
//  Patches are ordered by file. Apply them in any order — they're independent.
//
//  After applying:
//    1. Run `tsc --noEmit` to verify types
//    2. Start dev server and watch console for missing imports
//    3. Test each system in isolation via the debug flags at the bottom
//
//  Files touched:
//    - src/main.ts                          (init new systems)
//    - src/core/GameLoop.ts                 (tick new systems)
//    - src/core/GameModes.ts                (add 'domination' | 'hardpoint')
//    - src/core/GameState.ts                (add runtime flags)
//    - src/combat/Combat.ts                 (XP/contracts/ragdoll/BotVoice on kill)
//    - src/combat/Hitscan.ts                (ADS accuracy + TrainingRange hit)
//    - src/entities/Player.ts               (perk hooks + EnhancedADS)
//    - src/movement/MovementController.ts   (perk hooks + tac sprint)
//    - src/ai/AIController.ts               (BotVoice triggers)
//    - src/ai/br/BRBrain.ts                 (objective priority hints)
//    - src/audio/SoundHooks.ts              (add 5 new sound stubs)
//    - src/entities/AgentFactory.ts         (ragdoll on death)
//    - src/ui/UI.ts                         (init new HUDs)
//
// ═══════════════════════════════════════════════════════════════════════


// ┌─────────────────────────────────────────────────────────────────────┐
// │ PATCH 1: src/main.ts                                                │
// └─────────────────────────────────────────────────────────────────────┘
//
// Add these imports at the top:
//
//   import { initPlayerProfile } from '@/progression/PlayerProfile';
//   import { initLoadouts } from '@/loadout/Loadouts';
//   import { initFieldUpgrade } from '@/loadout/FieldUpgradeController';
//   import { initContracts } from '@/contracts/ContractSystem';
//   import { initFinishers } from '@/finishers/Finishers';
//   import { initEnhancedADS } from '@/ui/EnhancedADS';
//   import { initDynamicWeather } from '@/weather/DynamicWeather';
//
// In your bootstrap() function, AFTER the scene/lights are created but
// BEFORE the game loop starts, add:
//
//   // Meta-systems (persistent)
//   initPlayerProfile();
//   initLoadouts();
//   initContracts();
//
//   // Match-level systems
//   initFieldUpgrade();
//   initFinishers();
//   initEnhancedADS();
//   initDynamicWeather(scene, ambientLight, directionalLight);


// ┌─────────────────────────────────────────────────────────────────────┐
// │ PATCH 2: src/core/GameLoop.ts                                       │
// └─────────────────────────────────────────────────────────────────────┘
//
// Add these imports:
//
//   import { updateRagdolls } from '@/ragdoll/RagdollSystem';
//   import { updateFinisher, pollFinisherInput, updateFinisherPrompt } from '@/finishers/Finishers';
//   import { updateDynamicWeather } from '@/weather/DynamicWeather';
//   import { updateContractHud } from '@/contracts/ContractSystem';
//   import { updateFieldUpgrade } from '@/loadout/FieldUpgradeController';
//   import { updateOverlay as updateADSOverlay } from '@/ui/EnhancedADS';
//   import { updateDomination, getDomState } from '@/modes/Domination';
//   import { updateHardpoint, getHardpointState } from '@/modes/Hardpoint';
//   import { updateTrainingRange, isInTrainingRange } from '@/tutorial/TrainingRange';
//
// In the main tick() function, AFTER agent/player updates but BEFORE render:
//
//   // Ragdoll physics
//   updateRagdolls(dt);
//
//   // Finishers (check input first)
//   pollFinisherInput();
//   updateFinisher(dt);
//   updateFinisherPrompt();
//
//   // Weather
//   const camPos = camera?.position;
//   updateDynamicWeather(dt, camPos);
//
//   // Field upgrade
//   updateFieldUpgrade(dt);
//
//   // ADS overlay
//   updateADSOverlay();
//
//   // Mode-specific updates
//   if (gameState.mode === 'domination') updateDomination(dt);
//   else if (gameState.mode === 'hardpoint') updateHardpoint(dt);
//
//   // Training range (overrides normal gameplay)
//   if (isInTrainingRange()) updateTrainingRange(dt);
//
//   // Contract HUD (throttled inside)
//   updateContractHud();


// ┌─────────────────────────────────────────────────────────────────────┐
// │ PATCH 3: src/core/GameModes.ts                                      │
// └─────────────────────────────────────────────────────────────────────┘
//
// Find the GameMode type union and extend it:
//
//   // BEFORE:
//   export type GameMode = 'tdm' | 'ffa' | 'ctf' | 'hq' | 'br';
//
//   // AFTER:
//   export type GameMode =
//     | 'tdm' | 'ffa' | 'ctf' | 'hq' | 'br'
//     | 'domination' | 'hardpoint' | 'koth' | 'sd'
//     | 'training';
//
// In the GAME_MODES config object, add entries:
//
//   domination: {
//     id: 'domination',
//     name: 'Domination',
//     description: 'Capture and hold 3 zones. First to 200.',
//     scoreLimit: 200,
//     timeLimit: 600,
//     minTeamSize: 4,
//     supportsBots: true,
//   },
//   hardpoint: {
//     id: 'hardpoint',
//     name: 'Hardpoint',
//     description: 'Hold the rotating hill. First to 250.',
//     scoreLimit: 250,
//     timeLimit: 600,
//     minTeamSize: 4,
//     supportsBots: true,
//   },
//   training: {
//     id: 'training',
//     name: 'Training Range',
//     description: 'Practice shooting and learn the basics.',
//     scoreLimit: 0,
//     timeLimit: 0,
//     minTeamSize: 1,
//     supportsBots: false,
//   },


// ┌─────────────────────────────────────────────────────────────────────┐
// │ PATCH 4: src/core/GameState.ts                                      │
// └─────────────────────────────────────────────────────────────────────┘
//
// Add runtime fields to the GameState interface:
//
//   interface GameState {
//     // ... existing fields ...
//     timeScale?: number;              // global time dilation (finishers, slowmo)
//     _finisherLockMovement?: boolean; // true while a finisher animation plays
//     _tutorialGrenadeThrown?: boolean;
//   }
//
// Default value in the gameState singleton:
//
//   timeScale: 1,
//   _finisherLockMovement: false,


// ┌─────────────────────────────────────────────────────────────────────┐
// │ PATCH 5: src/combat/Combat.ts                                       │
// └─────────────────────────────────────────────────────────────────────┘
//
// Add imports:
//
//   import { awardAccountXP, awardWeaponXP, recordMatchResult, profileMutate } from '@/progression/PlayerProfile';
//   import { getActivePerkHooks } from '@/loadout/Loadouts';
//   import { reportContractEvent } from '@/contracts/ContractSystem';
//   import { onPlayerKillForFieldUpgrade, chargeFromEvent } from '@/loadout/FieldUpgradeController';
//   import { spawnRagdoll } from '@/ragdoll/RagdollSystem';
//   import { BotVoice } from '@/audio/BotVoice';
//
// In killAgent(victim, killer, weapon, hitPart, extras), AFTER existing scoring
// but BEFORE the death animation call:
//
//   // Determine kill modifiers
//   const isHeadshot = hitPart === 'head';
//   const distance = killer?.mesh?.position?.distanceTo(victim.mesh.position) ?? 0;
//   const isLongRange = distance > 50;
//   const isPointBlank = distance < 4;
//   const streak = killer?.streak ?? 0;
//
//   // Player kill: XP + progression
//   if (killer === gameState.player) {
//     // Base XP
//     let xp = 100;
//     if (isHeadshot) xp += 50;
//     if (isLongRange) xp += 75;
//     if (extras?.isFinisher) xp += 150;
//     awardAccountXP(xp, 'kill');
//     awardWeaponXP(weapon?.id ?? 'assault_rifle', isHeadshot ? 20 : 10);
//
//     // Contracts
//     reportContractEvent({ type: 'kill' });
//     if (isHeadshot) reportContractEvent({ type: 'headshot_kill' });
//     if (isLongRange) reportContractEvent({ type: 'long_range_kill', distance });
//     if (isPointBlank) reportContractEvent({ type: 'point_blank_kill' });
//     if (weapon?.id) reportContractEvent({ type: 'weapon_kill', weapon: weapon.id });
//     if (weapon?.category) reportContractEvent({ type: 'mode_kill', category: weapon.category });
//     if (streak >= 3) reportContractEvent({ type: 'streak_reached', count: streak });
//     if (extras?.isFinisher) reportContractEvent({ type: 'finisher_kill' });
//     if (extras?.isMelee && !extras?.isFinisher) reportContractEvent({ type: 'melee_kill' });
//     if (extras?.isGrenade) reportContractEvent({ type: 'grenade_kill' });
//
//     // Field upgrade charge
//     onPlayerKillForFieldUpgrade();
//     chargeFromEvent('kill');
//
//     // Match stats
//     profileMutate((p) => {
//       p.career.kills++;
//       if (isHeadshot) p.career.headshots++;
//       if (distance > p.career.longestShot) p.career.longestShot = distance;
//     });
//   }
//
//   // Bot kill callout
//   if (killer && killer !== gameState.player && killer.mesh) {
//     const isCollateral = extras?.collateralCount ?? 0 > 0;
//     const isRevenge = killer._lastKilledBy === victim;
//     BotVoice.onKill({
//       id: killer.id,
//       name: killer.name,
//       team: killer.team,
//       position: killer.mesh.position,
//       personality: killer.personality,
//     }, isHeadshot, isCollateral, isRevenge);
//   }
//
//   // Death callout
//   if (victim !== gameState.player && victim.mesh) {
//     BotVoice.onDeath({
//       id: victim.id,
//       name: victim.name,
//       team: victim.team,
//       position: victim.mesh.position,
//       personality: victim.personality,
//     });
//   }
//
//   // REPLACE the call to playAgentDeathAnimation() with:
//   if (victim.mesh && killer?.mesh) {
//     const impulseDir = new THREE.Vector3().subVectors(
//       victim.mesh.position, killer.mesh.position
//     ).normalize();
//     const magnitude = extras?.isExplosion ? 28 :
//                       extras?.isMelee ? 12 :
//                       extras?.isFinisher ? 18 : 18;
//     spawnRagdoll(victim.mesh, impulseDir, magnitude, isHeadshot);
//   }
//
// In dealDmgPlayer(amount, attacker, ...), AT THE TOP:
//
//   // Apply perk damage resistance
//   const hooks = getActivePerkHooks();
//   amount *= hooks.damageResistMul ?? 1;
//
//   // Field upgrade charge from taking damage
//   chargeFromEvent('damage_taken', amount);
//
//   // Contract event
//   reportContractEvent({ type: 'damage_taken', amount });
//
//   // Low HP voice warning (bots)
//   // (called from AIController, not here)


// ┌─────────────────────────────────────────────────────────────────────┐
// │ PATCH 6: src/combat/Hitscan.ts                                      │
// └─────────────────────────────────────────────────────────────────────┘
//
// Add imports:
//
//   import { adsAccuracyMul } from '@/ui/EnhancedADS';
//   import { onBulletHit as trainingOnHit, recordShotFired as trainingShotFired, isInTrainingRange } from '@/tutorial/TrainingRange';
//
// In your spread calculation, multiply by ADS:
//
//   // EXISTING:
//   const spread = baseSpread * movementMul;
//
//   // REPLACE WITH:
//   const spread = baseSpread * movementMul * adsAccuracyMul();
//
// At the start of shoot() or fireHitscan() (for player shots only):
//
//   if (shooter === gameState.player && isInTrainingRange()) {
//     trainingShotFired();
//   }
//
// In the hit raycast result handling, for each hit:
//
//   if (hit.object && isInTrainingRange()) {
//     const scored = trainingOnHit(hit.object);
//     if (scored > 0) {
//       // Optional: visual flourish (score popup)
//     }
//   }


// ┌─────────────────────────────────────────────────────────────────────┐
// │ PATCH 7: src/entities/Player.ts                                     │
// └─────────────────────────────────────────────────────────────────────┘
//
// Add imports:
//
//   import { getActivePerkHooks } from '@/loadout/Loadouts';
//   import { beginADS, endADS, updateADSFov, applyADSSway } from '@/ui/EnhancedADS';
//
// In your reload timer calculation:
//
//   // EXISTING:
//   const reloadTime = weapon.reloadTime;
//
//   // REPLACE WITH:
//   const hooks = getActivePerkHooks();
//   const reloadTime = weapon.reloadTime * (hooks.reloadMul ?? 1);
//
// In health regen tick:
//
//   // EXISTING:
//   this.health = Math.min(this.maxHealth, this.health + regenRate * dt);
//
//   // REPLACE WITH:
//   const regenHooks = getActivePerkHooks();
//   this.health = Math.min(this.maxHealth, this.health + regenRate * (regenHooks.healthRegenMul ?? 1) * dt);
//
// In the ADS down/up handlers:
//
//   // On RMB down:
//   if (!gameState._finisherLockMovement) {
//     beginADS(this.currentWeapon.id);
//   }
//
//   // On RMB up:
//   endADS();
//
// In the camera update (per frame):
//
//   updateADSFov(camera, dt, this.hipFov ?? 75);
//   applyADSSway(camera, dt);


// ┌─────────────────────────────────────────────────────────────────────┐
// │ PATCH 8: src/movement/MovementController.ts                         │
// └─────────────────────────────────────────────────────────────────────┘
//
// Add imports:
//
//   import { getActivePerkHooks } from '@/loadout/Loadouts';
//   import { isDeadSilenceActive } from '@/loadout/FieldUpgradeController';
//
// Add fields to the class:
//
//   moveSpeedMulOverride: number = 1;    // set by FieldUpgradeController (stim boost etc.)
//   tacSprintCooldown: number = 0;
//   tacSprintTimer: number = 0;
//   isTacSprinting: boolean = false;
//
// In the update() method, AT THE TOP:
//
//   const hooks = getActivePerkHooks();
//
// In the movement speed calc:
//
//   // EXISTING:
//   let speed = baseSpeed;
//   if (sprinting) speed *= sprintMul;
//
//   // REPLACE WITH:
//   let speed = baseSpeed * (hooks.moveSpeedMul ?? 1) * this.moveSpeedMulOverride;
//   if (sprinting) {
//     speed *= sprintMul;
//     if (this.isTacSprinting) speed *= 1.35;
//   }
//
// In the jump handler:
//
//   // EXISTING:
//   this.velocity.y = jumpVelocity;
//
//   // REPLACE WITH:
//   this.velocity.y = jumpVelocity * (hooks.jumpHeightMul ?? 1);
//
// In fall damage calculation:
//
//   // EXISTING:
//   const fallDmg = calcFallDamage(landingVel);
//
//   // REPLACE WITH:
//   const fallDmg = calcFallDamage(landingVel) * (hooks.fallDamageMul ?? 1);
//
// In footstep emission (if you have it):
//
//   if (isDeadSilenceActive() || hooks.silentFootsteps) {
//     // suppress footstep emission this frame
//     return;
//   }
//
// Tick tac sprint timers (add to update()):
//
//   if (this.tacSprintTimer > 0) {
//     this.tacSprintTimer -= dt;
//     if (this.tacSprintTimer <= 0) {
//       this.isTacSprinting = false;
//       this.tacSprintCooldown = 6; // 6s cooldown
//     }
//   }
//   if (this.tacSprintCooldown > 0) this.tacSprintCooldown -= dt;


// ┌─────────────────────────────────────────────────────────────────────┐
// │ PATCH 9: src/ai/AIController.ts                                     │
// └─────────────────────────────────────────────────────────────────────┘
//
// Add imports:
//
//   import { BotVoice } from '@/audio/BotVoice';
//   import { getPriorityZonesFor } from '@/modes/Domination';
//   import { getHardpointPriority } from '@/modes/Hardpoint';
//   import { gameState } from '@/core/GameState';
//
// Hook into state transitions. Wherever you transition state, add callouts:
//
//   // On first detection of enemy:
//   if (newState === 'engage' && !this._firstSpotCalled) {
//     this._firstSpotCalled = true;
//     const target = this.targetAgent;
//     const isSniper = target?.weapon?.category === 'sniper';
//     const multiVisible = this.perception?.visibleEnemies?.length > 1;
//     BotVoice.onSpotEnemy(this.asCalloutSource(), isSniper, multiVisible);
//   }
//
//   // On reload start:
//   if (this.weapon.reloading && !this._reloadCalled) {
//     this._reloadCalled = true;
//     BotVoice.onReload(this.asCalloutSource());
//   }
//   if (!this.weapon.reloading) this._reloadCalled = false;
//
//   // On low HP:
//   if (this.health / this.maxHealth < 0.3 && !this._lowHpCalled) {
//     this._lowHpCalled = true;
//     BotVoice.onLowHp(this.asCalloutSource(), this.health / this.maxHealth < 0.15);
//   }
//
//   // On grenade nearby (in flee-from-grenade goal):
//   if (goal === 'flee_grenade') {
//     BotVoice.onGrenade(this.asCalloutSource(), false);
//   }
//
//   // On push state:
//   if (newState === 'pushing') {
//     const side = this.getPushDirection();  // 'left' | 'right' | 'middle'
//     BotVoice.onPush(this.asCalloutSource(), side);
//   }
//
//   // On flank state:
//   if (newState === 'flanking' && !this._flankCalled) {
//     this._flankCalled = true;
//     BotVoice.onFlank(this.asCalloutSource());
//   }
//
// Add helper method to your AIController class:
//
//   asCalloutSource() {
//     return {
//       id: this.id,
//       name: this.name,
//       team: this.team,
//       position: this.mesh.position,
//       personality: this.personality,
//     };
//   }
//
// In the positioning logic for Domination/Hardpoint modes, when choosing
// StrategicPositions, blend in objective-priority zones:
//
//   if (gameState.mode === 'domination') {
//     const prio = getPriorityZonesFor(this.team);
//     if (prio.length > 0) {
//       // Bias position choice toward top-priority zone
//       const target = prio[0].pos;
//       // Mix with existing position preference using weight 0.6
//     }
//   } else if (gameState.mode === 'hardpoint') {
//     const hp = getHardpointPriority();
//     if (hp) {
//       // Strong bias toward hardpoint (weight 0.85)
//     }
//   }


// ┌─────────────────────────────────────────────────────────────────────┐
// │ PATCH 10: src/audio/SoundHooks.ts                                   │
// └─────────────────────────────────────────────────────────────────────┘
//
// Add these exported functions (can be stubs initially — new systems
// call them via optional chaining):
//
//   export function playADSIn(): void {
//     audioManager.play('sfx/ads_in', { volume: 0.4 });
//   }
//
//   export function playThunder(): void {
//     audioManager.play('sfx/thunder', { volume: 0.85, spatial: false });
//   }
//
//   export function playCapture(): void {
//     audioManager.play('sfx/capture', { volume: 0.7 });
//   }
//
//   export function playObjective(): void {
//     audioManager.play('sfx/objective_change', { volume: 0.7 });
//   }
//
//   export function playMelee(): void {
//     audioManager.play('sfx/melee', { volume: 0.85 });
//   }
//
//   export function playHeadshot(): void {
//     audioManager.play('sfx/headshot_ding', { volume: 0.55 });
//   }
//
// (If you don't have audio assets for these yet, leave them as no-ops and
// the new systems will still function — they all use optional chaining.)


// ┌─────────────────────────────────────────────────────────────────────┐
// │ PATCH 11: src/entities/AgentFactory.ts                              │
// └─────────────────────────────────────────────────────────────────────┘
//
// Find playAgentDeathAnimation(agent) — it can now be a no-op OR removed
// entirely. The ragdoll system takes over via Combat.ts. Leaving the
// function there as a no-op keeps other callers working:
//
//   // REPLACE existing body of playAgentDeathAnimation with:
//   export function playAgentDeathAnimation(agent: any): void {
//     // Ragdoll physics handle death animation now — this is a no-op.
//     // Keeping the function signature for backward compatibility.
//   }


// ┌─────────────────────────────────────────────────────────────────────┐
// │ PATCH 12: src/ui/UI.ts (or main UI setup)                           │
// └─────────────────────────────────────────────────────────────────────┘
//
// The new HUDs (FieldUpgrade HUD, Contract HUD, Dom/HP HUDs, BotVoice
// subtitles, finisher prompt, scope overlay, training HUDs) all
// self-inject. No wiring needed beyond calling their init functions.
//
// If you want to gate HUDs by mode visibility, you can find these IDs:
//   - #fieldUpgradeHUD     (always visible in-match)
//   - #contractHud         (main menu + post-match, collapsible)
//   - #domHud              (only visible when mode=domination)
//   - #hpHud               (only visible when mode=hardpoint)
//   - #botVoiceRadio       (stack of subtitle lines)
//   - #finisherPrompt      (context-sensitive, self-toggles)
//   - #scopeOverlay        (context-sensitive based on ADS)
//   - #trainingStatsHud    (only in training range)
//   - #trainingTutorialHud (only in training range)
//
// When switching modes, call disposeDomination() / disposeHardpoint()
// to clean up the HUD + visuals.


// ┌─────────────────────────────────────────────────────────────────────┐
// │ DEBUG FLAGS                                                         │
// └─────────────────────────────────────────────────────────────────────┘
//
// For testing each system in isolation, expose these console commands:
//
//   (window as any).debug = {
//     // Progression
//     awardXP: (n = 1000) => import('@/progression/PlayerProfile').then(m => m.awardAccountXP(n, 'debug')),
//     resetProfile: () => import('@/progression/PlayerProfile').then(m => m.resetProfile()),
//
//     // Weather
//     weather: (preset: string) => import('@/weather/DynamicWeather').then(m => m.transitionTo(preset as any, 5)),
//
//     // Finisher (teleport to closest enemy back)
//     finisher: () => import('@/finishers/Finishers').then(m => m.tryInitiateFinisher()),
//
//     // Mode switch at runtime
//     mode: (m: string) => {
//       import('@/core/GameState').then(g => { g.gameState.mode = m as any; });
//       // Then call init for the new mode
//     },
//
//     // Training range
//     training: () => import('@/tutorial/TrainingRange').then(m => m.enterTrainingRange(scene)),
//     exitTraining: () => import('@/tutorial/TrainingRange').then(m => m.exitTrainingRange()),
//
//     // Ragdoll test (kill nearest enemy with dramatic physics)
//     ragdoll: () => { /* find nearest agent, spawnRagdoll with upward impulse */ },
//
//     // Contract debug
//     completeContracts: () => import('@/contracts/ContractSystem').then(m => m.__debugCompleteAll()),
//   };
//


// ═══════════════════════════════════════════════════════════════════════
//  QUICK SANITY CHECKLIST
// ═══════════════════════════════════════════════════════════════════════
//
// After applying all patches, you should see:
//
//   [✓] At game start: profile loaded from localStorage (XP bar visible)
//   [✓] Killing an enemy: XP popup + ragdoll physics on the corpse
//   [✓] 3+ kills in a row: contract progress bar ticks
//   [✓] Pressing Z: field upgrade activates (stim/dead silence/etc.)
//   [✓] Holding V behind an enemy: "HOLD V TO EXECUTE" prompt + cinematic
//   [✓] Aiming down sights: smooth FOV zoom + scope overlay (for scoped weapons)
//   [✓] Holding SHIFT while ADS (sniper): breath meter drains, sway reduces
//   [✓] Mid-match: weather transitions with particles + subtle sky shift
//   [✓] Switching to Domination mode: 3 zones appear, HUD updates
//   [✓] Switching to Hardpoint mode: rotating hill with beam + HUD
//   [✓] Enemy bots: occasional voice callouts with team-colored subtitles
//   [✓] Training menu option: lands in range with tutorial overlay
//
// If any of these don't work, open browser devtools and check:
//   - Console errors (most likely cause: missing imports)
//   - localStorage (warzone_profile_v1, warzone_loadouts_v1, warzone_contracts_v1)
//   - Element inspector for the HUD elements listed above
//
// ═══════════════════════════════════════════════════════════════════════

export {};