import * as THREE from 'three';
import * as YUKA from 'yuka';
import { gameState } from '@/core/GameState';
import type { TDMAgent } from '@/entities/TDMAgent';

/**
 * Per-agent simulated crosshair state.
 * Each bot has their aim follow a target position via spring dynamics —
 * exactly like a real human flicking, settling, tracking, and flinching.
 */
export interface AimState {
  // Current crosshair direction in world space (yaw/pitch in radians)
  yaw: number;
  pitch: number;
  // Angular velocity
  velYaw: number;
  velPitch: number;
  // Residual flinch (decays)
  flinchYaw: number;
  flinchPitch: number;
  // Overshoot phase timer (after a big flick)
  overshootPhase: number;
  // Time since target last swapped
  onTargetTime: number;
  // Last target position (for lead calc)
  lastTargetPos: YUKA.Vector3;
  // Systemic drift — low-frequency noise making hand path non-straight
  driftPhaseYaw: number;
  driftPhasePitch: number;
}

export function createAimState(): AimState {
  return {
    yaw: 0,
    pitch: 0,
    velYaw: 0,
    velPitch: 0,
    flinchYaw: 0,
    flinchPitch: 0,
    overshootPhase: 0,
    onTargetTime: 0,
    lastTargetPos: new YUKA.Vector3(),
    driftPhaseYaw: Math.random() * Math.PI * 2,
    driftPhasePitch: Math.random() * Math.PI * 2,
  };
}

// ── Cached temporaries ──
const _targetPos = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _vel = new THREE.Vector3();

/** Normalize angle to [-PI, PI] */
function normAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Compute effective lead time depending on weapon (rocket is slow, hitscan is 0).
 */
function getLeadTime(ag: TDMAgent, dist: number): number {
  if (ag.weaponId === 'rocket_launcher') return Math.min(0.9, dist / 25);
  // Hitscan still gets a small "reaction lead" — humans lead slightly even hitscan
  return Math.min(0.12, dist * 0.004);
}

/**
 * Update the bot's simulated crosshair each frame.
 * Called for bots that have a current target OR a last-known position.
 */
export function updateAim(ag: TDMAgent, dt: number): void {
  if (!ag.aim) return;
  const aim = ag.aim;
  const p = ag.personality;
  if (!p) return;

  // ── Determine desired target direction ──
  const tgtAgent = ag.currentTarget;
  let desiredYaw: number;
  let desiredPitch: number;

  _origin.set(ag.position.x, 0.95, ag.position.z);

  if (tgtAgent && !tgtAgent.isDead) {
    const dist = ag.position.distanceTo(tgtAgent.position);
    const leadTime = getLeadTime(ag, dist);

    // Predict target position with lead + systematic bias
    _vel.set(tgtAgent.velocity.x, 0, tgtAgent.velocity.z);
    const biasedLead = leadTime * (1 + p.leadErrorBias * 0.3);
    _targetPos.set(
      tgtAgent.position.x + _vel.x * biasedLead,
      1.0,
      tgtAgent.position.z + _vel.z * biasedLead,
    );

    // Aim height preference — weaker bots aim center-mass, better aim head
    const aimHigh = p.skill * 0.35; // 0 = chest, 0.35 = upper chest/head
    _targetPos.y = 1.0 + aimHigh * (Math.random() * 0.4);

    aim.lastTargetPos.copy(tgtAgent.position);
    aim.onTargetTime += dt;
  } else if (ag.hasLastKnown) {
    // Pre-aiming last known position
    _targetPos.set(ag.lastKnownPos.x, 1.1, ag.lastKnownPos.z);
    aim.onTargetTime = 0;
  } else {
    // No target, no LKP — aim at where they're moving (forward)
    const heading = new YUKA.Vector3(0, 0, 1).applyRotation(ag.rotation);
    _targetPos.set(
      ag.position.x + heading.x * 10,
      1.1,
      ag.position.z + heading.z * 10,
    );
    aim.onTargetTime = 0;
  }

  _toTarget.subVectors(_targetPos, _origin);
  desiredYaw = Math.atan2(-_toTarget.x, -_toTarget.z);
  const horizDist = Math.sqrt(_toTarget.x * _toTarget.x + _toTarget.z * _toTarget.z);
  desiredPitch = Math.atan2(_toTarget.y, Math.max(0.01, horizDist));

  // ── Spring dynamics (critically damped-ish) ──
  const deltaYaw = normAngle(desiredYaw - aim.yaw);
  const deltaPitch = desiredPitch - aim.pitch;

  // Detect a flick: large angular delta → overshoot behavior
  const flickSize = Math.sqrt(deltaYaw * deltaYaw + deltaPitch * deltaPitch);
  if (flickSize > 0.6 && aim.overshootPhase <= 0) {
    // Begin an overshoot — inject overshoot velocity
    aim.overshootPhase = 0.25 * (1 + p.overshootTendency);
    const overshoot = p.overshootTendency * 1.2;
    aim.velYaw += deltaYaw * overshoot * 0.4;
    aim.velPitch += deltaPitch * overshoot * 0.4;
  }
  if (aim.overshootPhase > 0) aim.overshootPhase = Math.max(0, aim.overshootPhase - dt);

  // Stiffness / damping scale with tracking responsiveness + skill
  const stiffness = 18 + p.trackingResponsiveness * 30; // 18..48
  const damping = 6 + p.settleSpeed * 10;                // 6..16

  // Accelerate toward target
  aim.velYaw += deltaYaw * stiffness * dt;
  aim.velPitch += deltaPitch * stiffness * dt;
  aim.velYaw *= Math.max(0, 1 - damping * dt);
  aim.velPitch *= Math.max(0, 1 - damping * dt);

  aim.yaw += aim.velYaw * dt;
  aim.pitch += aim.velPitch * dt;
  aim.yaw = normAngle(aim.yaw);

  // ── Micro-jitter (hand tremor) ──
  const jitterScale = p.microJitter * (1 + ag.pressureLevel * 1.5);
  aim.yaw += (Math.random() - 0.5) * jitterScale;
  aim.pitch += (Math.random() - 0.5) * jitterScale * 0.6;

  // ── Slow drift (lazy hand path, more noticeable when idle) ──
  aim.driftPhaseYaw += dt * 0.7;
  aim.driftPhasePitch += dt * 0.55;
  const driftAmp = 0.004 * (1.4 - p.skill);
  aim.yaw += Math.sin(aim.driftPhaseYaw) * driftAmp * dt;
  aim.pitch += Math.cos(aim.driftPhasePitch) * driftAmp * 0.6 * dt;

  // ── Flinch decay ──
  const flinchDecay = Math.max(0, 1 - dt * 6);
  aim.flinchYaw *= flinchDecay;
  aim.flinchPitch *= flinchDecay;
  aim.yaw += aim.flinchYaw * dt;
  aim.pitch += aim.flinchPitch * dt;

  // Clamp pitch so bots don't aim at their feet or the sky
  aim.pitch = Math.max(-0.9, Math.min(0.9, aim.pitch));

  // Sync the agent's facing rotation SMOOTHLY toward aim yaw so visuals follow
  // (YUKA rotation is a quaternion; we set it via a Y-axis quaternion)
  const faceQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), aim.yaw);
  ag.rotation.x = faceQ.x;
  ag.rotation.y = faceQ.y;
  ag.rotation.z = faceQ.z;
  ag.rotation.w = faceQ.w;
}

