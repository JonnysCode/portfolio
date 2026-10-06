// ─────────────────────────────────────────────────────────────────────────────
// Props toolkit internals — geometry helpers shared by every prop builder.
//
// The big idea: a prop is built from many small primitives, each tagged with a
// LAYER and a colour. Parts of a layer are baked (transform + vertex colour)
// and merged into ONE geometry, so a whole mushroom house is ~5 draw calls.
// All vertex-coloured layers share a single cached white toon material.
//
//   const P = new Parts();
//   P.add('paint', xf(new THREE.SphereGeometry(1), [0, 1, 0]), palette.capRed);
//   P.add('wood', grainUV(new THREE.BoxGeometry(1, .1, .3), 'x'), palette.oak);
//   const geos = P.finish();            // { paint: BufferGeometry, wood: … }
//   group.add(...meshesFor(geos));      // one mesh per layer, shadows per layer
//
// Finished geometries are cached by the builders (cached(key, fn)) so every
// instance of a variant shares the same GPU buffers.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { materials } from '../core/materials.js';

// ── caching ──────────────────────────────────────────────────────────────────
const cache = new Map();
/** Build once per key, then return the cached value (geometries, layer maps …). */
export function cached(key, build) {
  let v = cache.get(key);
  if (v === undefined) {
    v = build();
    cache.set(key, v);
  }
  return v;
}

// ── materials ────────────────────────────────────────────────────────────────
/** The shared vertex-coloured toon material (most of the village). */
export const vcMat = () => materials.toon('#ffffff', { vertexColors: true, name: 'props-vc' });
/** Vertex-coloured toon + wood grain (species tint comes from the vertex colour). */
export const vcWood = () => materials.wood('#ffffff', { vertexColors: true });
/** Vertex-coloured toon that sways in the wind (plants, flags). */
export const vcWind = (strength = 0.05, base = 0.1) =>
  materials.toon('#ffffff', { vertexColors: true, wind: { strength, base, speed: 1.7 }, name: 'props-vc-wind' });

/**
 * Layer definitions: material + shadow flags. Glow layers are named
 * 'glow:<hex>' (materials.glow of that colour) and never cast shadows.
 */
export const LAYERS = {
  paint: { mat: vcMat, cast: true, receive: true },
  detail: { mat: vcMat, cast: false, receive: true },
  wood: { mat: vcWood, cast: true, receive: true, uv: true },
  woodDetail: { mat: vcWood, cast: false, receive: true, uv: true },
  plant: { mat: () => vcWind(0.06, 0.05), cast: false, receive: true },
  plantCast: { mat: () => vcWind(0.06, 0.05), cast: true, receive: true },
};

function layerDef(name) {
  if (LAYERS[name]) return LAYERS[name];
  if (name.startsWith('glow:')) {
    const [, color, day, night] = name.split(':');
    return {
      mat: () => materials.glow(color, { day: day ? +day : 0.35, night: night ? +night : 1.8 }),
      cast: false,
      receive: false,
    };
  }
  throw new Error(`unknown props layer ${name}`);
}

// ── transforms ───────────────────────────────────────────────────────────────
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Bake a transform into a geometry (in place) and return it.
 * p: [x,y,z]   r: [rx,ry,rz] Euler XYZ (radians)   s: number | [sx,sy,sz]
 */
export function xf(geo, p = null, r = null, s = null) {
  _p.set(0, 0, 0);
  if (p) _p.set(p[0], p[1], p[2]);
  _e.set(0, 0, 0);
  if (r) _e.set(r[0], r[1], r[2], r[3] || 'XYZ');
  _q.setFromEuler(_e);
  if (s == null) _s.set(1, 1, 1);
  else if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  _m.compose(_p, _q, _s);
  geo.applyMatrix4(_m);
  return geo;
}

/** Apply an arbitrary Matrix4 (e.g. from an Object3D) and return the geometry. */
export function xfm(geo, matrix) {
  geo.applyMatrix4(matrix);
  return geo;
}

/** Orient a geometry built along +Y so it points along `dir` and sits at `pos`. */
const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
export function alignY(geo, pos, dir) {
  _d.set(dir[0], dir[1], dir[2]).normalize();
  _q.setFromUnitVectors(_up, _d);
  _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(1, 1, 1));
  geo.applyMatrix4(_m);
  return geo;
}

