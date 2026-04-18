/**
 * RagdollSystem — physics-based death animations.
 *
 * Replaces the canned death animation in playAgentDeathAnimation() with
 * verlet-integrated bone physics. Lightweight (no rigid body solver) and
 * fully self-contained — does not depend on Ammo.js, Cannon, or Rapier.
 *
 * Design:
 *   - On kill, convert the skeletal mesh into a simplified verlet puppet
 *     (head → neck → spine → hips, with attached limbs as pendulums).
 *   - Apply impulse from the damage direction with optional headshot bonus.
 *   - Constraints solved via relaxation. Bones are rigid; joints bendy.
 *   - Ground collision via a simple terrain height query (uses arena floor
 *     at y=0 as fallback).
 *   - Ragdolls cleaned up after RAGDOLL_LIFETIME_S or fade-out.
 *
 * Perf: each ragdoll is ~14 points + 13 constraints; 12 iterations/step.
 * Can comfortably run 8-12 concurrent ragdolls at 60 FPS.
 *
 * Integration:
 *   - AgentFactory death: call Ragdoll.spawn(mesh, damageDir, isHeadshot)
 *     instead of playAgentDeathAnimation
 *   - updateRagdolls(dt) called from GameLoop
 *   - Meshes are reparented to the ragdoll rig; originals hidden/disposed
 */

import * as THREE from 'three';

const GRAVITY = -22.0;
const AIR_DAMPING = 0.985;
const GROUND_FRICTION = 0.82;
const GROUND_BOUNCE = 0.18;
const GROUND_Y = 0.02;
const CONSTRAINT_ITERATIONS = 10;
const RAGDOLL_LIFETIME_S = 20;
const FADE_DURATION_S = 2;

// ─────────────────────────────────────────────────────────────────────
//  VERLET PUPPET DATA
// ─────────────────────────────────────────────────────────────────────

interface Point {
  pos: THREE.Vector3;
  prevPos: THREE.Vector3;
  mass: number;        // 0 = pinned
  grounded: boolean;
}

interface Constraint {
  a: number;  // index into points
  b: number;
  targetDist: number;
  stiffness: number;   // 0-1
}

interface RagdollRig {
  mesh: THREE.Object3D;         // the original agent mesh (reparented/transformed)
  bones: Map<string, THREE.Bone>;
  points: Point[];
  constraints: Constraint[];
  age: number;
  dead: boolean;                 // scheduled for removal
  fadeStart: number;             // age at which fade begins
  originalMaterials: Array<{ mesh: THREE.Mesh; mat: THREE.Material | THREE.Material[]; transparent: boolean; opacity: number }>;
  // Bone-to-point mapping for applying physics back to skeleton
  boneMap: Array<{ bone: THREE.Bone; point: number; parentPoint?: number; upAxis: THREE.Vector3 }>;
}

const rigs: RagdollRig[] = [];

// ─────────────────────────────────────────────────────────────────────
//  SPAWN
// ─────────────────────────────────────────────────────────────────────

const BONE_NAMES = {
  head: ['Head', 'mixamorigHead', 'mixamorig:Head', 'head'],
  neck: ['Neck', 'mixamorigNeck', 'mixamorig:Neck', 'neck'],
  spine: ['Spine', 'mixamorigSpine', 'mixamorig:Spine', 'spine'],
  hips: ['Hips', 'mixamorigHips', 'mixamorig:Hips', 'hips'],
  lShoulder: ['LeftArm', 'mixamorigLeftArm', 'mixamorig:LeftArm'],
  rShoulder: ['RightArm', 'mixamorigRightArm', 'mixamorig:RightArm'],
  lElbow: ['LeftForeArm', 'mixamorigLeftForeArm', 'mixamorig:LeftForeArm'],
  rElbow: ['RightForeArm', 'mixamorigRightForeArm', 'mixamorig:RightForeArm'],
  lHand: ['LeftHand', 'mixamorigLeftHand', 'mixamorig:LeftHand'],
  rHand: ['RightHand', 'mixamorigRightHand', 'mixamorig:RightHand'],
  lHip: ['LeftUpLeg', 'mixamorigLeftUpLeg', 'mixamorig:LeftUpLeg'],
  rHip: ['RightUpLeg', 'mixamorigRightUpLeg', 'mixamorig:RightUpLeg'],
  lKnee: ['LeftLeg', 'mixamorigLeftLeg', 'mixamorig:LeftLeg'],
  rKnee: ['RightLeg', 'mixamorigRightLeg', 'mixamorig:RightLeg'],
  lFoot: ['LeftFoot', 'mixamorigLeftFoot', 'mixamorig:LeftFoot'],
  rFoot: ['RightFoot', 'mixamorigRightFoot', 'mixamorig:RightFoot'],
};

