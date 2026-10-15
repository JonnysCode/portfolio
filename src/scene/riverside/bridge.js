// ─────────────────────────────────────────────────────────────────────────────
// The stone arch bridge (RIVERSIDE.bridge) — a little humpbacked packhorse
// bridge connecting the end of PATHS.bridge to the start of PATHS.farBank,
// built the way a mason would (ref 6e5c3de5):
//
//   • a segmental arch ring of fifteen equal dressed voussoirs, every joint
//     radial, the intrados one clean flush curve, the keystone a touch proud
//     (in height and out of the face); the barrel vault laid in staggered
//     courses underneath
//   • spandrel and wing walls of coursed stone, laid flush, each stone of the
//     lowest course cut to the curve of the arch ring (no gaps, no teeth);
//     a projecting string course at deck level following the hump
//   • low parapets of two coursed rows under a continuous coping of equal
//     saddle-backed copes, square end piers with pyramid caps
//   • an inset cobbled deck: rows of square setts in running bond between
//     the parapets, moss in the joints
//   • moss only on top surfaces (copes, pier caps, the deck's joints), a few
//     ivy strands over the parapets, ferns & toadstools at the four corners
//   • at night: a small iron lantern on each of the four end piers and a
//     sagging string of fairy lights along the downstream parapet
//
// Local frame: origin at the bridge centre on y = 0, +X from the west
// abutment to the east one, +Z the downstream (camera) face.
// Returns { frame, toWorld, deckY(x), halfWidth, innerHalf, length, anchors,
//           ground, X, Z } — anchors.lanterns (4 glass centres, world),
// anchors.fairy (bulb positions, world), parapet(x, side), parapetOuter(x, side), centre.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { PATHS } from '../../world/layout.js';
import { getHeight } from '../../world/ground.js';
import { materials } from '../../core/materials.js';
import {
  M, TAU, IRON, LOD, Cards, xf, mossGeo, paramSurface, sagCurve,
  plantFern, plantGrass, addFlower, addToadstool, addIvy, flushCards, noiseA, smooth01,
  cushionStone, stoneTint, paintStone, wallFern, paintFn, deform, DRESSED_TINTS, MASONRY_TINTS,
} from './kit.js';

// arch & deck dimensions
const SPAN_HALF = 2.6; // intrados half span
const SPRING_Y = -0.45; // springing line
const CROWN_Y = 0.72; // intrados crown
const RING = 0.36; // voussoir depth (radial)
const R = (SPAN_HALF * SPAN_HALF + (CROWN_Y - SPRING_Y) ** 2) / (2 * (CROWN_Y - SPRING_Y));
const Y0 = CROWN_Y - R; // arch centre
const RE = R + RING;
const THETA = Math.asin(SPAN_HALF / R);
const W = 2.2; // overall width
const HALF_W = W / 2;
const PARAPET_T = 0.24;
const WALL_H = 0.38; // parapet wall above the deck (under the coping)
const COPE_H = 0.09;
const PARAPET_TOP = WALL_H + COPE_H + 0.02; // (the saddle-back's ridge)
const END = 3.62; // where the deck meets the paths
const DECK_CROWN = 1.3;
const DECK_FLAT = 3.5;
const NV = 15; // voussoirs (odd: one keystone)
/** Where the vintage bike leans on the downstream parapet (local x, side) — kept clear of plants. */
export const BIKE_SPOT = { x: 3.05, side: 1, offset: 0.27 };
/** The profile the water mirrors (water.js): arch, deck and parapet in the bridge's local frame. */
export const BRIDGE_PROFILE = { span: SPAN_HALF, r: R, y0: Y0, end: END, crown: DECK_CROWN, flat: DECK_FLAT, top: PARAPET_TOP, halfW: HALF_W };

