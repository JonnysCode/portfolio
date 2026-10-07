// ─────────────────────────────────────────────────────────────────────────────
// The snail lift of the Code Loft: a riding snail with a little wicker basket
// crawls up and down a track on the bark of the Great Oak, between a boarding
// platform on the roots and the slot in the deck — up, rest (it turns round),
// down, rest. It passes through the slot in the stair landing on the way. A
// faint silvery slime trail glistens between the rails.
//
// Everything about the station is rustic woodland joinery in silvered,
// lichened old oak and bark-on branches (seen from the workshop it once read
// as a dark steel fire escape, then — in honey-orange planks on straight
// posts — as a painted one): the track is two crooked weathered poles
// rope-lashed to pegs in the bark with ivy twining up them (no rungs), the
// platform stands on crooked forked branch posts (no X-bracing, no milled
// posts) with a rope rail, and is reached by a short stair of chunky treads
// resting on two bark-on bough stringers propped on little posts (no ladder);
// a bell on a gallows, lanterns on the railing and half way up the track.
//
// The basket hangs from a brass hook on the saddle and always stays level,
// swinging gently when the snail starts and stops. Clicking the snail glides
// the camera to the Code Loft (the hotspot is wired in loft.js).
//
// Carrier frame: +Y out of the bark, +Z up the trunk (snail heading up).
// The snail turns about the axis through its shell (so the hook stays put).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OAK } from '../../world/layout.js';
import { getHeight } from '../../world/ground.js';
import { DEG, TAU, IRON, BRASS, OLD_OAK, OLD_POLE, BOUGH_BARK, DARK_OAK, LICHEN, addFlowerTuft, addToadstool, Batch, smallBitsRemap, polar, radial, board, timber, branch, tubeAlong, xf, stoneGeo, mossGeo, ivyCard, lashing, weatherPaint, lichenGeo, crookedPath, sagCurve } from './kit.js';
import { ELEVATOR_AZ, LIFT } from './deck.js';
import { addSignPlate } from './props.js';

const SCALE = LIFT.scale;
const ARM = LIFT.arm; // hook arm length out of the saddle
const HANG = 0.46; // hook → basket rim
const BASKET_H = 0.32;
const SPEED = 0.36; // units per second

