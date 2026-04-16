/**
 * LootSystem — Optimized with InstancedMesh.
 *
 * ALL ground loot boxes share a single InstancedMesh (1 draw call).
 * Beams of light are separate InstancedMesh (1 draw call).
 * Total: 2 draw calls for ALL ground loot, instead of 2N draw calls.
 *
 * Individual loot items tracked by index into the instance arrays.
 */

import * as THREE from 'three';
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
  instanceIdx: number; // index in the InstancedMeshes
  alive: boolean;
}

// ── State ──
export const groundLoot: GroundLoot[] = [];
export const lootGrid = new SpatialGrid<GroundLoot>();
let _nextId = 1;

// ── Instanced rendering ──
const MAX_LOOT = 600; // max simultaneous ground items
let crateInstances: THREE.InstancedMesh | null = null;
let beamInstances: THREE.InstancedMesh | null = null;
let _freeSlots: number[] = [];
const _m = new THREE.Matrix4();
const _dummyM = new THREE.Matrix4().makeScale(0, 0, 0); // hidden instance

function ensureInstances(): void {
  if (crateInstances) return;

  const crateGeo = new THREE.BoxGeometry(0.55, 0.35, 0.55);
  const crateMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.3, metalness: 0.5,
    emissive: 0xffffff, emissiveIntensity: 0.5,
  });
  crateInstances = new THREE.InstancedMesh(crateGeo, crateMat, MAX_LOOT);
  crateInstances.castShadow = false; // too many for shadows
  crateInstances.frustumCulled = false;
  crateInstances.count = MAX_LOOT;

  const beamGeo = new THREE.CylinderGeometry(0.1, 0.5, 14, 6, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.18,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  beamInstances = new THREE.InstancedMesh(beamGeo, beamMat, MAX_LOOT);
  beamInstances.frustumCulled = false;
  beamInstances.count = MAX_LOOT;

  // Initialize all slots as hidden
  for (let i = 0; i < MAX_LOOT; i++) {
    crateInstances.setMatrixAt(i, _dummyM);
    beamInstances.setMatrixAt(i, _dummyM);
    crateInstances.setColorAt(i, new THREE.Color(0));
    beamInstances.setColorAt(i, new THREE.Color(0));
    _freeSlots.push(i);
  }
  crateInstances.instanceMatrix.needsUpdate = true;
  beamInstances.instanceMatrix.needsUpdate = true;

  gameState.scene.add(crateInstances);
  gameState.scene.add(beamInstances);
}

function allocSlot(): number {
  return _freeSlots.length > 0 ? _freeSlots.pop()! : -1;
}

function freeSlot(idx: number): void {
  if (!crateInstances || !beamInstances) return;
  crateInstances.setMatrixAt(idx, _dummyM);
  beamInstances.setMatrixAt(idx, _dummyM);
  crateInstances.instanceMatrix.needsUpdate = true;
  beamInstances.instanceMatrix.needsUpdate = true;
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

// ── Public API ──

export function spawnGroundLoot(x: number, z: number, y: number, items: InventoryItem[], fromDeath = false): GroundLoot | null {
  ensureInstances();
  const idx = allocSlot();
  if (idx < 0) return null; // pool exhausted

  const rarity = topRarity(items);
  const col = new THREE.Color(RARITY_COLORS[rarity]);

  const loot: GroundLoot = {
    id: _nextId++, x, z, y: Math.max(0.4, y),
    items, rarity, fromDeath,
    spawnedAt: gameState.worldElapsed,
    instanceIdx: idx,
    alive: true,
  };

  // Set instance transform + color
  _m.makeTranslation(x, loot.y, z);
  crateInstances!.setMatrixAt(idx, _m);
  crateInstances!.setColorAt(idx, col);
  crateInstances!.instanceMatrix.needsUpdate = true;
  crateInstances!.instanceColor!.needsUpdate = true;

  _m.makeTranslation(x, loot.y + 7, z);
  beamInstances!.setMatrixAt(idx, _m);
  beamInstances!.setColorAt(idx, col);
  beamInstances!.instanceMatrix.needsUpdate = true;
  beamInstances!.instanceColor!.needsUpdate = true;

  groundLoot.push(loot);
  lootGrid.insert(loot, x, z);
  return loot;
}

export function removeGroundLoot(id: number): void {
  const idx = groundLoot.findIndex(g => g.id === id);
  if (idx === -1) return;
  const g = groundLoot[idx];
  g.alive = false;
  freeSlot(g.instanceIdx);
  lootGrid.remove(g);
  groundLoot.splice(idx, 1);
}

/**
 * Animate loot: bob + spin. Uses batch matrix update.
 * Only updates instances near the camera for perf.
 */
export function updateGroundLoot(): void {
  if (!crateInstances) return;
  const t = gameState.worldElapsed;
  const px = gameState.player.position.x;
  const pz = gameState.player.position.z;
  let dirty = false;

  for (const g of groundLoot) {
    // Only animate nearby loot (within 60m)
    const dx = g.x - px;
    const dz = g.z - pz;
    if (dx * dx + dz * dz > 3600) continue;

    const bobY = g.y + Math.sin(t * 2 + g.id) * 0.08;
    const rotY = t * 0.6 + g.id;

    _m.makeRotationY(rotY);
    _m.setPosition(g.x, bobY, g.z);
    crateInstances.setMatrixAt(g.instanceIdx, _m);

    _m.makeTranslation(g.x, bobY + 7, g.z);
    beamInstances!.setMatrixAt(g.instanceIdx, _m);
    dirty = true;
  }

  if (dirty) {
    crateInstances.instanceMatrix.needsUpdate = true;
    beamInstances!.instanceMatrix.needsUpdate = true;
  }
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

  // Outdoor scatter near POIs
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
  for (const g of groundLoot) freeSlot(g.instanceIdx);
  groundLoot.length = 0;
  lootGrid.clear();
}
