// ─────────────────────────────────────────────────────────────────────────────
// The waterfall (STREAM.falls → STREAM.pool): a mossy rock outcrop at the
// back-right of the glen. A spring wells up between boulders on top of the
// hill, runs over a broad slab and pours down three tiers into the plunge
// pool:
//
//   tier A  the main fall from an overhanging mossy lip slab (~2 units)
//   tier B  from the first ledge (~1.4)
//   tier C  from the second ledge into the pool (~1.5)
//
// Rocks: ONE sculpted outcrop — a terraced heightfield amphitheatre around
// the pool (a terrace per water tier, the lips exactly on its edges), its
// faces bent by noise so they bulge like weathered sandstone, moss on every
// terrace (triplanar mossy rock), a gully for the spring; a flat wet lip slab
// overhanging the face under every spill (mossy shoulders, ferns arching over,
// ivy hanging beside the water), two mossy stones framing the spout; flat
// layered slabs stacked on the terraces (never round boulders), thin strata
// shelves jutting from the faces with moss, ferns and ivy, pale roots creeping
// down from the top; river-worn stones in the pool, scree, moss mats, ferns,
// toadstools and a few softly glowing blue mushrooms.
//
// Water: ONE mesh — ONE continuous ribbon from the top lip to the pool (no
// seams between the tiers: it falls, foams across each ledge and spills over
// the next lip, narrow at the top and fanning out, its edges ragged, parting
// into ropes of water low in each drop), the spring channel and a ring of
// foam on each ledge, drawn with a custom fogged ShaderMaterial: streaks
// scrolling in travel time (so they stretch as the water speeds up), a glassy
// bend at each lip, translucent edges, white churn where it lands.
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
import { createRng } from '../../core/rng.js';
import { fogUniforms } from '../../world/env/fog.js';
import { envUniforms } from '../../world/env/celestial.js';
import { sharedUniforms } from '../../core/materials.js';
import { makePuffs } from './puffs.js';
import { RIDGE, buildRidge } from './ridge.js';
import { M, TAU, LOD, segs, xf, boulderGeo, stoneGeo, mossGeo, plantFern, plantGrass, addToadstool, addFlower, addIvy, wallFern, taperTube, Cards, flushCards, noiseA, noiseB, smooth01 } from './kit.js';

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
/** How far each lip slab overhangs the rock face (the water leaps off its front edge). */
const LIP_OUT = 0.1;
/**
 * The bed of the spring's old gully on the outcrop's top terrace, from the
 * basin where the high fall lands down to tier A's lip.
 */
const gullyBed = (w) => TIERS[0].lipY - 0.02 + 0.42 * smooth01((-w - 0.05) / 1.35);
/**
 * The HIGH FALL: the spring wells up under the roots of the giant tree on the
 * escarpment's crest (ridge.js) and drops ~6 units off the crest lip into a
 * basin on the outcrop's top terrace, then runs down the old gully to tier A.
 */
const TOP = { lipW: RIDGE.lipW, lipY: RIDGE.lipY, landW: -1.62, landY: gullyBed(-1.62) + 0.04, strength: 0.6, ledgeY: (w) => gullyBed(w) + 0.035, narrow: true };
/** Every tier from the crest down to the pool. */
const ALL = [TOP, ...TIERS];

/**
 * The fall's centre line in the frame's (w, y) — ONE continuous ribbon from
 * the crest lip to the pool: { w, y, b (fall progress, −1 on a ledge), churn,
 * tau (travel time), g (0..1 along the lower falls, < 0 on the high fall), hw
 * (half width override) } — and its ragged edges(row, k) → [left, right] u.
 */
