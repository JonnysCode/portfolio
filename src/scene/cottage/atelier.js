// ─────────────────────────────────────────────────────────────────────────────
// The Wohnatelier — an ochre mushroom house opened up at the front by a big
// arched loggia (folding glazed doors pushed back), revealing a beautifully
// designed little living room, styled 60/30/10: crack-free warm limewash walls
// and an oak floor (60), sage and cognac upholstery (30) and INK as the accent
// (10) — an ink velvet cushion and knitted throw, a black-metal tripod lamp, a
// dark print anchoring a gallery of mixed black / brass / oak frames, ink
// ceramics. A rectangular cream Berber rug with ink lozenges under the front
// legs of the seating, a sage sofa, a walnut-and-cognac lounge chair with
// ottoman and a little round side table (cup, open book) — the reading corner —
// a ribbed rice-paper globe pendant, a bookcase full of books, a joiner-made
// sideboard with a mushroom lamp under a small arched window (oak frame, linen
// café curtain, daylight spilling onto the floor), a monstera and a pothos.
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
import { makeMushroomHouse, paneGrid } from '../../props/mushroomHouse.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makePerson } from '../../props/index.js';
import {
  Batch, mats, mat4, xf, board, boardBetween, rod, stoneGeo, mossGeo, tube, taperTube, leafGeo, Cards, deform, uvBox, paramSurface,
  arcSegment, noiseA, lightSpillGeo, lightSpillMaterial, KIT,
  paintFn, addFlower, addFern, addGrass, addIvy, TAU, WOOD,
} from './kit.js';
import { local, hitProxy, pot, stringLights, flagstones } from './garden.js';
import { whenFontsReady, FONT_DISPLAY, FONT_HAND } from '../../props/text.js';

/** The atelier faces the 'interior' spot camera (its open front looks this way). */
/** Facing of the opened-up front (from layout.js, so the 'interior' spot camera looks straight in). */
export const ATELIER_ROT = COTTAGE.atelier.rotY ?? 0.6;

const PALETTE = {
  sage: '#7a9273',
  // the sofa's sage (on the neutral textile, kit.js mats().textile: the plain fabric's beige
  // cast turned the old sage olive-mustard); a muted grey-green that stays sage under the
  // warm lamps and turns a little cooler in the daylight from the loggia
  sofaSage: '#789a70',
  archInk: '#4466ab', // the painted arch behind the bookcase (limewash in ink blue: lighter than the ink itself, it sits in the deepest shade)
  terracotta: '#c46a43',
  mustard: '#d6a23a',
  cream: '#efe4cf',
  navy: '#2f3e5c',
  ink: '#2a3550',
  inkVelvet: '#2f4474', // ink in upholstery: a touch lighter & bluer, so the velvet reads blue, not black
  linen: '#e6ddca',
  oat: '#d6c8ad',
  cognac: '#7b4128',
  blush: '#e3b2a0',
  black: '#1f1e1d',
  brass: '#b38b45',
};

/** Build the Wohnatelier into batch B. Returns { hotspots, updates, lights, colliders }. */
export function buildAtelier(ctx, B, root, halos, smoke = [], rimHalos = null) {
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
    capFlare: 0.3,
    capMoss: 5,
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
      // the reading corner's arched window (its inside: atelierWindow)
      { phi: WIN_PHI, y: WIN_Y, shape: 'arch', w: 0.48, h: 0.86, shutters: false, box: false },
    ],
    open: { phi: 0, width: 2.9, height: 2.72, depth: 0.5 },
    detail: ctx.quality?.density ?? 1,
    batch: B,
    halos,
    smokeSources: smoke,
    rimHalos: rimHalos ?? undefined,
    frame,
  });
  root.add(house);
  const I = house.userData.interior;
  const F = B.at(frame); // house-local frame
  out.colliders.push([A.x, A.z, house.userData.radius]);
  out.keepOut.push([A.x, A.z, house.userData.radius + 0.25]);

  // the sofa is its own little group: the 'living-room' hotspot bounces it on hover
  const sofaB = new Batch();
  const extras = [];
  buildInterior(F, rng, I, halos, frame, sofaB, extras);
  for (const m of extras) house.add(m);
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

  // a warm light inside (lamps) — the room is deep in the cap's shadow. By day only a
  // gentle fill (the lamps are not the key: a strong warm fill flattened the room into one
  // yellow haze and clipped the rug); at night the lamps carry the room
  const lp = new THREE.Vector3(0.1, I.floorY + 1.9, -0.5).applyMatrix4(frame);
  out.lights.push([lp, { color: '#ffc98a', day: 0.45, night: 2.8, distance: 6 }]);
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

/** The reading corner's arched window on the back-right wall (house-local φ; centre height). */
const WIN_PHI = Math.PI - 0.52;
const WIN_Y = 1.64;

function buildInterior(F, rng, I, halos, frame, sofaB, extras) {
  const M = mats();
  const y0 = I.floorY;
  // (the round-4 additions draw from their own generator: the terrace outside keeps its layout)
  const rng4 = createRng('wohnatelier-r4');
  const at = (x, z, rotY = 0, y = y0) => mat4([x, y, z], [0, rotY, 0]);
  const wallPos = (phi, y, inset = 0) => {
    const r = I.radiusAt(phi, y) - inset;
    return [Math.sin(phi) * r, y, Math.cos(phi) * r];
  };
  const halo = (x, y, z, size) => {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(frame);
    halos.push({ x: v.x, y: v.y, z: v.z, size });
  };

  // rug: a rectangular cream Berber with ink lozenges, centred on the seating group — the
  // sofa's front legs and the lounge chair's whole base stand on it
  berberRug(F, rng4, at(-0.3, -0.47), 2.9, 1.56);
  // sofa against the back wall (into its own batch, local to the sofa group's origin)
  sofa(sofaB, rng, new THREE.Matrix4(), { len: 1.95, color: PALETTE.sofaSage });
  // coffee table, a comfortable reach in front of the seat
  coffeeTable(F, rng, at(0.02, -0.36, 0.3));
  // reading corner: lounge chair, ottoman, black-metal tripod lamp, a side table at the chair's arm
  loungeChair(F, rng, at(-1.32, -0.35, 1.05));
  ottoman(F, rng, at(-0.82, 0.12, 1.1));
  tripodLamp(F, rng, at(-1.72, -1.05, 0.5));
  halo(-1.72, y0 + 1.45, -1.05, 0.6);
  sideTable(F, rng4, at(-1.2, -0.98, 0.4));
  bookStack(F, rng, at(-1.82, -0.15, 0.4), 5);
  // bookcase on the left-back wall, sideboard on the right (under the window)
  {
    const phi = Math.PI + 0.78;
    const [x, , z] = wallPos(phi, 1, 0.22);
    // the room's deep, cool anchor: an ink-blue limewashed arch painted on the wall behind it
    paintedArch(F, I, phi, { halfW: 0.66, spring: 1.78, color: PALETTE.archInk });
    bookcase(F, rng, at(x, z, phi + Math.PI));
  }
  {
    const phi = Math.PI - 0.95;
    const [x, , z] = wallPos(phi, 0.5, 0.26);
    sideboard(F, rng, at(x, z, phi + Math.PI), halo);
  }
  // gallery wall above the sofa
  gallery(F, rng, I, wallPos);
  // the arched window with its café curtain, and the daylight it lets in
  atelierWindow(F, rng4, I, extras);
  // the monstera by the opening (right) and a fiddle-leaf fig (left back)
  monstera(F, rng, at(1.62, 0.35, -0.6));
  fiddleFig(F, rng, at(-1.05, -1.75, 0.3));
  // a rice-paper globe pendant over the coffee table (high enough to stay clear of the
  // gallery wall from the spot camera) & a hanging pothos
  {
    const cy = I.ceilY;
    const gr = 0.18, gy = y0 + 2.0, gx = 0.02, gz = -0.38;
    F.add(M.vc, tube([[gx, cy, gz], [gx, gy + gr + 0.02, gz]], 0.006, 3, 2), { color: '#2a2622', cast: false });
    globeLamp(F, at(gx, gz, 0, gy), gr);
    halo(gx, gy, gz, 0.45);
    hangingPlant(F, rng, at(1.05, -1.25, 0, cy), cy - y0);
  }
  // a basket of throws by the sofa
  basket(F, rng, at(1.22, -1.15, 0.4));
}

