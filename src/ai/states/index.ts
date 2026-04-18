import * as YUKA from 'yuka';
import type { TDMAgent } from '@/entities/TDMAgent';
import { CLASS_CONFIGS } from '@/config/classes';
import { isInsideWall, pushOutOfWall } from '@/ai/CoverSystem';
import { gameState } from '@/core/GameState';

// ────────────────────────────────────────
//  PatrolState — now patrols toward strategic points
// ────────────────────────────────────────
export class PatrolState extends YUKA.State<TDMAgent> {
  enter(ag: TDMAgent): void {
    ag.stateName = 'PATROL';
    ag.stateTime = 0;
  }
  execute(ag: TDMAgent): void {
    if (ag.wanderB) ag.wanderB.weight = 1.0;
    if (ag.seekB) ag.seekB.weight = 0;
    if (ag.arriveB) ag.arriveB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;

    // Respond to team callouts — investigate the reported position
    if (ag.teamCallout && gameState.worldElapsed - ag.teamCalloutTime < 5) {
      ag.lastKnownPos.copy(ag.teamCallout);
      ag.hasLastKnown = true;
      ag.teamCallout = null;
    }
  }
  exit(_ag: TDMAgent): void {}
}

// ────────────────────────────────────────
//  EngageState — now includes combat strafing
// ────────────────────────────────────────
export class EngageState extends YUKA.State<TDMAgent> {
  enter(ag: TDMAgent): void {
    ag.stateName = 'ENGAGE';
    ag.stateTime = 0;
    ag.combatMoveTimer = 0;
  }
  execute(ag: TDMAgent): void {
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.arriveB) ag.arriveB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;

    // Pursuit toward target with combat movement
    if (ag.pursuitB) ag.pursuitB.weight = 0.8;

    // Combat strafing — uses seekB to add lateral movement
    if (ag.seekB && ag.currentTarget) {
      const toTarget = new YUKA.Vector3().subVectors(
        ag.currentTarget.position, ag.position,
      );
      const dist = toTarget.length();
      toTarget.normalize();

      // Perpendicular vector for strafing
      const perpX = -toTarget.z * ag.strafeDir;
      const perpZ = toTarget.x * ag.strafeDir;

      // Range control: approach if too far, back off if too close
      let rangeFactor = 0;
      if (dist > ag.preferredRange + 5) rangeFactor = 0.5;
      else if (dist < ag.preferredRange - 5) rangeFactor = -0.6;

      // Flankers strafe more aggressively
      const strafeMultiplier = ag.botClass === 'flanker' ? 12 : (ag.botClass === 'assault' ? 10 : 8);

      let seekX = ag.position.x + perpX * strafeMultiplier + toTarget.x * rangeFactor * 8;
      let seekZ = ag.position.z + perpZ * strafeMultiplier + toTarget.z * rangeFactor * 8;

      // Don't seek into walls
      if (isInsideWall(seekX, seekZ)) {
        const safe = pushOutOfWall(seekX, seekZ);
        seekX = safe.x;
        seekZ = safe.z;
      }

      (ag.seekB as any).target.set(seekX, 0, seekZ);
      ag.seekB.weight = 1.4;

      // Reduce pursuit when strafing heavily
      if (ag.pursuitB) ag.pursuitB.weight = 0.2;
    }
  }
  exit(_ag: TDMAgent): void {}
}

// ────────────────────────────────────────
//  InvestigateState
// ────────────────────────────────────────
export class InvestigateState extends YUKA.State<TDMAgent> {
  enter(ag: TDMAgent): void {
    ag.stateName = 'INVESTIGATE';
    ag.stateTime = 0;
  }
  execute(ag: TDMAgent): void {
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;
    if (ag.seekB) ag.seekB.weight = 0;
    if (ag.arriveB) {
      ag.arriveB.weight = 1.3;
      // Validate target isn't inside a wall
      let tx = ag.lastKnownPos.x;
      let tz = ag.lastKnownPos.z;
      if (isInsideWall(tx, tz)) {
        const safe = pushOutOfWall(tx, tz);
        ag.lastKnownPos.x = safe.x;
        ag.lastKnownPos.z = safe.z;
      }
      (ag.arriveB as any).target.copy(ag.lastKnownPos);
    }
  }
  exit(_ag: TDMAgent): void {}
}

// ────────────────────────────────────────
//  RetreatState — now zigzags instead of running straight
// ────────────────────────────────────────
export class RetreatState extends YUKA.State<TDMAgent> {
  enter(ag: TDMAgent): void {
    ag.stateName = 'RETREAT';
    ag.stateTime = 0;
    // Boost speed while retreating to make it feel urgent
    ag.maxSpeed *= 1.15;
  }
  execute(ag: TDMAgent): void {
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

    // Zigzag while retreating — wider lateral movement for survival
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
  }
  exit(ag: TDMAgent): void {
    // Restore normal speed
    const cfg = CLASS_CONFIGS[ag.botClass];
    if (cfg) ag.maxSpeed = cfg.maxSpeed;
  }
}

