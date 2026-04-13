import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { FP } from '@/config/player';
import { WEAPONS } from '@/config/weapons';
import { ARENA_MARGIN, BLUE_SPAWNS } from '@/config/constants';
import { setViewmodelWeapon } from '@/rendering/WeaponViewmodel';
import { updateHUD, flashHeal } from '@/ui/HUD';
import { dom } from '@/ui/DOMElements';
import { onShoot } from '@/core/EventManager';
import type { TDMAgent } from './TDMAgent';
import type { Collider } from '@/core/GameState';

/**
 * Check if a position collides with any wall or arena boundary.
 */
function collidesPlayer(x: number, z: number): boolean {
  if (Math.abs(x) > ARENA_MARGIN || Math.abs(z) > ARENA_MARGIN) return true;
  for (const c of gameState.colliders) {
    if (c.type === 'box') {
      if (Math.abs(x - c.x) <= c.hw && Math.abs(z - c.z) <= c.hd) return true;
    } else {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz <= c.r * c.r) return true;
    }
  }
  return false;
}

/**
 * Keep an agent inside the arena, resolving collisions with walls and pillars.
 */
export function keepInside(ag: TDMAgent): void {
  const margin = Math.max(0.55, ag.boundingRadius) + 0.08;
  ag.position.x = Math.max(-ARENA_MARGIN + margin, Math.min(ARENA_MARGIN - margin, ag.position.x));
  ag.position.z = Math.max(-ARENA_MARGIN + margin, Math.min(ARENA_MARGIN - margin, ag.position.z));

  for (const c of gameState.arenaColliders) {
    if (c.type === 'box') {
      const dx = ag.position.x - c.x;
      const dz = ag.position.z - c.z;
      const ox = c.hw - Math.abs(dx);
      const oz = c.hd - Math.abs(dz);
      if (ox >= 0 && oz >= 0) {
        if (ox < oz) ag.position.x = c.x + Math.sign(dx || 1) * (c.hw + 0.06);
        else ag.position.z = c.z + Math.sign(dz || 1) * (c.hd + 0.06);
      }
    } else {
      let dx = ag.position.x - c.x;
      let dz = ag.position.z - c.z;
      let distSq = dx * dx + dz * dz;
      const minR = c.r + Math.max(0.08, ag.boundingRadius * 0.15);
      if (distSq < minR * minR) {
        if (distSq < 1e-6) { dx = 1; dz = 0; distSq = 1; }
        const dist = Math.sqrt(distSq);
        ag.position.x = c.x + (dx / dist) * (minR + 0.02);
        ag.position.z = c.z + (dz / dist) * (minR + 0.02);
      }
    }
  }

  if (ag.renderComponent) {
    ag.renderComponent.position.set(ag.position.x, ag.renderComponent.position.y, ag.position.z);
  }
}

/**
 * Update the player each frame: movement, reload, pickup collection, camera.
 */
