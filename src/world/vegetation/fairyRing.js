// ─────────────────────────────────────────────────────────────────────────────
// Night magic on the forest floor.
//
//   buildFairyRing   the fairy ring (a secret): a true circle of 16 glowing
//        bonnets in graded sizes — tallest at the back, the smallest in front
//        so the ring reads from the glen's cameras — a band of glowing moss
//        cushions tracing the circle on the ground, cool light pooling on the
//        moss under them (night), a quiet bed of clover inside. Wisps rising
//        from its heart are an ambient layer (ambient/wisps.js reads
//        ctx.forest.fairyRing). One invisible hit cylinder makes the whole
//        ring clickable (the mushrooms share the kits' merged meshes).
//   buildGlowTrails  trails of glowing moss and bonnet tufts along the giants'
//        root runs and the paths' edges, and across the dark fern carpet in
//        the overview's foreground: small islands of cold light that lead the
//        eye from spot to spot at night.
//
// Glowing moss: one instanced draw (a squashed dome), a moss-green standard
// material whose mint emissive follows the night (updateGlowMoss); the
// ground light: one lightPools() draw (props/glow.js, night only).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { getHeight, getPathDistance, pathPolylines } from '../ground.js';
import { GLEN_RADIUS } from '../layout.js';
import { TAU, instanced } from './common.js';
import { canGrow, inNearField, isClearOfSubjects, cameraClearance, inShot } from './zones.js';

const RING_CANDIDATES = [[-4.5, 11.2], [-5.2, 12.4], [-3.6, 12.2], [4.6, 13.2]];
const MOSS_COL = '#4c8a4a';
const MOSS_GLOW = '#56dca4';
const POOL_COL = '#62e8bc';

