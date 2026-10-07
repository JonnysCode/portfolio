// ─────────────────────────────────────────────────────────────────────────────
// The forest floor of the glen.
//
// One terrain mesh straight from ground.js' baked grids (heights match
// getHeight() exactly — every builder sits things on it), painted per pixel
// by the splat shader in vegetation/terrainShader.js: velvety moss carpet in
// broad sunlit/deep patches, dark humus and leaf litter (around the Great
// Oak's roots, the dressed rings around the houses, under the forest wall),
// worn packed earth along the paths with ragged mossy edges, damp darker soil
// by the stream and the pond, rising mossy slopes at the rim.
//
// Plus the flagstones / stepping stones along every path
// (vegetation/pathStones.js) — individual irregular stones, sunk in.
//
// ctx.terrainMesh = the ground mesh (raycast target for ground clicks).
// Result (ctx.modules.terrain): { mesh, pathStones: [{ x, z, r }] }
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { heightGrid, pathGrid, streamGrid, GRID_RES, PADS } from './ground.js';
import { TERRAIN_HALF_SIZE, OAK, STREAM } from './layout.js';
import { smoothstep } from '../core/rng.js';
import { makeTerrainMaterial } from './vegetation/terrainShader.js';
import { buildPathStones } from './vegetation/pathStones.js';
import { fieldBroad, fieldMid } from './vegetation/common.js';
import { forestPlan } from './vegetation/plan.js';

export default async function build(ctx) {
  const N = GRID_RES + 1;
  const SIZE = TERRAIN_HALF_SIZE * 2;
  const CELL = SIZE / GRID_RES;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, GRID_RES, GRID_RES);
  geo.rotateX(-Math.PI / 2);
  geo.deleteAttribute('uv');
  const pos = geo.attributes.position;
  const splat = new Float32Array(pos.count * 4);
  const trees = forestPlan().trees;

  for (let i = 0; i < pos.count; i++) {
    // after rotateX(−π/2), row j sits at z = −HALF + j·CELL — same layout as heightGrid
    const gi = i;
    const x = -TERRAIN_HALF_SIZE + (i % N) * CELL;
    const z = -TERRAIN_HALF_SIZE + Math.floor(i / N) * CELL;
    pos.setY(i, heightGrid[gi]);

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
    let litter = smoothstep(0.6, 0.85, fieldBroad(x, z)) * 0.6;
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
  }
  geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
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

  return { mesh, pathStones };
}
