import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { WEAPONS, type WeaponId } from '@/config/weapons';

/**
 * First-person weapon viewmodel — Krunker-style blocky weapon with
 * full recoil, sway, bobbing, sprint tilt, reload anim, muzzle flash.
 */

let vmScene: THREE.Scene;
let vmCamera: THREE.PerspectiveCamera;
let vmGroup: THREE.Group;       // holds the weapon + muzzle flash
let vmMuzzleFlash: THREE.PointLight;
let vmMuzzleMesh: THREE.Mesh;
let vmMuzzleSprite: THREE.Sprite;

let currentWeaponMesh: THREE.Group | null = null;
let currentWeaponId: WeaponId = 'assault_rifle';

// ── Per-weapon viewmodel positioning ──
interface VMLayout {
  pos: [number, number, number];   // base offset (right, down, forward)
  rot: [number, number, number];   // base rotation
  scale: number;
  muzzleOffset: [number, number, number]; // muzzle flash relative to weapon
  recoilZ: number;     // backward kick
  recoilUp: number;    // upward kick
  recoilRot: number;   // rotational kick (x-axis)
}

const VM_LAYOUTS: Record<WeaponId, VMLayout> = {
  pistol:          { pos: [0.14, -0.12, -0.20], rot: [0, 0, 0], scale: 1.4, muzzleOffset: [0, 0.008, -0.10], recoilZ: 0.025, recoilUp: 0.012, recoilRot: 0.08 },
  smg:             { pos: [0.12, -0.11, -0.22], rot: [0, 0, 0], scale: 1.3, muzzleOffset: [0, 0.008, -0.14], recoilZ: 0.012, recoilUp: 0.006, recoilRot: 0.04 },
  assault_rifle:   { pos: [0.11, -0.10, -0.24], rot: [0, 0, 0], scale: 1.2, muzzleOffset: [0, 0.010, -0.18], recoilZ: 0.018, recoilUp: 0.008, recoilRot: 0.06 },
  shotgun:         { pos: [0.12, -0.11, -0.22], rot: [0, 0, 0], scale: 1.2, muzzleOffset: [0, 0.012, -0.20], recoilZ: 0.040, recoilUp: 0.025, recoilRot: 0.14 },
  sniper_rifle:    { pos: [0.10, -0.10, -0.26], rot: [0, 0, 0], scale: 1.1, muzzleOffset: [0, 0.010, -0.26], recoilZ: 0.035, recoilUp: 0.018, recoilRot: 0.10 },
  rocket_launcher: { pos: [0.14, -0.13, -0.20], rot: [0, 0, 0], scale: 1.2, muzzleOffset: [0, 0.000, -0.18], recoilZ: 0.050, recoilUp: 0.030, recoilRot: 0.12 },
};

// ── Animation state ──
let recoilZ = 0;          // backward push
let recoilUp = 0;         // upward push
let recoilRot = 0;        // rotational kick
let swayX = 0;            // horizontal sway (from mouse delta X)
let swayY = 0;            // vertical sway (from mouse delta Y)
let bobPhase = 0;
let sprintLerp = 0;       // 0→idle/walk, 1→full sprint tilt
let switchProgress = 1;   // 0→weapon lowered, 1→raised
let switchDir: 'down' | 'up' = 'up';
let pendingWeaponId: WeaponId | null = null;
let reloadLerp = 0;       // 0→normal, 1→full reload tilt

/**
 * Initialize the viewmodel scene and camera.
 */
export function initViewmodel(): void {
  vmScene = new THREE.Scene();

  // Lighting that makes the blocky weapon pop
  vmScene.add(new THREE.AmbientLight(0xccddff, 0.7));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0);
  dl.position.set(2, 3, 4);
  vmScene.add(dl);
  const rim = new THREE.DirectionalLight(0x38bdf8, 0.3);
  rim.position.set(-2, 1, -1);
  vmScene.add(rim);

  vmCamera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 10);

  vmGroup = new THREE.Group();
  vmScene.add(vmGroup);

  // Muzzle flash — light + sphere + sprite
  vmMuzzleFlash = new THREE.PointLight(0xffaa33, 0, 4);
  vmGroup.add(vmMuzzleFlash);

  vmMuzzleMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffdd55, transparent: true, opacity: 0 }),
  );
  vmGroup.add(vmMuzzleMesh);

  // Star-burst sprite for flash
  const flashMat = new THREE.SpriteMaterial({
    color: 0xffcc44,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: false,
  });
  vmMuzzleSprite = new THREE.Sprite(flashMat);
  vmMuzzleSprite.scale.set(0.08, 0.08, 1);
  vmGroup.add(vmMuzzleSprite);

  gameState.vmScene = vmScene;
  gameState.vmCamera = vmCamera;

  setViewmodelWeapon(gameState.pWeaponId);
}

