// ─────────────────────────────────────────────────────────────────────────────
// makeBike(opts) — a procedural bicycle, built like a real one.
//
//   const bike = makeBike({ style: 'gravel', color: '#3f6b5a' });
//   group.add(bike.group);             // or pass { batch, matrix } to merge it
//   bike.setSpin(2, 0.6);              // wheel & crank speed (rad/s) — update(dt) turns them
//
// Styles
//   gravel   sloping diamond frame, flared drop bars, 40 mm tan-wall knobbly
//            tyres, disc brakes, bottle in a cage, a little frame bag
//   road     level top tube, slim tyres on deep carbon rims, rim brakes,
//            white bar tape
//   vintage  lugged step-through loop frame, swept-back bars with cork grips,
//            sprung leather saddle, chrome mudguards, chainguard, rear rack,
//            a dynamo headlamp that glows at night, a bell and a wicker
//            basket full of flowers
//
// Anatomy (all from real geometry, in metres, then scaled): 32-spoke wheels
// laced from flanged hubs to box-section rims, tyres, a chainring on a
// spider, crank arms & pedals, a cassette, a rear derailleur with its
// pulleys, the chain loop, fork, headset, stem, bars, seatpost and saddle.
//
// Conventions: origin on the ground under the bottom bracket, the bike runs
// along +X, the drive side (chain) faces +Z, wheels in the XY plane.
// Static parts merge per material (≈4 draw calls); with { spin: true } the
// wheels and cranks stay separate pivots that update(dt) turns.
//
// Returns { group, frontWheel, rearWheel, crank, setSpin(w, c), update(dt),
//           dims: { scale, wheelRadius, wheelbase, bbHeight, saddle, bars, frontAxle, rearAxle, length, height } }
// (dims positions are LOCAL to the group, already scaled).
//
// makeWheel(opts) builds one wheel (same options) — truing stands, wall hooks.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { materials } from '../../core/materials.js';
import { createRng } from '../../core/rng.js';
import { Batch, M, TAU, rod, tube, deform, IDENTITY } from './kit.js';

let BM = null;
/** Bike materials (shared, vertex-coloured). */
function bm() {
  if (BM) return BM;
  BM = {
    paint: M().glossy,
    metal: materials.standard('#ffffff', { vertexColors: true, metalness: 0.85, roughness: 0.32 }),
    rubber: materials.standard('#ffffff', { vertexColors: true, roughness: 0.88 }),
    soft: M().vc, // leather, bar tape, cork, bags
    glow: M().lamp,
  };
  return BM;
}

const STYLES = {
  gravel: { color: '#3f6b5a', accent: '#6b4a2e', rim: '#2b2a29', tyre: 0.021, wall: '#b8925e', tape: '#6b4a2e', saddle: '#3a2c22', knobs: true, disc: true, drops: 0.235, topRise: 0.06 },
  road: { color: '#b0392c', accent: '#f1ece2', rim: '#1d1d1f', tyre: 0.0135, wall: '#28241f', tape: '#f1ece2', saddle: '#1f1d1c', deep: true, drops: 0.21, topRise: 0.0 },
  vintage: { color: '#8fb3a2', accent: '#7a4a2a', rim: '#cfd3d4', tyre: 0.019, wall: '#e8dcc0', tape: '#7a4a2a', saddle: '#7a4a2a', fenders: true },
};

/**
 * Level of detail: 'full' for the hero bike, 'lite' for bikes in the
 * background (leaning on fences, hanging in the shop), 'mini' for the toy
 * bike on the weathervane. Set per build (builds are synchronous).
 */
const LODS = {
  full: { rim: [6, 56], tyre: [8, 72], knobs: true, spokes: 32, saddle: [20, 10], chain: [90, 4], bar: [8, 30], tube: 10, loop: 28, cables: true, cassette: 8, ring: 40, petal: [6, 4] },
  lite: { rim: [3, 28], tyre: [5, 32], knobs: false, spokes: 16, saddle: [10, 6], chain: [44, 3], bar: [5, 14], tube: 6, loop: 14, cables: false, cassette: 3, ring: 18, petal: [4, 2] },
  mini: { rim: [3, 16], tyre: [3, 18], knobs: false, spokes: 6, saddle: [6, 4], chain: [0, 0], bar: [4, 8], tube: 4, loop: 8, cables: false, cassette: 0, ring: 10, petal: [4, 2] },
};
let LOD = LODS.full;
const lodOf = (opts) => LODS[opts.detail] ?? (opts.lite ? LODS.lite : LODS.full);

const RW = 0.34; // wheel radius incl. tyre (700c-ish)
const RIM = 0.305;
const BB = [0, 0.275, 0];
const REAR = [-0.415, RW, 0];
const FRONT = [0.6, RW, 0];

// ─── wheel ───────────────────────────────────────────────────────────────────
/**
 * Build one wheel into batch frame F (centre at origin, in the XY plane).
 * Parts: rim (metal), spokes + hub (metal), tyre (rubber), optional rotor / cassette.
 */
