// ─────────────────────────────────────────────────────────────────────────────
// The porch (SCHREINEREI.porch): a shingled lean-to on the annex front with a
// traditional Swiss Hobelbank — front vise & tail vise with wooden spindles,
// a row of dog holes, bench dogs holding a board mid-planing, a tool tray —
// on a trestle base with wedged through-tenons. On it: a jointer and a
// smoothing plane, chisels, a round mallet, a try square, a marking gauge, a
// folding rule and curly shavings. Jonny planes, shavings spring off.
// Hotspot 'workbench-wip' (the bench group).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { Batch, board, timber, xf, mat4, stoneGeo, mossGeo, ShingleField, layShingles, shingleGeo, uvBox, doubleFace, addLantern, addIvy, noiseA } from './kit.js';
import { ANNEX, annexFrame, annexMatrix, crook, annexToWorld } from './annex.js';
import { makeShavings, shavingGeo } from './fx.js';

/**
 * Bench placement in annex-local space (centre on the floor, rotation about Y).
 * Its vise side faces the wall: Jonny works between the bench and the wall and
 * faces the visitor across the bench, planing towards the oak.
 */
export const BENCH = { x: 1.72, z: 3.38, rotY: Math.PI - 0.62, length: 1.3, depth: 0.44, top: 0.48 };

