// ─────────────────────────────────────────────────────────────────────────────
// Interactions — clickable hotspots, their affordances, and ground clicks.
//
// • Markers: a gently bobbing golden sparkle floats above every hotspot near
//   the player (one Points draw call for all of them). Visited exhibits turn
//   into a little green leaf. Hidden while that hotspot's panel is open.
// • Hover (mouse): pointer cursor, tooltip, a soft pulsing ring under the
//   object and a springy "boing" of the hotspot root (scale restored exactly).
// • Proximity: standing within ~2.5 units shows ui.showPrompt('E · label');
//   E / Enter / Space activates. Touch: tap the object (or its sparkle).
// • Ground: tap/click → onGroundClick listeners (the player walks there);
//   press & hold → the player walks towards the pointer while held.
//
//   const h = ctx.interactions.add(object3d, { entryId, label, onActivate, area, markerHeight, focus, approach })
//   ctx.interactions.remove(h)          ctx.interactions.activate(h)
//   ctx.interactions.onGroundClick((point, event) => …)   // point: THREE.Vector3 on the terrain
//   ctx.interactions.hotspots / hovered / nearest
//   ctx.interactions.activateNearest()  ctx.interactions.pickGround()  ctx.interactions.pickHotspot()
//   ctx.interactions.refreshBounds(h)   (call if a hotspot object changes size a lot)
//   ctx.interactions.progress() → { visited, total }   ctx.interactions.onVisit(fn(h, progress))
//   ctx.interactions.gestures           (shared pointer gesture classifier, see gestures.js)
// Hotspot options: approach=false stops the player from walking over on click;
// markerHeight = marker height above the object's origin (default: top of its bounds + 0.55).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight } from '../world/ground.js';
import { palette } from '../core/palette.js';
import { damp } from '../core/rng.js';
import { createGestures } from './gestures.js';

const MARKER_RANGE = 14; // markers fade in within this distance of the player
const PROMPT_IN = 2.5; // proximity prompt distance (from the object's bounds)
const PROMPT_OUT = 3.1;
const VISITED_KEY = 'woodland:visited';

