// ─────────────────────────────────────────────────────────────────────────────
// Loft kit — geometry helpers, materials and per-material batching for the
// Code Loft treehouse.
//
// Everything is built from hundreds of small hand-made parts (planks, pegs,
// shakes, twigs, moss cushions …). Each part is baked (transform + UVs + an
// optional vertex colour) and merged PER MATERIAL by a Batch, so the whole
// loft costs a few dozen draw calls. Most materials are vertex-coloured
// painterly surfaces: the texture brings the detail, the vertex colour brings
// the hue, so every wood tone merges into ONE draw call per surface kind.
//
//   const B = new Batch();
//   B.add(mats.wood(WOOD.oak), board(1, 0.04, 0.2));
//   const F = B.at(matrix);   F.add(…)              // a local frame
//   B.build(group, 'loft');                          // one mesh per (material, shadow)
//
// Conventions: Y up. Around the Great Oak, azimuth `a` (radians) is measured
// from +Z towards +X (a = 0 is the door side, +90° the right side), like the
// oak's own shape.js. The DECK FRAME (deckFrame) has its origin at OAK.loft
// (top of the planks), +X pointing straight away from the trunk axis, +Z
// tangential (towards the front / the door side), Y up.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { OAK, oakRadiusAt } from '../../world/layout.js';
import { createNoise2D } from '../../core/noise.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const CX = OAK.x;
export const CZ = OAK.z;
export const noiseA = createNoise2D(51151);
export const noiseB = createNoise2D(8383);

// ─── colours ─────────────────────────────────────────────────────────────────
/** Average colours (sRGB) riding on the shared vertex-coloured surfaces. */
export const WOOD = {
  oak: '#a8845a',
  oakLight: '#c29d6c',
  plank: '#9c7a55',
  plankGrey: '#8f8478',
  plankNew: '#c4a272',
  walnut: '#5e4433',
  spruce: '#cbb088',
  cherry: '#985c40',
  frame: '#5a4030', // dark oak timber framing
  door: '#7a5236',
  shutter: '#4f6d6a', // a faded green-teal paint
  dark: '#3e2e22',
};
export const IRON = '#36312c';
export const BRASS = '#b88a3e';
export const COPPER = '#a8603a';

// ─── trunk geometry ──────────────────────────────────────────────────────────
/** World position at azimuth a, distance r from the trunk axis, height y. */
export function polar(a, r, y, out = new THREE.Vector3()) {
  return out.set(CX + Math.sin(a) * r, y, CZ + Math.cos(a) * r);
}
export function azimuthOf(x, z) {
  return Math.atan2(x - CX, z - CZ);
}
/** Outward unit normal of the trunk at azimuth a (horizontal). */
export function radial(a, out = new THREE.Vector3()) {
  return out.set(Math.sin(a), 0, Math.cos(a));
}

/**
 * The sculpted bark radius at (a, y): the oak builder's own surface when it is
 * built (ctx.oak.barkRadius), else the layout contract.
 */
export function makeBark(ctx) {
  const f = ctx.oak?.barkRadius;
  return f ? (a, y) => f(a, y) : (a, y) => oakRadiusAt(y);
}

/**
 * Height of the highest root surface at world (x, z) (−Infinity if no root is
 * there). Roots are sampled from ctx.oak.roots (elliptical cross-sections).
 */
