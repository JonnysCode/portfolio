// ─────────────────────────────────────────────────────────────────────────────
// Craft life in the Schreinerei yard. Everything here is static and lands in
// the shared Batch on materials the workshop already uses (wood, timber,
// metal, rope, bark, vc, moss): no extra draw calls.
//
//   addTrack(B, mats, rng, gh, pts, opts)   a bare, tamped-soil track with
//                                           ragged edges (stones sit in it)
//   addHandcart(F, mats, rng)               a Swiss Leiterwägeli: ladder sides,
//                                           spoked wheels with iron tyres, the
//                                           drawbar folded up, a load of rough
//                                           planks lashed on
//   addDowelBucket(F, mats, rng)            a coopered bucket of beech dowels
//                                           and oak pegs (Holznägel)
//   addOffcuts(F, mats, rng)                a heap of offcuts (Abschnitte)
//   addLeaningBoards(ctx, B, mats, rng, xs) rough waney-edged boards leaning
//                                           on the oak's bark
//   addBesom(F, mats, rng, foot, top)       a twig besom (Reisigbesen)
//
// Frames (F) are Batch views (B.at(matrix)) with the origin on the ground,
// +Z the object's front.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { board, xf, uvBox, tube, mossGeo, stoneGeo, noiseA, noiseB } from './kit.js';
import { barkMount } from './door.js';

const IRON = '#2f2b28';

/** A small square strut from a to b ([x,y,z]), for the cart's fork arms. */
function timberish(a, b, w = 0.04) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const g = new THREE.BoxGeometry(w, w, len);
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return uvBox(g, 'z');
}

// ─── the tamped-soil track ───────────────────────────────────────────────────
/**
 * A trodden, tamped-soil track along `pts` ([{x, z}] world), conformed to the
 * ground (`gh(x, z)`): one ribbon with a wavy, ragged outline (a worn, paler
 * middle, darker edges where the litter creeps in) plus a few loose soil
 * bites past the edges. opts: { width = 0.7, lift = 0.012, material (vertex-
 * coloured; default mats.vc()) }.
 * Returns dist(x, z): signed distance to the track's edge (< 0 = on it).
 */
export function addTrack(B, mats, rng, gh, pts, { width = 0.7, lift = 0.012, material = null } = {}) {
  const mat = material ?? mats.vc();
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p.x, 0, p.z)), false, 'centripetal');
  const len = curve.getLength();
  const n = Math.max(4, Math.ceil(len / 0.07));
  const across = [-1, -0.7, -0.42, -0.14, 0.14, 0.42, 0.7, 1];
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const seed = rng.next() * 50;
  const cMid = new THREE.Color('#8f7154');
  const cEdge = new THREE.Color('#5f4733');
  const cDust = new THREE.Color('#a08263');
  const c = new THREE.Color();
  const samples = [];
  const tan = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, tan);
    const nx = -tan.z, nz = tan.x;
    // the width breathes along the track and tapers into the litter at both ends
    const taper = Math.min(1, u / 0.08, (1 - u) / 0.08);
    const w = (width / 2) * (0.82 + 0.3 * noiseA(u * len * 1.7 + seed, 3.1)) * (0.35 + 0.65 * Math.sqrt(Math.max(0, taper)));
    samples.push({ x: p.x, z: p.z, w });
    for (const a of across) {
      // ragged outline: the outer vertices wander in and out
      const edge = Math.abs(a) > 0.9;
      const rag = edge ? 1 + 0.28 * noiseB(u * len * 4.3 + a * 7 + seed, a * 3) + rng.jitter(0.1) : 1;
      const x = p.x + nx * w * a * rag;
      const z = p.z + nz * w * a * rag;
      pos.push(x, gh(x, z) + lift + (edge ? -0.003 : 0), z);
      // pale where it's walked most, darker towards the edges, a little mottled
      const k = 1 - Math.abs(a);
      c.copy(cEdge).lerp(cMid, Math.min(1, k * 1.4));
      const m = noiseA(x * 3.1 + seed, z * 3.1) * 0.5 + 0.5;
      c.lerp(cDust, Math.max(0, m - 0.5) * k * 1.8);
      // finer grain: damp darker dents and dry pale scuffs
      const f = noiseB(x * 9.3 - seed, z * 9.3);
      c.multiplyScalar(0.9 + f * 0.1 + rng.next() * 0.1);
      col.push(c.r, c.g, c.b);
      uv.push(a * 0.5 + 0.5, u * len);
    }
  }
  const m = across.length;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < m - 1; k++) {
      const a = i * m + k, b = a + 1, d = a + m, e = d + 1;
      // (wound counter-clockwise seen from above: the ribbon faces up)
      idx.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  B.add(mat, g, { cast: false });
  // loose bites of bare soil past the edges (so the outline never reads as a stripe)
  for (let i = 0; i < Math.round(len * 1.6); i++) {
    const s = samples[rng.int(1, samples.length - 2)];
    const j = samples.indexOf(s);
    const q = samples[Math.min(samples.length - 1, j + 1)];
    const tx = q.x - s.x, tz = q.z - s.z;
    const tl = Math.hypot(tx, tz) || 1;
    const side = rng.next() < 0.5 ? -1 : 1;
    const off = s.w * rng.range(0.85, 1.25);
    const bx = s.x + (-tz / tl) * off * side, bz = s.z + (tx / tl) * off * side;
    B.add(mat, soilBite(rng, rng.range(0.07, 0.15), (x, z) => gh(bx + x, bz + z) + lift - 0.005, bx, bz), { cast: false });
  }
  // a few pebbles pressed into it
  for (let i = 0; i < Math.round(len * 2.2); i++) {
    const s = samples[rng.int(0, samples.length - 1)];
    const x = s.x + rng.jitter(s.w * 0.8), z = s.z + rng.jitter(s.w * 0.8);
    B.add(mats.stone(), xf(stoneGeo(rng, { r: rng.range(0.018, 0.04), sy: 0.45, detail: 0 }), [x, gh(x, z) + lift, z], [0, rng.next() * 6, 0]), { cast: false });
  }
  return (x, z) => {
    let best = Infinity;
    for (const s of samples) {
      const d = Math.hypot(x - s.x, z - s.z) - s.w;
      if (d < best) best = d;
    }
    return best;
  };
}

