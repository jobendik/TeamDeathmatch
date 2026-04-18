# Navmesh Integration Code

This file contains a clean reference implementation that another GPT can adapt into an existing FPS codebase.

It is intentionally modular.

---

## 1. `NavConfig.ts`

```ts
export const NAV_CONFIG = {
  NEXT_WAYPOINT_DISTANCE: 0.5,
  ARRIVE_DECELERATION: 2,
  ARRIVE_TOLERANCE: 1.0,
  PATH_RADIUS: 0.1,
  ON_PATH_WEIGHT: 1.0,
  HEIGHT_CHANGE_FACTOR: 0.2,
  REGION_EPSILON: 1.0
} as const;
```

---

## 2. `NavMeshManager.ts`

```ts
import * as YUKA from 'yuka';

export class NavMeshManager {
  navMesh: YUKA.NavMesh | null = null;

  async load(url: string): Promise<YUKA.NavMesh> {
    this.navMesh = await new YUKA.NavMeshLoader().load(url, {
      epsilonCoplanarTest: 0.25,
      mergeConvexRegions: false
    });

    return this.navMesh;
  }

  requireNavMesh(): YUKA.NavMesh {
    if (!this.navMesh) {
      throw new Error('NavMeshManager: navMesh not loaded');
    }
    return this.navMesh;
  }

  getRegionForPoint(point: YUKA.Vector3, epsilon = 1): any {
    return this.requireNavMesh().getRegionForPoint(point, epsilon);
  }

  findPath(from: YUKA.Vector3, to: YUKA.Vector3): YUKA.Vector3[] {
    return this.requireNavMesh().findPath(from, to);
  }

  clampMovement(
    currentRegion: any,
    previousPosition: YUKA.Vector3,
    currentPosition: YUKA.Vector3,
    resultPosition: YUKA.Vector3
  ): any {
    return this.requireNavMesh().clampMovement(
      currentRegion,
      previousPosition,
      currentPosition,
      resultPosition
    );
  }
}
```

---

## 3. `NavAgentRuntime.ts`

```ts
import * as YUKA from 'yuka';
import { NAV_CONFIG } from './NavConfig';

export class NavAgentRuntime {
  owner: YUKA.Vehicle;
  navManager: any;

  currentRegion: any = null;
  currentPosition = new YUKA.Vector3();
  previousPosition = new YUKA.Vector3();
  path: YUKA.Vector3[] | null = null;

  followPathBehavior: YUKA.FollowPathBehavior;
  onPathBehavior: YUKA.OnPathBehavior;
  seekBehavior: YUKA.SeekBehavior;

  constructor(owner: YUKA.Vehicle, navManager: any) {
    this.owner = owner;
    this.navManager = navManager;

    this.followPathBehavior = new YUKA.FollowPathBehavior();
    this.followPathBehavior.active = false;
    this.followPathBehavior.nextWaypointDistance = NAV_CONFIG.NEXT_WAYPOINT_DISTANCE;

    // Showcase-style internal arrive tuning:
    this.followPathBehavior._arrive.deceleration = NAV_CONFIG.ARRIVE_DECELERATION;

    this.onPathBehavior = new YUKA.OnPathBehavior();
    this.onPathBehavior.active = false;
    this.onPathBehavior.path = this.followPathBehavior.path;
    this.onPathBehavior.radius = NAV_CONFIG.PATH_RADIUS;
    this.onPathBehavior.weight = NAV_CONFIG.ON_PATH_WEIGHT;

    this.seekBehavior = new YUKA.SeekBehavior();
    this.seekBehavior.active = false;

    this.owner.steering.add(this.followPathBehavior);
    this.owner.steering.add(this.onPathBehavior);
    this.owner.steering.add(this.seekBehavior);
  }

  initFromSpawn(spawnPosition: YUKA.Vector3): void {
    this.owner.position.copy(spawnPosition);
    this.previousPosition.copy(this.owner.position);
    this.currentPosition.copy(this.owner.position);

    this.currentRegion = this.navManager.getRegionForPoint(
      this.owner.position,
      NAV_CONFIG.REGION_EPSILON
    );

    if (!this.currentRegion) {
      throw new Error('NavAgentRuntime: spawn position is not on the navmesh');
    }
  }

  applyPath(path: YUKA.Vector3[]): boolean {
    if (!path || path.length === 0) return false;

    this.path = path;

    this.followPathBehavior.path.clear();

    for (const waypoint of path) {
      this.followPathBehavior.path.add(waypoint);
    }

    this.followPathBehavior.active = true;
    this.onPathBehavior.active = true;

    return true;
  }

  clearPath(): void {
    this.path = null;
    this.followPathBehavior.active = false;
    this.onPathBehavior.active = false;
    this.followPathBehavior.path.clear();
  }

  atPosition(target: YUKA.Vector3): boolean {
    const toleranceSq =
      NAV_CONFIG.ARRIVE_TOLERANCE * NAV_CONFIG.ARRIVE_TOLERANCE;

    return this.owner.position.squaredDistanceTo(target) <= toleranceSq;
  }

  stayOnNavMesh(): void {
    this.currentPosition.copy(this.owner.position);

    this.currentRegion = this.navManager.clampMovement(
      this.currentRegion,
      this.previousPosition,
      this.currentPosition,
      this.owner.position
    );

    if (!this.currentRegion) {
      return;
    }

    this.previousPosition.copy(this.owner.position);

    const distance = this.currentRegion.plane.distanceToPoint(this.owner.position);
    this.owner.position.y -= distance * NAV_CONFIG.HEIGHT_CHANGE_FACTOR;
  }

  update(): void {
    this.stayOnNavMesh();

    if (this.path && this.path.length > 0) {
      const last = this.path[this.path.length - 1];
      if (this.atPosition(last)) {
        this.clearPath();
      }
    }
  }
}
```

