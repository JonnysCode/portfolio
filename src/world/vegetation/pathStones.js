// ─────────────────────────────────────────────────────────────────────────────
// Flagstones & stepping stones along the glen's paths (refs: the fairy-garden
// flagstone path, the pebbled bridge path, the tower-house garden path).
//
// Every stone is unique: an irregular rounded slab (lumpy outline, domed and
// slightly dished top, bevelled edge) sunk into the soil so only its top
// shows, tilted with the ground. The main path gets a loose cobbled pair of
// stones per stride; the side paths get single/double stepping stones that
// zig-zag. All stones are merged into ONE mesh (1 draw call) with a mossy
// painterly rock surface; per-stone vertex colours vary warm/cool greys.
// Returns the stones ({ x, z, r }) so the undergrowth can tuck grass and
// clover into the gaps between them.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { getHeight, getNormal, getPadAt, isInWater, pathPolylines } from '../ground.js';
import { GeoBuilder, TAU, staticMesh } from './common.js';

const STONE_TINTS = ['#a89f8c', '#9e9584', '#948f84', '#ab9f86', '#9f9888', '#93918a', '#b0a48a', '#8c877d'];

/** One irregular slab in local space (top at y ≈ 0, body sinking to −depth). */
function stoneGeometry(B, rng, m, rx, rz, color) {
  const seg = rng.int(10, 13);
  const phase = rng.range(0, TAU);
  const lobes = rng.int(2, 4);
  const dome = rng.range(0.012, 0.035);
  const depth = rng.range(0.12, 0.18);
  const outline = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    // lumpy, slightly flattened sides — never a perfect ellipse
    const k = 1 + 0.12 * Math.sin(a * lobes + phase) + rng.jitter(0.07);
    const flat = Math.abs(Math.cos(a * 2 + phase)) > 0.92 ? 0.94 : 1;
    outline.push([Math.cos(a) * rx * k * flat, Math.sin(a) * rz * k * flat]);
  }
  // rings (fraction of outline, height)
  const rings = [
    [0.0, dome],
    [0.45, dome * 0.75 + rng.jitter(0.006)],
    [0.82, dome * 0.25],
    [0.97, -0.012],
    [1.03, -0.05],
    [1.06, -depth],
  ];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const base = B.count;
  // centre vertex
  v.set(0, dome, 0).applyMatrix4(m);
  n.set(0, 1, 0).applyMatrix3(nm).normalize();
  B.vert(v.x, v.y, v.z, n.x, n.y, n.z, 0.5, 0.5, color);
  for (let r = 1; r < rings.length; r++) {
    const [f, y] = rings[r];
    for (let i = 0; i < seg; i++) {
      const [ox, oz] = outline[i];
      // small surface undulation so the top is not a perfect dome
      const wob = r < 4 ? rng.jitter(0.006) : 0;
      v.set(ox * f, y + wob, oz * f).applyMatrix4(m);
      // approximate normal: up on top, outwards on the bevel/sides
      const side = r >= 3 ? (r === 3 ? 0.55 : 0.92) : r * 0.12;
      n.set(ox * side, 1 - side * 0.8, oz * side).normalize().applyMatrix3(nm).normalize();
      B.vert(v.x, v.y, v.z, n.x, n.y, n.z, 0.5 + ox, 0.5 + oz, color);
    }
  }
  // fan + strips
  for (let i = 0; i < seg; i++) B.tri(base, base + 1 + ((i + 1) % seg), base + 1 + i);
  for (let r = 1; r < rings.length - 1; r++) {
    const a0 = base + 1 + (r - 1) * seg;
    const b0 = base + 1 + r * seg;
    for (let i = 0; i < seg; i++) {
      const i1 = (i + 1) % seg;
      B.quad(a0 + i, a0 + i1, b0 + i1, b0 + i);
    }
  }
}

/**
 * Lay the stones. Returns { mesh, stones }.
 * material: a surface material with vertexColors.
 */
