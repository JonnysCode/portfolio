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
//                                 log, stepping stones across the outlet, and
//                                 where the stream leaves the glen an old
//                                 trunk across the water with a mossy bank
//                                 behind it (the stream slips under the log)
//   buildPond(ctx, B, rng)        lily pads & water lilies (glowing softly at
//                                 night), a little timber jetty with a lantern,
//                                 a fishing rod & bucket, a frog on a stone, a
//                                 duck family paddling loops, and three leaf
//                                 boats with candles drifting round the middle
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
  M, TAU, WOOD, IRON, PEBBLE_TINTS, xf, deform, stoneGeo, mossGeo, board, rod, tube, taperTube, Cards, flushCards,
  plantFern, plantGrass, addFlower, addToadstool, addIvy, smooth01, paint, noiseA,
} from './kit.js';
import { flowAt, depthAt, calmAt } from './water.js';

const WL = STREAM.waterLevel;
const BRIDGE = { x: RIVERSIDE.bridge.x, z: RIVERSIDE.bridge.z };
const FALLS = STREAM.falls;
const POND = STREAM.pond;
const noiseOf = (x, z) => noiseA(x, z);

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
/** Centre-line sample at arc length s (written into `out` when given — no allocation). */
function lineAt(s, out = null) {
  const k = Math.max(0, Math.min(LINE.length - 2, Math.floor((s / LENGTH) * (LINE.length - 1))));
  let i = k;
  while (i < LINE.length - 2 && LINE[i + 1].s < s) i++;
  while (i > 0 && LINE[i].s > s) i--;
  const a = LINE[i], b = LINE[i + 1];
  const t = Math.max(0, Math.min(1, (s - a.s) / Math.max(1e-6, b.s - a.s)));
  const o = out ?? {};
  o.x = a.x + (b.x - a.x) * t;
  o.z = a.z + (b.z - a.z) * t;
  o.dx = a.dx + (b.dx - a.dx) * t;
  o.dz = a.dz + (b.dz - a.dz) * t;
  return o;
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
    const g = stoneGeo(rng, { r: r.r, sx: rng.range(1.0, 1.35), sz: rng.range(0.8, 1.1), sy: 1, lump: 0.18, sphere: [11, 7], flatTop: 0.75, flatBottom: -2 });
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

  buildOutlet(B, rng, reedClump);
  flushCards(B, reedCards, MM.reed, null, 0.3);
}

/**
 * Where the stream leaves the glen: an old fallen trunk lies across the water
 * from bank to bank, and behind it a mossy bank fills the channel, so the
 * stream slips under the log into a dark, ferny hollow — never into a trench
 * with sheer walls. Reeds and cattails crowd the log's upstream face.
 */
