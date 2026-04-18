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
  // New top-center panel
  if (dom.miMode) dom.miMode.textContent = getModeLabel();
  if (dom.miTime) {
    dom.miTime.textContent = formatTime(gameState.matchTimeRemaining);
    dom.miTime.classList.toggle('urgent', gameState.matchTimeRemaining <= 30 && gameState.matchTimeRemaining > 0);
  }

  if (gameState.mode === 'ffa') {
    const leader = Math.max(
      gameState.pKills,
      ...gameState.agents.filter(a => a !== gameState.player).map(a => a.kills),
    );
    if (dom.miScoreBlue) dom.miScoreBlue.textContent = String(gameState.pKills);
    if (dom.miScoreRed) dom.miScoreRed.textContent = String(leader);
  } else {
    if (dom.miScoreBlue) dom.miScoreBlue.textContent = String(gameState.teamScores[TEAM_BLUE]);
    if (dom.miScoreRed) dom.miScoreRed.textContent = String(gameState.teamScores[TEAM_RED]);
  }

  // Legacy fallback if the old sbMid still exists
  if (dom.sbMid && dom.sbMid !== dom.miTime) {
    let midText = `${getModeLabel()} · ${formatTime(gameState.matchTimeRemaining)}`;
    if (gameState.mode === 'elimination') {
      let blueAlive = 0, redAlive = 0;
      for (const ag of gameState.agents) {
        if (ag.isDead) continue;
        if (ag.team === TEAM_BLUE) blueAlive++;
        else redAlive++;
      }
      midText = `ELIM R${gameState.eliminationRound + 1} · ${blueAlive}v${redAlive} · ${formatTime(gameState.matchTimeRemaining)}`;
    }
    dom.sbMid.textContent = midText;
  }
}

export function updateTabboard(): void {
  dom.tabboard.classList.toggle('on', gameState.keys.tab);
  if (!gameState.keys.tab) return;

  const { agents, player, teamScores } = gameState;
  let html = '';

  if (gameState.mode === 'ffa') {
    const rows = agents.map((a) => ({
      a, kills: a === player ? gameState.pKills : a.kills,
      deaths: a === player ? gameState.pDeaths : a.deaths,
      assists: a === player ? gameState.pAssists : ((a as any).assists ?? 0),
    })).sort((x, y) => y.kills - x.kills);
    html += `<div class="tb-section" style="color:#ffaa33">FREE FOR ALL</div>`;
    for (const row of rows) {
      const me = row.a === player ? ' me' : '';
      const kd = row.deaths > 0 ? (row.kills / row.deaths).toFixed(2) : row.kills.toFixed(2);
      html += `<div class="tb-row${me}"><span>${row.a.name}</span><span>${row.kills}</span><span>${row.deaths}</span><span>${row.assists}</span><span>${kd}</span><span>${row.kills * 100}</span></div>`;
    }
  } else {
    const blueTeam = agents.filter((a) => a.team === TEAM_BLUE).sort((a, b) => b.kills - a.kills);
    const redTeam = agents.filter((a) => a.team === TEAM_RED).sort((a, b) => b.kills - a.kills);
    const modeTag = gameState.mode === 'elimination' ? 'ELIM' : '';

    html = `<div class="tb-section" style="color:#4aa8ff">BLUE TEAM ${modeTag} — ${teamScores[TEAM_BLUE]}</div>`;
    for (const a of blueTeam) {
      const me = a === player ? ' me' : '';
      const k = a === player ? gameState.pKills : a.kills;
      const d = a === player ? gameState.pDeaths : a.deaths;
      const ast = a === player ? gameState.pAssists : ((a as any).assists ?? 0);
      const aliveTag = a.isDead ? ' ☠' : '';
      const kd = d > 0 ? (k / d).toFixed(2) : k.toFixed(2);
      html += `<div class="tb-row${me}"><span style="color:#4aa8ff">${a.name}${aliveTag}</span><span>${k}</span><span>${d}</span><span>${ast}</span><span>${kd}</span><span>${k * 100}</span></div>`;
    }

    html += `<div class="tb-section" style="color:#ff5c5c">RED TEAM ${modeTag} — ${teamScores[TEAM_RED]}</div>`;
    for (const a of redTeam) {
      const aliveTag = a.isDead ? ' ☠' : '';
      const ast = (a as any).assists ?? 0;
      const rkd = a.deaths > 0 ? (a.kills / a.deaths).toFixed(2) : a.kills.toFixed(2);
      html += `<div class="tb-row"><span style="color:#ff5c5c">${a.name}${aliveTag}</span><span>${a.kills}</span><span>${a.deaths}</span><span>${ast}</span><span>${rkd}</span><span>${a.kills * 100}</span></div>`;
    }
  }

  dom.tbBody.innerHTML = html;
}
