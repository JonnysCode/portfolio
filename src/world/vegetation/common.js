// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for the forest floor, the undergrowth and the forest wall.
//
//   GeoBuilder        accumulate hand-made geometry (position, normal, uv,
//                     colour, index) and emit ONE indexed BufferGeometry —
//                     every builder in vegetation/ produces the same attribute
//                     set, so anything can be merged with anything.
//   instanced(...)    an InstancedMesh from a template + a list of placements
//                     ({ x, y, z, ry, s, sx?, sy?, tilt?, color? })
//   mergeSafe(geos)   mergeGeometries that first aligns attribute sets
//   moonlit(mat)      a clone of a foliage material that dims to a moonlit
//                     silhouette at night, with a silver rim on its upper edges
//   noise helpers     seeded 2D simplex fields shared by terrain & scatter
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise2D, fbm } from '../../core/noise.js';
import { sharedUniforms } from '../../core/materials.js';

export const TAU = Math.PI * 2;

// Seeded noise fields used for "biomes" (where ferns, flowers or leaf litter
// dominate). Terrain and vegetation share them, so the moss carpet, the leaf
// litter and the plants growing on them agree with each other.
const nA = createNoise2D(91021);
const nB = createNoise2D(5531);
const nC = createNoise2D(4409);
const nD = createNoise2D(1777);

/** Broad patches (≈ 12 units): 0..1. */
export const fieldBroad = (x, z) => 0.5 + 0.5 * fbm(nA, x * 0.075, z * 0.075, 3);
/** Medium patches (≈ 4 units): 0..1. */
export const fieldMid = (x, z) => 0.5 + 0.5 * fbm(nB, x * 0.22, z * 0.22, 2);
/** Fine breakup (≈ 1 unit): 0..1. */
export const fieldFine = (x, z) => 0.5 + 0.5 * nC(x * 0.9, z * 0.9);
/** Another independent broad field (flowers vs ferns …): 0..1. */
export const fieldAlt = (x, z) => 0.5 + 0.5 * fbm(nD, x * 0.1 + 3.3, z * 0.1 - 1.7, 3);

// ─── geometry accumulation ───────────────────────────────────────────────────
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Collects vertices for one template/mesh. Every vertex has position, normal,
 * uv and colour (linear RGB) so all outputs merge cleanly.
 */
