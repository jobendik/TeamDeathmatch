/**
 * Loadouts.ts — Modern FPS loadout system.
 *
 * A loadout = { primary, secondary, tactical grenade, lethal grenade,
 *               3 perks, field upgrade }
 *
 * The player has 5 custom loadout slots + 3 preset "recommended" loadouts.
 * In TDM/FFA/Elimination modes, the active loadout is applied at spawn.
 * In BR, loadouts determine starting inventory ONLY for the optional
 * "Loadout Drop" supply crate rare reward.
 *
 * Perks are implemented as a registry — each perk has a `hooks` object that
 * gameplay systems query. Perks are passive (always on while alive) except
 * where noted. Fields upgrades are one-shot abilities on cooldown.
 */

import type { WeaponId } from '@/config/weapons';
import { profileMutate, getProfile } from '@/core/PlayerProfile';

// ═══════════════════════════════════════════
//  PERK SYSTEM
// ═══════════════════════════════════════════

export type PerkSlot = 1 | 2 | 3;

export interface PerkHooks {
  /** HP regen rate multiplier */
  healthRegenMul?: number;
  /** Movement speed multiplier */
  moveSpeedMul?: number;
  /** Sprint-to-fire delay multiplier (lower = faster) */
  sprintToFireMul?: number;
  /** ADS speed multiplier (higher = faster ADS) */
  adsSpeedMul?: number;
  /** Reload speed multiplier (lower = faster) */
  reloadMul?: number;
  /** Incoming explosion damage multiplier */
  explosionResistMul?: number;
  /** Incoming bullet damage multiplier */
  damageResistMul?: number;
  /** Jump height multiplier */
  jumpHeightMul?: number;
  /** Fall damage multiplier */
  fallDamageMul?: number;
  /** Minimum time before bot UAV reveals you (seconds, 0 = revealed instantly) */
  uavResistSeconds?: number;
  /** Show enemy dots on minimap when they shoot */
  showEnemyShotDots?: boolean;
  /** Silent movement — bots can't hear footsteps */
  silentFootsteps?: boolean;
  /** Deal bonus damage vs. low-HP enemies */
  finisherBonusDmg?: number;
  /** Starts each life with extra mag */
  startExtraMag?: boolean;
  /** Starts each life with extra grenade */
  startExtraGrenade?: boolean;
  /** Hold breath while ADS (sniper steadier) */
  steadyAim?: boolean;
  /** Immune to flashbang */
  flashImmune?: boolean;
  /** Shows direction of damage on HUD even when hit from far */
  extraDamageArcs?: boolean;
}

export interface PerkDef {
  id: string;
  slot: PerkSlot;
  name: string;
  desc: string;
  icon: string;
  unlockLevel: number;
  hooks: PerkHooks;
}

