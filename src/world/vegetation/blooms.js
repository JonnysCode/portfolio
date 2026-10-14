// ─────────────────────────────────────────────────────────────────────────────
// BLOOMS — flower drifts that read from across the glen (refs: the fairy
// garden's blue, pink, white and yellow clumps at the house's foot; the stone
// tower's flower beds along the path). The small wildflower communities in
// plants.js are true to scale and vanish at the overview's distance; these
// are cushions of one species, packed with heads a touch larger than life, so
// a drift of a dozen or two reads as a wash of colour on the moss — and still
// holds up close as real little flowers (stems, leaves, petals, eyes).
//
//   bloomTemplate(kind, rng, { lite })   a cushion (footprint ≈ 0.3 radius):
//        forgetMeNot  sky-blue five-petal stars with yellow eyes in sprays
//        bluebell     arching stems hung with violet-blue bells
//        anemone      white wood anemones (six petals, a blush on the backs)
//        campion      pink notched five-petal stars on taller stems
//        buttercup    glossy yellow cups
//   hydrangea(B, rng, x, y, z, s, hue)    a low accent shrub (written straight
//        into a GeoBuilder): a dome of big dark leaves crowned with mophead
//        blooms of tiny four-petal florets, blue → violet or pink → rose
//   BLOOM_KINDS, BLOOM_HEIGHT (template height per kind, for view tests)
//
// UVs map petals and leaves onto the 'leaf' surface (veins); vertex colours
// carry the hues (vivid enough to survive the warm grade).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { GeoBuilder, TAU } from './common.js';
import { createRng } from '../../core/rng.js';

const UP = new THREE.Vector3(0, 1, 0);
const col = (hex) => new THREE.Color(hex);
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

/** A thin flat ribbon (stem) from a through optional bend to b, facing `face` (horizontal). 2 tris per segment. */
function ribbon(B, pts, w, color, face) {
  const side = new THREE.Vector3(Math.cos(face), 0, -Math.sin(face));
  const n = new THREE.Vector3(Math.sin(face), 0.3, Math.cos(face)).normalize();
  const base = B.count;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const ww = w * (1 - (i / pts.length) * 0.4);
    B.vert(p.x - side.x * ww, p.y, p.z - side.z * ww, n.x, n.y, n.z, 0.45, i / (pts.length - 1), color);
    B.vert(p.x + side.x * ww, p.y, p.z + side.z * ww, n.x, n.y, n.z, 0.55, i / (pts.length - 1), color);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = base + i * 2;
    B.quad(a, a + 1, a + 3, a + 2);
  }
}

/** A leaf blade lying out from p along azimuth az (1 or 2 segments, drooping). */
function leaf(B, p, az, len, wid, color, { rise = 0.35, droop = 0.5, segs = 1, tip = null } = {}) {
  const dir = new THREE.Vector3(Math.sin(az), rise, Math.cos(az)).normalize();
  const side = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
  const base = B.count;
  const q = p.clone();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = wid * (i === 0 ? 0.25 : i === segs ? (segs > 1 ? 0.35 : 0.6) : 1);
    const c = tip ? color.clone().lerp(tip, t) : color;
    const n = new THREE.Vector3(-dir.x * 0.3, 1, -dir.z * 0.3).normalize();
    B.vert(q.x - side.x * w, q.y, q.z - side.z * w, n.x, n.y, n.z, 0, t, c);
    B.vert(q.x + side.x * w, q.y, q.z + side.z * w, n.x, n.y, n.z, 1, t, c);
    dir.y -= droop / Math.max(1, segs);
    dir.normalize();
    q.addScaledVector(dir, len / segs);
  }
  for (let i = 0; i < segs; i++) {
    const a = base + i * 2;
    B.quad(a, a + 2, a + 3, a + 1);
  }
}

