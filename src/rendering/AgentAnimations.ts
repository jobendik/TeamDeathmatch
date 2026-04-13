import * as THREE from 'three';
import type { TDMAgent } from '@/entities/TDMAgent';
import { gameState } from '@/core/GameState';

/**
 * Simple skeletal-style animations for bot characters.
 * Krunker/Roblox-inspired: walking leg bob, shooting recoil, head tracking, death fall.
 */

/**
 * Update all agent animations each frame.
 */
export function updateAgentAnimations(dt: number): void {
  const elapsed = gameState.worldElapsed;

  for (const ag of gameState.agents) {
    if (ag === gameState.player) continue;
    if (!ag.renderComponent) continue;

    const mesh = ag.renderComponent;

    if (ag.isDead) {
      // Death animation: fall over and fade
      animateDeath(mesh, dt);
      continue;
    }

    // Get velocity-based speed for animation
    const vx = ag.velocity?.x ?? 0;
    const vz = ag.velocity?.z ?? 0;
    const speed = Math.sqrt(vx * vx + vz * vz);
    const isMoving = speed > 0.5;

    // Get parts by index (keeping reference to our mesh hierarchy)
    const parts = mesh.children;
    if (parts.length < 9) continue; // needs legs, boots, torso, belt, shoulders, head, visor, gun, ring + extras

    const legL = parts[0]; // left leg
    const legR = parts[1]; // right leg
    const bootL = parts[2]; // left boot
    const bootR = parts[3]; // right boot
    const torso = parts[4];
    const belt = parts[5];
    const shoulderL = parts[6];
    const shoulderR = parts[7];
    const head = parts[8];
    const visor = parts[9];
    const gun = parts[10];

    // ── Walking animation ──
    if (isMoving) {
      const walkFreq = 8 + speed * 0.8;
      const walkAmp = Math.min(0.4, speed * 0.06);
      const phase = elapsed * walkFreq;

      // Leg swing
      if (legL) legL.rotation.x = Math.sin(phase) * walkAmp;
      if (legR) legR.rotation.x = Math.sin(phase + Math.PI) * walkAmp;

      // Boot follows leg
      if (bootL) bootL.position.z = 0.02 + Math.sin(phase) * walkAmp * 0.08;
      if (bootR) bootR.position.z = 0.02 + Math.sin(phase + Math.PI) * walkAmp * 0.08;

      // Body bob
      if (torso) torso.position.y = 0.98 + Math.abs(Math.sin(phase * 2)) * 0.02;
      if (belt) belt.position.y = 0.72 + Math.abs(Math.sin(phase * 2)) * 0.01;

      // Arm swing
      if (shoulderL) shoulderL.rotation.x = Math.sin(phase + Math.PI) * walkAmp * 0.3;
      if (shoulderR) shoulderR.rotation.x = Math.sin(phase) * walkAmp * 0.3;

      // Slight body lean in movement direction
      mesh.rotation.x = speed * 0.015;
    } else {
      // Idle: subtle breathing
      const breathPhase = elapsed * 2;
      if (legL) legL.rotation.x *= 0.9; // smoothly return to neutral
      if (legR) legR.rotation.x *= 0.9;
      if (bootL) bootL.position.z += (0.02 - bootL.position.z) * 0.1;
      if (bootR) bootR.position.z += (0.02 - bootR.position.z) * 0.1;
      if (torso) torso.position.y = 0.98 + Math.sin(breathPhase) * 0.005;
      if (belt) belt.position.y = 0.72 + Math.sin(breathPhase) * 0.003;
      mesh.rotation.x *= 0.9;
    }

    // ── Head tracking (look at target) ──
    if (ag.currentTarget && !ag.currentTarget.isDead && head) {
      const tx = ag.currentTarget.position.x - ag.position.x;
      const tz = ag.currentTarget.position.z - ag.position.z;
      const targetAngle = Math.atan2(tx, tz);
      const bodyAngle = Math.atan2(
        Math.sin(mesh.rotation.y),
        Math.cos(mesh.rotation.y),
      );
      let headTurn = targetAngle - bodyAngle;
      // Normalize to -PI..PI
      while (headTurn > Math.PI) headTurn -= Math.PI * 2;
      while (headTurn < -Math.PI) headTurn += Math.PI * 2;
      // Clamp head turn
      headTurn = Math.max(-0.6, Math.min(0.6, headTurn));
      head.rotation.y += (headTurn - head.rotation.y) * dt * 5;
      if (visor) visor.rotation.y = head.rotation.y;
    } else if (head) {
      head.rotation.y *= 0.95; // return to center
      if (visor) visor.rotation.y *= 0.95;
    }

    // ── Shooting recoil ──
    if (ag.burstCount > 0 && ag.burstTimer > 0) {
      // Gun kick back
      if (gun) {
        gun.position.z = 0.2 + 0.05; // kick backward
        gun.rotation.x = -0.15;       // tilt up
      }
      // Upper body recoil
      if (torso) torso.rotation.x = -0.03;
      if (shoulderR) shoulderR.position.z = 0.05;
    } else {
      // Return to neutral
      if (gun) {
        gun.position.z += (0.2 - gun.position.z) * dt * 10;
        gun.rotation.x *= 0.85;
      }
      if (torso) torso.rotation.x += (0 - torso.rotation.x) * dt * 8;
      if (shoulderR) shoulderR.position.z += (0 - shoulderR.position.z) * dt * 8;
    }
  }
}

/**
 * Death fall-over animation.
 */
function animateDeath(mesh: THREE.Group, dt: number): void {
  // Fall over backwards
  if (mesh.rotation.x > -Math.PI / 2) {
    mesh.rotation.x -= dt * 4;
    mesh.position.y -= dt * 1.5;
    if (mesh.position.y < -0.4) mesh.position.y = -0.4;
  }
}

/**
 * Reset mesh rotation when an agent respawns.
 */
export function resetAgentAnimation(mesh: THREE.Group): void {
  mesh.rotation.x = 0;
  mesh.rotation.z = 0;
  mesh.position.y = 0;

  for (const child of mesh.children) {
    child.rotation.x = 0;
    child.rotation.y = 0;
  }
}
