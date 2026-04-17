import * as THREE from 'three';
import { gameState } from '@/core/GameState';

// Shared geometry/material for impact particles to avoid per-spawn allocations
const _impactGeo = new THREE.SphereGeometry(0.06, 4, 4);
const _sparkGeo = new THREE.SphereGeometry(0.03, 3, 3);
const _impactMatCache = new Map<number, THREE.MeshBasicMaterial>();

function getImpactMat(col: number): THREE.MeshBasicMaterial {
  let mat = _impactMatCache.get(col);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color: col, transparent: true });
    _impactMatCache.set(col, mat);
  }
  return mat;
}

/**
 * Spawn impact particles at a position.
 */
export function spawnImpact(pos: THREE.Vector3, col: number, n = 6): void {
  const baseMat = getImpactMat(col);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(_impactGeo, baseMat.clone());
    m.position.copy(pos);
    gameState.scene.add(m);
    gameState.particles.push({
      mesh: m,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 6,
      ),
      life: 0.4,
      mL: 0.4,
    });
  }
}

/**
 * Spawn wall hit sparks — brighter, faster, more directional.
 */
export function spawnWallSparks(pos: THREE.Vector3, normal: THREE.Vector3 | null, n = 8): void {
  const sparkMat = getImpactMat(0xffcc66);
  const dimMat = getImpactMat(0x556688);
  for (let i = 0; i < n; i++) {
    const isBright = i < n * 0.6;
    const m = new THREE.Mesh(_sparkGeo, (isBright ? sparkMat : dimMat).clone());
    m.position.copy(pos);
    gameState.scene.add(m);
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 8,
      Math.random() * 4 + 2,
      (Math.random() - 0.5) * 8,
    );
    // Bias sparks along the wall normal for directionality
    if (normal) {
      vel.x += normal.x * 3;
      vel.y += normal.y * 3;
      vel.z += normal.z * 3;
    }
    gameState.particles.push({
      mesh: m, vel,
      life: 0.15 + Math.random() * 0.2,
      mL: 0.35,
    });
  }
}

/**
 * Spawn a hitscan tracer line from origin to end point.
 */
export function spawnTracer(origin: THREE.Vector3, end: THREE.Vector3, col: number): void {
  const dir = end.clone().sub(origin);
  const len = dir.length();
  if (len < 0.5) return;

  const mid = origin.clone().add(end).multiplyScalar(0.5);

  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.020, len, 4, 1),
    new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  glow.position.copy(mid);
  glow.lookAt(end);
  glow.rotateX(Math.PI / 2);
  gameState.scene.add(glow);
  gameState.particles.push({ mesh: glow, vel: new THREE.Vector3(), life: 0.07, mL: 0.07 });

  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.010, 0.008, len, 5, 1),
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  core.position.copy(mid);
  core.lookAt(end);
  core.rotateX(Math.PI / 2);
  gameState.scene.add(core);
  gameState.particles.push({ mesh: core, vel: new THREE.Vector3(), life: 0.05, mL: 0.05 });
}

/**
 * Spawn a muzzle flash light at a world position (for AI agents shooting).
 */
export function spawnMuzzleFlash(pos: THREE.Vector3, col: number): void {
  const flash = new THREE.PointLight(col, 4, 8);
  flash.position.copy(pos);
  gameState.scene.add(flash);

  // Flash sphere (small bright dot)
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 6, 6),
    new THREE.MeshBasicMaterial({
      color: 0xffdd55, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  sphere.position.copy(pos);
  gameState.scene.add(sphere);

  // Track the light for cleanup
  gameState.particles.push({
    mesh: sphere, vel: new THREE.Vector3(),
    life: 0.05, mL: 0.05, light: flash,
  });
}

/**
 * Spawn death explosion effect with ring + shockwave.
 */
export function spawnDeath(pos: THREE.Vector3, col: number): void {
  spawnImpact(pos, col, 22);

  // Death flash light
  const flash = new THREE.PointLight(col, 6, 12);
  flash.position.copy(pos);
  flash.position.y = 1;
  gameState.scene.add(flash);

  // Expanding ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.1, 1.4, 24),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(pos);
  ring.position.y = 0.08;
  gameState.scene.add(ring);
  gameState.particles.push({ mesh: ring, vel: new THREE.Vector3(), life: 0.7, mL: 0.7, isRing: true });

  // Second outer shockwave ring
  const ring2 = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.5, 20),
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.4,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }),
  );
  ring2.rotation.x = -Math.PI / 2;
  ring2.position.copy(pos);
  ring2.position.y = 0.1;
  gameState.scene.add(ring2);
  gameState.particles.push({ mesh: ring2, vel: new THREE.Vector3(), life: 0.5, mL: 0.5, isRing: true, light: flash });

  // Upward ember sparks
  for (let i = 0; i < 8; i++) {
    const ember = new THREE.Mesh(
      _sparkGeo,
      new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending,
      }),
    );
    ember.position.copy(pos);
    ember.position.y += 0.5;
    gameState.scene.add(ember);
    gameState.particles.push({
      mesh: ember,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        4 + Math.random() * 6,
        (Math.random() - 0.5) * 3,
      ),
      life: 0.6 + Math.random() * 0.4,
      mL: 1.0,
    });
  }
}

