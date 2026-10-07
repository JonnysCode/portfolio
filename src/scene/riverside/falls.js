// ─────────────────────────────────────────────────────────────────────────────
// The waterfall (STREAM.falls → STREAM.pool): a mossy rock outcrop at the
// back-right of the glen. A spring wells up between boulders on top of the
// hill, runs over a broad slab and pours down three tiers into the plunge
// pool:
//
//   tier A  the main fall from an overhanging lip slab (~2 units)
//   tier B  from the first basin ledge (~1.4)
//   tier C  from the second basin ledge into the pool (~1.5)
//
// Rocks: big layered sedimentary boulders (strata ledges, moss on every
// up-facing surface) forming a horseshoe around the pool, the ledge slabs
// under the water, a scree of smaller stones; ferns, grass, toadstools and a
// few softly glowing blue mushrooms tucked into the crevices.
//
// Water: ONE mesh for all falling sheets, the spring channel and the little
// basin pools, drawn with a custom fogged ShaderMaterial: fast streaks
// scrolling down, translucent edges, white churn at the bottom of each sheet.
// Spray: ONE Points cloud whose particles are animated entirely in the vertex
// shader (no per-frame CPU work) — puffs rising from every impact and
// drifting off as mist.
//
// Frame: u across (right-handed with up and w), w forward from the falls
// towards the pool, origin O on the falls→pool line at 30 %.
// Returns { impacts: [{x, z, r, strength}], update(dt, t) }.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { STREAM } from '../../world/layout.js';
import { getHeight } from '../../world/ground.js';
import { fogUniforms } from '../../world/env/fog.js';
import { envUniforms } from '../../world/env/celestial.js';
import { sharedUniforms } from '../../core/materials.js';
import { makePuffs } from './puffs.js';
import { M, TAU, xf, boulderGeo, stoneGeo, mossGeo, plantFern, plantGrass, addToadstool, addFlower } from './kit.js';

const WL = STREAM.waterLevel;
const ROCK_TINTS = ['#8e8b80', '#858579', '#97917f', '#7c7e74', '#9a9483', '#888476', '#7a786c'];

/** The falls frame. */
function makeFrame() {
  const f = STREAM.falls, p = STREAM.pool;
  const dx = p.x - f.x, dz = p.z - f.z;
  const L = Math.hypot(dx, dz);
  const F = new THREE.Vector3(dx / L, 0, dz / L);
  const A = new THREE.Vector3(F.z, 0, -F.x); // across: A × up = F
  const O = new THREE.Vector3(f.x + dx * 0.3, 0, f.z + dz * 0.3);
  const m = new THREE.Matrix4().makeBasis(A, new THREE.Vector3(0, 1, 0), F).setPosition(O.x, 0, O.z);
  return { m, A, F, O };
}

/** Tiers: lip (w, y) → landing (w, y), sheet half-width at the top/bottom. */
const TIERS = [
  { lipW: 0.08, lipY: 4.47, landW: 0.4, landY: 2.48, hw0: 0.42, hw1: 0.5, strength: 0.7 },
  { lipW: 0.78, lipY: 2.42, landW: 1.04, landY: 1.0, hw0: 0.52, hw1: 0.6, strength: 0.75 },
  { lipW: 1.28, lipY: 0.97, landW: 1.55, landY: WL, hw0: 0.6, hw1: 0.72, strength: 1 },
];

export function planFalls() {
  const { m } = makeFrame();
  const impacts = [];
  const last = TIERS[TIERS.length - 1];
  const p = new THREE.Vector3(0, 0, last.landW + 0.05).applyMatrix4(m);
  impacts.push({ x: p.x, z: p.z, r: 0.75, strength: 1 });
  return { impacts, frame: m };
}

