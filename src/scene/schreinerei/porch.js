// ─────────────────────────────────────────────────────────────────────────────
// The porch (SCHREINEREI.porch): a shingled lean-to on the annex front with a
// traditional Swiss Hobelbank at real working height — a light beech top over
// a dark steamed-beech trestle base, the front vise and the tail vise with fat
// threaded wooden spindles and long tommy bars (Knebel), a row of dog holes,
// a tool tray (Beilade), wedged through-tenons. On it a glued-up oak panel
// between two bench dogs, half flattened; the planes, the square and a dark
// round mallet (Klüpfel) wait in the tray. Jonny stands on a slatted duckboard
// (Lattenrost) behind the bench, facing the visitor, traversing the panel;
// shavings spring off his plane. An enamel work lamp hangs over the bench
// (budgeted point light + halo). Hotspot 'workbench-wip' (the bench group).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng, clamp } from '../../core/rng.js';
import { SPOTS } from '../../world/layout.js';
import {
  Batch, board, timber, xf, mat4, stoneGeo, mossGeo, ShingleField, layShingles, shingleGeo, uvBox, doubleFace,
  addLantern, addIvy, paint, SPECIES, noiseA, addBowSaw, turned, pushHalo,
} from './kit.js';
import { ANNEX, annexFrame, annexMatrix, crook, annexToWorld } from './annex.js';
import { makeShavings, shavingGeo } from './fx.js';

/**
 * Bench placement in annex-local space (centre on the floor, rotation about Y).
 * Its vise side faces the wall: Jonny works between the bench and the wall and
 * faces the visitor across the bench. `top` is the working height — the
 * tallest work surface of the shop (sawhorses, the inner bench and the annex
 * plinth all stay lower); it is fine-tuned to Jonny's hands at build time.
 */
export const BENCH = { x: 1.7, z: 3.42, rotY: Math.PI - 0.3, length: 1.55, depth: 0.5, top: 0.47 };

/** Height of the slatted duckboard Jonny stands on. */
const DUCK = 0.09;
/** The glued-up panel on the bench (bench-local): centre of the flattened part where the plane works. */
const BOARD = { x: 0.16, z: BENCH.depth / 2 - 0.125, x0: -0.06, w: 0.22, t: 0.03 };
/** The plane's sole (under the held plane) in the hand's frame (props/tools.js plane + TOOL_INFO). */
const SOLE = new THREE.Vector3(0.05, -0.125, -0.067);

