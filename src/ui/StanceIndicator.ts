import { movement } from '@/movement/MovementController';
import { gameState } from '@/core/GameState';

let el: HTMLDivElement | null = null;

function ensure(): HTMLDivElement {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'stanceIndicator';
  el.innerHTML = `
    <div class="stance-icon" id="siStand">⏶</div>
    <div class="stance-icon" id="siCrouch">⏷</div>
    <div class="stance-icon" id="siLean">⟷</div>
    <div class="stance-icon" id="siAds">●</div>
  `;
  document.body.appendChild(el);
  return el;
}

export function updateStanceIndicator(): void {
  ensure();
  document.getElementById('siStand')!.classList.toggle('active', !movement.isCrouching && !movement.isSliding);
  document.getElementById('siCrouch')!.classList.toggle('active', movement.isCrouching);
  document.getElementById('siLean')!.classList.toggle('active', Math.abs(movement.leanT) > 0.3);
  document.getElementById('siAds')!.classList.toggle('active', gameState.isADS);
}