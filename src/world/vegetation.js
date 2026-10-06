// ─────────────────────────────────────────────────────────────────────────────
// Vegetation — the woodland itself. Trees (puffy broadleaves, soft firs, white
// birches, autumn accents, blossom & apple trees, giant ancient trees with a
// tiny door), shrubs, rocks, logs, stumps, toadstools, glowing mushrooms,
// ferns, grass, wildflowers, clover, reeds and pebbles.
//
// Everything is stamped into static per-chunk batches (vegetation/batcher.js):
// one draw call per (layer, chunk) whatever the species mix, culled per chunk.
//   layers: trees  (casts shadows, camera-occlusion fade, inner quadrants + 6 rim sectors)
//           far    (beyond the walkable edge: no shadows, 6 sectors)
//           ground (grass, flowers, ferns … double-sided, no shadows)
// plus two tiny glow meshes (mushroom caps, giant-tree windows). Wind sways
// everything on the GPU (vegetation/foliageMaterial.js). Placement is seeded →
// identical on every visit, and keeps paths, clearings, the pond and the snail
// stations clear (ground cover may creep ≤ 1.3 units into clearing rims).
// Colliders: every trunk, big rock, log, stump and large bush inside the
// walkable radius (tags 'tree', 'rock', 'log', 'stump', 'bush').
//
// Public result (ctx.modules.vegetation):
//   group                      THREE.Group 'vegetation' (all meshes)
//   trees                      [{ x, y, z, kind, autumn, crownY, crownR, trunkR, leaf: THREE.Color }]
//                              near trees only (r < 82); kind: puff | pine | birch | blossom | apple | giant
//   flowerPatches              [{ x, y, z, color: THREE.Color }]  (butterfly magnets)
//   glowSpots                  [{ x, y, z }]  (glowing mushroom clusters, for night halos)
//   treesNear(x, z, r, out[])  → fills `out` with trees within r (no allocation if out is reused)
//   setFade(on)                camera-occlusion dither on/off (on by default)
//   stats                      { drawables, triangles, vertices, instances, colliders, trees, breakdown, timings }
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight, getNormal, pathPolylines } from './ground.js';
import { WORLD_RADIUS, TERRAIN_HALF_SIZE, AREAS, DISTRICTS, POND } from './layout.js';
import { materials } from '../core/materials.js';
import { palette } from '../core/palette.js';
import { createNoise2D, fbm } from '../core/noise.js';
import { smoothstep } from '../core/rng.js';
import * as T from './vegetation/templates.js';
import { createBatcher } from './vegetation/batcher.js';
import { createFoliageMaterials, vegUniforms } from './vegetation/foliageMaterial.js';

const TAU = Math.PI * 2;
const C = (hex) => new THREE.Color(hex);

// Chunking: an inner disc split into quadrants, the rim and the hills into 6
// sectors each. Each (layer, chunk) is one culled draw call. Trees beyond the
// walkable edge go to the non-shadow-casting 'far' layer (6 sectors).
const INNER_R = 34;
const RIM_R = 86;
const HERO_R = WORLD_RADIUS + 4;
const sector = (x, z, n) => Math.floor((Math.atan2(z, x) + Math.PI) / (TAU / n)) % n;
function chunkOf(x, z) {
  const r = Math.hypot(x, z);
  if (r < INNER_R) return 'in' + sector(x, z, 4);
  if (r < RIM_R) return 'rim' + sector(x, z, 6);
  return 'far' + sector(x, z, 6);
}
const farChunk = (x, z) => 'f' + sector(x, z, 6);

// ─── Clearance helpers ───────────────────────────────────────────────────────

/**
 * Distance from the nearest dirt path EDGE (raw world units), baked on a
 * 1-unit grid. Each segment only touches the cells within REACH of it.
 */
