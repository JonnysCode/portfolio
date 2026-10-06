// ─────────────────────────────────────────────────────────────────────────────
// Vegetation geometry toolkit. Builds "templates": one plant (trunk + crown,
// a flower, a rock …) as flat typed arrays with per-vertex
//   colour  – linear RGB; foliage parts store a SHADE that is multiplied by the
//             instance's leaf colour (see `tint`)
//   tint    – 0..1, how much the instance tint colour applies (1 = foliage)
//   sway    – wind bend weight in world units (0 at the roots)
// Templates are stamped into the static chunk batches by batcher.js.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise2D } from '../../core/noise.js';

const noiseA = createNoise2D(9123);
const noiseB = createNoise2D(4441);
/** cheap 3D value-ish noise from two 2D simplex planes, ≈ −1..1 */
export function noise3(x, y, z) {
  return (noiseA(x + z * 0.7, y) + noiseB(y - x * 0.3, z)) * 0.5;
}

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Weld duplicate vertices (seams, poles) and recompute smooth normals. */
export function smooth(geo) {
  for (const k of Object.keys(geo.attributes)) if (k !== 'position') geo.deleteAttribute(k);
  if (geo.index) geo = geo.toNonIndexed();
  const m = mergeVertices(geo, 1e-4);
  m.computeVertexNormals();
  return m;
}

/** Make sure a geometry is indexed and only carries position + normal. */
export function prep(geo) {
  for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
  if (!geo.index) {
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo = mergeVertices(geo, 1e-4);
  }
  return geo;
}

/**
 * Accumulates parts into one template.
 *   b.add(geometry, { color, shade(x,y,z,nx,ny,nz,out)→void, tint, sway })
 * `color` is a colour (or hex); `shade` (optional) writes an RGB multiplier
 * into `out` (a THREE.Color) per vertex. `sway` is a number or fn(x,y,z)→w.
 */
export class TemplateBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.tint = [];
    this.sway = [];
    this.idx = [];
    this.vCount = 0;
  }

  /**
   * opts.puff = { center: Vector3, k } blends normals towards the direction
   * from `center` — a crown of many blobs then shades like one soft cloud.
   */
  add(geometry, { color = '#ffffff', shade = null, tint = 0, sway = 0, puff = null } = {}) {
    const geo = prep(geometry);
    const p = geo.attributes.position, n = geo.attributes.normal;
    if (puff) {
      const d = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        d.set(p.getX(i), p.getY(i), p.getZ(i)).sub(puff.center).normalize();
        _n.set(n.getX(i), n.getY(i), n.getZ(i)).lerp(d, puff.k).normalize();
        n.setXYZ(i, _n.x, _n.y, _n.z);
      }
    }
    const base = new THREE.Color(color);
    const off = this.vCount;
    const mul = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      _n.set(n.getX(i), n.getY(i), n.getZ(i)).normalize();
      this.pos.push(x, y, z);
      this.nrm.push(_n.x, _n.y, _n.z);
      mul.setRGB(1, 1, 1);
      if (shade) shade(x, y, z, _n.x, _n.y, _n.z, mul);
      _c.copy(base).multiply(mul);
      this.col.push(_c.r, _c.g, _c.b);
      this.tint.push(typeof tint === 'function' ? tint(x, y, z) : tint);
      this.sway.push(typeof sway === 'function' ? Math.max(0, sway(x, y, z)) : sway);
    }
    const ix = geo.index.array;
    for (let i = 0; i < ix.length; i++) this.idx.push(ix[i] + off);
    this.vCount += p.count;
    return this;
  }

  build(meta = {}) {
    let minY = Infinity, maxY = -Infinity, rad = 0;
    for (let i = 0; i < this.pos.length; i += 3) {
      const x = this.pos[i], y = this.pos[i + 1], z = this.pos[i + 2];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      rad = Math.max(rad, Math.hypot(x, z));
    }
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      colors: new Float32Array(this.col),
      tint: new Float32Array(this.tint),
      sway: new Float32Array(this.sway),
      index: new Uint32Array(this.idx),
      vertexCount: this.vCount,
      indexCount: this.idx.length,
      height: maxY,
      radius: rad,
      ...meta,
    };
  }
}