/** A cylinder between two points (radius r1 at a, r2 at b). */
export function strut(a, b, r1, r2 = r1, radial = 6) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const g = new THREE.CylinderGeometry(r2, r1, len, radial, 1);
  g.translate(0, len / 2, 0);
  return alignY(g, a, [dx, dy, dz]);
}

// ── vertex colours & normals ─────────────────────────────────────────────────
/** Fill a geometry's colour attribute with one colour. */
export function paint(geo, color) {
  _c.set(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Per-vertex colour from a function fn(x, y, z, nx, ny, nz, i, outColor). */
export function paintFn(geo, fn) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    _c.setRGB(1, 1, 1);
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), nor ? nor.getX(i) : 0, nor ? nor.getY(i) : 1, nor ? nor.getZ(i) : 0, i, _c);
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * Weld a geometry (drops uv) and recompute smooth normals — removes the shading
 * seams of lathes / spheres after their vertices were deformed.
 */
export function smooth(geo) {
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const g = mergeVertices(geo, 1e-4);
  g.computeVertexNormals();
  geo.dispose();
  return g;
}

/** Flip a geometry inside-out (reverse winding + normals), e.g. to see a tube from inside. */
export function invert(geo) {
  if (!geo.index) {
    const n = geo.attributes.position.count;
    const idx = [];
    for (let i = 0; i < n; i++) idx.push(i);
    geo.setIndex(idx);
  }
  const idx = geo.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  geo.index.needsUpdate = true;
  const nor = geo.attributes.normal;
  if (nor) for (let i = 0; i < nor.array.length; i++) nor.array[i] = -nor.array[i];
  return geo;
}

/** Displace every vertex: fn(v: Vector3) mutates v in place. Returns geo. */
const _v = new THREE.Vector3();
export function deform(geo, fn) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    fn(_v, i);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  pos.needsUpdate = true;
  return geo;
}

/**
 * Planar wood-grain UVs in the part's own space so the grain runs along `along`
 * ('x' | 'y' | 'z') with the same density regardless of part size.
 */
export function grainUV(geo, along = 'y', scale = 0.55, offset = 0) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const A = { x: 0, y: 1, z: 2 }[along];
  const uv = new Float32Array(pos.count * 2);
  const p = [0, 0, 0], n = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    p[0] = pos.getX(i); p[1] = pos.getY(i); p[2] = pos.getZ(i);
    n[0] = Math.abs(nor.getX(i)); n[1] = Math.abs(nor.getY(i)); n[2] = Math.abs(nor.getZ(i));
    // dominant normal axis decides which coordinate runs across the grain
    let dom = 0;
    if (n[1] > n[dom]) dom = 1;
    if (n[2] > n[dom]) dom = 2;
    let across;
    if (dom === A) across = (A + 1) % 3; // end grain: anything
    else across = 3 - A - dom;
    uv[i * 2] = p[across] * scale * 1.6 + offset;
    uv[i * 2 + 1] = p[A] * scale * 0.35 + offset * 0.37;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// ── merging ──────────────────────────────────────────────────────────────────
