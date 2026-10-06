// ─────────────────────────────────────────────────────────────────────────────
// Ground queries for the glen — height, paths, the stream and "is this spot free?".
//
// The analytic height function is baked once into a grid at startup so that
// getHeight() is O(1). Everything that sits on the ground MUST use getHeight().
// Building plots ("pads") are exactly flat at y = 0 so builders can work there
// without sampling; everywhere else, sample.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createNoise2D, fbm } from '../core/noise.js';
import { smoothstep, clamp } from '../core/rng.js';
import {
  TERRAIN_HALF_SIZE,
  GLEN_RADIUS,
  OAK,
  SCHREINEREI,
  COTTAGE,
  STREAM,
  RIVERSIDE,
  PATHS,
  PATH_HALF_WIDTH,
} from './layout.js';

const noiseA = createNoise2D(20240611);
const noiseB = createNoise2D(777);

/** Flat building plots: inside `r` the ground is exactly y = 0; it blends out over `blend`. */
export const PADS = [
  { id: 'oak', x: OAK.x, z: OAK.z, r: 6.2, blend: 3 },
  { id: 'door', x: OAK.door.x, z: OAK.door.z + 1.5, r: 2.6, blend: 2 },
  { id: 'annex', x: SCHREINEREI.annex.x, z: SCHREINEREI.annex.z, r: 4.3, blend: 2.5 },
  { id: 'porch', x: SCHREINEREI.porch.x, z: SCHREINEREI.porch.z, r: 2.6, blend: 2 },
  { id: 'deck', x: SCHREINEREI.deck.x, z: SCHREINEREI.deck.z, r: 2.8, blend: 2 },
  { id: 'home', x: COTTAGE.home.x, z: COTTAGE.home.z, r: 4.6, blend: 2.5 },
  { id: 'atelier', x: COTTAGE.atelier.x, z: COTTAGE.atelier.z, r: 4.2, blend: 2.5 },
  { id: 'shed', x: COTTAGE.shed.x, z: COTTAGE.shed.z, r: 2.4, blend: 2 },
  { id: 'bikeShed', x: RIVERSIDE.bikeShed.x, z: RIVERSIDE.bikeShed.z, r: 3.8, blend: 2.5 },
  { id: 'bridgeW', x: PATHS.bridge[2].x, z: PATHS.bridge[2].z, r: 1.3, blend: 1.2 },
  { id: 'bridgeE', x: PATHS.farBank[0].x, z: PATHS.farBank[0].z, r: 1.3, blend: 1.2 },
];

// ─── Polylines ───────────────────────────────────────────────────────────────
function polyline(ctrl, step = 0.5) {
  const curve = new THREE.CatmullRomCurve3(ctrl.map((p) => new THREE.Vector3(p.x, 0, p.z)), false, 'centripetal');
  const pts = curve.getSpacedPoints(Math.max(8, Math.ceil(curve.getLength() / step))).map((v) => ({ x: v.x, z: v.z }));
  const pad = 6;
  return {
    curve,
    pts,
    minX: Math.min(...pts.map((p) => p.x)) - pad,
    maxX: Math.max(...pts.map((p) => p.x)) + pad,
    minZ: Math.min(...pts.map((p) => p.z)) - pad,
    maxZ: Math.max(...pts.map((p) => p.z)) + pad,
  };
}

/** Dirt/stepping-stone paths. { id, halfWidth, curve, pts } */
export const pathPolylines = Object.entries(PATHS).map(([id, ctrl]) => ({
  id,
  halfWidth: PATH_HALF_WIDTH[id] ?? 0.9,
  ...polyline(ctrl),
}));

/** The stream centre line (from the plunge pool to where it leaves the glen). */
export const streamPolyline = { id: 'stream', halfWidth: STREAM.halfWidth, ...polyline(STREAM.points, 0.4) };

function segDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const t = clamp(((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz || 1), 0, 1);
  const dx = px - (ax + abx * t), dz = pz - (az + abz * t);
  return Math.sqrt(dx * dx + dz * dz);
}

function polyDistance(p, x, z) {
  if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) return Infinity;
  let best = Infinity;
  const pts = p.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = segDist(x, z, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z);
    if (d < best) best = d;
  }
  return best;
}

/** Normalised distance to the nearest path (<1 = on the path). */
function analyticPathDistance(x, z) {
  let best = Infinity;
  for (const p of pathPolylines) {
    const d = polyDistance(p, x, z) / p.halfWidth;
    if (d < best) best = d;
  }
  return best;
}

function padWeight(x, z) {
  let w = 0;
  for (const p of PADS) {
    const d = Math.hypot(x - p.x, z - p.z);
    w = Math.max(w, 1 - smoothstep(p.r, p.r + p.blend, d));
  }
  return w;
}

