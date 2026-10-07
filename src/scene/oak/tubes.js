// ─────────────────────────────────────────────────────────────────────────────
// Organic tubes for the Great Oak: roots, limbs, branches, twigs, ivy stems.
//
// Unlike THREE.TubeGeometry these taper, have elliptical cross-sections (tall
// buttress roots), carry twisting bark furrows and lumps, can follow the
// ground, and are welded at the seam so they shade without a visible line.
// Output: indexed BufferGeometry with position / normal / uv — ready to be
// merged with the other bark geometry (all oak bark parts share this layout).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createNoise3D } from './noise3.js';

const nRelief = createNoise3D(101);
const nLump = createNoise3D(202);
const UP = new THREE.Vector3(0, 1, 0);

/**
 * @param {object} o
 *  curve      THREE.Curve (world space)
 *  segments   rings along the curve
 *  radial     vertices around
 *  size(t, out, tp) → writes out.w (half width) and out.h (half height); t ∈ [0,1] is
 *             the arc-length fraction, tp the curve parameter (control point i ↔ i/(n−1))
 *  frame      'up' (h axis = world up, for roots) | 'transport' (rotation-minimising, limbs)
 *  furrows    relative depth of bark furrows (0 = smooth), furrowFreq (around), twist (radians / unit length)
 *  lumps      relative low-frequency lumpiness
 *  seed       noise offset
 *  ground     optional fn(x, z) → height added to each ring centre (roots hug the terrain)
 *  uvScale    bark texture density
 *  capEnd     close the far end with a little dome (cut branch / twig tip)
 *  arc        [φ0, φ1] build only part of the circumference (φ = 0 is the "top" N axis) — moss caps
 *  shell(φ, s, t, x, y, z) extra outward offset (world units) after the relief — moss caps
 *             (x, y, z = the relief surface point before the offset)
 */