export function makeRootTop(ctx, getHeight) {
  const roots = ctx.oak?.roots ?? [];
  const samples = [];
  const sz = { w: 0, h: 0 };
  for (const r of roots) {
    if (!r.curve || !r.size) continue;
    const n = Math.max(12, Math.ceil(r.length / 0.2));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const p = r.curve.getPointAt(u);
      r.size(u, sz, r.curve.getUtoTmapping(u));
      const t = r.curve.getTangentAt(u);
      samples.push({ x: p.x, z: p.z, y: p.y + getHeight(p.x, p.z), w: sz.w, h: sz.h, tx: t.x, tz: t.z });
    }
  }
  return (x, z) => {
    let best = -Infinity;
    for (const s of samples) {
      const dx = x - s.x, dz = z - s.z;
      if (Math.abs(dx) > s.w + 0.3 || Math.abs(dz) > s.w + 0.3) continue;
      // distance across the root (perpendicular to its tangent)
      const tl = Math.hypot(s.tx, s.tz) || 1;
      const along = (dx * s.tx + dz * s.tz) / tl;
      if (Math.abs(along) > 0.16) continue;
      const across = Math.abs((dx * s.tz - dz * s.tx) / tl);
      if (across >= s.w) continue;
      const k = across / s.w;
      best = Math.max(best, s.y + s.h * Math.sqrt(1 - k * k));
    }
    return best;
  };
}

/** The deck frame: origin at OAK.loft, +X away from the trunk, +Z tangential, Y up. */
export function deckFrame() {
  const dx = OAK.loft.x - CX, dz = OAK.loft.z - CZ;
  const D = Math.hypot(dx, dz);
  const X = new THREE.Vector3(dx / D, 0, dz / D);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3().crossVectors(X, Y);
  const matrix = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(OAK.loft.x, OAK.loft.y, OAK.loft.z);
  return {
    matrix,
    inverse: matrix.clone().invert(),
    /** distance of the deck origin from the trunk axis */
    D,
    /** azimuth of the deck centre around the trunk */
    a0: Math.atan2(dx, dz),
    X,
    Z,
    yaw: Math.atan2(-X.z, X.x), // rotation.y that maps local +X onto X
    toWorld(x, y, z, out = new THREE.Vector3()) {
      return out.set(x, y, z).applyMatrix4(matrix);
    },
    toLocal(v, out = new THREE.Vector3()) {
      return out.copy(v).applyMatrix4(this.inverse);
    },
    /** trunk-polar (a, distance from the axis) of a deck-local point */
    polarOf(x, z) {
      const wx = OAK.loft.x + X.x * x + Z.x * z;
      const wz = OAK.loft.z + X.z * x + Z.z * z;
      return { a: Math.atan2(wx - CX, wz - CZ), r: Math.hypot(wx - CX, wz - CZ) };
    },
  };
}

// ─── materials ───────────────────────────────────────────────────────────────
/**
 * The loft's shared materials (all cached in core/materials.js — never mutate).
 * Proxies ({ isProxy, material, color }) carry the vertex colour of the
 * vertex-coloured kinds; the Batch unwraps them.
 */
export function makeMats(ctx) {
  const m = ctx.materials;
  const proxy = (material, color) => ({ isProxy: true, material, color });
  const vc = (kind, extra = {}) => m.surface(kind, { vertexColors: true, ...extra });
  return {
    wood: (color = WOOD.oak) => proxy(vc('wood', { species: 'oak' }), color),
    timber: (color = '#8c7660') => proxy(vc('timber'), color),
    plaster: (color = '#efe3c6') => proxy(vc('plaster'), color),
    metal: (color = IRON) => proxy(vc('metal'), color),
    fabric: (color = '#c9b79a') => proxy(vc('fabric'), color),
    clay: (color = '#b5633e') => proxy(vc('clay'), color),
    paper: (color = '#efe6d0') => proxy(vc('paper'), color),
    /** plain painted / plastic / small bits (vertex coloured, no texture) */
    paint: (color = '#ffffff') => proxy(m.standard('#ffffff', { vertexColors: true, roughness: 0.72 }), color),
    bark: () => m.surface('bark', { mossy: 0.22 }),
    moss: () => m.surface('moss'),
    rope: () => m.surface('rope'),
    stone: () => m.surface('stone', { mossy: 0.4 }),
    /** individual instanced shakes: weathered timber, world-mapped so every shake differs */
    shingles: () => m.surface('timber', { triplanar: true, color: '#7a5a42' }),
    cap: (color = '#c4301f') => m.surface('mushroomCap', { color }),
    stem: () => m.surface('mushroomStem'),
    // no wind on these: the loft's geometry is merged in WORLD space, and the
    // shared wind sway scales with the local height (it would fling the cards)
    ivy: () => m.foliage({ variant: 'ivy', color: '#3f6d2e' }),
    fern: () => m.foliage({ variant: 'fern', color: '#4f7f36' }),
    /** warm window / lamp glows (two shared strengths keep the material count low) */
    warm: () => m.glow('#ffc46e', { day: 0.45, night: 1.9 }),
    warmBright: () => m.glow('#ffc46e', { day: 0.45, night: 1.9 }), // (same as warm: one draw call)
    red: () => m.glow('#ff5a3c', { day: 1.2, night: 2.6 }),
    /** the cool will-o'-wisp light of the glow-caps and the firefly jars */
    wisp: () => m.glow('#8ff3ff', { day: 0.35, night: 1.9 }),
  };
}

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

