// ─────────────────────────────────────────────────────────────────────────────
// Terrain — the painted meadow, built from the SAME baked heightGrid/pathGrid
// as ground.js so what you see is exactly what the player walks on.
//
// Geometry: one merged mesh (one draw call) with three nested LOD rings:
//   fine  ±90  at the bake resolution (0.75)  — the whole walkable valley
//   mid   ±150 at 3 units                      — the forest rim
//   far   r≈460 at 15 units                    — distant rolling hills that
//                                                close the horizon (no void)
// Edge vertices of a finer ring are snapped onto the coarser ring's edges, so
// there are no cracks.
//
// Look: vertex-colour painting (noise patches, lighter hill tips, darker
// hollows, warm clearing rims, soft irregular dirt paths, a sandy pond shore,
// darker forest floor beyond the walkable radius) + a cheap world-space detail
// layer in the shader (painterly grass strokes, pebbles on paths) and slow
// drifting cloud shadows. Soft toon ramp, receives shadows.
//
// ctx.terrainMesh = the mesh.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { heightGrid, pathGrid, GRID_RES, analyticHeight } from './ground.js';
import { TERRAIN_HALF_SIZE, WORLD_RADIUS, AREAS, POND } from './layout.js';
import { palette } from '../core/palette.js';
import { softToonGradient, sharedUniforms } from '../core/materials.js';
import { createNoise2D, fbm } from '../core/noise.js';
import { smoothstep, clamp } from '../core/rng.js';
import { GLSL_NOISE } from './env/celestial.js';

const HALF = TERRAIN_HALF_SIZE;
const N = GRID_RES + 1;
const CELL = (HALF * 2) / GRID_RES;
const FINE_HALF = 90;
const MID_STEP = 4; // in bake cells (3 units)
const FAR_CELL = 15;
const FAR_RADIUS = 465;

const nA = createNoise2D(4242);
const nB = createNoise2D(1717);
const nC = createNoise2D(9001);
const nD = createNoise2D(31337);

const C = (hex) => new THREE.Color(hex);
const COL = {
  grass: C(palette.grass),
  grassLight: C(palette.grassLight),
  grassDark: C(palette.grassDark),
  grassWarm: C(palette.grassLight).lerp(C(palette.autumnYellow), 0.32),
  lawn: C(palette.grass).lerp(C(palette.grassLight), 0.3),
  rimWarm: C(palette.grassLight).lerp(C(palette.dirt), 0.3),
  forest: C(palette.leafDark).lerp(C(palette.moss), 0.35),
  farForest: C(palette.pine).lerp(C(palette.leafDark), 0.5),
  earth: C(palette.dirtDark).lerp(C(palette.moss), 0.35),
  dirt: C(palette.dirt),
  dirtDark: C(palette.dirtDark),
  sand: C(palette.sand),
  mud: C(palette.dirtDark).lerp(C('#6d6a4a'), 0.5),
  pondBed: C('#5d7a5a').lerp(C(palette.waterDeep), 0.25),
  lush: C(palette.leafDark).lerp(C(palette.grass), 0.45),
  cool: C(palette.moss).lerp(C(palette.leafDark), 0.35),
};

const gi = (i, j) => heightGrid[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)];
const gp = (i, j) => pathGrid[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)];

/** Height for the far ring (outside the bake): keeps rising gently into distant hills. */
function farHeight(x, z) {
  const m = Math.max(Math.abs(x), Math.abs(z));
  if (m <= HALF) {
    const i = Math.round((x + HALF) / CELL), j = Math.round((z + HALF) / CELL);
    return gi(i, j);
  }
  const rise = Math.pow(smoothstep(HALF, FAR_RADIUS, m), 1.2);
  return analyticHeight(x, z, 8) + rise * (12 + 16 * (fbm(nD, x * 0.006, z * 0.006, 3) * 0.5 + 0.5));
}

const _c = new THREE.Color();
const _d = new THREE.Color();

/**
 * Paint one vertex (meadow, clearings, forest, pond shore). Returns the
 * normalised path distance for the shader, which paints the dirt paths.
 * curv > 0 on convex bumps, < 0 in hollows. ny = normal.y.
 */
