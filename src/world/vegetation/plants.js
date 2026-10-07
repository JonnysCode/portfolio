// ─────────────────────────────────────────────────────────────────────────────
// Hand-made plant TEMPLATES for the undergrowth (built once, instanced many
// times). Every template stands at the origin on y = 0, unit-ish size.
//
//   fernTemplate(rng, opts)   a rosette of arching fronds. Each frond is a
//        fern leaf card bent along its length (rising, then drooping towards
//        the tip) and folded along the midrib, so light catches it like a
//        real frond. A few young fronds stand up, curled at the tip.
//   grassTemplate(rng, opts)  a tussock of crossed, bent grass cards.
//   cloverTemplate(rng)       a patch of trefoils (heart-shaped leaflets that
//                             use the leaf texture's veins).
//   flowerTemplate(kind, rng) small communities of wildflowers — bluebells,
//        forget-me-nots, foxgloves, daisies, buttercups, a mixed meadow —
//        built from real little bells, petals, discs, stems and leaves.
//        UVs map every petal/leaf onto the 'leaf' surface (veins!), vertex
//        colours carry the hues.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { GeoBuilder, TAU } from './common.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const col = (hex) => new THREE.Color(hex);

// ─── bent leaf strips ────────────────────────────────────────────────────────
/**
 * A card bent along a centre line. pts: array of Vector3 along the strip
 * (base → tip), widths per point, side: unit vector across the strip at each
 * point. fold lifts the midrib (+) or the edges (−) along the normal.
 * Emits 3 vertices across (left edge, midrib, right edge). UV: u across, v along.
 */
function strip(B, pts, widths, sides, { fold = 0, color = null, colorTip = null, uv = [0, 1, 0, 1] } = {}) {
  const n = pts.length;
  const base = B.count;
  const [u0, u1, v0, v1] = uv;
  // winding must agree with the (upward-flipped) normal so double-sided lighting works
  _b.subVectors(pts[Math.min(1, n - 1)], pts[0]).normalize();
  const flipped = _c.crossVectors(sides[0], _b).y < 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const s = sides[i];
    // along direction
    const nx = i < n - 1 ? pts[i + 1] : p;
    const pv = i > 0 ? pts[i - 1] : p;
    _a.subVectors(nx, pv).normalize();
    _n.crossVectors(s, _a).normalize();
    if (_n.y < 0) _n.negate();
    const w = widths[i];
    const t = i / (n - 1);
    const c = colorTip ? color.clone().lerp(colorTip, t) : color;
    const v = v0 + (v1 - v0) * t;
    const f = fold * w;
    // left edge, midrib, right edge
    B.vert(p.x - s.x * w - _n.x * f, p.y - s.y * w - _n.y * f, p.z - s.z * w - _n.z * f, _n.x - s.x * 0.35, _n.y, _n.z - s.z * 0.35, u0, v, c);
    B.vert(p.x, p.y, p.z, _n.x, _n.y, _n.z, (u0 + u1) / 2, v, c);
    B.vert(p.x + s.x * w - _n.x * f, p.y + s.y * w - _n.y * f, p.z + s.z * w - _n.z * f, _n.x + s.x * 0.35, _n.y, _n.z + s.z * 0.35, u1, v, c);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 3, b = base + (i + 1) * 3;
    if (flipped) {
      B.quad(a, b, b + 1, a + 1);
      B.quad(a + 1, b + 1, b + 2, a + 2);
    } else {
      B.quad(a, a + 1, b + 1, b);
      B.quad(a + 1, a + 2, b + 2, b + 1);
    }
  }
}

/**
 * An arching curve: starts at `origin`, heads out along azimuth `az` with
 * elevation e0, bending down by `droop` (radians) towards the tip.
 */
function archPoints(origin, az, length, e0, droop, segs, curlTip = 0) {
  const pts = [origin.clone()];
  const p = origin.clone();
  const dl = length / segs;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    let e = e0 - droop * Math.pow(t, 1.4);
    if (curlTip) e -= curlTip * Math.pow(t, 6);
    const h = Math.cos(e);
    p.x += Math.sin(az) * h * dl;
    p.z += Math.cos(az) * h * dl;
    p.y += Math.sin(e) * dl;
    pts.push(p.clone());
  }
  return pts;
}

