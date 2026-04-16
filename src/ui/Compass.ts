import { gameState } from '@/core/GameState';
import { dom } from './DOMElements';

let built = false;
const TICK_SPACING = 5; // degrees per tick
const STRIP_WIDTH = 720; // pixels per 360°

function buildStrip(): void {
  const strip = dom.compassStrip;
  if (!strip) return;

  // Duplicated 3× for seamless scroll
  let html = '';
  for (let rep = -1; rep <= 1; rep++) {
    for (let deg = 0; deg < 360; deg += TICK_SPACING) {
      const x = (rep * STRIP_WIDTH) + (deg / 360) * STRIP_WIDTH;
      const isMajor = deg % 45 === 0;
      const label = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[deg];

      html += `<div class="compass-tick${isMajor ? ' major' : ''}" style="left:${x}px"></div>`;
      if (label) {
        html += `<div class="compass-label cardinal" style="left:${x}px;top:50%">${label}</div>`;
      } else if (deg % 15 === 0) {
        html += `<div class="compass-label" style="left:${x}px;top:50%">${deg}</div>`;
      }
    }
  }
  strip.innerHTML = html;
  strip.style.width = `${STRIP_WIDTH * 3}px`;
  built = true;
}

export function updateCompass(): void {
  if (!built) buildStrip();
  const strip = dom.compassStrip;
  if (!strip) return;

  // Camera yaw: north (-Z) should show as "N"
  // Convert yaw so yaw=0 points south (in our camera.rotation.order='YXZ')
  const yaw = gameState.cameraYaw;
  let deg = ((-yaw * 180) / Math.PI) % 360;
  if (deg < 0) deg += 360;

  // Strip is 3× wide, centered; we want the current heading at pixel width/2
  const parentW = strip.parentElement?.clientWidth ?? 280;
  const offset = -(deg / 360) * STRIP_WIDTH - STRIP_WIDTH + parentW / 2;
  strip.style.transform = `translateX(${offset}px)`;
}
