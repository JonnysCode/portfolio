// ─────────────────────────────────────────────────────────────────────────────
// Image-based ambient light for the PBR surfaces — a tiny painted "forest
// room" prefiltered with PMREM, one for the golden afternoon and one for the
// moonlit night.
//
// Standing in the glen you are under a huge canopy: little open sky overhead
// (sage-green, sun-dappled), a bright misty band around the horizon where the
// glen opens to the forest, the low golden sun haze at the back-left, warm
// mossy bounce from the ground. That gives stones, caps, glass and metal soft
// believable reflections and keeps the shaded side a warm sage-green instead of grey.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { GLSL_NOISE } from './celestial.js';

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uSky, uCanopy, uHorizon, uGround, uSunCol, uSunDir;
  uniform float uSunPower, uSunSize, uGaps;
  varying vec3 vDir;
  ${GLSL_NOISE}
  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    // canopy overhead with sky gaps (noise in a lat-long projection)
    vec2 p = vec2(atan(d.x, d.z) * 2.2, y * 5.0);
    float gaps = smoothstep(0.55, 0.8, envFbm(p * 1.7 + 3.0)) * uGaps;
    vec3 up = mix(uCanopy, uSky, gaps);
    vec3 col = mix(uHorizon, up, smoothstep(0.05, 0.5, y));
    col = mix(col, uGround, smoothstep(0.02, -0.25, y));
    // the sun / moon glow: a broad halo + a brighter core
    float s = max(dot(d, uSunDir), 0.0);
    col += uSunCol * (pow(s, uSunSize) * uSunPower + pow(s, 4.0) * 0.35);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function paint(renderer, opts) {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSky: { value: new THREE.Color(opts.sky) },
      uCanopy: { value: new THREE.Color(opts.canopy) },
      uHorizon: { value: new THREE.Color(opts.horizon) },
      uGround: { value: new THREE.Color(opts.ground) },
      uSunCol: { value: new THREE.Color(opts.sunCol) },
      uSunDir: { value: opts.sunDir.clone().normalize() },
      uSunPower: { value: opts.sunPower },
      uSunSize: { value: opts.sunSize },
      uGaps: { value: opts.gaps },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), mat);
  scene.add(mesh);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02, 0.1, 100);
  pmrem.dispose();
  mesh.geometry.dispose();
  mat.dispose();
  return rt.texture;
}

/**
 * Build the day & night environment maps. Returns { day, night } textures
 * (CubeUV, same size so swapping them never recompiles a material).
 */
export function buildEnvMaps(renderer, { sunDir, moonDir }) {
  // golden afternoon: sage-gold canopy light, a warm hazy horizon band and a
  // warm earthy bounce (no teal cast on wood & stone — the cool blue-green
  // belongs to the far mist only)
  const day = paint(renderer, {
    sky: '#d6e6da',
    canopy: '#4c5a36',
    horizon: '#bcc0a0',
    ground: '#5e4c30',
    sunCol: '#ffcf8a',
    sunDir,
    sunPower: 2.4,
    sunSize: 24,
    gaps: 0.55,
  });
  const night = paint(renderer, {
    sky: '#2b3f6e',
    canopy: '#0b1622',
    horizon: '#1d3448',
    ground: '#0d1418',
    sunCol: '#8fa4e6',
    sunDir: moonDir,
    sunPower: 1.2,
    sunSize: 40,
    gaps: 0.6,
  });
  return { day, night };
}
