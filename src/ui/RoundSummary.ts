import { gameState } from '@/core/GameState';
import { TEAM_BLUE, TEAM_RED } from '@/config/constants';
import { dom } from './DOMElements';
import { resetMatch } from '@/combat/Combat';
import { updateScoreboard } from './Scoreboard';
import { updateHUD } from './HUD';

interface PlayerStats {
  name: string;
  team: number;
  kills: number;
  deaths: number;
  isPlayer: boolean;
}

export function showRoundSummary(winnerTeam: number): void {
  gameState.roundOver = true;
  document.exitPointerLock?.();

  const stats: PlayerStats[] = [];
  for (const ag of gameState.agents) {
    const isPlayer = ag === gameState.player;
    stats.push({
      name: isPlayer ? 'Player' : ag.name,
      team: ag.team,
      kills: isPlayer ? gameState.pKills : ag.kills,
      deaths: isPlayer ? gameState.pDeaths : ag.deaths,
      isPlayer,
    });
  }
  stats.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);

  if (gameState.mode === 'ffa') {
    const top = stats[0];
    dom.rsResult.textContent = top.isPlayer ? 'VICTORY' : 'DEFEAT';
    dom.rsResult.style.color = top.isPlayer ? '#22c55e' : '#ef4444';
    dom.rsTeamScore.textContent = `FFA · Leader ${top.name} · ${top.kills} kills`;
  } else {
    const playerTeam = gameState.player.team;
    const isVictory = winnerTeam === playerTeam;
    dom.rsResult.textContent = isVictory ? 'VICTORY' : 'DEFEAT';
    dom.rsResult.style.color = isVictory ? '#22c55e' : '#ef4444';
    dom.rsTeamScore.innerHTML = `<span style="color:var(--blue)">BLUE ${gameState.teamScores[TEAM_BLUE]}</span> <span style="color:var(--muted)">—</span> <span style="color:var(--red)">${gameState.teamScores[TEAM_RED]} RED</span>`;
  }

  const mvp = stats[0];
  const mvpKd = mvp.deaths > 0 ? (mvp.kills / mvp.deaths).toFixed(1) : mvp.kills.toFixed(1);
  const mvpColor = mvp.team === TEAM_BLUE ? 'var(--blue)' : 'var(--red)';
  dom.rsMvp.innerHTML = `
    <div style="font-family:'Orbitron',monospace;font-size:24px;font-weight:900;color:${mvpColor};letter-spacing:.1em;text-shadow:0 0 20px currentColor;margin-top:6px">${mvp.name.toUpperCase()}</div>
    <div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted);margin-top:8px">${mvp.kills} Kills • ${mvp.deaths} Deaths • ${mvpKd} K/D</div>
    ${mvp.isPlayer ? '<div style="font-size:9px;color:var(--blue);margin-top:4px;letter-spacing:.15em;font-family:Orbitron,monospace">— YOU —</div>' : ''}
  `;

  dom.rsPodium.innerHTML = stats.slice(0, 3).map((p, i) => `
    <div class="rs-pod-card ${i === 0 ? 'rs-pod-1st' : i === 1 ? 'rs-pod-2nd' : 'rs-pod-3rd'}">
      <div style="font-size:28px;line-height:1">${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</div>
      <div style="font-family:'Orbitron',monospace;font-size:13px;font-weight:700;color:${p.team === TEAM_BLUE ? 'var(--blue)' : 'var(--red)'};margin:6px 0 2px">${p.name}</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text)">${p.kills}K / ${p.deaths}D</div>
    </div>`).join('');

  dom.rsStats.innerHTML = `
    <div class="rs-stats-header"><span>PLAYER</span><span>TEAM</span><span>K</span><span>D</span><span>K/D</span></div>
    ${stats.map((s) => {
      const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(1) : s.kills.toFixed(1);
      return `<div class="rs-stats-row${s.isPlayer ? ' me' : ''}"><span>${s.name}${s.isPlayer ? ' (YOU)' : ''}</span><span>${gameState.mode === 'ffa' ? 'FFA' : s.team === TEAM_BLUE ? 'BLUE' : 'RED'}</span><span>${s.kills}</span><span>${s.deaths}</span><span>${kd}</span></div>`;
    }).join('')}`;

  dom.rsBtn.onclick = () => {
    resetMatch(gameState.mode);
    updateScoreboard();
    updateHUD();
    dom.roundSummary.classList.remove('on');
    setTimeout(() => gameState.renderer?.domElement?.requestPointerLock(), 100);
  };

  dom.roundSummary.classList.add('on');
}
