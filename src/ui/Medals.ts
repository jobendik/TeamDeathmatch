import { gameState } from '@/core/GameState';
import { announce } from './Announcer';
import { fireChallengeEvent } from './Challenges';
import { playMedalSound } from '@/audio/SoundHooks';
import type { TDMAgent } from '@/entities/TDMAgent';
import { WEAPONS } from '@/config/weapons';

export type MedalId =
  | 'first_blood' | 'headshot' | 'long_shot' | 'point_blank'
  | 'revenge' | 'clutch' | 'savior' | 'multi_kill'
  | 'triple_kill' | 'quad_kill' | 'ace' | 'knife_kill'
  | 'execution' | 'nade_kill' | 'rocket_kill' | 'collateral';

interface MedalDef {
  name: string;
  xp: number;
  color: string;
  tier: 'bronze' | 'silver' | 'gold' | 'epic';
  icon: string; // emoji fallback — swap for <img> when you have real assets
}

export const MEDALS: Record<MedalId, MedalDef> = {
  first_blood:  { name: 'FIRST BLOOD',  xp: 150, color: '#ef4444', tier: 'gold',   icon: '🩸' },
  headshot:     { name: 'HEADSHOT',     xp: 50,  color: '#ffcc33', tier: 'silver', icon: '🎯' },
  long_shot:    { name: 'LONG SHOT',    xp: 75,  color: '#60a5fa', tier: 'silver', icon: '🔭' },
  point_blank:  { name: 'POINT BLANK',  xp: 40,  color: '#f97316', tier: 'bronze', icon: '💥' },
  revenge:      { name: 'REVENGE',      xp: 60,  color: '#a855f7', tier: 'gold', icon: '⚔' },
  clutch:       { name: 'CLUTCH',       xp: 150, color: '#eab308', tier: 'epic',   icon: '💎' },
  savior:       { name: 'SAVIOR',       xp: 80,  color: '#22d66a', tier: 'silver', icon: '🛡' },
  multi_kill:   { name: 'DOUBLE KILL',  xp: 100, color: '#f59e0b', tier: 'silver', icon: '2×' },
  triple_kill:  { name: 'TRIPLE KILL',  xp: 200, color: '#f97316', tier: 'gold',   icon: '3×' },
  quad_kill:    { name: 'QUAD KILL',    xp: 350, color: '#dc2626', tier: 'epic',   icon: '4×' },
  ace:          { name: 'ACE',          xp: 500, color: '#eab308', tier: 'epic',   icon: '★'  },
  knife_kill:   { name: 'HUMILIATION',  xp: 100, color: '#94a3b8', tier: 'gold',   icon: '🔪' },
  execution:    { name: 'EXECUTION',    xp: 35,  color: '#64748b', tier: 'bronze', icon: '✖' },
  nade_kill:    { name: 'FRAG OUT',     xp: 60,  color: '#84cc16', tier: 'silver', icon: '🧨' },
  rocket_kill:  { name: 'DIRECT HIT',   xp: 75,  color: '#f97316', tier: 'silver', icon: '🚀' },
  collateral:   { name: 'COLLATERAL',   xp: 100, color: '#ec4899', tier: 'gold',   icon: '☍' },
};

interface MedalTickerItem {
  medal: MedalId;
  element: HTMLDivElement;
  life: number;
}

const tickerActive: MedalTickerItem[] = [];
let tickerEl: HTMLDivElement | null = null;

// Per-match state
export const matchState = {
  playerXP: 0,
  medalsEarned: [] as { medal: MedalId; at: number }[],
  firstBloodTaken: false,
  playerKillTimes: [] as number[],   // timestamps of player kills (for multi-kill detection)
  lastKilledBy: null as TDMAgent | null,
};

function ensureTicker(): HTMLDivElement {
  if (tickerEl) return tickerEl;
  tickerEl = document.createElement('div');
  tickerEl.id = 'medalTicker';
  document.body.appendChild(tickerEl);
  return tickerEl;
}

export function awardMedal(id: MedalId): void {
  const def = MEDALS[id];
  matchState.playerXP += def.xp;
  matchState.medalsEarned.push({ medal: id, at: gameState.worldElapsed });
  fireChallengeEvent({ type: 'medal', id });
  playMedalSound(def.tier);

  const ticker = ensureTicker();
  const item = document.createElement('div');
  item.className = `medal-item medal-${def.tier}`;
  item.style.borderColor = def.color;
  item.innerHTML = `
    <div class="medal-icon" style="color:${def.color}">${def.icon}</div>
    <div class="medal-meta">
      <div class="medal-name" style="color:${def.color}">${def.name}</div>
      <div class="medal-xp">+${def.xp} XP</div>
    </div>
  `;
  ticker.appendChild(item);

  // Tier-appropriate announcer
  if (def.tier === 'epic') {
    announce(def.name, { tier: 'large', color: def.color, sub: `+${def.xp} XP`, duration: 2.4 });
  } else if (def.tier === 'gold') {
    announce(def.name, { tier: 'medium', color: def.color, duration: 1.4 });
  }

  tickerActive.push({ medal: id, element: item, life: 3.5 });
}

export function updateMedalTicker(dt: number): void {
  for (let i = tickerActive.length - 1; i >= 0; i--) {
    const t = tickerActive[i];
    t.life -= dt;
    if (t.life <= 0) {
      t.element.classList.add('fade-out');
      setTimeout(() => t.element.remove(), 400);
      tickerActive.splice(i, 1);
    }
  }
}

/**
 * Main entry point — call this when the player gets a kill. Decides which
 * medals to award based on context.
 */
export function onPlayerKill(victim: TDMAgent, distance: number, weaponId: string, isHeadshot: boolean): void {
  const now = gameState.worldElapsed;
  matchState.playerKillTimes.push(now);

  // First blood (first kill of the match by anyone)
  const anyKillYet = gameState.killfeedEntries.length > 0;
  if (!matchState.firstBloodTaken && !anyKillYet) {
    matchState.firstBloodTaken = true;
    awardMedal('first_blood');
  }

  // Revenge — victim was our last killer within 30s
  if (matchState.lastKilledBy === victim && now - (gameState as any)._lastPlayerDeathTime < 30) {
    awardMedal('revenge');
    matchState.lastKilledBy = null;
  }

  // Weapon-specific
  if (weaponId === 'knife') awardMedal('knife_kill');
  else if (weaponId === 'rocket_launcher') awardMedal('rocket_kill');

  // Range
  if (isHeadshot) awardMedal('headshot');
  if (distance > 45) awardMedal('long_shot');
  else if (distance < 4 && weaponId !== 'knife') awardMedal('point_blank');

  // Multi-kill: 2+ kills in 4 seconds
  const recent = matchState.playerKillTimes.filter(t => now - t < 4);
  if (recent.length >= 5) awardMedal('ace');
  else if (recent.length === 4) awardMedal('quad_kill');
  else if (recent.length === 3) awardMedal('triple_kill');
  else if (recent.length === 2) awardMedal('multi_kill');

  // Base XP for the kill itself
  matchState.playerXP += 100;
}

export function onPlayerDeath(killer: TDMAgent | null): void {
  matchState.lastKilledBy = killer;
  (gameState as any)._lastPlayerDeathTime = gameState.worldElapsed;
}

export function resetMatchMedals(): void {
  matchState.playerXP = 0;
  matchState.medalsEarned.length = 0;
  matchState.firstBloodTaken = false;
  matchState.playerKillTimes.length = 0;
  matchState.lastKilledBy = null;
  if (tickerEl) tickerEl.innerHTML = '';
  tickerActive.length = 0;
}