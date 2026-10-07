// ─────────────────────────────────────────────────────────────────────────────
// Jonny's Cottage & the Wohnatelier — the mushroom-house corner of the glen
// (spots 'home' and 'interior'; anchors COTTAGE.home / atelier / shed).
//
//   home      a tall red fly-agaric house with a shorter wing mushroom, fairy
//             lights, a fenced garden with a rose-arch gate, vegetable bed,
//             bench & sleeping cat, the carved "Jonny's Woodland" sign and the
//             mailbox (cottage/home.js)
//   atelier   an ochre mushroom opened up at the front by a big arched loggia,
//             revealing a designed living room; outside a mood-board easel,
//             a model table and a villager designer (cottage/atelier.js)
//   shed      a tiny tan mushroom garden shed with tools and pots (cottage/shed.js)
//
// Everything static is merged per material into ONE batch for the whole
// corner (a few dozen draw calls); hotspot pieces are small separate groups.
// Hotspots (all real, visible objects that bounce on hover): about-me (the
// front-door leaf + Jonny's portrait in the window), contact (mailbox),
// living-room (the sofa, picking the whole room), moodboards (easel),
// small-space (model table), a secret cat.
// Perf (high): ≈ 202k triangles, 43 draw calls, 12 shadow casters (moduleStats).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { Batch, setCottageNight } from './cottage/kit.js';
import { buildHome } from './cottage/home.js';
import { buildAtelier } from './cottage/atelier.js';
import { buildShed } from './cottage/shed.js';
import { glowQuads } from '../props/glow.js';
import { makeSmoke } from './cottage/smoke.js';
import { scatterPad } from './cottage/scatter.js';
import { createRng } from '../core/rng.js';

export default async function build(ctx) {
  const root = new THREE.Group();
  root.name = 'cottage';
  ctx.scene.add(root);
  const B = new Batch();
  const halos = [];
  const reduced = !!ctx.engine?.reducedMotion;

  const smoke = [];
  const parts = [buildHome(ctx, B, root, halos, smoke), buildAtelier(ctx, B, root, halos, smoke), buildShed(ctx, B, root, halos)];

  // dress the pads' ground (vegetation keeps off building plots)
  const keepOut = parts.flatMap((p) => p.keepOut ?? []);
  const glowHalos = [];
  const density = ctx.quality?.density ?? 1;
  const srng = createRng('cottage-ground');
  for (const p of parts) for (const pad of p.pads ?? []) scatterPad(B.at(new THREE.Matrix4()), srng, { ...pad, keepOut, density, glowClusters: pad.glow, halos: glowHalos });

  B.build(root, 'cottage');
  if (glowHalos.length) root.add(glowQuads(glowHalos, '#8ff5d6', { day: 0.0, night: 0.32 }));

  // smoke from every chimney in one mesh, night halos (windows, lanterns, fairy lights) in another
  if (smoke.length) root.add(makeSmoke(smoke, { reducedMotion: reduced }));
  if (halos.length) root.add(glowQuads(halos, '#ffc477', { day: 0.03, night: 0.38 }));

  const updates = [];
  setCottageNight(ctx.env?.night ?? 0);
  updates.push(() => setCottageNight(ctx.env?.night ?? 0)); // warm gill bounce follows day/night
  for (const p of parts) {
    for (const [obj, opts] of p.hotspots) ctx.interactions?.add?.(obj, opts);
    for (const [pos, opts] of p.lights) ctx.lights?.addPoint?.(pos, opts);
    for (const [x, z, r] of p.colliders ?? []) ctx.colliders?.addCircle?.(x, z, r, 'cottage');
    updates.push(...p.updates);
  }

  return {
    /** Static triangles in the merged cottage batch (debug). */
    tris: B.tris,
    update(dt, t) {
      for (const u of updates) u(dt, t);
    },
  };
}
