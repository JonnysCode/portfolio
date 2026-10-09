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
//   R  water depth (WL − ground height, blurred ~0.2 units) → bed & depth colour, soft edges, shore foam
//   G  foam at the rocks in the stream (ring, bow wave, tongue, V of the wake)
//   B  turbulence (the falls' plunge, rapids between rocks)
//   A  calmness (the lily pond: isotropic ripples instead of flow streaks)
//
// Look: the BED seen through the water by depth — silt and round river
// pebbles, clear in the shallows (warmed to olive-amber as the water drinks
// the blue, refracted by the ripples, sunlit caustics dancing on it), fading
// into scattered deep teal in the middle; soft broken bands of sheen drifting
// with the flow; a frothy ring, bow wave and V-shaped wake at every rock; a
// breathing foam lip along the banks; splash rings where the falls land;
// reflections (Fresnel): the canopy overhead (dark leaf masses, misty gaps),
// the bridge (its faces and arch traced analytically from bridge.js's profile)
// and the Velowerkstatt (cap & drum as soft shapes), all broken up by the
// ripples; sun glints gathered where the ripples mirror the sun (capped, so
// they never bloom into blotches, gone at the shadows' edges) and, at night,
// a few drifting blue-green glints, the lanterns, the workshop's lit doorway
// and the candle boats mirrored in the water (addLamp: a tall streak towards
// the viewer broken by the ripples, in a soft halo) and a faint cool glitter
// path under the moon.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { STREAM } from '../../world/layout.js';
import { getHeight, streamPolyline } from '../../world/ground.js';
import { sharedUniforms } from '../../core/materials.js';
import { envUniforms } from '../../world/env/celestial.js';
import { smoothstep, clamp } from '../../core/rng.js';
import { BRIDGE_PROFILE } from './bridge.js';

const WL = STREAM.waterLevel;
let GRID = 0.25;
const TEXEL = 0.1;
const DEPTH_MIN = -0.25, DEPTH_RANGE = 1.75;
/** Warm lights mirrored in the water at night (lanterns, the workshop door, candle boats). */
export const MAX_LAMPS = 10;

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
  // rock wakes: a frothy ring hugging the rock, a bow wave in front, a short
  // churned tongue right behind it and a V of two foam lines spreading
  // downstream (the arms of the wake)
  const V_SLOPE = Math.tan(0.36); // half-angle of the V
  for (const r of rocks) {
    flowAt(r.x, r.z, f);
    const dx = f.dx, dz = f.dz;
    const len = 1.0 + r.r * 4.0;
    const reach = len + r.r + 0.8;
    const i0 = Math.max(0, Math.floor((r.x - reach - B.minX) / TEXEL)), i1 = Math.min(w - 1, Math.ceil((r.x + reach - B.minX) / TEXEL));
    const j0 = Math.max(0, Math.floor((r.z - reach - B.minZ) / TEXEL)), j1 = Math.min(h - 1, Math.ceil((r.z + reach - B.minZ) / TEXEL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = B.minX + (i + 0.5) * TEXEL - r.x, z = B.minZ + (j + 0.5) * TEXEL - r.z;
        const along = x * dx + z * dz;
        const across = -x * dz + z * dx;
        const d = Math.hypot(x, z);
        // ring hugging the rock
        // (a rock barely breaking the surface boils rather than rings)
        let v = Math.max(0, 1 - Math.abs(d - r.r * 1.03) / (0.08 + r.r * 0.18)) * 0.8 * (0.3 + 0.7 * smoothstep(0.04, 0.2, r.h ?? 0.2));
        let tb = v * 0.45;
        if (along > 0) {
          const k = along / len;
          // the churned tongue right behind the rock
          const halfW = r.r * (0.5 + k * 0.4);
          const tongue = (1 - smoothstep(halfW * 0.4, halfW, Math.abs(across))) * (1 - smoothstep(0.0, 0.45, k)) * (along < r.r * 0.8 ? smoothstep(r.r * 0.6, r.r * 0.95, d) : 1);
          // the V: two lines leaving the rock's flanks, fading downstream
          const arm = r.r * 0.9 + along * V_SLOPE;
          const line = Math.max(0, 1 - Math.abs(Math.abs(across) - arm) / (0.05 + along * 0.05)) * (1 - smoothstep(0.25, 1.0, k)) * smoothstep(0.0, r.r * 0.6, along);
          v = Math.max(v, tongue * 0.85, line * 0.75);
          tb = Math.max(tb, tongue * 0.5);
        } else if (along > -r.r * 1.6) {
          // bow wave in front
          const bw = Math.max(0, 1 - Math.abs(d - r.r * 1.22) / 0.16) * smoothstep(-r.r * 1.6, -r.r * 0.4, along) * 0.7;
          v = Math.max(v, bw);
        }
        const k2 = j * w + i;
        wake[k2] = Math.max(wake[k2], v * (r.strength ?? 1));
        turb[k2] = Math.max(turb[k2], tb * (r.strength ?? 1));
      }
    }
  }
  // water depth, blurred over ~0.25 units (a separable box blur, twice) so the
  // depth tint never draws the contour of a carved basin as a hard ring
  const depth = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) depth[j * w + i] = depthAt(B.minX + (i + 0.5) * TEXEL, B.minZ + (j + 0.5) * TEXEL);
  const raw = depth.slice();
  {
    const tmp = new Float32Array(w * h);
    const R = 2;
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          let sum = 0, n = 0;
          for (let k = -R; k <= R; k++) {
            const ii = i + k;
            if (ii < 0 || ii >= w) continue;
            sum += depth[j * w + ii];
            n++;
          }
          tmp[j * w + i] = sum / n;
        }
      }
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          let sum = 0, n = 0;
          for (let k = -R; k <= R; k++) {
            const jj = j + k;
            if (jj < 0 || jj >= h) continue;
            sum += tmp[jj * w + i];
            n++;
          }
          // (never deeper than the real depth at the shore: the soft edge stays put)
          const real = raw[j * w + i];
          const blurred = sum / n;
          depth[j * w + i] = real < 0.12 ? Math.min(blurred, real) : blurred;
        }
      }
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = B.minX + (i + 0.5) * TEXEL, z = B.minZ + (j + 0.5) * TEXEL;
      const k = j * w + i;
      const d = depth[k];
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

