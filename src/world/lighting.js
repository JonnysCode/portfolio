// ─────────────────────────────────────────────────────────────────────────────
// Lighting — late golden afternoon in a forest glen. The ONLY module that
// creates lights.
//
//   sun  DirectionalLight  warm, low from the back-left (WNW) so it rakes
//                          through the canopy, rims every silhouette and casts
//                          long dappled shadows. Soft PCF shadows with a FIXED
//                          frustum tightly covering the glen (±35 units) at the
//                          map size of the tier — no swimming, no re-fitting
//                          while the camera glides. By night it becomes the
//                          moonlight (silver-lavender, back-right). On 'medium'
//                          the shadow map is re-rendered every other frame and
//                          small casters are left out of it.
//   hemi HemisphereLight   soft sage sky fill (warm-neutral: the teal lives only
//                          in the misty distance) / warm golden ground bounce.
//   rim  DirectionalLight  faint cool light from the back-right that separates
//                          the shaded sides from the misty background; by
//                          night a stronger cool moon-rim from the west
//                          (side-on to the spot cameras, opposite the moon)
//                          so the giant trunks, caps and the oak keep a
//                          silvered edge against the night mist. Not from
//                          straight behind: back light makes leaf cards glow
//                          (translucency) and the canopy would read as day.
//   beam SpotLight         a canopy-gap sunbeam: warm gold from the front-left,
//                          a small, irregular, dappled pool in front of the
//                          Schreinerei door (the sun itself is behind the oak
//                          there). A high-contrast leaf cookie with ragged
//                          edges and many leaf holes (no shadow map of its own
//                          — cheap) keeps it reading as sunlight through leaves,
//                          not a spotlight oval, and the path stones keep their
//                          value; matched by a volumetric shaft (atmosphere).
//                          By night the same light becomes a silver moonbeam on
//                          the fairy ring.
//   canopy cookie          every lit material's key light is dappled by a
//                          world-space leaf-gap pattern (env/canopy.js — a
//                          global light-chunk patch): sun flecks on lawns,
//                          paths, roofs and trunks, shimmering as leaves sway.
//   scene.environment      a painted "under the canopy" PMREM (env/envmap.js) so
//                          PBR surfaces get soft ambient and gentle
//                          reflections; swapped for a night version at dusk.
//
// Warm point lights (lanterns, windows, forge …) only through
//   ctx.lights.addPoint(position, { color, day, night, distance, decay, priority, spot })
// which is budgeted per tier. Requests made while the world is being built are
// collected and allocated once it is complete (ctx.lights.allocate(), called by
// post.js before shaders are compiled): first one light for every spot
// (Schreinerei, Jonny's cottage, Wohnatelier, Velowerkstatt, Code Loft — the
// spot is the nearest spot focus unless opts.spot names it), then the rest by
// priority (opts.priority, default ≈ night intensity × reach × spot weight).
// Lights that miss out are never added to the scene — keep the glow sprites.
// (The returned light object is always valid during the build; afterwards
// addPoint returns null once the budget is used up.)
//
// ctx.lights = { sun, hemi, rim, beam, keyDir, shadowExtent, shadowCenter, canopy, addPoint(position, opts), allocate(), points }
//   keyDir is live (world space, towards the current key light).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { smoothstep } from '../core/rng.js';
import { SUN_LIGHT_DIR, MOON_LIGHT_DIR, dirFromAngles, envUniforms } from './env/celestial.js';
import { installFog } from './env/fog.js';
import { installCanopy, canopyParams } from './env/canopy.js';
import { buildEnvMaps } from './env/envmap.js';
import { SPOTS, OAK, SCHREINEREI } from './layout.js';

// Patch the fog & light chunks before any material compiles (idempotent).
installFog();
installCanopy();

