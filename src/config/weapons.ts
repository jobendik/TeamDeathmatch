/**
 * Weapon definitions for all firearms, explosives, and melee.
 * Each weapon has distinct characteristics that affect gameplay.
 */

export type WeaponId = 'unarmed' | 'knife' | 'pistol' | 'smg' | 'assault_rifle' | 'shotgun' | 'sniper_rifle' | 'rocket_launcher';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  damage: number;
  fireRate: number;       // seconds between shots
  magSize: number;
  reloadTime: number;
  aimError: number;       // base spread (radians)
  range: number;          // effective range
  burstSize: number;      // shots per burst (1 = semi-auto)
  burstDelay: number;     // delay between burst shots
  isHitscan: boolean;     // true = raycast, false = projectile
  projectileSpeed: number; // only for non-hitscan
  splashRadius: number;   // 0 = no splash
  headshotMult: number;
  movePenalty: number;    // accuracy penalty while moving (multiplier)
  /** How desirable this weapon is for AI (0–100) */
  desirability: number;
  /** Number of pellets per shot (shotgun) */
  pellets: number;
  /** Viewmodel color */
  color: number;
  /** Whether this weapon can fire at all */
  canFire: boolean;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  unarmed: {
    id: 'unarmed', name: 'UNARMED',
    damage: 0, fireRate: 0.5, magSize: 0, reloadTime: 0,
    aimError: 1, range: 0, burstSize: 0, burstDelay: 0,
    isHitscan: true, projectileSpeed: 0, splashRadius: 0,
    headshotMult: 1.0, movePenalty: 1.0,
    desirability: 0, pellets: 0, color: 0x444444,
    canFire: false,
  },
  knife: {
    id: 'knife', name: 'KNIFE',
    damage: 55, fireRate: 0.5, magSize: 0, reloadTime: 0,
    aimError: 0, range: 3, burstSize: 1, burstDelay: 0,
    isHitscan: true, projectileSpeed: 0, splashRadius: 0,
    headshotMult: 1.5, movePenalty: 1.0,
    desirability: 5, pellets: 1, color: 0x888888,
    canFire: true,
  },
  pistol: {
    id: 'pistol', name: 'PISTOL',
    damage: 18, fireRate: 0.3, magSize: 12, reloadTime: 1.2,
    aimError: 0.03, range: 35, burstSize: 1, burstDelay: 0,
    isHitscan: true, projectileSpeed: 0, splashRadius: 0,
    headshotMult: 2.0, movePenalty: 1.1,
    desirability: 20, pellets: 1, color: 0x888888,
    canFire: true,
  },
  smg: {
    id: 'smg', name: 'SMG',
    damage: 12, fireRate: 0.08, magSize: 35, reloadTime: 1.6,
    aimError: 0.055, range: 25, burstSize: 5, burstDelay: 0.06,
    isHitscan: true, projectileSpeed: 0, splashRadius: 0,
    headshotMult: 1.5, movePenalty: 1.05,
    desirability: 50, pellets: 1, color: 0x445566,
    canFire: true,
  },
  assault_rifle: {
    id: 'assault_rifle', name: 'ASSAULT RIFLE',
    damage: 22, fireRate: 0.12, magSize: 30, reloadTime: 2.0,
    aimError: 0.035, range: 45, burstSize: 3, burstDelay: 0.07,
    isHitscan: true, projectileSpeed: 0, splashRadius: 0,
    headshotMult: 1.8, movePenalty: 1.15,
    desirability: 70, pellets: 1, color: 0x334455,
    canFire: true,
  },
  shotgun: {
    id: 'shotgun', name: 'SHOTGUN',
    damage: 12, fireRate: 0.7, magSize: 6, reloadTime: 2.5,
    aimError: 0.12, range: 12, burstSize: 1, burstDelay: 0,
    isHitscan: true, projectileSpeed: 0, splashRadius: 0,
    headshotMult: 1.5, movePenalty: 1.0,
    desirability: 55, pellets: 8, color: 0x664422,
    canFire: true,
  },
  sniper_rifle: {
    id: 'sniper_rifle', name: 'SNIPER',
    damage: 75, fireRate: 1.2, magSize: 5, reloadTime: 3.0,
    aimError: 0.008, range: 80, burstSize: 1, burstDelay: 0,
    isHitscan: true, projectileSpeed: 0, splashRadius: 0,
    headshotMult: 2.5, movePenalty: 1.5,
    desirability: 65, pellets: 1, color: 0x223344,
    canFire: true,
  },
  rocket_launcher: {
    id: 'rocket_launcher', name: 'ROCKET',
    damage: 90, fireRate: 2.0, magSize: 2, reloadTime: 3.5,
    aimError: 0.02, range: 50, burstSize: 1, burstDelay: 0,
    isHitscan: false, projectileSpeed: 25, splashRadius: 5,
    headshotMult: 1.0, movePenalty: 1.3,
    desirability: 80, pellets: 1, color: 0x556633,
    canFire: true,
  },
};

/** Starting weapon for each bot class */
export const CLASS_DEFAULT_WEAPON: Record<string, WeaponId> = {
  rifleman: 'assault_rifle',
  assault: 'smg',
  sniper: 'sniper_rifle',
  flanker: 'smg',
};

/** Grenade configuration */
export const GRENADE_CONFIG = {
  maxGrenades: 2,
  damage: 60,
  splashRadius: 6,
  fuseTime: 2.5,
  throwSpeed: 18,
  cooldown: 8,
};