export class GeoBuilder {
  /** defaultColor: vertex colour used when a vertex is added without one (THREE.Color or hex). */
  constructor(defaultColor = null) {
    this.def = defaultColor ? new THREE.Color(defaultColor) : null;
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }
  get count() {
    return this.pos.length / 3;
  }
  /** Add a vertex; returns its index. color: THREE.Color or [r, g, b] (linear). */
  vert(x, y, z, nx, ny, nz, u = 0, v = 0, color = null) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    if (color && color.isColor) this.col.push(color.r, color.g, color.b);
    else if (color) this.col.push(color[0], color[1], color[2]);
    else if (this.def) this.col.push(this.def.r, this.def.g, this.def.b);
    else this.col.push(1, 1, 1);
    return this.pos.length / 3 - 1;
  }
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }
  /**
   * Append a BufferGeometry (indexed or not) transformed by `matrix`, painted
   * with `color` (multiplies an existing colour attribute).
   */
  addGeometry(geo, matrix = null, color = null) {
    const p = geo.attributes.position;
    const n = geo.attributes.normal;
    const t = geo.attributes.uv;
    const c = geo.attributes.color;
    const base = this.count;
    const nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
    const tint = color ? (color.isColor ? color : _c.set(color)) : null;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i);
      if (matrix) _v.applyMatrix4(matrix);
      if (n) {
        _n.fromBufferAttribute(n, i);
        if (nm) _n.applyMatrix3(nm).normalize();
      } else _n.set(0, 1, 0);
      let r = 1, g = 1, b = 1;
      if (!c && !tint && this.def) {
        r = this.def.r;
        g = this.def.g;
        b = this.def.b;
      }
      if (c) {
        r = c.getX(i);
        g = c.getY(i);
        b = c.getZ(i);
      }
      if (tint) {
        r *= tint.r;
        g *= tint.g;
        b *= tint.b;
      }
      this.pos.push(_v.x, _v.y, _v.z);
      this.nor.push(_n.x, _n.y, _n.z);
      this.uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
      this.col.push(r, g, b);
    }
    if (geo.index) {
      const ix = geo.index.array;
      for (let i = 0; i < ix.length; i++) this.idx.push(base + ix[i]);
    } else {
      for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    }
    return this;
  }
  /** Recompute smooth normals for the vertices/triangles added since (fromVert, fromIdx). */
  smoothNormals(fromVert, fromIdx) {
    const P = this.pos, Nn = this.nor, I = this.idx;
    for (let v = fromVert; v < this.count; v++) Nn[v * 3] = Nn[v * 3 + 1] = Nn[v * 3 + 2] = 0;
    for (let t = fromIdx; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      for (const k of [a, b, c]) {
        Nn[k] += nx;
        Nn[k + 1] += ny;
        Nn[k + 2] += nz;
      }
    }
    for (let v = fromVert; v < this.count; v++) {
      const l = Math.hypot(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]) || 1;
      Nn[v * 3] /= l;
      Nn[v * 3 + 1] /= l;
      Nn[v * 3 + 2] /= l;
    }
  }
  /** Emit the geometry (optionally recomputing smooth normals). */
  build({ computeNormals = false } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const n = this.count;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    if (computeNormals) g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Make sure a geometry has exactly position/normal/uv/color and an index (so it can merge with others). */
export function normalizeAttributes(g, color = [1, 1, 1]) {
  if (!g.index) {
    const n = g.attributes.position.count;
    const ix = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) ix[i] = i;
    g.setIndex(new THREE.BufferAttribute(ix, 1));
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.color) {
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set(color, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  g.morphAttributes = {};
  return g;
}

/** mergeGeometries after aligning attributes; returns null for an empty list. */
export function mergeSafe(geos) {
  const list = geos.filter(Boolean).map((g) => normalizeAttributes(g));
  if (!list.length) return null;
  // 16-bit and 32-bit indices can't be mixed by mergeGeometries → promote.
  const total = list.reduce((s, g) => s + g.attributes.position.count, 0);
  if (total > 65535) for (const g of list) if (!(g.index.array instanceof Uint32Array)) g.setIndex(new THREE.Uint32BufferAttribute(Array.from(g.index.array), 1));
  const m = mergeGeometries(list, false);
  m.computeBoundingSphere();
  m.computeBoundingBox();
  return m;
}

// ─── instancing ──────────────────────────────────────────────────────────────
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Compose a placement { x, y, z, ry, s, sx, sy, sz, tx, tz } into a matrix. */
export function placementMatrix(it, out = _m) {
  _e.set(it.tx ?? 0, it.ry ?? 0, it.tz ?? 0, 'YXZ');
  _q.setFromEuler(_e);
  const s = it.s ?? 1;
  _s.set(s * (it.sx ?? 1), s * (it.sy ?? 1), s * (it.sz ?? 1));
  _p.set(it.x, it.y, it.z);
  return out.compose(_p, _q, _s);
}

/**
 * InstancedMesh for a template. items: placements (see placementMatrix), each
 * with an optional `color` (THREE.Color / hex) for instanceColor.
 */
export function instanced(name, geometry, material, items, { cast = false, receive = true } = {}) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  mesh.name = name;
  const useColor = items.some((it) => it.color !== undefined);
  for (let i = 0; i < items.length; i++) {
    mesh.setMatrixAt(i, placementMatrix(items[i]));
    if (useColor) mesh.setColorAt(i, items[i].color !== undefined ? _c.set(items[i].color) : _c.setRGB(1, 1, 1));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox?.();
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/** Simple static mesh helper. */
export function staticMesh(name, geometry, material, { cast = false, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.castShadow = cast;
  m.receiveShadow = receive;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

/** Linear colour from an sRGB hex with optional HSL jitter. */
export function tone(hex, rng = null, { h = 0, s = 0, l = 0 } = {}) {
  const c = new THREE.Color(hex);
  if (rng) c.offsetHSL(rng.jitter(h), rng.jitter(s), rng.jitter(l));
  return c;
}

// ─── moonlit foliage ─────────────────────────────────────────────────────────
/**
 * A clone of a (cached) foliage material whose leaves read as silhouettes at
 * night: the diffuse dims to `dim` × and the upward-facing edges of each leaf
 * mass catch a soft silver moon rim. Follows the shared night uniform; the
 * day look is untouched. (The cached material itself is never mutated.)
 */
export function moonlit(base, { dim = 0.6, rim = 0.14, color = [0.62, 0.72, 0.95] } = {}) {
  const m = base.clone();
  m.name = `${base.name}-moonlit`;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    shader.uniforms.uVegNight = sharedUniforms.uNight;
    const c = color.map((v) => v.toFixed(3)).join(', ');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uVegNight;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb *= mix(1.0, ${dim.toFixed(3)}, uVegNight);`)
      .replace('#include <opaque_fragment>', `{
    // silver moon rim on the upper edges of the leaf masses
    vec3 vegUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    float vegTop = smoothstep(-0.1, 0.7, dot(normal, vegUp));
    float vegFres = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
    outgoingLight += vec3(${c}) * (vegTop * vegFres * ${rim.toFixed(3)} * uVegNight);
  }
#include <opaque_fragment>`);
  };
  const key = m.customProgramCacheKey();
  m.customProgramCacheKey = () => `${key}|moonlit-${dim}-${rim}`;
  return m;
}
