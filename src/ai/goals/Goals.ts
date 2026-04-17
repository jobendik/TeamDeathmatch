import * as YUKA from 'yuka';
import type { TDMAgent } from '@/entities/TDMAgent';
import { CLASS_CONFIGS } from '@/config/classes';
import { findCoverFrom, findFlankPosition, findPeekCover, findSniperNest, findNearestPickup, isInsideWall, pushOutOfWall } from '@/ai/CoverSystem';
import { gameState } from '@/core/GameState';
import { TEAM_BLUE } from '@/config/constants';
import { WEAPONS } from '@/config/weapons';
import { getEnemyFlagTeam } from '@/core/GameModes';

// ═══════════════════════════════════════════
//  ATOMIC GOALS — leaf-level behaviors
// ═══════════════════════════════════════════

export class PatrolGoal extends YUKA.Goal<TDMAgent> {
  activate(): void {
    const ag = this.owner;
    ag.stateName = 'PATROL';
    ag.stateTime = 0;
    this.status = YUKA.Goal.STATUS.ACTIVE;
  }
  execute(): void {
    const ag = this.owner;
    if (ag.wanderB) ag.wanderB.weight = 1.0;
    if (ag.seekB) ag.seekB.weight = 0;
    if (ag.arriveB) ag.arriveB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;

    if (ag.teamCallout && ag.teamCalloutTime > ag.stateTime - 5) {
      ag.lastKnownPos.copy(ag.teamCallout);
      ag.hasLastKnown = true;
      ag.teamCallout = null;
    }
  }
  terminate(): void {
    const ag = this.owner;
    if (ag.wanderB) ag.wanderB.weight = 0;
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}

export class MoveToPositionGoal extends YUKA.Goal<TDMAgent> {
  targetPos: YUKA.Vector3;

  constructor(owner: TDMAgent, pos: YUKA.Vector3) {
    super(owner);
    this.targetPos = pos.clone();
  }

  activate(): void {
    const ag = this.owner;
    ag.stateName = 'INVESTIGATE';
    ag.stateTime = 0;
    if (isInsideWall(this.targetPos.x, this.targetPos.z)) {
      const safe = pushOutOfWall(this.targetPos.x, this.targetPos.z);
      this.targetPos.x = safe.x;
      this.targetPos.z = safe.z;
    }
    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;
    if (ag.seekB) ag.seekB.weight = 0;
    if (ag.arriveB) {
      ag.arriveB.weight = 1.3;
      (ag.arriveB as any).target.copy(this.targetPos);
    }

    if (ag.position.distanceTo(this.targetPos) < 3) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
    }
  }

  terminate(): void {
    const ag = this.owner;
    if (ag.arriveB) ag.arriveB.weight = 0;
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}

export class EngageCombatGoal extends YUKA.Goal<TDMAgent> {
  activate(): void {
    const ag = this.owner;
    ag.stateName = 'ENGAGE';
    ag.stateTime = 0;
    ag.combatMoveTimer = 0;
    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.arriveB) ag.arriveB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;

    if (ag.pursuitB) ag.pursuitB.weight = 0.8;

    if (ag.seekB && ag.currentTarget) {
      const toTarget = new YUKA.Vector3().subVectors(ag.currentTarget.position, ag.position);
      const dist = toTarget.length();
      toTarget.normalize();

      const perpX = -toTarget.z * ag.strafeDir;
      const perpZ = toTarget.x * ag.strafeDir;

      let rangeFactor = 0;
      if (dist > ag.preferredRange + 5) rangeFactor = 0.5;
      else if (dist < ag.preferredRange - 5) rangeFactor = -0.6;

      const strafeMultiplier = ag.botClass === 'flanker' ? 12 : (ag.botClass === 'assault' ? 10 : 8);

      let seekX = ag.position.x + perpX * strafeMultiplier + toTarget.x * rangeFactor * 8;
      let seekZ = ag.position.z + perpZ * strafeMultiplier + toTarget.z * rangeFactor * 8;

      if (isInsideWall(seekX, seekZ)) {
        const safe = pushOutOfWall(seekX, seekZ);
        seekX = safe.x;
        seekZ = safe.z;
      }

      (ag.seekB as any).target.set(seekX, 0, seekZ);
      ag.seekB.weight = 1.4;
      if (ag.pursuitB) ag.pursuitB.weight = 0.2;
    }

