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
//                          moonlight (silver-lavender, back-right). The shadow
//                          map is re-rendered every other frame (static sun)
//                          and small casters are left out of it.
//   hemi HemisphereLight   soft, cool teal-grey sky fill (the shade reads as
//                          cool depth, never green felt) / warm golden ground
//                          bounce.
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
//                          paths, roofs and trunks, shimmering as leaves sway;
//                          bright golden flecks over deep shade by day, and a
//                          sunny clearing in the heart of the glen.
//   light pools            (night) every point request and lit doorway gets an
//                          additive warm pool on the ground (props/glow.js
//                          lightPools) — see buildLightPools.
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
// ctx.lights = { sun, hemi, rim, beam, keyDir, shadowExtent, shadowCenter, canopy, addPoint(position, opts), allocate(), points,
//                pools ({ count, meshes, ms, list } — the night light pools), rigs, retune() }
//   keyDir is live (world space, towards the current key light).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { smoothstep } from '../core/rng.js';
import { SUN_LIGHT_DIR, MOON_LIGHT_DIR, dirFromAngles, envUniforms } from './env/celestial.js';
import { installFog } from './env/fog.js';
import { installCanopy, canopyParams } from './env/canopy.js';
import { buildEnvMaps } from './env/envmap.js';
import { SPOTS, OAK, SCHREINEREI, RIVERSIDE, STREAM } from './layout.js';
import { getHeight, isInWater, getPathDistance } from './ground.js';
import { lightPools } from '../props/glow.js';

// Patch the fog & light chunks before any material compiles (idempotent).
installFog();
installCanopy();

