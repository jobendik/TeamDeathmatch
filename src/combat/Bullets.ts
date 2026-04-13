import * as THREE from 'three';
import { gameState, type Bullet } from '@/core/GameState';
import { spawnImpact } from './Particles';
import { dealDmgPlayer, dealDmgAgent } from './Combat';
import { TEAM_BLUE } from '@/config/constants';

/**
 * Create and launch a bullet projectile.
 */
export function spawnBullet(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  ownerType: 'player' | 'ai',
  ownerTeam: number,
  dmg: number,
  col: number,
): void {
  const spd = ownerType === 'player' ? 42 : 22;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 5, 5),
    new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 3, transparent: true }),
  );
  mesh.position.copy(origin);
  gameState.scene.add(mesh);

  const pl = new THREE.PointLight(col, 1.5, 4);
  mesh.add(pl);

  gameState.bullets.push({
    mesh, pl, dir: dir.clone(), ownerType, ownerTeam, dmg, spd, life: 4,
  });
}

/**
 * Update all bullets: move, check wall/agent collisions.
 */
export function updateBullets(dt: number): void {
  const { bullets, yukaObs, agents, player, scene } = gameState;

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    b.mesh.position.x += b.dir.x * b.spd * dt;
    b.mesh.position.y += b.dir.y * b.spd * dt;
    b.mesh.position.z += b.dir.z * b.spd * dt;

    let hit = false;

    // Wall hits
    for (const ob of yukaObs) {
      const dx = b.mesh.position.x - ob.position.x;
      const dz = b.mesh.position.z - ob.position.z;
      if (dx * dx + dz * dz < (ob.boundingRadius + 0.1) ** 2) {
        spawnImpact(b.mesh.position.clone(), 0x445566);
        hit = true;
        break;
      }
    }

    // Agent hits
    if (!hit) {
      for (const ag of agents) {
        if (ag.isDead) continue;
        if (b.ownerType === 'player' && ag === player) continue;
        if (b.ownerType === 'ai' && ag.team === b.ownerTeam) continue;
        if (b.ownerType === 'player' && ag.team === player.team && ag !== player) continue;

        const dx = b.mesh.position.x - ag.position.x;
        const dy = b.mesh.position.y - 1.0;
        const dz = b.mesh.position.z - ag.position.z;
        if (dx * dx + dy * dy + dz * dz < 0.7 ** 2) {
          if (ag === player) {
            dealDmgPlayer(b.dmg);
          } else {
            dealDmgAgent(ag, b.dmg, b.ownerType === 'player' ? null : b.ownerTeam);
          }
          spawnImpact(b.mesh.position.clone(), ag.team === TEAM_BLUE ? 0x38bdf8 : 0xef4444);
          hit = true;
          break;
        }
      }
    }

    if (hit || b.life <= 0) {
      scene.remove(b.mesh);
      bullets.splice(i, 1);
    }
  }
}
