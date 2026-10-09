// ─────────────────────────────────────────────────────────────────────────────
// The crown's skeleton: the massive limbs from shape.js (hand-placed), and
// the procedural secondary branches and twigs that sprout from them. Every
// branch is an organic, twisting, tapering tube; all of them are merged with
// the other bark geometry by the caller. The skeleton also decides where the
// leaf clumps sit (at twig ends, along the outer branches), and offers hang
// points for lanterns, the swing and ivy curtains.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { LIMBS, DEG, polar, CX, CZ, crownBlocked } from './shape.js';
import { organicTube, smoothTable } from './tubes.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/**
 * Windows in the crown: stretches of these limbs (arc-length fractions) carry
 * no hanging leaf skirt, so from the glen the dark, kinked limbs show against
 * the lit foliage beyond instead of one undivided green mass.
 */
const CROWN_GAPS = {
  right: [[0.2, 0.62]],
  front: [[0.2, 0.66]],
  'front-right-high': [[0.25, 0.66]],
  'back-left': [[0.28, 0.56]],
  'back-right': [[0.3, 0.52]],
  'left-high': [[0.25, 0.55]],
  leader: [[0.3, 0.6]],
};
/**
 * The long low limb over the cottage path carries the lanterns, the ivy and
 * the moss curtains — its leaves sit HIGH (only at its branch tips, above
 * this height), so it reads as a great bare arm reaching over the glen
 * instead of a low hedge hanging over the cottages.
 */
const LOW_LIMB = 'front-left-low';
const LOW_LIMB_MIN_Y = 14.8;

/** A main limb's curve and radius (u = arc-length fraction). */
export function limbCurve(L) {
  const pts = L.pts.map(([rho, a, y]) => polar(a * DEG, rho, y));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const radii = L.pts.map((p) => p[3]);
  // knobbly elbows: a local swelling (in arc length) at the kinked control points
  const DIV = 240;
  const lens = curve.getLengths(DIV);
  const sAt = (tp) => {
    const f = Math.min(Math.max(tp, 0), 1) * DIV;
    const i = Math.min(Math.floor(f), DIV - 1);
    return lens[i] + (lens[i + 1] - lens[i]) * (f - i);
  };
  const elbows = [];
  L.pts.forEach((p, i) => {
    if (p[4]) elbows.push({ s: sAt(i / (L.pts.length - 1)), k: p[4], w: 0.5 + p[3] * 0.75 });
  });
  const radiusAtParam = (tp) => {
    let f = 1;
    if (elbows.length) {
      const s = sAt(tp);
      for (const e of elbows) {
        const d = (s - e.s) / e.w;
        f += e.k * Math.exp(-d * d);
      }
    }
    return smoothTable(radii, tp) * f;
  };
  const radiusAt = (u) => radiusAtParam(curve.getUtoTmapping(u));
  return { curve, radiusAt, radiusAtParam };
}

/** Any unit vector perpendicular to v, rotated by `roll` around v. */
function perpendicular(v, roll, out) {
  const ref = Math.abs(v.y) < 0.9 ? _w.set(0, 1, 0) : _w.set(1, 0, 0);
  const a = new THREE.Vector3().crossVectors(v, ref).normalize();
  const b = new THREE.Vector3().crossVectors(v, a).normalize();
  return out.copy(a).multiplyScalar(Math.cos(roll)).addScaledVector(b, Math.sin(roll));
}

/**
 * Build the limbs and their branches.
 * @returns {{ tubes: BufferGeometry[], limbs: Array, branches: Array, clumps: Array<{p:THREE.Vector3, s:number, tier:number}> }}
 */