/** A flat star/fan flower facing `normal`: n petals (notched or round), a coloured eye. */
function star(B, c, normal, r, petalCol, eyeCol, n = 5, inner = 0.55) {
  const ref = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP;
  _u.crossVectors(ref, normal).normalize();
  _v.crossVectors(normal, _u).normalize();
  const b = B.count;
  B.vert(c.x, c.y, c.z, normal.x, normal.y, normal.z, 0.5, 0.5, eyeCol);
  // (inner = 1: no notches — n round lobes as a plain n-gon)
  const m = inner >= 1 ? n : n * 2;
  for (let i = 0; i < m; i++) {
    const a = (i / m) * TAU;
    const rr = i % 2 === 0 ? r : r * inner;
    const x = c.x + (_u.x * Math.cos(a) + _v.x * Math.sin(a)) * rr;
    const y = c.y + (_u.y * Math.cos(a) + _v.y * Math.sin(a)) * rr - r * 0.12;
    const z = c.z + (_u.z * Math.cos(a) + _v.z * Math.sin(a)) * rr;
    B.vert(x, y, z, normal.x, normal.y, normal.z, 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a), petalCol);
  }
  for (let i = 0; i < m; i++) B.tri(b, b + 1 + i, b + 1 + ((i + 1) % m));
}

/** A cupped flower of n separate oval petals (2 tris each) around a small eye fan. */
function cup(B, c, normal, len, wid, petalCol, eyeCol, n = 5, cupK = 0.45) {
  const ref = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP;
  _u.crossVectors(ref, normal).normalize();
  _v.crossVectors(normal, _u).normalize();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    _d.set(0, 0, 0).addScaledVector(_u, Math.cos(a)).addScaledVector(_v, Math.sin(a)).addScaledVector(normal, cupK).normalize();
    const side = new THREE.Vector3().crossVectors(normal, _d).normalize();
    const b = B.count;
    const tip = c.clone().addScaledVector(_d, len);
    const mid = c.clone().addScaledVector(_d, len * 0.55);
    const pc = petalCol;
    // base, two shoulders, tip — a rounded petal
    B.vert(c.x, c.y, c.z, normal.x, normal.y, normal.z, 0.5, 0, pc);
    B.vert(mid.x - side.x * wid * 0.5, mid.y - side.y * wid * 0.5, mid.z - side.z * wid * 0.5, normal.x, normal.y, normal.z, 0, 0.55, pc);
    B.vert(tip.x, tip.y, tip.z, normal.x, normal.y, normal.z, 0.5, 1, pc);
    B.vert(mid.x + side.x * wid * 0.5, mid.y + side.y * wid * 0.5, mid.z + side.z * wid * 0.5, normal.x, normal.y, normal.z, 1, 0.55, pc);
    B.tri(b, b + 2, b + 1);
    B.tri(b, b + 3, b + 2);
  }
  // the eye: a little raised fan
  const e = B.count;
  const top = c.clone().addScaledVector(normal, len * 0.18);
  B.vert(top.x, top.y, top.z, normal.x, normal.y, normal.z, 0.5, 0.5, eyeCol);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const p = c.clone().addScaledVector(_u, Math.cos(a) * len * 0.22).addScaledVector(_v, Math.sin(a) * len * 0.22);
    B.vert(p.x, p.y, p.z, normal.x, normal.y, normal.z, 0.5, 0.5, eyeCol);
  }
  for (let i = 0; i < 5; i++) B.tri(e, e + 1 + i, e + 1 + ((i + 1) % 5));
}

/** A hanging bell from `top` opening along `axis` (4-sided, one flaring band). */
function bell(B, top, axis, len, rad, color, rim) {
  const ref = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP;
  const u = new THREE.Vector3().crossVectors(ref, axis).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  const seg = 5;
  const base = B.count;
  for (const [t, rf] of [[0, 0.35], [1, 1.35]]) {
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      const ox = u.x * Math.cos(a) + v.x * Math.sin(a), oy = u.y * Math.cos(a) + v.y * Math.sin(a), oz = u.z * Math.cos(a) + v.z * Math.sin(a);
      const r = rad * rf * (t === 1 ? 1 + 0.15 * Math.cos(a * 5) : 1);
      B.vert(top.x + axis.x * len * t + ox * r, top.y + axis.y * len * t + oy * r, top.z + axis.z * len * t + oz * r, ox, oy, oz, i / seg, t, t ? rim : color);
    }
  }
  for (let i = 0; i < seg; i++) B.quad(base + i, base + i + 1, base + seg + 2 + i, base + seg + 1 + i);
}

