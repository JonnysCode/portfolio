// ─────────────────────────────────────────────────────────────────────────────
// The Code Loft's PLATFORM: a round-ish plank deck wrapping the front-right of
// the Great Oak at OAK.loft.
//
//   • planks: individual boards running across the deck, scribed to the bark
//     around the trunk, ragged at the outer edge, each with its own tone,
//     slight twist and nail heads where it crosses a joist
//   • a fan of radial joists resting on a ledger bolted to the bark, a
//     polygonal rim beam, and hewn knee-braces from every joist down into the
//     trunk (iron bolts, cleats under their feet)
//   • ropes from the limbs above, lashed around the limb and the rim
//   • a railing of crooked bark-covered branches with X-twigs in its bays
//   • moss creeping in from the bark, ivy curtains hanging under the rim,
//     toadstools in the corners
//   • a slot at the bark for the snail lift (ELEVATOR_AZ) with a little gate
//     and a stairwell at the deck's front tip where the winding stair arrives
//
// Everything lands in the caller's Batch. Returns the deck description other
// parts of the loft place things with (outline, inside(), railing openings).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OAK } from '../../world/layout.js';
import { DEG, TAU, WOOD, IRON, BARK, polar, radial, board, timber, branch, tubeAlong, sagCurve, mossGeo, ivyCard, addToadstool, xf, alongX } from './kit.js';

/** Azimuth (deg) of the snail lift's track on the bark. */
export const ELEVATOR_AZ = 56;
/**
 * The snail lift's size: snail scale, hook arm, basket radius — and the slot
 * it needs through the deck and the stair landing (radial depth from the
 * bark, tangential half width).
 */
export const LIFT = { scale: 0.82, arm: 0.2, basketR: 0.3, slotDepth: 1.62, slotHalf: 0.5 };
/** The stairwell: azimuth range (deg) along the bark, and how far out from the bark it is open. */
export const STAIR_WELL = { a0: 2, a1: 31, depth: 1.42 };

const PLANK_T = 0.07; // plank thickness
const JOIST_H = 0.2;
const DECK_Y = OAK.loft.y; // top of the planks (world)