/**
 * The small arched window of the reading corner (inside face): an oak frame with a
 * glazing-bar cross and a deep sill on the limewashed wall, daylight in the glass (sky over
 * sunlit leaves; dark at night), a gathered linen café curtain on a brass rod over its lower
 * half, and a soft additive patch of daylight on the floor and the wall around it.
 */
function atelierWindow(F, rng, I, extras) {
  const M = mats();
  const w = 0.46, h = 0.84, r = w / 2, hs = h - r;
  // hang it where the concave, leaning wall comes closest anywhere behind it
  const r0 = I.radiusAt(WIN_PHI, WIN_Y);
  let dist = Infinity;
  for (let i = 0; i <= 6; i++) {
    for (let j = 0; j <= 4; j++) {
      const dx = (i / 6 - 0.5) * (w + 0.2);
      const y = WIN_Y + (j / 4 - 0.5) * (h + 0.12);
      const d = Math.asin(THREE.MathUtils.clamp(dx / r0, -0.9, 0.9));
      dist = Math.min(dist, I.radiusAt(WIN_PHI + d, y) * Math.cos(d));
    }
  }
  dist -= 0.012;
  const m = mat4([Math.sin(WIN_PHI) * dist, WIN_Y, Math.cos(WIN_PHI) * dist], [0, WIN_PHI + Math.PI, 0]);
  const L = local(F, m);
  const yb = -h / 2;
  // the glass: daylight — pale sky in the head, soft blue-green, sunlit leaves below
  const sky = new THREE.Color('#e3eef0'), mid = new THREE.Color('#bcd6c8'), leaf = new THREE.Color('#9dbd6c'), leafD = new THREE.Color('#6d9150');
  const pane = paintFn(paneGrid(r, hs, yb, r, 6, 10), '#ffffff', (x, y, z, i, c) => {
    const v = (y - yb) / h;
    c.copy(leaf).lerp(mid, THREE.MathUtils.smoothstep(v, 0.3, 0.62)).lerp(sky, THREE.MathUtils.smoothstep(v, 0.6, 0.95));
    const n = noiseA(x * 9 + 3.1, y * 7);
    if (v < 0.6) c.lerp(leafD, Math.max(0, n) * 0.6 * (1 - v / 0.6));
  });
  L.add(M.daylight, pane.translate(0, 0, 0.008), { cast: false, color: null });
  // oak frame: jambs, arched head, glazing bars, a deep sill
  const fw = 0.06, fd = 0.085, wood = WOOD.oakLight;
  for (const sx of [-1, 1]) L.add(M.wood, board(fw, hs + 0.01, fd, { along: 'y', rng }).translate(sx * (r + fw / 2), yb + hs / 2, fd / 2), { color: wood, cast: false });
  L.add(M.wood, uvBox(arcSegment(r, r + fw, 0, Math.PI, fd, 10, 0.006), 'x').translate(0, yb + hs, fd / 2), { color: wood, cast: false });
  L.add(M.wood, board(0.026, h - 0.02, 0.03, { along: 'y' }).translate(0, yb + (h - 0.02) / 2, 0.022), { color: wood, cast: false });
  L.add(M.wood, board(w, 0.026, 0.03, { along: 'x' }).translate(0, yb + hs * 0.56, 0.022), { color: wood, cast: false });
  L.add(M.wood, board(w + fw * 2 + 0.12, 0.04, 0.17, { along: 'x', rng }).translate(0, yb - 0.02, 0.07), { color: wood, cast: false });
  // a little potted herb and a tiny vase on the sill
  L.add(M.vc, new THREE.CylinderGeometry(0.045, 0.036, 0.075, 10).translate(-0.14, yb + 0.037, 0.08), { color: PALETTE.ink, cast: false });
  addFern(L, rng, -0.14, yb + 0.075, 0.08, { size: 0.15, fronds: 5 });
  vase(L, [0.16, yb, 0.085], 0.03, 0.11, '#e9e2d4');
  // café curtain: gathered linen over the lower half, on a slim brass rod with finials
  const rodY = yb + hs * 0.56 + 0.035;
  L.add(M.metal, rod([-r - fw - 0.04, rodY, 0.05], [r + fw + 0.04, rodY, 0.05], 0.006, 0.006, 6), { color: PALETTE.brass, cast: false });
  for (const sx of [-1, 1]) L.add(M.metal, new THREE.SphereGeometry(0.012, 6, 4).translate(sx * (r + fw + 0.045), rodY, 0.05), { color: PALETTE.brass, cast: false });
  const cw = w + fw * 1.4, ch = rodY - (yb + 0.035);
  const cur = new THREE.PlaneGeometry(cw, ch, 22, 4);
  const cp = cur.attributes.position;
  const ph = rng.range(0, 6);
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), y = cp.getY(i);
    const t = (y + ch / 2) / ch; // 0 hem … 1 rod
    cp.setZ(i, 0.012 * Math.sin((x / cw) * Math.PI * 9 + ph) * (0.75 + 0.25 * (1 - t)) + 0.004 * Math.sin(x * 60));
    cp.setY(i, y - (1 - t) * 0.006 * Math.sin(x * 23 + ph));
  }
  cur.computeVertexNormals();
  uvBox(cur, 'z', 5);
  L.add(M.textile, cur.translate(0, rodY - ch / 2 - 0.008, 0.045), { color: PALETTE.linen, cast: false });
  // curtain rings on the rod
  for (let i = 0; i < 7; i++) L.add(M.metal, new THREE.TorusGeometry(0.011, 0.002, 3, 8).translate(-cw / 2 + 0.02 + (i / 6) * (cw - 0.04), rodY, 0.05), { color: PALETTE.brass, cast: false });

  // daylight: a soft patch on the oak floor just inside the window, and a glow on the wall
  // around it (one additive mesh; gone at night). Subtle, and short enough to stay on the
  // boards between the wall and the rug (the rug's back edge is ≈ 0.75 in from this window):
  // on the cream rug the extra light clipped to white.
  const inward = new THREE.Vector3(-Math.sin(WIN_PHI), 0, -Math.cos(WIN_PHI));
  const floorP = new THREE.Vector3(Math.sin(WIN_PHI) * dist, I.floorY + 0.03, Math.cos(WIN_PHI) * dist).addScaledVector(inward, 0.38);
  const floorPatch = lightSpillGeo(0.72, 0.6, { color: '#fff3dc', peak: 0.1, tilt: 0.8 });
  floorPatch.rotateX(-Math.PI / 2); // +Y (the window end) → −Z
  floorPatch.rotateY(WIN_PHI); // −Z → towards the window
  floorPatch.translate(floorP.x, floorP.y, floorP.z);
  const wallGlow = lightSpillGeo(1.3, 1.5, { color: '#fff6e6', peak: 0.05 });
  wallGlow.translate(0, 0.04, 0.004).applyMatrix4(m);
  const spill = new THREE.Mesh(mergeGeometries([floorPatch, wallGlow], false), lightSpillMaterial());
  spill.name = 'atelier-daylight-spill';
  spill.renderOrder = 3;
  spill.castShadow = spill.receiveShadow = false;
  spill.raycast = () => {};
  extras.push(spill);
}

