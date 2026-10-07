// ─────────────────────────────────────────────────────────────────────────────
// The winding stair of the Code Loft: plank treads cantilevered from the bark
// of the Great Oak on diagonal wooden brackets, spiralling up the trunk's
// right side from the ground at the back-right to the stairwell at the deck's
// front tip.
//
//   • every tread is its own plank (tone, twist, ragged end) on a bracket
//     pinned into the bark with an iron pin, a cleat under its inner end
//   • a rope handrail on crooked branch balusters along the outside, a second
//     rope through iron eyes along the bark
//   • half-way up, where the snail lift's track crosses, the stair rests on a
//     wider LANDING with a slot at the bark the snail passes through
//   • at the foot: a mossy stone step, stepping stones, a lantern on a stake
//
// Exposes the stair's path for others: stairY(azDeg) and STAIR.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OAK } from '../../world/layout.js';
import { getHeight } from '../../world/ground.js';
import { DEG, TAU, IRON, polar, radial, board, timber, branch, tubeAlong, xf, stoneGeo, mossGeo, addToadstool, ivyCard } from './kit.js';
import { ELEVATOR_AZ, STAIR_WELL, LIFT } from './deck.js';

/** The stair's course: azimuths in degrees around the oak (it climbs clockwise). */
export const STAIR = {
  bottomAz: 150, // first tread (back-right, at the ground)
  topAz: 2, // last tread, in the stairwell at the deck's front tip
  y0: 0.3,
  landing: { a0: ELEVATOR_AZ - 9, a1: ELEVATOR_AZ + 9 },
  treads: 40,
  inner: 0.03, // tread starts this far from the bark
  length: 1.28, // tread length (radial)
  depth: 0.3, // tread depth (tangential)
};

