// ─────────────────────────────────────────────────────────────────────────────
// Schreinerei kit — geometry helpers shared by the workshop builders.
//
// The workshop is built from hundreds of small hand-made parts (timbers, pegs,
// stones, boards, tools …). Every part is baked (transform + UVs) and merged
// per material by a Batch, so the whole Schreinerei costs a few dozen draw
// calls. Everything is a little crooked on purpose (seeded jitter).
//
//   const B = new Batch();
//   const A = B.at(matrix);                 // a local frame (e.g. the annex)
//   A.add(mat.wood('oak'), board(1.2, 0.04, 0.3, { along: 'x' }), { cast: true });
//   B.build(group);                         // one mesh per material (+ shadow flag)
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createNoise2D } from '../../core/noise.js';

const noiseA = createNoise2D(91731);
const noiseB = createNoise2D(5531);

// ─── materials ───────────────────────────────────────────────────────────────
/**
 * Material shortcuts (all cached by core/materials.js — never mutate them).
 * vc = one PBR material with vertex colours for the many tiny coloured bits
 * (tea cups, book covers, LP spines, flowers, paint) → a single draw call.
 */
export function makeMats(ctx) {
  const m = ctx.materials;
  // One vertex-coloured material per colorize kind: the species / colour rides
  // on the vertex colour, so every wood species (or metal, fabric) merges into
  // ONE draw call. mats.wood('walnut') returns a proxy the Batch unwraps.
  // The wood's grain texture is colourised from a NEUTRAL grey: with a species
  // base (oak) its hue would multiply every vertex colour and push walnut,
  // ash, cherry … all towards the same orange.
  const proxy = (material, color) => ({ isProxy: true, material, color });
  const vcSurface = (kind, extra = {}) => m.surface(kind, { ...(kind === 'wood' ? { color: '#bdbdbd' } : {}), vertexColors: true, ...extra });
  const mats = {
    wood: (species = 'oak', extra = {}) => proxy(vcSurface('wood', extra), SPECIES[species] ?? species),
    /** A real (non-proxy) wood material, for meshes not built through a Batch. */
    woodMat: (species = 'oak', extra = {}) => m.surface('wood', { species, ...extra }),
    timber: (extra = {}) => m.surface('timber', extra),
    /** Individual instanced shakes: weathered timber, world-mapped so every shake differs. */
    shingles: () => m.surface('timber', { triplanar: true, color: '#7a5a42' }),
    plaster: () => m.surface('plaster', { color: '#e8dbc0' }),
    /** Field stone (mortar cores & chimney cores share it: one draw call for all stone). */
    stone: () => m.surface('stone'),
    moss: () => m.surface('moss'),
    bark: () => m.surface('bark'),
    leaf: () => m.surface('leaf', { side: THREE.DoubleSide }),
    paper: () => m.surface('paper'),
    fabric: (color = '#c9b79a') => proxy(vcSurface('fabric'), color),
    metal: (color = '#3d3833') => proxy(vcSurface('metal'), color),
    glass: () => m.surface('glass'),
    vc: () => m.standard('#ffffff', { vertexColors: true, roughness: 0.78 }),
    // tiny bits ride on shared vertex-coloured materials instead of costing a draw call each
    /** Rope & twine: the wood grain reads as twisted fibres at this size. */
    rope: () => proxy(vcSurface('wood'), '#b39a6c'),
    /** Terracotta pots (tiny): painted on the shared wood material. */
    clay: (color = '#b5633e') => proxy(vcSurface('wood'), color),
    /** Potting soil in boxes & planters. */
    soil: () => proxy(m.standard('#ffffff', { vertexColors: true, roughness: 0.78 }), '#3b2a1e'),
    /**
     * Warm window/lamp glows: two shared intensities keep the material count
     * low — the soft amber for windows (day 0.3–0.5) and a bright pale one for
     * lamps, bulbs and the panes that "catch the sky".
     */
    glow: (color, day = 0.35) => (day >= 0.3 && day < 0.5 ? m.glow('#ffc46e', { day: 0.4, night: 1.7 }) : m.glow('#ffd79a', { day: 0.85, night: 2.4 })),
  };
  /**
   * For small hotspot pieces: painted bits, fabric and glass ride on the shared
   * vertex-coloured wood material too (at that size the grain is invisible), so
   * a piece costs one or two draw calls.
   */
  mats.piece = {
    ...mats,
    vc: () => proxy(vcSurface('wood'), '#ffffff'),
    fabric: (color = '#c9b79a') => proxy(vcSurface('wood'), color),
    glass: () => proxy(vcSurface('wood'), '#cfe3e0'),
    clay: (color = '#b5633e') => proxy(vcSurface('wood'), color),
    /** Steel & brass bits on a piece (plane irons, bench dogs, knobs) — painted wood at this size. */
    metal: (color = '#3d3833') => proxy(vcSurface('wood'), color),
  };
  return mats;
}

