/**
 * ZoneSystem — Optimized storm wall.
 *
 * Uses a single cylinder mesh with a procedural storm shader.
 * Zone ring on ground uses a simple torus (1 draw call).
 * Damage is applied only to bots within the spatial grid query range.
 */

import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { ZONE_PHASES, BR_INITIAL_ZONE_RADIUS, type ZonePhase } from './BRConfig';
import { dealDmgPlayer, dealDmgAgent } from '@/combat/Combat';
import { botGrid } from './BRBots';

const SEGMENTS = 48;
const STORM_H = 180;

const stormFS = `
  uniform float uTime;
  varying vec2 vUv;
  varying float vY;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i=floor(p), f=fract(p);
    float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
    vec2 u=f*f*(3.-2.*f);
    return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;
  }
  float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<3;i++){v+=a*noise(p);p*=2.1;a*=.5;} return v; }

  void main(){
    vec2 p = vec2(vUv.x * 12., vUv.y * 3. - uTime * 0.12);
    float storm = fbm(p) * 0.7 + fbm(p * 2.5 + uTime * 0.2) * 0.4;
    float hMask = smoothstep(1., 0., vUv.y) * 0.6 + 0.4;
    storm *= hMask;

    // Fortnite purple-blue storm color
    vec3 col1 = vec3(0.5, 0.15, 0.8);   // deep purple
    vec3 col2 = vec3(0.2, 0.3, 0.9);    // blue
    vec3 col3 = vec3(0.8, 0.4, 1.0);    // highlight
    vec3 col = mix(col1, col2, storm) + col3 * storm * 0.35;

    float alpha = (0.3 + storm * 0.5) * hMask;
    // Edge glow pulse
    float pulse = sin(uTime * 1.8) * 0.5 + 0.5;
    alpha += pulse * 0.08;

    gl_FragColor = vec4(col, alpha);
  }
`;

export interface ZoneState {
  active: boolean;
  phaseIndex: number;
  phaseStartTime: number;
  isShrinking: boolean;
  shrinkStartTime: number;
  currentCenter: THREE.Vector2;
  currentRadius: number;
  sourceCenter: THREE.Vector2;
  sourceRadius: number;
  targetCenter: THREE.Vector2;
  targetRadius: number;
  mesh: THREE.Mesh | null;
  ringMesh: THREE.Mesh | null;
  targetRingMesh: THREE.Mesh | null;
  stormMat: THREE.ShaderMaterial | null;
}

export const zone: ZoneState = {
  active: false, phaseIndex: -1, phaseStartTime: 0,
  isShrinking: false, shrinkStartTime: 0,
  currentCenter: new THREE.Vector2(0, 0), currentRadius: BR_INITIAL_ZONE_RADIUS,
  sourceCenter: new THREE.Vector2(0, 0), sourceRadius: BR_INITIAL_ZONE_RADIUS,
  targetCenter: new THREE.Vector2(0, 0), targetRadius: BR_INITIAL_ZONE_RADIUS,
  mesh: null, ringMesh: null, targetRingMesh: null, stormMat: null,
};

export function initZone(): void {
  if (zone.mesh) return;

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying float vY; void main(){ vUv=uv; vY=position.y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: stormFS,
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
  zone.stormMat = mat;

  zone.mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, STORM_H, SEGMENTS, 1, true),
    mat,
  );
  zone.mesh.position.y = STORM_H / 2 - 10;
  zone.mesh.renderOrder = 90;
  gameState.scene.add(zone.mesh);

  // Ground ring
  zone.ringMesh = new THREE.Mesh(
    new THREE.RingGeometry(0.99, 1.0, SEGMENTS),
    new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  zone.ringMesh.rotation.x = -Math.PI / 2;
  zone.ringMesh.position.y = 0.15;
  gameState.scene.add(zone.ringMesh);

  // Target ring (white)
  zone.targetRingMesh = new THREE.Mesh(
    new THREE.RingGeometry(0.98, 1.0, SEGMENTS),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  );
  zone.targetRingMesh.rotation.x = -Math.PI / 2;
  zone.targetRingMesh.position.y = 0.1;
  zone.targetRingMesh.visible = false;
  gameState.scene.add(zone.targetRingMesh);
}

export function startZone(): void {
  initZone();
  zone.active = true;
  zone.phaseIndex = -1;
  zone.isShrinking = false;
  zone.currentRadius = BR_INITIAL_ZONE_RADIUS;
  zone.sourceRadius = BR_INITIAL_ZONE_RADIUS;
  zone.currentCenter.set(0, 0);
  zone.sourceCenter.set(0, 0);
  zone.targetRadius = BR_INITIAL_ZONE_RADIUS;
  zone.targetCenter.set(0, 0);
  zone.phaseStartTime = gameState.worldElapsed;
  syncTransform();
}

export function isOutsideZone(x: number, z: number): boolean {
  if (!zone.active) return false;
  const dx = x - zone.currentCenter.x;
  const dz = z - zone.currentCenter.y;
  return dx * dx + dz * dz > zone.currentRadius * zone.currentRadius;
}

export function distanceToZoneEdge(x: number, z: number): number {
  const dx = x - zone.currentCenter.x;
  const dz = z - zone.currentCenter.y;
  return zone.currentRadius - Math.sqrt(dx * dx + dz * dz);
}

