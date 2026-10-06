// ─────────────────────────────────────────────────────────────────────────────
// Interactions — clickable hotspots, hover tooltips and ground clicks.
// BASELINE: functional; the systems builder will add markers, hover juice and
// proximity prompts on top of the same API.
//
//   const h = ctx.interactions.add(object3d, { entryId, label, onActivate, area })
//   ctx.interactions.onGroundClick((point) => …)   // point: THREE.Vector3 on the terrain
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight } from '../world/ground.js';

const CLICK_SLOP = 7; // px

export function createInteractions(ctx) {
  const { engine, camera } = ctx;
  const canvas = engine.renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hotspots = [];
  const roots = [];
  const groundListeners = new Set();
  let hovered = null;
  let pointerDirty = false;
  let pointerInside = false;
  let down = null;
  let nextId = 1;

  function hotspotFor(object) {
    let o = object;
    while (o) {
      if (o.userData.__hotspot) return o.userData.__hotspot;
      o = o.parent;
    }
    return null;
  }

  function setNdc(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  function pickHotspot() {
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(roots, true);
    for (const h of hits) {
      const hs = hotspotFor(h.object);
      if (hs && hs.enabled && h.object.visible !== false) return { hotspot: hs, point: h.point, distance: h.distance };
    }
    return null;
  }

  /** Ray-march the analytic terrain. Returns a world point or null. */
  function pickGround() {
    raycaster.setFromCamera(ndc, camera);
    const { origin, direction } = raycaster.ray;
    let prev = 0;
    const p = new THREE.Vector3();
    for (let t = 0.5; t < 400; t += 0.5) {
      p.copy(direction).multiplyScalar(t).add(origin);
      if (p.y <= getHeight(p.x, p.z)) {
        // refine
        let lo = prev, hi = t;
        for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) / 2;
          p.copy(direction).multiplyScalar(mid).add(origin);
          if (p.y <= getHeight(p.x, p.z)) hi = mid;
          else lo = mid;
        }
        p.copy(direction).multiplyScalar(hi).add(origin);
        p.y = getHeight(p.x, p.z);
        return p;
      }
      prev = t;
    }
    return null;
  }

  function setHovered(h) {
    if (hovered === h) return;
    hovered = h;
    canvas.style.cursor = h ? 'pointer' : '';
    if (h) ctx.ui?.showTooltip?.(h.label ?? '', h);
    else ctx.ui?.hideTooltip?.();
  }

  canvas.addEventListener('pointermove', (e) => {
    setNdc(e);
    pointerDirty = true;
    pointerInside = true;
    ctx.ui?.moveTooltip?.(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerleave', () => {
    pointerInside = false;
    setHovered(null);
  });
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const isClick = moved < CLICK_SLOP && down.button === 0;
    down = null;
    if (!isClick) return;
    setNdc(e);
    const hit = pickHotspot();
    if (hit) {
      api.activate(hit.hotspot);
      return;
    }
    const g = pickGround();
    if (g) for (const fn of groundListeners) fn(g, e);
  });

  engine.addUpdate(() => {
    if (!pointerDirty || !pointerInside || engine.isTouch) return;
    pointerDirty = false;
    const hit = pickHotspot();
    setHovered(hit ? hit.hotspot : null);
  }, 1);

  const api = {
    hotspots,
    get hovered() {
      return hovered;
    },
    /**
     * Register a clickable object.
     * @param {THREE.Object3D} object
     * @param {{entryId?:string, label?:string, area?:string, onActivate?:(h:any)=>void,
     *          markerHeight?:number, focus?:{distance?:number, height?:number}, enabled?:boolean}} opts
     */
    add(object, opts = {}) {
      const entry = opts.entryId ? ctx.content.getEntry(opts.entryId) : null;
      const h = {
        ...opts,
        id: nextId++,
        object,
        enabled: opts.enabled ?? true,
        label: opts.label ?? entry?.title ?? object.name ?? '',
        summary: opts.summary ?? entry?.summary ?? '',
        worldPosition(target = new THREE.Vector3()) {
          return object.getWorldPosition(target);
        },
      };
      object.userData.__hotspot = h;
      hotspots.push(h);
      roots.push(object);
      return h;
    },
    remove(h) {
      const i = hotspots.indexOf(h);
      if (i >= 0) hotspots.splice(i, 1);
      const j = roots.indexOf(h.object);
      if (j >= 0) roots.splice(j, 1);
      delete h.object.userData.__hotspot;
      if (hovered === h) setHovered(null);
    },
    activate(h) {
      if (!h?.enabled) return;
      ctx.audio?.play?.('click');
      if (h.onActivate) h.onActivate(h);
      else if (h.entryId) ctx.ui?.openEntry?.(h.entryId, { hotspot: h });
    },
    onGroundClick(fn) {
      groundListeners.add(fn);
      return () => groundListeners.delete(fn);
    },
    pickGround,
    pickHotspot,
    setPointerFromClient(x, y) {
      setNdc({ clientX: x, clientY: y });
    },
  };
  return api;
}
