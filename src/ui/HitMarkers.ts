import { dom } from './DOMElements';

let hitTimer: ReturnType<typeof setTimeout>;
let killTimer: ReturnType<typeof setTimeout>;

export function showHitMarker(isHeadshot = false): void {
  const el = dom.xhHit;
  if (!el) return;
  el.classList.remove('on');
  // Force reflow to restart animation
  void (el as HTMLElement).offsetWidth;
  el.classList.add('on');
  if (isHeadshot) {
    (el.style as any).filter = 'hue-rotate(30deg) brightness(1.3)';
  } else {
    (el.style as any).filter = '';
  }
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
