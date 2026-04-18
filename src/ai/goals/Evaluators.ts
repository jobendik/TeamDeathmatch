import * as YUKA from 'yuka';
import type { TDMAgent } from '@/entities/TDMAgent';
import { gameState } from '@/core/GameState';
import { TEAM_BLUE } from '@/config/constants';
import { WEAPONS } from '@/config/weapons';
import { findNearestPickup } from '@/ai/CoverSystem';
import { getZoneDanger, getTeamMomentum } from '@/ai/MatchMemory';
import {
  AttackTargetGoal,
  SurviveGoal,
  ReloadInCoverGoal,
  HuntGoal,
  GetWeaponGoal,
  SeekPickupGoal,
  PatrolGoal,
  MoveToPositionGoal,
  HoldAngleGoal,
} from './Goals';

// ═══════════════════════════════════════════
//  ATTACK — engage the current target
// ═══════════════════════════════════════════
export class AttackEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    if (!ag.currentTarget || ag.currentTarget.isDead) return 0;
    if (ag.weaponId === 'unarmed') return 0;

    const hpRatio = ag.hp / ag.maxHP;
    const ammoRatio = ag.ammo / ag.magSize;
    const aggrNorm = ag.fuzzyAggr / 100;

    let desire = aggrNorm * 0.6;
    desire += hpRatio * 0.2;
    desire += ammoRatio * 0.15;
    desire += (ag.confidence / 100) * 0.1;

    if (ag.botClass === 'assault') desire += 0.08;
    if (ag.botClass === 'flanker') desire += 0.05;
    if (ag.botClass === 'sniper') desire -= 0.05;

    const myScore = gameState.teamScores[ag.team];
    const enemyScore = gameState.teamScores[ag.team === TEAM_BLUE ? 1 : 0];
    if (myScore - enemyScore < -3) desire += 0.1;
    if (myScore - enemyScore > 5) desire -= 0.05;

    if (ag.nearbyAllies >= 2) desire += 0.08;
    if (ag.underPressure) desire -= ag.pressureLevel * 0.3;

    // Zone danger — reduce aggression in areas where team keeps dying
    const zoneDanger = getZoneDanger(ag.team, ag.position.x, ag.position.z);
    desire -= zoneDanger * 0.25;

    // Team momentum — push harder when on a roll, pull back when losing
    const momentum = getTeamMomentum(ag.team);
    desire += momentum * 0.15;

    // Personality
    const p = ag.personality;
    if (p) {
      desire += p.aggressionBias * 0.25;
      desire += p.egoismBias * 0.08;
      if (ag.grudge === ag.currentTarget) desire += p.revengeBias * 0.2;
    }

    return Math.max(0, Math.min(1, desire)) * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;
    if (!hasGoalType(brain, AttackTargetGoal)) {
      brain.clearSubgoals();
      brain.addSubgoal(new AttackTargetGoal(ag));
    }
  }
}

// ═══════════════════════════════════════════
//  SURVIVE — retreat/heal
// ═══════════════════════════════════════════
export class SurviveEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    const hpRatio = ag.hp / ag.maxHP;
    const timeSinceDamage = gameState.worldElapsed - ag.lastDamageTime;
    const underFire = timeSinceDamage < 2;
    const criticalHP = hpRatio < 0.3;
    const lowHP = hpRatio < 0.5;

    if (!criticalHP && !lowHP && !ag.underPressure) return 0;

    let desire = (1 - hpRatio);
    if (criticalHP && underFire) desire += 0.3;
    if (ag.recentDamage > ag.maxHP * 0.4) desire += 0.2;
    desire += (1 - ag.fuzzyAggr / 100) * 0.15;
    if (ag.botClass === 'sniper') desire += 0.1;
    if (ag.underPressure) desire += ag.pressureLevel * 0.35;

    // Zone danger — urgently retreat from death zones
    const zoneDanger = getZoneDanger(ag.team, ag.position.x, ag.position.z);
    desire += zoneDanger * 0.3;

    // Negative momentum — retreat more when team is losing fights
    const momentum = getTeamMomentum(ag.team);
    if (momentum < 0) desire -= momentum * 0.2; // negative momentum adds to survive desire

    const p = ag.personality;
    if (p) {
      desire += p.cautionBias * 0.3;
      desire -= p.aggressionBias * 0.15;
    }

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

// ═══════════════════════════════════════════
//  RELOAD — get to safety, reload
// ═══════════════════════════════════════════
export class ReloadEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    if (ag.weaponId === 'unarmed') return 0;
    if (!ag.isReloading && ag.ammo > ag.magSize * 0.2) return 0;

    let desire = 0.4;
    if (ag.currentTarget) {
      const dist = ag.position.distanceTo(ag.currentTarget.position);
      if (dist < 15) desire += 0.3;
      else desire += 0.1;
    }
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

// ═══════════════════════════════════════════
//  SEEK HEALTH — pickup when wounded
// ═══════════════════════════════════════════
export class SeekHealthEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    if (gameState.mode === 'br') return 0; // BR bots loot via BRBots.seekLoot()
    const hpRatio = ag.hp / ag.maxHP;
    if (hpRatio > 0.85) return 0;
    if (ag.currentTarget && ag.position.distanceTo(ag.currentTarget.position) < 10) return 0;

    const healthPickup = findNearestPickup(ag, 'health');
    if (!healthPickup) return 0;

    const pickupDist = ag.position.distanceTo(healthPickup);
    if (pickupDist > 40) return 0;

    let desire = (1 - hpRatio) * 0.6;
    desire += Math.max(0, (1 - pickupDist / 40)) * 0.3;
    if (!ag.currentTarget) desire += 0.15;

    const p = ag.personality;
    if (p) desire += p.cautionBias * 0.2;

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

