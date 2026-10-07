// ─────────────────────────────────────────────────────────────────────────────
// World assembly. Loads every world module with dynamic import() so that a
// broken module only removes itself from the glen instead of taking the whole
// site down (and so the loader can show real progress).
//
// WORLD MODULE contract (src/world/<name>.js or src/scene/<name>.js):
//   export default async function build(ctx) { …; return { update?(dt, t) } }
// Modules build in WORLD coordinates using the anchors in layout.js. Use
// anchorGroup(ctx, anchor) for a group placed & rotated at a layout anchor.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight } from './ground.js';

/** Order matters a little: lighting & atmosphere first so materials compile against them. */
export const WORLD_MODULES = [
  ['lighting', () => import('./lighting.js')],
  ['sky', () => import('./sky.js')],
  ['atmosphere', () => import('./atmosphere.js')],
  ['terrain', () => import('./terrain.js')],
  ['oak', () => import('../scene/oak.js')],
  ['schreinerei', () => import('../scene/schreinerei.js')],
  ['loft', () => import('../scene/loft.js')],
  ['cottage', () => import('../scene/cottage.js')],
  ['riverside', () => import('../scene/riverside.js')],
  ['vegetation', () => import('./vegetation.js')],
  ['ambient', () => import('./ambient.js')],
  ['post', () => import('./post.js')],
];

/**
 * A group positioned at a layout anchor ({ x, z, y?, rotY? }), sitting on the
 * ground (y = getHeight unless anchor.y is given), added to the scene.
 */
export function anchorGroup(ctx, anchor, name = '') {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(anchor.x, anchor.y ?? getHeight(anchor.x, anchor.z), anchor.z);
  g.rotation.y = anchor.rotY ?? 0;
  ctx.scene.add(g);
  return g;
}

export async function buildWorld(ctx, onProgress = () => {}) {
  let tasks = WORLD_MODULES.map(([id, load]) => ({ id, load }));
  // ?scene=showcase renders only lighting, sky, atmosphere and the props showcase (for prop development).
  if (ctx.engine.params.get('scene') === 'showcase') {
    tasks = [
      ...tasks.filter((t) => ['lighting', 'sky', 'atmosphere', 'post'].includes(t.id)),
      { id: 'showcase', load: () => import('../props/showcase.js') },
    ];
  }
  // ?scene=materials renders the surface/foliage material showcase (look-dev of src/core/materials.js).
  if (ctx.engine.params.get('scene') === 'materials') {
    tasks = [
      ...tasks.filter((t) => ['lighting', 'sky', 'atmosphere', 'post'].includes(t.id)),
      { id: 'materials', load: () => import('../core/materialShowcase.js') },
    ];
  }
  // ?only=oak,terrain builds just those modules (+ lighting/sky/atmosphere/post) — handy while developing one piece.
  const only = ctx.engine.params.get('only');
  if (only) {
    const keep = new Set(['lighting', 'sky', 'atmosphere', 'post', ...only.split(',')]);
    tasks = tasks.filter((t) => keep.has(t.id));
  }
  const report = { ok: [], failed: [] };
  let done = 0;
  for (const task of tasks) {
    const t0 = performance.now();
    try {
      const mod = await task.load();
      const build = mod.default;
      if (typeof build !== 'function') throw new Error('module has no default build() export');
      const before = new Set(ctx.scene.children);
      const result = await build(ctx);
      (ctx.moduleRoots ??= {})[task.id] = ctx.scene.children.filter((c) => !before.has(c));
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

/**
 * Per-module render cost (debug): meshes, draw calls (visible meshes), triangles
 * (instanced meshes count every instance) and shadow casters, for the scene
 * roots each module added. Usage: __woodland.ctx.moduleStats()
 */
export function moduleStats(ctx) {
  const out = {};
  for (const [id, roots] of Object.entries(ctx.moduleRoots ?? {})) {
    const s = { meshes: 0, draws: 0, triangles: 0, casters: 0, instances: 0 };
    for (const r of roots) {
      r.traverse((o) => {
        if (!o.isMesh && !o.isPoints && !o.isLine) return;
        s.meshes++;
        let visible = true;
        for (let p = o; p; p = p.parent) if (!p.visible) visible = false;
        if (!visible) return;
        s.draws++;
        if (o.castShadow) s.casters++;
        const g = o.geometry;
        if (!g || !o.isMesh) return;
        const n = (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
        const k = o.isInstancedMesh ? o.count : 1;
        if (o.isInstancedMesh) s.instances += k;
        s.triangles += Math.round(n * k);
      });
    }
    const budget = ctx.modules?.[id]?.budget?.[ctx.quality?.tier];
    if (budget) {
      s.budget = budget;
      s.overBudget = s.triangles > budget;
    }
    out[id] = s;
  }
  return out;
}
