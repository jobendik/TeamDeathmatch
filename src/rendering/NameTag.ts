import * as THREE from 'three';

/**
 * Floating name tag sprite.
 * Kept intentionally compact because large world-space sprites become
 * obnoxious in first-person when an agent is close to the camera.
 */
export function makeNameTag(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;

  const ctx = canvas.getContext('2d')!;
  const hex = '#' + color.toString(16).padStart(6, '0');

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background
  ctx.fillStyle = 'rgba(4,12,26,0.58)';
  ctx.strokeStyle = hex;
  ctx.lineWidth = 3;

  const x = 12, y = 12, w = 360, h = 72, r = 12;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Text
  ctx.font = '700 28px Orbitron, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8fbff';
  ctx.shadowColor = hex;
  ctx.shadowBlur = 8;
  ctx.fillText(text, canvas.width * 0.5, canvas.height * 0.5);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    opacity: 0.92,
  });

  const sprite = new THREE.Sprite(mat);

  // Base scale; final scale is adjusted every frame in GameLoop.
  sprite.scale.set(0.9, 0.22, 1);
  sprite.renderOrder = 20;

  return sprite;
}
