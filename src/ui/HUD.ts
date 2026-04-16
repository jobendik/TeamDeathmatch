import { gameState } from '@/core/GameState';
import { WEAPONS, type WeaponId } from '@/config/weapons';
import { dom } from './DOMElements';
import { getWeaponIconSVG, getWeaponModeLabel } from './WeaponIcons';

let dmgTO: ReturnType<typeof setTimeout>;
let hlfTO: ReturnType<typeof setTimeout>;
let fireTO: ReturnType<typeof setTimeout>;

const xhEl = (): HTMLElement => document.getElementById('xh')!;

// Cache to avoid innerHTML churn for icons
const lastSlotIcons: (WeaponId | null)[] = [null, null, null];
let lastActiveSlot = -1;

export function updateHUD(): void {
  // ── Health ──
  const hpPct = Math.max(0, Math.min(100, gameState.pHP));
  dom.hpFill.style.width = hpPct + '%';
  dom.hpTxt.textContent = String(Math.round(hpPct));

  // Low-HP pulse class on whole bar
  dom.hpFill.parentElement?.classList.toggle('low', hpPct < 35);

  // ── Armor (placeholder 0 for now) ──
  if (dom.armorFill) dom.armorFill.style.width = '0%';
  if (dom.armorTxt) dom.armorTxt.textContent = '0';

  // ── Weapon card ──
  const wep = WEAPONS[gameState.pWeaponId];
  const isUnarmed = gameState.pWeaponId === 'unarmed';

  if (isUnarmed) {
    dom.ammoTxt.textContent = '—';
    dom.ammoMax.textContent = '';
    dom.weaponName.textContent = 'UNARMED';
  } else {
    dom.ammoTxt.textContent = String(gameState.pAmmo);
    dom.ammoMax.textContent = '/ ' + wep.magSize;
    dom.weaponName.textContent = wep.name;
  }

  // Low-ammo pulse
  const lowAmmo = !isUnarmed && gameState.pAmmo > 0 && gameState.pAmmo / wep.magSize < 0.2;
  dom.ammoTxt.classList.toggle('low', lowAmmo);

  // Weapon icon + mode
  if (dom.wcIcon) dom.wcIcon.innerHTML = getWeaponIconSVG(gameState.pWeaponId);
  if (dom.wcMode) dom.wcMode.textContent = getWeaponModeLabel(gameState.pWeaponId);

  // Reload hint
  if (dom.wcReloadHint) {
    const needsReload = !isUnarmed && gameState.pAmmo < wep.magSize && !gameState.pReloading;
    dom.wcReloadHint.classList.toggle('on', needsReload);
    dom.wcReloadHint.textContent = 'R';
  }

  // ── Weapon slots ──
  for (let i = 0; i < 3; i++) {
    const slotEl = [dom.slot0, dom.slot1, dom.slot2][i];
    const iconEl = [dom.slot0icon, dom.slot1icon, dom.slot2icon][i];
    const nameEl = [dom.slot0name, dom.slot1name, dom.slot2name][i];
    if (!slotEl || !iconEl || !nameEl) continue;

    const wepId = gameState.pWeaponSlots[i];
    if (wepId) {
      slotEl.classList.toggle('active', gameState.pActiveSlot === i);
      slotEl.classList.remove('empty');
      if (lastSlotIcons[i] !== wepId) {
        iconEl.innerHTML = getWeaponIconSVG(wepId);
        nameEl.textContent = WEAPONS[wepId].name;
        lastSlotIcons[i] = wepId;
      }
    } else {
      slotEl.classList.add('empty');
      slotEl.classList.remove('active');
      if (lastSlotIcons[i] !== null) {
        iconEl.innerHTML = '—';
        nameEl.textContent = '—';
        lastSlotIcons[i] = null;
      }
    }
  }
  lastActiveSlot = gameState.pActiveSlot;

  // ── Grenades ──
  dom.grenadeTxt.textContent = String(gameState.pGrenades);
}

export function updateCrosshair(): void {
  const el = xhEl();
  if (!el) return;
  const { keys } = gameState;
  const isMoving = keys.w || keys.a || keys.s || keys.d;

  el.classList.toggle('spread', isMoving);
}

export function flashCrosshairFire(): void {
  const el = xhEl();
  if (!el) return;
  el.classList.add('fire');
  el.classList.add('spread');
  clearTimeout(fireTO);
  fireTO = setTimeout(() => {
    el.classList.remove('fire');
  }, 80);
}

export function flashDmg(): void {
  dom.dmg.style.opacity = '.6';
  clearTimeout(dmgTO);
  dmgTO = setTimeout(() => { dom.dmg.style.opacity = '0'; }, 150);
}

export function flashHeal(): void {
  dom.hlf.style.opacity = '1';
  clearTimeout(hlfTO);
  hlfTO = setTimeout(() => { dom.hlf.style.opacity = '0'; }, 300);
}
