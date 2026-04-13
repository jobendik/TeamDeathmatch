import * as THREE from 'three';
import * as YUKA from 'yuka';
import { gameState } from '@/core/GameState';
import { ARENA_HALF } from '@/config/constants';
import { FP } from '@/config/player';

/**
 * Build the arena: floor, boundary rings, walls, pillars, and team bases.
 */
export function buildArena(): void {
  const { scene } = gameState;

  // ── Floor with hex-grid shader ──
  const floorMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBase: { value: new THREE.Color(0x020a16) },
      uGrid: { value: new THREE.Color(0x0b2244) },
      uGlow: { value: new THREE.Color(0x0e3266) },
    },
    vertexShader: `
      varying vec2 vW;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.);
        vW = w.xz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uBase, uGrid, uGlow;
      varying vec2 vW;
      float hd(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1., 1.732))), p.x); }
      vec4 hc(vec2 uv){
        vec2 r = vec2(1., 1.732), h = r * .5;
        vec2 a = mod(uv, r) - h, b = mod(uv - h, r) - h;
        return dot(a,a) < dot(b,b) ? vec4(a, floor(uv/r)) : vec4(b, floor((uv-h)/r));
      }
      void main(){
        vec4 c = hc(vW * .18);
        float d = hd(c.xy);
        float e = smoothstep(.45, .49, d);
        float pulse = sin(uTime * .5 + length(c.zw) * .4) * .5 + .5;
        float rad = 1. - smoothstep(48., 60., length(vW));
        vec3 col = mix(uBase, mix(uGrid, uGlow, pulse * .4), e * rad * .8);
        col += uGlow * e * pulse * rad * .12;
        gl_FragColor = vec4(col, 1.);
      }
    `,
  });
  gameState.floorMat = floorMat;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ── Arena boundary rings ──
  const ringDefs: [number, number, number][] = [
    [ARENA_HALF - 0.5, ARENA_HALF, 0.2],
    [ARENA_HALF - 2, ARENA_HALF - 1.5, 0.1],
  ];
  for (const [r1, r2, op] of ringDefs) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(r1, r2, 80),
      new THREE.MeshBasicMaterial({ color: 0x1d4ed8, transparent: true, opacity: op, side: THREE.DoubleSide }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.03;
    scene.add(m);
  }

  // ── WALLS & COVER ──
  // Central structure
  addWall(0, 1.8, 0, 14, 3.6, 2.5);
  addWall(0, 1.8, 0, 2.5, 3.6, 12);

  // Mid lanes
  addWall(-20, 1.5, 0, 8, 3, 2);
  addWall(20, 1.5, 0, 8, 3, 2);
  addWall(0, 1.5, -20, 2, 3, 8);
  addWall(0, 1.5, 20, 2, 3, 8);

  // Corner forts (Blue side)
  addWall(-42, 1.5, -42, 10, 3, 2.2);
  addWall(-46, 1.5, -38, 2.2, 3, 8);
  addWall(-36, 1.5, -46, 2.2, 3, 6);

  // Corner forts (Red side)
  addWall(42, 1.5, 42, 10, 3, 2.2);
  addWall(46, 1.5, 38, 2.2, 3, 8);
  addWall(36, 1.5, 46, 2.2, 3, 6);

  // Opposite corners
  addWall(-42, 1.5, 42, 8, 3, 2);
  addWall(-46, 1.5, 38, 2, 3, 7);
  addWall(42, 1.5, -42, 8, 3, 2);
  addWall(46, 1.5, -38, 2, 3, 7);

  // Mid-field structures
  addWall(-28, 1.5, -18, 6, 3, 2);
  addWall(-18, 1.5, -28, 2, 3, 6);
  addWall(28, 1.5, 18, 6, 3, 2);
  addWall(18, 1.5, 28, 2, 3, 6);
  addWall(-28, 1.5, 18, 5, 3, 2);
  addWall(28, 1.5, -18, 5, 3, 2);

  // Scattered cover blocks
  addWall(-10, 1, 10, 3, 2, 1.5);
  addWall(10, 1, -10, 3, 2, 1.5);
  addWall(-10, 1, -10, 1.5, 2, 3);
  addWall(10, 1, 10, 1.5, 2, 3);

  // Long lane walls
  addWall(-35, 1.5, -5, 2, 3, 12);
  addWall(35, 1.5, 5, 2, 3, 12);

  // Small cover pieces
  addWall(-15, 1, 35, 3, 2, 1.5);
  addWall(15, 1, -35, 3, 2, 1.5);
  addWall(-35, 1, 15, 1.5, 2, 3);
  addWall(35, 1, -15, 1.5, 2, 3);

  // Pillars
  const pillarPositions: [number, number, number][] = [
    [-22, 0, -8], [22, 0, 8], [-8, 0, 22], [8, 0, -22],
    [-38, 0, 28], [38, 0, -28], [28, 0, -38], [-28, 0, 38],
    [-48, 0, 0], [48, 0, 0], [0, 0, -48], [0, 0, 48],
    [-15, 0, -15], [15, 0, 15],
  ];
  for (const [x, , z] of pillarPositions) {
    addPillar(x, 1.5, z, 0.9);
  }

  // ── Team base platforms ──
  // Blue base
  const bluePlat = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 6.5, 0.3, 8),
    new THREE.MeshStandardMaterial({
      color: 0x0e1e38, roughness: 0.5, metalness: 0.3, emissive: 0x0a1a3a, emissiveIntensity: 0.5,
    }),
  );
  bluePlat.position.set(-48, 0.15, -48);
  bluePlat.receiveShadow = true;
  scene.add(bluePlat);

  const bpr = new THREE.Mesh(
    new THREE.RingGeometry(6, 6.3, 8),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
  );
  bpr.rotation.x = -Math.PI / 2;
  bpr.position.set(-48, 0.32, -48);
  scene.add(bpr);

  // Red base
  const redPlat = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 6.5, 0.3, 8),
    new THREE.MeshStandardMaterial({
      color: 0x2a0e0e, roughness: 0.5, metalness: 0.3, emissive: 0x3a0a0a, emissiveIntensity: 0.5,
    }),
  );
  redPlat.position.set(48, 0.15, 48);
  redPlat.receiveShadow = true;
  scene.add(redPlat);

  const rpr = new THREE.Mesh(
    new THREE.RingGeometry(6, 6.3, 8),
    new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
  );
  rpr.rotation.x = -Math.PI / 2;
  rpr.position.set(48, 0.32, 48);
  scene.add(rpr);
}