const DAY = {
  key: new THREE.Color('#ffd49a'),
  keyI: 4.05,
  hemiSky: new THREE.Color('#aebf9f'),
  hemiGround: new THREE.Color('#7a6440'),
  hemiI: 0.85,
  rim: new THREE.Color('#a9d2e6'),
  rimI: 0.4,
  envI: 0.5,
  beam: new THREE.Color('#ffd9a8'),
  beamI: 2.2,
};
const NIGHT = {
  key: new THREE.Color('#aab4ff'),
  keyI: 2.05,
  // a less saturated lavender sky fill: reds & ochres survive the moonlight
  hemiSky: new THREE.Color('#5a6aa8'),
  hemiGround: new THREE.Color('#1e2532'),
  hemiI: 1.12,
  rim: new THREE.Color('#9db8ec'),
  rimI: 1.1,
  envI: 0.56,
  beam: new THREE.Color('#a8c0ff'),
  beamI: 1.8,
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

/**
 * The canopy-gap sunbeam: from the front-left, high, onto the Schreinerei
 * (door, porch bench, deck). By night a narrower silver moonbeam from the
 * moon's side onto the fairy ring (target found after the build).
 */
const BEAM_DAY = {
  target: new THREE.Vector3(OAK.door.x + 0.5, 0.6, (OAK.door.z + SCHREINEREI.porch.z) / 2 + 0.1),
  dir: dirFromAngles(50, 228),
  distance: 26,
  // small: the cookie draws the ragged pool inside the cone (≈ 2–3 units)
  angle: 0.2,
  penumbra: 0.3,
};
const BEAM_NIGHT = {
  target: new THREE.Vector3(-4.5, 0, 11.2), // the fairy ring (refined after the build)
  dir: dirFromAngles(62, 58),
  distance: 26,
  angle: 0.12,
  penumbra: 0.75,
};

/** Spots that get their own warm light before anything else, most important first. */
const LIGHT_SPOTS = ['woodworking', 'home', 'interior', 'bikes', 'code'];
const SPOT_WEIGHT = { woodworking: 1.5, home: 1.2, interior: 1.2, bikes: 1.2, code: 1.1, glen: 1 };

/**
 * The sunbeam's leaf cookie (multiplies the light colour): a small irregular
 * pool of sun — overlapping soft lobes, ragged edges — riddled with crisp leaf
 * shadows, plus a few stray pinhole flecks around it. Black outside, so the
 * cone itself never shows as a smooth oval.
 */
function leafCookie() {
  if (typeof document === 'undefined') return null;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blob = (x, y, rx, ry, rot, fill) => {
    g.fillStyle = fill;
    g.beginPath();
    g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    g.fill();
  };
  // the pool: a ragged union of soft lobes (never a clean oval)
  g.filter = 'blur(5px)';
  for (let i = 0; i < 11; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.pow(rnd(), 0.8) * S * 0.17;
    const sz = S * (0.07 + rnd() * 0.1);
    blob(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, sz, sz * (0.55 + rnd() * 0.45), rnd() * Math.PI, `rgba(255, 246, 230, ${0.75 + rnd() * 0.25})`);
  }
  // stray pinhole flecks scattered around the pool
  g.filter = 'blur(2px)';
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const r = S * (0.2 + rnd() * 0.24);
    const sz = S * (0.012 + rnd() * 0.022);
    blob(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, sz, sz * (0.7 + rnd() * 0.3), rnd() * Math.PI, `rgba(255, 244, 226, ${0.55 + rnd() * 0.45})`);
  }
  // leaf shadows: crisp, many, so the pool is full of holes (high contrast)
  g.filter = 'blur(1.5px)';
  for (let i = 0; i < 120; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.pow(rnd(), 0.7) * S * 0.36;
    const sz = S * (0.012 + rnd() * 0.03);
    blob(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, sz, sz * (0.4 + rnd() * 0.35), rnd() * Math.PI, `rgba(10, 8, 4, ${0.7 + rnd() * 0.3})`);
  }
  g.filter = 'none';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

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
  // The map size of the tier (high 4096, medium 1024): the frustum is fixed,
  // so every texel goes into crisp dappled canopy shadows.
  const maxTex = renderer.capabilities.maxTextureSize || 4096;
  const mapSize = Math.min(q.shadowMapSize || 1024, maxTex);
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.radius = q.tier === 'high' ? 3.2 : 1.6;
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

  // The canopy-gap sunbeam (no distance falloff: it is sunlight). It casts no
  // shadow map of its own (a second depth pass over the glen's casters would
  // cost ~0.5 M triangles a frame); a dappled leaf cookie breaks the pool up
  // instead (spot maps work without shadows in current three).
  const beam = new THREE.SpotLight(DAY.beam, DAY.beamI, 0, BEAM_DAY.angle, BEAM_DAY.penumbra, 0);
  beam.name = 'sunbeam';
  beam.castShadow = false;
  try {
    beam.map = q.tier === 'low' ? null : leafCookie();
  } catch {
    beam.map = null;
  }
  scene.add(beam, beam.target);
  const beamDay = { pos: new THREE.Vector3(), target: BEAM_DAY.target.clone() };
  beamDay.pos.copy(beamDay.target).addScaledVector(BEAM_DAY.dir, BEAM_DAY.distance);
  const beamNight = { pos: new THREE.Vector3(), target: BEAM_NIGHT.target.clone() };
  const placeNightBeam = () => beamNight.pos.copy(beamNight.target).addScaledVector(BEAM_NIGHT.dir, BEAM_NIGHT.distance);
  placeNightBeam();
  let beamPhase = -1;

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
  const lit = q.shadows ? { key: 1, rim: 1, hemi: 1, boost: 1, beam: 1 } : { key: 0.45, rim: 0.55, hemi: 0.8, boost: 0, beam: 0.7 };
  const nightKeyI = NIGHT.keyI * lit.key;
  const nightRimI = NIGHT.rimI * lit.rim;
  const nightHemiI = NIGHT.hemiI * lit.hemi;
  const keyDir = new THREE.Vector3().copy(SUN_LIGHT_DIR);
  const rimDir = new THREE.Vector3().copy(RIM_DAY_DIR);
  let lastNight = -1;

  // ── budget-managed warm point lights (lanterns, windows, the forge …) ──
  const POINT_BUDGET = { high: 12, medium: 6, low: 0 }[q.tier] ?? 4;
  const points = [];
  const requests = [];
  let allocated = false;
  const spotFoci = SPOTS.filter((s) => LIGHT_SPOTS.includes(s.id)).map((s) => ({ id: s.id, f: new THREE.Vector3(...s.focus) }));
  function spotOf(position) {
    let best = 'glen', bd = 10;
    for (const s of spotFoci) {
      const d = s.f.distanceTo(position);
      if (d < bd) {
        bd = d;
        best = s.id;
      }
    }
    return best;
  }
  function enable(l) {
    scene.add(l);
    points.push(l);
    applyPoint(l, env?.night ?? 0);
  }
  /**
   * Ask for a warm point light. opts: { color, day, night (intensities), distance,
   * decay, priority, spot }. During the build the request is queued and allocated
   * when the world is complete (see the header); afterwards it is added at once if
   * the budget allows. Returns the light or null (always keep a glow fallback).
   */
  function addPoint(position, opts = {}) {
    if (POINT_BUDGET <= 0) return null;
    if (allocated && points.length >= POINT_BUDGET) return null;
    const l = new THREE.PointLight(opts.color ?? '#ffb866', 0, opts.distance ?? 7, opts.decay ?? 2);
    l.position.copy(position);
    l.castShadow = false;
    l.userData.intensity = { day: opts.day ?? 0.4, night: opts.night ?? 6 };
    if (allocated) {
      enable(l);
      return l;
    }
    const spot = opts.spot ?? spotOf(l.position);
    const reach = l.distance || 7;
    const priority = opts.priority ?? (Math.max(l.userData.intensity.night, l.userData.intensity.day * 2) * reach * (SPOT_WEIGHT[spot] ?? 1));
    requests.push({ light: l, spot, priority, order: requests.length });
    return l;
  }
  /** Hand out the point-light budget: one light per spot first, then by priority. Idempotent. */
  function allocate() {
    if (allocated) return;
    allocated = true;
    const byPriority = [...requests].sort((a, b) => b.priority - a.priority || a.order - b.order);
    const chosen = new Set();
    for (const id of LIGHT_SPOTS) {
      if (chosen.size >= POINT_BUDGET) break;
      const r = byPriority.find((x) => x.spot === id);
      if (r) chosen.add(r);
    }
    for (const r of byPriority) {
      if (chosen.size >= POINT_BUDGET) break;
      chosen.add(r);
    }
    for (const r of requests) if (chosen.has(r)) enable(r.light);
    if (q.tier === 'medium' && q.shadows) trimShadowCasters();
    ctx.lights.pointRequests = requests.map((r) => ({ spot: r.spot, priority: +r.priority.toFixed(1), on: chosen.has(r), p: r.light.position.toArray().map((v) => +v.toFixed(1)) }));
    // the moonbeam finds the fairy ring (a secret hotspot of the vegetation)
    try {
      const ring = ctx.interactions?.hotspots?.find((h) => /fairy ring/i.test(h.label ?? ''));
      if (ring?.worldPosition) {
        ring.worldPosition(beamNight.target);
        beamNight.target.y = Math.max(beamNight.target.y, 0) + 0.2;
        placeNightBeam();
        beamPhase = -1;
        update(env?.night ?? 0);
      }
    } catch {
      /* keep the default target */
    }
  }
  /**
   * 'medium' (phones): small casters (villagers, snails, furniture, props) and
   * tiny instanced pieces (shingles, bulbs) leave the shadow map — on a phone
   * screen their shadows are a few pixels, but each is a draw call in the
   * shadow pass. Big shapes (trunks, crowns, canopy leaf clusters, houses,
   * rocks, caps) keep casting the dappled light.
   */
  function trimShadowCasters() {
    scene.updateMatrixWorld();
    const sphere = new THREE.Sphere();
    let trimmed = 0;
    scene.traverse((o) => {
      if (!o.isMesh || !o.castShadow) return;
      const g = o.geometry;
      if (!g) return;
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (!g.boundingSphere) return;
      if (o.isInstancedMesh) {
        // per-instance size (the instances' own geometry), e.g. a shingle
        const k = o.matrixWorld.getMaxScaleOnAxis();
        if (g.boundingSphere.radius * k < 0.5) {
          o.castShadow = false;
          trimmed++;
        }
        return;
      }
      sphere.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
      if (sphere.radius < 1.5) {
        o.castShadow = false;
        trimmed++;
      }
    });
    ctx.lights.trimmedCasters = trimmed;
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
    beam,
    addPoint,
    allocate,
    points,
    /** Live direction towards the current key light (sun by day, moon by night). */
    keyDir,
    /** Half size of the fixed shadow frustum (world units). */
    shadowExtent: SHADOW_EXTENT,
    shadowCenter: SHADOW_CENTER,
    /** The sunbeam (day) / moonbeam (night) geometry: { day: {pos, target}, night: {pos, target} }. */
    beams: { day: beamDay, night: beamNight },
    envMaps,
    /** Live canopy-cookie parameters (env/canopy.js: a = time, strength, plane y, fade y; b = shade, gain, freq, detail octave). */
    canopy: canopyParams,
    /** Live multipliers (debug & tuning): canopy = strength of the dappled-sunlight cookie. */
    settings: { canopy: 1 },
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
    // the beam: golden sunbeam on the Schreinerei, fading out towards dusk, then
    // (relocated while dark) a silver moonbeam on the fairy ring
    const phase = n < 0.5 ? 0 : 1;
    if (phase !== beamPhase) {
      beamPhase = phase;
      const b = phase ? beamNight : beamDay;
      const cfg = phase ? BEAM_NIGHT : BEAM_DAY;
      beam.position.copy(b.pos);
      beam.target.position.copy(b.target);
      // (without the cookie — 'low' — the daytime cone itself must stay small and soft)
      beam.angle = cfg.angle * (!phase && !beam.map ? 0.65 : 1);
      beam.penumbra = !phase && !beam.map ? 0.85 : cfg.penumbra;
      beam.color.copy(phase ? NIGHT.beam : DAY.beam);
      beam.target.updateMatrixWorld();
    }
    beam.intensity = (phase ? NIGHT.beamI * smoothstep(0.6, 0.95, n) : DAY.beamI * (1 - smoothstep(0.05, 0.4, n))) * lit.beam;
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
    // the shadow maps must follow a changed light at once (also when throttled)
    renderer.shadowMap.needsUpdate = true;
  }

  // 'medium' (phones): the sun is static, so the shadow maps are re-rendered
  // only every other frame (swaying leaves & walking villagers still move them).
  const throttleShadows = q.shadows && q.tier !== 'high';
  if (throttleShadows) {
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
  }
  let frameNo = 0;

  // the canopy cookie: leaves sway (time), a little softer by moonlight
  const settings = ctx.lights.settings;
  const canopyMotion = engine.reducedMotion ? 0 : 1;
  // the detail octave of the leaf pattern only on 'high' (phones: one octave less per lit pixel)
  canopyParams.b[3] = q.tier === 'high' ? 1 : 0;
  engine.addUpdate((dt, t) => {
    if (!allocated && engine.frame > 1) allocate(); // safety net if post never ran
    const n = env?.night ?? 0;
    canopyParams.a[0] = t * canopyMotion;
    canopyParams.a[1] = settings.canopy * (1 - 0.35 * n);
    if (n !== lastNight) {
      lastNight = n;
      update(n);
    }
    if (throttleShadows && (frameNo++ & 1) === 0) renderer.shadowMap.needsUpdate = true;
  }, 21);

  update(env?.night ?? 0);
  lastNight = env?.night ?? 0;
  return {};
}
