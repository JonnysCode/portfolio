// ─────────────────────────────────────────────────────────────────────────────
// Glittering dust in the sunbeams. Thousands of tiny specks drift through the
// air of the glen; each one asks the sun's shadow map whether it is in light
// (env/sunlight.js) and only then sparkles — so they appear exactly inside
// the god rays and the sunny patches, and vanish in the shade. Brighter when
// looking towards the sun (forward scattering). One draw call, pure GPU
// animation (positions wrap inside a box), no CPU work per frame.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { envUniforms } from './celestial.js';
import { sunlightUniforms, SUNLIGHT_GLSL } from './sunlight.js';

/** The volume the motes live in (centre & half extents, world units). */
const CENTER = new THREE.Vector3(-1, 5.2, 2);
const HALF = new THREE.Vector3(24, 5, 22);

const VERT = /* glsl */ `
  attribute vec4 aSeed; // phase, size, speed, sparkle rate
  uniform float uTime, uMotion, uScale, uStrength;
  uniform vec3 uCenter, uHalf, uAxis;
  varying float vA;
  varying float vTw;
  ${SUNLIGHT_GLSL}
  void main() {
    float t = uTime * uMotion;
    // slow lazy drift: a little breeze + rising warm air + swirl
    vec3 p = position + vec3(0.18, 0.05, 0.11) * t * aSeed.z;
    p += vec3(sin(t * 0.35 + aSeed.x * 6.28), sin(t * 0.27 + aSeed.x * 4.1) * 0.6, cos(t * 0.31 + aSeed.x * 5.3)) * 0.45;
    // wrap inside the box around the glen
    vec3 rel = p - uCenter + uHalf;
    rel = mod(rel, uHalf * 2.0);
    p = rel + uCenter - uHalf;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    float lit = sunVisibility(p);
    vec3 v = normalize(p - cameraPosition);
    float fwd = pow(max(dot(v, normalize(uAxis)), 0.0), 3.0);
    // a soft twinkle as each flake turns in the light
    vTw = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * aSeed.w + aSeed.x * 40.0), 3.0);
    // fade near the box walls (wrap seams), very close and very far
    vec3 e = abs(rel - uHalf) / uHalf;
    float edge = 1.0 - smoothstep(0.75, 1.0, max(max(e.x, e.y), e.z));
    float near = smoothstep(0.8, 3.0, dist) * (1.0 - smoothstep(38.0, 60.0, dist));
    vA = lit * edge * near * (0.35 + 1.4 * fwd) * uStrength;
    gl_PointSize = clamp(aSeed.y * uScale / dist, 1.0, 9.0);
    if (vA < 0.01) gl_PointSize = 0.0;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  varying float vTw;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float a = exp(-d * d * 4.0) * (1.0 - smoothstep(0.8, 1.0, d));
    gl_FragColor = vec4(uColor * a * vA * vTw, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function buildSunMotes(ctx) {
  const tier = ctx.quality?.tier ?? 'high';
  const density = ctx.quality?.density ?? 1;
  const count = Math.round((tier === 'high' ? 3200 : tier === 'medium' ? 1500 : 500) * Math.max(0.5, density));
  const rng = createRng('sunmotes');
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = CENTER.x + rng.range(-HALF.x, HALF.x);
    // more dust low down, where the light pools
    pos[i * 3 + 1] = CENTER.y - HALF.y + Math.pow(rng.next(), 1.6) * HALF.y * 2;
    pos[i * 3 + 2] = CENTER.z + rng.range(-HALF.z, HALF.z);
    seed[i * 4] = rng.next();
    seed[i * 4 + 1] = rng.range(0.6, 1.6) * (rng.next() < 0.08 ? 2.2 : 1); // a few bigger glints
    seed[i * 4 + 2] = rng.range(0.4, 1.2);
    seed[i * 4 + 3] = rng.range(0.6, 2.8);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const uniforms = {
    ...sunlightUniforms,
    uTime: envUniforms.uTime,
    uMotion: { value: ctx.engine.reducedMotion ? 0.15 : 1 },
    uScale: { value: 60 },
    uStrength: { value: 1 },
    uCenter: { value: CENTER },
    uHalf: { value: HALF },
    uAxis: { value: envUniforms.uKeyDir.value },
    uColor: { value: new THREE.Color('#ffe2a8').multiplyScalar(1.6) },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'sunmotes',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'sunmotes';
  points.frustumCulled = false;
  points.renderOrder = 6;
  points.raycast = () => {};

  return {
    points,
    uniforms,
    resize(pixelHeight) {
      // keep the specks the same apparent size on any screen
      uniforms.uScale.value = 60 * (pixelHeight / 720);
    },
    update(night) {
      const k = 1 - THREE.MathUtils.smoothstep(night, 0.05, 0.4);
      uniforms.uStrength.value = k;
      points.visible = k > 0.002;
    },
  };
}
