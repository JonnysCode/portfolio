// ─────────────────────────────────────────────────────────────────────────────
// Little living effects of the Schreinerei:
//   makeShavings(ctx, opts)   curly wood shavings springing off the hand plane
//   makeNotes(ctx, opts)      ♪ ♫ notes floating up from the record player
//   makeMotes(ctx, volumes)   golden sawdust motes drifting in the warm light
// Notes are camera-facing quads billboarded in the vertex shader (one draw
// call, fogged like the rest of the scene). No per-frame allocations.
// (The chimney uses the glen's shared soft plume, props/smoke.js.)
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { sharedUniforms } from '../../core/materials.js';

const BILLBOARD_VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute vec4 aData; // x: seed, y: life (0..1, <0 hidden), z: size, w: glyph / alpha
  uniform float uTime;
  varying vec2 vUv;
  varying vec4 vData;
  void main() {
    vUv = uv;
    vData = aData;
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float rot = aData.x * 6.28 + uTime * 0.25 * (fract(aData.x * 7.0) - 0.5);
    vec2 c = position.xy;
    c = vec2(c.x * cos(rot) - c.y * sin(rot), c.x * sin(rot) + c.y * cos(rot));
    mvPosition.xy += c * aData.z;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

// ─── shavings ────────────────────────────────────────────────────────────────
/** A curly shaving: a thin ribbon wound into a little spiral. */
export function shavingGeo(r = 0.035, width = 0.022, turns = 1.4) {
  const segs = 18;
  const pos = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = t * turns * Math.PI * 2;
    const rr = r * (1 - t * 0.45);
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    const z = t * width * 1.4;
    pos.push(x, y, z - width / 2, x, y, z + width / 2);
    if (i < segs) {
      const b = i * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const uv = new Float32Array((segs + 1) * 4);
  for (let i = 0; i <= segs; i++) {
    uv.set([i / segs, 0, i / segs, 1], i * 4);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * Shavings springing off a plane: particles spawn at source() (world point),
 * fly up/back (and a little sideways), tumble and drop onto the floor under
 * them, then fade. Warm-started so a few are always in flight.
 * opts: { count = 14, size = 1, rate = 3.2 (per second), material, geometry (optional overrides),
 *   source: (out) => Vector3,
 *   dir: Vector3 (backwards, away from the stroke), side: Vector3 (optional sideways throw),
 *   floorAt: (p) => y  (or floorY) }
 */
export function makeShavings(ctx, opts = {}) {
  const count = Math.max(6, Math.round((opts.count ?? 14) * (ctx.quality?.density ?? 1)));
  const size = opts.size ?? 1;
  const mat = opts.material ?? ctx.materials.surface('wood', { species: 'maple', side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(opts.geometry ?? shavingGeo(0.035 * size, 0.022 * size, 1.4), mat, count);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'shavings';
  mesh.raycast = () => {};
  const P = [];
  for (let i = 0; i < count; i++) P.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: -1 - i * 0.12, ttl: 1, floor: 0 });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const dir = opts.dir ?? new THREE.Vector3(0, 0, 1);
  const side = opts.side ?? null;
  const floorY = opts.floorY ?? 0;
  const floorAt = opts.floorAt ?? (() => floorY);
  const reduced = ctx.engine?.reducedMotion;
  const rate = reduced ? 0.8 : opts.rate ?? 3.2;
  let acc = 0;
  let rnd = 12345;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  function update(dt) {
    dt = Math.min(dt, 0.1);
    acc += dt * rate;
    for (let i = 0; i < count; i++) {
      const a = P[i];
      if (a.life < 0) {
        a.life += dt;
        if (a.life >= 0 && acc >= 1) {
          acc -= 1;
          opts.source(tmp);
          a.p.copy(tmp);
          const sk = side ? 0.15 + rand() * 0.45 : 0;
          a.v.set(dir.x * 0.5 + (rand() - 0.5) * 0.35, 0.95 + rand() * 0.6, dir.z * 0.5 + (rand() - 0.5) * 0.35);
          if (side) a.v.addScaledVector(side, sk);
          a.w.set((rand() - 0.5) * 9, (rand() - 0.5) * 9, (rand() - 0.5) * 9);
          a.r.set(rand() * 6, rand() * 6, rand() * 6);
          a.ttl = 1.8 + rand() * 1.4;
          a.life = 0;
          a.floor = floorAt(a.p);
        } else if (a.life >= 0) a.life = -0.05;
      } else {
        a.life += dt;
        if (a.p.y > a.floor) {
          a.v.y -= 3.2 * dt;
          a.v.multiplyScalar(1 - 1.6 * dt);
          a.p.addScaledVector(a.v, dt);
          a.r.x += a.w.x * dt;
          a.r.y += a.w.y * dt;
          a.r.z += a.w.z * dt;
          // the floor under the shaving (bench top, or the porch floor once it tumbles off)
          a.floor = floorAt(a.p);
          if (a.p.y < a.floor) a.p.y = a.floor;
        }
        if (a.life > a.ttl) a.life = -0.2 - rand() * 0.4;
      }
      const k = a.life < 0 ? 0 : Math.min(1, a.life * 6) * (1 - Math.max(0, (a.life - a.ttl + 0.5) / 0.5));
      q.setFromEuler(a.r);
      s.setScalar(Math.max(0.0001, k));
      m.compose(a.p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  // warm start: a couple of seconds of planing already happened
  for (let i = 0; i < 75; i++) update(1 / 30);
  return { object: mesh, update };
}

// ─── notes ───────────────────────────────────────────────────────────────────
const NOTES_FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform sampler2D uMap;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec4 vData;
  void main() {
    if (vData.y < 0.0) discard;
    float glyph = floor(vData.w + 0.5);
    vec2 uv = vec2((vUv.x + glyph) * 0.5, vUv.y);
    float a = texture2D(uMap, uv).a;
    float life = vData.y;
    a *= smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.6, 1.0, life));
    if (a < 0.02) discard;
    gl_FragColor = vec4(uColor * 1.6, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * Floating music notes rising from `origin` while playing. setPlaying(bool).
 */
export function makeNotes(ctx, { origin = new THREE.Vector3(), count = 7 } = {}) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.font = '600 104px "Fredoka", "Segoe UI Symbol", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(255,255,255,0.8)';
  g.shadowBlur = 8;
  g.fillText('♪', 64, 66);
  g.fillText('♫', 192, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uMap: { value: null }, uColor: { value: new THREE.Color('#ffd27a') } }]),
    vertexShader: BILLBOARD_VERT,
    fragmentShader: NOTES_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
    name: 'schreinerei-notes',
  });
  mat.uniforms.uMap.value = tex;
  const geo = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) data.set([i * 0.137 + 0.05, -1, 0.16, i % 2], i * 4);
  const attr = new THREE.InstancedBufferAttribute(data, 4);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aData', attr);
  mesh.position.copy(origin);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.name = 'notes';
  mesh.raycast = () => {};
  const m = new THREE.Matrix4();
  let playing = false;
  let level = 0;
  const lives = new Float32Array(count).fill(-1);
  let spawn = 0;
  function update(dt, t) {
    dt = Math.min(dt, 0.1);
    level += ((playing ? 1 : 0) - level) * Math.min(1, dt * 2);
    spawn += dt * 1.6 * (playing ? 1 : 0);
    for (let i = 0; i < count; i++) {
      if (lives[i] < 0) {
        if (spawn >= 1) {
          spawn -= 1;
          lives[i] = 0;
          data[i * 4 + 3] = (i + Math.floor(t)) % 2;
        }
      } else {
        lives[i] += dt / 3.2;
        if (lives[i] >= 1) lives[i] = -1;
      }
      const life = lives[i];
      const seed = data[i * 4];
      const x = Math.sin(life * 5 + seed * 20) * 0.18 + (seed - 0.5) * 0.3;
      const y = life * 1.4;
      const z = Math.cos(life * 4 + seed * 9) * 0.08;
      m.makeTranslation(x, y, z);
      mesh.setMatrixAt(i, m);
      data[i * 4 + 1] = life;
      data[i * 4 + 2] = 0.2 + 0.06 * Math.sin(seed * 30);
    }
    let alive = false;
    for (let i = 0; i < count; i++) if (lives[i] >= 0) alive = true;
    mesh.visible = level > 0.01 || alive;
    mesh.instanceMatrix.needsUpdate = true;
    attr.needsUpdate = true;
    mat.uniforms.uTime.value = t * 0.2;
  }
  return {
    object: mesh,
    update,
    setPlaying(on) {
      playing = !!on;
    },
  };
}

// ─── motes ───────────────────────────────────────────────────────────────────
const MOTES_VERT = /* glsl */ `
  attribute vec3 aBase; // centre of this mote's little column (world)
  attribute vec4 aSeed; // x: seed, y: height of its column, z: size, w: rise speed (cycles/s)
  uniform float uTime;
  varying float vA;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    float s = aSeed.x;
    float ph = fract(uTime * aSeed.w + s * 7.13);
    vec3 p = aBase;
    p.y += (ph - 0.5) * aSeed.y;
    p.x += sin(uTime * 0.31 + s * 23.0) * 0.12 + sin(uTime * 0.77 + s * 5.0) * 0.04;
    p.z += cos(uTime * 0.27 + s * 31.0) * 0.12;
    // fade in & out over the cycle (the wrap is invisible) and twinkle
    vA = sin(3.14159 * ph) * (0.55 + 0.45 * sin(uTime * 2.3 + s * 40.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    mv.xy += position.xy * aSeed.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const MOTES_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uDay;
  uniform float uNight;
  varying float vA;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    a *= a;
    float k = max(vA, 0.0) * mix(uDay, 1.6, uNight);
    gl_FragColor = vec4(uColor * a * k, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Golden dust motes drifting in warm light (sawdust in a doorway, around a
 * lamp): GPU-animated billboards, one draw call, faint by day, glowing at
 * night. volumes: [{ center: Vector3 (world), size: [sx, sy, sz], count }].
 */
export function makeMotes(ctx, volumes, { color = '#ffcf7e', day = 0.35 } = {}) {
  const density = ctx.quality?.density ?? 1;
  const items = [];
  let rnd = 4242;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  for (const v of volumes) {
    const n = Math.max(3, Math.round(v.count * density));
    for (let i = 0; i < n; i++) {
      items.push([
        v.center.x + (rand() - 0.5) * v.size[0],
        v.center.y + (rand() - 0.5) * v.size[1] * 0.3,
        v.center.z + (rand() - 0.5) * v.size[2],
        rand(), v.size[1], 0.03 + rand() * 0.025, 0.025 + rand() * 0.035,
      ]);
    }
  }
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  const base = new Float32Array(items.length * 3);
  const seed = new Float32Array(items.length * 4);
  items.forEach((it, i) => {
    base.set(it.slice(0, 3), i * 3);
    seed.set(it.slice(3), i * 4);
  });
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.instanceCount = items.length;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uDay: { value: day }, uNight: sharedUniforms.uNight },
    vertexShader: MOTES_VERT,
    fragmentShader: MOTES_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    name: 'schreinerei-motes',
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.name = 'motes';
  mesh.raycast = () => {};
  mesh.castShadow = mesh.receiveShadow = false;
  const slow = ctx.engine?.reducedMotion ? 0.3 : 1;
  return {
    object: mesh,
    update(dt, t) {
      mat.uniforms.uTime.value = t * slow;
    },
  };
}
