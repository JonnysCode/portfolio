// ─────────────────────────────────────────────────────────────────────────────
// Riverside kit — shared materials, batching and geometry helpers for the
// stream, the waterfall, the stone bridge and the Velowerkstatt.
//
// Everything is built from hundreds of small hand-made parts (stones,
// pebbles, planks, fronds, reeds …). Each part is baked (transform, UVs and a
// vertex colour) and merged PER MATERIAL by a Batch, so the whole riverside
// costs a few dozen draw calls. Most materials are vertex-coloured painterly
// surfaces: the texture brings the detail, the vertex colour brings the hue,
// so every stone tint merges into ONE draw call per surface kind.
//
//   const B = new Batch();
//   B.add(M().stone, blockStone(rng, 0.4, 0.2, 0.3), { color: '#a49c8c' });
//   B.build(group, 'bridge');
//
// Conventions: Y up, things face +Z, φ (phi) is an azimuth around Y with
// φ = 0 → +Z and φ = π/2 → +X (x = sin φ · r, z = cos φ · r).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { materials, sharedUniforms } from '../../core/materials.js';
import { createNoise2D } from '../../core/noise.js';
import { haloColor } from '../../props/glow.js';
import { mats as cottageMats } from '../cottage/kit.js';

export const TAU = Math.PI * 2;
export const noiseA = createNoise2D(5113);
export const noiseB = createNoise2D(80021);

// ─── level of detail ─────────────────────────────────────────────────────────
/**
 * Geometry detail for the quality tier (high 1, medium 0.6, low 0.4), set once
 * at the start of the riverside build: stones, cushions, moss, boulders,
 * ivy stems and heightfields scale their subdivision by it. (Builds are
 * synchronous, so a module-level value is safe.)
 */
export const LOD = { k: 1, tier: 'high', shadows: true };
export function setDetail(tier = 'high', { shadows = true } = {}) {
  LOD.tier = tier;
  LOD.k = tier === 'low' ? 0.4 : tier === 'medium' ? 0.6 : 1;
  LOD.shadows = shadows;
  return LOD.k;
}
/** A segment count scaled by the tier's detail (never below `min`). */
export const segs = (n, min = 3) => Math.max(min, Math.round(n * LOD.k));
/** An icosahedron subdivision level stepped down on the lower tiers (never below `min`). */
export const icoDetail = (d, min = 1) => Math.max(min, d - (LOD.k < 0.5 ? 2 : LOD.k < 0.8 ? 1 : 0));

/** Stone tints (sRGB) for dressed stones and boulders: warm greys, ochres, a few cool ones. */
export const STONE_TINTS = ['#b7aa92', '#a89f8e', '#9d968a', '#b9a07a', '#8f887c', '#c2b294', '#949691', '#a8977a', '#857f75'];
/** Cooler, darker river stones (wet). */
export const PEBBLE_TINTS = ['#7d7a72', '#6e6a62', '#8a857a', '#5f5d58', '#9a9180', '#746b5e'];
export const WOOD = {
  oak: '#a8845a',
  oakLight: '#c29d6c',
  walnut: '#5e4433',
  spruce: '#cbb088',
  weathered: '#8a7766',
  grey: '#958a7c',
  dark: '#4a3628',
  door: '#7a5236',
  green: '#5f7a5a',
};
export const IRON = '#3a3530';

// ─── materials ───────────────────────────────────────────────────────────────
let MATS = null;
let NEVER_CAST = new Set();
let ALWAYS_CAST = new Set();
let VARIED = new Set();
/**
 * The riverside's shared materials (cached in core/materials.js — never mutate).
 * Vertex-coloured kinds take their hue from Batch.add(…, { color }).
 */
export function M() {
  if (MATS) return MATS;
  const m = materials;
  MATS = {
    rock: m.surface('rock', { vertexColors: true, mossy: 0.5 }),
    pebble: m.surface('rock', { vertexColors: true, scale: 0.6, bump: 0.6, mossy: 0.06 }),
    // masonry: the rock texture at stone scale (a tile ≈ 2 units: grain, pits, fine
    // cracks and lichen on every stone), moss creeping over the stones' tops
    wallStone: m.surface('rock', { vertexColors: true, scale: 0.4, bump: 1.3, mossy: 0.3 }),
    wood: m.surface('wood', { species: 'oak', vertexColors: true }),
    planks: m.surface('wood', { species: 'oak', planks: true, vertexColors: true }),
    timber: m.surface('timber', { vertexColors: true }),
    metal: m.surface('metal', { vertexColors: true }),
    // the cottages' painterly cap skin (fine fibril streaks, velvet bloom; UVs:
    // U = around × 2, V = rim → apex) for the Velowerkstatt and every toadstool,
    // and their torn cream veil flakes (shared cached materials, never mutated)
    cap: cottageMats().cap,
    warts: cottageMats().warts,
    gills: m.surface('gills', { side: THREE.DoubleSide, vertexColors: true }),
    stem: m.surface('mushroomStem', { vertexColors: true }),
    plaster: m.surface('plaster', { vertexColors: true }),
    moss: m.surface('moss', { vertexColors: true }),
    soil: m.surface('soil', { vertexColors: true }),
    fabric: m.surface('fabric', { vertexColors: true }),
    rope: m.surface('rope'),
    leafy: m.surface('leaf', { vertexColors: true, side: THREE.DoubleSide }),
    vc: m.standard('#ffffff', { vertexColors: true, roughness: 0.75 }),
    glossy: m.standard('#ffffff', { vertexColors: true, roughness: 0.3, metalness: 0.05 }),
    chrome: m.standard('#d9dde0', { metalness: 0.9, roughness: 0.28 }),
    rubber: m.standard('#26221f', { roughness: 0.85 }),
    glow: m.glow('#ffc477', { day: 0.55, night: 2.3 }),
    lamp: m.glow('#ffd9a0', { day: 1.1, night: 2.8 }),
    bulb: m.glow('#ffe2a6', { day: 0.9, night: 3.2 }),
    glowBlue: m.glow('#86e6d6', { day: 0.3, night: 2.4 }),
    // fairy-light bulbs: amber (the halo colour of '#ffb35c'), gentler than the lamps
    fairy: m.glow(`#${haloColor('#ffb35c').getHexString()}`, { day: 0.45, night: 1.9 }),
    fern: m.foliage({ variant: 'fern', wind: { strength: 0.03, base: 0, speed: 1.5 } }),
    grass: m.foliage({ variant: 'grass', wind: { strength: 0.05, base: 0, speed: 1.8 } }),
    ivy: m.foliage({ variant: 'ivy', wind: { strength: 0.006, base: 0, speed: 1.3 } }),
    reed: m.foliage({ variant: 'grass', color: '#7d9a48', wind: { strength: 0.06, base: 0, speed: 1.9 } }),
    lily: lilyMaterial(),
  };
  // dressed stones share the wall material (one draw call for all masonry); a few
  // near-duplicates are folded together to keep the riverside's mesh count low
  MATS.stone = MATS.wallStone;
  MATS.lamp = MATS.bulb;
  MATS.fabric = MATS.vc;
  MATS.stem = MATS.vc;
  // small-part materials never cast shadows (keeps the shadow pass and the mesh count down);
  // the gills do (double-sided) — they close a cap's shell so its shadow is solid
  NEVER_CAST = new Set([MATS.lily, MATS.fairy, MATS.moss, MATS.soil, MATS.stem, MATS.plaster, MATS.planks, MATS.fabric, MATS.rope, MATS.leafy, MATS.lamp, MATS.bulb, MATS.glowBlue, MATS.fern, MATS.grass, MATS.ivy, MATS.reed, MATS.pebble, MATS.metal]);
  ALWAYS_CAST = new Set([MATS.cap, MATS.rock]);
  // stones get per-vertex shading variation (grimy undersides, mottling)
  VARIED = new Set([MATS.wallStone, MATS.rock, MATS.pebble]);
  return MATS;
}