/**
 * Spawn explosion effect for rockets/grenades.
 */
export function spawnExplosion(pos: THREE.Vector3, radius: number): void {
  // Bright flash
  const flash = new THREE.PointLight(0xff6600, 10, radius * 3);
  flash.position.copy(pos);
  gameState.scene.add(flash);

  // Fire particles
  const fireColors = [0xff6600, 0xff4400, 0xffaa00, 0xff2200];
  for (let i = 0; i < 30; i++) {
    const col = fireColors[Math.floor(Math.random() * fireColors.length)];
    const m = new THREE.Mesh(
      _impactGeo,
      new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending,
      }),
    );
    m.position.copy(pos);
    const spd = 3 + Math.random() * 8;
    gameState.scene.add(m);
    gameState.particles.push({
      mesh: m,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * spd * 2,
        Math.random() * spd,
        (Math.random() - 0.5) * spd * 2,
      ),
      life: 0.3 + Math.random() * 0.4,
      mL: 0.7,
    });
  }

  // Smoke puffs (dark, larger, slower)
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.15 + Math.random() * 0.15, 5, 5),
      new THREE.MeshBasicMaterial({
        color: 0x222222, transparent: true, opacity: 0.5,
      }),
    );
    m.position.copy(pos);
    gameState.scene.add(m);
    gameState.particles.push({
      mesh: m,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        1 + Math.random() * 3,
        (Math.random() - 0.5) * 2,
      ),
      life: 0.6 + Math.random() * 0.5,
      mL: 1.1,
      isSmoke: true,
    });
  }

  // Ground scorch ring
  const scorch = new THREE.Mesh(
    new THREE.RingGeometry(0.3, radius * 0.6, 20),
    new THREE.MeshBasicMaterial({
      color: 0xff6600, transparent: true, opacity: 0.7,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }),
  );
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.copy(pos);
  scorch.position.y = 0.05;
  gameState.scene.add(scorch);
  gameState.particles.push({ mesh: scorch, vel: new THREE.Vector3(), life: 0.8, mL: 0.8, isRing: true, light: flash });

  // Trigger screen shake for nearby player
  const playerDist = gameState.player.position.distanceTo(pos as any);
  if (playerDist < radius * 4) {
    const intensity = Math.max(0, 1 - playerDist / (radius * 4));
    triggerScreenShake(intensity * 0.5, 0.3);
  }
}

// ═══════════════════════════════════════════
//  ROCKET SMOKE TRAIL
// ═══════════════════════════════════════════

const _smokeGeo = new THREE.SphereGeometry(0.08, 4, 4);
const _trailEmberGeo = new THREE.SphereGeometry(0.04, 3, 3);

/**
 * Spawn smoke + ember trail particles behind a rocket.
 */
export function spawnRocketTrail(pos: THREE.Vector3): void {
  // Smoke puff
  const smoke = new THREE.Mesh(
    _smokeGeo,
    new THREE.MeshBasicMaterial({ color: 0x666666, transparent: true, opacity: 0.45 }),
  );
  smoke.position.copy(pos);
  gameState.scene.add(smoke);
  gameState.particles.push({
    mesh: smoke,
    vel: new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8),
    life: 0.35 + Math.random() * 0.25,
    mL: 0.6,
    isSmoke: true,
  });

  // Ember spark
  if (Math.random() < 0.6) {
    const ember = new THREE.Mesh(
      _trailEmberGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff6600, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    ember.position.copy(pos);
    gameState.scene.add(ember);
    gameState.particles.push({
      mesh: ember,
      vel: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2),
      life: 0.12 + Math.random() * 0.12,
      mL: 0.24,
    });
  }
}

// ═══════════════════════════════════════════
//  SCREEN SHAKE
// ═══════════════════════════════════════════

// ── Bullet hole decals ──
const _decalGeo = new THREE.PlaneGeometry(0.12, 0.12);
const _decalMat = new THREE.MeshBasicMaterial({
  color: 0x111111, transparent: true, opacity: 0.7,
  depthWrite: false, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: -1,
});
const MAX_DECALS = 64;
const _decals: THREE.Mesh[] = [];

