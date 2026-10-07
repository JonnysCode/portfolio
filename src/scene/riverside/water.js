// ─────────────────────────────────────────────────────────────────────────────
// The water of the glen: the stream from the plunge pool to where it leaves
// the glen, the plunge pool below the waterfall and the lily pond — ONE mesh,
// ONE draw call, drawn with a patched MeshStandardMaterial so it gets the
// glen's lighting for free: dappled canopy shadows, the painted environment
// reflection (Fresnel), lantern point lights glinting on it at night and the
// aerial-perspective fog.
//
// Geometry: a 0.25-unit grid over the stream's bounds, keeping only the cells
// that are (nearly) under water. Every vertex carries flow coordinates
// aFlow = (s, u, dirX, dirZ): s = distance along the stream, u = signed
// distance across it, dir = the flow direction — the shader scrolls its
// ripples, streaks and foam along the flow.
//
// A small RGBA mask texture (0.1 units per texel) baked from the real ground:
//   R  water depth (WL − ground height) → depth tint, soft edges, shore foam
//   G  wakes behind the rocks in the stream (elongated downstream)
//   B  turbulence (the falls' plunge, rapids between rocks)
//   A  calmness (the lily pond: isotropic ripples instead of flow streaks)
//
// Look: shallow turquoise → deep teal, painted flow streaks, foam streaks
// behind rocks, a breathing foam lip along the banks, splash rings where the
// falls land, sun sparkles (only where the sun actually reaches — shadow
// aware) and, at night, a few drifting blue-green glints.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { STREAM } from '../../world/layout.js';
import { getHeight, streamPolyline } from '../../world/ground.js';
import { sharedUniforms } from '../../core/materials.js';
import { smoothstep, clamp } from '../../core/rng.js';

const WL = STREAM.waterLevel;
const GRID = 0.25;
const TEXEL = 0.1;
const DEPTH_MIN = -0.25, DEPTH_RANGE = 1.75;

/** The stream centre line, extended a little beyond both ends so the pool and the far end get straight flow. */
function extendedLine() {
  const src = streamPolyline.pts;
  const a = src[0], b = src[1];
  const n = src.length;
  const y = src[n - 1], z = src[n - 2];
  const da = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const dz = Math.hypot(y.x - z.x, y.z - z.z) || 1;
  const pts = [];
  for (let k = 8; k >= 1; k--) pts.push({ x: a.x - ((b.x - a.x) / da) * 0.5 * k, z: a.z - ((b.z - a.z) / da) * 0.5 * k });
  pts.push(...src);
  for (let k = 1; k <= 8; k++) pts.push({ x: y.x + ((y.x - z.x) / dz) * 0.5 * k, z: y.z + ((y.z - z.z) / dz) * 0.5 * k });
  // cumulative length (s = 0 at the original start)
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const s0 = cum[8];
  for (let i = 0; i < cum.length; i++) cum[i] -= s0;
  // smoothed unit tangents per vertex
  const tan = pts.map((p, i) => {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
    return { x: (p1.x - p0.x) / l, z: (p1.z - p0.z) / l };
  });
  return { pts, cum, tan };
}

const LINE = extendedLine();

/**
 * Flow frame at a world point: { s, u, dx, dz } — s along the stream from the
 * plunge pool, u across (positive to the right of the flow), dir = flow direction.
 */
