// ─────────────────────────────────────────────────────────────────────────────
// Garden pieces for Jonny's cottage — all hand-made and a little crooked:
// a weathered picket fence, a gate under a rose arch hung with fairy lights,
// flagstones, a raised vegetable bed, pumpkins, a joiner-made bench, a neat
// woodpile, the carved "Jonny's Woodland" sign, the mailbox and a sleepy cat.
//
// Static pieces go into a Batch frame F (merged with the houses). Pieces that
// are hotspots (sign, mailbox, cat) are their own little groups so they can be
// clicked, bounce on hover and animate.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import {
  Batch, mats, xf, mat4, board, boardBetween, rod, stoneGeo, blockStone, mossGeo, tube, taperTube, sagCurve, leafGeo,
  Cards, addFlower, addGrass, addFern, addToadstool, addIvy, uvBox, paintFn, deform, TAU, WOOD, IRON, FLOWER_COLORS,
  noiseA,
} from './kit.js';

const _v = new THREE.Vector3();

/** A frame-local adapter: geometry built around the origin is placed by `m` before entering F. */
export function local(F, m) {
  return { add: (mat, geo, opts) => F.add(mat, geo.applyMatrix4(m), opts) };
}

// ─── fence ───────────────────────────────────────────────────────────────────
/** A pointed picket (board with a pointed top), base at y = 0, facing +Z. */
function picketGeo(w, h, t) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h - w * 0.55);
  s.lineTo(0, h);
  s.lineTo(-w / 2, h - w * 0.55);
  s.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
  g.translate(0, 0, -t / 2);
  return uvBox(g, 'y');
}

/**
 * A crooked picket fence along an arc around (cx, cz) at radius r from azimuth
 * a0 to a1, skipping gaps [[az, halfAngle], …]. Pickets face outwards.
 */
export function fenceArc(F, rng, { cx, cz, r, a0, a1, gaps = [], height = 0.85 }) {
  const M = mats();
  const inGap = (a, pad = 0) => gaps.some(([g, h]) => Math.abs(a - g) < h + pad);
  const at = (a, rr) => [cx + Math.sin(a) * rr, cz + Math.cos(a) * rr];
  // posts
  const postStep = 1.15 / r;
  const posts = [];
  for (let a = a0; a <= a1 + 1e-6; a += postStep) if (!inGap(a, postStep * 0.3)) posts.push(a);
  for (const g of gaps) posts.push(g[0] - g[1], g[0] + g[1]);
  for (const a of posts) {
    const [x, z] = at(a, r);
    const ph = height + 0.12 + rng.range(-0.04, 0.05);
    const p = board(0.09, ph, 0.09, { along: 'y', rng });
    xf(p, [x, ph / 2 - 0.05, z], [rng.jitter(0.04), -a, rng.jitter(0.04)]);
    F.add(M.wood, p, { color: WOOD.grey, cast: true });
    F.add(M.wood, xf(new THREE.ConeGeometry(0.07, 0.08, 4).rotateY(Math.PI / 4), [x, ph - 0.01, z], [0, -a, 0]), { color: WOOD.grey, cast: false });
  }
  // rails between consecutive posts (outside the gaps)
  posts.sort((p, q) => p - q);
  for (let i = 0; i < posts.length - 1; i++) {
    const pa = posts[i], pb = posts[i + 1];
    if (inGap((pa + pb) / 2)) continue;
    for (const ry of [0.24, height - 0.18]) {
      const [xa, za] = at(pa, r - 0.06), [xb, zb] = at(pb, r - 0.06);
      F.add(M.wood, boardBetween([xa, ry + rng.jitter(0.02), za], [xb, ry + rng.jitter(0.02), zb], 0.035, 0.07, { rng, bow: 0.015 }), { color: WOOD.weathered, cast: false });
    }
  }
  // pickets
  const step = 0.135 / r;
  for (let a = a0 + step / 2; a < a1; a += step) {
    if (inGap(a, 0.06 / r)) continue;
    if (rng.chance(0.03)) continue; // a missing one
    const [x, z] = at(a, r + 0.01);
    const h = height * rng.range(0.9, 1.05);
    const pk = picketGeo(0.075, h, 0.02);
    xf(pk, [x, -0.04, z], [rng.jitter(0.05), a + rng.jitter(0.05), rng.jitter(0.06)]);
    const tone = new THREE.Color(rng.chance(0.15) ? '#b7a993' : WOOD.grey).multiplyScalar(rng.range(0.85, 1.1));
    F.add(M.wood, pk, { color: '#' + tone.getHexString(), cast: true });
  }
}

/**
 * Garden gate between two posts at p0 → p1 (world XZ), opened inwards by `open`
 * radians, under a bent-branch arch with climbing roses and fairy lights.
 * Returns the points the fairy lights hang from (top of the arch).
 */
