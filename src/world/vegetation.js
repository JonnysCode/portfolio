// ─────────────────────────────────────────────────────────────────────────────
// Vegetation — the forest around and inside the glen.
//
//   forest wall   colossal mossy trees (⌀ 3–6, 45–66 tall; r ≈ 23–38 on the
//                 sides & back, the biggest stepping inside between the spots):
//                 bare cathedral columns up to y ≈ 31 (buttress roots, moss
//                 creeping up the bark, ivy, shelf fungi, mossy broken stubs),
//                 then a high leaf-card canopy ceiling; silver birches whose
//                 crowns join it                            (vegetation/trees.js)
//   giants        GIANT amanitas lining the front of the main path (mostly
//                 red) and clustered at the glen's edges (red beside ochre,
//                 tan and brown ones), each with a family at its foot
//   families      mushrooms grow in families — one big lead, 3–7 smaller ones,
//                 buttons — of several species (fly agarics, panther caps,
//                 ochre & golden amanitas, parasols, boletes, bonnets) at tree
//                 feet, along logs, at stumps, along the path edges
//                              (vegetation/families.js, vegetation/mushrooms.js)
//   ground        mossy rocks & boulders, moss mounds, fallen mossy logs with
//                 shelf fungi, old saw-cut stumps with growth rings, small
//                 exposed roots, twigs                (vegetation/groundcover.js)
//   vignettes     every lawn broken into little scenes (0.3–1.5 units): moss
//                 hummocks, small logs with a mushroom family, stumps, rock
//                 groups with moss caps, fern & foxglove clumps; a big mossy
//                 log frames the bottom of the wide overview
//   undergrowth   CLUMPS, not confetti: a noise field pulled towards roots,
//                 stones, logs, stumps and path edges, thresholded into clumps
//                 with dense cores and feathered edges; each mixes 3–4 species
//                 from a recipe for its place (sun, shade, damp, path edge) —
//                 ferns (three sizes), bilberry & bramble bushlets, foxglove /
//                 bluebell spikes, grass, clover, forget-me-nots, daisies,
//                 buttercups, broad leaves, a mushroom tuft — with open glades
//                 between them where the floor's own patches show (velvet
//                 cushions, litter drifts, clover mats, bare soil & pebbles:
//                 common.groundPatches, shared with the terrain shader); plus
//                 lush beds  (vegetation/plants.js, instanced, wind)
//   lawn wedges   the open lawns between the paths (what the overview and the
//                 glen's camera look down on) get real 3D dressing, not paint:
//                 moss hummocks on the floor's velvet cushions, clover mats on
//                 its clover patches, dense warm grass tufts, low ferns in the
//                 shade, little mossy stone groups, a few small mushroom families
//   colour        flower drifts of one species each — forget-me-not & bluebell
//                 blue, wood-anemone white, campion pink, buttercup yellow —
//                 along the paths' edges, at the houses' feet and in the lawn
//                 wedges (cushions of oversized heads; the ground right under
//                 them faintly tinted with their colour — round 4's wide wash
//                 read as pastel paint smears); by night blue petals fade grey
//                 and catch a moon glint (common.nightPetals),
//                 hydrangeas by the cottages, ochre & russet leaf drifts, a
//                 little signpost at the path fork
//                                  (vegetation/drifts.js, vegetation/blooms.js)
//   litter        fallen leaves & pebbles                 (vegetation/litter.js)
//   framing       big fronds & broad leaves rising into the lower corners of
//                 every spot shot, a fern fringe at the front edge
//   no bare floor a gap-filling pass: a big hole a composed shot still shows
//                 gets a small clump (never a lone tuft) unless the floor
//                 dresses it already; beyond the wall (r > 35) big fern
//                 drifts, broad leaves and bushes
//   tree feet     mossy root runs snaking out of the giants' bases, stones the
//                 roots have lifted, shelf fungi under the broken snags
//   night magic   enchanted giants that read as mushrooms: gill glow graded
//                 from the stem (bright) to the rim (≈ 30 %) with faint lamellae,
//                 the upper stem, skirt and cap rim lit by it (an additive glow
//                 sheath), a halo tucked under the cap, milky spots and a silver
//                 moon rim on the dome, a teal light pool on the moss beneath;
//                 will-o'-the-wisp mushroom clusters along the paths, the
//                 fairy ring (a true circle of glowing bonnets in graded sizes
//                 on a band of glowing moss, cool light pooling on the ground),
//                 trails of glowing moss & bonnets along roots and path edges
//                 (vegetation/fairyRing.js), fairy lights spiralling up two giants,
//                 warm lanterns hanging from the giants' broken limbs
//                 (vegetation/lanterns.js); the canopy dims to moonlit
//                 silhouettes with a silver rim (common.moonlit)
//   secrets       a fairy ring (hotspot), snail stones for the wild snails
//
// Memory: our static meshes drop their CPU vertex arrays once uploaded
// (common.freeAfterUpload) and the builders / placement lists are released at
// the end of the build (the closures handed out keep this scope alive).
// Props: nothing grows through the colliders registered before us (the
// Schreinerei yard's sawhorses, drying stack … — zones.setPropKeep).
//
// Quality tiers: medium & low draw far less — counts follow density, the
// tree-foot & framing loops √density, and detailK / FERN_T thin trunk, cap and
// stem segments, fern fronds, grass cards and flower communities. Budgets:
// VEG_BUDGET (stats.budget / stats.overBudget, result.budget).
//
// Triangle budget: detail follows zones.viewDistance() — how close any
// reachable camera pose (spot shots swung through their orbit ranges, the
// overview) comes to a thing while seeing it. Far trees and mushrooms get
// fewer segments, far big ferns become the lighter medium fern; small ferns
// and short grass are the medium fern / grass template scaled down.
//
// Placement (vegetation/zones.js): only on free forest floor — never on
// paths, pads (and the dressed rings around them), the stream & its banks,
// the pond, the waterfall outcrop or the Great Oak's root zone — and nothing
// tall may stand in any spot camera's line of sight (plain, -wide, -close;
// framing plants are tested against the spots' SUBJECTS instead).
// Counts scale with ctx.quality.density.
//
// Result (ctx.modules.vegetation; also ctx.forest):
//   { trees: [{x,z,y0,radius,height,kind,crownY,crownR}], giants: [{x,y,z,H,R}],
//     canopy: [{x,y,z,r}] (leaf-mass spheres), flowerPatches: [{x,y,z,r,kind}],
//     glowSpots: [{x,y,z}], mossyRocks: [{x,y,z,r}], snailRocks, logs, stumps,
//     fairyRing: {x,y,z,r}, treesNear(x, z, radius, out), stats (incl. timing:
//     ms per section) }. Each giant's cap is also an empty 'giant-cap' Object3D
//     with userData { capRadius, rimY, height } (an exact camera obstacle).
//   The riverside escarpment (scene/riverside/ridge.js) is kept free: canGrow
//   refuses wherever the ridge stands > 0.1 above the floor (zones.setRidgeTest).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { getHeight, getPathDistance, getStreamDistance, pathPolylines } from './ground.js';
import { STREAM, SPOTS, RIVERSIDE, OAK } from './layout.js';
import { glowQuads, lightPools } from '../props/glow.js';
import { fieldMid, fieldFine, fieldAlt, groundPatches, GeoBuilder, instanced, staticMesh, moonlit, moonRim, nightPetals, freeAfterUpload, TAU } from './vegetation/common.js';
import { canGrow, isClearOfViews, isClearOfSubjects, blocksView, oakDist, cameraClearance, viewDistance, viewDetail, inShot, inNearField, setRidgeTest, setPropKeep } from './vegetation/zones.js';
import { buildDrifts } from './vegetation/drifts.js';
import { pickRingSite, buildFairyRing, buildGlowTrails, glowMossMesh, updateGlowMoss } from './vegetation/fairyRing.js';
import { forestPlan } from './vegetation/plan.js';
import { canopyLanterns } from './vegetation/lanterns.js';
import { buildLitter } from './vegetation/litter.js';
import { buildTree, clumpTemplate } from './vegetation/trees.js';
import { MushroomKit, CAP_REDS, CAP_BROWNS, CAP_OCHRES, CAP_TANS, updateMushroomGlow } from './vegetation/mushrooms.js';
import { placeFamily, pickWeighted, SPECIES } from './vegetation/families.js';
import { mossyRock, mossMound, fallenLog, smallRoot, twig, stump, setGroundDetail, BARK_MEAN } from './vegetation/groundcover.js';
import { fernTemplate, grassTemplate, cloverTemplate, flowerTemplate, broadleafTemplate, bilberryTemplate, brambleTemplate, FLOWER_KINDS } from './vegetation/plants.js';

/**
 * Triangle budgets per quality tier (checked into stats.overBudget; ctx.modules.vegetation.budget).
 * (Round 4 raised them by ≈ 40k / 50k / 25k for the flower drifts, hydrangeas,
 * the fairy ring's glowing moss and the night glow trails — the whole scene
 * stays well under its 2.5 M budget.)
 */
export const VEG_BUDGET = { high: 740000, medium: 410000, low: 295000 };

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

/** Falls frame of the riverside escarpment (scene/riverside/ridge.js): origin, u and w axes in (x, z). */
const RIDGE_FRAME = { x: 17.81, z: -13.15, u: [0.89, 0.455], w: [-0.455, 0.89] };
/** canGrow's ridge test: true where the escarpment stands > 0.1 above the floor (at the point or within margin). */
function ridgeTestFor(ridgeHeight) {
  const F = RIDGE_FRAME;
  const above = (x, z) => {
    const dx = x - F.x, dz = z - F.z;
    const u = dx * F.u[0] + dz * F.u[1], w = dx * F.w[0] + dz * F.w[1];
    if (Math.abs(u) > 17 || w < -27 || w > 11) return false;
    const g = getHeight(x, z);
    return ridgeHeight(u, w, g) - g > 0.1;
  };
  return (x, z, margin = 0) => {
    if (above(x, z)) return true;
    if (margin < 0.15) return false;
    return above(x + margin, z) || above(x - margin, z) || above(x, z + margin) || above(x, z - margin);
  };
}

/** Right behind the Great Oak as the front cameras see it (a cap there shows through the stair landing). */
const behindOak = (x, z) => z < OAK.z - 11 && Math.abs(x - OAK.x) < 7 + (OAK.z - z - 11) * 0.25;