function buildWheel(F, s, rng, { rear = false, drive = true } = {}) {
  const B = bm();
  const L = LOD;
  const rimDepth = s.deep ? 0.045 : 0.02;
  // rim: box section (a flattened torus) + a braking track
  const rim = new THREE.TorusGeometry(RIM - rimDepth * 0.4, 0.011, L.rim[0], L.rim[1]);
  rim.scale(1, 1, 1.2);
  if (s.deep) {
    // deep carbon section: scale the inner half of the torus inward
    deform(rim, (v) => {
      const r = Math.hypot(v.x, v.y);
      const k = r < RIM - rimDepth * 0.4 ? (RIM - rimDepth) / (RIM - rimDepth * 0.4) : 1;
      v.x *= k;
      v.y *= k;
    });
  }
  F.add(B.metal, rim, { color: s.rim, cast: false });
  // tyre: tread + sidewalls (gumwall colour)
  const tr = s.tyre;
  const tyre = new THREE.TorusGeometry(RW - tr, tr, L.tyre[0], L.tyre[1]);
  const tread = new THREE.Color('#2a2622'), wall = new THREE.Color(s.wall);
  const col = new Float32Array(tyre.attributes.position.count * 3);
  const p = tyre.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getY(i));
    const c = r > RW - tr * 0.55 ? tread : wall;
    col.set([c.r, c.g, c.b], i * 3);
  }
  tyre.setAttribute('color', new THREE.BufferAttribute(col, 3));
  F.add(B.rubber, tyre, { cast: false });
  if (s.knobs && L.knobs) {
    // knobbly tread: little blocks around the crown
    const n = 64;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      for (const zz of i % 2 ? [-0.01, 0.01] : [0]) {
        const k = new THREE.BoxGeometry(0.008, 0.006, 0.009);
        k.translate(0, RW - 0.001, zz);
        k.rotateZ(a);
        F.add(B.rubber, k, { color: '#2a2622', cast: false });
      }
    }
  }
  // hub with flanges
  const hubW = rear ? 0.13 : 0.1;
  F.add(B.metal, new THREE.CylinderGeometry(0.018, 0.018, hubW, L.tube, 1, L !== LODS.full).rotateX(Math.PI / 2), { color: '#c9cdd0', cast: false });
  for (const zz of [-0.032, 0.032]) F.add(B.metal, new THREE.CylinderGeometry(0.03, 0.03, 0.004, L.ring > 20 ? 14 : 8).rotateX(Math.PI / 2).translate(0, 0, zz), { color: '#d5d9dc', cast: false });
  // 32 spokes, two-cross-ish lacing (alternating leading / trailing)
  const nS = L.spokes;
  for (let i = 0; i < nS; i++) {
    const side = i % 2 ? 1 : -1;
    const a = (i / nS) * TAU;
    const trail = (Math.floor(i / 2) % 2 ? 1 : -1) * 0.42;
    const h = [Math.cos(a + trail) * 0.027, Math.sin(a + trail) * 0.027, side * 0.032];
    const r = [Math.cos(a) * (RIM - rimDepth * 0.8), Math.sin(a) * (RIM - rimDepth * 0.8), side * 0.004];
    F.add(B.metal, rod(h, r, 0.0028 * (nS < 20 ? 1.3 : 1), 0.0028 * (nS < 20 ? 1.3 : 1), 3, true), { color: '#d9dcdf', cast: false });
  }
  // valve
  F.add(B.metal, new THREE.CylinderGeometry(0.003, 0.003, 0.03, 4).translate(0, -(RIM - 0.02), 0), { color: '#b9a46a', cast: false });
  if (s.disc && !drive && L !== LODS.mini) {
    // brake rotor on the non-drive side
    const ro = new THREE.RingGeometry(0.05, 0.08, 24, 1).translate(0, 0, 0);
    ro.translate(0, 0, -0.05);
    F.add(B.metal, ro, { color: '#bfc3c6', cast: false });
    F.add(B.metal, new THREE.RingGeometry(0.05, 0.08, 24, 1).rotateY(Math.PI).translate(0, 0, -0.051), { color: '#bfc3c6', cast: false });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      F.add(B.metal, rod([0, 0, -0.05], [Math.cos(a) * 0.052, Math.sin(a) * 0.052, -0.05], 0.004, 0.004, 3), { color: '#2b2b2b', cast: false });
    }
  }
  if (rear) {
    // cassette (drive side)
    for (let k = 0; k < L.cassette; k++) {
      const r = 0.05 - k * (0.028 / L.cassette);
      F.add(B.metal, new THREE.CylinderGeometry(r, r, 0.002 * (8 / L.cassette), L.ring > 20 ? 18 : 10).rotateX(Math.PI / 2).translate(0, 0, 0.022 + k * (0.034 / L.cassette)), { color: k % 2 ? '#b8bcbf' : '#9ea2a5', cast: false });
    }
  }
}

/**
 * A single wheel. opts: { style, scale, rear, batch, matrix } — returns a Group
 * (empty if merged into a batch).
 */
export function makeWheel(opts = {}) {
  const s = { ...STYLES[opts.style] ?? STYLES.gravel, ...(opts.rim ? { rim: opts.rim } : {}) };
  const scale = opts.scale ?? 0.66;
  const rng = createRng(String(opts.seed ?? 'wheel'));
  LOD = lodOf(opts);
  const g = new THREE.Group();
  g.name = 'wheel';
  const S = new THREE.Matrix4().makeScale(scale, scale, scale);
  if (opts.batch) {
    buildWheel(castPolicy(opts.batch.at((opts.matrix ?? IDENTITY).clone().multiply(S))), s, rng, { rear: !!opts.rear, drive: true });
    LOD = LODS.full;
    return g;
  }
  const P = new Batch('wheel');
  buildWheel(castPolicy(P.at(S)), s, rng, { rear: !!opts.rear, drive: false });
  LOD = LODS.full;
  P.build(g, 'wheel');
  g.userData.radius = RW * scale;
  return g;
}

