/**
 * GameLoop — Optimised main loop.
 *
 * Battle-royale specific perf work:
 *  - Inactive agents (deactivated arena bots in BR, not-yet-landed BR bots)
 *    are skipped by every per-agent loop, including keepInside — arena
 *    colliders are large in BR, so iterating them needlessly was costing
 *    real time
 *  - Skip all agent-related work while the player is freefalling; the
 *    drop plane sequence handles the camera, bots are inactive, and the
 *    entity manager has nothing to do
 *  - LOD-aware visuals/animations bail out on deactivated agents early
 */

import * as THREE from 'three';
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

// Lazy imports — keep BR modules out of the initial bundle cost.
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

  if (gameState.floorMat?.uniforms?.uTime) {
    gameState.floorMat.uniforms.uTime.value = gameState.worldElapsed;
  }

  if (!frozen && dt > 0) {
    gameState.worldElapsed += dt;
    gameState.matchTimeRemaining = Math.max(0, gameState.matchTimeRemaining - dt);
    gameState.perceptionFrame++;

    updatePlayer(dt);

    if (isBR && brModule?.isBRActive()) {
      brModule.updateBR(dt);
    } else {
      for (const ag of gameState.agents) {
        if (!ag.active) continue;
        updateAI(ag, dt);
      }
    }

    updateProjectiles(dt);
    updateParticles(dt);
    updateScreenShake(dt);

    if (!isBR) updatePickups();

    updateObjectives();
    updateRespawns();

    // In BR we want to skip heavy per-agent work for the entire time the
    // player is airborne, not just the 'airdrop' phase. Otherwise the
    // moment the player jumps, 29 bots would all wake up at once.
    const brPhase = isBR && brModule ? brModule.getBRPhase() : null;
    const brOnPlane = brPhase === 'airdrop';
    // 'landing' phase lasts 20s after player jumps but the player is in
    // freefall/parachute for only ~6-8s of that. We still want bots
    // active during the rest of landing, so we key on isPlayerInAir.
    let brAirborne = false;
    if (isBR && brModule?.isBRActive()) {
      // Probe DropPlane lazily — avoid import cycles.
      const dp = (globalThis as any).__dropState as { state?: string } | undefined;
      // Fallback: use phase check — conservative.
      brAirborne = brOnPlane;
      if (dp && typeof dp.state === 'string') {
        brAirborne = brOnPlane ||
          dp.state === 'freefall' || dp.state === 'parachute';
      }
    }

    if (!brOnPlane) {
      gameState.entityManager.update(dt);
    }

    // keepInside is cheap per-call but iterates arena colliders each time.
    // In BR there are hundreds of wall colliders — skip inactive agents.
    if (!brOnPlane) {
      for (const ag of gameState.agents) {
        if (ag === gameState.player || ag.isDead || !ag.active) continue;
        keepInside(ag);
      }
    }

    if (brOnPlane) {
      // Plane window: nothing agent-related runs. Bots are inactive,
      // visuals not needed.
    } else if (isBR) {
      updateVisualsLOD();
      updateAgentAnimationsLOD(dt);
    } else {
      updateVisuals();
      updateAgentAnimations(gameState.agents, dt);
    }

    updateDamageArcs(dt);
  }

  updateHUD();
  updateCrosshair();

  _minimapThrottle++;
  if (!isBR || _minimapThrottle % 2 === 0) drawMinimap();

  _hudThrottle++;
  if (_hudThrottle % 3 === 0) {
    updateScoreboard();
    updateTabboard();
  }

  updateCompass();
  updateReloadRing();

  if (isBR && brHudModule) brHudModule.updateBRHUD();
  if (isBR && brInvModule) brInvModule.updatePickupPrompt();

  updateViewmodel(rawDt);

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
 * BR visuals — hides distant bots and inactive agents, only updates HP
 * bars and name tags within viewing range. Inactive agents (including
 * not-yet-landed bots) are handled first so we spend zero time on them.
 */
function updateVisualsLOD(): void {
  const { agents, player, camera } = gameState;
  const px = player.position.x;
  const pz = player.position.z;

  for (const ag of agents) {
    if (ag === player) continue;

    if (!ag.active || ag.isDead) {
      if (ag.renderComponent) ag.renderComponent.visible = false;
      if (ag.nameTag) ag.nameTag.visible = false;
      if (ag.hpBarGroup) ag.hpBarGroup.visible = false;
      continue;
    }

    const dx = ag.position.x - px;
    const dz = ag.position.z - pz;
    const d2 = dx * dx + dz * dz;

    if (d2 > 160 * 160) {
      if (ag.renderComponent) ag.renderComponent.visible = false;
      continue;
    }

    if (ag.renderComponent) ag.renderComponent.visible = true;

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

if (ag.nameTag) {
  const dist = Math.sqrt(d2);

  // Hide if too close (huge on screen) or too far (visual clutter)
  const showTag = dist > 5 && dist < 22;

  ag.nameTag.visible = showTag;

  if (showTag) {
    // Keep apparent screen size much more stable.
    // Perspective makes nearby sprites huge; scaling by distance counters that.
    const s = THREE.MathUtils.clamp(dist * 0.055, 0.42, 0.95);
    ag.nameTag.scale.set(0.9 * s, 0.22 * s, 1);
  }
}
}

/**
 * Only animate skeletons for nearby, active agents. Far bots were
 * already downgraded to the cheap procedural mesh by BRBots' LOD system,
 * so their render component has no agentAnimController and is skipped
 * by the controller check inside updateAgentAnimations itself.
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

  updateAgentAnimations(nearAgents, dt);
}

export async function preloadBRModules(): Promise<void> {
  await ensureBR();
}
