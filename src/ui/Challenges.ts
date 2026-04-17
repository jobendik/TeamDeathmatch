import { gameState } from '@/core/GameState';
import { announce } from './Announcer';
import { matchState, MEDALS, type MedalId } from './Medals';

export interface ChallengeDef {
  id: string;
  label: string;
  target: number;
  xp: number;
  icon: string;
  test: (e: ChallengeEvent) => number; // returns increment (0 = no match)
}

export type ChallengeEvent =
  | { type: 'kill'; headshot: boolean; distance: number; weaponId: string }
  | { type: 'medal'; id: MedalId }
  | { type: 'flag_cap' }
  | { type: 'survive_low_hp'; hp: number };

const POOL: ChallengeDef[] = [
  { id: 'hs3',  label: 'Get 3 headshots',           target: 3,  xp: 250, icon: '🎯',
    test: e => e.type === 'kill' && e.headshot ? 1 : 0 },
  { id: 'ls2',  label: 'Score 2 long-range kills',  target: 2,  xp: 300, icon: '🔭',
    test: e => e.type === 'kill' && e.distance > 40 ? 1 : 0 },
  { id: 'k10',  label: 'Get 10 kills',              target: 10, xp: 300, icon: '💀',
    test: e => e.type === 'kill' ? 1 : 0 },
  { id: 'mk',   label: 'Earn a Multi-Kill',         target: 1,  xp: 250, icon: '💥',
    test: e => e.type === 'medal' && (e.id === 'multi_kill' || e.id === 'triple_kill' || e.id === 'quad_kill') ? 1 : 0 },
  { id: 'ar3',  label: 'Kill 3 with assault rifle', target: 3,  xp: 200, icon: '🔫',
    test: e => e.type === 'kill' && e.weaponId === 'assault_rifle' ? 1 : 0 },
  { id: 'low',  label: 'Get a kill under 20 HP',    target: 1,  xp: 350, icon: '⚡',
    test: e => e.type === 'kill' && gameState.pHP < 20 ? 1 : 0 },
  { id: 'fb',   label: 'Claim First Blood',         target: 1,  xp: 200, icon: '🩸',
    test: e => e.type === 'medal' && e.id === 'first_blood' ? 1 : 0 },
  { id: 'rv',   label: 'Get Revenge',               target: 1,  xp: 150, icon: '⚔',
    test: e => e.type === 'medal' && e.id === 'revenge' ? 1 : 0 },
];

interface ActiveChallenge extends ChallengeDef {
  progress: number;
  completed: boolean;
}

let active: ActiveChallenge[] = [];
let panelEl: HTMLDivElement | null = null;

function shuffle<T>(a: T[]): T[] {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function ensurePanel(): HTMLDivElement {
  if (panelEl) return panelEl;
  panelEl = document.createElement('div');
  panelEl.id = 'challengePanel';
  panelEl.innerHTML = `
    <div class="ch-header">◇ MATCH CHALLENGES</div>
    <div class="ch-list" id="chList"></div>
  `;
  document.body.appendChild(panelEl);
  return panelEl;
}

function render(): void {
  ensurePanel();
  const list = document.getElementById('chList')!;
  list.innerHTML = active.map(c => {
    const pct = Math.min(100, (c.progress / c.target) * 100);
    const done = c.completed ? 'done' : '';
    return `
      <div class="ch-item ${done}">
        <div class="ch-icon">${c.icon}</div>
        <div class="ch-body">
          <div class="ch-label">${c.label}</div>
          <div class="ch-bar"><div class="ch-bar-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="ch-progress">${Math.min(c.progress, c.target)}/${c.target}</div>
        <div class="ch-xp">+${c.xp}</div>
      </div>
    `;
  }).join('');
}

export function rollChallenges(count = 3): void {
  active = shuffle(POOL).slice(0, count).map(c => ({ ...c, progress: 0, completed: false }));
  render();
}

export function fireChallengeEvent(e: ChallengeEvent): void {
  let anyChange = false;
  for (const c of active) {
    if (c.completed) continue;
    const inc = c.test(e);
    if (inc <= 0) continue;
    c.progress += inc;
    anyChange = true;
    if (c.progress >= c.target) {
      c.completed = true;
      matchState.playerXP += c.xp;
      announce('CHALLENGE COMPLETE', {
        tier: 'medium',
        color: '#22d66a',
        sub: `${c.label} · +${c.xp} XP`,
        duration: 2.0,
      });
    }
  }
  if (anyChange) render();
}

export function getCompletedChallenges(): ActiveChallenge[] {
  return active.filter(c => c.completed);
}

export function clearChallenges(): void {
  active = [];
  if (panelEl) panelEl.remove();
  panelEl = null;
}