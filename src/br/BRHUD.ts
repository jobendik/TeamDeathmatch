/**
 * BRHUD — Fortnite-style bright HUD overlay for BR mode.
 * Shows: alive count, zone timer, drop prompts, vehicle UI, kill feed position.
 */

import { gameState } from '@/core/GameState';
import { brState, isBRActive } from './BRController';
import { getZoneTimeRemaining, zone } from './ZoneSystem';
import { drop, isPlayerInAir } from './DropPlane';
import { playerVehicle } from './Vehicles';

let el: HTMLDivElement | null = null;
let styled = false;

function ensure(): void {
  if (el) return;
  el = document.createElement('div');
  el.id = 'brHud';
  el.innerHTML = `
    <div class="brh-alive-wrap">
      <div class="brh-alive-badge">
        <svg class="brh-alive-icon" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15H9v-2h2v2zm0-4H9V7h2v6zm4 4h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        <span class="brh-alive-num" id="brhAlive">30</span>
        <span class="brh-alive-lbl">ALIVE</span>
      </div>
      <div class="brh-elim-badge">
        <span class="brh-elim-num" id="brhElim">0</span>
        <span class="brh-elim-lbl">ELIM</span>
      </div>
    </div>

    <div class="brh-zone-wrap">
      <div class="brh-zone-icon">⚡</div>
      <div class="brh-zone-info">
        <div class="brh-zone-lbl" id="brhZoneLabel">STORM EYE SHRINKING IN</div>
        <div class="brh-zone-timer" id="brhZoneTime">01:20</div>
      </div>
      <div class="brh-zone-bar">
        <div class="brh-zone-bar-fill" id="brhZoneBar" style="width:100%"></div>
      </div>
    </div>

    <div class="brh-center" id="brhCenter"></div>

    <div class="brh-vehicle" id="brhVehicle">
      <div class="brh-veh-name">🚗 OFF-ROAD</div>
      <div class="brh-veh-hp-wrap"><div class="brh-veh-hp" id="brhVehHp"></div></div>
      <div class="brh-veh-speed" id="brhVehSpeed">0</div>
      <div class="brh-veh-unit">KM/H</div>
      <div class="brh-veh-exit"><kbd>F</kbd> EXIT</div>
    </div>
  `;
  document.body.appendChild(el);
  injectStyle();
}

