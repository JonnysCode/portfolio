// ─────────────────────────────────────────────────────────────────────────────
// Debug hooks on window.__woodland — used by scripts/shots.mjs (screenshots,
// console-error checks) and handy in the browser console.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { SPOTS } from './world/layout.js';
import { getHeight } from './world/ground.js';

/** Named camera views for screenshots: every spot, plus '<spot>-wide' and '<spot>-close' variants. */
export function buildViews() {
  const views = {
    overview: { position: [0, 34, 52], target: [0, 4, -2] },
    top: { position: [0, 70, 6], target: [0, 0, 0] },
  };
  for (const s of SPOTS) {
    const p = s.camera.position, t = s.camera.target;
    views[s.id] = { position: p, target: t };
    const lerpTo = (k) => [t[0] + (p[0] - t[0]) * k, t[1] + (p[1] - t[1]) * k, t[2] + (p[2] - t[2]) * k];
    views[`${s.id}-wide`] = { position: lerpTo(1.8), target: t };
    views[`${s.id}-close`] = { position: lerpTo(0.55), target: s.focus ?? t };
  }
  return views;
}

export function installDebug(ctx) {
  const views = buildViews();
  const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const api = {
    views,
    view(nameOrDef) {
      const def = typeof nameOrDef === 'string' ? views[nameOrDef] : nameOrDef;
      if (!def) throw new Error(`unknown view ${nameOrDef}; known: ${Object.keys(views).join(', ')}`);
      ctx.cameraRig.setOverride(v3(def.position), v3(def.target));
      return def;
    },
    free() {
      ctx.cameraRig.clearOverride();
    },
    setNight(on) {
      ctx.env.setNight(!!on, true);
    },
    /** Glide (or jump with instant=true) to a spot like a visitor would. */
    goTo(id, instant = true) {
      ctx.cameraRig.clearOverride();
      return ctx.cameraRig.goTo(id, { instant });
    },
    openEntry(id) {
      ctx.ui.openEntry(id);
    },
    closePanel() {
      ctx.ui.closePanel();
    },
    /** All hotspots with their projected screen positions. */
    hotspots() {
      const v = new THREE.Vector3();
      return ctx.interactions.hotspots.map((h) => {
        h.worldPosition(v);
        const world = { x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) };
        v.project(ctx.camera);
        return {
          id: h.id, label: h.label, area: h.area, entryId: h.entryId ?? null, world,
          screen: { x: Math.round(((v.x + 1) / 2) * innerWidth), y: Math.round(((1 - v.y) / 2) * innerHeight), visible: v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 },
        };
      });
    },
    activateHotspot(idOrLabel) {
      const h = ctx.interactions.hotspots.find((x) => x.id === idOrLabel || x.label === idOrLabel || x.entryId === idOrLabel);
      if (!h) throw new Error(`no hotspot ${idOrLabel}`);
      ctx.interactions.activate(h);
      return h.label;
    },
    /**
     * Advance n frames with a fixed timestep (the loop is paused in ?shots mode).
     * Only the last frame is rendered unless renderAll is true.
     */
    step(n = 1, dt = 1 / 60, renderAll = false) {
      for (let i = 0; i < n; i++) ctx.engine.step(dt, renderAll || i === n - 1);
    },
    stats() {
      const info = ctx.engine.renderer.info;
      let meshes = 0, instanced = 0, tris = 0;
      ctx.scene.traverse((o) => {
        if (o.isInstancedMesh) instanced++;
        else if (o.isMesh) meshes++;
      });
      tris = info.render.triangles;
      return {
        drawCalls: info.render.calls,
        triangles: tris,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length,
        meshes,
        instanced,
        materials: ctx.materials.count,
        colliders: ctx.colliders.shapes.length,
        hotspots: ctx.interactions.hotspots.length,
        build: ctx.buildReport,
        quality: ctx.engine.quality.tier,
      };
    },
    groundHeight: getHeight,
  };
  window.__woodland = { ctx, debug: api, ready: false };
  return api;
}
