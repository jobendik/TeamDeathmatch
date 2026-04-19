import '@/styles/index.css';

import { Audio } from '@/audio/AudioManager';
import { initScene } from '@/core/SceneSetup';
import { bindEvents } from '@/core/EventManager';
import { animate } from '@/core/GameLoop';
import { buildLights } from '@/world/Lights';
import { buildArena } from '@/world/Arena';
import { buildCoverPoints } from '@/world/CoverPoints';
import { buildAgents } from '@/entities/AgentFactory';
import { buildPickups } from '@/combat/Pickups';
import { buildObjectives } from '@/combat/Objectives';
import { AsyncPathPlanner } from '@/ai/navigation/PathPlanner';
import { initViewmodel, preloadViewmodels } from '@/rendering/WeaponViewmodel';
import { initMenus } from '@/ui/Menus';
import { initSettings } from '@/ui/Settings';
import { initAmbientDust, initParticlePools } from '@/combat/Particles';
import { updateHUD } from '@/ui/HUD';
import { updateScoreboard } from '@/ui/Scoreboard';
import { initPostProcess } from '@/rendering/PostProcess';
import { initScreenFX } from '@/rendering/ScreenFX';
import { setPostFX } from '@/rendering/PostProcess.Bridge';

// MORESCRIPTS — new system imports
import { initPlayerProfile } from '@/core/PlayerProfile';
import { initLoadouts } from '@/config/Loadouts';
import { initFieldUpgrade } from '@/combat/FieldUpgradeController';
import { initContracts } from '@/ui/ContractSystem';
import { initFinishers } from '@/combat/Finishers';
import { initEnhancedADS } from '@/combat/EnhancedADS';
import { initDynamicWeather } from '@/world/DynamicWeather';
import { initPingSystem } from '@/ui/CommWheel';
import { initEmotes } from '@/ui/Emotes';
import { initMainMenu } from '@/ui/MainMenu';
import { showMainMenu } from '@/ui/MainMenu';
import { startMatchFromMenu } from '@/ui/Menus';
import { initDomination } from '@/combat/Domination';
import { initHardpoint } from '@/combat/Hardpoint';
import { initKoth } from '@/combat/KingOfTheHill';
import { initSd } from '@/combat/Searchanddestroy';
import { getSunLight, getAmbientLight } from '@/world/Lights';
import { initNavDebug } from '@/core/NavDebug';
import { gameState } from '@/core/GameState';
import type { GameMode } from '@/core/GameModes';

function setLoadProgress(pct: number, text: string): void {
  const fill = document.getElementById('lsFill');
  const txt = document.getElementById('lsText');
  if (fill) fill.style.width = pct + '%';
  if (txt) txt.textContent = text;
}

function initModeState(mode: GameMode): void {
  switch (mode) {
    case 'domination': initDomination(gameState.scene); break;
    case 'hardpoint':  initHardpoint(gameState.scene); break;
    case 'koth':       initKoth(gameState.scene); break;
    case 'sd':         initSd(gameState.scene); break;
    default: break; // tdm, ffa, ctf, elimination, br, training — no extra init
  }
}

/**
 * Two-phase boot:
 *
 *   Phase 1 — Fast boot (runs on page load):
 *     • renderer + scene + camera
 *     • audio, player profile, loadouts, contracts
 *     • ScreenFX (CSS overlays)
 *     • MainMenu is constructed and shown
 *     • `animate()` is NOT started yet — there's nothing to render
 *       behind the menu, so no reason to burn frames
 *
 *   Phase 2 — Match-assets load (runs the FIRST time the player
 *   clicks PLAY in the main menu):
 *     • arena.glb, baked navmesh, cover points
 *     • agents (character GLBs)
 *     • pickups, objectives, viewmodels (+ weapon GLB preload)
 *     • particle pools, ambient dust, dynamic weather
 *     • field upgrade / finishers / enhanced ADS / ping / emotes
 *     • shader precompile
 *     • `animate()` is started here
 *
 *   Phase 2 is idempotent — subsequent matches skip it and go
 *   straight into `startMatchFromMenu(mode)`.
 */
