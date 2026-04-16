/**
 * BRController — Match state machine with LOD-aware bot updates.
 *
 * Performance: the main updateBR() drives LOD checks so that
 * updateAI is only called on bots that should update this frame.
 * Far bots are skipped entirely — the biggest CPU saving.
 */

import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { buildBRMap, disposeBRMap } from './BRMap';
import { populateMapLoot, groundLoot, spawnGroundLoot, clearAllLoot, updateGroundLoot } from './LootSystem';
import { startZone, updateZone, disposeZone } from './ZoneSystem';
import { buildBRBots, clearBRBots, updateBRBot, shouldUpdateBot, landBRBots } from './BRBots';
import { startDropSequence, updateDropSequence, resetDrop, isPlayerInAir, isPlayerOnPlane, drop } from './DropPlane';
import { createEmptyInventory, dumpInventoryOnDeath } from './Inventory';
import { setPlayerInventory, getPlayerInventory } from './InventoryUI';
import { populateVehicles, updateVehicles, clearVehicles } from './Vehicles';
import { updateAI } from '@/ai/AIController';
import { WEAPONS } from '@/config/weapons';
import { hideArena, showArena } from '@/world/Arena';
import { setViewmodelWeapon, setViewmodelVisible } from '@/rendering/WeaponViewmodel';
import type { TDMAgent } from '@/entities/TDMAgent';

export type BRPhase = 'pregame' | 'airdrop' | 'landing' | 'combat' | 'over';

export interface BRMatchState {
  active: boolean;
  phase: BRPhase;
  phaseStart: number;
  playersAlive: number;
  winnerName: string | null;
  frameCount: number; // for LOD stagger
}

export const brState: BRMatchState = {
  active: false, phase: 'pregame', phaseStart: 0,
  playersAlive: 30, winnerName: null, frameCount: 0,
};

// ═══════════════════════════════════════════
//  MATCH START / CLEANUP
// ═══════════════════════════════════════════

function nextFrame(): Promise<void> {
  return new Promise(r => requestAnimationFrame(() => r()));
}

