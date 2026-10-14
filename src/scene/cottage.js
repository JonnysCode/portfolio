// ─────────────────────────────────────────────────────────────────────────────
// Jonny's Cottage & the Wohnatelier — the mushroom-house corner of the glen
// (spots 'home' and 'interior'; anchors COTTAGE.home / atelier / shed).
//
//   home      a tall red fly-agaric house with a shorter wing mushroom, fairy
//             lights along the rim and spiralling up the cap, a fenced garden with a rose-arch gate, vegetable bed,
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
// Night: the fairy-light strands warm the velvet of the caps next to every bulb (a baked
// bulb-proximity glow, lit in the lamplighter's cascade), the caps' domed cream flakes read
// as soft cream cushions shaded towards the moon (amber by the bulbs — never chalk chips,
// never LEDs), warm "bounce" halos sit under the rims above lit windows and the porch, the
// fairy-light spiral keeps the tall red cap a landmark, and the chimney smoke thins to a
// moonlit veil with an ember glow at its foot.
// Tiers: the layout (dormers, chimneys, doors, hotspots, plants) is the same on every tier —
// the lower tiers only tessellate coarser and thin small things out without changing any
// random draw (kit.js SINK, Cards keep).
// Perf: see COTTAGE_BUDGET below (moduleStats reports budget / overBudget per tier).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { Batch, setCottageNight, setCottageDetail, setCottageKeyDir, bakeBulbGlow, FAIRY_BULBS } from './cottage/kit.js';
import { buildHome } from './cottage/home.js';
import { buildAtelier } from './cottage/atelier.js';
import { buildShed } from './cottage/shed.js';
import { glowQuads } from '../props/glow.js';
import { makeSmoke } from './cottage/smoke.js';
import { scatterPad } from './cottage/scatter.js';
import { createRng } from '../core/rng.js';

/**
 * Triangle budget per tier (moduleStats: budget / overBudget). The tiers really differ: the
 * caps, stems and gills tessellate by ctx.quality.density (makeMushroomHouse `detail`), the
 * warts, flakes, gill fins and lamellae thin out, and the kit's small parts (stones, moss,
 * toadstools, fern fronds, fairy-light bulbs) drop facets (setCottageDetail).
 */
const COTTAGE_BUDGET = { high: 240000, medium: 160000, low: 124000 };

export default async function build(ctx) {
  const root = new THREE.Group();
  root.name = 'cottage';
  ctx.scene.add(root);
  setCottageDetail(ctx.quality?.density ?? 1);
  FAIRY_BULBS.length = 0;
  const B = new Batch();
  const halos = [];
  const reduced = !!ctx.engine?.reducedMotion;

  const smoke = [];
  const rimHalos = []; // warm window / porch light bouncing off the gills under the cap rims (night)
  const parts = [buildHome(ctx, B, root, halos, smoke, rimHalos), buildAtelier(ctx, B, root, halos, smoke, rimHalos), buildShed(ctx, B, root, halos, rimHalos)];

  // dress the pads' ground (vegetation keeps off building plots)
  const keepOut = parts.flatMap((p) => p.keepOut ?? []);
  const glowHalos = [];
  const density = ctx.quality?.density ?? 1;
  const srng = createRng('cottage-ground');
  for (const p of parts) for (const pad of p.pads ?? []) scatterPad(B.at(new THREE.Matrix4()), srng, { ...pad, keepOut, density, glowClusters: pad.glow, halos: glowHalos });

  // the fairy-light strands warm the cap skin (and the warts) next to each bulb at night
  bakeBulbGlow(B, FAIRY_BULBS);
  FAIRY_BULBS.length = 0;
  B.build(root, 'cottage');
  if (glowHalos.length) root.add(glowQuads(glowHalos, '#8ff5d6', { day: 0.0, night: 0.32 }));

  // smoke from every chimney in one mesh, night halos (windows, lanterns, fairy lights) in another
  if (smoke.length) root.add(makeSmoke(smoke, { reducedMotion: reduced }));
  if (halos.length) root.add(glowQuads(halos, '#ffc477', { day: 0.03, night: 0.38 }));
  if (rimHalos.length) root.add(glowQuads(rimHalos, '#ffb064', { day: 0.0, night: 0.3, pull: 0.25 }));

  const updates = [];
  setCottageNight(ctx.env?.night ?? 0);
  setCottageKeyDir(ctx.lights?.keyDir); // the warts' night shading faces the moon
  updates.push(() => {
    const night = ctx.env?.night ?? 0;
    setCottageNight(night); // warm gill bounce, the paper lantern & the warts' cream-mint glow follow day/night
  });
  for (const p of parts) {
    for (const [obj, opts] of p.hotspots) ctx.interactions?.add?.(obj, opts);
    for (const [pos, opts] of p.lights) ctx.lights?.addPoint?.(pos, opts);
    for (const [x, z, r] of p.colliders ?? []) ctx.colliders?.addCircle?.(x, z, r, 'cottage');
    updates.push(...p.updates);
  }

  // QA: the named anchors in world space (house dormers, chimneys, doors, windows, hotspots).
  // They must be identical on every quality tier — compare e.g.
  //   npm run shots -- --quality low --param only=cottage,terrain --views interior \
  //     --eval "JSON.stringify(__woodland.ctx.modules.cottage.anchors())"
  // against --quality high (and medium).
  const houses = parts.flatMap((p) => Object.entries(p.houses ?? {}));
  const hotspots = parts.flatMap((p) => p.hotspots);
  const anchors = () => {
    const out = {};
    const r2 = (v) => v.toArray().map((x) => Math.round(x * 100) / 100);
    for (const [name, h] of houses) {
      h.updateMatrixWorld(true);
      const u = h.userData;
      const w = (v) => (v ? r2(v.clone().applyMatrix4(h.matrixWorld)) : null);
      out[name] = {
        dormer: u.dormer ? w(u.capPoint(u.dormer.phi, u.dormer.s)) : null,
        chimney: u.chimneyTop ? w(u.chimneyTop) : null,
        door: w(u.door),
        windows: (u.windows ?? []).map((x) => w(x.pos)),
      };
    }
    const v = new THREE.Vector3();
    out.hotspots = hotspots.map(([obj, opts]) => {
      obj.updateMatrixWorld(true);
      return [opts.entryId ?? opts.label ?? obj.name, ...r2(obj.getWorldPosition(v))];
    });
    return out;
  };

  return {
    /** Static triangles in the merged cottage batch (debug). */
    tris: B.tris,
    budget: COTTAGE_BUDGET,
    anchors,
    update(dt, t) {
      for (const u of updates) u(dt, t);
    },
  };
}
