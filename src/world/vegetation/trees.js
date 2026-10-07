// ─────────────────────────────────────────────────────────────────────────────
// The forest wall — colossal old trees ringing the glen (refs: the giant tree
// with the elven house, the fly-agaric forest path's tall trunks).
//
// Each giant: a trunk 3–5 units across, leaning and twisting a little, that
// swells into buttress roots at the foot (lobes that run out over the ground
// as mossy roots and plunge into the soil), broken branch stubs, a few heavy
// limbs reaching into a high canopy of leaf-card masses, ivy climbing the
// lower trunk. Silver birches are slimmer, white with dark lenticels and a
// black, fissured foot.
//
// Output goes into shared builders: bark (giants), birch (vertex-coloured
// bark), ivy (cards) and canopy clump placements (instanced by the caller).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { createNoise2D } from '../../core/noise.js';
import { getHeight } from '../ground.js';
import { OAK } from '../layout.js';
import { GeoBuilder, TAU } from './common.js';
import { tube, BARK_MEAN, MOSS_TINT } from './groundcover.js';
import { blocksView } from './zones.js';

const noise = createNoise2D(2718);
const UP = new THREE.Vector3(0, 1, 0);
const sstep = THREE.MathUtils.smoothstep;
const BARK = new THREE.Color(BARK_MEAN);
const MOSS = new THREE.Color(MOSS_TINT);
const MOSS_DARK = new THREE.Color(MOSS_TINT).multiplyScalar(0.62);
const HIGH = new THREE.Color('#857a6c'); // weathered, lichen-grey bark up high
const _col = new THREE.Color();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Unit canopy clump: leaf cards in a squashed sphere, normals bent outwards, darker underneath. */
export function clumpTemplate(rng, cards, { flat = 0.7, size = [0.17, 0.27] } = {}) {
  const B = new GeoBuilder();
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  const u = new THREE.Vector3();
  const f = new THREE.Vector3();
  const sn = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  for (let k = 0; k < cards; k++) {
    let x, y, z, l;
    do {
      x = rng.range(-1, 1);
      y = rng.range(-1, 1);
      z = rng.range(-1, 1);
      l = x * x + y * y + z * z;
    } while (l > 1 || l < 0.02);
    l = Math.sqrt(l);
    x /= l;
    y /= l;
    z /= l;
    if (y < 0 && rng.chance(0.3)) y = -y;
    const d = 0.35 + 0.65 * Math.pow(rng.next(), 0.4);
    c.set(x * d, y * d * flat, z * d);
    sn.set(c.x, c.y / (flat * flat), c.z).normalize();
    v.copy(sn).multiplyScalar(0.8);
    v.y += 0.3;
    v.add(tmp.set(rng.jitter(1), rng.jitter(1), rng.jitter(1)).multiplyScalar(0.45)).normalize();
    const ref = Math.abs(v.y) > 0.9 ? tmp.set(1, 0, 0) : UP;
    u.crossVectors(ref, v).normalize();
    f.crossVectors(u, v).normalize();
    const roll = rng.range(0, Math.PI);
    const a = u.clone().multiplyScalar(Math.cos(roll)).addScaledVector(f, Math.sin(roll));
    const s = rng.range(size[0], size[1]);
    f.crossVectors(a, v).normalize();
    c.addScaledVector(v, -s * 0.6);
    // vertex colour: sunlit top, cool dark heart & underside
    const shade = THREE.MathUtils.clamp(0.55 + 0.45 * (sn.y * 0.5 + 0.5) * (0.5 + 0.5 * d), 0.45, 1);
    const col = new THREE.Color(shade * 0.96, shade, shade * (0.9 + 0.12 * (1 - shade)));
    const flip = rng.chance(0.5);
    const base = B.count;
    for (const [cx, cy, tu, tv] of [[-1, 0, 0, 0], [1, 0, 1, 0], [1, 2, 1, 1], [-1, 2, 0, 1]]) {
      const px = c.x + (a.x * cx + v.x * cy) * s;
      const py = c.y + (a.y * cx + v.y * cy) * s;
      const pz = c.z + (a.z * cx + v.z * cy) * s;
      tmp.set(px, py / (flat * flat), pz);
      tmp.y += 0.25 * tmp.length();
      tmp.normalize();
      B.vert(px, py, pz, tmp.x, tmp.y, tmp.z, flip ? 1 - tu : tu, tv, col);
    }
    B.quad(base, base + 1, base + 2, base + 3);
  }
  return B.build();
}

