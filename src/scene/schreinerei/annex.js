// ─────────────────────────────────────────────────────────────────────────────
// The workshop annex (SCHREINEREI.annex): a crooked half-timbered house
// leaning against the roots of the Great Oak.
//
// Gable front (facing the visitor), jettied upper gable with carved joist
// heads, fieldstone plinth, oak timber frame (sills, posts, rails, braces,
// St Andrew's crosses, pegs) with plaster infill, a steep crooked roof of
// real overlapping shingles (instanced), carved bargeboards, purlin ends on
// curved brackets, a hoist beam with a pulley, a dormer, a leaning fieldstone
// chimney with smoke, big multi-pane windows glowing warm and a wide open
// double door into the lit workshop (bench, tool wall, clamps, boards).
//
// Everything is built in ANNEX-LOCAL space (origin = annex centre on the
// ground, +Z = front) and passed through crook() — a gentle lean towards the
// oak, a sagging ridge and a twist — so nothing is ruler-straight.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { SCHREINEREI } from '../../world/layout.js';
import { createRng } from '../../core/rng.js';
import {
  Batch, board, timber, peg, uvBox, xf, deform, mat4, stoneGeo, mossGeo, tube, rbox,
  ShingleField, layShingles, shingleGeo, addIvy, addToadstool, pushHalo, noiseA,
  addBowSaw, addHandSaw, addFClamp, turned, doubleFace,
} from './kit.js';
import { makeSmoke, shavingGeo } from './fx.js';

const A = SCHREINEREI.annex;
/** Annex dimensions & key heights (annex-local). */
export const ANNEX = {
  hx: A.width / 2, // 2.8
  hz: A.depth / 2, // 2.2
  plinth: 0.42,
  sillTop: 0.58,
  plateBottom: 2.3,
  eave: 2.46, // top of the side walls' top plate (rafter foot)
  pitch: Math.tan((52 * Math.PI) / 180),
  jetty: 0.22, // the front gable overhangs the ground floor
  gableSill: [2.62, 2.78],
  overhangSide: 0.45,
  overhangFront: 0.5,
  overhangBack: 0.3,
  floor: 0.06, // interior floor
  door: { s0: 1.62, s1: 3.42, top: 2.12 }, // front double door (wall coords s = x + hx)
  porchRoof: { x0: 0.92, x1: 2.75, depth: 1.62, hi: 2.36, lo: 1.98 },
};
ANNEX.ridge = ANNEX.eave + ANNEX.hx * ANNEX.pitch; // underside of the rafters at the ridge

/** The annex frame (local → world) matrix. */
export const annexMatrix = mat4([A.x, 0, A.z], [0, A.rotY, 0]);

/** Gentle crookedness applied to every annex vertex (local space, in place). */
export function crook(v) {
  const y = v.y;
  // lean towards the oak (+x) and a touch forward, growing with height
  v.x += y * 0.028 + y * y * 0.002;
  v.z += y * 0.008;
  // ridge sags in the middle of its length
  const roofK = THREE.MathUtils.smoothstep(y, ANNEX.eave, ANNEX.ridge + 0.4);
  const zn = (v.z + ANNEX.hz + ANNEX.overhangBack) / (A.depth + ANNEX.overhangBack + ANNEX.overhangFront);
  v.y -= Math.sin(Math.PI * THREE.MathUtils.clamp(zn, 0, 1)) * 0.16 * roofK;
  // a slight twist of the upper storey
  const tw = y * 0.006;
  const x = v.x, z = v.z;
  v.x = x * Math.cos(tw) - z * Math.sin(tw);
  v.z = x * Math.sin(tw) + z * Math.cos(tw);
  return v;
}

/** A Batch frame that crooks and places annex-local geometry. */
export function annexFrame(B) {
  const M = annexMatrix;
  return {
    add(material, geo, opts = {}) {
      if (opts.matrix) {
        geo.applyMatrix4(opts.matrix);
        opts = { ...opts, matrix: null };
      }
      deform(geo, crook, true);
      geo.applyMatrix4(M);
      return B.add(material, geo, opts);
    },
  };
}

/** Annex-local point → world (with crook). */
export function annexToWorld(x, y, z, target = new THREE.Vector3()) {
  target.set(x, y, z);
  crook(target);
  return target.applyMatrix4(annexMatrix);
}

/**
 * A wall in its own 2D coordinates: s along the wall from `origin` in `sDir`,
 * y up, n outwards (n = 0 is the outer timber face).
 */
function makeWall(F, mats, rng, origin, sDir, normal) {
  const O = new THREE.Vector3(...origin);
  const S = new THREE.Vector3(...sDir);
  const N = new THREE.Vector3(...normal);
  const p = (s, y, n = 0) => [O.x + S.x * s + N.x * n, y, O.z + S.z * s + N.z * n];
  const basis = new THREE.Matrix4().makeBasis(S, new THREE.Vector3(0, 1, 0), N);
  const oak = mats.frame();
  return {
    p,
    /** A timber from (s0,y0) to (s1,y1) with face width fw, depth d (outer face flush at n=0). */
    timber(s0, y0, s1, y1, fw = 0.16, d = 0.16, opts = {}) {
      const g = timber(p(s0, y0, -d / 2 + (opts.proud ?? 0)), p(s1, y1, -d / 2 + (opts.proud ?? 0)), fw, d, { rng, up: normal, wobble: opts.wobble ?? 0.01 });
      F.add(opts.mat ?? oak, g);
    },
    /** A wooden peg head at (s, y). */
    peg(s, y) {
      const g = peg(0.02, 0.03);
      g.applyMatrix4(basis);
      const q = p(s, y, 0.012);
      g.translate(q[0], q[1], q[2]);
      F.add(mats.wood('walnut'), g, { cast: false });
    },
    /** Plaster infill: outline [[s,y]…] with holes [[[s,y]…]…], recessed behind the timbers. */
    plaster(outline, holes = [], { depth = 0.12, recess = 0.022 } = {}) {
      const shape = new THREE.Shape(outline.map(([s, y]) => new THREE.Vector2(s, y)));
      for (const h of holes) shape.holes.push(new THREE.Path(h.map(([s, y]) => new THREE.Vector2(s, y))));
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
      uvBox(g, 'x', 1 / 2.2, [rng.next() * 5, rng.next() * 5]);
      g.translate(0, 0, -depth - recess);
      g.applyMatrix4(basis);
      g.translate(O.x, O.y, O.z);
      F.add(mats.plaster(), g);
    },
    /** Arbitrary geometry built in wall space (x = s, y, z = n). */
    add(material, g, opts) {
      g.applyMatrix4(basis);
      g.translate(O.x, O.y, O.z);
      F.add(material, g, opts);
    },
    basis,
  };
}

/** A board with a scalloped lower edge, centred on the origin along X (extruded along Z). */
function scallopBoard(len, h, d, rng) {
  const sh = new THREE.Shape();
  const n = Math.max(2, Math.round(len / 0.17));
  sh.moveTo(-len / 2, h / 2);
  sh.lineTo(len / 2, h / 2);
  sh.lineTo(len / 2, -h * 0.1);
  for (let i = n; i > 0; i--) {
    const u0 = -len / 2 + (i / n) * len, u1 = -len / 2 + ((i - 1) / n) * len;
    const um = (u0 + u1) / 2;
    sh.quadraticCurveTo(um, -h / 2 - h * 0.35, u1, -h * 0.1);
  }
  sh.lineTo(-len / 2, h / 2);
  const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -d / 2);
  return uvBox(g, 'x', undefined, [rng.next() * 5, rng.next() * 5]);
}

/** Orient a geometry built along +X (centred) from a to b, its +Y towards `up`. */
function alongXUp(g, a, b, up) {
  const X = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  const Y = new THREE.Vector3(...up);
  const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  Y.crossVectors(Z, X).normalize();
  const m = new THREE.Matrix4().makeBasis(X, Y, Z);
  m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g.applyMatrix4(m);
}

