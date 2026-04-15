import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import {
  TEAM_BLUE, TEAM_RED, TEAM_COLORS,
  RESPAWN_TIME, BLUE_SPAWNS, RED_SPAWNS,
} from '@/config/constants';
import type { TDMAgent } from '@/entities/TDMAgent';
import { spawnDeath } from './Particles';
import { updateHUD, flashDmg } from '@/ui/HUD';
import { updateScoreboard } from '@/ui/Scoreboard';
import { addKillfeedEntry } from '@/ui/Killfeed';
import { showKillNotif } from '@/ui/KillNotification';
import { resetAgentAnimation } from '@/rendering/AgentAnimations';
import { CLASS_DEFAULT_WEAPON, WEAPONS, type WeaponId } from '@/config/weapons';
import { dom } from '@/ui/DOMElements';
import { showRoundSummary } from '@/ui/RoundSummary';
import { getFacingYawTowardsArena, getModeDefaults, getPlayerSpawn, getSpawnForAgent, getModeLabel } from '@/core/GameModes';
import { updateObjectiveVisibility } from './Objectives';



function applyWeaponToAgent(ag: TDMAgent, weaponId: WeaponId): void {
  const def = WEAPONS[weaponId];
  ag.weaponId = weaponId;
  ag.damage = def.damage;
  ag.fireRate = def.fireRate;
  ag.burstSize = def.burstSize;
  ag.burstDelay = def.burstDelay;
  ag.reloadTime = def.reloadTime;
  ag.magSize = def.magSize;
  ag.ammo = def.magSize;
  ag.aimError = def.aimError;
}

function applyPlayerLoadoutForMode(): void {
  const defaults = getModeDefaults(gameState.mode);
  if (defaults.playerStartsArmed) {
    gameState.pWeaponSlots = ['assault_rifle', 'pistol'];
    gameState.pActiveSlot = 0;
  } else {
    gameState.pWeaponSlots = ['pistol'];
    gameState.pActiveSlot = 0;
  }
  gameState.pWeaponId = gameState.pWeaponSlots[gameState.pActiveSlot];
  const wep = WEAPONS[gameState.pWeaponId];
  gameState.pAmmo = wep.magSize;
  gameState.pMaxAmmo = wep.magSize;
  gameState.pReloadDuration = wep.reloadTime;
  gameState.pShootTimer = 0;
  gameState.pBurstCount = 0;
}

function applyAgentLoadoutForMode(ag: TDMAgent): void {
  if (ag === gameState.player) return;
  const weaponId: WeaponId = gameState.mode === 'ffa' ? 'pistol' : (CLASS_DEFAULT_WEAPON[ag.botClass] || 'assault_rifle');
  applyWeaponToAgent(ag, weaponId);
  ag.grenades = gameState.mode === 'ffa' ? 1 : 2;
}

function clearDeadTargetReferences(deadTarget: TDMAgent): void {
  for (const ag of gameState.agents) {
    if (ag === deadTarget) continue;
    if (ag.currentTarget === deadTarget) {
      ag.currentTarget = null;
      ag.hasTarget = false;
      ag.trackingTime = 0;
      ag.shootTimer = Math.max(ag.shootTimer, 0.15);
      ag.burstCount = 0;
    }
  }
}

export function dealDmgPlayer(dmg: number, attacker: TDMAgent | null = null): void {
  if (gameState.pDead || gameState.roundOver) return;
  gameState.pHP = Math.max(0, gameState.pHP - dmg);
  gameState.player.hp = gameState.pHP;
  updateHUD();
  flashDmg();
  if (gameState.pHP <= 0) playerDied(attacker);
}

function playerDied(attacker: TDMAgent | null): void {
  gameState.pDead = true;
  gameState.player.isDead = true;
  gameState.respTimer = RESPAWN_TIME;
  dom.ds.classList.add('on');
  gameState.pDeaths++;
  dom.deathTxt.textContent = String(gameState.pDeaths);
  clearDeadTargetReferences(gameState.player);
  for (const team of [TEAM_BLUE, TEAM_RED] as const) {
    if (gameState.flags[team].carriedBy === gameState.player) dropFlag(team, new THREE.Vector3(gameState.player.position.x, 0, gameState.player.position.z));
  }

  if (gameState.mode === 'tdm') {
    const killerTeam = attacker ? attacker.team : TEAM_RED;
    gameState.teamScores[killerTeam]++;
    updateScoreboard();
  } else if (gameState.mode === 'ffa' && attacker) {
    attacker.kills++;
  }

  addKillfeedEntry(attacker ? attacker.name : 'Enemy', 'Player', attacker ? attacker.team : TEAM_RED, TEAM_BLUE, attacker ? WEAPONS[attacker.weaponId].name : undefined);
  checkGameEnd();
}

