// ─────────────────────────────────────────────────────────────────────────────
// The Great Oak's crown: painterly leaf MASSES made of alpha-tested leaf cards.
//
// Each clump the skeleton chose is a broad, layered PAD (≈ 1.3× wider than
// its size, ≈ 0.7× as tall) built from a heart and 4–6 lobes ringed round it,
// whose hem DROOPS (cards further out sit lower) — every pad with a sunlit,
// golden yellow-green top and a deep, cool blue-green belly, so the masses
// stack into lush layers with dark creases between them, not round pom-poms
// or one broccoli dome. Cards on the outer skin are bigger, so single sprigs
// break the silhouette even from the overview. The skirts and boughs trail
// short CURTAINS of hanging sprigs (8 % of the cards, not on the low tier).
// A few windows along the limbs and the odd knocked-out high clump (≈ 25–35 %
// of the cards) let the dark, kinked limbs and the sky show through; the
// treehouse and the hero moon stay in sight from the glen (shape.js).
// Everything is ONE vertex-coloured mesh. At night it becomes a dark
// blue-green silhouette: near-black bellies, a thin silver rim where the
// leaves face the moon, a warm bounce under the masses near the Code Loft and
// the lanterns (shader, follows the shared night uniform).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { SUN_LIGHT_DIR, MOON_LIGHT_DIR } from '../../world/env/celestial.js';
import { OAK } from '../../world/layout.js';
import { sharedUniforms } from '../../core/materials.js';
import { crownBlocked } from './shape.js';

const TAU = Math.PI * 2;
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

