// ─────────────────────────────────────────────────────────────────────────────
// Navigation grid + A* — lets walkers route AROUND houses, trees and the pond.
//
// A coarse occupancy grid over the walkable disc is rasterised from the
// colliders (inflated by the walker's radius), the pond and the world edge.
// It is built lazily on the first query and rebuilt whenever
// colliders.version changes. Paths are string-pulled (line-of-sight
// shortcuts) so walkers move in natural straight-ish lines.
//
//   const nav = getNavGrid(ctx, 0.35)        // cached per walker radius
//   const route = nav.findPath(sx, sz, tx, tz)
//     → { points: [{x,z}, …] (excludes the start), reached: bool, end: {x,z}, length } | null
//   nav.isWalkable(x, z)    nav.nearestWalkable(x, z) → {x,z}|null    nav.clearLine(ax, az, bx, bz)
//
// Villagers (districts) may use this too: findPath(ctx, sx, sz, tx, tz, { radius }).
// ─────────────────────────────────────────────────────────────────────────────
import { WORLD_RADIUS, POND } from '../world/layout.js';
import { shapeDistance } from './colliders.js';

/** The water edge walkers respect (same as the player's pond check). */
export const POND_BLOCK_RADIUS = POND.radius * 0.95 - 0.6;

const SQRT2 = Math.SQRT2;
// 8-neighbourhood: dx, dz, cost
const NB = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/**
 * @param {*} colliders  ctx.colliders
 * @param {{cell?:number, radius?:number, margin?:number, ignoreTags?:string[]}} [opts]
 */
