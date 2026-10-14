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
//   addSawhorse(F, mats, rng, m, opts)      a Swiss sawhorse (Schragen)
//   addRipVignette(F, mats, rng, opts)      the hero-foreground story: an oak
//                                           board half-ripped on two sawhorses,
//                                           the saw standing in its kerf, the
//                                           scribed line running on, a folding
//                                           rule, a carpenter's pencil, the
//                                           plane on its side, an F-clamp,
//                                           sawdust and fresh shavings
//   addStickeredStack(F, mats, rng, opts)   boards drying on stickers (Stapel)
//   addShavingTrail(B, mats, rng, gh, pts)  curled shavings blown along a line
//   addSawdust(B, mats, rng, gh, x, z)      a soft drift of sawdust & chips
//                                           (swept into corners, under the work)
//   addGluePot(F, mats, rng)                a Leimtopf: a dented enamel pot,
//                                           amber glue run down its side, the
//                                           brush standing in it
//   addMarkingGauge(F, mats, rng)           a beech Streichmass (the gauge that
//                                           scribed the dovetails' baselines)
//   leafGeo()                               a fallen oak leaf (flat, lobed)
//
// Working patina (kit.paintWear): the tools and work stations show their use —
// sawhorse arrises darkened and rounded by hands and boards, their tops nicked
// by saw kerfs, pencil ticks and amber glue drips; grips, handles and the
// drawbar's T darkened where hands hold them; feet and buckets damp-dark at
// the soil. The finished pieces on the deck stay finished (deck.js).
//
// Frames (F) are Batch views (B.at(matrix)) with the origin on the ground,
// +Z the object's front.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { board, timber, xf, mat4, uvBox, tube, mossGeo, mossPadGeo, stoneGeo, noiseA, noiseB, addHandSaw, addFClamp, doubleFace, paintWear, SPECIES, LOD, segs, count } from './kit.js';
import { barkMount } from './door.js';
import { shavingGeo } from './fx.js';

const IRON = '#2f2b28';
/** Dried hide glue (Knochenleim): amber, darker where it ran thick. */
const GLUE = ['#b5822f', '#a8742a', '#c4923c'];
/** Graphite on wood. */
const PENCIL = '#4a4643';
/** A species name or hex → the hex a proxy paints. */
const hexOf = (c) => SPECIES[c] ?? c;

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
 * bites past the edges. The ribbon is the painterly triplanar humus (crumbs,
 * pores, pebbles) tinted by its vertex colours; its outer row dives a few
 * millimetres into the terrain and fallen leaves drift over the edges, so it
 * never reads as a smooth strip laid on top. opts: { width = 0.7, lift =
 * 0.012, material (vertex-coloured; default the 'soil' surface), leaves = 1 }.
 * Returns dist(x, z): signed distance to the track's edge (< 0 = on it).
 */
