// ─────────────────────────────────────────────────────────────────────────────
// The Schreinerei — Jonny's woodworking spot, the heart of the glen: a
// cabinetmaker's workshop built into the roots of the Great Oak.
// (work in progress)
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { Batch, makeMats } from './schreinerei/kit.js';
import { buildDoor } from './schreinerei/door.js';
import { buildAnnex } from './schreinerei/annex.js';

export default async function build(ctx) {
  const mats = makeMats(ctx);
  const root = new THREE.Group();
  root.name = 'schreinerei';
  ctx.scene.add(root);
  const B = new Batch();
  const door = buildDoor(ctx, B, mats);
  const annex = buildAnnex(ctx, B, mats);
  ctx.interactions.add(door.cert, { entryId: 'efz-certificate', area: 'woodworking', focus: { distance: 2.4, height: 0.1 } });
  B.build(root, 'schreinerei');
  const updates = [door.update, annex.update];
  return {
    update(dt, t) {
      for (const u of updates) u(dt, t);
    },
  };
}