/**
 * A colour-blocked arch painted on the inner wall (limewash in a deep colour) centred at
 * azimuth φ: straight sides up to `spring` above the floor, a half-round head of radius
 * halfW. It follows the concave, leaning wall exactly (a grid laid on the plaster a hair
 * in front of it), each column as tall as the arch is at that point.
 */
function paintedArch(F, I, phi, { halfW = 0.65, spring = 1.75, color = '#2b3b5c' } = {}) {
  const M = mats();
  const y0 = I.floorY + 0.002;
  const r0 = I.radiusAt(phi, I.floorY + 1.2);
  const g = paramSurface(
    (u, v, p) => {
      const x = (u * 2 - 1) * halfW;
      const top = I.floorY + spring + Math.sqrt(Math.max(0, halfW * halfW - x * x));
      const y = top + v * (y0 - top); // v: 0 at the top edge → 1 at the floor
      const a = phi - Math.asin(THREE.MathUtils.clamp(x / r0, -0.95, 0.95));
      const r = I.radiusAt(a, y) - 0.006;
      p.set(Math.sin(a) * r, y, Math.cos(a) * r);
    },
    18,
    8,
    { uv: (u, v, p) => [(Math.atan2(p.x, p.z) * r0) / 2.2, p.y / 2.2] }
  );
  // the same soft skirting shadow as the limewash around it
  paintFn(g, color, (x, y, z, i, c) => c.multiplyScalar(0.82 + 0.18 * THREE.MathUtils.smoothstep(y - I.floorY, 0, 0.35)));
  // (the generator walks the wall from right to left: face it into the room)
  if (g.attributes.normal.getX(0) * g.attributes.position.getX(0) + g.attributes.normal.getZ(0) * g.attributes.position.getZ(0) > 0) {
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i += 3) [ia[i + 1], ia[i + 2]] = [ia[i + 2], ia[i + 1]];
    g.computeVertexNormals();
  }
  F.add(M.limewash, g, { cast: false, color: null });
}

/**
 * A rectangular Beni-Ourain-style Berber (frame-local, centred at the origin, length along x):
 * a thick cream pile with soft hand-made edges, a hand-drawn ink lozenge lattice (every line
 * a little wobbly) with the odd small ink diamond in a lozenge, and knotted fringes at both ends.
 */