export function dealDmgAgent(ag: TDMAgent, dmg: number, attacker: TDMAgent | null = null): void {
  if (ag.isDead || gameState.roundOver) return;
  ag.hp = Math.max(0, ag.hp - dmg);
  ag.alertLevel = Math.min(100, ag.alertLevel + 30);
  ag.lastDamageTime = gameState.worldElapsed;
  ag.recentDamage += dmg;
  if (attacker) ag.lastAttacker = attacker;
  if (ag.hp <= 0) killAgent(ag, attacker);
}

function killAgent(ag: TDMAgent, attacker: TDMAgent | null): void {
  if (ag.isDead) return;
  ag.isDead = true;
  ag.deaths++;
  ag.respawnAt = gameState.worldElapsed + RESPAWN_TIME + Math.random() * 2;
  ag.renderComponent!.visible = false;
  spawnDeath(new THREE.Vector3(ag.position.x, 0.5, ag.position.z), TEAM_COLORS[ag.team]);
  ag.confidence = Math.max(10, ag.confidence - 15);
  ag.killStreak = 0;
  clearDeadTargetReferences(ag);

  if (attacker) {
    attacker.kills++;
    attacker.confidence = Math.min(100, attacker.confidence + 10);
    attacker.killStreak++;
  }

  if (gameState.mode === 'tdm') {
    const scoringTeam = attacker ? attacker.team : (ag.team === TEAM_BLUE ? TEAM_RED : TEAM_BLUE);
    gameState.teamScores[scoringTeam]++;
    updateScoreboard();
  }

  if (attacker === gameState.player) {
    gameState.pKills++;
    dom.killTxt.textContent = String(gameState.pKills);
    showKillNotif(ag.name, ag.team);
  }

  addKillfeedEntry(attacker ? attacker.name : 'Unknown', ag.name, attacker ? attacker.team : TEAM_RED, ag.team, attacker ? WEAPONS[attacker.weaponId].name : undefined);
  checkGameEnd();
}

export function dropFlag(team: 0 | 1, pos: THREE.Vector3): void {
  const flag = gameState.flags[team];
  flag.carriedBy = null;
  flag.home = false;
  flag.dropped = true;
  flag.dropPos.copy(pos);
  if (flag.mesh) flag.mesh.position.set(pos.x, 0, pos.z);
}

export function resetFlagToBase(team: 0 | 1): void {
  const flag = gameState.flags[team];
  flag.carriedBy = null;
  flag.dropped = false;
  flag.home = true;
  flag.dropPos.copy(flag.base);
  if (flag.mesh) flag.mesh.position.copy(flag.base);
}

export function scoreFlagCapture(carrier: TDMAgent): void {
  const enemyTeam = carrier.team === TEAM_BLUE ? TEAM_RED : TEAM_BLUE;
  gameState.teamScores[carrier.team]++;
  updateScoreboard();
  addKillfeedEntry(carrier.name, 'FLAG CAPTURE', carrier.team, enemyTeam, 'FLAG');
  resetFlagToBase(enemyTeam);
  checkGameEnd();
}

export function respawnAgent(ag: TDMAgent): void {
  ag.isDead = false;
  ag.hp = ag.maxHP;
  applyAgentLoadoutForMode(ag);
  ag.isReloading = false;
  const sp = getSpawnForAgent(ag);
  ag.position.set(sp[0], 0, sp[2]);
  ag.renderComponent!.visible = true;
  ag.renderComponent!.position.set(sp[0], 0, sp[2]);
  resetAgentAnimation(ag.renderComponent!);
  ag.stateMachine.changeTo('PATROL');
  ag.stateName = 'PATROL';
  ag.hasLastKnown = false;
  ag.alertLevel = 0;
  ag.currentTarget = null;
  ag.burstCount = 0;
  ag.shootTimer = 0;
  ag.reactionTimer = 0;
  ag.trackingTime = 0;
  ag.recentDamage = 0;
  ag.lastAttacker = null;
  ag.seekingPickup = false;
  ag.seekPickupPos = null;
  ag.isPeeking = false;
  ag.teamCallout = null;
  ag.huntTimer = Math.random() * 2;
  ag.grenades = gameState.mode === 'ffa' ? 1 : 2;
  ag.grenadeCooldown = 0;
  if (ag.nameTag) ag.nameTag.visible = true;

  for (const team of [TEAM_BLUE, TEAM_RED] as const) {
    if (gameState.flags[team].carriedBy === ag) dropFlag(team, new THREE.Vector3(ag.position.x, 0, ag.position.z));
  }
}

