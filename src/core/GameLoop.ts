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
import { updateHUD, updateCrosshair } from '@/ui/HUD';
import { drawMinimap } from '@/ui/Minimap';
import { updateTabboard, updateScoreboard } from '@/ui/Scoreboard';
import { updateViewmodel, renderViewmodel } from '@/rendering/WeaponViewmodel';
import { updateCompass } from '@/ui/Compass';
import { updateDamageArcs } from '@/ui/DamageArcs';
import { updateReloadRing } from '@/ui/ReloadRing';
import { getPostFX } from '@/rendering/PostProcess.Bridge';

export function animate(): void {
  requestAnimationFrame(animate);

  const rawDt = Math.min(gameState.time.update().getDelta(), 0.05);
  const frozen = !!gameState.paused;
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

    gameState.entityManager.update(dt);

    for (const ag of gameState.agents) {
      if (ag !== gameState.player && !ag.isDead) keepInside(ag);
    }

    updateVisuals();
    updateAgentAnimations(gameState.agents, dt);
    updateDamageArcs(dt);
  }

  updateHUD();
  drawMinimap();
  updateTabboard();
  updateScoreboard();
  updateCrosshair();
  updateCompass();
  updateReloadRing();

  updateViewmodel(rawDt);

  // Post-process FX
  const fx = getPostFX();
  if (fx) {
    // Drive low-HP effect from player HP
    const hpT = Math.max(0, 1 - gameState.pHP / 35);
    fx.setLowHp(gameState.pDead ? 0 : hpT);
    fx.update(rawDt);
    fx.composer.render();
  } else {
    gameState.renderer.render(gameState.scene, gameState.camera);
  }

  renderViewmodel();
}
