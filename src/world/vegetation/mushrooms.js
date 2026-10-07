// ─────────────────────────────────────────────────────────────────────────────
// Mushrooms of the glen — from thumb-sized toadstools to GIANT fly agarics
// taller than the houses' doors (refs: the fly-agaric forest path, the giant
// painterly mushrooms on the mossy mound, the fairy-garden caps with gills).
//
// A MushroomKit accumulates every mushroom of one group (giant / small) into
// one geometry per material, so the whole mushroom kingdom costs a handful
// of draw calls:
//   caps   materials.surface('mushroomCap', vertexColors)  velvet, colour per cap
//   stems  materials.surface('mushroomStem', vertexColors) fibrous cream, rings, bulbs
//   gills  materials.surface('gills', vertexColors)        radial lamellae under each cap
//   warts  raised white spots (cream, rough)
//   glow   bioluminescent caps (materials.glow — faint by day, teal at night)
//   glowgills / glowwarts  enchanted fly agarics: the gills (and, faintly,
//          the spots) glow soft mint at night — clones of the gills / wart
//          materials with an emissive that follows ctx.env.night
//          (updateMushroomGlow), near-invisible by day
// Kits can share their cheap parts (gills, warts, glow …): new MushroomKit(rng,
// { share: otherKit }) — the sharing kit then only emits caps & stems, so a
// whole family of kits costs caps + stems per kit + one draw per shared part.
// opts.lod (0.5..1) on every mushroom thins segments, rings and warts for
// mushrooms that no camera ever sees up close.
//
// kit.amanita(x, y, z, opts)    fly agaric: bulbous volva, skirt ring, dome /
//                               cone / flat cap, gills, raised warts
// kit.bolete(x, y, z, opts)     fat porcini: bun cap, pale pore underside
// kit.bonnets(x, y, z, opts)    a tuft of slender brown (or glowing) bonnets
// kit.bracket(p, n, opts)       shelf fungus on a log or trunk
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { GeoBuilder, TAU, staticMesh } from './common.js';

const UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Orthonormal frame around an axis. */
function frameFor(origin, axis) {
  const y = axis.clone().normalize();
  const ref = Math.abs(y.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : UP;
  const x = new THREE.Vector3().crossVectors(ref, y).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return { o: origin.clone(), x, y, z };
}

/**
 * Surface of revolution. profile: [{ r, y, v }] (radius, height along the
 * frame's y, texture v). seg radial segments (seam duplicated for UVs).
 * opts.wob(θ, k) → radius multiplier; opts.color(k, θ) → Color;
 * opts.flip: reverse winding (inside / underside faces); opts.disc: disc UVs.
 */
function lathe(B, F, profile, seg, { wob = null, color = null, flip = false, disc = 0, uMul = 1 } = {}) {
  const base = B.count;
  const n = profile.length;
  for (let k = 0; k < n; k++) {
    const p = profile[k];
    // 2D profile normal (perpendicular to the profile tangent, pointing outwards)
    const a = profile[Math.max(0, k - 1)], b = profile[Math.min(n - 1, k + 1)];
    let dr = b.r - a.r, dy = b.y - a.y;
    const l = Math.hypot(dr, dy) || 1;
    dr /= l;
    dy /= l;
    let nr = dy, ny = -dr;
    if (flip) {
      nr = -nr;
      ny = -ny;
    }
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * TAU;
      const w = wob ? wob(th, k) : 1;
      const r = p.r * w;
      const c = Math.cos(th), s = Math.sin(th);
      _p.copy(F.o).addScaledVector(F.x, c * r).addScaledVector(F.z, s * r).addScaledVector(F.y, p.y);
      _n.set(0, 0, 0).addScaledVector(F.x, c * nr).addScaledVector(F.z, s * nr).addScaledVector(F.y, ny).normalize();
      let u = (i / seg) * uMul, v = p.v;
      if (disc) {
        const rr = Math.min(1, p.r / disc);
        u = 0.5 + 0.5 * c * rr;
        v = 0.5 + 0.5 * s * rr;
      }
      B.vert(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z, u, v, color ? color(k, th) : null);
    }
  }
  const row = seg + 1;
  for (let k = 0; k < n - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = base + k * row + i;
      // (θ runs clockwise seen from the frame's +y, so outward faces wind a → a+row → …)
      if (flip) B.quad(a, a + 1, a + row + 1, a + row);
      else B.quad(a, a + row, a + row + 1, a + 1);
    }
  }
}