/**
 * Average (sRGB) colour of each wood species — the vertex colour on the shared
 * (neutral) wood material, i.e. what the finished, oiled wood looks like.
 * Natural and moderately saturated because the golden post grade warms
 * everything: oak a honey tan, walnut chocolate, ash pale cream-grey, cherry
 * clearly red-brown, maple cream, spruce straw, beech pinkish.
 */
export const SPECIES = {
  oak: '#a88c68',
  walnut: '#5c4334',
  spruce: '#d2bb90',
  ash: '#cdc2a8',
  cherry: '#9c5a43',
  maple: '#dccaa7',
  beech: '#c29d7c',
};

// ─── batching ────────────────────────────────────────────────────────────────
const _c = new THREE.Color();

/** Make a geometry mergeable: indexed, normal + uv (+ colour), no groups/morphs. */
export function prepare(geo, withColor = false) {
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

/** Per-vertex colour from the vertex normal (and position): fn(nx, ny, nz, x, y, z) → sRGB hex. */
export function paintBy(geo, fn) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    _c.set(fn(nor.getX(i), nor.getY(i), nor.getZ(i), pos.getX(i), pos.getY(i), pos.getZ(i)));
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

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

/** Collects geometry per material and merges it into one mesh per (material, shadow) pair. */
export class Batch {
  constructor() {
    this.lists = new Map();
    this.tris = 0;
  }
  /**
   * Add a geometry (consumed). opts: { cast = true, receive = true, color (vc materials), matrix }
   */
  add(material, geo, opts = {}) {
    if (material.isProxy) {
      // a geometry painted beforehand (paintBy) keeps its own colours
      if (opts.color === undefined && !geo.attributes.color) opts = { ...opts, color: material.color };
      material = material.material;
    }
    const cast = opts.cast ?? true;
    const receive = opts.receive ?? true;
    const vc = !!material.vertexColors;
    if (vc && opts.color !== undefined) paint(geo, opts.color);
    prepare(geo, vc);
    if (opts.matrix) geo.applyMatrix4(opts.matrix);
    const key = `${material.uuid}|${cast ? 1 : 0}|${receive ? 1 : 0}`;
    let e = this.lists.get(key);
    if (!e) {
      e = { material, cast, receive, geos: [] };
      this.lists.set(key, e);
    }
    e.geos.push(geo);
    return geo;
  }
  /** A view of this batch that applies `matrix` (Matrix4) to every added geometry. */
  at(matrix) {
    const parent = this;
    const m = matrix.clone();
    return {
      matrix: m,
      add(material, geo, opts = {}) {
        geo.applyMatrix4(opts.matrix ? opts.matrix.clone().premultiply(m) : m);
        return parent.add(material, geo, { ...opts, matrix: null });
      },
      at(child) {
        return parent.at(m.clone().multiply(child));
      },
      batch: parent,
    };
  }
  /**
   * Merge everything into meshes added to `parent`. Returns the meshes.
   * opts.mergeShadow: put a material's casting and non-casting parts into ONE
   * casting mesh (fewer draw calls for small hotspot pieces).
   * opts.noCast: materials whose merged mesh never casts (small details).
   * opts.cast: false → nothing in this batch casts.
   */
  build(parent, name = 'batch', { mergeShadow = false, keepSplit = [], noCast = [], cast = true } = {}) {
    const out = [];
    const quiet = new Set(noCast.map((m) => (m.isProxy ? m.material : m).uuid));
    if (mergeShadow) {
      const merged = new Map();
      const split = new Set(keepSplit.map((m) => (m.isProxy ? m.material : m).uuid));
      for (const e of this.lists.values()) {
        const k = split.has(e.material.uuid) ? `${e.material.uuid}|${e.cast}` : e.material.uuid;
        const t = merged.get(k);
        if (t) {
          t.geos.push(...e.geos);
          t.cast = t.cast || e.cast;
          t.receive = t.receive || e.receive;
        } else merged.set(k, { ...e, geos: [...e.geos] });
      }
      this.lists = merged;
    }
    for (const e of this.lists.values()) {
      const g = e.geos.length === 1 ? e.geos[0] : mergeGeometries(e.geos, false);
      if (!g) {
        console.warn(`[schreinerei] merge failed for ${e.material.name}`);
        continue;
      }
      if (e.geos.length > 1) e.geos.forEach((x) => x.dispose());
      g.computeBoundingSphere();
      g.computeBoundingBox();
      this.tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      const mesh = new THREE.Mesh(g, e.material);
      mesh.name = `${name}:${e.material.name || 'mat'}`;
      mesh.castShadow = cast && e.cast && !quiet.has(e.material.uuid);
      mesh.receiveShadow = e.receive;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      out.push(mesh);
    }
    this.lists.clear();
    return out;
  }
}

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

/** Orient a geometry built along +X so it runs from a to b (rolled so its +Y stays close to `up`). */
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
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

// ─── UVs ─────────────────────────────────────────────────────────────────────
const AX = { x: 0, y: 1, z: 2 };
/** Natural texture tile sizes (world units per repeat) of the uv-mapped surface kinds. */
export const TILE = { wood: 1.4, timber: 1.6, plaster: 2.2, shingles: 1.4, rope: 1, paper: 1 };

/**
 * Planar "box" UVs in the part's own space, in world units × scale (default:
 * 1 / wood tile), so a texture keeps the same density on every part. The
 * grain (texture U — the look-dev convention) runs along `along`. `off`
 * shifts the UVs (vary it per board so neighbours differ).
 */
export function uvBox(geo, along = 'y', scale = 1 / TILE.wood, off = [0, 0]) {
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
      // end grain: any two other axes
      u = p[(A + 1) % 3];
      v = p[(A + 2) % 3];
    } else {
      const across = 3 - A - dom;
      u = p[A];
      v = p[across];
    }
    uv[i * 2] = u * scale + off[0];
    uv[i * 2 + 1] = v * scale + off[1];
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Cylindrical UVs around Y (bark, posts, logs standing up): U around, V up. */
export function uvCyl(geo, scale = 1, off = [0, 0], radius = 0.3) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getX(i), pos.getZ(i));
    uv[i * 2] = (a / (Math.PI * 2)) * Math.PI * 2 * radius * scale + off[0];
    uv[i * 2 + 1] = pos.getY(i) * scale + off[1];
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// ─── shapes ──────────────────────────────────────────────────────────────────
/** Box with softened (chamfered) edges — catches light like real planed wood. */
export function rbox(w, h, d, r = 0.012) {
  const rr = Math.max(0.0005, Math.min(r, w * 0.45, h * 0.45, d * 0.45));
  return new RoundedBoxGeometry(w, h, d, 1, rr);
}