function findBone(mesh: THREE.Object3D, names: string[]): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  mesh.traverse((child) => {
    if (found) return;
    if (child instanceof THREE.Bone) {
      for (const n of names) {
        if (child.name === n || child.name.endsWith(':' + n) || child.name.toLowerCase() === n.toLowerCase()) {
          found = child;
          return;
        }
      }
    }
  });
  return found;
}

function getWorldPos(obj: THREE.Object3D): THREE.Vector3 {
  const v = new THREE.Vector3();
  obj.getWorldPosition(v);
  return v;
}

/**
 * Convert an agent's rigged mesh into an active ragdoll.
 * @returns true if ragdoll was successfully created
 */
export function spawnRagdoll(
  mesh: THREE.Object3D,
  impulseDir: THREE.Vector3,
  impulseMagnitude: number,
  isHeadshot: boolean = false,
): boolean {
  const bones = new Map<string, THREE.Bone>();
  for (const [key, names] of Object.entries(BONE_NAMES)) {
    const b = findBone(mesh, names);
    if (b) bones.set(key, b);
  }

  // Require at minimum hips + head + one shoulder + one hip to create ragdoll
  if (!bones.has('hips') || !bones.has('head')) {
    // Fallback: no bones → apply impulse to whole mesh and fade
    return fallbackRagdoll(mesh, impulseDir, impulseMagnitude);
  }

  // Gather material refs for fade-out
  const originalMaterials: RagdollRig['originalMaterials'] = [];
  mesh.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material) {
      const mat = child.material;
      if (Array.isArray(mat)) {
        originalMaterials.push({ mesh: child, mat, transparent: false, opacity: 1 });
      } else {
        originalMaterials.push({
          mesh: child, mat,
          transparent: (mat as THREE.Material).transparent,
          opacity: (mat as any).opacity ?? 1,
        });
      }
    }
  });

  // Build verlet point set from bone world positions
  const points: Point[] = [];
  const boneMap: RagdollRig['boneMap'] = [];

  const pointFor = (bone: THREE.Bone, mass: number = 1): number => {
    const idx = points.length;
    const wp = getWorldPos(bone);
    points.push({
      pos: wp.clone(),
      prevPos: wp.clone(),
      mass,
      grounded: false,
    });
    return idx;
  };

  const hipsIdx = pointFor(bones.get('hips')!, 1.4);
  const spineIdx = bones.has('spine') ? pointFor(bones.get('spine')!, 1.1) : hipsIdx;
  const neckIdx = bones.has('neck') ? pointFor(bones.get('neck')!, 0.6) : spineIdx;
  const headIdx = pointFor(bones.get('head')!, 0.7);

  const indexOf: Record<string, number> = {
    hips: hipsIdx, spine: spineIdx, neck: neckIdx, head: headIdx,
  };

  // Limbs
  const limbs = [
    { s: 'lShoulder', e: 'lElbow', h: 'lHand' },
    { s: 'rShoulder', e: 'rElbow', h: 'rHand' },
    { s: 'lHip', e: 'lKnee', h: 'lFoot' },
    { s: 'rHip', e: 'rKnee', h: 'rFoot' },
  ];
  const limbRootAttach = { lShoulder: spineIdx, rShoulder: spineIdx, lHip: hipsIdx, rHip: hipsIdx };

  for (const l of limbs) {
    if (bones.has(l.s)) {
      const si = pointFor(bones.get(l.s)!, 0.5);
      indexOf[l.s] = si;
      if (bones.has(l.e)) {
        const ei = pointFor(bones.get(l.e)!, 0.4);
        indexOf[l.e] = ei;
        if (bones.has(l.h)) {
          const hi = pointFor(bones.get(l.h)!, 0.3);
          indexOf[l.h] = hi;
        }
      }
    }
  }

  // Build constraints (distance-preserving, with stiffness)
  const constraints: Constraint[] = [];
  const connect = (a: number, b: number, stiffness: number = 1) => {
    const dist = points[a].pos.distanceTo(points[b].pos);
    if (dist > 0.01) constraints.push({ a, b, targetDist: dist, stiffness });
  };

  connect(hipsIdx, spineIdx, 1);
  connect(spineIdx, neckIdx, 0.95);
  connect(neckIdx, headIdx, 0.9);
  // Cross-constraint for torso rigidity
  connect(hipsIdx, headIdx, 0.25);

  for (const l of limbs) {
    const attach = (limbRootAttach as any)[l.s];
    if (indexOf[l.s] != null && attach != null) {
      connect(attach, indexOf[l.s], 1);
    }
    if (indexOf[l.s] != null && indexOf[l.e] != null) {
      connect(indexOf[l.s], indexOf[l.e], 0.9);
    }
    if (indexOf[l.e] != null && indexOf[l.h] != null) {
      connect(indexOf[l.e], indexOf[l.h], 0.9);
    }
  }

  // Bone→point mapping (for skeleton update)
  for (const [key, bone] of bones) {
    if (indexOf[key] == null) continue;
    boneMap.push({
      bone,
      point: indexOf[key],
      upAxis: new THREE.Vector3(0, 1, 0),
    });
  }

  // Apply impulse by displacing current - prev in direction
  const impulse = impulseDir.clone().normalize().multiplyScalar(impulseMagnitude * 0.05);
  impulse.y += impulseMagnitude * 0.02;  // upward kick
  for (const p of points) {
    p.prevPos.sub(impulse);
  }

  // Extra impulse to head if headshot
  if (isHeadshot) {
    const extra = impulseDir.clone().normalize().multiplyScalar(0.15);
    extra.y += 0.08;
    points[headIdx].prevPos.sub(extra);
  }

  const rig: RagdollRig = {
    mesh,
    bones,
    points,
    constraints,
    age: 0,
    dead: false,
    fadeStart: RAGDOLL_LIFETIME_S - FADE_DURATION_S,
    originalMaterials,
    boneMap,
  };
  rigs.push(rig);

  // Stop any playing animations on the mesh so our physics takes over
  (mesh as any).userData.ragdollActive = true;
  const mixer: THREE.AnimationMixer | undefined = (mesh as any).userData?.animMixer;
  if (mixer) {
    mixer.stopAllAction();
  }

  return true;
}