/**
 * Water-lily blossoms: vertex-coloured petals that glow softly at night (a
 * lilac-white emissive tinted by each petal's own colour, following the shared
 * night uniform — no per-frame work).
 */
function lilyMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.55, emissive: '#e6dcff', emissiveIntensity: 1 });
  mat.name = 'riverside-lily';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLilyNight = sharedUniforms.uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLilyNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = emissive * mix(vec3(1.0), vColor.rgb, 0.45) * 0.32 * uLilyNight;');
  };
  mat.customProgramCacheKey = () => 'riverside-lily';
  return mat;
}

// ─── vertex colours ─────────────────────────────────────────────────────────
const _c = new THREE.Color();

/** Fill a geometry's colour attribute with one colour (sRGB hex → linear). */
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

/** Per-vertex colour from fn(x, y, z, i, outColor) — outColor starts as `base`. */
export function paintFn(geo, base, fn) {
  const pos = geo.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  const b = new THREE.Color(base);
  for (let i = 0; i < pos.count; i++) {
    _c.copy(b);
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), i, _c);
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * A stone's colour with life in it: darker towards its underside (grime and
 * contact shadow), a soft noisy mottling and a hint of green damp low down.
 */
export function paintStone(geo, color) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const h = Math.max(1e-4, bb.max.y - bb.min.y);
  const base = new THREE.Color(color);
  const damp = new THREE.Color('#5f6a45');
  return paintFn(geo, base, (x, y, z, i, c) => {
    const t = (y - bb.min.y) / h;
    const n = noiseA(x * 7.3 + z * 3.1, y * 7.3 - z * 2.3);
    c.multiplyScalar(0.8 + 0.2 * smooth01(t * 1.6) + 0.08 * n);
    c.lerp(damp, 0.12 * (1 - smooth01(t * 2.5)));
  });
}

/** Make a geometry mergeable: indexed, normal + uv (+ colour), no groups/morphs. */
export function prepare(geo, withColor) {
  if (geo.index === null) {
    const n = geo.attributes.position.count;
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  for (const name of Object.keys(geo.attributes)) {
    if (name === 'position' || name === 'normal' || name === 'uv') continue;
    if (name === 'color' && withColor) continue;
    geo.deleteAttribute(name);
  }
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  if (withColor && !geo.attributes.color) paint(geo, '#ffffff');
  geo.morphAttributes = {};
  geo.clearGroups();
  return geo;
}

// ─── batching ────────────────────────────────────────────────────────────────
/** Collects geometry per material and merges it into one mesh per material. */
export class Batch {
  constructor(name = 'riverside') {
    this.name = name;
    this.lists = new Map();
    this.tris = 0;
  }
  /** Add a geometry (consumed). opts: { cast = true, receive = true, color (vertex-coloured materials) } */
  add(material, geo, opts = {}) {
    const cast = NEVER_CAST.has(material) ? false : ALWAYS_CAST.has(material) ? true : opts.cast ?? true;
    const receive = opts.receive ?? true;
    const vc = !!material.vertexColors;
    if (vc && opts.color !== undefined && opts.color !== null) {
      if (VARIED.has(material) && opts.vary !== false) paintStone(geo, opts.color);
      else paint(geo, opts.color);
    }
    prepare(geo, vc);
    // ONE mesh per material: if any part casts, the merged mesh casts (a few
    // extra triangles in the shadow pass are cheaper than a second draw call)
    const key = `${material.uuid}|${receive ? 1 : 0}`;
    let e = this.lists.get(key);
    if (!e) {
      e = { material, cast, receive, geos: [] };
      this.lists.set(key, e);
    }
    e.cast ||= cast;
    e.geos.push(geo);
    return geo;
  }
  /** Triangles collected so far, per material name (perf bookkeeping). */
  tally() {
    const out = {};
    for (const e of this.lists.values()) {
      let n = 0;
      for (const g of e.geos) n += (g.index ? g.index.count : g.attributes.position.count) / 3;
      // (named after the riverside material key when there is one: 'vc', 'glossy' …)
      let k = e.material.name || 'mat';
      if (MATS) for (const [key, m] of Object.entries(MATS)) if (m === e.material) k = key;
      out[k] = (out[k] ?? 0) + n;
    }
    return out;
  }
  /** A view of this batch that applies `matrix` to every added geometry. */
  at(matrix) {
    const parent = this;
    const m = matrix.clone();
    return {
      matrix: m,
      add(material, geo, opts = {}) {
        geo.applyMatrix4(m);
        return parent.add(material, geo, opts);
      },
      at(child) {
        return parent.at(m.clone().multiply(child));
      },
      batch: parent,
    };
  }
  /** Merge everything into meshes added to `parent`. Returns the meshes. */
  build(parent, name = this.name) {
    const out = [];
    for (const e of this.lists.values()) {
      const g = e.geos.length === 1 ? e.geos[0] : mergeGeometries(e.geos, false);
      if (!g) {
        console.warn(`[riverside] merge failed for ${e.material.name}`);
        continue;
      }
      if (e.geos.length > 1) e.geos.forEach((x) => x.dispose());
      g.computeBoundingSphere();
      g.computeBoundingBox();
      this.tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      const mesh = new THREE.Mesh(g, e.material);
      mesh.name = `${name}:${e.material.name || 'mat'}`;
      mesh.castShadow = e.cast;
      mesh.receiveShadow = e.receive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      out.push(mesh);
    }
    this.lists.clear();
    return out;
  }
}

/** The identity frame — handy default for Batch.at(). */
export const IDENTITY = new THREE.Matrix4();

// ─── transforms ──────────────────────────────────────────────────────────────
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Matrix from position [x,y,z], Euler rotation [rx,ry,rz(,order)] and scale (number | [sx,sy,sz]). */
export function mat4(p = null, r = null, s = null, target = new THREE.Matrix4()) {
  _p.set(0, 0, 0);
  if (p) _p.set(p[0], p[1], p[2]);
  _e.set(0, 0, 0, 'XYZ');
  if (r) _e.set(r[0], r[1], r[2], r[3] || 'XYZ');
  _q.setFromEuler(_e);
  if (s == null) _s.set(1, 1, 1);
  else if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  return target.compose(_p, _q, _s);
}

/** Bake a transform into a geometry (in place). */
export function xf(geo, p = null, r = null, s = null) {
  geo.applyMatrix4(mat4(p, r, s, _m));
  return geo;
}

/** Displace every vertex: fn(v: Vector3, i) mutates v. Recomputes normals unless keepNormals. */
const _v = new THREE.Vector3();
export function deform(geo, fn, keepNormals = false) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    fn(_v, i);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  pos.needsUpdate = true;
  if (!keepNormals) geo.computeVertexNormals();
  return geo;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
/** Orient a geometry built along +X so it runs from a to b, centred between them (its +Y stays close to `up`). */
export function alongX(geo, a, b, up = [0, 1, 0]) {
  _a.set(a[0], a[1], a[2]);
  _b.set(b[0], b[1], b[2]);
  _x.subVectors(_b, _a).normalize();
  _y.set(up[0], up[1], up[2]);
  _z.crossVectors(_x, _y);
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).cross(_x);
  _z.normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  _m.setPosition(_a.lerp(_b, 0.5));
  geo.applyMatrix4(_m);
  return geo;
}

