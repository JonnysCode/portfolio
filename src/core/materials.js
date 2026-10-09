// ─────────────────────────────────────────────────────────────────────────────
// Shared materials. ALWAYS get materials from here so they are cached and
// re-used (fewer shader programs, fewer state changes) and so day/night & wind
// stay in sync across the whole world.
//
//   materials.surface('bark')                         → painterly PBR surface (see surface())
//   materials.surface('stone', { mossy: 0.5 })        → … with moss creeping over the top
//   materials.surface('wood', { species: 'walnut', planks: true })
//   materials.foliage({ variant: 'fern', wind: { strength: 0.08, base: 0 } })
//   materials.glow(palette.windowGlow)                → emissive, brighter at night (blooms)
//   materials.toon('#e2553f')                         → soft cel-shaded look (characters & props)
//   materials.standard(palette.metal, { metalness: 0.6, roughness: 0.35 })
//   materials.basic('#fff')                           → unlit
//
// Geometry helpers for the textured surfaces:
//   materials.boxUV(geometry, 'shingles', { grain: 'x' })  world-sized box-projected UVs
//   materials.foliageNormals(geometry, center)            soft volumetric normals for leaf cards
//
// Surface textures are procedural and baked on the GPU (src/core/textures/).
// Call materials.setRenderer(renderer) once at boot; otherwise the first
// surface drawn hands its renderer to the bakery.
//
// Cached materials are SHARED: never mutate a material you got from here
// (colour, emissive, opacity …). Ask for a different key instead, or call
// .clone() if you truly need a unique animated material.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { palette } from './palette.js';
import { createRng } from './rng.js';
import { KINDS, WOOD_SPECIES, FOLIAGE_VARIANTS, surfaceMaps, foliageMap, setBakeRenderer, setBakeScale, hasBakeRenderer, bakeStats, measureMean } from './textures/index.js';
import { patchSurface, patchFoliage, patchFoliageDepth } from './textures/surfaceShader.js';

/**
 * Wind amplitude when the visitor prefers reduced motion: foliage barely
 * breathes instead of swaying (applies to every applyWind material, including
 * the foliage shadow pass).
 */
export const REDUCED_WIND = 0.12;

let reducedMotion = false;
let reducedQuery = null;
try {
  reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  reducedMotion = !!reducedQuery?.matches;
} catch {
  /* no media queries (workers, tests) */
}

/**
 * End-grain marker for UV-mapped wood: a UV generator adds END_GRAIN_V to V on
 * faces that cut ACROSS the grain (normal ∥ grain axis). The surface shader
 * strips it again and draws those faces as darker end grain (Hirnholz) with
 * ring arcs, rays and — on timber — a drying check. materials.boxUV() does it
 * automatically; a module's own box-UV helper only has to add it in its
 * "normal along the grain axis" branch:  v = v * scale + off + END_GRAIN_V.
 * Only surface() materials understand the marker (it is a whole number of
 * tiles, but keep it away from other materials' maps).
 */
export const END_GRAIN_V = 1024;

/** Uniforms shared by every material that opts into wind / time effects. */
export const sharedUniforms = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uWindStrength: { value: reducedMotion ? REDUCED_WIND : 1 },
};

// follow the OS setting live (the wind settles / resumes without a reload)
try {
  reducedQuery?.addEventListener?.('change', (e) => setReducedMotion(e.matches));
} catch {
  /* old Safari: no change events on media queries */
}

/** Calm (true) or restore (false) the wind on every wind-swayed material. */
export function setReducedMotion(on) {
  reducedMotion = !!on;
  sharedUniforms.uWindStrength.value = reducedMotion ? REDUCED_WIND : 1;
}

/**
 * Build a toon ramp texture. `steps` are direct-light multipliers sampled by
 * (dot(N, L) * 0.5 + 0.5), i.e. the first half of the array covers surfaces
 * facing away from the light. `smooth` blends neighbouring steps (soft bands).
 */
export function makeGradientMap(steps, { smooth = false } = {}) {
  const data = new Uint8Array(steps.length);
  steps.forEach((v, i) => (data[i] = Math.round(v * 255)));
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RedFormat);
  tex.minFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  tex.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Storybook cel ramp (8 bins over dot(N,L) from −1 to 1): surfaces turned away
 * from the sun get almost no direct light — so their tone matches cast shadows —
 * a soft mid band sits at the terminator, and everything facing the sun is
 * fully lit. The hemisphere + rim lights (world/lighting.js) keep the shaded
 * side warm-cool and readable, never black.
 */
