// ─────────────────────────────────────────────────────────────────────────────
// The Wohnatelier — an ochre mushroom house opened up at the front by a big
// arched loggia (folding glazed doors pushed back), revealing a beautifully
// designed little living room: warm oak floor, a Berber-ish rug, a sage
// velvet sofa with cushions and a knitted throw, a walnut lounge chair with
// ottoman (the reading nook), a tripod lamp and a paper globe pendant that
// glow, a bookcase full of books and ceramics, a joiner-made sideboard with a
// mushroom lamp, a gallery wall, a monstera and a hanging pothos.
//
// On the stone terrace outside: a designer's easel with a mood board (colour
// chips, fabric samples, sketches — hotspot 'moodboards'), a little trestle
// table with a card model and floor plan of a tiny flat (hotspot
// 'small-space') and a villager designer with a paintbrush.
// Hotspot 'living-room': the sofa (its own little group — it bounces on hover)
// with a room-sized pick volume, so the whole room is the click target.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { COTTAGE } from '../../world/layout.js';
import { createRng } from '../../core/rng.js';
import { makeMushroomHouse } from '../../props/mushroomHouse.js';
import { makePerson } from '../../props/index.js';
import {
  Batch, mats, mat4, xf, board, boardBetween, rod, stoneGeo, mossGeo, tube, taperTube, leafGeo, Cards, deform, uvBox,
  paintFn, addFlower, addFern, addGrass, addIvy, TAU, WOOD,
} from './kit.js';
import { local, hitProxy, pot, stringLights, flagstones } from './garden.js';
import { whenFontsReady, FONT_DISPLAY, FONT_HAND } from '../../props/text.js';

/** The atelier faces the 'interior' spot camera (its open front looks this way). */
/** Facing of the opened-up front (from layout.js, so the 'interior' spot camera looks straight in). */
export const ATELIER_ROT = COTTAGE.atelier.rotY ?? 0.6;

const PALETTE = {
  sage: '#7a9273',
  terracotta: '#c46a43',
  mustard: '#d6a23a',
  cream: '#efe4cf',
  navy: '#2f3e5c',
  cognac: '#8a4a2a',
  blush: '#e3b2a0',
};

/** Build the Wohnatelier into batch B. Returns { hotspots, updates, lights, colliders }. */
export function buildAtelier(ctx, B, root, halos, smoke = []) {
  const rng = createRng('wohnatelier');
  const A = COTTAGE.atelier;
  const out = { hotspots: [], updates: [], lights: [], colliders: [], keepOut: [] };
  const frame = mat4([A.x, 0, A.z], [0, ATELIER_ROT, 0]);
  /** Keep-out circle given in house-local coordinates. */
  const keepL = (lx, lz, r) => {
    const v = new THREE.Vector3(lx, 0, lz).applyMatrix4(frame);
    out.keepOut.push([v.x, v.z, r]);
  };
  const house = makeMushroomHouse({
    seed: 'wohnatelier',
    height: 7.25,
    capShape: 'bell',
    capColor: '#de9a3e',
    wartColor: '#f4e4bf',
    capRadius: 3.35,
    stemRadius: 2.45,
    stemHeight: 4.0,
    // the rim lifts over the loggia: a band of warm gills frames the open front
    capTilt: { phi: 0, slope: 0.1 },
    stem: 'plaster',
    stemColor: '#f0e0c2',
    door: false,
    lantern: false,
    chimney: 'pipe',
    dormer: true,
    ivy: 0.55,
    lean: 0.18,
    leanDir: 3.6,
    windows: [
      { phi: 1.75, y: 1.45, shape: 'arch', shutters: true, box: true, color: '#4f7a86' },
      { phi: -1.75, y: 1.45, shape: 'round', w: 0.55 },
      { phi: Math.PI + 0.2, y: 1.5, shape: 'arch', box: true },
      { phi: 2.6, y: 1.4, shape: 'rect' },
    ],
    open: { phi: 0, width: 2.9, height: 2.72, depth: 0.5 },
    detail: ctx.quality?.density ?? 1,
    batch: B,
    halos,
    smokeSources: smoke,
    frame,
  });
  root.add(house);
  const I = house.userData.interior;
  const F = B.at(frame); // house-local frame
  out.colliders.push([A.x, A.z, house.userData.radius]);
  out.keepOut.push([A.x, A.z, house.userData.radius + 0.25]);

  // the sofa is its own little group: the 'living-room' hotspot bounces it on hover
  const sofaB = new Batch();
  buildInterior(F, rng, I, halos, frame, sofaB);
  const sofaGroup = new THREE.Group();
  sofaGroup.name = 'living-room';
  for (const m of sofaB.build(sofaGroup, 'sofa')) m.castShadow = false; // deep in the cap's shade
  sofaGroup.position.set(0, I.floorY, SOFA_Z);
  house.add(sofaGroup);

  // lanterns flanking the arch & fairy lights across it
  {
    const zf = I.facadeZ;
    const lights = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * (i / 10);
      const r = I.width / 2 + 0.38;
      lights.push(new THREE.Vector3(Math.cos(a) * r, I.floorY + I.height - I.width / 2 + Math.sin(a) * r + 0.05, zf + 0.2));
    }
    stringLights(F, [lights], halos, { spacing: 0.22, sag: 0, transform: frame });
  }

  // ── terrace: flagstones in front of the loggia ──
  {
    const M = mats();
    const zf = I.facadeZ;
    const tint = ['#b3a58a', '#a89c86', '#bdae90', '#9a917f'];
    for (let ring = 0; ring < 4; ring++) {
      const r = zf + 0.35 + ring * 0.48;
      const n = 5 + ring * 2;
      for (let k = 0; k < n; k++) {
        const a = ((k + 0.5) / n - 0.5) * (Math.PI * 0.95) + rng.jitter(0.05);
        const x = Math.sin(a) * (r - zf) * 1.35, z = zf + Math.cos(a) * (r - zf);
        const sz = rng.range(0.2, 0.28);
        const st = stoneGeo(rng, { r: 1, sx: sz * 1.2, sy: 0.045, sz: sz, lump: 0.14, flatTop: 0.3, detail: 'low' });
        F.add(M.stone, xf(st, [x, 0.02, z], [0, a + rng.jitter(0.3), 0]), { color: rng.pick(tint), cast: false });
        if (rng.chance(0.4)) F.add(M.moss, xf(mossGeo(rng, { r: 0.09, h: 0.025 }), [x + rng.jitter(0.25), 0, z + rng.jitter(0.2)]), { cast: false });
      }
    }
    // potted plants and a bench by the loggia
    pot(F, rng, -I.width / 2 - 0.55, 0, zf + 0.35, 0.24);
    pot(F, rng, I.width / 2 + 0.6, 0, zf + 0.3, 0.2);
    pot(F, rng, I.width / 2 + 0.95, 0, zf + 0.55, 0.15);
    for (let i = 0; i < 14; i++) {
      const a = rng.range(-1.2, 1.2);
      const r = rng.range(2.3, 3.0);
      const x = Math.sin(a) * r * 1.2, z = zf + Math.cos(a) * r * 0.9;
      if (rng.chance(0.5)) addFlower(F, rng, x, 0, z, { size: rng.range(0.05, 0.08), stem: rng.range(0.15, 0.35) });
      else addGrass(F, rng, x, 0, z, { size: 0.3 });
    }
  }

  // a flagstone trail from the cottage path up to the terrace
  {
    const t0 = new THREE.Vector3(0.5, 0, I.facadeZ + 2.2).applyMatrix4(frame);
    flagstones(B.at(new THREE.Matrix4()), rng, [[-8.9, 7.35], [(t0.x - 8.9) / 2 + 0.3, (t0.z + 7.35) / 2], [t0.x, t0.z]], { width: 0.7, step: 0.48 });
    out.keepOut.push([-8.9, 7.35, 0.5], [(t0.x - 8.9) / 2 + 0.3, (t0.z + 7.35) / 2, 0.6], [t0.x, t0.z, 0.5]);
  }

  // ── the easel with the mood board ──
  {
    const zf = I.facadeZ;
    const m = mat4([-2.05, 0, zf + 1.45], [0, 0.42, 0]);
    const easel = makeEasel(rng);
    easel.applyMatrix4(m);
    house.add(easel);
    out.hotspots.push([easel, { entryId: 'moodboards', area: 'interior', focus: { distance: 2.7, height: 0.25 } }]);
    // the designer, side-on to the board, paintbrush raised
    const p = makePerson({ seed: 'designer-mia', hair: 'bun', hairColor: '#6b4430', shirt: '#e3b2a0', pants: '#3b4a5c', apron: true, apronColor: '#c9b79a', hat: 'none', glasses: true, holding: 'paintbrush', name: 'designer' });
    p.group.position.set(-1.3, 0, zf + 1.95);
    p.group.rotation.y = -1.85;
    p.setAction?.('work');
    house.add(p.group);
  }

  // ── the model table: card model & floor plan of a tiny flat ──
  {
    const zf = I.facadeZ;
    const m = mat4([2.05, 0, zf + 1.25], [0, -0.45, 0]);
    const table = makeModelTable(rng);
    table.applyMatrix4(m);
    house.add(table);
    out.hotspots.push([table, { entryId: 'small-space', area: 'interior', focus: { distance: 2.5, height: 0.35 } }]);
  }

  // ── the living room hotspot: the sofa + a pick volume filling the room (child of the sofa group) ──
  {
    const proxy = hitProxy(3.4, 1.8, 2.6, 'living-room-pick');
    proxy.position.set(0, 0.9, -0.6 - SOFA_Z);
    sofaGroup.add(proxy);
    out.hotspots.push([sofaGroup, { entryId: 'living-room', area: 'interior', focus: { distance: 4.4, height: 0.4 } }]);
  }

  // a warm light inside (lamps) — the room is deep in the cap's shadow
  const lp = new THREE.Vector3(0.1, I.floorY + 1.9, -0.5).applyMatrix4(frame);
  out.lights.push([lp, { color: '#ffc98a', day: 1.8, night: 3.2, distance: 6 }]);
  // terrace, easel, designer, model table, flanking pots
  const zf = I.facadeZ;
  for (const [lx, lz, r] of [[0, zf + 0.9, 1.3], [-1.2, zf + 1.3, 0.9], [1.2, zf + 1.3, 0.9], [0, zf + 2.0, 1.1], [-2.05, zf + 1.45, 0.75], [-1.3, zf + 1.95, 0.45], [2.05, zf + 1.25, 0.75], [-I.width / 2 - 0.55, zf + 0.35, 0.35], [I.width / 2 + 0.75, zf + 0.4, 0.45]]) keepL(lx, lz, r);
  out.pads = [{ cx: A.x, cz: A.z, r0: 2.55, r1: 4.5, glow: 2 }];
  out.houses = { atelier: house };
  return out;
}

