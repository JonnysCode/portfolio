// ─────────────────────────────────────────────────────────────────────────────
// The little things on the Great Oak that reward a closer look:
//   bracket fungi on the bark and limbs, fly agarics on the roots, hanging
//   lanterns that sway on the low limb, fairy lights draped over the trunk,
//   along the low limb and down the roots, a rope swing, a bird house with
//   its tenant, an owl blinking in its hollow (eyes glow at night) and — the
//   secret — a tiny mouse door in the front-right root.
// Static bits are merged per material (see Batch) to keep draw calls low.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DEG, TAU, CX, CZ, polar, trunkRadius } from './shape.js';
import { rootSurfacePoint } from './roots.js';
import { getHeight } from '../../world/ground.js';

const UP = new THREE.Vector3(0, 1, 0);

// ─── batching ────────────────────────────────────────────────────────────────
/** Normalise a geometry to indexed position/normal/uv (+ color when asked). */
function prep(geo, color = null) {
  if (!geo.index) {
    const n = geo.attributes.position.count;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
  if (color) {
    const c = new THREE.Color(color);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  } else if (geo.attributes.color) geo.deleteAttribute('color');
  geo.morphAttributes = {};
  geo.clearGroups();
  return geo;
}

/** Collects geometries per material and merges them into one mesh each. */
class Batch {
  constructor() {
    this.parts = new Map();
  }
  add(material, geo, { cast = false, color = null } = {}) {
    const key = material.uuid + (cast ? '|c' : '');
    if (!this.parts.has(key)) this.parts.set(key, { material, cast, list: [] });
    this.parts.get(key).list.push(prep(geo, color));
  }
  build(parent, name) {
    for (const { material, cast, list } of this.parts.values()) {
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!g) throw new Error(`oak details: merge failed (${material.name})`);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, material);
      m.name = `${name}:${material.name}`;
      m.castShadow = cast;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      parent.add(m);
    }
    this.parts.clear();
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
/** Bake position / euler rotation / scale into a geometry. */
function xf(geo, p, r = [0, 0, 0], s = 1) {
  _e.set(r[0], r[1], r[2], r[3] ?? 'XYZ');
  _q.setFromEuler(_e);
  if (typeof s === 'number') _s.setScalar(s);
  else _s.set(s[0], s[1], s[2]);
  _m.compose(new THREE.Vector3(p[0], p[1], p[2]), _q, _s);
  return geo.applyMatrix4(_m);
}

/** Lathe from [[r, y], …] listed from the rim (v = 0) to the apex (v = 1). */
function lathe(profile, seg = 16, phiStart = 0, phiLength = TAU) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), seg, phiStart, phiLength);
}

/** A frame whose +Z looks along `dir` (horizontal), origin at p. */
function facing(p, dir) {
  const m = new THREE.Matrix4();
  const z = new THREE.Vector3(dir.x, 0, dir.z).normalize();
  const x = new THREE.Vector3().crossVectors(UP, z).normalize();
  m.makeBasis(x, UP, z);
  m.setPosition(p);
  return m;
}

// ─── pieces ──────────────────────────────────────────────────────────────────
/** One bracket-fungus shelf in local space: flat side on z = 0, sticking out along +Z. */
function shelfGeos(r, rng) {
  const prof = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n; // rim → apex
    prof.push([r * Math.cos(t * Math.PI * 0.5) ** 0.8, r * 0.28 * Math.sin(t * Math.PI * 0.5) + r * 0.04]);
  }
  const top = lathe(prof, 14, -Math.PI / 2, Math.PI);
  // wavy, slightly drooping rim
  const pos = top.attributes.position;
  const ph = rng.range(0, 6);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
    const a = Math.atan2(x, z);
    const d = Math.hypot(x, z) / r;
    pos.setY(i, y + Math.sin(a * 5 + ph) * 0.05 * r * d - d * d * 0.06 * r);
  }
  top.scale(1, 1, 0.72);
  top.computeVertexNormals();
  const under = new THREE.CircleGeometry(r * 0.98, 14, 0, Math.PI);
  under.rotateX(Math.PI / 2);
  under.scale(1, 1, 0.72);
  under.translate(0, r * 0.02 - 0.06 * r, 0);
  return { top, under };
}