export function addTrack(B, mats, rng, gh, pts, { width = 0.7, lift = 0.012, material = null, leaves = 1, dust = null } = {}) {
  const mat = material ?? mats.soilSurface?.() ?? mats.vc();
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p.x, 0, p.z)), false, 'centripetal');
  const len = curve.getLength();
  const n = Math.max(4, Math.ceil(len / (0.07 / Math.sqrt(LOD.k))));
  const across = LOD.k < 1 ? [-1, -0.62, -0.2, 0.2, 0.62, 1] : [-1, -0.7, -0.42, -0.14, 0.14, 0.42, 0.7, 1];
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const seed = rng.next() * 50;
  const cMid = new THREE.Color('#8f7154');
  const cEdge = new THREE.Color('#5f4733');
  const cDust = new THREE.Color('#a08263');
  // (dust(x, z) → 0..1: sawdust trodden into the soil near the work)
  const cSaw = new THREE.Color('#bb9d70');
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
      // (the outer row sinks ~5 mm into the terrain: no lip, no floating edge)
      pos.push(x, gh(x, z) + (edge ? -0.005 : lift * (Math.abs(a) > 0.6 ? 0.6 : 1)), z);
      // pale where it's walked most, darker towards the edges, a little mottled
      const k = 1 - Math.abs(a);
      c.copy(cEdge).lerp(cMid, Math.min(1, k * 1.4));
      const m = noiseA(x * 3.1 + seed, z * 3.1) * 0.5 + 0.5;
      c.lerp(cDust, Math.max(0, m - 0.5) * k * 1.8);
      // finer grain: damp darker dents and dry pale scuffs
      const f = noiseB(x * 9.3 - seed, z * 9.3);
      c.multiplyScalar(0.9 + f * 0.1 + rng.next() * 0.1);
      if (dust) c.lerp(cSaw, Math.min(0.75, dust(x, z) * (0.55 + 0.45 * k) * (0.7 + 0.3 * f)));
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
  for (let i = 0, n = LOD.small ? Math.round(len * 2.2) : Math.round(len * 0.8); i < n; i++) {
    const s = samples[rng.int(0, samples.length - 1)];
    const x = s.x + rng.jitter(s.w * 0.8), z = s.z + rng.jitter(s.w * 0.8);
    B.add(mats.stone(), xf(stoneGeo(rng, { r: rng.range(0.018, 0.04), sy: 0.45, detail: 0 }), [x, gh(x, z) + lift, z], [0, rng.next() * 6, 0]), { cast: false });
  }
  // fallen leaves blown over the edges (and the odd one on the track itself)
  {
    const vc = mats.vc();
    const tones = ['#b07a3e', '#9a6232', '#c99a4a', '#8a5a34', '#a8703a', '#7d5a36'];
    const n = count(Math.round(len * 9 * leaves));
    for (let i = 0; i < n; i++) {
      const j = rng.int(1, samples.length - 2);
      const s = samples[j], q = samples[j + 1];
      const tx = q.x - s.x, tz = q.z - s.z, tl = Math.hypot(tx, tz) || 1;
      const side = rng.next() < 0.5 ? -1 : 1;
      const off = s.w * (rng.next() < 0.18 ? rng.range(0, 0.7) : rng.range(0.75, 1.3));
      const x = s.x + (-tz / tl) * off * side, z = s.z + (tx / tl) * off * side;
      B.add(vc, xf(leafGeo(), [x, gh(x, z) + lift + 0.004, z], [-Math.PI / 2 + rng.jitter(0.3), rng.next() * 6.28, 0, 'YXZ'], rng.range(0.8, 1.3)), { color: rng.pick(tones), cast: false });
    }
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
      // (low tier: four facets, open — the ends hide in the rails)
      add(ash, uvBox(LOD.k < 0.5 ? new THREE.CylinderGeometry(0.009, 0.011, sideH - 0.03, 4, 1, true) : new THREE.CylinderGeometry(0.009, 0.011, sideH - 0.03, 6), 'y').translate(0, sideH / 2 + 0.01, z), { cast: false });
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
    add(oak, uvBox(new THREE.CylinderGeometry(0.034, 0.04, 0.075, segs(10, 6)), 'y').rotateZ(Math.PI / 2));
    add(iron, new THREE.CylinderGeometry(0.022, 0.022, 0.085, segs(8, 5)).rotateZ(Math.PI / 2), { cast: false });
    const ns = LOD.k < 0.5 ? 6 : 8;
    for (let i = 0; i < ns; i++) {
      const a = (i / ns) * Math.PI * 2 + 0.2;
      const sp = board(0.016, R - 0.05, 0.02, { along: 'y', rng, r: 0.004 });
      sp.translate(0, (R - 0.05) / 2 + 0.025, 0).rotateX(a);
      add(ash, sp, { cast: false });
    }
    const fel = new THREE.TorusGeometry(R - 0.018, 0.019, segs(5, 4), segs(22, 12));
    fel.scale(1, 1, 1.25);
    // (bent segments: long grain all round, no end grain on the rim)
    add(oak, uvBox(fel.rotateY(Math.PI / 2), 'z', undefined, [0, 0], { endGrain: false }));
    add(iron, new THREE.TorusGeometry(R - 0.002, 0.007, segs(4, 3), segs(26, 12)).rotateY(Math.PI / 2), { cast: false });
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
    // the T-handle, darkened by hands either side of the middle
    const th = uvBox(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8, LOD.k < 0.5 ? 1 : 6), 'y');
    paintWear(th, '#a3865f', (x, y) => (Math.abs(y) > 0.04 ? 0.78 * Math.min(1, (Math.abs(y) - 0.04) / 0.04) : -0.1), { dark: '#4a3422' });
    F.add(ash, xf(th, [0, b[1] + 0.015, b[2] - 0.004], [0, 0, Math.PI / 2]));
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
      F.add(mats.rope(), tube(pts, 0.007, LOD.k < 0.5 ? 3 : 4, LOD.k < 0.5 ? 8 : 20), { cast: false });
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
    // (damp-dark at the foot where it stands on the soil, the rim rubbed pale)
    const sc = rng.pick(['#9c7a52', '#a48259', '#8f6f4b']);
    paintWear(st, sc, (x, y) => (y < 0 ? 0.32 : -0.12));
    st.rotateX(tilt).translate(0, h / 2, (r0 + r1) / 2).rotateY(a);
    F.add(mats.wood(sc), st, { cast: i % 3 === 0 });
  }
  // the bottom inside, and the full-to-the-brim dark inside
  const rOut = (y) => r0 + ((r1 - r0) * y) / h + 0.008;
  F.add(mats.vc(), xf(new THREE.CircleGeometry(rOut(h - 0.07) - 0.018, 14), [0, h - 0.07, 0], [-Math.PI / 2, 0, 0]), { color: '#3a2a1c', cast: false });
  for (const y of [0.045, h - 0.045]) {
    F.add(iron, new THREE.TorusGeometry(rOut(y) + 0.002, 0.0075, LOD.k < 0.5 ? 3 : 4, LOD.k < 0.5 ? 13 : 22).rotateX(Math.PI / 2).translate(0, y, 0), { cast: false });
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
    // (low tier: four facets, open at the foot — it stands in the bucket)
    const g = uvBox(LOD.k < 0.5 ? new THREE.CylinderGeometry(r, r, len, 4, 1, true) : new THREE.CylinderGeometry(r, r, len, 6), 'y');
    g.translate(0, len / 2, 0).rotateX(lean).rotateY(dir).translate(x, h - 0.09, z);
    F.add(mats.wood(rng.pick(['#e2c9a0', '#d8bd92', '#e8d3ad', '#cfb184'])), g, { cast: false });
    // the cut end: a slightly darker cap
    const cap = new THREE.CircleGeometry(r * 0.96, 6);
    cap.rotateX(-Math.PI / 2).translate(0, len + 0.001, 0).rotateX(lean).rotateY(dir).translate(x, h - 0.09, z);
    F.add(mats.wood('#b8956a'), cap, { cast: false });
  };
  const nd = count(26, 10);
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
  for (let i = 0, n = count(9, 4); i < n; i++) {
    const rr = rng.range(0.02, r1 - 0.03), a = rng.next() * Math.PI * 2;
    F.add(mats.wood('#8a6844'), xf(peg(), [Math.cos(a) * rr, h - 0.03, Math.sin(a) * rr], [rng.jitter(0.5), rng.next() * 3, rng.jitter(0.5)]), { cast: false });
  }
  // a few spilled at its foot (pegs and two dowels)
  for (let i = 0, n = LOD.small ? 7 : 3; i < n; i++) {
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
  for (let i = 0, n = count(18, 8); i < n; i++) {
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
    // (high: more length segments, so the rain-splash at the foot stays a band)
    const g = board(b.w, L, t, { along: 'y', rng, r: 0.005, segs: LOD.k >= 1 ? 6 : 0 });
    // rough: a little cupped and wavy along the edges
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i), x = pa.getX(i);
      pa.setZ(i, pa.getZ(i) + (x / b.w) * (x / b.w) * 0.012 + noiseA(y * 2.3 + b.x * 5, x) * 0.004);
      if (Math.abs(x) > b.w * 0.45) pa.setX(i, x + noiseB(y * 3 + b.x * 3, x * 9) * 0.008);
    }
    g.computeVertexNormals();
    // weathered: rain-splashed dark at the foot, the upper end greyed by the sun
    paintWear(g, b.color, (x, y) => (y < -L / 2 + L * 0.2 ? 0.36 : y > L * 0.3 ? -0.12 : 0));
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
  // the handle: a cut hazel stick, bark left on (grey-brown, never a turned
  // white rod), a little bent as hazel grows, thinning towards the top
  {
    const y0 = bundle * 0.45, y1 = len;
    const n = 7, bow = 0.018 + rng.next() * 0.01, ph = rng.jitter(0.6);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push(new THREE.Vector3(Math.sin(t * Math.PI) * bow * Math.cos(ph), y0 + (y1 - y0) * t, Math.sin(t * Math.PI) * bow * Math.sin(ph) + Math.sin(t * 7.3) * 0.003));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, segs(14, 6), 0.0135, 6, false);
    // taper: thinner towards the top end
    const pa = g.attributes.position;
    const c = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) {
      const t = Math.floor(i / 7) / segs(14, 6);
      curve.getPointAt(Math.min(1, t), c);
      const k = 1.12 - 0.3 * t;
      pa.setXYZ(i, c.x + (pa.getX(i) - c.x) * k, pa.getY(i), c.z + (pa.getZ(i) - c.z) * k);
    }
    g.computeVertexNormals();
    uvBox(g, 'y', 1 / 1.4, [rng.next() * 5, 0], { endGrain: false });
    // the bark rubbed dark & shiny where the hands hold it (the top third and a hand-width at the middle)
    paintWear(g, '#6b5443', (x, y) => {
      const t = (y - y0) / (y1 - y0);
      return t > 0.68 ? 0.45 * Math.min(1, (t - 0.68) / 0.12) : Math.abs(t - 0.4) < 0.08 ? 0.3 : 0;
    }, { dark: '#2c2119' });
    B.add(mats.wood('#6b5443'), place(g, 0));
    // the cut top: pale end grain
    B.add(mats.wood('#c9ae86'), place(xf(new THREE.CircleGeometry(0.0115, 6), [pts[n].x, y1 + 0.0005, pts[n].z], [-Math.PI / 2, 0, 0]), 0), { cast: false });
  }
  // the twig bundle: a flared, ragged cone of thin twigs
  for (let i = 0, n = count(26, 12); i < n; i++) {
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

// ─── fallen leaf ─────────────────────────────────────────────────────────────
let leafProto = null;
/** A fallen oak leaf (≈ 0.11 long), lobed, in the XY plane, stem at the origin. */
export function leafGeo() {
  if (!leafProto) {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0);
    sh.quadraticCurveTo(-0.05, 0.02, -0.035, 0.05);
    sh.quadraticCurveTo(-0.05, 0.075, -0.02, 0.085);
    sh.quadraticCurveTo(-0.02, 0.11, 0, 0.115);
    sh.quadraticCurveTo(0.02, 0.11, 0.02, 0.085);
    sh.quadraticCurveTo(0.05, 0.075, 0.035, 0.05);
    sh.quadraticCurveTo(0.05, 0.02, 0, 0);
    leafProto = new THREE.ShapeGeometry(sh, 2);
  }
  return leafProto.clone();
}