// ─── interior ────────────────────────────────────────────────────────────────
/** The sofa stands against the back wall (house-local z). */
const SOFA_Z = -1.42;

function buildInterior(F, rng, I, halos, frame, sofaB) {
  const M = mats();
  const y0 = I.floorY;
  const at = (x, z, rotY = 0, y = y0) => mat4([x, y, z], [0, rotY, 0]);
  const wallPos = (phi, y, inset = 0) => {
    const r = I.radiusAt(phi, y) - inset;
    return [Math.sin(phi) * r, y, Math.cos(phi) * r];
  };
  const halo = (x, y, z, size) => {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(frame);
    halos.push({ x: v.x, y: v.y, z: v.z, size });
  };

  // rug
  rug(F, rng, at(0, -0.55), 1.4, 1.02);
  // sofa against the back wall (into its own batch, local to the sofa group's origin)
  sofa(sofaB, rng, new THREE.Matrix4(), { len: 1.95, color: PALETTE.sage });
  // coffee table
  coffeeTable(F, rng, at(0.05, -0.45, 0.3));
  // reading nook: lounge chair, ottoman, tripod lamp, side stack of books
  loungeChair(F, rng, at(-1.32, -0.35, 1.05));
  ottoman(F, rng, at(-0.82, 0.12, 1.1));
  tripodLamp(F, rng, at(-1.72, -1.05, 0.5));
  halo(-1.72, y0 + 1.45, -1.05, 0.6);
  bookStack(F, rng, at(-1.82, -0.15, 0.4), 5);
  // bookcase on the left-back wall, sideboard on the right
  {
    const phi = Math.PI + 0.78;
    const [x, , z] = wallPos(phi, 1, 0.22);
    bookcase(F, rng, at(x, z, phi + Math.PI));
  }
  {
    const phi = Math.PI - 0.95;
    const [x, , z] = wallPos(phi, 0.5, 0.26);
    sideboard(F, rng, at(x, z, phi + Math.PI), halo);
  }
  // gallery wall above the sofa
  gallery(F, rng, I, wallPos);
  // the monstera by the opening (right) and a fiddle-leaf fig (left back)
  monstera(F, rng, at(1.62, 0.35, -0.6));
  fiddleFig(F, rng, at(-1.05, -1.75, 0.3));
  // pendant paper globe & a hanging pothos
  {
    const cy = I.ceilY;
    F.add(M.vc, tube([[0.05, cy, -0.5], [0.05, cy - 0.75, -0.5]], 0.006, 3, 2), { color: '#2a2622', cast: false });
    globeLamp(F, at(0.05, -0.5, 0, cy - 1.0), 0.27);
    halo(0.05, cy - 1.0, -0.5, 0.7);
    hangingPlant(F, rng, at(1.05, -1.25, 0, cy), cy - y0);
  }
  // a little window seat feel: cushions & a basket of throws by the sofa
  basket(F, rng, at(1.22, -1.15, 0.4));
}

// ─── furniture ───────────────────────────────────────────────────────────────
/** A puffy cushion (rounded box with domed faces) — fabric UVs in world units. */
function cushion(w, h, d, r = 0.035, puff = 0.18) {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, h * 0.45, w * 0.3, d * 0.3));
  deform(g, (v) => {
    const kx = Math.max(0, 1 - (v.x / (w / 2)) ** 2);
    const kz = Math.max(0, 1 - (v.z / (d / 2)) ** 2);
    v.y *= 1 + puff * kx * kz;
  });
  return uvBox(g, 'x', 2.6);
}

function sofa(F, rng, m, { len = 1.9, depth = 0.82, color }) {
  const M = mats();
  const L = local(F, m);
  const seatY = 0.42;
  // tapered walnut legs, a slim walnut plinth
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (len / 2 - 0.12), z = sz * (depth / 2 - 0.1);
      L.add(M.wood, taperTube([[x, 0.17, z], [x + sx * 0.03, 0, z + sz * 0.03]], 0.025, 0.014, 6, 2), { color: WOOD.walnut, cast: false });
    }
  }
  L.add(M.wood, board(len, 0.06, depth - 0.06, { along: 'x', rng }).translate(0, 0.19, 0), { color: WOOD.walnut });
  // upholstered body
  L.add(M.fabric, cushion(len, 0.12, depth, 0.03, 0.05).translate(0, 0.27, 0), { color });
  // arms
  for (const s of [-1, 1]) L.add(M.fabric, cushion(0.16, 0.36, depth, 0.06, 0.08).translate(s * (len / 2 - 0.08), 0.42, 0), { color });
  // seat cushions
  const n = 3;
  const cw = (len - 0.32) / n;
  for (let i = 0; i < n; i++) {
    const c = cushion(cw - 0.012, 0.14, depth - 0.24, 0.05, 0.22);
    L.add(M.fabric, c.translate(-len / 2 + 0.16 + cw * (i + 0.5), seatY - 0.02, 0.09), { color: shadeHex(color, rng.range(-0.03, 0.03)) });
  }
  // back: a frame + leaning back cushions
  L.add(M.fabric, cushion(len - 0.04, 0.42, 0.16, 0.05, 0.05).translate(0, 0.53, -depth / 2 + 0.08), { color });
  for (let i = 0; i < n; i++) {
    const c = cushion(cw - 0.02, 0.4, 0.15, 0.06, 0.25);
    c.rotateX(-0.2);
    L.add(M.fabric, c.translate(-len / 2 + 0.16 + cw * (i + 0.5), 0.66, -depth / 2 + 0.2), { color: shadeHex(color, 0.03) });
  }
  // throw pillows
  const pillows = [
    [-len / 2 + 0.3, PALETTE.terracotta, 0.45],
    [-len / 2 + 0.52, PALETTE.mustard, 0.25],
    [len / 2 - 0.32, PALETTE.cream, -0.4],
  ];
  for (const [x, c, rot] of pillows) {
    const p = cushion(0.34, 0.32, 0.11, 0.05, 0.35);
    p.rotateX(-0.25);
    p.rotateZ(rot * 0.3);
    p.rotateY(rot * 0.4);
    L.add(M.fabric, p.translate(x, 0.66, -depth / 2 + 0.33), { color: c });
  }
  // knitted throw draped over the right arm
  const th = new THREE.BoxGeometry(0.42, 0.025, 0.7, 6, 1, 4);
  deform(th, (v) => {
    const t = (v.x + 0.21) / 0.42;
    v.y += Math.sin(t * Math.PI) * 0.16 - (t > 0.6 ? (t - 0.6) * 0.5 : 0);
    v.y += Math.sin(v.z * 22) * 0.01;
  });
  L.add(M.fabric, uvBox(th, 'x', 4).translate(len / 2 - 0.1, 0.5, 0.05), { color: '#e8dcc6', cast: false });
}