---

## 4. `PathPlanner.ts`

### Simple synchronous version

```ts
import * as YUKA from 'yuka';

export class PathPlanner {
  navManager: any;

  constructor(navManager: any) {
    this.navManager = navManager;
  }

  findPath(from: YUKA.Vector3, to: YUKA.Vector3): YUKA.Vector3[] {
    return this.navManager.findPath(from, to);
  }
}
```

### Async task-queue version

```ts
import * as YUKA from 'yuka';

export class PathPlannerTask extends YUKA.Task {
  planner: AsyncPathPlanner;
  vehicle: any;
  from: YUKA.Vector3;
  to: YUKA.Vector3;
  callback: (vehicle: any, path: YUKA.Vector3[]) => void;

  constructor(
    planner: AsyncPathPlanner,
    vehicle: any,
    from: YUKA.Vector3,
    to: YUKA.Vector3,
    callback: (vehicle: any, path: YUKA.Vector3[]) => void
  ) {
    super();
    this.planner = planner;
    this.vehicle = vehicle;
    this.from = from;
    this.to = to;
    this.callback = callback;
  }

  execute(): void {
    const path = this.planner.navManager.findPath(this.from, this.to);
    this.callback(this.vehicle, path);
  }
}

export class AsyncPathPlanner {
  navManager: any;
  taskQueue = new YUKA.TaskQueue();

  constructor(navManager: any) {
    this.navManager = navManager;
  }

  findPath(
    vehicle: any,
    from: YUKA.Vector3,
    to: YUKA.Vector3,
    callback: (vehicle: any, path: YUKA.Vector3[]) => void
  ): void {
    this.taskQueue.enqueue(
      new PathPlannerTask(this, vehicle, from, to, callback)
    );
  }

  update(): void {
    this.taskQueue.update();
  }
}
```

---

## 5. `BotNavCommands.ts`

```ts
import * as YUKA from 'yuka';

export function requestBotPath(bot: any, planner: any, destination: YUKA.Vector3): void {
  const from = new YUKA.Vector3().copy(bot.position);
  const to = new YUKA.Vector3().copy(destination);

  const path = planner.findPath(from, to);

  if (!path || path.length === 0) {
    bot.navRuntime.clearPath();
    console.warn('BotNavCommands: no path found');
    return;
  }

  bot.navRuntime.applyPath(path);
}
```