export function createInteractions(ctx) {
  const { engine, camera } = ctx;
  const canvas = engine.renderer.domElement;
  const isTouch = engine.isTouch;
  const reduced = engine.reducedMotion;
  const gestures = createGestures(canvas, { isTouch });
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hotspots = [];
  const groundListeners = new Set();
  const visitListeners = new Set();
  let hovered = null;
  let nearest = null;
  let openHotspot = null;
  let pointerDirty = false;
  let pointerInside = false;
  let pointerX = 0, pointerY = 0;
  let steering = false;
  let nextId = 1;
  let lastPop = -1;

  const visited = loadVisited();

  // scratch
  const v = new THREE.Vector3();
  const wp = new THREE.Vector3();
  const box = new THREE.Box3();
  const sphere = new THREE.Sphere();
  const size = new THREE.Vector3();
  const bufSize = new THREE.Vector2();
  const groundPoint = new THREE.Vector3();
  const hits = [];

  // ─── markers (one Points object for every hotspot) ─────────────────────────
  let capacity = 0;
  let markerGeo = null;
  const markerMat = makeMarkerMaterial();
  const markers = new THREE.Points(new THREE.BufferGeometry(), markerMat);
  markers.name = 'hotspot-markers';
  markers.frustumCulled = false;
  markers.renderOrder = 6;
  ctx.scene.add(markers);
  function ensureCapacity(n) {
    if (n <= capacity) return;
    capacity = Math.max(64, Math.ceil(n * 1.5));
    markerGeo?.dispose();
    markerGeo = new THREE.BufferGeometry();
    const attr = (k, itemSize) => {
      const a = new THREE.BufferAttribute(new Float32Array(capacity * itemSize), itemSize);
      a.setUsage(THREE.DynamicDrawUsage);
      markerGeo.setAttribute(k, a);
    };
    attr('position', 3);
    attr('aAlpha', 1);
    attr('aSize', 1);
    attr('aPhase', 1);
    attr('aKind', 1);
    markers.geometry = markerGeo;
  }
  ensureCapacity(64);

  // ─── hover / proximity ring ────────────────────────────────────────────────
  const ringMat = makeRingMaterial();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 1.0, 56, 1), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.name = 'hotspot-ring';
  ring.renderOrder = 3;
  ring.visible = false;
  ctx.scene.add(ring);
  let ringFor = null;
  let ringAlpha = 0;
  let ringRadius = 1;

  // ─── bounds ────────────────────────────────────────────────────────────────
  function computeBounds(h) {
    const o = h.object;
    o.updateWorldMatrix(true, true);
    o.getWorldPosition(wp);
    box.setFromObject(o);
    if (box.isEmpty()) {
      h.bounds = { cx: 0, cy: 0.5, cz: 0, hx: 0.5, hy: 0.5, hz: 0.5, r: 0.7, top: 1, bottom: 0 };
      return h.bounds;
    }
    box.getCenter(v);
    box.getSize(size);
    box.getBoundingSphere(sphere);
    h.bounds = {
      cx: v.x - wp.x, cy: v.y - wp.y, cz: v.z - wp.z,
      hx: size.x / 2, hy: size.y / 2, hz: size.z / 2,
      r: sphere.radius, top: box.max.y - wp.y, bottom: box.min.y - wp.y,
    };
    return h.bounds;
  }
  const boundsOf = (h) => h.bounds ?? computeBounds(h);

  /** World-space bounds centre of a hotspot → out. */
  function centerOf(h, out) {
    const b = boundsOf(h);
    h.object.getWorldPosition(out);
    out.x += b.cx;
    out.y += b.cy;
    out.z += b.cz;
    return out;
  }

  /** XZ distance from (x, z) to the hotspot's bounds (0 inside). */
  function boundsDistance(h, x, z) {
    const b = boundsOf(h);
    h.object.getWorldPosition(wp);
    const dx = Math.max(Math.abs(x - (wp.x + b.cx)) - b.hx, 0);
    const dz = Math.max(Math.abs(z - (wp.z + b.cz)) - b.hz, 0);
    return Math.hypot(dx, dz);
  }

  // ─── picking ───────────────────────────────────────────────────────────────
  function hotspotFor(object) {
    let o = object;
    while (o) {
      if (o.userData.__hotspot) return o.userData.__hotspot;
      o = o.parent;
    }
    return null;
  }

  function setNdc(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  function isLive(h) {
    if (!h.enabled) return false;
    let o = h.object;
    while (o) {
      if (!o.visible) return false;
      o = o.parent;
    }
    return !!h.object.parent;
  }

  /** Raycast hotspots (cheap bounding-sphere prefilter, then exact meshes). */
  function pickHotspot() {
    raycaster.setFromCamera(ndc, camera);
    let best = null;
    for (const h of hotspots) {
      if (!h.enabled) continue;
      centerOf(h, sphere.center);
      sphere.radius = boundsOf(h).r;
      if (!raycaster.ray.intersectsSphere(sphere)) continue;
      hits.length = 0;
      raycaster.intersectObject(h.object, true, hits);
      for (const hit of hits) {
        if (!hit.object.visible || hit.object.isPoints || hit.object.isSprite || hit.object.isLine) continue;
        if (!best || hit.distance < best.distance) best = { hotspot: hotspotFor(hit.object) ?? h, point: hit.point.clone(), distance: hit.distance };
        break;
      }
    }
    if (best && !isLive(best.hotspot)) best = null;
    return best;
  }

  /** Screen-space test against the floating sparkles (and, on touch, a generous radius around objects). */
  function pickMarker(clientX, clientY, generous) {
    const r = canvas.getBoundingClientRect();
    let best = null, bestD = Infinity;
    for (const h of hotspots) {
      if (!h.enabled || (h.__alpha ?? 0) < 0.25) continue;
      markerWorld(h, v);
      const dist = v.distanceTo(camera.position);
      v.project(camera);
      if (v.z > 1) continue;
      const sx = r.left + ((v.x + 1) / 2) * r.width, sy = r.top + ((1 - v.y) / 2) * r.height;
      const px = (h.__size * markerScale()) / Math.max(dist, 0.1) / (engine.renderer.getPixelRatio() || 1);
      const reach = px * 0.45 + (generous ? 22 : 8);
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < reach && d < bestD) {
        bestD = d;
        best = h;
      }
    }
    if (best || !generous) return best;
    // touch: forgive near-misses around small objects
    for (const h of hotspots) {
      if (!h.enabled) continue;
      centerOf(h, v);
      v.project(camera);
      if (v.z > 1) continue;
      const sx = r.left + ((v.x + 1) / 2) * r.width, sy = r.top + ((1 - v.y) / 2) * r.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < 34 && d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  /** Ray-march the terrain. Returns a world point or null. */
  function pickGround(out = new THREE.Vector3()) {
    raycaster.setFromCamera(ndc, camera);
    const { origin, direction } = raycaster.ray;
    let prev = 0;
    const p = out;
    for (let t = 0.5; t < 400; t += 0.5) {
      p.copy(direction).multiplyScalar(t).add(origin);
      if (p.y <= getHeight(p.x, p.z)) {
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

  // ─── hover ─────────────────────────────────────────────────────────────────
  function setHovered(h) {
    if (hovered === h) return;
    hovered = h;
    canvas.style.cursor = h ? 'pointer' : '';
    if (h) {
      ctx.ui?.showTooltip?.(h.label ?? '', h);
      ctx.ui?.moveTooltip?.(pointerX, pointerY);
      bounce(h);
      if (engine.elapsed - lastPop > 0.3) ctx.audio?.play?.('pop');
      lastPop = engine.elapsed;
    } else ctx.ui?.hideTooltip?.();
  }

  // springy "boing" on the hotspot root; restores the exact original scale
  const bouncing = new Set();
  function bounce(h) {
    if (reduced || boundsOf(h).r > 3.6) return;
    if (!h.__bounce) h.__bounce = { base: h.object.scale.clone(), t: 0 };
    else h.__bounce.t = 0;
    bouncing.add(h);
  }
  function updateBounces(dt) {
    for (const h of bouncing) {
      const b = h.__bounce;
      b.t += dt;
      const s = 1 + 0.075 * Math.sin(b.t * 19) * Math.exp(-b.t * 6.5);
      if (b.t > 0.9) {
        h.object.scale.copy(b.base);
        h.__bounce = null;
        bouncing.delete(h);
      } else h.object.scale.set(b.base.x * s, b.base.y * (2 - s), b.base.z * s);
    }
  }

  // ─── pointer gestures ──────────────────────────────────────────────────────
  canvas.addEventListener('pointermove', (e) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
    pointerDirty = true;
    pointerInside = true;
    ctx.ui?.moveTooltip?.(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerleave', () => {
    pointerInside = false;
    setHovered(null);
  });
  gestures.on('dragstart', () => setHovered(null));
  gestures.on('tap', ({ x, y, pointerType, event }) => {
    setNdc(x, y);
    const touchy = pointerType !== 'mouse';
    const hit = pickHotspot();
    const h = hit?.hotspot ?? pickMarker(x, y, touchy);
    if (h) {
      if (touchy) bounce(h);
      api.activate(h, { source: 'pointer' });
      return;
    }
    // tapping the world beside an open panel closes it (instead of wandering off)
    if (ctx.ui?.isPanelOpen) {
      ctx.ui.closePanel?.();
      return;
    }
    const g = pickGround(groundPoint);
    if (g) for (const fn of groundListeners) fn(g.clone(), event);
  });
  gestures.on('hold', ({ x, y }) => {
    setNdc(x, y);
    if (pickHotspot()) return;
    steering = true;
    setHovered(null);
  });
  gestures.on('holdend', () => {
    if (!steering) return;
    steering = false;
    ctx.player?.steerEnd?.();
  });

  // ─── keyboard: activate the nearest hotspot ───────────────────────────────
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyE' && e.code !== 'Enter' && e.code !== 'Space' && e.code !== 'NumpadEnter') return;
    const t = e.target;
    if (t instanceof HTMLElement && t !== document.body && t.closest('button, a, input, textarea, select, [contenteditable], [role="dialog"]')) return;
    if (!nearest || ctx.ui?.isPanelOpen || ctx.player?.riding || e.repeat) return;
    e.preventDefault();
    api.activate(nearest, { source: 'key' });
  });

  // ─── per-frame ─────────────────────────────────────────────────────────────
  let promptShownFor = null;
  engine.addUpdate((dt, t) => {
    const player = ctx.player;
    const ui = ctx.ui;
    const panelOpen = !!ui?.isPanelOpen;
    if (!panelOpen) openHotspot = null;

    // hold-to-walk: steer towards whatever ground is under the pointer
    if (steering && player) {
      setNdc(gestures.x, gestures.y);
      if (pickGround(groundPoint)) player.steerTowards(groundPoint.x, groundPoint.z);
    }

    // hover (mouse only; at most one pick per frame — and now and then while the
    // camera glides things under a resting pointer)
    if ((pointerDirty || engine.frame % 12 === 0) && pointerInside && !isTouch && gestures.mode === 'none') {
      pointerDirty = false;
      setNdc(pointerX, pointerY);
      const hit = pickHotspot();
      setHovered(hit ? hit.hotspot : pickMarker(pointerX, pointerY, false));
    }
    if (hovered && !isLive(hovered)) setHovered(null);

    // proximity (nearest hotspot to the player, with hysteresis)
    let near = null;
    const riding = !!player?.riding || !!ctx.transport?.busy;
    if (player && !riding) {
      let bestD = Infinity;
      const px = player.position.x, pz = player.position.z;
      for (const h of hotspots) {
        if (!h.enabled || h.prompt === false) continue;
        const d = boundsDistance(h, px, pz);
        const limit = h === nearest ? PROMPT_OUT : PROMPT_IN;
        if (d < limit && d < bestD && isLive(h)) {
          bestD = d;
          near = h;
        }
      }
    }
    nearest = near;
    const promptFor = panelOpen || riding ? null : nearest;
    if (promptFor !== promptShownFor) {
      promptShownFor = promptFor;
      if (promptFor) ui?.showPrompt?.(`${isTouch ? 'Tap' : 'E'} · ${promptFor.label}`, promptFor);
      else ui?.hidePrompt?.();
    }

    updateMarkers(dt, t, player, panelOpen, riding);
    updateRing(dt, t, panelOpen);
    updateBounces(dt);
  }, 2);

  function markerWorld(h, out) {
    const b = boundsOf(h);
    h.object.getWorldPosition(out);
    out.x += b.cx;
    out.z += b.cz;
    out.y += h.markerHeight !== undefined ? h.markerHeight : b.top + 0.55;
    return out;
  }

  function markerScale() {
    engine.renderer.getDrawingBufferSize(bufSize);
    return bufSize.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
  }

  function updateMarkers(dt, t, player, panelOpen, riding) {
    ensureCapacity(hotspots.length);
    const pos = markerGeo.attributes.position.array;
    const alpha = markerGeo.attributes.aAlpha.array;
    const sizeA = markerGeo.attributes.aSize.array;
    const phase = markerGeo.attributes.aPhase.array;
    const kind = markerGeo.attributes.aKind.array;
    const k = damp(5, dt);
    let n = 0;
    for (const h of hotspots) {
      if (h.marker === false) continue;
      let want = 0;
      if (player && h.enabled && !riding && !(panelOpen && h === openHotspot)) {
        h.object.getWorldPosition(wp);
        const b = boundsOf(h);
        const d = Math.hypot(wp.x + b.cx - player.position.x, wp.z + b.cz - player.position.z) - Math.max(b.hx, b.hz) * 0.5;
        want = d < MARKER_RANGE - 3 ? 1 : d < MARKER_RANGE ? (MARKER_RANGE - d) / 3 : 0;
        if (want > 0 && !isLive(h)) want = 0;
      }
      h.__alpha = (h.__alpha ?? 0) + (want - (h.__alpha ?? 0)) * k;
      if (h.__alpha < 0.01) continue;
      const isVisited = h.entryId ? visited.has(h.entryId) : false;
      const hot = h === hovered || h === nearest;
      const targetSize = (isVisited ? 0.62 : 1.0) * (hot ? 1.25 : 1);
      h.__size = (h.__size ?? targetSize) + (targetSize - (h.__size ?? targetSize)) * damp(8, dt);
      markerWorld(h, v);
      pos[n * 3] = v.x;
      pos[n * 3 + 1] = v.y;
      pos[n * 3 + 2] = v.z;
      alpha[n] = h.__alpha * (isVisited ? 0.85 : 1);
      sizeA[n] = h.__size;
      phase[n] = (h.id * 1.618) % (Math.PI * 2);
      kind[n] = isVisited ? 1 : 0;
      n++;
    }
    markerGeo.setDrawRange(0, n);
    for (const key of ['position', 'aAlpha', 'aSize', 'aPhase', 'aKind']) markerGeo.attributes[key].needsUpdate = n > 0;
    markers.visible = n > 0;
    markerMat.uniforms.uTime.value = reduced ? 0 : t;
    markerMat.uniforms.uScale.value = markerScale();
  }

  function updateRing(dt, t, panelOpen) {
    const want = panelOpen ? null : hovered ?? nearest;
    if (want && want !== ringFor) {
      ringFor = want;
      const b = boundsOf(want);
      ringRadius = Math.max(0.7, Math.max(b.hx, b.hz) * 1.08 + 0.25);
      ringAlpha = Math.min(ringAlpha, 0.2);
    }
    const target = want ? (want === hovered ? 1 : 0.7) : 0;
    ringAlpha += (target - ringAlpha) * damp(want ? 9 : 6, dt);
    if (ringAlpha < 0.01 || !ringFor) {
      ring.visible = false;
      if (!want) ringFor = null;
      return;
    }
    const b = boundsOf(ringFor);
    ringFor.object.getWorldPosition(wp);
    const x = wp.x + b.cx, z = wp.z + b.cz;
    let gy = getHeight(x, z);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      gy = Math.max(gy, getHeight(x + Math.cos(a) * ringRadius, z + Math.sin(a) * ringRadius));
    }
    const baseY = Math.max(gy, wp.y + b.bottom);
    ring.position.set(x, baseY + 0.05, z);
    const pop = 1 + 0.08 * Math.sin(t * 3.2);
    ring.scale.setScalar(ringRadius * (reduced ? 1 : pop));
    ringMat.uniforms.uAlpha.value = ringAlpha * (1 - 0.35 * (ctx.env?.night ?? 0));
    ringMat.uniforms.uTime.value = t;
    ring.visible = true;
  }

  const api = {
    hotspots,
    gestures,
    get hovered() {
      return hovered;
    },
    /** The hotspot the player is standing next to (proximity prompt), or null. */
    get nearest() {
      return nearest;
    },
    /** True while the visitor is press-and-hold steering the player. */
    get steering() {
      return steering;
    },
    /**
     * Register a clickable object.
     * @param {THREE.Object3D} object
     * @param {{entryId?:string, label?:string, area?:string, onActivate?:(h:any)=>void,
     *          markerHeight?:number, focus?:{distance?:number, height?:number}, enabled?:boolean,
     *          approach?:boolean, marker?:boolean, prompt?:boolean}} opts
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
        bounds: null,
        get visited() {
          return h.entryId ? visited.has(h.entryId) : false;
        },
        worldPosition(target = new THREE.Vector3()) {
          return object.getWorldPosition(target);
        },
        /** Centre of the object's bounds in world space. */
        center(target = new THREE.Vector3()) {
          return centerOf(h, target);
        },
      };
      object.userData.__hotspot = h;
      hotspots.push(h);
      return h;
    },
    remove(h) {
      const i = hotspots.indexOf(h);
      if (i >= 0) hotspots.splice(i, 1);
      if (h.__bounce) {
        h.object.scale.copy(h.__bounce.base);
        h.__bounce = null;
        bouncing.delete(h);
      }
      delete h.object.userData.__hotspot;
      if (hovered === h) setHovered(null);
      if (nearest === h) nearest = null;
      if (ringFor === h) ringFor = null;
    },
    /** opts.source: 'pointer' (walk over), 'key' (turn to look) or undefined (programmatic). */
    activate(h, { source } = {}) {
      if (!h?.enabled) return;
      ctx.audio?.play?.('click');
      openHotspot = h;
      const player = ctx.player;
      if (player && !player.riding && !ctx.transport?.busy) {
        centerOf(h, v);
        const b = boundsOf(h);
        const d = Math.hypot(v.x - player.position.x, v.z - player.position.z);
        if (source === 'pointer' && h.approach !== false && d > Math.max(b.hx, b.hz) + 3 && d < 45) {
          player.approach(v.x, v.z, { distance: Math.max(b.hx, b.hz) + 1.1 });
        } else if (source) player.face(v.x, v.z);
      }
      if (h.entryId && !visited.has(h.entryId)) {
        visited.add(h.entryId);
        saveVisited(visited);
        const p = api.progress();
        for (const fn of visitListeners) fn(h, p);
      }
      if (h.onActivate) h.onActivate(h);
      else if (h.entryId) ctx.ui?.openEntry?.(h.entryId, { hotspot: h });
    },
    activateNearest() {
      if (nearest) api.activate(nearest, { source: 'key' });
      return nearest;
    },
    onGroundClick(fn) {
      groundListeners.add(fn);
      return () => groundListeners.delete(fn);
    },
    /** fn(hotspot, { visited, total }) when an entry is opened for the first time. */
    onVisit(fn) {
      visitListeners.add(fn);
      return () => visitListeners.delete(fn);
    },
    /** How many distinct content entries have been discovered. */
    progress() {
      const all = new Set(hotspots.filter((h) => h.entryId).map((h) => h.entryId));
      let seen = 0;
      for (const id of all) if (visited.has(id)) seen++;
      return { visited: seen, total: all.size };
    },
    refreshBounds(h) {
      return computeBounds(h);
    },
    pickGround,
    pickHotspot,
    setPointerFromClient(x, y) {
      setNdc(x, y);
    },
  };
  return api;
}

