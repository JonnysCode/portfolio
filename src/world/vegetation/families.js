// ─────────────────────────────────────────────────────────────────────────────
// Mushroom FAMILIES — the way mushrooms really grow (refs: the fly-agaric
// forest path, the giant painterly mushrooms on the mossy mound): one big lead
// and three to seven smaller ones of the same species huddled around it, sizes
// falling off away from the lead, leaning outwards, a few buttons at their
// feet. Families sit where the mycelium lives — at tree feet, along roots and
// logs, at stumps and rocks, along the path edges — never as evenly scattered
// confetti over the lawns.
//
// Species (each with its own colours, cap shapes and proportions):
//   flyAgaric  red caps, white warts                 (the glen's signature)
//   panther    brown caps, white warts
//   ochre      ochre / tan caps, cream warts         (the painterly giants)
//   orange     smooth orange caps, yellow gills & stem (caesar's mushroom)
//   parasol    tall snakeskin stem with a loose ring; open parasols with a
//              dark umbo and brown scales beside half-open bells & drumsticks
//   bolete     fat porcini buns in chestnut, hazel, ochre
//   bonnets    tufts of slender brown bonnets
//
// placeFamily(kits, rng, x, z, opts) → number of mushrooms placed.
// ─────────────────────────────────────────────────────────────────────────────
import { CAP_REDS, CAP_BROWNS, CAP_OCHRES, CAP_ORANGES, CAP_TANS, CAP_BOLETES } from './mushrooms.js';
import { TAU } from './common.js';

/** Amanita-like species: colours, warts, gills, stems and the cap shapes they take (weights). */
export const SPECIES = {
  flyAgaric: { kind: 'amanita', caps: CAP_REDS, warts: 1, gill: '#f2e6cc', shapes: { dome: 5, flat: 3, cone: 1, upturned: 1 } },
  panther: { kind: 'amanita', caps: CAP_BROWNS, warts: 1, gill: '#efe2c6', shapes: { dome: 4, flat: 4, upturned: 2 } },
  ochre: { kind: 'amanita', caps: CAP_OCHRES, warts: 0.7, wart: '#f4e6c4', gill: '#efdcb4', shapes: { dome: 5, flat: 3, upturned: 2 } },
  orange: { kind: 'amanita', caps: CAP_ORANGES, warts: 0, gill: '#f2c868', stem: '#f0d890', shapes: { dome: 4, flat: 3, upturned: 3 } },
  parasol: { kind: 'parasol', caps: CAP_TANS, tall: 1.45 },
  bolete: { kind: 'bolete', caps: CAP_BOLETES },
  bonnets: { kind: 'bonnets', caps: ['#a87a4a', '#b8885a', '#c09868', '#946640', '#c8a878'] },
};

/** Species mix of the glen's families (weights): the fly agaric leads, but never alone. */
export const FAMILY_MIX = { flyAgaric: 30, ochre: 15, panther: 11, orange: 10, bolete: 16, parasol: 6, bonnets: 12 };

/** Weighted pick from { key: weight }. */
export function pickWeighted(rng, weights) {
  let tot = 0;
  for (const k in weights) tot += weights[k];
  let r = rng.next() * tot;
  for (const k in weights) if ((r -= weights[k]) < 0) return k;
  return Object.keys(weights)[0];
}

/**
 * One mushroom of a species. kits: { big, small } MushroomKits (big ones cast
 * shadows). opts: { height, lean, leanAz, lod, shape, color, glowGills, glowSpots, haloK, seg }
 */
