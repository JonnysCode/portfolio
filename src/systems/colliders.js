// ─────────────────────────────────────────────────────────────────────────────
// Colliders — simple 2D (XZ) obstacles so villagers and the player don't walk
// through houses, trees or workbenches. All coordinates are WORLD XZ.
//
//   colliders.addCircle(x, z, r)                    → tree trunks, mushroom stems
//   colliders.addBox(x, z, halfW, halfD, rotY)      → buildings, benches, tables
//   colliders.resolve(pos, radius)                  → pushes pos {x,z} out of everything
// District builders should use site.addCollider / site.addBoxCollider instead,
// which take district-local coordinates.
// ─────────────────────────────────────────────────────────────────────────────
import { WORLD_RADIUS } from '../world/layout.js';

export function createColliders() {
  /** @type {Array<{type:'circle'|'box', x:number, z:number, r?:number, hw?:number, hd?:number, rot?:number, cos?:number, sin?:number, bound:number, tag?:string}>} */
  const shapes = [];

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
    let ox = lx - cx, oz = lz - cz;
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

  const api = {
    shapes,
    addCircle(x, z, r, tag) {
      const s = { type: 'circle', x, z, r, bound: r, tag };
      shapes.push(s);
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
      return s;
    },
    remove(shape) {
      const i = shapes.indexOf(shape);
      if (i >= 0) shapes.splice(i, 1);
    },
    /**
     * Push `pos` ({x, z}, mutated) out of all colliders and keep it inside the
     * world. Returns true if anything was hit.
     */
    resolve(pos, radius = 0.35) {
      let hit = false;
      for (let iter = 0; iter < 2; iter++) {
        for (const s of shapes) {
          const dx = pos.x - s.x, dz = pos.z - s.z;
          const reach = s.bound + radius;
          if (dx * dx + dz * dz > reach * reach) continue;
          hit = (s.type === 'circle' ? resolveCircle(pos, radius, s) : resolveBox(pos, radius, s)) || hit;
        }
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
      const p = { x, z };
      for (const s of shapes) {
        const dx = x - s.x, dz = z - s.z;
        const reach = s.bound + radius;
        if (dx * dx + dz * dz > reach * reach) continue;
        p.x = x; p.z = z;
        if (s.type === 'circle' ? resolveCircle(p, radius, s) : resolveBox(p, radius, s)) return true;
      }
      return false;
    },
  };
  return api;
}