const BEECH_TOP = '#dcbd97'; // freshly oiled beech top
const BEECH_BASE = '#7a5539'; // steamed, darkened beech base
const OAK_PLANED = '#d3b98f'; // freshly planed oak (pale, a little glossy)

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
  const tim = mats.frame();

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
  // a lantern on the left end of the front beam, lighting the way to the
  // workshop door (no point light of its own: its halo does the glowing)
  {
    const lx = P.x0 - 0.08;
    const hook = annexToWorld(lx, fbY - 0.08, postZ + 0.1);
    F.add(mats.metal('#2f2b28'), xf(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 4), [lx, fbY - 0.1, postZ + 0.1]), { cast: false });
    addLantern(F, mats, [lx, fbY - 0.15, postZ + 0.1], hook.clone().setY(hook.y - 0.07), { scale: 0.7 });
  }
  // a frame saw hanging on a peg on the right post, a coil of rope below it
  {
    const px = postXs[1], pz = postZ + 0.1;
    F.add(mats.wood('walnut'), xf(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6), [px, 1.47, pz - 0.02], [Math.PI / 2, 0, 0]), { cast: false });
    addBowSaw(F, mats, rng, mat4([px, 1.24, pz + 0.01], [0, 0, 0.04]), { scale: 0.72 });
    F.add(mats.rope(), xf(new THREE.TorusGeometry(0.09, 0.016, 5, 16), [px, 0.72, pz + 0.01]), { cast: false });
    F.add(mats.rope(), xf(new THREE.TorusGeometry(0.08, 0.016, 5, 16), [px + 0.01, 0.7, pz + 0.03], [0, 0, 0.3]), { cast: false });
  }
  // ivy trailing down from the porch eave (only short wisps in front of the
  // bench, so nothing hangs across Jonny's face) and up the left post
  for (let i = 0; i < 6; i++) {
    const x = P.x0 - 0.1 + rng.next() * (P.x1 - P.x0 + 0.2);
    const overBench = x > P.x0 + 0.2 && x < P.x1 - 0.25;
    addIvy(F, mats, rng, [x, fbY + 0.02, postZ + 0.09], [rng.jitter(0.3), -1, 0], { length: overBench ? rng.range(0.15, 0.25) : rng.range(0.35, 0.8), droop: 1, size: 0.06, normal: [0, 0, 1] });
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
    const g = stoneGeo(rng, { r: 1, sx: rng.range(0.18, 0.32), sy: 0.035, sz: rng.range(0.15, 0.28), lump: 0.1, detail: 0 });
    F.add(mats.stone(), xf(g, [x, 0.01, z], [0, rng.next() * 3, 0]), { cast: false });
  }

  // ── Jonny: his stance decides the working height ───────────────────────────
  // A light linen shirt under a canvas apron and a petrol beanie: three clear
  // colour blocks that read from the woodworking camera.
  const jonny = ctx.props.makePerson({
    seed: 'jonny', name: 'Jonny', apron: true, apronColor: '#b07a48', hat: 'beanie', hatColor: '#2f6f86',
    holding: 'plane', action: 'work', skin: '#efc19c', hairColor: '#6b4430', shirt: '#e8dfcc', pants: '#4a5468',
  });
  jonny.group.name = 'jonny';
  const benchRotY = ctx.layout.SCHREINEREI.annex.rotY + BENCH.rotY;
  const bp = annexToWorld(BENCH.x, 0, BENCH.z);
  // He faces between the visitor (the spot camera) and his planing direction
  // (towards the front vise): his face reads from the spot while the plane
  // traverses the glued-up panel diagonally — the classic first pass when
  // flattening a panel (übers Kreuz hobeln).
  const camPos = SPOTS.find((s) => s.id === 'woodworking')?.camera.position;
  const camAz = camPos ? Math.atan2(camPos[0] - bp.x, camPos[2] - bp.z) : benchRotY + Math.PI;
  const strokeAz = Math.atan2(-Math.cos(benchRotY), Math.sin(benchRotY));
  const faceAz = camAz + 0.45 * wrapAngle(strokeAz - camAz);
  jonny.group.rotation.y = faceAz;
  // the mid-stroke 'plane' work pose, to measure where his plane's sole is
  const armR = jonny.hand.parent, torso = armR?.parent;
  const pose = () => {
    const saved = armR && torso ? [armR.rotation.clone(), torso.rotation.clone()] : null;
    if (saved) {
      armR.rotation.set(-1.22, 0, 0.25);
      torso.rotation.set(0.24, 0, 0);
    }
    jonny.group.updateMatrixWorld(true);
    const sole = jonny.hand.localToWorld(SOLE.clone());
    if (saved) {
      armR.rotation.copy(saved[0]);
      torso.rotation.copy(saved[1]);
      jonny.group.updateMatrixWorld(true);
    }
    return sole;
  };
  jonny.group.position.set(0, 0, 0);
  const soleY = pose().y;
  // working height = his plane on the panel while he stands on the duckboard
  BENCH.top = clamp(soleY + DUCK - BOARD.t, 0.42, 0.52);
  const standY = BENCH.top + BOARD.t - soleY; // = DUCK unless the clamp kicked in

  // ── the Hobelbank (its own group: the hotspot) ─────────────────────────────
  const bench = buildHobelbank(ctx, mats.piece, rng);
  bench.position.copy(bp);
  bench.rotation.y = benchRotY;
  group.add(bench);
  bench.updateMatrixWorld(true);
  const benchInv = bench.matrixWorld.clone().invert();

  // slide Jonny (horizontally) until the plane's sole sits on the panel mid-stroke
  {
    jonny.group.position.copy(new THREE.Vector3(BOARD.x, 0, BENCH.depth / 2 + 0.45).applyMatrix4(bench.matrixWorld));
    jonny.group.position.y = 0;
    const s = pose().applyMatrix4(benchInv);
    const d = new THREE.Vector3(BOARD.x - s.x, 0, BOARD.z - s.z).applyEuler(new THREE.Euler(0, bench.rotation.y, 0));
    const pl = jonny.group.position.clone().add(d).applyMatrix4(benchInv);
    // never into the bench: his belly stays a body's width off its front edge
    pl.z = Math.max(pl.z, BENCH.depth / 2 + 0.2);
    pl.y = 0;
    jonny.group.position.copy(pl.applyMatrix4(bench.matrixWorld)).setY(bench.position.y + standY);
    group.add(jonny.group);
    jonny.group.updateMatrixWorld(true);
  }
  // eyes on the work, just ahead of the plane
  jonny.lookAt?.(new THREE.Vector3(BOARD.x - 0.15, BENCH.top + 0.05, BOARD.z).applyMatrix4(bench.matrixWorld));

  // ── the duckboard (Lattenrost) under his feet, parallel to the bench ───────
  const jl = jonny.group.position.clone().applyMatrix4(benchInv);
  const duck = { x: jl.x, z: Math.max(jl.z, BENCH.depth / 2 + 0.25), w: 0.74, d: 0.44, h: Math.max(0.05, standY) };
  {
    const Db = B.at(bench.matrixWorld.clone().multiply(mat4([duck.x, 0, duck.z], [0, rng.jitter(0.04), 0])));
    const wood = mats.wood('#a48c6a');
    const slatT = 0.024;
    for (const x of [-duck.w / 2 + 0.08, 0, duck.w / 2 - 0.08]) {
      Db.add(wood, board(0.05, duck.h - slatT, duck.d - 0.02, { along: 'z', rng }).translate(x, (duck.h - slatT) / 2, 0), { cast: false });
    }
    const n = 6, gap = 0.016;
    const sw = (duck.d - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const z = -duck.d / 2 + sw / 2 + i * (sw + gap);
      Db.add(wood, board(duck.w + rng.jitter(0.02), slatT, sw - 0.004, { along: 'x', rng, r: 0.006 }).translate(rng.jitter(0.01), duck.h - slatT / 2, z), { color: rng.pick(['#a48c6a', '#9a8262', '#ae9572']) });
    }
  }

  // shavings on the floor around the bench (and a few on the duckboard)
  {
    const sg = doubleFace(shavingGeo(0.035, 0.022, 1.3));
    const count = Math.round(60 * (ctx.quality?.density ?? 1));
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sv = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      // bench-local: mostly on Jonny's side and towards the tail vise, some spilled in front
      const lx = rng.range(-0.85, 1.0) + rng.jitter(0.2);
      const lz = rng.next() < 0.7 ? rng.range(0.25, 0.85) : rng.range(-0.55, -0.25);
      const onDuck = Math.abs(lx - duck.x) < duck.w / 2 && Math.abs(lz - duck.z) < duck.d / 2;
      p.set(lx, (onDuck ? duck.h : 0) + 0.02 + rng.next() * 0.02, lz).applyMatrix4(bench.matrixWorld);
      const sc = rng.range(0.8, 1.5);
      m.compose(p, q.setFromEuler(e.set(rng.next() * 6, rng.next() * 6, rng.next() * 6)), sv.set(sc, sc, sc));
      B.add(mats.wood('maple'), sg.clone().applyMatrix4(m), { cast: false });
    }
  }

  // ── the work lamp: an enamel pendant over the bench (point light + halo) ──
  let lampLight = null;
  const lampPos = new THREE.Vector3();
  {
    // over the front-vise end, ahead of the stroke: it lights the panel and
    // Jonny's face, and hangs clear of his beanie (and of the porch posts) in
    // the spot view, against the bright window
    const lampLocal = new THREE.Vector3(-0.5, BENCH.top + 1.02, 0.02).applyAxisAngle(new THREE.Vector3(0, 1, 0), BENCH.rotY);
    const lx = BENCH.x + lampLocal.x, lz = BENCH.z + lampLocal.z, ly = lampLocal.y;
    const cordTop = yAt(lz) + 0.1;
    const enamel = mats.metal('#2f5a46');
    F.add(mats.metal('#2a2624'), xf(new THREE.CylinderGeometry(0.005, 0.005, cordTop - ly - 0.06, 4), [lx, (cordTop + ly + 0.06) / 2, lz]), { cast: false });
    F.add(enamel, xf(new THREE.CylinderGeometry(0.03, 0.036, 0.05, 10), [lx, ly + 0.05, lz]), { cast: false });
    F.add(enamel, xf(new THREE.ConeGeometry(0.16, 0.11, 18, 1, true), [lx, ly, lz]), { cast: false });
    F.add(mats.vc(), xf(doubleFace(new THREE.ConeGeometry(0.152, 0.104, 18, 1, true)), [lx, ly - 0.002, lz]), { color: '#f4ecd8', cast: false, receive: false });
    F.add(enamel, xf(new THREE.TorusGeometry(0.16, 0.007, 4, 18), [lx, ly - 0.055, lz], [Math.PI / 2, 0, 0]), { cast: false });
    F.add(mats.glow('#ffd79a', 0.9), xf(new THREE.SphereGeometry(0.04, 10, 8), [lx, ly - 0.04, lz], null, [1, 1.2, 1]), { cast: false, receive: false });
    const bulb = annexToWorld(lx, ly - 0.05, lz);
    lampPos.copy(bulb);
    pushHalo(bulb, 0.55);
    lampLight = ctx.lights?.addPoint?.(bulb.clone().setY(bulb.y - 0.08), { color: '#ffc477', day: 1.2, night: 5, distance: 4.2 }) ?? null;
  }

  // shavings springing off the plane's mouth: up, back along the stroke and
  // over the front of the bench (towards the visitor); they land on the bench
  // top or tumble down to the porch floor
  const handPos = new THREE.Vector3();
  const back = new THREE.Vector3(Math.sin(faceAz), 0, Math.cos(faceAz)).negate();
  const side = new THREE.Vector3(0, 0, -1).applyEuler(bench.rotation);
  const fl = new THREE.Vector3();
  const topY = bench.position.y + BENCH.top + BOARD.t;
  const shavings = makeShavings(ctx, {
    count: 20,
    rate: 4.2,
    // the same pale maple as the shavings already lying about
    material: mats.wood('maple').material,
    geometry: paint(doubleFace(shavingGeo(0.044, 0.028, 1.4)), SPECIES.maple),
    source: (out) => {
      jonny.hand.getWorldPosition(handPos);
      out.copy(handPos).addScaledVector(back, 0.04);
      out.y = Math.max(out.y, topY + 0.04);
      return out;
    },
    dir: back,
    side,
    floorAt: (p) => {
      fl.copy(p).applyMatrix4(benchInv);
      if (Math.abs(fl.x) < BENCH.length / 2 + 0.08 && Math.abs(fl.z) < BENCH.depth / 2) return topY;
      if (Math.abs(fl.x - duck.x) < duck.w / 2 && Math.abs(fl.z - duck.z) < duck.d / 2) return bench.position.y + duck.h + 0.01;
      return bench.position.y + 0.03;
    },
  });
  group.add(shavings.object);

  // Jonny is driven here (not by the props ticker) so his head can come up a
  // little from the work: from the spot his face reads, not just his beanie.
  const head = jonny.head;
  return {
    group,
    bench,
    jonny,
    light: lampLight,
    lampPos,
    update(dt) {
      jonny.update(dt);
      if (head) {
        head.rotation.x = 0.1;
        head.rotation.y = -0.18;
      }
      shavings.update(dt);
    },
  };
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** A tube through points (for curved braces). */
function tubeAlong(pts, r) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const g = new THREE.TubeGeometry(curve, 8, r, 6, false);
  return uvBox(g, 'x', 1 / 1.6);
}