/** A low-poly lumpy wart, flattened along the normal. */
function wart(B, p, n, size, color, rng, seg = 5) {
  const F = frameFor(p, n);
  const base = B.count;
  const top = p.clone().addScaledVector(F.y, size * rng.range(0.3, 0.5)); // flattish flakes, not cones
  B.vert(top.x, top.y, top.z, F.y.x, F.y.y, F.y.z, 0.5, 0.5, color);
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU + rng.jitter(0.3);
    const r = size * rng.range(0.7, 1.1);
    const q = p.clone().addScaledVector(F.x, Math.cos(a) * r).addScaledVector(F.z, Math.sin(a) * r).addScaledVector(F.y, -size * 0.15);
    const nn = new THREE.Vector3().addScaledVector(F.x, Math.cos(a) * 0.6).addScaledVector(F.z, Math.sin(a) * 0.6).addScaledVector(F.y, 0.8).normalize();
    B.vert(q.x, q.y, q.z, nn.x, nn.y, nn.z, 0.5, 0.5, color);
  }
  for (let i = 0; i < seg; i++) B.tri(base, base + 1 + ((i + 1) % seg), base + 1 + i);
}

const C = (hex) => new THREE.Color(hex);

export const CAP_REDS = ['#c4301f', '#cc3a20', '#b82a1c', '#d2481f', '#c83a28'];
export const CAP_BROWNS = ['#a8653b', '#b07848', '#8c5634', '#b08a5a', '#c08a48'];

// ─── night glow (enchanted gills & spots) ────────────────────────────────────
const glowSets = new WeakMap();
/** The cloned, night-driven materials for glowing gills & spots (one set per materials library). */
export function mushroomGlowMaterials(ctx) {
  const M = ctx.materials;
  let set = glowSets.get(M);
  if (set) return set;
  const gills = M.surface('gills', { vertexColors: true }).clone();
  gills.name = 'gills-glow';
  gills.emissive = new THREE.Color('#86ecc4');
  const warts = M.standard('#f3eada', { roughness: 0.9, vertexColors: true }).clone();
  warts.name = 'warts-glow';
  warts.emissive = new THREE.Color('#e4ffd8');
  set = {
    gills,
    warts,
    levels: [
      [gills, 0.03, 1.0],
      [warts, 0.0, 0.42],
    ],
  };
  glowSets.set(M, set);
  updateMushroomGlow(ctx, 0);
  return set;
}
/** Follow the day/night cycle (call every frame; cheap). */
export function updateMushroomGlow(ctx, night) {
  const set = glowSets.get(ctx.materials);
  if (!set) return;
  const k = THREE.MathUtils.smoothstep(night, 0.1, 0.85);
  for (const [m, day, nightI] of set.levels) m.emissiveIntensity = day + (nightI - day) * k;
}

export class MushroomKit {
  /** shared: another kit whose gills, warts and glow builders this kit writes into. */
  constructor(rng, { share = null } = {}) {
    this.rng = rng;
    this.caps = new GeoBuilder();
    this.stems = new GeoBuilder();
    this.shared = !!share;
    this.gills = share ? share.gills : new GeoBuilder();
    this.warts = share ? share.warts : new GeoBuilder();
    this.glow = share ? share.glow : new GeoBuilder();
    this.glowGills = share ? share.glowGills : new GeoBuilder();
    this.glowWarts = share ? share.glowWarts : new GeoBuilder();
    this.glowPoints = share ? share.glowPoints : [];
  }

