/**
 * BRBots — Optimized with distance-based LOD for AI updates.
 *
 * Performance tiers (distance from player):
 *   TIER1 (< 50m):  full AI update every frame, full particles
 *   TIER2 (< 100m): AI update every 3rd frame, reduced particles
 *   TIER3 (< 160m): AI update every 6th frame, no particles
 *   CULLED (> 160m): mesh hidden, minimal state update only
 *
 * This reduces AI cost from O(30 × full) to ~O(8 × full + 10 × light + 12 × minimal).
 */

import * as THREE from 'three';
import * as YUKA from 'yuka';
import { gameState } from '@/core/GameState';
import { TEAM_BLUE, TEAM_RED, TEAM_COLORS } from '@/config/constants';
import type { BotClass } from '@/config/classes';
import { TDMAgent } from '@/entities/TDMAgent';
import { buildSoldierMesh } from '@/rendering/SoldierMesh';
import { makeNameTag } from '@/rendering/NameTag';
import { addHPBar } from '@/rendering/HPBar';
import {
  attachBlueSwatCharacter, attachEnemyCharacter,
  hasBlueSwatAssets, hasEnemyAssets,
} from '@/rendering/AgentAnimations';
import { setupFuzzy } from '@/ai/FuzzyLogic';
import { makePersonality } from '@/ai/Personality';
import {
  PatrolState, EngageState, InvestigateState, RetreatState,
  CoverState, FlankState, SeekPickupState, TeamPushState, PeekState,
} from '@/ai/states';
import {
  AttackEvaluator, SurviveEvaluator, ReloadEvaluator,
  SeekHealthEvaluator, GetWeaponEvaluator, HuntEvaluator, PatrolEvaluator,
} from '@/ai/goals/Evaluators';
import {
  BR_TOTAL_PLAYERS, AI_LOD_TIER1, AI_LOD_TIER2, AI_LOD_TIER3, AI_LOD_CULLED,
  BR_MAP_HALF,
} from './BRConfig';
import { zone, isOutsideZone, distanceToZoneEdge } from './ZoneSystem';
import { groundLoot, removeGroundLoot, lootGrid } from './LootSystem';
import { WEAPONS } from '@/config/weapons';
import { SpatialGrid } from './SpatialGrid';
import { buildingGrid } from './BRMap';

// ── Bot grid for fast proximity queries ──
export const botGrid = new SpatialGrid<TDMAgent>();

export interface BRBotState {
  hasLooted: boolean;
  lootTargetId: number | null;
  rotCooldown: number;
  phase: 'dropping' | 'looting' | 'rotating' | 'fighting' | 'surviving';
  lodTier: 0 | 1 | 2 | 3; // 0=full, 1=medium, 2=light, 3=culled
  lastFullUpdate: number;
  lastX: number;
  lastZ: number;
  stuckTimer: number;
}

const BOT_NAMES = [
  'Reaper','Wraith','Phantom','Viper','Ghost','Shade','Raven','Jackal',
  'Cobra','Hawk','Wolf','Lynx','Tiger','Panther','Falcon','Eagle',
  'Owl','Crow','Badger','Drake','Kodiak','Mako','Orion','Nova',
  'Pulse','Flux','Surge','Vex','Riot','Havoc','Storm','Ember',
];

export function getBRState(ag: TDMAgent): BRBotState | null {
  return (ag as any)._brState ?? null;
}

function syncRC(entity: YUKA.GameEntity, renderComponent: THREE.Object3D): void {
  renderComponent.position.copy(entity.position as unknown as THREE.Vector3);
  renderComponent.quaternion.copy(entity.rotation as unknown as THREE.Quaternion);
}