export function organicTube(o) {
  const {
    curve,
    segments = 24,
    radial = 12,
    size,
    frame = 'transport',
    furrows = 0.08,
    furrowFreq = 3.2,
    twist = 0.25,
    lumps = 0.06,
    seed = 0,
    ground = null,
    uvScale = 0.5,
    capEnd = false,
    arc = null,
    shell = null,
  } = o;
  const full = !arc;
  const phi0 = full ? 0 : arc[0];
  const phiSpan = full ? Math.PI * 2 : arc[1] - arc[0];
  const frames = curve.computeFrenetFrames(segments, false);
  const length = curve.getLength();
  const cols = radial + 1;
  const ringCount = segments + 1;
  const vCount = ringCount * cols + (capEnd ? 1 : 0);
  const pos = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  const sz = { w: 1, h: 1 };
  // texture wraps a whole number of times around the average circumference
  size(0.5, sz, curve.getUtoTmapping(0.5));
  const wraps = Math.max(1, Math.round((Math.PI * (sz.w + sz.h)) * uvScale));
  const sOff = seed * 13.37;
  for (let i = 0; i < ringCount; i++) {
    const t = i / segments;
    curve.getPointAt(t, P);
    if (ground) P.y += ground(P.x, P.z);
    T.copy(frames.tangents[i]);
    if (frame === 'up') {
      N.copy(UP).addScaledVector(T, -T.dot(UP));
      if (N.lengthSq() < 1e-6) N.copy(frames.normals[i]);
      N.normalize();
      B.crossVectors(T, N).normalize();
    } else {
      N.copy(frames.normals[i]);
      B.copy(frames.binormals[i]);
    }
    size(t, sz, curve.getUtoTmapping(t));
    const s = t * length;
    const lump = 1 + lumps * nLump(s * 0.45 + sOff, sOff * 0.5, 0.3);
    for (let j = 0; j < cols; j++) {
      const phi = phi0 + (j / radial) * phiSpan;
      const c = Math.cos(phi), sn = Math.sin(phi);
      // furrows: |noise| valleys along the twisting grain
      const pt = phi + s * twist;
      const f = Math.abs(nRelief(Math.cos(pt) * furrowFreq + sOff, Math.sin(pt) * furrowFreq, s * 0.35));
      const rel = 1 + furrows * (Math.min(f, 0.5) * 2 - 0.55);
      const k = lump * rel;
      let x = P.x + (N.x * c * sz.h + B.x * sn * sz.w) * k;
      let y = P.y + (N.y * c * sz.h + B.y * sn * sz.w) * k;
      let z = P.z + (N.z * c * sz.h + B.z * sn * sz.w) * k;
      if (shell) {
        // push along the cross-section's outward direction (ellipse normal)
        const off = shell(phi, s, t, x, y, z);
        const ox = N.x * c * sz.w + B.x * sn * sz.h;
        const oy = N.y * c * sz.w + B.y * sn * sz.h;
        const oz = N.z * c * sz.w + B.z * sn * sz.h;
        const l = Math.hypot(ox, oy, oz) || 1;
        x += (ox / l) * off;
        y += (oy / l) * off;
        z += (oz / l) * off;
      }
      const vi = i * cols + j;
      pos[vi * 3] = x;
      pos[vi * 3 + 1] = y;
      pos[vi * 3 + 2] = z;
      uv[vi * 2] = (j / radial) * wraps * (phiSpan / (Math.PI * 2));
      uv[vi * 2 + 1] = s * uvScale;
    }
  }
  const index = [];
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * cols + j, b = (i + 1) * cols + j;
      index.push(a, a + 1, b, a + 1, b + 1, b); // outward winding
    }
  }
  if (capEnd) {
    // a little rounded tip just past the last ring
    const ci = ringCount * cols;
    curve.getPointAt(1, P);
    if (ground) P.y += ground(P.x, P.z);
    size(1, sz, 1);
    T.copy(frames.tangents[segments]);
    P.addScaledVector(T, (sz.w + sz.h) * 0.45);
    pos[ci * 3] = P.x;
    pos[ci * 3 + 1] = P.y;
    pos[ci * 3 + 2] = P.z;
    uv[ci * 2] = 0;
    uv[ci * 2 + 1] = length * uvScale;
    const last = segments * cols;
    for (let j = 0; j < radial; j++) index.push(last + j, last + j + 1, ci);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  if (full) weldSeamNormals(g, ringCount, cols);
  return g;
}

/** Average the normals of the duplicated seam column (first & last vertex of each ring). */
export function weldSeamNormals(g, rows, cols) {
  const n = g.attributes.normal;
  const a = n.array;
  for (let i = 0; i < rows; i++) {
    const p = (i * cols) * 3, q = (i * cols + cols - 1) * 3;
    let x = a[p] + a[q], y = a[p + 1] + a[q + 1], z = a[p + 2] + a[q + 2];
    const l = Math.hypot(x, y, z) || 1;
    x /= l;
    y /= l;
    z /= l;
    a[p] = a[q] = x;
    a[p + 1] = a[q + 1] = y;
    a[p + 2] = a[q + 2] = z;
  }
  n.needsUpdate = true;
}

/** Linear interpolation through a table of samples at evenly spaced t. */
export function sampleTable(table, t) {
  const n = table.length - 1;
  const f = Math.min(Math.max(t, 0), 1) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const k = f - i;
  return table[i] + (table[i + 1] - table[i]) * k;
}

/** Smooth (Catmull-Rom) interpolation through a table of samples at evenly spaced t. */
export function smoothTable(table, t) {
  const n = table.length - 1;
  const f = Math.min(Math.max(t, 0), 1) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const k = f - i;
  const p0 = table[Math.max(i - 1, 0)], p1 = table[i], p2 = table[i + 1], p3 = table[Math.min(i + 2, n)];
  const k2 = k * k, k3 = k2 * k;
  return 0.5 * (2 * p1 + (-p0 + p2) * k + (2 * p0 - 5 * p1 + 4 * p2 - p3) * k2 + (-p0 + 3 * p1 - 3 * p2 + p3) * k3);
}