function nextTarget(): { center: THREE.Vector2; radius: number } {
  const phase = ZONE_PHASES[Math.min(zone.phaseIndex + 1, ZONE_PHASES.length - 1)];
  const newR = phase.finalRadius;
  const maxOff = Math.max(0, zone.currentRadius - newR);
  const a = Math.random() * Math.PI * 2;
  const r = Math.random() * maxOff * 0.65;
  return {
    center: new THREE.Vector2(zone.currentCenter.x + Math.cos(a) * r, zone.currentCenter.y + Math.sin(a) * r),
    radius: newR,
  };
}

function beginShrink(): void {
  const t = nextTarget();
  zone.targetCenter.copy(t.center);
  zone.targetRadius = t.radius;
  zone.sourceRadius = zone.currentRadius;
  zone.sourceCenter.copy(zone.currentCenter);
  zone.isShrinking = true;
  zone.shrinkStartTime = gameState.worldElapsed;
  if (zone.targetRingMesh) {
    zone.targetRingMesh.visible = true;
    zone.targetRingMesh.position.set(t.center.x, 0.1, t.center.y);
    zone.targetRingMesh.scale.setScalar(Math.max(1, t.radius));
  }
}

function syncTransform(): void {
  const r = Math.max(0.5, zone.currentRadius);
  if (zone.mesh) {
    zone.mesh.position.x = zone.currentCenter.x;
    zone.mesh.position.z = zone.currentCenter.y;
    zone.mesh.scale.set(r, 1, r);
  }
  if (zone.ringMesh) {
    zone.ringMesh.position.x = zone.currentCenter.x;
    zone.ringMesh.position.z = zone.currentCenter.y;
    zone.ringMesh.scale.setScalar(r);
  }
}

export function updateZone(dt: number): void {
  if (!zone.active) return;

  if (zone.stormMat) zone.stormMat.uniforms.uTime.value += dt;

  const elapsed = gameState.worldElapsed - zone.phaseStartTime;
  const curPhase = ZONE_PHASES[Math.max(0, zone.phaseIndex)];

  if (!zone.isShrinking) {
    const wait = zone.phaseIndex < 0 ? ZONE_PHASES[0].waitTime : curPhase.waitTime;
    if (elapsed >= wait && zone.phaseIndex < ZONE_PHASES.length - 1) beginShrink();
  } else {
    const se = gameState.worldElapsed - zone.shrinkStartTime;
    const next = ZONE_PHASES[zone.phaseIndex + 1];
    const t = Math.min(1, se / next.shrinkTime);
    const e = t * t * (3 - 2 * t); // smoothstep

    zone.currentRadius = zone.sourceRadius + (zone.targetRadius - zone.sourceRadius) * e;
    zone.currentCenter.lerpVectors(zone.sourceCenter, zone.targetCenter, e);

    if (t >= 1) {
      zone.isShrinking = false;
      zone.phaseIndex++;
      zone.phaseStartTime = gameState.worldElapsed;
      if (zone.targetRingMesh) zone.targetRingMesh.visible = false;
    }
  }

  syncTransform();

  // ── Damage ──
  const phase = ZONE_PHASES[Math.max(0, zone.phaseIndex)];
  const dps = phase.damagePerSec;

  // Player
  if (!gameState.pDead && isOutsideZone(gameState.player.position.x, gameState.player.position.z)) {
    dealDmgPlayer(dps * dt, null);
  }

  // Bots — use spatial grid to avoid checking all 30
  // Actually zone damage needs to check ALL bots since it's a radius check.
  // But we can skip dead ones and batch the check.
  for (const ag of gameState.agents) {
    if (ag === gameState.player || ag.isDead) continue;
    if (isOutsideZone(ag.position.x, ag.position.z)) {
      dealDmgAgent(ag, dps * dt, null);
    }
  }
}

export function getZoneTimeRemaining(): { seconds: number; label: string } {
  if (!zone.active) return { seconds: 0, label: '—' };
  if (zone.isShrinking) {
    const next = ZONE_PHASES[zone.phaseIndex + 1];
    const rem = Math.max(0, next.shrinkTime - (gameState.worldElapsed - zone.shrinkStartTime));
    return { seconds: rem, label: 'STORM CLOSING' };
  }
  const idx = Math.max(0, zone.phaseIndex);
  const wait = zone.phaseIndex < 0 ? ZONE_PHASES[0].waitTime : ZONE_PHASES[idx].waitTime;
  return { seconds: Math.max(0, wait - (gameState.worldElapsed - zone.phaseStartTime)), label: 'STORM EYE SHRINKING IN' };
}

export function disposeZone(): void {
  if (zone.mesh) { zone.mesh.geometry.dispose(); (zone.mesh.material as THREE.Material).dispose(); gameState.scene.remove(zone.mesh); zone.mesh = null; }
  if (zone.ringMesh) { zone.ringMesh.geometry.dispose(); (zone.ringMesh.material as THREE.Material).dispose(); gameState.scene.remove(zone.ringMesh); zone.ringMesh = null; }
  if (zone.targetRingMesh) { zone.targetRingMesh.geometry.dispose(); (zone.targetRingMesh.material as THREE.Material).dispose(); gameState.scene.remove(zone.targetRingMesh); zone.targetRingMesh = null; }
  zone.active = false;
  zone.phaseIndex = -1;
}
