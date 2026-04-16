import * as THREE from 'three';
import { gameState } from './GameState';
import { FP } from '@/config/player';
import { dom } from '@/ui/DOMElements';
import { WEAPONS } from '@/config/weapons';
import { hitscanShot, shotgunBlast, spawnRocket, spawnGrenade } from '@/combat/Hitscan';
import { updateHUD, flashCrosshairFire } from '@/ui/HUD';
import { fireViewmodel, setViewmodelWeapon, resizeViewmodel } from '@/rendering/WeaponViewmodel';
import { togglePause } from '@/ui/Menus';
import { isPlayerInAir } from '@/br/DropPlane';

function startReload(): void {
  if (gameState.pWeaponId === 'unarmed') return; // can't reload unarmed
  const wep = WEAPONS[gameState.pWeaponId];
  gameState.pReloading = true;
  gameState.pReloadTimer = 0;
  gameState.pReloadDuration = wep.reloadTime;
  dom.reloadBar.classList.add('on');
  dom.reloadText.classList.add('on');
}

function switchWeapon(slot: number): void {
  if (slot >= gameState.pWeaponSlots.length) return;
  if (gameState.pActiveSlot === slot) return;
  if (gameState.pReloading) {
    gameState.pReloading = false;
    dom.reloadBar.classList.remove('on');
    dom.reloadText.classList.remove('on');
  }

  gameState.pActiveSlot = slot;
  gameState.pWeaponId = gameState.pWeaponSlots[slot];

  const wep = WEAPONS[gameState.pWeaponId];
  gameState.pAmmo = wep.magSize;
  gameState.pMaxAmmo = wep.magSize;
  gameState.pShootTimer = 0;
  gameState.pBurstCount = 0;

  setViewmodelWeapon(gameState.pWeaponId);
  updateHUD();
}

export function onShoot(): void {
  if (gameState.pDead || gameState.pReloading) return;
  if (gameState.pWeaponId === 'unarmed') return; // can't shoot unarmed
  if (gameState.pShootTimer > 0) return;
  if (isPlayerInAir()) return; // no shooting during BR drop

  const { player, cameraYaw, cameraPitch, pWeaponId } = gameState;
  const wep = WEAPONS[pWeaponId];

  // Knife melee attack — no ammo needed
  if (pWeaponId === 'knife') {
    const o = new THREE.Vector3(player.position.x, player.position.y + FP.height - 0.2, player.position.z);
    const dir = new THREE.Vector3(
      -Math.sin(cameraYaw) * Math.cos(cameraPitch),
      Math.sin(cameraPitch),
      -Math.cos(cameraYaw) * Math.cos(cameraPitch),
    ).normalize();
    hitscanShot(o, dir, 'player', player.team, pWeaponId, 0x60a5fa, player);
    fireViewmodel();
    gameState.pShootTimer = wep.fireRate;
    updateHUD();
    return;
  }

  if (gameState.pAmmo <= 0) { startReload(); return; }

  const o = new THREE.Vector3(player.position.x, player.position.y + FP.height - 0.2, player.position.z);
  const fwd = new THREE.Vector3(
    -Math.sin(cameraYaw) * Math.cos(cameraPitch),
    Math.sin(cameraPitch),
    -Math.cos(cameraYaw) * Math.cos(cameraPitch),
  ).normalize();

  const dir = fwd.clone();
  const err = wep.aimError * (gameState.keys.shift ? 0.6 : 1.0);
  dir.x += (Math.random() - 0.5) * err;
  dir.y += (Math.random() - 0.5) * err * 0.5;
  dir.z += (Math.random() - 0.5) * err;
  dir.normalize();

  if (pWeaponId === 'rocket_launcher') {
    spawnRocket(o, dir, 'player', player.team, 0x60a5fa, player);
  } else if (pWeaponId === 'shotgun') {
    shotgunBlast(o, fwd, 'player', player.team, 0x60a5fa, player);
  } else {
    hitscanShot(o, dir, 'player', player.team, pWeaponId, 0x60a5fa, player);
  }

  fireViewmodel();
  flashCrosshairFire();
  gameState.pAmmo--;
  gameState.pShootTimer = wep.fireRate;
  updateHUD();

  if (gameState.pAmmo <= 0) startReload();
}

