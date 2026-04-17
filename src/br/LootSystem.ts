/**
 * LootSystem — BR loot visuals upgraded to real GLB models while keeping
 * instanced rendering for performance.
 *
 * Each loot family gets its own instanced model batch. The pickup beam stays
 * instanced too. This keeps draw calls low without using placeholder boxes.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { gameState } from '@/core/GameState';
import { RARITY_COLORS, rollRarity, rollWeapon, LOOT_SPAWN_WEIGHTS, type Rarity } from './BRConfig';
import { WEAPONS, type WeaponId } from '@/config/weapons';
import { getBRMapData } from './BRMap';
import { SpatialGrid } from './SpatialGrid';
import type { InventoryItem } from './Inventory';

export interface GroundLoot {
  id: number;
  x: number; z: number; y: number;
  items: InventoryItem[];
  rarity: Rarity;
  fromDeath: boolean;
  spawnedAt: number;
  instanceIdx: number;
  visualKey: LootVisualKey;
  alive: boolean;
}

type LootVisualKey =
  | 'ammo_crate'
  | 'grenade'
  | 'bandage'
  | 'healthkit'
  | 'mini_shield'
  | 'shield_potion'
  | 'armor_plate'
  | 'armor_vest'
  | 'weapon_crate'
  | 'weapon_smg'
  | 'weapon_ar'
  | 'weapon_shotgun'
  | 'weapon_sniper'
  | 'weapon_launcher';

interface InstancedSubmesh {
  mesh: THREE.InstancedMesh;
  baseMatrix: THREE.Matrix4;
}

interface ModelVisual {
  key: LootVisualKey;
  submeshes: InstancedSubmesh[];
}

interface BakedMeshPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  baseMatrix: THREE.Matrix4;
  castShadow: boolean;
  receiveShadow: boolean;
}

// ── State ──
export const groundLoot: GroundLoot[] = [];
export const lootGrid = new SpatialGrid<GroundLoot>();
let _nextId = 1;

const MAX_LOOT = 600;
let beamInstances: THREE.InstancedMesh | null = null;
let _freeSlots: number[] = [];
const _dummyM = new THREE.Matrix4().makeScale(0, 0, 0);
const _tmpWorld = new THREE.Matrix4();
const _tmpFinal = new THREE.Matrix4();
const _tmpColor = new THREE.Color();

const loader = new GLTFLoader();
let visualsReady = false;
let visualsRequested = false;
const visuals = new Map<LootVisualKey, ModelVisual>();

const MODEL_URLS: Record<LootVisualKey, string> = {
  ammo_crate: new URL('../../models/pickups/ammo_crate.glb', import.meta.url).href,
  grenade: new URL('../../models/pickups/grenade.glb', import.meta.url).href,
  bandage: new URL('../../models/pickups/bandage.glb', import.meta.url).href,
  healthkit: new URL('../../models/pickups/healthkit.glb', import.meta.url).href,
  mini_shield: new URL('../../models/pickups/mini_shield.glb', import.meta.url).href,
  shield_potion: new URL('../../models/pickups/shield_potion.glb', import.meta.url).href,
  armor_plate: new URL('../../models/pickups/armor_plate.glb', import.meta.url).href,
  armor_vest: new URL('../../models/pickups/armor_vest.glb', import.meta.url).href,
  weapon_crate: new URL('../../models/pickups/weapon_crate.glb', import.meta.url).href,
  weapon_smg: new URL('../../models/pickups/weapon_smg.glb', import.meta.url).href,
  weapon_ar: new URL('../../models/pickups/weapon_ar.glb', import.meta.url).href,
  weapon_shotgun: new URL('../../models/pickups/weapon_shotgun.glb', import.meta.url).href,
  weapon_sniper: new URL('../../models/pickups/weapon_sniper.glb', import.meta.url).href,
  weapon_launcher: new URL('../../models/pickups/weapon_launcher.glb', import.meta.url).href,
};

const MODEL_TARGET_SIZE: Record<LootVisualKey, number> = {
  ammo_crate: 0.78,
  grenade: 0.38,
  bandage: 0.48,
  healthkit: 0.62,
  mini_shield: 0.5,
  shield_potion: 0.7,
  armor_plate: 0.64,
  armor_vest: 0.8,
  weapon_crate: 0.78,
  weapon_smg: 1.0,
  weapon_ar: 1.12,
  weapon_shotgun: 1.08,
  weapon_sniper: 1.18,
  weapon_launcher: 1.2,
};

const MODEL_ROT_X: Partial<Record<LootVisualKey, number>> = {
  weapon_smg: -0.2,
  weapon_ar: -0.16,
  weapon_shotgun: -0.08,
  weapon_sniper: -0.12,
  weapon_launcher: -0.1,
};

function ensureInstances(): void {
  if (beamInstances) return;

  const beamGeo = new THREE.CylinderGeometry(0.1, 0.5, 14, 6, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  beamInstances = new THREE.InstancedMesh(beamGeo, beamMat, MAX_LOOT);
  beamInstances.frustumCulled = false;
  beamInstances.count = MAX_LOOT;

  for (let i = 0; i < MAX_LOOT; i++) {
    beamInstances.setMatrixAt(i, _dummyM);
    beamInstances.setColorAt(i, new THREE.Color(0));
    _freeSlots.push(i);
  }

  beamInstances.instanceMatrix.needsUpdate = true;
  if (beamInstances.instanceColor) beamInstances.instanceColor.needsUpdate = true;
  gameState.scene.add(beamInstances);

  if (!visualsRequested) {
    visualsRequested = true;
    void ensureModelVisuals();
  }
}

async function ensureModelVisuals(): Promise<void> {
  const keys = Object.keys(MODEL_URLS) as LootVisualKey[];
  const loaded = await Promise.all(keys.map(async (key) => [key, await buildModelVisual(key)] as const));

  for (const [key, visual] of loaded) {
    if (!visual) continue;
    visuals.set(key, visual);
    for (const sub of visual.submeshes) gameState.scene.add(sub.mesh);
  }

  visualsReady = true;
  refreshAllLootVisuals();
}

async function buildModelVisual(key: LootVisualKey): Promise<ModelVisual | null> {
  const baked = await bakeModelParts(MODEL_URLS[key], MODEL_TARGET_SIZE[key], MODEL_ROT_X[key] ?? 0);
  if (!baked.length) return null;

  const submeshes: InstancedSubmesh[] = baked.map((part) => {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, MAX_LOOT);
    mesh.frustumCulled = false;
    mesh.count = MAX_LOOT;
    mesh.castShadow = part.castShadow;
    mesh.receiveShadow = part.receiveShadow;

    for (let i = 0; i < MAX_LOOT; i++) mesh.setMatrixAt(i, _dummyM);
    mesh.instanceMatrix.needsUpdate = true;

    return { mesh, baseMatrix: part.baseMatrix };
  });

  return { key, submeshes };
}

function bakeModelParts(url: string, targetMaxDim: number, rotX: number): Promise<BakedMeshPart[]> {
  return new Promise((resolve) => {
    loader.load(
      url,
      (gltf) => {
        const root = (gltf.scene || gltf.scenes?.[0] || null) as THREE.Object3D | null;
        if (!root) {
          resolve([]);
          return;
        }

        prepRenderable(root);
        fitModelToOrigin(root, targetMaxDim);
        if (rotX) root.rotation.x = rotX;
        root.updateMatrixWorld(true);

        const parts: BakedMeshPart[] = [];

        root.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!(mesh as any).isMesh) return;

          const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          if (!mat) return;

          parts.push({
            geometry: mesh.geometry.clone(),
            material: mat.clone(),
            baseMatrix: mesh.matrixWorld.clone(),
            castShadow: mesh.castShadow,
            receiveShadow: mesh.receiveShadow,
          });
        });

        resolve(parts);
      },
      undefined,
      () => resolve([]),
    );
  });
}

function prepRenderable(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if ((mesh as any).isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((m) => m.clone());
      } else if (mesh.material) {
        mesh.material = mesh.material.clone();
      }
    }
  });
}

function fitModelToOrigin(root: THREE.Object3D, targetMaxDim: number): void {
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

function allocSlot(): number {
  return _freeSlots.length > 0 ? _freeSlots.pop()! : -1;
}

function setBeamSlot(idx: number, x: number, y: number, z: number, rarity: Rarity): void {
  if (!beamInstances) return;
  _tmpWorld.makeTranslation(x, y + 7, z);
  beamInstances.setMatrixAt(idx, _tmpWorld);
  beamInstances.setColorAt(idx, _tmpColor.setHex(RARITY_COLORS[rarity]));
}

function setVisualSlot(idx: number, key: LootVisualKey, x: number, y: number, z: number, rotY: number): void {
  const visual = visuals.get(key);
  if (!visual) return;

  _tmpWorld.makeRotationY(rotY);
  _tmpWorld.setPosition(x, y, z);

  for (const sub of visual.submeshes) {
    _tmpFinal.multiplyMatrices(_tmpWorld, sub.baseMatrix);
    sub.mesh.setMatrixAt(idx, _tmpFinal);
  }
}

function hideVisualSlot(idx: number, key: LootVisualKey): void {
  const visual = visuals.get(key);
  if (!visual) return;

  for (const sub of visual.submeshes) {
    sub.mesh.setMatrixAt(idx, _dummyM);
    sub.mesh.instanceMatrix.needsUpdate = true;
  }
}

function markAllMatricesDirty(key: LootVisualKey): void {
  const visual = visuals.get(key);
  if (!visual) return;
  for (const sub of visual.submeshes) sub.mesh.instanceMatrix.needsUpdate = true;
}

function freeSlot(idx: number, key: LootVisualKey): void {
  if (!beamInstances) return;
  beamInstances.setMatrixAt(idx, _dummyM);
  beamInstances.instanceMatrix.needsUpdate = true;
  hideVisualSlot(idx, key);
  _freeSlots.push(idx);
}

function rarityWeight(r: Rarity): number {
  return { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 }[r];
}

function topRarity(items: InventoryItem[]): Rarity {
  let top: Rarity = 'common';
  for (const it of items) {
    if (rarityWeight(it.rarity) > rarityWeight(top)) top = it.rarity;
  }
  return top;
}

function resolveWeaponVisual(weaponId?: WeaponId): LootVisualKey {
  switch (weaponId) {
    case 'smg': return 'weapon_smg';
    case 'assault_rifle': return 'weapon_ar';
    case 'shotgun': return 'weapon_shotgun';
    case 'sniper_rifle': return 'weapon_sniper';
    case 'rocket_launcher': return 'weapon_launcher';
    default: return 'weapon_crate';
  }
}

function resolveLootVisual(items: InventoryItem[]): LootVisualKey {
  const weapon = items.find((it) => it.category === 'weapon');
  if (weapon) return resolveWeaponVisual(weapon.weaponId as WeaponId | undefined);

  if (items.some((it) => it.category === 'grenade')) return 'grenade';
  if (items.some((it) => it.id === 'arm_b')) return 'armor_vest';
  if (items.some((it) => it.id === 'arm_s')) return 'armor_plate';
  if (items.some((it) => it.id === 'sh_b')) return 'shield_potion';
  if (items.some((it) => it.id === 'sh_s')) return 'mini_shield';
  if (items.some((it) => it.id === 'heal_b')) return 'healthkit';
  if (items.some((it) => it.id === 'heal_s')) return 'bandage';
  return 'ammo_crate';
}

function refreshAllLootVisuals(): void {
  if (!beamInstances || !visualsReady) return;

  const dirtyKeys = new Set<LootVisualKey>();

  for (const g of groundLoot) {
    if (!g.alive) continue;
    const bobY = g.y + Math.sin(gameState.worldElapsed * 2 + g.id) * 0.08;
    const rotY = gameState.worldElapsed * 0.6 + g.id;

    setVisualSlot(g.instanceIdx, g.visualKey, g.x, bobY, g.z, rotY);
    setBeamSlot(g.instanceIdx, g.x, bobY, g.z, g.rarity);
    dirtyKeys.add(g.visualKey);
  }

  beamInstances.instanceMatrix.needsUpdate = true;
  if (beamInstances.instanceColor) beamInstances.instanceColor.needsUpdate = true;
  dirtyKeys.forEach(markAllMatricesDirty);
}

// ── Public API ──

export function spawnGroundLoot(x: number, z: number, y: number, items: InventoryItem[], fromDeath = false): GroundLoot | null {
  ensureInstances();
  const idx = allocSlot();
  if (idx < 0) return null;

  const rarity = topRarity(items);
  const visualKey = resolveLootVisual(items);

  const loot: GroundLoot = {
    id: _nextId++,
    x,
    z,
    y: Math.max(0.4, y),
    items,
    rarity,
    fromDeath,
    spawnedAt: gameState.worldElapsed,
    instanceIdx: idx,
    visualKey,
    alive: true,
  };

  setBeamSlot(idx, x, loot.y, z, rarity);
  if (beamInstances) {
    beamInstances.instanceMatrix.needsUpdate = true;
    if (beamInstances.instanceColor) beamInstances.instanceColor.needsUpdate = true;
  }

  if (visualsReady) {
    setVisualSlot(idx, visualKey, x, loot.y, z, 0);
    markAllMatricesDirty(visualKey);
  }

  groundLoot.push(loot);
  lootGrid.insert(loot, x, z);
  return loot;
}

export function removeGroundLoot(id: number): void {
  const idx = groundLoot.findIndex((g) => g.id === id);
  if (idx === -1) return;
  const g = groundLoot[idx];
  g.alive = false;
  freeSlot(g.instanceIdx, g.visualKey);
  lootGrid.remove(g);
  groundLoot.splice(idx, 1);
}

export function updateGroundLoot(): void {
  if (!beamInstances) return;

  const t = gameState.worldElapsed;
  const px = gameState.player.position.x;
  const pz = gameState.player.position.z;
  const dirtyKeys = new Set<LootVisualKey>();
  let beamDirty = false;

  for (const g of groundLoot) {
    const dx = g.x - px;
    const dz = g.z - pz;
    if (dx * dx + dz * dz > 3600) continue;

    const bobY = g.y + Math.sin(t * 2 + g.id) * 0.08;
    const rotY = t * 0.6 + g.id;

    setBeamSlot(g.instanceIdx, g.x, bobY, g.z, g.rarity);
    if (visualsReady) {
      setVisualSlot(g.instanceIdx, g.visualKey, g.x, bobY, g.z, rotY);
      dirtyKeys.add(g.visualKey);
    }
    beamDirty = true;
  }

  if (beamDirty) {
    beamInstances.instanceMatrix.needsUpdate = true;
    if (beamInstances.instanceColor) beamInstances.instanceColor.needsUpdate = true;
  }

  dirtyKeys.forEach(markAllMatricesDirty);
}

// ── Loot generation ──

function rollLootItem(): InventoryItem {
  const rarity = rollRarity();
  const total = Object.values(LOOT_SPAWN_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [kind, w] of Object.entries(LOOT_SPAWN_WEIGHTS)) {
    r -= w;
    if (r <= 0) return createItem(kind, rarity);
  }
  return createItem('ammo', rarity);
}

function createItem(kind: string, rarity: Rarity): InventoryItem {
  switch (kind) {
    case 'weapon': {
      const roll = rollWeapon(rarity);
      const wep = WEAPONS[roll.weaponId];
      return {
        id: `w_${roll.weaponId}_${roll.rarity}`, category: 'weapon',
        name: wep.name, rarity: roll.rarity, stackSize: 1, qty: 1,
        weaponId: roll.weaponId, damageBonus: roll.damageBonus,
        spreadReduction: roll.spreadReduction, magSize: wep.magSize,
        currentAmmo: wep.magSize, attachments: {},
      };
    }
    case 'ammo': {
      const types: { id: string; name: string; wid: WeaponId; qty: number }[] = [
        { id: 'ammo_light', name: 'Light Ammo', wid: 'smg', qty: 25 + (Math.random() * 25 | 0) },
        { id: 'ammo_med', name: 'Medium Ammo', wid: 'assault_rifle', qty: 20 + (Math.random() * 20 | 0) },
        { id: 'ammo_heavy', name: 'Heavy Ammo', wid: 'sniper_rifle', qty: 6 + (Math.random() * 6 | 0) },
        { id: 'ammo_shell', name: 'Shells', wid: 'shotgun', qty: 6 + (Math.random() * 6 | 0) },
      ];
      const p = types[(Math.random() * types.length) | 0];
      return { id: p.id, category: 'ammo', name: p.name, rarity: 'common', stackSize: 200, qty: p.qty, weaponId: p.wid };
    }
    case 'heal_small': return { id: 'heal_s', category: 'heal', name: 'Bandage', rarity: 'common', stackSize: 10, qty: 2 + (Math.random() * 2 | 0) };
    case 'heal_big': return { id: 'heal_b', category: 'heal', name: 'Medkit', rarity: 'uncommon', stackSize: 3, qty: 1 };
    case 'shield_small': return { id: 'sh_s', category: 'shield', name: 'Mini Shield', rarity: 'common', stackSize: 6, qty: 2 + (Math.random() * 2 | 0) };
    case 'shield_big': return { id: 'sh_b', category: 'shield', name: 'Shield Potion', rarity: 'rare', stackSize: 3, qty: 1 };
    case 'armor_small': return { id: 'arm_s', category: 'armor', name: 'Light Armor', rarity: 'uncommon', stackSize: 1, qty: 1 };
    case 'armor_big': return { id: 'arm_b', category: 'armor', name: 'Heavy Armor', rarity: 'epic', stackSize: 1, qty: 1 };
    case 'grenade': return { id: 'gren', category: 'grenade', name: 'Grenade', rarity: 'common', stackSize: 6, qty: 1 + (Math.random() * 1 | 0) };
    default: return { id: 'junk', category: 'ammo', name: 'Scrap', rarity: 'common', stackSize: 1, qty: 1 };
  }
}

/**
 * Populate map with loot. ~3-4 items per building loot spot + outdoor scatter.
 */
export function populateMapLoot(): void {
  ensureInstances();
  const map = getBRMapData();
  if (!map) return;

  for (const b of map.buildings) {
    for (const spot of b.lootSpots) {
      if (Math.random() > 0.7) continue;
      const items: InventoryItem[] = [rollLootItem()];
      if (Math.random() < 0.25) items.push(rollLootItem());
      spawnGroundLoot(spot.x, spot.z, spot.y, items);
    }
  }

  for (const poi of map.pois) {
    const n = 2 + (Math.random() * 2 | 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * poi.radius;
      spawnGroundLoot(poi.x + Math.cos(a) * r, poi.z + Math.sin(a) * r, 0.4, [rollLootItem()]);
    }
  }
}

export function clearAllLoot(): void {
  for (const g of groundLoot) freeSlot(g.instanceIdx, g.visualKey);
  groundLoot.length = 0;
  lootGrid.clear();
}
