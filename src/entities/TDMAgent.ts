import * as THREE from 'three';
import * as YUKA from 'yuka';
import { CLASS_CONFIGS, type BotClass } from '@/config/classes';
import { TEAM_COLORS, type TeamId } from '@/config/constants';
import { CLASS_DEFAULT_WEAPON, WEAPONS, type WeaponId } from '@/config/weapons';
import type { Personality } from '@/ai/Personality';
import { createAimState, type AimState } from '@/ai/HumanAim';

/**
 * Tactical memory entry for a known enemy.
 */
export interface EnemyMemoryEntry {
  /** Position where the enemy was last observed */
  lastSeenPos: YUKA.Vector3;
  /** World time of last observation */
  lastSeenTime: number;
  /** Source of the sighting: visual, audio, callout, damage */
  source: 'visual' | 'audio' | 'callout' | 'damage';
  /** Confidence 0-1 (decays over time) */
  confidence: number;
  /** Estimated threat level 0-100 */
  threat: number;
  /** Was the enemy moving when last seen */
  wasMoving: boolean;
  /** Last known velocity direction for prediction */
  lastVelocity: YUKA.Vector3;
}

/**
 * TDM Agent — extends YUKA Vehicle with combat stats, goal-driven AI, and rendering references.
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

  // State machine (kept for animation state name mapping only, not for runtime decisions)
  declare stateMachine: YUKA.StateMachine<TDMAgent>;

  // Goal-driven brain — the SOLE authoritative runtime decision system
  brain: YUKA.Think<TDMAgent>;

  // ═══════════════════════════════════════════
  //  ADVANCED AI PROPERTIES
  // ═══════════════════════════════════════════

  /** How long continuously tracking the current target (improves accuracy) */
  trackingTime: number;

  /** Combat strafing direction: -1 = left, 1 = right */
  strafeDir: number;
  /** Timer before changing strafe direction */
  strafeTimer: number;

  /** World time when agent last took damage */
  lastDamageTime: number;
  /** How much damage taken in the last 2 seconds (damage pressure) */
  recentDamage: number;
  /** Whether currently under significant damage pressure */
  underPressure: boolean;
  /** Pressure intensity 0-1, affects retreat urgency, fire discipline, aggression */
  pressureLevel: number;

  /** Enemy position shared by a teammate callout */
  teamCallout: YUKA.Vector3 | null;
  /** When the callout was received */
  teamCalloutTime: number;

  /** Whether the agent is actively navigating to a pickup */
  seekingPickup: boolean;
  /** Position of the pickup being sought */
  seekPickupPos: YUKA.Vector3 | null;

  /** Timer for combat micro-movement decisions */
  combatMoveTimer: number;

  /** Confidence level (0-100): builds on kills, drops on deaths. Affects aggression. */
  confidence: number;

  /** Number of nearby alive teammates (updated periodically) */
  nearbyAllies: number;
  /** Timer for counting nearby allies */
  allyCheckTimer: number;

  /** How long the agent has been in the current state */
  stateTime: number;

  /** Whether the agent is peeking from cover to shoot */
  isPeeking: boolean;
  /** Timer for peek duration */
  peekTimer: number;

  /** The agent that last damaged this agent */
  lastAttacker: TDMAgent | null;

  /** Accumulated kill streak (resets on death) */
  killStreak: number;

  /** Current weapon */
  weaponId: WeaponId;
  /** Number of grenades remaining */
  grenades: number;
  /** Grenade cooldown timer */
  grenadeCooldown: number;
  /** Whether seeking a weapon pickup */
  seekingWeapon: boolean;

  /** Timer for proactive enemy hunting when idle */
  huntTimer: number;

  /** Stuck detection: tracks how long the agent hasn't moved */
  stuckTime: number;
  /** Last position sample for stuck detection */
  lastStuckCheckPos: YUKA.Vector3;

  // ═══════════════════════════════════════════
  //  TACTICAL MEMORY
  // ═══════════════════════════════════════════

  /** Per-enemy memory: keyed by enemy name for fast lookup */
  enemyMemory: Map<string, EnemyMemoryEntry>;
  /** Frame slot for staggered perception (assigned at creation) */
  perceptionSlot: number;
  /** Cached pickup scan result (refreshed periodically) */
  cachedNearbyPickups: { pos: YUKA.Vector3; type: string; weaponId?: WeaponId; dist: number }[];
  /** Timer for pickup cache refresh */
  pickupCacheTimer: number;

  // ═══════════════════════════════════════════
  //  NAVMESH NAVIGATION (optional)
  // ═══════════════════════════════════════════
  navPath: YUKA.Vector3[];
  navWaypointIndex: number;
  navDestination: YUKA.Vector3 | null;
  navMode: 'none' | 'arrive' | 'seek';
  navTolerance: number;
  navRepathTimer: number;
  navCurrentRegion: any;

  /** Preferred engagement distance for this class */
  preferredRange: number;

  // ═══════════════════════════════════════════════
  //  HUMANIZATION
  // ═══════════════════════════════════════════════

  /** Personality profile — assigned by factory */
  personality: Personality | null;

  /** Simulated crosshair state */
  aim: AimState | null;

  /** Temporary skill debuff from being tilted (0 = no tilt, 1 = fully tilted) */
  tiltLevel: number;

  /** World time until which this bot is committed to current goal (prevents flip-flopping) */
  commitmentUntil: number;

  /** Timer for when to think about repositioning proactively */
  repositionUrge: number;

  /** Target of a "revenge hunt" — bot who killed them recently */
  grudge: TDMAgent | null;
  grudgeExpiry: number;

  /** Pre-aim target — speculative direction for corner peeks */
  preAimPos: YUKA.Vector3 | null;

  /** How much time has been spent focused on same area (builds focus, burns attention) */
  focusTime: number;

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

    // Goal-driven brain — sole authority
    this.brain = new YUKA.Think(this);

    // ── Advanced AI ──
    this.trackingTime = 0;
    this.strafeDir = Math.random() > 0.5 ? 1 : -1;
    this.strafeTimer = 0.3 + Math.random() * 0.5;
    this.lastDamageTime = -10;
    this.recentDamage = 0;
    this.underPressure = false;
    this.pressureLevel = 0;
    this.teamCallout = null;
    this.teamCalloutTime = -10;
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

    // Tactical memory
    this.enemyMemory = new Map();
    this.perceptionSlot = 0; // assigned by factory
    this.cachedNearbyPickups = [];
    this.pickupCacheTimer = 0;

    // NavMesh navigation (optional)
    this.navPath = [];
    this.navWaypointIndex = 0;
    this.navDestination = null;
    this.navMode = 'none';
    this.navTolerance = 2.5;
    this.navRepathTimer = 0;
    this.navCurrentRegion = null;

    // Preferred engagement range by class / weapon
    switch (botClass) {
      case 'sniper':
        this.preferredRange = 35;
        break;
      case 'assault':
        this.preferredRange = 10;
        break;
      case 'flanker':
        this.preferredRange = 8;
        break;
      default:
        this.preferredRange = 18;
        break;
    }

    // ── Humanization ──
    this.personality = null;
    this.aim = createAimState();
    this.tiltLevel = 0;
    this.commitmentUntil = 0;
    this.repositionUrge = 0;
    this.grudge = null;
    this.grudgeExpiry = 0;
    this.preAimPos = null;
    this.focusTime = 0;
  }

  /**
   * Full tactical reset on respawn. Clears ALL stale combat/goal/memory state.
   */
  resetTacticalState(): void {
    this.brain.clearSubgoals();
    this.stateName = 'PATROL';
    this.stateTime = 0;
    this.hasLastKnown = false;
    this.alertLevel = 0;
    this.currentTarget = null;
    this.hasTarget = false;
    this.burstCount = 0;
    this.shootTimer = 0;
    this.reactionTimer = 0;
    this.trackingTime = 0;
    this.recentDamage = 0;
    this.underPressure = false;
    this.pressureLevel = 0;
    this.lastAttacker = null;
    this.seekingPickup = false;
    this.seekPickupPos = null;
    this.isPeeking = false;
    this.peekTimer = 0;
    this.teamCallout = null;
    this.currentCover = null;
    this.huntTimer = Math.random() * 2;
    this.stuckTime = 0;
    this.lastStuckCheckPos.copy(this.position);
    this.decisionTimer = 0;
    this.combatMoveTimer = 0;
    this.fuzzyAggr = 50;
    this.enemyMemory.clear();
    this.cachedNearbyPickups = [];
    this.pickupCacheTimer = 0;

    // Clear nav state
    this.navPath.length = 0;
    this.navWaypointIndex = 0;
    this.navDestination = null;
    this.navMode = 'none';
    this.navRepathTimer = 0;

    // Humanization — note we DO NOT reset personality (persistent across lives)
    // but tilt decays over time, grudge can persist briefly
    this.aim = createAimState();
    this.commitmentUntil = 0;
    this.repositionUrge = 0;
    this.preAimPos = null;
    this.focusTime = 0;
    // tiltLevel is preserved so respawning doesn't instantly undo a bad run's tilt
    // grudge is preserved so they hunt their killer after respawn
  }
}
