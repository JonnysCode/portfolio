// ─────────────────────────────────────────────────────────────────────────────
// Pixie dust — the visible magic of the glen by day.
//
// A second, larger layer on top of the fine sunbeam dust (sunmotes.js):
// soft 2–4 px points that twinkle (sharp sin flashes) bright enough to catch
// the bloom, warm gold with a few pale-mint ones.
//
//   anchored  lazy swirls of sparkles that hang around the magical places —
//             the Schreinerei's oak door, the fairy ring, the lily pond and
//             the waterfall pool — slowly circling and rising, fading in and
//             out over their loop. They glow on their own (magic, not dust),
//             so they also read in the shade; a little softer by night, when
//             they turn silvery-mint and the fireflies take over.
//   shafts    bigger glints drifting through the glen's air that only flash
//             where the sun gets through (env/sunlight.js) — the god rays
//             fill with twinkles.
//
// One draw call (Points, additive, no depth write), pure GPU animation; the
// anchors live in a uniform array (the fairy ring is found after the build).
// Counts scale with the quality tier.
//
// buildSparkles(ctx) → { points, uniforms, anchors, resize(pixelHeight), update(night, dt) }
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { envUniforms } from './celestial.js';
import { sunlightUniforms, SUNLIGHT_GLSL } from './sunlight.js';
import { OAK, STREAM } from '../layout.js';
import { getHeight } from '../ground.js';

/** The free (shaft) layer's volume around the glen (centre & half extents). */
const CENTER = new THREE.Vector3(-1, 5.5, 2);
const HALF = new THREE.Vector3(22, 5.5, 20);

const VERT = /* glsl */ `
  attribute vec4 aSeed;   // phase, size, speed, twinkle rate
  attribute vec2 aKind;   // x: anchor index (0–3 swirl, 4–5 moonbeam, ≥ 6 = free shaft glint), y: 1 = mint
  uniform vec3 uAnchors[6];
  uniform vec4 uShapes[6]; // radius, height (beam: length), rise / fall speed, strength
  uniform vec3 uBeamAxes[2];
  uniform float uTime, uMotion, uPx, uStrength, uAnchorK, uShaftK, uBeamK, uNight;
  uniform vec3 uCenter, uHalf;
  uniform vec3 uGold, uMint, uNightWarm, uMoonGold, uMoonMint;
  varying float vA;
  varying vec3 vCol;
  varying float vSize;
  ${SUNLIGHT_GLSL}
  void main() {
    float t = uTime * uMotion;
    int k = int(aKind.x + 0.5);
    vec3 p;
    float a;
    // twinkle rate: by night the lamp-lit motes by the workshop turn slowly
    float rate = aSeed.w;
    float sizeK = 1.0;
    if (k < 4) {
      vec3 base = uAnchors[0];
      vec4 shp = uShapes[0];
      if (k == 1) { base = uAnchors[1]; shp = uShapes[1]; }
      else if (k == 2) { base = uAnchors[2]; shp = uShapes[2]; }
      else if (k == 3) { base = uAnchors[3]; shp = uShapes[3]; }
      // a slow swirl around the anchor, rising and looping
      float r = length(position.xz) * shp.x;
      float ang = atan(position.z, position.x) + t * (0.07 + 0.1 * aSeed.z) * (aSeed.x > 0.5 ? 1.0 : -1.0);
      float h = fract(position.y + t * shp.z * (0.5 + aSeed.z) / max(shp.y, 0.1));
      p = base + vec3(cos(ang) * r, h * shp.y, sin(ang) * r);
      p += vec3(sin(t * 0.7 + aSeed.x * 31.0), sin(t * 0.53 + aSeed.x * 17.0) * 0.6, cos(t * 0.61 + aSeed.x * 23.0)) * 0.12;
      // fade in at the bottom of the loop, out at the top
      a = smoothstep(0.0, 0.18, h) * (1.0 - smoothstep(0.62, 1.0, h)) * shp.w * uAnchorK;
      if (k == 0) {
        // by the Schreinerei at night: half as many, sawdust motes turning
        // slowly in the lamplight — more varied in size
        a *= 1.0 - uNight * step(0.5, fract(aSeed.x * 7.31));
        rate *= mix(1.0, 0.4, uNight);
        sizeK = mix(1.0, 0.55 + 0.9 * fract(aSeed.x * 13.7), uNight);
      }
    } else if (k < 6) {
      // slow silver motes drifting down inside a hero moonbeam (night)
      int b = k - 4;
      vec3 base = b == 0 ? uAnchors[4] : uAnchors[5];
      vec4 shp = b == 0 ? uShapes[4] : uShapes[5];
      vec3 ax = normalize(b == 0 ? uBeamAxes[0] : uBeamAxes[1]);
      vec3 u = normalize(cross(ax, vec3(0.0, 0.0, 1.0)));
      vec3 w = cross(ax, u);
      float h = fract(position.y - t * shp.z * (0.5 + aSeed.z) / max(shp.y, 0.1));
      float ang = atan(position.z, position.x) + t * 0.05 * (aSeed.x - 0.5);
      float r = length(position.xz) * shp.x;
      p = base + ax * (h * shp.y) + (u * cos(ang) + w * sin(ang)) * r;
      p += vec3(sin(t * 0.31 + aSeed.x * 19.0), 0.0, cos(t * 0.27 + aSeed.x * 11.0)) * 0.15;
      a = smoothstep(0.0, 0.06, h) * (1.0 - smoothstep(0.35, 0.7, h)) * shp.w * uBeamK;
      rate *= 0.45;
    } else {
      // free glints drifting through the glen; only where the sun gets through
      p = position + vec3(0.12, 0.06, 0.08) * t * aSeed.z;
      p += vec3(sin(t * 0.33 + aSeed.x * 6.28), sin(t * 0.25 + aSeed.x * 4.1) * 0.6, cos(t * 0.29 + aSeed.x * 5.3)) * 0.5;
      vec3 rel = mod(p - uCenter + uHalf, uHalf * 2.0);
      p = rel + uCenter - uHalf;
      vec3 e = abs(rel - uHalf) / uHalf;
      a = sunVisibility(p) * (1.0 - smoothstep(0.75, 1.0, max(max(e.x, e.y), e.z))) * uShaftK;
    }
    // colour: gold & mint by day; by night warm gold by the workshop and the
    // falls pool (motes in lamplight), silver-mint only at the fairy ring and
    // the pond, silver in the moonbeams
    vec3 dayCol = mix(uGold, uMint, aKind.y);
    vec3 nightCol = (k == 1 || k == 2) ? mix(uMoonGold, uMoonMint, aKind.y) : (k == 4 || k == 5) ? uMoonGold : uNightWarm;
    vCol = mix(dayCol, nightCol, uNight);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    // twinkle: mostly a soft glow with sharp bright flashes (slower with reduced motion)
    float s = 0.5 + 0.5 * sin(uTime * max(uMotion, 0.3) * rate + aSeed.x * 47.0);
    float tw = 0.4 + 0.6 * pow(s, 5.0);
    a *= tw * smoothstep(0.6, 2.2, dist) * (1.0 - smoothstep(70.0, 110.0, dist)) * uStrength;
    vA = a;
    gl_PointSize = clamp(aSeed.y * sizeK * 70.0 * uPx / dist, 2.0 * uPx, 4.2 * uPx * max(sizeK, 1.0)) * (0.8 + 0.25 * tw);
    vSize = gl_PointSize;
    if (a < 0.004) gl_PointSize = 0.0;
  }
`;

