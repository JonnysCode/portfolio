// ─────────────────────────────────────────────────────────────────────────────
// Interactions — clickable hotspots and their affordances. There is no player
// any more: the visitor explores by gliding the camera between spots
// (cameraRig.js) and clicking the little things they discover.
//
// • Markers: gently bobbing golden sparkles (one Points draw call for all)
//   float above the hotspots of the CURRENT spot; in the 'glen' overview only
//   the featured pieces get a small one. Visited entries turn into a little
//   leaf. Markers pop in one by one after the camera lands and hide while
//   their panel is open.
// • Secrets (opts.kind === 'secret'): no marker at all — hovering one makes a
//   pale sparkle appear; activating it the first time counts towards the
//   "secrets found x/y" discovery counter (chime + toast).
// • Hover (mouse): pointer cursor, tooltip (label + summary), a soft pulsing
//   ring under the object and a springy "boing" (scale restored exactly).
// • Touch: tap the object (or near its sparkle — generous radius).
// • Keyboard: the UI renders real <button>s for the current spot's hotspots
//   (forSpot / screenPosition / setFocused) — Tab through them, Enter opens.
//
//   const h = ctx.interactions.add(object3d, { entryId, label, summary, onActivate, area, kind,
//                                              markerHeight, focus, enabled, marker })
//   ctx.interactions.remove(h)          ctx.interactions.activate(h)
//   ctx.interactions.hotspots / hovered / focused / nearest (= focused)
//   ctx.interactions.forSpot(spotId)    ctx.interactions.findByEntry(entryId)
//   ctx.interactions.screenPosition(h, out?) → { x, y, visible }
//   ctx.interactions.setFocused(h | null)   (keyboard focus ring + tooltip)
//   ctx.interactions.setOpen(h | null) / markVisited(entryId) / isVisited(entryId)   (UI bookkeeping)
//   ctx.interactions.progress() → { visited, total }   ctx.interactions.onVisit(fn(h, progress))
//   ctx.interactions.secrets() → { found, total }      ctx.interactions.onSecret(fn(h, secrets, isNew))
//   ctx.interactions.onGroundClick((point, event) => …)  (tap on empty ground)
//   ctx.interactions.pickGround() / pickHotspot() / setPointerFromClient(x, y)
//   ctx.interactions.refreshBounds(h)   (call if a hotspot object changes size a lot)
//   ctx.interactions.gestures           (shared pointer gesture classifier, pointerGestures.js)
// Hotspot options: focus = { distance, height, azimuth, polar } for the camera
// when its entry opens; markerHeight = marker height above the object's origin
// (default: top of its bounds + 0.45); marker = false hides the sparkle.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight } from '../world/ground.js';
import { SPOT_BY_ID } from '../world/layout.js';
import { palette } from '../core/palette.js';
import { damp } from '../core/rng.js';
import { createPointerGestures } from './pointerGestures.js';

const VISITED_KEY = 'woodland:visited';
const SECRETS_KEY = 'woodland:secrets';

/** Marker kinds (shader). */
const K_SPARKLE = 0, K_LEAF = 1, K_SECRET = 2;

