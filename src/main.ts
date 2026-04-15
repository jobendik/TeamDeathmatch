/**
 * WARZONE TDM — Entry Point
 *
 * Initializes all game systems and starts the main loop.
 */

import '@/styles/index.css';

import { initScene } from '@/core/SceneSetup';
import { bindEvents } from '@/core/EventManager';
import { animate } from '@/core/GameLoop';
import { buildLights } from '@/world/Lights';
import { buildArena } from '@/world/Arena';
import { buildCoverPoints } from '@/world/CoverPoints';
import { buildAgents } from '@/entities/AgentFactory';
import { buildPickups } from '@/combat/Pickups';
import { initViewmodel } from '@/rendering/WeaponViewmodel';
import { buildObjectives } from '@/combat/Objectives';
import { initMenus } from '@/ui/Menus';
import { updateHUD } from '@/ui/HUD';
import { updateScoreboard } from '@/ui/Scoreboard';

function init(): void {
  initScene();
  buildLights();
  buildArena();
  buildCoverPoints();
  buildAgents();
  buildPickups();
  buildObjectives();
  initViewmodel();
  bindEvents();
  initMenus();
  updateHUD();
  updateScoreboard();
}

init();
animate();
