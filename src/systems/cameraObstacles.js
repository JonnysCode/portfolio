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
//   obs.decorAlong(a, b, skipEnd) → how many soft occluders (fairy-light bulbs,
//                                   lanterns, lamp posts) sit on the segment a → b
//   obs.rebuild()                 (lazily built on first use, after the world)
//
// Soft occluders ("decor"): things far too thin for the solid raycasts that
// still ruin a close-up when they hang in front of the lens — every glowing
// bulb and lamp (their halo points), and lamp posts. They also keep the lens a
// hand's width away (penetration), so an orbit never parks on a bulb.
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

/** Halo sizes up to this are bulbs / lanterns (decor); bigger ones are windows & doorways on solid walls. */
const DECOR_MAX_HALO = 0.95;
const DECOR_CELL = 2;

export function createCameraObstacles(ctx) {
  /** soft occluders: spheres { x, y, z, r } and lamp-post segments { a, b, r } (kind 's' | 'c') */
  const decor = [];
  const decorGrid = new Map();
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
      // the Velowerkstatt's bell cap overhangs its stone drum (riverside/workshop.js:
      // CAP_R 2.95, rim at 3.05, 3.15 tall, a rolled rim with fairy lights below it)
      if (s.tag === 'velowerkstatt') cyl.push({ x: s.x, z: s.z, r: 2.95 + 0.75, y0: y + 3.05 - 0.9, y1: y + 3.05 + 3.15 + 0.5, cap: true });
    }
    // mushroom-house caps overhang their stems (whose collider circles are all the
    // footprints know about): a flat drum from just below the rim to the apex, so
    // the lens can never park under a cap with the rolled rim across the frame
    ctx.scene?.traverse?.((o) => {
      const u = o.userData;
      if (!u || typeof u.capRadius !== 'number' || typeof u.rimY !== 'number' || o === ctx.scene) return;
      o.updateWorldMatrix(true, false);
      const e = o.matrixWorld.elements;
      const k = o.matrixWorld.getMaxScaleOnAxis();
      cyl.push({ x: e[12], z: e[14], r: u.capRadius * k + 0.6, y0: e[13] + (u.rimY - 0.8) * k, y1: e[13] + ((u.height ?? u.rimY + 3) + 0.4) * k, cap: true });
    });
    buildDecor();
    builtAt = ctx.colliders?.version ?? 0;
  }

  const dv = new THREE.Vector3();
  function addDecor(d) {
    const i = decor.push(d) - 1;
    const lo = d.kind === 's' ? [d.x - d.r, d.y - d.r, d.z - d.r] : [Math.min(d.a.x, d.b.x) - d.r, Math.min(d.a.y, d.b.y) - d.r, Math.min(d.a.z, d.b.z) - d.r];
    const hi = d.kind === 's' ? [d.x + d.r, d.y + d.r, d.z + d.r] : [Math.max(d.a.x, d.b.x) + d.r, Math.max(d.a.y, d.b.y) + d.r, Math.max(d.a.z, d.b.z) + d.r];
    for (let x = Math.floor(lo[0] / DECOR_CELL); x <= Math.floor(hi[0] / DECOR_CELL); x++)
      for (let y = Math.floor(lo[1] / DECOR_CELL); y <= Math.floor(hi[1] / DECOR_CELL); y++)
        for (let z = Math.floor(lo[2] / DECOR_CELL); z <= Math.floor(hi[2] / DECOR_CELL); z++) {
          const k = `${x},${y},${z}`;
          let list = decorGrid.get(k);
          if (!list) decorGrid.set(k, (list = []));
          list.push(i);
        }
  }
  function buildDecor() {
    decor.length = 0;
    decorGrid.clear();
    const seen = new Set();
    ctx.scene?.traverse?.((o) => {
      if (o.name === 'lampPost') {
        o.updateWorldMatrix(true, false);
        const a = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
        const b = a.clone();
        b.y += (o.userData.height ?? 2.9) * o.matrixWorld.getMaxScaleOnAxis();
        addDecor({ kind: 'c', a, b, r: 0.24 });
        return;
      }
      if (!o.isMesh || o.material?.name !== 'props-glow-halo' || !o.visible) return;
      const pos = o.geometry?.attributes?.position;
      const size = o.geometry?.attributes?.aSize;
      if (!pos || !size) return;
      o.updateWorldMatrix(true, false);
      const k = o.matrixWorld.getMaxScaleOnAxis();
      // (glowGeometry: four corners per halo share its centre)
      for (let i = 0; i < pos.count; i += 4) {
        const sz = size.getX(i) * k;
        if (sz > DECOR_MAX_HALO) continue;
        dv.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const key = `${Math.round(dv.x * 20)},${Math.round(dv.y * 20)},${Math.round(dv.z * 20)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        addDecor({ kind: 's', x: dv.x, y: dv.y, z: dv.z, r: sz <= 0.3 ? 0.17 : 0.3 });
      }
    });
  }

  const sa = new THREE.Vector3();
  const sb = new THREE.Vector3();
  const sp = new THREE.Vector3();
  /** Distance from point p to the segment a → b. */
  function segDist(p, a, b) {
    sb.subVectors(b, a);
    sa.subVectors(p, a);
    const t = Math.max(0, Math.min(1, sa.dot(sb) / Math.max(sb.lengthSq(), 1e-9)));
    return sa.addScaledVector(sb, -t).length();
  }
  /** Distance between two segments (sampled: decor segments are short posts). */
  function segSegDist(a0, a1, b0, b1) {
    let best = Infinity;
    for (let i = 0; i <= 8; i++) {
      sp.lerpVectors(b0, b1, i / 8);
      best = Math.min(best, segDist(sp, a0, a1));
    }
    return best;
  }
  const hitSet = new Set();
  const qa = new THREE.Vector3();
  const qb = new THREE.Vector3();
  const qs = new THREE.Vector3();
  /**
   * How many soft occluders lie on the segment a → b (the last `skipEnd` units
   * before b — the framed subject and what hangs right by it — don't count).
   */
  function decorAlong(a, b, skipEnd = 0) {
    ensure();
    if (!decor.length) return 0;
    const len = a.distanceTo(b);
    const L = len - skipEnd;
    if (L <= 0.05) return 0;
    qa.copy(a);
    qb.lerpVectors(a, b, L / len);
    hitSet.clear();
    const steps = Math.ceil(L / 0.5);
    for (let i = 0; i <= steps; i++) {
      qs.lerpVectors(qa, qb, i / steps);
      const list = decorGrid.get(`${Math.floor(qs.x / DECOR_CELL)},${Math.floor(qs.y / DECOR_CELL)},${Math.floor(qs.z / DECOR_CELL)}`);
      if (list) for (const j of list) hitSet.add(j);
    }
    let n = 0;
    for (const j of hitSet) {
      const d = decor[j];
      if (d.kind === 's') {
        sp.set(d.x, d.y, d.z);
        if (segDist(sp, qa, qb) < d.r) n++;
      } else if (segSegDist(qa, qb, d.a, d.b) < d.r) n++;
    }
    return n;
  }
  /** Depth of p inside a soft occluder (a hand's width around bulbs, lamps and posts). */
  function decorPenetration(p) {
    const list = decorGrid.get(`${Math.floor(p.x / DECOR_CELL)},${Math.floor(p.y / DECOR_CELL)},${Math.floor(p.z / DECOR_CELL)}`);
    if (!list) return 0;
    let worst = 0;
    for (const j of list) {
      const d = decor[j];
      const r = d.r + 0.18;
      const dist = d.kind === 's' ? Math.hypot(p.x - d.x, p.y - d.y, p.z - d.z) : segDist(p, d.a, d.b);
      if (r - dist > worst) worst = r - dist;
    }
    return worst;
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
    const dp = decorPenetration(p);
    if (dp > worst) worst = dp;
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
    decorAlong,
    rebuild: build,
    /** Debug: the shapes the camera avoids. */
    get shapes() {
      ensure();
      return { cyl, caps, crown, decor };
    },
  };
}
