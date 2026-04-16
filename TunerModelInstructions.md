# Viewmodel Tuner Instructions

The codebase includes built-in debug tuners for positioning GLB weapon viewmodels on screen. Each weapon with a GLB model (M16, Knife) has its own tuner.

## Enabling a Tuner

In `src/rendering/WeaponViewmodel.ts`, find the relevant `_DEBUG_TUNER` constant and set `enabled` to `true`:

```ts
const M16_DEBUG_TUNER = {
  enabled: true,   // ← set to true
  ...
};

const KNIFE_DEBUG_TUNER = {
  enabled: true,   // ← set to true
  ...
};
```

When enabled, an overlay panel appears on screen showing the current values:
- **M16 tuner** — bottom-left (cyan/blue text)
- **Knife tuner** — bottom-right (orange/gold text)

The tuner only responds to input when the matching weapon is active. In TDM/CTF you start with the rifle; in FFA/BR you start with the knife.

## Keyboard Controls

All controls work while the game is running and the relevant weapon is equipped:

### Position (Move the model)
| Key | Action |
|-----|--------|
| `J` / `L` | X axis (left / right) |
| `I` / `K` | Y axis (up / down) |
| `U` / `O` | Z axis (forward / back) |

### Scale
| Key | Action |
|-----|--------|
| `Q` / `E` | Decrease / Increase `desiredMaxDimension` |

### Rotation
| Key | Action |
|-----|--------|
| `1` / `2` | Pitch (rotation.x) |
| `3` / `4` | Yaw (rotation.y) |
| `5` / `6` | Roll (rotation.z) |

### Fine vs Coarse
- **Normal press** — small step (0.005 pos, 0.02 rot, 0.01 scale)
- **Shift + press** — large step (0.02 pos, 0.08 rot, 0.05 scale)

### Print Values
Press `P` to log the final tuning values to the browser console. The output is a copy-pasteable TypeScript constant.

## Applying Tuned Values

1. Press `P` in-game to print the values.
2. Open the browser DevTools console and copy the output.
3. Paste it over the corresponding `_VIEWMODEL_TUNE` constant in `WeaponViewmodel.ts`:
   - `M16_VIEWMODEL_TUNE` for the rifle
   - `KNIFE_VIEWMODEL_TUNE` for the knife
4. Set `enabled: false` on the `_DEBUG_TUNER` to hide the overlay.

## Adding a Tuner for a New Weapon

1. Add a `NEWWEP_VIEWMODEL_TUNE` constant with `desiredMaxDimension`, `position`, `rotation`, and `idleTime`.
2. Add a `NEWWEP_DEBUG_TUNER` constant mirroring the pattern of the existing tuners.
3. Add a debug overlay function (`ensureNewwepDebugOverlay`), refresh function, log function, apply function, and keydown handler — follow the M16/Knife pattern.
4. In `initViewmodel()`, add the `ensureDebugOverlay` + `addEventListener` block for the new tuner.
5. In `attachLoadedNewwep()`, read position/rotation/scale from the debug tuner when `enabled`.