/** A fly agaric (stem + cap + spots) standing at the origin, height h. */
function toadstool(B, mats, h, capR, rng, m) {
  const stem = lathe(
    [
      [capR * 0.32, 0],
      [capR * 0.27, h * 0.25],
      [capR * 0.2, h * 0.75],
      [capR * 0.22, h * 0.92],
      [0, h * 0.95],
    ].reverse(),
    10
  );
  B.add(mats.stem, stem.applyMatrix4(m));
  // ring (annulus) under the cap
  B.add(mats.stem, xf(new THREE.CylinderGeometry(capR * 0.3, capR * 0.36, h * 0.06, 10, 1, true), [0, h * 0.72, 0]).applyMatrix4(m));
  const prof = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6; // rim → apex
    prof.push([capR * Math.cos(t * Math.PI * 0.5) ** 0.7, h * 0.88 + capR * 0.62 * Math.sin(t * Math.PI * 0.5) - (1 - t) * capR * 0.12]);
  }
  B.add(mats.cap, lathe(prof, 16).applyMatrix4(m), { cast: false });
  const gills = new THREE.CircleGeometry(capR * 0.97, 16);
  gills.rotateX(Math.PI / 2);
  gills.translate(0, h * 0.77, 0);
  B.add(mats.gills, gills.applyMatrix4(m));
  // white warts
  const nSpots = rng.int(6, 11);
  for (let i = 0; i < nSpots; i++) {
    const a = rng.range(0, TAU);
    const t = rng.range(0.15, 0.85);
    const rr = capR * Math.cos(t * Math.PI * 0.5) ** 0.7;
    const yy = h * 0.88 + capR * 0.62 * Math.sin(t * Math.PI * 0.5) - (1 - t) * capR * 0.12;
    const sp = new THREE.SphereGeometry(capR * rng.range(0.07, 0.12), 5, 3);
    sp.scale(1, 0.45, 1);
    B.add(mats.stem, xf(sp, [Math.sin(a) * rr, yy + 0.004, Math.cos(a) * rr], [rng.range(-0.3, 0.3), a, 0]).applyMatrix4(m));
  }
}

/** Little creatures are vertex-coloured blobs — they keep the cute stylised look. */
function blob(r, sx = 1, sy = 1, sz = 1, w = 12, h = 9) {
  const g = new THREE.SphereGeometry(r, w, h);
  g.scale(sx, sy, sz);
  return g;
}

// ─── build ───────────────────────────────────────────────────────────────────
/**
 * @param ctx      shared ctx
 * @param rng      seeded rng
 * @param parent   group to add into (world space)
 * @param skeleton { limbs: [{ id, curve, radiusAt }] }
 * @param roots    [{ id, curve, size }]
 * @param hollows  [{ id, a, y, floor, position, normal }]
 * @returns {{ update(dt, t) }}
 */
