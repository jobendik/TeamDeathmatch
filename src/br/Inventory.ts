import type { WeaponId } from '@/config/weapons';
import type { Rarity, AttachmentSlot } from './BRConfig';
import { ATTACHMENTS } from './BRConfig';

export type ItemCategory = 'weapon' | 'ammo' | 'heal' | 'shield' | 'armor' | 'grenade' | 'attachment';

export interface InventoryItem {
  id: string;                 // e.g. "weapon_ar_rare" or "ammo_rifle"
  category: ItemCategory;
  name: string;
  rarity: Rarity;
  stackSize: number;
  qty: number;

  // Weapon
  weaponId?: WeaponId;
  damageBonus?: number;
  spreadReduction?: number;
  magSize?: number;          // current mag size (with attachments)
  currentAmmo?: number;      // bullets currently in magazine
  attachments?: Partial<Record<AttachmentSlot, string>>; // attachment IDs

  // Attachment
  attachmentSlot?: AttachmentSlot;
  attachmentId?: string;
}

export interface PlayerInventory {
  weaponSlots: [InventoryItem | null, InventoryItem | null, InventoryItem | null];
  activeSlot: 0 | 1 | 2;
  backpack: InventoryItem[];
  backpackCapacity: number;

  // Quick-access consumables
  grenades: number;
  smallHeals: number;
  bigHeals: number;
  smallShields: number;
  bigShields: number;

  // Armor state (worn)
  armorTier: 0 | 1 | 2 | 3;   // 0 none, 1 light, 2 medium, 3 heavy
  armorHP: number;
  maxArmorHP: number;

  // Ammo pool (shared, simplified)
  ammoLight: number;   // pistol / smg
  ammoMedium: number;  // ar
  ammoHeavy: number;   // sniper
  ammoShotgun: number;
  ammoRockets: number;
}

export function createEmptyInventory(): PlayerInventory {
  return {
    weaponSlots: [null, null, null],
    activeSlot: 0,
    backpack: [],
    backpackCapacity: 16,
    grenades: 0,
    smallHeals: 0,
    bigHeals: 0,
    smallShields: 0,
    bigShields: 0,
    armorTier: 0,
    armorHP: 0,
    maxArmorHP: 0,
    ammoLight: 0,
    ammoMedium: 0,
    ammoHeavy: 0,
    ammoShotgun: 0,
    ammoRockets: 0,
  };
}

export function getAmmoPool(inv: PlayerInventory, weaponId: WeaponId): number {
  switch (weaponId) {
    case 'pistol':
    case 'smg': return inv.ammoLight;
    case 'assault_rifle': return inv.ammoMedium;
    case 'sniper_rifle': return inv.ammoHeavy;
    case 'shotgun': return inv.ammoShotgun;
    case 'rocket_launcher': return inv.ammoRockets;
    default: return 0;
  }
}

export function consumeAmmo(inv: PlayerInventory, weaponId: WeaponId, amount: number): number {
  const taken = Math.min(amount, getAmmoPool(inv, weaponId));
  switch (weaponId) {
    case 'pistol':
    case 'smg': inv.ammoLight -= taken; break;
    case 'assault_rifle': inv.ammoMedium -= taken; break;
    case 'sniper_rifle': inv.ammoHeavy -= taken; break;
    case 'shotgun': inv.ammoShotgun -= taken; break;
    case 'rocket_launcher': inv.ammoRockets -= taken; break;
  }
  return taken;
}

export function addAmmo(inv: PlayerInventory, weaponId: WeaponId, amount: number): void {
  switch (weaponId) {
    case 'pistol':
    case 'smg': inv.ammoLight += amount; break;
    case 'assault_rifle': inv.ammoMedium += amount; break;
    case 'sniper_rifle': inv.ammoHeavy += amount; break;
    case 'shotgun': inv.ammoShotgun += amount; break;
    case 'rocket_launcher': inv.ammoRockets += amount; break;
  }
}

export function getActiveWeapon(inv: PlayerInventory): InventoryItem | null {
  return inv.weaponSlots[inv.activeSlot];
}

/** Attempt to pick up an item. Returns true if it fit. */
export function addItem(inv: PlayerInventory, item: InventoryItem): boolean {
  // Weapons → first empty slot
  if (item.category === 'weapon') {
    const emptySlot = inv.weaponSlots.findIndex(s => s === null);
    if (emptySlot !== -1) {
      inv.weaponSlots[emptySlot] = item;
      return true;
    }
    // Full? put in backpack if space
    if (inv.backpack.length < inv.backpackCapacity) {
      inv.backpack.push(item);
      return true;
    }
    return false;
  }

  // Ammo → ammo pool directly (don't use backpack)
  if (item.category === 'ammo') {
    if (item.weaponId) addAmmo(inv, item.weaponId, item.qty);
    return true;
  }

  // Heals / shields / grenades → consumable counters
  if (item.category === 'heal') {
    if (item.id === 'heal_small') inv.smallHeals += item.qty;
    else inv.bigHeals += item.qty;
    return true;
  }
  if (item.category === 'shield') {
    if (item.id === 'shield_small') inv.smallShields += item.qty;
    else inv.bigShields += item.qty;
    return true;
  }
  if (item.category === 'grenade') {
    inv.grenades += item.qty;
    return true;
  }

  // Armor → auto-equip if better tier
  if (item.category === 'armor') {
    const tier = item.id === 'armor_big' ? 2 : 1;
    if (tier > inv.armorTier) {
      inv.armorTier = tier as 1 | 2;
      inv.maxArmorHP = tier === 2 ? 100 : 50;
      inv.armorHP = inv.maxArmorHP;
      return true;
    }
    // else backpack
  }

  // Attachments → backpack (applied via UI)
  if (inv.backpack.length < inv.backpackCapacity) {
    inv.backpack.push(item);
    return true;
  }
  return false;
}

