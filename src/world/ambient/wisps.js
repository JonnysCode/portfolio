// ─────────────────────────────────────────────────────────────────────────────
// Fairy-ring wisps: at night a few soft mint motes rise slowly out of the
// fairy ring's heart, sway, swell and fade out a couple of units up — the
// ring breathing. One additive Points draw, animated on the GPU (no CPU per
// frame), hidden by day; calmer for prefers-reduced-motion.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { sharedUniforms } from '../../core/materials.js';
import { createRng } from '../../core/rng.js';
import { pointUniforms, SOFT_DISC, DIST_FADE } from './points.js';

const VERT = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform float uMotion;
uniform float uScale;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFocus;
attribute vec4 aParams;  // phase (0..1), rise speed, sway radius, size
varying float vAlpha;
${DIST_FADE}
void main() {
  float H = 2.4;
  float life = fract(aParams.x + uTime * aParams.y * uMotion / H);
  float sway = aParams.z * (0.4 + life);
  vec3 p = position + vec3(
    sin(uTime * 0.7 * uMotion + aParams.x * 31.0) * sway,
    life * H,
    cos(uTime * 0.53 * uMotion + aParams.x * 17.0) * sway
  );
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  // swell in, drift, fade out at the top
  float a = smoothstep(0.0, 0.18, life) * (1.0 - smoothstep(0.55, 1.0, life));
  float awake = smoothstep(0.35, 0.7, uNight);
  float nearK = smoothstep(uFocus * 0.32, uFocus * 0.7, d);
  vAlpha = a * awake * distFade(d) * smoothstep(2.0, 6.0, d) * nearK;
  gl_PointSize = clamp(aParams.w * (0.7 + 0.5 * life) * uScale / max(d, 0.1), 0.0, 18.0);
  if (vAlpha < 0.004) gl_PointSize = 0.0;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying float vAlpha;
${SOFT_DISC}
void main() {
  float halo;
  float core = softCore(gl_PointCoord, 0.16, halo);
  float a = (core * 0.7 + halo) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4((vec3(0.5, 0.95, 0.8) + vec3(core * 0.4)) * a * 0.75, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** ring: { x, y, z, r } (ctx.forest.fairyRing). count: how many wisps. */
export function createWisps(ctx, { ring, count = 14, reduced = false } = {}) {
  if (!ring) return null;
  const rng = createRng('ambient:wisps');
  const pos = new Float32Array(count * 3);
  const params = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * ring.r * 0.7;
    pos.set([ring.x + Math.sin(a) * d, ring.y + 0.1, ring.z + Math.cos(a) * d], i * 3);
    params.set([i / count + rng.jitter(0.02), rng.range(0.12, 0.22), rng.range(0.05, 0.16), rng.range(0.07, 0.12)], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aParams', new THREE.Float32BufferAttribute(params, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(ring.x, ring.y + 1.2, ring.z), ring.r + 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: sharedUniforms.uTime, uNight: { value: 0 }, uMotion: { value: reduced ? 0.35 : 1 }, uFocus: { value: 20 }, ...pointUniforms },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'ambient:fairy-wisps';
  points.renderOrder = 5;
  points.raycast = () => {};
  points.visible = false;
  ctx.scene.add(points);
  return {
    object: points,
    count,
    update(night) {
      mat.uniforms.uNight.value = night;
      mat.uniforms.uFocus.value = Math.max(4, ctx.cameraRig?.focusDistance ?? 20);
      points.visible = night > 0.3;
    },
  };
}
