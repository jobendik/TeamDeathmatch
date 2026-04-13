import * as THREE from 'three';
import { gameState } from '@/core/GameState';

/**
 * Set up all scene lighting: ambient, hemisphere, directional sun, and atmospheric point lights.
 */
export function buildLights(): void {
  const { scene } = gameState;

  scene.add(new THREE.AmbientLight(0x8ba4d0, 0.3));
  scene.add(new THREE.HemisphereLight(0x5090d0, 0x080d1a, 0.45));

  const sun = new THREE.DirectionalLight(0xb0ccff, 0.9);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.width = sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.bias = -0.001;
  scene.add(sun);

  // Atmospheric point lights — stronger, wider coverage
  const pt = (col: number, x: number, y: number, z: number, intensity: number, distance: number) => {
    const l = new THREE.PointLight(col, intensity, distance);
    l.position.set(x, y, z);
    scene.add(l);
  };

  pt(0x3b82f6, -50, 6, -50, 3, 40);
  pt(0xef4444, 50, 6, 50, 3, 40);
  pt(0x22c55e, -50, 6, 50, 2, 35);
  pt(0xf59e0b, 50, 6, -50, 2, 35);
  pt(0x8b5cf6, 0, 8, 0, 2.5, 45);

  // Additional rim lights for cover structures
  pt(0x6677bb, -30, 4, 0, 1.5, 25);
  pt(0x6677bb, 30, 4, 0, 1.5, 25);
  pt(0x4455aa, 0, 4, -30, 1.2, 22);
  pt(0x4455aa, 0, 4, 30, 1.2, 22);

  // Subtle fog for depth
  scene.fog = new THREE.FogExp2(0x0a0e1a, 0.008);
}
