import * as THREE from 'three';
import type { InventoryItem, Rarity } from './Inventory';

/**
 * World-space loot drops (from crates or death drops).
 * Each drop is a floating/glowing stack near where it spawned.
 */

export interface LootDrop {
  pos: THREE.Vector3;
  items: InventoryItem[];
  mesh: THREE.Group;
  rarity: Rarity;
  spawnedAt: number;
  fromDeath: boolean;
}

export const activeLoot: LootDrop[] = [];

const RARITY_COLORS: Record<Rarity, number> = {
  common: 0xcccccc,
  uncommon: 0x22d66a,
  rare: 0x4aa8ff,
  epic: 0xa47aff,
  legendary: 0xffcc44,
};

export function spawnLootDrop(
  pos: THREE.Vector3,
  items: InventoryItem[],
  fromDeath = false,
): LootDrop {
  const topRarity = items.reduce<Rarity>(
    (r, it) => rarityWeight(it.rarity) > rarityWeight(r) ? it.rarity : r,
    'common',
  );

  const mesh = new THREE.Group();
  const col = RARITY_COLORS[topRarity];
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.25, 0.35),
    new THREE.MeshStandardMaterial({
      color: col, emissive: col, emissiveIntensity: 0.6,
      roughness: 0.3, metalness: 0.6,
    }),
  );
  mesh.add(box);

  // Beam of light up
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.4, 10, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.15,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  beam.position.y = 5;
  mesh.add(beam);

  mesh.position.copy(pos);
  mesh.position.y = 0.5;

  return {
    pos: pos.clone(),
    items,
    mesh,
    rarity: topRarity,
    spawnedAt: performance.now(),
    fromDeath,
  };
}

function rarityWeight(r: Rarity): number {
  return { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 }[r];
}