function showLoading(msg: string): void {
  let el = document.getElementById('br-loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'br-loading';
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0a0e18;color:#e0e8f0;font-family:monospace;';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div style="font-size:28px;font-weight:bold;margin-bottom:18px;color:#4aa8ff;">BATTLE ROYALE</div><div style="font-size:16px;opacity:0.8;">${msg}</div>`;
  el.style.display = 'flex';
}

function hideLoading(): void {
  const el = document.getElementById('br-loading');
  if (el) el.style.display = 'none';
}

export async function startBRMatch(): Promise<void> {
  cleanupBR();

  showLoading('Generating map...');
  await nextFrame();

  hideArena();

  // Deactivate arena agents — they stay in the agents array but don't update or render
  for (const ag of gameState.agents) {
    if (ag === gameState.player) continue;
    if (!(ag as any)._brState) {
      ag.active = false;
      if (ag.renderComponent) ag.renderComponent.visible = false;
    }
  }

  brState.active = true;
  brState.phase = 'pregame';
  brState.phaseStart = gameState.worldElapsed;
  brState.playersAlive = 30;
  brState.winnerName = null;
  brState.frameCount = 0;

  buildBRMap();

  showLoading('Spawning loot...');
  await nextFrame();
  populateMapLoot();

  showLoading('Placing vehicles...');
  await nextFrame();
  populateVehicles();

  showLoading('Assembling combatants...');
  await nextFrame();
  buildBRBots();

  showLoading('Preparing drop...');
  await nextFrame();

  // Player inventory
  const inv = createEmptyInventory();
  inv.ammoLight = 20;
  inv.smallHeals = 1;
  setPlayerInventory(inv);

  // Player state
  gameState.pHP = 100;
  gameState.player.hp = 100;
  gameState.pDead = false;
  gameState.player.isDead = false;
  gameState.pKills = 0;
  gameState.pDeaths = 0;
  gameState.pWeaponSlots = ['knife'];
  gameState.pActiveSlot = 0;
  gameState.pWeaponId = 'knife';
  gameState.pAmmo = 0;
  gameState.pMaxAmmo = 0;
  gameState.pGrenades = 0;
  gameState.pReloading = false;

  setViewmodelWeapon('knife');
  setViewmodelVisible(false); // hidden until player lands

  startDropSequence();
  brState.phase = 'airdrop';
  brState.phaseStart = gameState.worldElapsed;

  hideLoading();
}

export function cleanupBR(): void {
  brState.active = false;
  disposeZone();
  clearAllLoot();
  clearVehicles();
  resetDrop();
  clearBRBots();
  disposeBRMap();
  showArena();

  // Reactivate arena agents
  for (const ag of gameState.agents) {
    if (ag === gameState.player) continue;
    if (!(ag as any)._brState) {
      ag.active = true;
      if (ag.renderComponent) ag.renderComponent.visible = true;
    }
  }
}

function countAlive(): number {
  let c = gameState.pDead ? 0 : 1;
  for (const ag of gameState.agents) {
    if (ag === gameState.player || ag.isDead) continue;
    // Count BR bots (even those still dropping) but skip deactivated arena bots
    const brSt = (ag as any)._brState;
    if (!brSt) continue; // arena agent — not part of BR
    c++;
  }
  return c;
}

// ═══════════════════════════════════════════
//  DEATH DROPS
// ═══════════════════════════════════════════

export function onBRDeath(victim: TDMAgent): void {
  if (victim === gameState.player) {
    const inv = getPlayerInventory();
    if (inv) {
      const items = dumpInventoryOnDeath(inv);
      if (items.length > 0) {
        spawnGroundLoot(victim.position.x, victim.position.z, 0.5, items, true);
      }
    }
  } else {
    // Bot death → simple death loot
    const items: any[] = [];
    if (victim.weaponId !== 'unarmed') {
      const wep = WEAPONS[victim.weaponId];
      items.push({
        id: `w_${victim.weaponId}_c`, category: 'weapon',
        name: wep.name, rarity: 'common', stackSize: 1, qty: 1,
        weaponId: victim.weaponId, damageBonus: 0, spreadReduction: 0,
        magSize: wep.magSize, currentAmmo: victim.ammo, attachments: {},
      });
    }
    if (victim.grenades > 0) {
      items.push({ id: 'gren', category: 'grenade', name: 'Grenade', rarity: 'common', stackSize: 6, qty: victim.grenades });
    }
    if (Math.random() < 0.35) {
      items.push({ id: 'heal_s', category: 'heal', name: 'Bandage', rarity: 'common', stackSize: 10, qty: 2 });
    }
    if (items.length > 0) {
      spawnGroundLoot(victim.position.x, victim.position.z, 0.5, items, true);
    }
  }
}

// ═══════════════════════════════════════════
//  MAIN BR UPDATE — LOD-aware
// ═══════════════════════════════════════════

export function updateBR(dt: number): void {
  if (!brState.active) return;

  brState.frameCount++;

  // Drop plane
  if (isPlayerInAir()) {
    updateDropSequence(dt);
  }

  // While on plane, skip all heavy updates
  if (isPlayerOnPlane()) {
    updateGroundLoot();
    brState.playersAlive = countAlive();
    return;
  }

  // Player jumped from plane — activate bots & zone
  if (brState.phase === 'airdrop') {
    brState.phase = 'landing';
    brState.phaseStart = gameState.worldElapsed;
    startZone();
  }

  // Player just landed — show viewmodel
  if (!isPlayerInAir()) {
    setViewmodelVisible(true);
  }

  // Phase transitions
  if (brState.phase === 'landing') {
    if (gameState.worldElapsed - brState.phaseStart > 20) {
      brState.phase = 'combat';
      brState.phaseStart = gameState.worldElapsed;
    }
  }

  // Zone
  updateZone(dt);

  // Vehicles
  updateVehicles(dt);

  // ── LOD-gated bot updates ──
  // This is the performance core: only nearby bots get full AI.
  for (const ag of gameState.agents) {
    if (ag === gameState.player || ag.isDead || !ag.active) continue;
    if (!shouldUpdateBot(ag, brState.frameCount)) continue;

    updateAI(ag, dt);

    // BR-specific behavior (loot seeking, zone rotation)
    if ((ag as any)._brState) {
      updateBRBot(ag, dt);
    }
  }

  // Ground loot animation (only nearby instances are animated in LootSystem)
  updateGroundLoot();

  // Count alive
  brState.playersAlive = countAlive();

  if (brState.playersAlive <= 1 && brState.phase !== 'over' && brState.phase !== 'pregame') {
    brState.phase = 'over';
    brState.phaseStart = gameState.worldElapsed;
    if (!gameState.pDead) {
      brState.winnerName = 'YOU';
    } else {
      const survivor = gameState.agents.find(a => a !== gameState.player && !a.isDead);
      brState.winnerName = survivor?.name ?? 'UNKNOWN';
    }
  }
}

export function isBRActive(): boolean { return brState.active; }
export function getBRPhase(): BRPhase { return brState.phase; }