// ─── ferns ───────────────────────────────────────────────────────────────────
/**
 * opts: { fronds: [min, max], length: [min, max], e0: [min, max], droop: [min, max],
 *         width (card width / length), segs, upright (0..1) }
 */
export function fernTemplate(rng, opts = {}) {
  const B = new GeoBuilder();
  const n = rng.int(opts.fronds?.[0] ?? 7, opts.fronds?.[1] ?? 11);
  const segs = opts.segs ?? 6;
  const phase = rng.range(0, TAU);
  const light = col('#ffffff');
  const dark = col('#b9c8a8');
  for (let i = 0; i < n; i++) {
    const az = phase + (i / n) * TAU + rng.jitter(0.35);
    const len = rng.range(opts.length?.[0] ?? 0.75, opts.length?.[1] ?? 1.05);
    const e0 = rng.range(opts.e0?.[0] ?? 0.85, opts.e0?.[1] ?? 1.2);
    const droop = rng.range(opts.droop?.[0] ?? 1.1, opts.droop?.[1] ?? 1.7);
    const origin = new THREE.Vector3(Math.sin(az) * 0.03, 0.01, Math.cos(az) * 0.03);
    const pts = archPoints(origin, az, len, e0, droop, segs);
    const wMax = len * (opts.width ?? 0.36);
    const widths = pts.map((_, k) => {
      const t = k / segs;
      // fronds are narrow at the stipe, widest at a third, tapering to the tip
      return wMax * (t < 0.12 ? 0.35 + t * 4 : 1) * (1 - 0.15 * t);
    });
    // across direction: horizontal, perpendicular to the frond's heading, with a little roll
    const roll = rng.jitter(0.35);
    const side = new THREE.Vector3(Math.cos(az), roll, -Math.sin(az)).normalize();
    const sides = pts.map(() => side);
    // older (outer, lower) fronds a little darker/yellower at the base
    strip(B, pts, widths, sides, { fold: 0.22, color: dark, colorTip: light, uv: [0, 1, 0, 1] });
  }
  // young fronds: upright, shorter, in the heart of the rosette
  const young = rng.int(opts.young?.[0] ?? 1, opts.young?.[1] ?? 3);
  for (let i = 0; i < young; i++) {
    const az = rng.range(0, TAU);
    const len = rng.range(0.35, 0.6) * (opts.length?.[1] ?? 1);
    const pts = archPoints(new THREE.Vector3(0, 0.01, 0), az, len, rng.range(1.25, 1.45), rng.range(0.2, 0.5), 5, 1.2);
    const w = len * 0.22;
    const side = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    strip(B, pts, pts.map((_, k) => w * (0.4 + 0.6 * Math.sin((k / 5) * Math.PI * 0.9))), pts.map(() => side), { fold: 0.35, color: col('#e8ffd0'), uv: [0.1, 0.9, 0, 0.85] });
  }
  return B.build();
}

// ─── grass ───────────────────────────────────────────────────────────────────
export function grassTemplate(rng, { cards = [3, 5], height = [0.45, 0.65], spread = 0.08 } = {}) {
  const B = new GeoBuilder();
  const n = rng.int(cards[0], cards[1]);
  const phase = rng.range(0, Math.PI);
  for (let i = 0; i < n; i++) {
    const az = phase + (i / n) * Math.PI + rng.jitter(0.25);
    const h = rng.range(height[0], height[1]);
    const lean = rng.range(0.15, 0.45);
    const bend = rng.range(0.2, 0.6);
    const out = rng.range(0, spread);
    const tilt = rng.range(0, TAU);
    const o = new THREE.Vector3(Math.sin(tilt) * out, 0, Math.cos(tilt) * out);
    // the card faces az; it leans away from the tuft's centre
    const pts = archPoints(o, tilt, h, Math.PI / 2 - lean, bend, 3);
    const side = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    const w = h * rng.range(0.28, 0.36);
    strip(B, pts, pts.map(() => w), pts.map(() => side), { fold: 0.1, color: col('#c6d4a8'), colorTip: col('#ffffff') });
  }
  return B.build();
}

