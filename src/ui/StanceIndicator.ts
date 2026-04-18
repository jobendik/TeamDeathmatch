import { movement } from '@/movement/MovementController';
import { gameState } from '@/core/GameState';

let el: HTMLDivElement | null = null;
let _stand: HTMLElement | null = null;
let _crouch: HTMLElement | null = null;
let _lean: HTMLElement | null = null;
let _ads: HTMLElement | null = null;

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
  _stand = el.querySelector('#siStand');
  _crouch = el.querySelector('#siCrouch');
  _lean = el.querySelector('#siLean');
  _ads = el.querySelector('#siAds');
  return el;
}

export function updateStanceIndicator(): void {
  ensure();
  _stand!.classList.toggle('active', !movement.isCrouching && !movement.isSliding);
  _crouch!.classList.toggle('active', movement.isCrouching);
  _lean!.classList.toggle('active', Math.abs(movement.leanT) > 0.3);
  _ads!.classList.toggle('active', gameState.isADS);
}