function paint(x, z, h, ny, pd, curv, out) {
  const r = Math.hypot(x, z);
  const n1 = fbm(nA, x * 0.03, z * 0.03, 3);
  const n2 = nB(x * 0.11, z * 0.11);
  const n3 = nC(x * 0.37, z * 0.37);

  // meadow patches
  _c.copy(COL.grass);
  _c.lerp(COL.grassLight, smoothstep(-0.1, 0.7, n1) * 0.65);
  _c.lerp(COL.grassDark, smoothstep(0.05, 0.75, -n1) * 0.6);
  // cooler, mossy hollows of medium size
  _c.lerp(COL.cool, smoothstep(0.2, 0.75, nC(x * 0.06 + 3.1, z * 0.06 - 7.7)) * 0.35);
  _c.lerp(COL.grassWarm, smoothstep(0.35, 0.95, n2) * 0.28);
  _c.multiplyScalar(1 + n3 * 0.04);

  // hill tips catch light, hollows hold shade
  _c.multiplyScalar(1 + clamp(curv * 1.1, -0.16, 0.12));
  // gentle height tint inside the valley: tops a touch sunnier
  if (h > 0.3 && r < WORLD_RADIUS) _c.lerp(COL.grassWarm, smoothstep(0.3, 3, h) * 0.15);

  // clearings: kept lawn inside, warm sunny rim around the edge
  for (let a = 0; a < AREAS.length; a++) {
    const A = AREAS[a];
    const dd = Math.hypot(x - A.center.x, z - A.center.z) - A.radius;
    if (dd > 8) continue;
    const lawn = 1 - smoothstep(-2.5, 0.5, dd);
    _c.lerp(COL.lawn, lawn * 0.3);
    const rim = 1 - smoothstep(0, 4, Math.abs(dd - 0.8 + n2 * 0.8));
    _c.lerp(COL.rimWarm, rim * 0.28);
  }

  // towards the forest: deeper, cooler greens
  const forest = smoothstep(WORLD_RADIUS - 6, WORLD_RADIUS + 30, r);
  _c.lerp(COL.forest, forest * (0.5 + 0.15 * n1));
  const farForest = smoothstep(HALF - 20, HALF + 60, Math.max(Math.abs(x), Math.abs(z)));
  _c.lerp(COL.farForest, farForest * 0.7);

  // steep banks show a bit of earth
  _c.lerp(COL.earth, smoothstep(0.88, 0.7, ny) * 0.4);

  // pond: lush rim → wet sand → muddy bed
  const pdist = Math.hypot(x - POND.center.x, z - POND.center.z);
  if (pdist < POND.radius * 1.8) {
    const wl = POND.waterLevel;
    const lush = smoothstep(wl + 0.9, wl + 0.35, h) * (1 - smoothstep(wl + 0.3, wl + 0.1, h));
    _c.lerp(COL.lush, lush * 0.45);
    const shore = smoothstep(wl + 0.32, wl + 0.12, h);
    _d.copy(COL.sand).lerp(COL.mud, smoothstep(wl + 0.05, wl - 0.25, h));
    _c.lerp(_d, shore);
    _c.lerp(COL.pondBed, smoothstep(wl - 0.25, wl - 0.9, h));
  }

  // Dirt paths are painted per pixel in the shader (crisp irregular edges);
  // here we only pass the normalised path distance along.
  out.copy(_c);
  return Math.min(pd, 4);
}

/** Accumulates vertices/indices of several grids into one geometry. */
function createBuilder() {
  const pos = [], nrm = [], col = [], det = [], idx = [];
  return {
    pos, nrm, col, det, idx,
    get count() {
      return pos.length / 3;
    },
    vertex(x, y, z, n, c, d) {
      pos.push(x, y, z);
      nrm.push(n.x, n.y, n.z);
      col.push(c.r, c.g, c.b);
      det.push(d);
    },
    /** Quad a b / c d (a=(i,j), b=(i+1,j), c=(i,j+1), d=(i+1,j+1)); split along the flatter diagonal. */
    quad(a, b, c, d) {
      const ya = pos[a * 3 + 1], yb = pos[b * 3 + 1], yc = pos[c * 3 + 1], yd = pos[d * 3 + 1];
      if (Math.abs(ya - yd) < Math.abs(yb - yc)) idx.push(a, c, d, a, d, b);
      else idx.push(a, c, b, b, c, d);
    },
  };
}