/** Deterministic per-card hash in [0, 1) (stable between the counting and the emitting pass). */
function hash2(a, b) {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * One clump template (unit radius; y squashed by `flat`, the underside by
 * `flat * bottom`) built from `lobes` sub-clumps around a central one. Cards
 * sit on the skin of the union of the lobes (a card that would land deep
 * inside a neighbouring lobe is re-rolled), so the outline is lumpy with dark
 * creases between the cushions.
 * Returns a BufferGeometry with position / normal / uv / index plus
 * `userData.aux` (per vertex: lobe-local height −1…1, innerness 0…1, clump-local height −1…1) and
 * `userData.mid` (per card: card centre, for gap culling).
 */
export function clumpTemplate(rng, cards, { flat = 0.78, size = [0.2, 0.32], bottom = 0.7, lobes = 4, shell = 1.4 } = {}) {
  const pos = new Float32Array(cards * 12);
  const nor = new Float32Array(cards * 12);
  const uv = new Float32Array(cards * 8);
  const idx = new Uint32Array(cards * 6);
  const aux = new Float32Array(cards * 12);
  const mid = new Float32Array(cards * 3);
  const fy = (y) => y * (y < 0 ? flat * bottom : flat);
  // lobes (unflattened unit space): one slightly low heart + a ring above/around it
  const L = [{ c: new THREE.Vector3(0, -0.08, 0), r: 0.58 }];
  const az0 = rng.range(0, TAU);
  for (let i = 0; i < lobes; i++) {
    // (lobes ringed round the heart, mostly sideways and a little up: one
    //  broad, layered pad with a lumpy hem — not a stack of round pom-poms)
    const az = az0 + (i / lobes) * TAU + rng.range(-0.45, 0.45);
    const el = rng.range(-0.3, 0.5);
    const dist = rng.range(0.45, 0.7);
    L.push({ c: new THREE.Vector3(Math.cos(el) * Math.sin(az) * dist, Math.sin(el) * dist, Math.cos(el) * Math.cos(az) * dist), r: rng.range(0.32, 0.48) });
  }
  let wsum = 0;
  for (const l of L) wsum += l.r * l.r;
  const c = new THREE.Vector3();
  const f = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const nl = new THREE.Vector3();
  const nc = new THREE.Vector3();
  const a = new THREE.Vector3();
  const lc = new THREE.Vector3();
  const UPV = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < cards; k++) {
    let lobe = L[0];
    let d = 1;
    let outer = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      let w = rng.next() * wsum;
      lobe = L[L.length - 1];
      for (const l of L) {
        w -= l.r * l.r;
        if (w <= 0) {
          lobe = l;
          break;
        }
      }
      let x, y, z, q;
      do {
        x = rng.range(-1, 1);
        y = rng.range(-1, 1);
        z = rng.range(-1, 1);
        q = x * x + y * y + z * z;
      } while (q > 1 || q < 0.01);
      q = Math.sqrt(q);
      dir.set(x / q, y / q, z / q);
      if (dir.y < 0 && rng.chance(0.3)) dir.y = -dir.y; // more leaves on top
      d = 0.6 + 0.4 * Math.pow(rng.next(), 0.5);
      // stray sprigs poking out of the skin break the outline (no smooth puff)
      if (d > 0.85 && rng.chance(0.22)) d = rng.range(1.05, 1.3);
      c.copy(lobe.c).addScaledVector(dir, lobe.r * d);
      let buried = false;
      for (const o of L) if (o !== lobe && c.distanceTo(o.c) < o.r * 0.8) buried = true;
      if (!buried) {
        outer = d > 0.8;
        break;
      }
    }
    // CARD CONVENTION (materials.foliage): the sprig's stem is at the bottom
    // centre of the UV square and it grows towards +V. The card's V axis points
    // out of its lobe (and a little up), its bottom edge inside the mass, and
    // it is rolled randomly around V.
    v.copy(dir).multiplyScalar(0.85);
    v.y += 0.35;
    v.add(tmp.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).multiplyScalar(0.45)).normalize();
    const ref = Math.abs(v.y) > 0.9 ? tmp.set(1, 0, 0) : UPV;
    u.crossVectors(ref, v).normalize();
    const roll = rng.range(0, Math.PI);
    f.crossVectors(u, v).normalize();
    a.copy(u).multiplyScalar(Math.cos(roll)).addScaledVector(f, Math.sin(roll)); // across
    // outer-skin sprigs are bigger (they make the silhouette), inner filler smaller
    const s = rng.range(size[0], size[1]) * (outer ? shell : 0.74);
    f.crossVectors(a, v).normalize(); // final card normal
    c.y = fy(c.y);
    lc.set(lobe.c.x, fy(lobe.c.y), lobe.c.z);
    // pull the base a little inwards so the sprig grows out of the mass
    c.addScaledVector(v, -s * 0.6);
    mid.set([c.x + v.x * s, c.y + v.y * s, c.z + v.z * s], k * 3);
    const flip = rng.chance(0.5);
    const corners = [
      [-1, 0, 0, 0],
      [1, 0, 1, 0],
      [1, 2, 1, 1],
      [-1, 2, 0, 1],
    ];
    const inner = outer ? 0 : THREE.MathUtils.clamp((0.92 - d) / 0.32, 0.25, 1);
    for (let qi = 0; qi < 4; qi++) {
      const [cx, cy, tu, tv] = corners[qi];
      const px = c.x + (a.x * cx + v.x * cy) * s;
      const py = c.y + (a.y * cx + v.y * cy) * s;
      const pz = c.z + (a.z * cx + v.z * cy) * s;
      const o = (k * 4 + qi) * 3;
      pos[o] = px;
      pos[o + 1] = py;
      pos[o + 2] = pz;
      // soft-volume normal: mostly the LOBE's sphere (each cushion shades on
      // its own), blended with the whole clump's sphere; biased upwards
      nl.set(px - lc.x, (py - lc.y) / (flat * flat), pz - lc.z);
      const lobeUp = nl.lengthSq() > 1e-8 ? nl.y / nl.length() : 0;
      nl.y += 0.25 * nl.length();
      nl.normalize();
      nc.set(px, py / (flat * flat), pz);
      nc.y += 0.25 * nc.length();
      nc.normalize();
      tmp.copy(nl).multiplyScalar(0.6).addScaledVector(nc, 0.4).normalize();
      const fd = f.dot(tmp) < 0 ? -0.15 : 0.15;
      tmp.multiplyScalar(0.85).addScaledVector(f, fd).normalize();
      nor[o] = tmp.x;
      nor[o + 1] = tmp.y;
      nor[o + 2] = tmp.z;
      const t = (k * 4 + qi) * 2;
      uv[t] = flip ? 1 - tu : tu;
      uv[t + 1] = tv;
      const ax = (k * 4 + qi) * 3;
      aux[ax] = THREE.MathUtils.clamp(lobeUp, -1, 1);
      aux[ax + 1] = inner;
      aux[ax + 2] = THREE.MathUtils.clamp(py / flat, -1, 1); // height in the whole clump
    }
    const i0 = k * 4;
    idx.set([i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3], k * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.userData.aux = aux;
  g.userData.mid = mid;
  g.computeBoundingSphere();
  return g;
}

