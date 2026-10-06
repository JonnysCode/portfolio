// ─────────────────────────────────────────────────────────────────────────────
// World assembly. Loads every world module and district builder with dynamic
// import() so that a broken module only removes itself from the world instead
// of taking the whole site down (and so the loader can show real progress).
//
// WORLD MODULE contract (src/world/<name>.js):
//   export default async function build(ctx) { …; return { update?(dt, t) } }
//
// DISTRICT contract (src/districts/<id>.js):
//   export default async function build(ctx, site) { …; return { update?(dt, t) } }
//   `site` is described in createSite() below. Build in LOCAL coordinates:
//   origin = clearing centre, ground y = 0, local +Z faces the plaza/entrance.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { AREAS } from './layout.js';
import { getHeight } from './ground.js';
import { createRng } from '../core/rng.js';

/** Order matters a little: lighting & sky first so materials compile against them. */
export const WORLD_MODULES = [
  ['lighting', () => import('./lighting.js')],
  ['sky', () => import('./sky.js')],
  ['terrain', () => import('./terrain.js')],
  ['water', () => import('./water.js')],
  ['vegetation', () => import('./vegetation.js')],
  ['ambient', () => import('./ambient.js')],
  ['post', () => import('./post.js')],
];

export const DISTRICT_MODULES = {
  plaza: () => import('../districts/plaza.js'),
  woodworking: () => import('../districts/woodworking.js'),
  bikes: () => import('../districts/bikes.js'),
  interior: () => import('../districts/interior.js'),
  code: () => import('../districts/code.js'),
  home: () => import('../districts/home.js'),
};

/**
 * The `site` object handed to district builders.
 * @param {*} ctx
 * @param {*} area  entry from layout AREAS (PLAZA or a district)
 */
export function createSite(ctx, area) {
  const facing = area.facing ?? 0;
  const group = new THREE.Group();
  group.name = `area:${area.id}`;
  group.position.set(area.center.x, 0, area.center.z);
  group.rotation.y = facing;
  ctx.scene.add(group);
  const s = Math.sin(facing), c = Math.cos(facing);
  const updates = [];

  const site = {
    id: area.id,
    area,
    title: area.title,
    radius: area.radius,
    facing,
    /** Local snail stop position — keep a ~2.5 unit circle around it clear. */
    stationLocal: area.stationLocal ?? null,
    /** Local point where the main path enters (0, radius). Keep a corridor clear. */
    entranceLocal: area.entranceLocal ?? { x: 0, z: area.radius },
    /** Add your meshes to this group (already positioned & rotated). */
    group,
    /** Deterministic RNG for this district. */
    rng: createRng(`site:${area.id}`),
    toWorld(lx, lz) {
      return { x: area.center.x + lx * c + lz * s, z: area.center.z - lx * s + lz * c };
    },
    toLocal(wx, wz) {
      const x = wx - area.center.x, z = wz - area.center.z;
      return { x: x * c - z * s, z: x * s + z * c };
    },
    /** Ground height at a LOCAL position (0 everywhere inside the clearing). */
    heightAt(lx, lz) {
      const w = site.toWorld(lx, lz);
      return getHeight(w.x, w.z);
    },
    /** Circle collider at a LOCAL position. */
    addCollider(lx, lz, r, tag) {
      const w = site.toWorld(lx, lz);
      return ctx.colliders.addCircle(w.x, w.z, r, tag ?? area.id);
    },
    /** Oriented box collider at a LOCAL position; rotY is local (relative to the site). */
    addBoxCollider(lx, lz, halfW, halfD, rotY = 0, tag) {
      const w = site.toWorld(lx, lz);
      return ctx.colliders.addBox(w.x, w.z, halfW, halfD, facing + rotY, tag ?? area.id);
    },
    /**
     * Make an object clickable. `object` must already be added to the scene graph.
     * opts: { entryId, label, onActivate(hotspot), markerHeight, focus: { distance, height } }
     * With an entryId and no onActivate, clicking opens that content entry.
     */
    addHotspot(object, opts = {}) {
      return ctx.interactions.add(object, { area: area.id, ...opts });
    },
    /** Per-frame callback (dt, elapsed). */
    addUpdate(fn) {
      updates.push(fn);
    },
    _updates: updates,
  };
  return site;
}

export async function buildWorld(ctx, onProgress = () => {}) {
  let tasks = [
    ...WORLD_MODULES.map(([id, load]) => ({ kind: 'world', id, load })),
    ...AREAS.map((a) => ({ kind: 'district', id: a.id, area: a, load: DISTRICT_MODULES[a.id] })),
  ];
  // ?scene=showcase renders only lighting, sky and the props showcase (for prop development).
  if (ctx.engine.params.get('scene') === 'showcase') {
    tasks = [
      ...tasks.filter((t) => t.id === 'lighting' || t.id === 'sky' || t.id === 'post'),
      { kind: 'world', id: 'showcase', load: () => import('../props/showcase.js') },
    ];
  }
  const report = { ok: [], failed: [] };
  let done = 0;
  for (const task of tasks) {
    const t0 = performance.now();
    try {
      const mod = await task.load();
      const build = mod.default;
      if (typeof build !== 'function') throw new Error('module has no default build() export');
      let result;
      if (task.kind === 'world') {
        result = await build(ctx);
      } else {
        const site = createSite(ctx, task.area);
        ctx.sites[task.id] = site;
        result = await build(ctx, site);
        const ups = site._updates;
        if (result?.update) ups.push(result.update);
        if (ups.length) ctx.engine.addUpdate((dt, t) => { for (const u of ups) u(dt, t); }, 20);
        result = null;
      }
      if (result?.update) ctx.engine.addUpdate(result.update, 20);
      ctx.modules[task.id] = result ?? {};
      report.ok.push({ id: task.id, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      console.error(`[world] "${task.id}" failed to build — skipping it.`, err);
      report.failed.push({ id: task.id, error: String(err?.stack || err) });
    }
    done++;
    onProgress(done / tasks.length, task.id);
    // Yield so the loader can paint between heavy builds.
    await new Promise((r) => setTimeout(r, 0));
  }
  ctx.buildReport = report;
  return report;
}