export function gateArch(F, rng, { p0, p1, open = 0.5, inward = 1, halos = [] }) {
  const M = mats();
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
  const w = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz) - Math.PI / 2; // local +x runs p0 → p1
  const m = mat4([p0[0], 0, p0[1]], [0, yaw, 0]);
  const L = local(F, m);
  // gate posts with acorn finials
  for (const x of [0, w]) {
    L.add(M.wood, board(0.13, 1.25, 0.13, { along: 'y', rng }).translate(x, 0.58, 0), { color: WOOD.walnut });
    L.add(M.wood, new THREE.SphereGeometry(0.075, 8, 6).scale(1, 1.15, 1).translate(x, 1.27, 0), { color: WOOD.walnut, cast: false });
    L.add(M.wood, new THREE.CylinderGeometry(0.06, 0.08, 0.05, 8).translate(x, 1.2, 0), { color: WOOD.dark, cast: false });
  }
  // the gate leaf (hinged at x = 0), ledged & braced pickets
  const gl = w - 0.16;
  const leaf = new THREE.Matrix4().makeTranslation(0.08, 0, 0).premultiply(new THREE.Matrix4().makeRotationY(open * inward)).premultiply(m);
  const G = local(F, leaf);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * gl;
    const h = 0.82 + 0.1 * Math.sin((i / (n - 1)) * Math.PI);
    G.add(M.wood, picketGeo(0.085, h, 0.022).translate(x, 0.06, 0.03), { color: WOOD.oak });
  }
  for (const y of [0.25, 0.68]) G.add(M.wood, board(gl, 0.07, 0.03, { along: 'x', rng }).translate(gl / 2, y, -0.0), { color: WOOD.oakLight, cast: false });
  G.add(M.wood, boardBetween([0.08, 0.28, -0.01], [gl - 0.08, 0.66, -0.01], 0.03, 0.06), { color: WOOD.oakLight, cast: false });
  for (const y of [0.25, 0.68]) G.add(M.metal, new THREE.BoxGeometry(0.22, 0.035, 0.01).translate(0.1, y, -0.022), { color: IRON, cast: false });
  G.add(M.metal, new THREE.TorusGeometry(0.04, 0.009, 4, 10).translate(gl - 0.08, 0.5, -0.03), { color: IRON, cast: false });

  // arch: two leaning branch posts and a bent branch over the top
  const top = 2.35;
  const archPts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const a = Math.PI * (1 - t);
    archPts.push(new THREE.Vector3(w / 2 + Math.cos(a) * (w / 2 + 0.12), 1.55 + Math.sin(a) * (top - 1.55) + noiseA(t * 3, 1.2) * 0.04, -0.12));
  }
  for (const x of [-0.12, w + 0.12]) {
    L.add(M.wood, taperTube([[x, -0.05, -0.12], [x + (x < 0 ? 0.02 : -0.02), 0.8, -0.12], [x, 1.56, -0.12]], 0.06, 0.05, 6, 8), { color: '#6b5440' });
  }
  L.add(M.wood, taperTube(archPts, 0.055, 0.05, 6, 24), { color: '#6b5440' });
  // climbing roses & leaves along the arch
  const cards = new Cards();
  const ivyF = { add: (mat, geo, opts) => L.add(mat, geo, opts) };
  for (const side of [0, 1]) {
    const x = side ? w + 0.12 : -0.12;
    addIvy(ivyF, rng, [x, 0.05, -0.08], [0, 1, 0], { length: 1.9, droop: -0.6, size: 0.22, density: 1.8, normal: [0, 0, 1], cards, stemColor: '#4a5a2a' });
    addIvy(ivyF, rng, [x, 0.05, -0.16], [0, 1, 0], { length: 1.6, droop: -0.6, size: 0.2, density: 1.5, normal: [0, 0, -1], cards, stemColor: '#4a5a2a' });
  }
  for (let i = 0; i < 26; i++) {
    const q = archPts[Math.floor(rng.next() * archPts.length)];
    cards.add(q.clone().add(new THREE.Vector3(rng.jitter(0.08), rng.jitter(0.06), rng.jitter(0.1))), new THREE.Vector3(rng.jitter(1), -0.6, rng.jitter(1)).normalize(), new THREE.Vector3(rng.jitter(0.5), 0.3, 1).normalize(), 0.22 * rng.range(0.7, 1.2), { aspect: 0.9 });
  }
  L.add(M.ivy, cards.geometry(), { cast: false });
  const roseC = ['#d8456b', '#f08aa8', '#c42d4f', '#f6c1cf'];
  for (let i = 0; i < 22; i++) {
    const t = rng.next();
    let p;
    if (t < 0.55) p = archPts[Math.floor(rng.next() * archPts.length)].clone();
    else p = new THREE.Vector3(rng.chance(0.5) ? -0.12 : w + 0.12, rng.range(0.6, 1.6), -0.12);
    p.x += rng.jitter(0.09);
    p.y += rng.jitter(0.06);
    p.z += rng.jitter(0.1) + 0.04;
    addRose(L, rng, p, rng.range(0.05, 0.075), rng.pick(roseC));
  }
  // fairy lights draped along the arch
  const lightPts = archPts.map((p) => new THREE.Vector3(p.x, p.y - 0.04, p.z + 0.07));
  stringLights(L, [lightPts], halos, { spacing: 0.17, sag: 0, transform: m });
  return { matrix: m, width: w, top };
}

/** A rose bloom: layered petal discs around a bud. */
export function addRose(F, rng, p, s, color) {
  const M = mats();
  const c = new THREE.Color(color);
  for (let k = 0; k < 3; k++) {
    const ring = new THREE.SphereGeometry(s * (1 - k * 0.25), 7, 4, 0, TAU, 0, Math.PI * (0.55 - k * 0.08));
    ring.scale(1, 0.7, 1);
    ring.rotateX(-0.6 + rng.jitter(0.3));
    ring.rotateY(rng.next() * TAU);
    F.add(M.vc, ring.translate(p.x, p.y - k * s * 0.08, p.z), { color: '#' + c.clone().multiplyScalar(1 - k * 0.12).getHexString(), cast: false });
  }
}

// ─── string lights ───────────────────────────────────────────────────────────
/**
 * Fairy lights: a thin dark wire through each polyline (Vector3 lists, local
 * to F) with warm bulbs every `spacing`. sag > 0 adds a catenary between
 * consecutive points. `transform` maps local points to world for the halos.
 */
export function stringLights(F, lines, halos, { spacing = 0.28, sag = 0.08, transform = null, bulb = 0.03 } = {}) {
  const M = mats();
  for (const pts of lines) {
    let path = pts;
    if (sag > 0) {
      path = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const c = sagCurve(pts[i], pts[i + 1], pts[i].distanceTo(pts[i + 1]) * sag, 10);
        const sp = c.getPoints(10);
        if (i > 0) sp.shift();
        path.push(...sp);
      }
    }
    if (path.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(path, false, 'centripetal');
    const len = curve.getLength();
    F.add(M.vc, new THREE.TubeGeometry(curve, Math.max(8, Math.round(len * 12)), 0.007, 3, false), { color: '#2e2a25', cast: false });
    const n = Math.max(1, Math.floor(len / spacing));
    for (let k = 0; k < n; k++) {
      const p = curve.getPointAt((k + 0.5) / n);
      F.add(M.metal, new THREE.CylinderGeometry(bulb * 0.45, bulb * 0.45, bulb * 0.7, 5).translate(p.x, p.y - bulb * 0.5, p.z), { color: '#3a332c', cast: false });
      F.add(M.bulb, new THREE.SphereGeometry(bulb, 6, 4).scale(1, 1.25, 1).translate(p.x, p.y - bulb * 1.35, p.z), { cast: false });
      if (halos) {
        _v.set(p.x, p.y - bulb * 1.35, p.z);
        if (transform) _v.applyMatrix4(transform);
        halos.push({ x: _v.x, y: _v.y, z: _v.z, size: 0.2 });
      }
    }
  }
}

// ─── paving ──────────────────────────────────────────────────────────────────
/** Irregular flagstones along a polyline of [x, z] points (world), with moss and grass between. */
export function flagstones(F, rng, pts, { width = 0.9, step = 0.5, y = 0 } = {}) {
  const M = mats();
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
  const len = curve.getLength();
  const n = Math.max(2, Math.round(len / step));
  const tint = ['#948a77', '#8a8172', '#9d917a', '#81796c', '#958870'];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const side = new THREE.Vector3(tan.z, 0, -tan.x);
    const k = rng.chance(0.55) ? 2 : 1;
    for (let j = 0; j < k; j++) {
      const off = k === 1 ? rng.jitter(0.12) : (j - 0.5) * width * 0.5 + rng.jitter(0.06);
      const sz = k === 1 ? rng.range(0.32, 0.42) : rng.range(0.2, 0.27);
      const st = stoneGeo(rng, { r: 1, sx: sz * rng.range(0.9, 1.25), sy: 0.05, sz: sz * rng.range(0.8, 1.05), lump: 0.15, flatTop: 0.3 });
      xf(st, [p.x + side.x * off, y + 0.015, p.z + side.z * off], [0, rng.next() * TAU, 0]);
      F.add(M.stone, st, { color: rng.pick(tint), cast: false });
    }
    if (rng.chance(0.5)) addGrass(F, rng, p.x + side.x * rng.jitter(width * 0.6), y, p.z + side.z * rng.jitter(width * 0.6), { size: 0.18, blades: 2 });
    if (rng.chance(0.35)) F.add(M.moss, xf(mossGeo(rng, { r: 0.12, h: 0.03 }), [p.x + side.x * rng.jitter(width * 0.5), y, p.z + side.z * rng.jitter(width * 0.5)]), { cast: false });
  }
}

