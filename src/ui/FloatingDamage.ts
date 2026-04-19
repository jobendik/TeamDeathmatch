import * as THREE from 'three';
import { gameState } from '@/core/GameState';

interface FloatingNumber {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  isCrit: boolean;
  isKill: boolean;
}

const active: FloatingNumber[] = [];
const POOL_SIZE = 40;
const pool: THREE.Sprite[] = [];
let poolInited = false;
let warmupSprite: THREE.Sprite | null = null;

const blankDamageTexture = new THREE.DataTexture(
  new Uint8Array([255, 255, 255, 0]),
  1,
  1,
  THREE.RGBAFormat,
);
blankDamageTexture.needsUpdate = true;

function createDamageSprite(): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    map: blankDamageTexture,
  }));
  sprite.renderOrder = 30;
  sprite.visible = false;
  return sprite;
}

export function initFloatingDamagePool(): void {
  if (poolInited) return;
  poolInited = true;
  for (let i = 0; i < POOL_SIZE; i++) {
    pool.push(createDamageSprite());
  }
}

export function attachFloatingDamageWarmupProxy(): void {
  if (warmupSprite || !gameState.scene || !gameState.camera) return;
  initFloatingDamagePool();
  warmupSprite = createDamageSprite();
  warmupSprite.visible = true;
  warmupSprite.position.copy(gameState.camera.position);
  warmupSprite.position.z -= 2;
  warmupSprite.position.y += 1.2;
  warmupSprite.scale.set(1.2, 0.6, 1);
  gameState.scene.add(warmupSprite);
}

export function detachFloatingDamageWarmupProxy(): void {
  if (!warmupSprite) return;
  gameState.scene.remove(warmupSprite);
  const material = warmupSprite.material as THREE.SpriteMaterial;
  if (material.map && material.map !== blankDamageTexture) material.map.dispose();
  material.dispose();
  warmupSprite = null;
}

function makeTextTexture(text: string, color: string, size: number, glow: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.font = `900 ${size}px Orbitron, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Glow pass
  ctx.shadowColor = glow;
  ctx.shadowBlur = 24;
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 64);

  // Sharp core pass
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 4;
  ctx.strokeText(text, 128, 64);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function acquireSprite(): THREE.Sprite {
  if (!poolInited) initFloatingDamagePool();
  const s = pool.pop();
  if (s) { s.visible = true; return s; }
  return createDamageSprite();
}

function releaseSprite(s: THREE.Sprite): void {
  s.visible = false;
  const mat = s.material as THREE.SpriteMaterial;
  if (mat.map && mat.map !== blankDamageTexture) mat.map.dispose();
  mat.map = blankDamageTexture;
  mat.opacity = 1;
  pool.push(s);
  gameState.scene.remove(s);
}

export interface DamagePopupOpts {
  amount: number;
  isHeadshot?: boolean;
  isKill?: boolean;
  isArmor?: boolean;
  isFalloff?: boolean;
}

export function spawnDamageNumber(worldPos: THREE.Vector3, opts: DamagePopupOpts): void {
  if (active.length >= POOL_SIZE) {
    // Recycle oldest
    const oldest = active.shift();
    if (oldest) releaseSprite(oldest.sprite);
  }

  let text: string;
  let color: string;
  let glow: string;
  let fontSize: number;
  let scaleBase: number;

  if (opts.isKill) {
    text = 'ELIMINATED';
    color = '#ffffff';
    glow = '#ff3355';
    fontSize = 36;
    scaleBase = 2.2;
  } else if (opts.isHeadshot) {
    text = `${Math.round(opts.amount)}`;
    color = '#ffdc3b';
    glow = '#ff8800';
    fontSize = 52;
    scaleBase = 1.7;
  } else if (opts.isArmor) {
    text = `${Math.round(opts.amount)}`;
    color = '#7dd3ff';
    glow = '#1e6bff';
    fontSize = 42;
    scaleBase = 1.3;
  } else if (opts.isFalloff) {
    text = `${Math.round(opts.amount)}`;
    color = '#aaaaaa';
    glow = '#666666';
    fontSize = 36;
    scaleBase = 1.0;
  } else {
    text = `${Math.round(opts.amount)}`;
    color = '#fff3d6';
    glow = '#ff6600';
    fontSize = 44;
    scaleBase = 1.35;
  }

  const sprite = acquireSprite();
  const mat = sprite.material as THREE.SpriteMaterial;
  if (mat.map && mat.map !== blankDamageTexture) mat.map.dispose();
  mat.map = makeTextTexture(text, color, fontSize, glow);
  mat.opacity = 1;

  sprite.position.set(
    worldPos.x + (Math.random() - 0.5) * 0.5,
    worldPos.y + 1.6 + Math.random() * 0.2,
    worldPos.z + (Math.random() - 0.5) * 0.5,
  );
  sprite.scale.set(scaleBase, scaleBase * 0.5, 1);
  gameState.scene.add(sprite);

  const life = opts.isKill ? 1.8 : 0.9;
  active.push({
    sprite,
    vel: new THREE.Vector3(
      (Math.random() - 0.5) * 1.5,
      2.8 + Math.random() * 0.8,
      (Math.random() - 0.5) * 1.5,
    ),
    life,
    maxLife: life,
    isCrit: !!opts.isHeadshot,
    isKill: !!opts.isKill,
  });
}

export function updateFloatingDamage(dt: number): void {
  for (let i = active.length - 1; i >= 0; i--) {
    const n = active[i];
    n.life -= dt;

    if (n.life <= 0) {
      releaseSprite(n.sprite);
      active.splice(i, 1);
      continue;
    }

    const t = n.life / n.maxLife;
    const risen = 1 - t;

    // Upward float with slight gravity
    n.vel.y -= 3.5 * dt;
    n.sprite.position.x += n.vel.x * dt;
    n.sprite.position.y += n.vel.y * dt;
    n.sprite.position.z += n.vel.z * dt;

    // Pop-in scale curve (overshoot at start, settle, fade shrink)
    const pop = risen < 0.15
      ? 1 + (1 - risen / 0.15) * 0.4          // overshoot briefly
      : t < 0.25 ? t / 0.25 : 1;              // shrink at end

    const baseScale = n.isKill ? 2.2 : (n.isCrit ? 1.7 : 1.35);
    n.sprite.scale.set(baseScale * pop, baseScale * 0.5 * pop, 1);

    // Fade out in final third
    (n.sprite.material as THREE.SpriteMaterial).opacity = t < 0.3 ? t / 0.3 : 1;
  }
}

export function clearFloatingDamage(): void {
  for (const n of active) releaseSprite(n.sprite);
  active.length = 0;
}