function injectStyle(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.id = 'brHudCSS';
  s.textContent = `
#brHud { position:fixed; inset:0; pointer-events:none; z-index:11; font-family:'Burbank Big Condensed','Exo 2','Orbitron',system-ui,sans-serif; }

/* ── Alive counter (top-right like Fortnite) ── */
.brh-alive-wrap {
  position:absolute; top:18px; right:18px;
  display:flex; gap:8px;
}
.brh-alive-badge, .brh-elim-badge {
  display:flex; align-items:center; gap:8px;
  padding:10px 18px;
  background:linear-gradient(135deg, rgba(30,40,60,0.88), rgba(15,20,35,0.92));
  border:1.5px solid rgba(255,255,255,0.15);
  border-radius:8px;
  backdrop-filter:blur(12px);
  box-shadow:0 4px 20px rgba(0,0,0,0.4);
}
.brh-alive-icon { color:#4aa8ff; }
.brh-alive-num {
  font-size:24px; font-weight:900; color:#fff;
  text-shadow:0 0 14px rgba(74,168,255,0.7);
  letter-spacing:0.04em;
}
.brh-alive-lbl { font-size:10px; color:rgba(255,255,255,0.55); letter-spacing:0.15em; font-weight:700; }
.brh-elim-badge { border-color:rgba(255,200,51,0.3); }
.brh-elim-num {
  font-size:24px; font-weight:900; color:#ffc233;
  text-shadow:0 0 14px rgba(255,194,51,0.6);
}
.brh-elim-lbl { font-size:10px; color:rgba(255,200,51,0.55); letter-spacing:0.15em; font-weight:700; }

/* ── Zone timer (top-center, below compass) ── */
.brh-zone-wrap {
  position:absolute; top:100px; left:50%; transform:translateX(-50%);
  display:flex; align-items:center; gap:12px;
  padding:8px 22px;
  background:linear-gradient(135deg, rgba(100,30,140,0.75), rgba(50,15,80,0.85));
  border:1.5px solid rgba(180,80,255,0.4);
  border-radius:8px;
  backdrop-filter:blur(8px);
  min-width:260px;
}
.brh-zone-icon { font-size:18px; filter:drop-shadow(0 0 6px rgba(180,80,255,0.8)); }
.brh-zone-info { flex:1; }
.brh-zone-lbl {
  font-size:9px; font-weight:700; letter-spacing:0.18em;
  color:rgba(220,180,255,0.8);
}
.brh-zone-lbl.shrinking { color:#ff60a0; animation:brhPulse 0.8s ease-in-out infinite; }
@keyframes brhPulse { 0%,100%{opacity:1;} 50%{opacity:0.4;} }
.brh-zone-timer {
  font-size:22px; font-weight:900; color:#fff;
  text-shadow:0 0 12px rgba(180,80,255,0.7);
  letter-spacing:0.06em;
  margin-top:2px;
}
.brh-zone-bar {
  position:absolute; bottom:0; left:0; right:0; height:3px;
  background:rgba(255,255,255,0.1); border-radius:0 0 8px 8px;
  overflow:hidden;
}
.brh-zone-bar-fill {
  height:100%; background:linear-gradient(90deg, #d040ff, #8040ff);
  transition:width 0.5s linear;
}

/* ── Center prompts (jump/chute/victory) ── */
.brh-center {
  position:absolute; top:38%; left:50%; transform:translateX(-50%);
  font-size:28px; font-weight:900;
  letter-spacing:0.18em;
  text-align:center;
  opacity:0; transition:opacity 0.4s;
  pointer-events:none;
}
.brh-center.on { opacity:1; }
.brh-center.victory {
  font-size:42px;
  background:linear-gradient(135deg, #ffc233, #ff8833);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent;
  filter:drop-shadow(0 0 30px rgba(255,194,51,0.8));
  animation:victoryPulse 2s ease-in-out infinite;
}
@keyframes victoryPulse { 0%,100%{transform:translateX(-50%) scale(1);} 50%{transform:translateX(-50%) scale(1.05);} }
.brh-center.defeat { color:#ff5c5c; text-shadow:0 0 20px rgba(255,60,60,0.8); }
.brh-center.prompt {
  color:#fff; text-shadow:0 0 16px rgba(255,255,255,0.6);
  font-size:20px;
}
.brh-center.prompt kbd {
  display:inline-block; padding:4px 14px;
  background:rgba(255,200,51,0.2); border:2px solid rgba(255,200,51,0.6);
  border-radius:6px; color:#ffc233; font-size:18px; font-weight:900;
  margin:0 6px; text-shadow:none;
  -webkit-text-fill-color:#ffc233;
}

/* ── Vehicle panel ── */
.brh-vehicle {
  position:absolute; bottom:200px; right:20px;
  display:none; flex-direction:column; align-items:center; gap:4px;
  padding:14px 20px;
  background:linear-gradient(135deg, rgba(30,40,60,0.88), rgba(15,20,35,0.92));
  border:1.5px solid rgba(255,170,51,0.35);
  border-radius:8px;
  min-width:150px;
}
.brh-vehicle.on { display:flex; }
.brh-veh-name { font-size:10px; color:#ffaa33; letter-spacing:0.18em; font-weight:700; }
.brh-veh-hp-wrap { width:100%; height:5px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden; margin:4px 0; }
.brh-veh-hp { height:100%; background:linear-gradient(90deg,#ef4444,#ffaa33,#22d66a); transition:width 0.2s; }
.brh-veh-speed { font-size:28px; font-weight:900; color:#fff; }
.brh-veh-unit { font-size:9px; color:rgba(255,255,255,0.5); letter-spacing:0.2em; margin-top:-2px; }
.brh-veh-exit { font-size:10px; color:rgba(255,255,255,0.5); margin-top:8px; }
.brh-veh-exit kbd {
  display:inline-block; padding:2px 8px;
  background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2);
  border-radius:3px; color:#fff; font-size:9px; font-weight:700;
}
  `;
  document.head.appendChild(s);
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function updateBRHUD(): void {
  if (!isBRActive()) {
    if (el) el.style.display = 'none';
    return;
  }
  ensure();
  if (el) el.style.display = 'block';

  // Alive count
  const aliveEl = document.getElementById('brhAlive');
  if (aliveEl) aliveEl.textContent = String(brState.playersAlive);

  // Elim count
  const elimEl = document.getElementById('brhElim');
  if (elimEl) elimEl.textContent = String(gameState.pKills);

  // Zone timer
  const zt = getZoneTimeRemaining();
  const timeEl = document.getElementById('brhZoneTime');
  const lblEl = document.getElementById('brhZoneLabel');
  const barEl = document.getElementById('brhZoneBar');
  if (timeEl) timeEl.textContent = fmtTime(zt.seconds);
  if (lblEl) {
    lblEl.textContent = zt.label;
    lblEl.classList.toggle('shrinking', zt.label === 'STORM CLOSING');
  }
  // Bar fill based on phase progress
  if (barEl) {
    const total = zone.isShrinking
      ? (zone.phaseIndex + 1 < 5 ? 1 : 0)
      : 1;
    barEl.style.width = `${Math.max(0, zt.seconds / Math.max(1, 80) * 100)}%`;
  }

  // Center prompts
  const center = document.getElementById('brhCenter');
  if (center) {
    if (drop.state === 'onPlane') {
      center.innerHTML = `<kbd>SPACE</kbd> JUMP`;
      center.className = 'brh-center on prompt';
    } else if (drop.state === 'freefall') {
      center.innerHTML = `<kbd>SPACE</kbd> DEPLOY GLIDER`;
      center.className = 'brh-center on prompt';
    } else if (brState.phase === 'over') {
      if (brState.winnerName === 'YOU') {
        center.textContent = '#1 VICTORY ROYALE';
        center.className = 'brh-center on victory';
      } else {
        center.textContent = `${brState.winnerName} WINS`;
        center.className = 'brh-center on defeat';
      }
    } else {
      center.className = 'brh-center';
    }
  }

  // Vehicle
  const vehEl = el?.querySelector('.brh-vehicle') as HTMLElement | null;
  if (playerVehicle) {
    if (vehEl) vehEl.classList.add('on');
    const hp = document.getElementById('brhVehHp');
    const spd = document.getElementById('brhVehSpeed');
    if (hp) hp.style.width = `${(playerVehicle.health / playerVehicle.maxHealth) * 100}%`;
    if (spd) spd.textContent = String(Math.round(Math.abs(playerVehicle.speed) * 3.6));
  } else {
    if (vehEl) vehEl.classList.remove('on');
  }
}
