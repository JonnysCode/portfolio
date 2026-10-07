// ─────────────────────────────────────────────────────────────────────────────
// WHERE the forest may grow.
//
//   canGrow(x, z, { margin, padExtra })  free forest floor that belongs to the
//        forest builder: off paths, pads (+ the dressed ring around them), the
//        stream & its banks (riverside), the pond, the waterfall outcrop and
//        the Great Oak's root zone (the oak builder dresses those).
//   blocksView(x, y, z, r)  would a sphere hide the subject of any spot camera
//        (plain, -wide and -close shots, the overview)? Tall things (trees,
//        giant mushrooms, big ferns, boulders) test a few spheres up their
//        height with isClearOfViews().
// The view test uses a NARROWED frustum (the central ~70 % of each frame),
// cut short before the target: things in the frame's margins are welcome —
// that is foreground framing — but nothing may stand between a camera and
// what it came to see.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OAK, STREAM, SPOTS, GLEN_RADIUS } from '../layout.js';
import { getPathDistance, getStreamDistance, isInWater, PADS } from '../ground.js';

/** The oak builder dresses everything inside this radius around the trunk. */
export const OAK_KEEP = 9.2;
/** The riverside builder owns the stream banks within this distance of the water's edge. */
export const BANK_KEEP = 2.5;

/** Pads the forest keeps a wider berth from (their builders dress the ring around them). */
const PAD_RING = { home: 1.0, atelier: 0.8, shed: 0.7, bikeShed: 0.8, annex: 0.6, porch: 0.4, deck: 0.4, door: 0.4, oak: 0, bridgeW: 0.6, bridgeE: 0.6 };

/** Distance from the outer edge of the nearest pad's dressed ring (negative = inside). */
export function padClearance(x, z) {
  let best = Infinity;
  for (const p of PADS) {
    const d = Math.hypot(x - p.x, z - p.z) - (p.r + (PAD_RING[p.id] ?? 0.5));
    if (d < best) best = d;
  }
  return best;
}

/** Inside the stream, pool or pond, or on the riverside builder's banks. */
export function nearWater(x, z, extra = 0) {
  return isInWater(x, z, BANK_KEEP + extra);
}

/** The waterfall's mossy outcrop (riverside). */
export function onFallsRock(x, z, extra = 0) {
  const f = STREAM.falls;
  return Math.hypot(x - f.x, z - f.z) < f.radius + extra;
}

/** Distance from the oak's trunk axis. */
export const oakDist = (x, z) => Math.hypot(x - OAK.x, z - OAK.z);

/**
 * Free forest floor for the forest builder.
 * margin: extra clearance for bigger plants (units). path: clearance from the
 * path edge in units of the path's half width (default 1.25 = just off the path).
 */
export function canGrow(x, z, { margin = 0, path = 1.25, oak = OAK_KEEP, padExtra = 0 } = {}) {
  if (getPathDistance(x, z) < path + margin * 0.8) return false;
  if (padClearance(x, z) < padExtra + margin) return false;
  if (oakDist(x, z) < oak + margin) return false;
  if (nearWater(x, z, margin)) return false;
  if (onFallsRock(x, z, margin)) return false;
  return true;
}

/** 0 at the glen centre → 1 at its rim (r = GLEN_RADIUS). */
export const rimFactor = (x, z) => Math.min(1.5, Math.hypot(x, z) / GLEN_RADIUS);

/** Azimuth around the glen centre measured from +Z (front) towards +X, in (−π, π]. */
export const glenAzimuth = (x, z) => Math.atan2(x, z);

// ─── spot-camera sight lines ────────────────────────────────────────────────
const ASPECT = 16 / 9;
const views = [];
{
  const cam = new THREE.PerspectiveCamera(40, ASPECT, 0.5, 100);
  const add = (id, p, t, fov, shrink, cut) => {
    const pos = new THREE.Vector3(...p);
    const tgt = new THREE.Vector3(...t);
    cam.fov = fov * shrink;
    cam.aspect = ASPECT;
    cam.near = 0.6;
    cam.far = Math.max(1, pos.distanceTo(tgt) - cut);
    cam.position.copy(pos);
    cam.lookAt(tgt);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    views.push({ id, pos, frustum: new THREE.Frustum().setFromProjectionMatrix(m) });
  };
  for (const s of SPOTS) {
    const p = s.camera.position, t = s.camera.target, fov = s.camera.fov ?? 40;
    const lerpTo = (k, tt = t) => [tt[0] + (p[0] - t[0]) * k, tt[1] + (p[1] - t[1]) * k, tt[2] + (p[2] - t[2]) * k];
    // the glen overview frames the whole diorama: only keep its centre clear
    const shrink = s.id === 'glen' ? 0.55 : 0.72;
    add(s.id, p, t, fov, shrink, 1.5);
    // (the glen's "-wide" shot sits far beyond the rig's max distance — never seen)
    if (s.id !== 'glen') add(`${s.id}-wide`, lerpTo(1.8), t, fov, shrink * 0.85, 1.5);
    const f = s.focus ?? t;
    add(`${s.id}-close`, [f[0] + (p[0] - t[0]) * 0.55, f[1] + (p[1] - t[1]) * 0.55, f[2] + (p[2] - t[2]) * 0.55], f, fov, 0.8, 1.0);
  }
  add('overview', [0, 34, 52], [0, 4, -2], 40, 0.55, 3);
}
const _sph = new THREE.Sphere();

/** True if a sphere at (x, y, z) with radius r intrudes into the core of any spot view. */
export function blocksView(x, y, z, r) {
  _sph.center.set(x, y, z);
  _sph.radius = r;
  for (const v of views) if (v.frustum.intersectsSphere(_sph)) return true;
  return false;
}

/**
 * Clear of every spot view for an upright thing standing at (x, y0, z), of
 * the given height and radius (tested with spheres stacked up its height).
 */
export function isClearOfViews(x, y0, z, height, radius) {
  const steps = Math.max(1, Math.ceil(height / Math.max(0.5, radius * 1.5)));
  for (let i = 0; i <= steps; i++) {
    const y = y0 + Math.min(height, (i / steps) * height);
    if (blocksView(x, y, z, radius)) return false;
  }
  return true;
}

/** Distance to the nearest spot-camera position (for "don't plant in the lens"). */
export function cameraClearance(x, z) {
  let best = Infinity;
  for (const v of views) {
    const d = Math.hypot(x - v.pos.x, z - v.pos.z);
    if (d < best) best = d;
  }
  return best;
}

/** Path distance (normalised) re-exported for convenience. */
export { getPathDistance, getStreamDistance };

/** Debug: ids of the spot views a sphere intrudes into. */
export function viewsBlocking(x, y, z, r) {
  _sph.center.set(x, y, z);
  _sph.radius = r;
  return views.filter((v) => v.frustum.intersectsSphere(_sph)).map((v) => v.id);
}
