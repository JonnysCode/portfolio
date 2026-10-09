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
    // the intro's eye-level moment on the main path (cameraRig INTRO): tiny among the giants
    eyelevel: { position: [0.1, 1.45, 21.2], target: [0, 6.9, -4], fov: 43 },
  };
  for (const s of SPOTS) {
    const p = s.camera.position, t = s.camera.target;
    views[s.id] = { position: p, target: t };
    const lerpTo = (k) => [t[0] + (p[0] - t[0]) * k, t[1] + (p[1] - t[1]) * k, t[2] + (p[2] - t[2]) * k];
    views[`${s.id}-wide`] = { position: lerpTo(1.8), target: t };
    views[`${s.id}-close`] = s.close ?? { position: lerpTo(0.55), target: s.focus ?? t };
    if (s.portrait) views[`${s.id}-portrait`] = { position: s.portrait.position ?? p, target: s.portrait.target ?? t, fov: s.portrait.fov ?? (s.camera.fov ?? 40) + 5 };
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
      // (every composed shot is 40° unless it says otherwise: a portrait view must not leak its lens into the next)
      const fov = def.fov ?? 40;
      if (ctx.camera.fov !== fov) {
        ctx.camera.fov = fov;
        ctx.camera.updateProjectionMatrix();
      }
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
      const r = ctx.engine.renderer.domElement.getBoundingClientRect();
      return ctx.interactions.hotspots.map((h) => {
        h.worldPosition(v);
        const world = { x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) };
        v.project(ctx.camera);
        return {
          id: h.id, label: h.label, area: h.area, entryId: h.entryId ?? null, world,
          screen: { x: Math.round(r.left + ((v.x + 1) / 2) * r.width), y: Math.round(r.top + ((1 - v.y) / 2) * r.height), visible: v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 },
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
    /**
     * Experience flows (screenshots of the real UI): glide like a visitor and
     * advance the clock until the camera has landed (renders only the last frame).
     *   --eval "__woodland.debug.glide('bikes')" --views free --ui
     */
    glide(id, maxFrames = 600) {
      ctx.cameraRig.clearOverride();
      ctx.cameraRig.goTo(id);
      return api.settle(maxFrames);
    },
    /**
     * Fly the intro (cameraRig.playIntro) and stop the clock `sec` seconds in —
     * e.g. --eval "__woodland.debug.intro(7)" --views free (eye level on the path).
     */
    intro(sec = 7) {
      const rig = ctx.cameraRig;
      rig.clearOverride();
      rig.holdIntro();
      ctx.engine.step(1 / 60, false);
      rig.playIntro();
      const n = Math.max(1, Math.round(sec * 60));
      for (let i = 0; i < n; i++) ctx.engine.step(1 / 60, i === n - 1);
      return ctx.camera.position.toArray().map((x) => +x.toFixed(2));
    },
    /** Step the clock until no camera glide is running; returns the frames stepped. */
    settle(maxFrames = 600) {
      let i = 0;
      while (ctx.cameraRig.transitioning && i++ < maxFrames) ctx.engine.step(1 / 60, false);
      ctx.engine.step(1 / 60, true);
      return i;
    },
    /** Real-time wait (lets CSS transitions finish) — await it inside --eval. */
    wait(ms = 700) {
      return new Promise((r) => setTimeout(r, ms));
    },
    /** Open the UI's modals: 'guide' | 'map' | 'help'. */
    open(what) {
      if (what === 'map') ctx.ui.showMap();
      else if (what === 'help') ctx.ui.showHelp();
      else ctx.ui.showGuidebook();
    },
    /** Where the experience is right now. */
    state() {
      const rig = ctx.cameraRig;
      return {
        spot: rig.spot, focused: rig.focused, transitioning: rig.transitioning, focusDistance: +rig.focusDistance.toFixed(2),
        camera: ctx.camera.position.toArray().map((x) => +x.toFixed(2)), panel: ctx.ui.isPanelOpen, modal: ctx.ui.isModalOpen,
        secrets: ctx.interactions.secrets?.(), progress: ctx.interactions.progress?.(),
      };
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
