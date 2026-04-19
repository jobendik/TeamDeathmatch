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
import { buildNavMeshBlob } from '@/ai/navigation/NavMeshBuilder';
import { initViewmodel } from '@/rendering/WeaponViewmodel';
import { initMenus } from '@/ui/Menus';
import { initSettings } from '@/ui/Settings';
import { initAmbientDust, initParticlePools } from '@/combat/Particles';
import { updateHUD } from '@/ui/HUD';
import { updateScoreboard } from '@/ui/Scoreboard';
import { initPostProcess } from '@/rendering/PostProcess';
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
import { initDomination } from '@/combat/Domination';
import { initHardpoint } from '@/combat/Hardpoint';
import { initKoth } from '@/combat/KingOfTheHill';
import { initSd } from '@/combat/Searchanddestroy';
import { getSunLight, getAmbientLight } from '@/world/Lights';
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

async function init(): Promise<void> {
  setLoadProgress(5, 'Initializing scene…');
  initScene();
  Audio.init();
  setLoadProgress(15, 'Building arena…');
  buildLights();
  await buildArena();
  buildCoverPoints();

  setLoadProgress(20, 'Loading NavMesh…');
  try {
    const bakedNavMeshUrl = `${import.meta.env.BASE_URL}models/arena_navmesh.gltf`;
    await gameState.navMeshManager.load(bakedNavMeshUrl);
    gameState.pathPlanner = new AsyncPathPlanner(gameState.navMeshManager);
  } catch (err) {
    console.warn('[main] Failed to load baked NavMesh, falling back to runtime build.', err);

    try {
      const navBlobUrl = await buildNavMeshBlob();
      await gameState.navMeshManager.load(navBlobUrl);
      URL.revokeObjectURL(navBlobUrl);
      gameState.pathPlanner = new AsyncPathPlanner(gameState.navMeshManager);
    } catch (fallbackErr) {
      console.error('[main] Failed to build NavMesh:', fallbackErr);
    }
  }

  setLoadProgress(30, 'Spawning agents…');
  await buildAgents();

  setLoadProgress(60, 'Loading pickups…');
  buildPickups();
  buildObjectives();
  setLoadProgress(75, 'Loading viewmodels…');
  initViewmodel();
  bindEvents();
  initMenus();
  initSettings();
  initAmbientDust();
  initParticlePools();

  setLoadProgress(90, 'Initializing post-processing…');
  // Post-process pipeline
  const fx = initPostProcess();
  setPostFX(fx);

  // Hook resize into post-FX too
  window.addEventListener('resize', () => fx.resize());

  // MORESCRIPTS — init meta-systems (persistent)
  initPlayerProfile();
  initLoadouts();
  initContracts();

  // MORESCRIPTS — init match-level systems
  initFieldUpgrade();
  initFinishers();
  initEnhancedADS();
  initDynamicWeather(gameState.scene, getAmbientLight(), getSunLight());
  initPingSystem();
  initEmotes(gameState.camera);

  // MORESCRIPTS — main menu wired to mode init
  initMainMenu((mode, _loadoutIndex) => {
    gameState.mode = mode;
    initModeState(mode);
  });

  // Init current mode state (for skip-menu / default mode)
  initModeState(gameState.mode);

  updateHUD();
  updateScoreboard();

  setLoadProgress(100, 'Ready!');
  // Hide loading screen
  const ls = document.getElementById('loadingScreen');
  if (ls) ls.classList.remove('on');

  document.body.classList.add('ready');

  animate();
}

init().catch((err) => console.error('[main] init failed:', err));
