// ─────────────────────────────────────────────────────────────────────────────
// Water — the village pond (layout.POND) and everything around it.
//
// Surface: a stylized shader. Depth comes from a small texture baked from the
// real ground heights (so colour, transparency and the foam line follow the
// actual, slightly wobbly shore), animated toon ripples, crisp sun/moon glints
// that twinkle, drifting "ink line" wavelets, occasional fish rings, a soft
// foam ring at the shoreline and a sky reflection tint shared with the sky
// (envUniforms) so it follows day ↔ night.
//
// Around it (see env/pondProps.js): a timber jetty on the north shore where the
// pond path arrives (colliders keep walkers on the bank), a moored rowboat,
// lily pads with flowers, reed & cattail clumps, stepping stones with a frog,
// and a duck family paddling loops.
//
// ctx.pond = { surface, jetty: { x, zStart, zEnd, deckY, halfWidth, endPostZ }, waterLevel }
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { POND } from './layout.js';
import { getHeight } from './ground.js';
import { createRng } from '../core/rng.js';
import { envUniforms, GLSL_NOISE } from './env/celestial.js';
import {
  buildDock,
  buildBoat,
  buildLilies,
  buildReeds,
  buildStones,
  buildFrog,
  buildDucks,
  depthAt,
} from './env/pondProps.js';

const WL = POND.waterLevel;
const TEX_RES = 96;
const EXTENT = POND.radius * 1.3; // half size of the depth texture
const DEPTH_MIN = -0.5, DEPTH_RANGE = 2.0;

