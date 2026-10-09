// ─────────────────────────────────────────────────────────────────────────────
// The far forest that encloses the glen (radius ≈ 40 … 100): colossal gnarled
// trunks with buttress roots, heavy canopy masses, low undergrowth, and soft
// mist curtains between the rows — all receding into blue-green haze (refs:
// the giant-tree elven village, the painterly mushroom waterfall, the misty
// fly-agaric path).
//
// Real geometry (so it parallaxes as the camera glides) but painted, not lit:
// a tiny custom shader gives warm sun-side tops, cool teal undersides and a
// golden rim where a silhouette is backlit; the shared aerial-perspective fog
// (env/fog.js) then grades every row into the mist. One merged mesh for the
// solid forest, one for the mist curtains — 2 draw calls.
//
// Only the arc the camera can ever look at is filled (the camera always looks
// roughly north: view azimuths within ±105° of −Z); the front stays open.
// The nearer forest (r ≲ 36) is built by the vegetation module; between it and
// the giants a fogged UNDERSTOREY band (r ≈ 36–54: shrub cards with soft,
// ragged leafy silhouettes, young trunks) closes every gap, so no bright open
// meadow ever reads through (+1 draw call).
//
// Foliage never reads as flat cut-out discs: lumpy masses whose silhouettes
// dissolve into the mist (ragged screen-door edge + a rim that fades into the
// fog colour), tinted towards the misty blue-green depth with distance. On
// tiers without depth of field (medium, low) that depth haze is stronger, so
// the far forest reads as soft painted depth, not as low-poly humps.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../../core/rng.js';
import { createNoise2D } from '../../core/noise.js';
import { getHeight } from '../ground.js';
import { TERRAIN_HALF_SIZE } from '../layout.js';
import { fogUniforms } from './fog.js';
import { envUniforms, GLSL_NOISE } from './celestial.js';

/** Azimuth range (radians, 0 = −Z / north, + = east) the backdrop covers. */
const ARC = THREE.MathUtils.degToRad(116);
const noise = createNoise2D(4711);

/** Ground height that keeps going beyond the terrain mesh (rising, misty hills). */
function farHeight(x, z) {
  const H = TERRAIN_HALF_SIZE - 0.5;
  const cx = THREE.MathUtils.clamp(x, -H, H);
  const cz = THREE.MathUtils.clamp(z, -H, H);
  const out = Math.hypot(x - cx, z - cz);
  return getHeight(cx, cz) + out * 0.18 + noise(x * 0.02, z * 0.02) * 2.5 * Math.min(1, out / 20);
}

const polar = (r, az) => ({ x: Math.sin(az) * r, z: -Math.cos(az) * r });

// ─── geometry builders (all non-indexed-free: we index everything) ───────────

/** A colossal trunk: flared buttress roots, taper, lean, gentle twist. */
function trunkGeometry(rng, { radius, height, lean, leanAz }) {
  const radial = 11;
  const rings = 12;
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

/** A tapered limb from a to b. */
function limbGeometry(a, b, r0, r1) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 7, 3, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

const icoBase = (detail) => {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  return mergeVertices(ico); // indexed → smooth normals after displacement
};
const blobFine = icoBase(2); // 320 triangles — nearer rows
const blobCoarse = icoBase(1); // 80 triangles — deep in the mist

/** A lumpy canopy mass (displaced, flattened icosphere). */
function blobGeometry(rng, cx, cy, cz, sx, sy, sz, coarse = false) {
  const g = (coarse ? blobCoarse : blobFine).clone();
  const p = g.attributes.position;
  const s = rng.range(0, 100);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.3 * noise(x * 1.8 + s, z * 1.8 + y * 1.3) + 0.16 * noise(x * 4.1 - s, y * 4.3 + z);
    // flat-ish bottoms like real crowns (but never a flat plate)
    const yy = y < 0 ? y * 0.7 : y;
    p.setXYZ(i, cx + x * sx * n, cy + yy * sy * n, cz + z * sz * n);
  }
  g.computeVertexNormals();
  return g;
}