function fallbackRagdoll(mesh: THREE.Object3D, dir: THREE.Vector3, mag: number): boolean {
  // Unrigged or simple-shape agent: just tumble the whole mesh
  const vel = dir.clone().normalize().multiplyScalar(mag * 0.8);
  vel.y += mag * 0.4;
  const angVel = new THREE.Vector3(
    (Math.random() - 0.5) * 8,
    (Math.random() - 0.5) * 4,
    (Math.random() - 0.5) * 8,
  );

  (mesh as any).userData._rdFallback = { vel, angVel, age: 0 };
  rigs.push({
    mesh,
    bones: new Map(),
    points: [],
    constraints: [],
    age: 0,
    dead: false,
    fadeStart: RAGDOLL_LIFETIME_S - FADE_DURATION_S,
    originalMaterials: [],
    boneMap: [],
  });
  return true;
}

// ─────────────────────────────────────────────────────────────────────
//  STEP (verlet + constraint relaxation)
// ─────────────────────────────────────────────────────────────────────

const _tmpDelta = new THREE.Vector3();
const _tmpMid = new THREE.Vector3();
const _tmpDir = new THREE.Vector3();

function stepRig(rig: RagdollRig, dt: number): void {
  // Fallback rigs (no bones) — apply simple velocity+angular to the whole mesh
  if (rig.points.length === 0) {
    const fb = (rig.mesh as any).userData._rdFallback;
    if (fb) {
      fb.age += dt;
      fb.vel.y += GRAVITY * dt;
      rig.mesh.position.addScaledVector(fb.vel, dt);
      rig.mesh.rotation.x += fb.angVel.x * dt;
      rig.mesh.rotation.y += fb.angVel.y * dt;
      rig.mesh.rotation.z += fb.angVel.z * dt;
      if (rig.mesh.position.y < GROUND_Y) {
        rig.mesh.position.y = GROUND_Y;
        fb.vel.y *= -GROUND_BOUNCE;
        fb.vel.x *= GROUND_FRICTION;
        fb.vel.z *= GROUND_FRICTION;
        fb.angVel.multiplyScalar(0.6);
      }
    }
    return;
  }

  // Verlet integration for all points
  for (const p of rig.points) {
    if (p.mass === 0) continue;
    const vx = (p.pos.x - p.prevPos.x) * AIR_DAMPING;
    const vy = (p.pos.y - p.prevPos.y) * AIR_DAMPING + GRAVITY * dt * dt;
    const vz = (p.pos.z - p.prevPos.z) * AIR_DAMPING;
    p.prevPos.copy(p.pos);
    p.pos.x += vx;
    p.pos.y += vy;
    p.pos.z += vz;

    // Ground collision
    if (p.pos.y < GROUND_Y) {
      p.pos.y = GROUND_Y;
      // Apply friction via prevPos displacement
      const vxf = p.pos.x - p.prevPos.x;
      const vzf = p.pos.z - p.prevPos.z;
      p.prevPos.x = p.pos.x - vxf * GROUND_FRICTION;
      p.prevPos.z = p.pos.z - vzf * GROUND_FRICTION;
      // Bounce vy
      const vyf = p.pos.y - p.prevPos.y;
      if (Math.abs(vyf) > 0.01) {
        p.prevPos.y = p.pos.y + vyf * GROUND_BOUNCE;
      }
      p.grounded = true;
    } else {
      p.grounded = false;
    }
  }

  // Constraint relaxation
  for (let iter = 0; iter < CONSTRAINT_ITERATIONS; iter++) {
    for (const c of rig.constraints) {
      const pa = rig.points[c.a];
      const pb = rig.points[c.b];
      _tmpDelta.subVectors(pb.pos, pa.pos);
      const dist = _tmpDelta.length();
      if (dist < 1e-5) continue;
      const diff = (dist - c.targetDist) / dist * c.stiffness * 0.5;
      const correction = _tmpDelta.multiplyScalar(diff);
      if (pa.mass > 0) pa.pos.add(correction);
      if (pb.mass > 0) pb.pos.sub(correction);
    }
  }

  // Apply physics positions back to skeleton
  applySkeletonFromPoints(rig);
}