    if (!ag.currentTarget || ag.currentTarget.isDead) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
    }
  }

  terminate(): void {
    const ag = this.owner;
    if (ag.seekB) ag.seekB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}

export class RetreatGoal extends YUKA.Goal<TDMAgent> {
  private origSpeed = 0;

  activate(): void {
    const ag = this.owner;
    ag.stateName = 'RETREAT';
    ag.stateTime = 0;
    this.origSpeed = ag.maxSpeed;
    // Retreat speed scales with pressure urgency
    ag.maxSpeed *= 1.15 + ag.pressureLevel * 0.15;
    if (ag.currentTarget) {
      const cover = findCoverFrom(ag, ag.currentTarget.position);
      if (cover) ag.currentCover = cover;
    }
    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;

    if (ag.arriveB) {
      ag.arriveB.weight = 1.5;
      if (ag.currentCover) {
        (ag.arriveB as any).target.copy(ag.currentCover);
      } else {
        (ag.arriveB as any).target.copy(ag.spawnPos);
      }
    }

    if (ag.seekB && ag.currentTarget) {
      const away = new YUKA.Vector3().subVectors(ag.position, ag.currentTarget.position).normalize();
      const perpX = -away.z * ag.strafeDir;
      const perpZ = away.x * ag.strafeDir;
      let rx = ag.position.x + perpX * 7 + away.x * 4;
      let rz = ag.position.z + perpZ * 7 + away.z * 4;
      if (isInsideWall(rx, rz)) {
        const safe = pushOutOfWall(rx, rz);
        rx = safe.x;
        rz = safe.z;
      }
      (ag.seekB as any).target.set(rx, 0, rz);
      ag.seekB.weight = 0.8;
    } else if (ag.seekB) {
      ag.seekB.weight = 0;
    }

    if (ag.currentCover && ag.position.distanceTo(ag.currentCover) < 3) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
    }
    if (ag.stateTime > 5) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
    }
  }

  terminate(): void {
    const ag = this.owner;
    const cfg = CLASS_CONFIGS[ag.botClass];
    if (cfg) ag.maxSpeed = cfg.maxSpeed;
    if (ag.seekB) ag.seekB.weight = 0;
    if (ag.arriveB) ag.arriveB.weight = 0;
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}

export class TakeCoverGoal extends YUKA.Goal<TDMAgent> {
  duration: number;

  constructor(owner: TDMAgent, duration: number = 2.5) {
    super(owner);
    this.duration = duration;
  }

  activate(): void {
    const ag = this.owner;
    ag.stateName = 'COVER';
    ag.stateTime = 0;
    ag.isBotCrouching = true;
    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;
    if (ag.seekB) ag.seekB.weight = 0;
    if (ag.arriveB) {
      ag.arriveB.weight = 1.4;
      if (ag.currentCover) (ag.arriveB as any).target.copy(ag.currentCover);
    }

    // Under pressure: stay in cover longer
    const effectiveDuration = this.duration + (ag.underPressure ? ag.pressureLevel * 2 : 0);

    if (ag.stateTime >= effectiveDuration) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
    }
    if (ag.hp >= ag.maxHP * 0.9 && ag.ammo >= ag.magSize * 0.5) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
    }
  }

  terminate(): void {
    const ag = this.owner;
    ag.isBotCrouching = false;
    if (ag.arriveB) ag.arriveB.weight = 0;
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}

export class PeekGoal extends YUKA.Goal<TDMAgent> {
  peekDuration = 0;

  activate(): void {
    const ag = this.owner;
    ag.stateName = 'PEEK';
    ag.stateTime = 0;
    ag.isPeeking = true;
    if (ag.currentCover && ag.currentTarget) {
      const dx = ag.currentTarget.position.x - ag.currentCover.x;
      ag.botLeanDir = dx > 0 ? 1 : -1;
    }
    const baseDuration = 0.6 + Math.random() * 0.8;
    this.peekDuration = baseDuration * (1 - ag.pressureLevel * 0.5);
    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;

    if (ag.seekB && ag.currentTarget && ag.currentCover) {
      const toTarget = new YUKA.Vector3().subVectors(ag.currentTarget.position, ag.currentCover).normalize();
      (ag.seekB as any).target.set(
        ag.currentCover.x + toTarget.x * 3,
        0,
        ag.currentCover.z + toTarget.z * 3,
      );
      ag.seekB.weight = 1.5;
    }
    if (ag.arriveB) ag.arriveB.weight = 0;

    if (ag.stateTime >= this.peekDuration) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
    }
  }

  terminate(): void {
    const ag = this.owner;
    ag.isPeeking = false;
    ag.botLeanDir = 0;
    if (ag.seekB) ag.seekB.weight = 0;
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}

