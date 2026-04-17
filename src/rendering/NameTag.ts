import * as THREE from 'three';

/**
 * Create a floating name tag sprite using canvas text rendering.
 */
export function makeNameTag(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const hex = '#' + color.toString(16).padStart(6, '0');

  ctx.clearRect(0, 0, 512, 128);

  // Background pill
  ctx.fillStyle = 'rgba(4,12,26,0.75)';
  ctx.strokeStyle = hex;
  ctx.lineWidth = 4;
  const x = 18, y = 16, w = 476, h = 92, r = 14;
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

  // Name text
  ctx.font = '700 38px Orbitron, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8fbff';
  ctx.shadowColor = hex;
  ctx.shadowBlur = 10;
  ctx.fillText(text, 256, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const smat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
  });
  const sprite = new THREE.Sprite(smat);
  sprite.scale.set(1.8, 0.42, 1);
  sprite.renderOrder = 999;

  return sprite;
}
