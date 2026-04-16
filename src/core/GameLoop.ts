import { gameState } from './GameState';
import { updatePlayer } from '@/entities/Player';
import { updateAI } from '@/ai/AIController';
import { updateProjectiles } from '@/combat/Hitscan';

import { updateParticles, updateScreenShake } from '@/combat/Particles';
import { updatePickups } from '@/combat/Pickups';
import { updateRespawns } from '@/combat/Combat';
import { updateObjectives } from '@/combat/Objectives';
import { updateVisuals } from '@/rendering/Visuals';
import { updateAgentAnimations } from '@/rendering/AgentAnimations';
import { keepInside } from '@/entities/Player';
import { drawMinimap } from '@/ui/Minimap';
import { updateTabboard, updateScoreboard } from '@/ui/Scoreboard';
import { updateViewmodel, renderViewmodel } from '@/rendering/WeaponViewmodel';
import { updateCrosshair } from '@/ui/HUD';

/** Track whether we were frozen last frame so we can discard the stale delta on unpause */
let wasFrozen = false;

/**
 * Main game loop — called every animation frame.
 */
export function animate(): void {
  requestAnimationFrame(animate);

  const frozen = gameState.mainMenuOpen || gameState.paused || gameState.roundOver;

  // Always tick the YUKA clock so getDelta doesn't accumulate while paused
  gameState.time.update();
  const rawDt = gameState.time.getDelta();

  // If we were frozen last frame, discard the accumulated delta to prevent time-jump
  const dt = (frozen || wasFrozen) ? 0 : Math.min(rawDt, 0.05);
  wasFrozen = frozen;

  // Floor shader animation runs even when paused (cosmetic only)
  if (gameState.floorMat) {
    gameState.floorMat.uniforms.uTime.value += dt;
  }

  if (!frozen && dt > 0) {
    // Advance world time only when gameplay is active
    gameState.worldElapsed += dt;
    gameState.matchTimeRemaining = Math.max(0, gameState.matchTimeRemaining - dt);

    // Increment perception stagger counter
    gameState.perceptionFrame++;

    updatePlayer(dt);

    for (const ag of gameState.agents) {
      updateAI(ag, dt);
    }

    updateProjectiles(dt);
    updateParticles(dt);
    updateScreenShake(dt);
    updatePickups();
    updateObjectives();
    updateRespawns();
    updateVisuals();
    updateAgentAnimations(gameState.agents, dt);

    gameState.entityManager.update(dt);
  }

  // Keep all AI inside arena (always, even if frozen, to prevent drift)
  for (const ag of gameState.agents) {
    if (ag !== gameState.player && !ag.isDead) {
      keepInside(ag);
    }
  }

  drawMinimap();
  updateScoreboard();
  updateTabboard();
  updateCrosshair();

  updateViewmodel(frozen ? 0 : dt);

  gameState.renderer.render(gameState.scene, gameState.camera);
  renderViewmodel();
}
