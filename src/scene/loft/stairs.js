// ─────────────────────────────────────────────────────────────────────────────
// The winding stair of the Code Loft: old oak plank treads cantilevered from
// the bark of the Great Oak, spiralling up the trunk's right side from the
// ground at the back-right to the stairwell at the deck's front tip.
//
//   • every tread is its own weathered, silver-brown oak plank (lichen on the
//     outer end, a moss stain creeping in from the bark, a dished walking
//     line, two oak pegs) on a short bearer let into the bark; its outer end
//     rests on a wedge on a crooked, bark-on BOUGH that spirals up under each
//     flight — the bough is carried by a few knee braces from the bark
//     (rope-lashed) and, near the ground, by forked branch posts. Hand-built:
//     tread length, angle, spacing and rise all wander a little, every
//     seventh tread is a split half-log, two are pale new replacements and one
//     is missing (its replacement leans against the trunk at the foot). Moss,
//     lichen, trailing ivy and toadstools everywhere. No honey/orange planks,
//     no milled square posts, no iron: from the workshop it must read as
//     woodland joinery, never as a fire escape (few, organic lines)
//   • a rope handrail on crooked bark-on balusters (every third tread),
//     little lanterns on three balusters and the landing post, fairy lights
//     spiralling up with the handrail
//   • shelf fungi on the bark beside some treads
//   • half-way up, where the snail lift's track crosses, the stair rests on a
//     wider LANDING with a slot at the bark the snail passes through: crooked
//     forked posts, a rope rail, a bird feeder with a robin on it
//   • at the foot: a mossy stone step, stepping stones, a lantern on a stake
//
// Exposes the stair's path for others: stairY(azDeg) and STAIR.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OAK } from '../../world/layout.js';
import { getHeight } from '../../world/ground.js';
import { DEG, TAU, OLD_OAK, BOUGH_BARK, DARK_OAK, NEW_WOOD, LICHEN, polar, radial, board, timber, branch, tubeAlong, xf, deform, stoneGeo, mossGeo, addToadstool, ivyCard, shelfFungus, lashing, weatherPaint, lichenGeo, crookedPath } from './kit.js';
import { ELEVATOR_AZ, STAIR_WELL, LIFT } from './deck.js';

/** The stair's course: azimuths in degrees around the oak (it climbs clockwise). */
export const STAIR = {
  bottomAz: 150, // first tread (back-right, at the ground)
  topAz: 2, // last tread, in the stairwell at the deck's front tip
  y0: 0.3,
  landing: { a0: ELEVATOR_AZ - 9, a1: ELEVATOR_AZ + 9 },
  treads: 40,
  inner: 0.03, // tread starts this far from the bark
  length: 1.28, // tread length (radial, ±15 % per tread)
  depth: 0.3, // tread depth (tangential)
  riseJitter: 0.08, // ± fraction of the rise each tread wanders (hand-built)
  spaceJitter: 0.15, // ± fraction of the azimuth step
  missing: [16], // a tread gone (its replacement waits at the foot)
  replaced: [11, 30], // pale new treads among the silvered ones
};

