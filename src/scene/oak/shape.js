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
    flare: 1.15,
    pts: [
      [2.2, 0, 1.1, 0.95, 2.3],
      [3.6, -1, 0.55, 0.85, 1.5],
      [4.6, 0.5, 0.44, 0.9, 1.2],
      [5.4, 2, 0.36, 0.76, 0.92],
      [6.05, 2.6, 0.12, 0.58, 0.62],
      [6.5, 2.2, -0.34, 0.4, 0.4],
    ],
  },
  {
    id: 'right-long',
    a0: 64,
    flare: 1.2,
    pts: [
      [2.2, 0, 1.1, 1.05, 2.4],
      [3.7, 1.5, 0.55, 1, 1.55],
      [5, 3, 0.46, 0.98, 1.24],
      [6.4, 2, 1.22, 0.8, 0.88],
      [7.5, 4, 0.32, 0.74, 0.82],
      [8.6, 6.5, 0.62, 0.62, 0.68],
      [9.8, 7.4, 0.1, 0.5, 0.52],
      [10.6, 7, -0.38, 0.34, 0.34],
    ],
  },
  {
    id: 'right-low', // spiral-stairs side — kept low near the bark, arching further out
    a0: 94,
    flare: 0.65,
    pts: [
      [2.2, 0, 0.5, 0.9, 1.25],
      [3.7, 0, 0.2, 0.82, 0.8],
      [4.8, 2.6, 0.14, 0.72, 0.62],
      [6, 4, 0.62, 0.56, 0.6],
      [7, 3.6, 0.06, 0.48, 0.5],
      [7.6, 2.8, -0.34, 0.34, 0.34],
    ],
  },
  {
    id: 'back-right',
    a0: 170,
    flare: 1.2,
    pts: [
      [2.2, 0, 1.1, 1.05, 2.4],
      [3.7, 1.5, 0.55, 0.98, 1.5],
      [5.2, 4, 0.4, 0.84, 1.02],
      [6.6, 4.8, 0.9, 0.62, 0.68],
      [7.8, 2.6, 0.12, 0.58, 0.64],
      [8.8, 0.8, -0.34, 0.4, 0.4],
    ],
  },
  {
    id: 'back',
    a0: 195,
    flare: 1.3,
    pts: [
      [2.2, 0, 1.15, 1.1, 2.5],
      [3.9, -1.6, 0.6, 1.06, 1.66],
      [5.5, -4.6, 0.46, 0.96, 1.18],
      [7, -4.5, 1.15, 0.74, 0.8],
      [8.3, -1.5, 0.24, 0.68, 0.76],
      [9.5, 1.3, 0.5, 0.56, 0.62],
      [10.5, 2.1, 0.02, 0.4, 0.42],
      [11.1, 1.7, -0.4, 0.3, 0.3],
    ],
  },
  {
    id: 'back-left',
    a0: 221,
    flare: 1.15,
    pts: [
      [2.2, 0, 1.05, 1, 2.3],
      [3.7, 1.7, 0.52, 0.92, 1.45],
      [5.1, 3.7, 0.38, 0.8, 1],
      [6.4, 2, 0.52, 0.66, 0.78],
      [7.5, -0.8, 0.08, 0.54, 0.6],
      [8.3, -1.5, -0.34, 0.38, 0.38],
    ],
  },
  {
    id: 'left-back',
    a0: 245,
    flare: 1.25,
    pts: [
      [2.2, 0, 1.1, 1.05, 2.4],
      [3.8, 0, 0.58, 1.02, 1.6],
      [5.3, -3.6, 0.46, 0.92, 1.15],
      [6.8, -4.2, 1.1, 0.72, 0.78],
      [8, -2.4, 0.2, 0.64, 0.7],
      [9.1, 0, 0.36, 0.48, 0.52],
      [9.9, 1, -0.36, 0.34, 0.34],
    ],
  },
  {
    id: 'left', // squeezes past behind the annex, then turns back
    a0: 263,
    flare: 1.0,
    pts: [
      [2.2, 0, 1.0, 0.8, 2.0],
      [3.5, -6, 0.48, 0.66, 1.25],
      [4.5, -12, 0.32, 0.56, 0.86],
      [5.3, -15, 0.2, 0.46, 0.6],
      [5.8, -16, -0.06, 0.36, 0.4],
      [6.1, -16, -0.36, 0.26, 0.26],
    ],
  },
  // smaller roots between the big ones
  {
    id: 'small-backleft',
    a0: 233,
    flare: 0.6,
    pts: [
      [2.4, 0, 0.55, 0.75, 1.3],
      [3.8, 0, 0.22, 0.66, 0.78],
      [4.9, -2, 0.14, 0.52, 0.54],
      [5.7, -2.6, -0.26, 0.36, 0.34],
    ],
  },
  {
    id: 'small-back2',
    a0: 208,
    flare: 0.55,
    pts: [
      [2.4, 0, 0.5, 0.7, 1.2],
      [3.7, 0, 0.18, 0.62, 0.72],
      [4.8, -1.5, 0.12, 0.5, 0.5],
      [5.5, -2.2, -0.26, 0.34, 0.32],
    ],
  },
  {
    id: 'small-right',
    a0: 78,
    flare: 0.4,
    pts: [
      [2.6, 0, 0.3, 0.6, 0.8],
      [3.9, 0, 0.1, 0.52, 0.5],
      [4.9, -2.5, 0.1, 0.42, 0.42],
      [5.6, -3, -0.22, 0.3, 0.28],
    ],
  },
  // thin side roots branching off the long ones, snaking over the moss
  {
    id: 'twig-back',
    a0: 195,
    flare: 0,
    thin: true,
    pts: [
      [7, -4.6, 0.4, 0.42, 0.44],
      [8, -9.5, 0.2, 0.34, 0.34],
      [9, -13, 0.16, 0.26, 0.25],
      [9.8, -13.5, -0.24, 0.18, 0.17],
    ],
  },
  {
    id: 'twig-leftback',
    a0: 245,
    flare: 0,
    thin: true,
    pts: [
      [6.7, -4.2, 0.4, 0.42, 0.44],
      [7.7, 0.5, 0.2, 0.33, 0.33],
      [8.5, 4, 0.15, 0.25, 0.24],
      [9.1, 5, -0.24, 0.17, 0.16],
    ],
  },
  {
    id: 'twig-right',
    a0: 64,
    flare: 0,
    thin: true,
    pts: [
      [6.3, 2, 0.42, 0.4, 0.44],
      [7.2, 7.5, 0.2, 0.32, 0.32],
      [8.1, 11, 0.15, 0.24, 0.23],
      [8.7, 12, -0.24, 0.17, 0.16],
    ],
  },
  {
    id: 'twig-backright',
    a0: 170,
    flare: 0,
    thin: true,
    pts: [
      [6.6, 4.8, 0.42, 0.4, 0.44],
      [7.5, 9, 0.2, 0.32, 0.32],
      [8.3, 12.5, 0.14, 0.24, 0.23],
      [8.8, 13.5, -0.24, 0.17, 0.16],
    ],
  },
];

