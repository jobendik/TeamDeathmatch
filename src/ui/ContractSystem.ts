/**
 * ContractSystem — persistent daily/weekly challenges with rewards.
 *
 * Contracts are the long-term goals that pull players back. Unlike the
 * per-match `Challenges` system, these persist across sessions via
 * PlayerProfile and reset on a schedule (daily or weekly).
 *
 * Contract types:
 *   - Counters: "Get 20 AR kills"
 *   - Milestones: "Reach weapon level 10 with the SMG"
 *   - Combo: "Win 3 matches with 20+ kills"
 *   - Milestone+: "Earn 5 different medal types in one match"
 *
 * Integration: Combat.ts fires events via `reportContractEvent()`.
 * RoundSummary awards XP + tracks match-end contracts.
 *
 * UI: HUD shows a collapsed contract widget. Main menu has a full browser
 * with claim-reward buttons.
 */

import { getProfile, profileMutate, awardAccountXP, type ContractProgress } from '@/core/PlayerProfile';
import type { WeaponId } from '@/config/weapons';
import type { GameMode } from '@/core/GameModes';

// ─────────────────────────────────────────────────────────────────────
//  CONTRACT DEFINITIONS
// ─────────────────────────────────────────────────────────────────────

export type ContractEventType =
  | 'kill'
  | 'headshot_kill'
  | 'long_range_kill'
  | 'point_blank_kill'
  | 'wallbang_kill'
  | 'weapon_kill'      // data: { weaponId }
  | 'mode_kill'        // data: { mode }
  | 'streak_reached'   // data: { streak }
  | 'match_end'        // data: { won, kills, deaths, accuracy, medalsEarned, mode }
  | 'revenge_kill'
  | 'finisher_kill'
  | 'melee_kill'
  | 'grenade_kill'
  | 'flag_capture'
  | 'revive'
  | 'survive_low_hp';

export interface ContractDef {
  id: string;
  title: string;
  description: string;
  type: 'daily' | 'weekly';
  target: number;
  xpReward: number;
  /** Returns increment amount when event matches, or 0. */
  matcher: (event: ContractEvent) => number;
  /** Optional tier for visual styling */
  tier?: 'common' | 'rare' | 'epic';
  /** Category icon */
  icon: string;
}

export interface ContractEvent {
  type: ContractEventType;
  data?: Record<string, any>;
}

