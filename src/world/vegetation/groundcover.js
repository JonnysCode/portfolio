// ─────────────────────────────────────────────────────────────────────────────
// Solid ground cover: mossy rocks & boulders, soft moss mounds, fallen mossy
// logs (with shelf fungi and broken ends), twigs and small exposed roots.
// Everything is unique, hand-shaped geometry accumulated into GeoBuilders
// and merged per material by the caller (vegetation.js).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise2D } from '../../core/noise.js';
import { getHeight, getNormal } from '../ground.js';
import { TAU } from './common.js';

const noise = createNoise2D(31337);

/** Linear mean colour of the bark texture (vertex-coloured bark = neutral at this colour). */
export const BARK_MEAN = '#6a5845';
/** Velvety moss tint for vertex-coloured bark & rock (linear-ish sRGB hex). */
export const MOSS_TINT = '#55702a';
const UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();

let icoCache = null;
/** Indexed unit icosphere (smooth after displacement). */
function ico() {
  if (!icoCache) {
    const g = new THREE.IcosahedronGeometry(1, 2);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    icoCache = mergeVertices(g);
  }
  return icoCache;
}

/**
 * A mossy rock, half sunk into the soil. size = radius; flat = vertical squash.
 * Writes into builder B (rock material; moss comes from the material's mossy option).
 */
export function mossyRock(B, rng, x, z, size, { flat = 0.6, sink = 0.32, color = null } = {}) {
  const src = ico();
  const g = src.clone();
  const p = g.attributes.position;
  const s = rng.range(0, 100);
  const sx = rng.range(0.85, 1.25), sz = rng.range(0.75, 1.15);
  for (let i = 0; i < p.count; i++) {
    _p.fromBufferAttribute(p, i);
    // blocky, layered boulder: big lumps + a few flat facets
    let k = 1 + 0.22 * noise(_p.x * 1.4 + s, _p.z * 1.4 + _p.y * 1.1) + 0.08 * noise(_p.x * 4 - s, _p.y * 4 + _p.z * 3);
    if (_p.y > 0.55) k *= 0.92; // flattened top
    _p.multiplyScalar(k);
    _p.set(_p.x * sx, _p.y * flat, _p.z * sz);
    p.setXYZ(i, _p.x, _p.y, _p.z);
  }
  g.computeVertexNormals();
  const y = getHeight(x, z) - size * flat * sink;
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.jitter(0.15), rng.range(0, TAU), rng.jitter(0.15))),
    new THREE.Vector3(size, size, size),
  );
  B.addGeometry(g, m, color);
  // the true top (after the lumps and the tilt), so snails & co. sit on the stone
  let top = -Infinity;
  for (let i = 0; i < p.count; i++) {
    _p.fromBufferAttribute(p, i).applyMatrix4(m);
    if (Math.hypot(_p.x - x, _p.z - z) < size * 0.45) top = Math.max(top, _p.y);
  }
  g.dispose();
  return { x, z, r: size * Math.max(sx, sz), top: Number.isFinite(top) ? top : y + size * flat };
}

/** A soft moss mound / cushion (moss material). */
export function mossMound(B, rng, x, z, w, h, { color = null } = {}) {
  const seg = 14, rings = 5;
  const base = B.count;
  const idx0 = B.idx.length;
  const s = rng.range(0, 100);
  const sx = rng.range(0.75, 1.3);
  const yaw = rng.range(0, TAU);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const c = color ?? new THREE.Color(1, 1, 1);
  for (let k = 0; k <= rings; k++) {
    const t = k / rings; // 0 centre → 1 edge
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU;
      const lump = 1 + 0.18 * noise(Math.cos(a) * 1.3 + s, Math.sin(a) * 1.3 + t);
      const lx = Math.cos(a) * w * t * lump * sx;
      const lz = Math.sin(a) * w * t * lump;
      const px = x + lx * cy - lz * sy;
      const pz = z + lx * sy + lz * cy;
      // dome profile; the rim dips below the soil
      const hh = h * Math.pow(Math.max(0, 1 - t * t), 0.8) * (1 + 0.15 * noise(px * 2.1, pz * 2.1)) - (t > 0.95 ? h * 0.25 : 0);
      const py = getHeight(px, pz) + hh - 0.01;
      B.vert(px, py, pz, 0, 1, 0, 0, 0, c);
      if (k === 0) break; // single centre vertex
    }
  }
  // indices: centre fan then rings
  for (let i = 0; i < seg; i++) B.tri(base, base + 1 + ((i + 1) % seg), base + 1 + i);
  for (let k = 1; k < rings; k++) {
    const a0 = base + 1 + (k - 1) * seg, b0 = base + 1 + k * seg;
    for (let i = 0; i < seg; i++) {
      const i1 = (i + 1) % seg;
      B.quad(a0 + i, a0 + i1, b0 + i1, b0 + i);
    }
  }
  B.smoothNormals(base, idx0);
  return { x, z, r: w * sx, top: getHeight(x, z) + h };
}

