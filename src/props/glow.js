// ─────────────────────────────────────────────────────────────────────────────
// Soft additive glow halos (lanterns, windows, string lights, glowing shrooms).
// Halos are deliberately small, soft and warm: a gaussian falloff without a
// hot core, warm colours pulled to amber, and a soft brightness cap that keeps
// a halo itself under the night bloom threshold (the bulb blooms, not the halo).
//
//   makeGlowSprite(color, size, opts)  → a single camera-facing halo (Mesh)
//   glowQuads([{ x, y, z, size }], color, opts) → MANY halos in ONE draw call
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
    vLamp = (uLampK > 0.5 && aLamp >= 0.0) ? lampOn((modelMatrix * vec4(position, 1.0)).xyz, aLamp) : 1.0;
    float sc = length(modelMatrix[0].xyz);
    float s = aSize * sc * uScale;
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
  const sizeK = scale ?? (warm && !tint && isWarmLight(color) ? 0.72 : 1);
  const isLamp = lamp ?? (tint || isWarmLight(color));
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
