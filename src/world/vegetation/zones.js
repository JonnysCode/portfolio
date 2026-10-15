// ─────────────────────────────────────────────────────────────────────────────
// WHERE the forest may grow.
//
//   canGrow(x, z, { margin, padExtra })  free forest floor that belongs to the
//        forest builder: off paths, pads (+ the dressed ring around them), the
//        stream & its banks (riverside), the pond, the waterfall outcrop, the
//        escarpment behind it (once setRidgeTest has registered it), the
//        Great Oak's root zone (the oak builder dresses those) and the
//        footprints of the other builders' props (setPropKeep: the colliders
//        registered before the vegetation — sawhorses, drying stack …).
//   blocksView(x, y, z, r)  would a sphere hide the subject of any spot camera
//        (plain, -wide and -close shots, the overview)? Tall things (trees,
//        giant mushrooms, big ferns, boulders) test a few spheres up their
//        height with isClearOfViews().
// Every spot is tested in its composed shot, its -wide and -close variants and
// — when layout.js gives one — its phone (portrait) shot.
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

// ─── the riverside escarpment ────────────────────────────────────────────────
// The ridge the waterfall pours from (scene/riverside/ridge.js) now covers the
// floor well beyond STREAM.falls.radius. The vegetation registers a test for
// it at build time (setRidgeTest) — zones.js can't import the riverside
// module itself (it imports the forest plan, which imports this file) — and
// forestPlan() never sees it: the plan stays the one the riverside builder
// gave its buried giants' roots.
let ridgeTest = null;
/** fn(x, z, margin) → true where the escarpment stands above the forest floor (null clears it). */
export function setRidgeTest(fn) {
  ridgeTest = fn;
}

// ─── the other builders' props (colliders) ───────────────────────────────────
// The scene builders run before the vegetation and register their props as
// colliders (the Schreinerei yard's sawhorses, the drying stack, the handcart,
// the chest, the Velowerkstatt's stands …). Nothing of ours may grow through
// them: setPropKeep(ctx.colliders) snapshots every collider that exists when
// the vegetation starts building (so the trees and giants it adds itself
// later are not in it) and canGrow keeps KEEP_PAD clear of each footprint.
const KEEP_PAD = 0.22;
let props = null;
/** Snapshot the colliders registered so far (null / no colliders clears it). */
export function setPropKeep(colliders) {
  props = null;
  if (!colliders?.query || !colliders?.distance) return;
  const list = [];
  colliders.query(0, 0, 1e4, (s) => {
    // (the oak's own trunk circle is the oak zone's business; houses are pads)
    if (s.tag === 'oak' || s.tag === 'tree' || s.tag === 'giant-mushroom') return;
    list.push(s);
  });
  if (!list.length) return;
  props = list.map((s) => ({ s, x: s.x, z: s.z, b: s.bound ?? Math.max(s.r ?? 0, Math.hypot(s.hw ?? 0, s.hd ?? 0)) }));
  props.dist = colliders.distance;
}
/** Distance from the nearest registered prop's footprint (Infinity if none is near). */
export function propClearance(x, z, reach = 2) {
  if (!props) return Infinity;
  let best = Infinity;
  for (const p of props) {
    if (Math.abs(x - p.x) > p.b + reach || Math.abs(z - p.z) > p.b + reach) continue;
    const d = props.dist(p.s, x, z);
    if (d < best) best = d;
  }
  return best;
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
  if (ridgeTest && ridgeTest(x, z, margin)) return false;
  if (props && propClearance(x, z, KEEP_PAD + margin + 0.5) < KEEP_PAD + margin) return false;
  return true;
}

/** 0 at the glen centre → 1 at its rim (r = GLEN_RADIUS). */
export const rimFactor = (x, z) => Math.min(1.5, Math.hypot(x, z) / GLEN_RADIUS);

/** Azimuth around the glen centre measured from +Z (front) towards +X, in (−π, π]. */
export const glenAzimuth = (x, z) => Math.atan2(x, z);