function throwGrenade(): void {
  if (gameState.pDead) return;
  if (gameState.pGrenades <= 0) return;
  if (gameState.pGrenadeCooldown > 0) return;
  if (isPlayerInAir()) return; // no grenades during BR drop

  const { player, cameraYaw, cameraPitch } = gameState;
  const o = new THREE.Vector3(player.position.x, player.position.y + FP.height, player.position.z);
  const dir = new THREE.Vector3(
    -Math.sin(cameraYaw) * Math.cos(cameraPitch),
    Math.sin(cameraPitch),
    -Math.cos(cameraYaw) * Math.cos(cameraPitch),
  ).normalize();

  spawnGrenade(o, dir, 'player', player.team, player);
  gameState.pGrenades--;
  gameState.pGrenadeCooldown = 1.0;
  updateHUD();
}

function requestMouseLock(): void {
  gameState.renderer?.domElement?.requestPointerLock();
}

function onPointerLockChange(): void {
  gameState.mouseLocked = document.pointerLockElement === gameState.renderer.domElement;
  dom.lockHint.classList.toggle('on', !gameState.mouseLocked && !gameState.mainMenuOpen && !gameState.paused && !gameState.roundOver);
}

function onMouseMove(e: MouseEvent): void {
  if (!gameState.mouseLocked || gameState.pDead) return;
  gameState.cameraYaw -= e.movementX * FP.sensitivity;
  gameState.cameraPitch -= e.movementY * FP.sensitivity;
  gameState.cameraPitch = Math.max(FP.pitchMin, Math.min(FP.pitchMax, gameState.cameraPitch));
  gameState.mouseDeltaX += e.movementX;
  gameState.mouseDeltaY += e.movementY;
}

export function bindEvents(): void {
  const { keys } = gameState;

  window.addEventListener('keydown', async (e) => {
    const k = e.key.toLowerCase();
    if (k in keys) { (keys as any)[k] = true; e.preventDefault(); }
    if (k === 'tab') { e.preventDefault(); keys.tab = true; }

    if (k === 'r' && !gameState.pDead && !gameState.pReloading && gameState.pWeaponId !== 'unarmed' && gameState.pAmmo < gameState.pMaxAmmo) {
      startReload();
    }

    if (k === 'g') throwGrenade();

    if (k === '1') switchWeapon(0);
    if (k === '2') switchWeapon(1);
    if (k === '3') switchWeapon(2);

    // BR keys
    if (gameState.mode === 'br') {
      if (k === 'i') {
        const ui = await import('@/br/InventoryUI');
        ui.toggleInventory();
        e.preventDefault();
        return;
      }
      if (k === 'e') {
        const ui = await import('@/br/InventoryUI');
        ui.pickupNearestLoot();
      }
      if (k === ' ') {
        const dp = await import('@/br/DropPlane');
        if (dp.drop.state === 'onPlane') { dp.playerJumpFromPlane(); return; }
        if (dp.drop.state === 'freefall') { dp.deployParachute(); return; }
      }
      if (k === 'f') {
        const veh = await import('@/br/Vehicles');
        if (veh.playerVehicle) {
          veh.exitVehicle();
        } else {
          const near = veh.findNearbyVehicle(gameState.player.position.x, gameState.player.position.z, 3);
          if (near) veh.enterVehicle(near, true);
        }
      }
    }

    // Jump (all game modes) — Space triggers a ground jump
    if (k === ' ' && !gameState.pDead) {
      gameState.pJumpRequested = true;
    }

    if (k === 'escape') {
      e.preventDefault();
      if (gameState.mode === 'br') {
        const ui = await import('@/br/InventoryUI');
        if (ui.isInventoryOpen()) { ui.closeInventory(); return; }
      }
      togglePause();
      return;
    }
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in keys) (keys as any)[k] = false;
    if (k === 'tab') keys.tab = false;
  });

  window.addEventListener('resize', () => {
    gameState.camera.aspect = innerWidth / innerHeight;
    gameState.camera.updateProjectionMatrix();
    gameState.renderer.setSize(innerWidth, innerHeight);
    resizeViewmodel();
  });

  window.addEventListener('wheel', (e) => {
    if (!gameState.mouseLocked) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    const newSlot = (gameState.pActiveSlot + dir + gameState.pWeaponSlots.length) % gameState.pWeaponSlots.length;
    switchWeapon(newSlot);
  });

  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('mousemove', onMouseMove);

  gameState.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  gameState.renderer.domElement.addEventListener('mousedown', (e) => {
    if (gameState.paused || gameState.mainMenuOpen) return;
    if (e.button !== 0) return;
    if (!gameState.mouseLocked) { requestMouseLock(); return; }
    gameState.mouseHeld = true;
    onShoot();
  });

  gameState.renderer.domElement.addEventListener('mouseup', (e) => {
    if (e.button === 0) gameState.mouseHeld = false;
  });

  dom.lockHint.addEventListener('click', () => requestMouseLock());
}
