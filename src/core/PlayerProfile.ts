/**
 * PlayerProfile — persistent career data stored in localStorage.
 *
 * This is the SPINE of every meta-system: XP, level, unlocks, challenges,
 * weapon mastery, cosmetics, tracked stats. All other progression systems
 * read/write through this one authority.
 *
 * Design rules:
 *   - Single localStorage key: 'warzone_profile_v1' (versioned for migration)
 *   - All mutations go through `profileMutate()` which auto-saves
 *   - Subscribers get notified on change for reactive UI updates
 *   - Schema is flat and serializable — no classes, no cycles
 *
 * Versioning: bump PROFILE_VERSION when shape changes; migrate() handles
 * upgrades from old saves instead of wiping them.
 */

import type { WeaponId } from '@/config/weapons';
import type { GameMode } from '@/core/GameModes';

export const PROFILE_VERSION = 1;
const STORAGE_KEY = 'warzone_profile_v1';

// ─────────────────────────────────────────────────────────────────────
//  SCHEMA
// ─────────────────────────────────────────────────────────────────────

export interface WeaponStats {
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  xp: number;              // weapon-specific XP (unlocks attachments)
  level: number;           // weapon mastery level (0..30)
  longestKill: number;     // meters
}

export interface ModeStats {
  matchesPlayed: number;
  wins: number;
  losses: number;
  timePlayed: number;      // seconds
  kills: number;
  deaths: number;
}

export interface CareerAccolades {
  totalKills: number;
  totalDeaths: number;
  totalHeadshots: number;
  totalMatches: number;
  totalWins: number;
  totalMedals: number;
  totalDamageDealt: number;
  longestKillStreak: number;
  longestKillDistance: number;
  totalTimePlayed: number;        // seconds
  bestKDM: number;                // kills per match, rolling best
  brWins: number;
  brTop5: number;
  brTop10: number;
  finishers: number;
}

export interface UnlockedCosmetics {
  operators: string[];            // operator IDs
  weaponCamos: Record<WeaponId, string[]>;
  killEmblems: string[];          // kill feed badges
  charms: string[];               // weapon charms
  stickers: string[];
  emotes: string[];
  sprays: string[];
  intros: string[];               // match intro variants
  finishers: string[];            // execution animation IDs
}

export interface EquippedCosmetics {
  operator: string;
  killEmblem: string;
  weaponCamos: Partial<Record<WeaponId, string>>;
  weaponCharms: Partial<Record<WeaponId, string>>;
  activeEmotes: [string, string, string, string];  // 4 emote wheel slots
  activeSprays: [string, string, string];
  activeFinisher: string;
  activeIntro: string;
}

export interface ContractProgress {
  id: string;
  progress: number;
  target: number;
  claimed: boolean;
  acceptedAt: number;
  expiresAt: number;
}

export interface ContractSlot {
  issuedOn: string;
  contracts: ContractProgress[];
}

export interface Profile {
  version: number;
  createdAt: number;
  lastPlayedAt: number;

  // Identity
  playerName: string;
  playerTag: string;              // #1234

  // Core progression
  level: number;
  xp: number;
  prestige: number;
  unspentTokens: number;          // earned at each prestige
  accountXPBoost: number;         // multiplier from prestige perks

  // Stats
  career: CareerAccolades;
  byMode: Record<GameMode, ModeStats>;
  byWeapon: Record<WeaponId, WeaponStats>;

  // Meta systems
  unlocks: UnlockedCosmetics;
  equipped: EquippedCosmetics;

  // Persistent challenges (vs. match-only challenges in Challenges.ts)
  dailyContracts: ContractSlot;
  weeklyContracts: ContractSlot;
  seasonalPassLevel: number;
  seasonalPassXP: number;

  // Loadouts
  activeLoadoutIndex: number;

  // Settings the profile remembers (separate from Settings.ts which stores
  // ephemeral graphics/audio prefs)
  seenTutorial: boolean;
  seenNewOperatorPopup: string[];

  // Misc
  loginStreak: number;
  lastLoginDate: string;          // YYYY-MM-DD
}

// ─────────────────────────────────────────────────────────────────────
//  DEFAULTS
// ─────────────────────────────────────────────────────────────────────

