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
//
// By night the veils rise and thicken into silver air (≈ 0.3 opacity) over the
// stream, the pond and the plunge pool, in the hollows and round the glen's
// rim; where a hero moonbeam crosses them they light up silver-blue (the beam
// lands in a pool of glowing mist), and near the brightest lamps they take on
// the lanterns' warm glow, so the lights bleed into the haze.
//
// buildGroundMist(ctx) → { mesh, uniforms, setBeams([{ foot, axis, width }]), update(night, t) }
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
  uniform float uNight;
  varying vec3 vW;
  varying float vLayer;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    // by night the upper veils rise: a deeper body of mist
    wp.y += uNight * (0.15 + aLayer * 1.3);
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
  uniform vec3 uPool, uOak, uLit, uShade, uMoon, uMoonHi, uLamp;
  uniform vec4 uBeamFoot[2];  // xyz: where a hero moonbeam lands, w: its half width
  uniform vec3 uBeamAxis[2];
  uniform vec4 uLamps[8];     // xyz: a bright lamp, w: reach (0 = none)
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
    // (by night a deeper body: the veils rise)
    float contact = smoothstep(0.0, 0.45, above) * (1.0 - smoothstep(mix(0.6, 1.4, uNight), mix(2.4, 4.0, uNight), above));
    // where mist belongs: over the water, round the pool, the rim of the glen, by night everywhere low
    float r = length(vW.xz - vec2(0.0, 1.5));
    float water = 1.0 - smoothstep(0.8, mix(3.8, 5.5, uNight), stream);
    float pool = 1.0 - smoothstep(2.0, mix(6.0, 9.0, uNight), length(vW.xz - uPool.xz));
    float rim = smoothstep(18.0, 30.0, r);
    float hollow = smoothstep(-0.15, -0.8, ground) * mix(0.5, 0.85, uNight); // real dips only (pads sit at 0)
    float mask = max(max(water, pool), max(rim * mix(0.3, 0.75, uNight), hollow));
    float keepOut = smoothstep(4.5, 8.0, length(vW.xz - uOak.xz)); // not inside the workshop
    mask = max(mask * keepOut, uNight * 0.22 * smoothstep(10.0, 20.0, r));
    // where a hero moonbeam lands, the air beneath it fills with glowing mist
    float beam = 0.0;
    for (int i = 0; i < 2; i++) {
      vec3 rel = vW - uBeamFoot[i].xyz;
      vec3 off = rel - uBeamAxis[i] * dot(rel, uBeamAxis[i]);
      beam = max(beam, (1.0 - smoothstep(uBeamFoot[i].w * 0.35, uBeamFoot[i].w * 1.15, length(off))) * step(0.01, uBeamFoot[i].w));
    }
    beam *= uNight;
    mask = max(mask, beam * 0.9);
    // warm lamp glow bleeding into the haze (night)
    float warm = 0.0;
    if (uNight > 0.01) {
      for (int i = 0; i < 8; i++) {
        float d = length(vW - uLamps[i].xyz);
        warm += (1.0 - smoothstep(0.0, uLamps[i].w, d)) * step(0.01, uLamps[i].w);
      }
      // (never inside the workshop in the trunk)
      warm = clamp(warm, 0.0, 1.0) * uNight * smoothstep(3.2, 4.6, length(vW.xz - uOak.xz));
    }
    // cheap early-out before the noise (most of the plane is empty)
    if (contact * max(mask, warm) < 0.004) discard;
    // drifting wisps
    vec2 p = vW.xz * 0.11 + vec2(uTime * 0.018, -uTime * 0.011) + vLayer * 5.3;
    float n = envFbm(p) * 0.65 + envFbm(p * 2.7 - vec2(uTime * 0.03, 0.0)) * 0.35;
    float wisps = smoothstep(0.32, 0.78, n);
    // (by night a more continuous body, still drifting)
    wisps = mix(wisps, 0.3 + 0.7 * wisps, uNight);
    float a = contact * mask * wisps * uStrength * mix(0.55, 0.38, vLayer);
    a += contact * warm * 0.1 * uStrength * (0.5 + 0.5 * wisps);
    if (a < 0.003) discard;
    // sunlit mist glows warm, shaded mist stays cool; moonlit silver-blue at night
    float lit = sunVisibility(vW + vec3(0.0, 0.3, 0.0));
    vec3 col = mix(uShade, uLit, lit * (1.0 - uNight));
    col = mix(col, uMoon, uNight);
    vec4 fogV = woodlandFog(vW);
    col = mix(col, fogV.rgb, fogV.a * (1.0 - 0.5 * uNight));
    // inside a moonbeam: bright silver; near a lamp: its warm light
    col = mix(col, uMoonHi, beam * 0.85);
    col = mix(col, uLamp, warm * 0.7);
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.85));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function buildGroundMist(ctx) {
  const tier = ctx.quality?.tier ?? 'high';
  const layers = tier === 'high' ? [0.3, 0.7, 1.15] : [0.45, 0.95];
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
    uTime: { value: 0 }, // own clock: slowed down for prefers-reduced-motion
    uNight: envUniforms.uNight,
    uStrength: { value: 1 },
    uPool: { value: poolPos },
    uOak: { value: new THREE.Vector3(OAK.x, 0, OAK.z) },
    uLit: { value: new THREE.Color('#f3e2bf') },
    uShade: { value: new THREE.Color('#b9d2d0') },
    uMoon: { value: new THREE.Color('#7f9ccb') },
    uMoonHi: { value: new THREE.Color('#c9dbff').multiplyScalar(1.5) },
    uLamp: { value: new THREE.Color('#ffb46a').multiplyScalar(1.3) },
    uBeamFoot: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    uBeamAxis: { value: [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)] },
    uLamps: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
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
  // the brightest lamps (once the lighting has allocated its point lights)
  let lampsFound = false;
  function findLamps() {
    const reqs = ctx.lights?.pointRequests;
    if (!reqs) return;
    lampsFound = true;
    const top = [...reqs].sort((a, b) => b.priority - a.priority).slice(0, 8);
    top.forEach((r, i) => uniforms.uLamps.value[i].set(r.p[0], r.p[1], r.p[2], r.on ? 4.2 : 3.2));
  }
  return {
    mesh,
    uniforms,
    /** The hero moonbeams the mist lights up: [{ foot: Vector3, axis: Vector3 (normalised), width }]. */
    setBeams(beams) {
      beams.slice(0, 2).forEach((b, i) => {
        uniforms.uBeamFoot.value[i].set(b.foot.x, b.foot.y, b.foot.z, b.width * 0.5);
        uniforms.uBeamAxis.value[i].copy(b.axis).normalize();
      });
    },
    update(night, t = 0) {
      if (!lampsFound) findLamps();
      uniforms.uTime.value = t * (ctx.engine.reducedMotion ? 0.15 : 1);
      uniforms.uStrength.value = 0.42 + 0.5 * night;
    },
  };
}