function loadVisited() {
  try {
    const raw = localStorage.getItem(VISITED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}
function saveVisited(set) {
  try {
    localStorage.setItem(VISITED_KEY, JSON.stringify([...set]));
  } catch {
    /* private mode etc. — visited state is only a nicety */
  }
}

/** Golden four-point sparkle (unvisited) / little green leaf (visited) point sprites. */
function makeMarkerMaterial() {
  const c = (hex) => new THREE.Color(hex);
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 600 },
      uGold: { value: c(palette.postYellow) },
      uCore: { value: c(palette.spots) },
      uEdge: { value: c(palette.capBrown) },
      uLeaf: { value: c(palette.leafLight) },
      uLeafDark: { value: c(palette.leafDark) },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute float aSize;
      attribute float aPhase;
      attribute float aKind;
      uniform float uTime;
      uniform float uScale;
      varying float vAlpha;
      varying float vKind;
      varying float vSpin;
      void main() {
        vec3 p = position;
        p.y += sin(uTime * 2.1 + aPhase) * 0.11;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float pulse = 1.0 + 0.07 * sin(uTime * 3.3 + aPhase * 1.7);
        gl_PointSize = clamp(aSize * pulse * uScale / max(0.1, -mv.z), 0.0, 160.0);
        vAlpha = aAlpha;
        vKind = aKind;
        vSpin = aKind > 0.5 ? 0.5 + 0.25 * sin(uTime * 1.6 + aPhase) : sin(uTime * 0.9 + aPhase) * 0.35;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uGold;
      uniform vec3 uCore;
      uniform vec3 uEdge;
      uniform vec3 uLeaf;
      uniform vec3 uLeafDark;
      varying float vAlpha;
      varying float vKind;
      varying float vSpin;
      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        uv.y = -uv.y;
        float cs = cos(vSpin), sn = sin(vSpin);
        vec2 q = mat2(cs, -sn, sn, cs) * uv;
        vec3 col;
        float a;
        if (vKind < 0.5) {
          // sparkle: astroid-like four-point star with a cream core and a soft halo
          float s = pow(abs(q.x), 0.55) + pow(abs(q.y), 0.55);
          float star = 1.0 - smoothstep(0.78, 0.84, s);
          float edge = smoothstep(0.62, 0.74, s);
          float core = 1.0 - smoothstep(0.0, 0.5, length(q) * 1.8);
          col = mix(uGold, uEdge, edge * 0.85);
          col = mix(col, uCore, core);
          float r = length(uv);
          float halo = exp(-r * r * 5.0) * 0.45;
          a = max(star, halo);
          col = mix(uGold * 1.1, col, star);
        } else {
          // leaf: a lens shape with a midrib
          vec2 l = q * vec2(1.6, 1.0);
          float d = max(length(l - vec2(0.55, 0.0)), length(l + vec2(0.55, 0.0)));
          float leaf = 1.0 - smoothstep(1.0, 1.08, d);
          float edge = smoothstep(0.86, 0.98, d);
          float rib = (1.0 - smoothstep(0.0, 0.06, abs(q.x))) * step(abs(q.y), 0.75);
          col = mix(uLeaf, uLeafDark, max(edge, rib * 0.7));
          float r = length(uv);
          float halo = exp(-r * r * 6.0) * 0.25;
          a = max(leaf, halo);
          col = mix(uCore, col, leaf);
        }
        a *= vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

/** Soft glowing ring that pulses under the hovered / nearest hotspot. */
function makeRingMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAlpha: { value: 0 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(palette.windowGlow) },
      uCore: { value: new THREE.Color(palette.spots) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uCore;
      varying vec3 vPos;
      void main() {
        float r = length(vPos.xy); // 0.62 .. 1.0
        float band = 1.0 - abs((r - 0.86) / 0.13);
        band = smoothstep(0.0, 0.75, band);
        float inner = smoothstep(0.62, 0.8, r) * (1.0 - smoothstep(0.8, 0.86, r)) * 0.35;
        float ang = atan(vPos.y, vPos.x);
        float dash = 0.75 + 0.25 * sin(ang * 10.0 - uTime * 2.4);
        vec3 col = mix(uColor, uCore, smoothstep(0.5, 1.0, band));
        float a = (band * dash + inner) * uAlpha * 0.85;
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}