// ─── sawhorse ────────────────────────────────────────────────────────────────
/**
 * A Swiss sawhorse (Schragen) in frame F through matrix m (origin on the
 * ground under the middle of its top beam, the beam along Z): a stout top
 * beam, four splayed legs let into its sides, a cross stretcher on each leg
 * pair and a long one between them. h = height of the beam's top.
 */
export function addSawhorse(F, mats, rng, m, { h = 0.36, len = 0.56, wood = '#9a7a56', worn = true, kerfs = 3, glue = 0, marks = true } = {}) {
  const w = mats.wood(wood);
  const base = hexOf(wood);
  const add = (g, opts) => F.add(w, g.applyMatrix4(m), opts);
  // the top beam: both top arrises darkened & rounded by hands and by every
  // board slid over them, the top scuffed paler and dusty, the end grain grimy
  // (an old horse: weathered grey-brown, the fresh board on it reads the brighter)
  const beam = board(0.085, 0.07, len, { along: 'z', rng, r: 0.008 });
  const wearOpts = { dark: '#2e2218', light: '#8c8273' };
  if (worn) {
    const ph = rng.next() * 9;
    paintWear(beam, base, (x, y, z, nx, ny, nz) => {
      if (Math.abs(nz) > 0.9) return 0.42;
      if (ny > 0.95) return -0.38 - 0.18 * noiseA(z * 7 + ph, x * 9);
      if (ny > 0.3) return 0.78;
      return y > 0.02 ? 0.5 : 0.1;
    }, wearOpts);
  }
  add(beam.translate(0, h - 0.035, 0));
  const top = h - 0.05, zt = len / 2 - 0.085, splay = 0.13, rake = 0.06;
  const yS = 0.15, u = 1 - yS / top; // the stretchers' height & the legs' spread there
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const leg = timber([sx * 0.03, top, sz * zt], [sx * (0.03 + splay), 0, sz * (zt + rake)], 0.04, 0.04, { rng, wobble: 0.003, up: [0, 0, 1], r: 0.006 });
      // (feet darkened by the damp soil)
      if (worn) paintWear(leg, base, (x, y) => (y < 0.12 ? 0.55 * (1 - y / 0.12) : -0.3), wearOpts);
      add(leg, { cast: false });
    }
    const half = 0.03 + splay * (1 - u) + 0.03;
    add(board(half * 2, 0.045, 0.024, { along: 'x', rng, r: 0.005 }).translate(0, yS, sz * (zt + rake * (1 - u) + 0.032)), { cast: false });
  }
  add(board(0.028, 0.038, 2 * (zt + rake * (1 - u)) + 0.04, { along: 'z', rng, r: 0.005 }).translate(0, yS + 0.042, 0), { cast: false });
  // the marks of use on the top beam (high & medium): saw kerfs where a cut ran
  // on into the horse (across the top, over the arris and down the side),
  // pencil ticks on its side, amber glue drips
  if (!worn || LOD.k < 0.5) return;
  const vc = mats.vc();
  const dark = '#2b1e13';
  const put = (g, color) => F.add(vc, g.applyMatrix4(m), { color, cast: false, receive: false });
  for (let i = 0; i < kerfs; i++) {
    const z = rng.range(-len / 2 + 0.05, len / 2 - 0.05), a = rng.jitter(0.35), side = rng.next() < 0.5 ? -1 : 1;
    const kl = rng.range(0.04, 0.09);
    // a kerf across the flat of the top, in from one arris
    put(xf(new THREE.PlaneGeometry(kl, 0.0035), [side * (0.034 - (kl / 2) * Math.cos(a)), h + 0.0007, z], [-Math.PI / 2, 0, a]), dark);
    // and its nick down that side face, below the arris
    const nl = rng.range(0.008, 0.02);
    put(xf(new THREE.PlaneGeometry(0.0035, nl), [side * 0.0432, h - 0.008 - nl / 2, z], [0, side * Math.PI / 2, 0]), dark);
  }
  if (marks) {
    // a tally and a cross in pencil on the near side face
    const z0 = rng.range(-0.08, 0.08);
    for (let k = 0; k < 4; k++) put(xf(new THREE.PlaneGeometry(0.0016, 0.022), [0.0434, h - 0.034, z0 + k * 0.007], [0, Math.PI / 2, rng.jitter(0.12)]), PENCIL);
    put(xf(new THREE.PlaneGeometry(0.0016, 0.034), [0.0434, h - 0.034, z0 + 0.0105], [0, Math.PI / 2, 1.2]), PENCIL);
    const z1 = z0 + (z0 > 0 ? -0.12 : 0.12);
    for (const r of [0.75, -0.75]) put(xf(new THREE.PlaneGeometry(0.0016, 0.026), [0.0434, h - 0.03, z1], [0, Math.PI / 2, r]), PENCIL);
  }
  for (let i = 0; i < glue; i++) {
    // a drop on the top that ran over the edge and down the side
    const z = rng.range(-len / 2 + 0.04, len / 2 - 0.04), side = rng.next() < 0.5 ? -1 : 1, c = rng.pick(GLUE);
    const r = rng.range(0.005, 0.009);
    put(xf(new THREE.SphereGeometry(r, segs(6, 5), 3), [side * rng.range(0.012, 0.03), h + 0.0004, z], null, [1.3, 0.22, 1]), c);
    if (rng.next() < 0.7) put(xf(new THREE.SphereGeometry(r * 0.55, 5, 3), [side * 0.0435, h - 0.016, z + rng.jitter(0.004)], null, [0.25, 2.6, 1]), c);
  }
}

// ─── the rip-cut vignette (hero foreground) ──────────────────────────────────
/**
 * An oak board being ripped on two sawhorses — the moment the sawyer stepped
 * away: the kerf runs in from the right end along a scribed pencil line that
 * carries on to the far end, the hand saw stands in the kerf (toe down
 * between the horses, handle up), the narrow strip already splays a hair
 * from the board; an F-clamp holds the left end to its horse, a folding rule
 * (Meterstab) and a flat red carpenter's pencil lie on the board, the plane
 * rests on its side (as a Schreiner puts it down, iron off the wood) with a
 * few shavings beside it, sawdust lies heaped under the kerf.
 * Frame F: origin on the ground in the middle, the board along +X (its cut
 * end at +X), +Z the side the visitor sees. Returns { hx, hz } (footprint).
 */
