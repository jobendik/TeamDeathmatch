import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { TDMAgent } from '@/entities/TDMAgent';

const MODEL_URL = '/models/characters/swat/Swat.fbx';
const ANIM_BASE = '/models/characters/swat/animations';

// Juster denne hvis modellen blir for liten eller stor.
// Mixamo FBX ender ofte på 0.01 i Three.js-prosjekter.
const SWAT_SCALE = 0.01;

const ANIM_FILES = {
  idle: `${ANIM_BASE}/idle.fbx`,
  idleAiming: `${ANIM_BASE}/idle aiming.fbx`,
  idleCrouching: `${ANIM_BASE}/idle crouching.fbx`,
  idleCrouchingAiming: `${ANIM_BASE}/idle crouching aiming.fbx`,

  walkForward: `${ANIM_BASE}/walk forward.fbx`,
  walkBackward: `${ANIM_BASE}/walk backward.fbx`,
  walkLeft: `${ANIM_BASE}/walk left.fbx`,
  walkRight: `${ANIM_BASE}/walk right.fbx`,
  walkForwardLeft: `${ANIM_BASE}/walk forward left.fbx`,
  walkForwardRight: `${ANIM_BASE}/walk forward right.fbx`,
  walkBackwardLeft: `${ANIM_BASE}/walk backward left.fbx`,
  walkBackwardRight: `${ANIM_BASE}/walk backward right.fbx`,

  runForward: `${ANIM_BASE}/run forward.fbx`,
  runBackward: `${ANIM_BASE}/run backward.fbx`,
  runLeft: `${ANIM_BASE}/run left.fbx`,
  runRight: `${ANIM_BASE}/run right.fbx`,
  runForwardLeft: `${ANIM_BASE}/run forward left.fbx`,
  runForwardRight: `${ANIM_BASE}/run forward right.fbx`,
  runBackwardLeft: `${ANIM_BASE}/run backward left.fbx`,
  runBackwardRight: `${ANIM_BASE}/run backward right.fbx`,

  sprintForward: `${ANIM_BASE}/sprint forward.fbx`,
  sprintBackward: `${ANIM_BASE}/sprint backward.fbx`,
  sprintLeft: `${ANIM_BASE}/sprint left.fbx`,
  sprintRight: `${ANIM_BASE}/sprint right.fbx`,
  sprintForwardLeft: `${ANIM_BASE}/sprint forward left.fbx`,
  sprintForwardRight: `${ANIM_BASE}/sprint forward right.fbx`,
  sprintBackwardLeft: `${ANIM_BASE}/sprint backward left.fbx`,
  sprintBackwardRight: `${ANIM_BASE}/sprint backward right.fbx`,

  crouchWalkForward: `${ANIM_BASE}/walk crouching forward.fbx`,
  crouchWalkBackward: `${ANIM_BASE}/walk crouching backward.fbx`,
  crouchWalkLeft: `${ANIM_BASE}/walk crouching left.fbx`,
  crouchWalkRight: `${ANIM_BASE}/walk crouching right.fbx`,
  crouchWalkForwardLeft: `${ANIM_BASE}/walk crouching forward left.fbx`,
  crouchWalkForwardRight: `${ANIM_BASE}/walk crouching forward right.fbx`,
  crouchWalkBackwardLeft: `${ANIM_BASE}/walk crouching backward left.fbx`,
  crouchWalkBackwardRight: `${ANIM_BASE}/walk crouching backward right.fbx`,

  jumpUp: `${ANIM_BASE}/jump up.fbx`,
  jumpLoop: `${ANIM_BASE}/jump loop.fbx`,
  jumpDown: `${ANIM_BASE}/jump down.fbx`,

  turnLeft90: `${ANIM_BASE}/turn 90 left.fbx`,
  turnRight90: `${ANIM_BASE}/turn 90 right.fbx`,
  crouchTurnLeft90: `${ANIM_BASE}/crouching turn 90 left.fbx`,
  crouchTurnRight90: `${ANIM_BASE}/crouching turn 90 right.fbx`,

  deathFront: `${ANIM_BASE}/death from the front.fbx`,
  deathBack: `${ANIM_BASE}/death from the back.fbx`,
  deathRight: `${ANIM_BASE}/death from right.fbx`,
  deathFrontHeadshot: `${ANIM_BASE}/death from front headshot.fbx`,
  deathBackHeadshot: `${ANIM_BASE}/death from back headshot.fbx`,
  deathCrouchHeadshotFront: `${ANIM_BASE}/death crouching headshot front.fbx`,
} as const;

