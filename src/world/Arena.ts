import * as THREE from 'three';
import * as YUKA from 'yuka';
import { gameState } from '@/core/GameState';
import { ARENA_HALF } from '@/config/constants';
import { FP } from '@/config/player';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const arenaMeshes: THREE.Object3D[] = [];
const ARENA_MODEL_URL = `${import.meta.env.BASE_URL}models/arena.glb`;
const arenaLoader = new GLTFLoader();

/**
 * Build the arena: floor, boundary rings, walls, pillars, and team bases.
 */
export async function buildArena(): Promise<void> {
  const { scene } = gameState;

  // ── Floor with hex-grid shader ──
  const floorMat = new THREE.ShaderMaterial({
uniforms: {
      uTime: { value: 0 },
      uBase: { value: new THREE.Color(0x0a1628) },   // brighter base
      uGrid: { value: new THREE.Color(0x2a5088) },   // more visible grid
      uGlow: { value: new THREE.Color(0x3b7bc4) },   // stronger glow
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
        float e = smoothstep(.42, .50, d);
        float pulse = sin(uTime * .5 + length(c.zw) * .4) * .5 + .5;
        float rad = 1. - smoothstep(52., 62., length(vW));
        vec3 col = mix(uBase, mix(uGrid, uGlow, pulse * .5), e * rad * 1.1);
        col += uGlow * e * pulse * rad * .25;
        // Soft radial glow at center
        col += uGlow * 0.08 * (1. - smoothstep(0., 30., length(vW)));
        gl_FragColor = vec4(col, 1.);
      }
    `,
  });
  gameState.floorMat = floorMat;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  arenaMeshes.push(floor);

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
    arenaMeshes.push(m);
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

  // ── Raised Platforms (Elevation) ──
  // Mid-field platforms over looking center
  addPlatform(-14, 0, -14, 4, 1.5, 4);
  addPlatform(14, 0, 14, 4, 1.5, 4);
  
  // Corner sniper platforms
  addPlatform(-38, 0, -38, 4, 1.8, 4);
  addPlatform(38, 0, 38, 4, 1.8, 4);

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
  arenaMeshes.push(bluePlat);

  const bpr = new THREE.Mesh(
    new THREE.RingGeometry(6, 6.3, 8),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
  );
  bpr.rotation.x = -Math.PI / 2;
  bpr.position.set(-48, 0.32, -48);
  scene.add(bpr);
  arenaMeshes.push(bpr);

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
  arenaMeshes.push(redPlat);

  const rpr = new THREE.Mesh(
    new THREE.RingGeometry(6, 6.3, 8),
    new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
  );
  rpr.rotation.x = -Math.PI / 2;
  rpr.position.set(48, 0.32, 48);
  scene.add(rpr);
  arenaMeshes.push(rpr);

  // ── NavMesh Export Helper ──
  // Placed inside buildArena so it has access to floor, bluePlat, and redPlat!
  (window as any).exportMap = () => {
    console.log("Gathering meshes for export...");
    const exporter = new GLTFExporter();
    const exportGroup = new THREE.Group();

    // 1. Grab the floor and platforms
    exportGroup.add(floor.clone());
    exportGroup.add(bluePlat.clone());
    exportGroup.add(redPlat.clone());

    // 2. Grab all the walls and pillars from the gameState
    gameState.wallMeshes.forEach(mesh => {
      exportGroup.add(mesh.clone());
    });

    // 3. Export as a binary GLB file
    exporter.parse(
      exportGroup,
      function ( gltfBuffer ) {
        const blob = new Blob( [ gltfBuffer as ArrayBuffer ], { type: 'application/octet-stream' } );
        const url = URL.createObjectURL( blob );
        
        const link = document.createElement( 'a' );
        link.style.display = 'none';
        link.href = url;
        link.download = 'arena_map.glb'; 
        
        document.body.appendChild( link );
        link.click();
        document.body.removeChild( link );
        console.log("Export complete! Check your downloads folder.");
      },
      function ( error ) {
          console.error( 'An error happened during export:', error );
      },
      { binary: true } 
    );
  };
  
  console.log("NavMesh exporter ready! Type exportMap() in the console.");

  try {
    const arenaRenderModel = await loadArenaRenderModel();
    scene.add(arenaRenderModel);
    arenaMeshes.push(arenaRenderModel);

    for (const mesh of arenaMeshes) {
      if (mesh !== arenaRenderModel) {
        mesh.visible = false;
      }
    }

    gameState.floorMat = null;
    gameState.wallMeshes.length = 0;
    arenaRenderModel.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;

      mesh.castShadow = true;
      mesh.receiveShadow = true;
      gameState.wallMeshes.push(mesh);
    });

    console.info(`[Arena] Rendering from ${ARENA_MODEL_URL}`);
  } catch (err) {
    console.warn('[Arena] Failed to load arena.glb, keeping procedural arena rendering.', err);
  }
}

function loadArenaRenderModel(): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    arenaLoader.load(
      ARENA_MODEL_URL,
      (gltf) => {
        const root = gltf.scene;
        root.name = 'ArenaRenderModel';
        resolve(root);
      },
      undefined,
      reject,
    );
  });
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
  arenaMeshes.push(mesh);

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
  arenaMeshes.push(mesh);

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
  // Use the wider BASE radius (r * 1.08) so the collision boundary aligns with
  // the visible tapered base of the cylinder, not the narrower top radius.
  colliders.push({ type: 'circle', x, z, r: r * 1.08 + FP.playerRadius });
  arenaColliders.push({ type: 'circle', x, z, r: r * 1.08 + 0.35 });

  const ob = new YUKA.GameEntity();
  ob.position.set(x, 0.5, z);
  ob.boundingRadius = r + 0.5;
  yukaObs.push(ob);
  entityManager.add(ob);
}

/**
 * Add an elevated platform with ramps for accessibility.
 * Uses yTop so players and bots can walk on it.
 */
function addPlatform(x: number, _y: number, z: number, w: number, h: number, d: number): void {
  const { scene, wallMeshes, colliders, arenaColliders } = gameState;

  // Main platform block
  const platMesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color: 0x142840, roughness: 0.9, metalness: 0.1, emissive: 0x081020, emissiveIntensity: 0.2,
    }),
  );
  platMesh.position.set(x, h / 2, z);
  platMesh.castShadow = true;
  platMesh.receiveShadow = true;
  scene.add(platMesh);
  arenaMeshes.push(platMesh);

  // Platform top edge highlight
  platMesh.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(platMesh.geometry),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.4 }),
    ),
  );
  wallMeshes.push(platMesh);

  // Platform collision with yTop
  colliders.push({ type: 'box', x, z, hw: w * 0.5 + Math.max(FP.playerRadius, 0.2), hd: d * 0.5 + Math.max(FP.playerRadius, 0.2), yTop: h });
  // Arena colliders are slightly larger. Also give them yTop so bots can step on them.
  arenaColliders.push({ type: 'box', x, z, hw: w * 0.5 + 0.45, hd: d * 0.5 + 0.45, yTop: h });

  // Ramp geometry (custom wedge)
  const rampW = 2; // width of the ramp
  const rampL = 3.5; // length of the ramp
  const rampShape = new THREE.Shape();
  rampShape.moveTo(0, 0);
  rampShape.lineTo(rampL, 0);
  rampShape.lineTo(rampL, h);
  rampShape.lineTo(0, 0);
  
  const extrudeSettings = { depth: rampW, bevelEnabled: false };
  const rampGeo = new THREE.ExtrudeGeometry(rampShape, extrudeSettings);
  rampGeo.computeVertexNormals();
  // Center the pivot a bit better
  rampGeo.translate(-rampL / 2, 0, -rampW / 2);

  const rampMat = new THREE.MeshStandardMaterial({
    color: 0x1a3556, roughness: 0.8, metalness: 0.1, emissive: 0x081020, emissiveIntensity: 0.2
  });

  // Decide ramp orientation based on position to face the center of the arena
  const toCenterX = -x;
  const toCenterZ = -z;
  const isXDominant = Math.abs(toCenterX) > Math.abs(toCenterZ);
  
  const rampMesh = new THREE.Mesh(rampGeo, rampMat);
  rampMesh.castShadow = true;
  rampMesh.receiveShadow = true;

  if (isXDominant) {
    const side = Math.sign(toCenterX);
    rampMesh.position.set(x + side * (w / 2 + rampL / 2), 0, z);
    rampMesh.rotation.y = side > 0 ? Math.PI : 0;
    
    // Ramp steps for collision (players/bots slide/step up)
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      const stepH = h * ((i + 1) / steps);
      const stepW = rampL / steps;
      const stepX = x + side * (w / 2 + rampL - stepW * i - stepW / 2);
      colliders.push({ type: 'box', x: stepX, z, hw: stepW * 0.5 + 0.2, hd: rampW * 0.5 + 0.2, yTop: stepH });
      arenaColliders.push({ type: 'box', x: stepX, z, hw: stepW * 0.5 + 0.2, hd: rampW * 0.5 + 0.2, yTop: stepH });
    }
  } else {
    const side = Math.sign(toCenterZ);
    rampMesh.position.set(x, 0, z + side * (d / 2 + rampL / 2));
    rampMesh.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      const stepH = h * ((i + 1) / steps);
      const stepL = rampL / steps;
      const stepZ = z + side * (d / 2 + rampL - stepL * i - stepL / 2);
      colliders.push({ type: 'box', x, z: stepZ, hw: rampW * 0.5 + 0.2, hd: stepL * 0.5 + 0.2, yTop: stepH });
      arenaColliders.push({ type: 'box', x, z: stepZ, hw: rampW * 0.5 + 0.2, hd: stepL * 0.5 + 0.2, yTop: stepH });
    }
  }

  scene.add(rampMesh);
  arenaMeshes.push(rampMesh);
  wallMeshes.push(rampMesh);
}

export function hideArena(): void {
  for (const m of arenaMeshes) m.visible = false;
  for (const p of gameState.pickups) {
    if (p.mesh) p.mesh.visible = false;
    if (p.ring) p.ring.visible = false;
  }
  for (const f of Object.values(gameState.flags)) {
    if (f.mesh) f.mesh.visible = false;
  }
}

export function showArena(): void {
  for (const m of arenaMeshes) m.visible = true;
  for (const p of gameState.pickups) {
    if (p.active && p.mesh) p.mesh.visible = true;
    if (p.active && p.ring) p.ring.visible = true;
  }
  for (const f of Object.values(gameState.flags)) {
    if (f.mesh) f.mesh.visible = true;
  }
}