export function buildDeck(ctx, B, mats, env) {
  const { frame, bark, rng } = env;
  const F = B.at(frame.matrix); // deck-local frame
  const R0 = OAK.loft.radius;
  const density = ctx.quality?.density ?? 1;

  // ── outline: a wobbly circle in deck-local XZ ─────────────────────────────
  const R = (th) => R0 * (1 + 0.035 * Math.sin(3 * th + 0.7) + 0.025 * Math.sin(5 * th + 2.1) + 0.012 * Math.sin(9 * th + 4));
  const insideOutline = (x, z, inset = 0) => Math.hypot(x, z) < R(Math.atan2(z, x)) - inset;
  /** distance from the bark (negative inside the trunk) of a deck-local point */
  const barkGap = (x, z, y = DECK_Y - 0.05) => {
    const p = frame.polarOf(x, z);
    return p.r - bark(p.a, y);
  };
  const elevA = ELEVATOR_AZ * DEG;
  const inSlot = (x, z) => {
    const p = frame.polarOf(x, z);
    const da = Math.abs(p.a - elevA) * p.r;
    return da < LIFT.slotHalf && p.r - bark(p.a, DECK_Y) < LIFT.slotDepth;
  };
  const inWell = (x, z) => {
    const p = frame.polarOf(x, z);
    return p.a > STAIR_WELL.a0 * DEG && p.a < STAIR_WELL.a1 * DEG && p.r - bark(p.a, DECK_Y) < STAIR_WELL.depth;
  };
  const deckOK = (x, z) => insideOutline(x, z) && barkGap(x, z) > 0.04 && !inSlot(x, z) && !inWell(x, z);

  // ── planks ────────────────────────────────────────────────────────────────
  const plankTones = ['#857563', '#80725f', '#776a5b', '#8c7e6c', '#8a8378', '#746656', '#867868', '#6a5f52'];
  const pitch = 0.29;
  const rows = Math.ceil((2 * R0 * 1.08) / pitch);
  const plankRuns = [];
  for (let i = 0; i < rows; i++) {
    const x = -R0 * 1.08 + (i + 0.5) * pitch;
    let start = null;
    const step = 0.02;
    for (let z = -R0 * 1.1; z <= R0 * 1.1 + step; z += step) {
      const ok = z <= R0 * 1.1 && deckOK(x, z);
      if (ok && start === null) start = z;
      if (!ok && start !== null) {
        if (z - start > 0.16) plankRuns.push({ x, z0: start, z1: z - step });
        start = null;
      }
    }
  }
  const plankMat = mats.wood();
  for (const run of plankRuns) {
    // ragged outer ends, scribed (slightly short) inner ends at the bark
    const nearBark0 = barkGap(run.x, run.z0 - 0.04) < 0.08 || inSlot(run.x, run.z0 - 0.04) || inWell(run.x, run.z0 - 0.04);
    const nearBark1 = barkGap(run.x, run.z1 + 0.04) < 0.08 || inSlot(run.x, run.z1 + 0.04) || inWell(run.x, run.z1 + 0.04);
    let z0 = run.z0 + (nearBark0 ? rng.range(0.0, 0.05) : -rng.range(-0.04, 0.1));
    let z1 = run.z1 - (nearBark1 ? rng.range(0.0, 0.05) : -rng.range(-0.04, 0.1));
    // long runs: two boards with a butt joint somewhere in the middle
    const cuts = [z0];
    if (z1 - z0 > 3.6) cuts.push(z0 + (z1 - z0) * rng.range(0.38, 0.62));
    cuts.push(z1);
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k] + (k > 0 ? 0.006 : 0), b = cuts[k + 1] - (k < cuts.length - 2 ? 0.006 : 0);
      const L = b - a;
      if (L < 0.14) continue;
      const w = pitch - rng.range(0.02, 0.04);
      const g = board(w, PLANK_T * rng.range(0.9, 1.08), L, { along: 'z', rng, c: 0.012, segs: Math.max(1, Math.round(L / 0.5)) });
      // a gentle twist / cup along the board
      const tw = rng.jitter(0.012), bow = rng.jitter(0.01);
      for (let v = 0, pos = g.attributes.position; v < pos.count; v++) {
        const t = pos.getZ(v) / L;
        pos.setY(v, pos.getY(v) + pos.getX(v) * tw * t * 2 + bow * (1 - 4 * t * t));
      }
      g.computeVertexNormals();
      xf(g, [run.x + rng.jitter(0.008), -PLANK_T / 2 + rng.jitter(0.005), (a + b) / 2], [rng.jitter(0.006), rng.jitter(0.008), rng.jitter(0.008)]);
      const tone = rng.next() < 0.05 ? '#a88d68' : rng.pick(plankTones);
      F.add(plankMat, g, { color: tone });
    }
  }

  // ── joists: a fan from the bark outwards, on a ledger bolted to the trunk ──
  const yJ = DECK_Y - PLANK_T - JOIST_H / 2; // joist centre height (world)
  const toLocal = (v) => frame.toLocal(v);
  const outerR = (a, y = DECK_Y) => {
    // march outwards until we leave the outline
    let r = bark(a, y) + 0.05;
    const p = new THREE.Vector3();
    for (; r < 10; r += 0.04) {
      const l = toLocal(polar(a, r, y, p));
      if (!insideOutline(l.x, l.z, 0.05)) break;
    }
    return r;
  };
  // joists: [azimuth (deg), knee-brace foot height (world y) | 'std' (45°) | null].
  // The stair winds up under the front-left part of the deck, so only the
  // joists right of the lift get standard braces; on the left one brace lands
  // steeply above the oak's round window, the rest hangs from the ropes.
  const JOISTS = [[-6, null], [12, 7.75], [30, null], [45, null], [76, 'std'], [92, 'std'], [108, 'std']];
  const joists = [];
  const timberMat = mats.timber('#7d6650');
  const ironMat = mats.metal(IRON);
  for (const [deg, brace] of JOISTS) {
    const a = deg * DEG;
    let rIn = bark(a, yJ) - 0.04;
    // inside the stairwell the joist starts at the well's edge (a trimmer beam carries it)
    if (deg > STAIR_WELL.a0 && deg < STAIR_WELL.a1) rIn = bark(a, yJ) + STAIR_WELL.depth + 0.04;
    const rOut = outerR(a) - 0.16;
    if (rOut - rIn < 0.4) continue;
    const pIn = polar(a, rIn, yJ), pOut = polar(a, rOut, yJ);
    B.add(timberMat, timber(pIn, pOut, 0.13, JOIST_H, { rng, wobble: 0.01 }));
    joists.push({ a, rIn, rOut, deg, brace });
    // bolt heads where the joist meets the ledger
    const side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const bp = polar(a, rIn + 0.3, yJ - 0.02).addScaledVector(side, 0.07);
    const bolt = new THREE.CylinderGeometry(0.028, 0.028, 0.03, 6).rotateZ(Math.PI / 2);
    alongX(bolt, bp.clone().addScaledVector(side, -0.015), bp.clone().addScaledVector(side, 0.015));
    B.add(ironMat, bolt, { cast: false });
  }
  // trimmer beam along the stairwell's edge (carries the joists that stop there)
  {
    let prev = null;
    for (let deg = STAIR_WELL.a0 + 2; deg <= STAIR_WELL.a1 + 1; deg += 5) {
      const a = deg * DEG;
      const p = polar(a, bark(a, yJ) + STAIR_WELL.depth + 0.02, yJ);
      if (prev) B.add(timberMat, timber(prev, p, 0.13, JOIST_H, { rng, wobble: 0.004 }));
      prev = p;
    }
  }

  // ledger: short straight timbers following the bark under the joist ends
  {
    const yL = yJ - JOIST_H / 2 - 0.1;
    let prev = null;
    for (let deg = STAIR_WELL.a1 + 1; deg <= 114; deg += 9) {
      const a = deg * DEG;
      const p = polar(a, bark(a, yL) + 0.06, yL);
      const inLift = deg > ELEVATOR_AZ - 13 && deg < ELEVATOR_AZ + 13;
      if (inLift) {
        prev = null;
        continue;
      }
      if (prev) B.add(timberMat, timber(prev, p, 0.12, 0.2, { rng, wobble: 0.006 }));
      // lag bolts with big washers into the trunk
      if (Math.round(deg) % 18 === 6) {
        const n = radial(a);
        const g = new THREE.CylinderGeometry(0.05, 0.05, 0.03, 8);
        alongX(g.rotateZ(Math.PI / 2), p.clone().addScaledVector(n, 0.05), p.clone().addScaledVector(n, 0.09));
        B.add(ironMat, g, { cast: false });
      }
      prev = p;
    }
  }

  // rim beam: polygon of chords under the plank ends (outside the trunk only)
  const rimPts = [];
  {
    const N = 64;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * TAU;
      const r = R(th) - 0.17;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      rimPts.push({ th, x, z, ok: barkGap(x, z, yJ) > 0.12 });
    }
    const ty = -PLANK_T - 0.11;
    for (let i = 0; i < N; i++) {
      const a = rimPts[i], b = rimPts[i + 1];
      if (!a.ok || !b.ok) continue;
      F.add(timberMat, timber([a.x, ty + rng.jitter(0.01), a.z], [b.x, ty + rng.jitter(0.01), b.z], 0.09, 0.22, { rng, wobble: 0.004 }));
    }
  }

  // knee braces: from the underside of each joist down into the trunk (45°)
  const braces = [];
  for (const j of joists) {
    if (!j.brace) continue;
    const span = j.rOut - j.rIn;
    const rB = j.rIn + Math.min(span * 0.66, 2.5);
    const top = polar(j.a, rB, yJ - JOIST_H / 2 - 0.05);
    const yF = j.brace === 'std' ? top.y - (rB - bark(j.a, top.y)) : j.brace;
    const foot = polar(j.a, bark(j.a, yF) + 0.04, yF);
    B.add(timberMat, timber(foot, top, 0.15, 0.15, { rng, wobble: 0.02, up: [Math.cos(j.a), 0, -Math.sin(j.a)] }));
    // cleat under the foot, bolted into the bark
    const n = radial(j.a);
    const cleatC = polar(j.a, bark(j.a, yF - 0.22) + 0.07, yF - 0.22);
    const cleat = board(0.2, 0.26, 0.12, { along: 'y', rng });
    cleat.applyMatrix4(new THREE.Matrix4().makeRotationY(j.a).setPosition(cleatC));
    B.add(mats.wood(WOOD.frame), cleat);
    for (const s of [-1, 1]) {
      const bp = cleatC.clone().add(new THREE.Vector3(Math.cos(j.a) * 0.05 * s, 0.04 * s, -Math.sin(j.a) * 0.05 * s)).addScaledVector(n, 0.06);
      B.add(ironMat, xf(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 6), [bp.x, bp.y, bp.z], [Math.PI / 2, j.a, 0, 'YXZ']), { cast: false });
    }
    // the bolt through the brace head and the joist
    const tp = top.clone();
    const side = new THREE.Vector3(Math.cos(j.a), 0, -Math.sin(j.a));
    const bolt = new THREE.CylinderGeometry(0.025, 0.025, 0.24, 6);
    alongX(bolt.rotateZ(Math.PI / 2), tp.clone().addScaledVector(side, -0.12), tp.clone().addScaledVector(side, 0.12));
    B.add(ironMat, bolt, { cast: false });
    braces.push({ a: j.a, foot, top });
  }

  // ── nail heads where the planks cross the joists ──────────────────────────
  {
    const nailMat = mats.metal('#4a423a');
    const L0 = new THREE.Vector3(), L1 = new THREE.Vector3();
    for (const j of joists) {
      toLocal(polar(j.a, j.rIn, DECK_Y)).clone();
      L0.copy(toLocal(polar(j.a, j.rIn, DECK_Y)));
      L1.copy(toLocal(polar(j.a, j.rOut, DECK_Y)));
      for (const run of plankRuns) {
        const t = (run.x - L0.x) / (L1.x - L0.x || 1e-6);
        if (t < 0 || t > 1) continue;
        const z = L0.z + (L1.z - L0.z) * t;
        if (z < run.z0 + 0.04 || z > run.z1 - 0.04) continue;
        for (const s of [-1, 1]) {
          const g = new THREE.CylinderGeometry(0.014, 0.014, 0.012, 5);
          F.add(nailMat, xf(g, [run.x + s * 0.075 + rng.jitter(0.01), 0.003, z + rng.jitter(0.015)]), { cast: false });
        }
      }
    }
  }

  // ── ropes from the limbs above, lashed around limb and rim ────────────────
  const ropeMat = mats.rope();
  const ropes = [];
  const limb = (id) => ctx.oak?.limbInfo?.find((l) => l.id === id);
  const ROPES = [
    ['right', 0.22, 92],
    ['right', 0.36, 104],
    ['front-right-high', 0.3, 24],
    ['front', 0.3, 6],
  ];
  for (const [id, u, deg] of ROPES) {
    const L = limb(id);
    if (!L) continue;
    const P = L.curve.getPointAt(u);
    const rr = L.radiusAt(u);
    const a = deg * DEG;
    const rimR = outerR(a) - 0.2;
    const low = polar(a, rimR, DECK_Y - 0.1);
    const hang = P.clone();
    hang.y -= rr * 0.96;
    // only a rope that hangs roughly downwards (not through the trunk)
    if (hang.y < low.y + 2) continue;
    const g = tubeAlong(sagCurve(hang, low, 0.04, 10), 0.032, 6);
    B.add(ropeMat, g);
    // lashing around the limb: a few turns
    const T = L.curve.getTangentAt(u);
    for (let k = -2; k <= 2; k++) {
      const ring = new THREE.TorusGeometry(rr * 1.02, 0.03, 5, 18);
      ring.lookAt(T);
      const c = P.clone().addScaledVector(T, k * 0.065);
      B.add(ropeMat, xf(ring, [c.x, c.y, c.z]), { cast: false });
    }
    // knot + iron ring at the rim
    const knot = new THREE.TorusGeometry(0.07, 0.022, 5, 10);
    B.add(ironMat, xf(knot, [low.x, low.y - 0.05, low.z], [0, a + Math.PI / 2, 0]), { cast: false });
    B.add(ropeMat, xf(new THREE.SphereGeometry(0.06, 6, 5), [low.x, low.y + 0.07, low.z], null, [1, 1.4, 1]), { cast: false });
    ropes.push({ top: hang, low });
  }

  // ── railing of crooked branches ───────────────────────────────────────────
  const barkMat = mats.bark(BARK.warm); // warm, sun-bleached branches (like the stair's)
  const openings = [
    // around this bark point the railing stays open — where the stair arrives
    { a: STAIR_WELL.a0 * DEG, r: 1.15 },
  ];
  const railRuns = [];
  {
    // walk the outline (inset) and keep the parts outside the trunk & away from openings
    const N = 220;
    let run = [];
    const flush = () => {
      if (run.length > 3) railRuns.push(run);
      run = [];
    };
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * TAU;
      const r = R(th) - 0.22;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      const p = frame.polarOf(x, z);
      const gap = p.r - bark(p.a, DECK_Y + 0.3);
      let ok = gap > 0.5;
      for (const o of openings) {
        const w = frame.toWorld(x, 0, z);
        const c = polar(o.a, bark(o.a, DECK_Y), DECK_Y);
        if (Math.hypot(w.x - c.x, w.z - c.z) < o.r) ok = false;
      }
      if (ok) run.push({ x, z, th });
      else flush();
    }
    flush();
    // a run may wrap around θ = 0 → join first and last
    if (railRuns.length > 1) {
      const first = railRuns[0], last = railRuns[railRuns.length - 1];
      if (first[0].th < 0.05 && last[last.length - 1].th > TAU - 0.05) {
        railRuns[0] = [...last, ...first];
        railRuns.pop();
      }
    }
  }
  const railPosts = [];
  const H = 0.62;
  for (const run of railRuns) {
    // cumulative length → posts every ~0.8
    const cum = [0];
    for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z));
    const total = cum[cum.length - 1];
    const n = Math.max(1, Math.round(total / 0.8));
    const at = (s) => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      return { x: run[i - 1].x + (run[i].x - run[i - 1].x) * t, z: run[i - 1].z + (run[i].z - run[i - 1].z) * t };
    };
    const posts = [];
    for (let k = 0; k <= n; k++) {
      const s = (k / n) * total + (k > 0 && k < n ? rng.jitter(0.12) : 0);
      const p = at(Math.min(total, Math.max(0, s)));
      const h = H + rng.range(-0.04, 0.1);
      const lean = [rng.jitter(0.04), rng.jitter(0.04)];
      const mid = [p.x + lean[0] * 0.4 + rng.jitter(0.02), h * 0.5, p.z + lean[1] * 0.4 + rng.jitter(0.02)];
      const top = [p.x + lean[0], h, p.z + lean[1]];
      const pts = [new THREE.Vector3(p.x, -0.24, p.z), new THREE.Vector3(...mid), new THREE.Vector3(...top)];
      F.add(barkMat, branch(pts, 0.055, 0.042, { radial: 7, seed: rng.next() * 50 }));
      // a stub of a side twig on some posts
      if (rng.next() < 0.35) {
        const s0 = new THREE.Vector3(...mid);
        const dir = new THREE.Vector3(rng.jitter(1), rng.range(0.4, 1), rng.jitter(1)).normalize();
        F.add(barkMat, branch([s0, s0.clone().addScaledVector(dir, 0.08), s0.clone().addScaledVector(dir, 0.16)], 0.02, 0.012, { radial: 5, seed: rng.next() * 50 }), { cast: false });
      }
      posts.push({ x: top[0], y: top[1], z: top[2], base: p });
      railPosts.push(frame.toWorld(top[0], top[1], top[2]));
    }
    // top rail & mid rail: one crooked branch each through the posts
    const topPts = posts.map((p) => new THREE.Vector3(p.x, p.y - 0.03 + rng.jitter(0.02), p.z));
    if (topPts.length >= 2) {
      // extend a little past the end posts
      const ext = (a, b) => a.clone().addScaledVector(a.clone().sub(b).normalize(), 0.08);
      const tp = [ext(topPts[0], topPts[1]), ...topPts, ext(topPts[topPts.length - 1], topPts[topPts.length - 2])];
      F.add(barkMat, branch(tp, 0.042, 0.036, { radial: 7, seed: rng.next() * 50, seg: tp.length * 5 }));
      const midPts = posts.map((p) => new THREE.Vector3(p.base.x + (p.x - p.base.x) * 0.45, 0.27 + rng.jitter(0.03), p.base.z + (p.z - p.base.z) * 0.45));
      F.add(barkMat, branch(midPts, 0.028, 0.024, { radial: 6, seed: rng.next() * 50, seg: midPts.length * 5 }), { cast: false });
      // X-twigs in every other bay
      for (let k = 0; k < posts.length - 1; k++) {
        if ((k + (rng.next() < 0.2 ? 1 : 0)) % 2) continue;
        const a = posts[k], b = posts[k + 1];
        const a0 = new THREE.Vector3(a.base.x, 0.02, a.base.z), b0 = new THREE.Vector3(b.base.x, 0.02, b.base.z);
        const a1 = new THREE.Vector3(a.x, a.y - 0.06, a.z), b1 = new THREE.Vector3(b.x, b.y - 0.06, b.z);
        for (const [p, q] of [[a0, b1], [b0, a1]]) {
          const m = p.clone().lerp(q, 0.5).add(new THREE.Vector3(rng.jitter(0.03), rng.jitter(0.03), rng.jitter(0.03)));
          F.add(barkMat, branch([p, m, q], 0.02, 0.016, { radial: 5, seed: rng.next() * 50 }), { cast: false });
        }
      }
    }
  }

  // ── moss: creeping in from the bark, at post feet, on the rim ─────────────
  const mossMat = mats.moss();
  {
    let placed = 0;
    for (let i = 0; i < 400 && placed < 70 * density; i++) {
      const x = rng.range(-R0, R0), z = rng.range(-R0, R0);
      if (!insideOutline(x, z, 0.1)) continue;
      const gap = barkGap(x, z);
      if (gap < 0.0) continue;
      // mostly near the bark, some along the rim
      const nearBark = gap < 0.9;
      const nearRim = !insideOutline(x, z, 0.55);
      if (!nearBark && !nearRim && rng.next() > 0.08) continue;
      if (inSlot(x, z) || inWell(x, z)) continue;
      const s = nearBark ? rng.range(0.12, 0.3) : rng.range(0.08, 0.18);
      F.add(mossMat, xf(mossGeo(rng, { r: s, h: s * 0.35, sx: rng.range(0.8, 1.6), sz: rng.range(0.7, 1.2) }), [x, 0.005, z], [0, rng.next() * TAU, 0]), { cast: false });
      placed++;
    }
    for (const run of railRuns) {
      for (let i = 0; i < run.length; i += 7) {
        if (rng.next() < 0.45) continue;
        const p = run[i];
        F.add(mossMat, xf(mossGeo(rng, { r: rng.range(0.1, 0.2), h: 0.06, sx: 1.4 }), [p.x, 0.0, p.z], [0, rng.next() * TAU, 0]), { cast: false });
      }
    }
    // moss on top of the ledger / joist ends near the bark (seen from below and the sides)
    for (const j of joists) {
      const p = polar(j.a, j.rOut - 0.05, yJ + JOIST_H / 2 - 0.02);
      B.add(mossMat, xf(mossGeo(rng, { r: 0.12, h: 0.05 }), [p.x, p.y - 0.1, p.z], [Math.PI / 2, j.a, 0, 'YXZ']), { cast: false });
    }
  }

  // ── ivy curtains and mossy beards hanging under the rim ───────────────────
  const ivyMat = mats.ivy();
  {
    const outN = new THREE.Vector3();
    // clumps of greenery spilling over the rim (each with a moss cushion on the edge)
    const okPts = rimPts.filter((p) => p.ok);
    const clumps = Math.round(11 * density);
    for (let c = 0; c < clumps && okPts.length; c++) {
      const p = okPts[Math.floor(((c + rng.next() * 0.6) / clumps) * okPts.length) % okPts.length];
      const w = frame.toWorld(p.x * 1.035, -0.16, p.z * 1.035);
      outN.set(p.x, 0, p.z).normalize().transformDirection(frame.matrix);
      const side = new THREE.Vector3(-outN.z, 0, outN.x);
      F.add(mossMat, xf(mossGeo(rng, { r: 0.24, h: 0.08, sx: 1.6, sz: 0.7 }), [p.x * 1.0, 0.0, p.z * 1.0], [0, -p.th, 0]), { cast: false });
      const strands = rng.int(3, 6);
      for (let k = 0; k < strands; k++) {
        const len = rng.range(0.32, 0.85) * (k === 0 ? 1.35 : 1);
        const base = w.clone().addScaledVector(side, rng.jitter(0.32)).add(new THREE.Vector3(0, rng.jitter(0.04), 0));
        const dir = new THREE.Vector3(rng.jitter(0.25), -1, rng.jitter(0.25));
        B.add(ivyMat, ivyCard(base, dir, outN.clone().addScaledVector(side, rng.jitter(0.6)), len, rng.next() < 0.5), { cast: false });
      }
    }
    // ivy climbing up a few braces from the trunk
    for (const br of braces) {
      if (rng.next() < 0.4) continue;
      const d = br.top.clone().sub(br.foot);
      const L = d.length();
      d.normalize();
      const n = new THREE.Vector3(0, 1, 0).addScaledVector(d, -d.y).normalize();
      for (let s = 0.05; s < L * 0.75; s += rng.range(0.28, 0.45)) {
        const base = br.foot.clone().addScaledVector(d, s).addScaledVector(n, 0.08);
        B.add(ivyMat, ivyCard(base, d.clone().add(new THREE.Vector3(rng.jitter(0.3), rng.jitter(0.2), rng.jitter(0.3))), n, rng.range(0.3, 0.5), rng.next() < 0.5), { cast: false });
      }
    }
  }

  // ── fallen leaves: drifts against the railing and the bark, a few in the open
  {
    const leafCols = ['#c9752e', '#d99a3a', '#a8502a', '#8a6a2e', '#b8862f', '#7f8a3a'];
    const paintMat = mats.paint();
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.05);
    shape.quadraticCurveTo(0.035, -0.01, 0.0, 0.05);
    shape.quadraticCurveTo(-0.035, -0.01, 0, -0.05);
    const proto = new THREE.ShapeGeometry(shape, 3).rotateX(-Math.PI / 2);
    let placed = 0;
    for (let i = 0; i < 900 && placed < 140 * density; i++) {
      const x = rng.range(-R0, R0), z = rng.range(-R0, R0);
      if (!deckOK(x, z)) continue;
      const nearEdge = !insideOutline(x, z, 0.55);
      const nearBark = barkGap(x, z) < 0.6;
      if (!nearEdge && !nearBark && rng.next() > 0.12) continue;
      const g = proto.clone();
      const s = rng.range(1.0, 1.8);
      // curled a little
      for (let v = 0, pos = g.attributes.position; v < pos.count; v++) pos.setY(v, Math.abs(pos.getX(v)) * 0.4 * rng.next());
      xf(g, [x, 0.018 + rng.next() * 0.012, z], [rng.jitter(0.12), rng.next() * TAU, rng.jitter(0.12)], s);
      F.add(paintMat, g, { color: rng.pick(leafCols), cast: false });
      placed++;
    }
  }

  // ── toadstools in the corners by the bark ─────────────────────────────────
  {
    let placed = 0;
    for (let i = 0; i < 200 && placed < 9; i++) {
      const x = rng.range(-R0, R0), z = rng.range(-R0, R0);
      if (!insideOutline(x, z, 0.3) || inSlot(x, z) || inWell(x, z)) continue;
      const gap = barkGap(x, z);
      if (gap < 0.05 || gap > 0.35) continue;
      const cluster = rng.int(1, 3);
      for (let k = 0; k < cluster; k++) addToadstool(F, mats, rng, x + rng.jitter(0.08), 0, z + rng.jitter(0.08), { size: rng.range(0.06, 0.12), color: rng.pick(['#c9352a', '#c9352a', '#d0662e', '#b98a4e']) });
      placed++;
    }
  }

  // ── the snail-lift slot: trimmed with boards, a little gate sign post ─────
  const slot = {};
  {
    const a = elevA;
    const rb = bark(a, DECK_Y);
    const side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const n = radial(a);
    const c = polar(a, rb + LIFT.slotDepth / 2, DECK_Y);
    // trimmer boards along the slot's two sides and its outer edge
    for (const s of [-1, 1]) {
      const p0 = polar(a, rb + 0.02, DECK_Y - 0.06).addScaledVector(side, s * (LIFT.slotHalf + 0.04));
      const p1 = polar(a, rb + LIFT.slotDepth + 0.02, DECK_Y - 0.06).addScaledVector(side, s * (LIFT.slotHalf + 0.04));
      B.add(timberMat, timber(p0, p1, 0.12, 0.14, { rng, wobble: 0.004 }));
    }
    {
      const p0 = polar(a, rb + LIFT.slotDepth + 0.04, DECK_Y - 0.06).addScaledVector(side, -LIFT.slotHalf - 0.1);
      const p1 = polar(a, rb + LIFT.slotDepth + 0.04, DECK_Y - 0.06).addScaledVector(side, LIFT.slotHalf + 0.1);
      B.add(timberMat, timber(p0, p1, 0.12, 0.14, { rng, wobble: 0.004 }));
    }
    // the lift gate: two tall branch posts at the outer corners joined by a
    // crooked crossbar (the sign hangs from it), and low rails along the sides
    const tops = [];
    for (const s of [-1, 1]) {
      const b0 = polar(a, rb + LIFT.slotDepth + 0.06, DECK_Y - 0.2).addScaledVector(side, s * (LIFT.slotHalf + 0.1));
      const b1 = b0.clone().add(new THREE.Vector3(0, 1.62, 0)).addScaledVector(n, 0.03).addScaledVector(side, s * 0.04);
      B.add(barkMat, branch([b0, b0.clone().lerp(b1, 0.45).add(new THREE.Vector3(rng.jitter(0.04), 0, rng.jitter(0.04))), b1], 0.06, 0.045, { radial: 7, seed: s * 7 }));
      slot['post' + (s > 0 ? 'L' : 'R')] = b1;
      tops.push(b1);
      // side rail back to the bark
      const r0 = polar(a, rb + 0.08, DECK_Y + 0.55).addScaledVector(side, s * (LIFT.slotHalf + 0.06));
      const r1 = b0.clone().setY(DECK_Y + 0.58);
      B.add(barkMat, branch([r0, r0.clone().lerp(r1, 0.5).add(new THREE.Vector3(0, 0.03, 0)), r1], 0.032, 0.03, { radial: 6, seed: s * 3 }), { cast: false });
    }
    {
      const [t0, t1] = tops;
      const mid = t0.clone().lerp(t1, 0.5).add(new THREE.Vector3(0, 0.1, 0));
      const e0 = t0.clone().addScaledVector(t0.clone().sub(t1).normalize(), 0.12).add(new THREE.Vector3(0, -0.05, 0));
      const e1 = t1.clone().addScaledVector(t1.clone().sub(t0).normalize(), 0.12).add(new THREE.Vector3(0, 0.02, 0));
      B.add(barkMat, branch([e0, t0.clone().add(new THREE.Vector3(0, 0.02, 0)), mid, t1.clone().add(new THREE.Vector3(0, 0.02, 0)), e1], 0.045, 0.04, { radial: 7, seed: 77 }));
      slot.bar = mid.clone().add(new THREE.Vector3(0, -0.04, 0));
      // lashings where the crossbar meets the posts
      for (const t of tops) B.add(ropeMat, xf(new THREE.TorusGeometry(0.055, 0.016, 4, 10), [t.x, t.y, t.z], [Math.PI / 2, 0, 0]), { cast: false });
    }
    slot.centre = c;
    slot.a = a;
    slot.outer = polar(a, rb + LIFT.slotDepth + 0.06, DECK_Y);
  }

  // ── railing along the stairwell's outer edge ──────────────────────────────
  {
    const pts = [];
    for (let deg = STAIR_WELL.a0 + 1.5; deg <= STAIR_WELL.a1 + 0.5; deg += 5.4) {
      const a = deg * DEG;
      pts.push(polar(a, bark(a, DECK_Y) + STAIR_WELL.depth + 0.08, DECK_Y));
    }
    // the well's end at a1: back along the radial edge to the bark
    const aE = (STAIR_WELL.a1 + 0.5) * DEG;
    pts.push(polar(aE, bark(aE, DECK_Y) + 0.75, DECK_Y), polar(aE, bark(aE, DECK_Y) + 0.12, DECK_Y));
    const tops = [];
    pts.forEach((p, i) => {
      const h = 0.62 + rng.range(-0.03, 0.08);
      const top = p.clone().add(new THREE.Vector3(rng.jitter(0.03), h, rng.jitter(0.03)));
      B.add(barkMat, branch([p.clone().add(new THREE.Vector3(0, -0.22, 0)), p.clone().lerp(top, 0.5).add(new THREE.Vector3(rng.jitter(0.02), 0, rng.jitter(0.02))), top], 0.05, 0.04, { radial: 7, seed: 40 + i }));
      tops.push(top);
      railPosts.push(top);
    });
    B.add(barkMat, branch(tops.map((t) => t.clone().add(new THREE.Vector3(0, -0.03, 0))), 0.04, 0.035, { radial: 7, seed: 51, seg: tops.length * 5 }));
    B.add(barkMat, branch(pts.map((p) => p.clone().add(new THREE.Vector3(0, 0.3, 0))), 0.027, 0.024, { radial: 6, seed: 52, seg: pts.length * 5 }), { cast: false });
    // X-twigs in the bays
    for (let k = 0; k < tops.length - 1; k += 2) {
      for (const [p, q] of [[pts[k], tops[k + 1]], [pts[k + 1], tops[k]]]) {
        const a0 = p.clone().add(new THREE.Vector3(0, 0.02, 0)), a1 = q.clone().add(new THREE.Vector3(0, -0.06, 0));
        B.add(barkMat, branch([a0, a0.clone().lerp(a1, 0.5).add(new THREE.Vector3(rng.jitter(0.03), 0, rng.jitter(0.03))), a1], 0.019, 0.015, { radial: 5, seed: k }), { cast: false });
      }
    }
  }

  return {
    R,
    insideOutline,
    barkGap,
    inSlot,
    inWell,
    deckOK,
    joists,
    braces,
    ropes,
    railRuns,
    railPosts,
    slot,
    y: DECK_Y,
    outerR,
    /** world position on the deck at deck-local (x, z) */
    at: (x, z, y = 0) => frame.toWorld(x, y, z),
  };
}
