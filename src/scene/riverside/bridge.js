// ─────────────────────────────────────────────────────────────────────────────
// The stone arch bridge (RIVERSIDE.bridge) — a little humpbacked packhorse
// bridge connecting the end of PATHS.bridge to the start of PATHS.farBank.
//
//   • a segmental arch of individual dressed voussoirs (keystone proud), the
//     barrel vault laid in staggered courses underneath
//   • rubble spandrel walls in rough courses over a mortar core, running
//     down into wing walls that bed into the banks; big footing stones where
//     the arch springs from the water
//   • a gravel & flagstone deck humping over the crown, moss in every joint
//   • parapets of coursed stones under overhanging mossy capstones, taller
//     end piers; ivy hanging over the sides, ferns & toadstools at the feet
//   • a lantern post at each end (warm light on the east one, near the
//     Velowerkstatt)
//
// Local frame: origin at the bridge centre on y = 0, +X from the west
// abutment to the east one, +Z the downstream (camera) face.
// Returns { frame, deckY(x), halfWidth, length, anchors }.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { PATHS } from '../../world/layout.js';
import { getHeight } from '../../world/ground.js';
import {
  M, TAU, IRON, LOD, Cards, xf, mossGeo, arcSegment, paramSurface, taperTube, board, rod,
  plantFern, plantGrass, addFlower, addToadstool, addIvy, flushCards, noiseA, smooth01,
  cushionStone, roundStone, archStone, stoneTint, wallFern, paintFn, DRESSED_TINTS, MASONRY_TINTS, MORTAR,
} from './kit.js';

// arch & deck dimensions
const SPAN_HALF = 2.6; // intrados half span
const SPRING_Y = -0.45; // springing line
const CROWN_Y = 0.72; // intrados crown
const RING = 0.38; // voussoir depth
const R = (SPAN_HALF * SPAN_HALF + (CROWN_Y - SPRING_Y) ** 2) / (2 * (CROWN_Y - SPRING_Y));
const Y0 = CROWN_Y - R; // arch centre
const RE = R + RING;
const THETA = Math.asin(SPAN_HALF / R);
const W = 2.2; // overall width
const HALF_W = W / 2;
const PARAPET_T = 0.26;
const PARAPET_H = 0.5;
const END = 3.62; // where the deck meets the paths
const DECK_CROWN = 1.3;
/** Where the vintage bike leans on the downstream parapet (local x, side) — kept clear of plants. */
export const BIKE_SPOT = { x: 3.05, side: 1, offset: 0.27 };
/** Rubble in the spandrels: a little darker and damper than the dressed work. */
const RUBBLE_TINTS = MASONRY_TINTS.concat(['#6e705f', '#7a7462']);

/** Deck walking surface height at local x. */
export function deckY(x) {
  const k = Math.min(1, Math.abs(x) / 3.5);
  return 0.05 + (DECK_CROWN - 0.05) * Math.pow(Math.cos((k * Math.PI) / 2), 1.1);
}
const deckSlope = (x) => (deckY(x + 0.01) - deckY(x - 0.01)) / 0.02;
const intradosY = (x) => Y0 + Math.sqrt(Math.max(0, R * R - x * x));
const XE = RE * Math.sin(THETA); // extrados end
const extradosY = (x) => (Math.abs(x) <= XE ? Y0 + Math.sqrt(Math.max(0, RE * RE - x * x)) : -Infinity);

