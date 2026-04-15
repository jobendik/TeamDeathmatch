import * as YUKA from 'yuka';
import type { TDMAgent } from '@/entities/TDMAgent';
import { gameState } from '@/core/GameState';
import { TEAM_BLUE } from '@/config/constants';
import { WEAPONS } from '@/config/weapons';
import { findNearestPickup } from '@/ai/CoverSystem';
import {
  AttackTargetGoal,
  SurviveGoal,
  ReloadInCoverGoal,
  HuntGoal,
  GetWeaponGoal,
  SeekPickupGoal,
  PatrolGoal,
  MoveToPositionGoal,
} from './Goals';

// ═══════════════════════════════════════════
//  GOAL EVALUATORS — each scores a desire 0–1
//  The Think module picks the highest-scoring
//  evaluator every arbitration cycle.
// ═══════════════════════════════════════════

/**
 * Attack: desire to engage the current target.
 * High when target visible, aggressive, confident, have ammo.
 */
export class AttackEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    if (!ag.currentTarget || ag.currentTarget.isDead) return 0;

    const hpRatio = ag.hp / ag.maxHP;
    const ammoRatio = ag.ammo / ag.magSize;
    const aggrNorm = ag.fuzzyAggr / 100; // 0–1

    // Base desire from aggression
    let desire = aggrNorm * 0.6;

    // More desire with HP and ammo
    desire += hpRatio * 0.2;
    desire += ammoRatio * 0.15;

    // Confidence boost
    desire += (ag.confidence / 100) * 0.1;

    // Class personality: assault/flanker more eager to fight
    if (ag.botClass === 'assault') desire += 0.08;
    if (ag.botClass === 'flanker') desire += 0.05;
    if (ag.botClass === 'sniper') desire -= 0.05;

    // Score pressure: more aggressive when losing
    const myScore = gameState.teamScores[ag.team];
    const enemyScore = gameState.teamScores[ag.team === TEAM_BLUE ? 1 : 0];
    if (myScore - enemyScore < -3) desire += 0.1;
    if (myScore - enemyScore > 5) desire -= 0.05;

    // Nearby allies boost
    if (ag.nearbyAllies >= 2) desire += 0.08;

    return Math.max(0, Math.min(1, desire)) * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;
    // Only set if not already the top goal
    if (!hasGoalType(brain, AttackTargetGoal)) {
      brain.clearSubgoals();
      brain.addSubgoal(new AttackTargetGoal(ag));
    }
  }
}

/**
 * Survive: desire to retreat/heal when hurt and under pressure.
 * High when low HP, taking damage, low aggression.
 */
export class SurviveEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    const hpRatio = ag.hp / ag.maxHP;
    const timeSinceDamage = gameState.worldElapsed - ag.lastDamageTime;
    const underFire = timeSinceDamage < 2;
    const criticalHP = hpRatio < 0.3;
    const lowHP = hpRatio < 0.5;

    if (!criticalHP && !lowHP) return 0;

    // Very high desire at critical HP under fire
    let desire = (1 - hpRatio);

    if (criticalHP && underFire) desire += 0.3;
    if (ag.recentDamage > ag.maxHP * 0.4) desire += 0.2;

    // Low aggression means more survival instinct
    desire += (1 - ag.fuzzyAggr / 100) * 0.15;

    // Snipers retreat earlier
    if (ag.botClass === 'sniper') desire += 0.1;

    return Math.max(0, Math.min(1, desire)) * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;
    if (!hasGoalType(brain, SurviveGoal)) {
      brain.clearSubgoals();
      brain.addSubgoal(new SurviveGoal(ag));
    }
  }
}

/**
 * Reload: desire to find safety while reloading.
 * Only relevant when out of ammo or reloading.
 */
export class ReloadEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    if (!ag.isReloading && ag.ammo > ag.magSize * 0.2) return 0;

    let desire = 0.4;

    // More urgent when in combat
    if (ag.currentTarget) {
      const dist = ag.position.distanceTo(ag.currentTarget.position);
      if (dist < 15) desire += 0.3;
      else desire += 0.1;
    }

    // Already reloading — keep doing it
    if (ag.isReloading) desire += 0.2;

    return Math.max(0, Math.min(1, desire)) * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;
    if (!hasGoalType(brain, ReloadInCoverGoal)) {
      brain.clearSubgoals();
      brain.addSubgoal(new ReloadInCoverGoal(ag));
    }
  }
}

/**
 * Seek health: desire to find health pickups when wounded.
 * Different from Survive — this is specifically for out-of-combat healing.
 */