  /**
   * A fly agaric. opts: { height, capR, shape: 'dome'|'cone'|'flat', color,
   * lean (radians), leanAz, warts (density 0..1), ring (bool), sink }
   */
  amanita(x, y, z, opts = {}) {
    const rng = this.rng;
    const H = opts.height ?? 1;
    const R = opts.capR ?? H * 0.55;
    const shape = opts.shape ?? 'dome';
    const capCol = C(opts.color ?? rng.pick(CAP_REDS));
    // (resolution follows size: giants are seen up close, buttons only as dots
    //  of colour — and opts.lod thins whatever no lens ever comes close to)
    const lod = THREE.MathUtils.clamp(opts.lod ?? 1, 0.4, 1);
    const seg = Math.max(6, Math.round((opts.seg ?? (H > 1.2 ? 24 : H > 0.6 ? 15 : H > 0.3 ? 10 : 7)) * lod));
    const sseg = Math.max(5, Math.round(seg * (H > 1.2 ? 0.75 : 0.7)));
    const rings = Math.max(2, (H > 1.2 ? 7 : H > 0.4 ? 4 : 2) - (lod < 0.75 ? 1 : 0));
    const leanAz = opts.leanAz ?? rng.range(0, TAU);
    const lean = opts.lean ?? rng.range(0, 0.12);
    const sink = opts.sink ?? H * 0.06;
    // stem axis: a gentle S-curve towards the lean
    const leanDir = new THREE.Vector3(Math.sin(leanAz), 0, Math.cos(leanAz));
    const axisAt = (t) => {
      const off = Math.sin(lean) * H * t * t + Math.sin(t * Math.PI) * H * 0.03 * (opts.wiggle ?? 1);
      return new THREE.Vector3(x, y - sink + (H + sink) * t, z).addScaledVector(leanDir, off);
    };
    const rs = R * (opts.stemRatio ?? rng.range(0.17, 0.22));
    const phase = rng.range(0, TAU);
    const stemCol = C(opts.stemColor ?? rng.pick(['#efe0c0', '#ead9b6', '#f1e3c6', '#e6d3ae']));
    // stem: bulbous foot (volva), slimmer middle, flaring a little under the cap
    const stemProfile = [];
    const stemPts = [];
    for (let k = 0; k <= rings; k++) {
      const t = k / rings;
      const bulb = 1 + 0.85 * Math.exp(-Math.pow((t - 0.06) / 0.09, 2)) * (opts.bulb ?? 1);
      const flare = 1 + 0.25 * Math.pow(t, 6);
      const r = rs * (1 - 0.12 * Math.sin(t * Math.PI)) * bulb * flare;
      stemProfile.push(r);
      stemPts.push(axisAt(t * 0.97));
    }
    // emit the stem as a tube along the curved axis
    {
      const B = this.stems;
      const base = B.count;
      for (let k = 0; k <= rings; k++) {
        const p = stemPts[k];
        const a = stemPts[Math.max(0, k - 1)], b = stemPts[Math.min(rings, k + 1)];
        const F = frameFor(p, b.clone().sub(a));
        const t = k / rings;
        // darker, earthy foot
        const foot = 0.62 + 0.38 * Math.min(1, t * 4);
        for (let i = 0; i <= sseg; i++) {
          const th = (i / sseg) * TAU;
          // vertical fibres & snakeskin streaks, warmer and earthier towards the foot
          const streak = 1 - 0.16 * Math.max(0, Math.sin(th * 5 + phase) * Math.sin(th * 3 - phase * 2 + t * 3));
          const c = stemCol.clone().multiplyScalar(foot * streak);
          c.lerp(C('#c8b08a'), 0.25 * (1 - t));
          if (t < 0.25) c.lerp(C('#8a7350'), (0.25 - t) * 1.6);
          const w = 1 + 0.04 * Math.sin(th * 3 + phase + t * 4) + (t < 0.2 ? 0.07 * Math.sin(th * 7 + phase) : 0);
          const r = stemProfile[k] * w;
          const cx = Math.cos(th), sx = Math.sin(th);
          _p.copy(p).addScaledVector(F.x, cx * r).addScaledVector(F.z, sx * r);
          _n.set(0, 0, 0).addScaledVector(F.x, cx).addScaledVector(F.z, sx).normalize();
          B.vert(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z, i / sseg, t * Math.max(1, H * 0.8), c);
        }
      }
      const row = sseg + 1;
      for (let k = 0; k < rings; k++) for (let i = 0; i < sseg; i++) {
        const a = base + k * row + i;
        B.quad(a, a + row, a + row + 1, a + 1);
      }
    }
    const top = axisAt(1);
    const capAxis = new THREE.Vector3().subVectors(axisAt(1), axisAt(0.9)).normalize().lerp(UP, 0.4).normalize();
    // a slight extra tilt of the cap
    capAxis.x += rng.jitter(0.08);
    capAxis.z += rng.jitter(0.08);
    capAxis.normalize();
    const F = frameFor(top, capAxis);

    // volva scales: two ragged ridges around the bulb top
    if (H > 0.6 && (opts.volva ?? true)) {
      const vp = axisAt(0.13);
      const vr = stemProfile[Math.round(rings * 0.13)] * 1.02;
      const VF = frameFor(vp, axisAt(0.2).sub(axisAt(0.08)));
      lathe(this.stems, VF, [
        { r: vr * 0.98, y: -H * 0.015, v: 0 },
        { r: vr * 1.12, y: H * 0.012, v: 0.5 },
        { r: vr * 0.96, y: H * 0.03, v: 1 },
      ], sseg, { wob: (th) => 1 + 0.08 * Math.sin(th * 9 + phase), color: () => stemCol.clone().multiplyScalar(0.92) });
    }
    // the skirt (annulus) hanging below the cap
    if (opts.ring ?? H > 0.6) {
      const t0 = 0.78;
      const rp = axisAt(t0);
      const r0 = stemProfile[Math.round(rings * t0)];
      const RF = frameFor(rp, axisAt(t0 + 0.05).sub(axisAt(t0 - 0.05)));
      const drop = H * 0.11;
      const skirtWob = (th, k) => 1 + (0.05 + k * 0.05) * Math.sin(th * 6 + phase) + k * 0.04 * Math.sin(th * 13 + phase * 3);
      lathe(this.stems, RF, [
        { r: r0 * 0.98, y: 0, v: 0 },
        { r: r0 * 1.28, y: -drop * 0.35, v: 0.4 },
        { r: r0 * 1.42, y: -drop * 0.8, v: 0.8 },
        { r: r0 * 1.38, y: -drop, v: 1 },
      ], sseg, { wob: skirtWob, color: (k) => C('#f2e8d4').multiplyScalar(1 - k * 0.04) });
      // underside of the skirt (so it is not paper-thin from below — only the
      // giants are ever seen from that low)
      if (H > 1.2) lathe(this.stems, RF, [
        { r: r0 * 0.98, y: -drop * 0.12, v: 0 },
        { r: r0 * 1.3, y: -drop * 0.85, v: 0.8 },
        { r: r0 * 1.34, y: -drop * 1.02, v: 1 },
      ], sseg, { flip: true, wob: skirtWob, color: () => C('#cbbb9c') });
    }

    // cap profile: rim (v = 0) → apex (v = 1)
    const capH = shape === 'cone' ? R * rng.range(1.0, 1.35) : shape === 'flat' ? R * rng.range(0.22, 0.32) : R * rng.range(0.5, 0.68);
    const n = Math.max(3, Math.round((H > 1.2 ? 8 : H > 0.6 ? 6 : H > 0.3 ? 4 : 3) * (0.6 + 0.4 * lod)));
    const prof = [];
    // the rim rolls under a little
    prof.push({ r: R * 0.93, y: -R * 0.045, v: 0 });
    prof.push({ r: R, y: R * 0.01, v: 0.04 });
    for (let k = 1; k <= n; k++) {
      const t = k / n; // 0 rim → 1 apex
      const rho = 1 - t;
      let yy;
      if (shape === 'cone') yy = capH * (1 - Math.pow(rho, 1.15)) - capH * 0.08 * Math.pow(t, 6);
      else if (shape === 'flat') yy = capH * Math.sqrt(1 - rho * rho) * (1 - 0.15 * Math.exp(-rho * rho * 30)) + R * 0.04 * (rho > 0.8 ? -(rho - 0.8) : 0);
      else yy = capH * Math.pow(1 - Math.pow(rho, 2.2), 0.62);
      prof.push({ r: R * rho * (k === n ? 0.0 : 1), y: yy + R * 0.01, v: 0.04 + 0.96 * t });
    }
    const wobPhase = rng.range(0, TAU);
    const capWob = (th, k) => 1 + (0.035 * Math.sin(th * 3 + wobPhase) + 0.02 * Math.sin(th * 7 + wobPhase * 2)) * (k < 3 ? 1 : 0.6);
    const rimCol = capCol.clone().lerp(C('#f2c890'), 0.3);
    const topCol = capCol.clone().multiplyScalar(0.82);
    lathe(this.caps, F, prof, seg, {
      wob: capWob,
      color: (k) => {
        const t = Math.min(1, k / (prof.length - 1));
        return rimCol.clone().lerp(capCol, Math.min(1, t * 3)).lerp(topCol, Math.max(0, t - 0.5) * 1.6);
      },
    });
    // gills: underside from the rim to the stem, rising towards the stem
    const gillTop = Math.min(capH * 0.55, R * 0.28);
    const gProf = [
      { r: R * 0.93, y: -R * 0.045, v: 0 },
      { r: R * 0.62, y: gillTop * 0.35 - R * 0.03, v: 0.5 },
      { r: rs * 1.15, y: gillTop * 0.6, v: 0.97 },
      // …and down into the stem, closing the gap above the stem's open top
      { r: rs * 0.85, y: -H * 0.06, v: 1 },
    ];
    // (buttons: one band from the rim straight into the stem is enough)
    if (H < 0.4) gProf.splice(1, 1);
    // (some giants are bioluminescent: their gills glow softly at night)
    // (the gills face the ground and sit in the cap's shadow: painted lighter
    //  than white so they read warm cream like the references, not black)
    // (enchanted ones glow soft mint at night: gills → the night-glow gill material)
    const gillCol = C(opts.gillColor ?? '#f6ead2').multiplyScalar(1.7);
    lathe(opts.glowGills ? this.glowGills : this.gills, F, gProf, seg, { flip: true, disc: R, wob: (th, k) => (k === 0 ? capWob(th, 0) : 1), color: () => gillCol });
    if (opts.glowGills) {
      const under = F.o.clone().addScaledVector(F.y, -R * 0.3);
      this.glowPoints.push({ x: under.x, y: under.y, z: under.z, size: R * (opts.haloK ?? 1.5) });
    }

    // raised warts, denser towards the top, following the cap surface
    const density = opts.warts ?? 1;
    // (bold enough to read from across the glen: a few big flakes, many small spots)
    const nW = Math.round(density * (H > 1 ? 96 : H > 0.4 ? 17 : 6) * Math.min(2.2, R / Math.max(0.05, H * 0.5)) * (0.5 + 0.5 * lod));
    const wartCol = C('#f5ecd8');
    const wartB = opts.glowSpots ? this.glowWarts : this.warts;
    const wartSeg = H > 2.2 && lod > 0.8 ? 5 : 4;
    for (let i = 0; i < nW; i++) {
      // pick a profile position (area-weighted towards the rim, but keep the apex covered)
      const t = Math.pow(rng.next(), 0.75) * 0.92;
      const th = rng.range(0, TAU);
      const kf = 2 + t * (n - 1);
      const k0 = Math.floor(kf), k1 = Math.min(prof.length - 1, k0 + 1);
      const f = kf - k0;
      const rr = (prof[k0].r * (1 - f) + prof[k1].r * f) * capWob(th, k0);
      const yy = prof[k0].y * (1 - f) + prof[k1].y * f;
      const c = Math.cos(th), s = Math.sin(th);
      const p = F.o.clone().addScaledVector(F.x, c * rr).addScaledVector(F.z, s * rr).addScaledVector(F.y, yy);
      // surface normal from the profile slope
      const dr = prof[k1].r - prof[k0].r, dy = prof[k1].y - prof[k0].y;
      const l = Math.hypot(dr, dy) || 1;
      const nn = new THREE.Vector3().addScaledVector(F.x, c * (dy / l)).addScaledVector(F.z, s * (dy / l)).addScaledVector(F.y, -dr / l).normalize();
      const size = R * (rng.chance(0.3) ? rng.range(0.075, 0.125) : rng.range(0.035, 0.065)) * (1 - t * 0.25);
      wart(wartB, p, nn, size, wartCol.clone().multiplyScalar(rng.range(0.88, 1.02)), rng, wartSeg);
    }
    return { top, capR: R, capTop: top.y + capH };
  }

