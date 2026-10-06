// ─────────────────────────────────────────────────────────────────────────────
// Falling leaves (and blossom petals) drifting down from crowns near the
// player, tumbling side to side, resting on the grass for a moment and then
// shrinking away. A small InstancedMesh updated on the CPU (no allocations).
// Uses vegetation's tree list (ctx.modules.vegetation.treesNear).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight } from '../ground.js';
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

export function createLeaves(ctx, { count = 36, reduced = false } = {}) {
  const veg = ctx.modules?.vegetation;
  const rng = ctx.rng('ambient-leaves');
  const mesh = new THREE.InstancedMesh(leafGeometry(), materials.toon('#ffffff', { side: THREE.DoubleSide }), count);
  mesh.name = 'ambient:leaves';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) mesh.setColorAt(i, color.setRGB(1, 1, 1));
  ctx.scene.add(mesh);

  // state (struct of arrays)
  const px = new Float32Array(count), py = new Float32Array(count), pz = new Float32Array(count);
  const vy = new Float32Array(count), sway = new Float32Array(count), ph = new Float32Array(count);
  const rest = new Float32Array(count), gy = new Float32Array(count), scale = new Float32Array(count);
  const spin = new Float32Array(count * 3), ang = new Float32Array(count * 3);
  const alive = new Uint8Array(count);
  const near = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const lastFocus = new THREE.Vector3(1e9, 0, 1e9);
  const speed = reduced ? 0.45 : 1;

  function spawn(i, fx, fz, prewarm) {
    alive[i] = 0;
    if (!veg?.treesNear) return;
    veg.treesNear(fx, fz, 26, near);
    if (!near.length) return;
    // autumn trees and blossoms shed far more than green ones
    let t = null;
    for (let k = 0; k < 4 && !t; k++) {
      const c = near[Math.floor(rng.next() * near.length)];
      if (c.autumn || c.kind === 'blossom' || rng.chance(0.3)) t = c;
    }
    if (!t) return;
    const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * t.crownR * 0.75;
    px[i] = t.x + Math.cos(a) * d;
    pz[i] = t.z + Math.sin(a) * d;
    gy[i] = getHeight(px[i], pz[i]) + 0.03;
    const top = t.crownY - t.crownR * 0.25;
    py[i] = prewarm ? gy[i] + rng.range(0.2, 1) * (top - gy[i]) : top;
    vy[i] = rng.range(0.45, 0.8);
    sway[i] = rng.range(0.5, 1.1);
    ph[i] = rng.range(0, 100);
    rest[i] = rng.range(2.5, 6);
    scale[i] = t.kind === 'blossom' ? rng.range(0.7, 0.9) : rng.range(1.0, 1.5);
    for (let k = 0; k < 3; k++) {
      spin[i * 3 + k] = rng.range(-3, 3);
      ang[i * 3 + k] = rng.range(0, 6.28);
    }
    color.copy(t.leaf).offsetHSL(rng.jitter(0.03), 0, rng.jitter(0.06));
    mesh.setColorAt(i, color);
    mesh.instanceColor.needsUpdate = true;
    alive[i] = 1;
  }

  let t = 0;
  return {
    object: mesh,
    update(dt, focus) {
      t += dt;
      // after a teleport / big jump, re-seed everything around the new spot
      const jumped = (focus.x - lastFocus.x) ** 2 + (focus.z - lastFocus.z) ** 2 > 30 * 30;
      if (jumped) {
        lastFocus.copy(focus);
        for (let i = 0; i < count; i++) spawn(i, focus.x, focus.z, true);
      } else if ((focus.x - lastFocus.x) ** 2 + (focus.z - lastFocus.z) ** 2 > 4) lastFocus.copy(focus);
      let k = 0;
      for (let i = 0; i < count; i++) {
        if (!alive[i]) {
          // stagger respawns so leaves keep trickling
          if (rng.chance(dt * 0.6)) spawn(i, focus.x, focus.z, false);
          s.setScalar(0);
        } else {
          const dx = px[i] - focus.x, dz = pz[i] - focus.z;
          if (dx * dx + dz * dz > 36 * 36) {
            alive[i] = 0;
          } else if (py[i] > gy[i]) {
            // falling: pendulum sway + gentle drift with the breeze
            const w = Math.sin(t * 1.6 * speed + ph[i]);
            py[i] -= vy[i] * dt * speed * (0.75 + 0.35 * Math.abs(w));
            px[i] += (w * sway[i] * 0.9 + 0.35) * dt * speed;
            pz[i] += (Math.cos(t * 1.1 * speed + ph[i]) * sway[i] * 0.5 + 0.2) * dt * speed;
            for (let a = 0; a < 3; a++) ang[i * 3 + a] += spin[i * 3 + a] * dt * speed;
            if (py[i] <= gy[i]) {
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
        k++;
      }
      mesh.instanceMatrix.needsUpdate = k > 0;
    },
  };
}