// ─── frame, fork, cockpit, drivetrain ───────────────────────────────────────
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function geometryOf(style) {
  // steering axis (72° head angle) and fork rake
  const ha = THREE.MathUtils.degToRad(style === 'vintage' ? 69 : 72);
  const sAx = [-Math.cos(ha), Math.sin(ha), 0];
  const nFwd = [Math.sin(ha), Math.cos(ha), 0];
  const rake = style === 'vintage' ? 0.06 : 0.045;
  const axisPt = add(FRONT, nFwd, -rake);
  const forkLen = 0.37;
  const htBot = add(axisPt, sAx, forkLen);
  const htTop = add(htBot, sAx, style === 'road' ? 0.14 : 0.16);
  const sa = THREE.MathUtils.degToRad(73);
  const stDir = [-Math.cos(sa), Math.sin(sa), 0];
  const stLen = style === 'gravel' ? 0.5 : style === 'road' ? 0.54 : 0.5;
  const stTop = add(BB, stDir, stLen);
  return { sAx, nFwd, axisPt, htBot, htTop, stDir, stTop };
}

function buildFrame(F, s, style, rng, G) {
  const B = bm();
  const paint = s.color;
  const tR = (r) => r * 1.25; // a touch chunky — reads better at miniature size
  const T = (a, b, r1, r2 = r1, c = paint, mat = B.paint) => F.add(mat, rod(a, b, tR(r1), tR(r2), LOD.tube, LOD !== LODS.full), { color: c });
  const { htBot, htTop, stTop } = G;
  // head tube
  T(add(htBot, G.sAx, -0.015), add(htTop, G.sAx, 0.01), 0.019);
  if (style === 'vintage') {
    // step-through loop frame: a curved main tube + a parallel lower tube, lugs in chrome
    const mainCurve = [add(htTop, G.sAx, -0.03), [0.25, 0.6, 0], [0.04, 0.36, 0], add(BB, [0.01, 0.01, 0])];
    F.add(B.paint, tube(mainCurve.map(v3), tR(0.018), LOD.tube, LOD.loop), { color: paint });
    const lowCurve = [add(htBot, G.sAx, 0.02), [0.26, 0.47, 0], [0.08, 0.3, 0], add(BB, [0.03, -0.005, 0])];
    F.add(B.paint, tube(lowCurve.map(v3), tR(0.015), LOD.tube, LOD.loop), { color: paint });
    // chrome lugs at the head tube
    for (const p of [add(htTop, G.sAx, -0.02), add(htBot, G.sAx, 0.03)]) F.add(B.metal, new THREE.SphereGeometry(tR(0.024), 10, 8).translate(...p), { color: '#d8dcdf' });
  } else {
    // diamond: top tube (sloping for gravel), down tube
    const ttFront = add(htTop, G.sAx, -0.025);
    const ttRear = add(stTop, G.stDir, -(s.topRise ?? 0) - 0.02);
    T(ttFront, ttRear, 0.0135, 0.013);
    T(add(htBot, G.sAx, 0.02), add(BB, [0.01, 0.01, 0]), 0.02, 0.019);
  }
  // seat tube
  T(add(BB, [0, -0.01, 0]), stTop, 0.016);
  // bottom bracket shell
  F.add(B.paint, new THREE.CylinderGeometry(tR(0.021), tR(0.021), 0.075, 12).rotateX(Math.PI / 2).translate(...BB), { color: paint });
  // chainstays & seatstays (pairs)
  for (const zz of [-1, 1]) {
    const drop = add(REAR, [0.0, 0.0, zz * 0.062]);
    T(add(BB, [-0.02, 0, zz * 0.03]), drop, 0.0105, 0.008);
    T(add(stTop, G.stDir, -0.035 + 0.0), drop, 0.009, 0.0075);
    // dropout plate
    F.add(B.paint, new THREE.BoxGeometry(0.03, 0.04, 0.006).translate(drop[0] + 0.006, drop[1] - 0.004, drop[2]), { color: paint });
  }
  // fork: crown + two blades to the axle (curved for vintage)
  const crown = add(htBot, G.sAx, -0.03);
  F.add(B.paint, new THREE.BoxGeometry(0.035, 0.022, 0.1).translate(...crown), { color: style === 'vintage' ? '#d8dcdf' : paint });
  for (const zz of [-1, 1]) {
    const tip = add(FRONT, [0, 0, zz * 0.052]);
    const top = add(crown, [0, -0.005, zz * 0.045]);
    const mid = lerp3(top, tip, 0.6);
    const bow = style === 'vintage' ? add(mid, G.nFwd, 0.025) : add(mid, G.nFwd, 0.008);
    F.add(B.paint, tube([v3(top), v3(bow), v3(tip)], tR(0.012), Math.min(8, LOD.tube), Math.min(12, LOD.loop)), { color: paint });
  }
  // steerer / headset spacers above the head tube
  F.add(B.metal, rod(htTop, add(htTop, G.sAx, 0.035), 0.017, 0.017, 10), { color: '#2b2b2b' });
}

