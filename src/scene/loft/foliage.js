// ─────────────────────────────────────────────────────────────────────────────
// Leafy boughs round the Code Loft, so the treehouse sits nestled in green
// (reference c0a98773) instead of on bare bark:
//
//   • a few leafy boughs grown out of the trunk right beside the treehouse —
//     peeking out behind its right gable, to the left of the deck, and
//     drooping under the deck's rim at both ends — each a crooked branch
//     forking into twigs that carry clumps of oak leaves
//   • leafy sprouts sitting on the lower limbs where they leave the trunk
//   • a few strands of vine hanging from those limbs
//
// The leaves take the crown's colours (olive, sage, warm golden-green tops)
// on the crown's leaf card, vertex coloured: one draw call for all of them.
// Everything keeps to the bark and the limbs: clear of the treehouse, the
// snail lift's track and its sign, the stair, the deck's planks, the oak's
// own windows, bird house and hollows — never between a spot camera and the
// loft. Its own random stream (the loft's one drives the deck's plank layout).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OAK } from '../../world/layout.js';
import { DEG, LOD, polar, branch, ivyCard, BARK } from './kit.js';
import { HOUSE } from './house.js';

const DECK_Y = OAK.loft.y;
/** the crown's leaf tones (oak/crown.js): olive mids, sage, warm golden-green tops, teal bellies */
const TONES = { belly: '#3f5a40', mid: '#667b4f', sage: '#5f7a5e', olive: '#7a7d48', top: '#a9a24a' };
/**
 * The boughs out of the trunk: [azimuth°, height above the deck, length,
 * sideways (+ = towards higher azimuth), up/down tilt, clumps].
 */
const BOUGHS = [
  [121, 2.3, 2.3, 0.75, 0.25, 9], // behind the treehouse's right gable
  [-27, 2.5, 2.0, -0.7, 0.3, 8], // left of the deck, over the server rack's corner of the bark
  [-12, -1.35, 1.7, -0.55, -0.35, 6], // under the deck's left end
  [124, -1.05, 1.6, 0.5, -0.4, 6], // under the deck's right end
];