/**
 * A chamfered beam along X (length len, height h along Y, width w along Z):
 * an 8-sided section with `segs` length segments (so crooked deforms bend it)
 * and flat end caps. Much cheaper than a rounded box (≈ 16·segs + 12 tris).
 */
export function beamGeo(len, h, w, c = 0.012, segs = 1) {
  const cc = Math.max(0.0005, Math.min(c, h * 0.3, w * 0.3));
  const hh = h / 2, hw = w / 2;
  // section outline (y, z), counter-clockwise seen from +X
  const sec = [
    [-hh + cc, -hw], [hh - cc, -hw], [hh, -hw + cc], [hh, hw - cc],
    [hh - cc, hw], [-hh + cc, hw], [-hh, hw - cc], [-hh, -hw + cc],
  ];
  const pos = [];
  const nor = [];
  const idx = [];
  const n = sec.length;
  // sides: each face gets its own vertices (flat-ish shading per facet)
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
  // caps
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

/** beamGeo oriented along an axis ('x' | 'y' | 'z'): sizes are (w, h, d) like a BoxGeometry. */
export function beamBox(w, h, d, along = 'x', c = 0.012, segs = 1) {
  if (along === 'x') return beamGeo(w, h, d, c, segs);
  if (along === 'y') return beamGeo(h, w, d, c, segs).rotateZ(Math.PI / 2);
  return beamGeo(d, h, w, c, segs).rotateY(-Math.PI / 2);
}

/**
 * A wooden part: rounded box with grain UVs. along = grain axis ('x' | 'y' | 'z').
 * rng (optional) gives the board its own UV offset so neighbours don't match.
 */
export function board(w, h, d, { along = 'x', r = 0.01, rng = null, scale = 1 / TILE.wood, segs = 0 } = {}) {
  const len = along === 'x' ? w : along === 'y' ? h : d;
  const g = beamBox(w, h, d, along, r, segs || Math.max(1, Math.round(len / 0.7)));
  return uvBox(g, along, scale, rng ? [rng.next() * 7, rng.next() * 7] : [0, 0]);
}

/**
 * A timber running from a to b with a (w × h) section, slightly irregular
 * (hand-hewn): a hewn beam is never perfectly straight.
 */
export function timber(a, b, w, h, { rng = null, up = [0, 1, 0], r = 0.018, wobble = 0.012, scale = 1 / TILE.timber } = {}) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const segs = Math.max(1, Math.round(len / 0.5));
  const g = beamGeo(len, h, w, r, segs);
  if (rng && wobble > 0) {
    const s1 = rng.next() * 10, s2 = rng.next() * 10;
    const k1 = rng.jitter(1), k2 = rng.jitter(1);
    deform(g, (v) => {
      const t = v.x / len + 0.5;
      const bow = Math.sin(t * Math.PI);
      v.y += bow * wobble * k1 + noiseA(t * 2.3 + s1, s2) * wobble * 0.4;
      v.z += bow * wobble * k2 + noiseB(t * 2.1 + s2, s1) * wobble * 0.4;
    });
  }
  uvBox(g, 'x', scale, rng ? [rng.next() * 7, rng.next() * 7] : [0, 0]);
  return alongX(g, a, b, up);
}

