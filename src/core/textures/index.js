// ─────────────────────────────────────────────────────────────────────────────
// Procedural texture factory — public entry for src/core/materials.js (and for
// any custom shader that wants the same painted maps, e.g. terrain or water):
//
//   import { surfaceMaps, foliageMap, KINDS } from '../core/textures/index.js';
//   const { map, detail } = surfaceMaps('moss');
//     map    : RGB albedo (sRGB) — or control channels for colorize kinds — + height in A
//     detail : normal.xy (tangent space, 0.5-centred) | roughness | ambient occlusion
//   foliageMap('fern') → sRGB colour + alpha leaf-card texture
//
// Maps are baked on the GPU (see bakery.js), cached for the whole session and
// shared by every material that uses the same kind/variant.
// ─────────────────────────────────────────────────────────────────────────────
import { requestBake, setBakeRenderer, setBakeScale, hasBakeRenderer, flushBakes, bakeStats, measureMean } from './bakery.js';
import { SURFACE_GLSL } from './surfaces.glsl.js';
import { FOLIAGE_GLSL, FOLIAGE_VARIANTS } from './foliage.glsl.js';

export { setBakeRenderer, setBakeScale, hasBakeRenderer, flushBakes, bakeStats, measureMean, FOLIAGE_VARIANTS };

/**
 * Per-kind recipe.
 *   bake:  mode ('rgb' | 'colorize'), size, bump (relief depth, fraction of a tile), cavity (crevice darkening),
 *          bumpAspect (texels per tile along V ÷ along U, for maps that are finer across one axis)
 *   look:  mapping ('triplanar' | 'uv'), tile (world units per texture tile, for triplanar and boxUV),
 *          aspect (the map spans `aspect` tiles along V — a tall map hides vertical repeats),
 *          antiTile (triplanar: slow world-space warp, in tiles, so repeats never line up),
 *          roughness / metalness multipliers, normal (strength), ao (strength), breakup (painterly
 *          colour variation), velvet (soft rim sheen), wrap (soft terminator), mossy (default amount)
 *   mean:  average sRGB colour of the baked albedo — opts.color re-tints relative to it
 */
export const KINDS = {
  bark: { mode: 'rgb', size: [512, 1024], aspect: 2, antiTile: 0.6, bump: 0.05, cavity: 1.5, mapping: 'triplanar', tile: 3.2, normal: 1.2, ao: 1, breakup: 1, wrap: 0.15, mean: '#6a5845' },
  // wood: the map is twice as fine ACROSS the grain (V), where the growth rings are
  // (~90–110 rings per world unit → 8–11 on a 10 cm board); bumpAspect keeps the
  // baked normals isotropic on those non-square texels. woody: end grain + ray flecks.
  wood: { mode: 'colorize', size: [512, 1024], bumpAspect: 2, bump: 0.003, cavity: 1.2, mapping: 'uv', tile: 1.4, normal: 0.8, ao: 0.8, breakup: 0.5, wrap: 0.1, woody: true },
  woodPlanks: { glsl: 'wood', defines: '#define WOOD_PLANKS\n', mode: 'colorize', size: [512, 1024], bumpAspect: 2, bump: 0.003, cavity: 1.2, mapping: 'uv', tile: 1.6, normal: 0.9, ao: 1, breakup: 0.5, wrap: 0.1, woody: true },
  timber: { mode: 'rgb', size: [512, 512], bump: 0.012, cavity: 2, mapping: 'uv', tile: 1.6, normal: 1, ao: 1, breakup: 0.8, wrap: 0.1, mean: '#755d48', woody: true },
  shingles: { mode: 'rgb', size: [512, 512], bump: 0.035, cavity: 1.5, mapping: 'uv', tile: 1.4, normal: 1.2, ao: 1, breakup: 0.9, wrap: 0.1, mean: '#694e3b' },
  plaster: { mode: 'rgb', size: [512, 512], bump: 0.006, cavity: 2, mapping: 'uv', tile: 2.2, normal: 0.9, ao: 0.8, breakup: 0.8, wrap: 0.2, mean: '#ede1c6' },
  stone: { mode: 'rgb', size: [512, 512], bump: 0.04, cavity: 1.6, mapping: 'triplanar', tile: 2, normal: 1.2, ao: 1, breakup: 0.8, wrap: 0.1, mean: '#867d6e' },
  masonry: { mode: 'rgb', size: [512, 512], bump: 0.045, cavity: 1.8, mapping: 'triplanar', tile: 2, normal: 1.25, ao: 1, breakup: 0.8, wrap: 0.1, mean: '#867d6e' },
  cobble: { mode: 'rgb', size: [512, 512], bump: 0.035, cavity: 0.9, mapping: 'triplanar', tile: 1.8, normal: 1.1, ao: 1, breakup: 0.8, wrap: 0.1, mean: '#8c8671' },
  rock: { mode: 'rgb', size: [512, 512], bump: 0.05, cavity: 2, mapping: 'triplanar', tile: 5, normal: 1.1, ao: 1, breakup: 1, wrap: 0.1, mossy: 0.35, mean: '#8c8a82' },
  moss: { mode: 'rgb', size: [512, 512], bump: 0.025, cavity: 1.1, mapping: 'triplanar', tile: 1.3, normal: 1, ao: 1, breakup: 1.2, velvet: 0.6, wrap: 0.35, mean: '#597320' },
  soil: { mode: 'rgb', size: [512, 512], bump: 0.02, cavity: 2, mapping: 'triplanar', tile: 2.2, normal: 1, ao: 1, breakup: 1, wrap: 0.15, mean: '#503720' },
  mushroomCap: { mode: 'colorize', size: [512, 512], bump: 0.008, cavity: 1, mapping: 'uv', tile: 1, wrapT: 'clamp', normal: 0.8, ao: 0.5, breakup: 0.6, velvet: 0.35, wrap: 0.25 },
  mushroomStem: { mode: 'rgb', size: [512, 512], bump: 0.01, cavity: 1.5, mapping: 'uv', tile: 1, normal: 0.9, ao: 0.8, breakup: 0.7, velvet: 0.15, wrap: 0.3, mean: '#e1d5bb' },
  gills: { mode: 'rgb', size: [1024, 256], bump: 0.006, cavity: 1, mapping: 'uv', tile: 1, polar: true, normal: 1, ao: 1, breakup: 0.5, wrap: 0.3, mean: '#baa889' },
  leaf: { mode: 'rgb', size: [256, 256], bump: 0.006, cavity: 1, mapping: 'uv', tile: 1, normal: 1, ao: 0.5, breakup: 1, wrap: 0.4, mean: '#598333' },
  fabric: { mode: 'colorize', size: [256, 256], bump: 0.01, cavity: 1, mapping: 'uv', tile: 0.5, normal: 0.8, ao: 0.6, breakup: 0.6, velvet: 0.3, wrap: 0.3 },
  rope: { mode: 'rgb', size: [256, 256], bump: 0.03, cavity: 1, mapping: 'uv', tile: 1, normal: 1, ao: 1, breakup: 0.6, wrap: 0.2, mean: '#947d55' },
  metal: { mode: 'colorize', size: [256, 256], bump: 0.006, cavity: 1, mapping: 'triplanar', tile: 0.7, normal: 0.8, ao: 0.6, breakup: 0.4, metalness: 0.65, metalRust: 1 },
  glass: { mode: 'rgb', size: [256, 256], bump: 0.004, cavity: 0, mapping: 'uv', tile: 1, normal: 0.6, ao: 0, breakup: 0.2, transparent: true, opacity: 0.35, mean: '#d3e6de' },
  paper: { mode: 'rgb', size: [256, 256], bump: 0.002, cavity: 0.5, mapping: 'uv', tile: 1, normal: 0.6, ao: 0.4, breakup: 0.3, wrap: 0.3, mean: '#eae0c9' },
  thatch: { mode: 'rgb', size: [512, 512], bump: 0.045, cavity: 1.5, mapping: 'uv', tile: 1.6, normal: 1.1, ao: 1, breakup: 1, wrap: 0.2, mean: '#908056' },
  clay: { mode: 'colorize', size: [256, 256], bump: 0.004, cavity: 1, mapping: 'uv', tile: 0.8, normal: 0.8, ao: 0.6, breakup: 0.6, wrap: 0.15 },
};

