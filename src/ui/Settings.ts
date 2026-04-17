import { FP } from '@/config/player';
import { dom } from './DOMElements';
import { Audio } from '@/audio/AudioManager';
import { movement } from '@/movement/MovementController';

const STORAGE_KEY = 'warzone_settings';

interface GameSettings {
  sensitivity: number;
  fov: number;
  masterVol: number;
  sfxVol: number;
  musicVol: number;
}

const defaults: GameSettings = {
  sensitivity: 0.0022,
  fov: 78,
  masterVol: 0.7,
  sfxVol: 1,
  musicVol: 0.5,
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
  Audio.setMaster(current.masterVol);
  Audio.setSfx(current.sfxVol);
  Audio.setMusic(current.musicVol);
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
