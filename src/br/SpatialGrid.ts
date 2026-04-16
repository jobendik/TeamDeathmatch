/**
 * SpatialGrid — O(1) proximity queries for entities, loot, vehicles.
 * Replaces O(n) loops in perception, loot pickup, vehicle entry, etc.
 *
 * Cell size of 20 units means a 400×400 map = 20×20 grid = 400 cells.
 * Each query checks at most 9 cells (3×3 neighborhood).
 */

const CELL_SIZE = 20;
const GRID_OFFSET = 220; // half-map + margin → all coords become positive

type Entry<T> = { obj: T; x: number; z: number };

export class SpatialGrid<T> {
  private cells = new Map<number, Entry<T>[]>();
  private objToKey = new Map<T, number>();

  private key(x: number, z: number): number {
    const gx = Math.floor((x + GRID_OFFSET) / CELL_SIZE);
    const gz = Math.floor((z + GRID_OFFSET) / CELL_SIZE);
    return gx * 10000 + gz;
  }

  clear(): void {
    this.cells.clear();
    this.objToKey.clear();
  }

  insert(obj: T, x: number, z: number): void {
    const k = this.key(x, z);
    let arr = this.cells.get(k);
    if (!arr) { arr = []; this.cells.set(k, arr); }
    arr.push({ obj, x, z });
    this.objToKey.set(obj, k);
  }

  remove(obj: T): void {
    const k = this.objToKey.get(obj);
    if (k === undefined) return;
    const arr = this.cells.get(k);
    if (arr) {
      const idx = arr.findIndex(e => e.obj === obj);
      if (idx !== -1) arr.splice(idx, 1);
    }
    this.objToKey.delete(obj);
  }

  /** Update position — remove and re-insert. */
  update(obj: T, x: number, z: number): void {
    const newK = this.key(x, z);
    const oldK = this.objToKey.get(obj);
    if (oldK === newK) return; // same cell, skip
    this.remove(obj);
    this.insert(obj, x, z);
  }

  /** Query all entries within `radius` of (x, z). Returns array of { obj, distSq }. */
  queryRadius(x: number, z: number, radius: number): { obj: T; distSq: number }[] {
    const results: { obj: T; distSq: number }[] = [];
    const r2 = radius * radius;
    const minGx = Math.floor((x - radius + GRID_OFFSET) / CELL_SIZE);
    const maxGx = Math.floor((x + radius + GRID_OFFSET) / CELL_SIZE);
    const minGz = Math.floor((z - radius + GRID_OFFSET) / CELL_SIZE);
    const maxGz = Math.floor((z + radius + GRID_OFFSET) / CELL_SIZE);

    for (let gx = minGx; gx <= maxGx; gx++) {
      for (let gz = minGz; gz <= maxGz; gz++) {
        const k = gx * 10000 + gz;
        const arr = this.cells.get(k);
        if (!arr) continue;
        for (const e of arr) {
          const dx = e.x - x;
          const dz = e.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) results.push({ obj: e.obj, distSq: d2 });
        }
      }
    }
    return results;
  }

  /** Find the single nearest entry within radius. */
  nearest(x: number, z: number, radius: number, filter?: (obj: T) => boolean): { obj: T; dist: number } | null {
    let best: T | null = null;
    let bestD2 = radius * radius;

    const minGx = Math.floor((x - radius + GRID_OFFSET) / CELL_SIZE);
    const maxGx = Math.floor((x + radius + GRID_OFFSET) / CELL_SIZE);
    const minGz = Math.floor((z - radius + GRID_OFFSET) / CELL_SIZE);
    const maxGz = Math.floor((z + radius + GRID_OFFSET) / CELL_SIZE);

    for (let gx = minGx; gx <= maxGx; gx++) {
      for (let gz = minGz; gz <= maxGz; gz++) {
        const k = gx * 10000 + gz;
        const arr = this.cells.get(k);
        if (!arr) continue;
        for (const e of arr) {
          if (filter && !filter(e.obj)) continue;
          const dx = e.x - x;
          const dz = e.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2) { bestD2 = d2; best = e.obj; }
        }
      }
    }
    return best ? { obj: best, dist: Math.sqrt(bestD2) } : null;
  }

  get size(): number {
    let n = 0;
    for (const arr of this.cells.values()) n += arr.length;
    return n;
  }
}
