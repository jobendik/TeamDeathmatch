import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import {
  TEAM_BLUE, TEAM_RED, TEAM_COLORS,
  RESPAWN_TIME, SCORE_LIMIT, BLUE_SPAWNS, RED_SPAWNS,
} from '@/config/constants';
import type { TDMAgent } from '@/entities/TDMAgent';
import { spawnDeath } from './Particles';
import { updateHUD, flashDmg } from '@/ui/HUD';
import { updateScoreboard } from '@/ui/Scoreboard';
import { addKillfeedEntry } from '@/ui/Killfeed';
import { showKillNotif } from '@/ui/KillNotification';
import { resetAgentAnimation, playAgentDeathAnimation } from '@/rendering/AgentAnimations';
import { WEAPONS } from '@/config/weapons';
import { dom } from '@/ui/DOMElements';
import { showRoundSummary } from '@/ui/RoundSummary';

/**
 * Deal damage to the player.
 */
export function dealDmgPlayer(dmg: number): void {
  if (gameState.pDead || gameState.roundOver) return;
  gameState.pHP = Math.max(0, gameState.pHP - dmg);
  gameState.player.hp = gameState.pHP;
  updateHUD();
  flashDmg();
  if (gameState.pHP <= 0) playerDied();
}

/**
 * Handle player death.
 */
function playerDied(): void {
  gameState.pDead = true;
  gameState.respTimer = RESPAWN_TIME;
  dom.ds.classList.add('on');
  gameState.pDeaths++;
  dom.deathTxt.textContent = String(gameState.pDeaths);
  gameState.teamScores[TEAM_RED]++;
  updateScoreboard();
  addKillfeedEntry('Enemy', 'Player', TEAM_RED, TEAM_BLUE);
}

/**
 * Deal damage to an AI agent. Now tracks the damage source for smart reactions.
 */
export function dealDmgAgent(ag: TDMAgent, dmg: number, attackerTeam: number | null): void {
  if (ag.isDead || gameState.roundOver) return;
  ag.hp = Math.max(0, ag.hp - dmg);
  ag.alertLevel = Math.min(100, ag.alertLevel + 30);

  // ── Advanced AI: damage tracking ──
  ag.lastDamageTime = gameState.worldElapsed;
  ag.recentDamage += dmg;

  // Track who is shooting at us
  if (attackerTeam === null) {
    // Player is attacking this agent
    ag.lastAttacker = gameState.player;
  } else {
    // Find the attacker on that team
    const attacker = gameState.agents.find(
      (a) => a.team === attackerTeam && !a.isDead && a !== gameState.player && a !== ag,
    );
    if (attacker) ag.lastAttacker = attacker;
  }

  if (ag.hp <= 0) killAgent(ag, attackerTeam);
}

/**
 * Handle agent death — now updates confidence and kill streaks.
 */
function killAgent(ag: TDMAgent, attackerTeam: number | null): void {
  if (ag.isDead) return;
  ag.isDead = true;
  ag.deaths++;
  ag.respawnAt = gameState.worldElapsed + RESPAWN_TIME + Math.random() * 2;

  const deathAnimDuration = playAgentDeathAnimation(ag.renderComponent);
  if (ag.nameTag) ag.nameTag.visible = false;

  if (deathAnimDuration > 0) {
    window.setTimeout(() => {
      if (ag.isDead && ag.renderComponent) {
        ag.renderComponent.visible = false;
      }
    }, Math.max(900, deathAnimDuration * 1000));
  } else {
    ag.renderComponent!.visible = false;
  }

  spawnDeath(new THREE.Vector3(ag.position.x, 0.5, ag.position.z), TEAM_COLORS[ag.team]);

  ag.confidence = Math.max(10, ag.confidence - 15);
  ag.killStreak = 0;

  const oppositeTeam = ag.team === TEAM_BLUE ? TEAM_RED : TEAM_BLUE;
  gameState.teamScores[oppositeTeam]++;
  updateScoreboard();

  if (attackerTeam === null) {
    gameState.pKills++;
    dom.killTxt.textContent = String(gameState.pKills);
    showKillNotif(ag.name, ag.team);
    addKillfeedEntry('Player', ag.name, TEAM_BLUE, ag.team, WEAPONS[gameState.pWeaponId].name);
  } else {
    const killer = gameState.agents.find(
      (a) => a.team === attackerTeam && !a.isDead && a !== gameState.player,
    );
    if (killer) {
      killer.kills++;
      killer.confidence = Math.min(100, killer.confidence + 10);
      killer.killStreak++;
      if (killer.killStreak >= 3) killer.confidence = Math.min(100, killer.confidence + 5);
    }
    addKillfeedEntry(
      killer ? killer.name : 'Unknown',
      ag.name,
      attackerTeam,
      ag.team,
      killer ? WEAPONS[killer.weaponId].name : undefined,
    );
  }

  checkGameEnd();
}

/**
 * Respawn a dead agent — resets all AI state cleanly.
 */
export function respawnAgent(ag: TDMAgent): void {
  ag.isDead = false;
  ag.hp = ag.maxHP;
  ag.ammo = ag.magSize;
  ag.isReloading = false;

  const spawns = ag.team === TEAM_BLUE ? BLUE_SPAWNS : RED_SPAWNS;
  const sp = spawns[Math.floor(Math.random() * spawns.length)];
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
  ag.teamCalloutCertainty = 0;
  ag.activeCallout = null;
  ag.huntTimer = Math.random() * 2;
  ag.grenades = 2;
  ag.grenadeCooldown = 0;
  ag.currentTargetId = null;
  ag.targetCertainty = 0;
  ag.investigatePos = null;
  ag.enemyMemories.clear();
  ag.aimPhase = 'search';
  ag.aimPhaseTime = 0;
  ag.aimStability = 0;
  ag.aimTargetId = null;
  ag.fireDisciplineTimer = 0;
  ag.routeCommitUntil = 0;
  ag.intentCommitUntil = 0;
  ag.stress = Math.max(8, ag.stress * 0.75);
  ag.tilt = Math.max(0, ag.tilt * 0.35);
  if (ag.nameTag) ag.nameTag.visible = true;
}

/**
 * Check if score limit reached.
 */
function checkGameEnd(): void {
  if (gameState.roundOver) return;
  const blueWins = gameState.teamScores[TEAM_BLUE] >= SCORE_LIMIT;
  const redWins = gameState.teamScores[TEAM_RED] >= SCORE_LIMIT;
  if (blueWins || redWins) {
    const winner = blueWins ? TEAM_BLUE : TEAM_RED;
    setTimeout(() => showRoundSummary(winner), 1500);
  }
}

/**
 * Check and process agent respawns each frame.
 */
export function updateRespawns(): void {
  for (const ag of gameState.agents) {
    if (ag !== gameState.player && ag.isDead && gameState.worldElapsed >= ag.respawnAt) {
      respawnAgent(ag);
    }
  }
}
