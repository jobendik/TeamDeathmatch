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
import { initViewmodel } from '@/rendering/WeaponViewmodel';
import { initMenus } from '@/ui/Menus';
import { initSettings } from '@/ui/Settings';
import { initAmbientDust, initParticlePools } from '@/combat/Particles';
import { updateHUD } from '@/ui/HUD';
import { updateScoreboard } from '@/ui/Scoreboard';
import { initPostProcess } from '@/rendering/PostProcess';
import { setPostFX } from '@/rendering/PostProcess.Bridge';

function setLoadProgress(pct: number, text: string): void {
  const fill = document.getElementById('lsFill');
  const txt = document.getElementById('lsText');
  if (fill) fill.style.width = pct + '%';
  if (txt) txt.textContent = text;
}

async function init(): Promise<void> {
  setLoadProgress(5, 'Initializing scene…');
  initScene();
  Audio.init();
  setLoadProgress(15, 'Building arena…');
  buildLights();
  buildArena();
  buildCoverPoints();

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
