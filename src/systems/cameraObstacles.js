// ─────────────────────────────────────────────────────────────────────────────
// Camera obstacles — a coarse, analytic picture of everything the camera must
// never fly through: the Great Oak (trunk, root flare, limbs, the leaf crown),
// the forest giants, the giant fly agarics, the houses (collider footprints
// extruded upwards) and the ground. Cheap enough to test every frame and to
// plan glide paths in a millisecond — no raycasts against the million-triangle
// scene.
//
//   const obs = createCameraObstacles(ctx)
//   obs.penetration(p)            → how deep p is inside anything (0 = clear)
//   obs.plan(p0, p3, { lift })    → { p1, p2 } Bézier handles of a clear glide
//   obs.rebuild()                 (lazily built on first use, after the world)
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OAK } from '../world/layout.js';
import { getHeight } from '../world/ground.js';

/** How tall the extruded collider footprints are, by tag (default 8). */
const COLLIDER_HEIGHT = {
  oak: 0, // modelled precisely below
  'loft-stair': 0,
  'schreinerei-deck': 2.2,
  hobelbank: 1.8,
  'schreinerei-annex': 7.5,
  velowerkstatt: 7.5,
  'velowerkstatt-repair-stand': 1.8,
  'velowerkstatt-truing-stand': 1.6,
  cottage: 9.5,
};

const CROWN_FLOOR = 17.5; // below this the oak's crown is only its limbs

