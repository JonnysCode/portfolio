// ─────────────────────────────────────────────────────────────────────────────
// The far forest that encloses the glen (radius ≈ 40 … 135): a cathedral of
// colossal gnarled trunks with buttress roots fading row by row into the
// blue-green mist, their crowns closing into a high leaf ceiling overhead —
// all receding into haze (refs: the giant-tree elven village, the painterly
// mushroom waterfall, the misty fly-agaric path).
//
// Real geometry (so it parallaxes as the camera glides) but painted, not lit:
// a tiny custom shader gives warm sun-side tops, dark leafy bellies, cool teal
// shade, a golden rim where a silhouette is backlit by the sun and, at night,
// a narrow silver rim on the edges that face the moon (only here — not a
// global light, so the glen's leaf cards are never backlit). The shared
// aerial-perspective fog (env/fog.js) then grades every row into the mist.
//
//   forest      trunks, curved tapering limbs with leaf sprays, crowns built
//               from several lumpy lobes with hanging bellies (never a single
//               flattened disc), the far ground — one merged mesh. Every crown
//               sits above the top edge of the zoomed-out glen shots, so from
//               there the giants are columns rising out of the frame
//   ceiling     a high, sagging leaf roof spanning the far forest, torn open in
//               ragged gaps (some where the far god rays fall through) whose
//               leafy edges glow when the light comes through — looking up
//               from the glen it reads as a cathedral roof; out of frame in
//               the zoomed-out shots, hidden when the camera rises above it
//   understorey dark leafy shrub cards at the feet of the giants and in a band
//               (r ≈ 36–64), ragged top AND bottom and sunk into the ground, so
//               no bright open meadow reads through and no card shows a
//               straight edge (a clean alpha cut where MSAA is thin, no stipple)
//   mist        soft curtains between the rows (thinning around the moon)
//
// 4 draw calls. Only the arc the camera can ever look at is filled (the camera
// always looks roughly north: view azimuths within ±105° of −Z); the front
// stays open. The nearer forest (r ≲ 36) is built by the vegetation module.
//
// The moon window: along MOON_SKY_DIR as seen from the glen camera, no trunk,
// crown or card is placed and the far ground falls away into a valley, so the
// hero moon rises clear out of its mist in the canopy gap above the waterfall.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng, smoothstep } from '../../core/rng.js';
import { createNoise2D } from '../../core/noise.js';
import { getHeight } from '../ground.js';
import { TERRAIN_HALF_SIZE } from '../layout.js';
import { fogUniforms } from './fog.js';
import { envUniforms, GLSL_NOISE, MOON_SKY_DIR, MOON_EYE } from './celestial.js';

/** Azimuth range (radians, 0 = −Z / north, + = east) the backdrop covers. */
const ARC = THREE.MathUtils.degToRad(116);
const TAU = Math.PI * 2;
const noise = createNoise2D(4711);

// ─── the moon window ─────────────────────────────────────────────────────────
/** Half-angle (rad) kept clear around the moon from the glen camera (disc ≈ 0.038 + its corona). */
const MOON_CONE = 0.085;
const MOON_AZ = Math.atan2(MOON_SKY_DIR.x, -MOON_SKY_DIR.z);

/** Would a sphere (x, y, z, r) cover the moon seen from the glen camera? */
function inMoonWindow(x, y, z, r) {
  const dx = x - MOON_EYE.x, dy = y - MOON_EYE.y, dz = z - MOON_EYE.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-3) return true;
  const c = (dx * MOON_SKY_DIR.x + dy * MOON_SKY_DIR.y + dz * MOON_SKY_DIR.z) / d;
  return Math.acos(Math.min(1, Math.max(-1, c))) < MOON_CONE + Math.asin(Math.min(1, r / d));
}
/** 0…1: how close (x, z) lies to the moon's bearing seen from the glen camera. */
function moonBearing(x, z) {
  const az = Math.atan2(x - MOON_EYE.x, -(z - MOON_EYE.z));
  return 1 - smoothstep(0.07, 0.2, Math.abs(az - MOON_AZ));
}

/** Ground height that keeps going beyond the terrain mesh (rising, misty hills; a valley under the moon). */
function farHeight(x, z) {
  const H = TERRAIN_HALF_SIZE - 0.5;
  const cx = THREE.MathUtils.clamp(x, -H, H);
  const cz = THREE.MathUtils.clamp(z, -H, H);
  const out = Math.hypot(x - cx, z - cz);
  // (deepening all the way out: the far ground must stay below the low moon
  //  as seen from the glen, or the disc sets behind the misty hills)
  const valley = moonBearing(x, z) * (9 * Math.min(1, out / 30) + 0.3 * Math.max(0, out - 30));
  return getHeight(cx, cz) + out * 0.18 + noise(x * 0.02, z * 0.02) * 2.5 * Math.min(1, out / 20) - valley;
}

const polar = (r, az) => ({ x: Math.sin(az) * r, z: -Math.cos(az) * r });

// ─── the zoomed-out frames ───────────────────────────────────────────────────
// No far crown may float into the top of the zoomed-out glen shots (the glen
// camera pulled back: glen-wide, the phone's widest framing): seen from there
// a crown is a pale lump on a pole. Every crown, limb tip and the leaf
// ceiling is lifted until its underside clears that frame's top edge, so the
// trunks leave the frame like cathedral columns. (The overview looks down,
// its top edge is far lower; the glen shot itself is nearer, so it clears too.)
const WIDE_CAM = new THREE.PerspectiveCamera(40, 16 / 9, 1, 1000);
WIDE_CAM.position.set(7.2, 25.4, 73.6);
WIDE_CAM.lookAt(0, 6.5, -2);
WIDE_CAM.updateMatrixWorld();
const _cp = new THREE.Vector3();
/** Lowest height at (x, z) that stays just above the zoomed-out glen frame's top edge. */
function clearY(x, z) {
  let lo = -20, hi = 220;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) * 0.5;
    _cp.set(x, m, z).project(WIDE_CAM);
    if (_cp.y > 1.1) hi = m;
    else lo = m;
  }
  return hi;
}

// ─── geometry accumulator (one merged mesh, no per-part BufferGeometry merge) ─

function makeAcc() {
  // tree: [ground height at the tree's foot, per-tree seed] — set per tree
  // (the bark shader grows moss, ivy and lichen up from the roots)
  return { pos: [], nrm: [], tint: [], info: [], idx: [], v: 0, tree: [-200, 0] };
}
/** A stable per-tree seed (0…1) from its position (keeps the rng sequence untouched). */
const treeSeed = (x, z) => {
  const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return h - Math.floor(h);
};
/** Append an indexed geometry (position + normal) with a flat tint. */
function addGeo(acc, g, rgb) {
  const p = g.attributes.position.array;
  const n = g.attributes.normal.array;
  const count = p.length / 3;
  for (let i = 0; i < p.length; i++) {
    acc.pos.push(p[i]);
    acc.nrm.push(n[i]);
  }
  for (let i = 0; i < count; i++) {
    acc.tint.push(rgb[0], rgb[1], rgb[2]);
    acc.info.push(acc.tree[0], acc.tree[1]);
  }
  const ix = g.index ? g.index.array : null;
  if (ix) for (let i = 0; i < ix.length; i++) acc.idx.push(ix[i] + acc.v);
  else for (let i = 0; i < count; i++) acc.idx.push(i + acc.v);
  acc.v += count;
  g.dispose();
}
function accGeometry(acc) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nrm, 3));
  g.setAttribute('aTint', new THREE.Float32BufferAttribute(acc.tint, 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(acc.info, 2));
  g.setIndex(acc.v > 65535 ? new THREE.Uint32BufferAttribute(acc.idx, 1) : new THREE.Uint16BufferAttribute(acc.idx, 1));
  g.computeBoundingSphere();
  return g;
}

