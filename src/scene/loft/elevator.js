// ─────────────────────────────────────────────────────────────────────────────
// The snail lift of the Code Loft: a riding snail with a little wicker basket
// crawls up and down a wooden track on the bark of the Great Oak, between a
// boarding platform on the roots and the slot in the deck — up, rest (it
// turns round), down, rest. It passes through the slot in the stair landing
// on the way. A faint silvery slime trail glistens between the rails.
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
import { DEG, TAU, IRON, BRASS, Batch, smallBitsRemap, polar, radial, timber, branch, tubeAlong, xf, stoneGeo, mossGeo } from './kit.js';
import { ELEVATOR_AZ, LIFT } from './deck.js';

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
  root.add(basket);

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

  // boarding platform: planks on short posts, log steps down to the ground
  {
    const yP = platY;
    const r0 = bark(a, yP) + 0.15;
    const W = 0.95, Dp = 2.1;
    for (let k = 0; k < 4; k++) {
      const off = (k - 1.5) * 0.24;
      const p0 = polar(a, r0, yP - 0.03).addScaledVector(lat, off);
      const p1 = polar(a, r0 + Dp, yP - 0.03).addScaledVector(lat, off);
      // leave a gap for the basket near the bark
      const g0 = p0.clone().lerp(p1, 0.52);
      B.add(mats.wood(rng.pick(['#8f8478', '#9c7a55', '#8a6c4e'])), timber(g0, p1, 0.22, 0.06, { rng, wobble: 0.004 }));
    }
    for (const s of [-1, 1]) {
      const p0 = polar(a, r0, yP - 0.1).addScaledVector(lat, s * W / 2);
      const p1 = polar(a, r0 + Dp, yP - 0.1).addScaledVector(lat, s * W / 2);
      B.add(mats.timber('#7a6450'), timber(p0, p1, 0.09, 0.1, { rng }));
      // posts down to the roots / ground
      for (const u of [0.5, 1]) {
        const top = p0.clone().lerp(p1, u);
        const g = Math.max(getHeight(top.x, top.z), isFinite(rootTop(top.x, top.z)) ? rootTop(top.x, top.z) : -1);
        if (top.y - g > 0.08) B.add(mats.bark(), branch([top, top.clone().setY(g - 0.1)], 0.05, 0.055, { radial: 6, seed: u * 3 + s }), { cast: false });
      }
      // a little railing on the sides
      const r0p = p0.clone().lerp(p1, 0.5).add(new THREE.Vector3(0, 0.1, 0));
      const r1p = p1.clone().add(new THREE.Vector3(0, 0.1, 0));
      const t0 = r0p.clone().add(new THREE.Vector3(0, 0.55, 0)), t1 = r1p.clone().add(new THREE.Vector3(0, 0.55, 0));
      B.add(mats.bark(), branch([r0p, t0], 0.03, 0.026, { radial: 5, seed: s }), { cast: false });
      B.add(mats.bark(), branch([r1p, t1], 0.03, 0.026, { radial: 5, seed: s + 2 }), { cast: false });
      B.add(mats.bark(), branch([t0, t0.clone().lerp(t1, 0.5).add(new THREE.Vector3(0, 0.02, 0)), t1], 0.026, 0.024, { radial: 5, seed: s + 4 }), { cast: false });
    }
    // a rustic ladder from the moss up to the platform's outer edge
    {
      const topC = polar(a, r0 + Dp - 0.02, yP + 0.02);
      const footC = polar(a, r0 + Dp + Math.max(0.6, yP * 0.32), 0);
      footC.y = getHeight(footC.x, footC.z);
      const rails = [];
      for (const s of [-1, 1]) {
        const t = topC.clone().addScaledVector(lat, s * 0.26).add(new THREE.Vector3(0, 0.45, 0));
        const f = footC.clone().addScaledVector(lat, s * 0.3);
        B.add(mats.bark(), branch([f, f.clone().lerp(t, 0.5).add(new THREE.Vector3(rng.jitter(0.03), 0, rng.jitter(0.03))), t], 0.045, 0.036, { radial: 6, seed: 70 + s }));
        rails.push([f, t]);
      }
      const rungs = Math.max(2, Math.round(yP / 0.32));
      for (let k = 1; k <= rungs; k++) {
        const u = k / (rungs + 1.3);
        const p0 = rails[0][0].clone().lerp(rails[0][1], u), p1 = rails[1][0].clone().lerp(rails[1][1], u);
        B.add(mats.wood('#7a5a3e'), timber(p0, p1, 0.05, 0.05, { rng, wobble: 0.006 }), { cast: false });
        B.add(mats.rope(), xf(new THREE.TorusGeometry(0.05, 0.012, 3, 8), [p0.x, p0.y, p0.z], [0, a, 0]), { cast: false });
      }
    }
    // a bell on a little gallows to call the snail
    {
      const bp = polar(a, r0 + Dp - 0.1, yP).addScaledVector(lat, 0.56);
      const top = bp.clone().add(new THREE.Vector3(0, 1.05, 0));
      B.add(mats.bark(), branch([bp, bp.clone().add(new THREE.Vector3(0.02, 0.5, 0)), top], 0.035, 0.028, { radial: 6, seed: 61 }));
      const armEnd = top.clone().addScaledVector(lat, -0.25);
      B.add(mats.bark(), branch([top, top.clone().addScaledVector(lat, -0.12).add(new THREE.Vector3(0, 0.03, 0)), armEnd], 0.025, 0.02, { radial: 5, seed: 62 }), { cast: false });
      B.add(mats.metal(BRASS), xf(new THREE.CylinderGeometry(0.03, 0.065, 0.1, 10, 1, true), [armEnd.x, armEnd.y - 0.1, armEnd.z]));
      B.add(mats.metal(BRASS), xf(new THREE.SphereGeometry(0.02, 6, 4), [armEnd.x, armEnd.y - 0.16, armEnd.z]), { cast: false });
      B.add(mats.rope(), tubeAlong([armEnd.clone().add(new THREE.Vector3(0, -0.15, 0)), armEnd.clone().add(new THREE.Vector3(0.03, -0.45, 0)), armEnd.clone().add(new THREE.Vector3(0.02, -0.7, 0.02))], 0.008, 4), { cast: false });
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

  // ── the track: two slim rails on standoff blocks, a slime trail between ───
  {
    const y0 = Math.max(platY - 0.2, rootClear - 0.15), y1 = OAK.loft.y - 0.1;
    for (const s of [-1, 1]) {
      const pts = [];
      for (let y = y0; y <= y1 + 0.001; y += 0.5) pts.push(polar(a, bark(a, y) + 0.07, y).addScaledVector(lat, s * 0.2));
      for (let j = 0; j < pts.length - 1; j++) B.add(mats.wood('#7a5a3e'), timber(pts[j], pts[j + 1], 0.05, 0.06, { rng, wobble: 0.003, up: [n.x, 0, n.z] }), { cast: false });
      for (let j = 0; j < pts.length; j += 2) {
        const p = pts[j];
        B.add(mats.wood('#5e4433'), xf(new THREE.BoxGeometry(0.08, 0.12, 0.08), [p.x - n.x * 0.04, p.y, p.z - n.z * 0.04], [0, a, 0]), { cast: false });
        B.add(mats.metal(IRON), xf(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 5).rotateX(Math.PI / 2), [p.x + n.x * 0.035, p.y, p.z + n.z * 0.035], [0, a, 0]), { cast: false });
      }
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
    const v = dt > 0 ? (hookY - prevY) / dt : 0;
    const acc = dt > 0 ? (v - prevV) / dt : 0;
    prevY = hookY;
    prevV = v;
    if (!reduced && dt > 0) {
      swayV += (-sway * 14 - swayV * 1.6 - acc * 0.6) * dt;
      sway += swayV * dt;
    }
    basket.position.copy(hookW);
    basket.rotation.set(0, a, 0);
    basket.rotateX(THREE.MathUtils.clamp(sway, -0.25, 0.25) + (reduced ? 0 : Math.sin(t * 0.9) * 0.015));
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

  return {
    snail,
    carrier,
    basket,
    hotspot: carrier,
    bottom: polar(a, bark(a, platY) + 1.2, platY),
    top: polar(a, bark(a, OAK.loft.y) + 0.9, OAK.loft.y),
    /** where the hook is, every frame */
    hook: hookW,
  };
}

function flip(geo) {
  const ia = geo.index.array;
  for (let i = 0; i < ia.length; i += 3) [ia[i + 1], ia[i + 2]] = [ia[i + 2], ia[i + 1]];
  const n = geo.attributes.normal;
  for (let i = 0; i < n.array.length; i++) n.array[i] = -n.array[i];
  return geo;
}