/** A flat, irregular disc of bare soil, its rim following the ground. */
function soilBite(rng, r, yAt, cx, cz) {
  const n = 9;
  const pos = [cx, yAt(0, 0), cz];
  const col = [];
  const c = new THREE.Color(rng.pick(['#5f4733', '#6a503a', '#735840']));
  col.push(c.r, c.g, c.b);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.7 + rng.next() * 0.5);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    pos.push(cx + x, yAt(x, z), cz + z);
    col.push(c.r * 0.92, c.g * 0.92, c.b * 0.92);
    idx.push(0, 1 + ((i + 1) % n), 1 + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ─── the handcart (Leiterwägeli) ─────────────────────────────────────────────
/**
 * A Swiss ladder-sided handcart, parked: bed of spruce boards on two long
 * beams, splayed ladder sides of ash rails and turned rungs, four spoked
 * wheels (bigger at the back) with iron tyres and hub caps, the drawbar
 * folded up against the load with its T-handle, a load of rough planks
 * (one still with its bark edge) lashed with rope, overhanging at the back.
 * ≈ 0.62 wide × 1.2 long (+ load overhang) × 0.95 tall. Origin on the
 * ground under the middle of the bed, +Z = front (drawbar).
 */
export function addHandcart(F, mats, rng) {
  const iron = mats.metal(IRON);
  const bedW = 0.4, bedL = 0.94, bedY = 0.33;
  const R1 = 0.19, R2 = 0.15; // rear & front wheels
  const zR = -0.3, zF = 0.31;
  const track = 0.29;
  // weathered, oiled wood (never the pale of fresh-planed stock: it sits in the sun)
  const bedWood = mats.wood('#94795a');
  const ash = mats.wood('#a3865f');
  const oak = mats.wood('#6f5238');
  // two long beams (Langbäume) and the axle bolsters
  for (const s of [-1, 1]) F.add(oak, board(0.05, 0.055, bedL + 0.06, { along: 'z', rng }).translate(s * 0.12, bedY - 0.045, 0));
  F.add(oak, board(track * 2 - 0.06, 0.065, 0.07, { along: 'x', rng }).translate(0, R1, zR));
  F.add(oak, board(0.16, Math.max(0.03, bedY - 0.07 - R1 - 0.03), 0.07, { along: 'x', rng }).translate(0, (bedY - 0.07 + R1 + 0.03) / 2, zR));
  F.add(oak, board(track * 2 - 0.08, 0.06, 0.07, { along: 'x', rng }).translate(0, R2, zF));
  // the front turntable (Drehschemel): a round block between bolster and bed
  F.add(oak, uvBox(new THREE.CylinderGeometry(0.075, 0.075, bedY - 0.07 - R2 - 0.03, 10), 'y').translate(0, (bedY - 0.07 + R2 + 0.03) / 2, zF));
  // iron axle stubs through the hubs
  for (const [z, r] of [[zR, R1], [zF, R2]]) F.add(iron, new THREE.CylinderGeometry(0.012, 0.012, track * 2 + 0.1, 6).rotateZ(Math.PI / 2).translate(0, r, z), { cast: false });
  // the bed: five boards along the length
  const nb = 5;
  for (let i = 0; i < nb; i++) {
    const w = bedW / nb;
    F.add(bedWood, board(w - 0.006, 0.022, bedL + rng.jitter(0.01), { along: 'z', rng, r: 0.004 }).translate(-bedW / 2 + w * (i + 0.5), bedY - 0.011, rng.jitter(0.006)), { color: rng.pick(['#94795a', '#8a6f52', '#9c8060']) });
  }
  // end boards (front & back)
  for (const z of [-bedL / 2 + 0.012, bedL / 2 - 0.012]) F.add(bedWood, board(bedW + 0.02, 0.13, 0.024, { along: 'x', rng }).translate(0, bedY + 0.065, z));
  // the ladder sides, splayed outwards (the classic V of a Leiterwagen)
  const splay = 0.26, sideH = 0.25;
  for (const s of [-1, 1]) {
    const L = new THREE.Matrix4().makeRotationZ(-s * splay).premultiply(new THREE.Matrix4().makeTranslation(s * (bedW / 2 + 0.005), bedY, 0));
    const add = (mat, g, opts) => F.add(mat, g.applyMatrix4(L), opts);
    add(ash, board(0.034, 0.034, bedL + 0.16, { along: 'z', rng, r: 0.008 }).translate(0, 0.02, 0));
    add(ash, board(0.036, 0.04, bedL + 0.24, { along: 'z', rng, r: 0.01 }).translate(0, sideH, 0));
    // rungs (Sprossen), turned
    const nr = 8;
    for (let i = 0; i < nr; i++) {
      const z = -bedL / 2 + 0.05 + (i * (bedL - 0.1)) / (nr - 1);
      add(ash, uvBox(new THREE.CylinderGeometry(0.009, 0.011, sideH - 0.03, 6), 'y').translate(0, sideH / 2 + 0.01, z), { cast: false });
    }
    // the rails' rounded ends stick out a little and are worn pale
    // little iron stays from the bed beams up to the ladder
    for (const z of [-0.3, 0.3]) {
      F.add(iron, tube([[s * 0.13, bedY - 0.04, z], [s * (bedW / 2 + 0.02), bedY + 0.02, z], [s * (bedW / 2 + 0.06), bedY + 0.14, z]], 0.006, 4, 4), { cast: false });
    }
  }
  // wheels: hub, eight spokes, wooden felloe, iron tyre (axis along x)
  const wheel = (x, z, R) => {
    const W = new THREE.Matrix4().makeTranslation(x, R, z);
    const add = (mat, g, opts) => F.add(mat, g.applyMatrix4(W), opts);
    add(oak, uvBox(new THREE.CylinderGeometry(0.034, 0.04, 0.075, 10), 'y').rotateZ(Math.PI / 2));
    add(iron, new THREE.CylinderGeometry(0.022, 0.022, 0.085, 8).rotateZ(Math.PI / 2), { cast: false });
    const ns = 8;
    for (let i = 0; i < ns; i++) {
      const a = (i / ns) * Math.PI * 2 + 0.2;
      const sp = board(0.016, R - 0.05, 0.02, { along: 'y', rng, r: 0.004 });
      sp.translate(0, (R - 0.05) / 2 + 0.025, 0).rotateX(a);
      add(ash, sp, { cast: false });
    }
    const fel = new THREE.TorusGeometry(R - 0.018, 0.019, 5, 22);
    fel.scale(1, 1, 1.25);
    add(oak, uvBox(fel.rotateY(Math.PI / 2), 'z'));
    add(iron, new THREE.TorusGeometry(R - 0.002, 0.007, 4, 26).rotateY(Math.PI / 2), { cast: false });
  };
  for (const s of [-1, 1]) {
    wheel(s * track, zR, R1);
    wheel(s * (track - 0.01), zF, R2);
  }
  // the drawbar (Deichsel), folded up on its pivot in front of the bed and
  // resting against the front board, T-handle on top
  {
    const pz = bedL / 2 + 0.1;
    for (const s of [-1, 1]) F.add(oak, timberish([s * 0.1, R2, zF], [s * 0.035, R2 + 0.02, pz]), { cast: false });
    const a = [0, R2 + 0.02, pz], b = [0, 0.92, pz - 0.19];
    const len = Math.hypot(b[1] - a[1], b[2] - a[2]);
    const tilt = Math.atan2(b[2] - a[2], b[1] - a[1]);
    F.add(ash, xf(board(0.04, len, 0.036, { along: 'y', rng, r: 0.01 }), [0, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [tilt, 0, 0]));
    F.add(ash, xf(uvBox(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8), 'y'), [0, b[1] + 0.015, b[2] - 0.004], [0, 0, Math.PI / 2]));
    // the fork & pin at the front axle
    F.add(iron, xf(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 6), [0, R2 + 0.02, pz], [0, 0, Math.PI / 2]), { cast: false });
    F.add(iron, xf(new THREE.TorusGeometry(0.025, 0.006, 4, 10), [0, b[1] - 0.06, b[2] + 0.01], [tilt + Math.PI / 2, 0, 0]), { cast: false });
  }
  // the load: rough planks, the top one still with its bark edge, lashed with rope
  {
    // rough-sawn stock: duller than planed wood
    const sp = ['#b59a72', '#9c7a55', '#a88d68', '#b8a07a', '#8f6c4a', '#9c5a43'];
    const loadL = bedL + 0.42;
    const z0 = -0.25; // overhanging at the back (clear of the folded drawbar)
    let y = bedY + 0.004;
    let k = 0;
    for (const row of [3, 2, 1]) {
      const t = rng.range(0.032, 0.042);
      const gap = 0.006;
      let ww = 0;
      const ws = [];
      for (let i = 0; i < row; i++) ws.push(rng.range(0.1, 0.13));
      for (const w of ws) ww += w + gap;
      let x = -ww / 2;
      for (const w of ws) {
        const s = sp[k++ % sp.length];
        const L = loadL + rng.jitter(0.08);
        F.add(mats.wood(s), xf(board(w, t, L, { along: 'z', rng, r: 0.004 }), [x + w / 2, y + t / 2, z0 + rng.jitter(0.03)], [0, rng.jitter(0.025), rng.jitter(0.02)]));
        // rough-sawn ends, a touch paler
        F.add(mats.wood(s), xf(new THREE.PlaneGeometry(w * 0.94, t * 0.9), [x + w / 2, y + t / 2, z0 - L / 2 - 0.002], [0, Math.PI, 0]), { color: '#c9b089', cast: false });
        x += w + gap;
      }
      y += t + 0.004;
    }
    // the waney top board: bark along one edge
    F.add(mats.bark(), xf(new THREE.BoxGeometry(0.018, 0.03, loadL - 0.1), [0.065, y - 0.02, z0], [0, 0, 0.3]), { cast: false });
    // rope lashing over the load, knotted to the ladder rails
    for (const z of [z0 - 0.25, z0 + 0.3]) {
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const u = i / 10;
        const x = (u - 0.5) * (bedW + 0.12);
        pts.push([x, bedY + 0.2 + (y - bedY - 0.2 + 0.012) * Math.sin(u * Math.PI) ** 0.4, z + Math.sin(u * 9) * 0.004]);
      }
      F.add(mats.rope(), tube(pts, 0.007, 4, 20), { cast: false });
    }
    // a jack plane riding on top of the load, its tote towards the visitor
    const py = y + 0.0225;
    const pz = -0.16; // between the two lashings
    F.add(mats.wood('beech'), xf(board(0.06, 0.045, 0.22, { along: 'z', rng, r: 0.008 }), [-0.005, py, pz], [0, 0.35, 0]), { cast: false });
    F.add(mats.wood('#5c4334'), xf(new THREE.CylinderGeometry(0.014, 0.017, 0.045, 6), [-0.005 + Math.sin(0.35) * 0.06, py + 0.045, pz + Math.cos(0.35) * 0.06]), { cast: false });
    F.add(mats.metal('#9aa1a6'), xf(new THREE.BoxGeometry(0.045, 0.05, 0.012), [-0.005, py + 0.035, pz], [0.6, 0.35, 0, 'YXZ']), { cast: false });
  }
  return { hx: 0.36, hz: 0.78 };
}

