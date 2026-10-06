// BLOCKOUT — the cottage builder replaces this with the mushroom cottages.
import * as THREE from 'three';
import { COTTAGE } from '../world/layout.js';
import { anchorGroup } from '../world/index.js';

function mushroom(ctx, h, r) {
  const { materials } = ctx;
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.68, h * 0.55, 20), materials.surface('mushroomStem'));
  stem.position.y = h * 0.275;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 1.15, h * 0.5, 24), materials.surface('mushroomCap'));
  cap.position.y = h * 0.72;
  for (const m of [stem, cap]) { m.castShadow = m.receiveShadow = true; g.add(m); }
  return g;
}

export default async function build(ctx) {
  const home = anchorGroup(ctx, COTTAGE.home, 'home');
  home.add(mushroom(ctx, 8.5, 2.6));
  ctx.interactions.add(home, { entryId: 'about-me', area: 'home' });
  const atelier = anchorGroup(ctx, COTTAGE.atelier, 'atelier');
  atelier.add(mushroom(ctx, 6.5, 2.3));
  ctx.interactions.add(atelier, { entryId: 'living-room', area: 'interior' });
  const shed = anchorGroup(ctx, COTTAGE.shed, 'shed');
  shed.add(mushroom(ctx, 3.4, 1.1));
  const mailbox = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.5), ctx.materials.surface('wood', { species: 'cherry' }));
  mailbox.position.set(COTTAGE.home.x + 3.2, 1.0, COTTAGE.home.z + 2.6);
  ctx.scene.add(mailbox);
  ctx.interactions.add(mailbox, { entryId: 'contact', area: 'home' });
  return {};
}
