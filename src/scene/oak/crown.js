// ─────────────────────────────────────────────────────────────────────────────
// The Great Oak's crown: painterly leaf MASSES made of alpha-tested leaf cards.
//
// A few clump templates (a few hundred cards each, arranged in a squashed
// sphere, denser at the shell) are placed at the clump spots the skeleton
// chose and merged into ONE vertex-coloured mesh. Card normals are bent
// towards the clump's sphere AND the larger mass of its limb, so the crown
// shades like big soft volumes with a clumpy sub-structure — sunlit crowns,
// darker cool undersides — the way a background painter blocks in foliage.
// Vertex colours carry the painterly variation (warm on top, blue-green in
// the hanging underside, per-clump drift).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { SUN_LIGHT_DIR } from '../../world/env/celestial.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

/**
 * One clump template (unit radius; y squashed by `flat`).
 * cards: number of leaf cards; size: [min, max] half-size of a card.
 */
export function clumpTemplate(rng, cards, { flat = 0.78, size = [0.2, 0.32], bottom = 0.7 } = {}) {
  const pos = new Float32Array(cards * 12);
  const nor = new Float32Array(cards * 12);
  const uv = new Float32Array(cards * 8);
  const idx = new Uint32Array(cards * 6);
  const c = new THREE.Vector3();
  const f = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const sn = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const UPV = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < cards; k++) {
    // random direction, more cards towards the top & the outer shell
    let x, y, z, l;
    do {
      x = rng.range(-1, 1);
      y = rng.range(-1, 1);
      z = rng.range(-1, 1);
      l = x * x + y * y + z * z;
    } while (l > 1 || l < 0.01);
    l = Math.sqrt(l);
    x /= l;
    y /= l;
    z /= l;
    if (y < 0 && rng.chance(0.35)) y = -y; // more leaves on top
    const d = 0.32 + 0.68 * Math.pow(rng.next(), 0.45);
    c.set(x * d, y * d * (y < 0 ? flat * bottom : flat), z * d);
    // spherical normal of the (squashed) volume
    sn.set(c.x, c.y / (flat * flat), c.z).normalize();
    // CARD CONVENTION (materials.foliage): the sprig's stem is at the bottom
    // centre of the UV square and it grows towards +V. So the card's V axis
    // points outwards (and a little up) from the clump's heart, its bottom
    // edge sits inside the mass, and it is rolled randomly around V.
    v.copy(sn).multiplyScalar(0.85);
    v.y += 0.35;
    v.add(tmp.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).multiplyScalar(0.45)).normalize();
    const ref = Math.abs(v.y) > 0.9 ? tmp.set(1, 0, 0) : UPV;
    u.crossVectors(ref, v).normalize();
    const roll = rng.range(0, Math.PI);
    f.crossVectors(u, v).normalize(); // card normal before roll
    const a = new THREE.Vector3().copy(u).multiplyScalar(Math.cos(roll)).addScaledVector(f, Math.sin(roll)); // across
    const s = rng.range(size[0], size[1]);
    f.crossVectors(a, v).normalize(); // final card normal
    // pull the base a little inwards so the sprig grows out of the mass
    c.addScaledVector(v, -s * 0.6);
    const flip = rng.chance(0.5);
    const corners = [
      [-1, 0, 0, 0],
      [1, 0, 1, 0],
      [1, 2, 1, 1],
      [-1, 2, 0, 1],
    ];
    for (let q = 0; q < 4; q++) {
      const [cx, cy, tu, tv] = corners[q];
      const px = c.x + (a.x * cx + v.x * cy) * s;
      const py = c.y + (a.y * cx + v.y * cy) * s;
      const pz = c.z + (a.z * cx + v.z * cy) * s;
      const o = (k * 4 + q) * 3;
      pos[o] = px;
      pos[o + 1] = py;
      pos[o + 2] = pz;
      // soft-volume normal: mostly the clump's sphere normal at this corner
      // (biased upwards — canopies are lit from above), a touch of the card
      tmp.set(px, py / (flat * flat), pz);
      tmp.y += 0.25 * tmp.length();
      tmp.normalize();
      const fd = f.dot(tmp) < 0 ? -0.15 : 0.15;
      tmp.multiplyScalar(0.85).addScaledVector(f, fd).normalize();
      nor[o] = tmp.x;
      nor[o + 1] = tmp.y;
      nor[o + 2] = tmp.z;
      const t = (k * 4 + q) * 2;
      uv[t] = flip ? 1 - tu : tu;
      uv[t + 1] = tv;
    }
    const i0 = k * 4;
    idx.set([i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3], k * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * The crown as ONE merged, vertex-coloured mesh of leaf cards. Each clump is
 * a transformed copy of one of a few templates; its card normals are blended
 * between the clump's own sphere and the larger mass of its limb, so light
 * falls on big painterly masses that still have a clumpy sub-structure.
 * Vertex colours carry the painterly variation (warm sunlit crowns, cool
 * blue-green undersides, per-clump drift).
 * Returns { meshes, bounds (Box3), cards }.
 */
export function buildCrown(ctx, rng, clumps, { density = 1 } = {}) {
  const { materials } = ctx;
  const templates = [
    { flat: 0.74, bottom: 0.62 },
    { flat: 0.86, bottom: 0.72 },
    { flat: 0.66, bottom: 0.55 },
  ];
  // leaf-card budget at high density, whatever the number of clumps (overdraw
  // of stacked alpha-tested cards is the real cost, not the triangle count)
  const budget = (ctx.engine?.params?.get('oakcards') ? +ctx.engine.params.get('oakcards') : 20000) * density;
  // on lower tiers keep the cards per clump sensible and drop the least
  // important clumps instead (hanging skirt first, then twig tips)
  const MIN_CARDS = 48;
  if (budget / Math.max(1, clumps.length) < MIN_CARDS) {
    const keep = Math.max(24, Math.floor(budget / MIN_CARDS));
    const prio = (c) => ({ 0: 0, 1: 1, 2: 2, 3: 3 })[c.tier] ?? 3;
    clumps = clumps
      .map((c, i) => ({ c, k: prio(c) + rng.next() * 0.9 + i * 1e-6 }))
      .sort((a, b) => a.k - b.k)
      .slice(0, keep)
      .map((e) => e.c);
  }
  const perClump = Math.max(MIN_CARDS, Math.min(420, Math.round(budget / Math.max(1, clumps.length))));
  // fewer cards → slightly bigger cards so the masses stay closed
  const grow = Math.sqrt(380 / perClump);
  const geos = templates.map((t, i) =>
    clumpTemplate(rng.fork('clump' + i), perClump, { flat: t.flat, bottom: t.bottom, size: [0.17 * grow, 0.27 * grow] })
  );

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
  let yMin = Infinity, yMax = -Infinity;
  for (const c of clumps) {
    yMin = Math.min(yMin, c.p.y);
    yMax = Math.max(yMax, c.p.y);
  }

  const vPer = perClump * 4;
  const total = clumps.length * vPer;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const idx = new Uint32Array(clumps.length * perClump * 6);
  const bounds = new THREE.Box3();
  const M = new THREE.Matrix4();
  const NM = new THREE.Matrix3();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const m = new THREE.Vector3();
  // painterly palette (sRGB → linear via THREE.Color)
  const sunny = new THREE.Color('#86ad45');
  const warm = new THREE.Color('#5f9440');
  const deep = new THREE.Color('#3d7a47');
  const cool = new THREE.Color('#33685a');
  // sun-kissed leaf tips on the tops of the masses (a painter's highlight)
  const sunlit = new THREE.Color('#b9cc5c');
  const sunDir = SUN_LIGHT_DIR.clone().normalize();
  const cc = new THREE.Color();
  const tmpC = new THREE.Color();

  clumps.forEach((c, ci) => {
    const under = c.tier === 3 || c.tier === 2;
    const t = under ? (rng.chance(0.5) ? 2 : ci % 2) : ci % 2;
    const g = geos[t];
    _e.set(rng.range(-0.2, 0.2), rng.range(0, Math.PI * 2), rng.range(-0.2, 0.2));
    _q.setFromEuler(_e);
    _s.set(c.s * rng.range(0.88, 1.18), c.s * rng.range(0.78, 1.0), c.s * rng.range(0.88, 1.18));
    M.compose(c.p, _q, _s);
    NM.getNormalMatrix(M);
    const centre = centres.get(c.limb).p;
    // per-clump colour: height in the crown + drift; the hanging underside is cooler
    const h = THREE.MathUtils.clamp((c.p.y - yMin) / Math.max(1, yMax - yMin) + rng.range(-0.2, 0.2), 0, 1);
    cc.copy(deep).lerp(warm, h);
    if (under) cc.lerp(cool, rng.range(0.15, 0.45));
    // the crowning masses (limb & branch tips high up) are noticeably sunnier
    if (!under && h > 0.42) cc.lerp(sunny, Math.min(0.75, (h - 0.42) * 1.5));
    else if (rng.chance(0.12)) cc.lerp(sunny, 0.5);
    cc.multiplyScalar(rng.range(0.9, 1.08));
    const topK = under ? 0.35 : 0.6 + 0.6 * h;
    const gp = g.attributes.position.array;
    const gn = g.attributes.normal.array;
    const gu = g.attributes.uv.array;
    const base = ci * vPer;
    for (let k = 0; k < vPer; k++) {
      v.set(gp[k * 3], gp[k * 3 + 1], gp[k * 3 + 2]).applyMatrix4(M);
      n.set(gn[k * 3], gn[k * 3 + 1], gn[k * 3 + 2]).applyMatrix3(NM).normalize();
      m.copy(v).sub(centre);
      m.y += 0.3 * m.length();
      m.normalize();
      n.multiplyScalar(0.5).addScaledVector(m, 0.5).normalize();
      const o = (base + k) * 3;
      pos[o] = v.x;
      pos[o + 1] = v.y;
      pos[o + 2] = v.z;
      nor[o] = n.x;
      nor[o + 1] = n.y;
      nor[o + 2] = n.z;
      // a touch lighter where the mass faces up, darker deep underneath…
      tmpC.copy(cc).multiplyScalar(0.86 + 0.24 * (n.y * 0.5 + 0.5));
      // …and warm, light leaf tips where the top of a mass faces the sun
      const sf = Math.max(0, n.dot(sunDir) * 0.7 + n.y * 0.45);
      tmpC.lerp(sunlit, Math.min(0.62, sf * sf * topK));
      col[o] = tmpC.r;
      col[o + 1] = tmpC.g;
      col[o + 2] = tmpC.b;
      uv[(base + k) * 2] = gu[k * 2];
      uv[(base + k) * 2 + 1] = gu[k * 2 + 1];
      bounds.expandByPoint(v);
    }
    const gi = g.index.array;
    idx.set(gi.map((x) => x + base), ci * perClump * 6);
  });
  geos.forEach((g) => g.dispose());

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  // world-space geometry: sway grows above the crown's underside (y ≈ 12)
  const material = materials.foliage({ variant: 'oak', vertexColors: true, wind: { strength: 0.0045, base: 12 } });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'oak-leaves';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return { meshes: [mesh], bounds, cards: clumps.length * perClump };
}