type AgentAnimKey = keyof typeof ANIM_FILES;

type AgentAnimController = {
  mixer: THREE.AnimationMixer;
  model: THREE.Group;
  actions: Partial<Record<AgentAnimKey, THREE.AnimationAction>>;
  current: AgentAnimKey | null;
  elapsed: number;
  lockedUntil: number;
  dead: boolean;
  lastYaw: number;
};

const loader = new FBXLoader();

let baseModel: THREE.Group | null = null;
let loadPromise: Promise<void> | null = null;
let assetsReady = false;
const clips: Partial<Record<AgentAnimKey, THREE.AnimationClip>> = {};

// Alle rene locomotion-klipp som skal kjøres "in place" i kode
const LOCOMOTION_KEYS = new Set<AgentAnimKey>([
  'walkForward',
  'walkBackward',
  'walkLeft',
  'walkRight',
  'walkForwardLeft',
  'walkForwardRight',
  'walkBackwardLeft',
  'walkBackwardRight',

  'runForward',
  'runBackward',
  'runLeft',
  'runRight',
  'runForwardLeft',
  'runForwardRight',
  'runBackwardLeft',
  'runBackwardRight',

  'sprintForward',
  'sprintBackward',
  'sprintLeft',
  'sprintRight',
  'sprintForwardLeft',
  'sprintForwardRight',
  'sprintBackwardLeft',
  'sprintBackwardRight',

  'crouchWalkForward',
  'crouchWalkBackward',
  'crouchWalkLeft',
  'crouchWalkRight',
  'crouchWalkForwardLeft',
  'crouchWalkForwardRight',
  'crouchWalkBackwardLeft',
  'crouchWalkBackwardRight',
]);

function loadFBX(url: string): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (obj) => resolve(obj as THREE.Group),
      undefined,
      (err) => reject(err),
    );
  });
}

function getFirstClip(obj: THREE.Group, url: string): THREE.AnimationClip {
  const clip = obj.animations?.[0];
  if (!clip) {
    throw new Error(`No animation clip found in ${url}`);
  }
  return clip;
}

function prepRenderable(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if ((mesh as any).isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) {
        for (const m of mat) {
          if ('transparent' in m) m.transparent = true;
        }
      } else if (mat && 'transparent' in mat) {
        mat.transparent = true;
      }
    }
  });
}

function isRootMotionPositionTrack(trackName: string): boolean {
  const n = trackName.toLowerCase();

  if (!n.endsWith('.position')) return false;

  return (
    n.includes('mixamorighips.position') ||
    n.includes('hips.position') ||
    n.includes('pelvis.position') ||
    n.includes('root.position') ||
    n.includes('armature.position')
  );
}

function makeClipInPlace(original: THREE.AnimationClip, key: AgentAnimKey): THREE.AnimationClip {
  const clip = original.clone();

  if (!LOCOMOTION_KEYS.has(key)) {
    return clip;
  }

  clip.tracks = clip.tracks.map((track) => {
    if (!(track instanceof THREE.VectorKeyframeTrack)) {
      return track;
    }

    if (!isRootMotionPositionTrack(track.name)) {
      return track;
    }

    const values = track.values.slice();

    const baseX = values[0] ?? 0;
    const baseZ = values[2] ?? 0;

    for (let i = 0; i < values.length; i += 3) {
      values[i] = baseX;       // X nulles til startverdi
      values[i + 2] = baseZ;   // Z nulles til startverdi
      // Y beholdes for naturlig opp/ned-bevegelse
    }

    return new THREE.VectorKeyframeTrack(
      track.name,
      track.times.slice(),
      values,
    );
  });

  return clip;
}

export async function preloadBlueSwatAssets(): Promise<void> {
  if (assetsReady) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const [modelObj, ...animObjs] = await Promise.all([
      loadFBX(MODEL_URL),
      ...Object.values(ANIM_FILES).map((url) => loadFBX(url)),
    ]);

    baseModel = modelObj;
    prepRenderable(baseModel);

    const keys = Object.keys(ANIM_FILES) as AgentAnimKey[];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const rawClip = getFirstClip(animObjs[i], ANIM_FILES[key]);
      clips[key] = makeClipInPlace(rawClip, key);

      // Debug ved behov:
      // if (key === 'runForward') {
      //   console.log('runForward tracks:', rawClip.tracks.map((t) => t.name));
      // }
    }

    assetsReady = true;
    console.info('[AgentAnimations] Swat model + clips loaded.');
  })();

  return loadPromise;
}