// ─── the bucket of dowels & pegs ─────────────────────────────────────────────
/**
 * A coopered oak bucket (Kübel): staves, two iron hoops, an iron bail laid to
 * one side, full of beech dowels standing in a fan, oak pegs poking between
 * them and a few spilled at its foot. ≈ 0.26 wide, dowels to ≈ 0.42.
 */
export function addDowelBucket(F, mats, rng) {
  const iron = mats.metal(IRON);
  const h = 0.24, r0 = 0.1, r1 = 0.122;
  const ns = 13;
  const tilt = Math.atan2(r1 - r0, h);
  for (let i = 0; i < ns; i++) {
    const a = (i / ns) * Math.PI * 2;
    const w = ((2 * Math.PI * (r0 + r1)) / 2 / ns) * 0.97;
    const st = board(w, h, 0.016, { along: 'y', rng, r: 0.003 });
    // tilt outwards, then turn to its place on the ring
    st.rotateX(tilt).translate(0, h / 2, (r0 + r1) / 2).rotateY(a);
    F.add(mats.wood(rng.pick(['#9c7a52', '#a48259', '#8f6f4b'])), st, { cast: i % 3 === 0 });
  }
  // the bottom inside, and the full-to-the-brim dark inside
  const rOut = (y) => r0 + ((r1 - r0) * y) / h + 0.008;
  F.add(mats.vc(), xf(new THREE.CircleGeometry(rOut(h - 0.07) - 0.018, 14), [0, h - 0.07, 0], [-Math.PI / 2, 0, 0]), { color: '#3a2a1c', cast: false });
  for (const y of [0.045, h - 0.045]) {
    F.add(iron, new THREE.TorusGeometry(rOut(y) + 0.002, 0.0075, 4, 22).rotateX(Math.PI / 2).translate(0, y, 0), { cast: false });
  }
  // the bail, laid down to one side
  {
    const bail = new THREE.TorusGeometry(r1 + 0.006, 0.0055, 4, 14, Math.PI);
    // (its ends on the ±z ears: it falls over sideways about that axis)
    bail.rotateY(Math.PI / 2).rotateZ(1.25);
    F.add(iron, bail.translate(0, h - 0.035, 0), { cast: false });
  }
  // dowels (Dübel): pale beech rods standing in a fan
  const dowel = (x, z, len, lean, dir, r) => {
    const g = uvBox(new THREE.CylinderGeometry(r, r, len, 6), 'y');
    g.translate(0, len / 2, 0).rotateX(lean).rotateY(dir).translate(x, h - 0.09, z);
    F.add(mats.wood(rng.pick(['#e2c9a0', '#d8bd92', '#e8d3ad', '#cfb184'])), g, { cast: false });
    // the cut end: a slightly darker cap
    const cap = new THREE.CircleGeometry(r * 0.96, 6);
    cap.rotateX(-Math.PI / 2).translate(0, len + 0.001, 0).rotateX(lean).rotateY(dir).translate(x, h - 0.09, z);
    F.add(mats.wood('#b8956a'), cap, { cast: false });
  };
  const nd = 26;
  for (let i = 0; i < nd; i++) {
    const rr = Math.sqrt(rng.next()) * (r1 - 0.025);
    const a = rng.next() * Math.PI * 2;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    dowel(x, z, rng.range(0.2, 0.3), (rr / r1) * 0.32 + rng.jitter(0.05), Math.atan2(x, z), rng.pick([0.0065, 0.008, 0.01]));
  }
  // oak pegs (Holznägel): square, tapered, poking up between the dowels
  const peg = () => {
    const g = new THREE.CylinderGeometry(0.004, 0.009, 0.075, 4);
    return uvBox(g, 'y');
  };
  for (let i = 0; i < 9; i++) {
    const rr = rng.range(0.02, r1 - 0.03), a = rng.next() * Math.PI * 2;
    F.add(mats.wood('#8a6844'), xf(peg(), [Math.cos(a) * rr, h - 0.03, Math.sin(a) * rr], [rng.jitter(0.5), rng.next() * 3, rng.jitter(0.5)]), { cast: false });
  }
  // a few spilled at its foot (pegs and two dowels)
  for (let i = 0; i < 7; i++) {
    const a = rng.range(-0.8, 1.6), rr = rng.range(r1 + 0.04, r1 + 0.2);
    F.add(mats.wood('#8a6844'), xf(peg(), [Math.sin(a) * rr, 0.009, Math.cos(a) * rr], [Math.PI / 2, rng.next() * 6, 0, 'YXZ']), { cast: false });
  }
  for (let i = 0; i < 2; i++) {
    const a = rng.range(0, 1.2), rr = rng.range(r1 + 0.06, r1 + 0.16);
    F.add(mats.wood('#e2c9a0'), xf(uvBox(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 6), 'y'), [Math.sin(a) * rr, 0.008, Math.cos(a) * rr], [Math.PI / 2, rng.next() * 6, 0, 'YXZ']), { cast: false });
  }
  return { r: r1 + 0.1 };
}

