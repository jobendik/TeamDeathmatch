import { dom } from './DOMElements';
import { playHitmarkerSound } from '@/audio/SoundHooks';

let hitTimer: ReturnType<typeof setTimeout>;
let killTimer: ReturnType<typeof setTimeout>;

export function showHitMarker(isHeadshot = false, isWallbang = false): void {
  const el = dom.xhHit;
  if (!el) return;
  el.classList.remove('on', 'wallbang');
  // Force reflow to restart animation
  void (el as HTMLElement).offsetWidth;
  el.classList.add('on');
  if (isWallbang) {
    el.classList.add('wallbang');
    (el.style as any).filter = 'brightness(1.2)';
  } else if (isHeadshot) {
    (el.style as any).filter = 'hue-rotate(30deg) brightness(1.3)';
  } else {
    (el.style as any).filter = '';
  }
  playHitmarkerSound(isHeadshot);
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => el.classList.remove('on'), 350);
}

export function showKillMarker(): void {
  const el = dom.xhKill;
  if (!el) return;
  el.classList.remove('on');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('on');
  clearTimeout(killTimer);
  killTimer = setTimeout(() => el.classList.remove('on'), 550);
}