function buildCockpit(F, s, style, rng, G) {
  const B = bm();
  const top = add(G.htTop, G.sAx, 0.04);
  let clamp;
  if (style === 'vintage') {
    // quill stem rising, then a short forward extension
    const q = add(top, G.sAx, 0.07);
    F.add(B.metal, rod(G.htTop, q, 0.012, 0.012, 8), { color: '#d8dcdf' });
    clamp = add(q, [0.05, 0.01, 0]);
    F.add(B.metal, rod(q, clamp, 0.011, 0.011, 8), { color: '#d8dcdf' });
    // swept-back bars
    for (const zz of [-1, 1]) {
      const pts = [clamp, add(clamp, [0.0, 0.0, zz * 0.12]), add(clamp, [-0.07, 0.03, zz * 0.24]), add(clamp, [-0.17, 0.035, zz * 0.27])];
      F.add(B.metal, tube(pts.map(v3), 0.0105, LOD.bar[0], Math.round(LOD.bar[1] * 0.6)), { color: '#d8dcdf' });
      // cork grips
      F.add(B.soft, rod(add(clamp, [-0.09, 0.034, zz * 0.262]), add(clamp, [-0.19, 0.035, zz * 0.272]), 0.016, 0.016, 8), { color: '#c79a62' });
    }
    // bell
    F.add(B.metal, new THREE.SphereGeometry(0.024, 12, 6, 0, TAU, 0, Math.PI / 2).translate(clamp[0] - 0.01, clamp[1] + 0.014, clamp[2] + 0.12), { color: '#e6c25a' });
  } else {
    // threadless stem forward & slightly up
    clamp = add(top, [0.095, 0.015, 0]);
    F.add(B.metal, rod(add(top, [-0.01, 0, 0]), clamp, 0.016, 0.014, 10), { color: '#2b2b2b' });
    F.add(B.metal, new THREE.CylinderGeometry(0.017, 0.017, 0.045, 10).rotateX(Math.PI / 2).translate(...clamp), { color: '#2b2b2b' });
    // drop bars with bar tape, hoods and levers
    const half = s.drops ?? 0.22;
    for (const zz of [-1, 1]) {
      const flare = style === 'gravel' ? 0.035 : 0.0;
      const pts = [
        add(clamp, [0, 0, zz * 0.02]),
        add(clamp, [0.0, 0, zz * half * 0.85]),
        add(clamp, [0.055, -0.005, zz * half]),
        add(clamp, [0.085, -0.05, zz * (half + flare * 0.4)]),
        add(clamp, [0.06, -0.115, zz * (half + flare)]),
        add(clamp, [-0.025, -0.13, zz * (half + flare)]),
      ];
      F.add(B.soft, tube(pts.map(v3), 0.0125, LOD.bar[0], LOD.bar[1]), { color: s.tape });
      // hood + lever
      const hood = add(clamp, [0.07, 0.012, zz * half]);
      F.add(B.soft, new THREE.CapsuleGeometry(0.014, 0.035, 4, 8).rotateZ(Math.PI / 2 - 0.4).translate(...hood), { color: '#1f1e1d' });
      F.add(B.metal, tube([v3(add(hood, [0.02, 0.0, 0])), v3(add(hood, [0.035, -0.06, 0])), v3(add(hood, [0.02, -0.11, 0]))], 0.0055, 5, 8), { color: '#3a3a3a' });
    }
    // cables looping to the frame
    for (const zz of LOD.cables ? [-1, 1] : []) {
      const a = add(clamp, [0.07, 0.0, zz * (s.drops ?? 0.22) * 0.9]);
      F.add(B.soft, tube([v3(a), v3(add(clamp, [0.08, -0.08, zz * 0.08])), v3(add(G.htBot, [0.03, 0.02, zz * 0.03])), v3(add(G.htBot, [-0.04, -0.03, zz * 0.02]))], 0.0035, 4, 16), { color: '#1c1c1c' });
    }
  }
  return clamp;
}

function buildSeat(F, s, style, rng, G) {
  const B = bm();
  const postTop = add(G.stTop, G.stDir, style === 'vintage' ? 0.12 : 0.16);
  F.add(B.metal, rod(add(G.stTop, G.stDir, -0.02), postTop, 0.0135, 0.0135, 10), { color: style === 'vintage' ? '#d8dcdf' : '#2b2b2b' });
  // seat clamp
  F.add(B.metal, new THREE.TorusGeometry(0.02, 0.005, 5, 12).rotateX(Math.PI / 2).translate(...add(G.stTop, G.stDir, 0.005)), { color: '#3a3a3a' });
  // saddle: tapered, slightly domed
  const L = style === 'vintage' ? 0.25 : 0.27;
  const sad = new THREE.SphereGeometry(1, LOD.saddle[0], LOD.saddle[1]);
  deform(sad, (v) => {
    const t = (v.x + 1) / 2; // 0 back → 1 nose
    const w = style === 'vintage' ? 0.1 - 0.06 * t * t : 0.072 - 0.05 * Math.pow(t, 1.6);
    v.set(v.x * L * 0.5, v.y * (v.y > 0 ? 0.03 : 0.018) + (1 - t) * 0.012 - t * 0.004, v.z * w);
  });
  const seat = add(postTop, [0.0, style === 'vintage' ? 0.075 : 0.035, 0]);
  sad.translate(seat[0] + 0.01, seat[1], seat[2]);
  F.add(B.soft, sad, { color: s.saddle });
  // rails / springs
  if (LOD === LODS.mini) {
    // (the toy bike on the weathervane has no saddle rails)
  } else if (style === 'vintage') {
    for (const zz of [-1, 1]) {
      for (let k = 0; k < 5; k++) F.add(B.metal, new THREE.TorusGeometry(0.014, 0.0035, 4, 10).rotateX(Math.PI / 2).translate(seat[0] - 0.08, seat[1] - 0.025 - k * 0.009, zz * 0.055), { color: '#cfd3d6', cast: false });
      F.add(B.metal, rod([seat[0] - 0.08, seat[1] - 0.07, zz * 0.055], [postTop[0] + 0.01, postTop[1] + 0.005, 0], 0.004, 0.004, 4), { color: '#cfd3d6', cast: false });
      F.add(B.metal, rod([seat[0] + 0.1, seat[1] - 0.02, zz * 0.01], [postTop[0] + 0.01, postTop[1] + 0.005, zz * 0.01], 0.004, 0.004, 4), { color: '#cfd3d6', cast: false });
    }
  } else {
    for (const zz of [-1, 1]) F.add(B.metal, rod([seat[0] - 0.08, seat[1] - 0.02, zz * 0.022], [seat[0] + 0.09, seat[1] - 0.015, zz * 0.012], 0.0035, 0.0035, 4), { color: '#3a3a3a', cast: false });
  }
  return seat;
}

