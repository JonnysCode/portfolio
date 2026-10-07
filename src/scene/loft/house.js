// ─────────────────────────────────────────────────────────────────────────────
// The treehouse of the Code Loft: a small, crooked, timber-framed house on the
// deck with its back to the Great Oak.
//
//   • oak timber frame (sill, corner & jamb posts, plates, rails, foot and head
//     braces) with pegged joints, lime-plaster infill
//   • a steep, sagging roof of individual shakes, mossy, with a ridge log,
//     carved barge boards, a dormer with a glowing window, a leaning stovepipe
//   • the front gable with a round window; a big front window whose casements
//     stand open; an arched plank door (open) on the left side
//   • inside: a cabinetmaker's desk with two monitors and a laptop scrolling
//     code, a Windsor chair, a bookshelf, a desk lamp, a rug — and a rubber duck
//
// House-local frame: origin at the floor centre, +X = front (out of the tree),
// +Z = left side (towards the snail lift), Y up. The frame is slightly sheared
// so the whole house leans.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { DEG, TAU, WOOD, IRON, BRASS, TILE, addFlowerTuft, smallBitsRemap, paintBy, board, timber, beamBox, peg, xf, mat4, uvBox, deform, layShingles, ShingleField, shingleGeo, mossGeo, branch, ivyCard, tubeAlong, alongX, noiseA } from './kit.js';

// ── dimensions ──────────────────────────────────────────────────────────────
export const HOUSE = {
  x: -0.2, // deck-local position of the floor centre
  z: -2.35,
  yaw: -14 * DEG, // turn the front a little towards the Code Loft camera
  D2: 1.15, // half depth (X)
  W2: 1.3, // half width (Z)
  EAVE: 1.85, // top of the wall plates
  PITCH: 57 * DEG,
};
/** the big window's transom panes: the warm room light glowing through them (emissive by day / at night) */
export const LIT_GLASS = { color: '#ffb35a', day: 0, night: 1.35 };
const T = 0.12; // timber section
const SILL = 0.14;

