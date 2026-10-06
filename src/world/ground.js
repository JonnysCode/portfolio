// ─────────────────────────────────────────────────────────────────────────────
// Ground queries — height, path distance and "is this spot free?".
//
// The analytic height function is baked once into a grid at startup so that
// getHeight() is O(1) for the player, vegetation scattering and the terrain
// mesh alike. Everything that sits on the ground MUST use getHeight().
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createNoise2D, fbm } from '../core/noise.js';
import { smoothstep, clamp } from '../core/rng.js';
import {
  AREAS,
  PATHS,
  PATH_WIDTH,
  POND,
  WORLD_RADIUS,
  TERRAIN_HALF_SIZE,
} from './layout.js';

const noiseA = createNoise2D(20240611);
const noiseB = createNoise2D(777);

// ─── Path polylines (sampled Catmull-Rom) ───────────────────────────────────
/** @type {{id:string, halfWidth:number, curve:THREE.CatmullRomCurve3, pts:{x:number,z:number}[], minX:number,maxX:number,minZ:number,maxZ:number}[]} */
export const pathPolylines = Object.entries(PATHS).map(([id, ctrl]) => {
  const curve = new THREE.CatmullRomCurve3(
    ctrl.map((p) => new THREE.Vector3(p.x, 0, p.z)),
    false,
    'centripetal'
  );
  const samples = curve.getSpacedPoints(Math.max(12, Math.ceil(curve.getLength() / 0.8)));
  const pts = samples.map((v) => ({ x: v.x, z: v.z }));
  const halfWidth = PATH_WIDTH[id] ?? PATH_WIDTH.default;
  const pad = 8;
  return {
    id,
    halfWidth,
    curve,
    pts,
    minX: Math.min(...pts.map((p) => p.x)) - pad,
    maxX: Math.max(...pts.map((p) => p.x)) + pad,
    minZ: Math.min(...pts.map((p) => p.z)) - pad,
    maxZ: Math.max(...pts.map((p) => p.z)) + pad,
  };
});

function segDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const t = clamp(((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz || 1), 0, 1);
  const dx = px - (ax + abx * t), dz = pz - (az + abz * t);
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Distance to the nearest path centre line, normalised by that path's half
 * width (so <1 means "on the path"). Returns { d, raw, id }.
 */
function analyticPathDistance(x, z) {
  let best = Infinity, bestRaw = Infinity, bestId = null;
  for (const p of pathPolylines) {
    if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
    const pts = p.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const raw = segDist(x, z, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z);
      const d = raw / p.halfWidth;
      if (d < best) { best = d; bestRaw = raw; bestId = p.id; }
    }
  }
  return { d: best, raw: bestRaw, id: bestId };
}

/** 0..1 — how much a point belongs to a flat clearing (plaza / districts). */
function clearingWeight(x, z) {
  let w = 0;
  for (const a of AREAS) {
    const d = Math.hypot(x - a.center.x, z - a.center.z);
    w = Math.max(w, 1 - smoothstep(a.radius, a.radius + 7, d));
  }
  return w;
}

/** The raw height function (slow). Prefer getHeight(), which samples the bake. */
export function analyticHeight(x, z, pathDist = analyticPathDistance(x, z).d) {
  const r = Math.hypot(x, z);
  // Rolling meadow hills, taller towards the outskirts.
  const amp = 0.5 + 2.6 * smoothstep(14, 55, r);
  let h = fbm(noiseA, x * 0.022, z * 0.022, 4) * amp;
  h += fbm(noiseB, x * 0.09, z * 0.09, 2) * 0.25;
  // The forest rim: hills rise beyond the walkable area to close the valley.
  const rim = smoothstep(WORLD_RADIUS - 8, WORLD_RADIUS + 34, r);
  h += rim * rim * (16 + 9 * fbm(noiseB, x * 0.015 + 9, z * 0.015 - 3, 3));
  // Paths are smoothed towards a gentle profile.
  const pw = 1 - smoothstep(1.0, 3.2, pathDist);
  h = h * (1 - pw * 0.8);
  // Clearings are perfectly flat at y = 0.
  const cw = clearingWeight(x, z);
  h = h * (1 - cw);
  // Pond bowl.
  const pdist = Math.hypot(x - POND.center.x, z - POND.center.z);
  const bowl = 1 - smoothstep(POND.radius * 0.35, POND.radius * 1.15, pdist);
  h = h * (1 - bowl) - bowl * POND.depth;
  return h;
}

