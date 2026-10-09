// ─────────────────────────────────────────────────────────────────────────────
// The porch (SCHREINEREI.porch): a shingled lean-to on the annex front — its
// right end carried by the oak's great root (annex.js), the left by a timber
// post; clustered, domed moss cushions in the damp places on its shakes — with a
// traditional Swiss Hobelbank at real working height — a light beech top over
// a dark steamed-beech trestle base, the front vise and the tail vise with fat
// threaded wooden spindles and long tommy bars (Knebel), a row of dog holes,
// a tool tray (Beilade), wedged through-tenons. On it a glued-up oak panel
// between two bench dogs, half flattened; the planes, the square and a dark
// round mallet (Klüpfel) wait in the tray. Jonny stands on a slatted duckboard
// (Lattenrost) behind the bench, facing the visitor, traversing the panel;
// shavings spring off his plane. An enamel work lamp hangs over the bench
// (budgeted point light + halo). Hotspot 'workbench-wip' (the bench group).
//
// The bench stands turned ~40° off the wall, its tail-vise end swung towards
// the visitor: from the spot the tail vise with its spindle and Knebel, the
// dog row and the clamped panel read, while Jonny still faces the camera.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng, clamp } from '../../core/rng.js';
import { SPOTS } from '../../world/layout.js';
import {
  Batch, board, timber, xf, mat4, stoneGeo, mossPadGeo, ShingleField, layShingles, shingleGeo, uvBox, doubleFace,
  addLantern, addIvy, paint, SPECIES, noiseA, addBowSaw, turned, pushHalo, count,
} from './kit.js';
import { mossVCMaterial, paintMoss, mossTone } from './door.js';
import { ANNEX, annexFrame, annexMatrix, crook, annexToWorld, decalMaterial, decalGeo, DECAL, frameMat, paintMember } from './annex.js';
import { makeShavings, shavingGeo } from './fx.js';

/**
 * Bench placement in annex-local space (centre on the floor, rotation about Y).
 * Its vise side faces the wall: Jonny works between the bench and the wall and
 * faces the visitor across the bench. It is turned so its tail-vise end (+X,
 * bench space) swings out towards the visitor and clears the left porch post.
 * `top` is the working height — the tallest work surface of the shop
 * (sawhorses, the inner bench and the annex plinth all stay lower); it is
 * fine-tuned to Jonny's hands at build time.
 */
export const BENCH = { x: 2.12, z: 3.2, rotY: Math.PI + 0.38, length: 1.55, depth: 0.5, top: 0.47 };
/** How far Jonny turns from the visitor towards his stroke (0 = straight at the camera). */
const FACE_K = 0.3;

/** Height of the slatted duckboard Jonny stands on. */
const DUCK = 0.09;
/** The glued-up panel on the bench (bench-local): centre of the flattened part where the plane works. */
const BOARD = { x: 0.16, z: BENCH.depth / 2 - 0.125, x0: -0.06, w: 0.22, t: 0.03 };
/** The plane's sole (under the held plane) in the hand's frame (props/tools.js plane + TOOL_INFO). */
const SOLE = new THREE.Vector3(0.05, -0.125, -0.067);

const BEECH_TOP = '#d3ab7f'; // oiled beech top (warm, not a pale slab)
const BEECH_BASE = '#7a5539'; // steamed, darkened beech base
const BEECH_PLANE = '#b58a5e'; // the planes: older, handled beech, darker than the top
const OAK_PLANED = '#d3b98f'; // freshly planed oak (pale, a little glossy)

