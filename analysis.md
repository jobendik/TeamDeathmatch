# Full Codebase & Gameplay Analysis — TeamDeathmatch

## 1. AI Bot System — What's Strong, What's Missing

### What's Already Impressive
The AI is genuinely sophisticated for a browser game. You have:
- **8 personality archetypes** (Rusher, Anchor, Picker, Support, Lurker, Wildcard, Veteran, Rookie) with ~30 personality dimensions each
- **Spring-based aim simulation** (HumanAim.ts) — flick, overshoot, settle, micro-jitter, drift, flinch
- **Fuzzy logic** for aggression decisions (health × distance → aggression)
- **YUKA goal-driven AI** with evaluators for Attack, Survive, Reload, SeekHealth, GetWeapon, Hunt
- **Team callout system** with delay, noise, reliability per personality
- **Match memory** — zone-based danger heatmap that bots avoid
- **Emotional modeling** — tilt, grudges, confidence, panic spray

### What's Missing for Truly Human-Like Bots

**A. No Spatial Reasoning / Map Knowledge**
- Bots have **no concept of map lanes, choke points, or power positions**. They wander randomly via `WanderBehavior`. Real players learn map flow within minutes.
- **Missing**: Predefined patrol routes / waypoint graphs per map with weighted preferences by archetype (snipers prefer high ground, flankers prefer side paths).
- **Missing**: Power-position awareness — bots should know which spots control sightlines and contest them.

**B. No Predictive Position Tracking**
- `decayEnemyMemory` does basic velocity extrapolation (`lastVelocity * dt * 0.3`), but bots don't **predict where players will rotate to**. Real players read movement patterns ("he always pushes left side").
- **Missing**: Pattern recognition — track which lanes/routes the player uses frequently and pre-aim or pre-rotate.

**C. No Coordinated Team Tactics**
- `TeamTacticalBoard` interface exists in AITypes.ts with `TeamIntent` (hold, collapse, flank_left, etc.) but **it's never used**. There's no `updateTeamTactics()` anywhere.
- Bots fight as individuals who happen to share callouts. No pincer movements, no coordinated pushes, no trading kills.
- **Missing**: A team commander / IGL system — one bot per team decides the team intent, and others adjust their goal evaluator weights accordingly.

**D. No Utility-Based Weapon Switching**
- Bots use their class default weapon forever. There's `GetWeaponEvaluator` for pickups, but bots never **swap between weapons** situationally (e.g., switch to pistol at close range when sniper is equipped).
- **Missing**: Secondary weapon slot for bots, range-based weapon preference.

**E. No Movement Abilities**
- Bots **cannot crouch-walk, sprint, slide, mantle, or lean**. They set `isBotCrouching = true` in cover but this is only a flag — their speed doesn't change, and there's no visual crouch.
- Real players slide into cover, sprint between positions, and crouch spam during duels.
- **Missing**: Movement state machine for bots mirroring the player's `MovementController` — at minimum sprint-to-engage and crouch-in-cover with actual speed modifiers.

**F. No Pre-Aim / Crosshair Placement**
- `preAimBias` exists on `Personality` and `preAimPos` on `TDMAgent`, but they're **never read**. Bots don't pre-aim corners or headshot height.
- **Missing**: When approaching corners or doorways, bots should set their aim to head-height at the corner edge before peeking.

**G. No Sound-Triggered Behavior**
- `checkAudioAwareness` only checks bullets near the bot. Bots can't hear **footsteps, reloads, or weapon swaps**. The player's footstep system (`playFootstep`) produces audio, but bots don't process it.
- **Missing**: A spatial sound event system that bots can listen to — sprint footsteps, reload sounds, grenade bounces.

**H. No Difficulty Scaling**
- All bots share the same skill distribution. There's no **adaptive difficulty** based on the player's performance (K/D ratio, accuracy).
- **Missing**: Dynamic skill adjustment — if the player is dominating (3+ K/D), subtly increase bot reaction times and aim accuracy, and vice versa.

---

## 2. Shooting & Weapon System

### What's Strong
- Hitscan with **headshot hitbox** detection (head sphere at y=1.42, r=0.22)
- **Weapon variety**: 8 weapon types with distinct stats (damage, fire rate, burst, reload, range, spread)
- **Recoil system** on viewmodel with per-weapon profiles
- **ADS** with FOV reduction and crosshair tightening
- Shotgun pellet spread, rocket projectiles with splash damage, grenades with arced physics
- Headshot multipliers per weapon (2.5× for sniper, 2.0× for pistol, etc.)

### What's Missing