export function buildPorch(ctx, B, mats, annexShingles = null) {
  const rng = createRng('porch');
  const F = annexFrame(B);
  const group = new THREE.Group();
  group.name = 'schreinerei-porch';
  ctx.scene.add(group);
  const P = ANNEX.porchRoof;
  const hz = ANNEX.hz;
  const z0 = hz + 0.02, z1 = hz + P.depth;
  const yAt = (z) => P.hi + ((P.lo - P.hi) * (z - z0)) / (z1 - z0); // underside of the rafters
  const tim = mats.timber();

  // ── lean-to structure: ledger on the wall, two posts, a front beam, rafters ─
  F.add(tim, timber([P.x0 - 0.1, P.hi - 0.05, z0 + 0.08], [P.x1 + 0.08, P.hi - 0.05, z0 + 0.08], 0.14, 0.16, { rng }));
  const postZ = z1 - 0.12;
  const postXs = [P.x0 + 0.1, P.x1 - 0.08];
  for (const x of postXs) {
    F.add(tim, timber([x, 0.12, postZ], [x + rng.jitter(0.02), yAt(postZ) - 0.14, postZ], 0.14, 0.14, { rng, up: [0, 0, 1] }));
    // stone footing
    F.add(mats.stone(), xf(stoneGeo(rng, { r: 1, sx: 0.16, sy: 0.08, sz: 0.16 }), [x, 0.06, postZ]));
    // curved knee braces into the front beam
    for (const s of [-1, 1]) {
      if ((x < 1.5 && s < 0) || (x > 1.5 && s > 0)) continue;
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push([x + s * t * 0.42, yAt(postZ) - 0.62 + t * 0.48 + Math.sin(t * Math.PI) * 0.05, postZ]);
      }
      F.add(tim, tubeAlong(pts, 0.045));
    }
  }
  // front beam (Pfette) with carved ends
  const fbY = yAt(postZ) - 0.07;
  F.add(tim, timber([P.x0 - 0.15, fbY, postZ], [P.x1 + 0.1, fbY, postZ], 0.15, 0.15, { rng }));
  // rafters
  for (let x = P.x0; x <= P.x1 + 0.01; x += (P.x1 - P.x0) / 3) {
    F.add(tim, timber([x, P.hi + 0.04, z0], [x, yAt(z1 + 0.3) + 0.04, z1 + 0.3], 0.09, 0.11, { rng, up: [0, 1, 0.3] }));
  }
  // roof boards + shingles
  const slope = Math.atan2(P.hi - P.lo, z1 - z0);
  const rl = Math.hypot(z1 + 0.32 - z0, yAt(z0) - yAt(z1 + 0.32));
  {
    const deck = new THREE.BoxGeometry(P.x1 - P.x0 + 0.42, 0.025, rl, 3, 1, 4);
    uvBox(deck, 'x');
    xf(deck, [(P.x0 + P.x1) / 2, (yAt(z0) + yAt(z1 + 0.32)) / 2 + 0.11, (z0 + z1 + 0.32) / 2], [slope, 0, 0]);
    F.add(mats.timber(), deck);
  }
  const field = annexShingles?.field ?? new ShingleField();
  const up = new THREE.Vector3(0, Math.sin(slope), -Math.cos(slope));
  const normal = new THREE.Vector3(0, Math.cos(slope), Math.sin(slope));
  layShingles(field, {
    origin: new THREE.Vector3(P.x0 - 0.21, yAt(z1 + 0.34) + 0.15, z1 + 0.34),
    alongDir: new THREE.Vector3(1, 0, 0),
    upDir: up,
    normal,
    length: P.x1 - P.x0 + 0.42,
    height: rl - 0.04,
    rng,
    tint: (u, v, c, p) => {
      const n = noiseA(p.x * 1.3, p.z * 1.3) * 0.5 + 0.5;
      const mossy = THREE.MathUtils.clamp((1 - v / 0.9) * 0.6 + (n - 0.6) * 2, 0, 1);
      if (mossy > 0.05) c.lerp(new THREE.Color(0.55, 0.78, 0.36), mossy * 0.6);
    },
    transform: (p) => crook(p),
  });
  if (!annexShingles) {
    const sh = field.build(group, mats.shingles(), shingleGeo(0.2, 0.34, 0.022));
    if (sh) sh.applyMatrix4(annexMatrix);
  }
  // a lantern hanging from the front beam, over Jonny's bench
  {
    const lx = (P.x0 + P.x1) / 2 + 0.15;
    const hook = annexToWorld(lx, fbY - 0.08, postZ);
    F.add(mats.metal('#2f2b28'), xf(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 4), [lx, fbY - 0.1, postZ]), { cast: false });
    addLantern(F, mats, [lx, fbY - 0.15, postZ], hook.setY(hook.y - 0.07), { scale: 0.7 });
  }
  // a bow saw hanging on a peg on the right post, a coil of rope below it
  {
    const px = postXs[1], pz = postZ + 0.1;
    const beech = mats.wood('beech');
    const sx = px, sy = 1.2;
    F.add(mats.wood('walnut'), xf(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6), [sx, sy + 0.22, pz - 0.02], [Math.PI / 2, 0, 0]), { cast: false });
    for (const s of [-1, 1]) F.add(beech, xf(board(0.025, 0.42, 0.02, { along: 'y', rng }), [sx + s * 0.16, sy, pz]), { cast: false });
    F.add(beech, xf(board(0.32, 0.025, 0.02, { along: 'x', rng }), [sx, sy + 0.02, pz]), { cast: false });
    F.add(mats.metal('#a8afb5'), xf(new THREE.BoxGeometry(0.33, 0.02, 0.003), [sx, sy - 0.19, pz]), { cast: false });
    F.add(mats.rope(), xf(new THREE.CylinderGeometry(0.004, 0.004, 0.33, 4), [sx, sy + 0.19, pz], [0, 0, Math.PI / 2]), { cast: false });
    F.add(mats.rope(), xf(new THREE.TorusGeometry(0.09, 0.016, 5, 16), [px, 0.75, pz + 0.01]), { cast: false });
    F.add(mats.rope(), xf(new THREE.TorusGeometry(0.08, 0.016, 5, 16), [px + 0.01, 0.73, pz + 0.03], [0, 0, 0.3]), { cast: false });
  }
  // ivy trailing down from the porch eave and up the left post
  for (let i = 0; i < 6; i++) {
    const x = P.x0 - 0.1 + rng.next() * (P.x1 - P.x0 + 0.2);
    addIvy(F, mats, rng, [x, fbY + 0.02, postZ + 0.09], [rng.jitter(0.3), -1, 0], { length: rng.range(0.35, 0.8), droop: 1, size: 0.06, normal: [0, 0, 1] });
  }
  addIvy(F, mats, rng, [postXs[0] + 0.08, 0.1, postZ + 0.02], [0.1, 1, 0], { length: 1.5, droop: -0.6, size: 0.065, normal: [0, 0, 1] });
  // a fascia board and moss along the porch eave
  F.add(mats.wood('oak'), xf(board(P.x1 - P.x0 + 0.46, 0.12, 0.035, { along: 'x', rng }), [(P.x0 + P.x1) / 2, yAt(z1 + 0.32) + 0.08, z1 + 0.34], [slope, 0, 0]));
  for (let x = P.x0 - 0.15; x < P.x1 + 0.2; x += rng.range(0.25, 0.45)) {
    F.add(mats.moss(), xf(mossGeo(rng, { r: rng.range(0.1, 0.18), h: 0.05 }), [x, yAt(z1 + 0.2) + 0.2, z1 + 0.18], [slope, 0, 0], [1, 1, 0.8]), { cast: false });
  }

  // ── porch floor: worn flagstones with sawdust ──────────────────────────────
  for (let i = 0; i < 26; i++) {
    const x = P.x0 - 0.2 + rng.next() * (P.x1 - P.x0 + 0.5);
    const z = z0 + 0.12 + rng.next() * (P.depth + 0.25);
    const g = stoneGeo(rng, { r: 1, sx: rng.range(0.18, 0.32), sy: 0.035, sz: rng.range(0.15, 0.28), lump: 0.1 });
    F.add(mats.stone(), xf(g, [x, 0.01, z], [0, rng.next() * 3, 0]), { cast: false });
  }

  // ── the Hobelbank (its own group: the hotspot) ─────────────────────────────
  const bench = buildHobelbank(ctx, mats.piece, rng);
  const bp = annexToWorld(BENCH.x, 0, BENCH.z);
  bench.position.copy(bp);
  bench.rotation.y = ctx.layout.SCHREINEREI.annex.rotY + BENCH.rotY;
  group.add(bench);

  // shavings on the floor around the bench and a little pile against the leg
  {
    // merged into the shared batch (curly maple ribbons, visible from both sides)
    const sg = doubleFace(shavingGeo(0.035, 0.022, 1.3));
    const count = Math.round(60 * (ctx.quality?.density ?? 1));
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sv = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      // scatter in bench-local space, mostly on Jonny's side and towards the tail vise
      const lx = rng.range(-0.8, 0.9) + rng.jitter(0.2);
      const lz = rng.range(-0.1, 0.9) * (rng.next() < 0.5 ? 1 : 0.6);
      p.set(lx, 0.02 + rng.next() * 0.02, lz).applyEuler(bench.rotation).add(bench.position);
      const sc = rng.range(0.8, 1.5);
      m.compose(p, q.setFromEuler(e.set(rng.next() * 6, rng.next() * 6, rng.next() * 6)), sv.set(sc, sc, sc));
      B.add(mats.wood('maple'), sg.clone().applyMatrix4(m), { cast: false });
    }
  }

  // ── Jonny, planing ─────────────────────────────────────────────────────────
  const jonny = ctx.props.makePerson({ seed: 'jonny', name: 'Jonny', apron: true, hat: 'beanie', hatColor: '#c4532e', holding: 'plane', action: 'work', skin: '#efc19c', hairColor: '#6b4430', shirt: '#4f7a5a' });
  {
    // stands at the bench front, facing along the bench towards the front vise (−x bench-local)
    const local = new THREE.Vector3(0.36, 0, BENCH.depth / 2 + 0.3);
    local.applyEuler(bench.rotation).add(bench.position);
    jonny.group.position.copy(local);
    jonny.group.rotation.y = bench.rotation.y - Math.PI / 2;
    jonny.group.name = 'jonny';
    group.add(jonny.group);
  }
  // shavings springing off the plane (spawn at the plane's mouth)
  const handPos = new THREE.Vector3();
  const back = new THREE.Vector3(1, 0, 0).applyEuler(bench.rotation);
  const shavings = makeShavings(ctx, {
    count: 14,
    source: (out) => {
      jonny.hand.getWorldPosition(handPos);
      out.copy(handPos).addScaledVector(back, -0.06);
      out.y = Math.max(out.y, bench.position.y + BENCH.top + 0.06);
      return out;
    },
    dir: back,
    floorY: bench.position.y + BENCH.top + 0.035,
  });
  group.add(shavings.object);

  return {
    group,
    bench,
    jonny,
    update(dt) {
      shavings.update(dt);
    },
  };
}

