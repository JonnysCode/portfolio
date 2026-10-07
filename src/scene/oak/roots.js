// ─────────────────────────────────────────────────────────────────────────────
// Buttress roots of the Great Oak: tall fins where they leave the trunk that
// relax into round, snaking roots, arching over the moss and plunging back
// into the soil. Each root gets a mossy cap on its top (a partial shell that
// dips under the bark at its ragged edge).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight } from '../../world/ground.js';
import { ROOTS, DEG, CX, CZ, polar, trunkRadius } from './shape.js';
import { organicTube, smoothTable } from './tubes.js';
import { createNoise3D } from './noise3.js';
import { smoothstep, clamp } from '../../core/rng.js';

const nMoss = createNoise3D(404);

/** Curve & size of one root, in world space (the curve is flat; add getHeight for the ground). */
export function rootCurve(root) {
  const pts = root.pts.map(([rho, da, yc]) => polar((root.a0 + da) * DEG, rho, yc));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const W = root.pts.map((p) => p[3]);
  const H = root.pts.map((p) => p[4]);
  const size = (t, out, tp) => {
    out.w = smoothTable(W, tp);
    out.h = smoothTable(H, tp);
  };
  return { curve, size };
}

/**
 * Point on the surface of a root: u = arc-length fraction, phi = angle around
 * (0 = top, +π/2 = the root's right flank looking outwards). Returns
 * { position, normal } in world space.
 */
export function rootSurfacePoint(info, u, phi, lift = 0) {
  const { curve, size } = info;
  const P = curve.getPointAt(u);
  P.y += getHeight(P.x, P.z);
  const T = curve.getTangentAt(u);
  const N = new THREE.Vector3(0, 1, 0).addScaledVector(T, -T.y).normalize();
  const B = new THREE.Vector3().crossVectors(T, N).normalize();
  const sz = { w: 1, h: 1 };
  size(u, sz, curve.getUtoTmapping(u));
  const c = Math.cos(phi), s = Math.sin(phi);
  const normal = N.clone().multiplyScalar(c * sz.w).addScaledVector(B, s * sz.h).normalize();
  const position = P.clone().addScaledVector(N, c * sz.h).addScaledVector(B, s * sz.w).addScaledVector(normal, lift);
  return { position, normal, tangent: T };
}

/** Size of the tiny mouse door in the front-right root (local units, see mouseDoorFrame). */
export const MOUSE_DOOR = { width: 0.32, height: 0.46 };

/**
 * Where the mouse door sits: the first spot along the front-right root's
 * front flank that is well clear of the trunk's flare. Returns a frame with
 * its origin on the ground, +Z out of the root, +Y up: { matrix, inverse }.
 */
export function mouseDoorFrame(info) {
  let flank = null;
  for (let u = 0.36; u < 0.8 && !flank; u += 0.02) {
    const f = rootSurfacePoint(info, u, Math.PI / 2 + 0.2, 0);
    const a = Math.atan2(f.position.x - CX, f.position.z - CZ);
    const rr = Math.hypot(f.position.x - CX, f.position.z - CZ);
    if (rr - trunkRadius(a, 0.25) > 0.45) flank = f;
  }
  flank ??= rootSurfacePoint(info, 0.6, Math.PI / 2 + 0.2, 0);
  const z = new THREE.Vector3(flank.normal.x, 0, flank.normal.z).normalize();
  const x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), z).normalize();
  const p = flank.position.clone();
  p.y = getHeight(p.x, p.z);
  const matrix = new THREE.Matrix4().makeBasis(x, new THREE.Vector3(0, 1, 0), z).setPosition(p);
  return { matrix, inverse: matrix.clone().invert() };
}

/**
 * Press the root's surface flat (just behind the door plane) where the door
 * goes, easing out over a soft margin, so the door sits IN the root.
 */
function carveDoorNiche(geo, frame, depth) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const hw = MOUSE_DOOR.width / 2 + 0.1, top = MOUSE_DOOR.height + 0.1, margin = 0.22;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(frame.inverse);
    if (v.z < -0.6 || v.z <= depth) continue;
    const ex = Math.max(0, Math.abs(v.x) - hw), ey = Math.max(0, v.y - top, -0.1 - v.y);
    const d = Math.hypot(ex, ey);
    if (d >= margin) continue;
    const k = 1 - smoothstep(0, margin, d);
    v.z = v.z + (depth - v.z) * k;
    v.applyMatrix4(frame.matrix);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

export function buildRoots() {
  const bark = [];
  const moss = [];
  const roots = [];
  const ground = (x, z) => getHeight(x, z);
  ROOTS.forEach((root, ri) => {
    const info = rootCurve(root);
    const { curve, size } = info;
    const len = curve.getLength();
    const segments = Math.max(12, Math.ceil(len / (root.thin ? 0.2 : 0.14)));
    const radial = root.thin ? 9 : 18;
    const tubeOpts = {
      curve,
      segments,
      radial,
      size,
      frame: 'up',
      furrows: root.thin ? 0.06 : 0.11,
      furrowFreq: 2.4,
      twist: 0.08,
      lumps: 0.09,
      seed: ri + 1,
      ground,
      uvScale: 0.62,
    };
    const barkGeo = organicTube(tubeOpts);
    const door = root.id === 'front-right' ? mouseDoorFrame(info) : null;
    if (door) carveDoorNiche(barkGeo, door, -0.03);
    bark.push(barkGeo);
    // moss on the top of the root, thicker where the root is big
    const sz = { w: 1, h: 1 };
    const mossGeo = (
      organicTube({
        ...tubeOpts,
        radial: root.thin ? 7 : 14,
        arc: [-1.45, 1.45],
        shell: (phi, s, t) => {
          size(t, sz, curve.getUtoTmapping(t));
          const top = Math.cos(phi);
          const n = nMoss(s * 0.42 + ri * 7.1, phi * 0.7, ri * 3.3);
          const n2 = nMoss(s * 1.7 + 40, phi * 2.2, ri);
          // moss sits on the top of the root in patches; flanks stay bark
          let m = ((top - 0.55) / 0.45) * (0.5 + 0.8 * n) + 0.22 * n + 0.14 * n2 - 0.2;
          m -= smoothstep(0.78, 1, t) * 0.7; // the tip plunges into bare soil
          if (root.thin) m -= 0.12;
          if (root.id === 'front-right') m -= 0.18; // keep the mouse door's root mostly bark
          const k = clamp(sz.w / 0.55, 0.35, 1.1);
          return Math.max(m, -0.5) * 0.12 * k;
        },
      })
    );
    if (door) carveDoorNiche(mossGeo, door, -0.12);
    moss.push(mossGeo);
    roots.push({ id: root.id, a0: root.a0 * DEG, curve, size, length: len, door });
  });
  return { bark, moss, roots };
}