/** Chain loop, front derailleur-free 1x/2x look, rear derailleur. */
function buildDrive(F, s, style, rng) {
  const B = bm();
  const z = 0.045;
  const rRing = 0.095, rCog = 0.04;
  // chain: top run, wrap around the cog, down through the derailleur pulleys, back to the ring
  const dx = REAR[0] - BB[0], dy = REAR[1] - BB[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const pts = [];
  // ring top tangent → cog top tangent
  for (let i = 0; i <= 6; i++) {
    const a = Math.atan2(ny, nx) + (i / 6) * Math.PI * 0.95;
    pts.push(v3([REAR[0] + Math.cos(a) * rCog, REAR[1] + Math.sin(a) * rCog, z + 0.012]));
  }
  const pulley1 = [REAR[0] + 0.01, REAR[1] - 0.075, z + 0.012];
  const pulley2 = [REAR[0] + 0.035, REAR[1] - 0.135, z + 0.012];
  pts.push(v3(add(pulley1, [-0.012, -0.004, 0])), v3(add(pulley2, [0.006, -0.012, 0])));
  for (let i = 0; i <= 10; i++) {
    const a = Math.atan2(-ny, -nx) + (i / 10) * Math.PI * 1.0;
    pts.push(v3([BB[0] + Math.cos(a) * rRing, BB[1] + Math.sin(a) * rRing, z]));
  }
  if (LOD.chain[0] === 0) return;
  F.add(B.metal, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'centripetal'), LOD.chain[0], 0.0042 * (LOD === LODS.full ? 1 : 1.2), LOD.chain[1], true), { color: '#4a4744', cast: false });
  // rear derailleur: cage plates + pulleys + body
  for (const p of [pulley1, pulley2]) F.add(B.metal, new THREE.CylinderGeometry(0.012, 0.012, 0.006, 10).rotateX(Math.PI / 2).translate(...p), { color: '#2d2d2d', cast: false });
  F.add(B.metal, new THREE.BoxGeometry(0.016, 0.085, 0.004).rotateZ(-0.35).translate(REAR[0] + 0.022, REAR[1] - 0.105, z + 0.02), { color: '#3a3a3a', cast: false });
  F.add(B.metal, new THREE.BoxGeometry(0.03, 0.022, 0.016).rotateZ(0.5).translate(REAR[0] - 0.005, REAR[1] - 0.035, z + 0.02), { color: '#4a4a4a', cast: false });
  if (style === 'vintage') {
    // chainguard over the top run
    const cg = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      cg.push(v3([BB[0] + 0.11 - t * 0.5, BB[1] + 0.105 + t * 0.03 - Math.sin(t * Math.PI) * 0.0, z + 0.03]));
    }
    const plate = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cg), 20, 0.022, 6, false);
    plate.scale(1, 1, 0.35);
    plate.translate(0, 0, (z + 0.03) * 0.65);
    F.add(B.paint, plate, { color: s.color, cast: false });
  }
}

/** Crank set at the origin of frame F (bottom bracket centre). */
function buildCrank(F, s, style) {
  const B = bm();
  const z = 0.045;
  // chainring + spider
  F.add(B.metal, new THREE.TorusGeometry(0.093, 0.005, LOD === LODS.full ? 4 : 3, LOD.ring).translate(0, 0, z), { color: '#2e2e2e', cast: false });
  F.add(B.metal, new THREE.CylinderGeometry(0.098, 0.098, 0.0025, LOD.ring, 1, true).rotateX(Math.PI / 2).translate(0, 0, z), { color: '#3a3a3a', cast: false });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    F.add(B.metal, rod([0, 0, z], [Math.cos(a) * 0.088, Math.sin(a) * 0.088, z], 0.009, 0.006, 4), { color: style === 'vintage' ? '#d8dcdf' : '#2b2b2b', cast: false });
  }
  // spindle
  F.add(B.metal, new THREE.CylinderGeometry(0.01, 0.01, 0.14, 8).rotateX(Math.PI / 2), { color: '#9ea2a5', cast: false });
  // arms + pedals (opposite)
  const armC = style === 'vintage' ? '#d8dcdf' : '#2b2b2b';
  for (const side of [1, -1]) {
    const zz = side * 0.068;
    const tip = [0, -side * 0.17, zz];
    F.add(B.metal, rod([0, 0, zz], tip, 0.012, 0.009, 6), { color: armC, cast: false });
    const ped = new THREE.BoxGeometry(0.075, 0.016, 0.09);
    ped.translate(tip[0], tip[1], tip[2] + side * 0.055);
    F.add(B.metal, ped, { color: style === 'vintage' ? '#3a3632' : '#2a2a2a', cast: false });
  }
}