/** Multi-pane window into an opening (wall space). */
function addWindow(wall, mats, rng, s0, y0, s1, y1, { cols = 3, rows = 3, glow, glow2, sill = true, box = false, shutters = false, shutterColor = '#3f6b4a' } = {}) {
  const fw = 0.055;
  const frameMat = mats.wood('oak');
  const w = s1 - s0, h = y1 - y0;
  // frame
  wall.add(frameMat, xf(board(w, fw, 0.07, { along: 'x', rng }), [(s0 + s1) / 2, y0 + fw / 2, -0.07]));
  wall.add(frameMat, xf(board(w, fw, 0.07, { along: 'x', rng }), [(s0 + s1) / 2, y1 - fw / 2, -0.07]));
  wall.add(frameMat, xf(board(fw, h, 0.07, { along: 'y', rng }), [s0 + fw / 2, (y0 + y1) / 2, -0.07]));
  wall.add(frameMat, xf(board(fw, h, 0.07, { along: 'y', rng }), [s1 - fw / 2, (y0 + y1) / 2, -0.07]));
  // muntins
  const iw = w - fw * 2, ih = h - fw * 2;
  for (let c = 1; c < cols; c++) wall.add(frameMat, xf(board(0.026, ih, 0.035, { along: 'y', rng, r: 0.006 }), [s0 + fw + (iw * c) / cols, (y0 + y1) / 2, -0.075]), { cast: false });
  for (let r = 1; r < rows; r++) wall.add(frameMat, xf(board(iw, 0.026, 0.035, { along: 'x', rng, r: 0.006 }), [(s0 + s1) / 2, y0 + fw + (ih * r) / rows, -0.075]), { cast: false });
  // glass panes: each glows a little differently (some catch the sky)
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const pw = iw / cols, ph = ih / rows;
      const g = new THREE.PlaneGeometry(pw - 0.004, ph - 0.004);
      const m = rng.next() < 0.22 ? glow2 : glow;
      wall.add(m, xf(g, [s0 + fw + pw * (c + 0.5), y0 + fw + ph * (r + 0.5), -0.09]), { cast: false, receive: false });
    }
  }
  if (sill) {
    const sb = board(w + 0.16, 0.045, 0.16, { along: 'x', rng });
    wall.add(frameMat, xf(sb, [(s0 + s1) / 2, y0 - 0.02, 0.03], [0.12, 0, 0]));
  }
  if (box) {
    // flower box with geraniums
    const bw = w + 0.06;
    const bx = (s0 + s1) / 2;
    wall.add(mats.wood('spruce'), xf(board(bw, 0.16, 0.2, { along: 'x', rng }), [bx, y0 - 0.16, 0.13]));
    for (const s of [-1, 1]) wall.add(mats.metal('#2f2b28'), xf(new THREE.BoxGeometry(0.02, 0.12, 0.2), [bx + s * bw * 0.35, y0 - 0.22, 0.04]), { cast: false });
    wall.add(mats.soil(), xf(new THREE.BoxGeometry(bw - 0.04, 0.02, 0.16), [bx, y0 - 0.075, 0.13]), { cast: false });
    const vc = mats.vc();
    const n = Math.round(bw / 0.09);
    for (let i = 0; i < n; i++) {
      const x = bx - bw / 2 + 0.05 + (i / (n - 1)) * (bw - 0.1);
      // leaves
      for (let k = 0; k < 2; k++) {
        const lf = new THREE.SphereGeometry(0.05, 6, 4);
        wall.add(vc, xf(lf, [x + rng.jitter(0.03), y0 - 0.045 + rng.jitter(0.02), 0.13 + rng.jitter(0.06)], null, [1, 0.5, 1]), { color: rng.pick(['#4f7f36', '#5e8c3a', '#3f6b2f']), cast: false });
      }
      // flower clusters
      if (rng.next() < 0.75) {
        const fc = rng.pick(['#d6332a', '#e2553f', '#c4271c', '#f08a8a', '#ffffff']);
        for (let k = 0; k < 4; k++) {
          const f = new THREE.SphereGeometry(0.018, 5, 3);
          wall.add(vc, xf(f, [x + rng.jitter(0.035), y0 + 0.02 + rng.range(0, 0.07), 0.13 + rng.jitter(0.06)]), { color: fc, cast: false });
        }
      }
      // a trailing vine over the front
      if (rng.next() < 0.4) {
        const pts = [[x, y0 - 0.06, 0.24], [x + rng.jitter(0.03), y0 - 0.2, 0.25], [x + rng.jitter(0.05), y0 - 0.36, 0.24]];
        wall.add(vc, tube(pts, 0.005, 3, 6), { color: '#4f7f36', cast: false });
        for (let k = 0; k < 3; k++) wall.add(vc, xf(new THREE.SphereGeometry(0.022, 5, 3), [pts[k][0] + rng.jitter(0.02), pts[k][1] - 0.02, 0.255], null, [1, 1, 0.4]), { color: '#5e8c3a', cast: false });
      }
    }
  }
  if (shutters) {
    // painted Swiss shutters, folded open against the wall, with a heart cut-out
    const sides = shutters === 'left' ? [-1] : shutters === 'right' ? [1] : [-1, 1];
    for (const s of sides) {
      const sx = s < 0 ? s0 - w / 4 - 0.02 : s1 + w / 4 + 0.02;
      const sh = board(w / 2, h, 0.04, { along: 'y', rng });
      wall.add(mats.vc(), xf(sh, [sx, (y0 + y1) / 2, 0.025]), { color: shutterColor });
      for (const ly of [y0 + 0.12, y1 - 0.12]) wall.add(mats.vc(), xf(board(w / 2 - 0.02, 0.05, 0.02, { along: 'x' }), [sx, ly, 0.05]), { color: shutterColor, cast: false });
      const heart = new THREE.Shape();
      heart.moveTo(0, -0.04);
      heart.bezierCurveTo(-0.06, 0.0, -0.045, 0.055, 0, 0.026);
      heart.bezierCurveTo(0.045, 0.055, 0.06, 0.0, 0, -0.04);
      const hg = new THREE.ShapeGeometry(heart, 4);
      wall.add(mats.vc(), xf(hg, [sx, (y0 + y1) / 2 + h * 0.2, 0.047]), { color: '#1c1410', cast: false });
    }
  }
}

/**
 * Build the annex. Static parts go into the shared world Batch `B`.
 * Returns { group, update(dt,t), anchors, frame }.
 */