function emptyWeaponStats(): WeaponStats {
  return { kills: 0, headshots: 0, shotsFired: 0, shotsHit: 0, xp: 0, level: 0, longestKill: 0 };
}

function emptyModeStats(): ModeStats {
  return { matchesPlayed: 0, wins: 0, losses: 0, timePlayed: 0, kills: 0, deaths: 0 };
}

function defaultProfile(): Profile {
  const now = Date.now();
  const names = ['GHOST', 'VIPER', 'REAPER', 'NOVA', 'HAVOC', 'PHOENIX', 'WRAITH', 'STORM'];
  const randomName = names[Math.floor(Math.random() * names.length)];
  return {
    version: PROFILE_VERSION,
    createdAt: now,
    lastPlayedAt: now,
    playerName: randomName,
    playerTag: String(Math.floor(1000 + Math.random() * 9000)),
    level: 1,
    xp: 0,
    prestige: 0,
    unspentTokens: 0,
    accountXPBoost: 1,
    career: {
      totalKills: 0, totalDeaths: 0, totalHeadshots: 0, totalMatches: 0,
      totalWins: 0, totalMedals: 0, totalDamageDealt: 0,
      longestKillStreak: 0, longestKillDistance: 0, totalTimePlayed: 0,
      bestKDM: 0, brWins: 0, brTop5: 0, brTop10: 0, finishers: 0,
    },
    byMode: {
      tdm: emptyModeStats(), ffa: emptyModeStats(), ctf: emptyModeStats(),
      elimination: emptyModeStats(), br: emptyModeStats(),
      domination: emptyModeStats(), hardpoint: emptyModeStats(),
      koth: emptyModeStats(), sd: emptyModeStats(), training: emptyModeStats(),
    },
    byWeapon: {
      unarmed: emptyWeaponStats(), knife: emptyWeaponStats(),
      pistol: emptyWeaponStats(), smg: emptyWeaponStats(),
      assault_rifle: emptyWeaponStats(), shotgun: emptyWeaponStats(),
      sniper_rifle: emptyWeaponStats(), rocket_launcher: emptyWeaponStats(),
    },
    unlocks: {
      operators: ['default_blue', 'default_red'],
      weaponCamos: {
        unarmed: [], knife: ['default'], pistol: ['default'],
        smg: ['default'], assault_rifle: ['default'], shotgun: ['default'],
        sniper_rifle: ['default'], rocket_launcher: ['default'],
      },
      killEmblems: ['classic'],
      charms: [],
      stickers: [],
      emotes: ['wave', 'thumbs_up', 'crouch_dance', 'salute'],
      sprays: ['circle', 'triangle', 'x_mark'],
      intros: ['default'],
      finishers: ['default'],
    },
    equipped: {
      operator: 'default_blue',
      killEmblem: 'classic',
      weaponCamos: {},
      weaponCharms: {},
      activeEmotes: ['wave', 'thumbs_up', 'crouch_dance', 'salute'],
      activeSprays: ['circle', 'triangle', 'x_mark'],
      activeFinisher: 'default',
      activeIntro: 'default',
    },
    dailyContracts: { issuedOn: '', contracts: [] },
    weeklyContracts: { issuedOn: '', contracts: [] },
    seasonalPassLevel: 1,
    seasonalPassXP: 0,
    activeLoadoutIndex: 0,
    seenTutorial: false,
    seenNewOperatorPopup: [],
    loginStreak: 1,
    lastLoginDate: new Date().toISOString().slice(0, 10),
  };
}

// ─────────────────────────────────────────────────────────────────────
//  STATE & SUBSCRIBERS
// ─────────────────────────────────────────────────────────────────────

let _profile: Profile | null = null;
const _subscribers = new Set<(p: Profile) => void>();

function load(): Profile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Profile;
      return migrate(parsed);
    }
  } catch (e) {
    console.warn('[PlayerProfile] Failed to load; starting fresh.', e);
  }
  return defaultProfile();
}