const STEM = '#5f8f3e';
const LEAF = '#4f8236';
const LEAF_LIGHT = '#77a64a';

function forgetMeNot(B, rng, lite) {
  const leaves = lite ? 5 : 8;
  for (let i = 0; i < leaves; i++) {
    const az = (i / leaves) * TAU + rng.jitter(0.4);
    leaf(B, new THREE.Vector3(rng.jitter(0.05), 0.01, rng.jitter(0.05)), az, rng.range(0.1, 0.16), 0.032, col(LEAF), { rise: 0.5, droop: 0.9, tip: col(LEAF_LIGHT) });
  }
  const sprays = lite ? 5 : 7;
  for (let s = 0; s < sprays; s++) {
    const a = rng.range(0, TAU), d = Math.sqrt(rng.next()) * 0.26;
    const base = new THREE.Vector3(Math.sin(a) * d, 0, Math.cos(a) * d);
    const h = rng.range(0.12, 0.2) * (1 - d * 0.7);
    const top = base.clone().add(new THREE.Vector3(Math.sin(a) * 0.04, h, Math.cos(a) * 0.04));
    ribbon(B, [base, top], 0.007, col(STEM), rng.range(0, TAU));
    const n = lite ? 4 : 5;
    const blue = col(rng.pick(['#5d8fec', '#6a9cf2', '#4f84e6', '#7aa8f4', '#5a8ae8']));
    for (let k = 0; k < n; k++) {
      const p = top.clone().add(new THREE.Vector3(rng.jitter(0.075), rng.jitter(0.025), rng.jitter(0.075)));
      const nrm = new THREE.Vector3(rng.jitter(0.5) + (p.x - base.x) * 3, 1, rng.jitter(0.5) + (p.z - base.z) * 3).normalize();
      // (a pink bud now and then — forget-me-nots open pink and turn blue)
      const pink = k === 0 && rng.chance(0.3);
      // (larger than life: the drift must read as blue from across the glen)
      // (a plain pentagon with a yellow eye: at this size the notches never read)
      star(B, p, nrm, rng.range(0.042, 0.052), pink ? col('#ec9ccc') : blue, col('#ffe680'), 5, 1);
    }
  }
}

function bluebell(B, rng, lite) {
  const leaves = lite ? 4 : 6;
  for (let i = 0; i < leaves; i++) {
    const az = rng.range(0, TAU);
    leaf(B, new THREE.Vector3(rng.jitter(0.06), 0, rng.jitter(0.06)), az, rng.range(0.2, 0.3), 0.022, col('#4a7a34'), { rise: 1.1, droop: 1.5, segs: 2, tip: col('#6a9a44') });
  }
  const stems = lite ? 5 : 7;
  for (let s = 0; s < stems; s++) {
    const a = rng.range(0, TAU), d = Math.sqrt(rng.next()) * 0.26;
    const base = new THREE.Vector3(Math.sin(a) * d, 0, Math.cos(a) * d);
    const h = rng.range(0.24, 0.36);
    const az = a + rng.jitter(0.8);
    // rises, then nods over to one side
    const mid = base.clone().add(new THREE.Vector3(Math.sin(az) * 0.02, h * 0.7, Math.cos(az) * 0.02));
    const tip = base.clone().add(new THREE.Vector3(Math.sin(az) * h * 0.38, h * 0.9, Math.cos(az) * h * 0.38));
    ribbon(B, [base, mid, tip], 0.006, col(STEM), az + Math.PI / 2);
    const bells = lite ? 3 : 4;
    const blue = col(rng.pick(['#6a62e0', '#5c5ad8', '#7468e4', '#5a66dc']));
    const rim = blue.clone().lerp(col('#c8c4ff'), 0.3);
    for (let k = 0; k < bells; k++) {
      const t = 0.3 + (k / bells) * 0.7;
      const p = t < 0.5 ? base.clone().lerp(mid, t * 2) : mid.clone().lerp(tip, (t - 0.5) * 2);
      const out = new THREE.Vector3(Math.sin(az + (k % 2 ? 0.6 : -0.6)), 0, Math.cos(az + (k % 2 ? 0.6 : -0.6)));
      const axis = out.clone().multiplyScalar(0.35).add(new THREE.Vector3(0, -1, 0)).normalize();
      bell(B, p.clone().addScaledVector(out, 0.02), axis, rng.range(0.06, 0.075), 0.026, blue, rim);
    }
  }
}

