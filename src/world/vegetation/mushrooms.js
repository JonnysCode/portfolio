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
//          (updateMushroomGlow), near-invisible by day. The gill glow is
//          graded (bright by the stem → ≈ 25 % at the rim, faint lamellae);
//   sheath additive night glow over the upper stem, the skirt and the cap
//          rim of every enchanted mushroom taller than 0.6 (one draw)
// Kits can share their cheap parts (gills, warts, glow …): new MushroomKit(rng,
// { share: otherKit }) — the sharing kit then only emits caps & stems, so a
// whole family of kits costs caps + stems per kit + one draw per shared part.
// opts.lod (0.5..1) on every mushroom thins segments, rings and warts for
// mushrooms that no camera ever sees up close.
//
// kit.amanita(x, y, z, opts)    fly agaric (and its kin — panther caps, ochre
//                               and orange amanitas, parasols): bulbous volva,
//                               skirt ring, dome / cone / flat / upturned (old)
//                               cap, gills, raised warts (colour per species)
// kit.parasol(x, y, z, opts)    parasol mushroom at three ages (drumstick bud,
//                               half-open bell, open parasol with umbo, scales,
//                               drooping rim, snakeskin stem and a loose ring)
// kit.bolete(x, y, z, opts)     fat porcini: bun cap, pale pore underside
// kit.bonnets(x, y, z, opts)    a tuft of slender brown (or glowing) bonnets
// kit.bracket(p, n, opts)       shelf fungus on a log or trunk
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { GeoBuilder, TAU, staticMesh, moonRim } from './common.js';
import { sharedUniforms } from '../../core/materials.js';

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

/**
 * A low-poly lumpy wart, flattened along the normal. (Rounded: the centre
 * domes up and the rim normals splay outwards, so even a 5-sided flake shades
 * like a soft cushion of veil, not a flat chip; round = an extra shoulder
 * ring for the giants' big warts, seen up close.)
 */
function wart(B, p, n, size, color, rng, seg = 5, round = false) {
  const F = frameFor(p, n);
  const base = B.count;
  const lift = size * (round ? rng.range(0.5, 0.62) : rng.range(0.34, 0.52)); // cushions, not cones
  const top = p.clone().addScaledVector(F.y, lift);
  B.vert(top.x, top.y, top.z, F.y.x, F.y.y, F.y.z, 0.5, 0.5, color);
  const ph = rng.range(0, TAU);
  const rr = [];
  for (let i = 0; i < seg; i++) rr.push(size * rng.range(0.78, 1.1));
  if (round) {
    // the shoulder: 70 % out, most of the way up — a soft dome of veil
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU + ph;
      const r = rr[i] * 0.72;
      const q = p.clone().addScaledVector(F.x, Math.cos(a) * r).addScaledVector(F.z, Math.sin(a) * r).addScaledVector(F.y, lift * 0.8);
      const nn = new THREE.Vector3().addScaledVector(F.x, Math.cos(a) * 0.62).addScaledVector(F.z, Math.sin(a) * 0.62).addScaledVector(F.y, 0.78).normalize();
      B.vert(q.x, q.y, q.z, nn.x, nn.y, nn.z, 0.5, 0.5, color);
    }
  }
  const ring = B.count;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU + ph;
    const r = rr[i];
    const q = p.clone().addScaledVector(F.x, Math.cos(a) * r).addScaledVector(F.z, Math.sin(a) * r).addScaledVector(F.y, -size * 0.15);
    const nn = new THREE.Vector3().addScaledVector(F.x, Math.cos(a) * 0.85).addScaledVector(F.z, Math.sin(a) * 0.85).addScaledVector(F.y, 0.55).normalize();
    B.vert(q.x, q.y, q.z, nn.x, nn.y, nn.z, 0.5, 0.5, color);
  }
  const inner = round ? base + 1 : ring;
  for (let i = 0; i < seg; i++) B.tri(base, inner + ((i + 1) % seg), inner + i);
  if (round) {
    for (let i = 0; i < seg; i++) {
      const i1 = (i + 1) % seg;
      B.quad(inner + i, inner + i1, ring + i1, ring + i);
    }
  }
}

const C = (hex) => new THREE.Color(hex);