function createPathEdgeField() {
  const H = 82, CELL = 1, N = Math.ceil((H * 2) / CELL) + 1, REACH = 14;
  const grid = new Float32Array(N * N).fill(99);
  for (const p of pathPolylines) {
    const hw = p.halfWidth;
    for (let k = 0; k < p.pts.length - 1; k++) {
      const ax = p.pts[k].x, az = p.pts[k].z, bx = p.pts[k + 1].x, bz = p.pts[k + 1].z;
      const abx = bx - ax, abz = bz - az, len2 = abx * abx + abz * abz || 1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - REACH + H) / CELL));
      const i1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + REACH + H) / CELL));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - REACH + H) / CELL));
      const j1 = Math.min(N - 1, Math.ceil((Math.max(az, bz) + REACH + H) / CELL));
      for (let j = j0; j <= j1; j++) {
        const z = -H + j * CELL;
        for (let i = i0; i <= i1; i++) {
          const x = -H + i * CELL;
          let t = ((x - ax) * abx + (z - az) * abz) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = x - ax - abx * t, dz = z - az - abz * t;
          const d = Math.sqrt(dx * dx + dz * dz) - hw;
          if (d < grid[j * N + i]) grid[j * N + i] = d;
        }
      }
    }
  }
  return (x, z) => {
    if (x <= -H || x >= H || z <= -H || z >= H) return 99;
    const fx = (x + H) / CELL, fz = (z + H) / CELL;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = grid[j * N + i], b = grid[j * N + i + 1], c = grid[(j + 1) * N + i], d = grid[(j + 1) * N + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
}

/** Signed distance to the nearest clearing rim (negative inside a clearing). */
function areaEdge(x, z) {
  let best = 99;
  for (const a of AREAS) {
    const d = Math.hypot(x - a.center.x, z - a.center.z) - a.radius;
    if (d < best) best = d;
  }
  return best;
}
const pondDist = (x, z) => Math.hypot(x - POND.center.x, z - POND.center.z);

/**
 * Tree-free glades: a meadow south of the pond so the view across the water
 * (where the follow camera hangs out) stays open.
 */
const GLADES = [{ x: POND.center.x + 3, z: POND.center.z + POND.radius + 8, r: 7.5 }];
const inGlade = (x, z, pad = 0) => GLADES.some((g) => Math.hypot(x - g.x, z - g.z) < g.r + pad);

/** Spatial hash for minimum spacing between placed things. */
function createSpacing(cell = 4) {
  const map = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  return {
    ok(x, z, r, factor = 1) {
      const i0 = Math.floor(x / cell), j0 = Math.floor(z / cell);
      const reach = Math.ceil((r * 2 + 8) / cell);
      for (let i = i0 - reach; i <= i0 + reach; i++) {
        for (let j = j0 - reach; j <= j0 + reach; j++) {
          const list = map.get(key(i, j));
          if (!list) continue;
          for (const e of list) {
            const min = (r + e.r) * factor;
            const dx = x - e.x, dz = z - e.z;
            if (dx * dx + dz * dz < min * min) return false;
          }
        }
      }
      return true;
    },
    add(x, z, r) {
      const k = key(Math.floor(x / cell), Math.floor(z / cell));
      let list = map.get(k);
      if (!list) map.set(k, (list = []));
      list.push({ x, z, r });
    },
  };
}

// ─── Colour helpers ──────────────────────────────────────────────────────────

function jitterColor(rng, hex, h = 0.02, s = 0.06, l = 0.05) {
  return C(hex).offsetHSL(rng.jitter(h), rng.jitter(s), rng.jitter(l));
}

export default async function build(ctx) {
  const { scene, quality, colliders } = ctx;
  const rng = ctx.rng('vegetation-v1');
  const density = quality?.density ?? 1;
  /** low tier: hero trees use the mid-detail templates */
  const lite = density < 0.5;
  const reduced = !!ctx.engine?.reducedMotion;
  vegUniforms.uMotion.value = reduced ? 0.35 : 1;

  const t0 = performance.now();
  const marks = [];
  const mark = (label) => marks.push(`${label}:${Math.round(performance.now() - t0)}`);
  const pathEdge = createPathEdgeField();
  mark('field');
  const nGrove = createNoise2D(5151);
  const nSpecies = createNoise2D(6262);
  const nMeadow = createNoise2D(7373);
  const nTint = createNoise2D(8484);

  // ─── Template library ──────────────────────────────────────────────────────
  const tr = rng.fork('templates');
  const blossomTint = C(palette.capCoral).lerp(C(palette.capLavender), 0.32).lerp(C(palette.spots), 0.42);
  const lib = {
    puff: [
      T.puffTree(tr, { shape: 'round' }), T.puffTree(tr, { shape: 'round' }), T.puffTree(tr, { shape: 'round' }),
      T.puffTree(tr, { shape: 'tall' }), T.puffTree(tr, { shape: 'tall' }),
      T.puffTree(tr, { shape: 'wide' }), T.puffTree(tr, { shape: 'wide' }),
    ],
    puffMid: [T.puffTree(tr, { lod: 1 }), T.puffTree(tr, { lod: 1, shape: 'tall' }), T.puffTree(tr, { lod: 1, shape: 'wide' })],
    puffFar: [T.puffTree(tr, { lod: 2 }), T.puffTree(tr, { lod: 2, shape: 'tall' }), T.puffTree(tr, { lod: 2, shape: 'wide' })],
    blossom: [
      T.puffTree(tr, { shape: 'round', fruit: palette.spots, fruitCount: 26 }),
      T.puffTree(tr, { shape: 'wide', fruit: C(palette.spots).lerp(C(palette.capCoral), 0.2), fruitCount: 26 }),
    ],
    apple: [T.puffTree(tr, { shape: 'round', fruit: palette.capRed, fruitCount: 14 })],
    pine: [T.pineTree(tr), T.pineTree(tr), T.pineTree(tr)],
    pineMid: [T.pineTree(tr, { lod: 1 }), T.pineTree(tr, { lod: 1 })],
    pineFar: [T.pineTree(tr, { lod: 2 }), T.pineTree(tr, { lod: 2 })],
    birch: [T.birchTree(tr), T.birchTree(tr), T.birchTree(tr, { twin: true })],
    birchMid: [T.birchTree(tr, { lod: 1 }), T.birchTree(tr, { lod: 1 })],
    giant: [T.giantTree(tr), T.giantTree(tr), T.giantTree(tr)],
    bush: [T.bush(tr), T.bush(tr), T.bush(tr), T.bush(tr)],
    berryBush: [T.bush(tr, { berries: palette.capRed, count: 12 }), T.bush(tr, { berries: palette.clothes[6], count: 12 }), T.bush(tr, { berries: palette.spots, count: 14 })],
    rock: [T.rock(tr), T.rock(tr), T.rock(tr), T.rock(tr, { mossy: 1 })],
    rockFar: [T.rock(tr, { detail: 0 }), T.rock(tr, { detail: 0, mossy: 1 })],
    log: [T.log(tr), T.log(tr), T.log(tr)],
    stump: [T.stump(tr), T.stump(tr)],
    toad: [T.toadstools(tr), T.toadstools(tr), T.toadstools(tr), T.toadstools(tr)],
    glow: [T.glowShrooms(tr), T.glowShrooms(tr), T.glowShrooms(tr)],
    fern: [T.fern(tr), T.fern(tr), T.fern(tr)],
    grass: [T.grassTuft(tr), T.grassTuft(tr, { blades: 8 }), T.grassTuft(tr, { blades: 11, height: 0.36 }), T.grassTuft(tr, { blades: 9, height: 0.55 }), T.grassTuft(tr, { blades: 12, height: 0.32, spread: 0.2 })],
    daisies: [T.daisies(tr), T.daisies(tr), T.daisies(tr)],
    poppies: [T.poppies(tr), T.poppies(tr)],
    lavender: [T.lavender(tr), T.lavender(tr)],
    buttercups: [T.buttercups(tr), T.buttercups(tr)],
    bluebells: [T.bluebells(tr), T.bluebells(tr)],
    dandelions: [T.dandelions(tr), T.dandelions(tr)],
    clover: [T.clover(tr), T.clover(tr), T.clover(tr)],
    lushGrass: [T.grassTuft(tr, { blades: 16, height: 0.5, spread: 0.32 }), T.grassTuft(tr, { blades: 14, height: 0.42, spread: 0.28 })],
    reeds: [T.reeds(tr), T.reeds(tr), T.reeds(tr)],
    leaves: [T.fallenLeaves(tr), T.fallenLeaves(tr, { count: 6, spread: 0.8 })],
    pebbles: [T.pebbles(tr), T.pebbles(tr), T.pebbles(tr), T.pebbles(tr)],
  };

  mark('templates');
  const batch = createBatcher();
  const spacing = createSpacing(4);
  const trees = [];
  const flowerPatches = [];
  const glowSpots = [];
  const glowCaps = [];
  const windows = [];
  let colliderCount = 0;
  const collide = (x, z, r, tag = 'vegetation') => {
    if (Math.hypot(x, z) - r < WORLD_RADIUS + 0.5) {
      colliders.addCircle(x, z, r, tag);
      colliderCount++;
    }
  };

  const LEAF_GREENS = [palette.leaf, palette.leafLight, palette.leafLight, palette.leafDark, C(palette.leaf).lerp(C(palette.grassLight), 0.5)];
  const AUTUMN = [palette.autumnOrange, palette.autumnRed, palette.autumnYellow, palette.autumnOrange];
  const PINES = [C(palette.pine).lerp(C(palette.leafDark), 0.45), C(palette.pine).lerp(C(palette.leaf), 0.35), palette.pine, C(palette.pine).lerp(C(palette.moss), 0.3)];
  const BIRCH_LEAF = [palette.leafLight, C(palette.leafLight).lerp(C(palette.autumnYellow), 0.3), C(palette.leafLight).lerp(C(palette.grassLight), 0.5)];

  // ─── Trees ─────────────────────────────────────────────────────────────────
  /**
   * Place one tree. kind: 'puff' | 'pine' | 'birch' | 'blossom' | 'apple' | 'giant'.
   * lod: 0 hero, 1 mid, 2 far.
   */
  function placeTree(r, kind, x, z, { lod = 0, scale = 1, autumn = false, record = true } = {}) {
    if (kind !== 'giant' && inGlade(x, z, 1.5 * scale)) return null;
    const y = getHeight(x, z) - 0.08;
    if (lite && lod === 0 && (kind === 'puff' || kind === 'pine' || kind === 'birch')) lod = 1;
    let tpl, tint;
    if (kind === 'pine') {
      tpl = r.pick(lod === 2 ? lib.pineFar : lod === 1 ? lib.pineMid : lib.pine);
      tint = jitterColor(r, r.pick(PINES), 0.015, 0.05, 0.035);
    } else if (kind === 'birch') {
      tpl = r.pick(lod === 2 ? lib.puffFar : lod === 1 ? lib.birchMid : lib.birch);
      tint = jitterColor(r, autumn ? palette.autumnYellow : r.pick(BIRCH_LEAF), 0.02, 0.05, 0.04);
    } else if (kind === 'blossom') {
      tpl = r.pick(lib.blossom);
      tint = jitterColor(r, blossomTint, 0.015, 0.05, 0.03);
    } else if (kind === 'apple') {
      tpl = r.pick(lib.apple);
      tint = jitterColor(r, palette.leafLight, 0.02, 0.05, 0.03);
    } else if (kind === 'giant') {
      tpl = r.pick(lib.giant);
      tint = jitterColor(r, palette.leaf, 0.01, 0.04, 0.02).lerp(C(palette.leafLight), 0.3);
    } else {
      tpl = r.pick(lod === 2 ? lib.puffFar : lod === 1 ? lib.puffMid : lib.puff);
      tint = jitterColor(r, autumn ? r.pick(AUTUMN) : r.pick(LEAF_GREENS), 0.02, 0.06, 0.04);
    }
    const giant = kind === 'giant';
    // giants face the village (door towards the centre) and stay exactly upright
    const rotY = giant ? Math.atan2(-x, -z) : r.range(0, TAU);
    const far = (lod > 0 && !giant && !lite) || lod === 2 || (lite && Math.hypot(x, z) > HERO_R);
    batch.add(far ? 'far' : 'trees', far ? farChunk(x, z) : chunkOf(x, z), tpl, x, y, z, {
      rotY, scale, sy: giant ? scale : scale * r.range(0.92, 1.1), tiltX: giant ? 0 : r.jitter(0.04), tiltZ: giant ? 0 : r.jitter(0.04),
      tint, bright: r.range(0.92, 1.05), phase: r.next(),
    });
    const trunkR = tpl.trunkRadius * scale;
    collide(x, z, trunkR + 0.1, 'tree');
    if (kind === 'giant') {
      // the window glows at night
      const w = tpl.window;
      const s = Math.sin(rotY), c = Math.cos(rotY);
      windows.push({ x: x + w.z * s * scale, y: y + w.y * scale, z: z + w.z * c * scale, r: w.r * scale, rotY });
    }
    if (record && Math.hypot(x, z) < 82) {
      trees.push({
        x, y, z, kind, autumn,
        crownY: y + (tpl.crownY ?? 5) * scale,
        crownR: (tpl.crownR ?? 2) * scale,
        trunkR,
        leaf: kind === 'blossom' ? C(palette.spots).lerp(blossomTint, 0.6) : tint.clone(),
      });
    }
    return tpl;
  }

  // 1. Giant ancient trees in the gaps between districts, at the forest edge.
  {
    const r = rng.fork('giants');
    const angles = [...DISTRICTS.map((d) => Math.atan2(d.center.z, d.center.x)), Math.atan2(POND.center.z, POND.center.x)].sort((a, b) => a - b);
    const gaps = [];
    for (let i = 0; i < angles.length; i++) {
      const a0 = angles[i], a1 = i + 1 < angles.length ? angles[i + 1] : angles[0] + TAU;
      gaps.push({ a: (a0 + a1) / 2, size: a1 - a0 });
    }
    gaps.sort((a, b) => b.size - a.size);
    for (const g of gaps.slice(0, 5)) {
      const a = g.a + r.jitter(0.06);
      const rad = WORLD_RADIUS - r.range(5.5, 7);
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      placeTree(r, 'giant', x, z, { scale: r.range(0.95, 1.12) });
      spacing.add(x, z, 7.5);
    }
  }

  // 2. Village trees between the districts: copses and singles.
  {
    const r = rng.fork('village');
    const home = DISTRICTS.find((d) => d.id === 'home');
    for (let i = 0; i < 2600; i++) {
      const a = r.range(0, TAU), rad = Math.sqrt(r.range(15 * 15, (WORLD_RADIUS - 6) ** 2));
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const grove = fbm(nGrove, x * 0.045, z * 0.045, 3);
      const p = grove > 0.12 ? 0.6 : grove > -0.1 ? 0.07 : 0.015;
      if (!r.chance(p)) continue;
      if (pathEdge(x, z) < 3.0 || areaEdge(x, z) < 3.2 || pondDist(x, z) < POND.radius + 3.5) continue;
      const scale = r.range(0.85, 1.2);
      if (!spacing.ok(x, z, 2.4 * scale, 1)) continue;
      const sp = nSpecies(x * 0.03, z * 0.03);
      const nearPlaza = Math.hypot(x, z) < 30;
      const nearHome = Math.hypot(x - home.center.x, z - home.center.z) < home.radius + 12;
      let kind = 'puff';
      if (nearHome && r.chance(0.35)) kind = r.chance(0.5) ? 'apple' : 'blossom';
      else if (nearPlaza && r.chance(0.25)) kind = 'blossom';
      else if (sp > 0.35) kind = 'birch';
      else if (sp < -0.45) kind = 'pine';
      else if (r.chance(0.08)) kind = 'birch';
      const autumn = kind === 'puff' && nTint(x * 0.05, z * 0.05) > 0.45;
      if (placeTree(r, kind, x, z, { scale, autumn })) spacing.add(x, z, 2.4 * scale);
    }
  }

  // 3. The dense forest ring: hero trees at the walkable edge, mid detail behind.
  {
    const r = rng.fork('rim');
    const r0 = WORLD_RADIUS - 8, r1 = RIM_R + 2;
    for (let i = 0; i < 9000; i++) {
      const a = r.range(0, TAU), rad = Math.sqrt(r.range(r0 * r0, r1 * r1));
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const edge = smoothstep(WORLD_RADIUS - 8, WORLD_RADIUS - 1, rad);
      const holes = fbm(nGrove, x * 0.06 + 7, z * 0.06, 2);
      if (!r.chance(edge * (holes > 0.35 && rad < WORLD_RADIUS ? 0.3 : 1))) continue;
      if (pathEdge(x, z) < 2.5 || areaEdge(x, z) < 3.5 || pondDist(x, z) < POND.radius + 4) continue;
      const lod = rad < HERO_R ? 0 : rad < HERO_R + 8 ? 1 : 2;
      const scale = r.range(0.9, 1.3) * (1 + (rad - WORLD_RADIUS) * 0.008);
      if (!spacing.ok(x, z, 1.75 * scale, 1)) continue;
      const sp = nSpecies(x * 0.025, z * 0.025) + (rad - WORLD_RADIUS) * 0.012;
      let kind = sp > 0.28 ? 'pine' : sp < -0.42 ? 'birch' : 'puff';
      if (kind === 'puff' && r.chance(0.1)) kind = 'pine';
      const autumn = (kind === 'puff' || kind === 'birch') && nTint(x * 0.04, z * 0.04) > 0.38 && r.chance(0.75);
      if (placeTree(r, kind, x, z, { lod, scale, autumn })) spacing.add(x, z, 1.75 * scale);
    }
  }

  // 4. The far hills: big, simple trees so the valley feels enclosed.
  {
    const r = rng.fork('far');
    const r0 = RIM_R, r1 = 152;
    const attempts = Math.round(9000 * (0.4 + 0.6 * density));
    const lim = TERRAIN_HALF_SIZE - 4;
    for (let i = 0; i < attempts; i++) {
      const a = r.range(0, TAU), rad = Math.sqrt(r.range(r0 * r0, r1 * r1));
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
      // big enough to read as forest from the valley, low enough for the Alps to peek over
      const scale = r.range(1.1, 1.5) * (1 + (rad - RIM_R) * 0.0015);
      if (!spacing.ok(x, z, 2.0 * scale, 1)) continue;
      const sp = nSpecies(x * 0.02, z * 0.02) + (rad - RIM_R) * 0.01;
      const kind = sp > 0.1 || r.chance(0.2) ? 'pine' : 'puff';
      const autumn = kind === 'puff' && nTint(x * 0.03, z * 0.03) > 0.4;
      if (placeTree(r, kind, x, z, { lod: 2, scale, autumn, record: false })) spacing.add(x, z, 2.0 * scale);
    }
  }

  mark('trees');
  // ─── Shrubs, rocks, deadwood ───────────────────────────────────────────────
  const BUSH_GREENS = [palette.leaf, palette.leafDark, palette.moss, palette.leafLight];
  function placeBush(r, x, z, scale) {
    const berries = r.chance(0.28);
    const tpl = r.pick(berries ? lib.berryBush : lib.bush);
    batch.add('trees', chunkOf(x, z), tpl, x, getHeight(x, z) - 0.05, z, {
      rotY: r.range(0, TAU), scale, sy: scale * r.range(0.85, 1.1),
      tint: jitterColor(r, r.pick(BUSH_GREENS), 0.02, 0.06, 0.04), bright: r.range(0.92, 1.05), phase: r.next(),
    });
    if (scale * tpl.radius > 0.75) collide(x, z, tpl.radius * scale * 0.6, 'bush');
  }
  {
    const r = rng.fork('bushes');
    // a) forest-edge belt
    for (let i = 0; i < 1500; i++) {
      const a = r.range(0, TAU), rad = r.range(WORLD_RADIUS - 10, WORLD_RADIUS + 2);
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (!r.chance(0.45 * (0.5 + 0.5 * density))) continue;
      if (pathEdge(x, z) < 1.2 || areaEdge(x, z) < 2 || pondDist(x, z) < POND.radius + 2) continue;
      const scale = r.range(0.8, 1.4);
      if (!spacing.ok(x, z, 0.9 * scale, 0.9)) continue;
      placeBush(r, x, z, scale);
      spacing.add(x, z, 0.9 * scale);
    }
    // b) framing the clearings and the paths
    for (let i = 0; i < 2200; i++) {
      const a = r.range(0, TAU), rad = Math.sqrt(r.range(13 * 13, (WORLD_RADIUS - 8) ** 2));
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const pe = pathEdge(x, z), ae = areaEdge(x, z);
      const nearEdge = (ae > 1.6 && ae < 4.5) || (pe > 1.2 && pe < 3);
      if (!nearEdge || !r.chance(0.18 * (0.5 + 0.5 * density))) continue;
      if (pe < 1.2 || ae < 1.6 || pondDist(x, z) < POND.radius + 1.5) continue;
      const scale = r.range(0.7, 1.15);
      if (!spacing.ok(x, z, 0.9 * scale, 1)) continue;
      placeBush(r, x, z, scale);
      spacing.add(x, z, 0.9 * scale);
    }
  }
  {
    const r = rng.fork('rocks');
    const rockTint = null;
    const placeRock = (x, z, scale, far = false) => {
      const tpl = r.pick(far ? lib.rockFar : lib.rock);
      const y = getHeight(x, z) - 0.12 * scale;
      batch.add(far ? 'far' : 'trees', far ? farChunk(x, z) : chunkOf(x, z), tpl, x, y, z, {
        rotY: r.range(0, TAU), scale, normal: getNormal(x, z, new THREE.Vector3()), align: 0.6, tint: rockTint, bright: r.range(0.92, 1.06),
      });
      if (scale > 0.45) collide(x, z, tpl.radius * scale * 0.75, 'rock');
    };
    // clusters inside the valley
    for (let i = 0; i < 900; i++) {
      const a = r.range(0, TAU), rad = Math.sqrt(r.range(15 * 15, (WORLD_RADIUS + 4) ** 2));
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (!r.chance(0.07)) continue;
      if (pathEdge(x, z) < 1.4 || areaEdge(x, z) < 2.2 || pondDist(x, z) < POND.radius + 1) continue;
      const scale = r.range(0.45, 1.05);
      if (!spacing.ok(x, z, scale * 1.1, 1)) continue;
      placeRock(x, z, scale);
      spacing.add(x, z, scale * 1.1);
      const n = r.int(0, 3);
      for (let k = 0; k < n; k++) {
        const aa = r.range(0, TAU), d = scale * r.range(1.1, 1.8);
        const sx = x + Math.cos(aa) * d, sz = z + Math.sin(aa) * d;
        if (pathEdge(sx, sz) < 1 || areaEdge(sx, sz) < 1.5) continue;
        placeRock(sx, sz, scale * r.range(0.3, 0.5));
      }
    }
    // pond-side stones
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + r.jitter(0.25);
      const d = POND.radius * r.range(1.02, 1.18);
      const x = POND.center.x + Math.cos(a) * d, z = POND.center.z + Math.sin(a) * d;
      if (pathEdge(x, z) < 1.2) continue;
      placeRock(x, z, r.range(0.35, 0.7));
    }
    // outcrops on the hills
    for (let i = 0; i < 1400; i++) {
      const a = r.range(0, TAU), rad = r.range(RIM_R - 8, 140);
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (!r.chance(0.08)) continue;
      const scale = r.range(1.2, 2.8);
      if (!spacing.ok(x, z, scale, 0.8)) continue;
      placeRock(x, z, scale, rad > HERO_R + 4);
      spacing.add(x, z, scale);
    }
  }
  {
    const r = rng.fork('deadwood');
    let logs = 0;
    for (let i = 0; i < 4000 && logs < 22; i++) {
      const a = r.range(0, TAU), rad = Math.sqrt(r.range(18 * 18, (WORLD_RADIUS + 10) ** 2));
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const grove = fbm(nGrove, x * 0.045, z * 0.045, 3);
      if (grove < 0 && rad < WORLD_RADIUS - 8) continue;
      if (pathEdge(x, z) < 3 || areaEdge(x, z) < 3.5 || pondDist(x, z) < POND.radius + 3) continue;
      if (!spacing.ok(x, z, 1.9, 1)) continue;
      const tpl = r.pick(lib.log);
      const rotY = r.range(0, TAU);
      const nrm = getNormal(x, z, new THREE.Vector3());
      batch.add('trees', chunkOf(x, z), tpl, x, getHeight(x, z) - 0.1, z, { rotY, scale: r.range(0.85, 1.1), normal: nrm, align: 0.8, bright: r.range(0.92, 1.04) });
      spacing.add(x, z, 1.9);
      // colliders along the log
      const cx = Math.cos(-rotY), sz = Math.sin(-rotY);
      for (const t of [-0.32, 0, 0.32]) collide(x + cx * tpl.length * t, z + sz * tpl.length * t, tpl.radius + 0.12, 'log');
      logs++;
    }
    // stumps: a few in the woods, and some near the Schreinerei (freshly cut timber!)
    const ww = DISTRICTS.find((d) => d.id === 'woodworking');
    let stumps = 0;
    for (let i = 0; i < 3000 && stumps < 18; i++) {
      const nearShop = i % 3 === 0;
      let x, z;
      if (nearShop) {
        const a = r.range(0, TAU), d = ww.radius + r.range(2.5, 7);
        x = ww.center.x + Math.cos(a) * d;
        z = ww.center.z + Math.sin(a) * d;
      } else {
        const a = r.range(0, TAU), rad = Math.sqrt(r.range(18 * 18, (WORLD_RADIUS + 3) ** 2));
        x = Math.cos(a) * rad;
        z = Math.sin(a) * rad;
        if (!r.chance(0.25)) continue;
      }
      if (pathEdge(x, z) < 2 || areaEdge(x, z) < 2.2 || pondDist(x, z) < POND.radius + 2) continue;
      if (!spacing.ok(x, z, 0.8, 1)) continue;
      const tpl = r.pick(lib.stump);
      const scale = r.range(0.8, 1.25);
      batch.add('trees', chunkOf(x, z), tpl, x, getHeight(x, z) - 0.05, z, { rotY: r.range(0, TAU), scale, bright: r.range(0.92, 1.05) });
      spacing.add(x, z, 0.8);
      collide(x, z, tpl.radius * scale * 0.8, 'stump');
      stumps++;
    }
  }

  // ─── Mushrooms ─────────────────────────────────────────────────────────────
  const CAPS = [palette.capRed, palette.capRed, palette.capRed, palette.capBrown, palette.capOchre, palette.capCoral];
  {
    const r = rng.fork('toadstools');
    const nearTrees = trees.filter((t) => Math.hypot(t.x, t.z) < WORLD_RADIUS + 6);
    const count = Math.round(120 * (0.5 + 0.5 * density));
    let placed = 0;
    for (let i = 0; i < count * 6 && placed < count; i++) {
      let x, z;
      if (i % 2 === 0 && nearTrees.length) {
        const t = r.pick(nearTrees);
        const a = r.range(0, TAU), d = t.trunkR + r.range(0.5, 2.2);
        x = t.x + Math.cos(a) * d;
        z = t.z + Math.sin(a) * d;
      } else {
        const a = r.range(0, TAU), rad = Math.sqrt(r.range(14 * 14, (WORLD_RADIUS + 4) ** 2));
        x = Math.cos(a) * rad;
        z = Math.sin(a) * rad;
        if (fbm(nGrove, x * 0.045, z * 0.045, 3) < 0.05 && rad < WORLD_RADIUS - 6) continue;
      }
      if (pathEdge(x, z) < 0.6 || areaEdge(x, z) < 0.8 || pondDist(x, z) < POND.radius + 0.5) continue;
      if (!r.chance(0.5)) continue;
      batch.add('ground', chunkOf(x, z), r.pick(lib.toad), x, getHeight(x, z) - 0.02, z, {
        rotY: r.range(0, TAU), scale: r.range(0.9, 1.6), tint: jitterColor(r, r.pick(CAPS), 0.01, 0.05, 0.03), phase: r.next(),
      });
      placed++;
    }
  }
  {
    // glowing mushrooms: forest edge, giant roots, the pond's quiet side
    const r = rng.fork('glow');
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let placed = 0;
    const target = Math.round(20 * (0.6 + 0.4 * density));
    for (let i = 0; i < 3000 && placed < target; i++) {
      let x, z;
      const mode = i % 7 === 1 ? 1 : i % 2 ? 0 : 2;
      if (mode === 0) {
        const a = r.range(0, TAU), rad = r.range(WORLD_RADIUS - 9, WORLD_RADIUS + 1);
        x = Math.cos(a) * rad;
        z = Math.sin(a) * rad;
      } else if (mode === 1) {
        // the pond's east & west banks (the dock is north, the view south)
        const a = (r.chance(0.5) ? 0 : Math.PI) + r.jitter(0.6), d = POND.radius * r.range(1.15, 1.6);
        x = POND.center.x + Math.cos(a) * d;
        z = POND.center.z + Math.sin(a) * d;
      } else {
        const t = trees.filter((tt) => tt.kind === 'giant');
        if (!t.length) continue;
        const g = r.pick(t), a = r.range(0, TAU), d = r.range(2.6, 4.2);
        x = g.x + Math.cos(a) * d;
        z = g.z + Math.sin(a) * d;
      }
      if (pathEdge(x, z) < 1 || areaEdge(x, z) < 1.5 || pondDist(x, z) < POND.radius + 0.6) continue;
      if (!spacing.ok(x, z, 0.5, 1)) continue;
      const g = r.pick(lib.glow);
      const y = getHeight(x, z) - 0.02;
      const rotY = r.range(0, TAU), sc = r.range(1.0, 1.5);
      batch.add('ground', chunkOf(x, z), g.template, x, y, z, { rotY, scale: sc });
      m.compose(p.set(x, y, z), q.setFromAxisAngle(up, rotY), s.setScalar(sc));
      for (const cap of g.caps) glowCaps.push(cap.clone().applyMatrix4(m));
      glowSpots.push({ x, y: y + 0.35 * sc, z });
      spacing.add(x, z, 0.5);
      placed++;
    }
  }

  // ─── Ground cover ──────────────────────────────────────────────────────────
  /** 0..1 how welcome low plants are here (paths, clearings, water, deep forest). */
  function groundOk(x, z, { pathPad = 0.25, rimCreep = 1.2 } = {}) {
    const pe = pathEdge(x, z);
    if (pe < pathPad) return 0;
    const ae = areaEdge(x, z);
    if (ae < -rimCreep) return 0;
    const y = getHeight(x, z);
    if (y < POND.waterLevel + 0.08) return 0;
    let k = smoothstep(pathPad, pathPad + 1.4, pe);
    if (ae < 0.6) k *= 0.3 * smoothstep(-rimCreep, 0.6, ae);
    return k;
  }

  {
    // ferns: forest floor and the shade of village trees
    const r = rng.fork('ferns');
    const n = Math.round(800 * density);
    for (let i = 0; i < n; i++) {
      let x, z;
      if (i % 3 === 0 && trees.length) {
        const t = r.pick(trees);
        const a = r.range(0, TAU), d = t.trunkR + r.range(0.5, 2.5);
        x = t.x + Math.cos(a) * d;
        z = t.z + Math.sin(a) * d;
      } else {
        const a = r.range(0, TAU), rad = r.range(WORLD_RADIUS - 12, WORLD_RADIUS + 8);
        x = Math.cos(a) * rad;
        z = Math.sin(a) * rad;
      }
      if (groundOk(x, z, { pathPad: 0.8, rimCreep: -1 }) < 0.5 || !r.chance(0.55)) continue;
      batch.add('ground', chunkOf(x, z), r.pick(lib.fern), x, getHeight(x, z) - 0.03, z, {
        rotY: r.range(0, TAU), scale: r.range(0.8, 1.35), tint: jitterColor(r, r.pick([palette.leaf, palette.leafDark, palette.moss]), 0.02, 0.05, 0.04), phase: r.next(),
      });
    }
  }

  {
    // grass tufts: a jittered grid, clumped into meadows, thinning towards paths
    const r = rng.fork('grass');
    const cell = 0.95 / Math.sqrt(Math.max(0.2, density));
    const GR = WORLD_RADIUS + 12;
    const gA = C(palette.grass), gB = C(palette.grassLight), gC = C(palette.grassDark), gD = C(palette.autumnYellow);
    const tint = new THREE.Color();
    for (let gx = -GR; gx < GR; gx += cell) {
      for (let gz = -GR; gz < GR; gz += cell) {
        const x = gx + r.range(0, cell), z = gz + r.range(0, cell);
        const rad = Math.hypot(x, z);
        if (rad > GR) continue;
        let p = groundOk(x, z, { pathPad: 0.15, rimCreep: 1.3 });
        if (p <= 0) continue;
        const meadow = fbm(nMeadow, x * 0.06, z * 0.06, 2);
        p *= 0.3 + 0.7 * smoothstep(-0.45, 0.35, meadow);
        p *= 1 - 0.65 * smoothstep(WORLD_RADIUS - 2, GR, rad);
        // the village core (where the camera lives) is a touch lusher
        p = Math.min(1, p * (1.25 - 0.25 * smoothstep(30, 50, rad)));
        if (!r.chance(p)) continue;
        const tn = nTint(x * 0.04, z * 0.04);
        tint.copy(gA).lerp(gB, 0.35 + 0.45 * tn);
        if (tn < -0.35) tint.lerp(gC, (-0.35 - tn) * 0.8);
        if (meadow > 0.3) tint.lerp(gD, (meadow - 0.3) * 0.3);
        tint.offsetHSL(r.jitter(0.012), r.jitter(0.04), r.jitter(0.035));
        const scale = r.range(0.75, 1.3) * (0.6 + 0.4 * p);
        const lush = meadow > 0.15 && r.chance(0.3);
        batch.add('ground', chunkOf(x, z), r.pick(lush ? lib.lushGrass : lib.grass), x, getHeight(x, z) - 0.02, z, {
          rotY: r.range(0, TAU), scale, sy: scale * r.range(0.85, 1.25), tint, phase: r.next(),
        });
      }
    }
  }

  {
    // wildflowers: patches of one species, plus a sprinkle of singles
    const r = rng.fork('flowers');
    const species = [
      { k: 'daisies', w: 3, c: palette.spots },
      { k: 'buttercups', w: 2, c: palette.postYellow },
      { k: 'poppies', w: 1.6, c: palette.swissRed },
      { k: 'lavender', w: 1.2, c: palette.capLavender },
      { k: 'bluebells', w: 1, c: palette.capLavender },
      { k: 'dandelions', w: 1.4, c: palette.postYellow },
    ];
    const total = species.reduce((s, x) => s + x.w, 0);
    const pickSpecies = (x, z) => {
      // lavender likes the Wohnatelier, bluebells the shady forest edge
      const interior = DISTRICTS.find((d) => d.id === 'interior');
      if (Math.hypot(x - interior.center.x, z - interior.center.z) < interior.radius + 9 && r.chance(0.55)) return species[3];
      if (Math.hypot(x, z) > WORLD_RADIUS - 10 && r.chance(0.4)) return species[4];
      let v = r.range(0, total);
      for (const s of species) if ((v -= s.w) <= 0) return s;
      return species[0];
    };
    const patches = Math.round(110 * (0.3 + 0.7 * density));
    for (let i = 0; i < patches * 3 && flowerPatches.length < patches; i++) {
      const a = r.range(0, TAU), rad = Math.sqrt(r.range(13 * 13, (WORLD_RADIUS - 2) ** 2));
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (groundOk(x, z, { pathPad: 0.4, rimCreep: 1 }) < 0.4) continue;
      const sp = pickSpecies(x, z);
      const n = r.int(4, 10);
      const spread = r.range(0.8, 2.2);
      let placed = 0;
      for (let k = 0; k < n; k++) {
        const aa = r.range(0, TAU), d = Math.sqrt(r.next()) * spread;
        const fx = x + Math.cos(aa) * d, fz = z + Math.sin(aa) * d;
        if (groundOk(fx, fz, { pathPad: 0.3, rimCreep: 1 }) < 0.3) continue;
        batch.add('ground', chunkOf(fx, fz), r.pick(lib[sp.k]), fx, getHeight(fx, fz) - 0.02, fz, {
          rotY: r.range(0, TAU), scale: r.range(0.85, 1.35), phase: r.next(), bright: r.range(0.94, 1.04),
        });
        placed++;
      }
      if (placed) flowerPatches.push({ x, y: getHeight(x, z), z, color: C(sp.c) });
    }
    // singles & path-side borders
    const singles = Math.round(240 * density);
    for (let i = 0; i < singles * 2; i++) {
      const a = r.range(0, TAU), rad = Math.sqrt(r.range(12 * 12, (WORLD_RADIUS + 2) ** 2));
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const pe = pathEdge(x, z);
      const ok = groundOk(x, z, { pathPad: 0.3, rimCreep: 1 });
      if (ok < 0.25 || !r.chance(pe < 2.5 ? 0.8 : 0.35)) continue;
      const sp = pickSpecies(x, z);
      batch.add('ground', chunkOf(x, z), r.pick(lib[sp.k]), x, getHeight(x, z) - 0.02, z, {
        rotY: r.range(0, TAU), scale: r.range(0.8, 1.2), phase: r.next(),
      });
    }
  }

  {
    // clover patches in the meadows
    const r = rng.fork('clover');
    const n = Math.round(260 * density);
    for (let i = 0; i < n * 2; i++) {
      const a = r.range(0, TAU), rad = Math.sqrt(r.range(12 * 12, WORLD_RADIUS ** 2));
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (groundOk(x, z, { pathPad: 0.2, rimCreep: 1.2 }) < 0.3 || !r.chance(0.5)) continue;
      batch.add('ground', chunkOf(x, z), r.pick(lib.clover), x, getHeight(x, z) - 0.01, z, {
        rotY: r.range(0, TAU), scale: r.range(0.9, 1.6),
        tint: jitterColor(r, C(palette.leaf).lerp(C(palette.capTeal), 0.12), 0.015, 0.05, 0.04), phase: r.next(),
      });
    }
  }

  {
    // pebbles lining the dirt paths
    const r = rng.fork('pebbles');
    for (const p of pathPolylines) {
      for (let i = 0; i < p.pts.length - 1; i++) {
        const a = p.pts[i], b = p.pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
        for (const side of [-1, 1]) {
          if (!r.chance(0.42 * (0.5 + 0.5 * density))) continue;
          const off = p.halfWidth + r.range(0.05, 0.6);
          const t = r.next();
          const x = a.x + dx * t + (-dz / len) * off * side, z = a.z + dz * t + (dx / len) * off * side;
          if (areaEdge(x, z) < 0.5) continue;
          batch.add('ground', chunkOf(x, z), r.pick(lib.pebbles), x, getHeight(x, z) - 0.02, z, { rotY: r.range(0, TAU), scale: r.range(0.8, 1.5) });
        }
      }
    }
  }

  {
    // reeds & cattails around the pond (leave the jetty / path end free)
    const r = rng.fork('reeds');
    for (let i = 0; i < 70; i++) {
      const a = r.range(0, TAU), d = POND.radius * r.range(0.82, 1.05);
      const x = POND.center.x + Math.cos(a) * d, z = POND.center.z + Math.sin(a) * d;
      if (pathEdge(x, z) < 2.2) continue;
      const y = getHeight(x, z);
      if (y < POND.waterLevel - 0.35 || y > 0.15) continue;
      if (!r.chance(0.6)) continue;
      batch.add('ground', chunkOf(x, z), r.pick(lib.reeds), x, y - 0.03, z, {
        rotY: r.range(0, TAU), scale: r.range(0.8, 1.25), tint: jitterColor(r, r.pick([palette.leaf, palette.moss, palette.grassDark]), 0.02, 0.05, 0.04), phase: r.next(),
      });
    }
  }

  {
    // fallen leaves under autumn trees
    const r = rng.fork('fallen');
    for (const t of trees) {
      if (!t.autumn) continue;
      const n = r.int(2, 4);
      for (let k = 0; k < n; k++) {
        const a = r.range(0, TAU), d = r.range(0.3, t.crownR);
        const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
        if (groundOk(x, z, { pathPad: 0.05, rimCreep: 0 }) <= 0) continue;
        batch.add('ground', chunkOf(x, z), r.pick(lib.leaves), x, getHeight(x, z) + 0.005, z, {
          rotY: r.range(0, TAU), scale: r.range(0.9, 1.6), tint: jitterColor(r, t.leaf, 0.03, 0.05, 0.05), normal: getNormal(x, z, new THREE.Vector3()),
        });
      }
    }
  }

  mark('scatter');
  // ─── Build meshes ──────────────────────────────────────────────────────────
  const mats = createFoliageMaterials();
  const shadows = !!quality?.shadows;
  const built = batch.finalize({
    trees: { material: mats.trees, castShadow: shadows, receiveShadow: true, depthMaterial: mats.treesDepth },
    far: { material: mats.trees, castShadow: false, receiveShadow: false },
    ground: { material: mats.ground, castShadow: false, receiveShadow: true },
  });
  const group = new THREE.Group();
  group.name = 'vegetation';
  for (const m of built.meshes) group.add(m);

  // night glow: mushroom caps and the giants' windows
  let glowTris = 0;
  if (glowCaps.length) {
    const geo = mergeAll(glowCaps);
    const mesh = new THREE.Mesh(geo, materials.glow(C(palette.glowCyan).lerp(C(palette.spots), 0.3), { day: 0.1, night: 2.6 }));
    mesh.name = 'veg:glow-mushrooms';
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    glowTris += geo.index.count / 3;
  }
  if (windows.length) {
    const parts = windows.map((w) => {
      const g = new THREE.CircleGeometry(w.r, 12);
      g.rotateY(w.rotY);
      g.translate(w.x, w.y, w.z);
      return g;
    });
    const geo = mergeAll(parts);
    const mesh = new THREE.Mesh(geo, materials.glow(palette.windowGlow, { day: 0.3, night: 2.2 }));
    mesh.name = 'veg:giant-windows';
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    glowTris += geo.index.count / 3;
  }
  scene.add(group);
  mark('meshes');

  // ─── Per-frame: camera-occlusion fade follows the camera rig ──────────────
  let fadeOn = true;
  ctx.engine.addUpdate(() => {
    vegUniforms.uCamPos.value.copy(ctx.camera.position);
    const target = ctx.cameraRig?.target;
    if (target) vegUniforms.uFocus.value.copy(target);
    else vegUniforms.uFocus.value.copy(ctx.camera.position);
    vegUniforms.uFade.value = fadeOn && target ? 1 : 0;
  }, 85);

  // Spatial lookup for ambient effects (falling leaves etc.).
  const TCELL = 12;
  const tgrid = new Map();
  for (const t of trees) {
    const k = Math.floor(t.x / TCELL) + ',' + Math.floor(t.z / TCELL);
    if (!tgrid.has(k)) tgrid.set(k, []);
    tgrid.get(k).push(t);
  }
  function treesNear(x, z, radius, out = []) {
    out.length = 0;
    const i0 = Math.floor((x - radius) / TCELL), i1 = Math.floor((x + radius) / TCELL);
    const j0 = Math.floor((z - radius) / TCELL), j1 = Math.floor((z + radius) / TCELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = tgrid.get(i + ',' + j);
        if (!list) continue;
        for (const t of list) if ((t.x - x) ** 2 + (t.z - z) ** 2 < radius * radius) out.push(t);
      }
    }
    return out;
  }

  const stats = {
    drawables: group.children.length,
    triangles: Math.round(built.triangles + glowTris),
    vertices: built.vertices,
    instances: batch.instances,
    colliders: colliderCount,
    trees: trees.length,
    breakdown: batch.breakdown,
  };
  stats.timings = marks.join(' ');
  if (ctx.engine.debug) console.info('[vegetation]', stats);

  return {
    group,
    trees,
    flowerPatches,
    glowSpots,
    treesNear,
    stats,
    setFade(on) {
      fadeOn = !!on;
    },
  };
}

/** Merge indexed/non-indexed position+normal geometries into one indexed geometry. */
function mergeAll(geos) {
  const pos = [], nrm = [], idx = [];
  let off = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    if (g.index) for (const v of g.index.array) idx.push(v + off);
    else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