const DAY = {
  key: new THREE.Color('#ffd49a'),
  keyI: 4.05,
  // a cool teal-grey sky fill: the shade reads as cool depth (not green felt),
  // the warm key paints the sunlit flecks gold
  hemiSky: new THREE.Color('#a2bcbe'),
  hemiGround: new THREE.Color('#7a6440'),
  hemiI: 0.85,
  /** canopy cookie: shade level between the flecks and the flecks' gain (sunlit cap tops, roofs, path stones) */
  canopyShade: 0.28,
  canopyFleck: 1.5,
  /** the glen's sunny clearing (env/canopy.js): strength */
  clearing: 0.85,
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
  canopyShade: 0.3,
  canopyFleck: 1.3,
  clearing: 0, // (the moonlit night stays exactly as it was)
};
/** The glen's sunny clearing (ground x, z, radius): the open heart of the glen in front of the oak. */
const CLEARING = [-1, 7, 6.5];

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
  // By day, likewise: nothing is in the canopy's shadow without a shadow map, so
  // the sun key and the leaf-filtered half shade are toned down (the glen keeps
  // the same value structure as on the other tiers instead of washing out).
  const lit = q.shadows
    ? { key: 1, rim: 1, hemi: 1, boost: 1, beam: 1, dayKey: 1, dayShade: 1 }
    : { key: 0.45, rim: 0.55, hemi: 0.8, boost: 0, beam: 0.7, dayKey: 0.8, dayShade: 0.7 };
  const dayKeyI = DAY.keyI * lit.dayKey;
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
    try {
      buildLightPools(chosen);
    } catch (err) {
      console.warn('[lighting] light pools failed', err);
    }
    if (q.shadows) trimShadowCasters(q.tier === 'high' ? { mesh: 0.75, instance: 0.5, keepSkinned: true } : { mesh: 1.5, instance: 0.5, keepSkinned: false });
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
   * Small casters leave the shadow pass — their shadow is a few texels, but each
   * is a draw call (and its triangles again) in the shadow pass.
   *   'medium' (phones): everything under 1.5 units (villagers, snails,
   *            furniture, props) and tiny instanced pieces (shingles, bulbs).
   *   'high':  small static pieces under 0.75 units (tools, signs, stools,
   *            gadgets) and tiny instanced pieces (shingles); characters
   *            (skinned: villagers, snails) keep theirs — they move, and their
   *            shadow grounds them.
   * Big shapes (trunks, crowns, canopy leaf clusters, houses, rocks, caps) keep
   * casting the dappled light.
   */
  function trimShadowCasters({ mesh = 1.5, instance = 0.5, keepSkinned = false } = {}) {
    scene.updateMatrixWorld();
    const sphere = new THREE.Sphere();
    let trimmed = 0;
    scene.traverse((o) => {
      if (!o.isMesh || !o.castShadow) return;
      if (keepSkinned && o.isSkinnedMesh) return;
      const g = o.geometry;
      if (!g) return;
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (!g.boundingSphere) return;
      if (o.isInstancedMesh) {
        // per-instance size (the instances' own geometry), e.g. a shingle
        const k = o.matrixWorld.getMaxScaleOnAxis();
        if (g.boundingSphere.radius * k < instance) {
          o.castShadow = false;
          trimmed++;
        }
        return;
      }
      sphere.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
      if (sphere.radius < mesh) {
        o.castShadow = false;
        trimmed++;
      }
    });
    ctx.lights.trimmedCasters = trimmed;
  }
  /**
   * Night light pools (props/glow.js lightPools — additive ground decals, one
   * draw call): the point-light budget cannot cover every lamp, so EVERY
   * addPoint request (live or not) gets a warm pool on the surface below it
   * (the highest flat surface below it: a floor, a deck, the path), and every lit
   * doorway (mushroom houses incl. the Wohnatelier arch, the Velowerkstatt,
   * the Schreinerei door & annex) spills an elongated pool over its threshold.
   * A pool next to a LIVE point light is weaker (that light already lights
   * the ground), on 'low' (no point lights) the pools are all there is.
   * They light in the lamplighter cascade and are hidden by day.
   */
  function buildLightPools(live) {
    const t0 = performance.now();
    scene.updateMatrixWorld();
    const pools = [];
    const groundY = (x, z) => (isInWater(x, z) ? Math.max(getHeight(x, z), STREAM.waterLevel) : getHeight(x, z));

    // lanterns without a point request: the oak's hanging lanterns, both
    // bridge lanterns and the path lanterns on posts (collider tag
    // 'path-lantern'; their arm reaches over the path)
    const extra = [];
    {
      const near = (p) => requests.some((r) => Math.hypot(r.light.position.x - p.x, r.light.position.z - p.z) < 0.7);
      const add = (p) => {
        if (!near(p)) extra.push(p);
      };
      for (const p of ctx.oak?.lanterns ?? []) add({ x: p.x, y: p.y, z: p.z });
      for (const p of ctx.modules?.riverside?.anchors?.bridgeLanterns ?? []) add({ x: p.x, y: p.y, z: p.z });
      for (const sh of ctx.colliders?.shapes ?? []) {
        if (sh.tag !== 'path-lantern') continue;
        // nudge towards the path (down the path-distance gradient)
        const gx = getPathDistance(sh.x + 0.1, sh.z) - getPathDistance(sh.x - 0.1, sh.z);
        const gz = getPathDistance(sh.x, sh.z + 0.1) - getPathDistance(sh.x, sh.z - 0.1);
        const gl = Math.hypot(gx, gz) || 1;
        const x = sh.x - (gx / gl) * 0.3, z = sh.z - (gz / gl) * 0.3;
        add({ x, y: groundY(x, z) + 0.75, z });
      }
    }

    // Surfaces a pool may lie on (floors, decks, porches, the bridge, steps): the
    // FLAT-ish triangles (|normal.y| > 0.75) of the building modules' opaque
    // static meshes within reach of a lamp, collected once. No terrain (getHeight
    // is exact), no oak / vegetation (huge batches, leaf cards), no glows, no
    // characters. "What is below this point" is then a 2D point-in-triangle test.
    const CELL = 2;
    const cells = new Set();
    const key = (i, k) => (i + 512) * 1024 + (k + 512);
    for (const p of [...requests.map((r) => r.light.position), ...extra]) {
      if (p.y - groundY(p.x, p.z) > 7.5) continue;
      for (let i = -2; i <= 2; i++) for (let k = -2; k <= 2; k++) cells.add(key(Math.floor(p.x / CELL) + i, Math.floor(p.z / CELL) + k));
    }
    const tri = []; // ax, az, ay, bx, bz, by, cx, cz, cy
    const grid = new Map(); // cell key → offsets into tri
    {
      const roots = ['schreinerei', 'loft', 'cottage', 'riverside'].flatMap((id) => ctx.moduleRoots?.[id] ?? []);
      const m4 = new THREE.Matrix4();
      const v = new THREE.Vector3();
      let wp = new Float32Array(0);
      const addMesh = (o, g, mw) => {
        const pos = g.attributes.position;
        const n = pos.count;
        if (wp.length < n * 3) wp = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mw);
          wp[i * 3] = v.x;
          wp[i * 3 + 1] = v.y;
          wp[i * 3 + 2] = v.z;
        }
        const idx = g.index;
        const count = idx ? idx.count : n;
        for (let t = 0; t + 2 < count; t += 3) {
          const a = (idx ? idx.getX(t) : t) * 3, b = (idx ? idx.getX(t + 1) : t + 1) * 3, c = (idx ? idx.getX(t + 2) : t + 2) * 3;
          const ax = wp[a], az = wp[a + 2], bx = wp[b], bz = wp[b + 2], cx = wp[c], cz = wp[c + 2];
          const minX = Math.floor(Math.min(ax, bx, cx) / CELL), maxX = Math.floor(Math.max(ax, bx, cx) / CELL);
          const minZ = Math.floor(Math.min(az, bz, cz) / CELL), maxZ = Math.floor(Math.max(az, bz, cz) / CELL);
          if (maxX - minX > 3 || maxZ - minZ > 3) continue; // a huge triangle is no floor of a lamp
          let hit = false;
          for (let i = minX; i <= maxX && !hit; i++) for (let k = minZ; k <= maxZ && !hit; k++) hit = cells.has(key(i, k));
          if (!hit) continue;
          // flat-ish? (normal from the world-space edges)
          const e1x = bx - ax, e1y = wp[b + 1] - wp[a + 1], e1z = bz - az;
          const e2x = cx - ax, e2y = wp[c + 1] - wp[a + 1], e2z = cz - az;
          const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
          const nl = Math.hypot(nx, ny, nz);
          if (nl < 1e-9 || Math.abs(ny) / nl < 0.75) continue;
          const at = tri.length;
          tri.push(ax, az, wp[a + 1], bx, bz, wp[b + 1], cx, cz, wp[c + 1]);
          // bucket it in every cell it touches (lookups only scan their own cell)
          for (let i = minX; i <= maxX; i++) {
            for (let k = minZ; k <= maxZ; k++) {
              const kk = key(i, k);
              let list = grid.get(kk);
              if (!list) grid.set(kk, (list = []));
              list.push(at);
            }
          }
        }
      };
      for (const r of roots) {
        r.traverse((o) => {
          if (!o.isMesh || o.isSkinnedMesh || !o.visible || o === ctx.terrainMesh) return;
          const m = Array.isArray(o.material) ? o.material[0] : o.material;
          if (!m || m.transparent || m.depthWrite === false || m.alphaTest > 0 || m.isShaderMaterial) return;
          if (o.raycast !== THREE.Mesh.prototype.raycast && !o.isInstancedMesh) return; // glows, smoke, helpers
          const g = o.geometry;
          if (!g?.attributes?.position) return;
          if (o.isInstancedMesh) {
            for (let i = 0; i < o.count; i++) {
              o.getMatrixAt(i, m4);
              addMesh(o, g, m4.premultiply(o.matrixWorld));
            }
          } else addMesh(o, g, o.matrixWorld);
        });
      }
    }
    /** y of the highest flat-ish surface at least `near` below p (else the ground). */
    function surfaceBelow(p, near = 0.3) {
      const gy = groundY(p.x, p.z);
      if (p.y - gy < near + 0.3) return gy;
      const top = p.y - near;
      let best = gy;
      const x = p.x, z = p.z;
      const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!list) return gy;
      for (const t of list) {
        const ax = tri[t], az = tri[t + 1], bx = tri[t + 3], bz = tri[t + 4], cx = tri[t + 6], cz = tri[t + 7];
        // barycentric point-in-triangle (xz)
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-12) continue;
        const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        if (u < 0 || u > 1) continue;
        const w = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        if (w < 0 || u + w > 1) continue;
        const y = u * tri[t + 2] + w * tri[t + 5] + (1 - u - w) * tri[t + 8];
        if (y < top && y > best) best = y;
      }
      return best;
    }

    /**
     * Does a flat floor at height y cover the ring of radius r around (x, z)?
     * (6 of 8 probes — deck planks have gaps; arched bridge decks slope a little)
     */
    const probe = new THREE.Vector3();
    function floorCovers(x, y, z, r) {
      const tol = 0.12 + 0.1 * r;
      let miss = 0;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        probe.set(x + Math.cos(a) * r, y + 0.4, z + Math.sin(a) * r);
        if (Math.abs(surfaceBelow(probe, 0.25) - y) > tol && ++miss > 2) return false;
      }
      return true;
    }
    /**
     * Where a pool under a lamp at p lies: the highest flat surface below it that
     * is big enough (a flat pool must never overhang its deck — it would float in
     * the air: shrink it until a ring at 85 % of its radius still finds that
     * floor; a table top or a narrow step that is too small hands over to the
     * next surface down), else the ground (a draped pool). → { y, size, flat }
     */
    function placePool(p, size0) {
      const gy = groundY(p.x, p.z);
      let y = surfaceBelow(p);
      for (let level = 0; level < 3 && y - gy > 0.08; level++) {
        let size = size0;
        for (let k = 0; k < 3; k++, size *= 0.75) if (floorCovers(p.x, y, p.z, size * 0.85)) return { y, size, flat: true };
        probe.set(p.x, y, p.z);
        y = surfaceBelow(probe, 0.03);
      }
      return { y: gy, size: size0, flat: false };
    }

    // ① under every point request (live or not)
    for (const r of requests) {
      const l = r.light;
      const p = l.position;
      const h0 = p.y - surfaceBelow(p);
      if (h0 > 7) continue; // high in a giant: its light never reaches the ground as a pool
      const night = l.userData.intensity.night;
      const reach = Math.sqrt((l.distance || 7) / 7);
      const warm = isWarmColor(l.color);
      const at = placePool(p, THREE.MathUtils.clamp(0.9 + 0.38 * h0, 1.15, 2.3) * reach);
      const h = p.y - at.y;
      pools.push({
        x: p.x,
        y: at.y,
        z: p.z,
        size: at.size,
        color: l.color.getStyle(),
        strength: ((live.has(r) ? 0.45 : 1) * THREE.MathUtils.clamp(night / 4.5, 0.55, 1.25) * (warm ? 1 : 0.55)) / (1 + 0.06 * h * h),
        // decks, floors & the loft get a flat pool, the ground a draped one
        flat: at.flat,
      });
    }

    // ①b lanterns without a point request (see `extra` above)
    {
      const pt = new THREE.Vector3();
      for (const e of extra) {
        pt.set(e.x, e.y, e.z);
        const h0 = e.y - surfaceBelow(pt);
        if (h0 > 6) continue;
        const at = placePool(pt, THREE.MathUtils.clamp(0.7 + 0.35 * h0, 0.85, 1.8));
        const h = e.y - at.y;
        pools.push({ x: e.x, y: at.y, z: e.z, size: at.size, color: '#ffb35c', strength: 0.55 / (1 + 0.06 * h * h), flat: at.flat });
      }
    }

    // ② lit doorways: a long pool spilling out over the threshold
    // (an interior light never reaches the threshold as a pool: walls, decay —
    // so doorway pools keep their strength whether or not that light is live)
    const doorway = (x, z, dx, dz, opts = {}) => {
      const y = groundY(x, z);
      pools.push({ x, y, z, dir: { x: dx, z: dz }, size: opts.size ?? 1.35, stretch: opts.stretch ?? 1.55, back: 0.45, color: opts.color ?? '#ffaa58', strength: opts.strength ?? 1, delay: opts.delay ?? 0 });
    };
    const v = new THREE.Vector3(), c0 = new THREE.Vector3();
    scene.traverse((o) => {
      const u = o.userData;
      if (o.name !== 'mushroomHouse' || !u?.doorTarget) return;
      c0.set(0, 0, 0).applyMatrix4(o.matrixWorld);
      // only LIT doors (a lamp requested near the door, e.g. Jonny's door light) —
      // the garden shed's dark door gets none
      if (u.door) {
        v.copy(u.door).applyMatrix4(o.matrixWorld);
        const lit = requests.some((r) => Math.hypot(r.light.position.x - v.x, r.light.position.z - v.z) < 3.5);
        if (lit) doorway(v.x, v.z, v.x - c0.x, v.z - c0.z, { strength: 0.85 });
      }
      if (u.interior) {
        // the Wohnatelier's open arch: a wide pool over the terrace
        const I = u.interior;
        const s = Math.sin(I.phi ?? 0), cz = Math.cos(I.phi ?? 0);
        v.set(s * (I.facadeZ + 0.1), 0, cz * (I.facadeZ + 0.1)).applyMatrix4(o.matrixWorld);
        const d = new THREE.Vector3(s, 0, cz).transformDirection(o.matrixWorld);
        doorway(v.x, v.z, d.x, d.z, { size: Math.max(1.6, (I.width ?? 2.6) * 0.7), stretch: 1.5, strength: 1.4, color: '#ffb465' });
      }
    });
    // the Velowerkstatt's double doors (riverside anchors) …
    const shopDoor = ctx.modules?.riverside?.anchors?.workshopDoor;
    if (shopDoor) doorway(shopDoor.x, shopDoor.z, shopDoor.x - RIVERSIDE.bikeShed.x, shopDoor.z - RIVERSIDE.bikeShed.z, { size: 1.6, stretch: 1.5, strength: 1.1 });
    // … the round Schreinerei door in the oak (facing +Z) and the annex's double door
    // (the round door's own point light already pools warm light on the path: a lighter touch)
    doorway(OAK.door.x, OAK.door.z + 0.35, Math.sin(OAK.door.rotY ?? 0), Math.cos(OAK.door.rotY ?? 0), { size: 1.4, stretch: 1.5, strength: 0.55 });
    {
      const A = SCHREINEREI.annex;
      const cs = Math.cos(A.rotY), sn = Math.sin(A.rotY);
      // annex-local door centre (x = (s0 + s1) / 2 − hx ≈ −0.28, z = hz + 0.15)
      const lx = -0.28, lz = A.depth / 2 + 0.15;
      doorway(A.x + lx * cs + lz * sn, A.z - lx * sn + lz * cs, sn, cs, { size: 1.35, stretch: 1.4, strength: 0.8 });
    }

    if (!pools.length) return;
    // flat pools (decks, floors) and terrain-draped pools in one mesh each
    const flat = pools.filter((p) => p.flat);
    const draped = pools.filter((p) => !p.flat);
    lightPoolMeshes.length = 0;
    if (draped.length) lightPoolMeshes.push(lightPools(draped, { height: groundY, lift: 0.1 }));
    if (flat.length) lightPoolMeshes.push(lightPools(flat, { lift: 0.03 }));
    for (const m of lightPoolMeshes) {
      m.visible = (env?.night ?? 0) > 0.02;
      scene.add(m);
    }
    ctx.lights.pools = { count: pools.length, meshes: lightPoolMeshes, ms: Math.round(performance.now() - t0), list: pools };
  }
  function isWarmColor(c) {
    const hsl = c.getHSL({ h: 0, s: 0, l: 0 });
    return (hsl.h < 0.17 || hsl.h > 0.95) && hsl.s > 0.25;
  }
  const lightPoolMeshes = [];
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
    /** Live canopy-cookie parameters (env/canopy.js: a = time, strength, plane y, fade y; b = shade, gain, freq, detail octave; c = clearing x, z, radius, strength). */
    canopy: canopyParams,
    /** Live multipliers (debug & tuning): canopy = strength of the dappled-sunlight cookie. */
    settings: { canopy: 1 },
    /** The day / night light rigs (live-tunable; call retune() after a change). */
    rigs: { day: DAY, night: NIGHT },
    retune() {
      lastNight = -1;
    },
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
    sun.intensity = (dayKeyI + (nightKeyI - dayKeyI) * n) * (1 - 0.75 * dusk);
    hemi.color.copy(DAY.hemiSky).lerp(NIGHT.hemiSky, n);
    hemi.groundColor.copy(DAY.hemiGround).lerp(NIGHT.hemiGround, n);
    hemi.intensity = DAY.hemiI + (nightHemiI - DAY.hemiI) * n;
    rim.color.copy(DAY.rim).lerp(NIGHT.rim, n);
    rim.intensity = DAY.rimI + (nightRimI - DAY.rimI) * n;
    // the canopy cookie: deeper shade & brighter flecks by day, the clearing open
    canopyParams.b[0] = DAY.canopyShade * lit.dayShade + (NIGHT.canopyShade - DAY.canopyShade * lit.dayShade) * n;
    canopyParams.b[1] = DAY.canopyFleck + (NIGHT.canopyFleck - DAY.canopyFleck) * n;
    canopyParams.c.set([CLEARING[0], CLEARING[1], CLEARING[2], DAY.clearing + (NIGHT.clearing - DAY.clearing) * n]);
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

  // The sun (and the moon) never move, so the shadow map is re-rendered only every
  // q.shadowEvery-th frame (engine preset: 2 on 'high' and 'medium' — swaying
  // leaves & walking villagers still update at 30 Hz; the frame-time governor may
  // raise it). Any light change forces an immediate refresh (update()).
  let throttleShadows = false;
  function applyShadowRate() {
    throttleShadows = !!q.shadows && (q.shadowEvery ?? (q.tier === 'high' ? 1 : 2)) > 1;
    renderer.shadowMap.autoUpdate = !throttleShadows;
    renderer.shadowMap.needsUpdate = true;
  }
  applyShadowRate();
  let frameNo = 0;
  // the governor stepped down: a smaller shadow map (re-allocated by three on the
  // next shadow render) and/or a lower shadow refresh rate
  engine.onQualityChange?.((qq) => {
    const size = Math.min(qq.shadowMapSize || 1024, maxTex);
    if (sun.castShadow && sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.normalBias = Math.max(0.02, ((2 * SHADOW_EXTENT) / size) * 1.4);
      if (sun.shadow.map) {
        sun.shadow.map.depthTexture?.dispose();
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    }
    applyShadowRate();
  });

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
      // the night light pools cost nothing by day
      for (const m of lightPoolMeshes) m.visible = n > 0.02;
    }
    if (throttleShadows && frameNo++ % (q.shadowEvery || 2) === 0) renderer.shadowMap.needsUpdate = true;
  }, 21);

  update(env?.night ?? 0);
  lastNight = env?.night ?? 0;
  return {};
}
