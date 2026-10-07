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

// ─── subject cones (for foreground framing) ─────────────────────────────────
// What each spot came to see, as a sphere around its target. Framing plants
// may stand anywhere in a frame — corners, bottom edge, close to the lens —
// as long as they do not overlap the subject seen from the camera.
const SUBJECT_R = { glen: 11, woodworking: 6, code: 5, home: 5, interior: 4.5, bikes: 4.5 };
const cones = [];
for (const s of SPOTS) {
  const p = s.camera.position, t = s.camera.target;
  const rs = SUBJECT_R[s.id] ?? 5;
  const lerpTo = (k) => [t[0] + (p[0] - t[0]) * k, t[1] + (p[1] - t[1]) * k, t[2] + (p[2] - t[2]) * k];
  const f = s.focus ?? t;
  const close = [f[0] + (p[0] - t[0]) * 0.55, f[1] + (p[1] - t[1]) * 0.55, f[2] + (p[2] - t[2]) * 0.55];
  for (const [cp, ct, r] of [[p, t, rs], [lerpTo(1.8), t, rs], [close, f, rs * 0.7]]) {
    const pos = new THREE.Vector3(...cp);
    const tgt = new THREE.Vector3(...ct);
    const dir = tgt.clone().sub(pos);
    const dist = dir.length();
    dir.normalize();
    cones.push({ pos, dir, dist, tan: r / dist });
  }
}
const _d = new THREE.Vector3();

/**
 * True if a sphere at (x, y, z) radius r overlaps any spot's SUBJECT as seen
 * from that spot's cameras (plain, -wide, -close). Looser than blocksView:
 * use it for framing elements that are meant to stand in the frames' margins.
 */
export function blocksSubject(x, y, z, r) {
  for (const c of cones) {
    _d.set(x - c.pos.x, y - c.pos.y, z - c.pos.z);
    const along = _d.dot(c.dir);
    if (along <= 0.3 || along > c.dist) continue; // behind the lens or behind the subject
    const perp = Math.sqrt(Math.max(0, _d.lengthSq() - along * along));
    if (perp - r < c.tan * along) return true;
  }
  return false;
}

/** blocksSubject for an upright thing (spheres stacked up its height). */
export function isClearOfSubjects(x, y0, z, height, radius) {
  const steps = Math.max(1, Math.ceil(height / Math.max(0.4, radius * 1.2)));
  for (let i = 0; i <= steps; i++) if (blocksSubject(x, y0 + (i / steps) * height, z, radius)) return false;
  return true;
}

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

// ─── level of detail: how close can a camera SEE this? ──────────────────────
// Every pose the visitor can reach (each spot's composed shot swung through
// its orbit range, zoomed in & out, panned; the -wide and -close variants;
// the overview) as a camera position + a slightly widened frustum.
// viewDistance(p) = distance from the nearest pose whose frustum contains p
// (Infinity when no pose ever sees it). Builders spend triangles by it: full
// detail where a lens can come close, simplified geometry far away.
// (Orbit ranges mirror systems/cameraRig.js ORBIT.)
const ORBIT_RANGE = {
  glen: { az: 0.62, up: 0.32, down: 0.1, zoom: [0.42, 1.22], pan: 9 },
  woodworking: { az: 0.55, up: 0.42, down: 0.06, zoom: [0.42, 1.45], pan: 3.5 },
  code: { az: 0.5, up: 0.32, down: 0.12, zoom: [0.45, 1.4], pan: 3 },
  home: { az: 0.5, up: 0.4, down: 0.06, zoom: [0.45, 1.4], pan: 3 },
  interior: { az: 0.5, up: 0.4, down: 0.06, zoom: [0.4, 1.45], pan: 3 },
  bikes: { az: 0.55, up: 0.4, down: 0.08, zoom: [0.42, 1.45], pan: 3.5 },
};
let poses = null;
function lodPoses() {
  if (poses) return poses;
  poses = [];
  const cam = new THREE.PerspectiveCamera(46, ASPECT, 0.3, 220);
  const add = (pos, tgt, fov) => {
    cam.fov = fov + 6;
    cam.aspect = ASPECT;
    cam.updateProjectionMatrix();
    cam.position.copy(pos);
    cam.lookAt(tgt);
    cam.updateMatrixWorld(true);
    const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    poses.push({ pos: pos.clone(), frustum: new THREE.Frustum().setFromProjectionMatrix(m) });
  };
  for (const s of SPOTS) {
    const P = s.camera.position, T = s.camera.target, fov = s.camera.fov ?? 40;
    const dx = P[0] - T[0], dy = P[1] - T[1], dz = P[2] - T[2];
    const dist = Math.hypot(dx, dy, dz), az = Math.atan2(dx, dz), pol = Math.acos(dy / dist);
    const R = ORBIT_RANGE[s.id] ?? ORBIT_RANGE.woodworking;
    const pans = s.id === 'glen' ? [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]] : [[0, 0]];
    for (const a of [-R.az, -R.az / 2, 0, R.az / 2, R.az]) {
      for (const p of [-R.up, 0, R.down]) {
        for (const z of [R.zoom[0], 0.7, 1, R.zoom[1]]) {
          for (const [px, pz] of pans) {
            const tgt = new THREE.Vector3(T[0] + px, T[1], T[2] + pz);
            add(new THREE.Vector3().setFromSphericalCoords(dist * z, Math.max(0.35, pol + p), az + a).add(tgt), tgt, fov);
          }
        }
      }
    }
    add(new THREE.Vector3(T[0] + dx * 1.8, T[1] + dy * 1.8, T[2] + dz * 1.8), new THREE.Vector3(...T), fov);
    const f = s.focus ?? T;
    add(new THREE.Vector3(f[0] + dx * 0.55, f[1] + dy * 0.55, f[2] + dz * 0.55), new THREE.Vector3(...f), fov);
  }
  add(new THREE.Vector3(0, 34, 52), new THREE.Vector3(0, 4, -2), 40);
  return poses;
}
const _lod = new THREE.Sphere();

