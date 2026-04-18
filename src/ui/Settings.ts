import { FP } from '@/config/player';
import { dom } from './DOMElements';
import { Audio } from '@/audio/AudioManager';
import { movement } from '@/movement/MovementController';
import { gameState } from '@/core/GameState';

const STORAGE_KEY = 'warzone_settings';

interface GameSettings {
  sensitivity: number;
  fov: number;
  masterVol: number;
  sfxVol: number;
  musicVol: number;
  headBobScale: number;
  crosshairColor: string;
  crosshairSize: number;
  crosshairDot: boolean;
  botDifficulty: number;
  colorblindMode: string;
  showFPS: boolean;
  showSubtitles: boolean;
}

const defaults: GameSettings = {
  sensitivity: 0.0022,
  fov: 78,
  masterVol: 0.7,
  sfxVol: 1,
  musicVol: 0.5,
  headBobScale: 1,
  crosshairColor: '#f0faff',
  crosshairSize: 1,
  crosshairDot: true,
  botDifficulty: 0.5,
  colorblindMode: 'off',
  showFPS: false,
  showSubtitles: true,
};

let current: GameSettings = { ...defaults };

export function loadSettings(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      current = { ...defaults, ...parsed };
    }
  } catch { /* ignore */ }
  applySettings();
}

function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch { /* ignore */ }
}

function applySettings(): void {
  FP.sensitivity = current.sensitivity;
  movement.fovBase = current.fov;
  movement.fovTarget = current.fov;
  movement.fovCurrent = current.fov;
  movement.headBobScale = current.headBobScale;
  Audio.setMaster(current.masterVol);
  Audio.setSfx(current.sfxVol);
  Audio.setMusic(current.musicVol);

  // Crosshair settings
  gameState.crosshairColor = current.crosshairColor;
  gameState.crosshairSize = current.crosshairSize;
  gameState.crosshairDot = current.crosshairDot;
  const xh = document.getElementById('xh');
  if (xh) {
    xh.style.setProperty('--xh-color', current.crosshairColor);
    xh.style.transform = `scale(${current.crosshairSize})`;
    const dot = xh.querySelector('.xh-dot') as HTMLElement | null;
    if (dot) dot.style.display = current.crosshairDot ? '' : 'none';
  }

  // Bot difficulty
  gameState.botDifficulty = current.botDifficulty;

  // Colorblind mode
  gameState.colorblindMode = current.colorblindMode as any;
  document.body.classList.remove('cb-deuteranopia', 'cb-protanopia', 'cb-tritanopia');
  if (current.colorblindMode !== 'off') {
    document.body.classList.add(`cb-${current.colorblindMode}`);
  }

  // FPS counter
  gameState.showFPS = current.showFPS;
  const fpsEl = dom.fpsCounter;
  if (fpsEl) fpsEl.classList.toggle('hidden', !current.showFPS);

  // Subtitles
  gameState.showSubtitles = current.showSubtitles;
}

