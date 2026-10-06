// ─────────────────────────────────────────────────────────────────────────────
// Lighting — golden-hour storybook light. The ONLY module that creates lights.
//
//   sun  DirectionalLight  warm key light with crisp PCF shadows. By night it
//                          becomes the moonlight (blue-lavender, from the SE).
//   hemi HemisphereLight   sky/ground fill: cool lavender sky, warm green bounce.
//   rim  DirectionalLight  cool back light from opposite the key — lifts the
//                          shaded side of toon objects so shapes read in depth.
//
// The shadow frustum follows the camera rig's target (read lazily: the rig is
// created after the world), is pushed ahead along the view direction, sized for
// the camera distance and snapped to whole shadow-map texels so shadows never
// shimmer while walking.
//
// ctx.lights = { sun, hemi, rim, keyDir, shadowExtent, addPoint(position, opts), points }   (keyDir is live, world space)
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { clamp, smoothstep } from '../core/rng.js';
import { SUN_LIGHT_DIR, MOON_LIGHT_DIR, dirFromAngles, envUniforms } from './env/celestial.js';

const DAY = {
  key: new THREE.Color('#ffebd2'),
  keyI: 2.55,
  hemiSky: new THREE.Color('#b4c6ee'),
  hemiGround: new THREE.Color('#d2a36e'),
  hemiI: 1.45,
  rim: new THREE.Color('#c3b8f0'),
  rimI: 0.5,
};
const NIGHT = {
  key: new THREE.Color('#aab4ff'),
  keyI: 1.2,
  hemiSky: new THREE.Color('#6170bd'),
  hemiGround: new THREE.Color('#33365f'),
  hemiI: 1.35,
  rim: new THREE.Color('#7f8fe0'),
  rimI: 0.4,
};

const RIM_DAY_DIR = dirFromAngles(22, 228 - 180);
const RIM_NIGHT_DIR = dirFromAngles(28, 140 - 180);
/** How far the shadow camera sits from its focus along the light direction. */
const LIGHT_DISTANCE = 140;

export default async function build(ctx) {
  const { scene, engine, env, camera } = ctx;
  const q = ctx.quality ?? engine.quality;

  const hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemiI);
  hemi.name = 'hemi';
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(DAY.key, DAY.keyI);
  sun.name = 'sun';
  sun.castShadow = !!q.shadows;
  const mapSize = q.shadowMapSize || 1024;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.radius = q.tier === 'high' ? 1.6 : 1.2;
  sun.shadow.bias = -0.0004;
  const scam = sun.shadow.camera;
  scam.near = 1;
  scam.far = LIGHT_DISTANCE * 2.2;
  scene.add(sun, sun.target);

  const rim = new THREE.DirectionalLight(DAY.rim, DAY.rimI);
  rim.name = 'rim';
  rim.castShadow = false;
  scene.add(rim, rim.target);

  const keyDir = new THREE.Vector3().copy(SUN_LIGHT_DIR);
  const rimDir = new THREE.Vector3().copy(RIM_DAY_DIR);

  // ── shadow-follow scratch (no per-frame allocations) ──
  const focus = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const center = new THREE.Vector3();
  const lightRot = new THREE.Matrix4();
  const lightRotInv = new THREE.Matrix4();
  const ls = new THREE.Vector3();
  const ORIGIN = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  let extent = 0;
  let lastNight = -1;

  // Budget-managed warm point lights (lanterns, windows, the forge …).
  const POINT_BUDGET = { high: 10, medium: 5, low: 0 }[q.tier] ?? 4;
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
    return l;
  }
  engine.addUpdate(() => {
    const n = env.night;
    for (const l of points) l.intensity = l.userData.intensity.day + (l.userData.intensity.night - l.userData.intensity.day) * n;
  }, 21);

  ctx.lights = {
    sun,
    hemi,
    rim,
    addPoint,
    points,
    /** Live direction towards the current key light (sun by day, moon by night). */
    keyDir,
    get shadowExtent() {
      return extent;
    },
  };

  function updateColours(n) {
    // n is already eased by env; dip the key light around dusk so the swing of
    // the shadow direction between sun and moon is not noticeable.
    const dusk = Math.sin(Math.PI * n);
    keyDir.copy(SUN_LIGHT_DIR).lerp(MOON_LIGHT_DIR, smoothstep(0.25, 0.75, n)).normalize();
    rimDir.copy(RIM_DAY_DIR).lerp(RIM_NIGHT_DIR, n).normalize();
    sun.color.copy(DAY.key).lerp(NIGHT.key, n);
    sun.intensity = (DAY.keyI + (NIGHT.keyI - DAY.keyI) * n) * (1 - 0.55 * dusk);
    hemi.color.copy(DAY.hemiSky).lerp(NIGHT.hemiSky, n);
    hemi.groundColor.copy(DAY.hemiGround).lerp(NIGHT.hemiGround, n);
    hemi.intensity = DAY.hemiI + (NIGHT.hemiI - DAY.hemiI) * n;
    rim.color.copy(DAY.rim).lerp(NIGHT.rim, n);
    rim.intensity = DAY.rimI + (NIGHT.rimI - DAY.rimI) * n;
    envUniforms.uKeyDir.value.copy(keyDir);
    envUniforms.uKeyColor.value.copy(sun.color).multiplyScalar(sun.intensity / DAY.keyI);
  }

  function updateShadowFrustum() {
    const rig = ctx.cameraRig;
    if (rig?.target) focus.copy(rig.target);
    else focus.set(0, 0, 0);

    // Push the frustum ahead along the (horizontal) view direction: the camera
    // sees much more ground in front of its target than behind it.
    const camDist = camera.position.distanceTo(focus);
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const ahead = clamp(camDist * 0.55, 0, 60);
    center.copy(focus).addScaledVector(fwd, ahead);

    // Quantise the extent so the texel size is stable while zooming slightly.
    const wanted = clamp(camDist * 1.2 + 12, 22, 110);
    const quant = Math.ceil(wanted / 6) * 6;
    if (quant !== extent) {
      extent = quant;
      scam.left = -extent;
      scam.right = extent;
      scam.top = extent;
      scam.bottom = -extent;
      scam.updateProjectionMatrix();
    }

    // Snap the centre to whole texels in light space.
    lightRot.lookAt(keyDir, ORIGIN, UP); // same basis as the shadow camera (z = keyDir)
    lightRotInv.copy(lightRot).transpose();
    ls.copy(center).applyMatrix4(lightRotInv);
    const texel = (2 * extent) / mapSize;
    ls.x = Math.round(ls.x / texel) * texel;
    ls.y = Math.round(ls.y / texel) * texel;
    center.copy(ls).applyMatrix4(lightRot);

    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(keyDir, LIGHT_DISTANCE);
    sun.target.updateMatrixWorld();
    sun.shadow.normalBias = texel * 1.6;

    rim.target.position.copy(focus);
    rim.position.copy(focus).addScaledVector(rimDir, 50);
    rim.target.updateMatrixWorld();
  }

  // After the camera rig (order 80) so the frustum matches this frame's view.
  engine.addUpdate(() => {
    const n = env?.night ?? 0;
    if (n !== lastNight) {
      lastNight = n;
      updateColours(n);
    }
    updateShadowFrustum();
  }, 85);

  updateColours(env?.night ?? 0);
  updateShadowFrustum();
  return {};
}
