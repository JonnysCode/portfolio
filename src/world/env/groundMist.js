// ─────────────────────────────────────────────────────────────────────────────
// Low mist — thin drifting veils that hug the stream, the plunge pool and the
// edges of the glen (much stronger at night, moonlit blue).
//
// A couple of large horizontal layers just above the ground. Their shader
// reads the baked terrain height & stream distance (ground.js grids, uploaded
// once as a half-float texture) so each layer fades softly where it meets the
// ground — no hard intersection lines — and only appears where mist belongs.
// By day, mist in sunlight glows warm (shadow-map lookup), in shade it stays
// cool. Mist never touches the middle of the glen where the houses stand.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { heightGrid, streamGrid, GRID_RES } from '../ground.js';
import { TERRAIN_HALF_SIZE, STREAM, OAK } from '../layout.js';
import { envUniforms, GLSL_NOISE } from './celestial.js';
import { sunlightUniforms, SUNLIGHT_GLSL } from './sunlight.js';
import { fogUniforms } from './fog.js';

function groundTexture() {
  const N = GRID_RES + 1;
  const data = new Uint16Array(N * N * 2);
  for (let i = 0; i < N * N; i++) {
    data[i * 2] = THREE.DataUtils.toHalfFloat(heightGrid[i]);
    data[i * 2 + 1] = THREE.DataUtils.toHalfFloat(streamGrid[i]);
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */ `
  attribute float aLayer;
  varying vec3 vW;
  varying float vLayer;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vLayer = aLayer;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uGround;
  uniform float uHalf, uCells, uTime, uNight, uStrength;
  uniform vec3 uPool, uOak, uLit, uShade, uMoon;
  varying vec3 vW;
  varying float vLayer;
  ${GLSL_NOISE}
  ${SUNLIGHT_GLSL}
  #include <fog_pars_fragment>
  void main() {
    vec2 uv = ((vW.xz + uHalf) / (2.0 * uHalf) * uCells + 0.5) / (uCells + 1.0);
    vec2 g = texture2D(uGround, uv).rg;
    float ground = g.r;
    float stream = g.g;
    float above = vW.y - ground;
    // soft contact with the ground, thinning out with height above it
    float contact = smoothstep(0.0, 0.55, above) * (1.0 - smoothstep(0.8, 3.2, above));
    // where mist belongs: over the water, round the pool, the rim of the glen, by night everywhere low
    float r = length(vW.xz - vec2(0.0, 1.5));
    float water = 1.0 - smoothstep(1.2, 5.5, stream);
    float pool = 1.0 - smoothstep(2.0, 7.5, length(vW.xz - uPool.xz));
    float rim = smoothstep(18.0, 30.0, r);
    float hollow = smoothstep(0.4, -0.6, ground) * 0.6;
    float mask = max(max(water, pool), max(rim * 0.45, hollow));
    float keepOut = smoothstep(4.5, 8.0, length(vW.xz - uOak.xz)); // not inside the workshop
    mask = max(mask * keepOut, uNight * 0.22 * smoothstep(10.0, 20.0, r));
    // drifting wisps
    vec2 p = vW.xz * 0.11 + vec2(uTime * 0.018, -uTime * 0.011) + vLayer * 5.3;
    float n = envFbm(p) * 0.65 + envFbm(p * 2.7 - vec2(uTime * 0.03, 0.0)) * 0.35;
    float wisps = smoothstep(0.32, 0.78, n);
    float a = contact * mask * wisps * uStrength * mix(0.55, 0.38, vLayer);
    if (a < 0.003) discard;
    // sunlit mist glows warm, shaded mist stays cool; moonlit blue at night
    float lit = sunVisibility(vW + vec3(0.0, 0.3, 0.0));
    vec3 col = mix(uShade, uLit, lit * (1.0 - uNight));
    col = mix(col, uMoon, uNight);
    vec4 fogV = woodlandFog(vW);
    col = mix(col, fogV.rgb, fogV.a);
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.85));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function buildGroundMist(ctx) {
  const tier = ctx.quality?.tier ?? 'high';
  const layers = tier === 'high' ? [0.35, 0.95, 1.7] : [0.6, 1.4];
  const size = TERRAIN_HALF_SIZE * 1.2;
  const parts = [];
  layers.forEach((h, i) => {
    const g = new THREE.PlaneGeometry(size, size, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, STREAM.waterLevel + h, 4);
    g.setAttribute('aLayer', new THREE.Float32BufferAttribute(new Float32Array(4).fill(i / Math.max(1, layers.length - 1)), 1));
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    parts.push(g);
  });
  // merge by hand (identical layouts)
  const geo = new THREE.BufferGeometry();
  const pos = [], layer = [], idx = [];
  parts.forEach((g, k) => {
    pos.push(...g.attributes.position.array);
    layer.push(...g.attributes.aLayer.array);
    idx.push(...Array.from(g.index.array, (v) => v + k * 4));
    g.dispose();
  });
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aLayer', new THREE.Float32BufferAttribute(layer, 1));
  geo.setIndex(idx);

  // the plunge pool & falls get the thickest mist; its layers ride higher there
  const poolPos = new THREE.Vector3(STREAM.pool.x, 0, STREAM.pool.z);
  const uniforms = {
    ...fogUniforms(),
    ...sunlightUniforms,
    uGround: { value: groundTexture() },
    uHalf: { value: TERRAIN_HALF_SIZE },
    uCells: { value: GRID_RES },
    uTime: envUniforms.uTime,
    uNight: envUniforms.uNight,
    uStrength: { value: 1 },
    uPool: { value: poolPos },
    uOak: { value: new THREE.Vector3(OAK.x, 0, OAK.z) },
    uLit: { value: new THREE.Color('#fff0d0') },
    uShade: { value: new THREE.Color('#b9d2d0') },
    uMoon: { value: new THREE.Color('#6f8fc0') },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'ground-mist',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ground-mist';
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return {
    mesh,
    uniforms,
    update(night) {
      uniforms.uStrength.value = 0.42 + 0.45 * night;
    },
  };
}
