// ─────────────────────────────────────────────────────────────────────────────
// The stream's banks and the lily pond.
//
//   planStreamRocks(rng)          boulders standing in the stream (the water
//                                 bakes their wakes into its mask)
//   buildBanks(ctx, B, rng, rocks) river-worn boulders with a dark wet band,
//                                 bank stones breaking the shoreline, pebbles
//                                 glinting through the shallows, reed &
//                                 cattail clumps, ferns, moss, grass, flowers
//                                 and toadstools on the banks, a mossy fallen
//                                 log, stepping stones across the outlet
//   buildPond(ctx, B, rng)        lily pads & water lilies, a little timber
//                                 jetty with a lantern, a fishing rod & bucket,
//                                 a frog on a stone, a duck family paddling loops
//   buildDrifters(ctx, rng)       leaves (and a paper boat) drifting downstream
//
// Everything static lands in the shared Batch. Vegetation stays within ~2.5
// units of the water and keeps clear of paths, pads, the bridge and the falls.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STREAM, RIVERSIDE } from '../../world/layout.js';
import { getHeight, getPathDistance, getPadAt, getStreamDistance, streamPolyline } from '../../world/ground.js';
import { materials } from '../../core/materials.js';
import {
  M, TAU, WOOD, IRON, PEBBLE_TINTS, xf, mat4, deform, boulderGeo, stoneGeo, mossGeo, board, rod, tube, taperTube, Cards, flushCards,
  plantFern, plantGrass, addFlower, addToadstool, noiseA, smooth01,
} from './kit.js';
import { flowAt, depthAt, calmAt } from './water.js';

const WL = STREAM.waterLevel;
const BRIDGE = { x: RIVERSIDE.bridge.x, z: RIVERSIDE.bridge.z };
const FALLS = STREAM.falls;
const POND = STREAM.pond;

/** Keep-out tests for bank dressing. */
function nearBridge(x, z, pad = 0) {
  return Math.hypot(x - BRIDGE.x, z - BRIDGE.z) < 3.9 + pad;
}
function nearFalls(x, z) {
  return Math.hypot(x - FALLS.x, z - FALLS.z) < 6.2;
}
function nearShed(x, z) {
  const S = RIVERSIDE.bikeShed;
  return Math.hypot(x - S.x, z - S.z) < 4.2;
}
const JETTY = { x0: 3.5, x1: 6.7, z: 18.7, deck: 0.14, half: 0.55 };
function nearJetty(x, z, pad = 0) {
  return x > JETTY.x0 - 0.4 - pad && x < JETTY.x1 + 0.4 + pad && Math.abs(z - JETTY.z) < JETTY.half + 0.5 + pad;
}

/** Points along the stream centre line: { x, z, s, dx, dz } every ~0.4 units. */
const LINE = (() => {
  const pts = streamPolyline.pts;
  const out = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    out.push({ x: pts[i].x, z: pts[i].z, s, dx: (b.x - a.x) / l, dz: (b.z - a.z) / l });
  }
  return out;
})();
const LENGTH = LINE[LINE.length - 1].s;
/** Centre-line sample at arc length s. */
function lineAt(s) {
  const k = Math.max(0, Math.min(LINE.length - 2, Math.floor((s / LENGTH) * (LINE.length - 1))));
  let i = k;
  while (i < LINE.length - 2 && LINE[i + 1].s < s) i++;
  while (i > 0 && LINE[i].s > s) i--;
  const a = LINE[i], b = LINE[i + 1];
  const t = Math.max(0, Math.min(1, (s - a.s) / Math.max(1e-6, b.s - a.s)));
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: a.dx + (b.dx - a.dx) * t, dz: a.dz + (b.dz - a.dz) * t };
}

// ─── rocks in the stream ─────────────────────────────────────────────────────
/** Boulders in the stream bed: [{ x, z, r, h, strength }]. */
export function planStreamRocks(rng) {
  const rocks = [];
  let s = 3.2;
  while (s < LENGTH - 2) {
    const c = lineAt(s);
    const side = rng.chance(0.5) ? 1 : -1;
    const n = rng.chance(0.3) ? 2 + rng.int(0, 1) : 1;
    for (let k = 0; k < n; k++) {
      const u = side * rng.range(0.15, 1.4) + rng.jitter(0.25);
      const x = c.x - c.dz * u + rng.jitter(0.3), z = c.z + c.dx * u + rng.jitter(0.3);
      if (nearBridge(x, z, 0.3) || calmAt(x, z) > 0.35) continue;
      const d = depthAt(x, z);
      if (d < 0.1 || d > 1.0) continue;
      const r = k === 0 ? rng.range(0.25, 0.55) : rng.range(0.15, 0.3);
      if (rocks.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + r + 0.15)) continue;
      // h: how far the rock stands proud of the water
      rocks.push({ x, z, r, h: 0.04 + rng.range(0.04, 0.28) * (r / 0.4), strength: Math.min(1, 0.55 + r) });
    }
    s += rng.range(1.3, 2.6);
  }
  return rocks;
}