/** Round peg/dowel head poking out of a timber face (tiny cylinder along Z). */
export function peg(r = 0.018, len = 0.03) {
  const g = new THREE.CylinderGeometry(r, r * 1.1, len, 6, 1);
  g.rotateX(Math.PI / 2);
  return uvBox(g, 'z');
}

/**
 * A lumpy field stone. Smooth, flattened, with noise bumps.
 * opts: { r, flat (y squash), lump, detail, seed }
 */
export function stoneGeo(rng, { r = 0.2, sx = 1, sy = 0.6, sz = 1, lump = 0.22, detail = 1 } = {}) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const ox = rng.next() * 50, oy = rng.next() * 50;
  deform(g, (v) => {
    const n = noiseA(v.x * 1.3 + ox, v.y * 1.3 + v.z * 0.7 + oy) * 0.6 + noiseB(v.z * 2.6 + oy, v.x * 2.6 - ox) * 0.4;
    v.multiplyScalar(1 + n * lump);
    // flatter faces top & bottom, like a dressed fieldstone
    if (v.y > 0.55) v.y = 0.55 + (v.y - 0.55) * 0.35;
    if (v.y < -0.6) v.y = -0.6 + (v.y + 0.6) * 0.3;
    v.set(v.x * r * sx, v.y * r * sy, v.z * r * sz);
  });
  uvBox(g, 'x', 1.6, [rng.next() * 9, rng.next() * 9]);
  return g;
}