export function buildAnnex(ctx, B, mats) {
  const rng = createRng('annex');
  const group = new THREE.Group();
  group.name = 'schreinerei-annex';
  ctx.scene.add(group);
  const F = annexFrame(B);
  const { hx, hz, plinth, sillTop, plateBottom, eave, pitch: T, jetty } = ANNEX;
  const glow = mats.glow('#ffc66e', 0.42, 2.4);
  const glow2 = mats.glow('#ffad55', 0.28, 1.9);
  const tim = mats.frame(); // the Riegel frame, joist heads, rafters & purlins
  const yRoof = (x) => eave + (hx - Math.abs(x)) * T; // rafter underside line

  // ── fieldstone plinth (individual stones in rough courses) ────────────────
  const plinthRun = (x0, z0, x1, z1, skip = null) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
    // outward normal (walls run clockwise seen from above → normal = (dz, -dx))
    const nx = dz, nz = -dx;
    const courses = [0.19, 0.2];
    let y = 0;
    for (let c = 0; c < courses.length; c++) {
      const ch = courses[c];
      let s = c % 2 ? -0.12 : 0;
      while (s < len) {
        const sw = rng.range(0.26, 0.48);
        const sc = Math.min(len, s + sw / 2);
        if (!(skip && skip(sc))) {
          const g = stoneGeo(rng, { r: 1, sx: sw * 0.55, sy: ch * 0.62, sz: 0.2, lump: 0.16 });
          const px = x0 + dx * sc + nx * (0.05 + rng.jitter(0.015));
          const pz = z0 + dz * sc + nz * (0.05 + rng.jitter(0.015));
          xf(g, [px, y + ch / 2, pz], [rng.jitter(0.05), Math.atan2(dx, dz) + Math.PI / 2, rng.jitter(0.06)]);
          F.add(mats.stone(), g);
        }
        s += sw;
      }
      y += ch;
    }
    // mortar core behind the stones
    const core = new THREE.BoxGeometry(len, plinth, 0.24);
    xf(core, [(x0 + x1) / 2 - nx * 0.1, plinth / 2, (z0 + z1) / 2 - nz * 0.1], [0, Math.atan2(dx, dz) + Math.PI / 2, 0]);
    F.add(mats.stone(), uvBox(core, 'x', 1));
    // cap stones: flat slabs on top, slightly proud
    let s = 0;
    while (s < len) {
      const sw = rng.range(0.4, 0.7);
      const sc = Math.min(len - 0.1, s + sw / 2);
      if (!(skip && skip(sc))) {
        const g = stoneGeo(rng, { r: 1, sx: sw * 0.52, sy: 0.05, sz: 0.17, lump: 0.1 });
        xf(g, [x0 + dx * sc + nx * 0.03, plinth - 0.02, z0 + dz * sc + nz * 0.03], [0, Math.atan2(dx, dz) + Math.PI / 2, 0]);
        F.add(mats.stone(), g);
      }
      s += sw;
    }
  };
  const door = ANNEX.door;
  // front (left→right as seen from the front), right side (front→back), back, left side
  plinthRun(-hx, hz, hx, hz, (s) => s > door.s0 - 0.05 && s < door.s1 + 0.05);
  plinthRun(hx, hz, hx, -hz);
  plinthRun(hx, -hz, -hx, -hz);
  plinthRun(-hx, -hz, -hx, hz);

  // ── ground-floor walls ─────────────────────────────────────────────────────
  const front = makeWall(F, mats, rng, [-hx, 0, hz], [1, 0, 0], [0, 0, 1]);
  const right = makeWall(F, mats, rng, [hx, 0, hz], [0, 0, -1], [1, 0, 0]);
  const back = makeWall(F, mats, rng, [hx, 0, -hz], [-1, 0, 0], [0, 0, -1]);
  const left = makeWall(F, mats, rng, [-hx, 0, -hz], [0, 0, 1], [-1, 0, 0]);
  const L = A.width, Dd = A.depth;
  const ys = sillTop, yp = plateBottom;
  // sills & top plates on all four walls (the front sill is interrupted by the door)
  for (const [w, len] of [[front, L], [right, Dd], [back, L], [left, Dd]]) {
    if (w === front) {
      w.timber(-0.08, plinth + 0.08, door.s0, plinth + 0.08);
      w.timber(door.s1, plinth + 0.08, len + 0.08, plinth + 0.08);
    } else w.timber(-0.08, plinth + 0.08, len + 0.08, plinth + 0.08);
    w.timber(-0.1, yp + 0.08, len + 0.1, yp + 0.08, 0.16, 0.17);
  }
  // FRONT: corner posts, window W1, door, window W2 under the porch roof
  const W1 = [0.16, 1.46, 1.02, yp];
  const W2 = [4.0, 5.0, 1.08, 1.98];
  const postsF = [0.08, 1.54, door.s0 - 0.08, door.s1 + 0.08, 3.92, 5.08, L - 0.08];
  for (const s of postsF) {
    const y0 = s > door.s0 - 0.2 && s < door.s1 + 0.2 ? 0.0 : ys;
    if (s === 1.54) continue; // = door post
    front.timber(s, y0, s, yp);
  }
  front.timber(door.s0 - 0.08, 0, door.s0 - 0.08, yp);
  // door lintel (with a carved year) and rails
  front.timber(door.s0 - 0.16, door.top + 0.09, door.s1 + 0.16, door.top + 0.09, 0.18, 0.18, { proud: 0.02 });
  front.timber(0.16, W1[2] - 0.06, W1[1] + 0.08, W1[2] - 0.06, 0.12);
  front.timber(door.s1 + 0.16, W2[2] - 0.06, L - 0.16, W2[2] - 0.06, 0.12);
  front.timber(W2[0] - 0.08, W2[3] + 0.06, W2[1] + 0.08, W2[3] + 0.06, 0.12);
  // St Andrew's crosses under the windows
  const andreas = (w, s0, s1, y0, y1) => {
    w.timber(s0, y0, s1, y1, 0.11, 0.12, { proud: -0.01 });
    w.timber(s0, y1, s1, y0, 0.11, 0.12, { proud: -0.012 });
  };
  andreas(front, 0.2, W1[1] - 0.02, ys + 0.02, W1[2] - 0.12);
  andreas(front, W2[0] + 0.04, W2[1] - 0.04, ys + 0.02, W2[2] - 0.12);
  // braces from the corner post into the plate (Kopfband) and a foot brace
  front.timber(L - 0.16, ys + 0.6, W2[1] + 0.12, ys + 0.02, 0.11, 0.12);
  front.timber(door.s1 + 0.16, yp - 0.05, door.s1 + 0.38, yp - 0.4, 0.1, 0.12);
  // pegs at the joints
  for (const s of postsF) for (const y of [ys + 0.08, yp - 0.06]) front.peg(s, y);
  addWindow(front, mats, rng, W1[0] + 0.02, W1[2], W1[1] - 0.02, W1[3] - 0.01, { cols: 4, rows: 3, glow, glow2, box: true });
  addWindow(front, mats, rng, W2[0], W2[2], W2[1], W2[3], { cols: 3, rows: 3, glow, glow2 });
  front.plaster([[0, ys], [door.s0, ys], [door.s0, yp + 0.16], [0, yp + 0.16]], [[[W1[0], W1[2]], [W1[1], W1[2]], [W1[1], W1[3]], [W1[0], W1[3]]]]);
  front.plaster([[door.s1, ys], [L, ys], [L, yp + 0.16], [door.s1, yp + 0.16]], [[[W2[0], W2[2]], [W2[1], W2[2]], [W2[1], W2[3]], [W2[0], W2[3]]]]);
  // plaster above the door lintel
  front.plaster([[door.s0, door.top + 0.18], [door.s1, door.top + 0.18], [door.s1, yp + 0.16], [door.s0, yp + 0.16]]);

  // RIGHT side (towards the oak): plain frame, one small window
  for (const s of [0.08, 1.4, 2.6, Dd - 0.08]) right.timber(s, ys, s, yp);
  right.timber(0.16, 1.3, 1.32, 1.3, 0.12);
  right.timber(1.48, ys + 0.05, 2.52, yp - 0.05, 0.11, 0.12);
  right.timber(2.68, yp - 0.05, Dd - 0.16, ys + 0.05, 0.11, 0.12);
  addWindow(right, mats, rng, 0.35, 1.36, 1.15, 2.1, { cols: 2, rows: 2, glow, glow2 });
  right.plaster([[0, ys], [Dd, ys], [Dd, yp + 0.16], [0, yp + 0.16]], [[[0.35, 1.36], [1.15, 1.36], [1.15, 2.1], [0.35, 2.1]]]);
  // BACK: plain
  for (const s of [0.08, 1.9, 3.7, L - 0.08]) back.timber(s, ys, s, yp);
  back.timber(0.16, 1.4, L - 0.16, 1.4, 0.12);
  back.plaster([[0, ys], [L, ys], [L, yp + 0.16], [0, yp + 0.16]]);
  // LEFT side: two windows (seen from the cottage side), braces
  for (const s of [0.08, 1.45, 2.95, Dd - 0.08]) left.timber(s, ys, s, yp);
  left.timber(0.16, 1.05, Dd - 0.16, 1.05, 0.12);
  addWindow(left, mats, rng, 1.6, 1.12, 2.8, yp - 0.02, { cols: 3, rows: 2, glow, glow2 });
  andreas(left, 0.18, 1.37, ys + 0.02, 0.98);
  andreas(left, 3.03, Dd - 0.18, ys + 0.02, 0.98);
  left.plaster([[0, ys], [Dd, ys], [Dd, yp + 0.16], [0, yp + 0.16]], [[[1.6, 1.12], [2.8, 1.12], [2.8, yp - 0.02], [1.6, yp - 0.02]]]);

  // ── the jettied front gable ────────────────────────────────────────────────
  const gz = hz + jetty; // gable outer face
  const [gs0, gs1] = ANNEX.gableSill;
  // joist heads (Balkenköpfe) carrying the jetty, with rounded carved ends
  for (let i = 0; i < 7; i++) {
    const x = -hx + 0.2 + (i / 6) * (A.width - 0.4);
    const j = board(0.13, eave - plateBottom - 0.0, 0.9, { along: 'z', rng, r: 0.02 });
    F.add(tim, xf(j, [x, (plateBottom + 0.16 + gs0) / 2 + 0.0, hz - 0.3 + 0.0 + jetty * 0.5]));
    const cap = new THREE.CylinderGeometry(0.08, 0.08, 0.13, 12);
    F.add(tim, xf(uvBox(cap, 'y'), [x, (plateBottom + 0.16 + gs0) / 2, hz + jetty - 0.0], [0, 0, Math.PI / 2]));
  }
  // cover board between the joist heads
  F.add(mats.wood('oak'), xf(board(A.width + 0.1, 0.18, 0.04, { along: 'x', rng }), [0, (plateBottom + 0.16 + gs0) / 2, hz + 0.05]));
  const gable = makeWall(F, mats, rng, [0, 0, gz], [1, 0, 0], [0, 0, 1]);
  const gW = hx - (gs1 - eave) / T; // half width of the gable at the sill top
  gable.timber(-hx - 0.1, (gs0 + gs1) / 2, hx + 0.1, (gs0 + gs1) / 2, 0.16, 0.18); // gable sill
  // posts clipped to the roof line
  const apex = yRoof(0);
  const gPost = (x) => gable.timber(x, gs1, x, yRoof(x) - 0.05);
  gPost(-1.28);
  gPost(1.28);
  gable.timber(0, 4.02, 0, apex - 0.08); // king post above the hatch
  gable.timber(-0.42, gs1, -0.42, 4.0, 0.12);
  gable.timber(0.42, gs1, 0.42, 4.0, 0.12);
  // rails
  const rail = (y, fw = 0.13) => {
    const hw = Math.min(hx, (apex - y) / T) - 0.06;
    gable.timber(-hw, y, hw, y, fw);
  };
  rail(3.04);
  rail(3.98);
  // braces — never through a window opening: short steep foot braces
  // (Fussbänder) from the gable posts down into the sill, a long brace in each
  // outer field from the post down to the window rail (towards the eaves),
  // and the "Mann" bracing the king post above
  for (const s of [-1, 1]) {
    gable.timber(s * 1.36, 2.97, s * 1.56, 2.79, 0.1, 0.12, { proud: -0.01 });
    gable.timber(s * 1.36, 3.88, s * 2.08, 3.11, 0.11, 0.13, { proud: -0.01 });
    gable.timber(s * 1.2, 4.05, s * 0.09, 4.95, 0.11, 0.13, { proud: -0.01 });
  }
  // pegs where the braces meet posts & rails
  for (const s of [-1, 1]) for (const [x, y] of [[1.28, 2.97], [1.28, 3.86], [2.1, 3.04], [1.28, 4.05], [0.0, 4.95]]) gable.peg(s * x, y);
  // gable windows with shutters
  const GW = [[-1.18, -0.52], [0.52, 1.18]];
  GW.forEach(([a, b], i) => addWindow(gable, mats, rng, a, 3.1, b, 3.92, { cols: 2, rows: 2, glow, glow2, shutters: i ? 'right' : 'left', shutterColor: '#3e6650' }));
  // the loading hatch (closed planks + strap hinges) between them
  {
    for (let i = 0; i < 4; i++) gable.add(mats.wood('oak'), xf(board(0.19, 0.9, 0.05, { along: 'y', rng }), [-0.29 + i * 0.193, 3.53, -0.03]));
    for (const y of [3.25, 3.8]) {
      gable.add(mats.metal('#2f2b28'), xf(new THREE.BoxGeometry(0.6, 0.04, 0.012), [0.02, y, 0.0]), { cast: false });
    }
    gable.add(mats.metal('#2f2b28'), xf(new THREE.TorusGeometry(0.035, 0.008, 4, 10), [0.2, 3.5, 0.02]), { cast: false });
  }
  // owl hole (round vent) near the apex with a carved surround
  {
    const oy = 5.22;
    const ring = new THREE.TorusGeometry(0.13, 0.04, 6, 16);
    gable.add(mats.wood('oak'), xf(uvBox(ring, 'x'), [0, oy, 0.0]));
    const dark = new THREE.CircleGeometry(0.13, 14);
    gable.add(mats.vc(), xf(dark, [0, oy, -0.03]), { color: '#1c130d', cast: false });
  }
  // gable plaster (triangle minus openings)
  {
    const hwAt = (y) => (apex - y) / T;
    const outline = [[-hwAt(gs1), gs1], [hwAt(gs1), gs1], [0, apex]];
    const holes = [
      ...GW.map(([a, b]) => [[a, 3.1], [b, 3.1], [b, 3.92], [a, 3.92]]),
      [[-0.32, 3.06], [0.32, 3.06], [0.32, 3.98], [-0.32, 3.98]],
    ];
    const circle = [];
    for (let i = 0; i < 12; i++) circle.push([Math.cos((i / 12) * Math.PI * 2) * 0.14, 5.22 + Math.sin((i / 12) * Math.PI * 2) * 0.14]);
    holes.push(circle.reverse());
    gable.plaster(outline, holes);
  }
  // hoist beam with a pulley and a rope tied to a cleat
  {
    const hy = 5.62;
    F.add(tim, timber([0, hy, gz - 0.6], [0, hy, gz + 0.92], 0.15, 0.17, { rng, up: [0, 1, 0] }));
    const end = new THREE.CylinderGeometry(0.085, 0.085, 0.15, 12);
    F.add(tim, xf(uvBox(end, 'y'), [0, hy, gz + 0.92], [0, 0, Math.PI / 2]));
    const iron = mats.metal('#2f2b28');
    F.add(iron, xf(new THREE.TorusGeometry(0.03, 0.01, 4, 8), [0, hy - 0.12, gz + 0.82]), { cast: false });
    const wheel = new THREE.CylinderGeometry(0.075, 0.075, 0.035, 14);
    F.add(mats.wood('walnut'), xf(uvBox(wheel, 'y'), [0, hy - 0.24, gz + 0.82], [0, 0, Math.PI / 2]), { cast: false });
    F.add(iron, xf(new THREE.BoxGeometry(0.012, 0.2, 0.17), [0.03, hy - 0.2, gz + 0.82]), { cast: false });
    F.add(iron, xf(new THREE.BoxGeometry(0.012, 0.2, 0.17), [-0.03, hy - 0.2, gz + 0.82]), { cast: false });
    const rope = mats.rope();
    F.add(rope, tube([[0, hy - 0.2, gz + 0.9], [0.02, hy - 1.2, gz + 0.86], [0.05, 4.35, gz + 0.62], [0.16, 4.1, gz + 0.16]], 0.012, 4, 20), { cast: false });
    // the hook end with a coil hanging from the cleat
    F.add(rope, tube([[0, hy - 0.2, gz + 0.74], [0.01, hy - 0.9, gz + 0.74], [0.0, hy - 1.35, gz + 0.73]], 0.012, 4, 10), { cast: false });
    F.add(iron, xf(new THREE.TorusGeometry(0.05, 0.012, 4, 10, Math.PI * 1.4), [0, hy - 1.42, gz + 0.73], [0, Math.PI / 2, Math.PI]), { cast: false });
    F.add(tim, xf(board(0.2, 0.05, 0.06, { along: 'x', rng }), [0.16, 4.1, gz + 0.03]), { cast: false });
  }

  // ── roof: rafters, purlins with carved ends on brackets, bargeboards ──────
  const zB = -hz - ANNEX.overhangBack, zF = gz + ANNEX.overhangFront;
  const rd = 0.14; // rafter depth
  const cosP = Math.cos(Math.atan(T)), sinP = Math.sin(Math.atan(T));
  const eaveX = hx + ANNEX.overhangSide;
  const roofSurf = (x) => yRoof(x) + rd / cosP; // top of the rafters (deck underside)
  for (const s of [-1, 1]) {
    // rafters
    for (let z = zB + 0.12; z <= zF - 0.05; z += 0.62) {
      const a = [s * eaveX, yRoof(eaveX) + rd / 2 / cosP, z];
      const b = [s * 0.05, yRoof(0.05) + rd / 2 / cosP, z];
      F.add(tim, timber(a, b, 0.1, rd, { rng, up: [s * sinP, cosP, 0], wobble: 0.008 }));
    }
    // purlins (eave & middle) running front to back; ends carved and on brackets
    for (const px of [hx - 0.05, 1.45]) {
      const py = yRoof(px) - 0.09;
      F.add(tim, timber([s * px, py, zB - 0.05], [s * px, py, zF - 0.06], 0.15, 0.17, { rng, up: [0, 1, 0] }));
      const end = new THREE.CylinderGeometry(0.085, 0.085, 0.15, 12);
      F.add(tim, xf(uvBox(end, 'y'), [s * px, py, zF - 0.06], [0, 0, Math.PI / 2]));
      // curved bracket (Bug) from the gable wall up under the purlin end
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        pts.push([s * px, py - 0.75 + t * 0.68 + Math.sin(t * Math.PI) * 0.05, gz - 0.02 + Math.pow(t, 1.6) * (zF - gz - 0.25)]);
      }
      if (px < hx - 0.1) F.add(tim, tube(pts, 0.05, 6, 12));
    }
    // bargeboard along the front gable edge with scalloped underside
    const bb0 = [s * (eaveX + 0.02), roofSurf(eaveX) - 0.03, zF];
    const bb1 = [0, roofSurf(0) - 0.03, zF];
    {
      const g = scallopBoard(Math.hypot(bb1[0] - bb0[0], bb1[1] - bb0[1]), 0.3, 0.05, rng);
      F.add(mats.wood('oak'), alongXUp(g, bb0, bb1, [s * sinP, cosP, 0]));
    }
    // back bargeboard (plain)
    F.add(mats.wood('oak'), timber([s * (eaveX + 0.02), roofSurf(eaveX) - 0.03, zB], [0, roofSurf(0) - 0.03, zB], 0.05, 0.26, { rng, up: [s * sinP, cosP, 0], wobble: 0.004 }));
    // roof deck boards (closing the underside of the overhangs)
    const deckLen = Math.hypot(eaveX, roofSurf(0) - roofSurf(eaveX));
    const deck = new THREE.BoxGeometry(deckLen, 0.025, zF - zB, 4, 1, 14);
    uvBox(deck, 'x');
    xf(deck, [s * eaveX / 2, (roofSurf(eaveX) + roofSurf(0)) / 2 + 0.012, (zF + zB) / 2], [0, 0, s * Math.atan(T) * -1]);
    F.add(mats.wood('spruce'), deck);
  }
  // ridge purlin + finial at the front apex
  F.add(tim, timber([0, apex - 0.1, zB - 0.05], [0, apex - 0.1, zF - 0.04], 0.16, 0.18, { rng }));
  {
    const fin = new THREE.CylinderGeometry(0.05, 0.07, 0.75, 8);
    F.add(mats.wood('oak'), xf(uvBox(fin, 'y'), [0, roofSurf(0) + 0.3, zF + 0.04]));
    F.add(mats.wood('oak'), xf(new THREE.SphereGeometry(0.085, 10, 8), [0, roofSurf(0) + 0.72, zF + 0.04], null, [1, 1.25, 1]));
    F.add(mats.wood('oak'), xf(new THREE.ConeGeometry(0.045, 0.16, 8), [0, roofSurf(0) + 0.88, zF + 0.04]));
  }

  // ── dormer on the right slope (towards the oak) ────────────────────────────
  const dorm = { z: 0.55, w: 1.05, y0: 3.42, h: 0.85 };
  dorm.x = hx - (dorm.y0 - eave) / T + 0.02; // front face where it meets the roof
  {
    const dx = dorm.x, dz = dorm.z, hw = dorm.w / 2, top = dorm.y0 + dorm.h;
    const dw = makeWall(F, mats, rng, [dx, 0, dz + hw], [0, 0, -1], [1, 0, 0]);
    dw.timber(0.06, dorm.y0, 0.06, top);
    dw.timber(dorm.w - 0.06, dorm.y0, dorm.w - 0.06, top);
    dw.timber(-0.05, top - 0.06, dorm.w + 0.05, top - 0.06, 0.12);
    dw.timber(-0.05, dorm.y0 + 0.06, dorm.w + 0.05, dorm.y0 + 0.06, 0.12);
    addWindow(dw, mats, rng, 0.2, dorm.y0 + 0.16, dorm.w - 0.2, top - 0.14, { cols: 2, rows: 2, glow, glow2, sill: false });
    dw.plaster([[0, dorm.y0], [dorm.w, dorm.y0], [dorm.w, top], [0, top]], [[[0.2, dorm.y0 + 0.16], [dorm.w - 0.2, dorm.y0 + 0.16], [dorm.w - 0.2, top - 0.14], [0.2, top - 0.14]]]);
    // cheeks: triangles from the front wall back to where they meet the main roof
    const xr = (y) => hx - (y - eave) / T - 0.02;
    for (const sgn of [-1, 1]) {
      const sh = new THREE.Shape([new THREE.Vector2(dx, dorm.y0 - 0.1), new THREE.Vector2(dx, top), new THREE.Vector2(xr(top) - 0.1, top), new THREE.Vector2(xr(dorm.y0 - 0.1) - 0.1, dorm.y0 - 0.1)]);
      const cg = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: false });
      cg.translate(0, 0, sgn > 0 ? -0.08 : 0);
      uvBox(cg, 'x', 1 / 2.2);
      F.add(mats.plaster(), xf(cg, [0, 0, dz + sgn * hw]));
      // corner board
      F.add(tim, xf(board(0.08, dorm.h + 0.05, 0.08, { along: 'y', rng }), [dx - 0.02, dorm.y0 + dorm.h / 2, dz + sgn * (hw - 0.02)]));
    }
    // little gable roof: two board planes (ridge along x), a carved bargeboard pair in front
    const dp = 0.75;
    const ow = hw + 0.15; // eave overhang
    const rl = Math.hypot(ow, ow * dp);
    const back = xr(top + ow * dp) - 0.15;
    const rlen = dx + 0.22 - back;
    for (const sgn of [-1, 1]) {
      const rf = new THREE.BoxGeometry(rlen, 0.04, rl, 3, 1, 2);
      uvBox(rf, 'x');
      xf(rf, [back + rlen / 2, top + (ow * dp) / 2 + 0.03, dz + (sgn * ow) / 2], [sgn * Math.atan(dp), 0, 0]);
      F.add(mats.wood('spruce'), rf);
      const bb = board(0.04, 0.14, rl + 0.05, { along: 'z', rng });
      F.add(mats.wood('oak'), xf(bb, [dx + 0.22, top + (ow * dp) / 2, dz + (sgn * ow) / 2], [sgn * Math.atan(dp), 0, 0]));
    }
    dorm.ridge = top + ow * dp;
    dorm.ow = ow;
    dorm.back = back;
  }

  // ── shingles ───────────────────────────────────────────────────────────────
  const field = new ShingleField();
  const slopeLen = Math.hypot(eaveX, roofSurf(0) - roofSurf(eaveX));
  const tmpCol = new THREE.Color();
  for (const s of [-1, 1]) {
    const up = new THREE.Vector3(-s * cosP, sinP, 0).normalize();
    const normal = new THREE.Vector3(s * sinP, cosP, 0);
    const along = s > 0 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 0, 1);
    // alongDir × upDir must = normal for a right-handed basis
    const origin = new THREE.Vector3(s * (eaveX + 0.06), roofSurf(eaveX + 0.06) + 0.025, s > 0 ? zF + 0.06 : zB - 0.06);
    layShingles(field, {
      origin,
      alongDir: along,
      upDir: up,
      normal,
      length: zF - zB + 0.12,
      height: slopeLen + 0.02,
      rng,
      skip: (u, v) => {
        if (s < 0) return false;
        // leave room for the dormer: its box below its eaves, its gable roof above (a triangle)
        const z = zF + 0.06 - u;
        const y = roofSurf(eaveX + 0.06) + v * sinP;
        const dzz = Math.abs(z - dorm.z);
        if (y < dorm.y0 - 0.12 || y > dorm.ridge + 0.1) return false;
        if (y < dorm.y0 + dorm.h) return dzz < dorm.w / 2 + 0.06;
        const k = 1 - (y - dorm.y0 - dorm.h) / (dorm.ridge - dorm.y0 - dorm.h);
        return dzz < dorm.ow * k + 0.04;
      },
      tint: (u, v, c, p) => {
        // moss creeping up from the eaves and in patches; sun-bleached near the ridge
        const n = noiseA(p.z * 0.9 + s * 3, p.y * 0.9) * 0.5 + 0.5;
        const mossy = THREE.MathUtils.clamp((1 - v / 1.4) * 0.8 + (n - 0.62) * 2.2, 0, 1) * (s < 0 ? 1 : 0.8);
        if (mossy > 0.05) c.lerp(tmpCol.setRGB(0.55, 0.78, 0.36), mossy * 0.7);
        if (v > slopeLen - 0.8) c.multiplyScalar(1.08);
      },
      transform: (p) => crook(p),
    });
  }
  // ridge cap: a double row of shingles along the ridge
  for (let z = zB; z < zF; z += 0.2) {
    for (const s of [-1, 1]) {
      // width runs down from the ridge, length along the ridge, normal outwards
      const a = 0.55;
      const X = new THREE.Vector3(s * Math.cos(a), -Math.sin(a), 0);
      const Y = new THREE.Vector3(0, 0, -s);
      const Z = new THREE.Vector3().crossVectors(X, Y);
      const m = new THREE.Matrix4().makeBasis(X, Y, Z);
      const p = new THREE.Vector3(s * 0.085, roofSurf(0) + 0.06, z + (s > 0 ? 0.2 : 0) + rng.jitter(0.02));
      crook(p);
      m.setPosition(p);
      field.push(m, tmpCol.setRGB(0.7, 0.66, 0.58));
    }
  }
  // dormer roof shingles
  {
    const dp = 0.75;
    const hw = dorm.w / 2 + 0.15;
    const top = dorm.y0 + dorm.h;
    const dl = Math.hypot(hw, hw * dp);
    const ca = Math.cos(Math.atan(dp)), sa = Math.sin(Math.atan(dp));
    for (const s of [-1, 1]) {
      layShingles(field, {
        origin: new THREE.Vector3(s > 0 ? dorm.back : dorm.x + 0.24, top + 0.06, dorm.z + s * hw),
        alongDir: new THREE.Vector3(s, 0, 0),
        upDir: new THREE.Vector3(0, sa, -s * ca),
        normal: new THREE.Vector3(0, ca, s * sa),
        length: dorm.x + 0.24 - dorm.back,
        height: dl,
        w: 0.17,
        exposure: 0.11,
        rng,
        transform: (p) => crook(p),
      });
    }
  }
  // built by the main module once the porch has added its shingles too
  const shingles = {
    field,
    build(parent, material) {
      const mesh = field.build(parent, material, shingleGeo(0.2, 0.34, 0.022));
      if (mesh) mesh.applyMatrix4(annexMatrix);
      return mesh;
    },
  };

  // moss cushions along the eaves, the ridge and on the bargeboards
  for (const s of [-1, 1]) {
    // cushions lying on the slope (rotated into the roof plane), longer along the eave
    const lay = (x, z, r, h, sx = 1, sz = 1) => {
      const m = mossGeo(rng, { r, h, sx, sz });
      const y = roofSurf(Math.abs(x)) + 0.035;
      F.add(mats.moss(), xf(m, [x, y, z], [0, 0, -s * Math.atan(T)]), { cast: false });
    };
    for (let z = zB + 0.1; z < zF; z += rng.range(0.18, 0.4)) {
      if (rng.next() < 0.25) continue;
      lay(s * (eaveX - rng.range(0.08, 0.3)), z, rng.range(0.08, 0.17), rng.range(0.02, 0.04), 0.8, 2.2);
    }
    // patches creeping up the slope in the shade (more on the left/north side)
    for (let i = 0; i < (s < 0 ? 26 : 12); i++) {
      const x = s * rng.range(0.6, eaveX - 0.4);
      lay(x, rng.range(zB + 0.2, zF - 0.2), rng.range(0.07, 0.15), rng.range(0.015, 0.03), 1.2, 1.6);
    }
    for (let z = zB; z < zF; z += rng.range(0.25, 0.6)) {
      const m = mossGeo(rng, { r: rng.range(0.07, 0.14), h: 0.035, sz: 2 });
      F.add(mats.moss(), xf(m, [s * 0.08, roofSurf(0) + 0.07, z], [0, 0, s * -0.55]), { cast: false });
    }
  }

  // ── the leaning fieldstone chimney (left slope, near the back) ─────────────
  const chim = { x: -1.05, z: -1.05 };
  {
    const baseY = yRoof(Math.abs(chim.x)) - 0.5;
    const topY = apex + 1.0;
    const lean = -0.07;
    let y = baseY;
    const cw = 0.52;
    let course = 0;
    while (y < topY) {
      const ch = rng.range(0.15, 0.2); // chunky courses (cute, and fewer stones)
      const sideStones = 2;
      for (let face = 0; face < 4; face++) {
        for (let k = 0; k < sideStones; k++) {
          const t = (k + 0.5) / sideStones - 0.5 + (course % 2 ? 0.25 : 0) * (k ? -1 : 1) * 0.3;
          const g = stoneGeo(rng, { r: 1, sx: cw * 0.3, sy: ch * 0.6, sz: 0.12, lump: 0.18 });
          const a = (face * Math.PI) / 2;
          const ox = Math.sin(a) * (cw / 2) + Math.cos(a) * t * cw;
          const oz = Math.cos(a) * (cw / 2) - Math.sin(a) * t * cw;
          const leanX = (y - baseY) * lean;
          xf(g, [chim.x + ox + leanX, y + ch / 2, chim.z + oz], [rng.jitter(0.05), a, rng.jitter(0.05) + lean]);
          F.add(mats.stone(), g);
        }
      }
      y += ch;
      course++;
    }
    const leanTop = (topY - baseY) * lean;
    const core = new THREE.BoxGeometry(cw - 0.06, topY - baseY, cw - 0.06);
    xf(core, [chim.x + leanTop / 2, (topY + baseY) / 2, chim.z], [0, 0, lean]);
    F.add(mats.stone(), uvBox(core, 'y', 1));
    // cap slab + a little clay pot
    const cap = stoneGeo(rng, { r: 1, sx: 0.42, sy: 0.06, sz: 0.42, lump: 0.08 });
    F.add(mats.stone(), xf(cap, [chim.x + leanTop, topY + 0.04, chim.z], [0, 0.3, lean]));
    const pot = new THREE.CylinderGeometry(0.12, 0.15, 0.26, 10, 1, true);
    F.add(mats.clay('#a65a3a'), xf(uvBox(pot, 'y'), [chim.x + leanTop + 0.02, topY + 0.2, chim.z], [0, 0, lean]), { cast: false });
    F.add(mats.vc(), xf(new THREE.CircleGeometry(0.11, 10), [chim.x + leanTop + 0.025, topY + 0.32, chim.z], [-Math.PI / 2, 0, 0]), { color: '#120c08', cast: false });
    // moss on the cap
    F.add(mats.moss(), xf(mossGeo(rng, { r: 0.2, h: 0.06 }), [chim.x + leanTop - 0.12, topY + 0.08, chim.z + 0.1]), { cast: false });
    chim.top = annexToWorld(chim.x + leanTop + 0.02, topY + 0.35, chim.z);
  }
  const smoke = makeSmoke(ctx, { position: chim.top, count: 14, rise: 3.6, wind: [0.9, -0.3] });
  ctx.scene.add(smoke.object);

  // ── ivy & greenery on the walls ────────────────────────────────────────────
  {
    // ivy climbing the front-left corner and hanging from the jetty
    addIvy(front, mats, rng, [0.05, 0.5, 0.04], [0.15, 1, 0], { length: 2.3, droop: -0.5, size: 0.075, normal: [0, 0, 1] });
    addIvy(front, mats, rng, [0.3, 0.45, 0.04], [0.4, 1, 0], { length: 1.4, droop: -0.4, size: 0.07, normal: [0, 0, 1] });
    for (let i = 0; i < 5; i++) {
      const s = rng.range(0.1, 1.5);
      addIvy(front, mats, rng, [s, plateBottom + 0.1, 0.25], [rng.jitter(0.3), -1, 0], { length: rng.range(0.4, 0.9), droop: 1, size: 0.065, normal: [0, 0, 1] });
    }
    addIvy(left, mats, rng, [Dd - 0.1, 0.5, 0.04], [-0.2, 1, 0], { length: 2.0, droop: -0.5, size: 0.075, normal: [0, 0, 1] });
    // the oak side is overgrown
    addIvy(right, mats, rng, [1.8, 0.45, 0.04], [0.1, 1, 0], { length: 2.4, droop: -0.6, size: 0.08, normal: [0, 0, 1] });
    addIvy(right, mats, rng, [3.6, 0.45, 0.04], [-0.3, 1, 0], { length: 2.2, droop: -0.6, size: 0.08, normal: [0, 0, 1] });
  }
  // moss on the plinth stones & toadstools at the foot of the walls
  for (let i = 0; i < 26; i++) {
    const side = rng.int(0, 3);
    let x, z;
    const t = rng.next();
    if (side === 0) {
      x = -hx + t * A.width;
      z = hz + 0.1;
      if (x + hx > door.s0 - 0.1 && x + hx < door.s1 + 0.1) continue;
    } else if (side === 1) {
      x = hx + 0.1;
      z = hz - t * Dd;
    } else if (side === 2) {
      x = hx - t * A.width;
      z = -hz - 0.1;
    } else {
      x = -hx - 0.1;
      z = -hz + t * Dd;
    }
    F.add(mats.moss(), xf(mossGeo(rng, { r: rng.range(0.08, 0.2), h: 0.05 }), [x, plinth - 0.01, z]), { cast: false });
    if (rng.next() < 0.45) F.add(mats.moss(), xf(mossGeo(rng, { r: rng.range(0.15, 0.3), h: 0.07 }), [x * 1.02, 0, z * 1.02]), { cast: false });
    if (rng.next() < 0.35) addToadstool(F, mats, rng, x * 1.04 + rng.jitter(0.1), 0, z * 1.04 + rng.jitter(0.1), { size: rng.range(0.07, 0.12), color: rng.pick(['#c9352a', '#c9352a', '#b98a4e']) });
  }

  // ── the double door: open leaves + threshold ───────────────────────────────
  {
    const dw = (door.s1 - door.s0) / 2;
    // each leaf is built extending from its hinge (x = 0) towards the opening (dir = +1 left leaf, −1 right leaf)
    // the right leaf swings right round (beyond square) so the lit shop shows
    // from the spot camera; both are plain oiled oak, not the painted frame
    const leafWood = mats.timber();
    for (const [dir, ang] of [[1, 1.42], [-1, 2.25]]) {
      const leaf = new Batch();
      for (let k = 0; k < 5; k++) {
        const pw = dw / 5;
        leaf.add(leafWood, xf(board(pw - 0.008, door.top - 0.03, 0.05, { along: 'y', rng, scale: 1 / 1.6 }), [dir * pw * (k + 0.5), (door.top + 0.03) / 2, 0]));
      }
      for (const y of [0.3, door.top - 0.3]) leaf.add(leafWood, xf(board(dw - 0.06, 0.12, 0.035, { along: 'x', rng, scale: 1 / 1.6 }), [dir * dw / 2, y, -0.04]));
      const bl = Math.hypot(dw - 0.12, door.top - 0.72);
      leaf.add(leafWood, xf(board(bl, 0.11, 0.03, { along: 'x', rng }), [dir * dw / 2, door.top / 2, -0.04], [0, 0, dir * Math.atan2(door.top - 0.72, dw - 0.12)]));
      for (const y of [0.3, door.top - 0.3]) {
        leaf.add(mats.metal('#2f2b28'), xf(new THREE.BoxGeometry(dw * 0.75, 0.045, 0.012), [dir * dw * 0.375, y, 0.032]), { cast: false });
        leaf.add(mats.metal('#2f2b28'), xf(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), [0, y, 0.0]), { cast: false });
      }
      // a ring handle on the free edge
      leaf.add(mats.metal('#2f2b28'), xf(new THREE.TorusGeometry(0.05, 0.01, 4, 12), [dir * (dw - 0.12), 1.0, 0.04]), { cast: false });
      const m = new THREE.Matrix4();
      const hingeX = dir > 0 ? door.s0 - hx : door.s1 - hx;
      // opened outwards: the free edge swings towards +z
      m.compose(new THREE.Vector3(hingeX, 0.02, hz + 0.03), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -dir * ang, 0)), new THREE.Vector3(1, 1, 1));
      for (const e of leaf.lists.values()) for (const geo of e.geos) F.add(e.material, geo.applyMatrix4(m), { cast: e.cast });
      leaf.lists.clear();
    }
    // threshold stone and a worn board ramp
    const th = stoneGeo(rng, { r: 1, sx: (door.s1 - door.s0) * 0.55, sy: 0.07, sz: 0.3, lump: 0.08 });
    F.add(mats.stone(), xf(th, [(door.s0 + door.s1) / 2 - hx, 0.03, hz + 0.1]));
  }

  // ── interior (seen through the open door) ──────────────────────────────────
  const interior = buildInterior(ctx, F, mats, rng);
  // warm light inside, spilling out of the door and windows (budgeted)
  const light = ctx.lights?.addPoint?.(annexToWorld(-0.6, 1.6, 0.8), { color: '#ffb866', day: 1.2, night: 7, distance: 7 });

  // a glow halo in each window at night
  for (const [x, y, z, sz] of [[W1[0] + 0.65 - hx, 1.65, hz + 0.25, 0.95], [W2[0] + 0.5 - hx, 1.5, hz + 0.25, 0.7], [-0.85, 3.5, gz + 0.2, 0.8], [0.85, 3.5, gz + 0.2, 0.8], [dorm.x + 0.2, dorm.y0 + 0.4, dorm.z, 0.5]]) {
    pushHalo(annexToWorld(x, y, z), sz);
  }

  return {
    group,
    shingles,
    smoke,
    interior,
    light,
    update(dt, t) {
      smoke.update(dt, t);
    },
    anchors: { chimneyTop: chim.top },
  };
}