// ────────────────────────────────────────
//  CoverState
// ────────────────────────────────────────
export class CoverState extends YUKA.State<TDMAgent> {
  enter(ag: TDMAgent): void {
    ag.stateName = 'COVER';
    ag.stateTime = 0;
  }
  execute(ag: TDMAgent): void {
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;
    if (ag.seekB) ag.seekB.weight = 0;
    if (ag.arriveB) {
      ag.arriveB.weight = 1.4;
      if (ag.currentCover) (ag.arriveB as any).target.copy(ag.currentCover);
    }
  }
  exit(_ag: TDMAgent): void {}
}

// ────────────────────────────────────────
//  FlankState — circle around the target
// ────────────────────────────────────────
export class FlankState extends YUKA.State<TDMAgent> {
  enter(ag: TDMAgent): void {
    ag.stateName = 'FLANK';
    ag.stateTime = 0;
  }
  execute(ag: TDMAgent): void {
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;
    if (ag.seekB) ag.seekB.weight = 1.5; // stronger drive to reach flank position
    if (ag.arriveB) ag.arriveB.weight = 0;
  }
  exit(_ag: TDMAgent): void {}
}

// ────────────────────────────────────────
//  SeekPickupState — actively navigate to a pickup
// ────────────────────────────────────────
export class SeekPickupState extends YUKA.State<TDMAgent> {
  enter(ag: TDMAgent): void {
    ag.stateName = 'SEEK_PICKUP';
    ag.stateTime = 0;
    ag.seekingPickup = true;
  }
  execute(ag: TDMAgent): void {
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
  }
  exit(ag: TDMAgent): void {
    ag.seekingPickup = false;
  }
}

// ────────────────────────────────────────
//  TeamPushState — coordinated advance with teammates
// ────────────────────────────────────────
export class TeamPushState extends YUKA.State<TDMAgent> {
  enter(ag: TDMAgent): void {
    ag.stateName = 'TEAM_PUSH';
    ag.stateTime = 0;
  }
  execute(ag: TDMAgent): void {
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;

    // Push toward the target with teammates
    if (ag.pursuitB) ag.pursuitB.weight = 1.5;

    // Slight strafing while pushing
    if (ag.seekB && ag.currentTarget) {
      const toTarget = new YUKA.Vector3().subVectors(
        ag.currentTarget.position, ag.position,
      ).normalize();
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
  }
  exit(_ag: TDMAgent): void {}
}

// ────────────────────────────────────────
//  PeekState — peek from cover to shoot, then return
// ────────────────────────────────────────
export class PeekState extends YUKA.State<TDMAgent> {
  enter(ag: TDMAgent): void {
    ag.stateName = 'PEEK';
    ag.stateTime = 0;
    ag.isPeeking = true;
    ag.peekTimer = 0.6 + Math.random() * 0.8; // peek for 0.6-1.4s
  }
  execute(ag: TDMAgent): void {
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;

    // Move slightly toward target from cover to get sightline
    if (ag.seekB && ag.currentTarget && ag.currentCover) {
      const toTarget = new YUKA.Vector3().subVectors(
        ag.currentTarget.position, ag.currentCover,
      ).normalize();
      (ag.seekB as any).target.set(
        ag.currentCover.x + toTarget.x * 3,
        0,
        ag.currentCover.z + toTarget.z * 3,
      );
      ag.seekB.weight = 1.5;
    }
    if (ag.arriveB) ag.arriveB.weight = 0;
  }
  exit(ag: TDMAgent): void {
    ag.isPeeking = false;
  }
}

// ────────────────────────────────────────
//  HoldAngleState — stake out a chokepoint
// ────────────────────────────────────────
export class HoldAngleState extends YUKA.State<TDMAgent> {
  enter(ag: TDMAgent): void {
    ag.stateName = 'HOLD_ANGLE';
    ag.stateTime = 0;
    ag.isBotCrouching = true;
  }
  execute(ag: TDMAgent): void {
    if (ag.wanderB) ag.wanderB.weight = 0;
    if (ag.pursuitB) ag.pursuitB.weight = 0;
    if (ag.fleeB) ag.fleeB.weight = 0;
    if (ag.seekB) ag.seekB.weight = 0;
  }
  exit(ag: TDMAgent): void {
    ag.isBotCrouching = false;
  }
}
