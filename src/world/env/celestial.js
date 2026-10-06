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

/** Golden-hour sun used for lighting & shadows (south-west, long-ish shadows). */
export const SUN_LIGHT_DIR = dirFromAngles(38, 228);
/** Where the sun disc is drawn — lower than the light so it can sit near the mountains. */
export const SUN_SKY_DIR = dirFromAngles(9, 236);
/** Moonlight (south-east, higher, so the night stays readable). */
export const MOON_LIGHT_DIR = dirFromAngles(50, 140);
/** Where the moon disc is drawn. */
export const MOON_SKY_DIR = dirFromAngles(24, 148);

/** Day / night colour sets (sRGB hex — converted to linear by THREE.Color). */
export const SKY_COLORS = {
  day: {
    zenith: '#5d9de0',
    mid: '#9fcaee',
    horizon: '#ffe0b4',
    fog: '#f0d9b5',
    sunGlow: '#ffb867',
    cloudLit: '#fffaf2',
    cloudShade: '#d6cde6',
    mountainFar: '#a9b9d6',
    mountainNear: '#7f98b8',
    snowLit: '#ffe9dc',
    snowShade: '#b9c3e6',
  },
  night: {
    zenith: '#0d1233',
    mid: '#1b2352',
    horizon: '#3a3c74',
    fog: '#2a2f5c',
    sunGlow: '#5a5aa0',
    cloudLit: '#5c64a0',
    cloudShade: '#2e3466',
    mountainFar: '#2c3466',
    mountainNear: '#212852',
    snowLit: '#aab6e8',
    snowShade: '#5d68a6',
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