function anemone(B, rng, lite) {
  // deeply cut leaves: three-lobed whorls
  const whorls = lite ? 3 : 5;
  for (let i = 0; i < whorls; i++) {
    const a = rng.range(0, TAU), d = rng.range(0, 0.2);
    const p = new THREE.Vector3(Math.sin(a) * d, rng.range(0.04, 0.08), Math.cos(a) * d);
    const az = rng.range(0, TAU);
    for (let l = -1; l <= 1; l++) leaf(B, p, az + l * 0.9, rng.range(0.07, 0.1), 0.026, col('#4c8038'), { rise: 0.1, droop: 0.4 });
  }
  const n = lite ? 8 : 11;
  for (let s = 0; s < n; s++) {
    const a = rng.range(0, TAU), d = Math.sqrt(rng.next()) * 0.28;
    const base = new THREE.Vector3(Math.sin(a) * d, 0, Math.cos(a) * d);
    const h = rng.range(0.09, 0.17);
    const top = base.clone().add(new THREE.Vector3(rng.jitter(0.03), h, rng.jitter(0.03)));
    ribbon(B, [base, top], 0.005, col('#7a8a4a'), rng.range(0, TAU));
    // heads nod a little towards the light
    const nrm = new THREE.Vector3(rng.jitter(0.55), 1, rng.jitter(0.55)).normalize();
    const white = col(rng.pick(['#fbfaf6', '#f8f6f2', '#fdfbf8', '#f6f2f6']));
    cup(B, top, nrm, rng.range(0.052, 0.064), 0.05, white, col('#f2d040'), 6, 0.28);
  }
}

function campion(B, rng, lite) {
  const n = lite ? 6 : 9;
  for (let s = 0; s < n; s++) {
    const a = rng.range(0, TAU), d = Math.sqrt(rng.next()) * 0.22;
    const base = new THREE.Vector3(Math.sin(a) * d, 0, Math.cos(a) * d);
    const h = rng.range(0.24, 0.42);
    const lean = new THREE.Vector3(Math.sin(a) * 0.05 + rng.jitter(0.03), h, Math.cos(a) * 0.05 + rng.jitter(0.03));
    const top = base.clone().add(lean);
    const mid = base.clone().lerp(top, 0.5).add(new THREE.Vector3(rng.jitter(0.02), 0, rng.jitter(0.02)));
    ribbon(B, [base, mid, top], 0.006, col('#6a8a44'), rng.range(0, TAU));
    // opposite leaf pair low on the stem
    const az = rng.range(0, TAU);
    const lp = base.clone().lerp(mid, 0.5);
    leaf(B, lp, az, 0.08, 0.026, col(LEAF), { rise: 0.6, droop: 0.6 });
    leaf(B, lp, az + Math.PI, 0.08, 0.026, col(LEAF), { rise: 0.6, droop: 0.6 });
    const pink = col(rng.pick(['#e2589c', '#d84a92', '#ea6aa8', '#d0509a', '#f080b8']));
    const heads = lite ? 1 : rng.chance(0.5) ? 2 : 1;
    for (let k = 0; k < heads; k++) {
      const p = k ? mid.clone().lerp(top, 0.75).add(new THREE.Vector3(rng.jitter(0.05), 0, rng.jitter(0.05))) : top;
      const nrm = new THREE.Vector3(rng.jitter(0.6), 1, rng.jitter(0.6)).normalize();
      // notched petals: a ten-pointed star with deep notches
      star(B, p, nrm, rng.range(0.05, 0.06), pink, col('#f6d6e6'), 5, 0.52);
    }
  }
  // a basal rosette
  for (let i = 0; i < (lite ? 3 : 5); i++) leaf(B, new THREE.Vector3(rng.jitter(0.05), 0.01, rng.jitter(0.05)), rng.range(0, TAU), rng.range(0.1, 0.14), 0.035, col(LEAF), { rise: 0.3, droop: 0.6 });
}

