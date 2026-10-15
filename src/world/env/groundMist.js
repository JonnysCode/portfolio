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
// By night the mist only hugs the water: thin, broken deep-blue wisps 0.3–0.6
// above the stream, the pond and the plunge pool (a little in the real
// hollows, a faint breath at the far rim) — dry land, the building plots and
// the glen's middle stay dark, so the warm lights pop against them. Where a
// hero moonbeam lands it pools in a little silver mist and lights up any wisp
// it crosses, and near the brightest lamps the mist takes on the lanterns'
// warm glow (a tint only — lamps never make mist of their own).
//
// Never a hard sheet: besides the soft ground contact, every layer fades out
// near the lens (a short look through thin mist shows next to nothing; by
// night over the first ≈ 12 units), when it is seen edge-on (its horizon would
// be a ruler-straight line across the frame) and when the camera sits at its
// height. Building plots (ground.js PADS) get none, so a layer never slices
// through a wheel, a doorstep or a stump in a low close-up.
//
// buildGroundMist(ctx) → { mesh, uniforms, setBeams([{ foot, axis, width }]), update(night, t) }
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { heightGrid, streamGrid, GRID_RES, PADS } from '../ground.js';
import { TERRAIN_HALF_SIZE, STREAM, OAK } from '../layout.js';
import { envUniforms, GLSL_NOISE } from './celestial.js';
import { sunlightUniforms, SUNLIGHT_GLSL } from './sunlight.js';
import { fogUniforms } from './fog.js';

/**
 * The ground as the mist sees it (half floats, one texel per ground-grid node):
 * r = ground height, g = distance to the stream's centre line, b = signed
 * distance to the water's edge (stream, plunge pool, lily pond; < 0 over the
 * water), a = signed distance to the nearest building plot (< 0 on it).
 */
