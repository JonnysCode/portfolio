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
// The mesh is a radial LOD (see lodLattice): the glen (an ellipse) at
// ground.js' 0.5-unit bake resolution, the forest wall at 1-unit, the misty
// rim at 2-unit cells, sized per quality tier (the old uniform 280 × 280 grid
// was 157k triangles). TERRAIN_BUDGET covers the whole module (mesh + stones).
//
// ctx.terrainMesh = the ground mesh (raycast target for ground clicks).
// Result (ctx.modules.terrain): { mesh, pathStones: [{ x, z, r }], stats: { triangles,
//   vertices, budget, overBudget }, budget: { high, medium, low }, paintBlooms(zones) }
//   (paintBlooms: the vegetation paints its flower drifts' wash into aBloom)
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
//
// The fine level is an ELLIPSE around the glen (rx across, rz front-to-back,
// centred cz in front of the oak — the open front band the overview looks over
// keeps its fine floor), built from whole 1-unit blocks; its old rectangle's
// corners lay under the forest wall, where nothing ever sees a 0.5-unit cell.
// The mid level is a rectangle [x0, x1, z0, z1] (multiples of 2 units).
const LOD = {
  high: { fine: { rx: 31, rz: 33, cz: 4 }, mid: [-46, 46, -44, 54] },
  medium: { fine: { rx: 28, rz: 30.5, cz: 3.5 }, mid: [-44, 44, -42, 50] },
  low: { fine: { rx: 26, rz: 28.5, cz: 3.5 }, mid: [-40, 40, -40, 46] },
};
/**
 * Triangle budgets per tier for the WHOLE terrain module — the ground mesh
 * plus the path flagstones (≈ 12k on every tier), i.e. every mesh moduleStats()
 * counts for 'terrain' (ctx.modules.terrain.budget). Measured in round 4:
 * ≈ 55.7k / 51.0k / 47.1k (the elliptical fine level saved ≈ 4–5k per tier).
 */
export const TERRAIN_BUDGET = { high: 58000, medium: 53500, low: 49500 };

/**
 * Indexed lattice mesh: { lattice [ix, iz] per vertex, index } — ix/iz are
 * heightGrid columns/rows (0 … GRID_RES).
 */