function loungeChair(F, rng, m) {
  const M = mats();
  const L = local(F, m);
  // five-star base with a column
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    L.add(M.metal, boardBetween([0, 0.1, 0], [Math.sin(a) * 0.36, 0.03, Math.cos(a) * 0.36], 0.05, 0.035), { color: '#7d7f80', cast: false });
  }
  L.add(M.metal, new THREE.CylinderGeometry(0.04, 0.05, 0.16, 8).translate(0, 0.16, 0), { color: '#6c6e70', cast: false });
  // seat shell + cushion
  const shell = new THREE.BoxGeometry(0.74, 0.05, 0.66, 6, 1, 6);
  deform(shell, (v) => {
    v.y += (v.x / 0.37) ** 2 * 0.07 + Math.max(0, -v.z) * 0.08;
  });
  L.add(M.wood, uvBox(shell, 'x').translate(0, 0.27, 0.02), { color: WOOD.walnut });
  L.add(M.fabric, cushion(0.6, 0.11, 0.58, 0.05, 0.25).translate(0, 0.35, 0.04), { color: PALETTE.cognac });
  // back shell (two panels) leaning back
  const back = new THREE.Matrix4().makeRotationX(-0.42).setPosition(0, 0.36, -0.3);
  const BL = local(L, back);
  for (const [y, h] of [[0.22, 0.4], [0.62, 0.34]]) {
    const sh = new THREE.BoxGeometry(0.72, h, 0.05, 6, 2, 1);
    deform(sh, (v) => {
      v.z -= (v.x / 0.36) ** 2 * 0.08;
    });
    BL.add(M.wood, uvBox(sh, 'x').translate(0, y, -0.03), { color: WOOD.walnut });
    BL.add(M.fabric, cushion(0.58, h - 0.06, 0.1, 0.05, 0.12).rotateX(Math.PI / 2).rotateX(-Math.PI / 2).translate(0, y, 0.04), { color: PALETTE.cognac });
  }
  // armrests
  for (const s of [-1, 1]) {
    L.add(M.wood, boardBetween([s * 0.36, 0.5, 0.25], [s * 0.38, 0.6, -0.28], 0.06, 0.04), { color: WOOD.walnut, cast: false });
    L.add(M.fabric, cushion(0.1, 0.05, 0.4, 0.02, 0.2).translate(s * 0.37, 0.56, -0.02), { color: PALETTE.cognac });
  }
}

function ottoman(F, rng, m) {
  const M = mats();
  const L = local(F, m);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    L.add(M.metal, boardBetween([0, 0.1, 0], [Math.sin(a) * 0.26, 0.02, Math.cos(a) * 0.26], 0.04, 0.03), { color: '#7d7f80', cast: false });
  }
  L.add(M.wood, uvBox(new THREE.BoxGeometry(0.56, 0.05, 0.46), 'x').translate(0, 0.17, 0), { color: WOOD.walnut });
  L.add(M.fabric, cushion(0.52, 0.1, 0.42, 0.05, 0.25).translate(0, 0.25, 0), { color: PALETTE.cognac });
}

function coffeeTable(F, rng, m) {
  const M = mats();
  const L = local(F, m);
  const top = new THREE.CylinderGeometry(0.46, 0.45, 0.04, 28);
  L.add(M.wood, uvBox(top, 'x').translate(0, 0.38, 0), { color: WOOD.walnut });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.3;
    L.add(M.wood, taperTube([[Math.sin(a) * 0.27, 0.37, Math.cos(a) * 0.27], [Math.sin(a) * 0.36, 0, Math.cos(a) * 0.36]], 0.03, 0.016, 6, 2), { color: WOOD.walnut, cast: false });
  }
  // books, a vase with dried grasses, a candle, a little bowl
  bookStack(F, rng, m.clone().multiply(mat4([-0.18, 0.4, 0.08], [0, 0.4, 0])), 3, 0.24);
  vase(L, [0.17, 0.4, -0.08], 0.09, 0.26, '#e9e2d4');
  for (let i = 0; i < 7; i++) {
    const a = rng.next() * TAU;
    const tip = [0.17 + Math.sin(a) * 0.14, 0.4 + 0.5 + rng.range(0, 0.2), -0.08 + Math.cos(a) * 0.14];
    L.add(M.vc, tube([[0.17, 0.55, -0.08], [(0.17 + tip[0]) / 2, 0.75, (tip[2] - 0.08) / 2], tip], 0.004, 3, 6), { color: '#b49a6a', cast: false });
    L.add(M.vc, new THREE.SphereGeometry(0.03, 5, 4).scale(0.6, 1.6, 0.6).translate(...tip), { color: '#d9c7a0', cast: false });
  }
  L.add(M.clay, new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10).translate(0.02, 0.44, 0.22), { color: '#efe4cf', cast: false });
  L.add(M.lamp, new THREE.SphereGeometry(0.012, 5, 4).scale(1, 1.6, 1).translate(0.02, 0.5, 0.22), { cast: false });
  const bowl = new THREE.SphereGeometry(0.08, 12, 5, 0, TAU, Math.PI / 2, Math.PI / 2);
  L.add(M.clay, bowl.translate(-0.16, 0.47, -0.2), { color: '#2f3e5c', cast: false });
}

function vase(L, [x, y, z], r, h, color) {
  const M = mats();
  const prof = [[0, 0], [r * 0.7, 0], [r * 0.95, h * 0.2], [r, h * 0.45], [r * 0.6, h * 0.8], [r * 0.45, h * 0.92], [r * 0.55, h], [r * 0.45, h * 0.98]].map(([a, b]) => new THREE.Vector2(a, b));
  const g = new THREE.LatheGeometry(prof, 14);
  L.add(M.glossy, g.translate(x, y, z), { color, cast: false });
}

function bookStack(F, rng, m, n = 4, w = 0.26) {
  const M = mats();
  const L = local(F, m);
  const colors = ['#7a3b2e', '#2f3e5c', '#c9a44a', '#5d7a5f', '#e6d9c2', '#8a4a2a', '#3e3a36'];
  let y = 0;
  for (let i = 0; i < n; i++) {
    const h = rng.range(0.03, 0.05);
    const bw = w * rng.range(0.8, 1.05), bd = w * rng.range(0.65, 0.8);
    const b = new THREE.BoxGeometry(bw, h, bd);
    b.rotateY(rng.jitter(0.25));
    L.add(M.paper, b.translate(rng.jitter(0.02), y + h / 2, rng.jitter(0.02)), { color: rng.pick(colors), cast: false });
    // page block (cream) peeking out
    L.add(M.paper, new THREE.BoxGeometry(bw * 0.96, h * 0.8, bd * 0.98).translate(0.008, y + h / 2, 0), { color: '#f2ead8', cast: false });
    y += h;
  }
}

