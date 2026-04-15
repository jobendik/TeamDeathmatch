import * as YUKA from 'yuka';
import type { TDMAgent } from '@/entities/TDMAgent';
import { gameState } from '@/core/GameState';
import { TEAM_BLUE } from '@/config/constants';
import { WEAPONS } from '@/config/weapons';
import { findNearestPickup } from '@/ai/CoverSystem';
import { getInvestigationPosition } from '@/ai/Perception';
import { getTeamBoard } from '@/ai/TacticalBlackboard';
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

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export class AttackEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    if (!ag.currentTarget || ag.currentTarget.isDead) return 0;

    const hpRatio = ag.hp / ag.maxHP;
    const ammoRatio = ag.ammo / ag.magSize;
    const aggrNorm = ag.fuzzyAggr / 100;
    const certainty = ag.targetCertainty;
    const visibleRecently = gameState.worldElapsed - ag.lastVisibleEnemyTime < 1.1;
    const board = getTeamBoard(ag.team);

    let desire = aggrNorm * 0.42;
    desire += hpRatio * 0.12;
    desire += ammoRatio * 0.1;
    desire += certainty * 0.24;
    desire += (ag.confidence / 100) * 0.08;
    desire += ag.bravery * 0.06;
    desire += ag.chaseBias * 0.05;

    if (visibleRecently) desire += 0.08;
    if (ag.botClass === 'assault') desire += 0.07;
    if (ag.botClass === 'flanker') desire += 0.05;
    if (ag.botClass === 'sniper') desire -= 0.04;

    const myScore = gameState.teamScores[ag.team];
    const enemyScore = gameState.teamScores[ag.team === TEAM_BLUE ? 1 : 0];
    if (myScore - enemyScore < -3) desire += 0.08;
    if (myScore - enemyScore > 5) desire -= 0.05;

    if (board.intent === 'collapse') desire += 0.08;
    if (board.intent === 'reset') desire -= 0.15;
    if (ag.nearbyAllies >= 2) desire += 0.05;
    if (ag.stress > 70 && ag.hp / ag.maxHP < 0.5) desire -= 0.12;

    return clamp01(desire) * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;
    if (!hasGoalType(brain, AttackTargetGoal)) {
      brain.clearSubgoals();
      brain.addSubgoal(new AttackTargetGoal(ag));
    }
  }
}

export class SurviveEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    const hpRatio = ag.hp / ag.maxHP;
    const timeSinceDamage = gameState.worldElapsed - ag.lastDamageTime;
    const underFire = timeSinceDamage < 2;
    const board = getTeamBoard(ag.team);

    if (hpRatio > 0.58 && ag.stress < 45 && ag.recentDamage < ag.maxHP * 0.18) return 0;

    let desire = (1 - hpRatio) * 0.65;
    if (underFire) desire += 0.18;
    if (ag.recentDamage > ag.maxHP * 0.35) desire += 0.14;
    desire += (ag.stress / 100) * 0.18;
    desire += (1 - ag.bravery) * 0.08;
    desire += ag.botClass === 'sniper' ? 0.1 : 0;
    if (board.intent === 'reset') desire += 0.12;

    return clamp01(desire) * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;
    if (!hasGoalType(brain, SurviveGoal)) {
      brain.clearSubgoals();
      brain.addSubgoal(new SurviveGoal(ag));
    }
  }
}

export class ReloadEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    if (!ag.isReloading && ag.ammo > ag.magSize * 0.22) return 0;

    let desire = 0.38;
    if (ag.currentTarget) {
      const dist = ag.position.distanceTo(ag.currentTarget.position);
      desire += dist < 15 ? 0.25 : 0.1;
      desire += ag.targetCertainty * 0.14;
    }

    if (ag.isReloading) desire += 0.18;
    desire += (1 - ag.discipline) * 0.04;
    return clamp01(desire) * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;
    if (!hasGoalType(brain, ReloadInCoverGoal)) {
      brain.clearSubgoals();
      brain.addSubgoal(new ReloadInCoverGoal(ag));
    }
  }
}