/** deterministic 0..1 hash (the stair's path must be the same for every caller) */
const hash = (i, s) => {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Steps: [{ a (rad), y, landing? }] from the bottom up (the deck is the step after the last). */
export function stairSteps() {
  const { bottomAz, topAz, y0, landing, treads } = STAIR;
  const rise = (OAK.loft.y - y0) / treads;
  const before = bottomAz - landing.a1; // degrees of flight below the landing
  const after = landing.a0 - topAz; // degrees of flight above it
  const k = Math.round((treads * before) / (before + after)); // index of the landing
  const dA0 = before / k, dA1 = (after - 1.7) / (treads - k - 1);
  const steps = [];
  for (let i = 0; i < treads; i++) {
    let y = y0 + i * rise;
    // rise and spacing wander a little — never at the ends or beside the landing
    const free = i > 0 && i < treads - 1 && Math.abs(i - k) > 1;
    if (free) y += (hash(i, 1) * 2 - 1) * STAIR.riseJitter * rise;
    const da = free ? (hash(i, 2) * 2 - 1) * STAIR.spaceJitter : 0;
    if (i < k) steps.push({ a: (bottomAz - (i + da) * dA0 - 1.6) * DEG, y });
    else if (i === k) steps.push({ a: ((landing.a0 + landing.a1) / 2) * DEG, y, landing: true });
    else steps.push({ a: (landing.a0 - 1.7 - (i - k - 1 + da) * dA1) * DEG, y });
  }
  return { steps, rise, landingY: y0 + k * rise };
}

/** Height of the stair's walking surface at azimuth (deg) — for keeping things clear of it. */
export function stairY(azDeg) {
  const { steps } = stairSteps();
  let best = null;
  for (const s of steps) {
    const d = Math.abs(s.a / DEG - azDeg);
    if (!best || d < best.d) best = { d, y: s.y };
  }
  return best ? best.y : 0;
}

export function buildStairs(ctx, B, mats, env) {
  const { bark, rng, halos, rootTop } = env;
  const { steps, landingY } = stairSteps();
  const density = Math.min(1, env.density ?? 1);
  const ropeMat = mats.rope();
  /** a crooked bark-on branch (grey-brown bark, lighter than the oak's own) */
  const bough = (pts, r0, r1, opts = {}, bopts = {}) => B.add(mats.bark(rng.pick(BOUGH_BARK)), branch(pts, r0, r1, { lump: 0.18, ...opts }), bopts);
  /** a pale lichen rosette lying on a surface (point + its normal) */
  const lichen = (p, nrm, r = 0.035) => {
    const g = lichenGeo(rng, r * rng.range(0.7, 1.3));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm.clone().normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
    B.add(mats.paint(), g, { color: rng.pick(LICHEN), cast: false });
  };
  /** a short dead twig stub off a branch (point, direction) */
  const twig = (p, dir, len, r = 0.026) => {
    const d = dir.clone().normalize();
    const mid = p.clone().addScaledVector(d, len * 0.55).add(new THREE.Vector3(rng.jitter(0.03), rng.jitter(0.03), rng.jitter(0.03)));
    bough([p.clone().addScaledVector(d, -0.02), mid, p.clone().addScaledVector(d, len)], r, r * 0.3, { radial: 5, seed: p.x * 7 + p.z, lump: 0.1 }, { cast: false });
  };
  const fungusSpots = []; // shelf fungi on the bark beside some brackets
  const outerTops = []; // baluster tops (outer rope)
  const flights = [[], []]; // the treads of each flight (bottom → top), for the stringer bough
  const L = STAIR.length;
  const TH = 0.075; // tread thickness
  const SR = 0.08; // stringer bough radius
  const BR = 0.82; // the bough runs this far out from the tread's inner end
  /** ground (or root) height under (x, z) */
  const floorAt = (p) => {
    const t = rootTop(p.x, p.z);
    return Math.max(getHeight(p.x, p.z), isFinite(t) ? t : -Infinity);
  };
  const UP = new THREE.Vector3(0, 1, 0);

  steps.forEach((s, i) => {
    const a = s.a;
    const n = radial(a);
    const t = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)); // tangent (towards +az)
    if (s.landing) return; // built below
    const flight = s.y < landingY ? 0 : 1;
    const missing = STAIR.missing.includes(i);
    const fresh = STAIR.replaced.includes(i);
    const r0 = bark(a, s.y) + STAIR.inner;
    const len = L * (1 + rng.jitter(0.15)); // hand-cut: no two the same length
    const r1 = r0 + len;
    const basis = new THREE.Matrix4().makeBasis(n, UP, t.clone().negate());
    const tone = fresh ? rng.pick(NEW_WOOD) : rng.pick(OLD_OAK);
    // hand-laid: no two treads quite parallel, their outer ends never in a ruler line
    const m = basis.clone();
    m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rng.jitter(0.035), rng.jitter(0.14), rng.jitter(0.025))));
    m.setPosition(polar(a, (r0 + r1) / 2, s.y - TH / 2));
    if (!missing) {
      // the tread: a thick plank, radial, a touch tilted and twisted — every
      // seventh one a split half-log (a repair with whatever lay around)
      let g;
      if (i % 7 === 3) {
        g = new THREE.CylinderGeometry(STAIR.depth * 0.55, STAIR.depth * 0.55, len + 0.02, 9, 3, false, 0, Math.PI);
        // axis along X, the round side down, flattened: a split log
        g.rotateZ(Math.PI / 2).rotateX(Math.PI).scale(1, 0.42, 1);
        g.translate(0, 0.015, 0);
        B.add(mats.bark(rng.pick(BOUGH_BARK)), g.applyMatrix4(basis.clone().setPosition(polar(a, (r0 + r1) / 2, s.y - TH / 2))), { cast: false });
        // its flat, sawn top
        g = weatherPaint(board(len + 0.02, 0.02, STAIR.depth * 1.08, { along: 'x', rng, c: 0.006, segs: 4 }), tone, { mossEnd: -1, seed: i });
        g.translate(0, TH / 2 - 0.01, 0);
      } else {
        g = board(len + 0.04, TH * rng.range(0.92, 1.15), STAIR.depth + rng.range(-0.03, 0.05), { along: 'x', rng, c: 0.014, segs: 6 });
        // worn: the middle of the walking line is dished a little
        deform(g, (v) => {
          if (v.y > 0) v.y -= 0.012 * Math.exp(-((v.x / L + 0.08) ** 2) * 9);
        });
        // silvered and lichened, a green moss stain creeping out from the bark
        weatherPaint(g, tone, { mossEnd: fresh ? 0 : -1, seed: i, lichen: fresh ? 0 : 0.55 });
      }
      g.applyMatrix4(m);
      B.add(mats.wood(tone), g);
      // two oak pegs through the tread into the bough
      for (const k of [-1, 1]) {
        const pp = polar(a, r0 + BR, s.y + 0.002).addScaledVector(t, k * 0.06);
        B.add(mats.wood(fresh ? '#8a6d4c' : '#4f4032'), xf(new THREE.CylinderGeometry(0.017, 0.017, 0.012, 6), [pp.x, pp.y, pp.z]), { cast: false });
      }
      // lichen on the outer end (never on the walking line)
      if (!fresh && rng.next() < 0.6) {
        for (let j = rng.int(1, 3); j > 0; j--) {
          const lp = new THREE.Vector3(len * rng.range(0.22, 0.48), TH / 2 + 0.001, rng.jitter(STAIR.depth * 0.38)).applyMatrix4(m);
          lichen(lp, UP.clone().transformDirection(m), 0.032);
        }
      }
      // ivy hanging over the outer end of some treads (softens the stack seen edge-on)
      if (i % 4 === 1 && Math.abs(a / DEG - ELEVATOR_AZ) > 15 && rng.next() < 0.75 * density) {
        const base = new THREE.Vector3(len * 0.42, TH / 2, rng.jitter(0.1)).applyMatrix4(m);
        B.add(mats.ivy(), ivyCard(base, new THREE.Vector3(rng.jitter(0.3), -1, rng.jitter(0.3)), n, rng.range(0.35, 0.7), rng.next() < 0.5), { cast: false });
      }
    }
    // a short oak bearer under the inner end, let into the bark
    B.add(mats.wood(DARK_OAK), timber(polar(a, r0 - 0.06, s.y - TH - 0.04), polar(a, r0 + 0.32, s.y - TH - 0.04), 0.1, 0.08, { rng, wobble: 0.004 }), { cast: false });
    if (missing) {
      // the gap: the bare bearer, grown over with moss, two empty peg holes
      B.add(mats.moss(), xf(mossGeo(rng, { r: 0.09, h: 0.04, sx: 1.6 }), [0, 0, 0]).applyMatrix4(basis.clone().setPosition(polar(a, r0 + 0.14, s.y - TH))), { cast: false });
    }
    flights[flight].push({ a, y: s.y, r: r0 + BR, i, t });
    // shelf fungi creep along some brackets
    if (i % 5 === 2) fungusSpots.push({ a, y: s.y - 0.3, t });
    // crooked bark-on balusters on every third tread, mortised through the tread
    if (i % 3 === 0 && !missing) {
      const b0 = polar(a, r1 - 0.1, s.y - TH - 0.12);
      const top = polar(a, r1 - 0.1, s.y).add(new THREE.Vector3(rng.jitter(0.06), 0.72 + rng.jitter(0.07), rng.jitter(0.06)));
      bough(crookedPath(b0, top, rng, { bend: 0.05, n: 3 }), 0.042, 0.03, { radial: 6, seed: i }, { cast: false });
      if (rng.next() < 0.4) twig(b0.clone().lerp(top, rng.range(0.45, 0.75)), n.clone().addScaledVector(t, rng.jitter(1)).add(new THREE.Vector3(0, 0.6, 0)), rng.range(0.08, 0.15), 0.016);
      // a cushion of moss on the cut top, lichen down its side
      B.add(mats.moss(), xf(mossGeo(rng, { r: 0.05, h: 0.03 }), [top.x, top.y + 0.005, top.z]), { cast: false });
      if (rng.next() < 0.5) lichen(top.clone().lerp(b0, 0.35).addScaledVector(n, 0.035), n, 0.022);
      outerTops.push(top);
    }
    // moss on some treads near the bark, a toadstool here and there
    if (!missing && rng.next() < 0.45) B.add(mats.moss(), xf(mossGeo(rng, { r: rng.range(0.08, 0.13), h: 0.035, sx: 1.4 }), [0, 0, 0]).applyMatrix4(basis.clone().setPosition(polar(a, r0 + 0.12, s.y - 0.005))), { cast: false });
    if (!missing && i % 6 === 1 && i > 6) addToadstool(B.at(new THREE.Matrix4()), mats, rng, ...polar(a + 0.03, r0 + 0.1, s.y).toArray(), { size: rng.range(0.05, 0.08) });
  });

  // ── the stringer boughs: one crooked, bark-on limb under each flight,
  //    carried by a few knee braces from the bark (rope-lashed) or, near the
  //    ground, forked posts; each tread sits on its own fitted oak wedge ─────
  for (const fl of flights) {
    if (fl.length < 2) continue;
    const N = fl.length;
    const seed = fl[0].i * 1.37;
    // a grown limb: a smooth ramp with a slow wander (the wedges take up the rest)
    fl.forEach((f, k) => {
      const ramp = fl[0].y + ((fl[N - 1].y - fl[0].y) * k) / (N - 1);
      const wob = 0.035 * Math.sin(k * 0.45 + seed) + 0.016 * Math.sin(k * 1.3 + seed * 2);
      f.p = polar(f.a, f.r + 0.04 * Math.sin(k * 0.33 + seed * 0.7), ramp - TH - 0.16 - SR + wob);
    });
    const ext = (p, q, d) => p.clone().addScaledVector(p.clone().sub(q).normalize(), d);
    const course = [ext(fl[0].p, fl[1].p, 0.2), ...fl.map((f) => f.p), ext(fl[N - 1].p, fl[N - 2].p, 0.16)];
    bough(course, SR * 1.12, SR * 0.85, { radial: 8, seed: seed + 1, lump: 0.2 });
    fl.forEach((f, k) => {
      const dir = (k + 1 < N ? fl[k + 1].p : f.p).clone().sub(k > 0 ? fl[k - 1].p : f.p).normalize();
      // the wedge between the bough and the tread (each one fitted by hand)
      const top = f.y - TH, bot = f.p.y + SR * 0.7;
      const h = top - bot;
      if (h > 0.01 && !STAIR.missing.includes(f.i)) {
        const c = polar(f.a, f.p.distanceTo(new THREE.Vector3(OAK.x, f.p.y, OAK.z)), bot + h / 2);
        B.add(mats.wood(DARK_OAK), xf(new THREE.BoxGeometry(0.12, h + 0.03, 0.11), [c.x, c.y, c.z], [rng.jitter(0.05), f.a, rng.jitter(0.05)]), { cast: false });
      }
      // moss along the top of the bough, lichen on its flanks
      if (rng.next() < 0.75) {
        const mp = f.p.clone().addScaledVector(dir, rng.range(0.08, 0.16));
        B.add(mats.moss(), xf(mossGeo(rng, { r: rng.range(0.07, 0.12), h: 0.045, sx: 1.7 }), [mp.x, mp.y + SR * 0.72, mp.z], [0, -f.a, 0]), { cast: false });
      }
      if (rng.next() < 0.35) lichen(f.p.clone().addScaledVector(radial(f.a), SR * 0.95), radial(f.a), 0.03);
      // a dead twig stub now and then
      if (k % 5 === 2) twig(f.p.clone().addScaledVector(radial(f.a), SR * 0.6), radial(f.a).multiplyScalar(0.7).add(new THREE.Vector3(0, -0.45, 0)).addScaledVector(f.t, rng.jitter(0.5)), rng.range(0.16, 0.3));
      // ivy spilling over the bough (softens the stack of treads seen edge-on
      // from the workshop) — keep the snail lift's path clear
      if (Math.abs(f.a / DEG - ELEVATOR_AZ) < 15) return;
      if (rng.next() > 0.85 * density) return;
      const strands = rng.int(2, 4);
      for (let j = 0; j < strands; j++) {
        const base = f.p.clone().addScaledVector(radial(f.a), rng.range(-0.05, 0.12)).addScaledVector(dir, rng.jitter(0.12)).add(new THREE.Vector3(0, SR * 0.4, 0));
        B.add(mats.ivy(), ivyCard(base, new THREE.Vector3(rng.jitter(0.3), -1, rng.jitter(0.3)), radial(f.a), rng.range(0.45, 1.25), rng.next() < 0.5), { cast: false });
      }
    });
    // a few knee braces (every 6th tread; bark-on so they recede against the
    // trunk instead of zig-zagging) or forked posts to the ground (low treads)
    fl.forEach((f, k) => {
      const low = f.y < 1.7;
      if (low ? k % 3 !== 1 : k % 6 !== 3) return;
      const head = f.p.clone();
      const dir = (k + 1 < N ? fl[k + 1].p : f.p).clone().sub(k > 0 ? fl[k - 1].p : f.p).normalize();
      if (low) {
        const g0 = floorAt(head);
        if (!isFinite(g0) || head.y - g0 < 0.15) return;
        const foot = head.clone().setY(g0 - 0.1).addScaledVector(radial(f.a), rng.jitter(0.06));
        const crotch = head.clone().add(new THREE.Vector3(0, -SR - 0.1, 0));
        bough(crookedPath(foot, crotch, rng, { bend: 0.06, n: 3 }), 0.065, 0.055, { radial: 7, seed: f.i });
        // the fork the bough rests in
        for (const s of [-1, 1]) bough([crotch, crotch.clone().addScaledVector(radial(f.a), s * 0.07).add(new THREE.Vector3(0, 0.12, 0)), head.clone().addScaledVector(radial(f.a), s * (SR + 0.03)).add(new THREE.Vector3(0, 0.06, 0))], 0.04, 0.025, { radial: 5, seed: f.i + s }, { cast: false });
        B.add(mats.moss(), xf(mossGeo(rng, { r: 0.15, h: 0.05 }), [foot.x, g0 + 0.02, foot.z]), { cast: false });
      } else {
        const yF = f.y - 1.75;
        const foot = polar(f.a, bark(f.a, yF) - 0.02, yF);
        const mid = foot.clone().lerp(head, 0.5).addScaledVector(radial(f.a), -0.1).add(new THREE.Vector3(0, -0.05, 0));
        bough([foot, mid, head], 0.075, 0.05, { radial: 7, seed: f.i * 1.7 });
      }
      // the lashing where they meet the bough
      for (const g of lashing(head, dir, SR, { turns: 3 })) B.add(ropeMat, g, { cast: false });
      // moss on top of the bough here, ivy trailing from it
      B.add(mats.moss(), xf(mossGeo(rng, { r: 0.13, h: 0.05, sx: 1.6 }), [head.x, head.y + SR * 0.7, head.z], [0, -f.a, 0]), { cast: false });
      for (let j = 0; j < 3; j++) {
        const base = head.clone().addScaledVector(dir, rng.jitter(0.3)).add(new THREE.Vector3(0, -0.02, 0));
        B.add(mats.ivy(), ivyCard(base, new THREE.Vector3(rng.jitter(0.25), -1, rng.jitter(0.25)), radial(f.a), rng.range(0.3, 0.6), rng.next() < 0.5), { cast: false });
      }
    });
  }

  // ── the landing where the snail lift passes (a slot at the bark) ─────────
  const landing = { y: landingY };
  {
    const { a0, a1 } = STAIR.landing;
    const ly = landingY;
    const rIn = (a) => bark(a, ly) + STAIR.inner;
    const W = LIFT.slotDepth + 0.78; // radial width
    // tangential planks on the outer part (beyond the slot), silvered oak
    for (let k = 0; k < 3; k++) {
      const pts = [];
      const rr = LIFT.slotDepth + 0.1 + k * 0.22;
      for (let d = a0 - 1.5; d <= a1 + 1.5; d += 3) {
        const a = d * DEG;
        pts.push(polar(a, rIn(a) + rr, ly - 0.033));
      }
      for (let j = 0; j < pts.length - 1; j++) {
        const g = timber(pts[j], pts[j + 1], 0.22, 0.065, { rng, wobble: 0.004, scale: 1 / 1.4 });
        B.add(mats.wood(rng.pick(OLD_OAK)), g);
        if (rng.next() < 0.5) lichen(pts[j].clone().lerp(pts[j + 1], rng.range(0.2, 0.8)).add(new THREE.Vector3(0, 0.034, 0)), UP, 0.03);
      }
    }
    // radial planks at both ends (from the bark), where the flights arrive
    for (const d of [a0 + 1.2, a1 - 1.2]) {
      const a = d * DEG;
      const n = radial(a);
      const g = weatherPaint(board(W + 0.02, 0.065, 0.24, { along: 'x', rng, segs: 6 }), rng.pick(OLD_OAK), { mossEnd: -1, seed: d });
      g.applyMatrix4(new THREE.Matrix4().makeBasis(n, UP, new THREE.Vector3(-Math.cos(a), 0, Math.sin(a))).setPosition(polar(a, rIn(a) + W / 2, ly - 0.033)));
      B.add(mats.wood(OLD_OAK[0]), g);
    }
    // two crooked knee braces at the ends (rope-lashed to the bearers) and a
    // bough under the outer edge
    for (const d of [a0 + 2.5, a1 - 2.5]) {
      const a = d * DEG;
      const foot = polar(a, bark(a, ly - 1.5) - 0.02, ly - 1.5);
      const head = polar(a, rIn(a) + W - 0.25, ly - 0.14);
      const mid = foot.clone().lerp(head, 0.5).addScaledVector(radial(a), -0.08).add(new THREE.Vector3(0, -0.06, 0));
      bough([foot, mid, head], 0.085, 0.06, { radial: 7, seed: d });
      B.add(mats.wood(DARK_OAK), timber(polar(a, rIn(a) - 0.03, ly - 0.14), polar(a, rIn(a) + W - 0.1, ly - 0.14), 0.1, 0.13, { rng }));
      for (const g of lashing(head, radial(a), 0.07, { turns: 3 })) B.add(ropeMat, g, { cast: false });
    }
    {
      const pts = [];
      for (let d = a0 + 1; d <= a1 - 1; d += 4) pts.push(polar(d * DEG, rIn(d * DEG) + W - 0.2, ly - 0.15 + rng.jitter(0.015)));
      bough(pts, 0.075, 0.065, { radial: 7, seed: 91 });
    }
    // crooked, forked bark-on posts round the outer edge, a rope rail through
    // their crotches (no milled posts, no straight rails)
    const tops = [];
    const span = a1 - a0 - 1;
    [0, 0.31, 0.64, 1].forEach((u, k) => {
      const d = a0 + 0.5 + span * u + (k > 0 && k < 3 ? rng.jitter(1) : 0);
      const a = d * DEG;
      const n = radial(a);
      const b0 = polar(a, rIn(a) + W - 0.08, ly - 0.2);
      const top = b0.clone().add(new THREE.Vector3(rng.jitter(0.06), 0.86 + rng.jitter(0.07), rng.jitter(0.06)));
      bough(crookedPath(b0, top, rng, { bend: 0.06, n: 3 }), 0.05, 0.038, { radial: 6, seed: d }, { cast: false });
      // the fork: two short prongs either side of the rope
      const tg = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      for (const s of [-1, 1]) {
        const tip = top.clone().addScaledVector(n, s * 0.06).addScaledVector(tg, rng.jitter(0.03)).add(new THREE.Vector3(0, 0.11 + rng.jitter(0.02), 0));
        bough([top.clone().add(new THREE.Vector3(0, -0.04, 0)), top.clone().lerp(tip, 0.5).addScaledVector(n, s * 0.015), tip], 0.026, 0.016, { radial: 5, seed: d + s }, { cast: false });
      }
      B.add(mats.moss(), xf(mossGeo(rng, { r: 0.05, h: 0.025 }), [top.x, top.y - 0.02, top.z]), { cast: false });
      tops.push(top.clone().add(new THREE.Vector3(0, 0.02, 0)));
    });
    landing.tops = tops;
    landing.centre = polar(((a0 + a1) / 2) * DEG, rIn(((a0 + a1) / 2) * DEG) + 1.6, ly);
    // moss along the landing's outer edge, a clump of ivy spilling over it
    for (let d = a0 + 2; d <= a1 - 2; d += 5) {
      const a = d * DEG;
      const p = polar(a, rIn(a) + W - 0.3, ly);
      B.add(mats.moss(), xf(mossGeo(rng, { r: 0.16, h: 0.05, sx: 1.5 }), [p.x, p.y, p.z], [0, -a, 0]), { cast: false });
      for (let j = 0; j < 3; j++) {
        const base = polar(a + rng.jitter(0.03), rIn(a) + W - 0.05, ly - 0.12);
        B.add(mats.ivy(), ivyCard(base, new THREE.Vector3(rng.jitter(0.2), -1, rng.jitter(0.2)), radial(a), rng.range(0.4, 0.85), rng.next() < 0.5), { cast: false });
      }
    }
    // a little lantern on the landing's second post (added with the lights below)
    halos.push(tops[1].clone().add(new THREE.Vector3(0, 0.12, 0)), 0.7, '#ffc46e');
    landing.lamp = tops[1].clone();
    // a bird feeder hanging from a crooked arm off the third post, a robin on it
    birdFeeder(tops[2], Math.atan2(tops[2].x - OAK.x, tops[2].z - OAK.z));
  }

  /** a little shingled bird feeder on a rope from an arm off post `top`, out over the edge */
  function birdFeeder(top, a) {
    const n = radial(a);
    const tg = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const armEnd = top.clone().addScaledVector(n, 0.42).add(new THREE.Vector3(0, 0.1, 0));
    bough([top.clone().add(new THREE.Vector3(0, -0.12, 0)), top.clone().addScaledVector(n, 0.2).add(new THREE.Vector3(0, 0.02, 0)), armEnd], 0.024, 0.014, { radial: 5, seed: 33 }, { cast: false });
    const hook = armEnd.clone().addScaledVector(n, -0.02);
    const drop = 0.2;
    B.add(ropeMat, tubeAlong([hook, hook.clone().add(new THREE.Vector3(0.004, -drop * 0.5, 0)), hook.clone().add(new THREE.Vector3(0, -drop, 0))], 0.006, 4), { cast: false });
    // local frame: origin under the hook at the roof ridge, x along the ridge (tangent), y up
    const F = new THREE.Matrix4().makeBasis(tg, UP, tg.clone().cross(UP)).setPosition(hook.clone().add(new THREE.Vector3(0, -drop, 0)));
    const put = (mat, g, opts = {}) => B.add(mat, g.applyMatrix4(F), { cast: false, ...opts });
    // pitched roof of two little boards, a ridge strip
    for (const s of [-1, 1]) {
      const g = board(0.22, 0.012, 0.13, { along: 'x', rng });
      g.rotateX(s * 0.62).translate(0, -0.035, s * 0.052);
      put(mats.wood('#6f5e4c'), g);
    }
    put(mats.moss(), xf(mossGeo(rng, { r: 0.05, h: 0.02, sx: 1.6 }), [0.03, 0.004, 0.0]));
    // four corner sticks and the tray with a rim
    for (const [x, z] of [[-0.085, -0.055], [0.085, -0.055], [-0.085, 0.055], [0.085, 0.055]]) put(mats.wood('#5f5040'), xf(new THREE.CylinderGeometry(0.006, 0.006, 0.15, 4), [x, -0.11, z]));
    put(mats.wood('#7d6a57'), board(0.2, 0.016, 0.14, { along: 'x', rng }).translate(0, -0.19, 0));
    for (const s of [-1, 1]) {
      put(mats.wood('#6a5947'), board(0.2, 0.018, 0.01, { along: 'x', rng }).translate(0, -0.176, s * 0.068));
      put(mats.wood('#6a5947'), board(0.01, 0.018, 0.14, { along: 'z', rng }).translate(s * 0.098, -0.176, 0));
    }
    // seeds
    for (let k = 0; k < 9; k++) put(mats.paint(), xf(new THREE.SphereGeometry(0.009, 4, 3), [rng.jitter(0.07), -0.178, rng.jitter(0.045)], null, [1, 0.6, 1.4]), { color: rng.pick(['#c9a66b', '#5a4630', '#e2d3a8']) });
    // the robin on the outer rim, looking out over the glen
    const R = new THREE.Matrix4().makeTranslation(0.045, -0.165, 0.068).multiply(new THREE.Matrix4().makeRotationY(-0.5));
    const bird = (g, color) => put(mats.paint(), g.applyMatrix4(R), { color });
    bird(xf(new THREE.SphereGeometry(0.034, 8, 6), [0, 0.034, 0], null, [0.9, 0.85, 1.2]), '#7b5f43'); // body
    bird(xf(new THREE.SphereGeometry(0.026, 8, 6), [0, 0.03, 0.022], null, [0.95, 0.95, 0.7]), '#e2763a'); // breast
    bird(xf(new THREE.SphereGeometry(0.023, 8, 6), [0, 0.072, 0.03]), '#7b5f43'); // head
    bird(xf(new THREE.SphereGeometry(0.017, 6, 5), [0, 0.064, 0.044]), '#e2763a'); // face
    bird(xf(new THREE.ConeGeometry(0.006, 0.02, 4), [0, 0.07, 0.06], [Math.PI / 2, 0, 0]), '#3a2c20'); // beak
    for (const s of [-1, 1]) bird(xf(new THREE.SphereGeometry(0.0045, 4, 3), [s * 0.015, 0.079, 0.045]), '#15100c'); // eyes
    bird(xf(new THREE.BoxGeometry(0.03, 0.008, 0.05), [0, 0.04, -0.05], [-0.5, 0, 0]), '#5f4632'); // tail
  }

  // ── rope handrails ────────────────────────────────────────────────────────
  {
    // outer: through the baluster tops, inserting the landing's posts in order
    const azOf = (p) => Math.atan2(p.x - OAK.x, p.z - OAK.z) / DEG;
    const pts = [...outerTops, ...landing.tops].sort((p, q) => azOf(q) - azOf(p));
    // a sagging rope between consecutive tops
    const ropePts = [];
    for (let j = 0; j < pts.length - 1; j++) {
      const p = pts[j], q = pts[j + 1];
      for (let k = 0; k < 4; k++) {
        const u = k / 4;
        const v = p.clone().lerp(q, u);
        v.y -= Math.sin(u * Math.PI) * 0.06;
        ropePts.push(v);
      }
    }
    ropePts.push(pts[pts.length - 1]);
    B.add(ropeMat, tubeAlong(ropePts, 0.02, 5, ropePts.length * 2), { cast: false });
    // small knots on the balusters
    for (const p of pts) B.add(ropeMat, xf(new THREE.SphereGeometry(0.03, 5, 4), [p.x, p.y, p.z]), { cast: false });
  }

  // ── lights along the climb: little lanterns on a few balusters and a
  //    string of fairy lights spiralling up with the handrail ───────────────
  {
    const azOf = (p) => Math.atan2(p.x - OAK.x, p.z - OAK.z) / DEG;
    const tops = [...outerTops].sort((p, q) => azOf(q) - azOf(p)); // bottom → top
    const lanternAt = [Math.round(tops.length * 0.22), Math.round(tops.length * 0.58), Math.round(tops.length * 0.86)];
    for (const k of lanternAt) {
      const p = tops[k];
      if (!p) continue;
      const l = ctx.props.makeLantern({ color: '#ffc46b', halo: false });
      l.scale.setScalar(0.62);
      l.position.copy(p).add(new THREE.Vector3(0, 0.03, 0));
      l.rotation.y = rng.next() * TAU;
      env.extraLights?.add(l);
      halos.push(p.clone().add(new THREE.Vector3(0, 0.14, 0)), 0.75, '#ffc46e');
    }
    // the landing's second post carries one too
    if (landing.lamp) {
      const l = ctx.props.makeLantern({ color: '#ffc46b', halo: false });
      l.scale.setScalar(0.62);
      l.position.copy(landing.lamp).add(new THREE.Vector3(0, 0.03, 0));
      env.extraLights?.add(l);
    }
    // fairy lights: tied a little below the rope, from post to post, one
    // string per flight (the landing gap splits them)
    const pts = tops.map((p) => p.clone().add(new THREE.Vector3(0, -0.05, 0)));
    let run = [pts[0]];
    const flush = () => {
      if (run.length > 1) env.extraLights?.add(ctx.props.makeStringLights(run, { sag: 0.12, spacing: 0.5, colors: ['#ffd9a0'] }));
    };
    for (let k = 1; k < pts.length; k++) {
      if (pts[k].distanceTo(pts[k - 1]) > 2.4) {
        flush();
        run = [];
      }
      run.push(pts[k]);
    }
    flush();
  }

  // ── shelf fungi on the bark beside some brackets (muted bracket-fungus browns) ─
  {
    const fTop = mats.paint('#9a7350'), fUnder = mats.paint('#e6dcc0');
    for (const f of fungusSpots) {
      const k = rng.int(2, 3);
      for (let j = 0; j < k; j++) {
        const a = f.a + (rng.next() < 0.5 ? -1 : 1) * rng.range(0.05, 0.09);
        const y = f.y - j * 0.13 + rng.jitter(0.03);
        const r = rng.range(0.07, 0.12) * (1 - j * 0.15);
        const { top, under } = shelfFungus(r, rng);
        const n = radial(a);
        const x = new THREE.Vector3(0, 1, 0).cross(n).normalize();
        const m = new THREE.Matrix4().makeBasis(x, new THREE.Vector3(0, 1, 0), n).setPosition(polar(a, bark(a, y) - 0.01, y));
        B.add(fTop, top.applyMatrix4(m), { color: rng.pick(['#9a7350', '#a8835e', '#8b6544', '#b89a70']), cast: false });
        B.add(fUnder, under.applyMatrix4(m), { cast: false });
      }
    }
  }

  // ── the foot of the stair ─────────────────────────────────────────────────
  const first = steps[0];
  const bottom = polar(first.a, bark(first.a, 0.3) + 0.8, 0);
  {
    const a = first.a + 3 * DEG;
    const n = radial(a);
    // a big flat stone under the first tread and stepping stones leading out
    for (let k = 0; k < 4; k++) {
      const p = polar(a + (k === 0 ? 0 : rng.jitter(0.06)), bark(a, 0.2) + 0.8 + k * 0.62, 0);
      p.y = getHeight(p.x, p.z);
      const s = k === 0 ? 0.42 : rng.range(0.22, 0.3);
      const g = stoneGeo(rng, { r: s, sy: 0.3, lump: 0.15 });
      B.add(mats.stone(), xf(g, [p.x, p.y + s * 0.08, p.z], [0, rng.next() * TAU, 0]));
      if (k > 0) B.add(mats.moss(), xf(mossGeo(rng, { r: s * 0.6, h: 0.04 }), [p.x + rng.jitter(0.1), p.y + s * 0.18, p.z + rng.jitter(0.1)]), { cast: false });
    }
    // a lantern on a crooked stake, well out beside the stepping stones and
    // before the first tread (never inside the treads' volume)
    const sa = a + 12 * DEG;
    const sn = radial(sa);
    const sp = polar(sa, bark(sa, 0.2) + 1.9, 0);
    sp.y = floorAt(sp);
    if (!isFinite(sp.y)) sp.y = getHeight(sp.x, sp.z);
    const top = sp.clone().add(new THREE.Vector3(0.04, 1.1, 0.02));
    const hook = top.clone().addScaledVector(sn, 0.22).add(new THREE.Vector3(0, 0.03, 0));
    bough([sp.clone().add(new THREE.Vector3(0, -0.1, 0)), sp.clone().add(new THREE.Vector3(-0.03, 0.55, 0.02)), top, top.clone().addScaledVector(sn, 0.22).add(new THREE.Vector3(0, 0.06, 0))], 0.045, 0.025, { radial: 6, seed: 5 });
    B.add(mats.moss(), xf(mossGeo(rng, { r: 0.12, h: 0.05 }), [sp.x, sp.y + 0.01, sp.z]), { cast: false });
    const lantern = ctx.props.makeLantern({ hanging: true, color: '#ffc46b', halo: false });
    lantern.position.copy(hook);
    lantern.scale.setScalar(0.9);
    env.extraLights?.add(lantern);
    halos.push(hook.clone().add(new THREE.Vector3(0, -0.33, 0)), 0.8, '#ffc46e');
    // the replacement for the missing tread, fresh from the workshop, leaning
    // against the trunk beside the foot of the stair
    {
      const pa = first.a + 20 * DEG;
      const pn = radial(pa);
      const foot = polar(pa, bark(pa, 0.3) + 0.55, 0);
      foot.y = floorAt(foot);
      if (isFinite(foot.y)) {
        const head = polar(pa, bark(pa, 1.2) + 0.06, foot.y + 1.15);
        const g = weatherPaint(board(L * 0.98, 0.07, 0.28, { along: 'x', rng, segs: 3 }), NEW_WOOD[0], { lichen: 0 });
        const dir = head.clone().sub(foot).normalize();
        const yAx = pn.clone().negate().addScaledVector(dir, pn.dot(dir)).normalize(); // thickness: into the bark
        const mm = new THREE.Matrix4().makeBasis(dir, yAx, new THREE.Vector3().crossVectors(dir, yAx)).setPosition(foot.clone().lerp(head, 0.5).addScaledVector(pn, 0.04));
        B.add(mats.wood(NEW_WOOD[0]), g.applyMatrix4(mm));
      }
    }
    // toadstools & ferns at the foot
    const F = B.at(new THREE.Matrix4());
    for (let k = 0; k < 5; k++) {
      const p = polar(a + rng.jitter(0.25), bark(a, 0.2) + rng.range(0.6, 1.8), 0);
      p.y = Math.max(getHeight(p.x, p.z), rootTop(p.x, p.z));
      if (!isFinite(p.y)) p.y = 0;
      addToadstool(F, mats, rng, p.x, p.y, p.z, { size: rng.range(0.08, 0.16) });
    }
    // ivy creeping up the first brackets
    for (let k = 0; k < 6; k++) {
      const s0 = steps[k];
      const base = polar(s0.a, bark(s0.a, s0.y - 0.6) + 0.05, s0.y - 0.6);
      B.add(mats.ivy(), ivyCard(base, new THREE.Vector3(rng.jitter(0.3), 1, rng.jitter(0.3)), radial(s0.a), rng.range(0.4, 0.7), rng.next() < 0.5), { cast: false });
    }
  }

  return {
    steps,
    rise: (OAK.loft.y - STAIR.y0) / STAIR.treads,
    landing,
    bottom,
    top: polar(STAIR_WELL.a0 * DEG, bark(STAIR_WELL.a0 * DEG, OAK.loft.y) + 0.7, OAK.loft.y),
  };
}
