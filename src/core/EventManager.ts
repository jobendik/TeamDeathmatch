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
import { getPlayerInventory, setBRActiveSlotByOrder, syncInventoryFromCombat } from '@/br/InventoryUI';
import { getAmmoPool } from '@/br/Inventory';


function getCameraForward(): THREE.Vector3 {
  const { cameraYaw, cameraPitch } = gameState;
  return new THREE.Vector3(
    -Math.sin(cameraYaw) * Math.cos(cameraPitch),
    Math.sin(cameraPitch),
    -Math.cos(cameraYaw) * Math.cos(cameraPitch),
  ).normalize();
}

function getAimPoint(fwd: THREE.Vector3, maxDist = 160): THREE.Vector3 {
  const origin = gameState.camera.position.clone();
  const rc = gameState.raycaster;
  rc.set(origin, fwd);
  rc.near = 0;
  rc.far = maxDist;
  const wallHits = rc.intersectObjects(gameState.wallMeshes, false);
  return wallHits.length > 0
    ? wallHits[0].point.clone()
    : origin.add(fwd.clone().multiplyScalar(maxDist));
}

function getShotOrigin(kind: 'hitscan' | 'projectile' | 'grenade'): THREE.Vector3 {
  const fwd = getCameraForward();
  const origin = gameState.camera.position.clone();
  if (kind === 'projectile') return origin.add(fwd.multiplyScalar(0.9)).add(new THREE.Vector3(0, -0.05, 0));
  if (kind === 'grenade') return origin.add(fwd.multiplyScalar(0.45)).add(new THREE.Vector3(0, -0.08, 0));
  return origin.add(fwd.multiplyScalar(0.15));
}

function updateBRAmmoAfterShot(): void {
  if (gameState.mode !== 'br') return;
  syncInventoryFromCombat();
}

function finishReloadForBR(): boolean {
  if (gameState.mode !== 'br') return false;
  const inv = getPlayerInventory();
  if (!inv) return false;
  const activeItem = inv.weaponSlots[inv.activeSlot];
  if (!activeItem || activeItem.category !== 'weapon' || !activeItem.weaponId) return false;

  return gameState.pAmmo < gameState.pMaxAmmo && getAmmoPool(inv, activeItem.weaponId) > 0;
}

function startReload(): void {
  if (gameState.pWeaponId === 'unarmed' || gameState.pWeaponId === 'knife') return;
  if (gameState.mode === 'br' && !finishReloadForBR()) return;
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

  if (gameState.mode === 'br') {
    if (!setBRActiveSlotByOrder(slot)) return;
    gameState.pShootTimer = 0;
    gameState.pBurstCount = 0;
    return;
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

  const { player, pWeaponId } = gameState;
  const wep = WEAPONS[pWeaponId];
  const fwd = getCameraForward();

  // Knife melee attack — no ammo needed
  if (pWeaponId === 'knife') {
    const o = new THREE.Vector3(player.position.x, player.position.y + FP.height - 0.2, player.position.z);
    hitscanShot(o, fwd, 'player', player.team, pWeaponId, 0x60a5fa, player);
    fireViewmodel();
    gameState.pShootTimer = wep.fireRate;
    updateHUD();
    return;
  }

  if (gameState.pAmmo <= 0) { startReload(); return; }

  const aimPoint = getAimPoint(fwd, Math.max(wep.range, 120));
  const originKind = pWeaponId === 'rocket_launcher' ? 'projectile' : 'hitscan';
  const o = getShotOrigin(originKind);
  const dir = aimPoint.clone().sub(o).normalize();
  const errMul = gameState.isADS ? 0.35 : gameState.keys.shift ? 1.35 : 1.0;
  const err = wep.aimError * errMul;
  if (err > 0) {
    dir.x += (Math.random() - 0.5) * err;
    dir.y += (Math.random() - 0.5) * err * 0.5;
    dir.z += (Math.random() - 0.5) * err;
    dir.normalize();
  }

  if (pWeaponId === 'rocket_launcher') {
    spawnRocket(o, dir, 'player', player.team, 0x60a5fa, player);
  } else if (pWeaponId === 'shotgun') {
    shotgunBlast(o, dir, 'player', player.team, 0x60a5fa, player);
  } else {
    hitscanShot(o, dir, 'player', player.team, pWeaponId, 0x60a5fa, player);
  }

  fireViewmodel();
  flashCrosshairFire();
  gameState.pAmmo--;
  updateBRAmmoAfterShot();
  gameState.pShootTimer = wep.fireRate;
  updateHUD();

  if (gameState.pAmmo <= 0) startReload();
}

function throwGrenade(): void {
  if (gameState.pDead) return;
  if (gameState.pGrenades <= 0) return;
  if (gameState.pGrenadeCooldown > 0) return;
  if (isPlayerInAir()) return; // no grenades during BR drop

  const { player } = gameState;
  const dir = getCameraForward();
  const o = getShotOrigin('grenade');

  spawnGrenade(o, dir, 'player', player.team, player);
  gameState.pGrenades--;
  syncInventoryFromCombat();
  gameState.pGrenadeCooldown = 1.0;
  updateHUD();
}

function requestMouseLock(): void {
  gameState.renderer?.domElement?.requestPointerLock();
}

function onPointerLockChange(): void {
  gameState.mouseLocked = document.pointerLockElement === gameState.renderer.domElement;
  if (!gameState.mouseLocked) gameState.isADS = false;
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

    if (k === 'enter' && gameState.mode === 'br' && gameState.pDead) {
      const br = await import('@/br/BRController');
      await br.startBRMatch();
      return;
    }

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
    if (!gameState.mouseLocked) {
      if (e.button === 0) requestMouseLock();
      return;
    }
    if (e.button === 2) {
      if (gameState.pWeaponId !== 'knife' && gameState.pWeaponId !== 'unarmed') gameState.isADS = true;
      return;
    }
    if (e.button !== 0) return;
    gameState.mouseHeld = true;
    onShoot();
  });

  gameState.renderer.domElement.addEventListener('mouseup', (e) => {
    if (e.button === 0) gameState.mouseHeld = false;
    if (e.button === 2) gameState.isADS = false;
  });

  dom.lockHint.addEventListener('click', () => requestMouseLock());
}
