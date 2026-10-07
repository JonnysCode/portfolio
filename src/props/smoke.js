// ─────────────────────────────────────────────────────────────────────────────
// Soft chimney smoke — ONE shared look for every chimney, stovepipe and forge
// in the glen.
//
// Each plume is a stream of camera-facing quads with a soft radial falloff
// (a few gaussian lobes, no hard rim, no star points). A puff is born small
// and fairly dense just above the chimney, grows ~3× while its opacity falls
// from 0.35 to 0, leans away with the breeze and curls slowly around the
// rising column. Neighbouring puffs always overlap (spacing < radius at every
// age), so the plume reads as one wisp — never a string of beads. The
// animation runs entirely in the vertex shader from the shared time uniform
// (no CPU work); many chimneys share ONE mesh / draw call. Puffs take the
// glen's aerial-perspective fog and the current key light (warm sunlit grey by
// day, cool moonlit blue at night) and stay well below the bloom threshold.
// The puff count follows the quality tier; reduced motion freezes the plume.
//
//   // many chimneys, one mesh (local coordinates of the parent):
//   const smoke = makeSoftSmoke([{ x, y, z, scale, rise, wind: [x, z] }], { quality, reducedMotion });
//   parent.add(smoke);
//
//   // drop-in for an { object, update } style effect (world position):
//   const smoke = makeChimneySmoke(ctx, { position, rise, scale, wind });
//   scene.add(smoke.object);  // smoke.update(dt, t) is a no-op (GPU-animated)
//
// Leaf module: imports only three, core/ and world/env/ — scene modules (and
// the cottage kit) may import it directly ('…/props/smoke.js') without an
// import cycle.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { sharedUniforms } from '../core/materials.js';
import { fogUniforms } from '../world/env/fog.js';
import { envUniforms } from '../world/env/celestial.js';

