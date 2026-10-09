// ─────────────────────────────────────────────────────────────────────────────
// Ivy on the Great Oak: vines that wander up the bark from between the roots
// (one climbs all the way into the low front-left limb and runs along it),
// curtains of ivy hanging from the limbs, and wisps of pale beard moss
// (lichen) hanging in tufts from the limbs' undersides — the old oak's
// fairy-tale curtains (returned as their own card set, `beard`).
//
// Leaves are ivy CARDS (materials.foliage({ variant: 'ivy' }) — a trailing
// strand whose stem starts at the bottom centre of the card and grows towards
// +V). Climbing cards lie flat on the bark with V along the vine; hanging
// cards point V downwards. All cards are merged into ONE geometry; the thin
// woody stems are returned as tubes to merge with the limb bark.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { DEG, TAU, CX, CZ, polar, trunkRadius, trunkSample, angDiff, FORK_Y, HOLLOWS, crownBlocked, certZone, inCertZone } from './shape.js';
import { organicTube } from './tubes.js';
import { clamp } from '../../core/rng.js';

/** Where vines may NOT climb: the door niche & collar, the loft-stairs side, around the hollows, the EFZ certificate. */
function forbidden(a, y) {
  const d = a / DEG;
  if (certZone(a, y, 0.2) > 0) return true;
  for (const h of HOLLOWS) {
    const q = Math.hypot((angDiff(a, h.a * DEG) * 3) / h.rx, (y - h.y) / h.ry);
    if (q < 1.9) return true;
  }
  if (Math.abs(angDiff(a, 0)) < 26 * DEG && y < 4.2) return true; // door & its collar
  if (d > 48 && d < 162 && y < FORK_Y + 1) return true; // stairs & loft
  return false;
}

/** Vines: [start azimuth (deg), max height, branchiness]. */
const VINES = [
  [-40, 15.2, 1.2], // climbs into the low limb (continued along it below)
  [-27, 8.2, 0.8],
  [-64, 11.5, 1],
  [-92, 6.5, 0.8],
  [-118, 13.5, 1],
  [196, 9.5, 1],
  [226, 15.5, 1.1],
  [252, 7.5, 0.8],
  [172, 5.5, 0.6],
  [45, 4.4, 0.5], // right of the door, between the EFZ certificate and the stairs
];

class CardSet {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
  }
  /** A card with its stem at `base`, growing along `up`, facing `normal`, height s, width s × w. */
  add(base, up, normal, s, flip = false, w = 1) {
    const across = new THREE.Vector3().crossVectors(up, normal).normalize();
    // never in front of the Schreinerei's EFZ certificate (base, tip and both top corners)
    if (inCertZone(base, 0.12)) return;
    const tip = base.clone().addScaledVector(up, s);
    if (inCertZone(tip, 0.12) || inCertZone(tip.clone().addScaledVector(across, s * 0.5), 0.12) || inCertZone(tip.addScaledVector(across, -s), 0.12)) return;
    const n0 = this.pos.length / 3;
    const corners = [
      [-0.5, 0, 0, 0],
      [0.5, 0, 1, 0],
      [0.5, 1, 1, 1],
      [-0.5, 1, 0, 1],
    ];
    for (const [cx, cy, tu, tv] of corners) {
      this.pos.push(base.x + (across.x * cx * w + up.x * cy) * s, base.y + (across.y * cx * w + up.y * cy) * s, base.z + (across.z * cx * w + up.z * cy) * s);
      this.nor.push(normal.x, normal.y, normal.z);
      this.uv.push(flip ? 1 - tu : tu, tv);
    }
    this.idx.push(n0, n0 + 1, n0 + 2, n0, n0 + 2, n0 + 3);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
  get count() {
    return this.idx.length / 6;
  }
}

/**
 * @param rng     seeded rng
 * @param limbs   [{ id, curve, radiusAt }]
 * @param density quality density (scales hanging strands & leaf spacing)
 * @returns {{ leaves: BufferGeometry, stems: BufferGeometry[], cards: number }}
 */