// Daily contracts — 3 chosen each day
const DAILY_POOL: ContractDef[] = [
  {
    id: 'd_k25', title: 'Body Count', description: 'Get 25 kills in any mode',
    type: 'daily', target: 25, xpReward: 500, tier: 'common', icon: '💀',
    matcher: (e) => e.type === 'kill' ? 1 : 0,
  },
  {
    id: 'd_hs10', title: 'Headhunter', description: 'Score 10 headshot kills',
    type: 'daily', target: 10, xpReward: 750, tier: 'rare', icon: '🎯',
    matcher: (e) => e.type === 'headshot_kill' ? 1 : 0,
  },
  {
    id: 'd_lr5', title: 'Sharpshooter', description: 'Get 5 kills at 40m+',
    type: 'daily', target: 5, xpReward: 750, tier: 'rare', icon: '🔭',
    matcher: (e) => e.type === 'long_range_kill' ? 1 : 0,
  },
  {
    id: 'd_pb8', title: 'In Your Face', description: 'Get 8 point-blank kills',
    type: 'daily', target: 8, xpReward: 600, tier: 'common', icon: '💥',
    matcher: (e) => e.type === 'point_blank_kill' ? 1 : 0,
  },
  {
    id: 'd_ar15', title: 'Rifleman', description: 'Get 15 AR kills',
    type: 'daily', target: 15, xpReward: 500, tier: 'common', icon: '🔫',
    matcher: (e) => e.type === 'weapon_kill' && e.data?.weaponId === 'assault_rifle' ? 1 : 0,
  },
  {
    id: 'd_smg15', title: 'Bullet Storm', description: 'Get 15 SMG kills',
    type: 'daily', target: 15, xpReward: 500, tier: 'common', icon: '⚡',
    matcher: (e) => e.type === 'weapon_kill' && e.data?.weaponId === 'smg' ? 1 : 0,
  },
  {
    id: 'd_snp8', title: 'Ghost', description: 'Get 8 sniper kills',
    type: 'daily', target: 8, xpReward: 800, tier: 'rare', icon: '🔭',
    matcher: (e) => e.type === 'weapon_kill' && e.data?.weaponId === 'sniper_rifle' ? 1 : 0,
  },
  {
    id: 'd_sg10', title: 'Buckshot', description: 'Get 10 shotgun kills',
    type: 'daily', target: 10, xpReward: 650, tier: 'common', icon: '💢',
    matcher: (e) => e.type === 'weapon_kill' && e.data?.weaponId === 'shotgun' ? 1 : 0,
  },
  {
    id: 'd_streak5', title: 'Rampage', description: 'Reach a 5-kill streak',
    type: 'daily', target: 1, xpReward: 700, tier: 'rare', icon: '🔥',
    matcher: (e) => e.type === 'streak_reached' && (e.data?.streak ?? 0) >= 5 ? 1 : 0,
  },
  {
    id: 'd_win3', title: 'Victor', description: 'Win 3 matches',
    type: 'daily', target: 3, xpReward: 800, tier: 'rare', icon: '🏆',
    matcher: (e) => e.type === 'match_end' && e.data?.won === true ? 1 : 0,
  },
  {
    id: 'd_nade5', title: 'Cooked', description: 'Get 5 grenade kills',
    type: 'daily', target: 5, xpReward: 550, tier: 'common', icon: '🧨',
    matcher: (e) => e.type === 'grenade_kill' ? 1 : 0,
  },
  {
    id: 'd_rev3', title: 'Payback', description: 'Get 3 revenge kills',
    type: 'daily', target: 3, xpReward: 500, tier: 'common', icon: '⚔',
    matcher: (e) => e.type === 'revenge_kill' ? 1 : 0,
  },
  {
    id: 'd_knife3', title: 'Silent Blade', description: 'Get 3 melee kills',
    type: 'daily', target: 3, xpReward: 650, tier: 'rare', icon: '🔪',
    matcher: (e) => e.type === 'melee_kill' ? 1 : 0,
  },
];

// Weekly contracts — 3 chosen each Monday, bigger targets + rewards
const WEEKLY_POOL: ContractDef[] = [
  {
    id: 'w_k200', title: 'Legion', description: 'Get 200 kills this week',
    type: 'weekly', target: 200, xpReward: 3500, tier: 'epic', icon: '☠',
    matcher: (e) => e.type === 'kill' ? 1 : 0,
  },
  {
    id: 'w_hs75', title: 'Marksman Elite', description: 'Score 75 headshots this week',
    type: 'weekly', target: 75, xpReward: 4000, tier: 'epic', icon: '🎯',
    matcher: (e) => e.type === 'headshot_kill' ? 1 : 0,
  },
  {
    id: 'w_win15', title: 'Champion', description: 'Win 15 matches',
    type: 'weekly', target: 15, xpReward: 4500, tier: 'epic', icon: '🏆',
    matcher: (e) => e.type === 'match_end' && e.data?.won === true ? 1 : 0,
  },
  {
    id: 'w_multi20', title: 'Collateral', description: 'Reach 20 multi-kill medals',
    type: 'weekly', target: 20, xpReward: 3500, tier: 'epic', icon: '💥',
    matcher: (e) => e.type === 'streak_reached' && (e.data?.streak ?? 0) >= 2 ? 1 : 0,
  },
  {
    id: 'w_br_place', title: 'Battle Hardened', description: 'Place top 5 in BR 5 times',
    type: 'weekly', target: 5, xpReward: 3000, tier: 'rare', icon: '🪂',
    matcher: (e) => e.type === 'match_end' && e.data?.mode === 'br' && (e.data?.placement ?? 99) <= 5 ? 1 : 0,
  },
  {
    id: 'w_streak10', title: 'Unstoppable', description: 'Achieve a 10+ killstreak',
    type: 'weekly', target: 1, xpReward: 3500, tier: 'epic', icon: '🔥',
    matcher: (e) => e.type === 'streak_reached' && (e.data?.streak ?? 0) >= 10 ? 1 : 0,
  },
  {
    id: 'w_flag10', title: 'Flag Runner', description: 'Capture 10 flags',
    type: 'weekly', target: 10, xpReward: 3000, tier: 'rare', icon: '⚑',
    matcher: (e) => e.type === 'flag_capture' ? 1 : 0,
  },
];