export function buildElevator(ctx, B, mats, env, { updates }) {
  if (!ctx.props?.makeSnail) return null;
  const { bark, rng, rootTop, root, reduced } = env;
  const a = ELEVATOR_AZ * DEG;
  const n = radial(a);
  const lat = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
  const up = new THREE.Vector3(0, 1, 0);

  // ── the snail on its carrier ──────────────────────────────────────────────
  const snail = ctx.props.makeSnail({ seed: 'loft-lift', shellColor: '#d9673b', stripe: '#fff3d6', blanket: '#3f6f8f', scale: SCALE });
  const carrier = new THREE.Group();
  carrier.name = 'loft-snail-lift';
  const pivot = new THREE.Group(); // at the shell, rotates about the bark normal (local Y)
  carrier.add(pivot);
  // carrier basis: X = lateral, Y = out of the bark, Z = up the trunk
  carrier.matrixAutoUpdate = false;
  // where is the saddle (seat) in the snail's own frame? (Y = out, Z = forward)
  snail.group.updateMatrixWorld(true);
  const seat = new THREE.Vector3();
  snail.seat.getWorldPosition(seat); // snail group sits at the origin here
  const shellZ = seat.z;
  pivot.position.set(0, 0, shellZ);
  snail.group.position.set(0, 0, -shellZ);
  pivot.add(snail.group);
  // the brass hook arm out of the saddle, along the pivot axis (stays put when turning)
  {
    const HB = new Batch();
    HB.add(mats.metal(BRASS), xf(new THREE.CylinderGeometry(0.018, 0.022, ARM, 6), [seat.x, seat.y + ARM / 2, 0]), { cast: false });
    HB.add(mats.metal(BRASS), xf(new THREE.TorusGeometry(0.04, 0.01, 4, 10, Math.PI * 1.3), [seat.x, seat.y + ARM + 0.01, 0.0], [0, Math.PI / 2, -0.3]), { cast: false });
    HB.add(mats.metal(BRASS), xf(new THREE.SphereGeometry(0.035, 8, 6), [seat.x, seat.y, 0]), { cast: false });
    HB.build(pivot, 'lift-hook', { mergeShadow: true, remap: smallBitsRemap(mats) });
  }
  const hookLocal = new THREE.Vector3(seat.x, seat.y + ARM, 0); // in the pivot frame (pivot sits at z = shellZ)
  root.add(carrier);

  // ── the basket: wicker tub, rim, cushion, ropes to a hoop, a tiny lantern ─
  const basket = new THREE.Group();
  basket.name = 'lift-basket';
  {
    const BB = new Batch();
    const R = LIFT.basketR;
    const wick = mats.paint('#b8894f');
    const tub = new THREE.CylinderGeometry(R, R * 0.86, BASKET_H, 20, 6, true);
    // woven look: alternate darker / lighter bands, a little bulge
    const pos = tub.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c1 = new THREE.Color('#c39457'), c2 = new THREE.Color('#9a6c3a'), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), ang = Math.atan2(pos.getX(i), pos.getZ(i));
      const band = Math.floor((y + BASKET_H / 2) / (BASKET_H / 6));
      const weave = (Math.floor(((ang + Math.PI) / TAU) * 20) + band) % 2;
      c.copy(weave ? c1 : c2);
      col.set([c.r, c.g, c.b], i * 3);
      const k = 1 + Math.sin(((y + BASKET_H / 2) / BASKET_H) * Math.PI) * 0.06;
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    tub.setAttribute('color', new THREE.BufferAttribute(col, 3));
    tub.computeVertexNormals();
    xf(tub, [0, -HANG - BASKET_H / 2, 0]);
    BB.add(wick, tub);
    const inner = new THREE.CylinderGeometry(R - 0.02, R * 0.86 - 0.02, BASKET_H - 0.02, 16, 1, true);
    flip(inner);
    BB.add(mats.paint('#7a5530'), xf(inner, [0, -HANG - BASKET_H / 2, 0]), { cast: false });
    BB.add(mats.paint('#7a5530'), xf(new THREE.CircleGeometry(R * 0.86, 16).rotateX(-Math.PI / 2), [0, -HANG - BASKET_H + 0.02, 0]), { cast: false });
    BB.add(mats.paint('#c9a066'), xf(new THREE.TorusGeometry(R + 0.01, 0.025, 5, 22).rotateX(Math.PI / 2), [0, -HANG, 0]));
    BB.add(mats.fabric('#a8402a'), xf(new THREE.CylinderGeometry(R * 0.7, R * 0.72, 0.05, 14), [0, -HANG - BASKET_H + 0.05, 0]), { cast: false });
    // four ropes up to a small hoop under the hook
    const hoopY = -0.06;
    BB.add(mats.metal(BRASS), xf(new THREE.TorusGeometry(0.05, 0.01, 4, 10).rotateX(Math.PI / 2), [0, hoopY, 0]), { cast: false });
    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * TAU + 0.4;
      const p0 = new THREE.Vector3(Math.cos(ang) * 0.04, hoopY, Math.sin(ang) * 0.04);
      const p1 = new THREE.Vector3(Math.cos(ang) * R, -HANG + 0.01, Math.sin(ang) * R);
      BB.add(mats.paint('#9a8460'), tubeAlong([p0, p0.clone().lerp(p1, 0.5), p1], 0.01, 4, 4), { cast: false });
    }
    BB.add(mats.paint('#9a8460'), tubeAlong([new THREE.Vector3(0, 0.0, 0), new THREE.Vector3(0, hoopY, 0)], 0.012, 4, 2), { cast: false });
    // a tiny lantern hanging on the rim, a little pennant
    BB.add(mats.warmBright(), xf(new THREE.SphereGeometry(0.035, 8, 6), [R + 0.03, -HANG - 0.09, 0], null, [1, 1.3, 1]), { cast: false });
    BB.add(mats.metal(IRON), xf(new THREE.ConeGeometry(0.045, 0.04, 6), [R + 0.03, -HANG - 0.035, 0]), { cast: false });
    const flag = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0.16, -0.05, 0)]);
    flag.computeVertexNormals();
    BB.add(mats.paint('#e2553f'), xf(flag, [-R, -HANG + 0.22, 0]), { cast: false });
    BB.add(mats.paint('#e2553f'), xf(flag.clone().rotateY(Math.PI), [-R, -HANG + 0.22, 0]), { cast: false });
    BB.add(mats.paint('#6b4a30'), xf(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 4), [-R, -HANG + 0.12, 0]), { cast: false });
    BB.build(basket, 'lift-basket', { mergeShadow: true, remap: smallBitsRemap(mats) });
  }
  // the basket rides in the carrier (so a click on it counts as a click on
  // the lift hotspot) but its matrix is solved every frame to hang level
  basket.matrixAutoUpdate = false;
  carrier.add(basket);

  // ── stations ──────────────────────────────────────────────────────────────
  // top: basket floor level with the deck; bottom: on a boarding platform on the roots
  const basketR = (y) => bark(a, y) + seat.y + ARM; // hook distance from the axis
  const floorToHook = HANG + BASKET_H - 0.02;
  const topHookY = OAK.loft.y + 0.03 + floorToHook;
  // the bottom station must keep the whole snail (it turns round there) clear
  // of the buttress roots that swell up the bark at the trunk's foot
  carrier.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(snail.group);
  const reach = Math.max(shellZ - box.min.z, box.max.z - shellZ) * 0.92;
  let rootClear = 0;
  for (let da = -6; da <= 6; da += 3) {
    for (let dr = 0.05; dr <= 0.75; dr += 0.1) {
      const aa = a + da * DEG;
      for (const yy of [2, 3, 4]) {
        const p = polar(aa, bark(aa, yy) + dr, 0);
        const t = rootTop(p.x, p.z);
        if (isFinite(t)) rootClear = Math.max(rootClear, t);
      }
    }
  }
  let platY = Math.max(0.25, rootClear + 0.08 + reach - floorToHook - 0.03);
  {
    // …and the basket's own floor above the root under it
    for (let k = 0; k < 6; k++) {
      const p = polar(a + ((k % 3) - 1) * 0.05, basketR(platY) + (k < 3 ? -0.2 : 0.2), 0);
      const t = rootTop(p.x, p.z);
      if (isFinite(t)) platY = Math.max(platY, t + 0.08);
    }
  }
  const bottomHookY = platY + 0.03 + floorToHook;

  // boarding platform: warm planks on crooked branch posts, a short stair of
  // chunky treads up from the moss (rustic woodland joinery — no ladder, no
  // X-bracing)
  const ropeMat = mats.rope();
  /** a crooked weathered peeled pole (grain UVs) — the track rails */
  const pole = (pts, r0, r1, opts = {}, bopts = {}) => B.add(mats.wood(rng.pick(OLD_POLE)), branch(pts, r0, r1, { ...opts, uv: true }), bopts);
  /** a crooked bark-on branch (posts, stringers, rails, stakes) */
  const bough = (pts, r0, r1, opts = {}, bopts = {}) => B.add(mats.bark(rng.pick(BOUGH_BARK)), branch(pts, r0, r1, { lump: 0.18, ...opts }), bopts);
  /** a pale lichen rosette on a surface */
  const lichen = (p, nrm, r = 0.035) => {
    const g = lichenGeo(rng, r * rng.range(0.7, 1.3));
    g.applyMatrix4(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(up, nrm.clone().normalize()), new THREE.Vector3(1, 1, 1)));
    B.add(mats.paint(), g, { color: rng.pick(LICHEN), cast: false });
  };
  /** ground (or root) height under (x, z) */
  const floorAt = (p) => {
    const t = rootTop(p.x, p.z);
    return Math.max(getHeight(p.x, p.z), isFinite(t) ? t : -Infinity);
  };
  {
    const yP = platY;
    const r0 = bark(a, yP) + 0.15;
    const W = 0.95, Dp = 2.1;
    // silvered oak planks, lichen on their outer ends
    for (let k = 0; k < 4; k++) {
      const off = (k - 1.5) * 0.24;
      const p0 = polar(a, r0, yP - 0.03).addScaledVector(lat, off);
      const p1 = polar(a, r0 + Dp, yP - 0.03).addScaledVector(lat, off).addScaledVector(n, rng.jitter(0.06));
      // leave a gap for the basket near the bark
      const g0 = p0.clone().lerp(p1, 0.52);
      B.add(mats.wood(rng.pick(OLD_OAK)), timber(g0, p1, 0.22, 0.06, { rng, wobble: 0.004, scale: 1 / 1.4 }));
      if (rng.next() < 0.75) lichen(g0.clone().lerp(p1, rng.range(0.6, 0.95)).add(new THREE.Vector3(0, 0.031, 0)).addScaledVector(lat, rng.jitter(0.06)), up, 0.032);
    }
    const railTops = {};
    for (const s of [-1, 1]) {
      const p0 = polar(a, r0, yP - 0.1).addScaledVector(lat, s * W / 2);
      const p1 = polar(a, r0 + Dp, yP - 0.1).addScaledVector(lat, s * W / 2);
      B.add(mats.wood(DARK_OAK), timber(p0.clone().lerp(p1, 0.42), p1, 0.09, 0.1, { rng }));
      // crooked, forked bark-on posts down to the roots / ground: the bearer
      // sits in the crotch, rope-lashed (no milled posts, no bracing)
      for (const u of [0.55, 0.97]) {
        const top = p0.clone().lerp(p1, u);
        const g = floorAt(top);
        if (top.y - g > 0.08) {
          const crotch = top.clone().add(new THREE.Vector3(0, -0.1, 0));
          const foot = top.clone().setY(g - 0.1).addScaledVector(lat, s * rng.range(0.05, 0.14)).addScaledVector(n, rng.jitter(0.08));
          bough(crookedPath(foot, crotch, rng, { bend: 0.06, n: 4 }), 0.09, 0.07, { radial: 7, seed: u * 3 + s });
          for (const q of [-1, 1]) {
            const tip = top.clone().addScaledVector(lat, q * 0.078).add(new THREE.Vector3(0, 0.01, 0));
            bough([crotch.clone().add(new THREE.Vector3(0, -0.03, 0)), crotch.clone().lerp(tip, 0.5).addScaledVector(lat, q * 0.025), tip], 0.042, 0.026, { radial: 5, seed: u * 7 + s + q }, { cast: false });
          }
          for (const lg of lashing(top.clone().add(new THREE.Vector3(0, -0.02, 0)), new THREE.Vector3(0, 1, 0), 0.07, { turns: 2 })) B.add(ropeMat, lg, { cast: false });
          B.add(mats.moss(), xf(mossGeo(rng, { r: 0.18, h: 0.07 }), [foot.x, g + 0.02, foot.z]), { cast: false });
          // ivy climbing the post, lichen on its bark
          for (let j = 0; j < 2; j++) {
            const base = foot.clone().lerp(crotch, rng.range(0.05, 0.45)).addScaledVector(lat, s * 0.07);
            B.add(mats.ivy(), ivyCard(base, new THREE.Vector3(rng.jitter(0.3), 1, rng.jitter(0.3)), lat.clone().multiplyScalar(s), rng.range(0.35, 0.6), rng.next() < 0.5), { cast: false });
          }
          lichen(foot.clone().lerp(crotch, rng.range(0.5, 0.8)).addScaledVector(n, 0.085), n, 0.03);
        }
      }
      // a rope rail on two crooked bark-on posts along each side (one rope:
      // no extra rail lines)
      const rp = [];
      for (const u of [0.5, 1.0]) {
        const b = p0.clone().lerp(p1, u).add(new THREE.Vector3(0, -0.05, 0));
        const t = b.clone().add(new THREE.Vector3(rng.jitter(0.04), 0.74 + rng.jitter(0.05), rng.jitter(0.04))).addScaledVector(lat, s * 0.03);
        bough(crookedPath(b, t, rng, { bend: 0.06, n: 3 }), 0.044, 0.033, { radial: 6, seed: s * 3 + u * 5 }, { cast: false });
        B.add(mats.moss(), xf(mossGeo(rng, { r: 0.045, h: 0.025 }), [t.x, t.y, t.z]), { cast: false });
        rp.push(t);
      }
      railTops[s] = rp;
      const ra = rp[0].clone().add(new THREE.Vector3(0, -0.06, 0)), rb = rp[1].clone().add(new THREE.Vector3(0, -0.06, 0));
      B.add(ropeMat, tubeAlong(sagCurve(ra, rb, 0.07, 10), 0.018, 5), { cast: false });
      for (const q of [ra, rb]) B.add(ropeMat, xf(new THREE.SphereGeometry(0.03, 5, 4), [q.x, q.y, q.z]), { cast: false });
      // ivy trailing from the side bearer
      for (let j = 0; j < 3; j++) {
        const base = p0.clone().lerp(p1, rng.range(0.5, 0.95)).addScaledVector(lat, s * 0.05);
        B.add(mats.ivy(), ivyCard(base, new THREE.Vector3(rng.jitter(0.2), -1, rng.jitter(0.2)), lat.clone().multiplyScalar(s), rng.range(0.3, 0.55), rng.next() < 0.5), { cast: false });
      }
    }
    // a short rustic stair winding down from the platform's outer edge:
    // chunky silvered treads resting on two crooked bark-on bough stringers
    // (it curves gently back around the root, never a straight ladder), the
    // stringers propped on short forked posts, ivy on them, a lantern on a
    // stake beyond the foot and toadstools beside it
    {
      const UP = up;
      const topC = polar(a, r0 + Dp - 0.06, yP - 0.06);
      const run = THREE.MathUtils.clamp(yP * 0.85, 0.8, 2.7);
      const footC = polar(a + 0.05, r0 + Dp + run, 0).addScaledVector(lat, 0.45);
      footC.y = floorAt(footC);
      const rise = topC.y - footC.y;
      if (rise > 0.25) {
        const midC = topC.clone().lerp(footC, 0.5).addScaledVector(lat, 0.32).add(new THREE.Vector3(0, -0.06, 0));
        const curve = new THREE.CatmullRomCurve3([topC, midC, footC]);
        const H = 0.38; // half width (stringer centres)
        const TT = 0.09; // tread thickness
        const SS = 0.08; // stringer radius
        /** point & horizontal across-direction on the centre line at u (0 = top, 1 = foot) */
        const frame = (u) => {
          const p = curve.getPointAt(u);
          const tg = curve.getTangentAt(u).setY(0).normalize();
          return { p, across: new THREE.Vector3().crossVectors(tg, UP).normalize() };
        };
        // the treads (top of each at c + 0.1 + TT / 2)
        const nT = Math.max(2, Math.round(rise / 0.3));
        const treads = [];
        for (let k = 1; k <= nT; k++) {
          const u = 1 - k / (nT + 0.6);
          const { p: c, across } = frame(u);
          const tone = rng.pick(OLD_OAK);
          const g = weatherPaint(board(2 * H + 0.16, TT, 0.34, { along: 'x', rng, c: 0.02, segs: 4 }), tone, { mossEnd: k % 2 ? 1 : -1, seed: 50 + k });
          const m = new THREE.Matrix4().makeBasis(across, UP, across.clone().cross(UP));
          m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rng.jitter(0.03), rng.jitter(0.06), rng.jitter(0.02))));
          m.setPosition(c.clone().add(new THREE.Vector3(0, 0.1, 0)));
          B.add(mats.wood(tone), g.applyMatrix4(m));
          if (rng.next() < 0.5) {
            const mp = c.clone().addScaledVector(across, rng.jitter(0.25)).add(new THREE.Vector3(0, 0.1 + TT / 2, 0));
            B.add(mats.moss(), xf(mossGeo(rng, { r: 0.09, h: 0.03, sx: 1.5 }), [mp.x, mp.y, mp.z], [0, rng.next() * TAU, 0]), { cast: false });
          }
          treads.push({ u, k, y: c.y + 0.1 - TT / 2 });
        }
        treads.sort((p, q) => p.u - q.u); // top → foot
        for (const s of [-1, 1]) {
          // the stringer runs right under the treads' ends (they rest on it),
          // from the platform's bearer down into the moss
          const at = (u, y) => {
            const { p, across } = frame(u);
            return p.addScaledVector(across, s * H).setY(y);
          };
          const pts = [at(0, yP - 0.12)];
          for (const t of treads) pts.push(at(t.u, t.y - SS * 0.8));
          const fp = at(1, 0);
          fp.y = Math.min(floorAt(fp) - 0.06, pts[pts.length - 1].y - 0.1);
          pts.push(fp);
          bough(pts, SS * 1.05, SS * 0.85, { radial: 7, seed: 70 + s });
          B.add(mats.moss(), xf(mossGeo(rng, { r: 0.15, h: 0.05 }), [fp.x, floorAt(fp) + 0.02, fp.z]), { cast: false });
          // short forked posts under the stringer every third tread, where it
          // stands clear of the root (so no tread end is left floating)
          for (const t of treads) {
            if (t.k % 3 !== 2) continue;
            const q = at(t.u, t.y - SS * 0.8);
            const g0 = floorAt(q);
            if (!isFinite(g0) || q.y - SS - g0 < 0.16) continue;
            const crotch = q.clone().add(new THREE.Vector3(0, -SS - 0.05, 0));
            const foot = q.clone().setY(g0 - 0.08).addScaledVector(frame(t.u).across, s * 0.05);
            bough(crookedPath(foot, crotch, rng, { bend: 0.05, n: 3 }), 0.055, 0.047, { radial: 6, seed: 77 + t.k + s });
            for (const w of [-1, 1]) bough([crotch, crotch.clone().addScaledVector(frame(t.u).across, w * 0.06).add(new THREE.Vector3(0, 0.08, 0)), q.clone().addScaledVector(frame(t.u).across, w * (SS + 0.02))], 0.032, 0.02, { radial: 5, seed: 79 + t.k + w }, { cast: false });
            B.add(mats.moss(), xf(mossGeo(rng, { r: 0.12, h: 0.05 }), [foot.x, g0 + 0.02, foot.z]), { cast: false });
          }
          // ivy creeping up the stringer
          for (let k = 2; k < pts.length - 1; k += 2) {
            B.add(mats.ivy(), ivyCard(pts[k].clone().add(new THREE.Vector3(0, -0.04, 0)), new THREE.Vector3(rng.jitter(0.4), -1, rng.jitter(0.4)), frame(treads[k - 1]?.u ?? 1).across.multiplyScalar(s), rng.range(0.3, 0.55), rng.next() < 0.5), { cast: false });
          }
        }
        const { p: fp, across: fa } = frame(1);
        addToadstool(B.at(new THREE.Matrix4()), mats, rng, ...footC.clone().addScaledVector(fa, -H - 0.2).add(new THREE.Vector3(0, -0.02, 0)).toArray(), { size: 0.12 });
        addToadstool(B.at(new THREE.Matrix4()), mats, rng, ...footC.clone().addScaledVector(fa, -H - 0.32).addScaledVector(n, 0.15).toArray(), { size: 0.08 });
        // a lantern on a crooked stake beyond the foot of the steps, its arm
        // reaching away from them (never inside the treads' volume)
        const out = curve.getTangentAt(1).setY(0).normalize();
        const sp = fp.clone().addScaledVector(out, 0.5).addScaledVector(fa, H + 0.2);
        sp.y = floorAt(sp);
        if (isFinite(sp.y)) {
          const top = sp.clone().add(new THREE.Vector3(0.03, 1.0, -0.02));
          const hook = top.clone().addScaledVector(out, 0.22).add(new THREE.Vector3(0, 0.04, 0));
          bough([sp.clone().add(new THREE.Vector3(0, -0.1, 0)), sp.clone().add(new THREE.Vector3(-0.03, 0.5, 0.02)), top, hook], 0.04, 0.024, { radial: 6, seed: 74 });
          const l = ctx.props.makeLantern({ hanging: true, color: '#ffc46b', halo: false });
          l.scale.setScalar(0.75);
          l.position.copy(hook).add(new THREE.Vector3(0, -0.01, 0));
          env.extraLights?.add(l);
          env.halos.push(hook.clone().add(new THREE.Vector3(0, -0.26, 0)), 0.7, '#ffc46e');
          B.add(mats.moss(), xf(mossGeo(rng, { r: 0.13, h: 0.05 }), [sp.x, sp.y + 0.01, sp.z]), { cast: false });
        }
      }
    }
    // a bell on a little gallows to call the snail
    {
      const bp = polar(a, r0 + Dp - 0.1, yP).addScaledVector(lat, 0.56);
      const top = bp.clone().add(new THREE.Vector3(0, 1.05, 0));
      bough([bp.clone().add(new THREE.Vector3(0, -0.1, 0)), bp.clone().add(new THREE.Vector3(0.03, 0.5, -0.02)), top], 0.042, 0.032, { radial: 6, seed: 61 });
      const armEnd = top.clone().addScaledVector(lat, -0.25);
      bough([top, top.clone().addScaledVector(lat, -0.12).add(new THREE.Vector3(0, 0.03, 0)), armEnd], 0.028, 0.022, { radial: 5, seed: 62 }, { cast: false });
      B.add(mats.moss(), xf(mossGeo(rng, { r: 0.045, h: 0.025 }), [top.x, top.y + 0.01, top.z]), { cast: false });
      B.add(mats.metal(BRASS), xf(new THREE.CylinderGeometry(0.03, 0.065, 0.1, 10, 1, true), [armEnd.x, armEnd.y - 0.1, armEnd.z]));
      B.add(mats.metal(BRASS), xf(new THREE.SphereGeometry(0.02, 6, 4), [armEnd.x, armEnd.y - 0.16, armEnd.z]), { cast: false });
      B.add(ropeMat, tubeAlong([armEnd.clone().add(new THREE.Vector3(0, -0.15, 0)), armEnd.clone().add(new THREE.Vector3(0.03, -0.45, 0)), armEnd.clone().add(new THREE.Vector3(0.02, -0.7, 0.02))], 0.008, 4), { cast: false });
      // the station's name plate on the gallows post, facing out of the tree
      if (env.boards) {
        const c = bp.clone().add(new THREE.Vector3(0, 0.62, 0)).addScaledVector(n, 0.06);
        addSignPlate(B, mats, rng, env.boards, new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationZ(-0.04)).setPosition(c), 0.5);
      }
    }
    // a lantern on the outer railing post, moss and a pot of flowers on the boards
    {
      const lp = railTops[-1][1].clone().add(new THREE.Vector3(0, 0.02, 0));
      const l = ctx.props.makeLantern({ color: '#ffc46b', halo: false });
      l.scale.setScalar(0.6);
      l.position.copy(lp);
      env.extraLights?.add(l);
      env.halos.push(lp.clone().add(new THREE.Vector3(0, 0.12, 0)), 0.7, '#ffc46e');
      const mp = polar(a, r0 + Dp - 0.3, yP + 0.005).addScaledVector(lat, -0.3);
      B.add(mats.moss(), xf(mossGeo(rng, { r: 0.2, h: 0.05, sx: 1.4 }), [mp.x, mp.y, mp.z]), { cast: false });
      const pp = polar(a, r0 + Dp - 0.22, yP).addScaledVector(lat, 0.3);
      B.add(mats.clay('#b5633e'), xf(new THREE.CylinderGeometry(0.09, 0.07, 0.13, 10), [pp.x, pp.y + 0.065, pp.z]));
      addFlowerTuft(B.at(new THREE.Matrix4()), mats, rng, pp.x, pp.y + 0.12, pp.z, { r: 0.07, h: 0.15, blooms: 5 });
    }
    // stones & moss around the foot of the steps
    for (let k = 0; k < 4; k++) {
      const p = polar(a + rng.jitter(0.15), r0 + Dp + 0.4 + rng.range(0.4, 1.4), 0);
      p.y = getHeight(p.x, p.z);
      const s = rng.range(0.12, 0.25);
      B.add(mats.stone(), xf(stoneGeo(rng, { r: s, sy: 0.5 }), [p.x, p.y + s * 0.15, p.z], [0, rng.next() * TAU, 0]));
      B.add(mats.moss(), xf(mossGeo(rng, { r: s * 0.8, h: 0.05 }), [p.x, p.y + s * 0.3, p.z]), { cast: false });
    }
  }

  // ── the track: two crooked peeled-pole rails lashed to the bark with rope,
  //    ivy twining up them, a slime trail glistening between (no rungs: it
  //    must never read as a ladder) ─────────────────────────────────────────
  {
    const y0 = Math.max(platY - 0.2, rootClear - 0.15), y1 = OAK.loft.y - 0.1;
    const railMat = mats.wood(OLD_POLE[1]);
    for (const s of [-1, 1]) {
      const pts = [];
      for (let y = y0; y <= y1 + 0.001; y += 0.5) pts.push(polar(a, bark(a, y) + 0.07, y).addScaledVector(lat, s * 0.2));
      // one long pole per side, a gentle wander, tapering towards the top
      const wander = pts.map((p, k) => p.clone().addScaledVector(lat, Math.sin(k * 0.7 + s) * 0.012));
      pole(wander, 0.036, 0.03, { radial: 6, seed: 80 + s, lump: 0.08 }, { cast: false });
      // lashed to short wooden pegs in the bark every ~1.5
      for (let j = 1; j < pts.length - 1; j += 3) {
        const p = pts[j];
        const along = pts[j + 1].clone().sub(pts[j - 1]).normalize();
        B.add(railMat, xf(new THREE.CylinderGeometry(0.03, 0.035, 0.12, 6).rotateX(Math.PI / 2), [p.x - n.x * 0.04, p.y - 0.06, p.z - n.z * 0.04], [0, a, 0]), { cast: false });
        for (const lg of lashing(p, along, 0.036, { turns: 2, thick: 0.012, gap: 0.03 })) B.add(ropeMat, lg, { cast: false });
      }
      // ivy twining up the rail here and there
      for (let j = 1; j < pts.length - 1; j++) {
        if ((j + (s > 0 ? 1 : 0)) % 4 !== 0) continue;
        const p = pts[j];
        for (let q = 0; q < 2; q++) {
          const base = p.clone().addScaledVector(lat, s * 0.05).add(new THREE.Vector3(0, q * 0.25, 0));
          B.add(mats.ivy(), ivyCard(base, new THREE.Vector3(rng.jitter(0.3), 1, rng.jitter(0.3)), n.clone().addScaledVector(lat, s * 0.6), rng.range(0.28, 0.42), rng.next() < 0.5), { cast: false });
        }
      }
    }
    // a lantern half way up, on a crooked twig driven into the bark beside the track
    {
      const aL = a - 10 * DEG;
      const yL = THREE.MathUtils.lerp(y0, y1, 0.42);
      const nL = radial(aL);
      const p0 = polar(aL, bark(aL, yL) - 0.04, yL);
      const tip = polar(aL, bark(aL, yL) + 0.32, yL + 0.12);
      bough([p0, p0.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0.07, 0)), tip], 0.035, 0.022, { radial: 5, seed: 83 }, { cast: false });
      const l = ctx.props.makeLantern({ hanging: true, color: '#ffc46b', halo: false });
      l.scale.setScalar(0.62);
      l.position.copy(tip).add(new THREE.Vector3(0, -0.01, 0));
      env.extraLights?.add(l);
      env.halos.push(tip.clone().add(new THREE.Vector3(0, -0.5 * 0.62 + 0.17 * 0.62 - 0.01, 0)), 0.7, '#ffc46e');
      B.add(mats.moss(), xf(mossGeo(rng, { r: 0.12, h: 0.05 }), [p0.x + nL.x * 0.06, p0.y + 0.03, p0.z + nL.z * 0.06]), { cast: false });
    }
    // the glistening slime trail
    const trail = [];
    for (let y = y0 + 0.3; y <= y1; y += 0.25) trail.push(polar(a + Math.sin(y * 1.7) * 0.012, bark(a, y) + 0.012, y));
    const pos = [], idx = [];
    trail.forEach((p, i) => {
      const w = 0.07 + 0.02 * Math.sin(i * 1.3);
      const q0 = p.clone().addScaledVector(lat, -w), q1 = p.clone().addScaledVector(lat, w);
      pos.push(q0.x, q0.y, q0.z, q1.x, q1.y, q1.z);
      if (i > 0) idx.push((i - 1) * 2, i * 2, (i - 1) * 2 + 1, (i - 1) * 2 + 1, i * 2, i * 2 + 1);
    });
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tg.setIndex(idx);
    tg.computeVertexNormals();
    const slime = new THREE.Mesh(tg, ctx.materials.standard('#cfe6ee', { roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.38, depthWrite: false }));
    slime.name = 'lift-slime-trail';
    slime.raycast = () => {};
    root.add(slime);
  }

  // ── motion: up, rest (turn), down, rest (turn) ────────────────────────────
  const dist = topHookY - bottomHookY;
  const travel = dist / SPEED;
  const REST = 6.5, TURN = 2.6;
  const cycle = 2 * (travel + REST);
  const M = new THREE.Matrix4();
  const Minv = new THREE.Matrix4();
  const BW = new THREE.Matrix4();
  const _rx = new THREE.Matrix4();
  const hookW = new THREE.Vector3();
  let sway = 0, swayV = 0, prevY = bottomHookY, prevV = 0;
  const camPos = new THREE.Vector3();

  /** Place everything for cycle time t (seconds). */
  function place(t, dt = 0) {
    let tc = ((t % cycle) + cycle) % cycle;
    let hookY, heading, moving;
    const ease = (u) => u * u * (3 - 2 * u);
    if (tc < travel) {
      // going up (gentle start & stop)
      const u = tc / travel;
      const e = u < 0.08 ? ease(u / 0.08) * 0.08 : u > 0.92 ? 0.92 + ease((u - 0.92) / 0.08) * 0.08 : u;
      hookY = bottomHookY + dist * e;
      heading = 0;
      moving = 1;
    } else if (tc < travel + REST) {
      const r = tc - travel;
      hookY = topHookY;
      const k = THREE.MathUtils.clamp((r - 1.2) / TURN, 0, 1);
      heading = Math.PI * ease(k);
      moving = k > 0 && k < 1 ? 0.45 : 0;
    } else if (tc < 2 * travel + REST) {
      const u = (tc - travel - REST) / travel;
      const e = u < 0.08 ? ease(u / 0.08) * 0.08 : u > 0.92 ? 0.92 + ease((u - 0.92) / 0.08) * 0.08 : u;
      hookY = topHookY - dist * e;
      heading = Math.PI;
      moving = 1;
    } else {
      const r = tc - 2 * travel - REST;
      hookY = bottomHookY;
      const k = THREE.MathUtils.clamp((r - 1.2) / TURN, 0, 1);
      heading = Math.PI + Math.PI * ease(k);
      moving = k > 0 && k < 1 ? 0.45 : 0;
    }
    // carrier: on the bark, its Z axis up the trunk; the hook is at pivot + hookLocal
    const yC = hookY - shellZ; // pivot height = hook height (hook lies on the pivot axis)
    const rC = bark(a, yC) + 0.015;
    const O = polar(a, rC, yC);
    M.makeBasis(lat.clone().negate(), n, up).setPosition(O);
    carrier.matrix.copy(M);
    carrier.matrixWorldNeedsUpdate = true;
    pivot.rotation.y = heading;
    snail.setMoving(moving);
    // the basket hangs from the hook, level, with a little pendulum swing
    hookW.set(hookLocal.x, hookLocal.y, shellZ).applyMatrix4(M);
    // pendulum: driven by the hook's vertical acceleration (start / stop jerk).
    // Sub-stepped and clamped so a frame hitch (or a debug time jump) can't blow it up.
    if (dt > 0 && dt < 0.5) {
      const v = (hookY - prevY) / dt;
      const acc = THREE.MathUtils.clamp((v - prevV) / dt, -3, 3);
      prevV = v;
      if (!reduced) {
        const n = Math.ceil(dt / (1 / 60));
        const h = dt / n;
        for (let i = 0; i < n; i++) {
          swayV += (-sway * 14 - swayV * 1.6 - acc * 0.6) * h;
          sway += swayV * h;
        }
      }
    } else {
      prevV = 0;
      sway = swayV = 0;
    }
    prevY = hookY;
    BW.makeRotationY(a).multiply(_rx.makeRotationX(THREE.MathUtils.clamp(sway, -0.25, 0.25) + (reduced ? 0 : Math.sin(t * 0.9) * 0.015)));
    BW.setPosition(hookW);
    basket.matrix.multiplyMatrices(Minv.copy(M).invert(), BW);
    basket.matrixWorldNeedsUpdate = true;
    // the snail watches the visitor while it rests
    if (moving === 0 && ctx.camera) snail.lookAt(ctx.camera.getWorldPosition(camPos));
    else snail.lookAt(null);
  }
  let time = travel * 0.94; // start just below the deck: the first view shows it arriving
  place(time);
  updates.push((dt) => {
    if (reduced) return;
    time += dt;
    place(time, dt);
  });
  // debug / screenshots: jump along the ride — u in [0, 0.5) is the way up
  // (0.25 = half way), [0.5, 1) the way down (0.75 = half way)
  const setPhase = (u) => {
    u = ((u % 1) + 1) % 1;
    time = u < 0.5 ? 2 * u * travel : travel + REST + (2 * u - 1) * travel;
    place(time);
  };

  return {
    snail,
    carrier,
    basket,
    hotspot: carrier,
    bottom: polar(a, bark(a, platY) + 1.2, platY),
    top: polar(a, bark(a, OAK.loft.y) + 0.9, OAK.loft.y),
    /** where the hook is, every frame */
    hook: hookW,
    /** seconds for a full up-rest-down-rest loop */
    cycle,
    /** seconds of one ride (up or down); a rest of REST seconds follows each */
    travel,
    setPhase,
    /** debug: jump to cycle time t (seconds; 0 = leaving the bottom) */
    setTime(t) {
      time = t;
      place(time);
    },
  };
}

function flip(geo) {
  const ia = geo.index.array;
  for (let i = 0; i < ia.length; i += 3) [ia[i + 1], ia[i + 2]] = [ia[i + 2], ia[i + 1]];
  const n = geo.attributes.normal;
  for (let i = 0; i < n.array.length; i++) n.array[i] = -n.array[i];
  return geo;
}
