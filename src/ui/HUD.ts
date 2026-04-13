import { gameState } from '@/core/GameState';
import { WEAPONS } from '@/config/weapons';
import { dom } from './DOMElements';

let dmgTO: ReturnType<typeof setTimeout>;
let hlfTO: ReturnType<typeof setTimeout>;
let fireTO: ReturnType<typeof setTimeout>;

const xhEl = (): HTMLElement => document.getElementById('xh')!;

/**
 * Update the HUD display (HP bar, ammo, weapon name, kills, deaths, grenades).
 */
export function updateHUD(): void {
  dom.hpFill.style.width = gameState.pHP + '%';
  dom.hpTxt.textContent = String(gameState.pHP);
  dom.ammoTxt.textContent = String(gameState.pAmmo);

  const wep = WEAPONS[gameState.pWeaponId];
  dom.ammoMax.textContent = '/ ' + wep.magSize;
  dom.weaponName.textContent = wep.name;
  dom.grenadeTxt.textContent = '🧨 ' + gameState.pGrenades;
}

/**
 * Update crosshair spread based on movement/firing state.
 */
export function updateCrosshair(): void {
  const el = xhEl();
  if (!el) return;
  const { keys } = gameState;
  const isMoving = keys.w || keys.a || keys.s || keys.d;
  const isSprinting = keys.shift && isMoving;

  if (isMoving || isSprinting) {
    el.classList.add('spread');
  } else {
    el.classList.remove('spread');
  }
}

/**
 * Flash crosshair on fire.
 */
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

/**
 * Flash the damage vignette overlay.
 */
export function flashDmg(): void {
  dom.dmg.style.opacity = '.65';
  clearTimeout(dmgTO);
  dmgTO = setTimeout(() => { dom.dmg.style.opacity = '0'; }, 120);
}

/**
 * Flash the heal vignette overlay.
 */
export function flashHeal(): void {
  dom.hlf.style.opacity = '1';
  clearTimeout(hlfTO);
  hlfTO = setTimeout(() => { dom.hlf.style.opacity = '0'; }, 300);
}
