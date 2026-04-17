import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { TEAM_BLUE, TEAM_RED } from '@/config/constants';
import { zone } from '@/br/ZoneSystem';

interface Waypoint {
  el: HTMLDivElement;
  pos: () => THREE.Vector3 | null;
  color: string;
  icon: string;
  label: string;
}

const waypoints: Waypoint[] = [];
let layerEl: HTMLDivElement | null = null;
const _v = new THREE.Vector3();

function ensureLayer(): HTMLDivElement {
  if (layerEl) return layerEl;
  layerEl = document.createElement('div');
  layerEl.id = 'waypointLayer';
  document.body.appendChild(layerEl);
  return layerEl;
}

function makeWaypointEl(color: string, icon: string, label: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'wp-marker';
  el.innerHTML = `
    <div class="wp-icon" style="color:${color};border-color:${color}">${icon}</div>
    <div class="wp-label" style="color:${color}">${label}</div>
    <div class="wp-dist"></div>
  `;
  ensureLayer().appendChild(el);
  return el;
}

export function rebuildWaypoints(): void {
  // Clear existing
  for (const wp of waypoints) wp.el.remove();
  waypoints.length = 0;

  const mode = gameState.mode;

  if (mode === 'ctf') {
    // Enemy flag (blue → red)
    const playerTeam = gameState.player.team;
    const enemyTeam = playerTeam === TEAM_BLUE ? TEAM_RED : TEAM_BLUE;
    waypoints.push({
      el: makeWaypointEl('#ff3344', '⚑', 'ENEMY FLAG'),
      pos: () => {
        const f = gameState.flags[enemyTeam];
        if (f.carriedBy) return new THREE.Vector3(f.carriedBy.position.x, 2.4, f.carriedBy.position.z);
        if (f.dropped) return new THREE.Vector3(f.dropPos.x, 1.2, f.dropPos.z);
        return new THREE.Vector3(f.base.x, 2.4, f.base.z);
      },
      color: '#ff3344',
      icon: '⚑',
      label: 'ENEMY FLAG',
    });
    // Own flag base
    waypoints.push({
      el: makeWaypointEl('#4aa8ff', '⛨', 'BASE'),
      pos: () => {
        const f = gameState.flags[playerTeam];
        return new THREE.Vector3(f.base.x, 2.4, f.base.z);
      },
      color: '#4aa8ff',
      icon: '⛨',
      label: 'BASE',
    });
  }

  if (mode === 'br') {
    // Zone centre marker — visible when shrinking
    waypoints.push({
      el: makeWaypointEl('#a855f7', '⊙', 'ZONE'),
      pos: () => {
        if (!zone.active) return null;
        const t = zone.isShrinking ? zone.targetCenter : zone.currentCenter;
        return new THREE.Vector3(t.x, 25, t.y);
      },
      color: '#a855f7',
      icon: '⊙',
      label: 'ZONE',
    });
  }
}

export function updateWaypoints(): void {
  const cam = gameState.camera;
  const camPos = cam.position;
  for (const wp of waypoints) {
    const p = wp.pos();
    if (!p) {
      wp.el.style.display = 'none';
      continue;
    }
    wp.el.style.display = 'block';

    _v.copy(p).project(cam);
    const behind = _v.z > 1;

    let x = (_v.x * 0.5 + 0.5) * window.innerWidth;
    let y = (-_v.y * 0.5 + 0.5) * window.innerHeight;

    if (behind) {
      const dx = x - window.innerWidth / 2;
      const dy = y - window.innerHeight / 2;
      const len = Math.hypot(dx, dy) || 1;
      x = window.innerWidth / 2 - (dx / len) * (window.innerWidth * 0.42);
      y = window.innerHeight / 2 - (dy / len) * (window.innerHeight * 0.42);
      wp.el.classList.add('off-screen');
    } else {
      wp.el.classList.remove('off-screen');
    }

    const dist = camPos.distanceTo(p);
    const distEl = wp.el.querySelector('.wp-dist') as HTMLElement;
    if (distEl) distEl.textContent = `${Math.round(dist)}m`;

    // Fade by distance — close waypoints get out of the way
    const fade = dist < 6 ? dist / 6 : 1;
    wp.el.style.opacity = String(fade);

    wp.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }
}

export function clearWaypoints(): void {
  for (const wp of waypoints) wp.el.remove();
  waypoints.length = 0;
}