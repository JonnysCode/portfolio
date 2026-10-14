// ─────────────────────────────────────────────────────────────────────────────
// Interactions — clickable hotspots and their affordances. There is no player
// any more: the visitor explores by gliding the camera between spots
// (cameraRig.js) and clicking the little things they discover.
//
// • Markers (one Points draw call for all) stand above every page of the
//   CURRENT spot; in the 'glen' overview only the featured pieces get one. By
//   day a ✦ is a small soft wisp of pale mint-cream light round a cream star
//   glint (it belongs to the glen, like the sun motes — but cool, pointed and
//   still), a slow breath of light rolling out every ~4 s while unread; the thin
//   ring appears only when hovered / keyboard-focused. By night it is smaller: a
//   thin ring round a ✦ outline with a half-clear warm-cream core (never a
//   glowing disc over the pieces), at full brightness only when hovered /
//   focused. Each floats just above its piece's top edge (a screen-space lift,
//   so never in front of it), clear of fairy-light bulbs; markers crowding each
//   other on screen fold into one ✦ with a satellite glint per extra piece that
//   fans out on hover (a tap on a phone, Tab). Far ones fade a little. Visited
//   entries turn into a little leaf. Markers pop in one by one after the camera
//   lands and hide while their panel is open.
// • Secret tells: lingering at a place (~20 s untouched), or having read all
//   its pages, makes one unfound secret in plain view twitch and glimmer once
//   (with a soft twinkle) — remembered, never repeated; secrets stay markerless.
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
//   ctx.interactions.screenPosition(h, out?) → { x, y, z, visible }  (z > 1: behind the camera)
//   ctx.interactions.setFocused(h | null)   (keyboard focus ring + tooltip)
//   ctx.interactions.setOpen(h | null) / markVisited(entryId) / isVisited(entryId)   (UI bookkeeping)
//   ctx.interactions.progress() → { visited, total }   ctx.interactions.onVisit(fn(h, progress))
//   ctx.interactions.secrets({ by: 'day' }?) → { found, total }   ctx.interactions.onSecret(fn(h, secrets, isNew))
//   ctx.interactions.onTell(fn(h))      (a secret gave its one-time tell)
//   ctx.interactions.onGroundClick((point, event) => …)  (tap on empty ground)
//   ctx.interactions.pickGround() / pickHotspot() / setPointerFromClient(x, y)
//   ctx.interactions.refreshBounds(h)   (call if a hotspot object changes size a lot)
//   ctx.interactions.firstSolidHit(origin, dir, near, far, ignore?) → distance | Infinity
//   ctx.interactions.canvasRect          (the canvas box every projection uses)
//   ctx.interactions.gestures           (shared pointer gesture classifier, pointerGestures.js)
// Hotspot options: focus = { distance, lift, radius, azimuth, faceAzimuth, polar }
// for the camera when its entry opens (cameraRig.focus); markerHeight = marker
// height above the object's origin (default: top of its bounds + 0.45);
// marker = false hides the sparkle; night = true: only there after dark.
// Picking ignores hotspots hidden behind solid geometry (walls, decks, trunk).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight } from '../world/ground.js';
import { SPOT_BY_ID } from '../world/layout.js';
import { palette } from '../core/palette.js';
import { damp } from '../core/rng.js';
import { createPointerGestures } from './pointerGestures.js';
import { triGrid } from './triGrid.js';

/**
 * Marker placement tweaks per entry: dx / dz move the anchor (world offsets from
 * the bounds centre) to a free end of the piece; y is the lowest the anchor may
 * sit (from the object's origin; by default it is the top of the piece's bounds).
 * Every marker is then lifted above its anchor in SCREEN space (markerWorld), so
 * it floats just over the piece's top edge, never in front of it. The
 * Hobelbank's sparkle sat exactly over Jonny's head as seen from the
 * Schreinerei camera — it floats over the bench's tail-vise end instead.
 */
const MARKER_TWEAKS = {
  'workbench-wip': { dx: 0.55, dz: 0.35, y: 1.5 },
  // the two villagers sit at the table's back: the sparkle (and its leaf once read) floats over the free front end
  'dining-table': { dx: 0.62, dz: 0.25, y: 1.0 },
  // the record player stands on the cabinet: the cabinet's wisp hangs at its free right end, the
  // coffee table's to the front (four pieces on the deck, four clear places to tap)
  'record-cabinet': { dx: 0.62, dz: 0.12, y: 0.98 },
  'coffee-table': { dx: -0.12, dz: 0.4, y: 0.6 },
};

const VISITED_KEY = 'woodland:visited';
const SECRETS_KEY = 'woodland:secrets';
const TOLD_KEY = 'woodland:secret-tells';