export function buildFoliage(ctx, B, mats, env, { deck }) {
  const rng = ctx.rng('loft-foliage');
  const { bark } = env;
  const leaves = ctx.materials.foliage({ variant: 'oak', vertexColors: true });
  const vine = mats.ivy();
  const barkMat = mats.bark(BARK.default);
  const density = LOD.tier === 'low' ? 0.6 : LOD.tier === 'medium' ? 0.8 : 1;
  const up = new THREE.Vector3(0, 1, 0);
  const centre = new THREE.Vector3();
  const tone = new THREE.Color();
  const ridgeY = DECK_Y + HOUSE.EAVE + (HOUSE.W2 + 0.06) * Math.tan(HOUSE.PITCH) + 0.6;
  let cards = 0;
  /** over the treehouse (its azimuth span round the trunk, with a margin)? */
  const overHouse = (p) => {
    const az = Math.atan2(p.x - OAK.x, p.z - OAK.z) / DEG;
    return az > 55 && az < 112;
  };

  /**
   * A clump of oak-leaf cards round a twig tip (the crown's card is a rounded
   * clump radiating from its centre): three crossed cards, shaded as one soft
   * ball of leaves — warm tops, darker belly.
   */
  function clump(tip, out, size, lift = 0.5) {
    const n = 3;
    const spin = rng.next() * Math.PI;
    const axis = out.clone().addScaledVector(up, 0.35).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
    const top = rng.next() < lift ? TONES.top : TONES.olive;
    const base = rng.pick([TONES.mid, TONES.sage, TONES.mid]);
    for (let i = 0; i < n; i++) {
      const s = size * rng.range(0.82, 1.15);
      const g = new THREE.PlaneGeometry(s, s);
      const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (i % 2 ? 1 : -1) * rng.range(0.9, 1.35));
      const roll = new THREE.Quaternion().setFromAxisAngle(axis, spin + (i / n) * Math.PI);
      g.applyQuaternion(tilt).applyQuaternion(q).applyQuaternion(roll);
      g.translate(tip.x, tip.y, tip.z);
      // a vertical gradient through the clump: golden-green top, olive middle, teal belly
      const pos = g.attributes.position;
      const col = new Float32Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) {
        const h = THREE.MathUtils.clamp((pos.getY(v) - tip.y) / s + 0.5, 0, 1);
        tone.set(h > 0.5 ? base : TONES.belly).lerp(new THREE.Color(h > 0.5 ? top : base), h > 0.5 ? (h - 0.5) * 2 : h * 2);
        col.set([tone.r, tone.g, tone.b], v * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      ctx.materials.foliageNormals?.(g, centre.copy(tip).addScaledVector(out, -size * 0.25));
      B.add(leaves, g, { cast: false });
      cards++;
    }
  }

  /**
   * A leafy bough: a crooked branch out of the bark, sagging a little with its
   * weight, forking into two or three twigs; leaf clumps along its outer part
   * and at every twig's tip.
   */
  function bough(base, dir, len, nClumps, r0 = 0.09) {
    dir = dir.clone().normalize();
    const side = new THREE.Vector3().crossVectors(dir, up).normalize();
    const pts = [];
    const N = 5;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      pts.push(base.clone().addScaledVector(dir, len * t).addScaledVector(side, Math.sin(t * 3.1 + rng.next()) * 0.08 * t).add(new THREE.Vector3(0, -0.22 * len * t * t, 0)));
    }
    pts[0].addScaledVector(dir, -0.12); // (rooted in the bark)
    B.add(barkMat, branch(pts, r0, r0 * 0.3, { radial: 6, lump: 0.14, seed: rng.next() * 50 }), { cast: false });
    const curve = new THREE.CatmullRomCurve3(pts);
    const tips = [{ p: pts[N], d: dir }];
    // forks: twigs off the outer half, alternating sides
    const forks = rng.int(2, 3);
    for (let k = 0; k < forks; k++) {
      const t = 0.42 + (k / forks) * 0.42 + rng.jitter(0.05);
      const p = curve.getPointAt(t);
      const s = k % 2 ? -1 : 1;
      const d = dir.clone().addScaledVector(side, s * rng.range(0.7, 1.1)).addScaledVector(up, rng.range(0.1, 0.5)).normalize();
      const L = len * rng.range(0.32, 0.45);
      const e = p.clone().addScaledVector(d, L).add(new THREE.Vector3(0, -0.08 * L, 0));
      B.add(barkMat, branch([p, p.clone().lerp(e, 0.5).addScaledVector(up, 0.04), e], r0 * 0.45, r0 * 0.18, { radial: 5, lump: 0.1, seed: rng.next() * 50 }), { cast: false });
      tips.push({ p: e, d });
    }
    const n = Math.max(tips.length, Math.round(nClumps * density));
    for (let k = 0; k < n; k++) {
      if (k < tips.length) {
        clump(tips[k].p, tips[k].d, rng.range(0.85, 1.2), 0.6);
        continue;
      }
      // more clumps along the bough's outer part, a little off it
      const t = rng.range(0.4, 0.95);
      const p = curve.getPointAt(t).addScaledVector(side, rng.jitter(0.28)).add(new THREE.Vector3(0, rng.range(0.02, 0.22), 0));
      clump(p, dir.clone().addScaledVector(side, rng.jitter(0.8)).normalize(), rng.range(0.7, 1.0), 0.5);
    }
  }

  // ── leafy boughs out of the trunk beside the treehouse ────────────────────
  for (const [az, dy, len, sideways, tilt, n] of BOUGHS) {
    const a = az * DEG;
    const y = DECK_Y + dy;
    const out = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const lat = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const base = polar(a, bark(a, y) - 0.05, y);
    bough(base, out.clone().addScaledVector(lat, sideways).addScaledVector(up, tilt), len, n);
  }

  // ── leafy sprouts on the lower limbs, vines hanging from them ─────────────
  const limb = (id) => ctx.oak?.limbInfo?.find((l) => l.id === id);
  const LIMBS = [
    // [limb, u from, u to, sprouts, vines]
    ['front', 0.08, 0.34, 3, 2],
    ['front-right-high', 0.05, 0.2, 2, 0],
    ['right', 0.06, 0.4, 4, 3],
  ];
  const P = new THREE.Vector3(), T = new THREE.Vector3();
  for (const [id, u0, u1, nSprouts, nVines] of LIMBS) {
    const L = limb(id);
    if (!L) continue;
    for (let i = 0; i < Math.round(nSprouts * density); i++) {
      const u = THREE.MathUtils.lerp(u0, u1, (i + rng.range(0.2, 0.8)) / nSprouts);
      L.curve.getPointAt(u, P);
      L.curve.getTangentAt(u, T);
      const rr = L.radiusAt(u);
      const side = new THREE.Vector3().crossVectors(T, up).normalize().multiplyScalar(i % 2 ? 1 : -1);
      const out = up.clone().addScaledVector(side, rng.range(0.4, 0.9)).normalize();
      const base = P.clone().addScaledVector(out, rr * 0.85);
      if (overHouse(base) && base.y < ridgeY + 0.5) continue; // (never down on the treehouse's roof)
      bough(base, out.clone().addScaledVector(T, rng.jitter(0.5)), rng.range(0.7, 1.1), 3, 0.05);
    }
    // vines: a strand of ivy leaves hanging from the limb's underside, swaying a little out
    for (let i = 0; i < Math.round(nVines * density); i++) {
      const u = THREE.MathUtils.lerp(u0 + 0.04, u1 + 0.1, (i + rng.range(0.3, 0.7)) / nVines);
      L.curve.getPointAt(u, P);
      const rr = L.radiusAt(u);
      const top = P.clone().add(new THREE.Vector3(0, -rr * 0.9, 0));
      // how far it may hang: never into the treehouse, onto the deck or the stair
      const loc = deckLocal(deck, top);
      const floor = overHouse(top) ? ridgeY + 0.4 : deck.insideOutline(loc.x, loc.z, -0.8) ? DECK_Y + 2.6 : DECK_Y + 0.8;
      const len = Math.min(rng.range(1.6, 3.2), top.y - floor);
      if (len < 0.8) continue;
      const sway = new THREE.Vector3(rng.jitter(0.25), 0, rng.jitter(0.25));
      const n = Math.max(3, Math.round(len / 0.24));
      let prev = top.clone();
      for (let j = 1; j <= n; j++) {
        const t = j / n;
        const q = top.clone().add(new THREE.Vector3(sway.x * t * t, -len * t, sway.z * t * t));
        const facing = new THREE.Vector3(Math.sin(j * 2.1 + i), 0, Math.cos(j * 2.1 + i));
        B.add(vine, ivyCard(prev, q.clone().sub(prev), facing, 0.3 + 0.12 * (1 - t), j % 2 === 0), { cast: false });
        cards++;
        prev = q;
      }
    }
  }
  return { cards };
}

/** world → the deck's local frame (deck.at maps deck-local → world) */
function deckLocal(deck, p) {
  const o = deck.at(0, 0), x = deck.at(1, 0).sub(o), z = deck.at(0, 1).sub(o);
  const d = p.clone().sub(o);
  return { x: d.dot(x) / x.lengthSq(), z: d.dot(z) / z.lengthSq() };
}