function tripodLamp(F, rng, m) {
  const M = mats();
  const L = local(F, m);
  const joint = [0, 1.15, 0];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    L.add(M.wood, taperTube([[Math.sin(a) * 0.32, 0, Math.cos(a) * 0.32], joint], 0.018, 0.012, 5, 2), { color: WOOD.oakLight, cast: false });
  }
  L.add(M.metal, new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6).translate(0, 1.3, 0), { color: '#b38b45', cast: false });
  const shade = new THREE.CylinderGeometry(0.25, 0.27, 0.32, 20, 1, false);
  L.add(M.lamp, shade.translate(0, 1.47, 0), { cast: false });
  L.add(M.metal, new THREE.TorusGeometry(0.25, 0.008, 4, 20).rotateX(Math.PI / 2).translate(0, 1.63, 0), { color: '#b38b45', cast: false });
}

function globeLamp(F, m, r) {
  const M = mats();
  const L = local(F, m);
  const g = new THREE.SphereGeometry(r, 18, 12);
  // paper ribs
  deform(g, (v) => {
    const k = 1 + 0.025 * Math.cos(Math.asin(Math.max(-1, Math.min(1, v.y / r))) * 16);
    v.x *= k;
    v.z *= k;
  });
  L.add(M.lamp, g, { cast: false });
  L.add(M.metal, new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8).translate(0, r + 0.01, 0), { color: '#2a2622', cast: false });
}

function bookcase(F, rng, m) {
  const M = mats();
  const L = local(F, m);
  const w = 0.95, h = 2.05, d = 0.3;
  const wood = WOOD.oak;
  for (const s of [-1, 1]) L.add(M.wood, board(0.03, h, d, { along: 'y', rng }).translate((s * w) / 2, h / 2, 0), { color: wood });
  L.add(M.wood, board(w, h, 0.015, { along: 'y', rng }).translate(0, h / 2, -d / 2 + 0.01), { color: shadeHex(wood, -0.08), cast: false });
  const shelves = 6;
  const colors = ['#7a3b2e', '#2f3e5c', '#c9a44a', '#5d7a5f', '#e6d9c2', '#8a4a2a', '#3e3a36', '#b8573a', '#6f8a99', '#d8c4a0'];
  for (let i = 0; i < shelves; i++) {
    const y = 0.06 + (i * (h - 0.1)) / (shelves - 1);
    L.add(M.wood, board(w - 0.03, 0.025, d - 0.01, { along: 'x', rng }).translate(0, y, 0), { color: wood, cast: false });
    if (i === shelves - 1) break;
    const space = (h - 0.1) / (shelves - 1) - 0.03;
    // books with gaps for ceramics & a plant
    let x = -w / 2 + 0.03;
    const deco = rng.int(0, 2);
    while (x < w / 2 - 0.06) {
      if (deco && rng.chance(0.08) && x < w / 2 - 0.25) {
        // a little vase / bowl / plant
        const kind = rng.int(0, 2);
        if (kind === 0) vase(L, [x + 0.08, y + 0.012, 0.02], 0.05, 0.18, rng.pick(['#e9e2d4', '#c46a43', '#6e8a6a']));
        else if (kind === 1) {
          L.add(M.clay, new THREE.CylinderGeometry(0.05, 0.04, 0.07, 10).translate(x + 0.08, y + 0.05, 0.02), { color: '#e9e2d4', cast: false });
          addFern(L, rng, x + 0.08, y + 0.09, 0.02, { size: 0.16, fronds: 5 });
        } else {
          const bowl = new THREE.SphereGeometry(0.07, 10, 4, 0, TAU, Math.PI / 2, Math.PI / 2);
          L.add(M.glossy, bowl.translate(x + 0.08, y + 0.08, 0.02), { color: '#2f3e5c', cast: false });
        }
        x += 0.18;
        continue;
      }
      const bw = rng.range(0.025, 0.055);
      const bh = Math.min(space - 0.02, rng.range(0.17, 0.27));
      const lean = rng.chance(0.08) ? rng.range(0.1, 0.25) : 0;
      const b = new THREE.BoxGeometry(bw, bh, rng.range(0.16, 0.22));
      b.translate(0, bh / 2, 0);
      b.rotateZ(-lean);
      L.add(M.paper, b.translate(x + bw / 2 + lean * bh * 0.5, y + 0.012, 0.01), { color: rng.pick(colors), cast: false });
      x += bw + 0.004 + lean * bh;
    }
  }
}

function sideboard(F, rng, m, halo) {
  const M = mats();
  const L = local(F, m);
  const w = 1.35, h = 0.58, d = 0.42, legH = 0.18;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.add(M.wood, taperTube([[sx * (w / 2 - 0.08), legH, sz * (d / 2 - 0.07)], [sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05)]], 0.022, 0.013, 6, 2), { color: WOOD.walnut, cast: false });
  L.add(M.wood, board(w, 0.03, d, { along: 'x', rng }).translate(0, legH + h, 0), { color: WOOD.walnut });
  L.add(M.wood, board(w, 0.025, d, { along: 'x', rng }).translate(0, legH + 0.012, 0), { color: WOOD.walnut, cast: false });
  for (const s of [-1, 1]) L.add(M.wood, board(0.025, h, d, { along: 'y', rng }).translate((s * w) / 2, legH + h / 2, 0), { color: WOOD.walnut, cast: false });
  L.add(M.wood, board(w, h, 0.015, { along: 'x' }).translate(0, legH + h / 2, -d / 2 + 0.01), { color: WOOD.walnut, cast: false });
  // three doors of vertical oak slats with brass knobs
  const dw = (w - 0.06) / 3;
  for (let i = 0; i < 3; i++) {
    const cx = -w / 2 + 0.03 + dw * (i + 0.5);
    const ns = 7;
    for (let k = 0; k < ns; k++) L.add(M.wood, board(dw / ns - 0.006, h - 0.04, 0.02, { along: 'y', rng }).translate(cx - dw / 2 + (dw / ns) * (k + 0.5), legH + h / 2, d / 2 - 0.01), { color: WOOD.oakLight, cast: false });
    L.add(M.metal, new THREE.SphereGeometry(0.016, 6, 4).translate(cx + dw * 0.35, legH + h * 0.6, d / 2 + 0.012), { color: '#b38b45', cast: false });
  }
  const top = legH + h + 0.015;
  // mushroom lamp (glowing dome on a slim stem)
  L.add(M.clay, new THREE.CylinderGeometry(0.02, 0.07, 0.3, 12).translate(-0.42, top + 0.15, 0), { color: '#efe4cf', cast: false });
  const dome = new THREE.SphereGeometry(0.19, 18, 8, 0, TAU, 0, Math.PI / 2).scale(1, 0.7, 1);
  L.add(M.lamp, dome.translate(-0.42, top + 0.29, 0), { cast: false });
  const hp = new THREE.Vector3(-0.42, top + 0.3, 0).applyMatrix4(m);
  void hp;
  // vases, art books, a small plant
  vase(L, [0.05, top, -0.04], 0.08, 0.3, PALETTE.terracotta);
  vase(L, [0.22, top, 0.02], 0.06, 0.2, '#e9e2d4');
  bookStack(F, rng, m.clone().multiply(mat4([0.48, top, 0.02], [0, 0.2, 0])), 3, 0.3);
  L.add(M.clay, new THREE.CylinderGeometry(0.06, 0.05, 0.1, 10).translate(0.5, top + 0.18, 0.02), { color: '#6e8a6a', cast: false });
  addFern(L, rng, 0.5, top + 0.23, 0.02, { size: 0.25, fronds: 6 });
  // two framed prints above
  frameArt(L, [-0.25, legH + h + 0.75, -d / 2 + 0.02], 0.42, 0.55, 'botanical', rng);
  frameArt(L, [0.32, legH + h + 0.65, -d / 2 + 0.02], 0.36, 0.36, 'circle', rng);
}