function migrate(p: Profile): Profile {
  // Always deep-merge with defaults so new fields added later don't crash old saves
  const d = defaultProfile();
  const merged: Profile = {
    ...d,
    ...p,
    career: { ...d.career, ...p.career },
    byMode: { ...d.byMode, ...p.byMode },
    byWeapon: { ...d.byWeapon, ...p.byWeapon },
    unlocks: {
      ...d.unlocks, ...p.unlocks,
      weaponCamos: { ...d.unlocks.weaponCamos, ...p.unlocks?.weaponCamos },
    },
    equipped: { ...d.equipped, ...p.equipped },
  };
  merged.version = PROFILE_VERSION;
  return merged;
}

function save(): void {
  if (!_profile) return;
  try {
    _profile.lastPlayedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_profile));
  } catch (e) {
    console.warn('[PlayerProfile] Save failed:', e);
  }
}

function notify(): void {
  if (!_profile) return;
  for (const cb of _subscribers) {
    try { cb(_profile); } catch (e) { console.error('[PlayerProfile] sub error', e); }
  }
}

// ─────────────────────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────────────────────

/** Initialize — call ONCE at startup before any other profile access. */
export function initPlayerProfile(): Profile {
  if (_profile) return _profile;
  _profile = load();
  checkDailyRollover();
  return _profile;
}

export function getProfile(): Profile {
  if (!_profile) return initPlayerProfile();
  return _profile;
}

/**
 * Apply a mutation. The callback receives the live profile object and can
 * modify it in place. Save + notify happen automatically after.
 */
export function profileMutate(fn: (p: Profile) => void): void {
  const p = getProfile();
  fn(p);
  save();
  notify();
}

export function subscribeProfile(cb: (p: Profile) => void): () => void {
  _subscribers.add(cb);
  if (_profile) cb(_profile);
  return () => _subscribers.delete(cb);
}

/** Reset profile — used for "New Game" option. Asks for confirmation in UI layer. */
export function resetProfile(): void {
  _profile = defaultProfile();
  save();
  notify();
}

// ─────────────────────────────────────────────────────────────────────
//  XP / LEVEL LOGIC
// ─────────────────────────────────────────────────────────────────────

/** XP required to go from `level` to `level+1`. Grows linearly + step at milestones. */
export function xpForLevel(level: number): number {
  // base 1000, +250 per 5 levels, +1000 at prestige-relevant milestones
  const tier = Math.floor(level / 5);
  return 1000 + tier * 250 + (level % 10 === 0 ? 1000 : 0);
}

export function totalXpForLevel(targetLevel: number): number {
  let total = 0;
  for (let l = 1; l < targetLevel; l++) total += xpForLevel(l);
  return total;
}

export const MAX_LEVEL = 55;

export interface XPResult {
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  tokensEarned: number;
  prestigeAvailable: boolean;
}

export function awardAccountXP(amount: number, reason = ''): XPResult {
  const p = getProfile();
  const oldLevel = p.level;
  const boosted = Math.round(amount * p.accountXPBoost);

  profileMutate(pp => {
    pp.xp += boosted;
    let leveled = false;
    while (pp.level < MAX_LEVEL && pp.xp >= xpForLevel(pp.level)) {
      pp.xp -= xpForLevel(pp.level);
      pp.level++;
      leveled = true;
      // Reward: every 5 levels grants a token
      if (pp.level % 5 === 0) pp.unspentTokens++;
    }
    if (leveled && reason) console.info(`[XP] +${boosted} ${reason} → level ${pp.level}`);
  });

  const prestigeAvailable = p.level >= MAX_LEVEL;
  return {
    leveledUp: p.level !== oldLevel,
    oldLevel,
    newLevel: p.level,
    tokensEarned: Math.floor((p.level - oldLevel) / 5),
    prestigeAvailable,
  };
}

export function prestige(): boolean {
  const p = getProfile();
  if (p.level < MAX_LEVEL) return false;
  profileMutate(pp => {
    pp.prestige++;
    pp.level = 1;
    pp.xp = 0;
    pp.unspentTokens += 5;
    pp.accountXPBoost = Math.min(2.0, pp.accountXPBoost + 0.05);
  });
  return true;
}

// ─────────────────────────────────────────────────────────────────────
//  WEAPON XP / MASTERY
// ─────────────────────────────────────────────────────────────────────

const WEAPON_MAX_LEVEL = 30;

export function xpForWeaponLevel(level: number): number {
  return 300 + level * 50;
}