function buttercup(B, rng, lite) {
  for (let i = 0; i < (lite ? 3 : 5); i++) {
    const az = rng.range(0, TAU);
    const p = new THREE.Vector3(rng.jitter(0.12), rng.range(0.02, 0.05), rng.jitter(0.12));
    for (let l = -1; l <= 1; l++) leaf(B, p, az + l * 0.7, 0.06, 0.028, col('#4e8434'), { rise: 0.2, droop: 0.3 });
  }
  const n = lite ? 7 : 10;
  for (let s = 0; s < n; s++) {
    const a = rng.range(0, TAU), d = Math.sqrt(rng.next()) * 0.27;
    const base = new THREE.Vector3(Math.sin(a) * d, 0, Math.cos(a) * d);
    const h = rng.range(0.12, 0.28);
    const top = base.clone().add(new THREE.Vector3(rng.jitter(0.05), h, rng.jitter(0.05)));
    const mid = base.clone().lerp(top, 0.55).add(new THREE.Vector3(rng.jitter(0.025), 0, rng.jitter(0.025)));
    ribbon(B, [base, mid, top], 0.005, col(STEM), rng.range(0, TAU));
    const nrm = new THREE.Vector3(rng.jitter(0.5), 1, rng.jitter(0.5)).normalize();
    // (a clear lemon yellow: a deeper gold turned orange in the shade under the warm grade)
    cup(B, top, nrm, rng.range(0.042, 0.05), 0.044, col(rng.pick(['#ffe83a', '#fff050', '#ffe02a'])), col('#e0b020'), 5, 0.5);
  }
}

const KINDS = { forgetMeNot, bluebell, anemone, campion, buttercup };
export const BLOOM_KINDS = Object.keys(KINDS);
/** Template height (× instance scale) per kind — for the view tests. */
export const BLOOM_HEIGHT = { forgetMeNot: 0.22, bluebell: 0.34, anemone: 0.2, campion: 0.48, buttercup: 0.32 };

/** A flower cushion of one kind (see BLOOM_KINDS). */
export function bloomTemplate(kind, rng, { lite = false } = {}) {
  const B = new GeoBuilder();
  (KINDS[kind] ?? forgetMeNot)(B, rng, lite);
  return B.build();
}

// ─── hydrangea ───────────────────────────────────────────────────────────────
// (round 6) The mophead used to be 26 big flat star cards at random angles —
// on the paper material it read as crumpled paper blocks, white by day and
// grey-blue by night. Now each head is a smooth, slightly flattened dome in the
// florets' own (deeper) colour, covered evenly (a Fibonacci lattice) by many
// small four-petal florets whose normals follow the dome: the head shades
// like a soft ball, up close every floret is a little cross of round petals.
const HYD = {
  blue: ['#6a86dc', '#7478d4', '#8284e0', '#6496dc', '#8c80d8'],
  pink: ['#e488b4', '#ec98c0', '#dc78a8', '#f0a8c8', '#d47cb2'],
  // (a lime-cream 'Annabelle' white — pure white blew out to paper in the sun)
  white: ['#e6ecd6', '#dde6cc', '#ecefdf', '#d6e2c2'],
};
const _dn = new THREE.Vector3();
const _pd = new THREE.Vector3();
const _ps = new THREE.Vector3();