/** Ring heights of a trunk (dense at the flare, sparse up high). */
function ringHeights(H) {
  const ys = [-2.4, -0.7, 0, 0.3, 0.7, 1.2, 1.9, 2.8, 4, 5.6, 7.6, 10, 13, 17, 22, 28, 35, 43, 52, 62];
  const out = ys.filter((y) => y < H - 1);
  out.push(H);
  return out;
}

/**
 * Build one giant (or birch) into the builders.
 * B: { bark, birch, ivy } GeoBuilders; clumps: array receiving canopy placements.
 */
export function buildTree(t, B, clumps, { density = 1 } = {}) {
  const rng = createRng(t.seed);
  const birch = t.kind === 'birch';
  const R = t.radius;
  const H = t.height;
  const y0 = t.y0;
  // bark furrows: deep vertical fissures between broad plates, ~1.8 apart
  // (t.lod < 1: a tree no lens ever comes close to gets fewer segments)
  const lod = THREE.MathUtils.clamp(t.lod ?? 1, 0.5, 1);
  const nFur = birch ? 0 : Math.max(6, Math.round(R * 3.4));
  const seg = birch ? Math.round(14 * (0.6 + 0.4 * lod)) : Math.max(18, Math.round(Math.min(48, Math.max(24, nFur * 4)) * lod));
  const tubeK = lod < 0.8 ? 0.75 : 1;
  const leanDir = new THREE.Vector3(Math.sin(t.leanAz), 0, Math.cos(t.leanAz));
  const ph = rng.range(0, TAU);
  const center = (y) => {
    const off = t.lean * y * y / H * 10;
    return new THREE.Vector3(
      t.x + leanDir.x * off + Math.sin(y * 0.11 + ph) * R * 0.22,
      y0 + y,
      t.z + leanDir.z * off + Math.cos(y * 0.09 + ph * 1.3) * R * 0.22,
    );
  };
  // buttress lobes
  const nl = birch ? 3 : rng.int(4, 6);
  const lobes = [];
  for (let i = 0; i < nl; i++) lobes.push({ a: (i / nl) * TAU + rng.jitter(0.5), amp: rng.range(0.6, 1.2) });
  const lobeAt = (th) => {
    let s = 0;
    for (const l of lobes) {
      const c = Math.cos(th - l.a);
      if (c > 0) s += Math.pow(c, 7) * l.amp;
    }
    return s;
  };
  // (noise is sampled on a circle so the trunk closes seamlessly at θ = 0 / 2π)
  const cn = (th, k, y, ky, o = 0) => noise(Math.cos(th) * k + o, Math.sin(th) * k + y * ky);
  const furrow = (th, y) => {
    if (!nFur) return 0;
    const w = Math.abs(Math.sin(th * nFur * 0.5 + y * 0.045 + 1.1 * cn(th, 0.9, y, 0.05, ph)));
    return 1 - Math.pow(w, 0.4); // 1 deep in a fissure, ~0 across the plates
  };
  const radiusAt = (y, th) => {
    const taper = 1 - 0.42 * Math.min(1, Math.max(0, y) / H);
    const fl = Math.exp(-Math.max(0, y) / (R * (birch ? 0.5 : 0.95)));
    const flare = 1 + fl * ((birch ? 0.25 : 0.4) + (birch ? 0.5 : 1.5) * lobeAt(th)) + (y < 0 ? 0.3 : 0);
    const bark = 1 + 0.045 * cn(th, 1.4, y, 0.25, ph) + 0.02 * cn(th, 4.5, y, 1.3) - 0.075 * furrow(th, y);
    return R * taper * flare * bark;
  };

  // expose the sculpted surface (string lights, brackets, ivy … can hug it)
  t.centerAt = center;
  t.radiusAt = radiusAt;
  // may a leaf mass of size s hang at p? (never in the Great Oak's crown, never in a spot's view)
  const canopyOk = (p, s) => {
    const od = Math.hypot(p.x - OAK.x, p.z - OAK.z);
    if (od < 19 + s && p.y < 48) return false;
    return !blocksView(p.x, p.y, p.z, s * 0.9);
  };

  // ── trunk ──
  const ys = ringHeights(H);
  const TB = birch ? B.birch : B.bark;
  const base = TB.count;
  const idx0 = TB.idx.length;
  const birchCol = (th, y) => {
    // birch: chalk white with dark lenticel dashes and black patches; black fissured foot
    const foot = 1 - THREE.MathUtils.smoothstep(y, 0.4, 2.8);
    const dash = cn(th, 3, y, 2.6, ph) > 0.55 ? 1 : 0;
    const patch = cn(th, 1.1, y, 0.35, 3 - ph) > 0.62 ? 1 : 0;
    const dark = Math.max(foot * 0.9, dash * 0.75, patch * 0.85);
    const w = new THREE.Color('#e9e4d6');
    return w.lerp(new THREE.Color('#2b2724'), dark);
  };
  // giants: moss climbs from the foot (highest on the damp side and in the
  // furrows between the buttresses), lichen-grey weathered bark up high,
  // a dark foot where the trunk meets the soil
  const mossSide = rng.range(0, TAU);
  const giantCol = (th, y) => {
    const side = 0.5 + 0.5 * Math.cos(th - mossSide);
    const reach = 1.2 + side * side * (5 + R * 2) + 2.2 * cn(th, 1.4, y, 0.1, ph) + (1 - Math.min(1, lobeAt(th) * 2)) * 1.5;
    let m = 1 - sstep(y, reach * 0.45, reach);
    const streak = sstep(cn(th, 3, y, 0.07, ph * 2), 0.25, 0.6) * (1 - sstep(y, 5, 18 + side * 8));
    m = Math.max(m, streak * 0.75) * 0.95;
    _col.copy(BARK).lerp(HIGH, sstep(y, 8, 38) * 0.55);
    _col.lerp(m > 0.55 ? MOSS : MOSS_DARK, m);
    // dark fissures, plates catching the light
    return _col.multiplyScalar((0.62 + 0.38 * sstep(y, -0.6, 2.2)) * (1 - 0.32 * furrow(th, y))).clone();
  };
  for (let k = 0; k < ys.length; k++) {
    const y = ys[k];
    const c = center(y);
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * TAU;
      const r = radiusAt(y, th);
      const cx = Math.cos(th), sz = Math.sin(th);
      _p.set(c.x + cx * r, c.y, c.z + sz * r);
      TB.vert(_p.x, _p.y, _p.z, cx, 0, sz, i / seg, y, birch ? birchCol(th, y) : giantCol(th, y));
    }
  }
  const row = seg + 1;
  for (let k = 0; k < ys.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = base + k * row + i;
      TB.quad(a, a + row, a + row + 1, a + 1);
    }
  }
  TB.smoothNormals(base, idx0);
  // weld the normals across the UV seam (θ = 0 and 2π are separate vertices)
  for (let k = 0; k < ys.length; k++) {
    const a = (base + k * row) * 3, b = (base + k * row + seg) * 3;
    for (let c = 0; c < 3; c++) TB.nor[a + c] = TB.nor[b + c] = (TB.nor[a + c] + TB.nor[b + c]) * 0.5;
  }

  // ── buttress roots running over the ground ──
  if (!birch) {
    for (const l of lobes) {
      const steps = 8;
      const len = R * rng.range(2.2, 3.8) * l.amp;
      const pts = [];
      const radii = [];
      let a = l.a;
      for (let i = 0; i <= steps; i++) {
        const s = i / steps;
        const d = R * 0.65 + s * len;
        a += rng.jitter(0.07);
        const px = t.x + Math.cos(a) * d, pz = t.z + Math.sin(a) * d;
        const gy = getHeight(px, pz);
        // starts high on the flare, hugs the soil, dives in at the end
        const lift = R * 0.55 * Math.pow(1 - s, 2.2) + R * 0.12 - s * s * R * 0.35;
        pts.push(new THREE.Vector3(px, gy + lift, pz));
        radii.push(R * (0.42 - 0.3 * s) * l.amp);
      }
      // moss blankets the roots' upper side, thickest near the trunk
      const rootMoss = (i, j, nrm, p) => {
        const m = sstep(nrm.y + 0.3 * noise(p.x * 1.3, p.z * 1.3) + 0.25 * (1 - i / steps), -0.2, 0.45);
        return _col.copy(BARK).multiplyScalar(0.8).lerp(MOSS, m * 0.95).clone();
      };
      tube(B.bark, pts, radii, Math.round(9 * tubeK), { wob: (i, th) => 1 + 0.08 * Math.sin(th * 3 + i), vcol: rootMoss });
      // a side rootlet
      if (rng.chance(0.6)) {
        const k = rng.int(3, 5);
        const side = rng.chance(0.5) ? 1 : -1;
        const a2 = l.a + side * rng.range(0.5, 0.9);
        const p0 = pts[k];
        const sub = [];
        for (let i = 0; i <= 4; i++) {
          const s = i / 4;
          const px = p0.x + Math.cos(a2) * s * len * 0.4, pz = p0.z + Math.sin(a2) * s * len * 0.4;
          sub.push(new THREE.Vector3(px, getHeight(px, pz) + radii[k] * 0.5 * (1 - s) - s * 0.1, pz));
        }
        tube(B.bark, sub, sub.map((_, i) => radii[k] * 0.55 * (1 - i * 0.18)), 6, {
          vcol: (i, j, nrm) => _col.copy(BARK).multiplyScalar(0.8).lerp(MOSS, sstep(nrm.y, -0.25, 0.4) * 0.9).clone(),
        });
      }
    }
  }

  // ── broken branch stubs ──
  const stubs = birch ? rng.int(1, 3) : rng.int(1, 3);
  for (let i = 0; i < stubs; i++) {
    const y = rng.range(birch ? 4 : 7, H * 0.4);
    const th = rng.range(0, TAU);
    const c = center(y);
    const r0 = radiusAt(y, th) * 0.9;
    const dir = new THREE.Vector3(Math.cos(th), rng.range(0.1, 0.5), Math.sin(th)).normalize();
    const p0 = c.clone().add(new THREE.Vector3(Math.cos(th) * r0 * 0.7, 0, Math.sin(th) * r0 * 0.7));
    const l = R * rng.range(0.6, 1.4);
    tube(TB, [p0, p0.clone().addScaledVector(dir, l * 0.5), p0.clone().addScaledVector(dir, l)], [R * 0.2, R * 0.16, R * 0.12], 7, {
      capEnd: true,
      color: birch ? () => new THREE.Color('#3a3430') : null,
      // a cushion of moss on the stub's upper side
      vcol: birch ? null : (k, j, nrm) => _col.copy(BARK).lerp(HIGH, 0.3).lerp(MOSS, sstep(nrm.y, 0.1, 0.6) * 0.9).clone(),
    });
  }

  // ── heavy limbs into the canopy ──
  const limbs = birch ? rng.int(3, 5) : rng.int(3, 5);
  const ends = [];
  for (let i = 0; i < limbs; i++) {
    const y = H * rng.range(birch ? 0.45 : 0.5, 0.85);
    const th = (i / limbs) * TAU + rng.jitter(0.6);
    const c = center(y);
    const dir = new THREE.Vector3(Math.cos(th), rng.range(0.55, 1.1), Math.sin(th)).normalize();
    const l = R * rng.range(birch ? 6 : 4, birch ? 9 : 7);
    const pts = [c.clone()];
    const p = c.clone();
    for (let s = 1; s <= 4; s++) {
      dir.y += 0.08;
      dir.x += rng.jitter(0.15);
      dir.z += rng.jitter(0.15);
      dir.normalize();
      p.addScaledVector(dir, l / 4);
      pts.push(p.clone());
    }
    // a limb whose leaves may not grow there (oak crown, a spot's view) would
    // read as a bare dead spike — leave it out
    if (!canopyOk(p, birch ? 2.6 : 4) || pts.some((q) => blocksView(q.x, q.y, q.z, R * 0.6))) continue;
    tube(TB, pts, pts.map((_, k) => R * (birch ? 0.5 : 0.42) * (1 - k * 0.19)), birch ? 7 : Math.round(10 * tubeK), {
      color: birch ? () => new THREE.Color('#d8d2c4') : (k) => _col.copy(BARK).lerp(HIGH, 0.5).multiplyScalar(0.9 - k * 0.04).clone(),
    });
    ends.push(p.clone());
  }
  ends.push(center(H).add(new THREE.Vector3(0, R * 1.5, 0)));
  // lower side limbs with their own leaf masses (break up the bare columns;
  // the view test below drops any mass that would hide a spot)
  const mids = [];
  if (!birch) {
    const nm = rng.int(2, 4);
    const inward = Math.atan2(-t.z, -t.x); // (θ: x = cos θ, z = sin θ) — towards the glen
    for (let i = 0; i < nm; i++) {
      const y = rng.range(11, Math.min(32, H * 0.55));
      // half of them reach into the clearing (framing it), the rest anywhere
      const th = rng.chance(0.5) ? inward + rng.jitter(1.1) : rng.range(0, TAU);
      const c = center(y);
      const dir = new THREE.Vector3(Math.cos(th), rng.range(0.25, 0.6), Math.sin(th)).normalize();
      const l = R * rng.range(3, 5);
      const pts = [c.clone()];
      const p = c.clone();
      for (let s = 1; s <= 3; s++) {
        dir.y += 0.1;
        dir.normalize();
        p.addScaledVector(dir, l / 3);
        pts.push(p.clone());
      }
      // only keep the limb if its leaves would not hide a spot
      if (!canopyOk(p, 3.2) || pts.some((q) => blocksView(q.x, q.y, q.z, R * 0.4))) continue;
      tube(TB, pts, pts.map((_, k) => R * 0.3 * (1 - k * 0.22)), Math.round(8 * tubeK), {
        vcol: (k, j, nrm) => _col.copy(BARK).lerp(HIGH, 0.35).lerp(MOSS, sstep(nrm.y, 0.2, 0.7) * 0.7).clone(),
      });
      mids.push(p.clone());
      // trailing ivy curtains hanging from the limb
      if (B.ivy) {
        for (let k = 1; k < pts.length; k++) {
          if (!rng.chance(0.75)) continue;
          const a = pts[k - 1], b = pts[k];
          const strands = Math.max(1, Math.round(rng.int(1, 3) * density));
          for (let q = 0; q < strands; q++) {
            const top = a.clone().lerp(b, rng.next());
            top.y -= R * 0.2;
            const len = rng.range(1.5, 4.5);
            if (blocksView(top.x, top.y - len / 2, top.z, len / 2)) continue;
            hangingStrand(B.ivy, rng, top, len);
          }
        }
      }
    }
  }

  // ── canopy: leaf masses around the limb ends and the crown top ──
  // (the Great Oak's painterly greens: deep → warm, a cool blue-green now and then;
  //  birches lighter and yellower)
  const tint = birch
    ? new THREE.Color('#8fae4c').lerp(new THREE.Color('#b5c060'), rng.next() * 0.6)
    : new THREE.Color('#3d7a47').lerp(new THREE.Color('#5f9440'), rng.range(0.1, 0.85)).lerp(new THREE.Color('#33685a'), rng.chance(0.3) ? rng.range(0.2, 0.5) : 0);
  for (const e of [...ends, ...mids]) {
    const mid = mids.includes(e);
    const far = Math.hypot(t.x, t.z) > 31;
    const n = Math.round(rng.int(birch || mid || far ? 2 : 3, birch || far ? 2 : mid ? 3 : 4) * Math.min(1, 0.6 + 0.4 * density));
    for (let k = 0; k < n; k++) {
      const s = (birch ? rng.range(2.2, 3.4) : mid ? rng.range(2.4, 3.8) : rng.range(3.6, 6.2)) * (R > 2 ? 1.1 : 1);
      const p = e.clone().add(new THREE.Vector3(rng.jitter(s * 0.9), rng.jitter(s * 0.35), rng.jitter(s * 0.9)));
      // never in the Great Oak's crown, never in a spot camera's view
      if (!canopyOk(p, s)) continue;
      if (mid && Math.hypot(p.x - OAK.x, p.z - OAK.z) < 21 + s) continue;
      clumps.push({ x: p.x, y: p.y, z: p.z, s, sy: rng.range(0.75, 1), ry: rng.range(0, TAU), color: tint.clone().offsetHSL(rng.jitter(0.012), 0, rng.jitter(0.04)) });
    }
  }

  // ── ivy climbing the lower trunk (giants only, not all) ──
  if (!birch && B.ivy && rng.chance(0.6)) {
    const vines = rng.int(1, 3);
    for (let v = 0; v < vines; v++) {
      let th = rng.range(0, TAU);
      const top = rng.range(5, 14);
      const cards = Math.round(top * 9 * density);
      for (let i = 0; i < cards; i++) {
        const y = Math.pow(rng.next(), 0.8) * top + 0.3;
        const a = th + Math.sin(y * 0.35 + v) * 0.35 + rng.jitter(0.22);
        const c = center(y);
        const r = radiusAt(y, a) * 1.01;
        const nrm = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const p = c.add(nrm.clone().multiplyScalar(r));
        ivyCard(B.ivy, rng, p, nrm, rng.range(0.22, 0.38));
      }
      th += rng.range(1, 2.5);
    }
  }
}