---

## 6. `FindPathGoal.ts`

```ts
import { Goal } from 'yuka';

export class FindPathGoal extends Goal {
  from: any;
  to: any;

  constructor(owner: any, from: any, to: any) {
    super(owner);
    this.from = from;
    this.to = to;
  }

  activate(): void {
    const owner = this.owner;
    owner.path = null;

    owner.world.pathPlanner.findPath(owner, this.from, this.to, (vehicle: any, path: any[]) => {
      vehicle.path = path;
    });
  }

  execute(): void {
    if (this.owner.path) {
      this.status = Goal.STATUS.COMPLETED;
    }
  }
}
```

---

## 7. `FollowPathGoal.ts`

```ts
import { Goal } from 'yuka';

export class FollowPathGoal extends Goal {
  to: any = null;

  constructor(owner: any) {
    super(owner);
  }

  activate(): void {
    const owner = this.owner;
    const path = owner.path;

    if (!path || path.length === 0) {
      this.status = Goal.STATUS.FAILED;
      return;
    }

    owner.navRuntime.applyPath(path);
    this.to = path[path.length - 1];
  }

  execute(): void {
    if (this.active()) {
      if (this.owner.navRuntime.atPosition(this.to)) {
        this.status = Goal.STATUS.COMPLETED;
      }
    }
  }

  terminate(): void {
    this.owner.navRuntime.clearPath();
  }
}
```

---

## 8. `ClickToMoveDebugController.ts`

```ts
import * as THREE from 'three';
import * as YUKA from 'yuka';

export class ClickToMoveDebugController {
  camera: THREE.Camera;
  scene: THREE.Scene;
  domElement: HTMLElement;
  navManager: any;
  planner: any;
  agent: any;

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  constructor(params: {
    camera: THREE.Camera;
    scene: THREE.Scene;
    domElement: HTMLElement;
    navManager: any;
    planner: any;
    agent: any;
  }) {
    this.camera = params.camera;
    this.scene = params.scene;
    this.domElement = params.domElement;
    this.navManager = params.navManager;
    this.planner = params.planner;
    this.agent = params.agent;

    this.domElement.addEventListener('pointerdown', this.onPointerDown);
  }

  onPointerDown = (event: PointerEvent) => {
    const rect = this.domElement.getBoundingClientRect();

    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    if (hits.length === 0) return;

    const hitPoint = hits[0].point;
    const target = new YUKA.Vector3(hitPoint.x, hitPoint.y, hitPoint.z);

    const startRegion = this.navManager.getRegionForPoint(this.agent.position, 1);
    const targetRegion = this.navManager.getRegionForPoint(target, 1);

    if (!startRegion || !targetRegion) {
      console.warn('ClickToMove: start or target is not on navmesh');
      return;
    }

    const path = this.planner.findPath(
      new YUKA.Vector3().copy(this.agent.position),
      target
    );

    if (!path || path.length === 0) {
      console.warn('ClickToMove: no path found');
      return;
    }

    this.agent.navRuntime.applyPath(path);
  };
}
```

---

## 9. Example Bot Integration

```ts
import * as YUKA from 'yuka';
import { NavAgentRuntime } from './NavAgentRuntime';

export class EnemyBot extends YUKA.Vehicle {
  world: any;
  navRuntime: NavAgentRuntime;
  path: YUKA.Vector3[] | null = null;

  currentRegion: any = null;
  currentPosition = new YUKA.Vector3();
  previousPosition = new YUKA.Vector3();

  constructor(world: any, navManager: any) {
    super();

    this.world = world;
    this.maxSpeed = 3;
    this.updateOrientation = false;

    this.navRuntime = new NavAgentRuntime(this, navManager);
  }

  spawnAt(position: YUKA.Vector3): void {
    this.navRuntime.initFromSpawn(position);
    this.currentRegion = this.navRuntime.currentRegion;
    this.currentPosition.copy(this.navRuntime.currentPosition);
    this.previousPosition.copy(this.navRuntime.previousPosition);
  }

  update(delta: number): this {
    super.update(delta);

    this.navRuntime.update();

    this.currentRegion = this.navRuntime.currentRegion;
    this.currentPosition.copy(this.navRuntime.currentPosition);
    this.previousPosition.copy(this.navRuntime.previousPosition);

    return this;
  }
}
```

