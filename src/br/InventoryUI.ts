import { gameState } from '@/core/GameState';
import { RARITY_HEX } from './BRConfig';
import {
  type PlayerInventory, type InventoryItem,
  addItem,
} from './Inventory';
import { groundLoot, removeGroundLoot, type GroundLoot } from './LootSystem';
import { getWeaponIconSVG } from '@/ui/WeaponIcons';

let invEl: HTMLDivElement | null = null;
let pickupPromptEl: HTMLDivElement | null = null;
let isOpen = false;

export function getPlayerInventory(): PlayerInventory {
  return (gameState as any).brInventory as PlayerInventory;
}

export function setPlayerInventory(inv: PlayerInventory): void {
  (gameState as any).brInventory = inv;
}

function ensureElements(): void {
  if (invEl) return;
  invEl = document.createElement('div');
  invEl.id = 'brInventory';
  invEl.innerHTML = `
    <div class="bi-wrap">
      <div class="bi-header">
        <div class="bi-title">◈ INVENTORY ◈</div>
        <div class="bi-hint">Press <span class="bi-kbd">I</span> or <span class="bi-kbd">ESC</span> to close</div>
      </div>
      <div class="bi-body">
        <div class="bi-col">
          <div class="bi-section">WEAPONS</div>
          <div class="bi-weaponslots" id="biWeaponSlots"></div>
          <div class="bi-section">GEAR</div>
          <div class="bi-gear" id="biGear"></div>
          <div class="bi-section">AMMO</div>
          <div class="bi-ammo" id="biAmmo"></div>
        </div>
        <div class="bi-col">
          <div class="bi-section">BACKPACK</div>
          <div class="bi-backpack" id="biBackpack"></div>
        </div>
        <div class="bi-col">
          <div class="bi-section">NEARBY LOOT</div>
          <div class="bi-ground" id="biGround"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(invEl);

  pickupPromptEl = document.createElement('div');
  pickupPromptEl.id = 'brPickupPrompt';
  pickupPromptEl.innerHTML = `<span class="bi-kbd">E</span> <span id="bppText">Pick up</span>`;
  document.body.appendChild(pickupPromptEl);

  injectStyles();
}

function injectStyles(): void {
  if (document.getElementById('brInventoryStyles')) return;
  const style = document.createElement('style');
  style.id = 'brInventoryStyles';
  style.textContent = `
    #brInventory {
      position: fixed; inset: 0; z-index: 80;
      display: none;
      align-items: center; justify-content: center;
      background: rgba(4, 10, 20, 0.78);
      backdrop-filter: blur(10px);
    }
    #brInventory.on { display: flex; }
    .bi-wrap {
      background: rgba(10, 16, 28, 0.95);
      border: 1px solid rgba(120, 180, 255, 0.4);
      border-radius: 4px;
      padding: 24px 28px;
      min-width: 920px; max-width: 1080px;
      box-shadow: 0 0 60px rgba(74, 168, 255, 0.2);
    }
    .bi-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
    .bi-title { font-family: 'Orbitron', monospace; font-size: 16px; font-weight: 900; letter-spacing: 0.24em; color: #4aa8ff; text-shadow: 0 0 16px rgba(74, 168, 255, 0.5); }
    .bi-hint { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #a8b8cc; }
    .bi-kbd {
      display: inline-block;
      font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700;
      padding: 2px 7px; border: 1px solid rgba(120, 180, 255, 0.35);
      border-radius: 2px; background: rgba(74, 168, 255, 0.1); color: #e8f0ff;
      margin: 0 2px;
    }
    .bi-body { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }
    .bi-col { display: flex; flex-direction: column; gap: 6px; }
    .bi-section {
      font-family: 'Orbitron', monospace; font-size: 9px; font-weight: 900;
      letter-spacing: 0.18em; color: #6080a0;
      padding-bottom: 4px; border-bottom: 1px solid rgba(120, 180, 255, 0.18);
      margin-bottom: 6px; margin-top: 4px;
    }
    .bi-weaponslots { display: flex; flex-direction: column; gap: 6px; }
    .bi-backpack { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; min-height: 180px; }
    .bi-ground { display: flex; flex-direction: column; gap: 6px; max-height: 440px; overflow-y: auto; }
    .bi-gear { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
    .bi-ammo { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
    .bi-slot {
      position: relative;
      min-height: 54px;
      padding: 6px 10px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(120, 180, 255, 0.15);
      border-radius: 3px;
      display: flex; align-items: center; gap: 8px;
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #e8f0ff;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .bi-slot:hover { background: rgba(74, 168, 255, 0.1); border-color: rgba(74, 168, 255, 0.5); }
    .bi-slot.active { background: rgba(74, 168, 255, 0.15); border-color: #4aa8ff; box-shadow: 0 0 12px rgba(74, 168, 255, 0.2); }
    .bi-slot.empty { opacity: 0.35; cursor: default; }
    .bi-slot-icon {
      width: 36px; height: 24px; display: flex; align-items: center; justify-content: center;
      color: currentColor; flex-shrink: 0;
    }
    .bi-slot-info { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .bi-slot-name { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bi-slot-sub { font-size: 9px; color: #a8b8cc; }
    .bi-slot-qty {
      font-family: 'Orbitron', monospace; font-size: 13px; font-weight: 900;
      color: #ffcc44; margin-left: auto;
    }
    .bi-slot-key {
      position: absolute; top: 3px; right: 5px;
      font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #6080a0;
    }
    #brPickupPrompt {
      position: fixed; bottom: 180px; left: 50%;
      transform: translateX(-50%); z-index: 15;
      font-family: 'Orbitron', monospace; font-size: 12px;
      color: #e8f0ff;
      padding: 8px 16px;
      background: rgba(8, 14, 26, 0.88);
      border: 1px solid rgba(255, 204, 68, 0.5);
      border-radius: 3px;
      backdrop-filter: blur(8px);
      box-shadow: 0 0 20px rgba(255, 204, 68, 0.25);
      display: none;
      letter-spacing: 0.15em;
    }
    #brPickupPrompt.on { display: block; }
    #bppText { font-size: 11px; color: #ffcc44; margin-left: 4px; }
  `;
  document.head.appendChild(style);
}

export function openInventory(): void {
  ensureElements();
  if (!invEl) return;
  isOpen = true;
  invEl.classList.add('on');
  document.exitPointerLock?.();
  renderInventory();
}

export function closeInventory(): void {
  if (!invEl) return;
  isOpen = false;
  invEl.classList.remove('on');
  setTimeout(() => gameState.renderer?.domElement?.requestPointerLock(), 60);
}

export function toggleInventory(): void {
  if (isOpen) closeInventory();
  else openInventory();
}

export function isInventoryOpen(): boolean { return isOpen; }

function renderItemCell(item: InventoryItem | null, extraClass = '', slotIdx?: number): string {
  if (!item) return `<div class="bi-slot empty ${extraClass}"><span style="opacity:0.5">—</span></div>`;
  const color = RARITY_HEX[item.rarity];
  const icon = item.category === 'weapon' && item.weaponId
    ? getWeaponIconSVG(item.weaponId)
    : categoryEmoji(item.category);
  const key = slotIdx !== undefined ? `<div class="bi-slot-key">${slotIdx + 1}</div>` : '';
  const qty = item.qty > 1 ? `<div class="bi-slot-qty">×${item.qty}</div>` : '';
  const sub = getItemSubline(item);
  return `
    <div class="bi-slot ${extraClass}" style="border-color:${color}55" data-slot="${slotIdx ?? ''}">
      ${key}
      <div class="bi-slot-icon" style="color:${color}">${icon}</div>
      <div class="bi-slot-info">
        <div class="bi-slot-name" style="color:${color}">${item.name}</div>
        ${sub ? `<div class="bi-slot-sub">${sub}</div>` : ''}
      </div>
      ${qty}
    </div>
  `;
}

function categoryEmoji(cat: string): string {
  switch (cat) {
    case 'ammo': return '🎯';
    case 'heal': return '❤';
    case 'shield': return '🛡';
    case 'armor': return '🦺';
    case 'grenade': return '🧨';
    case 'attachment': return '⚙';
    default: return '◆';
  }
}

function getItemSubline(item: InventoryItem): string {
  if (item.category === 'weapon' && item.damageBonus !== undefined && item.damageBonus > 0) {
    return `+${Math.round(item.damageBonus * 100)}% DMG`;
  }
  return item.rarity.toUpperCase();
}

function renderInventory(): void {
  const inv = getPlayerInventory();
  if (!inv) return;

  const weaponSlotsEl = document.getElementById('biWeaponSlots');
  const backpackEl = document.getElementById('biBackpack');
  const groundEl = document.getElementById('biGround');
  const gearEl = document.getElementById('biGear');
  const ammoEl = document.getElementById('biAmmo');

  if (weaponSlotsEl) {
    weaponSlotsEl.innerHTML = inv.weaponSlots.map((s, i) =>
      renderItemCell(s, (i === inv.activeSlot && s) ? 'active' : '', i),
    ).join('');
  }

  if (backpackEl) {
    const cells: string[] = [];
    for (let i = 0; i < inv.backpackCapacity; i++) {
      cells.push(renderItemCell(inv.backpack[i] ?? null, `bp-${i}`));
    }
    backpackEl.innerHTML = cells.join('');
  }

  if (gearEl) {
    const armorName = inv.armorTier >= 2 ? 'Heavy Armor' : inv.armorTier === 1 ? 'Light Armor' : '—';
    gearEl.innerHTML = `
      <div class="bi-slot" style="border-color:${inv.armorTier ? RARITY_HEX.rare : 'rgba(120,180,255,0.15)'}">
        <div class="bi-slot-icon">🦺</div>
        <div class="bi-slot-info">
          <div class="bi-slot-name">${armorName}</div>
          <div class="bi-slot-sub">${inv.armorHP}/${inv.maxArmorHP}</div>
        </div>
      </div>
      <div class="bi-slot">
        <div class="bi-slot-icon">❤</div>
        <div class="bi-slot-info">
          <div class="bi-slot-name">Bandage</div>
          <div class="bi-slot-sub">Heals 15</div>
        </div>
        <div class="bi-slot-qty">×${inv.smallHeals}</div>
      </div>
      <div class="bi-slot">
        <div class="bi-slot-icon">❤</div>
        <div class="bi-slot-info">
          <div class="bi-slot-name">Medkit</div>
          <div class="bi-slot-sub">Full heal</div>
        </div>
        <div class="bi-slot-qty">×${inv.bigHeals}</div>
      </div>
      <div class="bi-slot">
        <div class="bi-slot-icon">🛡</div>
        <div class="bi-slot-info">
          <div class="bi-slot-name">Shield Shard</div>
          <div class="bi-slot-sub">+25 shield</div>
        </div>
        <div class="bi-slot-qty">×${inv.smallShields}</div>
      </div>
      <div class="bi-slot">
        <div class="bi-slot-icon">🛡</div>
        <div class="bi-slot-info">
          <div class="bi-slot-name">Shield Potion</div>
          <div class="bi-slot-sub">Max shield</div>
        </div>
        <div class="bi-slot-qty">×${inv.bigShields}</div>
      </div>
      <div class="bi-slot">
        <div class="bi-slot-icon">🧨</div>
        <div class="bi-slot-info">
          <div class="bi-slot-name">Grenade</div>
          <div class="bi-slot-sub">Throwable</div>
        </div>
        <div class="bi-slot-qty">×${inv.grenades}</div>
      </div>
    `;
  }

  if (ammoEl) {
    ammoEl.innerHTML = `
      <div class="bi-slot"><div class="bi-slot-icon">🎯</div><div class="bi-slot-info"><div class="bi-slot-name">Light</div></div><div class="bi-slot-qty">${inv.ammoLight}</div></div>
      <div class="bi-slot"><div class="bi-slot-icon">🎯</div><div class="bi-slot-info"><div class="bi-slot-name">Medium</div></div><div class="bi-slot-qty">${inv.ammoMedium}</div></div>
      <div class="bi-slot"><div class="bi-slot-icon">🎯</div><div class="bi-slot-info"><div class="bi-slot-name">Heavy</div></div><div class="bi-slot-qty">${inv.ammoHeavy}</div></div>
      <div class="bi-slot"><div class="bi-slot-icon">🎯</div><div class="bi-slot-info"><div class="bi-slot-name">Shells</div></div><div class="bi-slot-qty">${inv.ammoShotgun}</div></div>
      <div class="bi-slot"><div class="bi-slot-icon">🎯</div><div class="bi-slot-info"><div class="bi-slot-name">Rockets</div></div><div class="bi-slot-qty">${inv.ammoRockets}</div></div>
    `;
  }

  if (groundEl) {
    const nearby = findNearbyLoot();
    if (nearby.length === 0) {
      groundEl.innerHTML = `<div class="bi-slot empty">No loot nearby</div>`;
    } else {
      const cells: string[] = [];
      for (const loot of nearby) {
        for (const item of loot.items) {
          cells.push(`<div class="bi-slot" data-loot-id="${loot.id}" data-item-id="${item.id}" style="border-color:${RARITY_HEX[item.rarity]}55">
            <div class="bi-slot-icon" style="color:${RARITY_HEX[item.rarity]}">${item.category === 'weapon' && item.weaponId ? getWeaponIconSVG(item.weaponId) : categoryEmoji(item.category)}</div>
            <div class="bi-slot-info">
              <div class="bi-slot-name" style="color:${RARITY_HEX[item.rarity]}">${item.name}</div>
              <div class="bi-slot-sub">${item.qty > 1 ? `×${item.qty}` : getItemSubline(item)}</div>
            </div>
            <div class="bi-slot-qty" style="font-size:10px;color:#a8b8cc">TAKE</div>
          </div>`);
        }
      }
      groundEl.innerHTML = cells.join('');

      groundEl.querySelectorAll<HTMLElement>('[data-loot-id]').forEach(el => {
        el.addEventListener('click', () => {
          const lootId = parseInt(el.getAttribute('data-loot-id') ?? '0', 10);
          const itemId = el.getAttribute('data-item-id') ?? '';
          pickupSpecificItem(lootId, itemId);
        });
      });
    }
  }

  weaponSlotsEl?.querySelectorAll<HTMLElement>('[data-slot]').forEach(el => {
    el.addEventListener('click', () => {
      const slot = parseInt(el.getAttribute('data-slot') ?? '0', 10);
      if (inv.weaponSlots[slot]) {
        inv.activeSlot = slot as 0 | 1 | 2;
        renderInventory();
      }
    });
  });
}

function findNearbyLoot(): GroundLoot[] {
  const px = gameState.player.position.x;
  const pz = gameState.player.position.z;
  const result: GroundLoot[] = [];
  for (const g of groundLoot) {
    const dx = g.x - px;
    const dz = g.z - pz;
    if (dx * dx + dz * dz < 36) result.push(g);
  }
  return result;
}

function pickupSpecificItem(lootId: number, itemId: string): void {
  const inv = getPlayerInventory();
  if (!inv) return;
  const loot = groundLoot.find(g => g.id === lootId);
  if (!loot) return;
  const itemIdx = loot.items.findIndex(it => it.id === itemId);
  if (itemIdx === -1) return;
  const item = loot.items[itemIdx];

  if (addItem(inv, item)) {
    loot.items.splice(itemIdx, 1);
    if (loot.items.length === 0) removeGroundLoot(loot.id);
    renderInventory();
  }
}

export function pickupNearestLoot(): void {
  const inv = getPlayerInventory();
  if (!inv) return;
  const nearby = findNearbyLoot();
  if (nearby.length === 0) return;

  const loot = nearby[0];
  const remaining: InventoryItem[] = [];
  for (const item of loot.items) {
    if (!addItem(inv, item)) remaining.push(item);
  }
  loot.items = remaining;
  if (loot.items.length === 0) removeGroundLoot(loot.id);
  if (isOpen) renderInventory();
}

export function updatePickupPrompt(): void {
  ensureElements();
  if (!pickupPromptEl) return;
  if (isOpen) { pickupPromptEl.classList.remove('on'); return; }

  const nearby = findNearbyLoot();
  if (nearby.length === 0) {
    pickupPromptEl.classList.remove('on');
    return;
  }
  const loot = nearby[0];
  const item = loot.items[0];
  if (!item) { pickupPromptEl.classList.remove('on'); return; }

  const text = document.getElementById('bppText');
  if (text) text.textContent = `Pick up ${item.name}${loot.items.length > 1 ? ` + ${loot.items.length - 1} more` : ''}`;
  pickupPromptEl.style.color = RARITY_HEX[loot.rarity];
  pickupPromptEl.classList.add('on');
}