/** A soft moss cushion (flattened lumpy blob), sitting on y = 0. */
export function mossGeo(rng, { r = 0.25, h = 0.08, sx = 1, sz = 1 } = {}) {
  let g = new THREE.SphereGeometry(1, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const ox = rng.next() * 40;
  deform(g, (v) => {
    const n = noiseA(v.x * 2.2 + ox, v.z * 2.2 - ox);
    const k = 1 + n * 0.25;
    v.set(v.x * r * sx * k, v.y * h * (0.8 + n * 0.5) - 0.01, v.z * r * sz * k);
  });
  uvBox(g, 'y', 2, [ox, ox]);
  return g;
}

/** Wedge of a ring / arch: voussoir-like segment in the XY plane, depth along Z. */
export function arcSegment(r0, r1, a0, a1, depth, seg = 3) {
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
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1, curveSegments: 2 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Round-topped arch outline (width w, straight height h below the half circle). */
export function archShape(w, h, { x = 0, y = 0 } = {}) {
  const s = new THREE.Shape();
  const r = w / 2;
  s.moveTo(x - r, y);
  s.lineTo(x + r, y);
  s.lineTo(x + r, y + h);
  s.absarc(x, y + h, r, 0, Math.PI, false);
  s.lineTo(x - r, y);
  return s;
}

/** Sagging catenary-ish curve between two points (ropes, wires, chains). */
export function sagCurve(a, b, sag, segments = 12) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    pts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t));
  }
  return new THREE.CatmullRomCurve3(pts);
}

/** A tube along points [[x,y,z]…] (vines, ropes, wires, forged scrolls). */
export function tube(points, radius = 0.01, radial = 4, tubular = null) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const g = new THREE.TubeGeometry(curve, tubular ?? Math.max(4, points.length * 3), radius, radial, false);
  return uvBox(g, 'y', 3);
}

/** An ivy leaf (3-lobed, slightly cupped) in the XY plane facing +Z, stem at the origin. */
let ivyLeafProto = null;
export function ivyLeaf(size = 0.08) {
  if (!ivyLeafProto) {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(-0.35, 0.05, -0.62, 0.32, -0.5, 0.5);
    s.bezierCurveTo(-0.38, 0.62, -0.22, 0.62, -0.18, 0.72);
    s.bezierCurveTo(-0.12, 0.9, 0.0, 1.0, 0.0, 1.05);
    s.bezierCurveTo(0.0, 1.0, 0.12, 0.9, 0.18, 0.72);
    s.bezierCurveTo(0.22, 0.62, 0.38, 0.62, 0.5, 0.5);
    s.bezierCurveTo(0.62, 0.32, 0.35, 0.05, 0, 0);
    const g = new THREE.ShapeGeometry(s, 2);
    deform(g, (v) => {
      v.z = -(v.x * v.x) * 0.35 + Math.sin(v.y * 3) * 0.04;
    });
    // UVs 0..1 over the leaf
    const pos = g.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i) + 0.5;
      uv[i * 2 + 1] = pos.getY(i) / 1.05;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    ivyLeafProto = g;
  }
  return ivyLeafProto.clone().scale(size, size, size);
}

/**
 * Ivy: a wandering stem from `start` along `dir` (gravity pulls it down when
 * hanging), with leaves alternating along it. Adds to the batch frame `F`.
 * opts: { length, droop (0 climbing … 1 hanging), leaf size, density, normal (surface facing) }
 */
export function addIvy(F, mats, rng, start, dir, { length = 1.2, droop = 0.6, size = 0.075, density = 1, normal = [0, 0, 1], leafy = 1 } = {}) {
  const pts = [];
  const p = new THREE.Vector3(start[0], start[1], start[2]);
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const nrm = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
  const step = 0.06;
  const n = Math.max(3, Math.round(length / step));
  for (let i = 0; i < n; i++) {
    pts.push([p.x, p.y, p.z]);
    d.x += rng.jitter(0.35);
    d.z += rng.jitter(0.35);
    d.y += rng.jitter(0.25) - droop * 0.25;
    // stay on the surface plane
    d.addScaledVector(nrm, -d.dot(nrm)).normalize();
    p.addScaledVector(d, step);
  }
  F.add(mats.bark(), tube(pts, 0.006, 3, pts.length), { cast: false });
  const leafMat = mats.leaf();
  const count = Math.round(n * 0.9 * density * leafy);
  const lm = new THREE.Matrix4();
  const up = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const k = Math.min(pts.length - 1, Math.floor(rng.next() * pts.length));
    const q = pts[k];
    const s = size * rng.range(0.6, 1.25) * (0.7 + 0.3 * (1 - k / pts.length));
    const leaf = ivyLeaf(s);
    // leaves face mostly outwards (along the surface normal) and droop
    up.set(rng.jitter(1), rng.jitter(0.6) - 0.7, rng.jitter(1));
    const yaw = Math.atan2(nrm.x, nrm.z) + rng.jitter(0.9);
    const pitch = rng.jitter(0.6) - 0.25;
    const roll = Math.PI + rng.jitter(1.2);
    mat4([q[0] + nrm.x * 0.01, q[1], q[2] + nrm.z * 0.01], [pitch, yaw, roll, 'YXZ'], 1, lm);
    leaf.applyMatrix4(lm);
    F.add(leafMat, leaf, { cast: false });
  }
  return pts;
}

