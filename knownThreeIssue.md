
I've identified the root cause. Here's what's happening:

The "well known issue": When using EffectComposer (post-processing) in Three.js before r153, the renderer's outputEncoding (sRGB conversion) is not applied to the final output. The EffectComposer's internal render targets use LinearEncoding by default, so materials that follow the proper linear workflow (like MeshPhongMaterial from FBXLoader) output linear values that are displayed directly on the gamma-corrected monitor — making them appear much darker than intended.

The cel-shaded custom ShaderMaterial is unaffected because it outputs hardcoded color values directly without using the encodings_fragment shader chunk, so its colors appear as-coded regardless of encoding settings.

The fix: Add a GammaCorrectionShader pass as the last pass in the EffectComposer chain. This is the standard pre-r153 solution — r153 introduced OutputPass specifically to replace this manual correction. No version downgrade needed.

What I found: The "well known issue" is not about the Three.js version — it's about missing gamma correction in the post-processing pipeline. Here's the explanation:

The EffectComposer creates internal render targets with LinearEncoding (default)
When the scene is rendered into these targets, the outputEncoding = sRGBEncoding on the renderer is overridden by the render target's encoding — so no linear-to-sRGB conversion happens
FBX models use MeshPhongMaterial which follows the proper linear lighting workflow — their shader output stays in linear space (very dark on a gamma-corrected display)
The cel-shaded ShaderMaterial outputs hardcoded color values directly (no encodings_fragment chunk), so it looks as intended regardless
This is why only the FBX models appear dark while procedural geometry looks fine
The fix: Added a GammaCorrectionShader pass as the last pass in the EffectComposer. This converts the linear output to sRGB for correct display. Three.js r153+ solved this properly with OutputPass, but on r149 the GammaCorrectionShader is the standard solution.

This also explains why downgrading from r160 to r149 didn't help — the issue was never about the Three.js version; it was the missing gamma correction in the post-processing chain.