/**
 * A tube along points with radii (bark material, triplanar — no UVs needed).
 * opts.wob(i, θ) → radius multiplier, opts.color(i) → Color, opts.capEnd: close the end.
 * opts.vcol(i, j, normal, position) → Color per vertex (moss on the upper side …), wins over color.
 */
export function tube(B, pts, radii, seg, { wob = null, color = null, vcol = null, capStart = false, capEnd = false } = {}) {
  const n = pts.length;
  const base = B.count;
  const frames = [];
  let prevX = null;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    _t.subVectors(b, a).normalize();
    // parallel transport the side vector to avoid twisting
    let x;
    if (!prevX) {
      const ref = Math.abs(_t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP;
      x = new THREE.Vector3().crossVectors(ref, _t).normalize();
    } else {
      x = prevX.clone().addScaledVector(_t, -prevX.dot(_t)).normalize();
    }
    const z = new THREE.Vector3().crossVectors(x, _t).normalize();
    frames.push({ x, z, t: _t.clone() });
    prevX = x;
  }
  for (let i = 0; i < n; i++) {
    const { x, z } = frames[i];
    const c = color ? color(i) : null;
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * TAU;
      const w = wob ? wob(i, th) : 1;
      const r = radii[i] * w;
      const cx = Math.cos(th), sz = Math.sin(th);
      _n.set(0, 0, 0).addScaledVector(x, cx).addScaledVector(z, sz);
      _p.copy(pts[i]).addScaledVector(_n, r);
      B.vert(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z, j / seg, i / (n - 1), vcol ? vcol(i, j, _n, _p) : c);
    }
  }
  const row = seg + 1;
  // (θ runs clockwise seen from the tube's tangent, so outward faces wind a → a+row → …)
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = base + i * row + j;
      B.quad(a, a + row, a + row + 1, a + 1);
    }
  }
  const cap = (i, dirSign) => {
    const p = pts[i];
    const t = frames[i].t;
    const ci = B.vert(p.x + t.x * radii[i] * 0.3 * dirSign, p.y + t.y * radii[i] * 0.3 * dirSign, p.z + t.z * radii[i] * 0.3 * dirSign, t.x * dirSign, t.y * dirSign, t.z * dirSign, 0.5, 0.5, color ? color(i) : null);
    for (let j = 0; j < seg; j++) {
      const a = base + i * row + j;
      if (dirSign > 0) B.tri(ci, a + 1, a);
      else B.tri(ci, a, a + 1);
    }
  };
  if (capStart) cap(0, -1);
  if (capEnd) cap(n - 1, 1);
}

/** Points along the ground from (x0,z0) heading `yaw`, hugging getHeight with an offset. */
function groundPath(x0, z0, yaw, len, steps, lift, curve = 0) {
  const pts = [];
  let a = yaw;
  let x = x0, z = z0;
  for (let i = 0; i <= steps; i++) {
    pts.push(new THREE.Vector3(x, getHeight(x, z) + (typeof lift === 'function' ? lift(i / steps) : lift), z));
    a += curve / steps;
    x += Math.sin(a) * (len / steps);
    z += Math.cos(a) * (len / steps);
  }
  return pts;
}

/**
 * A fallen, mossy log lying on the ground (bark material) with jagged broken
 * ends. Returns { pts, r, brackets: [{ p, n }] } — spots for shelf fungi.
 */
