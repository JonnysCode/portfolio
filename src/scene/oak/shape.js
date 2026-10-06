// ─────────────────────────────────────────────────────────────────────────────
// The Great Oak's SHAPE — one place that knows where every root, limb, burl,
// hollow and the door niche are, so the trunk, roots, limbs, moss, ivy and
// details all agree with each other.
//
// Angles: azimuth `a` in radians measured from +Z towards +X around the trunk
// axis (OAK.x, OAK.z) — a = 0 is the front (the door), a = +90° is the right
// (+X), a = 180° the back. Heights are world Y.
//
// trunkRadius(a, y) is the sculpted bark surface. It follows oakRadiusAt(y)
// (layout.js) within about ±0.2 wherever other builders attach things (the
// front door zone, and the whole right side where the loft & its stairs are);
// the back and the left are free to bulge, burl and hollow.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OAK, oakRadiusAt, SPOTS } from '../../world/layout.js';
import { smoothstep, clamp } from '../../core/rng.js';
import { createNoise3D } from './noise3.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const CX = OAK.x;
export const CZ = OAK.z;
/** Height where the trunk forks into the limbs; the trunk dome closes at TRUNK_TOP. */
export const FORK_Y = 17;
export const TRUNK_TOP = 20.6;
/** Bark twist (radians per unit of height) — the trunk turns slowly as it rises. */
export const TWIST = 0.034;

/** World position at azimuth a, distance r from the trunk axis, height y. */
export function polar(a, r, y, out = new THREE.Vector3()) {
  return out.set(CX + Math.sin(a) * r, y, CZ + Math.cos(a) * r);
}
/** Azimuth of a world XZ point around the trunk axis. */
export function azimuthOf(x, z) {
  return Math.atan2(x - CX, z - CZ);
}
/** Signed smallest difference between two angles, in (−π, π]. */
export function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

