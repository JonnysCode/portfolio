// ─────────────────────────────────────────────────────────────────────────────
// The winding stair of the Code Loft: warm oak plank treads cantilevered from
// the bark of the Great Oak, spiralling up the trunk's right side from the
// ground at the back-right to the stairwell at the deck's front tip.
//
//   • every tread is its own plank (warm tone, twist, a dished walking line,
//     two oak pegs) on a short bearer let into the bark; its outer end rests
//     on a chock on a crooked BOUGH that spirals up under each flight — the
//     bough is carried by a few knee braces from the bark (rope-lashed) and,
//     near the ground, by branch posts. Every seventh tread a split half-log;
//     moss, trailing ivy and toadstools here and there. No grey timber, no
//     iron: from the workshop it must read as woodland joinery, never as a
//     fire escape (few, organic lines)
//   • a rope handrail on crooked branch balusters (every third tread),
//     little lanterns on three balusters and the landing post, fairy lights
//     spiralling up with the handrail
//   • shelf fungi on the bark beside some treads
//   • half-way up, where the snail lift's track crosses, the stair rests on a
//     wider LANDING with a slot at the bark the snail passes through
//   • at the foot: a mossy stone step, stepping stones, a lantern on a stake
//
// Exposes the stair's path for others: stairY(azDeg) and STAIR.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OAK } from '../../world/layout.js';
import { getHeight } from '../../world/ground.js';
import { DEG, TAU, BARK, WARM_WOOD, POLE_WOOD, polar, radial, board, timber, branch, tubeAlong, xf, deform, stoneGeo, mossGeo, addToadstool, ivyCard, shelfFungus, lashing } from './kit.js';
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
  // warm, weathered oak and sun-bleached branches (never grey timber & iron:
  // seen against the dark trunk from the workshop that read as a fire escape)
  const barkMat = mats.bark(BARK.warm);
  const ropeMat = mats.rope();
  /** a crooked peeled pole (warm honey wood with grain UVs) */
  const pole = (pts, r0, r1, opts = {}, bopts = {}) => B.add(mats.wood(rng.pick(POLE_WOOD)), branch(pts, r0, r1, { ...opts, uv: true }), bopts);
  const fungusSpots = []; // shelf fungi on the bark beside some brackets
  const outerTops = []; // baluster tops (outer rope)
  const flights = [[], []]; // the stringer bough's course under each flight (bottom → top)
  const L = STAIR.length;
  const TH = 0.075; // tread thickness
  const SR = 0.075; // stringer bough radius
  /** ground (or root) height under (x, z) */
  const floorAt = (p) => {
    const t = rootTop(p.x, p.z);
    return Math.max(getHeight(p.x, p.z), isFinite(t) ? t : -Infinity);
  };

  steps.forEach((s, i) => {
    const a = s.a;
    const n = radial(a);
    const t = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)); // tangent (towards +az)
    if (s.landing) return; // built below
    const flight = s.y < landingY ? 0 : 1;
    const r0 = bark(a, s.y) + STAIR.inner;
    const r1 = r0 + L + rng.jitter(0.05);
    const basis = new THREE.Matrix4().makeBasis(n, new THREE.Vector3(0, 1, 0), t.clone().negate());
    // the tread: a thick plank, radial, a touch tilted and twisted — every
    // seventh one a split half-log (a repair with whatever lay around)
    let g;
    if (i % 7 === 3) {
      g = new THREE.CylinderGeometry(STAIR.depth * 0.55, STAIR.depth * 0.55, L + 0.02, 9, 3, false, 0, Math.PI);
      // axis along X, the round side down, flattened: a split log
      g.rotateZ(Math.PI / 2).rotateX(Math.PI).scale(1, 0.42, 1);
      g.translate(0, 0.015, 0);
      B.add(barkMat, g.applyMatrix4(basis.clone().setPosition(polar(a, (r0 + r1) / 2, s.y - TH / 2))), { cast: false });
      // its flat, sawn top
      g = board(L + 0.02, 0.02, STAIR.depth * 1.08, { along: 'x', rng, c: 0.006 });
      g.translate(0, TH / 2 - 0.01, 0);
    } else {
      g = board(L + 0.04, TH, STAIR.depth - rng.range(0.0, 0.03), { along: 'x', rng, c: 0.014 });
      // worn: the middle of the walking line is dished a little
      deform(g, (v) => {
        if (v.y > 0) v.y -= 0.012 * Math.exp(-((v.x / L + 0.08) ** 2) * 9);
      });
    }
    const m = basis.clone();
    m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rng.jitter(0.02), rng.jitter(0.04), rng.jitter(0.012))));
    m.setPosition(polar(a, (r0 + r1) / 2, s.y - TH / 2));
    g.applyMatrix4(m);
    B.add(mats.wood(rng.pick(WARM_WOOD)), g);
    // two oak pegs through the tread into the stringer
    for (const k of [-1, 1]) {
      const pp = polar(a, r0 + L * 0.8, s.y + 0.002).addScaledVector(t, k * 0.06);
      B.add(mats.wood('#6b4a30'), xf(new THREE.CylinderGeometry(0.017, 0.017, 0.012, 6), [pp.x, pp.y, pp.z]), { cast: false });
    }
    // a short oak bearer under the inner end, let into the bark
    B.add(mats.wood('#8f6a44'), timber(polar(a, r0 - 0.06, s.y - TH - 0.04), polar(a, r0 + 0.32, s.y - TH - 0.04), 0.1, 0.08, { rng, wobble: 0.004 }), { cast: false });
    // the outer end rests on a bough that spirals up with the stair, on a chock
    const sp = polar(a, r0 + L * 0.8, s.y - TH - 0.13 - SR);
    flights[flight].push({ p: sp, a, y: s.y, i });
    const chock = polar(a, r0 + L * 0.8, s.y - TH - 0.075);
    B.add(mats.wood('#8f6a44'), xf(new THREE.BoxGeometry(0.13, 0.15, 0.12), [chock.x, chock.y, chock.z], [0, a, 0]), { cast: false });
    // shelf fungi and moss creep along some brackets
    if (i % 5 === 2) fungusSpots.push({ a, y: s.y - 0.3, t });
    // crooked branch balusters on every third tread, standing on the bough
    if (i % 3 === 0) {
      const b0 = polar(a, r1 - 0.1, s.y - 0.05);
      const top = b0.clone().add(new THREE.Vector3(rng.jitter(0.04), 0.74 + rng.jitter(0.05), rng.jitter(0.04)));
      pole([b0.clone().setY(s.y - TH - 0.12), b0.clone().lerp(top, 0.45).add(new THREE.Vector3(rng.jitter(0.03), 0, rng.jitter(0.03))), top], 0.042, 0.032, { radial: 6, seed: i }, { cast: false });
      outerTops.push(top);
    }
    // moss on some treads near the bark, a toadstool here and there
    if (rng.next() < 0.4) B.add(mats.moss(), xf(mossGeo(rng, { r: rng.range(0.08, 0.13), h: 0.035, sx: 1.4 }), [0, 0, 0]).applyMatrix4(basis.clone().setPosition(polar(a, r0 + 0.12, s.y - 0.005))), { cast: false });
    if (i % 6 === 1 && i > 6) addToadstool(B.at(new THREE.Matrix4()), mats, rng, ...polar(a + 0.03, r0 + 0.1, s.y).toArray(), { size: rng.range(0.05, 0.08) });
  });

  // ── the stringer boughs: one crooked branch under each flight, carried by a
  //    few knee braces from the bark (rope-lashed) or, near the ground, posts ─
  for (const fl of flights) {
    if (fl.length < 2) continue;
    // run a little past the first and last tread
    const ext = (p, q, d) => p.clone().addScaledVector(p.clone().sub(q).normalize(), d);
    const pts = [ext(fl[0].p, fl[1].p, 0.18), ...fl.map((f) => f.p), ext(fl[fl.length - 1].p, fl[fl.length - 2].p, 0.14)];
    // a natural bough: smooth, with a gentle wander
    const course = pts.map((p, k) => p.clone().add(new THREE.Vector3(0, Math.sin(k * 0.9) * 0.015, 0)));
    pole(course, SR, SR * 0.82, { radial: 7, seed: fl[0].i * 3 + 1, lump: 0.1 });
    // ivy spilling over the bough between the braces (softens the stack of
    // treads seen edge-on from the workshop)
    fl.forEach((f, k) => {
      if (k % 2 || rng.next() < 0.35) return;
      const strands = rng.int(1, 3);
      for (let j = 0; j < strands; j++) {
        const base = f.p.clone().addScaledVector(radial(f.a), rng.range(-0.05, 0.12)).add(new THREE.Vector3(0, SR * 0.4, 0));
        B.add(mats.ivy(), ivyCard(base, new THREE.Vector3(rng.jitter(0.3), -1, rng.jitter(0.3)), radial(f.a), rng.range(0.35, 0.8), rng.next() < 0.5), { cast: false });
      }
      if (rng.next() < 0.5) B.add(mats.moss(), xf(mossGeo(rng, { r: 0.1, h: 0.04, sx: 1.6 }), [f.p.x, f.p.y + SR * 0.75, f.p.z], [0, -f.a, 0]), { cast: false });
    });
    // knee braces (every 4th tread) or posts to the ground (low treads)
    fl.forEach((f, k) => {
      const low = f.y < 1.7;
      if (low ? k % 3 !== 1 : k % 4 !== 2) return;
      const head = f.p.clone();
      const dir = (k + 1 < fl.length ? fl[k + 1].p : f.p).clone().sub(k > 0 ? fl[k - 1].p : f.p).normalize();
      if (low) {
        const g0 = floorAt(head);
        if (!isFinite(g0) || head.y - g0 < 0.15) return;
        const foot = head.clone().setY(g0 - 0.1).addScaledVector(radial(f.a), rng.jitter(0.05));
        pole([foot, head.clone().lerp(foot, 0.5).add(new THREE.Vector3(rng.jitter(0.04), 0, rng.jitter(0.04))), head], 0.06, 0.05, { radial: 7, seed: f.i });
        B.add(mats.moss(), xf(mossGeo(rng, { r: 0.14, h: 0.05 }), [foot.x, g0 + 0.02, foot.z]), { cast: false });
      } else {
        const yF = f.y - 1.25;
        const foot = polar(f.a, bark(f.a, yF) - 0.02, yF);
        const mid = foot.clone().lerp(head, 0.5).addScaledVector(radial(f.a), -0.06).add(new THREE.Vector3(0, -0.05, 0));
        pole([foot, mid, head], 0.07, 0.05, { radial: 7, seed: f.i * 1.7 });
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
    // tangential planks on the outer part (beyond the slot)
    for (let k = 0; k < 3; k++) {
      const pts = [];
      const rr = LIFT.slotDepth + 0.1 + k * 0.22;
      for (let d = a0 - 1.5; d <= a1 + 1.5; d += 3) {
        const a = d * DEG;
        pts.push(polar(a, rIn(a) + rr, ly - 0.033));
      }
      for (let j = 0; j < pts.length - 1; j++) {
        const g = timber(pts[j], pts[j + 1], 0.22, 0.065, { rng, wobble: 0.004, scale: 1 / 1.4 });
        B.add(mats.wood(rng.pick(WARM_WOOD)), g);
      }
    }
    // radial planks at both ends (from the bark), where the flights arrive
    for (const d of [a0 + 1.2, a1 - 1.2]) {
      const a = d * DEG;
      const n = radial(a);
      const g = board(W + 0.02, 0.065, 0.24, { along: 'x', rng });
      g.applyMatrix4(new THREE.Matrix4().makeBasis(n, new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.cos(a), 0, Math.sin(a))).setPosition(polar(a, rIn(a) + W / 2, ly - 0.033)));
      B.add(mats.wood(rng.pick(WARM_WOOD)), g);
    }
    // two crooked knee braces at the ends (rope-lashed to the bearers) and a
    // bough under the outer edge
    for (const d of [a0 + 2.5, a1 - 2.5]) {
      const a = d * DEG;
      const foot = polar(a, bark(a, ly - 1.5) - 0.02, ly - 1.5);
      const head = polar(a, rIn(a) + W - 0.25, ly - 0.14);
      const mid = foot.clone().lerp(head, 0.5).addScaledVector(radial(a), -0.08).add(new THREE.Vector3(0, -0.06, 0));
      pole([foot, mid, head], 0.085, 0.06, { radial: 7, seed: d });
      B.add(mats.wood('#8f6a44'), timber(polar(a, rIn(a) - 0.03, ly - 0.14), polar(a, rIn(a) + W - 0.1, ly - 0.14), 0.1, 0.13, { rng }));
      for (const g of lashing(head, radial(a), 0.07, { turns: 3 })) B.add(ropeMat, g, { cast: false });
    }
    {
      const pts = [];
      for (let d = a0 + 1; d <= a1 - 1; d += 4) pts.push(polar(d * DEG, rIn(d * DEG) + W - 0.2, ly - 0.15));
      pole(pts, 0.07, 0.065, { radial: 7, seed: 91 });
    }
    // railing around the outer edge
    const tops = [];
    for (let d = a0 + 0.5; d <= a1 - 0.5; d += (a1 - a0 - 1) / 3) {
      const a = d * DEG;
      const b0 = polar(a, rIn(a) + W - 0.08, ly - 0.05);
      const top = b0.clone().add(new THREE.Vector3(0, 0.74, 0));
      pole([b0, b0.clone().lerp(top, 0.5).add(new THREE.Vector3(rng.jitter(0.02), 0, rng.jitter(0.02))), top], 0.045, 0.036, { radial: 6, seed: d }, { cast: false });
      tops.push(top);
    }
    landing.tops = tops;
    landing.centre = polar(((a0 + a1) / 2) * DEG, rIn(((a0 + a1) / 2) * DEG) + 1.6, ly);
    // moss along the landing's outer edge, a clump of ivy spilling over it
    for (let d = a0 + 2; d <= a1 - 2; d += 5) {
      const a = d * DEG;
      const p = polar(a, rIn(a) + W - 0.3, ly);
      B.add(mats.moss(), xf(mossGeo(rng, { r: 0.16, h: 0.05, sx: 1.5 }), [p.x, p.y, p.z], [0, -a, 0]), { cast: false });
      for (let j = 0; j < 2; j++) {
        const base = polar(a + rng.jitter(0.03), rIn(a) + W - 0.05, ly - 0.12);
        B.add(mats.ivy(), ivyCard(base, new THREE.Vector3(rng.jitter(0.2), -1, rng.jitter(0.2)), radial(a), rng.range(0.35, 0.7), rng.next() < 0.5), { cast: false });
      }
    }
    // a little lantern on the landing's middle post (added with the lights below)
    halos.push(tops[1].clone().add(new THREE.Vector3(0, 0.12, 0)), 0.7, '#ffc46e');
    landing.lamp = tops[1].clone();
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
        v.y -= Math.sin(u * Math.PI) * 0.05;
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
      l.position.copy(p).add(new THREE.Vector3(0, 0.01, 0));
      l.rotation.y = rng.next() * TAU;
      env.extraLights?.add(l);
      halos.push(p.clone().add(new THREE.Vector3(0, 0.12, 0)), 0.75, '#ffc46e');
    }
    // the landing's middle post carries one too
    if (landing.lamp) {
      const l = ctx.props.makeLantern({ color: '#ffc46b', halo: false });
      l.scale.setScalar(0.62);
      l.position.copy(landing.lamp).add(new THREE.Vector3(0, 0.01, 0));
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

  // ── shelf fungi on the bark beside some brackets ──────────────────────────
  {
    const fTop = mats.paint('#b06a34'), fUnder = mats.paint('#efe0c0');
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
        B.add(fTop, top.applyMatrix4(m), { color: rng.pick(['#b06a34', '#c47f45', '#9a5a2e', '#d2a060']), cast: false });
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
    // a lantern on a crooked stake
    const sp = polar(a + 9 * DEG, bark(a, 0.2) + 1.35, 0);
    sp.y = getHeight(sp.x, sp.z);
    const top = sp.clone().add(new THREE.Vector3(0.04, 1.1, 0.02));
    pole([sp, sp.clone().add(new THREE.Vector3(-0.03, 0.55, 0.02)), top, top.clone().addScaledVector(n, 0.22).add(new THREE.Vector3(0, 0.06, 0))], 0.045, 0.025, { radial: 6, seed: 5 });
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