/** Tiny toadstool (cap + stem + spots) into the vc layer. Returns nothing. */
export function addToadstool(F, mats, rng, x, y, z, { size = 0.1, color = '#c9352a', lean = 0.15 } = {}) {
  const h = size * rng.range(1.0, 1.7);
  // open-ended stem (its ends hide in the soil and under the cap)
  const stem = new THREE.CylinderGeometry(size * 0.16, size * 0.22, h, 6, 1, true);
  stem.translate(0, h / 2, 0);
  const cap = new THREE.SphereGeometry(size * 0.55, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.65 + rng.next() * 0.3, 1);
  cap.translate(0, h, 0);
  const gill = new THREE.CircleGeometry(size * 0.53, 8);
  gill.rotateX(Math.PI / 2);
  gill.translate(0, h + 0.002, 0);
  const rx = rng.jitter(lean), rz = rng.jitter(lean);
  const vc = mats.vc();
  for (const [g, c] of [[stem, '#efe4cc'], [cap, color], [gill, '#e6d3b0']]) {
    xf(g, [x, y, z], [rx, rng.next() * 6, rz]);
    F.add(vc, g, { color: c, cast: false });
  }
  // white spots
  if (color !== '#b98a4e') {
    for (let i = 0; i < 4; i++) {
      const a = rng.next() * Math.PI * 2, el = rng.range(0.35, 1.1);
      const sp = new THREE.SphereGeometry(size * 0.075, 4, 2);
      const rr = size * 0.55;
      sp.translate(Math.cos(a) * Math.cos(el) * rr, h + Math.sin(el) * rr * 0.75, Math.sin(a) * Math.cos(el) * rr);
      xf(sp, [x, y, z], [rx, 0, rz]);
      F.add(vc, sp, { color: '#fff6e6', cast: false });
    }
  }
}

/** A fern frond fan (leaf cards) for corners. Uses foliage material. */
export function addFern(F, ctx, rng, x, y, z, { size = 0.45, fronds = 7, color = '#4f7f36' } = {}) {
  const mat = ctx.materials.foliage({ color, variant: 'fern', wind: { strength: 0.05, base: 0.05 } });
  for (let i = 0; i < fronds; i++) {
    const L = size * rng.range(0.7, 1.15);
    const g = new THREE.PlaneGeometry(L * 0.32, L, 1, 4);
    g.translate(0, L / 2, 0);
    // arch the frond
    deform(g, (v) => {
      const t = v.y / L;
      v.z += t * t * L * 0.55;
      v.x *= Math.sin(Math.min(1, t * 1.3 + 0.1) * Math.PI) * 1.1;
    });
    const a = (i / fronds) * Math.PI * 2 + rng.jitter(0.4);
    xf(g, [x, y, z], [-0.35 + rng.jitter(0.2), a, 0], 1);
    F.add(mat, g, { cast: false });
  }
}

/** Random point helpers. */
export const TAU = Math.PI * 2;
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Shared noise for builders. */
export { noiseA, noiseB };

// ─── shingles (instanced) ────────────────────────────────────────────────────
/**
 * One wooden shingle with a rounded butt, slightly cupped, lying in the XY
 * plane: width along X, length along +Y (butt at y = 0), facing +Z.
 */