export const PERKS: PerkDef[] = [
  // ── SLOT 1 (defensive / survival) ──
  { id: 'flak_jacket', slot: 1, name: 'Flak Jacket', desc: 'Reduce explosion damage by 50%.',
    icon: '🛡', unlockLevel: 1, hooks: { explosionResistMul: 0.5 } },
  { id: 'scavenger', slot: 1, name: 'Scavenger', desc: 'Resupply ammo from kills.',
    icon: '🎒', unlockLevel: 4, hooks: { startExtraMag: true } },
  { id: 'ghost', slot: 1, name: 'Ghost', desc: 'Undetectable by enemy UAV when moving.',
    icon: '👤', unlockLevel: 12, hooks: { uavResistSeconds: 999, silentFootsteps: true } },
  { id: 'lightweight', slot: 1, name: 'Lightweight', desc: '+8% movement speed, 50% less fall damage.',
    icon: '💨', unlockLevel: 7, hooks: { moveSpeedMul: 1.08, fallDamageMul: 0.5 } },
  { id: 'double_time', slot: 1, name: 'Double Time', desc: 'Tactical sprint duration doubled.',
    icon: '⏱', unlockLevel: 19, hooks: { moveSpeedMul: 1.04 } },

  // ── SLOT 2 (combat-focused) ──
  { id: 'quickdraw', slot: 2, name: 'Quickdraw', desc: '40% faster weapon swap and ADS.',
    icon: '⚡', unlockLevel: 1, hooks: { adsSpeedMul: 1.4 } },
  { id: 'hardline', slot: 2, name: 'Hardline', desc: 'Kills grant 25% bonus XP.',
    icon: '💎', unlockLevel: 5, hooks: {} }, // applied in ScoreKill
  { id: 'cold_blooded', slot: 2, name: 'Cold-Blooded', desc: 'Undetectable by AI targeting systems.',
    icon: '❄', unlockLevel: 14, hooks: {} }, // applied in Perception
  { id: 'battle_hardened', slot: 2, name: 'Battle Hardened', desc: 'Immune to flashbang.',
    icon: '🛡', unlockLevel: 20, hooks: { flashImmune: true } },
  { id: 'pointman', slot: 2, name: 'Pointman', desc: 'Earn challenges while playing objectives.',
    icon: '🎯', unlockLevel: 24, hooks: {} },

  // ── SLOT 3 (utility) ──
  { id: 'tracker', slot: 3, name: 'Tracker', desc: 'Enemy footsteps leave visual trails for 2s.',
    icon: '👣', unlockLevel: 1, hooks: {} },
  { id: 'high_alert', slot: 3, name: 'High Alert', desc: 'Vision pulses when an enemy sees you.',
    icon: '👁', unlockLevel: 6, hooks: { extraDamageArcs: true } },
  { id: 'amped', slot: 3, name: 'Amped', desc: 'Faster weapon swap and rocket reload.',
    icon: '🔥', unlockLevel: 10, hooks: { reloadMul: 0.85 } },
  { id: 'dead_silence', slot: 3, name: 'Dead Silence', desc: 'Silent on kill. Refreshes on kill.',
    icon: '🤫', unlockLevel: 16, hooks: { silentFootsteps: true } },
  { id: 'steady_aim', slot: 3, name: 'Steady Aim', desc: 'Steady scope, reduced idle sway.',
    icon: '🎯', unlockLevel: 22, hooks: { steadyAim: true } },
];

// ═══════════════════════════════════════════
//  FIELD UPGRADES (active abilities)
// ═══════════════════════════════════════════

export interface FieldUpgradeDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  unlockLevel: number;
  cooldown: number;   // seconds to fully charge
  chargeOnDamage: boolean;  // if true, also charges from damage dealt/taken
}

export const FIELD_UPGRADES: FieldUpgradeDef[] = [
  { id: 'stim', name: 'Stim Shot', desc: 'Instantly restore health and refresh sprint.',
    icon: '💉', unlockLevel: 1, cooldown: 75, chargeOnDamage: true },
  { id: 'dead_silence_fu', name: 'Dead Silence', desc: 'Temporary silent footsteps + bonus speed. Refreshes on kill.',
    icon: '🤫', unlockLevel: 1, cooldown: 90, chargeOnDamage: false },
  { id: 'munitions_box', name: 'Munitions Box', desc: 'Drops a box teammates can grab ammo from.',
    icon: '📦', unlockLevel: 8, cooldown: 120, chargeOnDamage: false },
  { id: 'trophy_system', name: 'Trophy System', desc: 'Destroys incoming grenades/rockets in range.',
    icon: '🛡', unlockLevel: 12, cooldown: 90, chargeOnDamage: false },
  { id: 'dead_mans_hand', name: 'Deadmans Hand', desc: 'On death, drop live grenade.',
    icon: '💣', unlockLevel: 18, cooldown: 0, chargeOnDamage: false },
  { id: 'tactical_insertion', name: 'Tactical Insertion', desc: 'Mark custom respawn location.',
    icon: '📍', unlockLevel: 25, cooldown: 120, chargeOnDamage: false },
  { id: 'recon_drone', name: 'Recon Drone', desc: 'Ping-reveals all enemies within 30m for 5s.',
    icon: '📡', unlockLevel: 30, cooldown: 150, chargeOnDamage: false },
];

// ═══════════════════════════════════════════
//  LETHAL / TACTICAL
// ═══════════════════════════════════════════

export type LethalId = 'frag_grenade' | 'c4' | 'semtex' | 'thermite' | 'molotov' | 'throwing_knife';
export type TacticalId = 'flash' | 'smoke' | 'stun' | 'decoy' | 'gas_grenade' | 'heartbeat_sensor';

export interface LethalDef  { id: LethalId; name: string; desc: string; icon: string; unlockLevel: number; }
export interface TacticalDef { id: TacticalId; name: string; desc: string; icon: string; unlockLevel: number; }

