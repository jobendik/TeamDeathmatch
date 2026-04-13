import * as THREE from 'three';
import { gameState } from './GameState';
import { FP } from '@/config/player';
import { dom } from '@/ui/DOMElements';
import { WEAPONS } from '@/config/weapons';
import { hitscanShot, shotgunBlast, spawnRocket, spawnGrenade } from '@/combat/Hitscan';
import { updateHUD, flashCrosshairFire } from '@/ui/HUD';
import { fireViewmodel, setViewmodelWeapon, resizeViewmodel } from '@/rendering/WeaponViewmodel';

/**
 * Start a player reload.
 */
function startReload(): void {
  const wep = WEAPONS[gameState.pWeaponId];
  gameState.pReloading = true;
  gameState.pReloadTimer = 0;
  gameState.pReloadDuration = wep.reloadTime;
  dom.reloadBar.classList.add('on');
  dom.reloadText.classList.add('on');
}

/**
 * Switch to a weapon slot.
 */
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
  gameState.pAmmo = wep.magSize; // fresh mag on switch
  gameState.pMaxAmmo = wep.magSize;
  gameState.pShootTimer = 0;
  gameState.pBurstCount = 0;

  setViewmodelWeapon(gameState.pWeaponId);
  updateHUD();
}

/**
 * Handle player shooting — now uses hitscan for most weapons.
 */
export function onShoot(): void {
  if (gameState.pDead || gameState.pReloading) return;
  if (gameState.pShootTimer > 0) return;
  if (gameState.pAmmo <= 0) { startReload(); return; }

  const { player, cameraYaw, cameraPitch, pWeaponId } = gameState;
  const wep = WEAPONS[pWeaponId];

  const o = new THREE.Vector3(player.position.x, FP.height - 0.2, player.position.z);
  const fwd = new THREE.Vector3(
    -Math.sin(cameraYaw) * Math.cos(cameraPitch),
    Math.sin(cameraPitch),
    -Math.cos(cameraYaw) * Math.cos(cameraPitch),
  ).normalize();

  // Add player aim error (small for most weapons)
  const dir = fwd.clone();
  const err = wep.aimError * (gameState.keys.shift ? 0.6 : 1.0); // ADS improves accuracy
  dir.x += (Math.random() - 0.5) * err;
  dir.y += (Math.random() - 0.5) * err * 0.5;
  dir.z += (Math.random() - 0.5) * err;
  dir.normalize();

  if (pWeaponId === 'rocket_launcher') {
    spawnRocket(o, dir, 'player', player.team, 0x60a5fa);
  } else if (pWeaponId === 'shotgun') {
    shotgunBlast(o, fwd, 'player', player.team, 0x60a5fa);
  } else {
    hitscanShot(o, dir, 'player', player.team, pWeaponId, 0x60a5fa);
  }

  fireViewmodel();
  flashCrosshairFire();
  gameState.pAmmo--;
  gameState.pShootTimer = wep.fireRate;
  updateHUD();

  if (gameState.pAmmo <= 0) startReload();
}

/**
 * Throw a grenade.
 */
function throwGrenade(): void {
  if (gameState.pDead) return;
  if (gameState.pGrenades <= 0) return;
  if (gameState.pGrenadeCooldown > 0) return;

  const { player, cameraYaw, cameraPitch } = gameState;
  const o = new THREE.Vector3(player.position.x, FP.height, player.position.z);
  const dir = new THREE.Vector3(
    -Math.sin(cameraYaw) * Math.cos(cameraPitch),
    Math.sin(cameraPitch),
    -Math.cos(cameraYaw) * Math.cos(cameraPitch),
  ).normalize();

  spawnGrenade(o, dir, 'player', player.team);
  gameState.pGrenades--;
  gameState.pGrenadeCooldown = 1.0;
  updateHUD();
}

/**
 * Request pointer lock on the renderer canvas.
 */
function requestMouseLock(): void {
  gameState.renderer?.domElement?.requestPointerLock();
}

/**
 * Handle pointer lock state changes.
 */
function onPointerLockChange(): void {
  gameState.mouseLocked = document.pointerLockElement === gameState.renderer.domElement;
  dom.lockHint.classList.toggle('on', !gameState.mouseLocked);
}

/**
 * Handle mouse movement for camera look.
 */
function onMouseMove(e: MouseEvent): void {
  if (!gameState.mouseLocked || gameState.pDead) return;
  gameState.cameraYaw -= e.movementX * FP.sensitivity;
  gameState.cameraPitch -= e.movementY * FP.sensitivity;
  gameState.cameraPitch = Math.max(FP.pitchMin, Math.min(FP.pitchMax, gameState.cameraPitch));
  // Store deltas for weapon sway
  gameState.mouseDeltaX += e.movementX;
  gameState.mouseDeltaY += e.movementY;
}

/**
 * Bind all input event listeners.
 */
export function bindEvents(): void {
  const { keys } = gameState;

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in keys) { (keys as any)[k] = true; e.preventDefault(); }
    if (k === 'tab') { e.preventDefault(); keys.tab = true; }

    // Reload
    if (k === 'r' && !gameState.pDead && !gameState.pReloading && gameState.pAmmo < gameState.pMaxAmmo) {
      startReload();
    }

    // Grenade
    if (k === 'g') throwGrenade();

    // Weapon switching: 1, 2, 3
    if (k === '1') switchWeapon(0);
    if (k === '2') switchWeapon(1);
    if (k === '3') switchWeapon(2);

    // Scroll wheel weapon switch
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

  // Scroll wheel for weapon switching
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
