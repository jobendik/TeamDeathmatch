import * as YUKA from 'yuka';
import type { TDMAgent } from '@/entities/TDMAgent';
import { CLASS_CONFIGS } from '@/config/classes';
import {
  findCoverFrom,
  findFlankPosition,
  findPeekCover,
  findSniperNest,
  findNearestPickup,
  isInsideWall,
  pushOutOfWall,
} from '@/ai/CoverSystem';
import { gameState } from '@/core/GameState';
import { TEAM_BLUE } from '@/config/constants';
import { WEAPONS } from '@/config/weapons';
import { getInvestigationPosition } from '@/ai/Perception';
import { getTeamBoard, noteTeamIntent } from '@/ai/TacticalBlackboard';

function shoulderSign(ag: TDMAgent): number {
  return ag.preferredPeekSide === 'left' ? -1 : 1;
}

function sanitizePos(pos: YUKA.Vector3): YUKA.Vector3 {
  if (!isInsideWall(pos.x, pos.z)) return pos;
  const safe = pushOutOfWall(pos.x, pos.z);
  return new YUKA.Vector3(safe.x, 0, safe.z);
}

function setSeekTarget(ag: TDMAgent, x: number, z: number, weight = 1.2): void {
  const safe = isInsideWall(x, z) ? pushOutOfWall(x, z) : { x, z };
  if (ag.seekB) {
    (ag.seekB as any).target.set(safe.x, 0, safe.z);
    ag.seekB.weight = weight;
  }
}

function setArriveTarget(ag: TDMAgent, pos: YUKA.Vector3, weight = 1.3): void {
  if (ag.arriveB) {
    (ag.arriveB as any).target.copy(pos);
    ag.arriveB.weight = weight;
  }
}

