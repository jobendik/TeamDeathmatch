import * as THREE from 'three';
import * as YUKA from 'yuka';
import { gameState } from '@/core/GameState';
import { TDMAgent } from './TDMAgent';
import {
  TEAM_BLUE, TEAM_RED, TEAM_COLORS,
  BLUE_SPAWNS, RED_SPAWNS,
} from '@/config/constants';
import type { BotClass } from '@/config/classes';
import type { TeamId } from '@/config/constants';
import { FP } from '@/config/player';
import { buildSoldierMesh } from '@/rendering/SoldierMesh';
import { makeNameTag } from '@/rendering/NameTag';
import { addHPBar } from '@/rendering/HPBar';
import { setupFuzzy } from '@/ai/FuzzyLogic';
import { makePersonality } from '@/ai/Personality';
import {
  preloadBlueSwatAssets, preloadEnemyAssets,
  hasBlueSwatAssets, hasEnemyAssets,
  attachBlueSwatCharacter, attachEnemyCharacter,
} from '@/rendering/AgentAnimations';
import {
  PatrolState, EngageState, InvestigateState, RetreatState,
  CoverState, FlankState, SeekPickupState, TeamPushState, PeekState,
} from '@/ai/states';
import {
  AttackEvaluator, SurviveEvaluator, ReloadEvaluator,
  SeekHealthEvaluator, GetWeaponEvaluator, HuntEvaluator, PatrolEvaluator,
} from '@/ai/goals/Evaluators';

function syncRC(entity: YUKA.GameEntity, renderComponent: THREE.Object3D): void {
  renderComponent.position.copy(entity.position as unknown as THREE.Vector3);
  renderComponent.quaternion.copy(entity.rotation as unknown as THREE.Quaternion);
}

type VisualVariant = 'placeholder' | 'swat' | 'enemy';

function mkAgent(
  name: string,
  team: TeamId,
  botClass: BotClass,
  x: number,
  z: number,
  visualVariant: VisualVariant = 'placeholder',
): TDMAgent {
  const ag = new TDMAgent(name, team, botClass);
  ag.position.set(x, 0, z);
  ag.spawnPos.set(x, 0, z);

  // ── Personality assignment ──
  const personality = makePersonality(botClass);
  ag.personality = personality;

  // Apply personality-driven reaction time
  ag.reactionTime = Math.max(0.12, ag.reactionTime + personality.reactionModifier);

  // Personality can shift preferred range slightly
  ag.preferredRange *= 1 + personality.patienceBias * 0.15;

  const root = new THREE.Group();
  root.name = `${name}_Root`;
  gameState.scene.add(root);

  ag.renderComponent = root;
  ag.setRenderComponent(root, syncRC);

  if (visualVariant === 'swat') {
    attachBlueSwatCharacter(root);
  } else if (visualVariant === 'enemy') {
    attachEnemyCharacter(root);
  } else {
    root.add(buildSoldierMesh(TEAM_COLORS[team], botClass, team));
  }

  const tag = makeNameTag(name, TEAM_COLORS[team]);
  tag.position.y = 2.6;
  root.add(tag);
  ag.nameTag = tag;

  addHPBar(ag);

  ag.wanderB = new YUKA.WanderBehavior(1.0, 4, 2.2);
  ag.arriveB = new YUKA.ArriveBehavior(new YUKA.Vector3(), 3, 0.5);
  ag.seekB = new YUKA.SeekBehavior(new YUKA.Vector3());
  ag.fleeB = new YUKA.FleeBehavior(new YUKA.Vector3(), 10);
  ag.pursuitB = new YUKA.PursuitBehavior(ag, 1.2);
  ag.avoidB = new YUKA.ObstacleAvoidanceBehavior(gameState.yukaObs);
  ag.avoidB.weight = 3;

  ag.steering.add(ag.wanderB);
  ag.steering.add(ag.arriveB);
  ag.steering.add(ag.seekB);
  ag.steering.add(ag.fleeB);
  ag.steering.add(ag.pursuitB);
  ag.steering.add(ag.avoidB);

  ag.wanderB.weight = 1;
  ag.arriveB.weight = 0;
  ag.seekB.weight = 0;
  ag.fleeB.weight = 0;
  ag.pursuitB.weight = 0;

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

  // Goal biases now include personality (more individual variation)
  const aggrBias =
    (botClass === 'assault' ? 1.1 :
     botClass === 'flanker' ? 1.05 :
     botClass === 'sniper' ? 0.85 : 1.0)
    + personality.aggressionBias;

  const survBias =
    (botClass === 'sniper' ? 1.2 :
     botClass === 'assault' ? 0.85 : 1.0)
    + personality.cautionBias;

  ag.brain.addEvaluator(new AttackEvaluator(Math.max(0.3, aggrBias)));
  ag.brain.addEvaluator(new SurviveEvaluator(Math.max(0.3, survBias)));
  ag.brain.addEvaluator(new ReloadEvaluator(1.0 + (Math.random() - 0.5) * 0.1));
  ag.brain.addEvaluator(new SeekHealthEvaluator(1.0 + personality.cautionBias * 0.3));
  ag.brain.addEvaluator(new GetWeaponEvaluator(0.9 + (Math.random() - 0.5) * 0.1));
  ag.brain.addEvaluator(
    new HuntEvaluator(Math.max(0.3, aggrBias * 0.95 + personality.egoismBias * 0.3)),
  );
  ag.brain.addEvaluator(new PatrolEvaluator(1.0));

  setupFuzzy(ag);

  ag.perceptionSlot = gameState.agents.length % 3;

  gameState.entityManager.add(ag);
  gameState.agents.push(ag);

  return ag;
}

