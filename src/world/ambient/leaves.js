// ─────────────────────────────────────────────────────────────────────────────
// Falling leaves drifting down from the Great Oak's canopy over the glen (and
// now and then from the forest wall's giants near the camera), tumbling side
// to side, resting on the moss for a moment and then shrinking away.
// A small InstancedMesh updated on the CPU (no allocations per frame).
// Sources: ctx.oak.crownBounds (or the oak anchor) + vegetation.treesNear.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight } from '../ground.js';
import { OAK } from '../layout.js';
import { materials } from '../../core/materials.js';

function leafGeometry() {
  // a little curled leaf: tip, two sides and a stem notch, folded along the vein
  const pos = new Float32Array([
    0, 0.0, 0.11, // tip
    -0.055, 0.012, 0.0,
    0.055, 0.012, 0.0,
    0, -0.004, -0.07, // stem end
    0, 0.0, 0.02, // vein midpoint (lower → fold)
  ]);
  const idx = [0, 1, 4, 0, 4, 2, 4, 1, 3, 4, 3, 2];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const LEAF_COLORS = ['#6f9a3c', '#86a640', '#a7a83c', '#c8a23a', '#d08a34', '#b8622c', '#7a8f34'];

export function createLeaves(ctx, { count = 36, reduced = false } = {}) {
  const veg = ctx.modules?.vegetation;
  const rng = ctx.rng('ambient-leaves');
  const mesh = new THREE.InstancedMesh(leafGeometry(), materials.standard('#ffffff', { side: THREE.DoubleSide, roughness: 0.75 }), count);
  mesh.name = 'ambient:leaves';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) mesh.setColorAt(i, color.setRGB(1, 1, 1));
  ctx.scene.add(mesh);

  // the oak's crown as the main source
  const cb = ctx.oak?.crownBounds;
  const oakSrc = cb && !cb.isEmpty()
    ? { x: (cb.min.x + cb.max.x) / 2, z: (cb.min.z + cb.max.z) / 2, r: Math.min(cb.max.x - cb.min.x, cb.max.z - cb.min.z) * 0.42, y0: Math.max(10, cb.min.y + 2), y1: Math.min(cb.max.y, cb.min.y + 12) }
    : { x: OAK.x, z: OAK.z, r: 14, y0: 13, y1: 22 };

  // state (struct of arrays)
  const px = new Float32Array(count), py = new Float32Array(count), pz = new Float32Array(count);
  const vy = new Float32Array(count), sway = new Float32Array(count), ph = new Float32Array(count);
  const rest = new Float32Array(count), gy = new Float32Array(count), scale = new Float32Array(count);
  const spin = new Float32Array(count * 3), ang = new Float32Array(count * 3);
  const alive = new Uint8Array(count);
  const near = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const speed = reduced ? 0.45 : 1;

  function spawn(i, fx, fz, prewarm) {
    alive[i] = 0;
    let sx, sz, top;
    if (rng.chance(0.75)) {
      const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * oakSrc.r;
      sx = oakSrc.x + Math.cos(a) * d;
      sz = oakSrc.z + Math.sin(a) * d;
      top = rng.range(oakSrc.y0, oakSrc.y1);
    } else {
      if (!veg?.treesNear) return;
      veg.treesNear(fx, fz, 30, near);
      if (!near.length) return;
      const t = near[Math.floor(rng.next() * near.length)];
      const a = rng.range(0, Math.PI * 2), d = rng.range(1, t.crownR);
      sx = t.x + Math.cos(a) * d;
      sz = t.z + Math.sin(a) * d;
      top = Math.min(t.crownY, 30);
    }
    px[i] = sx;
    pz[i] = sz;
    gy[i] = getHeight(sx, sz) + 0.03;
    py[i] = prewarm ? gy[i] + rng.range(0.2, 1) * (top - gy[i]) : top;
    vy[i] = rng.range(0.45, 0.8);
    sway[i] = rng.range(0.5, 1.1);
    ph[i] = rng.range(0, 100);
    rest[i] = rng.range(2.5, 6);
    scale[i] = rng.range(1.0, 1.5);
    for (let k = 0; k < 3; k++) {
      spin[i * 3 + k] = rng.range(-3, 3);
      ang[i * 3 + k] = rng.range(0, 6.28);
    }
    color.set(LEAF_COLORS[Math.floor(rng.next() * LEAF_COLORS.length)]).offsetHSL(rng.jitter(0.02), 0, rng.jitter(0.05));
    mesh.setColorAt(i, color);
    mesh.instanceColor.needsUpdate = true;
    alive[i] = 1;
  }

  let t = 0;
  let primed = false;
  return {
    object: mesh,
    update(dt, focus) {
      t += dt;
      if (!primed) {
        primed = true;
        for (let i = 0; i < count; i++) spawn(i, focus.x, focus.z, true);
      }
      for (let i = 0; i < count; i++) {
        if (!alive[i]) {
          // stagger respawns so leaves keep trickling
          if (rng.chance(dt * 0.5)) spawn(i, focus.x, focus.z, false);
          s.setScalar(0);
        } else {
          if (py[i] > gy[i]) {
            // falling: pendulum sway + gentle drift with the breeze
            const w = Math.sin(t * 1.6 * speed + ph[i]);
            py[i] -= vy[i] * dt * speed * (0.75 + 0.35 * Math.abs(w));
            px[i] += (w * sway[i] * 0.9 + 0.3) * dt * speed;
            pz[i] += (Math.cos(t * 1.1 * speed + ph[i]) * sway[i] * 0.5 + 0.15) * dt * speed;
            for (let a = 0; a < 3; a++) ang[i * 3 + a] += spin[i * 3 + a] * dt * speed;
            if (py[i] <= gy[i]) {
              gy[i] = getHeight(px[i], pz[i]) + 0.03;
              py[i] = gy[i];
              ang[i * 3] = 0;
              ang[i * 3 + 2] = 0;
            }
          } else {
            rest[i] -= dt;
            if (rest[i] < 0) alive[i] = 0;
          }
          const fade = alive[i] ? Math.min(1, Math.max(0, rest[i] / 0.8)) : 0;
          s.setScalar(scale[i] * fade);
        }
        p.set(px[i], py[i], pz[i]);
        q.setFromEuler(e.set(ang[i * 3], ang[i * 3 + 1], ang[i * 3 + 2]));
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