/** Per-vertex colour: fn(x, y, z, nx, ny, nz) → sRGB hex or THREE.Color. */
export function paintBy(geo, fn) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i));
    if (c?.isColor) _c.copy(c);
    else _c.set(c);
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * A Batch.build remap that folds the small vertex-coloured kinds (metal, fabric,
 * clay, paper) onto the shared untextured paint material — at the size of
 * bolts, cushions, pots and book spines the texture is invisible, and every
 * folded material saves a draw call.
 */
export function smallBitsRemap(mats, kinds = ['metal', 'fabric', 'clay', 'paper']) {
  const paint = mats.paint().material;
  return (m) => (m.vertexColors && kinds.includes(m.userData?.surface?.kind) ? paint : m);
}

/** Collects geometry per material and merges it into one mesh per (material, shadow) pair. */
export class Batch {
  constructor() {
    this.lists = new Map();
    this.tris = 0;
  }
  /** Add a geometry (consumed). opts: { cast = true, receive = true, color (vc materials), matrix } */
  add(material, geo, opts = {}) {
    if (material.isProxy) {
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
  /** A view of this batch that applies `matrix` to every added geometry. */
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
   * mergeShadow: put a material's casting and non-casting parts into ONE mesh
   * (fewer draw calls for small hotspot pieces).
   */
  build(parent, name = 'loft', { mergeShadow = false, remap = null } = {}) {
    const out = [];
    let lists = this.lists;
    if (remap) {
      // fold materials together (e.g. small metal / fabric bits onto the shared paint)
      const merged = new Map();
      for (const e of lists.values()) {
        const material = remap(e.material) ?? e.material;
        const key = `${material.uuid}|${e.cast ? 1 : 0}|${e.receive ? 1 : 0}`;
        const t = merged.get(key);
        if (t) t.geos.push(...e.geos);
        else merged.set(key, { ...e, material, geos: [...e.geos] });
      }
      lists = merged;
    }
    if (mergeShadow) {
      const merged = new Map();
      for (const e of lists.values()) {
        const t = merged.get(e.material.uuid);
        if (t) {
          t.geos.push(...e.geos);
          t.cast = t.cast || e.cast;
          t.receive = t.receive || e.receive;
        } else merged.set(e.material.uuid, { ...e, geos: [...e.geos] });
      }
      lists = merged;
    }
    for (const e of lists.values()) {
      const g = e.geos.length === 1 ? e.geos[0] : mergeGeometries(e.geos, false);
      if (!g) {
        console.warn(`[loft] merge failed for ${e.material.name}`);
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

/**
 * Merge every mesh under `group` by material (baking world transforms) — for
 * props built by other kits (string lights, lanterns). Keeps each material's
 * own attribute layout. Returns a new Group.
 */
export function mergeByMaterial(group, name = 'merged') {
  group.updateMatrixWorld(true);
  const by = new Map();
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const key = o.material.uuid + '|' + Object.keys(o.geometry.attributes).sort().join(',') + '|' + (o.geometry.index ? 'i' : 'n');
    if (!by.has(key)) by.set(key, { material: o.material, cast: o.castShadow, receive: o.receiveShadow, order: o.renderOrder, geos: [], raycast: o.raycast });
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    by.get(key).geos.push(g);
  });
  const out = new THREE.Group();
  out.name = name;
  for (const e of by.values()) {
    const g = e.geos.length === 1 ? e.geos[0] : mergeGeometries(e.geos, false);
    if (!g) continue;
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, e.material);
    mesh.castShadow = e.cast;
    mesh.receiveShadow = e.receive;
    mesh.renderOrder = e.order;
    if (e.raycast !== THREE.Mesh.prototype.raycast) mesh.raycast = () => {};
    mesh.matrixAutoUpdate = false;
    out.add(mesh);
  }
  return out;
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

/** Orient a geometry built along +X so it runs from a to b (centred), rolled so its +Y stays close to `up`. */
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
export function alongX(geo, a, b, up = [0, 1, 0]) {
  _a.set(a[0] ?? a.x, a[1] ?? a.y, a[2] ?? a.z);
  _b.set(b[0] ?? b.x, b[1] ?? b.y, b[2] ?? b.z);
  _x.subVectors(_b, _a).normalize();
  _y.set(up[0] ?? up.x, up[1] ?? up.y, up[2] ?? up.z);
  _z.crossVectors(_x, _y);
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).cross(_x);
  _z.normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  _m.setPosition(_a.lerp(_b, 0.5));
  geo.applyMatrix4(_m);
  return geo;
}

/** Matrix whose +Y points along `normal` (and +Z roughly along `forward`), at `pos`. */
export function frameOn(pos, normal, forward = null, target = new THREE.Matrix4()) {
  _y.copy(normal).normalize();
  if (forward) _z.copy(forward);
  else _z.set(0, 0, 1);
  _z.addScaledVector(_y, -_z.dot(_y));
  if (_z.lengthSq() < 1e-6) _z.set(1, 0, 0).addScaledVector(_y, -_y.x);
  _z.normalize();
  _x.crossVectors(_y, _z).normalize();
  return target.makeBasis(_x, _y, _z).setPosition(pos);
}

// ─── UVs ─────────────────────────────────────────────────────────────────────
const AX = { x: 0, y: 1, z: 2 };
/** Natural texture tile sizes (world units per repeat) of the uv-mapped surface kinds. */
export const TILE = { wood: 1.4, timber: 1.6, plaster: 2.2, shingles: 1.4, rope: 1, paper: 1, fabric: 0.5 };

/**
 * Planar "box" UVs in the part's own space, in world units × scale. The grain
 * (texture U) runs along `along`. `off` shifts the UVs so neighbours differ.
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

// ─── shapes ──────────────────────────────────────────────────────────────────
/**
 * A chamfered beam along X (length len, height h along Y, width w along Z):
 * an 8-sided section with `segs` length segments (so deforms can bend it).
 */
export function beamGeo(len, h, w, c = 0.012, segs = 1) {
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

/** beamGeo oriented along an axis: sizes are (w, h, d) like a BoxGeometry. */
export function beamBox(w, h, d, along = 'x', c = 0.012, segs = 1) {
  if (along === 'x') return beamGeo(w, h, d, c, segs);
  if (along === 'y') return beamGeo(h, w, d, c, segs).rotateZ(Math.PI / 2);
  return beamGeo(d, h, w, c, segs).rotateY(-Math.PI / 2);
}

/** A wooden board / part with grain UVs (grain along `along`); rng gives it its own UV offset. */
export function board(w, h, d, { along = 'x', c = 0.01, rng = null, scale = 1 / TILE.wood, segs = 0 } = {}) {
  const len = along === 'x' ? w : along === 'y' ? h : d;
  const g = beamBox(w, h, d, along, c, segs || Math.max(1, Math.round(len / 0.7)));
  return uvBox(g, along, scale, rng ? [rng.next() * 7, rng.next() * 7] : [0, 0]);
}

/**
 * A hand-hewn timber from a to b with a (w × h) section: never quite straight.
 * up: the direction the beam's h axis leans towards.
 */
export function timber(a, b, w, h, { rng = null, up = [0, 1, 0], c = 0.016, wobble = 0.012, scale = 1 / TILE.timber } = {}) {
  const A = Array.isArray(a) ? a : [a.x, a.y, a.z];
  const Bv = Array.isArray(b) ? b : [b.x, b.y, b.z];
  const len = Math.hypot(Bv[0] - A[0], Bv[1] - A[1], Bv[2] - A[2]);
  const segs = Math.max(1, Math.round(len / 0.45));
  const g = beamGeo(len, h, w, c, segs);
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
  return alongX(g, A, Bv, up);
}

/** Round peg / dowel head poking out of a face (tiny cylinder along +Z). */
export function peg(r = 0.016, len = 0.03) {
  const g = new THREE.CylinderGeometry(r, r * 1.1, len, 6, 1);
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * A crooked, tapering branch through `points` (Vector3 list): a tube with
 * lumps and a slight twist — bark-covered railings, twigs, knee braces.
 * Indexed, position + normal (no UVs needed: bark is world-mapped).
 */
export function branch(points, r0, r1 = r0 * 0.7, { radial = 6, seg = null, lump = 0.12, seed = 0, capStart = true, capEnd = true } = {}) {
  const curve = points instanceof THREE.Curve ? points : new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const len = curve.getLength();
  const segments = seg ?? Math.max(3, Math.ceil(len / 0.18));
  const frames = curve.computeFrenetFrames(segments, false);
  const pos = [];
  const idx = [];
  const P = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, P);
    const N = frames.normals[i], Bn = frames.binormals[i];
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j < radial; j++) {
      const ang = (j / radial) * TAU;
      const k = 1 + lump * noiseA(t * len * 2.2 + seed * 3.1, j * 0.9 + seed) + 0.06 * Math.sin(ang * 2 + t * 5 + seed);
      const c = Math.cos(ang) * r * k, s = Math.sin(ang) * r * k;
      pos.push(P.x + N.x * c + Bn.x * s, P.y + N.y * c + Bn.y * s, P.z + N.z * c + Bn.z * s);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial);
      const c2 = a + radial, d = b + radial;
      idx.push(a, c2, b, b, c2, d);
    }
  }
  const capAt = (i, dir) => {
    const t = i / segments;
    const centre = curve.getPointAt(t);
    const T = curve.getTangentAt(t).multiplyScalar(dir * (i === 0 ? r0 : r1) * 0.35);
    centre.add(T);
    const ci = pos.length / 3;
    pos.push(centre.x, centre.y, centre.z);
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial);
      if (dir < 0) idx.push(ci, b, a);
      else idx.push(ci, a, b);
    }
  };
  if (capStart) capAt(0, -1);
  if (capEnd) capAt(segments, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A plain tube along a curve or points (ropes, wires, cables, chains). */
export function tubeAlong(points, radius = 0.012, radial = 5, tubular = null) {
  const curve = points instanceof THREE.Curve ? points : new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2]))));
  const g = new THREE.TubeGeometry(curve, tubular ?? Math.max(6, Math.ceil(curve.getLength() / 0.08)), radius, radial, false);
  // rope UVs: U along (TubeGeometry already gives u along, v around) — scale by length
  const uv = g.attributes.uv;
  const L = curve.getLength();
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L * 6, uv.getY(i));
  return g;
}