export function hasBlueSwatAssets(): boolean {
  return assetsReady && !!baseModel;
}

function setRepeat(action: THREE.AnimationAction): void {
  action.enabled = true;
  action.clampWhenFinished = false;
  action.setLoop(THREE.LoopRepeat, Infinity);
}

function setOnce(action: THREE.AnimationAction): void {
  action.enabled = true;
  action.clampWhenFinished = true;
  action.setLoop(THREE.LoopOnce, 1);
}

function buildController(model: THREE.Group): AgentAnimController {
  const mixer = new THREE.AnimationMixer(model);
  const actions: Partial<Record<AgentAnimKey, THREE.AnimationAction>> = {};

  for (const key of Object.keys(clips) as AgentAnimKey[]) {
    const clip = clips[key];
    if (!clip) continue;

    const action = mixer.clipAction(clip);
    setRepeat(action);
    action.weight = 1;
    actions[key] = action;
  }

  return {
    mixer,
    model,
    actions,
    current: null,
    elapsed: 0,
    lockedUntil: 0,
    dead: false,
    lastYaw: 0,
  };
}

function fallbackCandidates(key: AgentAnimKey): AgentAnimKey[] {
  const map: Partial<Record<AgentAnimKey, AgentAnimKey[]>> = {
    idleAiming: ['idle'],
    idleCrouchingAiming: ['idleCrouching', 'idleAiming', 'idle'],

    walkForwardLeft: ['walkForward', 'walkLeft'],
    walkForwardRight: ['walkForward', 'walkRight'],
    walkBackwardLeft: ['walkBackward', 'walkLeft'],
    walkBackwardRight: ['walkBackward', 'walkRight'],

    runForwardLeft: ['runForward', 'runLeft', 'walkForwardLeft'],
    runForwardRight: ['runForward', 'runRight', 'walkForwardRight'],
    runBackwardLeft: ['runBackward', 'runLeft', 'walkBackwardLeft'],
    runBackwardRight: ['runBackward', 'runRight', 'walkBackwardRight'],

    sprintForwardLeft: ['sprintForward', 'runForwardLeft', 'runForward'],
    sprintForwardRight: ['sprintForward', 'runForwardRight', 'runForward'],
    sprintBackwardLeft: ['sprintBackward', 'runBackwardLeft', 'runBackward'],
    sprintBackwardRight: ['sprintBackward', 'runBackwardRight', 'runBackward'],
    sprintLeft: ['runLeft'],
    sprintRight: ['runRight'],
    sprintForward: ['runForward'],
    sprintBackward: ['runBackward'],

    crouchWalkForwardLeft: ['crouchWalkForward', 'crouchWalkLeft', 'walkForwardLeft'],
    crouchWalkForwardRight: ['crouchWalkForward', 'crouchWalkRight', 'walkForwardRight'],
    crouchWalkBackwardLeft: ['crouchWalkBackward', 'crouchWalkLeft', 'walkBackwardLeft'],
    crouchWalkBackwardRight: ['crouchWalkBackward', 'crouchWalkRight', 'walkBackwardRight'],
    crouchWalkForward: ['walkForward'],
    crouchWalkBackward: ['walkBackward'],
    crouchWalkLeft: ['walkLeft'],
    crouchWalkRight: ['walkRight'],

    jumpLoop: ['jumpUp'],
    jumpDown: ['jumpLoop', 'jumpUp'],

    turnLeft90: ['idle'],
    turnRight90: ['idle'],
    crouchTurnLeft90: ['idleCrouchingAiming', 'idleCrouching'],
    crouchTurnRight90: ['idleCrouchingAiming', 'idleCrouching'],

    deathFrontHeadshot: ['deathFront'],
    deathBackHeadshot: ['deathBack'],
    deathCrouchHeadshotFront: ['deathFront'],
    deathRight: ['deathFront'],
  };

  return [key, ...(map[key] ?? [])];
}

function resolveExistingKey(key: AgentAnimKey): AgentAnimKey | null {
  const candidates = fallbackCandidates(key);
  for (const candidate of candidates) {
    if (clips[candidate]) return candidate;
  }
  return null;
}