function mkBot(name: string, cls: BotClass, x: number, z: number): TDMAgent {
  const team = Math.random() < 0.5 ? TEAM_BLUE : TEAM_RED;
  const ag = new TDMAgent(name, team, cls);
  ag.position.set(x, 0, z);
  ag.spawnPos.set(x, 0, z);

  const personality = makePersonality(cls);
  ag.personality = personality;
  ag.reactionTime = Math.max(0.12, ag.reactionTime + personality.reactionModifier);

  const root = new THREE.Group();
  root.name = `${name}_R`;
  gameState.scene.add(root);
  ag.renderComponent = root;
  ag.setRenderComponent(root, syncRC);

  // Attach animated character model if assets are loaded, otherwise fall back to placeholder
  if (team === TEAM_BLUE && hasBlueSwatAssets()) {
    attachBlueSwatCharacter(root);
  } else if (team === TEAM_RED && hasEnemyAssets()) {
    attachEnemyCharacter(root);
  } else {
    root.add(buildSoldierMesh(TEAM_COLORS[team], cls, team));
  }

  const tag = makeNameTag(name, TEAM_COLORS[team]);
  tag.position.y = 2.6;
  root.add(tag);
  ag.nameTag = tag;
  addHPBar(ag);

  // Steering
  ag.wanderB = new YUKA.WanderBehavior(1.0, 4, 2.2);
  ag.arriveB = new YUKA.ArriveBehavior(new YUKA.Vector3(), 3, 0.5);
  ag.seekB = new YUKA.SeekBehavior(new YUKA.Vector3());
  ag.fleeB = new YUKA.FleeBehavior(new YUKA.Vector3(), 10);
  ag.pursuitB = new YUKA.PursuitBehavior(ag, 1.2);
  ag.avoidB = new YUKA.ObstacleAvoidanceBehavior(gameState.yukaObs);
  ag.avoidB.weight = 3;
  ag.steering.add(ag.wanderB); ag.steering.add(ag.arriveB);
  ag.steering.add(ag.seekB); ag.steering.add(ag.fleeB);
  ag.steering.add(ag.pursuitB); ag.steering.add(ag.avoidB);
  ag.wanderB.weight = 1;
  ag.arriveB.weight = 0; ag.seekB.weight = 0;
  ag.fleeB.weight = 0; ag.pursuitB.weight = 0;

  // State machine
  ag.stateMachine = new YUKA.StateMachine(ag);
  ag.stateMachine.add('PATROL', new PatrolState());
  ag.stateMachine.add('ENGAGE', new EngageState());
  ag.stateMachine.add('INVESTIGATE', new InvestigateState());
  ag.stateMachine.add('RETREAT', new RetreatState());
  ag.stateMachine.add('COVER', new CoverState());
  ag.stateMachine.add('FLANK', new FlankState());
  ag.stateMachine.add('SEEK_PICKUP', new SeekPickupState());
  ag.stateMachine.add('TEAM_PUSH', new TeamPushState());
  ag.stateMachine.add('PEEK', new PeekState());
  ag.stateMachine.changeTo('PATROL');

  // Evaluators
  ag.brain.addEvaluator(new AttackEvaluator(1.0 + personality.aggressionBias));
  ag.brain.addEvaluator(new SurviveEvaluator(1.2 + personality.cautionBias));
  ag.brain.addEvaluator(new ReloadEvaluator(1.0));
  ag.brain.addEvaluator(new SeekHealthEvaluator(1.1));
  ag.brain.addEvaluator(new GetWeaponEvaluator(1.3));
  ag.brain.addEvaluator(new HuntEvaluator(0.7 + personality.aggressionBias * 0.3));
  ag.brain.addEvaluator(new PatrolEvaluator(1.0));
  setupFuzzy(ag);
  ag.perceptionSlot = gameState.agents.length % 3;

  // BR state
  (ag as any)._brState = {
    hasLooted: false, lootTargetId: null, rotCooldown: 0,
    phase: 'looting', lodTier: 0, lastFullUpdate: 0,
    lastX: x, lastZ: z, stuckTimer: 0,
  } as BRBotState;

  // Start with knife
  ag.weaponId = 'knife';
  ag.damage = 55; ag.magSize = 0; ag.ammo = 0;

  gameState.entityManager.add(ag);
  gameState.agents.push(ag);
  botGrid.insert(ag, x, z);
  return ag;
}

export function buildBRBots(): void {
  const classes: BotClass[] = ['rifleman', 'assault', 'sniper', 'flanker'];
  const count = BR_TOTAL_PLAYERS - 1;
  for (let i = 0; i < count; i++) {
    const name = BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? `${(i / BOT_NAMES.length) | 0}` : '');
    const cls = classes[i % classes.length];
    const x = (Math.random() - 0.5) * BR_MAP_HALF * 1.4;
    const z = (Math.random() - 0.5) * BR_MAP_HALF * 1.4;
    mkBot(name, cls, x, z);
  }
}

/** Activate all BR bots — call when airdrop→landing phase begins */
export function landBRBots(): void {
  for (const ag of gameState.agents) {
    if (ag === gameState.player) continue;
    const state = getBRState(ag);
    if (!state) continue;
    ag.position.y = 0;
    ag.active = true;
    if (ag.renderComponent) ag.renderComponent.visible = true;
    state.phase = 'looting';
  }
}

/**
 * Compute LOD tier based on distance to player.
 */
