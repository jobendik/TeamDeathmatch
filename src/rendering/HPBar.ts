import * as THREE from 'three';
import type { TDMAgent } from '@/entities/TDMAgent';

/**
 * Add a floating HP bar above an agent's mesh.
 */
export function addHPBar(ag: TDMAgent): void {
  const grp = new THREE.Group();

  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.1),
    new THREE.MeshBasicMaterial({
      color: 0x0a0a0a,
      depthTest: false,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
    }),
  );
  grp.add(bg);

  const fg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.1),
    new THREE.MeshBasicMaterial({ color: 0x22c55e, depthTest: false, side: THREE.DoubleSide }),
  );
  fg.position.z = 0.002;
  grp.add(fg);

  grp.position.y = 2.3;
  ag.renderComponent!.add(grp);
  ag.hpBarGroup = grp;
  ag.hpBarFg = fg;
}