// ─── geometry builders ───────────────────────────────────────────────────────

/** A colossal trunk: flared buttress roots, taper, lean, gentle twist. */
function trunkGeometry(rng, { radius, height, lean, leanAz, radial = 11, rings = 12 }) {
  const pos = [];
  const idx = [];
  const phase = rng.range(0, Math.PI * 2);
  const lobes = rng.int(4, 6);
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const y = t * height - 3; // start below ground
    const flare = Math.exp(-Math.max(0, t - 0.04) * 11);
    const taper = 1 - 0.38 * t;
    const bend = lean * t * t * height;
    const ox = Math.sin(leanAz) * bend + Math.sin(t * 5 + phase) * radius * 0.12;
    const oz = -Math.cos(leanAz) * bend + Math.cos(t * 4 + phase) * radius * 0.12;
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const butt = 1 + flare * (0.7 + 0.9 * Math.pow(Math.max(0, Math.cos(a * lobes + phase)), 2));
      const knob = 1 + 0.08 * noise(a * 2 + phase, t * 6);
      const r = radius * taper * butt * knob;
      pos.push(ox + Math.cos(a) * r, y, oz + Math.sin(a) * r);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * radial + i;
      const b = j * radial + ((i + 1) % radial);
      const c = (j + 1) * radial + i;
      const d = (j + 1) * radial + ((i + 1) % radial);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const _bz = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
const _c = new THREE.Vector3();
/**
 * A limb that reads as a branch, not a strut: it arches (rises, then reaches
 * out), tapers almost to a point and has a slight kink. Returns the geometry.
 */
function branchGeometry(a, b, r0, r1, lift) {
  _bz.v0.copy(a);
  _bz.v2.copy(b);
  _bz.v1.copy(a).lerp(b, 0.42);
  _bz.v1.y += lift;
  const segs = 6;
  const radial = 6;
  const g = new THREE.TubeGeometry(_bz, segs, 1, radial, false);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const i = Math.floor(k / (radial + 1));
    const t = i / segs;
    _bz.getPointAt(t, _c);
    // fast taper towards the tip, a little swelling where it leaves the trunk
    const r = THREE.MathUtils.lerp(r0, r1, Math.pow(t, 0.7)) * (1 + 0.35 * Math.exp(-t * 9));
    p.setXYZ(k, _c.x + (p.getX(k) - _c.x) * r, _c.y + (p.getY(k) - _c.y) * r, _c.z + (p.getZ(k) - _c.z) * r);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

const icoBase = (detail) => {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  const p = ico.attributes.position.array;
  // weld the non-indexed icosphere (smooth normals after displacement)
  const map = new Map();
  const verts = [];
  const idx = [];
  for (let i = 0; i < p.length; i += 3) {
    const key = `${p[i].toFixed(4)},${p[i + 1].toFixed(4)},${p[i + 2].toFixed(4)}`;
    let k = map.get(key);
    if (k === undefined) {
      k = verts.length / 3;
      map.set(key, k);
      verts.push(p[i], p[i + 1], p[i + 2]);
    }
    idx.push(k);
  }
  ico.dispose();
  return { verts: new Float32Array(verts), idx };
};
const blobFine = icoBase(2); // 320 triangles — the nearest crowns
const blobCoarse = icoBase(1); // 80 triangles — lobes, deep in the mist
const blobTiny = icoBase(0); // 20 triangles — leaf sprays on the limbs

/**
 * A lumpy leaf mass (displaced icosphere): a few big bulges (so one mass reads
 * as several heaped leaf clumps, cauliflower-like) and smaller lumps on them;
 * only a little fuller on top than underneath — never a flat plate.
 */
function blobGeometry(rng, cx, cy, cz, sx, sy, sz, base = blobCoarse) {
  const src = base.verts;
  const pos = new Float32Array(src.length);
  const s = rng.range(0, 100);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    const big = noise(x * 1.25 + y * 0.6 + s, z * 1.25 - y * 0.5) + noise(y * 1.3 - z * 0.4 - s, x * 1.1 + z * 0.6 + 3.7);
    // (only bulges the icosphere can carry — finer noise would alias into crumpled facets)
    const n = 1 + 0.2 * big + 0.08 * noise(x * 2.2 - s, y * 2.4 + z * 0.8);
    const yy = y < 0 ? y * 0.94 : y;
    pos[i] = cx + x * sx * n;
    pos[i + 1] = cy + yy * sy * n;
    pos[i + 2] = cz + z * sz * n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(base.idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A crown mass: one big multi-bulged leaf lump with a smaller clump or two
 * heaped on top or drooping at its rim — a lumpy, cauliflower-like mass with
 * dark hanging bellies underneath, never one flat plate.
 */
function crownMass(acc, rng, cx, cy, cz, s, leafRgb, { fine = false, lobes = 1 } = {}) {
  addGeo(acc, blobGeometry(rng, cx, cy, cz, s * 1.08, s * 0.95, s * 1.08, fine ? blobFine : blobCoarse), leafRgb);
  for (let i = 0; i < lobes; i++) {
    const a = rng.range(0, TAU);
    const d = s * rng.range(0.55, 0.9);
    const ls = s * rng.range(0.45, 0.62);
    // the first heaps up on top, the others hang lower: a lumpy belly, never a flat plate
    const up = s * (i === 0 ? rng.range(0.15, 0.45) : rng.range(-0.62, -0.3));
    addGeo(acc, blobGeometry(rng, cx + Math.cos(a) * d, cy + up, cz + Math.sin(a) * d, ls * 1.1, ls, ls * 1.1), leafRgb);
  }
}

/** Far ground beyond (and just under) the terrain mesh, so nothing ever ends in a cliff. */
function skirtGeometry() {
  const radial = 72;
  const rings = 14;
  const pos = [];
  const idx = [];
  const H = TERRAIN_HALF_SIZE;
  for (let j = 0; j <= rings; j++) {
    const r = 52 + Math.pow(j / rings, 1.6) * 210;
    for (let i = 0; i <= radial; i++) {
      const az = -ARC - 0.25 + (i / radial) * (2 * ARC + 0.5);
      const { x, z } = polar(r, az);
      const inside = Math.abs(x) < H - 1 && Math.abs(z) < H - 1;
      const y = inside ? getHeight(x, z) - 0.8 : farHeight(x, z) - 0.3;
      pos.push(x, y, z);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * (radial + 1) + i;
      const b = a + 1;
      const c = a + radial + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Height of the leaf ceiling's underside above (x, z), before its sagging lumps. */
function ceilingBase(x, z, r) {
  return farHeight(x, z) + 45 + (r - 30) * 0.08;
}

/**
 * The high leaf ceiling: a polar sheet over the far forest (r ≈ 24 … 125),
 * sagging into hanging leaf masses. The gaps are cut in its shader.
 */
function ceilingGeometry(tier) {
  const radial = tier === 'high' ? 26 : tier === 'medium' ? 18 : 12;
  const around = tier === 'high' ? 96 : tier === 'medium' ? 64 : 44;
  const pos = [];
  const idx = [];
  for (let j = 0; j <= radial; j++) {
    const r = 24 + Math.pow(j / radial, 1.2) * 101;
    for (let i = 0; i <= around; i++) {
      const az = -ARC - 0.12 + (i / around) * (2 * ARC + 0.24);
      const { x, z } = polar(r, az);
      const lump = Math.max(0, noise(x * 0.045 + 3.1, z * 0.045 - 1.7));
      const y = ceilingBase(x, z, r) - 8 * Math.pow(lump, 1.3) - 1.8 * noise(x * 0.13, z * 0.13);
      // (its hanging lumps never sag into the zoomed-out glen frame)
      pos.push(x, Math.max(y, clearY(x, z) + 1.5), z);
    }
  }
  for (let j = 0; j < radial; j++) {
    for (let i = 0; i < around; i++) {
      const a = j * (around + 1) + i;
      const b = a + 1;
      const c = a + around + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ─── shaders ────────────────────────────────────────────────────────────────

const FOREST_VERT = /* glsl */ `
  attribute vec3 aTint;
  attribute vec2 aInfo; // ground height at the tree's foot, per-tree seed
  varying vec3 vTint;
  varying vec2 vInfo;
  varying vec3 vN;
  varying vec3 vW;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vTint = aTint;
    vInfo = aInfo;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

/** The silver moon rim of the far silhouettes (night). */
const RIM_GLSL = /* glsl */ `
  // a narrow line on the edges that face the moon: faint from most angles (a
  // thread, not a neon outline), strongest where the trunks stand against the
  // moonlit haze (backlit, like the trees of the references)
  float moonRimK(vec3 n, vec3 v, vec3 moonDir) {
    float edge = pow(1.0 - abs(dot(n, v)), 6.0);
    vec3 mh = normalize(vec3(moonDir.x, 0.0, moonDir.z));
    float side = smoothstep(-0.1, 0.6, dot(n, mh));
    float back = pow(max(dot(v, moonDir), 0.0), 6.0);
    return edge * side * (0.035 + 1.2 * back);
  }
`;

const FOREST_FRAG = /* glsl */ `
  uniform vec3 uKeyDir, uKeyColor, uSkyCol, uShadeCol, uMoss, uMoonDir, uMoonRim;
  uniform float uNight, uDepthK;
  varying vec3 vTint;
  varying vec2 vInfo;
  varying vec3 vN;
  varying vec3 vW;
  ${GLSL_NOISE}
  ${RIM_GLSL}
  #include <fog_pars_fragment>
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(vW - cameraPosition);
    // bark (brownish tint) vs foliage (green tint)
    float isBark = step(vTint.g, vTint.r + 0.02);
    // painterly breakup: broad colour patches that do not follow the mesh
    float patchN = envFbm(vW.xz * 0.09 + vW.y * 0.05);
    vec3 base = vTint * mix(0.75, 1.2, patchN);
    // height above the tree's own foot (far below for the canopy fill)
    float hA = vW.y - vInfo.x;
    float sd = vInfo.y;
    float rim = 1.0 - abs(dot(n, v));
    // (how much brighter / darker the bark's detail makes it than a plain
    //  trunk: kept, at reduced contrast, through the haze further down)
    float barkDetail = 1.0;
    if (isBark > 0.5) {
      float plainL = dot(base, vec3(0.3, 0.59, 0.11));
      // ── bark that reads as an old giant, not a pale cardboard column ──
      float around = dot(vW.xz, vec2(0.71, 0.71)) + dot(n.xz, vec2(-0.71, 0.71)) * 3.0;
      // per tree: a little darker or lighter, some greyer (lichen-silvered)
      base *= mix(0.82, 1.2, fract(sd * 7.13));
      base = mix(base, vec3(dot(base, vec3(0.333))) * vec3(0.96, 1.0, 0.94), 0.4 * fract(sd * 3.71));
      // broad vertical bands — darker wet or mossy runs, lighter dry bark —
      // big enough to survive the haze and the far-field blur of the lens
      float broad = envNoise(vec2(around * 0.32 + sd * 7.0, vW.y * 0.028 + sd * 3.0));
      base *= mix(0.6, 1.32, broad);
      // long vertical furrows and the bark plates between them
      float furrow = envFbm(vec2(around * 1.6, vW.y * 0.09));
      base *= mix(0.5, 1.28, furrow);
      #if BARK_DETAIL
      float plates = envNoise(vec2(around * 4.2, vW.y * 0.32));
      base *= mix(0.78, 1.12, plates);
      // dark wet streaks running down the trunk from the forks
      float wet = smoothstep(0.6, 0.85, envNoise(vec2(around * 2.3 + sd * 9.0, vW.y * 0.022)));
      base *= 1.0 - 0.38 * wet;
      // pale grey-green lichen blotches, mostly on the lit side
      float lichen = smoothstep(0.6, 0.8, envNoise(vec2(around * 3.1 - sd * 5.0, vW.y * 0.21)));
      lichen *= 0.35 + 0.65 * smoothstep(-0.1, 0.6, dot(n, uKeyDir));
      base = mix(base, vec3(0.3, 0.32, 0.25), lichen * 0.42);
      #endif
      // moss: thick on the root flares, creeping up from the roots to a ragged
      // tide line (higher on the windward side), in lighter and darker cushions
      float tide = mix(3.5, 14.0, fract(sd * 5.31)) * (0.7 + 0.6 * envNoise(vec2(around * 1.3, sd * 11.0))) * (1.0 + 0.6 * smoothstep(0.2, 0.9, -n.x));
      float mossAmt = smoothstep(0.25, 0.85, n.y) * 0.8 + (1.0 - smoothstep(tide * 0.45, tide, hA)) * 0.8 + smoothstep(0.2, 0.9, -n.x) * 0.3;
      mossAmt *= smoothstep(0.28, 0.6, envNoise(vW.xz * 0.6 + vW.y * 0.2));
      vec3 mossC = uMoss * mix(0.5, 1.3, envNoise(vec2(around * 2.6, vW.y * 0.45)));
      base = mix(base, mossC, clamp(mossAmt, 0.0, 0.9));
      #if BARK_DETAIL
      // ivy: dark leafy runs climbing from the roots on about half the giants
      float ivyTop = mix(6.0, 28.0, fract(sd * 11.1)) * step(0.45, fract(sd * 2.93));
      float ivy = smoothstep(0.48, 0.68, envNoise(vec2(around * 1.1 + sd * 17.0, vW.y * 0.04)));
      ivy *= 1.0 - smoothstep(ivyTop * 0.5, ivyTop, hA + 4.0 * envNoise(vec2(around * 3.0, sd * 3.0)));
      float leaves = envNoise(vW.xy * 1.6 + vW.z * 1.3) * 0.6 + envNoise(vW.zy * 2.9 - vW.x * 1.1) * 0.4;
      ivy *= smoothstep(0.22, 0.42, leaves);
      base = mix(base, mix(vec3(0.04, 0.07, 0.028), vec3(0.11, 0.16, 0.05), leaves), ivy * 0.9);
      #endif
      // round, not flat: the trunk darkens towards its silhouette and at its foot
      base *= (1.0 - 0.32 * rim * rim) * mix(0.62, 1.0, smoothstep(-2.0, 5.0, hA));
      barkDetail = dot(base, vec3(0.3, 0.59, 0.11)) / max(plainL * 0.9, 1e-4);
    }
    // never let a far-forest crown loom in front of the lens: when the camera
    // is high above the glen (the intro descends from above the canopy) the
    // backdrop near it dissolves (screen-door), as does anything very close
    float camD = length(vW - cameraPosition);
    float horiz = length(vW.xz - cameraPosition.xz);
    float high = smoothstep(38.0, 70.0, cameraPosition.y);
    float keep = smoothstep(22.0, 36.0, camD);
    // (only crowns: they are the big shapes that would block the view down into the glen)
    if (vTint.g > vTint.r + 0.02) keep *= 1.0 - high * (1.0 - smoothstep(42.0, 54.0, horiz));
    if (keep < 0.999) {
      float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      if (keep < ign) discard;
    }
    // foliage: a lobed, leafy silhouette — broad notches (several pixels wide
    // even far away, so the edge never turns into a stippled screen door)
    if (isBark < 0.5) {
      float leafN = envNoise(vW.xy * 0.42 + vW.z * 0.27) * 0.6 + envNoise(vW.zy * 0.95 + vW.x * 0.33) * 0.4;
      if (rim > 0.56 + 0.42 * leafN) discard;
    }
    // foliage: clumpy leaf masses — darker gaps, lighter clump tops, and dark
    // self-shadowed bellies underneath (seen from the glen floor the crowns
    // are deep green undersides, not pale plates)
    float clump = envFbm(vW.xz * 0.35 + vW.y * 0.4) * 0.6 + envNoise(vW.xz * 0.9 + vW.y * 0.8) * 0.4;
    float belly = smoothstep(-0.8, 0.55, n.y);
    base = mix(base, base * mix(0.6, 1.3, clump) * mix(0.3, 1.05, belly), 1.0 - isBark);
    // soft wrapped key light, sky from above, teal shade below (the trunks a
    // little less wrapped: a lit side and a shade side, so they read round)
    float key = clamp(dot(n, uKeyDir) * mix(0.6, 0.78, isBark) + mix(0.4, 0.24, isBark), 0.0, 1.0);
    vec3 col = base * (uShadeCol * 0.9 + uKeyColor * key * 0.6 + uSkyCol * max(n.y, 0.0) * 0.4);
    // golden rim where a silhouette is backlit by the sun
    float facing = pow(1.0 - abs(dot(n, v)), 2.5);
    float toward = pow(max(dot(v, uKeyDir), 0.0), 2.0);
    col += uKeyColor * facing * (0.06 + 0.4 * toward) * 0.35 * (1.0 - uNight);
    // soft painted depth: foliage silhouettes dissolve into the mist at their
    // rims, and everything sinks towards the misty blue-green with distance
    // from the glen (stronger on tiers without depth of field)
    vec4 hazeV = woodlandFog(vW);
    // (the trunks' silhouettes melt a little into the air too: no crisp cut-out edge)
    float softRim = mix(smoothstep(0.25, 0.85, rim) * 0.4, smoothstep(0.55, 0.95, rim) * 0.22, isBark);
    float depth = smoothstep(36.0, 100.0, length(vW.xz)) * uDepthK;
    // a trunk stands in mist at its feet and rises out of it: hazier low down
    depth = clamp(depth + isBark * 0.22 * (1.0 - smoothstep(0.0, 12.0, hA)) * (0.5 + uDepthK), 0.0, 1.0);
    col = mix(col, hazeV.rgb, clamp(softRim + depth - softRim * depth, 0.0, 0.85));
    gl_FragColor = vec4(col, 1.0);
    // same order as three's built-in materials: the fog chunk expects display space
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    // …and higher up, under the leaf roof, it keeps more of its own dark,
    // textured bark through the haze: a bottom-to-top value gradient, so the
    // giants read as columns rising out of the mist, not flat pale cards
    gl_FragColor.rgb = mix(gl_FragColor.rgb, col, isBark * 0.32 * smoothstep(5.0, 32.0, hA) * hazeV.a);
    // the bark's furrows, moss, ivy and its lit and shaded sides survive the
    // haze at reduced contrast (the haze keeps the value, not the flatness)
    float formK = mix(0.72, 1.22, key);
    gl_FragColor.rgb *= mix(1.0, clamp(barkDetail * formK, 0.4, 1.6), isBark * 0.55 * hazeV.a);
    // night: a silver line where the edge faces the moon — scattered right at
    // the silhouette, so it survives the mist a little (the trunks stand out
    // against the moonlit haze like the backlit trees of the references)
    gl_FragColor.rgb += uMoonRim * moonRimK(n, v, uMoonDir) * uNight * mix(0.5, 1.0, isBark) * (1.0 - 0.6 * hazeV.a);
  }
`;

const CEIL_VERT = /* glsl */ `
  varying vec3 vW;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const CEIL_FRAG = /* glsl */ `
  uniform vec3 uKeyColor, uKeyDir, uMoonRim, uMoonDir;
  uniform float uNight;
  uniform vec4 uGaps[4]; // xz: a forced gap (where a far god ray falls through), z: radius
  varying vec3 vW;
  ${GLSL_NOISE}
  #include <fog_pars_fragment>
  void main() {
    float r = length(vW.xz);
    // big ragged gaps between the crowns — more of them towards the glen
    // (the clearing) — with finer leafy edges
    float g = envFbm(vW.xz * 0.028 + 7.0) * 0.78 + envNoise(vW.xz * 0.09 - 3.0) * 0.22;
    g += (1.0 - smoothstep(24.0, 40.0, r)) * 0.42;
    for (int i = 0; i < 4; i++) {
      vec2 d = vW.xz - uGaps[i].xy;
      g += 0.38 * (1.0 - smoothstep(uGaps[i].z * 0.35, uGaps[i].z, length(d)));
    }
    float e = g + 0.06 * envNoise(vW.xz * 0.55) + 0.035 * envNoise(vW.xz * 1.3 + 5.0);
    if (e > 0.6) discard;
    // underside of the leaf roof: deep, cool green in leafy clumps
    float clump = envNoise(vW.xz * 0.16 + 2.0) * 0.65 + envNoise(vW.xz * 0.47 - 1.0) * 0.35;
    vec3 base = mix(vec3(0.025, 0.045, 0.03), vec3(0.06, 0.09, 0.05), clump);
    // thin leaves at the rim of a gap glow a little when the light comes
    // through them (yellow-green looking towards the sun, silver towards the moon)
    vec3 v = normalize(vW - cameraPosition);
    float edge = smoothstep(0.53, 0.6, e);
    float sunBack = 0.25 + 0.75 * pow(max(dot(v, uKeyDir), 0.0), 3.0);
    float moonBack = 0.2 + 0.8 * pow(max(dot(v, uMoonDir), 0.0), 3.0);
    vec3 dayLit = base * vec3(1.15, 1.25, 1.05) + uKeyColor * vec3(0.06, 0.075, 0.02) * edge * sunBack;
    vec3 nightLit = base * vec3(0.5, 0.7, 0.95) * 0.5 + uMoonRim * 0.06 * edge * moonBack;
    vec3 col = mix(dayLit, nightLit, uNight);
    vec4 hazeV = woodlandFog(vW);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    // (a roof overhead is nearer than the haze says: keep it a deep, cool
    //  silhouette — never a khaki sheet in the sun's glow)
    gl_FragColor.rgb = mix(gl_FragColor.rgb, col, 0.5 * hazeV.a);
  }
`;

const MIST_VERT = /* glsl */ `
  attribute float aLayer;
  varying vec2 vUv;
  varying float vLayer;
  varying vec3 vW;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vLayer = aLayer;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const MIST_FRAG = /* glsl */ `
  uniform float uTime, uNight, uOpacity;
  uniform vec3 uMoonDir;
  varying vec2 vUv;
  varying float vLayer;
  varying vec3 vW;
  ${GLSL_NOISE}
  #include <fog_pars_fragment>
  void main() {
    // thick at the bottom, wispy towards the top, drifting slowly sideways
    float h = vUv.y;
    float n = envFbm(vec2(vUv.x * 38.0 + uTime * 0.012 * (1.0 + vLayer), h * 3.0 + vLayer * 7.0));
    float a = smoothstep(1.0, 0.0, h) * (0.35 + 0.65 * n);
    a *= smoothstep(0.0, 0.06, h + 0.02);
    // fade the ends of the arc
    a *= smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
    a *= uOpacity * mix(0.55, 0.75, vLayer) * (0.7 + 0.6 * uNight);
    // the veils part around the rising moon (it stays a clear hero, its halo does the haze)
    vec3 v = normalize(vW - cameraPosition);
    a *= 1.0 - uNight * 0.8 * smoothstep(0.985, 0.998, dot(v, uMoonDir));
    vec4 fogV = woodlandFog(vW);
    // by day the veils are a touch deeper than the haze (no fog-white walls);
    // by night they catch the moon a little so the trunks stand out against them
    vec3 col = fogV.rgb * mix(mix(0.94, 1.02, n), mix(1.1, 1.22, n), uNight);
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function buildMist(tier) {
  const layers = tier === 'low' ? [58] : [48, 62, 78];
  const pos = [];
  const uv = [];
  const layer = [];
  const idx = [];
  layers.forEach((r, li) => {
    const seg = 64;
    const height = 18 + li * 6;
    const v0 = pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const az = -ARC + (i / seg) * 2 * ARC;
      const { x, z } = polar(r, az);
      const base = farHeight(x, z) - 1.5;
      pos.push(x, base, z, x, base + height, z);
      uv.push(i / seg, 0, i / seg, 1);
      layer.push(li / Math.max(1, layers.length - 1), li / Math.max(1, layers.length - 1));
    }
    for (let i = 0; i < seg; i++) {
      const a = v0 + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aLayer', new THREE.Float32BufferAttribute(layer, 1));
  g.setIndex(idx);
  return g;
}

const UNDER_VERT = /* glsl */ `
  attribute vec2 aSeed; // seed, kind (0 shrub, 1 low wide bush)
  varying vec2 vUv;
  varying vec2 vSeed;
  varying vec3 vW;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const UNDER_FRAG = /* glsl */ `
  uniform vec3 uKeyColor, uShadeCol, uMoonDir, uMoonRim;
  uniform float uNight, uDepthK, uCut;
  varying vec2 vUv;
  varying vec2 vSeed;
  varying vec3 vW;
  ${GLSL_NOISE}
  #include <fog_pars_fragment>
  void main() {
    float x = vUv.x * 2.0 - 1.0;
    // (the per-card seed, snapped: an interpolated 'constant' varying wobbles
    //  in its last bits, and the hashes below would blow that up into a
    //  different shrub outline per pixel — a stippled edge)
    float sd = floor(vSeed.x * 211.0 + 0.5) * 0.173;
    // a shrub: a few overlapping round leaf masses (kind 1: a lower, wider
    // bush) with a ragged leafy outline — no single dome, no spikes
    float h = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float cx = (envHash(vec2(sd, fi * 7.1)) * 2.0 - 1.0) * 0.45;
      float r = mix(0.3, 0.5, envHash(vec2(fi * 3.3, sd + 1.7)));
      float cy = mix(0.25, 0.5, envHash(vec2(sd + fi, 5.3))) * (1.0 - 0.45 * vSeed.y);
      float dx = (x - cx) / r;
      // (each mass rounds off to nothing at its sides: no flat-topped block
      //  running out to the card's straight side edges)
      float k = max(1.0 - dx * dx, 0.0);
      h = max(h, (cy * pow(k, 0.3) + r * sqrt(k)) * (1.0 - 0.3 * vSeed.y));
    }
    h *= 1.0 - smoothstep(0.8, 1.0, abs(x));
    // (leafy notches a few pixels wide even far away: no stipple)
    h -= 0.08 * envNoise(vUv * vec2(9.0, 6.0) + sd) + 0.05 * envNoise(vUv * vec2(19.0, 13.0) - sd) + 0.06 * envNoise(vUv * vec2(33.0, 25.0) + sd * 1.7);
    // the foot is just as ragged (the card is sunk into the ground; never a straight bottom)
    float foot = 0.05 + 0.11 * envNoise(vec2(vUv.x * 7.0 + sd, sd * 0.37)) + 0.05 * envNoise(vec2(vUv.x * 17.0 - sd, 3.1));
    // soft leafy edges where alpha to coverage has enough samples (high), a clean cut elsewhere
    float alpha = smoothstep(h, h - 0.07, vUv.y) * smoothstep(foot, foot + 0.07, vUv.y);
    if (alpha < uCut) discard;
    // never loom in front of the lens (dissolves only well before the camera gets close)
    float camD = length(vW - cameraPosition);
    if (camD < 15.0) {
      float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      if (smoothstep(9.0, 15.0, camD) < ign) discard;
    }
    // deep shaded leafy greens like the glen's own undergrowth (not a pale
    // teal cut-out): clumps of lighter and darker leaves, darker towards the ground
    vec3 base = mix(vec3(0.075, 0.13, 0.035), vec3(0.12, 0.17, 0.04), envNoise(vW.xz * 0.4 + sd));
    float top = vUv.y / max(h, 0.05);
    base *= (0.5 + 0.6 * top) * (0.7 + 0.6 * envNoise(vUv * vec2(9.0, 6.0) + sd * 3.0));
    // warm-neutral leaf-filtered ambient by day (the backdrop's moonlit shade by night)
    vec3 amb = mix(vec3(0.3, 0.33, 0.22), uShadeCol * 0.8, uNight);
    float sunPatch = smoothstep(0.35, 0.75, envNoise(vW.xz * 0.21 + 5.0));
    vec3 col = base * (amb + uKeyColor * (0.06 + 0.24 * sunPatch) * top * (1.0 - uNight));
    // the band sinks only a little into the haze of its own (the fog chunk does
    // the distance): the shrubs stay dark leafy silhouettes in the mist
    vec4 hazeV = woodlandFog(vW);
    col = mix(col, hazeV.rgb, 0.08 * uDepthK + 0.15 * (1.0 - smoothstep(0.0, 0.4, top)));
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    // (the fog chunk's mist reads near-white over a dark card at this range: pull it back a little)
    gl_FragColor.rgb = mix(gl_FragColor.rgb, col, 0.18 * (1.0 - hazeV.a));
    // night: the top of each shrub catches a thread of moonlight when seen against it
    vec3 v = normalize(vW - cameraPosition);
    float back = pow(max(dot(v, uMoonDir), 0.0), 4.0);
    gl_FragColor.rgb += uMoonRim * smoothstep(0.78, 1.0, top) * (0.04 + 0.25 * back) * uNight * (1.0 - 0.6 * hazeV.a);
  }
`;

/** Shrub cards of the understorey band (crossed vertical quads). */
function understoreyGeometry(rng, tier, feet = []) {
  const clumps = tier === 'low' ? 80 : tier === 'medium' ? 130 : 210;
  const pos = [];
  const uv = [];
  const seed = [];
  const idx = [];
  let v = 0;
  for (let k = 0; k < clumps + feet.length; k++) {
    let x, z, big = 1;
    if (k < clumps) {
      const az = -ARC - 0.1 + ((k + rng.range(0, 1)) / clumps) * (2 * ARC + 0.2);
      const r = 36 + Math.pow(rng.next(), 1.3) * 28;
      ({ x, z } = polar(r, az));
    } else {
      // shrubs at the feet of the giants
      const f = feet[k - clumps];
      x = f.x;
      z = f.z;
      big = f.s / 2.2;
    }
    const low = rng.next() < 0.4; // a low, wide bush
    const w = (low ? rng.range(3, 5.5) : rng.range(3, 6.5)) * big;
    const h = (low ? rng.range(1.4, 2.4) : rng.range(1.8, 4.2)) * big;
    const sd = rng.next();
    const rot = rng.range(0, Math.PI);
    // sunk 0.6–1.0 below the lowest ground under the card (its ragged foot does the rest)
    const sink = rng.range(0.6, 1.0);
    const y0 = Math.min(farHeight(x, z), farHeight(x + Math.cos(rot) * w * 0.5, z + Math.sin(rot) * w * 0.5), farHeight(x - Math.cos(rot) * w * 0.5, z - Math.sin(rot) * w * 0.5)) - sink;
    if (inMoonWindow(x, y0 + h * 0.5, z, w * 0.5)) continue;
    const hh = h + sink;
    for (let q = 0; q < 2; q++) {
      const a = rot + q * (Math.PI / 2 + rng.range(-0.3, 0.3));
      const dx = Math.cos(a) * w * 0.5, dz = Math.sin(a) * w * 0.5;
      pos.push(x - dx, y0, z - dz, x + dx, y0, z + dz, x + dx, y0 + hh, z + dz, x - dx, y0 + hh, z - dz);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      for (let c = 0; c < 4; c++) seed.push(sd, low ? 1 : 0);
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function buildBackdrop(ctx) {
  const tier = ctx.quality?.tier ?? 'high';
  const rng = createRng('backdrop');
  const acc = makeAcc();

  const BARKS = [[0.16, 0.14, 0.11], [0.18, 0.14, 0.1], [0.14, 0.14, 0.12], [0.15, 0.13, 0.1]];
  const LEAF = [[0.17, 0.25, 0.12], [0.13, 0.22, 0.14], [0.2, 0.27, 0.13], [0.11, 0.19, 0.13]];
  /** Feet of the trees, where the understorey mesh adds shrub cards. */
  const feet = [];
  const leaf = () => LEAF[rng.int(0, LEAF.length - 1)];

  // receding rows of colossal trees, the farthest a ghostly wall in the haze;
  // the crowns sit high (their bellies just above the zoomed-out shots' top
  // edge) and join the leaf ceiling — from the glen they are cathedral columns
  // (low: fewer trees, but enough that the gaps between them do not open onto bare sky)
  // crowns from this radius on use the coarse lump (deep in the mist; on
  // 'medium' — phones — already from the second row)
  const coarseFrom = tier === 'high' ? 60 : 46;
  const rows = [
    { r: [41, 50], count: tier === 'low' ? 11 : 15, radius: [1.6, 2.8], height: [36, 48] },
    { r: [54, 66], count: tier === 'low' ? 12 : 17, radius: [2.2, 3.6], height: [42, 56] },
    { r: [72, 92], count: tier === 'low' ? 12 : 19, radius: [2.8, 4.6], height: [50, 66] },
    { r: [100, 135], count: tier === 'low' ? 7 : tier === 'medium' ? 14 : 22, radius: [3.5, 6], height: [60, 80], far: true },
  ];
  const lobes = tier === 'low' ? 0 : 1;
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  /** How far a set of crown masses [{ x, y, z, s }] must rise so no belly enters the zoomed-out frame. */
  const liftFor = (masses) => masses.reduce((m, c) => Math.max(m, clearY(c.x, c.z) + c.s * 1.02 - c.y), 0);
  for (const row of rows) {
    for (let k = 0; k < row.count; k++) {
      const az = -ARC + ((k + rng.range(0.15, 0.85)) / row.count) * 2 * ARC;
      const r = rng.range(row.r[0], row.r[1]);
      const { x, z } = polar(r, az);
      const y0 = farHeight(x, z);
      const radius = rng.range(row.radius[0], row.radius[1]);
      let height = rng.range(row.height[0], row.height[1]);
      // the old giants lean and bend; a few lean a lot
      const lean = rng.next() < 0.2 ? rng.range(0.02, 0.035) : rng.range(0.004, 0.018);
      const leanAz = rng.range(0, Math.PI * 2);
      const bark = BARKS[rng.int(0, BARKS.length - 1)];
      // crown: a cluster of lumpy, multi-lobed masses (offsets from the trunk
      // top) — dense enough that, seen from above during the intro, the glen
      // reads as a clearing in a closed canopy; towards the open front (the
      // arc's ends) crowns thin out, so the intro's descent from above never
      // looks through a blob
      const side = 1 - 0.45 * THREE.MathUtils.smoothstep(Math.abs(az), THREE.MathUtils.degToRad(85), ARC);
      const masses = [];
      const nm = Math.round((row.far ? rng.int(3, 4) : rng.int(4, 6)) * side);
      for (let m = 0; m < nm; m++) {
        const ma = rng.range(0, Math.PI * 2);
        const md = radius * rng.range(1.2, 4.6);
        masses.push({ dx: Math.cos(ma) * md, dy: rng.range(2, 9), dz: Math.sin(ma) * md, s: radius * rng.range(2.6, 4.0) * side });
      }
      // (the giants grow until their crowns clear the zoomed-out frame)
      const at = (h) => {
        const bend = lean * h;
        return { tx: x + Math.sin(leanAz) * bend, tz: z - Math.cos(leanAz) * bend, topY: y0 + h - 3 };
      };
      {
        const { tx, tz, topY } = at(height);
        height += liftFor(masses.map((c) => ({ x: tx + c.dx, y: topY + c.dy, z: tz + c.dz, s: c.s })));
      }
      const { tx, tz, topY } = at(height);
      // the moon window: no trunk where it would cover the moon from the glen
      let blocked = false;
      for (let s = 0; s <= 6 && !blocked; s++) {
        const t = s / 6;
        blocked = inMoonWindow(x + (tx - x) * t, y0 + height * t, z + (tz - z) * t, radius * 1.6);
      }
      if (blocked) continue;
      const trunk = trunkGeometry(rng, { radius, height, lean, leanAz, radial: row.far ? 8 : 11, rings: row.far ? 8 : 12 });
      trunk.translate(x, y0, z);
      acc.tree = [y0, treeSeed(x, z)];
      addGeo(acc, trunk, bark);
      // limbs: curved, tapering branches that arch up into the crown and end
      // in leaf sprays; now and then one forks off lower down (gnarled giants)
      const limbs = row.far ? 0 : rng.int(2, 3);
      for (let l = 0; l < limbs; l++) {
        const la = rng.range(0, Math.PI * 2);
        let low = l === 0 && rng.next() < 0.3;
        const reach = radius * rng.range(3, 4.8) * (low ? 1.3 : 1);
        const highFrom = topY - height * rng.range(0.1, 0.24);
        let fromY = low ? y0 + height * rng.range(0.5, 0.65) : highFrom;
        // (a low limb's leafy end must clear the zoomed-out frame as well —
        //  where it cannot, it grows from up in the crown instead)
        const cs = radius * rng.range(1.8, 2.6);
        if (low) {
          const ex = x + Math.cos(la) * reach, ez = z + Math.sin(la) * reach;
          fromY = Math.max(fromY, clearY(ex, ez) + cs * 0.62 - reach * 0.75);
          if (fromY > y0 + height * 0.78) {
            low = false;
            fromY = highFrom;
          }
        }
        const tBend = Math.min(1, (fromY - y0) / height);
        from.set(x + (tx - x) * tBend * tBend, fromY, z + (tz - z) * tBend * tBend);
        to.set(from.x + Math.cos(la) * reach, low ? fromY + reach * 0.75 : topY + rng.range(2, 6), from.z + Math.sin(la) * reach);
        if (inMoonWindow(to.x, to.y, to.z, radius * 2)) continue;
        if (!low && to.y - radius * 1.6 < clearY(to.x, to.z)) to.y = clearY(to.x, to.z) + radius * 1.6;
        addGeo(acc, branchGeometry(from, to, radius * (low ? 0.42 : 0.4), radius * 0.06, reach * (low ? 0.35 : 0.2)), bark);
        // leaf sprays along the outer half and at the tip
        const sprays = low ? 3 : 2;
        for (let s = 0; s < sprays; s++) {
          const t = 1 - s * 0.22;
          const sx = from.x + (to.x - from.x) * t, sy = from.y + (to.y - from.y) * t + (low ? 0.6 : 0.3) * radius, sz = from.z + (to.z - from.z) * t;
          const ss = radius * rng.range(0.9, 1.5) * (low ? 1.4 : 1) * (s === 0 ? 1.2 : 0.8);
          addGeo(acc, blobGeometry(rng, sx, sy, sz, ss * 1.3, ss * 0.85, ss * 1.3, row.r[0] < coarseFrom ? blobCoarse : blobTiny), leaf());
        }
        if (low) crownMass(acc, rng, to.x, to.y + cs * 0.4, to.z, cs, leaf(), { lobes });
      }
      for (const c of masses) {
        const cx = tx + c.dx, cy = topY + c.dy, cz = tz + c.dz;
        if (inMoonWindow(cx, cy, cz, c.s * 1.5)) continue;
        crownMass(acc, rng, cx, cy, cz, c.s, leaf(), { fine: row.r[0] < coarseFrom, lobes: row.far ? 0 : row.r[0] < 70 ? lobes * 2 : lobes });
      }
      // undergrowth at the foot: leafy shrub cards (understorey mesh), no pillows
      if (tier !== 'low' && !row.far) {
        const bushes = rng.int(1, 3);
        for (let b = 0; b < bushes; b++) {
          const ba = rng.range(0, Math.PI * 2);
          const bd = radius * rng.range(1.6, 3.5) + 1;
          feet.push({ x: x + Math.cos(ba) * bd, z: z + Math.sin(ba) * bd, s: rng.range(1.6, 3.4) });
        }
      }
    }
  }
  // young trees of the understorey band: slim trunks standing in front of the
  // giants' feet, their small crowns lost up in the canopy ceiling (out of the
  // zoomed-out frame)
  const young = tier === 'low' ? 8 : tier === 'medium' ? 14 : 20;
  for (let k = 0; k < young; k++) {
    const az = -ARC + ((k + rng.range(0.1, 0.9)) / young) * 2 * ARC;
    const r = rng.range(44, 58);
    const { x, z } = polar(r, az);
    const y0 = farHeight(x, z);
    const radius = rng.range(0.75, 1.25);
    // (up into the leaf roof: from below, a slim column vanishing into the canopy)
    let height = Math.max(rng.range(30, 42), ceilingBase(x, z, r) - y0 + rng.range(0, 4));
    const lean = rng.range(0.004, 0.03);
    const leanAz = rng.range(0, Math.PI * 2);
    const n = rng.int(3, 4);
    const masses = [];
    for (let m = 0; m < n; m++) {
      const ma = rng.range(0, Math.PI * 2);
      const md = rng.range(0.8, 3.6);
      masses.push({ dx: Math.cos(ma) * md, dy: rng.range(-1.5, 2.5), dz: Math.sin(ma) * md, s: rng.range(3.0, 4.6) });
    }
    {
      const bend = lean * height;
      const cx = x + Math.sin(leanAz) * bend, cz = z - Math.cos(leanAz) * bend, cy = y0 + height - 3;
      height += liftFor(masses.map((c) => ({ x: cx + c.dx, y: cy + c.dy, z: cz + c.dz, s: c.s })));
    }
    const bend = lean * height;
    const cx = x + Math.sin(leanAz) * bend, cz = z - Math.cos(leanAz) * bend, cy = y0 + height - 3;
    if (inMoonWindow(x, y0 + height * 0.3, z, radius * 2) || inMoonWindow(x, y0 + height * 0.7, z, radius * 2) || inMoonWindow(cx, cy, cz, 4)) continue;
    const trunk = trunkGeometry(rng, { radius, height, lean, leanAz, radial: 8, rings: 8 });
    trunk.translate(x, y0, z);
    acc.tree = [y0, treeSeed(x, z)];
    addGeo(acc, trunk, BARKS[rng.int(0, BARKS.length - 1)]);
    for (const c of masses) crownMass(acc, rng, cx + c.dx, cy + c.dy, cz + c.dz, c.s, leaf(), { lobes });
  }
  acc.tree = [-200, 0];
  // the canopy between the crowns: big heaped leaf masses (rounded, several
  // bulges each — not flat discs) closing the roof over the far forest
  const fill = tier === 'low' ? 16 : 34;
  for (let k = 0; k < fill; k++) {
    const az = rng.range(-ARC * 0.85, ARC * 0.85);
    const r = rng.range(46, 95);
    const { x, z } = polar(r, az);
    const s = rng.range(6, 10);
    const y = Math.max(farHeight(x, z) + rng.range(38, 52), clearY(x, z) + s * 1.02);
    if (inMoonWindow(x, y, z, s * 1.5)) continue;
    crownMass(acc, rng, x, y, z, s, leaf(), { fine: r < coarseFrom, lobes: lobes + 1 });
  }
  // (deep, shaded forest floor — never a sunny meadow)
  addGeo(acc, skirtGeometry(), [0.07, 0.1, 0.07]);
  const merged = accGeometry(acc);

  const U = envUniforms;
  // depth haze of the far forest: stronger where there is no depth of field
  const q = ctx.quality ?? {};
  const fullPost = q.post === 'full' || (q.post === true && q.tier === 'high');
  const depthK = fullPost ? 0.42 : 0.62;
  const moonRim = U.uSnowLit; // (legacy key: the backdrop rim colour — silver by night)
  const forestMat = new THREE.ShaderMaterial({
    name: 'backdrop-forest',
    uniforms: {
      ...fogUniforms(),
      uKeyDir: U.uKeyDir,
      uKeyColor: U.uKeyColor,
      uNight: U.uNight,
      uMoonDir: U.uMoonDir,
      uMoonRim: moonRim,
      uSkyCol: { value: new THREE.Color('#9cc3c4') },
      uShadeCol: { value: new THREE.Color('#5d7f80') },
      uMoss: { value: new THREE.Color('#3f5a26') },
      uDepthK: { value: depthK },
    },
    vertexShader: FOREST_VERT,
    fragmentShader: FOREST_FRAG,
    // (plates, wet streaks, lichen and ivy: not on 'low')
    defines: { BARK_DETAIL: tier === 'low' ? 0 : 1 },
    fog: true,
  });
  const forest = new THREE.Mesh(merged, forestMat);
  forest.name = 'backdrop-forest';
  forest.matrixAutoUpdate = false;
  forest.castShadow = false;
  forest.receiveShadow = false;
  forest.raycast = () => {};

  // ── the leaf ceiling ──
  // forced gaps where the far god rays (env/shafts.js: azimuth −62 … −16°,
  // r ≈ 46–56, slanting up towards the sun in the west) cross the roof
  const sunH = new THREE.Vector2(-0.667, -0.269).normalize();
  const gaps = [[-62, 52], [-38, 48], [-16, 46], [20, 52]].map(([azDeg, r]) => {
    const a = THREE.MathUtils.degToRad(azDeg);
    const fx = Math.sin(a) * r, fz = -Math.cos(a) * r;
    const climb = azDeg > 0 ? 0 : 42; // (horizontal run of a ray from the floor up to the roof)
    return new THREE.Vector4(fx + sunH.x * climb, fz + sunH.y * climb, azDeg > 0 ? 10 : 13, 0);
  });
  const ceilMat = new THREE.ShaderMaterial({
    name: 'backdrop-ceiling',
    uniforms: {
      ...fogUniforms(),
      uKeyColor: U.uKeyColor,
      uKeyDir: U.uKeyDir,
      uNight: U.uNight,
      uMoonRim: moonRim,
      uMoonDir: U.uMoonDir,
      uGaps: { value: gaps },
    },
    vertexShader: CEIL_VERT,
    fragmentShader: CEIL_FRAG,
    side: THREE.DoubleSide,
    fog: true,
  });
  const ceiling = new THREE.Mesh(ceilingGeometry(tier), ceilMat);
  ceiling.name = 'backdrop-ceiling';
  ceiling.matrixAutoUpdate = false;
  ceiling.castShadow = false;
  ceiling.receiveShadow = false;
  ceiling.raycast = () => {};

  const mistMat = new THREE.ShaderMaterial({
    name: 'backdrop-mist',
    uniforms: {
      ...fogUniforms(),
      uTime: U.uTime,
      uNight: U.uNight,
      uMoonDir: U.uMoonDir,
      uOpacity: { value: 0.75 },
    },
    vertexShader: MIST_VERT,
    fragmentShader: MIST_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const mist = new THREE.Mesh(buildMist(tier), mistMat);
  mist.name = 'backdrop-mist';
  mist.matrixAutoUpdate = false;
  mist.renderOrder = -5;
  mist.frustumCulled = false;
  mist.raycast = () => {};

  // soft leafy edges through alpha-to-coverage only where the scene has 4×
  // MSAA (high); with 2 samples (medium) A2C stipples, so a clean cut instead
  const a2c = !!ctx.quality?.post && tier === 'high';
  const underMat = new THREE.ShaderMaterial({
    name: 'backdrop-understorey',
    uniforms: {
      ...fogUniforms(),
      uKeyColor: U.uKeyColor,
      uNight: U.uNight,
      uMoonDir: U.uMoonDir,
      uMoonRim: moonRim,
      uShadeCol: forestMat.uniforms.uShadeCol,
      uDepthK: { value: depthK },
      uCut: { value: a2c ? 0.02 : 0.5 },
    },
    vertexShader: UNDER_VERT,
    fragmentShader: UNDER_FRAG,
    side: THREE.DoubleSide,
    alphaToCoverage: a2c,
    fog: true,
  });
  const under = new THREE.Mesh(understoreyGeometry(rng, tier, feet), underMat);
  under.name = 'backdrop-understorey';
  under.matrixAutoUpdate = false;
  under.castShadow = false;
  under.receiveShadow = false;
  under.raycast = () => {};

  const group = new THREE.Group();
  group.name = 'backdrop';
  group.add(forest, ceiling, under, mist);
  return {
    group,
    forest,
    ceiling,
    understorey: under,
    mist,
    night(n) {
      forestMat.uniforms.uSkyCol.value.set('#9cc3c4').lerp(nightSky, n);
      forestMat.uniforms.uShadeCol.value.set('#5d7f80').lerp(nightShade, n);
      // the veils between the rows: barely there by day (the aerial perspective
      // does the depth), layered silver air by night
      mistMat.uniforms.uOpacity.value = 0.14 + 0.46 * n;
    },
    /** The leaf roof is seen from below only: hide it once the camera rises to it (the intro). */
    camera(cam) {
      ceiling.visible = cam.position.y < 37;
    },
  };
}

const nightSky = new THREE.Color('#33507c');
const nightShade = new THREE.Color('#1e3446');
