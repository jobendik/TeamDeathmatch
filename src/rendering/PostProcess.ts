import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { gameState } from '@/core/GameState';

/**
 * Vignette + damage FX shader.
 * Single pass because we're performance-conscious.
 */
const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.55 },       // 0 = none, 1 = heavy (0.3–0.5 is FPS-standard)
    uHitPulse: { value: 0 },          // 0..1 — spikes red when hit
    uLowHpPulse: { value: 0 },        // 0..1 — desaturate + red edges when low hp
    uKillPulse: { value: 0 },         // 0..1 — brief saturation+contrast boost on kill
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uHitPulse;
    uniform float uLowHpPulse;
    uniform float uKillPulse;
    varying vec2 vUv;

    void main() {
      vec2 center = vec2(0.5);
      vec2 toCenter = vUv - center;
      float dist = length(toCenter);

      vec3 col = texture2D(tDiffuse, vUv).rgb;

      // Vignette — smooth darkening toward screen edges
      float vig = smoothstep(0.3, 0.75, dist);
      col *= 1.0 - vig * uVignette;

      // Hit pulse — red flash strongest at edges
      if (uHitPulse > 0.001) {
        float edgeMask = smoothstep(0.2, 0.9, dist);
        col.r += uHitPulse * edgeMask * 0.6;
        col.gb *= 1.0 - uHitPulse * edgeMask * 0.4;
      }

      // Low HP pulse — desaturation + red edges (COD style)
      if (uLowHpPulse > 0.001) {
        float edgeMask = smoothstep(0.1, 0.8, dist);
        float desat = uLowHpPulse * 0.55;
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(lum), desat);
        col.r += uLowHpPulse * edgeMask * 0.35 * (0.7 + 0.3 * sin(uTime * 6.0));
      }

      // Kill pulse — brief saturation + contrast boost
      if (uKillPulse > 0.001) {
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        // Boost saturation by pushing away from grey
        col = mix(vec3(lum), col, 1.0 + uKillPulse * 0.35);
        // Slight contrast push
        col = mix(vec3(0.5), col, 1.0 + uKillPulse * 0.12);
      }

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export interface PostFX {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  cinematic: ShaderPass;
  fxaa: ShaderPass;
  triggerHit: (intensity?: number) => void;
  triggerKill: () => void;
  setLowHp: (t: number) => void;
  update: (dt: number) => void;
  resize: () => void;
}

export function initPostProcess(): PostFX {
  const { renderer, scene, camera } = gameState;

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const size = new THREE.Vector2(innerWidth, innerHeight);
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(size, 0.45, 0.35, 0.82);
  bloom.threshold = 0.82;
  bloom.strength = 0.45;
  bloom.radius = 0.35;
  composer.addPass(bloom);

  const cinematic = new ShaderPass(CinematicShader);
  composer.addPass(cinematic);

  const fxaa = new ShaderPass(FXAAShader);
  const px = renderer.getPixelRatio();
  fxaa.material.uniforms['resolution'].value.set(1 / (innerWidth * px), 1 / (innerHeight * px));
  composer.addPass(fxaa);

  // OutputPass applies tone mapping + sRGB color space conversion.
  // Without this, EffectComposer render targets stay in linear space,
  // making MeshStandardMaterial / MeshPhongMaterial appear too dark.
  composer.addPass(new OutputPass());

  let hitPulse = 0;
  let lowHp = 0;
  let killPulse = 0;

  return {
    composer, bloom, cinematic, fxaa,
    triggerHit(intensity = 0.55) {
      hitPulse = Math.max(hitPulse, intensity);
    },
    triggerKill() {
      killPulse = 0.4;
    },
    setLowHp(t: number) {
      lowHp = t;
    },
    update(dt: number) {
      hitPulse = Math.max(0, hitPulse - dt * 2.5);
      killPulse = Math.max(0, killPulse - dt * 3);
      cinematic.uniforms.uTime.value += dt;
      cinematic.uniforms.uHitPulse.value = hitPulse;
      cinematic.uniforms.uLowHpPulse.value = lowHp;
      cinematic.uniforms.uKillPulse.value = killPulse;
    },
    resize() {
      const w = innerWidth, h = innerHeight;
      composer.setSize(w, h);
      bloom.setSize(w, h);
      const px = renderer.getPixelRatio();
      fxaa.material.uniforms['resolution'].value.set(1 / (w * px), 1 / (h * px));
    },
  };
}