export function createNavGrid(colliders, { cell = 0.5, radius = 0.35, margin = 0.08, ignoreTags = null } = {}) {
  const extent = WORLD_RADIUS + cell;
  const n = Math.ceil((extent * 2) / cell);
  const total = n * n;
  const origin = -extent;
  const blocked = new Uint8Array(total);
  const comp = new Int32Array(total);
  // A* scratch (reused between searches; a stamp avoids clearing)
  const g = new Float32Array(total);
  const parent = new Int32Array(total);
  const stamp = new Uint32Array(total);
  const closed = new Uint32Array(total);
  const heapIdx = new Int32Array(total);
  const heapF = new Float32Array(total);
  let heapSize = 0;
  let search = 0;
  let builtVersion = -1;
  const inflate = radius + margin;
  const ignore = ignoreTags ? new Set(ignoreTags) : null;

  const cx = (i) => origin + (i + 0.5) * cell;
  const cellOf = (x, z) => {
    const i = Math.floor((x - origin) / cell), j = Math.floor((z - origin) / cell);
    if (i < 0 || j < 0 || i >= n || j >= n) return -1;
    return j * n + i;
  };

  function build() {
    const t0 = performance.now();
    blocked.fill(0);
    const maxR = WORLD_RADIUS - radius - 0.05;
    const pr = POND_BLOCK_RADIUS + margin;
    for (let j = 0; j < n; j++) {
      const z = cx(j);
      for (let i = 0; i < n; i++) {
        const x = cx(i);
        if (x * x + z * z > maxR * maxR) blocked[j * n + i] = 1;
        else {
          const px = x - POND.center.x, pz = z - POND.center.z;
          if (px * px + pz * pz < pr * pr) blocked[j * n + i] = 1;
        }
      }
    }
    for (const s of colliders.shapes) {
      if (ignore && ignore.has(s.tag)) continue;
      const r = s.bound + inflate;
      const i0 = Math.max(0, Math.floor((s.x - r - origin) / cell));
      const i1 = Math.min(n - 1, Math.floor((s.x + r - origin) / cell));
      const j0 = Math.max(0, Math.floor((s.z - r - origin) / cell));
      const j1 = Math.min(n - 1, Math.floor((s.z + r - origin) / cell));
      for (let j = j0; j <= j1; j++) {
        const z = cx(j);
        for (let i = i0; i <= i1; i++) {
          const k = j * n + i;
          if (blocked[k]) continue;
          if (shapeDistance(s, cx(i), z) < inflate) blocked[k] = 1;
        }
      }
    }
    labelComponents();
    builtVersion = colliders.version;
    nav.buildMs = performance.now() - t0;
  }

  function labelComponents() {
    comp.fill(0);
    const queue = new Int32Array(total);
    let label = 0;
    for (let s = 0; s < total; s++) {
      if (blocked[s] || comp[s]) continue;
      label++;
      let head = 0, tail = 0;
      queue[tail++] = s;
      comp[s] = label;
      while (head < tail) {
        const k = queue[head++];
        const i = k % n, j = (k - i) / n;
        if (i > 0 && !blocked[k - 1] && !comp[k - 1]) { comp[k - 1] = label; queue[tail++] = k - 1; }
        if (i < n - 1 && !blocked[k + 1] && !comp[k + 1]) { comp[k + 1] = label; queue[tail++] = k + 1; }
        if (j > 0 && !blocked[k - n] && !comp[k - n]) { comp[k - n] = label; queue[tail++] = k - n; }
        if (j < n - 1 && !blocked[k + n] && !comp[k + n]) { comp[k + n] = label; queue[tail++] = k + n; }
      }
    }
  }

  function ensure() {
    if (builtVersion !== colliders.version) build();
  }

  /** Nearest free cell to cell k (optionally restricted to a component), ring search. */
  function nearestFreeCell(k, wantComp = 0, maxRing = 48) {
    if (k < 0) return -1;
    const ok = (c) => !blocked[c] && (!wantComp || comp[c] === wantComp);
    if (ok(k)) return k;
    const i0 = k % n, j0 = (k - i0) / n;
    for (let r = 1; r <= maxRing; r++) {
      let best = -1, bestD = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        const j = j0 + dj;
        if (j < 0 || j >= n) continue;
        const step = Math.abs(dj) === r ? 1 : 2 * r;
        for (let di = -r; di <= r; di += step) {
          const i = i0 + di;
          if (i < 0 || i >= n) continue;
          const c = j * n + i;
          if (!ok(c)) continue;
          const d = di * di + dj * dj;
          if (d < bestD) { bestD = d; best = c; }
        }
      }
      if (best >= 0) return best;
    }
    if (!wantComp) return -1;
    // fallback: brute-force scan of the component
    let best = -1, bestD = Infinity;
    for (let c = 0; c < total; c++) {
      if (comp[c] !== wantComp) continue;
      const i = c % n, j = (c - i) / n;
      const d = (i - i0) * (i - i0) + (j - j0) * (j - j0);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  // ── binary heap keyed by f ──
  function heapPush(k, f) {
    let i = heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= f) break;
      heapIdx[i] = heapIdx[p];
      heapF[i] = heapF[p];
      i = p;
    }
    heapIdx[i] = k;
    heapF[i] = f;
  }
  function heapPop() {
    const top = heapIdx[0];
    const lastK = heapIdx[--heapSize];
    const lastF = heapF[heapSize];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= heapSize) break;
      if (c + 1 < heapSize && heapF[c + 1] < heapF[c]) c++;
      if (heapF[c] >= lastF) break;
      heapIdx[i] = heapIdx[c];
      heapF[i] = heapF[c];
      i = c;
    }
    heapIdx[i] = lastK;
    heapF[i] = lastF;
    return top;
  }

  function astar(s, t) {
    search++;
    heapSize = 0;
    const ti = t % n, tj = (t - ti) / n;
    const h = (k) => {
      const i = k % n, j = (k - i) / n;
      const dx = Math.abs(i - ti), dz = Math.abs(j - tj);
      return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
    };
    stamp[s] = search;
    g[s] = 0;
    parent[s] = -1;
    heapPush(s, h(s));
    while (heapSize > 0) {
      const k = heapPop();
      if (closed[k] === search) continue;
      closed[k] = search;
      if (k === t) return true;
      const i = k % n, j = (k - i) / n;
      for (let m = 0; m < 8; m++) {
        const ni = i + NB[m][0], nj = j + NB[m][1];
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nk = nj * n + ni;
        if (blocked[nk] || closed[nk] === search) continue;
        // no corner cutting on diagonals
        if (m >= 4 && (blocked[j * n + ni] || blocked[nj * n + i])) continue;
        const ng = g[k] + NB[m][2];
        if (stamp[nk] === search && ng >= g[nk]) continue;
        stamp[nk] = search;
        g[nk] = ng;
        parent[nk] = k;
        heapPush(nk, ng + h(nk));
      }
    }
    return false;
  }

  /** Line of sight on the grid. Samples inside `skipCell` (the start cell) are tolerated. */
  function clearLine(ax, az, bx, bz, skipCell = -1) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / (cell * 0.35)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const k = cellOf(ax + dx * t, az + dz * t);
      if (k < 0) return false;
      if (blocked[k] && k !== skipCell) return false;
    }
    return true;
  }

  const cellList = [];

  const nav = {
    cell,
    radius,
    buildMs: 0,
    get size() {
      return n;
    },
    ensure,
    isWalkable(x, z) {
      ensure();
      const k = cellOf(x, z);
      return k >= 0 && !blocked[k];
    },
    /** Nearest walkable point (cell centre) to (x, z), or null. */
    nearestWalkable(x, z, out = { x: 0, z: 0 }) {
      ensure();
      const k = nearestFreeCell(cellOf(x, z));
      if (k < 0) return null;
      const i = k % n, j = (k - i) / n;
      out.x = cx(i);
      out.z = cx(j);
      return out;
    },
    /** True if a walker can go straight from a to b. */
    clearLine(ax, az, bx, bz) {
      ensure();
      return clearLine(ax, az, bx, bz, cellOf(ax, az));
    },
    /**
     * Route from (sx, sz) to (tx, tz). If the target is blocked or unreachable,
     * the route ends at the nearest reachable spot (reached = false).
     */
    findPath(sx, sz, tx, tz) {
      ensure();
      const s0 = cellOf(sx, sz);
      const s = nearestFreeCell(s0, 0, 12);
      if (s < 0) return null;
      const startComp = comp[s];
      let t = cellOf(tx, tz);
      let reached = true;
      if (t < 0 || blocked[t] || comp[t] !== startComp) {
        reached = false;
        t = nearestFreeCell(t < 0 ? cellOf(tx * 0.98, tz * 0.98) : t, startComp);
        if (t < 0) return null;
      }
      const ti = t % n, tj = (t - ti) / n;
      const end = reached ? { x: tx, z: tz } : { x: cx(ti), z: cx(tj) };
      const points = [];
      if (s !== t && !clearLine(sx, sz, end.x, end.z, s0)) {
        if (!astar(s, t)) return null;
        cellList.length = 0;
        for (let k = t; k !== -1; k = parent[k]) cellList.push(k);
        cellList.reverse();
        // string pulling: keep only the corners we can't see past
        let ax = sx, az = sz, skip = s0;
        let lastX = cx(cellList[0] % n), lastZ = cx((cellList[0] - (cellList[0] % n)) / n);
        for (let m = 1; m < cellList.length; m++) {
          const k = cellList[m];
          const i = k % n, j = (k - i) / n;
          const px = cx(i), pz = cx(j);
          if (!clearLine(ax, az, px, pz, skip)) {
            points.push({ x: lastX, z: lastZ });
            ax = lastX;
            az = lastZ;
            skip = -1;
          }
          lastX = px;
          lastZ = pz;
        }
      }
      points.push(end);
      let length = 0, px = sx, pz = sz;
      for (const p of points) {
        length += Math.hypot(p.x - px, p.z - pz);
        px = p.x;
        pz = p.z;
      }
      return { points, reached, end, length };
    },
  };
  return nav;
}

const caches = new WeakMap();
/** Shared nav grid for walkers of `radius` (cached per colliders instance). */
export function getNavGrid(ctx, radius = 0.35, opts = {}) {
  let byRadius = caches.get(ctx.colliders);
  if (!byRadius) caches.set(ctx.colliders, (byRadius = new Map()));
  const key = `${radius}|${opts.margin ?? ''}|${opts.ignoreTags?.join(',') ?? ''}`;
  let nav = byRadius.get(key);
  if (!nav) byRadius.set(key, (nav = createNavGrid(ctx.colliders, { radius, ...opts })));
  return nav;
}

/** Convenience: route for a walker of `radius` (see nav.findPath). */
export function findPath(ctx, sx, sz, tx, tz, { radius = 0.35 } = {}) {
  return getNavGrid(ctx, radius).findPath(sx, sz, tx, tz);
}