/** A smooth dome (upper ~70 % of a flattened ball) in colour `c`: rings × seg, normals outward. */
function headDome(B, c, r, color, { seg = 8, rings = 3, flat = 0.82 } = {}) {
  const base = B.count;
  B.vert(c.x, c.y + r * flat, c.z, 0, 1, 0, 0.5, 0.5, color);
  for (let k = 1; k <= rings; k++) {
    const phi = (k / rings) * 1.95; // from the top down to ≈ 112°
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * TAU;
      const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
      _dn.set(nx, ny / flat, nz).normalize();
      B.vert(c.x + nx * r, c.y + ny * r * flat, c.z + nz * r, _dn.x, _dn.y, _dn.z, 0.5 + nx * 0.5, 0.5 + nz * 0.5, color.clone().multiplyScalar(0.9 + 0.1 * ny));
    }
  }
  for (let i = 0; i < seg; i++) B.tri(base, base + 1 + ((i + 1) % seg), base + 1 + i);
  for (let k = 1; k < rings; k++) {
    const a0 = base + 1 + (k - 1) * seg, b0 = base + 1 + k * seg;
    for (let i = 0; i < seg; i++) {
      const i1 = (i + 1) % seg;
      B.quad(a0 + i, a0 + i1, b0 + i1, b0 + i);
    }
  }
}

/**
 * A hydrangea floret on the head at p (dome normal n): four round petals
 * (two triangles each) around a tiny eye, every vertex lit with the dome's
 * normal (a smooth head, not facets); the petal tips droop a little.
 */
function floret(B, p, n, r, petal, eye, rot) {
  const ref = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP;
  _u.crossVectors(ref, n).normalize();
  _v.crossVectors(n, _u).normalize();
  for (let i = 0; i < 4; i++) {
    const a = rot + (i / 4) * TAU;
    _pd.set(0, 0, 0).addScaledVector(_u, Math.cos(a)).addScaledVector(_v, Math.sin(a));
    _ps.crossVectors(n, _pd).normalize();
    const b = B.count;
    const tip = p.clone().addScaledVector(_pd, r).addScaledVector(n, -r * 0.18);
    const mid = p.clone().addScaledVector(_pd, r * 0.55).addScaledVector(n, r * 0.04);
    const w = r * 0.42;
    B.vert(p.x, p.y, p.z, n.x, n.y, n.z, 0.5, 0, eye);
    B.vert(mid.x - _ps.x * w, mid.y - _ps.y * w, mid.z - _ps.z * w, n.x, n.y, n.z, 0, 0.55, petal);
    B.vert(tip.x, tip.y, tip.z, n.x, n.y, n.z, 0.5, 1, petal);
    B.vert(mid.x + _ps.x * w, mid.y + _ps.y * w, mid.z + _ps.z * w, n.x, n.y, n.z, 1, 0.55, petal);
    // (wound to face along n: two-sided materials flip a back face's normal)
    B.tri(b, b + 1, b + 2);
    B.tri(b, b + 2, b + 3);
  }
}

/**
 * A low hydrangea shrub at (x, y, z), radius ≈ 0.55·s: a dome of big dark,
 * toothed leaves, mophead blooms of four-petal florets on top. hue: 'blue' |
 * 'pink' | 'white'. lite: fewer florets. Writes the leaves into B and the
 * mopheads into H (default: B — their own smooth material is the caller's choice).
 */
