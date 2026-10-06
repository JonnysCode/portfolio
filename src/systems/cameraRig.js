// ─────────────────────────────────────────────────────────────────────────────
// Camera director — a diorama camera that glides between SPOTS (layout.js)
// and lets the visitor gently orbit, zoom and pan around the current one.
//
//   rig.goTo(spotId, { instant })  → Promise (resolves on arrival)
//   rig.spot                        current spot id
//   rig.onSpotChange(fn(spotId, prevId)) → unsubscribe
//   rig.next() / rig.prev()         cycle through SPOTS
//   rig.focus(object3d | Vector3, { distance, height })   frame a detail (entry panels)
//   rig.release()                   glide back to the current spot composition
//   rig.target                      THREE.Vector3 the camera looks at (lighting/DOF follow it)
//   rig.focusDistance               distance camera → point of interest (for depth of field)
//   rig.setOverride(position, lookAt) / rig.clearOverride() / rig.snap()   (debug, cut-scenes)
//   rig.playIntro() → Promise       cinematic glide from far above into the glen
// BASELINE: the experience builder refines the feel (inertia, gestures, paths).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { SPOTS, SPOT_BY_ID, CAMERA_LIMITS } from '../world/layout.js';
import { getHeight } from '../world/ground.js';
import { clamp, damp } from '../core/rng.js';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

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

  // live orbit state
  const target = new THREE.Vector3();
  let azimuth = 0, polar = 1, distance = 30, fov = camera.fov;
  // user offsets on top of the spot composition
  let dAz = 0, dPol = 0, zoom = 1;
  const pan = new THREE.Vector3();
  // base composition for the current spot (or focus)
  let base = null;
  let spot = null;
  let transition = null; // { from, to, t, duration, lift, resolve }
  let focusBase = null;
  let override = null;
  const listeners = new Set();
  const pointers = new Map();
  let pinch = null;
  let velAz = 0, velPol = 0;

  function spotBase(id) {
    const s = SPOT_BY_ID[id];
    const o = toOrbit(s.camera.position, s.camera.target);
    o.fov = s.camera.fov ?? 40;
    o.focus = new THREE.Vector3(...(s.focus ?? s.camera.target));
    return o;
  }

  function current() {
    return { target: target.clone(), azimuth, polar, distance, fov };
  }

  function startTransition(to, duration) {
    const from = current();
    const hop = from.target.distanceTo(to.target);
    return new Promise((resolve) => {
      if (transition?.resolve) transition.resolve(false);
      transition = { from, to, t: 0, duration: reduced ? 0.01 : duration, lift: Math.min(14, hop * 0.35), resolve };
    });
  }

  // ─── input ─────────────────────────────────────────────────────────────────
  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  });
  window.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || override) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoom = clamp(pinch.zoom * (pinch.d / Math.max(d, 1)), 0.45, 1.8);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      panBy(mx - pinch.mx, my - pinch.my);
      pinch.mx = mx;
      pinch.my = my;
      return;
    }
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    if (p.button === 2 || p.shift) {
      panBy(dx, dy);
      return;
    }
    velAz = -dx * 0.0045;
    velPol = -dy * 0.0035;
    dAz += velAz;
    dPol += velPol;
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom = clamp(zoom * (1 + Math.sign(e.deltaY) * 0.1), 0.45, 1.8);
    },
    { passive: false }
  );
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const right = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  function panBy(dx, dy) {
    const k = distance * 0.0016;
    right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    fwd.set(right.z, 0, -right.x);
    pan.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k);
    pan.clampLength(0, 9);
  }

  const rig = {
    target,
    focusDistance: 20,
    get spot() {
      return spot;
    },
    onSpotChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    goTo(id, { instant = false, duration = 2.2 } = {}) {
      if (!SPOT_BY_ID[id]) return Promise.resolve(false);
      const prev = spot;
      spot = id;
      focusBase = null;
      base = spotBase(id);
      dAz = dPol = 0;
      zoom = 1;
      pan.set(0, 0, 0);
      if (prev !== id) for (const fn of listeners) fn(id, prev);
      if (instant) {
        target.copy(base.target);
        azimuth = base.azimuth;
        polar = base.polar;
        distance = base.distance;
        fov = base.fov;
        transition = null;
        return Promise.resolve(true);
      }
      return startTransition(base, duration);
    },
    next() {
      const i = SPOTS.findIndex((s) => s.id === spot);
      return rig.goTo(SPOTS[(i + 1) % SPOTS.length].id);
    },
    prev() {
      const i = SPOTS.findIndex((s) => s.id === spot);
      return rig.goTo(SPOTS[(i - 1 + SPOTS.length) % SPOTS.length].id);
    },
    focus(what, opts = {}) {
      const p = what?.isObject3D ? what.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3().copy(what);
      if (opts.height) p.y += opts.height;
      const b = base ?? spotBase('glen');
      focusBase = {
        target: p,
        azimuth: b.azimuth + (opts.azimuth ?? 0),
        polar: clamp(b.polar + (opts.polar ?? 0), L.minPolar, L.maxPolar),
        distance: opts.distance ?? 6,
        fov: b.fov,
        focus: p,
      };
      dAz = dPol = 0;
      zoom = 1;
      pan.set(0, 0, 0);
      return startTransition(focusBase, 1.4);
    },
    release() {
      if (!focusBase) return Promise.resolve(true);
      focusBase = null;
      return base ? startTransition(base, 1.4) : Promise.resolve(true);
    },
    setOverride(position, lookAt) {
      override = { position: new THREE.Vector3().copy(position), lookAt: new THREE.Vector3().copy(lookAt) };
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
    playIntro() {
      const glen = spotBase('glen');
      target.copy(glen.target).add(new THREE.Vector3(0, 10, -6));
      azimuth = glen.azimuth + 0.5;
      polar = 0.45;
      distance = glen.distance * 1.9;
      spot = null;
      return rig.goTo('glen', { duration: 4.2 });
    },
  };

  // ─── per frame ─────────────────────────────────────────────────────────────
  const offset = new THREE.Vector3();
  const look = new THREE.Vector3();
  engine.addUpdate((dt) => {
    if (override) {
      camera.position.copy(override.position);
      camera.lookAt(override.lookAt);
      target.copy(override.lookAt);
      rig.focusDistance = camera.position.distanceTo(override.lookAt);
      return;
    }
    const goal = focusBase ?? base;
    if (transition) {
      const tr = transition;
      tr.t = Math.min(tr.duration, tr.t + dt);
      const k = ease(tr.t / tr.duration);
      target.lerpVectors(tr.from.target, tr.to.target, k);
      azimuth = tr.from.azimuth + wrap(tr.to.azimuth - tr.from.azimuth) * k;
      polar = tr.from.polar + (tr.to.polar - tr.from.polar) * k;
      distance = tr.from.distance + (tr.to.distance - tr.from.distance) * k + Math.sin(Math.PI * k) * tr.lift;
      fov = tr.from.fov + (tr.to.fov - tr.from.fov) * k;
      if (tr.t >= tr.duration) {
        transition = null;
        tr.resolve?.(true);
      }
    } else if (goal) {
      // inertia after a drag
      if (!pointers.size) {
        velAz *= Math.exp(-6 * dt);
        velPol *= Math.exp(-6 * dt);
        dAz += velAz * 0.25;
        dPol += velPol * 0.25;
      }
      const range = goal === base && spot === 'glen' ? 1.1 : 0.7;
      dAz = clamp(dAz, -range, range);
      const az = clamp(goal.azimuth + dAz, L.minAzimuth, L.maxAzimuth);
      dAz = az - goal.azimuth;
      const pol = clamp(goal.polar + dPol, L.minPolar, L.maxPolar);
      dPol = pol - goal.polar;
      const k = damp(7, dt);
      azimuth += wrap(az - azimuth) * k;
      polar += (pol - polar) * k;
      distance += (clamp(goal.distance * zoom, L.minDistance, L.maxDistance) - distance) * k;
      look.copy(goal.target).add(pan);
      const tb = L.targetBox;
      look.set(clamp(look.x, tb.minX, tb.maxX), clamp(look.y, tb.minY, tb.maxY), clamp(look.z, tb.minZ, tb.maxZ));
      target.lerp(look, k);
      fov += (goal.fov - fov) * k;
    }
    offset.setFromSphericalCoords(distance, polar, azimuth);
    camera.position.copy(target).add(offset);
    const floor = getHeight(camera.position.x, camera.position.z) + 0.8;
    if (camera.position.y < floor) camera.position.y = floor;
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(target);
    const f = (focusBase ?? base)?.focus;
    rig.focusDistance = f ? camera.position.distanceTo(f) : distance;
  }, 80);

  rig.goTo('glen', { instant: true });
  return rig;
}