function berberRug(F, rng, m, W, D) {
  const M = mats();
  const L = local(F, m);
  const th = 0.016;
  const base = cushion(W, th, D, 0.008, 0);
  deform(base, (v) => {
    v.x += 0.012 * Math.sin(v.z * 7 + 1.3);
    v.z += 0.01 * Math.sin(v.x * 5.3);
  });
  // (a warm wool cream, not paper white: under the lamps a near-white pile clipped to white)
  L.add(M.textile, base.translate(0, th / 2 + 0.002, 0), { color: '#d3c7ae', cast: false });
  const top = th + 0.0035;
  // a woven ink border just inside the edge frames the field
  {
    const o = new THREE.Shape();
    const ox = W / 2 - 0.028, oz = D / 2 - 0.028, ix = W / 2 - 0.062, iz = D / 2 - 0.062;
    o.moveTo(-ox, -oz).lineTo(ox, -oz).lineTo(ox, oz).lineTo(-ox, oz).lineTo(-ox, -oz);
    const h = new THREE.Path();
    h.moveTo(-ix, -iz).lineTo(-ix, iz).lineTo(ix, iz).lineTo(ix, -iz).lineTo(-ix, -iz);
    o.holes.push(h);
    const b = new THREE.ShapeGeometry(o, 1).rotateX(-Math.PI / 2);
    deform(b, (v) => {
      v.x += 0.012 * Math.sin(v.z * 7 + 1.3);
      v.z += 0.01 * Math.sin(v.x * 5.3);
    });
    L.add(M.textile, uvBox(b, 'y', 3).translate(0, top, 0), { color: PALETTE.ink, cast: false });
  }
  // the lattice: two families of diagonal lines, clipped to the field inside a narrow margin
  const ink = PALETTE.ink;
  const mx = W / 2 - 0.08, mz = D / 2 - 0.07;
  const cellX = 0.48, cellZ = 0.34; // a lozenge's width × depth
  const lw = 0.022;
  for (const sgn of [-1, 1]) {
    for (let k = -7; k <= 7; k++) {
      // line: z = sgn * (x - x0) * (cellZ / cellX)
      const x0 = k * cellX + 0.11;
      const slope = sgn * (cellZ / cellX);
      // clip the line to |x| ≤ mx, |z| ≤ mz
      let t0 = -mx, t1 = mx;
      const zAt = (x) => slope * (x - x0);
      const xAtZ = (z) => z / slope + x0;
      const xa = xAtZ(-mz), xb = xAtZ(mz);
      t0 = Math.max(t0, Math.min(xa, xb));
      t1 = Math.min(t1, Math.max(xa, xb));
      if (t1 - t0 < 0.05) continue;
      const n = Math.max(2, Math.round((t1 - t0) / 0.12));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const x = t0 + ((t1 - t0) * i) / n;
        pts.push([x + rng.jitter(0.008), zAt(x) + rng.jitter(0.01)]);
      }
      // a flat strip along the polyline
      const pos = [], idx = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1];
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        const ww = lw * (0.8 + 0.4 * Math.abs(Math.sin(i * 1.7 + k)));
        pos.push(pts[i][0] - tz * ww / 2, top, pts[i][1] + tx * ww / 2, pts[i][0] + tz * ww / 2, top, pts[i][1] - tx * ww / 2);
        if (i > 0) {
          const q = (i - 1) * 2;
          idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      if (g.attributes.normal.getY(0) < 0) {
        const ia = g.index.array;
        for (let i = 0; i < ia.length; i += 3) [ia[i + 1], ia[i + 2]] = [ia[i + 2], ia[i + 1]];
        g.computeVertexNormals();
      }
      uvBox(g, 'y', 3);
      L.add(M.textile, g, { color: ink, cast: false });
    }
  }
  // a few small solid diamonds in the lozenges (the lozenge between lines a, a+1 and b, b+1
  // is centred at x = (a + b + 1)·cellX/2 + 0.11, z = (b − a)·cellZ/2)
  for (let i = 0; i < 12; i++) {
    const a = rng.int(-4, 3), b = rng.int(-4, 3);
    const x = ((a + b + 1) * cellX) / 2 + 0.11;
    const z = ((b - a) * cellZ) / 2;
    if (Math.abs(x) > mx - 0.12 || Math.abs(z) > mz - 0.1) continue;
    const d = new THREE.CircleGeometry(0.035, 4).rotateX(-Math.PI / 2).scale(1.3, 1, 1);
    L.add(M.textile, uvBox(d, 'y', 3).translate(x, top + 0.0005, z), { color: ink, cast: false });
  }
  // knotted fringes at both short ends
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 26; i++) {
      const z = -D / 2 + 0.05 + ((D - 0.1) * i) / 25;
      const len = rng.range(0.05, 0.075);
      const x = sx * (W / 2 + len / 2 - 0.004);
      const f = new THREE.BoxGeometry(len, 0.004, 0.012).rotateY(rng.jitter(0.25));
      L.add(M.textile, uvBox(f, 'y', 3).translate(x, 0.004, z), { color: '#d6cab2', cast: false });
    }
  }
}

/** A small round side table (walnut top on three black-metal legs) with a cup on a saucer and an open book. */
function sideTable(F, rng, m) {
  const M = mats();
  const L = local(F, m);
  const hT = 0.5, rT = 0.17;
  L.add(M.wood, uvBox(new THREE.CylinderGeometry(rT, rT - 0.005, 0.025, 24), 'x').translate(0, hT, 0), { color: WOOD.walnut });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.2;
    L.add(M.metal, rod([Math.sin(a) * 0.07, hT - 0.012, Math.cos(a) * 0.07], [Math.sin(a) * 0.15, 0, Math.cos(a) * 0.15], 0.008, 0.007, 5), { color: PALETTE.black, cast: false });
  }
  L.add(M.metal, new THREE.TorusGeometry(0.09, 0.005, 4, 18).rotateX(Math.PI / 2).translate(0, 0.17, 0), { color: PALETTE.black, cast: false });
  const top = hT + 0.0125;
  // cup & saucer (cream, an ink rim)
  L.add(M.vc, new THREE.CylinderGeometry(0.05, 0.042, 0.008, 16).translate(0.06, top + 0.004, 0.05), { color: '#f1ece2', cast: false });
  const cup = new THREE.LatheGeometry([[0.0, 0], [0.026, 0], [0.032, 0.012], [0.036, 0.05], [0.034, 0.05]].map(([a, b]) => new THREE.Vector2(a, b)), 14);
  L.add(M.vc, cup.translate(0.06, top + 0.008, 0.05), { color: '#f1ece2', cast: false });
  L.add(M.vc, new THREE.CircleGeometry(0.031, 14).rotateX(-Math.PI / 2).translate(0.06, top + 0.05, 0.05), { color: '#5a3a24', cast: false });
  L.add(M.vc, new THREE.TorusGeometry(0.035, 0.0025, 3, 16).rotateX(Math.PI / 2).translate(0.06, top + 0.058, 0.05), { color: PALETTE.ink, cast: false });
  L.add(M.vc, new THREE.TorusGeometry(0.013, 0.003, 4, 8, Math.PI).rotateZ(-Math.PI / 2).translate(0.096, top + 0.033, 0.05), { color: '#f1ece2', cast: false });
  // the open book: two page blocks leaning into the spine, in a cognac cover
  const bm = new THREE.Matrix4().makeRotationY(0.5).setPosition(-0.05, top, -0.03);
  const BL = local(L, bm);
  for (const s of [-1, 1]) {
    const cover = new THREE.BoxGeometry(0.09, 0.004, 0.13).translate(s * 0.046, 0, 0).rotateZ(s * -0.1);
    BL.add(M.vc, cover.translate(0, 0.003, 0), { color: PALETTE.cognac, cast: false });
    const pages = new THREE.BoxGeometry(0.085, 0.012, 0.122).translate(s * 0.044, 0, 0).rotateZ(s * -0.1);
    BL.add(M.paper, pages.translate(0, 0.011, 0), { color: '#f3ecdc', cast: false });
  }
  void rng;
}