  /** A fat porcini/bolete. opts: { height, capR, color } */
  bolete(x, y, z, opts = {}) {
    const rng = this.rng;
    const H = opts.height ?? 0.2;
    const R = opts.capR ?? H * 0.7;
    const seg = 12;
    const F0 = frameFor(new THREE.Vector3(x, y - H * 0.05, z), new THREE.Vector3(rng.jitter(0.15), 1, rng.jitter(0.15)));
    const stemCol = C('#e8dcc0');
    lathe(this.stems, F0, [
      { r: R * 0.42, y: 0, v: 0 },
      { r: R * 0.6, y: H * 0.3, v: 0.3 },
      { r: R * 0.48, y: H * 0.75, v: 0.75 },
      { r: R * 0.36, y: H, v: 1 },
    ], seg, { color: (k) => stemCol.clone().multiplyScalar(0.8 + k * 0.07) });
    const F = frameFor(F0.o.clone().addScaledVector(F0.y, H), F0.y);
    const col = C(opts.color ?? rng.pick(['#7a4a26', '#8a5a2e', '#6e4022', '#946234']));
    const capH = R * 0.62;
    const prof = [
      { r: R * 0.9, y: -R * 0.06, v: 0 },
      { r: R, y: R * 0.08, v: 0.1 },
      { r: R * 0.85, y: capH * 0.65, v: 0.45 },
      { r: R * 0.5, y: capH * 0.95, v: 0.75 },
      { r: 0, y: capH, v: 1 },
    ];
    lathe(this.caps, F, prof, seg, { color: (k) => col.clone().lerp(C('#c89a5a'), k === 0 ? 0.4 : 0) });
    lathe(this.stems, F, [
      { r: R * 0.9, y: -R * 0.06, v: 0 },
      { r: R * 0.4, y: R * 0.02, v: 1 },
    ], seg, { flip: true, color: () => C('#d8c47a') });
  }