/**
 * Holes in the crown: spheres along the limbs and the big branches (the dark
 * limbs show against the lit foliage beyond) and a few high clumps knocked
 * out completely (sky holes).
 */
function crownGaps(rng, clumps, limbs, branches) {
  const gaps = [];
  for (const L of limbs) {
    // two windows along every main limb: its dark, kinked bark shows against
    // the lit masses beyond (the long low limb keeps ONE, near the trunk — its
    // outer two thirds carry a full skirt that frames the glen)
    for (const [u0, u1] of L.id === 'front-left-low' ? [[0.3, 0.42]] : [[0.36, 0.5], [0.62, 0.8]]) {
      const u = rng.range(u0, u1);
      const p = L.curve.getPointAt(u);
      p.y += rng.range(0.3, 1.3);
      gaps.push({ c: p, r: 1.6 + L.radiusAt(u) * 1.15 + rng.range(0, 0.6) });
    }
  }
  for (const b of branches) {
    if (b.depth !== 1 || !rng.chance(0.22)) continue;
    const p = b.curve.getPointAt(rng.range(0.3, 0.6));
    p.y += 0.4;
    gaps.push({ c: p, r: rng.range(1.05, 1.5) });
  }
  // a few sky holes: high clumps knocked out (the backdrop shows through the
  // upper crown in the wide frames) — never the crowning masses on top
  for (const c of clumps) {
    if (c.tier === 1 && c.p.y > 22 && rng.chance(0.1)) gaps.push({ c: c.p.clone(), r: c.s * 0.75 });
  }
  return gaps;
}

/** Warm glows the crown's bellies pick up at night: the Code Loft and the lanterns on the low limb. */
const WARM_BOUNCE = [
  [OAK.loft.x, OAK.loft.y + 3.2, OAK.loft.z, 6.5, 1],
];

/**
 * 'oak' foliage clone (never mutates the cached material) that turns into a
 * dark silhouette at night: the tint slides 35 % towards a deep blue-green and
 * drops to 40 % (the giants' crowns stay green too), the bellies go near-black
 * green, a thin silver rim lights the edges that face the moon, and the
 * undersides near the Code Loft and the lanterns catch a warm bounce.
 * `bounce`: extra [x, y, z, radius, strength] warm sources.
 */