/** Sagging catenary-ish curve between two points (ropes, wires, chains). */
export function sagCurve(a, b, sag, segments = 12) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t));
  }
  return new THREE.CatmullRomCurve3(pts);
}

/** A lumpy field stone, sitting roughly on y = 0. */
export function stoneGeo(rng, { r = 0.2, sx = 1, sy = 0.6, sz = 1, lump = 0.22, detail = 1 } = {}) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const ox = rng.next() * 50, oy = rng.next() * 50;
  deform(g, (v) => {
    const n = noiseA(v.x * 1.3 + ox, v.y * 1.3 + v.z * 0.7 + oy) * 0.6 + noiseB(v.z * 2.6 + oy, v.x * 2.6 - ox) * 0.4;
    v.multiplyScalar(1 + n * lump);
    if (v.y > 0.55) v.y = 0.55 + (v.y - 0.55) * 0.35;
    if (v.y < -0.6) v.y = -0.6 + (v.y + 0.6) * 0.3;
    v.set(v.x * r * sx, v.y * r * sy, v.z * r * sz);
  });
  return g;
}

/** A soft moss cushion (flattened lumpy dome) sitting on y = 0, facing +Y. */
export function mossGeo(rng, { r = 0.25, h = 0.08, sx = 1, sz = 1 } = {}) {
  let g = new THREE.SphereGeometry(1, 9, 4, 0, TAU, 0, Math.PI / 2);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const ox = rng.next() * 40;
  deform(g, (v) => {
    const n = noiseA(v.x * 2.2 + ox, v.z * 2.2 - ox);
    const k = 1 + n * 0.25;
    v.set(v.x * r * sx * k, v.y * h * (0.8 + n * 0.5) - 0.012, v.z * r * sz * k);
  });
  return g;
}

