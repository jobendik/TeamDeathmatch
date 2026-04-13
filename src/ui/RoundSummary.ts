import { gameState } from '@/core/GameState';
import { TEAM_BLUE, TEAM_RED, BLUE_SPAWNS } from '@/config/constants';
import { dom } from './DOMElements';
import { updateScoreboard } from './Scoreboard';
import { updateHUD } from './HUD';
import { respawnAgent } from '@/combat/Combat';

interface PlayerStats {
  name: string;
  team: number;
  kills: number;
  deaths: number;
  isPlayer: boolean;
}

export function showRoundSummary(winnerTeam: number): void {
  gameState.roundOver = true;

  // Release pointer lock
  document.exitPointerLock?.();

  // Gather stats
  const stats: PlayerStats[] = [];
  for (const ag of gameState.agents) {
    const isPlayer = ag === gameState.player;
    stats.push({
      name: ag.name,
      team: ag.team,
      kills: isPlayer ? gameState.pKills : ag.kills,
      deaths: isPlayer ? gameState.pDeaths : ag.deaths,
      isPlayer,
    });
  }

  // Sort by kills descending, then deaths ascending
  stats.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);

  // Result title
  const playerTeam = gameState.player.team;
  const isVictory = winnerTeam === playerTeam;
  dom.rsResult.textContent = isVictory ? 'VICTORY' : 'DEFEAT';
  dom.rsResult.style.color = isVictory ? '#22c55e' : '#ef4444';

  // Team score
  const blueScore = gameState.teamScores[TEAM_BLUE];
  const redScore = gameState.teamScores[TEAM_RED];
  dom.rsTeamScore.innerHTML =
    `<span style="color:var(--blue)">BLUE ${blueScore}</span>` +
    ` <span style="color:var(--muted)">—</span> ` +
    `<span style="color:var(--red)">${redScore} RED</span>`;

  // MVP (best player)
  const mvp = stats[0];
  const mvpKd = mvp.deaths > 0 ? (mvp.kills / mvp.deaths).toFixed(1) : mvp.kills.toFixed(1);
  const mvpColor = mvp.team === TEAM_BLUE ? 'var(--blue)' : 'var(--red)';
  dom.rsMvp.innerHTML = `
    <div style="font-family:'Orbitron',monospace;font-size:24px;font-weight:900;color:${mvpColor};letter-spacing:.1em;text-shadow:0 0 20px currentColor;margin-top:6px">${mvp.name.toUpperCase()}</div>
    <div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted);margin-top:8px">${mvp.kills} Kills &bull; ${mvp.deaths} Deaths &bull; ${mvpKd} K/D</div>
    ${mvp.isPlayer ? '<div style="font-size:9px;color:var(--blue);margin-top:4px;letter-spacing:.15em;font-family:Orbitron,monospace">— YOU —</div>' : ''}
  `;

  // Podium — top 3 (displayed as 2nd, 1st, 3rd)
  const top3 = stats.slice(0, Math.min(3, stats.length));
  const podiumOrder = top3.length >= 3
    ? [top3[1], top3[0], top3[2]]
    : top3.length === 2
      ? [top3[1], top3[0]]
      : [top3[0]];

  const medals = ['🥈', '🥇', '🥉'];
  const podClasses = ['rs-pod-2nd', 'rs-pod-1st', 'rs-pod-3rd'];
  const medalsSmall = top3.length < 3 ? ['🥈', '🥇'] : medals;
  const podClassesSmall = top3.length < 3 ? ['rs-pod-2nd', 'rs-pod-1st'] : podClasses;

  let podHtml = '';
  podiumOrder.forEach((p, i) => {
    const tc = p.team === TEAM_BLUE ? 'var(--blue)' : 'var(--red)';
    const medal = (top3.length >= 3 ? medals : medalsSmall)[i] || '🏅';
    const cls = (top3.length >= 3 ? podClasses : podClassesSmall)[i] || '';
    const delay = 1.0 + i * 0.2;
    const youTag = p.isPlayer ? '<div style="font-size:8px;color:var(--muted);margin-top:2px">YOU</div>' : '';
    podHtml += `
      <div class="rs-pod-card ${cls}" style="animation-delay:${delay}s">
        <div style="font-size:28px;line-height:1">${medal}</div>
        <div style="font-family:'Orbitron',monospace;font-size:13px;font-weight:700;color:${tc};margin:6px 0 2px">${p.name}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text)">${p.kills}K / ${p.deaths}D</div>
        ${youTag}
      </div>
    `;
  });
  dom.rsPodium.innerHTML = podHtml;

  // Full stats table — both teams
  let tableHtml = `
    <div class="rs-stats-header">
      <span>PLAYER</span><span>TEAM</span><span>K</span><span>D</span><span>K/D</span>
    </div>
  `;

  // Blue team section
  const blueStats = stats.filter(s => s.team === TEAM_BLUE);
  const redStats = stats.filter(s => s.team === TEAM_RED);

  tableHtml += `<div class="rs-section-label" style="color:var(--blue)">BLUE TEAM</div>`;
  blueStats.forEach((s, i) => {
    const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(1) : s.kills.toFixed(1);
    const me = s.isPlayer ? ' me' : '';
    const delay = 1.5 + i * 0.08;
    tableHtml += `
      <div class="rs-stats-row${me}" style="animation-delay:${delay}s">
        <span style="color:var(--blue)">${s.name}${s.isPlayer ? ' (YOU)' : ''}</span>
        <span style="color:var(--blue);font-size:9px;opacity:.6">BLUE</span>
        <span>${s.kills}</span>
        <span>${s.deaths}</span>
        <span>${kd}</span>
      </div>
    `;
  });

  const redDelay = 1.5 + blueStats.length * 0.08;
  tableHtml += `<div class="rs-section-label" style="color:var(--red);animation-delay:${redDelay}s">RED TEAM</div>`;
  redStats.forEach((s, i) => {
    const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(1) : s.kills.toFixed(1);
    const delay = redDelay + 0.08 + i * 0.08;
    tableHtml += `
      <div class="rs-stats-row" style="animation-delay:${delay}s">
        <span style="color:var(--red)">${s.name}</span>
        <span style="color:var(--red);font-size:9px;opacity:.6">RED</span>
        <span>${s.kills}</span>
        <span>${s.deaths}</span>
        <span>${kd}</span>
      </div>
    `;
  });

  dom.rsStats.innerHTML = tableHtml;

  // Bind play again
  dom.rsBtn.onclick = () => resetGame();

  // Show the summary
  dom.roundSummary.classList.add('on');
}