// ─── furniture ───────────────────────────────────────────────────────────────
/** A puffy cushion (rounded box with domed faces) — fabric UVs in world units. */
function cushion(w, h, d, r = 0.035, puff = 0.18) {
  // (the low tier rounds the edges with one segment: ≈ a quarter of the triangles)
  const g = new RoundedBoxGeometry(w, h, d, KIT.detail < 0.4 ? 1 : 2, Math.min(r, h * 0.45, w * 0.3, d * 0.3));
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
  L.add(M.textile, cushion(len, 0.12, depth, 0.03, 0.05).translate(0, 0.27, 0), { color });
  // arms
  for (const s of [-1, 1]) L.add(M.textile, cushion(0.16, 0.36, depth, 0.06, 0.08).translate(s * (len / 2 - 0.08), 0.42, 0), { color });
  // seat cushions
  const n = 3;
  const cw = (len - 0.32) / n;
  for (let i = 0; i < n; i++) {
    const c = cushion(cw - 0.012, 0.14, depth - 0.24, 0.05, 0.22);
    L.add(M.textile, c.translate(-len / 2 + 0.16 + cw * (i + 0.5), seatY - 0.02, 0.09), { color: shadeHex(color, rng.range(-0.03, 0.03)) });
  }
  // back: a frame + leaning back cushions
  L.add(M.textile, cushion(len - 0.04, 0.42, 0.16, 0.05, 0.05).translate(0, 0.53, -depth / 2 + 0.08), { color });
  for (let i = 0; i < n; i++) {
    const c = cushion(cw - 0.02, 0.4, 0.15, 0.06, 0.25);
    c.rotateX(-0.2);
    L.add(M.textile, c.translate(-len / 2 + 0.16 + cw * (i + 0.5), 0.66, -depth / 2 + 0.2), { color: shadeHex(color, 0.03) });
  }
  // throw pillows
  // ink velvet, cognac and linen (the room's accent and its two supporting colours)
  const pillows = [
    [-len / 2 + 0.3, PALETTE.inkVelvet, 0.45],
    [-len / 2 + 0.52, PALETTE.cognac, 0.25],
    [len / 2 - 0.32, PALETTE.linen, -0.4],
  ];
  for (const [x, c, rot] of pillows) {
    const p = cushion(0.34, 0.32, 0.11, 0.05, 0.35);
    p.rotateX(-0.25);
    p.rotateZ(rot * 0.3);
    p.rotateY(rot * 0.4);
    L.add(M.textile, p.translate(x, 0.66, -depth / 2 + 0.33), { color: c });
  }
  // knitted throw draped over the right arm: lying on the seat cushion, over the arm,
  // both ends dropping down with soft folds and a wavy hem
  L.add(M.textile, knitThrow(rng, len, 0.55), { color: null, cast: false });
}

/**
 * A chunky knitted throw folded over the sofa's right arm (sofa-local). The
 * cross-section path runs from the seat cushion up over the arm and down its
 * outside; folds grow where the cloth hangs free and the hem waves.
 */
function knitThrow(rng, len, width) {
  const ax = len / 2 - 0.08; // arm centre
  const top = 0.626; // just over the arm's puffed top (≈ 0.614)
  // cross-section (x, y) in the sofa's x-y plane, from the seat end to the outer hanging end
  const path = [
    [ax - 0.36, 0.5], [ax - 0.22, 0.503], [ax - 0.12, 0.535], [ax - 0.09, top - 0.025],
    [ax - 0.04, top], [ax + 0.04, top], [ax + 0.09, top - 0.03],
    [ax + 0.105, top - 0.14], [ax + 0.11, top - 0.28],
  ];
  const curve = new THREE.CatmullRomCurve3(path.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, 'centripetal');
  const nu = 26, nz = 12, th = 0.022;
  const g = new THREE.BoxGeometry(1, th, width, nu, 1, nz);
  const ph = [rng.range(0, 6), rng.range(0, 6), rng.range(0, 6)];
  const pos = g.attributes.position;
  const P = new THREE.Vector3(), T = new THREE.Vector3(), N = new THREE.Vector3();
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color('#3a5287'); // ink-blue knit
  const cc = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const zn = z / (width / 2); // −1 … 1 across the throw
    // the hanging ends don't reach equally far everywhere: a wavy hem
    let u = THREE.MathUtils.clamp(x + 0.5, 0, 1);
    const hemOuter = 1 - 0.07 * (0.5 + 0.5 * Math.sin(zn * 4.2 + ph[0]));
    const hemInner = 0.05 * (0.5 + 0.5 * Math.sin(zn * 3.3 + ph[1]));
    u = hemInner + u * (hemOuter - hemInner);
    curve.getPointAt(u, P);
    curve.getTangentAt(u, T);
    N.set(-T.y, T.x, 0).normalize(); // outward (up on the arm)
    // folds: strongest where the cloth hangs free (both ends), nearly flat on top of the arm
    const free = Math.max(smoothstep(0.62, 1, u), 1 - smoothstep(0, 0.3, u));
    const fold = (0.022 * Math.sin(zn * 7.5 + ph[2] + u * 3) + 0.012 * Math.sin(zn * 15 + ph[1])) * (0.25 + free);
    // the free ends gather a little (the throw narrows as it falls)
    const zz = z * (1 - 0.08 * free) + 0.015 * Math.sin(u * 9 + ph[0]) * free;
    pos.setXYZ(i, P.x + N.x * (y + fold), P.y + N.y * (y + fold), zz);
    // chunky cable-knit ribs running down the throw
    const rib = Math.abs(Math.sin(zn * 13));
    cc.copy(base).multiplyScalar(0.9 + 0.1 * rib - 0.05 * free * (fold < 0 ? 1 : 0));
    col[i * 3] = cc.r;
    col[i * 3 + 1] = cc.g;
    col[i * 3 + 2] = cc.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  uvBox(g, 'z', 4);
  return g.translate(0, 0, 0.09);
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
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
  L.add(M.textile, cushion(0.6, 0.11, 0.58, 0.05, 0.25).translate(0, 0.35, 0.04), { color: PALETTE.cognac });
  // back shell (two panels) leaning back
  const back = new THREE.Matrix4().makeRotationX(-0.42).setPosition(0, 0.36, -0.3);
  const BL = local(L, back);
  for (const [y, h] of [[0.22, 0.4], [0.62, 0.34]]) {
    const sh = new THREE.BoxGeometry(0.72, h, 0.05, 6, 2, 1);
    deform(sh, (v) => {
      v.z -= (v.x / 0.36) ** 2 * 0.08;
    });
    BL.add(M.wood, uvBox(sh, 'x').translate(0, y, -0.03), { color: WOOD.walnut });
    BL.add(M.textile, cushion(0.58, h - 0.06, 0.1, 0.05, 0.12).rotateX(Math.PI / 2).rotateX(-Math.PI / 2).translate(0, y, 0.04), { color: PALETTE.cognac });
  }
  // armrests
  for (const s of [-1, 1]) {
    L.add(M.wood, boardBetween([s * 0.36, 0.5, 0.25], [s * 0.38, 0.6, -0.28], 0.06, 0.04), { color: WOOD.walnut, cast: false });
    L.add(M.textile, cushion(0.1, 0.05, 0.4, 0.02, 0.2).translate(s * 0.37, 0.56, -0.02), { color: PALETTE.cognac });
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
  L.add(M.textile, cushion(0.52, 0.1, 0.42, 0.05, 0.25).translate(0, 0.25, 0), { color: PALETTE.cognac });
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
  L.add(M.vc, new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10).translate(0.02, 0.44, 0.22), { color: '#efe4cf', cast: false });
  L.add(M.lamp, new THREE.SphereGeometry(0.012, 5, 4).scale(1, 1.6, 1).translate(0.02, 0.5, 0.22), { cast: false });
  const bowl = new THREE.SphereGeometry(0.08, 12, 5, 0, TAU, Math.PI / 2, Math.PI / 2);
  L.add(M.vc, bowl.translate(-0.16, 0.47, -0.2), { color: PALETTE.ink, cast: false });
}