// ─── Roots ───────────────────────────────────────────────────────────────────
// Each root: a0 (deg) and control points [ρ (distance from axis), Δa (deg),
// yc (centre height above the ground), w (half width), h (half height)].
// The first point sits inside the trunk; the last plunges into the soil.
// Cross-sections are tall near the trunk (buttress fins) and round further out.
// flare = how strongly the trunk swells towards this root near the ground.
// Clearances (see layout/ground): no roots in front of the door, none into the
// annex / porch / deck / door pads, and only LOW roots on the right side
// (a 60°–150°) where the loft's spiral stairs start.
export const ROOTS = [
  {
    id: 'front-right', // carries the tiny mouse door on its left flank
    a0: 45,
    flare: 1.0,
    pts: [
      [2.2, 0, 0.8, 0.9, 1.6],
      [3.5, -1, 0.4, 0.8, 1.15],
      [4.4, 0.5, 0.26, 0.74, 0.88],
      [5.1, 2.0, 0.16, 0.6, 0.64],
      [5.65, 2.6, 0.0, 0.45, 0.46],
      [6.0, 2.2, -0.32, 0.32, 0.32],
    ],
  },
  {
    id: 'right-long',
    a0: 62,
    flare: 1.05,
    pts: [
      [2.2, 0, 0.8, 0.95, 1.65],
      [3.6, 1.5, 0.42, 0.9, 1.18],
      [4.8, 3.0, 0.28, 0.76, 0.86],
      [6.0, 2.0, 0.44, 0.62, 0.72],
      [7.0, 4.0, 0.1, 0.52, 0.56],
      [7.9, 6.5, 0.26, 0.44, 0.46],
      [8.7, 7.4, -0.02, 0.36, 0.36],
      [9.3, 7.0, -0.36, 0.26, 0.26],
    ],
  },
  {
    id: 'right-low', // spiral-stairs side — kept low near the bark
    a0: 92,
    flare: 0.55,
    pts: [
      [2.2, 0, 0.45, 0.85, 1.15],
      [3.6, 0, 0.16, 0.75, 0.74],
      [4.6, 2.6, 0.12, 0.6, 0.55],
      [5.6, 4.0, 0.15, 0.46, 0.44],
      [6.4, 3.6, -0.05, 0.36, 0.34],
      [6.9, 2.8, -0.34, 0.26, 0.25],
    ],
  },
  {
    id: 'back-right',
    a0: 170,
    flare: 1.05,
    pts: [
      [2.2, 0, 0.8, 1.0, 1.7],
      [3.6, 1.5, 0.42, 0.9, 1.15],
      [5.0, 4.0, 0.3, 0.74, 0.82],
      [6.3, 4.8, 0.42, 0.6, 0.66],
      [7.3, 2.6, 0.05, 0.5, 0.52],
      [8.1, 0.8, -0.32, 0.36, 0.36],
    ],
  },
  {
    id: 'back',
    a0: 195,
    flare: 1.15,
    pts: [
      [2.2, 0, 0.85, 1.05, 1.8],
      [3.8, -1.6, 0.45, 0.95, 1.25],
      [5.2, -4.6, 0.3, 0.78, 0.86],
      [6.6, -4.5, 0.5, 0.62, 0.7],
      [7.8, -1.5, 0.1, 0.52, 0.56],
      [8.8, 1.3, 0.28, 0.44, 0.46],
      [9.6, 2.1, -0.05, 0.34, 0.34],
      [10.1, 1.7, -0.42, 0.25, 0.25],
    ],
  },
  {
    id: 'back-left',
    a0: 221,
    flare: 1.0,
    pts: [
      [2.2, 0, 0.8, 0.95, 1.6],
      [3.6, 1.7, 0.4, 0.85, 1.1],
      [4.8, 3.7, 0.28, 0.7, 0.78],
      [6.0, 2.0, 0.36, 0.56, 0.6],
      [7.0, -0.8, 0.02, 0.45, 0.46],
      [7.6, -1.5, -0.32, 0.32, 0.32],
    ],
  },
  {
    id: 'left-back',
    a0: 245,
    flare: 1.1,
    pts: [
      [2.2, 0, 0.85, 1.0, 1.75],
      [3.7, 0, 0.45, 0.92, 1.2],
      [5.0, -3.6, 0.3, 0.75, 0.84],
      [6.3, -4.2, 0.44, 0.6, 0.66],
      [7.5, -2.4, 0.06, 0.5, 0.52],
      [8.4, 0, 0.2, 0.42, 0.42],
      [9.0, 1.0, -0.32, 0.3, 0.3],
    ],
  },
  {
    id: 'left', // passes behind the annex
    a0: 264,
    flare: 0.95,
    pts: [
      [2.2, 0, 0.75, 0.9, 1.5],
      [3.5, -1.7, 0.38, 0.82, 1.0],
      [4.6, -4.5, 0.25, 0.68, 0.72],
      [5.6, -5.7, 0.22, 0.54, 0.54],
      [6.4, -6.5, -0.05, 0.42, 0.42],
      [6.9, -6.5, -0.36, 0.3, 0.3],
    ],
  },
  // smaller roots between the big ones
  {
    id: 'small-backleft',
    a0: 233,
    flare: 0.5,
    pts: [
      [2.4, 0, 0.45, 0.66, 0.95],
      [3.7, 0, 0.15, 0.56, 0.56],
      [4.6, -2.0, 0.08, 0.43, 0.4],
      [5.3, -2.6, -0.22, 0.3, 0.28],
    ],
  },
  {
    id: 'small-back2',
    a0: 208,
    flare: 0.45,
    pts: [
      [2.4, 0, 0.4, 0.62, 0.9],
      [3.6, 0, 0.12, 0.52, 0.52],
      [4.5, -1.5, 0.05, 0.4, 0.36],
      [5.1, -2.2, -0.22, 0.28, 0.26],
    ],
  },
  // thin side roots branching off the long ones, snaking over the moss
  {
    id: 'twig-back',
    a0: 195,
    flare: 0,
    thin: true,
    pts: [
      [6.4, -4.6, 0.3, 0.34, 0.34],
      [7.3, -9.5, 0.16, 0.27, 0.27],
      [8.2, -13, 0.12, 0.21, 0.2],
      [8.9, -13.5, -0.2, 0.15, 0.14],
    ],
  },
  {
    id: 'twig-leftback',
    a0: 245,
    flare: 0,
    thin: true,
    pts: [
      [6.2, -4.2, 0.3, 0.34, 0.34],
      [7.1, 0.5, 0.16, 0.26, 0.26],
      [7.8, 4.0, 0.12, 0.2, 0.19],
      [8.3, 5.0, -0.2, 0.14, 0.13],
    ],
  },
  {
    id: 'twig-right',
    a0: 62,
    flare: 0,
    thin: true,
    pts: [
      [6.0, 2.0, 0.3, 0.32, 0.34],
      [6.8, 7.5, 0.16, 0.25, 0.25],
      [7.6, 11.0, 0.12, 0.19, 0.18],
      [8.1, 12.0, -0.2, 0.14, 0.13],
    ],
  },
  {
    id: 'twig-backright',
    a0: 170,
    flare: 0,
    thin: true,
    pts: [
      [6.1, 4.8, 0.3, 0.32, 0.34],
      [6.9, 9.0, 0.15, 0.25, 0.25],
      [7.6, 12.5, 0.1, 0.19, 0.18],
      [8.0, 13.5, -0.2, 0.13, 0.12],
    ],
  },
];

