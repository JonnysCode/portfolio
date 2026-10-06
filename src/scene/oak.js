// BLOCKOUT — the oak builder replaces this with the Great Oak.
import * as THREE from 'three';
import { OAK } from '../world/layout.js';

export default async function build(ctx) {
  const { materials } = ctx;
  const g = new THREE.Group();
  g.name = 'great-oak';
  g.position.set(OAK.x, 0, OAK.z);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(2.4, OAK.baseRadius, 18, 24), materials.surface('bark'));
  trunk.position.y = 9;
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(13, 24, 16), materials.foliage({ color: '#4f7f36' }));
  canopy.scale.set(1.3, 0.62, 1.1);
  canopy.position.y = 22;
  for (const m of [trunk, canopy]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  ctx.scene.add(g);
  return {};
}