function getCurrentLeadScore(): number {
  if (gameState.mode === 'ffa') {
    return Math.max(gameState.pKills, ...gameState.agents.filter(a => a !== gameState.player).map(a => a.kills));
  }
  return Math.max(gameState.teamScores[TEAM_BLUE], gameState.teamScores[TEAM_RED]);
}

function checkGameEnd(): void {
  if (gameState.roundOver) return;
  const leadScore = getCurrentLeadScore();
  if (leadScore >= gameState.scoreLimit) {
    if (gameState.mode === 'ffa') {
      const all = [{ name: 'Player', kills: gameState.pKills, isPlayer: true }, ...gameState.agents.filter(a => a !== gameState.player).map(a => ({ name: a.name, kills: a.kills, isPlayer: false }))];
      all.sort((a, b) => b.kills - a.kills);
      gameState.winnerText = all[0].isPlayer ? 'VICTORY' : `WINNER: ${all[0].name}`;
      setTimeout(() => showRoundSummary(TEAM_BLUE), 800);
    } else {
      const winner = gameState.teamScores[TEAM_BLUE] >= gameState.scoreLimit ? TEAM_BLUE : TEAM_RED;
      setTimeout(() => showRoundSummary(winner), 800);
    }
  }
}

export function resetMatch(mode = gameState.mode): void {
  gameState.mode = mode;
  gameState.roundOver = false;
  const defaults = getModeDefaults(mode);
  gameState.matchTime = defaults.matchTime;
  gameState.scoreLimit = defaults.scoreLimit;
  gameState.teamScores = [0, 0];
  gameState.pKills = 0;
  gameState.pDeaths = 0;
  gameState.killfeedEntries = [];
  gameState.matchTimeRemaining = defaults.matchTime;
  dom.killfeed.innerHTML = '';

  if (gameState.pDead) {
    gameState.pDead = false;
    gameState.player.isDead = false;
    dom.ds.classList.remove('on');
  }

  const sp = getPlayerSpawn();
  gameState.player.position.set(sp[0], 0, sp[2]);
  gameState.player.spawnPos.set(sp[0], 0, sp[2]);
  gameState.cameraYaw = getFacingYawTowardsArena(sp[0], sp[2]);
  gameState.cameraPitch = 0;
  gameState.pHP = 100;
  gameState.player.hp = 100;
  applyPlayerLoadoutForMode();
  gameState.pGrenades = gameState.mode === 'ffa' ? 1 : 2;
  gameState.pReloading = false;
  dom.reloadBar.classList.remove('on');
  dom.reloadText.classList.remove('on');

  for (const ag of gameState.agents) {
    if (ag === gameState.player) continue;
    ag.kills = 0;
    ag.deaths = 0;
    ag.confidence = 50;
    ag.killStreak = 0;
    if (ag.isDead) respawnAgent(ag);
    else {
      const asp = getSpawnForAgent(ag);
      ag.position.set(asp[0], 0, asp[2]);
      ag.hp = ag.maxHP;
      applyAgentLoadoutForMode(ag);
      ag.currentTarget = null;
      ag.hasTarget = false;
      ag.renderComponent!.visible = true;
      ag.renderComponent!.position.set(asp[0], 0, asp[2]);
    }
  }

  resetFlagToBase(TEAM_BLUE);
  resetFlagToBase(TEAM_RED);
  updateObjectiveVisibility();
  updateScoreboard();
  updateHUD();
  dom.killTxt.textContent = '0';
  dom.deathTxt.textContent = '0';
  dom.roundSummary.classList.remove('on');
  if (gameState.mainMenuOpen) dom.lockHint.classList.add('on');
}

export function updateRespawns(): void {
  if (gameState.roundOver) return;

  if (gameState.matchTimeRemaining <= 0) {
    gameState.roundOver = true;
    if (gameState.mode === 'ffa') showRoundSummary(TEAM_BLUE);
    else showRoundSummary(gameState.teamScores[TEAM_BLUE] >= gameState.teamScores[TEAM_RED] ? TEAM_BLUE : TEAM_RED);
    return;
  }

  for (const ag of gameState.agents) {
    if (ag !== gameState.player && ag.isDead && gameState.worldElapsed >= ag.respawnAt) {
      respawnAgent(ag);
    }
  }
}