export function buildHouse(ctx, B, mats, env, screens) {
  const { frame, rng, halos } = env;
  const { D2, W2, EAVE, PITCH } = HOUSE;
  const tanP = Math.tan(PITCH);
  const RIDGE = EAVE + 0.02 + (W2 + 0.06) * tanP;

  // frames: house (upright) and the leaning shell
  const house = frame.matrix.clone().multiply(mat4([HOUSE.x, 0, HOUSE.z], [0, HOUSE.yaw, 0]));
  const lean = house.clone().multiply(new THREE.Matrix4().makeShear(0, 0, 0.028, -0.018, 0, 0));
  const H = B.at(house);
  const L = B.at(lean);
  const toWorld = (x, y, z, m = lean) => new THREE.Vector3(x, y, z).applyMatrix4(m);

  const frameMat = mats.wood(WOOD.frame);
  const plaster = mats.plaster('#efe2c4');
  const ironMat = mats.metal(IRON);
  const warm = mats.warm();
  const warmB = mats.warmBright();

  // ── walls: definitions in wall-local (u along, v up, n out) ───────────────
  const walls = {
    front: { o: [D2, 0, 0], u: [0, 0, -1], len: 2 * W2 },
    back: { o: [-D2, 0, 0], u: [0, 0, 1], len: 2 * W2 },
    left: { o: [0, 0, W2], u: [1, 0, 0], len: 2 * D2 },
    right: { o: [0, 0, -W2], u: [-1, 0, 0], len: 2 * D2 },
  };
  for (const w of Object.values(walls)) {
    const U = new THREE.Vector3(...w.u);
    const N = new THREE.Vector3().crossVectors(U, new THREE.Vector3(0, 1, 0));
    w.m = new THREE.Matrix4().makeBasis(U, new THREE.Vector3(0, 1, 0), N).setPosition(...w.o);
    w.F = L.at(w.m);
    w.N = N;
  }
  // openings (wall-local u0..u1, v0..v1)
  walls.front.open = [{ u0: -0.62, u1: 0.68, v0: 0.42, v1: 1.5, kind: 'bigWindow' }];
  walls.left.open = [
    { u0: -0.02, u1: 0.74, v0: SILL, v1: 1.52, kind: 'door' },
    { u0: -0.86, u1: -0.4, v0: 0.78, v1: 1.28, kind: 'window' },
  ];
  walls.right.open = [{ u0: -0.28, u1: 0.3, v0: 0.74, v1: 1.3, kind: 'window' }];
  walls.back.open = [{ u0: -0.2, u1: 0.2, v0: 0.95, v1: 1.35, kind: 'window' }];
  // posts (u positions) besides the corners, and braces [[u0, v0, u1, v1]]
  walls.front.posts = [-0.68, 0.74];
  walls.front.braces = [[-W2 + 0.08, SILL, -0.68, 1.0], [W2 - 0.08, SILL, 0.74, 1.0]];
  walls.left.posts = [-0.08, 0.8];
  walls.left.braces = [[-D2 + 0.08, EAVE - T, -0.86 + 0.02, 1.4]];
  walls.right.posts = [-0.34, 0.36];
  walls.right.braces = [[-D2 + 0.08, SILL, -0.34, 0.95], [D2 - 0.08, SILL, 0.36, 0.95]];
  walls.back.posts = [-0.26, 0.26];
  walls.back.braces = [[-W2 + 0.08, SILL, -0.26, 1.1], [W2 - 0.08, SILL, 0.26, 1.1], [-W2 + 0.08, EAVE - T, -0.26, 1.2], [W2 - 0.08, EAVE - T, 0.26, 1.2]];

  const pegAt = (F, u, v) => F.add(frameMat, xf(peg(0.016, 0.03), [u + rng.jitter(0.01), v + rng.jitter(0.01), T / 2 + 0.005]), { color: '#4a3526', cast: false });

  for (const [name, w] of Object.entries(walls)) {
    const F = w.F;
    const half = w.len / 2;
    // sill & top plate (front/back run past the corners, the sides butt in)
    const ext = name === 'front' || name === 'back' ? 0.08 : -T / 2;
    F.add(frameMat, timber([-half - ext, SILL / 2, 0], [half + ext, SILL / 2, 0], SILL, SILL, { rng, wobble: 0.008 }));
    F.add(frameMat, timber([-half - ext, EAVE - T / 2, 0], [half + ext, EAVE - T / 2, 0], T, T, { rng, wobble: 0.01 }));
    // corner posts (front & back walls own them)
    if (name === 'front' || name === 'back') {
      for (const s of [-1, 1]) F.add(frameMat, timber([s * half, SILL, 0], [s * half, EAVE - T, 0], T * 1.1, T * 1.1, { rng, wobble: 0.012, up: [0, 0, 1] }));
    }
    for (const u of w.posts) {
      F.add(frameMat, timber([u, SILL, 0], [u, EAVE - T, 0], T, T, { rng, wobble: 0.01, up: [0, 0, 1] }));
      pegAt(F, u, SILL + 0.06);
      pegAt(F, u, EAVE - T - 0.06);
    }
    // rails above / below the openings
    for (const o of w.open) {
      if (o.kind !== 'door') F.add(frameMat, timber([o.u0 - 0.06, o.v0 - 0.05, 0], [o.u1 + 0.06, o.v0 - 0.05, 0], T, 0.1, { rng, wobble: 0.006 }));
      F.add(frameMat, timber([o.u0 - 0.06, o.v1 + 0.05, 0], [o.u1 + 0.06, o.v1 + 0.05, 0], T, 0.1, { rng, wobble: 0.006 }));
      // short studs beside windows that do not sit against a post
      for (const u of [o.u0 - 0.03, o.u1 + 0.03]) {
        if (w.posts.some((p) => Math.abs(p - u) < 0.12) || Math.abs(Math.abs(u) - half) < 0.12) continue;
        F.add(frameMat, timber([u, o.v0 - 0.1, 0], [u, o.v1 + 0.1, 0], 0.07, T, { rng, wobble: 0.004, up: [0, 0, 1] }));
      }
    }
    for (const [u0, v0, u1, v1] of w.braces) {
      F.add(frameMat, timber([u0, v0, 0], [u1, v1, 0], T * 0.9, T, { rng, wobble: 0.01, up: [0, 0, 1] }));
      pegAt(F, u1, v1);
    }
    // plaster infill: one slab with holes for the openings
    const s = new THREE.Shape();
    s.moveTo(-half, SILL);
    s.lineTo(half, SILL);
    s.lineTo(half, EAVE - T);
    s.lineTo(-half, EAVE - T);
    s.lineTo(-half, SILL);
    for (const o of w.open) {
      const h = new THREE.Path();
      if (o.kind === 'door') {
        const r = (o.u1 - o.u0) / 2;
        h.moveTo(o.u0, SILL);
        h.lineTo(o.u1, SILL);
        h.lineTo(o.u1, o.v1 - r);
        h.absarc((o.u0 + o.u1) / 2, o.v1 - r, r, 0, Math.PI, false);
        h.lineTo(o.u0, SILL);
      } else {
        h.moveTo(o.u0, o.v0);
        h.lineTo(o.u0, o.v1);
        h.lineTo(o.u1, o.v1);
        h.lineTo(o.u1, o.v0);
        h.lineTo(o.u0, o.v0);
      }
      s.holes.push(h);
    }
    const slab = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false, curveSegments: 10 });
    slab.translate(0, 0, -0.05);
    // gently bulging plaster: hand-trowelled, never flat
    deform(slab, (v) => {
      if (v.z > 0) v.z += 0.008 * noiseA(v.x * 3 + w.len, v.y * 3);
    });
    uvBox(slab, 'x', 1 / TILE.plaster, [rng.next() * 5, rng.next() * 5]);
    // weathering: rain splash and a green bloom of algae at the foot of the
    // walls, a little soot-grey under the plate — lime plaster never stays white
    const clean = new THREE.Color('#efe2c4'), grime = new THREE.Color('#b9b08a'), soot = new THREE.Color('#d6cbb0');
    const tc = new THREE.Color();
    paintBy(slab, (x, y) => {
      const foot = 1 - THREE.MathUtils.smoothstep(y, SILL, 0.75);
      const n = 0.5 + 0.5 * noiseA(x * 2.3 + w.len * 3, y * 1.7);
      tc.copy(clean).lerp(grime, foot * (0.55 + 0.45 * n));
      if (y > EAVE - 0.45) tc.lerp(soot, ((y - (EAVE - 0.45)) / 0.45) * 0.5);
      return tc;
    });
    F.add(plaster, slab);
  }

  // ── gables (front with a round window, back plain) ────────────────────────
  const gable = (w, round) => {
    const F = w.F;
    const half = W2 + 0.06;
    const base = EAVE;
    // tie beam (jettied a little at the front)
    F.add(frameMat, timber([-half - 0.1, base + 0.06, 0.04], [half + 0.1, base + 0.06, 0.04], T, T, { rng, wobble: 0.01 }));
    const top = RIDGE - 0.12;
    const s = new THREE.Shape();
    s.moveTo(-half + 0.02, base + 0.12);
    s.lineTo(half - 0.02, base + 0.12);
    s.lineTo(0, top);
    s.lineTo(-half + 0.02, base + 0.12);
    const oy = base + 0.12 + (top - base) * 0.36;
    const orad = 0.27;
    if (round) {
      const h = new THREE.Path();
      h.absarc(0, oy, orad, 0, TAU, true);
      s.holes.push(h);
    }
    const slab = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false, curveSegments: 18 });
    slab.translate(0, 0, -0.01);
    uvBox(slab, 'x', 1 / TILE.plaster, [rng.next() * 5, rng.next() * 5]);
    F.add(plaster, slab);
    // king post (split by the round window), struts
    if (round) {
      F.add(frameMat, timber([0, base + 0.12, 0.06], [0, oy - orad - 0.06, 0.06], T, T, { rng, up: [0, 0, 1] }));
      F.add(frameMat, timber([0, oy + orad + 0.06, 0.06], [0, top, 0.06], T, T, { rng, up: [0, 0, 1] }));
      // the round window: a thick turned frame, cross bars, glowing glass
      const ring = new THREE.TorusGeometry(orad + 0.035, 0.05, 6, 24);
      F.add(frameMat, xf(ring, [0, oy, 0.08]), { color: WOOD.walnut });
      F.add(warm, xf(new THREE.CircleGeometry(orad, 20), [0, oy, 0.03]), { cast: false });
      F.add(frameMat, xf(beamBox(orad * 2, 0.03, 0.035), [0, oy, 0.06]), { color: WOOD.walnut, cast: false });
      F.add(frameMat, xf(beamBox(0.03, orad * 2, 0.035), [0, oy, 0.06]), { color: WOOD.walnut, cast: false });
      halos.push(toWorld(...new THREE.Vector3(0, oy, 0.2).applyMatrix4(w.m).toArray()), 0.75);
    } else {
      F.add(frameMat, timber([0, base + 0.12, 0.04], [0, top, 0.04], T, T, { rng, up: [0, 0, 1] }));
    }
    for (const sx of [-1, 1]) {
      F.add(frameMat, timber([sx * 0.06, base + 0.12 + (round ? 0.1 : 0.45), 0.05], [sx * (half - 0.35), base + 0.14, 0.05], T * 0.85, T * 0.9, { rng, up: [0, 0, 1] }));
    }
  };
  gable(walls.front, true);
  gable(walls.back, false);

  // ── roof: boards under the shakes, shakes, ridge, barge boards ────────────
  const ovFront = 0.42, ovBack = 0.14, ovSide = 0.34;
  const x0 = -D2 - ovBack, x1 = D2 + ovFront;
  const roofLen = x1 - x0;
  const eaveZ = W2 + 0.06 + ovSide;
  const eaveY = EAVE + 0.02 - ovSide * tanP;
  const slopeLen = eaveZ / Math.cos(PITCH);
  /** the roof sags between the gables and droops at the corners */
  const sag = (x, y, z) => {
    const t = (x - x0) / roofLen;
    const k = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    return -0.075 * k * (0.6 + 0.4 * (1 - Math.abs(z) / eaveZ)) - 0.05 * (Math.abs(z) / eaveZ) * (1 - k);
  };
  const roofField = new ShingleField();
  const dormer = { x0: -0.62, x1: 0.02, zFront: 0.98 }; // on the left (+Z) slope
  const dormerV0 = (eaveZ - dormer.zFront - 0.05) / Math.cos(PITCH);
  const pipe = { x: -0.72, z: -0.62 }; // stovepipe through the right (−Z) slope, near the back
  for (const side of [1, -1]) {
    const along = new THREE.Vector3(side > 0 ? 1 : -1, 0, 0);
    const upDir = new THREE.Vector3(0, Math.sin(PITCH), -side * Math.cos(PITCH));
    const normal = new THREE.Vector3().crossVectors(along, upDir);
    const origin = new THREE.Vector3(side > 0 ? x0 : x1, eaveY, side * eaveZ);
    // roof boards (sheathing) under the shakes — seen from below at the eaves
    const sheet = board(roofLen, 0.04, slopeLen + 0.02, { along: 'x', rng, segs: 6 });
    const X = new THREE.Vector3(1, 0, 0);
    const mid = origin.clone().addScaledVector(along, roofLen / 2).addScaledVector(upDir, slopeLen / 2).addScaledVector(normal, -0.022);
    sheet.applyMatrix4(new THREE.Matrix4().makeBasis(X, normal, new THREE.Vector3().crossVectors(X, normal)).setPosition(mid));
    deform(sheet, (v) => {
      v.y += sag(v.x, v.y, v.z);
    });
    L.add(mats.wood(WOOD.walnut), sheet);
    layShingles(roofField, {
      origin,
      alongDir: along,
      upDir,
      normal,
      length: roofLen,
      height: slopeLen - 0.05,
      w: 0.2,
      exposure: 0.118,
      rng,
      skip: (u, v) => {
        const x = side > 0 ? x0 + u : x1 - u;
        if (side > 0 && x > dormer.x0 - 0.04 && x < dormer.x1 + 0.04 && v > dormerV0) return v < slopeLen - 0.5;
        if (side < 0) {
          const z = -(eaveZ - v * Math.cos(PITCH));
          if (Math.hypot(x - pipe.x, z - pipe.z) < 0.09) return true;
        }
        return false;
      },
      transform: (p) => {
        p.y += sag(p.x, p.y, p.z);
      },
      tint: (u, v, col, p) => {
        // moss creeps over the lower, shadier courses and in patches
        const n = noiseA(p.x * 1.6 + side * 7, p.z * 1.6 + p.y);
        const moss = Math.max(0, n * 1.1 + (1 - v / slopeLen) * 0.45 - 0.18 + (side < 0 ? 0.15 : 0));
        col.lerp(new THREE.Color('#7f9c40'), Math.min(0.85, moss * 1.2));
        // sun-bleached near the ridge
        if (v > slopeLen * 0.8) col.multiplyScalar(1.06);
      },
    });
  }
  const shingleMat = mats.shingles();
  // ridge log with moss on top
  {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const x = x0 - 0.06 + ((roofLen + 0.12) * i) / 8;
      pts.push(new THREE.Vector3(x, RIDGE + 0.06 + sag(x, 0, 0) + rng.jitter(0.01), rng.jitter(0.01)));
    }
    L.add(mats.bark(), branch(pts, 0.085, 0.075, { radial: 8, seed: 3 }));
    for (let i = 0; i < 7; i++) {
      const x = x0 + rng.range(0.1, roofLen - 0.1);
      L.add(mats.moss(), xf(mossGeo(rng, { r: rng.range(0.12, 0.22), h: 0.07, sx: 1.6, sz: 0.8 }), [x, RIDGE + 0.12 + sag(x, 0, 0), rng.jitter(0.03)]), { cast: false });
    }
  }
  // moss cushions scattered on the slopes (more on the shady right side)
  for (let i = 0; i < 34; i++) {
    const side = rng.next() < 0.55 ? -1 : 1;
    // mostly on the lower courses and along the eaves, a few higher up
    const v = i % 3 === 0 ? rng.range(0.6, slopeLen - 0.4) : rng.range(0.08, 1.0);
    const x = x0 + rng.range(0.15, roofLen - 0.15);
    if (side > 0 && x > dormer.x0 - 0.15 && x < dormer.x1 + 0.15 && v > dormerV0 - 0.2) continue;
    const z = side * (eaveZ - v * Math.cos(PITCH));
    const y = eaveY + v * Math.sin(PITCH) + sag(x, 0, z) + 0.03;
    const g = mossGeo(rng, { r: rng.range(0.12, 0.26), h: 0.07, sx: rng.range(1, 2.0), sz: 0.85 });
    g.applyMatrix4(new THREE.Matrix4().makeRotationX(side * (PITCH)));
    L.add(mats.moss(), xf(g, [x, y, z]), { cast: false });
  }
  // barge boards with a carved scalloped edge, finials
  for (const gx of [x1 + 0.02, x0 - 0.02]) {
    for (const side of [1, -1]) {
      const a = [gx, eaveY - 0.04 + sag(gx, 0, eaveZ), side * eaveZ];
      const b = [gx, RIDGE + 0.04 + sag(gx, 0, 0), 0];
      const g = timber(a, b, 0.045, 0.17, { rng, wobble: 0.005, up: [0, 1, 0] });
      L.add(mats.wood(WOOD.walnut), g);
      // scallops under the board
      const n = 6;
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const p = [a[0], a[1] + (b[1] - a[1]) * t - 0.1, a[2] + (b[2] - a[2]) * t];
        L.add(mats.wood(WOOD.walnut), xf(new THREE.SphereGeometry(0.035, 6, 4), p, null, [0.6, 1, 1]), { cast: false });
      }
    }
    // finial: a little carved spike with a ball
    const f = [gx + (gx > 0 ? 0.03 : -0.03), RIDGE + 0.12 + sag(gx, 0, 0), 0];
    L.add(mats.wood(WOOD.walnut), xf(new THREE.ConeGeometry(0.05, 0.28, 6), [f[0], f[1] + 0.14, f[2]]));
    L.add(mats.wood(WOOD.walnut), xf(new THREE.SphereGeometry(0.06, 8, 6), [f[0], f[1] + 0.02, f[2]]));
  }

  // ── dormer on the left slope ──────────────────────────────────────────────
  const dormerInfo = {};
  {
    const dx0 = dormer.x0, dx1 = dormer.x1, dz = dormer.zFront;
    const dcx = (dx0 + dx1) / 2, dw = dx1 - dx0;
    const roofYAt = (z) => EAVE + 0.02 + (W2 + 0.06 - z) * tanP + sag(dcx, 0, z);
    const sillY = roofYAt(dz) - 0.04;
    const topY = sillY + 0.52;
    const dPitch = 48 * DEG;
    const dRidge = topY + (dw / 2 + 0.06) * Math.tan(dPitch);
    const backZ = W2 + 0.06 - (dRidge - EAVE - 0.02) / tanP; // where the dormer ridge meets the main roof
    // front wall (plaster with a timber frame and a glowing window)
    const fw = new THREE.Shape();
    fw.moveTo(-dw / 2, 0);
    fw.lineTo(dw / 2, 0);
    fw.lineTo(dw / 2, topY - sillY);
    fw.lineTo(0, dRidge - sillY - 0.04);
    fw.lineTo(-dw / 2, topY - sillY);
    fw.lineTo(-dw / 2, 0);
    const win = new THREE.Path();
    win.moveTo(-0.15, 0.1);
    win.lineTo(0.15, 0.1);
    win.lineTo(0.15, 0.4);
    win.absarc(0, 0.4, 0.15, 0, Math.PI, false);
    win.lineTo(-0.15, 0.1);
    fw.holes.push(win);
    const fg = new THREE.ExtrudeGeometry(fw, { depth: 0.06, bevelEnabled: false, curveSegments: 8 });
    // shape XY → wall facing +Z at z = dz, x along the house X
    fg.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)).setPosition(dcx, sillY, dz - 0.06));
    uvBox(fg, 'x', 1 / TILE.plaster);
    L.add(plaster, fg);
    // window glass (glow) + frame + cross
    const glassS = new THREE.Shape();
    glassS.moveTo(-0.15, 0.1);
    glassS.lineTo(0.15, 0.1);
    glassS.lineTo(0.15, 0.4);
    glassS.absarc(0, 0.4, 0.15, 0, Math.PI, false);
    glassS.lineTo(-0.15, 0.1);
    L.add(warm, xf(new THREE.ShapeGeometry(glassS, 8), [dcx, sillY, dz - 0.03]), { cast: false });
    L.add(frameMat, xf(beamBox(0.025, 0.42, 0.03), [dcx, sillY + 0.33, dz + 0.0]), { color: WOOD.walnut, cast: false });
    L.add(frameMat, xf(beamBox(0.3, 0.025, 0.03), [dcx, sillY + 0.36, dz + 0.0]), { color: WOOD.walnut, cast: false });
    // corner posts + sill of the dormer
    for (const sx of [-1, 1]) L.add(frameMat, timber([dcx + sx * (dw / 2 - 0.03), sillY - 0.05, dz - 0.02], [dcx + sx * (dw / 2 - 0.03), topY, dz - 0.02], 0.07, 0.07, { rng, up: [0, 0, 1] }));
    L.add(frameMat, timber([dcx - dw / 2 - 0.04, sillY + 0.02, dz], [dcx + dw / 2 + 0.04, sillY + 0.02, dz], 0.08, 0.06, { rng }));
    L.add(frameMat, timber([dcx - dw / 2 - 0.04, topY, dz - 0.02], [dcx + dw / 2 + 0.04, topY, dz - 0.02], 0.07, 0.07, { rng }));
    // cheeks (triangular side walls)
    for (const sx of [-1, 1]) {
      const cs = new THREE.Shape();
      cs.moveTo(0, 0);
      cs.lineTo(dz - backZ, 0);
      cs.lineTo(dz - backZ, topY - sillY);
      cs.lineTo(0, topY - sillY);
      cs.lineTo(0, 0);
      const cg = new THREE.ExtrudeGeometry(cs, { depth: 0.05, bevelEnabled: false });
      cg.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)).setPosition(dcx + sx * (dw / 2) - (sx > 0 ? 0.05 : 0), sillY, dz));
      // trim the part below the main roof by squashing it into the roof
      deform(cg, (v) => {
        const ry = roofYAt(v.z) - 0.02;
        if (v.y < ry) v.y = ry;
      });
      uvBox(cg, 'z', 1 / TILE.plaster);
      L.add(plaster, cg);
    }
    // the dormer's own little shake roof
    for (const sx of [-1, 1]) {
      const along = new THREE.Vector3(0, 0, sx > 0 ? -1 : 1);
      const upD = new THREE.Vector3(-sx * Math.cos(dPitch), Math.sin(dPitch), 0);
      const nrm = new THREE.Vector3().crossVectors(along, upD);
      if (nrm.y < 0) nrm.negate();
      const eaveX = dcx + sx * (dw / 2 + 0.1);
      const ey = topY + 0.02 - 0.06 * Math.tan(dPitch);
      const len = dz + 0.12 - backZ;
      const org = new THREE.Vector3(eaveX, ey, sx > 0 ? dz + 0.12 : backZ);
      const sl = (dw / 2 + 0.1) / Math.cos(dPitch);
      const sheet = board(0.035, sl, len, { along: 'z', rng });
      sheet.applyMatrix4(new THREE.Matrix4().makeRotationZ(sx * (Math.PI / 2 - dPitch)));
      L.add(mats.wood(WOOD.walnut), xf(sheet, [dcx + sx * ((dw / 2 + 0.1) / 2), (ey + dRidge) / 2 - 0.02, (dz + 0.12 + backZ) / 2]));
      layShingles(roofField, {
        origin: org,
        alongDir: along,
        upDir: upD,
        normal: nrm,
        length: len,
        height: sl,
        w: 0.16,
        exposure: 0.1,
        rng,
      });
    }
    halos.push(toWorld(dcx, sillY + 0.3, dz + 0.15), 0.6);
    dormerInfo.window = toWorld(dcx, sillY + 0.3, dz + 0.05);
  }
  // build the shake field with the lean matrix baked into each instance
  {
    const lm = lean;
    for (const m of roofField.matrices) m.premultiply(lm);
    roofField.build(env.root, shingleMat, shingleGeo(0.2, 0.34, 0.024), 'loft-shingles');
  }

  // ── stovepipe through the right slope, leaning, with a hat ────────────────
  let chimneyTop;
  {
    const zr = pipe.z;
    const roofY = EAVE + 0.02 + (W2 + 0.06 - Math.abs(zr)) * tanP + sag(pipe.x, 0, zr);
    const p0 = new THREE.Vector3(pipe.x, roofY - 0.3, zr);
    const p1 = new THREE.Vector3(pipe.x + 0.02, roofY + 0.55, zr - 0.02);
    const p2 = new THREE.Vector3(pipe.x - 0.08, roofY + 1.05, zr - 0.12);
    const p3 = new THREE.Vector3(pipe.x - 0.14, roofY + 1.5, zr - 0.18);
    const rust = mats.metal('#4b3a30');
    for (const [a, b] of [[p0, p1], [p1, p2], [p2, p3]]) {
      const g = new THREE.CylinderGeometry(0.075, 0.075, a.distanceTo(b) + 0.02, 10, 1, true).rotateZ(Math.PI / 2);
      L.add(rust, alongX(g, a, b));
      L.add(rust, xf(new THREE.TorusGeometry(0.078, 0.014, 5, 12), [b.x, b.y, b.z], [Math.PI / 2, 0, 0]), { cast: false });
    }
    // flashing collar on the roof
    const col = new THREE.CylinderGeometry(0.16, 0.2, 0.05, 10);
    col.applyMatrix4(new THREE.Matrix4().makeRotationX(-PITCH));
    L.add(rust, xf(col, [pipe.x, roofY + 0.04, zr]), { cast: false });
    // the little hat on three legs
    const hat = new THREE.ConeGeometry(0.17, 0.12, 10, 1, true);
    L.add(rust, xf(hat, [p3.x, p3.y + 0.16, p3.z]));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      L.add(rust, xf(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 4), [p3.x + Math.cos(a) * 0.07, p3.y + 0.06, p3.z + Math.sin(a) * 0.07]), { cast: false });
    }
    chimneyTop = toWorld(p3.x, p3.y + 0.12, p3.z);
  }

  // ── openings: big front window (casements open), side windows, the door ───
  const glass = mats.paint('#9fb8b0');
  // the big window's fixed transom panes look straight into the lamp-lit room:
  // old glass by day, glowing warm at night (emissive follows the night, loft.js)
  const litGlass = ctx.materials.standard('#ffffff', { vertexColors: true, roughness: 0.72, emissive: LIT_GLASS.color }).clone();
  litGlass.name = 'loft-lit-glass';
  litGlass.emissiveIntensity = LIT_GLASS.day;
  // old glass: the sky's sheen at the top of each pane, the dark room below
  const gTop = new THREE.Color('#b4cdd0'), gLow = new THREE.Color('#566f74'), gc = new THREE.Color();
  const pane = (w, h) => paintBy(new THREE.PlaneGeometry(w, h, 1, 2), (x, y) => gc.copy(gLow).lerp(gTop, THREE.MathUtils.clamp(y / h + 0.5, 0, 1) ** 1.6));
  const sash = (F, w, h, color, panesX, panesY) => {
    // a sash frame with glazing bars; glass panes slightly tinted
    const parts = [];
    F.add(frameMat, xf(beamBox(w, 0.045, 0.04), [0, 0.0225, 0]), { color, cast: false });
    F.add(frameMat, xf(beamBox(w, 0.045, 0.04), [0, h - 0.0225, 0]), { color, cast: false });
    F.add(frameMat, xf(beamBox(0.045, h, 0.04), [-w / 2 + 0.0225, h / 2, 0]), { color, cast: false });
    F.add(frameMat, xf(beamBox(0.045, h, 0.04), [w / 2 - 0.0225, h / 2, 0]), { color, cast: false });
    for (let i = 1; i < panesX; i++) F.add(frameMat, xf(beamBox(0.018, h, 0.025), [-w / 2 + (w * i) / panesX, h / 2, 0]), { color, cast: false });
    for (let j = 1; j < panesY; j++) F.add(frameMat, xf(beamBox(w, 0.018, 0.025), [0, (h * j) / panesY, 0]), { color, cast: false });
    F.add(glass, xf(pane(w - 0.06, h - 0.06), [0, h / 2, 0]), { cast: false });
    F.add(glass, xf(pane(w - 0.06, h - 0.06).rotateY(Math.PI), [0, h / 2, -0.001]), { cast: false });
    return parts;
  };
  // big front window: casing, sill board with a flower box, two casements swung out
  const bigWin = walls.front.open[0];
  const frontInfo = {};
  {
    const F = walls.front.F;
    const { u0, u1, v0, v1 } = bigWin;
    const w = u1 - u0, h = v1 - v0;
    // casing
    F.add(frameMat, xf(beamBox(w + 0.14, 0.06, 0.12), [(u0 + u1) / 2, v1 + 0.03, 0.03]), { color: WOOD.walnut });
    F.add(frameMat, xf(beamBox(0.06, h, 0.1), [u0 - 0.03, (v0 + v1) / 2, 0.03]), { color: WOOD.walnut, cast: false });
    F.add(frameMat, xf(beamBox(0.06, h, 0.1), [u1 + 0.03, (v0 + v1) / 2, 0.03]), { color: WOOD.walnut, cast: false });
    // a thick sill board sticking out
    F.add(mats.wood(WOOD.oak), xf(board(w + 0.24, 0.05, 0.24, { along: 'x', rng }), [(u0 + u1) / 2, v0 - 0.02, 0.1]));
    // transom bar with three little upper panes (glazed, fixed)
    // (kept low: the 'This Woodland' camera looks in under it at the screens)
    const th = 0.24, tv = v1 - th;
    F.add(frameMat, xf(beamBox(w, 0.05, 0.06), [(u0 + u1) / 2, tv, 0.02]), { color: WOOD.walnut, cast: false });
    for (let i = 1; i < 3; i++) F.add(frameMat, xf(beamBox(0.025, th - 0.02, 0.04), [u0 + (w * i) / 3, tv + th / 2, 0.02]), { color: WOOD.walnut, cast: false });
    F.add(litGlass, xf(pane(w, th - 0.03), [(u0 + u1) / 2, tv + th / 2, 0.0]), { cast: false });
    // casements: hinged at the outer jambs, opened outwards ~70°
    const cw = w / 2, chh = tv - v0 - 0.03;
    for (const s of [-1, 1]) {
      const hingeU = s < 0 ? u0 : u1;
      const ang = s * (1.15 + rng.jitter(0.12));
      const m = mat4([hingeU, v0 + 0.01, 0.07], [0, -ang, 0]).multiply(mat4([-s * cw / 2, 0, 0]));
      sash(F.at(m), cw - 0.01, chh, '#4e6b62', 2, 3);
      // little iron hinges
      for (const hv of [v0 + 0.12, v0 + chh - 0.12]) F.add(ironMat, xf(new THREE.CylinderGeometry(0.014, 0.014, 0.06, 5), [hingeU, hv, 0.07]), { cast: false });
    }
    // flower box under the sill, overflowing
    const fb = board(w + 0.1, 0.16, 0.2, { along: 'x', rng });
    F.add(mats.wood('#6f5236'), xf(fb, [(u0 + u1) / 2, v0 - 0.15, 0.22]));
    F.add(mats.paint('#3d2b1e'), xf(new THREE.BoxGeometry(w + 0.04, 0.02, 0.15), [(u0 + u1) / 2, v0 - 0.075, 0.22]), { cast: false });
    // low leafy cushions over the soil, then tufts of flowers on stems
    for (let i = 0; i < 10; i++) {
      const u = u0 + 0.02 + rng.next() * (w - 0.04);
      const leaf = new THREE.SphereGeometry(rng.range(0.035, 0.055), 6, 4);
      F.add(mats.paint(), xf(leaf, [u, v0 - 0.07 + rng.range(0, 0.03), 0.22 + rng.jitter(0.05)], null, [1.2, 0.55, 1]), { color: rng.pick(['#4f7f36', '#5f9440', '#3f6f2e', '#6a9a48']), cast: false });
    }
    const tufts = 7;
    for (let i = 0; i < tufts; i++) {
      const u = u0 + 0.06 + ((i + 0.5) / tufts) * (w - 0.12) + rng.jitter(0.03);
      addFlowerTuft(F, mats, rng, u, v0 - 0.075, 0.22 + rng.jitter(0.03), { r: 0.08, h: rng.range(0.12, 0.2), blooms: rng.int(4, 7) });
    }
    // trailing ivy from the flower box
    for (let i = 0; i < 3; i++) {
      const u = i === 0 ? u0 + 0.06 : i === 1 ? u1 - 0.06 : u0 + 0.1 + rng.next() * (w - 0.2);
      const base = new THREE.Vector3(u, v0 - 0.06, 0.33).applyMatrix4(walls.front.m);
      const nrm = walls.front.N.clone();
      L.add(mats.ivy(), ivyCard(base, new THREE.Vector3(rng.jitter(0.2), -1, 0), nrm, rng.range(0.2, 0.36), rng.next() < 0.5), { cast: false });
    }
    frontInfo.windowCentre = toWorld(...new THREE.Vector3((u0 + u1) / 2, (v0 + v1) / 2, 0).applyMatrix4(walls.front.m).toArray());
  }
  // a slate chalkboard hung from a nail on the front wall, left of the big
  // window: the architecture of this very portfolio, a snail doodle, a TODO list
  if (env.boards) {
    const F = walls.front.F;
    const sw = 0.4, cu = -0.975, cv = 1.12, z = 0.085;
    const local = mat4([cu, cv, z], [0, 0, -0.035]);
    const sh = env.boards.addChalkboard(F.matrix.clone().multiply(local).multiply(mat4([0, 0, 0.012])), sw);
    const B2 = F.at(local);
    const fw = 0.03;
    for (const s of [-1, 1]) {
      B2.add(frameMat, xf(beamBox(sw + 2 * fw, fw, 0.03), [0, s * (sh / 2 + fw / 2), 0.004]), { color: WOOD.walnut, cast: false });
      B2.add(frameMat, xf(beamBox(fw, sh, 0.03), [s * (sw / 2 + fw / 2), 0, 0.004]), { color: WOOD.walnut, cast: false });
    }
    B2.add(mats.paint('#2c3633'), xf(new THREE.PlaneGeometry(sw, sh), [0, 0, 0.0]), { cast: false });
    // chalk tray with a stub of chalk and a felt sponge
    B2.add(frameMat, xf(beamBox(sw + 0.02, 0.018, 0.06), [0, -sh / 2 - fw - 0.006, 0.03]), { color: WOOD.walnut, cast: false });
    B2.add(mats.paint('#f2f0e8'), xf(new THREE.CylinderGeometry(0.007, 0.007, 0.05, 5).rotateZ(Math.PI / 2), [-0.08, -sh / 2 - fw + 0.008, 0.04]), { cast: false });
    B2.add(mats.paint('#7a5a3e'), xf(new THREE.BoxGeometry(0.07, 0.022, 0.035), [0.1, -sh / 2 - fw + 0.012, 0.035]), { cast: false });
    // the hanging string to a nail above
    const top = sh / 2 + fw;
    const nail = [0, top + 0.12, -0.03];
    B2.add(mats.rope(), tubeAlong([new THREE.Vector3(-sw * 0.35, top - 0.01, 0.0), new THREE.Vector3(nail[0], nail[1], nail[2] + 0.02), new THREE.Vector3(sw * 0.35, top - 0.01, 0.0)], 0.004, 3, 6), { cast: false });
    B2.add(ironMat, xf(new THREE.CylinderGeometry(0.008, 0.008, 0.04, 5).rotateX(Math.PI / 2), nail), { cast: false });
  }
  // smaller side windows: closed casements, warm glowing panes behind (night) — a frame with a cross
  const closedWindow = (w, o, glowing = true) => {
    const F = w.F;
    const { u0, u1, v0, v1 } = o;
    const ww = u1 - u0, hh = v1 - v0;
    F.add(frameMat, xf(beamBox(ww + 0.1, 0.05, 0.1), [(u0 + u1) / 2, v1 + 0.025, 0.03]), { color: WOOD.walnut, cast: false });
    F.add(mats.wood(WOOD.oak), xf(board(ww + 0.16, 0.04, 0.14, { along: 'x', rng }), [(u0 + u1) / 2, v0 - 0.02, 0.06]));
    F.add(frameMat, xf(beamBox(0.03, hh, 0.04), [(u0 + u1) / 2, (v0 + v1) / 2, 0.02]), { color: WOOD.walnut, cast: false });
    F.add(frameMat, xf(beamBox(ww, 0.03, 0.04), [(u0 + u1) / 2, (v0 + v1) / 2 + 0.05, 0.02]), { color: WOOD.walnut, cast: false });
    F.add(glowing ? warm : glass, xf(glowing ? new THREE.PlaneGeometry(ww, hh) : pane(ww, hh), [(u0 + u1) / 2, (v0 + v1) / 2, -0.01]), { cast: false });
    // shutters, folded open against the wall
    for (const s of [-1, 1]) {
      const su = s < 0 ? u0 - 0.06 - ww / 4 : u1 + 0.06 + ww / 4;
      const sh = board(ww / 2, hh + 0.04, 0.03, { along: 'y', rng });
      F.add(mats.wood(WOOD.shutter), xf(sh, [su, (v0 + v1) / 2, 0.08], [0, s * 0.12, 0]));
      F.add(mats.wood(WOOD.shutter), xf(board(ww / 2 - 0.04, 0.05, 0.02, { rng }), [su, v0 + 0.1, 0.1]), { cast: false });
      F.add(mats.wood(WOOD.shutter), xf(board(ww / 2 - 0.04, 0.05, 0.02, { rng }), [su, v1 - 0.1, 0.1]), { cast: false });
      // a heart cut-out (dark) in each shutter
      F.add(mats.paint('#2a1e16'), xf(new THREE.CircleGeometry(0.035, 10), [su, (v0 + v1) / 2 + 0.05, 0.097]), { cast: false });
    }
    if (glowing) halos.push(toWorld(...new THREE.Vector3((u0 + u1) / 2, (v0 + v1) / 2, 0.15).applyMatrix4(w.m).toArray()), 0.55);
  };
  closedWindow(walls.left, walls.left.open[1]);
  closedWindow(walls.right, walls.right.open[0]);
  closedWindow(walls.back, walls.back.open[0]);

  // the arched plank door on the left side, standing open
  const doorInfo = {};
  {
    const F = walls.left.F;
    const o = walls.left.open[0];
    const w = o.u1 - o.u0, r = w / 2;
    // arched frame of short timber segments
    const cu = (o.u0 + o.u1) / 2, cv = o.v1 - r;
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * Math.PI, a1 = ((k + 1) / 6) * Math.PI;
      F.add(frameMat, timber([cu + Math.cos(a0) * (r + 0.04), cv + Math.sin(a0) * (r + 0.04), 0.03], [cu + Math.cos(a1) * (r + 0.04), cv + Math.sin(a1) * (r + 0.04), 0.03], 0.1, 0.09, { rng, wobble: 0.003, up: [0, 0, 1] }), { color: WOOD.walnut });
    }
    for (const u of [o.u0 - 0.04, o.u1 + 0.04]) F.add(frameMat, timber([u, SILL, 0.03], [u, cv, 0.03], 0.09, 0.1, { rng, up: [0, 0, 1] }), { color: WOOD.walnut });
    // door leaf: vertical boards with an arched top, two ledges, strap hinges, a ring
    const leaf = new THREE.Group();
    const boards = 4;
    const LF = [];
    for (let i = 0; i < boards; i++) {
      const bw = w / boards;
      const bu = -w + bw * (i + 0.5); // hinge at u = 0 (leaf extends to −w when closed)
      const du = bu + w / 2;
      const top = cv + Math.sqrt(Math.max(0, r * r - du * du)) - SILL - 0.01;
      const g = board(bw - 0.008, top, 0.04, { along: 'y', rng });
      LF.push([g, [bu, SILL + top / 2, 0], rng.pick(['#7a5236', '#835a3b', '#6f4a30'])]);
    }
    const dm = mat4([o.u1, 0, 0.0], [0, 1.9, 0]); // hinge at the front jamb; opened outwards
    const D = F.at(dm);
    for (const [g, p, c] of LF) D.add(mats.wood(c), xf(g, p));
    for (const hv of [0.4, 1.12]) {
      D.add(mats.wood('#5b3d28'), xf(board(w * 0.86, 0.09, 0.03, { rng }), [-w / 2, hv, -0.035]), { cast: false });
      D.add(ironMat, xf(new THREE.BoxGeometry(w * 0.55, 0.035, 0.012), [-w * 0.27, hv, 0.026]), { cast: false });
    }
    D.add(ironMat, xf(new THREE.TorusGeometry(0.045, 0.01, 5, 12), [-w + 0.12, 0.85, 0.04]), { cast: false });
    void leaf;
    // threshold: a worn log step, a doormat
    F.add(mats.wood('#6b5038'), xf(board(w + 0.2, 0.07, 0.3, { rng }), [cu, 0.035, 0.18]));
    F.add(mats.fabric('#9a6a3a'), xf(new THREE.BoxGeometry(w * 0.8, 0.012, 0.3), [cu, 0.006, 0.5]), { cast: false });
    // a little lamp above the door
    doorInfo.lamp = toWorld(...new THREE.Vector3(cu, o.v1 + 0.2, 0.18).applyMatrix4(walls.left.m).toArray());
    doorInfo.centre = toWorld(...new THREE.Vector3(cu, 0.7, 0.2).applyMatrix4(walls.left.m).toArray());
    F.add(ironMat, xf(new THREE.BoxGeometry(0.02, 0.02, 0.2), [cu, o.v1 + 0.24, 0.1]), { cast: false });
    F.add(warmB, xf(new THREE.SphereGeometry(0.05, 8, 6), [cu, o.v1 + 0.14, 0.2], null, [1, 1.3, 1]), { cast: false });
    F.add(ironMat, xf(new THREE.ConeGeometry(0.08, 0.07, 8, 1, true), [cu, o.v1 + 0.2, 0.2]), { cast: false });
    halos.push(doorInfo.lamp, 0.55);
  }

  // ivy climbing the front-left corner post and along the plate
  {
    const ivy = mats.ivy();
    const n = new THREE.Vector3(1, 0, 1).normalize();
    for (let y = 0.05; y < EAVE + 0.2; y += rng.range(0.14, 0.2)) {
      const p = new THREE.Vector3(D2 + 0.07 + rng.jitter(0.03), y, W2 + 0.07 + rng.jitter(0.03));
      L.add(ivy, ivyCard(p, new THREE.Vector3(rng.jitter(0.6), 1, rng.jitter(0.6)), n, rng.range(0.2, 0.3), rng.next() < 0.5), { cast: false });
    }
    // and curtains of ivy dripping from the right eave
    for (let i = 0; i < 5; i++) {
      const x = x0 + rng.range(0.2, roofLen - 0.2);
      const p = new THREE.Vector3(x, eaveY + sag(x, 0, eaveZ) - 0.03, -eaveZ + 0.05);
      L.add(ivy, ivyCard(p, new THREE.Vector3(rng.jitter(0.2), -1, 0), new THREE.Vector3(0, 0, -1), rng.range(0.3, 0.6), rng.next() < 0.5), { cast: false });
    }
  }

  // ── fairy lights along the front barge boards & eaves ─────────────────────
  const lightPts = [];
  {
    const gx = x1 + 0.08;
    for (const side of [1, -1]) {
      const pts = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        const z = side * eaveZ * (1 - t);
        const y = eaveY - 0.12 + (RIDGE - eaveY) * t + sag(gx, 0, z);
        pts.push(toWorld(gx, y, z));
      }
      lightPts.push(side > 0 ? pts : pts.reverse());
    }
    // along the left eave
    const pts = [];
    for (let k = 0; k <= 5; k++) {
      const x = x1 - 0.05 - (roofLen - 0.1) * (k / 5);
      pts.push(toWorld(x, eaveY - 0.1 + sag(x, 0, eaveZ), eaveZ + 0.04));
    }
    lightPts.push(pts);
  }

  // ── interior ──────────────────────────────────────────────────────────────
  const interior = buildInterior(ctx, B, mats, env, { house, H, toWorldUp: (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(house), screens });

  // a rug and floorboards inside (the deck runs under the house anyway)
  H.add(mats.fabric('#8c3b2e'), xf(new THREE.CylinderGeometry(0.62, 0.62, 0.012, 24), [0.15, 0.006, -0.15], null, [1.15, 1, 0.9]), { cast: false });
  H.add(mats.fabric('#d8a24a'), xf(new THREE.TorusGeometry(0.5, 0.025, 4, 28).rotateX(Math.PI / 2), [0.15, 0.014, -0.15], null, [1.15, 1, 0.9]), { cast: false });
  H.add(mats.fabric('#3f5f6a'), xf(new THREE.TorusGeometry(0.34, 0.022, 4, 24).rotateX(Math.PI / 2), [0.15, 0.016, -0.15], null, [1.15, 1, 0.9]), { cast: false });

  return {
    matrix: house,
    lean,
    toWorld,
    ridge: { front: toWorld(x1 + 0.05, RIDGE + 0.12 + sag(x1, 0, 0), 0), back: toWorld(x0 + 0.25, RIDGE + 0.12 + sag(x0 + 0.25, 0, 0), 0), y: RIDGE },
    chimneyTop,
    lightPts,
    door: doorInfo,
    front: frontInfo,
    dormer: dormerInfo,
    interior,
    /** the transom's own material: loft.js sets its emissiveIntensity from the night (LIT_GLASS) */
    litGlass,
    /** footprint in deck-local coords (for keeping props off it) */
    footprint: { x: HOUSE.x, z: HOUSE.z, yaw: HOUSE.yaw, hx: D2 + 0.45, hz: W2 + 0.4 },
  };
}

