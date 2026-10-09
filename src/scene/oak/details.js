// ─────────────────────────────────────────────────────────────────────────────
// The little things on the Great Oak that reward a closer look:
//   bracket fungi in overlapping tiers of zoned brown shelves sunk into the
//   bark and limbs (only their pore plates glow mint at night, fading towards
//   the bark), the boulder a root grips, fly agarics on the roots, glowing
//   glow-caps between the roots, glow-worms in the ivy and on silk threads
//   under the lower limbs, two little round windows (someone lives up there),
//   lanterns hanging on chains from the lower limbs, fairy lights draped over
//   the trunk (one garland spirals from the door up to the loft stairs),
//   sagging along the lower limbs and down the roots, a rope swing, a
//   bird house with its tenant, an owl blinking in its hollow (eyes glow at
//   night) and — the secret — a tiny mouse door in the front-right root
//   (its door swings open and the resident peeks out when clicked).
// Static bits are merged per material (see Batch) to keep draw calls low.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DEG, TAU, CX, CZ, polar, trunkRadius, inCertZone, crownBlocked, BOULDER } from './shape.js';
import { rootSurfacePoint, mouseDoorFrame, MOUSE_DOOR } from './roots.js';
import { getHeight } from '../../world/ground.js';
import { smoothstep } from '../../core/rng.js';

const UP = new THREE.Vector3(0, 1, 0);
/**
 * Detail level of the current build: 0 high, 1 medium, 2 low (set by
 * buildDetails from ctx.quality.tier) — segment counts of the little things.
 */
let LV = 0;
const byLv = (hi, med, low) => (LV === 0 ? hi : LV === 1 ? med : low);
/** Above this the trunk forks into the limbs (strand clearance only below). */
const TRUNK_LIFT_MAX_Y = 16;

// ─── batching ────────────────────────────────────────────────────────────────
/** Normalise a geometry to indexed position/normal/uv (+ color when asked). */
function prep(geo, color = null) {
  const keepColor = color === 'keep';
  if (keepColor) color = null;
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
  } else if (geo.attributes.color && !keepColor) geo.deleteAttribute('color');
  geo.morphAttributes = {};
  geo.clearGroups();
  return geo;
}

/**
 * Collects geometries per material and merges them into one mesh each.
 * `remap` (low tier): Map material → { material, color } folds small parts
 * into fewer materials (a vertex-coloured target gets `color` when the part
 * has none); `shadows: false` drops the cast flag so nothing splits on it.
 */