// ─── vegetable bed ───────────────────────────────────────────────────────────
/** Raised vegetable bed (w × d) at a world frame m: cabbages, lettuces, carrots, a label. */
export function vegBed(F, rng, m, { w = 2.1, d = 1.05 } = {}) {
  const M = mats();
  const L = local(F, m);
  const bh = 0.32;
  // frame of two stacked boards each side + corner posts
  for (const y of [0.08, 0.23]) {
    for (const s of [-1, 1]) {
      L.add(M.wood, board(w + 0.06, 0.14, 0.04, { along: 'x', rng }).translate(0, y, (s * d) / 2), { color: WOOD.weathered });
      L.add(M.wood, board(0.04, 0.14, d, { along: 'z', rng }).translate((s * w) / 2, y, 0), { color: WOOD.weathered });
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.add(M.wood, board(0.07, bh + 0.08, 0.07, { along: 'y', rng }).translate((sx * w) / 2, (bh + 0.08) / 2 - 0.02, (sz * d) / 2), { color: WOOD.grey, cast: false });
  const soil = new THREE.BoxGeometry(w - 0.04, 0.06, d - 0.04, 6, 1, 3);
  deform(soil, (v) => {
    if (v.y > 0) v.y += noiseA(v.x * 4, v.z * 4) * 0.02 + Math.cos((v.z / d) * Math.PI * 3) * 0.015;
  });
  L.add(M.soil, uvBox(soil, 'x').translate(0, bh - 0.03, 0), { cast: false });
  // three rows: cabbages, lettuces, carrots
  const rows = [-d * 0.3, 0, d * 0.3];
  const cabC = ['#7a9f84', '#6b9277', '#86a98c'];
  for (let i = 0; i < 4; i++) cabbage(L, rng, -w / 2 + ((i + 0.5) / 4) * w, bh, rows[0] + rng.jitter(0.04), 0.15, rng.pick(cabC));
  for (let i = 0; i < 5; i++) lettuce(L, rng, -w / 2 + ((i + 0.5) / 5) * w, bh, rows[1] + rng.jitter(0.04), 0.12);
  for (let i = 0; i < 7; i++) {
    const x = -w / 2 + ((i + 0.5) / 7) * w;
    addFern(L, rng, x, bh, rows[2], { size: 0.22, fronds: 5 });
    L.add(M.vc, new THREE.ConeGeometry(0.025, 0.06, 6).rotateX(Math.PI).translate(x, bh + 0.02, rows[2]), { color: '#e07a2a', cast: false });
  }
  // a little label stake
  L.add(M.wood, board(0.025, 0.4, 0.025, { along: 'y' }).translate(w / 2 - 0.12, bh + 0.15, d / 2 - 0.08), { color: WOOD.spruce, cast: false });
  L.add(M.paper, new THREE.BoxGeometry(0.16, 0.1, 0.012).translate(w / 2 - 0.12, bh + 0.33, d / 2 - 0.07), { color: '#efe4cc', cast: false });
}

function cabbage(F, rng, x, y, z, s, color) {
  const M = mats();
  F.add(M.leafy, new THREE.SphereGeometry(s * 0.55, 9, 6).scale(1, 0.85, 1).translate(x, y + s * 0.4, z), { color: '#a9c79a', cast: false });
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.jitter(0.3);
    const lf = leafGeo(s * 1.15, 1.1, 0.6, 3);
    lf.rotateX(-0.9 + rng.jitter(0.25));
    lf.rotateY(a);
    F.add(M.leafy, lf.translate(x + Math.sin(a) * s * 0.18, y + 0.02, z + Math.cos(a) * s * 0.18), { color, cast: false });
  }
}

function lettuce(F, rng, x, y, z, s) {
  const M = mats();
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU * 1.6 + rng.jitter(0.3);
    const k = i / n;
    const lf = leafGeo(s * (1.1 - k * 0.4), 0.9, 0.5, 3);
    lf.rotateX(-1.1 + k * 0.7);
    lf.rotateY(a);
    F.add(M.leafy, lf.translate(x, y + 0.01, z), { color: k > 0.6 ? '#b6d36a' : '#8fbf4f', cast: false });
  }
}

/** A ribbed pumpkin with a curly stem. */
export function pumpkin(F, rng, x, y, z, s = 0.25, color = '#d9762a') {
  const M = mats();
  const g = new THREE.SphereGeometry(s, 18, 10);
  const ribs = 8 + rng.int(0, 2);
  deform(g, (v) => {
    const a = Math.atan2(v.x, v.z);
    const k = 1 + 0.07 * Math.cos(a * ribs);
    v.x *= k;
    v.z *= k;
    v.y *= 0.72;
    if (Math.abs(v.y) > s * 0.6) v.y *= 0.9;
  });
  paintFn(g, color, (px, py, pz, i, c) => {
    const a = Math.atan2(px, pz);
    c.multiplyScalar(0.9 + 0.12 * Math.cos(a * ribs));
  });
  F.add(M.vc, xf(g, [x, y + s * 0.68, z], [rng.jitter(0.15), rng.next() * TAU, rng.jitter(0.15)]), { color: null, cast: true });
  F.add(M.wood, taperTube([[x, y + s * 1.3, z], [x + 0.02, y + s * 1.55, z], [x + 0.07, y + s * 1.62, z + 0.02]], 0.03, 0.018, 5, 6), { color: '#5d5a32', cast: false });
}

// ─── furniture ───────────────────────────────────────────────────────────────
/**
 * A joiner-made garden bench (mortise & tenon frame, slatted seat and back),
 * at frame m (front faces +Z). Returns the local seat point.
 */
export function gardenBench(F, rng, m, { w = 1.35, wood = WOOD.oak } = {}) {
  const M = mats();
  const L = local(F, m);
  const seatY = 0.45, d = 0.46;
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - 0.06);
    // legs, front & back (back legs rise into the backrest, slightly raked)
    L.add(M.wood, board(0.07, seatY, 0.07, { along: 'y', rng }).translate(x, seatY / 2, d / 2 - 0.05), { color: wood });
    L.add(M.wood, boardBetween([x, 0, -d / 2 + 0.05], [x, 0.95, -d / 2 - 0.05], 0.07, 0.07, { rng, up: [0, 0, 1] }), { color: wood });
    // side rail & armrest with visible tenon ends (pegs)
    L.add(M.wood, board(0.05, 0.08, d, { along: 'z', rng }).translate(x, seatY - 0.07, 0), { color: wood });
    L.add(M.wood, board(0.09, 0.04, d + 0.1, { along: 'z', rng }).translate(x, 0.68, 0.02), { color: wood });
    L.add(M.wood, board(0.05, 0.22, 0.05, { along: 'y' }).translate(x, 0.57, d / 2 - 0.05), { color: wood, cast: false });
    L.add(M.wood, new THREE.CylinderGeometry(0.012, 0.012, 0.075, 6).rotateZ(Math.PI / 2).translate(x, seatY - 0.07, d / 2 - 0.05), { color: WOOD.dark, cast: false });
  }
  for (let i = 0; i < 4; i++) L.add(M.wood, board(w, 0.035, 0.1, { along: 'x', rng }).translate(0, seatY, -d / 2 + 0.07 + i * 0.115), { color: wood });
  for (const y of [0.65, 0.82]) L.add(M.wood, board(w - 0.1, 0.09, 0.03, { along: 'x', rng }).translate(0, y, -d / 2 - 0.02 - (y - 0.45) * 0.1), { color: wood });
  L.add(M.wood, board(w - 0.14, 0.06, 0.04, { along: 'x', rng }).translate(0, 0.12, 0), { color: wood, cast: false });
  return new THREE.Vector3(0, seatY + 0.02, 0.02);
}

