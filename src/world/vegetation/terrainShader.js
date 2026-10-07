// ─────────────────────────────────────────────────────────────────────────────
// The forest-floor material: a MeshStandardMaterial (so shadows, the painted
// environment light and the glen's aerial-perspective fog all just work)
// patched to splat the look-dev's baked surfaces per pixel:
//
//   moss    velvety cushions (two scales, so it never tiles), sunlit golden
//           to deep green in broad painterly patches, velvet rim sheen
//   soil    dark rich humus with fallen leaves, twigs & pebbles — leaf litter
//           patches, the dressed rings around buildings, under the trees
//   path    packed, worn earth — lighter, with a trampled soil fringe and
//           ragged moss edges (noise-broken, height-blended)
//   damp    darker, cooler and glossier soil & moss near the water
//
// Splat weights come from a per-vertex attribute (aSplat: path, damp, litter,
// trampled) baked from ground.js' grids; transitions are height-blended with
// the textures' own relief so moss cushions overgrow the soil naturally.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { KINDS } from '../../core/textures/index.js';

const VERT_PARS = /* glsl */ `
attribute vec4 aSplat;
varying vec4 vSplat;
varying vec3 vTWorld;
`;
const VERT_MAIN = /* glsl */ `
#include <worldpos_vertex>
vSplat = aSplat;
vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAG_PARS = /* glsl */ `
varying vec4 vSplat;
varying vec3 vTWorld;
uniform sampler2D tMossA;
uniform sampler2D tMossD;
uniform sampler2D tSoilA;
uniform sampler2D tSoilD;
uniform vec4 tTile;      // x: 1/moss tile, y: 1/soil tile
uniform vec3 tSoilMean;  // linear mean colour of the soil albedo
uniform vec3 tMossMean;  // linear mean colour of the moss albedo
uniform vec3 tMossSun;   // sunlit golden moss (linear)
uniform vec3 tMossDeep;  // deep shaded moss (linear)
uniform vec3 tPathCol;   // packed earth (linear)
uniform vec3 tLitter;    // leaf-litter tint (linear)
float tHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float tFbm(vec2 p) {
  return tNoise(p) * 0.55 + tNoise(p * 2.03 + 7.1) * 0.3 + tNoise(p * 4.1 - 3.7) * 0.15;
}
vec3 tUnpack(vec2 xy, float s) {
  vec2 n = xy * 2.0 - 1.0;
  return vec3(n * s, sqrt(clamp(1.0 - dot(n, n), 0.0, 1.0)));
}
float tVelvet;
// tiny wildflowers dotted through the sunny moss: one candidate per cell,
// daisies (with a yellow eye), buttercups, forget-me-nots, a pink one now and then
vec3 tFlowerDots(vec2 p, float amount, float cellSize, out float mask) {
  vec2 q = p / cellSize;
  vec2 cell = floor(q);
  vec2 f = fract(q);
  mask = 0.0;
  float h = tHash(cell);
  if (h > amount) return vec3(0.0);
  vec2 c = vec2(tHash(cell + 3.7), tHash(cell + 9.1)) * 0.56 + 0.22;
  float r = 0.13 + 0.09 * tHash(cell + 1.3);
  float d = length(f - c);
  mask = 1.0 - smoothstep(r * 0.55, r, d);
  float k = tHash(cell + 5.5);
  vec3 col = k < 0.42 ? vec3(0.86, 0.86, 0.8) : k < 0.66 ? vec3(0.95, 0.62, 0.03) : k < 0.88 ? vec3(0.2, 0.38, 0.92) : vec3(0.88, 0.32, 0.52);
  if (k < 0.42) col = mix(vec3(0.95, 0.62, 0.05), col, smoothstep(r * 0.18, r * 0.32, d));
  return col;
}
`;

const FRAG_MAIN = /* glsl */ `
  // ── forest floor splat ──
  vec3 tGN = normalize((vec4(normal, 0.0) * viewMatrix).xyz); // world-space geometric normal
  vec2 tP = vTWorld.xz;
  // two scales of moss cushions, swapped in noisy patches so the carpet never reads as a pattern
  vec2 tUv1 = tP * tTile.x;
  vec2 tUv2 = vec2(tP.x * 0.71 - tP.y * 0.7, tP.x * 0.7 + tP.y * 0.71) * tTile.x * 0.58 + vec2(0.37, 0.61);
  vec4 mA = texture2D(tMossA, tUv1, 0.4);
  vec4 mD = texture2D(tMossD, tUv1, 0.4);
  vec4 mA2 = texture2D(tMossA, tUv2, 0.6);
  vec4 mD2 = texture2D(tMossD, tUv2, 0.6);
  vec4 sA = texture2D(tSoilA, tP * tTile.y);
  vec4 sD = texture2D(tSoilD, tP * tTile.y);
  vec4 sA2 = texture2D(tSoilA, tP * tTile.y * 0.41 + vec2(0.13, 0.71));
  float nBig = tFbm(tP * 0.055);
  float nMid = tFbm(tP * 0.21 + 11.0);
  float nSmall = tFbm(tP * 0.75 - 4.0);
  float nFine = tNoise(tP * 2.3 - 5.0);

  float tDamp = vSplat.y;
  // paths: ragged edges, packed earth in the middle, a trampled soil fringe
  float tPathE = vSplat.x + (nMid - 0.5) * 0.5 + (nSmall - 0.5) * 0.55 + (sA.a - 0.5) * 0.3;
  float tWPath = smoothstep(0.5, 0.62, tPathE);
  float tFringe = smoothstep(0.2, 0.5, tPathE) * (1.0 - tWPath);
  // soil vs moss, height-blended with the relief of both textures
  float tSwap = smoothstep(0.35, 0.65, tFbm(tP * 0.33 + 3.0));
  mA = mix(mA, mA2, tSwap);
  mD = mix(mD, mD2, tSwap);
  float tHM = mA.a;
  float tBias = vSplat.z * 1.6 - 0.9 + tFringe * 1.2 + vSplat.w * 0.75 + tDamp * 0.3 + (nMid - 0.5) * 0.8 + (nSmall - 0.5) * 0.6;
  float tWSoil = smoothstep(-0.14, 0.14, tBias + (sA.a - tHM) * 1.1);
  tWSoil = max(tWSoil, tWPath);

  // moss: softened texture (velvet), three painterly tones in broad patches
  vec3 tMoss = mix(vec3(1.0), mA.rgb / tMossMean, 0.42);
  vec3 tMossMid = mix(tMossDeep, tMossSun, 0.5);
  vec3 tMossTint = mix(tMossDeep, tMossMid, smoothstep(0.2, 0.5, nBig));
  tMossTint = mix(tMossTint, tMossSun, smoothstep(0.55, 0.85, nBig * 0.7 + nMid * 0.3));
  tMossTint = mix(tMossTint, tMossDeep * 0.75, tDamp * 0.6);
  tMoss *= tMossTint * (0.86 + 0.28 * nSmall);
  // soil: humus with leaves; litter patches warmer
  vec3 tSoil = sA.rgb * mix(vec3(1.0), tLitter / tSoilMean, clamp(vSplat.z * 0.8 + (nBig - 0.5) * 0.4, 0.0, 1.0) * 0.5);
  tSoil *= mix(1.0, 0.6, tDamp);
  // packed earth: the soil's pebbles at low contrast on a lighter, sandy base
  vec3 tPathC = tPathCol * mix(vec3(0.85), sA2.rgb / tSoilMean, 0.4) * (0.8 + 0.4 * sA.a);
  tPathC = mix(tPathC, tPathC * vec3(0.75, 0.72, 0.68), tDamp * 0.7);
  vec3 tCol = mix(tMoss, tSoil, tWSoil);
  tCol = mix(tCol, tPathC, tWPath);
  // wildflower speckles in the sunny moss of the open glen (fade out before they would shimmer)
  {
    float meadow = smoothstep(0.42, 0.75, nBig * 0.6 + nMid * 0.4) * (1.0 - tWSoil) * (1.0 - tDamp * 0.7);
    meadow *= 1.0 - smoothstep(20.0, 27.0, length(tP));
    float px = max(fwidth(tP.x), fwidth(tP.y));
    float fade = 1.0 - smoothstep(0.035, 0.07, px);
    if (meadow * fade > 0.01) {
      float m1, m2;
      vec3 f1 = tFlowerDots(tP, meadow * 0.55, 0.22, m1);
      vec3 f2 = tFlowerDots(tP + vec2(0.11, 0.07), meadow * 0.3, 0.13, m2);
      tCol = mix(tCol, f1, m1 * fade);
      tCol = mix(tCol, f2, m2 * fade * 0.9);
    }
  }
  // darker trampled band where the moss gives way to the path
  tCol *= 1.0 - tFringe * 0.12;

  // normals (planar XZ projection, whiteout blend)
  vec3 tnM = tUnpack(mD.xy, 0.5);
  vec3 tnS = tUnpack(sD.xy, 1.0);
  vec3 tn = normalize(mix(tnM, tnS, tWSoil));
  tn.xy *= mix(1.0, 0.55, tWPath);
  vec3 tN = normalize(vec3(tn.x + tGN.x, abs(tn.z) * tGN.y, tn.y + tGN.z));
  normal = normalize((viewMatrix * vec4(tN, 0.0)).xyz);

  float tRough = mix(mD.z, sD.z, tWSoil);
  tRough = mix(tRough, 0.92, tWPath);
  tRough = mix(tRough, tRough * 0.62, tDamp);
  float tAO = mix(mD.w, sD.w, tWSoil);
  tVelvet = (1.0 - tWSoil) * 0.55;

  diffuseColor.rgb *= tCol;
  diffuseColor.rgb *= mix(1.0, tAO, 0.35);
  roughnessFactor = clamp(tRough, 0.05, 1.0);
  metalnessFactor = 0.0;
