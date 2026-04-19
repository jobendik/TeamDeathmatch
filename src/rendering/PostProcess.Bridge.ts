import type { PostFX } from './PostProcess';
import type { ScreenFX } from './ScreenFX';

/**
 * Either the full GPU post-processing stack (PostFX) or the lightweight
 * DOM-overlay ScreenFX is installed. Both satisfy the gameplay API
 * (`triggerHit`, `triggerKill`, `setLowHp`, `update`).
 *
 * GameLoop checks for `.composer` to decide whether to route the frame
 * through EffectComposer or call `renderer.render()` directly.
 */
export type ActiveFX = PostFX | ScreenFX;

let _fx: ActiveFX | null = null;

export function setPostFX(fx: ActiveFX): void { _fx = fx; }
export function getPostFX(): ActiveFX | null { return _fx; }