export function buildPathStones(ctx, material) {
  const rng = createRng('path-stones');
  const B = new GeoBuilder();
  const stones = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const nrm = new THREE.Vector3();
  const qy = new THREE.Quaternion();
  const col = new THREE.Color();

  const fits = (x, z, r) => {
    if (getPadAt(x, z, r * 0.3)) return false;
    if (isInWater(x, z, 0.15)) return false;
    // (r = mean radius: the slabs are elongated and lie across the path, so a
    //  max-radius circle test would reject most neighbours)
    for (let i = stones.length - 1; i >= 0 && i > stones.length - 40; i--) {
      const s = stones[i];
      if (Math.hypot(s.x - x, s.z - z) < (s.r + r) * 0.88 + 0.05) return false;
    }
    return true;
  };

  const place = (x, z, rx, rz, yaw) => {
    let r = (rx + rz) / 2;
    if (!fits(x, z, r)) {
      // try a smaller stone in the gap before giving up
      rx *= 0.72;
      rz *= 0.72;
      r *= 0.72;
      if (!fits(x, z, r)) return false;
    }
    const y = getHeight(x, z);
    getNormal(x, z, nrm);
    // sit with the ground, a tiny random rock, top just proud of the soil
    q.setFromUnitVectors(up, nrm.lerp(up, 0.35).normalize());
    qy.setFromAxisAngle(up, yaw);
    q.multiply(qy);
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.jitter(0.035), 0, rng.jitter(0.035)));
    q.multiply(tilt);
    m.compose(new THREE.Vector3(x, y + rng.range(0.015, 0.045), z), q, new THREE.Vector3(1, 1, 1));
    col.set(rng.pick(STONE_TINTS)).offsetHSL(0, rng.jitter(0.02), rng.jitter(0.04));
    stoneGeometry(B, rng, m, rx, rz, col);
    stones.push({ x, z, r: (rx + rz) / 2 });
    return true;
  };

  for (const p of pathPolylines) {
    const pts = p.pts;
    const main = p.id === 'main';
    const hw = p.halfWidth;
    // arc-length walk
    let carry = rng.range(0, 0.3);
    let side = 1;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      const tx = dx / len, tz = dz / len;
      const yawBase = Math.atan2(tx, tz);
      let s = carry;
      while (s < len) {
        const cx = a.x + tx * s, cz = a.z + tz * s;
        if (main) {
          // a loose cobbled band: 2 (sometimes 3) stones across, staggered rows
          const n = rng.chance(0.35) ? 3 : 2;
          const stagger = side * 0.14;
          for (let k = 0; k < n; k++) {
            const off = ((k + 0.5) / n - 0.5) * hw * 1.5 + stagger + rng.jitter(0.07);
            const rx = rng.range(0.34, 0.48) * (n === 3 ? 0.8 : 1);
            const rz = rx * rng.range(0.72, 0.95);
            const along = rng.jitter(0.08);
            if (rng.chance(0.06)) continue; // a missing stone: moss and grass fill the hole
            // the long side of a flagstone tends to lie across the path
            place(cx - tz * off + tx * along, cz + tx * off + tz * along, rx, rz, yawBase + Math.PI / 2 + rng.jitter(0.5));
          }
          s += rng.range(0.66, 0.78);
        } else {
          // stepping stones: zig-zag, now and then a pair
          const pair = rng.chance(0.45);
          const offs = pair ? [-0.3, 0.32] : [side * rng.range(0.08, 0.22)];
          for (const o of offs) {
            const rx = rng.range(0.3, 0.42) * (pair ? 0.85 : 1);
            place(cx - tz * o * hw, cz + tx * o * hw, rx, rx * rng.range(0.72, 0.95), yawBase + Math.PI / 2 + rng.jitter(0.7));
          }
          s += rng.range(0.66, 0.8);
        }
        side = -side;
      }
      carry = s - len;
    }
  }
  const geo = B.build();
  const mesh = staticMesh('path-stones', geo, material, { cast: false, receive: true });
  return { mesh, stones, triangles: geo.index.count / 3 };
}