/** Marker kinds (shader). */
const K_SPARKLE = 0, K_LEAF = 1, K_SECRET = 2, K_FEATURED = 3;
/** An unread ✦ sends a ping ring out this often (s). */
const PING_EVERY = 4;

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
  // the canvas box changes only with the viewport: measured on resize / scroll,
  // not every frame (a read after the UI's style writes would force a layout)
  let rectDirty = false;
  const remeasure = () => (rectDirty = true);
  window.addEventListener('resize', remeasure);
  window.addEventListener('scroll', remeasure, { capture: true, passive: true });
  window.visualViewport?.addEventListener?.('resize', remeasure);
  if (window.ResizeObserver) new ResizeObserver(remeasure).observe(canvas);
  // markers pop in one by one after the camera lands
  let settledAt = 0;
  let wasMoving = false;
  let lastSpot = null;

  const visited = loadSet(VISITED_KEY);
  const secretsFound = loadSet(SECRETS_KEY);
  // night-only hotspots (opts.night): only there once night has fallen
  const isNight = () => !!ctx.env?.isNight;
  ctx.env?.onChange?.((t) => {
    for (const h of hotspots) if (h.night) h.enabled = t > 0.5;
  });

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
    attr('aHot', 1);
    attr('aPing', 1);
    attr('aCount', 1);
    attr('aSat', 1);
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

  // ─── marker size & placement ───────────────────────────────────────────────
  // Sizes are worked out here (CSS px), not in the shader, so drawing, picking,
  // the lift above the piece and the merging of crowded markers all agree. By
  // day a ✦ is a soft wisp (≤ ~40 px at 720p, smaller on a phone); by night a
  // thin ring round a ✦, about 80 % of that.
  const sizes = { frame: -1, ppu: 600, lo: 24, hi: 40, night: 0 };
  function markerSizes() {
    if (sizes.frame === engine.frame) return sizes;
    sizes.frame = engine.frame;
    const r = canvasRect;
    const W = Math.max(1, r.width || canvas.clientWidth || 1), H = Math.max(1, r.height || canvas.clientHeight || 1);
    // CSS px per world unit at distance 1
    sizes.ppu = H / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
    const n = ctx.env?.night ?? (isNight() ? 1 : 0);
    sizes.night = n;
    const hiDay = THREE.MathUtils.clamp(Math.min(W, H) * 0.056, 30, 40);
    // (by night ~80 %: a ring ~24 px across at 720p — the old filled discs were ~45)
    sizes.hi = hiDay + (Math.max(24, hiDay * 0.8) - hiDay) * n;
    sizes.lo = 26 + (21 - 26) * n;
    return sizes;
  }
  /** A marker sprite's size (CSS px) at `dist` from the lens (sizeK: 1 = a ✦, smaller for leaves). */
  function spritePx(sizeK, dist) {
    const S = markerSizes();
    return THREE.MathUtils.clamp((S.ppu * 0.5) / Math.max(dist, 0.1), S.lo, S.hi) * sizeK;
  }

  /** The point a marker belongs to: over the piece's top (and a free end of it), clear of bulbs. */
  function markerAnchor(h, out) {
    const b = boundsOf(h);
    h.object.getWorldPosition(out);
    out.x += b.cx;
    out.z += b.cz;
    const tw = h.entryId ? MARKER_TWEAKS[h.entryId] : null;
    if (tw) {
      out.x += tw.dx ?? 0;
      out.z += tw.dz ?? 0;
    }
    out.y += h.markerHeight !== undefined ? h.markerHeight - 0.25 : Math.max(b.top, tw?.y ?? -Infinity);
    out.y += bulbLift(h, out);
    return out;
  }
  /**
   * Where a hotspot's marker floats: its anchor, lifted in screen space by a
   * little more than the marker's own radius — so it sits above the piece's top
   * edge (a character's head, a table top) at any distance, never on it.
   */
  function markerWorld(h, out) {
    markerAnchor(h, out);
    const dist = out.distanceTo(camera.position);
    const S = markerSizes();
    const px = spritePx(h.__size ?? 1, dist);
    out.y += ((px * 0.36 + 4) * Math.max(dist, 0.1)) / S.ppu;
    return out;
  }

  /**
   * A ✦ hanging among fairy-light bulbs or right by a lantern reads as one more
   * bulb: lift it (once, remembered per hotspot) until no glowing bulb is
   * within BULB_CLEAR of it. Uses the camera's soft-occluder list (every
   * fairy-light bulb and lantern halo, cameraObstacles.js).
   */
  const BULB_CLEAR = 0.6;
  function bulbLift(h, p) {
    if (h.__bulbLift !== undefined) return h.__bulbLift;
    const decor = ctx.cameraRig?.obstacles?.shapes?.decor;
    if (!decor) return 0; // (the world is still being built: ask again next frame)
    // (the marker itself floats a little above its anchor)
    const y0 = p.y + 0.3;
    let lift = 0;
    for (let step = 0; step < 8; step++) {
      let hit = false;
      for (const d of decor) {
        if (d.kind !== 's') continue;
        const dy = y0 + lift - d.y;
        if (Math.abs(dy) < BULB_CLEAR && Math.hypot(p.x - d.x, dy, p.z - d.z) < BULB_CLEAR) {
          hit = true;
          break;
        }
      }
      if (!hit) break;
      lift += 0.15;
    }
    h.__bulbLift = lift;
    return lift;
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

  // ─── solid things (occluders) ──────────────────────────────────────────────
  let solids = null;
  /**
   * Opaque meshes that can hide something behind them (built lazily once the
   * world exists). Dense scatter (grass, leaves, pebbles: big instance counts),
   * see-through and invisible things never count.
   */
  function solidMeshes() {
    if (solids) return solids;
    solids = [];
    ctx.scene.traverse((o) => {
      if (!o.isMesh || o.isSprite || o.isPoints || o.isLine) return;
      if (o.isInstancedMesh && o.count > 400) return;
      if (o.userData.__hotspotProxy) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      // (alpha-tested leaf / fern cards are full of holes: you can see — and click — through them)
      if (!m || m.visible === false || m.depthWrite === false || m.alphaTest > 0 || (m.transparent && (m.opacity ?? 1) < 0.6)) return;
      if (!o.geometry?.boundingSphere) o.geometry?.computeBoundingSphere?.();
      // the sky dome and far backdrops wrap the whole glen: never between the camera and a hotspot
      const bs = o.geometry?.boundingSphere;
      if (bs && bs.radius * o.matrixWorld.getMaxScaleOnAxis() > 150) return;
      solids.push(o);
    });
    return solids;
  }
  const within = (o, root) => {
    for (let q = o; q; q = q.parent) if (q === root) return true;
    return false;
  };
  const occRay = new THREE.Raycaster();
  const occHits = [];
  const segC = new THREE.Vector3();
  const bsC = new THREE.Vector3();
  /**
   * Distance from `origin` along `dir` (normalised) to the first solid thing
   * between `near` and `far` — Infinity when clear. Things inside `ignore`
   * (an Object3D) are skipped.
   */
  function firstSolidHit(origin, dir, near, far, ignore = null) {
    occRay.set(origin, dir);
    occRay.near = near;
    occRay.far = far;
    segC.copy(dir).multiplyScalar((near + far) / 2).add(origin);
    const segR = (far - near) / 2;
    let first = Infinity;
    for (const m of solidMeshes()) {
      const bs = m.geometry?.boundingSphere;
      if (!bs) continue;
      // (skinned villagers are moved by their bones, not their matrix: their own raycast checks their bounds)
      if (!m.isInstancedMesh && !m.isSkinnedMesh) {
        bsC.copy(bs.center).applyMatrix4(m.matrixWorld);
        const r = bs.radius * m.matrixWorld.getMaxScaleOnAxis();
        if (bsC.distanceTo(segC) > r + segR) continue;
        if (occRay.ray.distanceSqToPoint(bsC) > r * r) continue;
      }
      if (ignore && within(m, ignore)) continue;
      if (!isLive({ enabled: true, object: m })) continue;
      const grid = !m.isInstancedMesh && !m.isSkinnedMesh && triCount(m) > GRID_MIN_TRIS ? triGrid(m) : null;
      if (grid) {
        // the ray in the mesh's own space (scaled meshes: distances measured back in world space)
        invM.copy(m.matrixWorld).invert();
        localRay.copy(occRay.ray).applyMatrix4(invM);
        lp0.copy(dir).multiplyScalar(near).add(origin).applyMatrix4(invM);
        lp1.copy(dir).multiplyScalar(far).add(origin).applyMatrix4(invM);
        const ln = lp0.distanceTo(localRay.origin), lf = lp1.distanceTo(localRay.origin);
        const t = grid.raycastFirst(localRay, ln, lf);
        if (t < Infinity) {
          lp0.copy(localRay.direction).multiplyScalar(t).add(localRay.origin).applyMatrix4(m.matrixWorld);
          const dw = lp0.distanceTo(origin);
          if (dw >= near && dw <= far && dw < first) first = dw;
        }
        continue;
      }
      occHits.length = 0;
      m.raycast(occRay, occHits);
      for (const hit of occHits) if (hit.distance >= near && hit.distance <= far && hit.distance < first) first = hit.distance;
    }
    return first;
  }
  const invM = new THREE.Matrix4();
  const localRay = new THREE.Ray();
  const lp0 = new THREE.Vector3();
  const lp1 = new THREE.Vector3();
  const GRID_MIN_TRIS = 3000;
  const triCount = (m) => {
    const g = m.geometry;
    return g ? (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3 : 0;
  };
  // build the big meshes' triangle grids in idle time once the glen is up (not on the first tap)
  let gridQueue = null;
  function warmGrids(deadline) {
    if (!gridQueue) gridQueue = solidMeshes().filter((m) => !m.isInstancedMesh && !m.isSkinnedMesh && triCount(m) > GRID_MIN_TRIS);
    while (gridQueue.length && (!deadline || deadline.timeRemaining() > 8)) triGrid(gridQueue.pop());
    if (gridQueue.length) idle(warmGrids);
  }
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(() => fn(null), 60));

  /** Raycast hotspots (cheap bounding-sphere prefilter, then exact meshes). */
  function rawPick() {
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
  /**
   * A hotspot behind solid geometry (the owl in the hollow behind the loft
   * deck, the duck through the treehouse) must not answer a click on that
   * geometry. Exact occlusion is raycast only when the candidate (or the view)
   * changes — not every hover frame.
   */
  const occMemo = { h: null, x: 0, y: 0, cam: new THREE.Vector3(), blocked: false };
  function pickHotspot() {
    const best = rawPick();
    if (!best) return null;
    const h = best.hotspot;
    // (the idle "breathing" drifts the camera a little all the time: re-test only after a real move)
    const camMoved = occMemo.cam.distanceToSquared(camera.position) > 0.15 * 0.15;
    if (h !== occMemo.h || camMoved || Math.abs(ndc.x - occMemo.x) > 0.02 || Math.abs(ndc.y - occMemo.y) > 0.02) {
      occMemo.h = h;
      occMemo.x = ndc.x;
      occMemo.y = ndc.y;
      occMemo.cam.copy(camera.position);
      const hitAt = firstSolidHit(raycaster.ray.origin, raycaster.ray.direction, camera.near, Math.max(camera.near, best.distance - 0.3), h.object);
      occMemo.blocked = hitAt < best.distance - 0.3;
    }
    return occMemo.blocked ? null : best;
  }

  /** Screen-space test against the floating sparkles (and, on touch, a generous radius around objects). */
  function pickMarker(clientX, clientY, generous) {
    const r = canvasRect;
    let best = null, bestD = Infinity;
    for (const h of hotspots) {
      // (what is drawn this frame: a marker merged into its neighbour's is not there to pick)
      if (!h.enabled || (h.__vis ?? 0) < 0.25 || !h.__mp) continue;
      v.copy(h.__mp).project(camera);
      if (v.z > 1) continue;
      const sx = r.left + ((v.x + 1) / 2) * r.width, sy = r.top + ((1 - v.y) / 2) * r.height;
      // (the sprite's size as drawn: a ✦ holds its glint in the middle ~⅖, a leaf fills its
      // sprite) — touch reaches ≥ 22 px round a ✦ whatever its size
      const star = h.__kind === K_SPARKLE || h.__kind === K_FEATURED;
      const px = h.__px ?? 30;
      const reach = px * (star ? 0.42 : 0.5) + (generous ? 22 : 7);
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
        // …but never through a wall, a deck or the trunk
        centerOf(h, wp);
        const dist = wp.distanceTo(camera.position);
        groundPoint.subVectors(wp, camera.position).divideScalar(dist || 1);
        if (firstSolidHit(camera.position, groundPoint, camera.near, Math.max(camera.near, dist - boundsOf(h).r - 0.3), h.object) < Infinity) continue;
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
  function bounce(h, { amp = 0.075, twice = false } = {}) {
    if (reduced || boundsOf(h).r > 3.6) return;
    if (!h.__bounce) h.__bounce = { base: h.object.scale.clone(), t: 0 };
    else h.__bounce.t = 0;
    h.__bounce.amp = amp;
    h.__bounce.twice = twice;
    bouncing.add(h);
  }
  const wob = (t) => (t > 0 ? Math.sin(t * 19) * Math.exp(-t * 6.5) : 0);
  function updateBounces(dt) {
    for (const h of bouncing) {
      const b = h.__bounce;
      b.t += dt;
      // (a secret's tell: a second, smaller twitch — an ear flick, a bob)
      const s = 1 + b.amp * (wob(b.t) + (b.twice ? 0.7 * wob(b.t - 0.55) : 0));
      if (b.t > (b.twice ? 1.45 : 0.9)) {
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
    let h = hit?.hotspot ?? null;
    if (!h) {
      h = pickMarker(x, y, touchy);
      // a merged marker ("n ✦") fans out first; the next tap picks one of them
      if (h && isClosedCluster(h)) {
        openCluster(h, touchy ? 6 : 1.2);
        ctx.audio?.play?.('pop');
        return;
      }
    }
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
  let warmed = false;
  engine.addUpdate((dt, t) => {
    if (!warmed && ctx.cameraRig && engine.frame > 30) {
      warmed = true;
      idle(warmGrids);
    }
    if (rectDirty) {
      rectDirty = false;
      canvasRect = canvas.getBoundingClientRect();
    }
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
        let h = hit ? hit.hotspot : pickMarker(pointerX, pointerY, false);
        // hovering a merged marker fans it out (its pieces can then be hovered one by one)
        if (h && !hit && isClosedCluster(h)) {
          openCluster(h, 1.2);
          h = null;
        }
        setHovered(h);
      }
    }
    if (hovered && !isLive(hovered)) setHovered(null);
    if (focused && !isLive(focused)) api.setFocused(null);

    updateMarkers(dt, t, spot, moving, panelOpen);
    if (f % 20 === 0) maybeTell(t, spot, moving, panelOpen);
    updateRing(dt, t, panelOpen);
    updateBounces(dt);
  }, 2);

  // ─── crowded markers merge ────────────────────────────────────────────────
  // Markers closer on screen than about a marker's width (the deck's pieces from
  // afar, the record player on its cabinet) merge into ONE ✦ in their middle with
  // a little satellite glint per extra piece. Hovering it (a tap on a phone, or
  // Tab onto one of its pieces) fans them out in a short row just above, in
  // their left-to-right order, so each can be picked; they fold back together a
  // moment after the pointer leaves.
  const live = [];
  const fanRow = [];
  const camR = new THREE.Vector3();
  const camU = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  const cen = new THREE.Vector3();
  let nowT = 0;
  const leaderOf = (h) => h.__lead ?? h;
  const bySx = (p, q) => p.__sx - q.__sx;
  function isClosedCluster(h) {
    const L = leaderOf(h);
    return (L.__n ?? 1) > 1 && (L.__m ?? 0) > 0.5;
  }
  function openCluster(h, sec) {
    const L = leaderOf(h);
    L.__openUntil = Math.max(L.__openUntil ?? 0, nowT + sec);
  }

  function updateMarkers(dt, t, spot, moving, panelOpen) {
    nowT = t;
    ensureCapacity(hotspots.length);
    const A = markerGeo.attributes;
    const pos = A.position.array;
    const alpha = A.aAlpha.array;
    const sizeA = A.aSize.array;
    const phase = A.aPhase.array;
    const kind = A.aKind.array;
    const hotA = A.aHot.array;
    const pingA = A.aPing.array;
    const countA = A.aCount.array;
    const satA = A.aSat.array;
    const kUp = damp(6, dt), kDown = damp(10, dt), kHot = damp(9, dt), kM = damp(9, dt), kOff = damp(10, dt);
    const sinceLanding = t - settledAt;
    const S = markerSizes();
    const r = canvasRect;
    featuredSeen.clear();
    live.length = 0;
    let order = 0;
    // ① what each hotspot wants (visibility, kind, size) and where its own marker floats
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
      } else if (panelOpen && openHotspot && (h === openHotspot || (h.entryId && h.entryId === openHotspot.entryId))) want = 0;
      else if (moving) want = 0;
      else {
        if (h.area && h.area === spot && (h.entryId || !h.onActivate)) {
          // (a page already read: a small, quiet leaf — "been here", not a stray leaf over someone's face)
          want = panelOpen ? 0.4 : isVisited ? 0.6 : 1;
          targetSize = isVisited ? 0.55 : 1;
        } else if (spot === 'glen' && isFeatured(h) && !featuredSeen.has(h.entryId)) {
          // the overview's featured pieces: a little bigger, with a slow halo
          featuredSeen.add(h.entryId);
          want = 1;
          targetSize = isVisited ? 0.75 : 1.15;
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
        k = isVisited ? K_LEAF : spot === 'glen' && h.area !== 'glen' ? K_FEATURED : K_SPARKLE;
      }
      // hovered / keyboard-focused: the ring appears, and by night it lights up fully
      const hot = (h === hovered || h === focused) && !isSecret ? 1 : 0;
      h.__hot = (h.__hot ?? 0) + (hot - (h.__hot ?? 0)) * kHot;
      const a0 = h.__alpha ?? 0;
      h.__alpha = a0 + (want - a0) * (want > a0 ? kUp : kDown);
      h.__want = want;
      h.__popping = want > a0;
      h.__lead = null;
      if (h.__alpha < 0.01) {
        h.__bornAt = undefined;
        h.__vis = 0;
        h.__n = 1;
        continue;
      }
      // the ping: the first one as the ✦ pops in, then every PING_EVERY seconds
      if (h.__bornAt === undefined) h.__bornAt = t;
      h.__kind = k;
      h.__size = (h.__size ?? targetSize) + (targetSize - (h.__size ?? targetSize)) * damp(8, dt);
      if (!h.__own) {
        h.__own = new THREE.Vector3();
        h.__mp = new THREE.Vector3();
        h.__off = new THREE.Vector3();
        h.__layout = 0;
        h.__hide = 0;
      }
      markerWorld(h, h.__own);
      h.__dist = h.__own.distanceTo(camera.position);
      h.__px = spritePx(h.__size, h.__dist);
      v.copy(h.__own).project(camera);
      h.__sx = ((v.x + 1) / 2) * r.width;
      h.__sy = ((1 - v.y) / 2) * r.height;
      h.__front = v.z < 1;
      live.push(h);
    }
    // ② merge markers that crowd each other on screen (pages only — never secrets)
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      a.__members ??= [];
      a.__members.length = 0;
      if (a.__lead || a.__kind === K_SECRET || a.__want <= 0 || !a.__front) continue;
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        if (b.__lead || b.__kind === K_SECRET || b.__want <= 0 || !b.__front) continue;
        // (a little hysteresis: a pair that was merged stays merged a few px longer)
        const thr = Math.max(26, 0.85 * Math.max(a.__px, b.__px)) * (b.__prevLead === a ? 1.25 : 1);
        if (Math.hypot(a.__sx - b.__sx, a.__sy - b.__sy) < thr) {
          b.__lead = a;
          if (!a.__members.length) a.__members.push(a);
          a.__members.push(b);
        }
      }
    }
    // camera right / up (fan rows are laid out in screen space)
    camR.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    camU.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    // ③ where each marker is drawn: alone at its own place; merged at the middle
    // of its group; fanned out in a row above that middle while the group is open
    let n = 0;
    for (const h of live) {
      h.__prevLead = h.__lead;
      const L = leaderOf(h);
      const group = L.__members.length > 1 ? L.__members : null;
      let layout = 0;
      if (group) {
        const cnt = group.length;
        if (h === L) {
          // the group's middle (world) and its fan row (screen order, left to right)
          cen.set(0, 0, 0);
          let maxPx = 0;
          for (const m of group) {
            cen.add(m.__own);
            maxPx = Math.max(maxPx, m.__px);
          }
          cen.divideScalar(cnt);
          L.__cen ??= new THREE.Vector3();
          L.__cen.copy(cen);
          fanRow.length = 0;
          for (const m of group) fanRow.push(m);
          fanRow.sort(bySx);
          const dist = Math.max(0.1, cen.distanceTo(camera.position));
          const wpp = dist / S.ppu; // world units per CSS px at the group
          const gap = maxPx * 1.0;
          for (let i = 0; i < cnt; i++) {
            const m = fanRow[i];
            m.__slot = i;
            m.__fanX = (i - (cnt - 1) / 2) * gap * wpp;
            m.__fanY = maxPx * 0.4 * wpp;
          }
          // open while hovered near the row, tapped, or one of its pieces has keyboard focus
          let open = t < (L.__openUntil ?? 0);
          if (group.includes(focused) || group.includes(hovered)) open = true;
          if (open && pointerInside && !isTouch) {
            const rowHalf = (cnt / 2) * gap + maxPx * 0.6;
            v.copy(cen).project(camera);
            const cx = r.left + ((v.x + 1) / 2) * r.width, cy = r.top + ((1 - v.y) / 2) * r.height;
            if (Math.abs(pointerX - cx) < rowHalf + 18 && pointerY < cy + maxPx * 0.8 + 18 && pointerY > cy - maxPx * 1.4 - 18) L.__openUntil = Math.max(L.__openUntil ?? 0, t + 0.8);
          }
          L.__open = open;
        }
        const mTarget = L.__open ? 0 : 1;
        h.__m = (h.__m ?? mTarget) + (mTarget - (h.__m ?? mTarget)) * kM;
        tgt.copy(L.__cen).addScaledVector(camR, h.__fanX * (1 - h.__m)).addScaledVector(camU, h.__fanY * (1 - h.__m));
        h.__n = cnt;
        layout = L.id * 4096 + h.__slot * 64 + cnt;
      } else {
        h.__m = 0;
        h.__n = 1;
        tgt.copy(h.__own);
      }
      // a marker that changed groups glides over from where it was drawn
      if (layout !== h.__layout) {
        if (h.__vis > 0.01) h.__off.copy(h.__mp).sub(tgt);
        else h.__off.set(0, 0, 0);
        h.__layout = layout;
      }
      h.__off.multiplyScalar(1 - kOff);
      h.__mp.copy(tgt).add(h.__off);
      // (a piece folded into its neighbour's ✦ fades out; one leaving a group fades back in)
      const hideT = group && h !== L ? h.__m : 0;
      h.__hide += (hideT - h.__hide) * kM;
      // far away (the overview's featured pieces): a little quieter
      const far = 1 - 0.28 * THREE.MathUtils.smoothstep(h.__dist, 24, 58);
      h.__vis = h.__alpha * (1 - h.__hide) * far;
      if (h.__vis < 0.005) continue;
      pos[n * 3] = h.__mp.x;
      pos[n * 3 + 1] = h.__mp.y;
      pos[n * 3 + 2] = h.__mp.z;
      alpha[n] = h.__vis;
      // a little overshoot as it pops in
      const pop = reduced ? 1 : 1 + 0.3 * Math.sin(Math.min(1, h.__alpha) * Math.PI) * (h.__popping ? 1 : 0);
      sizeA[n] = h.__px * pop;
      phase[n] = (h.id * 1.618) % (Math.PI * 2);
      kind[n] = h.__kind;
      hotA[n] = h.__hot;
      const k = h.__kind;
      // (reduced motion: no ping rolling out — a still marker)
      pingA[n] = reduced || !(k === K_SPARKLE || k === K_FEATURED) ? 99 : (t - h.__bornAt) % (k === K_FEATURED ? PING_EVERY * 1.5 : PING_EVERY);
      // the group's ✦ carries a satellite glint per extra piece while folded
      countA[n] = group && h === L ? group.length - 1 : 0;
      satA[n] = group && h === L ? h.__m : 0;
      n++;
    }
    markerGeo.setDrawRange(0, n);
    for (const key of ['position', 'aAlpha', 'aSize', 'aPhase', 'aKind', 'aHot', 'aPing', 'aCount', 'aSat']) A[key].needsUpdate = n > 0;
    markers.visible = n > 0;
    markerMat.uniforms.uTime.value = reduced ? 0 : t;
    markerMat.uniforms.uTimeF.value = reduced ? 0 : t;
    markerMat.uniforms.uPx.value = engine.renderer.getPixelRatio() || 1;
    markerMat.uniforms.uNight.value = S.night;
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

  // ─── secrets: a one-time tell ─────────────────────────────────────────────
  // A visitor who lingers at a place (~20 s without touching anything), or who
  // has read every page there, gets one quiet hint of a secret in view: it
  // twitches (the cat's ear, the duck's bob), a pale glimmer, a soft twinkle.
  // Each secret tells only once (remembered); secrets keep no marker.
  const told = loadSet(TOLD_KEY);
  let lastInputAt = 0;
  let toldThisVisit = null;
  gestures.on('input', () => (lastInputAt = engine.elapsed));
  canvas.addEventListener('pointermove', () => (lastInputAt = engine.elapsed), { passive: true });
  const tellP = new THREE.Vector3();
  const tellDir = new THREE.Vector3();
  const tellS = {};
  function maybeTell(t, spot, moving, panelOpen) {
    if (!spot || moving || panelOpen || ctx.cameraRig?.focused || ctx.ui?.isModalOpen) return;
    if (toldThisVisit === spot + settledAt) return;
    const since = t - settledAt;
    const quiet = t - lastInputAt;
    const pages = api.forSpot(spot);
    const allRead = pages.length > 0 && pages.every((h) => visited.has(h.entryId));
    if (!((since > 20 && quiet > 10) || (allRead && since > 5 && quiet > 4))) return;
    let best = null, bestD = Infinity;
    for (const h of hotspots) {
      if (h.kind !== 'secret' || !isLive(h) || secretsFound.has(secretKey(h)) || told.has(secretKey(h))) continue;
      api.screenPosition(h, tellS);
      if (!tellS.visible) continue;
      const r = canvasRect;
      const nx = (tellS.x - r.left) / r.width - 0.5, ny = (tellS.y - r.top) / r.height - 0.5;
      if (Math.abs(nx) > 0.42 || ny < -0.36 || ny > 0.36) continue;
      // in view only (not hidden behind a wall, a deck or the trunk): its middle or its top must be clear
      centerOf(h, tellP);
      if (tellP.distanceTo(camera.position) > 26) continue;
      let seen = false;
      for (let k = 0; k < 2 && !seen; k++) {
        if (k === 1) markerWorld(h, tellP).y -= 0.3;
        const dist = tellP.distanceTo(camera.position);
        tellDir.subVectors(tellP, camera.position).divideScalar(dist || 1);
        seen = firstSolidHit(camera.position, tellDir, camera.near, Math.max(camera.near, dist - boundsOf(h).r * 0.5 - 0.2), h.object) === Infinity;
      }
      if (!seen) continue;
      // this place's own secrets first, then the most central one
      const d = Math.hypot(nx, ny) - (h.area === spot ? 0.5 : 0);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    // (nothing in view: look again a little later — the visitor may have turned round)
    if (!best) {
      lastInputAt = Math.max(lastInputAt, t - 6);
      return;
    }
    toldThisVisit = spot + settledAt;
    told.add(secretKey(best));
    saveSet(TOLD_KEY, told);
    bounce(best, { amp: 0.1, twice: true });
    best.__sparkUntil = t + 2.4;
    ctx.audio?.play?.('twinkle');
    for (const fn of tellListeners) fn(best);
  }
  const tellListeners = new Set();

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
    /** The canvas' client rect (re-measured when the viewport changes): every projection uses this box. */
    get canvasRect() {
      return canvasRect;
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
        enabled: (opts.enabled ?? true) && (!opts.night || isNight()),
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
      out.z = v.z;
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
    /** fn(hotspot) when a secret gives its one-time tell (a twitch and a glimmer). */
    onTell(fn) {
      tellListeners.add(fn);
      return () => tellListeners.delete(fn);
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
    /**
     * How many of the registered secrets have been found.
     * { by: 'day' } counts only the ones that show by day (not `night: true`).
     */
    secrets({ by } = {}) {
      const all = new Set(hotspots.filter((h) => h.kind === 'secret' && (by !== 'day' || !h.night)).map(secretKey));
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
    firstSolidHit,
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

/**
 * Marker point sprites (sizes come in CSS px from updateMarkers).
 * Unvisited pages, by DAY: a small soft wisp of pale mint-cream light round a
 * cream ✦ glint with thin twinkling rays — something that belongs to the glen
 * (like the sun motes, but cool, pointed and still), not a UI button; a slow
 * breath of light rolls out of it every few seconds, and the thin ring appears
 * only while it is hovered / keyboard-focused. By NIGHT: smaller, a thin ring
 * round a ✦ drawn as a bright outline over a half-clear warm-cream core (no
 * glowing disc over the pieces); full brightness only when hovered / focused.
 * A folded group of crowded markers carries one little satellite glint per
 * extra piece. Visited: a little green leaf. Secrets: a pale twinkling cross.
 */
function makeMarkerMaterial() {
  const c = (hex) => new THREE.Color(hex);
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTimeF: { value: 0 },
      uNight: { value: 0 },
      uCream: { value: c('#fff3d2') },
      uCore: { value: c(palette.spots) },
      uEdge: { value: c('#3b2a1c') },
      uLeaf: { value: c(palette.leafLight) },
      uLeafDark: { value: c(palette.leafDark) },
      uMint: { value: c('#9ff2d6') },
      uSilver: { value: c('#e4fbff') },
      uPx: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute float aSize;
      attribute float aPhase;
      attribute float aKind;
      attribute float aHot;
      attribute float aPing;
      attribute float aCount;
      attribute float aSat;
      uniform float uTime;
      uniform float uPx;
      varying float vAlpha;
      varying float vKind;
      varying float vSpin;
      varying float vTw;
      varying float vPh;
      varying float vHot;
      varying float vGrow;
      varying float vPing;
      varying float vCount;
      varying float vSat;
      void main() {
        vec3 p = position;
        vPh = aPhase;
        float star = aKind < 0.5 || aKind > 2.5 ? 1.0 : 0.0;
        // the ✦ hangs nearly still with a slow breath; leaves and secrets bob a little
        p.y += sin(uTime * 1.3 + aPhase) * mix(0.05, 0.015, star);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        // hovered / focused: the sprite grows (room for the ring) — a folded group's
        // ✦ too (room for its satellites); the ✦ itself keeps its size
        vGrow = (1.0 + 0.24 * aHot * star) * (1.0 + 0.4 * aSat * step(0.5, aCount) * star);
        gl_PointSize = aSize * uPx * vGrow * step(0.001, aAlpha);
        vAlpha = aAlpha;
        vKind = aKind;
        vHot = aHot;
        vPing = aPing;
        vCount = aCount;
        vSat = aSat;
        vSpin = aKind > 0.5 && aKind < 1.5 ? 0.5 + 0.25 * sin(uTime * 1.6 + aPhase) : star > 0.5 ? 0.1 * sin(uTime * 0.6 + aPhase) : sin(uTime * 0.9 + aPhase) * 0.35 + uTime * 0.8;
        vTw = 0.82 + 0.18 * sin(uTime * 2.3 + aPhase * 3.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTimeF;
      uniform float uNight;
      uniform vec3 uCream;
      uniform vec3 uCore;
      uniform vec3 uEdge;
      uniform vec3 uLeaf;
      uniform vec3 uLeafDark;
      uniform vec3 uMint;
      uniform vec3 uSilver;
      varying float vAlpha;
      varying float vKind;
      varying float vSpin;
      varying float vTw;
      varying float vPh;
      varying float vHot;
      varying float vGrow;
      varying float vPing;
      varying float vCount;
      varying float vSat;
      void main() {
        vec2 uv0 = gl_PointCoord * 2.0 - 1.0;
        uv0.y = -uv0.y;
        vec2 uv = uv0 * vGrow;
        float cs = cos(vSpin), sn = sin(vSpin);
        vec2 q = mat2(cs, -sn, sn, cs) * uv;
        vec3 col;
        float a;
        float r = length(uv);
        if (vKind < 0.5 || vKind > 2.5) {
          float N = uNight;
          float H = vHot;
          float featured = step(2.5, vKind);
          // ✦: a four-point star with concave sides (|x|^p + |y|^p = R^p, p < 1)
          float R = mix(0.4, 0.46, N) + 0.05 * H;
          vec2 s = abs(q) / R;
          float sd = pow(s.x, 0.62) + pow(s.y, 0.62);
          float body = 1.0 - smoothstep(0.88, 1.08, sd);
          // its edge band: by night the ✦ is a bright outline round a half-clear core
          float edge = body * smoothstep(0.42, 0.82, sd);
          float core = exp(-dot(q, q) * 34.0);
          // by day a soft wisp of light round it and thin glint rays that twinkle;
          // by night next to no glow at all (no disc over the pieces)
          float wisp = exp(-r * r * 5.0) * (0.62 + 0.1 * vTw) + exp(-r * r * 1.8) * 0.18;
          float glow = mix(wisp * (1.0 + 0.25 * featured), exp(-r * r * 9.0) * 0.1, N) * (1.0 + 0.5 * H);
          float rays = (exp(-abs(q.x) * 46.0) * (1.0 - smoothstep(0.1, 0.92, abs(q.y)))
                      + exp(-abs(q.y) * 46.0) * (1.0 - smoothstep(0.1, 0.92, abs(q.x)))) * (0.3 + 0.3 * vTw) * (1.0 - N * 0.75) * (1.0 - body);
          // a dark hairline round the star by day: it holds on sunlit plaster and pale stone
          float keyline = (1.0 - smoothstep(1.1, 1.4, sd)) * (1.0 - body) * 0.3 * (1.0 - N);
          // the ring: by night always there (thin), by day only while hovered / focused
          float rr = length(uv0);
          float ringW = mix(0.035, 0.03, N) + 0.02 * H;
          float ring = exp(-pow((rr - 0.76) / ringW, 2.0)) * max(N * 0.8, H) * (0.75 + 0.25 * H);
          // the ping: a soft breath of light rolling out (vPing = seconds since it began)
          float pt = clamp(vPing / 1.8, 0.0, 1.0);
          float pr = mix(0.3, 0.96, 1.0 - (1.0 - pt) * (1.0 - pt));
          float ping = exp(-pow((rr - pr) / mix(0.13, 0.05, N), 2.0)) * (1.0 - pt) * (1.0 - pt) * step(vPing, 1.8) * mix(0.3, 0.38, N);
          // a folded group: one small glint per extra piece, circling slowly round the ✦
          float sats = 0.0;
          for (int i = 0; i < 4; i++) {
            if (float(i) < vCount) {
              float an = uTimeF * 0.35 + vPh + 6.2832 * float(i) / max(vCount, 1.0) + 0.6;
              vec2 d = uv0 - vec2(cos(an), sin(an)) * 0.62;
              sats += exp(-dot(d, d) * 260.0) + (exp(-abs(d.x) * 60.0) * exp(-abs(d.y) * 10.0) + exp(-abs(d.y) * 60.0) * exp(-abs(d.x) * 10.0)) * 0.55;
            }
          }
          sats = min(sats, 1.0) * vSat;
          // colours: by day a cream ✦ with a mint-white hot core in a pale mint-cream wisp;
          // by night warm cream, soft at rest — full brightness only when hovered / focused
          vec3 hotCore = mix(uSilver, uMint, 0.3);
          vec3 dayStar = mix(uCream, hotCore, clamp(core * 1.4, 0.0, 1.0)) * (1.3 + 0.15 * H) * (0.94 + 0.06 * vTw);
          vec3 nightStar = mix(uCream, hotCore, 0.3) * mix(0.95, 1.8, H);
          vec3 starCol = mix(dayStar, nightStar, N);
          vec3 glowCol = mix(mix(uMint, uCream, 0.38), uMint * 0.8, N);
          vec3 ringCol = mix(uCream, uMint, 0.5) * mix(1.05, mix(0.85, 1.7, H), N);
          float starA = body * mix(1.0, mix(0.5, 0.95, H), N);
          starA = max(starA, edge * N * 0.95);
          a = clamp(starA + glow * 0.75 + rays * 0.8 + ring + ping + keyline + sats, 0.0, 1.0);
          float ia = 1.0 / max(a, 1e-3);
          col = glowCol;
          col = mix(col, ringCol, clamp((ring + ping) * ia, 0.0, 1.0));
          col = mix(col, uCream * 1.25, clamp(rays * 0.8 * ia, 0.0, 1.0));
          col = mix(col, uCream * mix(1.25, 1.0, N), clamp(sats * ia, 0.0, 1.0));
          col = mix(col, uEdge, clamp(keyline * ia, 0.0, 1.0));
          col = mix(col, starCol, body);
          col = mix(col, starCol * 1.15, edge * N);
        } else if (vKind < 1.5) {
          // leaf: a lens shape with a midrib
          vec2 l = q * vec2(1.6, 1.0);
          float d = max(length(l - vec2(0.55, 0.0)), length(l + vec2(0.55, 0.0)));
          float leaf = 1.0 - smoothstep(1.0, 1.08, d);
          float edge = smoothstep(0.86, 0.98, d);
          float rib = (1.0 - smoothstep(0.0, 0.06, abs(q.x))) * step(abs(q.y), 0.75);
          col = mix(uLeaf, uLeafDark, max(edge, rib * 0.7)) * (1.0 + uNight * 0.35);
          float halo = exp(-r * r * 6.0) * 0.3 * (1.0 - uNight * 0.5);
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