function buildAccessories(F, s, style, rng, G, clamp, seat) {
  const B = bm();
  if (style === 'gravel') {
    // bottle cage + bottle on the down tube
    const a = lerp3(G.htBot, BB, 0.42), b = lerp3(G.htBot, BB, 0.72);
    const d = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)).normalize();
    const off = [-d.y * 0.04, d.x * 0.04, 0];
    F.add(B.soft, rod(add(a, off), add(b, off), 0.032, 0.032, 12), { color: '#d9a441' });
    F.add(B.soft, rod(add(b, off), add(add(b, off), [d.x, d.y, 0], 0.03), 0.016, 0.012, 8), { color: '#2b2b2b' });
    F.add(B.metal, rod(add(a, off, 0.5), add(b, off, 0.5), 0.004, 0.004, 4), { color: '#3a3a3a', cast: false });
    // frame bag: a soft triangle in the main triangle
    const shape = new THREE.Shape();
    const p0 = lerp3(G.htTop, G.stTop, 0.08), p1 = lerp3(G.htTop, G.stTop, 0.82), p2 = lerp3(G.htBot, BB, 0.32);
    shape.moveTo(p0[0], p0[1] - 0.02);
    shape.lineTo(p1[0], p1[1] - 0.025);
    shape.lineTo(p2[0] - 0.02, p2[1] + 0.05);
    shape.lineTo(p0[0], p0[1] - 0.02);
    const bag = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 1 });
    bag.translate(0, 0, -0.025);
    F.add(B.soft, bag, { color: '#4e5b3a' });
    // a zip line
    F.add(B.soft, rod([p0[0] - 0.02, p0[1] - 0.05, 0.039], [p1[0] + 0.06, p1[1] - 0.06, 0.039], 0.003, 0.003, 3), { color: '#c9b27a', cast: false });
    // saddle bag
    F.add(B.soft, new THREE.CapsuleGeometry(0.035, 0.09, 4, 10).rotateZ(Math.PI / 2 + 0.25).translate(seat[0] - 0.15, seat[1] - 0.05, 0), { color: '#6b4a2e' });
  }
  if (style === 'road') {
    // rim brake calipers + a bottle
    for (const [ax, top] of [[FRONT, G.htBot], [REAR, G.stTop]]) {
      const p = [ax[0] + (top === G.htBot ? -0.03 : 0.03), 2 * RW + 0.012, 0];
      F.add(B.metal, new THREE.BoxGeometry(0.02, 0.03, 0.1).translate(...p), { color: '#2b2b2b', cast: false });
    }
    const a = lerp3(G.htBot, BB, 0.45), b = lerp3(G.htBot, BB, 0.75);
    F.add(B.soft, rod(add(a, [0.035, 0.03, 0]), add(b, [0.035, 0.03, 0]), 0.03, 0.03, 12), { color: '#f1ece2' });
  }
  if (style === 'gravel') {
    // disc calipers
    F.add(B.metal, new THREE.BoxGeometry(0.05, 0.03, 0.025).translate(FRONT[0] - 0.05, FRONT[1] + 0.05, -0.055), { color: '#2b2b2b', cast: false });
    F.add(B.metal, new THREE.BoxGeometry(0.05, 0.03, 0.025).translate(REAR[0] + 0.05, REAR[1] + 0.045, -0.06), { color: '#2b2b2b', cast: false });
  }
  if (style === 'vintage') {
    // chrome mudguards (partial tori over both wheels)
    for (const [ax, a0, a1] of [[FRONT, -0.35, 2.2], [REAR, 0.8, 3.55]]) {
      const g = new THREE.TorusGeometry(RW + 0.03, 0.02, 4, 30, a1 - a0);
      g.scale(1, 1, 1.6);
      g.rotateZ(a0);
      g.translate(ax[0], ax[1], 0);
      F.add(B.metal, g, { color: '#d8dcdf', cast: false });
      // stays
      for (const zz of [-1, 1]) F.add(B.metal, rod([ax[0], ax[1], zz * 0.05], [ax[0] + Math.cos((a0 + a1) / 2) * (RW + 0.03), ax[1] + Math.sin((a0 + a1) / 2) * (RW + 0.03), zz * 0.035], 0.003, 0.003, 3), { color: '#cfd3d6', cast: false });
    }
    // rear rack
    const rk = [REAR[0] - 0.02, REAR[1] + 0.3, 0];
    for (const zz of [-1, 1]) {
      F.add(B.metal, rod([REAR[0], REAR[1], zz * 0.065], add(rk, [0.0, 0, zz * 0.06]), 0.005, 0.005, 4), { color: '#cfd3d6', cast: false });
      F.add(B.metal, rod(add(rk, [-0.13, 0, zz * 0.06]), add(rk, [0.17, 0, zz * 0.06]), 0.005, 0.005, 4), { color: '#cfd3d6', cast: false });
    }
    F.add(B.metal, rod(add(rk, [0.17, 0, -0.06]), add(G.stTop, [-0.03, -0.03, 0]), 0.004, 0.004, 4), { color: '#cfd3d6', cast: false });
    // headlamp (glows at night)
    const lamp = add(G.htBot, [0.06, 0.03, 0]);
    F.add(B.metal, rod(add(lamp, [-0.04, 0, 0]), add(lamp, [0.02, 0, 0]), 0.026, 0.03, 12), { color: '#d8dcdf', cast: false });
    F.add(B.glow, new THREE.CircleGeometry(0.026, 14).rotateY(Math.PI / 2).translate(lamp[0] + 0.022, lamp[1], lamp[2]), { cast: false });
  }
}