export function shingleGeo(w = 0.2, l = 0.34, t = 0.022) {
  const g = new THREE.BoxGeometry(w, l, t, 2, 1, 1);
  g.translate(0, l / 2, 0);
  deform(g, (v) => {
    const xn = v.x / (w / 2);
    // rounded butt: pull the lower corners up
    if (v.y < l * 0.34) {
      const k = 1 - v.y / (l * 0.34);
      v.y += k * k * Math.abs(xn) * l * 0.16;
    }
    // cupping & a thicker butt
    v.z += (1 - xn * xn) * 0.006;
    if (v.z > 0) v.z += (1 - v.y / l) * 0.008;
  });
  // UVs 0..1 across the single shingle (grain along its length)
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / w + 0.5;
    uv[i * 2 + 1] = pos.getY(i) / l;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // keep only what can ever be seen: the face, the butt edge and the two
  // sides (the top edge hides under the next course, the back lies on the
  // roof boards) → 12 triangles per shake
  const keep = new Set([0, 1, 3, 4]); // BoxGeometry groups: px nx py ny pz nz
  const src = g.index.array;
  const idx = [];
  for (const gr of g.groups) if (keep.has(gr.materialIndex)) for (let i = gr.start; i < gr.start + gr.count; i++) idx.push(src[i]);
  g.setIndex(idx);
  g.clearGroups();
  return g;
}