function fadeTo(ctrl: AgentAnimController, requested: AgentAnimKey, fade = 0.16): void {
  const key = resolveExistingKey(requested);
  if (!key) return;
  if (ctrl.current === key) return;

  const next = ctrl.actions[key];
  if (!next) return;

  const prev = ctrl.current ? ctrl.actions[ctrl.current] : null;
  if (prev) prev.fadeOut(fade);

  setRepeat(next);
  next.reset().fadeIn(fade).play();
  ctrl.current = key;
}

function playOneShot(ctrl: AgentAnimController, requested: AgentAnimKey, lockSeconds: number): number {
  const key = resolveExistingKey(requested);
  if (!key) return 0;

  const next = ctrl.actions[key];
  if (!next) return 0;

  const prev = ctrl.current ? ctrl.actions[ctrl.current] : null;
  if (prev && prev !== next) prev.fadeOut(0.08);

  setOnce(next);
  next.reset().fadeIn(0.08).play();

  ctrl.current = key;
  ctrl.lockedUntil = ctrl.elapsed + lockSeconds;

  return clips[key]?.duration ?? lockSeconds;
}

function getController(renderComponent: THREE.Object3D | null | undefined): AgentAnimController | null {
  if (!renderComponent) return null;
  return (renderComponent.userData.agentAnimController as AgentAnimController | undefined) ?? null;
}

function normalizeAngle(rad: number): number {
  while (rad > Math.PI) rad -= Math.PI * 2;
  while (rad < -Math.PI) rad += Math.PI * 2;
  return rad;
}

function yawFromQuaternion(q: THREE.Quaternion): number {
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  return e.y;
}

function pickDirectionalSet(
  forward: number,
  right: number,
  prefix: 'walk' | 'run' | 'sprint' | 'crouchWalk',
): AgentAnimKey {
  const f = Math.abs(forward) < 0.2 ? 0 : (forward > 0 ? 1 : -1);
  const r = Math.abs(right) < 0.2 ? 0 : (right > 0 ? 1 : -1);

  if (prefix === 'crouchWalk') {
    if (f === 1 && r === -1) return 'crouchWalkForwardLeft';
    if (f === 1 && r === 1) return 'crouchWalkForwardRight';
    if (f === -1 && r === -1) return 'crouchWalkBackwardLeft';
    if (f === -1 && r === 1) return 'crouchWalkBackwardRight';
    if (f === 1) return 'crouchWalkForward';
    if (f === -1) return 'crouchWalkBackward';
    if (r === -1) return 'crouchWalkLeft';
    return 'crouchWalkRight';
  }

  if (prefix === 'walk') {
    if (f === 1 && r === -1) return 'walkForwardLeft';
    if (f === 1 && r === 1) return 'walkForwardRight';
    if (f === -1 && r === -1) return 'walkBackwardLeft';
    if (f === -1 && r === 1) return 'walkBackwardRight';
    if (f === 1) return 'walkForward';
    if (f === -1) return 'walkBackward';
    if (r === -1) return 'walkLeft';
    return 'walkRight';
  }

  if (prefix === 'run') {
    if (f === 1 && r === -1) return 'runForwardLeft';
    if (f === 1 && r === 1) return 'runForwardRight';
    if (f === -1 && r === -1) return 'runBackwardLeft';
    if (f === -1 && r === 1) return 'runBackwardRight';
    if (f === 1) return 'runForward';
    if (f === -1) return 'runBackward';
    if (r === -1) return 'runLeft';
    return 'runRight';
  }

  if (f === 1 && r === -1) return 'sprintForwardLeft';
  if (f === 1 && r === 1) return 'sprintForwardRight';
  if (f === -1 && r === -1) return 'sprintBackwardLeft';
  if (f === -1 && r === 1) return 'sprintBackwardRight';
  if (f === 1) return 'sprintForward';
  if (f === -1) return 'sprintBackward';
  if (r === -1) return 'sprintLeft';
  return 'sprintRight';
}