/** Wicker basket with flowers on a small front rack; returns nothing. */
function buildBasket(F, s, rng, G, flowers) {
  const B = bm();
  const base = add(G.htBot, [0.1, 0.06, 0]);
  const w = 0.22, d = 0.3, h = 0.16;
  // woven walls: thin hoops with gaps between them, woven over the uprights
  for (let k = 0; k < 5; k++) {
    const y = base[1] + 0.02 + k * (h / 5.2);
    const g = new THREE.TorusGeometry(1, 0.08, 4, 22);
    g.rotateX(Math.PI / 2);
    g.scale(w * 0.5 * (1 + k * 0.03), 0.09, d * 0.5 * (1 + k * 0.03));
    g.translate(base[0] + w * 0.5, y, base[2]);
    F.add(B.soft, g, { color: k % 2 ? '#c49a5c' : '#a77c45' });
  }
  F.add(B.soft, new THREE.CylinderGeometry(1, 1, 0.012, 20).scale(w * 0.5, 1, d * 0.5).translate(base[0] + w * 0.5, base[1] + 0.006, base[2]), { color: '#8f6a3a' });
  // a dark inside so the weave reads, and a cloth lining peeking over the rim
  F.add(B.soft, new THREE.CylinderGeometry(1, 0.97, h * 0.92, 18, 1, true).scale(w * 0.47, 1, d * 0.47).translate(base[0] + w * 0.5, base[1] + h * 0.47, base[2]), { color: '#4e3a26', cast: false });
  // uprights
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    const x = base[0] + w * 0.5 + Math.cos(a) * w * 0.51, z = base[2] + Math.sin(a) * d * 0.51;
    F.add(B.soft, rod([x, base[1], z], [x * 1.0, base[1] + h, z], 0.005, 0.005, 3), { color: '#7d5a30', cast: false });
  }
  // handle-free rim
  F.add(B.soft, new THREE.TorusGeometry(1, 0.06, 5, 26).rotateX(Math.PI / 2).scale(w * 0.52, 0.012 / 0.06, d * 0.52).translate(base[0] + w * 0.5, base[1] + h, base[2]), { color: '#c79a5a' });
  // bracket to the head tube
  F.add(B.metal, rod(add(G.htBot, [0.01, 0.03, 0]), [base[0] + 0.02, base[1] + 0.02, 0], 0.005, 0.005, 4), { color: '#cfd3d6', cast: false });
  if (!flowers) return;
  // a bunch of flowers + leaves spilling over the rim
  const COLORS = ['#f29bb8', '#f2c14e', '#e86a5a', '#f4f0e6', '#b48fd6', '#ffb37a', '#7fa7e0'];
  const n = 22;
  for (let i = 0; i < n; i++) {
    const a = rng.next() * TAU, r = Math.sqrt(rng.next()) * 0.85;
    const x = base[0] + w * 0.5 + Math.cos(a) * w * 0.45 * r, z = base[2] + Math.sin(a) * d * 0.45 * r;
    const y = base[1] + h + rng.range(0.03, 0.12);
    F.add(B.soft, rod([x, base[1] + h * 0.5, z], [x + rng.jitter(0.03), y, z + rng.jitter(0.03)], 0.003, 0.003, 3), { color: '#4f7a34', cast: false });
    const c = rng.pick(COLORS);
    const fs = rng.range(0.03, 0.048);
    for (let p = 0; p < 5; p++) {
      const pa = (p / 5) * TAU + rng.next();
      F.add(B.soft, new THREE.SphereGeometry(fs * 0.55, LOD.petal[0], LOD.petal[1]).scale(1, 0.4, 0.6).translate(fs * 0.5, 0, 0).rotateY(pa).translate(x, y, z), { color: c, cast: false });
    }
    F.add(B.soft, new THREE.SphereGeometry(fs * 0.3, LOD.petal[0], LOD.petal[1]).translate(x, y + 0.006, z), { color: '#e8b33a', cast: false });
  }
  for (let i = 0; i < 12; i++) {
    const a = rng.next() * TAU;
    const x = base[0] + w * 0.5 + Math.cos(a) * w * 0.48, z = base[2] + Math.sin(a) * d * 0.48;
    const leaf = new THREE.SphereGeometry(0.03, LOD.petal[0], LOD.petal[1]).scale(1, 0.25, 0.45).translate(0.03, 0, 0);
    leaf.rotateZ(-0.6);
    leaf.rotateY(-a);
    F.add(B.soft, leaf.translate(x, base[1] + h + 0.01, z), { color: rng.pick(['#5f8f3f', '#6f9a45', '#4f7a34']), cast: false });
  }
}

/**
 * Shadow policy for bike parts: the painted frame and the soft goods cast,
 * the fine metal bits, tyres and the lamp don't (keeps a bike to ~4 meshes).
 */
function castPolicy(F) {
  const B = bm();
  return {
    add(material, geo, o = {}) {
      const cast = material === B.paint || material === B.soft;
      return F.add(material, geo, { ...o, cast });
    },
    at(m) {
      return castPolicy(F.at(m));
    },
  };
}

// ─── the bike ────────────────────────────────────────────────────────────────
let bikeCount = 0;
/**
 * @param {object} [opts]
 * @param {'gravel'|'road'|'vintage'} [opts.style='gravel']
 * @param {string} [opts.color]    frame colour
 * @param {string} [opts.tape]     bar tape / grips colour
 * @param {string} [opts.saddle]   saddle colour
 * @param {number} [opts.scale=0.66]
 * @param {boolean} [opts.basket]  wicker basket (vintage default true)
 * @param {boolean} [opts.flowers=true]
 * @param {boolean} [opts.spin=false]  keep wheels & cranks as separate pivots that update(dt) turns
 * @param {boolean} [opts.lite=false]  fewer segments, no tread knobs (bikes in the background)
 * @param {'full'|'lite'|'mini'} [opts.detail]  level of detail (overrides lite; 'mini' = toy-sized)
 * @param {boolean} [opts.spinFront=true]  with spin: false keeps the front wheel static (one pivot fewer)
 * @param {Batch} [opts.batch]     merge the static parts into this batch …
 * @param {THREE.Matrix4} [opts.matrix]  … placed by this matrix
 * @param {string|number} [opts.seed]
 */
