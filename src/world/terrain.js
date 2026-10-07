// ─────────────────────────────────────────────────────────────────────────────
// The forest floor of the glen.
//
// One terrain mesh straight from ground.js' baked grids (heights match
// getHeight() exactly — every builder sits things on it), painted per pixel
// by the splat shader in vegetation/terrainShader.js: velvety moss carpet in
// broad sunlit/deep patches, dark humus and leaf litter (around the Great
// Oak's roots, the dressed rings around the houses, under the forest wall),
// worn packed earth along the paths with ragged mossy edges, damp darker soil
// by the stream and the pond, rising mossy slopes at the rim — and, every few
// units, a change of character (common.groundPatches, baked per vertex as
// aPatch): dark velvet moss cushions, brown leaf-litter drifts, clover mats,
// bare soil with needles and pebbles, over a soft micro-relief (aRelief: the
// slope of common.microRelief, shading only — getHeight() stays exact).
//
// Plus the flagstones / stepping stones along every path
// (vegetation/pathStones.js) — individual irregular stones, sunk in.
//
// The mesh is a radial LOD (see lodLattice): the glen at ground.js' 0.5-unit
// bake resolution, the forest wall at 1-unit, the misty rim at 2-unit cells,
// sized per quality tier (high ≈ 48k, medium ≈ 43k, low ≈ 38k triangles —
// the old uniform 280 × 280 grid was 157k).
//
// ctx.terrainMesh = the ground mesh (raycast target for ground clicks).
// Result (ctx.modules.terrain): { mesh, pathStones: [{ x, z, r }], stats: { triangles,
//   vertices, budget, overBudget }, budget: { high, medium, low } }
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { heightGrid, pathGrid, streamGrid, GRID_RES, PADS } from './ground.js';
import { TERRAIN_HALF_SIZE, OAK, STREAM } from './layout.js';
import { smoothstep } from '../core/rng.js';
import { makeTerrainMaterial } from './vegetation/terrainShader.js';
import { buildPathStones } from './vegetation/pathStones.js';
import { fieldBroad, fieldMid, groundPatches, microRelief } from './vegetation/common.js';
import { forestPlan } from './vegetation/plan.js';

// ─── radial LOD ──────────────────────────────────────────────────────────────
// The explorable glen gets ground.js' full 0.5-unit lattice (so the mesh is the
// very surface getHeight() samples); the forest wall gets 1-unit cells, the
// misty rim beyond 2-unit cells. Every vertex of every level sits ON the bake
// lattice (its height is read straight from heightGrid — no resampling), and
// the coarse cells that border a finer level are fanned around the finer
// level's edge midpoints, so the levels stitch without T-junction cracks.
// Rects are [x0, x1, z0, z1] in world units (multiples of the next level's cell).
const LOD = {
  high: { fine: [-31, 31, -29, 37], mid: [-46, 46, -44, 54] },
  medium: { fine: [-28, 28, -27, 34], mid: [-44, 44, -42, 50] },
  low: { fine: [-26, 26, -25, 32], mid: [-40, 40, -40, 46] },
};
/** Triangle budgets per tier (ctx.modules.terrain.budget; checked against stats.triangles). */
export const TERRAIN_BUDGET = { high: 50000, medium: 44000, low: 40000 };

/**
 * Indexed lattice mesh: { lattice [ix, iz] per vertex, index } — ix/iz are
 * heightGrid columns/rows (0 … GRID_RES).
 */
export function lodLattice(tier) {
  const L = LOD[tier] ?? LOD.high;
  const CELL = (TERRAIN_HALF_SIZE * 2) / GRID_RES;
  const N = GRID_RES + 1;
  const toL = (w) => Math.round((w + TERRAIN_HALF_SIZE) / CELL);
  const rect = (r) => (r ? [toL(r[0]), toL(r[1]), toL(r[2]), toL(r[3])] : null);
  const full = [0, GRID_RES, 0, GRID_RES];
  // (cell size in lattice steps, outer rect, the finer level's rect inside it)
  const levels = [
    { s: 1, outer: rect(L.fine), inner: null },
    { s: 2, outer: rect(L.mid), inner: rect(L.fine) },
    { s: 4, outer: full, inner: rect(L.mid) },
  ];
  const map = new Map();
  const lattice = [];
  const index = [];
  const v = (ix, iz) => {
    const k = iz * N + ix;
    let i = map.get(k);
    if (i === undefined) {
      i = lattice.length / 2;
      map.set(k, i);
      lattice.push(ix, iz);
    }
    return i;
  };
  // (upward-facing order around a cell: (x0,z0) → (x0,z1) → (x1,z1) → (x1,z0))
  for (const { s, outer, inner } of levels) {
    const [ox0, ox1, oz0, oz1] = outer;
    for (let iz = oz0; iz < oz1; iz += s) {
      for (let ix = ox0; ix < ox1; ix += s) {
        const x1 = ix + s, z1 = iz + s;
        if (inner && ix >= inner[0] && x1 <= inner[1] && iz >= inner[2] && z1 <= inner[3]) continue;
        // edges that border the finer level carry its midpoint
        const h = s / 2;
        const zIn = inner && iz >= inner[2] && z1 <= inner[3];
        const xIn = inner && ix >= inner[0] && x1 <= inner[1];
        const left = zIn && ix === inner[1]; // x = x0 edge touches the inner rect's right side
        const right = zIn && x1 === inner[0];
        const bottom = xIn && iz === inner[3];
        const top = xIn && z1 === inner[2];
        if (!(left || right || bottom || top)) {
          const a = v(ix, iz), b = v(ix, z1), c = v(x1, z1), d = v(x1, iz);
          index.push(a, b, d, d, b, c);
          continue;
        }
        // transition cell: fan around its centre over the boundary polygon
        const poly = [[ix, iz]];
        if (left) poly.push([ix, iz + h]);
        poly.push([ix, z1]);
        if (top) poly.push([ix + h, z1]);
        poly.push([x1, z1]);
        if (right) poly.push([x1, iz + h]);
        poly.push([x1, iz]);
        if (bottom) poly.push([ix + h, iz]);
        const c = v(ix + h, iz + h);
        for (let k = 0; k < poly.length; k++) {
          const p = poly[k], q = poly[(k + 1) % poly.length];
          index.push(c, v(p[0], p[1]), v(q[0], q[1]));
        }
      }
    }
  }
  return { lattice, index, N, CELL };
}