// ─── water shader ────────────────────────────────────────────────────────────
const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 aInfo; // x: kind (0 sheet, 1 channel, 2 basin), y: across 0..1, z: along 0..1
varying vec3 vInfo;
varying vec3 vWPos;
varying vec3 vNrm;
void main() {
  vInfo = aInfo;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vNrm = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform float uNight;
uniform vec3 uKeyColor;
uniform vec3 uKeyDir;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
varying vec3 vInfo;
varying vec3 vWPos;
varying vec3 vNrm;
float fHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float fNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1, 0)), u.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  float kind = vInfo.x;
  float across = vInfo.y;
  float along = vInfo.z;
  float t = uTime;
  vec3 deep = vec3(0.30, 0.55, 0.58);
  vec3 white = vec3(0.96, 0.98, 1.0);
  float a;
  vec3 col;
  if (kind < 0.5) {
    // falling sheet: white strands racing down over a thin, clear veil
    vec2 q = vec2(across * 11.0, along * 2.0 - t * 2.8);
    float s1 = fNoise(q);
    float s2 = fNoise(vec2(across * 23.0 + 5.0, along * 3.5 - t * 3.6));
    float streak = smoothstep(0.42, 0.9, s1 * 0.6 + s2 * 0.5);
    // pulses travelling down the sheet
    float pulse = smoothstep(0.55, 0.9, fNoise(vec2(across * 3.0, along * 5.0 - t * 4.0)));
    float mid = min(across, 1.0 - across);
    float rag = fNoise(vec2(across * 4.0 + 9.0, along * 6.0 - t * 2.0));
    float edge = smoothstep(0.02, 0.1 + 0.18 * rag, mid);
    float churn = smoothstep(0.7, 1.0, along);
    col = mix(deep * 1.1, white, clamp(streak + pulse * 0.5, 0.0, 1.0));
    col = mix(col, white, churn);
    a = (0.16 + streak * 0.75 + pulse * 0.25) * edge;
    a = max(a, churn * 0.85 * edge * (0.6 + 0.4 * rag));
    // the lip: glassy where the water bends over
    float lip = 1.0 - smoothstep(0.0, 0.1, along);
    col = mix(col, deep * 1.25 + 0.12, lip * 0.5);
    a = mix(a, 0.7 * edge, lip * 0.6);
  } else if (kind < 1.5) {
    // the spring channel: quick ripples and white riffles running downhill
    vec2 q = vec2(across * 5.0, along * 6.0 - t * 1.6);
    float r = fNoise(q) * 0.6 + fNoise(q * 2.2 + 3.0) * 0.4;
    float riffle = smoothstep(0.62, 0.8, r);
    float edge = smoothstep(0.0, 0.2, across) * smoothstep(1.0, 0.8, across);
    col = mix(deep * 0.9, white, riffle * 0.85 + 0.12);
    a = (0.6 + riffle * 0.35) * edge;
  } else {
    // basin pools: churning white water
    vec2 q = vWPos.xz * 4.0;
    float c = fNoise(q + vec2(t * 0.9, -t * 1.3)) * 0.6 + fNoise(q * 2.4 - vec2(t * 1.7, 0.0)) * 0.4;
    float foam = smoothstep(0.35, 0.75, c);
    float edge = smoothstep(0.0, 0.25, 1.0 - along);
    col = mix(deep, white, 0.3 + foam * 0.7);
    a = (0.7 + foam * 0.3) * edge;
  }
  // lighting: soft key light + sky fill, a cool tint at night
  float ndl = max(dot(normalize(vNrm), normalize(uKeyDir)), 0.0) * 0.5 + 0.5;
  vec3 light = uKeyColor * 0.55 * ndl + uSkyHorizon * 0.55;
  col *= light;
  col += vec3(0.25, 0.55, 0.6) * uNight * 0.12 * a;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function buildFalls(ctx, B, rng) {
  const MM = M();
  const { m: frame, F: FWD } = makeFrame();
  const R = B.at(frame);
  const toWorld = (u, y, w) => new THREE.Vector3(u, y, w).applyMatrix4(frame);
  const groundAt = (u, w) => {
    const p = toWorld(u, 0, w);
    return getHeight(p.x, p.z);
  };
  const density = Math.max(0.5, ctx.quality?.density ?? 1);

  // ── rocks ────────────────────────────────────────────────────────────────
  /** One layered rock slab: wider than tall, strata ledges, moss on top. */
  const tops = [];
  const rockSlab = (u, w, y0, y1, sx, sz, opts = {}) => {
    const h = y1 - y0;
    if (h < 0.12) return;
    tops.push({ u, w, y: y1 - h * 0.08, sx, sz });
    const g = boulderGeo(rng, sx, h, sz, { strata: Math.max(1, Math.round(h / 0.32)), lump: opts.lump ?? 0.2, round: opts.round ?? 0.38, detail: sx > 1.6 ? 3 : 2 });
    xf(g, [u, y0, w], [rng.jitter(0.06), opts.rot ?? rng.jitter(0.6), rng.jitter(0.07)]);
    R.add(MM.rock, g, { color: opts.color ?? rng.pick(ROCK_TINTS), cast: opts.cast ?? true });
  };
  /** A stack of slabs from the ground (or the pool bed) up to `top`, each stepped back a little. */
  const stack = (u, w, top, opts = {}) => {
    let y = Math.max(groundAt(u, w), WL - 0.9) - 0.35;
    let k = 0;
    while (y < top - 0.1) {
      const h = Math.min(rng.range(0.35, 0.7), top - y + 0.05);
      const sx = rng.range(0.85, 1.35) * (opts.scale ?? 1);
      const sz = rng.range(0.7, 1.15) * (opts.scale ?? 1);
      // upper slabs step back from the face (towards −w) like eroded strata
      rockSlab(u + rng.jitter(0.12), w - k * rng.range(0.04, 0.12), y, y + h, sx, sz, opts);
      y += h - rng.range(0.04, 0.1);
      k++;
    }
  };
  // ledge slabs under the water (flat tops, overhanging lips)
  const slab = (u, w0, w1, top, half, thick) => {
    const g = boulderGeo(rng, half * 2, thick, w1 - w0, { strata: 2, lump: 0.08, round: 0.7 });
    xf(g, [u, top - thick, (w0 + w1) / 2], [0, rng.jitter(0.04), 0]);
    R.add(MM.rock, g, { color: rng.pick(['#7b7a70', '#86847a', '#73736a']) });
  };
  slab(0, -1.05, 0.1, TIERS[0].lipY + 0.02, 0.66, 1.2);
  slab(0.02, 0.16, 0.8, TIERS[1].lipY + 0.02, 0.82, 1.3);
  slab(-0.03, 0.8, 1.3, TIERS[2].lipY + 0.02, 0.96, 1.7);
  // the cliff: a horseshoe of slab stacks around the pool, highest by the falls
  const cliffTop = (u) => 4.85 - 0.62 * Math.pow(Math.abs(u), 1.25);
  const faceW = (u) => 0.15 + 0.2 * u * u;
  for (let u = -3.6; u <= 3.61; u += 0.72) {
    if (Math.abs(u) < 0.6) continue; // the water's path
    const uu = u + rng.jitter(0.1);
    const top = cliffTop(uu) + rng.jitter(0.25);
    if (top < 0.6) continue;
    // step the face down the tiers next to the water
    const w = faceW(uu) + (Math.abs(uu) < 1.6 ? rng.range(-0.2, 0.35) : rng.range(-0.3, 0.2));
    stack(uu, w, top);
    // a second, lower stack in front where the hill runs down into the pool
    if (Math.abs(uu) > 1.0) stack(uu + rng.jitter(0.2), w + rng.range(0.6, 1.0), Math.min(top - 0.9, groundAt(uu, w + 0.8) + 0.6), { scale: 0.85 });
    // rounded boulders on the hilltop behind
    if (rng.chance(0.7)) {
      const wb = w - rng.range(0.9, 1.7);
      const gb = groundAt(uu, wb);
      rockSlab(uu + rng.jitter(0.2), wb, gb - 0.3, gb + rng.range(0.3, 0.75), rng.range(0.8, 1.4), rng.range(0.8, 1.2), { round: 0.6 });
    }
  }
  // the spring: two big boulders on the hilltop with a crevice between
  for (const sgn of [-1, 1]) rockSlab(sgn * 0.62, -1.5, 4.35, 5.55 + rng.range(0, 0.2), 0.95, 1.0, { color: '#7f7d72', round: 0.5 });
  rockSlab(0, -2.05, 4.4, 5.75, 1.35, 0.9, { color: '#85837a', round: 0.5 });
  // boulders standing in the pool at the foot of the cliff
  for (const [u, w] of [[-1.55, 1.7], [1.7, 1.55], [-2.3, 2.3], [2.4, 2.6], [1.15, 2.4]]) {
    const gy = Math.max(groundAt(u, w), WL - 0.9);
    rockSlab(u, w, gy - 0.4, WL + rng.range(0.15, 0.5), rng.range(0.6, 0.9), rng.range(0.55, 0.8), { round: 0.6 });
  }
  // scree & pebbles around the pool rim and on ledges
  for (let i = 0; i < 46; i++) {
    const u = rng.jitter(3.4), w = rng.range(-1.5, 3.2);
    const gy = groundAt(u, w);
    if (Math.abs(u) < 0.7 && w > -1.2 && w < 1.3) continue; // keep the water path clear
    const r = rng.range(0.08, 0.22);
    const g = stoneGeo(rng, { r, sy: rng.range(0.45, 0.7), detail: 1, lump: 0.25 });
    xf(g, [u, Math.max(gy, WL - 0.15) + r * 0.15, w], [rng.jitter(0.2), rng.next() * TAU, rng.jitter(0.2)]);
    R.add(MM.pebble, g, { color: rng.pick(ROCK_TINTS), cast: false });
  }
  // greenery on the rock ledges: ferns, grass, moss & toadstools tucked on top of the slabs
  const glowSpots = [];
  const ledgePlant = (u, y, w) => {
    const k = rng.next();
    if (k < 0.34) plantFern(R, rng, u, y, w, { size: rng.range(0.35, 0.7), fronds: rng.int(6, 9), tilt: 1.0 });
    else if (k < 0.56) plantGrass(R, rng, u, y, w, { size: rng.range(0.22, 0.38), blades: 4 });
    else if (k < 0.8) {
      const m = mossGeo(rng, { r: rng.range(0.12, 0.3), h: rng.range(0.05, 0.1) });
      xf(m, [u, y - 0.02, w], [0, rng.next() * TAU, 0]);
      R.add(MM.moss, m, { color: rng.pick(['#6f8f3a', '#5d7d30', '#7f9a44', '#86a04a']), cast: false });
    } else if (k < 0.9) addToadstool(R, rng, u, y, w, { size: rng.range(0.07, 0.13), color: rng.chance(0.6) ? '#c4301f' : '#d7832e' });
    else if (k < 0.95) addFlower(R, rng, u, y, w, { size: 0.05 });
    else glowSpots.push([u, y, w]);
  };
  for (const t of tops) {
    if (Math.abs(t.u) < 0.55 && t.w > -1.2) continue; // not in the water's path
    const n = rng.chance(0.75) ? rng.int(1, 2) : 0;
    for (let i = 0; i < n; i++) ledgePlant(t.u + rng.jitter(t.sx * 0.3), t.y, t.w + rng.jitter(t.sz * 0.3));
  }
  // and on the hill slopes around the outcrop
  for (let i = 0; i < Math.round(50 * density); i++) {
    const u = rng.jitter(4.6), w = rng.range(-3.2, 2.8);
    if (Math.abs(u) < 0.6 && w > -1.3 && w < 1.6) continue;
    const gy = groundAt(u, w);
    if (gy < WL + 0.05) continue;
    ledgePlant(u, gy, w);
  }
  // a few bioluminescent mushrooms by the spring and the basins (they glow at night)
  const glowCaps = [[0.75, 4.95, -1.1], [-0.72, 4.9, -0.95], [1.05, 3.4, 0.35], [-1.15, 2.05, 0.95], [0.9, 2.0, 0.9], ...glowSpots.slice(0, 4)];
  const halos = [];
  for (const [u, y, w] of glowCaps) {
    const n = rng.int(2, 4);
    for (let k = 0; k < n; k++) {
      const x = u + rng.jitter(0.12), z = w + rng.jitter(0.12);
      const size = rng.range(0.05, 0.09);
      const h = size * rng.range(1.2, 2.0);
      R.add(MM.stem, xf(new THREE.CylinderGeometry(size * 0.15, size * 0.2, h, 6).translate(0, h / 2, 0), [x, y, z], [rng.jitter(0.2), 0, rng.jitter(0.2)]), { color: '#d8e8e0', cast: false });
      R.add(MM.glowBlue, new THREE.SphereGeometry(size * 0.6, 8, 5, 0, TAU, 0, Math.PI / 2).scale(1, 0.7, 1).translate(x, y + h, z), { cast: false });
      const wp = toWorld(x, y + h, z);
      halos.push({ x: wp.x, y: wp.y, z: wp.z, size: 0.35 });
    }
  }

  // ── water: sheets, spring channel, basin pools ───────────────────────────
  const pos = [], nrm = [], info = [], idx = [];
  const push = (p, n, i3) => {
    pos.push(p.x, p.y, p.z);
    nrm.push(n.x, n.y, n.z);
    info.push(i3[0], i3[1], i3[2]);
    return pos.length / 3 - 1;
  };
  const grid = (fn, nu, nv, kind) => {
    const base = pos.length / 3;
    const p = new THREE.Vector3(), q = new THREE.Vector3(), n = new THREE.Vector3();
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const a = i / nu, b = j / nv;
        fn(a, b, p);
        fn(Math.min(1, a + 0.01), b, q);
        const du = q.clone().sub(p);
        fn(a, Math.min(1, b + 0.01), q);
        const dv = q.clone().sub(p);
        n.crossVectors(du, dv).normalize();
        if (n.lengthSq() < 0.5) n.set(0, 1, 0);
        push(p.clone().applyMatrix4(frame), n.transformDirection(frame), [kind, a, b]);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i, b2 = a + 1, c = a + nu + 1, d = c + 1;
        idx.push(a, c, b2, b2, c, d);
      }
    }
  };
  // falling sheets: a ballistic curve from the lip, slightly convex across
  for (const T of TIERS) {
    const drop = T.lipY - T.landY;
    grid(
      (a, b, out) => {
        const hw = T.hw0 + (T.hw1 - T.hw0) * b;
        const u = (a - 0.5) * 2 * hw;
        const w = T.lipW + (T.landW - T.lipW) * Math.sqrt(b) + 0.03 * Math.sin(a * Math.PI);
        const y = T.lipY + 0.04 * (1 - b) * (1 - b) - drop * b * b * (1 - 0.15 * (1 - b)) - 0.01;
        out.set(u, y, w + 0.02 * Math.cos(a * Math.PI * 2) * b);
      },
      8,
      20,
      0
    );
  }
  // the spring channel: from the spring down over the lip slab to tier A's lip
  {
    const pts = [new THREE.Vector3(0.05, TIERS[0].lipY + 0.42, -1.4), new THREE.Vector3(-0.05, TIERS[0].lipY + 0.2, -0.95), new THREE.Vector3(0.04, TIERS[0].lipY + 0.07, -0.45), new THREE.Vector3(0, TIERS[0].lipY + 0.03, TIERS[0].lipW)];
    const c = new THREE.CatmullRomCurve3(pts);
    grid(
      (a, b, out) => {
        const p = c.getPointAt(b);
        const hw = 0.22 + b * 0.14;
        out.set(p.x + (a - 0.5) * 2 * hw, p.y + Math.sin(a * Math.PI) * 0.015, p.z);
      },
      5,
      14,
      1
    );
  }
  // basin pools on the ledges (discs, churning)
  for (const [k, T] of [[1, TIERS[1]], [2, TIERS[2]]]) {
    const cw = (TIERS[k - 1].landW + T.lipW) / 2;
    grid(
      (a, b, out) => {
        const ang = a * TAU;
        const r = b * (0.3 + 0.06 * k) * (1 + 0.12 * Math.sin(ang * 3 + k));
        out.set(Math.cos(ang) * r * 1.5, T.lipY + 0.035, cw + Math.sin(ang) * r * 0.7);
      },
      14,
      3,
      2
    );
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  wg.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 3));
  wg.setIndex(idx);
  wg.computeBoundingSphere();
  const wu = {
    ...fogUniforms(),
    uTime: { value: 0 },
    uNight: sharedUniforms.uNight,
    uKeyColor: envUniforms.uKeyColor,
    uKeyDir: envUniforms.uKeyDir,
    uSkyHorizon: envUniforms.uSkyHorizon,
    uFogColor: envUniforms.uFogColor,
  };
  const wmat = new THREE.ShaderMaterial({ name: 'falls-water', uniforms: wu, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
  const water = new THREE.Mesh(wg, wmat);
  water.name = 'falls-water';
  water.renderOrder = 2;
  water.frustumCulled = true;
  ctx.scene.add(water);

  // ── spray & mist (one vertex-animated cloud) ─────────────────────────────
  const across = new THREE.Vector3(1, 0, 0).transformDirection(frame);
  const spray = makePuffs(ctx, {
    name: 'falls-spray',
    seed: 'falls-spray',
    emitters: [
      ...TIERS.map((T, i) => ({ p: toWorld(0, T.landY + 0.02, T.landW + 0.02), n: [80, 70, 170][i], spread: T.hw1, across })),
      // a low, slow veil of mist over the plunge pool
      { p: toWorld(0, WL + 0.05, TIERS[2].landW + 0.5), n: 40, spread: 1.3, depth: 0.7, across },
    ],
    color: '#f2f7f6',
    rise: 0.75,
    spreadOut: 0.35,
    drift: FWD.clone().multiplyScalar(0.9),
    size: [0.05, 0.42],
    grow: 1.8,
    life: [0.16, 0.34],
    opacity: 0.26,
  });
  ctx.scene.add(spray.points);

  const animate = !ctx.engine?.reducedMotion;
  return {
    impacts: planFalls().impacts,
    halos,
    water,
    spray: spray.points,
    toWorld,
    update(dt, t) {
      wu.uTime.value = animate ? t : t * 0.2;
      spray.update(t);
    },
  };
}