export function awardWeaponXP(weaponId: WeaponId, amount: number): boolean {
  const p = getProfile();
  const ws = p.byWeapon[weaponId];
  const oldLevel = ws.level;
  profileMutate(pp => {
    const w = pp.byWeapon[weaponId];
    w.xp += amount;
    while (w.level < WEAPON_MAX_LEVEL && w.xp >= xpForWeaponLevel(w.level)) {
      w.xp -= xpForWeaponLevel(w.level);
      w.level++;
    }
  });
  return p.byWeapon[weaponId].level > oldLevel;
}

export function getWeaponLevel(weaponId: WeaponId): number {
  return getProfile().byWeapon[weaponId].level;
}

// ─────────────────────────────────────────────────────────────────────
//  CAREER / STAT RECORDING
// ─────────────────────────────────────────────────────────────────────

export interface MatchResult {
  mode: GameMode;
  won: boolean;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  longestStreak: number;
  longestKill: number;
  timePlayed: number;        // seconds
  medalsEarned: number;
  weaponUsage: Partial<Record<WeaponId, { kills: number; headshots: number; shotsFired: number; shotsHit: number; longestKill: number }>>;
  brPlacement?: number;      // 1 = winner, 2 = runner-up, ...
}

export function recordMatchResult(r: MatchResult): void {
  profileMutate(p => {
    // Career
    p.career.totalKills += r.kills;
    p.career.totalDeaths += r.deaths;
    p.career.totalHeadshots += r.headshots;
    p.career.totalMatches++;
    if (r.won) p.career.totalWins++;
    p.career.totalMedals += r.medalsEarned;
    p.career.totalDamageDealt += r.damageDealt;
    p.career.longestKillStreak = Math.max(p.career.longestKillStreak, r.longestStreak);
    p.career.longestKillDistance = Math.max(p.career.longestKillDistance, r.longestKill);
    p.career.totalTimePlayed += r.timePlayed;
    if (r.kills > p.career.bestKDM) p.career.bestKDM = r.kills;

    if (r.mode === 'br' && r.brPlacement != null) {
      if (r.brPlacement === 1) p.career.brWins++;
      if (r.brPlacement <= 5) p.career.brTop5++;
      if (r.brPlacement <= 10) p.career.brTop10++;
    }

    // By mode
    const ms = p.byMode[r.mode];
    ms.matchesPlayed++;
    if (r.won) ms.wins++; else ms.losses++;
    ms.timePlayed += r.timePlayed;
    ms.kills += r.kills;
    ms.deaths += r.deaths;

    // By weapon
    for (const [wid, usage] of Object.entries(r.weaponUsage)) {
      const w = p.byWeapon[wid as WeaponId];
      if (!w || !usage) continue;
      w.kills += usage.kills;
      w.headshots += usage.headshots;
      w.shotsFired += usage.shotsFired;
      w.shotsHit += usage.shotsHit;
      w.longestKill = Math.max(w.longestKill, usage.longestKill);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
//  DAILY ROLLOVER
// ─────────────────────────────────────────────────────────────────────

function checkDailyRollover(): void {
  const today = new Date().toISOString().slice(0, 10);
  profileMutate(p => {
    if (p.lastLoginDate !== today) {
      // Streak logic: consecutive days increments; skip days reset to 1
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      p.loginStreak = (p.lastLoginDate === yesterday) ? p.loginStreak + 1 : 1;
      p.lastLoginDate = today;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
//  CONVENIENCE
// ─────────────────────────────────────────────────────────────────────

export function getXpProgress(): { current: number; needed: number; pct: number } {
  const p = getProfile();
  const needed = xpForLevel(p.level);
  return { current: p.xp, needed, pct: Math.min(100, (p.xp / needed) * 100) };
}

export function getOverallKD(): number {
  const c = getProfile().career;
  return c.totalDeaths > 0 ? c.totalKills / c.totalDeaths : c.totalKills;
}

export function getWinRate(): number {
  const c = getProfile().career;
  return c.totalMatches > 0 ? c.totalWins / c.totalMatches : 0;
}

export function getAccuracy(): number {
  const stats = getProfile().byWeapon;
  let fired = 0, hit = 0;
  for (const w of Object.values(stats)) { fired += w.shotsFired; hit += w.shotsHit; }
  return fired > 0 ? hit / fired : 0;
}