function buildOutlet(B, rng, reedClump) {
  const MM = M();
  const sLog = LENGTH - 4.0;
  const c = lineAt(sLog);
  const ax = -c.dz, az = c.dx; // across the stream
  const R = 0.42;
  const at = (u, along = 0) => [c.x + ax * u + c.dx * along, c.z + az * u + c.dz * along];
  // ── the log: its ends bedded in the banks, sagging a little over the water ──
  const us = [-3.7, -1.9, 0, 1.8, 3.5];
  const axis = us.map((u, i) => {
    const [x, z] = at(u, 0.12 * Math.sin(i * 1.7));
    const gy = getHeight(x, z);
    const y = Math.abs(u) > 3 ? Math.max(gy + R * 0.45, WL + R + 0.2) : WL + R + 0.2 + 0.06 * Math.abs(u) / 1.9;
    return new THREE.Vector3(x, y, z);
  });
  B.add(MM.wood, taperTube(axis, R * 1.08, R * 0.86, 12, 28), { color: '#5d5044' });
  const A = axis[0], Z = axis[axis.length - 1];
  const dir = Z.clone().sub(A).normalize();
  // the root plate at one end: a flare of gnarled roots and a clod of earth
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * TAU + rng.jitter(0.3);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const out = side.clone().multiplyScalar(Math.cos(a)).add(new THREE.Vector3(0, Math.sin(a), 0));
    const p0 = A.clone().addScaledVector(dir, 0.15);
    const p1 = A.clone().addScaledVector(out, R * 0.9).addScaledVector(dir, -0.25);
    const p2 = A.clone().addScaledVector(out, R * 1.6 + rng.range(0, 0.4)).addScaledVector(dir, -0.45 - rng.range(0, 0.3));
    p2.y = Math.max(p2.y, getHeight(p2.x, p2.z) - 0.05);
    B.add(MM.wood, taperTube([p0, p1, p2], 0.12, 0.025, 5, 8), { color: '#5f4b39', cast: false });
  }
  {
    const m = mossGeo(rng, { r: R * 1.3, h: 0.35, sx: 0.8, sz: 1.2, seg: 10 });
    xf(m, [A.x - dir.x * 0.3, A.y - R * 0.9, A.z - dir.z * 0.3], [0, Math.atan2(dir.x, dir.z), 0]);
    B.add(MM.soil, m, { color: '#4a3a2a', cast: false });
  }
  // the broken far end: pale end grain and a few splinters
  B.add(MM.vc, new THREE.CircleGeometry(R * 0.84, 12).lookAt(dir).translate(Z.x + dir.x * 0.01, Z.y, Z.z + dir.z * 0.01), { color: '#b9936a', cast: false });
  for (let k = 0; k < 5; k++) {
    const a = rng.next() * TAU;
    const off = new THREE.Vector3(-dir.z * Math.cos(a), Math.sin(a), dir.x * Math.cos(a)).multiplyScalar(R * rng.range(0.3, 0.75));
    const g = new THREE.ConeGeometry(0.05, rng.range(0.15, 0.32), 4).translate(0, 0.08, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().add(new THREE.Vector3(rng.jitter(0.3), rng.jitter(0.3), rng.jitter(0.3))).normalize()));
    g.translate(Z.x + off.x, Z.y + off.y, Z.z + off.z);
    B.add(MM.vc, g, { color: '#a8865f', cast: false });
  }
  // moss along the top, ferns and toadstools sprouting from it, shelf fungi on the flank,
  // and strands of moss trailing down to the water
  const curve = new THREE.CatmullRomCurve3(axis, false, 'centripetal');
  const P = new THREE.Vector3();
  const strands = new Cards();
  for (let i = 0; i < 14; i++) {
    const t = 0.04 + (i / 13) * 0.92;
    curve.getPointAt(t, P);
    const m = mossGeo(rng, { r: rng.range(0.22, 0.32), h: rng.range(0.07, 0.12), sx: 1.5, seg: 9 });
    xf(m, [P.x, P.y + R * 0.86, P.z], [rng.jitter(0.1), Math.atan2(dir.x, dir.z) + Math.PI / 2 + rng.jitter(0.3), rng.jitter(0.1)]);
    B.add(MM.moss, m, { color: rng.pick(['#6f8f3a', '#5d7d30', '#7f9a44']), cast: false });
    if (i % 4 === 1) plantFern(B, rng, P.x, P.y + R * 0.9, P.z, { size: rng.range(0.35, 0.55), fronds: rng.int(6, 9), tilt: 1.2 });
    if (i % 5 === 3) addToadstool(B, rng, P.x + rng.jitter(0.1), P.y + R * 0.92, P.z + rng.jitter(0.1), { size: rng.range(0.07, 0.11), color: rng.chance(0.6) ? '#c4301f' : '#d7832e' });
    if (i % 3 === 0) {
      const sd = rng.chance(0.5) ? 1 : -1;
      B.add(MM.cap, new THREE.SphereGeometry(0.12, 10, 4, 0, TAU, 0, Math.PI / 2).scale(1, 0.32, 0.75).translate(P.x + c.dx * sd * R * 0.95, P.y + rng.range(-0.1, 0.12), P.z + c.dz * sd * R * 0.95), { color: '#c08a4a', cast: false });
    }
    if (i > 3 && i < 11 && i % 2 === 0) {
      addIvy(B, rng, [P.x + c.dx * R * 0.8, P.y + R * 0.4, P.z + c.dz * R * 0.8], [c.dx * 0.2, -1, c.dz * 0.2], {
        length: rng.range(0.3, 0.55), droop: 1.5, size: 0.11, density: 1.4, normal: [c.dx, 0, c.dz], cards: strands, stemColor: '#4f5f2a',
      });
    }
  }
  flushCards(B, strands, MM.ivy, null, 0);

  // ── the bank behind the log: a mossy heightfield filling the channel ──
  const fillH = (x, z, f) => {
    const t = f.s - (sLog + 0.15);
    const k = smooth01(t / 1.5);
    const hb = 0.12 + 0.08 * noiseOf(x * 0.7, z * 0.7);
    return WL - 0.08 + (hb - WL + 0.08) * k + k * 0.07 * noiseOf(x * 1.9 + 3, z * 1.9);
  };
  {
    const STEP = 0.15;
    const x0 = c.x - 5.5, x1 = c.x + 5.5, z0 = c.z - 2.5, z1 = c.z + 10;
    const nx = Math.round((x1 - x0) / STEP), nz = Math.round((z1 - z0) / STEP);
    const W = nx + 1;
    const hs = new Float32Array((nx + 1) * (nz + 1)), gs = new Float32Array((nx + 1) * (nz + 1));
    const f = { s: 0, u: 0, dx: 0, dz: 1 };
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = x0 + i * STEP, z = z0 + j * STEP;
        flowAt(x, z, f);
        gs[j * W + i] = getHeight(x, z);
        hs[j * W + i] = f.s > sLog + 0.1 ? fillH(x, z, f) : -9;
      }
    }
    const pos = [], col = [], idx = [];
    const vid = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
    // (the moss texture brings its own green: these stay olive so the bank sits in the meadow)
    const cc = new THREE.Color(), moss = new THREE.Color('#7b8650'), mossL = new THREE.Color('#939c5c'), wet = new THREE.Color('#4a4536');
    const vert = (i, j) => {
      const k = j * W + i;
      if (vid[k] >= 0) return vid[k];
      const x = x0 + i * STEP, z = z0 + j * STEP;
      const y = Math.max(hs[k], gs[k] - 0.1);
      vid[k] = pos.length / 3;
      pos.push(x, y, z);
      cc.copy(moss).lerp(mossL, 0.5 + 0.5 * noiseOf(x * 1.3, z * 1.3)).lerp(wet, 1 - smooth01((y - WL) / 0.3));
      col.push(cc.r, cc.g, cc.b);
      return vid[k];
    };
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * W + i, b = a + 1, d = a + W, e = d + 1;
        if (Math.max(hs[a] - gs[a], hs[b] - gs[b], hs[d] - gs[d], hs[e] - gs[e]) < 0.03) continue;
        const va = vert(i, j), vb = vert(i + 1, j), vd = vert(i, j + 1), ve = vert(i + 1, j + 1);
        idx.push(va, vd, vb, vb, vd, ve);
      }
    }
    if (idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      B.add(MM.moss, g, { cast: false });
    }
    // dress it: ferns, grass, cattails & reeds at the water, a mossy boulder or two, toadstools
    const f2 = { s: 0, u: 0, dx: 0, dz: 1 };
    let placed = 0;
    for (let tries = 0; tries < 600 && placed < 70; tries++) {
      const x = x0 + rng.next() * (x1 - x0), z = z0 + rng.next() * (z1 - z0);
      flowAt(x, z, f2);
      if (f2.s < sLog + 0.5 || Math.abs(f2.u) > 3.4) continue;
      const gy = getHeight(x, z);
      const y = fillH(x, z, f2);
      if (y < gy - 0.02 && Math.abs(f2.u) < 2.2) continue; // (outside the channel the ground itself is dressed)
      const top = Math.max(y, gy);
      if (top < WL + 0.05) continue;
      placed++;
      const k = rng.next();
      if (k < 0.34) plantFern(B, rng, x, top, z, { size: rng.range(0.45, 0.85), fronds: rng.int(7, 11), tilt: 1.0 });
      else if (k < 0.58) plantGrass(B, rng, x, top, z, { size: rng.range(0.3, 0.55), blades: rng.int(3, 5) });
      else if (k < 0.7) {
        const m = mossGeo(rng, { r: rng.range(0.2, 0.4), h: rng.range(0.06, 0.12), sx: rng.range(1, 1.6) });
        xf(m, [x, top - 0.02, z], [0, rng.next() * TAU, 0]);
        B.add(MM.moss, m, { color: rng.pick(['#6f8f3a', '#5d7d30', '#7f9a44']), cast: false });
      } else if (k < 0.82) for (let q = 0; q < rng.int(3, 6); q++) addFlower(B, rng, x + rng.jitter(0.2), top, z + rng.jitter(0.2), { color: rng.pick(['#7fa7e0', '#9fc0f0', '#f4f0e6', '#f2c14e']), size: 0.045, stem: 0.14 });
      else if (k < 0.9) addToadstool(B, rng, x, top, z, { size: rng.range(0.07, 0.13), color: rng.chance(0.7) ? '#c4301f' : '#d7832e' });
      else {
        const r = rng.range(0.18, 0.36);
        const g = stoneGeo(rng, { r, sy: rng.range(0.45, 0.65), detail: 1, lump: 0.25 });
        xf(g, [x, top + r * 0.05, z], [0, rng.next() * TAU, 0]);
        B.add(MM.pebble, g, { color: rng.pick(PEBBLE_TINTS), cast: r > 0.25 });
        const m = mossGeo(rng, { r: r * 0.7, h: 0.05 });
        xf(m, [x, top + r * 0.5, z], [0, rng.next() * TAU, 0]);
        B.add(MM.moss, m, { color: '#6f8f3a', cast: false });
      }
    }
  }
  // reeds and cattails crowd the log's upstream face, and the hollow just below it
  for (const u of [-2.0, -1.3, 1.2, 1.9]) {
    const [x, z] = at(u, -0.55 + rng.jitter(0.15));
    reedClump(x, z, rng.int(7, 11));
  }
  for (const u of [-1.6, 1.7]) {
    const [x, z] = at(u, 0.85);
    reedClump(x, z, rng.int(6, 9));
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
      B.add(MM.lily, g.translate(x, y, z), { cast: false });
    }
  };
  const pink = rng.pick(['#f2a0b8', '#f7c3d2', '#fff1f4', '#e98aa8']);
  petals(8, 0.13, 0.055, 0.35, rng.next(), pink);
  petals(6, 0.1, 0.045, 0.85, rng.next(), pink);
  B.add(MM.lily, new THREE.SphereGeometry(0.045 * s, 8, 6).scale(1, 0.6, 1).translate(x, y + 0.04 * s, z), { color: '#efc85a', cast: false });
}

