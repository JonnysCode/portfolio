// ─────────────────────────────────────────────────────────────────────────────
// Ambient life — the little things that make the glen breathe.
//   day:   butterflies between the wildflower patches (resting on blossoms
//          now and then), dragonflies darting over the lily pond, pollen &
//          dandelion fluff drifting in the light, leaves tumbling down from
//          the Great Oak's canopy
//   dusk:  the first few fireflies wake up
//   night: hundreds of blinking fireflies swirling around the oak's roots,
//          over the stream and the pond, around the cottages, along the
//          forest edge and at the glowing mushrooms; a glow-worm canopy of
//          tiny cool lights hanging under the oak's limbs and the giants'
//          crowns, twinkling slowly like a starry sky
//   always: the Schneckenpost (a post snail with its rider) crawling from the
//          main path over the stone bridge to the Velowerkstatt and back, and
//          two tiny wild snails grazing on mossy stones (one is a secret)
// Everything crossfades with ctx.env.night, is GPU-cheap (Points / small
// instanced meshes, no per-frame allocations), scales with quality density
// and calms down for prefers-reduced-motion.
//
// Uses ctx.modules.vegetation (flowerPatches, glowSpots, treesNear, mossyRocks)
// when present and follows ctx.cameraRig.target.
//
// Result (ctx.modules.ambient): { update, layers: { fireflies, motes, leaves, flappers, post, wild }, stats }
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createFireflies, createGlowWorms } from './ambient/fireflies.js';
import { createMotes } from './ambient/motes.js';
import { createLeaves } from './ambient/leaves.js';
import { createFlappers } from './ambient/flappers.js';
import { createSnailPost, createWildSnails } from './ambient/snailpost.js';
import { updatePointScale } from './ambient/points.js';
import { STREAM, OAK } from './layout.js';

export default async function build(ctx) {
  const density = ctx.quality?.density ?? 1;
  const reduced = !!ctx.engine?.reducedMotion;
  const veg = ctx.modules?.vegetation ?? {};
  const k = reduced ? 0.5 : 1;
  const safe = (name, fn) => {
    try {
      return fn();
    } catch (err) {
      console.warn(`[ambient] ${name} failed`, err);
      return null;
    }
  };

  const fireflies = safe('fireflies', () =>
    createFireflies(ctx, {
      glowSpots: veg.glowSpots ?? [],
      count: Math.round(Math.max(220, 640 * density) * (reduced ? 0.6 : 1)),
      reduced,
    }),
  );
  // the glow-worm canopy: hanging just under the lowest leaves of the Great
  // Oak's crown (read from its leaf cards: the lowest leaf per 1.2-unit cell)
  // and under the giants' leaf masses near the glen
  const glowworms = safe('glowworms', () => {
    const anchors = [];
    const leaves = ctx.oak?.group?.getObjectByName?.('oak-leaves');
    const P = leaves?.geometry?.attributes?.position;
    if (P) {
      leaves.updateWorldMatrix(true, false);
      const C = 1.2;
      const cells = new Map();
      const v = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(leaves.matrixWorld);
        const key = `${Math.floor(v.x / C)},${Math.floor(v.z / C)}`;
        const c = cells.get(key);
        if (!c) cells.set(key, { x: v.x, y: v.y, z: v.z, n: 1 });
        else {
          c.n++;
          if (v.y < c.y) {
            c.x = v.x;
            c.y = v.y;
            c.z = v.z;
          }
        }
      }
      // (only cells with a real leaf mass overhead; a lone stray card is no
      //  ceiling. The crown's outer rim is what the cameras see from below and
      //  from the side: those cells count up to three times)
      let rMax = 1;
      for (const c of cells.values()) rMax = Math.max(rMax, Math.hypot(c.x - OAK.x, c.z - OAK.z));
      for (const c of cells.values()) {
        if (c.n < 12) continue;
        const a = { x: c.x, y: c.y - 0.15, z: c.z, r: C * 0.6 };
        const rim = Math.hypot(c.x - OAK.x, c.z - OAK.z) / rMax;
        anchors.push(a);
        if (rim > 0.45) anchors.push(a);
        if (rim > 0.7) anchors.push(a);
      }
    } else {
      for (const l of ctx.oak?.limbInfo ?? []) {
        if (!l.curve) continue;
        for (let u = 0.3; u <= 1.001; u += 0.07) {
          const p = l.curve.getPoint(Math.min(1, u));
          anchors.push({ x: p.x, y: p.y - 2.5, z: p.z, r: 2 + u * 2 });
        }
      }
    }
    const oakN = anchors.length;
    for (const c of veg.canopy ?? []) {
      if (Math.hypot(c.x, c.z) < 34) anchors.push({ x: c.x, y: c.y - c.r * 0.75, z: c.z, r: c.r * 0.7 });
    }
    return createGlowWorms(ctx, { anchors, oakN, count: Math.round(Math.max(320, 640 * Math.min(1.2, density))), reduced, yRange: [11, 36] });
  });
  const motes = safe('motes', () => createMotes(ctx, { count: Math.round(Math.max(60, 160 * density) * k), reduced }));
  const leaves = safe('leaves', () => createLeaves(ctx, { count: Math.round(Math.max(14, 34 * density) * k), reduced }));
  const flappers = safe('flappers', () =>
    createFlappers(ctx, {
      flowerPatches: veg.flowerPatches ?? [],
      butterflies: Math.round(Math.max(6, 14 * density) * k),
      birds: 0,
      dragonflies: reduced ? 2 : 4,
      pond: { center: { x: STREAM.pond.x, z: STREAM.pond.z }, radius: STREAM.pond.radius * 0.8, waterLevel: STREAM.waterLevel },
      reduced,
    }),
  );
  const post = safe('schneckenpost', () => createSnailPost(ctx, { reduced }));
  const wild = safe('wild snails', () => createWildSnails(ctx, { rocks: veg.mossyRocks ?? [], snailRocks: veg.snailRocks ?? [] }));

  const focus = new THREE.Vector3(0, 0, 4);
  return {
    layers: { fireflies, glowworms, motes, leaves, flappers, post, wild },
    stats: { fireflies: fireflies?.count ?? 0, glowworms: glowworms?.count ?? 0 },
    update(dt) {
      const night = ctx.env?.night ?? 0;
      const target = ctx.cameraRig?.target;
      if (target) focus.copy(target);
      updatePointScale(ctx.engine.renderer, ctx.camera, ctx.scene.fog);
      fireflies?.update(night);
      glowworms?.update(night);
      motes?.update(night, focus);
      leaves?.update(dt, focus);
      flappers?.update(dt, focus, night);
      post?.update(dt);
      wild?.update(dt);
    },
  };
}
