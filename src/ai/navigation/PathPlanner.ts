import * as YUKA from 'yuka';
import type { NavMeshManager } from './NavMeshManager';

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
    this.from = from.clone();
    this.to = to.clone();
    this.callback = callback;
  }

  execute(): void {
    const path = this.planner.navManager.findPath(this.from, this.to);
    this.callback(this.vehicle, path);
  }
}

export class AsyncPathPlanner {
  navManager: NavMeshManager;
  taskQueue = new YUKA.TaskQueue();

  constructor(navManager: NavMeshManager) {
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
