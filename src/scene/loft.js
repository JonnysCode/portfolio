// BLOCKOUT — the loft builder replaces this with the Code Loft treehouse.
import * as THREE from 'three';
import { OAK } from '../world/layout.js';

export default async function build(ctx) {
  const { materials } = ctx;
  const g = new THREE.Group();
  g.position.set(OAK.loft.x, OAK.loft.y, OAK.loft.z);
  g.rotation.y = OAK.loft.rotY;
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(OAK.loft.radius * 0.8, OAK.loft.radius * 0.8, 0.3, 20), materials.surface('wood', { species: 'spruce' }));
  const hut = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 2.2), materials.surface('plaster'));
  hut.position.set(0.6, 1.25, 0.4);
  g.add(deck, hut);
  for (const o of [deck, hut]) { o.castShadow = o.receiveShadow = true; }
  ctx.scene.add(g);
  ctx.interactions.add(hut, { entryId: 'this-portfolio', area: 'code' });
  return {};
}