function bakeDepthTexture() {
  const data = new Uint8Array(TEX_RES * TEX_RES);
  for (let j = 0; j < TEX_RES; j++) {
    for (let i = 0; i < TEX_RES; i++) {
      const x = POND.center.x - EXTENT + ((i + 0.5) / TEX_RES) * EXTENT * 2;
      const z = POND.center.z - EXTENT + ((j + 0.5) / TEX_RES) * EXTENT * 2;
      const d = WL - getHeight(x, z);
      data[j * TEX_RES + i] = Math.round(THREE.MathUtils.clamp((d - DEPTH_MIN) / DEPTH_RANGE, 0, 1) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, TEX_RES, TEX_RES, THREE.RedFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const waterVertex = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const waterFragment = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform sampler2D uDepth;
  uniform vec2 uCenter;
  uniform float uExtent, uTime, uNight, uDetail;
  uniform vec3 uShallow, uDeep, uFoam, uLine;
  uniform vec3 uSkyZenith, uSkyMid, uSkyHorizon, uKeyDir, uKeyColor;
  varying vec3 vWorld;
  ${GLSL_NOISE}

  float waterDepth(vec2 p) {
    vec2 uv = (p - uCenter) / (2.0 * uExtent) + 0.5;
    return texture2D(uDepth, uv).r * ${DEPTH_RANGE.toFixed(2)} + (${DEPTH_MIN.toFixed(2)});
  }

  void main() {
    vec2 p = vWorld.xz;
    float t = uTime;
    float depth = waterDepth(p);

    // ── ripple normal: three soft swells + drifting noise ──
    vec2 g = vec2(0.0);
    vec2 d1 = vec2(0.8, 0.6), d2 = vec2(-0.55, 0.83), d3 = vec2(0.2, -0.98);
    g += d1 * cos(dot(p, d1) * 2.1 + t * 1.3) * 0.045;
    g += d2 * cos(dot(p, d2) * 3.3 - t * 1.7) * 0.035;
    g += d3 * cos(dot(p, d3) * 5.2 + t * 2.2) * 0.02;
    vec2 q = p * 2.2 + vec2(t * 0.25, t * 0.18);
    float n0 = envNoise(q), nx = envNoise(q + vec2(0.08, 0.0)), nz = envNoise(q + vec2(0.0, 0.08));
    g += vec2(nx - n0, nz - n0) * 0.5;
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));

    vec3 V = normalize(cameraPosition - vWorld);
    float ndv = max(dot(n, V), 0.0);
    float fres = pow(1.0 - ndv, 4.0);

    // ── body colour by depth, sky reflection by fresnel ──
    float dk = smoothstep(0.02, 0.85, depth);
    vec3 body = mix(uShallow, uDeep, dk);
    vec3 R = reflect(-V, n);
    vec3 sky = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.35, R.y));
    sky = mix(sky, uSkyZenith, smoothstep(0.3, 0.9, R.y));
    vec3 col = mix(body, sky, clamp(0.12 + fres * 0.8, 0.0, 0.75));

    // ── toon light band: the side of each ripple facing the light is brighter ──
    float lit = dot(n, normalize(uKeyDir));
    col *= 0.92 + 0.14 * step(0.995, lit + 0.006 * sin(p.x * 3.0));

    // ── drifting wavelet lines (ink-like contours of slow noise) ──
    float wl = envNoise(p * 0.8 + vec2(t * 0.06, -t * 0.04));
    float lineMask = smoothstep(0.022, 0.0, abs(wl - 0.5)) * smoothstep(0.08, 0.3, depth);
    lineMask *= smoothstep(0.45, 0.7, envNoise(p * 1.3 - vec2(t * 0.12, t * 0.05)));
    col = mix(col, uLine, lineMask * 0.4 * uDetail);

    // ── glints: crisp highlights that twinkle (sun by day, moon by night) ──
    float spec = max(dot(R, normalize(uKeyDir)), 0.0);
    float glint = step(0.985, spec);
    vec2 cell = floor(p * 3.5);
    float h = envHash(cell);
    float tw = step(0.8, h) * step(0.9, sin(t * (2.0 + 3.0 * h) + h * 40.0));
    float sparkle = max(glint, tw * smoothstep(0.75, 0.95, spec)) * smoothstep(0.05, 0.25, depth);
    col = mix(col, uKeyColor * 1.4 + 0.2, sparkle * 0.9);

    // ── fish rings: now and then a ring spreads out somewhere ──
    float rings = 0.0;
    for (int k = 0; k < 2; k++) {
      float ph = t * 0.11 + float(k) * 0.5;
      float id = floor(ph);
      float f = fract(ph);
      vec2 c = uCenter + (vec2(envHash(vec2(id, float(k))), envHash(vec2(float(k), id + 3.0))) - 0.5) * uExtent * 0.9;
      float r = f * 2.4;
      float dist = length(p - c);
      rings += smoothstep(0.07, 0.0, abs(dist - r)) * (1.0 - f) * step(0.4, waterDepth(c));
      rings += smoothstep(0.05, 0.0, abs(dist - r * 0.6)) * (1.0 - f) * 0.6 * step(0.4, waterDepth(c));
    }
    col = mix(col, uFoam, clamp(rings, 0.0, 1.0) * 0.55 * uDetail);

    // ── foam at the shore: a solid lip plus a second band that breathes ──
    float wob = (envNoise(p * 3.0 + t * 0.4) - 0.5) * 0.05;
    float lip = 1.0 - smoothstep(0.03, 0.08, depth + wob);
    float band = smoothstep(0.025, 0.0, abs(depth + wob - (0.12 + 0.03 * sin(t * 1.4)))) * 0.75;
    float foam = max(lip, band * uDetail);
    col = mix(col, uFoam, foam);

    // shallow water is clearer, deep water more opaque
    float alpha = mix(0.5, 0.9, smoothstep(0.0, 0.7, depth));
    alpha = max(alpha, foam * 0.95);
    alpha *= smoothstep(-0.02, 0.01, depth);

    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const DAY = { shallow: '#7fcfcf', deep: '#3a8aa8', foam: '#fdf6e6', line: '#e9fbff' };
const NIGHT = { shallow: '#2f5f8a', deep: '#14284f', foam: '#a8b8e8', line: '#8fa6e0' };

export default async function build(ctx) {
  const { scene, engine } = ctx;
  const rng = createRng('pond');
  const tier = ctx.quality?.tier ?? 'high';

  // ── surface ──
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, {
    uDepth: { value: bakeDepthTexture() },
    uCenter: { value: new THREE.Vector2(POND.center.x, POND.center.z) },
    uExtent: { value: EXTENT },
    uDetail: { value: tier === 'low' ? 0 : 1 },
    uShallow: { value: new THREE.Color(DAY.shallow) },
    uDeep: { value: new THREE.Color(DAY.deep) },
    uFoam: { value: new THREE.Color(DAY.foam) },
    uLine: { value: new THREE.Color(DAY.line) },
    uTime: envUniforms.uTime,
    uNight: envUniforms.uNight,
    uSkyZenith: envUniforms.uSkyZenith,
    uSkyMid: envUniforms.uSkyMid,
    uSkyHorizon: envUniforms.uSkyHorizon,
    uKeyDir: envUniforms.uKeyDir,
    uKeyColor: envUniforms.uKeyColor,
  });
  const material = new THREE.ShaderMaterial({
    name: 'pond-water',
    uniforms,
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const surface = new THREE.Mesh(new THREE.CircleGeometry(POND.radius * 1.06, 96), material);
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(POND.center.x, WL, POND.center.z);
  surface.name = 'pond-water';
  surface.renderOrder = 2;
  surface.updateMatrix();
  surface.matrixAutoUpdate = false;
  scene.add(surface);

  // ── furniture ──
  const jetty = buildDock(ctx, rng.fork('jetty'));
  const J = jetty.info;
  // Walkers stay on the bank: the jetty is a lovely thing to look at, not to sink into.
  ctx.colliders?.addBox(J.x, (J.zStart + J.zEnd) / 2 + 0.15, J.halfWidth + 0.12, (J.zEnd - J.zStart) / 2, 0, 'pond-jetty');

  const boatPos = { x: J.x + 1.82, z: J.endPostZ - 1.55 };
  const boat = buildBoat(ctx, boatPos);

  const duckCx = POND.center.x + 0.6, duckCz = POND.center.z + 0.9;
  const avoid = (x, z) => {
    if (Math.abs(x - J.x) < 1.6 && z < J.zEnd + 0.6) return true; // jetty
    if (Math.hypot(x - boatPos.x, z - boatPos.z) < 1.9) return true; // boat
    return false;
  };
  const avoidDucks = (x, z) => avoid(x, z) || Math.abs(Math.hypot((x - duckCx) / 1.15, z - duckCz) - 3.2) < 0.9;
  buildLilies(ctx, rng.fork('lilies'), avoidDucks);
  buildReeds(ctx, rng.fork('reeds'), (x, z) => avoid(x, z) || (Math.abs(x - J.x) < 2.6 && z < J.zStart + 2.5));
  const stones = buildStones(ctx, rng.fork('stones'));
  const big = stones.stones[stones.stones.length - 1];
  const frog = buildFrog(ctx, { x: big.x, y: big.top - 0.01, z: big.z, facing: -Math.PI / 2 });
  const ducks = buildDucks(ctx);

  // ── day / night colours ──
  const day = Object.fromEntries(Object.entries(DAY).map(([k, v]) => [k, new THREE.Color(v)]));
  const night = Object.fromEntries(Object.entries(NIGHT).map(([k, v]) => [k, new THREE.Color(v)]));
  let lastNight = -1;
  const animate = !engine.reducedMotion;

  ctx.pond = { surface, jetty: J, boat: boat.group, waterLevel: WL, depthAt };

  return {
    update(dt, t) {
      const n = ctx.env?.night ?? 0;
      if (n !== lastNight) {
        lastNight = n;
        uniforms.uShallow.value.copy(day.shallow).lerp(night.shallow, n);
        uniforms.uDeep.value.copy(day.deep).lerp(night.deep, n);
        uniforms.uFoam.value.copy(day.foam).lerp(night.foam, n);
        uniforms.uLine.value.copy(day.line).lerp(night.line, n);
      }
      boat.update(t);
      frog.update(animate ? t : 0);
      ducks.update(t);
    },
  };
}