/** Drop everything on death as a flat list. */
export function dumpInventoryOnDeath(inv: PlayerInventory): InventoryItem[] {
  const items: InventoryItem[] = [];

  for (const w of inv.weaponSlots) {
    if (w) items.push({ ...w });
  }
  for (const b of inv.backpack) items.push({ ...b });

  if (inv.ammoLight > 0) items.push({ id: 'ammo_light', category: 'ammo', name: 'Light Ammo', rarity: 'common', stackSize: 120, qty: inv.ammoLight, weaponId: 'smg' });
  if (inv.ammoMedium > 0) items.push({ id: 'ammo_medium', category: 'ammo', name: 'Medium Ammo', rarity: 'common', stackSize: 90, qty: inv.ammoMedium, weaponId: 'assault_rifle' });
  if (inv.ammoHeavy > 0) items.push({ id: 'ammo_heavy', category: 'ammo', name: 'Heavy Ammo', rarity: 'common', stackSize: 30, qty: inv.ammoHeavy, weaponId: 'sniper_rifle' });
  if (inv.ammoShotgun > 0) items.push({ id: 'ammo_shotgun', category: 'ammo', name: 'Shells', rarity: 'common', stackSize: 24, qty: inv.ammoShotgun, weaponId: 'shotgun' });
  if (inv.ammoRockets > 0) items.push({ id: 'ammo_rockets', category: 'ammo', name: 'Rockets', rarity: 'common', stackSize: 6, qty: inv.ammoRockets, weaponId: 'rocket_launcher' });

  if (inv.smallHeals > 0) items.push({ id: 'heal_small', category: 'heal', name: 'Bandage', rarity: 'common', stackSize: 10, qty: inv.smallHeals });
  if (inv.bigHeals > 0) items.push({ id: 'heal_big', category: 'heal', name: 'Medkit', rarity: 'uncommon', stackSize: 3, qty: inv.bigHeals });
  if (inv.smallShields > 0) items.push({ id: 'shield_small', category: 'shield', name: 'Shield Shard', rarity: 'common', stackSize: 6, qty: inv.smallShields });
  if (inv.bigShields > 0) items.push({ id: 'shield_big', category: 'shield', name: 'Shield Potion', rarity: 'rare', stackSize: 3, qty: inv.bigShields });
  if (inv.grenades > 0) items.push({ id: 'grenade', category: 'grenade', name: 'Grenade', rarity: 'common', stackSize: 6, qty: inv.grenades });

  if (inv.armorTier > 0) items.push({
    id: inv.armorTier >= 2 ? 'armor_big' : 'armor_small',
    category: 'armor',
    name: inv.armorTier >= 2 ? 'Heavy Armor' : 'Light Armor',
    rarity: inv.armorTier >= 2 ? 'rare' : 'uncommon',
    stackSize: 1, qty: 1,
  });

  return items;
}

/** Consume a heal item. Returns true if consumed. */
export function consumeHeal(inv: PlayerInventory, big: boolean): boolean {
  if (big && inv.bigHeals > 0) { inv.bigHeals--; return true; }
  if (!big && inv.smallHeals > 0) { inv.smallHeals--; return true; }
  return false;
}
export function consumeShield(inv: PlayerInventory, big: boolean): boolean {
  if (big && inv.bigShields > 0) { inv.bigShields--; return true; }
  if (!big && inv.smallShields > 0) { inv.smallShields--; return true; }
  return false;
}

/** Get combined attachment modifiers for the active weapon. */
export function getAttachmentModifiers(inv: PlayerInventory): { spreadMul: number; magMul: number; reloadMul: number } {
  const result = { spreadMul: 1, magMul: 1, reloadMul: 1 };
  const weapon = getActiveWeapon(inv);
  if (!weapon?.attachments) return result;
  for (const attId of Object.values(weapon.attachments)) {
    if (!attId) continue;
    const def = ATTACHMENTS.find(a => a.id === attId);
    if (!def) continue;
    if (def.spreadMul) result.spreadMul *= def.spreadMul;
    if (def.magMul) result.magMul *= def.magMul;
    if (def.reloadMul) result.reloadMul *= def.reloadMul;
  }
  return result;
}