/** A low moss cushion (unit radius, 0.4 tall): a squashed dome, 7 sides × 2 rings. */
function mossDome() {
  const g = new THREE.SphereGeometry(1, 7, 3, 0, TAU, 0, Math.PI / 2);
  g.scale(1, 0.4, 1);
  g.translate(0, -0.06, 0);
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

let mossMat = null;
/** The glowing-moss material (moss green by day, mint glow at night — updateGlowMoss). */
function glowMossMaterial() {
  if (mossMat) return mossMat;
  mossMat = new THREE.MeshStandardMaterial({ name: 'glow-moss', color: MOSS_COL, emissive: MOSS_GLOW, emissiveIntensity: 0, roughness: 0.95, vertexColors: true });
  return mossMat;
}
/** Follow the night (cheap; call every frame). */
export function updateGlowMoss(night) {
  if (!mossMat) return;
  const k = THREE.MathUtils.smoothstep(night, 0.15, 0.85);
  // (a soft foxfire green, never a white disc: the caps carry the brightest light)
  mossMat.emissiveIntensity = 0.02 + 0.42 * k;
}

/** Where the fairy ring goes ({ x, z, r }; null if no candidate is free) — picked before the scatter, which then keeps the circle clear. */
export function pickRingSite() {
  const R = 1.2;
  for (const [cx, cz] of RING_CANDIDATES) if (canGrow(cx, cz, { margin: R + 0.2 })) return { x: cx, z: cz, r: R };
  return null;
}

/**
 * The fairy ring. kit: a MushroomKit writing into the shared mushroom
 * builders (the bonnets' glow caps & gills merge with every other glowing
 * mushroom). site: pickRingSite() (its circle is already reserved in the
 * vegetation's occupancy). clover: the vegetation's clover list (a bed in the
 * ring's heart). Returns { group (named 'fairy-ring', with the hit cylinder),
 * centre, radius, moss: [placements], pools: [lightPools entries], glowSpots,
 * flowerPatch } or null.
 */
export function buildFairyRing(ctx, { kit, site, clover = [] }) {
  const rng = createRng('vegetation:fairy-ring');
  if (site) {
    const cx = site.x, cz = site.z, R = site.r;
    const cy = getHeight(cx, cz);
    const moss = [], pools = [], glowSpots = [];
    // graded sizes: tallest at the back (away from the glen's cameras, −z),
    // the smallest in front — a crown of light, not a scatter of dots
    const n = 16;
    const back = Math.PI;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng.jitter(0.07);
      const rr = R * rng.range(0.95, 1.05);
      const x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr;
      const y = getHeight(x, z);
      const grade = 0.5 + 0.5 * Math.cos(a - back);
      const h = (0.17 + 0.26 * grade) * rng.range(0.88, 1.1);
      // (they lean outwards a touch, as if dancing round)
      kit.glowcap(x, y, z, { height: h, capR: h * rng.range(0.36, 0.44), lean: rng.range(0.05, 0.2), leanAz: a + rng.jitter(0.5), halo: 2.2 });
      // a baby at the foot of every other one
      if (i % 2 === 0) {
        const b = a + rng.jitter(0.12) + 0.09, br = rr + rng.jitter(0.08);
        const bx = cx + Math.sin(b) * br, bz = cz + Math.cos(b) * br;
        const bh = h * rng.range(0.38, 0.55);
        kit.glowcap(bx, getHeight(bx, bz), bz, { height: bh, capR: bh * 0.42, lean: rng.range(0.1, 0.3), leanAz: b, halo: 0 });
      }
    }
    // the glowing moss band tracing the circle (a little wider than the caps' line)
    const nm = 64;
    for (let i = 0; i < nm; i++) {
      const a = (i / nm) * TAU + rng.jitter(0.05);
      const rr = R * rng.range(0.86, 1.14);
      const x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr;
      const s = rng.range(0.07, 0.13);
      moss.push({ x, y: getHeight(x, z), z, ry: rng.range(0, TAU), s, sy: rng.range(0.7, 1.2), color: new THREE.Color(1, 1, 1).offsetHSL(0, 0, rng.jitter(0.08)) });
    }
    // cool light pooling under the ring at night: a soft glow on the moss
    // inside and a ring of small pools along the circle
    pools.push({ x: cx, y: cy, z: cz, size: R * 1.25, color: POOL_COL, strength: 0.42, lamp: false });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const x = cx + Math.sin(a) * R, z = cz + Math.cos(a) * R;
      pools.push({ x, y: getHeight(x, z), z, size: 0.62, color: POOL_COL, strength: 0.55, lamp: false });
    }
    glowSpots.push({ x: cx, y: cy + 0.3, z: cz });
    // a quiet clover bed in the ring's heart
    for (let i = 0; i < 7; i++) {
      const a = rng.range(0, TAU), d = Math.sqrt(rng.next()) * R * 0.6;
      const x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
      clover.push({ x, y: getHeight(x, z) + 0.005, z, ry: rng.range(0, TAU), s: rng.range(1.0, 1.4), color: new THREE.Color('#6a9a40').offsetHSL(rng.jitter(0.02), 0, rng.jitter(0.05)) });
    }
    // the clickable ring: an invisible drum over the circle (its centre is the
    // ring's centre — lighting & atmosphere aim the moonbeam at it)
    const group = new THREE.Group();
    group.name = 'fairy-ring';
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.3, R + 0.3, 0.6, 16, 1, true), hitMat);
    hit.name = 'fairy-ring-hit';
    hit.position.set(cx, cy + 0.25, cz);
    hit.userData.keepRaycast = true;
    hit.updateMatrix();
    group.add(hit);
    return { group, centre: new THREE.Vector3(cx, cy, cz), radius: R, moss, pools, glowSpots, flowerPatch: { x: cx, y: cy + 0.3, z: cz, r: R, kind: 'fairyRing' } };
  }
  return null;
}

/**
 * Trails of glowing moss & bonnet tufts. roots: [{ x, z, yaw, len }] (the
 * giants' root runs); avoid: [{ x, z, r }]. kit: a MushroomKit (shared glow
 * builders). density scales the count. Returns { moss, pools, glowSpots, trails }.
 */
