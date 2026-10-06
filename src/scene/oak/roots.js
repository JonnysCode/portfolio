// ─────────────────────────────────────────────────────────────────────────────
// Buttress roots of the Great Oak: tall fins where they leave the trunk that
// relax into round, snaking roots, arching over the moss and plunging back
// into the soil. Each root gets a mossy cap on its top (a partial shell that
// dips under the bark at its ragged edge).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight } from '../../world/ground.js';
import { ROOTS, DEG, polar } from './shape.js';
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
    bark.push(organicTube(tubeOpts));
    // moss on the top of the root, thicker where the root is big
    const sz = { w: 1, h: 1 };
    moss.push(
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
          let m = ((top - 0.45) / 0.55) * (0.55 + 0.75 * n) + 0.2 * n + 0.14 * n2 - 0.12;
          m -= smoothstep(0.78, 1, t) * 0.7; // the tip plunges into bare soil
          if (root.thin) m -= 0.12;
          const k = clamp(sz.w / 0.55, 0.35, 1.1);
          return Math.max(m, -0.5) * 0.15 * k;
        },
      })
    );
    roots.push({ id: root.id, a0: root.a0 * DEG, curve, size, length: len });
  });
  return { bark, moss, roots };
}