function computeLOD(ag: TDMAgent): 0 | 1 | 2 | 3 {
  const dx = ag.position.x - gameState.player.position.x;
  const dz = ag.position.z - gameState.player.position.z;
  const d2 = dx * dx + dz * dz;
  if (d2 < AI_LOD_TIER1 * AI_LOD_TIER1) return 0;
  if (d2 < AI_LOD_TIER2 * AI_LOD_TIER2) return 1;
  if (d2 < AI_LOD_TIER3 * AI_LOD_TIER3) return 2;
  return 3;
}

/**
 * Should this bot run full AI this frame? Based on LOD + frame stagger.
 */
export function shouldUpdateBot(ag: TDMAgent, frameCount: number): boolean {
  const state = getBRState(ag);
  if (!state) return true;

  state.lodTier = computeLOD(ag);

  // Always update if in combat
  if (ag.currentTarget && state.lodTier <= 1) return true;

  switch (state.lodTier) {
    case 0: return true;
    case 1: return (frameCount + ag.perceptionSlot) % 3 === 0;
    case 2: return (frameCount + ag.perceptionSlot) % 6 === 0;
    case 3: return (frameCount + ag.perceptionSlot) % 15 === 0;
    default: return false;
  }
}

/**
 * BR-specific behavioral update. Called after standard updateAI,
 * only on frames where shouldUpdateBot returns true.
 */
export function updateBRBot(ag: TDMAgent, dt: number): void {
  const state = getBRState(ag);
  if (!state) return;

  // Update spatial grid
  botGrid.update(ag, ag.position.x, ag.position.z);

  // Visibility LOD — hide mesh if culled
  if (ag.renderComponent) {
    ag.renderComponent.visible = state.lodTier < 3;
  }

  state.rotCooldown = Math.max(0, state.rotCooldown - dt);

  // ── Stuck detection ──
  const moveDx = ag.position.x - state.lastX;
  const moveDz = ag.position.z - state.lastZ;
  const movedSq = moveDx * moveDx + moveDz * moveDz;
  if (movedSq < 0.04) { // moved less than 0.2m
    state.stuckTimer += dt;
  } else {
    state.stuckTimer = 0;
  }
  state.lastX = ag.position.x;
  state.lastZ = ag.position.z;

  if (state.stuckTimer > 1.0) {
    state.stuckTimer = 0;
    state.lootTargetId = null;

    // Try to navigate toward the nearest building door
    const nearbyB = buildingGrid.queryRadius(ag.position.x, ag.position.z, 25);
    let bestDoor: { x: number; z: number } | null = null;
    let bestDist = Infinity;
    for (const entry of nearbyB) {
      const b = entry.obj;
      // Check if bot is inside or very close to this building
      if (Math.abs(ag.position.x - b.cx) < b.hw + 1.5 && Math.abs(ag.position.z - b.cz) < b.hd + 1.5) {
        for (const door of b.doorPositions) {
          const ddx = ag.position.x - door.x;
          const ddz = ag.position.z - door.z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < bestDist) { bestDist = d2; bestDoor = door; }
        }
      }
    }

    if (bestDoor) {
      // Steer toward the nearest door
      if (ag.arriveB) { (ag.arriveB as any).target.set(bestDoor.x, 0, bestDoor.z); ag.arriveB.weight = 2.0; }
      if (ag.seekB) ag.seekB.weight = 0;
      if (ag.wanderB) ag.wanderB.weight = 0;
    } else {
      // Not near a building — fall back to wander
      if (ag.arriveB) ag.arriveB.weight = 0;
      if (ag.seekB) ag.seekB.weight = 0;
      if (ag.wanderB) ag.wanderB.weight = 1.5;
    }
    state.rotCooldown = 3;
  }



  // Phase detection
  const unarmed = ag.weaponId === 'unarmed' || ag.weaponId === 'knife';
  const hasTarget = !!ag.currentTarget;
  const outside = isOutsideZone(ag.position.x, ag.position.z);
  const nearEdge = distanceToZoneEdge(ag.position.x, ag.position.z) < 25;

  if (outside) state.phase = 'surviving';
  else if (hasTarget) state.phase = 'fighting';
  else if (unarmed || !state.hasLooted) state.phase = 'looting';
  else state.phase = 'rotating';

  // ── Phase behaviors ──
  if (state.phase === 'surviving') {
    rotateToZone(ag);
  } else if (state.phase === 'looting') {
    seekLoot(ag, state);
  } else if (state.phase === 'rotating' && state.rotCooldown <= 0) {
    if (nearEdge) rotateToZone(ag);
    state.rotCooldown = 3 + Math.random() * 4;
  }

  // Pickup if close — always check
  tryPickupNearby(ag, state);
}

