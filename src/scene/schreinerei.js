// ─────────────────────────────────────────────────────────────────────────────
// The Schreinerei — Jonny's woodworking spot, the heart of the glen: a
// cabinetmaker's workshop built into the roots of the Great Oak.
//
//   schreinerei/door.js   the round-arched door in the oak (OAK.door): carved
//                         frame, strap hinges, ajar with light spilling out,
//                         sign, lantern, the EFZ certificate (hotspot)
//   schreinerei/annex.js  the crooked half-timbered workshop (SCHREINEREI.annex)
//                         with its shingled roof, dormer, chimney & interior
//   schreinerei/porch.js  the lean-to porch, the Hobelbank, Jonny planing (hotspot)
//   schreinerei/deck.js   the gallery deck: dining table & tea party, record
//                         player (music toggle), record cabinet, coffee table
//   schreinerei/yard.js   lumber rack, firewood, sawhorses, wheelbarrow, the
//                         delivery snail, stepping stones, ground cover
//   schreinerei/kit.js    shared geometry helpers + per-material Batch merging
//   schreinerei/fx.js     chimney smoke, plane shavings, floating notes
//
// Static geometry of every builder lands in ONE Batch (merged per material);
// hotspot pieces are their own small groups so the interaction "boing" works.
//
// Exposes ctx.sites.schreinerei = { door, annex, porch, deck, jonny, snail,
//   togglePlaying(), get playing, anchors: { chimneyTop, lantern, sign } }.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { SCHREINEREI } from '../world/layout.js';
import { Batch, makeMats, takeHalos } from './schreinerei/kit.js';
import { buildDoor } from './schreinerei/door.js';
import { buildAnnex, ANNEX } from './schreinerei/annex.js';
import { buildPorch, BENCH } from './schreinerei/porch.js';
import { buildDeck } from './schreinerei/deck.js';
import { buildYard } from './schreinerei/yard.js';

export default async function build(ctx) {
  const mats = makeMats(ctx);
  const root = new THREE.Group();
  root.name = 'schreinerei';
  ctx.scene.add(root);
  const B = new Batch();
  const area = 'woodworking';

  const door = buildDoor(ctx, B, mats);
  const annex = buildAnnex(ctx, B, mats);
  const porch = buildPorch(ctx, B, mats, annex.shingles);
  const deck = buildDeck(ctx, B, mats);
  const yard = buildYard(ctx, B, mats);

  // ── hotspots (every one frames its piece when its entry opens) ────────────
  ctx.interactions.add(door.cert, { entryId: 'efz-certificate', area, focus: { distance: 2.4, height: 0.1 } });
  ctx.interactions.add(porch.bench, { entryId: 'workbench-wip', area, focus: { distance: 3, height: 0.5 } });
  ctx.interactions.add(deck.table, { entryId: 'dining-table', area, focus: { distance: 3.4, height: 0.5 } });
  ctx.interactions.add(deck.cabinet, { entryId: 'record-cabinet', area, focus: { distance: 2.6, height: 0.3 } });
  ctx.interactions.add(deck.coffee, { entryId: 'coffee-table', area, focus: { distance: 2.4, height: 0.3 } });
  ctx.interactions.add(deck.player, {
    entryId: 'record-player',
    area,
    focus: { distance: 2.7, height: 0.5 },
    onActivate(h) {
      // open the story AND give it a spin
      ctx.ui?.openEntry?.('record-player', { hotspot: h });
      deck.togglePlaying();
    },
  });

  // ── merge everything static: one mesh per material ───────────────────────
  // (wood keeps its many tiny non-casting parts in a separate mesh)
  B.build(root, 'schreinerei', { mergeShadow: true, keepSplit: [mats.wood('oak')] });
  annex.shingles.build(annex.group, mats.shingles());
  // every lantern, bulb and window halo of the Schreinerei in ONE additive mesh
  const halos = takeHalos();
  if (halos.length) root.add(ctx.props.glowQuads(halos, '#ffc46e', { day: 0.04, night: 0.42 }));

  // ── colliders (for anything that walks or scatters around) ───────────────
  const A = SCHREINEREI.annex, D = SCHREINEREI.deck;
  if (ctx.colliders?.addBox) {
    ctx.colliders.addBox(A.x, A.z, ANNEX.hx + 0.35, ANNEX.hz + 0.3, A.rotY, 'schreinerei-annex');
    ctx.colliders.addBox(D.x, D.z, 2.1, 1.5, D.rotY, 'schreinerei-deck');
    ctx.colliders.addBox(porch.bench.position.x, porch.bench.position.z, BENCH.length / 2 + 0.15, BENCH.depth / 2 + 0.1, porch.bench.rotation.y, 'hobelbank');
  }

  const updates = [door.update, annex.update, porch.update, deck.update, yard.update];
  ctx.sites.schreinerei = {
    door,
    annex,
    porch,
    deck,
    jonny: porch.jonny,
    snail: yard.snail,
    togglePlaying: deck.togglePlaying,
    get playing() {
      return deck.playing;
    },
    anchors: { chimneyTop: annex.anchors.chimneyTop, lantern: door.anchors.lantern, sign: door.anchors.sign },
  };
  return {
    update(dt, t) {
      for (const u of updates) u(dt, t);
    },
  };
}
