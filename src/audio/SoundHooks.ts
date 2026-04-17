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
  const id = kind === 'headshot' ? 'impact_headshot' : kind === 'body' ? 'impact_body' : 'impact_wall';
  Audio.play(id, { pos, pitchJitter: 0.1 });
}

export function playFootstep(pos: THREE.Vector3, fromPlayer = false): void {
  if (fromPlayer) {
    Audio.play('footstep', { volume: 0.5, pitchJitter: 0.15 });
  } else {
    Audio.play('footstep', { pos, pitchJitter: 0.15 });
  }
}

export function playReload(fromPlayer = false, pos?: THREE.Vector3): void {
  if (fromPlayer) Audio.play('reload', { volume: 0.85 });
  else if (pos) Audio.play('reload', { pos, volume: 0.6 });
}

export function playEmptyClick(): void { Audio.play('empty_click'); }
export function playWeaponSwap(): void { Audio.play('weapon_swap'); }
export function playJump(): void { Audio.play('jump'); }
export function playLand(intensity = 1): void { Audio.play('land', { volume: 0.5 + intensity * 0.5 }); }
export function playSlide(): void { Audio.play('slide'); }
export function playHitTaken(): void { Audio.play('hit_taken'); }
export function playHeal(): void { Audio.play('heal'); }
export function playPickup(): void { Audio.play('pickup'); }
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