// ─── Bake ────────────────────────────────────────────────────────────────────
export const GRID_RES = 400; // cells per side
const SIZE = TERRAIN_HALF_SIZE * 2;
const CELL = SIZE / GRID_RES;
const N = GRID_RES + 1;
export const heightGrid = new Float32Array(N * N);
export const pathGrid = new Float32Array(N * N); // normalised path distance (capped at 8)

(function bake() {
  for (let j = 0; j < N; j++) {
    const z = -TERRAIN_HALF_SIZE + j * CELL;
    for (let i = 0; i < N; i++) {
      const x = -TERRAIN_HALF_SIZE + i * CELL;
      const pd = analyticPathDistance(x, z).d;
      heightGrid[j * N + i] = analyticHeight(x, z, pd);
      pathGrid[j * N + i] = Math.min(8, pd);
    }
  }
})();

function sampleGrid(grid, x, z) {
  const fx = clamp((x + TERRAIN_HALF_SIZE) / CELL, 0, GRID_RES - 1e-4);
  const fz = clamp((z + TERRAIN_HALF_SIZE) / CELL, 0, GRID_RES - 1e-4);
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const a = grid[j * N + i], b = grid[j * N + i + 1];
  const c = grid[(j + 1) * N + i], d = grid[(j + 1) * N + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** Ground height (world Y) at world XZ. Exactly 0 inside every clearing. */
export function getHeight(x, z) {
  return sampleGrid(heightGrid, x, z);
}

/** Normalised distance to the nearest main path (<1 = on the dirt path). */
export function getPathDistance(x, z) {
  return sampleGrid(pathGrid, x, z);
}

const _n = new THREE.Vector3();
/** Approximate ground normal at XZ (writes into `target` if given). */
export function getNormal(x, z, target = _n) {
  const e = 0.5;
  const hx = getHeight(x + e, z) - getHeight(x - e, z);
  const hz = getHeight(x, z + e) - getHeight(x, z - e);
  return target.set(-hx, 2 * e, -hz).normalize();
}

/** Which clearing (area id) contains this point, if any. */
export function getAreaAt(x, z, pad = 0) {
  for (const a of AREAS) {
    if (Math.hypot(x - a.center.x, z - a.center.z) <= a.radius + pad) return a.id;
  }
  return null;
}

/** True if the point is in the pond's water. */
export function isInPond(x, z, pad = 0) {
  return Math.hypot(x - POND.center.x, z - POND.center.z) < POND.radius * 0.95 + pad;
}

/**
 * Is this XZ free for scattering scenery (trees, rocks, bushes)?
 * Avoids clearings, paths and the pond. `margin` widens the exclusion zones.
 */
export function isFreeForScenery(x, z, margin = 0) {
  if (getAreaAt(x, z, 1.5 + margin)) return false;
  if (getPathDistance(x, z) < 1.6 + margin / 1.5) return false;
  if (isInPond(x, z, 1 + margin)) return false;
  return true;
}

/** Info bundle, handy for debugging. */
export function getGroundInfo(x, z) {
  return {
    height: getHeight(x, z),
    pathDistance: getPathDistance(x, z),
    area: getAreaAt(x, z),
    inPond: isInPond(x, z),
    walkable: Math.hypot(x, z) < WORLD_RADIUS && !isInPond(x, z, -0.5),
  };
}
