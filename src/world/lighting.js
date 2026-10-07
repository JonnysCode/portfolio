// ─────────────────────────────────────────────────────────────────────────────
// Lighting — late golden afternoon in a forest glen. The ONLY module that
// creates lights.
//
//   sun  DirectionalLight  warm, low from the back-left (WNW) so it rakes
//                          through the canopy, rims every silhouette and casts
//                          long dappled shadows. Soft PCF shadows with a FIXED
//                          frustum tightly covering the glen (±35 units) at the
//                          largest map the tier allows — no swimming, no
//                          re-fitting while the camera glides. By night it
//                          becomes the moonlight (blue-lavender, back-right).
//   hemi HemisphereLight   cool blue-green sky fill / warm mossy ground bounce.
//   rim  DirectionalLight  faint cool light from the back-right that separates
//                          the shaded sides from the misty background; by
//                          night a stronger cool moon-rim from the west
//                          (side-on to the spot cameras, opposite the moon)
//                          so the giant trunks, caps and the oak keep a
//                          silvered edge against the night mist. Not from
//                          straight behind: back light makes leaf cards glow
//                          (translucency) and the canopy would read as day.
//   scene.environment      a painted "under the canopy" PMREM (env/envmap.js) so
//                          PBR surfaces get soft teal-green ambient and gentle
//                          reflections; swapped for a night version at dusk.
//
// Warm point lights (lanterns, windows, forge …) only through
//   ctx.lights.addPoint(position, { color, day, night, distance, decay })
// which is budgeted per tier and may return null (use glow materials then).
//
// ctx.lights = { sun, hemi, rim, keyDir, shadowExtent, shadowCenter, addPoint(position, opts), points }
//   keyDir is live (world space, towards the current key light).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { smoothstep } from '../core/rng.js';
import { SUN_LIGHT_DIR, MOON_LIGHT_DIR, dirFromAngles, envUniforms } from './env/celestial.js';
import { installFog } from './env/fog.js';
import { buildEnvMaps } from './env/envmap.js';

// Patch the fog chunks before any material compiles (idempotent).
installFog();

const DAY = {
  key: new THREE.Color('#ffd7a0'),
  keyI: 3.9,
  hemiSky: new THREE.Color('#94c0c4'),
  hemiGround: new THREE.Color('#5f5536'),
  hemiI: 0.72,
  rim: new THREE.Color('#a9d2e6'),
  rimI: 0.45,
  envI: 0.46,
};
const NIGHT = {
  key: new THREE.Color('#a9b6ff'),
  keyI: 2.05,
  hemiSky: new THREE.Color('#4170a2'),
  hemiGround: new THREE.Color('#1a2a32'),
  hemiI: 1.12,
  rim: new THREE.Color('#8fb4ec'),
  rimI: 1.1,
  envI: 0.56,
};

/** The moonlit glen is exposed a touch brighter (all tiers; lights are tamed by post's night bloom). */
const NIGHT_EXPOSURE_BOOST = 0.07;

const RIM_DAY_DIR = dirFromAngles(24, 70);
/** Night rim: from the west, side-on to the cameras, opposite the moon (back-right). */
const RIM_NIGHT_DIR = dirFromAngles(28, 282);
/** Centre of the fixed shadow frustum (the middle of the glen). */
const SHADOW_CENTER = new THREE.Vector3(0, 3, -1);
/** Half size of the fixed shadow frustum (light-space units). */
const SHADOW_EXTENT = 35;
/** How far the shadow camera sits from the centre along the light direction. */
const LIGHT_DISTANCE = 95;