export function createInteractions(ctx) {
  const { engine, camera } = ctx;
  const canvas = engine.renderer.domElement;
  const isTouch = engine.isTouch;
  const reduced = engine.reducedMotion;
  const gestures = createPointerGestures(canvas);
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hotspots = [];
  const groundListeners = new Set();
  const visitListeners = new Set();
  const secretListeners = new Set();
  let hovered = null;
  let focused = null; // keyboard focus
  let openHotspot = null;
  let pointerDirty = false;
  let pointerInside = false;
  let pointerX = 0, pointerY = 0;
  let nextId = 1;
  let lastPop = -1;
  let lastPick = -99;
  let canvasRect = canvas.getBoundingClientRect();
  // markers pop in one by one after the camera lands
  let settledAt = 0;
  let wasMoving = false;
  let lastSpot = null;

  const visited = loadSet(VISITED_KEY);
  const secretsFound = loadSet(SECRETS_KEY);

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
    capacity = Math.max(48, Math.ceil(n * 1.5));
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
  ensureCapacity(48);

  // ─── hover / focus ring ────────────────────────────────────────────────────
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

  function markerWorld(h, out) {
    const b = boundsOf(h);
    h.object.getWorldPosition(out);
    out.x += b.cx;
    out.z += b.cz;
    out.y += h.markerHeight !== undefined ? h.markerHeight : b.top + 0.45;
    return out;
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

  function markerScale() {
    engine.renderer.getDrawingBufferSize(bufSize);
    return bufSize.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
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
      const pr = engine.renderer.getPixelRatio() || 1;
      const px = Math.min(84 * pr, Math.max(24 * (h.__size ?? 1) * pr, ((h.__size ?? 1) * markerScale() * 0.75) / Math.max(dist, 0.1))) / pr;
      const reach = px * 0.5 + (generous ? 22 : 6);
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < reach && d < bestD) {
        bestD = d;
        best = h;
      }
    }
    if (best || !generous) return best;
    // touch: forgive near-misses around small objects (secrets need a closer tap)
    for (const h of hotspots) {
      if (!isLive(h)) continue;
      centerOf(h, v);
      v.project(camera);
      if (v.z > 1) continue;
      const sx = r.left + ((v.x + 1) / 2) * r.width, sy = r.top + ((1 - v.y) / 2) * r.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      const reach = h.kind === 'secret' ? 20 : 34;
      if (d < reach && d < bestD) {
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
      if (engine.elapsed - lastPop > 0.3) ctx.audio?.play?.(h.kind === 'secret' ? 'twinkle' : 'pop');
      lastPop = engine.elapsed;
    } else if (!focused) ctx.ui?.hideTooltip?.();
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
    if (hovered) ctx.ui?.moveTooltip?.(e.clientX, e.clientY);
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
    // tapping the world beside an open panel closes it
    if (ctx.ui?.isPanelOpen) {
      ctx.ui.closePanel?.();
      return;
    }
    const g = pickGround(groundPoint);
    if (g) for (const fn of groundListeners) fn(g.clone(), event);
  });

  // ─── which markers show where ─────────────────────────────────────────────
  const featuredSeen = new Set();
  function isFeatured(h) {
    return !!(h.entryId && ctx.content?.getEntry?.(h.entryId)?.featured);
  }

  // ─── per-frame ─────────────────────────────────────────────────────────────
  engine.addUpdate((dt, t) => {
    canvasRect = canvas.getBoundingClientRect(); // once per frame (no layout thrash in the UI loop)
    const ui = ctx.ui;
    const panelOpen = !!ui?.isPanelOpen;
    if (!panelOpen) openHotspot = null;
    const rig = ctx.cameraRig;
    const moving = !!rig?.transitioning;
    const spot = rig?.spot ?? null;
    if (spot !== lastSpot) {
      lastSpot = spot;
      settledAt = Infinity;
    }
    if (moving) settledAt = Infinity;
    else if (wasMoving || settledAt === Infinity) settledAt = t;
    wasMoving = moving;

    // hover (mouse only; at most one pick per frame — and now and then while the
    // camera glides things under a resting pointer)
    const f = engine.frame;
    if (((pointerDirty && f - lastPick >= 2) || f - lastPick >= 12) && pointerInside && !isTouch && gestures.mode === 'none') {
      pointerDirty = false;
      lastPick = f;
      // the pointer may rest on a panel or button that slid over the canvas
      const top = document.elementFromPoint(pointerX, pointerY);
      if (top && top !== canvas) setHovered(null);
      else {
        setNdc(pointerX, pointerY);
        const hit = pickHotspot();
        setHovered(hit ? hit.hotspot : pickMarker(pointerX, pointerY, false));
      }
    }
    if (hovered && !isLive(hovered)) setHovered(null);
    if (focused && !isLive(focused)) api.setFocused(null);

    updateMarkers(dt, t, spot, moving, panelOpen);
    updateRing(dt, t, panelOpen);
    updateBounces(dt);
  }, 2);

  function updateMarkers(dt, t, spot, moving, panelOpen) {
    ensureCapacity(hotspots.length);
    const pos = markerGeo.attributes.position.array;
    const alpha = markerGeo.attributes.aAlpha.array;
    const sizeA = markerGeo.attributes.aSize.array;
    const phase = markerGeo.attributes.aPhase.array;
    const kind = markerGeo.attributes.aKind.array;
    const kUp = damp(6, dt), kDown = damp(10, dt);
    const sinceLanding = t - settledAt;
    featuredSeen.clear();
    let n = 0, order = 0;
    for (const h of hotspots) {
      if (h.marker === false) continue;
      let want = 0;
      let targetSize = 1;
      let k = K_SPARKLE;
      const isSecret = h.kind === 'secret';
      const isVisited = h.entryId ? visited.has(h.entryId) : false;
      if (!h.enabled) want = 0;
      else if (isSecret) {
        // secrets never advertise themselves: a pale sparkle only while hovered
        want = h === hovered || t < (h.__sparkUntil ?? 0) ? 1 : 0;
        targetSize = 0.8;
        k = K_SECRET;
      } else if (panelOpen && h === openHotspot) want = 0;
      else if (moving) want = 0;
      else {
        if (h.area && h.area === spot && (h.entryId || !h.onActivate)) {
          want = panelOpen ? 0.4 : 1;
          targetSize = isVisited ? 0.66 : 1;
        } else if (spot === 'glen' && isFeatured(h) && !featuredSeen.has(h.entryId)) {
          featuredSeen.add(h.entryId);
          want = 0.9;
          targetSize = 0.8;
        } else if (!h.entryId && h.onActivate && h.area !== spot && spot !== 'glen') {
          // little "action" hotspots (the snail lift) beckon from neighbouring spots nearby
          h.object.getWorldPosition(wp);
          if (wp.distanceTo(camera.position) < 24) {
            want = 0.8;
            targetSize = 0.7;
          }
        }
        if (want > 0) {
          // pop in one after another once the camera has landed
          const delay = 0.2 + order * 0.11;
          order++;
          if (sinceLanding < delay) want = 0;
          if (want > 0 && !isLive(h)) want = 0;
        }
        k = isVisited ? K_LEAF : K_SPARKLE;
      }
      const hot = h === hovered || h === focused;
      if (hot && !isSecret) targetSize *= 1.25;
      const a0 = h.__alpha ?? 0;
      h.__alpha = a0 + (want - a0) * (want > a0 ? kUp : kDown);
      if (h.__alpha < 0.01) continue;
      h.__size = (h.__size ?? targetSize) + (targetSize - (h.__size ?? targetSize)) * damp(8, dt);
      markerWorld(h, v);
      pos[n * 3] = v.x;
      pos[n * 3 + 1] = v.y;
      pos[n * 3 + 2] = v.z;
      alpha[n] = h.__alpha;
      // a little overshoot as it pops in
      sizeA[n] = h.__size * (reduced ? 1 : 1 + 0.35 * Math.sin(Math.min(1, h.__alpha) * Math.PI) * (want > a0 ? 1 : 0));
      phase[n] = (h.id * 1.618) % (Math.PI * 2);
      kind[n] = k;
      n++;
    }
    markerGeo.setDrawRange(0, n);
    for (const key of ['position', 'aAlpha', 'aSize', 'aPhase', 'aKind']) markerGeo.attributes[key].needsUpdate = n > 0;
    markers.visible = n > 0;
    markerMat.uniforms.uTime.value = reduced ? 0 : t;
    markerMat.uniforms.uScale.value = markerScale();
    markerMat.uniforms.uPx.value = engine.renderer.getPixelRatio() || 1;
  }

  function updateRing(dt, t, panelOpen) {
    const want = panelOpen ? null : hovered ?? focused;
    if (want && want !== ringFor) {
      ringFor = want;
      const b = boundsOf(want);
      ringRadius = Math.max(0.45, Math.min(3.2, Math.max(b.hx, b.hz) * 1.08 + 0.2));
      ringAlpha = Math.min(ringAlpha, 0.2);
    }
    const target = want ? 1 : 0;
    ringAlpha += (target - ringAlpha) * damp(want ? 9 : 6, dt);
    if (ringAlpha < 0.01 || !ringFor) {
      ring.visible = false;
      if (!want) ringFor = null;
      return;
    }
    const b = boundsOf(ringFor);
    ringFor.object.getWorldPosition(wp);
    const x = wp.x + b.cx, z = wp.z + b.cz;
    const bottom = wp.y + b.bottom;
    let gy = getHeight(x, z);
    // things standing on the ground get the ring on the moss; things up a tree on their base
    if (bottom - gy < 1.2) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        gy = Math.max(gy, getHeight(x + Math.cos(a) * ringRadius, z + Math.sin(a) * ringRadius));
      }
    }
    const baseY = Math.max(gy, bottom);
    ring.position.set(x, baseY + 0.04, z);
    const pop = 1 + 0.08 * Math.sin(t * 3.2);
    ring.scale.setScalar(ringRadius * (reduced ? 1 : pop));
    ringMat.uniforms.uAlpha.value = ringAlpha * (ringFor.kind === 'secret' ? 0.6 : 1) * (1 - 0.3 * (ctx.env?.night ?? 0));
    ringMat.uniforms.uTime.value = t;
    ring.visible = true;
  }

  function secretKey(h) {
    return h.secretId ?? `${h.area ?? 'glen'}:${h.label ?? h.id}`;
  }

  const api = {
    hotspots,
    gestures,
    get hovered() {
      return hovered;
    },
    /** The keyboard-focused hotspot (kept as `nearest` for older callers). */
    get focused() {
      return focused;
    },
    get nearest() {
      return focused;
    },
    get steering() {
      return false;
    },
    /**
     * Register a clickable object.
     * @param {THREE.Object3D} object
     * @param {{entryId?:string, label?:string, summary?:string, area?:string, kind?:'secret',
     *          onActivate?:(h:any)=>void, markerHeight?:number,
     *          focus?:{distance?:number, height?:number, azimuth?:number, polar?:number},
     *          enabled?:boolean, marker?:boolean, secretId?:string}} opts
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
          return h.entryId ? visited.has(h.entryId) : h.kind === 'secret' ? secretsFound.has(secretKey(h)) : false;
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
      if (focused === h) focused = null;
      if (ringFor === h) ringFor = null;
    },
    /** Open a hotspot: its entry panel (camera frames it), its own action, or a secret. */
    activate(h, { source } = {}) {
      if (!h?.enabled) return;
      if (h.kind === 'secret') {
        bounce(h);
        h.__sparkUntil = engine.elapsed + 1.6; // a twinkle where it was found (touch has no hover)
        ctx.audio?.play?.('click');
        const key = secretKey(h);
        const isNew = !secretsFound.has(key);
        if (isNew) {
          secretsFound.add(key);
          saveSet(SECRETS_KEY, secretsFound);
        }
        const s = api.secrets();
        for (const fn of secretListeners) fn(h, s, isNew);
        h.onActivate?.(h);
        return;
      }
      ctx.audio?.play?.('click');
      openHotspot = h;
      if (h.entryId) api.markVisited(h.entryId);
      if (h.onActivate) h.onActivate(h, { source });
      else if (h.entryId) ctx.ui?.openEntry?.(h.entryId, { hotspot: h });
    },
    /** The UI opened this hotspot's entry by other means (guidebook, prev/next): hide its marker. */
    setOpen(h) {
      openHotspot = h ?? null;
    },
    /** Remember an entry as read (also when opened from the guidebook). */
    markVisited(entryId) {
      if (!entryId || visited.has(entryId)) return;
      visited.add(entryId);
      saveSet(VISITED_KEY, visited);
      const h = api.findByEntry(entryId);
      const p = api.progress();
      for (const fn of visitListeners) fn(h, p);
    },
    activateNearest() {
      if (focused) api.activate(focused, { source: 'key' });
      return focused;
    },
    /** The (deduplicated) non-secret hotspots presented at a spot. */
    forSpot(spotId) {
      const seen = new Set();
      const out = [];
      for (const h of hotspots) {
        if (h.kind === 'secret' || !h.enabled || h.area !== spotId) continue;
        // only things that open a journal page count here (the snail lift is a ride, not a story)
        if (!h.entryId) continue;
        const key = h.entryId ?? `#${h.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(h);
      }
      return out;
    },
    /** The first hotspot that opens an entry. */
    findByEntry(entryId) {
      return hotspots.find((h) => h.entryId === entryId && h.enabled) ?? null;
    },
    /** Screen position (client px) of a hotspot's marker anchor. */
    screenPosition(h, out = {}) {
      markerWorld(h, v);
      v.y -= 0.25;
      v.project(camera);
      const r = canvasRect;
      out.x = r.left + ((v.x + 1) / 2) * r.width;
      out.y = r.top + ((1 - v.y) / 2) * r.height;
      out.visible = v.z < 1 && Math.abs(v.x) < 1.02 && Math.abs(v.y) < 1.02;
      return out;
    },
    /** Keyboard focus: ring + sparkle highlight (the UI shows the tooltip). */
    setFocused(h) {
      if (focused === h) return;
      focused = h;
      if (h) {
        bounce(h);
        ctx.audio?.play?.('pop');
      }
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
    /** fn(hotspot, { found, total }, isNew) whenever a secret is activated. */
    onSecret(fn) {
      secretListeners.add(fn);
      return () => secretListeners.delete(fn);
    },
    /** How many distinct content entries have been discovered. */
    progress() {
      const all = new Set(hotspots.filter((h) => h.entryId).map((h) => h.entryId));
      let seen = 0;
      for (const id of all) if (visited.has(id)) seen++;
      return { visited: seen, total: all.size };
    },
    /** How many of the registered secrets have been found. */
    secrets() {
      const all = new Set(hotspots.filter((h) => h.kind === 'secret').map(secretKey));
      let found = 0;
      for (const k of all) if (secretsFound.has(k)) found++;
      return { found, total: all.size };
    },
    isVisited(entryId) {
      return visited.has(entryId);
    },
    refreshBounds(h) {
      return computeBounds(h);
    },
    pickGround,
    pickHotspot,
    setPointerFromClient(x, y) {
      setNdc(x, y);
    },
    /** Spot ids that exist (for hotspot areas). */
    isSpot(id) {
      return !!SPOT_BY_ID[id];
    },
  };
  return api;
}

function loadSet(key) {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}
function saveSet(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* private mode etc. — discovery state is only a nicety */
  }
}

/** Golden sparkle (unvisited) / little green leaf (visited) / pale secret twinkle point sprites. */
function makeMarkerMaterial() {
  const c = (hex) => new THREE.Color(hex);
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 600 },
      uGold: { value: c(palette.postYellow ?? '#ffcc33') },
      uCore: { value: c(palette.spots) },
      uEdge: { value: c(palette.capBrown) },
      uLeaf: { value: c(palette.leafLight) },
      uLeafDark: { value: c(palette.leafDark) },
      uMint: { value: c('#c8fff0') },
      uPx: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute float aSize;
      attribute float aPhase;
      attribute float aKind;
      uniform float uTime;
      uniform float uScale;
      uniform float uPx;
      varying float vAlpha;
      varying float vKind;
      varying float vSpin;
      varying float vTw;
      void main() {
        vec3 p = position;
        p.y += sin(uTime * 2.1 + aPhase) * 0.09;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float pulse = 1.0 + 0.07 * sin(uTime * 3.3 + aPhase * 1.7);
        // never smaller than a readable dot, never a blob filling the screen
        gl_PointSize = clamp(aSize * pulse * uScale * 0.75 / max(0.1, -mv.z), 24.0 * aSize * uPx, 84.0 * uPx) * step(0.001, aAlpha);
        vAlpha = aAlpha;
        vKind = aKind;
        vSpin = aKind > 0.5 && aKind < 1.5 ? 0.5 + 0.25 * sin(uTime * 1.6 + aPhase) : sin(uTime * 0.9 + aPhase) * 0.35 + uTime * (aKind > 1.5 ? 0.8 : 0.0);
        vTw = 0.75 + 0.25 * sin(uTime * 7.0 + aPhase * 3.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uGold;
      uniform vec3 uCore;
      uniform vec3 uEdge;
      uniform vec3 uLeaf;
      uniform vec3 uLeafDark;
      uniform vec3 uMint;
      varying float vAlpha;
      varying float vKind;
      varying float vSpin;
      varying float vTw;
      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        uv.y = -uv.y;
        float cs = cos(vSpin), sn = sin(vSpin);
        vec2 q = mat2(cs, -sn, sn, cs) * uv;
        vec3 col;
        float a;
        float r = length(uv);
        if (vKind < 0.5) {
          // sparkle: astroid-like four-point star with a cream core and a soft halo
          float s = pow(abs(q.x), 0.55) + pow(abs(q.y), 0.55);
          float star = 1.0 - smoothstep(0.74, 0.8, s);
          // a smaller diagonal star behind it: an eight-point twinkle
          vec2 q2 = mat2(0.7071, -0.7071, 0.7071, 0.7071) * q;
          float s2 = pow(abs(q2.x), 0.55) + pow(abs(q2.y), 0.55);
          float star2 = (1.0 - smoothstep(0.44, 0.5, s2)) * (0.55 + 0.45 * vTw);
          float edge = smoothstep(0.58, 0.72, s);
          float core = 1.0 - smoothstep(0.0, 0.5, length(q) * 1.8);
          col = mix(uGold, uEdge, edge * 0.55);
          col = mix(col, uCore, core);
          float halo = exp(-r * r * 4.0) * 0.55;
          a = max(max(star, star2), halo);
          col = mix(uGold * 1.2, col, max(star, star2 * 0.8));
          col *= 1.35;
        } else if (vKind < 1.5) {
          // leaf: a lens shape with a midrib
          vec2 l = q * vec2(1.6, 1.0);
          float d = max(length(l - vec2(0.55, 0.0)), length(l + vec2(0.55, 0.0)));
          float leaf = 1.0 - smoothstep(1.0, 1.08, d);
          float edge = smoothstep(0.86, 0.98, d);
          float rib = (1.0 - smoothstep(0.0, 0.06, abs(q.x))) * step(abs(q.y), 0.75);
          col = mix(uLeaf, uLeafDark, max(edge, rib * 0.7));
          float halo = exp(-r * r * 6.0) * 0.3;
          a = max(leaf, halo);
          col = mix(uCore, col, leaf);
        } else {
          // secret: a slim twinkling cross of pale mint light with tiny satellites
          float thin = exp(-abs(q.x) * 26.0) * (1.0 - smoothstep(0.2, 1.0, abs(q.y)))
                     + exp(-abs(q.y) * 26.0) * (1.0 - smoothstep(0.2, 1.0, abs(q.x)));
          float core = exp(-r * r * 30.0);
          vec2 s1 = uv - vec2(0.55, 0.45), s2 = uv + vec2(0.5, 0.35);
          float sats = exp(-dot(s1, s1) * 140.0) + exp(-dot(s2, s2) * 160.0);
          a = clamp(thin * vTw + core + sats * vTw + exp(-r * r * 4.0) * 0.25, 0.0, 1.0);
          col = mix(uMint, uCore, core) * 1.3;
        }
        a *= vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
}

/** Soft glowing ring that pulses under the hovered / focused hotspot. */
function makeRingMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAlpha: { value: 0 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(palette.windowGlow) },
      uCore: { value: new THREE.Color(palette.spots) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
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