/** A neat woodpile under a little shingled lean-to, at frame m. */
export function woodpile(F, rng, m, { w = 1.5, h = 1.0, d = 0.55 } = {}) {
  const M = mats();
  const L = local(F, m);
  const r = 0.075;
  const rows = Math.floor(h / (r * 1.75));
  for (let row = 0; row < rows; row++) {
    const y = r + row * r * 1.72;
    const n = Math.floor(w / (r * 2.05));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + r + i * r * 2.05 + (row % 2) * r;
      if (x > w / 2 - r) continue;
      const rr = r * rng.range(0.8, 1.1);
      const log = new THREE.CylinderGeometry(rr, rr, d * rng.range(0.92, 1.05), 7, 1);
      log.rotateX(Math.PI / 2);
      log.translate(x, y, rng.jitter(0.03));
      L.add(M.wood, uvBox(log, 'z', 1.2, [rng.next() * 5, 0]), { color: rng.pick(['#b08d64', '#c29e72', '#9c7a55']), cast: row === rows - 1 });
      // end grain disc (lighter)
      L.add(M.wood, new THREE.CircleGeometry(rr * 0.92, 7).translate(x, y, d / 2 + 0.005), { color: '#d9bf92', cast: false });
    }
  }
  // posts and a mossy shingle roof
  for (const s of [-1, 1]) L.add(M.wood, board(0.07, h + 0.35, 0.07, { along: 'y', rng }).translate(s * (w / 2 + 0.05), (h + 0.35) / 2, d / 2 + 0.02), { color: WOOD.grey });
  for (const s of [-1, 1]) L.add(M.wood, board(0.07, h + 0.15, 0.07, { along: 'y', rng }).translate(s * (w / 2 + 0.05), (h + 0.15) / 2, -d / 2), { color: WOOD.grey });
  const roofM = new THREE.Matrix4().makeRotationX(0.32).setPosition(0, h + 0.3, 0.02);
  const R = local(L, roofM);
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 10; i++) {
      const sw = (w + 0.4) / 10;
      const sh = board(sw * 0.96, 0.02, 0.32, { along: 'z', rng });
      sh.rotateX(-0.08);
      R.add(M.wood, sh.translate(-w / 2 - 0.2 + sw * (i + 0.5) + (row % 2) * sw * 0.4, 0.03 + row * 0.012, d / 2 + 0.1 - row * 0.2), { color: rng.pick(['#6e5a48', '#7d6650', '#5f4e3e']), cast: row === 0 });
    }
  }
  R.add(M.moss, mossGeo(rng, { r: 0.3, h: 0.05, sx: 1.6 }).translate(0.2, 0.06, -0.15), { cast: false });
}

// ─── hotspot pieces (own meshes) ─────────────────────────────────────────────
/** Invisible but raycastable proxy material for hotspots on merged geometry. */
export const PROXY_MAT = new THREE.MeshBasicMaterial({ visible: false });

/** A hit proxy box (invisible, clickable) centred at (x, y, z). */
export function hitProxy(w, h, d, name = 'hotspot') {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), PROXY_MAT);
  m.name = name;
  return m;
}

/**
 * The carved "Jonny's Woodland" sign: a turned post with an ornate scrolled
 * frame around a painted parchment board (like the "Fairy Garden" sign).
 * Front faces +Z. Returns a Group.
 */
export function makeWoodlandSign(rng, { text = "Jonny's\nWoodland", F = null } = {}) {
  const M = mats();
  const own = !F;
  const B = F ?? new Batch();
  const g = new THREE.Group();
  g.name = 'woodland-sign';
  const bw = 1.45, bh = 0.72, by = 1.75;
  // turned post (lathe profile)
  const prof = [
    [0.0, 0], [0.1, 0], [0.11, 0.08], [0.085, 0.14], [0.07, 0.3], [0.075, 0.9], [0.09, 0.97], [0.065, 1.03], [0.07, 1.2], [0.09, 1.26], [0.075, 1.32],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const post = new THREE.LatheGeometry(prof, 10);
  uvBox(post, 'y');
  B.add(M.wood, post, { color: WOOD.walnut });
  // brass collar & a carved capital under the board
  B.add(M.metal, new THREE.CylinderGeometry(0.095, 0.095, 0.05, 10).translate(0, 1.0, 0), { color: '#a8813f', cast: false });
  // scrolled brackets holding the board
  const gold = '#b38b45';
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const a = t * Math.PI * 2.2;
      const r = 0.2 * (1 - t * 0.75);
      pts.push([s * (0.05 + t * 0.32 + Math.sin(a) * r * 0.4), 1.25 + t * 0.12 - Math.cos(a) * r * 0.25 + 0.05, 0.02]);
    }
    B.add(M.metal, tube(pts, 0.016, 5, 40), { color: gold, cast: false });
  }
  // the board (painted parchment, own textured material)
  const tex = signTexture(text);
  const boardMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, name: 'sign-board' });
  const panel = roundedPanel(bw, bh, 0.12, 0.05);
  paint(panel, WOOD.walnut);
  const face = new THREE.Mesh(panel, [boardMat, M.wood]);
  face.position.set(0, by, 0);
  face.castShadow = true;
  face.receiveShadow = true;
  g.add(face);
  // ornate frame: a rope-like moulding around the board + corner scrolls + crest
  const outline = roundedRectShape(bw + 0.05, bh + 0.05, 0.14).getSpacedPoints(64).slice(0, -1).map((p) => [p.x, by + p.y, 0.035]);
  B.add(M.metal, tube(outline, 0.028, 6, 128, true), { color: gold, cast: true });
  const scroll = (cx, cy, sx, sy, size) => {
    const pts = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const a = t * Math.PI * 2.4;
      const r = size * (1 - t * 0.8);
      pts.push([cx + sx * (Math.cos(a) * r), cy + sy * (Math.sin(a) * r), 0.04]);
    }
    B.add(M.metal, tube(pts, 0.017, 5, 36), { color: gold, cast: false });
  };
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) scroll(sx * (bw / 2 + 0.06), by + sy * (bh / 2 + 0.04), sx, sy, 0.11);
    scroll(sx * 0.2, by + bh / 2 + 0.1, sx, 1, 0.09);
  }
  // crest: a little leaf & acorn on top
  B.add(M.metal, new THREE.SphereGeometry(0.06, 8, 6).scale(1, 1.25, 1).translate(0, by + bh / 2 + 0.2, 0.03), { color: gold, cast: false });
  B.add(M.metal, new THREE.SphereGeometry(0.065, 8, 4, 0, TAU, 0, Math.PI / 2).translate(0, by + bh / 2 + 0.25, 0.03), { color: '#7d5a2c', cast: false });
  // flowers & a fern at its foot
  const FF = { add: (mat, geo, opts) => B.add(mat, geo, opts) };
  for (let i = 0; i < 9; i++) {
    const a = rng.next() * TAU, r = rng.range(0.15, 0.45);
    addFlower(FF, rng, Math.sin(a) * r, 0, Math.cos(a) * r, { size: rng.range(0.05, 0.075), stem: rng.range(0.15, 0.35), color: rng.pick(['#f29bb8', '#b48fd6', '#f4f0e6', '#7fa7e0']) });
  }
  addFern(FF, rng, -0.25, 0, -0.15, { size: 0.55, fronds: 7 });
  addGrass(FF, rng, 0.2, 0, 0.1, { size: 0.35, blades: 4 });
  addToadstool(FF, rng, 0.32, 0, 0.22, { size: 0.12 });
  addToadstool(FF, rng, 0.42, 0, 0.12, { size: 0.08 });
  if (own) B.build(g, 'sign');
  return g;
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

