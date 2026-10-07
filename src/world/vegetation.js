// ─────────────────────────────────────────────────────────────────────────────
// Vegetation — the forest around and inside the glen.
//
//   forest wall   colossal mossy trees (r ≈ 23–38, sides & back; a few step
//                 inside between the spots), silver birches, buttress roots,
//                 ivy, a high leaf-card canopy           (vegetation/trees.js)
//   giants        GIANT fly agarics lining the front of the main path and
//                 clustered at the glen's edges          (vegetation/mushrooms.js)
//   ground        mossy rocks & boulders, moss mounds, fallen mossy logs with
//                 shelf fungi, small exposed roots, twigs (vegetation/groundcover.js)
//   undergrowth   ferns (many, three sizes), grass tussocks, clover, wildflower
//                 communities (bluebells, forget-me-nots, foxgloves, daisies,
//                 buttercups, meadow mix), toadstools, boletes, bonnet tufts and
//                 tiny bioluminescent mushrooms that glow at night
//                 (vegetation/plants.js, instanced, wind sway)
//   framing       big ferns at the front edge for depth
//
// Placement (vegetation/zones.js): only on free forest floor — never on
// paths, pads (and the dressed rings around them), the stream & its banks,
// the pond, the waterfall outcrop or the Great Oak's root zone — and nothing
// tall may stand in any spot camera's line of sight (plain, -wide, -close).
// Counts scale with ctx.quality.density.
//
// Result (ctx.modules.vegetation):
//   { trees, giants, flowerPatches: [{x,y,z,r}], glowSpots: [{x,y,z}],
//     mossyRocks: [{x,y,z,r}], logs, treesNear(x, z, radius, out), stats }
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { getHeight, getPathDistance, getStreamDistance, pathPolylines } from './ground.js';
import { STREAM, SPOTS } from './layout.js';
import { glowQuads } from '../props/glow.js';
import { fieldBroad, fieldMid, fieldFine, fieldAlt, GeoBuilder, instanced, staticMesh, TAU } from './vegetation/common.js';
import { canGrow, isClearOfViews, blocksView, oakDist, cameraClearance } from './vegetation/zones.js';
import { forestPlan } from './vegetation/plan.js';
import { buildTree, clumpTemplate } from './vegetation/trees.js';
import { MushroomKit, CAP_REDS, CAP_BROWNS } from './vegetation/mushrooms.js';
import { mossyRock, mossMound, fallenLog, smallRoot, twig } from './vegetation/groundcover.js';
import { fernTemplate, grassTemplate, cloverTemplate, flowerTemplate, FLOWER_KINDS } from './vegetation/plants.js';

/** Spatial hash of solid things (trunks, rocks, logs, giant stems) for spacing. */
class Occupancy {
  constructor(cell = 2) {
    this.cell = cell;
    this.map = new Map();
  }
  key(i, j) {
    return i * 73856093 ^ j * 19349663;
  }
  add(x, z, r, tag = null) {
    const c = this.cell;
    const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c);
    const j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
    const e = { x, z, r, tag };
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j);
      let l = this.map.get(k);
      if (!l) this.map.set(k, (l = []));
      l.push(e);
    }
  }
  /** Distance from (x, z) to the nearest occupied edge (minus r); Infinity if none within reach. */
  clearance(x, z, reach = 4) {
    const c = this.cell;
    let best = Infinity;
    const i0 = Math.floor((x - reach) / c), i1 = Math.floor((x + reach) / c);
    const j0 = Math.floor((z - reach) / c), j1 = Math.floor((z + reach) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = this.map.get(this.key(i, j));
      if (!l) continue;
      for (const e of l) {
        const d = Math.hypot(e.x - x, e.z - z) - e.r;
        if (d < best) best = d;
      }
    }
    return best;
  }
  free(x, z, r) {
    return this.clearance(x, z, r + 6) > r;
  }
}

