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
import { tube } from './groundcover.js';
import { blocksView } from './zones.js';

const noise = createNoise2D(2718);
const UP = new THREE.Vector3(0, 1, 0);
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
  const seg = birch ? 14 : 24;
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
  const radiusAt = (y, th) => {
    const taper = 1 - 0.42 * Math.min(1, Math.max(0, y) / H);
    const fl = Math.exp(-Math.max(0, y) / (R * (birch ? 0.5 : 0.95)));
    const flare = 1 + fl * ((birch ? 0.25 : 0.4) + (birch ? 0.5 : 1.5) * lobeAt(th)) + (y < 0 ? 0.3 : 0);
    const bark = 1 + 0.045 * noise(th * 2.2 + ph, y * 0.25) + 0.02 * noise(th * 7, y * 1.3);
    return R * taper * flare * bark;
  };

  // ── trunk ──
  const ys = ringHeights(H);
  const TB = birch ? B.birch : B.bark;
  const base = TB.count;
  const idx0 = TB.idx.length;
  const birchCol = (th, y) => {
    // birch: chalk white with dark lenticel dashes and black patches; black fissured foot
    const foot = 1 - THREE.MathUtils.smoothstep(y, 0.4, 2.8);
    const dash = noise(th * 3.2 + ph, y * 2.6) > 0.55 ? 1 : 0;
    const patch = noise(th * 1.1 - ph, y * 0.35 + 3) > 0.62 ? 1 : 0;
    const dark = Math.max(foot * 0.9, dash * 0.75, patch * 0.85);
    const w = new THREE.Color('#e9e4d6');
    return w.lerp(new THREE.Color('#2b2724'), dark);
  };
  for (let k = 0; k < ys.length; k++) {
    const y = ys[k];
    const c = center(y);
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * TAU;
      const r = radiusAt(y, th);
      const cx = Math.cos(th), sz = Math.sin(th);
      _p.set(c.x + cx * r, c.y, c.z + sz * r);
      TB.vert(_p.x, _p.y, _p.z, cx, 0, sz, i / seg, y, birch ? birchCol(th, y) : null);
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
      tube(B.bark, pts, radii, 9, { wob: (i, th) => 1 + 0.08 * Math.sin(th * 3 + i) });
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
        tube(B.bark, sub, sub.map((_, i) => radii[k] * 0.55 * (1 - i * 0.18)), 6, {});
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
    tube(TB, pts, pts.map((_, k) => R * (birch ? 0.5 : 0.42) * (1 - k * 0.19)), birch ? 7 : 10, { color: birch ? () => new THREE.Color('#d8d2c4') : null });
    ends.push(p.clone());
  }
  ends.push(center(H).add(new THREE.Vector3(0, R * 1.5, 0)));
  // lower side limbs with their own leaf masses (break up the bare columns;
  // the view test below drops any mass that would hide a spot)
  const mids = [];
  if (!birch) {
    const nm = rng.int(1, 3);
    for (let i = 0; i < nm; i++) {
      const y = rng.range(13, Math.min(30, H * 0.5));
      const th = rng.range(0, TAU);
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
      if (blocksView(p.x, p.y, p.z, 3.5)) continue;
      tube(TB, pts, pts.map((_, k) => R * 0.3 * (1 - k * 0.22)), 8, {});
      mids.push(p.clone());
    }
  }

  // ── canopy: leaf masses around the limb ends and the crown top ──
  const tint = birch
    ? new THREE.Color().setHSL(0.2 + rng.jitter(0.02), 0.55, 0.6)
    : new THREE.Color().setHSL(0.26 + rng.jitter(0.035), 0.42 + rng.jitter(0.08), 0.45 + rng.jitter(0.06));
  for (const e of [...ends, ...mids]) {
    const mid = mids.includes(e);
    const far = Math.hypot(t.x, t.z) > 31;
    const n = Math.round(rng.int(birch || mid || far ? 2 : 3, birch || far ? 3 : mid ? 3 : 4) * Math.min(1, 0.6 + 0.4 * density));
    for (let k = 0; k < n; k++) {
      const s = (birch ? rng.range(2.2, 3.4) : mid ? rng.range(2.4, 3.8) : rng.range(3.6, 6.2)) * (R > 2 ? 1.1 : 1);
      const p = e.clone().add(new THREE.Vector3(rng.jitter(s * 0.9), rng.jitter(s * 0.35), rng.jitter(s * 0.9)));
      // never in the Great Oak's crown, never in a spot camera's view
      const od = Math.hypot(p.x - OAK.x, p.z - OAK.z);
      if (od < 19 + s && p.y < 48) continue;
      if (mid && od < 21 + s) continue;
      if (blocksView(p.x, p.y, p.z, s * 0.9)) continue;
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
