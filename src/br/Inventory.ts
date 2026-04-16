import type { WeaponId } from '@/config/weapons';

export type ItemCategory = 'weapon' | 'ammo' | 'health' | 'armor' | 'grenade' | 'attachment';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface InventoryItem {
  id: string;
  category: ItemCategory;
  name: string;
  rarity: Rarity;
  stackSize: number;
  qty: number;
  // Weapon-specific
  weaponId?: WeaponId;
  // Attachment-specific
  attachmentSlot?: 'optic' | 'barrel' | 'mag' | 'grip';
}

export interface Inventory {
  weaponSlots: [InventoryItem | null, InventoryItem | null, InventoryItem | null];
  backpack: InventoryItem[]; // generic stack
  backpackCapacity: number;
  shieldCharges: number; // small/big shield
  healthKits: number;
}

export function createEmptyInventory(): Inventory {
  return {
    weaponSlots: [null, null, null],
    backpack: [],
    backpackCapacity: 12,
    shieldCharges: 0,
    healthKits: 0,
  };
}

export function addItem(inv: Inventory, item: InventoryItem): boolean {
  if (item.category === 'weapon') {
    const slot = inv.weaponSlots.findIndex(s => s === null);
    if (slot === -1) return false;
    inv.weaponSlots[slot] = item;
    return true;
  }
  // Try to stack
  const existing = inv.backpack.find(i =>
    i.id === item.id && i.qty < i.stackSize,
  );
  if (existing) {
    const room = existing.stackSize - existing.qty;
    const add = Math.min(room, item.qty);
    existing.qty += add;
    item.qty -= add;
    if (item.qty <= 0) return true;
  }
  if (inv.backpack.length >= inv.backpackCapacity) return false;
  inv.backpack.push(item);
  return true;
}

export function dropInventoryOnDeath(inv: Inventory): InventoryItem[] {
  const items: InventoryItem[] = [];
  for (const w of inv.weaponSlots) if (w) items.push(w);
  for (const it of inv.backpack) items.push(it);
  return items;
}
