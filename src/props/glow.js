// ─────────────────────────────────────────────────────────────────────────────
// Soft additive glow halos (lanterns, windows, string lights, glowing shrooms).
// Halos are deliberately small, soft and warm: a gaussian falloff without a
// hot core, warm colours pulled to amber, and a soft brightness cap that keeps
// a halo itself under the night bloom threshold (the bulb blooms, not the halo).
//
//   makeGlowSprite(color, size, opts)  → a single camera-facing halo (Mesh)
//   glowQuads([{ x, y, z, size }], color, opts) → MANY halos in ONE draw call
//   lightPools([{ x, y, z, size, … }], opts) → warm pools of light on the ground
//                (under lanterns, in front of lit doorways), ONE draw call
//   lightPool(position, opts)          → a single pool (same look)
//
// Billboarding happens in the vertex shader (every quad stores its centre), so
// many halos can be merged into one static geometry. The intensity follows
// the shared night uniform (materials.sharedUniforms.uNight): faint by day,
// bright at night. Halos of warm lights are LAMPS: at dusk they light one after
// another in the lamplighter cascade (lamplighter.js — outwards from the
// Schreinerei door, each with a little candle sputter; a point may add its own
// `delay` in seconds, e.g. bulb by bulb along a strand). Cool glows (mushrooms,
// glow-worms, water) follow the night directly. Depth-tested, never writes
// depth, never raycastable.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { sharedUniforms } from '../core/materials.js';
import { palette } from '../core/palette.js';
import { noRaycast } from './util.js';
import { LAMP_GLSL, lampUniforms, isWarmLight } from './lamplighter.js';

export { isWarmLight };

