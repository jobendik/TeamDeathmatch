import { gameState } from '@/core/GameState';
import { dom } from './DOMElements';
import { getModeDefaults, getModeLabel, type GameMode } from '@/core/GameModes';
import { resetMatch } from '@/combat/Combat';

function setMainMenuVisible(on: boolean): void {
  dom.mainMenu.classList.toggle('on', on);
  gameState.mainMenuOpen = on;
  dom.lockHint.classList.toggle('on', !on && !gameState.mouseLocked && !gameState.paused && !gameState.roundOver);
}

export async function startMatchFromMenu(): Promise<void> {
  const mode = (dom.modeSelect.value || 'tdm') as GameMode;
  const defaults = getModeDefaults(mode);
  gameState.mode = mode;
  gameState.matchTime = defaults.matchTime;
  gameState.scoreLimit = defaults.scoreLimit;
  setMainMenuVisible(false);
  gameState.paused = false;

  if (mode === 'br') {
    const { preloadBRModules } = await import('@/core/GameLoop');
    await preloadBRModules();
    const br = await import('@/br/BRController');
    await br.startBRMatch();
  } else {
    const br = await import('@/br/BRController');
    br.cleanupBR();
    resetMatch(mode);
  }

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

const MODE_DESCRIPTIONS: Record<GameMode, string> = {
  tdm: 'Team Deathmatch — first to 20 kills. You start armed.',
  ffa: 'Free For All — start with a knife and loot the map.',
  ctf: 'Capture The Flag — steal the enemy flag and bring it home.',
  elimination: 'Elimination — no respawns. Last team alive wins the round. First to 3.',
  br: 'Battle Royale — large map, loot weapons, last one standing wins.',
};

function updateMenuCopy(): void {
  const mode = (dom.modeSelect.value || 'tdm') as GameMode;
  const label = getModeLabel(mode);
  dom.startBtn.textContent = `DEPLOY ${label}`;

  const descEl = dom.mainMenu.querySelector('.menu-panel p.menu-sub') as HTMLElement | null
              ?? dom.mainMenu.querySelector('.menu-panel p') as HTMLElement | null;
  if (descEl) {
    descEl.textContent = MODE_DESCRIPTIONS[mode] || '';
  }
}