// ─── Primitive shapes ────────────────────────────────────────────────────────

const unitSpheres = new Map();
/** Welded unit icosphere / octahedron (cached; callers get a clone). */
function unitSphere(detail, octa) {
  const key = octa ? 'o' : 'i' + detail;
  if (!unitSpheres.has(key)) unitSpheres.set(key, smooth(octa ? new THREE.OctahedronGeometry(1, 0) : new THREE.IcosahedronGeometry(1, detail)));
  return unitSpheres.get(key).clone();
}

/** Lumpy icosphere blob, scaled (sx, sy, sz) and placed at (x, y, z). */
export function blob(r, { detail = 1, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, lump = 0.08, seed = 0, octa = false } = {}) {
  const g = unitSphere(detail, octa);
  const p = g.attributes.position;
  const a = p.array;
  for (let i = 0; i < a.length; i += 3) {
    const vx = a[i], vy = a[i + 1], vz = a[i + 2];
    const k = lump ? 1 + lump * noise3(vx * 1.7 + seed * 3.1, vy * 1.7 + seed, vz * 1.7 - seed * 1.3) : 1;
    a[i] = vx * k * r * sx + x;
    a[i + 1] = vy * k * r * sy + y;
    a[i + 2] = vz * k * r * sz + z;
  }
  g.computeVertexNormals();
  return g;
}

/** Radial wobble factor used by lathe() at angle a (atan2(z, x)) and height y. */
export function latheWobble(a, y, wobble, seed) {
  return 1 + wobble * Math.sin(a * 3 + seed * 5) * 0.6 + wobble * Math.sin(a * 5 + seed * 2.3 + y) * 0.4;
}

/** Radius of a [radius, y] profile at height y (linear interpolation). */
export function profileRadius(profile, y) {
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
    if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1);
  }
  return y < profile[0][1] ? profile[0][0] : profile[profile.length - 1][0];
}

/**
 * Seamless indexed lathe from a profile of [radius, y] pairs with optional
 * bend (x offset ∝ (y/h)²) and per-angle radial wobble. Points with radius
 * ≈ 0 become a single pole vertex. Faces point outward for profiles that run
 * bottom → top on the outside (same convention as THREE.LatheGeometry).
 */
