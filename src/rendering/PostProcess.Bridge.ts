import type { PostFX } from './PostProcess';

let _fx: PostFX | null = null;

export function setPostFX(fx: PostFX): void { _fx = fx; }
export function getPostFX(): PostFX | null { return _fx; }