/** A trailing strand of ivy hanging from `top`: crossed cards stacked downwards, drifting a little. */
function hangingStrand(B, rng, top, len) {
  const p = top.clone();
  const s = rng.range(0.32, 0.46);
  const n = Math.max(2, Math.round(len / (s * 0.8)));
  const col = new THREE.Color().setHSL(0.27 + rng.jitter(0.03), 0.42, 0.42 + rng.jitter(0.08));
  const drift = new THREE.Vector3(rng.jitter(0.05), 0, rng.jitter(0.05));
  for (let i = 0; i < n; i++) {
    const yaw = rng.range(0, Math.PI);
    for (const off of [0, Math.PI / 2]) {
      const ax = Math.cos(yaw + off), az = Math.sin(yaw + off);
      const w = s * 0.5 * (1 - (i / n) * 0.35);
      const base = B.count;
      const nx = -az, nz = ax; // card normal (horizontal)
      // v = 0 at the attachment (the texture's stem), 1 at the tip hanging below
      B.vert(p.x - ax * w, p.y, p.z - az * w, nx, 0.2, nz, 0, 0, col);
      B.vert(p.x + ax * w, p.y, p.z + az * w, nx, 0.2, nz, 1, 0, col);
      B.vert(p.x + ax * w + drift.x, p.y - s, p.z + az * w + drift.z, nx, 0.2, nz, 1, 1, col);
      B.vert(p.x - ax * w + drift.x, p.y - s, p.z - az * w + drift.z, nx, 0.2, nz, 0, 1, col);
      B.quad(base, base + 1, base + 2, base + 3);
    }
    p.y -= s * 0.8;
    p.add(drift);
  }
}

/** One ivy sprig card lying against the bark at p (normal n), growing upwards. */
function ivyCard(B, rng, p, n, s) {
  const up = new THREE.Vector3(rng.jitter(0.6), 1, rng.jitter(0.6)).normalize();
  // project "up" into the bark plane
  up.addScaledVector(n, -up.dot(n)).normalize();
  const across = new THREE.Vector3().crossVectors(up, n).normalize();
  const tilt = n.clone().multiplyScalar(0.25); // sprigs stand off the bark a little
  const v = up.clone().add(tilt).normalize();
  const base = B.count;
  const col = new THREE.Color().setHSL(0.27 + rng.jitter(0.03), 0.45, 0.5 + rng.jitter(0.1));
  const corners = [[-1, 0, 0, 0], [1, 0, 1, 0], [1, 2, 1, 1], [-1, 2, 0, 1]];
  for (const [cx, cy, tu, tv] of corners) {
    _p.copy(p).addScaledVector(across, cx * s * 0.5).addScaledVector(v, cy * s * 0.5);
    _n.copy(n).multiplyScalar(0.8).addScaledVector(UP, 0.3).normalize();
    B.vert(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z, tu, tv, col);
  }
  B.quad(base, base + 1, base + 2, base + 3);
}