/** A tube through points (for curved braces). */
function tubeAlong(pts, r) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const g = new THREE.TubeGeometry(curve, 8, r, 6, false);
  return uvBox(g, 'x', 1 / 1.6);
}

/**
 * A Swiss Hobelbank, built in its own group (origin on the floor at the bench
 * centre, length along X, the worker stands at +Z). Tools & a board on top.
 */
function buildHobelbank(ctx, mats, rng) {
  const g = new THREE.Group();
  g.name = 'hobelbank';
  const Bb = new Batch();
  const L = BENCH.length, D = BENCH.depth, H = BENCH.top;
  const beech = mats.wood('beech');
  const beechDark = mats.wood('#a27c58');
  const steel = mats.metal('#8f969b');
  const tt = 0.075; // top thickness
  // the top: a thick front plank, a tool tray (Beilade) behind, a back rail
  const frontW = D * 0.62;
  Bb.add(beech, xf(board(L, tt, frontW, { along: 'x', rng, r: 0.008 }), [0, H - tt / 2, D / 2 - frontW / 2]));
  Bb.add(beech, xf(board(L, 0.02, D - frontW - 0.03, { along: 'x', rng }), [0, H - tt + 0.02, -D / 2 + (D - frontW) / 2]));
  Bb.add(beech, xf(board(L, tt * 0.8, 0.03, { along: 'x', rng }), [0, H - tt * 0.4, -D / 2 + 0.015]));
  // dog holes along the front edge (dark insets) + two bench dogs holding the board
  const vc = mats.vc();
  for (let i = 0; i < 9; i++) {
    const x = -L / 2 + 0.2 + i * 0.105;
    Bb.add(vc, xf(new THREE.BoxGeometry(0.022, 0.004, 0.03), [x, H + 0.001, D / 2 - 0.05]), { color: '#2a1b10', cast: false });
  }
  // front vise (Vorderzange) at the left front: jaw, wooden spindle, tommy bar
  {
    const vx = -L / 2 + 0.1;
    Bb.add(beechDark, xf(board(0.2, 0.17, 0.06, { along: 'x', rng }), [vx, H - 0.085, D / 2 + 0.06]));
    Bb.add(beechDark, xf(board(0.06, 0.16, 0.24, { along: 'z', rng }), [vx + 0.07, H - 0.11, D / 2 - 0.06]));
    const spindle = new THREE.CylinderGeometry(0.022, 0.022, 0.18, 10);
    Bb.add(beech, xf(uvBox(spindle, 'y'), [vx, H - 0.1, D / 2 + 0.14], [Math.PI / 2, 0, 0]));
    Bb.add(beech, xf(new THREE.CylinderGeometry(0.036, 0.036, 0.04, 10), [vx, H - 0.1, D / 2 + 0.11], [Math.PI / 2, 0, 0]));
    Bb.add(beech, xf(new THREE.CylinderGeometry(0.009, 0.009, 0.22, 6), [vx, H - 0.1, D / 2 + 0.2], [0, 0, 0.35]));
  }
  // tail vise (Hinterzange) at the right end: moving block with a dog, spindle, bar
  {
    const tx = L / 2 + 0.06;
    Bb.add(beechDark, xf(board(0.22, tt + 0.04, frontW * 0.9, { along: 'x', rng }), [tx, H - (tt + 0.04) / 2, D / 2 - frontW * 0.45]));
    const spindle = new THREE.CylinderGeometry(0.024, 0.024, 0.16, 10);
    Bb.add(beech, xf(uvBox(spindle, 'y'), [tx + 0.18, H - 0.06, D / 2 - frontW * 0.45], [0, 0, Math.PI / 2]));
    Bb.add(beech, xf(new THREE.CylinderGeometry(0.009, 0.009, 0.22, 6), [tx + 0.26, H - 0.06, D / 2 - frontW * 0.45], [0.35, 0, 0]));
    Bb.add(vc, xf(new THREE.BoxGeometry(0.022, 0.004, 0.03), [tx - 0.03, H + 0.001, D / 2 - 0.05]), { color: '#2a1b10', cast: false });
  }
  // trestle base: two legs per end on a foot (Kufe), top bearer, stretchers with
  // wedged through-tenons, and a lower shelf
  for (const s of [-1, 1]) {
    const x = s * (L / 2 - 0.2);
    for (const t of [-1, 1]) Bb.add(beechDark, xf(board(0.065, H - tt - 0.06, 0.065, { along: 'y', rng }), [x, (H - tt - 0.06) / 2 + 0.05, t * (D / 2 - 0.08)]));
    Bb.add(beechDark, xf(board(0.08, 0.06, D + 0.08, { along: 'z', rng }), [x, 0.03, 0]));
    Bb.add(beechDark, xf(board(0.07, 0.05, D - 0.02, { along: 'z', rng }), [x, H - tt - 0.03, 0]));
  }
  for (const y of [0.16]) {
    for (const t of [-1, 1]) {
      Bb.add(beechDark, xf(board(L - 0.3, 0.07, 0.04, { along: 'x', rng }), [0, y, t * (D / 2 - 0.08)]));
      // through-tenons poking out past the legs, with wedges
      for (const s of [-1, 1]) {
        Bb.add(beechDark, xf(board(0.06, 0.05, 0.035, { along: 'x', rng }), [s * (L / 2 - 0.12), y, t * (D / 2 - 0.08)]));
        Bb.add(mats.wood('walnut'), xf(new THREE.BoxGeometry(0.012, 0.055, 0.04), [s * (L / 2 - 0.1), y, t * (D / 2 - 0.08)]), { cast: false });
      }
    }
  }
  // lower shelf with a spare plane and a box of offcuts
  Bb.add(mats.wood('spruce'), xf(board(L - 0.42, 0.02, D - 0.2, { along: 'x', rng }), [0, 0.2, 0]));
  addPlane(Bb, mats, rng, [-0.2, 0.21 + 0.025, 0], 0.26, 0.07);
  Bb.add(mats.wood('cherry'), xf(board(0.16, 0.05, 0.06, { along: 'x', rng }), [0.25, 0.235, 0.04], [0, 0.6, 0]));
  Bb.add(mats.wood('walnut'), xf(board(0.12, 0.04, 0.05, { along: 'x', rng }), [0.3, 0.27, -0.02], [0, -0.3, 0]));

  // ── on the bench: the board being planed (half planed = lighter) ──────────
  const boardY = H + 0.017;
  {
    const bx0 = -0.05, bx1 = L / 2 + 0.08; // between a bench dog and the tail vise dog
    const bz = D / 2 - 0.11;
    const len = bx1 - bx0;
    const planedTo = 0.55;
    Bb.add(mats.wood('oak'), xf(board(len * (1 - planedTo), 0.032, 0.13, { along: 'x', rng }), [bx0 + (len * (1 - planedTo)) / 2, boardY, bz]));
    Bb.add(mats.wood('maple'), xf(board(len * planedTo, 0.03, 0.13, { along: 'x', rng }), [bx1 - (len * planedTo) / 2, boardY - 0.001, bz]));
    // bench dogs (steel heads) at both ends of the board
    Bb.add(steel, xf(new THREE.BoxGeometry(0.02, 0.045, 0.028), [bx0 - 0.015, H + 0.02, bz + 0.0]), { cast: false });
    Bb.add(steel, xf(new THREE.BoxGeometry(0.02, 0.045, 0.028), [bx1 + 0.015, H + 0.02, bz + 0.0]), { cast: false });
  }
  // a jointer (Rauhbank) and a smoother lying on their sides behind the board
  addPlane(Bb, mats, rng, [-0.4, H + 0.03, -0.1], 0.36, 0.072, Math.PI / 2 - 0.15);
  addPlane(Bb, mats, rng, [-0.02, H + 0.026, -0.12], 0.18, 0.06, Math.PI / 2 + 0.2);
  // chisels laid out in a row on a cloth roll
  Bb.add(mats.fabric('#7a5a3a'), xf(new THREE.BoxGeometry(0.3, 0.006, 0.17), [-0.45, H + 0.003, 0.11], [0, 0.1, 0]), { cast: false });
  for (let i = 0; i < 4; i++) {
    const x = -0.56 + i * 0.075, z = 0.11;
    Bb.add(mats.wood('ash'), xf(new THREE.CylinderGeometry(0.012, 0.014, 0.085, 8), [x, H + 0.018, z - 0.045], [Math.PI / 2, 0, 0]), { cast: false });
    Bb.add(mats.wood('walnut'), xf(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 8), [x, H + 0.018, z - 0.0], [Math.PI / 2, 0, 0]), { cast: false });
    Bb.add(steel, xf(new THREE.BoxGeometry(0.01 + i * 0.006, 0.006, 0.08), [x, H + 0.012, z + 0.045]), { cast: false });
  }
  // the round mallet (Klüpfel)
  {
    const head = new THREE.CylinderGeometry(0.042, 0.05, 0.1, 12);
    Bb.add(mats.wood('ash'), xf(uvBox(head, 'y'), [0.1, H + 0.045, 0.04], [Math.PI / 2 - 0.1, 0, 0.3]), { cast: false });
    Bb.add(mats.wood('ash'), xf(new THREE.CylinderGeometry(0.013, 0.015, 0.14, 8), [0.07, H + 0.016, 0.14], [Math.PI / 2, 0.3, 0]), { cast: false });
  }
  // try square (steel blade in a rosewood stock)
  Bb.add(mats.wood('walnut'), xf(board(0.1, 0.012, 0.025, { along: 'x' }), [0.3, H + 0.006, -0.12]), { cast: false });
  Bb.add(steel, xf(new THREE.BoxGeometry(0.004, 0.006, 0.14), [0.25, H + 0.004, -0.06]), { cast: false });
  // marking gauge (Streichmass)
  Bb.add(mats.wood('cherry'), xf(board(0.05, 0.05, 0.02, { along: 'y' }), [0.42, H + 0.012, 0.02], [Math.PI / 2, 0, 0.4]), { cast: false });
  Bb.add(mats.wood('maple'), xf(new THREE.BoxGeometry(0.16, 0.012, 0.012), [0.42, H + 0.012, 0.02], [0, 0.4 + Math.PI / 2, 0]), { cast: false });
  // yellow folding rule (Meterstab), partly unfolded, and a carpenter's pencil
  for (let i = 0; i < 4; i++) {
    Bb.add(vc, xf(new THREE.BoxGeometry(0.1, 0.004, 0.016), [-0.15 + i * 0.07, H + 0.003 + (i % 2) * 0.004, -0.17 + (i % 2) * 0.01], [0, (i % 2 ? 0.3 : -0.1), 0]), { color: '#e8c22a', cast: false });
  }
  Bb.add(vc, xf(new THREE.BoxGeometry(0.09, 0.008, 0.014), [0.35, H + 0.004, 0.12], [0, 1.1, 0]), { color: '#c4271c', cast: false });
  // a heap of curly shavings on the bench top
  {
    const sg = doubleFace(shavingGeo(0.03, 0.02, 1.4));
    for (let i = 0; i < 26; i++) {
      const c = sg.clone();
      const sc = rng.range(0.7, 1.3);
      xf(c, [rng.range(0.0, L / 2 + 0.1), H + 0.012 + rng.next() * 0.025, rng.range(-0.15, D / 2 - 0.02)], [rng.next() * 6, rng.next() * 6, rng.next() * 6], sc);
      Bb.add(mats.wood('maple'), c, { cast: false });
    }
  }
  Bb.build(g, 'hobelbank', { mergeShadow: true });
  return g;
}