export class SeekHealthEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    const hpRatio = ag.hp / ag.maxHP;
    if (hpRatio > 0.85) return 0;
    if (ag.currentTarget && ag.position.distanceTo(ag.currentTarget.position) < 10 && ag.targetCertainty > 0.55) return 0;

    const healthPickup = findNearestPickup(ag, 'health');
    if (!healthPickup) return 0;

    const pickupDist = ag.position.distanceTo(healthPickup);
    if (pickupDist > 40) return 0;

    let desire = (1 - hpRatio) * 0.55;
    desire += Math.max(0, 1 - pickupDist / 40) * 0.28;
    desire += (!ag.currentTarget ? 0.12 : 0);
    desire += (1 - ag.bravery) * 0.05;
    return clamp01(desire) * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;
    if (!hasGoalType(brain, SeekPickupGoal)) {
      brain.clearSubgoals();
      brain.addSubgoal(new SeekPickupGoal(ag, 'health'));
    }
  }
}

export class GetWeaponEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    const curDesirability = WEAPONS[ag.weaponId].desirability;
    if (curDesirability >= 70) return 0;
    if (ag.currentTarget && ag.position.distanceTo(ag.currentTarget.position) < 18 && ag.targetCertainty > 0.45) return 0;

    const weaponPickup = findNearestPickup(ag, 'weapon');
    if (!weaponPickup) return 0;

    const pickupDist = ag.position.distanceTo(weaponPickup);
    if (pickupDist > 40) return 0;

    let desire = (1 - curDesirability / 100) * 0.42;
    desire += Math.max(0, 1 - pickupDist / 40) * 0.18;
    desire += (!ag.currentTarget ? 0.12 : 0);
    desire += ag.curiosity * 0.08;

    return clamp01(desire) * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;
    if (!hasGoalType(brain, GetWeaponGoal)) {
      brain.clearSubgoals();
      brain.addSubgoal(new GetWeaponGoal(ag));
    }
  }
}

export class HuntEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    if (ag.currentTarget) return 0;

    const hpRatio = ag.hp / ag.maxHP;
    const ammoRatio = ag.ammo / ag.magSize;
    const board = getTeamBoard(ag.team);
    const investigatePos = getInvestigationPosition(ag);

    let desire = 0.28;
    desire += hpRatio * 0.15;
    desire += ammoRatio * 0.1;
    desire += (ag.confidence / 100) * 0.1;
    desire += ag.curiosity * 0.08;
    desire += ag.chaseBias * 0.06;

    if (ag.botClass === 'assault' || ag.botClass === 'flanker') desire += 0.05;
    if (board.intent === 'hunt') desire += 0.06;
    if (board.intent === 'collapse') desire += 0.04;
    if (board.intent === 'reset') desire -= 0.12;
    if (investigatePos) desire += 0.2;
    if (ag.teamCallout && gameState.worldElapsed - ag.teamCalloutTime < 5) desire += 0.12;

    return clamp01(desire) * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;
    const investigatePos = getInvestigationPosition(ag);

    if (investigatePos) {
      brain.clearSubgoals();
      ag.lastKnownPos.copy(investigatePos);
      ag.hasLastKnown = true;
      brain.addSubgoal(new MoveToPositionGoal(ag, investigatePos));
      return;
    }

    if (!hasGoalType(brain, HuntGoal)) {
      brain.clearSubgoals();
      brain.addSubgoal(new HuntGoal(ag));
    }
  }
}

export class PatrolEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    const board = getTeamBoard(ag.team);
    let desire = 0.08;
    if (board.intent === 'hold') desire += 0.03;
    if (ag.stress > 60) desire += 0.04;
    return desire * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;
    if (!hasGoalType(brain, PatrolGoal)) {
      brain.clearSubgoals();
      brain.addSubgoal(new PatrolGoal(ag));
    }
  }
}

function hasGoalType(brain: YUKA.Think<TDMAgent>, Type: new (...args: any[]) => any): boolean {
  if (!brain.hasSubgoals()) return false;
  const current = brain.currentSubgoal();
  return current instanceof Type;
}