export default async function build(ctx) {
  const tier = ctx.quality?.tier ?? 'high';
  const { lattice, index, N, CELL } = lodLattice(tier);
  const count = lattice.length / 2;
  const posArr = new Float32Array(count * 3);
  const splat = new Float32Array(count * 4);
  // mid-scale patches (cushions, drifts, clover, soil) & the micro-relief's slope
  const patch = new Float32Array(count * 4);
  const relief = new Float32Array(count * 2);
  const gp = {};
  const trees = forestPlan().trees;

  for (let i = 0; i < count; i++) {
    const ix = lattice[i * 2], iz = lattice[i * 2 + 1];
    const gi = iz * N + ix;
    const x = -TERRAIN_HALF_SIZE + ix * CELL;
    const z = -TERRAIN_HALF_SIZE + iz * CELL;
    posArr[i * 3] = x;
    posArr[i * 3 + 1] = heightGrid[gi];
    posArr[i * 3 + 2] = z;
    // x: on the path (1) → off it (0)
    const path = 1 - smoothstep(0.55, 1.25, pathGrid[gi]);
    // y: damp near the stream, the pool and the pond
    const sd = streamGrid[gi];
    let damp = 1 - smoothstep(STREAM.halfWidth + 0.1, STREAM.halfWidth + 3.6, sd);
    const pd = Math.hypot((x - STREAM.pond.x) * 0.9, z - STREAM.pond.z) - STREAM.pond.radius;
    damp = Math.max(damp, 1 - smoothstep(0, 3.2, pd));
    const qd = Math.hypot(x - STREAM.pool.x, z - STREAM.pool.z) - STREAM.pool.radius;
    damp = Math.max(damp, 1 - smoothstep(0, 3.5, qd));
    // z: leaf litter — broad patches, the oak's root zone, the forest wall's feet
    const r = Math.hypot(x, z);
    const od = Math.hypot(x - OAK.x, z - OAK.z);
    // (the open glen's broad patches are softer: its drifts come from aPatch)
    let litter = smoothstep(0.6, 0.85, fieldBroad(x, z)) * (0.35 + 0.25 * smoothstep(14, 24, r));
    litter = Math.max(litter, (1 - smoothstep(7, 13, od)) * smoothstep(3.2, 5, od) * 0.85);
    // (under the forest wall: litter in patches between moss — never one bare brown band)
    // (the open front band — seen only by the wide views, over the vignettes —
    //  keeps softer, fewer patches: no camouflage blotches)
    const front = smoothstep(16, 30, z);
    litter = Math.max(litter, smoothstep(23, 34, r) * (0.28 + 0.5 * smoothstep(0.35, 0.75, fieldMid(x, z))) * (1 - 0.45 * front));
    for (const t of trees) {
      const d = Math.hypot(x - t.x, z - t.z);
      if (d < t.radius * 4) litter = Math.max(litter, (1 - smoothstep(t.radius * 1.3, t.radius * 4, d)) * 0.95);
    }
    // w: trampled ground — the dressed rings around houses, workshop yards
    let tramp = 0;
    for (const p of PADS) {
      if (p.id === 'oak') continue;
      const d = Math.hypot(x - p.x, z - p.z);
      tramp = Math.max(tramp, (1 - smoothstep(p.r * 0.6, p.r + 1.2, d)) * (p.id.startsWith('bridge') ? 0.4 : 0.55));
    }
    splat.set([path, damp, litter, tramp], i * 4);
    if (r < 50) {
      groundPatches(x, z, gp);
      patch[i * 4] = gp.cushion;
      patch[i * 4 + 1] = gp.drift;
      patch[i * 4 + 2] = gp.clover;
      patch[i * 4 + 3] = gp.soil;
      const e = 0.3;
      relief[i * 2] = (microRelief(x + e, z) - microRelief(x - e, z)) / (2 * e);
      relief[i * 2 + 1] = (microRelief(x, z + e) - microRelief(x, z - e)) / (2 * e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
  geo.setAttribute('aPatch', new THREE.BufferAttribute(patch, 4));
  geo.setAttribute('aRelief', new THREE.BufferAttribute(relief, 2));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, makeTerrainMaterial(ctx));
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  ctx.scene.add(mesh);
  ctx.terrainMesh = mesh;

  // flagstones along the paths
  let pathStones = [];
  try {
    const stoneMat = ctx.materials.surface('rock', { mossy: 0.2, scale: 0.75, vertexColors: true, breakup: 0.6 });
    const res = buildPathStones(ctx, stoneMat);
    res.mesh.raycast = () => {};
    ctx.scene.add(res.mesh);
    pathStones = res.stones;
  } catch (err) {
    console.warn('[terrain] path stones failed', err);
  }

  const triangles = index.length / 3;
  const stats = { triangles, vertices: count, tier, budget: TERRAIN_BUDGET[tier] ?? TERRAIN_BUDGET.high };
  stats.overBudget = triangles > stats.budget;
  return { mesh, pathStones, stats, budget: TERRAIN_BUDGET };
}