/** A Swiss horned hand plane (Hobel): beech body, horn, iron, wedge. */
function addPlane(Bb, mats, rng, pos, len, h, rotX = 0) {
  const body = board(len, h * 0.62, h * 0.55, { along: 'x', rng, r: 0.008 });
  const horn = uvBox(new THREE.CylinderGeometry(h * 0.16, h * 0.22, h * 0.6, 8), 'y');
  horn.rotateZ(-0.35);
  horn.translate(len * 0.32, h * 0.45, 0);
  const iron = new THREE.BoxGeometry(h * 0.08, h * 0.7, h * 0.4);
  iron.rotateZ(0.8);
  iron.translate(-len * 0.02, h * 0.3, 0);
  const wedge = new THREE.BoxGeometry(h * 0.14, h * 0.5, h * 0.32);
  wedge.rotateZ(0.8);
  wedge.translate(-len * 0.08, h * 0.32, 0);
  const tr = mat4(pos, [rotX ? rotX : 0, rng.jitter(0.4), 0]);
  // lying on its side when rotX is given (sole facing the viewer)
  const parts = [[mats.wood('beech'), body], [mats.wood('beech'), horn], [mats.metal('#9aa1a6'), iron], [mats.wood('walnut'), wedge]];
  for (const [mat, geo] of parts) {
    geo.applyMatrix4(tr);
    Bb.add(mat, geo, { cast: mat !== parts[2][0] });
  }
}