export class FlankGoal extends YUKA.Goal<TDMAgent> {
  flankPos: YUKA.Vector3 | null = null;

  activate(): void {
    const ag = this.owner;
    ag.stateName = 'FLANK';
    ag.stateTime = 0;
    if (ag.currentTarget) {
      this.flankPos = findFlankPosition(ag, ag.currentTarget.position);
    }
    this.status = this.flankPos ? YUKA.Goal.STATUS.ACTIVE : YUKA.Goal.STATUS.FAILED;
  }

  execute(): void {
    const ag = this.owner;
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;
    if (ag.arriveB) ag.arriveB.weight = 0;

    if (ag.seekB && this.flankPos) {
      (ag.seekB as any).target.copy(this.flankPos);
      ag.seekB.weight = 1.5;
    }

    if (this.flankPos && ag.position.distanceTo(this.flankPos) < 4) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
    }
    if (ag.stateTime > 6) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
    }
  }

  terminate(): void {
    const ag = this.owner;
    if (ag.seekB) ag.seekB.weight = 0;
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}

export class SeekPickupGoal extends YUKA.Goal<TDMAgent> {
  pickupType: 'health' | 'ammo' | 'weapon';

  constructor(owner: TDMAgent, type: 'health' | 'ammo' | 'weapon') {
    super(owner);
    this.pickupType = type;
  }

  activate(): void {
    const ag = this.owner;
    ag.stateName = 'SEEK_PICKUP';
    ag.stateTime = 0;
    ag.seekingPickup = true;
    const pickup = findNearestPickup(ag, this.pickupType);
    if (pickup && ag.position.distanceTo(pickup) < 50) {
      ag.seekPickupPos = pickup;
      this.status = YUKA.Goal.STATUS.ACTIVE;
    } else {
      this.status = YUKA.Goal.STATUS.FAILED;
    }
  }

  execute(): void {
    const ag = this.owner;
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;
    if (ag.seekB) ag.seekB.weight = 0;
    if (ag.arriveB) {
      ag.arriveB.weight = 1.6;
      if (ag.seekPickupPos) {
        (ag.arriveB as any).target.copy(ag.seekPickupPos);
      }
    }

    if (ag.seekPickupPos && ag.position.distanceTo(ag.seekPickupPos) < 3) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
    }
    // Don't abort weapon seek when unarmed just because enemy is near
    if (ag.weaponId !== 'unarmed' && ag.currentTarget && ag.position.distanceTo(ag.currentTarget.position) < 12) {
      this.status = YUKA.Goal.STATUS.FAILED;
    }
    if (ag.stateTime > 10) {
      this.status = YUKA.Goal.STATUS.FAILED;
    }
  }

  terminate(): void {
    const ag = this.owner;
    ag.seekingPickup = false;
    ag.seekPickupPos = null;
    if (ag.arriveB) ag.arriveB.weight = 0;
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}

export class TeamPushGoal extends YUKA.Goal<TDMAgent> {
  activate(): void {
    const ag = this.owner;
    ag.stateName = 'TEAM_PUSH';
    ag.stateTime = 0;
    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;

    if (ag.pursuitB) ag.pursuitB.weight = 1.5;

    if (ag.seekB && ag.currentTarget) {
      const toTarget = new YUKA.Vector3().subVectors(ag.currentTarget.position, ag.position).normalize();
      const perpX = -toTarget.z * ag.strafeDir;
      const perpZ = toTarget.x * ag.strafeDir;
      let px = ag.position.x + perpX * 4 + toTarget.x * 6;
      let pz = ag.position.z + perpZ * 4 + toTarget.z * 6;
      if (isInsideWall(px, pz)) {
        const safe = pushOutOfWall(px, pz);
        px = safe.x;
        pz = safe.z;
      }
      (ag.seekB as any).target.set(px, 0, pz);
      ag.seekB.weight = 0.5;
    }
    if (ag.arriveB) ag.arriveB.weight = 0;

    if (!ag.currentTarget || ag.currentTarget.isDead) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
    }
    if (ag.stateTime > 6) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
    }
  }

  terminate(): void {
    const ag = this.owner;
    if (ag.seekB) ag.seekB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}

