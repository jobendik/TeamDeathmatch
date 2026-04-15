import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { TEAM_BLUE, TEAM_RED, TEAM_COLORS } from '@/config/constants';
import { getEnemyFlagTeam, getFlagBasePosition } from '@/core/GameModes';
import type { TDMAgent } from '@/entities/TDMAgent';
import { scoreFlagCapture, resetFlagToBase, dropFlag } from './Combat';

function makeFlag(color: number): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.7, roughness: 0.3 }));
  pole.position.y = 1.1;
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.45, 0.06), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 }));
  cloth.position.set(0.38, 1.7, 0);
  g.add(pole, cloth);
  return g;
}

export function buildObjectives(): void {
  const blueBase = getFlagBasePosition(TEAM_BLUE);
  const redBase = getFlagBasePosition(TEAM_RED);

  gameState.flags[TEAM_BLUE].base.copy(blueBase);
  gameState.flags[TEAM_RED].base.copy(redBase);

  if (!gameState.flags[TEAM_BLUE].mesh) {
    gameState.flags[TEAM_BLUE].mesh = makeFlag(TEAM_COLORS[TEAM_BLUE]);
    gameState.flags[TEAM_RED].mesh = makeFlag(TEAM_COLORS[TEAM_RED]);
    gameState.scene.add(gameState.flags[TEAM_BLUE].mesh!);
    gameState.scene.add(gameState.flags[TEAM_RED].mesh!);
  }

  resetFlagToBase(TEAM_BLUE);
  resetFlagToBase(TEAM_RED);
  updateObjectiveVisibility();
}

export function updateObjectiveVisibility(): void {
  const visible = gameState.mode === 'ctf';
  gameState.flags[TEAM_BLUE].mesh!.visible = visible;
  gameState.flags[TEAM_RED].mesh!.visible = visible;
}

function agentNear(agent: TDMAgent, pos: THREE.Vector3, r = 2.2): boolean {
  const dx = agent.position.x - pos.x;
  const dz = agent.position.z - pos.z;
  return dx * dx + dz * dz <= r * r;
}

function carryFlag(flagTeam: 0 | 1, carrier: TDMAgent): void {
  const flag = gameState.flags[flagTeam];
  flag.carriedBy = carrier;
  flag.home = false;
  flag.dropped = false;
}

export function updateObjectives(): void {
  if (gameState.mode !== 'ctf') return;

  for (const team of [TEAM_BLUE, TEAM_RED] as const) {
    const flag = gameState.flags[team];
    const mesh = flag.mesh!;

    if (flag.carriedBy) {
      mesh.position.set(flag.carriedBy.position.x, 1.9, flag.carriedBy.position.z);
      if (flag.carriedBy.isDead) {
        dropFlag(team, new THREE.Vector3(flag.carriedBy.position.x, 0, flag.carriedBy.position.z));
      }
      continue;
    }

    if (flag.dropped) {
      mesh.position.set(flag.dropPos.x, 0, flag.dropPos.z);
    } else {
      mesh.position.copy(flag.base);
    }
  }

  for (const ag of gameState.agents) {
    if (ag.isDead) continue;

    const enemyFlagTeam = getEnemyFlagTeam(ag.team);
    const enemyFlag = gameState.flags[enemyFlagTeam];
    const ownFlag = gameState.flags[ag.team];

    if (!enemyFlag.carriedBy && agentNear(ag, enemyFlag.dropped ? enemyFlag.dropPos : enemyFlag.base, 2.4)) {
      carryFlag(enemyFlagTeam, ag);
    }

    if (ownFlag.dropped && agentNear(ag, ownFlag.dropPos, 2.2) && ag.team === ownFlag.team) {
      resetFlagToBase(ownFlag.team);
    }

    if (enemyFlag.carriedBy === ag && ownFlag.home && agentNear(ag, ownFlag.base, 2.8)) {
      scoreFlagCapture(ag);
    }
  }
}
