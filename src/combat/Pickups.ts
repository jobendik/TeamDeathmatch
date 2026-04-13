import * as THREE from 'three';
import { gameState } from '@/core/GameState';
import { WEAPONS, type WeaponId } from '@/config/weapons';

/**
 * Build pickup items (health + ammo + weapons) and add them to the scene.
 */
export function buildPickups(): void {
  const defs: { t: 'health' | 'ammo' | 'weapon'; col: number; x: number; z: number; weaponId?: WeaponId }[] = [
    { t: 'health', col: 0x22c55e, x: -25, z: 25 },
    { t: 'health', col: 0x22c55e, x: 25, z: -25 },
    { t: 'health', col: 0x22c55e, x: 0, z: 0 },
    { t: 'ammo', col: 0xf59e0b, x: -25, z: -25 },
    { t: 'ammo', col: 0xf59e0b, x: 25, z: 25 },
    { t: 'ammo', col: 0xf59e0b, x: -40, z: 0 },
    { t: 'ammo', col: 0xf59e0b, x: 40, z: 0 },
    // Weapon pickups
    { t: 'weapon', col: 0x8b5cf6, x: -15, z: 0, weaponId: 'shotgun' },
    { t: 'weapon', col: 0x8b5cf6, x: 15, z: 0, weaponId: 'sniper_rifle' },
    { t: 'weapon', col: 0x8b5cf6, x: 0, z: -30, weaponId: 'rocket_launcher' },
    { t: 'weapon', col: 0x8b5cf6, x: 0, z: 30, weaponId: 'smg' },
  ];

  for (const d of defs) {
    const geo = d.t === 'health'
      ? new THREE.BoxGeometry(0.5, 0.5, 0.5)
      : new THREE.BoxGeometry(0.55, 0.3, 0.65);

    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: d.col, emissive: d.col, emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.4,
      }),
    );
    mesh.position.set(d.x, 0.5, d.z);
    mesh.castShadow = true;
    gameState.scene.add(mesh);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.7, 20),
      new THREE.MeshBasicMaterial({ color: d.col, transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(d.x, 0.04, d.z);
    gameState.scene.add(ring);

    gameState.pickups.push({ mesh, ring, active: true, respawnAt: 0, t: d.t, x: d.x, z: d.z });
  }
}

/**
 * Update pickups: float animation, respawn timer, and AI/player collection.
 */
export function updatePickups(): void {
  const { pickups, worldElapsed, agents, player, pHP, pAmmo, pMaxAmmo } = gameState;

  for (const p of pickups) {
    // Respawn check
    if (!p.active && worldElapsed >= p.respawnAt) {
      p.active = true;
      p.mesh.visible = p.ring.visible = true;
    }

    // Float animation
    if (p.active) {
      p.mesh.position.y = 0.5 + Math.sin(worldElapsed * 2 + p.x) * 0.1;
      p.mesh.rotation.y += 0.02;
      (p.ring.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(worldElapsed * 2.5 + p.z) * 0.1;
    }

    // AI pickup collection
    for (const ag of agents) {
      if (ag === player || ag.isDead || !p.active) continue;
      const dx = ag.position.x - p.x;
      const dz = ag.position.z - p.z;
      if (dx * dx + dz * dz < 2.5 * 2.5) {
        if (p.t === 'health' && ag.hp < ag.maxHP * 0.7) {
          p.active = false;
          p.mesh.visible = p.ring.visible = false;
          p.respawnAt = worldElapsed + 15;
          ag.hp = Math.min(ag.maxHP, ag.hp + 35);
        } else if (p.t === 'ammo' && ag.ammo < ag.magSize * 0.4) {
          p.active = false;
          p.mesh.visible = p.ring.visible = false;
          p.respawnAt = worldElapsed + 12;
          ag.ammo = ag.magSize;
        } else if (p.t === 'weapon' && p.weaponId) {
          const newWep = WEAPONS[p.weaponId];
          const curWep = WEAPONS[ag.weaponId];
          if (newWep.desirability > curWep.desirability) {
            p.active = false;
            p.mesh.visible = p.ring.visible = false;
            p.respawnAt = worldElapsed + 25;
            ag.weaponId = p.weaponId;
            ag.damage = newWep.damage;
            ag.fireRate = newWep.fireRate;
            ag.burstSize = newWep.burstSize;
            ag.burstDelay = newWep.burstDelay;
            ag.reloadTime = newWep.reloadTime;
            ag.magSize = newWep.magSize;
            ag.ammo = newWep.magSize;
            ag.aimError = newWep.aimError;
          }
        }
      }
    }
  }
}
