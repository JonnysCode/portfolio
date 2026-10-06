// ─────────────────────────────────────────────────────────────────────────────
// Colliders — simple 2D (XZ) obstacles so villagers and the player don't walk
// through houses, trees or workbenches. All coordinates are WORLD XZ.
//
//   colliders.addCircle(x, z, r, tag?)               → tree trunks, mushroom stems
//   colliders.addBox(x, z, halfW, halfD, rotY, tag?) → buildings, benches, tables
//   colliders.remove(shape)
//   colliders.resolve(pos, radius)                   → pushes pos {x,z} out of everything
//   colliders.isBlocked(x, z, radius)                → would a circle here overlap anything?
//   colliders.query(x, z, reach, fn)                 → fn(shape) for shapes whose bound is within reach
//   colliders.distance(shape, x, z)                  → signed distance from a point to a shape
//   colliders.version                                → bumps on every add/remove (nav grids rebuild lazily)
//
// District builders should use site.addCollider / site.addBoxCollider instead,
// which take district-local coordinates.
// ─────────────────────────────────────────────────────────────────────────────
import { WORLD_RADIUS } from '../world/layout.js';

/** Spatial hash bucket size (world units) and the query reach it is built for. */
const BUCKET = 4;
const BUCKET_REACH = 1.5;
const HALF = Math.ceil((WORLD_RADIUS + 12) / BUCKET);
const SIDE = HALF * 2;

/** Signed distance from (x, z) to a collider shape (negative = inside). */
export function shapeDistance(s, x, z) {
  const dx = x - s.x, dz = z - s.z;
  if (s.type === 'circle') return Math.sqrt(dx * dx + dz * dz) - s.r;
  const lx = Math.abs(dx * s.cos - dz * s.sin) - s.hw;
  const lz = Math.abs(dx * s.sin + dz * s.cos) - s.hd;
  const ox = Math.max(lx, 0), oz = Math.max(lz, 0);
  return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(lx, lz), 0);
}