export function addRipVignette(F, mats, rng, { L = 1.34, W = 0.2, T = 0.034, h = 0.36, cut = 0.5, wood = '#a9875c' } = {}) {
  const hx = 0.4;
  for (const x of [-hx, hx]) addSawhorse(F, mats, rng, mat4([x + rng.jitter(0.02), 0, rng.jitter(0.02)], [0, rng.jitter(0.06), 0]), { h });
  const y0 = h, y1 = h + T; // the board's underside & top
  const oak = mats.wood(wood);
  const xk = L / 2 - cut; // where the kerf ends (the cut comes in from +X)
  const zc = -W / 2 + W * 0.62; // the rip line (a strip of ~38 % comes off the +Z side)
  const k = 0.007; // kerf
  // the uncut part, then the two halves of the cut part
  F.add(oak, board(xk + L / 2, T, W, { along: 'x', rng, r: 0.004 }).translate((xk - L / 2) / 2, y0 + T / 2, 0));
  F.add(oak, board(cut, T, zc - k / 2 + W / 2, { along: 'x', rng, r: 0.003 }).translate(xk + cut / 2, y0 + T / 2, (-W / 2 + zc - k / 2) / 2));
  {
    // the narrow strip: the same plank, splaying a hair outwards and drooping past the horse
    const sw = W / 2 - zc - k / 2;
    const g = board(cut, T, sw, { along: 'x', rng, r: 0.003 }).translate(cut / 2, T / 2, 0);
    F.add(oak, xf(g, [xk, y0 - 0.0005, zc + k / 2 + sw / 2], [0.0, -0.014, -0.012]));
  }
  // the board's end grain at both ends (paler, sawn)
  for (const [x, w0, w1] of [[-L / 2 - 0.0015, -W / 2, W / 2], [L / 2 + 0.0015, -W / 2, zc - k / 2]]) {
    F.add(oak, xf(new THREE.PlaneGeometry(w1 - w0 - 0.006, T * 0.86), [x, y0 + T / 2, (w0 + w1) / 2], [0, x > 0 ? Math.PI / 2 : -Math.PI / 2, 0]), { color: '#d8bf94', cast: false });
  }
  const vc = mats.vc();
  // the scribed line: pencil on along the rip line, knife-scribed square across near the left end
  F.add(vc, new THREE.BoxGeometry(xk + L / 2 - 0.05, 0.0008, 0.0035).translate((xk - L / 2 + 0.05) / 2, y1 + 0.0005, zc), { color: '#3c3732', cast: false, receive: false });
  F.add(vc, new THREE.BoxGeometry(0.003, 0.0008, W - 0.01).translate(-L / 2 + 0.07, y1 + 0.0005, 0), { color: '#3c3732', cast: false, receive: false });
  // the hand saw standing in the kerf: blade plane = the rip line's vertical
  // plane, toe down towards −X between the horses, handle up at the cut end
  {
    const th = 0.72, c = Math.cos(th), s = Math.sin(th), len = 0.5, f = 0.6;
    const R = new THREE.Matrix4().makeBasis(new THREE.Vector3(-c, -s, 0), new THREE.Vector3(-s, c, 0), new THREE.Vector3(0, 0, -1));
    const P = new THREE.Vector3(f * len, -0.052, 0).applyMatrix4(R);
    R.setPosition(xk + 0.004 - P.x, y1 - 0.012 - P.y, zc - P.z);
    addHandSaw(F, mats, R, { len, wood: '#6a4a34', worn: true });
  }
  // sawdust: a soft heap under the kerf's end, a sprinkle on the near horse and the board
  // (a mound, not a sheet: peaked under the kerf, its fan thinning out)
  addSawdust(F, mats, rng, () => 0, xk + 0.08, zc * 0.5, { r: 0.1, h: 0.055, sx: 1.3, chips: 4 });
  F.add(vc, xf(mossGeo(rng, { r: 0.06, h: 0.012, sx: 1.4 }), [hx, h + 0.001, 0.04]), { color: '#e8d3a8', cast: false });
  F.add(vc, xf(mossGeo(rng, { r: 0.05, h: 0.006, sx: 2.2 }), [xk + 0.06, y1 + 0.001, zc]), { color: '#e8d3a8', cast: false });
  // an F-clamp holding the board's left end down to its horse
  // (the bar beside the beam's outer face, the fixed jaw on the board, the sliding one under the beam)
  addFClamp(F, mats, mat4([-hx - 0.058, y1 + 0.034 - 0.2, 0.045]), { len: 0.2, reach: 0.09, color: '#c4372a', open: 0.21, worn: true });
  // the waste side of the rip line marked as a Schreiner marks it: a pencil
  // squiggle along the strip still to come off, beyond the kerf
  if (LOD.k >= 0.5) {
    const zw = (zc + W / 2) / 2;
    const xs = xk - 0.04, xe = -L / 2 + 0.16;
    const n = Math.max(3, Math.round((xs - xe) / 0.07));
    for (let i = 0; i < n; i++) {
      const xa = xs - ((xs - xe) * i) / n, xb = xs - ((xs - xe) * (i + 1)) / n;
      const za = zw + (i % 2 ? -1 : 1) * 0.011, zb = zw + (i % 2 ? 1 : -1) * 0.011;
      const sl = Math.hypot(xb - xa, zb - za);
      F.add(vc, xf(new THREE.PlaneGeometry(sl, 0.0016), [(xa + xb) / 2, y1 + 0.0005, (za + zb) / 2], [-Math.PI / 2, 0, Math.atan2(zb - za, xb - xa) * -1]), { color: PENCIL, cast: false, receive: false });
    }
  }
  // the folding rule (Meterstab): a folded bundle with two legs swung out, lying on the board
  {
    const yel = '#e8c22a';
    const rx = -0.2, rz = -0.03;
    F.add(vc, xf(new THREE.BoxGeometry(0.115, 0.014, 0.017), [rx, y1 + 0.007, rz], [0, 0.3, 0]), { color: yel, cast: false });
    const a0 = 0.3, a1 = 0.3 + 2.3;
    const j0 = new THREE.Vector3(rx + Math.cos(a0) * 0.0575, y1 + 0.0035, rz - Math.sin(a0) * 0.0575);
    const leg = (p, a) => {
      const g = new THREE.BoxGeometry(0.118, 0.0035, 0.016).translate(0.059, 0, 0);
      F.add(vc, xf(g, [p.x, p.y, p.z], [0, a, 0]), { color: yel, cast: false });
      // the tick marks read as a darker band at every joint
      F.add(vc, xf(new THREE.BoxGeometry(0.006, 0.0038, 0.0165).translate(0.115, 0, 0), [p.x, p.y + 0.0003, p.z], [0, a, 0]), { color: '#2b2622', cast: false });
      return new THREE.Vector3(p.x + Math.cos(a) * 0.118, p.y, p.z - Math.sin(a) * 0.118);
    };
    const j1 = leg(j0, a1);
    leg(j1, a1 - 1.9);
  }
  // a flat red carpenter's pencil (Zimmermannsbleistift), sharpened with a knife
  {
    const px = -0.02, pz = W / 2 - 0.035, a = 0.5;
    F.add(vc, xf(new THREE.BoxGeometry(0.11, 0.0065, 0.013), [px, y1 + 0.0033, pz], [0, a, 0]), { color: '#c4271c', cast: false });
    const tip = new THREE.CylinderGeometry(0.0005, 0.006, 0.022, 4).rotateZ(-Math.PI / 2).scale(1, 0.55, 1);
    F.add(vc, xf(tip, [px + Math.cos(a) * 0.066, y1 + 0.0033, pz - Math.sin(a) * 0.066], [0, a, 0]), { color: '#d8b98a', cast: false });
  }
  // the plane (a Swiss Schlichthobel with its horn), laid on its side on the board
  {
    const pb = mat4([-0.42, y1 + 0.028, -0.035], [Math.PI / 2, 0.15, 0, 'YXZ']);
    const beech = mats.wood('#c4a07a');
    F.add(beech, board(0.21, 0.052, 0.056, { along: 'x', rng, r: 0.012 }).translate(0, 0.026, 0).applyMatrix4(pb), { cast: false });
    F.add(beech, uvBox(new THREE.CylinderGeometry(0.011, 0.013, 0.045, segs(8, 5)), 'y').translate(0.075, 0.072, 0).applyMatrix4(pb), { cast: false });
    F.add(mats.wood('#b08c62'), xf(board(0.03, 0.06, 0.04, { along: 'y', rng, r: 0.004 }), [-0.005, 0.075, 0], [0, 0, 0.75]).applyMatrix4(pb), { cast: false });
    F.add(mats.metal('#9aa1a6'), xf(new THREE.BoxGeometry(0.004, 0.07, 0.046), [-0.025, 0.07, 0], [0, 0, 0.78]).applyMatrix4(pb), { cast: false });
  }
  // fresh shavings by the plane, two dropped on the ground
  {
    const curl = doubleFace(shavingGeo(0.03, 0.02, 1.4));
    const tones = ['#d3aa74', '#c99c63', '#e0bd88'];
    const spots = [[-0.27, y1 + 0.012, 0.02], [-0.3, y1 + 0.01, 0.06], [-0.22, y1 + 0.012, -0.06], [-0.56, 0.012, 0.18], [-0.1, 0.012, 0.22], [0.2, 0.012, -0.2]];
    for (let i = 0; i < (LOD.small ? spots.length : 3); i++) {
      const [x, y, z] = spots[i];
      F.add(mats.wood(rng.pick(tones)), xf(curl.clone(), [x, y, z], [rng.jitter(0.6), rng.next() * 6, rng.jitter(0.6)], rng.range(0.8, 1.2)), { cast: false });
    }
  }
  return { hx: L / 2 + 0.05, hz: 0.36 };
}

