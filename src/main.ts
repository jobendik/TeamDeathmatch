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

async function init(): Promise<void> {
  initScene();
  buildLights();
  buildArena();
  buildCoverPoints();

  // IMPORTANT:
  // Wait for SWAT model + animations to load and for agents to be created
  await buildAgents();

  buildPickups();
  initViewmodel();
  bindEvents();

  // Start the main loop only after everything is ready
  animate();
}

void init();