// ─────────────────────────────────────────────────────────────────────
//  LIFECYCLE
// ─────────────────────────────────────────────────────────────────────

function pickRandom<T>(pool: T[], count: number, seed: number): T[] {
  // Deterministic daily selection: same day → same contracts
  const picks: T[] = [];
  const available = [...pool];
  let s = seed;
  while (picks.length < count && available.length > 0) {
    s = (s * 9301 + 49297) % 233280;
    const idx = Math.floor((s / 233280) * available.length);
    picks.push(available[idx]);
    available.splice(idx, 1);
  }
  return picks;
}

function daySeed(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function weekSeed(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return date.getFullYear() * 100 + Math.floor((days + start.getDay()) / 7);
}

/**
 * Ensures the profile has the correct contracts for today/this week.
 * Call on init and after daily rollover.
 */
export function refreshContracts(): void {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekKey = `${now.getFullYear()}-W${Math.floor(((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000) / 7)}`;

  profileMutate((p) => {
    // Daily — reset if day changed
    if (p.dailyContracts.issuedOn !== today) {
      const picks = pickRandom(DAILY_POOL, 3, daySeed(now));
      p.dailyContracts.issuedOn = today;
      p.dailyContracts.contracts = picks.map(c => ({
        id: c.id,
        progress: 0,
        target: c.target,
        claimed: false,
        acceptedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      }));
    }

    // Weekly — reset if week changed
    if (p.weeklyContracts.issuedOn !== weekKey) {
      const picks = pickRandom(WEEKLY_POOL, 3, weekSeed(now));
      p.weeklyContracts.issuedOn = weekKey;
      p.weeklyContracts.contracts = picks.map(c => ({
        id: c.id,
        progress: 0,
        target: c.target,
        claimed: false,
        acceptedAt: Date.now(),
        expiresAt: Date.now() + 7 * 86400000,
      }));
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
//  EVENT HANDLING
// ─────────────────────────────────────────────────────────────────────

type CompletionCallback = (def: ContractDef) => void;
const completionCallbacks: CompletionCallback[] = [];

export function onContractCompleted(cb: CompletionCallback): () => void {
  completionCallbacks.push(cb);
  return () => {
    const i = completionCallbacks.indexOf(cb);
    if (i >= 0) completionCallbacks.splice(i, 1);
  };
}

function findDef(id: string): ContractDef | null {
  return DAILY_POOL.find(c => c.id === id)
      ?? WEEKLY_POOL.find(c => c.id === id)
      ?? null;
}

/**
 * Report a gameplay event. Scans active contracts, increments progress,
 * fires callbacks on completion. THIS IS THE MAIN INTEGRATION POINT.
 */
export function reportContractEvent(event: ContractEvent): void {
  profileMutate((p) => {
    const allActive = [...p.dailyContracts.contracts, ...p.weeklyContracts.contracts];
    for (const progress of allActive) {
      if (progress.progress >= progress.target) continue; // already done
      const def = findDef(progress.id);
      if (!def) continue;
      const inc = def.matcher(event);
      if (inc <= 0) continue;

      progress.progress = Math.min(progress.target, progress.progress + inc);

      // On completion, fire callbacks (UI announce)
      if (progress.progress >= progress.target) {
        for (const cb of completionCallbacks) cb(def);
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
//  CLAIM / QUERY
// ─────────────────────────────────────────────────────────────────────

export interface ContractView {
  def: ContractDef;
  progress: ContractProgress;
  claimable: boolean;
}

export function getContracts(type: 'daily' | 'weekly'): ContractView[] {
  const p = getProfile();
  const list = type === 'daily' ? p.dailyContracts.contracts : p.weeklyContracts.contracts;
  return list
    .map(pr => {
      const def = findDef(pr.id);
      if (!def) return null;
      return {
        def,
        progress: pr,
        claimable: pr.progress >= pr.target && !pr.claimed,
      } as ContractView;
    })
    .filter((v): v is ContractView => v !== null);
}

export function claimContract(id: string): number {
  let awarded = 0;
  profileMutate((p) => {
    for (const list of [p.dailyContracts.contracts, p.weeklyContracts.contracts]) {
      for (const progress of list) {
        if (progress.id !== id) continue;
        if (progress.claimed || progress.progress < progress.target) return;
        const def = findDef(id);
        if (!def) return;
        progress.claimed = true;
        awarded = def.xpReward;
      }
    }
  });
  if (awarded > 0) {
    awardAccountXP(awarded, 'contract');
  }
  return awarded;
}

/** Auto-claim all completed contracts. Returns total XP awarded. */
export function claimAllCompleted(): number {
  let total = 0;
  for (const type of ['daily', 'weekly'] as const) {
    for (const view of getContracts(type)) {
      if (view.claimable) {
        total += claimContract(view.def.id);
      }
    }
  }
  return total;
}

export function getActiveContractCount(): { daily: number; weekly: number; claimable: number } {
  const d = getContracts('daily');
  const w = getContracts('weekly');
  const claimable = d.filter(c => c.claimable).length + w.filter(c => c.claimable).length;
  return {
    daily: d.filter(c => !c.progress.claimed).length,
    weekly: w.filter(c => !c.progress.claimed).length,
    claimable,
  };
}

// ─────────────────────────────────────────────────────────────────────
//  HUD WIDGET (compact on-screen tracker)
// ─────────────────────────────────────────────────────────────────────

let hudEl: HTMLDivElement | null = null;
let hudExpanded = false;
let renderCachedJson = '';

function ensureHud(): HTMLDivElement {
  if (hudEl) return hudEl;
  hudEl = document.createElement('div');
  hudEl.id = 'contractHud';
  hudEl.innerHTML = `
    <div class="ch-head" id="chHead">
      <span class="ch-ico">◈</span>
      <span class="ch-title">CONTRACTS</span>
      <span class="ch-bell" id="chBell"></span>
    </div>
    <div class="ch-body" id="chBody"></div>
  `;
  document.body.appendChild(hudEl);

  // Toggle expand on click
  const head = hudEl.querySelector('#chHead') as HTMLElement;
  head.addEventListener('click', () => {
    hudExpanded = !hudExpanded;
    hudEl!.classList.toggle('expanded', hudExpanded);
  });

  injectContractStyles();
  return hudEl;
}

function injectContractStyles(): void {
  if (document.getElementById('contractHudStyle')) return;
  const s = document.createElement('style');
  s.id = 'contractHudStyle';
  s.textContent = `
    #contractHud {
      position: fixed; top: 110px; right: 16px;
      z-index: 10; pointer-events: auto;
      width: 240px;
      background: linear-gradient(145deg, rgba(12,18,30,0.92), rgba(8,12,22,0.95));
      border: 1px solid rgba(255, 204, 68, 0.35);
      border-radius: 3px;
      font-family: 'JetBrains Mono', 'Consolas', monospace;
      color: #e8f0ff;
      box-shadow: 0 4px 18px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05);
      transition: box-shadow 0.2s;
    }
    #contractHud:hover {
      box-shadow: 0 4px 24px rgba(255,204,68,0.25), inset 0 1px 0 rgba(255,255,255,0.08);
    }
    .ch-head {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 10px;
      cursor: pointer;
      border-bottom: 1px solid rgba(255,204,68,0.15);
      user-select: none;
    }
    .ch-ico { color: #ffcc44; font-size: 14px; }
    .ch-title {
      flex: 1;
      font-size: 10px; font-weight: 700; letter-spacing: 0.22em;
      color: #ffcc44;
    }
    .ch-bell {
      font-size: 10px; font-weight: 700; color: #22d66a;
    }
    .ch-bell.has-claim::before {
      content: '● CLAIM';
      animation: chPulse 1.3s ease-in-out infinite;
    }
    @keyframes chPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .ch-body {
      padding: 8px 10px;
      max-height: 90px;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }
    #contractHud.expanded .ch-body {
      max-height: 400px;
    }
    .ch-item {
      display: flex; align-items: center; gap: 8px;
      padding: 5px 0;
      font-size: 10px;
      border-bottom: 1px dashed rgba(255,255,255,0.08);
    }
    .ch-item:last-child { border-bottom: none; }
    .ch-item-icon { font-size: 14px; flex-shrink: 0; }
    .ch-item-body { flex: 1; min-width: 0; }
    .ch-item-title {
      font-weight: 700; color: #e8f0ff; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }
    .ch-item-bar {
      height: 2px; background: rgba(255,255,255,0.1);
      margin-top: 3px; border-radius: 1px; overflow: hidden;
    }
    .ch-item-bar-fill {
      height: 100%; background: linear-gradient(90deg, #ff8833, #ffcc44);
      transition: width 0.4s ease-out;
    }
    .ch-item.done .ch-item-bar-fill { background: linear-gradient(90deg, #22d66a, #5fe891); }
    .ch-item-prog {
      font-size: 9px; color: #8ab4f0;
      margin-left: auto; white-space: nowrap;
    }
    .ch-item.done .ch-item-prog { color: #22d66a; font-weight: 700; }
    .ch-item.claimable { background: rgba(34,214,106,0.08); }
    .ch-item.claimable .ch-item-title { color: #22d66a; }
  `;
  document.head.appendChild(s);
}

export function updateContractHud(): void {
  const el = ensureHud();
  const daily = getContracts('daily');
  const weekly = getContracts('weekly');
  const all = [...daily, ...weekly];

  // Cache check to avoid DOM churn
  const cacheKey = JSON.stringify(all.map(v => ({
    id: v.def.id, p: v.progress.progress, c: v.progress.claimed,
  })));
  if (cacheKey === renderCachedJson) return;
  renderCachedJson = cacheKey;

  const body = el.querySelector('#chBody') as HTMLElement;
  const bell = el.querySelector('#chBell') as HTMLElement;

  const claimableCount = all.filter(v => v.claimable).length;
  bell.classList.toggle('has-claim', claimableCount > 0);

  body.innerHTML = all.slice(0, 6).map(v => {
    const pct = Math.min(100, (v.progress.progress / v.progress.target) * 100);
    const done = v.progress.progress >= v.progress.target;
    const cls = v.claimable ? 'claimable' : done ? 'done' : '';
    return `
      <div class="ch-item ${cls}">
        <div class="ch-item-icon">${v.def.icon}</div>
        <div class="ch-item-body">
          <div class="ch-item-title">${v.def.title}</div>
          <div class="ch-item-bar"><div class="ch-item-bar-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="ch-item-prog">${v.progress.progress}/${v.progress.target}</div>
      </div>
    `;
  }).join('');
}

export function initContracts(): void {
  refreshContracts();

  // On completion, announce it
  onContractCompleted((def) => {
    import('@/ui/Announcer').then(a => {
      a.announce('CONTRACT COMPLETE', {
        sub: `${def.title} · +${def.xpReward} XP`,
        tier: 'medium',
        color: '#ffcc44',
        duration: 2.5,
      });
    }).catch(() => { /* ignore */ });
  });

  // Periodic refresh (catches day rollover during long sessions)
  setInterval(refreshContracts, 60_000);
}