// ─── spot-camera sight lines ────────────────────────────────────────────────
const ASPECT = 16 / 9;
/** A tall phone (SPOTS[].portrait shots are composed for it). */
const ASPECT_PORTRAIT = 390 / 844;
/** The phone shot of a spot, if it has one: { position, target, fov }. */
const portraitOf = (s) => (s.portrait ? { position: s.portrait.position ?? s.camera.position, target: s.portrait.target ?? s.camera.target, fov: s.portrait.fov ?? (s.camera.fov ?? 40) + 5 } : null);
/** The close-up of a spot: layout's `close` override, else 0.55 × the shot towards the focus. */
const closeOf = (s) => {
  if (s.close) return { position: s.close.position, target: s.close.target };
  const p = s.camera.position, t = s.camera.target, f = s.focus ?? t;
  return { position: [f[0] + (p[0] - t[0]) * 0.55, f[1] + (p[1] - t[1]) * 0.55, f[2] + (p[2] - t[2]) * 0.55], target: f };
};
const views = [];
{
  const cam = new THREE.PerspectiveCamera(40, ASPECT, 0.5, 100);
  const add = (id, p, t, fov, shrink, cut, aspect = ASPECT) => {
    const pos = new THREE.Vector3(...p);
    const tgt = new THREE.Vector3(...t);
    cam.fov = fov * shrink;
    cam.aspect = aspect;
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
    const c = closeOf(s);
    add(`${s.id}-close`, c.position, c.target, fov, 0.8, 1.0);
    // the phone's own composed shot (a tall frame)
    const ph = portraitOf(s);
    if (ph) add(`${s.id}-portrait`, ph.position, ph.target, ph.fov, shrink, 1.5, ASPECT_PORTRAIT);
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
  const c = closeOf(s);
  const ph = portraitOf(s);
  const takes = [[p, t, rs], [lerpTo(1.8), t, rs], [c.position, c.target, rs * 0.7]];
  if (ph) takes.push([ph.position, ph.target, rs]);
  for (const [cp, ct, r] of takes) {
    const pos = new THREE.Vector3(...cp);
    const tgt = new THREE.Vector3(...ct);
    const dir = tgt.clone().sub(pos);
    const dist = dir.length();
    dir.normalize();
    cones.push({ id: s.id, pos, dir, dist, tan: r / dist });
  }
}
const _d = new THREE.Vector3();

/**
 * True if a sphere at (x, y, z) radius r overlaps any spot's SUBJECT as seen
 * from that spot's cameras (plain, -wide, -close). Looser than blocksView:
 * use it for framing elements that are meant to stand in the frames' margins.
 */
export function blocksSubject(x, y, z, r, skip = null) {
  for (const c of cones) {
    if (skip && skip.includes(c.id)) continue;
    _d.set(x - c.pos.x, y - c.pos.y, z - c.pos.z);
    const along = _d.dot(c.dir);
    if (along <= 0.3 || along > c.dist) continue; // behind the lens or behind the subject
    const perp = Math.sqrt(Math.max(0, _d.lengthSq() - along * along));
    if (perp - r < c.tan * along) return true;
  }
  return false;
}

/**
 * blocksSubject for an upright thing (spheres stacked up its height). skip:
 * spot ids whose subject cones to ignore (e.g. ['glen'] for ankle-high ground
 * detail: the overview's subject IS the dressed floor of the diorama).
 */
export function isClearOfSubjects(x, y0, z, height, radius, skip = null) {
  const steps = Math.max(1, Math.ceil(height / Math.max(0.4, radius * 1.2)));
  for (let i = 0; i <= steps; i++) if (blocksSubject(x, y0 + (i / steps) * height, z, radius, skip)) return false;
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
    const c = closeOf(s);
    add(new THREE.Vector3(...c.position), new THREE.Vector3(...c.target), fov);
    const ph = portraitOf(s);
    if (ph) add(new THREE.Vector3(...ph.position), new THREE.Vector3(...ph.target), ph.fov);
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
/** True if a sphere shows in any composed shot (spot, spot-wide — the glen's too —, overview). */
export function inShot(x, y, z, r = 0.3) {
  if (!shots) {
    shots = [];
    const cam = new THREE.PerspectiveCamera(42, ASPECT, 0.5, 220);
    const add = (p, t, fov, aspect = ASPECT) => {
      cam.fov = fov + 2;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
      cam.position.set(...p);
      cam.lookAt(t[0], t[1], t[2]);
      cam.updateMatrixWorld(true);
      shots.push(new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)));
    };
    for (const s of SPOTS) {
      const p = s.camera.position, t = s.camera.target, fov = s.camera.fov ?? 40;
      add(p, t, fov);
      // (the glen's wide shot too: a phone steps the overview back ×1.45 and
      //  zooming out adds ×1.22 — its whole front band must be dressed)
      add([t[0] + (p[0] - t[0]) * 1.8, t[1] + (p[1] - t[1]) * 1.8, t[2] + (p[2] - t[2]) * 1.8], t, fov);
      const ph = portraitOf(s);
      if (ph) add(ph.position, ph.target, ph.fov, ASPECT_PORTRAIT);
    }
    add([0, 34, 52], [0, 4, -2], 40);
  }
  _shot.center.set(x, y, z);
  _shot.radius = r;
  for (const f of shots) if (f.intersectsSphere(_shot)) return true;
  return false;
}

// ─── the lenses' near field ─────────────────────────────────────────────────
// Well in front of a shot's focus the depth of field turns anything bright
// (glowing mushrooms, fireflies) into a big soft blob: glowing things keep
// out of the cone in front of every composed shot (spot and -wide).
const lenses = [];
for (const s of SPOTS) {
  const P = new THREE.Vector3(...s.camera.position), T = new THREE.Vector3(...s.camera.target);
  const dir = T.clone().sub(P);
  const dist = dir.length();
  dir.normalize();
  lenses.push({ P, dir, dist });
  if (s.id !== 'glen') lenses.push({ P: T.clone().addScaledVector(dir, -dist * 1.8), dir, dist: dist * 1.8 });
  const ph = portraitOf(s);
  if (ph) {
    const PP = new THREE.Vector3(...ph.position), d2 = new THREE.Vector3(...ph.target).sub(PP);
    const l2 = d2.length();
    lenses.push({ P: PP, dir: d2.normalize(), dist: l2 });
  }
}
const _nf = new THREE.Vector3();
/** True if (x, y, z) sits in the near field of a composed shot (closer than k × its focus distance, inside a generous cone). */
export function inNearField(x, y, z, k = 0.6, pad = 1) {
  for (const l of lenses) {
    _nf.set(x, y, z).sub(l.P);
    const along = _nf.dot(l.dir);
    if (along < -pad || along > l.dist * k + pad) continue;
    const perp = Math.sqrt(Math.max(0, _nf.lengthSq() - along * along));
    if (perp < Math.max(0, along) * 0.75 + pad) return true;
  }
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