// ─── Limbs ───────────────────────────────────────────────────────────────────
// Main limbs: control points [ρ, a (deg), y, radius]. The first point sits
// inside the trunk so the limb grows out of the fork. They twist, sweep and
// branch further (limbs.js). L1 is the long low limb reaching front-left over
// the cottage path (it carries the rope swing and two lanterns). Nothing
// grows in front of the Code Loft (front-right, below y ≈ 16.5).
export const LIMBS = [
  {
    id: 'front-left-low',
    a0: -40,
    pts: [
      [0.9, -40, 13.6, 1.5],
      [3.0, -41, 16.1, 1.28],
      [6.0, -43, 15.3, 1.02],
      [9.0, -41.5, 13.7, 0.8],
      [12.2, -41, 13.1, 0.62],
      [15.0, -47, 13.9, 0.46],
      [17.6, -54, 15.6, 0.3],
    ],
    branches: 6,
  },
  {
    id: 'back-left',
    a0: -125,
    pts: [
      [1.0, -125, 14.4, 1.55],
      [3.0, -128, 17.8, 1.32],
      [6.0, -132, 20.6, 1.06],
      [9.5, -127, 24.0, 0.8],
      [12.5, -121, 27.2, 0.56],
      [14.6, -117, 30.2, 0.34],
    ],
    branches: 5,
  },
  {
    id: 'back-right',
    a0: 150,
    pts: [
      [1.0, 150, 14.4, 1.55],
      [2.8, 152, 18.0, 1.32],
      [5.5, 147, 22.0, 1.05],
      [8.5, 152, 26.0, 0.8],
      [11.0, 158, 29.8, 0.55],
      [12.6, 161, 33.0, 0.34],
    ],
    branches: 5,
  },
  {
    id: 'right',
    a0: 98,
    pts: [
      [1.0, 98, 14.8, 1.42],
      [3.0, 96, 17.6, 1.22],
      [6.5, 100, 19.2, 0.96],
      [10.0, 105, 21.0, 0.72],
      [13.5, 110, 23.4, 0.5],
      [16.0, 114, 26.4, 0.32],
    ],
    branches: 5,
  },
  {
    id: 'front-right-high',
    a0: 33,
    pts: [
      [1.0, 35, 15.0, 1.32],
      [2.4, 32, 18.6, 1.15],
      [4.0, 29, 23.0, 0.9],
      [6.4, 25, 27.4, 0.68],
      [8.4, 21, 31.8, 0.46],
      [9.4, 19, 35.2, 0.3],
    ],
    branches: 4,
  },
  {
    id: 'front',
    a0: -12,
    pts: [
      [1.0, -12, 15.0, 1.36],
      [2.8, -10, 17.8, 1.16],
      [5.5, -14, 19.4, 0.92],
      [8.5, -10, 20.2, 0.7],
      [11.4, -6, 21.0, 0.5],
      [13.8, -2, 22.6, 0.32],
    ],
    branches: 5,
  },
  {
    id: 'leader',
    a0: 200,
    pts: [
      [0.6, 200, 15.4, 1.25],
      [1.6, 195, 20.0, 1.08],
      [2.4, 205, 25.5, 0.86],
      [2.0, 215, 31.0, 0.62],
      [2.8, 222, 36.0, 0.42],
      [3.2, 226, 39.4, 0.26],
    ],
    branches: 4,
  },
];