**A. No Recoil Pattern / Spray Pattern**
- Recoil is purely visual (viewmodel kick). There's **no actual bullet spread increase over sustained fire** for the player. The crosshair gap widens visually (`fireKick` in `updateCrosshair`) but shots don't become less accurate.
- **Missing**: Cumulative spread that increases per shot during a burst (like CS2's spray patterns). First-shot accuracy should be tight, bullets 5+ should climb vertically.

**B. No Bullet Penetration**
- Walls completely block all shots. No wallbanging through thin cover, no material-based penetration values.
- **Missing**: Material system on walls (wood, metal, concrete) with penetration damage falloff.

**C. No Damage Falloff Curve**
- There's a single binary range check: `if (wep.range < 40 && hitDist > wep.range * 0.6) dmg *= 0.7`. This is a single step, not a curve.
- **Missing**: Linear or quadratic damage falloff based on distance, per weapon.

**D. No Weapon Attachments / Customization**
- Weapons are static definitions. No barrel, sight, grip, or magazine mods.
- **Missing**: Attachment system (red dot, ACOG, suppressor, extended mag) that modifies base stats.

**E. No Hip-Fire vs ADS Accuracy Split**
- ADS reduces crosshair visual gap but doesn't actually tighten hitscan spread for player shots. The player fires a perfect ray from camera center regardless of ADS state.
- **Missing**: Actual accuracy difference between hip-fire and ADS for the player.

**F. No Ammo Reserve System**
- Player reloads to full mag infinitely (outside BR). There's no total ammo reserve (e.g., 30/120).
- **Missing**: Ammo reserve pool that depletes, requiring ammo pickups or scavenging.

**G. No Melee System Beyond Knife**
- Knife is a hitscan weapon with range 3. No actual melee lunge, no gun butt, no melee animation.
- **Missing**: Proper melee with lunge, animation, backstab bonus.

---

## 3. Movement System

### What's Strong
- Sprint, crouch, slide with friction curve, lean (Q/E), coyote time, jump buffering
- Mantle detection via raycast
- Head-bob tied to footstep cadence
- FOV kick for sprint/slide/ADS
- Air control with reduced authority

### What's Missing

**A. No Prone**
- Standard in AAA FPS games. No way to go prone for minimum profile.

**B. No Weapon-Dependent Movement Speed**
- `movePenalty` exists in weapon definitions but is **only used for accuracy** (`getSpeedMultiplier` in `MovementController` ignores weapon weight). Running with a rocket launcher should be slower than running with a knife.
- **Missing**: Apply `movePenalty` as a speed modifier.

**C. No Stair/Ramp Geometry**
- The arena is perfectly flat. `stepHeight: 0.4` exists in config but the arena has no stepped terrain.
- **Missing**: Elevation changes, ramps, multi-level structures.

**D. No Inertia / Acceleration Modeling**
- Movement is velocity-smoothed but essentially instant direction changes. There's no skill expression in counter-strafing or momentum control.
- **Missing**: Distinct acceleration/deceleration curves so players feel weight.

**E. No Dolphin-Dive / Tactical Actions**
- No dive-to-prone, no tactical roll, no drop-shot.

---

## 4. HUD & UI

### What's Strong
- Health bar with low-HP pulse, ammo counter, weapon name + icon + fire-mode label
- 3-slot weapon strip, reload bar, grenade counter
- Dynamic crosshair (gap responds to movement, firing, ADS, airborne state)
- Full compass strip with cardinal directions
- Killfeed with team colors and weapon names
- Damage directional arcs (8-point compass)
- Medal/XP system with 16 medals, tiered announcements
- Match challenges (3 random per match)
- Floating damage numbers, hit markers, kill markers
- Minimap with FOV cone, wall rendering, pickup dots, enemy spotting
- Killcam replay with over-shoulder camera
- Scoreboard with K/D/Score
- Round summary

### What's Missing

**A. No Settings/Options Menu**
- No sensitivity slider, no FOV slider, no audio volume controls, no keybind rebinding, no graphics quality presets.
- `Audio` has `setMaster/setSfx/setMusic` methods but **no UI to control them**.
- **Critical gap** — AAA games always have comprehensive settings.

**B. No Hit Feedback Differentiation**
- Hit markers don't distinguish between body shots and headshots visually (they're the same marker). `showHitMarker(false)` is always called with `isHeadshot: false`.
- **Missing**: Distinct headshot hit marker (different color/shape/sound).

**C. No Kill Streak / Scorestreak System**
- `killStreak` exists on `TDMAgent` but is **only reset on death** — never displayed or used for any reward.
- **Missing**: Scorestreak rewards (UAV, airstrike, etc.) or at minimum voice line callouts for streaks.

**D. No Player Stats Screen**
- No accuracy tracking, no damage dealt/taken, no K/D history, no end-of-match performance breakdown.
- **Missing**: Post-match stats (accuracy %, damage dealt, headshot %, medals earned).

