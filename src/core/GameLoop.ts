import { gameState } from './GameState';
import { updatePlayer, keepInside } from '@/entities/Player';
import { updateAI } from '@/ai/AIController';
import { updateProjectiles } from '@/combat/Hitscan';
import { updateParticles, updateScreenShake } from '@/combat/Particles';
import { updatePickups } from '@/combat/Pickups';
import { updateRespawns } from '@/combat/Combat';
import { updateObjectives } from '@/combat/Objectives';
import { updateVisuals } from '@/rendering/Visuals';
import { updateAgentAnimations } from '@/rendering/AgentAnimations';
import { updateHUD } from '@/ui/HUD';
import { drawMinimap } from '@/ui/Minimap';
import { updateTabboard, updateScoreboard } from '@/ui/Scoreboard';
import { updateViewmodel, renderViewmodel } from '@/rendering/WeaponViewmodel';
import { updateCrosshair } from '@/ui/HUD';

export function animate(): void {
  requestAnimationFrame(animate);

  const rawDt = Math.min(gameState.time.update().getDelta(), 0.05);
  const frozen = !!gameState.isPaused || !!gameState.inMainMenu;
  const dt = frozen ? 0 : rawDt;

  if (gameState.floorMat) {
    gameState.floorMat.uniforms.uTime.value = gameState.worldElapsed;
  }

  if (!frozen && dt > 0) {
    gameState.worldElapsed += dt;
    gameState.matchTimeRemaining = Math.max(0, gameState.matchTimeRemaining - dt);
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

    // Let YUKA apply steering, transforms, and render sync first
    gameState.entityManager.update(dt);

    // Clamp AI after movement
    for (const ag of gameState.agents) {
      if (ag !== gameState.player && !ag.isDead) {
        keepInside(ag);
      }
    }

    updateVisuals();

    // Update skeletal animation after transforms/velocity are current
    updateAgentAnimations(gameState.agents, dt);
  }

  updateHUD();
  drawMinimap();
  updateTabboard();
  updateScoreboard();
  updateCrosshair();

  updateViewmodel(dt);

  gameState.renderer.render(gameState.scene, gameState.camera);
  renderViewmodel();
}