export function flowAt(x, z, out = { s: 0, u: 0, dx: 0, dz: 1 }) {
  const { pts, cum, tan } = LINE;
  let best = Infinity, bi = 0, bt = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x, az = pts[i].z;
    const abx = pts[i + 1].x - ax, abz = pts[i + 1].z - az;
    const l2 = abx * abx + abz * abz || 1;
    const t = clamp(((x - ax) * abx + (z - az) * abz) / l2, 0, 1);
    const ex = x - (ax + abx * t), ez = z - (az + abz * t);
    const d = ex * ex + ez * ez;
    if (d < best) {
      best = d;
      bi = i;
      bt = t;
    }
  }
  const t0 = tan[bi], t1 = tan[bi + 1];
  let dx = t0.x + (t1.x - t0.x) * bt, dz = t0.z + (t1.z - t0.z) * bt;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  const px = pts[bi].x + (pts[bi + 1].x - pts[bi].x) * bt;
  const pz = pts[bi].z + (pts[bi + 1].z - pts[bi].z) * bt;
  // right of the flow = (−dz, dx) rotated … use (dz, −dx) so u > 0 on the right bank looking downstream
  out.u = (x - px) * -dz + (z - pz) * dx;
  out.s = cum[bi] + (cum[bi + 1] - cum[bi]) * bt + ((x - px) * dx + (z - pz) * dz);
  out.dx = dx;
  out.dz = dz;
  return out;
}

/** Water depth at a world point (negative on dry land). */
export const depthAt = (x, z) => WL - getHeight(x, z);

/** 0 in the flowing stream → 1 in the middle of the lily pond. */
export function calmAt(x, z) {
  const o = STREAM.pond;
  const d = Math.hypot((x - o.x) * 0.9, z - o.z) / o.radius;
  return 1 - smoothstep(0.35, 0.95, d);
}

function bounds() {
  const pts = streamPolyline.pts;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const P = STREAM.pool, O = STREAM.pond;
  minX = Math.min(minX, P.x - P.radius * 1.5, O.x - O.radius * 1.4);
  maxX = Math.max(maxX, P.x + P.radius * 1.5, O.x + O.radius * 1.4);
  minZ = Math.min(minZ, P.z - P.radius * 1.5);
  maxZ = Math.max(maxZ, O.z + O.radius * 1.4);
  const m = 3.4;
  return { minX: Math.floor(minX - m), maxX: Math.ceil(maxX + m), minZ: Math.floor(minZ - m), maxZ: Math.ceil(maxZ + m) };
}

/** Grid mesh over the wet area with flow attributes. */
function buildGeometry(B) {
  const nx = Math.round((B.maxX - B.minX) / GRID);
  const nz = Math.round((B.maxZ - B.minZ) / GRID);
  const W = nx + 1;
  const depth = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) depth[j * W + i] = depthAt(B.minX + i * GRID, B.minZ + j * GRID);
  const used = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
  const pos = [];
  const flow = [];
  const idx = [];
  const f = { s: 0, u: 0, dx: 0, dz: 1 };
  const vert = (i, j) => {
    const k = j * W + i;
    if (used[k] >= 0) return used[k];
    const x = B.minX + i * GRID, z = B.minZ + j * GRID;
    flowAt(x, z, f);
    used[k] = pos.length / 3;
    pos.push(x, 0, z);
    flow.push(f.s, f.u, f.dx, f.dz);
    return used[k];
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const d = Math.max(depth[j * W + i], depth[j * W + i + 1], depth[(j + 1) * W + i], depth[(j + 1) * W + i + 1]);
      if (d < -0.03) continue;
      const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), e = vert(i + 1, j + 1);
      idx.push(a, c, b, b, c, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 4));
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/**
 * Bake the RGBA mask (depth, wakes, turbulence, calm).
 * rocks: [{ x, z, r }] boulders standing in the water; impact: { x, z, r } where the falls land.
 */