function rotateToZone(ag: TDMAgent): void {
  if (!zone.active) return;
  const dx = zone.currentCenter.x - ag.position.x;
  const dz = zone.currentCenter.y - ag.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz) || 1;
  const tx = zone.currentCenter.x - (dx / dist) * zone.currentRadius * 0.5;
  const tz = zone.currentCenter.y - (dz / dist) * zone.currentRadius * 0.5;
  if (ag.arriveB) { (ag.arriveB as any).target.set(tx, 0, tz); ag.arriveB.weight = 1.3; }
  if (ag.wanderB) ag.wanderB.weight = 0.1;
}

function isInsideCollider(x: number, z: number): boolean {
  for (const c of gameState.arenaColliders) {
    if (c.type === 'box') {
      if (Math.abs(x - c.x) < c.hw && Math.abs(z - c.z) < c.hd) return true;
    } else {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) return true;
    }
  }
  return false;
}

function seekLoot(ag: TDMAgent, state: BRBotState): void {
  // Use spatial grid — find reachable loot (not inside a building collider)
  const candidates = lootGrid.queryRadius(ag.position.x, ag.position.z, 40);
  let best: { obj: typeof groundLoot[0]; dist: number } | null = null;
  for (const c of candidates) {
    if (!c.obj.alive) continue;
    if (isInsideCollider(c.obj.x, c.obj.z)) continue;
    const dx = c.obj.x - ag.position.x;
    const dz = c.obj.z - ag.position.z;
    const d = dx * dx + dz * dz;
    if (!best || d < best.dist) best = { obj: c.obj, dist: d };
  }
  if (best) {
    state.lootTargetId = best.obj.id;
    if (ag.arriveB) { (ag.arriveB as any).target.set(best.obj.x, 0, best.obj.z); ag.arriveB.weight = 1.4; }
    if (ag.wanderB) ag.wanderB.weight = 0;
  } else {
    state.lootTargetId = null;
    if (ag.wanderB) ag.wanderB.weight = 1;
  }
}

function tryPickupNearby(ag: TDMAgent, state: BRBotState): void {
  // Query loot grid within 3m
  const nearby = lootGrid.queryRadius(ag.position.x, ag.position.z, 3);
  for (const entry of nearby) {
    const g = entry.obj;
    if (!g.alive) continue;
    const remaining: typeof g.items = [];
    for (const item of g.items) {
      if (botWantsItem(ag, item)) {
        applyItemToBot(ag, item);
        state.hasLooted = true;
      } else {
        remaining.push(item);
      }
    }
    g.items = remaining;
    if (g.items.length === 0) removeGroundLoot(g.id);
  }
}

function botWantsItem(ag: TDMAgent, item: any): boolean {
  if (item.category === 'weapon') {
    if (ag.weaponId === 'unarmed' || ag.weaponId === 'knife') return true;
    return (WEAPONS[item.weaponId as keyof typeof WEAPONS]?.desirability ?? 0) > (WEAPONS[ag.weaponId]?.desirability ?? 0);
  }
  if (item.category === 'ammo') return ag.ammo < ag.magSize * 2;
  if (item.category === 'heal') return ag.hp < ag.maxHP;
  if (item.category === 'grenade') return ag.grenades < 3;
  return true;
}

function applyItemToBot(ag: TDMAgent, item: any): void {
  if (item.category === 'weapon' && item.weaponId) {
    const wep = WEAPONS[item.weaponId as keyof typeof WEAPONS];
    if (!wep) return;
    ag.weaponId = item.weaponId;
    ag.damage = wep.damage * (1 + (item.damageBonus ?? 0));
    ag.fireRate = wep.fireRate;
    ag.burstSize = wep.burstSize;
    ag.burstDelay = wep.burstDelay;
    ag.reloadTime = wep.reloadTime;
    ag.magSize = wep.magSize;
    ag.ammo = wep.magSize;
    ag.aimError = wep.aimError * (1 - (item.spreadReduction ?? 0));
  } else if (item.category === 'ammo') {
    ag.ammo = Math.min(ag.magSize * 3, ag.ammo + (item.qty ?? 20));
  } else if (item.category === 'heal') {
    ag.hp = Math.min(ag.maxHP, ag.hp + (item.id === 'heal_b' ? 100 : 25));
  } else if (item.category === 'grenade') {
    ag.grenades = Math.min(3, ag.grenades + (item.qty ?? 1));
  }
}

export function clearBRBots(): void {
  for (let i = gameState.agents.length - 1; i >= 0; i--) {
    const ag = gameState.agents[i];
    if (ag === gameState.player) continue;
    if ((ag as any)._brState) {
      if (ag.renderComponent) gameState.scene.remove(ag.renderComponent);
      gameState.entityManager.remove(ag);
      gameState.agents.splice(i, 1);
    }
  }
  botGrid.clear();
}