/**
 * A Swiss Hobelbank, built in its own group (origin on the floor at the bench
 * centre, length along X, the worker stands at +Z). Light beech top, dark
 * steamed-beech base; front vise at the worker's left (−X), tail vise at the
 * right end (+X). A panel between two dogs, the tools in the tray.
 */
function buildHobelbank(ctx, mats, rng) {
  const g = new THREE.Group();
  g.name = 'hobelbank';
  const Bb = new Batch();
  const L = BENCH.length, D = BENCH.depth, H = BENCH.top;
  const top = mats.wood(BEECH_TOP);
  const base = mats.wood(BEECH_BASE);
  const vise = mats.wood('#c9a47c');
  const steel = mats.metal('#8f969b');
  const vc = mats.vc();
  const tt = 0.085; // top thickness
  // ── the top: a thick front plank, the tool tray (Beilade), a back rail ────
  const frontW = 0.31;
  Bb.add(top, xf(board(L, tt, frontW, { along: 'x', rng, r: 0.01 }), [0, H - tt / 2, D / 2 - frontW / 2]));
  const trayW = D - frontW - 0.035;
  Bb.add(mats.wood('#c8a581'), xf(board(L - 0.02, 0.02, trayW, { along: 'x', rng }), [0, H - tt + 0.025, -D / 2 + 0.035 + trayW / 2]));
  Bb.add(top, xf(board(L, tt * 0.85, 0.035, { along: 'x', rng }), [0, H - tt * 0.425, -D / 2 + 0.0175]));
  // end caps of the tray (the tray ends are closed)
  for (const s of [-1, 1]) Bb.add(top, xf(board(0.03, tt * 0.7, trayW, { along: 'z', rng }), [s * (L / 2 - 0.015), H - tt * 0.45, -D / 2 + 0.035 + trayW / 2]));
  // dog holes along the front edge (dark insets)
  const dogZ = D / 2 - 0.05;
  for (let i = 0; i < 10; i++) {
    const x = -L / 2 + 0.3 + i * 0.112;
    Bb.add(vc, xf(new THREE.BoxGeometry(0.022, 0.004, 0.03), [x, H + 0.001, dogZ]), { color: '#2a1b10', cast: false });
  }
  // a fat threaded wooden spindle along its local +Y (thread rings), the
  // spindle head and the long tommy bar (Knebel) through it; `kDir` is the
  // bar's direction in spindle space (pointing down in the world), `hang`
  // how far it has slid down through the head
  const spindle = (m, len, kDir, hang = 0.11) => {
    const parts = [];
    parts.push(turned([[0.0, 0], [0.034, 0], [0.034, len], [0.0, len]], 12));
    for (let k = 0; k < 4; k++) {
      const y = 0.03 + k * ((len - 0.06) / 3);
      parts.push(new THREE.TorusGeometry(0.034, 0.006, 4, 14).rotateX(Math.PI / 2).translate(0, y, 0));
    }
    // the spindle head (Spindelkopf) with the Knebel through it
    parts.push(turned([[0.0, len], [0.05, len], [0.054, len + 0.03], [0.05, len + 0.065], [0.0, len + 0.07]], 12));
    const k = new THREE.Vector3(...kDir).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), k);
    const c = new THREE.Vector3(0, len + 0.035, 0).addScaledVector(k, hang);
    parts.push(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 8).applyQuaternion(q).translate(c.x, c.y, c.z));
    for (const s of [-1, 1]) {
      const e = c.clone().addScaledVector(k, 0.18 * s);
      parts.push(new THREE.SphereGeometry(0.019, 8, 6).translate(e.x, e.y, e.z));
    }
    for (const p of parts) Bb.add(vise, p.applyMatrix4(m));
  };
  // ── front vise (Vorderzange) at the worker's left: the jaw on the front face,
  // the spindle pointing at the worker, its Knebel hanging across
  {
    const vx = -L / 2 + 0.17;
    Bb.add(vise, xf(board(0.26, 0.22, 0.06, { along: 'x', rng }), [vx, H - 0.11, D / 2 + 0.035]));
    // the guide bar running back under the top
    Bb.add(base, xf(board(0.05, 0.05, 0.36, { along: 'z', rng }), [vx + 0.09, H - 0.175, D / 2 - 0.12]));
    // spindle space +Z is the world's down here (rotated +90° about X)
    const m = mat4([vx, H - 0.1, D / 2 + 0.065], [Math.PI / 2, 0, 0]);
    spindle(m, 0.16, [0.3, 0, 1]);
  }
  // ── tail vise (Hinterzange) at the right end: the moving block wraps the
  // front corner, the spindle runs out of its end, the Knebel hangs down
  const tvx = L / 2 + 0.08;
  {
    Bb.add(vise, xf(board(0.26, tt + 0.05, frontW * 0.92, { along: 'x', rng }), [tvx, H - (tt + 0.05) / 2, D / 2 - frontW * 0.46]));
    // spindle space +X is the world's down here (rotated −90° about Z)
    const m = mat4([tvx + 0.13, H - 0.075, D / 2 - frontW * 0.46], [0, 0, -Math.PI / 2]);
    spindle(m, 0.15, [1, 0, -0.22]);
    Bb.add(vc, xf(new THREE.BoxGeometry(0.022, 0.004, 0.03), [tvx - 0.03, H + 0.001, dogZ]), { color: '#2a1b10', cast: false });
  }
  // ── trestle base: two end frames (legs on a foot, a bearer under the top),
  // long stretchers with wedged through-tenons, and a lower shelf
  const legH = H - tt - 0.05;
  for (const s of [-1, 1]) {
    const x = s * (L / 2 - 0.22);
    for (const t of [-1, 1]) Bb.add(base, xf(board(0.07, legH, 0.075, { along: 'y', rng }), [x, legH / 2 + 0.06, t * (D / 2 - 0.09)]));
    // the foot (Fuss) with chamfered ends
    Bb.add(base, xf(board(0.09, 0.07, D + 0.1, { along: 'z', rng, r: 0.018 }), [x, 0.035, 0]));
    // the bearer (Kopfstück) under the top
    Bb.add(base, xf(board(0.08, 0.05, D - 0.02, { along: 'z', rng }), [x, H - tt - 0.025, 0]));
  }
  const ys = 0.17 * (H / 0.48);
  for (const t of [-1, 1]) {
    Bb.add(base, xf(board(L - 0.36, 0.075, 0.04, { along: 'x', rng }), [0, ys, t * (D / 2 - 0.09)]));
    // through-tenons poking out past the legs, held by walnut wedges
    for (const s of [-1, 1]) {
      Bb.add(base, xf(board(0.08, 0.055, 0.035, { along: 'x', rng }), [s * (L / 2 - 0.15), ys, t * (D / 2 - 0.09)]));
      Bb.add(mats.wood('walnut'), xf(new THREE.BoxGeometry(0.014, 0.075, 0.042), [s * (L / 2 - 0.13), ys + 0.005, t * (D / 2 - 0.09)], [0, 0, s * 0.08]), { cast: false });
    }
  }
  // lower shelf with a spare plane and a box of offcuts
  const shelfY = ys + 0.045;
  Bb.add(mats.wood('spruce'), xf(board(L - 0.5, 0.02, D - 0.22, { along: 'x', rng }), [0, shelfY, 0]));
  addPlane(Bb, mats, rng, [-0.2, shelfY + 0.035, 0], 0.26, 0.07);
  Bb.add(mats.wood('cherry'), xf(board(0.16, 0.05, 0.06, { along: 'x', rng }), [0.25, shelfY + 0.035, 0.04], [0, 0.6, 0]));
  Bb.add(mats.wood('walnut'), xf(board(0.12, 0.04, 0.05, { along: 'x', rng }), [0.3, shelfY + 0.07, -0.02], [0, -0.3, 0]));

  // ── the glued-up oak panel between a bench dog and the tail-vise dog ───────
  {
    const bx0 = BOARD.x0, bx1 = tvx - 0.03 - 0.015;
    const len = bx1 - bx0;
    const cx = (bx0 + bx1) / 2;
    const y = H + BOARD.t / 2;
    // three boards; the left part already flattened (pale, fresh), the right still sawn
    const flat = BOARD.x + 0.14; // x where the planed part ends
    const n = 3, bw = BOARD.w / n;
    for (let i = 0; i < n; i++) {
      const z = BOARD.z - BOARD.w / 2 + bw * (i + 0.5);
      const tone = 1 + (i - 1) * 0.05;
      const sawn = new THREE.Color(SPECIES.oak).multiplyScalar(tone * 0.92);
      const planed = new THREE.Color(OAK_PLANED).multiplyScalar(tone);
      Bb.add(mats.wood('#' + sawn.getHexString()), xf(board(bx1 - flat, BOARD.t, bw - 0.002, { along: 'x', rng, r: 0.003 }), [(flat + bx1) / 2, y, z]));
      Bb.add(mats.wood('#' + planed.getHexString()), xf(board(flat - bx0, BOARD.t - 0.002, bw - 0.002, { along: 'x', rng, r: 0.003 }), [(bx0 + flat) / 2, y - 0.001, z]));
    }
    // faint glue lines between the boards
    for (let i = 1; i < n; i++) Bb.add(vc, xf(new THREE.BoxGeometry(len - 0.01, 0.0015, 0.003), [cx, H + BOARD.t + 0.0003, BOARD.z - BOARD.w / 2 + bw * i]), { color: '#6b5236', cast: false });
    // pencil marks across the sawn part (the face-side triangle)
    Bb.add(vc, xf(new THREE.BoxGeometry(0.003, 0.0015, BOARD.w * 0.8), [bx1 - 0.12, H + BOARD.t + 0.0004, BOARD.z], [0, 0.5, 0]), { color: '#3a3a3a', cast: false });
    // the bench dogs (steel heads) at both ends
    Bb.add(steel, xf(new THREE.BoxGeometry(0.02, 0.045, 0.028), [bx0 - 0.012, H + 0.02, BOARD.z]), { cast: false });
    Bb.add(steel, xf(new THREE.BoxGeometry(0.02, 0.045, 0.028), [bx1 + 0.012, H + 0.02, BOARD.z]), { cast: false });
  }
  // ── tools: planes, square, gauge and the mallet in the tray; a chisel roll
  // and the folding rule on the top; nothing tall between Jonny and the visitor
  const trayY = H - tt + 0.035;
  const trayZ = -D / 2 + 0.035 + trayW / 2;
  addPlane(Bb, mats, rng, [-0.32, trayY + 0.03, trayZ + 0.005], 0.42, 0.075, Math.PI / 2, 0.02); // jointer (Rauhbank) on its side
  addPlane(Bb, mats, rng, [0.08, trayY + 0.026, trayZ], 0.2, 0.062, Math.PI / 2, -0.04); // smoother
  // try square (steel blade in a rosewood stock), lying in the tray
  Bb.add(mats.wood('walnut'), xf(board(0.12, 0.014, 0.026, { along: 'x' }), [0.32, trayY + 0.008, trayZ - 0.03]), { cast: false });
  Bb.add(steel, xf(new THREE.BoxGeometry(0.005, 0.005, 0.12), [0.27, trayY + 0.006, trayZ + 0.03]), { cast: false });
  // the round mallet (Klüpfel): a dark, oiled bell-shaped head on an ash handle
  {
    const head = turned([[0.0, -0.06], [0.04, -0.06], [0.05, -0.04], [0.052, 0.0], [0.048, 0.045], [0.036, 0.06], [0.0, 0.06]], 14);
    const handle = turned([[0.0, -0.2], [0.014, -0.2], [0.016, -0.17], [0.012, -0.06], [0.0, -0.06]], 8);
    const m = mat4([0.5, trayY + 0.05, trayZ + 0.0], [0, 0, Math.PI / 2 + 0.06]);
    Bb.add(mats.wood('#4b3426'), head.applyMatrix4(m), { cast: false });
    Bb.add(mats.wood('ash'), handle.applyMatrix4(m), { cast: false });
  }
  // chisels laid out on a cloth roll at the front-vise end
  Bb.add(mats.fabric('#7a5a3a'), xf(new THREE.BoxGeometry(0.28, 0.006, 0.16), [-0.5, H + 0.003, 0.1], [0, 0.08, 0]), { cast: false });
  for (let i = 0; i < 4; i++) {
    const x = -0.6 + i * 0.07, z = 0.1;
    Bb.add(mats.wood('ash'), xf(new THREE.CylinderGeometry(0.012, 0.014, 0.085, 8), [x, H + 0.018, z - 0.045], [Math.PI / 2, 0, 0]), { cast: false });
    Bb.add(mats.wood('walnut'), xf(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 8), [x, H + 0.018, z - 0.0], [Math.PI / 2, 0, 0]), { cast: false });
    Bb.add(steel, xf(new THREE.BoxGeometry(0.01 + i * 0.006, 0.006, 0.08), [x, H + 0.012, z + 0.045]), { cast: false });
  }
  // yellow folding rule (Meterstab), partly unfolded, beside the panel
  for (let i = 0; i < 4; i++) {
    Bb.add(vc, xf(new THREE.BoxGeometry(0.1, 0.004, 0.016), [-0.24 + i * 0.07, H + 0.003 + (i % 2) * 0.004, -0.03 + (i % 2) * 0.01], [0, i % 2 ? 0.3 : -0.1, 0]), { color: '#e8c22a', cast: false });
  }
  Bb.add(vc, xf(new THREE.BoxGeometry(0.09, 0.008, 0.014), [0.05, H + 0.004, -0.04], [0, 1.1, 0]), { color: '#c4271c', cast: false });
  // a heap of curly shavings on the top, past the plane towards the tail vise
  {
    const sg = doubleFace(shavingGeo(0.03, 0.02, 1.4));
    for (let i = 0; i < 18; i++) {
      const c = sg.clone();
      const sc = rng.range(0.7, 1.3);
      xf(c, [rng.range(0.3, L / 2 + 0.05), H + BOARD.t + 0.01 + rng.next() * 0.02, rng.range(-0.02, D / 2 - 0.02)], [rng.next() * 6, rng.next() * 6, rng.next() * 6], sc);
      Bb.add(mats.wood('maple'), c, { cast: false });
    }
  }
  Bb.build(g, 'hobelbank', { mergeShadow: true });
  return g;
}

/** A Swiss horned hand plane (Hobel): beech body, horn, iron, wedge. */
function addPlane(Bb, mats, rng, pos, len, h, rotX = 0, yaw = null) {
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
  const tr = mat4(pos, [rotX ? rotX : 0, yaw ?? rng.jitter(0.4), 0]);
  // lying on its side when rotX is given (sole facing the viewer)
  const parts = [[mats.wood('beech'), body], [mats.wood('beech'), horn], [mats.metal('#9aa1a6'), iron], [mats.wood('walnut'), wedge]];
  for (const [mat, geo] of parts) {
    geo.applyMatrix4(tr);
    Bb.add(mat, geo, { cast: mat !== parts[2][0] });
  }
}