/**
 * Workshop interior (seen through the open double door): a bright spruce back
 * wall with a dense shadow board (frame saw, hand saws, chisels, brace,
 * hammers, squares …) and a shelf of planes, a rack of F-clamps, a band saw in
 * the back-left corner, an older second bench as the glue-up station (a
 * dovetailed carcass in red clamps, a half-assembled drawer), shavings on the
 * floor, boards leaning on the side wall and a low enamel lamp over it all.
 */
function buildInterior(ctx, F, mats, rng) {
  const { hx, hz, floor } = ANNEX;
  const z0 = -0.55; // the interior partition (the back is storage under the roots)
  const ix0 = -hx + 0.16, ix1 = hx - 0.16;
  const vc = mats.vc();
  const steel = mats.metal('#9aa1a6');
  // floor planks
  for (let x = ix0; x < ix1; x += 0.2) {
    const w = Math.min(0.2, ix1 - x) - 0.008;
    F.add(mats.wood('oak'), xf(board(w, 0.05, hz - z0, { along: 'z', rng }), [x + w / 2, floor - 0.025, (hz + z0) / 2]), { cast: false });
  }
  // back partition: pale spruce boards — a bright wall behind the work
  for (let x = ix0; x < ix1; x += 0.24) {
    F.add(mats.wood('spruce'), xf(board(0.235, 2.3, 0.04, { along: 'y', rng }), [x + 0.12, floor + 1.15, z0]), { color: rng.pick(['#e2cfa6', '#d9c49a', '#e8d6b0']) });
  }
  // inner faces of the side walls & ceiling joists near the door
  for (const s of [-1, 1]) F.add(mats.plaster(), xf(new THREE.BoxGeometry(0.04, 2.3, hz - z0), [s * (hx - 0.17), floor + 1.15, (hz + z0) / 2]), { cast: false });
  for (let x = ix0 + 0.3; x < ix1; x += 0.85) F.add(mats.timber(), xf(board(0.12, 0.14, hz - z0 + 0.2, { along: 'z', rng }), [x, ANNEX.plateBottom + 0.07, (hz + z0) / 2]), { cast: false });
  F.add(mats.wood('spruce'), xf(new THREE.BoxGeometry(ix1 - ix0, 0.03, hz - z0), [0, ANNEX.plateBottom + 0.15, (hz + z0) / 2]), { cast: false });

  // ── the shadow board (painted panel) with its tools ───────────────────────
  const sbx = -0.42, sby = 1.27, sbw = 2.0, sbh = 0.92;
  const zt = z0 + 0.07;
  F.add(vc, xf(rbox(sbw, sbh, 0.03, 0.01), [sbx, sby, z0 + 0.04]), { color: '#3d5a48' });
  // a frame saw with curved arms and its twisted cord
  addBowSaw(F, mats, rng, mat4([sbx - 0.7, sby + 0.04, zt]), { scale: 0.82 });
  // two hand saws, handle up: wide heel tapering to the toe, closed handles
  addHandSaw(F, mats, mat4([sbx - 0.3, sby + 0.36, zt], [0, 0, -Math.PI / 2]), { len: 0.5, wood: '#5c4334' });
  addHandSaw(F, mats, mat4([sbx - 0.08, sby + 0.36, zt + 0.004], [0, 0, -Math.PI / 2]), { len: 0.44, wood: '#9c5a43' });
  // a brace (Bohrwinde): head, crank, chuck
  {
    const bx = sbx + 0.16, by = sby + 0.05;
    const crank = [[bx, by + 0.2, zt], [bx, by + 0.12, zt], [bx + 0.09, by + 0.08, zt + 0.01], [bx + 0.09, by - 0.04, zt + 0.01], [bx, by - 0.08, zt], [bx, by - 0.16, zt]];
    F.add(steel, tube(crank, 0.008, 5, 18), { cast: false });
    F.add(mats.wood('#9c5a43'), xf(turned([[0, 0], [0.035, 0.0], [0.04, 0.025], [0.02, 0.045], [0, 0.045]]), [bx, by + 0.2, zt]), { cast: false });
    F.add(mats.wood('#9c5a43'), xf(new THREE.CylinderGeometry(0.018, 0.018, 0.07, 8), [bx + 0.09, by + 0.02, zt + 0.01]), { cast: false });
    F.add(steel, xf(new THREE.CylinderGeometry(0.016, 0.01, 0.06, 8), [bx, by - 0.19, zt]), { cast: false });
  }
  // hammers: a Swiss joiner's hammer and a claw hammer, heads on pegs
  for (const [hx2, w] of [[sbx + 0.36, 0.1], [sbx + 0.46, 0.12]]) {
    F.add(mats.wood('ash'), xf(new THREE.CylinderGeometry(0.011, 0.013, 0.28, 6), [hx2, sby + 0.08, zt]), { cast: false });
    F.add(mats.metal('#4a4f55'), xf(new THREE.BoxGeometry(w, 0.026, 0.024), [hx2, sby + 0.23, zt + 0.005]), { cast: false });
  }
  // squares (a try square and a big framing square), a sliding bevel, dividers
  F.add(mats.wood('walnut'), xf(board(0.035, 0.26, 0.02, { along: 'y' }), [sbx + 0.62, sby + 0.18, zt]), { cast: false });
  F.add(steel, xf(new THREE.BoxGeometry(0.2, 0.026, 0.004), [sbx + 0.72, sby + 0.06, zt]), { cast: false });
  F.add(steel, xf(new THREE.BoxGeometry(0.03, 0.4, 0.004), [sbx + 0.9, sby + 0.12, zt]), { cast: false });
  F.add(steel, xf(new THREE.BoxGeometry(0.26, 0.03, 0.004), [sbx + 0.78, sby - 0.07, zt]), { cast: false });
  for (const s of [-1, 1]) F.add(steel, xf(new THREE.BoxGeometry(0.008, 0.2, 0.006), [sbx + 0.6 + s * 0.025, sby - 0.22, zt], [0, 0, s * 0.14]), { cast: false });
  // files & rasps, screwdrivers with turned handles
  for (let i = 0; i < 3; i++) {
    const x = sbx + 0.36 + i * 0.05;
    F.add(mats.metal('#55595e'), xf(new THREE.BoxGeometry(0.016, 0.2, 0.006), [x, sby - 0.2, zt]), { cast: false });
    F.add(mats.wood('#b07a48'), xf(new THREE.CylinderGeometry(0.012, 0.014, 0.07, 6), [x, sby - 0.06, zt]), { cast: false });
  }
  for (let i = 0; i < 3; i++) {
    const x = sbx + 0.08 + i * 0.06;
    F.add(steel, xf(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 4), [x, sby - 0.28, zt]), { cast: false });
    F.add(mats.wood(['#c4372a', '#e8c22a', '#9c5a43'][i]), xf(new THREE.CylinderGeometry(0.014, 0.012, 0.08, 6), [x, sby - 0.18, zt]), { cast: false });
  }
  // a row of chisels in a rack
  F.add(mats.wood('oak'), xf(board(0.66, 0.05, 0.06, { along: 'x', rng }), [sbx - 0.6, sby - 0.3, zt + 0.02]), { cast: false });
  for (let i = 0; i < 8; i++) {
    const x = sbx - 0.88 + i * 0.08;
    F.add(mats.wood('ash'), xf(new THREE.CylinderGeometry(0.014, 0.012, 0.12, 6), [x, sby - 0.22, zt + 0.02]), { cast: false });
    F.add(steel, xf(new THREE.BoxGeometry(0.012 + (i % 3) * 0.006, 0.12, 0.004), [x, sby - 0.34, zt + 0.02]), { cast: false });
  }
  // a shelf of hand planes above the board, jars & an oil can at its end
  F.add(mats.wood('oak'), xf(board(1.9, 0.035, 0.18, { along: 'x', rng }), [sbx, sby + sbh / 2 + 0.06, z0 + 0.1]), { cast: false });
  for (let i = 0; i < 6; i++) {
    const len = [0.26, 0.2, 0.42, 0.16, 0.22, 0.3][i];
    const x = sbx - 0.78 + i * 0.28;
    F.add(mats.wood('beech'), xf(board(len, 0.06, 0.06, { along: 'x', rng }), [x, sby + sbh / 2 + 0.11, z0 + 0.1]), { cast: false });
    F.add(mats.wood('beech'), xf(new THREE.SphereGeometry(0.025, 6, 4), [x + len * 0.35, sby + sbh / 2 + 0.15, z0 + 0.1]), { cast: false });
  }
  for (let i = 0; i < 3; i++) F.add(vc, xf(new THREE.CylinderGeometry(0.035, 0.035, 0.09, 8), [sbx + 0.88 - i * 0.08, sby + sbh / 2 + 0.12, z0 + 0.1]), { color: rng.pick(['#8a5a3b', '#c9a26b', '#5c3d27']), cast: false });

  // ── a rack of F-clamps on the back wall, right of the board ──────────────
  {
    const rx0 = 0.78, rx1 = 1.95, ry = 1.62;
    F.add(mats.wood('oak'), xf(board(rx1 - rx0 + 0.1, 0.06, 0.07, { along: 'x', rng }), [(rx0 + rx1) / 2, ry, z0 + 0.06]));
    const cols = ['#c4372a', '#c4372a', '#3f6f9a', '#c4372a', '#d9a441', '#c4372a', '#3f6f9a', '#c4372a', '#c4372a'];
    for (let i = 0; i < cols.length; i++) {
      const x = rx0 + (i / (cols.length - 1)) * (rx1 - rx0);
      const len = [0.6, 0.48, 0.8, 0.6, 0.4, 0.7, 0.55, 0.48, 0.62][i];
      // hung by the fixed jaw over the rail: bar down, jaws towards the wall
      addFClamp(F, mats, mat4([x, ry + 0.064 - len, z0 + 0.13], [0, Math.PI / 2, 0]), { len, reach: 0.1, color: cols[i], open: 0.3 + (i % 3) * 0.12 });
    }
  }
  // the old clamp rack on the left wall (long sash clamps)
  {
    const rx = -hx + 0.22;
    F.add(mats.wood('oak'), xf(board(0.06, 0.08, 1.4, { along: 'z', rng }), [rx, 1.75, 1.1]));
    for (let i = 0; i < 9; i++) {
      const z = 0.5 + i * 0.14;
      const len = rng.range(0.45, 0.75);
      F.add(steel, xf(new THREE.BoxGeometry(0.012, len, 0.03), [rx + 0.06, 1.8 - len / 2, z]), { cast: false });
      F.add(mats.metal('#b23a2a'), xf(new THREE.BoxGeometry(0.03, 0.03, 0.12), [rx + 0.06, 1.79, z + 0.05]), { cast: false });
      F.add(mats.metal('#b23a2a'), xf(new THREE.BoxGeometry(0.03, 0.03, 0.12), [rx + 0.06, 1.8 - len + 0.12, z + 0.05]), { cast: false });
      F.add(mats.wood('maple'), xf(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 6), [rx + 0.06, 1.8 - len + 0.05, z + 0.1]), { cast: false });
    }
  }

  // ── a band saw in the back-left corner (cast-iron frame, two wheel housings) ─
  {
    const bx = -1.86, bz = z0 + 0.36;
    const paintC = mats.metal('#6f8f80');
    const dark = mats.metal('#2f3436');
    F.add(paintC, xf(rbox(0.5, 0.62, 0.42, 0.03), [bx, floor + 0.31, bz]));
    F.add(dark, xf(new THREE.BoxGeometry(0.52, 0.05, 0.44), [bx, floor + 0.02, bz]), { cast: false });
    F.add(paintC, xf(rbox(0.11, 1.0, 0.14, 0.02), [bx - 0.2, floor + 1.05, bz]));
    const wheel = new THREE.CylinderGeometry(0.25, 0.25, 0.14, 22);
    wheel.rotateX(Math.PI / 2);
    F.add(paintC, xf(wheel.clone(), [bx - 0.02, floor + 1.55, bz]));
    F.add(dark, xf(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 10).rotateX(Math.PI / 2), [bx - 0.02, floor + 1.55, bz]), { cast: false });
    // the table on its trunnion, the blade guard and the blade
    F.add(mats.metal('#8f969b'), xf(new THREE.BoxGeometry(0.46, 0.035, 0.44), [bx + 0.02, floor + 0.86, bz + 0.02]));
    F.add(dark, xf(new THREE.BoxGeometry(0.1, 0.18, 0.1), [bx + 0.02, floor + 0.74, bz]), { cast: false });
    F.add(paintC, xf(new THREE.BoxGeometry(0.04, 0.42, 0.05), [bx + 0.1, floor + 1.1, bz + 0.03]), { cast: false });
    F.add(mats.metal('#c9cfd4'), xf(new THREE.BoxGeometry(0.004, 0.36, 0.012), [bx + 0.1, floor + 0.98, bz + 0.065]), { cast: false });
    // a switch box and an offcut on the table
    F.add(dark, xf(new THREE.BoxGeometry(0.08, 0.1, 0.05), [bx + 0.27, floor + 0.55, bz + 0.12]), { cast: false });
    F.add(vc, xf(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 8).rotateX(Math.PI / 2), [bx + 0.27, floor + 0.57, bz + 0.15]), { color: '#c4271c', cast: false });
    F.add(mats.wood('cherry'), xf(board(0.2, 0.04, 0.08, { along: 'x', rng }), [bx + 0.06, floor + 0.9, bz + 0.1], [0, 0.4, 0]), { cast: false });
  }

  // ── the glue-up station: an older bench with a carcass in clamps ─────────
  {
    const bx = -0.3, bz = z0 + 0.42, top = 0.44; // lower than the porch Hobelbank
    const oldTop = mats.wood('#b8956c');
    F.add(oldTop, xf(board(1.7, 0.07, 0.5, { along: 'x', rng }), [bx, floor + top - 0.035, bz]));
    for (const s of [-1, 1]) {
      for (const t of [-1, 1]) F.add(mats.wood('#7a5539'), xf(board(0.07, top - 0.07, 0.07, { along: 'y', rng }), [bx + s * 0.72, floor + (top - 0.07) / 2, bz + t * 0.17]));
      F.add(mats.wood('#7a5539'), xf(board(0.08, 0.06, 0.48, { along: 'z', rng }), [bx + s * 0.72, floor + 0.03, bz]));
    }
    F.add(mats.wood('#7a5539'), xf(board(1.4, 0.06, 0.05, { along: 'x', rng }), [bx, floor + 0.14, bz]));
    // a simple front vise with a wooden spindle
    F.add(mats.wood('#c9a47c'), xf(board(0.22, 0.18, 0.05, { along: 'x', rng }), [bx - 0.65, floor + top - 0.09, bz + 0.28]));
    F.add(mats.wood('#c9a47c'), xf(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 10).rotateX(Math.PI / 2), [bx - 0.65, floor + top - 0.1, bz + 0.36]));
    F.add(mats.wood('#c9a47c'), xf(new THREE.CylinderGeometry(0.01, 0.01, 0.26, 6), [bx - 0.65, floor + top - 0.16, bz + 0.43], [0, 0, 0.3]));
    // the carcass: a small oak cabinet with through dovetails, glued up in clamps
    const cx = bx - 0.12, cz = bz - 0.02, cw = 0.54, ch = 0.4, cd = 0.28, t = 0.022;
    const y0 = floor + top;
    const oak = mats.wood('#b08e64');
    F.add(oak, xf(board(t, ch, cd, { along: 'y', rng, r: 0.004 }), [cx - cw / 2 + t / 2, y0 + ch / 2, cz]));
    F.add(oak, xf(board(t, ch, cd, { along: 'y', rng, r: 0.004 }), [cx + cw / 2 - t / 2, y0 + ch / 2, cz]));
    F.add(oak, xf(board(cw, t, cd, { along: 'x', rng, r: 0.004 }), [cx, y0 + ch - t / 2, cz]));
    F.add(oak, xf(board(cw, t, cd, { along: 'x', rng, r: 0.004 }), [cx, y0 + t / 2, cz]));
    F.add(mats.wood('#c2a37a'), xf(board(cw - 2 * t, ch - 2 * t, 0.008, { along: 'x', rng }), [cx, y0 + ch / 2, cz - cd / 2 + 0.006]), { cast: false });
    // the dovetails: darker end-grain tails on the sides, pins on the top
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const z = cz - cd / 2 + 0.035 + k * ((cd - 0.07) / 3);
        const tail = new THREE.Shape([new THREE.Vector2(-0.014, 0), new THREE.Vector2(0.014, 0), new THREE.Vector2(0.02, t), new THREE.Vector2(-0.02, t)]);
        for (const [yy, flip] of [[y0 + ch - t, 1], [y0, -1]]) {
          const g = new THREE.ShapeGeometry(tail);
          if (flip < 0) g.rotateZ(Math.PI).translate(0, t, 0);
          F.add(vc, xf(g, [cx + s * (cw / 2 + 0.0008), yy, z], [0, s * Math.PI / 2, 0]), { color: '#6e5236', cast: false });
          // and the tail's end grain on the top/bottom face
          F.add(vc, xf(new THREE.PlaneGeometry(t, 0.03), [cx + s * (cw / 2 - t / 2), flip > 0 ? y0 + ch + 0.0008 : y0 + 0.0008, z], [-Math.PI / 2, 0, 0]), { color: '#7d5f40', cast: false });
        }
      }
    }
    // a glue squeeze-out line and the white glue bottle with its orange cap
    F.add(vc, xf(new THREE.BoxGeometry(cw - 0.06, 0.004, 0.004), [cx, y0 + ch - t - 0.002, cz + cd / 2 - 0.004]), { color: '#f4efe2', cast: false });
    F.add(vc, xf(new THREE.CylinderGeometry(0.03, 0.032, 0.12, 10), [bx + 0.42, y0 + 0.06, bz + 0.1]), { color: '#f2f0ea', cast: false });
    F.add(vc, xf(new THREE.ConeGeometry(0.02, 0.05, 8), [bx + 0.42, y0 + 0.145, bz + 0.1]), { color: '#e8772e', cast: false });
    // two clamps across the top (jaws down the sides), one across the front at the bottom
    const clampLen = cw + 0.2;
    const openK = (clampLen - 0.017 - cw - 0.03) / clampLen;
    for (const dz of [cd / 2 - 0.05, -cd / 2 + 0.05]) {
      addFClamp(F, mats, mat4([cx - clampLen / 2 - 0.0, y0 + ch + 0.012 + 0.11, cz + dz], [0, 0, -Math.PI / 2]), { len: clampLen, reach: 0.12, color: '#c4372a', open: openK });
    }
    addFClamp(F, mats, mat4([cx - clampLen / 2, y0 + 0.08, cz + cd / 2 + 0.11], [Math.PI / 2, 0, -Math.PI / 2]), { len: clampLen, reach: 0.12, color: '#3f6f9a', open: openK });
    // the half-assembled dovetailed drawer: front with one side on, the other side waiting
    {
      const dx = bx + 0.45, dz = bz - 0.05;
      const cherry = mats.wood('cherry');
      F.add(cherry, xf(board(0.34, 0.11, 0.02, { along: 'x', rng, r: 0.003 }), [dx, y0 + 0.055, dz + 0.1]));
      F.add(cherry, xf(board(0.015, 0.11, 0.26, { along: 'z', rng, r: 0.003 }), [dx - 0.16, y0 + 0.055, dz - 0.03]));
      for (let k = 0; k < 3; k++) F.add(vc, xf(new THREE.PlaneGeometry(0.012, 0.022), [dx - 0.1675 - 0.0008, y0 + 0.02 + k * 0.035, dz + 0.09], [0, -Math.PI / 2, 0]), { color: '#5e3424', cast: false });
      // the loose side, its tails cut, lying flat
      F.add(cherry, xf(board(0.26, 0.015, 0.11, { along: 'x', rng, r: 0.003 }), [dx + 0.08, y0 + 0.0075, dz - 0.1], [0, 0.25, 0]));
    }
  }

  // boards leaning against the right wall (different species, stickers between)
  {
    const species = ['oak', 'walnut', 'cherry', 'maple', 'spruce', 'ash', 'oak'];
    for (let i = 0; i < species.length; i++) {
      const h = rng.range(1.6, 2.1);
      const z = 0.0 + i * 0.13;
      F.add(mats.wood(species[i]), xf(board(0.03, h, 0.12 + rng.range(0, 0.08), { along: 'y', rng }), [hx - 0.32 - i * 0.02, floor + h / 2 * Math.cos(0.18), z], [0, 0, 0.18 + rng.jitter(0.04)]));
    }
  }
  // sawdust and curly shavings on the floor near the benches and the door
  for (let i = 0; i < 7; i++) {
    const g = mossGeo(rng, { r: rng.range(0.12, 0.3), h: 0.015 });
    F.add(vc, xf(g, [rng.range(-1.5, 0.8), floor, rng.range(z0 + 0.3, hz - 0.3)]), { color: '#e3c995', cast: false });
  }
  {
    const sg = doubleFace(shavingGeo(0.032, 0.02, 1.3));
    for (let i = 0; i < 26; i++) {
      F.add(mats.wood('maple'), xf(sg.clone(), [rng.range(-1.2, 0.6), floor + 0.015, rng.range(z0 + 0.7, hz - 0.15)], [rng.next() * 6, rng.next() * 6, rng.next() * 6], rng.range(0.8, 1.4)), { cast: false });
    }
  }
  // a low enamel lamp over the glue-up (glows through the door)
  {
    const lx = -0.35, ly = 1.62, lz = 0.05;
    const enamel = mats.metal('#2f5a46');
    F.add(mats.metal('#2f2b28'), xf(new THREE.CylinderGeometry(0.004, 0.004, ANNEX.plateBottom + 0.15 - ly - 0.05, 3), [lx, (ANNEX.plateBottom + 0.15 + ly + 0.05) / 2, lz]), { cast: false });
    F.add(enamel, xf(new THREE.ConeGeometry(0.17, 0.12, 16, 1, true), [lx, ly, lz]), { cast: false });
    F.add(vc, xf(doubleFace(new THREE.ConeGeometry(0.162, 0.114, 16, 1, true)), [lx, ly - 0.002, lz]), { color: '#f4ecd8', cast: false, receive: false });
    F.add(mats.glow('#fff1c4', 1.5, 4), xf(new THREE.SphereGeometry(0.045, 8, 6), [lx, ly - 0.05, lz]), { cast: false, receive: false });
    pushHalo(annexToWorld(lx, ly - 0.06, lz), 0.5);
  }
  return { z0 };
}