export function fallenLog(B, rng, x, z, len, r, yaw) {
  const steps = Math.max(6, Math.round(len * 2.5));
  const pts = groundPath(x - Math.sin(yaw) * len / 2, z - Math.cos(yaw) * len / 2, yaw, len, steps, (t) => r * 0.62 + Math.sin(t * Math.PI) * r * 0.05, rng.jitter(0.25));
  const radii = pts.map((_, i) => r * (1 - 0.18 * (i / steps)) * (1 + 0.06 * Math.sin(i * 1.7)));
  const s = rng.range(0, 10);
  const bark = new THREE.Color(BARK_MEAN).multiplyScalar(0.85);
  const moss = new THREE.Color(MOSS_TINT);
  const mc = new THREE.Color();
  // moss blankets the upper side, creeping down in tongues; the broken ends stay bare
  const logMoss = (i, j, nrm, p) => {
    const tongue = 0.25 * noise(p.x * 1.7 + s, p.z * 1.7) + 0.15 * noise(p.x * 5, p.z * 5 + p.y * 3);
    const end = i === 0 || i === steps ? 0.35 : 1;
    const m = THREE.MathUtils.smoothstep(nrm.y + tongue, -0.15, 0.35) * end;
    return mc.copy(bark).lerp(moss, m * 0.92);
  };
  tube(B, pts, radii, 14, {
    vcol: logMoss,
    wob: (i, th) => {
      // broken, splintered ends: radius jags near both tips
      const end = i === 0 || i === steps ? 0.75 + 0.35 * Math.abs(Math.sin(th * 5 + s)) : 1;
      return end * (1 + 0.05 * Math.sin(th * 7 + i));
    },
    capStart: true,
    capEnd: true,
  });
  // a stubby broken branch
  if (len > 2.5) {
    const k = Math.floor(steps * rng.range(0.3, 0.7));
    const p0 = pts[k].clone().add(new THREE.Vector3(0, radii[k] * 0.5, 0));
    const side = rng.chance(0.5) ? 1 : -1;
    const dir = new THREE.Vector3(Math.cos(yaw) * side, 0.8, -Math.sin(yaw) * side).normalize();
    const l = r * rng.range(1.5, 2.6);
    tube(B, [p0, p0.clone().addScaledVector(dir, l * 0.5), p0.clone().addScaledVector(dir, l)], [r * 0.32, r * 0.26, r * 0.18], 7, { capEnd: true });
  }
  const brackets = [];
  const nb = rng.int(1, 4);
  for (let i = 0; i < nb; i++) {
    const k = rng.int(1, steps - 1);
    const side = rng.chance(0.5) ? 1 : -1;
    const n = new THREE.Vector3(Math.cos(yaw) * side, 0, -Math.sin(yaw) * side);
    brackets.push({ p: pts[k].clone().addScaledVector(n, radii[k] * 0.95).add(new THREE.Vector3(0, rng.range(-0.1, 0.25) * r, 0)), n });
  }
  return { pts, r, brackets };
}

/** A small exposed root snaking out of the soil (bark material). */
export function smallRoot(B, rng, x, z, yaw, len, r) {
  const steps = 7;
  const pts = groundPath(x, z, yaw, len, steps, (t) => r * (0.55 - t * 1.0) + Math.sin(t * Math.PI * 2) * r * 0.25, rng.jitter(0.8));
  const radii = pts.map((_, i) => r * (1 - 0.75 * (i / steps)));
  tube(B, pts, radii, 6, {});
}

/** A thin twig lying on the ground, with a fork. */
export function twig(B, rng, x, z) {
  const yaw = rng.range(0, TAU);
  const len = rng.range(0.25, 0.7);
  const r = rng.range(0.008, 0.018);
  const pts = groundPath(x, z, yaw, len, 3, r, rng.jitter(0.6));
  tube(B, pts, pts.map((_, i) => r * (1 - i * 0.2)), 4, {});
  if (rng.chance(0.6)) {
    const k = 1 + Math.floor(rng.next() * 2);
    const a = yaw + rng.range(0.4, 0.9) * (rng.chance(0.5) ? 1 : -1);
    const p0 = pts[k];
    const p1 = p0.clone().add(new THREE.Vector3(Math.sin(a) * len * 0.35, 0.005, Math.cos(a) * len * 0.35));
    p1.y = getHeight(p1.x, p1.z) + r * 0.7;
    tube(B, [p0, p1], [r * 0.7, r * 0.4], 4, {});
  }
}