function getCTFObjectivePosition(ag: TDMAgent): YUKA.Vector3 | null {
  if (gameState.mode !== 'ctf') return null;

  const ownFlag = gameState.flags[ag.team];
  const enemyFlag = gameState.flags[getEnemyFlagTeam(ag.team)];

  if (enemyFlag.carriedBy === ag) {
    return new YUKA.Vector3(ownFlag.base.x, 0, ownFlag.base.z);
  }

  if (ownFlag.dropped && (ag.botClass === 'rifleman' || ag.botClass === 'sniper')) {
    return new YUKA.Vector3(ownFlag.dropPos.x, 0, ownFlag.dropPos.z);
  }

  if (!enemyFlag.carriedBy) {
    const targetPos = enemyFlag.dropped ? enemyFlag.dropPos : enemyFlag.base;
    return new YUKA.Vector3(targetPos.x, 0, targetPos.z);
  }

  if (enemyFlag.carriedBy && enemyFlag.carriedBy.team === ag.team) {
    return new YUKA.Vector3(ownFlag.base.x, 0, ownFlag.base.z);
  }

  return new YUKA.Vector3(enemyFlag.carriedBy?.position.x ?? enemyFlag.base.x, 0, enemyFlag.carriedBy?.position.z ?? enemyFlag.base.z);
}

// ═══════════════════════════════════════════
//  COMPOSITE GOALS
// ═══════════════════════════════════════════

export class AttackTargetGoal extends YUKA.CompositeGoal<TDMAgent> {
  activate(): void {
    const ag = this.owner;
    this.clearSubgoals();

    if (!ag.currentTarget) {
      this.status = YUKA.Goal.STATUS.FAILED;
      return;
    }

    const dist = ag.position.distanceTo(ag.currentTarget.position);
    const hpRatio = ag.hp / ag.maxHP;

    if (ag.botClass === 'sniper') {
      if (dist < 10) {
        this.addSubgoal(new RetreatGoal(ag));
      } else if (dist > 25) {
        const nest = findSniperNest(ag, ag.currentTarget.position);
        if (nest && ag.position.distanceTo(nest) > 5) {
          ag.currentCover = nest;
          this.addSubgoal(new PeekGoal(ag));
          this.addSubgoal(new TakeCoverGoal(ag, 2 + Math.random() * 2));
        } else {
          this.addSubgoal(new EngageCombatGoal(ag));
        }
      } else {
        const peekCover = findPeekCover(ag, ag.currentTarget.position);
        if (peekCover) {
          ag.currentCover = peekCover;
          this.addSubgoal(new PeekGoal(ag));
          this.addSubgoal(new TakeCoverGoal(ag, 1.5 + Math.random() * 1.5));
        } else {
          this.addSubgoal(new EngageCombatGoal(ag));
        }
      }
    } else if (ag.botClass === 'flanker') {
      if (dist < 10) {
        this.addSubgoal(new EngageCombatGoal(ag));
      } else if (Math.random() < ag.flankPreference) {
        this.addSubgoal(new EngageCombatGoal(ag));
        this.addSubgoal(new FlankGoal(ag));
      } else {
        this.addSubgoal(new EngageCombatGoal(ag));
      }
    } else if (ag.botClass === 'assault') {
      if (ag.nearbyAllies >= 2 && ag.hp > ag.maxHP * 0.5 && ag.confidence > 40 && ag.fuzzyAggr > 55) {
        this.addSubgoal(new TeamPushGoal(ag));
      } else if (ag.fuzzyAggr > 50 || dist < 10) {
        this.addSubgoal(new EngageCombatGoal(ag));
      } else {
        const peekCover = findPeekCover(ag, ag.currentTarget.position);
        if (peekCover && Math.random() < 0.4) {
          ag.currentCover = peekCover;
          this.addSubgoal(new PeekGoal(ag));
          this.addSubgoal(new TakeCoverGoal(ag, 1 + Math.random()));
        } else {
          this.addSubgoal(new EngageCombatGoal(ag));
        }
      }
    } else {
      // Rifleman — balanced
      if (ag.nearbyAllies >= 2 && ag.hp > ag.maxHP * 0.5 && ag.confidence > 40 && ag.fuzzyAggr > 55) {
        this.addSubgoal(new TeamPushGoal(ag));
      } else if (hpRatio < 0.55 && Math.random() < 0.35) {
        const cover = findPeekCover(ag, ag.currentTarget.position) || findCoverFrom(ag, ag.currentTarget.position);
        if (cover) {
          ag.currentCover = cover;
          if (Math.random() < 0.5) {
            this.addSubgoal(new PeekGoal(ag));
            this.addSubgoal(new TakeCoverGoal(ag, 1.5 + Math.random() * 2));
          } else {
            this.addSubgoal(new TakeCoverGoal(ag, 1.5 + Math.random() * 2));
          }
        } else {
          this.addSubgoal(new EngageCombatGoal(ag));
        }
      } else if (ag.fuzzyAggr > 55) {
        this.addSubgoal(new EngageCombatGoal(ag));
      } else {
        if (Math.random() < 0.3) {
          const cover = findPeekCover(ag, ag.currentTarget.position);
          if (cover) {
            ag.currentCover = cover;
            this.addSubgoal(new PeekGoal(ag));
            this.addSubgoal(new TakeCoverGoal(ag, 1 + Math.random()));
          } else {
            this.addSubgoal(new EngageCombatGoal(ag));
          }
        } else {
          this.addSubgoal(new EngageCombatGoal(ag));
        }
      }
    }

    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    this.activateIfInactive();
    this.status = this.executeSubgoals() as string;
    if (!ag.currentTarget || ag.currentTarget.isDead) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
    }
    this.replanIfFailed();
  }

  terminate(): void {
    this.clearSubgoals();
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}