// ─── Limbs ───────────────────────────────────────────────────────────────────
// Main limbs: control points [ρ, a (deg), y, radius, elbow?]. The first point
// sits inside the trunk so the limb grows out of the fork. They twist, sweep
// and branch further (limbs.js). Every limb is kinked two or three times — an
// old oak's limbs zig-zag where they once lost a leader — and `elbow` (a
// fraction of the radius) swells the bark into a knobbly elbow at that point.
// L1 is the long low limb reaching front-left over the cottage path (it
// carries two lanterns and fairy lights). Nothing grows in front of the
// Code Loft (front-right, below y ≈ 16.5). The limbs to the back and right
// stay low enough that the crown's underside forms a ceiling across the top
// of the spot views. (Check: no limb tube may enter a spot camera frustum.)
export const LIMBS = [
  {
    id: 'front-left-low',
    a0: -40,
    pts: [
      [0.9, -40, 13.6, 1.5],
      [3, -41, 16.2, 1.3],
      [5.6, -47, 15.7, 1.08, 0.24],
      [8.2, -40, 14.2, 0.86],
      [10.8, -37, 13.0, 0.72, 0.26],
      [13.4, -45, 13.5, 0.56],
      [15.6, -49, 14.7, 0.44, 0.2],
      [17.6, -56, 15.9, 0.3],
    ],
    branches: 7,
  },
  {
    id: 'back-left',
    a0: -125,
    pts: [
      [1, -125, 14.4, 1.55],
      [3, -128, 17.6, 1.33],
      [5.6, -136, 19.0, 1.08, 0.24],
      [8.0, -127, 21.6, 0.86],
      [10.4, -123, 21.9, 0.72, 0.26],
      [13.0, -118, 24.6, 0.52],
      [15.2, -121, 27.4, 0.34],
    ],
    branches: 6,
  },
  {
    id: 'back-right',
    a0: 150,
    pts: [
      [1, 150, 14.4, 1.55],
      [2.8, 152, 17.6, 1.33],
      [5.2, 143, 19.2, 1.08, 0.24],
      [7.6, 150, 22.0, 0.86],
      [9.8, 158, 22.6, 0.72, 0.26],
      [12.0, 156, 25.2, 0.52],
      [13.8, 163, 27.6, 0.34],
    ],
    branches: 6,
  },
  {
    // the limb above the Code Loft (its ropes & the swing hang from it):
    // elbows UP over the treehouse roof, never down into it
    id: 'right',
    a0: 98,
    pts: [
      [1, 98, 14.8, 1.42],
      [3, 96, 17.3, 1.24],
      [5.4, 102, 18.9, 1.04, 0.24],
      [7.9, 96, 18.0, 0.86],
      [10.3, 104, 18.5, 0.72, 0.26],
      [12.9, 112, 19.9, 0.54],
      [14.8, 110, 21.2, 0.42, 0.2],
      [16.6, 117, 22.8, 0.3],
    ],
    branches: 6,
  },
  {
    id: 'front-right-high',
    a0: 33,
    pts: [
      [1, 35, 15, 1.32],
      [2.4, 32, 18.8, 1.16],
      [3.7, 24, 22.6, 0.96, 0.24],
      [5.8, 29, 26.0, 0.74],
      [7.3, 20, 29.4, 0.6, 0.26],
      [8.6, 23, 32.6, 0.44],
      [9.4, 17, 35.4, 0.3],
    ],
    branches: 4,
  },
  {
    id: 'front',
    a0: -12,
    pts: [
      [1, -12, 15, 1.36],
      [2.8, -10, 17.9, 1.17],
      [5.0, -17, 19.9, 0.98, 0.24],
      [7.4, -10, 19.6, 0.8],
      [9.6, -4, 21.4, 0.64, 0.26],
      [11.8, -9, 22.0, 0.5],
      [13.8, -1, 23.2, 0.32],
    ],
    branches: 6,
  },
  {
    id: 'leader',
    a0: 200,
    pts: [
      [0.6, 200, 15.4, 1.25],
      [1.6, 195, 20, 1.09],
      [2.8, 208, 24.6, 0.92, 0.22],
      [1.8, 214, 28.6, 0.72],
      [3.0, 228, 32.4, 0.58, 0.24],
      [2.4, 224, 36.2, 0.4],
      [3.4, 234, 39.6, 0.26],
    ],
    branches: 5,
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
  // big old swellings (±15 % of the radius) that break the silhouette seen
  // from the glen: the left flank, high on the front-left, the back
  { a: -104, y: 4.6, h: 0.46, r: 0.95 },
  { a: -96, y: 10.6, h: 0.5, r: 1.1 },
  { a: -84, y: 14.6, h: 0.4, r: 0.9 },
  { a: -16, y: 9.4, h: 0.3, r: 0.8 },
  { a: 214, y: 9.8, h: 0.42, r: 1.0 },
  { a: 238, y: 2.6, h: 0.36, r: 0.9 },
];
/** The trunk's broad lobes twist a quarter turn over 12 units of height. */
export const LOBE_TWIST = Math.PI / 2 / 12;
/** Knots: a ring of swollen bark around a dimple (old branch scars). */
export const KNOTS = [
  { a: -47, y: 5.9, r: 0.32 },
  { a: -8, y: 9.0, r: 0.28 },
  { a: 186, y: 9.4, r: 0.36 },
  { a: 238, y: 3.6, r: 0.3 },
  { a: -62, y: 12.2, r: 0.3 },
];
/** Hollows: a cup carved into the trunk with a swollen rim. `owl` gets a resident. */
export const HOLLOWS = [
  { id: 'owl', a: -50, y: 9.7, rx: 0.6, ry: 0.82, depth: 1.05 },
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
  const front = (1 - smoothstep(38, 55, Math.abs(deg))) * (1 - smoothstep(6.5, 8, y));
  const right = smoothstep(4, 16, deg) * (1 - smoothstep(165, 182, deg)) * (1 - smoothstep(17.5, 19, y));
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
    const w = 0.55 + 0.6 * Math.exp(-yc / 1.4);
    // buttresses: ≈1.6× the radius at the ground, still clearly flared at y ≈ 1.5
    const amp = root.flare * (0.2 + 1.2 * Math.exp(-yc / 1.45)) * (1 - smoothstep(4.5, 11, yc)) * (1 - 0.8 * att * smoothstep(1.6, 2.6, yc));
    r += amp * smoothBump(d * d, w * w);
  }
  // the trunk swells towards each limb as it rises (a vase that splits into
  // the limbs, not a column with branches stuck on); broad and strong where
  // the bark is free, gentler on the loft side
  for (let i = 0; i < LIMBS.length; i++) {
    const ac = LIMBS[i].a0 * DEG + TWIST * (yc - FORK_Y);
    const d = angDiff(a, ac) * R0;
    const amp = (0.16 + 0.62 * free) * smoothstep(9, 16.5, yc) * (LIMBS[i].pts[0][3] / 1.45);
    r += amp * smoothBump(d * d, 0.75 + 0.9 * free);
  }

  // 1b. Character: two or three broad lobes that spiral a quarter turn over
  //     12 units, so the trunk reads as fused, twisting stems (silhouette
  //     changes width as it rises); subtle where things attach.
  {
    const ph = a - yc * LOBE_TWIST;
    const lobe = 0.62 * Math.cos(3 * ph + 0.4) + 0.38 * Math.cos(2 * ph - 1.1);
    r += lobe * R0 * (0.035 + 0.11 * free) * (1 - 0.6 * smoothstep(14, 17.5, yc));
  }

  // 2. Furrows: V-shaped fissures (zero crossings of noise), stretched along
  //    the twisting grain.
  const at = a + TWIST * yc;
  const ca = Math.cos(at), sa = Math.sin(at);
  const f1 = Math.abs(nFur(ca * 4.4, sa * 4.4, yc * 0.42));
  const f2 = Math.abs(nFur2(ca * 9.5 + 3, sa * 9.5, yc * 1.1));
  r += (Math.min(f1, 0.55) * 2 - 0.55) * (0.11 + 0.1 * free) + (Math.min(f2, 0.5) * 2 - 0.5) * 0.05;

  // 3. Slow bulges that make the trunk lumpy and gnarled (bigger where free).
  const big = nBig(Math.cos(a) * 1.15 + 11, Math.sin(a) * 1.15, yc * 0.17);
  const mid = nBig(Math.cos(a) * 2.6 - 5, Math.sin(a) * 2.6, yc * 0.38 + 9);
  r += big * (0.06 + 0.4 * free) + mid * (0.03 + 0.13 * free);

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
  r += (0.3 * Math.exp(-yc / 0.7) + 0.32 * Math.exp(-yc / 1.6)) * (1 - doorSide);

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

// ─── The EFZ certificate keep-out ────────────────────────────────────────────
// The Schreinerei hangs the framed Schreiner EFZ certificate (with its little
// roof) on the bark right of the door: world x = door.x + 1.8, centred at
// y ≈ 1.32, roof up to ≈ 1.9 (schreinerei/door.js, mounted with barkMount on
// trunkRadius). Ivy, moss and fairy lights keep this patch of bark clear.
const CERT_X = OAK.door.x + 1.8;
const CERT_Y = 1.32;
let certA = null;
/** Azimuth of the certificate on the bark (same iteration as barkMount). */
export function certAzimuth() {
  if (certA === null) {
    let a = Math.asin(clamp((CERT_X - CX) / oakRadiusAt(CERT_Y), -1, 1));
    for (let i = 0; i < 4; i++) a = Math.asin(clamp((CERT_X - CX) / trunkRadius(a, CERT_Y), -1, 1));
    certA = a;
  }
  return certA;
}
/** Keep-out patch on the bark around the certificate: half width along the bark (world units) and heights. */
export const CERT_ZONE = { halfW: 0.78, y0: 0.62, y1: 2.85 };
/**
 * 0…1: how deep (a, y) lies inside the certificate's keep-out patch (0 = outside),
 * `pad` widens it (world units).
 */
export function certZone(a, y, pad = 0) {
  if (y < CERT_ZONE.y0 - pad || y > CERT_ZONE.y1 + pad) return 0;
  const w = Math.abs(angDiff(a, certAzimuth())) * baseRadius(Math.max(y, 0));
  if (w > CERT_ZONE.halfW + pad) return 0;
  const ey = Math.min(y - (CERT_ZONE.y0 - pad), CERT_ZONE.y1 + pad - y);
  return clamp(Math.min(CERT_ZONE.halfW + pad - w, ey) / 0.25, 0, 1);
}
/** True if a world point near the front bark lies in (or within `pad` of) the certificate patch. */
export function inCertZone(p, pad = 0) {
  if (p.z < CZ) return false;
  const a = Math.atan2(p.x - CX, p.z - CZ);
  if (Math.hypot(p.x - CX, p.z - CZ) > baseRadius(Math.max(p.y, 0)) + 1.4 + pad) return false;
  return certZone(a, p.y, pad) > 0;
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
  let m = Math.max(foot, shady, fork) * (0.7 + 0.55 * n) + 0.22 * n2 - 0.4;
  // keep the right side (stairs) & the door front tidy
  m -= attachMask(a, y) * 0.3;
  // …and the bark behind the EFZ certificate bare
  m -= certZone(a, y, 0.3) * 1.2;
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