export class SeekHealthEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    const hpRatio = ag.hp / ag.maxHP;
    if (hpRatio > 0.85) return 0;

    // Don't seek health if in very close combat
    if (ag.currentTarget && ag.position.distanceTo(ag.currentTarget.position) < 10) return 0;

    const healthPickup = findNearestPickup(ag, 'health');
    if (!healthPickup) return 0;

    const pickupDist = ag.position.distanceTo(healthPickup);
    if (pickupDist > 40) return 0;

    let desire = (1 - hpRatio) * 0.6;

    // Closer pickup = more desirable
    desire += Math.max(0, (1 - pickupDist / 40)) * 0.3;

    // Not in combat = safer to seek health
    if (!ag.currentTarget) desire += 0.15;

    return Math.max(0, Math.min(1, desire)) * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;
    if (!hasGoalType(brain, SeekPickupGoal)) {
      brain.clearSubgoals();
      brain.addSubgoal(new SeekPickupGoal(ag, 'health'));
    }
  }
}

/**
 * Get weapon: desire to upgrade weapon when safe.
 * Only active when current weapon is suboptimal and no immediate threats.
 */
export class GetWeaponEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    const curDesirability = WEAPONS[ag.weaponId].desirability;
    if (curDesirability >= 70) return 0; // already have a good weapon

    // Don't hunt weapons while in close combat
    if (ag.currentTarget && ag.position.distanceTo(ag.currentTarget.position) < 20) return 0;

    const weaponPickup = findNearestPickup(ag, 'weapon');
    if (!weaponPickup) return 0;

    const pickupDist = ag.position.distanceTo(weaponPickup);
    if (pickupDist > 40) return 0;

    let desire = (1 - curDesirability / 100) * (gameState.mode === 'ffa' ? 0.65 : 0.4);

    // Closer = more desirable
    desire += Math.max(0, (1 - pickupDist / 40)) * 0.2;

    // Safe = more desirable
    if (!ag.currentTarget) desire += 0.15;

    return Math.max(0, Math.min(1, desire)) * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;
    if (!hasGoalType(brain, GetWeaponGoal)) {
      brain.clearSubgoals();
      brain.addSubgoal(new GetWeaponGoal(ag));
    }
  }
}

/**
 * Hunt: desire to proactively seek enemies when idle.
 * High when healthy, armed, confident, and no current activity.
 */
export class HuntEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    // If we have a target, hunt is not needed
    if (ag.currentTarget) return 0;

    const hpRatio = ag.hp / ag.maxHP;
    const ammoRatio = ag.ammo / ag.magSize;

    // Base desire to control the map
    let desire = gameState.mode === 'ctf' ? 0.5 : 0.35;

    desire += hpRatio * 0.15;
    desire += ammoRatio * 0.1;
    desire += (ag.confidence / 100) * 0.1;

    // Assault/flanker like to hunt more
    if (ag.botClass === 'assault' || ag.botClass === 'flanker') desire += 0.05;

    // Respond to team callouts
    if (ag.teamCallout && gameState.worldElapsed - ag.teamCalloutTime < 5) {
      desire += 0.2;
    }

    if (gameState.mode === 'ctf') desire += 0.15;

    // If we have a last known position, investigate
    if (ag.hasLastKnown && ag.alertLevel > 20) desire += 0.15;

    return Math.max(0, Math.min(1, desire)) * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;

    // If there's a team callout, investigate that position
    if (ag.teamCallout && gameState.worldElapsed - ag.teamCalloutTime < 5) {
      brain.clearSubgoals();
      ag.lastKnownPos.copy(ag.teamCallout);
      ag.hasLastKnown = true;
      ag.teamCallout = null;
      brain.addSubgoal(new MoveToPositionGoal(ag, ag.lastKnownPos));
      return;
    }

    // If we have a last known enemy position, investigate
    if (ag.hasLastKnown && ag.alertLevel > 20) {
      brain.clearSubgoals();
      brain.addSubgoal(new MoveToPositionGoal(ag, ag.lastKnownPos));
      return;
    }

    if (!hasGoalType(brain, HuntGoal)) {
      brain.clearSubgoals();
      brain.addSubgoal(new HuntGoal(ag));
    }
  }
}

/**
 * Patrol: lowest-priority fallback. Just wander the map.
 */
export class PatrolEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(_ag: TDMAgent): number {
    // Always a small baseline desire — the fallback
    return 0.1 * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;
    if (!hasGoalType(brain, PatrolGoal)) {
      brain.clearSubgoals();
      brain.addSubgoal(new PatrolGoal(ag));
    }
  }
}

// ═══════════════════════════════════════════
//  HELPER
// ═══════════════════════════════════════════

function hasGoalType(brain: YUKA.Think<TDMAgent>, Type: new (...args: any[]) => any): boolean {
  if (!brain.hasSubgoals()) return false;
  const current = brain.currentSubgoal();
  return current instanceof Type;
}