function buildGeometry() {
  const B = createBuilder();
  const n = new THREE.Vector3();
  const c = new THREE.Color();

  // ── fine ring: bake indices f0..f1 ──
  const f0 = Math.round((HALF - FINE_HALF) / CELL);
  const f1 = Math.round((HALF + FINE_HALF) / CELL);
  const fineW = f1 - f0 + 1;
  const fineBase = B.count;
  for (let j = f0; j <= f1; j++) {
    for (let i = f0; i <= f1; i++) {
      let h = gi(i, j);
      const edgeI = i === f0 || i === f1, edgeJ = j === f0 || j === f1;
      // snap edge vertices onto the mid ring's straight edges (no cracks)
      if (edgeI && !edgeJ) {
        const j0 = Math.floor(j / MID_STEP) * MID_STEP;
        h = THREE.MathUtils.lerp(gi(i, j0), gi(i, j0 + MID_STEP), (j - j0) / MID_STEP);
      } else if (edgeJ && !edgeI) {
        const i0 = Math.floor(i / MID_STEP) * MID_STEP;
        h = THREE.MathUtils.lerp(gi(i0, j), gi(i0 + MID_STEP, j), (i - i0) / MID_STEP);
      }
      const e = edgeI || edgeJ ? MID_STEP : 1;
      n.set(gi(i - e, j) - gi(i + e, j), 2 * e * CELL, gi(i, j - e) - gi(i, j + e)).normalize();
      const curv = h - 0.25 * (gi(i - 2, j) + gi(i + 2, j) + gi(i, j - 2) + gi(i, j + 2));
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      const d = paint(x, z, h, n.y, gp(i, j), curv, c);
      B.vertex(x, h, z, n, c, d);
    }
  }
  for (let j = 0; j < fineW - 1; j++) {
    for (let i = 0; i < fineW - 1; i++) {
      const a = fineBase + j * fineW + i;
      B.quad(a, a + 1, a + fineW, a + fineW + 1);
    }
  }

  // ── mid ring: every MID_STEP bake cells, hole = fine ring ──
  const midW = GRID_RES / MID_STEP + 1;
  const farStepInMid = FAR_CELL / (CELL * MID_STEP); // 5
  const midBase = B.count;
  for (let mj = 0; mj < midW; mj++) {
    for (let mi = 0; mi < midW; mi++) {
      const i = mi * MID_STEP, j = mj * MID_STEP;
      let h = gi(i, j);
      const edgeI = mi === 0 || mi === midW - 1, edgeJ = mj === 0 || mj === midW - 1;
      if (edgeI && !edgeJ) {
        const k0 = Math.floor(mj / farStepInMid) * farStepInMid;
        h = THREE.MathUtils.lerp(gi(i, k0 * MID_STEP), gi(i, (k0 + farStepInMid) * MID_STEP), (mj - k0) / farStepInMid);
      } else if (edgeJ && !edgeI) {
        const k0 = Math.floor(mi / farStepInMid) * farStepInMid;
        h = THREE.MathUtils.lerp(gi(k0 * MID_STEP, j), gi((k0 + farStepInMid) * MID_STEP, j), (mi - k0) / farStepInMid);
      }
      const e = MID_STEP;
      n.set(gi(i - e, j) - gi(i + e, j), 2 * e * CELL, gi(i, j - e) - gi(i, j + e)).normalize();
      const curv = h - 0.25 * (gi(i - 4, j) + gi(i + 4, j) + gi(i, j - 4) + gi(i, j + 4));
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      const d = paint(x, z, h, n.y, gp(i, j), curv * 0.5, c);
      B.vertex(x, h, z, n, c, d);
    }
  }
  const hole0 = f0 / MID_STEP, hole1 = f1 / MID_STEP;
  for (let mj = 0; mj < midW - 1; mj++) {
    for (let mi = 0; mi < midW - 1; mi++) {
      if (mi >= hole0 && mi < hole1 && mj >= hole0 && mj < hole1) continue;
      const a = midBase + mj * midW + mi;
      B.quad(a, a + 1, a + midW, a + midW + 1);
    }
  }

  // ── far ring: coarse grid out to the horizon, hole = bake square ──
  const farHalfCells = Math.ceil(FAR_RADIUS / FAR_CELL);
  const farW = farHalfCells * 2 + 1;
  const farBase = B.count;
  const fh = new Float32Array(farW * farW);
  for (let j = 0; j < farW; j++) {
    for (let i = 0; i < farW; i++) {
      fh[j * farW + i] = farHeight((i - farHalfCells) * FAR_CELL, (j - farHalfCells) * FAR_CELL);
    }
  }
  const fget = (i, j) => fh[clamp(j, 0, farW - 1) * farW + clamp(i, 0, farW - 1)];
  for (let j = 0; j < farW; j++) {
    for (let i = 0; i < farW; i++) {
      const x = (i - farHalfCells) * FAR_CELL, z = (j - farHalfCells) * FAR_CELL;
      const h = fget(i, j);
      n.set(fget(i - 1, j) - fget(i + 1, j), 2 * FAR_CELL, fget(i, j - 1) - fget(i, j + 1)).normalize();
      const curv = h - 0.25 * (fget(i - 1, j) + fget(i + 1, j) + fget(i, j - 1) + fget(i, j + 1));
      const d = paint(x, z, h, n.y, 8, curv * 0.15, c);
      B.vertex(x, h, z, n, c, d);
    }
  }
  const holeF = HALF / FAR_CELL; // 10
  for (let j = 0; j < farW - 1; j++) {
    for (let i = 0; i < farW - 1; i++) {
      const ci = i - farHalfCells, cj = j - farHalfCells;
      if (ci >= -holeF && ci < holeF && cj >= -holeF && cj < holeF) continue;
      const cx = (ci + 0.5) * FAR_CELL, cz = (cj + 0.5) * FAR_CELL;
      if (Math.hypot(cx, cz) > FAR_RADIUS) continue;
      const a = farBase + j * farW + i;
      B.quad(a, a + 1, a + farW, a + farW + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(B.nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
  geo.setAttribute('aPath', new THREE.Float32BufferAttribute(B.det, 1));
  geo.setIndex(B.idx);
  geo.computeBoundingSphere();
  return geo;
}

function createTerrainMaterial(quality) {
  const mat = new THREE.MeshToonMaterial({
    color: 0xffffff,
    vertexColors: true,
    gradientMap: softToonGradient,
  });
  mat.name = 'terrain';
  const detail = quality.tier !== 'low';
  const uniforms = {
    uTime: sharedUniforms.uTime,
    uNight: sharedUniforms.uNight,
    uCloudShadow: { value: quality.tier === 'low' ? 0 : 1 },
    uDirt: { value: COL.dirt.clone() },
    uDirtDark: { value: COL.dirtDark.clone() },
    uSand: { value: COL.sand.clone() },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aPath;
        varying float vPath;
        varying vec3 vTWorld;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vPath = aPath;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uNight;
        uniform float uCloudShadow;
        uniform vec3 uDirt, uDirtDark, uSand;
        varying float vPath;
        varying vec3 vTWorld;
        ${GLSL_NOISE}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 p = vTWorld.xz;
          float camD = length(vTWorld - cameraPosition);
          float nearK = 1.0 - smoothstep(16.0, 55.0, camD);
          float midK = 1.0 - smoothstep(40.0, 160.0, camD);
          // ── dirt paths: irregular, crisp (anti-aliased) edges, worn lighter centre ──
          float e = vPath + (envNoise(p * 0.85) - 0.5) * 0.34 + (envNoise(p * 3.3 + 1.7) - 0.5) * 0.12;
          float aa = fwidth(e) * 0.9 + 0.01;
          float dirt = 1.0 - smoothstep(0.9 - aa, 0.9 + aa, e);
          float rim = smoothstep(0.86, 1.0, e) * (1.0 - smoothstep(1.0, 1.5, e));
          vec3 dcol = mix(uDirt, uSand, (1.0 - smoothstep(0.0, 0.55, vPath)) * 0.32);
          dcol = mix(dcol, uDirtDark, smoothstep(0.45, 0.9, e) * 0.5);
          diffuseColor.rgb *= 1.0 - rim * 0.1;
          diffuseColor.rgb = mix(diffuseColor.rgb, dcol, dirt);
          ${detail ? `
          // painterly grass: two crossing families of short strokes + fine stipple
          float s1 = envNoise(vec2(p.x * 1.3 + p.y * 0.55, p.y * 3.6 - p.x * 1.1));
          float s2 = envNoise(vec2(p.x * 3.1 - p.y * 1.2, p.y * 1.4 + p.x * 0.6) + 5.0);
          float st = envNoise(p * 6.0 + 9.0);
          float broad = envNoise(p * 0.35 + 3.0);
          float grassMod = ((s1 - 0.5) * 0.13 + (s2 - 0.5) * 0.09 + (st - 0.5) * 0.06) * nearK
                         + (broad - 0.5) * 0.14 * midK;
          // paths: soft ruts + light pebbles
          float rut = envNoise(p * 1.7 + 2.0);
          float peb = smoothstep(0.8, 0.86, envNoise(p * 9.0 + 11.0)) * nearK;
          float pathMod = (rut - 0.5) * 0.12 * midK - (st - 0.5) * 0.05 * nearK;
          diffuseColor.rgb *= 1.0 + mix(grassMod, pathMod, dirt);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.1, 1.06), peb * dirt * 0.8);` : ''}
        }`
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          // slow drifting cloud shadows (daytime only)
          vec2 cp = vTWorld.xz * 0.014 + vec2(uTime * 0.010, uTime * 0.004);
          float cs = smoothstep(0.52, 0.66, envFbm(cp));
          outgoingLight *= 1.0 - cs * 0.1 * (1.0 - uNight) * uCloudShadow;
        }
        #include <opaque_fragment>`
      );
  };
  mat.customProgramCacheKey = () => `terrain-${detail ? 1 : 0}`;
  return mat;
}

export default async function build(ctx) {
  const geo = buildGeometry();
  const mesh = new THREE.Mesh(geo, createTerrainMaterial(ctx.quality));
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  ctx.scene.add(mesh);
  ctx.terrainMesh = mesh;
  return {};
}