const VERT = /* glsl */ `
  attribute vec2 aCorner;
  attribute float aSize;
  attribute float aLamp; // extra lamplighter delay (s); < 0: not a lamp
  uniform float uLampK;  // 1: this material's halos are lamps
  varying float vLamp;
  ${LAMP_GLSL}
  #ifdef USE_TINT
    attribute vec3 aTint;
    varying vec3 vTint;
  #endif
  varying vec2 vUv;
  varying float vFade;
  uniform float uPull;
  uniform float uScale;
  void main() {
    vUv = aCorner;
    #ifdef USE_TINT
      vTint = aTint;
    #endif
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
    bool isLamp = uLampK > 0.5 && aLamp >= 0.0;
    vLamp = isLamp ? lampOn(wp, aLamp) : 1.0;
    float sc = length(modelMatrix[0].xyz);
    float s = aSize * sc * uScale;
    // fairy bulbs are hand-strung, not machine-made: every small lamp halo gets
    // its own brightness & size (±25 %), and one in ten flickers slowly like a
    // candle (off under reduced motion) — lampGlow() jitters the bulbs alike
    if (isLamp) {
      float small = 1.0 - smoothstep(0.22, 0.4, s);
      float h = lampSeed(wp, aLamp);
      vLamp *= 1.0 + small * lampJitter(h, uLampTime, uLampFx);
      s *= 1.0 + small * (fract(h * 7.13) - 0.5) * 0.5;
    }
    // pull the halo towards the camera so the lamp geometry never clips it
    mv.xyz += normalize(-mv.xyz) * s * uPull;
    mv.xy += aCorner * s;
    gl_Position = projectionMatrix * mv;
    float d = -mv.z;
    vFade = 1.0 - smoothstep(70.0, 140.0, d);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uNight;
  uniform float uDay;
  uniform float uNightI;
  uniform float uKnee;
  uniform float uCap;
  #ifdef USE_TINT
    varying vec3 vTint;
  #endif
  varying vec2 vUv;
  varying float vFade;
  varying float vLamp;
  void main() {
    float d2 = dot(vUv, vUv);
    if (d2 > 1.0) discard;
    // soft gaussian glow with a gentle core (no hot white disc), fading to
    // exactly zero well inside the quad
    float a = exp(-d2 * 7.0) * 0.6 + exp(-d2 * 30.0) * 0.25;
    a *= 1.0 - smoothstep(0.3, 1.0, d2);
    float k = mix(uDay, uNightI, uNight * vLamp) * vFade;
    vec3 col = uColor * (a * k);
    #ifdef USE_TINT
      col *= vTint;
    #endif
    // brightness cap with a soft knee: dim halos pass untouched, bright ones
    // saturate below the night bloom threshold, so bloom only picks up the
    // small bulb / glass itself instead of turning the whole halo into a blob
    float peak = max(max(col.r, col.g), col.b);
    if (peak > uKnee) {
      float r = uCap - uKnee;
      col *= (uKnee + r * (1.0 - exp(-(peak - uKnee) / r))) / peak;
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const _hsl = { h: 0, s: 0, l: 0 };
/** Cold blue-white light (LEDs, screens' lamps): hue ≈ 196–262°. Cyan & mint glows are not. */
function isColdLed(color) {
  new THREE.Color(color).getHSL(_hsl, THREE.SRGBColorSpace);
  return _hsl.h > 0.545 && _hsl.h < 0.73;
}
/**
 * Halo colour: warm lights (candle / bulb yellows, oranges, near-whites) are
 * pulled to a soft amber so halos read as warm light, never as white discs.
 * Cool glows (cyan mushrooms, teal water) keep their hue.
 */
export function haloColor(color) {
  const c = new THREE.Color(color);
  if (isWarmLight(color)) {
    c.getHSL(_hsl, THREE.SRGBColorSpace);
    const h = _hsl.h > 0.95 ? 0.08 : THREE.MathUtils.clamp(_hsl.h, 0.08, 0.11);
    c.setHSL(h, Math.max(_hsl.s, 0.92), Math.min(_hsl.l, 0.63), THREE.SRGBColorSpace);
  }
  return c;
}

const matCache = new Map();
/**
 * Shared additive halo material per colour / intensity pair.
 * opts: { day=0.18, night=1.1 } intensities, { pull } towards the camera (× size),
 * { tint } per-point colours (geometry attribute aTint, multiplied with `color`),
 * { warm = true } amber-ise warm colours (and draw their halos at `scale` = 0.72 of the
 * requested size: lamp & window halos were far too big), { cap = 0.55, knee = 0.3 } brightness cap,
 * { lamp } light in the lamplighter cascade (default: warm colours, and tinted sets —
 * where each point's own colour decides).
 */
export function glowMaterial(color = palette.windowGlow, { day = 0.18, night = 1.1, pull = 0.6, tint = false, warm = true, cap = 0.55, knee = 0.3, scale = null, lamp = null } = {}) {
  const warmC = isWarmLight(color);
  // Cool glows never outshine the warm lamps: cold blue-white LEDs (screens'
  // status lights, a desk lamp, the rack) are drawn at the warm halos' size and
  // under their cap; cyan & mint glows (mushrooms, glow-worms) a little smaller
  // and softer than before, so the amber lamps lead the night.
  const led = !tint && !warmC && isColdLed(color);
  const coolK = tint || warmC ? 1 : led ? 0.72 : 0.9;
  if (!tint && !warmC) cap = Math.min(cap, led ? 0.36 : 0.5);
  const sizeK = scale ?? (warm && !tint && warmC ? 0.72 : coolK);
  const isLamp = lamp ?? (tint || warmC);
  const key = `${new THREE.Color(color).getHexString()}|${day}|${night}|${pull}|${tint}|${warm}|${cap}|${knee}|${sizeK}|${isLamp}`;
  let m = matCache.get(key);
  if (m) return m;
  m = new THREE.ShaderMaterial({
    name: 'props-glow-halo',
    uniforms: {
      uColor: { value: warm ? haloColor(color) : new THREE.Color(color) },
      uNight: sharedUniforms.uNight,
      uDay: { value: day },
      uNightI: { value: night },
      uPull: { value: pull },
      uScale: { value: sizeK },
      uKnee: { value: Math.min(knee, cap * 0.9) },
      uCap: { value: cap },
      uLampK: { value: isLamp ? 1 : 0 },
      ...lampUniforms,
    },
    defines: tint ? { USE_TINT: '' } : {},
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    fog: false,
  });
  matCache.set(key, m);
  return m;
}

/**
 * Geometry with one billboard quad per point. points: [{ x, y, z, size, color?, delay?, lamp? }]
 * (size = halo radius in local units; delay = extra lamplighter delay in seconds;
 * lamp: false — or a cool `color` — keeps the point out of the cascade).
 */
export function glowGeometry(points, { tint = false } = {}) {
  const n = points.length;
  const pos = new Float32Array(n * 12);
  const corner = new Float32Array(n * 8);
  const size = new Float32Array(n * 4);
  const lamp = new Float32Array(n * 4);
  const tints = tint ? new Float32Array(n * 12) : null;
  const tc = new THREE.Color();
  const idx = new Uint16Array(n * 6);
  const C = [-1, -1, 1, -1, 1, 1, -1, 1];
  const box = new THREE.Box3();
  let maxS = 0;
  points.forEach((p, i) => {
    for (let k = 0; k < 4; k++) {
      pos.set([p.x, p.y, p.z], i * 12 + k * 3);
      corner[i * 8 + k * 2] = C[k * 2];
      corner[i * 8 + k * 2 + 1] = C[k * 2 + 1];
      size[i * 4 + k] = p.size;
    }
    lamp.fill(p.lamp === false || (p.color && !isWarmLight(p.color)) ? -1 : Math.max(0, p.delay ?? 0), i * 4, i * 4 + 4);
    if (tints) {
      if (p.color) tc.copy(haloColor(p.color));
      else tc.setRGB(1, 1, 1);
      for (let k = 0; k < 4; k++) tints.set([tc.r, tc.g, tc.b], i * 12 + k * 3);
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    box.expandByPoint(new THREE.Vector3(p.x, p.y, p.z));
    maxS = Math.max(maxS, p.size);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aLamp', new THREE.BufferAttribute(lamp, 1));
  if (tints) g.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  box.expandByScalar(maxS * 1.5);
  g.boundingBox = box;
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  return g;
}

const singleGeo = new Map();

/**
 * A soft additive halo that brightens at night.
 * @param {string} [color]  halo colour (palette.windowGlow by default)
 * @param {number} [size=1] halo radius
 * @param {object} [opts]   { day=0.18, night=1.1 } intensity by day / night, { pull } towards camera (× size)
 */
export function makeGlowSprite(color = palette.windowGlow, size = 1, opts = {}) {
  let g = singleGeo.get(size);
  if (!g) {
    g = glowGeometry([{ x: 0, y: 0, z: 0, size }]);
    singleGeo.set(size, g);
  }
  const m = new THREE.Mesh(g, glowMaterial(color, opts));
  m.name = 'glow';
  m.renderOrder = 3;
  m.castShadow = m.receiveShadow = false;
  return noRaycast(m);
}

/**
 * Many halos in one mesh: points [{ x, y, z, size, color? }] in local coords.
 * Points with their own `color` → one mesh with per-point tints (pass
 * '#ffffff' as `color` then; it multiplies every tint).
 */
export function glowQuads(points, color = palette.windowGlow, opts = {}) {
  const tint = points.some((p) => p.color);
  const m = new THREE.Mesh(glowGeometry(points, { tint }), glowMaterial(color, { ...opts, tint, warm: tint ? false : opts.warm }));
  m.name = 'glows';
  m.renderOrder = 3;
  return noRaycast(m);
}

/** Same, but from a pre-built (cached) geometry. */
export function glowMesh(geometry, color = palette.windowGlow, opts = {}) {
  const m = new THREE.Mesh(geometry, glowMaterial(color, opts));
  m.name = 'glows';
  m.renderOrder = 3;
  return noRaycast(m);
}

// ─── light pools ─────────────────────────────────────────────────────────────
// A warm pool of light on the ground under a lantern or in front of a lit
// doorway: an additive ground decal (an elongated radial gradient draped over
// the ground), depth-tested, never writing depth. The point-light budget
// cannot cover every lamp in the glen — the pools make each one a light
// SOURCE (the threshold stones in front of a bright door go warm) instead of
// a backlit picture. Warm pools follow the lamplighter cascade (each lights
// with its lamp); cool pools (glowing mushrooms) follow the night directly.
// Invisible by day.

const POOL_VERT = /* glsl */ `
  attribute vec2 aPool;    // normalised pool coordinates (|aPool| = 1 at the rim)
  attribute vec3 aCenter;  // the light source on the ground (lamplighter position)
  attribute vec3 aTint;    // colour × strength
  attribute float aLamp;   // extra lamplighter delay (s); < 0: not a lamp
  uniform float uNight;
  varying vec2 vPool;
  varying vec3 vTint;
  varying vec2 vWorld;
  ${LAMP_GLSL}
  void main() {
    vPool = aPool;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xz;
    float lamp = aLamp >= 0.0 ? lampOn((modelMatrix * vec4(aCenter, 1.0)).xyz, aLamp) : 1.0;
    vec4 mv = viewMatrix * wp;
    gl_Position = projectionMatrix * mv;
    // night only; far pools fade into the mist
    vTint = aTint * uNight * lamp * (1.0 - smoothstep(55.0, 110.0, -mv.z));
  }
