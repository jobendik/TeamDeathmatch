import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { gameState } from '@/core/GameState';
import { WEAPONS, type WeaponId } from '@/config/weapons';

const BASE_URL = import.meta.env.BASE_URL;

const PICKUP_MODEL_URLS = {
  health: `${BASE_URL}models/pickups/healthkit.glb`,
  ammo: `${BASE_URL}models/pickups/ammo_crate.glb`,
  grenade: `${BASE_URL}models/pickups/grenade.glb`,
  weapon: `${BASE_URL}models/pickups/weapon_crate.glb`,
} as const;

const gltfLoader = new GLTFLoader();
const pickupPrefabCache = new Map<string, Promise<THREE.Group | null>>();

function prepRenderable(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if ((mesh as any).isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
}

function fitPickupModel(root: THREE.Object3D, targetMaxDim = 0.7): void {
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z, 0.0001);
  const s = targetMaxDim / maxDim;
  root.scale.multiplyScalar(s);

  root.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(root);
  const center2 = new THREE.Vector3();
  box2.getCenter(center2);

  root.position.x -= center2.x;
  root.position.z -= center2.z;
  root.position.y -= box2.min.y;
}

function loadPickupPrefab(url: string, targetMaxDim: number): Promise<THREE.Group | null> {
  const cached = pickupPrefabCache.get(url);
  if (cached) return cached;

  const p = new Promise<THREE.Group | null>((resolve) => {
    gltfLoader.load(
      url,
      (gltf) => {
        const root = gltf.scene || gltf.scenes?.[0];
        if (!root) {
          resolve(null);
          return;
        }
        prepRenderable(root);
        fitPickupModel(root, targetMaxDim);
        resolve(root as THREE.Group);
      },
      undefined,
      () => resolve(null),
    );
  });

  pickupPrefabCache.set(url, p);
  return p;
}

function buildFallbackMesh(type: 'health' | 'ammo' | 'weapon' | 'grenade', color: number): THREE.Mesh {
  const geo =
    type === 'health'
      ? new THREE.BoxGeometry(0.5, 0.5, 0.5)
      : type === 'grenade'
        ? new THREE.SphereGeometry(0.24, 10, 10)
        : new THREE.BoxGeometry(0.55, 0.3, 0.65);

  return new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.6,
      roughness: 0.2,
      metalness: 0.4,
    }),
  );
}

async function attachPickupModel(
  root: THREE.Mesh,
  type: 'health' | 'ammo' | 'weapon' | 'grenade',
): Promise<void> {
  const url = PICKUP_MODEL_URLS[type];
  const prefab = await loadPickupPrefab(url, type === 'grenade' ? 0.42 : 0.72);
  if (!prefab) return;

  while (root.children.length) root.remove(root.children[0]);

  const model = prefab.clone(true);
  root.add(model);
  root.visible = true;
}

export function buildPickups(): void {
  const defs: { t: 'health' | 'ammo' | 'weapon' | 'grenade'; col: number; x: number; z: number; weaponId?: WeaponId }[] = [
    { t: 'health', col: 0x22c55e, x: -25, z: 25 },
    { t: 'health', col: 0x22c55e, x: 25, z: -25 },
    { t: 'health', col: 0x22c55e, x: 0, z: 0 },
    { t: 'ammo', col: 0xf59e0b, x: -25, z: -25 },
    { t: 'ammo', col: 0xf59e0b, x: 25, z: 25 },
    { t: 'ammo', col: 0xf59e0b, x: -40, z: 0 },
    { t: 'ammo', col: 0xf59e0b, x: 40, z: 0 },
    { t: 'grenade', col: 0x84cc16, x: -10, z: -18 },
    { t: 'grenade', col: 0x84cc16, x: 10, z: 18 },
    { t: 'weapon', col: 0x8b5cf6, x: -15, z: 0, weaponId: 'shotgun' },
    { t: 'weapon', col: 0x8b5cf6, x: 15, z: 0, weaponId: 'sniper_rifle' },
    { t: 'weapon', col: 0x8b5cf6, x: 0, z: -30, weaponId: 'rocket_launcher' },
    { t: 'weapon', col: 0x8b5cf6, x: 0, z: 30, weaponId: 'smg' },
  ];

  for (const d of defs) {
    const mesh = buildFallbackMesh(d.t, d.col);
    mesh.position.set(d.x, 0.5, d.z);
    mesh.castShadow = true;
    gameState.scene.add(mesh);

    void attachPickupModel(mesh, d.t);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.7, 20),
      new THREE.MeshBasicMaterial({
        color: d.col,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(d.x, 0.04, d.z);
    gameState.scene.add(ring);

    gameState.pickups.push({
      mesh,
      ring,
      active: true,
      respawnAt: 0,
      t: d.t,
      x: d.x,
      z: d.z,
      weaponId: d.weaponId,
    });
  }
}

export function updatePickups(): void {
  const { pickups, worldElapsed, agents, player } = gameState;

  for (const p of pickups) {
    if (!p.active && worldElapsed >= p.respawnAt) {
      p.active = true;
      p.mesh.visible = p.ring.visible = true;
    }

    if (p.active) {
      p.mesh.position.y = 0.5 + Math.sin(worldElapsed * 2 + p.x) * 0.1;
      p.mesh.rotation.y += 0.02;
      (p.ring.material as THREE.MeshBasicMaterial).opacity =
        0.25 + Math.sin(worldElapsed * 2.5 + p.z) * 0.1;
    }

    for (const ag of agents) {
      if (ag === player || ag.isDead || !p.active) continue;
      const dx = ag.position.x - p.x;
      const dz = ag.position.z - p.z;
      if (dx * dx + dz * dz < 2.5 * 2.5) {
        if (p.t === 'health' && ag.hp < ag.maxHP * 0.7) {
          p.active = false;
          p.mesh.visible = p.ring.visible = false;
          p.respawnAt = worldElapsed + 15;
          ag.hp = Math.min(ag.maxHP, ag.hp + 35);
        } else if (p.t === 'ammo' && ag.weaponId !== 'unarmed' && ag.ammo < ag.magSize * 0.4) {
          p.active = false;
          p.mesh.visible = p.ring.visible = false;
          p.respawnAt = worldElapsed + 12;
          ag.ammo = ag.magSize;
        } else if (p.t === 'grenade' && ag.grenades < 3) {
          p.active = false;
          p.mesh.visible = p.ring.visible = false;
          p.respawnAt = worldElapsed + 10;
          ag.grenades = Math.min(3, ag.grenades + 1);
        } else if (p.t === 'weapon' && p.weaponId) {
          const newWep = WEAPONS[p.weaponId];
          const curWep = WEAPONS[ag.weaponId];
          const shouldPickup =
            ag.weaponId === 'unarmed' ||
            newWep.desirability > curWep.desirability ||
            ag.ammo <= 0;

          if (shouldPickup) {
            p.active = false;
            p.mesh.visible = p.ring.visible = false;
            p.respawnAt = worldElapsed + 25;
            ag.weaponId = p.weaponId;
            ag.damage = newWep.damage;
            ag.fireRate = newWep.fireRate;
            ag.burstSize = newWep.burstSize;
            ag.burstDelay = newWep.burstDelay;
            ag.reloadTime = newWep.reloadTime;
            ag.magSize = newWep.magSize;
            ag.ammo = newWep.magSize;
            ag.aimError = newWep.aimError;
          }
        }
      }
    }
  }
}