const FRAG = /* glsl */ `
  varying float vA;
  varying vec3 vCol;
  varying float vSize;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    // a hot little core in a soft round halo — but a 2–3 px point only has
    // pixels on its rim, so small points use a flat round kernel instead
    float soft = exp(-d * d * 4.0) * 0.75 + exp(-d * d * 18.0) * 0.55;
    float disc = 1.0 - smoothstep(0.6, 1.0, d);
    float a = mix(disc, soft, smoothstep(3.0, 7.0, vSize)) * (1.0 - smoothstep(0.85, 1.0, d));
    gl_FragColor = vec4(vCol * a * vA, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The magical places the sparkles gather around: [x, y, z], radius, height, rise speed, strength. */
function anchorDefs() {
  const door = { x: OAK.door.x + 0.2, z: OAK.door.z + 1.6 };
  return [
    { name: 'door', p: [door.x, getHeight(door.x, door.z) + 0.15, door.z], radius: 2.4, height: 3.2, rise: 0.16, strength: 1, count: 70 },
    // the fairy ring (refined once the vegetation's hotspot is known)
    { name: 'ring', p: [-4.5, getHeight(-4.5, 11.2) + 0.05, 11.2], radius: 1.7, height: 2.6, rise: 0.14, strength: 1.1, count: 60 },
    { name: 'pond', p: [STREAM.pond.x, getHeight(STREAM.pond.x, STREAM.pond.z) + 0.15, STREAM.pond.z], radius: STREAM.pond.radius * 0.85, height: 2.4, rise: 0.1, strength: 0.9, count: 80 },
    { name: 'pool', p: [STREAM.pool.x, getHeight(STREAM.pool.x, STREAM.pool.z) + 0.2, STREAM.pool.z], radius: STREAM.pool.radius * 1.1, height: 4.6, rise: 0.22, strength: 1, count: 70 },
    // motes inside the two hero moonbeams (placed with the beams; night only)
    { name: 'beamA', p: [0, -50, 0], radius: 1.6, height: 24, rise: 0.25, strength: 0.9, count: 45 },
    { name: 'beamB', p: [0, -50, 0], radius: 1.5, height: 30, rise: 0.25, strength: 0.9, count: 45 },
  ];
}

export function buildSparkles(ctx) {
  const tier = ctx.quality?.tier ?? 'high';
  const scale = tier === 'high' ? 1 : tier === 'medium' ? 0.65 : 0.45;
  const defs = anchorDefs();
  const rng = createRng('sparkles');
  const anchored = defs.map((d) => Math.round(d.count * scale));
  const free = Math.round(260 * scale);
  const count = anchored.reduce((s, n) => s + n, 0) + free;
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  const kind = new Float32Array(count * 2);
  let i = 0;
  const put = (x, y, z, k) => {
    pos.set([x, y, z], i * 3);
    // a few big ones; the rest small
    seed.set([rng.next(), rng.range(0.7, 1.3) * (rng.next() < 0.15 ? 1.6 : 1), rng.next(), rng.range(0.8, 3.2)], i * 4);
    kind.set([k, rng.next() < 0.25 ? 1 : 0], i * 2);
    i++;
  };
  defs.forEach((d, k) => {
    for (let n = 0; n < anchored[k]; n++) {
      // unit disc offset (denser towards the middle) + loop phase in y
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * 0.85 + 0.15;
      put(Math.cos(a) * r, rng.next(), Math.sin(a) * r, k);
    }
  });
  for (let n = 0; n < free; n++) {
    put(CENTER.x + rng.range(-HALF.x, HALF.x), CENTER.y - HALF.y + Math.pow(rng.next(), 1.4) * HALF.y * 2, CENTER.z + rng.range(-HALF.z, HALF.z), defs.length);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 2));

  const anchors = defs.map((d) => new THREE.Vector3(...d.p));
  const shapes = defs.map((d) => new THREE.Vector4(d.radius, d.height, d.rise, d.strength));
  // (HDR, but saturated enough to stay gold / mint through the tone curve)
  const gold = new THREE.Color('#ffbe55').multiplyScalar(2.3);
  const mint = new THREE.Color('#a8ffd2').multiplyScalar(1.8);
  const uniforms = {
    ...sunlightUniforms,
    uTime: envUniforms.uTime,
    uMotion: { value: ctx.engine.reducedMotion ? 0.12 : 1 },
    uPx: { value: 1 },
    uStrength: { value: 1 },
    uAnchorK: { value: 1 },
    uShaftK: { value: 1 },
    uBeamK: { value: 0 },
    uNight: { value: 0 },
    uAnchors: { value: anchors },
    uShapes: { value: shapes },
    uBeamAxes: { value: [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)] },
    uCenter: { value: CENTER },
    uHalf: { value: HALF },
    uGold: { value: gold },
    uMint: { value: mint },
    // night: warm sawdust-gold in the lamplight, silver & silver-mint in the moonlight
    uNightWarm: { value: new THREE.Color('#ffb24a').multiplyScalar(1.7) },
    uMoonGold: { value: new THREE.Color('#d8e4ff').multiplyScalar(1.6) },
    uMoonMint: { value: new THREE.Color('#b4ffdc').multiplyScalar(1.7) },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'pixie-dust',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'pixie-dust';
  points.frustumCulled = false;
  points.renderOrder = 7;
  points.raycast = () => {};

  return {
    points,
    uniforms,
    anchors: Object.fromEntries(defs.map((d, k) => [d.name, anchors[k]])),
    resize(pixelHeight) {
      uniforms.uPx.value = Math.max(0.5, pixelHeight / 720);
    },
    /** The hero moonbeams: [{ foot: Vector3, axis: Vector3, width, length }] — motes drift down inside them. */
    setBeams(beams) {
      beams.slice(0, 2).forEach((b, i) => {
        anchors[4 + i].copy(b.foot);
        uniforms.uBeamAxes.value[i].copy(b.axis).normalize();
        shapes[4 + i].x = b.width * 0.36;
        shapes[4 + i].y = b.length;
      });
    },
    update(night) {
      // day: golden twinkles everywhere magic lives + glints in the sunbeams;
      // night: a softer shimmer around the anchors (warm by the workshop,
      // silver-mint at the ring and the pond) + motes in the moonbeams
      const day = 1 - THREE.MathUtils.smoothstep(night, 0.1, 0.5);
      uniforms.uShaftK.value = day;
      uniforms.uAnchorK.value = day + (1 - day) * 0.5;
      uniforms.uBeamK.value = THREE.MathUtils.smoothstep(night, 0.6, 0.95);
      uniforms.uNight.value = night;
    },
  };
}
