// ─────────────────────────────────────────────────────────────────────────────
// Shared materials. ALWAYS get materials from here so they are cached and
// re-used (fewer shader programs, fewer state changes) and so day/night & wind
// stay in sync across the whole world.
//
//   materials.toon('#e2553f')                       → soft cel-shaded look (default)
//   materials.toon(palette.leaf, { wind: { strength: 0.08, base: 0.5 } })
//   materials.wood('walnut')                        → toon + subtle procedural grain
//   materials.standard(palette.metal, { metalness: 0.6, roughness: 0.35 })
//   materials.glow(palette.windowGlow)              → emissive, brighter at night
//   materials.basic('#fff')                         → unlit
//
// Cached materials are SHARED: never mutate a material you got from here
// (colour, emissive, opacity …). Ask for a different key instead, or call
// .clone() if you truly need a unique animated material.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { palette } from './palette.js';
import { createRng } from './rng.js';

/** Uniforms shared by every material that opts into wind / time effects. */
export const sharedUniforms = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uWindStrength: { value: 1 },
};

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

function keyOf(kind, color, opts) {
  return kind + '|' + new THREE.Color(color).getHexString() + '|' + JSON.stringify(opts || {});
}

/**
 * Inject a gentle wind sway into a built-in material's vertex shader.
 * Vertices above `base` (in local Y) sway proportionally to height × strength.
 */
export function applyWind(material, { strength = 0.06, base = 0, speed = 1.6 } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uWindStrength = sharedUniforms.uWindStrength;
    shader.vertexShader =
      'uniform float uTime;\nuniform float uWindStrength;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wPos = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wPos = instanceMatrix * wPos;
          #endif
          wPos = modelMatrix * wPos;
          float sway = max(transformed.y - ${base.toFixed(3)}, 0.0) * ${strength.toFixed(4)} * uWindStrength;
          float ph = uTime * ${speed.toFixed(3)} + wPos.x * 0.17 + wPos.z * 0.13;
          transformed.x += (sin(ph) * 0.8 + sin(ph * 2.7 + 1.3) * 0.2) * sway;
          transformed.z += (cos(ph * 0.83) * 0.6) * sway;
        }`
      );
  };
  material.customProgramCacheKey = () => `wind-${strength}-${base}-${speed}`;
  return material;
}

export const materials = {
  palette,
  sharedUniforms,
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
   * a surface by KIND and get a cached material; the atmosphere/look-dev builder
   * owns how each kind looks (procedural textures, triplanar mapping, moss on
   * up-facing faces, colour breakup …). Kinds:
   *   bark, wood (planks/joinery; opts.species = oak|walnut|spruce|ash|cherry|maple),
   *   timber (weathered structural beams), shingles, plaster, stone, cobble,
   *   rock (big mossy boulders/cliffs), moss, soil, mushroomCap (opts.color),
   *   mushroomStem, gills, leaf (solid leaves/ivy), fabric (opts.color), rope,
   *   metal (opts.color), glass, paper, thatch, clay (pots, roof tiles; opts.color)
   * opts: { color, species, mossy (0..1 amount of moss creeping on top faces),
   *         side, transparent, opacity }
   * Geometry needs UVs for wood/shingles/plaster; organic kinds (bark, rock,
   * stone, moss, soil) work without (triplanar).
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
   * opts { color, variant: 'oak'|'fern'|'ivy'|'grass'|'needle'|'blossom', wind: { strength, base } }.
   * Owned by the look-dev builder (alpha test, two-sided, soft translucency).
   */
  foliage(opts = {}) {
    const key = keyOf('foliage', opts.color ?? palette.leaf, opts);
    if (cache.has(key)) return cache.get(key);
    const m = makeFoliage(opts);
    cache.set(key, m);
    return m;
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

// ─── PLACEHOLDER surface / foliage implementations ──────────────────────────
// Flat-coloured stand-ins so builders can work before the look-dev pass.
const SURFACE_DEFAULTS = {
  bark: { color: '#6e4f3a', roughness: 0.95 },
  wood: { color: palette.oak, roughness: 0.75 },
  timber: { color: '#7a5a40', roughness: 0.9 },
  shingles: { color: '#8a5a3b', roughness: 0.9 },
  plaster: { color: '#efe2c4', roughness: 0.95 },
  stone: { color: '#a9a296', roughness: 0.95 },
  cobble: { color: '#9d968a', roughness: 0.95 },
  rock: { color: '#8c877c', roughness: 1 },
  moss: { color: '#6f8f3a', roughness: 1 },
  soil: { color: '#7a5b3e', roughness: 1 },
  mushroomCap: { color: '#c9352a', roughness: 0.6 },
  mushroomStem: { color: '#efe4cc', roughness: 0.85 },
  gills: { color: '#e6d3b0', roughness: 0.9 },
  leaf: { color: '#4f7f36', roughness: 0.8 },
  fabric: { color: '#c9b79a', roughness: 1 },
  rope: { color: '#b89b6a', roughness: 1 },
  metal: { color: '#6b6f73', roughness: 0.45, metalness: 0.8 },
  glass: { color: '#cfe8f0', roughness: 0.1, transparent: true, opacity: 0.35 },
  paper: { color: '#f3ead6', roughness: 1 },
  thatch: { color: '#b9955a', roughness: 1 },
  clay: { color: '#b8653f', roughness: 0.85 },
};

function makeSurface(kind, opts) {
  const d = SURFACE_DEFAULTS[kind] ?? SURFACE_DEFAULTS.stone;
  const color = opts.color ?? (kind === 'wood' && opts.species ? palette[opts.species] ?? d.color : d.color);
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: d.roughness,
    metalness: d.metalness ?? 0,
    transparent: opts.transparent ?? d.transparent ?? false,
    opacity: opts.opacity ?? d.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  });
}

function makeFoliage(opts) {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.color ?? palette.leaf),
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  if (opts.wind) applyWind(m, opts.wind);
  return m;
}

export default materials;