export const CAP_REDS = ['#c4301f', '#cc3a20', '#b82a1c', '#d2481f', '#c83a28'];
export const CAP_BROWNS = ['#a8653b', '#b07848', '#8c5634', '#b08a5a', '#c08a48'];
/** Ochre / tan amanitas (the painterly giants of the mossy-door reference). */
export const CAP_OCHRES = ['#c8a465', '#d4b274', '#b8945a', '#dcbc80', '#c09a5c'];
/** Golden apricot caps (caesar's / chanterelle hues — clearly not a fly agaric's red). */
export const CAP_ORANGES = ['#e0943c', '#e8a44a', '#d68634', '#eaa850'];
export const CAP_TANS = ['#d8c09a', '#ccb088', '#e0caa4', '#c4a47c'];
/** Porcini & co.: chestnut, hazel, ochre and tan bun caps. */
export const CAP_BOLETES = ['#7a4a26', '#8a5a2e', '#a0703a', '#b8884c', '#6e4022', '#c09858'];

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
  // the glow is graded like light in real gills: brightest by the stem, ≈ 30 %
  // at the rim, with faint radial lamellae (the gills' disc UVs: centre = stem)
  // — no longer one evenly lit, hard-edged ellipse (a cyan saucer from afar)
  {
    const prev = gills.onBeforeCompile;
    gills.onBeforeCompile = (shader, renderer) => {
      prev?.call(gills, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    vec2 gq = vUv - 0.5;
    float gr = clamp(length(gq) * 2.0, 0.0, 1.0);
    float ga = atan(gq.y, gq.x);
    float gg = mix(1.0, 0.22, smoothstep(0.12, 0.9, gr));
    float gs = ga * 38.0;
    float gw = 38.0 * length(fwidth(gq)) / max(length(gq), 1e-3);
    float gl = 0.5 + 0.5 * cos(gs + 2.0 * sin(ga * 5.0));
    gg *= mix(1.0, 0.5 + 0.7 * gl, (1.0 - smoothstep(0.45, 1.4, gw)) * smoothstep(0.1, 0.3, gr));
    totalEmissiveRadiance *= gg * 0.85;
  }`);
    };
    const key = gills.customProgramCacheKey();
    gills.customProgramCacheKey = () => `${key}|gills-radial-glow`;
  }
  const warts = M.standard('#ffffff', { roughness: 0.9, vertexColors: true }).clone();
  warts.name = 'warts-glow';
  warts.emissive = new THREE.Color('#e4ffd8');
  // (the forest giants' spots: a faint milky-mint glint and a silver moon catch,
  //  so the dome reads above the glowing gills — the cottages clone `warts`)
  const wartsMoon = moonRim(M.standard('#ffffff', { roughness: 0.9, vertexColors: true }), { rim: 0.04, pow: 2, up: 0.5, color: [0.8, 0.86, 0.9] });
  wartsMoon.name = 'warts-glow-moon';
  wartsMoon.emissive = new THREE.Color('#e4ffd8');
  // (and the plain spots of every forest giant: a faint milky glow at night — soft
  //  pale dots that keep the dome readable, never blue-grey gravel)
  const wartsPlain = moonRim(M.standard('#ffffff', { roughness: 0.9, vertexColors: true }), { rim: 0.04, pow: 2, up: 0.5, color: [0.8, 0.86, 0.9] });
  wartsPlain.name = 'warts-moon';
  wartsPlain.emissive = new THREE.Color('#eef2e6');
  set = {
    gills,
    warts,
    wartsMoon,
    wartsPlain,
    levels: [
      [gills, 0.03, 1.0],
      [warts, 0.0, 0.42],
      [wartsMoon, 0.0, 0.52],
      [wartsPlain, 0.0, 0.1],
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

// ─── the glow sheath (enchanted giants at night) ─────────────────────────────
// Light the glowing gills throw: a soft mint glow running down the upper stem
// (brightest under the cap) and the cap's thin rim glowing through. A thin
// additive shell over those parts — vertex colours carry the strength — that
// follows the night (invisible, and discarded, by day). One draw.
let sheathMat = null;
function glowSheathMaterial() {
  if (sheathMat) return sheathMat;
  sheathMat = new THREE.ShaderMaterial({
    name: 'mushroom-glow-sheath',
    uniforms: { uNight: sharedUniforms.uNight, uGain: { value: 1 } },
    vertexColors: true,
    vertexShader: /* glsl */ `
      varying vec3 vCol;
      varying float vFace;
      varying float vFade;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vFace = abs(dot(n, normalize(-mv.xyz)));
        vCol = color;
        vFade = 1.0 - smoothstep(50.0, 105.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      uniform float uGain;
      varying vec3 vCol;
      varying float vFace;
      varying float vFade;
      void main() {
        float k = smoothstep(0.12, 0.85, uNight) * vFade;
        if (k < 0.002) discard;
        // soft at the silhouette, fuller where the surface faces the eye
        gl_FragColor = vec4(vCol * (uGain * k * (0.3 + 0.7 * vFace)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    // (the skirt's band winds the other way round: both faces — whatever lies
    //  behind is depth-tested away by the stem / cap it wraps)
    side: THREE.DoubleSide,
    fog: false,
  });
  return sheathMat;
}
const SHEATH = new THREE.Color('#7cf0c8');

export class MushroomKit {
  /**
   * share: another kit whose gills, warts and glow builders this kit writes into.
   * detail (0..1, the quality tier's geometric detail): fewer but bigger wart
   * flakes on lower tiers — the same spotted look for far fewer triangles.
   */
  constructor(rng, { share = null, detail = 1 } = {}) {
    this.rng = rng;
    this.detail = THREE.MathUtils.clamp(detail, 0.3, 1);
    this.caps = new GeoBuilder();
    this.stems = new GeoBuilder();
    this.shared = !!share;
    this.gills = share ? share.gills : new GeoBuilder();
    this.warts = share ? share.warts : new GeoBuilder();
    this.glow = share ? share.glow : new GeoBuilder();
    this.glowGills = share ? share.glowGills : new GeoBuilder();
    this.glowWarts = share ? share.glowWarts : new GeoBuilder();
    this.glowPoints = share ? share.glowPoints : [];
    this.sheath = share ? share.sheath : new GeoBuilder();
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
    // (the cap texture is neutral — see build(): the vertex colour alone sets the
    //  species' hue, lifted a little so the velvet keeps its glow; reds a touch more)
    const capCol = C(opts.color ?? rng.pick(CAP_REDS));
    capCol.multiplyScalar(opts.capGain ?? (capCol.r > capCol.g * 4 ? 1.6 : 1.25));
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
    const stemPick = rng.pick(['#efe0c0', '#ead9b6', '#f1e3c6', '#e6d3ae']);
    const stemCol = C(opts.stemColor ?? stemPick);
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
    let skirt = null;
    if (opts.ring ?? H > 0.6) {
      const t0 = 0.78;
      const rp = axisAt(t0);
      const r0 = stemProfile[Math.round(rings * t0)];
      const RF = frameFor(rp, axisAt(t0 + 0.05).sub(axisAt(t0 - 0.05)));
      const drop = H * 0.11;
      const skirtWob = (th, k) => 1 + (0.05 + k * 0.05) * Math.sin(th * 6 + phase) + k * 0.04 * Math.sin(th * 13 + phase * 3);
      skirt = { RF, r0, drop, wob: skirtWob };
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
    const upturned = shape === 'upturned';
    const capH = shape === 'cone' ? R * rng.range(1.0, 1.35) : shape === 'flat' ? R * rng.range(0.22, 0.32) : upturned ? R * rng.range(0.24, 0.34) : R * rng.range(0.5, 0.68);
    const n = Math.max(3, Math.round((H > 1.2 ? 8 : H > 0.6 ? 6 : H > 0.3 ? 4 : 3) * (0.6 + 0.4 * lod)));
    const prof = [];
    if (upturned) {
      // an old cap: the rim has curled up into a shallow wavy bowl around a low umbo
      prof.push({ r: R * 0.95, y: capH * 0.52, v: 0 });
      prof.push({ r: R, y: capH * 0.7, v: 0.04 });
    } else {
      // the rim rolls under a little
      prof.push({ r: R * 0.93, y: -R * 0.045, v: 0 });
      prof.push({ r: R, y: R * 0.01, v: 0.04 });
    }
    for (let k = 1; k <= n; k++) {
      const t = k / n; // 0 rim → 1 apex
      const rho = 1 - t;
      let yy;
      if (shape === 'cone') yy = capH * (1 - Math.pow(rho, 1.15)) - capH * 0.08 * Math.pow(t, 6);
      else if (shape === 'flat') yy = capH * Math.sqrt(1 - rho * rho) * (1 - 0.15 * Math.exp(-rho * rho * 30)) + R * 0.04 * (rho > 0.8 ? -(rho - 0.8) : 0);
      else if (upturned) yy = capH * (0.32 * Math.exp(-rho * rho * 14) + 0.62 * Math.pow(rho, 2.2));
      else yy = capH * Math.pow(1 - Math.pow(rho, 2.2), 0.62);
      prof.push({ r: R * rho * (k === n ? 0.0 : 1), y: yy + R * 0.01, v: 0.04 + 0.96 * t });
    }
    const wobPhase = rng.range(0, TAU);
    // (old upturned caps are wavier and a little torn at the rim)
    const wavy = upturned ? 2.2 : 1;
    const capWob = (th, k) => 1 + (0.035 * Math.sin(th * 3 + wobPhase) + 0.02 * Math.sin(th * 7 + wobPhase * 2)) * (k < 3 ? wavy : 0.6);
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
    const gProf = upturned
      ? [
        // (the upturned bowl's underside: from the lifted rim down to the stem)
        { r: R * 0.95, y: capH * 0.5, v: 0 },
        { r: R * 0.62, y: capH * 0.06 - R * 0.025, v: 0.5 },
        { r: rs * 1.15, y: -R * 0.03, v: 0.97 },
        { r: rs * 0.85, y: -H * 0.06, v: 1 },
      ]
      : [
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
      // (the giants' halo stays tucked under the cap, round the stem's top — a
      //  wide halo disc read as a flying saucer from across the glen)
      const big = H > 1.2;
      const under = F.o.clone().addScaledVector(F.y, -R * (big ? 0.16 : 0.3));
      this.glowPoints.push({ x: under.x, y: under.y, z: under.z, size: R * (big ? Math.min(0.55, (opts.haloK ?? 1.5) * 0.45) : opts.haloK ?? 1.5) });
      if (H > 0.6) {
        // the glow sheath: the upper stem lit by the gills, fading downwards …
        const S = this.sheath;
        const ss = Math.max(6, Math.round(sseg * 0.75));
        const k0 = Math.max(1, Math.round(rings * 0.4));
        const base = S.count;
        for (let k = k0; k <= rings; k++) {
          const t = k / rings;
          const p = stemPts[k];
          const a = stemPts[Math.max(0, k - 1)], b = stemPts[Math.min(rings, k + 1)];
          const SF = frameFor(p, b.clone().sub(a));
          const g = Math.pow(THREE.MathUtils.smoothstep(t, 0.4, 0.97), 1.6) * 0.36;
          const c = SHEATH.clone().multiplyScalar(g);
          const r = stemProfile[k] * 1.06 + R * 0.004;
          for (let i = 0; i <= ss; i++) {
            const th = (i / ss) * TAU;
            const cx = Math.cos(th), sx = Math.sin(th);
            _p.copy(p).addScaledVector(SF.x, cx * r).addScaledVector(SF.z, sx * r);
            _n.set(0, 0, 0).addScaledVector(SF.x, cx).addScaledVector(SF.z, sx).normalize();
            S.vert(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z, 0, 0, c);
          }
        }
        const row = ss + 1;
        for (let k = 0; k < rings - k0; k++) for (let i = 0; i < ss; i++) {
          const q = base + k * row + i;
          S.quad(q, q + row, q + row + 1, q + 1);
        }
        // … the skirt's upper face catching the gills' light (no dark ruffle
        //    across the glowing stem) …
        if (skirt) {
          const { RF, r0, drop, wob } = skirt;
          lathe(S, RF, [
            { r: r0 * 1.01, y: R * 0.004, v: 0 },
            { r: r0 * 1.31, y: -drop * 0.33, v: 0.4 },
            { r: r0 * 1.45, y: -drop * 0.78, v: 0.8 },
            { r: r0 * 1.41, y: -drop * 0.99, v: 1 },
          ], ss, { wob, color: (k) => SHEATH.clone().multiplyScalar(0.3 - k * 0.07) });
        }
        // … and the thin cap rim glowing through: a narrow band over the rim
        //    roll only (the cap's own facets, lifted off the surface), fading out
        //    a little way up the side — the dome above stays the cap's own red
        if (!upturned && prof.length > 2) {
          const p0 = prof[0], p1 = prof[1], p2 = prof[2];
          const up = { r: p1.r + (p2.r - p1.r) * 0.3, y: p1.y + (p2.y - p1.y) * 0.3, v: 0 };
          const band = [p0, p1, up].map((p) => ({ r: p.r * 1.006 + R * 0.008, y: p.y + R * 0.006, v: 0 }));
          lathe(S, F, band, seg, {
            wob: (th, k) => capWob(th, k === 2 ? 1 : k),
            color: (k) => SHEATH.clone().multiplyScalar(k === 0 ? 0.24 : k === 1 ? 0.1 : 0),
          });
        }
      }
    }

    // raised warts, denser towards the top, following the cap surface
    const density = opts.warts ?? 1;
    // (bold enough to read from across the glen: a few big flakes, many small spots)
    const dk = this.detail * this.detail;
    const nW = Math.round(density * (H > 1 ? 96 : H > 0.4 ? 17 : 6) * Math.min(2.2, R / Math.max(0.05, H * 0.5)) * (0.5 + 0.5 * lod) * dk);
    const wartK = 1 / Math.sqrt(dk);
    // (a cool, chalky white: the white material × a cream colour multiplied
    //  down to khaki under the warm grade)
    const wartCol = C(opts.wartColor ?? '#f8f6f0');
    const wartB = opts.glowSpots ? this.glowWarts : this.warts;
    const wartSeg = H > 2.2 && lod > 0.8 ? 6 : H > 1 ? 5 : 4;
    const wartRound = H > 1.2 && lod > 0.7;
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
      const size = R * (rng.chance(0.3) ? rng.range(0.075, 0.125) : rng.range(0.035, 0.065)) * (1 - t * 0.25) * Math.min(1.5, wartK);
      wart(wartB, p, nn, size, wartCol.clone().multiplyScalar(rng.range(0.9, 1.0)), rng, wartSeg, wartRound && size > R * 0.06);
    }
    return { top, capR: R, capTop: top.y + capH };
  }

  /**
   * A parasol mushroom (Macrolepiota) at one of three ages — not a pale disc
   * on a pole: opts.age ≥ 0.75 the open parasol (a wide, shallow cap with a
   * dark central umbo, concentric tan-brown scales, a drooping ragged rim over
   * a shadowed gill line), 0.35–0.75 the half-open bell, < 0.35 the young
   * "drumstick" (a closed brown egg on its stem). The stem is tall and
   * slender, snakeskin-banded, bulbous at the foot, leaning and gently curved,
   * with a loose, thick double ring that has slid down a little and sits
   * askew. opts: { height, capR, age, lean, leanAz, curve, lod }
   */
  parasol(x, y, z, opts = {}) {
    const rng = this.rng;
    const H = opts.height ?? 1;
    const age = opts.age ?? 1;
    const stage = age >= 0.75 ? 'open' : age >= 0.35 ? 'bell' : 'bud';
    const R = (opts.capR ?? H * 0.5) * (stage === 'open' ? 1 : stage === 'bell' ? 0.62 : 0.34);
    const lod = THREE.MathUtils.clamp(opts.lod ?? 1, 0.4, 1);
    const seg = Math.max(7, Math.round((H > 1.2 ? 26 : H > 0.6 ? 18 : H > 0.3 ? 12 : 8) * lod));
    const sseg = Math.max(5, Math.round(seg * 0.5));
    // (enough rings for the snakeskin bands to read)
    const rings = Math.max(4, Math.round((H > 1.2 ? 16 : H > 0.5 ? 9 : 5) * (0.6 + 0.4 * lod)));
    const leanAz = opts.leanAz ?? rng.range(0, TAU);
    const lean = opts.lean ?? rng.range(0.05, 0.16);
    const curve = opts.curve ?? rng.range(0.04, 0.09);
    const leanDir = new THREE.Vector3(Math.sin(leanAz), 0, Math.cos(leanAz));
    const sideDir = new THREE.Vector3(Math.cos(leanAz), 0, -Math.sin(leanAz));
    const sink = H * 0.05;
    // (leans out, then the top turns back up towards the light: a gentle S)
    const axisAt = (t) => new THREE.Vector3(x, y - sink + (H + sink) * t, z)
      .addScaledVector(leanDir, Math.sin(lean) * H * t * t - Math.sin(t * Math.PI) * H * curve * 0.5)
      .addScaledVector(sideDir, Math.sin(t * Math.PI * 1.3) * H * curve * 0.35);
    const rs = Math.max(0.006, H * (stage === 'bud' ? 0.05 : 0.042));
    const phase = rng.range(0, TAU);
    const cream = C('#eee2c6');
    const band = C('#7a5638');
    // ── stem: bulbous foot, slender shaft, snakeskin chevrons ──
    {
      const B = this.stems;
      const base = B.count;
      const pts = [];
      for (let k = 0; k <= rings; k++) pts.push(axisAt((k / rings) * 0.98));
      for (let k = 0; k <= rings; k++) {
        const t = k / rings;
        const p = pts[k];
        const F = frameFor(p, pts[Math.min(rings, k + 1)].clone().sub(pts[Math.max(0, k - 1)]));
        const bulb = 1 + 1.1 * Math.exp(-Math.pow((t - 0.03) / 0.08, 2));
        const r = rs * bulb * (1 - 0.18 * t);
        for (let i = 0; i <= sseg; i++) {
          const th = (i / sseg) * TAU;
          // zig-zag brown bands, finer and fainter towards the cap
          const zig = Math.sin(t * (H > 0.5 ? 34 : 18) + Math.abs(Math.sin(th * 1.5 + phase)) * 3.2 + phase);
          const b = THREE.MathUtils.smoothstep(zig, 0.05, 0.6) * (1 - THREE.MathUtils.smoothstep(t, 0.74, 0.9)) * (t > 0.08 ? 1 : 0.3);
          const c = cream.clone().lerp(band, b * 0.85);
          if (t < 0.08) c.lerp(C('#a08868'), 0.35);
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
    // ── the loose double ring, slid down the stem and sitting askew ──
    if (stage !== 'bud' && H > 0.25) {
      const t0 = stage === 'open' ? rng.range(0.6, 0.72) : 0.82;
      const p = axisAt(t0);
      const ax = axisAt(t0 + 0.04).sub(axisAt(t0 - 0.04)).normalize();
      ax.x += rng.jitter(0.35);
      ax.z += rng.jitter(0.35);
      ax.normalize();
      const F = frameFor(p, ax);
      const h = H * 0.022, r1 = rs * 1.15, r2 = rs * 2.1;
      lathe(this.stems, F, [
        { r: r1, y: -h, v: 0 },
        { r: r2, y: -h * 0.6, v: 0.3 },
        { r: r2 * 1.04, y: h * 0.5, v: 0.7 },
        { r: r1 * 1.1, y: h, v: 1 },
      ], sseg, { wob: (th) => 1 + 0.06 * Math.sin(th * 5 + phase), color: (k) => (k === 1 ? C('#7a5c40') : C('#e8dcc0')) });
    }
    // ── cap ──
    const top = axisAt(1);
    const capAxis = axisAt(1).sub(axisAt(0.9)).normalize().lerp(UP, 0.55).normalize();
    capAxis.x += rng.jitter(0.06);
    capAxis.z += rng.jitter(0.06);
    capAxis.normalize();
    const F = frameFor(top, capAxis);
    let prof;
    if (stage === 'open') prof = [
      // drooping, slightly ragged rim → shallow shoulder → a raised umbo
      { r: R * 0.95, y: -R * 0.13, v: 0 },
      { r: R * 1.0, y: -R * 0.05, v: 0.06 },
      { r: R * 0.88, y: R * 0.06, v: 0.2 },
      { r: R * 0.66, y: R * 0.12, v: 0.4 },
      { r: R * 0.42, y: R * 0.16, v: 0.58 },
      { r: R * 0.22, y: R * 0.2, v: 0.75 },
      { r: R * 0.14, y: R * 0.27, v: 0.88 },
      { r: 0, y: R * 0.3, v: 1 },
    ];
    else if (stage === 'bell') prof = [
      { r: R * 0.82, y: -R * 0.12, v: 0 },
      { r: R * 0.96, y: R * 0.12, v: 0.15 },
      { r: R * 0.85, y: R * 0.45, v: 0.4 },
      { r: R * 0.55, y: R * 0.7, v: 0.65 },
      { r: R * 0.22, y: R * 0.84, v: 0.88 },
      { r: 0, y: R * 0.88, v: 1 },
    ];
    else prof = [
      // the drumstick: a closed brown egg, its rim tucked against the stem
      { r: rs * 1.3, y: -R * 0.5, v: 0 },
      { r: R * 0.72, y: -R * 0.2, v: 0.15 },
      { r: R * 0.86, y: R * 0.25, v: 0.35 },
      { r: R * 0.72, y: R * 0.72, v: 0.6 },
      { r: R * 0.4, y: R * 1.02, v: 0.85 },
      { r: 0, y: R * 1.12, v: 1 },
    ];
    if (lod < 0.7 && prof.length > 6) prof.splice(4, 1);
    const n = prof.length;
    const umbo = C('#6e4a2c');
    const tan = C(opts.color ?? rng.pick(['#e4d2ae', '#dcc8a0', '#e8d8b8']));
    const scale = C('#9a7350');
    const wobPhase = rng.range(0, TAU);
    // (a torn, wavy rim; the cap a little lopsided)
    const capWob = (th, k) => 1 + (k < 2 ? 0.045 * Math.sin(th * 3 + wobPhase) + 0.03 * Math.abs(Math.sin(th * 9 + wobPhase * 2)) : 0.02 * Math.sin(th * 3 + wobPhase));
    lathe(this.caps, F, prof, seg, {
      wob: capWob,
      color: (k, th) => {
        const t = k / (n - 1); // 0 rim → 1 apex
        if (stage === 'bud') return umbo.clone().lerp(scale, 0.3 * Math.abs(Math.sin(th * 4 + k)));
        // the brown skin cracks into concentric rings of scales on the cream flesh
        const crack = Math.abs(Math.sin(th * (5 + k * 2) + k * 1.9 + phase)) * (0.75 + 0.25 * Math.sin(th * 13 + k * 3.1));
        const sc = THREE.MathUtils.smoothstep(crack, 0.3, 0.7) * (0.45 + 0.55 * t);
        return tan.clone().lerp(scale, sc * 0.7).lerp(umbo, THREE.MathUtils.smoothstep(t, 0.6, 0.85));
      },
    });
    // gills: cream lamellae, a deep shadow line just inside the drooping rim
    if (stage !== 'bud') {
      const gp = stage === 'open'
        ? [
          { r: R * 0.95, y: -R * 0.13, v: 0 },
          { r: R * 0.88, y: -R * 0.09, v: 0.12 },
          { r: R * 0.5, y: R * 0.02, v: 0.55 },
          { r: rs * 1.6, y: R * 0.04, v: 0.97 },
          { r: rs * 0.9, y: -H * 0.04, v: 1 },
        ]
        : [
          { r: R * 0.82, y: -R * 0.12, v: 0 },
          { r: R * 0.5, y: R * 0.2, v: 0.5 },
          { r: rs * 1.3, y: R * 0.3, v: 0.97 },
          { r: rs * 0.9, y: -H * 0.04, v: 1 },
        ];
      const gill = C('#f4ecd8').multiplyScalar(1.5);
      const shade = C('#6a5a44');
      lathe(this.gills, F, gp, seg, { flip: true, disc: R, wob: (th, k) => (k === 0 ? capWob(th, 0) : 1), color: (k) => (k <= 1 && stage === 'open' ? shade : gill) });
    }
    // raised scale flakes in concentric rings (fewer on small ones)
    if (stage !== 'bud' && lod > 0.45) {
      const nW = Math.round((H > 1 ? 110 : H > 0.4 ? 30 : 10) * (0.5 + 0.5 * lod) * this.detail * this.detail);
      for (let i = 0; i < nW; i++) {
        const t = 0.12 + Math.pow(rng.next(), 0.8) * 0.62; // rim … umbo edge
        const th = rng.range(0, TAU);
        const kf = t * (n - 1);
        const k0 = Math.min(n - 2, Math.floor(kf)), k1 = k0 + 1;
        const f = kf - k0;
        const rr = (prof[k0].r * (1 - f) + prof[k1].r * f) * capWob(th, k0);
        const yy = prof[k0].y * (1 - f) + prof[k1].y * f;
        const c = Math.cos(th), sn = Math.sin(th);
        const pp = F.o.clone().addScaledVector(F.x, c * rr).addScaledVector(F.z, sn * rr).addScaledVector(F.y, yy);
        const dr = prof[k1].r - prof[k0].r, dy = prof[k1].y - prof[k0].y;
        const l = Math.hypot(dr, dy) || 1;
        const nn = new THREE.Vector3().addScaledVector(F.x, c * (dy / l)).addScaledVector(F.z, sn * (dy / l)).addScaledVector(F.y, -dr / l).normalize();
        wart(this.warts, pp, nn, R * rng.range(0.025, 0.045) * (1.1 - t * 0.4), C(rng.chance(0.5) ? '#9a7450' : '#7e5a3a').multiplyScalar(rng.range(0.85, 1.1)), rng, 4);
      }
    }
    return { top, capR: R, capTop: top.y + (prof[n - 1].y) };
  }

  /** A fat porcini/bolete. opts: { height, capR, color, lean, leanAz } */
  bolete(x, y, z, opts = {}) {
    const rng = this.rng;
    const H = opts.height ?? 0.2;
    const R = opts.capR ?? H * 0.7;
    const seg = H > 0.3 ? 12 : H > 0.14 ? 10 : 8;
    const tilt = opts.lean !== undefined
      ? new THREE.Vector3(Math.sin(opts.leanAz ?? 0) * Math.sin(opts.lean), 1, Math.cos(opts.leanAz ?? 0) * Math.sin(opts.lean))
      : new THREE.Vector3(rng.jitter(0.15), 1, rng.jitter(0.15));
    const F0 = frameFor(new THREE.Vector3(x, y - H * 0.05, z), tilt);
    const stemCol = C('#e8dcc0');
    lathe(this.stems, F0, [
      { r: R * 0.42, y: 0, v: 0 },
      { r: R * 0.6, y: H * 0.3, v: 0.3 },
      { r: R * 0.48, y: H * 0.75, v: 0.75 },
      { r: R * 0.36, y: H, v: 1 },
    ], seg, { color: (k) => stemCol.clone().multiplyScalar(0.8 + k * 0.07) });
    const F = frameFor(F0.o.clone().addScaledVector(F0.y, H), F0.y);
    const col = C(opts.color ?? rng.pick(['#7a4a26', '#8a5a2e', '#6e4022', '#946234']));
    // (pores: lemon-cream in young ones, olive-ochre in old ones)
    const pore = C(opts.poreColor ?? '#d8c47a');
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
    ], seg, { flip: true, color: () => pore });
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

  /**
   * A fairy-ring bonnet (a glowing Mycena): a slender pale stem, a bell cap
   * that glows mint at night (pale mint-white by day) and mint gills under it.
   * Big enough to read as a mushroom, not a dot. opts: { height, capR, lean,
   * leanAz, halo (night halo sprite size factor, 0 = none) }
   */
  glowcap(x, y, z, opts = {}) {
    const rng = this.rng;
    const H = opts.height ?? 0.25;
    const R = opts.capR ?? H * rng.range(0.34, 0.42);
    const lean = opts.lean ?? rng.range(0.03, 0.2);
    const leanAz = opts.leanAz ?? rng.range(0, TAU);
    const base = new THREE.Vector3(x, y - 0.012, z);
    const tip = new THREE.Vector3(x + Math.sin(leanAz) * Math.sin(lean) * H, y + H, z + Math.cos(leanAz) * Math.sin(lean) * H);
    // stem: a gentle curve (two straight frames), widening at the foot
    const mid = base.clone().lerp(tip, 0.5).add(new THREE.Vector3(rng.jitter(0.02) * H, 0, rng.jitter(0.02) * H));
    const stemCol = C('#e4f0e6');
    for (const [a, b, r0, r1] of [[base, mid, R * 0.2, R * 0.13], [mid, tip, R * 0.13, R * 0.11]]) {
      const F0 = frameFor(a, b.clone().sub(a));
      lathe(this.stems, F0, [
        { r: r0, y: 0, v: 0 },
        { r: r1, y: a.distanceTo(b), v: 1 },
      ], 5, { color: () => stemCol });
    }
    // the bell: rim → shoulder → rounded apex with a small umbo
    const axis = tip.clone().sub(mid).normalize().lerp(UP, 0.5).normalize();
    const F = frameFor(tip, axis);
    const prof = [
      { r: R * 0.98, y: -R * 0.2, v: 0 },
      { r: R * 0.9, y: R * 0.18, v: 0.3 },
      { r: R * 0.66, y: R * 0.6, v: 0.6 },
      { r: R * 0.3, y: R * 0.9, v: 0.85 },
      { r: 0, y: R * 1.02, v: 1 },
    ];
    const seg = H > 0.2 ? 9 : 7;
    const ph = rng.range(0, TAU);
    lathe(this.glow, F, prof, seg, { wob: (th, k) => (k === 0 ? 1 + 0.06 * Math.sin(th * 4 + ph) : 1) });
    lathe(this.glowGills, F, [
      { r: R * 0.98, y: -R * 0.2, v: 0 },
      { r: R * 0.5, y: R * 0.12, v: 0.6 },
      { r: R * 0.12, y: R * 0.08, v: 1 },
    ], seg, { flip: true, disc: R, color: () => C('#e8fff4') });
    if (opts.halo !== 0) this.glowPoints.push({ x: tip.x, y: tip.y + R * 0.35, z: tip.z, size: R * (opts.halo ?? 2.4) });
    return { top: tip, capR: R };
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

  /** Drop the builders' vertex data (after build(); shared parts are released by their owner). */
  release() {
    this.caps.release();
    this.stems.release();
    if (this.shared) return;
    for (const B of [this.gills, this.warts, this.glow, this.glowGills, this.glowWarts, this.sheath]) B.release();
    this.glowPoints.length = 0;
  }

  /**
   * Emit the meshes (skips empty parts). A kit that shares another kit's
   * parts only emits its caps & stems (the owner emits the shared parts —
   * build the sharing kits FIRST, or their shared geometry is missed).
   */
  build(ctx, name, { cast = false, moon = false } = {}) {
    const M = ctx.materials;
    const out = [];
    const add = (B, mat, part, castIt = cast) => {
      if (!B.count) return;
      const m = staticMesh(`${name}-${part}`, B.build(), mat, { cast: castIt, receive: true });
      m.raycast = () => {};
      out.push(m);
    };
    // (a NEUTRAL cap texture: with the default red base every vertex-coloured
    //  cap — ochre, tan, golden, brown — would be dragged towards red)
    // (moon: the giants' domes catch a silver moon rim at night, so a cap
    //  reads as a mushroom above its glowing gills — not a dark void)
    const capMat = M.surface('mushroomCap', { vertexColors: true, color: '#a0a0a0' });
    add(this.caps, moon ? moonRim(capMat, { rim: 0.07, pow: 2.5, up: 0.65, side: 0.5 }) : capMat, 'caps');
    add(this.stems, M.surface('mushroomStem', { vertexColors: true }), 'stems');
    if (this.shared) return out;
    add(this.gills, M.surface('gills', { vertexColors: true }), 'gills', false);
    add(this.warts, moon ? mushroomGlowMaterials(ctx).wartsPlain : M.standard('#ffffff', { roughness: 0.9, vertexColors: true }), 'warts', false);
    if (this.sheath.count) {
      const m = staticMesh(`${name}-glow-sheath`, this.sheath.build(), glowSheathMaterial(), { cast: false, receive: false });
      m.renderOrder = 3;
      m.raycast = () => {};
      out.push(m);
    }
    add(this.glow, M.glow('#8ff5d6', { day: 0.12, night: 1.25 }), 'glowcaps', false);
    if (this.glowGills.count || this.glowWarts.count) {
      const G = mushroomGlowMaterials(ctx);
      add(this.glowGills, G.gills, 'glowgills', false);
      add(this.glowWarts, moon ? G.wartsMoon : G.warts, 'glowwarts', false);
    }
    return out;
  }
}