// ═══════════════════════════════════════════
//  ATOMIC GOALS
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

    const investigatePos = getInvestigationPosition(ag);
    if (investigatePos) {
      ag.lastKnownPos.copy(investigatePos);
      ag.hasLastKnown = true;
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
    this.targetPos = sanitizePos(this.targetPos);
    ag.investigatePos = this.targetPos.clone();
    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;
    if (ag.seekB) ag.seekB.weight = 0;

    setArriveTarget(ag, this.targetPos, 1.25);

    if (ag.position.distanceTo(this.targetPos) < 3) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
    }

    if (ag.currentTarget && ag.targetCertainty > 0.55 && ag.position.distanceTo(ag.currentTarget.position) < 12) {
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
    if (gameState.worldElapsed > ag.routeCommitUntil) {
      ag.routeCommitUntil = gameState.worldElapsed + 0.65 + ag.patience * 0.9;
    }
    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    if (!ag.currentTarget || ag.currentTarget.isDead) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
      return;
    }

    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.arriveB) ag.arriveB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;

    if (ag.pursuitB) ag.pursuitB.weight = ag.tacticalRole === 'point' ? 0.9 : 0.55;

    if (ag.seekB) {
      const toTarget = new YUKA.Vector3().subVectors(ag.currentTarget.position, ag.position);
      const dist = toTarget.length();
      toTarget.normalize();

      const side = ag.strafeDir * shoulderSign(ag);
      const perpX = -toTarget.z * side;
      const perpZ = toTarget.x * side;

      let rangePush = 0;
      if (dist > ag.preferredRange + 4) rangePush = 0.45;
      else if (dist < ag.preferredRange - 4) rangePush = -0.55;

      let lateralMag = 5 + ag.peekBias * 4;
      if (ag.tacticalRole === 'flanker' || ag.tacticalRole === 'lurker') lateralMag += 3;
      if (ag.tacticalRole === 'anchor' || ag.botClass === 'sniper') lateralMag -= 1.5;

      let forwardMag = rangePush * (ag.tacticalRole === 'point' ? 10 : 7);
      if (ag.tacticalRole === 'trader') forwardMag -= 1.5;
      if (ag.tacticalRole === 'support') forwardMag -= 2.5;

      const jitter = ag.discipline > 0.7 ? 0.8 : 1.4;
      const seekX = ag.position.x + perpX * lateralMag + toTarget.x * forwardMag + (Math.random() - 0.5) * jitter;
      const seekZ = ag.position.z + perpZ * lateralMag + toTarget.z * forwardMag + (Math.random() - 0.5) * jitter;
      setSeekTarget(ag, seekX, seekZ, 1.2 + ag.bravery * 0.2);
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
  activate(): void {
    const ag = this.owner;
    ag.stateName = 'RETREAT';
    ag.stateTime = 0;
    ag.maxSpeed = CLASS_CONFIGS[ag.botClass].maxSpeed * 1.12;
    if (ag.currentTarget) {
      const cover = findCoverFrom(ag, ag.lastKnownPos);
      if (cover) ag.currentCover = cover;
    }
    noteTeamIntent(ag.team, 'reset', ag.currentCover ?? ag.spawnPos, 0.35);
    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;

    const fallback = ag.currentCover ?? ag.spawnPos;
    setArriveTarget(ag, fallback, 1.45);

    if (ag.seekB && ag.currentTarget) {
      const away = new YUKA.Vector3().subVectors(ag.position, ag.currentTarget.position).normalize();
      const perpX = -away.z * shoulderSign(ag);
      const perpZ = away.x * shoulderSign(ag);
      const rx = ag.position.x + perpX * 5 + away.x * 6;
      const rz = ag.position.z + perpZ * 5 + away.z * 6;
      setSeekTarget(ag, rx, rz, 0.9);
    } else if (ag.seekB) {
      ag.seekB.weight = 0;
    }

    if (fallback && ag.position.distanceTo(fallback) < 3.2) this.status = YUKA.Goal.STATUS.COMPLETED;
    if (ag.stateTime > 5.5) this.status = YUKA.Goal.STATUS.COMPLETED;
  }

  terminate(): void {
    const ag = this.owner;
    ag.maxSpeed = CLASS_CONFIGS[ag.botClass].maxSpeed;
    if (ag.seekB) ag.seekB.weight = 0;
    if (ag.arriveB) ag.arriveB.weight = 0;
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}

export class TakeCoverGoal extends YUKA.Goal<TDMAgent> {
  duration: number;

  constructor(owner: TDMAgent, duration = 2.5) {
    super(owner);
    this.duration = duration;
  }

  activate(): void {
    const ag = this.owner;
    ag.stateName = 'COVER';
    ag.stateTime = 0;
    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;
    if (ag.seekB) ag.seekB.weight = 0;
    if (ag.currentCover) setArriveTarget(ag, ag.currentCover, 1.35);

    if (ag.stateTime >= this.duration) this.status = YUKA.Goal.STATUS.COMPLETED;
    if (ag.hp >= ag.maxHP * 0.9 && ag.ammo >= ag.magSize * 0.5) this.status = YUKA.Goal.STATUS.COMPLETED;
  }

  terminate(): void {
    const ag = this.owner;
    if (ag.arriveB) ag.arriveB.weight = 0;
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
}

export class PeekGoal extends YUKA.Goal<TDMAgent> {
  peekDuration = 0;
  falsePeek = false;

  activate(): void {
    const ag = this.owner;
    ag.stateName = 'PEEK';
    ag.stateTime = 0;
    ag.isPeeking = true;
    this.peekDuration = 0.45 + Math.random() * (0.6 + (1 - ag.patience) * 0.5);
    this.falsePeek = Math.random() < (1 - ag.discipline) * 0.18;
    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;

    if (ag.seekB && ag.currentCover && ag.currentTarget) {
      const toTarget = new YUKA.Vector3().subVectors(ag.currentTarget.position, ag.currentCover).normalize();
      const shoulder = shoulderSign(ag);
      const perp = new YUKA.Vector3(-toTarget.z * shoulder, 0, toTarget.x * shoulder);
      const peekOffset = this.falsePeek ? 1.2 : 2.3 + ag.peekBias * 0.8;
      const peekPos = new YUKA.Vector3(
        ag.currentCover.x + toTarget.x * 1.8 + perp.x * peekOffset,
        0,
        ag.currentCover.z + toTarget.z * 1.8 + perp.z * peekOffset,
      );
      setSeekTarget(ag, peekPos.x, peekPos.z, 1.45);
    }
    if (ag.arriveB) ag.arriveB.weight = 0;

    if (ag.stateTime >= this.peekDuration) this.status = YUKA.Goal.STATUS.COMPLETED;
  }

  terminate(): void {
    const ag = this.owner;
    ag.isPeeking = false;
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
      if (this.flankPos) {
        const shoulder = shoulderSign(ag);
        this.flankPos.x += shoulder * (2.5 + ag.curiosity * 2);
        this.flankPos = sanitizePos(this.flankPos);
      }
    }
    ag.routeCommitUntil = gameState.worldElapsed + 1.2 + ag.chaseBias * 1.2;
    noteTeamIntent(ag.team, shoulderSign(ag) < 0 ? 'flank_left' : 'flank_right', this.flankPos ?? undefined, 0.62);
    this.status = this.flankPos ? YUKA.Goal.STATUS.ACTIVE : YUKA.Goal.STATUS.FAILED;
  }

  execute(): void {
    const ag = this.owner;
    if (!this.flankPos) {
      this.status = YUKA.Goal.STATUS.FAILED;
      return;
    }

    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;
    if (ag.arriveB) ag.arriveB.weight = 0;

    setSeekTarget(ag, this.flankPos.x, this.flankPos.z, 1.45);

    if (ag.position.distanceTo(this.flankPos) < 4) this.status = YUKA.Goal.STATUS.COMPLETED;
    if (ag.stateTime > 6.5) this.status = YUKA.Goal.STATUS.COMPLETED;
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
    if (pickup && ag.position.distanceTo(pickup) < 42) {
      ag.seekPickupPos = pickup;
      this.status = YUKA.Goal.STATUS.ACTIVE;
    } else {
      this.status = YUKA.Goal.STATUS.FAILED;
    }
  }

  execute(): void {
    const ag = this.owner;
    if (!ag.seekPickupPos) {
      this.status = YUKA.Goal.STATUS.FAILED;
      return;
    }

    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;
    if (ag.seekB) ag.seekB.weight = 0;
    setArriveTarget(ag, ag.seekPickupPos, 1.55);

    if (ag.position.distanceTo(ag.seekPickupPos) < 3) this.status = YUKA.Goal.STATUS.COMPLETED;
    if (ag.currentTarget && ag.position.distanceTo(ag.currentTarget.position) < 12 && ag.targetCertainty > 0.55) {
      this.status = YUKA.Goal.STATUS.FAILED;
    }
    if (ag.stateTime > 8) this.status = YUKA.Goal.STATUS.FAILED;
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
    noteTeamIntent(ag.team, 'collapse', ag.currentTarget?.position, 0.82);
    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    if (!ag.currentTarget || ag.currentTarget.isDead) {
      this.status = YUKA.Goal.STATUS.COMPLETED;
      return;
    }

    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;
    if (ag.arriveB) ag.arriveB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 1.0;

    const toTarget = new YUKA.Vector3().subVectors(ag.currentTarget.position, ag.position).normalize();
    const side = shoulderSign(ag);
    const perpX = -toTarget.z * side;
    const perpZ = toTarget.x * side;

    let spacing = ag.tacticalRole === 'trader' ? 2.5 : ag.tacticalRole === 'support' ? 5.5 : 4;
    let advance = ag.tacticalRole === 'point' ? 8.5 : ag.tacticalRole === 'trader' ? 6.5 : 5.5;

    const px = ag.position.x + perpX * spacing + toTarget.x * advance;
    const pz = ag.position.z + perpZ * spacing + toTarget.z * advance;
    setSeekTarget(ag, px, pz, 0.8);

    if (ag.stateTime > 6 || ag.hp / ag.maxHP < 0.35) this.status = YUKA.Goal.STATUS.COMPLETED;
  }

  terminate(): void {
    const ag = this.owner;
    if (ag.seekB) ag.seekB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    this.status = YUKA.Goal.STATUS.COMPLETED;
  }
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

    const dist = ag.position.distanceTo(ag.lastKnownPos);
    const hpRatio = ag.hp / ag.maxHP;
    const board = getTeamBoard(ag.team);

    if (board.intent === 'reset' && hpRatio < 0.5) {
      this.addSubgoal(new RetreatGoal(ag));
      this.status = YUKA.Goal.STATUS.ACTIVE;
      return;
    }

    if (ag.botClass === 'sniper') {
      if (dist < 11 || ag.targetCertainty < 0.38) {
        this.addSubgoal(new RetreatGoal(ag));
      } else if (dist > 26) {
        const nest = findSniperNest(ag, ag.lastKnownPos);
        if (nest && ag.position.distanceTo(nest) > 5) {
          ag.currentCover = nest;
          this.addSubgoal(new PeekGoal(ag));
          this.addSubgoal(new TakeCoverGoal(ag, 2 + Math.random() * 2));
        } else {
          this.addSubgoal(new EngageCombatGoal(ag));
        }
      } else {
        const cover = findPeekCover(ag, ag.lastKnownPos);
        if (cover) {
          ag.currentCover = cover;
          this.addSubgoal(new PeekGoal(ag));
          this.addSubgoal(new TakeCoverGoal(ag, 1.6 + Math.random() * 1.2));
        } else {
          this.addSubgoal(new EngageCombatGoal(ag));
        }
      }
    } else if (ag.botClass === 'flanker' || ag.tacticalRole === 'flanker' || ag.tacticalRole === 'lurker') {
      if (dist < 9 && ag.targetCertainty > 0.55) {
        this.addSubgoal(new EngageCombatGoal(ag));
      } else if (gameState.worldElapsed < ag.routeCommitUntil || Math.random() < ag.flankPreference * (0.6 + ag.curiosity * 0.6)) {
        this.addSubgoal(new EngageCombatGoal(ag));
        this.addSubgoal(new FlankGoal(ag));
      } else {
        this.addSubgoal(new EngageCombatGoal(ag));
      }
    } else if (board.intent === 'collapse' && ag.nearbyAllies >= 2 && ag.confidence > 40 && hpRatio > 0.45) {
      this.addSubgoal(new TeamPushGoal(ag));
    } else if (hpRatio < 0.55 && Math.random() < (0.22 + (1 - ag.bravery) * 0.25)) {
      const cover = findPeekCover(ag, ag.lastKnownPos) || findCoverFrom(ag, ag.lastKnownPos);
      if (cover) {
        ag.currentCover = cover;
        if (Math.random() < 0.55) {
          this.addSubgoal(new PeekGoal(ag));
          this.addSubgoal(new TakeCoverGoal(ag, 1.2 + Math.random() * 1.8));
        } else {
          this.addSubgoal(new TakeCoverGoal(ag, 1.4 + Math.random() * 1.6));
        }
      } else {
        this.addSubgoal(new EngageCombatGoal(ag));
      }
    } else if (ag.fuzzyAggr > 55 || ag.bravery > 0.62) {
      this.addSubgoal(new EngageCombatGoal(ag));
    } else {
      const cover = findPeekCover(ag, ag.lastKnownPos);
      if (cover && Math.random() < 0.4 + ag.peekBias * 0.25) {
        ag.currentCover = cover;
        this.addSubgoal(new PeekGoal(ag));
        this.addSubgoal(new TakeCoverGoal(ag, 1 + Math.random() * 1.3));
      } else {
        this.addSubgoal(new EngageCombatGoal(ag));
      }
    }

    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    this.activateIfInactive();
    this.status = this.executeSubgoals() as string;
    if (!ag.currentTarget || ag.currentTarget.isDead) this.status = YUKA.Goal.STATUS.COMPLETED;
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
    if (ag.hp > ag.maxHP * 0.62 && ag.stress < 55) this.status = YUKA.Goal.STATUS.COMPLETED;
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

    const cover = ag.currentTarget ? findCoverFrom(ag, ag.lastKnownPos) : ag.currentCover;
    if (cover) {
      ag.currentCover = cover;
      this.addSubgoal(new TakeCoverGoal(ag, ag.reloadTime + 0.45));
    }

    this.status = YUKA.Goal.STATUS.ACTIVE;
  }

  execute(): void {
    const ag = this.owner;
    this.activateIfInactive();
    this.status = this.executeSubgoals() as string;
    if (!ag.isReloading && ag.ammo > 0) this.status = YUKA.Goal.STATUS.COMPLETED;
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
    if (huntPos) this.addSubgoal(new MoveToPositionGoal(ag, huntPos));
    else this.addSubgoal(new PatrolGoal(ag));
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
//  HUNT TARGETING
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
  const board = getTeamBoard(ag.team);

  const investigatePos = getInvestigationPosition(ag);
  if (investigatePos) {
    scores.push({ pos: investigatePos.clone(), score: 55 + ag.curiosity * 10 + ag.targetCertainty * 12 });
  }

  if (board.focusPos) {
    scores.push({ pos: board.focusPos.clone(), score: 40 + board.pressure * 20 });
  }

  const enemySpawnX = ag.team === TEAM_BLUE ? 45 : -45;
  const enemySpawnZ = ag.team === TEAM_BLUE ? -45 : 45;
  scores.push({
    pos: new YUKA.Vector3(enemySpawnX + (Math.random() - 0.5) * 20, 0, enemySpawnZ + (Math.random() - 0.5) * 20),
    score: 30 + ag.confidence * 0.25 + ag.chaseBias * 12,
  });

  for (const enemy of gameState.agents) {
    if (enemy.isDead || enemy.team === ag.team || enemy === gameState.player) continue;
    const noisy = new YUKA.Vector3(
      enemy.position.x + (Math.random() - 0.5) * 20,
      0,
      enemy.position.z + (Math.random() - 0.5) * 20,
    );
    scores.push({ pos: noisy, score: 22 + ag.curiosity * 8 });
  }

  if (!gameState.player.isDead) {
    scores.push({
      pos: new YUKA.Vector3(
        gameState.player.position.x + (Math.random() - 0.5) * 18,
        0,
        gameState.player.position.z + (Math.random() - 0.5) * 18,
      ),
      score: 30,
    });
  }

  for (const hp of HUNT_POINTS) {
    const dist = ag.position.distanceTo(hp);
    if (dist < 10) continue;
    scores.push({ pos: hp.clone(), score: 12 - dist * 0.08 + ag.curiosity * 4 });
  }

  for (const p of gameState.pickups) {
    if (!p.active) continue;
    if (p.t === 'weapon' && p.weaponId) {
      const wepDesirability = WEAPONS[p.weaponId].desirability;
      const currentDesirability = WEAPONS[ag.weaponId].desirability;
      if (wepDesirability > currentDesirability) {
        scores.push({
          pos: new YUKA.Vector3(p.x, 0, p.z),
          score: 35 + (wepDesirability - currentDesirability),
        });
      }
    }
  }

  if (scores.length === 0) return null;
  scores.sort((a, b) => b.score - a.score);
  const pick = scores[Math.floor(Math.random() * Math.min(4, scores.length))];
  return sanitizePos(pick.pos);
}