/**
 * Colorize presets (sRGB): a → early wood (light), b → late wood (dark), c → accent
 * (knots); rays → strength of the light ray flecks (and end-grain rays).
 * Oak is a honey BROWN (not butter): a little redder, less saturated and ~12 %
 * darker than a raw tan, because the warm day grade pushes every wood towards
 * yellow. Late wood is darker AND redder than early wood (as in real oak), so
 * the grain reads as wood rather than plywood. Spruce & maple stay the pale ones.
 */
export const WOOD_SPECIES = {
  oak: { a: '#b4895f', b: '#80552f', c: '#4a2c18', rays: 1 },
  walnut: { a: '#7a5438', b: '#4a2f1e', c: '#2a1a10', rays: 0.25 },
  spruce: { a: '#e6cc9c', b: '#c08d55', c: '#6a4524', rays: 0 },
  ash: { a: '#e0caa2', b: '#b48e60', c: '#6e5236', rays: 0.35 },
  cherry: { a: '#b86e48', b: '#8a4a2c', c: '#4a2416', rays: 0.3 },
  maple: { a: '#ecdcb8', b: '#d2b689', c: '#8a6a44', rays: 0.4 },
};

/** Baked maps for a surface kind (cached). */
export function surfaceMaps(kind) {
  const k = KINDS[kind] ? kind : 'stone';
  const def = KINDS[k];
  const glslName = def.glsl ?? k;
  return requestBake(`surface:${k}`, {
    glslKey: k,
    glsl: (def.defines ?? '') + SURFACE_GLSL[glslName],
    fn: `kind_${glslName}`,
    mode: def.mode,
    size: def.size,
    bump: def.bump,
    bumpAspect: def.bumpAspect,
    cavity: def.cavity,
    wrapT: def.wrapT,
    mean: def.mean,
    seed: 0,
  });
}

/** Alpha-tested leaf-card texture for a foliage variant (cached). */
export function foliageMap(variant) {
  const v = FOLIAGE_VARIANTS[variant] ? variant : 'oak';
  return requestBake(`foliage:${v}`, {
    glslKey: `foliage-${v}`,
    glsl: FOLIAGE_GLSL[v],
    fn: `card_${v}`,
    mode: 'card',
    size: FOLIAGE_VARIANTS[v].size,
    alpha: true,
    mean: FOLIAGE_VARIANTS[v].ref,
    bump: 0,
    cavity: 0,
    seed: 0,
  }).map;
}
