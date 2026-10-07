// ─────────────────────────────────────────────────────────────────────────────
// Chimney smoke — soft, curling puffs rising from every chimney of a cluster.
//
// One mesh (a quad per puff) for ALL chimneys; the animation runs entirely in
// the vertex shader from the shared time uniform, so it costs nothing on the
// CPU. A few big, soft-edged puffs per chimney overlap into one wispy plume
// (never a string of beads): each grows ~2.5× and thins out as it rises,
// drifts off with the breeze and wobbles. They take the glen's fog (aerial
// perspective) and turn from a warm sunlit grey by day to a cool moonlit blue
// at night.
//
//   const smoke = makeSmoke([{ x, y, z, scale }], { reducedMotion })
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { sharedUniforms } from '../../core/materials.js';
import { fogUniforms } from '../../world/env/fog.js';

const VERT = /* glsl */ `
  attribute vec2 aCorner;
  attribute vec4 aPuff; // x: phase, y: seed, z: scale, w: rise height
  uniform float uTime;
  uniform vec3 uWind;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vLife;
  varying float vSeed;
  #include <fog_pars_vertex>
  void main() {
    float life = fract(uTime * 0.065 / max(aPuff.z, 0.4) + aPuff.x);
    vec3 p = position;
    float s = aPuff.z;
    // rise steadily and lean away with the breeze
    p.y += aPuff.w * life;
    p.xz += uWind.xz * life * life * s * 2.4;
    p.x += sin(life * 6.0 + aPuff.y * 13.0 + uTime * 0.35) * 0.16 * s * life;
    p.z += cos(life * 4.7 + aPuff.y * 7.0 + uTime * 0.3) * 0.16 * s * life;
    // big enough from the start that consecutive puffs always overlap into one plume
    float size = mix(0.42, 1.15, pow(life, 0.7)) * s;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float a = aPuff.y * 6.2831 + life * (aPuff.y > 0.5 ? 1.4 : -1.4);
    vec2 c = vec2(cos(a) * aCorner.x - sin(a) * aCorner.y, sin(a) * aCorner.x + cos(a) * aCorner.y);
    mvPosition.xy += c * size;
    gl_Position = projectionMatrix * mvPosition;
    vUv = aCorner;
    vLife = life;
    vSeed = aPuff.y;
    vAlpha = smoothstep(0.0, 0.14, life) * (1.0 - smoothstep(0.2, 1.0, life)) * (1.0 - 0.35 * life);
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  uniform float uNight;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vLife;
  varying float vSeed;
  #include <fog_pars_fragment>
  float blob(vec2 p, vec2 c, float r) {
    float d = length(p - c) / r;
    return exp(-d * d * 2.2);
  }
  void main() {
    // a puff made of a few overlapping soft lobes — a soft, feathered edge that
    // gets wispier (lobes drifting apart) as the puff ages
    vec2 p = vUv;
    float k = vSeed * 31.0;
    float spread = 1.0 + vLife * 0.35;
    float a = blob(p, vec2(0.0), 0.85);
    a += blob(p, spread * vec2(0.36 * cos(k), 0.32 * sin(k)), 0.55) * 0.6;
    a += blob(p, spread * vec2(-0.32 * sin(k * 1.7), 0.34 * cos(k * 1.3)), 0.5) * 0.5;
    a += blob(p, spread * vec2(0.2 * cos(k * 2.3), -0.38 * sin(k * 0.7)), 0.45) * 0.45;
    a = smoothstep(0.08, 1.3, a);
    a *= 1.0 - smoothstep(0.6, 1.0, length(p)); // never show the quad's edge
    if (a * vAlpha < 0.01) discard;
    // light from above-left, darker bottom; warm by day, moonlit at night
    float lit = 0.72 + 0.28 * smoothstep(-0.8, 0.8, p.y - p.x * 0.4);
    vec3 day = mix(vec3(0.62, 0.6, 0.57), vec3(0.93, 0.89, 0.82), lit);
    vec3 night = mix(vec3(0.1, 0.12, 0.17), vec3(0.24, 0.27, 0.36), lit);
    vec3 col = mix(day, night, uNight);
    // fresh smoke near the chimney is a bit darker and denser
    col *= mix(0.82, 1.0, smoothstep(0.0, 0.35, vLife));
    gl_FragColor = vec4(col, a * vAlpha * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

let sharedMat = null;
let frozenMat = null;

function smokeMaterial(reduced) {
  if (reduced && frozenMat) return frozenMat;
  if (!reduced && sharedMat) return sharedMat;
  const m = new THREE.ShaderMaterial({
    name: 'cottage-smoke',
    uniforms: {
      ...fogUniforms(),
      uTime: reduced ? { value: 3.7 } : sharedUniforms.uTime,
      uNight: sharedUniforms.uNight,
      uWind: { value: new THREE.Vector3(0.55, 0, 0.2) },
      uOpacity: { value: 0.34 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  if (reduced) frozenMat = m;
  else sharedMat = m;
  return m;
}

/**
 * Smoke for many chimneys in one mesh. sources: [{ x, y, z, scale = 1, puffs = 6, rise = 2.6 }]
 * (local coordinates of the parent). opts: { reducedMotion }
 */
export function makeSmoke(sources, { reducedMotion = false } = {}) {
  const quads = [];
  sources.forEach((s, si) => {
    const n = s.puffs ?? 6;
    for (let i = 0; i < n; i++) quads.push({ x: s.x, y: s.y, z: s.z, phase: i / n + si * 0.37, seed: ((i * 0.618 + si * 0.31) % 1), scale: s.scale ?? 1, rise: s.rise ?? 2.6 });
  });
  const n = quads.length;
  const pos = new Float32Array(n * 12);
  const corner = new Float32Array(n * 8);
  const puff = new Float32Array(n * 16);
  const idx = new Uint16Array(n * 6);
  const C = [-1, -1, 1, -1, 1, 1, -1, 1];
  const box = new THREE.Box3();
  quads.forEach((q, i) => {
    for (let k = 0; k < 4; k++) {
      pos.set([q.x, q.y, q.z], i * 12 + k * 3);
      corner[i * 8 + k * 2] = C[k * 2];
      corner[i * 8 + k * 2 + 1] = C[k * 2 + 1];
      puff.set([q.phase % 1, q.seed, q.scale, q.rise], i * 16 + k * 4);
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    box.expandByPoint(new THREE.Vector3(q.x, q.y, q.z));
    box.expandByPoint(new THREE.Vector3(q.x + 3.0 * q.scale, q.y + q.rise + 1.2, q.z + 1.6 * q.scale));
  });
  box.expandByScalar(1.5);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aPuff', new THREE.BufferAttribute(puff, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingBox = box;
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  const mesh = new THREE.Mesh(g, smokeMaterial(reducedMotion));
  mesh.name = 'chimney-smoke';
  mesh.renderOrder = 4;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return mesh;
}