export function lathe(profile, { segments = 8, bend = 0, bendDir = 0, wobble = 0, seed = 0 } = {}) {
  const pos = [], idx = [], rows = [];
  const h = profile[profile.length - 1][1] || 1;
  const bx = Math.cos(bendDir), bz = Math.sin(bendDir);
  for (const [r, y] of profile) {
    const t = bend ? (y / h) * (y / h) * bend : 0;
    if (r < 1e-4) {
      rows.push([pos.length / 3]);
      pos.push(bx * t, y, bz * t);
      continue;
    }
    const row = [];
    for (let j = 0; j < segments; j++) {
      // same angle convention as LatheGeometry: x = sin(phi)·r, z = cos(phi)·r
      const phi = (j / segments) * Math.PI * 2;
      let x = Math.sin(phi) * r, z = Math.cos(phi) * r;
      if (wobble) {
        const k = latheWobble(Math.atan2(z, x), y, wobble, seed);
        x *= k;
        z *= k;
      }
      row.push(pos.length / 3);
      pos.push(x + bx * t, y, z + bz * t);
    }
    rows.push(row);
  }
  for (let k = 0; k < rows.length - 1; k++) {
    const A = rows[k], B = rows[k + 1];
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      const a0 = A.length === 1 ? A[0] : A[j], a1 = A.length === 1 ? A[0] : A[j1];
      const b0 = B.length === 1 ? B[0] : B[j], b1 = B.length === 1 ? B[0] : B[j1];
      if (A.length > 1) idx.push(a0, a1, b0);
      if (B.length > 1) idx.push(a1, b1, b0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Tapered tube along a list of points (THREE.Vector3), radius from r0 to r1.
 * Cheap branches and roots. Ends are left open (tuck them into other parts).
 */
export function taperedTube(points, r0, r1, radial = 5) {
  const curve = new THREE.CatmullRomCurve3(points);
  const segs = Math.max(2, points.length * 2);
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const c = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const cx = Math.cos(a), sy = Math.sin(a);
      pos.push(c.x + r * (cx * N.x + sy * B.x), c.y + r * (cx * N.y + sy * B.y), c.z + r * (cx * N.z + sy * B.z));
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial);
      const c = a + radial, d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Cylinder from point a to point b (THREE.Vector3). */
export function stick(a, b, r0, r1, radial = 5) {
  const dir = _v.subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

/**
 * Flat ribbon / blade along a curve: `spine(t)` → [x, y, z], width(t),
 * `side` vector is computed from the spine direction and the `up` hint.
 * fold > 0 lifts the centre line for a V-shaped cross section (reads better
 * with toon shading). Returns an indexed geometry.
 */
export function ribbon(spine, width, { segments = 4, fold = 0, sideAxis = null } = {}) {
  const pos = [], idx = [];
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    p0.fromArray(spine(t));
    p1.fromArray(spine(Math.min(1, t + 0.02)));
    if (t >= 0.999) {
      p1.copy(p0);
      p0.fromArray(spine(t - 0.02));
      tan.subVectors(p1, p0).normalize();
      p0.fromArray(spine(t));
    } else tan.subVectors(p1, p0).normalize();
    if (sideAxis) side.copy(sideAxis);
    else side.crossVectors(tan, up).normalize();
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    const w = width(t) / 2;
    const lift = fold * w;
    pos.push(p0.x - side.x * w, p0.y - side.y * w, p0.z - side.z * w);
    pos.push(p0.x, p0.y + lift, p0.z);
    pos.push(p0.x + side.x * w, p0.y + side.y * w, p0.z + side.z * w);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 3;
    const b = a + 3;
    idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A flat disc fan (petals, leaves) lying in XZ, facing +Y. */
export function disc(radius, segments = 6, { sx = 1, sz = 1, y = 0, cup = 0 } = {}) {
  const pos = [0, y + cup * radius * -0.5, 0];
  const idx = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pos.push(Math.cos(a) * radius * sx, y, Math.sin(a) * radius * sz);
  }
  for (let i = 0; i < segments; i++) idx.push(0, 1 + ((i + 1) % segments), 1 + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Set every normal of a geometry to point (mostly) up — grass shades like the ground. */
export function normalsUp(geo, keep = 0.25) {
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    _n.set(n.getX(i) * keep, 1, n.getZ(i) * keep).normalize();
    n.setXYZ(i, _n.x, _n.y, _n.z);
  }
  return geo;
}

/** Apply a transform (position, euler rotation, scale) to a geometry in place. */
export function place(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, sx = s, sy = s, sz = s } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
  geo.applyMatrix4(m);
  return geo;
}

/** Vertical gradient shade helper: lerps two RGB multipliers by normal.y and height. */
export function gradientShade(bottom, top, { yMin = 0, yMax = 1, nyWeight = 0.6 } = {}) {
  const b = new THREE.Color(...bottom), t = new THREE.Color(...top);
  return (x, y, z, nx, ny, nz, out) => {
    const hy = THREE.MathUtils.clamp((y - yMin) / (yMax - yMin || 1), 0, 1);
    const k = THREE.MathUtils.clamp(hy * (1 - nyWeight) + (ny * 0.5 + 0.5) * nyWeight, 0, 1);
    out.copy(b).lerp(t, k * k * (3 - 2 * k));
  };
}