// ─── stickered stack ─────────────────────────────────────────────────────────
/**
 * Boards drying in a stickered stack (Stapel) on two bearers on stones:
 * thin battens between the layers so the air gets through, the sawn ends
 * sealed with red wax against checking, a weathered board and a stone on
 * top against the rain. Boards along Z (ends towards ±Z). Frame origin on
 * the ground. opts: { len, layers, width, species: [...] }. Returns { hx, hz }.
 */
export function addStickeredStack(F, mats, rng, { len = 0.9, layers = 4, width = 0.46, species = ['#a9875c', '#c2ab84', '#9c5a43', '#a9875c'] } = {}) {
  const tim = mats.timber();
  for (const z of [-len / 2 + 0.12, len / 2 - 0.12]) {
    F.add(mats.stone(), stoneGeo(rng, { r: 1, sx: 0.1, sy: 0.045, sz: 0.085, detail: 0 }).translate(0, 0.025, z), { cast: false });
    F.add(tim, board(width + 0.06, 0.07, 0.07, { along: 'x', rng, scale: 1 / 1.6 }).translate(0, 0.085, z));
  }
  let y = 0.12;
  for (let layer = 0; layer < layers; layer++) {
    let x = -width / 2;
    while (x < width / 2 - 0.08) {
      const w = Math.min(rng.range(0.11, 0.16), width / 2 - x);
      const t = rng.range(0.026, 0.034);
      const c = species[(((layer + Math.round(x * 10)) % species.length) + species.length) % species.length];
      F.add(mats.wood(c), board(w - 0.008, t, len + rng.jitter(0.03), { along: 'z', rng, r: 0.004 }).translate(x + w / 2, y + t / 2, rng.jitter(0.015)), { cast: layer === layers - 1 });
      // the sawn ends are the board's own end grain (real Hirnholz from the
      // box UVs: rings, darker); every other board carries the yard's red
      // batch mark across the top of its visitor end
      if (rng.next() < 0.5) F.add(mats.wood(c), xf(new THREE.PlaneGeometry(w - 0.016, t * 0.28), [x + w / 2, y + t * 0.8, len / 2 + 0.0035]), { color: '#a8382a', cast: false });
      x += w;
    }
    y += 0.034;
    if (layer < layers - 1) {
      for (const z of [-len / 2 + 0.12, 0, len / 2 - 0.12]) F.add(mats.wood('spruce'), board(width + 0.03, 0.016, 0.026, { along: 'x', rng, r: 0.004 }).translate(rng.jitter(0.01), y + 0.008, z + rng.jitter(0.015)), { cast: false });
      y += 0.016;
    }
  }
  // the rain cover: two old weathered boards laid askew, a stone on them
  F.add(tim, xf(board(0.19, 0.02, len + 0.1, { along: 'z', rng, scale: 1 / 1.6 }), [-width / 2 + 0.1, y + 0.012, 0.02], [0, 0.05, 0.04]));
  F.add(tim, xf(board(0.17, 0.02, len + 0.06, { along: 'z', rng, scale: 1 / 1.6 }), [width / 2 - 0.12, y + 0.026, -0.03], [0, -0.07, -0.05]));
  F.add(mats.stone(), stoneGeo(rng, { r: 1, sx: 0.08, sy: 0.05, sz: 0.07 }).translate(width / 2 - 0.12, y + 0.07, -0.12), { cast: false });
  return { hx: width / 2 + 0.08, hz: len / 2 + 0.1 };
}

// ─── shavings blown along a line ─────────────────────────────────────────────
/**
 * Curled plane shavings (the porch's honey-oak and pale spruce) lying along
 * `pts` ([{x, z}] world, conformed to the ground by gh), thinning out towards
 * the end: shavings the wind carried off the Hobelbank. n on high.
 */