// ─── clover ──────────────────────────────────────────────────────────────────
/** One heart-shaped leaflet fan; UV maps the leaf texture (base V=0 → tip V=1). */
function leaflet(B, m, size, color) {
  const seg = 5;
  const base = B.count;
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const n = new THREE.Vector3(0, 1, 0).applyMatrix3(nm).normalize();
  const p = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
  B.vert(p.x, p.y, p.z, n.x, n.y, n.z, 0.5, 0.02, color);
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (i / seg) * Math.PI; // across, −90° … 90°
    // obcordate (heart pointing out) outline: widest near the tip, notched
    const t = Math.abs(a) / (Math.PI / 2);
    const r = size * (0.62 + 0.38 * Math.cos(t * Math.PI * 0.5)) * (1 - 0.22 * Math.exp(-a * a * 30));
    const x = Math.sin(a) * r * 0.85;
    const z = Math.cos(a) * r;
    const y = -0.15 * size * t * t; // edges droop a touch
    _c.set(x, y, z).applyMatrix4(m);
    B.vert(_c.x, _c.y, _c.z, n.x, n.y, n.z, 0.5 + x / (size * 2), z / size, color);
  }
  for (let i = 0; i < seg; i++) B.tri(base, base + 1 + i, base + 2 + i);
}

export function cloverTemplate(rng, { count = [8, 12], radius = 0.26 } = {}) {
  const B = new GeoBuilder();
  const n = rng.int(count[0], count[1]);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let k = 0; k < n; k++) {
    const a = rng.range(0, TAU), d = Math.sqrt(rng.next()) * radius;
    const x = Math.sin(a) * d, z = Math.cos(a) * d;
    const h = rng.range(0.03, 0.09);
    const s = rng.range(0.028, 0.042);
    const c = col(rng.pick(['#e9f5d2', '#ffffff', '#d8e8c0', '#f4ffe4']));
    const yaw = rng.range(0, TAU);
    for (let l = 0; l < 3; l++) {
      const az = yaw + (l / 3) * TAU;
      q.setFromEuler(new THREE.Euler(rng.jitter(0.25), az, 0, 'YXZ'));
      m.compose(new THREE.Vector3(x, h, z), q, new THREE.Vector3(1, 1, 1));
      leaflet(B, m, s, c);
    }
    // the petiole
    stem(B, new THREE.Vector3(x, 0, z), new THREE.Vector3(x, h, z), 0.004, col('#8fae6a'));
  }
  return B.build();
}

// ─── flower parts ────────────────────────────────────────────────────────────
/** A thin 3-sided stem from a to b (optionally through a bend point). UV on the leaf midrib. */
function stem(B, a, b, r, color, bendTo = null) {
  const pts = bendTo ? [a, bendTo, b] : [a, b];
  for (let s = 0; s < pts.length - 1; s++) {
    const p0 = pts[s], p1 = pts[s + 1];
    _a.subVectors(p1, p0).normalize();
    const ref = Math.abs(_a.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP;
    const u = new THREE.Vector3().crossVectors(ref, _a).normalize();
    const v = new THREE.Vector3().crossVectors(_a, u).normalize();
    const base = B.count;
    for (const [p, rr, vv] of [[p0, r, 0.1], [p1, r * 0.8, 0.9]]) {
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * TAU;
        const dx = u.x * Math.cos(ang) + v.x * Math.sin(ang);
        const dy = u.y * Math.cos(ang) + v.y * Math.sin(ang);
        const dz = u.z * Math.cos(ang) + v.z * Math.sin(ang);
        B.vert(p.x + dx * rr, p.y + dy * rr, p.z + dz * rr, dx, dy, dz, 0.5, vv, color);
      }
    }
    for (let i = 0; i < 3; i++) {
      const i1 = (i + 1) % 3;
      B.quad(base + i, base + i1, base + 3 + i1, base + 3 + i);
    }
  }
}

/** A flat-ish petal/leaf blade from `base` along `dir` (unit), opening along `side`. */
function blade(B, base, dir, side, len, wid, color, { cup = 0, droop = 0, segs = 3, tipColor = null } = {}) {
  const pts = [];
  const widths = [];
  const sides = [];
  const d = dir.clone();
  const p = base.clone();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push(p.clone());
    widths.push(wid * Math.sin(Math.max(0.15, Math.min(1, t * 1.15)) * Math.PI) * (t < 0.98 ? 1 : 0.2) + wid * 0.08);
    sides.push(side);
    d.y -= droop / segs;
    d.normalize();
    p.addScaledVector(d, len / segs);
  }
  strip(B, pts, widths, sides, { fold: -cup, color, colorTip: tipColor });
}

