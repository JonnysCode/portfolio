// ─────────────────────────────────────────────────────────────────────────────
// The Schreinerei — Jonny's woodworking spot, the heart of the glen: a
// cabinetmaker's workshop built into the roots of the Great Oak.
// (work in progress)
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { Batch, makeMats, takeHalos } from './schreinerei/kit.js';
import { buildDoor } from './schreinerei/door.js';
import { buildAnnex } from './schreinerei/annex.js';
import { buildPorch } from './schreinerei/porch.js';
import { buildDeck } from './schreinerei/deck.js';

export default async function build(ctx) {
  const mats = makeMats(ctx);
  const root = new THREE.Group();
  root.name = 'schreinerei';
  ctx.scene.add(root);
  const B = new Batch();
  const door = buildDoor(ctx, B, mats);
  const annex = buildAnnex(ctx, B, mats);
  const porch = buildPorch(ctx, B, mats);
  ctx.interactions.add(porch.bench, { entryId: 'workbench-wip', area: 'woodworking', focus: { distance: 3, height: 0.5 } });
  const deck = buildDeck(ctx, B, mats);
  ctx.interactions.add(deck.table, { entryId: 'dining-table', area: 'woodworking', focus: { distance: 3.4, height: 0.5 } });
  ctx.interactions.add(deck.cabinet, { entryId: 'record-cabinet', area: 'woodworking', focus: { distance: 2.6, height: 0.3 } });
  ctx.interactions.add(deck.coffee, { entryId: 'coffee-table', area: 'woodworking', focus: { distance: 2.4, height: 0.3 } });
  ctx.interactions.add(deck.player, {
    entryId: 'record-player',
    area: 'woodworking',
    focus: { distance: 2.0, height: 0.55 },
    onActivate(h) {
      // open the story AND give it a spin
      ctx.ui?.openEntry?.('record-player', { hotspot: h });
      deck.togglePlaying();
    },
  });
  ctx.interactions.add(door.cert, { entryId: 'efz-certificate', area: 'woodworking', focus: { distance: 2.4, height: 0.1 } });
  B.build(root, 'schreinerei');
  // every lantern, bulb and window halo of the Schreinerei in ONE additive mesh
  const halos = takeHalos();
  if (halos.length) root.add(ctx.props.glowQuads(halos, '#ffc46e', { day: 0.06, night: 0.7 }));
  const updates = [door.update, annex.update, porch.update, deck.update];
  return {
    update(dt, t) {
      for (const u of updates) u(dt, t);
    },
  };
}
