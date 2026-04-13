import { TEAM_BLUE, TEAM_RED } from '@/config/constants';
import { gameState } from '@/core/GameState';
import { dom } from './DOMElements';

/**
 * Update the top scoreboard (Blue vs Red).
 */
export function updateScoreboard(): void {
  dom.sbBlue.textContent = String(gameState.teamScores[TEAM_BLUE]);
  dom.sbRed.textContent = String(gameState.teamScores[TEAM_RED]);
}

/**
 * Update the TAB scoreboard overlay.
 */
export function updateTabboard(): void {
  dom.tabboard.classList.toggle('on', gameState.keys.tab);
  if (!gameState.keys.tab) return;

  const { agents, player, teamScores } = gameState;

  const blueTeam = agents.filter((a) => a.team === TEAM_BLUE).sort((a, b) => b.kills - a.kills);
  const redTeam = agents.filter((a) => a.team === TEAM_RED).sort((a, b) => b.kills - a.kills);

  let html = `<div class="tb-section" style="color:#38bdf8">BLÅ LAG — ${teamScores[TEAM_BLUE]} KILLS</div>`;
  for (const a of blueTeam) {
    const me = a === player ? ' me' : '';
    const k = a === player ? gameState.pKills : a.kills;
    const d = a === player ? gameState.pDeaths : a.deaths;
    html += `<div class="tb-row${me}"><span style="color:#38bdf8">${a.name}</span><span>${k}</span><span>${d}</span><span>${k * 100}</span></div>`;
  }

  html += `<div class="tb-section" style="color:#ef4444">RØDT LAG — ${teamScores[TEAM_RED]} KILLS</div>`;
  for (const a of redTeam) {
    html += `<div class="tb-row"><span style="color:#ef4444">${a.name}</span><span>${a.kills}</span><span>${a.deaths}</span><span>${a.kills * 100}</span></div>`;
  }

  dom.tbBody.innerHTML = html;
}