export function buildDetails(ctx, rng, parent, { limbs, roots, hollows }) {
  const { materials, props } = ctx;
  const reduced = !!ctx.engine?.reducedMotion;
  const B = new Batch();
  const updates = [];
  const limb = (id) => limbs.find((l) => l.id === id);
  const root = (id) => roots.find((r) => r.id === id);

  const mats = {
    fungusTop: materials.surface('mushroomCap', { color: '#b98242' }),
    fungusUnder: materials.surface('mushroomStem'),
    cap: materials.surface('mushroomCap', { color: '#c4362a' }),
    stem: materials.surface('mushroomStem'),
    gills: materials.surface('gills'),
    wood: materials.surface('wood', { species: 'oak' }),
    spruce: materials.surface('wood', { species: 'spruce' }),
    shingles: materials.surface('shingles'),
    rope: materials.surface('rope'),
    iron: materials.surface('metal', { color: '#3b3431' }),
    stone: materials.surface('stone'),
    dark: materials.standard('#140d09', { roughness: 1 }),
    critter: materials.standard('#ffffff', { vertexColors: true, roughness: 0.78 }),
    eyeGlow: materials.glow('#ffb43c', { day: 0.25, night: 2.6 }),
    warmGlow: materials.glow('#ffc46b', { day: 0.5, night: 2.4 }),
  };

  // ── bracket fungi on the bark ─────────────────────────────────────────────
  const FUNGI = [
    [-76, 4.4, 4],
    [-20, 11.7, 5],
    [-104, 9.2, 3],
    [205, 3.2, 4],
    [241, 10.6, 4],
    [178, 7.6, 3],
    [-58, 15.2, 3],
  ];
  for (const [deg, y, n] of FUNGI) {
    const a = deg * DEG;
    for (let i = 0; i < n; i++) {
      const yy = y + i * 0.17 + rng.range(-0.04, 0.04);
      const aa = a + rng.range(-0.09, 0.09) + (i % 2 ? 0.05 : -0.05);
      const r = rng.range(0.18, 0.32) * (1 - i * 0.12);
      const p = polar(aa, trunkRadius(aa, yy) - 0.07, yy);
      const m = facing(p, new THREE.Vector3(Math.sin(aa), 0, Math.cos(aa)));
      m.multiply(new THREE.Matrix4().makeRotationX(rng.range(-0.08, 0.12)));
      const { top, under } = shelfGeos(r, rng);
      B.add(mats.fungusTop, top.applyMatrix4(m));
      B.add(mats.fungusUnder, under.applyMatrix4(m));
    }
  }
  // …and on two limbs, near the fork
  for (const [id, u, n] of [
    ['back-left', 0.22, 4],
    ['right', 0.3, 3],
  ]) {
    const L = limb(id);
    if (!L) continue;
    const P = L.curve.getPointAt(u);
    const T = L.curve.getTangentAt(u);
    const side = new THREE.Vector3().crossVectors(T, UP).normalize();
    for (let i = 0; i < n; i++) {
      const uu = u + i * 0.012;
      const Q = L.curve.getPointAt(uu).addScaledVector(side, L.radiusAt(uu) - 0.06);
      Q.y -= 0.1 + i * 0.05;
      const m = facing(Q, side);
      const { top, under } = shelfGeos(rng.range(0.2, 0.3), rng);
      B.add(mats.fungusTop, top.applyMatrix4(m));
      B.add(mats.fungusUnder, under.applyMatrix4(m));
      void P;
    }
  }

  // ── fly agarics growing on the roots ──────────────────────────────────────
  const SHROOMS = [
    ['front-right', 0.66, 0.5, 3],
    ['right-long', 0.52, -0.6, 2],
    ['right-long', 0.82, 0.3, 2],
    ['left-back', 0.58, -0.5, 3],
    ['left', 0.62, 0.4, 2],
    ['back', 0.5, 0.6, 3],
    ['back-left', 0.72, -0.4, 2],
  ];
  for (const [id, u, phi, n] of SHROOMS) {
    const R = root(id);
    if (!R) continue;
    for (let i = 0; i < n; i++) {
      const s = rootSurfacePoint(R, Math.min(0.95, u + i * 0.03), phi + rng.range(-0.25, 0.25), -0.03);
      const h = rng.range(0.16, 0.34) * (i === 0 ? 1.25 : 1);
      const tilt = new THREE.Quaternion().setFromUnitVectors(UP, s.normal.clone().lerp(UP, 0.65).normalize());
      const m = new THREE.Matrix4().compose(s.position, tilt, new THREE.Vector3(1, 1, 1));
      toadstool(B, mats, h, h * rng.range(0.45, 0.6), rng, m);
    }
  }

  // ── hanging lanterns (sway gently) ────────────────────────────────────────
  const lanterns = [];
  const LANTERNS = [
    ['front-left-low', 0.3, 1.5, true],
    ['front-left-low', 0.62, 2.2, true],
    ['front', 0.45, 1.8, false],
  ];
  for (const [id, u, len, light] of LANTERNS) {
    const L = limb(id);
    if (!L) continue;
    const P = L.curve.getPointAt(u);
    P.y -= L.radiusAt(u) * 0.92;
    const pivot = new THREE.Group();
    pivot.position.copy(P);
    const chain = new THREE.Mesh(xf(new THREE.CylinderGeometry(0.014, 0.014, len, 5), [0, -len / 2, 0]), mats.iron);
    // a small iron hook clamped around the limb
    const hook = new THREE.Mesh(xf(new THREE.TorusGeometry(0.06, 0.012, 5, 10), [0, 0.02, 0], [0, 0, 0]), mats.iron);
    const lantern = props.makeLantern({ hanging: true, color: '#ffc46b', haloSize: 1.0 });
    lantern.position.y = -len;
    lantern.scale.setScalar(1.9);
    pivot.add(chain, hook, lantern);
    parent.add(pivot);
    lanterns.push({ pivot, ph: rng.range(0, TAU), sp: rng.range(0.7, 1.1) });
    if (light) {
      const lp = P.clone();
      lp.y -= len + 0.6;
      ctx.lights?.addPoint?.(lp, { color: '#ffb35c', day: 0.0, night: 4.5, distance: 9 });
    }
  }
  if (!reduced) {
    updates.push((dt, t) => {
      for (const l of lanterns) {
        l.pivot.rotation.x = Math.sin(t * 0.9 * l.sp + l.ph) * 0.045;
        l.pivot.rotation.z = Math.sin(t * 0.7 * l.sp + l.ph * 1.7) * 0.035;
      }
    });
  }

  // ── fairy lights ──────────────────────────────────────────────────────────
  const strands = [];
  const bark = (deg, y, lift = 0.14) => {
    const a = deg * DEG;
    return polar(a, trunkRadius(a, y) + lift, y);
  };
  // a festoon over the door, nailed to the bark every ~20°
  {
    const pts = [];
    for (let d = -78, i = 0; d <= 42; d += 20, i++) pts.push(bark(d, 4.65 + (i % 2) * 0.25 + Math.sin(d * 0.1) * 0.1));
    strands.push(props.makeStringLights(pts, { sag: 0.1, spacing: 0.3 }));
  }
  // a second, lower loop at the back-left, between the roots
  {
    const pts = [];
    for (let d = 196, i = 0; d <= 268; d += 18, i++) pts.push(bark(d, 3.3 + (i % 2) * 0.35));
    strands.push(props.makeStringLights(pts, { sag: 0.12, spacing: 0.3 }));
  }
  // along the underside of the low limb, out towards the swing
  {
    const L = limb('front-left-low');
    if (L) {
      const pts = [];
      for (let u = 0.07; u <= 0.56; u += 0.07) {
        const P = L.curve.getPointAt(u);
        P.y -= L.radiusAt(u) + 0.04;
        pts.push(P);
      }
      strands.push(props.makeStringLights(pts, { sag: 0.16, spacing: 0.32 }));
    }
  }
  // down the front-right root (seen from the Schreinerei)
  {
    const R = root('front-right');
    if (R) {
      const pts = [bark(34, 2.9, 0.12)];
      for (const u of [0.26, 0.46, 0.66, 0.84]) pts.push(rootSurfacePoint(R, u, -0.2, 0.06).position);
      strands.push(props.makeStringLights(pts, { sag: 0.08, spacing: 0.28 }));
    }
  }
  // over the left roots
  {
    const R7 = root('left-back');
    const R8 = root('left');
    if (R7 && R8) {
      const pts = [bark(-104, 3.0, 0.12), rootSurfacePoint(R8, 0.42, 0, 0.06).position, rootSurfacePoint(R8, 0.66, 0, 0.06).position];
      strands.push(props.makeStringLights(pts, { sag: 0.1, spacing: 0.3 }));
      const pts2 = [bark(-122, 2.6, 0.12), rootSurfacePoint(R7, 0.36, 0, 0.06).position, rootSurfacePoint(R7, 0.58, 0, 0.06).position];
      strands.push(props.makeStringLights(pts2, { sag: 0.1, spacing: 0.3 }));
    }
  }
  const lightsGroup = new THREE.Group();
  lightsGroup.name = 'oak-fairy-lights';
  for (const s of strands) lightsGroup.add(s);
  parent.add(mergeByMaterial(lightsGroup));

  // ── rope swing on the low limb ────────────────────────────────────────────
  {
    const L = limb('front-left-low');
    if (L) {
      // the spot on the limb above the clearing between the annex and the cottage path
      let best = 0.5, bd = Infinity;
      for (let u = 0.3; u < 0.85; u += 0.005) {
        const P = L.curve.getPointAt(u);
        const d = Math.hypot(P.x + 8, P.z - 3.2);
        if (d < bd) {
          bd = d;
          best = u;
        }
      }
      const P = L.curve.getPointAt(best);
      const T = L.curve.getTangentAt(best);
      const along = new THREE.Vector3(T.x, 0, T.z).normalize();
      const r = L.radiusAt(best);
      const top = P.clone();
      top.y -= r * 0.9;
      const seatY = getHeight(P.x, P.z) + 0.72;
      const len = top.y - seatY;
      const pivot = new THREE.Group();
      pivot.position.copy(top);
      // local frame: x along the limb, y up
      const basis = new THREE.Matrix4().makeBasis(along, UP, new THREE.Vector3().crossVectors(along, UP).normalize());
      const local = new THREE.Group();
      local.quaternion.setFromRotationMatrix(basis);
      pivot.add(local);
      const SB = new Batch();
      for (const sx of [-0.46, 0.46]) {
        const rope = new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(sx, 0, 0), new THREE.Vector3(sx * 0.98, -len + 0.05, 0)), 24, 0.03, 6, false);
        SB.add(mats.rope, rope);
        // wraps around the limb
        SB.add(mats.rope, xf(new THREE.TorusGeometry(r * 0.95, 0.03, 5, 14), [sx, r * 0.9, 0], [0, Math.PI / 2, 0]));
        SB.add(mats.rope, xf(new THREE.TorusGeometry(r * 0.95, 0.03, 5, 14), [sx + 0.07, r * 0.9, 0], [0, Math.PI / 2, 0]));
        // knot under the seat
        SB.add(mats.rope, xf(new THREE.SphereGeometry(0.045, 6, 5), [sx * 0.98, -len - 0.02, 0]));
      }
      const seat = new THREE.BoxGeometry(1.12, 0.07, 0.34, 4, 1, 2);
      materials.boxUV?.(seat, 'wood', { grain: 'x' });
      SB.add(mats.wood, xf(seat, [0, -len, 0]), { cast: true });
      SB.build(local, 'oak-swing');
      parent.add(pivot);
      if (!reduced) {
        const axis = along.clone();
        updates.push((dt, t) => {
          const ang = Math.sin(t * 0.85) * 0.045 + Math.sin(t * 0.37 + 1.2) * 0.02;
          pivot.quaternion.setFromAxisAngle(axis, ang);
        });
      }
    }
  }

  // ── bird house (with a blue tit on its roof) ──────────────────────────────
  {
    const a = -27 * DEG, y = 7.2;
    const p = polar(a, trunkRadius(a, y) + 0.02, y);
    const m = facing(p, new THREE.Vector3(Math.sin(a), 0, Math.cos(a)));
    const W = 0.42, H = 0.48, D = 0.36;
    // mounting batten nailed to the bark
    const batten = new THREE.BoxGeometry(0.12, 1.05, 0.05);
    materials.boxUV?.(batten, 'wood', { grain: 'y' });
    B.add(mats.wood, xf(batten, [0, 0.05, 0.03]).applyMatrix4(m));
    const body = new THREE.BoxGeometry(W, H, D);
    materials.boxUV?.(body, 'wood', { grain: 'y' });
    B.add(mats.spruce, xf(body, [0, 0, 0.06 + D / 2]).applyMatrix4(m), { cast: true });
    // gable fronts
    const gable = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, 0.2)]);
    for (const z of [0.06 + 0.005, 0.06 + D - 0.005]) {
      const gg = new THREE.ShapeGeometry(gable);
      if (z < 0.1) gg.rotateY(Math.PI);
      B.add(mats.spruce, xf(gg, [0, H / 2, z]).applyMatrix4(m));
    }
    // roof: two shingled slabs with an overhang
    for (const s of [-1, 1]) {
      const slab = new THREE.BoxGeometry(0.34, 0.04, D + 0.16);
      materials.boxUV?.(slab, 'shingles', { grain: 'z' });
      B.add(mats.shingles, xf(slab, [s * 0.13, H / 2 + 0.11, 0.06 + D / 2], [0, 0, -s * 0.66]).applyMatrix4(m), { cast: true });
    }
    // entrance hole, perch
    const hole = new THREE.CircleGeometry(0.06, 14);
    B.add(mats.dark, xf(hole, [0, 0.06, 0.06 + D + 0.003]).applyMatrix4(m));
    B.add(mats.wood, xf(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6), [0, -0.07, 0.06 + D + 0.06], [Math.PI / 2, 0, 0]).applyMatrix4(m));
    // the tenant
    const bird = [];
    const bx = 0.06, by = H / 2 + 0.22, bz = 0.06 + D / 2 + 0.04;
    bird.push([blob(0.065, 1, 0.9, 1.15), [bx, by, bz], '#f2d24a']); // yellow belly
    bird.push([blob(0.062, 1.02, 0.85, 1.1), [bx, by + 0.012, bz - 0.012], '#5b8fb8']); // blue-green back
    bird.push([blob(0.045), [bx, by + 0.07, bz + 0.03], '#f4f1e8']); // white cheeks
    bird.push([blob(0.047, 1, 0.6, 1), [bx, by + 0.088, bz + 0.022], '#3d78c8']); // blue cap
    bird.push([blob(0.008), [bx + 0.022, by + 0.075, bz + 0.07], '#111111']);
    bird.push([blob(0.008), [bx - 0.022, by + 0.075, bz + 0.07], '#111111']);
    bird.push([new THREE.ConeGeometry(0.012, 0.03, 5).rotateX(Math.PI / 2), [bx, by + 0.06, bz + 0.085], '#2a2420']);
    bird.push([blob(0.03, 0.6, 0.25, 1.6), [bx, by - 0.01, bz - 0.09], '#3f6f96']); // tail
    for (const [g, pp, col] of bird) B.add(mats.critter, xf(g, pp).applyMatrix4(m), { color: col });
  }

  // ── the owl in its hollow ─────────────────────────────────────────────────
  const owlHollow = hollows.find((h) => h.id === 'owl');
  if (owlHollow) {
    const owl = new THREE.Group();
    owl.name = 'oak-owl';
    const m = facing(owlHollow.floor, owlHollow.normal);
    owl.applyMatrix4(m);
    const OB = new Batch();
    const S = 1.15;
    const part = (g, p, col) => OB.add(mats.critter, xf(g, p.map((v) => v * S), [0, 0, 0], S), { color: col });
    part(blob(0.2, 1, 1.22, 0.9), [0, 0.22, 0], '#8a6a4a'); // body
    part(blob(0.15, 0.95, 1.1, 0.55), [0, 0.18, 0.1], '#e6d6b4'); // belly
    part(blob(0.19, 1.08, 0.9, 0.92), [0, 0.43, 0.01], '#7d5f42'); // head
    for (const sx of [-1, 1]) {
      part(blob(0.085, 1, 1, 0.45), [sx * 0.072, 0.44, 0.13], '#efe3c8'); // facial disc
      part(new THREE.ConeGeometry(0.04, 0.12, 6), [sx * 0.12, 0.58, 0.0], '#6a4d34'); // ear tufts
      part(blob(0.12, 0.45, 1.05, 0.9), [sx * 0.17, 0.2, -0.01], '#6e5038'); // wings
      part(blob(0.03, 1.2, 0.5, 1.2), [sx * 0.06, 0.0, 0.09], '#d9a441'); // feet
    }
    part(new THREE.ConeGeometry(0.025, 0.07, 5).rotateX(Math.PI * 0.62), [0, 0.4, 0.2], '#c98a3a'); // beak
    OB.build(owl, 'oak-owl');
    // eyes (glow at night) — a group so they can blink
    const eyes = new THREE.Group();
    eyes.position.set(0, 0.455 * S, 0.165 * S);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(blob(0.042 * S, 1, 1, 0.6), mats.eyeGlow);
      eye.position.x = sx * 0.07 * S;
      const pupil = new THREE.Mesh(blob(0.022 * S, 1, 1, 0.5), mats.dark);
      pupil.position.set(sx * 0.07 * S, 0, 0.022 * S);
      eyes.add(eye, pupil);
    }
    owl.add(eyes);
    parent.add(owl);
    ctx.interactions?.add?.(owl, {
      kind: 'secret',
      area: 'woodworking',
      label: 'Someone in the hollow…',
      onActivate: () => ctx.ui?.speech?.('Hoo! Who goes there?', owl),
    });
    if (!reduced) {
      let next = 2.5;
      let blinkT = -1;
      updates.push((dt, t) => {
        if (t > next) {
          blinkT = t;
          next = t + 3 + ((t * 7.31) % 4);
        }
        const k = blinkT >= 0 ? (t - blinkT) / 0.18 : 1;
        eyes.scale.y = k < 1 ? Math.max(0.08, Math.abs(1 - 2 * k)) : 1;
        // the owl slowly turns its head… well, its whole self
        owl.rotation.y = Math.sin(t * 0.21) * 0.25;
      });
    }
  }

  // ── the secret: a tiny mouse door in the front-right root ─────────────────
  {
    const R = root('front-right');
    if (R) {
      // the first spot along the root's front flank that is well clear of the trunk's flare
      let flank = null;
      for (let u = 0.36; u < 0.8 && !flank; u += 0.02) {
        const f = rootSurfacePoint(R, u, Math.PI / 2 + 0.25, -0.05);
        const a = Math.atan2(f.position.x - CX, f.position.z - CZ);
        const rr = Math.hypot(f.position.x - CX, f.position.z - CZ);
        if (rr - trunkRadius(a, 0.25) > 0.35) flank = f;
      }
      flank ??= rootSurfacePoint(R, 0.6, Math.PI / 2 + 0.25, -0.05);
      const gy = getHeight(flank.position.x, flank.position.z);
      const p = new THREE.Vector3(flank.position.x, gy, flank.position.z);
      const out = new THREE.Vector3(flank.normal.x, 0, flank.normal.z).normalize();
      const door = new THREE.Group();
      door.name = 'oak-mouse-door';
      door.applyMatrix4(facing(p, out));
      const DB = new Batch();
      const dw = 0.24, dh = 0.34, ar = dw / 2;
      // stone arch: little stones around the opening
      const nSt = 9;
      for (let i = 0; i < nSt; i++) {
        const t = i / (nSt - 1);
        let x, y;
        if (t < 0.22) {
          x = -ar - 0.04;
          y = (t / 0.22) * (dh - ar);
        } else if (t > 0.78) {
          x = ar + 0.04;
          y = ((1 - t) / 0.22) * (dh - ar);
        } else {
          const ang = Math.PI * (1 - (t - 0.22) / 0.56);
          x = Math.cos(ang) * (ar + 0.04);
          y = dh - ar + Math.sin(ang) * (ar + 0.04);
        }
        const st = new THREE.DodecahedronGeometry(rng.range(0.035, 0.05), 0);
        DB.add(mats.stone, xf(st, [x, y + 0.03, 0.03], [rng.next(), rng.next(), rng.next()], [1, 1, 0.7]));
      }
      // dark doorway behind the leaf
      const opening = new THREE.Shape();
      opening.moveTo(-ar, 0);
      opening.lineTo(ar, 0);
      opening.lineTo(ar, dh - ar);
      opening.absarc(0, dh - ar, ar, 0, Math.PI, false);
      opening.lineTo(-ar, 0);
      DB.add(mats.dark, xf(new THREE.ShapeGeometry(opening, 8), [0, 0.01, 0.0]));
      // threshold stone + a tiny glowing window of warm light inside
      DB.add(mats.stone, xf(new THREE.BoxGeometry(dw + 0.12, 0.04, 0.12), [0, 0.0, 0.07]));
      DB.add(mats.warmGlow, xf(new THREE.CircleGeometry(0.035, 10), [0.0, dh * 0.62, 0.004]));
      DB.build(door, 'oak-mouse-door');
      // the door leaf (hinged on the left) — planks, iron strap, knob
      const leafPivot = new THREE.Group();
      leafPivot.position.set(-ar, 0.01, 0.02);
      const LB = new Batch();
      const leafShape = new THREE.Shape();
      leafShape.moveTo(0, 0);
      leafShape.lineTo(dw, 0);
      leafShape.lineTo(dw, dh - ar);
      leafShape.absarc(ar, dh - ar, ar, 0, Math.PI, false);
      leafShape.lineTo(0, 0);
      const leafGeo = new THREE.ExtrudeGeometry(leafShape, { depth: 0.025, bevelEnabled: false, curveSegments: 8 });
      materials.boxUV?.(leafGeo, 'wood', { grain: 'y' });
      LB.add(mats.wood, leafGeo);
      for (const yy of [0.07, dh - 0.12]) LB.add(mats.iron, xf(new THREE.BoxGeometry(dw * 0.8, 0.018, 0.008), [dw * 0.42, yy, 0.03]));
      LB.add(mats.iron, xf(new THREE.SphereGeometry(0.013, 6, 5), [dw - 0.045, dh * 0.42, 0.035]));
      LB.build(leafPivot, 'oak-mouse-door-leaf');
      door.add(leafPivot);
      // the resident (hidden until the door opens)
      const mouse = new THREE.Group();
      const MB = new Batch();
      MB.add(mats.critter, xf(blob(0.055, 1, 0.9, 1.1), [0, 0.06, 0]), { color: '#9c8a7a' });
      for (const sx of [-1, 1]) {
        MB.add(mats.critter, xf(blob(0.032, 1, 1, 0.35), [sx * 0.04, 0.115, -0.01]), { color: '#9c8a7a' });
        MB.add(mats.critter, xf(blob(0.022, 1, 1, 0.3), [sx * 0.04, 0.115, 0.0]), { color: '#e8a6a0' });
        MB.add(mats.critter, xf(blob(0.009), [sx * 0.022, 0.075, 0.05]), { color: '#111111' });
      }
      MB.add(mats.critter, xf(blob(0.012), [0, 0.055, 0.062]), { color: '#e58a90' });
      MB.build(mouse, 'oak-mouse');
      mouse.position.set(0.02, 0.0, -0.06);
      mouse.visible = false;
      door.add(mouse);
      parent.add(door);
      let openT = -10;
      ctx.interactions?.add?.(door, {
        kind: 'secret',
        area: 'woodworking',
        label: 'A tiny door…',
        onActivate: () => {
          openT = performance.now() / 1000;
          ctx.ui?.speech?.('Squeak! Mind the cheese.', door);
        },
      });
      updates.push(() => {
        const e = performance.now() / 1000 - openT;
        const open = e < 0 ? 0 : e < 0.4 ? e / 0.4 : e < 3.2 ? 1 : e < 3.7 ? 1 - (e - 3.2) / 0.5 : 0;
        const k = open * open * (3 - 2 * open);
        leafPivot.rotation.y = -k * 1.6;
        mouse.visible = k > 0.35;
        mouse.position.z = -0.06 + k * 0.07;
      });
    }
  }

  B.build(parent, 'oak-details');
  return {
    update(dt, t) {
      for (const u of updates) u(dt, t);
    },
  };
}

/**
 * Flatten a group of static meshes (world-space, identity parents) into one
 * mesh per material — used for the many fairy-light strands.
 */
function mergeByMaterial(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const key = o.material.uuid + '|' + Object.keys(g.attributes).sort().join(',') + '|' + (g.index ? 'i' : 'n');
    if (!buckets.has(key)) buckets.set(key, { material: o.material, list: [], src: o });
    buckets.get(key).list.push(g);
  });
  const out = new THREE.Group();
  out.name = group.name;
  for (const { material, list, src } of buckets.values()) {
    const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!g) continue;
    g.computeBoundingSphere();
    if (src.geometry.boundingBox && !g.attributes.normal) g.computeBoundingBox();
    const m = new THREE.Mesh(g, material);
    m.name = src.name;
    m.renderOrder = src.renderOrder;
    m.castShadow = false;
    m.receiveShadow = src.receiveShadow;
    m.raycast = src.raycast;
    m.frustumCulled = src.frustumCulled;
    out.add(m);
  }
  return out;
}