export function hydrangea(B, rng, x, y, z, s, hue = 'blue', { lite = false, heads: H = B } = {}) {
  const leafCol = col('#3e6e30'), leafTip = col('#5c8c3c');
  const R = 0.55 * s;
  // leaves: pairs radiating from the dome, overlapping like shingles
  const nLeaves = lite ? 14 : 22;
  for (let i = 0; i < nLeaves; i++) {
    const az = rng.range(0, TAU);
    const el = rng.range(0.05, 1.0);
    const p = new THREE.Vector3(x + Math.sin(az) * R * 0.55 * (1 - el * 0.5), y + R * (0.15 + 0.6 * el), z + Math.cos(az) * R * 0.55 * (1 - el * 0.5));
    leaf(B, p, az + rng.jitter(0.5), R * rng.range(0.45, 0.6), R * 0.2, leafCol.clone().offsetHSL(0, 0, rng.jitter(0.04)), { rise: 0.45 - el * 0.4, droop: 0.7, segs: 2, tip: leafTip });
  }
  // mophead blooms
  const heads = lite ? 4 : 6;
  const pal = HYD[hue] ?? HYD.blue;
  const GOLD = Math.PI * (3 - Math.sqrt(5));
  for (let h = 0; h < heads; h++) {
    const az = (h / heads) * TAU + rng.jitter(0.6);
    const el = h === 0 ? 1 : rng.range(0.35, 0.8);
    const c = new THREE.Vector3(x + Math.sin(az) * R * 0.62 * Math.cos(el * 1.2), y + R * (0.55 + 0.55 * el), z + Math.cos(az) * R * 0.62 * Math.cos(el * 1.2));
    const hr = R * rng.range(0.3, 0.38);
    const base = col(rng.pick(pal));
    // (the head leans outwards a little, towards its side of the shrub)
    const tilt = new THREE.Vector3(Math.sin(az) * 0.35 * (1 - el * 0.6), 1, Math.cos(az) * 0.35 * (1 - el * 0.6)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, tilt);
    // the ball beneath: the florets' colour, deeper — no dark gaps between them
    const flat = 0.84;
    {
      const b0 = H.count;
      headDome(H, c, hr * 0.94, base.clone().multiplyScalar(0.72), { seg: lite ? 7 : 8, rings: 3, flat });
      // (turn the dome with the head)
      for (let i = b0; i < H.count; i++) {
        _dn.set(H.pos[i * 3] - c.x, H.pos[i * 3 + 1] - c.y, H.pos[i * 3 + 2] - c.z).applyQuaternion(q);
        H.pos[i * 3] = c.x + _dn.x;
        H.pos[i * 3 + 1] = c.y + _dn.y;
        H.pos[i * 3 + 2] = c.z + _dn.z;
        _dn.set(H.nor[i * 3], H.nor[i * 3 + 1], H.nor[i * 3 + 2]).applyQuaternion(q);
        H.nor[i * 3] = _dn.x;
        H.nor[i * 3 + 1] = _dn.y;
        H.nor[i * 3 + 2] = _dn.z;
      }
    }
    // (the old mophead's random draws are burnt here, so the shrubs placed
    //  after this one stay exactly where they were; the florets draw from a
    //  stream of their own)
    for (let k = 0; k < (lite ? 16 : 26) * 5; k++) rng.next();
    const frng = createRng(`vegetation:hydrangea-head:${x.toFixed(2)},${z.toFixed(2)}:${h}`);
    const florets = lite ? 26 : 42;
    const fr = hr * (lite ? 0.36 : 0.3);
    const lime = col('#e8f0c8');
    for (let f = 0; f < florets; f++) {
      // an even Fibonacci cover of the dome's upper ~70 %
      const t = (f + 0.5) / florets;
      const fy = 1 - t * 1.25;
      const rr = Math.sqrt(Math.max(0, 1 - fy * fy));
      const fa = f * GOLD + h;
      const n = new THREE.Vector3(Math.cos(fa) * rr + frng.jitter(0.06), fy, Math.sin(fa) * rr + frng.jitter(0.06)).normalize();
      const ns = new THREE.Vector3(n.x, n.y / flat, n.z).normalize().applyQuaternion(q);
      const p = new THREE.Vector3(n.x * hr, n.y * hr * flat, n.z * hr).applyQuaternion(q).add(c).addScaledVector(ns, hr * 0.03);
      // (florets age from lime-cream at the heart to the full hue at the edge;
      //  the top of the head a touch lighter)
      const fc = base.clone().offsetHSL(frng.jitter(0.025), 0, frng.jitter(0.04) + 0.03 * fy);
      if (fy > 0.75 && frng.chance(0.35)) fc.lerp(lime, 0.35);
      floret(H, p, ns, fr * frng.range(0.85, 1.15), fc, fc.clone().lerp(col('#f4f0d8'), 0.45), frng.range(0, TAU));
    }
  }
}