/** A rounded-rectangle panel (front face material 0 with 0..1 UVs, edges & back material 1). */
function roundedPanel(w, h, r, depth) {
  const s = roundedRectShape(w, h, r);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  // front cap faces → material 0 with 0..1 UVs, everything else → material 1
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    if (nor.getZ(i) > 0.9) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    else uv.setXY(i, pos.getX(i) * 0.7, pos.getY(i) * 0.7 + pos.getZ(i));
  }
  g.clearGroups();
  const idx = g.index ? g.index.array : null;
  const count = idx ? idx.length : pos.count;
  // rebuild groups per triangle facing
  const order = [];
  const tri = (k) => (idx ? idx[k] : k);
  const front = [], rest = [];
  for (let k = 0; k < count; k += 3) {
    const a = tri(k);
    (nor.getZ(a) > 0.9 && nor.getZ(tri(k + 1)) > 0.9 && nor.getZ(tri(k + 2)) > 0.9 ? front : rest).push(tri(k), tri(k + 1), tri(k + 2));
  }
  order.push(...front, ...rest);
  g.setIndex(order);
  g.addGroup(0, front.length, 0);
  g.addGroup(front.length, rest.length, 1);
  return g;
}

/** Painted parchment with the cottage's name in a storybook serif. */
function signTexture(text) {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  // parchment: warm cream with mottling and a darker vignette
  const grd = g.createRadialGradient(W / 2, H / 2, H * 0.15, W / 2, H / 2, W * 0.62);
  grd.addColorStop(0, '#f3e5c2');
  grd.addColorStop(0.7, '#e2cc9a');
  grd.addColorStop(1, '#b8955e');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * W, y = Math.random() * H, r = 6 + Math.random() * 40;
    g.fillStyle = `rgba(${150 + Math.random() * 60},${110 + Math.random() * 50},${60 + Math.random() * 30},${0.03 + Math.random() * 0.05})`;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }
  // a fine painted border
  g.strokeStyle = 'rgba(92,58,30,0.75)';
  g.lineWidth = 6;
  g.strokeRect(34, 34, W - 68, H - 68);
  g.lineWidth = 2;
  g.strokeRect(50, 50, W - 100, H - 100);
  // leafy flourishes in the corners
  g.strokeStyle = 'rgba(70,96,44,0.85)';
  g.fillStyle = 'rgba(86,120,52,0.85)';
  g.lineWidth = 4;
  for (const [x, y, sx, sy] of [[70, 70, 1, 1], [W - 70, 70, -1, 1], [70, H - 70, 1, -1], [W - 70, H - 70, -1, -1]]) {
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + sx * 60, y + sy * 10, x + sx * 90, y + sy * 40, x + sx * 120, y + sy * 20);
    g.stroke();
    for (let k = 0; k < 3; k++) {
      const lx = x + sx * (35 + k * 32), ly = y + sy * (12 + k * 6);
      g.beginPath();
      g.ellipse(lx, ly - sy * 12, 16, 7, sx * sy * -0.6, 0, TAU);
      g.fill();
    }
  }
  // the lettering
  const lines = text.split('\n');
  const font = '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, "Liberation Serif", "DejaVu Serif", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const sizes = lines.length > 1 ? [132, 150] : [170];
  lines.forEach((ln, i) => {
    const y = lines.length > 1 ? H * (0.34 + i * 0.36) : H / 2;
    g.font = `italic bold ${sizes[i] ?? 140}px ${font}`;
    let fs = sizes[i] ?? 140;
    while (g.measureText(ln).width > W - 170 && fs > 40) {
      fs -= 6;
      g.font = `italic bold ${fs}px ${font}`;
    }
    g.fillStyle = 'rgba(255,240,205,0.55)';
    g.fillText(ln, W / 2 + 3, y + 4);
    g.fillStyle = '#4a2c17';
    g.fillText(ln, W / 2, y);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Jonny's mailbox: a little wooden letterbox with a mushroom-cap roof on a
 * carved post, its red flag up (there's mail to send!). Front faces +Z.
 */
export function makeMailbox(rng) {
  const M = mats();
  const B = new Batch();
  const g = new THREE.Group();
  g.name = 'mailbox';
  B.add(M.wood, board(0.1, 1.05, 0.1, { along: 'y', rng }).translate(0, 0.5, 0), { color: WOOD.walnut });
  B.add(M.wood, boardBetween([0, 0.78, -0.02], [0, 1.0, 0.16], 0.05, 0.05), { color: WOOD.walnut, cast: false });
  const bw = 0.36, bh = 0.3, bd = 0.46, y0 = 1.02;
  // box of boards
  B.add(M.wood, board(bw, 0.03, bd, { along: 'z', rng }).translate(0, y0, 0.02), { color: WOOD.oak });
  for (const s of [-1, 1]) B.add(M.wood, board(0.03, bh, bd, { along: 'z', rng }).translate((s * bw) / 2, y0 + bh / 2, 0.02), { color: WOOD.oak });
  B.add(M.wood, board(bw, bh, 0.03, { along: 'x', rng }).translate(0, y0 + bh / 2, -bd / 2 + 0.02), { color: WOOD.oak });
  // front door (painted teal) with a brass slot & a little heart cut-out
  B.add(M.wood, board(bw - 0.02, bh - 0.02, 0.03, { along: 'y', rng }).translate(0, y0 + bh / 2, bd / 2 + 0.02), { color: '#3f7a78' });
  B.add(M.wood, new THREE.BoxGeometry(0.17, 0.03, 0.012).translate(0, y0 + bh * 0.7, bd / 2 + 0.04), { color: '#b38b45', cast: false });
  B.add(M.wood, new THREE.SphereGeometry(0.018, 6, 4).translate(0.12, y0 + bh * 0.4, bd / 2 + 0.045), { color: '#b38b45', cast: false });
  // mushroom-cap roof (red, with warts) overhanging the box
  const cap = new THREE.SphereGeometry(0.36, 16, 8, 0, TAU, 0, Math.PI / 2);
  cap.scale(1, 0.55, 1.22);
  const cu = cap.attributes.uv;
  for (let i = 0; i < cu.count; i++) cu.setXY(i, cu.getX(i) * 2, 1 - cu.getY(i));
  B.add(M.cap, cap.translate(0, y0 + bh - 0.01, 0.02), { color: '#c4301f' });
  B.add(M.wood, new THREE.CircleGeometry(0.355, 16).scale(1, 1.22, 1).rotateX(Math.PI / 2).translate(0, y0 + bh - 0.005, 0.02), { color: '#e2c597', cast: false });
  for (let i = 0; i < 9; i++) {
    const a = rng.next() * TAU, el = rng.range(0.35, 1.25);
    const sp = new THREE.SphereGeometry(0.028, 5, 3).scale(1, 0.45, 1);
    const n = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el) * 0.55, Math.sin(a) * Math.cos(el) * 1.22);
    sp.lookAt(n);
    sp.translate(Math.cos(a) * Math.cos(el) * 0.36, y0 + bh + Math.sin(el) * 0.36 * 0.55, 0.02 + Math.sin(a) * Math.cos(el) * 0.36 * 1.22);
    B.add(M.wood, sp, { color: '#fff4e0', cast: false });
  }
  // the red flag, raised, on a pivot at the side
  const fx = bw / 2 + 0.03;
  B.add(M.wood, new THREE.CylinderGeometry(0.025, 0.025, 0.02, 8).rotateZ(Math.PI / 2).translate(fx, y0 + 0.1, 0.05), { color: IRON, cast: false });
  B.add(M.wood, new THREE.BoxGeometry(0.015, 0.34, 0.02).translate(fx + 0.01, y0 + 0.26, 0.05), { color: IRON, cast: false });
  B.add(M.wood, new THREE.BoxGeometry(0.012, 0.11, 0.15).translate(fx + 0.012, y0 + 0.38, 0.12), { color: '#d52b1e', cast: false });
  // a letter peeking out of the slot
  B.add(M.wood, xf(new THREE.BoxGeometry(0.13, 0.09, 0.004), [0, y0 + bh * 0.72, bd / 2 + 0.055], [-0.35, 0, 0.05]), { color: '#f7efdf', cast: false });
  B.build(g, 'mailbox', { mergeShadow: true });
  return g;
}

/**
 * A ginger tabby cat curled up asleep (nose tucked under the tail). Returns
 * { group, update(t) } — it breathes slowly and flicks an ear now and then.
 */
export function makeCat(rng, { color = '#e0913f', stripe = '#a85e24' } = {}) {
  const M = mats();
  const B = new Batch();
  const g = new THREE.Group();
  g.name = 'cat';
  const body = new THREE.Group();
  g.add(body);
  const c0 = new THREE.Color(color), c1 = new THREE.Color(stripe), cw = new THREE.Color('#f6ead6');
  /** Tabby fur: stripes running round the body from a centre, white underneath. */
  const fur = (geo, cx = 0, cz = 0, bellyY = -1) =>
    paintFn(geo, color, (x, y, z, i, c) => {
      const a = Math.atan2(x - cx, z - cz);
      const st = Math.sin(a * 7 + y * 18) > 0.45 ? 1 : 0;
      c.copy(c0).lerp(c1, st * 0.75);
      if (y < bellyY) c.lerp(cw, 0.75);
    });
  // the curled body: a soft bun
  const bun = new THREE.SphereGeometry(0.2, 18, 12).scale(1.05, 0.58, 0.85);
  B.add(M.fabric, fur(bun.translate(0, 0.11, 0), 0, 0, 0.035), { color: null });
  // tail wrapped round the front
  const tail = [];
  for (let i = 0; i <= 12; i++) {
    const a = -2.4 + (i / 12) * 3.5;
    tail.push([Math.sin(a) * 0.215, 0.045 + Math.sin((i / 12) * Math.PI) * 0.025, Math.cos(a) * 0.185]);
  }
  const tg = taperTube(tail, 0.05, 0.034, 8, 24);
  paintFn(tg, color, (x, y, z, i, c) => {
    c.copy(c0).lerp(c1, Math.sin(Math.atan2(x, z) * 10) > 0.3 ? 0.75 : 0);
  });
  B.add(M.fabric, tg, { color: null });
  B.add(M.fabric, new THREE.SphereGeometry(0.036, 8, 6).translate(...tail[12]), { color: '#f6ead6' });
  // front paws tucked under the chin
  for (const s of [-1, 1]) B.add(M.fabric, new THREE.SphereGeometry(0.035, 8, 6).scale(1.2, 0.7, 1.4).translate(-0.05 + s * 0.045, 0.035, 0.2), { color: '#f6ead6' });
  // head resting on the paws, chin down, eyes shut
  const hp = new THREE.Vector3(-0.05, 0.15, 0.17);
  const head = new THREE.SphereGeometry(0.1, 16, 12).scale(1.15, 0.92, 1.0);
  B.add(M.fabric, fur(head.translate(hp.x, hp.y, hp.z), hp.x, hp.z - 0.2), { color: null });
  B.add(M.fabric, new THREE.SphereGeometry(0.048, 10, 8).scale(1.2, 0.75, 0.8).translate(hp.x, hp.y - 0.03, hp.z + 0.075), { color: '#f6ead6' });
  B.add(M.fabric, new THREE.SphereGeometry(0.013, 6, 4).scale(1.3, 0.8, 1).translate(hp.x, hp.y - 0.008, hp.z + 0.112), { color: '#d9827a' });
  for (const s of [-1, 1]) {
    // closed eyes: little dark smiles
    B.add(M.fabric, xf(new THREE.TorusGeometry(0.022, 0.005, 3, 8, Math.PI), [hp.x + s * 0.045, hp.y + 0.018, hp.z + 0.088], [0, s * 0.4, Math.PI]), { color: '#2b1d14' });
    // ears with pink insides
    const ear = new THREE.ConeGeometry(0.045, 0.085, 4).translate(0, 0.04, 0);
    B.add(M.fabric, xf(ear, [hp.x + s * 0.06, hp.y + 0.07, hp.z - 0.01], [-0.15, s * 0.3, -s * 0.4]), { color: stripe });
    const inner = new THREE.ConeGeometry(0.026, 0.05, 4).translate(0, 0.03, 0.012);
    B.add(M.fabric, xf(inner, [hp.x + s * 0.06, hp.y + 0.07, hp.z - 0.005], [-0.15, s * 0.3, -s * 0.4]), { color: '#f0a8a0' });
    // whiskers
    for (const k of [-1, 1]) B.add(M.fabric, rod([hp.x + s * 0.03, hp.y - 0.025, hp.z + 0.1], [hp.x + s * 0.13, hp.y - 0.02 + k * 0.02, hp.z + 0.08], 0.002, 0.0015, 3), { color: '#f8f2e6' });
  }
  B.build(body, 'cat', { mergeShadow: true });
  body.children.forEach((m) => (m.matrixAutoUpdate = true));
  const ph = rng.next() * 10;
  return {
    group: g,
    update(t) {
      const b = Math.sin(t * 1.4 + ph) * 0.5 + 0.5;
      body.scale.set(1 + b * 0.02, 1 + b * 0.045, 1 + b * 0.015);
    },
  };
}

function paint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// ─── little extras ───────────────────────────────────────────────────────────
/** A galvanised watering can (local, base at y = 0, spout towards +X). */
export function wateringCan(F, m, color = '#7d8c86') {
  const M = mats();
  const L = local(F, m);
  L.add(M.metal, new THREE.CylinderGeometry(0.12, 0.14, 0.26, 12).translate(0, 0.13, 0), { color });
  L.add(M.metal, new THREE.CylinderGeometry(0.125, 0.125, 0.02, 12).translate(0, 0.25, 0), { color: '#5d6a66', cast: false });
  L.add(M.metal, taperTube([[0.1, 0.06, 0], [0.22, 0.2, 0], [0.33, 0.33, 0]], 0.03, 0.018, 6, 8), { color, cast: false });
  L.add(M.metal, new THREE.CylinderGeometry(0.04, 0.02, 0.05, 8).rotateZ(-0.9).translate(0.35, 0.35, 0), { color: '#5d6a66', cast: false });
  L.add(M.metal, tube([[-0.12, 0.2, 0], [-0.12, 0.38, 0], [0.04, 0.38, 0], [0.06, 0.26, 0]], 0.014, 4, 12), { color, cast: false });
}

/** A terracotta pot (optionally with a plant). */
export function pot(F, rng, x, y, z, s = 0.18, plant = true) {
  const M = mats();
  const prof = [[0.0, 0], [0.62, 0], [0.7, 0.05], [0.82, 0.78], [0.9, 0.8], [0.92, 0.95], [0.84, 1.0], [0.8, 0.93]].map(([r, h]) => new THREE.Vector2(r * s, h * s * 1.15));
  const g = new THREE.LatheGeometry(prof, 12);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i));
  F.add(M.clay, g.translate(x, y, z), { color: rng.pick(['#b5633e', '#a85a38', '#c0704a']), cast: false });
  F.add(M.soil, new THREE.CircleGeometry(s * 0.78, 10).rotateX(-Math.PI / 2).translate(x, y + s * 1.03, z), { cast: false });
  if (plant) {
    if (rng.chance(0.5)) addFern(F, rng, x, y + s * 1.05, z, { size: s * 2.2, fronds: 6 });
    else for (let i = 0; i < 4; i++) addFlower(F, rng, x + rng.jitter(s * 0.4), y + s * 1.05, z + rng.jitter(s * 0.4), { size: 0.05, stem: s * 1.4 });
  }
}