`;
const POOL_FRAG = /* glsl */ `
  uniform float uStrength;
  varying vec2 vPool;
  varying vec3 vTint;
  varying vec2 vWorld;
  float poolHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float poolNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(poolHash(i), poolHash(i + vec2(1.0, 0.0)), u.x), mix(poolHash(i + vec2(0.0, 1.0)), poolHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    float d2 = dot(vPool, vPool);
    if (d2 >= 1.0) discard;
    // light falling off from the lamp (a bright core, a long soft tail, exactly 0
    // at the rim) — never an even disc …
    float a = (1.0 - d2) * (1.0 - d2);
    a *= 0.22 + 0.78 * exp(-d2 * 5.5);
    // … broken up a little, like light catching stones, moss and leaf litter
    a *= 0.72 + 0.56 * poolNoise(vWorld * 3.1);
    gl_FragColor = vec4(vTint * (a * uStrength), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Overall pool brightness (HDR, added to the lit ground): a strength-1 amber pool adds ≈ 0.65 (red) at its core. */
const POOL_STRENGTH = 0.65;
let poolMat = null;
/** The shared additive pool material (uniforms: uStrength — live-tunable). */
export function lightPoolMaterial() {
  if (poolMat) return poolMat;
  poolMat = new THREE.ShaderMaterial({
    name: 'props-light-pool',
    uniforms: { uNight: sharedUniforms.uNight, uStrength: { value: POOL_STRENGTH }, ...lampUniforms },
    vertexShader: POOL_VERT,
    fragmentShader: POOL_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    fog: false,
  });
  return poolMat;
}

const RINGS = 6;
const SEGS = 22;
/**
 * Geometry for many pools (one draw call). pools: [{
 *   x, y, z      the light source on the ground (where the pool is brightest)
 *   size = 1.6   radius (units) — the pool fades out completely there
 *   color = '#ffae5c', strength = 1
 *   dir          { x, z } the direction the light spills (a doorway's outward
 *                normal); with `stretch` the pool reaches size·stretch that way
 *                and only size·back behind the source
 *   stretch = 1, back = 1
 *   delay = 0    extra lamplighter delay (s); lamp: false → not in the cascade
 *   rings = 6, segs = 22   tessellation (small pools — fairy strands — need less)
 * }]. opts.height(x, z) drapes the pool over the ground (else flat at y).
 * opts.lift: height above the surface (default 0.04; ~0.1 clears flagstones & threshold stones).
 */
export function lightPoolGeometry(pools, { height = null, lift = 0.04 } = {}) {
  const lods = pools.map((p) => ({ rings: Math.max(2, p.rings ?? RINGS), segs: Math.max(6, p.segs ?? SEGS) }));
  const total = lods.reduce((n, l) => n + 1 + l.rings * l.segs, 0);
  const pos = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const cen = new Float32Array(total * 3);
  const tint = new Float32Array(total * 3);
  const lamp = new Float32Array(total);
  const idx = [];
  const c = new THREE.Color();
  let base = 0;
  pools.forEach((p, k) => {
    const { rings: R, segs: G } = lods[k];
    const size = p.size ?? 1.6;
    const stretch = p.stretch ?? 1, back = p.back ?? 1;
    let dx = p.dir?.x ?? 0, dz = p.dir?.z ?? 1;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    const isLamp = p.lamp !== false && isWarmLight(p.color ?? '#ffae5c');
    c.set(p.color ?? '#ffae5c').multiplyScalar(p.strength ?? 1);
    const put = (i, u, v, nu, nv) => {
      const x = p.x + dx * u + dz * v;
      const z = p.z + dz * u - dx * v;
      const y = (height ? height(x, z) : p.y) + lift;
      pos.set([x, y, z], (base + i) * 3);
      uv.set([nu, nv], (base + i) * 2);
      cen.set([p.x, p.y, p.z], (base + i) * 3);
      tint.set([c.r, c.g, c.b], (base + i) * 3);
      lamp[base + i] = isLamp ? Math.max(0, p.delay ?? 0) : -1;
    };
    put(0, 0, 0, 0, 0);
    for (let r = 1; r <= R; r++) {
      // rings packed towards the rim (the falloff is steepest there)
      const t = Math.pow(r / R, 0.8);
      for (let s = 0; s < G; s++) {
        const a = (s / G) * Math.PI * 2;
        const cu = Math.cos(a), sv = Math.sin(a);
        const reach = (cu > 0 ? stretch : back) * size;
        put(1 + (r - 1) * G + s, cu * t * reach, sv * t * size, cu * t, sv * t);
      }
    }
    // (counter-clockwise seen from above: the pool faces up)
    for (let s = 0; s < G; s++) idx.push(base, base + 1 + s, base + 1 + ((s + 1) % G));
    for (let r = 1; r < R; r++) {
      for (let s = 0; s < G; s++) {
        const a = base + 1 + (r - 1) * G + s, b = base + 1 + (r - 1) * G + ((s + 1) % G);
        const a2 = a + G, b2 = b + G;
        idx.push(a, b2, b, a, a2, b2);
      }
    }
    base += 1 + R * G;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPool', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aCenter', new THREE.BufferAttribute(cen, 3));
  g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
  g.setAttribute('aLamp', new THREE.BufferAttribute(lamp, 1));
  g.setIndex(total > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Many ground light pools in ONE mesh (see lightPoolGeometry). Not a shadow caster, not raycastable. */
export function lightPools(pools, opts = {}) {
  const m = new THREE.Mesh(lightPoolGeometry(pools, opts), lightPoolMaterial());
  m.name = 'light-pools';
  m.renderOrder = 2;
  m.castShadow = m.receiveShadow = false;
  m.frustumCulled = true;
  return noRaycast(m);
}

/** A single pool at `position` (opts as one entry of lightPools: size, color, strength, dir, stretch, back, delay, height). */
export function lightPool(position, opts = {}) {
  const { height, lift, ...p } = opts;
  return lightPools([{ x: position.x, y: position.y, z: position.z, ...p }], { height, lift });
}