function tint(g, rgb) {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(rgb, i * 3);
  g.setAttribute('aTint', new THREE.BufferAttribute(c, 3));
  return g;
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

// ─── shaders ────────────────────────────────────────────────────────────────

const FOREST_VERT = /* glsl */ `
  attribute vec3 aTint;
  varying vec3 vTint;
  varying vec3 vN;
  varying vec3 vW;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vTint = aTint;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FOREST_FRAG = /* glsl */ `
  uniform vec3 uKeyDir, uKeyColor, uSkyCol, uShadeCol, uMoss;
  uniform float uNight, uDepthK;
  varying vec3 vTint;
  varying vec3 vN;
  varying vec3 vW;
  ${GLSL_NOISE}
  #include <fog_pars_fragment>
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(vW - cameraPosition);
    // bark (brownish tint) vs foliage (green tint)
    float isBark = step(vTint.g, vTint.r + 0.02);
    // painterly breakup: broad colour patches that do not follow the mesh
    float patchN = envFbm(vW.xz * 0.09 + vW.y * 0.05);
    vec3 base = vTint * mix(0.75, 1.2, patchN);
    // bark: long vertical furrows + moss creeping up from the roots
    float around = dot(vW.xz, vec2(0.71, 0.71)) + dot(n.xz, vec2(-0.71, 0.71)) * 3.0;
    float furrow = envFbm(vec2(around * 1.6, vW.y * 0.09));
    base = mix(base, base * mix(0.55, 1.25, furrow), isBark);
    // moss on the up-facing root flares and in streaks down the windward side
    float mossAmt = isBark * (smoothstep(0.25, 0.85, n.y) * 0.75 + smoothstep(0.2, 0.9, -n.x) * 0.35) * smoothstep(0.35, 0.65, envNoise(vW.xz * 0.6 + vW.y * 0.2));
    base = mix(base, uMoss * mix(0.7, 1.1, patchN), clamp(mossAmt, 0.0, 0.85));
    // never let a far-forest crown loom in front of the lens: when the camera
    // is high above the glen (the intro descends from above the canopy) the
    // backdrop near it dissolves (screen-door), as does anything very close
    float camD = length(vW - cameraPosition);
    float horiz = length(vW.xz - cameraPosition.xz);
    float high = smoothstep(38.0, 70.0, cameraPosition.y);
    float keep = smoothstep(22.0, 36.0, camD);
    // (only crowns: they are the big shapes that would block the view down into the glen)
    if (vTint.g > vTint.r + 0.02) keep *= 1.0 - high * (1.0 - smoothstep(42.0, 54.0, horiz));
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (keep < ign) discard;
    // foliage: ragged, leafy silhouettes — break the edges of each mass up with noise
    float rim = 1.0 - abs(dot(n, v));
    if (isBark < 0.5) {
      float leafN = envNoise(vW.xy * 1.1 + vW.z * 0.63) * 0.55 + envNoise(vW.zy * 2.7 + vW.x * 0.4) * 0.3 + envNoise(vW.xz * 5.3 + vW.y * 4.1) * 0.15;
      if (rim > 0.32 + 0.6 * leafN) discard;
    }
    // foliage: clumpy leaf masses — darker gaps, lighter clump tops
    float clump = envFbm(vW.xz * 0.35 + vW.y * 0.4) * 0.6 + envNoise(vW.xz * 1.7 + vW.y * 1.3) * 0.4;
    base = mix(base, base * mix(0.6, 1.3, clump) * (0.85 + 0.3 * max(n.y, 0.0)), 1.0 - isBark);
    // soft wrapped key light, sky from above, teal shade below
    float key = clamp(dot(n, uKeyDir) * 0.6 + 0.4, 0.0, 1.0);
    vec3 col = base * (uShadeCol * 0.9 + uKeyColor * key * 0.6 + uSkyCol * max(n.y, 0.0) * 0.4);
    // golden rim where a silhouette is backlit by the sun
    float facing = pow(1.0 - abs(dot(n, v)), 2.5);
    float toward = pow(max(dot(v, uKeyDir), 0.0), 2.0);
    col += uKeyColor * facing * (0.06 + 0.4 * toward) * 0.35 * (1.0 - 0.6 * uNight);
    // soft painted depth: foliage silhouettes dissolve into the mist at their
    // rims, and everything sinks towards the misty blue-green with distance
    // from the glen (stronger on tiers without depth of field)
    vec4 hazeV = woodlandFog(vW);
    float softRim = (1.0 - isBark) * smoothstep(0.25, 0.85, rim) * 0.4;
    float depth = smoothstep(36.0, 100.0, length(vW.xz)) * uDepthK;
    col = mix(col, hazeV.rgb, clamp(softRim + depth - softRim * depth, 0.0, 0.85));
    gl_FragColor = vec4(col, 1.0);
    // same order as three's built-in materials: the fog chunk expects display space
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
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
    vec4 fogV = woodlandFog(vW);
    // by day the veils are a touch deeper than the haze (no fog-white walls);
    // by night they catch the moon a little so the trunks stand out against them
    vec3 col = fogV.rgb * mix(mix(0.94, 1.02, n), mix(1.1, 1.22, n), uNight);
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function buildMist(rng, tier) {
  const layers = tier === 'low' ? [58] : [48, 62, 78];
  const parts = [];
  layers.forEach((r, li) => {
    const seg = 64;
    const height = 18 + li * 6;
    // CylinderGeometry's theta 0 is +Z, so θ = π (the arc's centre) is −Z
    const g = new THREE.CylinderGeometry(r, r, height, seg, 1, true, Math.PI - ARC, 2 * ARC);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const base = farHeight(x, z) - 1.5;
      const top = p.getY(i) > 0;
      p.setY(i, top ? base + height : base);
    }
    const layer = new Float32Array(p.count).fill(li / Math.max(1, layers.length - 1));
    g.setAttribute('aLayer', new THREE.BufferAttribute(layer, 1));
    g.deleteAttribute('normal');
    parts.push(g);
  });
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  void rng;
  return merged;
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
  uniform vec3 uKeyColor, uSkyCol, uShadeCol;
  uniform float uNight, uDepthK, uCut;
  varying vec2 vUv;
  varying vec2 vSeed;
  varying vec3 vW;
  ${GLSL_NOISE}
  #include <fog_pars_fragment>
  void main() {
    float x = vUv.x * 2.0 - 1.0;
    float sd = vSeed.x * 37.0;
    // a shrub: a few overlapping round leaf masses (kind 1: a lower, wider
    // bush) with a finely ragged leafy outline — no single dome, no spikes
    float h = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float cx = (envHash(vec2(sd, fi * 7.1)) * 2.0 - 1.0) * 0.55;
      float r = mix(0.32, 0.55, envHash(vec2(fi * 3.3, sd + 1.7)));
      float cy = mix(0.25, 0.5, envHash(vec2(sd + fi, 5.3))) * (1.0 - 0.45 * vSeed.y);
      float dx = (x - cx) / r;
      h = max(h, cy + r * sqrt(max(1.0 - dx * dx, 0.0)) * (1.0 - 0.3 * vSeed.y));
    }
    h *= 1.0 - 0.15 * x * x;
    h -= 0.07 * envNoise(vUv * vec2(22.0, 15.0) + sd) + 0.04 * envNoise(vUv * vec2(48.0, 31.0) - sd);
    // a soft edge (alpha to coverage where there is MSAA, a clean cut elsewhere)
    float alpha = smoothstep(h, h - 0.06, vUv.y);
    if (alpha < uCut) discard;
    // never loom in front of the lens
    float camD = length(vW - cameraPosition);
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (smoothstep(5.0, 11.0, camD) < ign) discard;
    // deep shaded greens, a little light catching the tops
    // leafy greens like the glen's own undergrowth (not a teal cut-out):
    // clumps of lighter and darker leaves, darker towards the ground
    vec3 base = mix(vec3(0.15, 0.23, 0.07), vec3(0.22, 0.29, 0.08), envNoise(vW.xz * 0.4 + sd));
    float top = vUv.y / max(h, 0.05);
    base *= (0.45 + 0.75 * top) * (0.7 + 0.6 * envNoise(vUv * vec2(9.0, 6.0) + sd * 3.0));
    // warm-neutral leaf-filtered ambient by day (the backdrop's moonlit shade by night)
    vec3 amb = mix(vec3(0.34, 0.38, 0.27), uShadeCol * 0.9, uNight);
    float sunPatch = smoothstep(0.35, 0.75, envNoise(vW.xz * 0.21 + 5.0));
    vec3 col = base * (amb + uKeyColor * (0.08 + 0.3 * sunPatch) * top + uSkyCol * 0.12 * top);
    // where there is no depth of field the band also sinks a little into the haze
    // (and the feet melt into the ground mist)
    vec4 hazeV = woodlandFog(vW);
    col = mix(col, hazeV.rgb, 0.2 * uDepthK + 0.25 * (1.0 - smoothstep(0.0, 0.45, top)));
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Shrub cards of the understorey band (crossed vertical quads). */
function understoreyGeometry(rng, tier, feet = []) {
  const clumps = tier === 'low' ? 70 : tier === 'medium' ? 110 : 170;
  const pos = [];
  const uv = [];
  const seed = [];
  const idx = [];
  let v = 0;
  for (let k = 0; k < clumps + feet.length; k++) {
    let x, z, big = 1;
    if (k < clumps) {
      const az = -ARC - 0.1 + ((k + rng.range(0, 1)) / clumps) * (2 * ARC + 0.2);
      const r = 36 + Math.pow(rng.next(), 1.3) * 18;
      ({ x, z } = polar(r, az));
    } else {
      // shrubs at the feet of the giants
      const f = feet[k - clumps];
      x = f.x;
      z = f.z;
      big = f.s / 2.2;
    }
    const y0 = farHeight(x, z) - 0.35;
    const low = rng.next() < 0.4; // a low, wide bush
    const w = (low ? rng.range(3, 5.5) : rng.range(3, 6.5)) * big;
    const h = (low ? rng.range(1.4, 2.4) : rng.range(1.8, 4.2)) * big;
    const sd = rng.next();
    const rot = rng.range(0, Math.PI);
    for (let q = 0; q < 2; q++) {
      const a = rot + q * (Math.PI / 2 + rng.range(-0.3, 0.3));
      const dx = Math.cos(a) * w * 0.5, dz = Math.sin(a) * w * 0.5;
      pos.push(x - dx, y0, z - dz, x + dx, y0, z + dz, x + dx, y0 + h, z + dz, x - dx, y0 + h, z - dz);
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
  const parts = [];

  const BARKS = [[0.16, 0.14, 0.11], [0.18, 0.14, 0.1], [0.14, 0.14, 0.12], [0.15, 0.13, 0.1]];
  const LEAF = [[0.17, 0.25, 0.12], [0.13, 0.22, 0.14], [0.2, 0.27, 0.13], [0.11, 0.19, 0.13]];
  /** Feet of the trees, where the understorey mesh adds shrub cards. */
  const feet = [];

  // crowns from this radius on use the coarse blob (deep in the mist; on
  // 'medium' — phones — already from the second row)
  const coarseFrom = tier === 'high' ? 72 : 50;
  // receding rows of colossal trees, the farthest a ghostly wall in the haze
  // (low: fewer trees, but enough that the gaps between them do not open onto bare sky)
  const rows = [
    { r: [41, 50], count: tier === 'low' ? 11 : 15, radius: [1.6, 2.8], height: [34, 46] },
    { r: [54, 66], count: tier === 'low' ? 12 : 17, radius: [2.2, 3.6], height: [42, 56] },
    { r: [72, 92], count: tier === 'low' ? 12 : 19, radius: [2.8, 4.6], height: [50, 66] },
    { r: [100, 135], count: tier === 'low' ? 7 : tier === 'medium' ? 14 : 22, radius: [3.5, 6], height: [60, 80], far: true },
    // understory: smaller trees whose crowns sit low enough to be seen between the giants
    { r: [50, 80], count: tier === 'low' ? 6 : 14, radius: [0.8, 1.4], height: [18, 28], under: true },
  ];
  const leaf = () => LEAF[rng.int(0, LEAF.length - 1)];
  const v = new THREE.Vector3();
  for (const row of rows) {
    for (let k = 0; k < row.count; k++) {
      const az = -ARC + ((k + rng.range(0.15, 0.85)) / row.count) * 2 * ARC;
      const r = rng.range(row.r[0], row.r[1]);
      const { x, z } = polar(r, az);
      const y0 = farHeight(x, z);
      const radius = rng.range(row.radius[0], row.radius[1]);
      const height = rng.range(row.height[0], row.height[1]);
      // the old giants lean and bend; a few lean a lot
      const lean = rng.next() < 0.2 ? rng.range(0.02, 0.035) : rng.range(0.004, 0.018);
      const leanAz = rng.range(0, Math.PI * 2);
      const bark = BARKS[rng.int(0, BARKS.length - 1)];
      const trunk = trunkGeometry(rng, { radius, height, lean, leanAz });
      trunk.translate(x, y0, z);
      parts.push(tint(trunk, bark));
      const topY = y0 + height - 3;
      const bend = lean * height;
      const tx = x + Math.sin(leanAz) * bend;
      const tz = z - Math.cos(leanAz) * bend;
      // heavy limbs: some fork low (gnarled giants), most reach out into the crown
      const limbs = row.far ? 0 : rng.int(2, 4);
      for (let l = 0; l < limbs; l++) {
        const la = rng.range(0, Math.PI * 2);
        const low = !row.under && l === 0 && rng.next() < 0.45;
        const fromY = low ? y0 + height * rng.range(0.35, 0.55) : topY - height * rng.range(0.12, 0.3);
        const from = new THREE.Vector3(tx - Math.sin(leanAz) * bend * (low ? 0.5 : 0), fromY, tz + Math.cos(leanAz) * bend * (low ? 0.5 : 0));
        const reach = radius * rng.range(3, 5.5) * (low ? 1.6 : 1);
        const to = v.set(from.x + Math.cos(la) * reach, (low ? fromY + reach * 0.9 : topY + rng.range(2, 7)), from.z + Math.sin(la) * reach).clone();
        parts.push(tint(limbGeometry(from, to, radius * (low ? 0.5 : 0.45), radius * 0.18), bark));
        if (low) {
          const s = radius * rng.range(2.4, 3.4);
          parts.push(tint(blobGeometry(rng, to.x, to.y + s * 0.3, to.z, s * 1.3, s * 0.7, s * 1.3), leaf()));
        }
      }
      // crown: a cluster of lumpy masses
      // (dense enough that, seen from above during the intro, the glen reads as
      // a clearing in a closed canopy)
      // towards the open front (the arc's ends) crowns thin out, so the intro's
      // descent from above the south-east never looks through a blob
      const side = 1 - 0.45 * THREE.MathUtils.smoothstep(Math.abs(az), THREE.MathUtils.degToRad(85), ARC);
      if (row.under) {
        // understory crowns: a loose cluster of round leafy lumps (one wide,
        // flattened mass reads as a flat plate from below)
        const lumps = Math.round(rng.int(5, 7) * side);
        for (let m = 0; m < lumps; m++) {
          const ma = rng.range(0, Math.PI * 2);
          const md = radius * rng.range(0.4, 3.2) * 1.5;
          const s = radius * rng.range(1.7, 2.8) * 1.4 * side;
          parts.push(tint(blobGeometry(rng, tx + Math.cos(ma) * md, topY + rng.range(-1.5, 3.5), tz + Math.sin(ma) * md, s * 1.1, s * 0.95, s * 1.1, row.r[0] >= coarseFrom), leaf()));
        }
      } else {
        const masses = Math.round((row.far ? rng.int(3, 5) : rng.int(5, 7)) * side);
        for (let m = 0; m < masses; m++) {
          const ma = rng.range(0, Math.PI * 2);
          const md = radius * rng.range(1.2, 4.8);
          const s = radius * rng.range(2.8, 4.6) * side;
          const cx = tx + Math.cos(ma) * md, cy = topY + rng.range(1, 9), cz = tz + Math.sin(ma) * md;
          parts.push(tint(blobGeometry(rng, cx, cy, cz, s * 1.25, s * 0.85, s * 1.25, row.r[0] >= coarseFrom), leaf()));
          // nearer rows: a smaller clump hanging under the mass breaks its flat underside
          if (!row.far && rng.next() < 0.75) {
            const sa = rng.range(0, Math.PI * 2);
            const ss = s * rng.range(0.4, 0.6);
            parts.push(tint(blobGeometry(rng, cx + Math.cos(sa) * s * 0.6, cy - s * 0.45, cz + Math.sin(sa) * s * 0.6, ss * 1.1, ss * 0.9, ss * 1.1, true), leaf()));
          }
        }
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
  // giants' feet, their small crowns lost up in the canopy ceiling
  const young = tier === 'low' ? 8 : tier === 'medium' ? 14 : 20;
  for (let k = 0; k < young; k++) {
    const az = -ARC + ((k + rng.range(0.1, 0.9)) / young) * 2 * ARC;
    const r = rng.range(44, 58);
    const { x, z } = polar(r, az);
    const y0 = farHeight(x, z);
    const radius = rng.range(0.65, 1.15);
    const height = rng.range(30, 42);
    const lean = rng.range(0.004, 0.03);
    const leanAz = rng.range(0, Math.PI * 2);
    const trunk = trunkGeometry(rng, { radius, height, lean, leanAz });
    trunk.translate(x, y0, z);
    parts.push(tint(trunk, BARKS[rng.int(0, BARKS.length - 1)]));
    const bend = lean * height;
    const cx = x + Math.sin(leanAz) * bend, cz = z - Math.cos(leanAz) * bend, cy = y0 + height - 3;
    const lumps = rng.int(3, 4);
    for (let m = 0; m < lumps; m++) {
      const s = rng.range(2.2, 3.6);
      const ma = rng.range(0, Math.PI * 2);
      const md = rng.range(0.3, 2.2);
      parts.push(tint(blobGeometry(rng, cx + Math.cos(ma) * md, cy + rng.range(-1.5, 1.5), cz + Math.sin(ma) * md, s * 1.1, s * 0.95, s * 1.1, true), leaf()));
    }
  }
  // fill the gaps of the canopy ceiling between the crowns
  const fill = tier === 'low' ? 16 : 34;
  for (let k = 0; k < fill; k++) {
    const az = rng.range(-ARC * 0.85, ARC * 0.85);
    const r = rng.range(46, 95);
    const { x, z } = polar(r, az);
    const s = rng.range(7, 13);
    parts.push(tint(blobGeometry(rng, x, farHeight(x, z) + rng.range(36, 52), z, s * 1.4, s * 0.7, s * 1.4, r > coarseFrom), leaf()));
  }
  const skirt = skirtGeometry();
  // (deep, shaded forest floor — never a sunny meadow)
  parts.push(tint(skirt, [0.07, 0.1, 0.07]));

  // all parts: position, normal, aTint (+ index) — strip anything else so they merge
  for (const g of parts) {
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'aTint'].includes(name)) g.deleteAttribute(name);
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  merged.computeBoundingSphere();

  const U = envUniforms;
  // depth haze of the far forest: stronger where there is no depth of field
  const q = ctx.quality ?? {};
  const fullPost = q.post === 'full' || (q.post === true && q.tier === 'high');
  const depthK = fullPost ? 0.42 : 0.62;
  const forestMat = new THREE.ShaderMaterial({
    name: 'backdrop-forest',
    uniforms: {
      ...fogUniforms(),
      uKeyDir: U.uKeyDir,
      uKeyColor: U.uKeyColor,
      uNight: U.uNight,
      uSkyCol: { value: new THREE.Color('#9cc3c4') },
      uShadeCol: { value: new THREE.Color('#5d7f80') },
      uMoss: { value: new THREE.Color('#3f5a26') },
      uDepthK: { value: depthK },
    },
    vertexShader: FOREST_VERT,
    fragmentShader: FOREST_FRAG,
    fog: true,
  });
  const forest = new THREE.Mesh(merged, forestMat);
  forest.name = 'backdrop-forest';
  forest.matrixAutoUpdate = false;
  forest.castShadow = false;
  forest.receiveShadow = false;
  forest.raycast = () => {};

  const mistMat = new THREE.ShaderMaterial({
    name: 'backdrop-mist',
    uniforms: {
      ...fogUniforms(),
      uTime: U.uTime,
      uNight: U.uNight,
      uOpacity: { value: 0.75 },
    },
    vertexShader: MIST_VERT,
    fragmentShader: MIST_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const mist = new THREE.Mesh(buildMist(rng, tier), mistMat);
  mist.name = 'backdrop-mist';
  mist.matrixAutoUpdate = false;
  mist.renderOrder = -5;
  mist.frustumCulled = false;
  mist.raycast = () => {};

  // (the post chain renders into a multisampled target; 'low' has no MSAA)
  const msaa = !!ctx.quality?.post;
  const underMat = new THREE.ShaderMaterial({
    name: 'backdrop-understorey',
    uniforms: {
      ...fogUniforms(),
      uKeyColor: U.uKeyColor,
      uNight: U.uNight,
      uSkyCol: forestMat.uniforms.uSkyCol,
      uShadeCol: forestMat.uniforms.uShadeCol,
      uDepthK: { value: depthK },
      // soft leafy edges through alpha-to-coverage where the scene is multisampled
      uCut: { value: msaa ? 0.02 : 0.5 },
    },
    vertexShader: UNDER_VERT,
    fragmentShader: UNDER_FRAG,
    side: THREE.DoubleSide,
    alphaToCoverage: msaa,
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
  group.add(forest, under, mist);
  return { group, forest, understorey: under, mist, night(n) {
    forestMat.uniforms.uSkyCol.value.set('#9cc3c4').lerp(nightSky, n);
    forestMat.uniforms.uShadeCol.value.set('#5d7f80').lerp(nightShade, n);
  } };
}

const nightSky = new THREE.Color('#33507c');
const nightShade = new THREE.Color('#1e3446');