function vase(L, [x, y, z], r, h, color) {
  const M = mats();
  const prof = [[0, 0], [r * 0.7, 0], [r * 0.95, h * 0.2], [r, h * 0.45], [r * 0.6, h * 0.8], [r * 0.45, h * 0.92], [r * 0.55, h], [r * 0.45, h * 0.98]].map(([a, b]) => new THREE.Vector2(a, b));
  const g = new THREE.LatheGeometry(prof, 14);
  L.add(M.vc, g.translate(x, y, z), { color, cast: false });
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
    L.add(M.metal, taperTube([[Math.sin(a) * 0.32, 0, Math.cos(a) * 0.32], joint], 0.012, 0.009, 5, 2), { color: PALETTE.black, cast: false });
  }
  L.add(M.metal, new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6).translate(0, 1.3, 0), { color: PALETTE.black, cast: false });
  const shade = new THREE.CylinderGeometry(0.25, 0.27, 0.32, 20, 1, false);
  L.add(M.lamp, shade.translate(0, 1.47, 0), { cast: false });
  L.add(M.metal, new THREE.TorusGeometry(0.25, 0.008, 4, 20).rotateX(Math.PI / 2).translate(0, 1.63, 0), { color: PALETTE.black, cast: false });
}

/**
 * Rice-paper globe pendant (centre at the frame's origin): amber paper glowing
 * between wire ribs — the paper bulges a little between the ribs, the ribs show
 * as darker lines (vertex colours of the paper-lantern material), and the
 * silhouette is a touch brighter than the middle (see kit.js paperLantern).
 */
function globeLamp(F, m, r) {
  const M = mats();
  const L = local(F, m);
  const RIBS = 9;
  const lo = KIT.detail < 0.6;
  const g = new THREE.SphereGeometry(r, lo ? 14 : 22, RIBS * (lo ? 3 : 4));
  const col = [];
  deform(g, (v) => {
    const th = Math.acos(Math.max(-1, Math.min(1, v.y / r))); // 0 top … π bottom
    const f = (th / Math.PI) * RIBS;
    const d = Math.abs(f - Math.round(f)) * 2; // 0 on a rib … 1 mid-panel
    const k = 1 + 0.035 * Math.sin(Math.min(1, d) * Math.PI * 0.5);
    v.x *= k;
    v.z *= k;
    const shade = 0.66 + 0.34 * Math.min(1, d * 1.6);
    const pole = Math.min(1, Math.sin(th) * 3.2); // darker paper gathered at the fitter & the opening
    const c = shade * (0.62 + 0.38 * pole);
    col.push(c, c, c);
  });
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  L.add(M.paperLamp, g, { cast: false, color: null });
  L.add(M.metal, new THREE.CylinderGeometry(0.028, 0.028, 0.045, 8).translate(0, r + 0.01, 0), { color: '#2a2622', cast: false });
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
  L.add(M.vc, new THREE.CylinderGeometry(0.02, 0.07, 0.3, 12).translate(-0.42, top + 0.15, 0), { color: PALETTE.ink, cast: false });
  const dome = new THREE.SphereGeometry(0.19, 18, 8, 0, TAU, 0, Math.PI / 2).scale(1, 0.7, 1);
  L.add(M.lamp, dome.translate(-0.42, top + 0.29, 0), { cast: false });
  const hp = new THREE.Vector3(-0.42, top + 0.3, 0).applyMatrix4(m);
  void hp;
  // vases, art books, a small plant
  vase(L, [0.05, top, -0.04], 0.08, 0.3, PALETTE.ink);
  vase(L, [0.22, top, 0.02], 0.06, 0.2, '#e9e2d4');
  bookStack(F, rng, m.clone().multiply(mat4([0.48, top, 0.02], [0, 0.2, 0])), 3, 0.3);
  L.add(M.vc, new THREE.CylinderGeometry(0.06, 0.05, 0.1, 10).translate(0.5, top + 0.18, 0.02), { color: '#e9e2d4', cast: false });
  addFern(L, rng, 0.5, top + 0.23, 0.02, { size: 0.25, fronds: 6 });
  // a round print in a brass frame above (the arched window hangs beside it)
  frameArt(L, [0.3, legH + h + 0.62, -d / 2 + 0.02], 0.34, 0.34, 'circle', rng, { frame: 'brass' });
}

/**
 * A framed artwork facing +Z at p: kinds 'abstract' | 'botanical' | 'circle' | 'hills'.
 * opts.frame: 'oak' | 'black' | 'brass' | 'walnut' (a gallery of mixed frames), opts.dark: an
 * ink-ground print (the one dark piece that anchors a gallery wall).
 */