export default async function build(ctx) {
  const t0 = performance.now();
  const q = ctx.quality ?? {};
  const density = THREE.MathUtils.clamp(q.density ?? 1, 0.25, 1.5);
  const tier = q.tier ?? 'high';
  const M = ctx.materials;
  const rng = createRng('vegetation');
  const group = new THREE.Group();
  group.name = 'vegetation';
  ctx.scene.add(group);
  const occ = new Occupancy(2);
  const stats = { drawCalls: 0, triangles: 0, instances: 0, meshes: {} };
  const addMesh = (m) => {
    if (!m) return null;
    group.add(m);
    stats.drawCalls++;
    const g = m.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    stats.triangles += tris * (m.isInstancedMesh ? m.count : 1);
    stats.meshes[m.name] = Math.round(tris * (m.isInstancedMesh ? m.count : 1)) + (m.isInstancedMesh ? ` (${m.count}× ${Math.round(tris)})` : '');
    if (m.isInstancedMesh) stats.instances += m.count;
    return m;
  };
  const stones = ctx.modules?.terrain?.pathStones ?? [];
  const glowSpots = [];
  const flowerPatches = [];
  const mossyRocks = [];
  const logs = [];

  // ── 1. the forest wall ────────────────────────────────────────────────────
  const plan = forestPlan();
  const builders = { bark: new GeoBuilder(), birch: new GeoBuilder(), ivy: new GeoBuilder() };
  const clumps = [];
  for (const t of plan.trees) {
    buildTree(t, builders, clumps, { density });
    occ.add(t.x, t.z, t.radius * 1.6, 'tree');
  }
  // the canopy clump template (also used for the forest-edge bushes below)
  const clumpGeo = clumpTemplate(rng.fork('clump'), tier === 'low' ? 90 : 130, { size: [0.25, 0.38] });

  // ── 2. giant fly agarics ──────────────────────────────────────────────────
  const giantKit = new MushroomKit(rng.fork('giants'));
  const smallKit = new MushroomKit(rng.fork('small'));
  const giants = [];
  const tryGiant = (x, z, H, opts = {}) => {
    const R = opts.capR ?? H * rng.range(0.42, 0.6);
    if (!canGrow(x, z, { margin: Math.min(1.2, R * 0.35) })) return false;
    if (!occ.free(x, z, R * 0.75)) return false;
    for (const g of giants) if (Math.hypot(g.x - x, g.z - z) < (g.R + R) * 0.8) return false;
    const y = getHeight(x, z);
    if (!isClearOfViews(x, y, z, H + R * 0.5, R * 0.95)) return false;
    const brown = opts.brown ?? rng.chance(0.18);
    const shape = opts.shape ?? (rng.chance(0.12) ? 'cone' : rng.chance(0.3) ? 'flat' : 'dome');
    const glowGills = brown && rng.chance(0.75);
    if (glowGills) glowSpots.push({ x, y: y + H * 0.85, z });
    giantKit.amanita(x, y, z, {
      height: H,
      capR: R,
      shape,
      color: brown ? rng.pick(CAP_BROWNS) : rng.pick(CAP_REDS),
      lean: rng.range(0.02, 0.16),
      leanAz: opts.leanAz ?? rng.range(0, TAU),
      warts: brown ? 0.6 : 1,
      gillColor: brown ? '#e8d4b0' : '#f2e6cc',
      glowGills,
    });
    occ.add(x, z, R * 0.45, 'giant');
    giants.push({ x, y, z, H, R });
    // a family of little ones at its foot
    const kids = rng.int(2, 5);
    for (let k = 0; k < kids; k++) {
      const a = rng.range(0, TAU), d = R * rng.range(0.35, 0.9);
      const kx = x + Math.sin(a) * d, kz = z + Math.cos(a) * d;
      if (!canGrow(kx, kz)) continue;
      const h = rng.range(0.12, 0.45) * Math.min(1.6, H / 2.5);
      smallKit.amanita(kx, getHeight(kx, kz), kz, { height: h, capR: h * rng.range(0.45, 0.7), shape: rng.chance(0.3) ? 'cone' : 'dome', color: brown ? rng.pick(CAP_BROWNS) : rng.pick(CAP_REDS) });
    }
    return true;
  };

  // (a) the fly-agaric avenue: both sides of the main path towards the front
  {
    const main = pathPolylines.find((p) => p.id === 'main');
    const pts = main.pts.filter((p) => p.z > 12);
    for (let i = 0; i < pts.length; i += 2) {
      const p = pts[i];
      const nx = pts[Math.min(pts.length - 1, i + 1)], pv = pts[Math.max(0, i - 1)];
      let tx = nx.x - pv.x, tz = nx.z - pv.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      for (const side of [-1, 1]) {
        if (!rng.chance(0.55)) continue;
        const off = main.halfWidth * rng.range(1.9, 3.6);
        const x = p.x - tz * off * side, z = p.z + tx * off * side;
        // bigger towards the front and further from the path
        const H = rng.range(1.4, 2.4) + Math.max(0, (p.z - 16) * 0.22) + (off - 2.2) * 0.5;
        tryGiant(x, z, Math.min(5.6, H), { leanAz: Math.atan2(tz * side, -tx * side) });
      }
    }
  }
  // (b) clusters at the glen's edges (sides & back), between the spots
  {
    const centers = [];
    for (let k = 0; k < 60; k++) {
      const az = rng.range(-Math.PI, Math.PI);
      const r = rng.range(14, 27);
      centers.push([Math.sin(az) * r, Math.cos(az) * r]);
    }
    let made = 0;
    for (const [cx, cz] of centers) {
      if (made > 22) break;
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) {
        const x = cx + rng.jitter(2.2), z = cz + rng.jitter(2.2);
        for (let tries = 0; tries < 3; tries++) {
          if (tryGiant(x + rng.jitter(1), z + rng.jitter(1), rng.range(1.5, 5) * (k === 0 ? 1 : 0.7) * (tries ? 0.8 : 1))) {
            made++;
            break;
          }
        }
      }
    }
  }

  // ── 3. rocks, moss mounds, logs, roots, twigs ─────────────────────────────
  const rockB = new GeoBuilder();
  const moundB = new GeoBuilder();
  const smallBarkB = new GeoBuilder();
  const rockTints = ['#9c978c', '#a39d90', '#8f8c86', '#a8a092', '#969a94'];
  // boulders near the forest wall and big trees
  for (let k = 0; k < Math.round(26 * density); k++) {
    const az = rng.range(-Math.PI, Math.PI);
    const r = rng.range(14, 34);
    const x = Math.sin(az) * r, z = Math.cos(az) * r;
    const size = rng.range(0.7, 1.9) * (r > 22 ? 1.2 : 0.8);
    if (!canGrow(x, z, { margin: size * 0.6 }) || !occ.free(x, z, size)) continue;
    if (!isClearOfViews(x, getHeight(x, z), z, size * 0.8, size)) continue;
    const res = mossyRock(rockB, rng, x, z, size, { flat: rng.range(0.5, 0.75), color: new THREE.Color(rng.pick(rockTints)) });
    occ.add(x, z, res.r * 0.9, 'rock');
    mossyRocks.push({ x, y: res.top, z, r: res.r });
  }
  // fallen logs at the edges
  for (let k = 0; k < 12 && logs.length < Math.round(6 * density + 1); k++) {
    const az = rng.range(-Math.PI, Math.PI);
    const r = rng.range(15, 30);
    const x = Math.sin(az) * r, z = Math.cos(az) * r;
    const len = rng.range(3, 6.5), lr = rng.range(0.32, 0.6);
    const yaw = az + Math.PI / 2 + rng.jitter(0.6);
    // test both ends and the middle
    let ok = true;
    for (const s of [-0.5, 0, 0.5]) {
      const px = x + Math.sin(yaw) * len * s, pz = z + Math.cos(yaw) * len * s;
      if (!canGrow(px, pz, { margin: lr + 0.4 }) || !occ.free(px, pz, lr + 0.3) || !isClearOfViews(px, getHeight(px, pz), pz, lr * 2, lr + 0.2)) ok = false;
    }
    if (!ok) continue;
    const log = fallenLog(builders.bark, rng, x, z, len, lr, yaw);
    for (const s of [-0.5, -0.25, 0, 0.25, 0.5]) occ.add(x + Math.sin(yaw) * len * s, z + Math.cos(yaw) * len * s, lr, 'log');
    for (const b of log.brackets) giantKit.bracket(b.p, b.n, { size: lr * rng.range(0.4, 0.7) });
    logs.push({ x, z, len, r: lr, yaw });
    // bonnets & moss on the log
    const k2 = rng.int(1, 3);
    for (let i = 0; i < k2; i++) {
      const p = log.pts[rng.int(1, log.pts.length - 2)];
      smallKit.bonnets(p.x + rng.jitter(0.1), p.y + lr * 0.85, p.z + rng.jitter(0.1), { height: 0.12, count: rng.int(3, 6), glow: rng.chance(0.35) });
    }
  }
  // brackets on some tree trunks
  for (const t of plan.trees) {
    if (t.kind === 'birch' || !rng.chance(0.55)) continue;
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU);
      const y = t.y0 + rng.range(0.8, 3.5);
      const r = t.radius * 1.12;
      const nrm = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      giantKit.bracket(new THREE.Vector3(t.x + nrm.x * r, y, t.z + nrm.z * r), nrm, { size: rng.range(0.25, 0.5), tiers: rng.int(2, 4) });
    }
  }
  // smaller mossy rocks scattered through the glen
  for (let k = 0; k < Math.round(70 * density); k++) {
    const az = rng.range(-Math.PI, Math.PI);
    const r = Math.sqrt(rng.range(9 * 9, 34 * 34));
    const x = Math.sin(az) * r, z = Math.cos(az) * r;
    const size = rng.range(0.18, 0.6);
    if (!canGrow(x, z, { margin: size * 0.5 }) || !occ.free(x, z, size)) continue;
    const res = mossyRock(rockB, rng, x, z, size, { flat: rng.range(0.45, 0.8), color: new THREE.Color(rng.pick(rockTints)) });
    occ.add(x, z, res.r * 0.8, 'rock');
    mossyRocks.push({ x, y: res.top, z, r: res.r });
  }
  // moss mounds
  for (let k = 0; k < Math.round(55 * density); k++) {
    const az = rng.range(-Math.PI, Math.PI);
    const r = Math.sqrt(rng.range(10 * 10, 36 * 36));
    const x = Math.sin(az) * r, z = Math.cos(az) * r;
    const w = rng.range(0.6, 1.8);
    if (!canGrow(x, z, { margin: w * 0.4 }) || !occ.free(x, z, w * 0.6)) continue;
    mossMound(moundB, rng, x, z, w, w * rng.range(0.16, 0.34), { color: new THREE.Color().setHSL(0.22 + rng.jitter(0.03), 0.42, 0.34 + rng.jitter(0.06)) });
    occ.add(x, z, w * 0.5, 'mound');
  }
  // small exposed roots and twigs
  for (let k = 0; k < Math.round(40 * density); k++) {
    const az = rng.range(-Math.PI, Math.PI);
    const r = rng.range(12, 32);
    const x = Math.sin(az) * r, z = Math.cos(az) * r;
    if (!canGrow(x, z, { margin: 0.6 })) continue;
    smallRoot(smallBarkB, rng, x, z, rng.range(0, TAU), rng.range(1, 2.6), rng.range(0.05, 0.12));
  }
  for (let k = 0; k < Math.round(180 * density); k++) {
    const az = rng.range(-Math.PI, Math.PI);
    const r = Math.sqrt(rng.range(8 * 8, 32 * 32));
    const x = Math.sin(az) * r, z = Math.cos(az) * r;
    if (!canGrow(x, z, { path: 1.05 })) continue;
    twig(smallBarkB, rng, x, z);
  }

  // ── 4. undergrowth scatter ────────────────────────────────────────────────
  const fernL = [], fernM = [], fernS = [];
  const grassA = [], grassB = [];
  const clover = [];
  const flowers = Object.fromEntries(FLOWER_KINDS.map((k) => [k, []]));
  const bushes = [];
  const fernTints = ['#5b8c3a', '#4f8434', '#66923e', '#5a8a44', '#71973c', '#4d7d3e'];
  const grassTints = ['#7d9c46', '#88a64c', '#6f9440', '#94a854', '#7a9a52'];
  const jitterTint = (hex, h = 0.02, l = 0.06) => new THREE.Color(hex).offsetHSL(rng.jitter(h), rng.jitter(0.06), rng.jitter(l));
  const near = (list, x, z, r) => list.some((o) => Math.hypot(o.x - x, o.z - z) < r + (o.r ?? 0));

  const cell = 0.55 / Math.sqrt(density);
  const LIM = 40;
  for (let gz = -LIM; gz < LIM; gz += cell) {
    for (let gx = -LIM; gx < LIM; gx += cell) {
      const x = gx + rng.range(0, cell), z = gz + rng.range(0, cell);
      const r = Math.hypot(x, z);
      if (r > 41) continue;
      // spend the detail where the spots look: the front band (z > 20) is
      // almost never seen up close, and behind the tree wall only big shapes read
      let vis = 1;
      if (z > 20) vis *= 0.3;
      if (r > 24) vis *= 0.5;
      if (r > 30) vis *= 0.45;
      if (!rng.chance(vis)) continue;
      if (!canGrow(x, z, { path: 1.12 })) continue;
      const occClear = occ.clearance(x, z, 3);
      if (occClear < 0.05) continue;
      const y = getHeight(x, z);
      const fB = fieldBroad(x, z), fM = fieldMid(x, z), fA = fieldAlt(x, z), fF = fieldFine(x, z);
      const pd = getPathDistance(x, z);
      const edge = pd < 2.1; // right along a path
      const shady = r > 21 || oakDist(x, z) < 13 || occClear < 1.2;
      const damp = getStreamDistance(x, z) < 7 || Math.hypot(x - STREAM.pond.x, z - STREAM.pond.z) < 9;
      // biome weights
      const wFern = (0.25 + fA * 0.9 + (shady ? 0.5 : 0) + (r > 24 ? 0.4 : 0)) * (edge ? 0.35 : 1);
      const wGrass = 0.55 + (1 - fA) * 0.5 + (edge ? 0.8 : 0);
      const wFlower = (0.1 + (1 - fA) * 0.4 * fM + (edge ? 0.2 : 0) + (r < 21 ? 0.3 : 0)) * (r > 26 ? 0.25 : 1);
      const wClover = (edge ? 0.35 : 0.06) + (fF > 0.75 ? 0.15 : 0);
      const wMush = (shady ? 0.07 : 0.025) + (occClear < 1.5 ? 0.08 : 0);
      const wNone = (r < 22 ? 0.35 : 0.75) + fB * 0.4;
      const tot = wFern + wGrass + wFlower + wClover + wMush + wNone;
      let roll = rng.next() * tot;
      if ((roll -= wNone) < 0) continue;
      if ((roll -= wFern) < 0) {
        // out at the forest wall: fewer but bigger ferns (they read from afar)
        if (r > 25 && rng.chance(0.4)) continue;
        const big = fA > 0.55 && rng.chance(0.45);
        const s = (big ? rng.range(0.85, 1.55) : rng.range(0.5, 1.05)) * (r > 25 ? 1.4 : 1);
        // tall ferns must not sit in a spot camera's view
        if (s * 0.9 > 0.7 && !isClearOfViews(x, y, z, s * 0.9, s * 0.8)) continue;
        const it = { x, y, z, ry: rng.range(0, TAU), s, sy: rng.range(0.8, 1.15), color: jitterTint(rng.pick(fernTints)) };
        (big ? fernL : rng.chance(0.55) ? fernM : fernS).push(it);
        continue;
      }
      if ((roll -= wGrass) < 0) {
        const it = { x, y, z, ry: rng.range(0, TAU), s: rng.range(0.55, 1.25) * (edge ? 0.85 : 1), color: jitterTint(rng.pick(grassTints), 0.025, 0.08) };
        (rng.chance(0.5) ? grassA : grassB).push(it);
        continue;
      }
      if ((roll -= wFlower) < 0) {
        let kind;
        const inner = r < 21;
        if (damp && rng.chance(0.6)) kind = 'forgetMeNots';
        else if (shady && !inner) kind = rng.pick(['bluebells', 'bluebells', 'foxgloves', 'forgetMeNots']);
        else kind = rng.pick(['daisies', 'buttercups', 'meadow', 'meadow', 'bluebells', 'forgetMeNots', 'foxgloves']);
        // the open glen's flowers are a touch bigger so they read from the spots
        const s = rng.range(0.85, 1.35) * (inner ? 1.3 : 1);
        if (kind === 'foxgloves' && !isClearOfViews(x, y, z, 1.1 * s, 0.3)) continue;
        flowers[kind].push({ x, y, z, ry: rng.range(0, TAU), s, color: jitterTint('#ffffff', 0.015, 0.05) });
        if (flowerPatches.length < 400) flowerPatches.push({ x, y: y + 0.3 * s, z, r: 0.3 * s, kind });
        continue;
      }
      if ((roll -= wClover) < 0) {
        clover.push({ x, y: y + 0.005, z, ry: rng.range(0, TAU), s: rng.range(0.8, 1.5), color: jitterTint('#6a9a40', 0.02, 0.06) });
        continue;
      }
      // mushrooms
      const m = rng.next();
      if (m < 0.38) {
        const h = rng.range(0.1, 0.3);
        smallKit.amanita(x, y, z, { height: h, capR: h * rng.range(0.5, 0.75), shape: rng.chance(0.25) ? 'cone' : rng.chance(0.4) ? 'flat' : 'dome' });
      } else if (m < 0.58) smallKit.bolete(x, y, z, { height: rng.range(0.1, 0.22) });
      else if (m < 0.78) smallKit.bonnets(x, y, z, { height: rng.range(0.08, 0.16) });
      else {
        smallKit.bonnets(x, y, z, { height: rng.range(0.07, 0.13), glow: true, count: rng.int(4, 8), spread: 1.8 });
        glowSpots.push({ x, y: y + 0.1, z });
      }
    }
  }

  // grass & clover tucked between the path stones (moss and weeds take the gaps)
  for (const s of stones) {
    if (!rng.chance(0.55 * density)) continue;
    const a = rng.range(0, TAU);
    const x = s.x + Math.sin(a) * (s.r + 0.08), z = s.z + Math.cos(a) * (s.r + 0.08);
    if (stones.some((o) => o !== s && Math.hypot(o.x - x, o.z - z) < o.r + 0.03)) continue;
    const y = getHeight(x, z);
    if (rng.chance(0.55)) (rng.chance(0.5) ? grassA : grassB).push({ x, y, z, ry: rng.range(0, TAU), s: rng.range(0.3, 0.55), color: jitterTint(rng.pick(grassTints)) });
    else clover.push({ x, y: y + 0.01, z, ry: rng.range(0, TAU), s: rng.range(0.5, 0.9), color: jitterTint('#6a9a40') });
  }

  // forest-edge bushes (leaf masses at ground level between the wall trunks)
  for (let k = 0; k < Math.round(70 * density); k++) {
    const az = rng.range(-Math.PI, Math.PI);
    const r = rng.range(21, 38);
    const x = Math.sin(az) * r, z = Math.cos(az) * r;
    if (Math.abs(az) < 1.0) continue; // keep the front open
    const s = rng.range(1.0, 2.2);
    if (!canGrow(x, z, { margin: s * 0.5 }) || !occ.free(x, z, s * 0.5)) continue;
    const y = getHeight(x, z);
    if (blocksView(x, y + s * 0.6, z, s * 1.1)) continue;
    bushes.push({ x, y: y + s * 0.45, z, s, sy: rng.range(0.6, 0.85), ry: rng.range(0, TAU), color: new THREE.Color().setHSL(0.25 + rng.jitter(0.03), 0.42, 0.36 + rng.jitter(0.05)) });
  }

  // ── 5. foreground framing: big ferns at the front edge ────────────────────
  for (let k = 0; k < 90; k++) {
    const x = rng.range(-30, 30), z = rng.range(18, 34);
    if (!canGrow(x, z, { margin: 0.6 })) continue;
    if (cameraClearance(x, z) < 2.5) continue;
    const s = rng.range(1.6, 2.8);
    const y = getHeight(x, z);
    if (!isClearOfViews(x, y, z, s * 0.85, s * 0.9)) continue;
    fernL.push({ x, y, z, ry: rng.range(0, TAU), s, sy: rng.range(0.85, 1.1), color: jitterTint(rng.pick(fernTints)) });
  }

  // (b) the bottom corners of every spot shot: a big fern or two close to the
  //     lens, soft in the depth of field — the painter's foreground framing
  {
    const f = new THREE.Vector3(), rt = new THREE.Vector3();
    for (const spot of SPOTS) {
      if (spot.id === 'glen') continue;
      const P = spot.camera.position, T = spot.camera.target;
      f.set(T[0] - P[0], 0, T[2] - P[2]).normalize();
      rt.set(-f.z, 0, f.x);
      const hfov = Math.atan(Math.tan(THREE.MathUtils.degToRad((spot.camera.fov ?? 40) / 2)) * (16 / 9));
      for (const side of [-1, 1]) {
        for (const d of [5.5, 7, 8.5, 10]) {
          const w = d * Math.tan(hfov) * rng.range(0.7, 0.95);
          const x = P[0] + f.x * d + rt.x * w * side + rng.jitter(0.4);
          const z = P[2] + f.z * d + rt.z * w * side + rng.jitter(0.4);
          if (!canGrow(x, z, { margin: 0.2 }) || occ.clearance(x, z, 3) < 0.6) continue;
          const y = getHeight(x, z);
          const s = rng.range(1.5, 2.2);
          if (!isClearOfViews(x, y, z, s * 0.8, s * 0.7)) continue;
          fernL.push({ x, y, z, ry: rng.range(0, TAU), s, sy: rng.range(0.9, 1.15), color: jitterTint(rng.pick(fernTints)) });
          break;
        }
      }
    }
  }

  // ── 6. meshes ─────────────────────────────────────────────────────────────
  const fernMat = M.foliage({ variant: 'fern', vertexColors: true, translucency: 0.9, wind: { strength: 0.045, base: 0.08, speed: 1.3 } });
  const grassMat = M.foliage({ variant: 'grass', vertexColors: true, translucency: 0.8, wind: { strength: 0.12, base: 0.02, speed: 1.7 } });
  const flowerMat = M.surface('leaf', { vertexColors: true, side: THREE.DoubleSide, wind: { strength: 0.14, base: 0.03, speed: 1.5 } });
  const canopyMat = M.foliage({ variant: 'oak', vertexColors: true, translucency: 1.0, wind: { strength: 0.012, base: -0.4, speed: 0.7 } });
  const ivyMat = M.foliage({ variant: 'ivy', vertexColors: true, volume: false });
  const barkMat = M.surface('bark', { mossy: 0.42, scale: 1.8 });
  const birchMat = M.surface('bark', { vertexColors: true, mossy: 0.12, scale: 0.6 });
  const rockMat = M.surface('rock', { mossy: 0.62, vertexColors: true });
  const mossMat = M.surface('moss', { vertexColors: true, scale: 0.55 });

  const fernRng = rng.fork('fern-templates');
  addMesh(instanced('ferns-large', fernTemplate(fernRng, { fronds: [10, 13], length: [0.85, 1.15], e0: [0.85, 1.25], droop: [1.0, 1.6], young: [1, 2], segs: 5 }), fernMat, fernL));
  addMesh(instanced('ferns-medium', fernTemplate(fernRng, { fronds: [8, 10], length: [0.6, 0.85], e0: [1.0, 1.35], droop: [1.1, 1.7], segs: 4, young: [1, 1] }), fernMat, fernM));
  addMesh(instanced('ferns-small', fernTemplate(fernRng, { fronds: [6, 8], length: [0.38, 0.55], e0: [0.9, 1.3], droop: [1.0, 1.6], segs: 4, young: [0, 1] }), fernMat, fernS));
  const grassRng = rng.fork('grass-templates');
  addMesh(instanced('grass-a', grassTemplate(grassRng, { cards: [4, 5], height: [0.4, 0.6] }), grassMat, grassA));
  addMesh(instanced('grass-b', grassTemplate(grassRng, { cards: [3, 4], height: [0.25, 0.42], spread: 0.12 }), grassMat, grassB));
  addMesh(instanced('clover', cloverTemplate(rng.fork('clover')), flowerMat, clover));
  const flRng = rng.fork('flower-templates');
  for (const kind of FLOWER_KINDS) addMesh(instanced(`flowers-${kind}`, flowerTemplate(kind, flRng), flowerMat, flowers[kind]));
  addMesh(instanced('canopy', clumpGeo, canopyMat, [...clumps, ...bushes], { cast: true }));

  const meshOf = (name, B, mat, opts) => (B.count ? staticMesh(name, B.build(), mat, opts) : null);
  addMesh(meshOf('forest-bark', builders.bark, barkMat, { cast: true }));
  addMesh(meshOf('forest-birch', builders.birch, birchMat, { cast: true }));
  addMesh(meshOf('forest-ivy', builders.ivy, ivyMat, { cast: false }));
  addMesh(meshOf('forest-rocks', rockB, rockMat, { cast: true }));
  addMesh(meshOf('forest-moss', moundB, mossMat, { cast: false }));
  addMesh(meshOf('forest-twigs', smallBarkB, barkMat, { cast: false }));
  for (const m of giantKit.build(ctx, 'giant-mushrooms', { cast: true })) addMesh(m);
  for (const m of smallKit.build(ctx, 'small-mushrooms', { cast: false })) addMesh(m);
  // halos around the glowing caps (night)
  const glowPts = [...giantKit.glowPoints, ...smallKit.glowPoints];
  if (glowPts.length) addMesh(glowQuads(glowPts, '#7ff0d0', { day: 0.0, night: 0.9 }));

  // ── 7. fairy lights spiralling up a giant or two (refs: the fly-agaric house between the roots) ──
  const lit = plan.trees
    .filter((t) => t.kind === 'giant' && t.centerAt && Math.hypot(t.x, t.z) < 27)
    .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))
    .slice(0, 2);
  for (const t of lit) {
    const pts = [];
    const turns = 2.2;
    const a0 = rng.range(0, TAU);
    const steps = Math.round(turns * 10);
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const y = 1.6 + f * 5.5;
      const th = a0 + f * turns * TAU;
      const c = t.centerAt(y);
      const r = t.radiusAt(y, th) + 0.12;
      pts.push({ x: c.x + Math.cos(th) * r, y: c.y + Math.sin(f * 37) * 0.08, z: c.z + Math.sin(th) * r });
    }
    const lights = ctx.props.makeStringLights(pts, { sag: 0.04, spacing: 0.42 });
    lights.name = 'forest-fairy-lights';
    group.add(lights);
    stats.drawCalls += 3;
  }

  group.traverse((o) => {
    if (o.isMesh && !o.userData.keepRaycast) o.raycast = () => {};
  });

  // ── API ───────────────────────────────────────────────────────────────────
  const trees = plan.trees.map((t) => ({
    x: t.x,
    z: t.z,
    y0: t.y0,
    radius: t.radius,
    height: t.height,
    kind: t.kind,
    crownY: t.y0 + t.height * 0.75,
    crownR: t.radius * 5,
    leaf: new THREE.Color(t.kind === 'birch' ? '#c2c860' : '#6e8f3a'),
  }));
  function treesNear(x, z, radius, out = []) {
    out.length = 0;
    for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < radius) out.push(t);
    return out;
  }
  stats.ms = Math.round(performance.now() - t0);
  stats.giants = giants.length;
  stats.trees = plan.trees.length;
  ctx.forest = { trees, giants, glowSpots, flowerPatches, mossyRocks, logs };
  return { group, trees, giants, glowSpots, flowerPatches, mossyRocks, logs, treesNear, stats };
}