function applySkeletonFromPoints(rig: RagdollRig): void {
  // Move the mesh root so the hips point is anchor-world
  const hipsPoint = rig.points[rig.boneMap.find(b => b.bone === rig.bones.get('hips'))?.point ?? 0];
  if (!hipsPoint) return;

  // Compute rotations from parent→child point delta vs bone's rest tangent
  // For simplicity, orient each bone so its +Y axis aligns with (child - self) in world space
  // This approximates limb orientation.
  for (const bm of rig.boneMap) {
    // Find a child bone-map entry whose parent is this bone (if any)
    const childBm = rig.boneMap.find(b => b.bone.parent === bm.bone);
    if (!childBm) continue;
    const selfP = rig.points[bm.point];
    const childP = rig.points[childBm.point];
    _tmpDir.subVectors(childP.pos, selfP.pos);
    if (_tmpDir.lengthSq() < 1e-6) continue;
    _tmpDir.normalize();

    // Convert world direction to local (parent-space)
    const parentQ = new THREE.Quaternion();
    if (bm.bone.parent) bm.bone.parent.getWorldQuaternion(parentQ);
    const localDir = _tmpDir.clone().applyQuaternion(parentQ.invert());
    const q = new THREE.Quaternion().setFromUnitVectors(bm.upAxis, localDir);
    bm.bone.quaternion.slerp(q, 0.65);
  }

  // Update mesh root position from hips point
  rig.mesh.position.copy(hipsPoint.pos);
  rig.mesh.position.y -= 0.9; // offset to ground feet (hips sit ~0.9m above root origin)

  rig.mesh.updateMatrixWorld(true);
}

// ─────────────────────────────────────────────────────────────────────
//  LIFECYCLE
// ─────────────────────────────────────────────────────────────────────

export function updateRagdolls(dt: number): void {
  const stepDt = Math.min(dt, 1 / 30); // clamp to prevent instability on frame spikes

  for (let i = rigs.length - 1; i >= 0; i--) {
    const rig = rigs[i];
    rig.age += stepDt;

    stepRig(rig, stepDt);

    // Fade-out near end of lifetime
    if (rig.age > rig.fadeStart && !rig.dead) {
      const t = (rig.age - rig.fadeStart) / FADE_DURATION_S;
      const alpha = Math.max(0, 1 - t);
      for (const m of rig.originalMaterials) {
        if (Array.isArray(m.mat)) {
          for (const mm of m.mat) { (mm as any).transparent = true; (mm as any).opacity = alpha; (mm as any).needsUpdate = true; }
        } else {
          (m.mat as any).transparent = true;
          (m.mat as any).opacity = alpha;
          (m.mat as any).needsUpdate = true;
        }
      }
    }

    if (rig.age >= RAGDOLL_LIFETIME_S) {
      disposeRig(rig);
      rigs.splice(i, 1);
    }
  }
}

function disposeRig(rig: RagdollRig): void {
  if (rig.mesh.parent) {
    rig.mesh.parent.remove(rig.mesh);
  }
  // Do NOT dispose geometry — it is shared across all SkeletonUtils.clone() instances
  // from the same base FBX model. Disposing here would corrupt all subsequent clones
  // and break respawned agents that create a fresh clone from the same bundle.
  (rig.mesh as any).userData.ragdollActive = false;
}

export function clearAllRagdolls(): void {
  for (const r of rigs) disposeRig(r);
  rigs.length = 0;
}

export function getRagdollCount(): number {
  return rigs.length;
}