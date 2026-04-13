import { TEAM_BLUE } from '@/config/constants';
import { dom } from './DOMElements';
import { gameState } from '@/core/GameState';

let _killStreak = 0;
let _streakTimer = 0;

const STREAK_LABELS = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'MULTI KILL', 'MEGA KILL', 'ULTRA KILL', 'RAMPAGE'];

/**
 * Show a kill notification banner on screen.
 */
export function showKillNotif(name: string, team: number): void {
  const col = team === TEAM_BLUE ? '#38bdf8' : '#ef4444';

  // Track rapid kills for streak messages
  const now = gameState.worldElapsed;
  if (now - _streakTimer < 4) {
    _killStreak++;
  } else {
    _killStreak = 1;
  }
  _streakTimer = now;

  const streakLabel = STREAK_LABELS[Math.min(_killStreak, STREAK_LABELS.length - 1)] || '';
  const streakHtml = streakLabel
    ? `<div style="color:#fbbf24;font-size:18px;text-shadow:0 0 8px #f59e0b;margin-top:4px">${streakLabel}!</div>`
    : '';

  dom.kn.innerHTML = `<span style="color:${col}">◆ ${name.toUpperCase()} ELIMINATED ◆</span>${streakHtml}`;
  dom.kn.style.opacity = '1';
  dom.kn.style.color = col;

  // Shake effect for multi-kills
  if (_killStreak >= 2) {
    dom.kn.style.transform = 'translateX(-50%) scale(1.2)';
    setTimeout(() => { dom.kn.style.transform = 'translateX(-50%) scale(1)'; }, 200);
  }

  setTimeout(() => { dom.kn.style.opacity = '0'; }, 2500);
}