function frameArt(L, p, w, h, kind, rng, { frame = 'oak', dark = false } = {}) {
  const M = mats();
  const fw = frame === 'brass' ? 0.022 : frame === 'black' ? 0.026 : 0.03;
  const [x, y, z] = p;
  const [fm, fc] = frame === 'black' ? [M.vc, '#1d1c1b'] : frame === 'brass' ? [M.metal, PALETTE.brass] : frame === 'walnut' ? [M.wood, WOOD.walnut] : [M.wood, WOOD.oakLight];
  for (const s of [-1, 1]) {
    L.add(fm, board(fw, h + fw * 2, 0.035, { along: 'y' }).translate(x + s * (w / 2 + fw / 2), y, z + 0.017), { color: fc, cast: false });
    L.add(fm, board(w + fw * 2, fw, 0.035, { along: 'x' }).translate(x, y + s * (h / 2 + fw / 2), z + 0.017), { color: fc, cast: false });
  }
  // a cream mat around the dark print
  if (dark) L.add(M.paper, new THREE.PlaneGeometry(w, h).translate(x, y, z + 0.005), { color: '#efe6d3', cast: false });
  if (dark) {
    w *= 0.8;
    h *= 0.84;
  }
  const bg = new THREE.PlaneGeometry(w, h).translate(x, y, z + 0.006);
  L.add(M.paper, bg, { color: dark ? PALETTE.ink : '#efe6d3', cast: false });
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
    shape(moon, dark ? PALETTE.linen : PALETTE.navy);
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
  } else if (kind === 'hills') {
    // a tiny landscape print: layered hills under a mustard sun
    const sun = new THREE.Shape();
    sun.absarc(w * 0.22, h * 0.12, h * 0.16, 0, TAU, false);
    shape(sun, PALETTE.mustard);
    [[PALETTE.sage, 0.05, 0.0], [PALETTE.terracotta, -0.12, 1.3], [PALETTE.navy, -0.28, 2.1]].forEach(([c, base, p], k) => {
      const s = new THREE.Shape();
      s.moveTo(-w / 2, -h / 2);
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        s.lineTo(-w / 2 + t * w, h * base + h * 0.12 * Math.sin(t * 5 + p));
      }
      s.lineTo(w / 2, -h / 2);
      s.lineTo(-w / 2, -h / 2);
      shape(s, c, 0.008 + k * 0.001);
    });
  } else if (kind === 'circle') {
    for (let k = 0; k < 3; k++) {
      const c = new THREE.Shape();
      c.absarc(0, 0, w * (0.36 - k * 0.1), 0, TAU, false);
      shape(c, [PALETTE.mustard, PALETTE.terracotta, PALETTE.cream][k], 0.007 + k * 0.001);
    }
  }
  void rng;
}

/**
 * The gallery wall: one tight, deliberate cluster centred over the sofa — its
 * bottom edge ~0.2 above the back cushions, about two thirds of the sofa wide,
 * 6 cm between frames, outer edges aligned (a tall abstract in the middle, a
 * column of two on each side).
 */
