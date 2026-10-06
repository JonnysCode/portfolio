// ─────────────────────────────────────────────────────────────────────────────
// The Great Oak's crown: painterly leaf MASSES made of alpha-tested leaf cards.
//
// A few clump templates (a few hundred cards each, arranged in a squashed
// sphere, denser at the shell) are instanced at the clump spots the skeleton
// chose. Card normals are bent towards the clump's spherical normal so each
// clump shades as one soft volume — sunlit crowns, darker cool undersides —
// the way a background painter would block in foliage. Per-instance colour
// variation (yellower on top, bluer below) breaks the green up.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

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
 * Instanced leaf masses for a list of clumps [{ p, s, tier }].
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
  const budget = (ctx.engine?.params?.get('oakcards') ? +ctx.engine.params.get('oakcards') : 24000) * density;
  const perClump = Math.max(90, Math.min(420, Math.round(budget / Math.max(1, clumps.length))));
  // fewer cards → slightly bigger cards so the masses stay closed
  const grow = Math.sqrt(380 / perClump);
  const geos = templates.map((t, i) =>
    clumpTemplate(rng.fork('clump' + i), perClump, { flat: t.flat, bottom: t.bottom, size: [0.17 * grow, 0.27 * grow] })
  );
  const material = materials.foliage({ variant: 'oak', color: '#5f9440', wind: { strength: 0.035, base: -1.2 } });
  const buckets = templates.map(() => []);
  clumps.forEach((c, i) => buckets[(i * 7 + (c.tier ?? 0)) % templates.length].push(c));
  const bounds = new THREE.Box3();
  const meshes = [];
  let cards = 0;
  // crown height range for the colour gradient
  let yMin = Infinity, yMax = -Infinity;
  for (const c of clumps) {
    yMin = Math.min(yMin, c.p.y);
    yMax = Math.max(yMax, c.p.y);
  }
  buckets.forEach((list, ti) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geos[ti], material, list.length);
    mesh.name = 'oak-leaves-' + ti;
    list.forEach((c, i) => {
      _e.set(rng.range(-0.18, 0.18), rng.range(0, Math.PI * 2), rng.range(-0.18, 0.18));
      _q.setFromEuler(_e);
      _s.setScalar(c.s);
      _m.compose(c.p, _q, _s);
      mesh.setMatrixAt(i, _m);
      // painterly variation: sunny yellow-green crowns, cool blue-green depths
      // (instance colour multiplies the material colour, so stay around white)
      const h = THREE.MathUtils.clamp((c.p.y - yMin) / Math.max(1, yMax - yMin) + rng.range(-0.25, 0.25), 0, 1);
      const k = rng.range(0.9, 1.1);
      _c.setRGB(
        THREE.MathUtils.lerp(0.8, 1.12, h) * k,
        THREE.MathUtils.lerp(0.9, 1.05, h) * k,
        THREE.MathUtils.lerp(1.0, 0.8, h) * k
      );
      mesh.setColorAt(i, _c);
      bounds.expandByPoint(_s.copy(c.p).addScalar(c.s));
      bounds.expandByPoint(_s.copy(c.p).addScalar(-c.s));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    cards += list.length * perClump;
    meshes.push(mesh);
  });
  return { meshes, bounds, cards };
}
