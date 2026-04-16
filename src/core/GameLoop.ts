/**
 * GameLoop — Optimized main loop.
 *
 * Key perf changes for BR:
 * - Bot AI updates delegated to BRController (which uses LOD gating)
 * - Particle count capped and culled by distance
 * - Only nearby agent animations are updated
 * - Minimap/HUD/scoreboard update rates throttled
 */

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

// BR imports — lazy to avoid loading when not in BR
let brModule: typeof import('@/br/BRController') | null = null;
let brHudModule: typeof import('@/br/BRHUD') | null = null;
let brInvModule: typeof import('@/br/InventoryUI') | null = null;

async function ensureBR() {
  if (!brModule) brModule = await import('@/br/BRController');
  if (!brHudModule) brHudModule = await import('@/br/BRHUD');
  if (!brInvModule) brInvModule = await import('@/br/InventoryUI');
}

let _hudThrottle = 0;
let _minimapThrottle = 0;

export function animate(): void {
  requestAnimationFrame(animate);

  const rawDt = Math.min(gameState.time.update().getDelta(), 0.05);
  const frozen = !!gameState.paused;
  const dt = frozen ? 0 : rawDt;
  const isBR = gameState.mode === 'br';

  // Floor shader time
  if (gameState.floorMat?.uniforms?.uTime) {
    gameState.floorMat.uniforms.uTime.value = gameState.worldElapsed;
  }

  if (!frozen && dt > 0) {
    gameState.worldElapsed += dt;
    gameState.matchTimeRemaining = Math.max(0, gameState.matchTimeRemaining - dt);
    gameState.perceptionFrame++;

    updatePlayer(dt);

    if (isBR && brModule?.isBRActive()) {
      // BR mode: BRController handles LOD-gated bot updates
      brModule.updateBR(dt);
    } else {
      // Arena modes: update all bots every frame
      for (const ag of gameState.agents) {
        updateAI(ag, dt);
      }
    }

    updateProjectiles(dt);
    updateParticles(dt);
    updateScreenShake(dt);

    if (!isBR) updatePickups();

    updateObjectives();
    updateRespawns();

    // In BR airdrop, skip heavy per-agent work (YUKA steering, collision, animations)
    const brDropping = isBR && brModule && brModule.getBRPhase() === 'airdrop';

    if (!brDropping) {
      gameState.entityManager.update(dt);
    }

    // Clamp agents after movement
    if (!brDropping) {
      for (const ag of gameState.agents) {
        if (ag !== gameState.player && !ag.isDead) keepInside(ag);
      }
    }

    // LOD-aware visuals: only update animations for nearby agents in BR
    if (brDropping) {
      // skip visuals/animations entirely during drop
    } else if (isBR) {
      updateVisualsLOD();
      updateAgentAnimationsLOD(dt);
    } else {
      updateVisuals();
      updateAgentAnimations(gameState.agents, dt);
    }

    updateDamageArcs(dt);
  }

  // ── HUD / UI (throttled for perf) ──
  updateHUD();
  updateCrosshair();

  // Minimap every 2nd frame in BR (it's expensive with 30+ dots)
  _minimapThrottle++;
  if (!isBR || _minimapThrottle % 2 === 0) drawMinimap();

  // Scoreboard/tabboard
  _hudThrottle++;
  if (_hudThrottle % 3 === 0) {
    updateScoreboard();
    updateTabboard();
  }

  updateCompass();
  updateReloadRing();

  // BR HUD
  if (isBR && brHudModule) brHudModule.updateBRHUD();
  if (isBR && brInvModule) brInvModule.updatePickupPrompt();

  // Viewmodel
  updateViewmodel(rawDt);

  // ── Render ──
  const fx = getPostFX();
  if (fx) {
    const hpT = Math.max(0, 1 - gameState.pHP / 35);
    fx.setLowHp(gameState.pDead ? 0 : hpT);
    fx.update(rawDt);
    fx.composer.render();
  } else {
    gameState.renderer.render(gameState.scene, gameState.camera);
  }

  renderViewmodel();
}

/**
 * LOD-aware visual updates for BR — skip far agents.
 */
function updateVisualsLOD(): void {
  const { agents, player, camera } = gameState;
  const px = player.position.x;
  const pz = player.position.z;

  for (const ag of agents) {
    if (ag === player) continue;
    if (ag.isDead || !ag.active) {
      if (ag.renderComponent) ag.renderComponent.visible = false;
      if (ag.nameTag) ag.nameTag.visible = false;
      continue;
    }

    const dx = ag.position.x - px;
    const dz = ag.position.z - pz;
    const d2 = dx * dx + dz * dz;

    // LOD3+ : invisible
    if (d2 > 160 * 160) {
      if (ag.renderComponent) ag.renderComponent.visible = false;
      continue;
    }

    if (ag.renderComponent) ag.renderComponent.visible = true;

    // HP bar — only within 45m
    if (ag.hpBarGroup) {
      const showHP = d2 < 45 * 45;
      ag.hpBarGroup.visible = showHP;
      if (showHP) {
        ag.hpBarGroup.quaternion.copy(camera.quaternion);
        const pct = Math.max(0, ag.hp / ag.maxHP);
        ag.hpBarFg!.scale.x = Math.max(0.01, pct);
        ag.hpBarFg!.position.x = -(1 - pct) * 0.5;
        let barColor: number;
        if (pct > 0.6) barColor = 0x22c55e;
        else if (pct > 0.3) barColor = 0xf59e0b;
        else barColor = 0xef4444;
        (ag.hpBarFg!.material as THREE.MeshBasicMaterial).color.setHex(barColor);
      }
    }

    // Name tags — only within 35m
    if (ag.nameTag) ag.nameTag.visible = d2 < 35 * 35;
  }
}

/**
 * Only animate nearby agents' skeletons. Far agents freeze in their last pose.
 */
function updateAgentAnimationsLOD(dt: number): void {
  const px = gameState.player.position.x;
  const pz = gameState.player.position.z;
  const nearAgents: import('@/entities/TDMAgent').TDMAgent[] = [];

  for (const ag of gameState.agents) {
    if (ag === gameState.player || ag.isDead || !ag.active) continue;
    const dx = ag.position.x - px;
    const dz = ag.position.z - pz;
    if (dx * dx + dz * dz < 100 * 100) nearAgents.push(ag);
  }

  // Only update animations for nearby agents (mixer.update is expensive)
  updateAgentAnimations(nearAgents, dt);
}

// Eagerly load BR modules when mode is set to BR
export async function preloadBRModules(): Promise<void> {
  await ensureBR();
}
