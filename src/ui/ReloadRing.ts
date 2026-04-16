import { gameState } from '@/core/GameState';
import { dom } from './DOMElements';

const CIRC = 176; // 2*PI*28 roughly

export function updateReloadRing(): void {
  const ring = dom.xhReload;
  const fill = dom.xhReloadFill;
  if (!ring || !fill) return;

  if (gameState.pReloading) {
    const t = Math.min(1, gameState.pReloadTimer / gameState.pReloadDuration);
    ring.classList.add('on');
    (fill as any).setAttribute('stroke-dashoffset', String(CIRC * (1 - t)));
  } else {
    ring.classList.remove('on');
  }
}