export function buildBridge(ctx, B, rng) {
  const MM = M();
  // ── frame from the two path ends ──
  const A = PATHS.bridge[PATHS.bridge.length - 1], Bp = PATHS.farBank[0];
  const cx = (A.x + Bp.x) / 2, cz = (A.z + Bp.z) / 2;
  const X = new THREE.Vector3(Bp.x - A.x, 0, Bp.z - A.z).normalize();
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  const frame = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(cx, 0, cz);
  const F = B.at(frame);
  const toWorld = (x, y, z, out = new THREE.Vector3()) => out.set(x, y, z).applyMatrix4(frame);
  const _w = new THREE.Vector3();
  const ground = (x, z) => {
    toWorld(x, 0, z, _w);
    return getHeight(_w.x, _w.z);
  };
  const tint = () => stoneTint(rng);
  const dressed = () => stoneTint(rng, DRESSED_TINTS, 0.75);
  const ivyCards = new Cards();

  // ── arch ring + barrel vault ─────────────────────────────────────────────
  const NV = 17;
  const a0 = Math.PI / 2 + THETA, a1 = Math.PI / 2 - THETA;
  for (let i = 0; i < NV; i++) {
    const s0 = a0 + ((a1 - a0) * i) / NV, s1 = a0 + ((a1 - a0) * (i + 1)) / NV;
    const key = i === (NV - 1) / 2;
    // split the barrel into staggered courses across the width
    const cuts = [-HALF_W];
    let z = -HALF_W;
    const first = i % 2 ? 0.42 : 0.62;
    z += first;
    while (z < HALF_W - 0.3) {
      cuts.push(z);
      z += rng.range(0.5, 0.72);
    }
    cuts.push(HALF_W);
    for (let k = 0; k < cuts.length - 1; k++) {
      const face = k === 0 || k === cuts.length - 2;
      const za = cuts[k], zb = cuts[k + 1];
      const depth = zb - za - 0.025;
      const outer = R + RING * (face ? rng.range(0.95, 1.12) : 0.9) + (key && face ? 0.1 : 0);
      const zc = (za + zb) / 2 + (k === 0 ? -0.05 : k === cuts.length - 2 ? 0.05 : 0) + (key && face ? Math.sign((za + zb) / 2) * 0.03 : 0);
      if (face) {
        // the face voussoirs: rounded, individually tinted wedges with dark joints
        const seg = archStone(rng, R - 0.02, outer, Math.min(s0, s1) + 0.012, Math.max(s0, s1) - 0.012, depth + 0.04, { color: key ? '#bca680' : dressed(), box: 0.36 });
        seg.translate(rng.jitter(0.008), Y0 + rng.jitter(0.006), zc);
        F.add(MM.stone, seg);
      } else {
        // the barrel vault inside (seen from below only): plain wedges
        const seg = arcSegment(R, outer, Math.min(s0, s1) + 0.008, Math.max(s0, s1) - 0.008, depth, 2, 0);
        seg.translate(rng.jitter(0.008), Y0 + rng.jitter(0.006), zc);
        F.add(MM.stone, seg, { color: stoneTint(rng, DRESSED_TINTS, 0.5), cast: false });
      }
    }
  }
  // footing stones where the arch springs (partly in the water)
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const zc = -HALF_W + 0.3 + k * 0.55 + rng.jitter(0.08);
      const g = roundStone(rng, rng.range(0.6, 0.8), rng.range(0.45, 0.6), rng.range(0.5, 0.65), { color: stoneTint(rng, ['#6f6e60', '#77735f', '#6a6c5c']), box: 0.5, lump: 0.1 });
      xf(g, [sx * (SPAN_HALF + 0.2 + rng.jitter(0.05)), SPRING_Y - 0.28, zc], [0, rng.jitter(0.2), rng.jitter(0.06)]);
      F.add(MM.wallStone, g);
    }
  }

  // ── spandrel core (mortar) between the arch, the deck and the banks ──────
  const gMin = (x) => Math.min(ground(x, -HALF_W), ground(x, 0), ground(x, HALF_W));
  const coreBottom = (x) => (Math.abs(x) < XE - 0.02 ? extradosY(x) - 0.06 : Math.min(gMin(x) - 0.45, -0.3));
  {
    const shape = new THREE.Shape();
    const N = 48;
    const xs = [];
    for (let i = 0; i <= N; i++) xs.push(-END + (2 * END * i) / N);
    shape.moveTo(-END, Math.min(gMin(-END) - 0.45, -0.3));
    for (const x of xs) shape.lineTo(x, deckY(x) - 0.03);
    shape.lineTo(END, Math.min(gMin(END) - 0.45, -0.3));
    // underside: ground → extrados → ground
    for (let i = N; i >= 0; i--) {
      const x = xs[i];
      shape.lineTo(x, coreBottom(x));
    }
    const core = new THREE.ExtrudeGeometry(shape, { depth: W - 0.14, bevelEnabled: false, curveSegments: 1 });
    core.translate(0, 0, -(W - 0.14) / 2);
    // dark, damp mortar with moss in it: every joint between the face stones reads as a shadowed groove
    const dark = new THREE.Color(MORTAR), green = new THREE.Color('#465a28');
    paintFn(core, MORTAR, (x, y, z, i, c) => c.copy(dark).lerp(green, smooth01(0.3 + noiseA(x * 1.5, y * 2 + z) * 0.8 - y * 0.3)));
    F.add(MM.moss, core);
  }

  // ── rubble facing on both faces (spandrels + wing walls) ─────────────────
  const ferns = [];
  const faceStones = (side) => {
    const zf = side * (HALF_W - 0.07);
    let y = -0.75;
    let row = 0;
    while (y < DECK_CROWN) {
      // (courses of uneven height; long thin slabs among squarer blocks)
      const hc = rng.chance(0.25) ? rng.range(0.12, 0.17) : rng.range(0.19, 0.29);
      let x = -END - 0.15 + (row % 2 ? rng.range(0.1, 0.25) : 0);
      while (x < END + 0.1) {
        const wst = hc < 0.18 ? rng.range(0.42, 0.78) : rng.chance(0.2) ? rng.range(0.5, 0.68) : rng.range(0.22, 0.46);
        const xc = x + wst / 2;
        x += wst + 0.02;
        if (Math.abs(xc) > END) continue;
        const top = deckY(xc) - 0.01;
        let bot = y;
        let topY = Math.min(y + hc, top);
        // stay above the arch extrados (the voussoirs show there)
        if (Math.abs(xc) < XE + 0.12) bot = Math.max(bot, extradosY(Math.min(Math.abs(xc), XE)) + 0.02);
        // no need to go deep below the bank
        if (topY < ground(xc, zf) - 0.12) continue;
        const h = topY - bot;
        if (h < 0.08) continue;
        const g = cushionStone(rng, wst - 0.045, h - 0.04, rng.range(0.03, 0.06), { color: stoneTint(rng, bot < 0.1 ? ['#6e705f', '#77735f', '#7b7a68'] : RUBBLE_TINTS), segs: wst > 0.42 ? 12 : 10, round: rng.range(3.6, 5.5) });
        xf(g, [xc + rng.jitter(0.01), bot + h / 2, zf + side * rng.range(-0.005, 0.02)], [rng.jitter(0.03), (side < 0 ? Math.PI : 0) + rng.jitter(0.05), rng.jitter(0.05)]);
        F.add(MM.wallStone, g);
        if (bot > 0.1 && h > 0.15 && rng.chance(0.03)) ferns.push([xc, topY, side]);
      }
      y += hc + 0.01;
      row++;
    }
  };
  faceStones(1);
  faceStones(-1);
  // little ferns sprouting from the joints of the spandrels
  for (const [x, y, side] of ferns) wallFern(F, rng, [x, y, side * (HALF_W + 0.02)], [0, 0, side], { size: rng.range(0.2, 0.3) });

  // ── deck: gravel bed + flagstones + pebbles + moss ───────────────────────
  const innerHalf = HALF_W - PARAPET_T;
  {
    const bed = paramSurface(
      (u, v, p) => {
        const x = -END - 0.2 + u * (2 * END + 0.4);
        const z = innerHalf + 0.02 - v * (2 * innerHalf + 0.04);
        p.set(x, deckY(x) - 0.005 + noiseA(x * 3, z * 3) * 0.01, z);
      },
      64,
      6,
      { uv: (u, v, p) => [p.x / 1.6, p.z / 1.6] }
    );
    F.add(MM.soil, bed, { color: '#8a7a62', cast: false });
  }
  // cobbled with flat, squarish setts in rows across the deck (moss and grit
  // in every joint)
  {
    const SETT = LOD.k < 0.5 ? 0.3 : 0.22;
    let x = -END - 0.05;
    while (x < END + 0.05) {
      const len = SETT * rng.range(0.85, 1.15);
      const xc = x + len / 2;
      const sl = Math.atan(deckSlope(xc));
      let z = -innerHalf + rng.range(0.0, 0.05);
      while (z < innerHalf - 0.06) {
        const wid = SETT * rng.range(0.8, 1.4);
        const zc = Math.min(z + wid / 2, innerHalf - 0.08);
        z += wid + rng.range(0.018, 0.04);
        if (rng.chance(0.04)) continue; // a missing sett: grit & moss
        // (a 4-segment rounded box: a square sett, 16 triangles)
        const s = roundStone(rng, len * 0.86 * 1.41, 0.05 + rng.range(0, 0.02), wid * 0.84 * 1.41, { color: stoneTint(rng, ['#857e70', '#7c776c', '#8a826f', '#77736a', '#918774', '#6f7262']), box: 0.3, lump: 0.08, under: 0.22, sag: -0.015, segs: 4, rows: 3 });
        s.rotateY(Math.PI / 4);
        xf(s, [xc + rng.jitter(0.015), deckY(xc) + 0.012 + rng.jitter(0.006), zc], [rng.jitter(0.04), rng.jitter(0.12), sl + rng.jitter(0.04)]);
        F.add(MM.pebble, s, { cast: false });
      }
      x += len + rng.range(0.018, 0.04);
    }
    // moss tufts in the joints and along the parapet feet
    for (let i = 0; i < 46; i++) {
      const xc = rng.range(-END + 0.1, END - 0.1);
      const edge = rng.chance(0.6);
      const zc = edge ? (rng.chance(0.5) ? 1 : -1) * (innerHalf - rng.range(0.02, 0.1)) : rng.range(-innerHalf + 0.1, innerHalf - 0.1);
      const g = mossGeo(rng, { r: rng.range(0.06, 0.14), h: rng.range(0.03, 0.06), sx: rng.range(1, 2.2), sz: 0.7 });
      xf(g, [xc, deckY(xc) + 0.01, zc], [0, rng.next() * TAU, Math.atan(deckSlope(xc))]);
      F.add(MM.moss, g, { color: rng.pick(['#6f8f3a', '#5d7d30', '#7f9a44']), cast: false });
    }
  }

  // ── parapets: coursed stones + capstones, end piers ──────────────────────
  const piers = [];
  for (const side of [-1, 1]) {
    const zc = side * (HALF_W - PARAPET_T / 2);
    // irregular coursed rubble: each column of the wall split at its own
    // height (or one tall stone through both), so no joint runs straight
    {
      let x = -END + 0.32;
      while (x < END - 0.32) {
        const len = Math.min(rng.chance(0.25) ? rng.range(0.45, 0.66) : rng.range(0.18, 0.42), END - 0.32 - x);
        if (len < 0.1) break;
        const xc = x + len / 2;
        const tall = rng.chance(0.2);
        const split = rng.range(0.14, 0.25);
        const parts = tall ? [[0, 0.38]] : [[0, split], [split, 0.38]];
        for (const [h0, h1] of parts) {
          const hc = h1 - h0;
          const g = roundStone(rng, len - 0.03, hc - 0.028, PARAPET_T - rng.range(0, 0.04), { color: tint(), box: 0.24, lump: 0.1, sag: 0.01, under: 0.3 });
          xf(g, [xc + rng.jitter(0.012), deckY(xc) + h0 + hc / 2, zc + rng.jitter(0.016)], [rng.jitter(0.035), rng.jitter(0.05), Math.atan(deckSlope(xc)) + rng.jitter(0.06)]);
          F.add(MM.wallStone, g);
        }
        x += len;
      }
    }
    // capstones: flat slabs of uneven length, overhanging a little, moss in patches
    let x = -END + 0.3;
    while (x < END - 0.3) {
      const len = Math.min(rng.range(0.3, 0.78), END - 0.3 - x);
      if (len < 0.15) break;
      const xc = x + len / 2;
      const th = rng.range(0.07, 0.11);
      const g = roundStone(rng, len - 0.025, th, PARAPET_T + rng.range(0.06, 0.15), { color: dressed(), box: 0.22, sag: 0.0, lump: 0.08 });
      xf(g, [xc, deckY(xc) + 0.39 + th / 2 + 0.005, zc + rng.jitter(0.025)], [rng.jitter(0.04), rng.jitter(0.06), Math.atan(deckSlope(xc)) + rng.jitter(0.04)]);
      F.add(MM.wallStone, g);
      // a patch of moss off-centre, now and then spilling over the edge
      if (rng.chance(0.38)) {
        const m = mossGeo(rng, { r: rng.range(0.05, 0.1), h: rng.range(0.025, 0.045), sx: rng.range(1.2, 2), sz: 0.7 });
        xf(m, [xc + rng.jitter(len * 0.35), deckY(xc) + 0.39 + th, zc + rng.jitter(0.07)], [0, rng.jitter(0.5), Math.atan(deckSlope(xc))]);
        F.add(MM.moss, m, { color: rng.pick(['#7a9640', '#62832f', '#6f8f3a']), cast: false });
      }
      if (rng.chance(0.2)) {
        const m = mossGeo(rng, { r: rng.range(0.05, 0.08), h: 0.04, sx: 1.4, sz: 0.6, seg: 7 });
        xf(m, [xc + rng.jitter(0.12), deckY(xc) + 0.36, zc + side * (PARAPET_T / 2 + 0.05)], [side * 1.2, rng.jitter(0.3), 0]);
        F.add(MM.moss, m, { color: rng.pick(['#5d7d30', '#6f8f3a']), cast: false });
      }
      x += len;
    }
    // end piers
    for (const sx of [-1, 1]) {
      const px = sx * (END - 0.12);
      const gy = Math.min(ground(px, zc), deckY(px));
      const top = deckY(px) + PARAPET_H + 0.2;
      let y = gy - 0.15;
      while (y < top - 0.12) {
        const h = Math.min(rng.range(0.2, 0.26), top - 0.12 - y);
        const g = roundStone(rng, 0.37, h - 0.025, 0.37, { color: tint(), box: 0.38 });
        xf(g, [px + rng.jitter(0.01), y + h / 2, zc], [0, rng.jitter(0.08), 0]);
        F.add(MM.wallStone, g);
        y += h;
      }
      // an overhanging capstone with a dressed ball finial on a little plinth
      const base = roundStone(rng, 0.46, 0.1, 0.46, { color: dressed(), box: 0.3 });
      xf(base, [px, y + 0.035, zc], [0, rng.jitter(0.06), 0]);
      F.add(MM.wallStone, base);
      const mc = mossGeo(rng, { r: 0.13, h: 0.05, sx: 1.2 });
      xf(mc, [px + rng.jitter(0.06), y + 0.085, zc + rng.jitter(0.06)], [0, rng.next() * TAU, 0]);
      F.add(MM.moss, mc, { color: '#6f8f3a', cast: false });
      F.add(MM.stone, new THREE.CylinderGeometry(0.07, 0.09, 0.06, 10).translate(px, y + 0.11, zc), { color: '#a8977a' });
      F.add(MM.stone, new THREE.SphereGeometry(0.1, 12, 8).translate(px, y + 0.22, zc), { color: '#b09f80' });
      piers.push({ x: px, z: zc, top: y + 0.32, side, sx });
    }
  }

  // ── greenery: ivy over the parapets, ferns, grass & toadstools at the feet ──
  for (const side of [-1, 1]) {
    const zf = side * (HALF_W + 0.02);
    const strands = rng.int(4, 6);
    for (let i = 0; i < strands; i++) {
      const xc = rng.range(-2.6, 2.6);
      const y0 = deckY(xc) + 0.45;
      addIvy(F, rng, [xc, y0, zf], [rng.jitter(0.4), -1, 0], {
        length: rng.range(0.6, 1.4),
        droop: 1.2,
        size: 0.12,
        density: 1.3,
        normal: [0, 0, side],
        cards: ivyCards,
        surface: (p, n) => {
          p.z = zf + side * 0.02;
          n.set(0, 0, side);
        },
      });
    }
  }
  // at the four corners where the bridge beds into the banks
  for (const sx of [-1, 1]) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const x = sx * rng.range(2.9, 4.0);
        const z = side * (HALF_W + rng.range(0.15, 0.9));
        const gy = ground(x, z);
        if (gy < -0.5) continue; // in the water
        if (side === BIKE_SPOT.side && Math.hypot(x - BIKE_SPOT.x, z - side * (HALF_W + BIKE_SPOT.offset)) < 0.75) continue; // the bike leans here
        const r = rng.next();
        if (r < 0.4) plantFern(F, rng, x, gy, z, { size: rng.range(0.35, 0.6), fronds: rng.int(6, 9) });
        else if (r < 0.75) plantGrass(F, rng, x, gy, z, { size: rng.range(0.25, 0.4), blades: 4 });
        else if (r < 0.88) addFlower(F, rng, x, gy, z, { size: 0.05, stem: 0.16 });
        else addToadstool(F, rng, x, gy, z, { size: rng.range(0.07, 0.11), color: rng.chance(0.7) ? '#c4301f' : '#d7832e' });
      }
    }
  }
  // grass in the deck's joints near the ends
  for (let i = 0; i < 10; i++) {
    const x = (rng.chance(0.5) ? -1 : 1) * rng.range(2.2, 3.4);
    const z = (rng.chance(0.5) ? -1 : 1) * (innerHalf - 0.05);
    plantGrass(F, rng, x, deckY(x), z, { size: 0.16, blades: 3 });
  }

  // ── lantern posts at both ends (on the +Z side, by the end piers) ────────
  const lanterns = [];
  for (const p of piers.filter((q) => q.side === 1)) {
    const x = p.x + p.sx * 0.38, z = p.z + 0.32;
    const gy = ground(x, z);
    const h = 1.75;
    const lean = p.sx * 0.03;
    const post = taperTube([[x, gy - 0.2, z], [x + lean, gy + h * 0.5, z + 0.01], [x + lean * 2, gy + h, z - 0.01]], 0.06, 0.045, 6, 8);
    F.add(MM.timber, post, { color: '#8d8274' });
    // bracket arm reaching over the path end, with a knee brace
    const ax = x + lean * 2, ay = gy + h - 0.12;
    const tip = [ax - p.sx * 0.42, ay, z - 0.12];
    F.add(MM.timber, xf(board(0.5, 0.06, 0.06, { rng }), [(ax + tip[0]) / 2, ay, (z + tip[2]) / 2], [0, Math.atan2(-(tip[2] - z), tip[0] - ax), 0]), { color: '#8d8274' });
    F.add(MM.timber, rod([ax, ay - 0.32, z], [(ax + tip[0]) / 2, ay - 0.02, (z + tip[2]) / 2], 0.022, 0.022, 5), { color: '#8d8274' });
    // iron hook & chain
    F.add(MM.metal, rod([tip[0], ay - 0.03, tip[2]], [tip[0], ay - 0.2, tip[2]], 0.008, 0.008, 4), { color: IRON, cast: false });
    const lantern = buildLantern(F, MM, rng, tip[0], ay - 0.2, tip[2]);
    lanterns.push(lantern);
    // a mossy stone & toadstools at the foot
    addToadstool(F, rng, x + 0.15, gy, z + 0.12, { size: 0.09 });
    addToadstool(F, rng, x + 0.22, gy, z + 0.02, { size: 0.06 });
  }

  flushCards(F, ivyCards, MM.ivy, null, 0);

  // world-space anchors
  const anchors = {
    lanterns: lanterns.map((l) => toWorld(l.x, l.y, l.z).clone()),
    /** Inner face of a parapet (side ±1) at local x, at deck height. */
    parapet: (x, side) => toWorld(x, deckY(x), side * (innerHalf - 0.02)).clone(),
    /** Outer face of a parapet at local x. */
    parapetOuter: (x, side) => toWorld(x, deckY(x), side * (HALF_W + 0.02)).clone(),
    centre: toWorld(0, DECK_CROWN, 0).clone(),
  };
  return { frame, toWorld, deckY, halfWidth: HALF_W, innerHalf, length: END * 2, anchors, ground, X, Z };
}