/** Steps: [{ a (rad), y, landing? }] from the bottom up (the deck is the step after the last). */
export function stairSteps() {
  const { bottomAz, topAz, y0, landing, treads } = STAIR;
  const rise = (OAK.loft.y - y0) / treads;
  const before = bottomAz - landing.a1; // degrees of flight below the landing
  const after = landing.a0 - topAz; // degrees of flight above it
  const k = Math.round((treads * before) / (before + after)); // index of the landing
  const steps = [];
  for (let i = 0; i < treads; i++) {
    const y = y0 + i * rise;
    if (i < k) steps.push({ a: (bottomAz - (i * before) / k - 1.6) * DEG, y });
    else if (i === k) steps.push({ a: ((landing.a0 + landing.a1) / 2) * DEG, y, landing: true });
    else steps.push({ a: (landing.a0 - 1.7 - ((i - k - 1) * (after - 1.7)) / (treads - k - 1)) * DEG, y });
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
  const { steps, rise, landingY } = stairSteps();
  const timberMat = mats.timber('#7a6450');
  const ironMat = mats.metal(IRON);
  const barkMat = mats.bark();
  const ropeMat = mats.rope();
  const tones = ['#8c7558', '#86735f', '#7d6a56', '#958068', '#8f8478', '#7a6450', '#6f604f'];
  const outerTops = []; // baluster tops (outer rope)
  const innerEyes = []; // iron eyes (inner rope)
  const L = STAIR.length;

  steps.forEach((s, i) => {
    const a = s.a;
    const n = radial(a);
    const t = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)); // tangent (towards +az)
    if (s.landing) return; // built below
    const r0 = bark(a, s.y) + STAIR.inner;
    const r1 = r0 + L + rng.jitter(0.05);
    // the tread: a thick plank, radial, a touch tilted and twisted
    const g = board(L + 0.04, 0.065, STAIR.depth - rng.range(0.0, 0.03), { along: 'x', rng, c: 0.012 });
    const m = new THREE.Matrix4().makeBasis(n, new THREE.Vector3(0, 1, 0), t.clone().negate());
    m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rng.jitter(0.02), rng.jitter(0.04), rng.jitter(0.012))));
    m.setPosition(polar(a, (r0 + r1) / 2, s.y - 0.0325));
    g.applyMatrix4(m);
    B.add(mats.wood(rng.pick(tones)), g);
    // the bracket: a diagonal strut from the bark up to under the tread, and a cleat
    const foot = polar(a, bark(a, s.y - 0.5) + 0.02, s.y - 0.5);
    const head = polar(a, r0 + L * 0.68, s.y - 0.08);
    B.add(timberMat, timber(foot, head, 0.06, 0.06, { rng, wobble: 0.004, up: [t.x, 0, t.z] }), { cast: false });
    B.add(timberMat, timber(polar(a, r0 - 0.02, s.y - 0.11), polar(a, r0 + 0.42, s.y - 0.11), 0.07, 0.08, { rng, wobble: 0.002 }), { cast: false });
    // iron pin through the cleat into the bark
    B.add(ironMat, xf(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 6), [0, 0, 0], [0, 0, Math.PI / 2]).applyMatrix4(new THREE.Matrix4().makeBasis(n, new THREE.Vector3(0, 1, 0), t.clone().negate()).setPosition(polar(a, r0 + 0.08, s.y - 0.11).addScaledVector(t, 0.045))), { cast: false });
    // balusters on every second tread, iron eyes on every third
    if (i % 2 === 0) {
      const b0 = polar(a, r1 - 0.06, s.y - 0.05);
      const top = b0.clone().add(new THREE.Vector3(rng.jitter(0.03), 0.72 + rng.jitter(0.04), rng.jitter(0.03)));
      B.add(barkMat, branch([b0, b0.clone().lerp(top, 0.5).add(new THREE.Vector3(rng.jitter(0.02), 0, rng.jitter(0.02))), top], 0.032, 0.026, { radial: 6, seed: i }), { cast: false });
      outerTops.push(top);
    }
    if (i % 3 === 1) {
      const e = polar(a, bark(a, s.y + 0.7) + 0.06, s.y + 0.7);
      B.add(ironMat, xf(new THREE.TorusGeometry(0.03, 0.008, 4, 8), [e.x, e.y, e.z], [0, a, 0]), { cast: false });
      innerEyes.push(e.clone().addScaledVector(n, 0.02));
    }
    // moss on some treads near the bark, a toadstool here and there
    if (rng.next() < 0.3) B.add(mats.moss(), xf(mossGeo(rng, { r: 0.1, h: 0.035, sx: 1.4 }), [0, 0, 0]).applyMatrix4(new THREE.Matrix4().makeBasis(n, new THREE.Vector3(0, 1, 0), t.clone().negate()).setPosition(polar(a, r0 + 0.12, s.y))), { cast: false });
  });

  // ── the landing where the snail lift passes (a slot at the bark) ─────────
  const landing = { y: landingY };
  {
    const { a0, a1 } = STAIR.landing;
    const ly = landingY;
    const rIn = (a) => bark(a, ly) + STAIR.inner;
    const W = LIFT.slotDepth + 0.78; // radial width
    // tangential planks on the outer part (beyond the slot)
    for (let k = 0; k < 3; k++) {
      const pts = [];
      const rr = LIFT.slotDepth + 0.1 + k * 0.22;
      for (let d = a0 - 1.5; d <= a1 + 1.5; d += 3) {
        const a = d * DEG;
        pts.push(polar(a, rIn(a) + rr, ly - 0.033));
      }
      for (let j = 0; j < pts.length - 1; j++) {
        const g = timber(pts[j], pts[j + 1], 0.22, 0.065, { rng, wobble: 0.004 });
        B.add(mats.wood(rng.pick(tones)), g);
      }
    }
    // radial planks at both ends (from the bark), where the flights arrive
    for (const d of [a0 + 1.2, a1 - 1.2]) {
      const a = d * DEG;
      const n = radial(a);
      const g = board(W + 0.02, 0.065, 0.24, { along: 'x', rng });
      g.applyMatrix4(new THREE.Matrix4().makeBasis(n, new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.cos(a), 0, Math.sin(a))).setPosition(polar(a, rIn(a) + W / 2, ly - 0.033)));
      B.add(mats.wood(rng.pick(tones)), g);
    }
    // two big knee brackets at the ends and a beam under the outer edge
    for (const d of [a0 + 2.5, a1 - 2.5]) {
      const a = d * DEG;
      const foot = polar(a, bark(a, ly - 1.5) + 0.03, ly - 1.5);
      const head = polar(a, rIn(a) + W - 0.25, ly - 0.12);
      B.add(timberMat, timber(foot, head, 0.11, 0.11, { rng, wobble: 0.01 }));
      B.add(timberMat, timber(polar(a, rIn(a) - 0.03, ly - 0.14), polar(a, rIn(a) + W - 0.1, ly - 0.14), 0.1, 0.13, { rng }));
    }
    {
      const pts = [];
      for (let d = a0 + 1; d <= a1 - 1; d += 4) pts.push(polar(d * DEG, rIn(d * DEG) + W - 0.2, ly - 0.14));
      for (let j = 0; j < pts.length - 1; j++) B.add(timberMat, timber(pts[j], pts[j + 1], 0.1, 0.13, { rng }));
    }
    // railing around the outer edge
    const tops = [];
    for (let d = a0 + 0.5; d <= a1 - 0.5; d += (a1 - a0 - 1) / 3) {
      const a = d * DEG;
      const b0 = polar(a, rIn(a) + W - 0.08, ly - 0.05);
      const top = b0.clone().add(new THREE.Vector3(0, 0.74, 0));
      B.add(barkMat, branch([b0, b0.clone().lerp(top, 0.5).add(new THREE.Vector3(rng.jitter(0.02), 0, rng.jitter(0.02))), top], 0.04, 0.032, { radial: 6, seed: d }), { cast: false });
      tops.push(top);
    }
    landing.tops = tops;
    landing.centre = polar(((a0 + a1) / 2) * DEG, rIn(((a0 + a1) / 2) * DEG) + 1.6, ly);
    // a little lantern hanging under the deck... no: on the landing's middle post
    halos.push(tops[1].clone().add(new THREE.Vector3(0, -0.15, 0)), 0.5, '#ffc46e');
    landing.lamp = tops[1].clone();
  }

  // ── rope handrails ────────────────────────────────────────────────────────
  {
    // outer: through the baluster tops, inserting the landing's posts in order
    const { a0, a1 } = STAIR.landing;
    const azOf = (p) => Math.atan2(p.x - OAK.x, p.z - OAK.z) / DEG;
    const pts = [...outerTops, ...landing.tops].sort((p, q) => azOf(q) - azOf(p));
    // a sagging rope between consecutive tops
    const ropePts = [];
    for (let j = 0; j < pts.length - 1; j++) {
      const p = pts[j], q = pts[j + 1];
      for (let k = 0; k < 4; k++) {
        const u = k / 4;
        const v = p.clone().lerp(q, u);
        v.y -= Math.sin(u * Math.PI) * 0.05;
        ropePts.push(v);
      }
    }
    ropePts.push(pts[pts.length - 1]);
    B.add(ropeMat, tubeAlong(ropePts, 0.02, 5, ropePts.length * 2), { cast: false });
    // small knots on the balusters
    for (const p of pts) B.add(ropeMat, xf(new THREE.SphereGeometry(0.03, 5, 4), [p.x, p.y, p.z]), { cast: false });
    // inner rope through the iron eyes along the bark
    const sorted = innerEyes.sort((p, q) => azOf(q) - azOf(p));
    for (const eyes of [sorted.filter((p) => azOf(p) > a1), sorted.filter((p) => azOf(p) < a0)]) {
      if (eyes.length < 2) continue;
      const rp = [];
      for (let j = 0; j < eyes.length - 1; j++) {
        const p = eyes[j], q = eyes[j + 1];
        for (let k = 0; k < 3; k++) {
          const u = k / 3;
          const v = p.clone().lerp(q, u);
          v.y -= Math.sin(u * Math.PI) * 0.06;
          // keep it off the bark
          const a = Math.atan2(v.x - OAK.x, v.z - OAK.z);
          const r = Math.hypot(v.x - OAK.x, v.z - OAK.z);
          const rb = bark(a, v.y) + 0.07;
          if (r < rb) v.set(OAK.x + Math.sin(a) * rb, v.y, OAK.z + Math.cos(a) * rb);
          rp.push(v);
        }
      }
      rp.push(eyes[eyes.length - 1]);
      B.add(ropeMat, tubeAlong(rp, 0.016, 4, rp.length * 2), { cast: false });
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
    // a lantern on a crooked stake
    const sp = polar(a + 9 * DEG, bark(a, 0.2) + 1.35, 0);
    sp.y = getHeight(sp.x, sp.z);
    const top = sp.clone().add(new THREE.Vector3(0.04, 1.1, 0.02));
    B.add(barkMat, branch([sp, sp.clone().add(new THREE.Vector3(-0.03, 0.55, 0.02)), top, top.clone().addScaledVector(n, 0.22).add(new THREE.Vector3(0, 0.06, 0))], 0.045, 0.025, { radial: 6, seed: 5 }));
    const lantern = ctx.props.makeLantern({ hanging: true, color: '#ffc46b', halo: false });
    const hook = top.clone().addScaledVector(n, 0.22).add(new THREE.Vector3(0, 0.03, 0));
    lantern.position.copy(hook);
    lantern.scale.setScalar(0.9);
    env.extraLights?.add(lantern);
    halos.push(hook.clone().add(new THREE.Vector3(0, -0.33, 0)), 0.8, '#ffc46e');
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
    rise,
    landing,
    bottom,
    top: polar(STAIR_WELL.a0 * DEG, bark(STAIR_WELL.a0 * DEG, OAK.loft.y) + 0.7, OAK.loft.y),
  };
}