/** A bell (lathe) hanging from `top`, opening along `axis` (unit). */
function bell(B, top, axis, len, rad, color, inner = null, { flare = 0.35, seg = 7 } = {}) {
  const ref = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP;
  const u = new THREE.Vector3().crossVectors(ref, axis).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  // profile (t along the axis, radius factor)
  const prof = [[0, 0.3], [0.45, 0.9], [1, 1 + flare]];
  const base = B.count;
  for (const [t, rf] of prof) {
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      // scalloped rim
      const sc = t === 1 ? 1 + 0.18 * Math.cos(a * 6) : 1;
      const r = rad * rf * sc;
      const ox = u.x * ca + v.x * sa, oy = u.y * ca + v.y * sa, oz = u.z * ca + v.z * sa;
      const px = top.x + axis.x * len * t + ox * r;
      const py = top.y + axis.y * len * t + oy * r;
      const pz = top.z + axis.z * len * t + oz * r;
      B.vert(px, py, pz, ox, oy, oz, i / seg, t, t > 0.9 && inner ? inner : color);
    }
  }
  const row = seg + 1;
  for (let j = 0; j < prof.length - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const a = base + j * row + i;
      B.quad(a, a + 1, a + row + 1, a + row);
    }
  }
}

/** One petal as a single quad (base narrow, tip wide) — the leaf texture's veins show on it. */
function petalQuad(B, base, dir, side, normal, len, wid, color) {
  const b = B.count;
  const tip = base.clone().addScaledVector(dir, len);
  const n = normal;
  B.vert(base.x - side.x * wid * 0.3, base.y - side.y * wid * 0.3, base.z - side.z * wid * 0.3, n.x, n.y, n.z, 0.35, 0, color);
  B.vert(base.x + side.x * wid * 0.3, base.y + side.y * wid * 0.3, base.z + side.z * wid * 0.3, n.x, n.y, n.z, 0.65, 0, color);
  B.vert(tip.x + side.x * wid * 0.5, tip.y + side.y * wid * 0.5, tip.z + side.z * wid * 0.5, n.x, n.y, n.z, 0.9, 1, color);
  B.vert(tip.x - side.x * wid * 0.5, tip.y - side.y * wid * 0.5, tip.z - side.z * wid * 0.5, n.x, n.y, n.z, 0.1, 1, color);
  // wind so the front face looks along +normal
  B.quad(b, b + 3, b + 2, b + 1);
}

/** A tiny flat star flower (forget-me-not): one fan with lobed petals and a coloured eye. */
function starFlower(B, center, normal, r, petalCol, eyeCol, lobes = 5) {
  const ref = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP;
  const u = new THREE.Vector3().crossVectors(ref, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  const b = B.count;
  B.vert(center.x, center.y, center.z, normal.x, normal.y, normal.z, 0.5, 0.5, eyeCol);
  const n = lobes * 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rr = i % 2 === 0 ? r : r * 0.55;
    const p = center.clone().addScaledVector(u, Math.cos(a) * rr).addScaledVector(v, Math.sin(a) * rr);
    B.vert(p.x, p.y, p.z, normal.x, normal.y, normal.z, 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a), petalCol);
  }
  for (let i = 0; i < n; i++) B.tri(b, b + 1 + i, b + 1 + ((i + 1) % n));
}