// ────────────────────────────────────────────
//  Weapon mesh builders (Krunker-style blocky)
// ────────────────────────────────────────────

function makeMats(wep: { color: number }) {
  const bodyMat = new THREE.MeshStandardMaterial({ color: wep.color, roughness: 0.35, metalness: 0.65 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8, metalness: 0.3 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8, roughness: 0.15, metalness: 0.9, emissive: 0x38bdf8, emissiveIntensity: 0.35,
  });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9, metalness: 0.1 });
  return { bodyMat, darkMat, accentMat, gripMat };
}

function buildWeaponMesh(weaponId: WeaponId): THREE.Group {
  const wep = WEAPONS[weaponId];
  const g = new THREE.Group();
  const { bodyMat, darkMat, accentMat, gripMat } = makeMats(wep);

  switch (weaponId) {
    case 'pistol': {
      // Slide
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.035, 0.095), bodyMat);
      slide.position.set(0, 0.005, 0);
      g.add(slide);
      // Frame
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.025, 0.065), darkMat);
      frame.position.set(0, -0.015, 0.01);
      g.add(frame);
      // Grip
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.058, 0.028), gripMat);
      grip.position.set(0, -0.045, 0.018);
      grip.rotation.x = 0.2;
      g.add(grip);
      // Barrel
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 8), darkMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.008, -0.065);
      g.add(barrel);
      // Trigger guard
      const tg = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.005, 0.025), darkMat);
      tg.position.set(0, -0.025, 0.005);
      g.add(tg);
      // Front sight
      const fs = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.010, 0.006), accentMat);
      fs.position.set(0, 0.028, -0.038);
      g.add(fs);
      break;
    }
    case 'smg': {
      // Receiver
      const recv = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.042, 0.14), bodyMat);
      g.add(recv);
      // Barrel shroud
      const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.030, 0.06), darkMat);
      shroud.position.set(0, 0, -0.095);
      g.add(shroud);
      // Barrel
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.055, 8), darkMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.005, -0.120);
      g.add(barrel);
      // Magazine
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.065, 0.022), gripMat);
      mag.position.set(0, -0.045, 0.015);
      mag.rotation.x = 0.05;
      g.add(mag);
      // Grip
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.045, 0.020), gripMat);
      grip.position.set(0, -0.035, 0.06);
      grip.rotation.x = 0.15;
      g.add(grip);
      // Stock (folded)
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.028, 0.055), bodyMat);
      stock.position.set(0, -0.008, 0.095);
      g.add(stock);
      // Accent line
      const al = new THREE.Mesh(new THREE.BoxGeometry(0.040, 0.004, 0.14), accentMat);
      al.position.set(0, 0.024, 0);
      g.add(al);
      break;
    }
    case 'assault_rifle': {
      // Main body
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.050, 0.22), bodyMat);
      g.add(body);
      // Handguard
      const hg = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.038, 0.08), darkMat);
      hg.position.set(0, -0.004, -0.12);
      g.add(hg);
      // Barrel
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.09, 8), darkMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.008, -0.155);
      g.add(barrel);
      // Muzzle brake
      const mb = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.010, 0.02, 8), bodyMat);
      mb.rotation.x = Math.PI / 2;
      mb.position.set(0, 0.008, -0.195);
      g.add(mb);
      // Magazine
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.072, 0.028), gripMat);
      mag.position.set(0, -0.050, 0.015);
      mag.rotation.x = 0.12;
      g.add(mag);
      // Grip
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.042, 0.018), gripMat);
      grip.position.set(0, -0.040, 0.065);
      grip.rotation.x = 0.2;
      g.add(grip);
      // Stock
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.042, 0.085), bodyMat);
      stock.position.set(0, -0.006, 0.145);
      g.add(stock);
      // Stock pad
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.048, 0.008), gripMat);
      sp.position.set(0, -0.006, 0.190);
      g.add(sp);
      // Sight rail
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.008, 0.10), darkMat);
      rail.position.set(0, 0.032, -0.02);
      g.add(rail);
      // Red dot sight
      const rds = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.018, 0.025), accentMat);
      rds.position.set(0, 0.045, -0.02);
      g.add(rds);
      // Accent stripe
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.004, 0.22), accentMat);
      stripe.position.set(0, 0.028, 0);
      g.add(stripe);
      break;
    }
    case 'shotgun': {
      // Receiver
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.050, 0.20), bodyMat);
      g.add(body);
      // Barrel (twin tubes)
      const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 8), darkMat);
      b1.rotation.x = Math.PI / 2;
      b1.position.set(0.008, 0.012, -0.165);
      g.add(b1);
      const b2 = b1.clone();
      b2.position.x = -0.008;
      g.add(b2);
      // Pump
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.040, 0.028, 0.065), bodyMat);
      pump.position.set(0, -0.022, -0.06);
      g.add(pump);
      // Grip
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.050, 0.022), gripMat);
      grip.position.set(0, -0.040, 0.055);
      grip.rotation.x = 0.2;
      g.add(grip);
      // Stock
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.048, 0.10), bodyMat);
      stock.position.set(0, -0.010, 0.145);
      g.add(stock);
      // Front bead
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 6), accentMat);
      bead.position.set(0, 0.032, -0.22);
      g.add(bead);
      break;
    }
    case 'sniper_rifle': {
      // Body
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.048, 0.30), bodyMat);
      g.add(body);
      // Barrel (long)
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.18, 8), darkMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.008, -0.235);
      g.add(barrel);
      // Suppressor tip
      const sup = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.010, 0.04, 8), darkMat);
      sup.rotation.x = Math.PI / 2;
      sup.position.set(0, 0.008, -0.32);
      g.add(sup);
      // Scope body
      const scopeBody = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.10, 10), accentMat);
      scopeBody.rotation.x = Math.PI / 2;
      scopeBody.position.set(0, 0.048, -0.02);
      g.add(scopeBody);
      // Scope rings
      for (const zz of [-0.05, 0.03]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.003, 6, 12), darkMat);
        ring.position.set(0, 0.048, zz);
        g.add(ring);
      }
      // Magazine
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.055, 0.028), gripMat);
      mag.position.set(0, -0.042, 0.04);
      g.add(mag);
      // Bipod legs (folded)
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.035, 0.008), darkMat);
        leg.position.set(side * 0.020, -0.035, -0.12);
        leg.rotation.x = 0.3;
        g.add(leg);
      }
      // Stock
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.052, 0.10), bodyMat);
      stock.position.set(0, -0.005, 0.195);
      g.add(stock);
      // Cheek rest
      const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.012, 0.06), gripMat);
      cheek.position.set(0, 0.024, 0.16);
      g.add(cheek);
      break;
    }
    case 'rocket_launcher': {
      // Tube
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.32, 10), bodyMat);
      tube.rotation.x = Math.PI / 2;
      g.add(tube);
      // Front opening
      const front = new THREE.Mesh(new THREE.RingGeometry(0.018, 0.030, 10), darkMat);
      front.position.set(0, 0, -0.161);
      g.add(front);
      // Rear bell
      const rear = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.04, 10), darkMat);
      rear.rotation.x = Math.PI / 2;
      rear.position.set(0, 0, 0.175);
      g.add(rear);
      // Grip
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.060, 0.026), gripMat);
      grip.position.set(0, -0.045, 0.05);
      grip.rotation.x = 0.15;
      g.add(grip);
      // Sight
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.025, 0.040), accentMat);
      sight.position.set(0, 0.042, -0.03);
      g.add(sight);
      // Warning stripe
      const ws = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.005, 0.06), new THREE.MeshStandardMaterial({
        color: 0xffaa00, roughness: 0.5, metalness: 0.3, emissive: 0xffaa00, emissiveIntensity: 0.2,
      }));
      ws.position.set(0, 0.030, 0.10);
      g.add(ws);
      break;
    }
  }

  return g;
}