class Batch {
  constructor({ remap = null, shadows = true } = {}) {
    this.parts = new Map();
    this.remap = remap;
    this.shadows = shadows;
  }
  add(material, geo, { cast = false, color = null } = {}) {
    const r = this.remap?.get(material);
    if (r) {
      material = r.material;
      if (r.color && !color) color = r.color;
    }
    if (!this.shadows) cast = false;
    const g = prep(geo, color);
    const key = material.uuid + (cast ? '|c' : '') + (g.attributes.color ? '|vc' : '');
    if (!this.parts.has(key)) this.parts.set(key, { material, cast, list: [] });
    this.parts.get(key).list.push(g);
  }
  /** Bake every mesh of a (static) prop object into the batch, keeping its vertex colours. `remap(material)` may swap materials. */
  absorb(object, remap = null) {
    object.updateMatrixWorld(true);
    object.traverse((o) => {
      if (!o.isMesh || o.material?.isShaderMaterial) return;
      this.add(remap?.(o.material) ?? o.material, o.geometry.clone().applyMatrix4(o.matrixWorld), { color: 'keep' });
    });
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
/**
 * Zone palettes for the shelf tops (concentric growth zones, base → rim, sRGB).
 * 'glow': warm chestnut and ochre bands with a cream growing edge — their pores
 * glow mint at night; 'sulphur': a chicken-of-the-woods orange-yellow (no glow).
 */
const SHELF_ZONES = {
  glow: [
    [0.0, '#3a2213'],
    [0.2, '#5c361b'],
    [0.34, '#8a5629'],
    [0.46, '#5a3820'],
    [0.6, '#a86f36'],
    [0.72, '#7c4f2a'],
    [0.84, '#c79a5c'],
    [0.93, '#e3cfa3'],
    [1.0, '#f1e6c8'],
  ],
  sulphur: [
    [0.0, '#b4561c'],
    [0.3, '#d9762a'],
    [0.5, '#e8902e'],
    [0.7, '#f0a83a'],
    [0.86, '#f6c64e'],
    [1.0, '#fbe08a'],
  ],
};
const _zc = new THREE.Color();
function zoneColor(zones, t, out) {
  let i = 1;
  while (i < zones.length - 1 && zones[i][0] < t) i++;
  const [t0, c0] = zones[i - 1], [t1, c1] = zones[i];
  const k = THREE.MathUtils.clamp((t - t0) / Math.max(1e-4, t1 - t0), 0, 1);
  // banded, not smeared: hold each zone, blend only near its edge
  const kk = THREE.MathUtils.smoothstep(k, 0.35, 0.65);
  return out.set(c0).lerp(_zc.set(c1), kk);
}

/**
 * One bracket-fungus shelf in local space: its flat back on z = 0 (the bark),
 * sticking out along +Z with depth ≈ 0.74 r. The top is a sloping, zoned
 * half-dome — thick where it grows out of the bark, thin at the wavy, lobed
 * rim, which rolls over into a pale growing edge — and the underside a flat
 * pore/gill plate. The half-dome wraps past ±90° so its back is sunk into the
 * bark (no floating saucer). Returns:
 *   top   — with `color` (concentric zones),
 *   under — with `color` = a warm buff ramp: dark and unlit at the bark,
 *           full at the rim (the glow material multiplies its emissive by
 *           the ramp's red channel),
 *   depth — the shelf's depth out of the bark.
 */
function shelfGeos(r, rng, zonesKey = 'glow') {
  const zones = SHELF_ZONES[zonesKey] ?? SHELF_ZONES.glow;
  // (fewer segments on the lower quality tiers)
  const SEG = byLv(12, 9, 7), RINGS = byLv(9, 6, 4);
  const d = r * 0.74; // out of the bark
  const th = r * 0.44; // thickness at the bark
  const phMax = Math.PI / 2 + 0.34; // wrap into the bark at the sides
  const ph = rng.range(0, 6), lob = rng.int(2, 4), wav = rng.range(0.04, 0.08);
  // per-shelf variation: some darker chestnut, some lighter ochre
  const tone = rng.range(0.82, 1.08);
  const lipT = zonesKey === 'sulphur' ? 0.86 : rng.range(0.6, 0.76);
  const outline = (phi) => 1 + wav * Math.sin(lob * phi + ph) + 0.03 * Math.sin(7 * phi + ph * 2);
  const droop = (rho) => r * (0.06 * rho * rho);
  const yTop = (rho, phi) => th * Math.pow(1 - rho, 0.62) * (1 - 0.1 * rho) + r * 0.075 - droop(rho) + Math.sin(5 * phi + ph) * 0.025 * r * rho * rho;
  const yUnder = (rho, phi) => -droop(rho) + Math.sin(5 * phi + ph) * 0.025 * r * rho * rho - 0.01 * r * rho;
  const at = (rho, phi, y, out) => {
    const k = rho * outline(phi);
    return out.set(Math.sin(phi) * r * k, y, Math.cos(phi) * d * k);
  };
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  // top: rings 0…RINGS on the dome, then two lip rings rolling down to the underside
  const rowsT = RINGS + 3;
  const posT = new Float32Array(rowsT * (SEG + 1) * 3);
  const colT = new Float32Array(rowsT * (SEG + 1) * 3);
  const uvT = new Float32Array(rowsT * (SEG + 1) * 2);
  for (let i = 0; i < rowsT; i++) {
    for (let j = 0; j <= SEG; j++) {
      const phi = -phMax + (2 * phMax * j) / SEG;
      let rho, y;
      if (i <= RINGS) {
        rho = i / RINGS;
        y = yTop(rho, phi);
      } else if (i === RINGS + 1) {
        rho = 1.035;
        y = 0.5 * (yTop(1, phi) + yUnder(1, phi)) - 0.004 * r;
      } else {
        rho = 1.0;
        y = yUnder(1, phi);
      }
      at(rho, phi, y, v);
      const k = i * (SEG + 1) + j;
      posT.set([v.x, v.y, v.z], k * 3);
      const t = Math.min(rho, 1);
      // the pale growing edge is only a thin line on top: the lip that rolls
      // under (all a visitor below sees of the edge) is a warm ochre-brown, so
      // from the glen a shelf reads as a brown bracket, not a white saucer
      zoneColor(zones, i > RINGS ? lipT : t + Math.sin(phi * 3 + ph) * 0.025, c);
      const n = (0.94 + 0.12 * hash2(j * 1.7 + ph, i * 3.1)) * tone;
      colT.set([c.r * n, c.g * n, c.b * n], k * 3);
      uvT.set([j / SEG, Math.min(rho, 1)], k * 2);
    }
  }
  const idx = (rows) => {
    const out = [];
    for (let i = 0; i < rows - 1; i++)
      for (let j = 0; j < SEG; j++) {
        const a = i * (SEG + 1) + j, b = a + SEG + 1;
        out.push(a, b, a + 1, a + 1, b, b + 1);
      }
    return out;
  };
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.BufferAttribute(posT, 3));
  top.setAttribute('color', new THREE.BufferAttribute(colT, 3));
  top.setAttribute('uv', new THREE.BufferAttribute(uvT, 2));
  top.setIndex(idx(rowsT));
  top.computeVertexNormals();
  // underside: rings 0…RINGS from the bark to the rim (meets the lip's last ring)
  const rowsU = RINGS + 1;
  const posU = new Float32Array(rowsU * (SEG + 1) * 3);
  const colU = new Float32Array(rowsU * (SEG + 1) * 3);
  const uvU = new Float32Array(rowsU * (SEG + 1) * 2);
  for (let i = 0; i < rowsU; i++) {
    const rho = i / RINGS;
    // dark & unlit where it grows from the bark, full glow towards the rim;
    // a warm tan pore plate (r channel = 0.82 × the glow ramp, see fungusGlow)
    const g = 0.3 + 0.7 * THREE.MathUtils.smoothstep(rho, 0.2, 0.95);
    for (let j = 0; j <= SEG; j++) {
      const phi = -phMax + (2 * phMax * j) / SEG;
      at(rho, phi, yUnder(rho, phi), v);
      const k = i * (SEG + 1) + j;
      posU.set([v.x, v.y, v.z], k * 3);
      colU.set([g * 0.82, g * 0.66, g * 0.46], k * 3);
      uvU.set([0.5 + (0.5 * v.x) / (r * 1.12), 0.5 + (0.5 * v.z) / (r * 1.12)], k * 2);
    }
  }
  const under = new THREE.BufferGeometry();
  under.setAttribute('position', new THREE.BufferAttribute(posU, 3));
  under.setAttribute('color', new THREE.BufferAttribute(colU, 3));
  under.setAttribute('uv', new THREE.BufferAttribute(uvU, 2));
  const iu = idx(rowsU);
  for (let i = 0; i < iu.length; i += 3) [iu[i + 1], iu[i + 2]] = [iu[i + 2], iu[i + 1]]; // face down
  under.setIndex(iu);
  under.computeVertexNormals();
  return { top, under, depth: d };
}

/** Deterministic hash in [0, 1). */
function hash2(a, b) {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
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
    byLv(10, 8, 6)
  );
  B.add(mats.stem, stem.applyMatrix4(m));
  // ring (annulus) under the cap
  B.add(mats.stem, xf(new THREE.CylinderGeometry(capR * 0.3, capR * 0.36, h * 0.06, byLv(10, 8, 6), 1, true), [0, h * 0.72, 0]).applyMatrix4(m));
  const prof = [];
  const CR = byLv(6, 5, 4);
  for (let i = 0; i <= CR; i++) {
    const t = i / CR; // rim → apex
    prof.push([capR * Math.cos(t * Math.PI * 0.5) ** 0.7, h * 0.88 + capR * 0.62 * Math.sin(t * Math.PI * 0.5) - (1 - t) * capR * 0.12]);
  }
  B.add(mats.cap, lathe(prof, byLv(16, 12, 9)).applyMatrix4(m), { cast: false });
  const gills = new THREE.CircleGeometry(capR * 0.97, byLv(16, 12, 9));
  gills.rotateX(Math.PI / 2);
  gills.translate(0, h * 0.77, 0);
  B.add(mats.gills, gills.applyMatrix4(m));
  // white warts
  const nSpots = LV === 2 ? rng.int(3, 6) : rng.int(6, 11);
  for (let i = 0; i < nSpots; i++) {
    const a = rng.range(0, TAU);
    const t = rng.range(0.15, 0.85);
    const rr = capR * Math.cos(t * Math.PI * 0.5) ** 0.7;
    const yy = h * 0.88 + capR * 0.62 * Math.sin(t * Math.PI * 0.5) - (1 - t) * capR * 0.12;
    const sp = new THREE.SphereGeometry(capR * rng.range(0.07, 0.12), byLv(5, 5, 4), byLv(3, 3, 2));
    sp.scale(1, 0.45, 1);
    B.add(mats.stem, xf(sp, [Math.sin(a) * rr, yy + 0.004, Math.cos(a) * rr], [rng.range(-0.3, 0.3), a, 0]).applyMatrix4(m));
  }
}

/**
 * Fairy lights: a thin dark wire sagging between points with tiny amber bulbs
 * hanging under it (two warm tones alternating). Everything goes into the
 * shared batch; every other bulb adds a small soft halo to `halos`.
 */
function fairyLights(B, mats, halos, points, { sag = 0.1, spacing = 0.36, clear = 0, haloEvery = 2, haloSize = 0.17 } = {}) {
  let n = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = new THREE.Vector3().copy(points[i]);
    const b = new THREE.Vector3().copy(points[i + 1]);
    const span = a.distanceTo(b);
    const ctrl = a.clone().lerp(b, 0.5);
    ctrl.y -= span * sag * 2; // quadratic bezier: the middle sags by span × sag
    let curve = new THREE.QuadraticBezierCurve3(a, ctrl, b);
    if (clear > 0) {
      // strands draped over the trunk: the bark's cords and lobes must never
      // swallow the wire or a bulb between two nails — lift it over the bark
      const pts = curve.getSpacedPoints(Math.max(6, Math.ceil(span / 0.1)));
      for (const q of pts) {
        if (q.y > TRUNK_LIFT_MAX_Y) continue;
        const az = Math.atan2(q.x - CX, q.z - CZ);
        const need = trunkRadius(az, q.y) + clear;
        const rr = Math.hypot(q.x - CX, q.z - CZ);
        if (rr < need) polar(az, need, q.y, q);
      }
      curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    }
    B.add(mats.wire, new THREE.TubeGeometry(curve, Math.max(4, Math.ceil(span / byLv(0.12, 0.17, 0.26))), 0.009, 3, false));
    const k = Math.max(1, Math.floor(span / spacing));
    for (let j = 0; j < k; j++) {
      const p = curve.getPointAt((j + 0.5) / k);
      p.y -= 0.035;
      B.add(mats.wire, xf(new THREE.CylinderGeometry(0.011, 0.011, 0.025, byLv(5, 5, 4), 1, LV === 2), [p.x, p.y + 0.012, p.z]));
      const bulb = new THREE.SphereGeometry(0.024, byLv(6, 5, 4), byLv(5, 4, 3));
      bulb.scale(1, 1.3, 1);
      B.add(n % 2 ? mats.bulbB : mats.bulbA, bulb.translate(p.x, p.y - 0.02, p.z));
      if (n % haloEvery === 0) halos.push({ x: p.x, y: p.y - 0.02, z: p.z, size: haloSize });
      n++;
    }
  }
}