export default async function build(ctx) {
  const { scene, engine, env } = ctx;
  const q = ctx.quality ?? engine.quality;
  const renderer = engine.renderer;

  const hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemiI);
  hemi.name = 'hemi';
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(DAY.key, DAY.keyI);
  sun.name = 'sun';
  sun.castShadow = !!q.shadows;
  // The largest map the tier (and GPU) allows: the frustum is fixed, so every
  // texel goes into crisp dappled canopy shadows.
  const maxTex = renderer.capabilities.maxTextureSize || 4096;
  const wanted = q.tier === 'high' ? 4096 : q.tier === 'medium' ? 2048 : q.shadowMapSize || 1024;
  const mapSize = Math.min(wanted, maxTex);
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.radius = q.tier === 'high' ? 3.2 : 2.0;
  sun.shadow.bias = -0.00025;
  const texel = (2 * SHADOW_EXTENT) / mapSize;
  sun.shadow.normalBias = Math.max(0.02, texel * 1.4);
  const scam = sun.shadow.camera;
  scam.left = -SHADOW_EXTENT;
  scam.right = SHADOW_EXTENT;
  scam.top = SHADOW_EXTENT;
  scam.bottom = -SHADOW_EXTENT;
  scam.near = 1;
  scam.far = LIGHT_DISTANCE + 110;
  scam.updateProjectionMatrix();
  sun.target.position.copy(SHADOW_CENTER);
  scene.add(sun, sun.target);

  const rim = new THREE.DirectionalLight(DAY.rim, DAY.rimI);
  rim.name = 'rim';
  rim.castShadow = false;
  rim.target.position.copy(SHADOW_CENTER);
  scene.add(rim, rim.target);

  // Painted IBL (day & night share size → swapping never recompiles).
  let envMaps = null;
  try {
    envMaps = buildEnvMaps(renderer, { sunDir: SUN_LIGHT_DIR, moonDir: MOON_LIGHT_DIR });
    scene.environment = envMaps.day;
    scene.environmentIntensity = DAY.envI;
  } catch (err) {
    console.warn('[lighting] environment map failed, using lights only', err);
  }

  const baseExposure = renderer.toneMappingExposure;
  // Without shadow maps (low tier) the canopy no longer occludes the moon and
  // there is no post grade to cool & vignette the night: tone the moonlight
  // down so the glen still reads as night, not as an overcast day.
  const lit = q.shadows ? { key: 1, rim: 1, hemi: 1, boost: 1 } : { key: 0.45, rim: 0.55, hemi: 0.8, boost: 0 };
  const nightKeyI = NIGHT.keyI * lit.key;
  const nightRimI = NIGHT.rimI * lit.rim;
  const nightHemiI = NIGHT.hemiI * lit.hemi;
  const keyDir = new THREE.Vector3().copy(SUN_LIGHT_DIR);
  const rimDir = new THREE.Vector3().copy(RIM_DAY_DIR);
  let lastNight = -1;

  // Budget-managed warm point lights (lanterns, windows, the forge …).
  const POINT_BUDGET = { high: 12, medium: 6, low: 0 }[q.tier] ?? 4;
  const points = [];
  /**
   * Add a point light if the budget allows. opts: { color, day, night (intensities),
   * distance, decay }. Returns the light or null (always handle null — use glow then).
   */
  function addPoint(position, opts = {}) {
    if (points.length >= POINT_BUDGET) return null;
    const l = new THREE.PointLight(opts.color ?? '#ffb866', 0, opts.distance ?? 7, opts.decay ?? 2);
    l.position.copy(position);
    l.castShadow = false;
    l.userData.intensity = { day: opts.day ?? 0.4, night: opts.night ?? 6 };
    scene.add(l);
    points.push(l);
    applyPoint(l, env?.night ?? 0);
    return l;
  }
  function applyPoint(l, n) {
    // Lanterns swell a little beyond linear as dusk falls (they "come on").
    const k = smoothstep(0.15, 0.9, n);
    l.intensity = l.userData.intensity.day + (l.userData.intensity.night - l.userData.intensity.day) * k;
  }

  ctx.lights = {
    sun,
    hemi,
    rim,
    addPoint,
    points,
    /** Live direction towards the current key light (sun by day, moon by night). */
    keyDir,
    /** Half size of the fixed shadow frustum (world units). */
    shadowExtent: SHADOW_EXTENT,
    shadowCenter: SHADOW_CENTER,
    envMaps,
  };

  function place() {
    sun.position.copy(SHADOW_CENTER).addScaledVector(keyDir, LIGHT_DISTANCE);
    sun.target.updateMatrixWorld();
    rim.position.copy(SHADOW_CENTER).addScaledVector(rimDir, 60);
    rim.target.updateMatrixWorld();
  }

  function update(n) {
    // n is already eased by env; dip the key light around dusk so the swing of
    // the shadow direction between sun and moon is not noticeable.
    const dusk = Math.sin(Math.PI * n);
    keyDir.copy(SUN_LIGHT_DIR).lerp(MOON_LIGHT_DIR, smoothstep(0.3, 0.7, n)).normalize();
    rimDir.copy(RIM_DAY_DIR).lerp(RIM_NIGHT_DIR, n).normalize();
    sun.color.copy(DAY.key).lerp(NIGHT.key, n);
    sun.intensity = (DAY.keyI + (nightKeyI - DAY.keyI) * n) * (1 - 0.75 * dusk);
    hemi.color.copy(DAY.hemiSky).lerp(NIGHT.hemiSky, n);
    hemi.groundColor.copy(DAY.hemiGround).lerp(NIGHT.hemiGround, n);
    hemi.intensity = DAY.hemiI + (nightHemiI - DAY.hemiI) * n;
    rim.color.copy(DAY.rim).lerp(NIGHT.rim, n);
    rim.intensity = DAY.rimI + (nightRimI - DAY.rimI) * n;
    if (envMaps) {
      // swap the painted environment at the darkest moment of dusk
      scene.environment = n < 0.5 ? envMaps.day : envMaps.night;
      scene.environmentIntensity = (DAY.envI + (NIGHT.envI - DAY.envI) * n) * (1 - 0.6 * dusk);
    }
    for (const l of points) applyPoint(l, n);
    renderer.toneMappingExposure = baseExposure * (1 + NIGHT_EXPOSURE_BOOST * lit.boost * n);
    envUniforms.uKeyDir.value.copy(keyDir);
    envUniforms.uKeyColor.value.copy(sun.color).multiplyScalar(sun.intensity / DAY.keyI);
    place();
  }

  engine.addUpdate(() => {
    const n = env?.night ?? 0;
    if (n !== lastNight) {
      lastNight = n;
      update(n);
    }
  }, 21);

  update(env?.night ?? 0);
  lastNight = env?.night ?? 0;
  return {};
}