/** Deck walking surface height at local x (ambient/snailpost.js keeps a copy of this profile). */
export function deckY(x) {
  const k = Math.min(1, Math.abs(x) / DECK_FLAT);
  return 0.05 + (DECK_CROWN - 0.05) * Math.pow(Math.cos((k * Math.PI) / 2), 1.1);
}
const deckSlope = (x) => (deckY(x + 0.01) - deckY(x - 0.01)) / 0.02;
const XE = RE * Math.sin(THETA); // extrados end
const extradosY = (x) => (Math.abs(x) <= XE ? Y0 + Math.sqrt(Math.max(0, RE * RE - x * x)) : -Infinity);

/** The low tier's masonry: a fieldstone wall texture on the core (one material, shared with the workshop). */
export const lowWall = () => materials.surface('masonry', { vertexColors: true, mossy: 0.35, scale: 0.75 });
/**
 * The bridge's dressed stone: the single-stone surface (fine grain, a rare
 * hairline crack, worn pale edges) — far quieter than the rock texture — with
 * moss only where it can settle, on up-facing surfaces.
 */
const dressedStone = () => materials.surface('stone', { vertexColors: true, mossy: 0.14, scale: 0.7, bump: 0.8 });

const V = (x, y, z) => new THREE.Vector3(x, y, z);
/**
 * A dressed stone from its 8 corners (index = i + 2j + 4k), every corner
 * chamfered by c along its three edges: a crisp block with softly broken
 * arrises (ConvexGeometry, flat-shaded). topOnly: the bottom corners (j = 0)
 * stay sharp (setts, copes — their undersides are never seen).
 * ridge: lift the top face's centre line along i by this much (a saddle-back cope).
 */
function hullStone(c8, c, { topOnly = false, ridge = 0 } = {}) {
  const pts = [];
  for (let n = 0; n < 8; n++) {
    const p = c8[n];
    if (topOnly && !(n & 2)) {
      pts.push(p.clone());
      continue;
    }
    for (const bit of [1, 2, 4]) {
      const q = c8[n ^ bit];
      const l = p.distanceTo(q) || 1;
      pts.push(p.clone().lerp(q, Math.min(c, l * 0.42) / l));
    }
  }
  if (ridge) {
    // two points on the top face's centre line, raised
    for (const i of [0, 1]) {
      const a = c8[i + 2], b = c8[i + 2 + 4];
      const m = a.clone().lerp(b, 0.5);
      const along = c8[(i ^ 1) + 2].clone().sub(a).normalize().multiplyScalar(c * 0.6);
      pts.push(m.add(along).setY(m.y + ridge));
    }
  }
  return new ConvexGeometry(pts);
}
/** A block x0..x1 whose bottom and top follow lines (yb0 → yb1, yt0 → yt1), z0..z1. */
function slab(x0, x1, yb0, yb1, yt0, yt1, z0, z1) {
  const c = [];
  for (let n = 0; n < 8; n++) {
    const i = n & 1, j = (n >> 1) & 1, k = (n >> 2) & 1;
    const x = i ? x1 : x0;
    const y = j ? (i ? yt1 : yt0) : i ? yb1 : yb0;
    c.push(V(x, y, k ? z1 : z0));
  }
  return c;
}
/** A voussoir wedge: radii r0 → r1, angles a0 → a1 around the arch centre, z0 → z1. */
function wedge(r0, r1, a0, a1, z0, z1) {
  const c = [];
  for (let n = 0; n < 8; n++) {
    const i = n & 1, j = (n >> 1) & 1, k = (n >> 2) & 1;
    const r = i ? r1 : r0, a = j ? a1 : a0;
    c.push(V(Math.cos(a) * r, Y0 + Math.sin(a) * r, k ? z1 : z0));
  }
  return c;
}