// ─── Sculpt features on the trunk ────────────────────────────────────────────
/** Burls (big rounded swellings) — only where nothing attaches (back & left). */
export const BURLS = [
  { a: 202, y: 5.6, h: 0.42, r: 0.75 },
  { a: 252, y: 8.8, h: 0.34, r: 0.6 },
  { a: 172, y: 12.4, h: 0.3, r: 0.55 },
  { a: -78, y: 6.4, h: 0.26, r: 0.5 },
  { a: 228, y: 14.2, h: 0.3, r: 0.6 },
  { a: -30, y: 13.4, h: 0.22, r: 0.45 },
];
/** Knots: a ring of swollen bark around a dimple (old branch scars). */
export const KNOTS = [
  { a: -34, y: 5.6, r: 0.32 },
  { a: -8, y: 9.0, r: 0.28 },
  { a: 186, y: 9.4, r: 0.36 },
  { a: 238, y: 3.6, r: 0.3 },
  { a: -62, y: 12.2, r: 0.3 },
];
/** Hollows: a cup carved into the trunk with a swollen rim. `owl` gets a resident. */
export const HOLLOWS = [
  { id: 'owl', a: -50, y: 9.7, rx: 0.56, ry: 0.78, depth: 0.95 },
  { id: 'den', a: 183, y: 1.55, rx: 0.7, ry: 0.95, depth: 1.15 },
];

// ─── Radius contract + sculpt ────────────────────────────────────────────────
const nFur = createNoise3D(7);
const nFur2 = createNoise3D(19);
const nBig = createNoise3D(31);
const nMoss = createNoise3D(53);

/** The un-sculpted radius: the layout contract up to the fork, then a dome that closes inside the limbs. */
export function baseRadius(y) {
  if (y <= FORK_Y) return oakRadiusAt(y) + (y < 0 ? -y * 0.25 : 0);
  const t = (y - FORK_Y) / (TRUNK_TOP - FORK_Y);
  return t >= 1 ? 0 : oakRadiusAt(FORK_Y) * Math.sqrt(1 - t * t);
}

/**
 * 1 where other builders attach things to the bark (relief must stay within
 * ±0.2 of the contract): the front door zone and the whole right side (loft
 * stairs, loft braces), 0 where the oak may bulge freely.
 */
export function attachMask(a, y) {
  const deg = a / DEG;
  const front = (1 - smoothstep(38, 55, Math.abs(deg))) * (1 - smoothstep(5.5, 7, y));
  const right = smoothstep(18, 32, deg) * (1 - smoothstep(165, 182, deg)) * (1 - smoothstep(17.5, 19, y));
  return Math.max(front, right);
}

// The door niche, in the trunk's front. The Schreinerei builds its own carved
// frame standing ~0.47 proud of the door plane (0.9 deep, opening 1.2 wide,
// ~2.3 tall incl. frame) — this niche is carved just BEHIND that frame so no
// bark pokes into the lit doorway, and a soft bark collar rolls around it.
const DOOR_HW = 0.86;
const DOOR_SPRING = 1.48; // where the arch starts (top of the niche ≈ 2.34)
const DOOR_PLANE = OAK.door.z - OAK.z; // distance of the door plane from the axis (3.45)
const RECESS = DOOR_PLANE - 0.5; // back wall of the niche, behind the door frame
const LIP = DOOR_PLANE + 0.05; // the rounded bark collar that frames the niche
/** The niche, for other builders (all in world units; z = front plane of the back wall). */
export const DOOR_NICHE = { halfWidth: DOOR_HW, spring: DOOR_SPRING, top: DOOR_SPRING + DOOR_HW, backZ: OAK.z + RECESS };

/** Signed distance to the door arch outline in the door plane (x lateral, y up). Negative inside. */
export function doorArchDistance(x, y) {
  const ax = Math.abs(x - OAK.door.x);
  if (y < DOOR_SPRING) return Math.max(ax - DOOR_HW, -y - 0.6);
  return Math.hypot(ax, y - DOOR_SPRING) - DOOR_HW;
}

function smoothBump(d2, r2) {
  return Math.exp(-d2 / r2);
}

/**
 * Features that are separate from the base flow (so moss & ivy can ask about them).
 * Returns { r, hollow } — hollow ∈ [0,1] how deep inside a hollow the point is.
 */
