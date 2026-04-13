import * as THREE from 'three';
import * as YUKA from 'yuka';
import type { TDMAgent } from '@/entities/TDMAgent';
import type { WeaponId } from '@/config/weapons';

// ────────────────────────────────────────────
//  Shared type definitions
// ────────────────────────────────────────────

export interface BoxCollider {
  type: 'box';
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export interface CircleCollider {
  type: 'circle';
  x: number;
  z: number;
  r: number;
}

export type Collider = BoxCollider | CircleCollider;

export interface Bullet {
  mesh: THREE.Mesh;
  pl: THREE.PointLight;
  dir: THREE.Vector3;
  ownerType: 'player' | 'ai';
  ownerTeam: number;
  dmg: number;
  spd: number;
  life: number;
  isRocket?: boolean;
  isGrenade?: boolean;
  splashRadius?: number;
}

export interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  mL: number;
  isRing?: boolean;
  isSmoke?: boolean;
  light?: THREE.PointLight;
}

export interface Pickup {
  mesh: THREE.Mesh;
  ring: THREE.Mesh;
  active: boolean;
  respawnAt: number;
  t: 'health' | 'ammo' | 'weapon';
  x: number;
  z: number;
  weaponId?: WeaponId;
}

export interface KillfeedEntry {
  killer: string;
  victim: string;
  killerTeam: number;
  victimTeam: number;
  time: number;
  weaponName?: string;
}

export interface InputKeys {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  r: boolean;
  shift: boolean;
  tab: boolean;
  g: boolean;
  '1': boolean;
  '2': boolean;
  '3': boolean;
}

// ────────────────────────────────────────────
//  Global mutable game state
// ────────────────────────────────────────────

export const gameState = {
  // Three.js core
  scene: null as unknown as THREE.Scene,
  camera: null as unknown as THREE.PerspectiveCamera,
  renderer: null as unknown as THREE.WebGLRenderer,
  raycaster: null as unknown as THREE.Raycaster,
  time: null as unknown as YUKA.Time,
  entityManager: null as unknown as YUKA.EntityManager,

  // Viewmodel
  vmScene: null as THREE.Scene | null,
  vmCamera: null as THREE.PerspectiveCamera | null,

  // World elapsed time
  worldElapsed: 0,

  // Collision and world objects
  wallMeshes: [] as THREE.Mesh[],
  yukaObs: [] as YUKA.GameEntity[],
  colliders: [] as Collider[],
  arenaColliders: [] as Collider[],
  coverPoints: [] as YUKA.Vector3[],

  // Entities
  agents: [] as TDMAgent[],
  player: null as unknown as TDMAgent,

  // Projectiles (rockets/grenades only now) and effects
  bullets: [] as Bullet[],
  particles: [] as Particle[],

  // Pickups
  pickups: [] as Pickup[],

  // Player state
  pHP: 100,
  pAmmo: 30,
  pMaxAmmo: 30,
  pKills: 0,
  pDeaths: 0,
  pDead: false,
  respTimer: 0,
  pReloading: false,
  pReloadTimer: 0,
  pReloadDuration: 2.0,

  // Player weapon
  pWeaponId: 'assault_rifle' as WeaponId,
  pWeaponSlots: ['assault_rifle', 'pistol'] as WeaponId[],
  pActiveSlot: 0,
  pGrenades: 2,
  pGrenadeCooldown: 0,
  pShootTimer: 0,
  pBurstCount: 0,
  pBurstTimer: 0,

  // Camera / input
  mouseLocked: false,
  cameraYaw: 0,
  cameraPitch: 0,
  mouseHeld: false,
  mouseDeltaX: 0,
  mouseDeltaY: 0,
  keys: {
    w: false, a: false, s: false, d: false,
    r: false, shift: false, tab: false, g: false,
    '1': false, '2': false, '3': false,
  } as InputKeys,

  // Camera recoil
  recoilPitch: 0,
  recoilYaw: 0,
  recoilRecoveryPitch: 0,
  recoilRecoveryYaw: 0,

  // Scores
  teamScores: [0, 0] as [number, number],
  roundOver: false,
  killfeedEntries: [] as KillfeedEntry[],

  // Floor shader ref
  floorMat: null as THREE.ShaderMaterial | null,
};