/** Small toadstool (stem + cap + gills + spots) into a frame, all vertex-coloured paint. */
export function addToadstool(F, mats, rng, x, y, z, { size = 0.1, color = '#c9352a', lean = 0.18 } = {}) {
  const h = size * rng.range(1.0, 1.8);
  const stem = new THREE.CylinderGeometry(size * 0.15, size * 0.22, h, 6, 2);
  stem.translate(0, h / 2, 0);
  const cap = new THREE.SphereGeometry(size * 0.55, 10, 5, 0, TAU, 0, Math.PI / 2);
  cap.scale(1, 0.6 + rng.next() * 0.35, 1);
  cap.translate(0, h, 0);
  const gill = new THREE.CircleGeometry(size * 0.53, 10);
  gill.rotateX(Math.PI / 2);
  gill.translate(0, h + 0.002, 0);
  const rx = rng.jitter(lean), rz = rng.jitter(lean), ry = rng.next() * 6;
  for (const [g, c] of [[stem, '#efe4cc'], [cap, color], [gill, '#e6d3b0']]) {
    xf(g, [x, y, z], [rx, ry, rz]);
    F.add(mats.paint(), g, { color: c, cast: false });
  }
  if (color !== '#b98a4e') {
    for (let i = 0; i < 5; i++) {
      const a = rng.next() * TAU, el = rng.range(0.35, 1.1);
      const sp = new THREE.SphereGeometry(size * 0.065, 4, 3);
      const rr = size * 0.55;
      sp.translate(Math.cos(a) * Math.cos(el) * rr, h + Math.sin(el) * rr * 0.7, Math.sin(a) * Math.cos(el) * rr);
      xf(sp, [x, y, z], [rx, ry, rz]);
      F.add(mats.paint(), sp, { color: '#fff6e6', cast: false });
    }
  }
}

