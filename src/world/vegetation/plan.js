// ─────────────────────────────────────────────────────────────────────────────
// The forest plan: where the giant trees of the forest wall stand.
// Deterministic and memoised, so the terrain (leaf litter at their feet) and
// the vegetation (trunks, roots, canopy) agree without talking to each other.
//
// The wall rings the glen at r ≈ 23–38 on the sides and at the back; the
// FRONT (where every camera looks in from) stays open. A few giants step
// inside the glen between the spots wherever no spot camera's view is hurt.
// ─────────────────────────────────────────────────────────────────────────────
import { createRng } from '../../core/rng.js';
import { getHeight } from '../ground.js';
import { OAK, STREAM } from '../layout.js';
import { canGrow, isClearOfViews, padClearance, glenAzimuth } from './zones.js';

const DEG = Math.PI / 180;
let plan = null;

/** { trees: [{ x, z, y0, radius, height, lean, leanAz, kind, seed }] } */
export function forestPlan() {
  if (plan) return plan;
  const rng = createRng('forest-plan');
  const trees = [];

  const ok = (x, z, radius, height, kind) => {
    const r = Math.hypot(x, z);
    if (Math.hypot(x - OAK.x, z - OAK.z) < (kind === 'birch' ? 15 : 18)) return false;
    if (Math.hypot(x - STREAM.falls.x, z - STREAM.falls.z) < STREAM.falls.radius + radius + 1.2) return false;
    if (!canGrow(x, z, { margin: radius + 1.2, oak: 0 })) return false;
    if (padClearance(x, z) < radius + 2.2) return false;
    // keep the front open: no trunks in front of the cameras
    const az = Math.abs(glenAzimuth(x, z));
    if (az < 62 * DEG && r < 44) return false;
    for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < t.radius + radius + (kind === 'birch' || t.kind === 'birch' ? 2.2 : 4.2)) return false;
    // the trunk (and the root flare around it) must not hide any spot's subject
    if (!isClearOfViews(x, getHeight(x, z) - 1, z, Math.min(height, 40), radius * 1.6)) return false;
    return true;
  };

  const add = (x, z, radius, height, kind) => {
    trees.push({
      x,
      z,
      y0: getHeight(x, z),
      radius,
      height,
      kind,
      lean: rng.chance(0.25) ? rng.range(0.012, 0.022) : rng.range(0.002, 0.01),
      leanAz: rng.range(0, Math.PI * 2),
      seed: Math.floor(rng.next() * 1e9),
    });
  };

  // 1. giants that step inside the glen (only where every spot keeps its view)
  const inner = [
    [-21.5, -11], [-16.5, -19.5], [12, -22], [24, -3.5], [-24.5, 1.5], [-22, 17], [22.5, 14.5], [-9.5, -24],
  ];
  // (as colossal as the spot allows: ⌀ up to 6, slimmer only where space or sight lines demand)
  for (const [x, z] of inner) {
    const height = rng.range(52, 66);
    const r0 = rng.range(2.6, 3.0);
    for (const k of [1, 0.85, 0.72, 0.6]) {
      if (ok(x, z, r0 * k, height, 'giant')) {
        add(x, z, r0 * k, height, 'giant');
        break;
      }
    }
  }

  // 2. the wall: two staggered rings, sides and back
  const rings = [
    { r: [24, 29.5], step: 8.6, radius: [1.4, 2.3], height: [44, 58] },
    { r: [30.5, 38], step: 8.4, radius: [1.6, 2.7], height: [50, 66] },
  ];
  for (const ring of rings) {
    const rm = (ring.r[0] + ring.r[1]) / 2;
    const n = Math.round((2 * Math.PI * rm) / ring.step);
    for (let k = 0; k < n; k++) {
      const az = ((k + rng.range(0.15, 0.85)) / n) * Math.PI * 2 - Math.PI;
      for (let attempt = 0; attempt < 4; attempt++) {
        const r = rng.range(ring.r[0], ring.r[1]);
        const a = az + rng.jitter(0.06) * attempt;
        const x = Math.sin(a) * r, z = Math.cos(a) * r;
        const radius = rng.range(ring.radius[0], ring.radius[1]);
        const height = rng.range(ring.height[0], ring.height[1]);
        if (ok(x, z, radius, height, 'giant')) {
          add(x, z, radius, height, 'giant');
          break;
        }
      }
    }
  }

  // 3. silver birches: slimmer, lighter, brighter — in the gaps of the inner ring
  let birches = 0;
  for (let k = 0; k < 60 && birches < 7; k++) {
    const az = (rng.chance(0.5) ? 1 : -1) * rng.range(64, 150) * DEG;
    const r = rng.range(20, 27);
    const x = Math.sin(az) * r, z = Math.cos(az) * r;
    const radius = rng.range(0.42, 0.62);
    // (tall and slender: their crowns join the high canopy ceiling, never at loft height)
    const height = rng.range(28, 38) + 8;
    if (ok(x, z, radius, height, 'birch')) {
      add(x, z, radius, height, 'birch');
      birches++;
    }
  }

  plan = { trees };
  return plan;
}