const f3 = (v) => v.toFixed(4);
/** The bridge's profile in GLSL (the reflected ray meets its faces, see wBridge). */
const BRIDGE_GLSL = `
#define BR_SPAN ${f3(BRIDGE_PROFILE.span)}
#define BR_R ${f3(BRIDGE_PROFILE.r)}
#define BR_Y0 ${f3(BRIDGE_PROFILE.y0)}
#define BR_END ${f3(BRIDGE_PROFILE.end)}
#define BR_CROWN ${f3(BRIDGE_PROFILE.crown)}
#define BR_FLAT ${f3(BRIDGE_PROFILE.flat)}
#define BR_TOP ${f3(BRIDGE_PROFILE.top)}
#define BR_HW ${f3(BRIDGE_PROFILE.halfW)}
`;

const FRAG_PARS = /* glsl */ `
uniform sampler2D wMask;
uniform vec4 wRect;      // minX, minZ, 1/sizeX, 1/sizeZ
uniform float wTime;
uniform float wNight;
uniform float wDetail;
uniform vec3 wShallow;   // light scattered in shallow water (olive)
uniform vec3 wDeep;      // … and in deep water (teal)
uniform vec3 wAbsorb;    // per-channel absorption along the way down to the bed & up
uniform vec3 wFoam;
uniform vec3 wStreak;
uniform vec3 wSoil;
uniform vec3 wFog;       // the misty light between the canopy's leaf masses (reflected)
uniform vec3 wKeyDir;    // towards the key light (the sun by day)
uniform vec4 wImpact[3];  // x, z, radius, strength
uniform vec4 wLamp[${MAX_LAMPS}];    // warm lights mirrored in the water: x, y, z, radius (0 = off)
uniform vec3 wLampCol[${MAX_LAMPS}]; // their colour × strength (linear)
uniform vec3 wMoonDir;
uniform vec4 wBridgeF;   // the bridge frame: centre x, z, axis X (x, z); x = 0 → no bridge
uniform vec4 wProxP[3];  // mirrored shapes: centre x, y, z, kind (0 off, 1 ellipsoid, 2 upright cylinder)
uniform vec4 wProxR[3];  // ellipsoid: rx, ry, rz, lowest y | cylinder: radius, y0, y1, –
uniform vec3 wProxC[3];  // their albedo (linear)
varying vec4 vFlow;
varying vec3 vWPos;
${BRIDGE_GLSL}
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
// the stream bed: dark silt with round river pebbles of mixed sizes and a few
// tones lying in it (never a paving); the pond's bed is darker and leafy
vec3 wBedColor(vec2 p, float calm) {
  float n = wNoise(p * 1.3) * 0.6 + wNoise(p * 4.1 + 7.0) * 0.4;
  vec3 silt = mix(vec3(0.115, 0.095, 0.055), vec3(0.21, 0.17, 0.095), n);
  silt = mix(silt, vec3(0.06, 0.075, 0.035), calm * 0.65);
  if (wDetail < 0.5) return silt;
  vec2 g = p * 7.5;
  vec2 i = floor(g), f = fract(g);
  vec3 col = silt;
  float best = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 cid = i + o;
      float h = wHash(cid);
      float hc = wHash(cid + 3.7);
      if (hc < 0.3) continue; // bare silt
      vec2 c = o + 0.2 + vec2(h, wHash(cid + 17.31)) * 0.6 - f;
      float rad = 0.2 + 0.26 * wHash(cid + 5.3);
      float an = h * 6.2831;
      vec2 cc = vec2(c.x * cos(an) - c.y * sin(an), (c.x * sin(an) + c.y * cos(an)) * 1.35);
      float d = length(cc) / rad;
      float m = smoothstep(1.0, 0.78, d);
      if (m > best) {
        best = m;
        vec3 pc = hc < 0.5 ? vec3(0.26, 0.23, 0.17) : hc < 0.66 ? vec3(0.3, 0.22, 0.12) : hc < 0.84 ? vec3(0.19, 0.19, 0.17) : vec3(0.36, 0.32, 0.24);
        pc *= 0.8 + 0.4 * wHash(cid + 9.1);
        col = mix(silt, pc * (0.72 + 0.38 * (1.0 - d * d)), m);
      }
    }
  }
  return mix(silt, col, 1.0 - calm * 0.75);
}
float wDeckY(float x) {
  float k = min(1.0, abs(x) / BR_FLAT);
  return 0.05 + (BR_CROWN - 0.05) * pow(cos(k * 1.5707963), 1.1);
}
// does the reflected ray meet the bridge? → coverage (0..1); shade: the face
// 1.0, the arch ring a little darker, the vault overhead (seen from right under it) dark
float wBridge(vec3 P, vec3 Rd, out float shade) {
  shade = 1.0;
  vec2 X = wBridgeF.zw;
  vec2 Z = vec2(-X.y, X.x);
  vec2 d = P.xz - wBridgeF.xy;
  float lx = dot(d, X), lz = dot(d, Z);
  float rx = dot(Rd.xz, X), rz = dot(Rd.xz, Z);
  if (abs(lz) < BR_HW) {
    shade = 0.3;
    return (Rd.y > 0.0 && abs(lx) < BR_SPAN) ? 1.0 : 0.0;
  }
  if (rz * lz >= -1e-4) return 0.0; // heading away from the bridge
  float t = ((lz > 0.0 ? BR_HW : -BR_HW) - lz) / rz;
  if (t > 14.0) return 0.0;
  float hx = lx + rx * t, hy = P.y + Rd.y * t;
  float m = smoothstep(0.0, 0.05, wDeckY(hx) + BR_TOP - hy) * (1.0 - smoothstep(BR_END - 0.15, BR_END, abs(hx)));
  if (abs(hx) < BR_SPAN) {
    float intr = BR_Y0 + sqrt(max(BR_R * BR_R - hx * hx, 0.0));
    m *= smoothstep(-0.04, 0.04, hy - intr);
    shade = mix(0.7, 1.0, smoothstep(0.0, 0.4, hy - intr));
  }
  return m;
}
// a mirrored shape: how much of the ripple-broken reflected ray it covers
// (soft-edged, 0..1) and how far away it is (t)
float wProxy(int i, vec3 P, vec3 Rd, out float t) {
  vec4 c = wProxP[i];
  vec4 r = wProxR[i];
  t = -1.0;
  if (c.w < 0.5) return 0.0;
  if (c.w < 1.5) {
    vec3 o = (P - c.xyz) / r.xyz, dd = Rd / r.xyz;
    float a = dot(dd, dd), b = dot(o, dd);
    t = -b / a; // closest approach to the centre
    if (t <= 0.0) return 0.0;
    float q = dot(o, o) - b * b / a; // squared distance of the ray from the centre (unit space)
    if (P.y + Rd.y * t < r.w - 0.3) return 0.0;
    return 1.0 - smoothstep(0.5, 1.0, q);
  }
  vec2 o = P.xz - c.xz, dd = Rd.xz;
  float a = dot(dd, dd);
  if (a < 1e-5) return 0.0;
  float b = dot(o, dd);
  t = -b / a;
  if (t <= 0.0) return 0.0;
  float q = (dot(o, o) - b * b / a) / (r.x * r.x);
  float y = P.y + Rd.y * t;
  return (1.0 - smoothstep(0.55, 1.0, q)) * smoothstep(r.y, r.y + 0.4, y) * (1.0 - smoothstep(r.z - 0.4, r.z, y));
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
float wAmp = mix(0.08, 0.042, wCalm) * (1.0 + wTurb * 1.6);
vec2 wG = ((wHu - wH0) * wPerp + (wHs - wH0) * wDir) / wE * wAmp;
vec3 wN = normalize(vec3(-wG.x, 1.0, -wG.y));

// ── body colour: the bed seen through the water, by depth ──
// clear in the shallows (the pebbles and silt show, warmed to olive-amber as
// the water drinks the blue), fading into the scattered teal of the deep middle
float wDd = clamp(wDepth, 0.0, 1.8);
vec2 wBp = vWPos.xz + wN.xz * min(wDd, 0.45) * 0.5; // refracted by the ripples
vec3 wBed = wBedColor(wBp, wCalm);
vec3 wTr = exp(-wAbsorb * wDd);
float wScat = 1.0 - exp(-wDd * 2.8);
vec3 wCol = mix(wBed * wTr, mix(wShallow, wDeep, smoothstep(0.12, 0.85, wDd)), wScat);
// painterly body: soft darker & lighter patches drifting with the flow
float wPatch = wNoise(vec2(vFlow.y * 0.55 + 11.0, (vFlow.x - wT * wSpeed * 0.8) * 0.35)) * 0.6 + wNoise(vWPos.xz * 0.9 + 4.0) * 0.4;
wCol *= 0.9 + 0.2 * wPatch;
// flow streaks: soft, broken bands of sheen travelling with the water (never thin lines)
float wSl = wNoise(vec2(vFlow.y * 1.5, (vFlow.x - wT * wSpeed * 1.1) * 0.32));
float wStreakM = smoothstep(0.17, 0.0, abs(wSl - 0.5)) * (1.0 - wCalm) * smoothstep(0.12, 0.45, wDepth);
wStreakM *= smoothstep(0.42, 0.8, wNoise(vec2(vFlow.y * 1.1 + 3.0, (vFlow.x - wT * wSpeed) * 1.15)));
wCol = mix(wCol, wStreak * 0.55, wStreakM * 0.2);
// the wet edge: the water thins over dark, wet soil
wCol = mix(wCol, wSoil, (1.0 - smoothstep(0.0, 0.12, wDepth)) * 0.35);

// ── foam ──
float wFn = wNoise(vec2(vFlow.y * 4.2, (vFlow.x - wT * wSpeed * 1.3) * 1.6));
float wFn2 = wNoise(vec2(vFlow.y * 9.0 + 3.1, (vFlow.x - wT * wSpeed * 1.5) * 3.4));
float wFoamN = wFn * 0.65 + wFn2 * 0.35;
// at the rocks: a frothy ring, the bow wave, the churned tongue and the V of the wake, all broken up
float wFoamA = smoothstep(0.5, 0.92, wWake + (wFoamN - 0.5) * 0.95) * 0.75;
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
// broken into patches along the shore: long stretches without any froth
float wShoreMask = smoothstep(0.42, 0.72, wNoise(vWPos.xz * 0.85 + 17.0) * 0.75 + wNoise(vWPos.xz * 2.3 - 5.0) * 0.25);
wFringe *= wShoreMask;
float wBand = smoothstep(0.035, 0.0, abs(wDepth + wWob - (0.12 + 0.03 * sin(wT * 1.3 + vFlow.x * 0.4))));
wBand *= smoothstep(0.55, 0.8, wNoise(vWPos.xz * 5.0 - vec2(0.0, wT * 0.25))) * 0.3 * (1.0 - wCalm * 0.7) * wShoreMask;
float wFoamT = clamp(max(max(wFoamA, wFoamB), max(wRing, max(wFringe * 0.5, wBand * wDetail))), 0.0, 1.0);

// the bed is painted in, so the water is nearly opaque — a little clearer in
// the shallows (stones and roots standing in it still show) and soaking into
// the bank over the last ~0.11 of depth along a ragged, lapping line
float wAlpha = mix(0.6, 0.95, smoothstep(0.06, 0.6, wDepth));
wAlpha = max(wAlpha, wFoamT * 0.92);
wAlpha *= smoothstep(0.0, 0.11, wDepth + wWob * 0.6);
diffuseColor.rgb = mix(wCol, wFoam, wFoamT);
diffuseColor.a = wAlpha;
`;