export default async function build(ctx) {
  const t0 = performance.now();
  const q = ctx.quality ?? {};
  const density = THREE.MathUtils.clamp(q.density ?? 1, 0.25, 1.5);
  const tier = q.tier ?? 'high';
  // geometric detail per tier (phones & 2-core machines draw far less):
  // segments of trunks, caps & stems, fern fronds, flower communities
  const detailK = { high: 1, medium: 0.8, low: 0.65 }[tier] ?? 1;
  // placement loops that density alone does not thin (tree feet, framing)
  const thinK = Math.min(1, Math.sqrt(density));
  const M = ctx.materials;
  const rng = createRng('vegetation');
  const group = new THREE.Group();
  group.name = 'vegetation';
  ctx.scene.add(group);
  const occ = new Occupancy(2);
  setGroundDetail(tier);
  const stats = { drawCalls: 0, triangles: 0, instances: 0, meshes: {} };
  // (build time per section, ms — stats.timing)
  const timing = {};
  let tLap = performance.now();
  const lap = (k) => {
    const n = performance.now();
    timing[k] = Math.round(n - tLap);
    tLap = n;
  };
  // (our own static meshes: their CPU-side vertex arrays are freed after upload)
  const owned = [];
  const addMesh = (m) => {
    if (!m) return null;
    group.add(m);
    owned.push(m);
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
  let ringInfo = null;
  const mossyRocks = [];
  const logs = [];

  // ── 1. the forest wall ────────────────────────────────────────────────────
  const plan = forestPlan();
  // the riverside escarpment covers the floor well beyond the falls' outcrop:
  // nothing of ours grows where the ridge stands > 0.1 above the ground (the
  // plan above is memoised first — its trees stay the ones the riverside saw)
  try {
    const { ridgeHeight } = await import('../scene/riverside/ridge.js');
    if (typeof ridgeHeight === 'function') setRidgeTest(ridgeTestFor(ridgeHeight));
  } catch (err) {
    console.warn('[vegetation] no ridge test', err);
  }
  // …nor through the other builders' props (the Schreinerei yard's sawhorses,
  // drying stack, handcart …: every collider registered before us)
  setPropKeep(ctx.colliders);
  // (bark is vertex-coloured: moss creeping up the trunks, mossy roots & logs)
  const builders = { bark: new GeoBuilder(BARK_MEAN), birch: new GeoBuilder(), ivy: new GeoBuilder() };
  const clumps = [];
  for (const t of plan.trees) {
    // (giants no lens ever comes close to are built with fewer segments)
    t.lod = viewDetail(t.x, t.y0 + 5, t.z, { r: t.radius * 1.8, near: 16, far: 32, min: 0.55 }) * (tier === 'high' ? 1 : tier === 'medium' ? 0.75 : 0.6);
    buildTree(t, builders, clumps, { density });
    occ.add(t.x, t.z, t.radius * 1.6, 'tree');
  }
  // the fairy ring's circle is reserved before anything else grows (the ring
  // itself is built in 4c); the undergrowth around it stays low
  const ringSite = pickRingSite();
  if (ringSite) occ.add(ringSite.x, ringSite.z, ringSite.r + 0.35, 'fairy-ring');
  const nearRing = (x, z, d) => !!ringSite && Math.hypot(x - ringSite.x, z - ringSite.z) < ringSite.r + d;
  lap('trees');
  // the canopy clump template (also used for the forest-edge bushes below)
  // (round 5: 62 cards on high, a touch bigger — the canopy & bushes read as masses from afar)
  const clumpGeo = clumpTemplate(rng.fork('clump'), tier === 'low' ? 44 : tier === 'medium' ? 52 : 62, { size: tier === 'low' ? [0.37, 0.52] : tier === 'medium' ? [0.35, 0.49] : [0.33, 0.48] });

  // ── 2. giant fly agarics ──────────────────────────────────────────────────
  // (the small kit writes its gills, warts and glowing parts into the giant
  //  kit's builders: one draw per part for the whole mushroom kingdom)
  const giantKit = new MushroomKit(rng.fork('giants'), { detail: detailK });
  const smallKit = new MushroomKit(rng.fork('small'), { share: giantKit, detail: detailK });
  const kits = { big: giantKit, small: smallKit };
  const mushLod = (x, y, z, r) => viewDetail(x, y, z, { r, near: 10, far: 28, min: 0.5 }) * detailK * detailK;
  /** Ground test for a family member: free forest floor, clear of solids; tall ones out of the spot views. */
  const groundFor = (minClear = 0.12, { path = 1.25 } = {}) => (x, z, h) => {
    if (!canGrow(x, z, { path })) return null;
    if (occ.clearance(x, z, 2) < minClear) return null;
    const y = getHeight(x, z);
    if (h > 0.6 && !isClearOfViews(x, y, z, h * 1.1, h * 0.5)) return null;
    return y;
  };
  // (which mushrooms are enchanted is decided by its own random stream, so the
  //  placement of everything else stays exactly as it was)
  const grng = createRng('vegetation:glow');
  const giants = [];
  // (a soft teal pool of light on the ground under every enchanted giant: its
  //  gills light the moss beneath it at night)
  const giantPools = [];
  /**
   * The cap of a giant as an exact camera obstacle: an empty marker at the
   * cap's centre (the stem leans) on the ground's height, with userData
   * capRadius / rimY / height (systems/cameraObstacles.js reads those).
   */
  const capMarker = (cap, y, R, droop = 0) => {
    const m = new THREE.Object3D();
    m.name = 'giant-cap';
    m.position.set(cap.top.x, y, cap.top.z);
    m.userData = { capRadius: R, rimY: cap.top.y - y - droop - R * 0.05, height: cap.capTop - y };
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    group.add(m);
  };
  const tryGiant = (x, z, H, opts = {}) => {
    const R = opts.capR ?? H * rng.range(0.42, 0.6);
    if (!canGrow(x, z, { margin: Math.min(1.2, R * 0.35) })) return false;
    if (!occ.free(x, z, R * 0.75)) return false;
    for (const g of giants) if (Math.hypot(g.x - x, g.z - z) < (g.R + R) * 0.8) return false;
    const y = getHeight(x, z);
    if (!isClearOfViews(x, y, z, H + R * 0.5, R * 0.95)) return false;
    // the giants come in several colours (refs: red fly agarics beside ochre and
    // tan ones on the mossy mound); the avenue keeps mostly red
    let hue = opts.hue ?? pickWeighted(rng, { red: 60, ochre: 22, tan: 8, brown: 10 });
    // (beside the Velowerkstatt a pale giant read as a garden birdbath: a fly agaric there)
    if (hue !== 'red' && Math.hypot(x - RIVERSIDE.bikeShed.x, z - RIVERSIDE.bikeShed.z) < 9) hue = 'red';
    const red = hue === 'red';
    const shape = opts.shape ?? (rng.chance(0.04) ? 'cone' : rng.chance(red ? 0.06 : 0.16) ? 'upturned' : rng.chance(0.3) ? 'flat' : 'dome');
    // enchanted giants: their gills glow soft mint at night, the spots faintly
    // (most of them, so the night glen keeps its fly agarics; never all)
    const glowGills = grng.chance(red ? 0.62 : 0.8);
    const glowSpotsOn = glowGills && red && grng.chance(0.85);
    // (right behind the Great Oak a red cap glowed through the stair-landing
    //  gap in the glen and Schreinerei shots: those get a dark panther-brown
    //  cap and no night glow — the same random draws, so nothing else moves)
    const hidden = behindOak(x, z);
    if (glowGills && !hidden) glowSpots.push({ x, y: y + H * 0.8, z });
    let caps = { red: CAP_REDS, ochre: CAP_OCHRES, tan: CAP_TANS, brown: CAP_BROWNS }[hue];
    if (hidden && hue !== 'tan') caps = ['#7a5232', '#6e4a2c', '#84603c'];
    const giantLod = viewDetail(x, y + H * 0.6, z, { r: R, near: 12, far: 32, min: 0.6 }) * detailK;
    if (hue === 'tan') {
      // the pale giants are PARASOLS — a family of different ages: the lead
      // fully open, a half-open bell and a young drumstick or two, leaning out
      const capC = rng.pick(caps);
      const leanAz0 = opts.leanAz ?? rng.range(0, TAU);
      const prng = giantKit.rng;
      const lead = giantKit.parasol(x, y, z, { height: H * 1.08, capR: R * 1.05, age: 1, lean: prng.range(0.05, 0.14), leanAz: leanAz0, color: capC, lod: giantLod });
      const kids = 1 + Math.floor(prng.next() * 3);
      for (let k = 0; k < kids; k++) {
        const a = leanAz0 + Math.PI + prng.jitter(1.6), d = R * prng.range(0.55, 1.0);
        const kx = x + Math.sin(a) * d, kz = z + Math.cos(a) * d;
        const age = k === 0 ? prng.range(0.45, 0.7) : prng.range(0.1, 0.3);
        const kh = H * (age > 0.4 ? prng.range(0.6, 0.78) : prng.range(0.32, 0.48));
        const ky = groundFor(0.1)(kx, kz, kh);
        if (ky === null) continue;
        giantKit.parasol(kx, ky, kz, { height: kh, capR: kh * 0.5, age, lean: prng.range(0.08, 0.22), leanAz: a + prng.jitter(0.4), color: capC, lod: giantLod });
        occ.add(kx, kz, kh * 0.15, 'giant');
      }
      occ.add(x, z, R * 0.45, 'giant');
      giants.push({ x, y, z, H, R, hue, rimY: lead.top.y - y - R * 0.13, capTop: lead.capTop - y });
      capMarker(lead, y, R * 1.05, R * 0.13);
      return true;
    }
    const cap = giantKit.amanita(x, y, z, {
      height: H,
      capR: shape === 'upturned' ? R * 1.08 : R,
      shape,
      color: rng.pick(caps),
      lean: rng.range(0.02, 0.16),
      leanAz: opts.leanAz ?? rng.range(0, TAU),
      warts: red ? 1 : hue === 'tan' ? 0.5 : 0.75,
      wartColor: red ? undefined : '#f2ecdc',
      gillColor: red ? '#f2e6cc' : '#ead6b0',
      glowGills: glowGills && !hidden,
      glowSpots: glowSpotsOn && !hidden,
      haloK: 1.2,
      lod: giantLod,
    });
    occ.add(x, z, R * 0.45, 'giant');
    giants.push({ x, y, z, H, R, hue, rimY: cap.top.y - y, capTop: cap.capTop - y });
    if (glowGills && !hidden) giantPools.push({ x: cap.top.x, y, z: cap.top.z, size: R * 1.75, color: '#72e6c6', strength: 0.36, lamp: false, rings: 5, segs: 18 });
    capMarker(cap, y, shape === 'upturned' ? R * 1.08 : R);
    // a family of little ones at its foot (its own kind, now and then a stranger)
    const kidSpecies = rng.chance(0.75) ? { red: hidden ? 'panther' : 'flyAgaric', ochre: 'ochre', brown: 'panther' }[hue] : pickWeighted(rng, { bolete: 2, bonnets: 1, orange: 1 });
    const ka = rng.range(0, TAU), kd = R * rng.range(0.62, 0.85);
    placeFamily(kits, rng, x + Math.sin(ka) * kd, z + Math.cos(ka) * kd, {
      species: kidSpecies,
      side: ka,
      size: rng.range(0.22, 0.5) * Math.min(1.6, H / 2.5),
      count: rng.int(2, 5),
      spread: Math.max(1, R * 0.8),
      lod: mushLod(x, y, z, R),
      glow: glowGills && grng.chance(0.4),
      grng,
      ground: groundFor(0.15),
    });
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
        tryGiant(x, z, Math.min(5.6, H), { leanAz: Math.atan2(tz * side, -tx * side), hue: pickWeighted(rng, { red: 75, ochre: 15, brown: 10 }) });
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
          // (the edge clusters mix colours: red beside ochre, tan and brown)
          if (tryGiant(x + rng.jitter(1), z + rng.jitter(1), rng.range(1.5, 5) * (k === 0 ? 1 : 0.7) * (tries ? 0.8 : 1), { hue: pickWeighted(rng, { red: 42, ochre: 30, tan: 13, brown: 15 }) })) {
            made++;
            break;
          }
        }
      }
    }
  }

  lap('giants');
  // (c) mushroom families of every species (the fly-agaric forest path): one
  //     big lead, a huddle of smaller ones, buttons at their feet — along the
  //     path edges and at the glen's edges (more at tree feet, logs, stumps
  //     and rocks below, once those exist)
  const troops = [];
  const familyAt = (cx, cz, opts = {}) => {
    // (lower tiers: fewer families — the giants and the clumps carry the shot)
    if (thinK < 1 && !opts.keep && rng.next() > thinK) return false;
    if (!canGrow(cx, cz, { margin: 0.25, path: opts.path ?? 1.25 })) return false;
    if (troops.some((t) => Math.hypot(t.x - cx, t.z - cz) < (opts.gap ?? 3.0))) return false;
    if (occ.clearance(cx, cz, 2) < (opts.minClear ?? 0.15)) return false;
    const glowing = grng.chance(0.3);
    const size = opts.size ?? (rng.chance(0.3) ? rng.range(0.75, 1.3) : rng.range(0.32, 0.75));
    const placed = placeFamily(kits, rng, cx, cz, {
      species: opts.species,
      size,
      side: opts.side,
      spread: opts.spread,
      lod: mushLod(cx, getHeight(cx, cz) + 0.5, cz, 1.5),
      glow: glowing,
      grng,
      ground: opts.ground ?? groundFor(0.12, { path: opts.path ?? 1.25 }),
      onPlace: (x, z, h) => occ.add(x, z, Math.max(0.05, h * 0.18), 'toadstool'),
    });
    if (!placed) return false;
    troops.push({ x: cx, z: cz });
    if (glowing) glowSpots.push({ x: cx, y: getHeight(cx, cz) + size * 0.8, z: cz });
    return true;
  };
  {
    // along the paths (outside the pads' dressed rings, in the frames' margins)
    for (const p of pathPolylines) {
      for (let i = 0; i < p.pts.length; i += 3) {
        if (!rng.chance(p.id === 'main' ? 0.4 : 0.22)) continue;
        const q = p.pts[i], nx = p.pts[Math.min(p.pts.length - 1, i + 1)], pv = p.pts[Math.max(0, i - 1)];
        let tx = nx.x - pv.x, tz = nx.z - pv.z;
        const l = Math.hypot(tx, tz) || 1;
        tx /= l;
        tz /= l;
        const side = rng.chance(0.5) ? 1 : -1;
        const off = p.halfWidth * rng.range(1.6, 2.5);
        // (the family spreads along the path edge, away from the path)
        familyAt(q.x - tz * off * side, q.z + tx * off * side, { side: Math.atan2(-tz * side, tx * side), path: 1.15 });
      }
    }
    // the feet of the forest giants: a family in the lee of a buttress
    for (const t of plan.trees) {
      if (t.kind === 'birch' || Math.hypot(t.x, t.z) > 33 || !rng.chance(0.7)) continue;
      const fams = rng.int(1, 2);
      for (let f = 0; f < fams; f++) {
        const a = rng.range(0, TAU), d = t.radius * rng.range(1.75, 2.3);
        familyAt(t.x + Math.sin(a) * d, t.z + Math.cos(a) * d, { side: a, gap: 2.2, minClear: 0.08 });
      }
    }
    // the glen's edges
    for (let k = 0; k < 160 && troops.length < Math.round(44 * Math.min(1.2, density)); k++) {
      const az = rng.range(-Math.PI, Math.PI);
      const r = rng.range(11, 29);
      familyAt(Math.sin(az) * r, Math.cos(az) * r);
    }
  }

  lap('families');
  // ── 3. rocks, moss mounds, logs, roots, twigs ─────────────────────────────
  const rockB = new GeoBuilder();
  const moundB = new GeoBuilder();
  // (twigs & small roots go into the forest bark: same material, one draw)
  const smallBarkB = builders.bark;
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
  const logFamilies = [];
  for (let k = 0; k < 80 && logs.length < Math.round(6 * density + 1); k++) {
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
    logFamilies.push({ log, lr, yaw });
  }
  // old saw-cut stumps with growth rings (a woodworker's glen: someone felled
  // a tree here long ago — moss, brackets and toadstools have moved in)
  const stumpFaceB = new GeoBuilder();
  const stumps = [];
  for (let k = 0; k < 60 && stumps.length < Math.max(2, Math.round(6 * density)); k++) {
    const az = rng.range(-Math.PI, Math.PI);
    const r = rng.range(12, 27);
    const x = Math.sin(az) * r, z = Math.cos(az) * r;
    const sr = rng.range(0.4, 0.85), h = rng.range(0.3, 0.75);
    if (!canGrow(x, z, { margin: sr + 0.4 }) || !occ.free(x, z, sr + 0.3)) continue;
    if (!isClearOfViews(x, getHeight(x, z), z, h, sr)) continue;
    const st = stump(builders.bark, stumpFaceB, rng, x, z, sr, h);
    occ.add(x, z, sr * 1.2, 'stump');
    stumps.push(st);
    for (const b of st.brackets) giantKit.bracket(b.p, b.n, { size: sr * rng.range(0.35, 0.55) });
    // a bonnet tuft on the cut face now and then, a mushroom family at its foot
    if (rng.chance(0.5)) smallKit.bonnets(x + rng.jitter(sr * 0.4), st.top, z + rng.jitter(sr * 0.4), { height: 0.1, count: rng.int(3, 5) });
    if (rng.chance(0.7)) {
      const a = rng.range(0, TAU);
      familyAt(x + Math.sin(a) * (sr * 1.35 + 0.15), z + Math.cos(a) * (sr * 1.35 + 0.15), { side: a, gap: 1.5, minClear: 0.04, size: rng.range(0.25, 0.55), species: pickWeighted(rng, { bolete: 3, bonnets: 2, ochre: 2, panther: 1, orange: 1, flyAgaric: 1 }) });
    }
  }
  // families along the fallen logs: on the flank in the moss, where the wood rots
  for (const { log, lr, yaw } of logFamilies) {
    const n = rng.int(1, 2);
    for (let i = 0; i < n; i++) {
      const p = log.pts[rng.int(1, log.pts.length - 2)];
      const side = rng.chance(0.5) ? 1 : -1;
      const nx = Math.cos(yaw) * side, nz = -Math.sin(yaw) * side;
      const d = lr * 1.15 + 0.12;
      familyAt(p.x + nx * d, p.z + nz * d, { side: Math.atan2(nx, nz), gap: 1.2, minClear: 0.02, size: rng.range(0.25, 0.6), species: pickWeighted(rng, { bonnets: 2, bolete: 2, ochre: 2, orange: 2, flyAgaric: 1, panther: 1 }) });
    }
  }
  // brackets on the tree trunks: low tiers by the roots, a staircase of big
  // shelves climbing the bare columns
  for (const t of plan.trees) {
    if (t.kind === 'birch' || !rng.chance(0.7)) continue;
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU);
      const y = rng.chance(0.6) ? rng.range(0.8, 3.5) : rng.range(4, 11);
      // (on the sculpted bark when the tree exposes it)
      const c = t.centerAt ? t.centerAt(y) : new THREE.Vector3(t.x, t.y0 + y, t.z);
      const r = (t.radiusAt ? t.radiusAt(y, a) : t.radius) * 1.02;
      const nrm = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      giantKit.bracket(new THREE.Vector3(c.x + nrm.x * r, c.y, c.z + nrm.z * r), nrm, { size: rng.range(0.25, 0.5) * (y > 4 ? 1.5 : 1), tiers: rng.int(2, 4) });
    }
  }
  // shelf fungi on the bark just under the giants' broken snags (the wound
  // where the branch broke off is where they move in)
  {
    const srng = createRng('vegetation:snags');
    for (const t of plan.trees) {
      if (t.kind === 'birch' || !t.stubs || !t.centerAt) continue;
      for (const st of t.stubs) {
        if (!srng.chance(0.6)) continue;
        const y = st.y - srng.range(0.35, 0.8);
        const a = st.th + srng.jitter(0.25);
        const c = t.centerAt(y);
        const r = t.radiusAt(y, a) * 1.02;
        const nrm = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        giantKit.bracket(new THREE.Vector3(c.x + nrm.x * r, c.y, c.z + nrm.z * r), nrm, { size: srng.range(0.3, 0.5), tiers: srng.int(2, 3) });
      }
    }
  }
  // snail stones: mossy rocks placed where a spot camera can discover the wild
  // snails grazing on them (beside the main path in the Schreinerei's view,
  // by the bridge path in the Velowerkstatt's view)
  const snailRocks = [];
  for (const cands of [
    [[-2.6, 4.9], [-2.5, 5.4], [-3.0, 5.2], [1.6, 4.0]],
    [[6.4, 9.6], [5.6, 10.2], [7.0, 9.0], [3.6, 10.6]],
  ]) {
    for (const [x, z] of cands) {
      if (!canGrow(x, z, { margin: 0.3, path: 1.15 }) || !occ.free(x, z, 0.5)) continue;
      // (a pale, proud little boulder so the snail on it can be spotted)
      const res = mossyRock(rockB, rng, x, z, 0.55, { flat: 0.72, sink: 0.08, color: new THREE.Color('#c4bcac') });
      occ.add(x, z, res.r * 0.9, 'rock');
      const rock = { x, y: res.top, z, r: res.r };
      snailRocks.push(rock);
      mossyRocks.push(rock);
      break;
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
  for (let k = 0; k < Math.round(110 * density); k++) {
    const az = rng.range(-Math.PI, Math.PI);
    const r = Math.sqrt(rng.range(8 * 8, 36 * 36));
    const x = Math.sin(az) * r, z = Math.cos(az) * r;
    const w = rng.range(0.5, 1.7);
    if (!canGrow(x, z, { margin: w * 0.4 }) || !occ.free(x, z, w * 0.6)) continue;
    mossMound(moundB, rng, x, z, w, w * rng.range(0.16, 0.34), { color: new THREE.Color('#587630').lerp(new THREE.Color('#7c8f3c'), rng.next()).offsetHSL(rng.jitter(0.02), 0, rng.jitter(0.03)) });
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

  // mossy root runs snaking out of the giants' bases, and stones the roots
  // have lifted (their own random stream: the scatter after them stays put)
  const rootRuns = [];
  {
    const frng = createRng('vegetation:tree-feet');
    for (const t of plan.trees) {
      const tr = Math.hypot(t.x, t.z);
      if (t.kind === 'birch' || tr > 33) continue;
      const runs = Math.max(1, Math.round(frng.int(2, 4) * thinK));
      for (let i = 0; i < runs; i++) {
        const a = frng.range(0, TAU);
        const d0 = t.radius * frng.range(1.25, 1.6);
        const x = t.x + Math.sin(a) * d0, z = t.z + Math.cos(a) * d0;
        const len = frng.range(1.6, 3.4) * (t.radius > 2 ? 1.2 : 1);
        const yaw = a + frng.jitter(0.5);
        const ex = x + Math.sin(yaw) * len, ez = z + Math.cos(yaw) * len;
        if (!canGrow(ex, ez, { path: 1.15 }) || !canGrow(x, z, { path: 1.15 })) continue;
        smallRoot(builders.bark, frng, x, z, yaw, len, frng.range(0.09, 0.17) * Math.min(1.4, t.radius / 2), { mossy: true, seg: tier === 'low' ? 5 : 6 });
        rootRuns.push({ x, z, yaw, len });
      }
      if (tr > 30 || !frng.chance(0.65 * thinK + 0.2)) continue;
      const a = frng.range(0, TAU), d = t.radius * frng.range(1.45, 1.9);
      const x = t.x + Math.sin(a) * d, z = t.z + Math.cos(a) * d;
      const size = frng.range(0.3, 0.65);
      if (!canGrow(x, z, { margin: size * 0.5 }) || !isClearOfViews(x, getHeight(x, z), z, size * 0.7, size)) continue;
      const res = mossyRock(rockB, frng, x, z, size, { flat: frng.range(0.5, 0.7), color: new THREE.Color(frng.pick(rockTints)) });
      occ.add(x, z, res.r * 0.85, 'rock');
      mossyRocks.push({ x, y: res.top, z, r: res.r });
    }
  }

  lap('ground');
  // ── 3b. mid-scale ground structure: every lawn broken into little vignettes ──
  // (moss hummocks, small fallen logs with brackets & a mushroom family, old
  //  stumps, rock groups with moss caps, fern & foxglove clumps). Low things
  //  (≤ ~0.7) only have to keep out of the spots' SUBJECTS and away from the
  //  lenses; taller ones (ferns, foxgloves) out of the views. The undergrowth
  //  scatter below then grows around them.
  const vigFerns = [], vigFox = [], vigBroad = [];
  const vignettes = { hummocks: 0, logs: 0, stumps: 0, rocks: 0, ferns: 0, framing: 0 };
  {
    // (ankle-high ground detail is part of the overview's subject — the glen's
    //  dressed floor — so only the other spots' subject cones apply to it)
    const GLEN = ['glen'];
    const lowOk = (x, z, h, r) => cameraClearance(x, z) > 2.6 && isClearOfSubjects(x, getHeight(x, z), z, h, r, h < 0.85 ? GLEN : null) && !inNearField(x, getHeight(x, z) + h * 0.5, z, 0.3, 0.4);
    const tallOk = (x, z, h, r) => cameraClearance(x, z) > 4.2 && isClearOfViews(x, getHeight(x, z), z, h, r);
    const hummocks = (cx, cz) => {
      const n = rng.int(3, 5);
      let made = 0;
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, TAU), d = i ? rng.range(0.5, 1.4) : 0;
        const x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
        const w = rng.range(0.35, 0.85) * (i ? 0.85 : 1.15);
        const h = w * rng.range(0.38, 0.6);
        if (!canGrow(x, z, { margin: w * 0.3 }) || occ.clearance(x, z, 2) < w * 0.4 || !lowOk(x, z, h, w)) continue;
        mossMound(moundB, rng, x, z, w, h, { color: new THREE.Color('#567630').lerp(new THREE.Color('#82923e'), rng.next()).offsetHSL(rng.jitter(0.02), 0, rng.jitter(0.03)) });
        occ.add(x, z, w * 0.55, 'mound');
        made++;
      }
      // bonnets & a button or two tucked between the cushions
      if (made && rng.chance(0.6)) smallKit.bonnets(cx + rng.jitter(0.5), getHeight(cx, cz), cz + rng.jitter(0.5), { height: rng.range(0.09, 0.15), count: rng.int(3, 5) });
      vignettes.hummocks += made ? 1 : 0;
      return made > 0;
    };
    const smallLog = (cx, cz) => {
      const len = rng.range(1.6, 3.4), lr = rng.range(0.16, 0.34);
      const yaw = rng.range(0, TAU);
      for (const t of [-0.5, 0, 0.5]) {
        const px = cx + Math.sin(yaw) * len * t, pz = cz + Math.cos(yaw) * len * t;
        if (!canGrow(px, pz, { margin: lr + 0.2 }) || occ.clearance(px, pz, 2) < lr + 0.15 || !lowOk(px, pz, lr * 2, lr + 0.1)) return false;
      }
      const log = fallenLog(builders.bark, rng, cx, cz, len, lr, yaw);
      for (const t of [-0.5, -0.25, 0, 0.25, 0.5]) occ.add(cx + Math.sin(yaw) * len * t, cz + Math.cos(yaw) * len * t, lr, 'log');
      for (const b of log.brackets) giantKit.bracket(b.p, b.n, { size: lr * rng.range(0.45, 0.75) });
      logs.push({ x: cx, z: cz, len, r: lr, yaw });
      // a family on the flank, in the moss where the wood rots
      const p = log.pts[rng.int(1, log.pts.length - 2)];
      const side = rng.chance(0.5) ? 1 : -1;
      const nx = Math.cos(yaw) * side, nz = -Math.sin(yaw) * side;
      familyAt(p.x + nx * (lr + 0.15), p.z + nz * (lr + 0.15), { side: Math.atan2(nx, nz), gap: 1.2, minClear: 0.02, size: rng.range(0.2, 0.45), species: pickWeighted(rng, { bonnets: 3, bolete: 2, orange: 2, ochre: 1, flyAgaric: 1 }) });
      // a fern at one end
      const e = rng.chance(0.5) ? 0.62 : -0.62;
      vigFerns.push({ x: cx + Math.sin(yaw) * len * e, z: cz + Math.cos(yaw) * len * e, s: rng.range(0.7, 1.05) });
      vignettes.logs++;
      return true;
    };
    const oldStump = (cx, cz) => {
      const sr = rng.range(0.28, 0.55), h = rng.range(0.25, 0.6);
      if (!canGrow(cx, cz, { margin: sr + 0.3 }) || occ.clearance(cx, cz, 2) < sr + 0.25 || !lowOk(cx, cz, h, sr)) return false;
      const st = stump(builders.bark, stumpFaceB, rng, cx, cz, sr, h);
      occ.add(cx, cz, sr * 1.2, 'stump');
      stumps.push(st);
      for (const b of st.brackets) giantKit.bracket(b.p, b.n, { size: sr * rng.range(0.35, 0.55) });
      if (rng.chance(0.55)) smallKit.bonnets(cx + rng.jitter(sr * 0.4), st.top, cz + rng.jitter(sr * 0.4), { height: 0.09, count: rng.int(3, 5) });
      const a = rng.range(0, TAU);
      familyAt(cx + Math.sin(a) * (sr * 1.35 + 0.12), cz + Math.cos(a) * (sr * 1.35 + 0.12), { side: a, gap: 1.2, minClear: 0.02, size: rng.range(0.2, 0.42) });
      vignettes.stumps++;
      return true;
    };
    const rockGroup = (cx, cz) => {
      const n = rng.int(2, 4);
      let made = 0;
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, TAU), d = i ? rng.range(0.45, 1.0) : 0;
        const x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
        const size = i ? rng.range(0.14, 0.3) : rng.range(0.3, 0.6);
        const flat = rng.range(0.55, 0.85);
        if (!canGrow(x, z, { margin: size * 0.4 }) || occ.clearance(x, z, 2) < size * 0.8 || !lowOk(x, z, size * flat, size)) continue;
        const res = mossyRock(rockB, rng, x, z, size, { flat, color: new THREE.Color(rng.pick(rockTints)) });
        occ.add(x, z, res.r * 0.85, 'rock');
        mossyRocks.push({ x, y: res.top, z, r: res.r });
        made++;
        // a moss cushion creeping against the big one
        if (!i && rng.chance(0.6)) {
          const b = a + Math.PI + rng.jitter(0.6), w = size * rng.range(0.7, 1.1);
          const mx = x + Math.sin(b) * size * 0.85, mz = z + Math.cos(b) * size * 0.85;
          if (canGrow(mx, mz)) mossMound(moundB, rng, mx, mz, w, w * 0.35, { color: new THREE.Color('#56742c').offsetHSL(rng.jitter(0.02), 0, rng.jitter(0.03)) });
        }
      }
      // ferns or a foxglove in the lee of the stones
      if (made && rng.chance(0.65)) {
        const a = rng.range(0, TAU);
        const x = cx + Math.sin(a) * 0.9, z = cz + Math.cos(a) * 0.9;
        if (rng.chance(0.6)) vigFerns.push({ x, z, s: rng.range(0.75, 1.15) });
        else vigFox.push({ x, z, s: rng.range(1.0, 1.35) });
      }
      vignettes.rocks += made ? 1 : 0;
      return made > 0;
    };
    const fernClump = (cx, cz) => {
      const n = rng.int(2, 4);
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, TAU), d = i ? rng.range(0.6, 1.2) : 0;
        vigFerns.push({ x: cx + Math.sin(a) * d, z: cz + Math.cos(a) * d, s: rng.range(0.9, 1.4) * (i ? 0.85 : 1) });
      }
      const f = rng.int(0, 2);
      for (let i = 0; i < f; i++) {
        const a = rng.range(0, TAU), d = rng.range(0.4, 1.1);
        vigFox.push({ x: cx + Math.sin(a) * d, z: cz + Math.cos(a) * d, s: rng.range(1.0, 1.45) });
      }
      if (rng.chance(0.4)) vigBroad.push({ x: cx + rng.jitter(1.2), z: cz + rng.jitter(1.2), s: rng.range(1.1, 1.6) });
      vignettes.ferns++;
      return true;
    };

    // the framing log of the wide overview (glen-wide, a phone's zoomed-out
    // glen): a big mossy trunk lying across the bottom of the frame, a family of
    // mushrooms on its back, ferns at its broken ends
    {
      const cx = 2.5, cz = 36.4, len = 15, lr = 0.95, yaw = Math.PI / 2 + 0.06;
      const log = fallenLog(builders.bark, rng, cx, cz, len, lr, yaw);
      for (let t = -0.5; t <= 0.5; t += 0.125) occ.add(cx + Math.sin(yaw) * len * t, cz + Math.cos(yaw) * len * t, lr, 'log');
      for (const b of log.brackets) giantKit.bracket(b.p, b.n, { size: lr * rng.range(0.4, 0.6), tiers: rng.int(2, 3) });
      for (let k = 0; k < 3; k++) {
        const p = log.pts[Math.round(log.pts.length * (0.2 + k * 0.28 + rng.jitter(0.05)))];
        giantKit.bracket(p.clone().add(new THREE.Vector3(0, rng.range(-0.1, 0.25), lr * 0.9)), new THREE.Vector3(0, 0, 1), { size: rng.range(0.3, 0.5), tiers: rng.int(2, 4) });
      }
      logs.push({ x: cx, z: cz, len, r: lr, yaw });
      // on its back: the axis height under (x, z) (the log hugs the ground)
      const top = (x, z) => {
        let best = null, bd = Infinity;
        for (const p of log.pts) {
          const d = Math.hypot(p.x - x, p.z - z);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        return bd < lr * 0.45 ? best.y + lr * 0.88 : null;
      };
      for (const [f, sp, size] of [[0.3, 'flyAgaric', 0.85], [0.62, 'ochre', 0.6], [0.8, 'bonnets', 0.3]]) {
        const p = log.pts[Math.round((log.pts.length - 1) * f)];
        placeFamily(kits, rng, p.x, p.z, { species: sp, size, count: rng.int(3, 5), spread: 0.7, ground: (x, z) => top(x, z), lod: 1, glow: grng.chance(0.5), grng });
      }
      // in the moss at its foot
      for (const f of [0.12, 0.48, 0.9]) {
        const p = log.pts[Math.round((log.pts.length - 1) * f)];
        familyAt(p.x + rng.jitter(0.4), p.z - lr - 0.35, { side: Math.PI, gap: 1.0, minClear: 0.02, path: 0, size: rng.range(0.3, 0.6), ground: groundFor(0.02, { path: 0 }), keep: true });
      }
      for (const e of [-0.56, 0.56]) vigFerns.push({ x: cx + Math.sin(yaw) * len * e, z: cz + Math.cos(yaw) * len * e, s: rng.range(1.5, 1.9), keep: true });
      vignettes.framing = 1;
    }

    // scatter the vignettes over every lawn a composed shot shows (the open
    // glen and the front band the wide views look over)
    const spots = [];
    const SP = 3.1 / Math.sqrt(Math.min(1, density));
    for (let gz = -34; gz < 46; gz += SP) {
      for (let gx = -38; gx < 38; gx += SP) {
        const x = gx + rng.range(0, SP), z = gz + rng.range(0, SP);
        const r = Math.hypot(x, z);
        if (r < 7 || r > (z > 18 ? 46 : 33)) continue;
        if (!rng.chance(z > 30 ? 0.55 : 0.7)) continue;
        if (!canGrow(x, z, { margin: 0.5 }) || occ.clearance(x, z, 3) < 0.8) continue;
        if (!inShot(x, getHeight(x, z) + 0.3, z, 1.0)) continue;
        if (spots.some((p) => Math.hypot(p.x - x, p.z - z) < 2.6)) continue;
        spots.push({ x, z });
        const shady = r > 21 || oakDist(x, z) < 13;
        const pd = getPathDistance(x, z);
        const damp = getStreamDistance(x, z) < 7;
        const w = pd < 2.6
          ? { rocks: 3, ferns: 2, hummocks: 2, stump: 0.5, log: 0.5 }
          : damp
            ? { ferns: 4, hummocks: 2, rocks: 1, log: 1 }
            : shady
              ? { log: 2.5, stump: 1.5, ferns: 3, rocks: 2, hummocks: 2 }
              : { hummocks: 3, rocks: 2.5, ferns: 2, log: 1.5, stump: 1.2 };
        const kind = pickWeighted(rng, w);
        if (kind === 'hummocks') hummocks(x, z);
        else if (kind === 'rocks') rockGroup(x, z);
        else if (kind === 'log') smallLog(x, z) || hummocks(x, z);
        else if (kind === 'stump') oldStump(x, z) || rockGroup(x, z);
        else if (tallOk(x, z, 1.1, 0.9)) fernClump(x, z);
        else hummocks(x, z);
      }
    }
    vignettes.spots = spots.length;
    stats.vignettes = vignettes;
  }

  lap('vignettes');
  // ── 3c. colour on the floor: flower drifts along the paths, at the houses'
  //     feet and in the lawn wedges (blue, white, pink, yellow), hydrangeas,
  //     ochre & russet leaf drifts, the signpost at the fork
  //     (vegetation/drifts.js, vegetation/blooms.js)
  const flowerMat = M.surface('leaf', { vertexColors: true, side: THREE.DoubleSide, wind: { strength: 0.14, base: 0.03, speed: 1.5 } });
  // (petals need a NEUTRAL texture: the leaf map's green survives its white
  //  normalisation, so blue, white, pink and yellow petals came out olive — the
  //  paper map normalises to white, the vertex colours alone set the hues)
  // (at night the blue petals desaturate & darken, each catching a moon glint: common.nightPetals)
  const petalMat = nightPetals(M.surface('paper', { vertexColors: true, side: THREE.DoubleSide, wind: { strength: 0.14, base: 0.03, speed: 1.5 } }));
  const shrubMat = nightPetals(M.surface('paper', { vertexColors: true, side: THREE.DoubleSide }));
  const drifts = buildDrifts(ctx, { occ, density, tier, flowerMat: petalMat, leafMat: shrubMat, ringAt: ringSite });
  flowerPatches.push(...drifts.flowerPatches.slice(0, Math.max(0, 460 - flowerPatches.length)));
  for (const o of drifts.objects) group.add(o);
  stats.drifts = drifts.stats;
  // the drifts tint the ground under them with their colour — only under the
  // flower heads, and only faintly (round 4's wider, stronger wash read from
  // the overview as pastel paint smears on a flat carpet, not as flowers)
  ctx.modules?.terrain?.paintBlooms?.(drifts.zones.map((d) => ({ ...d, hl: d.hl * 1.1, hw: d.hw * 1.0, k: d.k * 0.35 })));
  // (inside a drift only low things grow: big ferns & bushlets would hide it)
  const inDrift = (x, z) => {
    for (const d of drifts.zones) {
      const dx = x - d.x, dz = z - d.z;
      if (dx * dx + dz * dz > d.R2) continue;
      const u = (dx * d.ax + dz * d.az) / d.hl, v = (dx * d.az - dz * d.ax) / d.hw;
      if (u * u + v * v < 1) return true;
    }
    return false;
  };

  // ── 4. undergrowth scatter ────────────────────────────────────────────────
  const fernL = [], fernM = [];
  const grassA = [];
  // (the small ferns and the short grass tufts are the medium fern / the
  //  grass template scaled down: two fewer draws)
  const grassB = grassA;
  const SMALL_K = 0.66, GRASS_B_K = 0.7, FAR_FERN_K = 1.32;
  /** A big fern; beyond the lenses' reach it becomes a scaled-up medium fern. */
  const addFern = (it, keep = false) => {
    // (round 5: from 20 units on — the lenses never resolve a big fern's folded fronds there)
    if (!keep && viewDistance(it.x, it.y + it.s * 0.5, it.z, it.s * 0.8) > 20) fernM.push({ ...it, s: it.s * FAR_FERN_K });
    else fernL.push(it);
  };
  const clover = [];
  const flowers = Object.fromEntries(FLOWER_KINDS.map((k) => [k, []]));
  const bushes = [];
  // (deep blue-greens: an enchanted wood's ferns, not tropical lime)
  const fernTints = ['#3f7a4c', '#3b7452', '#468050', '#4c8448', '#3a6e4e', '#528a4a'];
  const grassTints = ['#7d9c46', '#88a64c', '#6f9440', '#94a854', '#7a9a52'];
  const jitterTint = (hex, h = 0.02, l = 0.06) => new THREE.Color(hex).offsetHSL(rng.jitter(h), rng.jitter(0.06), rng.jitter(l));

  // Undergrowth grows in CLUMPS, not as confetti: a noise field, pulled
  // towards roots, stones, logs, stumps and the path edges, is thresholded
  // into clumps with dense cores and feathered edges. Each clump mixes 3–4
  // species from a recipe that suits its place (sun, shade, damp, path edge):
  // big ferns, bilberry & bramble bushlets and foxglove / bluebell spikes in
  // the core, grass, clover and little flowers at the fringe, a mushroom
  // family now and then. Between the clumps lie open glades, where the floor's
  // own patches show (velvet cushions, litter drifts, clover mats, bare soil
  // with pebbles — common.groundPatches; the same fields steer what grows).
  const bilberry = [], bramble = [];
  const broad = [];
  const shrubs = [];
  const RECIPES = {
    brake: { fernL: 2.2, fernM: 2.6, bilberry: 1.5, foxgloves: 0.8, grass: 1.2 },
    woodland: { fernM: 2.6, bluebells: 1.6, broad: 1, fernL: 1, mush: 0.4, grass: 0.6 },
    meadow: { grass: 2.5, daisies: 2, buttercups: 2, meadow: 2, clover: 1.2, forgetMeNots: 0.6 },
    berry: { bilberry: 3, fernM: 2.5, bramble: 1, forgetMeNots: 1, grass: 1, mush: 0.3 },
    damp: { forgetMeNots: 3, fernM: 3, broad: 1.5, grass: 1.5, bluebells: 0.5 },
    shade: { fernM: 3, fernL: 1.4, bluebells: 1.5, bramble: 0.8, mush: 0.6, grass: 0.6 },
    edge: { grass: 3, clover: 2, daisies: 1.6, forgetMeNots: 1, buttercups: 1, fernM: 0.8 },
  };
  const BIG = { fernL: 1, bilberry: 1, bramble: 1, broad: 1, foxgloves: 1 };
  const SMALL = { grass: 1, clover: 1, daisies: 1, buttercups: 1, forgetMeNots: 1, meadow: 1 };
  // one recipe per ~3.4-unit clump cell (deterministic, independent of the scatter's draws)
  const recipeCache = new Map();
  const recipeAt = (x, z, ctxKind) => {
    const i = Math.floor(x / 3.4 + 0.35 * fieldFine(x * 0.2, z * 0.2)), j = Math.floor(z / 3.4);
    const key = `${i},${j},${ctxKind}`;
    let rec = recipeCache.get(key);
    if (!rec) {
      const crng = createRng(`vegetation:clump:${key}`);
      const pool = ctxKind === 'damp' ? { damp: 5, woodland: 1, berry: 1 }
        : ctxKind === 'edge' ? { edge: 5, meadow: 2, berry: 1 }
          : ctxKind === 'shady' ? { shade: 4, brake: 3, berry: 2, woodland: 2 }
            : { meadow: 3, berry: 2.5, brake: 2.5, woodland: 2 };
      rec = RECIPES[pickWeighted(crng, pool)];
      recipeCache.set(key, rec);
    }
    return rec;
  };
  /**
   * Place one plant of a clump's species. A tall one that would block a spot
   * camera's view becomes a low fringe plant instead (the clump stays a clump
   * in the shots' foregrounds); false only if nothing fits.
   */
  const LOW_FALLBACK = ['grass', 'clover', 'forgetMeNots', 'daisies', 'grass'];
  const placePlant = (kind, x, y, z, opts = {}) => {
    // (around the fairy ring only low things grow: the ring must read)
    if (BIG[kind] && (nearRing(x, z, 1.7) || inDrift(x, z))) kind = 'grass';
    if (placeOne(kind, x, y, z, opts)) return true;
    return !SMALL[kind] && placeOne(LOW_FALLBACK[Math.floor(rng.next() * LOW_FALLBACK.length)], x, y, z, opts);
  };
  const placeOne = (kind, x, y, z, { grow = 1, edge = false, r = Math.hypot(x, z) } = {}) => {
    if (kind === 'fernL' || kind === 'fernM') {
      const big = kind === 'fernL';
      const s = (big ? rng.range(0.9, 1.5) : rng.range(0.55, 1.05)) * grow * (r > 25 ? 1.35 : 1);
      // tall ferns must not sit in a spot camera's view
      if (s * 0.9 > 0.7 && !isClearOfViews(x, y, z, s * 0.9, s * 0.8)) return false;
      const it = { x, y, z, ry: rng.range(0, TAU), s, sy: rng.range(0.8, 1.15), color: jitterTint(rng.pick(fernTints)) };
      if (big) addFern(it);
      else if (rng.chance(0.6) || r > 24) fernM.push(it);
      else fernM.push({ ...it, s: it.s * SMALL_K });
    } else if (kind === 'grass') {
      const it = { x, y, z, ry: rng.range(0, TAU), s: rng.range(0.8, 1.5) * (edge ? 0.85 : 1), color: jitterTint(rng.pick(grassTints), 0.025, 0.08) };
      if (rng.chance(0.5)) grassA.push(it);
      else grassB.push({ ...it, s: it.s * GRASS_B_K });
    } else if (kind === 'clover') {
      clover.push({ x, y: y + 0.005, z, ry: rng.range(0, TAU), s: rng.range(0.9, 1.5), color: jitterTint('#6a9a40', 0.02, 0.06) });
    } else if (kind === 'bilberry' || kind === 'bramble') {
      const s = rng.range(1.1, 1.7) * grow * (kind === 'bramble' ? 1.1 : 1);
      if (s * 0.6 > 0.7 && !isClearOfViews(x, y, z, s * 0.6, s * 0.6)) return false;
      (kind === 'bilberry' ? bilberry : bramble).push({ x, y, z, ry: rng.range(0, TAU), s, sy: rng.range(0.85, 1.15), color: jitterTint('#ffffff', 0.02, 0.06) });
    } else if (kind === 'broad') {
      const s = rng.range(1.1, 1.6) * grow;
      if (s * 0.55 > 0.6 && !isClearOfViews(x, y, z, s * 0.55, s * 0.75)) return false;
      broad.push({ x, y, z, ry: rng.range(0, TAU), s, color: jitterTint(rng.pick(['#ffffff', '#f0ffe0', '#e6f5d0']), 0.02, 0.05) });
    } else if (kind === 'mush') {
      // (a little tuft, not a lone mushroom: they grow where the mycelium lives)
      const m = rng.next();
      if (m < 0.4) smallKit.bolete(x, y, z, { height: rng.range(0.1, 0.2), color: rng.pick(SPECIES.bolete.caps) });
      else if (m < 0.8) smallKit.bonnets(x, y, z, { height: rng.range(0.08, 0.15), count: rng.int(3, 5) });
      else {
        smallKit.bonnets(x, y, z, { height: rng.range(0.07, 0.13), glow: true, count: rng.int(3, 5), spread: 1.6 });
        glowSpots.push({ x, y: y + 0.1, z });
      }
    } else {
      // wildflowers (the open glen's are a touch bigger so they read from the spots)
      const inner = r < 21;
      const s = rng.range(0.95, 1.4) * (inner ? 1.5 : 1.1) * (kind === 'foxgloves' || kind === 'bluebells' ? grow : 1);
      if (kind === 'foxgloves' && !isClearOfViews(x, y, z, 1.1 * s, 0.3)) return false;
      flowers[kind].push({ x, y, z, ry: rng.range(0, TAU), s, color: jitterTint('#ffffff', 0.015, 0.05) });
      if (flowerPatches.length < 400) flowerPatches.push({ x, y: y + 0.3 * s, z, r: 0.3 * s, kind });
    }
    return true;
  };
  const gp = {};
  const clumpStats = { plants: 0, glade: 0 };
  const cell = 0.56 / Math.sqrt(density);
  const LIM = 40;
  for (let gz = -LIM; gz < 47; gz += cell) {
    for (let gx = -LIM; gx < LIM; gx += cell) {
      const x = gx + rng.range(0, cell), z = gz + rng.range(0, cell);
      const r = Math.hypot(x, z);
      // (beyond, only the trees and the misty backdrop read — except the front
      //  band the wide views look over)
      if (r > (z > 18 ? 46 : 36)) continue;
      // spend the detail where the spots look: the front band (z > 20) is the
      // overview's foreground (seen, but never up close); behind the tree wall
      // only big shapes read
      let vis = 1;
      if (z > 20) vis *= 0.75;
      if (r > 24) vis *= 0.55;
      if (r > 30) vis *= 0.5;
      if (!rng.chance(vis)) continue;
      if (!canGrow(x, z, { path: 1.12 })) continue;
      const occClear = occ.clearance(x, z, 3);
      if (occClear < 0.05) continue;
      const y = getHeight(x, z);
      const pd = getPathDistance(x, z);
      const edge = pd < 2.2;
      const shady = r > 21 || oakDist(x, z) < 13 || occClear < 1.2;
      const damp = getStreamDistance(x, z) < 7 || Math.hypot(x - STREAM.pond.x, z - STREAM.pond.z) < 9;
      // the floor's own patches: cushions, drifts and bare soil stay mostly open
      groundPatches(x, z, gp);
      const open = Math.max(gp.cushion * 0.9, gp.drift * 0.8, gp.soil * 0.85);
      // the clump field: noise patches + a pull towards solids and path edges
      const hug = Math.max(1 - THREE.MathUtils.smoothstep(occClear, 0.05, 1.6), edge ? 0.8 * (1 - THREE.MathUtils.smoothstep(pd, 1.3, 2.2)) : 0);
      const cv = fieldMid(x, z) * 0.55 + fieldAlt(x, z) * 0.25 + fieldFine(x, z) * 0.2 + hug * 0.42 - open * 0.35;
      const p = THREE.MathUtils.smoothstep(cv, 0.52, 0.68);
      // (clover mats get real clover; a glade otherwise)
      if (!rng.chance(p)) {
        if (gp.clover > 0.5 && rng.chance(0.35)) clover.push({ x, y: y + 0.005, z, ry: rng.range(0, TAU), s: rng.range(1.0, 1.5), color: jitterTint('#6a9a40', 0.02, 0.06) });
        else clumpStats.glade++;
        continue;
      }
      const core = THREE.MathUtils.smoothstep(cv, 0.6, 0.8);
      const rec = recipeAt(x, z, damp ? 'damp' : edge && occClear > 0.6 ? 'edge' : shady ? 'shady' : 'sunny');
      // dense cores favour the big species, the feathered fringe the small ones
      const w = {};
      for (const k in rec) w[k] = rec[k] * (BIG[k] ? 0.3 + 1.0 * core : SMALL[k] ? 1.5 - core : 1);
      let kind = pickWeighted(rng, w);
      // (out at the forest wall only the big shapes read)
      if (r > 26 && SMALL[kind] && kind !== 'grass') kind = rng.chance(0.3) ? 'fernM' : 'grass';
      clumpStats.plants += placePlant(kind, x, y, z, { grow: 0.85 + 0.35 * core, edge, r }) ? 1 : 0;
    }
  }
  stats.clumps = clumpStats;

  lap('scatter');
  // grass & clover tucked between the path stones (moss and weeds take the gaps)
  for (const s of stones) {
    if (!rng.chance(0.55 * density)) continue;
    const a = rng.range(0, TAU);
    const x = s.x + Math.sin(a) * (s.r + 0.08), z = s.z + Math.cos(a) * (s.r + 0.08);
    if (stones.some((o) => o !== s && Math.hypot(o.x - x, o.z - z) < o.r + 0.03)) continue;
    const y = getHeight(x, z);
    if (rng.chance(0.55)) grassA.push({ x, y, z, ry: rng.range(0, TAU), s: rng.range(0.3, 0.55) * (rng.chance(0.5) ? 1 : GRASS_B_K), color: jitterTint(rng.pick(grassTints)) });
    else clover.push({ x, y: y + 0.01, z, ry: rng.range(0, TAU), s: rng.range(0.5, 0.9), color: jitterTint('#6a9a40') });
  }

  // ── 4a. the lawn wedges between the paths — the floor the overview and the
  //     glen's camera look down on — get REAL 3D dressing instead of paint:
  //     moss hummocks where the floor's velvet cushions are, clover mats on
  //     its clover patches, half as many grass tufts again, little rock groups,
  //     two or three small mushroom families, warm sunlit tufts. (Its own
  //     random stream: the placement of everything above stays put.)
  {
    const lrng = createRng('vegetation:lawn-wedges');
    const lawn = { cells: 0, hummocks: 0, clover: 0, grass: 0, stones: 0, families: 0 };
    const GLEN = ['glen'];
    const lowOk = (x, y, z, h, r) => cameraClearance(x, z) > 2.6 && isClearOfSubjects(x, y, z, h, r, GLEN) && !inNearField(x, y + h * 0.5, z, 0.3, 0.4);
    const famSites = [];
    const cs = 1.15 / Math.sqrt(Math.min(1, density));
    const lp = {};
    for (let gz = -2; gz < 23; gz += cs) {
      for (let gx = -16; gx < 13; gx += cs) {
        const x = gx + lrng.range(0, cs), z = gz + lrng.range(0, cs);
        if (Math.hypot(x, z) > 22.5) continue;
        if (!canGrow(x, z, { path: 1.22 }) || nearRing(x, z, 0.5)) continue;
        const y = getHeight(x, z);
        if (!inShot(x, y + 0.15, z, 0.4)) continue;
        if (occ.clearance(x, z, 2) < 0.12) continue;
        lawn.cells++;
        groundPatches(x, z, lp);
        const drift = inDrift(x, z);
        const pd = getPathDistance(x, z);
        const sunny = oakDist(x, z) > 12.5 && !(getStreamDistance(x, z) < 6);
        // (a) grass: far more tufts in the open lawns — little clumps of 3–5,
        //     the sunlit ones warmer (the glen's own scatter leaves its glades open)
        const ng = drift ? lrng.int(0, 1) : lrng.int(3, 5);
        for (let i = 0; i < ng; i++) {
          const a = lrng.range(0, TAU), d = lrng.range(0, cs * 0.45);
          const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
          if (!canGrow(px, pz, { path: 1.12 })) continue;
          const tint = sunny && lrng.chance(0.55) ? lrng.pick(['#9aa84c', '#a6aa52', '#8fa646']) : lrng.pick(grassTints);
          const it = { x: px, y: getHeight(px, pz), z: pz, ry: lrng.range(0, TAU), s: lrng.range(0.75, 1.35) * (pd < 2 ? 0.8 : 1), color: jitterTint(tint, 0.02, 0.07) };
          if (lrng.chance(0.5)) grassA.push(it);
          else grassB.push({ ...it, s: it.s * GRASS_B_K });
          lawn.grass++;
        }
        if (drift) continue;
        // (b) the floor's velvet cushions rise as real moss hummocks
        if (lp.cushion > 0.35 || lrng.chance(0.14)) {
          const n = lp.cushion > 0.35 ? lrng.int(1, 3) : 1;
          for (let i = 0; i < n; i++) {
            const a = lrng.range(0, TAU), d = i ? lrng.range(0.3, 0.7) : 0;
            const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
            const w = lrng.range(0.32, 0.75) * (i ? 0.8 : 1);
            const h = w * lrng.range(0.32, 0.5);
            const py = getHeight(px, pz);
            if (!canGrow(px, pz, { margin: w * 0.3 }) || occ.clearance(px, pz, 2) < w * 0.45 || !lowOk(px, py, pz, h, w)) continue;
            mossMound(moundB, lrng, px, pz, w, h, { color: new THREE.Color('#4e6e2c').lerp(new THREE.Color('#86943e'), lrng.next()).offsetHSL(lrng.jitter(0.02), 0, lrng.jitter(0.03)) });
            occ.add(px, pz, w * 0.5, 'mound');
            lawn.hummocks++;
          }
        }
        // (c) clover mats on the floor's clover patches (and a little patch now and then)
        if (lp.clover > 0.25 || lrng.chance(0.16)) {
          const n = lp.clover > 0.25 ? lrng.int(3, 6) : lrng.int(2, 3);
          for (let i = 0; i < n; i++) {
            const a = lrng.range(0, TAU), d = lrng.range(0, 0.55);
            const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
            if (!canGrow(px, pz, { path: 1.1 })) continue;
            clover.push({ x: px, y: getHeight(px, pz) + 0.005, z: pz, ry: lrng.range(0, TAU), s: lrng.range(1.0, 1.5), color: jitterTint(sunny ? '#78a444' : '#6a9a40', 0.02, 0.06) });
            lawn.clover++;
          }
        }
        // (c2) now and then a low fern in the shade, rising out of the lawn
        if (!sunny && lrng.chance(0.08)) {
          const fy = getHeight(x, z), fs = lrng.range(0.55, 0.85);
          if (lowOk(x, fy, z, fs * 0.6, fs * 0.5) && occ.clearance(x, z, 2) > 0.3) {
            fernM.push({ x, y: fy, z, ry: lrng.range(0, TAU), s: fs, sy: lrng.range(0.85, 1.1), color: jitterTint(lrng.pick(fernTints)) });
            lawn.ferns = (lawn.ferns ?? 0) + 1;
          }
        }
        // (d) a little group of mossy stones
        if (lrng.chance(0.12)) {
          const n = lrng.int(1, 3);
          for (let i = 0; i < n; i++) {
            const a = lrng.range(0, TAU), d = i ? lrng.range(0.25, 0.55) : 0;
            const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
            const size = i ? lrng.range(0.1, 0.18) : lrng.range(0.16, 0.3);
            const py = getHeight(px, pz);
            if (!canGrow(px, pz, { margin: size * 0.4 }) || occ.clearance(px, pz, 2) < size * 0.8 || !lowOk(px, py, pz, size * 0.7, size)) continue;
            const res = mossyRock(rockB, lrng, px, pz, size, { flat: lrng.range(0.5, 0.8), color: new THREE.Color(lrng.pick(rockTints)) });
            occ.add(px, pz, res.r * 0.85, 'rock');
            mossyRocks.push({ x: px, y: res.top, z: pz, r: res.r });
            lawn.stones++;
          }
        }
        // (candidate sites for the little mushroom families: shady, by a hummock or stone)
        if (pd > 1.8 && occ.clearance(x, z, 2) < 0.9) famSites.push({ x, z, score: lrng.next() + (sunny ? 0 : 0.4) });
      }
    }
    // (e) two or three small mushroom families of different species
    famSites.sort((a, b) => b.score - a.score);
    const famSpecies = ['bolete', 'bonnets', 'flyAgaric', 'ochre'];
    for (const s of famSites) {
      if (lawn.families >= 3) break;
      if (troops.some((t) => Math.hypot(t.x - s.x, t.z - s.z) < 4)) continue;
      if (familyAt(s.x, s.z, { keep: true, gap: 4, minClear: 0.04, size: lrng.range(0.26, 0.48), species: famSpecies[lawn.families % famSpecies.length], path: 1.3 })) lawn.families++;
    }
    stats.lawn = lawn;
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
    bushes.push({ x, y: y + s * 0.45, z, s, sy: rng.range(0.6, 0.85), ry: rng.range(0, TAU), color: new THREE.Color('#3d7a47').lerp(new THREE.Color('#5a8c3e'), rng.next()).offsetHSL(rng.jitter(0.02), 0, rng.jitter(0.03)) });
  }

  // ── 4b. lush beds ─────────────────────────────────────────────────────────
  // Single little plants vanish at the spots' distance; drifts of big ferns,
  // broad-leaf clumps (butterbur by the water, wild ginger in the shade) and
  // low bilberry shrubs give the floor its painterly masses.
  const tryBedPlant = (x, z, kind, s) => {
    if (!canGrow(x, z, { margin: 0.15 })) return false;
    if (inDrift(x, z) || nearRing(x, z, 1.2)) return false;
    if (occ.clearance(x, z, 3) < 0.1) return false;
    const y = getHeight(x, z);
    const h = kind === 'shrub' ? s * 0.9 : kind === 'broad' ? s * 0.55 : s * 0.85;
    if (h > 0.6 && !isClearOfViews(x, y, z, h, s * 0.75)) return false;
    if (kind === 'fern') addFern({ x, y, z, ry: rng.range(0, TAU), s, sy: rng.range(0.85, 1.15), color: jitterTint(rng.pick(fernTints)) });
    else if (kind === 'broad') broad.push({ x, y, z, ry: rng.range(0, TAU), s, color: jitterTint(rng.pick(['#ffffff', '#f0ffe0', '#e6f5d0']), 0.02, 0.05) });
    else if (rng.chance(0.55)) (rng.chance(0.6) ? bilberry : bramble).push({ x, y, z, ry: rng.range(0, TAU), s: s * 1.25, sy: rng.range(0.85, 1.15), color: jitterTint('#ffffff', 0.02, 0.06) });
    else shrubs.push({ x, y: y + s * 0.32, z, s: s * 0.55, sy: rng.range(0.55, 0.75), ry: rng.range(0, TAU), color: new THREE.Color('#3f7040').lerp(new THREE.Color('#628c3a'), rng.next()).offsetHSL(rng.jitter(0.02), 0, rng.jitter(0.03)) });
    return true;
  };
  {
    const beds = [];
    const want = Math.round(52 * Math.min(1.2, density));
    for (let k = 0; k < 900 && beds.length < want; k++) {
      const az = rng.range(-Math.PI, Math.PI);
      const r = Math.sqrt(rng.range(9 * 9, 31 * 31));
      const x = Math.sin(az) * r, z = Math.cos(az) * r;
      if (!canGrow(x, z, { margin: 0.6 })) continue;
      if (beds.some((b) => Math.hypot(b.x - x, b.z - z) < 3.6)) continue;
      beds.push({ x, z });
      const damp = getStreamDistance(x, z) < 6.5 || Math.hypot(x - STREAM.pond.x, z - STREAM.pond.z) < 8;
      const n = Math.max(3, Math.round(rng.int(5, 11) * thinK));
      const spread = rng.range(1.3, 2.6);
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, TAU), d = Math.sqrt(rng.next()) * spread;
        const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
        const roll = rng.next();
        if (damp ? roll < 0.5 : roll < 0.18) tryBedPlant(px, pz, 'broad', rng.range(1.3, 2.1));
        else if (roll < 0.82) tryBedPlant(px, pz, 'fern', rng.range(1.05, 1.75) * (1 - d / spread * 0.3));
        else tryBedPlant(px, pz, 'shrub', rng.range(0.8, 1.3));
      }
    }
  }
  // ferns, broad leaves and shrubs crowd the giants' feet between the buttresses
  // (lower tiers: fewer — the trunks and their roots carry the shot)
  for (const t of plan.trees) {
    if (Math.hypot(t.x, t.z) > 33) continue;
    const n = Math.round((t.kind === 'birch' ? rng.int(2, 4) : rng.int(5, 9)) * thinK);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU), d = t.radius * rng.range(1.5, 3.4) + rng.range(0, 1.2);
      const kind = rng.chance(0.65) ? 'fern' : rng.chance(0.5) ? 'broad' : 'shrub';
      tryBedPlant(t.x + Math.sin(a) * d, t.z + Math.cos(a) * d, kind, rng.range(1.1, 1.8));
    }
  }
  // and the giant fly agarics' feet
  for (const g of giants) {
    const n = rng.int(2, 4);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU), d = g.R * rng.range(0.5, 1.1);
      tryBedPlant(g.x + Math.sin(a) * d, g.z + Math.cos(a) * d, rng.chance(0.7) ? 'fern' : 'broad', rng.range(0.9, 1.4));
    }
  }

  // the vignettes' ferns, foxgloves and broad leaves (2b)
  for (const f of vigFerns) {
    if (f.keep) {
      const y = getHeight(f.x, f.z);
      if (canGrow(f.x, f.z, { path: 0 }) && isClearOfSubjects(f.x, y, f.z, f.s * 0.8, f.s * 0.7)) addFern({ x: f.x, y, z: f.z, ry: rng.range(0, TAU), s: f.s, sy: rng.range(0.9, 1.1), color: jitterTint(rng.pick(fernTints)) }, true);
    } else tryBedPlant(f.x, f.z, 'fern', f.s);
  }
  for (const f of vigBroad) tryBedPlant(f.x, f.z, 'broad', f.s);
  for (const f of vigFox) {
    if (!canGrow(f.x, f.z, { margin: 0.1 }) || occ.clearance(f.x, f.z, 2) < 0.08) continue;
    const y = getHeight(f.x, f.z);
    if (!isClearOfViews(f.x, y, f.z, 1.1 * f.s, 0.3)) continue;
    flowers.foxgloves.push({ x: f.x, y, z: f.z, ry: rng.range(0, TAU), s: f.s, color: jitterTint('#ffffff', 0.015, 0.05) });
    flowerPatches.push({ x: f.x, y: y + 0.5 * f.s, z: f.z, r: 0.3 * f.s, kind: 'foxgloves' });
  }

  lap('beds');
  // ── 5. foreground framing: big ferns at the front edge ────────────────────
  for (let k = 0; k < Math.round(90 * thinK); k++) {
    const x = rng.range(-30, 30), z = rng.range(18, 34);
    if (!canGrow(x, z, { margin: 0.6 })) continue;
    if (cameraClearance(x, z) < 2.5) continue;
    const s = rng.range(1.6, 2.8);
    const y = getHeight(x, z);
    if (!isClearOfSubjects(x, y, z, s * 0.85, s * 0.9) || !isClearOfViews(x, y, z, s * 0.5, s * 0.5)) continue;
    addFern({ x, y, z, ry: rng.range(0, TAU), s, sy: rng.range(0.85, 1.1), color: jitterTint(rng.pick(fernTints)) }, true);
  }

  // (b) the lower corners of every spot shot: big fronds or broad leaves rising
  //     into the frame close to the lens, soft in the depth of field — the
  //     painter's foreground framing (ref: the giant tree with the elven house)
  const framing = [];
  {
    const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
    const dir = new THREE.Vector3();
    for (const spot of SPOTS) {
      if (spot.id === 'glen' || spot.id === 'code') continue;
      const P = spot.camera.position, T = spot.camera.target;
      cam.fov = spot.camera.fov ?? 40;
      cam.position.set(...P);
      cam.lookAt(T[0], T[1], T[2]);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      for (const sx of [-1, 1]) {
        let placed = 0;
        for (const ndcX of [0.95, 0.8, 0.65, 1.05]) {
          if (placed >= 2) break;
          // the ray through the lower corner of the frame
          dir.set(ndcX * sx, -0.82, 0.5).unproject(cam).sub(cam.position).normalize();
          const hlen = Math.hypot(dir.x, dir.z);
          for (let d = 5; d < 17; d += 0.7) {
            const x = cam.position.x + (dir.x / hlen) * d + rng.jitter(0.25);
            const z = cam.position.z + (dir.z / hlen) * d + rng.jitter(0.25);
            const rayY = cam.position.y + (dir.y / hlen) * d;
            const y = getHeight(x, z);
            const kind = rng.chance(0.65) ? 'fern' : 'broad';
            const s = rng.range(1.6, 2.3);
            const top = y + (kind === 'fern' ? s * 0.8 : s * 0.5);
            // it must actually rise into the corner — but not swallow the frame
            if (top < rayY + 0.35 || top > rayY + 2.4) continue;
            if (!canGrow(x, z, { margin: 0.1 }) || occ.clearance(x, z, 3) < 0.4) continue;
            if (!isClearOfSubjects(x, y, z, top - y, s * 0.7)) continue;
            if (framing.some((f) => Math.hypot(f.x - x, f.z - z) < 1.6)) continue;
            framing.push({ x, z });
            if (kind === 'fern') fernL.push({ x, y, z, ry: rng.range(0, TAU), s, sy: rng.range(0.95, 1.15), color: jitterTint(rng.pick(fernTints)) });
            else broad.push({ x, y, z, ry: rng.range(0, TAU), s: s * 1.1, color: jitterTint('#e8f5d8', 0.02, 0.05) });
            placed++;
            break;
          }
        }
      }
    }
    stats.framing = framing.length;
  }

  // ── 4c. a fairy ring (a secret): a true circle of glowing bonnets in
  //     graded sizes on a band of glowing moss, cool light pooling under them
  //     at night, wisps rising from its heart (ambient/wisps.js)
  //     (vegetation/fairyRing.js)
  let fairyRing = null;
  const glowMoss = [];
  const glowPools = [];
  {
    const ring = buildFairyRing(ctx, { kit: smallKit, site: ringSite, clover });
    if (ring) {
      fairyRing = ring.group;
      group.add(fairyRing);
      glowMoss.push(...ring.moss);
      glowPools.push(...ring.pools);
      glowSpots.push(...ring.glowSpots);
      flowerPatches.push(ring.flowerPatch);
      const c = ring.centre;
      // a sunbeam picks out the ring (where the canopy lets it through)
      ctx.atmosphere?.addShaft?.(c.x, c.z, { length: 22, width: 2.4, intensity: 0.75 });
      // …and at night a soft mint glow rises from its heart (if the light budget allows)
      ctx.lights?.addPoint?.(new THREE.Vector3(c.x, c.y + 0.7, c.z), { color: '#9cf2cf', day: 0, night: 2.2, distance: 4.5, decay: 2 });
      // (a Vector3 gets its bubble 1.6 above the point: this one floats just over the caps)
      const speechAt = c.clone().add(new THREE.Vector3(0, -1.0, 0));
      ctx.interactions?.add(fairyRing, {
        kind: 'secret',
        label: 'A fairy ring',
        area: 'glen',
        approach: false,
        focus: { distance: 3.2, height: 0.3 },
        onActivate: () => ctx.ui?.speech?.('A fairy ring! Step inside and make a wish…', speechAt),
      });
      ringInfo = { x: c.x, y: c.y, z: c.z, r: ring.radius };
      stats.fairyRing = [+c.x.toFixed(2), +c.z.toFixed(2)];
    }
  }

  // ── 4d. will-o'-the-wisp mushrooms along the paths: little clusters of
  //     glowing bonnets and enchanted toadstools that light the way at night
  {
    const lanterns = [];
    const want = Math.round(14 * Math.min(1.2, density));
    for (const p of pathPolylines) {
      for (let i = 1; i < p.pts.length - 1 && lanterns.length < want; i += 2) {
        if (!rng.chance(p.id === 'main' ? 0.5 : 0.35)) continue;
        const q = p.pts[i], nx = p.pts[i + 1], pv = p.pts[i - 1];
        let tx = nx.x - pv.x, tz = nx.z - pv.z;
        const l = Math.hypot(tx, tz) || 1;
        tx /= l;
        tz /= l;
        const side = rng.chance(0.5) ? 1 : -1;
        const off = p.halfWidth * rng.range(1.45, 2.1);
        const cx = q.x - tz * off * side, cz = q.z + tx * off * side;
        if (!canGrow(cx, cz, { path: 1.3 })) continue;
        // (never right in front of a lens: out of focus they would bloom into blobs)
        if (inNearField(cx, getHeight(cx, cz) + 0.2, cz, 0.42, 0.8)) continue;
        if (lanterns.some((o) => Math.hypot(o.x - cx, o.z - cz) < 4.2)) continue;
        if (occ.clearance(cx, cz, 2) < 0.2) continue;
        lanterns.push({ x: cx, z: cz });
        const cy = getHeight(cx, cz);
        const lod = mushLod(cx, cy, cz, 0.4);
        const tufts = rng.int(2, 3);
        for (let k = 0; k < tufts; k++) {
          const a = rng.range(0, TAU), d = rng.range(0, 0.45);
          const x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
          // (no halo sprites: seen out of focus from a -wide shot they would bloom into blobs)
          smallKit.bonnets(x, getHeight(x, z), z, { height: rng.range(0.1, 0.17), count: rng.int(3, 5), glow: true, spread: 1.4, halo: false });
        }
        const toads = rng.int(1, 2);
        for (let k = 0; k < toads; k++) {
          const a = rng.range(0, TAU), d = rng.range(0.2, 0.6);
          const x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
          if (!canGrow(x, z, { path: 1.2 })) continue;
          const h = rng.range(0.22, 0.42);
          smallKit.amanita(x, getHeight(x, z), z, { height: h, capR: h * rng.range(0.5, 0.65), color: rng.pick(CAP_REDS), glowGills: true, glowSpots: true, haloK: 1.6, lod });
        }
        occ.add(cx, cz, 0.35, 'toadstool');
        glowSpots.push({ x: cx, y: cy + 0.15, z: cz });
      }
    }
    stats.wisps = lanterns.length;
  }

  // ── 4f. night: trails of glowing moss & bonnets along the giants' roots,
  //     the path edges and across the dark fern carpet in front
  {
    const trails = buildGlowTrails(ctx, { kit: smallKit, roots: rootRuns, density, avoid: ringInfo ? [{ x: ringInfo.x, z: ringInfo.z, r: ringInfo.r + 0.6 }] : [] });
    glowMoss.push(...trails.moss);
    glowPools.push(...trails.pools);
    glowSpots.push(...trails.glowSpots);
    stats.glowTrails = { trails: trails.trails, moss: trails.moss.length, pools: trails.pools.length };
  }

  lap('framing+wisps');
  // ── 5c. no bare ground: whatever a composed shot still shows empty gets
  //     undergrowth — tufts & ferns in the glen's gaps, and beyond the forest
  //     wall (r > 35, seen between the trunks and at the overview's edges) big
  //     fern drifts, broad leaves and bushes instead of bare litter
  {
    const C = 1.5;
    const cover = new Map();
    const ck = (i, j) => i * 73856093 ^ j * 19349663;
    const put = (x, z, r) => {
      const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C), j0 = Math.floor((z - r) / C), j1 = Math.floor((z + r) / C);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = ck(i, j);
        let l = cover.get(k);
        if (!l) cover.set(k, (l = []));
        l.push(x, z, r);
      }
    };
    const coverGap = (x, z) => {
      const l = cover.get(ck(Math.floor(x / C), Math.floor(z / C)));
      let best = Infinity;
      if (l) for (let i = 0; i < l.length; i += 3) best = Math.min(best, Math.hypot(l[i] - x, l[i + 1] - z) - l[i + 2]);
      return best;
    };
    const lists = [[fernL, 0.9], [fernM, 0.65], [grassA, 0.3], [clover, 0.26], [broad, 0.55], [shrubs, 1.3], [bushes, 1.0], [bilberry, 0.45], [bramble, 0.6]];
    for (const kind of FLOWER_KINDS) lists.push([flowers[kind], 0.22]);
    for (const [list, k] of lists) for (const it of list) put(it.x, it.z, k * it.s);
    // (the flower drifts, hydrangeas and the signpost dress their ground too)
    for (const c of drifts.cover) put(c.x, c.z, c.r);
    let inner = 0, outer = 0;
    // (a) the glen's bigger holes get a small clump (never a lone tuft); a
    //     glade the floor already dresses (cushions, drifts, clover, bare soil
    //     with pebbles) stays open. Lower tiers: only the biggest holes.
    const thin = 1 / Math.sqrt(Math.min(1, density));
    const step = 1.3 * thin;
    for (let gz = -38; gz < 46; gz += step) {
      for (let gx = -38; gx < 38; gx += step) {
        const x = gx + rng.range(0, step), z = gz + rng.range(0, step);
        const r = Math.hypot(x, z);
        if (r > (z > 18 ? 46 : 35.5)) continue;
        if (!canGrow(x, z, { path: 1.12 }) || occ.clearance(x, z, 2) < 0.12) continue;
        if (coverGap(x, z) < 1.25 * thin) continue;
        const y = getHeight(x, z);
        if (!inShot(x, y + 0.15, z, 0.35)) continue;
        groundPatches(x, z, gp);
        if (Math.max(gp.cushion, gp.drift, gp.soil, gp.clover) > 0.35) continue;
        const shady = r > 21 || oakDist(x, z) < 13;
        const rec = recipeAt(x, z, shady ? 'shady' : 'sunny');
        const n = tier === 'high' ? rng.int(3, 5) : tier === 'medium' ? rng.int(2, 4) : rng.int(2, 3);
        for (let i = 0; i < n; i++) {
          const a = rng.range(0, TAU), d = i ? rng.range(0.25, 0.8) : 0;
          const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
          if (!canGrow(px, pz, { path: 1.12 }) || occ.clearance(px, pz, 2) < 0.08) continue;
          const w = {};
          for (const k in rec) w[k] = rec[k] * (BIG[k] ? (i ? 0.6 : 1.6) : SMALL[k] ? (i ? 1.4 : 0.5) : 1);
          if (placePlant(pickWeighted(rng, w), px, getHeight(px, pz), pz, { grow: i ? 0.85 : 1.05, r })) inner++;
        }
        put(x, z, 0.9);
      }
    }
    // (b) beyond the forest wall: fewer, bigger masses (they read from afar)
    // (round 5: a little sparser — the masses beyond the wall read from afar only)
    const big = 2.8 * thin;
    for (let gz = -48; gz < 48; gz += big) {
      for (let gx = -48; gx < 48; gx += big) {
        const x = gx + rng.range(0, big), z = gz + rng.range(0, big);
        const r = Math.hypot(x, z);
        if (r < 33 || r > 47) continue;
        if (thinK < 1 && !rng.chance(0.4 + 0.6 * thinK)) continue;
        if (!canGrow(x, z, { margin: 0.4 }) || occ.clearance(x, z, 4) < 0.35) continue;
        if (coverGap(x, z) < 0.9) continue;
        const y = getHeight(x, z);
        if (!inShot(x, y + 0.6, z, 1.4)) continue;
        const roll = rng.next();
        if (roll < 0.7) {
          const s = rng.range(1.6, 2.4);
          if (!isClearOfViews(x, y, z, s * 0.7, s * 0.7)) continue;
          fernM.push({ x, y, z, ry: rng.range(0, TAU), s, sy: rng.range(0.8, 1.05), color: jitterTint(rng.pick(fernTints)).multiplyScalar(0.92) });
          put(x, z, 0.65 * s);
        } else if (roll < 0.85) {
          const s = rng.range(1.5, 2.1);
          if (!isClearOfViews(x, y, z, s * 0.5, s * 0.6)) continue;
          broad.push({ x, y, z, ry: rng.range(0, TAU), s, color: jitterTint('#e2f0d0', 0.02, 0.05) });
          put(x, z, 0.55 * s);
        } else {
          const s = rng.range(1.1, 1.8);
          if (blocksView(x, y + s * 0.6, z, s * 1.1)) continue;
          bushes.push({ x, y: y + s * 0.42, z, s, sy: rng.range(0.6, 0.8), ry: rng.range(0, TAU), color: new THREE.Color('#3d7a47').lerp(new THREE.Color('#5a8c3e'), rng.next()).offsetHSL(rng.jitter(0.02), 0, rng.jitter(0.03)) });
          put(x, z, 1.0 * s);
        }
        outer++;
      }
    }
    stats.gapFill = { inner, outer };
  }

  lap('gapfill');
  // ── litter: fallen leaves & pebbles (close-up detail) ─────────────────────
  const litter = buildLitter(ctx, rng.fork('litter'), { trees: plan.trees, density, extra: drifts.leaves });
  for (const m of litter.meshes) addMesh(m);
  stats.litter = { leaves: litter.leaves, pebbles: litter.pebbles };

  lap('litter');
  // ── 6. meshes ─────────────────────────────────────────────────────────────
  const fernMat = M.foliage({ variant: 'fern', vertexColors: true, translucency: 0.9, wind: { strength: 0.045, base: 0.08, speed: 1.3 } });
  const grassMat = M.foliage({ variant: 'grass', vertexColors: true, translucency: 0.8, wind: { strength: 0.12, base: 0.02, speed: 1.7 } });
  // (at night the leaf masses dim to moonlit silhouettes with a silver rim on top)
  const canopyMat = moonlit(M.foliage({ variant: 'oak', vertexColors: true, translucency: 1.0, wind: { strength: 0.012, base: -0.4, speed: 0.7 } }));
  const ivyMat = M.foliage({ variant: 'ivy', vertexColors: true, volume: false });
  // (the surface shader's moss now ignores the vertex colour itself — moss on
  //  vertex-moss-tinted logs, roots & snags no longer goes black; mossGain
  //  lifts it a little towards the sunlit carpet around them)
  // (at night a narrow silver back-rim on the moon's side of the giants' trunks
  //  — the misty backdrop's trunks have one; the bark only, never the leaf cards)
  const barkMat = moonRim(M.surface('bark', { mossy: 0.3, scale: 1.8, vertexColors: true, mossGain: 1.2 }), { rim: 0.045, pow: 5 });
  const birchMat = moonRim(M.surface('bark', { vertexColors: true, mossy: 0.12, scale: 0.6 }), { rim: 0.035, pow: 5 });
  const rockMat = M.surface('rock', { mossy: 0.62, vertexColors: true, mossGain: 1.1 });
  const mossMat = M.surface('moss', { vertexColors: true, scale: 1.1, bump: 0.8 });

  // (template shapes come from their own fixed seeds: they no longer change
  //  whenever the scatter above consumes a different number of random draws)
  const fernRng = createRng('vegetation:fern-templates');
  // (segment counts keep the arching fronds smooth where it shows: big ferns get 4)
  // (big ferns keep their folded fronds; medium ones are flat cards — they are
  //  seen from further away, where the fold no longer reads)
  // (long narrow fronds leaving the crown at 35–55°, tips drooping; fiddleheads in the heart)
  // (lower tiers get lighter fountains: fewer fronds, coarser arches; phones
  //  never come close enough to see a fiddlehead's coil)
  const FERN_T = {
    high: { L: { fronds: [13, 14], segs: 4, young: [2, 2], youngSegs: 5 }, M: { fronds: [10, 11] } },
    medium: { L: { fronds: [11, 12], segs: 3, young: [1, 1], youngSegs: 4 }, M: { fronds: [8, 9] } },
    low: { L: { fronds: [10, 11], segs: 3, young: [1, 1], youngSegs: 3 }, M: { fronds: [7, 8] } },
  }[tier] ?? null;
  const fT = FERN_T ?? { L: { fronds: [14, 15], segs: 4, young: [2, 2], youngSegs: 5 }, M: { fronds: [10, 11] } };
  addMesh(instanced('ferns-large', fernTemplate(fernRng, { fronds: fT.L.fronds, length: [1.05, 1.4], e0: [0.62, 1.0], segs: fT.L.segs, young: fT.L.young, youngSegs: fT.L.youngSegs, width: 0.2 }), fernMat, fernL));
  // (round 5 headroom: the far ring's medium ferns — no lens comes within 25
  //  units — are lighter cards: fewer fronds, two-segment arches, no fiddlehead)
  //  (the threshold is 23 units: the far ring is ≥ 25 units from every pose)
  const fernNear = [], fernFar = [];
  for (const it of fernM) (viewDistance(it.x, it.y + it.s * 0.4, it.z, it.s * 0.7) > 23 ? fernFar : fernNear).push(it);
  addMesh(instanced('ferns-medium', fernTemplate(fernRng, { fronds: fT.M.fronds, length: [0.8, 1.05], e0: [0.66, 1.02], segs: 3, young: [1, 1], youngSegs: tier === 'low' ? 3 : 4, flat: true, width: 0.23 }), fernMat, fernNear));
  addMesh(instanced('ferns-far', fernTemplate(createRng('vegetation:fern-far'), { fronds: tier === 'high' ? [7, 8] : [6, 7], length: [0.8, 1.05], e0: [0.66, 1.02], segs: 2, young: [0, 0], flat: true, width: 0.25 }), fernMat, fernFar));
  stats.fernsFar = fernFar.length;
  const grassRng = createRng('vegetation:grass-templates');
  addMesh(instanced('grass', grassTemplate(grassRng, { cards: tier === 'high' ? [4, 5] : [3, 4], height: [0.4, 0.6], spread: 0.1 }), grassMat, grassA));
  addMesh(instanced('clover', cloverTemplate(createRng('vegetation:clover'), { count: tier === 'high' ? [6, 8] : [5, 6], radius: 0.24 }), flowerMat, clover));
  const flRng = createRng('vegetation:flower-templates');
  const lite = tier !== 'high';
  // (the bluebell communities are the lighter kind on every tier: the drifts carry the blue now)
  for (const kind of FLOWER_KINDS) addMesh(instanced(`flowers-${kind}`, flowerTemplate(kind, flRng, { lite: lite || kind === 'bluebells' }), petalMat, flowers[kind]));
  // bilberry & bramble bushlets (the clumps' woody heart)
  const bushRng = createRng('vegetation:bushlets');
  addMesh(instanced('bilberry', bilberryTemplate(bushRng, { stems: lite ? [5, 6] : [6, 8], lite: tier === 'low' }), flowerMat, bilberry));
  addMesh(instanced('bramble', brambleTemplate(bushRng, { canes: lite ? [2, 3] : [3, 4], lite: tier === 'low' }), flowerMat, bramble));
  addMesh(instanced('canopy', clumpGeo, canopyMat, [...clumps, ...bushes, ...shrubs], { cast: true }));
  addMesh(instanced('broadleaf', broadleafTemplate(createRng('vegetation:broadleaf'), { leaves: tier === 'high' ? [5, 7] : [4, 5] }), flowerMat, broad, { cast: false }));

  const meshOf = (name, B, mat, opts) => (B.count ? staticMesh(name, B.build(), mat, opts) : null);
  addMesh(meshOf('forest-bark', builders.bark, barkMat, { cast: true }));
  addMesh(meshOf('forest-birch', builders.birch, birchMat, { cast: true }));
  addMesh(meshOf('forest-ivy', builders.ivy, ivyMat, { cast: false }));
  addMesh(meshOf('forest-rocks', rockB, rockMat, { cast: true }));
  addMesh(meshOf('forest-moss', moundB, mossMat, { cast: false }));
  addMesh(meshOf('forest-stump-faces', stumpFaceB, M.standard('#ffffff', { vertexColors: true, roughness: 0.82 }), { cast: false }));
  for (const m of smallKit.build(ctx, 'small-mushrooms', { cast: false })) addMesh(m);
  for (const m of giantKit.build(ctx, 'mushrooms', { cast: true, moon: true })) addMesh(m);
  // halos around the glowing caps & gills (night; the fairy ring's too)
  if (giantKit.glowPoints.length) addMesh(glowQuads(giantKit.glowPoints, '#7ff0d0', { day: 0.0, night: 0.7 }));
  // the flower drifts & hydrangeas, the glowing moss (fairy ring & trails) and
  // the cool light pooling under them at night (one draw)
  for (const m of drifts.meshes) addMesh(m);
  if (glowMoss.length) addMesh(glowMossMesh(glowMoss));
  glowPools.push(...giantPools);
  if (glowPools.length) {
    const pools = lightPools(glowPools, { height: getHeight, lift: 0.05 });
    pools.name = 'glow-pools';
    addMesh(pools);
  }

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
    // (one warm colour: a wire, a bulb and a halo draw per string)
    const lights = ctx.props.makeStringLights(pts, { sag: 0.04, spacing: 0.42, colors: ['#ffd98c'] });
    lights.name = 'forest-fairy-lights';
    group.add(lights);
    stats.drawCalls += 3;
  }

  // ── 7b. warm lanterns hanging from the giants' broken limbs (night magic) ──
  {
    const lant = canopyLanterns(ctx, rng.fork('canopy-lanterns'), plan.trees, { max: tier === 'low' ? 5 : 8, lights: tier === 'low' ? 0 : 2 });
    for (const m of lant.meshes) addMesh(m);
    stats.canopyLanterns = lant.lanterns.length;
  }

  lap('meshes');
  group.traverse((o) => {
    if (o.isMesh && !o.userData.keepRaycast) o.raycast = () => {};
  });
  // ── memory: nothing reads our static meshes' vertex data after the upload
  //    (the fairy ring — a hotspot — and the props' meshes are not in `owned`),
  //    and the builders' plain-JS vertex arrays and placement lists must not
  //    outlive the build (the closures we hand out keep this scope alive)
  //    (?vegcpu=keep skips all of it — for A/B heap checks and debugging)
  const keepCpu = ctx.engine?.params?.get?.('vegcpu') === 'keep';
  if (!keepCpu) {
    stats.freed = freeAfterUpload(owned);
    for (const B of [builders.bark, builders.birch, builders.ivy, rockB, moundB, stumpFaceB]) B.release();
    smallKit.release();
    giantKit.release();
  }

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
  // walkers (villagers, the player) go around trunks and giant stems
  if (ctx.colliders?.addCircle) {
    for (const t of plan.trees) if (Math.hypot(t.x, t.z) < 38) ctx.colliders.addCircle(t.x, t.z, t.radius * 1.15, 'tree');
    for (const g of giants) ctx.colliders.addCircle(g.x, g.z, g.R * 0.25, 'giant-mushroom');
  }

  // (counted like moduleStats(): every mesh of the module, fairy ring & lights included)
  let tris = 0;
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    tris += ((g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3) * (o.isInstancedMesh ? o.count : 1);
  });
  stats.triangles = Math.round(tris);
  stats.budget = VEG_BUDGET[tier] ?? VEG_BUDGET.high;
  stats.overBudget = stats.triangles > stats.budget;
  stats.ms = Math.round(performance.now() - t0);
  stats.timing = timing;
  stats.giants = giants.length;
  stats.giantHues = giants.reduce((o, g) => ((o[g.hue] = (o[g.hue] ?? 0) + 1), o), {});
  stats.trees = plan.trees.length;
  // leaf masses of the forest canopy as spheres (camera obstacles, leaf sources)
  const canopy = clumps.map((c) => ({ x: c.x, y: c.y, z: c.z, r: c.s * 1.05 }));
  ctx.forest = { trees, giants, canopy, glowSpots, flowerPatches, mossyRocks, snailRocks, logs, stumps, fairyRing: ringInfo };
  if (!keepCpu) {
    for (const l of [fernL, fernM, grassA, clover, bushes, bilberry, bramble, broad, shrubs, clumps, vigFerns, vigFox, vigBroad, glowMoss, glowPools, troops, logFamilies]) l.length = 0;
    for (const k of FLOWER_KINDS) flowers[k].length = 0;
    drifts.cover.length = 0;
    drifts.leaves.length = 0;
    occ.map.clear();
    recipeCache.clear();
  }
  return {
    group, trees, giants, canopy, glowSpots, flowerPatches, mossyRocks, snailRocks, logs, stumps, fairyRing: ringInfo, treesNear, stats, budget: VEG_BUDGET,
    update() {
      // enchanted gills & spots and the glowing moss follow the night
      updateMushroomGlow(ctx, ctx.env?.night ?? 0);
      updateGlowMoss(ctx.env?.night ?? 0);
    },
  };
}