/** Paint a wet, dark band where a stone meets the water, mossy greener tops. */
function wetPaint(geo, base, yWorldOffset) {
  const c0 = new THREE.Color(base);
  const wet = c0.clone().multiplyScalar(0.55);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + yWorldOffset;
    const k = 1 - smooth01((y - WL + 0.02) / 0.07);
    c.copy(c0).lerp(wet, k * 0.85);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export function buildBanks(ctx, B, rng, rocks) {
  const MM = M();
  const density = Math.max(0.5, ctx.quality?.density ?? 1);
  const tints = ['#9d998c', '#928f83', '#a59f8e', '#8c8a80', '#a09885'];

  // ── boulders in the stream: river-worn and rounded, wet at the waterline ──
  for (const r of rocks) {
    const bed = getHeight(r.x, r.z);
    const top = WL + r.h;
    const g = stoneGeo(rng, { r: r.r, sx: rng.range(1.0, 1.35), sz: rng.range(0.8, 1.1), sy: 1, lump: 0.18, detail: 2, flatTop: 0.75, flatBottom: -2 });
    // stretch the lower half down into the bed so nothing floats
    const below = top - bed + 0.15;
    deform(g, (v) => {
      if (v.y < 0) v.y *= below / r.r;
      else v.y *= 0.75;
    });
    g.rotateY(rng.next() * TAU);
    const y0 = top - r.r * 0.75;
    wetPaint(g, rng.pick(tints), y0);
    g.translate(r.x, y0, r.z);
    B.add(MM.rock, g);
    // a cap of moss on the bigger ones
    if (r.r > 0.35 && rng.chance(0.6)) {
      const m = mossGeo(rng, { r: r.r * 0.55, h: 0.05 });
      xf(m, [r.x, top - 0.04, r.z], [0, rng.next() * TAU, 0]);
      B.add(MM.moss, m, { color: '#6f8f3a', cast: false });
    }
  }

  // ── bank stones along both shores (break the waterline) ──
  {
    let s = 2.0;
    while (s < LENGTH - 1) {
      const c = lineAt(s);
      for (const side of [-1, 1]) {
        if (!rng.chance(0.42)) continue;
        // walk outwards to the waterline
        let u = 0.8;
        while (u < 4.5 && depthAt(c.x - c.dz * side * u, c.z + c.dx * side * u) > 0.02) u += 0.08;
        const uu = u + rng.range(-0.25, 0.2);
        const x = c.x - c.dz * side * uu, z = c.z + c.dx * side * uu;
        if (nearBridge(x, z, -0.4) || nearJetty(x, z) || getPathDistance(x, z) < 1.1) continue;
        const n = rng.int(1, 3);
        for (let k = 0; k < n; k++) {
          const xx = x + rng.jitter(0.35), zz = z + rng.jitter(0.35);
          const r = rng.range(0.08, 0.26);
          const gy = Math.max(getHeight(xx, zz), WL - 0.2);
          const g = stoneGeo(rng, { r, sy: rng.range(0.3, 0.55), sx: rng.range(1, 1.7), sz: rng.range(0.7, 1.1), detail: 1, lump: 0.3 });
          g.rotateY(rng.next() * TAU);
          wetPaint(g, rng.pick(['#7e7c70', '#74746a', '#868174', '#6f7366']), gy);
          g.translate(xx, gy + r * 0.05, zz);
          B.add(MM.pebble, g, { cast: r > 0.22 });
        }
      }
      s += rng.range(0.5, 1.1);
    }
  }

  // ── pebbles on the bed, seen through the clear shallows ──
  for (let i = 0; i < Math.round(170 * density); i++) {
    const s = rng.range(1, LENGTH - 1);
    const c = lineAt(s);
    const u = rng.jitter(2.3);
    const x = c.x - c.dz * u, z = c.z + c.dx * u;
    const d = depthAt(x, z);
    if (d < 0.0 || d > 0.55 || nearBridge(x, z, -1)) continue;
    const r = rng.range(0.04, 0.11);
    const g = stoneGeo(rng, { r, sy: 0.5, detail: 0, lump: 0.2 });
    xf(g, [x, getHeight(x, z) + r * 0.2, z], [0, rng.next() * TAU, 0]);
    B.add(MM.pebble, g, { color: rng.pick(PEBBLE_TINTS.concat(['#a39a86', '#b3a58c'])), cast: false });
  }

  // ── reeds & cattails in clumps where the water is shallow and slow ──
  const reedCards = new Cards();
  const reedClump = (cx, cz, n = 10) => {
    for (let b = 0; b < n; b++) {
      const x = cx + rng.jitter(0.45), z = cz + rng.jitter(0.45);
      const gy = Math.max(getHeight(x, z), WL - 0.3);
      const a = rng.next() * Math.PI;
      const nrm = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const up = new THREE.Vector3(rng.jitter(0.25), 1, rng.jitter(0.25)).normalize();
      reedCards.add(new THREE.Vector3(x, gy - 0.05, z), up, nrm, rng.range(0.7, 1.35), { aspect: 0.28, flip: rng.chance(0.5), bend: rng.range(0, 0.12) });
    }
    // cattails: a stem and a velvety brown head
    const nt = rng.int(1, 4);
    for (let t = 0; t < nt; t++) {
      const x = cx + rng.jitter(0.3), z = cz + rng.jitter(0.3);
      const gy = Math.max(getHeight(x, z), WL - 0.3);
      const h = rng.range(0.95, 1.4);
      const lean = [rng.jitter(0.12), 0, rng.jitter(0.12)];
      const top = new THREE.Vector3(0, h, 0).applyEuler(new THREE.Euler(lean[0], 0, lean[2]));
      B.add(MM.vc, rod([x, gy - 0.1, z], [x + top.x, gy + top.y, z + top.z], 0.012, 0.009, 4), { color: '#6f8f3e', cast: false });
      const hd = new THREE.CapsuleGeometry(0.045, 0.18, 3, 8);
      xf(hd, [x + top.x * 0.86, gy + top.y * 0.86, z + top.z * 0.86], lean);
      B.add(MM.fabric, hd, { color: '#6e4128', cast: false });
      B.add(MM.vc, rod([x + top.x, gy + top.y, z + top.z], [x + top.x * 1.1, gy + top.y * 1.1, z + top.z * 1.1], 0.004, 0.002, 3), { color: '#8a7a4a', cast: false });
    }
  };
  {
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < Math.round(20 * density); tries++) {
      const s = rng.range(2, LENGTH - 1);
      const c = lineAt(s);
      const side = rng.chance(0.5) ? 1 : -1;
      let u = 0.6;
      while (u < 5.5 && depthAt(c.x - c.dz * side * u, c.z + c.dx * side * u) > 0.25) u += 0.1;
      const x = c.x - c.dz * side * u, z = c.z + c.dx * side * u;
      if (nearBridge(x, z, 0.5) || nearFalls(x, z) || nearJetty(x, z, 0.6) || getPathDistance(x, z) < 1.4 || nearShed(x, z)) continue;
      reedClump(x, z, rng.int(7, 13));
      placed++;
    }
  }
  flushCards(B, reedCards, MM.reed, null, 0.3);

  // ── bank vegetation: ferns, grass, moss, flowers, toadstools ──
  {
    const n = Math.round(380 * density);
    for (let i = 0; i < n; i++) {
      const s = rng.range(0.5, LENGTH);
      const c = lineAt(s);
      const side = rng.chance(0.5) ? 1 : -1;
      const u = rng.range(1.4, 4.6);
      const x = c.x - c.dz * side * u + rng.jitter(0.3), z = c.z + c.dx * side * u + rng.jitter(0.3);
      const d = depthAt(x, z);
      if (d > -0.04) continue; // dry land only
      if (getStreamDistance(x, z) > 4.6 && calmAt(x, z) < 0.05) continue;
      if (getPathDistance(x, z) < 1.3 || getPadAt(x, z, 0.3) || nearBridge(x, z) || nearFalls(x, z) || nearJetty(x, z) || nearShed(x, z)) continue;
      const gy = getHeight(x, z);
      const near = d > -0.35; // right at the water
      const k = rng.next();
      if (k < (near ? 0.3 : 0.38)) plantFern(B, rng, x, gy, z, { size: rng.range(0.4, 0.85), fronds: rng.int(6, 10) });
      else if (k < 0.62) plantGrass(B, rng, x, gy, z, { size: rng.range(0.25, near ? 0.6 : 0.45), blades: rng.int(3, 5) });
      else if (k < 0.76) {
        const m = mossGeo(rng, { r: rng.range(0.15, 0.4), h: rng.range(0.05, 0.1), sx: rng.range(1, 1.8) });
        xf(m, [x, gy, z], [0, rng.next() * TAU, 0]);
        B.add(MM.moss, m, { color: rng.pick(['#6f8f3a', '#5d7d30', '#7f9a44', '#86a04a']), cast: false });
      } else if (k < 0.9) {
        // little drifts of flowers: forget-me-nots by the water, buttercups & campion further up
        const col = near ? rng.pick(['#7fa7e0', '#9fc0f0', '#f4f0e6']) : rng.pick(['#f2c14e', '#f29bb8', '#f4f0e6', '#b48fd6']);
        for (let f = 0; f < rng.int(3, 6); f++) addFlower(B, rng, x + rng.jitter(0.2), gy, z + rng.jitter(0.2), { color: col, size: 0.045, stem: 0.14 });
      } else addToadstool(B, rng, x, gy, z, { size: rng.range(0.06, 0.13), color: rng.chance(0.7) ? '#c4301f' : '#d7832e' });
    }
  }

  // ── a mossy fallen log lying along the east bank, half in the water ──
  {
    const c = lineAt(9.5);
    const side = 1;
    const x = c.x - c.dz * side * 1.7, z = c.z + c.dx * side * 1.7;
    const a = [x - c.dx * 1.6, Math.max(getHeight(x - c.dx * 1.6, z - c.dz * 1.6), WL - 0.15) + 0.12, z - c.dz * 1.6];
    const b = [x + c.dx * 1.4 - c.dz * 0.5, Math.max(getHeight(x + c.dx * 1.4, z + c.dz * 1.4), WL - 0.2) + 0.2, z + c.dz * 1.4 + c.dx * 0.5];
    if (!nearBridge(x, z)) {
      const log = taperTube([a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.04, (a[2] + b[2]) / 2], b], 0.24, 0.19, 9, 10);
      B.add(MM.wood, log, { color: '#6a5442' });
      // broken end grain + moss on top + a few shelf fungi
      B.add(MM.vc, new THREE.CircleGeometry(0.22, 9).lookAt(new THREE.Vector3(a[0] - b[0], a[1] - b[1], a[2] - b[2])).translate(a[0], a[1], a[2]), { color: '#b08a60', cast: false });
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + 0.19, a[2] + (b[2] - a[2]) * t];
        const m = mossGeo(rng, { r: rng.range(0.15, 0.25), h: 0.07, sx: 1.6 });
        xf(m, p, [0, Math.atan2(b[0] - a[0], b[2] - a[2]) + Math.PI / 2, 0]);
        B.add(MM.moss, m, { color: '#6f8f3a', cast: false });
      }
      for (let i = 0; i < 4; i++) {
        const t = 0.2 + i * 0.18;
        const p = [a[0] + (b[0] - a[0]) * t + c.dz * 0.2, a[1] + (b[1] - a[1]) * t + rng.range(-0.05, 0.08), a[2] + (b[2] - a[2]) * t - c.dx * 0.2];
        B.add(MM.cap, new THREE.SphereGeometry(0.11, 10, 4, 0, TAU, 0, Math.PI / 2).scale(1, 0.35, 0.8).translate(p[0], p[1], p[2]), { color: '#c08a4a', cast: false });
      }
      addToadstool(B, rng, b[0] + 0.2, getHeight(b[0] + 0.2, b[2]), b[2] + 0.1, { size: 0.12 });
      addToadstool(B, rng, b[0] + 0.32, getHeight(b[0] + 0.32, b[2]), b[2] - 0.05, { size: 0.08 });
    }
  }

  // ── stepping stones across the outlet below the pond ──
  {
    const c = lineAt(LENGTH - 7.5);
    for (let k = -3; k <= 3; k++) {
      const u = k * 0.62 + rng.jitter(0.08);
      const x = c.x - c.dz * u + c.dx * rng.jitter(0.12), z = c.z + c.dx * u + c.dz * rng.jitter(0.12);
      const gy = getHeight(x, z);
      const top = Math.max(WL + 0.12, gy + 0.08);
      const r = rng.range(0.24, 0.32);
      const g = stoneGeo(rng, { r, sy: 0.9, sx: 1.1, detail: 1, flatTop: 0.25, flatBottom: -2, lump: 0.15 });
      const h0 = gy - 0.25;
      deform(g, (v) => {
        if (v.y < 0) v.y *= (top - h0) / (r * 0.6) * 0.8;
      });
      wetPaint(g, rng.pick(['#8f8a7e', '#9a9384', '#85827a']), top - r * 0.2);
      g.translate(x, top - r * 0.2, z);
      B.add(MM.pebble, g);
    }
  }
}