function chooseMovementAnimation(
  ag: TDMAgent,
  speed: number,
  localForward: number,
  localRight: number,
): AgentAnimKey {
  const stationary = speed < 0.12;
  const crouched = ag.stateName === 'COVER' || ag.stateName === 'PEEK';
  const combat = ag.stateName === 'ENGAGE' || ag.stateName === 'TEAM_PUSH' || ag.stateName === 'FLANK';
  const sprinting = ag.stateName === 'RETREAT' || ag.stateName === 'TEAM_PUSH' || speed > ag.maxSpeed * 0.8;
  const patrolling = ag.stateName === 'PATROL' || ag.stateName === 'INVESTIGATE';

  if (Math.abs(ag.velocity.y) > 0.75) {
    return ag.velocity.y > 0 ? 'jumpUp' : 'jumpDown';
  }

  if (crouched) {
    if (stationary) {
      return ag.currentTarget ? 'idleCrouchingAiming' : 'idleCrouching';
    }
    return pickDirectionalSet(localForward, localRight, 'crouchWalk');
  }

  if (stationary) {
    return ag.currentTarget ? 'idleAiming' : 'idle';
  }

  if (sprinting) {
    return pickDirectionalSet(localForward, localRight, 'sprint');
  }

  if (combat) {
    return pickDirectionalSet(localForward, localRight, 'run');
  }

  if (patrolling && speed < ag.maxSpeed * 0.45) {
    return pickDirectionalSet(localForward, localRight, 'walk');
  }

  return pickDirectionalSet(localForward, localRight, 'run');
}

export function attachBlueSwatCharacter(renderComponent: THREE.Group): void {
  if (!baseModel || !assetsReady) {
    throw new Error('Swat assets not preloaded.');
  }

  const model = skeletonClone(baseModel) as THREE.Group;
  model.name = 'BlueSwatCharacter';
  model.scale.setScalar(SWAT_SCALE);
  model.position.set(0, 0, 0);

  prepRenderable(model);

  renderComponent.add(model);

  const ctrl = buildController(model);
  ctrl.lastYaw = yawFromQuaternion(renderComponent.quaternion);

  renderComponent.userData.characterModel = model;
  renderComponent.userData.agentAnimController = ctrl;

  fadeTo(ctrl, 'idle', 0.01);
}

export function updateAgentAnimations(agents: readonly TDMAgent[], dt: number): void {
  for (const ag of agents) {
    const ctrl = getController(ag.renderComponent);
    if (!ctrl) continue;

    ctrl.elapsed += dt;
    ctrl.mixer.update(dt);

    // Ekstra sikkerhet mot root motion på modellnivå
    ctrl.model.position.x = 0;
    ctrl.model.position.z = 0;

    if (ctrl.dead) continue;
    if (ctrl.elapsed < ctrl.lockedUntil) continue;

    const rc = ag.renderComponent!;
    const yaw = yawFromQuaternion(rc.quaternion);
    const yawDelta = normalizeAngle(yaw - ctrl.lastYaw);
    ctrl.lastYaw = yaw;

    const horizVel = new THREE.Vector3(ag.velocity.x, 0, ag.velocity.z);
    const speed = horizVel.length();

    const stationary = speed < 0.08;
    const turningHard = stationary && Math.abs(yawDelta) > THREE.MathUtils.degToRad(0.9);

    if (turningHard) {
      const crouched = ag.stateName === 'COVER' || ag.stateName === 'PEEK';
      const turnKey = yawDelta > 0
        ? (crouched ? 'crouchTurnLeft90' : 'turnLeft90')
        : (crouched ? 'crouchTurnRight90' : 'turnRight90');

      const resolvedTurn = resolveExistingKey(turnKey);
      if (resolvedTurn && resolvedTurn !== 'idle' && resolvedTurn !== 'idleCrouching') {
        playOneShot(ctrl, turnKey, 0.22);
        return;
      }
    }

    const q = rc.quaternion;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q).normalize();

    const localForward = horizVel.dot(forward);
    const localRight = horizVel.dot(right);

    const next = chooseMovementAnimation(ag, speed, localForward, localRight);
    fadeTo(ctrl, next, speed < 0.2 ? 0.18 : 0.12);
  }
}

export function playAgentDeathAnimation(renderComponent: THREE.Object3D | null | undefined): number {
  const ctrl = getController(renderComponent);
  if (!ctrl) return 0;

  ctrl.dead = true;

  const deathPool: AgentAnimKey[] = [
    'deathFront',
    'deathBack',
    'deathRight',
    'deathFrontHeadshot',
    'deathBackHeadshot',
    'deathCrouchHeadshotFront',
  ];

  const pick = deathPool[Math.floor(Math.random() * deathPool.length)];
  const duration = playOneShot(ctrl, pick, 1.25);

  return duration || 1.25;
}

export function resetAgentAnimation(renderComponent: THREE.Object3D | null | undefined): void {
  const ctrl = getController(renderComponent);
  if (!ctrl) return;

  ctrl.dead = false;
  ctrl.lockedUntil = 0;
  ctrl.elapsed = 0;
  fadeTo(ctrl, 'idle', 0.01);
}