/** The raw height function (slow). Prefer getHeight(), which samples the bake. */
export function analyticHeight(x, z, pathDist = analyticPathDistance(x, z), streamDist = polyDistance(streamPolyline, x, z)) {
  const r = Math.hypot(x, z * 1.1);
  // gentle forest floor with soft mounds
  let h = fbm(noiseA, x * 0.06, z * 0.06, 3) * 0.45 + fbm(noiseB, x * 0.18, z * 0.18, 2) * 0.12;
  // the glen is a shallow bowl: the forest rises softly all around, more at the back
  const back = smoothstep(0, -40, z) * 0.6 + 0.4;
  const rim = smoothstep(GLEN_RADIUS - 6, GLEN_RADIUS + 26, r);
  h += rim * rim * (9 + 6 * fbm(noiseB, x * 0.03 + 4, z * 0.03 - 2, 3)) * back;
  // waterfall outcrop: a mossy hill the stream pours over
  const f = STREAM.falls;
  const fd = Math.hypot(x - f.x, z - f.z);
  const bump = 1 - smoothstep(0, f.radius, fd);
  h += Math.pow(bump, 0.75) * f.top * (0.85 + 0.15 * fbm(noiseA, x * 0.3, z * 0.3, 2));
  // paths: soften
  const pw = 1 - smoothstep(0.9, 2.4, pathDist);
  h = h * (1 - pw * 0.7);
  // pads: exactly flat
  const padW = padWeight(x, z);
  h = h * (1 - padW);
  // stream channel (and plunge pool) carved below the water level
  const bed = STREAM.waterLevel - STREAM.depth;
  const cw = 1 - smoothstep(STREAM.halfWidth * 0.55, STREAM.halfWidth * 1.9, streamDist);
  const pool = STREAM.pool;
  const pd = Math.hypot(x - pool.x, z - pool.z);
  const pw2 = 1 - smoothstep(pool.radius * 0.5, pool.radius * 1.35, pd);
  const carve = Math.max(cw, pw2);
  if (carve > 0) {
    const target = bed - pw2 * 0.4;
    h = h + (Math.min(h, target) - h) * carve;
  }
  return h;
}

// ─── Bake ────────────────────────────────────────────────────────────────────
export const GRID_RES = 280; // cells per side (0.5 units per cell)
const SIZE = TERRAIN_HALF_SIZE * 2;
const CELL = SIZE / GRID_RES;
const N = GRID_RES + 1;
export const heightGrid = new Float32Array(N * N);
/** Normalised path distance (capped at 8). */
export const pathGrid = new Float32Array(N * N);
/** Distance to the stream centre line in units (capped at 20). */
export const streamGrid = new Float32Array(N * N);

(function bake() {
  for (let j = 0; j < N; j++) {
    const z = -TERRAIN_HALF_SIZE + j * CELL;
    for (let i = 0; i < N; i++) {
      const x = -TERRAIN_HALF_SIZE + i * CELL;
      const pd = analyticPathDistance(x, z);
      const sd = polyDistance(streamPolyline, x, z);
      heightGrid[j * N + i] = analyticHeight(x, z, pd, sd);
      pathGrid[j * N + i] = Math.min(8, pd);
      streamGrid[j * N + i] = Math.min(20, sd);
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

/** Ground height (world Y) at world XZ. Exactly 0 on every pad. */
export function getHeight(x, z) {
  return sampleGrid(heightGrid, x, z);
}

/** Normalised distance to the nearest path (<1 = on the path). */
export function getPathDistance(x, z) {
  return sampleGrid(pathGrid, x, z);
}

/** Distance (units) to the stream centre line. */
export function getStreamDistance(x, z) {
  return sampleGrid(streamGrid, x, z);
}

const _n = new THREE.Vector3();
/** Approximate ground normal at XZ (writes into `target` if given). */
export function getNormal(x, z, target = _n) {
  const e = 0.35;
  const hx = getHeight(x + e, z) - getHeight(x - e, z);
  const hz = getHeight(x, z + e) - getHeight(x, z - e);
  return target.set(-hx, 2 * e, -hz).normalize();
}

/** True if the point is in the stream or the plunge pool. */
export function isInWater(x, z, pad = 0) {
  if (getStreamDistance(x, z) < STREAM.halfWidth + pad) return true;
  const p = STREAM.pool;
  return Math.hypot(x - p.x, z - p.z) < p.radius + pad;
}

/** Which pad (building plot) contains this point, if any. */
export function getPadAt(x, z, extra = 0) {
  for (const p of PADS) if (Math.hypot(x - p.x, z - p.z) <= p.r + extra) return p.id;
  return null;
}

/**
 * Is this XZ free for scattering scenery (ferns, flowers, rocks, trees)?
 * Avoids paths, pads, the stream, the oak's trunk and the waterfall rocks.
 */
export function isFreeForScenery(x, z, margin = 0) {
  if (getPathDistance(x, z) < 1.25 + margin * 0.8) return false;
  if (getPadAt(x, z, 0.4 + margin)) return false;
  if (isInWater(x, z, 0.5 + margin)) return false;
  if (Math.hypot(x - OAK.x, z - OAK.z) < OAK.baseRadius + 1 + margin) return false;
  return true;
}

/** Info bundle, handy for debugging. */
export function getGroundInfo(x, z) {
  return {
    height: getHeight(x, z),
    pathDistance: getPathDistance(x, z),
    streamDistance: getStreamDistance(x, z),
    pad: getPadAt(x, z),
    inWater: isInWater(x, z),
  };
}