/** A framed artwork facing +Z at p: kinds 'abstract' | 'botanical' | 'circle' | 'mirror'. */
function frameArt(L, p, w, h, kind, rng) {
  const M = mats();
  const fw = 0.03;
  const [x, y, z] = p;
  for (const s of [-1, 1]) {
    L.add(M.wood, board(fw, h + fw * 2, 0.035, { along: 'y' }).translate(x + s * (w / 2 + fw / 2), y, z + 0.017), { color: WOOD.oakLight, cast: false });
    L.add(M.wood, board(w + fw * 2, fw, 0.035, { along: 'x' }).translate(x, y + s * (h / 2 + fw / 2), z + 0.017), { color: WOOD.oakLight, cast: false });
  }
  const bg = new THREE.PlaneGeometry(w, h).translate(x, y, z + 0.006);
  L.add(M.paper, bg, { color: '#efe6d3', cast: false });
  const shape = (s, color, dz = 0.008) => L.add(M.vc, new THREE.ShapeGeometry(s, 10).translate(x, y, z + dz), { color, cast: false });
  if (kind === 'abstract') {
    const arch = new THREE.Shape();
    arch.moveTo(-w * 0.32, -h * 0.4);
    arch.lineTo(w * 0.02, -h * 0.4);
    arch.lineTo(w * 0.02, h * 0.02);
    arch.absarc(-w * 0.15, h * 0.02, w * 0.17, 0, Math.PI, false);
    arch.lineTo(-w * 0.32, -h * 0.4);
    shape(arch, PALETTE.terracotta);
    const c = new THREE.Shape();
    c.absarc(w * 0.22, h * 0.15, h * 0.17, 0, TAU, false);
    shape(c, PALETTE.sage);
    const moon = new THREE.Shape();
    moon.absarc(w * 0.2, -h * 0.28, h * 0.12, 0, Math.PI, false);
    moon.lineTo(w * 0.2 - h * 0.12, -h * 0.28);
    shape(moon, PALETTE.navy);
    const dot = new THREE.Shape();
    dot.absarc(-w * 0.05, h * 0.3, h * 0.05, 0, TAU, false);
    shape(dot, PALETTE.mustard, 0.01);
  } else if (kind === 'botanical') {
    for (let i = 0; i < 7; i++) {
      const lf = new THREE.Shape();
      const a = -0.9 + (i / 6) * 1.8;
      const lx = Math.sin(a) * w * 0.25, ly = -h * 0.3 + Math.cos(a) * h * 0.45;
      lf.moveTo(0, -h * 0.35);
      lf.quadraticCurveTo(lx * 0.4 - 0.03, ly * 0.5, lx, ly);
      lf.quadraticCurveTo(lx * 0.4 + 0.03, ly * 0.5, 0, -h * 0.35);
      shape(lf, i % 2 ? '#4e6b3c' : '#6e8a5a');
    }
  } else if (kind === 'circle') {
    for (let k = 0; k < 3; k++) {
      const c = new THREE.Shape();
      c.absarc(0, 0, w * (0.36 - k * 0.1), 0, TAU, false);
      shape(c, [PALETTE.mustard, PALETTE.terracotta, PALETTE.cream][k], 0.007 + k * 0.001);
    }
  }
  void rng;
}

function gallery(F, rng, I, wallPos) {
  const art = [
    { phi: Math.PI, y: 1.72, w: 0.86, h: 0.62, kind: 'abstract' },
    { phi: Math.PI - 0.42, y: 1.62, w: 0.34, h: 0.46, kind: 'botanical' },
    { phi: Math.PI + 0.42, y: 1.78, w: 0.32, h: 0.32, kind: 'circle' },
  ];
  for (const a of art) {
    const [x, , z] = wallPos(a.phi, a.y, 0.02);
    const m = mat4([x, I.floorY + a.y, z], [0, a.phi + Math.PI, 0]);
    frameArt(local(F, m), [0, 0, 0], a.w, a.h, a.kind, rng);
  }
  // round mirror with a brass frame
  {
    const phi = Math.PI + 0.5;
    const [x, , z] = wallPos(phi, 1.25, 0.03);
    const m = mat4([x, I.floorY + 1.25, z], [0, phi + Math.PI, 0]);
    const L = local(F, m);
    const M = mats();
    L.add(M.metal, new THREE.TorusGeometry(0.2, 0.018, 6, 28).translate(0, 0, 0.02), { color: '#b38b45', cast: false });
    L.add(M.metal, new THREE.CircleGeometry(0.2, 28).translate(0, 0, 0.015), { color: '#d5dcdc', cast: false });
  }
}

function rug(F, rng, m, rx, rz) {
  const M = mats();
  const cream = new THREE.Color('#e9dfcc'), terra = new THREE.Color('#b85c3c'), char = new THREE.Color('#3e3a36'), sand = new THREE.Color('#d8c6a2');
  const sage = new THREE.Color('#8fa286');
  const colorAt = (r, a, c) => {
    c.copy(cream);
    if (r > 0.95) c.copy(char);
    else if (r > 0.88) c.copy(terra);
    else if (r > 0.76 && r < 0.84) c.copy(Math.sin(a * 22 + (r - 0.8) * 60) > 0 ? sand : terra);
    else if (r > 0.6 && r < 0.64) c.copy(char);
    else if (r > 0.42 && r < 0.48) c.copy(sage);
    else if (r < 0.22) c.copy(Math.abs(Math.sin(a * 4)) * (0.22 - r) > 0.06 ? terra : sand);
    return c.multiplyScalar(0.95 + 0.05 * Math.sin(r * 90));
  };
  // one ring of quads per woven band (rings only where the pattern changes → crisp bands, few triangles)
  const edges = [0, 0.07, 0.14, 0.22, 0.42, 0.48, 0.6, 0.64, 0.76, 0.78, 0.8, 0.82, 0.84, 0.88, 0.95, 1.0];
  const segs = 96;
  const pos = [], col = [], idx = [];
  const c = new THREE.Color();
  for (let b = 0; b < edges.length - 1; b++) {
    const r0 = edges[b], r1 = edges[b + 1];
    const base = pos.length / 3;
    for (const [r, rs] of [[r0, r0 + 0.002], [r1, r1 - 0.002]]) {
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * TAU;
        pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
        colorAt(rs, Math.atan2(Math.sin(a), Math.cos(a)), c);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < segs; i++) {
      const a0 = base + i, a1 = a0 + 1, o0 = base + segs + 1 + i, o1 = o0 + 1;
      idx.push(a0, o0, o1, a0, o1, a1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.scale(rx, 1, rz);
  g.computeVertexNormals();
  uvBox(g, 'x', 3);
  void rng;
  F.add(M.fabric, g.applyMatrix4(m).translate(0, 0.012, 0), { color: null, cast: false });
}

function monstera(F, rng, m) {
  const M = mats();
  const L = local(F, m);
  const prof = [[0, 0], [0.2, 0], [0.24, 0.05], [0.25, 0.42], [0.27, 0.44], [0.24, 0.44]].map(([a, b]) => new THREE.Vector2(a, b));
  L.add(M.glossy, new THREE.LatheGeometry(prof, 16), { color: '#ece6da', cast: false });
  L.add(M.soil, new THREE.CircleGeometry(0.235, 12).rotateX(-Math.PI / 2).translate(0, 0.42, 0), { cast: false });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + rng.jitter(0.3);
    const lean = rng.range(0.35, 0.8);
    const len = rng.range(0.6, 1.0);
    const tip = [Math.sin(a) * Math.sin(lean) * len, 0.42 + Math.cos(lean) * len, Math.cos(a) * Math.sin(lean) * len];
    L.add(M.vc, tube([[0, 0.42, 0], [tip[0] * 0.5, 0.42 + (tip[1] - 0.42) * 0.7, tip[2] * 0.5], tip], 0.01, 4, 6), { color: '#4f6b32', cast: false });
    const lf = leafGeo(rng.range(0.42, 0.55), 1.0, 0.35, 5);
    lf.rotateX(-0.9 - rng.range(0, 0.6));
    lf.rotateY(a);
    L.add(M.leafy, lf.translate(...tip), { color: rng.pick(['#3f6a2c', '#4a7a33', '#36602a']), cast: false });
  }
}

function fiddleFig(F, rng, m) {
  const M = mats();
  const L = local(F, m);
  L.add(M.clay, new THREE.CylinderGeometry(0.2, 0.16, 0.36, 14).translate(0, 0.18, 0), { color: '#b5633e', cast: false });
  const trunk = [[0, 0.3, 0], [0.03, 0.9, 0.02], [-0.02, 1.4, 0], [0.02, 1.75, 0.01]];
  L.add(M.wood, taperTube(trunk, 0.03, 0.015, 5, 8), { color: '#6b5440', cast: false });
  for (let i = 0; i < 16; i++) {
    const t = rng.range(0.25, 1);
    const y = 0.8 + t * 1.0;
    const a = rng.next() * TAU;
    const lf = leafGeo(rng.range(0.24, 0.32), 0.8, 0.3, 3);
    lf.rotateX(-1.0 - rng.jitter(0.4));
    lf.rotateY(a);
    L.add(M.leafy, lf.translate(Math.sin(a) * 0.04, y, Math.cos(a) * 0.04), { color: rng.pick(['#3a5e28', '#46702f']), cast: false });
  }
}

function hangingPlant(F, rng, m, ceilH) {
  const M = mats();
  const L = local(F, m);
  const potY = -0.85;
  // macramé cords
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    L.add(M.vc, tube([[0, 0, 0], [Math.sin(a) * 0.08, potY + 0.35, Math.cos(a) * 0.08], [Math.sin(a) * 0.15, potY + 0.1, Math.cos(a) * 0.15], [0, potY - 0.12, 0]], 0.006, 3, 10), { color: '#e6d9c2', cast: false });
  }
  L.add(M.clay, new THREE.SphereGeometry(0.15, 14, 8, 0, TAU, Math.PI * 0.35, Math.PI * 0.65).translate(0, potY + 0.06, 0), { color: '#e9e2d4', cast: false });
  const cards = new Cards();
  const FF = { add: (mat, geo, opts) => L.add(mat, geo, opts) };
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    addIvy(FF, rng, [Math.sin(a) * 0.12, potY + 0.12, Math.cos(a) * 0.12], [Math.sin(a) * 0.4, -1, Math.cos(a) * 0.4], { length: rng.range(0.4, Math.min(1.0, ceilH - 1.2)), droop: 1.2, size: 0.17, density: 1.8, normal: [Math.sin(a), 0, Math.cos(a)], cards, stemColor: '#4f6b32' });
  }
  L.add(M.ivy, cards.geometry(), { cast: false });
}