export class SurviveGoal extends YUKA.CompositeGoal<TDMAgent> {
  activate(): void {
    const ag = this.owner;
    this.clearSubgoals();

    const healthPickup = findNearestPickup(ag, 'health');
    if (healthPickup && ag.position.distanceTo(healthPickup) < 30 && ag.fuzzyAggr < 45) {
      this.addSubgoal(new SeekPickupGoal(ag, 'health'));
    } else {
      this.addSubgoal(new RetreatGoal(ag));
    }

    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    this.activateIfInactive();
    this.status = this.executeSubgoals() as string;
    if (ag.hp > ag.maxHP * 0.6) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
    }
    this.replanIfFailed();
  }

  terminate(): void {
    this.clearSubgoals();
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}

export class ReloadInCoverGoal extends YUKA.CompositeGoal<TDMAgent> {
  activate(): void {
    const ag = this.owner;
    this.clearSubgoals();

    if (ag.currentTarget) {
      const cover = findCoverFrom(ag, ag.currentTarget.position);
      if (cover) {
        ag.currentCover = cover;
        this.addSubgoal(new TakeCoverGoal(ag, ag.reloadTime + 0.5));
      }
    }

    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    this.activateIfInactive();
    this.status = this.executeSubgoals() as string;
    if (!ag.isReloading && ag.ammo > 0) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
    }
    this.replanIfFailed();
  }

  terminate(): void {
    this.clearSubgoals();
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}

export class HuntGoal extends YUKA.CompositeGoal<TDMAgent> {
  activate(): void {
    const ag = this.owner;
    this.clearSubgoals();
    const huntPos = findHuntTarget(ag);
    if (huntPos) {
      this.addSubgoal(new MoveToPositionGoal(ag, huntPos));
    } else {
      this.addSubgoal(new PatrolGoal(ag));
    }
    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    this.activateIfInactive();
    this.status = this.executeSubgoals() as string;
    this.replanIfFailed();
  }

