// ─────────────────────────────────────────────────────────────────────────────
// Ambient life — the little things that make the glen breathe.
//   day:   butterflies between the wildflower patches (resting on blossoms
//          now and then), dragonflies darting over the lily pond, pollen &
//          dandelion fluff drifting in the light, leaves tumbling down from
//          the Great Oak's canopy
//   dusk:  the first few fireflies wake up
//   night: hundreds of blinking fireflies swirling around the oak's roots,
//          over the stream and the pond, around the cottages, along the
//          forest edge and at the glowing mushrooms
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
import { createFireflies } from './ambient/fireflies.js';
import { createMotes } from './ambient/motes.js';
import { createLeaves } from './ambient/leaves.js';
import { createFlappers } from './ambient/flappers.js';
import { createSnailPost, createWildSnails } from './ambient/snailpost.js';
import { updatePointScale } from './ambient/points.js';
import { STREAM } from './layout.js';

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
  const wild = safe('wild snails', () => createWildSnails(ctx, { rocks: veg.mossyRocks ?? [] }));

  const focus = new THREE.Vector3(0, 0, 4);
  return {
    layers: { fireflies, motes, leaves, flappers, post, wild },
    stats: { fireflies: fireflies?.count ?? 0 },
    update(dt) {
      const night = ctx.env?.night ?? 0;
      const target = ctx.cameraRig?.target;
      if (target) focus.copy(target);
      updatePointScale(ctx.engine.renderer, ctx.camera, ctx.scene.fog);
      fireflies?.update(night);
      motes?.update(night, focus);
      leaves?.update(dt, focus);
      flappers?.update(dt, focus, night);
      post?.update(dt);
      wild?.update(dt);
    },
  };
}