export function lodLattice(tier) {
  const L = LOD[tier] ?? LOD.high;
  const CELL = (TERRAIN_HALF_SIZE * 2) / GRID_RES;
  const N = GRID_RES + 1;
  const toL = (w) => Math.round((w + TERRAIN_HALF_SIZE) / CELL);
  const toW = (i) => -TERRAIN_HALF_SIZE + i * CELL;
  const mid = [toL(L.mid[0]), toL(L.mid[1]), toL(L.mid[2]), toL(L.mid[3])];
  const F = L.fine;
  // a 2-step block (origin bx, bz) is fine when its centre lies in the ellipse —
  // and never on the mid rectangle's border ring (fine cells must not meet the
  // 4-step cells, or a coarse edge would need three extra points)
  const fineSet = new Set();
  const isFine = (bx, bz) => fineSet.has(bz * N + bx);
  for (let bz = mid[2] + 4; bz < mid[3] - 4; bz += 2) {
    for (let bx = mid[0] + 4; bx < mid[1] - 4; bx += 2) {
      const x = toW(bx + 1), z = toW(bz + 1);
      if ((x / F.rx) ** 2 + ((z - F.cz) / F.rz) ** 2 < 1) fineSet.add(bz * N + bx);
    }
  }
  const inMid = (ix, iz) => ix >= mid[0] && ix < mid[1] && iz >= mid[2] && iz < mid[3];
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
  /**
   * One cell of size s at (ix, iz); e0/e1/f0/f1: its x0 / x1 / z0 / z1 edge
   * borders a finer level (carries that edge's midpoint).
   * (upward-facing order around a cell: (x0,z0) → (x0,z1) → (x1,z1) → (x1,z0))
   */
  const cell = (ix, iz, s, e0 = false, e1 = false, f0 = false, f1 = false) => {
    const x1 = ix + s, z1 = iz + s, h = s / 2;
    if (!(e0 || e1 || f0 || f1)) {
      const a = v(ix, iz), b = v(ix, z1), c = v(x1, z1), d = v(x1, iz);
      index.push(a, b, d, d, b, c);
      return;
    }
    // transition cell: fan around its centre over the boundary polygon
    const poly = [[ix, iz]];
    if (e0) poly.push([ix, iz + h]);
    poly.push([ix, z1]);
    if (f1) poly.push([ix + h, z1]);
    poly.push([x1, z1]);
    if (e1) poly.push([x1, iz + h]);
    poly.push([x1, iz]);
    if (f0) poly.push([ix + h, iz]);
    const c = v(ix + h, iz + h);
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k], q = poly[(k + 1) % poly.length];
      index.push(c, v(p[0], p[1]), v(q[0], q[1]));
    }
  };
  // fine (0.5-unit) cells inside the ellipse
  for (const key of fineSet) {
    const bx = key % N, bz = (key - bx) / N;
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) cell(bx + dx, bz + dz, 1);
  }
  // mid (1-unit) cells: the rest of the mid rectangle
  for (let iz = mid[2]; iz < mid[3]; iz += 2) {
    for (let ix = mid[0]; ix < mid[1]; ix += 2) {
      if (isFine(ix, iz)) continue;
      cell(ix, iz, 2, isFine(ix - 2, iz), isFine(ix + 2, iz), isFine(ix, iz - 2), isFine(ix, iz + 2));
    }
  }
  // coarse (2-unit) cells everywhere else
  for (let iz = 0; iz < GRID_RES; iz += 4) {
    for (let ix = 0; ix < GRID_RES; ix += 4) {
      if (inMid(ix, iz)) continue;
      cell(ix, iz, 4, inMid(ix - 4, iz), inMid(ix + 4, iz), inMid(ix, iz - 4), inMid(ix, iz + 4));
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
  // the flower drifts' wash (painted by the vegetation once it knows its drifts: paintBlooms)
  geo.setAttribute('aBloom', new THREE.BufferAttribute(new Float32Array(count * 4), 4));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  // (memory: the splat/patch/relief weights are only read by the GPU — their
  //  CPU copies go once uploaded; position & index stay: ground clicks raycast
  //  the mesh; aBloom is released after paintBlooms has written it)
  const dropArray = function () {
    this.array = null;
  };
  for (const k of ['aSplat', 'aPatch', 'aRelief']) geo.attributes[k].onUpload(dropArray);
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
  let stoneTris = 0;
  try {
    const stoneMat = ctx.materials.surface('rock', { mossy: 0.2, scale: 0.75, vertexColors: true, breakup: 0.6 });
    const res = buildPathStones(ctx, stoneMat);
    res.mesh.raycast = () => {};
    ctx.scene.add(res.mesh);
    pathStones = res.stones;
    const sg = res.mesh.geometry;
    stoneTris = ((sg.index ? sg.index.count : sg.attributes.position.count) / 3) * (res.mesh.isInstancedMesh ? res.mesh.count : 1);
  } catch (err) {
    console.warn('[terrain] path stones failed', err);
  }

  // (the budget covers the whole module, as moduleStats() counts it: ground + flagstones)
  const groundTris = index.length / 3;
  const triangles = Math.round(groundTris + stoneTris);
  const stats = { triangles, ground: groundTris, stones: Math.round(stoneTris), vertices: count, tier, budget: TERRAIN_BUDGET[tier] ?? TERRAIN_BUDGET.high };
  stats.overBudget = triangles > stats.budget;
  /**
   * Paint the flower drifts' wash into aBloom. zones: [{ x, z, ax, az (unit
   * axis), hl, hw (half axes), color (THREE.Color, linear), k (0..1) }]. The
   * strength fades to the ellipse's rim and frays with a little noise.
   */
  function paintBlooms(zones) {
    const attr = geo.attributes.aBloom;
    const a = attr.array;
    if (!a) return;
    for (let i = 0; i < count; i++) {
      const x = posArr[i * 3], z = posArr[i * 3 + 2];
      for (const d of zones) {
        const dx = x - d.x, dz = z - d.z;
        if (Math.abs(dx) > d.hl + 0.5 || Math.abs(dz) > d.hl + 0.5) continue;
        const u = (dx * d.ax + dz * d.az) / d.hl, v = (dx * d.az - dz * d.ax) / d.hw;
        const e = Math.sqrt(u * u + v * v);
        const fray = 0.85 + 0.3 * fieldMid(x * 2.3, z * 2.3);
        const k = d.k * (1 - smoothstep(0.45, 1.0, e / fray));
        if (k <= a[i * 4 + 3]) continue;
        a[i * 4] = d.color.r * k;
        a[i * 4 + 1] = d.color.g * k;
        a[i * 4 + 2] = d.color.b * k;
        a[i * 4 + 3] = k;
      }
    }
    attr.needsUpdate = true;
    attr.onUpload(dropArray);
  }

  return { mesh, pathStones, stats, budget: TERRAIN_BUDGET, paintBlooms };
}