/**
 * Apply a flinch impulse — called when the bot takes damage.
 * Flinches scale with personality.flinchFactor and damage size.
 */
export function applyAimFlinch(ag: TDMAgent, damageFraction: number): void {
  if (!ag.aim || !ag.personality) return;
  const strength = ag.personality.flinchFactor * damageFraction * 0.35;
  ag.aim.flinchYaw += (Math.random() - 0.5) * strength * 12;
  ag.aim.flinchPitch += (Math.random() - 0.2) * strength * 6; // bias upward
}

/**
 * Returns the actual firing direction based on current simulated crosshair,
 * plus pressure-induced panic spread.
 * Also returns whether the bot is currently "settled enough" to pull the trigger
 * (models trigger discipline — good players wait for the reticle to settle).
 */
export function getAimDirection(ag: TDMAgent): {
  dir: THREE.Vector3;
  origin: THREE.Vector3;
  settled: boolean;
} {
  const aim = ag.aim!;
  const p = ag.personality!;

  const origin = new THREE.Vector3(ag.position.x, 0.95, ag.position.z);

  // Panic spread proportional to pressure × panic factor
  const panicSpread = p.panicSprayFactor * ag.pressureLevel * 0.09;
  const yaw = aim.yaw + (Math.random() - 0.5) * panicSpread;
  const pitch = aim.pitch + (Math.random() - 0.5) * panicSpread * 0.5;

  const dir = new THREE.Vector3(
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  ).normalize();

  // Settled means: low angular velocity + on-target for at least a moment
  const angularSpeed = Math.abs(aim.velYaw) + Math.abs(aim.velPitch);
  // Trigger discipline: high-discipline bots wait for settle; low-discipline just pull
  const settleThreshold = 0.4 + (1 - p.triggerDiscipline) * 1.6;
  const settled = aim.overshootPhase <= 0 && angularSpeed < settleThreshold;

  return { dir, origin, settled };
}

/**
 * Is the simulated crosshair actually pointing close enough to the target
 * that firing makes sense? Used to stop bots from wasting ammo into walls.
 */
export function isAimOnTarget(ag: TDMAgent, target: TDMAgent, tolerance = 0.15): boolean {
  if (!ag.aim) return false;
  const aim = ag.aim;

  const tx = target.position.x - ag.position.x;
  const tz = target.position.z - ag.position.z;
  const desiredYaw = Math.atan2(-tx, -tz);
  const delta = Math.abs(normAngle(desiredYaw - aim.yaw));

  // Allow wider tolerance for close targets (humans fire at the general silhouette)
  const dist = Math.sqrt(tx * tx + tz * tz);
  const distAdjust = Math.max(0, (dist - 15) / 40) * 0.1;
  return delta < (tolerance + distAdjust);
}
