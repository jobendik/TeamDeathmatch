import * as THREE from 'three';
import * as YUKA from 'yuka';
import { CLASS_CONFIGS, type BotClass } from '@/config/classes';
import { TEAM_COLORS, type TeamId } from '@/config/constants';
import { CLASS_DEFAULT_WEAPON, WEAPONS, type WeaponId } from '@/config/weapons';
import type { AimPhase, EnemyMemory, PeekSide, TacticalRole, TeamCallout } from '@/ai/AITypes';

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function pickRole(botClass: BotClass): TacticalRole {
  switch (botClass) {
    case 'sniper': return 'sniper';
    case 'flanker': return Math.random() < 0.65 ? 'flanker' : 'lurker';
    case 'assault': return Math.random() < 0.55 ? 'point' : 'support';
    default: return Math.random() < 0.3 ? 'trader' : 'anchor';
  }
}

/**
 * TDM Agent — extends YUKA Vehicle with combat stats, advanced AI, and rendering references.
 */
export class TDMAgent extends YUKA.Vehicle {
  // Identity
  declare name: string;
  team: TeamId;
  botClass: BotClass;

  // Stats
  hp: number;
  maxHP: number;
  isDead: boolean;
  respawnAt: number;
  spawnPos: YUKA.Vector3;
  color: number;

  // Combat
  damage: number;
  fireRate: number;
  burstSize: number;
  burstDelay: number;
  reloadTime: number;
  magSize: number;
  ammo: number;
  aimError: number;
  reactionTime: number;
  retreatThreshold: number;
  flankPreference: number;
  aggressivenessBase: number;

  // Timers
  shootTimer: number;
  burstCount: number;
  burstTimer: number;
  reloadTimer: number;
  isReloading: boolean;
  reactionTimer: number;
  hasTarget: boolean;
  decisionTimer: number;
  coverTimer: number;
  repositionTimer: number;

  // AI state
  stateName: string;
  currentTarget: TDMAgent | null;
  lastKnownPos: YUKA.Vector3;
  hasLastKnown: boolean;
  currentCover: YUKA.Vector3 | null;
  alertLevel: number;

  // Score tracking
  kills: number;
  deaths: number;

  // Steering behaviors
  wanderB: YUKA.WanderBehavior | null;
  seekB: YUKA.SeekBehavior | null;
  arriveB: YUKA.ArriveBehavior | null;
  fleeB: YUKA.FleeBehavior | null;
  pursuitB: YUKA.PursuitBehavior | null;
  avoidB: YUKA.ObstacleAvoidanceBehavior | null;

  // Vision
  visionRange: number;
  visionFOV: number;

  // Rendering
  declare renderComponent: THREE.Group | null;
  nameTag: THREE.Sprite | null;
  hpBarGroup: THREE.Group | null;
  hpBarFg: THREE.Mesh | null;

  // Fuzzy logic
  fuzzyModule: YUKA.FuzzyModule | null;
  fuzzyAggr: number;

  // State machine (legacy — kept for compatibility)
  declare stateMachine: YUKA.StateMachine<TDMAgent>;

  // Goal-driven brain
  brain: YUKA.Think<TDMAgent>;

  // Advanced combat state
  trackingTime: number;
  strafeDir: number;
  strafeTimer: number;
  lastDamageTime: number;
  recentDamage: number;
  teamCallout: YUKA.Vector3 | null;
  teamCalloutTime: number;
  teamCalloutCertainty: number;
  activeCallout: TeamCallout | null;
  seekingPickup: boolean;
  seekPickupPos: YUKA.Vector3 | null;
  combatMoveTimer: number;
  confidence: number;
  preferredRange: number;
  nearbyAllies: number;
  allyCheckTimer: number;
  stateTime: number;
  isPeeking: boolean;
  peekTimer: number;
  lastAttacker: TDMAgent | null;
  killStreak: number;
  weaponId: WeaponId;
  grenades: number;
  grenadeCooldown: number;
  seekingWeapon: boolean;
  huntTimer: number;
  stuckTime: number;
  lastStuckCheckPos: YUKA.Vector3;

