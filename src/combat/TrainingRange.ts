/**
 * TrainingRange — stat tracking and HUD for training mode.
 *
 * Active when gameState.mode === 'training'.
 * Called by:
 *   - EventManager.onShoot → recordShotFired()
 *   - Combat.dealDmgAgent  → onAgentHit(victim, isHeadshot)
 *   - GameLoop             → updateTrainingRange(dt)
 */

import { gameState } from '@/core/GameState';

// ─────────────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────────────

interface TrainingStats {
  shotsFired: number;
  hits: number;
  headshots: number;
  bodyHits: number;
  bestStreak: number;
  currentStreak: number;
  sessionStart: number;
}

const stats: TrainingStats = {
  shotsFired: 0,
  hits: 0,
  headshots: 0,
  bodyHits: 0,
  bestStreak: 0,
  currentStreak: 0,
  sessionStart: 0,
};

let hudEl: HTMLDivElement | null = null;
let hudUpdateThrottle = 0;

// ─────────────────────────────────────────────────────────────────────
//  API
// ─────────────────────────────────────────────────────────────────────

/** Returns true when the player is in the training range. */
export function isInTrainingRange(): boolean {
  return gameState.mode === 'training';
}

/** Call each time the player fires a shot. */
export function recordShotFired(): void {
  if (!isInTrainingRange()) return;
  stats.shotsFired++;
}

/**
 * Call when any agent takes damage (from Combat.dealDmgAgent).
 * Returns XP points awarded (0 if not in training, or not player-caused).
 */
export function onAgentHit(isHeadshot: boolean): number {
  if (!isInTrainingRange()) return 0;
  stats.hits++;
  if (isHeadshot) {
    stats.headshots++;
    stats.currentStreak++;
  } else {
    stats.bodyHits++;
    stats.currentStreak++;
  }
  if (stats.currentStreak > stats.bestStreak) stats.bestStreak = stats.currentStreak;
  return isHeadshot ? 25 : 10;
}

/** Called when a miss/death resets the streak. */
export function onMiss(): void {
  if (!isInTrainingRange()) return;
  stats.currentStreak = 0;
}

/** Called from GameLoop each frame when isInTrainingRange(). */
export function updateTrainingRange(dt: number): void {
  hudUpdateThrottle += dt;
  if (hudUpdateThrottle < 0.2) return;
  hudUpdateThrottle = 0;
  renderHUD();
}

// ─────────────────────────────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────────────────────────────

function ensureHUD(): HTMLDivElement {
  if (hudEl) return hudEl;

  hudEl = document.createElement('div');
  hudEl.id = 'trainingHUD';
  hudEl.innerHTML = `
    <div class="tr-title">TRAINING RANGE</div>
    <div class="tr-row"><span class="tr-lbl">SHOTS</span><span id="trShots" class="tr-val">0</span></div>
    <div class="tr-row"><span class="tr-lbl">HITS</span><span id="trHits" class="tr-val">0</span></div>
    <div class="tr-row"><span class="tr-lbl">ACCURACY</span><span id="trAcc" class="tr-val">—</span></div>
    <div class="tr-row"><span class="tr-lbl">HEADSHOTS</span><span id="trHS" class="tr-val">0</span></div>
    <div class="tr-row"><span class="tr-lbl">BEST STREAK</span><span id="trStreak" class="tr-val">0</span></div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #trainingHUD {
      position: fixed; top: 50%; right: 24px;
      transform: translateY(-50%);
      z-index: 30;
      background: rgba(5,12,22,0.82);
      border: 1px solid rgba(80,160,255,0.25);
      border-radius: 4px;
      padding: 14px 18px;
      font-family: 'Consolas','JetBrains Mono',monospace;
      color: #c4dcf5;
      font-size: 12px;
      min-width: 150px;
      pointer-events: none;
    }
    .tr-title {
      color: #4a9eff; font-weight: 700; letter-spacing: 0.12em;
      font-size: 10px; margin-bottom: 10px; text-transform: uppercase;
    }
    .tr-row { display: flex; justify-content: space-between; margin: 4px 0; gap: 16px; }
    .tr-lbl { color: #7a9abf; font-size: 11px; }
    .tr-val { color: #e0f0ff; font-weight: 700; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(hudEl);

  stats.sessionStart = performance.now();
  return hudEl;
}

function renderHUD(): void {
  const el = ensureHUD();
  const acc = stats.shotsFired > 0
    ? ((stats.hits / stats.shotsFired) * 100).toFixed(1) + '%'
    : '—';

  const shots  = el.querySelector('#trShots');
  const hits   = el.querySelector('#trHits');
  const acc_   = el.querySelector('#trAcc');
  const hs     = el.querySelector('#trHS');
  const streak = el.querySelector('#trStreak');

  if (shots)  shots.textContent  = String(stats.shotsFired);
  if (hits)   hits.textContent   = String(stats.hits);
  if (acc_)   acc_.textContent   = acc;
  if (hs)     hs.textContent     = String(stats.headshots);
  if (streak) streak.textContent = String(stats.bestStreak);

  // Visibility gating
  el.style.display = isInTrainingRange() ? 'block' : 'none';
}

/** Reset training stats (call on mode change). */
export function resetTrainingStats(): void {
  stats.shotsFired  = 0;
  stats.hits        = 0;
  stats.headshots   = 0;
  stats.bodyHits    = 0;
  stats.bestStreak  = 0;
  stats.currentStreak = 0;
  stats.sessionStart  = performance.now();
  if (hudEl) renderHUD();
}