/** Little creatures are vertex-coloured blobs — they keep the cute stylised look. */
function blob(r, sx = 1, sy = 1, sz = 1, w = 12, h = 9) {
  const g = new THREE.SphereGeometry(r, Math.max(5, Math.round(w * byLv(1, 0.8, 0.62))), Math.max(4, Math.round(h * byLv(1, 0.8, 0.62))));
  g.scale(sx, sy, sz);
  return g;
}

/** Where along the 'right' limb the rope swing hangs (see buildDetails). */
const SWING_U = 0.76;

/**
 * A rope swing hanging from limb L at arc fraction u: two ropes looped twice
 * around the limb, knots under a plank seat; it sways gently (not with reduced motion).
 */
function buildSwing(ctx, mats, parent, L, u, updates, reduced) {
  const { materials } = ctx;
  const P = L.curve.getPointAt(u);
  const T = L.curve.getTangentAt(u);
  const along = new THREE.Vector3(T.x, 0, T.z).normalize();
  const r = L.radiusAt(u);
  const top = P.clone();
  top.y -= r * 0.9;
  const seatY = getHeight(P.x, P.z) + 0.9;
  const len = top.y - seatY;
  const pivot = new THREE.Group();
  pivot.name = 'oak-swing';
  pivot.position.copy(top);
  // local frame: x along the limb, y up
  const basis = new THREE.Matrix4().makeBasis(along, UP, new THREE.Vector3().crossVectors(along, UP).normalize());
  const local = new THREE.Group();
  local.quaternion.setFromRotationMatrix(basis);
  pivot.add(local);
  const SB = new Batch();
  const rng = ctx.rng('oak-swing');
  const HW = 0.58; // half the distance between the ropes
  for (const sx of [-HW, HW]) {
    const rope = new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(sx, 0, 0), new THREE.Vector3(sx * 0.98, -len + 0.05, 0)), Math.max(8, Math.ceil(len / 0.6)), 0.042, 6, false);
    SB.add(mats.rope, rope);
    // wraps around the limb
    SB.add(mats.rope, xf(new THREE.TorusGeometry(r * 0.95, 0.04, 5, 14), [sx, r * 0.9, 0], [0, Math.PI / 2, 0]));
    SB.add(mats.rope, xf(new THREE.TorusGeometry(r * 0.95, 0.04, 5, 14), [sx + 0.08, r * 0.9, 0], [0, Math.PI / 2, 0]));
    // knot under the seat
    SB.add(mats.rope, xf(new THREE.SphereGeometry(0.065, 6, 5), [sx * 0.98, -len - 0.03, 0]));
    // a garland of little flowers & leaves wound up the lower ropes (reads from the glen)
    for (let i = 0; i < (LV === 2 ? 0 : 16); i++) {
      const yy = -len + 0.12 + i * 0.1;
      const ang = i * 1.9 + (sx > 0 ? 1 : 0);
      const p = [sx * 0.98 + Math.cos(ang) * 0.05, yy, Math.sin(ang) * 0.05];
      if (i % 3 === 1) SB.add(mats.critter, xf(blob(0.05, 1, 0.55, 1, 6, 4), p, [0, ang, 0.5]), { color: rng.pick(['#4f7f36', '#5f9440']) });
      else SB.add(mats.critter, xf(blob(0.045, 1, 0.7, 1, 6, 4), p), { color: rng.pick(['#f08aa6', '#ffd166', '#f4f1ff', '#c77dff', '#ff9e5e']) });
    }
  }
  const seat = new THREE.BoxGeometry(HW * 2 + 0.24, 0.08, 0.4, 4, 1, 2);
  materials.boxUV?.(seat, 'wood', { grain: 'x' });
  SB.add(mats.wood, xf(seat, [0, -len, 0]), { cast: true });
  SB.build(local, 'oak-swing');
  parent.add(pivot);
  if (!reduced) {
    const axis = along.clone();
    const ph = u * 17;
    updates.push((dt, t) => {
      const ang = Math.sin(t * 0.62 + ph) * 0.03 + Math.sin(t * 0.27 + 1.2 + ph) * 0.015;
      pivot.quaternion.setFromAxisAngle(axis, ang);
    });
  }
  return pivot;
}

/**
 * Lanterns hanging on chains from the limbs: [limb id, u (arc fraction), chain
 * length, light] — light: true = asks for a point light, 'spare' = only if the
 * budget has room. More hang along the lower limbs than before so the crown's
 * underside carries warm points at night (each is checked against the spot
 * cameras and the loft, see lanternHangs).
 */
const LANTERNS = [
  ['front-left-low', 0.3, 1.5, true],
  ['front-left-low', 0.62, 2.2, true],
  ['front-left-low', 0.86, 1.4, false],
  ['front', 0.45, 1.8, 'spare'],
  ['front', 0.7, 1.3, false],
  ['left-high', 0.22, 1.7, false],
  ['back-left', 0.36, 1.6, false],
  ['right', 0.56, 1.4, false],
  ['front-right-high', 0.42, 1.5, false],
];
const LANTERN_SCALE = 1.45; // big enough to read from the glen, small enough to stay a warm point at night

/** Where the lanterns hang (world): [{ id, u, len, light, top (chain top), glass (lantern glass centre) }]. */
export function lanternHangs(limbs) {
  const out = [];
  for (const [id, u, len, light] of LANTERNS) {
    const L = limbs.find((l) => l.id === id);
    if (!L) continue;
    const top = L.curve.getPointAt(u);
    top.y -= L.radiusAt(u) * 0.92;
    const glass = new THREE.Vector3(top.x, top.y - len - (0.5 - 0.17) * LANTERN_SCALE, top.z);
    // never into a spot camera's view or the loft (lantern body ≈ 0.45 around the glass)
    if (crownBlocked(glass, 0.5) || crownBlocked(new THREE.Vector3(top.x, top.y - len * 0.5, top.z), 0.15)) continue;
    out.push({ id, u, len, light, top, glass });
  }
  return out;
}

/** World frame of the BOULDER (shape.js): centre, radial & across axes, matrix (local x = radial, z = across). */
function boulderFrame() {
  const a = BOULDER.a * DEG;
  const c = polar(a, BOULDER.rho, 0);
  c.y = getHeight(c.x, c.z) + BOULDER.lift;
  const radial = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
  const across = new THREE.Vector3().crossVectors(radial, UP).normalize();
  const matrix = new THREE.Matrix4().makeBasis(radial, UP, across).setPosition(c);
  return { centre: c, radial, across, matrix };
}