function groundTexture() {
  const N = GRID_RES + 1;
  const half = TERRAIN_HALF_SIZE;
  const cell = (2 * half) / GRID_RES;
  const { pool, pond } = STREAM;
  const data = new Uint16Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    const z = -half + j * cell;
    for (let i = 0; i < N; i++) {
      const x = -half + i * cell;
      const k = j * N + i;
      const wet = Math.min(
        streamGrid[k] - STREAM.halfWidth,
        Math.hypot(x - pool.x, z - pool.z) - pool.radius,
        Math.hypot((x - pond.x) * 0.9, z - pond.z) - pond.radius,
      );
      let pad = 20;
      for (const p of PADS) pad = Math.min(pad, Math.hypot(x - p.x, z - p.z) - p.r);
      data[k * 4] = THREE.DataUtils.toHalfFloat(heightGrid[k]);
      data[k * 4 + 1] = THREE.DataUtils.toHalfFloat(streamGrid[k]);
      data[k * 4 + 2] = THREE.DataUtils.toHalfFloat(Math.max(-10, Math.min(20, wet)));
      data[k * 4 + 3] = THREE.DataUtils.toHalfFloat(pad);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
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
    // (by night the wisps stay low over the water: a veil at wheel or eye
    //  level would slice through doors, wheels & walls)
    wp.y += uNight * (0.02 + aLayer * 0.12);
    vW = wp.xyz;
    vLayer = aLayer;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uGround;
  uniform float uHalf, uCells, uTime, uNight, uStrength, uWaterY;
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
    vec4 g = texture2D(uGround, uv);
    float ground = g.r;
    float stream = g.g;
    float wet = g.b;   // signed distance to the water's edge (< 0 over the water)
    float plot = g.a;  // signed distance to the nearest building plot
    float above = vW.y - ground;
    // ── the camera: never a hard sheet ──
    vec3 toF = vW - cameraPosition;
    float camD = length(toF);
    // a short look through thin mist shows next to nothing (by night the
    // foreground stays clear and dark for the warm lights)
    float near = smoothstep(mix(1.2, 2.5, uNight), mix(6.0, 12.0, uNight), camD);
    // seen edge-on, a layer's horizon would be a ruler-straight line across
    // the frame; with the camera at its height, it would slice every prop
    float edgeOn = smoothstep(0.02, 0.14, abs(toF.y) / max(camD, 1e-3));
    float level = smoothstep(0.25, 1.5, abs(cameraPosition.y - vW.y));
    float view = near * edgeOn * mix(1.0, level, 0.85);
    // never on a building plot (a wheel, a doorstep, a stump in a close-up)
    float plots = smoothstep(-0.4, 1.6, plot);
    if (view * plots < 0.01) discard;
    // ── day: drifting veils over the water, round the pool and the rim ──
    float contactD = smoothstep(0.0, 0.45, above) * (1.0 - smoothstep(0.6, 2.4, above));
    float r = length(vW.xz - vec2(0.0, 1.5));
    float water = 1.0 - smoothstep(0.8, 3.8, stream);
    float pool = 1.0 - smoothstep(2.0, 6.0, length(vW.xz - uPool.xz));
    float rim = smoothstep(18.0, 30.0, r);
    float hollow = smoothstep(-0.15, -0.8, ground); // real dips only (pads sit at 0)
    float maskD = max(max(water, pool), max(rim * 0.3, hollow * 0.5));
    // ── night: thin wisps hugging the water (0.3–0.6 above its surface and
    //    a metre onto the banks), a little in the hollows and the far rim;
    //    dry land stays dark ──
    float surf = vW.y - max(ground, uWaterY);
    float contactN = smoothstep(0.0, 0.12, surf) * (1.0 - smoothstep(0.32, 0.75, surf)) * smoothstep(0.0, 0.3, above);
    float hug = 1.0 - smoothstep(-0.6, 1.1, wet);
    float poolN = 1.0 - smoothstep(1.5, 5.5, length(vW.xz - uPool.xz));
    float maskN = max(max(hug, poolN), max(rim * 0.12, hollow * 0.35));
    float contact = mix(contactD, contactN, uNight);
    float mask = mix(maskD, maskN, uNight);
    float keepOut = smoothstep(4.5, 8.0, length(vW.xz - uOak.xz)); // not inside the workshop
    mask *= keepOut * plots;
    // a hero moonbeam: where it lands, a small low pool of glowing mist at its
    // foot; wherever mist crosses the beam it lights up silver-blue
    float beam = 0.0;
    float beamPool = 0.0;
    for (int i = 0; i < 2; i++) {
      float on = step(0.01, uBeamFoot[i].w);
      vec3 rel = vW - uBeamFoot[i].xyz;
      vec3 off = rel - uBeamAxis[i] * dot(rel, uBeamAxis[i]);
      beam = max(beam, (1.0 - smoothstep(uBeamFoot[i].w * 0.3, uBeamFoot[i].w * 1.1, length(off))) * on);
      beamPool = max(beamPool, (1.0 - smoothstep(uBeamFoot[i].w * 0.4, uBeamFoot[i].w * 1.4, length(rel.xz))) * on);
    }
    beam *= uNight;
    beamPool *= uNight * (1.0 - smoothstep(0.3, 1.2, above));
    mask = max(mask, beamPool * 0.28 * plots);
    // cheap early-out before the noise (most of the plane is empty)
    if (contact * mask * view < 0.004) discard;
    // drifting wisps (by night more broken up: patches of wisp and clear water)
    vec2 p = vW.xz * 0.11 + vec2(uTime * 0.018, -uTime * 0.011) + vLayer * 5.3;
    float n = envFbm(p) * 0.65 + envFbm(p * 2.7 - vec2(uTime * 0.03, 0.0)) * 0.35;
    float wisps = smoothstep(mix(0.32, 0.38, uNight), mix(0.78, 0.74, uNight), n);
    wisps *= mix(1.0, 0.35 + 0.65 * smoothstep(0.3, 0.6, envNoise(vW.xz * 0.37 - vec2(uTime * 0.01, 0.0))), uNight);
    float a = contact * mask * wisps * uStrength * mix(0.55, 0.38, vLayer) * view;
    if (a < 0.003) discard;
    // sunlit mist glows warm, shaded mist stays cool; deep moonlit blue at night
    float lit = sunVisibility(vW + vec3(0.0, 0.3, 0.0));
    vec3 col = mix(uShade, uLit, lit * (1.0 - uNight));
    col = mix(col, uMoon, uNight);
    vec4 fogV = woodlandFog(vW);
    col = mix(col, fogV.rgb, fogV.a * (1.0 - 0.6 * uNight));
    // inside a moonbeam: silver
    col = mix(col, uMoonHi, max(beam * 0.7, beamPool * 0.45));
    // near the brightest lamps the mist that is there takes on their warm
    // glow (a tint only: lamps never make mist of their own)
    if (uNight > 0.01) {
      float warm = 0.0;
      for (int i = 0; i < 8; i++) {
        float d = length(vW - uLamps[i].xyz);
        warm += (1.0 - smoothstep(0.0, uLamps[i].w, d)) * step(0.01, uLamps[i].w);
      }
      col = mix(col, uLamp, clamp(warm, 0.0, 1.0) * uNight * 0.65);
    }
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
    uWaterY: { value: STREAM.waterLevel },
    uPool: { value: poolPos },
    uOak: { value: new THREE.Vector3(OAK.x, 0, OAK.z) },
    uLit: { value: new THREE.Color('#f3e2bf') },
    uShade: { value: new THREE.Color('#b9d2d0') },
    // (deep moonlit blue: a tint over the dark water, never a pale milky sheet)
    uMoon: { value: new THREE.Color('#2a4a72') },
    uMoonHi: { value: new THREE.Color('#c9dbff').multiplyScalar(1.35) },
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
      // (by night thinner than by day's veils: wisps, not a body of fog)
      uniforms.uStrength.value = 0.42 + 0.2 * night;
    },
  };
}