function resetGame(): void {
  gameState.roundOver = false;

  // Reset scores
  gameState.teamScores = [0, 0];
  gameState.pKills = 0;
  gameState.pDeaths = 0;

  // Reset player
  if (gameState.pDead) {
    gameState.pDead = false;
    dom.ds.classList.remove('on');
  }
  gameState.pHP = 100;
  gameState.player.hp = 100;
  gameState.pAmmo = gameState.pMaxAmmo;
  gameState.pReloading = false;
  dom.reloadBar.classList.remove('on');
  dom.reloadText.classList.remove('on');

  const sp = BLUE_SPAWNS[0];
  gameState.player.position.set(sp[0], 0, sp[2]);

  // Reset all agents
  for (const ag of gameState.agents) {
    if (ag === gameState.player) continue;
    ag.kills = 0;
    ag.deaths = 0;
    ag.confidence = 50;
    ag.killStreak = 0;
    if (ag.isDead) {
      respawnAgent(ag);
    } else {
      ag.hp = ag.maxHP;
      ag.ammo = ag.magSize;
    }
  }

  // Clear killfeed
  gameState.killfeedEntries = [];
  dom.killfeed.innerHTML = '';

  // Update UI
  dom.killTxt.textContent = '0';
  dom.deathTxt.textContent = '0';
  updateScoreboard();
  updateHUD();

  // Hide summary
  dom.roundSummary.classList.remove('on');

  // Re-lock mouse
  setTimeout(() => {
    gameState.renderer?.domElement?.requestPointerLock();
  }, 100);
}