/**
 * A shelf (bracket) fungus: a half dome sticking out of a surface. Local frame:
 * attached at z = 0, growing into +Z, Y up. Returns { top, under } geometries.
 */
export function shelfFungus(r, rng) {
  const top = new THREE.SphereGeometry(r, 10, 4, 0, Math.PI, 0, Math.PI / 2);
  top.scale(1, 0.32 + rng.next() * 0.12, 0.85);
  // a wavy, growth-ringed rim
  deform(top, (v) => {
    const a = Math.atan2(v.z, v.x);
    v.multiplyScalar(1 + 0.06 * Math.sin(a * 7 + r * 40));
  });
  const under = new THREE.CircleGeometry(r * 0.97, 10, 0, Math.PI);
  under.rotateX(Math.PI / 2);
  under.scale(1, 1, 0.85);
  under.translate(0, 0.002, 0);
  return { top, under };
}

/**
 * Ivy strand cards (foliage 'ivy': stem at the bottom centre, growing to +V).
 * Lay a card with its stem at `base`, growing along `dir`, facing `normal`.
 */
export function ivyCard(base, dir, normal, size, flip = false) {
  const up = dir.clone().normalize();
  const n = normal.clone().addScaledVector(up, -normal.dot(up)).normalize();
  const across = new THREE.Vector3().crossVectors(up, n).normalize();
  const pos = [];
  const nor = [];
  const uv = [];
  const C = [[-0.5, 0, 0, 0], [0.5, 0, 1, 0], [0.5, 1, 1, 1], [-0.5, 1, 0, 1]];
  for (const [cx, cy, tu, tv] of C) {
    pos.push(base.x + (across.x * cx + up.x * cy) * size, base.y + (across.y * cx + up.y * cy) * size, base.z + (across.z * cx + up.z * cy) * size);
    nor.push(n.x, n.y, n.z);
    uv.push(flip ? 1 - tu : tu, tv);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** A fan of fern fronds (foliage 'fern' cards) at (x, y, z) into frame F. */
export function addFern(F, mats, rng, x, y, z, { size = 0.45, fronds = 7 } = {}) {
  for (let i = 0; i < fronds; i++) {
    const L = size * rng.range(0.7, 1.15);
    const g = new THREE.PlaneGeometry(L * 0.34, L, 1, 4);
    g.translate(0, L / 2, 0);
    deform(g, (v) => {
      const t = v.y / L;
      v.z += t * t * L * 0.55;
    });
    const a = (i / fronds) * TAU + rng.jitter(0.4);
    xf(g, [x, y, z], [-0.35 + rng.jitter(0.2), a, 0, 'YXZ']);
    F.add(mats.fern(), g, { cast: false });
  }
}

/** Flower colours of the window boxes, pots and baskets. */
export const BLOOMS = ['#e85d75', '#ffd166', '#f4f1ff', '#c77dff', '#ff8c42', '#f08aa8', '#ffffff'];

let _petals = null;
/** A five-petal flower head (flat, facing +Y, radius 1), shared & cloned. */
function petalGeo() {
  if (!_petals) {
    const s = new THREE.Shape();
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * TAU;
      const r = 0.45 + 0.55 * Math.abs(Math.cos(a * 2.5)); // five round petals
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    }
    _petals = new THREE.ShapeGeometry(s, 1).rotateX(-Math.PI / 2);
    // cup the petals up a little
    deform(_petals, (v) => (v.y = (v.x * v.x + v.z * v.z) * 0.25), true);
  }
  return _petals.clone();
}

/**
 * A tuft of greenery with little flowers on stems at (x, y, z) into frame F:
 * a few fern / ivy cards, 3–7 five-petal blooms with a yellow eye. Replaces
 * the old "balls of colour" in window boxes, pots and baskets.
 */
export function addFlowerTuft(F, mats, rng, x, y, z, { r = 0.1, h = 0.14, blooms = 4, colors = BLOOMS, fern = false } = {}) {
  const leafMat = fern ? mats.fern() : mats.ivy();
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + rng.jitter(0.5);
    const L = h * rng.range(1.0, 1.5);
    const g = new THREE.PlaneGeometry(L * 0.5, L, 1, 2).translate(0, L / 2, 0);
    deform(g, (v) => (v.z += (v.y / L) ** 2 * L * 0.5), true);
    xf(g, [x + Math.cos(a) * r * 0.3, y, z + Math.sin(a) * r * 0.3], [-0.3 + rng.jitter(0.2), a, 0, 'YXZ']);
    F.add(leafMat, g, { cast: false });
  }
  const col = rng.pick(colors);
  for (let k = 0; k < blooms; k++) {
    const a = rng.next() * TAU, rr = Math.sqrt(rng.next()) * r;
    const fy = y + h * rng.range(0.55, 1.05);
    const p = [x + Math.cos(a) * rr, fy, z + Math.sin(a) * rr];
    F.add(mats.paint(), xf(new THREE.CylinderGeometry(0.004, 0.005, fy - y, 3).translate(0, -(fy - y) / 2, 0), p), { color: '#4f7a34', cast: false });
    const fs = rng.range(0.026, 0.04);
    const tilt = [rng.jitter(0.5), rng.next() * TAU, rng.jitter(0.5), 'YXZ'];
    F.add(mats.paint(), xf(petalGeo(), p, tilt, fs), { color: rng.next() < 0.75 ? col : rng.pick(colors), cast: false });
    F.add(mats.paint(), xf(new THREE.SphereGeometry(fs * 0.32, 5, 3), [p[0], p[1] + fs * 0.12, p[2]]), { color: '#f2b62e', cast: false });
  }
}

