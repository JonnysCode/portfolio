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
//   obs.plan(p0, p3, { lift, t0, t3, fov, aspect })
//                                 → { p1, p2 } Bézier handles of a clear glide: it
//                                   keeps a wide berth round mushroom caps (capRadius
//                                   + 2 while planning, 0.6 for penetration), and —
//                                   given the look points t0 → t3 — rejects arcs on
//                                   which a cap would fill the frame (5 rays from the
//                                   lens, > half of them on a cap within 4 units);
//                                   a glide leaving (or landing) among the caps may
//                                   rise over their apexes first
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
      if (s.tag === 'velowerkstatt') cyl.push({ x: s.x, z: s.z, r: 2.95 + 0.75, R: 3.15, y0: y + 3.05 - 0.9, y1: y + 3.05 + 3.15 + 0.5, cap: true });
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
      cyl.push({ x: e[12], z: e[14], r: u.capRadius * k + 0.6, R: u.capRadius * k, y0: e[13] + (u.rimY - 0.8) * k, y1: e[13] + ((u.height ?? u.rimY + 3) + 0.4) * k, cap: true });
    });
    capList.length = 0;
    for (const c of cyl) if (c.cap) capList.push(c);
    buildDecor();
    builtAt = ctx.colliders?.version ?? 0;
  }
  /** the cap drums alone (glide planning) */
  const capList = [];

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

  // ── glide planning ─────────────────────────────────────────────────────────
  /** QA: plan like round 4 did (no cap berth, no frame-occupancy test) — for before/after audits. */
  let legacy = false;
  /** While planning, a cap keeps this much air round its rim (penetration keeps 0.6)… */
  const PLAN_CAP_MARGIN = 2.0;
  /** …and this much above its apex / below its rim. */
  const PLAN_CAP_ABOVE = 1.2;
  const PLAN_CAP_BELOW = 0.6;
  /** Frame occupancy: rays this long (from the lens) that hit a cap count; more than this share of them hit = a frame full of cap. */
  const OCC_REACH = 4;
  const OCC_MAX = 0.5;
  /** Per plan: the caps near the glide, with the margin each keeps (never more than its endpoints have). */
  const planCaps = [];

  /** Depth of p inside the planning clearance of a cap (0 = clear). */
  function capPlanPenetration(p) {
    let worst = 0;
    for (const c of planCaps) {
      if (p.y < c.y0 - PLAN_CAP_BELOW || p.y > c.y1 + c.above) continue;
      const d = c.R + c.m - Math.hypot(p.x - c.x, p.z - c.z);
      if (d > worst) worst = d;
    }
    return worst;
  }

  /** Is p inside the cap itself (a drum from just below the rim to the apex)? */
  function inCap(p) {
    for (const c of planCaps) {
      if (p.y < c.y0 || p.y > c.y1) continue;
      if (Math.hypot(p.x - c.x, p.z - c.z) < c.R + 0.15) return true;
    }
    return false;
  }

  const of = new THREE.Vector3();
  const oR = new THREE.Vector3();
  const oU = new THREE.Vector3();
  const oD = new THREE.Vector3();
  const oP = new THREE.Vector3();
  const OCC_DIRS = [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]];
  /**
   * Share (0..1) of five rays from the lens (the centre and halfway to each edge of
   * the frame) that run into a cap within OCC_REACH: how much of the frame a cap fills.
   */
  function occupancy(eye, look, tanV, aspect) {
    if (!planCaps.length) return 0;
    of.subVectors(look, eye);
    if (of.lengthSq() < 1e-6) return 0;
    of.normalize();
    oR.crossVectors(of, UP);
    if (oR.lengthSq() < 1e-6) oR.set(1, 0, 0);
    oR.normalize();
    oU.crossVectors(oR, of);
    let hits = 0;
    for (const [a, b] of OCC_DIRS) {
      oD.copy(of).addScaledVector(oR, a * tanV * aspect).addScaledVector(oU, b * tanV).normalize();
      for (let t = 0.3; t <= OCC_REACH; t += 0.3) {
        oP.copy(eye).addScaledVector(oD, t);
        if (inCap(oP)) {
          hits++;
          break;
        }
      }
    }
    return hits / OCC_DIRS.length;
  }

  const lk = new THREE.Vector3();
  /** The look point of a glide at parameter k (the eye leads the body a little: cameraRig.glideTo). */
  function lookAtK(t0, t3, k, out) {
    return out.lerpVectors(t0, t3, Math.min(1, k * 1.08 - 0.08 * k * k));
  }

  /**
   * Cost of a candidate path (endpoints excluded: they are given): how deep it
   * runs into things, how close it shaves the caps, and how often a cap would
   * fill the frame on the way.
   */
  function cost(p0, p1, p2, p3, look) {
    let pen = 0;
    let shave = 0;
    let occ = 0;
    for (let i = 3; i < SAMPLES - 2; i++) {
      const k = i / SAMPLES;
      bezier(p0, p1, p2, p3, k, q);
      pen += penetration(q);
      shave += capPlanPenetration(q);
      if (look && i % 2 === 0) {
        const o = occupancy(q, lookAtK(look.t0, look.t3, k, lk), look.tanV, look.aspect);
        // (an endpoint that already looks past a cap close by — a close-up by a cottage — sets the bar near it)
        const bar = Math.max(OCC_MAX, look.occ0 + (look.occ3 - look.occ0) * k + 0.01);
        if (o > bar) occ += o - OCC_MAX;
      }
    }
    return { pen, shave, occ };
  }

  /**
   * Plan a gentle arc from p0 to p3 that rises over obstacles and bends around
   * the oak instead of through it. Returns cubic Bézier handles.
   * opts: lift (the preferred rise), t0 / t3 (look points at the start / end:
   * enables the frame-occupancy test), fov (deg), aspect.
   */
  function plan(p0, p3, { lift = 0, t0 = null, t3 = null, fov = 40, aspect = 16 / 9 } = {}) {
    ensure();
    dir.subVectors(p3, p0);
    const len = dir.length();
    side.crossVectors(dir, UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    // bend towards the front of the glen (+Z) first: that is where the open air is
    if (side.z < 0) side.negate();
    // the caps that matter for this glide (near the box round both ends and the
    // highest arc), each with the berth it may keep: never more than either end
    // already has (a close-up next to a cottage must still be reachable)
    planCaps.length = 0;
    const pad = len * 0.6 + 16;
    const minX = Math.min(p0.x, p3.x) - pad, maxX = Math.max(p0.x, p3.x) + pad;
    const minZ = Math.min(p0.z, p3.z) - pad, maxZ = Math.max(p0.z, p3.z) + pad;
    let apex0 = -Infinity, apex3 = -Infinity;
    for (const c of capList) {
      if (c.x < minX || c.x > maxX || c.z < minZ || c.z > maxZ) continue;
      const R = c.R ?? c.r - 0.6;
      const d0 = Math.hypot(p0.x - c.x, p0.z - c.z) - R;
      const d3 = Math.hypot(p3.x - c.x, p3.z - c.z) - R;
      const in0 = p0.y > c.y0 - PLAN_CAP_BELOW - 1 && p0.y < c.y1 + PLAN_CAP_ABOVE + 1;
      const in3 = p3.y > c.y0 - PLAN_CAP_BELOW - 1 && p3.y < c.y1 + PLAN_CAP_ABOVE + 1;
      let m = PLAN_CAP_MARGIN;
      if (in0) m = Math.min(m, d0 - 0.15);
      if (in3) m = Math.min(m, d3 - 0.15);
      planCaps.push({ x: c.x, z: c.z, R, y0: c.y0, y1: c.y1, m: Math.max(0.6, m), above: PLAN_CAP_ABOVE });
      // leaving / landing among the caps (within 4 of a rim, below its apex + 1.5)
      if (d0 < 4 && p0.y < c.y1 + 1.5) apex0 = Math.max(apex0, c.y1 + 1.5);
      if (d3 < 4 && p3.y < c.y1 + 1.5) apex3 = Math.max(apex3, c.y1 + 1.5);
    }
    let look = null;
    if (t0 && t3 && !legacy) {
      const tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
      look = { t0, t3, tanV, aspect, occ0: 0, occ3: 0 };
      look.occ0 = occupancy(p0, t0, tanV, aspect);
      look.occ3 = occupancy(p3, t3, tanV, aspect);
    }
    // a gentle arc (the preferred lift), flatter, or higher; straight, or bent sideways —
    // and, leaving or landing among the caps, first up over their apexes
    const lifts = [lift, lift * 0.45, 0, lift + 3, lift + 6.5, lift + 11];
    const sides = [0, 0.16, -0.16, 0.32, -0.32, 0.55];
    const need1 = apex0 > -Infinity ? Math.max(0, apex0 - p0.y - 0.3 * dir.y) : null;
    const need2 = apex3 > -Infinity ? Math.max(0, apex3 - p0.y - 0.7 * dir.y) : null;
    const pairs = lifts.map((l) => [l, l]);
    if (!legacy && (need1 !== null || need2 !== null)) {
      const n1 = need1 ?? lift, n2 = need2 ?? lift;
      pairs.push([Math.max(n1, lift), Math.max(n2, lift * 0.45)], [Math.max(n1, lift), Math.max(n2, lift)], [Math.max(n1, lift + 3), Math.max(n2, lift + 3)]);
    }
    let best = null;
    for (const [l1, l2] of pairs) {
      for (const sd of sides) {
        const off = sd * len;
        const p1 = new THREE.Vector3().copy(p0).addScaledVector(dir, 0.3).addScaledVector(UP, l1).addScaledVector(side, off);
        const p2 = new THREE.Vector3().copy(p0).addScaledVector(dir, 0.7).addScaledVector(UP, l2).addScaledVector(side, off);
        const c = cost(p0, p1, p2, p3, look);
        // clear first (nothing run into, no cap shaved, no frame full of cap), then
        // as close to the preferred arc and as straight as possible
        const score = c.pen * 50 + (legacy ? 0 : c.shave * 6) + c.occ * 30 + (Math.abs(l1 - lift) + Math.abs(l2 - lift)) * 0.15 + Math.abs(off) * 0.22;
        if (!best || score < best.score) best = { p1, p2, score, pen: c.pen, shave: c.shave, occ: c.occ };
      }
    }
    return best;
  }

  /**
   * Debug / QA: how a planned glide fares — the worst frame occupancy by caps and
   * the closest shave along it (samples the same path the rig flies).
   */
  function auditGlide(p0, p1, p2, p3, t0, t3, fov = 40, aspect = 16 / 9) {
    ensure();
    planCaps.length = 0;
    for (const c of capList) planCaps.push({ x: c.x, z: c.z, R: c.R ?? c.r - 0.6, y0: c.y0, y1: c.y1, m: 0.6, above: 0 });
    const tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    let worstOcc = 0, worstK = 0, minGap = Infinity;
    const P = new THREE.Vector3();
    for (let i = 1; i < 60; i++) {
      const k = i / 60;
      bezier(p0, p1, p2, p3, k, P);
      const o = occupancy(P, lookAtK(t0, t3, k, lk), tanV, aspect);
      if (o > worstOcc) (worstOcc = o), (worstK = k);
      for (const c of capList) {
        if (P.y < c.y0 - 0.6 || P.y > c.y1 + 1.2) continue;
        minGap = Math.min(minGap, Math.hypot(P.x - c.x, P.z - c.z) - (c.R ?? c.r - 0.6));
      }
    }
    return { worstOcc, worstK: +worstK.toFixed(2), minGap: +minGap.toFixed(2) };
  }

  return {
    penetration,
    plan,
    auditGlide,
    set legacyPlan(on) {
      legacy = !!on;
    },
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