const _res = { r: 0, hollow: 0, collar: 0 };
export function trunkSample(a, y) {
  const R0 = baseRadius(y);
  _res.hollow = 0;
  _res.collar = 0;
  if (R0 <= 0) {
    _res.r = 0;
    return _res;
  }
  const att = attachMask(a, y);
  const yc = Math.max(y, 0);
  let r = R0;

  // 1. Tendons: sinews that flow from each root up the trunk, and from each
  //    limb down into it — so the trunk reads as a bundle that twists. Near
  //    the ground they ARE the buttress flare.
  const free = 1 - att;
  for (let i = 0; i < ROOTS.length; i++) {
    const root = ROOTS[i];
    if (!root.flare) continue;
    const ac = root.a0 * DEG + TWIST * yc * 0.85;
    const d = angDiff(a, ac) * R0;
    const w = 0.6 + 1.0 * Math.exp(-yc / 1.3);
    const amp = root.flare * (0.16 + 1.5 * Math.exp(-yc / 1.0)) * (1 - smoothstep(4, 10.5, yc)) * (yc > 2.5 ? 1 - 0.45 * att : 1);
    r += amp * smoothBump(d * d, w * w);
  }
  for (let i = 0; i < LIMBS.length; i++) {
    const ac = LIMBS[i].a0 * DEG + TWIST * (yc - FORK_Y);
    const d = angDiff(a, ac) * R0;
    const amp = (0.13 + 0.1 * free) * smoothstep(8, 16, yc);
    r += amp * smoothBump(d * d, 0.7);
  }

  // 2. Furrows: V-shaped fissures (zero crossings of noise), stretched along
  //    the twisting grain.
  const at = a + TWIST * yc;
  const ca = Math.cos(at), sa = Math.sin(at);
  const f1 = Math.abs(nFur(ca * 4.4, sa * 4.4, yc * 0.42));
  const f2 = Math.abs(nFur2(ca * 9.5 + 3, sa * 9.5, yc * 1.1));
  r += (Math.min(f1, 0.55) * 2 - 0.55) * (0.13 + 0.08 * free) + (Math.min(f2, 0.5) * 2 - 0.5) * 0.05;

  // 3. Slow bulges that make the trunk lumpy and gnarled (bigger where free).
  const big = nBig(Math.cos(a) * 1.15 + 11, Math.sin(a) * 1.15, yc * 0.17);
  const mid = nBig(Math.cos(a) * 2.6 - 5, Math.sin(a) * 2.6, yc * 0.38 + 9);
  r += big * (0.1 + 0.36 * free) + mid * (0.04 + 0.12 * free);

  // 4. Burls, knots and hollows (free zones only).
  for (let i = 0; i < BURLS.length; i++) {
    const b = BURLS[i];
    const da = angDiff(a, b.a * DEG) * R0, dy = y - b.y;
    const d2 = da * da + dy * dy;
    if (d2 < 9 * b.r * b.r) r += b.h * smoothBump(d2, b.r * b.r) * (1 - att);
  }
  for (let i = 0; i < KNOTS.length; i++) {
    const k = KNOTS[i];
    const da = angDiff(a, k.a * DEG) * R0, dy = (y - k.y) * 0.8;
    const d2 = da * da + dy * dy;
    if (d2 < 9 * k.r * k.r) r += 0.2 * smoothBump(d2, k.r * k.r) - 0.24 * smoothBump(d2, k.r * k.r * 0.12);
  }
  for (let i = 0; i < HOLLOWS.length; i++) {
    const h = HOLLOWS[i];
    const da = angDiff(a, h.a * DEG) * R0, dy = y - h.y;
    const q = Math.hypot(da / h.rx, dy / h.ry);
    if (q < 2.2) {
      r += 0.26 * Math.exp(-((q - 1.08) * (q - 1.08)) / 0.06); // swollen rim
      if (q < 1) {
        const cup = Math.sqrt(1 - q * q);
        r -= h.depth * cup;
        _res.hollow = Math.max(_res.hollow, cup);
      }
    }
  }

  // 5. The base swells into the ground everywhere except right at the door.
  const doorSide = Math.cos(a) > 0 ? 1 - smoothstep(1.4, 2.4, Math.abs(R0 * Math.sin(a))) : 0;
  r += 0.42 * Math.exp(-yc / 0.7) * (1 - doorSide);

  // 6. The door niche with its rolled bark collar (front only).
  const ca0 = Math.cos(a);
  if (ca0 > 0.35 && y < 5.2) {
    const x = R0 * Math.sin(a);
    const d = doorArchDistance(x, y);
    if (d < 1.35) {
      // work in "distance in front of the axis" (z offset) so the niche is flat
      const zNat = r * ca0;
      let zt;
      const relief = (Math.min(f1, 0.55) * 2 - 0.55) * 0.07;
      if (d <= 0) zt = RECESS;
      else if (d < 0.3) zt = RECESS + (LIP - RECESS) * Math.sin((d / 0.3) * Math.PI * 0.5) + relief * (d / 0.3);
      else {
        const k = smoothstep(0.3, 1.35, d);
        const lip = LIP + relief - (LIP - zNat) * k;
        zt = Math.max(zNat, lip);
      }
      r = zt / ca0;
      _res.collar = d > 0 ? 1 - smoothstep(0.1, 1.2, d) : 0;
    }
  }
  _res.r = r;
  return _res;
}

