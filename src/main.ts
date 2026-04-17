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
import { initAmbientDust } from '@/combat/Particles';
import { updateHUD } from '@/ui/HUD';
import { updateScoreboard } from '@/ui/Scoreboard';
import { initPostProcess } from '@/rendering/PostProcess';
import { setPostFX } from '@/rendering/PostProcess.Bridge';

async function init(): Promise<void> {
  initScene();
  Audio.init();
  buildLights();
  buildArena();
  buildCoverPoints();

  await buildAgents();

  buildPickups();
  buildObjectives();
  initViewmodel();
  bindEvents();
  initMenus();
  initSettings();
  initAmbientDust();

  // Post-process pipeline
  const fx = initPostProcess();
  setPostFX(fx);

  // Hook resize into post-FX too
  window.addEventListener('resize', () => fx.resize());

  updateHUD();
  updateScoreboard();

  document.body.classList.add('ready');

  animate();
}

init().catch((err) => console.error('[main] init failed:', err));
