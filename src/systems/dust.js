// ─────────────────────────────────────────────────────────────────────────────
// Dust — tiny toon puffs kicked up by footsteps, landings and snail rides.
// One InstancedMesh pool (a single draw call); puffs pop up, drift and shrink
// away (no transparency needed, which keeps them crisp in the toon style).
//
//   const dust = createDust(ctx)
//   dust.puff(x, y, z, { size = 0.16, count = 1, spread = 0.08, rise = 0.5, life = 0.55, color })
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { palette } from '../core/palette.js';

const POOL = 64;

export function createDust(ctx) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  // a warm emissive lift keeps the shaded side soft & bright (dust, not pebbles)
  const mat = ctx.materials.toon('#ffffff', { emissive: palette.paper, emissiveIntensity: 0.32 });
  const mesh = new THREE.InstancedMesh(geo, mat, POOL);
  mesh.name = 'dust-puffs';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const base = new THREE.Color(palette.sand).lerp(new THREE.Color(palette.paper), 0.6);
  const col = new THREE.Color();
  for (let i = 0; i < POOL; i++) mesh.setColorAt(i, base);
  ctx.scene.add(mesh);

  const px = new Float32Array(POOL), py = new Float32Array(POOL), pz = new Float32Array(POOL);
  const vx = new Float32Array(POOL), vy = new Float32Array(POOL), vz = new Float32Array(POOL);
  const age = new Float32Array(POOL), life = new Float32Array(POOL), size = new Float32Array(POOL);
  const spin = new Float32Array(POOL);
  let next = 0;
  let alive = 0;
  let dirty = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < POOL; i++) mesh.setMatrixAt(i, zero);

  const dust = {
    mesh,
    puff(x, y, z, { size: sz = 0.16, count = 1, spread = 0.08, rise = 0.5, life: lf = 0.55, color = null, outward = 0.25 } = {}) {
      for (let c = 0; c < count; c++) {
        const i = next;
        next = (next + 1) % POOL;
        if (age[i] >= life[i]) alive++;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * spread;
        px[i] = x + Math.cos(a) * r;
        py[i] = y + 0.04;
        pz[i] = z + Math.sin(a) * r;
        const o = outward * (0.6 + Math.random() * 0.6);
        vx[i] = Math.cos(a) * o;
        vz[i] = Math.sin(a) * o;
        vy[i] = rise * (0.7 + Math.random() * 0.6);
        age[i] = 0;
        life[i] = lf * (0.8 + Math.random() * 0.4);
        size[i] = sz * (0.75 + Math.random() * 0.5);
        spin[i] = Math.random() * 6;
        col.copy(color ? col.set(color) : base).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
        mesh.setColorAt(i, col);
        mesh.instanceColor.needsUpdate = true;
      }
      dirty = true;
    },
  };

  ctx.engine.addUpdate((dt) => {
    if (!dirty) return;
    let live = 0;
    for (let i = 0; i < POOL; i++) {
      if (age[i] >= life[i]) continue;
      age[i] += dt;
      const t = age[i] / life[i];
      if (t >= 1) {
        mesh.setMatrixAt(i, zero);
        continue;
      }
      live++;
      const drag = Math.exp(-3.5 * dt);
      vx[i] *= drag;
      vz[i] *= drag;
      vy[i] *= Math.exp(-2.2 * dt);
      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      pz[i] += vz[i] * dt;
      // pop in fast, then shrink away
      const k = t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82;
      const sc = size[i] * (0.55 + 0.45 * Math.sqrt(Math.max(k, 0))) * (t < 0.18 ? k : Math.pow(k, 0.7));
      p.set(px[i], py[i], pz[i]);
      e.set(spin[i] + t, spin[i] * 0.7, 0);
      q.setFromEuler(e);
      s.set(sc, sc * 0.85, sc);
      m4.compose(p, q, s);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    alive = live;
    if (live === 0) dirty = false;
  }, 30);

  Object.defineProperty(dust, 'alive', { get: () => alive });
  return dust;
}
