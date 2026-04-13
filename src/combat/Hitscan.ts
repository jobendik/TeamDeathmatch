import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { spawnImpact, spawnWallSparks, spawnTracer, spawnMuzzleFlash, spawnExplosion, spawnRocketTrail } from './Particles';
import { dealDmgPlayer, dealDmgAgent } from './Combat';
import { TEAM_BLUE } from '@/config/constants';
import { WEAPONS, type WeaponId } from '@/config/weapons';
import type { TDMAgent } from '@/entities/TDMAgent';



/**
 * Perform a hitscan shot: instant raycast from origin to direction.
 * Returns true if an enemy was hit.
 */
export function hitscanShot(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  ownerType: 'player' | 'ai',
  ownerTeam: number,
  weaponId: WeaponId,
  col: number,
): boolean {
  const wep = WEAPONS[weaponId];
  const { agents, player, wallMeshes, scene } = gameState;

  // Raycast — reuse global raycaster
  const rc = gameState.raycaster;
  rc.set(origin.clone(), dir.clone().normalize());
  rc.near = 0;
  rc.far = wep.range;

  // Check wall hits first
  const wallHits = rc.intersectObjects(wallMeshes, false);
  const wallDist = wallHits.length > 0 ? wallHits[0].distance : wep.range;

  // Check agent hits with capsule collision (simplified to sphere checks)
  let hitAgent: TDMAgent | null = null;
  let hitDist = wallDist;
  let isHeadshot = false;

  for (const ag of agents) {
    if (ag.isDead) continue;
    if (ownerType === 'player' && ag === player) continue;
    if (ownerType === 'ai' && ag.team === ownerTeam) continue;
    if (ownerType === 'player' && ag.team === player.team && ag !== player) continue;

    // Body hitbox check (cylinder approximation via ray-sphere intersection)
    const agPos = new THREE.Vector3(ag.position.x, 1.0, ag.position.z);
    const toAgent = agPos.clone().sub(origin);
    const proj = toAgent.dot(dir.clone().normalize());
    if (proj < 0 || proj > hitDist) continue;

    const closest = origin.clone().add(dir.clone().normalize().multiplyScalar(proj));
    const bodyDist = closest.distanceTo(agPos);

    if (bodyDist < 0.55) { // body hit radius
      hitAgent = ag;
      hitDist = proj;

      // Headshot check (head at y=1.42, radius 0.16)
      const headPos = new THREE.Vector3(ag.position.x, 1.42, ag.position.z);
      const headDist = closest.distanceTo(headPos);
      isHeadshot = headDist < 0.22;
    }
  }

  // Calculate end point
  const endPoint = origin.clone().add(dir.clone().normalize().multiplyScalar(hitDist));

  // Spawn tracer line
  spawnTracer(origin, endPoint, col);

  // Apply damage or wall impact
  if (hitAgent) {
    let dmg = wep.damage;
    if (isHeadshot) dmg *= wep.headshotMult;

    // Distance falloff for SMG/pistol
    if (wep.range < 40 && hitDist > wep.range * 0.6) {
      dmg *= 0.7;
    }

    if (hitAgent === player) {
      dealDmgPlayer(dmg);
    } else {
      dealDmgAgent(hitAgent, dmg, ownerType === 'player' ? null : ownerTeam);
    }

    // Blood/spark impact at hit position
    const hitCol = hitAgent.team === TEAM_BLUE ? 0x38bdf8 : 0xef4444;
    spawnImpact(endPoint, hitCol, isHeadshot ? 12 : 6);
    return true;
  } else if (wallHits.length > 0) {
    // Wall sparks — use the hit normal for directional sparks
    const normal = wallHits[0].face?.normal || null;
    const worldNormal = normal ? normal.clone().transformDirection(wallHits[0].object.matrixWorld) : null;
    spawnWallSparks(endPoint, worldNormal, 6);
  }

  return false;
}

/**
 * Fire a shotgun blast — multiple pellets with spread.
 */
export function shotgunBlast(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  ownerType: 'player' | 'ai',
  ownerTeam: number,
  col: number,
): void {
  const wep = WEAPONS.shotgun;

  for (let i = 0; i < wep.pellets; i++) {
    const spread = dir.clone();
    spread.x += (Math.random() - 0.5) * wep.aimError;
    spread.y += (Math.random() - 0.5) * wep.aimError * 0.6;
    spread.z += (Math.random() - 0.5) * wep.aimError;
    spread.normalize();
    hitscanShot(origin, spread, ownerType, ownerTeam, 'shotgun', col);
  }
}

// Tracers removed for performance and visual clarity

/**
 * Spawn a rocket projectile (non-hitscan).
 */
export function spawnRocket(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  ownerType: 'player' | 'ai',
  ownerTeam: number,
  col: number,
): void {
  const wep = WEAPONS.rocket_launcher;

  // Rocket mesh — cylinder with glow
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6),
    new THREE.MeshStandardMaterial({
      color: 0xaa4400, emissive: 0xff6600, emissiveIntensity: 2,
    }),
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.position.copy(origin);
  gameState.scene.add(mesh);

  const trail = new THREE.PointLight(0xff6600, 2, 6);
  mesh.add(trail);

  gameState.bullets.push({
    mesh, pl: trail, dir: dir.clone(),
    ownerType, ownerTeam, dmg: wep.damage,
    spd: wep.projectileSpeed, life: 4,
    isRocket: true, splashRadius: wep.splashRadius,
  });
}

