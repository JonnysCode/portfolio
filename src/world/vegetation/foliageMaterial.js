// ─────────────────────────────────────────────────────────────────────────────
// Foliage materials for the static vegetation batches: the shared toon look
// (cloned from materials.toon so the ramp & lighting match the village) plus
//   • wind  — per-vertex bend from the aSway attribute, with rolling gust waves
//             that travel across the meadow and a leafy flutter on top
//   • fade  — trees between the camera and the player dissolve into a soft
//             screen-door dither so the little hero is never hidden
// The same wind runs in the shadow depth material, so shadows sway too.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { materials, sharedUniforms } from '../../core/materials.js';
import { SWAY_MAX } from './batcher.js';

/** Uniforms owned by the vegetation (updated by vegetation.js every frame). */
export const vegUniforms = {
  uCamPos: { value: new THREE.Vector3(0, 50, 50) },
  uFocus: { value: new THREE.Vector3() },
  uFade: { value: 1 },
  uMotion: { value: 1 },
};

const WIND_PARS = /* glsl */ `
uniform float uTime;
uniform float uWindStrength;
uniform float uMotion;
attribute vec2 aSway;
`;

/** speed: oscillation rate; flutter: leafy wobble amount. */
function windChunk(speed, flutter) {
  return /* glsl */ `
#include <begin_vertex>
{
  float vegW = aSway.x * ${SWAY_MAX.toFixed(3)} * uWindStrength * uMotion;
  if (vegW > 0.0001) {
    vec4 vegWp = modelMatrix * vec4(transformed, 1.0);
    float ph = aSway.y * 6.2831853;
    vec2 wdir = vec2(0.8, 0.6);
    float t = uTime * ${speed.toFixed(3)};
    // a broad gust wave rolling across the world
    float wave = sin(dot(vegWp.xz, wdir) * 0.075 - t * 0.55) * 0.5 + 0.5;
    float gust = 0.35 + 0.85 * wave * wave;
    float osc = sin(t + ph) * 0.6 + sin(t * 2.3 + ph * 1.7 + vegWp.x * 0.35) * 0.22;
    vec2 bend = wdir * (osc + 0.3) * gust * vegW;
    bend += vec2(-wdir.y, wdir.x) * sin(t * 3.1 + ph * 3.0 + vegWp.z * 0.6) * ${flutter.toFixed(3)} * vegW;
    transformed.xz += bend;
    transformed.y -= dot(bend, bend) * 0.35;
  }
}
`;
}

const FADE_VERT_PARS = /* glsl */ `
varying vec3 vVegWorld;
`;
const FADE_VERT = /* glsl */ `
#include <project_vertex>
vVegWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;
const FADE_FRAG_PARS = /* glsl */ `
uniform vec3 uCamPos;
uniform vec3 uFocus;
uniform float uFade;
varying vec3 vVegWorld;
float vegBayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float vegBayer4(vec2 a) { return vegBayer2(0.5 * a) * 0.25 + vegBayer2(a); }
`;
const FADE_FRAG = /* glsl */ `
#include <clipping_planes_fragment>
if (uFade > 0.0) {
  vec3 seg = uFocus - uCamPos;
  float L2 = max(dot(seg, seg), 1e-3);
  float L = sqrt(L2);
  float t = dot(vVegWorld - uCamPos, seg) / L2;
  vec3 closest = uCamPos + seg * clamp(t, 0.0, 1.0);
  float d = length(vVegWorld - closest);
  float rad = mix(1.3, 3.0, clamp(t, 0.0, 1.0));
  float f = (1.0 - smoothstep(rad * 0.72, rad, d)) * step(0.0, t) * smoothstep(0.6, 2.2, (1.0 - t) * L);
  // anything hugging the lens dissolves too
  f = max(f, 1.0 - smoothstep(2.5, 4.0, length(vVegWorld - uCamPos)));
  f *= uFade;
  if (f > 0.001 && vegBayer4(gl_FragCoord.xy) < f * 1.07 - 0.03) discard;
}
`;

function inject(material, { speed, flutter, fade, key, keepUp = false }) {
  material.onBeforeCompile = (shader) => {
    if (keepUp) {
      // thin double-sided plants keep their (mostly upward) normal on the back
      // face too, so blades never turn dark when seen from behind
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n  normal = normalize( vNormal );'
      );
    }
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uWindStrength = sharedUniforms.uWindStrength;
    shader.uniforms.uMotion = vegUniforms.uMotion;
    let vs = WIND_PARS + shader.vertexShader.replace('#include <begin_vertex>', windChunk(speed, flutter));
    if (fade) {
      shader.uniforms.uCamPos = vegUniforms.uCamPos;
      shader.uniforms.uFocus = vegUniforms.uFocus;
      shader.uniforms.uFade = vegUniforms.uFade;
      vs = FADE_VERT_PARS + vs.replace('#include <project_vertex>', FADE_VERT);
      shader.fragmentShader = FADE_FRAG_PARS + shader.fragmentShader.replace('#include <clipping_planes_fragment>', FADE_FRAG);
    }
    shader.vertexShader = vs;
  };
  material.customProgramCacheKey = () => key;
  return material;
}

/**
 * Build the vegetation materials.
 * Returns { trees, ground, treesDepth } — trees: opaque front-sided with
 * camera fade; ground: double-sided (blades, petals, fronds); treesDepth: the
 * shadow-pass material with the same wind.
 */
export function createFoliageMaterials() {
  const base = materials.toon('#ffffff', { vertexColors: true });
  const trees = inject(base.clone(), { speed: 1.05, flutter: 0.22, fade: true, key: 'veg-trees-1' });
  trees.name = 'veg-trees';
  const ground = inject(base.clone(), { speed: 1.9, flutter: 0.3, fade: false, keepUp: true, key: 'veg-ground-2' });
  ground.side = THREE.DoubleSide;
  ground.name = 'veg-ground';
  const treesDepth = inject(new THREE.MeshDepthMaterial(), { speed: 1.05, flutter: 0.22, fade: false, key: 'veg-depth-1' });
  return { trees, ground, treesDepth };
}
