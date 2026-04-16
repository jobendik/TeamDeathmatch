import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { gameState } from '@/core/GameState';

/**
 * Vignette + grain + chromatic aberration shader.
 * Single pass because we're performance-conscious.
 */
const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.85 },      // 0 = none, 1 = heavy
    uVignetteSoftness: { value: 0.6 },
    uGrain: { value: 0.035 },
    uChroma: { value: 0.0015 },      // chromatic aberration amount
    uHitPulse: { value: 0 },         // 0..1 — spikes red when hit
    uLowHpPulse: { value: 0 },       // 0..1 — desaturate + red edges when low hp
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
    uniform float uVignetteSoftness;
    uniform float uGrain;
    uniform float uChroma;
    uniform float uHitPulse;
    uniform float uLowHpPulse;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(234.34, 435.345));
      p += dot(p, p + 34.23);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 center = vec2(0.5);
      vec2 toCenter = vUv - center;
      float dist = length(toCenter);

      // Chromatic aberration — stronger at edges
      float caStrength = uChroma * (1.0 + dist * 3.5);
      vec2 dir = normalize(toCenter + 1e-5);

      vec3 col;
      col.r = texture2D(tDiffuse, vUv - dir * caStrength).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + dir * caStrength).b;

      // Vignette
      float v = smoothstep(0.8, uVignetteSoftness, dist * (1.0 - uVignette * 0.5));
      col *= mix(1.0 - uVignette * 0.65, 1.0, v);

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

      // Grain
      float n = (hash(vUv * 1024.0 + uTime * 60.0) - 0.5) * uGrain;
      col += n;

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
  setLowHp: (t: number) => void;
  update: (dt: number) => void;
  resize: () => void;
}

export function initPostProcess(): PostFX {
  const { renderer, scene, camera } = gameState;

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const size = new THREE.Vector2(innerWidth, innerHeight);
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(size, 0.65, 0.85, 0.82);
  bloom.threshold = 0.82;
  bloom.strength = 0.65;
  bloom.radius = 0.9;
  composer.addPass(bloom);

  const cinematic = new ShaderPass(CinematicShader);
  composer.addPass(cinematic);

  const fxaa = new ShaderPass(FXAAShader);
  const px = renderer.getPixelRatio();
  fxaa.material.uniforms['resolution'].value.set(1 / (innerWidth * px), 1 / (innerHeight * px));
  composer.addPass(fxaa);

  let hitPulse = 0;
  let lowHp = 0;

  return {
    composer, bloom, cinematic, fxaa,
    triggerHit(intensity = 0.55) {
      hitPulse = Math.max(hitPulse, intensity);
    },
    setLowHp(t: number) {
      lowHp = t;
    },
    update(dt: number) {
      hitPulse = Math.max(0, hitPulse - dt * 2.5);
      cinematic.uniforms.uTime.value += dt;
      cinematic.uniforms.uHitPulse.value = hitPulse;
      cinematic.uniforms.uLowHpPulse.value = lowHp;
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