export const LETHALS: LethalDef[] = [
  { id: 'frag_grenade', name: 'Frag Grenade', desc: 'Cookable explosive.', icon: '🧨', unlockLevel: 1 },
  { id: 'semtex', name: 'Semtex', desc: 'Sticky explosive — no cook time.', icon: '🟢', unlockLevel: 9 },
  { id: 'c4', name: 'C4', desc: 'Throwable charge. Detonate manually.', icon: '🔴', unlockLevel: 15 },
  { id: 'thermite', name: 'Thermite', desc: 'Burns through enemies over time.', icon: '🔥', unlockLevel: 20 },
  { id: 'molotov', name: 'Molotov', desc: 'Area-denial fire pool.', icon: '🍾', unlockLevel: 24 },
  { id: 'throwing_knife', name: 'Throwing Knife', desc: 'Silent one-shot kill at short range.', icon: '🔪', unlockLevel: 28 },
];

export const TACTICALS: TacticalDef[] = [
  { id: 'flash', name: 'Flashbang', desc: 'Blinds enemies.', icon: '⚪', unlockLevel: 1 },
  { id: 'smoke', name: 'Smoke Grenade', desc: 'Creates concealment cloud.', icon: '💨', unlockLevel: 6 },
  { id: 'stun', name: 'Stun Grenade', desc: 'Slows aim + movement.', icon: '⚡', unlockLevel: 12 },
  { id: 'decoy', name: 'Decoy', desc: 'Makes fake gunfire sounds.', icon: '📻', unlockLevel: 17 },
  { id: 'gas_grenade', name: 'Gas Grenade', desc: 'Lingering damage cloud.', icon: '☣', unlockLevel: 22 },
  { id: 'heartbeat_sensor', name: 'Heartbeat Sensor', desc: 'Reveals enemies on minimap briefly.', icon: '❤', unlockLevel: 26 },
];

// ═══════════════════════════════════════════
//  LOADOUT
// ═══════════════════════════════════════════

export interface Loadout {
  id: string;
  name: string;
  primary: WeaponId;
  secondary: WeaponId;
  perk1: string;
  perk2: string;
  perk3: string;
  lethal: LethalId;
  tactical: TacticalId;
  fieldUpgrade: string;
}

export const DEFAULT_LOADOUTS: Loadout[] = [
  {
    id: 'custom_1', name: 'ASSAULT',
    primary: 'assault_rifle', secondary: 'pistol',
    perk1: 'flak_jacket', perk2: 'quickdraw', perk3: 'tracker',
    lethal: 'frag_grenade', tactical: 'flash',
    fieldUpgrade: 'stim',
  },
  {
    id: 'custom_2', name: 'SNIPER',
    primary: 'sniper_rifle', secondary: 'pistol',
    perk1: 'lightweight', perk2: 'quickdraw', perk3: 'tracker',
    lethal: 'frag_grenade', tactical: 'smoke',
    fieldUpgrade: 'stim',
  },
  {
    id: 'custom_3', name: 'RUSHER',
    primary: 'smg', secondary: 'shotgun',
    perk1: 'lightweight', perk2: 'quickdraw', perk3: 'tracker',
    lethal: 'semtex', tactical: 'flash',
    fieldUpgrade: 'dead_silence_fu',
  },
  {
    id: 'custom_4', name: 'SUPPORT',
    primary: 'assault_rifle', secondary: 'pistol',
    perk1: 'flak_jacket', perk2: 'hardline', perk3: 'amped',
    lethal: 'frag_grenade', tactical: 'smoke',
    fieldUpgrade: 'munitions_box',
  },
  {
    id: 'custom_5', name: 'HEAVY',
    primary: 'rocket_launcher', secondary: 'shotgun',
    perk1: 'flak_jacket', perk2: 'quickdraw', perk3: 'amped',
    lethal: 'c4', tactical: 'stun',
    fieldUpgrade: 'trophy_system',
  },
];

const LOADOUT_STORAGE = 'warzone_loadouts_v1';

// ═══════════════════════════════════════════
//  PERSISTENCE & ACCESS
// ═══════════════════════════════════════════

let _loadouts: Loadout[] = [];