/**
 * Add a wall (box collider + mesh) to the scene.
 */
function addWall(x: number, y: number, z: number, w: number, h: number, d: number): void {
  const { scene, wallMeshes, colliders, arenaColliders, yukaObs, entityManager } = gameState;

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color: 0x101e32, roughness: 0.85, metalness: 0.15, emissive: 0x060e1c, emissiveIntensity: 0.3,
    }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  mesh.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: 0x1e4480, transparent: true, opacity: 0.4 }),
    ),
  );

  // Top accent stripe
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.04, 0.06, d + 0.04),
    new THREE.MeshBasicMaterial({ color: 0x1e4480, transparent: true, opacity: 0.5 }),
  );
  stripe.position.y = h * 0.5;
  mesh.add(stripe);

  wallMeshes.push(mesh);
  colliders.push({ type: 'box', x, z, hw: w * 0.5 + FP.playerRadius, hd: d * 0.5 + FP.playerRadius });
  arenaColliders.push({ type: 'box', x, z, hw: w * 0.5 + 0.45, hd: d * 0.5 + 0.45 });

  const ob = new YUKA.GameEntity();
  ob.position.set(x, 0.5, z);
  ob.boundingRadius = Math.max(w, d) * 0.6;
  yukaObs.push(ob);
  entityManager.add(ob);
}

/**
 * Add a cylindrical pillar to the scene.
 */
function addPillar(x: number, y: number, z: number, r: number): void {
  const { scene, wallMeshes, colliders, arenaColliders, yukaObs, entityManager } = gameState;

  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 1.08, 3.2, 10),
    new THREE.MeshStandardMaterial({ color: 0x182e4a, roughness: 0.65, metalness: 0.2, emissive: 0x0a1830, emissiveIntensity: 0.2 }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(r + 0.05, r + 0.05, 0.08, 10),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.4 }),
  );
  band.position.y = 0.8;
  mesh.add(band);

  // Second band near base
  const band2 = new THREE.Mesh(
    new THREE.CylinderGeometry(r + 0.05, r + 0.05, 0.06, 10),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.25 }),
  );
  band2.position.y = -0.6;
  mesh.add(band2);

  // Base glow ring
  const baseRing = new THREE.Mesh(
    new THREE.RingGeometry(r * 0.8, r * 1.3, 12),
    new THREE.MeshBasicMaterial({ color: 0x1e4480, transparent: true, opacity: 0.15, side: THREE.DoubleSide }),
  );
  baseRing.rotation.x = -Math.PI / 2;
  baseRing.position.y = -y + 0.03;
  mesh.add(baseRing);

  wallMeshes.push(mesh);
  colliders.push({ type: 'circle', x, z, r: r + FP.playerRadius });
  arenaColliders.push({ type: 'circle', x, z, r: r + 0.35 });

  const ob = new YUKA.GameEntity();
  ob.position.set(x, 0.5, z);
  ob.boundingRadius = r + 0.5;
  yukaObs.push(ob);
  entityManager.add(ob);
}
