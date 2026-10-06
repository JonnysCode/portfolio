// ─────────────────────────────────────────────────────────────────────────────
// Ambient life — the little things that make the woodland breathe.
//   day:   butterflies between the flower patches (resting on blossoms now and
//          then), dragonflies darting over the pond, pollen & dandelion fluff
//          drifting in the light, leaves and blossom petals falling, swallows
//          circling high above
//   night: hundreds of blinking fireflies (densest by the pond and the forest
//          edge) and soft halos around the glowing mushrooms
// Everything crossfades with ctx.env.night, is GPU-cheap (Points / small
// instanced meshes, no per-frame allocations), scales with quality density and
// calms down for prefers-reduced-motion.
//
// Uses ctx.modules.vegetation (flowerPatches, glowSpots, treesNear) when present
// and follows ctx.cameraRig.target, so the life is always where the visitor is.
// Draw calls: day ≤ 5 (motes, leaves, butterflies, birds, dragonflies near the
// pond), night 2 (fireflies + halos, leaves); hidden layers cost nothing.
//
// Result (ctx.modules.ambient): { update, layers: { fireflies, motes, leaves, flappers } }
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createFireflies } from './ambient/fireflies.js';
import { createMotes } from './ambient/motes.js';
import { createLeaves } from './ambient/leaves.js';
import { createFlappers } from './ambient/flappers.js';
import { updatePointScale } from './ambient/points.js';
import { SPAWN, POND } from './layout.js';

export default async function build(ctx) {
  const density = ctx.quality?.density ?? 1;
  const reduced = !!ctx.engine?.reducedMotion;
  const veg = ctx.modules?.vegetation ?? {};
  const k = reduced ? 0.5 : 1;

  const fireflies = createFireflies(ctx, {
    glowSpots: veg.glowSpots ?? [],
    count: Math.round(Math.max(220, 720 * density) * (reduced ? 0.6 : 1)),
    reduced,
  });
  const motes = createMotes(ctx, { count: Math.round(Math.max(90, 280 * density) * k), reduced });
  const leaves = createLeaves(ctx, { count: Math.round(Math.max(14, 40 * density) * k), reduced });
  const flappers = createFlappers(ctx, {
    flowerPatches: veg.flowerPatches ?? [],
    butterflies: Math.round(Math.max(8, 20 * density) * k),
    birds: reduced ? 3 : 6,
    dragonflies: reduced ? 2 : 4,
    pond: POND,
    reduced,
  });

  const focus = new THREE.Vector3(SPAWN.x, 0, SPAWN.z);
  return {
    layers: { fireflies, motes, leaves, flappers },
    update(dt) {
      const night = ctx.env?.night ?? 0;
      const target = ctx.cameraRig?.target;
      if (target) focus.copy(target);
      updatePointScale(ctx.engine.renderer, ctx.camera, ctx.scene.fog);
      fireflies.update(night);
      motes.update(night, focus);
      leaves.update(dt, focus);
      flappers.update(dt, focus, night);
    },
  };
}