export async function buildAgents(): Promise<void> {
  let blueSwatReady = false;
  let enemyReady = false;

  try {
    await preloadBlueSwatAssets();
    blueSwatReady = hasBlueSwatAssets();
  } catch (err) {
    console.error('[AgentFactory] Failed SWAT preload', err);
  }

  try {
    await preloadEnemyAssets();
    enemyReady = hasEnemyAssets();
  } catch (err) {
    console.error('[AgentFactory] Failed enemy preload', err);
  }

  const player = new TDMAgent('Spiller', TEAM_BLUE, 'rifleman');
  player.position.set(BLUE_SPAWNS[0][0], 0, BLUE_SPAWNS[0][2]);
  player.spawnPos.set(BLUE_SPAWNS[0][0], 0, BLUE_SPAWNS[0][2]);
  player.maxSpeed = FP.moveSpeed;
  player.boundingRadius = 0.55;

  const pmesh = new THREE.Group();
  pmesh.visible = false;
  gameState.scene.add(pmesh);
  player.renderComponent = pmesh;
  player.setRenderComponent(pmesh, syncRC);
  gameState.entityManager.add(player);
  gameState.agents.push(player);
  player.hp = gameState.pHP;
  gameState.player = player;

  const blueClasses: BotClass[] = ['rifleman', 'rifleman', 'assault', 'sniper', 'flanker'];
  const blueNames = ['Fenrik', 'Bjørn', 'Storm', 'Øye', 'Skygge'];

  for (let i = 0; i < 5; i++) {
    const sp = BLUE_SPAWNS[i + 1] || BLUE_SPAWNS[i % BLUE_SPAWNS.length];
    const bot = mkAgent(
      blueNames[i],
      TEAM_BLUE,
      blueClasses[i],
      sp[0],
      sp[2],
      blueSwatReady ? 'swat' : 'placeholder',
    );

    console.info(
      `[AI] ${bot.name} (${bot.botClass}) → ${bot.personality?.archetype}, skill=${bot.personality?.skill.toFixed(2)}`,
    );
  }

  const redClasses: BotClass[] = ['rifleman', 'rifleman', 'assault', 'assault', 'sniper', 'flanker'];
  const redNames = ['Demon', 'Blaze', 'Hammer', 'Fang', 'Specter', 'Viper'];

  for (let i = 0; i < 6; i++) {
    const sp = RED_SPAWNS[i % RED_SPAWNS.length];
    const bot = mkAgent(
      redNames[i],
      TEAM_RED,
      redClasses[i],
      sp[0],
      sp[2],
      enemyReady ? 'enemy' : 'placeholder',
    );

    console.info(
      `[AI] ${bot.name} (${bot.botClass}) → ${bot.personality?.archetype}, skill=${bot.personality?.skill.toFixed(2)}`,
    );
  }
}