/** A radial flower head facing `normal`: n petals around a domed disc. */
function radialFlower(B, center, normal, { petals = 12, len = 0.05, wid = 0.012, petal, disc, discR = 0.012, cup = 0, tilt = 0.15 }) {
  const ref = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP;
  const u = new THREE.Vector3().crossVectors(ref, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * TAU;
    const dir = new THREE.Vector3().addScaledVector(u, Math.cos(a)).addScaledVector(v, Math.sin(a)).addScaledVector(normal, tilt + cup).normalize();
    const side = new THREE.Vector3().crossVectors(normal, dir).normalize();
    petalQuad(B, center.clone().addScaledVector(dir, discR * 0.6), dir, side, normal, len, wid, petal);
  }
  // disc: a little dome (5-sided)
  const base = B.count;
  const top = center.clone().addScaledVector(normal, discR * 0.6);
  B.vert(top.x, top.y, top.z, normal.x, normal.y, normal.z, 0.5, 0.5, disc);
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * TAU;
    const o = new THREE.Vector3().addScaledVector(u, Math.cos(a) * discR).addScaledVector(v, Math.sin(a) * discR);
    const p = center.clone().add(o);
    const nn = o.clone().normalize().addScaledVector(normal, 0.6).normalize();
    B.vert(p.x, p.y, p.z, nn.x, nn.y, nn.z, 0.5, 0.5, disc);
  }
  for (let i = 0; i < 6; i++) B.tri(base, base + 1 + i, base + 2 + i);
}

const GREEN = '#6f9a48';
const LEAF_GREEN = '#5d8a3a';

// ─── flower communities ──────────────────────────────────────────────────────
function bluebells(B, rng) {
  const stems = rng.int(4, 7);
  for (let s = 0; s < stems; s++) {
    const a = rng.range(0, TAU), d = rng.range(0, 0.14);
    const base = new THREE.Vector3(Math.sin(a) * d, 0, Math.cos(a) * d);
    const h = rng.range(0.24, 0.4);
    const az = rng.range(0, TAU);
    // arching stem: rises then nods over to one side
    const pts = archPoints(base, az, h * 1.15, rng.range(1.35, 1.5), rng.range(1.4, 2.0), 4);
    for (let i = 0; i < pts.length - 1; i++) stem(B, pts[i], pts[i + 1], 0.0055, col(GREEN));
    const bells = rng.int(3, 6);
    const blue = col(rng.pick(['#5a62d6', '#6a5ed0', '#4f6ad8', '#7a6ee0']));
    const inner = blue.clone().lerp(col('#d8d8ff'), 0.35);
    for (let k = 0; k < bells; k++) {
      const t = 0.42 + (k / bells) * 0.56;
      const idx = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
      const f = t * (pts.length - 1) - idx;
      const p = pts[idx].clone().lerp(pts[idx + 1], f);
      // bells hang on one side of the stem on short pedicels
      const out = new THREE.Vector3(Math.sin(az + Math.PI / 2 * (k % 2 ? 1 : -0.3)), 0, Math.cos(az + Math.PI / 2 * (k % 2 ? 1 : -0.3))).multiplyScalar(0.012);
      const top = p.clone().add(out);
      top.y -= 0.008;
      const axis = new THREE.Vector3(out.x * 20, -1, out.z * 20).normalize();
      bell(B, top, axis, rng.range(0.03, 0.042), 0.011, blue, inner, { flare: 0.45, seg: 5 });
    }
  }
  // strap leaves
  const leaves = rng.int(4, 7);
  for (let i = 0; i < leaves; i++) {
    const az = rng.range(0, TAU);
    const pts = archPoints(new THREE.Vector3(rng.jitter(0.05), 0, rng.jitter(0.05)), az, rng.range(0.18, 0.3), rng.range(0.9, 1.3), rng.range(0.9, 1.5), 3);
    const side = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    strip(B, pts, pts.map((_, k) => 0.014 * (1 - k / 4) + 0.004), pts.map(() => side), { fold: 0.3, color: col(LEAF_GREEN), uv: [0.3, 0.7, 0, 1] });
  }
}