/** Distance from the nearest reachable camera pose that sees the sphere (Infinity if none does). */
export function viewDistance(x, y, z, r = 0.5) {
  _lod.center.set(x, y, z);
  _lod.radius = r;
  let best = Infinity;
  for (const p of lodPoses()) {
    const d = p.pos.distanceTo(_lod.center);
    if (d < best && p.frustum.intersectsSphere(_lod)) best = d;
  }
  return best;
}

/**
 * Detail factor 1 (a lens can come within `near`) → `min` (only ever seen
 * from beyond `far`, or never).
 */
export function viewDetail(x, y, z, { r = 0.5, near = 14, far = 34, min = 0.5 } = {}) {
  const d = viewDistance(x, y, z, r);
  if (!Number.isFinite(d)) return min;
  return 1 - (1 - min) * THREE.MathUtils.smoothstep(d, near, far);
}

// ─── the composed shots (for "no bare ground" checks) ───────────────────────
// Full (un-narrowed) frusta of every spot's composed shot and its -wide
// variant, plus the overview: what the visitor sees when a glide lands.
let shots = null;
const _shot = new THREE.Sphere();
/** True if a sphere shows in any composed shot (spot, spot-wide, overview). */
export function inShot(x, y, z, r = 0.3) {
  if (!shots) {
    shots = [];
    const cam = new THREE.PerspectiveCamera(42, ASPECT, 0.5, 220);
    const add = (p, t, fov) => {
      cam.fov = fov + 2;
      cam.updateProjectionMatrix();
      cam.position.set(...p);
      cam.lookAt(t[0], t[1], t[2]);
      cam.updateMatrixWorld(true);
      shots.push(new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)));
    };
    for (const s of SPOTS) {
      const p = s.camera.position, t = s.camera.target, fov = s.camera.fov ?? 40;
      add(p, t, fov);
      if (s.id !== 'glen') add([t[0] + (p[0] - t[0]) * 1.8, t[1] + (p[1] - t[1]) * 1.8, t[2] + (p[2] - t[2]) * 1.8], t, fov);
    }
    add([0, 34, 52], [0, 4, -2], 40);
  }
  _shot.center.set(x, y, z);
  _shot.radius = r;
  for (const f of shots) if (f.intersectsSphere(_shot)) return true;
  return false;
}

/** Path distance (normalised) re-exported for convenience. */
export { getPathDistance, getStreamDistance };

/** Debug: ids of the spot views a sphere intrudes into. */
export function viewsBlocking(x, y, z, r) {
  _sph.center.set(x, y, z);
  _sph.radius = r;
  return views.filter((v) => v.frustum.intersectsSphere(_sph)).map((v) => v.id);
}