// ─── offcuts ─────────────────────────────────────────────────────────────────
/**
 * A heap of offcuts (Abschnitte) from the chest's boards: short pieces of
 * oak, ash, cherry and walnut tumbled on a little bed of sawdust, two longer
 * strips leaning across, a wedge or two. ≈ 0.6 across.
 */
export function addOffcuts(F, mats, rng) {
  F.add(mats.vc(), xf(mossGeo(rng, { r: 0.3, h: 0.025, sx: 1.2, sz: 0.85 }), [0, 0.0, 0]), { color: '#d9c094', cast: false });
  const sp = ['#b08e64', '#a6845c', 'ash', 'cherry', 'walnut', 'oak', 'maple', 'spruce'];
  for (let i = 0; i < 18; i++) {
    const s = rng.pick(sp);
    const L = rng.range(0.07, 0.24), w = rng.range(0.04, 0.12), t = rng.range(0.02, 0.04);
    const rr = Math.sqrt(rng.next()) * 0.22, a = rng.next() * Math.PI * 2;
    const y = 0.015 + (0.22 - rr) * rng.range(0.1, 0.45);
    const g = board(L, t, w, { along: 'x', rng, r: 0.004 });
    F.add(mats.wood(s), xf(g, [Math.cos(a) * rr * 1.2, y, Math.sin(a) * rr * 0.85], [rng.jitter(0.5), rng.next() * 6, rng.jitter(0.6)]), { cast: i < 6 });
  }
  // two long strips (Leisten) leaning across the heap
  for (let i = 0; i < 2; i++) {
    const L = rng.range(0.45, 0.6);
    F.add(mats.wood(rng.pick(['ash', 'oak'])), xf(board(L, 0.022, 0.03, { along: 'x', rng, r: 0.004 }), [rng.jitter(0.05), 0.07 + i * 0.03, rng.jitter(0.06)], [0, rng.next() * 3, 0.2 + rng.jitter(0.1)]), { cast: false });
  }
  // a couple of wedges
  for (let i = 0; i < 2; i++) {
    const g = new THREE.CylinderGeometry(0.0, 0.045, 0.1, 3, 1);
    g.rotateZ(Math.PI / 2).scale(1, 1, 0.4);
    F.add(mats.wood('#c9a77a'), xf(uvBox(g, 'x'), [0.22 + rng.jitter(0.05), 0.016, rng.jitter(0.18)], [0, rng.next() * 6, 0]), { cast: false });
  }
  return { r: 0.36 };
}

