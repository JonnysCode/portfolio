// ─────────────────────────────────────────────────────────────────────────────
// The Schreinerei — Jonny's woodworking spot, the heart of the glen: a
// cabinetmaker's workshop built into the roots of the Great Oak.
//
//   schreinerei/door.js   the round-arched door in the oak (OAK.door): carved
//                         frame, strap hinges, ajar with light spilling out,
//                         sign, lantern, the EFZ certificate (hotspot)
//   schreinerei/annex.js  the crooked half-timbered workshop (SCHREINEREI.annex)
//                         with its shingled roof, dormer, chimney & interior
//   schreinerei/porch.js  the lean-to porch, the Hobelbank at working height,
//                         Jonny on his duckboard planing (hotspot), work lamp
//   schreinerei/deck.js   the gallery deck: dining table & tea party, record
//                         player (music toggle), record cabinet, coffee table
//   schreinerei/yard.js   lumber rack & stickered stack, firewood, a dovetailed
//                         chest on sawhorses, wheelbarrow, the delivery snail,
//                         stepping stones, path lanterns, ground cover
//   schreinerei/kit.js    shared geometry helpers + per-material Batch merging,
//                         tools (frame saw, hand saw, F-clamp), lantern posts
//   schreinerei/fx.js     plane shavings, floating notes, sawdust motes
//
// Static geometry of every builder lands in ONE Batch (merged per material);
// hotspot pieces are their own small groups so the interaction "boing" works.
//
// Exposes ctx.sites.schreinerei = { door, annex, porch, deck, jonny, snail,
//   togglePlaying(), get playing, anchors: { chimneyTop, lantern, sign } }.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { SCHREINEREI, SPOTS, OAK } from '../world/layout.js';
import { Batch, makeMats, takeHalos, setDetail } from './schreinerei/kit.js';
import { buildDoor, DOOR } from './schreinerei/door.js';
import { buildAnnex, ANNEX, annexToWorld } from './schreinerei/annex.js';
import { makeMotes } from './schreinerei/fx.js';
import { buildPorch, BENCH } from './schreinerei/porch.js';
import { buildDeck } from './schreinerei/deck.js';
import { buildYard } from './schreinerei/yard.js';

export default async function build(ctx) {
  // per-tier geometry detail (kit.LOD): medium & low drop tessellation and the tiniest decor
  setDetail(ctx.quality?.tier ?? 'high');
  const mats = makeMats(ctx);
  const root = new THREE.Group();
  root.name = 'schreinerei';
  ctx.scene.add(root);
  const B = new Batch();
  const area = 'woodworking';

  // (what each builder adds to the shared batch, in triangles — ctx.sites.schreinerei.cost)
  const cost = {};
  const timed = (name, fn) => {
    const t0 = B.added;
    const r = fn();
    cost[name] = Math.round(B.added - t0);
    return r;
  };
  const door = timed('door', () => buildDoor(ctx, B, mats));
  const annex = timed('annex', () => buildAnnex(ctx, B, mats));
  const porch = timed('porch', () => buildPorch(ctx, B, mats, annex.shingles));
  const deck = timed('deck', () => buildDeck(ctx, B, mats));
  const yard = timed('yard', () => buildYard(ctx, B, mats));

  // ── hotspots (every one frames its piece when its entry opens) ────────────
  // the certificate is framed straight on (the rig looks from the spot
  // camera's side; turn that into the certificate's own facing)
  const certFocus = { distance: 1.75, height: 0.08, polar: 1.42 };
  {
    const cam = SPOTS.find((s) => s.id === area)?.camera.position;
    const p = door.cert.position;
    if (cam) certFocus.azimuth = wrapAngle(door.cert.userData.yaw - Math.atan2(cam[0] - p.x, cam[2] - p.z));
  }
  ctx.interactions.add(door.cert, { entryId: 'efz-certificate', area, focus: certFocus });
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
  // (wood keeps its many tiny non-casting parts in a separate mesh). Only the
  // big structural layers cast shadows: wood, timber, stone, bark, plaster —
  // ironwork, painted bits, moss, leaves and glows never do.
  B.build(root, 'schreinerei', {
    mergeShadow: true,
    keepSplit: [mats.wood('oak')],
    noCast: [mats.metal(), mats.vc(), mats.moss(), mats.leaf(), mats.glow('#ffd79a', 0.9), mats.glow('#ffc46e', 0.4)],
  });
  annex.shingles.build(annex.group, mats.shingles());
  // small hotspot pieces only receive (the bench, the dining table, the
  // armchair and the characters keep their contact shadows)
  for (const o of [door.cert, deck.cabinet, deck.player, deck.coffee, deck.cat]) noShadow(o);
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

  // golden sawdust motes drifting in the warm light: the open workshop door,
  // under the porch work lamp and in the spill of the oak door
  const motes = makeMotes(ctx, [
    { center: annexToWorld(-0.3, 1.1, ANNEX.hz + 0.15), size: [1.5, 1.7, 1.3], count: 14 },
    { center: porch.lampPos.clone().setY(porch.lampPos.y - 0.42), size: [0.9, 0.85, 0.7], count: 10 },
    { center: new THREE.Vector3(OAK.door.x + 0.3, 0.95, DOOR.z + 0.55), size: [1.1, 1.3, 0.9], count: 10 },
  ]);
  root.add(motes.object);

  const updates = [door.update, annex.update, porch.update, deck.update, yard.update, motes.update];
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
    cost: { ...cost, ...(yard.cost ?? {}) },
  };
  return {
    update(dt, t) {
      for (const u of updates) u(dt, t);
    },
  };
}

function noShadow(obj) {
  obj?.traverse((o) => {
    if (o.isMesh) o.castShadow = false;
  });
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