// ─── the interior ────────────────────────────────────────────────────────────
function buildInterior(ctx, B, mats, env, { house, H, toWorldUp, screens }) {
  const { rng, halos } = env;
  const { D2, W2 } = HOUSE;
  const out = {};
  const deskTop = 0.5;
  const deskX = -D2 + 0.36; // centre of the desk (depth 0.52), against the back wall
  const deskZ0 = -1.12, deskZ1 = 0.42;

  // the hotspot pieces get their own small batches (so they can "boing")
  const screenGroup = new THREE.Group();
  screenGroup.name = 'loft-workstation';
  screenGroup.matrixAutoUpdate = false;
  screenGroup.matrix.copy(house);
  screenGroup.matrixWorldNeedsUpdate = true;

  // ── the desk: oak top with breadboard ends, drawer pedestal, trestle leg ──
  const oak = mats.wood('#b0895c');
  H.add(oak, xf(board(0.52, 0.05, deskZ1 - deskZ0, { along: 'z', rng }), [deskX, deskTop - 0.025, (deskZ0 + deskZ1) / 2]));
  for (const z of [deskZ0 - 0.03, deskZ1 + 0.03]) H.add(mats.wood('#9c774e'), xf(board(0.54, 0.055, 0.06, { along: 'x', rng }), [deskX, deskTop - 0.027, z]));
  // pedestal with three drawers (left end), trestle (right end)
  const pz = deskZ1 - 0.2;
  H.add(oak, xf(board(0.48, deskTop - 0.05, 0.36, { along: 'y', rng }), [deskX, (deskTop - 0.05) / 2, pz]));
  for (let i = 0; i < 3; i++) {
    const y = 0.07 + i * 0.14;
    H.add(mats.wood('#9a7048'), xf(board(0.02, 0.12, 0.32, { along: 'z', rng }), [deskX + 0.25, y + 0.06, pz]), { cast: false });
    H.add(mats.metal(BRASS), xf(new THREE.SphereGeometry(0.014, 6, 4), [deskX + 0.27, y + 0.06, pz]), { cast: false });
  }
  const tz = deskZ0 + 0.08;
  H.add(oak, xf(board(0.06, deskTop - 0.05, 0.06, { along: 'y', rng }), [deskX + 0.15, (deskTop - 0.05) / 2, tz]));
  H.add(oak, xf(board(0.06, deskTop - 0.05, 0.06, { along: 'y', rng }), [deskX - 0.15, (deskTop - 0.05) / 2, tz]));
  H.add(oak, xf(board(0.44, 0.06, 0.07, { along: 'x', rng }), [deskX, 0.04, tz]));
  H.add(oak, xf(board(0.05, 0.05, deskZ1 - deskZ0 - 0.5, { along: 'z', rng }), [deskX - 0.1, 0.18, (tz + pz) / 2]));

  // ── monitors (wooden frames!), the laptop, keyboard ───────────────────────
  const W = screens;
  const SB = new (B.constructor)(); // a small batch for the hotspot piece
  const S = SB.at(new THREE.Matrix4());
  const frameWood = mats.wood('#4a3628');
  const addMonitor = (cx, cz, yaw, w, h, y, opts) => {
    const m = mat4([cx, y, cz], [0, Math.PI / 2 + yaw, 0]); // screen faces +X (into the room)
    const F = S.at(m);
    F.add(frameWood, xf(board(w + 0.06, h + 0.06, 0.04, { along: 'x', rng }), [0, 0, -0.025]));
    F.add(mats.paint('#15171c'), xf(new THREE.PlaneGeometry(w + 0.01, h + 0.01), [0, 0, -0.004]), { cast: false });
    // stand: a little turned walnut column and foot
    const sb = deskTop - y, st = -h / 2 + 0.06;
    F.add(frameWood, xf(new THREE.CylinderGeometry(0.02, 0.026, st - sb, 8), [0, (sb + st) / 2, -0.06]));
    F.add(frameWood, xf(new THREE.CylinderGeometry(0.09, 0.1, 0.02, 12), [0, deskTop - y + 0.01, -0.06]));
    W.addScreen(new THREE.Matrix4().multiplyMatrices(house, m), w, h, opts);
    halos.push(toWorldUp(cx + 0.08, y, cz), Math.max(w, h) * 0.9, '#9fd6ff');
  };
  addMonitor(deskX - 0.05, -0.62, 0.12, 0.62, 0.38, deskTop + 0.38, { doc: 0, rows: 15, speed: 1.3, phase: 2 });
  addMonitor(deskX - 0.02, 0.06, -0.32, 0.4, 0.3, deskTop + 0.33, { doc: 1, rows: 13, speed: 0.75, phase: 11 });
  // the laptop, open, a little to the front
  const lapX = deskX + 0.12, lapZ = -0.2;
  {
    const m = mat4([lapX, deskTop, lapZ], [0, 0.18, 0]);
    const F = S.at(m);
    F.add(mats.metal('#9aa0a6'), xf(new THREE.BoxGeometry(0.24, 0.014, 0.32), [0, 0.007, 0]));
    F.add(mats.paint('#2b2e33'), xf(new THREE.PlaneGeometry(0.2, 0.13).rotateX(-Math.PI / 2), [0.01, 0.0145, 0.0]), { cast: false });
    const lid = mat4([-0.12, 0.014, 0], [0, 0, 0.3]); // hinge at the back, tilted back ~107°
    const LD = F.at(lid);
    LD.add(mats.metal('#9aa0a6'), xf(new THREE.BoxGeometry(0.012, 0.22, 0.32), [-0.006, 0.11, 0]));
    W.addScreen(new THREE.Matrix4().multiplyMatrices(house, m).multiply(lid).multiply(mat4([0.001, 0.115, 0], [0, Math.PI / 2, 0])), 0.27, 0.18, { doc: 2, rows: 10, speed: 1.9, phase: 5 });
  }
  // keyboard & mouse, a mug, notebook, pencil
  S.add(mats.wood('#3b2c22'), xf(new THREE.BoxGeometry(0.14, 0.018, 0.42), [deskX + 0.17, deskTop + 0.009, -0.62]), { cast: false });
  for (let i = 0; i < 4; i++) S.add(mats.paint('#d8cfbd'), xf(new THREE.BoxGeometry(0.025, 0.008, 0.38), [deskX + 0.12 + i * 0.03, deskTop + 0.02, -0.62]), { cast: false });
  S.add(mats.paint('#d8cfbd'), xf(new THREE.SphereGeometry(0.03, 8, 5), [deskX + 0.16, deskTop + 0.012, -0.28], null, [1.3, 0.5, 0.9]), { cast: false });
  S.add(mats.clay('#3f6f8f'), xf(new THREE.CylinderGeometry(0.035, 0.032, 0.08, 10), [deskX + 0.06, deskTop + 0.04, 0.3]));
  S.add(mats.clay('#3f6f8f'), xf(new THREE.TorusGeometry(0.022, 0.007, 4, 8), [deskX + 0.06, deskTop + 0.045, 0.34], [0, Math.PI / 2, 0]), { cast: false });
  S.add(mats.paper('#efe4c8'), xf(new THREE.BoxGeometry(0.15, 0.015, 0.2), [deskX + 0.12, deskTop + 0.008, 0.14], [0, 0.3, 0]), { cast: false });
  S.add(mats.paint('#e8b13a'), xf(new THREE.CylinderGeometry(0.005, 0.005, 0.16, 5).rotateX(Math.PI / 2), [deskX + 0.12, deskTop + 0.02, 0.14], [0, 0.6, 0]), { cast: false });
  // the desk lamp: an anglepoise in brass
  {
    const b = [deskX - 0.12, deskTop, -1.0];
    S.add(mats.metal(BRASS), xf(new THREE.CylinderGeometry(0.06, 0.07, 0.025, 12), [b[0], b[1] + 0.012, b[2]]));
    const j1 = [b[0] + 0.02, b[1] + 0.32, b[2] + 0.08];
    const j2 = [b[0] + 0.24, b[1] + 0.42, b[2] + 0.12];
    S.add(mats.metal(BRASS), alongX(new THREE.CylinderGeometry(0.01, 0.01, 0.34, 5).rotateZ(Math.PI / 2), [b[0], b[1] + 0.02, b[2]], j1), { cast: false });
    S.add(mats.metal(BRASS), alongX(new THREE.CylinderGeometry(0.01, 0.01, 0.25, 5).rotateZ(Math.PI / 2), j1, j2), { cast: false });
    const shade = new THREE.ConeGeometry(0.075, 0.12, 12, 1, true);
    S.add(mats.metal('#2f4f3f'), xf(shade, [j2[0] + 0.02, j2[1] - 0.04, j2[2]], [0, 0, 0.5]));
    // the shade's lit inside (an inside-out cone just within it), seen through the window
    const inner = new THREE.ConeGeometry(0.069, 0.11, 12, 1, true).scale(-1, 1, 1);
    S.add(mats.warmBright(), xf(inner, [j2[0] + 0.02, j2[1] - 0.042, j2[2]], [0, 0, 0.5]), { cast: false });
    S.add(mats.warmBright(), xf(new THREE.SphereGeometry(0.03, 8, 6), [j2[0] + 0.04, j2[1] - 0.09, j2[2]]), { cast: false });
    halos.push(toWorldUp(j2[0] + 0.04, j2[1] - 0.1, j2[2]), 0.5);
    out.lamp = toWorldUp(j2[0] + 0.05, j2[1] - 0.15, j2[2]);
  }
  SB.build(screenGroup, 'loft-workstation', { mergeShadow: true, remap: smallBitsRemap(mats) });
  // An invisible click proxy: the room behind the big front window, seen from
  // INSIDE (BackSide) — a ray through the window hits its far faces (back
  // wall, floor), so a click anywhere on the glowing window opens
  // 'this-portfolio', while the rubber duck in front of them still wins.
  // (material.visible = false → never drawn, still raycast)
  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(2 * D2 - 0.06, 1.6, 1.45).translate(0.01, 0.82, -0.03),
    ctx.materials.basic('#000000', { visible: false, side: THREE.BackSide }),
  );
  proxy.name = 'loft-workstation-proxy';
  screenGroup.add(proxy);
  // put the hotspot's origin at the monitors (the hover "boing" scales around it)
  const pivot = new THREE.Vector3(deskX + 0.05, deskTop + 0.32, -0.38);
  for (const m of screenGroup.children) m.geometry.translate(-pivot.x, -pivot.y, -pivot.z);
  // The camera frames the CENTRE of the hotspot's bounds when 'This Woodland'
  // opens (and its sparkle floats over it). The room-sized click proxy would
  // put that centre in the middle of the room, a metre in front of the desk:
  // declare the proxy's bounds symmetric around the glowing screens instead (a
  // superset of the real box, so raycasts are unaffected).
  {
    const g = proxy.geometry;
    g.computeBoundingBox();
    const c = new THREE.Vector3(deskX - 0.04, deskTop + 0.36, -0.3).sub(pivot);
    const half = new THREE.Vector3().subVectors(g.boundingBox.max, c).max(new THREE.Vector3().subVectors(c, g.boundingBox.min));
    g.boundingBox.set(c.clone().sub(half), c.clone().add(half));
  }
  screenGroup.matrix.multiply(new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z));
  screenGroup.matrix.decompose(screenGroup.position, screenGroup.quaternion, screenGroup.scale);
  screenGroup.matrixAutoUpdate = true; // so the hover "boing" (scale) works
  env.root.add(screenGroup);
  out.workstation = screenGroup;

  // ── the rubber duck (the secret): next to the laptop ──────────────────────
  {
    const duck = new THREE.Group();
    duck.name = 'loft-rubber-duck';
    const DB = new (B.constructor)();
    const yellow = mats.paint('#ffd23f');
    DB.add(yellow, xf(new THREE.SphereGeometry(0.05, 12, 8), [0, 0.04, 0], null, [1.25, 0.85, 1]));
    DB.add(yellow, xf(new THREE.SphereGeometry(0.033, 10, 8), [0.035, 0.095, 0]));
    DB.add(yellow, xf(new THREE.ConeGeometry(0.018, 0.05, 6), [-0.06, 0.06, 0], [0, 0, 1.2])); // tail
    DB.add(mats.paint('#ff8a1f'), xf(new THREE.SphereGeometry(0.016, 8, 5), [0.068, 0.09, 0], null, [1.6, 0.55, 1.1]));
    for (const s of [-1, 1]) DB.add(mats.paint('#1a1a1a'), xf(new THREE.SphereGeometry(0.006, 6, 4), [0.055, 0.108, s * 0.017]));
    DB.build(duck, 'duck', { mergeShadow: true, remap: smallBitsRemap(mats) });
    duck.position.set(deskX + 0.1, deskTop, 0.02);
    duck.rotation.y = 0.5;
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(house);
    holder.add(duck);
    env.root.add(holder);
    out.duck = duck;
  }

  // ── Windsor chair, pulled out ─────────────────────────────────────────────
  {
    const m = mat4([deskX + 0.6, 0, -1.02], [0, 2.6, 0]);
    const F = H.at(m);
    const seatY = 0.3;
    const c = '#8a6440';
    F.add(mats.wood(c), xf(new THREE.CylinderGeometry(0.17, 0.16, 0.035, 14), [0, seatY, 0], null, [1, 1, 0.9]));
    for (const [x, z] of [[-0.11, -0.1], [0.11, -0.1], [-0.11, 0.1], [0.11, 0.1]]) F.add(mats.wood(c), alongX(new THREE.CylinderGeometry(0.012, 0.015, seatY, 6).rotateZ(Math.PI / 2), [x * 1.25, 0, z * 1.25], [x, seatY, z]), { cast: false });
    // spindle back, bow on top
    const bow = [];
    for (let k = 0; k <= 8; k++) {
      const a = Math.PI * (0.15 + 0.7 * (k / 8));
      bow.push(new THREE.Vector3(Math.cos(a) * 0.16, seatY + 0.36 + Math.sin(a) * 0.04, -Math.sin(a) * 0.12 - 0.04));
    }
    F.add(mats.wood(c), tubeAlong(bow, 0.013, 5), { cast: false });
    for (let k = 1; k < 8; k += 1.2) {
      const p = bow[Math.round(k)];
      F.add(mats.wood(c), alongX(new THREE.CylinderGeometry(0.007, 0.007, 0.36, 4).rotateZ(Math.PI / 2), [p.x * 0.9, seatY, p.z * 0.85], [p.x, p.y, p.z]), { cast: false });
    }
    F.add(mats.fabric('#5a7a4a'), xf(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 12), [0, seatY + 0.03, 0.01]), { cast: false });
  }

  // ── bookshelf on the right wall, books, a plant, jars ─────────────────────
  {
    const m = mat4([0.12, 0, -W2 + 0.17], [0, 0, 0]);
    const F = H.at(m);
    const sw = 0.92, sh = 0.7, sd = 0.24;
    const wood = mats.wood('#9a6f45');
    for (const s of [-1, 1]) F.add(wood, xf(board(0.03, sh, sd, { along: 'y', rng }), [s * sw / 2, sh / 2, 0]));
    const shelves = [0.04, 0.36, 0.0, sh - 0.015];
    for (const y of [shelves[0], shelves[1], shelves[3]]) F.add(wood, xf(board(sw, 0.025, sd, { along: 'x', rng }), [0, y, 0]), { cast: false });
    const spine = ['#8c3b2e', '#3f5f6a', '#d8a24a', '#5a7a4a', '#6b4a7a', '#c9b79a', '#2f4858', '#a8583a', '#e0d6c0'];
    for (let si = 0; si < 2; si++) {
      let x = -sw / 2 + 0.03;
      const y0 = shelves[si] + 0.012;
      while (x < sw / 2 - 0.06) {
        const bw = rng.range(0.025, 0.05), bh = rng.range(0.18, 0.28);
        if (rng.next() < 0.1) {
          x += 0.08;
          continue;
        }
        const lean = x > sw / 2 - 0.2 && rng.next() < 0.4 ? -0.25 : 0;
        F.add(mats.paper(rng.pick(spine)), xf(new THREE.BoxGeometry(bw, bh, rng.range(0.14, 0.19)), [x + bw / 2, y0 + bh / 2, 0.01], [0, 0, lean]), { cast: false });
        x += bw + 0.004;
      }
    }
    // top shelf: a plant, jars, a tiny wooden robot figure
    F.add(mats.clay('#b5633e'), xf(new THREE.CylinderGeometry(0.06, 0.045, 0.1, 10), [-0.25, shelves[3] + 0.06, 0]));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      const g = ivyCard(new THREE.Vector3(-0.25 + Math.cos(a) * 0.03, shelves[3] + 0.1, Math.sin(a) * 0.03), new THREE.Vector3(Math.cos(a), rng.range(-1.2, 0.4), Math.sin(a)), new THREE.Vector3(Math.cos(a), 0.3, Math.sin(a)), rng.range(0.22, 0.38));
      F.add(mats.ivy(), g, { cast: false });
    }
    for (let i = 0; i < 3; i++) F.add(mats.paint(rng.pick(['#c9dfe0', '#e6d7b0', '#b8d4c0'])), xf(new THREE.CylinderGeometry(0.035, 0.035, 0.09, 8), [0.05 + i * 0.09, shelves[3] + 0.058, 0]), { cast: false });
  }

  // ── a pinboard with notes on the left wall, cables, a stool ───────────────
  {
    const m = mat4([-D2 + 0.08, 1.12, 0.56], [0, Math.PI / 2, 0]);
    const F = H.at(m);
    F.add(mats.wood('#c49a6c'), xf(new THREE.BoxGeometry(0.42, 0.34, 0.02), [0, 0, 0]), { cast: false });
    for (let i = 0; i < 6; i++) {
      F.add(mats.paper(rng.pick(['#fff3b0', '#f7efdf', '#cfe8ff', '#ffd6e0'])), xf(new THREE.PlaneGeometry(0.1, 0.1), [rng.range(-0.18, 0.18), rng.range(-0.12, 0.12), 0.012], [0, 0, rng.jitter(0.2)]), { cast: false });
    }
  }
  // cable bundle from the desk to the wall (towards the server log outside)
  {
    const pts = [
      new THREE.Vector3(deskX - 0.1, deskTop - 0.02, 0.3),
      new THREE.Vector3(deskX - 0.12, 0.04, 0.5),
      new THREE.Vector3(deskX + 0.2, 0.02, 0.9),
      new THREE.Vector3(deskX + 0.25, 0.06, W2 - 0.02),
    ];
    for (let k = 0; k < 3; k++) {
      const off = new THREE.Vector3(0, k * 0.012, k * 0.015);
      H.add(mats.paint(['#202020', '#3a4a6a', '#6a2a2a'][k]), tubeAlong(pts.map((p) => p.clone().add(off)), 0.008, 4), { cast: false });
    }
  }
  // the interior light (warm, from the lamp): one point light
  out.light = toWorldUp(0.1, 1.45, -0.2);
  // …which the light budget may not grant: a soft warm glow low over the rug
  // makes the room behind the open casements read lamp-lit at night either way
  // (depth-tested, so only seen through the openings; below the screens)
  halos.push(toWorldUp(0.2, 0.32, -0.15), 0.8, '#ffb066', { day: 0, night: 0.9 });
  out.screenCentre = toWorldUp(deskX + 0.05, deskTop + 0.38, -0.62);
  out.duckWorld = toWorldUp(deskX + 0.1, deskTop + 0.05, 0.02);
  return out;
}
