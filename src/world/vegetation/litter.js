// ─────────────────────────────────────────────────────────────────────────────
// Forest-floor litter: the tiny things that make the ground read as a real
// miniature up close — fallen leaves (curled, autumn-toned, in drifts at the
// giants' feet, blown against the path edges, under the forest wall) and
// pebbles (along the paths and in the open soil).
//
// Two InstancedMeshes, a few thousand instances, a handful of triangles each.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight, getNormal, getPathDistance } from '../ground.js';
import { GeoBuilder, TAU, instanced, fieldMid, fieldBroad, normalizeAttributes } from './common.js';
import { canGrow, oakDist, OAK_KEEP } from './zones.js';

/** A small curled leaf lying flat: tip along +Z, folded along the midrib, edges lifted (4 triangles). */
function fallenLeafGeometry() {
  const B = new GeoBuilder();
  // (x, y, z, u, v) — a lozenge folded along the midrib; UVs map the 'leaf'
  // surface (base V=0, tip V=1) so its outline & veins come from the texture
  const L = 0.13, W = 0.06;
  const pts = [
    [0, 0.006, -L * 0.5, 0.5, 0], // stem end
    [-W, 0.016, L * 0.04, 0.0, 0.5], // left edge (lifted)
    [0, 0.012, L * 0.5, 0.5, 1], // tip (curls up a touch)
    [W, 0.016, L * 0.04, 1.0, 0.5], // right edge (lifted)
    [0, 0.0, 0.0, 0.5, 0.5], // midrib (the fold's low point)
  ];
  for (const [x, y, z, u, v] of pts) B.vert(x, y, z, 0, 1, 0, u, v);
  for (let i = 0; i < 4; i++) B.tri(4, (i + 1) % 4, i);
  const g = B.build();
  g.computeVertexNormals();
  return g;
}

/** A rounded pebble (low-poly, flattened). */
function pebbleGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(1, 0.55, 0.85);
  g.translate(0, 0.18, 0);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return normalizeAttributes(g); // (white vertex colours: the instance colour sets the tone)
}

const LEAF_TONES = ['#8a5a2a', '#a8692c', '#b8823a', '#6e4a26', '#c49a48', '#93622f', '#7a6a30', '#a0502a'];
const PEBBLE_TONES = ['#9a9488', '#8b867c', '#a59d8c', '#7e7a72', '#b0a690'];

/**
 * Scatter the litter. trees: forest plan trees ({ x, z, radius }).
 * Returns the meshes (caller adds them) and the instance counts.
 */
export function buildLitter(ctx, rng, { trees = [], density = 1 } = {}) {
  const M = ctx.materials;
  const leaves = [];
  const pebbles = [];
  const nrm = new THREE.Vector3();
  const tone = (list, l = 0.06) => new THREE.Color(rng.pick(list)).offsetHSL(rng.jitter(0.02), rng.jitter(0.08), rng.jitter(l));

  const addLeaf = (x, z) => {
    if (!canGrow(x, z, { path: 0.55, oak: OAK_KEEP })) return;
    getNormal(x, z, nrm);
    leaves.push({
      x,
      y: getHeight(x, z) + 0.004,
      z,
      ry: rng.range(0, TAU),
      tx: rng.jitter(0.25) - nrm.z * 0.6,
      tz: rng.jitter(0.25) + nrm.x * 0.6,
      s: rng.range(0.75, 1.35),
      color: tone(LEAF_TONES),
    });
  };

  // drifts at the giants' feet
  for (const t of trees) {
    if (Math.hypot(t.x, t.z) > 34) continue;
    const n = Math.round(rng.int(30, 60) * density);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU), d = t.radius * (1.3 + Math.pow(rng.next(), 1.6) * 3.2);
      addLeaf(t.x + Math.sin(a) * d, t.z + Math.cos(a) * d);
    }
  }
  // blown against the paths' edges and sprinkled over the glen
  const total = Math.round(2600 * density);
  for (let k = 0; k < total * 3 && leaves.length < total + 1400; k++) {
    const az = rng.range(-Math.PI, Math.PI);
    const r = Math.sqrt(rng.range(6 * 6, 32 * 32));
    const x = Math.sin(az) * r, z = Math.cos(az) * r;
    const pd = getPathDistance(x, z);
    // more along the path edges, in litter patches and under the forest wall
    const w = (pd > 0.6 && pd < 1.8 ? 0.7 : 0.12) + (fieldBroad(x, z) > 0.6 ? 0.35 : 0) + (r > 22 ? 0.3 : 0) + (oakDist(x, z) < 14 ? 0.4 : 0);
    if (!rng.chance(w)) continue;
    // little clumps of 1–4
    const c = rng.int(1, 4);
    for (let i = 0; i < c; i++) addLeaf(x + rng.jitter(0.25), z + rng.jitter(0.25));
  }

  // pebbles: along the paths and in bare patches
  const nP = Math.round(900 * density);
  for (let k = 0; k < nP * 4 && pebbles.length < nP; k++) {
    const az = rng.range(-Math.PI, Math.PI);
    const r = Math.sqrt(rng.range(5 * 5, 30 * 30));
    const x = Math.sin(az) * r, z = Math.cos(az) * r;
    const pd = getPathDistance(x, z);
    const w = pd > 0.85 && pd < 1.6 ? 0.8 : fieldMid(x, z) > 0.7 ? 0.25 : 0.05;
    if (!rng.chance(w)) continue;
    if (!canGrow(x, z, { path: 0.9 })) continue;
    const s = rng.range(0.025, 0.07) * (rng.chance(0.1) ? 1.8 : 1);
    pebbles.push({ x, y: getHeight(x, z) - s * 0.25, z, ry: rng.range(0, TAU), tx: rng.jitter(0.3), tz: rng.jitter(0.3), s, sx: rng.range(0.8, 1.3), color: tone(PEBBLE_TONES, 0.08) });
  }

  const leafMat = M.surface('leaf', { vertexColors: true, side: THREE.DoubleSide });
  const pebbleMat = M.surface('rock', { vertexColors: true, mossy: 0.15, scale: 0.25 });
  const meshes = [
    instanced('litter-leaves', fallenLeafGeometry(), leafMat, leaves, { cast: false, receive: true }),
    instanced('litter-pebbles', pebbleGeometry(), pebbleMat, pebbles, { cast: false, receive: true }),
  ].filter(Boolean);
  return { meshes, leaves: leaves.length, pebbles: pebbles.length };
}