/** A frame whose +Z is `fwd` (projected horizontal), +Y up, origin at (x, y, z). */
export function frameXZ(x, y, z, rotY) {
  return new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
}

// ─── UVs ─────────────────────────────────────────────────────────────────────
const AX = { x: 0, y: 1, z: 2 };
/**
 * Planar "box" UVs in the part's own space × scale, so a texture keeps the
 * same density on every part. U (wood grain) runs along `along`.
 */
export function uvBox(geo, along = 'x', scale = 1 / 1.4, off = [0, 0]) {
  const pos = geo.attributes.position;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nor = geo.attributes.normal;
  const A = AX[along];
  const uv = new Float32Array(pos.count * 2);
  const p = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    p[0] = pos.getX(i);
    p[1] = pos.getY(i);
    p[2] = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let dom = 0;
    if (ny > nx && ny >= nz) dom = 1;
    else if (nz > nx && nz > ny) dom = 2;
    let u, v;
    if (dom === A) {
      u = p[(A + 1) % 3];
      v = p[(A + 2) % 3];
    } else {
      u = p[A];
      v = p[3 - A - dom];
    }
    uv[i * 2] = u * scale + off[0];
    uv[i * 2 + 1] = v * scale + off[1];
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Planar UVs from two axes (e.g. a flat panel facing +Z: 'x','y'). */
export function uvPlanar(geo, ua = 'x', va = 'y', scale = 1, off = [0, 0]) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const U = AX[ua], V = AX[va];
  const p = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    p[0] = pos.getX(i);
    p[1] = pos.getY(i);
    p[2] = pos.getZ(i);
    uv[i * 2] = p[U] * scale + off[0];
    uv[i * 2 + 1] = p[V] * scale + off[1];
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// ─── parametric surfaces ─────────────────────────────────────────────────────
/**
 * A grid surface P(u, v) for u, v ∈ [0, 1] (fn writes into its Vector3 out).
 * Outward normal = dP/dv × dP/du — for a surface of revolution with
 * u = φ (x = sin φ·r, z = cos φ·r) v runs from the top / inner end towards
 * the bottom / outer end. opts: uv(u, v, p) → [U, V], flip.
 */
export function paramSurface(fn, nu, nv, { uv = null, flip = false } = {}) {
  const cols = nu + 1, rows = nv + 1;
  const pos = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const p = new THREE.Vector3();
  for (let j = 0; j < rows; j++) {
    const v = j / nv;
    for (let i = 0; i < cols; i++) {
      const u = i / nu;
      fn(u, v, p);
      const k = j * cols + i;
      pos[k * 3] = p.x;
      pos[k * 3 + 1] = p.y;
      pos[k * 3 + 2] = p.z;
      const t = uv ? uv(u, v, p) : [u, v];
      uvs[k * 2] = t[0];
      uvs[k * 2 + 1] = t[1];
    }
  }
  const idx = new (cols * rows > 65535 ? Uint32Array : Uint16Array)(nu * nv * 6);
  let n = 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      if (!flip) {
        idx[n++] = a; idx[n++] = c; idx[n++] = b;
        idx[n++] = b; idx[n++] = c; idx[n++] = d;
      } else {
        idx[n++] = a; idx[n++] = b; idx[n++] = c;
        idx[n++] = b; idx[n++] = d; idx[n++] = c;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

// ─── shapes ──────────────────────────────────────────────────────────────────
/** A chamfered beam along X (length len, height h along Y, width w along Z), `segs` length segments. */
export function beamGeo(len, h, w, c = 0.01, segs = 1) {
  const cc = Math.max(0.0005, Math.min(c, h * 0.3, w * 0.3));
  const hh = h / 2, hw = w / 2;
  const sec = [
    [-hh + cc, -hw], [hh - cc, -hw], [hh, -hw + cc], [hh, hw - cc],
    [hh - cc, hw], [-hh + cc, hw], [-hh, hw - cc], [-hh, -hw + cc],
  ];
  const pos = [];
  const nor = [];
  const idx = [];
  const n = sec.length;
  for (let f = 0; f < n; f++) {
    const a = sec[f], b = sec[(f + 1) % n];
    const ny = b[1] - a[1], nz = -(b[0] - a[0]);
    const nl = Math.hypot(ny, nz) || 1;
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const x = -len / 2 + (len * i) / segs;
      pos.push(x, a[0], a[1], x, b[0], b[1]);
      nor.push(0, ny / nl, nz / nl, 0, ny / nl, nz / nl);
    }
    for (let i = 0; i < segs; i++) {
      const k = base + i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  for (const sx of [-1, 1]) {
    const base = pos.length / 3;
    for (const [y, z] of sec) {
      pos.push((sx * len) / 2, y, z);
      nor.push(sx, 0, 0);
    }
    for (let i = 1; i < n - 1; i++) {
      if (sx > 0) idx.push(base, base + i, base + i + 1);
      else idx.push(base, base + i + 1, base + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** A wooden part (w × h × d like a BoxGeometry) with chamfered edges and grain UVs along `along`. */
export function board(w, h, d, { along = 'x', c = 0.008, rng = null, segs = 0 } = {}) {
  const len = along === 'x' ? w : along === 'y' ? h : d;
  const s = segs || Math.max(1, Math.round(len / 0.6));
  let g;
  if (along === 'x') g = beamGeo(w, h, d, c, s);
  else if (along === 'y') g = beamGeo(h, w, d, c, s).rotateZ(Math.PI / 2);
  else g = beamGeo(d, h, w, c, s).rotateY(-Math.PI / 2);
  return uvBox(g, along, 1 / 1.4, rng ? [rng.next() * 7, rng.next() * 7] : [0, 0]);
}

/** A board between two points (section w × h), slightly bowed when rng is given. */
export function boardBetween(a, b, w, h, { rng = null, up = [0, 1, 0], bow = 0.01, c = 0.008 } = {}) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const segs = Math.max(1, Math.round(len / 0.4));
  const g = beamGeo(len, h, w, c, segs);
  if (rng && bow > 0) {
    const k1 = rng.jitter(1), k2 = rng.jitter(1);
    deform(g, (v) => {
      const t = v.x / len + 0.5;
      const s = Math.sin(t * Math.PI);
      v.y += s * bow * k1;
      v.z += s * bow * k2;
    });
  }
  uvBox(g, 'x', 1 / 1.4, rng ? [rng.next() * 7, rng.next() * 7] : [0, 0]);
  return alongX(g, a, b, up);
}

/** A cylinder between two points (radius r1 at a, r2 at b); `open` drops the end caps. */
export function rod(a, b, r1, r2 = r1, radial = 6, open = false) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const g = new THREE.CylinderGeometry(r2, r1, len, radial, 1, open);
  g.rotateZ(-Math.PI / 2); // along +X, r1 at −X
  uvBox(g, 'x', 2);
  return alongX(g, a, b);
}

/** A lumpy stone (flattened noisy icosphere). opts: { r, sx, sy, sz, lump, detail, flatTop, flatBottom } */
export function stoneGeo(rng, { r = 0.2, sx = 1, sy = 0.6, sz = 1, lump = 0.22, detail = 1, flatTop = 0.55, flatBottom = -0.6, uvScale = 1.6, sphere = null } = {}) {
  // (lower tiers: a 6 × 4 sphere — 36 triangles — instead of a once-subdivided icosahedron's 80)
  if (!sphere && detail === 1 && LOD.k < 1) sphere = [6, 4];
  // (sphere: [widthSegments, heightSegments] — a cheaper tessellation than icosahedron detail 2)
  let g = sphere ? new THREE.SphereGeometry(1, segs(sphere[0], 6), segs(sphere[1], 4)) : new THREE.IcosahedronGeometry(1, detail >= 2 ? icoDetail(detail) : detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const ox = rng.next() * 50, oy = rng.next() * 50;
  deform(g, (v) => {
    const n = noiseA(v.x * 1.3 + ox, v.y * 1.3 + v.z * 0.7 + oy) * 0.6 + noiseB(v.z * 2.6 + oy, v.x * 2.6 - ox) * 0.4;
    v.multiplyScalar(1 + n * lump);
    if (v.y > flatTop) v.y = flatTop + (v.y - flatTop) * 0.35;
    if (v.y < flatBottom) v.y = flatBottom + (v.y - flatBottom) * 0.3;
    v.set(v.x * r * sx, v.y * r * sy, v.z * r * sz);
  });
  uvBox(g, 'x', uvScale, [rng.next() * 9, rng.next() * 9]);
  return g;
}

/**
 * A dressed block stone, size w × h × d: flat-ish faces with softly rounded
 * edges (a rounded box) and a little hand-hewn unevenness — reads as a stone,
 * not a pillow.
 */
export function blockStone(rng, w, h, d, lump = 0.12) {
  const m = Math.min(w, h, d);
  const g = new RoundedBoxGeometry(w, h, d, 1, m * 0.22);
  g.deleteAttribute('uv');
  const ox = rng.next() * 50, oy = rng.next() * 50;
  const k = lump * 0.5;
  deform(g, (v) => {
    v.x += noiseA(v.y * 5 + ox, v.z * 5) * m * k;
    v.y += noiseB(v.x * 5 + oy, v.z * 5) * m * k * 0.7;
    v.z += noiseA(v.x * 5 - ox, v.y * 5 + oy) * m * k;
    // a slightly sagging, uneven top
    v.y -= (v.x / w) * (v.x / w) * h * lump * 0.4;
  });
  uvBox(g, 'x', 1.6, [rng.next() * 9, rng.next() * 9]);
  return g;
}

/**
 * A big layered boulder (sedimentary slab): a lumpy box-ish blob with soft
 * horizontal strata ledges. Size w × h × d, centred on its base (y = 0 bottom).
 */
export function boulderGeo(rng, w, h, d, { strata = 3, lump = 0.18, detail = 3, round = 0.55 } = {}) {
  let g = new THREE.IcosahedronGeometry(1, icoDetail(detail, detail >= 3 && LOD.k >= 0.5 ? 2 : 1));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const ox = rng.next() * 60, oy = rng.next() * 60;
  const ph = rng.next() * 6;
  deform(g, (v) => {
    // squarish blob: push towards a rounded box
    const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
    const mx = Math.max(ax, ay, az) || 1;
    const k = 1 + (1 / mx - 1) * (1 - round);
    v.multiplyScalar(k);
    // strata: horizontal terraces with an overhanging lip
    const yy = v.y * 0.5 + 0.5;
    const layer = yy * strata + ph;
    const f = layer - Math.floor(layer);
    const ledge = (f < 0.18 ? -0.09 * (1 - f / 0.18) : 0) + 0.04 * Math.sin(layer * 6.28);
    const n = noiseA(v.x * 1.2 + ox, v.z * 1.2 + oy) * 0.6 + noiseB(v.x * 3.1 - oy, v.y * 3.1 + v.z * 2.2 + ox) * 0.4;
    const sideways = 1 + n * lump + (ay < 0.85 ? ledge : 0);
    v.x *= sideways;
    v.z *= sideways;
    v.y += noiseB(v.x * 1.7 + ox, v.z * 1.7) * lump * 0.5;
    // flatter tops, sit flat on the bottom
    if (v.y > 0.7) v.y = 0.7 + (v.y - 0.7) * 0.4;
    if (v.y < -0.8) v.y = -0.8;
    v.set(v.x * w * 0.5, (v.y + 0.8) / 1.5 * h, v.z * d * 0.5);
  });
  uvBox(g, 'x', 0.5, [rng.next() * 9, rng.next() * 9]);
  return g;
}

// ─── masonry ────────────────────────────────────────────────────────────────
/** Rubble & fieldstone tints (sRGB): weathered greys, warm ochres, cool blue-greys — wide in value. */
export const MASONRY_TINTS = ['#a1978a', '#938c80', '#ab9c84', '#868278', '#9a8e79', '#b4a68b', '#8d897f', '#a09684', '#827e72', '#ad9f8a', '#909488', '#a69a82'];
/** Dressed sandstone (arch rings, quoins, sills): warmer and a touch lighter, still varied. */
export const DRESSED_TINTS = ['#c2ad88', '#b39e7b', '#cab596', '#a99679', '#bba47f', '#cfb995', '#b3aa94'];
/** Mortar joints: dark, damp and a little mossy (drawn with the moss surface). */
export const MORTAR = '#48463a';

const _ca = new THREE.Color();
const _cb = new THREE.Color();
/** A stone's colour with life in it: per-stone value, now and then lichen-green or iron-stained. */
export function stoneTint(rng, tints = MASONRY_TINTS, spread = 1) {
  _ca.set(rng.pick(tints)).multiplyScalar(1 + rng.range(-0.3, 0.16) * spread);
  const k = rng.next();
  if (k < 0.14) _ca.lerp(_cb.set('#76845e'), 0.32); // lichen-stained
  else if (k < 0.26) _ca.lerp(_cb.set('#b0855a'), 0.24); // iron-stained ochre
  else if (k < 0.36) _ca.lerp(_cb.set('#7d8590'), 0.2); // cool blue-grey
  return '#' + _ca.getHexString();
}

/**
 * The visible face of a rough wall stone: an irregular rounded cushion bulging
 * out of the mortar along +Z. Its outline is a noisy rounded rectangle w × h
 * (centred on the origin), its crown `proud` in front of z = 0 and its rim
 * tucked `tuck` behind that plane (into the mortar). Vertex-coloured: `color`
 * × a lit crown and a dark, grimy rim, so every joint reads as a recessed,
 * shadowed line, plus a soft mottling. ≈ 5 · segs triangles (50 by default).
 */
export function cushionStone(rng, w, h, proud, { color = '#8a8273', segs: nSeg = 10, round = 3.2, lump = 0.1, tuck = 0.03, rim = 0.5 } = {}) {
  // (fewer outline points and one ring less on the lower tiers)
  const segs = LOD.k < 1 ? 6 : nSeg;
  const RINGS = LOD.k < 0.8 ? [[0.62, 1.0], [1.0, 0]] : [[0.52, 1.0], [0.86, 0.74], [1.0, 0]]; // [radius fraction, height fraction]
  const n = round * rng.range(0.75, 1.3);
  const ox = rng.next() * 50, oy = rng.next() * 50;
  const wob = [];
  for (let s = 0; s < segs; s++) wob.push(1 + rng.jitter(lump));
  const sw = wob.map((v, s) => (wob[(s + segs - 1) % segs] + 2 * v + wob[(s + 1) % segs]) / 4);
  const cx = rng.jitter(w * 0.1), cy = rng.jitter(h * 0.1) + h * 0.04; // off-centre crown, a touch high
  const crown = proud * rng.range(0.85, 1.12);
  const pos = [cx, cy, crown];
  const shade = [1.06];
  const rot = rng.next() * 0.6;
  for (const [rf, hf] of RINGS) {
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * TAU + rot;
      const ca = Math.cos(a), sa = Math.sin(a);
      const se = 1 / Math.pow(Math.pow(Math.abs(ca), n) + Math.pow(Math.abs(sa), n), 1 / n);
      const ex = ca * se * (w / 2) * sw[s], ey = sa * se * (h / 2) * sw[s];
      const x = cx + (ex - cx) * rf, y = cy + (ey - cy) * rf;
      const bump = noiseA(x * 9 + ox, y * 9 + oy) * crown * 0.3 * hf;
      pos.push(x, y, hf > 0 ? crown * hf + bump : -tuck);
      shade.push(hf > 0.9 ? 1.0 + 0.08 * noiseB(x * 7 + oy, y * 7) : hf > 0 ? 0.9 : rim);
    }
  }
  const idx = [];
  for (let s = 0; s < segs; s++) idx.push(0, 1 + s, 1 + ((s + 1) % segs));
  for (let r = 0; r < RINGS.length - 1; r++) {
    const b0 = 1 + r * segs, b1 = b0 + segs;
    for (let s = 0; s < segs; s++) {
      const a = b0 + s, b = b0 + ((s + 1) % segs), c = b1 + s, d = b1 + ((s + 1) % segs);
      idx.push(a, c, d, a, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const base = new THREE.Color(color);
  const col = new Float32Array(shade.length * 3);
  for (let i = 0; i < shade.length; i++) {
    const m = 1 + 0.12 * noiseA(pos[i * 3] * 6 + oy, pos[i * 3 + 1] * 6 - ox);
    col[i * 3] = base.r * shade[i] * m;
    col[i * 3 + 1] = base.g * shade[i] * m;
    col[i * 3 + 2] = base.b * shade[i] * m;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * A loose, all-round stone (parapets, capstones, quoins, piers, sills): a
 * lumpy rounded box w × h × d centred on the origin — squarish, but with
 * soft irregular edges and a slightly sagging top. Vertex-coloured like
 * cushionStone: dark grimy edges & underside (`under`), a lighter crown.
 * ≈ 80 triangles.
 */
export function roundStone(rng, w, h, d, { color = '#8a8273', box = 0.42, lump = 0.07, under = 0.4, segs: nSeg = 8, rows = 6, sag = 0.05 } = {}) {
  let g = new THREE.SphereGeometry(1, segs(nSeg, Math.min(6, nSeg)), segs(rows, Math.min(4, rows)));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const e = box * rng.range(0.85, 1.2);
  const ox = rng.next() * 50, oy = rng.next() * 50;
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color(color);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const ax = Math.abs(p.x), ay = Math.abs(p.y), az = Math.abs(p.z);
    // 1 on a face centre → ~0.33 on a corner: edges & corners get the grime
    const face = ax ** 4 + ay ** 4 + az ** 4;
    const k = 1 + lump * noiseA(p.x * 2.1 + ox, p.y * 2.1 + p.z * 1.3 + oy) + lump * 0.5 * noiseB(p.z * 4 + oy, p.x * 4);
    let x = Math.sign(p.x) * ax ** e * (w / 2) * k;
    let y = Math.sign(p.y) * ay ** e * (h / 2) * k;
    const z = Math.sign(p.z) * az ** e * (d / 2) * k;
    if (p.y > 0) y -= (x / (w / 2)) ** 2 * h * sag;
    pos.setXYZ(i, x, y, z);
    const lit = (0.58 + 0.42 * smooth01((face - 0.36) / 0.5)) * (1 - under * (1 - smooth01((p.y + 1) * 0.7)));
    const m = lit * (1 + 0.1 * noiseB(p.x * 3 + ox, p.y * 3 + p.z * 2));
    col[i * 3] = base.r * m;
    col[i * 3 + 1] = base.g * m;
    col[i * 3 + 2] = base.b * m;
  }
  g.computeVertexNormals();
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * A voussoir: a roundStone bent around the arch centre (origin, XY plane) —
 * radial thickness r0 → r1, between angles a0 and a1 (radians, CCW from +X),
 * depth d along Z. Rounded edges leave a dark joint to each neighbour.
 */
export function archStone(rng, r0, r1, a0, a1, d, opts = {}) {
  const rm = (r0 + r1) / 2, am = (a0 + a1) / 2;
  const g = roundStone(rng, r1 - r0, Math.abs(a1 - a0) * rm, d, { under: 0, sag: 0, ...opts });
  deform(g, (v) => {
    const a = am + v.y / rm, r = rm + v.x;
    v.set(Math.cos(a) * r, Math.sin(a) * r, v.z);
  });
  return g;
}

const _UP = new THREE.Vector3(0, 1, 0);
const _nq = new THREE.Quaternion();
const _nv = new THREE.Vector3();
/** Tip a geometry standing on y = 0 over so its up axis follows the normal (nx, ny, nz) — moss hugging a slope. */
export function alignUp(geo, nx, ny, nz) {
  _nv.set(nx, ny, nz).normalize();
  geo.applyQuaternion(_nq.setFromUnitVectors(_UP, _nv));
  return geo;
}

/** A soft moss cushion (flattened lumpy dome) sitting on y = 0. */
export function mossGeo(rng, { r = 0.25, h = 0.08, sx = 1, sz = 1, seg: nSeg = 8 } = {}) {
  const seg = segs(nSeg, 5);
  let g = new THREE.SphereGeometry(1, seg, seg > 8 ? 5 : LOD.k < 0.8 ? 3 : 4, 0, Math.PI * 2, 0, Math.PI / 2);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const ox = rng.next() * 40;
  deform(g, (v) => {
    const n = noiseA(v.x * 2.2 + ox, v.z * 2.2 - ox);
    const k = 1 + n * 0.25;
    v.set(v.x * r * sx * k, v.y * h * (0.8 + n * 0.5) - 0.01, v.z * r * sz * k);
  });
  return g;
}

/** Wedge of a ring (voussoir) in the XY plane, depth along Z (centred). */
export function arcSegment(r0, r1, a0, a1, depth, seg = 3, bevel = 0.01) {
  const s = new THREE.Shape();
  const n = Math.max(1, seg);
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const x = Math.cos(a) * r1, y = Math.sin(a) * r1;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  for (let i = n; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / n;
    s.lineTo(Math.cos(a) * r0, Math.sin(a) * r0);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 2 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Round-topped arch outline: width w, straight sides of height h below the half circle. */
export function archShape(w, h, { x = 0, y = 0, path = null, reverse = false } = {}) {
  const s = path ?? new THREE.Shape();
  const r = w / 2;
  if (!reverse) {
    s.moveTo(x - r, y);
    s.lineTo(x + r, y);
    s.lineTo(x + r, y + h);
    s.absarc(x, y + h, r, 0, Math.PI, false);
    s.lineTo(x - r, y);
  } else {
    s.moveTo(x - r, y);
    s.lineTo(x - r, y + h);
    s.absarc(x, y + h, r, Math.PI, 0, true);
    s.lineTo(x + r, y);
    s.lineTo(x - r, y);
  }
  return s;
}

/** Sagging catenary-ish curve between two points (Vector3). */
export function sagCurve(a, b, sag, segments = 12) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t));
  }
  return new THREE.CatmullRomCurve3(pts);
}

/** A tube along points (Vector3 or [x,y,z]) — vines, wires, pipes, ropes. */
export function tube(points, radius = 0.01, radial = 4, tubular = null, closed = false) {
  const v = points.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2])));
  const curve = new THREE.CatmullRomCurve3(v, closed, 'centripetal');
  return new THREE.TubeGeometry(curve, tubular ?? Math.max(4, v.length * 3), radius, radial, closed);
}

/** A tapered tube (radius r0 → r1) along points — branches, stems, reeds. */
export function taperTube(points, r0, r1, radial = 5, tubular = null) {
  const v = points.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2])));
  const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal');
  const segs = tubular ?? Math.max(4, v.length * 3);
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const pos = g.attributes.position;
  const c = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, c);
    const r = r0 + (r1 - r0) * t;
    for (let k = 0; k <= radial; k++) {
      const idx = i * (radial + 1) + k;
      p.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(idx, p.x, p.y, p.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

// ─── leaf cards ──────────────────────────────────────────────────────────────
const _cx = new THREE.Vector3();
/**
 * Collects foliage cards (quads with the stem at the bottom centre of the UV
 * square, growing towards +V) into one geometry.
 */
export class Cards {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
  }
  /** A card with its stem at `base`, growing along `up`, facing `normal`, height s (width s·aspect). */
  add(base, up, normal, s, { aspect = 1, flip = false, bend = 0, rows: nRows = 3 } = {}) {
    const across = _cx.crossVectors(up, normal).normalize();
    const n0 = this.pos.length / 3;
    const rows = bend ? nRows : 1;
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const droop = bend * t * t;
      for (const cx of [-0.5, 0.5]) {
        const x = base.x + across.x * cx * s * aspect + up.x * t * s + normal.x * droop * s;
        const y = base.y + across.y * cx * s * aspect + up.y * t * s + normal.y * droop * s - Math.abs(bend) * t * t * s * 0.3;
        const z = base.z + across.z * cx * s * aspect + up.z * t * s + normal.z * droop * s;
        this.pos.push(x, y, z);
        this.nor.push(normal.x, normal.y, normal.z);
        this.uv.push(flip ? 0.5 - cx : 0.5 + cx, t);
      }
    }
    for (let r = 0; r < rows; r++) {
      const a = n0 + r * 2;
      this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  get count() {
    return this.idx.length / 6;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
}

// ─── little plants (into a batch or batch frame) ────────────────────────────
export const FLOWER_COLORS = ['#f2c14e', '#e86a5a', '#f4f0e6', '#b48fd6', '#f29bb8', '#7fa7e0', '#ffd88a'];

/**
 * A small flower into the vc material at (x, y, z): a thin stem, ONE cupped
 * star of rounded petals and a domed centre (≈ 30 triangles).
 */
export function addFlower(F, rng, x, y, z, { color = null, size = 0.06, stem = 0.18 } = {}) {
  const MM = M();
  const c = color ?? rng.pick(FLOWER_COLORS);
  const h = stem * rng.range(0.7, 1.2);
  const lean = [rng.jitter(0.25), 0, rng.jitter(0.25)];
  F.add(MM.vc, xf(new THREE.CylinderGeometry(0.006, 0.008, h, 3, 1, true).translate(0, h / 2, 0), [x, y, z], lean), { color: '#4f7a34', cast: false });
  const tip = new THREE.Vector3(0, h, 0).applyEuler(new THREE.Euler(lean[0], 0, lean[2])).add(new THREE.Vector3(x, y, z));
  const petals = rng.int(4, 5);
  const head = new THREE.CircleGeometry(1, petals * (LOD.k < 1 ? 2 : 3));
  deform(head, (v) => {
    const a = Math.atan2(v.y, v.x);
    const r = Math.hypot(v.x, v.y);
    const k = 0.42 + 0.58 * Math.pow(Math.abs(Math.cos((a * petals) / 2)), 0.55);
    v.set(v.x * k * size, v.y * k * size, r * r * size * 0.35);
  });
  head.rotateX(-Math.PI / 2 + lean[0] * 0.8).rotateZ(lean[2] * 0.8).rotateY(rng.next() * TAU);
  F.add(MM.vc, head.translate(tip.x, tip.y, tip.z), { color: c, cast: false });
  F.add(MM.vc, new THREE.ConeGeometry(size * 0.3, size * 0.22, LOD.k < 1 ? 4 : 5, 1).translate(tip.x, tip.y + size * 0.1, tip.z), { color: '#e8b33a', cast: false });
}

/** A tuft of grass cards at (x, y, z) into `cards` (a Cards set). */
export function addGrass(cards, rng, x, y, z, { size = 0.32, blades = 3, spread = 0.05 } = {}) {
  for (let i = 0; i < blades; i++) {
    const a = rng.next() * Math.PI;
    const n = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    cards.add(new THREE.Vector3(x + rng.jitter(spread), y - 0.02, z + rng.jitter(spread)), new THREE.Vector3(rng.jitter(0.3), 1, rng.jitter(0.3)).normalize(), n, size * rng.range(0.75, 1.2), { aspect: 0.7, flip: rng.chance(0.5) });
  }
}

/**
 * A fern at (x, y, z) into `cards`: a fountain of narrow fronds leaving the
 * crown steeply and ARCHING over, their tips drooping (never a flat, cupped
 * rosette) — the older outer fronds longer and lower, young ones upright.
 * tilt: how far the fronds lean out (0.75 upright … 1.35 spreading).
 */
export function addFern(cards, rng, x, y, z, { size = 0.5, fronds = 7, tilt = 0.75 } = {}) {
  const rot = rng.next() * TAU;
  const rows = LOD.k < 0.5 ? 2 : 3;
  for (let i = 0; i < fronds; i++) {
    const a = rot + (i / fronds) * TAU + rng.jitter(0.35);
    const age = rng.next(); // 0 young (short, upright) … 1 old (long, leaning out)
    const out = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const lean = tilt * (0.45 + 0.45 * age);
    const up = new THREE.Vector3(out.x * lean, 1.0 + rng.jitter(0.12), out.z * lean).normalize();
    const nrm = new THREE.Vector3().crossVectors(up, new THREE.Vector3(Math.cos(a), 0, -Math.sin(a))).normalize();
    if (nrm.y < 0) nrm.negate();
    // (a little roll, so the fronds don't all face the sky)
    nrm.applyAxisAngle(up, rng.jitter(0.35));
    const len = size * (0.62 + 0.5 * age) * rng.range(0.9, 1.1);
    cards.add(new THREE.Vector3(x + out.x * 0.01, y, z + out.z * 0.01), up, nrm, len, { aspect: 0.4, bend: -(0.45 + 0.4 * age), rows });
  }
}

/**
 * A little toadstool — stem, ring, domed cap with gills and white warts —
 * into the vc/stem/cap materials.
 */
export function addToadstool(F, rng, x, y, z, { size = 0.12, color = '#c4301f', lean = 0.18, warts = true, gill = '#e3cfa8' } = {}) {
  const MM = M();
  // (lower tiers: fewer segments, no stem ring, fewer warts — they are a few pixels tall on a phone)
  const lo = LOD.k < 1, rad = LOD.k < 0.5 ? 5 : lo ? 6 : 8;
  const h = size * rng.range(1.1, 1.8);
  const rx = rng.jitter(lean), rz = rng.jitter(lean), ry = rng.next() * TAU;
  const stem = new THREE.CylinderGeometry(size * 0.15, size * 0.22, h, lo ? 5 : 6, 1, true);
  stem.translate(0, h / 2, 0);
  const capR = size * rng.range(0.5, 0.62);
  const cap = new THREE.SphereGeometry(capR, rad, lo ? 2 : 3, 0, TAU, 0, Math.PI / 2);
  cap.scale(1, rng.range(0.55, 0.85), 1);
  cap.translate(0, h - capR * 0.08, 0);
  const under = new THREE.CircleGeometry(capR * 0.98, rad).rotateX(Math.PI / 2).translate(0, h - capR * 0.06, 0);
  const parts = [[stem, '#efe5cf', MM.stem], [cap, color, MM.cap], [under, gill, MM.vc]];
  if (!lo) parts.splice(1, 0, [new THREE.CylinderGeometry(size * 0.2, size * 0.24, size * 0.06, 6, 1, true).translate(0, h * 0.78, 0), '#efe5cf', MM.stem]);
  for (const [g, c, m] of parts) {
    xf(g, [x, y, z], [rx, ry, rz]);
    F.add(m, g, { color: c, cast: false });
  }
  if (warts) {
    const n = LOD.k < 0.5 ? 1 : lo ? rng.int(2, 3) : rng.int(3, 5);
    for (let i = 0; i < n; i++) {
      const a = rng.next() * TAU, el = rng.range(0.35, 1.25);
      const sp = new THREE.OctahedronGeometry(size * rng.range(0.045, 0.075), 0);
      sp.scale(1, 0.45, 1);
      const rr = capR;
      const cy = Math.sin(el) * rr * 0.7;
      sp.lookAt(new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)));
      sp.translate(Math.cos(a) * Math.cos(el) * rr, h - capR * 0.08 + cy, Math.sin(a) * Math.cos(el) * rr);
      xf(sp, [x, y, z], [rx, ry, rz]);
      F.add(MM.vc, sp, { color: '#f6efe0', cast: false });
    }
  }
}

/**
 * Ivy: a wandering woody stem from `start` along `dir`, hugging a surface
 * with normal `normal` (gravity pulls hanging strands down), with ivy cards
 * into `cards`. `surface(p, nrm)` may snap p onto a surface and write its normal.
 */
export function addIvy(F, rng, start, dir, { length = 1.2, droop = 0.6, size = 0.16, density = 1, normal = [0, 0, 1], surface = null, cards, stemColor = '#5a4a32', stem = true } = {}) {
  const pts = [];
  const p = new THREE.Vector3(start[0], start[1], start[2]);
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const nrm = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
  const step = 0.07;
  const n = Math.max(3, Math.round(length / step));
  for (let i = 0; i < n; i++) {
    pts.push(p.clone());
    d.x += rng.jitter(0.3);
    d.z += rng.jitter(0.3);
    d.y += rng.jitter(0.22) - droop * 0.22;
    if (surface) surface(p, nrm);
    d.addScaledVector(nrm, -d.dot(nrm)).normalize();
    p.addScaledVector(d, step);
  }
  // (a hair-thin stem: one tube segment per step is plenty; below the high tier — a
  // pixel wide on a phone — only the leaves are drawn)
  if (stem && pts.length >= 2 && LOD.k >= 1) F.add(M().vc, tube(pts, 0.007, 3, Math.max(4, pts.length)), { color: stemColor, cast: false });
  const count = Math.round(n * 0.75 * density);
  const up = new THREE.Vector3();
  const nn = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const k = Math.min(pts.length - 2, Math.floor(rng.next() * (pts.length - 1)));
    const q = pts[k];
    const along = new THREE.Vector3().subVectors(pts[k + 1], q).normalize();
    up.copy(along).multiplyScalar(rng.chance(0.5) ? 1 : -1);
    up.y -= 0.35;
    up.addScaledVector(nrm, 0.35).normalize();
    nn.copy(nrm);
    if (surface) surface(q.clone(), nn);
    nn.addScaledVector(up, -nn.dot(up)).normalize();
    cards.add(q.clone().addScaledVector(nn, 0.012), up.clone(), nn.clone(), size * rng.range(0.7, 1.25), { aspect: 0.9, flip: rng.chance(0.5) });
  }
  return pts;
}

/** Finish a Cards set into the batch (soft volumetric normals around `center`; blend 0 keeps the card normals). */
export function flushCards(F, cards, material, center = null, blend = 0.7) {
  if (!cards.count) return;
  const g = cards.geometry();
  if (blend > 0) materials.foliageNormals(g, center, blend);
  F.add(material, g, { cast: false });
}

/** One fern straight into the batch, shaded as its own soft volume. */
export function plantFern(F, rng, x, y, z, opts = {}) {
  const c = new Cards();
  addFern(c, rng, x, y, z, opts);
  flushCards(F, c, opts.material ?? M().fern, new THREE.Vector3(x, y + (opts.size ?? 0.5) * 0.2, z), 0.7);
}

/** One grass tuft straight into the batch. */
export function plantGrass(F, rng, x, y, z, opts = {}) {
  const c = new Cards();
  addGrass(c, rng, x, y, z, opts);
  flushCards(F, c, opts.material ?? M().grass, new THREE.Vector3(x, y - 0.05, z), 0.6);
}

/**
 * A little fern sprouting from a wall joint at `p` ([x,y,z]): its fronds fan
 * out around `out` (the wall normal, tipped up) and arch down over the stones.
 */
export function wallFern(F, rng, p, out, { size = 0.32, fronds = 6 } = {}) {
  const c = new Cards();
  addFern(c, rng, 0, 0, 0, { size, fronds, tilt: 1.15 });
  const g = c.geometry();
  const axis = new THREE.Vector3(out[0], out[1], out[2]).normalize().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.6, 0)).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis));
  g.translate(p[0], p[1], p[2]);
  materials.foliageNormals(g, new THREE.Vector3(p[0], p[1] + size * 0.15, p[2]).addScaledVector(axis, size * 0.2), 0.7);
  F.add(M().fern, g, { cast: false });
}

/** Random helpers. */
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const smooth01 = (t) => {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
};
