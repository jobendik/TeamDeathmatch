import * as THREE from 'three';
import { gameState } from '@/core/GameState';

/**
 * AAA-style lighting: bright key sun, cool ambient fill, warm rim on team bases,
 * visible but atmospheric. Scene is readable during combat.
 */
export function buildLights(): void {
  const { scene } = gameState;

  // ── AMBIENT + HEMI (much brighter for readability) ──
  scene.add(new THREE.AmbientLight(0x9bb4dd, 0.55));

  const hemi = new THREE.HemisphereLight(0x88a8d8, 0x20283a, 0.75);
  hemi.position.set(0, 50, 0);
  scene.add(hemi);

  // ── KEY LIGHT (SUN) — warm, directional ──
  const sun = new THREE.DirectionalLight(0xffe8c4, 2.2);
  sun.position.set(45, 80, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 4;
  scene.add(sun);

  // ── FILL LIGHT — cool, opposite side ──
  const fill = new THREE.DirectionalLight(0x6080c0, 0.55);
  fill.position.set(-30, 40, -20);
  scene.add(fill);

  // ── RIM LIGHT (back light) — cold, for silhouette pop ──
  const rim = new THREE.DirectionalLight(0x4488ff, 0.45);
  rim.position.set(-10, 20, -50);
  scene.add(rim);

  // ── ATMOSPHERIC POINT LIGHTS (brighter, with animated flicker) ──
  const pt = (col: number, x: number, y: number, z: number, intensity: number, distance: number) => {
    const l = new THREE.PointLight(col, intensity, distance, 1.8);
    l.position.set(x, y, z);
    scene.add(l);
    return l;
  };

  // Team base lights — stronger
  pt(0x3b82f6, -50, 8, -50, 18, 45);
  pt(0xef4444, 50, 8, 50, 18, 45);

  // Corner atmosphere
  pt(0x22c55e, -50, 6, 50, 10, 35);
  pt(0xf59e0b, 50, 6, -50, 10, 35);
  pt(0x8b5cf6, 0, 10, 0, 14, 50);

  // Lane markers — lower so they wash walls, flickering subtly
  const lane1 = pt(0x5577cc, -30, 4, 0, 8, 28);
  const lane2 = pt(0x5577cc, 30, 4, 0, 8, 28);
  const lane3 = pt(0x4455aa, 0, 4, -30, 7, 26);
  const lane4 = pt(0x4455aa, 0, 4, 30, 7, 26);

  // Store for subtle animation in Visuals
  (gameState as any)._flickerLights = [lane1, lane2, lane3, lane4];

  // ── SOFTER ATMOSPHERIC FOG — fog-of-mood not fog-of-war ──
  scene.fog = new THREE.FogExp2(0x1a2438, 0.0045);
  scene.background = new THREE.Color(0x0c1220);
}
