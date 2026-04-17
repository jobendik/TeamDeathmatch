/**
 * BRBots — Battle-royale bot system.
 *
 * Three performance pillars:
 *  1. Async chunked spawning — bots are created 4 at a time with frame yields
 *     between chunks, keeping the loading screen responsive.
 *  2. Lazy skeletal models — bots start with the cheap procedural SoldierMesh
 *     and only upgrade to Mixamo skeletons when the player is within
 *     SKELETAL_ACTIVATION_DIST. They downgrade again past the hysteresis
 *     threshold so animation mixers don't run for 30 bots across the map.
 *  3. Gated updates — bots are ag.active=false until landBRBots() is called,
 *     so the entity manager + animation system skip them while the player is
 *     still on the drop plane.
 *
 * Behaviour is phase-driven. determinePhase() returns one of:
 *   inactive | storm_flee | retreating | loot_urgent | loot_safe
 *   | rotating | hunting | engaging
 * …and the phase handlers own the bot's steering exclusively (clearing
 * all weights before setting their own), so there's no conflict between
 * updateAI's combat goals and the BR overlay. Combat steering from updateAI
 * is only honoured during the 'engaging' phase.
 */

import * as THREE from 'three';
import * as YUKA from 'yuka';
import { gameState } from '@/core/GameState';
import { TEAM_BLUE, TEAM_RED, TEAM_COLORS } from '@/config/constants';
import { CLASS_CONFIGS, type BotClass } from '@/config/classes';
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
  BR_TOTAL_PLAYERS, AI_LOD_TIER1, AI_LOD_TIER2, AI_LOD_TIER3,
  BR_MAP_HALF,
} from './BRConfig';
import { zone, isOutsideZone, distanceToZoneEdge } from './ZoneSystem';
import { lootGrid, removeGroundLoot } from './LootSystem';
import { WEAPONS } from '@/config/weapons';
import { SpatialGrid } from './SpatialGrid';
import { buildingGrid, getBRMapData } from './BRMap';
import { findCoverFrom, pushOutOfWall } from '@/ai/CoverSystem';

// ── Bot grid for fast proximity queries ──
export const botGrid = new SpatialGrid<TDMAgent>();

// Distance (metres) at which skeletal models are attached/removed.
// Hysteresis prevents thrashing at the boundary.
const SKELETAL_ACTIVATION_DIST = 90;
const SKELETAL_DEACTIVATION_DIST = 120;

// How many bots to spawn per frame during async construction.
const SPAWN_CHUNK_SIZE = 4;

// First window after landing where bots refuse to engage (everyone's looting).
const COMBAT_SUPPRESS_MIN_S = 16;
const COMBAT_SUPPRESS_MAX_S = 24;

export type BRBotPhase =
  | 'inactive'      // Pre-drop. Skipped entirely.
  | 'loot_urgent'   // Unarmed — weapon is the only thing that matters.
  | 'loot_safe'     // Has a weapon; grazing for upgrades / ammo / heals.
  | 'rotating'      // Zone closing, near edge — head for next circle.
  | 'hunting'       // Well-geared, late game — seek engagement.
  | 'engaging'      // Active combat — hand off steering to updateAI.
  | 'retreating'    // Low HP or outgunned — find cover, break contact.
  | 'storm_flee';   // Outside zone — sprint to safety.

export interface BRBotState {
  phase: BRBotPhase;
  phaseStart: number;
  lodTier: 0 | 1 | 2 | 3;

  lootTargetId: number | null;
  poiTarget: { x: number; z: number } | null;
  poiTargetSetAt: number;

  hasLooted: boolean;

  stuckTimer: number;
  lastX: number;
  lastZ: number;

  skeletalAttached: boolean;
  skeletalLastFlipAt: number;