// ═══════════════════════════════════════════
//  GET WEAPON — unarmed or want upgrade
// ═══════════════════════════════════════════
export class GetWeaponEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    if (gameState.mode === 'br') return 0; // BR bots loot via BRBots.seekLoot()
    const isUnarmed = ag.weaponId === 'unarmed';

    if (!isUnarmed) {
      const curDesirability = WEAPONS[ag.weaponId].desirability;
      if (curDesirability >= 70) return 0;
      if (ag.currentTarget && ag.position.distanceTo(ag.currentTarget.position) < 20) return 0;
    }

    const weaponPickup = findNearestPickup(ag, 'weapon');
    if (!weaponPickup) return 0;

    const pickupDist = ag.position.distanceTo(weaponPickup);
    if (pickupDist > 50) return 0;

    if (isUnarmed) {
      let desire = 0.95;
      desire -= pickupDist * 0.005;
      return Math.max(0.5, Math.min(1, desire)) * this.characterBias;
    }

    const curDesirability = WEAPONS[ag.weaponId].desirability;
    let desire = (1 - curDesirability / 100) * (gameState.mode === 'ffa' ? 0.65 : 0.4);
    desire += Math.max(0, (1 - pickupDist / 40)) * 0.2;
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

// ═══════════════════════════════════════════
//  HUNT — proactive search when idle
// ═══════════════════════════════════════════
export class HuntEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    if (ag.currentTarget) return 0;
    if (ag.weaponId === 'unarmed') return 0.05;

    const hpRatio = ag.hp / ag.maxHP;
    const ammoRatio = ag.ammo / ag.magSize;

    let desire = gameState.mode === 'ctf' ? 0.5 : 0.35;
    desire += hpRatio * 0.15;
    desire += ammoRatio * 0.1;
    desire += (ag.confidence / 100) * 0.1;

    if (ag.botClass === 'assault' || ag.botClass === 'flanker') desire += 0.05;
    if (ag.teamCallout && gameState.worldElapsed - ag.teamCalloutTime < 5) desire += 0.2;
    if (gameState.mode === 'ctf') desire += 0.15;
    if (ag.hasLastKnown && ag.alertLevel > 20) desire += 0.15;

    for (const [, entry] of ag.enemyMemory) {
      if (entry.confidence > 0.3) { desire += 0.1; break; }
    }

    // Zone danger — less eager to hunt into death zones
    const hZoneDanger = getZoneDanger(ag.team, ag.position.x, ag.position.z);
    desire -= hZoneDanger * 0.15;

    const p = ag.personality;
    if (p) {
      desire += p.egoismBias * 0.15;
      desire -= p.patienceBias * 0.1;
      if (ag.grudge) desire += p.revengeBias * 0.25;
    }

    return Math.max(0, Math.min(1, desire)) * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;

    // Grudge: hunt killer directly
    if (ag.grudge && !ag.grudge.isDead) {
      brain.clearSubgoals();
      ag.lastKnownPos.copy(ag.grudge.position);
      ag.hasLastKnown = true;
      brain.addSubgoal(new MoveToPositionGoal(ag, ag.lastKnownPos));
      return;
    }

    if (ag.teamCallout && gameState.worldElapsed - ag.teamCalloutTime < 5) {
      brain.clearSubgoals();
      ag.lastKnownPos.copy(ag.teamCallout);
      ag.hasLastKnown = true;
      ag.teamCallout = null;
      brain.addSubgoal(new MoveToPositionGoal(ag, ag.lastKnownPos));
      return;
    }

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

// ═══════════════════════════════════════════
//  PATROL — fallback
// ═══════════════════════════════════════════
export class PatrolEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(_ag: TDMAgent): number {
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
//  HOLD ANGLE — patient chokepoint control
// ═══════════════════════════════════════════
export class HoldAngleEvaluator extends YUKA.GoalEvaluator<TDMAgent> {
  calculateDesirability(ag: TDMAgent): number {
    // Only when no target and in good shape
    if (ag.currentTarget) return 0;
    if (ag.weaponId === 'unarmed') return 0;
    if (ag.hp / ag.maxHP < 0.5) return 0;
    if (ag.ammo / ag.magSize < 0.3) return 0;

    const p = ag.personality;
    if (!p) return 0;

    // Only Anchor, Picker, and patient archetypes should want this
    const isHolder = p.archetype === 'Anchor' || p.archetype === 'Picker' || p.archetype === 'Veteran';
    if (!isHolder && p.patienceBias < 0.2) return 0;

    let desire = 0.15 + p.patienceBias * 0.35;
    desire += p.preAimBias * 0.15;
    desire -= p.aggressionBias * 0.2;
    if (isHolder) desire += 0.15;
    if (ag.botClass === 'sniper') desire += 0.1;
    if (ag.nearbyAllies >= 1) desire += 0.05; // more comfortable holding with backup

    return Math.max(0, Math.min(0.6, desire)) * this.characterBias;
  }

  setGoal(ag: TDMAgent): void {
    const brain = ag.brain;
    if (!hasGoalType(brain, HoldAngleGoal)) {
      brain.clearSubgoals();
      brain.addSubgoal(new HoldAngleGoal(ag));
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