// ─── rough boards on the bark ────────────────────────────────────────────────
/**
 * Rough-sawn boards waiting to season, leaning on the oak's bark: one per
 * entry of `boards` ({ x (world), w, len, lean, color, bark: bool }), each
 * resting its top on the bark at world x and its foot on the ground.
 * Returns [{ x, z }] of the feet.
 */
export function addLeaningBoards(ctx, B, mats, rng, boards) {
  const { getHeight } = ctx.ground;
  const feet = [];
  const up = new THREE.Vector3();
  const side = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const m = new THREE.Matrix4();
  for (const b of boards) {
    const yTop = Math.cos(b.lean) * b.len;
    const top = barkMount(ctx, b.x, yTop, { spreadA: 0.04, spreadY: 0.1 });
    const foot0 = barkMount(ctx, b.x, 0.12, { spreadA: 0.05, spreadY: 0.1 });
    // the foot stands out by the lean (and clear of the flared trunk foot)
    const tp = top.point.clone().addScaledVector(top.normal, b.t ?? 0.035);
    const out = Math.max(Math.sin(b.lean) * b.len, foot0.r - top.r + 0.06);
    const fp = new THREE.Vector3(tp.x + top.normal.x * out, 0, tp.z + top.normal.z * out);
    fp.y = getHeight(fp.x, fp.z);
    up.copy(tp).sub(fp);
    const L = up.length();
    up.normalize();
    side.set(-top.normal.z, 0, top.normal.x).normalize();
    fwd.crossVectors(side, up).normalize();
    side.crossVectors(up, fwd).normalize();
    m.makeBasis(side, up, fwd).setPosition(fp.x, fp.y, fp.z);
    m.multiply(new THREE.Matrix4().makeRotationY(b.twist ?? 0));
    const t = b.t ?? 0.035;
    const g = board(b.w, L, t, { along: 'y', rng, r: 0.005 });
    // rough: a little cupped and wavy along the edges
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i), x = pa.getX(i);
      pa.setZ(i, pa.getZ(i) + (x / b.w) * (x / b.w) * 0.012 + noiseA(y * 2.3 + b.x * 5, x) * 0.004);
      if (Math.abs(x) > b.w * 0.45) pa.setX(i, x + noiseB(y * 3 + b.x * 3, x * 9) * 0.008);
    }
    g.computeVertexNormals();
    g.translate(0, L / 2, 0);
    B.add(mats.wood(b.color), g.applyMatrix4(m));
    // the sawn top end catches the light
    B.add(mats.wood(b.color), new THREE.PlaneGeometry(b.w * 0.95, t * 0.9).rotateX(-Math.PI / 2).translate(0, L + 0.001, 0).applyMatrix4(m), { color: '#dcc7a0', cast: false });
    if (b.bark) {
      // waney edge (Waldkante): a strip of bark along one side
      B.add(mats.bark(), new THREE.BoxGeometry(0.022, L * 0.94, t * 1.25).translate(b.w / 2 + 0.006, L * 0.49, 0).applyMatrix4(m), { cast: false });
    }
    feet.push({ x: fp.x, z: fp.z });
  }
  return feet;
}

