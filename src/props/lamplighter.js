// ─────────────────────────────────────────────────────────────────────────────
// The lamplighter — when dusk falls the glen's lamps do not all switch on at
// once. They are lit one after another, starting at the Schreinerei door and
// spreading out through the glen over ~2.5 s (the porch and the deck first,
// then the loft and the bridge, the cottages and the Velowerkstatt, finally
// the lanterns high up in the giants). Each lamp catches with a short candle
// sputter and a soft flare; fairy-light strands light bulb by bulb. Every
// bulb burns a little brighter or dimmer than its neighbours, and one in ten
// flickers like a candle (lampSeed / lampJitter, shared by halos and bulbs).
//
// One clock drives it: lampUniforms.uLampClock = seconds since the lamplighter
// set out (0 by day, LAMP.max once every lamp is lit). The props ticker advances
// it from the shared night uniform (tickLamplighter): it runs once night has
// fallen to the blue hour (night ≥ 0.25),
// jumps straight to "all lit" when night is switched instantly (?night=1,
// debug.setNight) and runs back down quickly once day has returned. Without a
// running ticker (e.g. a module viewed alone) it rests at "all lit", so
// nothing ever stays dark.
//
// Use it from
//   • shaders      LAMP_GLSL (declares the uniforms + float lampOn(vec3 worldPos,
//                  float delaySeconds)) with lampUniforms merged into the material
//   • point lights lampOnAt(position, delay = 0) → 0 … ~1.3 (1 = fully lit), e.g.
//                  intensity = day + (night - day) * smoothstep(…) * lampOnAt(p)
//   • emissives    lampGlow(color, { day, night }) — materials.glow look-alike in
//                  which every fragment lights in the cascade (optional per-vertex
//                  'aLampDelay' attribute in seconds: strands light bulb by bulb)
// Glow halos (glow.js glowQuads / makeGlowSprite) of warm colours cascade on
// their own; cool glows (mushrooms, glow-worms, water) keep following the
// night uniform directly — they are alive, not lit.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { sharedUniforms } from '../core/materials.js';
import { OAK } from '../world/layout.js';

/** Cascade timing (seconds) and reach (world units from the Schreinerei door). */
export const LAMP = {
  /** the first lamp to be lit: just outside the round workshop door */
  origin: new THREE.Vector3(OAK.door.x, 1.0, OAK.door.z + 0.8),
  /** a lamp this far away (or further) is lit `spread` seconds after the first */
  reach: 24,
  spread: 2.5,
  /** how long a single lamp takes to catch */
  window: 0.5,
  /** clock value at which every lamp (incl. extra per-bulb delays) is lit */
  max: 5.5,
};

/** Shared uniforms (merge into a material: { ...lampUniforms, … }). */
export const lampUniforms = {
  uLampClock: { value: LAMP.max },
  uLampOrigin: { value: LAMP.origin },
  /** 1: candle sputter + flare while catching; 0 under reduced motion */
  uLampFx: { value: 1 },
  uLampTime: sharedUniforms.uTime,
};

const f = (x) => x.toFixed(4);
/** GLSL: lamp uniforms + float lampOn(vec3 worldPos, float delay). */
export const LAMP_GLSL = /* glsl */ `
  uniform float uLampClock;
  uniform vec3 uLampOrigin;
  uniform float uLampFx;
  uniform float uLampTime;
  // 0 (not lit yet) … 1 (lit), briefly ~1.3 in the flare right after catching
  float lampOn(vec3 wp, float delay) {
    vec3 d = wp - uLampOrigin;
    float dist = length(vec3(d.x, d.y * 0.7, d.z));
    float c = uLampClock - ${f(LAMP.spread)} * clamp(dist / ${f(LAMP.reach)}, 0.0, 1.0) - max(delay, 0.0);
    float on = smoothstep(0.0, ${f(LAMP.window)}, c);
    // a candle sputter while it catches …
    float seed = dist * 7.31 + delay * 13.7;
    float sputter = 0.5 + 0.5 * sin(uLampTime * 37.0 + seed) * sin(uLampTime * 21.0 + seed * 1.7);
    float catching = on * (1.0 - on) * 4.0;
    // … and a soft flare once it has
    float fl = (c - ${f(LAMP.window)} - 0.12) * 4.5;
    float flare = exp(-fl * fl);
    return on * (1.0 - 0.75 * catching * sputter * uLampFx) + 0.3 * flare * uLampFx * step(0.0, c);
  }
  // A stable per-lamp seed (0..1): strand bulbs carry their own delay (bulb by
  // bulb), so delay + the 4-unit world cell names a bulb; lamps without a delay
  // are named by their exact position (halo centres).
  float lampSeed(vec3 wp, float delay) {
    vec3 c = delay > 0.0 ? floor(wp * 0.25) + delay * 91.7 : wp * 7.31;
    return fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  }
  // Hand-strung, not machine-made: ±25 % brightness per lamp, and one lamp in
  // ten flickers slowly like a candle (fx = 0 under reduced motion: steady).
  float lampJitter(float h, float t, float fx) {
    float j = (h - 0.5) * 0.5;
    if (fract(h * 13.7) < 0.1) j -= fx * 0.32 * (0.5 + 0.5 * sin(t * (1.1 + h) + h * 40.0)) * (0.7 + 0.3 * sin(t * 4.3 + h * 17.0));
    return j;
  }
`;