**E. No Loading / Lobby Screen**
- Game immediately inits and drops into gameplay. No class selection, no team selection, no pre-match countdown.
- **Missing**: Pre-match lobby with team roster, class picker, map preview.

**F. No ADS Scope Renders**
- Sniper scope only hides the crosshair and shows a `scopeOverlay`. No actual scope render-to-texture zoom.
- **Missing**: Picture-in-picture scope rendering for sniper rifles.

**G. No Kill Streak Audio/Visual**
- No "Double Kill!" voice line, no "Enemy AC-130 above!" type alerts. Medals display as text but there's no audio reinforcement.

---

## 5. Audio System

### What's Strong
- Full Web Audio API pipeline with dynamic compressor
- 3D positional audio via PannerNode
- Separate gain buses for SFX / Voice / Music / UI
- Synth fallback for every sound (no asset dependency)
- Heartbeat system for low HP

### What's Missing

**A. No Music System**
- `busMusic` exists but there's **no music playing anywhere**. No menu theme, no match music, no combat intensification music.

**B. No Environmental Audio**
- No ambient sounds, no wind, no reverb zones, no explosion echoes.

**C. No Weapon-Specific Bot Audio**
- Bots don't produce distinct weapon sounds that the player can identify by ear to know what they're facing.

**D. No Spatialized Footstep System for Bots**
- Bot footsteps aren't generated based on their movement speed. The player can't hear approaching enemies.

---

## 6. Rendering / Visual Polish

### What's Strong
- Post-processing pipeline: ACES filmic tone mapping, Unreal bloom, FXAA, cinematic vignette shader, hit pulse, low-HP desaturation
- Animated FBX character models (Swat + Enemy variants) with full 8-direction locomotion sets
- Viewmodel system with animated GLB weapons (M16, pistol, shotgun, sniper, grenade launcher, knife)
- Muzzle flash, tracers, impact particles, wall sparks, explosions, rocket trails
- HP bars and name tags on agents

### What's Missing

**A. No Shadow System**
- `castShadow = true` is set on some meshes but there's **no shadow-casting light** configured in Lights.ts (would need to check, but the arena uses basic lighting).

**B. No Environmental Particles**
- No dust motes, no fog of war effect at arena boundaries, no atmospheric haze.

**C. No Bullet Holes / Decals**
- Wall hits produce spark particles that vanish instantly. No persistent bullet hole decals on surfaces.

**D. No Death Ragdoll**
- Death is `renderComponent.visible = false` + a particle burst. No ragdoll physics, no death animation playback (death anims exist in AgentAnimations.ts but only trigger if the animated model loaded).

**E. No Weather / Time-of-Day**
- Static lighting. No day/night cycle, no rain, no dynamic skybox.

---

## 7. Core Game Systems

### What's Missing

**A. No Progression / Unlock System**
- No XP that persists between matches, no weapon unlocks, no cosmetics, no rank/level.
- `matchState.playerXP` accumulates during a match but is **never saved or used**.

**B. No Map Pool**
- Single hardcoded arena. No map selection, no map rotation, no procedural variation.

**C. No Player Class System**
- The player doesn't select a class. Bots have 4 classes (rifleman, assault, sniper, flanker) but the player always spawns as a generic character.

**D. No Replay System**
- Killcam exists but no full match replay or Play of the Game.

**E. No Network/Multiplayer Foundation**
- Fully single-player with bots. No client-server architecture, no WebSocket/WebRTC layer.

---

## Priority Recommendations (Highest Impact)

| Priority | Feature | Reason |
|----------|---------|--------|
| **1** | Settings menu (sensitivity, FOV, audio, keybinds) | Unplayable for many users without this |
| **2** | Actual recoil/spread patterns for player | Core gunplay depth is shallow without this |
| **3** | Bot team coordination (use `TeamTacticalBoard`) | Bots fight as individuals, making matches predictable |
| **4** | Bot movement abilities (sprint between positions, crouch in fights) | Bots feel robotic without movement variation |
| **5** | Pre-aim / crosshair placement for bots | Single biggest tell that opponents are bots |
| **6** | Death animations (the FBX assets already exist) | Enemies vanishing on death breaks immersion |
| **7** | Headshot hit marker differentiation | Missing core FPS feedback |
| **8** | Map elevation / multi-level design | Flat arena limits tactical depth |
| **9** | Adaptive difficulty | Matches feel either too easy or too hard |
| **10** | Ammo reserve + weapon-weight movement speed | Core resource management missing | 

Completed: *Compile comprehensive analysis* (7/7)

The analysis above covers every system in the codebase. The strongest areas are your **AI personality/aim simulation** and **post-processing pipeline** — both are well above typical browser-game quality. The biggest gaps to AAA feel are: settings menu, actual ballistic recoil, team-coordinated AI, bot movement abilities, and death animations (which your FBX assets already support).