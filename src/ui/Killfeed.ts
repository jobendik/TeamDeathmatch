import { TEAM_BLUE } from '@/config/constants';
import { gameState, type KillfeedEntry } from '@/core/GameState';
import { dom } from './DOMElements';

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
): void {
  const entry: KillfeedEntry = {
    killer, victim, killerTeam, victimTeam,
    time: gameState.worldElapsed,
    weaponName,
    headshot,
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
      const wep = e.weaponName ? `<span class="kf-wep">[${e.weaponName}]</span>` : '<span class="kf-arrow">►</span>';
      const hs = e.headshot ? '<span class="kf-hs" title="Headshot">💀</span>' : '';
      return `<div class="kf-entry"><span class="${kc}">${e.killer}</span>${wep}${hs}<span class="${vc}">${e.victim}</span></div>`;
    })
    .join('');
}