/**
 * A clothesline between two T-posts (world XZ a → b) with laundry drying:
 * a shirt, socks, a striped towel and a pair of trousers, held by pegs.
 */
export function clothesline(F, rng, a, b) {
  const M = mats();
  const h = 1.85;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const yaw = Math.atan2(dx, dz);
  for (const p of [a, b]) {
    const m = mat4([p[0], 0, p[1]], [0, yaw, 0]);
    const L = local(F, m);
    L.add(M.wood, board(0.08, h, 0.08, { along: 'y', rng }).translate(0, h / 2, 0), { color: WOOD.grey });
    L.add(M.wood, board(0.7, 0.06, 0.06, { along: 'x', rng }).translate(0, h - 0.1, 0), { color: WOOD.grey });
  }
  const span = Math.hypot(dx, dz);
  const right = [Math.cos(yaw), -Math.sin(yaw)];
  const lines = [];
  for (const off of [-0.28, 0.28]) {
    const pa = new THREE.Vector3(a[0] + right[0] * off, h - 0.07, a[1] + right[1] * off);
    const pb = new THREE.Vector3(b[0] + right[0] * off, h - 0.07, b[1] + right[1] * off);
    const c = sagCurve(pa, pb, span * 0.04, 16);
    F.add(M.vc, new THREE.TubeGeometry(c, 24, 0.006, 3, false), { color: '#d8cfbd', cast: false });
    lines.push(c);
  }
  // laundry on the first line
  const c = lines[0];
  const items = [
    { t: 0.16, kind: 'shirt', color: '#e8e2d4' },
    { t: 0.36, kind: 'sock', color: '#c46a43' },
    { t: 0.42, kind: 'sock', color: '#c46a43' },
    { t: 0.6, kind: 'towel', color: '#6f8a99' },
    { t: 0.83, kind: 'trousers', color: '#3b4a5c' },
  ];
  for (const it of items) {
    const p = c.getPointAt(it.t);
    const m = mat4([p.x, p.y, p.z], [0, yaw - Math.PI / 2, 0]);
    const L = local(F, m);
    let g;
    if (it.kind === 'shirt') {
      const sh = new THREE.Shape();
      sh.moveTo(-0.22, 0);
      sh.lineTo(0.22, 0);
      sh.lineTo(0.36, -0.12);
      sh.lineTo(0.3, -0.2);
      sh.lineTo(0.2, -0.13);
      sh.lineTo(0.2, -0.55);
      sh.lineTo(-0.2, -0.55);
      sh.lineTo(-0.2, -0.13);
      sh.lineTo(-0.3, -0.2);
      sh.lineTo(-0.36, -0.12);
      sh.lineTo(-0.22, 0);
      g = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false });
    } else if (it.kind === 'sock') {
      const sh = new THREE.Shape();
      sh.moveTo(-0.04, 0);
      sh.lineTo(0.04, 0);
      sh.lineTo(0.04, -0.2);
      sh.lineTo(0.12, -0.24);
      sh.lineTo(0.1, -0.3);
      sh.lineTo(-0.04, -0.27);
      sh.lineTo(-0.04, 0);
      g = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false });
    } else if (it.kind === 'towel') {
      g = new THREE.BoxGeometry(0.5, 0.42, 0.02, 6, 4, 1).translate(0, -0.21, 0);
      paintFn(g, it.color, (x, y, z, i, col) => {
        if (Math.abs(y + 0.36) < 0.025 || Math.abs(y + 0.06) < 0.025) col.set('#efe4cf');
      });
    } else {
      const sh = new THREE.Shape();
      sh.moveTo(-0.17, 0);
      sh.lineTo(0.17, 0);
      sh.lineTo(0.19, -0.62);
      sh.lineTo(0.05, -0.62);
      sh.lineTo(0, -0.18);
      sh.lineTo(-0.05, -0.62);
      sh.lineTo(-0.19, -0.62);
      sh.lineTo(-0.17, 0);
      g = new THREE.ExtrudeGeometry(sh, { depth: 0.025, bevelEnabled: false });
    }
    // a breeze: the cloth billows a little
    const ph = rng.next() * 6;
    deform(g, (v) => {
      v.z += Math.sin(v.x * 7 + ph) * 0.025 * -v.y + (-v.y) * 0.08;
    });
    uvBox(g, 'x', 3);
    L.add(M.fabric, g, { color: it.kind === 'towel' ? null : it.color, cast: true });
    // pegs
    for (const px of it.kind === 'sock' ? [0] : [-0.15, 0.15]) L.add(M.wood, new THREE.BoxGeometry(0.018, 0.07, 0.025).translate(px, -0.01, 0.01), { color: WOOD.spruce, cast: false });
  }
}