/**
 * Spawn a grenade projectile.
 */
export function spawnGrenade(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  ownerType: 'player' | 'ai',
  ownerTeam: number,
): void {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 8, 8),
    new THREE.MeshStandardMaterial({
      color: 0x445500, emissive: 0x334400, emissiveIntensity: 0.5,
    }),
  );
  mesh.position.copy(origin);
  gameState.scene.add(mesh);

  const light = new THREE.PointLight(0x88aa00, 0.5, 3);
  mesh.add(light);

  gameState.bullets.push({
    mesh, pl: light,
    dir: new THREE.Vector3(dir.x * 18, 6, dir.z * 18), // arc throw
    ownerType, ownerTeam, dmg: 60,
    spd: 1, life: 2.5, // fuse time
    isGrenade: true, splashRadius: 6,
  });
}

/**
 * Update projectile (rockets/grenades) — replaces old bullet system for non-hitscan.
 */
export function updateProjectiles(dt: number): void {
  const { bullets, agents, player, scene, yukaObs } = gameState;

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;

    if (b.isGrenade) {
      // Grenade physics: arc with gravity
      b.dir.y -= 15 * dt; // gravity
      b.mesh.position.x += b.dir.x * dt;
      b.mesh.position.y += b.dir.y * dt;
      b.mesh.position.z += b.dir.z * dt;

      // Bounce off floor
      if (b.mesh.position.y < 0.1) {
        b.mesh.position.y = 0.1;
        b.dir.y *= -0.3;
        b.dir.x *= 0.7;
        b.dir.z *= 0.7;
      }

      // Explode when fuse runs out
      if (b.life <= 0) {
        explode(b.mesh.position.clone(), b.splashRadius!, b.dmg, b.ownerType, b.ownerTeam);
        scene.remove(b.mesh);
        bullets.splice(i, 1);
      }
      continue;
    }

    if (b.isRocket) {
      // Smoke trail behind rocket
      spawnRocketTrail(b.mesh.position.clone());

      // Rocket: straight line, explode on contact
      b.mesh.position.x += b.dir.x * b.spd * dt;
      b.mesh.position.y += b.dir.y * b.spd * dt;
      b.mesh.position.z += b.dir.z * b.spd * dt;

      let hit = false;

      // Wall collision
      for (const ob of yukaObs) {
        const dx = b.mesh.position.x - ob.position.x;
        const dz = b.mesh.position.z - ob.position.z;
        if (dx * dx + dz * dz < (ob.boundingRadius + 0.2) ** 2) {
          hit = true;
          break;
        }
      }

      // Agent collision
      if (!hit) {
        for (const ag of agents) {
          if (ag.isDead) continue;
          if (b.ownerType === 'player' && ag === player) continue;
          if (b.ownerType === 'ai' && ag.team === b.ownerTeam) continue;

          const dx = b.mesh.position.x - ag.position.x;
          const dy = b.mesh.position.y - 1.0;
          const dz = b.mesh.position.z - ag.position.z;
          if (dx * dx + dy * dy + dz * dz < 0.8 ** 2) {
            hit = true;
            break;
          }
        }
      }

      // Floor collision
      if (b.mesh.position.y < 0.15) hit = true;

      if (hit || b.life <= 0) {
        explode(b.mesh.position.clone(), b.splashRadius!, b.dmg, b.ownerType, b.ownerTeam);
        scene.remove(b.mesh);
        bullets.splice(i, 1);
      }
      continue;
    }
    
    // Legacy projectile bullets (shouldn't be used anymore, but keep for safety)
    b.mesh.position.x += b.dir.x * b.spd * dt;
    b.mesh.position.y += b.dir.y * b.spd * dt;
    b.mesh.position.z += b.dir.z * b.spd * dt;
    if (b.life <= 0) {
      scene.remove(b.mesh);
      bullets.splice(i, 1);
    }
  }
}

/**
 * Splash damage explosion.
 */
function explode(
  pos: THREE.Vector3,
  radius: number,
  damage: number,
  ownerType: 'player' | 'ai',
  ownerTeam: number,
): void {
  const { agents, player } = gameState;

  // Visual explosion
  spawnExplosion(pos, radius);

  // Splash damage
  for (const ag of agents) {
    if (ag.isDead) continue;
    if (ownerType === 'ai' && ag.team === ownerTeam) continue;

    const agPos = new THREE.Vector3(ag.position.x, 1.0, ag.position.z);
    const dist = agPos.distanceTo(pos);
    if (dist < radius) {
      const falloff = 1 - (dist / radius);
      const dmg = Math.round(damage * falloff);

      if (ag === player) {
        dealDmgPlayer(dmg);
      } else {
        dealDmgAgent(ag, dmg, ownerType === 'player' ? null : ownerTeam);
      }
    }
  }
}