let matchAssetsLoaded = false;
let matchAssetsLoading: Promise<void> | null = null;

async function loadMatchAssets(): Promise<void> {
  if (matchAssetsLoaded) return;
  if (matchAssetsLoading) return matchAssetsLoading;

  matchAssetsLoading = (async () => {
    // Show the loading screen again — this is the "real" asset load.
    const ls = document.getElementById('loadingScreen');
    if (ls) ls.classList.add('on');

    setLoadProgress(5, 'Building arena…');
    buildLights();
    await buildArena();

    setLoadProgress(20, 'Loading NavMesh…');
    const forceRuntime = new URLSearchParams(location.search).has('runtimeNav');
    let navLoaded = false;
    if (!forceRuntime) {
      const bakedNavMeshUrl = `${import.meta.env.BASE_URL}models/arena_navmesh.gltf`;
      try {
        await gameState.navMeshManager.load(bakedNavMeshUrl);
        console.info(`[NavMesh] Loaded baked navmesh: ${gameState.navMeshManager.navMesh?.regions.length} regions`);
        navLoaded = true;
      } catch (err) {
        console.warn('[NavMesh] Failed to load baked navmesh — trying runtime builder.', err);
      }
    }
    if (!navLoaded) {
      try {
        const { buildNavMeshBlob } = await import('@/ai/navigation/NavMeshBuilder');
        const blobUrl = await buildNavMeshBlob();
        await gameState.navMeshManager.load(blobUrl);
        URL.revokeObjectURL(blobUrl);
        console.info(`[NavMesh] Built runtime navmesh: ${gameState.navMeshManager.navMesh?.regions.length} regions`);
      } catch (err) {
        console.warn('[NavMesh] Runtime navmesh build also failed — bots will wander without pathfinding.', err);
      }
    }
    gameState.pathPlanner = new AsyncPathPlanner(gameState.navMeshManager);
    buildCoverPoints();

    setLoadProgress(35, 'Spawning agents…');
    await buildAgents();

    setLoadProgress(55, 'Loading pickups…');
    buildPickups();
    buildObjectives();

    setLoadProgress(70, 'Loading viewmodels…');
    initViewmodel();
    await preloadViewmodels();

    setLoadProgress(80, 'Initializing FX…');
    initAmbientDust();
    initParticlePools();

    // Match-level systems that need the built scene/lights/camera.
    initFieldUpgrade();
    initFinishers();
    initEnhancedADS();
    initDynamicWeather(gameState.scene, getAmbientLight(), getSunLight());
    initPingSystem();
    initEmotes(gameState.camera);

    setLoadProgress(90, 'Compiling shaders…');
    try {
      if (typeof (gameState.renderer as any).compileAsync === 'function') {
        await (gameState.renderer as any).compileAsync(gameState.scene, gameState.camera);
      } else {
        gameState.renderer.compile(gameState.scene, gameState.camera);
      }
      console.info('[perf] Shader precompile complete.');
    } catch (err) {
      console.warn('[perf] Shader precompile failed (non-fatal):', err);
    }

    // Navigation debug tools — need the loaded navmesh.
    initNavDebug();

    updateHUD();
    updateScoreboard();

    setLoadProgress(100, 'Ready!');
    // Give the user's eye ~150ms on "Ready!" before fading.
    await new Promise((r) => setTimeout(r, 150));
    if (ls) ls.classList.remove('on');

    // Start the render loop now that there's actually something to render.
    animate();

    matchAssetsLoaded = true;
  })();

  try {
    await matchAssetsLoading;
  } finally {
    matchAssetsLoading = null;
  }
}

/**
 * Called from MainMenu when the player clicks PLAY. Loads assets on
 * the first call, then kicks off the match.
 */
async function onMainMenuStart(mode: GameMode): Promise<void> {
  gameState.mode = mode;
  await loadMatchAssets();
  initModeState(mode);
  await startMatchFromMenu(mode);
}