export function buildIvy(rng, limbs, { density = 1 } = {}) {
  const cards = new CardSet();
  const stems = [];
  const tmpUp = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const spacing = 0.16 / Math.sqrt(clamp(density, 0.35, 1));

  /** Walk a vine up the bark; returns the list of points (world). */
  function climb(a, y, maxY, heading, len) {
    const pts = [];
    const step = 0.2;
    let travelled = 0;
    while (y < maxY && travelled < len) {
      const r = trunkRadius(a, y);
      if (trunkSample(a, y).hollow > 0 || forbidden(a, y)) break;
      pts.push({ p: polar(a, r + 0.05, y), a, y });
      heading += rng.range(-0.28, 0.28);
      heading = clamp(heading * 0.96, -0.85, 0.85);
      y += step * Math.cos(heading);
      a += (step * Math.sin(heading)) / Math.max(r, 1);
      travelled += step;
    }
    return pts;
  }

  /** Leaves along a polyline of bark points; `out(i)` = outward normal at point i. */
  function leafPath(pts, outward, scale = 1) {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i];
      const seg = p0.distanceTo(p1);
      acc += seg;
      while (acc > spacing) {
        acc -= spacing;
        const t = 1 - acc / Math.max(seg, 1e-4);
        const base = p0.clone().lerp(p1, t);
        const dir = p1.clone().sub(p0).normalize();
        const n = outward(i, base, tmpN).normalize();
        // fan the strands out sideways from the vine, flat on the bark
        const side = new THREE.Vector3().crossVectors(n, dir).normalize();
        tmpUp.copy(dir).addScaledVector(side, rng.range(-0.9, 0.9)).normalize();
        // re-orthogonalise against the normal, tilt a little away from the bark
        tmpUp.addScaledVector(n, -tmpUp.dot(n)).normalize();
        const cardN = n.clone().addScaledVector(tmpUp, -0.25).normalize();
        base.addScaledVector(n, rng.range(0.02, 0.09));
        base.addScaledVector(side, rng.range(-0.08, 0.08));
        cards.add(base, tmpUp.clone(), cardN, rng.range(0.42, 0.66) * scale, rng.chance(0.5));
      }
    }
  }

  function stemTube(points, r0, r1) {
    if (points.length < 3) return;
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const len = curve.getLength();
    stems.push(
      organicTube({
        curve,
        segments: Math.max(4, Math.ceil(len / 0.25)),
        radial: 4,
        size: (t, o) => {
          o.w = o.h = r0 + (r1 - r0) * t;
        },
        furrows: 0,
        lumps: 0.15,
        seed: rng.range(0, 99),
        uvScale: 2,
      })
    );
  }

  const radialOut = (i, p, out) => out.set(p.x - CX, 0, p.z - CZ);

  // ── climbing vines ────────────────────────────────────────────────────────
  for (const [a0, maxY, branchy] of VINES) {
    const a = a0 * DEG + rng.range(-0.04, 0.04);
    const main = climb(a, 0.15, maxY, rng.range(-0.3, 0.3), 40);
    if (main.length < 3) continue;
    const ptsW = main.map((q) => q.p);
    stemTube(ptsW, 0.035, 0.018);
    leafPath(ptsW, radialOut);
    // side shoots
    const nSide = Math.round(main.length * 0.05 * branchy);
    for (let k = 0; k < nSide; k++) {
      const q = main[rng.int(2, main.length - 2)];
      const side = climb(q.a, q.y, Math.min(maxY + 1, q.y + rng.range(1, 3.5)), rng.chance(0.5) ? 0.75 : -0.75, rng.range(0.8, 2.6));
      if (side.length < 3) continue;
      const sp = side.map((s) => s.p);
      stemTube(sp, 0.022, 0.012);
      leafPath(sp, radialOut, 0.9);
    }
  }

  // ── ivy running along the low limb (continuing the first vine) ───────────
  const low = limbs.find((l) => l.id === 'front-left-low');
  if (low) {
    const pts = [];
    const ups = [];
    for (let u = 0.04; u < 0.5; u += 0.012) {
      const P = low.curve.getPointAt(u);
      const T = low.curve.getTangentAt(u);
      const r = low.radiusAt(u);
      // wander over the top half of the limb
      const side = new THREE.Vector3(-T.z, 0, T.x).normalize();
      const up = new THREE.Vector3().crossVectors(side, T).normalize();
      if (up.y < 0) up.negate();
      const wob = Math.sin(u * 37) * 0.7 + Math.sin(u * 13 + 1) * 0.4;
      const n = up.clone().multiplyScalar(Math.cos(wob)).addScaledVector(side, Math.sin(wob)).normalize();
      pts.push(P.clone().addScaledVector(n, r + 0.05));
      ups.push(n);
    }
    stemTube(pts, 0.03, 0.016);
    leafPath(pts, (i, p, out) => out.copy(ups[Math.min(i, ups.length - 1)]));
  }

  // ── hanging curtains from the limbs ───────────────────────────────────────
  const strandsPer = { 'front-left-low': 18, front: 8, 'back-left': 7, right: 7, 'back-right': 6 };
  for (const limb of limbs) {
    const n = Math.round((strandsPer[limb.id] ?? 0) * clamp(density, 0.4, 1));
    for (let k = 0; k < n; k++) {
      const u = rng.range(0.12, 0.85);
      const P = limb.curve.getPointAt(u);
      const r = limb.radiusAt(u);
      P.y -= r * 0.85;
      const len = rng.range(1.2, limb.id === 'front-left-low' ? 4.2 : 3.2) * (P.y > 18 ? 0.8 : 1);
      // keep curtains out of the way of things below and out of the spot views
      if (P.y - len < 6) continue;
      const mid = P.clone();
      mid.y -= len * 0.5;
      if (crownBlocked(mid, len * 0.5 + 0.3)) continue;
      const pts = [];
      const swayDir = new THREE.Vector3(rng.range(-1, 1), 0, rng.range(-1, 1)).normalize();
      const nSeg = Math.max(3, Math.ceil(len / 0.3));
      for (let i = 0; i <= nSeg; i++) {
        const t = i / nSeg;
        pts.push(P.clone().add(new THREE.Vector3(swayDir.x * Math.sin(t * 2.4) * 0.3 * t, -len * t, swayDir.z * Math.sin(t * 2.4) * 0.3 * t)));
      }
      stemTube(pts, 0.018, 0.01);
      // hanging cards: V points DOWN the strand (the stem end is at the top)
      for (let i = 0; i < pts.length - 1; i++) {
        const base = pts[i].clone();
        const down = pts[i + 1].clone().sub(pts[i]).normalize();
        for (let c = 0; c < 3; c++) {
          const face = new THREE.Vector3(Math.cos(rng.range(0, TAU)), 0, Math.sin(rng.range(0, TAU)));
          face.addScaledVector(down, -face.dot(down)).normalize();
          const up = down.clone().addScaledVector(new THREE.Vector3().crossVectors(face, down), rng.range(-0.5, 0.5)).normalize();
          cards.add(base.clone().add(new THREE.Vector3(rng.range(-0.06, 0.06), 0, rng.range(-0.06, 0.06))), up, face, rng.range(0.5, 0.75) * (1 - (i / pts.length) * 0.3), rng.chance(0.5));
        }
      }
    }
  }

  // ── beard moss: pale tufts of hanging lichen under the limbs ─────────────
  // Tall strand cards (the 'grass' card hung upside down: its blades become
  // thin hanging wisps), 3–6 per tuft, from the undersides of the limbs the
  // glen looks at; every tuft stays out of the spot cameras' views.
  const beard = new CardSet();
  const tuftsPer = { 'front-left-low': 16, front: 9, 'left-high': 8, 'back-left': 6, right: 5, 'back-right': 5, 'front-right-high': 4 };
  for (const limb of limbs) {
    const n = Math.round((tuftsPer[limb.id] ?? 0) * clamp(density, 0.5, 1));
    for (let k = 0; k < n; k++) {
      const u = rng.range(0.1, 0.9);
      const P = limb.curve.getPointAt(u);
      const T = limb.curve.getTangentAt(u);
      const r = limb.radiusAt(u);
      const side = new THREE.Vector3(-T.z, 0, T.x).normalize();
      const len = rng.range(0.8, limb.id === 'front-left-low' ? 2.2 : 1.7);
      P.y -= r * 0.75;
      if (P.y - len < 7.5) continue;
      const mid = P.clone();
      mid.y -= len * 0.5;
      if (crownBlocked(mid, len * 0.5 + 0.3)) continue;
      const m = rng.int(3, 6);
      for (let i = 0; i < m; i++) {
        const base = P.clone().addScaledVector(side, rng.range(-0.75, 0.75) * r).addScaledVector(T, rng.range(-0.35, 0.35));
        base.y += rng.range(0, 0.12);
        const ang = rng.range(0, TAU);
        const face = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
        const down = new THREE.Vector3(rng.range(-0.12, 0.12), -1, rng.range(-0.12, 0.12)).normalize();
        face.addScaledVector(down, -face.dot(down)).normalize();
        beard.add(base, down, face, len * rng.range(0.6, 1.05), rng.chance(0.5), 0.5);
      }
    }
  }

  return { leaves: cards.geometry(), stems, cards: cards.count, beard: beard.count ? beard.geometry() : null, beardCards: beard.count };
}