export function placeMushroom(kits, rng, species, x, y, z, opts = {}) {
  const sp = SPECIES[species] ?? SPECIES.flyAgaric;
  const H = opts.height ?? 0.3;
  const kit = H > 0.8 ? kits.big : kits.small;
  if (sp.kind === 'bolete') {
    // (boletes are stout: shorter and fatter than an amanita of the same "size")
    const h = H * 0.62;
    kit.bolete(x, y, z, { height: h, capR: h * rng.range(0.62, 0.85), color: opts.color ?? rng.pick(sp.caps), lean: opts.lean, leanAz: opts.leanAz, poreColor: rng.chance(0.4) ? '#b8ac5a' : '#ddca82' });
    return;
  }
  if (sp.kind === 'parasol') {
    // (a family of different ages: the lead fully open, the others half-open
    //  bells and young drumsticks)
    const h = H * sp.tall;
    const age = opts.age ?? (opts.lead ? 1 : H < 0.16 ? 0.2 : pickWeighted(rng, { 1: 4, 0.55: 3, 0.2: 3 }) * 1);
    kit.parasol(x, y, z, { height: h, capR: h * rng.range(0.42, 0.52), age: Number(age), lean: opts.lean, leanAz: opts.leanAz, lod: opts.lod });
    return;
  }
  if (sp.kind === 'bonnets') {
    kit.bonnets(x, y, z, { height: Math.min(0.26, H * 0.55), count: rng.int(3, 6), color: opts.color ?? rng.pick(sp.caps), spread: 1.2 });
    return;
  }
  const h = H * (sp.tall ?? 1);
  // (little ones are dome-shaped buttons; the odd old giant has curled up)
  const shape = opts.shape ?? (H < 0.22 ? 'dome' : pickWeighted(rng, sp.shapes));
  const capK = shape === 'upturned' ? rng.range(0.55, 0.72) : shape === 'flat' ? rng.range(0.5, 0.68) : rng.range(0.44, 0.62);
  kit.amanita(x, y, z, {
    height: h,
    capR: h * capK * (sp.tall ? 0.85 : 1),
    shape,
    color: opts.color ?? rng.pick(sp.caps),
    warts: sp.warts * (shape === 'upturned' ? 0.6 : 1),
    wartColor: sp.wart,
    gillColor: sp.gill,
    stemColor: sp.stem,
    stemRatio: sp.stemRatio,
    ring: sp.stemRatio ? h > 0.3 : undefined,
    lean: opts.lean ?? rng.range(0.03, 0.18),
    leanAz: opts.leanAz,
    seg: opts.seg,
    lod: opts.lod,
    glowGills: opts.glowGills,
    glowSpots: opts.glowSpots && sp.warts > 0,
    haloK: opts.haloK ?? 2,
  });
}

/**
 * A family around (x, z). opts:
 *   species   key of SPECIES (default: picked from FAMILY_MIX)
 *   size      the lead's height (units)
 *   count     followers (default 3–7)
 *   spread    how far the family reaches (× the lead's size)
 *   ground(x, z, h) → y, or null where nothing may grow (h: the member's height)
 *   lod, glow (the lead's gills glow at night, a few followers too), grng (glow rng)
 *   onPlace(x, z, h) — called per member (occupancy …)
 *   side      optional azimuth the family spreads towards (a log's flank, away from a trunk)
 */
export function placeFamily(kits, rng, x, z, opts = {}) {
  const species = opts.species ?? pickWeighted(rng, FAMILY_MIX);
  const size = opts.size ?? rng.range(0.35, 0.8);
  const n = opts.count ?? rng.int(3, 7);
  const spread = (opts.spread ?? 1) * Math.max(0.35, size * 0.9);
  const glow = !!opts.glow;
  const grng = opts.grng ?? rng;
  let placed = 0;
  const y0 = opts.ground(x, z, size);
  if (y0 === null || y0 === undefined) return 0;
  // the lead: the biggest, most upright
  placeMushroom(kits, rng, species, x, y0, z, { height: size, lean: rng.range(0.02, 0.1), lod: opts.lod, glowGills: glow, glowSpots: glow, haloK: 1.8, lead: true });
  opts.onPlace?.(x, z, size);
  placed++;
  const a0 = opts.side ?? rng.range(0, TAU);
  const arc = opts.side !== undefined ? 1.3 : Math.PI;
  for (let i = 1; i <= n; i++) {
    const f = i / n; // 0 → 1 away from the lead
    const a = a0 + rng.range(-arc, arc);
    const d = spread * (0.35 + 0.85 * f) * rng.range(0.8, 1.15);
    const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
    // sizes fall off from the lead; the last ones are buttons
    const h = size * (0.82 - 0.62 * f) * rng.range(0.8, 1.12);
    const py = opts.ground(px, pz, h);
    if (py === null || py === undefined) continue;
    placeMushroom(kits, rng, species, px, py, pz, {
      height: Math.max(0.06, h),
      // leaning outwards, away from the crowd
      lean: rng.range(0.06, 0.26),
      leanAz: a + rng.jitter(0.4),
      lod: opts.lod,
      glowGills: glow && grng.chance(0.4),
    });
    opts.onPlace?.(px, pz, h);
    placed++;
  }
  // a tuft of bonnets or a button or two at the family's edge (mixed company)
  if (species !== 'bonnets' && rng.chance(0.45)) {
    const a = rng.range(0, TAU), d = spread * rng.range(0.9, 1.4);
    const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
    const py = opts.ground(px, pz, 0.12);
    if (py !== null && py !== undefined) {
      kits.small.bonnets(px, py, pz, { height: rng.range(0.08, 0.15), count: rng.int(3, 5), color: rng.pick(SPECIES.bonnets.caps) });
      placed++;
    }
  }
  return placed;
}
