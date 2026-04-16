/**
 * Type declarations for Yuka v0.7.8
 * Covers only the APIs used in this project.
 */
declare module 'yuka' {

  // ── Math ──

  export class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    set(x: number, y: number, z: number): this;
    copy(v: Vector3): this;
    clone(): Vector3;
    add(v: Vector3): this;
    sub(v: Vector3): this;
    subVectors(a: Vector3, b: Vector3): this;
    multiplyScalar(s: number): this;
    normalize(): this;
    dot(v: Vector3): number;
    length(): number;
    distanceTo(v: Vector3): number;
    applyRotation(q: Quaternion): this;
  }

  export class Quaternion {
    x: number;
    y: number;
    z: number;
    w: number;
    constructor(x?: number, y?: number, z?: number, w?: number);
    copy(q: Quaternion): this;
  }

  // ── Core ──

  export class GameEntity {
    name: string;
    active: boolean;
    position: Vector3;
    rotation: Quaternion;
    boundingRadius: number;
    renderComponent: any;
    setRenderComponent(obj: any, callback: (entity: GameEntity, renderComponent: any) => void): this;
    constructor();
  }

  export class MovingEntity extends GameEntity {
    velocity: Vector3;
    maxSpeed: number;
    maxForce: number;
    mass: number;
  }

  export class Vehicle extends MovingEntity {
    steering: SteeringManager;
    smoother: Smoother | null;
    updateNeighborhood: boolean;
    neighborhoodRadius: number;
    constructor();
  }

  export class Smoother {
    constructor(count: number);
  }

  // ── Steering ──

  export class SteeringManager {
    add(behavior: SteeringBehavior): this;
    remove(behavior: SteeringBehavior): this;
  }

  export class SteeringBehavior {
    weight: number;
    active: boolean;
  }

  export class WanderBehavior extends SteeringBehavior {
    constructor(jitter?: number, radius?: number, distance?: number);
  }

  export class SeekBehavior extends SteeringBehavior {
    target: Vector3;
    constructor(target?: Vector3);
  }

  export class ArriveBehavior extends SteeringBehavior {
    target: Vector3;
    deceleration: number;
    tolerance: number;
    constructor(target?: Vector3, deceleration?: number, tolerance?: number);
  }

  export class FleeBehavior extends SteeringBehavior {
    target: Vector3;
    panicDistance: number;
    constructor(target?: Vector3, panicDistance?: number);
  }

  export class PursuitBehavior extends SteeringBehavior {
    evader: MovingEntity;
    predictionFactor: number;
    constructor(evader?: MovingEntity, predictionFactor?: number);
  }

  export class ObstacleAvoidanceBehavior extends SteeringBehavior {
    obstacles: GameEntity[];
    constructor(obstacles?: GameEntity[]);
  }

  // ── FSM ──

  export class State<T = any> {
    enter(owner: T): void;
    execute(owner: T): void;
    exit(owner: T): void;
  }

  export class StateMachine<T = any> {
    owner: T;
    constructor(owner: T);
    add(id: string, state: State<T>): this;
    changeTo(id: string): this;
    update(): void;
    currentState: State<T> | null;
  }

  // ── Fuzzy Logic ──

  export class FuzzyModule {
    static DEFUZ_TYPE: {
      MAXAV: string;
      CENTROID: string;
    };
    addFLV(name: string, flv: FuzzyVariable): this;
    addRule(rule: FuzzyRule): this;
    fuzzify(name: string, value: number): void;
    defuzzify(name: string, type: string): number;
  }

  export class FuzzyVariable {
    add(set: FuzzySet): this;
  }

  export class FuzzySet {
    constructor(...args: number[]);
  }

  export class LeftShoulderFuzzySet extends FuzzySet {
    constructor(left: number, midLeft: number, midRight: number, right: number);
  }

  export class RightShoulderFuzzySet extends FuzzySet {
    constructor(left: number, midLeft: number, midRight: number, right: number);
  }

  export class TriangularFuzzySet extends FuzzySet {
    constructor(left: number, mid: number, right: number);
  }

  export class FuzzyRule {
    constructor(antecedent: FuzzyTerm, consequence: FuzzyTerm);
  }

  export type FuzzyTerm = FuzzySet | FuzzyCompositeTerm;

  export class FuzzyCompositeTerm {
    constructor(...terms: FuzzyTerm[]);
  }

  export class FuzzyAND extends FuzzyCompositeTerm {
    constructor(termA: FuzzyTerm, termB: FuzzyTerm);
  }

  export class FuzzyOR extends FuzzyCompositeTerm {
    constructor(termA: FuzzyTerm, termB: FuzzyTerm);
  }

  // ── Goal-Driven Architecture ──

  export class Goal<T = any> {
    owner: T;
    status: string;
    constructor(owner?: T);
    activate(): void;
    execute(): void;
    terminate(): void;
    handleMessage(telegram: any): boolean;
    active(): boolean;
    inactive(): boolean;
    completed(): boolean;
    failed(): boolean;
    replanIfFailed(): void;
    activateIfInactive(): void;
    static STATUS: {
      ACTIVE: string;
      INACTIVE: string;
      COMPLETED: string;
      FAILED: string;
    };
  }

  export class CompositeGoal<T = any> extends Goal<T> {
    subgoals: Goal<T>[];
    addSubgoal(goal: Goal<T>): this;
    removeSubgoal(goal: Goal<T>): this;
    clearSubgoals(): this;
    currentSubgoal(): Goal<T> | undefined;
    executeSubgoals(): string;
    hasSubgoals(): boolean;
  }

  export class Think<T = any> extends CompositeGoal<T> {
    evaluators: GoalEvaluator<T>[];
    constructor(owner?: T);
    addEvaluator(evaluator: GoalEvaluator<T>): this;
    removeEvaluator(evaluator: GoalEvaluator<T>): this;
    arbitrate(): this;
  }

  export class GoalEvaluator<T = any> {
    characterBias: number;
    constructor(characterBias?: number);
    calculateDesirability(owner: T): number;
    setGoal(owner: T): void;
  }

  // ── Entity Manager ──

  export class EntityManager {
    add(entity: GameEntity): this;
    remove(entity: GameEntity): this;
    update(delta: number): void;
  }

  // ── Time ──

  export class Time {
    update(): this;
    getDelta(): number;
  }
}