export function updatePlayer(dt: number): void {
  const { player, keys, pickups } = gameState;

  if (gameState.pDead) {
    gameState.respTimer -= dt;
    dom.dsp.textContent = 'Respawner om ' + Math.max(0, gameState.respTimer).toFixed(1) + 's…';
    if (gameState.respTimer <= 0) {
      gameState.pDead = false;
      gameState.pHP = 100;
      player.hp = 100;
      gameState.pAmmo = gameState.pMaxAmmo;
      gameState.pReloading = false;
      dom.ds.classList.remove('on');
      const sp = BLUE_SPAWNS[Math.floor(Math.random() * BLUE_SPAWNS.length)];
      player.position.set(sp[0], 0, sp[2]);
      gameState.cameraYaw = Math.PI / 4;
      gameState.cameraPitch = 0;
      updateHUD();
    }
    gameState.camera.position.set(player.position.x, FP.height, player.position.z);
    gameState.camera.rotation.y = gameState.cameraYaw;
    gameState.camera.rotation.x = gameState.cameraPitch;
    return;
  }

  // Reload
  if (gameState.pReloading) {
    gameState.pReloadTimer += dt;
    const pct = Math.min(1, gameState.pReloadTimer / gameState.pReloadDuration) * 100;
    dom.reloadFill.style.width = pct + '%';
    if (gameState.pReloadTimer >= gameState.pReloadDuration) {
      gameState.pReloading = false;
      gameState.pAmmo = gameState.pMaxAmmo;
      updateHUD();
      dom.reloadBar.classList.remove('on');
      dom.reloadText.classList.remove('on');
    }
  }

  // Shoot timer cooldown
  if (gameState.pShootTimer > 0) {
    gameState.pShootTimer -= dt;
  }

  // Movement
  const spd = keys.shift ? FP.sprintSpeed : FP.moveSpeed;
  const forward = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
  const strafe = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  if (forward || strafe) {
    let mx = (-Math.sin(gameState.cameraYaw)) * forward + (Math.cos(gameState.cameraYaw)) * strafe;
    let mz = (-Math.cos(gameState.cameraYaw)) * forward + (-Math.sin(gameState.cameraYaw)) * strafe;
    const len = Math.hypot(mx, mz) || 1;
    mx /= len;
    mz /= len;
    const step = spd * dt;
    const nx = player.position.x + mx * step;
    const nz = player.position.z + mz * step;
    if (!collidesPlayer(nx, player.position.z)) player.position.x = nx;
    if (!collidesPlayer(player.position.x, nz)) player.position.z = nz;
  }

  // Pickup collection
  for (const pk of pickups) {
    if (!pk.active) continue;
    const dx = player.position.x - pk.x;
    const dz = player.position.z - pk.z;
    if (dx * dx + dz * dz < 2.2 * 2.2) {
      if (pk.t === 'health' && gameState.pHP < 100) {
        pk.active = false;
        pk.mesh.visible = pk.ring.visible = false;
        pk.respawnAt = gameState.worldElapsed + 15;
        gameState.pHP = Math.min(100, gameState.pHP + 35);
        player.hp = gameState.pHP;
        updateHUD();
        flashHeal();
      } else if (pk.t === 'ammo' && gameState.pAmmo < gameState.pMaxAmmo) {
        pk.active = false;
        pk.mesh.visible = pk.ring.visible = false;
        pk.respawnAt = gameState.worldElapsed + 12;
        gameState.pAmmo = Math.min(gameState.pMaxAmmo, gameState.pAmmo + 15);
        updateHUD();
      } else if (pk.t === 'weapon' && pk.weaponId) {
        pk.active = false;
        pk.mesh.visible = pk.ring.visible = false;
        pk.respawnAt = gameState.worldElapsed + 25;
        const wepId = pk.weaponId;
        if (!gameState.pWeaponSlots.includes(wepId)) {
          if (gameState.pWeaponSlots.length < 3) {
            gameState.pWeaponSlots.push(wepId);
          } else {
            gameState.pWeaponSlots[gameState.pActiveSlot] = wepId;
          }
        }
        gameState.pActiveSlot = gameState.pWeaponSlots.indexOf(wepId);
        gameState.pWeaponId = wepId;
        const wep = WEAPONS[wepId];
        gameState.pAmmo = wep.magSize;
        gameState.pMaxAmmo = wep.magSize;
        gameState.pShootTimer = 0;
        gameState.pBurstCount = 0;
        gameState.pReloading = false;
        dom.reloadBar.classList.remove('on');
        dom.reloadText.classList.remove('on');
        setViewmodelWeapon(wepId);
        updateHUD();
        flashHeal();
      }
    }
  }

  // HP regen near spawn
  if (player.position.distanceTo(player.spawnPos) < 8) {
    gameState.pHP = Math.min(100, gameState.pHP + dt * 10);
    player.hp = gameState.pHP;
    updateHUD();
  }

  // Auto-fire: keep shooting while mouse held
  if (gameState.mouseHeld && gameState.mouseLocked) {
    onShoot();
  }

  // Grenade cooldown
  if (gameState.pGrenadeCooldown > 0) {
    gameState.pGrenadeCooldown -= dt;
  }

  // Camera
  gameState.camera.position.set(player.position.x, FP.height, player.position.z);
  gameState.camera.rotation.y = gameState.cameraYaw;
  gameState.camera.rotation.x = gameState.cameraPitch;
}