const FRAG_ROUGH = /* glsl */ `
roughnessFactor = mix(0.08, 0.75, wFoamT);
`;

const FRAG_NORMAL = /* glsl */ `
normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
`;

const FRAG_LIGHT = /* glsl */ `
{
  // where the sun (or moon) really reaches: irradiance / albedo, shadow-aware
  float wAlb = max(dot(diffuseColor.rgb, vec3(0.333)), 0.02);
  float wLit = clamp(dot(reflectedLight.directDiffuse, vec3(0.333)) / wAlb * 0.45, 0.0, 1.6);
  float wAmb = dot(reflectedLight.indirectDiffuse, vec3(0.333)) / wAlb;
  float wDay = 1.0 - wNight;
  vec3 wV = normalize(vWPos - cameraPosition);
  vec3 wR = reflect(wV, wN);
  float wCos = clamp(-wV.y, 0.0, 1.0);
  // the sun's own highlight: capped, so a patch of aligned ripples never blooms into a white blotch
  reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(1.3));

  // caustics: nets of sunlight dancing on the bed of the sunny shallows
  if (wDetail > 0.5) {
    vec2 cp = vWPos.xz * 2.1 + wN.xz * 0.8;
    float c1 = wNoise(cp + vec2(wT * 0.23, wT * 0.13));
    float c2 = wNoise(cp * 1.37 - vec2(wT * 0.17, -wT * 0.11) + 5.3);
    float wCau = pow(1.0 - abs(c1 - c2), 9.0);
    float wCauM = smoothstep(0.03, 0.14, wDepth) * exp(-wDepth * 2.4) * (1.0 - wFoamT) * (1.0 - wCalm * 0.6);
    totalEmissiveRadiance += vec3(1.0, 0.93, 0.72) * wCau * wCauM * smoothstep(0.35, 1.0, wLit) * 0.3 * wDay;
  }

  // sun glints: tiny cells twinkling on the ripples, drifting with the flow —
  // gathered where the ripples mirror the sun, gone at the shadows' edges
  vec2 wc = vec2(vFlow.y, vFlow.x - wT * wSpeed) * vec2(7.0, 5.0);
  vec2 wci = floor(wc);
  float wh = wHash(wci);
  vec2 wcf = fract(wc) - 0.5 - (vec2(wHash(wci + 3.1), wHash(wci + 7.7)) - 0.5) * 0.6;
  float wTw = step(0.92, wh) * pow(max(0.0, sin(wT * (2.0 + 4.0 * wh) + wh * 40.0)), 6.0);
  float wAlign = pow(max(dot(wR, wKeyDir), 0.0), 5.0);
  float wSp = wTw * smoothstep(0.07, 0.0, length(wcf)) * (1.0 - wFoamT) * smoothstep(0.05, 0.3, wDepth);
  totalEmissiveRadiance += vec3(1.0, 0.94, 0.8) * wSp * smoothstep(0.6, 1.1, wLit) * (0.3 + 1.4 * wAlign) * wDetail * wDay;
  // night: a few drifting blue-green glints (the stream is a little enchanted)
  float wGl = step(0.965, wHash(wci + 11.0)) * (0.5 + 0.5 * sin(wT * 1.7 + wh * 30.0));
  totalEmissiveRadiance += vec3(0.35, 0.95, 0.85) * wGl * smoothstep(0.16, 0.0, length(wcf)) * wNight * 1.6 * (1.0 - wFoamT);
  // foam stays readable in the shade and at night
  totalEmissiveRadiance += wFoam * wFoamT * (0.05 + 0.08 * wNight);

  // reflections: the canopy overhead (dark leaf masses, misty gaps), and the
  // bridge and the Velowerkstatt mirrored, all broken up by the ripples
  {
    float wFr = 0.07 + 0.55 * pow(1.0 - wCos, 3.0);
    // (sampled where the reflected ray would meet a high canopy; kept broad so
    // grazing views never streak into dark bands)
    float wUp = max(wR.y, 0.22);
    vec2 wCp = (vWPos.xz + wR.xz / wUp * 4.0) * 0.12;
    float wGap = smoothstep(0.5, 0.9, wNoise(wCp) * 0.7 + wNoise(wCp * 2.3 + 3.1) * 0.3);
    vec3 wScene = mix(vec3(0.09, 0.115, 0.08) * wAmb, wFog * 0.75, wGap * 0.85);
    float wHit = 0.0; // the bridge: mirrored a little more strongly (painterly)
    if (wDetail > 0.5) {
      if (wBridgeF.z != 0.0 || wBridgeF.w != 0.0) {
        float wShade;
        float wBr = wBridge(vWPos, wR, wShade);
        wScene = mix(wScene, vec3(0.2, 0.18, 0.15) * wAmb * 1.25 * wShade, wBr);
        wHit = max(wHit, wBr);
      }
      // (the strongest cover wins; colours a little desaturated and lifted, as a
      // sunlit shape looks mirrored in moving water; fading with distance)
      float wPm = 0.0;
      vec3 wPc = vec3(0.0);
      for (int i = 0; i < 3; i++) {
        float t;
        float m = wProxy(i, vWPos, wR, t) * (1.0 - smoothstep(7.0, 13.0, t));
        if (m > wPm) {
          wPm = m;
          wPc = wProxC[i];
        }
      }
      wPc = mix(wPc, vec3(dot(wPc, vec3(0.333))), 0.3);
      wScene = mix(wScene, wPc * wAmb * 2.0, wPm * 0.8);
    }
    float wRk = (wFr + 0.22 * wHit) * (1.0 - wFoamT) * smoothstep(0.02, 0.12, wDepth);
    reflectedLight.directDiffuse *= 1.0 - wRk;
    reflectedLight.indirectDiffuse *= 1.0 - wRk;
    reflectedLight.indirectSpecular *= 1.0 - wRk * 0.6;
    totalEmissiveRadiance += wScene * wRk;
  }

  // night: the lanterns mirrored in the water. Point-light speculars at these
  // grazing angles are a pixel at most, so each warm light gets a painted
  // reflection: where the ray reflected off the RIPPLED surface points at the
  // lamp, measured in azimuth (narrow, the lamp's angular size) and elevation
  // (wide) — a tall streak towards the viewer, broken up by the ripples, in a
  // soft halo. Plus a faint cool glitter path under the moon.
  if (wNight > 0.02) {
    float wFres = 0.45 + 0.55 * pow(1.0 - wCos, 2.0);
    vec2 wRh = normalize(wR.xz + vec2(1e-5));
    vec3 wRefl = vec3(0.0);
    for (int i = 0; i < ${MAX_LAMPS}; i++) {
      vec4 L = wLamp[i];
      if (L.w <= 0.0) continue;
      vec3 d = L.xyz - vWPos;
      float dist = length(d);
      vec3 ld = d / dist;
      // angular distances: azimuth (scaled by the horizontal share) and elevation
      float th2 = 2.0 * (1.0 - dot(wRh, normalize(ld.xz + vec2(1e-5)))) * dot(ld.xz, ld.xz);
      float de = wR.y - ld.y;
      float rho = L.w / dist;
      float sa = rho * 0.9 + 0.012;
      float se = rho * 1.6 + 0.085;
      float core = exp(-th2 / (sa * sa) - de * de / (se * se));
      float halo = exp(-th2 / (sa * sa * 12.0) - de * de / (se * se * 5.0));
      wRefl += wLampCol[i] * (core * 1.15 + halo * 0.16) * (1.0 - smoothstep(7.0, 12.0, dist));
    }
    // the moon: a column of glints in its azimuth, where ripple facets tilt the
    // reflected ray up towards it (a soft sheen along the path in between)
    vec2 wMh = normalize(wMoonDir.xz);
    float wPath = exp(-2.0 * (1.0 - dot(normalize(wV.xz + vec2(1e-5)), wMh)) / 0.012);
    float wTilt = -(wR.y + wV.y) / (wAmp * 2.0 + 1e-3);
    float wMoon = wPath * (smoothstep(0.7, 1.6, wTilt) * 0.9 + 0.1);
    wRefl += vec3(0.5, 0.68, 1.0) * wMoon * 0.32;
    totalEmissiveRadiance += wRefl * wFres * wNight * (1.0 - 0.8 * wFoamT) * smoothstep(0.0, 0.05, wDepth);
  }
}
`;

