// ─────────────────────────────────────────────────────────────────────────────
// Things with wings: butterflies fluttering between the glen's wildflower
// patches (and resting on blossoms now and then), dragonflies darting over
// the lily pond, and (optionally) a few birds gliding high overhead.
// Each kind is one InstancedMesh; the wing flap runs in the vertex shader from
// a per-instance (phase, amplitude) attribute the CPU advances every frame.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight } from '../ground.js';
import { GLEN_RADIUS as WORLD_RADIUS } from '../layout.js';
import { materials } from '../../core/materials.js';
import { palette } from '../../core/palette.js';

/** Toon material with a wing hinge along the local Z axis (aWing = 0 body … 1 wing tip). */
function flapMaterial() {
  // (a clone: this material gets its own wing-hinge vertex patch)
  const m = materials.standard('#ffffff', { vertexColors: true, side: THREE.DoubleSide, roughness: 0.55 }).clone();
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute vec2 aFlap;\nattribute float aWing;\n' + shader.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        {
          float ang = aFlap.y * (sin(aFlap.x) * 0.62 + 0.38);
          float side = position.x >= 0.0 ? 1.0 : -1.0;
          float a = ang * aWing * side;
          objectNormal.xy = mat2(cos(a), sin(a), -sin(a), cos(a)) * objectNormal.xy;
        }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float ang = aFlap.y * (sin(aFlap.x) * 0.62 + 0.38);
          float ax = abs(transformed.x);
          float side = transformed.x >= 0.0 ? 1.0 : -1.0;
          float a = ang * aWing;
          transformed.x = mix(transformed.x, side * ax * cos(a), aWing);
          transformed.y += aWing * ax * sin(a);
        }`);
  };
  m.customProgramCacheKey = () => 'ambient-flap-1';
  m.name = 'ambient-flap';
  return m;
}

function finish(pos, col, wing, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Butterfly: two rounded wings per side, a dark body along +Z (head forward). */
function butterflyGeometry() {
  const pos = [], col = [], wing = [], idx = [];
  const fan = (outline, side, edgeDark) => {
    // centre-fan triangulation of a wing outline (x ≥ 0 coordinates, mirrored by side)
    const c = outline.reduce((a, p) => [a[0] + p[0] / outline.length, a[1] + p[1] / outline.length], [0, 0]);
    const o = pos.length / 3;
    pos.push(c[0] * side, 0, c[1]);
    col.push(1, 1, 1);
    wing.push(1);
    for (const [x, z] of outline) {
      pos.push(x * side, 0, z);
      const d = Math.hypot(x, z);
      const k = d > 0.1 ? edgeDark : 1;
      col.push(k, k, k);
      wing.push(1);
    }
    for (let i = 0; i < outline.length; i++) idx.push(o, o + 1 + i, o + 1 + ((i + 1) % outline.length));
  };
  const fore = [[0.01, 0.025], [0.05, 0.1], [0.11, 0.135], [0.165, 0.12], [0.175, 0.07], [0.13, 0.02], [0.07, 0.0], [0.01, -0.005]];
  const hind = [[0.01, -0.005], [0.07, -0.02], [0.115, -0.06], [0.1, -0.11], [0.05, -0.12], [0.012, -0.06]];
  for (const side of [1, -1]) {
    fan(fore, side, 0.62);
    fan(hind, side, 0.78);
  }
  // body: a slim diamond prism (dark)
  const bo = pos.length / 3;
  const body = [[0, 0.012, 0.07], [0.012, 0, 0], [0, 0.012, -0.08], [-0.012, 0, 0], [0, -0.012, 0]];
  for (const b of body) {
    pos.push(...b);
    col.push(0.16, 0.12, 0.1);
    wing.push(0);
  }
  idx.push(bo, bo + 1, bo + 3, bo + 1, bo + 2, bo + 3, bo, bo + 3, bo + 4, bo + 4, bo + 3, bo + 2, bo, bo + 4, bo + 1, bo + 1, bo + 4, bo + 2);
  // the hinge vertices sit on the body: no flapping there
  for (let i = 0; i < wing.length; i++) if (Math.abs(pos[i * 3]) < 0.012) wing[i] = 0;
  return finish(pos, col, wing, idx);
}

/** Bird: a slim body with long swept wings (seen as a silhouette from below). */
function birdGeometry() {
  const pos = [], col = [], wing = [], idx = [];
  const add = (x, y, z, w, k = 1) => {
    pos.push(x, y, z);
    col.push(k, k, k);
    wing.push(w);
    return pos.length / 3 - 1;
  };
  const head = add(0, 0.02, 0.32, 0), tail = add(0, 0, -0.32, 0), belly = add(0, -0.05, 0, 0), back = add(0, 0.05, 0.02, 0);
  idx.push(head, back, tail, head, tail, belly);
  for (const side of [1, -1]) {
    const r0 = add(0.03 * side, 0, 0.1, 0), r1 = add(0.03 * side, 0, -0.08, 0);
    const mid = add(0.38 * side, 0.03, 0.04, 0.55), tip = add(0.75 * side, 0, -0.14, 1, 0.85);
    const midB = add(0.36 * side, 0.02, -0.12, 0.55);
    idx.push(r0, mid, r1, r1, mid, midB, mid, tip, midB);
  }
  // tail fan
  const t0 = add(-0.08, 0, -0.42, 0), t1 = add(0.08, 0, -0.42, 0);
  idx.push(tail, t0, t1);
  return finish(pos, col, wing, idx);
}

/** Dragonfly: long slim body, two pairs of narrow glassy wings. */
function dragonflyGeometry() {
  const pos = [], col = [], wing = [], idx = [];
  const add = (x, y, z, w, k) => {
    pos.push(x, y, z);
    col.push(k, k, k);
    wing.push(w);
    return pos.length / 3 - 1;
  };
  // body: thin diamond prism from head (+Z) to tail (−Z)
  const head = add(0, 0, 0.13, 0, 0.55), tail = add(0, 0, -0.26, 0, 0.55);
  const l = add(-0.014, 0, 0.02, 0, 0.6), r = add(0.014, 0, 0.02, 0, 0.6), up = add(0, 0.014, 0.02, 0, 0.75), dn = add(0, -0.014, 0.02, 0, 0.45);
  idx.push(head, up, l, head, r, up, head, l, dn, head, dn, r, tail, l, up, tail, up, r, tail, dn, l, tail, r, dn);
  // wings: thin leaf shapes, fore & hind, each side
  for (const side of [1, -1]) {
    for (const [z0, len, sweep] of [[0.035, 0.2, 0.02], [-0.005, 0.18, -0.03]]) {
      const root = add(0.012 * side, 0.004, z0, 0, 0.95);
      const a = add(len * 0.5 * side, 0.004, z0 + 0.025 + sweep * 0.5, 0.5, 0.95);
      const tip = add(len * side, 0.004, z0 + sweep, 1, 0.9);
      const b = add(len * 0.5 * side, 0.004, z0 - 0.02 + sweep * 0.5, 0.5, 0.95);
      idx.push(root, a, tip, root, tip, b);
    }
  }
  return finish(pos, col, wing, idx);
}

/**
 * @param ctx
 * @param {{ flowerPatches?: {x,y,z,color}[], butterflies?: number, birds?: number, dragonflies?: number, pond?: {center,radius,waterLevel}, reduced?: boolean }} opts
 */
export function createFlappers(ctx, { flowerPatches = [], butterflies = 18, birds = 6, dragonflies = 4, pond = null, reduced = false } = {}) {
  const rng = ctx.rng('ambient-flappers');
  const mat = flapMaterial();
  const speedK = reduced ? 0.5 : 1;

  // ─── Butterflies ───────────────────────────────────────────────────────────
  const bGeo = butterflyGeometry();
  const bFlap = new THREE.InstancedBufferAttribute(new Float32Array(butterflies * 2), 2);
  bFlap.setUsage(THREE.DynamicDrawUsage);
  bGeo.setAttribute('aFlap', bFlap);
  const bMesh = new THREE.InstancedMesh(bGeo, mat, butterflies);
  bMesh.name = 'ambient:butterflies';
  bMesh.frustumCulled = false;
  bMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const WING_COLORS = [palette.autumnYellow, palette.capCoral, palette.spots, palette.capTeal, palette.autumnOrange, palette.capLavender, palette.postYellow];
  const c = new THREE.Color();
  for (let i = 0; i < butterflies; i++) bMesh.setColorAt(i, c.set(rng.pick(WING_COLORS)).offsetHSL(rng.jitter(0.02), 0, rng.jitter(0.04)));
  ctx.scene.add(bMesh);

  const B = Array.from({ length: butterflies }, () => ({
    x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, vx: 0, vy: 0, vz: 0,
    yaw: 0, phase: rng.range(0, 10), rest: 0, home: null, size: rng.range(1.05, 1.45), seed: rng.range(0, 100), active: false,
  }));
  const candidates = [];
  function pickPatch(fx, fz, minD, maxD) {
    candidates.length = 0;
    for (const p of flowerPatches) {
      const d2 = (p.x - fx) ** 2 + (p.z - fz) ** 2;
      if (d2 > minD * minD && d2 < maxD * maxD) candidates.push(p);
    }
    return candidates.length ? candidates[Math.floor(rng.next() * candidates.length)] : null;
  }
  function newTarget(b) {
    const h = b.home;
    const a = rng.range(0, Math.PI * 2), d = rng.range(0.3, 2.6);
    b.tx = h.x + Math.cos(a) * d;
    b.tz = h.z + Math.sin(a) * d;
    b.ty = getHeight(b.tx, b.tz) + rng.range(0.35, 1.7);
  }
  function placeButterfly(b, fx, fz, near = false) {
    const p = pickPatch(fx, fz, near ? 0 : 6, near ? 22 : 30) || pickPatch(fx, fz, 0, 60);
    if (!p) {
      b.active = false;
      return;
    }
    b.home = p;
    b.active = true;
    const a = rng.range(0, Math.PI * 2), d = rng.range(0.5, 3);
    b.x = p.x + Math.cos(a) * d;
    b.z = p.z + Math.sin(a) * d;
    b.y = getHeight(b.x, b.z) + rng.range(0.5, 1.6);
    b.vx = b.vy = b.vz = 0;
    b.rest = 0;
    newTarget(b);
  }

  // ─── Birds ─────────────────────────────────────────────────────────────────
  const wGeo = birdGeometry();
  const wFlap = new THREE.InstancedBufferAttribute(new Float32Array(birds * 2), 2);
  wFlap.setUsage(THREE.DynamicDrawUsage);
  wGeo.setAttribute('aFlap', wFlap);
  const wMesh = new THREE.InstancedMesh(wGeo, mat, Math.max(1, birds));
  wMesh.count = birds;
  wMesh.name = 'ambient:birds';
  wMesh.frustumCulled = false;
  wMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const birdC = new THREE.Color(palette.ink).lerp(new THREE.Color(palette.skyTop), 0.25);
  for (let i = 0; i < Math.max(1, birds); i++) wMesh.setColorAt(i, c.copy(birdC).offsetHSL(0, 0, rng.jitter(0.04)));
  ctx.scene.add(wMesh);
  const flocks = [{ x: 0, z: 0 }, { x: 0, z: 0 }];
  const W = Array.from({ length: birds }, (_, i) => ({
    flock: flocks[i % flocks.length], r: rng.range(14, 26), h: rng.range(24, 34), a: rng.range(0, Math.PI * 2),
    w: rng.range(0.16, 0.26) * (rng.chance(0.5) ? 1 : -1), phase: rng.range(0, 10), flapT: rng.range(0, 4), flapping: false, amp: 0.3,
  }));

  // ─── Dragonflies (darting over the pond) ───────────────────────────────────
  const dCount = pond ? dragonflies : 0;
  const dGeo = dragonflyGeometry();
  const dFlap = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, dCount) * 2), 2);
  dFlap.setUsage(THREE.DynamicDrawUsage);
  dGeo.setAttribute('aFlap', dFlap);
  const dMesh = new THREE.InstancedMesh(dGeo, mat, Math.max(1, dCount));
  dMesh.name = 'ambient:dragonflies';
  dMesh.frustumCulled = false;
  dMesh.count = dCount;
  dMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const DRAGON = [palette.capTeal, palette.glowCyan, palette.capTeal, palette.autumnRed];
  for (let i = 0; i < Math.max(1, dCount); i++) dMesh.setColorAt(i, c.set(DRAGON[i % DRAGON.length]).offsetHSL(0, 0, rng.jitter(0.05)));
  ctx.scene.add(dMesh);
  const D = Array.from({ length: dCount }, () => ({ x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, sx: 0, sy: 0, sz: 0, t: 1, dur: 1, hover: 0, yaw: 0, phase: rng.range(0, 10), seed: rng.range(0, 100) }));
  const pondTarget = (d) => {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * pond.radius * 0.95;
    d.tx = pond.center.x + Math.cos(a) * r;
    d.tz = pond.center.z + Math.sin(a) * r;
    d.ty = pond.waterLevel + rng.range(0.35, 1.1);
  };
  for (const d of D) {
    pondTarget(d);
    d.x = d.sx = d.tx;
    d.y = d.sy = d.ty;
    d.z = d.sz = d.tz;
    d.hover = rng.range(0, 2);
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), s = new THREE.Vector3();
  const lastFocus = new THREE.Vector3(1e9, 0, 1e9);
  let t = 0;

  return {
    objects: [bMesh, wMesh, dMesh],
    update(dt, focus, night) {
      t += dt;
      const day = 1 - night;
      bMesh.visible = day > 0.03;
      wMesh.visible = bMesh.visible && birds > 0;
      dMesh.visible = bMesh.visible && dCount > 0 && (focus.x - pond.center.x) ** 2 + (focus.z - pond.center.z) ** 2 < 45 * 45;
      if (!bMesh.visible) return;
      const fx = focus.x, fz = focus.z;
      const jumped = (fx - lastFocus.x) ** 2 + (fz - lastFocus.z) ** 2 > 30 * 30;
      if (jumped) {
        lastFocus.set(fx, 0, fz);
        for (const b of B) placeButterfly(b, fx, fz, true);
        for (const f of flocks) {
          f.x = fx + rng.jitter(12);
          f.z = fz + rng.jitter(12);
        }
      }
      // ── butterflies
      const vis = Math.min(1, day * 1.5);
      for (let i = 0; i < B.length; i++) {
        const b = B[i];
        if (!b.active || (b.x - fx) ** 2 + (b.z - fz) ** 2 > 38 * 38) placeButterfly(b, fx, fz, false);
        let rate = 15, amp = 1.15;
        if (b.active) {
          if (b.rest > 0) {
            // resting on a flower: slow, proud wing beats
            b.rest -= dt;
            rate = 2.2;
            amp = 0.85;
            if (b.rest <= 0) newTarget(b);
          } else {
            const dx = b.tx - b.x, dy = b.ty - b.y, dz = b.tz - b.z;
            const d = Math.hypot(dx, dy, dz) || 1;
            const sp = 1.5 * speedK;
            const k = Math.min(1, dt * 2.2);
            // wobbly steering towards the target
            const wob = Math.sin(t * 3.1 + b.seed) * 0.9;
            b.vx += ((dx / d) * sp + Math.cos(b.seed + t * 2.3) * wob - b.vx) * k;
            b.vz += ((dz / d) * sp + Math.sin(b.seed + t * 1.9) * wob - b.vz) * k;
            b.vy += ((dy / d) * sp * 0.6 - b.vy) * k;
            b.x += b.vx * dt;
            b.y += b.vy * dt + Math.sin(t * 9 + b.seed) * 0.12 * dt * 6 * speedK;
            b.z += b.vz * dt;
            const g = getHeight(b.x, b.z) + 0.2;
            if (b.y < g) b.y = g;
            if (d < 0.35) {
              if (rng.chance(0.3)) {
                b.rest = rng.range(1.5, 4);
                b.y = getHeight(b.x, b.z) + rng.range(0.28, 0.45);
              } else {
                if (rng.chance(0.15)) b.home = pickPatch(b.x, b.z, 2, 14) || b.home;
                newTarget(b);
              }
            }
            const targetYaw = Math.atan2(b.vx, b.vz);
            let dyaw = targetYaw - b.yaw;
            dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
            b.yaw += dyaw * Math.min(1, dt * 6);
          }
        }
        b.phase += dt * rate * (reduced ? 0.6 : 1);
        bFlap.setXY(i, b.phase, amp);
        p.set(b.x, b.y, b.z);
        q.setFromEuler(e.set(b.rest > 0 ? 0 : -0.25, b.yaw, 0));
        // never a big blur right in front of the lens
        const camD = p.distanceTo(ctx.camera.position);
        const near = Math.min(1, Math.max(0, (camD - 2) / 2.5));
        s.setScalar(b.active ? b.size * vis * near : 0);
        m.compose(p, q, s);
        bMesh.setMatrixAt(i, m);
      }
      bMesh.instanceMatrix.needsUpdate = true;
      bFlap.needsUpdate = true;

      // ── birds: flocks drift after the player, birds circle and glide
      for (const f of flocks) {
        f.x += (fx - f.x) * Math.min(1, dt * 0.05);
        f.z += (fz - f.z) * Math.min(1, dt * 0.05);
        const r = Math.hypot(f.x, f.z);
        if (r > WORLD_RADIUS) {
          f.x *= WORLD_RADIUS / r;
          f.z *= WORLD_RADIUS / r;
        }
      }
      for (let i = 0; i < W.length; i++) {
        const w = W[i];
        w.a += w.w * dt * speedK;
        w.flapT -= dt;
        if (w.flapT < 0) {
          w.flapping = !w.flapping;
          w.flapT = w.flapping ? rng.range(0.8, 2) : rng.range(2.5, 6);
        }
        w.amp += ((w.flapping ? 1.0 : 0.12) - w.amp) * Math.min(1, dt * 3);
        w.phase += dt * (w.flapping ? 9 : 2) * speedK;
        wFlap.setXY(i, w.phase, w.amp);
        const x = w.flock.x + Math.cos(w.a) * w.r, z = w.flock.z + Math.sin(w.a) * w.r;
        const y = w.h + Math.sin(t * 0.4 + i) * 1.2;
        // tangent heading + bank into the turn
        const yaw = Math.atan2(-Math.sin(w.a) * Math.sign(w.w), Math.cos(w.a) * Math.sign(w.w));
        p.set(x, y, z);
        q.setFromEuler(e.set(0, yaw, -0.35 * Math.sign(w.w)));
        s.setScalar(1.4 * Math.min(1, day * 1.5));
        m.compose(p, q, s);
        wMesh.setMatrixAt(i, m);
      }
      wMesh.instanceMatrix.needsUpdate = true;
      wFlap.needsUpdate = true;

      // ── dragonflies: hover, then dart to a new spot over the water
      if (dMesh.visible) {
        for (let i = 0; i < D.length; i++) {
          const d = D[i];
          if (d.hover > 0) {
            d.hover -= dt;
            if (d.hover <= 0) {
              d.sx = d.x;
              d.sy = d.y;
              d.sz = d.z;
              pondTarget(d);
              d.t = 0;
              d.dur = Math.max(0.35, Math.hypot(d.tx - d.sx, d.tz - d.sz) / (5 * speedK));
              d.yaw = Math.atan2(d.tx - d.sx, d.tz - d.sz);
            }
          } else {
            d.t = Math.min(1, d.t + dt / d.dur);
            const k = d.t * d.t * (3 - 2 * d.t);
            d.x = d.sx + (d.tx - d.sx) * k;
            d.y = d.sy + (d.ty - d.sy) * k + Math.sin(d.t * Math.PI) * 0.25;
            d.z = d.sz + (d.tz - d.sz) * k;
            if (d.t >= 1) d.hover = rng.range(0.6, 2.4);
          }
          const jx = Math.sin(t * 7 + d.seed) * 0.03, jy = Math.sin(t * 5.3 + d.seed * 2) * 0.04;
          d.phase += dt * 42;
          dFlap.setXY(i, d.phase, 0.45);
          p.set(d.x + jx, d.y + jy, d.z);
          q.setFromEuler(e.set(-0.08, d.yaw, 0));
          s.setScalar(1.5 * Math.min(1, day * 1.5));
          m.compose(p, q, s);
          dMesh.setMatrixAt(i, m);
        }
        dMesh.instanceMatrix.needsUpdate = true;
        dFlap.needsUpdate = true;
      }
    },
  };
}