  /** A tuft of slender bonnets (glowing ones light up at night). opts: { count, height, glow, halo (night halo sprite, default on), color } */
  bonnets(x, y, z, opts = {}) {
    const rng = this.rng;
    const n = opts.count ?? rng.int(2, 5);
    const glow = !!opts.glow;
    const capB = glow ? this.glow : this.caps;
    const col = C(opts.color ?? (glow ? '#ffffff' : rng.pick(['#a87a4a', '#b8885a', '#c09868', '#946640'])));
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU), d = rng.range(0, 0.06) * (opts.spread ?? 1);
      const H = (opts.height ?? 0.12) * rng.range(0.55, 1.2);
      const R = H * rng.range(0.22, 0.32);
      const base = new THREE.Vector3(x + Math.sin(a) * d, y - 0.005, z + Math.cos(a) * d);
      const tip = base.clone().add(new THREE.Vector3(Math.sin(a) * H * 0.25 + rng.jitter(0.02), H, Math.cos(a) * H * 0.25 + rng.jitter(0.02)));
      const F0 = frameFor(base, tip.clone().sub(base));
      // (a thumbnail-sized bonnet: a 3-sided stalk, a 5-sided bell cap)
      lathe(this.stems, F0, [
        { r: R * 0.2, y: 0, v: 0 },
        { r: R * 0.12, y: base.distanceTo(tip), v: 1 },
      ], 3, { color: () => C(glow ? '#e8f4ec' : '#e2d2b4') });
      const F = frameFor(tip, tip.clone().sub(base).normalize().lerp(UP, 0.5));
      lathe(capB, F, [
        { r: R * 0.95, y: -R * 0.08, v: 0 },
        { r: R * 0.72, y: R * 0.62, v: 0.55 },
        { r: 0, y: R * 1.05, v: 1 },
      ], 5, { color: () => col });
      lathe(this.gills, F, [
        { r: R * 0.95, y: -R * 0.08, v: 0 },
        { r: R * 0.12, y: R * 0.3, v: 1 },
      ], 5, { flip: true, disc: R, color: () => C(glow ? '#cfeee4' : '#e8d8bc') });
      if (glow && opts.halo !== false) this.glowPoints.push({ x: tip.x, y: tip.y + R * 0.4, z: tip.z, size: R * 3.2 });
    }
  }

  /** A shelf fungus growing out of a surface at p with outward normal n. opts: { size, color, tiers } */
  bracket(p, n, opts = {}) {
    const rng = this.rng;
    const tiers = opts.tiers ?? rng.int(1, 3);
    const col = C(opts.color ?? rng.pick(['#c88a48', '#b8743a', '#d8b078', '#a86a3a', '#e0c090']));
    const out = new THREE.Vector3(n.x, 0, n.z).normalize();
    for (let t = 0; t < tiers; t++) {
      const s = (opts.size ?? 0.2) * (1 - t * 0.25) * rng.range(0.85, 1.1);
      const c = p.clone().add(new THREE.Vector3(rng.jitter(0.05), -t * s * 0.7, rng.jitter(0.05)));
      const F = frameFor(c, UP);
      // a half disc fan: rotate the frame so +x points outwards
      const seg = 9;
      const prof = [
        { r: s, y: -s * 0.08, v: 0 },
        { r: s * 0.92, y: s * 0.12, v: 0.3 },
        { r: s * 0.55, y: s * 0.24, v: 0.7 },
        { r: 0.0, y: s * 0.28, v: 1 },
      ];
      const ang0 = Math.atan2(out.z, out.x);
      // emit only the outward half (θ from −90° to +90° around `out`)
      const B = this.caps;
      const base = B.count;
      for (let k = 0; k < prof.length; k++) {
        for (let i = 0; i <= seg; i++) {
          const th = ang0 - Math.PI / 2 + (i / seg) * Math.PI;
          const rr = prof[k].r * (1 + 0.06 * Math.sin(th * 5));
          _p.set(c.x + Math.cos(th) * rr, c.y + prof[k].y, c.z + Math.sin(th) * rr);
          _n.set(Math.cos(th) * 0.4, 1, Math.sin(th) * 0.4).normalize();
          const cc = col.clone().lerp(C('#f2e2c0'), k === 0 ? 0.55 : k === 1 ? 0.2 : 0);
          B.vert(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z, i / seg, prof[k].v, cc);
        }
      }
      const row = seg + 1;
      for (let k = 0; k < prof.length - 1; k++) for (let i = 0; i < seg; i++) {
        const a = base + k * row + i;
        B.quad(a, a + row, a + row + 1, a + 1);
      }
      // underside (pores)
      const G = this.gills;
      const gb = G.count;
      G.vert(c.x, c.y - s * 0.02, c.z, 0, -1, 0, 0.5, 0.5, C('#eadcc0'));
      for (let i = 0; i <= seg; i++) {
        const th = ang0 - Math.PI / 2 + (i / seg) * Math.PI;
        const rr = s * (1 + 0.06 * Math.sin(th * 5));
        G.vert(c.x + Math.cos(th) * rr, c.y - s * 0.08, c.z + Math.sin(th) * rr, 0, -1, 0, 0.5 + 0.5 * Math.cos(th), 0.5 + 0.5 * Math.sin(th), C('#eadcc0'));
      }
      for (let i = 0; i < seg; i++) G.tri(gb, gb + 1 + i, gb + 2 + i);
      void F;
    }
  }

  /**
   * Emit the meshes (skips empty parts). A kit that shares another kit's
   * parts only emits its caps & stems (the owner emits the shared parts —
   * build the sharing kits FIRST, or their shared geometry is missed).
   */
  build(ctx, name, { cast = false } = {}) {
    const M = ctx.materials;
    const out = [];
    const add = (B, mat, part, castIt = cast) => {
      if (!B.count) return;
      const m = staticMesh(`${name}-${part}`, B.build(), mat, { cast: castIt, receive: true });
      m.raycast = () => {};
      out.push(m);
    };
    add(this.caps, M.surface('mushroomCap', { vertexColors: true }), 'caps');
    add(this.stems, M.surface('mushroomStem', { vertexColors: true }), 'stems');
    if (this.shared) return out;
    add(this.gills, M.surface('gills', { vertexColors: true }), 'gills', false);
    add(this.warts, M.standard('#f3eada', { roughness: 0.9, vertexColors: true }), 'warts', false);
    add(this.glow, M.glow('#8ff5d6', { day: 0.12, night: 1.25 }), 'glowcaps', false);
    if (this.glowGills.count || this.glowWarts.count) {
      const G = mushroomGlowMaterials(ctx);
      add(this.glowGills, G.gills, 'glowgills', false);
      add(this.glowWarts, G.warts, 'glowwarts', false);
    }
    return out;
  }
}
