// ─────────────────────────────────────────────────────────────────────────────
// TriGrid — a uniform grid over one big mesh's triangles, so a ray only tests
// the triangles in the cells it passes through (3D DDA), nearest cells first.
// The glen merges each module into a few meshes of 100–250 k triangles; a
// plain Mesh.raycast walks all of them. Built lazily (first query), in the
// mesh's local space, never rebuilt (static geometry only).
//
//   const g = triGrid(mesh)               (cached on mesh.userData.__triGrid)
//   g.raycastFirst(rayLocal, near, far)   → distance along the LOCAL ray | Infinity
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _s = new THREE.Vector3();
const _hit = new THREE.Vector3();
/** Triangles whose bounds cover more cells than this go into the always-tested list. */
const BIG_SPAN = 256;

/** Möller–Trumbore, double-sided. Returns t or -1. */
function rayTri(o, d, ax, ay, az, bx, by, bz, cx, cy, cz) {
  _e1.set(bx - ax, by - ay, bz - az);
  _e2.set(cx - ax, cy - ay, cz - az);
  _p.crossVectors(d, _e2);
  const det = _e1.dot(_p);
  if (det > -1e-9 && det < 1e-9) return -1;
  const inv = 1 / det;
  _s.set(o.x - ax, o.y - ay, o.z - az);
  const u = _s.dot(_p) * inv;
  if (u < 0 || u > 1) return -1;
  _q.crossVectors(_s, _e1);
  const v = d.dot(_q) * inv;
  if (v < 0 || u + v > 1) return -1;
  return _e2.dot(_q) * inv;
}