/** Sculpted bark radius at azimuth a (radians) and height y. */
export function trunkRadius(a, y) {
  return trunkSample(a, y).r;
}

/**
 * Moss amount on the trunk at (a, y), ≤ 0 means bare bark. Moss gathers at the
 * base, on the tops of the buttress flares, on the shady back (north) and in
 * the fork; never inside the door niche or on its collar.
 */
export function trunkMoss(a, y) {
  const s = trunkSample(a, y);
  if (s.collar > 0.05 || s.hollow > 0) return -1;
  const ca = Math.cos(a), sa = Math.sin(a);
  const n = nMoss(ca * 2.2, sa * 2.2, y * 0.5); // big patches
  const n2 = nMoss(ca * 7 + 5, sa * 7, y * 1.8); // ragged edges
  const nLine = nMoss(ca * 1.4 - 9, sa * 1.4, 3.3); // how high the moss climbs here
  const back = 0.5 - 0.5 * ca; // 0 front … 1 back (north, shady)
  const foot = 1 - smoothstep(0.0, 0.9 + 1.2 * (nLine * 0.5 + 0.5) + back * 0.8, y);
  const shady = back * (1 - smoothstep(2.5, 8, y)) * (0.4 + 0.9 * n);
  const fork = smoothstep(FORK_Y - 0.4, FORK_Y + 1.4, y);
  let m = Math.max(foot, shady, fork) * (0.75 + 0.5 * n) + 0.22 * n2 - 0.32;
  // keep the right side (stairs) & the door front tidy
  m -= attachMask(a, y) * 0.3;
  return clamp(m, -1, 1);
}

// ─── Keep-out zones for branches and leaves ──────────────────────────────────
// Every spot camera (except the glen overview, which the canopy frames) must
// see its subject: nothing of the crown may sit inside a spot camera's view
// frustum between the camera and its target. Plus the Code Loft volume.
const ASPECT = 16 / 9;
const viewTests = [];
{
  const cam = new THREE.PerspectiveCamera(40, ASPECT, 0.1, 100);
  for (const s of SPOTS) {
    if (s.id === 'glen') continue;
    const p = new THREE.Vector3(...s.camera.position);
    const t = new THREE.Vector3(...s.camera.target);
    for (const [k, shrink] of [[1, 1], [1.8, 0.62]]) {
      // the spot shot itself, and the "-wide" variant (central part of its frame)
      const pos = t.clone().add(p.clone().sub(t).multiplyScalar(k));
      cam.fov = (s.camera.fov ?? 40) * shrink;
      cam.aspect = ASPECT;
      cam.near = 0.1;
      cam.far = pos.distanceTo(t) - 1.2;
      cam.position.copy(pos);
      cam.lookAt(t);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      viewTests.push({ id: s.id + (k > 1 ? '-wide' : ''), frustum: new THREE.Frustum().setFromProjectionMatrix(m) });
    }
  }
}
const _sphere = new THREE.Sphere();
/** True if a sphere at p with radius r would block a spot camera or crowd the Code Loft. */
export function crownBlocked(p, r = 0) {
  // the Code Loft and the air in front of it
  const lx = p.x - OAK.loft.x, lz = p.z - OAK.loft.z;
  if (p.y - r < 16.6 && p.y + r > OAK.loft.y - 2 && Math.hypot(lx, lz) < OAK.loft.radius + 3.2 + r) return true;
  _sphere.center.copy(p);
  _sphere.radius = r;
  for (const v of viewTests) if (v.frustum.intersectsSphere(_sphere)) return true;
  return false;
}