---

## 10. Example Player Integration

```ts
import * as YUKA from 'yuka';
import { NAV_CONFIG } from './NavConfig';

export class NavPlayer extends YUKA.MovingEntity {
  world: any;
  currentRegion: any = null;
  currentPosition = new YUKA.Vector3();
  previousPosition = new YUKA.Vector3();

  constructor(world: any) {
    super();
    this.world = world;
    this.maxSpeed = 6;
    this.updateOrientation = false;
  }

  initFromSpawn(): void {
    this.previousPosition.copy(this.position);
    this.currentPosition.copy(this.position);
    this.currentRegion = this.world.navMeshManager.getRegionForPoint(
      this.position,
      NAV_CONFIG.REGION_EPSILON
    );
  }

  stayOnNavMesh(): void {
    this.currentPosition.copy(this.position);

    this.currentRegion = this.world.navMeshManager.clampMovement(
      this.currentRegion,
      this.previousPosition,
      this.currentPosition,
      this.position
    );

    if (!this.currentRegion) return;

    this.previousPosition.copy(this.position);

    const distance = this.currentRegion.plane.distanceToPoint(this.position);
    this.position.y -= distance * NAV_CONFIG.HEIGHT_CHANGE_FACTOR;
  }

  update(delta: number): this {
    super.update(delta);

    this.stayOnNavMesh();

    return this;
  }
}
```

---

## 11. World Bootstrap Example

```ts
import { NavMeshManager } from './NavMeshManager';
import { AsyncPathPlanner } from './PathPlanner';

export class GameWorld {
  navMeshManager = new NavMeshManager();
  pathPlanner: AsyncPathPlanner | null = null;

  async init(): Promise<void> {
    await this.navMeshManager.load('/assets/navmesh.glb');
    this.pathPlanner = new AsyncPathPlanner(this.navMeshManager);

    // create bots, player, items, etc.
  }

  update(delta: number): void {
    // input updates first
    // entityManager.update(delta)
    // then async planner queue
    this.pathPlanner?.update();
  }
}
```

---

## 12. Optional Path Debug Helper

```ts
import * as THREE from 'three';
import * as YUKA from 'yuka';

export class PathDebugLine {
  line: THREE.Line;

  constructor() {
    this.line = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xff0000 })
    );
    this.line.visible = false;
  }

  setPath(path: YUKA.Vector3[]): void {
    const points = path.map(p => new THREE.Vector3(p.x, p.y, p.z));
    this.line.geometry.dispose();
    this.line.geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.line.visible = true;
  }

  clear(): void {
    this.line.visible = false;
  }
}
```

---

## 13. Practical Notes

### Required runtime order
For each moving entity:
1. movement / steering updates velocity and position
2. `clampMovement()`
3. save returned `currentRegion`
4. save `previousPosition`
5. height correction from region plane

### If a path exists but motion is ugly
Tune:
- `NEXT_WAYPOINT_DISTANCE`
- `ARRIVE_DECELERATION`
- `ARRIVE_TOLERANCE`
- `PATH_RADIUS`
- `ON_PATH_WEIGHT`

### If no path is found
Check:
- target point is actually on navmesh
- spawn point is actually on navmesh
- navmesh has no disconnected island issue
- navmesh export is clean
- `mergeConvexRegions` is still false while testing

### If entity moves but drifts through walls
You are almost certainly missing correct per-frame `clampMovement()` usage.

---

## 14. Final Instruction to the Implementing GPT

Use the code in this file as the reference architecture.

Do not dump it in unchanged if the project already has:
- a world manager
- an entity manager
- AI goal classes
- bot classes
- player classes

Instead:
- adapt the structure carefully
- preserve the existing project shape
- inject the minimal navmesh runtime layer needed
- show exact file edits