/** Collects shingle instances (matrix + tint) and builds ONE InstancedMesh. */
export class ShingleField {
  constructor() {
    this.matrices = [];
    this.colors = [];
  }
  push(matrix, color) {
    this.matrices.push(matrix.clone());
    this.colors.push(color.clone());
  }
  get count() {
    return this.matrices.length;
  }
  build(parent, material, geo = shingleGeo()) {
    const n = this.matrices.length;
    if (!n) return null;
    const mesh = new THREE.InstancedMesh(geo, material, n);
    for (let i = 0; i < n; i++) {
      mesh.setMatrixAt(i, this.matrices[i]);
      mesh.setColorAt(i, this.colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // the roof boards under the shakes cast the roof's shadow; the 2.7k shakes
    // only receive (keeps them out of the shadow pass)
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = 'shingles';
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox?.();
    parent.add(mesh);
    return mesh;
  }
}

/**
 * Lay shingles on a planar roof slope.
 *   origin: eave point at the start of the row line (Vector3, local space)
 *   alongDir: unit vector along the eave; upDir: unit vector up the slope; normal: outwards
 *   length: along the eave; height: slope length eave → ridge
 *   opts: { w, exposure, rng, skip(u, v) → bool, tint(u, v, colour), crook(v3) }
 */
export function layShingles(field, { origin, alongDir, upDir, normal, length, height, w = 0.2, exposure = 0.125, rng, skip = null, tint = null, transform = null }) {
  const m = new THREE.Matrix4();
  const basis = new THREE.Matrix4().makeBasis(alongDir, upDir, normal);
  const rot = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  const rows = Math.ceil(height / exposure);
  for (let r = 0; r < rows; r++) {
    const v = r * exposure;
    const n = Math.ceil(length / w) + 1;
    const off = (r % 2) * w * 0.5 + rng.jitter(w * 0.12);
    for (let k = 0; k < n; k++) {
      const u = -w * 0.5 + k * w + off + rng.jitter(w * 0.05);
      if (u < -w * 0.3 || u > length + w * 0.3) continue;
      if (skip && skip(u, v)) continue;
      if (rng.next() < 0.012) continue; // a missing shingle here and there
      p.copy(origin).addScaledVector(alongDir, u).addScaledVector(upDir, v).addScaledVector(normal, 0.012 + (r % 2) * 0.004);
      if (transform) transform(p);
      rot.makeRotationFromEuler(_e.set(-0.07 + rng.jitter(0.03), rng.jitter(0.025), rng.jitter(0.06)));
      m.copy(basis).multiply(rot);
      const sw = rng.range(0.85, 1.12);
      m.scale(_s.set(sw, rng.range(0.92, 1.08), 1));
      m.setPosition(p);
      // weathered tint: lighter/darker shakes, greyer near the top, mossy in patches
      const g = rng.range(0.78, 1.08);
      col.setRGB(g, g * rng.range(0.94, 1.0), g * rng.range(0.86, 0.98));
      if (tint) tint(u, v, col, p);
      field.push(m, col);
    }
  }
}

// ─── lights: lanterns, fairy lights, halos (all batched) ────────────────────
const halos = [];
/** Queue a soft glow halo (world space); main builds ONE glowQuads mesh from all of them. */
export function pushHalo(p, size = 0.6) {
  halos.push({ x: p.x ?? p[0], y: p.y ?? p[1], z: p.z ?? p[2], size });
}
/** Take (and clear) the queued halos. */
export function takeHalos() {
  return halos.splice(0, halos.length);
}

/**
 * A forged lantern (≈0.5 tall, origin at the hanging ring on top) added into a
 * batch frame `F` at local position `pos` (array). `world` (Vector3) is used
 * for the halo. Iron in the vertex-coloured metal, glass in the bright glow.
 */
export function addLantern(F, mats, pos, world, { scale = 1, color = '#2f2b28' } = {}) {
  const iron = mats.metal(color);
  const m = mat4(pos, null, scale);
  const parts = [];
  // ring, roof, cap
  parts.push([iron, new THREE.TorusGeometry(0.035, 0.009, 4, 10).translate(0, -0.01, 0)]);
  parts.push([iron, new THREE.SphereGeometry(0.028, 6, 4).translate(0, -0.06, 0)]);
  parts.push([iron, new THREE.ConeGeometry(0.17, 0.12, 6, 1).translate(0, -0.12, 0)]);
  parts.push([iron, new THREE.CylinderGeometry(0.175, 0.175, 0.018, 6).translate(0, -0.185, 0)]);
  // corner posts & glass (glow)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push([iron, new THREE.BoxGeometry(0.018, 0.25, 0.018).translate(Math.sin(a) * 0.12, -0.32, Math.cos(a) * 0.12)]);
  }
  parts.push([mats.glow('#ffd79a', 0.9, 3.2), new THREE.CylinderGeometry(0.115, 0.1, 0.24, 6).translate(0, -0.32, 0)]);
  parts.push([iron, new THREE.CylinderGeometry(0.13, 0.11, 0.025, 6).translate(0, -0.455, 0)]);
  parts.push([iron, new THREE.SphereGeometry(0.025, 6, 4).translate(0, -0.48, 0)]);
  for (const [mat, g] of parts) F.add(mat, g.applyMatrix4(m), { cast: false });
  if (world) pushHalo(new THREE.Vector3(world.x, world.y - 0.32 * scale, world.z), 0.7 * scale);
}

/**
 * Fairy lights: sagging dark wires between points (local to F) with warm
 * bulbs; halos queued in world space via `toWorld(v)`. Returns the bulb count.
 */
export function addFairyLights(F, mats, points, toWorld, { sag = 0.08, spacing = 0.3 } = {}) {
  const wire = mats.metal('#2a2624');
  const bulbMat = mats.glow('#ffd79a', 0.9, 3.2);
  const tmp = new THREE.Vector3();
  let count = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const span = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const curve = sagCurve(a, b, span * sag, 16);
    const g = new THREE.TubeGeometry(curve, Math.max(8, Math.round(span * 8)), 0.006, 3, false);
    F.add(wire, g, { cast: false });
    const n = Math.max(1, Math.floor(span / spacing));
    for (let k = 0; k < n; k++) {
      const p = curve.getPointAt((k + 0.5) / n);
      F.add(wire, new THREE.CylinderGeometry(0.011, 0.011, 0.022, 5).translate(p.x, p.y - 0.014, p.z), { cast: false });
      const bulb = new THREE.SphereGeometry(0.022, 6, 4);
      bulb.scale(1, 1.3, 1);
      F.add(bulbMat, bulb.translate(p.x, p.y - 0.045, p.z), { cast: false, receive: false });
      tmp.set(p.x, p.y - 0.045, p.z);
      pushHalo(toWorld(tmp.clone()), 0.17);
      count++;
    }
  }
  return count;
}

/** Make a thin open surface visible from both sides (duplicate with flipped winding & normals). */
export function doubleFace(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const back = g.clone();
  const pos = back.attributes.position;
  const nor = back.attributes.normal;
  for (let i = 0; i < pos.count; i += 3) {
    for (const a of [pos, nor, back.attributes.uv].filter(Boolean)) {
      for (let k = 0; k < a.itemSize; k++) {
        const t = a.array[(i + 1) * a.itemSize + k];
        a.array[(i + 1) * a.itemSize + k] = a.array[(i + 2) * a.itemSize + k];
        a.array[(i + 2) * a.itemSize + k] = t;
      }
    }
  }
  for (let i = 0; i < nor.array.length; i++) nor.array[i] = -nor.array[i];
  const out = mergeGeometries([g, back], false);
  return out;
}