export function spawnBulletHole(pos: THREE.Vector3, normal: THREE.Vector3 | null): void {
  const decal = new THREE.Mesh(_decalGeo, _decalMat);
  decal.position.copy(pos);
  if (normal) {
    decal.position.addScaledVector(normal, 0.01);
    decal.lookAt(pos.clone().add(normal));
  } else {
    decal.rotation.x = -Math.PI / 2;
    decal.position.y = 0.02;
  }
  gameState.scene.add(decal);
  _decals.push(decal);
  if (_decals.length > MAX_DECALS) {
    const old = _decals.shift()!;
    gameState.scene.remove(old);
    old.geometry.dispose();
  }
}

let shakeIntensity = 0;
let shakeTimer = 0;

export function triggerScreenShake(intensity: number, duration: number): void {
  shakeIntensity = Math.max(shakeIntensity, intensity);
  shakeTimer = Math.max(shakeTimer, duration);
}

export function updateScreenShake(dt: number): void {
  if (shakeTimer <= 0) return;
  shakeTimer -= dt;
  const t = Math.max(0, shakeTimer);
  const shake = shakeIntensity * t * 4;
  gameState.cameraPitch += (Math.random() - 0.5) * shake * 0.03;
  gameState.cameraYaw += (Math.random() - 0.5) * shake * 0.02;
  if (shakeTimer <= 0) {
    shakeIntensity = 0;
  }
}

/**
 * Update all particles each frame (gravity, fade, scale).
 */
export function updateParticles(dt: number): void {
  const { particles, scene } = gameState;

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;

    if (p.life <= 0) {
      scene.remove(p.mesh);
      if (p.light) scene.remove(p.light);
      particles.splice(i, 1);
      continue;
    }

    const t = p.life / p.mL;
    p.mesh.position.add(p.vel.clone().multiplyScalar(dt));

    // Light decay
    if (p.light) {
      p.light.intensity *= Math.max(0, 1 - dt * 12);
    }

    if (p.isSmoke) {
      // Smoke: grows, slows, fades
      const s = 1 + (1 - t) * 3;
      p.mesh.scale.setScalar(s);
      p.vel.multiplyScalar(Math.max(0, 1 - dt * 2));
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = t * 0.5;
    } else if (p.isRing) {
      const s = 1 + (1 - t) * 4;
      p.mesh.scale.set(s, s, s);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = t * 0.8;
    } else {
      p.vel.y -= 9 * dt;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = t;
      p.mesh.scale.setScalar(t * 0.8 + 0.2);
    }
  }
}

// ── Ambient dust motes ──
let _dustPoints: THREE.Points | null = null;
let _dustVelocities: Float32Array | null = null;
const DUST_COUNT = 120;
const DUST_RANGE = 30; // around camera

export function initAmbientDust(): void {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(DUST_COUNT * 3);
  _dustVelocities = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * DUST_RANGE * 2;
    positions[i * 3 + 1] = Math.random() * 6;
    positions[i * 3 + 2] = (Math.random() - 0.5) * DUST_RANGE * 2;
    _dustVelocities[i * 3] = (Math.random() - 0.5) * 0.3;
    _dustVelocities[i * 3 + 1] = (Math.random() - 0.5) * 0.08;
    _dustVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xccccaa, size: 0.06, transparent: true,
    opacity: 0.35, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  _dustPoints = new THREE.Points(geo, mat);
  _dustPoints.frustumCulled = false;
  gameState.scene.add(_dustPoints);
}

export function updateAmbientDust(dt: number): void {
  if (!_dustPoints || !_dustVelocities) return;
  const posArr = _dustPoints.geometry.attributes.position.array as Float32Array;
  const cam = gameState.camera;
  for (let i = 0; i < DUST_COUNT; i++) {
    const i3 = i * 3;
    posArr[i3] += _dustVelocities[i3] * dt;
    posArr[i3 + 1] += _dustVelocities[i3 + 1] * dt;
    posArr[i3 + 2] += _dustVelocities[i3 + 2] * dt;
    // wrap around camera
    const dx = posArr[i3] - cam.position.x;
    const dz = posArr[i3 + 2] - cam.position.z;
    if (Math.abs(dx) > DUST_RANGE) posArr[i3] = cam.position.x + (Math.random() - 0.5) * DUST_RANGE * 2;
    if (Math.abs(dz) > DUST_RANGE) posArr[i3 + 2] = cam.position.z + (Math.random() - 0.5) * DUST_RANGE * 2;
    if (posArr[i3 + 1] < 0 || posArr[i3 + 1] > 6) {
      posArr[i3 + 1] = Math.random() * 5;
      _dustVelocities[i3 + 1] = (Math.random() - 0.5) * 0.08;
    }
  }
  _dustPoints.geometry.attributes.position.needsUpdate = true;
}