function basket(F, rng, m) {
  const M = mats();
  const L = local(F, m);
  const g = new THREE.CylinderGeometry(0.2, 0.17, 0.32, 16, 4, true);
  deform(g, (v) => {
    const a = Math.atan2(v.x, v.z);
    const k = 1 + 0.03 * Math.sin(a * 18 + v.y * 40);
    v.x *= k;
    v.z *= k;
  });
  L.add(M.wood, uvBox(g, 'y', 3).translate(0, 0.16, 0), { color: '#b8955e', cast: false });
  L.add(M.fabric, cushion(0.34, 0.12, 0.3, 0.05, 0.4).rotateZ(0.3).translate(0.0, 0.33, 0), { color: PALETTE.blush, cast: false });
  L.add(M.fabric, cushion(0.3, 0.1, 0.26, 0.05, 0.4).rotateZ(-0.4).translate(0.02, 0.4, 0.04), { color: '#e8dcc6', cast: false });
}

// ─── easel & mood board ──────────────────────────────────────────────────────
function makeEasel(rng) {
  const M = mats();
  const B = new Batch();
  const g = new THREE.Group();
  g.name = 'moodboard-easel';
  const wood = WOOD.oakLight;
  // A-frame: two front legs, one back leg, a cross bar and the ledge
  B.add(M.wood, boardBetween([-0.42, 0, 0.12], [-0.06, 1.95, 0], 0.045, 0.03, { rng }), { color: wood });
  B.add(M.wood, boardBetween([0.42, 0, 0.12], [0.06, 1.95, 0], 0.045, 0.03, { rng }), { color: wood });
  B.add(M.wood, boardBetween([0, 0, -0.62], [0, 1.85, -0.04], 0.04, 0.03, { rng }), { color: wood });
  B.add(M.wood, board(0.75, 0.035, 0.03, { along: 'x', rng }).translate(0, 0.62, 0.09), { color: wood, cast: false });
  B.add(M.wood, board(1.06, 0.03, 0.1, { along: 'x', rng }).translate(0, 0.78, 0.12), { color: wood });
  B.add(M.wood, board(0.98, 0.035, 0.03, { along: 'x', rng }).translate(0, 0.86, 0.15), { color: wood, cast: false });
  // top clamp
  B.add(M.wood, board(0.16, 0.06, 0.06, { along: 'x' }).translate(0, 1.6, 0.06), { color: wood, cast: false });
  // the board (cork, with the pinned mood board printed on its face)
  const bw = 1.0, bh = 0.78;
  const by = 0.79 + bh / 2 + 0.02;
  B.add(M.wood, board(bw + 0.05, bh + 0.05, 0.03, { along: 'x' }).translate(0, by, 0.1), { color: WOOD.walnut });
  const tex = moodboardTexture();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, name: 'moodboard' }));
  face.position.set(0, by, 0.118);
  face.rotation.x = -0.0;
  face.receiveShadow = true;
  g.add(face);
  // a few real fabric swatches & paint chips hanging off the ledge, brushes in a jar
  const B2 = B;
  const sw = ['#6e8a6a', '#c46a43', '#d6a23a', '#e3b2a0', '#2f3e5c'];
  sw.forEach((c, i) => {
    const s = new THREE.BoxGeometry(0.12, 0.16, 0.006, 1, 3, 1);
    deform(s, (v) => {
      v.z += Math.sin((v.y + 0.08) * 12) * 0.006;
    });
    B2.add(M.wood, uvBox(s, 'y', 6).translate(-0.4 + i * 0.13, 0.7, 0.18 + (i % 2) * 0.004), { color: c, cast: false });
  });
  B2.add(M.wood, new THREE.CylinderGeometry(0.05, 0.045, 0.12, 10, 1, false).translate(0.38, 0.86, 0.13), { color: '#b5633e', cast: false });
  for (let i = 0; i < 4; i++) {
    const x = 0.36 + (i % 2) * 0.03, z = 0.12 + Math.floor(i / 2) * 0.03;
    B2.add(M.wood, rod([x, 0.82, z], [x + rng.jitter(0.05), 1.05, z + rng.jitter(0.03)], 0.007, 0.006, 4), { color: rng.pick(['#c9352a', '#2f3e5c', '#d6a23a', WOOD.oak]), cast: false });
  }
  B.build(g, 'easel', { mergeShadow: true });
  return g;
}

/**
 * A canvas texture drawn by draw(g, w, h). The lettering uses the web fonts
 * main.js loads before the world builds ('Fredoka', 'Patrick Hand' — exact
 * family names); should one not be ready yet, the texture is redrawn as soon
 * as it is (draw must be deterministic: seed its own rng).
 */
function canvasTex(w, h, draw, fonts = [], sample = '') {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (fonts.length)
    whenFontsReady(fonts, sample, () => {
      g.clearRect(0, 0, w, h);
      draw(g, w, h);
      t.needsUpdate = true;
    });
  return t;
}

/** Hand-written notes (Patrick Hand ships one weight: 400) and Fredoka titles. */
const HAND = FONT_HAND;
const TITLE = FONT_DISPLAY;
const NOTE_FONTS = ['400 26px "Patrick Hand"', '600 44px "Fredoka"'];