let RIBBON = null;
function ribbon() {
  if (RIBBON) return RIBBON;
  const line = [];
  let ta = 0, prev = null;
  let tierNow = 0;
  const add = (w, y, b, churn, v, hw = null) => {
    if (prev) ta += Math.hypot(w - prev.w, y - prev.y) / v;
    prev = { w, y, b, churn, tau: ta, g: 0, tier: tierNow, hw };
    line.push(prev);
  };
  ALL.forEach((T, i) => {
    tierNow = i;
    const drop = T.lipY - T.landY;
    const w0 = T.lipW + LIP_OUT, w1 = T.landW;
    const NF = Math.max(18, Math.round(drop * 5));
    for (let k = i === 0 ? 0 : 1; k <= NF; k++) {
      const s = k / NF;
      const carry = i > 0 ? 0.35 * (1 - smooth01(s / 0.3)) : 0; // foam carried over the lip
      // the high fall: a slim veil from the crest, widening as it drops
      const hw = T.narrow ? 0.2 + 0.32 * Math.pow(s, 0.8) : null;
      add(w0 + (w1 - w0) * s, T.lipY + 0.035 * (1 - s) ** 2 - drop * s * s, s, Math.max(carry, smooth01((s - 0.74) / 0.26)), 1 + 3.2 * s * (T.narrow ? 1.5 : 1), hw);
    }
    const N2 = ALL[i + 1];
    if (N2) {
      // across the ledge to the next lip: foaming, slowing, spreading (the long
      // run from the high fall's basin follows the gully bed, funnelling in)
      const wL = N2.lipW + LIP_OUT;
      const n = Math.max(4, Math.round(Math.abs(wL - w1) / 0.14));
      for (let k = 1; k < n; k++) {
        const s = k / n;
        const w = w1 + (wL - w1) * s;
        const y = T.ledgeY ? T.ledgeY(w) : T.landY + 0.03 + (N2.lipY - T.landY) * s;
        add(w, y, -1, 1 - 0.6 * s, 0.9, T.narrow ? 0.56 - 0.26 * smooth01(s) : null);
      }
    }
  });
  // g: 0..1 along the lower falls (from tier A's lip), negative up on the high fall
  const start = line.findIndex((r) => r.tier === 1);
  let len = 0;
  for (let k = start + 1; k < line.length; k++) {
    len += Math.hypot(line[k].w - line[k - 1].w, line[k].y - line[k - 1].y);
    line[k].g = len;
  }
  for (let k = start; k < line.length; k++) line[k].g /= len;
  for (let k = 0; k < start; k++) line[k].g = -(start - k) / start;
  // half widths: narrow at the lip, fanning out as it falls, ragged on each side
  const edges = (r, k = 1) => {
    const g = Math.max(0, r.g);
    const hw = (r.hw ?? 0.3 + 0.62 * Math.pow(g, 0.9)) * (r.b < 0 ? 1.08 : 1) * k;
    const c = 0.07 * noiseB(r.g * 4 + 3.1, 1.7) * (0.3 + g);
    return [c - hw * (1 + 0.16 * noiseA(r.g * 9, 1.3)), c + hw * (1 + 0.16 * noiseA(r.g * 9, 7.7))];
  };
  /** The ribbon's row where tier i (of ALL) leaves its lip. */
  const lipRow = (i) => line.find((r) => r.tier === i && r.b === 0) ?? line.find((r) => r.tier === i);
  RIBBON = { line, edges, lipRow };
  return RIBBON;
}

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
attribute vec4 aInfo; // x: kind (0 ribbon, 0.3 its back layer, 1 channel, 2 ledge foam), y: across 0..1, z: fall progress (−1 on a ledge) / along, w: churn
attribute float aTau; // travel time from the top (streaks scroll in it)
varying vec4 vInfo;
varying float vTau;
varying vec3 vWPos;
varying vec3 vNrm;
void main() {
  vInfo = aInfo;
  vTau = aTau;
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
uniform float uFloor;
varying vec4 vInfo;
varying float vTau;
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
  float t = uTime;
  vec3 deep = vec3(0.26, 0.5, 0.52);
  vec3 white = vec3(0.96, 0.98, 1.0);
  float a;
  vec3 col;
  if (kind < 0.9) {
    // the ribbon: white strands racing down over a thin, clear green-blue veil;
    // glassy where it bends over a lip, parting into ropes of water as it
    // falls, churning white where it lands and foaming across each ledge
    float layer = step(0.15, kind);
    float b = vInfo.z;
    float churn = vInfo.w;
    float fall = step(0.0, b);
    vec2 q = vec2(across * 11.0 + layer * 17.0, vTau * 2.4 - t * 2.6);
    float s1 = fNoise(q);
    float s2 = fNoise(vec2(across * 23.0 + 5.0 + layer * 31.0, vTau * 4.0 - t * 3.8));
    float streak = smoothstep(0.42, 0.9, s1 * 0.6 + s2 * 0.5);
    float pulse = smoothstep(0.58, 0.92, fNoise(vec2(across * 3.0 + layer * 5.0, vTau * 4.5 - t * 4.2)));
    float mid = min(across, 1.0 - across);
    float rag = fNoise(vec2(across * 4.0 + 9.0, vTau * 5.0 - t * 2.2));
    float edge = smoothstep(0.0, 0.06 + 0.24 * rag, mid);
    // ropes: gaps open between strands in the lower part of each fall
    float rope = fNoise(vec2(across * 6.5 + layer * 13.0, vTau * 0.7 - t * 0.7));
    float part = mix(1.0, 0.25 + 0.75 * smoothstep(0.28, 0.55, rope), fall * smoothstep(0.2, 0.75, b) * (1.0 - churn));
    col = mix(deep * 1.1, white, clamp(streak + pulse * 0.45, 0.0, 1.0));
    a = (0.14 + streak * 0.72 + pulse * 0.22) * edge * part;
    // foam where it lands and across the ledges (bubbly, never a flat white sheet)
    float bub = fNoise(vWPos.xz * 9.0 + vec2(t * 0.8, -t * 1.1)) * 0.6 + fNoise(vec2(across * 9.0, vTau * 6.0 - t * 3.0)) * 0.4;
    float foam = churn * smoothstep(0.25, 0.7, bub + churn * 0.35);
    col = mix(col, white, foam);
    a = max(a, foam * 0.9 * edge * (0.65 + 0.35 * rag));
    // the lip: a clear, glassy green bend where the water leaves the rock
    float lip = fall * (1.0 - smoothstep(0.0, 0.14, b));
    col = mix(col, deep * 1.15 + vec3(0.05, 0.09, 0.07) + streak * 0.25, lip * 0.6);
    a = mix(a, (0.42 + streak * 0.4) * edge, lip * 0.7);
    // the back layer is a fainter, bluer veil
    col = mix(col, col * vec3(0.85, 0.95, 1.0), layer);
    a *= 1.0 - 0.45 * layer;
  } else if (kind < 1.5) {
    // the spring channel: quick ripples and white riffles running downhill
    float along = vInfo.z;
    vec2 q = vec2(across * 5.0, along * 6.0 - t * 1.6);
    float r = fNoise(q) * 0.6 + fNoise(q * 2.2 + 3.0) * 0.4;
    float riffle = smoothstep(0.62, 0.8, r);
    float edge = smoothstep(0.0, 0.25, across) * smoothstep(1.0, 0.75, across);
    col = mix(deep * 0.8 + vec3(0.02, 0.06, 0.04), white, riffle * 0.85);
    a = (0.3 + riffle * 0.55) * edge;
  } else {
    // ledge foam: churning white water with rings spreading from the landing
    float rr = vInfo.z;
    vec2 q = vWPos.xz * 4.0;
    float c = fNoise(q + vec2(t * 0.9, -t * 1.3)) * 0.6 + fNoise(q * 2.4 - vec2(t * 1.7, 0.0)) * 0.4;
    float foam = smoothstep(0.38, 0.78, c + (1.0 - rr) * 0.25);
    float ring = 0.0;
    for (int k = 0; k < 2; k++) {
      float ph = fract(t * 0.5 + float(k) * 0.5);
      ring += smoothstep(0.09, 0.0, abs(rr - (0.25 + ph * 0.75))) * (1.0 - ph);
    }
    float edge = smoothstep(0.0, 0.35, 1.0 - rr) * (0.75 + 0.25 * fNoise(q * 1.7 + 5.0));
    col = mix(deep, white, 0.35 + foam * 0.65);
    a = (0.16 + foam * 0.55 + ring * 0.35) * edge;
  }
  // lighting: soft key light + sky fill, a cool tint at night
  float ndl = max(dot(normalize(vNrm), normalize(uKeyDir)), 0.0) * 0.5 + 0.5;
  vec3 light = uKeyColor * 0.55 * ndl + uSkyHorizon * 0.55;
  col *= light;
  col += vec3(0.25, 0.55, 0.6) * uNight * 0.12 * a;
  // the fall melts into the pool's churn instead of ending in a straight line
  a *= smoothstep(uFloor - 0.04, uFloor + 0.24, vWPos.y);
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
  const density = ctx.quality?.density ?? 1;
  // the escarpment the falls pour from: crest, cliffs, scree & fern slopes, the
  // giant tree whose roots grip the rock and the spring under them (ridge.js)
  const ridge = buildRidge(ctx, R, createRng('riverside-ridge'), { toWorld, groundAt, frame });

  // ── rocks ────────────────────────────────────────────────────────────────
  /** One layered rock slab: wider than tall, strata ledges, moss on top. */
  const tops = [];
  const hangers = []; // shelf & lip edges that ivy and roots hang from
  const rockSlab = (u, w, y0, y1, sx, sz, opts = {}) => {
    const h = y1 - y0;
    if (h < 0.08) return;
    if (!opts.noTop) tops.push({ u, w, y: y1 - h * 0.08, sx, sz });
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
  // (the spring's old gully on the top terrace: gullyBed(), where the high fall's water runs to tier A)
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
    // (coarser on the lower tiers: the terraces' edges carry the shape, not the cell size)
    const STEP = LOD.k >= 1 ? 0.1 : LOD.k > 0.5 ? 0.15 : 0.18;
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
    // (only on the high tier: the coarse shadow maps below it barely show the outcrop's shadow)
    const n0 = idx.length;
    if (LOD.shadows && LOD.k >= 1) for (let i = 0; i < n0; i += 3) idx.push(idx[i], idx[i + 2], idx[i + 1]);
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
  // the lips: a flat, wet slab under each spill, overhanging the face so the
  // water leaps clear of it, with mossy shoulders either side (ferns arching
  // over the edge, ivy hanging down beside the water)
  {
    const { edges, lipRow } = ribbon();
    ALL.forEach((T, i) => {
      const [l, r] = edges(lipRow(i));
      const half = Math.max(-l, r);
      const front = T.lipW + LIP_OUT;
      const width = 2 * half + 0.75, depth = 0.85, th = 0.24 + i * 0.03;
      const g = boulderGeo(rng, width, th, depth, { strata: 1, lump: 0.1, round: 0.3, detail: 3 });
      xf(g, [(l + r) / 2, T.lipY - th * 1.06 - 0.01, front - depth / 2 + 0.05], [rng.jitter(0.03), rng.jitter(0.06), 0]);
      R.add(MM.rock, g, { color: '#77746a', cast: true });
      for (const sgn of [-1, 1]) {
        const su = sgn < 0 ? l - 0.2 : r + 0.2;
        // a velvet moss cushion on the shoulder, spilling over the front edge
        const m = mossGeo(rng, { r: 0.24, h: 0.1, sx: 1.4, sz: 1.1, seg: 10 });
        xf(m, [su + sgn * 0.05, T.lipY - 0.02, front - 0.22], [0, rng.jitter(0.4), 0]);
        R.add(MM.moss, m, { color: rng.pick(['#6f8f3a', '#5d7d30', '#7f9a44']), cast: false });
        const lip = mossGeo(rng, { r: 0.12, h: 0.05, sx: 2.2, sz: 0.8, seg: 8 });
        xf(lip, [su, T.lipY - 0.06, front - 0.02], [-0.7, 0, 0]);
        R.add(MM.moss, lip, { color: '#6a8a36', cast: false });
        wallFern(R, rng, [su + sgn * 0.08, T.lipY - 0.02, front - 0.08], [sgn * 0.45, -0.15, 1], { size: rng.range(0.3, 0.42), fronds: rng.int(6, 8) });
        hangers.push({ u: su + sgn * 0.05, w: front - 0.02, top: T.lipY - 0.05, ou: 0, ow: 1, len: 0.5, lip: true });
        if (i === 0) {
          // the spout: two mossy stones framing where the spring water leaves the hilltop
          const bu = sgn < 0 ? l - 0.3 : r + 0.3;
          const sg = boulderGeo(rng, 0.62, 0.34, 0.8, { strata: 1, lump: 0.14, round: 0.4, detail: 2 });
          xf(sg, [bu, T.lipY - 0.12, front - 0.5], [rng.jitter(0.06), rng.jitter(0.4), sgn * 0.08]);
          R.add(MM.rock, sg, { color: '#807c70', cast: true });
          const cap = mossGeo(rng, { r: 0.26, h: 0.1, sx: 1.1, sz: 1.3, seg: 10 });
          xf(cap, [bu, T.lipY + 0.2, front - 0.5], [0, rng.jitter(0.4), 0]);
          R.add(MM.moss, cap, { color: '#6f8f3a', cast: false });
        }
      }
    });
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
  // loose rock: flat, layered sandstone slabs tumbled onto the terraces and
  // the pool's rim, stacked two or three high like broken strata
  const slabStack = (u, w, base, s, { height = null, color = null } = {}) => {
    const n = height ? Math.max(2, Math.round(height / (s * 0.3))) : rng.int(1, 3);
    let y = base - 0.06;
    for (let k = 0; k < n; k++) {
      const th = height ? height / n : s * rng.range(0.2, 0.32);
      const shrink = 1 - k * (height ? 0.08 : 0.2);
      rockSlab(u + rng.jitter(0.1 * s), w + rng.jitter(0.1 * s), y, y + th + 0.03, s * rng.range(1.15, 1.5) * shrink, s * rng.range(0.8, 1.05) * shrink, {
        round: 0.28, lump: 0.12, color: color ?? rng.pick(ROCK_TINTS), noTop: k < n - 1, rot: rng.jitter(0.5),
      });
      y += th;
    }
  };
  for (let i = 0; i < 16; i++) {
    const side = i % 2 ? 1 : -1;
    const u = side * rng.range(0.95, 4.2), w = rng.range(-2.2, 2.9);
    const h = Math.max(rockH(u, w), groundAt(u, w));
    slabStack(u, w, h, rng.range(0.55, 1.2) * (w > 2 ? 0.8 : 1));
  }
  // the basin where the high fall lands, walled by two stacks of slabs
  for (const sgn of [-1, 1]) slabStack(sgn * 1.3, -1.72, 4.6, 0.78, { height: 0.7 + rng.range(0, 0.2), color: '#7f7d72' });
  // strata: thin shelves of harder rock jutting from the cliff faces, each
  // with a strip of moss and something hanging from it
  const shelves = [];
  {
    const e = 0.1;
    for (let tries = 0; tries < 900 && shelves.length < 24; tries++) {
      const u = rng.jitter(3.8), w = rng.range(-1.6, 2.6);
      if (Math.abs(u) < 0.95) continue; // beside the water, never in it
      const gu = (rockH(u + e, w) - rockH(u - e, w)) / (2 * e), gw = (rockH(u, w + e) - rockH(u, w - e)) / (2 * e);
      const sl = Math.hypot(gu, gw);
      if (sl < 1.4) continue; // steep faces only
      const h = rockH(u, w);
      if (h < groundAt(u, w) + 0.3 || h < WL + 0.35) continue;
      if (shelves.some((q) => Math.hypot(q.u - u, q.w - w) < 0.75 && Math.abs(q.y - h) < 0.45)) continue;
      const ou = -gu / sl, ow = -gw / sl;
      shelves.push({ u: u + ou * 0.1, w: w + ow * 0.1, y: h, ou, ow });
    }
    for (const sh of shelves) {
      const len = rng.range(0.7, 1.5), dep = rng.range(0.38, 0.55), th = rng.range(0.1, 0.17);
      const g = boulderGeo(rng, len, th, dep, { strata: 1, lump: 0.14, round: 0.25, detail: 2 });
      xf(g, [sh.u, sh.y - th * 0.7, sh.w], [rng.jitter(0.05), Math.atan2(sh.ou, sh.ow) + rng.jitter(0.15), rng.jitter(0.06)]);
      R.add(MM.rock, g, { color: rng.pick(ROCK_TINTS), cast: true });
      const top = sh.y + th * 0.35;
      const m = mossGeo(rng, { r: dep * 0.42, h: 0.06, sx: len / dep * 0.8, seg: 8 });
      xf(m, [sh.u + sh.ou * 0.05, top, sh.w + sh.ow * 0.05], [0, Math.atan2(sh.ou, sh.ow), 0]);
      R.add(MM.moss, m, { color: rng.pick(['#6f8f3a', '#5d7d30', '#7f9a44']), cast: false });
      const fx = sh.u + sh.ou * dep * 0.45, fz = sh.w + sh.ow * dep * 0.45;
      if (rng.chance(0.5)) wallFern(R, rng, [fx + rng.jitter(len * 0.3) * sh.ow, top, fz - rng.jitter(len * 0.3) * sh.ou], [sh.ou, -0.1, sh.ow], { size: rng.range(0.28, 0.42), fronds: rng.int(5, 8) });
      else if (rng.chance(0.5)) addFlower(R, rng, fx, top, fz, { size: 0.045, color: rng.pick(['#f4f0e6', '#7fa7e0', '#f29bb8']) });
      hangers.push({ u: fx, w: fz, top, ou: sh.ou, ow: sh.ow, len });
    }
  }
  // boulders standing in the pool at the foot of the cliff (round, river-worn)
  for (const [u, w, s] of [[-1.35, 2.35, 0.8], [1.45, 2.25, 0.7], [-2.5, 2.75, 0.9], [2.6, 2.95, 0.85], [0.95, 2.95, 0.55]]) {
    const gy = Math.max(groundAt(u, w), WL - 0.9);
    rockSlab(u, w, gy - 0.4, WL + rng.range(0.12, 0.42), s * rng.range(0.9, 1.15), s * rng.range(0.75, 1.0), { round: 0.75, lump: 0.14 });
  }
  // scree & pebbles around the pool rim and on ledges
  for (let i = 0; i < Math.round(46 * Math.max(0.5, density)); i++) {
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
    if (k < 0.24) plantFern(R, rng, u, y, w, { size: rng.range(0.4, 0.75), fronds: rng.int(8, 12), tilt: 1.35 });
    else if (k < 0.5) plantGrass(R, rng, u, y, w, { size: rng.range(0.25, 0.45), blades: 5 });
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
    if (density < 0.9 && !rng.chance(0.35 + 0.65 * density)) continue; // (thinner on phones)
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
  // ivy and pale roots hanging down the cliff from the shelves and the lips,
  // hugging the rock face
  {
    const ivy = new Cards();
    for (const hg of hangers) {
      const strands = hg.lip ? 2 : rng.int(1, 2);
      for (let k = 0; k < strands; k++) {
        const u0 = hg.u + rng.jitter(hg.len * 0.35) * hg.ow, w0 = hg.w - rng.jitter(hg.len * 0.35) * hg.ou;
        addIvy(R, rng, [u0, hg.top, w0], [hg.ou * 0.2 + rng.jitter(0.15), -1, hg.ow * 0.2], {
          length: rng.range(0.6, hg.lip ? 1.3 : 1.1),
          droop: 1.4,
          size: 0.13,
          density: 1.6,
          normal: [hg.ou, 0, hg.ow],
          cards: ivy,
        });
      }
    }
    flushCards(R, ivy, MM.ivy, null, 0);
    // roots: from the hill above, over the top edges and down the faces
    const rootFaces = faces.filter((f) => Math.abs(f.u) < 2.8).filter((f, i) => i % 2 === 0).slice(0, 9);
    for (const f of rootFaces) {
      const pts = [new THREE.Vector3(f.u + rng.jitter(0.2), f.top + 0.02, f.w - 0.35)];
      let w = f.w - 0.05, u = f.u;
      for (let y = f.top - 0.02, k = 0; k < 9 && y > groundAt(u, w) + 0.1; k++, y -= 0.22) {
        // find the face at this height, then sit just outside it (give up
        // where the face runs off sideways rather than down)
        let tries = 0;
        const w0 = w;
        while (rockH(u, w) > y && tries++ < 12) w += 0.035;
        if (rockH(u, w) > y || w - w0 > 0.4) break;
        u += rng.jitter(0.07);
        pts.push(new THREE.Vector3(u, y, w + 0.03));
      }
      if (pts.length < 3) continue;
      R.add(MM.wood, taperTube(pts, 0.035, 0.008, segs(5, 4), Math.max(6, Math.round(pts.length * 4 * LOD.k))), { color: '#4a3d31', cast: false });
      // a rootlet or two
      for (let k = 0; k < 2; k++) {
        const p = pts[1 + rng.int(0, pts.length - 2)];
        const q = [p, new THREE.Vector3(p.x + rng.jitter(0.25), p.y - rng.range(0.15, 0.35), p.z + 0.03)];
        R.add(MM.wood, taperTube(q, 0.012, 0.004, 4, 4), { color: '#55463a', cast: false });
      }
    }
  }
  // big fern clumps at the foot of the outcrop, where it meets the pool and the hill
  for (let i = 0; i < Math.round(16 * density); i++) {
    const side = rng.chance(0.5) ? 1 : -1;
    const u = side * rng.range(2.2, 4.8), w = rng.range(1.2, 3.6);
    const gy = groundAt(u, w);
    if (gy < WL + 0.08 || ridge.heightAt(u, w) > gy + 0.1) continue;
    plantFern(R, rng, u, gy, w, { size: rng.range(0.75, 1.15), fronds: rng.int(10, 14), tilt: 1.1 });
  }
  // and on the hill slopes around the outcrop
  for (let i = 0; i < Math.round(50 * density); i++) {
    const u = rng.jitter(4.6), w = rng.range(-3.2, 2.8);
    if (Math.abs(u) < 0.6 && w > -1.3 && w < 1.6) continue;
    const gy = groundAt(u, w);
    if (gy < WL + 0.05 || ridge.heightAt(u, w) > gy + 0.1) continue;
    ledgePlant(u, gy, w);
  }
  // a few bioluminescent mushrooms by the spring and the basins (they glow at night)
  const glowCaps = [[0.75, 4.95, -1.1], [-0.72, 4.9, -0.95], [1.05, 3.4, 0.35], [-1.15, 2.05, 0.95], [0.9, 2.0, 0.9], ...glowSpots.slice(0, 4), ...ridge.glowCaps];
  const halos = [];
  for (const [u, y, w] of glowCaps) {
    const n = rng.int(2, 4);
    for (let k = 0; k < n; k++) {
      const x = u + rng.jitter(0.12), z = w + rng.jitter(0.12);
      const size = rng.range(0.05, 0.09);
      const h = size * rng.range(1.2, 2.0);
      R.add(MM.stem, xf(new THREE.CylinderGeometry(size * 0.15, size * 0.2, h, LOD.k < 1 ? 4 : 6, 1, true).translate(0, h / 2, 0), [x, y, z], [rng.jitter(0.2), 0, rng.jitter(0.2)]), { color: '#d8e8e0', cast: false });
      R.add(MM.glowBlue, new THREE.SphereGeometry(size * 0.6, segs(8, 5), LOD.k < 1 ? 2 : 4, 0, TAU, 0, Math.PI / 2).scale(1, 0.7, 1).translate(x, y + h, z), { cast: false });
      const wp = toWorld(x, y + h, z);
      halos.push({ x: wp.x, y: wp.y, z: wp.z, size: 0.35 });
    }
  }

  // ── water: ONE ribbon from the lip to the pool, the spring channel, ledge foam ──
  // The fall is a single continuous strip — no seams between the tiers: it
  // leaps off the mossy lip, falls onto the first ledge, foams across it,
  // spills over the next lip … widening as it goes, its edges ragged. Per
  // vertex aInfo = (kind, across 0..1, fall progress b (−1 on a ledge), churn)
  // and aTau = travel time from the top (the streaks scroll in it, so they
  // stretch as the water accelerates).
  const pos = [], info = [], tau = [], idx = [];
  const pushV = (u, y, w, i4, ta) => {
    const p = toWorld(u, y, w);
    pos.push(p.x, p.y, p.z);
    info.push(i4[0], i4[1], i4[2], i4[3]);
    tau.push(ta);
    return pos.length / 3 - 1;
  };
  const strip = (rows, nu, rowFn) => {
    const base = pos.length / 3;
    rows.forEach((r, j) => {
      for (let i = 0; i <= nu; i++) rowFn(r, j, i / nu);
    });
    for (let j = 0; j < rows.length - 1; j++) {
      for (let i = 0; i < nu; i++) {
        const a0 = base + j * (nu + 1) + i, b0 = a0 + 1, c0 = a0 + nu + 1, d0 = c0 + 1;
        idx.push(a0, c0, b0, b0, c0, d0);
      }
    }
  };
  const { line, edges: ribbonEdges } = ribbon();
  // front sheet, then a narrower back veil just behind it (depth)
  for (const layer of [0, 1]) {
    const k = layer ? 0.82 : 1;
    strip(line, layer ? 8 : 12, (r, j, a) => {
      const [l, rr] = ribbonEdges(r, k);
      const u = l + (rr - l) * a;
      const bow = Math.sin(a * Math.PI);
      const y = r.y + (r.b < 0 ? 0.025 * bow : 0) - layer * 0.015;
      const w = r.w + (r.b >= 0 ? 0.045 * bow * Math.min(1, r.b * 4) : 0) - layer * 0.05;
      pushV(u, y, w, [layer ? 0.3 : 0, a, r.b, r.churn], r.tau);
    });
  }
  // the spring channel: from where the spring wells up under the giant's roots
  // over the crest to the high lip (its end matches the ribbon's top)
  {
    const c = new THREE.CatmullRomCurve3([...ridge.spring.map(([u, y, w]) => new THREE.Vector3(u, y, w)), new THREE.Vector3(0, TOP.lipY + 0.04, TOP.lipW + LIP_OUT - 0.02)]);
    const [l0, r0] = ribbonEdges(line[0], 1);
    const rows = Array.from({ length: 13 }, (_, j) => j / 12);
    strip(rows, 5, (b, j, a) => {
      const p = c.getPointAt(b);
      const hw = 0.13 + b * ((r0 - l0) / 2 - 0.13);
      pushV(p.x + (a - 0.5) * 2 * hw, p.y + Math.sin(a * Math.PI) * 0.015, p.z, [1, a, b, 0], b);
    });
  }
  // foam on the ledges where the falls land (rings spreading, like the plunge pool)
  for (let k = 1; k < ALL.length; k++) {
    const T = ALL[k], P0 = ALL[k - 1];
    const cw = P0.narrow ? P0.landW + 0.1 : (P0.landW + T.lipW + LIP_OUT) / 2;
    const rows = Array.from({ length: 4 }, (_, j) => j / 3);
    strip(rows, 16, (b, j, a) => {
      const ang = a * TAU;
      const r = b * (0.32 + 0.06 * k) * (1 + 0.14 * Math.sin(ang * 3 + k));
      pushV(Math.cos(ang) * r * 1.45, P0.landY + 0.04, cw + Math.sin(ang) * r * 0.7, [2, a, b, 0], 0);
    });
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wg.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
  wg.setAttribute('aTau', new THREE.Float32BufferAttribute(tau, 1));
  wg.setIndex(idx);
  wg.computeVertexNormals();
  wg.computeBoundingSphere();
  const wu = {
    ...fogUniforms(),
    uTime: { value: 0 },
    uNight: sharedUniforms.uNight,
    uKeyColor: envUniforms.uKeyColor,
    uKeyDir: envUniforms.uKeyDir,
    uSkyHorizon: envUniforms.uSkyHorizon,
    uFogColor: envUniforms.uFogColor,
    uFloor: { value: WL },
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
      ...ALL.map((T, i) => ({ p: toWorld(0, T.landY + 0.02, T.landW + 0.02), n: [56, 48, 48, 170][i], spread: (T.hw1 ?? 0.5) * 0.8, across })),
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
    floor: WL,
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