// ─── the pond ────────────────────────────────────────────────────────────────
function lilyPadGeometry(rng) {
  const s = new THREE.Shape();
  const notch = rng.range(0.22, 0.35);
  s.moveTo(0, 0);
  const n = 22;
  for (let i = 0; i <= n; i++) {
    const a = notch + (i / n) * (TAU - 2 * notch);
    const r = 1 + 0.05 * Math.sin(a * 5 + rng.next());
    s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.lineTo(0, 0);
  const g = new THREE.ShapeGeometry(s, 1);
  g.rotateX(-Math.PI / 2);
  // cup the pad a touch and paint veins
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color(rng.pick(['#5f8f3f', '#6a9a45', '#557f37'])), light = base.clone().lerp(new THREE.Color('#b5cf6a'), 0.35), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    pos.setY(i, r * r * 0.04);
    c.copy(base).lerp(light, smooth01(1 - r) * 0.5);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function addLilyFlower(B, x, y, z, s, rng) {
  const MM = M();
  const petals = (n, len, wid, tilt, rot, col) => {
    for (let i = 0; i < n; i++) {
      const g = new THREE.SphereGeometry(1, 5, 3);
      g.scale(wid, 0.03, len);
      g.translate(0, 0, len * 0.9);
      g.rotateX(-tilt);
      g.rotateY(rot + (i / n) * TAU);
      const pos = g.attributes.position;
      const cc = new Float32Array(pos.count * 3);
      const a = new THREE.Color('#fff8ec'), b = new THREE.Color(col), c = new THREE.Color();
      for (let k = 0; k < pos.count; k++) {
        const r = Math.hypot(pos.getX(k), pos.getZ(k)) / (len * 1.8);
        c.copy(a).lerp(b, smooth01((r - 0.35) / 0.65));
        cc.set([c.r, c.g, c.b], k * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      g.scale(s, s, s);
      B.add(MM.vc, g.translate(x, y, z), { cast: false });
    }
  };
  const pink = rng.pick(['#f2a0b8', '#f7c3d2', '#fff1f4', '#e98aa8']);
  petals(8, 0.13, 0.055, 0.35, rng.next(), pink);
  petals(6, 0.1, 0.045, 0.85, rng.next(), pink);
  B.add(MM.vc, new THREE.SphereGeometry(0.045 * s, 8, 6).scale(1, 0.6, 1).translate(x, y + 0.04 * s, z), { color: '#efc85a', cast: false });
}

export function buildPond(ctx, B, rng) {
  const MM = M();
  const group = new THREE.Group();
  group.name = 'pond';
  ctx.scene.add(group);
  const density = Math.max(0.5, ctx.quality?.density ?? 1);

  // ── lily pads (+ flowers) across the calm water ──
  const spots = [];
  for (let tries = 0; tries < 900 && spots.length < Math.round(34 * density); tries++) {
    const a = rng.next() * TAU, d = Math.sqrt(rng.next()) * POND.radius * 1.15;
    const x = POND.x + (Math.cos(a) * d) / 0.9, z = POND.z + Math.sin(a) * d;
    const dep = depthAt(x, z);
    if (dep < 0.12 || calmAt(x, z) < 0.3 || nearJetty(x, z, 0.3)) continue;
    // leave the duck lane free
    if (Math.abs(Math.hypot((x - POND.x - 0.4) / 1.2, z - POND.z) - 2.5) < 0.55) continue;
    const s = rng.range(0.22, 0.42);
    if (spots.some((p) => Math.hypot(p.x - x, p.z - z) < (p.s + s) * 1.02)) continue;
    spots.push({ x, z, s });
  }
  // also a few in the slow edges of the plunge pool
  for (let i = 0; i < 4; i++) {
    const a = rng.range(-0.6, 1.2), d = STREAM.pool.radius * rng.range(0.7, 0.95);
    const x = STREAM.pool.x + Math.sin(a) * d, z = STREAM.pool.z + Math.cos(a) * d;
    if (depthAt(x, z) > 0.15) spots.push({ x, z, s: rng.range(0.2, 0.3) });
  }
  for (const sp of spots) {
    const g = lilyPadGeometry(rng);
    xf(g, [sp.x, WL + 0.012, sp.z], [rng.jitter(0.03), rng.next() * TAU, rng.jitter(0.03)], [sp.s, 1, sp.s]);
    B.add(MM.vc, g, { cast: false });
    if (rng.chance(0.3)) addLilyFlower(B, sp.x + rng.jitter(sp.s * 0.3), WL + 0.03, sp.z + rng.jitter(sp.s * 0.3), rng.range(0.8, 1.15), rng);
  }

  // ── jetty: a little timber landing stage on the west shore ──
  {
    const { x0, x1, z, deck, half } = JETTY;
    const len = x1 - x0;
    const nP = Math.round(len / 0.24);
    for (let i = 0; i < nP; i++) {
      const x = x0 + (i + 0.5) * (len / nP);
      const w = half * 2 + rng.jitter(0.05);
      const g = board(len / nP - 0.025, 0.06, w, { rng });
      xf(g, [x + rng.jitter(0.01), deck + rng.jitter(0.006), z + rng.jitter(0.02)], [0, rng.jitter(0.02), rng.jitter(0.01)]);
      B.add(MM.wood, g, { color: rng.pick(['#9a8068', '#8f7660', '#a5876a']) });
    }
    // stringers, posts with caps, a cross brace
    for (const sz of [-1, 1]) B.add(MM.wood, board(len, 0.1, 0.08, { rng }).translate((x0 + x1) / 2, deck - 0.08, z + sz * (half - 0.08)), { color: WOOD.weathered });
    const posts = [];
    for (const px of [x0 + 0.3, (x0 + x1) / 2 + 0.2, x1 - 0.12]) {
      for (const sz of [-1, 1]) {
        const pz = z + sz * (half + 0.02);
        const bottom = getHeight(px, pz) - 0.3;
        const top = deck + (px > x1 - 0.2 ? 0.5 : 0.12);
        B.add(MM.wood, rod([px, bottom, pz], [px, top, pz], 0.07, 0.065, 8), { color: '#6f5d4c' });
        B.add(MM.wood, new THREE.SphereGeometry(0.07, 8, 4, 0, TAU, 0, Math.PI / 2).scale(1, 0.5, 1).translate(px, top, pz), { color: '#6f5d4c', cast: false });
        posts.push([px, top, pz]);
      }
    }
    // rope coils on the end posts
    for (const [px, top, pz] of posts.filter((p) => p[0] > x1 - 0.2)) {
      for (let r = 0; r < 3; r++) B.add(MM.vc, new THREE.TorusGeometry(0.09, 0.016, 5, 16).rotateX(Math.PI / 2).translate(px, top - 0.12 + r * 0.035, pz), { color: '#c9b27a', cast: false });
    }
    // lantern on the end post + a fishing rod and a bucket
    const lp = posts.find((p) => p[0] > x1 - 0.2 && p[2] < z);
    if (lp) {
      const lx = lp[0], ly = lp[1] + 0.02, lz = lp[2];
      const parts = [
        [new THREE.BoxGeometry(0.15, 0.02, 0.15).translate(0, 0.01, 0), MM.metal, IRON],
        [new THREE.CylinderGeometry(0.06, 0.055, 0.17, 4, 1).rotateY(Math.PI / 4).translate(0, 0.11, 0), MM.lamp, null],
        [new THREE.ConeGeometry(0.12, 0.09, 4, 1).rotateY(Math.PI / 4).translate(0, 0.24, 0), MM.metal, IRON],
      ];
      for (const [g, m, c] of parts) B.add(m, g.translate(lx, ly, lz), { color: c, cast: false });
      group.userData.lantern = new THREE.Vector3(lx, ly + 0.11, lz);
    }
    const rodBase = [x1 - 0.45, deck + 0.03, z + 0.3];
    B.add(MM.wood, rod(rodBase, [x1 + 1.1, deck + 1.05, z + 0.85], 0.014, 0.006, 5), { color: '#a07a50', cast: false });
    const tip = new THREE.Vector3(x1 + 1.1, deck + 1.05, z + 0.85);
    B.add(MM.vc, tube([tip, new THREE.Vector3(tip.x + 0.25, (tip.y + WL) / 2, tip.z + 0.1), new THREE.Vector3(tip.x + 0.35, WL + 0.02, tip.z + 0.15)], 0.0025, 3, 10), { color: '#e8e2d0', cast: false });
    B.add(MM.vc, new THREE.SphereGeometry(0.03, 8, 6).translate(tip.x + 0.35, WL + 0.025, tip.z + 0.15), { color: '#e2553f', cast: false });
    B.add(MM.wood, new THREE.CylinderGeometry(0.13, 0.11, 0.22, 12).translate(x1 - 0.7, deck + 0.14, z - 0.22), { color: WOOD.spruce });
    B.add(MM.metal, new THREE.TorusGeometry(0.13, 0.01, 4, 14).rotateX(Math.PI / 2).translate(x1 - 0.7, deck + 0.2, z - 0.22), { color: IRON, cast: false });
  }

  // ── a frog on a stone ──
  let frog = null;
  {
    const x = POND.x + 2.4, z = POND.z + 2.9;
    const gy = getHeight(x, z);
    const top = Math.max(WL + 0.16, gy + 0.1);
    const g = stoneGeo(rng, { r: 0.42, sy: 0.6, detail: 2, flatTop: 0.2, lump: 0.15 });
    wetPaint(g, '#8f8a7e', top - 0.15);
    g.translate(x, top - 0.15, z);
    B.add(MM.pebble, g);
    frog = makeFrog();
    frog.group.position.set(x, top - 0.01, z);
    frog.group.rotation.y = -2.4;
    group.add(frog.group);
  }

  // ── a duck family paddling slow loops ──
  const ducks = makeDucks(group);

  return {
    group,
    lantern: group.userData.lantern ?? null,
    update(dt, t) {
      frog?.update(t);
      ducks.update(t);
    },
  };
}

// ─── little animals ──────────────────────────────────────────────────────────
function tinted(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function makeFrog() {
  const g = new THREE.Group();
  g.name = 'frog';
  const GREEN = '#7cbf4f';
  const sphere = (r, sx, sy, sz, x, y, z, hex, ws = 10, hs = 7) => tinted(new THREE.SphereGeometry(r, ws, hs).scale(sx, sy, sz).translate(x, y, z), hex);
  const parts = [sphere(0.12, 1.1, 0.75, 1.25, 0, 0.08, 0, GREEN, 12, 8)];
  for (const s of [-1, 1]) {
    parts.push(
      sphere(0.045, 1, 1, 1, s * 0.06, 0.16, 0.06, GREEN, 8, 6),
      sphere(0.032, 1, 1, 1, s * 0.06, 0.172, 0.08, '#fff8ec', 8, 6),
      sphere(0.016, 1, 1, 1, s * 0.06, 0.176, 0.102, '#2b1d14', 6, 4),
      sphere(0.06, 0.7, 0.5, 1.3, s * 0.11, 0.04, -0.05, GREEN, 8, 6),
      sphere(0.03, 1.4, 0.5, 1, s * 0.09, 0.012, 0.11, GREEN, 6, 4)
    );
  }
  parts.push(tinted(new THREE.SphereGeometry(0.09, 10, 6).scale(1.1, 0.6, 1).translate(0, 0.05, 0.07), '#e8e2a8'));
  const geo = mergeAll(parts);
  const body = new THREE.Mesh(geo, M().vc);
  body.castShadow = false;
  g.add(body);
  g.scale.setScalar(1.25);
  let next = 3, baseY = null;
  return {
    group: g,
    update(t) {
      if (baseY === null) baseY = g.position.y;
      // breathing: the whole frog puffs up a little
      body.scale.set(1 + Math.max(0, Math.sin(t * 6.2)) * 0.03, 1 + Math.sin(t * 3.1) * 0.035, 1);
      const ph = t - next;
      if (ph > 0) {
        const k = Math.min(ph / 0.45, 1);
        g.position.y = baseY + Math.sin(k * Math.PI) * 0.12;
        if (k >= 1) next = t + 3 + ((t * 7.3) % 4);
      }
    },
  };
}

function mergeAll(list) {
  const keep = ['position', 'normal', 'color'];
  for (const g of list) for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
  // every part is an indexed primitive with position, normal & colour
  return mergeGeometriesSafe(list);
}

function mergeGeometriesSafe(list) {
  return mergeGeometries(list, false);
}

function duckGeometry(scale = 1, yellow = false) {
  const body = yellow ? '#ffd95a' : '#fff3d6';
  const wing = yellow ? '#f2c445' : '#efe2c4';
  const parts = [];
  parts.push(tinted(new THREE.SphereGeometry(0.2, 14, 9).scale(1.12, 0.6, 1.55).translate(0, 0.07, -0.02), body));
  for (const sd of [-1, 1]) parts.push(tinted(new THREE.SphereGeometry(0.13, 10, 7).scale(0.55, 0.6, 1.5).rotateY(sd * 0.12).translate(sd * 0.17, 0.13, -0.06), wing));
  parts.push(tinted(new THREE.ConeGeometry(0.08, 0.18, 6).rotateX(-Math.PI / 2 - 0.7).translate(0, 0.16, -0.32), body));
  parts.push(tinted(new THREE.CylinderGeometry(0.06, 0.075, 0.16, 8).translate(0, 0.19, 0.19), body));
  parts.push(tinted(new THREE.SphereGeometry(0.1, 12, 8).scale(1, 0.95, 1.1).translate(0, 0.29, 0.23), body));
  parts.push(tinted(new THREE.ConeGeometry(0.045, 0.13, 6).rotateX(Math.PI / 2).scale(1.35, 0.55, 1).translate(0, 0.27, 0.37), '#f0a23a'));
  for (const s of [-1, 1]) parts.push(tinted(new THREE.SphereGeometry(0.017, 6, 4).translate(s * 0.07, 0.315, 0.29), '#2b1d14'));
  const g = mergeAll(parts);
  g.scale(scale, scale, scale);
  return g;
}

function makeDucks(parent) {
  const mat = M().vc;
  const mum = new THREE.Mesh(duckGeometry(1.1), mat);
  mum.name = 'duck';
  mum.castShadow = false;
  parent.add(mum);
  // the three ducklings share one instanced draw call
  const kids = new THREE.InstancedMesh(duckGeometry(0.6, true), mat, 3);
  kids.name = 'ducklings';
  kids.castShadow = false;
  kids.frustumCulled = false;
  parent.add(kids);
  const cx = POND.x + 0.4, cz = POND.z;
  const R = 2.5;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const speed = reduced ? 0.03 : 0.09;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const o = new THREE.Object3D();
  const posAt = (s, out) => {
    const r = R * (1 + 0.12 * Math.sin(s * 2 + 0.6));
    return out.set(cx + Math.cos(s) * r * 1.2, WL + 0.02, cz + Math.sin(s) * r);
  };
  const place = (target, i, t) => {
    const s = -(t * speed) + i * 0.32 + (i > 0 ? 0.12 : 0);
    posAt(s, a);
    posAt(s - 0.02, b);
    target.position.copy(a);
    target.position.y += Math.sin(t * 2.6 + i) * 0.01;
    target.rotation.set(0, Math.atan2(b.x - a.x, b.z - a.z), Math.sin(t * 2.1 + i * 1.7) * 0.05);
  };
  function update(t) {
    place(mum, 0, t);
    for (let i = 1; i <= 3; i++) {
      place(o, i, t);
      o.updateMatrix();
      kids.setMatrixAt(i - 1, o.matrix);
    }
    kids.instanceMatrix.needsUpdate = true;
  }
  update(0);
  return { meshes: [mum, kids], update };
}

// ─── things drifting downstream ─────────────────────────────────────────────
/**
 * Leaves floating down the stream (one InstancedMesh) and a little paper
 * boat. Positions come from the centre line + a fixed offset across.
 */
export function buildDrifters(ctx, rng) {
  const group = new THREE.Group();
  group.name = 'drifters';
  ctx.scene.add(group);
  const n = Math.round(14 * Math.max(0.5, ctx.quality?.density ?? 1));
  const leafGeo = new THREE.PlaneGeometry(0.16, 0.12, 2, 1);
  leafGeo.rotateX(-Math.PI / 2);
  deform(leafGeo, (v) => {
    v.y += v.x * v.x * 1.5;
  });
  const leafMat = materials.foliage({ variant: 'oak', color: '#c98a3a', volume: false });
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, n);
  leaves.name = 'drifting-leaves';
  leaves.castShadow = false;
  const COLS = ['#d9a441', '#c96a3a', '#b8562a', '#e0b85a', '#8fa14a'];
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({ s0: rng.next() * LENGTH, u: rng.jitter(0.9), spin: rng.jitter(0.6), rot: rng.next() * TAU, speed: rng.range(0.35, 0.55) });
    leaves.setColorAt(i, new THREE.Color(COLS[i % COLS.length]));
  }
  group.add(leaves);
  // the paper boat
  const boat = new THREE.Group();
  {
    const paper = M().vc;
    const hull = new THREE.BufferGeometry();
    const v = [
      -0.16, 0.0, 0, 0.16, 0.0, 0, -0.1, -0.03, 0.06, 0.1, -0.03, 0.06, -0.1, -0.03, -0.06, 0.1, -0.03, -0.06,
      -0.2, 0.06, 0.07, 0.2, 0.06, 0.07, -0.2, 0.06, -0.07, 0.2, 0.06, -0.07, 0, 0.17, 0,
    ];
    hull.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    hull.setIndex([0, 2, 3, 0, 3, 1, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 4, 5, 9, 4, 9, 8, 0, 6, 2, 1, 3, 7, 0, 4, 8, 1, 9, 5, 6, 10, 7, 8, 9, 10, 0, 8, 10, 0, 10, 6, 1, 7, 10, 1, 10, 9]);
    hull.computeVertexNormals();
    tinted(hull, '#f4efe2');
    const mesh = new THREE.Mesh(hull, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
    mesh.castShadow = false;
    boat.add(mesh);
    boat.scale.setScalar(0.9);
  }
  group.add(boat);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  const boatState = { s0: 6, u: 0.3 };
  const start = 1.5, end = LENGTH - 0.5;
  const span = end - start;
  return {
    group,
    update(dt, t) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const s = start + ((it.s0 + t * it.speed) % span);
        const c = lineAt(s);
        const calm = calmAt(c.x, c.z);
        p.set(c.x - c.dz * it.u * (1 + calm * 2), WL + 0.015, c.z + c.dx * it.u * (1 + calm * 2));
        e.set(0, it.rot + t * it.spin, 0);
        q.setFromEuler(e);
        // fade in/out at the ends by scaling
        const k = Math.min(1, (s - start) / 1.2, (end - s) / 1.2);
        sc.setScalar(Math.max(0.001, k));
        m.compose(p, q, sc);
        leaves.setMatrixAt(i, m);
      }
      leaves.instanceMatrix.needsUpdate = true;
      {
        const s = start + ((boatState.s0 + t * 0.32) % span);
        const c = lineAt(s);
        const calm = calmAt(c.x, c.z);
        boat.position.set(c.x - c.dz * boatState.u * (1 + calm * 3), WL + 0.01 + Math.sin(t * 2.3) * 0.008, c.z + c.dx * boatState.u * (1 + calm * 3));
        boat.rotation.set(Math.sin(t * 1.7) * 0.06, Math.atan2(c.dx, c.dz) + Math.PI / 2 + Math.sin(t * 0.6) * 0.3, Math.sin(t * 2.1) * 0.05);
        const k = Math.min(1, (s - start) / 1.2, (end - s) / 1.2);
        boat.scale.setScalar(0.9 * Math.max(0.001, k));
      }
    },
  };
}