function normalise(geo, keepUv) {
  if (geo.index === null) {
    const n = geo.attributes.position.count;
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  for (const name of Object.keys(geo.attributes)) {
    if (name === 'position' || name === 'normal' || name === 'color') continue;
    if (name === 'uv' && keepUv) continue;
    geo.deleteAttribute(name);
  }
  if (keepUv && !geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  geo.morphAttributes = {};
  geo.clearGroups();
  return geo;
}

/** Collects coloured parts per layer and merges them. */
export class Parts {
  constructor() {
    this.layers = new Map();
  }
  /**
   * Add a part. `color` may be a colour or null when the geometry already has a
   * colour attribute (paintFn). The geometry is consumed.
   */
  add(layer, geo, color = null) {
    const def = layerDef(layer);
    if (color !== null && color !== undefined) paint(geo, color);
    else if (!geo.attributes.color) paint(geo, '#ffffff');
    normalise(geo, !!def.uv);
    if (!this.layers.has(layer)) this.layers.set(layer, []);
    this.layers.get(layer).push(geo);
    return this;
  }
  /** Merge every layer → { layerName: BufferGeometry } (input parts are disposed). */
  finish() {
    const out = {};
    for (const [layer, list] of this.layers) {
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!g) throw new Error(`props: merge failed for layer ${layer}`);
      if (list.length > 1) list.forEach((x) => x.dispose());
      g.computeBoundingSphere();
      g.computeBoundingBox();
      out[layer] = g;
    }
    this.layers.clear();
    return out;
  }
}

/** Meshes for a finished layer map (shared geometries, cached materials). */
export function meshesFor(geos, { cast = null, name = '' } = {}) {
  const list = [];
  for (const layer of Object.keys(geos)) {
    const def = layerDef(layer);
    const m = new THREE.Mesh(geos[layer], def.mat());
    m.castShadow = cast === null ? def.cast : cast && def.cast;
    m.receiveShadow = def.receive;
    m.name = name ? `${name}:${layer}` : layer;
    m.matrixAutoUpdate = false; // static by default — they never move inside their group
    list.push(m);
  }
  return list;
}

/** Group holding all layer meshes of a finished part map. */
export function groupFor(geos, opts = {}) {
  const g = new THREE.Group();
  for (const m of meshesFor(geos, opts)) g.add(m);
  return g;
}

/** Count triangles of a layer map (debug / budgets). */
export function triCount(geos) {
  let n = 0;
  for (const g of Object.values(geos)) n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  return n;
}

// ── handy shapes ─────────────────────────────────────────────────────────────
/** Lathe from [[r, y], …] points, `seg` radial segments, welded & smooth. */
export function lathe(points, seg = 24, phiStart = 0, phiLength = Math.PI * 2) {
  const pts = points.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
  return new THREE.LatheGeometry(pts, seg, phiStart, phiLength);
}

/**
 * Seamless surface of revolution (like LatheGeometry but welded at the seam and
 * with single-vertex poles, so deformed shapes shade without seams).
 * points: [[r, y], …] from top/bottom to the other end; r≈0 rows become poles.
 * deform(v: Vector3, row, phi) may displace each vertex. φ=0 points to +Z.
 */
export function revolve(points, cols = 24, deform = null) {
  const pos = [];
  const index = [];
  const rows = [];
  const v = new THREE.Vector3();
  points.forEach(([r, y], ri) => {
    const pole = r < 1e-4;
    const start = pos.length / 3;
    const n = pole ? 1 : cols;
    for (let c = 0; c < n; c++) {
      const phi = (c / cols) * Math.PI * 2;
      v.set(Math.sin(phi) * r, y, Math.cos(phi) * r);
      if (deform) deform(v, ri, phi);
      pos.push(v.x, v.y, v.z);
    }
    rows.push({ start, pole });
  });
  for (let ri = 0; ri < rows.length - 1; ri++) {
    const a = rows[ri], b = rows[ri + 1];
    for (let c = 0; c < cols; c++) {
      const c1 = (c + 1) % cols;
      const a0 = a.pole ? a.start : a.start + c;
      const a1 = a.pole ? a.start : a.start + c1;
      const b0 = b.pole ? b.start : b.start + c;
      const b1 = b.pole ? b.start : b.start + c1;
      // winding so normals point outwards when the profile runs top → bottom
      if (!a.pole) index.push(a0, b0, a1);
      if (!b.pole) index.push(a1, b0, b1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A torus arc (smile, handles …) lying in the XY plane. */
export function arc(radius, tube, angle, radial = 4, tubular = 10, start = 0) {
  const g = new THREE.TorusGeometry(radius, tube, radial, tubular, angle);
  if (start) g.rotateZ(start);
  return g;
}

/** Rounded little blob: a low-poly sphere squashed by s. */
export function blob(r, s = [1, 1, 1], w = 8, h = 6) {
  const g = new THREE.SphereGeometry(r, w, h);
  g.scale(s[0], s[1], s[2]);
  return g;
}

/** Catenary-ish sag curve between two points (for ropes, bunting, chains). */
export function sagCurve(a, b, sag, segments = 12) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    pts.push(
      new THREE.Vector3(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t),
        a.z + (b.z - a.z) * t
      )
    );
  }
  return new THREE.CatmullRomCurve3(pts);
}

/** Read a value from opts with a fallback when undefined (null is respected). */
export const opt = (o, k, d) => (o[k] === undefined ? d : o[k]);

/** Colour helpers (sRGB hex in, hex out). */
export function shade(hex, amount) {
  _c.set(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  _c.getHSL(hsl);
  _c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + amount, 0, 1));
  return '#' + _c.getHexString();
}
export function mix(a, b, t) {
  _c.set(a);
  const c2 = new THREE.Color(b);
  _c.lerp(c2, t);
  return '#' + _c.getHexString();
}

/** Never-raycastable helper (glows, smoke, particles shouldn't block clicks). */
export function noRaycast(o) {
  o.raycast = () => {};
  return o;
}