const VERT = /* glsl */ `
  attribute vec2 aCorner;
  attribute vec4 aPuff;  // x: phase 0..1, y: seed 0..1, z: scale, w: rise height
  attribute vec4 aFlow;  // xy: wind drift (x, z) at the top, z: cycles per second, w: puff size factor
  uniform float uTime;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vLife;
  varying float vSeed;
  #include <fog_pars_vertex>
  void main() {
    float s = aPuff.z;
    float life = fract(uTime * aFlow.z + aPuff.x);
    float seed = aPuff.y;
    vec3 p = position;
    // rise (slowing a little as the puff cools), lean away with the breeze
    float h = aPuff.w * life * (1.15 - 0.15 * life);
    p.y += h;
    p.xz += aFlow.xy * life * life;
    // a slow curl around the rising column, widening with age
    float ang = seed * 6.2831 + life * 4.2 + uTime * 0.23;
    float curl = (0.07 + 0.32 * life) * s;
    p.x += cos(ang) * curl;
    p.z += sin(ang) * curl;
    // grows ~3x over its life
    float r = aFlow.w * s * (0.36 + 0.7 * pow(life, 0.8));
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float rot = seed * 6.2831 + life * (seed > 0.5 ? 1.1 : -1.1);
    float cr = cos(rot), sr = sin(rot);
    mvPosition.xy += vec2(cr * aCorner.x - sr * aCorner.y, sr * aCorner.x + cr * aCorner.y) * r;
    gl_Position = projectionMatrix * mvPosition;
    vUv = aCorner;
    vLife = life;
    vSeed = seed;
    // opacity: a quick fade-in, then 0.35 → 0 as it spreads
    vAlpha = smoothstep(0.0, 0.06, life) * pow(1.0 - life, 0.85);
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  uniform float uNight;
  uniform float uOpacity;
  uniform vec3 uKeyColor;
  uniform vec3 uDayLit;
  uniform vec3 uDayShade;
  uniform vec3 uNightLit;
  uniform vec3 uNightShade;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vLife;
  varying float vSeed;
  #include <fog_pars_fragment>
  float lobe(vec2 p, vec2 c, float r) {
    vec2 d = (p - c) / r;
    return exp(-dot(d, d) * 2.4);
  }
  void main() {
    vec2 p = vUv;
    float k = vSeed * 37.0;
    // a soft radial puff with a few lobes drifting apart as it ages (wispy, never round beads)
    float spread = 0.22 + 0.16 * vLife;
    float a = lobe(p, vec2(0.0), 0.62) * 0.85;
    a += lobe(p, spread * vec2(cos(k), sin(k)), 0.46) * 0.4;
    a += lobe(p, spread * vec2(cos(k + 2.3), sin(k + 2.3)), 0.4) * 0.35;
    a += lobe(p, spread * vec2(cos(k + 4.4), sin(k + 4.4)), 0.42) * 0.3;
    a = min(a, 1.0);
    // radial falloff to exactly zero before the quad's edge
    a *= 1.0 - smoothstep(0.45, 1.0, dot(p, p));
    float alpha = a * vAlpha * uOpacity;
    if (alpha < 0.004) discard;
    // lit from above (the sun / moon), soft shade underneath; fresh smoke a touch darker
    float lit = smoothstep(-0.9, 0.9, p.y * 0.85 - p.x * 0.3);
    vec3 day = mix(uDayShade, uDayLit, lit) * mix(vec3(1.0), uKeyColor, 0.18);
    vec3 night = mix(uNightShade, uNightLit, lit);
    vec3 col = mix(day, night, uNight) * mix(0.9, 1.0, smoothstep(0.0, 0.3, vLife));
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const mats = new Map();
function smokeMaterial(reduced, opacity) {
  const key = `${reduced}|${opacity}`;
  let m = mats.get(key);
  if (m) return m;
  m = new THREE.ShaderMaterial({
    name: 'props-soft-smoke',
    uniforms: {
      ...fogUniforms(),
      uTime: reduced ? { value: 4.2 } : sharedUniforms.uTime,
      uNight: sharedUniforms.uNight,
      uKeyColor: envUniforms.uKeyColor,
      uOpacity: { value: opacity },
      // painterly greys: warm sunlit top, cooler shade (kept well under the bloom threshold)
      uDayLit: { value: new THREE.Color('#ece6db') },
      uDayShade: { value: new THREE.Color('#a9a49c') },
      uNightLit: { value: new THREE.Color('#47506a') },
      uNightShade: { value: new THREE.Color('#1c2130') },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  mats.set(key, m);
  return m;
}

/** Puffs per plume for the current quality tier. */
function puffCount(quality, base) {
  const tier = quality?.tier ?? 'high';
  const k = tier === 'low' ? 0.6 : tier === 'medium' ? 0.8 : 1;
  return Math.max(5, Math.round(base * k));
}

/**
 * Soft smoke for many chimneys in ONE mesh (one draw call).
 * sources: [{ x, y, z, scale = 1, rise = 2.6, puffs = 12, wind = [0.55, 0.2], rate }]
 *   in the parent's local coordinates; `scale` sizes the puffs (and slows them),
 *   `rise` is how high a puff climbs before it has faded, `wind` the drift (x, z)
 *   at the top, `rate` life cycles per second (default 0.075 / scale).
 * opts: { quality (ctx.quality — fewer, bigger puffs on low tiers), reducedMotion
 *   (a still plume), opacity = 0.35 (peak puff opacity), name }
 */
export function makeSoftSmoke(sources, opts = {}) {
  const quality = opts.quality ?? (typeof window !== 'undefined' ? window.__woodland?.ctx?.quality : null) ?? null;
  const quads = [];
  sources.forEach((src, si) => {
    const n = puffCount(quality, src.puffs ?? 12);
    // fewer puffs → each a little bigger so the plume never breaks into beads
    const sizeK = Math.sqrt(12 / Math.max(n, 5)) * 0.85 + 0.15;
    const s = src.scale ?? 1;
    const wind = src.wind ?? [0.55, 0.2];
    const rate = src.rate ?? 0.075 / Math.max(0.5, s);
    for (let i = 0; i < n; i++) {
      const seed = (i * 0.618034 + si * 0.377) % 1;
      quads.push({ x: src.x, y: src.y, z: src.z, phase: (i / n + si * 0.31 + seed * 0.04) % 1, seed, s, rise: src.rise ?? 2.6, wind, rate, sizeK });
    }
  });
  const n = quads.length;
  const pos = new Float32Array(n * 12);
  const corner = new Float32Array(n * 8);
  const puff = new Float32Array(n * 16);
  const flow = new Float32Array(n * 16);
  const idx = new Uint16Array(n * 6);
  const C = [-1, -1, 1, -1, 1, 1, -1, 1];
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  quads.forEach((q, i) => {
    for (let k = 0; k < 4; k++) {
      pos.set([q.x, q.y, q.z], i * 12 + k * 3);
      corner.set([C[k * 2], C[k * 2 + 1]], i * 8 + k * 2);
      puff.set([q.phase, q.seed, q.s, q.rise], i * 16 + k * 4);
      flow.set([q.wind[0], q.wind[1], q.rate, q.sizeK], i * 16 + k * 4);
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    box.expandByPoint(v.set(q.x, q.y, q.z));
    box.expandByPoint(v.set(q.x + q.wind[0], q.y + q.rise, q.z + q.wind[1]));
  });
  const maxS = quads.reduce((m, q) => Math.max(m, q.s * q.sizeK), 1);
  box.expandByScalar(maxS * 1.4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aPuff', new THREE.BufferAttribute(puff, 4));
  g.setAttribute('aFlow', new THREE.BufferAttribute(flow, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingBox = box;
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  const mesh = new THREE.Mesh(g, smokeMaterial(!!opts.reducedMotion, opts.opacity ?? 0.35));
  mesh.name = opts.name ?? 'soft-smoke';
  mesh.renderOrder = 4;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return mesh;
}

/**
 * Drop-in chimney smoke with the { object, update } shape of the scene
 * modules' own effects. opts: { position (world Vector3), scale = 1, rise = 3,
 * wind = [0.6, -0.2], puffs = 12, rate, opacity }. update() does nothing (GPU).
 */
export function makeChimneySmoke(ctx, opts = {}) {
  const p = opts.position ?? new THREE.Vector3();
  const object = makeSoftSmoke(
    [{ x: p.x, y: p.y, z: p.z, scale: opts.scale ?? 1, rise: opts.rise ?? 3, wind: opts.wind ?? [0.6, -0.2], puffs: opts.puffs ?? 12, rate: opts.rate }],
    { quality: ctx?.quality, reducedMotion: !!(ctx?.engine?.reducedMotion ?? opts.reducedMotion), opacity: opts.opacity, name: opts.name ?? 'chimney-smoke' }
  );
  return { object, update() {} };
}
