// ─────────────────────────────────────────────────────────────────────────────
// Daylight motes: pollen and dandelion fluff drifting on the breeze, catching
// the golden light. The particles live in a box that wraps around the camera
// focus (pure GPU, no CPU per frame), so the air is always full where you are.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { palette } from '../../core/palette.js';
import { sharedUniforms } from '../../core/materials.js';
import { pointUniforms, SOFT_DISC, DIST_FADE } from './points.js';

const BOX = new THREE.Vector3(40, 9, 40);

const VERT = /* glsl */ `
uniform float uTime;
uniform float uDay;
uniform float uMotion;
uniform vec3 uFocus;
uniform vec3 uBox;
uniform float uScale;
uniform float uFogNear;
uniform float uFogFar;
attribute vec4 aParams;  // phase, size, drift speed, kind (0 pollen, 1 fluff)
varying float vAlpha;
varying float vKind;
varying float vTwinkle;
${DIST_FADE}
void main() {
  float ph = aParams.x;
  float t = uTime * uMotion;
  vec3 drift = vec3(0.55, 0.04, 0.32) * t * aParams.z
    + vec3(sin(t * 0.6 + ph * 6.0) * 0.7, sin(t * 0.9 + ph * 9.0) * 0.45, cos(t * 0.5 + ph * 4.0) * 0.7);
  vec3 p = position + drift;
  vec3 rel = mod(p - uFocus + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 world = uFocus + rel;
  world.y = uFocus.y - 1.2 + mod(p.y, uBox.y);
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  float d = -mv.z;
  // soft fade at the wrap edges of the box
  float edge = max(abs(rel.x) / uBox.x, abs(rel.z) / uBox.z);
  float fade = 1.0 - smoothstep(0.36, 0.5, edge);
  fade *= smoothstep(0.0, 1.0, world.y - uFocus.y + 1.2) * (1.0 - smoothstep(uBox.y - 2.5, uBox.y, world.y - uFocus.y + 1.2));
  vTwinkle = 0.55 + 0.45 * sin(uTime * (2.0 + ph * 3.0) + ph * 40.0);
  vAlpha = uDay * fade * distFade(d);
  vKind = aParams.w;
  gl_PointSize = clamp(aParams.y * uScale / max(d, 0.1), 0.0, 40.0);
  if (vAlpha < 0.004) gl_PointSize = 0.0;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uPollen;
uniform vec3 uFluff;
varying float vAlpha;
varying float vKind;
varying float vTwinkle;
${SOFT_DISC}
void main() {
  float halo;
  float core = softCore(gl_PointCoord, vKind > 0.5 ? 0.55 : 0.4, halo);
  float a = (core * 0.85 + halo * 0.35) * vAlpha * (vKind > 0.5 ? 0.85 : vTwinkle);
  if (a < 0.004) discard;
  vec3 col = mix(uPollen, uFluff, vKind) + core * 0.15;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createMotes(ctx, { count = 260, reduced = false } = {}) {
  const rng = ctx.rng('ambient-motes');
  const pos = new Float32Array(count * 3);
  const params = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rng.range(0, BOX.x);
    pos[i * 3 + 1] = rng.range(0, BOX.y);
    pos[i * 3 + 2] = rng.range(0, BOX.z);
    const fluff = rng.chance(0.18);
    params.set([rng.next(), fluff ? rng.range(0.09, 0.13) : rng.range(0.035, 0.06), rng.range(0.5, 1.2), fluff ? 1 : 0], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aParams', new THREE.BufferAttribute(params, 4));
  const pollen = new THREE.Color(palette.sun).lerp(new THREE.Color(palette.autumnYellow), 0.35);
  const fluff = new THREE.Color(palette.spots);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uDay: { value: 1 },
      uMotion: { value: reduced ? 0.35 : 1 },
      uFocus: { value: new THREE.Vector3() },
      uBox: { value: BOX },
      uPollen: { value: pollen },
      uFluff: { value: fluff },
      ...pointUniforms,
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'ambient:motes';
  points.frustumCulled = false;
  points.renderOrder = 4;
  ctx.scene.add(points);
  return {
    object: points,
    update(night, focus) {
      const day = 1 - night;
      mat.uniforms.uDay.value = day;
      mat.uniforms.uFocus.value.copy(focus);
      points.visible = day > 0.02;
    },
  };
}
