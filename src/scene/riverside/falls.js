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
// Rocks: ONE sculpted outcrop — a terraced heightfield amphitheatre around
// the pool (a terrace per water tier, the lips exactly on its edges), its
// faces bent by noise so they bulge like weathered sandstone, moss on every
// terrace (triplanar mossy rock), a gully for the spring; then tumbled
// boulders, river-worn stones in the pool, scree, moss mats, big ferns, ivy
// curtains over the lips, toadstools and a few softly glowing blue mushrooms.
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
import { M, TAU, xf, boulderGeo, stoneGeo, mossGeo, plantFern, plantGrass, addToadstool, addFlower, addIvy, Cards, flushCards, noiseA, noiseB, smooth01 } from './kit.js';

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
  { lipW: 0.08, lipY: 4.47, landW: 0.42, landY: 2.48, hw0: 0.5, hw1: 0.6, strength: 0.7 },
  { lipW: 0.78, lipY: 2.42, landW: 1.06, landY: 1.0, hw0: 0.6, hw1: 0.7, strength: 0.75 },
  { lipW: 1.28, lipY: 0.97, landW: 1.58, landY: WL, hw0: 0.7, hw1: 0.86, strength: 1 },
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
attribute vec4 aInfo; // x: kind (0 sheet, 1 channel, 2 basin), y: across 0..1, z: along 0..1, w: layer seed
varying vec4 vInfo;
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
varying vec4 vInfo;
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
  float layer = vInfo.w;
  float t = uTime;
  vec3 deep = vec3(0.30, 0.55, 0.58);
  vec3 white = vec3(0.96, 0.98, 1.0);
  float a;
  vec3 col;
  if (kind < 0.5) {
    // falling sheet: white strands racing down over a thin, clear veil (the
    // back layer gets its own strands, so the fall has depth)
    vec2 q = vec2(across * 11.0 + layer * 17.0, along * 2.0 - t * (2.8 - layer * 0.5));
    float s1 = fNoise(q);
    float s2 = fNoise(vec2(across * 23.0 + 5.0 + layer * 31.0, along * 3.5 - t * 3.6));
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
    // the back layer is a fainter, bluer veil
    col = mix(col, col * vec3(0.85, 0.95, 1.0), layer);
    a *= 1.0 - 0.4 * layer;
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
    const g = boulderGeo(rng, sx, h, sz, { strata: Math.max(1, Math.round(h / 0.42)), lump: opts.lump ?? 0.2, round: opts.round ?? 0.38, detail: sx > 1.1 ? 3 : 2 });
    xf(g, [u, y0, w], [rng.jitter(0.06), opts.rot ?? rng.jitter(0.6), rng.jitter(0.07)]);
    R.add(MM.rock, g, { color: opts.color ?? rng.pick(ROCK_TINTS), cast: opts.cast ?? true });
  };
  // ── the outcrop: ONE sculpted mass of terraced rock ─────────────────────
  // A heightfield in the falls frame: an amphitheatre of strata around the
  // pool, one terrace per water tier (the lips sit exactly on its edges),
  // descending towards the sides and melting into the hill behind. The faces
  // are then bent by noise so they bulge and lean like weathered sandstone;
  // the triplanar rock material paints moss over every terrace top.
  const C = 3.0; // centre of the amphitheatre (w), over the plunge pool
  const LV = [
    [1.72, TIERS[2].lipY + 0.02],
    [2.22, TIERS[1].lipY + 0.02],
    [2.92, TIERS[0].lipY + 0.02],
    [4.05, 5.3],
  ];
  const nOff = rng.next() * 40;
  // the spring's gully: the bed of the little channel from the spring to tier A's lip
  const gullyBed = (w) => TIERS[0].lipY - 0.02 + 0.42 * smooth01((-w - 0.05) / 1.35);
  const rockH = (u, w) => {
    const au = Math.abs(u);
    const wild = smooth01((au - 0.3) / 0.8); // 0 at the water → 1 away from it
    const rho = Math.hypot(u * 0.72, C - w);
    const th = Math.atan2(u, C - w);
    let h = -3;
    for (let i = 0; i < LV.length; i++) {
      const [rb, top] = LV[i];
      const b = rb + wild * (0.26 * noiseA(th * 2.4 + i * 7.1 + nOff, i * 3.3) + 0.1 * noiseB(th * 6.5 + i * 2.7, nOff));
      const k = smooth01((rho - b) / 0.26 + 0.5);
      // each terrace rises a touch towards its back wall, with soft hummocks
      const t2 = top + wild * (0.07 * (rho - b) + 0.12 * noiseB(u * 1.4 + i, w * 1.4 - nOff));
      h += (t2 - h) * k;
    }
    // lower towards the sides of the horseshoe
    h -= Math.max(0, h) * 0.55 * smooth01((au - 1.3) / 3.6);
    // the gully the spring runs down
    const gw = 1 - smooth01((au - 0.3) / 0.3);
    if (w < 0.1 && gw > 0) h += (Math.min(h, gullyBed(w)) - h) * gw;
    // melt into the hill behind and at the sides
    const g = groundAt(u, w);
    const fade = Math.max(smooth01((rho - 4.7) / 1.5), smooth01((au - 3.7) / 1.6));
    return h + (g - 0.3 - h) * fade;
  };
  {
    const STEP = 0.1;
    const u0 = -5.6, u1 = 5.6, w0 = -3.6, w1 = 3.3;
    const nu = Math.round((u1 - u0) / STEP), nw = Math.round((w1 - w0) / STEP);
    const W = nu + 1;
    const hs = new Float32Array((nu + 1) * (nw + 1));
    const gs = new Float32Array((nu + 1) * (nw + 1));
    for (let j = 0; j <= nw; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = u0 + i * STEP, w = w0 + j * STEP;
        hs[j * W + i] = rockH(u, w);
        gs[j * W + i] = groundAt(u, w);
      }
    }
    const pos = [], idx = [];
    const vid = new Int32Array((nu + 1) * (nw + 1)).fill(-1);
    const vert = (i, j) => {
      const k = j * W + i;
      if (vid[k] >= 0) return vid[k];
      let u = u0 + i * STEP, w = w0 + j * STEP;
      const y = Math.max(hs[k], gs[k] - 0.5);
      // bend the faces: bulges and leaning strata (not at the water's edge)
      const wild = smooth01((Math.abs(u) - 0.45) / 0.8) * smooth01((y - gs[k]) / 0.7);
      u += wild * (0.16 * noiseA(y * 1.7 + nOff, w * 0.9) + 0.05 * noiseB(y * 6, u * 2));
      w += wild * (0.16 * noiseB(y * 1.7 - nOff, u * 0.9) + 0.05 * noiseA(y * 6 + 3, w * 2));
      vid[k] = pos.length / 3;
      pos.push(u, y, w);
      return vid[k];
    };
    for (let j = 0; j < nw; j++) {
      for (let i = 0; i < nu; i++) {
        const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
        // keep only cells where the rock stands proud of the terrain
        if (Math.max(hs[a] - gs[a], hs[b] - gs[b], hs[c] - gs[c], hs[d] - gs[d]) < 0.08) continue;
        const va = vert(i, j), vb = vert(i + 1, j), vc = vert(i, j + 1), vd = vert(i + 1, j + 1);
        idx.push(va, vc, vb, vb, vc, vd);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // the heightfield is an open surface facing up; the shadow pass draws back
    // faces only, so add the same triangles reversed (culled in the main pass)
    // to let the outcrop cast its shadow
    const n0 = idx.length;
    for (let i = 0; i < n0; i += 3) idx.push(idx[i], idx[i + 2], idx[i + 1]);
    g.setIndex(idx);
    // colour: warm grey sandstone in strata bands, darker & damper low down
    // and in the steep faces near the water, lighter on the terrace lips
    const col = new Float32Array(pos.length);
    const base = new THREE.Color('#8f8a7c'), damp = new THREE.Color('#5d6450'), c = new THREE.Color();
    const nrm = g.attributes.normal;
    for (let v = 0; v < pos.length / 3; v++) {
      const u = pos[v * 3], y = pos[v * 3 + 1], w = pos[v * 3 + 2];
      const steep = 1 - Math.abs(nrm.getY(v));
      c.copy(base).multiplyScalar(0.86 + 0.1 * Math.sin(y * 6.5 + noiseA(u * 0.8, w * 0.8) * 2) + 0.08 * noiseB(u * 2.3 + y, w * 2.3));
      const wet = (1 - smooth01((Math.abs(u) - 0.5) / 1.2)) * 0.5 + (1 - smooth01((y - WL) / 1.2)) * 0.5;
      c.lerp(damp, wet * 0.45 * (0.4 + 0.6 * steep));
      col[v * 3] = c.r;
      col[v * 3 + 1] = c.g;
      col[v * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // (the rock material is triplanar: no UVs needed)
    R.add(MM.rock, g, { cast: true });
  }
  // terrace tops (for moss, ferns & flowers) and lip edges (for ivy curtains)
  const faces = [];
  {
    const e = 0.12;
    for (let tries = 0; tries < 900; tries++) {
      const u = rng.jitter(5.0), w = rng.range(-3.2, 2.6);
      const au = Math.abs(u);
      if (au < 0.75 && w > -1.8) continue; // the water's path
      const h = rockH(u, w);
      if (h < groundAt(u, w) + 0.15) continue;
      const sl = Math.max(Math.abs(rockH(u + e, w) - rockH(u - e, w)), Math.abs(rockH(u, w + e) - rockH(u, w - e))) / (2 * e);
      if (sl > 0.45) continue;
      // an edge: the rock drops away in front (towards the pool)
      const front = rockH(u, w + 0.35);
      if (front < h - 0.7 && faces.length < 26 && au < 3.6) faces.push({ u, w: w + 0.12, top: h, size: 0.9 });
      else if (tops.length < 120) tops.push({ u, w, y: h - 0.02, sx: rng.range(0.5, 1.1), sz: rng.range(0.5, 1.0) });
    }
  }
  // loose boulders: tumbled onto the terraces and the pool's rim, half sunk
  for (let i = 0; i < 16; i++) {
    const side = i % 2 ? 1 : -1;
    const u = side * rng.range(0.95, 4.2), w = rng.range(-2.2, 2.9);
    const h = Math.max(rockH(u, w), groundAt(u, w));
    const s = rng.range(0.55, 1.35) * (w > 2 ? 0.8 : 1);
    rockSlab(u, w, h - s * 0.3, h + s * rng.range(0.35, 0.6), s * rng.range(0.9, 1.2), s * rng.range(0.8, 1.05), { round: 0.72, lump: 0.16 });
  }
  // the spring: two boulders on the hilltop with a crevice between
  for (const sgn of [-1, 1]) rockSlab(sgn * 0.72, -1.55, 4.55, 5.6 + rng.range(0, 0.2), 0.95, 1.0, { color: '#7f7d72', round: 0.62 });
  // boulders standing in the pool at the foot of the cliff (round, river-worn)
  for (const [u, w, s] of [[-1.35, 2.35, 0.8], [1.45, 2.25, 0.7], [-2.5, 2.75, 0.9], [2.6, 2.95, 0.85], [0.95, 2.95, 0.55]]) {
    const gy = Math.max(groundAt(u, w), WL - 0.9);
    rockSlab(u, w, gy - 0.4, WL + rng.range(0.12, 0.42), s * rng.range(0.9, 1.15), s * rng.range(0.75, 1.0), { round: 0.75, lump: 0.14 });
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
    if (k < 0.36) plantFern(R, rng, u, y, w, { size: rng.range(0.45, 0.95), fronds: rng.int(7, 11), tilt: 1.0 });
    else if (k < 0.54) plantGrass(R, rng, u, y, w, { size: rng.range(0.25, 0.45), blades: 5 });
    else if (k < 0.72) {
      const m = mossGeo(rng, { r: rng.range(0.15, 0.35), h: rng.range(0.06, 0.12) });
      xf(m, [u, y - 0.02, w], [0, rng.next() * TAU, 0]);
      R.add(MM.moss, m, { color: rng.pick(['#6f8f3a', '#5d7d30', '#7f9a44', '#86a04a']), cast: false });
    } else if (k < 0.86) {
      // a little cluster of toadstools
      const col = rng.chance(0.6) ? '#c4301f' : '#d7832e';
      for (let i = 0; i < rng.int(1, 3); i++) addToadstool(R, rng, u + rng.jitter(0.12), y - 0.01, w + rng.jitter(0.12), { size: rng.range(0.07, 0.14), color: col });
    } else if (k < 0.93) for (let i = 0; i < 3; i++) addFlower(R, rng, u + rng.jitter(0.12), y, w + rng.jitter(0.12), { size: 0.05, color: rng.pick(['#f4f0e6', '#7fa7e0', '#f29bb8']) });
    else glowSpots.push([u, y, w]);
  };
  for (const t of tops) {
    if (Math.abs(t.u) < 0.6 && t.w > -1.2) continue; // not in the water's path
    // a velvet moss mat over most boulder tops (the material adds moss to the
    // up-facing sides; the mats give the tops real thickness)
    if (rng.chance(0.7)) {
      const m = mossGeo(rng, { r: Math.min(t.sx, t.sz) * rng.range(0.36, 0.46), h: rng.range(0.1, 0.16), sx: t.sx / Math.min(t.sx, t.sz), sz: t.sz / Math.min(t.sx, t.sz), seg: 10 });
      xf(m, [t.u + rng.jitter(0.1), t.y, t.w + rng.jitter(0.1)], [0, rng.jitter(0.6), 0]);
      R.add(MM.moss, m, { color: rng.pick(['#6f8f3a', '#5d7d30', '#7f9a44']), cast: false });
    }
    const n = rng.int(1, Math.max(1, Math.round(t.sx * 1.6)));
    for (let i = 0; i < n; i++) ledgePlant(t.u + rng.jitter(t.sx * 0.32), t.y, t.w + rng.jitter(t.sz * 0.32));
  }
  // ivy curtains spilling over the boulders beside the water (damp, sheltered)
  {
    const ivy = new Cards();
    for (const f of faces) {
      const strands = rng.int(2, 4);
      for (let k = 0; k < strands; k++) {
        const u0 = f.u + rng.jitter(f.size * 0.35);
        const wf = f.w + 0.04;
        addIvy(R, rng, [u0, f.top - 0.05, wf - 0.2], [rng.jitter(0.25), -1, 0.3], {
          length: rng.range(0.8, 1.7),
          droop: 1.3,
          size: 0.15,
          density: 1.5,
          normal: [0, 0, 1],
          cards: ivy,
          surface: (p, n) => {
            if (p.z < wf) p.z = wf;
            n.set(0, 0.25, 1).normalize();
          },
        });
      }
    }
    flushCards(R, ivy, MM.ivy, null, 0);
  }
  // big fern clumps at the foot of the outcrop, where it meets the pool and the hill
  for (let i = 0; i < Math.round(16 * density); i++) {
    const side = rng.chance(0.5) ? 1 : -1;
    const u = side * rng.range(2.2, 4.8), w = rng.range(1.2, 3.6);
    const gy = groundAt(u, w);
    if (gy < WL + 0.08) continue;
    plantFern(R, rng, u, gy, w, { size: rng.range(0.8, 1.25), fronds: rng.int(8, 12), tilt: 0.85 });
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
    info.push(i3[0], i3[1], i3[2], i3[3] ?? 0);
    return pos.length / 3 - 1;
  };
  const grid = (fn, nu, nv, kind, layer = 0) => {
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
        push(p.clone().applyMatrix4(frame), n.transformDirection(frame), [kind, a, b, layer]);
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
    // front sheet + a slightly narrower back layer just behind it
    for (const layer of [0, 1]) {
      const k = layer ? 0.88 : 1;
      grid(
        (a, b, out) => {
          const hw = (T.hw0 + (T.hw1 - T.hw0) * b) * k;
          const u = (a - 0.5) * 2 * hw + layer * 0.03;
          const w = T.lipW + (T.landW - T.lipW) * Math.sqrt(b) * (layer ? 0.82 : 1) + 0.04 * Math.sin(a * Math.PI) - layer * 0.04;
          const y = T.lipY + 0.04 * (1 - b) * (1 - b) - drop * b * b * (1 - 0.15 * (1 - b)) - 0.01 - layer * 0.02;
          out.set(u, y, w + 0.025 * Math.cos(a * Math.PI * 2) * b);
        },
        10,
        20,
        0,
        layer
      );
    }
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
  wg.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
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