  // Personality and humanization
  tacticalRole: TacticalRole;
  preferredPeekSide: PeekSide;
  discipline: number;             // 0..1
  bravery: number;                // 0..1
  patience: number;               // 0..1
  curiosity: number;              // 0..1
  chaseBias: number;              // 0..1
  peekBias: number;               // 0..1
  communicationAccuracy: number;  // 0..1
  calloutTrust: number;           // 0..1
  motorSkill: number;             // 0..1
  trackingSkill: number;          // 0..1
  stress: number;                 // 0..100
  tilt: number;                   // 0..100
  routeCommitUntil: number;
  intentCommitUntil: number;
  hesitationTimer: number;

  // Perception and tactical memory
  enemyMemories: Map<string, EnemyMemory>;
  currentTargetId: string | null;
  targetCertainty: number;
  lastVisibleEnemyTime: number;
  investigatePos: YUKA.Vector3 | null;

  // Aim controller
  aimPhase: AimPhase;
  aimPhaseTime: number;
  aimStability: number;           // 0..1
  aimTargetId: string | null;
  aimPoint: YUKA.Vector3;
  aimOvershoot: number;
  aimLateralSign: number;
  fireDisciplineTimer: number;

  constructor(name: string, team: TeamId, botClass: BotClass) {
    super();
    this.name = name;
    this.team = team;
    this.botClass = botClass;

    const cfg = CLASS_CONFIGS[botClass] || CLASS_CONFIGS.rifleman;
    this.maxSpeed = cfg.maxSpeed;
    this.maxForce = 12;
    this.mass = 1;
    this.boundingRadius = 0.65;
    this.smoother = new YUKA.Smoother(10);
    this.updateNeighborhood = true;
    this.neighborhoodRadius = 5;

    // Stats
    this.hp = cfg.hp;
    this.maxHP = cfg.hp;
    this.isDead = false;
    this.respawnAt = 0;
    this.spawnPos = new YUKA.Vector3();
    this.color = TEAM_COLORS[team];

    // Combat
    this.damage = cfg.damage;
    this.fireRate = cfg.fireRate;
    this.burstSize = cfg.burstSize;
    this.burstDelay = cfg.burstDelay;
    this.reloadTime = cfg.reloadTime;
    this.magSize = cfg.magSize;
    this.ammo = cfg.magSize;
    this.aimError = cfg.aimError;
    this.reactionTime = cfg.reactionTime;
    this.retreatThreshold = cfg.retreatThreshold;
    this.flankPreference = cfg.flankPreference;
    this.aggressivenessBase = cfg.aggressiveness;

    // Timers
    this.shootTimer = 0;
    this.burstCount = 0;
    this.burstTimer = 0;
    this.reloadTimer = 0;
    this.isReloading = false;
    this.reactionTimer = 0;
    this.hasTarget = false;
    this.decisionTimer = 0;
    this.coverTimer = 0;
    this.repositionTimer = 0;

    // AI state
    this.stateName = 'SPAWN';
    this.currentTarget = null;
    this.lastKnownPos = new YUKA.Vector3();
    this.hasLastKnown = false;
    this.currentCover = null;
    this.alertLevel = 0;

    // Score
    this.kills = 0;
    this.deaths = 0;

    // Steering
    this.wanderB = null;
    this.seekB = null;
    this.arriveB = null;
    this.fleeB = null;
    this.pursuitB = null;
    this.avoidB = null;

    // Vision
    this.visionRange = cfg.visionRange;
    this.visionFOV = cfg.visionFOV;

    // Rendering
    this.nameTag = null;
    this.hpBarGroup = null;
    this.hpBarFg = null;

    // Fuzzy
    this.fuzzyModule = null;
    this.fuzzyAggr = 50;

    // Goal-driven brain
    this.brain = new YUKA.Think(this);

    // Advanced AI state
    this.trackingTime = 0;
    this.strafeDir = Math.random() > 0.5 ? 1 : -1;
    this.strafeTimer = 0.3 + Math.random() * 0.5;
    this.lastDamageTime = -10;
    this.recentDamage = 0;
    this.teamCallout = null;
    this.teamCalloutTime = -10;
    this.teamCalloutCertainty = 0;
    this.activeCallout = null;
    this.seekingPickup = false;
    this.seekPickupPos = null;
    this.combatMoveTimer = 0;
    this.confidence = 50;
    this.nearbyAllies = 0;
    this.allyCheckTimer = 0;
    this.stateTime = 0;
    this.isPeeking = false;
    this.peekTimer = 0;
    this.lastAttacker = null;
    this.killStreak = 0;

    // Weapon system
    this.weaponId = CLASS_DEFAULT_WEAPON[botClass] || 'assault_rifle';
    const wepDef = WEAPONS[this.weaponId];
    this.damage = wepDef.damage;
    this.fireRate = wepDef.fireRate;
    this.burstSize = wepDef.burstSize;
    this.burstDelay = wepDef.burstDelay;
    this.reloadTime = wepDef.reloadTime;
    this.magSize = wepDef.magSize;
    this.ammo = wepDef.magSize;
    this.aimError = wepDef.aimError;
    this.grenades = 2;
    this.grenadeCooldown = 0;
    this.seekingWeapon = false;
    this.huntTimer = Math.random() * 2;

    // Stuck detection
    this.stuckTime = 0;
    this.lastStuckCheckPos = new YUKA.Vector3();

    // Preferred engagement range by class / weapon
    switch (botClass) {
      case 'sniper': this.preferredRange = 35; break;
      case 'assault': this.preferredRange = 10; break;
      case 'flanker': this.preferredRange = 8; break;
      default: this.preferredRange = 18; break;
    }

    // Personality and tactical identity
    this.tacticalRole = pickRole(botClass);
    this.preferredPeekSide = Math.random() < 0.5 ? 'left' : 'right';
    this.discipline = clamp01(rand(0.35, 0.9) + (botClass === 'sniper' ? 0.12 : 0));
    this.bravery = clamp01(rand(0.3, 0.9) + (botClass === 'assault' ? 0.12 : botClass === 'sniper' ? -0.08 : 0));
    this.patience = clamp01(rand(0.25, 0.85) + (botClass === 'sniper' ? 0.15 : 0));
    this.curiosity = clamp01(rand(0.2, 0.85) + (botClass === 'flanker' ? 0.1 : 0));
    this.chaseBias = clamp01(rand(0.25, 0.85) + (botClass === 'assault' || botClass === 'flanker' ? 0.1 : 0));
    this.peekBias = clamp01(rand(0.2, 0.85) + (this.preferredPeekSide === 'left' ? 0.03 : 0));
    this.communicationAccuracy = clamp01(rand(0.45, 0.95) + (botClass === 'sniper' ? 0.05 : 0));
    this.calloutTrust = clamp01(rand(0.35, 0.9));
    this.motorSkill = clamp01(rand(0.35, 0.95) + (botClass === 'sniper' ? 0.08 : 0));
    this.trackingSkill = clamp01(rand(0.35, 0.95) + (botClass === 'rifleman' ? 0.05 : 0));
    this.stress = rand(10, 35);
    this.tilt = 0;
    this.routeCommitUntil = 0;
    this.intentCommitUntil = 0;
    this.hesitationTimer = 0;

    // Perception and memory
    this.enemyMemories = new Map();
    this.currentTargetId = null;
    this.targetCertainty = 0;
    this.lastVisibleEnemyTime = -10;
    this.investigatePos = null;

    // Aim controller
    this.aimPhase = 'search';
    this.aimPhaseTime = 0;
    this.aimStability = 0;
    this.aimTargetId = null;
    this.aimPoint = new YUKA.Vector3();
    this.aimOvershoot = rand(0.1, 0.8);
    this.aimLateralSign = Math.random() < 0.5 ? -1 : 1;
    this.fireDisciplineTimer = 0;
  }
}
