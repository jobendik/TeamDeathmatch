import * as THREE from 'three';
import type { TDMAgent } from '@/entities/TDMAgent';

/** Dispose the HP bar's geometry and material to prevent VRAM leaks. */
function disposeMeshChildren(grp: THREE.Group): void {
  grp.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const m = child as THREE.Mesh;
      m.geometry.dispose();
      if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose());
      else (m.material as THREE.Material).dispose();
    }
  });
}

/**
 * Add a floating HP bar above an agent's mesh.
 */
export function createHPBarGroup(): { group: THREE.Group; fg: THREE.Mesh } {
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
  return { group: grp, fg };
}

export function addHPBar(ag: TDMAgent): void {
  // Dispose existing HP bar if re-adding
  if (ag.hpBarGroup) {
    disposeMeshChildren(ag.hpBarGroup);
    ag.hpBarGroup.parent?.remove(ag.hpBarGroup);
  }

  const { group, fg } = createHPBarGroup();
  const grp = group;
  ag.renderComponent!.add(grp);
  ag.hpBarGroup = grp;
  ag.hpBarFg = fg;
}

/** Remove and dispose the HP bar resources for an agent. */
export function disposeHPBar(ag: TDMAgent): void {
  if (!ag.hpBarGroup) return;
  disposeMeshChildren(ag.hpBarGroup);
  ag.hpBarGroup.parent?.remove(ag.hpBarGroup);
  ag.hpBarGroup = null;
  ag.hpBarFg = null;
}
