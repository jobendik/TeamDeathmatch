import { gameState } from '@/core/GameState';
import { TEAM_BLUE } from '@/config/constants';
import { dom } from './DOMElements';
import { resetMatch } from '@/combat/Combat';
import { updateScoreboard } from './Scoreboard';
import { updateHUD } from './HUD';
import { matchState, MEDALS, resetMatchMedals } from './Medals';
import { clearChallenges, getCompletedChallenges, rollChallenges } from './Challenges';
import { clearFloatingDamage } from './FloatingDamage';
import { clearAnnouncer } from './Announcer';

interface PlayerStats {
  name: string; team: number; kills: number; deaths: number; isPlayer: boolean;
}

// Persistent across matches via localStorage
interface Progression {
  level: number;
  xp: number;
  totalMatches: number;
  totalKills: number;
}

const XP_PER_LEVEL = 1000;

function loadProgression(): Progression {
  try {
    const raw = localStorage.getItem('warzone_prog');
    if (raw) return JSON.parse(raw);
  } catch {}
  return { level: 1, xp: 0, totalMatches: 0, totalKills: 0 };
}

function saveProgression(p: Progression): void {
  try { localStorage.setItem('warzone_prog', JSON.stringify(p)); } catch {}
}

export function showRoundSummary(winnerTeam: number): void {
  gameState.roundOver = true;
  document.exitPointerLock?.();
  clearFloatingDamage();
  clearAnnouncer();

  const prog = loadProgression();
  const startLevel = prog.level;
  const startXP = prog.xp;
  const earnedXP = matchState.playerXP;

  prog.xp += earnedXP;
  prog.totalMatches++;
  prog.totalKills += gameState.pKills;
  const leveledUp = prog.xp >= prog.level * XP_PER_LEVEL;
  while (prog.xp >= prog.level * XP_PER_LEVEL) {
    prog.xp -= prog.level * XP_PER_LEVEL;
    prog.level++;
  }
  saveProgression(prog);

  // Build roster
  const stats: PlayerStats[] = [];
  for (const ag of gameState.agents) {
    const isPlayer = ag === gameState.player;
    stats.push({
      name: isPlayer ? 'YOU' : ag.name,
      team: ag.team,
      kills: isPlayer ? gameState.pKills : ag.kills,
      deaths: isPlayer ? gameState.pDeaths : ag.deaths,
      isPlayer,
    });
  }
  stats.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);

  const playerTeam = gameState.player.team;
  const isVictory = gameState.mode === 'ffa'
    ? stats[0].isPlayer
    : winnerTeam === playerTeam;

  // Result banner
  dom.rsResult.textContent = isVictory ? 'VICTORY' : 'DEFEAT';
  dom.rsResult.style.color = isVictory ? '#22d66a' : '#ef4444';

  // Team score or FFA
  if (gameState.mode === 'ffa') {
    dom.rsTeamScore.textContent = `FFA · ${gameState.pKills} KILLS · RANK #${stats.findIndex(s => s.isPlayer) + 1}`;
  } else {
    dom.rsTeamScore.innerHTML = `
      <span style="color:var(--blue)">BLUE ${gameState.teamScores[0]}</span>
      <span style="color:var(--muted); margin: 0 12px">—</span>
      <span style="color:var(--red)">${gameState.teamScores[1]} RED</span>
    `;
  }

  // ── XP / Level-up panel ──
  const xpPct = (prog.xp / (prog.level * XP_PER_LEVEL)) * 100;
  const startPct = (startXP / (startLevel * XP_PER_LEVEL)) * 100;

  dom.rsMvp.innerHTML = `
    <div class="prog-level-row">
      <div class="prog-level-badge">
        <div class="prog-level-num">${startLevel}</div>
        <div class="prog-level-lbl">LVL</div>
      </div>
      <div class="prog-bar-wrap">
        <div class="prog-bar">
          <div class="prog-bar-old" style="width:${startPct}%"></div>
          <div class="prog-bar-new" id="progBarNew" style="width:${startPct}%"></div>
        </div>
        <div class="prog-xp-text">
          <span id="progXpCount">+0</span> XP
          ${leveledUp ? '<span class="prog-levelup">LEVEL UP!</span>' : ''}
        </div>
      </div>
      <div class="prog-level-badge ${leveledUp ? 'new' : ''}">
        <div class="prog-level-num">${prog.level}</div>
        <div class="prog-level-lbl">LVL</div>
      </div>
    </div>
  `;

  // Animate XP count up
  setTimeout(() => {
    const bar = document.getElementById('progBarNew');
    const text = document.getElementById('progXpCount');
    if (bar) bar.style.width = `${xpPct}%`;
    if (text) {
      const start = performance.now();
      const dur = 1200;
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        text.textContent = `+${Math.floor(earnedXP * eased)}`;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }, 900);

  // ── Medals earned this match ──
  const medalIds = matchState.medalsEarned.map(m => m.medal);
  const uniqueMedals = [...new Set(medalIds)];
  const medalCounts = uniqueMedals.map(id => ({
    id, count: medalIds.filter(x => x === id).length, def: MEDALS[id],
  }));

  dom.rsPodium.innerHTML = `
    <div class="rs-section-header">ACCOLADES</div>
    <div class="rs-medals-grid">
      ${medalCounts.length === 0
        ? '<div class="rs-no-medals">No medals earned this match</div>'
        : medalCounts.map(m => `
          <div class="rs-medal-card" style="border-color:${m.def.color}">
            <div class="rs-medal-icon" style="color:${m.def.color}">${m.def.icon}</div>
            <div class="rs-medal-name" style="color:${m.def.color}">${m.def.name}</div>
            ${m.count > 1 ? `<div class="rs-medal-x">×${m.count}</div>` : ''}
          </div>
        `).join('')}
    </div>
  `;

  // ── Challenges completed ──
  const completed = getCompletedChallenges();
  const challengeHtml = completed.length > 0 ? `
    <div class="rs-section-header">CHALLENGES COMPLETE</div>
    <div class="rs-challenges">
      ${completed.map(c => `
        <div class="rs-challenge-done">
          <span class="rs-ch-icon">${c.icon}</span>
          <span class="rs-ch-label">${c.label}</span>
          <span class="rs-ch-xp">+${c.xp} XP</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  // ── Personal combat stats ──
  const accuracy = gameState.pShotsFired > 0
    ? Math.round((gameState.pShotsHit / gameState.pShotsFired) * 100) : 0;
  const hsRate = gameState.pShotsHit > 0
    ? Math.round((gameState.pHeadshots / gameState.pShotsHit) * 100) : 0;

  const combatHtml = `
    <div class="rs-section-header">COMBAT STATS</div>
    <div class="rs-combat-stats">
      <div class="rs-combat-stat"><span class="rs-cs-val">${gameState.pShotsFired}</span><span class="rs-cs-lbl">SHOTS</span></div>
      <div class="rs-combat-stat"><span class="rs-cs-val">${gameState.pShotsHit}</span><span class="rs-cs-lbl">HITS</span></div>
      <div class="rs-combat-stat"><span class="rs-cs-val">${accuracy}%</span><span class="rs-cs-lbl">ACCURACY</span></div>
      <div class="rs-combat-stat"><span class="rs-cs-val">${gameState.pHeadshots}</span><span class="rs-cs-lbl">HEADSHOTS</span></div>
      <div class="rs-combat-stat"><span class="rs-cs-val">${hsRate}%</span><span class="rs-cs-lbl">HS RATE</span></div>
    </div>
  `;

  // ── Scoreboard ──
  const scoreboardHtml = `
    <div class="rs-section-header">FINAL STANDINGS</div>
    <div class="rs-stats-grid">
      ${stats.slice(0, 6).map((s, i) => {
        const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2);
        const teamCol = gameState.mode === 'ffa' ? 'var(--text)' : (s.team === TEAM_BLUE ? 'var(--blue)' : 'var(--red)');
        return `
          <div class="rs-stat-row ${s.isPlayer ? 'me' : ''}">
            <span class="rs-rank">#${i + 1}</span>
            <span class="rs-name" style="color:${teamCol}">${s.name}</span>
            <span class="rs-kd">${s.kills}<span class="rs-sep">/</span>${s.deaths}</span>
            <span class="rs-kdr">${kd}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;

  dom.rsStats.innerHTML = combatHtml + challengeHtml + scoreboardHtml;

  dom.rsBtn.textContent = 'DEPLOY AGAIN';
  dom.rsBtn.onclick = () => {
    resetMatchMedals();
    clearChallenges();
    rollChallenges(3);
    resetMatch(gameState.mode);
    updateScoreboard();
    updateHUD();
    dom.roundSummary.classList.remove('on');
    setTimeout(() => gameState.renderer?.domElement?.requestPointerLock(), 100);
  };

  dom.roundSummary.classList.add('on');
}