import { gameState } from '@/core/GameState';
import { dom } from './DOMElements';
import { getModeDefaults, getModeLabel, type GameMode } from '@/core/GameModes';
import { resetMatch } from '@/combat/Combat';
import { Audio } from '@/audio/AudioManager';
import type { BotClass } from '@/config/classes';
import { preloadBRModules } from '@/core/GameLoop';
import { startBRMatch, cleanupBR } from '@/br/BRController';
import { rollChallenges } from '@/ui/Challenges';
import { resetMatchMedals } from '@/ui/Medals';
import { rebuildWaypoints } from '@/ui/Waypoints';
import { startDynamicMusic, playMusicState, stopDynamicMusic } from '@/audio/DynamicMusic';

function setMainMenuVisible(on: boolean): void {
  dom.mainMenu.classList.toggle('on', on);
  gameState.mainMenuOpen = on;
  dom.lockHint.classList.toggle('on', !on && !gameState.mouseLocked && !gameState.paused && !gameState.roundOver);
}

export async function startMatchFromMenu(): Promise<void> {
  const mode = (dom.modeSelect.value || 'tdm') as GameMode;
  const playerClass = (dom.classSelect.value || 'rifleman') as BotClass;
  const defaults = getModeDefaults(mode);
  gameState.mode = mode;
  gameState.pClass = playerClass;
  gameState.matchTime = defaults.matchTime;
  gameState.scoreLimit = defaults.scoreLimit;
  setMainMenuVisible(false);
  gameState.paused = false;

  if (mode === 'br') {
    await preloadBRModules();
    await startBRMatch();
  } else {
    cleanupBR();
    resetMatch(mode);
    resetMatchMedals();
    rollChallenges(3);
  }

  rebuildWaypoints();

  startDynamicMusic();
  Audio.startEnvironmentAmbience();

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
  dom.pauseRestart.onclick = () => { togglePause(false); resetMatch(gameState.mode); resetMatchMedals(); rollChallenges(3); };
  dom.pauseQuit.onclick = () => {
    gameState.paused = false;
    dom.pauseMenu.classList.remove('on');
    setMainMenuVisible(true);
    document.exitPointerLock?.();
    stopDynamicMusic();
    playMusicState('lobby');
  };
  updateMenuCopy();
  setMainMenuVisible(true);

  // Try playing lobby music on first interact
  const startLobbyMusic = () => {
    if (!Audio.ctx) Audio.init();
    if (gameState.mainMenuOpen) {
      playMusicState('lobby');
    }
    document.removeEventListener('click', startLobbyMusic);
  };
  document.addEventListener('click', startLobbyMusic);
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
