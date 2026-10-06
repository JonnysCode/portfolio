// ─────────────────────────────────────────────────────────────────────────────
// Soft additive glow halos (lanterns, windows, string lights, glowing shrooms).
//
//   makeGlowSprite(color, size, opts)  → a single camera-facing halo (Mesh)
//   glowQuads([{ x, y, z, size }], color, opts) → MANY halos in ONE draw call
//
// Billboarding happens in the vertex shader (every quad stores its centre), so
// many halos can be merged into one static geometry. The intensity follows
// the shared night uniform (materials.sharedUniforms.uNight): faint by day,
// bright at night. Depth-tested, never writes depth, never raycastable.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { sharedUniforms } from '../core/materials.js';
import { palette } from '../core/palette.js';
import { noRaycast } from './util.js';

const VERT = /* glsl */ `
  attribute vec2 aCorner;
  attribute float aSize;
  varying vec2 vUv;
  varying float vFade;
  uniform float uPull;
  void main() {
    vUv = aCorner;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float sc = length(modelMatrix[0].xyz);
    float s = aSize * sc;
    // pull the halo towards the camera so the lamp geometry never clips it
    mv.xyz += normalize(-mv.xyz) * s * uPull;
    mv.xy += aCorner * s;
    gl_Position = projectionMatrix * mv;
    float d = -mv.z;
    vFade = 1.0 - smoothstep(70.0, 140.0, d);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uNight;
  uniform float uDay;
  uniform float uNightI;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    float d = length(vUv);
    if (d > 1.0) discard;
    // bright core + wide soft falloff
    float a = exp(-d * d * 5.5) * 0.75 + exp(-d * d * 22.0) * 0.6;
    a *= 1.0 - smoothstep(0.7, 1.0, d);
    float k = mix(uDay, uNightI, uNight) * vFade;
    gl_FragColor = vec4(uColor * a * k, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const matCache = new Map();
/** Shared additive halo material per colour / intensity pair. */
export function glowMaterial(color = palette.windowGlow, { day = 0.18, night = 1.1, pull = 0.6 } = {}) {
  const key = `${new THREE.Color(color).getHexString()}|${day}|${night}|${pull}`;
  let m = matCache.get(key);
  if (m) return m;
  m = new THREE.ShaderMaterial({
    name: 'props-glow-halo',
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uNight: sharedUniforms.uNight,
      uDay: { value: day },
      uNightI: { value: night },
      uPull: { value: pull },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    fog: false,
  });
  matCache.set(key, m);
  return m;
}

/**
 * Geometry with one billboard quad per point. points: [{ x, y, z, size }]
 * (size = halo radius in local units).
 */
export function glowGeometry(points) {
  const n = points.length;
  const pos = new Float32Array(n * 12);
  const corner = new Float32Array(n * 8);
  const size = new Float32Array(n * 4);
  const idx = new Uint16Array(n * 6);
  const C = [-1, -1, 1, -1, 1, 1, -1, 1];
  const box = new THREE.Box3();
  let maxS = 0;
  points.forEach((p, i) => {
    for (let k = 0; k < 4; k++) {
      pos.set([p.x, p.y, p.z], i * 12 + k * 3);
      corner[i * 8 + k * 2] = C[k * 2];
      corner[i * 8 + k * 2 + 1] = C[k * 2 + 1];
      size[i * 4 + k] = p.size;
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    box.expandByPoint(new THREE.Vector3(p.x, p.y, p.z));
    maxS = Math.max(maxS, p.size);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  box.expandByScalar(maxS * 1.5);
  g.boundingBox = box;
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  return g;
}

const singleGeo = new Map();

/**
 * A soft additive halo that brightens at night.
 * @param {string} [color]  halo colour (palette.windowGlow by default)
 * @param {number} [size=1] halo radius
 * @param {object} [opts]   { day=0.18, night=1.1 } intensity by day / night, { pull } towards camera (× size)
 */
export function makeGlowSprite(color = palette.windowGlow, size = 1, opts = {}) {
  let g = singleGeo.get(size);
  if (!g) {
    g = glowGeometry([{ x: 0, y: 0, z: 0, size }]);
    singleGeo.set(size, g);
  }
  const m = new THREE.Mesh(g, glowMaterial(color, opts));
  m.name = 'glow';
  m.renderOrder = 3;
  m.castShadow = m.receiveShadow = false;
  return noRaycast(m);
}

/** Many halos in one mesh: points [{ x, y, z, size }] in local coords. */
export function glowQuads(points, color = palette.windowGlow, opts = {}) {
  const m = new THREE.Mesh(glowGeometry(points), glowMaterial(color, opts));
  m.name = 'glows';
  m.renderOrder = 3;
  return noRaycast(m);
}

/** Same, but from a pre-built (cached) geometry. */
export function glowMesh(geometry, color = palette.windowGlow, opts = {}) {
  const m = new THREE.Mesh(geometry, glowMaterial(color, opts));
  m.name = 'glows';
  m.renderOrder = 3;
  return noRaycast(m);
}