export function buildBridge(ctx, B, rng) {
  const MM = M();
  const MB = dressedStone();
  const lo = LOD.k < 0.5;
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
  // dressed sandstone: one warm family, little spread — a mason's choice of stone
  const dressed = (spread = 0.35) => stoneTint(rng, DRESSED_TINTS, spread);
  const stone = (geo, color) => F.add(MB, paintStone(geo, color));
  const ivyCards = new Cards();
  const innerHalf = HALF_W - PARAPET_T;

  // ── arch ring: fifteen equal voussoirs on each face ─────────────────────
  const a0 = Math.PI / 2 + THETA, a1 = Math.PI / 2 - THETA;
  const dA = (a1 - a0) / NV;
  const JOINT = 0.012 / R; // half a joint, in radians
  const KEY = (NV - 1) / 2;
  for (let i = 0; i < NV; i++) {
    const s0 = a0 + dA * i, s1 = s0 + dA;
    const key = i === KEY;
    const r1 = RE + (key ? 0.07 : 0);
    const tint = key ? '#c9b48e' : dressed(0.3);
    for (const side of [-1, 1]) {
      const zf = side * (HALF_W + 0.03 + (key ? 0.025 : 0));
      const zb = side * (HALF_W - 0.36);
      const c8 = wedge(R, r1, Math.min(s0, s1) + JOINT, Math.max(s0, s1) - JOINT, Math.min(zf, zb), Math.max(zf, zb));
      stone(hullStone(c8, 0.024), tint);
    }
  }
  // the barrel vault underneath: the same courses, two or three stones across, staggered
  {
    const zIn = HALF_W - 0.36;
    for (let i = 0; i < NV; i++) {
      const s0 = a0 + dA * i, s1 = s0 + dA;
      const cuts = [-zIn];
      let z = -zIn + (i % 2 ? 0.36 : 0.62);
      while (z < zIn - 0.25) {
        cuts.push(z);
        z += rng.range(0.55, 0.75);
      }
      cuts.push(zIn);
      for (let k = 0; k < cuts.length - 1; k++) {
        const c8 = wedge(R + 0.004, R + 0.22, Math.min(s0, s1) + JOINT, Math.max(s0, s1) - JOINT, cuts[k] + 0.008, cuts[k + 1] - 0.008);
        const g = hullStone(c8, 0.014);
        F.add(MB, paintStone(g, stoneTint(rng, DRESSED_TINTS, 0.4)), { cast: false });
      }
    }
  }
  // impost blocks where the ring springs from the abutments (half buried in the banks)
  for (const sx of [-1, 1]) {
    const xa = sx * (SPAN_HALF + 0.02), xb = sx * (SPAN_HALF + 0.62);
    let z = -HALF_W - 0.04;
    while (z < HALF_W + 0.03) {
      const len = Math.min(rng.range(0.5, 0.7), HALF_W + 0.04 - z);
      for (const [yb, yt] of [[SPRING_Y - 0.62, SPRING_Y - 0.3], [SPRING_Y - 0.3, SPRING_Y - 0.01]]) {
        const c8 = slab(Math.min(xa, xb), Math.max(xa, xb), yb, yb, yt, yt, z + 0.008, z + len - 0.008);
        stone(hullStone(c8, 0.02), dressed(0.45));
      }
      z += len;
    }
  }

  // ── core (mortar) between the arch, the deck and the banks ──────────────
  const gMin = (x) => Math.min(ground(x, -HALF_W), ground(x, 0), ground(x, HALF_W));
  const coreBottom = (x) => (Math.abs(x) < XE - 0.02 ? extradosY(x) - 0.06 : Math.min(gMin(x) - 0.45, -0.3));
  const MORTAR = new THREE.Color('#6b6656'), MOSSY = new THREE.Color('#5a6a3a');
  {
    const shape = new THREE.Shape();
    const N = 48;
    const xs = [];
    for (let i = 0; i <= N; i++) xs.push(-END + (2 * END * i) / N);
    shape.moveTo(-END, Math.min(gMin(-END) - 0.45, -0.3));
    for (const x of xs) shape.lineTo(x, deckY(x) - 0.02);
    shape.lineTo(END, Math.min(gMin(END) - 0.45, -0.3));
    for (let i = N; i >= 0; i--) shape.lineTo(xs[i], coreBottom(xs[i]));
    const depth = W - 0.03;
    const core = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
    core.translate(0, 0, -depth / 2);
    // (lime mortar, a little damp and mossy low down: the joints between the
    // face stones read as soft shadowed lines, never black cracks)
    if (lo) F.add(lowWall(), paintFn(core, '#b9b2a2', (x, y, z, i, c) => c.multiplyScalar(0.85 + 0.15 * noiseA(x * 2, y * 2))));
    else F.add(MM.moss, paintFn(core, '#6b6656', (x, y, z, i, c) => c.copy(MORTAR).lerp(MOSSY, 0.3 * smooth01(0.4 + noiseA(x * 1.5, y * 2 + z) * 0.8 - y * 0.35))), { cast: true });
  }

  // ── spandrel & wing walls: coursed stone laid flush, cut to the ring ────
  const ferns = [];
  const keyLo = Math.PI / 2 - dA / 2 - JOINT, keyHi = Math.PI / 2 + dA / 2 + JOINT;
  /** Lowest y a spandrel stone may reach at local x (the arch ring's back, the keystone's shoulders). */
  const floorAt = (x) => {
    if (Math.abs(x) > XE + 0.01) return -Infinity;
    const a = Math.atan2(extradosY(x) - Y0, x);
    return extradosY(x) + 0.012 + (a > keyLo && a < keyHi ? 0.07 : 0);
  };
  const STRING_B = 0.105; // the string course's depth below the deck line
  const ceilAt = (x) => deckY(x) - STRING_B - 0.01;
  const faceStones = (side) => {
    const zf = side * HALF_W;
    let y = -0.95;
    let row = 0;
    while (y < DECK_CROWN - STRING_B) {
      // regular courses (now and then a thinner one), stones of varied length
      const hc = rng.chance(0.18) ? rng.range(0.15, 0.17) : rng.range(0.2, 0.24);
      let x = -END - 0.12 + (row % 2 ? rng.range(0.12, 0.22) : 0);
      while (x < END + 0.1) {
        const wst = rng.chance(0.25) ? rng.range(0.46, 0.6) : rng.range(0.26, 0.44);
        const xc = x + wst / 2;
        x += wst;
        if (Math.abs(xc) > END - 0.02) continue;
        const bot = Math.max(y, floorAt(xc)), top = Math.min(y + hc, ceilAt(xc));
        if (top - bot < 0.07) continue;
        if (top < ground(xc, zf) - 0.12) continue; // deep below the bank
        const g = cushionStone(rng, wst - 0.03, hc - 0.03, rng.range(0.014, 0.024), { color: stoneTint(rng, y < 0 ? ['#7c7a69', '#837f6c', '#8a8572'] : MASONRY_TINTS, 0.55), segs: wst > 0.42 ? 10 : 8, round: rng.range(4.2, 6), lump: 0.05, tuck: 0.01, rim: 0.74 });
        if (side < 0) g.rotateY(Math.PI);
        g.translate(xc, y + hc / 2, zf + side * 0.004);
        // cut to fit: the stone's underside follows the arch ring, its top the string course
        deform(g, (v) => {
          v.y = Math.min(Math.max(v.y, floorAt(v.x) + 0.004), ceilAt(v.x) - 0.004);
        });
        F.add(MB, g);
        if (bot > 0.15 && top - bot > 0.15 && rng.chance(0.025)) ferns.push([xc, top, side]);
      }
      y += hc;
      row++;
    }
  };
  if (!lo) {
    faceStones(1);
    faceStones(-1);
  }
  // little ferns sprouting from the joints of the spandrels
  for (const [x, y, side] of ferns) wallFern(F, rng, [x, y, side * (HALF_W + 0.02)], [0, 0, side], { size: rng.range(0.2, 0.28), fronds: 6 });

  // ── string course: a projecting band of dressed stone at deck level ────
  for (const side of [-1, 1]) {
    let x = -END + 0.02;
    while (x < END - 0.05) {
      const len = Math.min(rng.range(0.44, 0.56), END - 0.02 - x);
      if (len < 0.15) break;
      const xa = x + 0.006, xb = x + len - 0.006;
      const z0 = side * (HALF_W - 0.22), z1 = side * (HALF_W + 0.055);
      const c8 = slab(xa, xb, deckY(xa) - STRING_B, deckY(xb) - STRING_B, deckY(xa) - 0.004, deckY(xb) - 0.004, Math.min(z0, z1), Math.max(z0, z1));
      stone(hullStone(c8, 0.02), dressed(0.3));
      x += len;
    }
  }

  // ── deck: an inset cobbled path between the parapets ───────────────────
  {
    // the bedding: grit and moss in every joint
    const bed = paramSurface(
      (u, v, p) => {
        const x = -END - 0.15 + u * (2 * END + 0.3);
        const z = innerHalf + 0.01 - v * (2 * innerHalf + 0.02);
        p.set(x, deckY(x) + 0.004, z);
      },
      lo ? 32 : 64,
      4,
    );
    const grit = new THREE.Color('#7d7764'), green = new THREE.Color('#58702f');
    paintFn(bed, '#7d7764', (x, y, z, i, c) => c.copy(grit).lerp(green, smooth01(0.35 + noiseA(x * 2.2, z * 3.1) * 0.7 + (Math.abs(z) > innerHalf - 0.15 ? 0.35 : 0))));
    F.add(MM.moss, bed, { cast: false });
    // setts in rows across the deck, running bond, each sitting on the slope
    const SX = lo ? 0.26 : 0.185;
    const SZ = lo ? 0.32 : 0.24;
    let x = -END - 0.08;
    let row = 0;
    while (x < END + 0.08) {
      const len = SX * rng.range(0.92, 1.08);
      const xa = x + 0.012, xb = x + len - 0.012;
      const zs = [-innerHalf + 0.012];
      let z = -innerHalf + (row % 2 ? SZ * 0.55 : SZ * rng.range(0.9, 1.1));
      while (z < innerHalf - SZ * 0.4) {
        zs.push(z);
        z += SZ * rng.range(0.88, 1.12);
      }
      zs.push(innerHalf - 0.012);
      for (let k = 0; k < zs.length - 1; k++) {
        if (rng.chance(0.03)) continue; // a missing sett: grit & moss
        const za = zs[k] + 0.011, zb = zs[k + 1] - 0.011;
        const h = 0.045 + rng.range(0, 0.012);
        const lift = rng.jitter(0.004);
        const c8 = slab(xa, xb, deckY(xa) - 0.02, deckY(xb) - 0.02, deckY(xa) + h + lift, deckY(xb) + h + lift, za, zb);
        const g = hullStone(c8, 0.016, { topOnly: true });
        // (the river-stone material: worn setts, moss only in the joints around them)
        F.add(MM.pebble, g, { color: stoneTint(rng, ['#8e8574', '#857f72', '#978b74', '#7b776c', '#9a9078', '#7d7f72'], 0.5), cast: false });
      }
      x += len;
      row++;
    }
    // moss cushions along the parapet feet and in a few worn joints (top surfaces only)
    for (let i = 0; i < Math.round(30 * (LOD.k < 1 ? 0.6 : 1)); i++) {
      const xc = rng.range(-END + 0.25, END - 0.25);
      const edge = rng.chance(0.7);
      const zc = edge ? (rng.chance(0.5) ? 1 : -1) * (innerHalf - rng.range(0.02, 0.06)) : rng.range(-innerHalf + 0.15, innerHalf - 0.15);
      const g = mossGeo(rng, { r: rng.range(0.05, 0.1), h: rng.range(0.025, 0.045), sx: rng.range(1.2, 2.4), sz: 0.6 });
      xf(g, [xc, deckY(xc) + 0.03, zc], [0, edge ? 0 : rng.next() * TAU, Math.atan(deckSlope(xc))]);
      F.add(MM.moss, g, { color: rng.pick(['#6f8f3a', '#5d7d30', '#7f9a44']), cast: false });
    }
  }

  // ── parapets: two coursed rows under a continuous coping ───────────────
  const PX = END - 0.32; // the parapets run between the end piers
  for (const side of [-1, 1]) {
    const zo = side * (HALF_W - 0.004), zi = side * innerHalf;
    // the wall's core (lime mortar) following the hump
    {
      const g = paramSurface(
        (u, v, p) => {
          const x = -PX + u * 2 * PX;
          // v: 0 inner foot → 1 inner top → 2 outer top → 3 outer foot (a closed U)
          const t = v * 3;
          const z = t <= 1 ? zi : t >= 2 ? zo : zi + (zo - zi) * (t - 1);
          const y = t <= 1 ? deckY(x) - 0.01 + t * WALL_H : t >= 2 ? deckY(x) - 0.01 + (3 - t) * WALL_H : deckY(x) + WALL_H;
          p.set(x, y, z);
        },
        lo ? 16 : 32,
        3,
        { flip: side < 0 },
      );
      if (lo) F.add(lowWall(), paintFn(g, '#b9b2a2', (x, y, z, i, c) => c.multiplyScalar(0.85 + 0.15 * noiseA(x * 2, y * 2))));
      else F.add(MM.moss, paintFn(g, '#6b6656', (x, y, z, i, c) => c.copy(MORTAR)), { cast: true });
    }
    // coursed stones on both faces (one course of taller stones below the high tier)
    if (!lo) {
      const courses = LOD.k < 1 ? [[0, WALL_H]] : [[0, 0.2], [0.2, WALL_H]];
      for (const face of [-1, 1]) {
        const zf = face > 0 ? zo : zi; // face +1: outer, −1: inner
        const nz = face > 0 ? side : -side; // outward normal of this face
        courses.forEach(([h0, h1], ci) => {
          let x = -PX + (ci % 2 ? rng.range(0.1, 0.2) : 0);
          while (x < PX - 0.05) {
            const len = Math.min(rng.chance(0.2) ? rng.range(0.42, 0.55) : rng.range(0.24, 0.4), PX - x);
            if (len < 0.1) break;
            const xc = x + len / 2;
            const hc = h1 - h0;
            const g = cushionStone(rng, len - 0.028, hc - 0.028, rng.range(0.012, 0.02), { color: stoneTint(rng, MASONRY_TINTS, 0.5), segs: 8, round: rng.range(4.2, 6), lump: 0.05, tuck: 0.008, rim: 0.74 });
            if (nz < 0) g.rotateY(Math.PI);
            g.translate(xc, h0 + hc / 2, zf + nz * 0.004);
            // follow the hump
            deform(g, (v) => {
              v.y += deckY(v.x);
            });
            F.add(MB, g);
            x += len;
          }
        });
      }
    }
    // the coping: equal saddle-backed copes, a little overhang both sides
    let x = -PX - 0.04;
    let n = 0;
    while (x < PX + 0.04) {
      const len = Math.min(0.42 + rng.jitter(0.015), PX + 0.04 - x);
      if (len < 0.12) break;
      const xa = x + 0.008, xb = x + len - 0.008;
      const za = side * (innerHalf - 0.035), zb = side * (HALF_W + 0.035);
      const yb = (xx) => deckY(xx) + WALL_H;
      const c8 = slab(xa, xb, yb(xa), yb(xb), yb(xa) + COPE_H, yb(xb) + COPE_H, Math.min(za, zb), Math.max(za, zb));
      stone(hullStone(c8, 0.028, { topOnly: true, ridge: 0.02 }), dressed(0.28));
      // moss settling on the top, here and there spreading over a joint
      if (rng.chance(0.4)) {
        const xm = rng.chance(0.5) ? xb : xa + (xb - xa) * rng.range(0.3, 0.7);
        const m = mossGeo(rng, { r: rng.range(0.05, 0.085), h: rng.range(0.018, 0.03), sx: rng.range(1.2, 1.9), sz: 0.55 });
        xf(m, [xm, yb(xm) + COPE_H + 0.012, side * (HALF_W - PARAPET_T / 2) + rng.jitter(0.03)], [0, rng.jitter(0.3), Math.atan(deckSlope(xm))]);
        F.add(MM.moss, m, { color: rng.pick(['#7a9640', '#62832f', '#6f8f3a']), cast: false });
      }
      x += len;
      n++;
    }
  }

  // ── end piers: dressed blocks, a pyramid cap, a lantern on top ─────────
  const piers = [];
  for (const side of [-1, 1]) {
    const zc = side * (HALF_W - PARAPET_T / 2);
    for (const sx of [-1, 1]) {
      const px = sx * (END - 0.13);
      const gy = Math.min(ground(px, zc), deckY(px));
      const top = deckY(px) + WALL_H + 0.16;
      const S = 0.2; // half size
      let y = gy - 0.2;
      let k = 0;
      while (y < top - 0.08) {
        const h = Math.min(rng.range(0.2, 0.25), top - y);
        const o = (k % 2 ? 0.006 : -0.006);
        const c8 = slab(px - S + o, px + S + o, y + 0.006, y + 0.006, y + h - 0.006, y + h - 0.006, zc - S, zc + S);
        stone(hullStone(c8, 0.022), dressed(0.35));
        y += h;
        k++;
      }
      // the cap: an overhanging slab with a shallow pyramid
      const capB = y, capT = y + 0.07;
      const c8 = slab(px - S - 0.04, px + S + 0.04, capB, capB, capT, capT, zc - S - 0.04, zc + S + 0.04);
      stone(hullStone(c8, 0.02, { topOnly: true }), '#bfa985');
      const pyr = new ConvexGeometry([
        V(px - S - 0.01, capT, zc - S - 0.01), V(px + S + 0.01, capT, zc - S - 0.01), V(px - S - 0.01, capT, zc + S + 0.01), V(px + S + 0.01, capT, zc + S + 0.01),
        V(px - 0.05, capT + 0.09, zc - 0.05), V(px + 0.05, capT + 0.09, zc - 0.05), V(px - 0.05, capT + 0.09, zc + 0.05), V(px + 0.05, capT + 0.09, zc + 0.05),
      ]);
      stone(pyr, '#b9a37f');
      // moss on the cap's shoulders
      const mc = mossGeo(rng, { r: 0.09, h: 0.03, sx: 1.3 });
      xf(mc, [px + rng.jitter(0.08), capT + 0.012, zc + rng.jitter(0.08)], [0, rng.next() * TAU, 0]);
      F.add(MM.moss, mc, { color: '#6f8f3a', cast: false });
      piers.push({ x: px, z: zc, top: capT + 0.09, side, sx });
    }
  }

  // ── lanterns: a small iron lantern standing on each pier's cap ─────────
  const lanterns = [];
  for (const p of piers) {
    const lan = buildLantern(F, MM, p.x, p.top - 0.005, p.z);
    lanterns.push(lan);
  }

  // ── fairy lights: a sagging string along the downstream parapet ─────────
  const fairy = [];
  if (LOD.k >= 0.5) {
    const side = 1;
    const zs = side * (HALF_W + 0.05);
    const hooks = [];
    for (let i = 0; i <= 5; i++) {
      const x = -PX + 0.12 + ((2 * PX - 0.24) * i) / 5;
      hooks.push(V(x, deckY(x) + WALL_H + 0.015, zs));
    }
    for (let i = 0; i < hooks.length; i++) {
      const h = hooks[i];
      // a little iron hook under the coping's lip
      F.add(MM.metal, new THREE.TorusGeometry(0.014, 0.004, 3, 8, Math.PI).rotateZ(Math.PI).translate(h.x, h.y + 0.004, h.z), { color: IRON, cast: false });
      if (i === hooks.length - 1) break;
      const curve = sagCurve(h, hooks[i + 1], 0.11, 14);
      F.add(MM.vc, new THREE.TubeGeometry(curve, 14, 0.004, 3, false), { color: '#2a2622', cast: false });
      const nb = 5;
      for (let b = 1; b <= nb; b++) {
        const q = curve.getPoint(b / (nb + 1));
        F.add(MM.fairy, new THREE.SphereGeometry(0.022, 6, 4).scale(1, 1.25, 1).translate(q.x, q.y - 0.022, q.z), { cast: false });
        fairy.push(toWorld(q.x, q.y - 0.022, q.z).clone());
      }
    }
  }

  // ── greenery: ivy over the parapets, ferns, grass & toadstools at the feet ──
  for (const side of [-1, 1]) {
    const zf = side * (HALF_W + 0.06);
    const strands = side > 0 ? 2 : 3;
    for (let i = 0; i < strands; i++) {
      let xc = rng.range(-2.4, 2.4);
      if (side === BIKE_SPOT.side && Math.abs(xc - BIKE_SPOT.x) < 0.8) xc -= 1.2;
      const y0 = deckY(xc) + WALL_H + 0.02;
      addIvy(F, rng, [xc, y0, zf], [rng.jitter(0.4), -1, 0], {
        length: rng.range(0.5, 1.0),
        droop: 1.3,
        size: 0.11,
        density: 1.2,
        normal: [0, 0, side],
        cards: ivyCards,
        surface: (p, n) => {
          p.z = zf + side * 0.015;
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
        const z = side * (HALF_W + rng.range(0.18, 0.9));
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
  for (let i = 0; i < 8; i++) {
    const x = (rng.chance(0.5) ? -1 : 1) * rng.range(2.4, 3.4);
    const z = (rng.chance(0.5) ? -1 : 1) * (innerHalf - 0.05);
    plantGrass(F, rng, x, deckY(x) + 0.02, z, { size: 0.15, blades: 3 });
  }

  flushCards(F, ivyCards, MM.ivy, null, 0);

  // world-space anchors
  const anchors = {
    lanterns: lanterns.map((l) => toWorld(l.x, l.y, l.z).clone()),
    fairy,
    /** Inner face of a parapet (side ±1) at local x, at deck height. */
    parapet: (x, side) => toWorld(x, deckY(x), side * (innerHalf - 0.02)).clone(),
    /** Outer face of a parapet at local x. */
    parapetOuter: (x, side) => toWorld(x, deckY(x), side * (HALF_W + 0.06)).clone(),
    centre: toWorld(0, DECK_CROWN, 0).clone(),
  };
  return { frame, toWorld, deckY, halfWidth: HALF_W, innerHalf, length: END * 2, anchors, ground, X, Z };
}

/**
 * A small iron lantern standing at (x, y, z) (its foot): a base plate, four
 * corner posts round a glowing glass, a pyramid roof and a ring on top.
 * Returns the glass centre.
 */
function buildLantern(F, MM, x, y, z) {
  const s = 0.85;
  const parts = [];
  parts.push([new THREE.BoxGeometry(0.17 * s, 0.025 * s, 0.17 * s).translate(0, 0.0125 * s, 0), MM.metal, IRON]);
  parts.push([new THREE.BoxGeometry(0.12 * s, 0.03 * s, 0.12 * s).translate(0, 0.035 * s, 0), MM.metal, IRON]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    parts.push([new THREE.BoxGeometry(0.018 * s, 0.22 * s, 0.018 * s).translate(Math.sin(a) * 0.08 * s, 0.16 * s, Math.cos(a) * 0.08 * s), MM.metal, IRON]);
  }
  parts.push([new THREE.CylinderGeometry(0.07 * s, 0.07 * s, 0.2 * s, 4, 1).rotateY(Math.PI / 4).translate(0, 0.16 * s, 0), MM.lamp, null]);
  parts.push([new THREE.ConeGeometry(0.135 * s, 0.1 * s, 4, 1).rotateY(Math.PI / 4).translate(0, 0.32 * s, 0), MM.metal, IRON]);
  parts.push([new THREE.TorusGeometry(0.025 * s, 0.007 * s, 4, 10).translate(0, 0.39 * s, 0), MM.metal, IRON]);
  for (const [g, m, c] of parts) F.add(m, g.translate(x, y, z), { color: c, cast: false });
  return { x, y: y + 0.16 * s, z };
}

export { SPAN_HALF, HALF_W, END as BRIDGE_END };
