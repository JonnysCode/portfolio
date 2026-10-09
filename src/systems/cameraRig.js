// ─────────────────────────────────────────────────────────────────────────────
// Camera director — a diorama camera that glides between SPOTS (layout.js)
// and lets the visitor gently orbit, zoom and pan around the current one.
//
//   rig.goTo(spotId, { instant, duration })  → Promise (resolves on arrival)
//   rig.spot                        current spot id
//   rig.onSpotChange(fn(spotId, prevId)) → unsubscribe   (fires when a glide starts)
//   rig.onArrive(fn(spotId))         → unsubscribe        (fires when a spot glide lands)
//   rig.next() / rig.prev()         cycle through SPOTS
//   rig.focus(object3d | Vector3, { distance, lift, radius, azimuth, faceAzimuth, polar, spot })
//                                   frame a detail (entry panels): the centre of its
//                                   bounds, fitted into the free part of the screen,
//                                   swung around solid things in the sight line;
//                                   `spot` switches the current spot silently
//   rig.release()                   glide back to the current spot composition
//   rig.focused                     true while framing a detail
//   rig.transitioning               true while gliding
//   rig.target                      THREE.Vector3 the camera looks at (lighting/DOF follow it)
//   rig.focusDistance               distance camera → point of interest (for depth of field),
//                                   accurate during focus and orbiting; mid-glide it
//                                   follows whatever is in the middle of the frame
//   rig.setInset({ right, bottom, top }) keep the subject centred in the part of
//                                   the screen a panel / bottom sheet / HUD leaves free (px)
// Phones: SPOTS[].portrait (layout.js) is the composed shot on a tall screen.
//   rig.holdIntro()                 hover high above the canopy (behind the intro card)
//   rig.playIntro() → Promise       cinematic flight: down from above the canopy to eye
//                                   level on the path, a few steps among the giants, then
//                                   a crane up and back into the overview (input hurries it)
//   rig.setOverride(position, lookAt) / rig.clearOverride() / rig.snap()   (debug, cut-scenes)
//
// Feel: glides follow planned Bézier arcs that rise over obstacles and bend
// around the Great Oak (cameraObstacles.js); orbit has inertia and soft limits
// per spot; after a few idle seconds the camera "breathes" (a slow drift).
// Close-ups (focus) look for a clear line of sight: solid things by raycast,
// thin decor (fairy-light bulbs and wires, lanterns, lamp posts) by the soft
// occluders of cameraObstacles.js.
// prefers-reduced-motion: glides become soft cross-fade cuts, no drift.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { SPOTS, SPOT_BY_ID, CAMERA_LIMITS } from '../world/layout.js';
import { getHeight } from '../world/ground.js';
import { clamp, damp } from '../core/rng.js';
import { createCameraObstacles } from './cameraObstacles.js';

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * How far the visitor may wander around each spot's composition:
 * az = ± azimuth (rad), up/down = polar towards top-down / towards the horizon,
 * zoom = [in, out] factors of the composed distance, pan = max pan (world units).
 */
const ORBIT = {
  glen: { az: 0.62, up: 0.32, down: 0.1, zoom: [0.42, 1.22], pan: 9 },
  // (capSafe: swung far round, the deck's string lights and lamp posts sit right at the lens)
  woodworking: { az: 0.55, up: 0.42, down: 0.06, zoom: [0.42, 1.45], pan: 3.5, capSafe: 0.55 },
  code: { az: 0.5, up: 0.32, down: 0.12, zoom: [0.45, 1.4], pan: 3 },
  // (capSafe: orbited far round, a zoom-in would park the lens under the cap
  // rim / behind a door leaf — the closest zoom is held back a little there)
  home: { az: 0.5, up: 0.4, down: 0.06, zoom: [0.45, 1.4], pan: 3, capSafe: 0.6 },
  interior: { az: 0.5, up: 0.4, down: 0.06, zoom: [0.4, 1.45], pan: 3, capSafe: 0.6 },
  bikes: { az: 0.55, up: 0.4, down: 0.08, zoom: [0.42, 1.45], pan: 3.5, capSafe: 0.6 },
  focus: { az: 0.55, up: 0.35, down: 0.12, zoom: [0.55, 1.8], pan: 1.2 },
};

/**
 * The intro flight: hover just above the glen, framed by the giant trunks and
 * the canopy (behind the intro card); then sink in over the front of the glen
 * down to eye level on the main path — tiny among the giants, ferns blurring
 * past the lens, looking up the trunk of the Great Oak to its loft — glide a
 * few steps along the path, and crane up and back into the overview.
 * keys: { t (s), position, target, focus (depth of field), fov (+ fovPortrait on phones) }.
 * The first key is the hover pose, the last one the glen spot's composition.
 */
const INTRO = {
  hover: { position: [10, 50, 72], target: [0, 3, -4] },
  keys: [
    { t: 2.9, position: [7.5, 19, 43], target: [0, 5.5, -4], focus: [0, 3, -3], fov: 40, fovPortrait: 12 },
    { t: 4.8, position: [1.8, 3.4, 28.5], target: [0, 6.4, -4], focus: [0, 2.6, -2.6], fov: 42, fovPortrait: 17 },
    // touching down on the path, then eye level: the giants rise out of the frame, the oak's door glows ahead
    { t: 5.7, position: [0.4, 1.55, 23.6], target: [0, 6.8, -4], focus: [0, 2.2, -2.6], fov: 43, fovPortrait: 19 },
    { t: 6.6, position: [0.1, 1.45, 21.2], target: [0, 6.9, -4], focus: [0, 2.2, -2.6], fov: 43, fovPortrait: 19 },
    { t: 8.4, position: [0.2, 1.5, 17.0], target: [0, 7.2, -4], focus: [0, 2.2, -2.6], fov: 43, fovPortrait: 19 },
    // the crane: up first, then back into the overview
    { t: 9.6, position: [0.7, 4.4, 18.9], target: [0, 7.0, -3.5], focus: [0, 3, -2.4], fov: 42, fovPortrait: 17 },
  ],
  duration: 12,
  /** Any input during the flight hurries it along (× speed). */
  hurry: 3.5,
};