/** A coopered rain barrel (bulged staves, iron hoops) brimming with water. */
export function rainBarrel(F, rng, x, z, { r = 0.32, h = 0.85 } = {}) {
  const M = mats();
  const prof = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    prof.push(new THREE.Vector2(r * (0.86 + 0.14 * Math.sin(t * Math.PI)), t * h));
  }
  const g = new THREE.LatheGeometry(prof, 24);
  const staves = 14;
  paintFn(g, WOOD.oak, (px, py, pz, i, c) => {
    const a = Math.atan2(px, pz);
    const k = ((a / TAU) * staves + 100) % 1;
    c.multiplyScalar(k < 0.08 ? 0.55 : 0.92 + 0.1 * Math.sin(Math.floor((a / TAU) * staves) * 7.3));
  });
  uvBox(g, 'y', 1.2);
  F.add(M.wood, g.translate(x, 0, z), { color: null });
  for (const t of [0.12, 0.5, 0.88]) {
    const rr = r * (0.86 + 0.14 * Math.sin(t * Math.PI)) + 0.01;
    F.add(M.metal, new THREE.TorusGeometry(rr, 0.015, 4, 24).rotateX(Math.PI / 2).translate(x, t * h, z), { color: IRON, cast: false });
  }
  F.add(M.vc, new THREE.CircleGeometry(r * 0.84, 20).rotateX(-Math.PI / 2).translate(x, h - 0.04, z), { color: '#2a4446', cast: false });
  F.add(M.moss, mossGeo(rng, { r: r * 0.9, h: 0.05 }).translate(x, 0, z), { cast: false });
}

