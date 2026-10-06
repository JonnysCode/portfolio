// ─────────────────────────────────────────────────────────────────────────────
// Celestial constants + shared environment uniforms.
//
// One place that knows where the sun and moon are and what colour the sky is,
// so lighting, sky, clouds, water and terrain always agree. sky.js writes the
// colour uniforms every frame; lighting.js writes uKeyDir. Any custom shader
// may reference these uniform objects directly (they are shared, never cloned):
//
//   import { envUniforms } from './env/celestial.js';
//   material.uniforms.uSkyHorizon = envUniforms.uSkyHorizon;
//
// Directions point FROM the world TOWARDS the light (normalised, world space).
// Azimuth convention: 0° = north (−Z), 90° = east (+X), 180° = south (+Z).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { palette } from '../../core/palette.js';
import { sharedUniforms } from '../../core/materials.js';

export function dirFromAngles(elevationDeg, azimuthDeg, target = new THREE.Vector3()) {
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  return target.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

/**
 * Late-afternoon sun for lighting & shadows: low from the back-left (west-north-west)
 * so it rakes through the canopy, rims silhouettes and sends its shafts slanting
 * towards the camera side (the camera looks north, from +Z).
 */
export const SUN_LIGHT_DIR = dirFromAngles(36, 290);
/** Where the sun's luminous haze sits in the sky — low, just above the far treetops. */
export const SUN_SKY_DIR = dirFromAngles(16, 292);
/** Moonlight: from the back-right, high enough to silver roofs & caps. */
export const MOON_LIGHT_DIR = dirFromAngles(50, 62);
/** Where the moon disc is drawn (peeks through a canopy gap at the back-right). */
export const MOON_SKY_DIR = dirFromAngles(30, 40);

/** Day / night colour sets (sRGB hex — converted to linear by THREE.Color). */
export const SKY_COLORS = {
  day: {
    zenith: '#7eaecb',
    mid: '#a6cdcf',
    horizon: '#cfe0d2',
    fog: '#84aba8', // cool blue-green mist
    sunGlow: '#ffd596', // warm luminous haze around the sun
    cloudLit: '#fff6e6',
    cloudShade: '#b7cbd0',
    mountainFar: '#5d7e7a', // far forest silhouettes (before mist)
    mountainNear: '#3e5b55',
    snowLit: '#ffe9c4', // backdrop rim light
    snowShade: '#9fbcb8',
  },
  night: {
    zenith: '#050a1e',
    mid: '#0b1734',
    horizon: '#16294a',
    fog: '#132a3c', // deep teal night mist
    sunGlow: '#6f86c8', // moon halo
    cloudLit: '#4a5c8c',
    cloudShade: '#1c2846',
    mountainFar: '#0f2030',
    mountainNear: '#0a1724',
    snowLit: '#8ea6d8',
    snowShade: '#2a3c5c',
  },
};

const col = (hex) => new THREE.Color(hex);

/**
 * Shared uniforms. Values are updated in place every frame by sky.js / lighting.js.
 * uTime and uNight are the global ones from materials.js.
 */
export const envUniforms = {
  uTime: sharedUniforms.uTime,
  uNight: sharedUniforms.uNight,
  /** Current key light direction (sun by day, moon by night). */
  uKeyDir: { value: SUN_LIGHT_DIR.clone() },
  /** Current key light colour (linear, includes intensity-ish brightness). */
  uKeyColor: { value: col(palette.sun) },
  uSunDir: { value: SUN_SKY_DIR.clone() },
  uMoonDir: { value: MOON_SKY_DIR.clone() },
  uSkyZenith: { value: col(SKY_COLORS.day.zenith) },
  uSkyMid: { value: col(SKY_COLORS.day.mid) },
  uSkyHorizon: { value: col(SKY_COLORS.day.horizon) },
  uFogColor: { value: col(SKY_COLORS.day.fog) },
  uSunGlow: { value: col(SKY_COLORS.day.sunGlow) },
  uCloudLit: { value: col(SKY_COLORS.day.cloudLit) },
  uCloudShade: { value: col(SKY_COLORS.day.cloudShade) },
  uMountainFar: { value: col(SKY_COLORS.day.mountainFar) },
  uMountainNear: { value: col(SKY_COLORS.day.mountainNear) },
  uSnowLit: { value: col(SKY_COLORS.day.snowLit) },
  uSnowShade: { value: col(SKY_COLORS.day.snowShade) },
};

/** Pre-parsed day/night colour pairs for lerping without allocations. */
export const SKY_COLOR_PAIRS = Object.fromEntries(
  Object.keys(SKY_COLORS.day).map((k) => [k, [col(SKY_COLORS.day[k]), col(SKY_COLORS.night[k])]])
);

/** Small GLSL helpers shared by env shaders (hash / value noise / fbm). */
export const GLSL_NOISE = /* glsl */ `
  float envHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float envNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = envHash(i), b = envHash(i + vec2(1.0, 0.0));
    float c = envHash(i + vec2(0.0, 1.0)), d = envHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float envFbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * envNoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }
`;