export function buildPorch(ctx, B, mats, annexShingles = null) {
  const rng = createRng('porch');
  const F0 = annexFrame(B);
  const tim = frameMat(ctx);
  // every frame member its own tone (as on the annex)
  const F = {
    add(material, geo, opts) {
      if (material === tim && !geo.attributes.color) paintMember(geo, rng);
      return F0.add(material, geo, opts);
    },
  };
  const group = new THREE.Group();
  group.name = 'schreinerei-porch';
  ctx.scene.add(group);
  const P = ANNEX.porchRoof;
  const hz = ANNEX.hz;
  const z0 = hz + 0.02, z1 = hz + P.depth;
  const yAt = (z) => P.hi + ((P.lo - P.hi) * (z - z0)) / (z1 - z0); // underside of the rafters

  // ── lean-to structure: ledger on the wall, two posts, a front beam, rafters ─
  F.add(tim, timber([P.x0 - 0.1, P.hi - 0.05, z0 + 0.08], [P.x1 + 0.08, P.hi - 0.05, z0 + 0.08], 0.14, 0.16, { rng }));
  const postZ = z1 - 0.12;
  // the left post is a timber on a stone footing; on the right the great oak
  // root (annex.js) comes down in front of the gable and carries the beam —
  // the porch was built against it
  const RP = ANNEX.rootPost;
  const postXs = [P.x0 + 0.1, RP.x - 0.1];
  for (const x of postXs) {
    const root = x > 1.5;
    if (!root) {
      F.add(tim, timber([x, 0.12, postZ], [x + rng.jitter(0.02), yAt(postZ) - 0.14, postZ], 0.14, 0.14, { rng, up: [0, 0, 1] }));
      // stone footing
      F.add(mats.stone(), xf(stoneGeo(rng, { r: 1, sx: 0.16, sy: 0.08, sz: 0.16 }), [x, 0.06, postZ]));
    }
    // curved knee braces into the front beam (the right one springs from the root)
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
  // front beam (Pfette) with carved ends — its right end let into the root
  const fbY = yAt(postZ) - 0.07;
  F.add(tim, timber([P.x0 - 0.15, fbY, postZ], [RP.x + 0.02, fbY, postZ], 0.15, 0.15, { rng }));
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
  const sOrigin = new THREE.Vector3(P.x0 - 0.21, yAt(z1 + 0.34) + 0.15, z1 + 0.34);
  const along = new THREE.Vector3(1, 0, 0);
  const sLen = P.x1 - P.x0 + 0.42, sH = rl - 0.04;
  // shakes replaced by lifted (sun-curled) or split ones, laid below
  const shRng = createRng('porch-shakes');
  const odd = [];
  const SILVER = new THREE.Color(0.74, 0.74, 0.72);
  const MOSSC = new THREE.Color(0.55, 0.7, 0.4);
  layShingles(field, {
    origin: sOrigin,
    alongDir: along,
    upDir: up,
    normal,
    length: sLen,
    height: sH,
    rng,
    skip: (u, v) => {
      if (v > 0.1 && v < sH - 0.2 && shRng.next() < 0.06) {
        odd.push([u, v]);
        return true;
      }
      return false;
    },
    tint: (u, v, c, p) => {
      // per-shake tone: damp dark shakes, silvered ones and a few newer
      // replacements side by side, so the field reads as single shakes
      const r = shRng.next();
      if (r < 0.14) c.multiplyScalar(0.7);
      else if (r < 0.3) c.lerp(SILVER, 0.5).multiplyScalar(1.1);
      else if (r < 0.37) c.multiplyScalar(1.22);
      c.multiplyScalar(0.88 + shRng.next() * 0.24);
      // only a faint green cast near the eave and in damp patches (the moss
      // itself sits on the courses as cushions)
      const n = noiseA(p.x * 1.3, p.z * 1.3) * 0.5 + 0.5;
      const mossy = THREE.MathUtils.clamp((1 - v / 0.5) * 0.3 + (n - 0.66) * 1.4, 0, 1);
      if (mossy > 0.05) c.lerp(MOSSC, mossy * 0.35);
    },
    transform: (p) => crook(p),
  });
  {
    const basis = new THREE.Matrix4().makeBasis(along, up, normal);
    const m = new THREE.Matrix4(), r = new THREE.Matrix4(), sc = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    for (const [u, v] of odd) {
      p.copy(sOrigin).addScaledVector(along, u).addScaledVector(up, v);
      const g = 0.72 + shRng.next() * 0.3;
      col.setRGB(g, g * 0.95, g * 0.88);
      if (shRng.next() < 0.55) {
        // lifted butt: curled by the sun, its top tucked under the next course
        p.addScaledVector(normal, 0.036);
        crook(p);
        r.makeRotationFromEuler(new THREE.Euler(-0.14 - shRng.next() * 0.06, shRng.jitter(0.04), shRng.jitter(0.12)));
        m.copy(basis).multiply(r).setPosition(p);
        field.push(m, col);
      } else {
        // split shake: two halves, a dark gap between them
        for (const s of [-1, 1]) {
          const q = p.clone().addScaledVector(along, s * 0.056).addScaledVector(normal, 0.014);
          crook(q);
          r.makeRotationFromEuler(new THREE.Euler(-0.07, 0, s * 0.05 + shRng.jitter(0.03)));
          sc.makeScale(0.46, 0.96 + shRng.next() * 0.06, 1);
          m.copy(basis).multiply(r).multiply(sc).setPosition(q);
          field.push(m, col.multiplyScalar(0.97));
        }
      }
    }
  }
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
  // a frame saw hanging on a peg driven into the root post, a coil of rope on its outer side
  {
    const px = RP.x - 0.02, pz = RP.z + 0.16;
    F.add(mats.wood('walnut'), xf(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6), [px, 1.47, pz - 0.05], [Math.PI / 2, 0, 0]), { cast: false });
    addBowSaw(F, mats, rng, mat4([px, 1.24, pz + 0.01], [0, 0, 0.04]), { scale: 0.72 });
    F.add(mats.rope(), xf(new THREE.TorusGeometry(0.09, 0.016, 5, 16), [RP.x + 0.24, 0.95, RP.z - 0.02], [0, Math.PI / 2, 0]), { cast: false });
    F.add(mats.rope(), xf(new THREE.TorusGeometry(0.08, 0.016, 5, 16), [RP.x + 0.255, 0.93, RP.z - 0.01], [0.3, Math.PI / 2, 0]), { cast: false });
  }
  // ivy trailing down from the porch eave — only at the porch's two ends,
  // outside the posts (nothing hangs across the bench, Jonny or the vise) —
  // and climbing the outer side of the left post
  for (let i = 0; i < 7; i++) {
    const left = i % 2 === 0;
    const x = left ? P.x0 - 0.16 + rng.next() * 0.1 : P.x1 + 0.0 + rng.next() * 0.14;
    addIvy(F, mats, rng, [x, fbY + 0.02, postZ + 0.09], [left ? -0.25 : 0.25, -1, 0], { length: rng.range(0.3, 0.75), droop: 1, size: 0.06, normal: [0, 0, 1] });
  }
  addIvy(F, mats, rng, [postXs[0] - 0.05, 0.1, postZ + 0.075], [-0.25, 1, 0], { length: 1.4, droop: -0.6, size: 0.065, normal: [0, 0, 1] });
  // a fascia board along the porch eave
  F.add(mats.wood('oak'), xf(board(P.x1 - P.x0 + 0.46, 0.12, 0.035, { along: 'x', rng }), [(P.x0 + P.x1) / 2, yAt(z1 + 0.32) + 0.08, z1 + 0.34], [slope, 0, 0]));

  // ── moss on the shakes: a few real cushions in the damp places ────────────
  // Clustered where moss grows on a lean-to — the shaded low edge at its two
  // ends, the damp angle against the annex wall, a drape or two over the
  // eave — never sprinkled evenly. Each cushion is domed and lobed, its
  // crown a sunlit yellow-green grading to a dark olive rim (the same family
  // as the moss on the oak's roots), the cushions of a patch crowding into
  // one another. Lichen rosettes dot the dry shakes. Built in the roof's own
  // frame: x along the eave, v up the slope from the eave line.
  {
    const mRng = createRng('porch-roof-moss');
    const mossVC = mossVCMaterial(ctx);
    const roofAt = (x, v, off) => [x, sOrigin.y + up.y * v + normal.y * off, sOrigin.z + up.z * v + normal.z * off];
    const exp = 0.125; // the shakes' course exposure (layShingles)
    const cushion = (x, v, size, { drape = 0, sun = 0.7 } = {}) => {
      const h = size * mRng.range(0.6, 0.9);
      const g = mossPadGeo(mRng, { r: size, h, sx: mRng.range(1.0, 1.45), sz: mRng.range(0.7, 1.0), lobes: 1 });
      paintMoss(g, h, { sun, seed: x * 7 + v * 3 });
      if (drape) {
        // the part beyond the eave line bends down over the fascia
        g.computeBoundingBox();
        const edge = g.boundingBox.max.z * (1 - drape);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const z = pos.getZ(i);
          if (z > edge) {
            const d = z - edge;
            pos.setXYZ(i, pos.getX(i), pos.getY(i) - d * 1.8, edge + d * 0.45);
          }
        }
        g.computeVertexNormals();
      }
      // sit on a course: just above a shake butt line
      const vv = Math.max(0.02, Math.floor(v / exp) * exp + 0.045 + mRng.jitter(0.015));
      F.add(mossVC, xf(g, roofAt(x, drape ? 0.0 : vv, 0.03), [slope, mRng.jitter(0.5), 0]), { cast: false });
    };
    // a patch: one big cushion with smaller ones crowding round it
    const patch = (x, v, size, n, sun) => {
      cushion(x, v, size, { sun });
      for (let k = 0; k < count(n, 1); k++) {
        const a = mRng.next() * Math.PI * 2, d = size * mRng.range(0.9, 1.5);
        cushion(x + Math.cos(a) * d * 1.2, Math.max(0, v + Math.sin(a) * d * 0.7), size * mRng.range(0.45, 0.75), { sun: sun * mRng.range(0.8, 1.1) });
      }
    };
    const x0 = P.x0 - 0.18, x1 = P.x1 + 0.18;
    // the low edge: a big patch at each end, a smaller one off-centre
    patch(x0 + 0.24, 0.04, 0.13, 5, 0.6);
    patch(x1 - 0.32, 0.06, 0.12, 4, 0.5);
    patch(x0 + (x1 - x0) * 0.6, 0.02, 0.075, 2, 0.8);
    // creeping up from the two low corners
    patch(x0 + 0.1, sH * 0.38, 0.07, 2, 0.55);
    patch(x1 - 0.12, sH * 0.3, 0.065, 1, 0.45);
    // the damp angle against the wall
    patch(x0 + 0.42, sH - 0.14, 0.095, 3, 0.4);
    patch(x1 - 0.55, sH - 0.12, 0.08, 2, 0.35);
    // drapes over the eave, with a tuft or two hanging from them
    const tc = new THREE.Color();
    for (const x of [x0 + 0.18, x1 - 0.28]) {
      cushion(x, 0, mRng.range(0.07, 0.09), { drape: 0.4, sun: 0.5 });
      for (let k = 0; k < 2; k++) {
        const tx = x + mRng.jitter(0.08);
        const top = roofAt(tx, -0.06, 0.0);
        const len = mRng.range(0.05, 0.1);
        const tuft = new THREE.ConeGeometry(0.016, len, 6, 2);
        tuft.rotateX(Math.PI).translate(0, -len / 2, 0);
        const tcol = new Float32Array(tuft.attributes.position.count * 3);
        mossTone(0.35, tc);
        for (let i = 0; i < tcol.length; i += 3) {
          tcol[i] = tc.r;
          tcol[i + 1] = tc.g;
          tcol[i + 2] = tc.b;
        }
        tuft.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
        F.add(mossVC, xf(tuft, [top[0], top[1] - 0.04, top[2] + 0.02], [mRng.jitter(0.25), 0, mRng.jitter(0.25)]), { cast: false });
      }
    }
    // lichen rosettes on the dry shakes (pale grey-green, the odd orange one)
    const lichen = ['#8c9174', '#858d6a', '#949478', '#8c9174', '#a07d38'];
    for (let k = 0; k < count(18, 8); k++) {
      const g = new THREE.CircleGeometry(mRng.range(0.01, 0.022), 7);
      g.rotateX(-Math.PI / 2);
      g.scale(1, 1, mRng.range(0.6, 1));
      F.add(mats.vc(), xf(g, roofAt(mRng.range(x0 + 0.05, x1 - 0.05), mRng.range(0.15, sH - 0.1), 0.044), [slope, mRng.next() * 6, 0]), { color: mRng.pick(lichen), cast: false });
    }
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
  const faceAz = camAz + FACE_K * wrapAngle(strokeAz - camAz);
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

  // ── shavings & sawdust where the plane spits them out ──────────────────────
  // Jonny traverses an OAK panel: honey-oak curls (and a few pale spruce ones
  // from an earlier job), small — a plane shaving is a few centimetres — piled
  // at his feet and spilling under the bench round the panel, never strewn
  // over the whole porch. The sawdust is soft-edged decals settling into the
  // flagstone joints, not a flat sheet.
  {
    const Bm = B.at(bench.matrixWorld.clone());
    const oakTones = ['#c99c63', '#bd8f58', '#d3aa74', '#c4975f'];
    const spruceTones = ['#e6d3a4', '#ddc690', '#ead9b0'];
    const curls = [doubleFace(shavingGeo(0.035, 0.022, 1.3)), doubleFace(shavingGeo(0.042, 0.026, 2.1)), doubleFace(shavingGeo(0.05, 0.03, 1.2))];
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sv = new THREE.Vector3();
    // piles (bench space): [x, z, rx, rz, weight] — at his feet, under the panel, a spill on the tray side
    const piles = [[0.15, 0.6, 0.32, 0.18, 0.34], [0.1, 0.05, 0.36, 0.2, 0.3], [-0.25, -0.36, 0.2, 0.1, 0.16], [0.45, 0.3, 0.22, 0.16, 0.2]];
    const count = Math.round(70 * (ctx.quality?.density ?? 1));
    for (let i = 0; i < count; i++) {
      let w = rng.next(), pile = piles[0];
      for (const pl of piles) {
        w -= pl[4];
        if (w <= 0) {
          pile = pl;
          break;
        }
      }
      const a = rng.next() * Math.PI * 2, u = Math.sqrt(rng.next());
      const lx = pile[0] + Math.cos(a) * pile[2] * u, lz = pile[1] + Math.sin(a) * pile[3] * u;
      const onDuck = Math.abs(lx - duck.x) < duck.w / 2 && Math.abs(lz - duck.z) < duck.d / 2;
      // heaped: higher in the middle of a pile
      p.set(lx, (onDuck ? duck.h : 0) + 0.035 + (1 - u) * 0.03 + rng.next() * 0.015, lz);
      const sc = rng.range(0.5, 0.82);
      m.compose(p, q.setFromEuler(e.set(rng.jitter(1.3), rng.next() * 6, rng.jitter(1.3))), sv.set(sc, sc, sc));
      const tone = rng.next() < 0.75 ? rng.pick(oakTones) : rng.pick(spruceTones);
      Bm.add(mats.wood('maple'), rng.pick(curls).clone().applyMatrix4(m), { color: tone, cast: false });
    }
    // soft sawdust drifts under the piles and specks in the joints around them
    const dm = decalMaterial();
    const drifts = [[0.12, 0.08, 0.95, 0.55], [0.15, 0.58, 0.8, 0.45], [-0.25, -0.34, 0.5, 0.3], [0.5, 0.32, 0.55, 0.4], [-0.55, 0.2, 0.45, 0.35]];
    for (const [x, z, w, d] of drifts) {
      const g = decalGeo(w, d, DECAL.blob).rotateX(-Math.PI / 2);
      Bm.add(dm, xf(g, [x, 0.012, z], [0, rng.jitter(0.5), 0]), { color: rng.pick(['#e2c792', '#d9bb86', '#e8d3a6']), cast: false });
    }
    for (let k = 0; k < 6; k++) {
      const g = decalGeo(rng.range(0.4, 0.7), rng.range(0.3, 0.5), DECAL.specks).rotateX(-Math.PI / 2);
      Bm.add(dm, xf(g, [rng.range(-0.8, 0.8), 0.014, rng.range(-0.5, 0.8)], [0, rng.next() * 6, 0]), { color: '#e4cd9c', cast: false });
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
    // honey oak, like the curls already lying about (he is planing oak)
    material: mats.wood('maple').material,
    geometry: paint(doubleFace(shavingGeo(0.032, 0.021, 1.4)), '#cda46c'),
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
  const vise = mats.wood('#a87d55'); // the vise chops & spindles: darker, handled beech
  const steel = mats.metal('#8f969b');
  const vc = mats.vc();
  const tt = 0.085; // top thickness
  // ── the top: a thick front plank, the tool tray (Beilade), a back rail ────
  const frontW = 0.31;
  Bb.add(top, xf(board(L, tt, frontW, { along: 'x', rng, r: 0.01 }), [0, H - tt / 2, D / 2 - frontW / 2]));
  const trayW = D - frontW - 0.035;
  Bb.add(mats.wood('#c8a581'), xf(board(L - 0.02, 0.02, trayW, { along: 'x', rng }), [0, H - tt + 0.025, -D / 2 + 0.035 + trayW / 2]));
  // the tray's back rail is a low lip (the planes parked in the tray show over it)
  Bb.add(top, xf(board(L, tt * 0.62, 0.035, { along: 'x', rng }), [0, H - tt * 0.69, -D / 2 + 0.0175]));
  // end caps of the tray (the tray ends are closed)
  for (const s of [-1, 1]) Bb.add(top, xf(board(0.03, tt * 0.7, trayW, { along: 'z', rng }), [s * (L / 2 - 0.015), H - tt * 0.45, -D / 2 + 0.035 + trayW / 2]));
  // dog holes along the front edge (dark insets)
  const dogZ = D / 2 - 0.05;
  for (let i = 0; i < 10; i++) {
    const x = -L / 2 + 0.3 + i * 0.112;
    Bb.add(vc, xf(new THREE.BoxGeometry(0.026, 0.004, 0.034), [x, H + 0.001, dogZ], [0, 0.0, 0]), { color: '#1f140c', cast: false });
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
  addPlane(Bb, mats, rng, [-0.2, shelfY + 0.01, 0], { len: 0.26, h: 0.055, w: 0.06, yaw: 0.2 });
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
  // the jointer (Rauhbank) parked in the tray, its horn, tote, wedge and iron
  // showing over the lip; the smoother (Doppelhobel) on the top, its toe
  // resting on a thin lath so the iron never touches the bench
  addPlane(Bb, mats, rng, [-0.3, trayY + 0.001, trayZ + 0.004], { len: 0.44, h: 0.062, w: 0.062, yaw: Math.PI + 0.02, jointer: true });
  Bb.add(mats.wood('spruce'), xf(board(0.03, 0.008, 0.07, { along: 'z', rng, r: 0.002 }), [-0.53, H + 0.004, -0.025], [0, 0.12, 0]), { cast: false });
  addPlane(Bb, mats, rng, [-0.44, H + 0.002, -0.025], { len: 0.21, h: 0.052, w: 0.056, yaw: Math.PI + 0.12, tilt: 0.035 });
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
  Bb.add(mats.fabric('#7a5a3a'), xf(new THREE.BoxGeometry(0.28, 0.006, 0.16), [-0.5, H + 0.003, 0.12], [0, 0.08, 0]), { cast: false });
  for (let i = 0; i < 4; i++) {
    const x = -0.6 + i * 0.07, z = 0.12;
    Bb.add(mats.wood('ash'), xf(new THREE.CylinderGeometry(0.012, 0.014, 0.085, 8), [x, H + 0.018, z - 0.045], [Math.PI / 2, 0, 0]), { cast: false });
    Bb.add(mats.wood('walnut'), xf(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 8), [x, H + 0.018, z - 0.0], [Math.PI / 2, 0, 0]), { cast: false });
    Bb.add(steel, xf(new THREE.BoxGeometry(0.01 + i * 0.006, 0.006, 0.08), [x, H + 0.012, z + 0.045]), { cast: false });
  }
  // yellow folding rule (Meterstab), partly unfolded, beside the panel
  for (let i = 0; i < 4; i++) {
    Bb.add(vc, xf(new THREE.BoxGeometry(0.1, 0.004, 0.016), [-0.24 + i * 0.07, H + 0.003 + (i % 2) * 0.004, -0.03 + (i % 2) * 0.01], [0, i % 2 ? 0.3 : -0.1, 0]), { color: '#e8c22a', cast: false });
  }
  Bb.add(vc, xf(new THREE.BoxGeometry(0.09, 0.008, 0.014), [0.05, H + 0.004, -0.04], [0, 1.1, 0]), { color: '#c4271c', cast: false });
  // a few small oak curls on the panel and the top, around the plane's path
  {
    const sg = doubleFace(shavingGeo(0.03, 0.02, 1.4));
    for (let i = 0; i < 14; i++) {
      const c = sg.clone();
      const sc = rng.range(0.5, 0.85);
      xf(c, [rng.range(-0.05, 0.55), H + BOARD.t + 0.008 + rng.next() * 0.015, rng.range(0.0, D / 2 - 0.02)], [rng.next() * 6, rng.next() * 6, rng.next() * 6], sc);
      Bb.add(mats.wood('maple'), c, { color: rng.pick(['#c99c63', '#d3aa74', '#bd8f58']), cast: false });
    }
  }
  Bb.build(g, 'hobelbank', { mergeShadow: true });
  return g;
}

/**
 * A Swiss horned plane standing on its sole at `pos` (bench space), length
 * along X with the toe at +X (turn it with `yaw`): a body of older, handled
 * beech; the horn (Horn) rising ahead of the throat and leaning forward; the
 * dark wedge (Keil) and the bright iron (Hobeleisen) bedded at 47° in the
 * open escapement, the iron standing proud of the wedge; a strike button at
 * the heel. The jointer (Rauhbank) adds a closed tote (Griff). `tilt` lifts
 * the toe (a plane parked on a lath).
 */
function addPlane(Bb, mats, rng, pos, { len = 0.22, h = 0.055, w = 0.056, yaw = 0, jointer = false, tilt = 0 } = {}) {
  const beech = mats.wood(BEECH_PLANE);
  const hornWood = mats.wood('#9a6c45');
  const parts = [];
  // body, its top arrises chamfered
  parts.push([beech, board(len, h, w, { along: 'x', rng, r: 0.008 }).translate(0, h / 2, 0)]);
  // mouth / bed line: the iron passes the sole a little ahead of the middle
  const xm = jointer ? len * 0.02 : len * 0.06;
  const bed = (47 * Math.PI) / 180;
  const dir = new THREE.Vector2(-Math.cos(bed), Math.sin(bed)); // up the bed, towards the heel
  const nrm = new THREE.Vector2(Math.sin(bed), Math.cos(bed)); // the iron's upper face
  // the open escapement: a dark slot in the top
  const slotX = xm - (h / Math.tan(bed)) * 0.5;
  parts.push([mats.wood('#24170e'), new THREE.BoxGeometry(h * 0.95, 0.004, w * 0.64).translate(slotX + h * 0.08, h + 0.001, 0)]);
  // iron: from the mouth up the bed, standing ~0.7 h proud of the top
  {
    const Li = (h * 1.72) / Math.sin(bed);
    const c = new THREE.Vector2(xm, 0).addScaledVector(dir, Li / 2);
    parts.push([mats.metal('#c4ccd2'), xf(new THREE.BoxGeometry(Li, 0.0045, w * 0.7), [c.x, c.y, 0], [0, 0, Math.atan2(dir.y, dir.x)])]);
    // the honed top end catches the light, the chipbreaker screw on it
    const t = new THREE.Vector2(xm, 0).addScaledVector(dir, Li - 0.004);
    parts.push([mats.metal('#eef2f4'), xf(new THREE.BoxGeometry(0.008, 0.006, w * 0.7), [t.x, t.y, 0], [0, 0, Math.atan2(dir.y, dir.x)])]);
    const sc = new THREE.Vector2(xm, 0).addScaledVector(dir, Li * 0.82).addScaledVector(nrm, 0.004);
    parts.push([mats.metal('#8d8f8c'), xf(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 8), [sc.x, sc.y, 0], [0, 0, Math.atan2(dir.y, dir.x) - Math.PI / 2])]);
  }
  // wedge: on the iron's upper face, shorter, its rounded head dark and polished
  {
    const Lw = (h * 1.38) / Math.sin(bed);
    const c = new THREE.Vector2(xm, 0).addScaledVector(dir, Lw / 2).addScaledVector(nrm, 0.012);
    const a = Math.atan2(dir.y, dir.x);
    parts.push([mats.wood('#4b3426'), xf(new THREE.BoxGeometry(Lw, 0.018, w * 0.6), [c.x, c.y, 0], [0, 0, a])]);
    const hd = new THREE.Vector2(xm, 0).addScaledVector(dir, Lw).addScaledVector(nrm, 0.012);
    parts.push([mats.wood('#4b3426'), xf(new THREE.CylinderGeometry(0.011, 0.011, w * 0.6, 8), [hd.x, hd.y, 0], [Math.PI / 2, 0, 0])]);
  }
  // the horn: a tapered, forward-leaning grip ahead of the throat
  {
    const hx0 = xm + len * 0.17;
    const pts = [[hx0 - 0.01, h * 0.9, 0], [hx0 + 0.004, h + h * 0.55, 0], [hx0 + 0.026, h + h * 1.05, 0]];
    parts.push([hornWood, taperTube(pts, w * 0.3, w * 0.17, 8, 8)]);
    parts.push([hornWood, new THREE.SphereGeometry(w * 0.2, 8, 6).scale(1.2, 0.9, 1).translate(pts[2][0] + 0.004, pts[2][1] + 0.003, 0)]);
  }
  // strike button at the heel
  parts.push([mats.wood('#3a2a1e'), new THREE.CylinderGeometry(w * 0.2, w * 0.2, 0.006, 10).translate(-len / 2 + 0.03, h + 0.003, 0)]);
  // the jointer's closed tote behind the escapement
  if (jointer) {
    const sh = new THREE.Shape();
    const tw = h * 1.3, th = h * 1.05;
    sh.moveTo(0, 0);
    sh.lineTo(tw, 0);
    sh.bezierCurveTo(tw * 0.9, th * 0.5, tw * 0.75, th, tw * 0.45, th);
    sh.bezierCurveTo(tw * 0.2, th, 0.0, th * 0.75, -tw * 0.08, th * 0.55);
    sh.lineTo(0, 0);
    const hole = new THREE.Path();
    hole.moveTo(tw * 0.3, th * 0.18);
    hole.lineTo(tw * 0.72, th * 0.18);
    hole.bezierCurveTo(tw * 0.66, th * 0.5, tw * 0.55, th * 0.72, tw * 0.42, th * 0.72);
    hole.bezierCurveTo(tw * 0.3, th * 0.72, tw * 0.22, th * 0.5, tw * 0.3, th * 0.18);
    sh.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(sh, { depth: w * 0.42, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1, curveSegments: 5 });
    g.translate(0, 0, -w * 0.21);
    uvBox(g, 'x');
    parts.push([hornWood, g.translate(-len * 0.41, h - 0.002, 0)]);
  }
  const tr = mat4([pos[0], pos[1] + (tilt ? Math.sin(tilt) * len * 0.5 : 0), pos[2]], [0, yaw, tilt]);
  for (const [mat, geo] of parts) {
    geo.applyMatrix4(tr);
    Bb.add(mat, geo, { cast: false });
  }
}

/** A tube through points with its radius tapering from r0 to r1 (horns, roots). */
function taperTube(pts, r0, r1, tubular = 8, radial = 8) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const g = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  const pos = g.attributes.position;
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.floor(i / (radial + 1)) / tubular;
    curve.getPointAt(Math.min(1, t), c);
    v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(r0 + (r1 - r0) * t).add(c);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return uvBox(g, 'y');
}