async function init(): Promise<void> {
  // ── Phase 1: fast boot ───────────────────────────────────────────
  setLoadProgress(20, 'Initializing…');
  initScene();
  Audio.init();

  setLoadProgress(40, 'Preparing UI…');
  bindEvents();
  initMenus();
  initSettings();

  // Persistent meta-systems — cheap, no asset loads.
  initPlayerProfile();
  initLoadouts();
  initContracts();

  setLoadProgress(60, 'Initializing screen FX…');
  const wantsPostFX = new URLSearchParams(location.search).has('postfx');
  if (wantsPostFX) {
    const fx = initPostProcess();
    setPostFX(fx);
    window.addEventListener('resize', () => fx.resize());
    console.info('[FX] GPU post-processing enabled (?postfx=1).');
  } else {
    const fx = initScreenFX();
    setPostFX(fx);
    console.info('[FX] Lightweight ScreenFX (CSS overlays) enabled. Pass ?postfx=1 for the full GPU post stack.');
  }

  setLoadProgress(80, 'Loading main menu…');

  // Expose core game state to window for ad-hoc debugging.
  const postFxMod = await import('@/rendering/PostProcess.Bridge');
  (window as any).__td = {
    gameState,
    get navMeshManager() { return gameState.navMeshManager; },
    get pathPlanner() { return gameState.pathPlanner; },
    perf: (await import('@/core/PerfProfiler')).perf,
    get postFX() { return postFxMod.getPostFX(); },
    renderInfo() {
      const info = gameState.renderer.info;
      return {
        calls: info.render.calls,
        triangles: info.render.triangles,
        points: info.render.points,
        lines: info.render.lines,
        frame: info.render.frame,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
      };
    },
    setShadows(on: boolean) {
      gameState.renderer.shadowMap.enabled = on;
      gameState.renderer.shadowMap.needsUpdate = true;
      console.log('[td] shadows =', on);
    },
    async perfTest(seconds = 6) {
      const perf = (await import('@/core/PerfProfiler')).perf;
      const fx = postFxMod.getPostFX();
      const hasComposer = !!(fx && 'composer' in fx && (fx as any).composer);
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const run = async (label: string) => {
        console.log(`%c[perfTest] ▶ ${label} — ${seconds}s`, 'color:#0af;font-weight:bold');
        perf.enable();
        await wait(seconds * 1000);
        perf.dump();
      };
      if (!hasComposer) {
        this.setShadows(true); await wait(500);
        await run('A: shadows ON (ScreenFX / no composer)');
        this.setShadows(false); await wait(500);
        await run('B: shadows OFF (ScreenFX / no composer)');
        this.setShadows(true);
      } else {
        (fx as any).setQuality('high'); this.setShadows(true); await wait(500);
        await run('A: bloom ON, shadows ON (baseline)');
        (fx as any).setQuality('low'); this.setShadows(true); await wait(500);
        await run('B: bloom OFF, shadows ON');
        (fx as any).setQuality('low'); this.setShadows(false); await wait(500);
        await run('C: bloom OFF, shadows OFF');
        (fx as any).setQuality('high'); this.setShadows(true);
      }
      console.log(`%c[perfTest] ✓ done`, 'color:#0f0;font-weight:bold');
      console.log('renderInfo:', this.renderInfo());
    },
    THREE: (window as any).THREE,
  };

  // Wire the MainMenu — clicking PLAY triggers Phase-2 asset load.
  initMainMenu(
    (mode, _loadoutIndex) => { void onMainMenuStart(mode); },
    () => { void onMainMenuStart('training'); },
  );

  setLoadProgress(100, 'Ready!');
  await new Promise((r) => setTimeout(r, 120));
  const ls = document.getElementById('loadingScreen');
  if (ls) ls.classList.remove('on');
  document.body.classList.add('ready');

  // Freeze simulation; render loop is NOT started — MainMenu is a pure
  // DOM overlay and doesn't need the 3D canvas animated behind it.
  gameState.paused = true;
  gameState.mainMenuOpen = true;
  showMainMenu();
}

init().catch((err) => console.error('[main] init failed:', err));