function bakeMask(B, rocks, impacts) {
  const w = Math.round((B.maxX - B.minX) / TEXEL);
  const h = Math.round((B.maxZ - B.minZ) / TEXEL);
  const data = new Uint8Array(w * h * 4);
  const wake = new Float32Array(w * h);
  const turb = new Float32Array(w * h);
  const f = { s: 0, u: 0, dx: 0, dz: 1 };
  // rock wakes: an elongated, widening tongue downstream (+ a bow wave ring)
  for (const r of rocks) {
    flowAt(r.x, r.z, f);
    const dx = f.dx, dz = f.dz;
    const len = 1.2 + r.r * 4.5;
    const reach = len + r.r + 0.6;
    const i0 = Math.max(0, Math.floor((r.x - reach - B.minX) / TEXEL)), i1 = Math.min(w - 1, Math.ceil((r.x + reach - B.minX) / TEXEL));
    const j0 = Math.max(0, Math.floor((r.z - reach - B.minZ) / TEXEL)), j1 = Math.min(h - 1, Math.ceil((r.z + reach - B.minZ) / TEXEL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = B.minX + (i + 0.5) * TEXEL - r.x, z = B.minZ + (j + 0.5) * TEXEL - r.z;
        const along = x * dx + z * dz;
        const across = -x * dz + z * dx;
        const d = Math.hypot(x, z);
        // ring hugging the rock
        let v = Math.max(0, 1 - Math.abs(d - r.r * 1.02) / (0.12 + r.r * 0.25)) * 0.9;
        if (along > 0) {
          const k = along / len;
          const halfW = r.r * (0.75 + k * 0.9);
          const side = 1 - smoothstep(halfW * 0.5, halfW, Math.abs(across));
          v = Math.max(v, side * (1 - smoothstep(0.15, 1, k)) * (along < r.r * 0.8 ? smoothstep(r.r * 0.6, r.r * 0.95, d) : 1));
        } else if (along > -r.r * 1.6) {
          // bow wave in front
          const bw = Math.max(0, 1 - Math.abs(d - r.r * 1.25) / 0.18) * smoothstep(-r.r * 1.6, -r.r * 0.4, along) * 0.6;
          v = Math.max(v, bw);
        }
        const k2 = j * w + i;
        wake[k2] = Math.max(wake[k2], v * (r.strength ?? 1));
        turb[k2] = Math.max(turb[k2], v * 0.45 * (r.strength ?? 1));
      }
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = B.minX + (i + 0.5) * TEXEL, z = B.minZ + (j + 0.5) * TEXEL;
      const k = j * w + i;
      const d = depthAt(x, z);
      let t = turb[k];
      for (const im of impacts) {
        const dd = Math.hypot(x - im.x, z - im.z);
        t = Math.max(t, (1 - smoothstep(im.r * 0.3, im.r * 2.6, dd)) * (im.strength ?? 1));
      }
      data[k * 4] = Math.round(clamp((d - DEPTH_MIN) / DEPTH_RANGE, 0, 1) * 255);
      data[k * 4 + 1] = Math.round(clamp(wake[k], 0, 1) * 255);
      data[k * 4 + 2] = Math.round(clamp(t, 0, 1) * 255);
      data[k * 4 + 3] = Math.round(calmAt(x, z) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// ─── shader patch ────────────────────────────────────────────────────────────
const VERT_PARS = /* glsl */ `
attribute vec4 aFlow;
varying vec4 vFlow;
varying vec3 vWPos;
`;
const VERT_MAIN = /* glsl */ `
vFlow = aFlow;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAG_PARS = /* glsl */ `
uniform sampler2D wMask;
uniform vec4 wRect;      // minX, minZ, 1/sizeX, 1/sizeZ
uniform float wTime;
uniform float wNight;
uniform float wDetail;
uniform vec3 wShallow;
uniform vec3 wDeep;
uniform vec3 wFoam;
uniform vec3 wStreak;
uniform vec4 wImpact[3];  // x, z, radius, strength
varying vec4 vFlow;
varying vec3 vWPos;

float wHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = wHash(i), b = wHash(i + vec2(1.0, 0.0));
  float c = wHash(i + vec2(0.0, 1.0)), d = wHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// height field of the surface: flow-aligned ripples in the stream, isotropic in the pond
float wHeight(vec2 fq, vec2 wp, float calm, float turb) {
  float h = 0.0;
  // stream: ripples stretched across the flow, travelling downstream
  float hs = wNoise(vec2(fq.x * 2.6, fq.y * 1.25)) * 0.55 + wNoise(vec2(fq.x * 5.3 + 7.0, fq.y * 2.9 - wTime * 0.35)) * 0.3;
  hs += wNoise(vec2(fq.x * 11.0, fq.y * 6.5)) * 0.12 * wDetail;
  // pond: slow lazy wavelets
  vec2 q = wp * 1.6 + vec2(wTime * 0.07, -wTime * 0.05);
  float hp = wNoise(q) * 0.4 + wNoise(q * 2.3 - vec2(wTime * 0.11, 0.0)) * 0.22;
  h = mix(hs, hp * 0.6, calm);
  // churning water below the falls
  h += turb * (wNoise(wp * 4.0 + vec2(0.0, wTime * 1.3)) - 0.5) * 0.9;
  return h;
}
`;

const FRAG_COLOR = /* glsl */ `
vec4 wm = texture2D(wMask, (vWPos.xz - wRect.xy) * wRect.zw);
float wDepth = wm.r * ${DEPTH_RANGE.toFixed(3)} + (${DEPTH_MIN.toFixed(3)});
float wWake = wm.g;
float wTurb = wm.b;
float wCalm = wm.a;
float wT = wTime;
vec2 wDir = normalize(vFlow.zw + vec2(1e-5));
vec2 wPerp = vec2(-wDir.y, wDir.x);
float wSpeed = mix(0.62, 0.05, wCalm);
// flow-space coordinates (u across, s along — scrolled downstream)
vec2 wFq = vec2(vFlow.y, vFlow.x - wT * wSpeed);

// ── normal from the height field (finite differences in flow space) ──
float wE = 0.06;
float wH0 = wHeight(wFq, vWPos.xz, wCalm, wTurb);
float wHu = wHeight(wFq + vec2(wE, 0.0), vWPos.xz + wPerp * wE, wCalm, wTurb);
float wHs = wHeight(wFq + vec2(0.0, wE), vWPos.xz + wDir * wE, wCalm, wTurb);
float wAmp = mix(0.055, 0.03, wCalm) * (1.0 + wTurb * 1.6);
vec2 wG = ((wHu - wH0) * wPerp + (wHs - wH0) * wDir) / wE * wAmp;
vec3 wN = normalize(vec3(-wG.x, 1.0, -wG.y));

// ── body colour: shallow turquoise → deep teal ──
float wDk = smoothstep(0.0, 1.05, wDepth);
vec3 wCol = mix(wShallow, wDeep, wDk);
// painted flow streaks: long, thin, broken lighter lines that travel with the water
float wSl = wNoise(vec2(vFlow.y * 1.25, (vFlow.x - wT * wSpeed * 1.15) * 0.16));
float wStreakM = smoothstep(0.03, 0.0, abs(wSl - 0.5)) * (1.0 - wCalm) * smoothstep(0.15, 0.45, wDepth);
wStreakM *= smoothstep(0.45, 0.75, wNoise(vec2(vFlow.y * 0.7 + 3.0, (vFlow.x - wT * wSpeed) * 0.9)));
wCol = mix(wCol, wStreak, wStreakM * 0.4);
// the shallows by the banks turn pale and clear
wCol = mix(wCol, wStreak * 0.85, (1.0 - smoothstep(0.02, 0.22, wDepth)) * 0.35);
// pond: drifting "ink" contour lines
float wPl = wNoise(vWPos.xz * 0.75 + vec2(wT * 0.04, -wT * 0.03));
wCol = mix(wCol, wStreak, smoothstep(0.018, 0.0, abs(wPl - 0.5)) * wCalm * 0.12 * smoothstep(0.1, 0.4, wDepth));

// ── foam ──
float wFn = wNoise(vec2(vFlow.y * 4.2, (vFlow.x - wT * wSpeed * 1.3) * 1.6));
float wFn2 = wNoise(vec2(vFlow.y * 9.0 + 3.1, (vFlow.x - wT * wSpeed * 1.5) * 3.4));
float wFoamN = wFn * 0.65 + wFn2 * 0.35;
// wakes behind the rocks: thin broken streaks trailing downstream
float wWk = wNoise(vec2(vFlow.y * 9.0, (vFlow.x - wT * wSpeed * 1.4) * 1.1)) * 0.7 + wFn2 * 0.3;
float wFoamA = pow(wWake, 1.3) * smoothstep(0.5, 0.72, wWk + wWake * 0.25) * 0.85;
// churning foam where the falls land
float wChurn = wNoise(vWPos.xz * 3.2 + vec2(wT * 0.6, -wT * 0.9)) * 0.6 + wNoise(vWPos.xz * 7.0 - vec2(wT * 1.4, 0.0)) * 0.4;
float wFoamB = smoothstep(0.75, 0.25, wChurn + (1.0 - wTurb) * 0.65) * step(0.05, wTurb);
// splash rings spreading from each impact
float wRing = 0.0;
for (int k = 0; k < 3; k++) {
  vec4 im = wImpact[k];
  if (im.w <= 0.0) continue;
  float dd = length(vWPos.xz - im.xy);
  for (int r = 0; r < 3; r++) {
    float ph = fract(wT * 0.45 + float(r) / 3.0 + float(k) * 0.37);
    float rr = im.z * (0.4 + ph * 2.4);
    float wob = (wNoise(vWPos.xz * 5.0 + float(r)) - 0.5) * 0.12;
    wRing += smoothstep(0.07, 0.0, abs(dd - rr + wob)) * (1.0 - ph) * im.w;
  }
}
wRing *= 0.8 * wDetail;
// the shore: a broken, frothy fringe (never an outline) that laps in and out
float wWob = (wNoise(vWPos.xz * 3.0 + wT * 0.35) - 0.5) * 0.05;
float wFringe = 1.0 - smoothstep(0.0, 0.06, wDepth + wWob + 0.012 * sin(wT * 1.1 + vFlow.x * 0.7));
wFringe *= smoothstep(0.35, 0.7, wNoise(vWPos.xz * 7.0 + vec2(wT * 0.2, 0.0)));
float wBand = smoothstep(0.03, 0.0, abs(wDepth + wWob - (0.12 + 0.03 * sin(wT * 1.3 + vFlow.x * 0.4))));
wBand *= smoothstep(0.55, 0.8, wNoise(vWPos.xz * 5.0 - vec2(0.0, wT * 0.25))) * 0.4 * (1.0 - wCalm * 0.7);
float wFoamT = clamp(max(max(wFoamA, wFoamB), max(wRing, max(wFringe * 0.7, wBand * wDetail))), 0.0, 1.0);

// shallow water is clear, deep water more opaque; the edge fades into the bank
float wAlpha = mix(0.32, 0.9, smoothstep(0.0, 0.75, wDepth));
wAlpha = max(wAlpha, wFoamT * 0.92);
wAlpha *= smoothstep(-0.01, 0.035, wDepth);
diffuseColor.rgb = mix(wCol, wFoam, wFoamT);
diffuseColor.a = wAlpha;
`;

const FRAG_ROUGH = /* glsl */ `
roughnessFactor = mix(0.07, 0.75, wFoamT);
`;

const FRAG_NORMAL = /* glsl */ `
normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
`;

const FRAG_LIGHT = /* glsl */ `
{
  // where the sun (or moon) really reaches: irradiance / albedo, shadow-aware
  float wAlb = max(dot(diffuseColor.rgb, vec3(0.333)), 0.02);
  float wLit = clamp(dot(reflectedLight.directDiffuse, vec3(0.333)) / wAlb * 0.45, 0.0, 1.6);
  // sparkles: tiny cells twinkling on the ripples, drifting with the flow
  vec2 wc = vec2(vFlow.y, vFlow.x - wT * wSpeed) * vec2(7.0, 5.0);
  vec2 wci = floor(wc);
  float wh = wHash(wci);
  vec2 wcf = fract(wc) - 0.5 - (vec2(wHash(wci + 3.1), wHash(wci + 7.7)) - 0.5) * 0.6;
  float wTw = step(0.9, wh) * pow(max(0.0, sin(wT * (2.0 + 4.0 * wh) + wh * 40.0)), 6.0);
  float wSp = wTw * smoothstep(0.07, 0.0, length(wcf)) * (1.0 - wFoamT) * smoothstep(0.05, 0.3, wDepth);
  totalEmissiveRadiance += vec3(1.0, 0.94, 0.8) * wSp * smoothstep(0.35, 1.0, wLit) * 0.7 * wDetail;
  // night: a few drifting blue-green glints (the stream is a little enchanted)
  float wGl = step(0.965, wHash(wci + 11.0)) * (0.5 + 0.5 * sin(wT * 1.7 + wh * 30.0));
  totalEmissiveRadiance += vec3(0.35, 0.95, 0.85) * wGl * smoothstep(0.16, 0.0, length(wcf)) * wNight * 1.6 * (1.0 - wFoamT);
  // foam stays readable in the shade and at night
  totalEmissiveRadiance += wFoam * wFoamT * (0.05 + 0.08 * wNight);
}
`;

const DAY = { shallow: '#6fb3a3', deep: '#1f5a63', foam: '#f4f1e6', streak: '#cfeee6' };
const NIGHT = { shallow: '#3f7f8a', deep: '#123e52', foam: '#cad9ee', streak: '#8fbcd0' };

/**
 * Build the water surface.
 * @param {object} ctx
 * @param {{ rocks: Array<{x:number,z:number,r:number}>, impacts: Array<{x:number,z:number,r:number,strength?:number}> }} opts
 */
export function buildWater(ctx, { rocks = [], impacts = [] } = {}) {
  const B = bounds();
  const geo = buildGeometry(B);
  const mask = bakeMask(B, rocks, impacts);
  const detail = (ctx.quality?.tier ?? 'high') === 'low' ? 0 : 1;
  const u = {
    wMask: { value: mask },
    wRect: { value: new THREE.Vector4(B.minX, B.minZ, 1 / (B.maxX - B.minX), 1 / (B.maxZ - B.minZ)) },
    wTime: { value: 0 },
    wNight: sharedUniforms.uNight,
    wDetail: { value: detail },
    wShallow: { value: new THREE.Color(DAY.shallow) },
    wDeep: { value: new THREE.Color(DAY.deep) },
    wFoam: { value: new THREE.Color(DAY.foam) },
    wStreak: { value: new THREE.Color(DAY.streak) },
    wImpact: { value: [0, 1, 2].map((i) => (impacts[i] ? new THREE.Vector4(impacts[i].x, impacts[i].z, impacts[i].r, impacts[i].strength ?? 1) : new THREE.Vector4(0, 0, 0, 0))) },
  };
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    depthWrite: false,
  });
  material.name = 'riverside-water';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FRAG_LIGHT}`);
  };
  material.customProgramCacheKey = () => 'riverside-water-v1';

  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = WL;
  mesh.name = 'riverside-water';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = 1;
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  ctx.scene.add(mesh);

  const day = Object.fromEntries(Object.entries(DAY).map(([k, v]) => [k, new THREE.Color(v)]));
  const night = Object.fromEntries(Object.entries(NIGHT).map(([k, v]) => [k, new THREE.Color(v)]));
  let lastNight = -1;
  const animate = !ctx.engine?.reducedMotion;
  return {
    mesh,
    material,
    uniforms: u,
    bounds: B,
    update(dt, t) {
      u.wTime.value = animate ? t : t * 0.15;
      const n = ctx.env?.night ?? 0;
      if (n !== lastNight) {
        lastNight = n;
        u.wShallow.value.copy(day.shallow).lerp(night.shallow, n);
        u.wDeep.value.copy(day.deep).lerp(night.deep, n);
        u.wFoam.value.copy(day.foam).lerp(night.foam, n);
        u.wStreak.value.copy(day.streak).lerp(night.streak, n);
      }
    },
  };
}