  combatSuppressUntil: number;
  lastPhaseDecision: number;
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

// ─────────────────────────────────────────────────────────────────────
//  CONSTRUCTION
// ─────────────────────────────────────────────────────────────────────

function syncRC(entity: YUKA.GameEntity, renderComponent: THREE.Object3D): void {
  renderComponent.position.copy(entity.position as unknown as THREE.Vector3);
  renderComponent.quaternion.copy(entity.rotation as unknown as THREE.Quaternion);
}

function buildPlaceholderMesh(team: 0 | 1, cls: BotClass): THREE.Group {
  return buildSoldierMesh(TEAM_COLORS[team], cls, team);
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

  // Always start with the cheap mesh; skeletal rig is attached on demand.
  root.add(buildPlaceholderMesh(team, cls));

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
  ag.wanderB.weight = 0;
  ag.arriveB.weight = 0; ag.seekB.weight = 0;
  ag.fleeB.weight = 0; ag.pursuitB.weight = 0;

  // State machine (used for animation/state name display)
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

  // Evaluators. SeekHealth/GetWeapon self-gate to zero in BR mode (BRBots handles loot).
  ag.brain.addEvaluator(new AttackEvaluator(1.0 + personality.aggressionBias));
  ag.brain.addEvaluator(new SurviveEvaluator(1.2 + personality.cautionBias));
  ag.brain.addEvaluator(new ReloadEvaluator(1.0));
  ag.brain.addEvaluator(new SeekHealthEvaluator(1.1));
  ag.brain.addEvaluator(new GetWeaponEvaluator(1.3));
  ag.brain.addEvaluator(new HuntEvaluator(0.7 + personality.aggressionBias * 0.3));
  ag.brain.addEvaluator(new PatrolEvaluator(1.0));
  setupFuzzy(ag);
  ag.perceptionSlot = gameState.agents.length % 3;

  // BR state — INACTIVE until landBRBots() is called.
  (ag as any)._brState = {
    phase: 'inactive',
    phaseStart: 0,
    lodTier: 3,
    lootTargetId: null,
    poiTarget: null,
    poiTargetSetAt: 0,
    hasLooted: false,
    stuckTimer: 0,
    lastX: x,
    lastZ: z,
    skeletalAttached: false,
    skeletalLastFlipAt: -10,
    combatSuppressUntil: 0,
    lastPhaseDecision: 0,
  } as BRBotState;

  ag.active = false;
  root.visible = false;

  // Start with knife — they must find a real weapon.
  ag.weaponId = 'knife';
  ag.damage = 55; ag.magSize = 0; ag.ammo = 0;

  gameState.entityManager.add(ag);
  gameState.agents.push(ag);
  botGrid.insert(ag, x, z);
  return ag;
}

/**
 * Spawn positions for BR bots. We cluster around POIs — that's where
 * human players drop, so having AI cluster there too keeps the world
 * populated exactly where the player expects to find action.
 */
function generateSpawnPoints(count: number): [number, number][] {
  const map = getBRMapData();
  const spawns: [number, number][] = [];

  if (!map || map.pois.length === 0) {
    for (let i = 0; i < count; i++) {
      spawns.push([
        (Math.random() - 0.5) * BR_MAP_HALF * 1.4,
        (Math.random() - 0.5) * BR_MAP_HALF * 1.4,
      ]);
    }
    return spawns;
  }

  // Assign bots to POIs round-robin so every POI gets some initial activity.
  for (let i = 0; i < count; i++) {
    const poi = map.pois[i % map.pois.length];
    const angle = Math.random() * Math.PI * 2;
    const dist = 6 + Math.random() * Math.max(10, poi.radius);
    spawns.push([
      poi.x + Math.cos(angle) * dist,
      poi.z + Math.sin(angle) * dist,
    ]);
  }
  return spawns;
}

/**
 * Build all BR bots asynchronously, yielding between chunks so the
 * loading screen actually animates. This replaces the synchronous
 * buildBRBots that used to freeze the tab for ~1s during 29 skeleton
 * clones.
 */
export async function buildBRBots(
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const classes: BotClass[] = ['rifleman', 'assault', 'sniper', 'flanker'];
  const count = BR_TOTAL_PLAYERS - 1;
  const spawns = generateSpawnPoints(count);

  for (let i = 0; i < count; i++) {
    const name = BOT_NAMES[i % BOT_NAMES.length] +
      (i >= BOT_NAMES.length ? `${Math.floor(i / BOT_NAMES.length)}` : '');
    const cls = classes[i % classes.length];
    const [x, z] = spawns[i];
    mkBot(name, cls, x, z);

    if ((i + 1) % SPAWN_CHUNK_SIZE === 0 || i === count - 1) {
      onProgress?.(i + 1, count);
      // Yield to the browser so the loading screen repaints.
      await new Promise<void>(r => requestAnimationFrame(() => r()));
    }
  }
}

/**
 * Activate all bots — call when the player jumps from the plane.
 * This is the "everyone lands together" moment: bots start looting
 * exactly when the human player starts their freefall.
 */
export function landBRBots(): void {
  const now = gameState.worldElapsed;
  for (const ag of gameState.agents) {
    if (ag === gameState.player) continue;
    const state = getBRState(ag);
    if (!state) continue;

    ag.position.y = 0;
    ag.active = true;
    if (ag.renderComponent) ag.renderComponent.visible = true;

    state.phase = 'loot_urgent';
    state.phaseStart = now;
    state.combatSuppressUntil = now +
      COMBAT_SUPPRESS_MIN_S + Math.random() * (COMBAT_SUPPRESS_MAX_S - COMBAT_SUPPRESS_MIN_S);
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

// ─────────────────────────────────────────────────────────────────────
//  LOD
// ─────────────────────────────────────────────────────────────────────

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
 * Upgrade the bot to the Mixamo skeletal rig when the player is close
 * enough to see the difference, and downgrade back to the placeholder
 * when far away. This keeps the expensive animation mixer count low
 * (typically 2–5 at a time) instead of having 29 of them running.
 */
function updateBotVisualLOD(ag: TDMAgent, state: BRBotState, now: number): void {
  if (!ag.renderComponent) return;

  // Flip at most every 2 seconds per bot — avoids thrashing at the boundary.
  if (now - state.skeletalLastFlipAt < 2) return;

  const dx = ag.position.x - gameState.player.position.x;
  const dz = ag.position.z - gameState.player.position.z;
  const d = Math.sqrt(dx * dx + dz * dz);

  const needsSkeletal = d < SKELETAL_ACTIVATION_DIST;
  const shouldDrop = d > SKELETAL_DEACTIVATION_DIST;

  if (needsSkeletal && !state.skeletalAttached) {
    const hasAssets = ag.team === TEAM_BLUE ? hasBlueSwatAssets() : hasEnemyAssets();
    if (!hasAssets) return;

    // Swap placeholder → skeletal. Preserve nameTag and hpBarGroup.
    for (let i = ag.renderComponent.children.length - 1; i >= 0; i--) {
      const child = ag.renderComponent.children[i];
      if (child === ag.nameTag || child === ag.hpBarGroup) continue;
      ag.renderComponent.remove(child);
    }
    try {
      if (ag.team === TEAM_BLUE) {
        attachBlueSwatCharacter(ag.renderComponent as THREE.Group);
      } else {
        attachEnemyCharacter(ag.renderComponent as THREE.Group);
      }
      state.skeletalAttached = true;
      state.skeletalLastFlipAt = now;
    } catch {
      ag.renderComponent.add(buildPlaceholderMesh(ag.team, ag.botClass));
    }
  } else if (state.skeletalAttached && shouldDrop) {
    for (let i = ag.renderComponent.children.length - 1; i >= 0; i--) {
      const child = ag.renderComponent.children[i];
      if (child === ag.nameTag || child === ag.hpBarGroup) continue;
      ag.renderComponent.remove(child);
    }
    delete (ag.renderComponent.userData as any).agentAnimController;
    delete (ag.renderComponent.userData as any).characterModel;
    ag.renderComponent.add(buildPlaceholderMesh(ag.team, ag.botClass));
    state.skeletalAttached = false;
    state.skeletalLastFlipAt = now;
  }
}

/**
 * Gating used by BRController — returns true if this bot should run full
 * AI this frame.
 */
export function shouldUpdateBot(ag: TDMAgent, frameCount: number): boolean {
  if (!ag.active) return false;
  const state = getBRState(ag);
  if (!state) return true;
  if (state.phase === 'inactive') return false;

  state.lodTier = computeLOD(ag);

  // In combat with a close target, always update.
  if (ag.currentTarget && state.lodTier <= 1) return true;

  switch (state.lodTier) {
    case 0: return true;
    case 1: return (frameCount + ag.perceptionSlot) % 3 === 0;
    case 2: return (frameCount + ag.perceptionSlot) % 6 === 0;
    case 3: return (frameCount + ag.perceptionSlot) % 15 === 0;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────
//  STEERING HELPERS
// ─────────────────────────────────────────────────────────────────────

function clearSteering(ag: TDMAgent): void {
  if (ag.wanderB) ag.wanderB.weight = 0;
  if (ag.arriveB) ag.arriveB.weight = 0;
  if (ag.seekB) ag.seekB.weight = 0;
  if (ag.fleeB) ag.fleeB.weight = 0;
  if (ag.pursuitB) ag.pursuitB.weight = 0;
}

function goTo(ag: TDMAgent, x: number, z: number, weight = 1.4): void {
  clearSteering(ag);
  if (ag.arriveB) {
    (ag.arriveB as any).target.set(x, 0, z);
    ag.arriveB.weight = weight;
  }
}

// ─────────────────────────────────────────────────────────────────────
//  LOOT
// ─────────────────────────────────────────────────────────────────────

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

function botWantsItem(ag: TDMAgent, item: any): boolean {
  if (item.category === 'weapon') {
    if (ag.weaponId === 'unarmed' || ag.weaponId === 'knife') return true;
    const cur = WEAPONS[ag.weaponId]?.desirability ?? 0;
    const offered = WEAPONS[item.weaponId as keyof typeof WEAPONS]?.desirability ?? 0;
    return offered > cur;
  }
  if (item.category === 'ammo') {
    return ag.weaponId !== 'knife' && ag.ammo < ag.magSize * 2;
  }
  if (item.category === 'heal') return ag.hp < ag.maxHP;
  if (item.category === 'grenade') return ag.grenades < 3;
  return false;
}

function botWantsAnyItem(ag: TDMAgent, items: any[]): boolean {
  for (const it of items) if (botWantsItem(ag, it)) return true;
  return false;
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

function findNearestWantedLoot(ag: TDMAgent, radius: number): { id: number; x: number; z: number } | null {
  const candidates = lootGrid.queryRadius(ag.position.x, ag.position.z, radius);
  let best: { id: number; x: number; z: number; d2: number } | null = null;
  for (const c of candidates) {
    if (!c.obj.alive) continue;
    if (isInsideCollider(c.obj.x, c.obj.z)) continue;
    if (!botWantsAnyItem(ag, c.obj.items)) continue;
    if (!best || c.distSq < best.d2) {
      best = { id: c.obj.id, x: c.obj.x, z: c.obj.z, d2: c.distSq };
    }
  }
  return best ? { id: best.id, x: best.x, z: best.z } : null;
}

function findNearestPOI(ag: TDMAgent): { x: number; z: number } | null {
  const map = getBRMapData();
  if (!map) return null;
  let best: { x: number; z: number; d2: number } | null = null;
  for (const poi of map.pois) {
    // Avoid picking a POI that's outside the current zone.
    if (zone.active && isOutsideZone(poi.x, poi.z)) continue;
    const dx = poi.x - ag.position.x;
    const dz = poi.z - ag.position.z;
    const d2 = dx * dx + dz * dz;
    if (!best || d2 < best.d2) best = { x: poi.x, z: poi.z, d2 };
  }
  return best ? { x: best.x, z: best.z } : null;
}

function tryPickupNearby(ag: TDMAgent, state: BRBotState): void {
  const nearby = lootGrid.queryRadius(ag.position.x, ag.position.z, 2.5);
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

// ─────────────────────────────────────────────────────────────────────
//  ZONE AWARENESS
// ─────────────────────────────────────────────────────────────────────

function rotateToZone(ag: TDMAgent, innerFactor = 0.5): void {
  if (!zone.active) return;
  const target = zone.isShrinking ? zone.targetCenter : zone.currentCenter;
  const targetR = zone.isShrinking ? zone.targetRadius : zone.currentRadius;
  const dx = target.x - ag.position.x;
  const dz = target.y - ag.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz) || 1;
  const tx = target.x - (dx / dist) * Math.max(4, targetR * innerFactor);
  const tz = target.y - (dz / dist) * Math.max(4, targetR * innerFactor);
  goTo(ag, tx, tz, 1.5);
}

// ─────────────────────────────────────────────────────────────────────
//  PHASE DECISION
// ─────────────────────────────────────────────────────────────────────

function isEffectivelyUnarmed(ag: TDMAgent): boolean {
  return ag.weaponId === 'unarmed' || ag.weaponId === 'knife';
}

function determinePhase(ag: TDMAgent, state: BRBotState, now: number): BRBotPhase {
  const hpRatio = ag.hp / ag.maxHP;
  const unarmed = isEffectivelyUnarmed(ag);
  const hasTarget = !!ag.currentTarget && !ag.currentTarget.isDead;
  const outside = isOutsideZone(ag.position.x, ag.position.z);
  const nearEdge = distanceToZoneEdge(ag.position.x, ag.position.z) < 25;
  const suppressed = now < state.combatSuppressUntil;

  // 1) Storm damage is the hardest constraint.
  if (outside) return 'storm_flee';

  // 2) Critically wounded and recently shot → retreat unconditionally.
  if (hpRatio < 0.3 && (now - ag.lastDamageTime) < 4) return 'retreating';

  // 3) Combat — but only if armed and past the opening lull.
  if (hasTarget && !suppressed && !unarmed) {
    if (hpRatio < 0.25) return 'retreating';
    const distToTarget = ag.position.distanceTo(ag.currentTarget!.position);
    // Very close + knife-range weapon → fight. Otherwise gun check.
    if (ag.ammo <= 0 && distToTarget > 4) return 'retreating';
    return 'engaging';
  }

  // 4) Unarmed near enemy → retreat (they can't fight back).
  if (unarmed && hasTarget) {
    const distToTarget = ag.position.distanceTo(ag.currentTarget!.position);
    if (distToTarget < 22) return 'retreating';
  }

  // 5) Still unarmed → loot is the only priority.
  if (unarmed) return 'loot_urgent';

  // 6) Zone pressure — rotate before you're forced.
  if (nearEdge && zone.active && zone.isShrinking) return 'rotating';
  if (zone.active && zone.isShrinking && distanceToZoneEdge(ag.position.x, ag.position.z) < 15) {
    return 'rotating';
  }

  // 7) Late game / small circle → hunt.
  if (zone.active && zone.currentRadius > 0 && zone.currentRadius < 45) {
    return 'hunting';
  }

  // 8) Mid game decisions: keep looting if under-geared or wounded.
  if (!state.hasLooted) return 'loot_safe';
  if (hpRatio < 0.65 && Math.random() < 0.5) return 'loot_safe';
  if (ag.ammo < ag.magSize * 0.3) return 'loot_safe';

  // 9) Otherwise — personality decides between hunting and roaming-loot.
  const p = ag.personality;
  if (p && p.aggressionBias > 0.05) return 'hunting';
  return Math.random() < 0.35 ? 'hunting' : 'loot_safe';
}

// ─────────────────────────────────────────────────────────────────────
//  PHASE HANDLERS
// ─────────────────────────────────────────────────────────────────────

function handleStormFlee(ag: TDMAgent): void {
  rotateToZone(ag, 0.4);
  // Sprint back — storm damage compounds fast.
  const base = CLASS_CONFIGS[ag.botClass].maxSpeed;
  ag.maxSpeed = base * 1.3;
}

function handleRetreating(ag: TDMAgent, state: BRBotState): void {
  const threat = ag.lastAttacker ?? ag.currentTarget;

  if (threat && !threat.isDead) {
    // Prefer actual cover geometry.
    const cover = findCoverFrom(ag, threat.position);
    if (cover) {
      goTo(ag, cover.x, cover.z, 1.7);
      ag.currentCover = cover;
      return;
    }
    // Nothing? Run directly away.
    const ax = ag.position.x - threat.position.x;
    const az = ag.position.z - threat.position.z;
    const d = Math.hypot(ax, az) || 1;
    let fx = ag.position.x + (ax / d) * 18;
    let fz = ag.position.z + (az / d) * 18;
    if (isInsideCollider(fx, fz)) {
      const safe = pushOutOfWall(fx, fz);
      fx = safe.x; fz = safe.z;
    }
    goTo(ag, fx, fz, 1.8);
    return;
  }

  // No immediate threat — break for a nearby building to heal up.
  const b = buildingGrid.nearest(ag.position.x, ag.position.z, 60);
  if (b && b.obj.doorPositions.length > 0) {
    const door = b.obj.doorPositions[0];
    goTo(ag, door.x, door.z, 1.4);
    return;
  }
  rotateToZone(ag);
}

function handleLootUrgent(ag: TDMAgent, state: BRBotState): void {
  // If an enemy shows up while unarmed, retreat instead of looting.
  if (ag.currentTarget && !ag.currentTarget.isDead) {
    const d = ag.position.distanceTo(ag.currentTarget.position);
    if (d < 20) { handleRetreating(ag, state); return; }
  }

  const loot = findNearestWantedLoot(ag, 60);
  if (loot) {
    state.lootTargetId = loot.id;
    goTo(ag, loot.x, loot.z, 1.7);
    return;
  }

  // No visible loot — head to the nearest POI to search buildings.
  const poi = findNearestPOI(ag);
  if (poi) {
    state.poiTarget = poi;
    state.poiTargetSetAt = gameState.worldElapsed;
    goTo(ag,
      poi.x + (Math.random() - 0.5) * 10,
      poi.z + (Math.random() - 0.5) * 10,
      1.5);
    return;
  }
  clearSteering(ag);
  if (ag.wanderB) ag.wanderB.weight = 1;
}

function handleLootSafe(ag: TDMAgent, state: BRBotState): void {
  const loot = findNearestWantedLoot(ag, 40);
  if (loot) {
    state.lootTargetId = loot.id;
    goTo(ag, loot.x, loot.z, 1.3);
    return;
  }

  // If we've sat at a POI for > 8s without finding loot, pick a new one.
  const now = gameState.worldElapsed;
  if (state.poiTarget && (now - state.poiTargetSetAt) > 8) {
    state.poiTarget = null;
  }

  if (!state.poiTarget) {
    const poi = findNearestPOI(ag);
    if (poi) {
      state.poiTarget = poi;
      state.poiTargetSetAt = now;
    }
  }

  if (state.poiTarget) {
    goTo(ag, state.poiTarget.x, state.poiTarget.z, 1.2);
    return;
  }

  clearSteering(ag);
  if (ag.wanderB) ag.wanderB.weight = 1;
}

function handleRotating(ag: TDMAgent): void {
  rotateToZone(ag, 0.5);
}

function handleHunting(ag: TDMAgent): void {
  // Investigate any last-known enemy position.
  if (ag.hasLastKnown) {
    goTo(ag, ag.lastKnownPos.x, ag.lastKnownPos.z, 1.3);
    return;
  }
  // Otherwise push toward the current circle centre — that's where the
  // fight ultimately converges.
  if (zone.active) {
    const dx = zone.currentCenter.x - ag.position.x;
    const dz = zone.currentCenter.y - ag.position.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > zone.currentRadius * 0.35) {
      const tx = zone.currentCenter.x - (dx / d) * zone.currentRadius * 0.35;
      const tz = zone.currentCenter.y - (dz / d) * zone.currentRadius * 0.35;
      goTo(ag, tx, tz, 1.2);
      return;
    }
  }
  clearSteering(ag);
  if (ag.wanderB) ag.wanderB.weight = 1;
}

// ─────────────────────────────────────────────────────────────────────
//  FRAME UPDATE
// ─────────────────────────────────────────────────────────────────────

/**
 * Called per-frame for each active, LOD-gated BR bot.
 * Must be called AFTER updateAI so we can override its steering for
 * non-combat phases but still honour combat goals when 'engaging'.
 */
export function updateBRBot(ag: TDMAgent, dt: number): void {
  const state = getBRState(ag);
  if (!state) return;
  if (state.phase === 'inactive') return;

  const now = gameState.worldElapsed;

  botGrid.update(ag, ag.position.x, ag.position.z);
  updateBotVisualLOD(ag, state, now);

  if (ag.renderComponent) {
    ag.renderComponent.visible = state.lodTier < 3;
  }

  // Default speed — handlers may override (e.g. storm_flee).
  ag.maxSpeed = CLASS_CONFIGS[ag.botClass].maxSpeed;

  // Stuck detection — uses building door routing to escape building geometry.
  const moveDx = ag.position.x - state.lastX;
  const moveDz = ag.position.z - state.lastZ;
  if (moveDx * moveDx + moveDz * moveDz < 0.04) state.stuckTimer += dt;
  else state.stuckTimer = 0;
  state.lastX = ag.position.x;
  state.lastZ = ag.position.z;

  if (state.stuckTimer > 1.2) {
    state.stuckTimer = 0;
    state.lootTargetId = null;
    state.poiTarget = null;

    const nearbyB = buildingGrid.queryRadius(ag.position.x, ag.position.z, 25);
    let bestDoor: { x: number; z: number } | null = null;
    let bestDist = Infinity;
    for (const entry of nearbyB) {
      const b = entry.obj;
      if (Math.abs(ag.position.x - b.cx) < b.hw + 1.5 &&
          Math.abs(ag.position.z - b.cz) < b.hd + 1.5) {
        for (const door of b.doorPositions) {
          const ddx = ag.position.x - door.x;
          const ddz = ag.position.z - door.z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < bestDist) { bestDist = d2; bestDoor = door; }
        }
      }
    }

    if (bestDoor) {
      goTo(ag, bestDoor.x, bestDoor.z, 2.0);
    } else {
      const pushed = pushOutOfWall(ag.position.x, ag.position.z);
      ag.position.set(pushed.x, 0, pushed.z);
      clearSteering(ag);
      if (ag.wanderB) ag.wanderB.weight = 1.5;
    }
  }

  // Re-evaluate phase a few times per second (not every frame — too spammy).
  if (now - state.lastPhaseDecision > 0.25) {
    state.lastPhaseDecision = now;
    const newPhase = determinePhase(ag, state, now);
    if (newPhase !== state.phase) {
      state.phase = newPhase;
      state.phaseStart = now;
    }
  }

  // Phase execution. 'engaging' intentionally does nothing here — updateAI
  // already set combat steering before we ran, and we leave it alone.
  switch (state.phase) {
    case 'storm_flee':  handleStormFlee(ag); break;
    case 'retreating':  handleRetreating(ag, state); break;
    case 'loot_urgent': handleLootUrgent(ag, state); break;
    case 'loot_safe':   handleLootSafe(ag, state); break;
    case 'rotating':    handleRotating(ag); break;
    case 'hunting':     handleHunting(ag); break;
    case 'engaging':    /* updateAI owns steering */ break;
  }

  // Pickup is opportunistic and cheap — runs every phase.
  tryPickupNearby(ag, state);
}