export function createColliders() {
  /** @type {Array<{type:'circle'|'box', x:number, z:number, r?:number, hw?:number, hd?:number, rot?:number, cos?:number, sin?:number, bound:number, tag?:string}>} */
  const shapes = [];
  let version = 0;
  /** @type {Array<Array<object>>|null} spatial hash, rebuilt lazily after changes */
  let buckets = null;
  /** shapes too big / too far out for the hash (always checked) */
  const loose = [];

  function rebuildBuckets() {
    buckets = new Array(SIDE * SIDE);
    for (let i = 0; i < buckets.length; i++) buckets[i] = [];
    loose.length = 0;
    for (const s of shapes) {
      const r = s.bound + BUCKET_REACH;
      const i0 = Math.floor((s.x - r) / BUCKET) + HALF, i1 = Math.floor((s.x + r) / BUCKET) + HALF;
      const j0 = Math.floor((s.z - r) / BUCKET) + HALF, j1 = Math.floor((s.z + r) / BUCKET) + HALF;
      if (i0 < 0 || j0 < 0 || i1 >= SIDE || j1 >= SIDE || (i1 - i0 + 1) * (j1 - j0 + 1) > 64) {
        loose.push(s);
        continue;
      }
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) buckets[j * SIDE + i].push(s);
    }
  }

  /** Candidate shapes near (x, z) for a query of `reach` (falls back to all shapes). */
  function candidates(x, z, reach) {
    if (reach > BUCKET_REACH) return shapes;
    if (!buckets) rebuildBuckets();
    const i = Math.floor(x / BUCKET) + HALF, j = Math.floor(z / BUCKET) + HALF;
    if (i < 0 || j < 0 || i >= SIDE || j >= SIDE) return shapes;
    return buckets[j * SIDE + i];
  }

  function changed() {
    version++;
    buckets = null;
  }

  function resolveCircle(pos, radius, c) {
    const dx = pos.x - c.x, dz = pos.z - c.z;
    const min = c.r + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return false;
    const d = Math.sqrt(d2) || 1e-4;
    pos.x = c.x + (dx / d) * min;
    pos.z = c.z + (dz / d) * min;
    return true;
  }

  function resolveBox(pos, radius, b) {
    // into box space
    const dx = pos.x - b.x, dz = pos.z - b.z;
    const lx = dx * b.cos - dz * b.sin;
    const lz = dx * b.sin + dz * b.cos;
    const cx = Math.max(-b.hw, Math.min(b.hw, lx));
    const cz = Math.max(-b.hd, Math.min(b.hd, lz));
    const ox = lx - cx, oz = lz - cz;
    const d2 = ox * ox + oz * oz;
    if (d2 >= radius * radius) return false;
    let nx, nz;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      nx = cx + (ox / d) * radius;
      nz = cz + (oz / d) * radius;
    } else {
      // centre is inside the box: push out along the shallowest axis
      const px = b.hw - Math.abs(lx), pz = b.hd - Math.abs(lz);
      if (px < pz) { nx = Math.sign(lx || 1) * (b.hw + radius); nz = lz; }
      else { nx = lx; nz = Math.sign(lz || 1) * (b.hd + radius); }
    }
    // back to world
    pos.x = b.x + nx * b.cos + nz * b.sin;
    pos.z = b.z - nx * b.sin + nz * b.cos;
    return true;
  }

  function resolveList(list, pos, radius) {
    let hit = false;
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      const dx = pos.x - s.x, dz = pos.z - s.z;
      const reach = s.bound + radius;
      if (dx * dx + dz * dz > reach * reach) continue;
      hit = (s.type === 'circle' ? resolveCircle(pos, radius, s) : resolveBox(pos, radius, s)) || hit;
    }
    return hit;
  }

  const probe = { x: 0, z: 0 };

  function overlapsAny(list, x, z, radius) {
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      const dx = x - s.x, dz = z - s.z;
      const reach = s.bound + radius;
      if (dx * dx + dz * dz > reach * reach) continue;
      probe.x = x;
      probe.z = z;
      if (s.type === 'circle' ? resolveCircle(probe, radius, s) : resolveBox(probe, radius, s)) return true;
    }
    return false;
  }

  function visitNear(list, x, z, reach, fn) {
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      const dx = x - s.x, dz = z - s.z;
      const r = s.bound + reach;
      if (dx * dx + dz * dz <= r * r) fn(s);
    }
  }

  const api = {
    shapes,
    /** Increments whenever a collider is added or removed. */
    get version() {
      return version;
    },
    addCircle(x, z, r, tag) {
      const s = { type: 'circle', x, z, r, bound: r, tag };
      shapes.push(s);
      changed();
      return s;
    },
    /** Oriented box; rotY uses the same convention as Object3D.rotation.y. */
    addBox(x, z, halfW, halfD, rotY = 0, tag) {
      const s = {
        type: 'box', x, z, hw: halfW, hd: halfD, rot: rotY,
        cos: Math.cos(rotY), sin: Math.sin(rotY),
        bound: Math.hypot(halfW, halfD), tag,
      };
      shapes.push(s);
      changed();
      return s;
    },
    remove(shape) {
      const i = shapes.indexOf(shape);
      if (i >= 0) {
        shapes.splice(i, 1);
        changed();
      }
    },
    /**
     * Push `pos` ({x, z}, mutated) out of all colliders and keep it inside the
     * world. Returns true if anything was hit.
     */
    resolve(pos, radius = 0.35) {
      let hit = false;
      for (let iter = 0; iter < 2; iter++) {
        const list = candidates(pos.x, pos.z, radius);
        hit = resolveList(list, pos, radius) || hit;
        if (list !== shapes && loose.length) hit = resolveList(loose, pos, radius) || hit;
      }
      const r = Math.hypot(pos.x, pos.z);
      const max = WORLD_RADIUS - radius;
      if (r > max) {
        pos.x *= max / r;
        pos.z *= max / r;
        hit = true;
      }
      return hit;
    },
    /** True if a circle at (x, z) would overlap any collider. */
    isBlocked(x, z, radius = 0.35) {
      const list = candidates(x, z, radius);
      if (overlapsAny(list, x, z, radius)) return true;
      return list !== shapes && loose.length > 0 && overlapsAny(loose, x, z, radius);
    },
    /** Call fn(shape) for every shape whose bounding circle comes within `reach` of (x, z). */
    query(x, z, reach, fn) {
      const list = candidates(x, z, reach);
      visitNear(list, x, z, reach, fn);
      if (list !== shapes) visitNear(loose, x, z, reach, fn);
    },
    /** Signed distance from (x, z) to `shape` (negative inside). */
    distance: shapeDistance,
  };
  return api;
}
