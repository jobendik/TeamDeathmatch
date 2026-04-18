import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { Audio } from '@/audio/AudioManager';

export type PingKind = 'enemy' | 'location' | 'loot' | 'danger' | 'caution';

interface ActivePing {
  pos: THREE.Vector3;
  kind: PingKind;
  label: string;
  color: string;
  life: number;
  maxLife: number;
  el: HTMLDivElement;
}

const active: ActivePing[] = [];
let layerEl: HTMLDivElement | null = null;
const _v = new THREE.Vector3();

function ensureLayer(): HTMLDivElement {
  if (layerEl) return layerEl;
  layerEl = document.createElement('div');
  layerEl.id = 'pingLayer';
  document.body.appendChild(layerEl);
  return layerEl;
}

const PING_INFO: Record<PingKind, { color: string; icon: string; label: string }> = {
  enemy:    { color: '#ff3344', icon: '◈', label: 'ENEMY' },
  location: { color: '#4aa8ff', icon: '◆', label: 'GO HERE' },
  loot:     { color: '#ffcc33', icon: '★', label: 'LOOT' },
  danger:   { color: '#ff8833', icon: '⚠', label: 'DANGER' },
  caution:  { color: '#a47aff', icon: '?',  label: 'WATCH' },
};

function classifyPing(hitObj: any, hitPoint: THREE.Vector3): PingKind {
  if (!hitObj) return 'location';
  const owner = (hitObj.parent?.userData?.agentRef);
  if (owner && owner.team !== gameState.player.team) return 'enemy';
  // Could expand: if hit pickup, return 'loot'
  return 'location';
}

export function fireDeferredPing(): void {
  const layer = ensureLayer();

  // Raycast from camera forward
  const cam = gameState.camera;
  const forward = new THREE.Vector3();
  cam.getWorldDirection(forward);
  const rc = gameState.raycaster;
  rc.set(cam.position, forward);
  rc.far = 200;

  const hits = rc.intersectObjects(gameState.wallMeshes, false);
  let hitPoint: THREE.Vector3;
  let kind: PingKind = 'location';
  if (hits.length > 0) {
    hitPoint = hits[0].point.clone();
    kind = classifyPing(hits[0].object, hitPoint);
  } else {
    hitPoint = cam.position.clone().add(forward.multiplyScalar(40));
  }

  // Check for enemy in front (sphere check)
  for (const ag of gameState.agents) {
    if (ag === gameState.player || ag.isDead) continue;
    if (ag.team === gameState.player.team) continue;
    const toAg = new THREE.Vector3(ag.position.x - cam.position.x, ag.position.y - cam.position.y, ag.position.z - cam.position.z);
    const dist = toAg.length();
    toAg.normalize();
    const angle = forward.dot(toAg);
    if (angle > 0.985 && dist < 80) {
      hitPoint = new THREE.Vector3(ag.position.x, 1.5, ag.position.z);
      kind = 'enemy';
      break;
    }
  }

  spawnPing(hitPoint, kind);
}

export function spawnPing(pos: THREE.Vector3, kind: PingKind): void {
  const layer = ensureLayer();
  const info = PING_INFO[kind];

  const el = document.createElement('div');
  el.className = `ping-marker ping-${kind}`;
  el.innerHTML = `
    <div class="ping-icon" style="color:${info.color}">${info.icon}</div>
    <div class="ping-label" style="color:${info.color}">${info.label}</div>
    <div class="ping-dist"></div>
  `;
  layer.appendChild(el);

  active.push({
    pos: pos.clone(),
    kind,
    label: info.label,
    color: info.color,
    life: kind === 'enemy' ? 5 : 8,
    maxLife: kind === 'enemy' ? 5 : 8,
    el,
  });

  Audio.play('ui_confirm', { volume: 0.5 });
}

export function updatePings(dt: number): void {
  if (active.length === 0) return;
  const cam = gameState.camera;
  const forward = new THREE.Vector3();
  cam.getWorldDirection(forward);

  for (let i = active.length - 1; i >= 0; i--) {
    const p = active[i];
    p.life -= dt;
    if (p.life <= 0) {
      p.el.remove();
      active.splice(i, 1);
      continue;
    }

    // Project to screen
    _v.copy(p.pos);
    _v.project(cam);
    const behindCamera = _v.z > 1;

    let x = (_v.x * 0.5 + 0.5) * window.innerWidth;
    let y = (-_v.y * 0.5 + 0.5) * window.innerHeight;

    // Distance from player
    const dist = cam.position.distanceTo(p.pos);
    const distEl = p.el.querySelector('.ping-dist') as HTMLElement;
    if (distEl) distEl.textContent = `${Math.round(dist)}m`;

    if (behindCamera) {
      // Clamp to screen edge
      const dx = x - window.innerWidth / 2;
      const dy = y - window.innerHeight / 2;
      const len = Math.hypot(dx, dy) || 1;
      x = window.innerWidth / 2 - (dx / len) * (window.innerWidth * 0.45);
      y = window.innerHeight / 2 - (dy / len) * (window.innerHeight * 0.45);
      p.el.classList.add('off-screen');
    } else {
      p.el.classList.remove('off-screen');
    }

    // Fade in last second
    const fade = p.life < 1 ? p.life : 1;
    const pulse = 1 + Math.sin(gameState.worldElapsed * 6) * 0.08;
    p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${pulse})`;
    p.el.style.opacity = String(fade);
  }
}

export function clearPings(): void {
  for (const p of active) p.el.remove();
  active.length = 0;
}