// ─── shingles (instanced) ────────────────────────────────────────────────────
/**
 * One wooden shake with a rounded butt, slightly cupped, lying in the XY
 * plane: width along X, length along +Y (butt at y = 0), facing +Z.
 */
export function shingleGeo(w = 0.2, l = 0.34, t = 0.024) {
  const g = new THREE.BoxGeometry(w, l, t, 3, 2, 1);
  g.translate(0, l / 2, 0);
  deform(g, (v) => {
    const xn = v.x / (w / 2);
    if (v.y < l * 0.34) {
      const k = 1 - v.y / (l * 0.34);
      v.y += k * k * Math.abs(xn) * l * 0.18;
    }
    v.z += (1 - xn * xn) * 0.006;
    if (v.z > 0) v.z += (1 - v.y / l) * 0.008;
  });
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / w + 0.5;
    uv[i * 2 + 1] = pos.getY(i) / l;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
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
  build(parent, material, geo = shingleGeo(), name = 'loft-shingles') {
    const n = this.matrices.length;
    if (!n) return null;
    const mesh = new THREE.InstancedMesh(geo, material, n);
    for (let i = 0; i < n; i++) {
      mesh.setMatrixAt(i, this.matrices[i]);
      mesh.setColorAt(i, this.colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox?.();
    parent.add(mesh);
    return mesh;
  }
}

/**
 * Lay shakes on a planar roof slope (all Vector3 in the field's space):
 *   origin: eave point at the start of the rows; alongDir: along the eave;
 *   upDir: up the slope; normal: outwards. length × height of the slope.
 *   opts: { w, exposure, rng, skip(u, v), tint(u, v, colour, p), transform(p) }
 */
export function layShingles(field, { origin, alongDir, upDir, normal, length, height, w = 0.2, exposure = 0.12, rng, skip = null, tint = null, transform = null }) {
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
      if (rng.next() < 0.015) continue; // a missing shake here and there
      p.copy(origin).addScaledVector(alongDir, u).addScaledVector(upDir, v).addScaledVector(normal, 0.012 + (r % 2) * 0.004);
      if (transform) transform(p, u, v);
      rot.makeRotationFromEuler(_e.set(-0.07 + rng.jitter(0.03), rng.jitter(0.03), rng.jitter(0.07)));
      m.copy(basis).multiply(rot);
      const sw = rng.range(0.85, 1.12);
      m.scale(_s.set(sw, rng.range(0.92, 1.08), 1));
      m.setPosition(p);
      const g = rng.range(0.78, 1.08);
      col.setRGB(g, g * rng.range(0.94, 1.0), g * rng.range(0.86, 0.98));
      if (tint) tint(u, v, col, p);
      field.push(m, col);
    }
  }
}

// ─── glow halos ──────────────────────────────────────────────────────────────
/** Collected soft halos (world space): { warm: [...], cool: [...] } → glowQuads at the end. */
export class Halos {
  constructor() {
    this.sets = new Map();
  }
  push(p, size = 0.6, color = '#ffc46e') {
    if (!this.sets.has(color)) this.sets.set(color, []);
    this.sets.get(color).push({ x: p.x, y: p.y, z: p.z, size });
  }
  build(ctx, parent, opts = {}) {
    for (const [color, pts] of this.sets) {
      if (!pts.length) continue;
      const m = ctx.props.glowQuads(pts, color, { day: opts.day ?? 0.1, night: opts.night ?? 0.95 });
      m.name = 'loft-halos';
      parent.add(m);
    }
  }
}