`;

const FRAG_AO = /* glsl */ `
#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= mix(1.0, tAO, 0.9);
  reflectedLight.indirectSpecular *= mix(1.0, tAO, 0.9);
`;

const FRAG_VELVET = /* glsl */ `
#include <lights_fragment_end>
  {
    float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.5);
    reflectedLight.directDiffuse *= 1.0 + tVelvet * fres;
    reflectedLight.indirectDiffuse *= 1.0 + tVelvet * 1.4 * fres;
  }
`;

const lin = (hex) => new THREE.Color(hex);
const v3 = (c) => new THREE.Vector3(c.r, c.g, c.b);

/** Build the patched forest-floor material. */
export function makeTerrainMaterial(ctx) {
  const moss = ctx.materials.surfaceMaps('moss');
  const soil = ctx.materials.surfaceMaps('soil');
  const uniforms = {
    tMossA: { value: moss.map },
    tMossD: { value: moss.detail },
    tSoilA: { value: soil.map },
    tSoilD: { value: soil.detail },
    tTile: { value: new THREE.Vector4(1 / (KINDS.moss.tile * 0.8), 1 / (KINDS.soil.tile * 0.9), 0, 0) },
    tSoilMean: { value: v3(lin(KINDS.soil.mean)) },
    tMossMean: { value: v3(lin(KINDS.moss.mean)) },
    tMossSun: { value: v3(lin('#86913a')) },
    tMossDeep: { value: v3(lin('#34532a')) },
    tPathCol: { value: v3(lin('#9c7f5c')) },
    tLitter: { value: v3(lin('#6e4526')) },
  };
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  m.name = 'forest-floor';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <worldpos_vertex>', VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <normal_fragment_maps>', FRAG_MAIN)
      .replace('#include <aomap_fragment>', FRAG_AO)
      .replace('#include <lights_fragment_end>', FRAG_VELVET);
  };
  m.customProgramCacheKey = () => 'forest-floor-v2';
  m.userData.uniforms = uniforms;
  return m;
}
