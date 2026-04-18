import * as THREE from 'three';
import { Audio } from './AudioManager';
import { gameState } from '@/core/GameState';
import type { WeaponId } from '@/config/weapons';

const _v = new THREE.Vector3();

// ── Subtitle system ──
let _subtitleEl: HTMLElement | null = null;
let _subtitleTimer = 0;

function getSubtitleEl(): HTMLElement | null {
  if (!_subtitleEl) _subtitleEl = document.getElementById('subtitleOverlay');
  return _subtitleEl;
}

export function showSubtitle(text: string, duration = 2): void {
  if (!gameState.showSubtitles) return;
  const el = getSubtitleEl();
  if (!el) return;
  el.textContent = text;
  el.classList.add('on');
  _subtitleTimer = duration;
}

export function updateSubtitles(dt: number): void {
  if (_subtitleTimer > 0) {
    _subtitleTimer -= dt;
    if (_subtitleTimer <= 0) {
      const el = getSubtitleEl();
      if (el) { el.classList.remove('on'); el.textContent = ''; }
    }
  }
}

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
const FOOTSTEP_METAL = ['footstep_metal_1', 'footstep_metal_2', 'footstep_metal_3'];
const FOOTSTEP_WOOD = ['footstep_wood_1', 'footstep_wood_2', 'footstep_wood_3'];
let footstepIdx = 0;

export type SurfaceType = 'concrete' | 'metal' | 'wood';

const _downRay = new THREE.Raycaster();
const _downDir = new THREE.Vector3(0, -1, 0);

/** Detect surface beneath a world position (raycasts down). */
export function detectSurface(pos: THREE.Vector3): SurfaceType {
  _downRay.camera = gameState.camera;
  _downRay.set(_v.set(pos.x, (pos.y ?? 0) + 0.5, pos.z), _downDir);
  _downRay.far = 3;
  const hits = _downRay.intersectObjects(gameState.scene.children, true);
  if (hits.length > 0) {
    const name = (hits[0].object.name || '').toLowerCase();
    if (name.includes('metal') || name.includes('steel') || name.includes('iron')) return 'metal';
    if (name.includes('wood') || name.includes('plank') || name.includes('crate')) return 'wood';
  }
  return 'concrete';
}

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

export function playFootstep(pos: THREE.Vector3, fromPlayer = false, sprintMul = 1, surface: SurfaceType = 'concrete'): void {
  const pool = surface === 'metal' ? FOOTSTEP_METAL
             : surface === 'wood' ? FOOTSTEP_WOOD
             : FOOTSTEP_POOL;
  const id = pool[footstepIdx % pool.length];
  footstepIdx = (footstepIdx + 1) % FOOTSTEP_POOL.length;
  if (fromPlayer) {
    // Sprint footsteps are louder + lower pitch; walk footsteps are quieter
    const vol = 0.35 + 0.25 * sprintMul;
    const basePitch = sprintMul > 0.7 ? 0.94 : 1.04; // deeper for sprint, lighter for walk
    Audio.play(id, { volume: vol, pitch: basePitch, pitchJitter: 0.08 });
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
export function playKillConfirmed(): void { Audio.play('kill_confirmed'); }
export function playFriendlyFireBuzz(): void { Audio.play('friendly_fire_buzz'); }
export function playBulletWhiz(pos: THREE.Vector3): void {
  Audio.play('bullet_whiz', { pos, pitchJitter: 0.15, volume: 0.5 });
}
export function playHitmarkerSound(isHeadshot: boolean): void {
  Audio.play(isHeadshot ? 'hitmarker_headshot' : 'hitmarker_body');
}
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
  showSubtitle('[Explosion]', 1.5);
}

/** Used by Medals.ts */
export function playMedalSound(tier: 'bronze' | 'silver' | 'gold' | 'epic'): void {
  if (tier === 'epic') Audio.play('medal_epic');
  else if (tier === 'gold') Audio.play('medal_gold');
  else Audio.play('medal_silver');
}

/** AI voice callouts — use bot's position for spatial audio */
export function playBotCallout(kind: 'spotted' | 'reload' | 'help', pos: THREE.Vector3, pitchBase = 1): void {
  const id = kind === 'spotted' ? 'voice_enemy_spotted'
           : kind === 'reload' ? 'voice_reloading'
           : 'voice_need_help';
  const pitch = pitchBase + (Math.random() - 0.5) * 0.15;
  Audio.play(id, { pos, pitch, volume: 0.7 });
  const label = kind === 'spotted' ? '[Enemy Spotted]'
              : kind === 'reload' ? '[Reloading]'
              : '[Need Help]';
  showSubtitle(label, 2);
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