export function addShavingTrail(B, mats, rng, gh, pts, { n = 26, spread = 0.22, scale = 1 } = {}) {
  const curls = [doubleFace(shavingGeo(0.03, 0.02, 1.3)), doubleFace(shavingGeo(0.038, 0.024, 1.9)), doubleFace(shavingGeo(0.026, 0.018, 1.1))];
  const tones = ['#c99c63', '#bd8f58', '#d3aa74', '#e6d3a4', '#ddc690'];
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p.x, 0, p.z)));
  // (low tier: about two in five — a scatter still, at a third of the cost)
  const total = LOD.k < 0.5 ? Math.max(6, Math.round(n * LOD.k)) : count(n, 6);
  const out = [];
  for (let i = 0; i < total; i++) {
    const u = Math.pow(rng.next(), 1.6); // dense at the start, thinning out
    const p = curve.getPointAt(u);
    const x = p.x + rng.jitter(spread * (0.6 + u)), z = p.z + rng.jitter(spread * (0.6 + u));
    const y = gh(x, z) + 0.012;
    B.add(mats.wood(rng.pick(tones)), xf(rng.pick(curls).clone(), [x, y, z], [rng.jitter(0.7) + (rng.next() < 0.5 ? Math.PI / 2 : 0), rng.next() * 6.28, rng.jitter(0.7)], rng.range(0.85, 1.25) * scale), { cast: false });
    out.push({ x, z });
  }
  return out;
}

// ─── flagstones ──────────────────────────────────────────────────────────────
/**
 * A flat flagstone (Steinplatte): an irregular, slightly lumpy polygon of
 * dressed stone, a flat top with the faintest dome, a chamfered (worn) top
 * edge and a body sunk into the soil. Origin on the ground under its middle,
 * top at y = top. ≈ 7·n triangles (n = 10…14 outline points: 5–7 blunted corners).
 * opts: { r, sx, sz, top (height of the top above the ground), c (chamfer), depth }
 */
export function flagstoneGeo(rng, { r = 0.18, sx = 1, sz = 1, top = 0.03, c = 0.012, depth = 0.08 } = {}) {
  // an irregular split slab: 5–7 corners at uneven angles and radii, now and
  // then one a little knocked in (never a tidy hexagon tile) — and every
  // corner worn off (cut back along both edges), so the outline reads as
  // split stone with blunted corners rather than a polygon cut from card
  const nc = rng.int(5, 7);
  const ph = rng.next() * Math.PI * 2;
  const bite = rng.next() < 0.4 ? rng.int(0, nc - 1) : -1;
  const corners = [];
  for (let i = 0; i < nc; i++) {
    const a = ph + ((i + rng.jitter(0.3)) / nc) * Math.PI * 2;
    const k = (i === bite ? 0.86 : 1) * rng.range(0.84, 1.12);
    corners.push([Math.cos(a) * r * sx * k, Math.sin(a) * r * sz * k]);
  }
  // (medium & low: the plain split outline, no worn corners, no dome ring)
  const out = LOD.k < 1 ? corners : [];
  for (let i = 0; i < nc && LOD.k >= 1; i++) {
    const p0 = corners[(i + nc - 1) % nc], p1 = corners[i], p2 = corners[(i + 1) % nc];
    const f0 = rng.range(0.14, 0.24), f1 = rng.range(0.14, 0.24);
    out.push([p1[0] + (p0[0] - p1[0]) * f0, p1[1] + (p0[1] - p1[1]) * f0]);
    out.push([p1[0] + (p2[0] - p1[0]) * f1, p1[1] + (p2[1] - p1[1]) * f1]);
  }
  const n = out.length;
  const dome = rng.range(0.002, 0.006);
  // centroid & an inset ring for the chamfer
  let cx = 0, cz = 0;
  for (const [x, z] of out) {
    cx += x / n;
    cz += z / n;
  }
  const inset = (f, dd = 0) => out.map(([x, z]) => {
    const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1;
    return [cx + dx * f - (dx / l) * dd, cz + dz * f - (dz / l) * dd];
  });
  const ringTop = inset(1, c), ringMid = inset(0.55), ringBot = inset(1.04);
  const geos = [];
  // the top: centre + a mid ring (faint dome, a little uneven) + the chamfer's upper edge
  {
    const pos = [cx, top + dome, cz];
    for (const [x, z] of ringMid) pos.push(x, top + dome * 0.6 + rng.jitter(0.0015), z);
    for (const [x, z] of ringTop) pos.push(x, top, z);
    const idx = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (LOD.k < 1) {
        // (no dome ring: one fan from the centre to the chamfer's edge)
        idx.push(0, 1 + n + j, 1 + n + i);
        continue;
      }
      idx.push(0, 1 + j, 1 + i);
      idx.push(1 + i, 1 + j, 1 + n + i, 1 + j, 1 + n + j, 1 + n + i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    geos.push(g);
  }
  // the chamfer band, then the sides down into the soil (own vertices: crisp edges)
  for (const [ra, ya, rb, yb] of [[ringTop, top, out, top - c], [out, top - c, ringBot, -depth]]) {
    const pos = [];
    for (let i = 0; i < n; i++) pos.push(ra[i][0], ya, ra[i][1], rb[i][0], yb, rb[i][1]);
    const idx = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = ((i + 1) % n) * 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    geos.push(g);
  }
  const g = mergeGeometries(geos.map((x) => x.toNonIndexed()), false);
  g.computeVertexNormals();
  return uvBox(g, 'x', 1.6, [rng.next() * 9, rng.next() * 9], { endGrain: false });
}

/**
 * A flagged apron: flagstones laid on a jittered grid with 2–4 cm joints,
 * a low moss underlay showing green in every joint (and creeping over the
 * apron's ragged rim), the odd clover sprig in a joint. F: a frame whose
 * ground is y = 0 (`gy(x, z)` gives the ground height if it isn't flat).
 * cells: { x0, x1, z0, z1, cw, cd }. Returns [{ x, z, r }] (local).
 */
export function addFlagApron(F, mats, rng, { x0, x1, z0, z1, cw = 0.3, cd = 0.27 }, gy = () => 0) {
  const stones = [];
  const nx = Math.max(1, Math.round((x1 - x0) / cw)), nz = Math.max(1, Math.round((z1 - z0) / cd));
  const w = (x1 - x0) / nx, d = (z1 - z0) / nz;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      // a ragged rim: corners and the odd edge stone left out
      const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
      if (edge && rng.next() < 0.22) continue;
      const x = x0 + w * (i + 0.5 + (j % 2) * 0.25) + rng.jitter(w * 0.08);
      const z = z0 + d * (j + 0.5) + rng.jitter(d * 0.08);
      if (x > x1) continue;
      const g = flagstoneGeo(rng, { r: 0.5, sx: w * 0.86, sz: d * 0.86, top: 0.027 + rng.jitter(0.004), c: 0.01 });
      F.add(mats.stone(), xf(g, [x, gy(x, z), z], [rng.jitter(0.025), rng.jitter(0.3), rng.jitter(0.025)]), { cast: false });
      stones.push({ x, z, r: Math.max(w, d) * 0.42 });
    }
  }
  // the moss in the joints: a low cushion under the whole apron
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  F.add(mats.moss(), xf(mossPadGeo(rng, { r: 0.5, h: 0.016, sx: (x1 - x0) * 1.06, sz: (z1 - z0) * 1.14, lobes: 0.5 }), [cx, gy(cx, cz) - 0.002, cz]), { cast: false });
  return stones;
}

// ─── chopping block ──────────────────────────────────────────────────────────
/**
 * A chopping block (Spaltstock): a short oak round with its bark on, the top
 * end grain (rings, a drying check) scarred by the axe, the axe stuck in it
 * at an angle, split kindling lying round it and a scatter of chips. Frame F
 * origin on the ground. Returns { r } (footprint radius).
 */
