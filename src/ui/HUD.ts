import { gameState } from '@/core/GameState';
import { WEAPONS } from '@/config/weapons';
import { dom } from './DOMElements';

let dmgTO: ReturnType<typeof setTimeout>;
let hlfTO: ReturnType<typeof setTimeout>;
let fireTO: ReturnType<typeof setTimeout>;

const xhEl = (): HTMLElement => document.getElementById('xh')!;

export function updateHUD(): void {
  dom.hpFill.style.width = gameState.pHP + '%';
  dom.hpTxt.textContent = String(Math.round(gameState.pHP));

  const wep = WEAPONS[gameState.pWeaponId];

  if (gameState.pWeaponId === 'unarmed') {
    dom.ammoTxt.textContent = '--';
    dom.ammoMax.textContent = '';
    dom.weaponName.textContent = 'UNARMED';
  } else {
    dom.ammoTxt.textContent = String(gameState.pAmmo);
    dom.ammoMax.textContent = '/ ' + wep.magSize;
    dom.weaponName.textContent = wep.name;
  }

  dom.grenadeTxt.textContent = '🧨 ' + gameState.pGrenades;
}

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
  dom.dmg.style.opacity = '.65';
  clearTimeout(dmgTO);
  dmgTO = setTimeout(() => { dom.dmg.style.opacity = '0'; }, 120);
}

export function flashHeal(): void {
  dom.hlf.style.opacity = '1';
  clearTimeout(hlfTO);
  hlfTO = setTimeout(() => { dom.hlf.style.opacity = '0'; }, 300);
}