/** Ground normal convenience (re-export). */
export { getNormal };

/**
 * An old, saw-cut tree stump: a flared, mossy bark side (bark builder B) and
 * a clean cut face with growth rings, heartwood checks and a pale sapwood
 * band (vertex-coloured, face builder F). Returns { top, r, brackets }.
 */
export function stump(B, F, rng, x, z, r, h) {
  const y0 = getHeight(x, z);
  const steps = 5;
  const seg = 16;
  const tilt = new THREE.Vector3(rng.jitter(0.08), 1, rng.jitter(0.08)).normalize();
  const pts = [];
  const radii = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(new THREE.Vector3(x + tilt.x * h * t, y0 - 0.25 + (h + 0.25) * t, z + tilt.z * h * t));
    // root flare at the foot
    radii.push(r * (1 + 0.45 * Math.pow(1 - t, 3)));
  }
  const bark = new THREE.Color(BARK_MEAN).multiplyScalar(0.85);
  const moss = new THREE.Color(MOSS_TINT);
  const mc = new THREE.Color();
  const s = rng.range(0, 10);
  tube(B, pts, radii, seg, {
    wob: (i, th) => 1 + 0.06 * Math.sin(th * 5 + s) + (i < 2 ? 0.1 * Math.max(0, Math.sin(th * 4 + s)) : 0),
    vcol: (i, j, nrm, p) => {
      const m = THREE.MathUtils.smoothstep(1 - i / steps + 0.35 * noise(p.x * 3 + s, p.y * 2 + p.z * 3), 0.35, 0.8);
      return mc.copy(bark).lerp(moss, m * 0.9).clone();
    },
  });
  // the cut face: concentric growth rings (narrower towards the bark), a few radial checks
  const top = pts[steps];
  const rings = 9;
  const base = F.count;
  const early = new THREE.Color('#c9a26a'), late = new THREE.Color('#9c7446'), sap = new THREE.Color('#dcc08a'), heart = new THREE.Color('#8e6438');
  F.vert(top.x, top.y + 0.004, top.z, tilt.x, tilt.y, tilt.z, 0.5, 0.5, heart);
  const ref = new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(tilt, ref).normalize();
  const v = new THREE.Vector3().crossVectors(u, tilt).normalize();
  for (let k = 1; k <= rings; k++) {
    const f = Math.pow(k / rings, 0.8);
    const c = k === rings ? sap : k % 2 ? late : early;
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * TAU;
      const rr = r * f * 0.97 * (1 + 0.06 * Math.sin(th * 5 + s));
      // radial drying checks darken a couple of wedges
      const check = Math.abs(Math.sin(th * 1.5 + s * 2)) < 0.06 && k < rings - 1 ? 0.55 : 1;
      const p = top.clone().addScaledVector(u, Math.cos(th) * rr).addScaledVector(v, Math.sin(th) * rr);
      F.vert(p.x, p.y + 0.004 - f * 0.01, p.z, tilt.x, tilt.y, tilt.z, 0.5 + 0.5 * Math.cos(th) * f, 0.5 + 0.5 * Math.sin(th) * f, c.clone().multiplyScalar(check * (0.92 + 0.08 * rng.next())));
    }
  }
  for (let j = 0; j < seg; j++) F.tri(base, base + 1 + ((j + 1) % seg), base + 1 + j);
  for (let k = 1; k < rings; k++) {
    const a0 = base + 1 + (k - 1) * seg, b0 = base + 1 + k * seg;
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      F.quad(a0 + j, a0 + j1, b0 + j1, b0 + j);
    }
  }
  const brackets = [];
  const nb = rng.int(0, 3);
  for (let i = 0; i < nb; i++) {
    const a = rng.range(0, TAU);
    const n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    brackets.push({ p: new THREE.Vector3(x + n.x * r * 1.02, y0 + rng.range(0.1, h * 0.8), z + n.z * r * 1.02), n });
  }
  return { top: top.y, r, brackets, x, z };
}