export function addChoppingBlock(F, mats, rng, { r = 0.21, h = 0.4 } = {}) {
  const blk = new THREE.CylinderGeometry(r, r * 1.12, h, segs(12, 8), 1, true);
  F.add(mats.bark(), uvBox(blk, 'y', 1 / 2.6, [rng.next() * 5, 0], { endGrain: false }).translate(0, h / 2, 0));
  // the top: real end grain (rings & a check) — a slightly tilted cut
  const top = new THREE.CircleGeometry(r * 0.98, segs(12, 8)).rotateX(-Math.PI / 2);
  uvBox(top, 'y', 1 / 1.4, [rng.next() * 3, rng.next() * 3], { endGrain: true });
  F.add(mats.wood('#b0916c'), xf(top, [0, h + 0.002, 0], [0.03, 0, -0.02]), { cast: false });
  // a few axe scars (dark short cuts on the end grain)
  const vc = mats.vc();
  for (let i = 0; i < 4; i++) F.add(vc, xf(new THREE.BoxGeometry(rng.range(0.05, 0.1), 0.001, 0.0035), [rng.jitter(r * 0.5), h + 0.0045, rng.jitter(r * 0.5)], [0, rng.next() * 3, 0]), { color: '#5a4430', cast: false, receive: false });
  // the axe, left stuck in the block as an axe is: the head's bit bitten a few
  // cm into the end grain, the blade square to the haft, the hickory-pale
  // haft rising at a low angle out over the block's edge
  {
    // (haft frame: the haft runs up local +y from the eye; the blade points
    // along local +x, which the 63° lean turns down into the block)
    const m = mat4([0.02, h + 0.05, 0.01], [0.1, 0.35, -1.1]);
    // (the hickory haft darkened by hands at its grip end, a hand-width below the head too)
    const haft = board(0.032, 0.62, 0.022, { along: 'y', rng, r: 0.009, segs: LOD.lite ? 0 : 6 });
    paintWear(haft, '#c4a272', (x, y) => (y > 0.12 ? 0.55 * Math.min(1, (y - 0.12) / 0.1) : y < -0.2 ? 0.25 : 0));
    F.add(mats.wood('#c4a272'), xf(haft, [0, 0.29, 0]).applyMatrix4(m));
    // the head: poll & eye round the haft's end, the cheeks flaring to the bit
    const head = new THREE.Shape([[-0.026, -0.022], [0.03, -0.02], [0.094, -0.046], [0.104, 0.0], [0.094, 0.046], [0.03, 0.022], [-0.026, 0.022]].map(([x, y]) => new THREE.Vector2(x, y)));
    const hg = new THREE.ExtrudeGeometry(head, { depth: 0.024, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
    hg.translate(0, 0, -0.012);
    F.add(mats.metal('#6d6f72'), hg.applyMatrix4(m), { cast: false });
    // the bright honed edge where the bit enters the wood
    F.add(mats.metal('#b9bcbe'), xf(new THREE.BoxGeometry(0.006, 0.07, 0.026), [0.1, 0, 0]).applyMatrix4(m), { cast: false });
  }
  // split kindling round its foot, a couple leaning on it, chips
  for (let i = 0, n = count(8, 4); i < n; i++) {
    const a = rng.next() * Math.PI * 2, rr = r + rng.range(0.08, 0.32);
    const half = new THREE.CylinderGeometry(0.045, 0.045, rng.range(0.22, 0.32), 5, 1, false, 0, Math.PI);
    uvBox(half, 'y', 1 / 1.4, [rng.next() * 5, 0]);
    F.add(mats.wood(rng.pick(['#a98a66', '#b5966f', '#9c7d5a'])), xf(half, [Math.cos(a) * rr, 0.03, Math.sin(a) * rr], [Math.PI / 2, rng.next() * 6, rng.jitter(0.25)]), { cast: false });
  }
  for (const a of [2.1, 2.6]) {
    const half = new THREE.CylinderGeometry(0.04, 0.04, 0.34, 5, 1, false, 0, Math.PI);
    uvBox(half, 'y', 1 / 1.4, [rng.next() * 5, 0]);
    F.add(mats.wood('#b08f68'), xf(half, [Math.cos(a) * (r + 0.07), 0.16, Math.sin(a) * (r + 0.07)], [0, -a, 0.32]), { cast: false });
  }
  for (let i = 0, n = LOD.small ? 16 : 6; i < n; i++) {
    const a = rng.next() * Math.PI * 2, rr = r + rng.range(0.02, 0.4);
    F.add(mats.wood('#d2b88c'), xf(new THREE.BoxGeometry(rng.range(0.025, 0.05), 0.006, rng.range(0.012, 0.022)), [Math.cos(a) * rr, 0.004, Math.sin(a) * rr], [rng.jitter(0.3), rng.next() * 6, 0]), { cast: false });
  }
  return { r: r + 0.3 };
}

/**
 * Sawdust swept out of a doorway: a few soft heaps and a fan of 3D shaving
 * curls thinning out from `from` towards `to` (world [{x, z}], conformed to
 * the ground by gh). Low and flat: they lie on a path without blocking it.
 */
export function addSweptShavings(B, mats, rng, gh, from, to, { n = 24, heaps = 3, spread = 0.35, scale = 1.35 } = {}) {
  const vc = mats.vc();
  // soft sawdust heaps by the threshold (the broom stopped there), a thin drift between them
  for (let i = 0; i < heaps; i++) {
    const t = rng.range(0, 0.3);
    const x = from.x + (to.x - from.x) * t + rng.jitter(spread), z = from.z + (to.z - from.z) * t + rng.jitter(spread * 0.5);
    // (mounded, a warm tan: sawdust, not paper)
    B.add(vc, xf(mossGeo(rng, { r: rng.range(0.05, 0.08), h: rng.range(0.028, 0.04), sx: 1.3 }), [x, gh(x, z), z], [0, rng.next() * 3, 0]), { color: rng.pick(['#b38d5c', '#a98455', '#bb9564']), cast: false });
  }
  const mid = { x: (from.x + to.x) / 2 + rng.jitter(0.2), z: (from.z + to.z) / 2 };
  return addShavingTrail(B, mats, rng, gh, [from, mid, to], { n, spread, scale });
}

// ─── sawdust ─────────────────────────────────────────────────────────────────
/**
 * A soft drift of sawdust swept into a corner or fallen under the work (world
 * x, z; conformed to the ground by gh): one low lumpy mound, a thin fan round
 * it and (high) a few chips and a curl. opts: { r = 0.12, h = 0.025, sx = 1.4,
 * yaw, tone ('fresh' | 'old'), chips = 4 }.
 */
export function addSawdust(B, mats, rng, gh, x, z, { r = 0.12, h = 0.025, sx = 1.4, yaw = null, tone = 'fresh', chips = 4 } = {}) {
  const vc = mats.vc();
  const tones = tone === 'old' ? ['#a8865a', '#9c7c53', '#b08e60'] : ['#d2b586', '#c9ab7c', '#d8bd90'];
  const a = yaw ?? rng.next() * Math.PI;
  const y = gh(x, z);
  B.add(vc, xf(mossGeo(rng, { r, h, sx }), [x, y, z], [0, a, 0]), { color: rng.pick(tones), cast: false });
  // the thin fan the broom (or the wind) left round it
  B.add(vc, xf(mossGeo(rng, { r: r * 1.7, h: h * 0.18, sx: sx * 0.9 }), [x + rng.jitter(r * 0.3), y - 0.002, z + rng.jitter(r * 0.3)], [0, a + rng.jitter(0.6), 0]), { color: tones[1], cast: false });
  if (!LOD.small) return;
  for (let i = 0; i < chips; i++) {
    const ca = rng.next() * Math.PI * 2, cr = r * rng.range(0.6, 1.6);
    const cx = x + Math.cos(ca) * cr, cz = z + Math.sin(ca) * cr;
    B.add(mats.wood(rng.pick(['#d8bd92', '#c9a77a', '#e2c9a0'])), xf(new THREE.BoxGeometry(rng.range(0.018, 0.04), 0.005, rng.range(0.008, 0.016)), [cx, gh(cx, cz) + 0.004, cz], [rng.jitter(0.3), rng.next() * 6, 0]), { cast: false });
  }
}

// ─── glue pot ────────────────────────────────────────────────────────────────
/**
 * A Swiss Leimtopf for hide glue: a squat, slightly dented cream-enamelled pot
 * with a dark rim and a wire bail, amber glue run down one side and dried in
 * a crust on the rim, the glue brush standing in it (beech handle, bristles
 * clotted with glue). ≈ 0.08 across, 0.16 tall with the brush. Origin under
 * its middle. Returns { r }.
 */
export function addGluePot(F, mats, rng) {
  const r = 0.036, h = 0.055;
  const enamel = '#e7dcc4';
  const pot = new THREE.CylinderGeometry(r, r * 1.04, h, segs(12, 7), 2, true);
  // a dent or two & the glue that ran down the side (painted amber, darker below)
  const ph = rng.next() * 6;
  const pa = pot.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), z = pa.getZ(i), a = Math.atan2(z, x);
    const k = 1 - 0.07 * Math.max(0, Math.cos(a - ph) - 0.6) * 2.5;
    pa.setX(i, x * k);
    pa.setZ(i, z * k);
  }
  pot.computeVertexNormals();
  paintWear(pot, enamel, (x, y, z) => {
    const a = Math.atan2(z, x);
    const run = Math.cos(a - ph - 2.2);
    if (run > 0.8) return y > -h / 2 + 0.01 ? 0.85 : 0.6; // the glue run
    return y < -h / 2 + 0.005 ? 0.35 : 0; // grimy foot
  }, { dark: '#9a6a28' });
  const vc = mats.vc();
  F.add(vc, pot.translate(0, h / 2, 0), { cast: false });
  // bottom (closed from below), the glue inside, the dark enamel rim with its crust
  F.add(vc, xf(new THREE.CircleGeometry(r * 1.03, segs(12, 7)), [0, 0.001, 0], [Math.PI / 2, 0, 0]), { color: '#4a4036', cast: false });
  F.add(vc, xf(new THREE.CircleGeometry(r * 0.94, segs(12, 7)), [0, h - 0.012, 0], [-Math.PI / 2, 0, 0]), { color: '#8a5a1e', cast: false });
  F.add(vc, xf(new THREE.TorusGeometry(r, 0.0035, 3, segs(14, 8)), [0, h, 0], [Math.PI / 2, 0, 0]), { color: '#3a3330', cast: false });
  for (let i = 0; i < (LOD.small ? 3 : 1); i++) {
    const a = ph + 2.2 + rng.jitter(0.5);
    F.add(vc, xf(new THREE.SphereGeometry(0.006, 5, 3), [Math.cos(a) * r, h + 0.002, Math.sin(a) * r], null, [1.4, 0.5, 1]), { color: rng.pick(GLUE), cast: false });
  }
  // the wire bail, laid back
  // (a half ring from ear to ear across x, tipped back about that axis)
  F.add(mats.metal('#4a4542'), xf(new THREE.TorusGeometry(r + 0.004, 0.0018, 3, segs(10, 6), Math.PI), [0, h - 0.004, 0], [1.35, 0, 0]), { cast: false });
  // the brush, leaning in it: beech handle, a tin ferrule, clotted bristles
  {
    const lean = 0.32, dir = ph + 0.9;
    const M = mat4([Math.cos(dir) * r * 0.25, h - 0.03, Math.sin(dir) * r * 0.25], [0, -dir, lean]);
    const handle = uvBox(new THREE.CylinderGeometry(0.0055, 0.007, 0.11, segs(6, 4)), 'y').translate(0, 0.09, 0);
    paintWear(handle, '#c9a77a', (x, y) => (y < 0.06 ? 0.55 : 0.12), { dark: '#8a5a1e' });
    F.add(mats.wood('#c9a77a'), handle.applyMatrix4(M), { cast: false });
    F.add(mats.metal('#9a9893'), new THREE.CylinderGeometry(0.009, 0.008, 0.02, segs(8, 5), 1, true).translate(0, 0.03, 0).applyMatrix4(M), { cast: false });
    F.add(vc, new THREE.CylinderGeometry(0.0095, 0.006, 0.03, segs(7, 5)).translate(0, 0.008, 0).applyMatrix4(M), { color: '#6e4a1c', cast: false });
  }
  return { r: r + 0.01 };
}