/** A bird house on a post, with a robin on the roof. */
export function birdHouse(F, rng, m) {
  const M = mats();
  const L = local(F, m);
  const ph = 1.55;
  L.add(M.wood, board(0.07, ph, 0.07, { along: 'y', rng }).translate(0, ph / 2, 0), { color: WOOD.grey });
  const w = 0.24, h = 0.26, d = 0.22;
  L.add(M.wood, board(w, h, d, { along: 'y', rng }).translate(0, ph + h / 2, 0), { color: '#7a9a8c' });
  for (const s of [-1, 1]) {
    const roof = board(w * 0.78, 0.022, d + 0.08, { along: 'z', rng });
    roof.rotateZ(s * 0.75);
    L.add(M.wood, roof.translate(s * w * 0.27, ph + h + 0.07, 0), { color: '#9b3b2c' });
  }
  // gable fill
  const gab = new THREE.Shape();
  gab.moveTo(-w / 2, 0);
  gab.lineTo(w / 2, 0);
  gab.lineTo(0, w * 0.48);
  gab.lineTo(-w / 2, 0);
  for (const s of [-1, 1]) L.add(M.wood, new THREE.ShapeGeometry(gab).translate(0, ph + h, s * (d / 2 + 0.002)).rotateY(s < 0 ? Math.PI : 0), { color: '#7a9a8c', cast: false });
  L.add(M.vc, new THREE.CircleGeometry(0.035, 10).translate(0, ph + h * 0.6, d / 2 + 0.004), { color: '#1a120c', cast: false });
  L.add(M.wood, rod([0, ph + h * 0.35, d / 2], [0, ph + h * 0.35, d / 2 + 0.06], 0.007, 0.007, 4), { color: WOOD.dark, cast: false });
  // the robin
  const by = ph + h + 0.17;
  L.add(M.fabric, new THREE.SphereGeometry(0.045, 8, 6).scale(1, 0.9, 1.25).translate(0, by, 0.02), { color: '#7a5a3a' });
  L.add(M.fabric, new THREE.SphereGeometry(0.03, 8, 6).translate(0, by + 0.005, 0.05), { color: '#e0742e' });
  L.add(M.fabric, new THREE.SphereGeometry(0.03, 8, 6).translate(0, by + 0.045, 0.06), { color: '#7a5a3a' });
  L.add(M.vc, new THREE.ConeGeometry(0.008, 0.025, 4).rotateX(Math.PI / 2).translate(0, by + 0.045, 0.095), { color: '#3a2a1a', cast: false });
  L.add(M.fabric, new THREE.BoxGeometry(0.04, 0.012, 0.07).rotateX(0.5).translate(0, by + 0.01, -0.06), { color: '#5d4630', cast: false });
}

/** A little green frog sitting at (x, y, z) facing yaw. */
export function frog(F, rng, x, y, z, yaw = 0, s = 1) {
  const M = mats();
  const m = mat4([x, y, z], [0, yaw, 0], s);
  const L = local(F, m);
  const g = '#5f8f3a', belly = '#c9d98a';
  L.add(M.fabric, new THREE.SphereGeometry(0.06, 10, 8).scale(1, 0.62, 1.25).translate(0, 0.035, 0), { color: g, cast: false });
  L.add(M.fabric, new THREE.SphereGeometry(0.045, 10, 8).scale(1.2, 0.7, 0.9).translate(0, 0.06, 0.055), { color: g, cast: false });
  L.add(M.fabric, new THREE.SphereGeometry(0.04, 8, 6).scale(1.1, 0.4, 1).translate(0, 0.02, 0.03), { color: belly, cast: false });
  for (const sd of [-1, 1]) {
    L.add(M.fabric, new THREE.SphereGeometry(0.018, 8, 6).translate(sd * 0.03, 0.09, 0.06), { color: g, cast: false });
    L.add(M.vc, new THREE.SphereGeometry(0.011, 6, 4).translate(sd * 0.033, 0.095, 0.072), { color: '#1a1410', cast: false });
    L.add(M.fabric, new THREE.SphereGeometry(0.03, 6, 4).scale(0.8, 0.5, 1.6).translate(sd * 0.05, 0.015, -0.03), { color: g, cast: false });
    L.add(M.fabric, new THREE.SphereGeometry(0.014, 6, 4).scale(1.4, 0.5, 1).translate(sd * 0.04, 0.008, 0.075), { color: g, cast: false });
  }
}

/** A hedgehog curled up asleep in the leaves. */
export function hedgehog(F, rng, x, y, z, yaw = 0) {
  const M = mats();
  const m = mat4([x, y, z], [0, yaw, 0]);
  const L = local(F, m);
  const body = new THREE.SphereGeometry(0.13, 14, 10).scale(1, 0.72, 1.2);
  L.add(M.fabric, body.translate(0, 0.08, 0), { color: '#6b5440', cast: true });
  // spines: little cones over the back
  for (let i = 0; i < 70; i++) {
    const a = rng.next() * TAU, el = rng.range(0.15, 1.4);
    const n = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el) * 0.72, Math.sin(a) * Math.cos(el) * 1.2);
    if (n.z > 0.85) continue;
    const c = new THREE.ConeGeometry(0.012, 0.07, 3).translate(0, 0.035, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().normalize()));
    L.add(M.fabric, c.translate(n.x * 0.12, 0.08 + n.y * 0.12, n.z * 0.12), { color: rng.pick(['#4a3a2c', '#8a7258', '#3a2e24']), cast: false });
  }
  L.add(M.fabric, new THREE.SphereGeometry(0.06, 10, 8).scale(1, 0.85, 1.2).translate(0, 0.05, 0.14), { color: '#c9a77e', cast: false });
  L.add(M.vc, new THREE.SphereGeometry(0.014, 6, 4).translate(0, 0.055, 0.215), { color: '#1a1410', cast: false });
  for (const sd of [-1, 1]) L.add(M.vc, xf(new THREE.TorusGeometry(0.012, 0.003, 3, 6, Math.PI), [sd * 0.03, 0.075, 0.18], [0, sd * 0.5, Math.PI]), { color: '#1a1410', cast: false });
}

export { FLOWER_COLORS, rod, blockStone };