export function makeBike(opts = {}) {
  const style = STYLES[opts.style] ? opts.style : 'gravel';
  const s = { ...STYLES[style] };
  if (opts.color) s.color = opts.color;
  if (opts.tape) s.tape = opts.tape;
  if (opts.saddle) s.saddle = opts.saddle;
  const scale = opts.scale ?? 0.66;
  const rng = createRng(String(opts.seed ?? `bike-${bikeCount++}`));
  const spin = !!opts.spin;
  const group = new THREE.Group();
  group.name = `bike-${style}`;
  const S = new THREE.Matrix4().makeScale(scale, scale, scale);
  const own = opts.batch ? null : new Batch('bike');
  LOD = lodOf(opts);
  const base = castPolicy(opts.batch ? opts.batch.at((opts.matrix ?? IDENTITY).clone().multiply(S)) : own.at(S));
  const G = geometryOf(style);

  buildFrame(base, s, style, rng, G);
  const clamp = buildCockpit(base, s, style, rng, G);
  const seat = buildSeat(base, s, style, rng, G);
  buildDrive(base, s, style, rng);
  buildAccessories(base, s, style, rng, G, clamp, seat);
  if (opts.basket ?? style === 'vintage') buildBasket(base, s, rng, G, opts.flowers ?? true);

  // wheels & crank: merged when static, pivots when spinning
  const pivots = {};
  const mk = (name, at, fn, still = false) => {
    if (!spin || still) {
      fn(base.at(new THREE.Matrix4().makeTranslation(at[0], at[1], at[2])));
      return null;
    }
    const pv = new THREE.Group();
    pv.name = name;
    pv.position.set(at[0] * scale, at[1] * scale, at[2] * scale);
    pv.scale.setScalar(scale);
    const P = new Batch(name);
    fn(castPolicy(P));
    P.build(pv, name);
    group.add(pv);
    return pv;
  };
  pivots.rear = mk('rear-wheel', REAR, (F) => buildWheel(F, s, rng, { rear: true, drive: true }));
  pivots.front = mk('front-wheel', FRONT, (F) => buildWheel(F, s, rng, { rear: false, drive: false }), opts.spinFront === false);
  pivots.crank = mk('crank', BB, (F) => buildCrank(F, s, style));
  LOD = LODS.full;

  if (own) own.build(group, `bike-${style}`);

  let wRate = 0, cRate = 0;
  const sc = (a) => new THREE.Vector3(a[0] * scale, a[1] * scale, a[2] * scale);
  return {
    group,
    frontWheel: pivots.front,
    rearWheel: pivots.rear,
    crank: pivots.crank,
    style,
    /** Wheel & crank angular speeds (rad/s, positive = rolling forward). */
    setSpin(wheel, crank = wheel * 0.4) {
      wRate = wheel;
      cRate = crank;
    },
    update(dt) {
      if (pivots.front) pivots.front.rotation.z -= wRate * dt;
      if (pivots.rear) pivots.rear.rotation.z -= wRate * dt;
      if (pivots.crank) pivots.crank.rotation.z -= cRate * dt;
    },
    dims: {
      scale,
      wheelRadius: RW * scale,
      wheelbase: (FRONT[0] - REAR[0]) * scale,
      bbHeight: BB[1] * scale,
      saddle: sc(seat),
      bars: sc(clamp),
      frontAxle: sc(FRONT),
      rearAxle: sc(REAR),
      length: (FRONT[0] - REAR[0] + 2 * RW) * scale,
      height: (seat[1] + 0.05) * scale,
    },
  };
}

/**
 * A bare frame, half built, for the frame jig: raw steel tubes with brass
 * fillets at the joints, no fork or parts, only the drive-side chainstay tacked
 * on — into opts.batch at opts.matrix (same frame coordinates as makeBike:
 * origin under the bottom bracket, along +X). Returns the scaled key points.
 */
export function makeBareFrame(opts = {}) {
  const scale = opts.scale ?? 0.6;
  const S = new THREE.Matrix4().makeScale(scale, scale, scale);
  const F = castPolicy(opts.batch.at((opts.matrix ?? IDENTITY).clone().multiply(S)));
  const B = bm();
  const steel = opts.color ?? '#9aa1a6', brass = opts.joint ?? '#c9a24a';
  const G = geometryOf('gravel');
  const T = (a, b, r) => F.add(B.paint, rod(a, b, r * 1.25, r * 1.25, 8, true), { color: steel });
  const ttFront = add(G.htTop, G.sAx, -0.025), ttRear = add(G.stTop, G.stDir, -0.08);
  const dtTop = add(G.htBot, G.sAx, 0.02);
  T(add(G.htBot, G.sAx, -0.015), add(G.htTop, G.sAx, 0.01), 0.019);
  T(ttFront, ttRear, 0.0135);
  T(dtTop, BB, 0.02);
  T(add(BB, [0, -0.01, 0]), add(G.stTop, G.stDir, 0.02), 0.016);
  T(add(BB, [-0.02, 0, 0.03]), add(REAR, [0, 0, 0.062]), 0.0105);
  F.add(B.paint, new THREE.CylinderGeometry(0.026, 0.026, 0.075, 10).rotateX(Math.PI / 2).translate(...BB), { color: steel });
  for (const p of [ttFront, ttRear, dtTop, add(BB, [0.012, 0.03, 0]), add(G.htTop, G.sAx, -0.01)]) {
    F.add(B.metal, new THREE.SphereGeometry(0.027, 8, 5).scale(1, 1, 0.9).translate(...p), { color: brass, cast: false });
  }
  const sc = (a) => new THREE.Vector3(a[0] * scale, a[1] * scale, a[2] * scale);
  return { bb: sc(BB), htTop: sc(G.htTop), htBot: sc(G.htBot), stTop: sc(G.stTop), rear: sc(REAR) };
}

export const BIKE_STYLES = Object.keys(STYLES);