// ─── besom ───────────────────────────────────────────────────────────────────
/**
 * A twig besom (Reisigbesen): an ash handle with a bundle of birch twigs bound
 * by two withies, leaning from `foot` (bundle end, world) to `top` (handle
 * end). Merged on the shared wood/rope materials.
 */
export function addBesom(B, mats, rng, foot, top) {
  const dir = top.clone().sub(foot);
  const len = dir.length();
  dir.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const place = (g, t) => {
    const p = foot.clone().addScaledVector(dir, t);
    return g.applyQuaternion(q).translate(p.x, p.y, p.z);
  };
  const bundle = 0.42;
  B.add(mats.wood('ash'), place(uvBox(new THREE.CylinderGeometry(0.014, 0.016, len - bundle * 0.55, 6), 'y'), bundle * 0.45 + (len - bundle * 0.55) / 2));
  // the twig bundle: a flared, ragged cone of thin twigs
  for (let i = 0; i < 26; i++) {
    const a = rng.next() * Math.PI * 2, rr = rng.range(0.005, 0.03);
    const spread = rng.range(0.04, 0.1);
    const tl = bundle * rng.range(0.85, 1.05);
    const p0 = [Math.cos(a) * rr, bundle, Math.sin(a) * rr];
    const p1 = [Math.cos(a) * (rr + spread), bundle - tl, Math.sin(a) * (rr + spread * 0.7)];
    const g = tube([p0, [(p0[0] + p1[0]) / 2 + rng.jitter(0.01), (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], p1], 0.0035, 3, 2);
    B.add(mats.wood(rng.pick(['#6e5236', '#7d5e3e', '#5e452e', '#8a6a46'])), place(g, 0), { cast: false });
  }
  // two withy bindings
  for (const t of [bundle * 0.8, bundle * 0.97]) B.add(mats.rope(), place(new THREE.CylinderGeometry(0.03, 0.03, 0.022, 8, 1, true), t), { cast: false });
}