export function buildLimbs(rng, { detail = 1 } = {}) {
  const tubes = [];
  const limbs = [];
  const branches = [];
  const clumps = [];

  let currentLimb = 0;
  let lowLimb = false;
  function addClump(p, s, tier) {
    if (p.y < 12.2) return;
    if (lowLimb) {
      // lifted & thinned: no hanging skirt, small high clumps at the twig tips
      if (tier === 3 || p.y < LOW_LIMB_MIN_Y) return;
      s *= 0.92;
    }
    if (crownBlocked(p, s * 0.85)) return;
    clumps.push({ p: p.clone(), s, tier, limb: currentLimb });
  }

  /** Grow `count` children from a parent branch. depth 1 = secondary, 2 = twig. */
  function grow(parent, count, depth) {
    const { curve, radiusAt } = parent;
    for (let k = 0; k < count; k++) {
      const u = THREE.MathUtils.lerp(depth === 1 ? 0.34 : 0.3, 0.94, (k + rng.range(0.15, 0.85)) / count);
      const P = curve.getPointAt(u);
      const T = curve.getTangentAt(u);
      const r = radiusAt(u);
      if (r < (depth === 1 ? 0.2 : 0.09)) continue;
      // outward direction from the trunk axis at this point
      const out = _v.set(P.x - CX, 0, P.z - CZ);
      if (out.lengthSq() < 1e-4) out.set(1, 0, 0);
      out.normalize();
      let best = null;
      for (let attempt = 0; attempt < 9; attempt++) {
        const roll = rng.range(0, Math.PI * 2);
        const D = perpendicular(T, roll, new THREE.Vector3());
        const bend = depth === 1 ? rng.range(0.55, 1.0) : rng.range(0.5, 1.1);
        D.multiplyScalar(Math.sin(bend)).addScaledVector(T, Math.cos(bend));
        D.y += depth === 1 ? 0.12 : 0.2;
        D.normalize();
        // branches reach out and up, never back into the trunk or steeply down
        const outward = D.x * out.x + D.z * out.z;
        if (outward < -0.15 || D.y < -0.35) continue;
        const len = depth === 1 ? rng.range(4.2, 7.6) * (1.12 - u * 0.35) : rng.range(1.7, 3.3);
        const pts = [P.clone().addScaledVector(D, -r * 0.45)];
        const side = perpendicular(D, rng.range(0, Math.PI * 2), new THREE.Vector3());
        const wig = depth === 1 ? 0.55 : 0.25;
        for (const f of [0.34, 0.68, 1]) {
          const q = P.clone().addScaledVector(D, len * f);
          q.addScaledVector(side, Math.sin(f * Math.PI * 1.4) * wig * rng.range(0.6, 1.2));
          // long branches sag a little then turn up at the tip — oak habit
          q.y += (f > 0.9 ? 0.45 : -0.25 * Math.sin(f * Math.PI)) * (depth === 1 ? 1 : 0.4);
          pts.push(q);
        }
        let blocked = false;
        for (let i = 1; i < pts.length; i++) if (crownBlocked(pts[i], depth === 1 ? 0.8 : 0.4) || pts[i].y < 11.5) blocked = true;
        if (blocked) continue;
        const score = outward * 0.6 + D.y * 0.4 + rng.next() * 0.5;
        if (!best || score > best.score) best = { pts, score, len };
        if (attempt >= 2 && best) break;
      }
      if (!best) continue;
      const bcurve = new THREE.CatmullRomCurve3(best.pts, false, 'centripetal');
      const r0 = Math.min(r * (depth === 1 ? 0.62 : 0.6), depth === 1 ? 0.6 : 0.2);
      const r1 = depth === 1 ? 0.07 : 0.03;
      const radiusAtB = (uu) => r0 + (r1 - r0) * Math.pow(uu, 0.85);
      const blen = bcurve.getLength();
      const radial = depth === 1 ? 10 : 6;
      tubes.push(
        organicTube({
          curve: bcurve,
          segments: Math.max(5, Math.ceil(blen / (depth === 1 ? 0.4 : 0.5))),
          radial: Math.max(5, Math.round(radial * detail)),
          size: (t, o) => {
            o.w = o.h = radiusAtB(t);
          },
          frame: 'transport',
          furrows: depth === 1 ? 0.1 : 0.04,
          furrowFreq: 2.6,
          twist: 0.35,
          lumps: 0.05,
          seed: rng.range(0, 50),
          uvScale: 0.7,
          capEnd: true,
        })
      );
      const child = { curve: bcurve, radiusAt: radiusAtB, depth, length: blen };
      branches.push(child);
      const tip = bcurve.getPointAt(1);
      if (depth === 1) {
        grow(child, rng.int(2, 4), 2);
        // (half the boughs carry a hanging skirt — the others leave windows
        //  under the crown where the limbs and the sky show through)
        if (rng.chance(0.72)) skirt(child, 0.4, 0.3, 0.85);
        addClump(tip.clone().add(new THREE.Vector3(0, 0.7, 0)), rng.range(2.3, 3.0), 1);
        // a fuller clump half-way out so the crown has body, not just a rim
        const mid = bcurve.getPointAt(0.62);
        addClump(mid.add(new THREE.Vector3(0, 1.3, 0)), rng.range(2.0, 2.6), 1);
      } else {
        addClump(tip.add(new THREE.Vector3(0, 0.55, 0)), rng.range(1.7, 2.5), 2);
      }
    }
  }

  /**
   * Leaf masses hanging along the outer part of a branch — the underside of
   * the crown is what most spot cameras look at, so it must be lush.
   * `gaps`: [[u0, u1], …] stretches left bare so the limb shows.
   */
  function skirt(b, from, step, scale, gaps = null) {
    const side = new THREE.Vector3();
    for (let u = from + rng.range(0, step * 0.5); u < 0.98; u += step * rng.range(0.8, 1.2)) {
      if (gaps && gaps.some(([u0, u1]) => u > u0 && u < u1)) continue;
      if (rng.chance(0.2)) continue; // a ragged, broken hem, not a hedge
      const P = b.curve.getPointAt(u);
      const T = b.curve.getTangentAt(u);
      side.set(-T.z, 0, T.x);
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
      side.normalize();
      P.addScaledVector(side, rng.range(-1, 1) * 0.9 * scale);
      P.y += rng.range(-1.0, 0.25) * scale;
      addClump(P, rng.range(1.7, 2.4) * scale, 3);
    }
  }

  LIMBS.forEach((L, li) => {
    currentLimb = li;
    lowLimb = L.id === LOW_LIMB;
    const { curve, radiusAt, radiusAtParam } = limbCurve(L);
    const len = curve.getLength();
    tubes.push(
      organicTube({
        curve,
        segments: Math.ceil(len / 0.3),
        radial: Math.max(10, Math.round(22 * detail)),
        size: (t, o, tp) => {
          o.w = o.h = radiusAtParam(tp);
        },
        frame: 'transport',
        furrows: 0.13,
        furrowFreq: 3.6,
        twist: 0.12,
        lumps: 0.1,
        seed: li * 3 + 7,
        uvScale: 0.55,
        capEnd: true,
      })
    );
    const limb = { id: L.id, curve, radiusAt, length: len, depth: 0 };
    limbs.push(limb);
    grow(limb, L.branches, 1);
    // the main limbs' skirts only hang from their outer halves: the inner
    // limbs stay bare and dark against the lit masses beyond (the skeleton)
    skirt(limb, 0.36, 0.1, 1, CROWN_GAPS[L.id]);
    const tip = curve.getPointAt(1);
    addClump(tip.add(new THREE.Vector3(0, 0.6, 0)), rng.range(2.6, 3.2), 0);
  });

  return { tubes, limbs, branches, clumps };
}