function forgetMeNots(B, rng) {
  const stems = rng.int(5, 8);
  for (let s = 0; s < stems; s++) {
    const a = rng.range(0, TAU), d = rng.range(0, 0.16);
    const base = new THREE.Vector3(Math.sin(a) * d, 0, Math.cos(a) * d);
    const h = rng.range(0.1, 0.22);
    const top = base.clone().add(new THREE.Vector3(rng.jitter(0.04), h, rng.jitter(0.04)));
    stem(B, base, top, 0.004, col(GREEN));
    // small oval leaves
    {
      const az = rng.range(0, TAU);
      const lb = base.clone().lerp(top, rng.range(0.15, 0.5));
      const dir = new THREE.Vector3(Math.sin(az), 0.5, Math.cos(az)).normalize();
      blade(B, lb, dir, new THREE.Vector3(Math.cos(az), 0, -Math.sin(az)), 0.05, 0.012, col(LEAF_GREEN), { droop: 0.4, segs: 1 });
    }
    // a little scorpioid cluster of tiny flowers
    const n = rng.int(4, 7);
    const blue = col(rng.pick(['#6fa8f0', '#7ab4f4', '#5f9ae8', '#8ab8f0']));
    for (let k = 0; k < n; k++) {
      const p = top.clone().add(new THREE.Vector3(rng.jitter(0.028), rng.jitter(0.012), rng.jitter(0.028)));
      const nrm = new THREE.Vector3(rng.jitter(0.6), 1, rng.jitter(0.6)).normalize();
      const pink = k === 0 && rng.chance(0.4);
      starFlower(B, p, nrm, 0.0085, pink ? col('#e8a8d0') : blue, col('#f4e070'));
    }
  }
}

function foxgloves(B, rng) {
  const spikes = rng.int(1, 3);
  for (let s = 0; s < spikes; s++) {
    const base = new THREE.Vector3(rng.jitter(0.1), 0, rng.jitter(0.1));
    const h = rng.range(0.7, 1.05);
    const lean = new THREE.Vector3(rng.jitter(0.08), h, rng.jitter(0.08));
    const top = base.clone().add(lean);
    const mid = base.clone().lerp(top, 0.5).add(new THREE.Vector3(rng.jitter(0.03), 0, rng.jitter(0.03)));
    stem(B, base, top, 0.011, col(GREEN), mid);
    const pink = col(rng.pick(['#c8509a', '#b8489c', '#d066a8', '#a85cb8', '#e8d8e8']));
    const inner = col('#f6e6f0');
    const n = rng.int(10, 15);
    const face = rng.range(0, TAU);
    for (let k = 0; k < n; k++) {
      const t = 0.32 + (k / n) * 0.62;
      const p = base.clone().lerp(top, t);
      // the bells all face roughly one way (as foxgloves do), spiralling a little
      const az = face + rng.jitter(1.1);
      const out = new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
      const axis = out.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, -0.55, 0)).normalize();
      const sz = 1 - t * 0.55;
      bell(B, p.clone().addScaledVector(out, 0.012), axis, 0.06 * sz, 0.016 * sz, pink, inner, { flare: 0.35, seg: 6 });
    }
    // tip buds
    for (let k = 0; k < 3; k++) {
      const p = base.clone().lerp(top, 0.95 + k * 0.02);
      bell(B, p, new THREE.Vector3(rng.jitter(0.5), -0.3, rng.jitter(0.5)).normalize(), 0.015, 0.006, col('#9ab868'), null, { flare: 0, seg: 5 });
    }
  }
  // broad rosette leaves lying on the ground
  const leaves = rng.int(5, 8);
  for (let i = 0; i < leaves; i++) {
    const az = (i / leaves) * TAU + rng.jitter(0.3);
    const dir = new THREE.Vector3(Math.sin(az), 0.45, Math.cos(az)).normalize();
    blade(B, new THREE.Vector3(0, 0.01, 0), dir, new THREE.Vector3(Math.cos(az), 0, -Math.sin(az)), rng.range(0.2, 0.3), rng.range(0.05, 0.07), col('#5f8a3c'), { droop: 0.7, segs: 4, cup: 0.15 });
  }
}

function daisies(B, rng) {
  const n = rng.int(5, 10);
  for (let s = 0; s < n; s++) {
    const a = rng.range(0, TAU), d = rng.range(0, 0.18);
    const base = new THREE.Vector3(Math.sin(a) * d, 0, Math.cos(a) * d);
    const h = rng.range(0.07, 0.17);
    const top = base.clone().add(new THREE.Vector3(rng.jitter(0.03), h, rng.jitter(0.03)));
    stem(B, base, top, 0.0035, col(GREEN));
    const nrm = new THREE.Vector3(rng.jitter(0.5), 1, rng.jitter(0.5)).normalize();
    const tipPink = rng.chance(0.4) ? col('#f4c8d8') : null;
    radialFlower(B, top, nrm, { petals: rng.int(11, 14), len: 0.022, wid: 0.006, petal: tipPink ?? col('#fbfbf4'), disc: col('#f2c230'), discR: 0.0065, tilt: 0.08 });
  }
  // basal rosettes of spoon leaves
  for (let i = 0; i < rng.int(4, 7); i++) {
    const az = rng.range(0, TAU);
    const dir = new THREE.Vector3(Math.sin(az), 0.25, Math.cos(az)).normalize();
    blade(B, new THREE.Vector3(rng.jitter(0.1), 0.005, rng.jitter(0.1)), dir, new THREE.Vector3(Math.cos(az), 0, -Math.sin(az)), 0.05, 0.016, col(LEAF_GREEN), { droop: 0.3, segs: 2 });
  }
}