/** Monotone cubic interpolation (Fritsch–Carlson) through (xs, ys), flat at both ends. */
function monotone(xs, ys) {
  const n = xs.length;
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/**
 * Close-up framing per entry (merged over the hotspot's / UI's focus options):
 * the coffee table's and the dining table's bounds include the rug and the
 * chairs, so their close-ups stood far back — framed on the piece itself, a
 * little from above. (Clear sight lines past the fairy lights, the rose arch
 * and the lamp posts are found by the search below, not by tweaks.)
 *   quiet: frame the entry's marker-less sibling hotspot instead (About Me: the
 *          portrait in the window, not the door leaf — the big arch stones and
 *          the stepping-stone slabs read as smeared slabs this close)
 *   offset: [x, y, z] world offset of the look point (from the window down to
 *          the bench under it, where the cat sleeps)
 */
const FRAMING = {
  'coffee-table': { radius: 0.62, lift: 0.08, polar: 1.1 },
  'dining-table': { radius: 1.05, polar: 1.12 },
  'about-me': { quiet: true, offset: [0.25, -0.95, -0.2], radius: 1.35, azimuth: 0.32, polar: 1.3, distance: 3.6 },
  // the hero bike, swung away from the mechanic at its rear wheel (his head filled the left of the frame)
  'bike-build': { azimuth: 0.45 },
  // This Woodland: the lens sits in the big window's opening, so the casement
  // frames and the transom (within a hand's width) dissolve in the near fade
  'this-portfolio': { distance: 1.75 },
};

/** How much of the free part of the screen a framed detail may fill (its bounding sphere). */
const FOCUS_FILL = 0.8;
/** Camera positions tried around a framed detail: [azimuth offset, polar offset] (rad), best first. */
const FOCUS_TRIES = [[0, 0], [0.3, 0], [-0.3, 0], [0, -0.22], [0.3, -0.2], [-0.3, -0.2], [0.55, 0], [-0.55, 0]];
/** search: 'wide' (a secret tucked between things): swing further round and look more from above. */
const FOCUS_TRIES_WIDE = [...FOCUS_TRIES, [0, -0.42], [0.3, -0.42], [-0.3, -0.42], [0.55, -0.4], [-0.55, -0.4], [0.85, -0.2], [-0.85, -0.2], [0.85, -0.42], [-0.85, -0.42], [1.15, -0.3], [-1.15, -0.3]];
/** Rays beside the lens (in fifths of the frame: right, up) that sweep the near part of a framing. */
const NEAR_RAYS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
/** …and for a wide search also two fifths out (a rail across the bottom third counts as blocking). */
const NEAR_RAYS_WIDE = [...NEAR_RAYS, [0, -2], [-2, 0], [2, 0], [0, 2]];
/** Soft occluders (cameraObstacles decor) are looked for along these lines too (fifths of the frame), and cost: */
const DECOR_RAYS = [[0, -1], [0, 1], [-1, 0], [1, 0], [-2, -1], [2, -1], [-2, 1], [2, 1]];
const DECOR_CENTRE = 0.5;
const DECOR_SIDE = 0.12;

/** Convert a composed shot (position + target) into orbit parameters. */
function toOrbit(position, target) {
  const dx = position[0] - target[0], dy = position[1] - target[1], dz = position[2] - target[2];
  const distance = Math.hypot(dx, dy, dz);
  return {
    target: new THREE.Vector3(...target),
    azimuth: Math.atan2(dx, dz),
    polar: Math.acos(clamp(dy / distance, -1, 1)),
    distance,
  };
}

export function createCameraRig(ctx) {
  const { engine, camera } = ctx;
  const canvas = engine.renderer.domElement;
  const reduced = engine.reducedMotion;
  const L = CAMERA_LIMITS;
  const obstacles = createCameraObstacles(ctx);

  // ── live orbit state (what is rendered when not gliding) ──────────────────
  const target = new THREE.Vector3(); // the look point (before the inset shift)
  let azimuth = 0, polar = 1, distance = 30, fov = camera.fov;
  // user offsets on top of the composition
  let dAz = 0, dPol = 0, zoom = 1;
  const pan = new THREE.Vector3();
  let velAz = 0, velPol = 0;
  const good = { dAz: 0, dPol: 0, zoom: 1, pan: new THREE.Vector3() };
  // compositions
  let base = null; // current spot
  let focusBase = null; // a framed detail
  let spot = null;
  let transition = null;
  let override = null;
  let introHover = false;
  // the point of interest (depth of field)
  const focusPoint = new THREE.Vector3(0, 4, -2);
  /** 0..1 this frame: how much the depth of field follows the centre of the frame instead (mid-glide). */
  let glideFocusW = 0;
  // idle "breathing"
  let idle = 0;
  let breathW = 0;
  // screen inset (panel / bottom sheet / HUD strip), smoothed
  const inset = { right: 0, bottom: 0, top: 0, r: 0, b: 0, t: 0 };
  /** The canvas' CSS size (it is sized to the visible viewport; projections use the same box). */
  const viewW = () => canvas.clientWidth || innerWidth || 1;
  const viewH = () => canvas.clientHeight || innerHeight || 1;
  const spotListeners = new Set();
  const arriveListeners = new Set();
  let dragging = false;
  let azPinned = 0;
  /** +1 / −1 while the orbit stands at its limit that way (the soft limit or something solid), else 0. */
  let azEdge = 0;
  let azPrev = 0;

  /** 0 on landscape screens → 1 on a tall phone: compositions were made for 16:9. */
  function portrait() {
    const aspect = camera.aspect || viewW() / viewH();
    return clamp((1.3 - aspect) / 0.8, 0, 1);
  }

  function spotBase(id) {
    const s = SPOT_BY_ID[id];
    const o = toOrbit(s.camera.position, s.camera.target);
    o.fov = s.camera.fov ?? 40;
    o.focus = new THREE.Vector3(...(s.focus ?? s.camera.target));
    o.range = ORBIT[id] ?? ORBIT.woodworking;
    o.spot = id;
    const p = portrait();
    if (p > 0 && s.portrait) {
      // a tall phone screen has its own composed shot (layout.js SPOTS[].portrait);
      // tablets in portrait get a blend of the two
      const q = toOrbit(s.portrait.position ?? s.camera.position, s.portrait.target ?? s.camera.target);
      o.target.lerp(q.target, p);
      o.azimuth += wrap(q.azimuth - o.azimuth) * p;
      o.polar += (q.polar - o.polar) * p;
      o.distance += (q.distance - o.distance) * p;
      o.fov += ((s.portrait.fov ?? o.fov + 5) - o.fov) * p;
      if (s.portrait.focus) o.focus.lerp(new THREE.Vector3(...s.portrait.focus), p);
    } else if (p > 0) {
      // no composed phone shot: step back, look a little more from above, widen
      // the lens a touch, and slide the look point onto the subject (the 16:9
      // shots are composed off-centre)
      const glen = id === 'glen';
      o.distance *= 1 + p * (glen ? 0.45 : 0.28);
      o.polar = Math.max(L.minPolar, o.polar - p * (glen ? 0.2 : 0.07));
      o.fov += p * 5;
      if (!glen) o.target.lerp(o.focus, p * 0.6);
    }
    return o;
  }

  // ── framing a detail ─────────────────────────────────────────────────────
  const fBox = new THREE.Box3();
  const fV = new THREE.Vector3();
  const fQ = new THREE.Quaternion();
  const F_UP = new THREE.Vector3(0, 1, 0);
  /**
   * How far along the sight line target → eye the first solid thing sits
   * (0..1, 1 = clear). The subject itself and things hugging it are ignored.
   */
  function sightClear(from, to, subject, skipNear) {
    const it = ctx.interactions;
    if (!it?.firstSolidHit) return 1;
    const d = from.distanceTo(to);
    const dir = fV.subVectors(to, from).divideScalar(d || 1);
    const hit = it.firstSolidHit(from, dir, skipNear, d * 0.96, subject);
    return hit === Infinity ? 1 : hit / d;
  }

  /** Distance at which a sphere of `radius` fits the free part of the screen (insets). */
  function fitDistance(radius, fovDeg) {
    const W = viewW(), H = viewH();
    const freeW = Math.max(140, W - inset.right - 24);
    const freeH = Math.max(140, H - inset.bottom - inset.top - 16);
    const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
    const tanH = tanV * (W / H);
    return Math.max(radius * H / (tanV * FOCUS_FILL * freeH), radius * W / (tanH * FOCUS_FILL * freeW));
  }

  function resetOffsets() {
    azEdge = 0;
    azPrev = 0;
    dAz = dPol = 0;
    zoom = 1;
    pan.set(0, 0, 0);
    velAz = velPol = 0;
    good.dAz = good.dPol = 0;
    good.zoom = 1;
    good.pan.set(0, 0, 0);
  }

  /** Camera position of an orbit pose. */
  function posePosition(o, out = new THREE.Vector3()) {
    return out.setFromSphericalCoords(o.distance, o.polar, o.azimuth).add(o.target);
  }

  // ── glides ────────────────────────────────────────────────────────────────
  const camPos = new THREE.Vector3();
  const lookAt = new THREE.Vector3();

  /**
   * Glide from wherever the camera is now to an orbit pose along a planned arc.
   * kind: 'spot' | 'focus' | 'release'
   */
  function glideTo(dest, { duration, kind = 'spot', arriveSpot = null } = {}) {
    if (transition?.resolve) transition.resolve(false);
    introHover = false;
    const p0 = camera.position.clone();
    const t0 = target.clone();
    const p3 = posePosition(dest);
    const hop = p0.distanceTo(p3);
    const f0 = focusPoint.clone();
    const f3 = dest.focus.clone();
    // reduced motion: a soft cross-fade cut instead of flying
    if (reduced) {
      return new Promise((resolve) => {
        const jump = () => {
          applyPose(dest);
          focusPoint.copy(f3);
          if (arriveSpot) for (const fn of arriveListeners) fn(arriveSpot);
          resolve(true);
        };
        const fade = ctx.ui?.fade;
        if (fade && kind === 'spot') fade(true).then(() => (jump(), fade(false)));
        else jump();
      });
    }
    let p1, p2;
    if (hop < 7) {
      // short hops (framing a detail): a straight, gently lifted glide
      p1 = p0.clone().lerp(p3, 0.33);
      p2 = p0.clone().lerp(p3, 0.67);
      p1.y += hop * 0.08;
      p2.y += hop * 0.08;
    } else {
      // (the look points ride along: the planner rejects arcs on which a cap fills the frame)
      const plan = obstacles.plan(p0, p3, { lift: Math.min(5, hop * 0.1), t0, t3: dest.target, fov: Math.max(fov, dest.fov ?? fov), aspect: camera.aspect || 16 / 9 });
      p1 = plan.p1;
      p2 = plan.p2;
    }
    const dur = duration ?? clamp(1.25 + hop * 0.045, kind === 'spot' ? 1.8 : 1.1, 3.6);
    return new Promise((resolve) => {
      transition = {
        kind,
        t: 0,
        duration: dur,
        resolve,
        arriveSpot,
        dest,
        fov0: fov,
        position: (k, out) => obstacles.bezier(p0, p1, p2, p3, k, out),
        handles: [p0, p1, p2, p3],
        look0: t0,
        // the eye leads the body a little: the look point travels slightly ahead
        target: (k, out) => out.lerpVectors(t0, dest.target, Math.min(1, k * 1.08 - 0.08 * k * k)),
        f0,
        f3,
        ease: easeInOut,
      };
    });
  }

  function applyPose(o) {
    target.copy(o.target);
    azimuth = o.azimuth;
    polar = o.polar;
    distance = o.distance;
    fov = o.fov ?? fov;
    transition = null;
    resetOffsets();
  }

  // ── input (shared pointer gestures + wheel) ──────────────────────────────
  const right = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  function panBy(dx, dy) {
    const k = distance * 0.0015;
    right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    fwd.set(right.z, 0, -right.x);
    pan.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k);
  }
  const canInput = () => !override && !introHover && !(transition && transition.kind === 'intro');
  /** A visitor who touches anything during the intro flight wants to get going: speed it up. */
  const hurryIntro = () => {
    if (transition?.kind === 'intro') transition.hurry = true;
  };
  canvas.addEventListener('pointerdown', hurryIntro);
  window.addEventListener('keydown', (e) => {
    if (!e.metaKey && !e.ctrlKey && !e.altKey) hurryIntro();
  });
  const gestures = ctx.interactions?.gestures;
  if (gestures) {
    gestures.on('input', () => (idle = 0));
    gestures.on('dragstart', () => {
      dragging = true;
      velAz = velPol = 0;
      // where the orbit stood when the finger went down (a swipe travels only from the edge of the orbit)
      azPinned = azEdge;
    });
    gestures.on('drag', ({ dx, dy, button, pointerType, shift }) => {
      if (!canInput()) return;
      if (transition) {
        // grabbing the camera mid-glide: stop where we are and hand over
        if (transition.kind !== 'intro') settleTransition();
        else return;
      }
      if (button === 2 || shift) return panBy(dx, dy);
      const k = pointerType === 'mouse' ? 1 : 1.25;
      dAz -= dx * 0.0042 * k;
      dPol -= dy * 0.0032 * k;
    });
    gestures.on('dragend', ({ vx, vy, totalX, totalY, ms, pointerType }) => {
      dragging = false;
      if (!canInput()) return;
      // a quick horizontal flick on touch travels to the next / previous spot —
      // but only once the camera has already swung as far round as it goes that
      // way (the first flick looks around, the next one moves on), and with an
      // undo toast: a visitor who just wanted to look must never be lost
      const flick = Math.abs(totalX) > 70 && ms < 380 && Math.abs(totalX) > 2.2 * Math.abs(totalY);
      const toward = totalX < 0 ? 1 : -1; // dragging left swings dAz up
      if (pointerType !== 'mouse' && !ctx.ui?.isPanelOpen && flick && azPinned === toward) {
        const from = spot;
        if (totalX < 0) rig.next();
        else rig.prev();
        ctx.ui?.swipeTravelled?.(from, spot);
        return;
      }
      if (reduced) return;
      const k = pointerType === 'mouse' ? 1 : 1.25;
      velAz = clamp(-vx * 0.0042 * k, -2.5, 2.5);
      velPol = clamp(-vy * 0.0032 * k, -1.5, 1.5);
    });
    gestures.on('pinch', ({ scale, dx, dy }) => {
      if (!canInput()) return;
      if (transition) settleTransition();
      zoom /= Math.max(0.5, Math.min(2, scale));
      panBy(dx, dy);
    });
  }
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      idle = 0;
      hurryIntro();
      if (!canInput()) return;
      if (transition) settleTransition();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoom *= Math.exp(clamp(d, -120, 120) * (e.ctrlKey ? 0.006 : 0.0012));
    },
    { passive: false },
  );

  /** Stop a running glide in place (the visitor grabbed the camera). */
  function settleTransition() {
    const tr = transition;
    if (!tr) return;
    transition = null;
    // the glide's destination becomes the composition we orbit around, but the
    // current view is kept: express it as offsets from the destination
    const o = tr.dest;
    dAz = wrap(azimuth - o.azimuth);
    dPol = polar - o.polar;
    zoom = distance / o.distance;
    pan.copy(target).sub(o.target);
    focusPoint.copy(tr.f3);
    tr.resolve?.(true);
    if (tr.arriveSpot) for (const fn of arriveListeners) fn(tr.arriveSpot);
  }

  // ── public API ────────────────────────────────────────────────────────────
  const rig = {
    target,
    focusDistance: 20,
    get spot() {
      return spot;
    },
    get focused() {
      return !!focusBase;
    },
    get transitioning() {
      return !!transition;
    },
    /** Debug / QA: the running glide's Bézier handles and look points (null when not gliding a planned arc). */
    get glide() {
      const tr = transition;
      return tr?.handles ? { handles: tr.handles, t0: tr.look0, t3: tr.dest.target, fov: Math.max(tr.fov0, tr.dest.fov ?? tr.fov0) } : null;
    },
    obstacles,
    onSpotChange(fn) {
      spotListeners.add(fn);
      return () => spotListeners.delete(fn);
    },
    onArrive(fn) {
      arriveListeners.add(fn);
      return () => arriveListeners.delete(fn);
    },
    goTo(id, { instant = false, duration } = {}) {
      if (!SPOT_BY_ID[id]) return Promise.resolve(false);
      const prev = spot;
      spot = id;
      focusBase = null;
      base = spotBase(id);
      introHover = false;
      if (prev !== id) for (const fn of spotListeners) fn(id, prev);
      if (instant) {
        applyPose(base);
        focusPoint.copy(base.focus);
        for (const fn of arriveListeners) fn(id);
        return Promise.resolve(true);
      }
      resetOffsets();
      return glideTo(base, { duration, kind: 'spot', arriveSpot: id });
    },
    next() {
      const i = SPOTS.findIndex((s) => s.id === spot);
      return rig.goTo(SPOTS[(i + 1) % SPOTS.length].id);
    },
    prev() {
      const i = SPOTS.findIndex((s) => s.id === spot);
      return rig.goTo(SPOTS[(i - 1 + SPOTS.length) % SPOTS.length].id);
    },
    /**
     * Frame a detail. `what` is an Object3D (framed around the centre of its
     * bounds, far enough away that it fits the part of the screen the journal
     * page / HUD leave free) or a point (+ opts.height).
     * opts: { distance (minimum, default 4), lift (raise the look point), azimuth
     *         (offset from the spot camera's side, rad), faceAzimuth (instead:
     *         relative to the object's own +Z front), polar (absolute), radius
     *         (override the bounds), spot }
     * A sight line blocked by something solid (a lantern, a post, a railing)
     * swings the camera a little around the detail, or moves it in closer.
     */
    focus(what, opts = {}) {
      const entryId = what?.isObject3D ? what.userData?.__hotspot?.entryId : null;
      if (entryId && FRAMING[entryId]) {
        opts = { ...opts, ...FRAMING[entryId] };
        if (opts.quiet) {
          const sib = ctx.interactions?.hotspots?.find((h) => h.entryId === entryId && h.marker === false && h.enabled);
          if (sib) what = sib.object;
        }
      }
      const p = new THREE.Vector3();
      let radius = opts.radius ?? 0;
      let facing = null;
      const subject = what?.isObject3D ? what : null;
      if (subject) {
        subject.updateWorldMatrix(true, true);
        fBox.setFromObject(subject);
        if (fBox.isEmpty()) {
          subject.getWorldPosition(p);
          if (opts.height) p.y += opts.height;
        } else {
          fBox.getCenter(p);
          if (!radius) radius = fBox.getSize(fV).length() * 0.5;
        }
        if (opts.faceAzimuth !== undefined) {
          fV.set(0, 0, 1).applyQuaternion(subject.getWorldQuaternion(fQ));
          facing = Math.atan2(fV.x, fV.z) + opts.faceAzimuth;
        }
      } else {
        p.copy(what);
        if (opts.height) p.y += opts.height;
      }
      p.y += opts.lift ?? 0;
      if (opts.offset) p.add(fV.set(opts.offset[0], opts.offset[1], opts.offset[2]));
      // clicked from another spot (e.g. the overview): that spot becomes current
      if (opts.spot && SPOT_BY_ID[opts.spot] && opts.spot !== spot) {
        const prev = spot;
        spot = opts.spot;
        base = spotBase(spot);
        for (const fn of spotListeners) fn(spot, prev);
      }
      const b = base ?? spotBase('glen');
      // look at the detail from the side its spot camera was composed from
      const cam = SPOT_BY_ID[b.spot]?.camera.position ?? [0, 10, 30];
      const hx = cam[0] - p.x, hz = cam[2] - p.z;
      const az0 = facing ?? Math.atan2(hx, hz) + (opts.azimuth ?? 0);
      const elev = Math.atan2(cam[1] - p.y, Math.hypot(hx, hz));
      const pol = opts.polar ?? clamp(Math.PI / 2 - elev - 0.06, 0.95, 1.38);
      const fovNow = b.fov;
      const minD = (opts.distance ?? 4) * (1 + portrait() * 0.12);
      let dist = Math.max(minD, radius ? Math.min(fitDistance(radius, fovNow), minD * 3) : 0);
      // a clear line of sight: try the composed side first, then swing around
      // it (and a little higher). Besides the centre line, four rays towards
      // points beside the lens sweep the near part of the frame, so a post, a
      // lantern or a cap right in front of the camera counts as blocking too.
      let az = az0, polF = pol;
      if (subject) {
        const eye = new THREE.Vector3(), side = new THREE.Vector3(), upv = new THREE.Vector3(), q = new THREE.Vector3();
        const skip = Math.min(0.5, radius * 0.6);
        const decorSkip = Math.min(0.9, radius * 0.75 + 0.15);
        const tanV = Math.tan(THREE.MathUtils.degToRad(fovNow) / 2);
        let best = { az: az0, pol, clear: -1, score: -Infinity, dist, found: false };
        const wide = opts.search === 'wide';
        // (a wide search also steps back — a secret wedged between a trunk and a deck
        // may only be seen from a little further away, over the things around it)
        search: for (const kd of wide ? [1, 1.45, 1.9] : [1]) {
          const dd = dist * kd;
          for (const [dAz, dPol] of wide ? FOCUS_TRIES_WIDE : FOCUS_TRIES) {
            const pp = clamp(pol + dPol, wide ? 0.55 : 0.75, 1.45);
            eye.setFromSphericalCoords(dd, pp, az0 + dAz).add(p);
            if (eye.y < getHeight(eye.x, eye.z) + 0.5 || obstacles.penetration(eye) > 0.05) continue;
            const clear = sightClear(p, eye, subject, skip);
            let score = clear;
            fV.subVectors(p, eye).normalize();
            side.crossVectors(fV, F_UP).normalize();
            upv.crossVectors(side, fV);
            const k = dd * tanV * 0.2;
            if (clear >= 0.999) {
              // the near field: rays to points a fifth of the frame beside / above / below the lens
              let off = 1;
              for (const [a, b] of wide ? NEAR_RAYS_WIDE : NEAR_RAYS) {
                q.copy(eye).addScaledVector(side, a * k * camera.aspect).addScaledVector(upv, b * k);
                off = Math.min(off, sightClear(p, q, subject, skip));
              }
              score = 1 + off;
            }
            // soft occluders too thin for the rays (fairy-light bulbs and their wire,
            // lanterns, lamp posts): a bulb across the middle of a close-up — or
            // strung across its near field — ruins it as surely as a wall
            if (obstacles.decorAlong(eye, p, decorSkip)) score -= DECOR_CENTRE;
            for (const [a, b] of DECOR_RAYS) {
              q.copy(eye).addScaledVector(side, a * k * camera.aspect).addScaledVector(upv, b * k);
              if (obstacles.decorAlong(q, p, decorSkip)) score -= DECOR_SIDE;
            }
            if (score > best.score + 0.02) best = { az: az0 + dAz, pol: pp, clear, score, dist: dd, found: true };
            if (score >= 1.97) break search;
          }
        }
        // a secret with no clear look from anywhere: better to stay put than to park inside something
        if (wide && !best.found) return Promise.resolve(false);
        dist = best.dist;
        az = best.az;
        polF = best.pol;
        // still blocked: move in front of the obstacle (never closer than the detail's own size)
        if (best.clear >= 0 && best.clear < 0.999) dist = Math.max(radius * 1.25 + 0.4, Math.min(dist, dist * best.clear - 0.35));
      }
      focusBase = {
        target: p,
        azimuth: az,
        polar: polF,
        distance: dist,
        fov: fovNow,
        focus: p.clone(),
        range: ORBIT.focus,
        spot: b.spot,
      };
      resetOffsets();
      return glideTo(focusBase, { kind: 'focus' });
    },
    release() {
      if (!focusBase) return Promise.resolve(true);
      focusBase = null;
      if (!base) return Promise.resolve(true);
      resetOffsets();
      return glideTo(base, { kind: 'release' });
    },
    setInset({ right = 0, bottom = 0, top = 0 } = {}) {
      inset.right = right;
      inset.bottom = bottom;
      inset.top = top;
    },
    setOverride(position, lookAtPoint) {
      override = { position: new THREE.Vector3().copy(position), lookAt: new THREE.Vector3().copy(lookAtPoint) };
    },
    clearOverride() {
      override = null;
    },
    get overridden() {
      return !!override;
    },
    /** Finish any running glide immediately. */
    snap() {
      if (transition) transition.t = transition.duration;
    },
    /** Hover high above the canopy (behind the intro card), slowly drifting. */
    holdIntro() {
      if (transition?.resolve) transition.resolve(false);
      transition = null;
      introHover = true;
      spot = null;
      target.set(...INTRO.hover.target);
      focusPoint.set(0, 4, -2);
    },
    /**
     * The cinematic flight from above the canopy down to eye level on the path,
     * a few steps towards the oak, then up and back into the glen overview.
     */
    playIntro() {
      const glen = spotBase('glen');
      const prev = spot;
      spot = 'glen';
      base = glen;
      focusBase = null;
      introHover = false;
      resetOffsets();
      if (prev !== 'glen') for (const fn of spotListeners) fn('glen', prev);
      if (reduced) return glideTo(glen, { kind: 'spot', arriveSpot: 'glen' });
      if (transition?.resolve) transition.resolve(false);
      const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
      const pq = portrait();
      const keys = INTRO.keys;
      const P = [camera.position.clone(), ...keys.map((k) => v3(k.position)), posePosition(glen)];
      const T = [target.clone(), ...keys.map((k) => v3(k.target)), glen.target.clone()];
      const F = [focusPoint.clone(), ...keys.map((k) => v3(k.focus ?? k.target)), glen.focus.clone()];
      const fovs = [fov, ...keys.map((k) => (k.fov ?? 40) + pq * (k.fovPortrait ?? 0)), glen.fov];
      const times = [0, ...keys.map((k) => k.t), INTRO.duration];
      const us = P.map((_, i) => i / (P.length - 1));
      const pc = new THREE.CatmullRomCurve3(P, false, 'centripetal');
      const tc = new THREE.CatmullRomCurve3(T, false, 'centripetal');
      const fc = new THREE.CatmullRomCurve3(F, false, 'centripetal');
      // (time → curve parameter: each key reached at its own time, speed continuous through it)
      const toU = monotone(times, us);
      const fovAt = monotone(us, fovs);
      return new Promise((resolve) => {
        transition = {
          kind: 'intro',
          t: 0,
          duration: INTRO.duration,
          resolve,
          arriveSpot: 'glen',
          dest: glen,
          fov0: fov,
          position: (k, out) => pc.getPoint(k, out),
          target: (k, out) => tc.getPoint(k, out),
          focusAt: (k, out) => fc.getPoint(k, out),
          fovAt,
          f0: focusPoint.clone(),
          f3: glen.focus.clone(),
          ease: (lin) => toU(lin * INTRO.duration),
        };
      });
    },
  };

  // ── per frame ─────────────────────────────────────────────────────────────
  const offset = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const look = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const fwdV = new THREE.Vector3();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);

  engine.addUpdate((dt, t) => {
    if (override) {
      camera.position.copy(override.position);
      camera.lookAt(override.lookAt);
      target.copy(override.lookAt);
      rig.focusDistance = camera.position.distanceTo(override.lookAt);
      applyDofScale();
      return;
    }
    idle += dt;
    const goal = focusBase ?? base;

    if (introHover) {
      // high above the canopy, slowly circling while the intro card is up
      const a = reduced ? 0 : Math.sin(t * 0.07) * 0.05;
      const [hx, hy, hz] = INTRO.hover.position;
      const tg = INTRO.hover.target;
      const ox = hx - tg[0], oz = hz - tg[2];
      camPos.set(tg[0] + ox * Math.cos(a) + oz * Math.sin(a), hy + (reduced ? 0 : Math.sin(t * 0.11) * 0.6), tg[2] - ox * Math.sin(a) + oz * Math.cos(a));
      target.set(...tg);
      distance = camPos.distanceTo(target);
    } else if (transition) {
      const tr = transition;
      tr.t = Math.min(tr.duration, tr.t + dt * (tr.hurry ? INTRO.hurry : 1));
      const lin = tr.t / tr.duration;
      const k = tr.ease(lin);
      tr.position(k, camPos);
      tr.target(k, target);
      fov = tr.fovAt ? tr.fovAt(k) : tr.fov0 + ((tr.dest.fov ?? fov) - tr.fov0) * k;
      if (tr.focusAt) tr.focusAt(k, focusPoint);
      else {
        focusPoint.lerpVectors(tr.f0, tr.f3, k);
        // mid-glide the lerped subject floats in empty air: focus on what the
        // lens looks at instead (fading in and out with the glide)
        glideFocusW = tr.kind === 'focus' ? 0 : Math.sin(Math.PI * lin);
      }
      // keep the orbit state in sync so a new glide / grab starts from here
      offset.subVectors(camPos, target);
      distance = Math.max(0.01, offset.length());
      azimuth = Math.atan2(offset.x, offset.z);
      polar = Math.acos(clamp(offset.y / distance, -1, 1));
      if (tr.t >= tr.duration) {
        transition = null;
        target.copy(tr.dest.target);
        azimuth = tr.dest.azimuth;
        polar = tr.dest.polar;
        distance = tr.dest.distance;
        fov = tr.dest.fov ?? fov;
        focusPoint.copy(tr.f3);
        tr.resolve?.(true);
        if (tr.arriveSpot) for (const fn of arriveListeners) fn(tr.arriveSpot);
      }
    } else if (goal) {
      const R = goal.range ?? ORBIT.woodworking;
      // inertia after a flick
      if (!dragging) {
        const decay = Math.exp(-4.2 * dt);
        dAz += velAz * dt;
        dPol += velPol * dt;
        velAz *= decay;
        velPol *= decay;
      }
      // soft limits around the composition
      const azWant = dAz;
      dAz = clamp(dAz, -R.az, R.az);
      if (azWant > dAz + 1e-4) azEdge = 1;
      else if (azWant < dAz - 1e-4) azEdge = -1;
      else if (azEdge && (dAz - azPrev) * azEdge < -0.01) azEdge = 0; // swung back away from the edge
      const polMin = Math.max(L.minPolar, goal.polar - R.up), polMax = Math.min(L.maxPolar, goal.polar + R.down);
      dPol = clamp(goal.polar + dPol, Math.min(polMin, goal.polar), Math.max(polMax, goal.polar)) - goal.polar;
      zoom = clamp(zoom, R.capSafe && Math.abs(dAz) > 0.3 ? Math.max(R.zoom[0], R.capSafe) : R.zoom[0], R.zoom[1]);
      if (pan.length() > R.pan) pan.setLength(R.pan);
      // never orbit into a trunk, a cap or the ground: refuse the move instead
      const dist0 = clamp(goal.distance * zoom, 1.4, L.maxDistance);
      look.copy(goal.target).add(pan);
      const tb = L.targetBox;
      if (goal === base) look.set(clamp(look.x, tb.minX, tb.maxX), clamp(look.y, tb.minY, tb.maxY), clamp(look.z, tb.minZ, tb.maxZ));
      desired.setFromSphericalCoords(dist0, goal.polar + dPol, goal.azimuth + dAz).add(look);
      if (dAz !== 0 || dPol !== 0 || zoom !== 1 || pan.lengthSq() > 0) {
        if (goal.basePen === undefined) goal.basePen = obstacles.penetration(posePosition(goal, tmp));
        if (obstacles.penetration(desired) > goal.basePen + 0.05) {
          if (Math.abs(dAz - good.dAz) > 1e-4) azEdge = dAz > good.dAz ? 1 : -1;
          dAz = good.dAz;
          dPol = good.dPol;
          zoom = good.zoom;
          pan.copy(good.pan);
          velAz = velPol = 0;
        } else {
          good.dAz = dAz;
          good.dPol = dPol;
          good.zoom = zoom;
          good.pan.copy(pan);
        }
      }
      azPrev = dAz;
      // idle breathing: a slow, barely-there drift once the visitor rests
      const wantBreath = !reduced && idle > 3.5 && !dragging && !ctx.ui?.isModalOpen ? 1 : 0;
      breathW += (wantBreath - breathW) * damp(wantBreath ? 0.6 : 5, dt);
      const bAz = breathW * (0.03 * Math.sin(t * 0.17) + 0.012 * Math.sin(t * 0.41 + 1.3));
      const bPol = breathW * 0.014 * Math.sin(t * 0.23 + 2.1);
      const bDist = 1 + breathW * 0.018 * Math.sin(t * 0.13 + 0.7);
      const bY = breathW * 0.07 * Math.sin(t * 0.29 + 0.4);

      const k = damp(6.5, dt);
      azimuth += wrap(goal.azimuth + dAz + bAz - azimuth) * k;
      polar += (goal.polar + dPol + bPol - polar) * k;
      distance += (dist0 * bDist - distance) * k;
      look.y += bY;
      target.lerp(look, k);
      fov += ((goal.fov ?? fov) - fov) * k;
      // depth of field follows the subject (the target when panned far away)
      focusPoint.lerp(pan.lengthSq() > 4 ? look : goal.focus, k);
      offset.setFromSphericalCoords(distance, polar, azimuth);
      camPos.copy(target).add(offset);
    } else {
      offset.setFromSphericalCoords(distance, polar, azimuth);
      camPos.copy(target).add(offset);
    }

    // never below the moss
    const floor = getHeight(camPos.x, camPos.z) + 0.6;
    if (camPos.y < floor) camPos.y = floor;
    camera.position.copy(camPos);
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    // keep the subject centred in the free part of the screen (panel / sheet)
    const ki = damp(4.5, dt);
    inset.r += (inset.right - inset.r) * ki;
    inset.b += (inset.bottom - inset.b) * ki;
    inset.t += (inset.top - inset.t) * ki;
    lookAt.copy(target);
    if (inset.r > 0.5 || Math.abs(inset.b - inset.t) > 0.5) {
      const W = viewW(), H = viewH();
      fwdV.subVectors(target, camPos);
      const d = fwdV.length();
      fwdV.divideScalar(d || 1);
      camRight.crossVectors(fwdV, WORLD_UP).normalize();
      camUp.crossVectors(camRight, fwdV);
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      lookAt.addScaledVector(camRight, (inset.r / W) * d * tanV * camera.aspect);
      // the subject sits in the middle of the band between the top and bottom insets
      lookAt.addScaledVector(camUp, -((inset.b - inset.t) / H) * d * tanV);
    }
    camera.lookAt(lookAt);
    let fd = camPos.distanceTo(focusPoint);
    if (glideFocusW > 0.001 && transition) {
      // what sits in the middle of the frame: the first thing (ground, trunk, cap,
      // house) along the line of sight, or the look point when the view is open
      const hit = centreHit(camPos, lookAt);
      fd += (hit - fd) * glideFocusW;
    }
    glideFocusW = 0;
    rig.focusDistance = fd;
    applyDofScale();
  }, 80);

  /**
   * A tall phone screen holds a deep slice of the glen (from the bank at the
   * bottom of the frame to the crown at the top): the 16:9 lens blur turned
   * half of it into soft bokeh. On portrait the depth of field is gentler —
   * rig.dofScale (1 on landscape → PORTRAIT_DOF on a phone, a touch less by
   * night when the lit village must read) scales the post chain's aperture
   * (ctx.post.settings, live-tunable: a value someone else sets is adopted as
   * the new base). Only the 'full' post tier has depth of field at all.
   */
  const PORTRAIT_DOF = 0.5;
  const PORTRAIT_DOF_NIGHT = 0.42;
  let apBase = null;
  let apWritten = null;
  rig.dofScale = 1;
  function applyDofScale() {
    const p = portrait();
    const n = ctx.env?.night ?? 0;
    const k = 1 - p * (1 - (PORTRAIT_DOF + (PORTRAIT_DOF_NIGHT - PORTRAIT_DOF) * n));
    rig.dofScale = k;
    const S = ctx.post?.settings;
    if (!S || typeof S.aperture !== 'number') return;
    if (apBase === null || S.aperture !== apWritten) apBase = S.aperture;
    const want = apBase * k;
    if (S.aperture !== want) S.aperture = want;
    apWritten = S.aperture;
  }

  /** Distance along the line of sight camera → look point to the first solid thing (analytic, cheap). */
  const chDir = new THREE.Vector3();
  const chP = new THREE.Vector3();
  function centreHit(from, at) {
    chDir.subVectors(at, from);
    const toLook = chDir.length();
    chDir.divideScalar(toLook || 1);
    const far = Math.max(toLook * 1.6, 24);
    for (let s = 0.75; s < far; s += s < 12 ? 0.75 : 1.5) {
      chP.copy(chDir).multiplyScalar(s).add(from);
      if (chP.y < getHeight(chP.x, chP.z) + 0.15 || obstacles.penetration(chP, { ground: false }) > 0.9) return Math.max(1, s);
    }
    return toLook;
  }

  // a rotated phone / resized window: re-fit the current composition
  engine.onResize?.(() => {
    if (!spot || introHover) return;
    base = spotBase(spot);
    if (!transition && !focusBase) good.dAz = good.dPol = 0;
  });

  // start on the overview (the intro, if any, takes over via holdIntro())
  rig.goTo('glen', { instant: true });
  return rig;
}
