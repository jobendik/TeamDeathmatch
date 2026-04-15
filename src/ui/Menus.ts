import { gameState } from '@/core/GameState';
import { dom } from './DOMElements';
import { getModeDefaults, getModeLabel, type GameMode } from '@/core/GameModes';
import { resetMatch } from '@/combat/Combat';

function setMainMenuVisible(on: boolean): void {
  dom.mainMenu.classList.toggle('on', on);
  gameState.mainMenuOpen = on;
  dom.lockHint.classList.toggle('on', !on && !gameState.mouseLocked && !gameState.paused && !gameState.roundOver);
}

export function startMatchFromMenu(): void {
  const mode = (dom.modeSelect.value || 'tdm') as GameMode;
  const defaults = getModeDefaults(mode);
  gameState.mode = mode;
  gameState.matchTime = defaults.matchTime;
  gameState.scoreLimit = defaults.scoreLimit;
  setMainMenuVisible(false);
  gameState.paused = false;
  resetMatch(mode);
  setTimeout(() => {
    gameState.renderer?.domElement?.requestPointerLock();
  }, 60);
}

export function togglePause(force?: boolean): void {
  if (gameState.mainMenuOpen || gameState.roundOver) return;
  gameState.paused = typeof force === 'boolean' ? force : !gameState.paused;
  dom.pauseMenu.classList.toggle('on', gameState.paused);
  if (gameState.paused) {
    document.exitPointerLock?.();
    dom.lockHint.classList.remove('on');
  } else {
    setTimeout(() => gameState.renderer?.domElement?.requestPointerLock(), 30);
  }
}

export function initMenus(): void {
  dom.startBtn.onclick = () => startMatchFromMenu();
  dom.modeSelect.onchange = () => updateMenuCopy();
  dom.pauseResume.onclick = () => togglePause(false);
  dom.pauseRestart.onclick = () => { togglePause(false); resetMatch(gameState.mode); };
  dom.pauseQuit.onclick = () => {
    gameState.paused = false;
    dom.pauseMenu.classList.remove('on');
    setMainMenuVisible(true);
    document.exitPointerLock?.();
  };
  updateMenuCopy();
  setMainMenuVisible(true);
}


function updateMenuCopy(): void {
  const mode = (dom.modeSelect.value || 'tdm') as GameMode;
  const label = getModeLabel(mode);
  dom.startBtn.textContent = `START ${label}`;
}