export function initLoadouts(): void {
  try {
    const raw = localStorage.getItem(LOADOUT_STORAGE);
    if (raw) _loadouts = JSON.parse(raw);
  } catch { /* ignore */ }
  if (_loadouts.length === 0) {
    _loadouts = JSON.parse(JSON.stringify(DEFAULT_LOADOUTS));
    saveLoadouts();
  }
}

function saveLoadouts(): void {
  localStorage.setItem(LOADOUT_STORAGE, JSON.stringify(_loadouts));
}

export function getLoadouts(): Loadout[] {
  if (_loadouts.length === 0) initLoadouts();
  return _loadouts;
}

export function getActiveLoadout(): Loadout {
  const p = getProfile();
  return getLoadouts()[p.activeLoadoutIndex] ?? getLoadouts()[0];
}

export function setActiveLoadout(index: number): void {
  profileMutate(p => {
    p.activeLoadoutIndex = Math.max(0, Math.min(getLoadouts().length - 1, index));
  });
}

export function updateLoadout(index: number, patch: Partial<Loadout>): void {
  if (index < 0 || index >= _loadouts.length) return;
  _loadouts[index] = { ..._loadouts[index], ...patch };
  saveLoadouts();
}

// ═══════════════════════════════════════════
//  PERK QUERY — aggregates active perk hooks
// ═══════════════════════════════════════════

export interface AggregatedPerkHooks extends Required<PerkHooks> {}

const NO_PERK_HOOKS: AggregatedPerkHooks = {
  healthRegenMul: 1,
  moveSpeedMul: 1,
  sprintToFireMul: 1,
  adsSpeedMul: 1,
  reloadMul: 1,
  explosionResistMul: 1,
  damageResistMul: 1,
  jumpHeightMul: 1,
  fallDamageMul: 1,
  uavResistSeconds: 0,
  showEnemyShotDots: false,
  silentFootsteps: false,
  finisherBonusDmg: 0,
  startExtraMag: false,
  startExtraGrenade: false,
  steadyAim: false,
  flashImmune: false,
  extraDamageArcs: false,
};

/** Returns the combined hooks of the active loadout's 3 perks. */
export function getActivePerkHooks(): AggregatedPerkHooks {
  const lo = getActiveLoadout();
  const out: AggregatedPerkHooks = { ...NO_PERK_HOOKS };
  for (const perkId of [lo.perk1, lo.perk2, lo.perk3]) {
    const def = PERKS.find(p => p.id === perkId);
    if (!def) continue;
    const h = def.hooks;
    if (h.healthRegenMul != null) out.healthRegenMul *= h.healthRegenMul;
    if (h.moveSpeedMul != null) out.moveSpeedMul *= h.moveSpeedMul;
    if (h.sprintToFireMul != null) out.sprintToFireMul *= h.sprintToFireMul;
    if (h.adsSpeedMul != null) out.adsSpeedMul *= h.adsSpeedMul;
    if (h.reloadMul != null) out.reloadMul *= h.reloadMul;
    if (h.explosionResistMul != null) out.explosionResistMul *= h.explosionResistMul;
    if (h.damageResistMul != null) out.damageResistMul *= h.damageResistMul;
    if (h.jumpHeightMul != null) out.jumpHeightMul *= h.jumpHeightMul;
    if (h.fallDamageMul != null) out.fallDamageMul *= h.fallDamageMul;
    if (h.uavResistSeconds != null) out.uavResistSeconds = Math.max(out.uavResistSeconds, h.uavResistSeconds);
    if (h.showEnemyShotDots) out.showEnemyShotDots = true;
    if (h.silentFootsteps) out.silentFootsteps = true;
    if (h.finisherBonusDmg != null) out.finisherBonusDmg += h.finisherBonusDmg;
    if (h.startExtraMag) out.startExtraMag = true;
    if (h.startExtraGrenade) out.startExtraGrenade = true;
    if (h.steadyAim) out.steadyAim = true;
    if (h.flashImmune) out.flashImmune = true;
    if (h.extraDamageArcs) out.extraDamageArcs = true;
  }
  return out;
}

export function isPerkUnlocked(perkId: string): boolean {
  const def = PERKS.find(p => p.id === perkId);
  if (!def) return false;
  return getProfile().level >= def.unlockLevel;
}

export function isFieldUpgradeUnlocked(id: string): boolean {
  const def = FIELD_UPGRADES.find(f => f.id === id);
  if (!def) return false;
  return getProfile().level >= def.unlockLevel;
}