export function buildGlowTrails(ctx, { kit, roots = [], density = 1, avoid = [] }) {
  const rng = createRng('vegetation:glow-trails');
  const moss = [], pools = [], glowSpots = [];
  const dens = Math.min(1, density);
  const ok = (x, z) => canGrow(x, z, { path: 1.12 }) && !avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.r)
    // (never in front of a lens: out of focus they would bloom into blobs)
    && !inNearField(x, getHeight(x, z) + 0.1, z, 0.45, 0.6) && cameraClearance(x, z) > 2.2
    && isClearOfSubjects(x, getHeight(x, z), z, 0.3, 0.2, ['glen']);
  let trails = 0;
  /** Lay a trail along a polyline of { x, z } points. */
  const lay = (pts) => {
    let placed = 0, acc = 0, nextTuft = rng.range(0.4, 1.0), nextPool = rng.range(0.3, 0.8);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let d = 0; d < L; d += rng.range(0.22, 0.4)) {
        const t = d / L;
        const x = a.x + (b.x - a.x) * t + rng.jitter(0.12), z = a.z + (b.z - a.z) * t + rng.jitter(0.12);
        acc += 0.3;
        if (!ok(x, z)) continue;
        const y = getHeight(x, z);
        moss.push({ x, y, z, ry: rng.range(0, TAU), s: rng.range(0.06, 0.12), sy: rng.range(0.7, 1.2), color: new THREE.Color(1, 1, 1).offsetHSL(0, 0, rng.jitter(0.08)) });
        placed++;
        if (acc > nextTuft) {
          nextTuft = acc + rng.range(0.9, 1.8);
          // a tuft of glowing bonnets with small halos (the lenses' near field is kept clear above)
          kit.bonnets(x + rng.jitter(0.08), y, z + rng.jitter(0.08), { height: rng.range(0.11, 0.17), count: rng.int(2, 4), glow: true, spread: 1.4 });
          glowSpots.push({ x, y: y + 0.12, z });
        }
        if (acc > nextPool) {
          nextPool = acc + rng.range(2.6, 4.2);
          pools.push({ x, y, z, size: rng.range(0.7, 1.0), color: POOL_COL, strength: 0.6, lamp: false });
        }
      }
    }
    if (placed) trails++;
  };
  // (1) along the giants' root runs (the moss follows the root into the soil)
  const rootList = roots.filter((r) => Math.hypot(r.x, r.z) < 30 && r.z > -18);
  for (let i = 0; i < rootList.length && i < Math.round(9 * dens + 2); i++) {
    const r = rootList[Math.floor(rng.next() * rootList.length)];
    const ex = r.x + Math.sin(r.yaw) * r.len, ez = r.z + Math.cos(r.yaw) * r.len;
    // (a wavy line beside the root, out past its end)
    const side = rng.chance(0.5) ? 1 : -1, nx = Math.cos(r.yaw) * side * 0.22, nz = -Math.sin(r.yaw) * side * 0.22;
    lay([{ x: r.x + nx, z: r.z + nz }, { x: (r.x + ex) / 2 + nx * 1.4, z: (r.z + ez) / 2 + nz * 1.4 }, { x: ex + Math.sin(r.yaw) * 0.6 + nx, z: ez + Math.cos(r.yaw) * 0.6 + nz }]);
  }
  // (2) along the paths' edges (short dashed runs that lead from spot to spot)
  for (const p of pathPolylines) {
    const pts = p.pts;
    let s = 0, next = rng.range(2, 5);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      s += L;
      if (s < next) continue;
      next = s + rng.range(5, 9) / dens;
      let tx = b.x - a.x, tz = b.z - a.z;
      tx /= L || 1;
      tz /= L || 1;
      const side = rng.chance(0.5) ? 1 : -1;
      const off = p.halfWidth * rng.range(1.5, 1.85) + 0.15;
      const run = rng.range(1.6, 2.8);
      const run0 = [];
      for (let k = 0; k <= 4; k++) {
        const f = (k / 4 - 0.5) * run;
        const wob = Math.sin(k * 1.7 + i) * 0.12;
        run0.push({ x: b.x + tx * f - tz * (off + wob) * side, z: b.z + tz * f + tx * (off + wob) * side });
      }
      lay(run0);
    }
  }
  // (3) across the dark fern carpet in the overview's foreground (front-left
  //     and front-right): meandering lines of light between the ferns
  for (let k = 0; k < Math.round(12 * dens + 2); k++) {
    let x = rng.range(-21, 18), z = rng.range(15, 33);
    if (Math.abs(x) < 3.5 || getPathDistance(x, z) < 2) continue;
    if (!inShot(x, getHeight(x, z), z, 0.4)) continue;
    const pts = [];
    let h = rng.range(0, TAU);
    for (let i = 0; i < 8; i++) {
      pts.push({ x, z });
      h += rng.jitter(0.8);
      x += Math.sin(h) * 0.7;
      z += Math.cos(h) * 0.7;
    }
    if (Math.hypot(x, z) > GLEN_RADIUS + 14) continue;
    lay(pts);
  }
  return { moss, pools, glowSpots, trails };
}

/** The glowing-moss InstancedMesh for a list of placements (null if empty). */
export function glowMossMesh(items) {
  return instanced('glow-moss', mossDome(), glowMossMaterial(), items, { cast: false, receive: true });
}
