// ─────────────────────────────────────────────────────────────────────────────
// The moss carpet (round 6): a dense layer of low, lumpy moss cushions over
// the open forest floor — the lawns between the paths, the glades between the
// undergrowth clumps, the wide views' front band — so a fleck of sun lands on
// velvet moss with relief and shadow, never on a flat sandy patch.
//
// One InstancedMesh: a lumpy low dome (unit radius, unit height; 18
// triangles) scaled flat (0.03–0.1 tall, 0.18–0.6 across), painted with the
// moss surface (world-space triplanar, so neighbouring cushions never repeat)
// in a range of greens — golden-olive in the open, deep blue-green in the
// shade and by the water. Ankle-high at most: it never blocks a view, and
// everything else grows through it.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { getHeight, getStreamDistance } from '../ground.js';
import { GeoBuilder, TAU, instanced, groundPatches, fieldMid } from './common.js';
import { canGrow, inShot, inNearField, oakDist } from './zones.js';

/** A lumpy low dome: centre, a raised inner ring, a sunk outer ring (6 sides, 18 triangles). */
export function mossLumpGeometry(rng = createRng('vegetation:moss-lump')) {
  const B = new GeoBuilder();
  const n = 6;
  const c = B.vert(0, 1, 0, 0, 1, 0, 0.5, 0.5);
  const inner = [], outer = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.jitter(0.12);
    const ri = 0.55 * rng.range(0.85, 1.15), ro = rng.range(0.88, 1.12);
    const yi = 0.72 * rng.range(0.85, 1.1);
    // (normals lean outwards: the cushion's flank catches the light)
    const ni = new THREE.Vector3(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55).normalize();
    const no = new THREE.Vector3(Math.cos(a) * 1.2, 1, Math.sin(a) * 1.2).normalize();
    inner.push(B.vert(Math.cos(a) * ri, yi, Math.sin(a) * ri, ni.x, ni.y, ni.z, 0.5 + Math.cos(a) * 0.25, 0.5 + Math.sin(a) * 0.25));
    outer.push(B.vert(Math.cos(a) * ro, -0.2, Math.sin(a) * ro, no.x, no.y, no.z, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5));
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    B.tri(c, inner[j], inner[i]);
    B.quad(inner[i], inner[j], outer[j], outer[i]);
  }
  return B.build();
}

// (the open lawns' cushions: golden-olive greens that stay green under the amber sun)
const SUNNY = ['#6a8a30', '#728f38', '#62842e', '#78923e', '#668632'];
const SHADY = ['#4e6e2c', '#557a30', '#46682c', '#5c7a34'];
const DAMP = ['#3e5e2c', '#456a30', '#3a5a2a'];

/**
 * Scatter the carpet. occ: the vegetation's occupancy (clear of rocks, logs,
 * stumps, giants…); density: quality density; avoid(x, z) → true to keep a
 * spot free (the framing log). extra: [{ x, z, r, n }] — areas to dress
 * densely (a reserved corridor nothing else grew in). Returns { mesh, count }.
 */
export function buildMossCarpet(ctx, { occ, density = 1, tier = 'high', avoid = null, extra = [] } = {}) {
  const rng = createRng('vegetation:moss-carpet');
  const items = [];
  const gp = {};
  const want = Math.round((tier === 'high' ? 1750 : tier === 'medium' ? 950 : 550) * Math.min(1.2, density));
  const sunny = (x, z) => oakDist(x, z) > 12.5 && Math.hypot(x, z) < 24 && z < 22;
  const place = (x, z, k = 1, free = false) => {
    if (!canGrow(x, z, { path: 1.05 })) return false;
    if (avoid && avoid(x, z)) return false;
    if (!free && occ && occ.clearance(x, z, 1.5) < 0.04) return false;
    const y = getHeight(x, z);
    if (!inShot(x, y + 0.05, z, 0.3)) return false;
    // (never a lump right before a lens: ankle-high is still a wall at 0.3 units)
    if (inNearField(x, y + 0.05, z, 0.15, 0.25)) return false;
    groundPatches(x, z, gp);
    const damp = getStreamDistance(x, z) < 5;
    // (the wide views' front band, beyond the glen: the deeper shady greens)
    const list = damp ? DAMP : sunny(x, z) && rng.chance(0.75) ? SUNNY : SHADY;
    const s = rng.range(0.18, 0.5) * k * (gp.cushion > 0.4 ? 1.2 : 1);
    items.push({
      x,
      y: y - 0.004,
      z,
      ry: rng.range(0, TAU),
      tx: rng.jitter(0.06),
      tz: rng.jitter(0.06),
      s,
      sy: (rng.range(0.03, 0.09) / s) * Math.min(1.4, 0.7 + s),
      color: new THREE.Color(rng.pick(list)).offsetHSL(rng.jitter(0.015), rng.jitter(0.05), rng.jitter(0.04)),
    });
    return true;
  };
  // (1) the open floor: lawns, glades, the front band the wide views look over —
  //     in drifts (a broad noise field), thickest where the floor shows soil,
  //     needles or leaf litter (where sun flecks used to land on sand)
  const cell = 0.85 / Math.sqrt(Math.min(1, density));
  for (let gz = -30; gz < 46 && items.length < want; gz += cell) {
    for (let gx = -36; gx < 36 && items.length < want; gx += cell) {
      const x = gx + rng.range(0, cell), z = gz + rng.range(0, cell);
      const r = Math.hypot(x, z);
      if (r < 6 || r > (z > 18 ? 46 : 31)) continue;
      groundPatches(x, z, gp);
      const field = fieldMid(x * 0.8 + 3.1, z * 0.8 - 1.7);
      const w = 0.18 + 0.55 * gp.soil + 0.4 * gp.drift + 0.25 * gp.cushion + 0.35 * THREE.MathUtils.smoothstep(field, 0.45, 0.75);
      if (!rng.chance(Math.min(0.92, w))) continue;
      // a little cluster of 1–3 cushions
      const n = rng.chance(0.45) ? 1 : rng.int(2, 3);
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, TAU), d = i ? rng.range(0.2, 0.45) : 0;
        place(x + Math.sin(a) * d, z + Math.cos(a) * d, i ? 0.8 : 1);
      }
    }
  }
  // (2) reserved patches dressed densely (each { x, z, r, n })
  for (const e of extra) {
    for (let i = 0; i < e.n; i++) {
      const a = rng.range(0, TAU), d = Math.sqrt(rng.next()) * e.r;
      // (a reserved patch is free by definition: its occupancy is a placeholder)
      place(e.x + Math.sin(a) * d * (e.sx ?? 1), e.z + Math.cos(a) * d * (e.sz ?? 1), rng.range(1.0, 1.4), e.free ?? false);
    }
  }
  const mat = ctx.materials.surface('moss', { vertexColors: true, scale: 1.1, bump: 0.8 });
  const mesh = instanced('moss-carpet', mossLumpGeometry(), mat, items, { cast: false, receive: true });
  if (mesh) mesh.raycast = () => {};
  return { mesh, count: items.length };
}