export function buildPond(ctx, B, rng) {
  const MM = M();
  const group = new THREE.Group();
  group.name = 'pond';
  ctx.scene.add(group);
  const density = Math.max(0.5, ctx.quality?.density ?? 1);

  // ── lily pads (+ flowers) across the calm water ──
  const spots = [];
  const lilies = [];
  for (let tries = 0; tries < 900 && spots.length < Math.round(34 * density); tries++) {
    const a = rng.next() * TAU, d = Math.sqrt(rng.next()) * POND.radius * 1.15;
    const x = POND.x + (Math.cos(a) * d) / 0.9, z = POND.z + Math.sin(a) * d;
    const dep = depthAt(x, z);
    if (dep < 0.12 || calmAt(x, z) < 0.3 || nearJetty(x, z, 0.3)) continue;
    // leave the duck lane and the candle boats' lane free
    const lane = Math.hypot((x - POND.x - 0.4) / 1.2, z - POND.z);
    if (Math.abs(lane - 2.5) < 0.55 || Math.abs(lane - BOAT_LANE) < 0.42) continue;
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
    if (rng.chance(0.3)) {
      const fx = sp.x + rng.jitter(sp.s * 0.3), fz = sp.z + rng.jitter(sp.s * 0.3);
      addLilyFlower(B, fx, WL + 0.03, fz, rng.range(0.8, 1.15), rng);
      lilies.push({ x: fx, y: WL + 0.08, z: fz, size: 0.3 });
    }
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
  const ducks = makeDucks(group, !!ctx.engine?.reducedMotion);
  // ── little leaf boats carrying candles, drifting round the middle of the pond ──
  const boats = makeCandleBoats(ctx, group, rng);

  return {
    group,
    lantern: group.userData.lantern ?? null,
    /** Water-lily blossoms (world) — for their soft night halos. */
    lilies,
    /** The candle flames (world, updated every frame) — mirrored in the water at night. */
    flames: boats.flames,
    update(dt, t) {
      frog?.update(t);
      ducks.update(t);
      boats.update(t);
    },
  };
}

/**
 * Candle boats: curled autumn leaves with a stub of candle each, drifting a
 * slow loop round the middle of the pond (a lane kept free of lily pads), the
 * flames flickering. Two instanced meshes (leaf + candle, flame) and ONE halo
 * mesh whose quads follow the boats.
 */
const BOAT_LANE = 1.25;
function makeCandleBoats(ctx, parent, rng) {
  const MM = M();
  const N = 3;
  // the leaf: an outer and an inner shell (a little bowl, pointed at both ends,
  // its rim curling up), a midrib, a curled stalk at the stern, and the candle
  const parts = [];
  const leafCol = ['#d9822b', '#c4562a', '#e0a83a'];
  const shell = (inner) => {
    const g = new THREE.SphereGeometry(1, 14, 6, 0, TAU, Math.PI / 2, Math.PI / 2);
    deform(g, (v) => {
      // pointed bow & stern: narrow the bowl towards the ends
      const k = 1 - Math.pow(Math.abs(v.z), 1.6) * 0.55;
      v.x *= k;
      v.y *= 1 - Math.abs(v.z) * 0.35;
    });
    g.scale(0.085, 0.05, 0.16);
    if (inner) {
      g.scale(0.9, 0.82, 0.92);
      g.translate(0, 0.004, 0);
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
      g.computeVertexNormals();
    }
    return g;
  };
  const geos = [];
  {
    const outer = shell(false);
    paint(outer, '#b9652a');
    const inner = shell(true);
    paintLeaf(inner, '#e09a3c', '#f2c062');
    const rib = rod([0, -0.03, -0.15], [0, -0.03, 0.15], 0.004, 0.003, 3);
    paint(rib, '#f4d48a');
    const stalk = tube([new THREE.Vector3(0, -0.01, -0.15), new THREE.Vector3(0, 0.01, -0.2), new THREE.Vector3(0, 0.045, -0.21), new THREE.Vector3(0, 0.05, -0.18)], 0.006, 4, 8);
    paint(stalk, '#7a5a32');
    const candle = new THREE.CylinderGeometry(0.022, 0.024, 0.07, 10).translate(0, -0.005, 0.01);
    paint(candle, '#f3e8cf');
    const drip = new THREE.SphereGeometry(0.026, 10, 4, 0, TAU, 0, Math.PI / 2).scale(1, 0.35, 1).translate(0, 0.028, 0.01);
    paint(drip, '#fbf3df');
    const wick = new THREE.CylinderGeometry(0.0025, 0.0025, 0.018, 4).translate(0, 0.04, 0.01);
    paint(wick, '#2b1d14');
    geos.push(outer, inner, rib, stalk, candle, drip, wick);
  }
  for (const g of geos) {
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  }
  const hull = new THREE.InstancedMesh(mergeGeometries(geos, false), MM.vc, N);
  hull.name = 'candle-boats';
  hull.castShadow = false;
  hull.frustumCulled = false;
  const flameGeo = new THREE.SphereGeometry(0.016, 8, 6).scale(1, 2.0, 1);
  deform(flameGeo, (v) => {
    // a teardrop: pinched towards the tip
    if (v.y > 0) {
      v.x *= 1 - v.y / 0.05;
      v.z *= 1 - v.y / 0.05;
    }
  });
  flameGeo.translate(0, 0.066, 0.01);
  const flames = new THREE.InstancedMesh(flameGeo, MM.lamp, N);
  flames.name = 'candle-flames';
  flames.castShadow = false;
  flames.frustumCulled = false;
  for (let i = 0; i < N; i++) hull.setColorAt?.(i, new THREE.Color('#ffffff').lerp(new THREE.Color(leafCol[i]), 0.25));
  parent.add(hull, flames);
  // halos: one quad per flame, moved with the boats
  const halo = ctx.props?.glowQuads?.(Array.from({ length: N }, () => ({ x: 0, y: 0, z: 0, size: 0.42 })), '#ffb35c', { day: 0.0, night: 0.62 });
  if (halo) {
    halo.frustumCulled = false;
    parent.add(halo);
  }
  const hp = halo?.geometry.attributes.position;
  const cx = POND.x + 0.4, cz = POND.z;
  const reduced = !!ctx.engine?.reducedMotion;
  const speed = reduced ? 0.012 : 0.04;
  const boats = Array.from({ length: N }, (_, i) => ({ a0: (i / N) * TAU + rng.jitter(0.4), wob: rng.next() * TAU, spin: rng.jitter(0.25), yaw: rng.next() * TAU }));
  const out = Array.from({ length: N }, () => new THREE.Vector3());
  const o = new THREE.Object3D();
  function update(t) {
    for (let i = 0; i < N; i++) {
      const b = boats[i];
      const a = b.a0 + t * speed;
      const r = BOAT_LANE * (1 + 0.1 * Math.sin(a * 3 + b.wob));
      const x = cx + Math.cos(a) * r * 1.2, z = cz + Math.sin(a) * r;
      const bob = reduced ? 0 : Math.sin(t * 1.9 + b.wob) * 0.006;
      o.position.set(x, WL + 0.028 + bob, z);
      o.rotation.set(reduced ? 0 : Math.sin(t * 1.3 + b.wob) * 0.05, b.yaw + t * b.spin, reduced ? 0 : Math.sin(t * 1.7 + b.wob * 2) * 0.05);
      o.scale.setScalar(1);
      o.updateMatrix();
      hull.setMatrixAt(i, o.matrix);
      // the flame flickers (a touch taller / shorter)
      const fl = reduced ? 1 : 1 + 0.12 * Math.sin(t * 13.0 + i * 2.1) * Math.sin(t * 7.3 + i);
      o.scale.set(1, fl, 1);
      o.updateMatrix();
      flames.setMatrixAt(i, o.matrix);
      out[i].set(0, 0.07, 0.01).applyMatrix4(o.matrix);
      if (hp) for (let k = 0; k < 4; k++) hp.setXYZ(i * 4 + k, out[i].x, out[i].y + 0.02, out[i].z);
    }
    hull.instanceMatrix.needsUpdate = true;
    flames.instanceMatrix.needsUpdate = true;
    if (hp) hp.needsUpdate = true;
  }
  update(0);
  return { flames: out, update };
}

/** Leaf colouring inside the boat: warm gold towards the middle, deeper at the rim. */
function paintLeaf(geo, edge, mid) {
  const a = new THREE.Color(edge), b = new THREE.Color(mid), c = new THREE.Color();
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const r = Math.min(1, Math.hypot(pos.getX(i) / 0.085, pos.getZ(i) / 0.16));
    c.copy(b).lerp(a, smooth01(r));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
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

function makeDucks(parent, reduced = false) {
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
    const mesh = new THREE.Mesh(hull, materials.standard('#ffffff', { vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
    mesh.castShadow = false;
    boat.add(mesh);
    boat.scale.setScalar(0.9);
  }
  group.add(boat);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  const boatState = { s0: 6, u: 0.3 };
  const cl = { x: 0, z: 0, dx: 0, dz: 1 }; // reused centre-line sample
  const start = 1.5, end = LENGTH - 0.5;
  const span = end - start;
  return {
    group,
    update(dt, t) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const s = start + ((it.s0 + t * it.speed) % span);
        const c = lineAt(s, cl);
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
        const c = lineAt(s, cl);
        const calm = calmAt(c.x, c.z);
        boat.position.set(c.x - c.dz * boatState.u * (1 + calm * 3), WL + 0.01 + Math.sin(t * 2.3) * 0.008, c.z + c.dx * boatState.u * (1 + calm * 3));
        boat.rotation.set(Math.sin(t * 1.7) * 0.06, Math.atan2(c.dx, c.dz) + Math.PI / 2 + Math.sin(t * 0.6) * 0.3, Math.sin(t * 2.1) * 0.05);
        const k = Math.min(1, (s - start) / 1.2, (end - s) / 1.2);
        boat.scale.setScalar(0.9 * Math.max(0.001, k));
      }
    },
  };
}
