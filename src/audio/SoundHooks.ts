import * as THREE from 'three';
import { Audio } from './AudioManager';
import { gameState } from '@/core/GameState';
import type { WeaponId } from '@/config/weapons';

const _v = new THREE.Vector3();

const WEAPON_SHOT_SOUND: Record<WeaponId, string | null> = {
  unarmed: null,
  knife: null,
  pistol: 'shot_pistol',
  smg: 'shot_smg',
  assault_rifle: 'shot_ar',
  shotgun: 'shot_shotgun',
  sniper_rifle: 'shot_sniper',
  rocket_launcher: 'shot_rocket',
};

const WEAPON_RELOAD_SOUND: Record<WeaponId, string> = {
  unarmed: 'reload',
  knife: 'reload',
  pistol: 'reload_pistol',
  smg: 'reload_smg',
  assault_rifle: 'reload_ar',
  shotgun: 'reload_shotgun',
  sniper_rifle: 'reload_sniper',
  rocket_launcher: 'reload',
};

const FOOTSTEP_POOL = ['footstep_1', 'footstep_2', 'footstep_3', 'footstep_4', 'footstep_5', 'footstep_6'];
let footstepIdx = 0;

const BODY_IMPACT_POOL = ['impact_body', 'impact_body_2', 'impact_body_3'];
const WALL_IMPACT_POOL = [
  'impact_wall', 'impact_wall_2', 'impact_metal',
  'impact_rock_1', 'impact_rock_2', 'impact_wood_1', 'impact_wood_2',
];
const GRUNT_POOL = ['grunt_1', 'grunt_2', 'grunt_3'];
const LAND_POOL = ['land', 'land_2'];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export function playShot(weaponId: WeaponId, pos?: THREE.Vector3, fromPlayer = false): void {
  const id = WEAPON_SHOT_SOUND[weaponId];
  if (!id) return;
  if (fromPlayer) {
    Audio.play(id, { volume: 0.85, pitchJitter: 0.06 });
  } else if (pos) {
    Audio.play(id, { pos, pitchJitter: 0.08 });
  }
}

export function playImpact(pos: THREE.Vector3, kind: 'body' | 'headshot' | 'wall'): void {
  const id = kind === 'headshot' ? 'impact_headshot'
           : kind === 'body' ? pick(BODY_IMPACT_POOL)
           : pick(WALL_IMPACT_POOL);
  Audio.play(id, { pos, pitchJitter: 0.1 });
}

export function playFootstep(pos: THREE.Vector3, fromPlayer = false): void {
  const id = FOOTSTEP_POOL[footstepIdx];
  footstepIdx = (footstepIdx + 1) % FOOTSTEP_POOL.length;
  if (fromPlayer) {
    Audio.play(id, { volume: 0.5, pitchJitter: 0.08 });
  } else {
    Audio.play(id, { pos, pitchJitter: 0.08 });
  }
}

export function playReload(fromPlayer = false, pos?: THREE.Vector3, weaponId?: WeaponId): void {
  const id = weaponId ? WEAPON_RELOAD_SOUND[weaponId] : 'reload';
  if (fromPlayer) Audio.play(id, { volume: 0.85 });
  else if (pos) Audio.play(id, { pos, volume: 0.6 });
}

export function playEmptyClick(): void { Audio.play('empty_click'); }
export function playWeaponSwap(): void { Audio.play('weapon_swap'); }
export function playJump(): void { Audio.play('jump'); }
export function playLand(intensity = 1): void { Audio.play(pick(LAND_POOL), { volume: 0.5 + intensity * 0.5 }); }
export function playSlide(): void { Audio.play('slide'); }
export function playHitTaken(): void { Audio.play(pick(GRUNT_POOL)); }
export function playHeal(): void { Audio.play('heal'); }
export function playPickup(): void { Audio.play('pickup'); }
export function playDeath(pos?: THREE.Vector3): void {
  if (pos) {
    Audio.play('death', { pos, pitchJitter: 0.1 });
    Audio.play('death_impact', { pos, volume: 0.7 });
  } else {
    Audio.play('death', { pitchJitter: 0.1 });
  }
}
export function playRespawn(): void { Audio.play('respawn'); }
export function playShotgunCock(): void { Audio.play('shotgun_cock'); }
export function playSniperZoom(): void { Audio.play('sniper_zoom'); }
export function playExplosion(pos: THREE.Vector3): void {
  Audio.play('explosion', { pos, pitchJitter: 0.1 });
}

/** Used by Medals.ts */
export function playMedalSound(tier: 'bronze' | 'silver' | 'gold' | 'epic'): void {
  if (tier === 'epic') Audio.play('medal_epic');
  else if (tier === 'gold') Audio.play('medal_gold');
  else Audio.play('medal_silver');
}

/** AI voice callouts — use bot's position for spatial audio */
export function playBotCallout(kind: 'spotted' | 'reload' | 'help', pos: THREE.Vector3): void {
  const id = kind === 'spotted' ? 'voice_enemy_spotted'
           : kind === 'reload' ? 'voice_reloading'
           : 'voice_need_help';
  Audio.play(id, { pos, pitchJitter: 0.15, volume: 0.7 });
}

// ── Heartbeat loop management ──

let heartbeatActive = false;
let hbTimer = 0;

export function updateHeartbeat(dt: number): void {
  const lowHP = !gameState.pDead && gameState.pHP < 30 && gameState.pHP > 0;
  if (lowHP) {
    if (!heartbeatActive) heartbeatActive = true;
    hbTimer -= dt;
    if (hbTimer <= 0) {
      Audio.play('heartbeat', { volume: 0.7 });
      // Faster pulse at lower HP
      const interval = 0.4 + (gameState.pHP / 30) * 0.6;
      hbTimer = interval;
    }
  } else {
    heartbeatActive = false;
    hbTimer = 0;
  }
}