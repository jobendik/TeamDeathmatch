import { gameState } from '@/core/GameState';
import { dom } from '@/ui/DOMElements';
import { WEAPONS } from '@/config/weapons';

/**
 * Scorestreak reward system — grants tangible gameplay effects
 * when the player achieves kill streaks.
 *
 * Streak thresholds:
 *  3 kills = UAV Scan (reveal enemies on minimap for 8s)
 *  5 kills = Armor Boost (+25 bonus HP)
 *  7 kills = Rapid Fire (20% faster fire rate for 10s)
 */

// ── Active streak state ──
export interface StreakState {
  uavActive: boolean;
  uavExpiry: number;
  armorBoosted: boolean;
  rapidFireActive: boolean;
  rapidFireExpiry: number;
  rapidFireOrigRate: number;
}

const streak: StreakState = {
  uavActive: false,
  uavExpiry: 0,
  armorBoosted: false,
  rapidFireActive: false,
  rapidFireExpiry: 0,
  rapidFireOrigRate: 0,
};

/** Called when the player gets a kill — check if a streak threshold is reached */
export function checkStreakReward(killStreak: number): void {
  if (killStreak === 3) activateUAV();
  if (killStreak === 5) activateArmorBoost();
  if (killStreak === 7) activateRapidFire();
}

// ═══════════════════════════════════════════
//  UAV SCAN — reveal all enemies on minimap
// ═══════════════════════════════════════════
function activateUAV(): void {
  streak.uavActive = true;
  streak.uavExpiry = gameState.worldElapsed + 8;
  showStreakRewardNotif('📡', 'UAV SCAN', 'All enemies revealed for 8s');
}

export function isUAVActive(): boolean {
  return streak.uavActive && gameState.worldElapsed < streak.uavExpiry;
}

// ═══════════════════════════════════════════
//  ARMOR BOOST — +25 bonus HP
// ═══════════════════════════════════════════
function activateArmorBoost(): void {
  if (streak.armorBoosted) return; // only once per life
  streak.armorBoosted = true;
  gameState.pHP = Math.min(125, gameState.pHP + 25);
  gameState.player.hp = gameState.pHP;
  showStreakRewardNotif('🛡️', 'ARMOR BOOST', '+25 HP');
}

// ═══════════════════════════════════════════
//  RAPID FIRE — 20% faster fire rate
// ═══════════════════════════════════════════
function activateRapidFire(): void {
  if (streak.rapidFireActive) return; // don't stack
  const wep = WEAPONS[gameState.pWeaponId];
  streak.rapidFireOrigRate = wep.fireRate;
  streak.rapidFireActive = true;
  streak.rapidFireExpiry = gameState.worldElapsed + 10;
  showStreakRewardNotif('⚡', 'RAPID FIRE', '20% faster fire rate for 10s');
}

export function isRapidFireActive(): boolean {
  return streak.rapidFireActive && gameState.worldElapsed < streak.rapidFireExpiry;
}

/** Get the fire rate multiplier from active streaks */
export function getStreakFireRateMult(): number {
  if (isRapidFireActive()) return 0.8; // 20% faster
  return 1.0;
}

/** Update streak timers each frame */
export function updateStreaks(dt: number): void {
  // UAV expiry
  if (streak.uavActive && gameState.worldElapsed >= streak.uavExpiry) {
    streak.uavActive = false;
  }

  // Rapid fire expiry
  if (streak.rapidFireActive && gameState.worldElapsed >= streak.rapidFireExpiry) {
    streak.rapidFireActive = false;
  }

  // Update HUD indicator
  updateStreakHUD();
}

/** Clear all streak effects on death or match reset */
export function clearStreaks(): void {
  streak.uavActive = false;
  streak.uavExpiry = 0;
  streak.armorBoosted = false;
  streak.rapidFireActive = false;
  streak.rapidFireExpiry = 0;
  streak.rapidFireOrigRate = 0;

  // Remove HUD indicator
  const el = document.getElementById('streakIndicator');
  if (el) el.classList.remove('on');
}

// ── Streak reward notification ──
let _notifTimeout = 0;
function showStreakRewardNotif(icon: string, title: string, desc: string): void {
  let el = document.getElementById('streakReward');
  if (!el) {
    el = document.createElement('div');
    el.id = 'streakReward';
    el.style.cssText = `
      position: fixed; top: 18%; left: 50%; transform: translateX(-50%);
      background: linear-gradient(135deg, rgba(20,30,60,0.95), rgba(10,15,30,0.95));
      border: 1px solid rgba(74,168,255,0.5); border-radius: 8px;
      padding: 12px 28px; color: #fff; font-family: 'Inter','Segoe UI',sans-serif;
      text-align: center; z-index: 900; pointer-events: none;
      opacity: 0; transition: opacity 0.3s, transform 0.3s;
      box-shadow: 0 0 30px rgba(74,168,255,0.3);
    `;
    document.body.appendChild(el);
  }

  el.innerHTML = `
    <div style="font-size:28px;margin-bottom:4px">${icon}</div>
    <div style="font-size:16px;font-weight:700;letter-spacing:2px;color:#4aa8ff">${title}</div>
    <div style="font-size:12px;color:#8ab4f0;margin-top:2px">${desc}</div>
  `;
  el.style.opacity = '1';
  el.style.transform = 'translateX(-50%) translateY(0)';

  clearTimeout(_notifTimeout);
  _notifTimeout = window.setTimeout(() => {
    el!.style.opacity = '0';
    el!.style.transform = 'translateX(-50%) translateY(-10px)';
  }, 2500);
}

// ── HUD indicator for active effects ──
function updateStreakHUD(): void {
  let el = document.getElementById('streakIndicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'streakIndicator';
    el.style.cssText = `
      position: fixed; bottom: 120px; right: 20px;
      display: flex; flex-direction: column; gap: 6px;
      font-family: 'Inter','Segoe UI',sans-serif; font-size: 11px;
      color: #8ab4f0; z-index: 800; pointer-events: none;
    `;
    document.body.appendChild(el);
  }

  const items: string[] = [];
  if (isUAVActive()) {
    const remaining = Math.ceil(streak.uavExpiry - gameState.worldElapsed);
    items.push(`<div style="background:rgba(20,40,80,0.8);padding:4px 10px;border-radius:4px;border:1px solid rgba(74,168,255,0.4)">📡 UAV ${remaining}s</div>`);
  }
  if (isRapidFireActive()) {
    const remaining = Math.ceil(streak.rapidFireExpiry - gameState.worldElapsed);
    items.push(`<div style="background:rgba(20,40,80,0.8);padding:4px 10px;border-radius:4px;border:1px solid rgba(255,200,50,0.4)">⚡ RAPID ${remaining}s</div>`);
  }
  if (streak.armorBoosted && !gameState.pDead) {
    items.push(`<div style="background:rgba(20,40,80,0.8);padding:4px 10px;border-radius:4px;border:1px solid rgba(100,200,100,0.4)">🛡️ ARMOR</div>`);
  }

  el.innerHTML = items.join('');
}