function gallery(F, rng, I, wallPos) {
  const FW = 0.03; // frame moulding (frameArt draws it outside w × h)
  const GAP = 0.06;
  const y0 = 1.06; // bottom edge above the floor
  const H = 0.76; // cluster height (outer)
  const cw = 0.56; // centre piece (outer width)
  const sw = 0.34; // side columns (outer width)
  const sx = cw / 2 + GAP + sw / 2;
  // mixed frames (black, brass, oak) around one dark ink print that anchors the cluster
  const art = [
    { x: 0, y: y0 + H / 2, w: cw, h: H, kind: 'abstract', frame: 'black', dark: true },
    { x: -sx, y: y0 + 0.2, w: sw, h: 0.4, kind: 'botanical', frame: 'oak' },
    { x: -sx, y: y0 + 0.4 + GAP + 0.15, w: sw, h: 0.3, kind: 'circle', frame: 'brass' },
    { x: sx, y: y0 + H - 0.23, w: sw, h: 0.46, kind: 'botanical', frame: 'black' },
    { x: sx, y: y0 + 0.12, w: sw, h: 0.24, kind: 'hills', frame: 'oak' },
  ];
  for (const a of art) {
    const yc = I.floorY + a.y;
    const r0 = I.radiusAt(Math.PI, yc);
    const phi = Math.PI - Math.asin(THREE.MathUtils.clamp(a.x / r0, -0.9, 0.9));
    // a flat frame on a concave, hand-wobbled wall that leans in towards the top: hang it
    // where the plaster comes closest anywhere behind it (sampled over its whole face)
    let dist = Infinity;
    for (let i = 0; i <= 6; i++) {
      const dx = (i / 6 - 0.5) * a.w;
      for (let j = 0; j <= 4; j++) {
        const y = yc + (j / 4 - 0.5) * a.h;
        const d = Math.asin(THREE.MathUtils.clamp(dx / r0, -0.9, 0.9));
        dist = Math.min(dist, I.radiusAt(phi + d, y) * Math.cos(d));
      }
    }
    dist -= 0.014;
    const m = mat4([Math.sin(phi) * dist, yc, Math.cos(phi) * dist], [0, phi + Math.PI, 0]);
    frameArt(local(F, m), [0, 0, 0], a.w - FW * 2, a.h - FW * 2, a.kind, rng, a);
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
  F.add(M.textile, g.applyMatrix4(m).translate(0, 0.012, 0), { color: null, cast: false });
}

function monstera(F, rng, m) {
  const M = mats();
  const L = local(F, m);
  const prof = [[0, 0], [0.2, 0], [0.24, 0.05], [0.25, 0.42], [0.27, 0.44], [0.24, 0.44]].map(([a, b]) => new THREE.Vector2(a, b));
  L.add(M.vc, new THREE.LatheGeometry(prof, 16), { color: '#ece6da', cast: false });
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
  L.add(M.vc, new THREE.CylinderGeometry(0.2, 0.16, 0.36, 14).translate(0, 0.18, 0), { color: '#2b2a28', cast: false });
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
  L.add(M.vc, new THREE.SphereGeometry(0.15, 14, 8, 0, TAU, Math.PI * 0.35, Math.PI * 0.65).translate(0, potY + 0.06, 0), { color: '#e9e2d4', cast: false });
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
  L.add(M.textile, cushion(0.34, 0.12, 0.3, 0.05, 0.4).rotateZ(0.3).translate(0.0, 0.33, 0), { color: PALETTE.oat, cast: false });
  L.add(M.textile, cushion(0.3, 0.1, 0.26, 0.05, 0.4).rotateZ(-0.4).translate(0.02, 0.4, 0.04), { color: PALETTE.sage, cast: false });
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
  // the architect's model of a tiny flat: white foam board on a grey base board — thin walls
  // (a 5 mm board ≈ 6 cm at 1:12) with their grey cut edges, a pale floor, a few coloured
  // furniture blocks (sage sofa, cognac chair …) and a tiny scale figure
  const bx = -0.12, bz = 0.02;
  const mw = 0.52, md = 0.36;
  const foam = '#f3f1ec', edge = '#c9c6bf';
  B.add(M.vc, new THREE.BoxGeometry(mw + 0.06, 0.012, md + 0.06).translate(bx, top + 0.006, bz), { color: '#b9b6b0', cast: false });
  const base = top + 0.012;
  B.add(M.vc, new THREE.BoxGeometry(mw, 0.003, md).translate(bx, base + 0.0015, bz), { color: '#e9e2d4', cast: false });
  const wallH = 0.075, t = 0.005;
  const wall = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const rot = -Math.atan2(z1 - z0, x1 - x0);
    const geo = new THREE.BoxGeometry(len, wallH, t);
    geo.rotateY(rot);
    B.add(M.vc, geo.translate(bx + (x0 + x1) / 2, base + wallH / 2, bz + (z0 + z1) / 2), { color: foam, cast: false });
    // the cut edge on top: grey foam core between the white facings
    const cap = new THREE.BoxGeometry(len, 0.0012, t * 0.6).rotateY(rot);
    B.add(M.vc, cap.translate(bx + (x0 + x1) / 2, base + wallH + 0.0006, bz + (z0 + z1) / 2), { color: edge, cast: false });
  };
  // outer walls (front left open for the view), inner partitions with door gaps
  wall(-mw / 2, -md / 2, mw / 2, -md / 2);
  wall(-mw / 2, -md / 2, -mw / 2, md / 2);
  wall(mw / 2, -md / 2, mw / 2, md / 2);
  wall(0.05, -md / 2, 0.05, 0.02);
  wall(0.05, 0.08, 0.05, md / 2);
  wall(0.05, -0.02, mw / 2, -0.02);
  wall(-mw / 2, md / 2, -0.1, md / 2);
  // a window opening in the back wall: a strip of clear acetate
  B.add(M.glass, new THREE.PlaneGeometry(0.1, 0.035).translate(bx - 0.12, base + 0.045, bz - md / 2 + t * 0.6), { cast: false });
  const block = (x, z, sx, sy, sz, c, rotY = 0) => B.add(M.vc, new THREE.BoxGeometry(sx, sy, sz).rotateY(rotY).translate(bx + x, base + 0.003 + sy / 2, bz + z), { color: c, cast: false });
  block(-0.14, -0.13, 0.15, 0.022, 0.055, PALETTE.sage); // sofa
  block(-0.14, -0.155, 0.15, 0.02, 0.012, shadeHex(PALETTE.sage, -0.06)); // its back
  block(-0.04, -0.05, 0.055, 0.02, 0.05, PALETTE.cognac, 0.5); // lounge chair
  block(-0.15, -0.03, 0.06, 0.014, 0.06, '#9a7a56'); // coffee table
  block(-0.23, 0.12, 0.03, 0.05, 0.08, '#d9cfbd'); // shelf
  block(0.16, 0.1, 0.12, 0.018, 0.16, '#efe8da'); // bed
  block(0.16, 0.035, 0.12, 0.012, 0.03, PALETTE.ink); // its throw
  block(0.16, -0.12, 0.16, 0.035, 0.045, '#bdb8ae'); // kitchen
  B.add(M.vc, new THREE.SphereGeometry(0.02, 6, 5).translate(bx - 0.23, base + 0.025, bz - 0.14), { color: '#5e8a42', cast: false });
  // the scale figure (1:12): a little grey person
  B.add(M.vc, new THREE.CylinderGeometry(0.006, 0.007, 0.034, 6).translate(bx + 0.0, base + 0.02, bz + 0.1), { color: '#8f8c86', cast: false });
  B.add(M.vc, new THREE.SphereGeometry(0.0065, 6, 4).translate(bx + 0.0, base + 0.043, bz + 0.1), { color: '#8f8c86', cast: false });
  // floor plan (paper), a triangular scale ruler, a pencil cup, a mug, a roll of masking tape and
  // rolled drawings (white paper and a blueprint, held by a rubber band)
  const plan = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.26).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: planTexture(), roughness: 0.9, name: 'floorplan' }));
  plan.position.set(0.3, top + 0.003, 0.08);
  plan.rotation.y = -0.15;
  plan.receiveShadow = true;
  g.add(plan);
  {
    // lying across the floor plan
    const ruler = new THREE.CylinderGeometry(0.011, 0.011, 0.28, 3);
    ruler.rotateY(Math.PI / 6);
    B.add(M.vc, xf(ruler, [0.29, top + 0.009, 0.1], [0, -0.55, Math.PI / 2]), { color: '#eceae4', cast: false });
    // its scales: coloured grooves along the three edges
    for (const [k, c] of [[0, '#c9352a'], [1, '#3d6fa8'], [2, '#3e3a36']]) {
      const a = (k / 3) * TAU + Math.PI / 6 + Math.PI / 3;
      const strip = new THREE.BoxGeometry(0.24, 0.0012, 0.0016).translate(0, Math.cos(a) * 0.0058, Math.sin(a) * 0.0058);
      B.add(M.vc, xf(strip.rotateX(-a), [0.29, top + 0.009, 0.1], [0, -0.55, 0]), { color: c, cast: false });
    }
  }
  B.add(M.vc, new THREE.CylinderGeometry(0.035, 0.032, 0.09, 10).translate(-0.4, top + 0.045, -0.2), { color: PALETTE.ink, cast: false });
  for (let i = 0; i < 4; i++) B.add(M.wood, rod([-0.4 + rng.jitter(0.015), top + 0.05, -0.2 + rng.jitter(0.015)], [-0.4 + rng.jitter(0.05), top + 0.17, -0.2 + rng.jitter(0.05)], 0.005, 0.005, 4), { color: rng.pick(['#e8b33a', '#c9352a', '#3e3a36']), cast: false });
  B.add(M.vc, new THREE.CylinderGeometry(0.04, 0.035, 0.08, 12).translate(0.36, top + 0.04, 0.26), { color: '#efe4cf', cast: false });
  {
    // masking tape: a cream tape ring around a brown card core, lying flat
    const tape = new THREE.LatheGeometry([[0.022, 0], [0.04, 0], [0.041, 0.006], [0.041, 0.018], [0.04, 0.024], [0.022, 0.024], [0.022, 0]].map(([a, b]) => new THREE.Vector2(a, b)), 18);
    B.add(M.vc, tape.translate(0.42, top, -0.12), { color: '#e6d6a4', cast: false });
    const core = new THREE.CylinderGeometry(0.022, 0.022, 0.025, 14, 1, true);
    B.add(M.vc, core.translate(0.42, top + 0.0125, -0.12), { color: '#9a7b55', cast: false });
  }
  for (let i = 0; i < 3; i++) {
    // behind the model: two rolls side by side and one on top
    const r = new THREE.CylinderGeometry(0.024, 0.024, 0.44 - i * 0.05, 12);
    const ry = 0.06 + i * 0.05;
    r.rotateZ(Math.PI / 2);
    r.rotateY(ry);
    const pz = i === 2 ? -0.252 : -0.276 + i * 0.05, py = top + 0.024 + (i === 2 ? 0.042 : 0);
    B.add(M.vc, r.translate(0.2, py, pz), { color: i === 1 ? '#3d6fa8' : '#f4f1e8', cast: false });
    // a rubber band round the white roll
    if (i === 0) {
      const band = new THREE.TorusGeometry(0.0246, 0.0019, 4, 14).rotateY(Math.PI / 2).rotateY(ry);
      B.add(M.vc, band.translate(0.2 + Math.cos(ry) * 0.07, py, pz - Math.sin(ry) * 0.07), { color: '#a34a2c', cast: false });
    }
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