/**
 * Switch the viewmodel to a different weapon with lower/raise animation.
 */
export function setViewmodelWeapon(weaponId: WeaponId): void {
  if (!vmGroup) {
    // Not initialized yet — just store it
    currentWeaponId = weaponId;
    return;
  }

  if (weaponId === currentWeaponId && currentWeaponMesh && switchProgress >= 1) return;

  // Start lowering animation, swap mesh when fully lowered
  pendingWeaponId = weaponId;
  switchDir = 'down';
}

function applyWeaponSwap(weaponId: WeaponId): void {
  if (currentWeaponMesh) vmGroup.remove(currentWeaponMesh);
  currentWeaponId = weaponId;
  currentWeaponMesh = buildWeaponMesh(weaponId);
  const layout = VM_LAYOUTS[weaponId];
  currentWeaponMesh.scale.setScalar(layout.scale);
  vmGroup.add(currentWeaponMesh);
  recoilZ = 0;
  recoilUp = 0;
  recoilRot = 0;
}

/**
 * Trigger recoil animation + muzzle flash + camera kick.
 */
export function fireViewmodel(): void {
  const layout = VM_LAYOUTS[currentWeaponId];

  // Viewmodel recoil
  recoilZ = layout.recoilZ;
  recoilUp = layout.recoilUp;
  recoilRot = layout.recoilRot;

  // Muzzle flash
  vmMuzzleFlash.intensity = 6;
  (vmMuzzleMesh.material as THREE.MeshBasicMaterial).opacity = 1.0;
  (vmMuzzleSprite.material as THREE.SpriteMaterial).opacity = 0.9;
  vmMuzzleSprite.scale.set(0.12, 0.12, 1);
  // Randomize rotation for variety
  vmMuzzleSprite.material.rotation = Math.random() * Math.PI * 2;

  // Camera recoil kick
  const kickUp = layout.recoilRot * 0.4 + Math.random() * layout.recoilRot * 0.15;
  const kickSide = (Math.random() - 0.5) * layout.recoilRot * 0.15;
  gameState.recoilPitch += kickUp;
  gameState.recoilYaw += kickSide;
  gameState.recoilRecoveryPitch += kickUp;
  gameState.recoilRecoveryYaw += kickSide;
}