export function createCameraObstacles(ctx) {
  /** vertical cylinders { x, z, r, y0, y1 } */
  const cyl = [];
  /** capsules { a: Vector3, b: Vector3, r } */
  const caps = [];
  let crown = null; // { x, z, r, y0, y1 }
  let builtAt = -1;

  function build() {
    cyl.length = 0;
    caps.length = 0;
    // the Great Oak: trunk (with a generous bark margin) and the root flare
    cyl.push({ x: OAK.x, z: OAK.z, r: OAK.baseRadius + 1.3, y0: -20, y1: 21 });
    cyl.push({ x: OAK.x, z: OAK.z, r: OAK.rootRadius - 1.8, y0: -20, y1: 2.4 });
    // its limbs (leaf clusters hang around them: wider margin further out)
    for (const l of ctx.oak?.limbInfo ?? []) {
      if (!l?.curve?.getPoint) continue;
      const n = 10;
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const p = l.curve.getPoint(u);
        const r = (l.radiusAt?.(u) ?? 0.6) + 1.2 + u * 1.6;
        if (prev) caps.push({ a: prev.p, b: p, r: Math.max(prev.r, r) });
        prev = { p, r };
      }
    }
    // the crown above the fork: a big drum of leaves
    const b = ctx.oak?.crownBounds;
    let cr = 21;
    let top = 47;
    if (b && !b.isEmpty?.()) {
      cr = Math.max(b.max.x - OAK.x, OAK.x - b.min.x, b.max.z - OAK.z, OAK.z - b.min.z) * 0.92;
      top = b.max.y + 2;
    }
    crown = { x: OAK.x, z: OAK.z, r: cr, y0: CROWN_FLOOR, y1: top };
    // forest giants and giant fly agarics
    for (const t of ctx.forest?.trees ?? ctx.modules?.vegetation?.trees ?? []) {
      cyl.push({ x: t.x, z: t.z, r: t.radius + 1.1, y0: (t.y0 ?? 0) - 20, y1: (t.y0 ?? 0) + t.height });
    }
    for (const g of ctx.forest?.giants ?? ctx.modules?.vegetation?.giants ?? []) {
      const R = g.R ?? 1;
      cyl.push({ x: g.x, z: g.z, r: R + 0.45, y0: (g.y ?? 0) - 20, y1: (g.y ?? 0) + (g.H ?? 3) + 0.7 });
    }
    // houses, decks and benches: collider footprints extruded upwards
    for (const s of ctx.colliders?.shapes ?? []) {
      const h = COLLIDER_HEIGHT[s.tag] ?? 8;
      if (h <= 0) continue;
      const r = s.type === 'circle' ? s.r : Math.hypot(s.hw ?? 0.5, s.hd ?? 0.5) * 0.85;
      const y = getHeight(s.x, s.z);
      cyl.push({ x: s.x, z: s.z, r: r + 0.35, y0: y - 20, y1: y + h });
    }
    builtAt = ctx.colliders?.version ?? 0;
  }

  function ensure() {
    if (builtAt < 0 || (ctx.colliders?.version ?? 0) !== builtAt) build();
  }

  const ab = new THREE.Vector3();
  const ap = new THREE.Vector3();
  /** Depth of p inside the nearest obstacle (0 when clear). */
  function penetration(p, { ground = true } = {}) {
    ensure();
    let worst = 0;
    for (const c of cyl) {
      if (p.y < c.y0 || p.y > c.y1) continue;
      const d = c.r - Math.hypot(p.x - c.x, p.z - c.z);
      if (d > worst) worst = d;
    }
    for (const c of caps) {
      ab.subVectors(c.b, c.a);
      ap.subVectors(p, c.a);
      const t = Math.max(0, Math.min(1, ap.dot(ab) / Math.max(ab.lengthSq(), 1e-6)));
      const d = c.r - ap.addScaledVector(ab, -t).length();
      if (d > worst) worst = d;
    }
    if (crown && p.y > crown.y0 && p.y < crown.y1) {
      const d = Math.min(crown.r - Math.hypot(p.x - crown.x, p.z - crown.z), p.y - crown.y0 + 0.5);
      if (d > worst) worst = d;
    }
    if (ground) {
      const d = getHeight(p.x, p.z) + 0.9 - p.y;
      if (d > worst) worst = d;
    }
    return worst;
  }

  const q = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const SAMPLES = 36;

  function bezier(p0, p1, p2, p3, t, out) {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return out.set(
      a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      a * p0.y + b * p1.y + c * p2.y + d * p3.y,
      a * p0.z + b * p1.z + c * p2.z + d * p3.z,
    );
  }

  /** Total penetration along a candidate path (endpoints excluded: they are given). */
  function cost(p0, p1, p2, p3) {
    let pen = 0;
    for (let i = 3; i < SAMPLES - 2; i++) pen += penetration(bezier(p0, p1, p2, p3, i / SAMPLES, q));
    return pen;
  }

  /**
   * Plan a gentle arc from p0 to p3 that rises over obstacles and bends around
   * the oak instead of through it. Returns cubic Bézier handles.
   */
  function plan(p0, p3, { lift = 0 } = {}) {
    dir.subVectors(p3, p0);
    const len = dir.length();
    side.crossVectors(dir, UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    // bend towards the front of the glen (+Z) first: that is where the open air is
    if (side.z < 0) side.negate();
    // a gentle arc (the preferred lift), flatter, or higher; straight, or bent sideways
    const lifts = [lift, lift * 0.45, 0, lift + 3, lift + 6.5, lift + 11];
    const sides = [0, 0.16, -0.16, 0.32, -0.32, 0.55];
    let best = null;
    for (const l of lifts) {
      for (const s of sides) {
        const off = s * len;
        const p1 = new THREE.Vector3().copy(p0).addScaledVector(dir, 0.3).addScaledVector(UP, l).addScaledVector(side, off);
        const p2 = new THREE.Vector3().copy(p0).addScaledVector(dir, 0.7).addScaledVector(UP, l).addScaledVector(side, off);
        const pen = cost(p0, p1, p2, p3);
        // clear first, then as close to the preferred arc and as straight as possible
        const score = pen * 50 + Math.abs(l - lift) * 0.3 + Math.abs(off) * 0.22;
        if (!best || score < best.score) best = { p1, p2, score, pen };
      }
    }
    return best;
  }

  return {
    penetration,
    plan,
    bezier,
    rebuild: build,
    /** Debug: the shapes the camera avoids. */
    get shapes() {
      ensure();
      return { cyl, caps, crown };
    },
  };
}
