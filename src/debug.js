// ─────────────────────────────────────────────────────────────────────────────
// Debug hooks on window.__woodland — used by scripts/shots.mjs (screenshots,
// console-error checks) and handy in the browser console.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { AREAS, AREA_BY_ID, POND, SPAWN } from './world/layout.js';
import { getHeight } from './world/ground.js';

function areaView(a, dist = 1.35, height = 0.75) {
  const facing = a.facing ?? 0;
  const r = a.radius;
  const dirX = Math.sin(facing), dirZ = Math.cos(facing);
  return {
    position: [a.center.x + dirX * r * dist, r * height + 2, a.center.z + dirZ * r * dist],
    target: [a.center.x, 1.5, a.center.z],
  };
}

export function buildViews() {
  const views = {
    overview: { position: [0, 95, 85], target: [0, 0, -2] },
    spawn: { position: [SPAWN.x, 9, SPAWN.z + 15], target: [SPAWN.x, 1.2, SPAWN.z] },
    pond: { position: [POND.center.x + 4, 7, POND.center.z + POND.radius + 10], target: [POND.center.x, 0, POND.center.z] },
  };
  for (const a of AREAS) {
    views[a.id] = a.id === 'plaza'
      ? { position: [0, 13, 22], target: [0, 1, 0] }
      : areaView(a);
    views[`${a.id}-close`] = a.id === 'plaza' ? { position: [0, 5, 10], target: [0, 1.5, 0] } : areaView(a, 0.75, 0.3);
    views[`${a.id}-high`] = a.id === 'plaza' ? { position: [0, 30, 18], target: [0, 0, 0] } : areaView(a, 1.1, 1.9);
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
    teleport(x, z, facing) {
      ctx.player.teleport(x, z, facing);
      ctx.cameraRig.snap();
    },
    teleportToArea(id) {
      const a = AREA_BY_ID[id];
      const facing = a.facing ?? 0;
      api.teleport(a.center.x + Math.sin(facing) * (a.radius - 4), a.center.z + Math.cos(facing) * (a.radius - 4), facing + Math.PI);
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
