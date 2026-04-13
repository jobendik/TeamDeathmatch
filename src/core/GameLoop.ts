import { gameState } from './GameState';
import { updatePlayer } from '@/entities/Player';
import { updateAI } from '@/ai/AIController';
import { updateProjectiles } from '@/combat/Hitscan';

import { updateParticles, updateScreenShake } from '@/combat/Particles';
import { updatePickups } from '@/combat/Pickups';
import { updateRespawns } from '@/combat/Combat';
import { updateVisuals } from '@/rendering/Visuals';
import { updateAgentAnimations } from '@/rendering/AgentAnimations';
import { keepInside } from '@/entities/Player';
import { drawMinimap } from '@/ui/Minimap';
import { updateTabboard } from '@/ui/Scoreboard';
import { updateViewmodel, renderViewmodel } from '@/rendering/WeaponViewmodel';
import { updateCrosshair } from '@/ui/HUD';

/**
 * Main game loop — called every animation frame.
 */
export function animate(): void {
  requestAnimationFrame(animate);

  const dt = Math.min(gameState.time.update().getDelta(), 0.05);
  gameState.worldElapsed += dt;

  if (gameState.floorMat) {
    gameState.floorMat.uniforms.uTime.value = gameState.worldElapsed;
  }

  updatePlayer(dt);

  // Update all AI
  for (const ag of gameState.agents) {
    updateAI(ag, dt);
  }

  updateProjectiles(dt);
  updateParticles(dt);
  updateScreenShake(dt);
  updatePickups();
  updateRespawns();
  updateVisuals();
  updateAgentAnimations(dt);

  gameState.entityManager.update(dt);

  // Keep all AI inside arena
  for (const ag of gameState.agents) {
    if (ag !== gameState.player && !ag.isDead) {
      keepInside(ag);
    }
  }

  drawMinimap();
  updateTabboard();
  updateCrosshair();

  updateViewmodel(dt);

  gameState.renderer.render(gameState.scene, gameState.camera);
  renderViewmodel();
}
