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

/**
 * Shader warm-up while the world is still being built: right after a module is
 * built, its materials' programs are created (renderer.compile only issues the
 * compile & link — nothing waits for them), so the GPU process / driver compiles
 * them while the following modules build, instead of all of them after the last
 * one. (Texture bakes are held back meanwhile — materials.holdBakes in main.js —
 * since a bake would wait for every program queued before it.)
 * A program is keyed on the render setup it is drawn with, so this compiles
 * against the final one: the post chain's HDR scene target (a 1×1 stand-in —
 * only "drawn into a target" enters the key) and the point lights the lighting
 * will hand out at allocate() (stand-ins until then). A stale guess costs a
 * wasted compile, never a different picture: three re-keys every draw.
 */
function createPrecompiler(ctx, postMode) {
  const { renderer } = ctx.engine;
  const target = postMode ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true }) : null;
  const standIns = [];
  return {
    compile(roots) {
      if (!roots.length) return;
      const lights = ctx.lights;
      const need = lights && !lights.allocated ? lights.pointBudget ?? 0 : 0;
      while (standIns.length < need) {
        const l = new THREE.PointLight('#ffffff', 0, 7, 2);
        l.castShadow = false;
        l.name = 'precompile-stand-in';
        standIns.push(l);
      }
      const added = standIns.slice(0, need);
      for (const l of added) ctx.scene.add(l);
      const prev = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(target);
        for (const root of roots) {
          // (compile(root, camera, scene) gathers the scene's lights AND the root's own:
          //  a root holding lights would count them twice — the final warm-up covers it)
          let hasLight = false;
          root.traverse((o) => (hasLight ||= !!o.isLight));
          if (!hasLight) renderer.compile(root, ctx.camera, ctx.scene);
        }
      } catch {
        /* an optimisation only: the final warm-up compiles whatever is missing */
      } finally {
        renderer.setRenderTarget(prev);
        for (const l of added) ctx.scene.remove(l);
      }
    },
    dispose() {
      target?.dispose();
    },
  };
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
  // fetch every module up front (in parallel) instead of one round trip per module
  const loaded = tasks.map((t) => t.load());
  for (const p of loaded) p.catch(() => {}); // (a failure is reported when that module's turn comes)
  tasks.forEach((t, i) => (t.load = () => loaded[i]));
  let precompiler = null;
  if (ctx.engine.params.get('precompile') !== '0') {
    try {
      const post = tasks.find((t) => t.id === 'post');
      const mod = post ? await post.load() : null;
      precompiler = createPrecompiler(ctx, mod?.postMode?.(ctx) ?? null);
    } catch {
      precompiler = null;
    }
  }
  for (const task of tasks) {
    const t0 = performance.now();
    try {
      const mod = await task.load();
      const build = mod.default;
      if (typeof build !== 'function') throw new Error('module has no default build() export');
      const before = new Set(ctx.scene.children);
      const result = await build(ctx);
      const roots = ((ctx.moduleRoots ??= {})[task.id] = ctx.scene.children.filter((c) => !before.has(c)));
      if (task.id !== 'post') precompiler?.compile(roots);
      if (result?.update) ctx.engine.addUpdate(result.update, 20);
      ctx.modules[task.id] = result ?? {};
      report.ok.push({ id: task.id, ms: Math.round(performance.now() - t0) });
      performance.measure?.(`woodland:build:${task.id}`, { start: t0 });
    } catch (err) {
      console.error(`[world] "${task.id}" failed to build — skipping it.`, err);
      report.failed.push({ id: task.id, error: String(err?.stack || err) });
    }
    done++;
    onProgress(done / tasks.length, task.id);
    // Yield so the loader can paint between heavy builds.
    await new Promise((r) => setTimeout(r, 0));
  }
  precompiler?.dispose();
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