  terminate(): void {
    this.clearSubgoals();
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}

export class GetWeaponGoal extends YUKA.CompositeGoal<TDMAgent> {
  activate(): void {
    const ag = this.owner;
    this.clearSubgoals();
    this.addSubgoal(new SeekPickupGoal(ag, 'weapon'));
    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    this.activateIfInactive();
    this.status = this.executeSubgoals() as string;
    this.replanIfFailed();
  }

  terminate(): void {
    this.clearSubgoals();
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}

// ═══════════════════════════════════════════
//  HELPER — hunt target finding
// ═══════════════════════════════════════════

const HUNT_POINTS: YUKA.Vector3[] = [
  new YUKA.Vector3(0, 0, 0),
  new YUKA.Vector3(-25, 0, 25),
  new YUKA.Vector3(25, 0, -25),
  new YUKA.Vector3(-25, 0, -25),
  new YUKA.Vector3(25, 0, 25),
  new YUKA.Vector3(-40, 0, 0),
  new YUKA.Vector3(40, 0, 0),
  new YUKA.Vector3(0, 0, -40),
  new YUKA.Vector3(0, 0, 40),
];

function findHuntTarget(ag: TDMAgent): YUKA.Vector3 | null {
  const scores: { pos: YUKA.Vector3; score: number }[] = [];

  if (gameState.mode === 'ctf') {
    for (const team of [0, 1] as const) {
      const flag = gameState.flags[team];
      if (flag.carriedBy === ag) {
        scores.push({ pos: new YUKA.Vector3(ag.team === 0 ? -48 : 48, 0, ag.team === 0 ? -48 : 48), score: 200 });
      }
    }
    const enemyFlag = gameState.flags[getEnemyFlagTeam(ag.team)];
    if (!enemyFlag.carriedBy) {
      const p = enemyFlag.dropped ? enemyFlag.dropPos : enemyFlag.base;
      scores.push({ pos: new YUKA.Vector3(p.x, 0, p.z), score: 95 });
    }
  }

  // Use tactical memory for hunt targets (higher confidence = higher score)
  for (const [, entry] of ag.enemyMemory) {
    if (entry.confidence > 0.15) {
      scores.push({
        pos: new YUKA.Vector3(entry.lastSeenPos.x, 0, entry.lastSeenPos.z),
        score: 60 + entry.confidence * 40,
      });
    }
  }

  const enemySpawnX = ag.team === TEAM_BLUE ? 45 : -45;
  const enemySpawnZ = ag.team === TEAM_BLUE ? -45 : 45;
  scores.push({
    pos: new YUKA.Vector3(enemySpawnX + (Math.random() - 0.5) * 20, 0, enemySpawnZ + (Math.random() - 0.5) * 20),
    score: 40 + ag.confidence * 0.3,
  });

  if (!gameState.player.isDead) {
    scores.push({
      pos: new YUKA.Vector3(
        gameState.player.position.x + (Math.random() - 0.5) * 20, 0,
        gameState.player.position.z + (Math.random() - 0.5) * 20,
      ),
      score: 35,
    });
  }

  for (const hp of HUNT_POINTS) {
    const dist = ag.position.distanceTo(hp);
    if (dist < 10) continue;
    scores.push({ pos: hp, score: 15 - dist * 0.1 });
  }

  // Weapon pickups while hunting (especially when unarmed)
  for (const p of gameState.pickups) {
    if (!p.active) continue;
    if (p.t === 'weapon' && p.weaponId) {
      const wepDesirability = WEAPONS[p.weaponId].desirability;
      const currentDesirability = WEAPONS[ag.weaponId].desirability;
      if (wepDesirability > currentDesirability || ag.weaponId === 'unarmed') {
        const urgency = ag.weaponId === 'unarmed' ? 100 : (wepDesirability - currentDesirability);
        scores.push({
          pos: new YUKA.Vector3(p.x, 0, p.z),
          score: 50 + urgency,
        });
      }
    }
  }

  if (scores.length === 0) return null;

  scores.sort((a, b) => b.score - a.score);
  const pick = scores[Math.floor(Math.random() * Math.min(3, scores.length))];

  if (isInsideWall(pick.pos.x, pick.pos.z)) {
    const safe = pushOutOfWall(pick.pos.x, pick.pos.z);
    pick.pos.x = safe.x;
    pick.pos.z = safe.z;
  }

  return pick.pos;
}