function buttercups(B, rng) {
  const n = rng.int(4, 8);
  for (let s = 0; s < n; s++) {
    const a = rng.range(0, TAU), d = rng.range(0, 0.18);
    const base = new THREE.Vector3(Math.sin(a) * d, 0, Math.cos(a) * d);
    const h = rng.range(0.16, 0.32);
    const top = base.clone().add(new THREE.Vector3(rng.jitter(0.05), h, rng.jitter(0.05)));
    const mid = base.clone().lerp(top, 0.55).add(new THREE.Vector3(rng.jitter(0.03), 0, rng.jitter(0.03)));
    stem(B, base, top, 0.0035, col(GREEN), mid);
    const nrm = new THREE.Vector3(rng.jitter(0.5), 1, rng.jitter(0.5)).normalize();
    radialFlower(B, top, nrm, { petals: 5, len: 0.017, wid: 0.009, petal: col('#ffd21a'), disc: col('#c8a018'), discR: 0.005, cup: 0.5, tilt: 0.2 });
    if (rng.chance(0.5)) {
      // a side bud
      const bud = base.clone().lerp(top, 0.7).add(new THREE.Vector3(rng.jitter(0.04), 0.02, rng.jitter(0.04)));
      stem(B, mid, bud, 0.0025, col(GREEN));
      radialFlower(B, bud, new THREE.Vector3(0, 1, 0), { petals: 5, len: 0.008, wid: 0.006, petal: col('#e8d040'), disc: col('#90a030'), discR: 0.004, cup: 0.9, tilt: 0.3 });
    }
  }
  // lobed leaves (three blades each)
  for (let i = 0; i < rng.int(4, 6); i++) {
    const az = rng.range(0, TAU);
    const p = new THREE.Vector3(rng.jitter(0.12), rng.range(0.02, 0.06), rng.jitter(0.12));
    for (let l = -1; l <= 1; l++) {
      const a2 = az + l * 0.7;
      const dir = new THREE.Vector3(Math.sin(a2), 0.2, Math.cos(a2)).normalize();
      blade(B, p, dir, new THREE.Vector3(Math.cos(a2), 0, -Math.sin(a2)), 0.035, 0.016, col('#5a8a38'), { segs: 2, droop: 0.2 });
    }
  }
}

function meadow(B, rng) {
  daisies(B, rng);
  if (rng.chance(0.7)) buttercups(B, rng);
  // white clover heads
  for (let i = 0; i < rng.int(2, 4); i++) {
    const base = new THREE.Vector3(rng.jitter(0.2), 0, rng.jitter(0.2));
    const top = base.clone().add(new THREE.Vector3(rng.jitter(0.02), rng.range(0.06, 0.11), rng.jitter(0.02)));
    stem(B, base, top, 0.003, col(GREEN));
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * TAU;
      const dir = new THREE.Vector3(Math.cos(a), rng.range(-0.2, 0.9), Math.sin(a)).normalize();
      blade(B, top, dir, new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), 0.012, 0.004, col('#f6f2e4'), { segs: 1, tipColor: col('#f0d8e0') });
    }
  }
}

const KINDS = { bluebells, forgetMeNots, foxgloves, daisies, buttercups, meadow };
export const FLOWER_KINDS = Object.keys(KINDS);

/** A small community of one wildflower kind (see FLOWER_KINDS). */
export function flowerTemplate(kind, rng) {
  const B = new GeoBuilder();
  (KINDS[kind] ?? meadow)(B, rng);
  return B.build();
}