/** JS twin of lampOn() for CPU-side lights. position: Vector3-like (world). */
export function lampOnAt(p, delay = 0) {
  const dx = p.x - LAMP.origin.x, dy = (p.y - LAMP.origin.y) * 0.7, dz = p.z - LAMP.origin.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const c = lampUniforms.uLampClock.value - LAMP.spread * Math.min(dist / LAMP.reach, 1) - Math.max(delay, 0);
  const x = Math.min(Math.max(c / LAMP.window, 0), 1);
  const on = x * x * (3 - 2 * x);
  const fx = lampUniforms.uLampFx.value;
  if (!fx) return on;
  const t = lampUniforms.uLampTime.value;
  const seed = dist * 7.31 + delay * 13.7;
  const sputter = 0.5 + 0.5 * Math.sin(t * 37 + seed) * Math.sin(t * 21 + seed * 1.7);
  const fl = (c - LAMP.window - 0.12) * 4.5;
  return on * (1 - 0.75 * on * (1 - on) * 4 * sputter) + (c >= 0 ? 0.3 * Math.exp(-fl * fl) : 0);
}

/** Night level at which the lamplighter sets out (the blue hour), and below which (day back) the lamps go out. */
const LAMP_START = 0.25;
const LAMP_OUT = 0.04;
let prevNight = null;
/**
 * Advance the cascade clock (called by tickProps every frame). Night falling →
 * once the blue hour has come (night ≥ 0.25) the clock runs in real time, so
 * the cascade plays while the glen is still blue-green and readable; an instant
 * switch (page load, ?night, debug.setNight) → everything lit at once; day back
 * (night ≤ 4 %) → the clock runs back down at 3× speed. In between it holds.
 */
export function tickLamplighter(dt, reducedMotion = false) {
  const n = sharedUniforms.uNight.value;
  const clock = lampUniforms.uLampClock;
  lampUniforms.uLampFx.value = reducedMotion ? 0 : 1;
  if (prevNight === null || Math.abs(n - prevNight) > 0.25) clock.value = n > LAMP_OUT ? LAMP.max : 0;
  else if (n >= LAMP_START) clock.value = Math.min(LAMP.max, clock.value + Math.min(dt, 0.1));
  else if (n <= LAMP_OUT) clock.value = Math.max(0, clock.value - Math.min(dt, 0.1) * 3);
  prevNight = n;
}

// ─── emissive lamp material ──────────────────────────────────────────────────
const _hsl = { h: 0, s: 0, l: 0 };
/**
 * Warm light colours (candle / bulb yellows, oranges, warm whites) — these are
 * lamps. Cool glows (cyan mushrooms, teal water) are not.
 */
export function isWarmLight(color) {
  new THREE.Color(color).getHSL(_hsl, THREE.SRGBColorSpace);
  return (_hsl.h < 0.17 || _hsl.h > 0.95) && _hsl.s > 0.25;
}

const lampMats = new Map();
function patchLamp(shader, own) {
  Object.assign(shader.uniforms, lampUniforms, own, { uNight: sharedUniforms.uNight });
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aLampDelay;\nvarying vec3 vLampWP;\nvarying float vLampDelay;')
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec4 lampWP = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        lampWP = instanceMatrix * lampWP;
      #endif
      vLampWP = (modelMatrix * lampWP).xyz;
      vLampDelay = aLampDelay;`
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${LAMP_GLSL}\nuniform float uNight;\nuniform float uGlowDay;\nuniform float uGlowNight;\nvarying vec3 vLampWP;\nvarying float vLampDelay;`)
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float lampJ = vLampDelay > 0.0 ? 1.0 + lampJitter(lampSeed(vLampWP, vLampDelay), uLampTime, uLampFx) : 1.0;
      totalEmissiveRadiance *= uGlowDay + (uGlowNight - uGlowDay) * uNight * lampOn(vLampWP, vLampDelay) * lampJ;`
    );
}

/**
 * Emissive lamp glass / bulbs: looks exactly like materials.glow(color, { day, night })
 * (MeshStandard, emissive = colour, roughness 0.9) but the night part of the
 * emission follows the lamplighter cascade at each fragment's world position.
 * Geometry should carry a float 'aLampDelay' attribute (seconds, 0 = none) —
 * withLampDelay() adds one. Cached per colour / intensities; never mutate.
 */
export function lampGlow(color, { day = 0.25, night = 1.6 } = {}) {
  const c = new THREE.Color(color);
  const key = `${c.getHexString()}|${day}|${night}`;
  let m = lampMats.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1, roughness: 0.9 });
  m.name = 'props-lamp-glow';
  const own = { uGlowDay: { value: day }, uGlowNight: { value: night } };
  m.onBeforeCompile = (shader) => patchLamp(shader, own);
  m.customProgramCacheKey = () => 'props-lamp-glow';
  m.userData.lamp = { day, night };
  lampMats.set(key, m);
  return m;
}

/** Give a geometry a constant 'aLampDelay' (seconds) unless it already has one. Returns geo. */
export function withLampDelay(geo, delay = 0, overwrite = false) {
  if (geo.attributes.aLampDelay && !overwrite) return geo;
  const n = geo.attributes.position.count;
  geo.setAttribute('aLampDelay', new THREE.BufferAttribute(new Float32Array(n).fill(delay), 1));
  return geo;
}