// scattering colours by day and night (shallow olive → deep teal), foam, streak sheen
const DAY = { shallow: '#58704a', deep: '#17505a', foam: '#f4f1e6', streak: '#cfeee6' };
const NIGHT = { shallow: '#2c4a52', deep: '#0f3346', foam: '#cad9ee', streak: '#8fbcd0' };

/**
 * Build the water surface.
 * @param {object} ctx
 * @param {{ rocks: Array<{x:number,z:number,r:number}>, impacts: Array<{x:number,z:number,r:number,strength?:number}> }} opts
 */
export function buildWater(ctx, { rocks = [], impacts = [], bridge = null, proxies = [] } = {}) {
  // (the surface's detail is in the shader: a coarser grid on the lower tiers)
  const tierQ = ctx.quality?.tier ?? 'high';
  GRID = tierQ === 'low' ? 0.4 : tierQ === 'medium' ? 0.32 : 0.25;
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
    wSoil: { value: new THREE.Color('#4f4a36') },
    wImpact: { value: [0, 1, 2].map((i) => (impacts[i] ? new THREE.Vector4(impacts[i].x, impacts[i].z, impacts[i].r, impacts[i].strength ?? 1) : new THREE.Vector4(0, 0, 0, 0))) },
    wLamp: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    wLampCol: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Color(0, 0, 0)) },
    wMoonDir: envUniforms.uMoonDir,
    wAbsorb: { value: new THREE.Vector3(0.5, 0.78, 1.45) },
    wFog: envUniforms.uFogColor,
    wKeyDir: envUniforms.uKeyDir,
    wBridgeF: { value: bridge ? new THREE.Vector4(bridge.x, bridge.z, bridge.dx, bridge.dz) : new THREE.Vector4(0, 0, 0, 0) },
    wProxP: { value: [0, 1, 2].map(() => new THREE.Vector4(0, 0, 0, 0)) },
    wProxR: { value: [0, 1, 2].map(() => new THREE.Vector4(1, 1, 1, 0)) },
    wProxC: { value: [0, 1, 2].map(() => new THREE.Color(0, 0, 0)) },
  };
  proxies.slice(0, 3).forEach((p, i) => {
    if (p.kind === 'ellipsoid') {
      u.wProxP.value[i].set(p.x, p.y, p.z, 1);
      u.wProxR.value[i].set(p.rx, p.ry, p.rz, p.yMin ?? -100);
    } else {
      u.wProxP.value[i].set(p.x, 0, p.z, 2);
      u.wProxR.value[i].set(p.r, p.y0, p.y1, 0);
    }
    u.wProxC.value[i].set(p.color);
  });
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
  material.customProgramCacheKey = () => 'riverside-water-v5';

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
  let lamps = 0;
  // phones on the low tier mirror only the first few lights (the lanterns)
  const lampLimit = detail ? MAX_LAMPS : 4;
  return {
    mesh,
    material,
    uniforms: u,
    bounds: B,
    /**
     * Mirror a warm light in the water at night. Returns its slot (move it with
     * moveLamp) or -1 when all MAX_LAMPS slots are taken.
     * @param {{x:number,y:number,z:number}} p  the light's centre (world)
     * @param {{ radius?: number, color?: string, strength?: number }} [o]
     */
    addLamp(p, { radius = 0.2, color = '#ffb35c', strength = 1 } = {}) {
      if (lamps >= lampLimit) return -1;
      const i = lamps++;
      u.wLamp.value[i].set(p.x, p.y, p.z, radius);
      u.wLampCol.value[i].set(color).multiplyScalar(strength);
      return i;
    },
    moveLamp(i, x, y, z) {
      if (i >= 0) u.wLamp.value[i].set(x, y, z, u.wLamp.value[i].w);
    },
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
