# BR Performance Optimization Guide

## Performance Summary

### Before (original BR code)
- **50 bots** × full AI update every frame = ~50ms AI per frame
- **30+ draw calls per building** × 30 buildings = ~900 draw calls
- **N draw calls per loot item** × 200+ items = ~400 draw calls
- **Trees/rocks**: individual meshes = ~300 draw calls
- **Total**: ~1700+ draw calls, 50ms+ AI, heavy GC from particle allocation

### After (optimized)
- **30 bots** with LOD: ~8 full + 10 light + 12 minimal = equivalent of ~12 full updates
- **2-3 draw calls per building** (merged geometry) × 30 = ~75 draw calls
- **2 draw calls for ALL loot** (InstancedMesh)
- **3 draw calls for ALL trees** (InstancedMesh: trunks + leaves + rocks)
- **Total**: ~100 draw calls, ~15ms AI, pooled particles eliminate GC

## Key Optimization Systems

### 1. SpatialGrid (`src/br/SpatialGrid.ts`)
O(1) proximity queries replacing O(n) loops everywhere:
- Loot pickup: `lootGrid.nearest()` instead of scanning all loot
- Bot-to-bot proximity: `botGrid.queryRadius()` for team awareness
- Building proximity: `buildingGrid.nearest()` for loot placement
- Cell size 20m on a 320m map = 16×16 grid = 256 cells

### 2. Object Pools (`src/br/ObjectPool.ts`)
Pre-allocated mesh/light pools eliminate per-frame allocations:
- Particle pool: 200 pre-allocated meshes
- Light pool: 30 pre-allocated point lights
- Zero GC pressure during combat

### 3. Geometry Merging (`src/br/Buildings.ts`)
Each building's 30+ individual box meshes → 2-3 merged meshes:
- `mergeGeometries()` from Three.js utils
- Walls → 1 mesh, accents → 1 mesh, roof → 1 mesh
- Source geometries disposed after merge

### 4. InstancedMesh (`src/br/BRMap.ts`, `src/br/LootSystem.ts`)
- **Trees**: 120 trunks = 1 InstancedMesh, 120 leaf cones = 1 InstancedMesh
- **Rocks**: 60 dodecahedrons = 1 InstancedMesh
- **Loot**: 600 crate boxes = 1 InstancedMesh, 600 beams = 1 InstancedMesh
- Per-instance color via `setColorAt()` for rarity differentiation

### 5. AI LOD (`src/br/BRBots.ts`)
Distance-based update frequency tiers:
```
TIER0 (< 50m):  full AI every frame
TIER1 (< 100m): AI every 3rd frame (+ always if in combat)
TIER2 (< 160m): AI every 6th frame
TIER3 (> 160m): AI every 15th frame, mesh hidden
```

### 6. Animation LOD (`src/core/GameLoop.ts`)
- Only agents within 100m get skeletal animation updates
- Far agents freeze in their last pose (invisible anyway at TIER3)
- Minimap redraws every 2nd frame in BR mode
- HUD/scoreboard updates every 3rd frame

## Visual Changes (Fortnite Style)

1. **Bright palette**: greens, blues, warm oranges instead of dark military
2. **Colored roofs**: each building has a warm-colored roof (orange, gold, red)
3. **Bright sky**: `scene.background = #78a8d8`, fog is light blue not dark
4. **Strong sun**: warm directional light at 2.8 intensity
5. **Purple storm**: vibrant purple-blue procedural shader
6. **Rarity glow colors**: matching Fortnite's green/blue/purple/gold scheme

## Integration

Replace these files in your project:
```
src/br/SpatialGrid.ts     (NEW)
src/br/ObjectPool.ts       (NEW)
src/br/BRConfig.ts         (REPLACE)
src/br/Buildings.ts        (REPLACE)
src/br/BRMap.ts            (REPLACE)
src/br/LootSystem.ts       (REPLACE)
src/br/ZoneSystem.ts       (REPLACE)
src/br/BRBots.ts           (REPLACE)
src/br/BRController.ts     (REPLACE)
src/br/BRHUD.ts            (REPLACE)
src/core/GameLoop.ts       (REPLACE)
```

Keep unchanged:
```
src/br/Inventory.ts        (same)
src/br/InventoryUI.ts      (same)
src/br/DropPlane.ts        (same)
src/br/Vehicles.ts         (same)
```

### NPM dependency
Add `three` examples import for mergeGeometries:
```
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
```
This is already bundled with three.js — no extra install needed.