export function initSettings(): void {
  loadSettings();

  // Sync sliders to current values
  dom.setSensitivity.value = String(current.sensitivity);
  dom.valSens.textContent = current.sensitivity.toFixed(4);
  dom.setFOV.value = String(current.fov);
  dom.valFOV.textContent = String(current.fov);
  dom.setMasterVol.value = String(current.masterVol);
  dom.valMasterVol.textContent = Math.round(current.masterVol * 100) + '%';
  dom.setSfxVol.value = String(current.sfxVol);
  dom.valSfxVol.textContent = Math.round(current.sfxVol * 100) + '%';
  dom.setMusicVol.value = String(current.musicVol);
  dom.valMusicVol.textContent = Math.round(current.musicVol * 100) + '%';
  dom.setHeadBob.value = String(current.headBobScale);
  dom.valHeadBob.textContent = Math.round(current.headBobScale * 100) + '%';

  // Bind sliders
  dom.setSensitivity.oninput = () => {
    current.sensitivity = parseFloat(dom.setSensitivity.value);
    dom.valSens.textContent = current.sensitivity.toFixed(4);
    applySettings();
    saveSettings();
  };
  dom.setFOV.oninput = () => {
    current.fov = parseInt(dom.setFOV.value);
    dom.valFOV.textContent = String(current.fov);
    applySettings();
    saveSettings();
  };
  dom.setMasterVol.oninput = () => {
    current.masterVol = parseFloat(dom.setMasterVol.value);
    dom.valMasterVol.textContent = Math.round(current.masterVol * 100) + '%';
    applySettings();
    saveSettings();
  };
  dom.setSfxVol.oninput = () => {
    current.sfxVol = parseFloat(dom.setSfxVol.value);
    dom.valSfxVol.textContent = Math.round(current.sfxVol * 100) + '%';
    applySettings();
    saveSettings();
  };
  dom.setMusicVol.oninput = () => {
    current.musicVol = parseFloat(dom.setMusicVol.value);
    dom.valMusicVol.textContent = Math.round(current.musicVol * 100) + '%';
    applySettings();
    saveSettings();
  };
  dom.setHeadBob.oninput = () => {
    current.headBobScale = parseFloat(dom.setHeadBob.value);
    dom.valHeadBob.textContent = Math.round(current.headBobScale * 100) + '%';
    applySettings();
    saveSettings();
  };

  // ── Crosshair settings ──
  dom.setCrosshairColor.value = current.crosshairColor;
  dom.valCrosshairColor.textContent = current.crosshairColor;
  dom.setCrosshairColor.oninput = () => {
    current.crosshairColor = dom.setCrosshairColor.value;
    dom.valCrosshairColor.textContent = current.crosshairColor;
    applySettings();
    saveSettings();
  };

  dom.setCrosshairSize.value = String(current.crosshairSize);
  dom.valCrosshairSize.textContent = current.crosshairSize.toFixed(1);
  dom.setCrosshairSize.oninput = () => {
    current.crosshairSize = parseFloat(dom.setCrosshairSize.value);
    dom.valCrosshairSize.textContent = current.crosshairSize.toFixed(1);
    applySettings();
    saveSettings();
  };

  dom.setCrosshairDot.checked = current.crosshairDot;
  dom.setCrosshairDot.onchange = () => {
    current.crosshairDot = dom.setCrosshairDot.checked;
    applySettings();
    saveSettings();
  };

  // ── Bot difficulty ──
  dom.setBotDifficulty.value = String(current.botDifficulty);
  dom.valBotDifficulty.textContent = Math.round(current.botDifficulty * 100) + '%';
  dom.setBotDifficulty.oninput = () => {
    current.botDifficulty = parseFloat(dom.setBotDifficulty.value);
    dom.valBotDifficulty.textContent = Math.round(current.botDifficulty * 100) + '%';
    applySettings();
    saveSettings();
  };

  // ── Colorblind mode ──
  dom.setColorblind.value = current.colorblindMode;
  dom.setColorblind.onchange = () => {
    current.colorblindMode = dom.setColorblind.value;
    applySettings();
    saveSettings();
  };

  // ── Show FPS ──
  dom.setShowFPS.checked = current.showFPS;
  dom.setShowFPS.onchange = () => {
    current.showFPS = dom.setShowFPS.checked;
    applySettings();
    saveSettings();
  };

  // ── Show Subtitles ──
  dom.setShowSubtitles.checked = current.showSubtitles;
  dom.setShowSubtitles.onchange = () => {
    current.showSubtitles = dom.setShowSubtitles.checked;
    applySettings();
    saveSettings();
  };

  // Back button
  dom.settingsBack.onclick = () => {
    dom.settingsMenu.classList.remove('on');
    dom.pauseMenu.classList.add('on');
  };

  // Settings button in pause menu
  dom.pauseSettings.onclick = () => {
    dom.pauseMenu.classList.remove('on');
    dom.settingsMenu.classList.add('on');
  };
}