/** A small iron lantern hanging at (x, y, z) (top of the ring), glass glowing; returns the glow centre. */
function buildLantern(F, MM, rng, x, y, z) {
  const s = 0.9;
  const parts = [];
  parts.push([new THREE.TorusGeometry(0.03 * s, 0.008 * s, 4, 10).translate(0, -0.02, 0), MM.metal, IRON]);
  parts.push([new THREE.ConeGeometry(0.15 * s, 0.11 * s, 4, 1).rotateY(Math.PI / 4).translate(0, -0.1 * s, 0), MM.metal, IRON]);
  parts.push([new THREE.BoxGeometry(0.19 * s, 0.018 * s, 0.19 * s).translate(0, -0.16 * s, 0), MM.metal, IRON]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    parts.push([new THREE.BoxGeometry(0.02 * s, 0.24 * s, 0.02 * s).translate(Math.sin(a) * 0.09 * s, -0.29 * s, Math.cos(a) * 0.09 * s), MM.metal, IRON]);
  }
  parts.push([new THREE.CylinderGeometry(0.075 * s, 0.07 * s, 0.22 * s, 4, 1).rotateY(Math.PI / 4).translate(0, -0.29 * s, 0), MM.lamp, null]);
  parts.push([new THREE.CylinderGeometry(0.11 * s, 0.09 * s, 0.03 * s, 4, 1).rotateY(Math.PI / 4).translate(0, -0.42 * s, 0), MM.metal, IRON]);
  for (const [g, m, c] of parts) F.add(m, g.translate(x, y, z), { color: c, cast: false });
  return { x, y: y - 0.29 * s, z };
}

export { SPAN_HALF, HALF_W, END as BRIDGE_END };