// ─── marking gauge ───────────────────────────────────────────────────────────
/**
 * A Streichmass (marking gauge) lying on its side: a square beech stem with
 * the scribing pin near one end, the fence (Anschlag) locked by its wedge,
 * the stem darkened where the fingers hold it behind the fence. Stem along
 * +X, centred, lying on y = 0. Returns nothing.
 */
export function addMarkingGauge(F, mats, rng) {
  const beech = '#c8a27c';
  // (built round the stem's axis, then laid down: resting on the fence's edge
  // and the pin end, the stem tipped a little)
  const M = mat4([0, 0.022, 0], [0, 0, 0.15]);
  const add = (mat, g) => F.add(mat, g.applyMatrix4(M), { cast: false });
  const stem = board(0.19, 0.018, 0.018, { along: 'x', rng, r: 0.002 });
  paintWear(stem, beech, (x) => (x > 0.0 && x < 0.07 ? 0.32 : x < -0.08 ? 0.12 : 0));
  add(mats.wood(beech), stem);
  // the fence, a hand's width from the pin, its edges handled dark
  const fence = board(0.024, 0.044, 0.05, { along: 'z', rng, r: 0.006 });
  paintWear(fence, '#b8946c', (x, y, z) => (Math.abs(y) > 0.016 || Math.abs(z) > 0.02 ? 0.26 : 0));
  add(mats.wood('#b8946c'), fence.translate(-0.012, 0, 0));
  // the wedge through the fence's top
  add(mats.wood('#9a7650'), xf(board(0.012, 0.026, 0.009, { along: 'y', rng, r: 0.002 }), [-0.012, 0.026, 0.012], [0, 0, 0.12]));
  // the steel pin near the far end, its point down at the face
  add(mats.metal('#b9bcbe'), new THREE.CylinderGeometry(0.0012, 0.0004, 0.014, 4).translate(-0.084, -0.012, 0));
}