function build(geometry) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox.clone().expandByScalar(1e-3);
  const size = box.getSize(new THREE.Vector3());
  // ~24 triangles per cell, cells roughly cubic
  const cellsWanted = Math.max(8, Math.min(64000, triCount / 24));
  const vol = Math.max(1e-6, size.x * size.y * size.z);
  const edge = Math.cbrt(vol / cellsWanted);
  const nx = Math.max(1, Math.min(64, Math.ceil(size.x / edge)));
  const ny = Math.max(1, Math.min(64, Math.ceil(size.y / edge)));
  const nz = Math.max(1, Math.min(64, Math.ceil(size.z / edge)));
  const cw = size.x / nx, ch = size.y / ny, cd = size.z / nz;
  const P = pos.array, stride = pos.isInterleavedBufferAttribute ? pos.data.stride : 3, off = pos.isInterleavedBufferAttribute ? pos.offset : 0;
  const I = index ? index.array : null;
  const vi = (t, k) => (I ? I[t * 3 + k] : t * 3 + k);
  const cellOf = (v, min, c, n) => Math.min(n - 1, Math.max(0, Math.floor((v - min) / c)));
  // two passes: count, then fill one flat list
  const counts = new Uint32Array(nx * ny * nz + 1);
  const ranges = new Int32Array(triCount * 6);
  const big = [];
  for (let t = 0; t < triCount; t++) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const i = vi(t, k) * stride + off;
      const x = P[i], y = P[i + 1], z = P[i + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const r = t * 6;
    ranges[r] = cellOf(x0, box.min.x, cw, nx);
    ranges[r + 1] = cellOf(x1, box.min.x, cw, nx);
    ranges[r + 2] = cellOf(y0, box.min.y, ch, ny);
    ranges[r + 3] = cellOf(y1, box.min.y, ch, ny);
    ranges[r + 4] = cellOf(z0, box.min.z, cd, nz);
    ranges[r + 5] = cellOf(z1, box.min.z, cd, nz);
    // a long thin triangle across the grid would land in thousands of cells:
    // keep it in a short list that every ray tests instead
    const span = (ranges[r + 1] - ranges[r] + 1) * (ranges[r + 3] - ranges[r + 2] + 1) * (ranges[r + 5] - ranges[r + 4] + 1);
    if (span > BIG_SPAN) {
      big.push(t);
      ranges[r] = 1;
      ranges[r + 1] = 0; // (empty range: skipped below)
      continue;
    }
    for (let cz = ranges[r + 4]; cz <= ranges[r + 5]; cz++)
      for (let cy = ranges[r + 2]; cy <= ranges[r + 3]; cy++)
        for (let cx = ranges[r]; cx <= ranges[r + 1]; cx++) counts[(cz * ny + cy) * nx + cx + 1]++;
  }
  for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
  const start = counts.slice();
  const list = new Uint32Array(counts[counts.length - 1]);
  for (let t = 0; t < triCount; t++) {
    const r = t * 6;
    for (let cz = ranges[r + 4]; cz <= ranges[r + 5]; cz++)
      for (let cy = ranges[r + 2]; cy <= ranges[r + 3]; cy++)
        for (let cx = ranges[r]; cx <= ranges[r + 1]; cx++) list[start[(cz * ny + cy) * nx + cx]++] = t;
  }
  const stamp = new Uint16Array(triCount); // (wraps every 65535 queries)
  let query = 0;

  const ray = new THREE.Ray();
  return {
    triCount,
    /** First hit along a ray given in the mesh's local space (distance in local units), or Infinity. */
    raycastFirst(rayLocal, near, far) {
      ray.copy(rayLocal);
      const o = ray.origin, d = ray.direction;
      // enter the grid
      let tEnter = near;
      if (!box.containsPoint(_hit.copy(d).multiplyScalar(near).add(o))) {
        const at = ray.intersectBox(box, _hit);
        if (!at) return Infinity;
        tEnter = Math.max(near, o.distanceTo(at));
      }
      if (tEnter > far) return Infinity;
      query = (query + 1) & 0xffff;
      if (query === 0) stamp.fill(0), (query = 1);
      const px = o.x + d.x * tEnter, py = o.y + d.y * tEnter, pz = o.z + d.z * tEnter;
      let ix = cellOf(px, box.min.x, cw, nx), iy = cellOf(py, box.min.y, ch, ny), iz = cellOf(pz, box.min.z, cd, nz);
      const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
      const nextB = (i, s, min, c) => min + (s > 0 ? i + 1 : i) * c;
      const tdx = d.x !== 0 ? Math.abs(cw / d.x) : Infinity, tdy = d.y !== 0 ? Math.abs(ch / d.y) : Infinity, tdz = d.z !== 0 ? Math.abs(cd / d.z) : Infinity;
      let tmx = d.x !== 0 ? (nextB(ix, sx, box.min.x, cw) - o.x) / d.x : Infinity;
      let tmy = d.y !== 0 ? (nextB(iy, sy, box.min.y, ch) - o.y) / d.y : Infinity;
      let tmz = d.z !== 0 ? (nextB(iz, sz, box.min.z, cd) - o.z) / d.z : Infinity;
      let best = Infinity;
      for (const t of big) {
        stamp[t] = query;
        const a = vi(t, 0) * stride + off, b = vi(t, 1) * stride + off, cc = vi(t, 2) * stride + off;
        const h = rayTri(o, d, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[cc], P[cc + 1], P[cc + 2]);
        if (h >= near && h <= far && h < best) best = h;
      }
      for (let guard = 0; guard < nx + ny + nz + 3; guard++) {
        const c = (iz * ny + iy) * nx + ix;
        for (let k = counts[c]; k < counts[c + 1]; k++) {
          const t = list[k];
          if (stamp[t] === query) continue;
          stamp[t] = query;
          const a = vi(t, 0) * stride + off, b = vi(t, 1) * stride + off, cc = vi(t, 2) * stride + off;
          const h = rayTri(o, d, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[cc], P[cc + 1], P[cc + 2]);
          if (h >= near && h <= far && h < best) best = h;
        }
        const tExit = Math.min(tmx, tmy, tmz);
        if (best <= tExit || tExit > far) break;
        if (tmx <= tmy && tmx <= tmz) {
          ix += sx;
          if (ix < 0 || ix >= nx) break;
          tmx += tdx;
        } else if (tmy <= tmz) {
          iy += sy;
          if (iy < 0 || iy >= ny) break;
          tmy += tdy;
        } else {
          iz += sz;
          if (iz < 0 || iz >= nz) break;
          tmz += tdz;
        }
      }
      return best;
    },
  };
}

/** The (cached) grid of a static mesh. */
export function triGrid(mesh) {
  let g = mesh.userData.__triGrid;
  if (g === undefined) {
    try {
      g = build(mesh.geometry);
    } catch {
      g = null;
    }
    mesh.userData.__triGrid = g;
  }
  return g;
}