export const toonGradient = makeGradientMap([0.1, 0.1, 0.12, 0.2, 0.58, 0.86, 1.0, 1.0]);

/** Same ramp with soft (linear-filtered) band edges — for big organic surfaces like terrain. */
export const softToonGradient = makeGradientMap([0.1, 0.12, 0.16, 0.3, 0.62, 0.88, 1.0, 1.0], { smooth: true });

function makeGrainTexture() {
  const rnd = createRng('wood-grain');
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  // long wavy growth rings running along V
  for (let i = 0; i < 46; i++) {
    const x0 = rnd.next() * size;
    const shade = 200 + Math.floor(rnd.next() * 45);
    g.strokeStyle = `rgba(${shade - 40},${shade - 55},${shade - 70},${0.18 + rnd.next() * 0.22})`;
    g.lineWidth = 0.6 + rnd.next() * 2.2;
    g.beginPath();
    const amp = 2 + rnd.next() * 6;
    const freq = 0.01 + rnd.next() * 0.03;
    const phase = rnd.next() * 10;
    for (let y = 0; y <= size; y += 4) {
      const x = x0 + Math.sin(y * freq + phase) * amp;
      if (y === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // a couple of soft knots
  for (let k = 0; k < 2; k++) {
    const cx = rnd.next() * size, cy = rnd.next() * size;
    for (let r = 10; r > 1; r -= 2) {
      g.strokeStyle = `rgba(120,85,55,${0.08 + (10 - r) * 0.015})`;
      g.beginPath();
      g.ellipse(cx, cy, r * 0.6, r * 1.4, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

let grainTexture = null;
const cache = new Map();
/** Materials whose emissive intensity follows the day/night cycle. */
const nightGlowMaterials = [];

/** Cache-key replacer: textures, colours and other three.js objects key by identity, never by content. */
function keyReplacer(key, value) {
  if (value && typeof value === 'object') {
    if (value.isTexture) return `tex:${value.uuid}`;
    if (value.isColor) return `col:${value.getHexString()}`;
    if (value.uuid && (value.isMaterial || value.isObject3D || value.isBufferGeometry)) return `obj:${value.uuid}`;
  }
  return value;
}

function keyOf(kind, color, opts) {
  return kind + '|' + new THREE.Color(color).getHexString() + '|' + JSON.stringify(opts || {}, keyReplacer);
}

/** Program cache key of every wind-swayed material (the settings live in a uniform). */
export const WIND_KEY = 'wind';

/**
 * Inject a gentle wind sway into a built-in material's vertex shader.
 * Vertices above `base` (in local Y) sway proportionally to height × strength.
 *
 * strength / base / speed live in a per-material uniform (uWind), NOT in the
 * shader source: every wind setting shares ONE compiled program per material
 * type (cache key 'wind'), instead of one program per distinct setting.
 * The live values: material.userData.wind (a Vector3: strength, base, speed).
 */
export function applyWind(material, { strength = 0.06, base = 0, speed = 1.6 } = {}) {
  const uWind = { value: new THREE.Vector3(strength, base, speed) };
  material.userData.wind = uWind.value;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uWindStrength = sharedUniforms.uWindStrength;
    shader.uniforms.uWind = uWind;
    shader.vertexShader =
      'uniform float uTime;\nuniform float uWindStrength;\nuniform vec3 uWind; // strength, base, speed\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wPos = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wPos = instanceMatrix * wPos;
          #endif
          wPos = modelMatrix * wPos;
          float sway = max(transformed.y - uWind.y, 0.0) * uWind.x * uWindStrength;
          float ph = uTime * uWind.z + wPos.x * 0.17 + wPos.z * 0.13;
          transformed.x += (sin(ph) * 0.8 + sin(ph * 2.7 + 1.3) * 0.2) * sway;
          transformed.z += (cos(ph * 0.83) * 0.6) * sway;
        }`
      );
  };
  material.customProgramCacheKey = () => WIND_KEY;
  return material;
}

export const materials = {
  palette,
  sharedUniforms,
  /** V offset that marks end-grain faces for the wood surfaces (see END_GRAIN_V). */
  END_GRAIN_V,
  gradientMap: toonGradient,
  softGradientMap: softToonGradient,

  /**
   * Cel-shaded material (MeshToonMaterial) — the default look of the village.
   * opts: emissive, emissiveIntensity, transparent, opacity, side,
   *       vertexColors, map, wind: { strength, base, speed }, depthWrite
   * Toon materials have no flatShading: for a faceted look use a non-indexed
   * geometry (geometry.toNonIndexed(); geometry.computeVertexNormals()).
   */
  toon(color = '#ffffff', opts = {}) {
    const key = keyOf('toon', color, { ...opts, map: opts.map ? opts.map.uuid : undefined });
    if (cache.has(key)) return cache.get(key);
    const { wind, name, flatShading, ...rest } = opts; // eslint-disable-line no-unused-vars
    if (rest.emissive !== undefined) rest.emissive = new THREE.Color(rest.emissive);
    const m = new THREE.MeshToonMaterial({
      color: new THREE.Color(color),
      gradientMap: toonGradient,
      ...rest,
    });
    if (wind) applyWind(m, wind);
    m.name = name || `toon-${new THREE.Color(color).getHexString()}`;
    cache.set(key, m);
    return m;
  },

  /** Physically based material for metal, glass, glossy finishes. */
  standard(color = '#ffffff', opts = {}) {
    const key = keyOf('std', color, opts);
    if (cache.has(key)) return cache.get(key);
    const rest = { ...opts };
    if (rest.emissive !== undefined) rest.emissive = new THREE.Color(rest.emissive);
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.6,
      metalness: 0,
      ...rest,
    });
    cache.set(key, m);
    return m;
  },

  /** Unlit material. */
  basic(color = '#ffffff', opts = {}) {
    const key = keyOf('basic', color, opts);
    if (cache.has(key)) return cache.get(key);
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), ...opts });
    cache.set(key, m);
    return m;
  },

  /**
   * Wood: toon shading with a soft procedural grain.
   * `species` is a key of palette (oak, walnut, spruce, ash, cherry, maple) or any colour.
   * Set { grain: false } for tiny parts where grain would just be noise.
   */
  wood(species = 'oak', opts = {}) {
    const color = palette[species] || species;
    const { grain = true, ...rest } = opts;
    if (!grain) return materials.toon(color, rest);
    if (!grainTexture) grainTexture = makeGrainTexture();
    return materials.toon(color, { ...rest, map: grainTexture, name: `wood-${species}` });
  },

  /**
   * Emissive material that glows softly by day and brightly at night
   * (windows, lanterns, screens, mushrooms). Day/night intensities are tunable.
   */
  glow(color = palette.windowGlow, { day = 0.25, night = 1.6, toon = false } = {}) {
    const key = keyOf('glow', color, { day, night, toon });
    if (cache.has(key)) return cache.get(key);
    const c = new THREE.Color(color);
    const m = toon
      ? new THREE.MeshToonMaterial({ color: c, emissive: c, emissiveIntensity: day, gradientMap: toonGradient })
      : new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: day, roughness: 0.9 });
    m.userData.glow = { day, night };
    nightGlowMaterials.push(m);
    cache.set(key, m);
    return m;
  },

  /**
   * Painterly physically-based SURFACES for the detailed glen. Builders ask for
   * a surface by KIND and get a cached material with baked procedural maps
   * (albedo, normal, roughness, AO), painterly colour breakup and optional moss.
   *
   * Kinds (mapping in brackets — triplanar needs no UVs, it is WORLD space, so
   * use it for static things; uv kinds need UVs, see boxUV()):
   *   bark [tri]      deep vertical furrows, fibrous plates, lichen
   *   wood [uv]       opts.species = oak|walnut|spruce|ash|cherry|maple; opts.planks → boards with seams.
   *                   Grain runs along U (opts.grain = 'v' to run along V). Scale: one UV unit =
   *                   1.4 world units (boxUV's tile) → ~8–11 growth rings per 10 cm, pores, light
   *                   ray flecks (opts.rays, default per species: oak 1, spruce 0). Faces marked with
   *                   END_GRAIN_V (boxUV does it) render as darker end grain with ring arcs.
   *   timber [uv]     weathered, silvered beams with drying checks (grain along U); end grain too
   *   shingles [uv]   wooden shakes in rows, V = up the roof (U around a cone)
   *   thatch [uv]     straw layers, V = up the roof
   *   plaster [uv]    mottled lime plaster, hairline cracks, stones peeking through
   *   stone [tri]     a single field / dressed stone's face: grain, pits, a rare hairline crack,
   *                   worn pale edges, chips, lichen — for individually modelled stones
   *   masonry [tri]   fieldstone WALL texture (stones + recessed mortar) for flat wall shells
   *   cobble [tri]    rounded cobbles, soil & moss in the joints
   *   rock [tri]      layered mossy boulders/cliffs (mossy 0.35 by default)
   *   moss [tri]      velvety cushions          soil [tri]  humus, pebbles, twigs, fallen leaves
   *   mushroomCap [uv] velvety cap; opts.color tints. U = around, V = 0 at the RIM → 1 at the APEX
   *                   (ConeGeometry already works; for a Lathe list the profile from rim to apex)
   *   mushroomStem [uv] fibrous cream with snakeskin scales; U around, V up
   *   gills [uv]      radial lamellae. Default expects DISC UVs (CircleGeometry / RingGeometry);
   *                   opts.gills = 'cone' for a ConeGeometry underside (U = angle, apex = stem)
   *   leaf [uv]       one leaf over the UV square (base V=0, tip V=1, midrib U=0.5)
   *   fabric [uv]     plain weave (opts.color)   rope [uv] twisted strands (TubeGeometry UVs)
   *   metal [tri]     forged iron with rust (opts.color)   glass [uv] old crown glass (transparent)
   *   paper [uv]      clay [uv] terracotta with throwing rings (opts.color)
   *
   * opts: {
   *   color      tint: for colorize kinds (wood, mushroomCap, fabric, metal, clay) the base colour;
   *              for the others the texture's average colour is shifted to this colour
   *   species    wood species          planks  boards with seams (wood)
   *   mossy      0..1 moss creeping over up-facing surfaces, filling crevices first
   *   triplanar  force (true) or disable (false) world-space triplanar mapping
   *   scale      texture scale multiplier (2 = features twice as big)
   *   repeat     uv kinds: number or [u, v] repeats over the UV range (for 0..1 primitive UVs)
   *   grain      'u' (default) | 'v' — which UV axis the wood grain / fibres follow
   *   swapUV     same as grain: 'v' — swaps U and V for any uv kind (e.g. bark with
   *              triplanar: false on a TubeGeometry branch: furrows then run along the tube)
   *   vertexColors  multiply by vertex colours (the texture is normalised to average white)
   *   bump       normal-map strength multiplier     breakup  painterly colour variation (0 = off)
   *   mossGain   brightness of the moss overlay (1). The moss ignores vertex colours: a
   *              vertex-coloured mossy rock gets the same velvet moss as any other surface
   *   rays       wood: strength of the ray flecks (species default; 0 = none)
   *   side, transparent, opacity, wind: { strength, base, speed }, roughness (multiplier)
   * }
   * Note: triplanar kinds sample WORLD space — an object that moves will swim
   * through its texture (pass triplanar: false and give it UVs instead).
   */
  surface(kind = 'stone', opts = {}) {
    const key = keyOf('surface:' + kind, opts.color ?? '#ffffff', opts);
    if (cache.has(key)) return cache.get(key);
    const m = makeSurface(kind, opts);
    m.name = `surface-${kind}`;
    cache.set(key, m);
    return m;
  },

  /**
   * Foliage for leaf-card clusters (alpha-tested leaf textures on quads):
   * opts { color, variant: 'oak'|'fern'|'ivy'|'grass'|'needle'|'blossom',
   *        wind: { strength, base, speed }, translucency (0..1.5, default 0.8),
   *        volume (default true: keep geometry normals on back faces — use with
   *        foliageNormals()), alphaTest (0.5), vertexColors }
   *
   * CARD CONVENTION: every card texture has its stem at the BOTTOM CENTRE of the
   * UV square (u 0.5, v 0) and grows towards +V. Build cards as quads whose
   * bottom edge sits at the branch, tilt them outwards/upwards, cross 2–3
   * cards per tuft, and call materials.foliageNormals(geometry, clusterCentre)
   * so the whole cluster shades like one soft volume. Leaves glow when lit from
   * behind (sun and lantern point lights), shadow-aware.
   */
  foliage(opts = {}) {
    const key = keyOf('foliage', opts.color ?? palette.leaf, opts);
    if (cache.has(key)) return cache.get(key);
    const m = makeFoliage(opts);
    cache.set(key, m);
    return m;
  },

  /**
   * Give the texture bakery the renderer (call once at boot, right after the
   * engine exists: materials.setRenderer(engine.renderer, engine.quality)).
   * Maps are then baked as soon as they are first requested. Without it, the
   * first surface drawn bakes everything pending in that frame.
   * quality.tier 'low' halves the texture resolution.
   */
  setRenderer(renderer, quality = null) {
    if (quality?.tier === 'low') {
      setBakeScale(0.5);
      lite = true;
    }
    if (typeof quality?.reducedMotion === 'boolean' && quality.reducedMotion) setReducedMotion(true);
    setBakeRenderer(renderer);
  },

  /**
   * Reduced motion: wind sway drops to a faint breathing (REDUCED_WIND). Read
   * from prefers-reduced-motion automatically; call this to force it (e.g.
   * materials.setReducedMotion(engine.reducedMotion)).
   */
  setReducedMotion(on) {
    setReducedMotion(on);
  },

  /** True while wind is calmed for reduced motion. */
  get reducedMotion() {
    return reducedMotion;
  },

  /** The live per-material uniforms of a surface/foliage material (look-dev & debugging). */
  surfaceUniforms(material) {
    return patchedUniforms.get(material) ?? null;
  },

  /** Request (and bake, if a renderer is known) the maps of these kinds up front. */
  prewarm(kinds = Object.keys(KINDS)) {
    for (const k of kinds) surfaceMaps(k);
  },

  /** Raw baked maps of a kind for custom shaders: { map (albedo+height), detail (normal.xy, rough, ao) }. */
  surfaceMaps(kind) {
    const e = surfaceMaps(kind);
    return { map: e.map, detail: e.detail, tile: KINDS[kind]?.tile ?? 1, colorize: KINDS[kind]?.mode === 'colorize' };
  },

  /** Alpha card texture of a foliage variant (sRGB + alpha) for custom shaders. */
  foliageMap(variant = 'oak') {
    return foliageMap(variant);
  },

  /** Natural tile size (world units per texture repeat) of a kind. */
  tileOf(kind) {
    return KINDS[kind]?.tile ?? 1;
  },

  /**
   * Box-project world-sized UVs onto a geometry (in its own object space):
   * each vertex is projected along its dominant normal axis and divided by the
   * tile size, so textures keep the same density on every face and every box
   * size. `tile` is a number or a surface kind ('shingles' → its natural tile).
   * opts.grain: 'x' | 'y' | 'z' | 'auto' (longest bbox axis) — the axis the
   * texture's U (wood grain, shingle rows' run) follows wherever possible.
   * Faces across the grain get the END_GRAIN_V marker (wood/timber draw them
   * as end grain; every other surface ignores it) unless opts.endGrain = false.
   * Returns the geometry. Apply before merging/transforming parts.
   */
  boxUV(geometry, tile = 1, { grain = 'auto', offset = [0, 0], endGrain = true } = {}) {
    return boxUV(geometry, typeof tile === 'string' ? KINDS[tile]?.tile ?? 1 : tile, grain, offset, endGrain);
  },

  /**
   * Soft volumetric normals for foliage cards: blends each vertex normal
   * towards the direction from `center` (default: bbox centre) — the cluster
   * then shades like one fluffy volume instead of flat planes.
   */
  foliageNormals(geometry, center = null, blend = 0.85) {
    return foliageNormals(geometry, center, blend);
  },

  /** Bake statistics: { bakes, ms, mb, maps, programs, pending }. */
  textureStats() {
    return bakeStats();
  },

  /** Look-dev: average sRGB colour of a kind's baked albedo. */
  measureMean(kind) {
    return measureMean(`surface:${kind}`);
  },

  /** Called every frame by the environment system. */
  update(dt, t, night) {
    sharedUniforms.uTime.value = t;
    sharedUniforms.uNight.value = night;
    for (const m of nightGlowMaterials) {
      const { day, night: n } = m.userData.glow;
      m.emissiveIntensity = day + (n - day) * night;
    }
  },

  /** Number of distinct cached materials (debug). */
  get count() {
    return cache.size;
  },
};

// ─── surface / foliage implementations ──────────────────────────────────────
const WHITE = new THREE.Color(1, 1, 1);

/** First surface/foliage material drawn hands its renderer to the bakery (unless setRenderer was called). */
function captureRenderer(renderer) {
  if (hasBakeRenderer()) return;
  // the engine only turns antialiasing off on the 'low' tier → half-res maps there
  try {
    if (renderer.getContext().getContextAttributes()?.antialias === false) setBakeScale(0.5);
  } catch {
    /* keep full resolution */
  }
  setBakeRenderer(renderer);
}

/** Per-material uniform sets (kept out of userData so materials stay JSON/clone friendly). */
const patchedUniforms = new WeakMap();

function cloneUniforms(u) {
  const out = {};
  for (const [k, v] of Object.entries(u)) out[k] = { value: v.value?.isTexture ? v.value : v.value?.clone ? v.value.clone() : v.value };
  return out;
}

/**
 * Install a shader patch (+ optional wind) on a material, with a stable
 * program cache key, and make .clone() carry the patch (with its own uniforms).
 */
function installPatch(m, patch, u, progKey, wind) {
  patchedUniforms.set(m, u);
  m.onBeforeCompile = (shader) => patch(shader, u);
  m.onBeforeRender = captureRenderer;
  if (wind) applyWind(m, wind);
  const windKey = wind ? m.customProgramCacheKey() : '';
  m.customProgramCacheKey = () => progKey + windKey;
  m.clone = function () {
    const c = new this.constructor().copy(this);
    c.defines = { ...this.defines }; // MeshStandardMaterial.copy resets defines
    installPatch(c, patch, cloneUniforms(u), progKey, wind);
    return c;
  };
  return m;
}

function lin(hex) {
  return new THREE.Color(hex);
}

/** Per-channel ratio target/mean (linear), clamped — re-tints an rgb texture towards a colour. */
function tintFor(color, mean) {
  const t = new THREE.Color(color);
  const m = new THREE.Color(mean);
  return new THREE.Color(
    THREE.MathUtils.clamp(t.r / Math.max(m.r, 0.004), 0, 4),
    THREE.MathUtils.clamp(t.g / Math.max(m.g, 0.004), 0, 4),
    THREE.MathUtils.clamp(t.b / Math.max(m.b, 0.004), 0, 4),
  );
}

/** Colorize presets: { a: light, b: dark, c: accent } as linear Colors. */
function colorizeColors(kind, opts) {
  if (kind === 'wood' || kind === 'woodPlanks') {
    const sp = WOOD_SPECIES[opts.species] ?? null;
    if (sp && opts.color === undefined) return { a: lin(sp.a), b: lin(sp.b), c: lin(sp.c) };
    const base = lin(opts.color ?? palette[opts.species] ?? WOOD_SPECIES.oak.a);
    // late wood darker AND a little redder-browner than early wood (as in real
    // wood) — on the shared vertex-coloured wood this is what keeps the grain
    // from reading as a flat blond plywood under the warm grade
    const late = new THREE.Color(1.08, 0.9, 0.72);
    return { a: base.clone().multiplyScalar(1.05), b: base.clone().multiplyScalar(0.52).multiply(late), c: base.clone().multiplyScalar(0.24).multiply(late) };
  }
  if (kind === 'mushroomCap') {
    const base = lin(opts.color ?? '#c4301f');
    const a = base.clone().lerp(lin('#ff9a48'), 0.22).multiplyScalar(1.12);
    const b = base.clone().multiplyScalar(0.42).lerp(lin('#3a0c08'), 0.25);
    return { a, b, c: lin(opts.accent ?? '#efe2c6') };
  }
  if (kind === 'metal') {
    const base = lin(opts.color ?? '#55595e');
    return { a: base, b: base.clone().multiplyScalar(0.45), c: lin('#8a4a22') };
  }
  if (kind === 'clay') {
    const base = lin(opts.color ?? '#b5633e');
    return { a: base, b: base.clone().multiplyScalar(0.62).lerp(lin('#6a2e1a'), 0.2), c: base.clone().lerp(lin('#e8c8a8'), 0.55) };
  }
  // fabric & anything else
  const base = lin(opts.color ?? '#c9b79a');
  return { a: base, b: base.clone().multiplyScalar(0.55), c: base.clone().lerp(WHITE, 0.35) };
}

let _mossMaps = null;
/** Low tier: cheaper surface shader (no painterly breakup noise). Set by setRenderer(r, { tier: 'low' }). */
let lite = false;

/** Expected linear mean of an rgb kind's albedo after the material's tint (for the bark sun lift). */
function meanLum(kd, colA) {
  const m = new THREE.Color(kd.mean ?? '#808080');
  return 0.2126 * m.r * colA.r + 0.7152 * m.g * colA.g + 0.0722 * m.b * colA.b;
}

function makeSurface(kindIn, opts) {
  let kind = KINDS[kindIn] && kindIn !== 'woodPlanks' ? kindIn : 'stone';
  if (kind === 'wood' && opts.planks) kind = 'woodPlanks';
  const kd = KINDS[kind];
  const maps = surfaceMaps(kind);
  const triplanar = opts.triplanar ?? kd.mapping === 'triplanar';
  const colorize = kd.mode === 'colorize';
  const mossy = THREE.MathUtils.clamp(opts.mossy ?? kd.mossy ?? 0, 0, 1);
  const moss = mossy > 0 && kind !== 'moss';
  const scale = opts.scale ?? 1;

  let colA, colB, colC;
  if (colorize) {
    ({ a: colA, b: colB, c: colC } = colorizeColors(kind, opts));
    if (opts.vertexColors) {
      // normalise so the texture averages to white and the vertex colour sets the hue
      const mean = (colA.r + colA.g + colA.b + colB.r + colB.g + colB.b) / 6 || 1;
      colA.multiplyScalar(1 / mean); colB.multiplyScalar(1 / mean); colC.multiplyScalar(1 / mean);
    }
  } else {
    colA = opts.vertexColors ? tintFor('#ffffff', kd.mean) : opts.color !== undefined ? tintFor(opts.color, kd.mean) : WHITE.clone();
    colB = WHITE.clone();
    colC = WHITE.clone();
  }

  // wood: end grain + ray flecks (uv-mapped only: the end-grain marker lives in the UVs)
  const woody = !!kd.woody && !triplanar;
  const isWood = kind === 'wood' || kind === 'woodPlanks';
  const sp = WOOD_SPECIES[opts.species];
  const rays = woody ? opts.rays ?? (isWood ? (sp && opts.color === undefined ? sp.rays : opts.species === 'oak' ? 1 : 0.55) : 0.5) : 0;

  const rep = opts.repeat ?? 1;
  // kd.aspect: the map covers `aspect` tiles along V (e.g. bark: tall 1:2 map → no short vertical repeat)
  const aspect = kd.aspect ?? 1;
  const tile = triplanar
    ? new THREE.Vector2(1 / (kd.tile * scale), 1 / aspect)
    : new THREE.Vector2(...(Array.isArray(rep) ? rep : [rep, rep])).multiplyScalar(1 / scale);
  if (!triplanar) tile.y /= aspect;

  const u = {
    sfMap: { value: maps.map },
    sfDetail: { value: maps.detail },
    sfColA: { value: colA },
    sfColB: { value: colB },
    sfColC: { value: colC },
    sfTile: { value: tile },
    sfP: { value: new THREE.Vector4((kd.normal ?? 1) * (opts.bump ?? 1), kd.ao ?? 1, opts.roughness ?? 1, opts.breakup ?? kd.breakup ?? 1) },
    sfQ: { value: new THREE.Vector4(mossy, 1 / (KINDS.moss.tile * 0.9), kd.velvet ?? 0, kd.metalRust ?? 0) },
    sfR: { value: new THREE.Vector4(opts.grain === 'v' || opts.swapUV ? 1 : 0, kd.polar ? (opts.gills === 'cone' ? 2 : 1) : 0, opts.metalness ?? kd.metalness ?? 0, triplanar ? kd.antiTile ?? 0 : 0) },
    sfLight: { value: new THREE.Vector4(opts.wrap ?? kd.wrap ?? 0, 0, 0, 0) },
    sfS: { value: new THREE.Vector4(opts.mossGain ?? 1, rays, 1, kind === 'bark' ? 0.4 * meanLum(kd, colA) : 0) },
  };
  if (moss) {
    _mossMaps ??= surfaceMaps('moss');
    u.sfMossMap = { value: _mossMaps.map };
    u.sfMossDetail = { value: _mossMaps.detail };
  }

  const m = new THREE.MeshStandardMaterial({
    color: WHITE.clone(),
    roughness: 1,
    metalness: 0,
    vertexColors: !!opts.vertexColors,
    transparent: opts.transparent ?? kd.transparent ?? false,
    opacity: opts.opacity ?? kd.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    depthWrite: !(opts.transparent ?? kd.transparent ?? false),
  });
  const defines = {};
  if (triplanar) defines.SF_TRIPLANAR = '';
  else defines.USE_UV = '';
  if (colorize) defines.SF_COLORIZE = '';
  if (moss) defines.SF_MOSS = '';
  if (lite) defines.SF_LITE = '';
  if (woody) defines.SF_WOOD = '';
  if (kind === 'bark') defines.SF_BARK = '';
  m.defines = { ...m.defines, ...defines }; // keep STANDARD
  m.userData.surface = { kind };
  installPatch(m, patchSurface, u, `sf|${triplanar ? 't' : 'u'}${colorize ? 'c' : ''}${moss ? 'm' : ''}${lite ? 'l' : ''}${woody ? 'w' : ''}${kind === 'bark' ? 'b' : ''}`, opts.wind);
  return m;
}

function makeFoliage(opts) {
  const variant = FOLIAGE_VARIANTS[opts.variant] ? opts.variant : 'oak';
  const ref = FOLIAGE_VARIANTS[variant].ref;
  const map = foliageMap(variant);
  const tint = opts.vertexColors ? tintFor('#ffffff', ref) : opts.color !== undefined ? tintFor(opts.color, ref) : WHITE.clone();
  const m = new THREE.MeshStandardMaterial({
    map,
    color: tint,
    roughness: opts.roughness ?? 0.78,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaTest: opts.alphaTest ?? 0.5,
    alphaToCoverage: true,
    vertexColors: !!opts.vertexColors,
  });
  m.shadowSide = THREE.DoubleSide;
  const u = {
    sfLight: { value: new THREE.Vector4(opts.wrap ?? 0.6, opts.translucency ?? 0.8, 0, 0) },
    sfFol: { value: new THREE.Vector4(opts.volume === false ? 0 : 1, opts.breakup ?? 1, 0, 0) },
  };
  m.userData.foliage = { variant };
  m.name = `foliage-${variant}`;
  installPatch(m, patchFoliage, u, 'foliage|', opts.wind);
  // Shadow pass: a depth material that keeps leaf coverage at any shadow-map
  // footprint (mip alpha would otherwise average away and thin the shadows)
  // and sways with the same wind as the leaves. Handed to each mesh the first
  // time it is drawn (three.js copies map / alphaTest / side onto it).
  const depth = foliageDepthMaterial(opts.wind);
  m.onBeforeRender = (renderer, scene, camera, geometry, object) => {
    captureRenderer(renderer);
    if (object && object.customDepthMaterial === undefined && !Array.isArray(object.material)) object.customDepthMaterial = depth;
  };
  const baseClone = m.clone;
  m.clone = function () {
    const c = baseClone.call(this);
    c.onBeforeRender = this.onBeforeRender;
    return c;
  };
  return m;
}

const depthMaterials = new Map();
function foliageDepthMaterial(wind) {
  const key = wind ? `${wind.strength ?? 0.06}|${wind.base ?? 0}|${wind.speed ?? 1.6}` : '-';
  if (depthMaterials.has(key)) return depthMaterials.get(key);
  const d = new THREE.MeshDepthMaterial();
  d.name = 'foliage-depth';
  d.onBeforeCompile = (shader) => patchFoliageDepth(shader);
  if (wind) applyWind(d, wind);
  const windKey = wind ? d.customProgramCacheKey() : '';
  d.customProgramCacheKey = () => 'foliage-depth|' + windKey;
  depthMaterials.set(key, d);
  return d;
}

// ─── geometry helpers ───────────────────────────────────────────────────────
const AXES = ['x', 'y', 'z'];

function boxUV(geometry, tile, grain, offset, endGrain = true) {
  const pos = geometry.attributes.position;
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const nrm = geometry.attributes.normal;
  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox.getSize(size);
  let g = grain;
  if (g === 'auto' || !AXES.includes(g)) g = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  const gi = AXES.indexOf(g);
  const uv = new Float32Array(pos.count * 2);
  const p = [0, 0, 0];
  const n = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    p[0] = pos.getX(i); p[1] = pos.getY(i); p[2] = pos.getZ(i);
    n[0] = Math.abs(nrm.getX(i)); n[1] = Math.abs(nrm.getY(i)); n[2] = Math.abs(nrm.getZ(i));
    const dom = n[0] >= n[1] && n[0] >= n[2] ? 0 : n[1] >= n[2] ? 1 : 2;
    const others = [0, 1, 2].filter((a) => a !== dom);
    // U follows the grain axis when it lies in this face; otherwise the longer remaining axis
    let ua, va;
    if (others.includes(gi)) {
      ua = gi;
      va = others.find((a) => a !== gi);
    } else {
      ua = size.getComponent(others[0]) >= size.getComponent(others[1]) ? others[0] : others[1];
      va = others.find((a) => a !== ua);
    }
    // vertical faces: V runs up (Y) whenever Y is one of the face axes
    if (dom !== 1 && ua === 1 && gi !== 1) [ua, va] = [va, ua];
    uv[i * 2] = p[ua] / tile + offset[0];
    uv[i * 2 + 1] = p[va] / tile + offset[1] + (endGrain && dom === gi ? END_GRAIN_V : 0);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

function foliageNormals(geometry, center, blend) {
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  if (!center) {
    geometry.computeBoundingBox();
    center = geometry.boundingBox.getCenter(new THREE.Vector3());
  }
  const v = new THREE.Vector3();
  const nn = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(center);
    v.y += 0.25 * v.length(); // bias upwards: canopies are lit from above
    v.normalize();
    nn.fromBufferAttribute(nrm, i);
    // flip face normal to the outward side before blending (cards are double-sided)
    if (nn.dot(v) < 0) nn.negate();
    nn.lerp(v, blend).normalize();
    nrm.setXYZ(i, nn.x, nn.y, nn.z);
  }
  nrm.needsUpdate = true;
  return geometry;
}

export default materials;
