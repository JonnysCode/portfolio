// ─────────────────────────────────────────────────────────────────────────────
// Ground cover for the cottage pads (the vegetation scatter keeps off building
// plots, so the cottage dresses its own ground): grass tufts, ferns, moss
// cushions, pebbles, fallen leaves, toadstools, a few flowers — and clusters
// of glowing mushrooms that light up the garden at night.
//
// Everything is rejection-sampled against keep-out circles (house stems,
// garden furniture, paths & flagstones) and scaled by quality density.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight, getPathDistance } from '../../world/ground.js';
import { materials } from '../../core/materials.js';
import { mats, xf, mossGeo, stoneGeo, leafGeo, addFern, addGrass, addFlower, addToadstool, TAU } from './kit.js';

let glowCapMat = null;
/** Pale, bioluminescent caps: barely tinted by day, softly glowing teal at night. */
function glowCap() {
  glowCapMat ??= materials.glow('#8ff5d6', { day: 0.12, night: 1.25 });
  return glowCapMat;
}

/**
 * Scatter ground cover in an annulus around (cx, cz).
 * keepOut: [[x, z, r], …] world circles to avoid. Returns the glow points of the glowing mushrooms.
 */
export function scatterPad(F, rng, { cx, cz, r0, r1, keepOut = [], density = 1, glowClusters = 2, halos = null }) {
  const M = mats();
  const free = (x, z, pad = 0) => {
    if (getPathDistance(x, z) < 1.15) return false;
    for (const [kx, kz, kr] of keepOut) if (Math.hypot(x - kx, z - kz) < kr + pad) return false;
    return true;
  };
  const area = Math.PI * (r1 * r1 - r0 * r0);
  const sample = () => {
    const a = rng.next() * TAU;
    const r = Math.sqrt(rng.range(r0 * r0, r1 * r1));
    return [cx + Math.sin(a) * r, cz + Math.cos(a) * r];
  };
  // a few soft moss cushions
  const nMoss = Math.round(area * 0.12 * density);
  for (let i = 0; i < nMoss; i++) {
    const [x, z] = sample();
    if (!free(x, z, 0.1)) continue;
    F.add(M.moss, xf(mossGeo(rng, { r: rng.range(0.14, 0.3), h: rng.range(0.06, 0.11), sx: rng.range(0.8, 1.3) }), [x, getHeight(x, z), z], [0, rng.next() * 3, 0]), { cast: false });
  }
  // then clumps: each a little community of plants around a centre
  const nClumps = Math.round(area * 0.9 * density);
  for (let c = 0; c < nClumps; c++) {
    const [qx, qz] = sample();
    if (!free(qx, qz)) continue;
    const theme = rng.next();
    const k = rng.int(3, 7);
    for (let i = 0; i < k; i++) {
      const x = qx + rng.jitter(0.45), z = qz + rng.jitter(0.45);
      if (!free(x, z)) continue;
      const y = getHeight(x, z);
      const roll = rng.next();
      if (theme < 0.4) {
        // grassy tussock with a flower or two
        if (roll < 0.75) addGrass(F, rng, x, y, z, { size: rng.range(0.28, 0.5), blades: rng.int(3, 6) });
        else addFlower(F, rng, x, y, z, { size: rng.range(0.045, 0.07), stem: rng.range(0.15, 0.35) });
      } else if (theme < 0.62) {
        // ferny corner
        if (roll < 0.6) addFern(F, rng, x, y, z, { size: rng.range(0.4, 0.8), fronds: rng.int(6, 9) });
        else addGrass(F, rng, x, y, z, { size: rng.range(0.25, 0.4), blades: 3 });
      } else if (theme < 0.75) {
        // leaf litter, pebbles & a mossy stone
        if (roll < 0.6) {
          const lf = leafGeo(rng.range(0.08, 0.13), 0.7, 0.1, 2);
          lf.rotateX(-Math.PI / 2 + rng.jitter(0.2));
          lf.rotateY(rng.next() * TAU);
          F.add(M.leafy, lf.translate(x, y + 0.012 + rng.next() * 0.01, z), { color: rng.pick(['#b8762e', '#c98a3a', '#9a5a2a', '#d9a441', '#7a5a2a']), cast: false });
        } else F.add(M.stone, xf(stoneGeo(rng, { r: rng.range(0.05, 0.18), sy: 0.55, detail: 'low' }), [x, y + 0.02, z], [0, rng.next() * 3, 0]), { color: rng.pick(['#a49c8c', '#9c9282', '#b3a58c']), cast: false });
      } else if (theme < 0.88) {
        // toadstool ring
        const col = rng.pick(['#c4301f', '#c4301f', '#b8562a', '#a77c52', '#d8c8a8']);
        addToadstool(F, rng, x, y, z, { size: rng.range(0.06, 0.15), color: col, warts: col === '#c4301f' });
      } else {
        // wild flowers
        addFlower(F, rng, x, y, z, { size: rng.range(0.05, 0.075), stem: rng.range(0.18, 0.4), color: rng.pick(['#f4f0e6', '#b48fd6', '#f2c14e', '#f29bb8']) });
        if (roll < 0.5) addGrass(F, rng, x, y, z, { size: 0.3, blades: 3 });
      }
    }
  }
  // glowing mushroom clusters
  for (let c = 0; c < glowClusters; c++) {
    let x = 0, z = 0, ok = false;
    for (let t = 0; t < 30 && !ok; t++) {
      [x, z] = sample();
      ok = free(x, z, 0.2);
    }
    if (!ok) continue;
    glowShrooms(F, rng, x, getHeight(x, z), z, rng.int(4, 7), halos);
  }
}

/** A cluster of slender glowing mushrooms (stems in the stem material, caps glow). */
export function glowShrooms(F, rng, x, y, z, count = 5, halos = null) {
  const M = mats();
  for (let i = 0; i < count; i++) {
    const a = rng.next() * TAU, d = i === 0 ? 0 : rng.range(0.05, 0.22);
    const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
    const h = rng.range(0.1, 0.28);
    const lean = [rng.jitter(0.25), 0, rng.jitter(0.25)];
    F.add(M.stem, xf(new THREE.CylinderGeometry(0.008, 0.014, h, 5).translate(0, h / 2, 0), [px, y, pz], lean), { color: '#e8f0e4', cast: false });
    const tip = new THREE.Vector3(0, h, 0).applyEuler(new THREE.Euler(lean[0], 0, lean[2]));
    const cr = rng.range(0.03, 0.06);
    const cap = new THREE.SphereGeometry(cr, 8, 4, 0, TAU, 0, Math.PI / 2).scale(1, rng.range(0.6, 1.1), 1);
    F.add(glowCap(), cap.translate(px + tip.x, y + tip.y - cr * 0.1, pz + tip.z), { cast: false });
  }
  if (halos) halos.push({ x, y: y + 0.18, z, size: 0.55 });
}

export { glowCap };