function moodboardTexture() {
  return canvasTex(1024, 800, (g, W, H) => {
    const rng = createRng('wohnatelier-moodboard');
    // cork
    g.fillStyle = '#b98c5a';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(${90 + rng.next() * 80},${60 + rng.next() * 50},${30 + rng.next() * 30},${0.25 + rng.next() * 0.3})`;
      g.fillRect(rng.next() * W, rng.next() * H, 2 + rng.next() * 3, 2 + rng.next() * 3);
    }
    const shadow = (fn) => {
      g.save();
      g.shadowColor = 'rgba(40,25,10,0.45)';
      g.shadowBlur = 10;
      g.shadowOffsetX = 4;
      g.shadowOffsetY = 6;
      fn();
      g.restore();
    };
    const pin = (x, y, c) => {
      g.fillStyle = c;
      g.beginPath();
      g.arc(x, y, 9, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.beginPath();
      g.arc(x - 3, y - 3, 3, 0, TAU);
      g.fill();
    };
    const tape = (x, y, w, h, rot, c) => {
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      g.fillStyle = c;
      g.globalAlpha = 0.8;
      g.fillRect(-w / 2, -h / 2, w, h);
      g.restore();
    };
    // title card
    shadow(() => {
      g.fillStyle = '#f7f1e3';
      g.fillRect(40, 30, 420, 92);
    });
    g.fillStyle = '#3b2a1e';
    g.font = `600 44px ${TITLE}`;
    g.fillText('Wohnatelier', 62, 78);
    g.font = `400 26px ${HAND}`;
    g.fillStyle = '#6b5440';
    g.fillText('warm · calm · crafted', 64, 110);
    tape(250, 30, 110, 26, -0.08, '#d6a23a');
    // colour chips
    const chips = [['#6e8a6a', 'Sage'], ['#c46a43', 'Terracotta'], ['#d6a23a', 'Ochre'], ['#efe4cf', 'Linen'], ['#2f3e5c', 'Ink'], ['#8a4a2a', 'Cognac']];
    chips.forEach(([c, name], i) => {
      const x = 40 + i * 78, y = 160;
      shadow(() => {
        g.fillStyle = '#fbf8f0';
        g.fillRect(x, y, 70, 120);
      });
      g.fillStyle = c;
      g.fillRect(x + 6, y + 6, 58, 78);
      g.fillStyle = '#5a4a3a';
      g.font = `400 16px ${HAND}`;
      g.fillText(name, x + 8, y + 108);
    });
    // fabric swatches: linen, bouclé, velvet, herringbone
    const fabrics = [
      [520, 40, '#d8ccb4', 'linen'],
      [680, 60, '#efe9dc', 'boucle'],
      [840, 40, '#6e8a6a', 'velvet'],
      [560, 210, '#a8875f', 'herringbone'],
    ];
    for (const [x, y, c, kind] of fabrics) {
      shadow(() => {
        g.fillStyle = c;
        g.fillRect(x, y, 140, 140);
      });
      g.save();
      g.beginPath();
      g.rect(x, y, 140, 140);
      g.clip();
      if (kind === 'linen') {
        for (let i = 0; i < 140; i += 4) {
          g.fillStyle = 'rgba(120,100,70,0.18)';
          g.fillRect(x + i, y, 1.5, 140);
          g.fillRect(x, y + i, 140, 1.5);
        }
      } else if (kind === 'boucle') {
        for (let i = 0; i < 600; i++) {
          g.fillStyle = `rgba(${200 + rng.next() * 40},${190 + rng.next() * 40},${170 + rng.next() * 40},0.8)`;
          g.beginPath();
          g.arc(x + rng.next() * 140, y + rng.next() * 140, 2 + rng.next() * 3, 0, TAU);
          g.fill();
        }
      } else if (kind === 'velvet') {
        const gr = g.createLinearGradient(x, y, x + 140, y + 140);
        gr.addColorStop(0, 'rgba(255,255,255,0.25)');
        gr.addColorStop(0.5, 'rgba(0,0,0,0)');
        gr.addColorStop(1, 'rgba(0,0,0,0.25)');
        g.fillStyle = gr;
        g.fillRect(x, y, 140, 140);
      } else {
        g.strokeStyle = 'rgba(60,40,20,0.35)';
        g.lineWidth = 3;
        for (let r = 0; r < 14; r++) {
          for (let k = -2; k < 16; k++) {
            const sx = x + k * 12, sy = y + r * 12;
            g.beginPath();
            g.moveTo(sx, sy);
            g.lineTo(sx + (r % 2 ? 10 : -10), sy + 10);
            g.stroke();
          }
        }
      }
      g.restore();
    }
    pin(590, 52, '#c9352a');
    pin(750, 70, '#2f3e5c');
    pin(910, 52, '#d6a23a');
    pin(630, 220, '#6e8a6a');
    // sketch: a lounge chair and a lamp in pencil on paper
    shadow(() => {
      g.fillStyle = '#fbf7ee';
      g.fillRect(40, 320, 470, 300);
    });
    tape(275, 320, 140, 28, 0.04, '#e3b2a0');
    g.strokeStyle = '#4a4440';
    g.lineWidth = 3;
    g.lineCap = 'round';
    const pencil = (pts) => {
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.quadraticCurveTo(pts[i][0], pts[i][1], pts[i][2] ?? pts[i][0], pts[i][3] ?? pts[i][1]);
      g.stroke();
    };
    pencil([[110, 560], [100, 480, 130, 430], [260, 420, 300, 440], [330, 470, 320, 540]]);
    pencil([[120, 540], [200, 520, 310, 530]]);
    pencil([[150, 545], [140, 580, 130, 600]]);
    pencil([[290, 545], [300, 580, 310, 600]]);
    pencil([[130, 450], [180, 380, 270, 400]]);
    pencil([[420, 600], [420, 420, 430, 400]]);
    pencil([[380, 400], [430, 340, 480, 400]]);
    pencil([[380, 400], [430, 410, 480, 400]]);
    g.font = `400 22px ${HAND}`;
    g.fillStyle = '#4a4440';
    g.fillText('lounge chair — walnut + cognac', 70, 610);
    // photo: a cosy corner
    shadow(() => {
      g.fillStyle = '#fbfbf8';
      g.fillRect(560, 380, 300, 300);
    });
    g.fillStyle = '#e8dcc6';
    g.fillRect(576, 396, 268, 220);
    g.fillStyle = '#6e8a6a';
    g.fillRect(600, 520, 200, 60);
    g.fillRect(600, 480, 200, 50);
    g.fillStyle = '#c46a43';
    g.fillRect(620, 486, 46, 40);
    g.fillStyle = '#d6a23a';
    g.beginPath();
    g.arc(780, 440, 26, 0, TAU);
    g.fill();
    g.fillStyle = '#4e6b3c';
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.ellipse(612 + i * 6, 430 - i * 6, 18, 8, -0.8 + i * 0.3, 0, TAU);
      g.fill();
    }
    g.font = `400 22px ${HAND}`;
    g.fillStyle = '#5a4a3a';
    g.fillText('reading corner', 620, 660);
    // a little painted heart (the font has no ♡)
    g.fillStyle = '#c46a43';
    g.beginPath();
    g.moveTo(790, 668);
    g.bezierCurveTo(770, 652, 772, 634, 784, 636);
    g.bezierCurveTo(788, 637, 790, 641, 790, 644);
    g.bezierCurveTo(790, 641, 792, 637, 796, 636);
    g.bezierCurveTo(808, 634, 810, 652, 790, 668);
    g.fill();
    pin(710, 390, '#c9352a');
    // dried leaf & a wood sample
    shadow(() => {
      g.fillStyle = '#a8784a';
      g.fillRect(890, 260, 100, 160);
    });
    for (let i = 0; i < 12; i++) {
      g.strokeStyle = 'rgba(70,40,20,0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(890, 270 + i * 13);
      g.bezierCurveTo(920, 265 + i * 13, 960, 280 + i * 13, 990, 272 + i * 13);
      g.stroke();
    }
    g.fillStyle = '#f7f1e3';
    g.font = `400 18px ${HAND}`;
    g.fillText('walnut', 905, 410);
    shadow(() => {
      g.fillStyle = '#7a8f4a';
      g.beginPath();
      g.ellipse(940, 600, 40, 90, 0.4, 0, TAU);
      g.fill();
    });
    g.strokeStyle = '#4e5f2e';
    g.beginPath();
    g.moveTo(905, 690);
    g.lineTo(975, 510);
    g.stroke();
  }, NOTE_FONTS, 'Wohnatelier warm calm crafted lounge chair walnut cognac reading corner Sage Terracotta Ochre Linen Ink');
}

// ─── model table ─────────────────────────────────────────────────────────────
function makeModelTable(rng) {
  const M = mats();
  const B = new Batch();
  const g = new THREE.Group();
  g.name = 'small-space-model';
  const w = 1.0, d = 0.62, h = 0.76;
  // trestle legs
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - 0.1);
    B.add(M.wood, boardBetween([x, 0, -d / 2 + 0.05], [x, h - 0.03, 0], 0.04, 0.05), { color: WOOD.spruce });
    B.add(M.wood, boardBetween([x, 0, d / 2 - 0.05], [x, h - 0.03, 0], 0.04, 0.05), { color: WOOD.spruce });
  }
  B.add(M.wood, board(w - 0.2, 0.04, 0.04, { along: 'x' }).translate(0, 0.3, 0), { color: WOOD.spruce, cast: false });
  B.add(M.wood, board(w, 0.035, d, { along: 'x', rng }).translate(0, h, 0), { color: WOOD.spruce });
  const top = h + 0.018;
  // the card model of a tiny flat on a base board
  const bx = -0.12, bz = 0.02;
  const mw = 0.52, md = 0.36;
  B.add(M.wood, board(mw + 0.04, 0.02, md + 0.04, { along: 'x' }).translate(bx, top + 0.01, bz), { color: WOOD.maple ?? '#d6c39f', cast: false });
  const wallH = 0.08, t = 0.008;
  const card = '#f4f1ea';
  const wall = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const geo = new THREE.BoxGeometry(len, wallH, t);
    geo.rotateY(-Math.atan2(z1 - z0, x1 - x0));
    B.add(M.wood, geo.translate(bx + (x0 + x1) / 2, top + 0.02 + wallH / 2, bz + (z0 + z1) / 2), { color: card, cast: false });
  };
  // outer walls (front left open for view), inner partitions
  wall(-mw / 2, -md / 2, mw / 2, -md / 2);
  wall(-mw / 2, -md / 2, -mw / 2, md / 2);
  wall(mw / 2, -md / 2, mw / 2, md / 2);
  wall(0.05, -md / 2, 0.05, 0.02);
  wall(0.05, 0.08, 0.05, md / 2);
  wall(0.05, -0.02, mw / 2, -0.02);
  wall(-mw / 2, md / 2, -0.1, md / 2);
  // floors (oak) & tiny furniture
  B.add(M.wood, new THREE.PlaneGeometry(mw, md).rotateX(-Math.PI / 2).translate(bx, top + 0.021, bz), { color: '#c9a77a', cast: false });
  const block = (x, z, sx, sy, sz, c) => B.add(M.wood, new THREE.BoxGeometry(sx, sy, sz).translate(bx + x, top + 0.021 + sy / 2, bz + z), { color: c, cast: false });
  block(-0.14, -0.1, 0.16, 0.025, 0.07, '#6e8a6a'); // sofa
  block(-0.14, 0.02, 0.07, 0.018, 0.07, '#8a6a4a'); // table
  block(-0.2, 0.12, 0.08, 0.035, 0.03, '#c46a43'); // shelf
  block(0.16, 0.1, 0.12, 0.02, 0.16, '#efe4cf'); // bed
  block(0.16, -0.11, 0.16, 0.035, 0.05, '#b8a68a'); // kitchen
  B.add(M.wood, new THREE.SphereGeometry(0.025, 6, 5).translate(bx - 0.23, top + 0.05, bz - 0.14), { color: '#4e7a34', cast: false });
  // floor plan, scale ruler, pencil cup, a mug, rolled drawings
  const plan = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.26).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: planTexture(), roughness: 0.9, name: 'floorplan' }));
  plan.position.set(0.3, top + 0.003, 0.08);
  plan.rotation.y = -0.15;
  plan.receiveShadow = true;
  g.add(plan);
  B.add(M.wood, xf(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 3), [0.32, top + 0.012, -0.12], [0, 0.3, Math.PI / 2]), { color: '#e8e0cc', cast: false });
  B.add(M.wood, new THREE.CylinderGeometry(0.035, 0.032, 0.09, 10).translate(-0.4, top + 0.045, -0.2), { color: '#2f3e5c', cast: false });
  for (let i = 0; i < 4; i++) B.add(M.wood, rod([-0.4 + rng.jitter(0.015), top + 0.05, -0.2 + rng.jitter(0.015)], [-0.4 + rng.jitter(0.05), top + 0.17, -0.2 + rng.jitter(0.05)], 0.005, 0.005, 4), { color: rng.pick(['#e8b33a', '#c9352a', '#3e3a36']), cast: false });
  B.add(M.wood, new THREE.CylinderGeometry(0.04, 0.035, 0.08, 10).translate(0.42, top + 0.04, 0.22), { color: '#efe4cf', cast: false });
  for (let i = 0; i < 2; i++) {
    const r = new THREE.CylinderGeometry(0.03, 0.03, 0.5, 10);
    r.rotateZ(Math.PI / 2);
    r.rotateY(0.2 + i * 0.15);
    B.add(M.wood, r.translate(0.05, top + 0.03 + i * 0.05, -0.24 + i * 0.03), { color: '#f2ead8', cast: false });
  }
  B.build(g, 'model-table', { mergeShadow: true });
  return g;
}

function planTexture() {
  return canvasTex(512, 400, (g, W, H) => {
    g.fillStyle = '#f6f3ea';
    g.fillRect(0, 0, W, H);
    // faint grid
    g.strokeStyle = 'rgba(80,110,150,0.12)';
    g.lineWidth = 1;
    for (let x = 0; x < W; x += 16) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    for (let y = 0; y < H; y += 16) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    // walls
    g.strokeStyle = '#2b2b2b';
    g.lineWidth = 9;
    g.strokeRect(50, 50, 400, 280);
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(270, 50);
    g.lineTo(270, 180);
    g.moveTo(270, 230);
    g.lineTo(270, 330);
    g.moveTo(270, 170);
    g.lineTo(450, 170);
    g.stroke();
    // door swings
    g.lineWidth = 2;
    g.beginPath();
    g.arc(270, 230, 50, -Math.PI / 2, 0);
    g.stroke();
    // furniture outlines
    g.lineWidth = 2.5;
    g.strokeRect(80, 250, 150, 55); // sofa
    g.strokeRect(120, 170, 60, 50); // table
    g.strokeRect(300, 200, 120, 110); // bed
    g.strokeRect(300, 60, 140, 40); // kitchen
    g.beginPath();
    g.arc(370, 125, 18, 0, TAU);
    g.stroke();
    // labels & dimensions
    g.fillStyle = '#3b3b3b';
    g.font = `400 22px ${HAND}`;
    g.fillText('living', 110, 150);
    g.fillText('sleep', 330, 290);
    g.fillText('cook', 320, 130);
    g.font = `600 26px ${TITLE}`;
    g.fillText('Tiny flat · 28 m²', 120, 375);
    g.strokeStyle = '#b8573a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(50, 30);
    g.lineTo(450, 30);
    g.stroke();
    g.fillStyle = '#b8573a';
    g.font = `400 18px ${HAND}`;
    g.fillText('6.40', 230, 24);
  }, NOTE_FONTS, 'living sleep cook Tiny flat 28 m² 6.40');
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function shadeHex(hex, amount) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amount)));
  return '#' + c.getHexString();
}