// ─── build ───────────────────────────────────────────────────────────────────
/**
 * @param ctx      shared ctx
 * @param rng      seeded rng
 * @param parent   group to add into (world space)
 * @param skeleton { limbs: [{ id, curve, radiusAt }] }
 * @param roots    [{ id, curve, size }]
 * @param hollows  [{ id, a, y, floor, position, normal }]
 * @param hollowLinings  dark lining geometries for the hollows (merged here)
 * @param ivyLeaves      the ivy leaf-card geometry (glow-worms are sprinkled among its leaves)
 * @returns {{ update(dt, t) }}
 */
export function buildDetails(ctx, rng, parent, { limbs, roots, hollows, hollowLinings, ivyLeaves = null }) {
  const { materials, props } = ctx;
  const reduced = !!ctx.engine?.reducedMotion;
  const density = ctx.quality?.density ?? 1;
  LV = { high: 0, medium: 1, low: 2 }[ctx.quality?.tier] ?? (density >= 0.9 ? 0 : density >= 0.45 ? 1 : 2);
  const lowDetail = LV > 0;
  // low tier: small parts fold into fewer materials (filled in below, once
  // the materials exist) and nothing splits on the cast flag (no shadows)
  const remap = LV === 2 ? new Map() : null;
  const B = new Batch({ remap, shadows: ctx.quality?.shadows !== false });
  const updates = [];
  /** Every warm glow halo (lanterns, windows, the mouse lantern) → one draw call. */
  const warmHalos = [];
  const lanternSpots = [];
  const limb = (id) => limbs.find((l) => l.id === id);
  const root = (id) => roots.find((r) => r.id === id);

  const mats = {
    // shelf tops: the vertex colours paint the concentric growth zones
    fungusTop: materials.surface('mushroomStem', { vertexColors: true }),
    cap: materials.surface('mushroomCap', { color: '#c4362a' }),
    stem: materials.surface('mushroomStem'),
    gills: materials.surface('gills'),
    wood: materials.surface('wood', { species: 'oak' }),
    spruce: materials.surface('wood', { species: 'spruce' }),
    shingles: materials.surface('shingles'),
    rope: materials.surface('rope'),
    iron: materials.surface('metal', { color: '#3b3431' }),
    stone: materials.surface('stone'),
    boulder: materials.surface('rock', { mossy: 0.34 }),
    dark: materials.standard('#1a120c', { roughness: 1 }),
    critter: materials.standard('#ffffff', { vertexColors: true, roughness: 0.78 }),
    eyeGlow: materials.glow('#ffb43c', { day: 0.25, night: 2.2 }),
    // night lights are small warm AMBER points (never white): the emissive only just
    // crosses the night bloom threshold, so each bulb gets a modest glow, not a blob
    warmGlow: materials.glow('#ffa443', { day: 0.4, night: 1.7 }),
    lanternGlass: materials.glow('#ffa443', { day: 0.3, night: 1.6 }),
    windowGlass: materials.glow('#ffad55', { day: 0.3, night: 1.15 }),
    bulbA: materials.glow('#ffa53f', { day: 0.45, night: 1.85 }),
    bulbB: materials.glow('#ffb04c', { day: 0.45, night: 1.5 }),
    wire: materials.standard('#3b3633', { roughness: 0.8 }),
  };
  // soft cyan glow-caps between the roots (the glow-worms share it on the low tier)
  const capGlow = materials.glow('#7fe8ff', { day: 0.12, night: 1.45 });
  if (remap) {
    // (low tier: ~10 fewer draw calls — every warm bulb & pane one amber glow,
    //  wire & iron the dark, spruce & shingles the oak wood, the toadstool
    //  stems the shelf-fungus material, their gills the critter colour)
    for (const k of ['bulbA', 'bulbB', 'warmGlow', 'windowGlass']) remap.set(mats[k], { material: mats.lanternGlass });
    remap.set(mats.wire, { material: mats.dark });
    remap.set(mats.iron, { material: mats.dark });
    remap.set(mats.spruce, { material: mats.wood });
    remap.set(mats.shingles, { material: mats.wood });
    remap.set(mats.stone, { material: mats.boulder });
    remap.set(mats.stem, { material: mats.fungusTop, color: '#e6dac4' });
    remap.set(mats.gills, { material: mats.critter, color: '#e6d8bd' });
  }
  // Bioluminescent shelf fungi: fungi first, lights second. Cream pores by
  // day; at night only the pore plate under each shelf glows a soft mint (the
  // glen's enchanted-gill mint), fading to nothing towards the bark — the
  // emissive is multiplied by the underside's ramp (vertex colour, red). A
  // clone with its own program key, so the cached gills material is never
  // touched; its glow follows env.night.
  const fungusGlow = materials.surface('gills', { vertexColors: true }).clone();
  fungusGlow.name = 'oak-fungus-glow';
  fungusGlow.emissive = new THREE.Color('#86ecc4');
  {
    const prev = fungusGlow.onBeforeCompile;
    fungusGlow.onBeforeCompile = (shader, renderer) => {
      prev?.call(fungusGlow, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= (vColor.r * vColor.r) / 0.6724;'
      );
    };
    const key = fungusGlow.customProgramCacheKey();
    fungusGlow.customProgramCacheKey = () => `${key}|oak-fungus-glow`;
  }
  const FUNGUS_GLOW = [0.02, 1.0]; // emissive intensity by day / at night
  let lastNight = -1;
  const setFungusGlow = (night) => {
    if (night === lastNight) return;
    lastNight = night;
    fungusGlow.emissiveIntensity = FUNGUS_GLOW[0] + (FUNGUS_GLOW[1] - FUNGUS_GLOW[0]) * smoothstep(0.1, 0.85, night);
  };
  setFungusGlow(ctx.env?.night ?? 0);
  updates.push(() => setFungusGlow(ctx.env?.night ?? 0));
  /** Mint halos under the glowing shelves & the glow-worms (one draw call). */
  const fungusHalos = [];
  /** The boulder the 'right-long' root grips: nothing small may grow inside it. */
  const boulder = boulderFrame();
  const inBoulder = (p, pad = 0.05) => {
    const q = p.clone().sub(boulder.centre);
    const x = q.dot(boulder.radial) / (BOULDER.rRad + pad), y = q.y / (BOULDER.rUp + pad), z = q.dot(boulder.across) / (BOULDER.rAcross + pad);
    return x * x + y * y + z * z < 1;
  };
  /**
   * Bake one bracket-fungus shelf into the batch. Frame m: origin on the
   * surface it grows from, +Z out of it; the shelf is sunk 15 % of its depth
   * into it. `halo`: a small mint halo BELOW the shelf (≤ 0.6 × its width).
   */
  const addShelf = (m, r, rng, { zones = 'glow', halo = false } = {}) => {
    const { top, under, depth } = shelfGeos(r, rng, zones);
    const sunk = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.15 * depth));
    B.add(mats.fungusTop, top.applyMatrix4(sunk), { color: 'keep' });
    if (zones === 'glow') {
      B.add(fungusGlow, under.applyMatrix4(sunk), { color: 'keep' });
      if (halo) {
        const hp = new THREE.Vector3(0, -0.3 * r, 0.5 * depth).applyMatrix4(sunk);
        fungusHalos.push({ x: hp.x, y: hp.y, z: hp.z, size: 0.55 * r });
      }
    } else {
      // sulphur shelves: a pale yellow pore plate, no glow
      const col = under.attributes.color;
      for (let i = 0; i < col.count; i++) {
        const g = 0.55 + 0.45 * Math.min(1, col.getX(i) / 0.82);
        col.setXYZ(i, g * 0.98, g * 0.84, g * 0.46);
      }
      // (no glow ramp needed: the sulphur shelves' pores are plain yellow)
      B.add(mats.fungusTop, under.applyMatrix4(sunk), { color: 'keep' });
    }
  };
  /** Bark radius under a shelf: between the furrow floor and the centre, so the flat back sinks in. */
  const shelfSeat = (a, y, r) => {
    const R = trunkRadius(a, y);
    const da = (r * 0.8) / Math.max(R, 1);
    const lo = Math.min(R, trunkRadius(a - da, y), trunkRadius(a + da, y));
    return 0.5 * (lo + R);
  };

  // ── bracket fungi on the bark: overlapping TIERS of 3–5 shelves ──────────
  // [deg, y, shelves, scale, zones]: each shelf a little smaller than the one
  // below it and tucked half over it, the tier wandering sideways as it climbs.
  const TIERS = [
    [-76, 4.4, 4, 1],
    [-20, 11.5, 4, 1.1], // on the great front burl
    [-104, 9.2, 3, 1.05, 'sulphur'],
    [205, 3.2, 4, 1],
    [241, 10.6, 4, 1, 'sulphur'],
    [178, 7.6, 3, 1],
    [-58, 15.2, 3, 0.9],
    // seen from the Schreinerei above the door's festoon and front-left, and
    // low on the old flanks
    [-6, 5.45, 4, 0.82],
    [-37, 5.45, 4, 0.9],
    [-86, 2.1, 4, 1, 'sulphur'],
    [150, 2.3, 4, 1],
    [262, 5.0, 4, 1],
    // left of the sign, above the EFZ certificate, and under the loft beside
    // its window (small ones near the door: the close-up camera is right there)
    [-23, 3.15, 3, 0.62],
    [37, 2.98, 3, 0.62],
    [34, 5.35, 4, 0.85],
  ];
  for (const [deg, y, n, k, zones = 'glow'] of TIERS) {
    let aa = deg * DEG + rng.range(-0.04, 0.04);
    let yy = y;
    let r = rng.range(0.38, 0.46) * k;
    let drift = rng.chance(0.5) ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const R = trunkRadius(aa, yy);
      const seat = shelfSeat(aa, yy, r);
      const p = polar(aa, seat, yy);
      if (!inCertZone(p, 0.15)) {
        const m = facing(p, new THREE.Vector3(Math.sin(aa), 0, Math.cos(aa)));
        // each shelf finds its own level (no stack of plates)
        m.multiply(new THREE.Matrix4().makeRotationZ(rng.range(-0.14, 0.14)));
        m.multiply(new THREE.Matrix4().makeRotationX(rng.range(-0.04, 0.16)));
        addShelf(m, r, rng, { zones, halo: i === 0 });
      }
      // next shelf: either a sibling beside this one at about the same level
      // (the tier fans out sideways, overlapping at the edges), or up by less
      // than its thickness-and-a-bit, tucked over it like a roof tile and
      // shifted sideways — smaller each time; now and then the tier turns
      if (i > 0 && rng.chance(0.35)) {
        yy += r * rng.range(-0.12, 0.12);
        aa += (drift * rng.range(0.95, 1.25) * r) / Math.max(R, 1);
        r *= rng.range(0.86, 1.0);
      } else {
        yy += r * rng.range(0.32, 0.52);
        if (rng.chance(0.3)) drift = -drift;
        aa += (drift * rng.range(0.5, 0.95) * r) / Math.max(R, 1);
        r *= rng.range(0.74, 0.92);
      }
    }
  }
  // …and on two limbs, near the fork
  for (const [id, u, n] of [
    ['back-left', 0.22, 4],
    ['right', 0.3, 3],
  ]) {
    const L = limb(id);
    if (!L) continue;
    const T = L.curve.getTangentAt(u);
    const side = new THREE.Vector3().crossVectors(T, UP).normalize();
    let rr = rng.range(0.3, 0.36);
    for (let i = 0; i < n; i++) {
      const uu = u + i * 0.012;
      const Q = L.curve.getPointAt(uu).addScaledVector(side, L.radiusAt(uu) - 0.02);
      Q.y -= 0.1 - i * rr * 0.45;
      const m = facing(Q, side);
      addShelf(m, rr, rng, { halo: i === 0 });
      rr *= 0.88;
    }
  }

  // …and stacked shelves on the flanks of the big roots
  for (const [id, u, phi, n] of [
    ['right-long', 0.3, 1.25, 4],
    ['right-long', 0.66, 1.3, 3],
    ['front-right', 0.9, 1.15, 2],
    ['back', 0.42, -1.25, 4],
    ['back-left', 0.5, 1.25, 3],
    ['left-back', 0.38, 1.25, 4],
    ['left', 0.55, -1.2, 3],
  ]) {
    const R = root(id);
    if (!R) continue;
    let rr = rng.range(0.26, 0.34);
    for (let i = 0; i < n; i++) {
      const s = rootSurfacePoint(R, Math.min(0.95, u + i * 0.016), phi - i * 0.14, -0.02);
      if (inCertZone(s.position, 0.3) || inBoulder(s.position, rr)) continue;
      const m = facing(s.position, s.normal);
      m.multiply(new THREE.Matrix4().makeRotationX(rng.range(-0.08, 0.08)));
      addShelf(m, rr, rng, { halo: i === 0 });
      rr *= 0.9;
    }
  }

  // ── the boulder the right-long root arches over and grips ────────────────
  {
    const g = new THREE.IcosahedronGeometry(1, lowDetail ? 3 : 4);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      // a weathered, slightly faceted erratic: broad flats + lumps, flatter base
      const n1 = Math.sin(v.x * 2.3 + 1.1) * Math.sin(v.y * 2.9 + 0.4) * Math.sin(v.z * 2.1 + 2.3);
      const n2 = Math.sin(v.x * 6.1 + 3.3) * Math.sin(v.y * 5.3 + 1.7) * Math.sin(v.z * 6.7 + 0.2);
      const k = 1 + 0.16 * n1 + 0.05 * n2 - (v.y < -0.2 ? 0.12 * (-v.y - 0.2) : 0);
      v.multiplyScalar(k);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.scale(BOULDER.rRad, BOULDER.rUp, BOULDER.rAcross);
    g.computeVertexNormals();
    g.applyMatrix4(boulder.matrix);
    B.add(mats.boulder, g, { cast: true });
    ctx.colliders?.addCircle?.(boulder.centre.x, boulder.centre.z, BOULDER.rAcross * 0.9, 'oak-boulder');
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
      if (inBoulder(s.position, 0.15)) continue;
      const h = rng.range(0.16, 0.34) * (i === 0 ? 1.25 : 1);
      const tilt = new THREE.Quaternion().setFromUnitVectors(UP, s.normal.clone().lerp(UP, 0.65).normalize());
      const m = new THREE.Matrix4().compose(s.position, tilt, new THREE.Vector3(1, 1, 1));
      toadstool(B, mats, h, h * rng.range(0.45, 0.6), rng, m);
    }
  }

  // ── glow-caps: tiny bioluminescent mushrooms in the crevices between roots ─
  {
    // soft cyan: just above the night bloom threshold — little lamps, not blobs
    const halos = [];
    for (const [id, u, phi, big = 1] of [
      ['back', 0.3, 1.45],
      ['left-back', 0.42, -1.45],
      ['back-left', 0.35, 1.5],
      ['right-long', 0.38, -1.5],
      ['front-right', 0.72, -1.4],
      ['left', 0.5, -1.45],
      ['back-right', 0.45, 1.45],
      // at the root bases seen from the Schreinerei and the glen (a few bigger ones)
      ['front-right', 0.88, 1.4, 1.5],
      ['right-long', 0.45, 1.45, 1.4],
      ['right-long', 0.78, 1.45, 1.6],
      ['left', 0.78, 1.45, 1.4],
      ['back-left', 0.78, 1.45, 1.3],
      ['small-right', 0.55, 1.4, 1.2],
    ]) {
      const R = root(id);
      if (!R) continue;
      const n = rng.int(4, 7);
      for (let i = 0; i < n; i++) {
        const s = rootSurfacePoint(R, Math.min(0.95, u + rng.range(-0.06, 0.06)), phi + rng.range(-0.15, 0.15), 0);
        const p = s.position.clone().addScaledVector(s.normal, rng.range(0.02, 0.12));
        p.y = Math.max(p.y, getHeight(p.x, p.z));
        if (inCertZone(p, 0.2) || inBoulder(p, 0.12)) continue;
        const h = rng.range(0.06, 0.15) * (i < 2 ? big : 1);
        const cr = h * rng.range(0.4, 0.6);
        const m = new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.25, 0.25), 0, rng.range(-0.25, 0.25))), new THREE.Vector3(1, 1, 1));
        B.add(capGlow, new THREE.CylinderGeometry(cr * 0.22, cr * 0.3, h, byLv(6, 5, 4)).translate(0, h / 2, 0).applyMatrix4(m));
        const cap = new THREE.SphereGeometry(cr, byLv(10, 8, 6), byLv(5, 4, 3), 0, TAU, 0, Math.PI / 2);
        cap.scale(1, 0.7, 1);
        B.add(capGlow, cap.translate(0, h * 0.95, 0).applyMatrix4(m));
        if (i % 2 === 0) {
          const hp = new THREE.Vector3(0, h, 0).applyMatrix4(m);
          halos.push({ x: hp.x, y: hp.y, z: hp.z, size: 0.22 + 0.06 * big });
        }
      }
    }
    if (LV === 2) fungusHalos.push(...halos); // (one halo draw for all the cool glows)
    else if (halos.length && props.glowQuads) parent.add(props.glowQuads(halos, '#7fe8ff', { day: 0.0, night: 0.5 }));
  }

  // ── the mossy nook above the door: a tiny toadstool family on a cushion ──
  {
    const nook = hollows.find((h) => h.id === 'nook');
    if (nook) {
      const moss = materials.surface('moss');
      remap?.set(moss, { material: mats.critter, color: '#56782f' });
      // the floor of the cup (follow the carved bark down to where it levels)
      const yF = nook.y - 0.26;
      const fp = (da, dy, lift = 0) => polar(nook.a + da, trunkRadius(nook.a + da, yF + dy) + lift, yF + dy);
      // a moss cushion filling the bottom of the cup
      const cushion = blob(0.2, 1.25, 0.42, 0.95, 12, 8);
      B.add(moss, xf(cushion, fp(0, -0.02, 0.07).toArray(), [0, nook.a, 0]));
      const fam = [
        [0.02, 0.16, 0.52],
        [-0.075, 0.105, 0.5],
        [0.085, 0.08, 0.55],
        [-0.02, 0.05, 0.6],
      ];
      fam.forEach(([da, h, k], i) => {
        const p = fp(da, 0.0, 0.1 + (i === 0 ? 0 : 0.06));
        const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.15, 0.2), 0, (da > 0 ? -1 : 1) * rng.range(0.05, 0.25)));
        const m = new THREE.Matrix4().compose(p, tilt, new THREE.Vector3(1, 1, 1));
        toadstool(B, mats, h, h * k, rng, m);
      });
    }
  }

  // ── little round windows: someone lives up there ───────────────────────────
  {
    const glass = mats.windowGlass;
    for (const [deg, y, rad] of [
      [21, 6.7, 0.32],
      [-60, 12.9, 0.27],
    ]) {
      const a = deg * DEG;
      // sit the window on the bark (use the outermost bark around its rim)
      let r = 0;
      for (let k = 0; k < 8; k++) {
        const aa = a + (Math.cos((k / 8) * TAU) * rad) / 3;
        const yy = y + Math.sin((k / 8) * TAU) * rad;
        r = Math.max(r, trunkRadius(aa, yy));
      }
      const p = polar(a, r - 0.02, y);
      const m = facing(p, new THREE.Vector3(Math.sin(a), 0, Math.cos(a)));
      B.add(glass, new THREE.CircleGeometry(rad, 20).translate(0, 0, 0.0).applyMatrix4(m));
      // round frame, mullions, sill and a flower box
      B.add(mats.wood, xf(new THREE.TorusGeometry(rad + 0.04, 0.06, 6, 22), [0, 0, 0.02]).applyMatrix4(m), { cast: true });
      B.add(mats.wood, xf(new THREE.BoxGeometry(rad * 2, 0.035, 0.04), [0, 0, 0.03]).applyMatrix4(m));
      B.add(mats.wood, xf(new THREE.BoxGeometry(0.035, rad * 2, 0.04), [0, 0, 0.03]).applyMatrix4(m));
      const box = new THREE.BoxGeometry(rad * 2.3, 0.14, 0.18);
      materials.boxUV?.(box, 'wood', { grain: 'x' });
      B.add(mats.wood, xf(box, [0, -rad - 0.1, 0.1]).applyMatrix4(m), { cast: true });
      const flowerCols = ['#e85d75', '#ffd166', '#f4f1ff', '#c77dff', '#ff8c42'];
      for (let i = 0; i < 9; i++) {
        const fx = (i / 8 - 0.5) * rad * 2.1;
        const leaf = blob(0.06, 1, 0.7, 1);
        B.add(mats.critter, xf(leaf, [fx, -rad - 0.01 + rng.range(-0.02, 0.03), 0.1 + rng.range(-0.04, 0.04)]).applyMatrix4(m), { color: rng.pick(['#4f7f36', '#5f9440', '#3f6f2e']) });
        if (i % 2 === 0) B.add(mats.critter, xf(blob(0.035), [fx + rng.range(-0.03, 0.03), -rad + 0.04 + rng.range(0, 0.04), 0.12]).applyMatrix4(m), { color: rng.pick(flowerCols) });
      }
      const hp = new THREE.Vector3(0, 0, 0.15).applyMatrix4(m);
      warmHalos.push({ x: hp.x, y: hp.y, z: hp.z, size: rad * 1.05 });
    }
  }

  // ── hanging lanterns on iron chains (static, merged into the batch) ───────
  for (const { len, light, top: P, glass } of lanternHangs(limbs)) {
    B.add(mats.iron, xf(new THREE.CylinderGeometry(0.016, 0.016, len, 5), [P.x, P.y - len / 2, P.z]));
    // a small iron hook clamped around the limb
    B.add(mats.iron, xf(new THREE.TorusGeometry(0.07, 0.014, 5, 10), [P.x, P.y + 0.02, P.z], [0, rng.range(0, 3), 0]));
    const lantern = props.makeLantern({ hanging: true, color: '#ffc46b', halo: false });
    lantern.position.set(P.x, P.y - len, P.z);
    lantern.rotation.y = rng.range(0, TAU);
    lantern.scale.setScalar(LANTERN_SCALE);
    // the glass gets the oak's amber glow (warm & modest instead of a white bloom)
    B.absorb(lantern, (m) => (m.userData?.glow ? mats.lanternGlass : m));
    warmHalos.push({ x: glass.x, y: glass.y, z: glass.z, size: 0.62 });
    lanternSpots.push(glass.clone());
    // two lanterns ask for a real light; one more only if the budget has room
    if (light) ctx.lights?.addPoint?.(glass.clone(), { color: '#ffa94d', day: 0.0, night: 3.6, distance: 8.5, ...(light === 'spare' ? { priority: 6 } : {}) });
  }

  // ── fairy lights (small warm amber bulbs; one wire, two bulb and one halo draw call) ─
  const fairyHalos = [];
  const strand = (pts, opts) => fairyLights(B, mats, fairyHalos, pts, opts);
  const bark = (deg, y, lift = 0.14) => {
    const a = deg * DEG;
    return polar(a, trunkRadius(a, y) + lift, y);
  };
  // a festoon over the door, nailed to the bark every ~20°
  {
    const pts = [];
    for (let d = -78, i = 0; d <= 42; d += 20, i++) pts.push(bark(d, 4.65 + (i % 2) * 0.25 + Math.sin(d * 0.1) * 0.1));
    strand(pts, { sag: 0.1, spacing: 0.36, clear: 0.09 });
  }
  // a higher garland on the left flank, under the owl's hollow
  {
    const pts = [];
    for (let d = -100, i = 0; d <= -52; d += 16, i++) pts.push(bark(d, 8.15 + (i % 2) * 0.3));
    strand(pts, { sag: 0.12, spacing: 0.4, clear: 0.09 });
  }
  // …and one that spirals from the door festoon's left end up across the
  // front of the trunk to the top of the loft stairs (links door and loft at
  // night; passes above the bird house and below the owl)
  {
    const pts = [];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push(bark(-78 + 70 * t, 4.7 + 5.75 * Math.pow(t, 1.15), 0.15));
    }
    // (every bulb gets a halo: this is the strand that must read from the glen)
    strand(pts, { sag: 0.09, spacing: 0.32, clear: 0.1, haloEvery: 1, haloSize: 0.2 });
  }
  // a second, lower loop at the back-left, between the roots
  {
    const pts = [];
    for (let d = 196, i = 0; d <= 268; d += 18, i++) pts.push(bark(d, 3.3 + (i % 2) * 0.35));
    strand(pts, { sag: 0.12, spacing: 0.38, clear: 0.09 });
  }
  // along the underside of the low limb
  {
    const L = limb('front-left-low');
    if (L) {
      const pts = [];
      for (let u = 0.07; u <= 0.56; u += 0.07) {
        const P = L.curve.getPointAt(u);
        P.y -= L.radiusAt(u) + 0.04;
        pts.push(P);
      }
      strand(pts, { sag: 0.16, spacing: 0.42 });
    }
  }
  // down the front-right root (seen from the Schreinerei) — starting above and
  // beside the EFZ certificate so the wire never crosses it
  {
    const R = root('front-right');
    if (R) {
      const pts = [bark(50, 3.5, 0.12)];
      for (const u of [0.3, 0.48, 0.66, 0.84]) pts.push(rootSurfacePoint(R, u, -0.2, 0.06).position);
      strand(pts, { sag: 0.08, spacing: 0.34 });
    }
  }
  // over the left roots
  {
    const R7 = root('left-back');
    const R8 = root('left');
    if (R7 && R8) {
      strand([bark(-104, 3.0, 0.12), rootSurfacePoint(R8, 0.42, 0, 0.06).position, rootSurfacePoint(R8, 0.66, 0, 0.06).position], { sag: 0.1, spacing: 0.36 });
      strand([bark(-122, 2.6, 0.12), rootSurfacePoint(R7, 0.36, 0, 0.06).position, rootSurfacePoint(R7, 0.58, 0, 0.06).position], { sag: 0.1, spacing: 0.36 });
    }
  }
  // sagging strands along the undersides of the lower limbs (they light the
  // crown's belly at night — the biggest shape in every wide frame), and one
  // festoon slung across from the low limb to the front limb. Every nail point
  // stays out of the spot cameras' views and the loft: a blocked point breaks
  // the strand into separate runs.
  const limbStrand = (id, u0, u1, du, sag) => {
    const L = limb(id);
    if (!L) return;
    let run = [];
    const flush = () => {
      if (run.length >= 2) strand(run, { sag, spacing: 0.4 });
      run = [];
    };
    for (let u = u0; u <= u1 + 1e-6; u += du) {
      const P = L.curve.getPointAt(Math.min(u, 0.98));
      P.y -= L.radiusAt(u) + 0.04;
      if (crownBlocked(P, 0.35) || crownBlocked(P.clone().setY(P.y - 0.6), 0.3)) flush();
      else run.push(P);
    }
    flush();
  };
  limbStrand('front', 0.06, 0.66, 0.075, 0.2);
  limbStrand('left-high', 0.05, 0.5, 0.07, 0.2);
  limbStrand('back-left', 0.05, 0.55, 0.08, 0.2);
  limbStrand('right', 0.1, 0.62, 0.07, 0.18);
  limbStrand('front-left-low', 0.6, 0.92, 0.08, 0.2);
  {
    const A = limb('front-left-low'), F = limb('front');
    if (A && F) {
      const pa = A.curve.getPointAt(0.24);
      pa.y -= A.radiusAt(0.24) + 0.04;
      const pf = F.curve.getPointAt(0.3);
      pf.y -= F.radiusAt(0.3) + 0.04;
      const mid = pa.clone().lerp(pf, 0.5);
      mid.y -= pa.distanceTo(pf) * 0.18;
      if (![pa, pf, mid].some((q) => crownBlocked(q, 0.3))) strand([pa, pf], { sag: 0.16, spacing: 0.4, haloEvery: 1, haloSize: 0.18 });
    }
  }
  if (LV === 2) warmHalos.push(...fairyHalos); // (one halo draw for all the warm glows)
  else if (fairyHalos.length && props.glowQuads) parent.add(props.glowQuads(fairyHalos, '#ffa94d', { day: 0.0, night: 0.9 }));

  // ── rope swing ────────────────────────────────────────────────────────────
  // It hangs from the far end of the long right limb, beside the waterfall's
  // pool: in plain sight from the glen overview, but outside every spot
  // camera's frame (it used to hang through the cottage & Wohnatelier views).
  // Debug: ?oakswing=<limb>:<u>[,<limb>:<u>…] hangs swings there instead.
  {
    const dbg = ctx.engine?.params?.get?.('oakswing');
    const spots = dbg
      ? dbg.split(',').map((t) => t.split(':')).map(([id, u]) => [id, +u])
      : [['right', SWING_U]];
    for (const [id, u] of spots) {
      const L = limb(id);
      if (L) buildSwing(ctx, mats, parent, L, u, updates, reduced);
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
    const eyeGeo = mergeGeometries([-1, 1].map((sx) => xf(blob(0.042 * S, 1, 1, 0.6), [sx * 0.07 * S, 0, 0])));
    const pupilGeo = mergeGeometries([-1, 1].map((sx) => xf(blob(0.022 * S, 1, 1, 0.5), [sx * 0.07 * S, 0, 0.022 * S])));
    eyes.add(new THREE.Mesh(eyeGeo, mats.eyeGlow), new THREE.Mesh(pupilGeo, mats.dark));
    owl.add(eyes);
    parent.add(owl);
    ctx.interactions?.add?.(owl, {
      kind: 'secret',
      area: 'woodworking',
      label: 'Someone in the hollow…',
      onActivate: () => ctx.ui?.speech?.('Hoo! Who goes there?', owl),
    });
    const baseYaw = owl.rotation.y;
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
        owl.rotation.y = baseYaw + Math.sin(t * 0.21) * 0.25;
      });
    }
  }

  // ── the secret: a tiny mouse door in the front-right root ─────────────────
  {
    const R = root('front-right');
    if (R) {
      const door = new THREE.Group();
      door.name = 'oak-mouse-door';
      door.applyMatrix4(R.door?.matrix ?? mouseDoorFrame(R).matrix);
      const DB = new Batch();
      const dw = MOUSE_DOOR.width, dh = MOUSE_DOOR.height, ar = dw / 2;
      // stone arch: little stones around the opening
      const nSt = 11;
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
        const st = new THREE.DodecahedronGeometry(rng.range(0.045, 0.062), 0);
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
      // a tiny lantern on a twig post beside the door, so the secret glows at night
      DB.add(mats.wood, xf(new THREE.CylinderGeometry(0.012, 0.016, 0.42, 5), [ar + 0.16, 0.21, 0.12], [0, 0, 0.06]));
      DB.add(mats.wood, xf(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 4), [ar + 0.13, 0.41, 0.12], [0, 0, Math.PI / 2]));
      DB.add(mats.iron, xf(new THREE.ConeGeometry(0.045, 0.04, 4), [ar + 0.09, 0.36, 0.12], [0, Math.PI / 4, 0]));
      DB.add(mats.warmGlow, xf(new THREE.CylinderGeometry(0.026, 0.024, 0.06, 6), [ar + 0.09, 0.31, 0.12]));
      // the frame is static: bake it (in world space) into the shared batch
      door.updateMatrixWorld(true);
      for (const { material, list } of DB.parts.values()) for (const g of list) B.add(material, g.applyMatrix4(door.matrixWorld));
      DB.parts.clear();
      const lh = new THREE.Vector3(ar + 0.09, 0.31, 0.12).applyMatrix4(door.matrixWorld);
      warmHalos.push({ x: lh.x, y: lh.y, z: lh.z, size: 0.3 });
      // the door leaf (hinged on the left) — planks, iron strap, knob
      const leafPivot = new THREE.Group();
      leafPivot.position.set(-ar, 0.01, 0.02);
      const LB = new Batch(LV === 2 ? { remap: new Map([[mats.iron, { material: mats.wood }]]) } : {});
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

  // ── glow-worms in the ivy: tiny mint lights among the leaves (night) ──────
  const glowDot = materials.glow('#a8f5c8', { day: 0.0, night: 1.5 });
  remap?.set(glowDot, { material: capGlow });
  if (ivyLeaves) {
    const p = ivyLeaves.attributes.position.array;
    const nr = ivyLeaves.attributes.normal?.array;
    const dot = new THREE.SphereGeometry(1, byLv(6, 5, 4), byLv(4, 4, 3));
    const v = new THREE.Vector3();
    const cards = p.length / 12;
    for (let k = 0, lit = 0; k < cards; k++) {
      if (!rng.chance(0.085)) continue;
      const o = k * 12;
      v.set((p[o] + p[o + 3] + p[o + 6] + p[o + 9]) / 4, (p[o + 1] + p[o + 4] + p[o + 7] + p[o + 10]) / 4, (p[o + 2] + p[o + 5] + p[o + 8] + p[o + 11]) / 4);
      if (nr) v.x += nr[o] * 0.04, v.y += nr[o + 1] * 0.04, v.z += nr[o + 2] * 0.04;
      if (v.y < 0.4 || inCertZone(v, 0.2)) continue;
      const sz = rng.range(0.018, 0.03);
      B.add(glowDot, dot.clone().scale(sz, sz, sz).translate(v.x, v.y, v.z));
      if (lit++ % 2 === 0) fungusHalos.push({ x: v.x, y: v.y, z: v.z, size: 0.13 + sz * 2.5 });
    }
    dot.dispose();
  }
  // ── glow-worms on silk under the lower limbs (night) ─────────────────────
  // Threads of silk hang from the limbs' undersides, each with a few beads of
  // cool light, the lowest the brightest — the crown's belly carries its own
  // magic. The silk is a faint line (one draw call) that only shows at night;
  // the beads join the batch, every thread's lowest bead gets a small halo.
  {
    const silk = [];
    const dot = new THREE.SphereGeometry(1, byLv(6, 5, 4), byLv(4, 4, 3));
    const per = { 'front-left-low': 24, front: 18, 'left-high': 14, right: 10, 'front-right-high': 9, 'back-left': 12, 'back-right': 8, leader: 5, 'back-high': 8 };
    const v = new THREE.Vector3();
    for (const L of limbs) {
      const n = Math.round((per[L.id] ?? 0) * Math.min(1, Math.max(0.5, ctx.quality?.density ?? 1)));
      for (let k = 0; k < n; k++) {
        const u = rng.range(0.12, 0.92);
        const P = L.curve.getPointAt(u);
        const T = L.curve.getTangentAt(u);
        const side = new THREE.Vector3(-T.z, 0, T.x).normalize();
        P.addScaledVector(side, rng.range(-0.5, 0.5) * L.radiusAt(u));
        P.y -= L.radiusAt(u) * 0.8;
        const len = rng.chance(0.6) ? rng.range(0.4, 1.3) : rng.range(1.3, 3.0);
        const bottom = P.clone();
        bottom.y -= len;
        bottom.x += rng.range(-0.05, 0.05);
        bottom.z += rng.range(-0.05, 0.05);
        if (bottom.y < 9) continue;
        if (crownBlocked(v.copy(P).lerp(bottom, 0.5), len * 0.5 + 0.15)) continue;
        silk.push(P.x, P.y, P.z, bottom.x, bottom.y, bottom.z);
        const beads = rng.chance(0.4) ? 1 : rng.int(2, 4);
        for (let b = 0; b < beads; b++) {
          const t = 1 - b * rng.range(0.1, 0.18);
          if (t < 0.25) break;
          v.copy(P).lerp(bottom, t);
          const sz = (b === 0 ? rng.range(0.042, 0.058) : rng.range(0.024, 0.036));
          B.add(glowDot, dot.clone().scale(sz, sz * 1.25, sz).translate(v.x, v.y, v.z));
          if (b === 0) fungusHalos.push({ x: v.x, y: v.y, z: v.z, size: 0.26 });
        }
      }
    }
    dot.dispose();
    if (silk.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(silk, 3));
      const silkMat = new THREE.LineBasicMaterial({ color: '#cdeee2', transparent: true, opacity: 0, depthWrite: false, fog: true });
      silkMat.name = 'oak-silk';
      const lines = new THREE.LineSegments(g, silkMat);
      lines.name = 'oak-glowworm-silk';
      lines.raycast = () => {};
      lines.matrixAutoUpdate = false;
      lines.visible = false;
      parent.add(lines);
      let last = -1;
      updates.push(() => {
        const night = ctx.env?.night ?? 0;
        if (night === last) return;
        last = night;
        const k = smoothstep(0.35, 0.85, night);
        silkMat.opacity = 0.45 * k;
        lines.visible = k > 0.01;
      });
    }
  }
  if (fungusHalos.length && props.glowQuads) parent.add(props.glowQuads(fungusHalos, '#86ecc4', { day: 0.0, night: 0.5 }));

  for (const g of hollowLinings ?? []) B.add(mats.dark, g);
  if (warmHalos.length) parent.add(props.glowQuads(warmHalos, '#ffa94d', { day: 0.04, night: LV === 2 ? 0.72 : 0.6 }));
  B.build(parent, 'oak-details');
  return {
    /** world positions of the lantern glasses (for others' light/sound cues) */
    lanterns: lanternSpots,
    update(dt, t) {
      for (const u of updates) u(dt, t);
    },
  };
}
