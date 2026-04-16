import { TEAM_BLUE, TEAM_RED } from '@/config/constants';
import { gameState } from '@/core/GameState';
import { dom } from './DOMElements';
import { getModeLabel } from '@/core/GameModes';

function formatTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function updateScoreboard(): void {
  if (gameState.mode === 'ffa') {
    const leader = Math.max(gameState.pKills, ...gameState.agents.filter(a => a !== gameState.player).map(a => a.kills));
    dom.sbBlue.textContent = String(gameState.pKills);
    dom.sbRed.textContent = String(leader);
  } else {
    dom.sbBlue.textContent = String(gameState.teamScores[TEAM_BLUE]);
    dom.sbRed.textContent = String(gameState.teamScores[TEAM_RED]);
  }

  let midText = `${getModeLabel()} · ${formatTime(gameState.matchTimeRemaining)}`;

  // Show alive counts in elimination mode
  if (gameState.mode === 'elimination') {
    let blueAlive = 0;
    let redAlive = 0;
    for (const ag of gameState.agents) {
      if (ag.isDead) continue;
      if (ag.team === TEAM_BLUE) blueAlive++;
      else redAlive++;
    }
    midText = `ELIM R${gameState.eliminationRound + 1} · ${blueAlive}v${redAlive} · ${formatTime(gameState.matchTimeRemaining)}`;
  }

  dom.sbMid.textContent = midText;
}

export function updateTabboard(): void {
  dom.tabboard.classList.toggle('on', gameState.keys.tab);
  if (!gameState.keys.tab) return;

  const { agents, player, teamScores } = gameState;
  let html = '';

  if (gameState.mode === 'ffa') {
    const rows = agents.map((a) => ({ a, kills: a === player ? gameState.pKills : a.kills, deaths: a === player ? gameState.pDeaths : a.deaths }))
      .sort((x, y) => y.kills - x.kills);
    html += `<div class="tb-section" style="color:#f59e0b">FREE FOR ALL</div>`;
    for (const row of rows) {
      const me = row.a === player ? ' me' : '';
      html += `<div class="tb-row${me}"><span>${row.a.name}</span><span>${row.kills}</span><span>${row.deaths}</span><span>${row.kills * 100}</span></div>`;
    }
  } else {
    const blueTeam = agents.filter((a) => a.team === TEAM_BLUE).sort((a, b) => b.kills - a.kills);
    const redTeam = agents.filter((a) => a.team === TEAM_RED).sort((a, b) => b.kills - a.kills);

    const modeTag = gameState.mode === 'elimination' ? 'ELIM' : '';
    html = `<div class="tb-section" style="color:#38bdf8">BLÅ LAG ${modeTag} — ${teamScores[TEAM_BLUE]}</div>`;
    for (const a of blueTeam) {
      const me = a === player ? ' me' : '';
      const k = a === player ? gameState.pKills : a.kills;
      const d = a === player ? gameState.pDeaths : a.deaths;
      const aliveTag = a.isDead ? ' ☠' : '';
      html += `<div class="tb-row${me}"><span style="color:#38bdf8">${a.name}${aliveTag}</span><span>${k}</span><span>${d}</span><span>${k * 100}</span></div>`;
    }

    html += `<div class="tb-section" style="color:#ef4444">RØDT LAG ${modeTag} — ${teamScores[TEAM_RED]}</div>`;
    for (const a of redTeam) {
      const aliveTag = a.isDead ? ' ☠' : '';
      html += `<div class="tb-row"><span style="color:#ef4444">${a.name}${aliveTag}</span><span>${a.kills}</span><span>${a.deaths}</span><span>${a.kills * 100}</span></div>`;
    }
  }

  dom.tbBody.innerHTML = html;
}
