import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { TEAM_BLUE } from '@/config/constants';

/**
 * Update HP bars, name tags, and visibility for all agents every frame.
 */
export function updateVisuals(): void {
  const { agents, player, camera } = gameState;

  for (const ag of agents) {
    if (ag === player) continue;

    if (ag.nameTag) ag.nameTag.visible = !ag.isDead;
    if (!ag.hpBarGroup) continue;

    ag.hpBarGroup.visible = !ag.isDead;
    if (!ag.hpBarGroup.visible) continue;

    ag.hpBarGroup.quaternion.copy(camera.quaternion);

    const pct = Math.max(0, ag.hp / ag.maxHP);
    ag.hpBarFg!.scale.x = Math.max(0.01, pct);
    ag.hpBarFg!.position.x = -(1 - pct) * 0.5;

    // Smoother HP bar color with pulse effect when critical
    let barColor: number;
    if (pct > 0.6) barColor = 0x22c55e;
    else if (pct > 0.3) barColor = 0xf59e0b;
    else {
      barColor = 0xef4444;
      // Critical HP pulse
      const pulse = Math.sin(gameState.worldElapsed * 8) * 0.3 + 0.7;
      (ag.hpBarFg!.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
    (ag.hpBarFg!.material as THREE.MeshBasicMaterial).color.setHex(barColor);
    if (pct > 0.3) {
      (ag.hpBarFg!.material as THREE.MeshBasicMaterial).opacity = 1;
    }

    // Hide enemy name tags / HP bars if too far or not spotted
    if (ag.team !== TEAM_BLUE) {
      const d = ag.position.distanceTo(player.position);
      const vis = d < 45;
      ag.nameTag!.visible = vis && !ag.isDead;
      ag.hpBarGroup.visible = vis && !ag.isDead;
    }
  }
}