function moonlitCrownMaterial(base, bounce = []) {
  const m = base.clone();
  m.name = `${base.name}-oak-crown`;
  const prev = m.onBeforeCompile;
  const moon = MOON_LIGHT_DIR.clone().normalize();
  const src = [...WARM_BOUNCE, ...bounce].slice(0, 4);
  while (src.length < 4) src.push([0, -999, 0, 1, 0]);
  const v3 = (v) => `vec3(${v.map((x) => x.toFixed(3)).join(', ')})`;
  const bounceGlsl = src.map(([x, y, z, r, k]) => `oakWarm += ${k.toFixed(3)} * exp(-dot(oW - ${v3([x, y, z])}, oW - ${v3([x, y, z])}) / ${(r * r).toFixed(2)});`).join('\n    ');
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    shader.uniforms.uOakNight = sharedUniforms.uNight;
    // moonlight scattered through the leaves (the foliage translucency) turned
    // every crown top into frosted felt: at night the crown keeps only a
    // trace of it — a dark silhouette, the silver lives in the thin rim below
    shader.fragmentShader = shader.fragmentShader.replace(
      'float t = (0.35 * back + 0.9 * toward) * sfLight.y;',
      'float t = (0.35 * back + 0.9 * toward) * sfLight.y * (1.0 - 0.8 * uOakNight);'
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uOakNight;\nfloat oakUnder;\n#define MOON_DIR ${v3([moon.x, moon.y, moon.z])}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  {
    // night: a dark blue-green silhouette (not lit felt): 35 % towards a deep
    // blue-green of the same value, down to 40 %; the bellies near-black green
    float oakL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    // (the day's sun-kissed sprig tips are near white: at night the value
    //  range is squeezed, or every lit tip turns into pale frost)
    diffuseColor.rgb *= mix(1.0, min(1.0, (0.05 + 0.5 * oakL) / max(oakL, 0.02)), uOakNight);
    oakL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    vec3 oakDeep = oakL * vec3(0.52, 1.0, 0.96);
    vec3 oakUpV = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
    oakUnder = smoothstep(0.1, -0.5, dot(normalize(vNormal), oakUpV));
    // (the tops that face the moon are held back too: a silhouette with a
    //  silver edge, not a frosted, moon-lit felt)
    vec3 oakMoonV = normalize((viewMatrix * vec4(MOON_DIR, 0.0)).xyz);
    float oakMoonLit = clamp(dot(normalize(vNormal), oakMoonV), 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, oakDeep, 0.35 * uOakNight) * mix(1.0, 0.4 * (1.0 - 0.62 * oakUnder) * (1.0 - 0.7 * oakMoonLit), uOakNight);
    // (green, not neutral grey, under the blue moonlight)
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.86, 1.0, 0.9), uOakNight);
  }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  if (uOakNight > 0.01) {
    vec3 oN = normalize(vNormal);
    vec3 oV = normalize(vViewPosition);
    vec3 oM = normalize((viewMatrix * vec4(MOON_DIR, 0.0)).xyz);
    // a thin silver rim on the edges of the masses that face the moon
    float oFres = 1.0 - clamp(abs(dot(oN, oV)), 0.0, 1.0);
    float oF2 = oFres * oFres;
    float oF4 = oF2 * oF2;
    float oRim = smoothstep(0.15, 0.8, dot(oN, oM)) * oF4 * oF4;
    float oLeaf = 0.55 + 2.2 * dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    totalEmissiveRadiance += vec3(0.46, 0.6, 0.74) * oRim * 0.1 * oLeaf * uOakNight;
    // warm bounce under the masses near the loft & the lanterns
    vec3 oW = (vec4(-vViewPosition, 0.0) * viewMatrix).xyz + cameraPosition;
    float oakWarm = 0.0;
    ${bounceGlsl}
    totalEmissiveRadiance += vec3(1.0, 0.55, 0.22) * min(oakWarm, 1.0) * (0.25 + 0.75 * oakUnder) * 0.075 * oLeaf * uOakNight;
  }`
      );
  };
  const key = m.customProgramCacheKey();
  m.customProgramCacheKey = () => `${key}|oak-crown-night8`;
  return m;
}

/**
 * The crown as ONE merged, vertex-coloured mesh of leaf cards.
 * opts: { density, limbs, branches } (limbs/branches from the skeleton, for the gaps).
 * Returns { meshes, bounds (Box3), cards }.
 *
 * Every clump is a broad, layered PAD — about 1.4× wider than its size and
 * 0.72× as tall — whose hem droops (the cards further out from its heart sit
 * lower), and the skirts and boughs trail short CURTAINS of hanging sprigs:
 * lush, drooping, wider-than-tall masses instead of round pom-poms. (The
 * anisotropy moves the card centres only — every sprig card keeps its own
 * shape, nothing is squashed.)
 */
export function buildCrown(ctx, rng, clumpsIn, { density = 1, limbs = [], branches = [], bounce = [] } = {}) {
  const { materials } = ctx;
  // lumpy masses with flatter bellies
  const templates = [
    { flat: 0.74, bottom: 0.6, lobes: 5 },
    { flat: 0.82, bottom: 0.66, lobes: 6 },
    { flat: 0.68, bottom: 0.56, lobes: 4 },
  ];
  // leaf-card budget at high density, whatever the number of clumps (overdraw
  // of stacked alpha-tested cards is the real cost, not the triangle count);
  // a share of it trails as hanging sprig curtains (none on the low tier)
  const budgetAll = (ctx.engine?.params?.get('oakcards') ? +ctx.engine.params.get('oakcards') : 20000) * density;
  const curtainShare = density >= 0.45 ? 0.08 : 0;
  const budget = budgetAll * (1 - curtainShare);
  // (the clumps a touch smaller than the skeleton asked for: the wide pads
  //  overlap into one lush mass, with dark creases between them)
  let clumps = clumpsIn.map((c) => ({ ...c, s: c.s * 0.87 }));
  // on lower tiers keep the cards per clump sensible and drop the least
  // important clumps instead (hanging skirt first, then twig tips)
  const MIN_CARDS = 44;
  if (budget / Math.max(1, clumps.length) < MIN_CARDS) {
    const keep = Math.max(24, Math.floor(budget / MIN_CARDS));
    const prio = (c) => ({ 0: 0, 1: 1, 2: 2, 3: 3 })[c.tier] ?? 3;
    clumps = clumps
      .map((c, i) => ({ c, k: prio(c) + rng.next() * 0.9 + i * 1e-6 }))
      .sort((a, b) => a.k - b.k)
      .slice(0, keep)
      .map((e) => e.c);
  }

  // per-clump placement (fixed before the card count is settled):
  // M  = the pad's anisotropic frame (card CENTRES: wide & flat),
  // L  = rotation × uniform size (the cards' own shape), size = that scale
  const place = clumps.map((c, ci) => {
    const under = c.tier === 3 || c.tier === 2;
    const t = under ? (rng.chance(0.5) ? 2 : ci % 2) : ci % 2;
    _e.set(rng.range(-0.16, 0.16), rng.range(0, Math.PI * 2), rng.range(-0.16, 0.16));
    _q.setFromEuler(_e);
    // masses of different sizes (no stack of equal puffs), spread wide and
    // flat like an old oak's layered foliage pads
    const hk = hash2(c.p.x * 0.37 + c.p.z, c.p.y * 0.61);
    const k = c.tier === 0 ? 1.08 + 0.2 * hk : 0.8 + 0.45 * hk * hk;
    const size = c.s * k;
    const wide = c.tier === 0 ? rng.range(1.15, 1.32) : rng.range(1.2, 1.42);
    const tall = c.tier === 0 ? rng.range(0.74, 0.86) : rng.range(0.66, 0.8);
    _s.set(size * wide * rng.range(0.92, 1.08), size * tall, size * wide * rng.range(0.92, 1.08));
    const M = new THREE.Matrix4().compose(c.p, _q, _s);
    const L = new THREE.Matrix4().compose(new THREE.Vector3(), _q, new THREE.Vector3(size, size, size));
    // hems droop: the skirts and boughs more than the crowning tops
    const droop = c.tier === 0 ? 0.35 : c.tier === 3 ? 0.75 : 0.6;
    return { t, M, L, size, droop, under, drift: rng.range(-1, 1), shade: rng.range(0.9, 1.06) };
  });
  /** World centre of card k of clump ci (template card centre `mid`): the pad's frame + its drooping hem. */
  const cardCentre = (pl, mid, k, out) => {
    out.fromArray(mid, k * 3);
    const rho = Math.hypot(out.x, out.z);
    const d = pl.droop * (Math.max(0, rho - 0.3) ** 2 + (out.y < 0 ? 0.35 * rho * -out.y : 0));
    out.applyMatrix4(pl.M);
    out.y -= d * pl.size;
    return out;
  };
  // creases: a card that lies INSIDE a neighbouring pad is buried in the
  // mass — darken it (and keep the sun off it), so where pads overlap the
  // crown shows dark folds between lit layers instead of one even green dome
  const invM = place.map((pl) => new THREE.Matrix4().copy(pl.M).invert());
  const CELL = 6;
  const grid = new Map();
  const cellKey = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  clumps.forEach((c, ci) => {
    const k = cellKey(c.p.x, c.p.y, c.p.z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(ci);
  });
  const _o = new THREE.Vector3();
  const buried = (p, self) => {
    let occ = 0;
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), cz = Math.floor(p.z / CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!list) continue;
          for (const j of list) {
            if (j === self) continue;
            _o.copy(p).applyMatrix4(invM[j]);
            const d = Math.hypot(_o.x, _o.y / 0.75, _o.z);
            if (d < 1.05) occ += THREE.MathUtils.smoothstep(1.05 - d, 0, 0.55);
          }
        }
    return Math.min(1, occ);
  };
  const gaps = crownGaps(rng.fork('gaps'), clumps, limbs, branches);
  const tv = new THREE.Vector3();
  const inGap = (p, ci, k) => {
    // (a card of a wide pad that would reach into a spot camera's view or the
    //  Code Loft is dropped too — the views stay clear card by card)
    if (crownBlocked(p, 0.3)) return true;
    for (const g of gaps) {
      const r = g.r * (0.78 + 0.44 * hash2(ci + 0.37, k)); // ragged rims
      // ellipsoids, taller than wide: windows that read from above and below
      const dx = p.x - g.c.x, dy = (p.y - g.c.y) * 0.55, dz = p.z - g.c.z;
      if (dx * dx + dy * dy + dz * dz < r * r) return true;
    }
    return false;
  };
  const makeGeos = (per) => {
    const grow = Math.sqrt(380 / per);
    return templates.map((t, i) =>
      clumpTemplate(rng.fork('clump' + i), per, { flat: t.flat, bottom: t.bottom, lobes: t.lobes, size: [0.14 * grow, 0.22 * grow], shell: 1.75 })
    );
  };
  const countKept = (geos, per) => {
    let kept = 0;
    place.forEach((pl, ci) => {
      const mid = geos[pl.t].userData.mid;
      for (let k = 0; k < per; k++) if (!inGap(cardCentre(pl, mid, k, tv), ci, k)) kept++;
    });
    return kept;
  };
  // the gaps remove cards: hand their share to the cards that stay
  let perClump = Math.max(MIN_CARDS, Math.min(420, Math.round(budget / Math.max(1, clumps.length))));
  let geos = makeGeos(perClump);
  const keepFrac = countKept(geos, perClump) / Math.max(1, perClump * clumps.length);
  const per2 = Math.max(MIN_CARDS, Math.min(420, Math.round(budget / Math.max(1, clumps.length * Math.max(0.4, keepFrac)))));
  if (per2 !== perClump) {
    geos.forEach((g) => g.dispose());
    perClump = per2;
    geos = makeGeos(perClump);
  }

  // mass centres: the centroid of each limb's clumps (a little low, so the
  // tops of the masses catch the light)
  const centres = new Map();
  for (const c of clumps) {
    const e = centres.get(c.limb) ?? { p: new THREE.Vector3(), w: 0 };
    e.p.addScaledVector(c.p, c.s);
    e.w += c.s;
    centres.set(c.limb, e);
  }
  for (const e of centres.values()) {
    e.p.multiplyScalar(1 / e.w);
    e.p.y -= 2.5;
  }
  // each limb's mass spans this height range: its top is sunlit, its belly
  // dark — one big gradient across the mass, so the clumps merge into
  // painterly masses instead of reading as a stack of separate lit puffs
  const massY = new Map();
  for (const c of clumps) {
    const e = massY.get(c.limb) ?? { lo: Infinity, hi: -Infinity };
    e.lo = Math.min(e.lo, c.p.y - c.s * 0.55);
    e.hi = Math.max(e.hi, c.p.y + c.s * 0.75);
    massY.set(c.limb, e);
  }
  let yMin = Infinity, yMax = -Infinity;
  for (const c of clumps) {
    yMin = Math.min(yMin, c.p.y);
    yMax = Math.max(yMax, c.p.y);
  }

  const curtainCards = Math.round(budgetAll * curtainShare);
  const maxCards = clumps.length * perClump + curtainCards;
  const pos = new Float32Array(maxCards * 12);
  const nor = new Float32Array(maxCards * 12);
  const col = new Float32Array(maxCards * 12);
  const uv = new Float32Array(maxCards * 8);
  const bounds = new THREE.Box3();
  const NM = new THREE.Matrix3();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const m = new THREE.Vector3();
  const cc = new THREE.Vector3();
  const mc = new THREE.Vector3();
  // painterly palette (sRGB → linear via THREE.Color): olive & sage, not neon
  const UNDER = new THREE.Color('#263f3d'); // deep blue-green / teal bellies
  const MID = new THREE.Color('#667b4f'); // olive green
  const SAGE = new THREE.Color('#5f7a5e');
  const OLIVE = new THREE.Color('#7a7d48');
  const TOP = new THREE.Color('#b6b257'); // warm yellow-green crowns
  const SUNLIT = new THREE.Color('#d2b553'); // sun-kissed, GOLDEN sprig tips (gold, not cream)
  const sunDir = SUN_LIGHT_DIR.clone().normalize();
  // (the low tier renders without the full post: its sun-kissed tips are held
  //  back so the crown's top never bleaches to cream)
  const sunK = density < 0.45 ? 0.6 : 1;
  const hue = new THREE.Color();
  const tmpC = new THREE.Color();
  let cards = 0;
  const keptBy = {}, totalBy = {};

  clumps.forEach((c, ci) => {
    const pl = place[ci];
    const g = geos[pl.t];
    NM.getNormalMatrix(pl.M);
    const centre = centres.get(c.limb).p;
    const my = massY.get(c.limb);
    // per-clump hue: olive ↔ sage drift; height in the crown makes it warmer
    const h = THREE.MathUtils.clamp((c.p.y - yMin) / Math.max(1, yMax - yMin) + pl.drift * 0.15, 0, 1);
    hue.copy(MID).lerp(pl.drift > 0 ? OLIVE : SAGE, Math.abs(pl.drift) * 0.7);
    // (the upper rims catch the low gold sun: more of it the higher the mass)
    const topK = pl.under ? 0.35 : 0.6 + 0.5 * h;
    const gp = g.attributes.position.array;
    const gn = g.attributes.normal.array;
    const gu = g.attributes.uv.array;
    const aux = g.userData.aux;
    const mid = g.userData.mid;
    for (let k = 0; k < perClump; k++) {
      cardCentre(pl, mid, k, cc);
      if (inGap(cc, ci, k)) continue;
      const occ = buried(cc, ci);
      mc.fromArray(mid, k * 3);
      for (let qi = 0; qi < 4; qi++) {
        const sv = k * 4 + qi;
        // the card keeps its shape: its corners around the (moved) centre
        v.set(gp[sv * 3] - mc.x, gp[sv * 3 + 1] - mc.y, gp[sv * 3 + 2] - mc.z).applyMatrix4(pl.L).add(cc);
        n.set(gn[sv * 3], gn[sv * 3 + 1], gn[sv * 3 + 2]).applyMatrix3(NM).normalize();
        m.copy(v).sub(centre);
        m.y += 0.3 * m.length();
        m.normalize();
        n.multiplyScalar(0.62).addScaledVector(m, 0.38).normalize();
        const o = (cards * 4 + qi) * 3;
        pos[o] = v.x;
        pos[o + 1] = v.y;
        pos[o + 2] = v.z;
        nor[o] = n.x;
        nor[o + 1] = n.y;
        nor[o + 2] = n.z;
        // value: lit cushion tops, dark cool bellies (≈0.5 × value), darker inside
        // (the clump-scale gradient survives the overview's depth of field;
        // the lobe-scale one gives each cushion its own lit cap up close)
        const lobeLight = 0.5 + 0.5 * aux[sv * 3];
        const inner = aux[sv * 3 + 1];
        const clumpLight = 0.5 + 0.5 * aux[sv * 3 + 2];
        const massLight = THREE.MathUtils.clamp((v.y - my.lo) / Math.max(1, my.hi - my.lo), 0, 1);
        // (each pad's own top-to-belly gradient weighs most: the layered masses
        //  read as pads stacked with dark creases, not one blob)
        let light = THREE.MathUtils.clamp(0.2 * massLight + 0.46 * clumpLight + 0.16 * lobeLight + 0.18 * (0.5 + 0.5 * n.y), 0, 1);
        if (pl.under) light *= 0.8;
        light = light * light * (3 - 2 * light);
        tmpC.copy(UNDER).lerp(hue, THREE.MathUtils.smoothstep(light, 0.12, 0.62));
        tmpC.lerp(TOP, THREE.MathUtils.smoothstep(light, 0.56, 1) * (0.45 + 0.45 * h) * (pl.under ? 0.5 : 1));
        tmpC.multiplyScalar((0.56 + 0.44 * light) * (1 - 0.22 * inner) * (1 - 0.5 * occ) * pl.shade);
        // …and warm, golden sprig tips where the top of a mass faces the sun
        const sf = Math.max(0, n.dot(sunDir) * 0.6 + n.y * 0.62);
        tmpC.lerp(SUNLIT, Math.min(0.62, sf * sf * topK * (1 - inner) * (1 - occ)) * sunK);
        col[o] = tmpC.r;
        col[o + 1] = tmpC.g;
        col[o + 2] = tmpC.b;
        const t = (cards * 4 + qi) * 2;
        uv[t] = gu[sv * 2];
        uv[t + 1] = gu[sv * 2 + 1];
        bounds.expandByPoint(v);
      }
      cards++;
      keptBy[c.limb] = (keptBy[c.limb] ?? 0) + 1;
    }
    totalBy[c.limb] = (totalBy[c.limb] ?? 0) + perClump;
  });
  geos.forEach((g) => g.dispose());

  // ── sprig curtains: short strands of hanging leaves trailing from the hems
  //    of the skirts and boughs (the oak's lush, drooping underside) ────────
  let curtains = 0;
  if (curtainCards > 0) {
    const crng = rng.fork('curtains');
    const hosts = [];
    clumps.forEach((c, ci) => {
      if ((c.tier === 3 || (c.tier === 1 && crng.chance(0.55))) && c.p.y > 13) hosts.push(ci);
    });
    const perHost = Math.max(2, Math.min(9, Math.round(curtainCards / Math.max(1, hosts.length))));
    const down = new THREE.Vector3();
    const across = new THREE.Vector3();
    const face = new THREE.Vector3();
    const base = new THREE.Vector3();
    const tip = new THREE.Vector3();
    const corners = [
      [-1, 0, 0, 0],
      [1, 0, 1, 0],
      [1, 2, 1, 1],
      [-1, 2, 0, 1],
    ];
    for (const ci of hosts) {
      const c = clumps[ci];
      const pl = place[ci];
      const centre = centres.get(c.limb).p;
      hue.copy(MID).lerp(pl.drift > 0 ? OLIVE : SAGE, Math.abs(pl.drift) * 0.7);
      let left = perHost;
      while (left > 0 && cards < maxCards) {
        // hang point on the pad's belly, out towards its drooping hem
        const th = crng.range(0, TAU);
        const rho = crng.range(0.45, 0.95);
        tv.set(Math.sin(th) * rho, -0.42, Math.cos(th) * rho);
        const mid = [tv.x, tv.y, tv.z];
        cardCentre(pl, mid, 0, base);
        const nCards = Math.min(left, crng.int(2, 4));
        left -= nCards;
        const sc = crng.range(0.26, 0.36) * THREE.MathUtils.clamp(pl.size / 2.4, 0.8, 1.25);
        // the strand leans a little out of the mass and sways sideways
        face.set(base.x - c.p.x, 0, base.z - c.p.z);
        if (face.lengthSq() < 1e-4) face.set(1, 0, 0);
        face.normalize();
        const lean = crng.range(0.05, 0.22);
        const sway = crng.range(-0.18, 0.18);
        for (let i = 0; i < nCards; i++) {
          const t = i / Math.max(1, nCards - 1);
          down.set(face.x * lean + face.z * sway, -1, face.z * lean - face.x * sway).normalize();
          // the card faces out of the mass, rolled a little
          across.crossVectors(down, face).normalize();
          const roll = crng.range(-0.6, 0.6);
          across.applyAxisAngle(down, roll);
          const s = sc * (1 - 0.18 * t);
          // never into a spot camera's view or a window
          tip.copy(base).addScaledVector(down, s);
          if (inGap(tip, ci, 1000 + curtains)) break;
          // belly greens, a little lighter towards the tips (back-lit leaves)
          const val = 0.5 + 0.12 * t;
          tmpC.copy(UNDER).lerp(hue, 0.42 + 0.22 * t).multiplyScalar((0.62 + 0.22 * val) * pl.shade);
          m.copy(tip).sub(centre);
          m.y = 0.15 * m.length();
          m.normalize();
          for (let qi = 0; qi < 4; qi++) {
            const [cx, cy, tu, tvv] = corners[qi];
            v.copy(base).addScaledVector(across, cx * s).addScaledVector(down, cy * s);
            const o = (cards * 4 + qi) * 3;
            pos[o] = v.x;
            pos[o + 1] = v.y;
            pos[o + 2] = v.z;
            nor[o] = m.x;
            nor[o + 1] = m.y;
            nor[o + 2] = m.z;
            col[o] = tmpC.r;
            col[o + 1] = tmpC.g;
            col[o + 2] = tmpC.b;
            const tt = (cards * 4 + qi) * 2;
            uv[tt] = (i + ci) % 2 ? 1 - tu : tu;
            uv[tt + 1] = tvv;
            bounds.expandByPoint(v);
          }
          cards++;
          curtains++;
          // the next sprig hangs from this one's lower third (they overlap)
          base.addScaledVector(down, s * 1.45);
        }
      }
    }
  }

  const idx = new Uint32Array(cards * 6);
  for (let k = 0; k < cards; k++) {
    const i0 = k * 4;
    idx.set([i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3], k * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, cards * 12), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor.slice(0, cards * 12), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col.slice(0, cards * 12), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv.slice(0, cards * 8), 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  // world-space geometry: sway grows above the crown's underside (y ≈ 12)
  const material = moonlitCrownMaterial(materials.foliage({ variant: 'oak', vertexColors: true, wind: { strength: 0.0045, base: 12 } }), bounce);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'oak-leaves';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return { meshes: [mesh], bounds, cards, curtains, gapFraction: 1 - (cards - curtains) / Math.max(1, clumps.length * perClump), gaps: gaps.length, keptBy, totalBy };
}
