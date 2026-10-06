// ─────────────────────────────────────────────────────────────────────────────
// Little living effects of the Schreinerei:
//   makeSmoke(ctx, opts)      soft painterly smoke puffs curling from a chimney
//   makeShavings(ctx, opts)   curly wood shavings springing off the hand plane
//   makeNotes(ctx, opts)      ♪ ♫ notes floating up from the record player
// Smoke & notes are camera-facing quads billboarded in the vertex shader (one
// draw call each, fogged like the rest of the scene). No per-frame allocations.
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

// ─── smoke ───────────────────────────────────────────────────────────────────
const SMOKE_FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 uDay;
  uniform vec3 uNightC;
  uniform float uNight;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec4 vData;
  void main() {
    vec2 d = vUv - 0.5;
    float ang = atan(d.y, d.x);
    float r = length(d) * 2.0;
    r *= 1.0 + 0.1 * sin(ang * 5.0 + vData.x * 40.0) + 0.06 * sin(ang * 9.0 - vData.x * 13.0);
    float life = vData.y;
    if (life < 0.0) discard;
    float fade = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.45, 1.0, life));
    float a = smoothstep(1.0, 0.25, r) * fade * uOpacity;
    // soft inner shading: lighter towards the top-left (the sun)
    float lit = 0.82 + 0.25 * dot(normalize(d + 1e-4), normalize(vec2(-0.6, 0.8))) * smoothstep(0.0, 1.0, r);
    vec3 col = mix(uDay, uNightC, uNight) * lit;
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * Chimney smoke. opts: { position (Vector3, world), count = 14, rise = 3.2, size = [0.25, 1.1],
 *   wind = [0.6, -0.2] (drift x/z at the top), rate = 0.09 (cycles per second) }
 */
export function makeSmoke(ctx, opts = {}) {
  const count = Math.max(4, Math.round((opts.count ?? 14) * (ctx.quality?.density ?? 1)));
  const rise = opts.rise ?? 3.2;
  const [s0, s1] = opts.size ?? [0.25, 1.1];
  const wind = opts.wind ?? [0.6, -0.2];
  const rate = opts.rate ?? 0.09;
  const geo = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geo, makeSmokeMaterial(), count);
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) data[i * 4] = i / count + Math.random() * 0.01;
  const attr = new THREE.InstancedBufferAttribute(data, 4);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aData', attr);
  mesh.position.copy(opts.position ?? new THREE.Vector3());
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.renderOrder = 4;
  mesh.name = 'smoke';
  mesh.raycast = () => {};
  const m = new THREE.Matrix4();
  const reduced = ctx.engine?.reducedMotion;
  function update(dt, t) {
    const tt = reduced ? t * 0.35 : t;
    for (let i = 0; i < count; i++) {
      const seed = data[i * 4];
      const life = (tt * rate + seed) % 1;
      const ph = seed * 31.7;
      const x = Math.sin(ph + tt * 0.8) * 0.12 * life + wind[0] * life * life;
      const z = Math.cos(ph * 1.3 + tt * 0.7) * 0.12 * life + wind[1] * life * life;
      const y = Math.pow(life, 0.8) * rise;
      m.makeTranslation(x, y, z);
      mesh.setMatrixAt(i, m);
      data[i * 4 + 1] = life;
      data[i * 4 + 2] = s0 + (s1 - s0) * Math.pow(life, 0.7);
    }
    mesh.instanceMatrix.needsUpdate = true;
    attr.needsUpdate = true;
    mesh.material.uniforms.uTime.value = t;
  }
  update(0, 0);
  return { object: mesh, update };
}

function makeSmokeMaterial() {
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDay: { value: new THREE.Color('#e9e2d6') },
        uNightC: { value: new THREE.Color('#5d6178') },
        uOpacity: { value: 0.55 },
      },
    ]),
    vertexShader: BILLBOARD_VERT,
    fragmentShader: SMOKE_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
    name: 'schreinerei-smoke',
  });
  return withNight(mat);
}

/** Share the global night uniform (UniformsUtils.merge clones values, so re-link it). */
function withNight(mat) {
  mat.uniforms.uNight = sharedUniforms.uNight;
  return mat;
}

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
 * fly up/back, tumble and drop onto the bench (floorY), then fade.
 * opts: { count = 14, source: () => Vector3, dir: Vector3 (backwards, away from the stroke), floorY }
 */
export function makeShavings(ctx, opts = {}) {
  const count = Math.max(4, Math.round((opts.count ?? 14) * (ctx.quality?.density ?? 1)));
  const mat = ctx.materials.surface('wood', { species: 'maple', side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(shavingGeo(), mat, count);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'shavings';
  mesh.raycast = () => {};
  const P = [];
  for (let i = 0; i < count; i++) P.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: -1 - i * 0.12, ttl: 1 });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const dir = opts.dir ?? new THREE.Vector3(0, 0, 1);
  const floorY = opts.floorY ?? 0;
  const reduced = ctx.engine?.reducedMotion;
  let acc = 0;
  let rnd = 12345;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  function update(dt) {
    dt = Math.min(dt, 0.1);
    acc += dt * (reduced ? 0.8 : 3.2);
    for (let i = 0; i < count; i++) {
      const a = P[i];
      if (a.life < 0) {
        a.life += dt;
        if (a.life >= 0 && acc >= 1) {
          acc -= 1;
          opts.source(tmp);
          a.p.copy(tmp);
          a.v.set(dir.x * 0.5 + (rand() - 0.5) * 0.4, 0.9 + rand() * 0.6, dir.z * 0.5 + (rand() - 0.5) * 0.4);
          a.w.set((rand() - 0.5) * 9, (rand() - 0.5) * 9, (rand() - 0.5) * 9);
          a.r.set(rand() * 6, rand() * 6, rand() * 6);
          a.ttl = 1.6 + rand() * 1.2;
          a.life = 0;
        } else if (a.life >= 0) a.life = -0.05;
      } else {
        a.life += dt;
        if (a.p.y > floorY) {
          a.v.y -= 3.2 * dt;
          a.v.multiplyScalar(1 - 1.6 * dt);
          a.p.addScaledVector(a.v, dt);
          a.r.x += a.w.x * dt;
          a.r.y += a.w.y * dt;
          a.r.z += a.w.z * dt;
          if (a.p.y < floorY) a.p.y = floorY;
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
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uMap: { value: null }, uColor: { value: new THREE.Color('#ffe2a0') } }]),
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
      data[i * 4 + 2] = 0.13 + 0.05 * Math.sin(seed * 30);
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
