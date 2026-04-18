import { TEAM_BLUE } from '@/config/constants';
import { gameState, type KillfeedEntry } from '@/core/GameState';
import { dom } from './DOMElements';
import { getWeaponIconSVG } from './WeaponIcons';
import type { WeaponId } from '@/config/weapons';

/**
 * Add a new kill feed entry and re-render.
 */
export function addKillfeedEntry(
  killer: string,
  victim: string,
  killerTeam: number,
  victimTeam: number,
  weaponName?: string,
  headshot?: boolean,
  weaponId?: WeaponId,
  isAssist?: boolean,
  isWallbang?: boolean,
): void {
  const entry: KillfeedEntry = {
    killer, victim, killerTeam, victimTeam,
    time: gameState.worldElapsed,
    weaponName,
    weaponId,
    headshot,
    isAssist,
    isWallbang,
  };
  gameState.killfeedEntries.push(entry);
  if (gameState.killfeedEntries.length > 6) gameState.killfeedEntries.shift();
  renderKillfeed();
}

/**
 * Render the kill feed from current entries.
 */
function renderKillfeed(): void {
  dom.killfeed.innerHTML = gameState.killfeedEntries
    .slice()
    .reverse()
    .map((e) => {
      const kc = e.killerTeam === TEAM_BLUE ? 'kf-blue' : 'kf-red';
      const vc = e.victimTeam === TEAM_BLUE ? 'kf-blue' : 'kf-red';
      const icon = e.weaponId ? getWeaponIconSVG(e.weaponId as WeaponId) : '';
      const wep = icon
        ? `<span class="kf-wep kf-wep-icon">${icon}</span>`
        : e.weaponName
          ? `<span class="kf-wep">[${e.weaponName}]</span>`
          : '<span class="kf-arrow">►</span>';
      const hs = e.headshot ? '<span class="kf-hs" title="Headshot">💀</span>' : '';
      const wb = e.isWallbang ? '<span class="kf-wb" title="Wallbang">◆</span>' : '';
      const assistTag = e.isAssist ? '<span class="kf-assist">ASSIST</span>' : '';
      const pName = gameState.player.name;
      const selfCls = (e.killer === pName || e.victim === pName) ? ' kf-self' : '';
      return `<div class="kf-entry${selfCls}">${assistTag}<span class="${kc}">${e.killer}</span>${wep}${hs}${wb}<span class="${vc}">${e.victim}</span></div>`;
    })
    .join('');
}