/**
 * Update viewmodel every frame: position, sway, bob, recoil, sprint, reload.
 */
export function updateViewmodel(dt: number): void {
  if (!vmGroup) return;

  const { keys, pDead, pReloading, mouseDeltaX, mouseDeltaY } = gameState;
  const isMoving = keys.w || keys.a || keys.s || keys.d;
  const isSprinting = keys.shift && isMoving;

  // Reset mouse deltas after consumption
  gameState.mouseDeltaX = 0;
  gameState.mouseDeltaY = 0;

  if (pDead) {
    vmGroup.visible = false;
    return;
  }
  vmGroup.visible = true;

  const layout = VM_LAYOUTS[currentWeaponId];

  // ── Weapon switch animation ──
  if (switchDir === 'down') {
    switchProgress = Math.max(0, switchProgress - dt * 6);
    if (switchProgress <= 0 && pendingWeaponId) {
      applyWeaponSwap(pendingWeaponId);
      pendingWeaponId = null;
      switchDir = 'up';
    }
  } else if (switchDir === 'up' && switchProgress < 1) {
    switchProgress = Math.min(1, switchProgress + dt * 5);
  }

  // ── Walk / run bobbing ──
  if (isMoving) {
    bobPhase += dt * (isSprinting ? 15 : 10);
  } else {
    bobPhase += dt * 1.8; // idle breathing
  }
  const bobAmt = isMoving ? (isSprinting ? 0.008 : 0.004) : 0.0012;
  const bobX = Math.sin(bobPhase) * bobAmt;
  const bobY = Math.abs(Math.cos(bobPhase * 2)) * bobAmt * 0.7;

  // ── Mouse-driven weapon sway ──
  const targetSwayX = -mouseDeltaX * 0.0008;
  const targetSwayY = -mouseDeltaY * 0.0008;
  swayX += (targetSwayX - swayX) * Math.min(1, dt * 12);
  swayY += (targetSwayY - swayY) * Math.min(1, dt * 12);
  // Dampen sway back to 0
  swayX *= Math.max(0, 1 - dt * 5);
  swayY *= Math.max(0, 1 - dt * 5);

  // ── Sprint tilt ──
  const sprintTarget = isSprinting ? 1 : 0;
  sprintLerp += (sprintTarget - sprintLerp) * Math.min(1, dt * 8);

  // ── Reload animation ──
  const reloadTarget = pReloading ? 1 : 0;
  reloadLerp += (reloadTarget - reloadLerp) * Math.min(1, dt * 6);

  // ── Recoil return (spring-like) ──
  recoilZ *= Math.max(0, 1 - dt * 15);
  recoilUp *= Math.max(0, 1 - dt * 13);
  recoilRot *= Math.max(0, 1 - dt * 14);

  // ── Camera recoil recovery ──
  const recoverySpeed = dt * 8;
  if (Math.abs(gameState.recoilRecoveryPitch) > 0.0001) {
    const recover = gameState.recoilRecoveryPitch * Math.min(1, recoverySpeed);
    gameState.cameraPitch -= recover;
    gameState.recoilRecoveryPitch -= recover;
  }
  if (Math.abs(gameState.recoilRecoveryYaw) > 0.0001) {
    const recover = gameState.recoilRecoveryYaw * Math.min(1, recoverySpeed);
    gameState.cameraYaw -= recover;
    gameState.recoilRecoveryYaw -= recover;
  }

  // ── Muzzle flash decay ──
  vmMuzzleFlash.intensity *= Math.max(0, 1 - dt * 25);
  const flashMat = vmMuzzleMesh.material as THREE.MeshBasicMaterial;
  flashMat.opacity *= Math.max(0, 1 - dt * 20);
  const spriteMat = vmMuzzleSprite.material as THREE.SpriteMaterial;
  spriteMat.opacity *= Math.max(0, 1 - dt * 18);
  vmMuzzleSprite.scale.multiplyScalar(Math.max(0.8, 1 - dt * 8));

  // ── Compose final position ──
  const switchDrop = (1 - easeOutCubic(switchProgress)) * 0.15;
  const reloadDrop = reloadLerp * 0.08;
  const reloadTilt = reloadLerp * 0.6;

  vmGroup.position.set(
    layout.pos[0] + bobX + swayX + sprintLerp * 0.04,
    layout.pos[1] + bobY + swayY + recoilUp - switchDrop - reloadDrop,
    layout.pos[2] + recoilZ + switchDrop * 0.5,
  );

  vmGroup.rotation.set(
    layout.rot[0] - recoilRot + reloadTilt,
    layout.rot[1] + sprintLerp * 0.35,
    layout.rot[2] - sprintLerp * 0.25 + reloadLerp * 0.3,
  );

  // ── Muzzle flash position ──
  const mOff = layout.muzzleOffset;
  vmMuzzleFlash.position.set(mOff[0], mOff[1], mOff[2]);
  vmMuzzleMesh.position.set(mOff[0], mOff[1], mOff[2]);
  vmMuzzleSprite.position.set(mOff[0], mOff[1], mOff[2]);

  // ── Apply camera recoil to actual pitch ──
  if (gameState.recoilPitch > 0.0001) {
    const apply = gameState.recoilPitch * Math.min(1, dt * 20);
    gameState.cameraPitch += apply;
    gameState.recoilPitch -= apply;
  }
  if (Math.abs(gameState.recoilYaw) > 0.0001) {
    const apply = gameState.recoilYaw * Math.min(1, dt * 20);
    gameState.cameraYaw += apply;
    gameState.recoilYaw -= apply;
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Render the viewmodel on top of the main scene.
 */
export function renderViewmodel(): void {
  if (!vmScene || !vmCamera) return;
  const renderer = gameState.renderer;
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(vmScene, vmCamera);
  renderer.autoClear = true;
}

/**
 * Handle resize for viewmodel camera.
 */
export function resizeViewmodel(): void {
  if (vmCamera) {
    vmCamera.aspect = innerWidth / innerHeight;
    vmCamera.updateProjectionMatrix();
  }
}
