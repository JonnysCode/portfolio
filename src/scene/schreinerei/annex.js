// ─────────────────────────────────────────────────────────────────────────────
// The workshop annex (SCHREINEREI.annex): a crooked half-timbered house
// leaning against the roots of the Great Oak.
//
// Gable front (facing the visitor), jettied upper gable with carved joist
// heads, fieldstone plinth, oak timber frame (sills, posts, rails, braces,
// St Andrew's crosses, pegs) with plaster infill, a steep crooked roof of
// real overlapping shingles (instanced), carved bargeboards, purlin ends on
// curved brackets, a hoist beam with a pulley, a shingled gable dormer (shake-
// clad cheeks, zinc flashing), a leaning fieldstone chimney with smoke, big
// multi-pane windows glowing warm and a wide open double door into the lit
// workshop (bench, tool wall, clamps, boards) — the plinth stops at the
// opening, an oak threshold lies flush with the floor (the yard's flagged
// apron outside, a couple of centimetres lower).
//
// Everything is built in ANNEX-LOCAL space (origin = annex centre on the
// ground, +Z = front) and passed through crook() — a gentle lean towards the
// oak, a sagging ridge and a twist — so nothing is ruler-straight. The roof
// adds a bell-cast kick at the eaves; every frame member has its own width,
// hewn chamfers and tone (sun-faded high up, darker and damp low down).
//
// Built into the roots: the oak's great root leaves the bole high up, arches
// over the right eave, lies across the verge and comes down as the porch's
// right post (braided with a younger twin) — paler and mossier than the old
// bole so it reads from the spot as the tree's arm round the house; a second
// lies across the right slope behind the dormer, over the ridge, its tip
// splaying on the far slope; another drapes over the eave further back, a
// fat buttress swallows the back corner, two low ones grip the plinth — moss
// shells on their backs (and down the upright flanks), moss curtains hanging
// from the arches, ivy climbing them and the roof, a moss blanket spilling
// over the ridge — and an ivy curtain falls from the oak over the right eave
// and verge. Weathering: algae streaks under the
// sills and in the splash zone, hairline cracks in the plaster along the
// timbers. Trenails are small riven oak pegs in dark rings, not bright dots.
// The windows show a lit room (one painted atlas): a warm gradient, brighter
// low in the middle, and silhouettes behind the glass.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries as mergeGeos } from 'three/addons/utils/BufferGeometryUtils.js';
import { SCHREINEREI } from '../../world/layout.js';
import { createRng } from '../../core/rng.js';
import {
  Batch, board, timber, uvBox, xf, deform, mat4, stoneGeo, mossGeo, tube, rbox,
  ShingleField, layShingles, shingleGeo, addIvy, addToadstool, addFern, pushHalo, noiseA, noiseB,
  addBowSaw, addFClamp, turned, doubleFace, FRAME_COLOR, mossPadGeo, segs, count, LOD,
} from './kit.js';
import { shavingGeo } from './fx.js';
import { rootGeo, rootBarkMaterial, mossCapGeo, mossVCMaterial, paintMoss, mossTone, stepStoneMaterial } from './door.js';
import { OAK, oakRadiusAt } from '../../world/layout.js';
import { makeChimneySmoke } from '../../props/smoke.js';
import { requestBake } from '../../core/textures/bakery.js';

const A = SCHREINEREI.annex;
/** Annex dimensions & key heights (annex-local). */
export const ANNEX = {
  hx: A.width / 2, // 2.8
  hz: A.depth / 2, // 2.2
  plinth: 0.42,
  sillTop: 0.58,
  plateBottom: 2.3,
  eave: 2.46, // top of the side walls' top plate (rafter foot)
  pitch: Math.tan((52 * Math.PI) / 180),
  jetty: 0.22, // the front gable overhangs the ground floor
  gableSill: [2.62, 2.78],
  overhangSide: 0.45,
  overhangFront: 0.5,
  overhangBack: 0.3,
  floor: 0.06, // interior floor
  door: { s0: 1.62, s1: 3.42, top: 2.12 }, // front double door (wall coords s = x + hx)
  porchRoof: { x0: 0.92, x1: 2.75, depth: 1.62, hi: 2.36, lo: 1.98 },
  /** Where the great oak root comes down as the porch's right post (its foot). */
  rootPost: { x: 2.93, z: 3.86 },
};
ANNEX.ridge = ANNEX.eave + ANNEX.hx * ANNEX.pitch; // underside of the rafters at the ridge

/** The annex frame (local → world) matrix. */
export const annexMatrix = mat4([A.x, 0, A.z], [0, A.rotY, 0]);

/** Gentle crookedness applied to every annex vertex (local space, in place). */
export function crook(v) {
  const y = v.y;
  // lean towards the oak (+x) and a touch forward, growing with height
  v.x += y * 0.028 + y * y * 0.002;
  v.z += y * 0.008;
  // the ridge sags in the middle of its length (an old roof: ~0.22), and each
  // slope bellies between eave and ridge, so no roof line stays ruler-flat
  const roofK = THREE.MathUtils.smoothstep(y, ANNEX.eave, ANNEX.ridge + 0.4);
  const zn = (v.z + ANNEX.hz + ANNEX.overhangBack) / (A.depth + ANNEX.overhangBack + ANNEX.overhangFront);
  const ysl = THREE.MathUtils.clamp((y - ANNEX.eave) / (ANNEX.ridge - ANNEX.eave), 0, 1);
  v.y -= Math.sin(Math.PI * THREE.MathUtils.clamp(zn, 0, 1)) * (0.22 * roofK + 0.07 * Math.sin(Math.PI * ysl));
  // a slight twist of the upper storey
  const tw = y * 0.006;
  const x = v.x, z = v.z;
  v.x = x * Math.cos(tw) - z * Math.sin(tw);
  v.z = x * Math.sin(tw) + z * Math.cos(tw);
  return v;
}

// ─── the frame: one vertex-coloured timber, a tone per member ───────────────
let frameVC = null;
let FRAME = null; // frameMat(ctx), set by buildAnnex
let PLASTER = null; // annexPlaster(ctx), set by buildAnnex
/**
 * The Riegel frame material as a proxy: geometry painted with paintMember()
 * keeps its own tones, anything else gets the plain ox-blood frame colour.
 * (Annex AND porch: one draw call.)
 */
export function frameMat(ctx) {
  frameVC ??= ctx.materials.surface('timber', { vertexColors: true });
  return { isProxy: true, material: frameVC, color: FRAME_COLOR };
}
const _fc = new THREE.Color(), _fa = new THREE.Color(), _fb = new THREE.Color();
const FADED = new THREE.Color('#9b7563'); // sun-bleached high up
const DAMP = new THREE.Color('#4f2a1e'); // damp, darker near the sill
/**
 * Paint a frame member (annex-local geometry): its own tone (±10 %, a touch
 * of hue drift), sun-faded towards the gable and the eaves, darker and damp
 * near the plinth, with soft streaks along it.
 */
export function paintMember(geo, rng, base = FRAME_COLOR) {
  // (each member its own log: a clear step in tone and a little hue drift)
  _fa.set(base).multiplyScalar(rng.range(0.8, 1.17));
  _fa.offsetHSL(rng.jitter(0.02), rng.jitter(0.08), rng.jitter(0.015));
  const ox = rng.next() * 40;
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    _fc.copy(_fa);
    const fade = THREE.MathUtils.smoothstep(y, 2.2, 4.6) * 0.38 + Math.max(0, noiseA(x * 1.7 + ox, y * 0.9) * 0.12);
    _fc.lerp(_fb.copy(FADED), fade);
    const damp = (1 - THREE.MathUtils.smoothstep(y, 0.45, 1.0)) * 0.45;
    _fc.lerp(_fb.copy(DAMP), damp);
    _fc.multiplyScalar(1 + noiseB(x * 3.1 + z * 3.1 + ox, y * 0.6) * 0.07);
    col[i * 3] = _fc.r;
    col[i * 3 + 1] = _fc.g;
    col[i * 3 + 2] = _fc.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/**
 * A shake with its two long side faces dropped (the face, the butt and the
 * hidden top edge stay): neighbours in a course hide those 2 cm sides anyway,
 * and with ~2.9k shakes on the roofs it saves a third of their triangles.
 * (medium & low already build them so.)
 */
function faceAndButt(g) {
  const nor = g.attributes.normal, idx = g.index.array;
  const keep = [];
  for (let i = 0; i < idx.length; i += 3) {
    const n = Math.abs(nor.getX(idx[i])) + Math.abs(nor.getX(idx[i + 1])) + Math.abs(nor.getX(idx[i + 2]));
    if (n < 2.1) keep.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  g.setIndex(keep);
  return g;
}

const DORM_SILVER = new THREE.Color(0.8, 0.79, 0.76);

/**
 * Size of a shake (and its course spacing) relative to the 20 cm standard:
 * on the low tier the roofs are laid in larger shakes — half as many
 * instances, the same look at phone size.
 */
export const shakeScale = () => (LOD.tier === 'low' ? 1.35 : 1);

/** Bell-cast eaves: the roof flattens out (kicks up) beyond the side walls (annex-local, in place). */
export function eaveKick(v) {
  const ax = Math.abs(v.x);
  if (v.y > 1.6 && ax > ANNEX.hx - 0.15) v.y += 0.3 * (ax - ANNEX.hx + 0.15) ** 2;
  return v;
}

// ─── the windows: a painted lit room behind the glass (one atlas) ────────────
/** Atlas cells (u0, v0, u1, v1) of the window glimpse. */
const WIN = { workshop: [0, 0.5, 0.5, 1], sill: [0.5, 0.5, 1, 1], curtainL: [0, 0, 0.5, 0.5], shelves: [0.5, 0, 1, 0.5] };
let winMat = null;
function windowMaterial() {
  if (winMat) return winMat;
  const S = 512, H = S / 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  // each cell: warm room light, brightest low in the middle, darker towards the frame
  const room = (x0, y0) => {
    const gr = g.createRadialGradient(x0 + H * 0.5, y0 + H * 0.66, H * 0.04, x0 + H * 0.5, y0 + H * 0.55, H * 0.78);
    gr.addColorStop(0, '#fff3cf');
    gr.addColorStop(0.32, '#ffd18a');
    gr.addColorStop(0.68, '#e08a3c');
    gr.addColorStop(1, '#7a3a18');
    g.fillStyle = gr;
    g.fillRect(x0, y0, H, H);
  };
  const ink = 'rgba(78,36,14,0.66)';
  const inkSoft = 'rgba(90,42,16,0.45)';
  // workshop (top-left): saws and planes hanging on the wall, a lamp
  room(0, 0);
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.lineWidth = 5;
  // frame saw
  g.beginPath();
  g.moveTo(30, 40); g.quadraticCurveTo(22, 90, 34, 150);
  g.moveTo(100, 40); g.quadraticCurveTo(110, 90, 98, 150);
  g.moveTo(28, 95); g.lineTo(104, 95);
  g.stroke();
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(32, 140); g.lineTo(100, 140); g.stroke();
  // two hand saws
  for (const [x, l] of [[140, 110], [178, 92]]) {
    g.beginPath();
    g.moveTo(x, 30); g.lineTo(x + 26, 30); g.lineTo(x + 16, 30 + l); g.lineTo(x + 4, 30 + l);
    g.closePath(); g.fill();
    g.fillRect(x - 2, 18, 30, 16);
  }
  // shelf of planes
  g.fillRect(14, 176, 228, 7);
  for (let i = 0; i < 5; i++) {
    const x = 22 + i * 44, w = [34, 26, 40, 22, 30][i];
    g.fillRect(x, 160, w, 16);
    g.fillRect(x + w * 0.62, 150, 6, 12);
  }
  // pendant lamp glow
  {
    const lg = g.createRadialGradient(205, 70, 2, 205, 70, 46);
    lg.addColorStop(0, 'rgba(255,255,240,1)');
    lg.addColorStop(0.5, 'rgba(255,226,160,0.45)');
    lg.addColorStop(1, 'rgba(255,210,140,0)');
    g.fillStyle = lg;
    g.fillRect(150, 20, 110, 110);
    g.fillStyle = ink;
    g.fillRect(203, 0, 3, 56);
  }
  // sill (top-right): a potted plant low on the sill, a curtain edge right
  room(H, 0);
  g.fillStyle = ink;
  g.beginPath();
  g.moveTo(H + 34, 236); g.lineTo(H + 84, 236); g.lineTo(H + 78, 200); g.lineTo(H + 40, 200); g.closePath(); g.fill();
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (i - 4) * 0.32, l = 34 + (i % 3) * 12;
    g.beginPath();
    g.ellipse(H + 59 + Math.cos(a) * l * 0.7, 196 + Math.sin(a) * l * 0.8, 11, 6, a, 0, Math.PI * 2);
    g.fill();
  }
  {
    const cg = g.createLinearGradient(H + 190, 0, H + 256, 0);
    cg.addColorStop(0, 'rgba(110,52,22,0)');
    cg.addColorStop(0.35, 'rgba(110,52,22,0.55)');
    cg.addColorStop(1, 'rgba(80,36,14,0.85)');
    g.fillStyle = cg;
    g.beginPath();
    g.moveTo(H + 256, 0); g.lineTo(H + 200, 0);
    g.bezierCurveTo(H + 214, 80, H + 196, 170, H + 226, 256); g.lineTo(H + 256, 256); g.closePath(); g.fill();
  }
  // curtain (bottom-left): a gathered curtain on the left, a little lamp
  room(0, H);
  {
    const cg = g.createLinearGradient(0, 0, 80, 0);
    cg.addColorStop(0, 'rgba(80,36,14,0.88)');
    cg.addColorStop(0.65, 'rgba(110,52,22,0.55)');
    cg.addColorStop(1, 'rgba(110,52,22,0)');
    g.fillStyle = cg;
    g.beginPath();
    g.moveTo(0, H); g.lineTo(70, H);
    g.bezierCurveTo(52, H + 90, 74, H + 150, 40, H + 256); g.lineTo(0, H + 256); g.closePath(); g.fill();
    g.fillStyle = inkSoft;
    for (let k = 0; k < 4; k++) g.fillRect(10 + k * 14, H, 3, 200 - k * 30);
    g.fillStyle = ink;
    g.fillRect(150, H + 196, 60, 6);
    g.fillRect(172, H + 160, 16, 36);
    const lg = g.createRadialGradient(180, H + 150, 2, 180, H + 150, 40);
    lg.addColorStop(0, 'rgba(255,250,225,0.95)');
    lg.addColorStop(1, 'rgba(255,215,150,0)');
    g.fillStyle = lg;
    g.fillRect(130, H + 100, 100, 100);
  }
  // shelves (bottom-right): jars, a coat on a peg
  room(H, H);
  g.fillStyle = ink;
  g.fillRect(H + 20, H + 120, 140, 6);
  g.fillRect(H + 20, H + 186, 140, 6);
  for (let i = 0; i < 6; i++) {
    g.fillRect(H + 28 + i * 21, H + 98 + (i % 2) * 6, 14, 22 - (i % 2) * 6);
    g.fillRect(H + 30 + i * 21, H + 162, 15, 24);
  }
  g.beginPath();
  g.moveTo(H + 196, H + 40); g.lineTo(H + 228, H + 60); g.lineTo(H + 236, H + 190); g.lineTo(H + 186, H + 190); g.lineTo(H + 182, H + 60); g.closePath(); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  winMat = new THREE.MeshStandardMaterial({ color: '#2a1c12', emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.5, roughness: 0.4, name: 'annex-window-glimpse' });
  return winMat;
}
/** Window glow by day / at night (the big panes stay below the bloom's blow-out). */
const WIN_DAY = 0.5, WIN_NIGHT = 1.15;

// ─── the annex's own plaster & shakes (re-baked clones of the shared surfaces) ─
/**
 * Exterior lime plaster for the Riegel infill: the plaster surface material
 * re-pointed at its own bake — soft cloudy coats of warm off-white with a
 * greyer weathered mottle, trowel laps kept below ~3 % contrast (no crazy
 * paving), a rare soft hairline crack and NO fallen-off patches (those read
 * as black holes at this scale; the one spalled patch is modelled, showing
 * its wattle). Same shader program as the plaster: no extra compile.
 */
const ANNEX_PLASTER_GLSL = /* glsl */ `
Surf kind_annexPlaster(vec2 uv) {
  float m1 = fbmu(uv, 3.0, 5);
  float m2 = fbmu(uv + vec2(0.31), 8.0, 4);
  float m3 = fbmu(uv + vec2(0.71, 0.53), 16.0, 3);
  vec3 col = C(0xede1c6);
  col = mix(col, C(0xe2d0ab), sat(m1 * 0.9 + 0.15) * 0.7);
  col = mix(col, C(0xf5efe0), sat(-m2 * 1.1) * 0.7);
  col = mix(col, C(0xd9cfb5), sat(m1 - 0.35) * 0.55);
  col = mix(col, C(0xe8ddc4), sat(m3 * 1.2) * 0.3);
  vec2 w = vec2(fbmu(uv, 4.0, 2), fbmu(uv + vec2(0.5), 4.0, 2)) * 0.07;
  vec4 tv = voronoi((uv + w) * 3.0, vec2(3.0), 1.0);
  float lap = 1.0 - smoothstep(0.0, 0.09, tv.y);
  float sweep = gnoise(rot2(uv * 3.0 - floor(uv * 3.0), tv.z * 6.28) * vec2(2.0, 24.0), vec2(1000.0));
  col *= 1.0 - 0.022 * lap + 0.01 * sweep;
  float h = 0.62 + 0.035 * m1 + 0.012 * lap + 0.006 * sweep + 0.006 * gnoise(uv * 160.0, vec2(160.0)) + 0.008 * m3;
  vec4 cv = voronoi((uv + w * 0.6) * 4.0 + vec2(2.0), vec2(4.0), 1.0);
  float crackMask = smoothstep(0.32, 0.5, fbmu(uv + vec2(0.7), 3.0, 3));
  float crack = (1.0 - smoothstep(0.0, 0.009, cv.y + 0.008 * gnoise(uv * 80.0, vec2(80.0)))) * crackMask;
  col = mix(col, C(0xb4a78d), crack * 0.3);
  h -= crack * 0.03;
  float ao = mix(0.8, 1.0, smoothstep(0.55, 0.64, h));
  return surf(col, h, 0.95, ao);
}`;
let annexPlasterMat = null;
export function annexPlaster(ctx) {
  if (annexPlasterMat) return annexPlasterMat;
  const c = ctx.materials.surface('plaster', { color: '#e8dbc0' }).clone();
  c.name = 'annex-plaster';
  const u = ctx.materials.surfaceUniforms?.(c);
  const maps = requestBake('surface:annex-plaster', {
    glslKey: 'annex-plaster', glsl: ANNEX_PLASTER_GLSL, fn: 'kind_annexPlaster',
    mode: 'rgb', size: [512, 512], bump: 0.005, cavity: 1.4, mean: '#ede1c6', seed: 0,
  });
  if (u?.sfMap && u?.sfDetail) {
    u.sfMap.value = maps.map;
    u.sfDetail.value = maps.detail;
    u.sfP.value.w *= 0.6; // calmer painterly breakup: the bake carries the mottling
  }
  annexPlasterMat = c;
  return c;
}
/**
 * Riven shakes: the shingles' world-mapped timber re-pointed at a bake with
 * the grain, silvering and stains but no long drying checks — a check that
 * runs on across a dozen shakes reads as a crack painted over the roof.
 */
const ANNEX_SHAKE_GLSL = /* glsl */ `
Surf kind_annexShake(vec2 uv) {
  vec2 q = uv + vec2(0.0, 0.025 * fbmu(uv, vec2(2.0, 4.0), 3));
  float streak = gnoise(vec2(q.x * 3.0, q.y * 50.0), vec2(3.0, 50.0));
  float streak2 = gnoise(vec2(q.x * 8.0, q.y * 150.0), vec2(8.0, 150.0));
  float rings = sin((q.y * 14.0 + 1.6 * fbmu(q, vec2(2.0, 3.0), 3)) * 6.2831853);
  float silver = sat(fbmu(uv + vec2(0.2), vec2(3.0, 5.0), 4) * 1.4 + 0.15);
  vec3 col = mix(C(0x6e5440), C(0x8a6c50), sat(rings * 0.35 + 0.5 + streak * 0.35));
  col = mix(col, mix(C(0x8e877c), C(0xa49b8c), sat(streak2 + 0.5)), silver * 0.7);
  col *= 0.9 + 0.12 * streak2;
  float stain = sat(fbmu(uv + vec2(0.8), vec2(6.0, 2.0), 3) * 1.6 - 0.6);
  col = mix(col, C(0x4a3828), stain * 0.35);
  float h = 0.62 + 0.05 * streak + 0.045 * streak2 + 0.03 * rings;
  return surf(col, h, 0.88 + 0.06 * silver, 1.0);
}`;
let annexShakeMat = null;
export function annexShakes(ctx) {
  if (annexShakeMat) return annexShakeMat;
  const c = ctx.materials.surface('timber', { triplanar: true, color: '#6f5949' }).clone();
  c.name = 'annex-shakes';
  const u = ctx.materials.surfaceUniforms?.(c);
  const maps = requestBake('surface:annex-shakes', {
    glslKey: 'annex-shakes', glsl: ANNEX_SHAKE_GLSL, fn: 'kind_annexShake',
    mode: 'rgb', size: [256, 256], bump: 0.012, cavity: 1.6, mean: '#755d48', seed: 0,
  });
  if (u?.sfMap && u?.sfDetail) {
    u.sfMap.value = maps.map;
    u.sfDetail.value = maps.detail;
  }
  annexShakeMat = c;
  return c;
}

/**
 * Shakes laid in courses on a plane (as kit layShingles), each instance
 * scaled by `size` [w, l] relative to the 20 × 34 cm shake: overlapping,
 * staggered rows, every shake its own nudge, tilt, width and tone — the
 * dormer's roof and cheeks are laid like the main roof, not as a pattern.
 */
function layShakes(field, { origin, alongDir, upDir, normal, length, height, w, exposure, size = [1, 1], rng, skip = null, tint = null, transform = null, lift = 0.012 }) {
  const m = new THREE.Matrix4(), rot = new THREE.Matrix4(), sc = new THREE.Matrix4();
  const basis = new THREE.Matrix4().makeBasis(alongDir, upDir, normal);
  const p = new THREE.Vector3(), col = new THREE.Color(), e = new THREE.Euler();
  const rows = Math.ceil(height / exposure);
  for (let r = 0; r < rows; r++) {
    const v = r * exposure + rng.jitter(exposure * 0.08);
    const off = (r % 2) * w * 0.5 + rng.jitter(w * 0.18);
    const n = Math.ceil(length / w) + 1;
    for (let k = 0; k < n; k++) {
      const u = -w * 0.5 + k * w + off + rng.jitter(w * 0.08);
      if (u < -w * 0.3 || u > length + w * 0.3) continue;
      if (skip && skip(u, v)) continue;
      p.copy(origin).addScaledVector(alongDir, u).addScaledVector(upDir, v).addScaledVector(normal, lift + (r % 2) * 0.004);
      if (transform) transform(p);
      rot.makeRotationFromEuler(e.set(-0.08 + rng.jitter(0.035), rng.jitter(0.03), rng.jitter(0.08)));
      sc.makeScale(size[0] * rng.range(0.82, 1.12), size[1] * rng.range(0.9, 1.08), 1);
      m.copy(basis).multiply(rot).multiply(sc).setPosition(p);
      const g = rng.range(0.74, 1.08);
      col.setRGB(g, g * rng.range(0.94, 1.0), g * rng.range(0.86, 0.98));
      const k2 = rng.next();
      if (k2 < 0.14) col.multiplyScalar(0.74);
      else if (k2 < 0.28) col.lerp(DORM_SILVER, 0.45);
      if (tint) tint(u, v, col, p);
      field.push(m, col);
    }
  }
}

/** Clean, bright steel (saw plates, squares, chisels, the band saw's table): no rust. */
function brightSteel(ctx, color = '#d4dade') {
  return { isProxy: true, material: ctx.materials.standard('#ffffff', { metalness: 0.6, roughness: 0.3, vertexColors: true }), color };
}

/**
 * A western hand saw (as kit addHandSaw) with a clean, bright plate and a
 * brass medallion — a Schreiner keeps his saws bright.
 */
function cleanHandSaw(F, mats, steel, m, { len = 0.5, wood = '#5c4334' } = {}) {
  const s = new THREE.Shape();
  const nT = Math.round(len / 0.016);
  s.moveTo(0, 0.06);
  s.lineTo(len, 0.0);
  s.lineTo(len, -0.05);
  for (let i = nT; i >= 0; i--) s.lineTo((i / nT) * len, -0.06 + (i % 2 ? 0 : -0.008));
  s.lineTo(0, 0.06);
  const blade = new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: false });
  blade.translate(0, 0, -0.0015);
  F.add(steel, blade.applyMatrix4(m), { cast: false });
  const h = new THREE.Shape();
  h.moveTo(0.03, 0.075);
  h.bezierCurveTo(-0.02, 0.11, -0.1, 0.11, -0.125, 0.06);
  h.bezierCurveTo(-0.15, 0.0, -0.14, -0.07, -0.1, -0.09);
  h.bezierCurveTo(-0.05, -0.105, 0.0, -0.08, 0.03, -0.055);
  h.lineTo(0.03, 0.075);
  const hole = new THREE.Path();
  hole.moveTo(-0.025, 0.04);
  hole.bezierCurveTo(-0.06, 0.06, -0.1, 0.045, -0.1, 0.0);
  hole.bezierCurveTo(-0.1, -0.045, -0.06, -0.06, -0.035, -0.045);
  hole.bezierCurveTo(-0.015, -0.03, -0.015, 0.025, -0.025, 0.04);
  h.holes.push(hole);
  const hg = new THREE.ExtrudeGeometry(h, { depth: 0.022, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1, curveSegments: 5 });
  hg.translate(0, 0, -0.011);
  F.add(mats.wood(wood), uvBox(hg, 'x').applyMatrix4(m), { cast: false });
  for (const [x, y] of [[0.0, 0.035], [0.005, -0.03]]) F.add(mats.metal('#c9a04a'), new THREE.CylinderGeometry(0.008, 0.008, 0.03, 8).rotateX(Math.PI / 2).translate(x, y, 0).applyMatrix4(m), { cast: false });
}

/** A Batch frame that crooks and places annex-local geometry. */
export function annexFrame(B) {
  const M = annexMatrix;
  return {
    add(material, geo, opts = {}) {
      if (opts.matrix) {
        geo.applyMatrix4(opts.matrix);
        opts = { ...opts, matrix: null };
      }
      deform(geo, crook, true);
      geo.applyMatrix4(M);
      return B.add(material, geo, opts);
    },
  };
}

/** Annex-local point → world (with crook). */
export function annexToWorld(x, y, z, target = new THREE.Vector3()) {
  target.set(x, y, z);
  crook(target);
  return target.applyMatrix4(annexMatrix);
}

// ─── soft decals (one atlas, one material, one draw call) ────────────────────
// Sawdust drifts, algae / rain streaks, hairline plaster cracks and speck
// clouds: soft-edged alpha quads tinted by vertex colour, merged per Batch
// into ONE transparent mesh for the whole Schreinerei.
let decalMat = null;
/** Atlas cells (u0, v0, u1, v1). */
export const DECAL = {
  blob: [0, 0.5, 0.5, 1], // soft lumpy blob (sawdust drift)
  streak: [0.5, 0.5, 1, 1], // vertical drips fading downwards (top of the quad = source)
  crack: [0, 0, 0.5, 0.5], // a hairline crack along the quad's width
  specks: [0.5, 0, 1, 0.5], // a scatter of specks (dust in joints)
};
export function decalMaterial() {
  if (decalMat) return decalMat;
  const S = 512, H = S / 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = createRng('decal-atlas');
  g.clearRect(0, 0, S, S);
  // blob (top-left in canvas = v 0.5..1): overlapping soft dabs
  for (let i = 0; i < 70; i++) {
    const a = r.next() * Math.PI * 2, d = Math.sqrt(r.next()) * H * 0.3;
    const x = H / 2 + Math.cos(a) * d, y = H / 2 + Math.sin(a) * d * 0.8;
    const rr = H * (0.06 + r.next() * 0.12);
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,0.22)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  for (let i = 0; i < 240; i++) {
    const a = r.next() * Math.PI * 2, d = Math.pow(r.next(), 0.7) * H * 0.42;
    g.fillStyle = `rgba(255,255,255,${0.25 + r.next() * 0.5})`;
    g.fillRect(H / 2 + Math.cos(a) * d, H / 2 + Math.sin(a) * d * 0.8, 1 + r.next() * 2, 1 + r.next() * 2);
  }
  // streaks (top-right): drips from the top edge fading down, uneven widths
  for (let i = 0; i < 14; i++) {
    const x = H + 10 + r.next() * (H - 20), w = 3 + r.next() * 12, len = H * (0.35 + r.next() * 0.6);
    const gr = g.createLinearGradient(0, 0, 0, len);
    const a0 = 0.35 + r.next() * 0.35;
    gr.addColorStop(0, `rgba(255,255,255,${a0})`);
    gr.addColorStop(0.5, `rgba(255,255,255,${a0 * 0.45})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x - w / 2, 0);
    g.quadraticCurveTo(x - w * 0.3 + (r.next() - 0.5) * 6, len * 0.6, x + (r.next() - 0.5) * 4, len);
    g.quadraticCurveTo(x + w * 0.3, len * 0.6, x + w / 2, 0);
    g.fill();
  }
  {
    const gr = g.createLinearGradient(0, 0, 0, H * 0.4);
    gr.addColorStop(0, 'rgba(255,255,255,0.3)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(H, 0, H, H * 0.4);
  }
  // crack (bottom-left): a jagged hairline with a branch or two
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineCap = 'round';
  for (let k = 0; k < 2; k++) {
    g.lineWidth = k ? 1.2 : 2;
    g.beginPath();
    let x = 6, y = H + H / 2 + (k ? 18 : 0);
    g.moveTo(x, y);
    while (x < H - 6) {
      x += 6 + r.next() * 14;
      y += (r.next() - 0.5) * 14;
      y = Math.max(H + 20, Math.min(S - 20, y));
      g.lineTo(x, y);
      if (r.next() < 0.12) {
        g.moveTo(x, y);
        g.lineTo(x + 10 + r.next() * 20, y + (r.next() - 0.5) * 40);
        g.moveTo(x, y);
      }
    }
    g.stroke();
    if (!k) g.globalAlpha = 0.5;
  }
  g.globalAlpha = 1;
  // specks (bottom-right)
  for (let i = 0; i < 420; i++) {
    const a = r.next() * Math.PI * 2, d = Math.pow(r.next(), 0.6) * H * 0.46;
    g.fillStyle = `rgba(255,255,255,${0.3 + r.next() * 0.6})`;
    const s = 1 + r.next() * 2.5;
    g.fillRect(H + H / 2 + Math.cos(a) * d, H + H / 2 + Math.sin(a) * d, s, s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  decalMat = new THREE.MeshStandardMaterial({
    map: tex,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    name: 'schreinerei-decals',
  });
  return decalMat;
}

/**
 * A decal quad (w × h) in its XY plane facing +Z, UVs into `cell` of the atlas.
 * Lay it on a floor with rotateX(−π/2). `segs` subdivides it (to drape).
 */
export function decalGeo(w, h, cell = DECAL.blob, segs = 1) {
  const g = new THREE.PlaneGeometry(w, h, segs, segs);
  const uv = g.attributes.uv;
  const [u0, v0, u1, v1] = cell;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

/**
 * A wall in its own 2D coordinates: s along the wall from `origin` in `sDir`,
 * y up, n outwards (n = 0 is the outer timber face).
 */
function makeWall(F, mats, rng, origin, sDir, normal) {
  const O = new THREE.Vector3(...origin);
  const S = new THREE.Vector3(...sDir);
  const N = new THREE.Vector3(...normal);
  const p = (s, y, n = 0) => [O.x + S.x * s + N.x * n, y, O.z + S.z * s + N.z * n];
  const basis = new THREE.Matrix4().makeBasis(S, new THREE.Vector3(0, 1, 0), N);
  const oak = FRAME;
  return {
    p,
    /**
     * A timber from (s0,y0) to (s1,y1) with face width fw, depth d (outer face
     * flush at n=0). Hand-hewn: each member a little wider or narrower, a
     * little crooked, with broad chamfers on its arrises and its own tone.
     */
    timber(s0, y0, s1, y1, fw = 0.16, d = 0.16, opts = {}) {
      const fwj = fw * rng.range(0.88, 1.1), dj = d * rng.range(0.94, 1.04);
      const g = timber(p(s0, y0, -dj / 2 + (opts.proud ?? 0)), p(s1, y1, -dj / 2 + (opts.proud ?? 0)), fwj, dj, { rng, up: normal, wobble: opts.wobble ?? 0.018, r: 0.028 });
      F.add(opts.mat ?? oak, opts.mat ? g : paintMember(g, rng));
    },
    /**
     * A trenail (Holznagel) at (s, y): a riven oak peg ≈ 4 cm across, left
     * unpainted when the frame was oiled — its pale oak end grain reads
     * clearly against the ox-blood — a touch proud, a little oval and
     * off-centre, in a thin dark ring where it was driven into its hole.
     */
    peg(s, y) {
      const r = rng.range(0.019, 0.022);
      const n = segs(10, 6);
      const sq = [1 + rng.jitter(0.08), 1 + rng.jitter(0.08)];
      // (only its end grain and a short stub of its side ever show: an open tube + one cap)
      const g = mergeGeos([new THREE.CylinderGeometry(r, r * 1.04, 0.034, n, 1, true), new THREE.CircleGeometry(r, n).rotateX(-Math.PI / 2).translate(0, 0.017, 0)]).rotateX(Math.PI / 2).scale(sq[0], sq[1], 1).rotateZ(rng.next() * 3);
      uvBox(g, 'z');
      g.applyMatrix4(basis);
      const q = p(s + rng.jitter(0.006), y + rng.jitter(0.006), -0.0095 + rng.range(0, 0.003));
      g.translate(q[0], q[1], q[2]);
      F.add(mats.wood(rng.pick(['#b48c5c', '#a98456', '#bf9866', '#b08a62'])), g, { cast: false });
      if (LOD.tier !== 'low') {
        const ring = new THREE.RingGeometry(r * 0.95, r * 1.3, n, 1).scale(sq[0], sq[1], 1).translate(0, 0, 0.01);
        ring.applyMatrix4(basis);
        const qr = p(s, y, -0.0088);
        ring.translate(qr[0] + (q[0] - qr[0]) * 0.6, qr[1] + (q[1] - qr[1]) * 0.6, qr[2]);
        F.add(mats.wood('#3d2519'), ring, { cast: false });
      }
    },
    /** Two trenails side by side across a joint, `a` the direction from one to the other. */
    pegPair(s, y, a = 0) {
      const dx = Math.cos(a) * 0.033, dy = Math.sin(a) * 0.033;
      this.peg(s - dx, y - dy);
      this.peg(s + dx, y + dy);
    },
    /** Plaster infill: outline [[s,y]…] with holes [[[s,y]…]…], recessed behind the timbers. */
    plaster(outline, holes = [], { depth = 0.12, recess = 0.022 } = {}) {
      const shape = new THREE.Shape(outline.map(([s, y]) => new THREE.Vector2(s, y)));
      for (const h of holes) shape.holes.push(new THREE.Path(h.map(([s, y]) => new THREE.Vector2(s, y))));
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
      uvBox(g, 'x', 1 / 2.2, [rng.next() * 5, rng.next() * 5]);
      g.translate(0, 0, -depth - recess);
      g.applyMatrix4(basis);
      g.translate(O.x, O.y, O.z);
      F.add(PLASTER ?? mats.plaster(), g);
    },
    /** Arbitrary geometry built in wall space (x = s, y, z = n). */
    add(material, g, opts) {
      g.applyMatrix4(basis);
      g.translate(O.x, O.y, O.z);
      F.add(material, g, opts);
    },
    basis,
  };
}

/** A board with a scalloped lower edge, centred on the origin along X (extruded along Z). */
function scallopBoard(len, h, d, rng) {
  const sh = new THREE.Shape();
  const n = Math.max(2, Math.round(len / 0.17));
  sh.moveTo(-len / 2, h / 2);
  sh.lineTo(len / 2, h / 2);
  sh.lineTo(len / 2, -h * 0.1);
  for (let i = n; i > 0; i--) {
    const u0 = -len / 2 + (i / n) * len, u1 = -len / 2 + ((i - 1) / n) * len;
    const um = (u0 + u1) / 2;
    sh.quadraticCurveTo(um, -h / 2 - h * 0.35, u1, -h * 0.1);
  }
  sh.lineTo(-len / 2, h / 2);
  const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -d / 2);
  return uvBox(g, 'x', undefined, [rng.next() * 5, rng.next() * 5]);
}

/** Orient a geometry built along +X (centred) from a to b, its +Y towards `up`. */
function alongXUp(g, a, b, up) {
  const X = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  const Y = new THREE.Vector3(...up);
  const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  Y.crossVectors(Z, X).normalize();
  const m = new THREE.Matrix4().makeBasis(X, Y, Z);
  m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g.applyMatrix4(m);
}

/** Multi-pane window into an opening (wall space). */
function addWindow(wall, mats, rng, s0, y0, s1, y1, { cols = 3, rows = 3, cell = WIN.shelves, mirror = false, sill = true, box = false, shutters = false, shutterColor = '#3f6b4a' } = {}) {
  const fw = 0.055;
  const frameMat = mats.wood('oak');
  const w = s1 - s0, h = y1 - y0;
  // frame
  wall.add(frameMat, xf(board(w, fw, 0.07, { along: 'x', rng }), [(s0 + s1) / 2, y0 + fw / 2, -0.07]));
  wall.add(frameMat, xf(board(w, fw, 0.07, { along: 'x', rng }), [(s0 + s1) / 2, y1 - fw / 2, -0.07]));
  wall.add(frameMat, xf(board(fw, h, 0.07, { along: 'y', rng }), [s0 + fw / 2, (y0 + y1) / 2, -0.07]));
  wall.add(frameMat, xf(board(fw, h, 0.07, { along: 'y', rng }), [s1 - fw / 2, (y0 + y1) / 2, -0.07]));
  // muntins
  const iw = w - fw * 2, ih = h - fw * 2;
  for (let c = 1; c < cols; c++) wall.add(frameMat, xf(board(0.026, ih, 0.035, { along: 'y', rng, r: 0.006 }), [s0 + fw + (iw * c) / cols, (y0 + y1) / 2, -0.075]), { cast: false });
  for (let r = 1; r < rows; r++) wall.add(frameMat, xf(board(iw, 0.026, 0.035, { along: 'x', rng, r: 0.006 }), [(s0 + s1) / 2, y0 + fw + (ih * r) / rows, -0.075]), { cast: false });
  // glass panes: together they show one painted room (the atlas cell spans
  // the whole window, so a silhouette continues behind the muntins)
  const wm = windowMaterial();
  const [cu0, cv0, cu1, cv1] = cell;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const pw = iw / cols, ph = ih / rows;
      const g = new THREE.PlaneGeometry(pw - 0.004, ph - 0.004);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        let u = (c + uv.getX(i)) / cols;
        if (mirror) u = 1 - u;
        const v = (r + uv.getY(i)) / rows;
        uv.setXY(i, cu0 + 0.01 + u * (cu1 - cu0 - 0.02), cv0 + 0.01 + v * (cv1 - cv0 - 0.02));
      }
      wall.add(wm, xf(g, [s0 + fw + pw * (c + 0.5), y0 + fw + ph * (r + 0.5), -0.09]), { cast: false, receive: false });
    }
  }
  if (sill) {
    const sb = board(w + 0.16, 0.045, 0.16, { along: 'x', rng });
    wall.add(frameMat, xf(sb, [(s0 + s1) / 2, y0 - 0.02, 0.03], [0.12, 0, 0]));
  }
  if (box) {
    // flower box with geraniums
    const bw = w + 0.06;
    const bx = (s0 + s1) / 2;
    wall.add(mats.wood('spruce'), xf(board(bw, 0.16, 0.2, { along: 'x', rng }), [bx, y0 - 0.16, 0.13]));
    for (const s of [-1, 1]) wall.add(mats.metal('#2f2b28'), xf(new THREE.BoxGeometry(0.02, 0.12, 0.2), [bx + s * bw * 0.35, y0 - 0.22, 0.04]), { cast: false });
    wall.add(mats.soil(), xf(new THREE.BoxGeometry(bw - 0.04, 0.02, 0.16), [bx, y0 - 0.075, 0.13]), { cast: false });
    const vc = mats.vc();
    const n = Math.round(bw / 0.09);
    for (let i = 0; i < n; i++) {
      const x = bx - bw / 2 + 0.05 + (i / (n - 1)) * (bw - 0.1);
      // leaves
      for (let k = 0; k < 2; k++) {
        const lf = new THREE.SphereGeometry(0.05, 6, 4);
        wall.add(vc, xf(lf, [x + rng.jitter(0.03), y0 - 0.045 + rng.jitter(0.02), 0.13 + rng.jitter(0.06)], null, [1, 0.5, 1]), { color: rng.pick(['#4f7f36', '#5e8c3a', '#3f6b2f']), cast: false });
      }
      // flower clusters
      if (rng.next() < 0.75) {
        const fc = rng.pick(['#d6332a', '#e2553f', '#c4271c', '#f08a8a', '#ffffff']);
        for (let k = 0; k < 4; k++) {
          const f = new THREE.SphereGeometry(0.018, 5, 3);
          wall.add(vc, xf(f, [x + rng.jitter(0.035), y0 + 0.02 + rng.range(0, 0.07), 0.13 + rng.jitter(0.06)]), { color: fc, cast: false });
        }
      }
      // a trailing vine over the front
      if (rng.next() < 0.4 && LOD.tier !== 'low') {
        const pts = [[x, y0 - 0.06, 0.24], [x + rng.jitter(0.03), y0 - 0.2, 0.25], [x + rng.jitter(0.05), y0 - 0.36, 0.24]];
        wall.add(vc, tube(pts, 0.005, 3, 6), { color: '#4f7f36', cast: false });
        for (let k = 0; k < 3; k++) wall.add(vc, xf(new THREE.SphereGeometry(0.022, 5, 3), [pts[k][0] + rng.jitter(0.02), pts[k][1] - 0.02, 0.255], null, [1, 1, 0.4]), { color: '#5e8c3a', cast: false });
      }
    }
  }
  if (shutters) {
    // painted Swiss shutters, folded open against the wall, with a heart cut-out
    const sides = shutters === 'left' ? [-1] : shutters === 'right' ? [1] : [-1, 1];
    for (const s of sides) {
      const sx = s < 0 ? s0 - w / 4 - 0.02 : s1 + w / 4 + 0.02;
      const sh = board(w / 2, h, 0.04, { along: 'y', rng });
      wall.add(mats.vc(), xf(sh, [sx, (y0 + y1) / 2, 0.025]), { color: shutterColor });
      for (const ly of [y0 + 0.12, y1 - 0.12]) wall.add(mats.vc(), xf(board(w / 2 - 0.02, 0.05, 0.02, { along: 'x' }), [sx, ly, 0.05]), { color: shutterColor, cast: false });
      const heart = new THREE.Shape();
      heart.moveTo(0, -0.04);
      heart.bezierCurveTo(-0.06, 0.0, -0.045, 0.055, 0, 0.026);
      heart.bezierCurveTo(0.045, 0.055, 0.06, 0.0, 0, -0.04);
      const hg = new THREE.ShapeGeometry(heart, 4);
      wall.add(mats.vc(), xf(hg, [sx, (y0 + y1) / 2 + h * 0.2, 0.047]), { color: '#1c1410', cast: false });
    }
  }
}

/**
 * Build the annex. Static parts go into the shared world Batch `B`.
 * Returns { group, update(dt,t), anchors, frame }.
 */
export function buildAnnex(ctx, B, mats) {
  const rng = createRng('annex');
  const group = new THREE.Group();
  group.name = 'schreinerei-annex';
  ctx.scene.add(group);
  FRAME = frameMat(ctx);
  PLASTER = annexPlaster(ctx);
  const F0 = annexFrame(B);
  // every frame member gets its own tone (paintMember) unless painted already
  const F = {
    add(material, geo, opts) {
      if (material === FRAME && !geo.attributes.color) paintMember(geo, rng);
      return F0.add(material, geo, opts);
    },
  };
  // the roof: the same, with the bell-cast kick at the eaves
  const FR = {
    add(material, geo, opts) {
      deform(geo, eaveKick, true);
      return F.add(material, geo, opts);
    },
  };
  const { hx, hz, plinth, sillTop, plateBottom, eave, pitch: T, jetty } = ANNEX;
  const tim = FRAME;
  // (triangles each part adds to the shared batch — ctx.sites.schreinerei.annex.cost)
  const cost = {};
  let costMark = B.added;
  const mark = (name) => {
    cost[name] = Math.round(B.added - costMark);
    costMark = B.added;
  }; // the Riegel frame, joist heads, rafters & purlins
  const yRoof = (x) => eave + (hx - Math.abs(x)) * T; // rafter underside line
  // roof surface (top of the rafters), the eave line and the front edge — for the ivy curtain
  const sinPA = Math.sin(Math.atan(T)), cosPA = Math.cos(Math.atan(T));
  const roofSurfAt = (x) => yRoof(x) + 0.14 / cosPA;
  const eaveXAt = hx + ANNEX.overhangSide;
  const zFA = hz + jetty + ANNEX.overhangFront;
  // the root bank along the right (oak) side: its height at (x, z), annex-local
  const bermY = (x, z) => {
    const ss = THREE.MathUtils.smoothstep;
    const n = x - hx;
    const along = (1 - ss(z, 1.05, 2.15)) * ss(z, -2.95, -2.45);
    const H0 = 0.8 * along;
    if (n < -0.05) return H0;
    const k = THREE.MathUtils.clamp(n / 1.35, 0, 1);
    return Math.max(0, H0 * (1 - Math.pow(k, 1.6)) + 0.05 * noiseA(x * 2.4, z * 2.4) * (1 - k));
  };

  // ── fieldstone plinth (individual stones in rough courses) ────────────────
  const plinthRun = (x0, z0, x1, z1, skip = null, detail = 1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
    // outward normal (walls run clockwise seen from above → normal = (dz, -dx))
    const nx = dz, nz = -dx;
    const courses = [0.19, 0.2];
    let y = 0;
    for (let c = 0; c < courses.length; c++) {
      const ch = courses[c];
      let s = c % 2 ? -0.12 : 0;
      while (s < len) {
        const sw = rng.range(0.26, 0.48);
        const sc = Math.min(len, s + sw / 2);
        if (!(skip && skip(sc))) {
          const g = stoneGeo(rng, { r: 1, sx: sw * 0.55, sy: ch * 0.62, sz: 0.2, lump: 0.16, detail });
          const px = x0 + dx * sc + nx * (0.05 + rng.jitter(0.015));
          const pz = z0 + dz * sc + nz * (0.05 + rng.jitter(0.015));
          xf(g, [px, y + ch / 2, pz], [rng.jitter(0.05), Math.atan2(dx, dz) + Math.PI / 2, rng.jitter(0.06)]);
          F.add(mats.stone(), g);
        }
        s += sw;
      }
      y += ch;
    }
    // mortar core behind the stones (interrupted where the skip leaves an opening)
    const spans = [];
    {
      let a = null;
      for (let k = 0; k <= 64; k++) {
        const sc = (k / 64) * len;
        const open = k === 64 || (skip && skip(sc));
        if (!open && a === null) a = sc;
        if (open && a !== null) {
          spans.push([a, k === 64 && !(skip && skip(sc)) ? len : sc]);
          a = null;
        }
      }
    }
    for (const [sa, sb] of spans) {
      const core = new THREE.BoxGeometry(sb - sa, plinth, 0.24);
      const sm = (sa + sb) / 2;
      xf(core, [x0 + dx * sm - nx * 0.1, plinth / 2, z0 + dz * sm - nz * 0.1], [0, Math.atan2(dx, dz) + Math.PI / 2, 0]);
      F.add(mats.stone(), uvBox(core, 'x', 1));
    }
    // cap stones: flat slabs on top, slightly proud
    let s = 0;
    while (s < len) {
      const sw = rng.range(0.4, 0.7);
      const sc = Math.min(len - 0.1, s + sw / 2);
      if (!(skip && skip(sc))) {
        const g = stoneGeo(rng, { r: 1, sx: sw * 0.52, sy: 0.05, sz: 0.17, lump: 0.1, detail });
        xf(g, [x0 + dx * sc + nx * 0.03, plinth - 0.02, z0 + dz * sc + nz * 0.03], [0, Math.atan2(dx, dz) + Math.PI / 2, 0]);
        F.add(mats.stone(), g);
      }
      s += sw;
    }
  };
  const door = ANNEX.door;
  // front (left→right as seen from the front), right side (front→back), back, left side
  plinthRun(-hx, hz, hx, hz, (s) => s > door.s0 - 0.05 && s < door.s1 + 0.05);
  // (the oak side, under the roots and ferns, and the back are seen by no camera: cheaper stones)
  plinthRun(hx, hz, hx, -hz, (s) => s > 1.2, 0); // (buried in the root bank behind the front 1.2)
  plinthRun(hx, -hz, -hx, -hz, null, 0);
  plinthRun(-hx, -hz, -hx, hz);

  mark('plinth');
  // ── ground-floor walls ─────────────────────────────────────────────────────
  const front = makeWall(F, mats, rng, [-hx, 0, hz], [1, 0, 0], [0, 0, 1]);
  const right = makeWall(F, mats, rng, [hx, 0, hz], [0, 0, -1], [1, 0, 0]);
  const back = makeWall(F, mats, rng, [hx, 0, -hz], [-1, 0, 0], [0, 0, -1]);
  const left = makeWall(F, mats, rng, [-hx, 0, -hz], [0, 0, 1], [-1, 0, 0]);
  const L = A.width, Dd = A.depth;
  const ys = sillTop, yp = plateBottom;
  // sills & top plates on all four walls (the front sill is interrupted by the door)
  for (const [w, len] of [[front, L], [right, Dd], [back, L], [left, Dd]]) {
    if (w === front) {
      w.timber(-0.08, plinth + 0.08, door.s0, plinth + 0.08);
      w.timber(door.s1, plinth + 0.08, len + 0.08, plinth + 0.08);
    } else w.timber(-0.08, plinth + 0.08, len + 0.08, plinth + 0.08);
    w.timber(-0.1, yp + 0.08, len + 0.1, yp + 0.08, 0.16, 0.17);
  }
  // FRONT: corner posts, window W1, door, window W2 under the porch roof
  const W1 = [0.16, 1.46, 1.02, yp];
  const W2 = [4.0, 5.0, 1.08, 1.98];
  const postsF = [0.08, 1.54, door.s0 - 0.08, door.s1 + 0.08, 3.92, 5.08, L - 0.08];
  for (const s of postsF) {
    const y0 = s > door.s0 - 0.2 && s < door.s1 + 0.2 ? 0.0 : ys;
    if (s === 1.54) continue; // = door post
    front.timber(s, y0, s, yp);
  }
  front.timber(door.s0 - 0.08, 0, door.s0 - 0.08, yp);
  // door lintel (with a carved year) and rails
  front.timber(door.s0 - 0.16, door.top + 0.09, door.s1 + 0.16, door.top + 0.09, 0.18, 0.18, { proud: 0.02 });
  front.timber(0.16, W1[2] - 0.06, W1[1] + 0.08, W1[2] - 0.06, 0.12);
  front.timber(door.s1 + 0.16, W2[2] - 0.06, L - 0.16, W2[2] - 0.06, 0.12);
  front.timber(W2[0] - 0.08, W2[3] + 0.06, W2[1] + 0.08, W2[3] + 0.06, 0.12);
  // St Andrew's crosses under the windows
  const andreas = (w, s0, s1, y0, y1) => {
    w.timber(s0, y0, s1, y1, 0.11, 0.12, { proud: -0.01 });
    w.timber(s0, y1, s1, y0, 0.11, 0.12, { proud: -0.012 });
  };
  andreas(front, 0.2, W1[1] - 0.02, ys + 0.02, W1[2] - 0.12);
  andreas(front, W2[0] + 0.04, W2[1] - 0.04, ys + 0.02, W2[2] - 0.12);
  // braces from the corner post into the plate (Kopfband) and a foot brace
  front.timber(L - 0.16, ys + 0.6, W2[1] + 0.12, ys + 0.02, 0.11, 0.12);
  front.timber(door.s1 + 0.16, yp - 0.05, door.s1 + 0.38, yp - 0.4, 0.1, 0.12);
  // pegs at the joints
  for (const s of postsF) for (const y of [ys + 0.08, yp - 0.06]) front.peg(s, y);
  addWindow(front, mats, rng, W1[0] + 0.02, W1[2], W1[1] - 0.02, W1[3] - 0.01, { cols: 4, rows: 3, cell: WIN.workshop, box: true });
  addWindow(front, mats, rng, W2[0], W2[2], W2[1], W2[3], { cols: 3, rows: 3, cell: WIN.sill });
  front.plaster([[0, ys], [door.s0, ys], [door.s0, yp + 0.16], [0, yp + 0.16]], [[[W1[0], W1[2]], [W1[1], W1[2]], [W1[1], W1[3]], [W1[0], W1[3]]]]);
  front.plaster([[door.s1, ys], [L, ys], [L, yp + 0.16], [door.s1, yp + 0.16]], [[[W2[0], W2[2]], [W2[1], W2[2]], [W2[1], W2[3]], [W2[0], W2[3]]]]);
  // plaster above the door lintel
  front.plaster([[door.s0, door.top + 0.18], [door.s1, door.top + 0.18], [door.s1, yp + 0.16], [door.s0, yp + 0.16]]);

  // RIGHT side (towards the oak): plain frame, one small window
  for (const s of [0.08, 1.4, 2.6, Dd - 0.08]) right.timber(s, ys, s, yp);
  right.timber(0.16, 1.3, 1.32, 1.3, 0.12);
  right.timber(1.48, ys + 0.05, 2.52, yp - 0.05, 0.11, 0.12);
  right.timber(2.68, yp - 0.05, Dd - 0.16, ys + 0.05, 0.11, 0.12);
  addWindow(right, mats, rng, 0.35, 1.36, 1.15, 2.1, { cols: 2, rows: 2, cell: WIN.shelves });
  right.plaster([[0, ys], [Dd, ys], [Dd, yp + 0.16], [0, yp + 0.16]], [[[0.35, 1.36], [1.15, 1.36], [1.15, 2.1], [0.35, 2.1]]]);
  // BACK: plain
  for (const s of [0.08, 1.9, 3.7, L - 0.08]) back.timber(s, ys, s, yp);
  back.timber(0.16, 1.4, L - 0.16, 1.4, 0.12);
  back.plaster([[0, ys], [L, ys], [L, yp + 0.16], [0, yp + 0.16]]);
  // the back gable, against the oak: weathered board-and-batten up under
  // the rafters (closed, so an orbit round the back never looks into the loft)
  {
    const y0 = yp + 0.14, yTop = (x) => eave + (hx - Math.abs(x)) * T - 0.02;
    const sh = new THREE.Shape([new THREE.Vector2(-hx - 0.02, y0), new THREE.Vector2(hx + 0.02, y0), new THREE.Vector2(hx + 0.02, yTop(hx)), new THREE.Vector2(0, yTop(0)), new THREE.Vector2(-hx - 0.02, yTop(hx))]);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: false });
    uvBox(g, 'y');
    F.add(mats.wood('#6f5a44'), xf(g, [0, 0, -hz - 0.06]), { cast: false });
    for (let x = -hx + 0.12; x < hx - 0.05; x += 0.3) {
      const h = yTop(Math.abs(x) + 0.03) - y0 - 0.02;
      if (h < 0.08) continue;
      F.add(mats.wood('#62503c'), xf(board(0.045, h, 0.025, { along: 'y', rng }), [x + rng.jitter(0.01), y0 + h / 2, -hz - 0.075]), { cast: false });
    }
  }
  // LEFT side: two windows (seen from the cottage side), braces
  for (const s of [0.08, 1.45, 2.95, Dd - 0.08]) left.timber(s, ys, s, yp);
  left.timber(0.16, 1.05, Dd - 0.16, 1.05, 0.12);
  addWindow(left, mats, rng, 1.6, 1.12, 2.8, yp - 0.02, { cols: 3, rows: 2, cell: WIN.shelves });
  andreas(left, 0.18, 1.37, ys + 0.02, 0.98);
  andreas(left, 3.03, Dd - 0.18, ys + 0.02, 0.98);
  left.plaster([[0, ys], [Dd, ys], [Dd, yp + 0.16], [0, yp + 0.16]], [[[1.6, 1.12], [2.8, 1.12], [2.8, yp - 0.02], [1.6, yp - 0.02]]]);

  mark('walls');
  // ── the jettied front gable ────────────────────────────────────────────────
  const gz = hz + jetty; // gable outer face
  const [gs0, gs1] = ANNEX.gableSill;
  // joist heads (Balkenköpfe) carrying the jetty, with rounded carved ends
  for (let i = 0; i < 7; i++) {
    const x = -hx + 0.2 + (i / 6) * (A.width - 0.4);
    const j = board(0.13, eave - plateBottom - 0.0, 0.9, { along: 'z', rng, r: 0.02 });
    F.add(tim, xf(j, [x, (plateBottom + 0.16 + gs0) / 2 + 0.0, hz - 0.3 + 0.0 + jetty * 0.5]));
    const cap = new THREE.CylinderGeometry(0.08, 0.08, 0.13, 12);
    F.add(tim, xf(uvBox(cap, 'y'), [x, (plateBottom + 0.16 + gs0) / 2, hz + jetty - 0.0], [0, 0, Math.PI / 2]));
  }
  // cover board between the joist heads
  F.add(mats.wood('oak'), xf(board(A.width + 0.1, 0.18, 0.04, { along: 'x', rng }), [0, (plateBottom + 0.16 + gs0) / 2, hz + 0.05]));
  const gable = makeWall(F, mats, rng, [0, 0, gz], [1, 0, 0], [0, 0, 1]);
  const gW = hx - (gs1 - eave) / T; // half width of the gable at the sill top
  const apex = yRoof(0);
  const hwAt = (y) => (apex - y) / T; // half width of the gable (rafter underside) at height y
  // The gable as a Zimmermann frames it (Riegelwerk, one storey + the
  // triangle): a heavy sill on the jetty joists; posts, the hatch posts and
  // the gable posts, up to a plate (Rähm) that carries the triangle; a
  // Brüstungsriegel under the windows with an Andreaskreuz in each parapet
  // field; full-length foot braces (Fussbänder) from the gable posts down
  // into the sill; and in the triangle a king post with a true "Mann": two
  // braces from its middle down and out onto the plate, two short head braces
  // up to the rafters. Rails stop at the posts (nothing crosses), sections
  // differ (sill 18, plate 15, posts 13, rails 11, braces 10.5), every member
  // hand-hewn with its own wobble and tone, pale oak trenails in pairs at
  // every brace end.
  const GF = { sillRail: 3.2, win0: 3.27, win1: 4.0, plate: 4.07, post: 1.3, hatch: 0.42, mann: 5.02, vent: 0.98, spall: [-0.3, 4.31] };
  const hew = { wobble: 0.026 };
  // gable sill: it ends where the gable meets the roof (longer, its ends poked up through the shakes)
  gable.timber(-gW - 0.02, (gs0 + gs1) / 2, gW + 0.02, (gs0 + gs1) / 2, 0.18, 0.19, hew);
  // the plate (Rähm) across the whole gable at the window heads
  const plateHW = hwAt(GF.plate) - 0.05;
  gable.timber(-plateHW, GF.plate, plateHW, GF.plate, 0.15, 0.17, hew);
  const plateB = GF.plate - 0.075; // its underside
  // posts: gable posts and hatch posts, sill → plate
  for (const s of [-1, 1]) {
    gable.timber(s * GF.post, gs1 - 0.01, s * GF.post, plateB + 0.01, 0.13, 0.15, hew);
    gable.timber(s * GF.hatch, gs1 - 0.01, s * GF.hatch, plateB + 0.01, 0.12, 0.14, hew);
  }
  // Brüstungsriegel (window-sill rails) between the posts and out to the roof
  for (const s of [-1, 1]) {
    gable.timber(s * (GF.hatch + 0.06), GF.sillRail, s * (GF.post - 0.065), GF.sillRail, 0.11, 0.13, hew);
    gable.timber(s * (GF.post + 0.065), GF.sillRail, s * (hwAt(GF.sillRail) - 0.05), GF.sillRail, 0.11, 0.13, hew);
  }
  // Andreaskreuze in the parapet fields under the windows
  const pY0 = gs1 + 0.02, pY1 = GF.sillRail - 0.055 - 0.015;
  for (const s of [-1, 1]) {
    const a = s * (GF.hatch + 0.075), b = s * (GF.post - 0.075);
    gable.timber(a, pY0, b, pY1, 0.1, 0.12, { ...hew, proud: -0.008 });
    gable.timber(a, pY1, b, pY0, 0.1, 0.12, { ...hew, proud: -0.011 });
  }
  // full-length foot braces (Fussbänder): from the gable post down and out into the sill
  const fb = { y0: GF.sillRail - 0.09, x1: 1.98, y1: gs1 + 0.01 };
  for (const s of [-1, 1]) gable.timber(s * (GF.post + 0.06), fb.y0, s * fb.x1, fb.y1, 0.105, 0.12, { ...hew, proud: -0.008 });
  // the triangle: king post, the Mann's two legs onto the plate, two head braces (arms) to the rafters
  const plateT = GF.plate + 0.075;
  gable.timber(0, plateT - 0.01, 0, apex - 0.06, 0.14, 0.15, hew);
  const leg = { x: 0.66, y: GF.mann };
  const arm = { y0: 5.36, x1: 0.36 };
  for (const s of [-1, 1]) {
    gable.timber(s * 0.06, leg.y, s * leg.x, plateT + 0.01, 0.105, 0.12, { ...hew, proud: -0.008 });
    gable.timber(s * 0.06, arm.y0, s * arm.x1, yRoof(arm.x1) - 0.02, 0.09, 0.11, { ...hew, proud: -0.008 });
  }
  // trenails: pairs at every brace end, singles where posts meet sill & plate
  {
    const pegsAt = [];
    for (const s of [-1, 1]) {
      // posts into sill & plate
      for (const x of [GF.post, GF.hatch]) pegsAt.push([s * x, gs1 + 0.07, null], [s * x, plateB - 0.06, null]);
      // the cross ends (in the posts) and the foot brace (post & sill)
      pegsAt.push([s * (GF.post - 0.0), pY1 - 0.05, Math.PI / 2], [s * GF.hatch, pY0 + 0.06, Math.PI / 2]);
      pegsAt.push([s * GF.post, fb.y0 - 0.02, Math.PI / 2], [s * (fb.x1 - 0.08), (gs0 + gs1) / 2, 0]);
      // the Mann: legs into the king post and the plate, arms into the post
      pegsAt.push([0, leg.y - 0.02, Math.PI / 2], [s * (leg.x - 0.07), GF.plate + 0.005, 0], [0, arm.y0 - 0.0, Math.PI / 2]);
      // the rails into the posts
      pegsAt.push([s * (GF.post), GF.sillRail, null]);
    }
    const seen = new Set();
    for (const [x, y, a] of pegsAt) {
      const k = `${x.toFixed(2)}|${y.toFixed(2)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (a === null) gable.peg(x, y);
      else gable.pegPair(x, y, a);
    }
  }
  // gable windows with shutters
  const GW = [[-1.2, -0.5], [0.5, 1.2]];
  GW.forEach(([a, b], i) => addWindow(gable, mats, rng, a, GF.win0, b, GF.win1, { cols: 2, rows: 2, cell: WIN.curtainL, mirror: !!i, shutters: i ? 'right' : 'left', shutterColor: '#3e6650' }));
  // the loading hatch (Ladeluke) between the hatch posts, down to the loft
  // floor on the sill: closed planks, strap hinges, a ring
  {
    const h0 = gs1 + 0.01, h1 = GF.win1, hh = h1 - h0;
    for (let i = 0; i < 4; i++) gable.add(mats.wood('oak'), xf(board(0.175, hh, 0.05, { along: 'y', rng }), [-0.27 + i * 0.18, (h0 + h1) / 2, -0.03]));
    for (const y of [h0 + 0.2, h1 - 0.2]) {
      gable.add(mats.metal('#2f2b28'), xf(new THREE.BoxGeometry(0.56, 0.04, 0.012), [0.0, y, 0.0]), { cast: false });
    }
    gable.add(mats.metal('#2f2b28'), xf(new THREE.TorusGeometry(0.035, 0.008, 4, 10), [0.19, (h0 + h1) / 2, 0.02]), { cast: false });
  }
  // two little round vents (owl holes) in the triangle's outer fields, carved surrounds
  for (const s of [-1, 1]) {
    const ox = s * GF.vent, oy = 4.46;
    gable.add(mats.wood('oak'), xf(uvBox(new THREE.TorusGeometry(0.085, 0.028, 6, 14), 'x'), [ox, oy, 0.0]));
    gable.add(mats.vc(), xf(new THREE.CircleGeometry(0.086, 12), [ox, oy, -0.03]), { color: '#1c130d', cast: false });
  }
  // gable plaster (triangle minus openings)
  {
    const outline = [[-hwAt(gs1), gs1], [hwAt(gs1), gs1], [0, apex]];
    const holes = [
      ...GW.map(([a, b]) => [[a, GF.win0], [b, GF.win0], [b, GF.win1], [a, GF.win1]]),
      [[-0.33, gs1], [0.33, gs1], [0.33, GF.win1 + 0.02], [-0.33, GF.win1 + 0.02]],
    ];
    for (const s of [-1, 1]) {
      const circle = [];
      for (let i = 0; i < 10; i++) circle.push([s * GF.vent + Math.cos((i / 10) * Math.PI * 2) * 0.09, 4.46 + Math.sin((i / 10) * Math.PI * 2) * 0.09]);
      holes.push(circle.reverse());
    }
    // one small spalled patch where the plaster has come away and shows its wattle
    const spall = [];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const k = 1 + 0.22 * Math.sin(a * 3 + 1.3) + rng.jitter(0.12);
      spall.push([GF.spall[0] + Math.cos(a) * 0.12 * k, GF.spall[1] + Math.sin(a) * 0.075 * k]);
    }
    holes.push(spall);
    gable.plaster(outline, holes);
    // behind it: the clay daub (Lehm) and the woven hazel wattle (Flechtwerk)
    const [sx, sy] = GF.spall;
    gable.add(mats.vc(), xf(new THREE.PlaneGeometry(0.32, 0.22), [sx, sy, -0.11]), { color: '#8a6b4a', cast: false });
    for (let k = 0; k < 2; k++) gable.add(mats.wood('#6b5136'), xf(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 5), [sx - 0.06 + k * 0.12, sy, -0.095]), { cast: false });
    for (let k = 0; k < 3; k++) {
      const yy = sy - 0.05 + k * 0.05, ph = k % 2 ? 1 : -1;
      const pts = [];
      for (let i = 0; i <= 4; i++) pts.push([sx - 0.16 + i * 0.08, yy + rng.jitter(0.004), -0.078 + (i % 2 ? ph : -ph) * 0.012]);
      gable.add(mats.wood('#7a5c3d'), tube(pts, 0.011, 5, 8), { cast: false });
    }
  }
  // hoist beam with a pulley and a rope tied to a cleat
  {
    const hy = 5.62;
    F.add(tim, timber([0, hy, gz - 0.6], [0, hy, gz + 0.92], 0.15, 0.17, { rng, up: [0, 1, 0] }));
    const end = new THREE.CylinderGeometry(0.085, 0.085, 0.15, 12);
    F.add(tim, xf(uvBox(end, 'y'), [0, hy, gz + 0.92], [0, 0, Math.PI / 2]));
    const iron = mats.metal('#2f2b28');
    F.add(iron, xf(new THREE.TorusGeometry(0.03, 0.01, 4, 8), [0, hy - 0.12, gz + 0.82]), { cast: false });
    const wheel = new THREE.CylinderGeometry(0.075, 0.075, 0.035, 14);
    F.add(mats.wood('walnut'), xf(uvBox(wheel, 'y'), [0, hy - 0.24, gz + 0.82], [0, 0, Math.PI / 2]), { cast: false });
    F.add(iron, xf(new THREE.BoxGeometry(0.012, 0.2, 0.17), [0.03, hy - 0.2, gz + 0.82]), { cast: false });
    F.add(iron, xf(new THREE.BoxGeometry(0.012, 0.2, 0.17), [-0.03, hy - 0.2, gz + 0.82]), { cast: false });
    const rope = mats.rope();
    F.add(rope, tube([[0, hy - 0.2, gz + 0.9], [0.02, hy - 1.2, gz + 0.86], [0.05, 4.35, gz + 0.62], [0.16, 4.1, gz + 0.16]], 0.012, 4, 20), { cast: false });
    // the hook end with a coil hanging from the cleat
    F.add(rope, tube([[0, hy - 0.2, gz + 0.74], [0.01, hy - 0.9, gz + 0.74], [0.0, hy - 1.35, gz + 0.73]], 0.012, 4, 10), { cast: false });
    F.add(iron, xf(new THREE.TorusGeometry(0.05, 0.012, 4, 10, Math.PI * 1.4), [0, hy - 1.42, gz + 0.73], [0, Math.PI / 2, Math.PI]), { cast: false });
    F.add(tim, xf(board(0.2, 0.05, 0.06, { along: 'x', rng }), [0.16, 4.1, gz + 0.03]), { cast: false });
  }

  mark('gable');
  // ── roof: rafters, purlins with carved ends on brackets, bargeboards ──────
  const zB = -hz - ANNEX.overhangBack, zF = gz + ANNEX.overhangFront;
  const rd = 0.14; // rafter depth
  const cosP = Math.cos(Math.atan(T)), sinP = Math.sin(Math.atan(T));
  const eaveX = hx + ANNEX.overhangSide;
  const roofSurf = (x) => yRoof(x) + rd / cosP; // top of the rafters (deck underside)
  for (const s of [-1, 1]) {
    // rafters
    for (let z = zB + 0.12; z <= zF - 0.05; z += 0.62) {
      // (sunk a little under the roof boards so their hewn bow never pokes through)
      const a = [s * eaveX, yRoof(eaveX) + rd / 2 / cosP - 0.015, z];
      const b = [s * 0.05, yRoof(0.05) + rd / 2 / cosP - 0.015, z];
      FR.add(tim, timber(a, b, 0.1, rd, { rng, up: [s * sinP, cosP, 0], wobble: 0.007, r: 0.024 }));
    }
    // purlins (eave & middle) running front to back; ends carved and on brackets
    for (const px of [hx - 0.05, 1.45]) {
      const py = yRoof(px) - 0.09;
      F.add(tim, timber([s * px, py, zB - 0.05], [s * px, py, zF - 0.06], 0.15, 0.17, { rng, up: [0, 1, 0] }));
      const end = new THREE.CylinderGeometry(0.085, 0.085, 0.15, 12);
      F.add(tim, xf(uvBox(end, 'y'), [s * px, py, zF - 0.06], [0, 0, Math.PI / 2]));
      // curved bracket (Bug) from the gable wall up under the purlin end
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        pts.push([s * px, py - 0.75 + t * 0.68 + Math.sin(t * Math.PI) * 0.05, gz - 0.02 + Math.pow(t, 1.6) * (zF - gz - 0.25)]);
      }
      if (px < hx - 0.1) F.add(tim, tube(pts, 0.05, 6, 12));
    }
    // bargeboard along the front gable edge with scalloped underside
    const bb0 = [s * (eaveX + 0.02), roofSurf(eaveX) - 0.03, zF];
    const bb1 = [0, roofSurf(0) - 0.03, zF];
    {
      const g = scallopBoard(Math.hypot(bb1[0] - bb0[0], bb1[1] - bb0[1]), 0.3, 0.05, rng);
      FR.add(mats.wood('oak'), alongXUp(g, bb0, bb1, [s * sinP, cosP, 0]));
    }
    // back bargeboard (plain)
    FR.add(mats.wood('oak'), timber([s * (eaveX + 0.02), roofSurf(eaveX) - 0.03, zB], [0, roofSurf(0) - 0.03, zB], 0.05, 0.26, { rng, up: [s * sinP, cosP, 0], wobble: 0.004 }));
    // roof deck boards (closing the underside of the overhangs)
    const deckLen = Math.hypot(eaveX, roofSurf(0) - roofSurf(eaveX));
    // (segments only where they bend: the bell-cast kick near the eave, the ridge's sag along z)
    const deck = new THREE.BoxGeometry(deckLen, 0.025, zF - zB, segs(10, 5), 1, segs(7, 5));
    uvBox(deck, 'x');
    xf(deck, [s * eaveX / 2, (roofSurf(eaveX) + roofSurf(0)) / 2 + 0.012, (zF + zB) / 2], [0, 0, s * Math.atan(T) * -1]);
    // (weathered dark: a missing shake reads as a dark gap, not a pale speck)
    FR.add(mats.wood('#6b5640'), deck);
  }
  // ridge purlin + finial at the front apex
  F.add(tim, timber([0, apex - 0.1, zB - 0.05], [0, apex - 0.1, zF - 0.04], 0.16, 0.18, { rng }));
  {
    const fin = new THREE.CylinderGeometry(0.05, 0.07, 0.75, 8);
    F.add(mats.wood('oak'), xf(uvBox(fin, 'y'), [0, roofSurf(0) + 0.3, zF + 0.04]));
    F.add(mats.wood('oak'), xf(new THREE.SphereGeometry(0.085, 10, 8), [0, roofSurf(0) + 0.72, zF + 0.04], null, [1, 1.25, 1]));
    F.add(mats.wood('oak'), xf(new THREE.ConeGeometry(0.045, 0.16, 8), [0, roofSurf(0) + 0.88, zF + 0.04]));
  }

  mark('roof');
  // ── dormer on the right slope (towards the oak) ────────────────────────────
  // A proper little Giebelgaube: a timber-framed front with a two-light
  // window (it looks out at the oak's bark and the great root), cheeks clad
  // in small shakes — no plaster above the roof — a steep shingled gable roof
  // with a ridge cap, bargeboards and a finial, and zinc flashing where the
  // cheeks and the apron meet the main roof.
  const shakeQueue = []; // the dormer cheeks' shakes, added to the roof's field below
  const queue = { push: (m, c) => shakeQueue.push([m.clone(), c.clone()]) };
  const SH = shakeScale();
  const dorm = { z: 0.55, w: 1.0, y0: 3.42, h: 0.92, dp: 1.0 };
  const shakeTop = (x) => roofSurf(x) + 0.07; // top of the main roof's shakes at x
  const xAtShakes = (y) => hx - (y - 0.07 - eave - rd / cosP) / T; // where the shakes reach height y
  dorm.x = hx - (dorm.y0 - eave) / T + 0.02; // front face (its foot sits on the rafters)
  dorm.hw = dorm.w / 2;
  dorm.top = dorm.y0 + dorm.h;
  dorm.yb = shakeTop(dorm.x) - 0.02; // the apron line: where the front wall leaves the shakes
  dorm.ow = dorm.hw + 0.13; // half span of its roof
  dorm.ridge = dorm.top + dorm.ow * dorm.dp;
  dorm.back = xAtShakes(dorm.ridge) - 0.12;
  const zinc = mats.metal('#5c6064'); // old, dull lead-grey zinc
  {
    const dx = dorm.x, dz = dorm.z, hw = dorm.hw, top = dorm.top, yb = dorm.yb;
    const dw = makeWall(F, mats, rng, [dx, 0, dz + hw], [0, 0, -1], [1, 0, 0]);
    dw.timber(0.06, dorm.y0, 0.06, top);
    dw.timber(dorm.w - 0.06, dorm.y0, dorm.w - 0.06, top);
    dw.timber(-0.05, top - 0.06, dorm.w + 0.05, top - 0.06, 0.12);
    dw.timber(-0.02, yb + 0.06, dorm.w + 0.02, yb + 0.06, 0.12);
    const wy0 = yb + 0.13, wy1 = top - 0.12;
    addWindow(dw, mats, rng, 0.16, wy0, dorm.w - 0.16, wy1, { cols: 2, rows: 2, cell: WIN.curtainL, sill: false });
    dw.plaster([[0.06, yb + 0.1], [dorm.w - 0.06, yb + 0.1], [dorm.w - 0.06, top - 0.08], [0.06, top - 0.08]], [[[0.16, wy0], [dorm.w - 0.16, wy0], [dorm.w - 0.16, wy1], [0.16, wy1]]]);
    // cheeks: a board backing (its foot well under the shakes) clad in small shakes
    // (the backing rises right up under the dormer's roof boards — no dark
    // slot under its eaves — and its sloping foot stays under the main shakes)
    const ct = top + 0.11;
    const xb = xAtShakes(ct + 0.07);
    const xv = xAtShakes(top); // where the cheek meets the roof at the top
    for (const sgn of [-1, 1]) {
      const sh = new THREE.Shape([new THREE.Vector2(dx, shakeTop(dx) - 0.09), new THREE.Vector2(dx, ct), new THREE.Vector2(xb, ct)]);
      const cg = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: false });
      cg.translate(0, 0, sgn > 0 ? -0.04 : 0);
      uvBox(cg, 'y');
      F.add(mats.wood('#6e5a45'), xf(cg, [0, 0, dz + sgn * hw]));
      // the cladding: courses of little shakes laid like the roof (staggered,
      // overlapping, each its own nudge, tilt and tone), clear of the roof line
      {
        const along = new THREE.Vector3(sgn, 0, 0), up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3(0, 0, sgn);
        const y0 = shakeTop(dx) - 0.03, xMin = xAtShakes(top + 0.03);
        const origin = new THREE.Vector3(sgn > 0 ? xMin : dx - 0.02, y0, dz + sgn * hw);
        layShakes(queue, {
          origin, alongDir: along, upDir: up, normal: nrm, length: dx - 0.02 - xMin, height: top + 0.03 - y0,
          w: 0.1 * SH, exposure: 0.07 * SH, size: [0.5, 0.58], rng, lift: 0.016,
          skip: (u, v) => {
            const x = origin.x + sgn * u, y = y0 + v;
            return x < xAtShakes(y) + 0.035 || x > dx - 0.04;
          },
          transform: (q) => crook(q),
        });
      }
      // corner board over the cladding's front ends
      F.add(tim, xf(board(0.07, top - yb + 0.06, 0.07, { along: 'y', rng }), [dx - 0.015, (yb + top) / 2, dz + sgn * (hw + 0.01)]));
      // zinc flashing along the cheek seam: a strip on the shakes and an upstand on the cladding
      {
        const U = new THREE.Vector3(-cosP, sinP, 0), Nr = new THREE.Vector3(sinP, cosP, 0), Z = new THREE.Vector3(0, 0, -1);
        const fb = new THREE.Matrix4().makeBasis(U, Nr, Z);
        const L = (top - shakeTop(dx)) / sinP + 0.05;
        const mx = (dx + xv) / 2 + 0.01, my = shakeTop(mx);
        const strip = new THREE.BoxGeometry(L, 0.005, 0.055).applyMatrix4(fb);
        F.add(zinc, strip.translate(mx + Nr.x * 0.012, my + Nr.y * 0.012, dz + sgn * (hw + 0.06)), { cast: false });
        const stand = new THREE.BoxGeometry(L, 0.05, 0.005).applyMatrix4(fb);
        F.add(zinc, stand.translate(mx + Nr.x * 0.03, my + Nr.y * 0.03, dz + sgn * (hw + 0.034)), { cast: false });
      }
    }
    // the apron flashing across the front foot
    {
      const U = new THREE.Vector3(-cosP, sinP, 0), Nr = new THREE.Vector3(sinP, cosP, 0), Z = new THREE.Vector3(0, 0, -1);
      const fb = new THREE.Matrix4().makeBasis(U, Nr, Z);
      const px = dx + 0.045, py = shakeTop(px);
      F.add(zinc, new THREE.BoxGeometry(0.1, 0.005, dorm.w + 0.14).applyMatrix4(fb).translate(px + Nr.x * 0.012, py + Nr.y * 0.012, dz), { cast: false });
      F.add(zinc, new THREE.BoxGeometry(0.005, 0.06, dorm.w + 0.14).translate(dx + 0.012, shakeTop(dx) + 0.02, dz), { cast: false });
    }
    // the little gable over the window: upright boards, the joints covered by battens
    {
      const gw = '#7a5d41';
      for (let zc = -hw + 0.05; zc < hw - 0.02; zc += 0.1) {
        const h = Math.max(0.02, (hw - Math.abs(zc) + 0.05) * dorm.dp - 0.02);
        F.add(mats.wood(gw), xf(board(0.022, h, 0.094, { along: 'y', rng }), [dx + 0.035, top + h / 2 - 0.03, dz + zc]), { cast: false });
      }
    }
    // its roof: two board planes (ridge along x), bargeboards and a finial in front
    const dp = dorm.dp, ow = dorm.ow;
    const rl = Math.hypot(ow, ow * dp);
    const back = dorm.back;
    const rlen = dx + 0.24 - back;
    for (const sgn of [-1, 1]) {
      const rf = new THREE.BoxGeometry(rlen, 0.04, rl, 3, 1, 2);
      uvBox(rf, 'x');
      xf(rf, [back + rlen / 2, top + (ow * dp) / 2 + 0.03, dz + (sgn * ow) / 2], [sgn * Math.atan(dp), 0, 0]);
      F.add(mats.wood('spruce'), rf);
      const bb = scallopBoard(rl + 0.04, 0.12, 0.035, rng);
      bb.rotateY(Math.PI / 2);
      F.add(mats.wood('oak'), xf(bb, [dx + 0.25, top + (ow * dp) / 2 - 0.02, dz + (sgn * ow) / 2], [sgn * Math.atan(dp), 0, 0]));
    }
    F.add(mats.wood('oak'), xf(new THREE.CylinderGeometry(0.03, 0.04, 0.32, 8), [dx + 0.26, dorm.ridge + 0.14, dz]));
    F.add(mats.wood('oak'), xf(new THREE.SphereGeometry(0.05, 8, 6), [dx + 0.26, dorm.ridge + 0.33, dz], null, [1, 1.3, 1]));
  }

  mark('dormer');
  // ── shingles ───────────────────────────────────────────────────────────────
  const field = new ShingleField();
  const slopeLen = Math.hypot(eaveX, roofSurf(0) - roofSurf(eaveX));
  const tmpCol = new THREE.Color();
  for (const s of [-1, 1]) {
    const up = new THREE.Vector3(-s * cosP, sinP, 0).normalize();
    const normal = new THREE.Vector3(s * sinP, cosP, 0);
    const along = s > 0 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 0, 1);
    // alongDir × upDir must = normal for a right-handed basis
    const origin = new THREE.Vector3(s * (eaveX + 0.06), roofSurf(eaveX + 0.06) + 0.025, s > 0 ? zF + 0.06 : zB - 0.06);
    layShingles(field, {
      origin,
      alongDir: along,
      upDir: up,
      normal,
      length: zF - zB + 0.12,
      height: slopeLen + 0.02,
      w: 0.2 * SH,
      exposure: 0.125 * SH,
      rng,
      skip: (u, v) => {
        if (s < 0) return false;
        // leave room for the dormer: between its clad cheeks below its eaves
        // (a shake's half width clear of the cladding), under its gable roof above
        const z = zF + 0.06 - u;
        const y = roofSurf(eaveX + 0.06) + v * sinP;
        const dzz = Math.abs(z - dorm.z);
        if (y < dorm.yb - 0.04 || y > dorm.ridge + 0.1) return false;
        if (y < dorm.top) return dzz < dorm.hw + 0.13;
        return dzz < Math.max(0, dorm.ow - (y - dorm.top) / dorm.dp) - 0.02;
      },
      tint: (u, v, c, p) => {
        // moss creeping up from the eaves and in patches; sun-bleached near the ridge
        const n = noiseA(p.z * 0.9 + s * 3, p.y * 0.9) * 0.5 + 0.5;
        const mossy = THREE.MathUtils.clamp((1 - v / 1.4) * 0.8 + (n - 0.62) * 2.2, 0, 1) * (s < 0 ? 1 : 0.8);
        if (mossy > 0.05) c.lerp(tmpCol.setRGB(0.55, 0.78, 0.36), mossy * 0.7);
        if (v > slopeLen - 0.8) c.multiplyScalar(1.08);
      },
      transform: (p) => crook(eaveKick(p)),
    });
  }
  // ridge cap: a double row of shingles along the ridge
  for (let z = zB; z < zF; z += 0.2 * SH) {
    for (const s of [-1, 1]) {
      // width runs down from the ridge, length along the ridge, normal outwards
      const a = 0.55;
      const X = new THREE.Vector3(s * Math.cos(a), -Math.sin(a), 0);
      const Y = new THREE.Vector3(0, 0, -s);
      const Z = new THREE.Vector3().crossVectors(X, Y);
      const m = new THREE.Matrix4().makeBasis(X, Y, Z);
      const p = new THREE.Vector3(s * 0.085, roofSurf(0) + 0.06, z + (s > 0 ? 0.2 : 0) + rng.jitter(0.02));
      crook(p);
      m.setPosition(p);
      field.push(m, tmpCol.setRGB(0.7, 0.66, 0.58));
    }
  }
  // the dormer's roof shakes, laid like the main roof's (staggered courses,
  // per-shake nudge, tilt and tone), none where the main roof covers the
  // plane; a ridge cap; and the cheek cladding queued above
  {
    const dp = dorm.dp, ow = dorm.ow, top = dorm.top;
    const ca = Math.cos(Math.atan(dp)), sa = Math.sin(Math.atan(dp));
    const rl = Math.hypot(ow, ow * dp);
    const col = new THREE.Color();
    for (const sgn of [-1, 1]) {
      const along = new THREE.Vector3(sgn, 0, 0);
      const up = new THREE.Vector3(0, sa, -sgn * ca);
      const nrm = new THREE.Vector3(0, ca, sgn * sa);
      // the board's top face along the eave line, the butts a little proud of it
      const x0 = sgn > 0 ? dorm.back : dorm.x + 0.26, len = dorm.x + 0.26 - dorm.back;
      const o = new THREE.Vector3(x0, top + 0.03, dorm.z + sgn * ow).addScaledVector(nrm, 0.02).addScaledVector(up, -0.035);
      const q = new THREE.Vector3();
      layShakes(field, {
        origin: o, alongDir: along, upDir: up, normal: nrm, length: len, height: rl - 0.02,
        w: 0.17 * SH, exposure: 0.105 * SH, size: [0.85, 0.8], rng, lift: 0.013,
        skip: (u, v) => {
          q.copy(o).addScaledVector(along, u).addScaledVector(up, v);
          return shakeTop(q.x) > q.y + 0.1; // under the main roof
        },
        transform: (p) => crook(p),
      });
    }
    // its ridge cap
    for (let x = dorm.back + 0.2; x < dorm.x + 0.26; x += 0.13) {
      for (const sgn of [-1, 1]) {
        const a = 0.75;
        const X = new THREE.Vector3(0, -Math.sin(a), sgn * Math.cos(a));
        const Y = new THREE.Vector3(-1, 0, 0);
        const Z = new THREE.Vector3().crossVectors(X, Y);
        if (Z.y < 0) { X.negate(); Z.negate(); }
        const mm = new THREE.Matrix4().makeBasis(X, Y, Z).multiply(new THREE.Matrix4().makeScale(0.55, 0.42, 1));
        const p = new THREE.Vector3(x + 0.06, dorm.ridge + 0.075, dorm.z + sgn * 0.05);
        if (shakeTop(p.x) > p.y) continue;
        crook(p);
        mm.setPosition(p);
        field.push(mm, col.setRGB(0.72, 0.68, 0.6));
      }
    }
    for (const [mm, c] of shakeQueue) field.push(mm, c);
  }
  // built by the main module once the porch has added its shingles too
  const shingles = {
    field,
    build(parent, material) {
      // (the annex's own riven shakes: no drying checks running across the courses)
      const mesh = field.build(parent, annexShakes(ctx) ?? material, faceAndButt(shingleGeo(0.2 * SH, 0.34 * SH, 0.022)));
      if (mesh) mesh.applyMatrix4(annexMatrix);
      return mesh;
    },
  };

  mark('shingleBits');
  // moss cushions along the eaves, the ridge and on the front verges, and
  // patches creeping up the front two thirds (the back third lies under the
  // oak's moss mantle, see the roots): domed, painted cushions sitting on the
  // shake butts, a few draped over the bargeboards towards the visitor
  const mossVCm = mossVCMaterial(ctx);
  for (const s of [-1, 1]) {
    // a cushion lying on the slope (rotated into the roof plane)
    const lay = (x, z, r, h, sx = 1, sz = 1, sun = 0.6, drape = 0) => {
      const g = paintMoss(mossPadGeo(rng, { r, h, sx, sz, lobes: 1 }), h, { sun, seed: x * 7 + z * 3 });
      if (drape) {
        // the part beyond the verge bends down over the bargeboard
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const zz = pos.getZ(i) + z;
          if (zz > zF - 0.02) {
            const d = zz - (zF - 0.02);
            pos.setXYZ(i, pos.getX(i), pos.getY(i) - d * 1.6, pos.getZ(i) - d * 0.5);
          }
        }
        g.computeVertexNormals();
      }
      const y = roofSurf(Math.abs(x)) + 0.065;
      FR.add(mossVCm, xf(g, [x, y, z], [0, 0, -s * Math.atan(T)]), { cast: false });
    };
    for (let z = zB + 0.1; z < zF; z += rng.range(0.22, 0.45)) {
      if (rng.next() < 0.3) continue;
      lay(s * (eaveX - rng.range(0.1, 0.3)), z, rng.range(0.08, 0.15), rng.range(0.04, 0.06), 0.8, 2.0, 0.5);
    }
    // patches in the damp places, clustered (never sprinkled evenly): the
    // lower courses near the eave, the shaded corner under the verge
    // (more on the left/north side)
    for (let c = 0, nc = s < 0 ? 4 : 2; c < nc; c++) {
      const cx = s * rng.range(1.2, eaveX - 0.35), cz = rng.range(-0.4, zF - 0.5);
      const big = rng.range(0.11, 0.15);
      lay(cx, cz, big, big * 0.55, 1.2, 1.4, s < 0 ? 0.6 : 0.45);
      for (let k = 0, n = count(5, 2); k < n; k++) {
        const a = rng.next() * Math.PI * 2, d = big * rng.range(1.0, 1.9);
        const x = s * THREE.MathUtils.clamp(Math.abs(cx) + Math.cos(a) * d * 0.8, 0.5, eaveX - 0.12);
        lay(x, cz + Math.sin(a) * d * 1.3, big * rng.range(0.45, 0.75), big * 0.4, 1.2, 1.3, s < 0 ? 0.65 : 0.45);
      }
    }
    // along the front verge (the roof edge every spot camera sees)
    for (let i = 0, n = count(7, 4); i < n; i++) {
      const u = (i + 0.3 + rng.next() * 0.4) / n;
      const x = s * (0.45 + u * (eaveX - 0.65));
      const drape = rng.next() < 0.35 ? 1 : 0;
      lay(x, zF - rng.range(0.08, 0.24) + (drape ? 0.12 : 0), rng.range(0.07, 0.13) * (1.2 - u * 0.4), rng.range(0.04, 0.065), 1.1, 1.3, 0.75, drape);
    }
    for (let z = -0.35; z < zF; z += rng.range(0.25, 0.6)) {
      const m = mossGeo(rng, { r: rng.range(0.07, 0.14), h: 0.035, sz: 2 });
      F.add(mats.moss(), xf(m, [s * 0.08, roofSurf(0) + 0.07, z], [0, 0, s * -0.55]), { cast: false });
    }
  }
  // an ivy curtain falling from the left bargeboard over the gable's outer field
  for (let x = -1.9; x > -eaveX + 0.05; x -= rng.range(0.15, 0.26)) {
    const yb = roofSurfAt(-x) + 0.3 * Math.max(0, -x - hx + 0.15) ** 2 - 0.27;
    addIvy(F, mats, rng, [x, yb, zFA + 0.045], [rng.jitter(0.25), -1, 0], { length: rng.range(0.3, 0.75) * (x < -2.6 ? 1.3 : 1), droop: 1, size: 0.07, normal: [0, 0, 1] });
  }

  mark('roofMoss');
  // ── the leaning fieldstone chimney (left slope, near the back) ─────────────
  // Split fieldstone in irregular courses — flat split faces, stones of four
  // sizes, the corners bonded course by course — laid in a pale lime mortar
  // whose joints stay recessed behind the stones; the whole stack leans a
  // little downhill. A Kaminhut on top: a stone slab on four corner stones,
  // soot-blackened underneath and on the top courses, moss on the slab. Lead
  // flashing where it meets the shakes (apron, side flashings, a back cricket).
  const chim = { x: -1.05, z: -1.05 };
  {
    const sm = stepStoneMaterial(ctx);
    const baseY = yRoof(Math.abs(chim.x)) - 0.5;
    const H = apex + 0.92 - baseY;
    const cw = 0.5; // outer width of the stone faces
    const lean = { x: -0.075, z: 0.022 };
    // the stack is built upright in its own frame (origin on its axis at the base), then leaned and placed
    const CM = mat4([chim.x, baseY, chim.z], [lean.z, 0, -lean.x]);
    const tones = ['#8f897c', '#9a9282', '#857f72', '#a1988a', '#7f7a6e', '#968a78', '#8a8576'];
    const soot = new THREE.Color('#2e2924'), tc = new THREE.Color();
    const tone = (geo, base, y0) => {
      const pos = geo.attributes.position;
      const col = new Float32Array(pos.count * 3);
      tc.set(base);
      for (let i = 0; i < pos.count; i++) {
        const y = y0 + pos.getY(i);
        const c = _fc.copy(tc).multiplyScalar(0.92 + noiseB(pos.getX(i) * 7 + y0 * 3, y * 7) * 0.08);
        c.lerp(soot, THREE.MathUtils.smoothstep(y, H - 0.55, H + 0.1) * 0.75);
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return geo;
    };
    /** A split stone: an irregular hexahedron (jittered box corners), its outer face flat. */
    const stone = (w, h, d, j = 0.014) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const pos = g.attributes.position;
      const off = new Map();
      for (let i = 0; i < pos.count; i++) {
        const k = `${Math.sign(pos.getX(i))}|${Math.sign(pos.getY(i))}|${Math.sign(pos.getZ(i))}`;
        if (!off.has(k)) off.set(k, [rng.jitter(j), rng.jitter(j * 0.8), pos.getZ(i) > 0 ? rng.jitter(0.006) : 0]);
        const o = off.get(k);
        pos.setXYZ(i, pos.getX(i) + o[0], pos.getY(i) + o[1], pos.getZ(i) + o[2]);
      }
      g.computeVertexNormals();
      return uvBox(g, 'x', 1.4, [rng.next() * 9, rng.next() * 9]);
    };
    const sizes = LOD.tier === 'low' ? [0.17, 0.24, 0.3] : [0.1, 0.15, 0.2, 0.27];
    const gap = 0.02, sd = 0.09;
    let y = 0, course = 0;
    while (y < H - 0.05) {
      const ch = Math.min(rng.pick([0.09, 0.12, 0.14, 0.17]), H - y);
      for (let face = 0; face < 4; face++) {
        // (the back and the ridge side face no camera: bigger stones there)
        const big = face === 1 || face === 2 ? 1.5 : 1;
        // corner bond: the z faces (0, 2) run over the corners in even courses, the x faces in odd ones
        const over = (face % 2 === 0) === (course % 2 === 0);
        const t0 = -cw / 2 + (over ? 0 : sd + gap * 0.5), t1 = cw / 2 - (over ? 0 : sd + gap * 0.5);
        let t = t0;
        while (t < t1 - 0.04) {
          let w = rng.pick(sizes) * big;
          if (t1 - (t + w) < 0.07) w = t1 - t;
          const a = (face * Math.PI) / 2;
          const nx = Math.sin(a), nz = Math.cos(a), tx = Math.cos(a), tz = -Math.sin(a);
          const tm = t + w / 2, dOut = cw / 2 - sd / 2 + rng.jitter(0.008);
          const g = stone(w - gap, ch - gap, sd);
          xf(g, null, [rng.jitter(0.02), a, rng.jitter(0.03)]);
          g.translate(nx * dOut + tx * tm, y + ch / 2, nz * dOut + tz * tm);
          F.add(sm, tone(g, rng.pick(tones), 0).applyMatrix4(CM));
          t += w;
        }
      }
      y += ch;
      course++;
    }
    // the mortar core: pale lime, its faces 3 cm behind the stones (recessed joints)
    const core = new THREE.BoxGeometry(cw - 0.06, H, cw - 0.06).translate(0, H / 2, 0);
    F.add(sm, tone(uvBox(core, 'y', 1), '#b3aa96', 0).applyMatrix4(CM));
    // the Kaminhut: four corner stones and a slab
    const capY = H;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const g = stone(0.12, 0.13, 0.12, 0.01).translate(sx * (cw / 2 - 0.06), capY + 0.065, sz * (cw / 2 - 0.06));
      F.add(sm, tone(g, rng.pick(tones), 0).applyMatrix4(CM));
    }
    const slab = stone(0.74, 0.07, 0.7, 0.025);
    {
      // soot under the slab, a weathered top
      const pos = slab.attributes.position;
      const col = new Float32Array(pos.count * 3);
      tc.set('#948d7e');
      for (let i = 0; i < pos.count; i++) {
        const c = _fc.copy(tc).lerp(soot, pos.getY(i) < 0 ? 0.7 : 0.15);
        col.set([c.r, c.g, c.b], i * 3);
      }
      slab.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    F.add(sm, slab.translate(0.02, capY + 0.165, -0.01).applyMatrix4(CM));
    F.add(mats.moss(), xf(mossGeo(rng, { r: 0.17, h: 0.055, sx: 1.2 }), [-0.12, capY + 0.2, 0.1]).applyMatrix4(CM), { cast: false });
    // the smoke leaves the gap under the slab
    {
      const p = new THREE.Vector3(0.05, capY + 0.08, 0).applyMatrix4(CM);
      chim.top = annexToWorld(p.x, p.y, p.z);
    }
    // lead flashing where the stack meets the shakes: a lead apron on the downhill
    // side, side flashings, and a little back cricket (saddle) on the uphill side
    {
      const lead = mats.metal('#45484b');
      const U = new THREE.Vector3(cosP, sinP, 0), Nr = new THREE.Vector3(-sinP, cosP, 0), Z = new THREE.Vector3(0, 0, 1);
      const fb = new THREE.Matrix4().makeBasis(U, Nr, Z); // left slope: U up the slope (towards +x), Nr out of it
      const onRoof = (x, z, lift = 0.012) => [x + Nr.x * lift, shakeTop(Math.abs(x)) + Nr.y * lift, z];
      const strip = (x, z, lu, wz, t = 0.006) => {
        const g = new THREE.BoxGeometry(lu, t, wz).applyMatrix4(fb);
        const q = onRoof(x, z);
        F.add(lead, g.translate(q[0], q[1], q[2]), { cast: false });
      };
      const x0 = chim.x - cw / 2, x1 = chim.x + cw / 2, z0 = chim.z - cw / 2, z1 = chim.z + cw / 2;
      // apron (downhill) and its upstand against the stones
      strip(x0 - 0.06, chim.z, 0.16, cw + 0.16);
      F.add(lead, new THREE.BoxGeometry(0.008, 0.09, cw + 0.12).translate(x0 - 0.005, shakeTop(Math.abs(x0)) + 0.04, chim.z), { cast: false });
      // side flashings along both z faces, with their upstands
      for (const [zz, s] of [[z0, -1], [z1, 1]]) {
        strip((x0 + x1) / 2, zz + s * 0.045, (x1 - x0) / cosP + 0.12, 0.1);
        const len = (x1 - x0) / cosP + 0.06;
        F.add(lead, new THREE.BoxGeometry(len, 0.09, 0.008).applyMatrix4(new THREE.Matrix4().makeBasis(U, new THREE.Vector3(0, 1, 0).sub(U.clone().multiplyScalar(U.y)).normalize(), Z)).translate((x0 + x1) / 2, shakeTop(Math.abs((x0 + x1) / 2)) + 0.05, zz + s * 0.006), { cast: false });
      }
      // the back cricket: a little lead-clad saddle shedding water round the uphill face
      {
        const g = new THREE.BoxGeometry(0.3, 0.13, 0.13).rotateX(Math.PI / 4).scale(1, 0.9, 2.6).applyMatrix4(fb);
        const q = onRoof(x1 + 0.13, chim.z, 0.0);
        F.add(lead, g.translate(q[0], q[1], q[2]), { cast: false });
      }
    }
  }
  // the glen's shared soft plume (GPU-animated, tinted by the key light)
  const smoke = makeChimneySmoke(ctx, { position: chim.top, rise: 3.6, wind: [0.9, -0.3] });
  ctx.scene.add(smoke.object);

  mark('chimney');
  // ── ivy & greenery on the walls ────────────────────────────────────────────
  {
    // ivy climbing the front-left corner and hanging from the jetty
    addIvy(front, mats, rng, [0.05, 0.5, 0.04], [0.15, 1, 0], { length: 2.3, droop: -0.5, size: 0.075, normal: [0, 0, 1] });
    addIvy(front, mats, rng, [0.3, 0.45, 0.04], [0.4, 1, 0], { length: 1.4, droop: -0.4, size: 0.07, normal: [0, 0, 1] });
    for (let i = 0; i < 5; i++) {
      const s = rng.range(0.1, 1.5);
      addIvy(front, mats, rng, [s, plateBottom + 0.1, 0.25], [rng.jitter(0.3), -1, 0], { length: rng.range(0.4, 0.9), droop: 1, size: 0.065, normal: [0, 0, 1] });
    }
    addIvy(left, mats, rng, [Dd - 0.1, 0.5, 0.04], [-0.2, 1, 0], { length: 2.0, droop: -0.5, size: 0.075, normal: [0, 0, 1] });
    // the oak side is overgrown
    addIvy(right, mats, rng, [1.8, 0.45, 0.04], [0.1, 1, 0], { length: 2.4, droop: -0.6, size: 0.08, normal: [0, 0, 1] });
    addIvy(right, mats, rng, [3.6, 0.45, 0.04], [-0.3, 1, 0], { length: 2.2, droop: -0.6, size: 0.08, normal: [0, 0, 1] });
  }
  mark('wallIvy');
  // ── built into the roots of the Great Oak ──────────────────────────────────
  // (annex-local; each root starts inside the sculpted bark). The great root
  // leaves the bole high up, arches out over the right eave, lies across the
  // verge and comes down in front of the gable as the porch's right post; a
  // second drapes over the eave further back and runs down the wall into the
  // soil; a fat buttress swallows the back corner (the annex's back tucked
  // under the trunk's flare); two low ones grip the plinth. Moss shells on
  // their backs, moss curtains hanging from the arch, ivy climbing from the
  // great root up the roof to the ridge, ferns and toadstools at their feet.
  {
    const inv = annexMatrix.clone().invert();
    const trunkAt = (azDeg, y, inset) => {
      const a = (azDeg * Math.PI) / 180;
      const w = ctx.oak?.barkPoint
        ? ctx.oak.barkPoint(a, y, -inset)
        : new THREE.Vector3(OAK.x + Math.sin(a) * (oakRadiusAt(y) - inset), y, OAK.z + Math.cos(a) * (oakRadiusAt(y) - inset));
      w.applyMatrix4(inv);
      return [w.x, w.y, w.z];
    };
    const rootMat = rootBarkMaterial(ctx);
    const mossVC = mossVCMaterial(ctx);
    const smooth = THREE.MathUtils.smoothstep;
    const P = ANNEX.rootPost;
    // what lies under a point (annex-local): the main roof, the porch roof or the ground
    const floorAt = (x, z) => {
      let y = 0.3;
      if (Math.abs(x) < eaveX && z > zB && z < zF) y = Math.max(y, roofSurfAt(x) + 0.12 + 0.3 * Math.max(0, Math.abs(x) - hx + 0.15) ** 2);
      const PR = ANNEX.porchRoof;
      if (x > PR.x0 - 0.25 && x < PR.x1 + 0.25 && z > hz && z < hz + PR.depth + 0.36) y = Math.max(y, PR.hi + ((PR.lo - PR.hi) * (z - hz - 0.02)) / PR.depth + 0.14);
      return y;
    };
    const roots = [
      {
        // the great root: bole → arching over the right eave → across the
        // front of the right slope → over the front verge → down in front of
        // the gable's lower right corner (seen against the plaster from every
        // spot camera) → resting on the porch roof's corner → the porch's right post
        id: 'arch',
        pts: [trunkAt(-40, 6.6, 0.65), trunkAt(-38, 6.0, -0.05), [3.62, 5.3, 0.98], [2.95, 4.32, 1.42], [2.36, 3.68, 1.88], [1.98, 4.1, 2.42], [1.76, 4.33, 2.95], [1.82, 3.95, 3.2], [1.95, 3.35, 3.3], [2.18, 2.85, 3.38], [2.58, 2.5, 3.5], [2.96, 2.02, 3.66], [P.x + 0.04, 1.0, P.z - 0.02], [P.x, 0.3, P.z], [P.x + 0.04, -0.25, P.z + 0.08]],
        radius: (t) => 0.32 - 0.14 * t + 0.3 * Math.exp(-t * 7) + 0.08 * smooth(t, 0.88, 1),
        flat: 0.85, tubular: segs(52, 22), radial: segs(12, 8),
        // a younger, smoother, paler grey-brown than the old bole behind it — it
        // reads against the dark trunk as its own arm reaching over the house
        tone: 1.4,
        moss: [0.08, 0.8], cover: 0.72, thick: 0.08,
        // moss down the post's flank that faces the glen (its top is never seen)
        flank: [0.76, 0.98, [0.35, 0.2, 1], 0.42],
        ivy: [0.97, 0.66, [-0.7, 0.1, 1]],
        curtain: [[0.1, 0.36, 12], [0.47, 0.74, 16]],
      },
      {
        // its younger twin from lower on the bole: over the eave's front corner,
        // then wound once round the post's front — braided into it
        id: 'twin',
        pts: [trunkAt(-30, 3.9, 0.5), trunkAt(-29, 3.4, -0.05), [3.78, 2.95, 2.45], [3.42, 2.42, 3.28], [3.32, 1.55, 3.62], [3.18, 0.85, 3.98], [2.92, 0.5, 4.12], [2.76, 0.18, 4.04], [2.72, -0.25, 4.08]],
        radius: (t) => 0.13 + 0.25 * Math.exp(-t * 6) + 0.05 * smooth(t, 0.85, 1),
        flat: 0.85, tubular: segs(34, 14), radial: segs(12, 7),
        tone: 1.32,
        moss: [0.06, 0.55], cover: 0.6,
        flank: [0.55, 0.96, [0.4, 0.1, 1], 0.4],
      },
      {
        // over the roof: from the bole across the right slope behind the
        // dormer, over the ridge, its tip splaying out on the far slope —
        // the tree's hand laid over the house
        id: 'ridge',
        pts: [trunkAt(-63, 6.6, 0.6), trunkAt(-61, 6.0, -0.05), [3.0, 4.15, -0.62], [2.1, 4.02, -0.6], [1.2, 5.06, -0.55], [0.45, 6.18, -0.45], [0.0, 6.64, -0.4], [-0.45, 6.18, -0.33], [-1.0, 5.38, -0.27], [-1.4, 4.8, -0.22]],
        radius: (t) => (0.32 - 0.1 * Math.pow(t, 1.5) + 0.3 * Math.exp(-t * 8)) * (1 - 0.55 * smooth(t, 0.86, 1)),
        flat: 0.85, tubular: segs(44, 18), radial: segs(12, 7),
        tone: 1.3,
        moss: [0.1, 0.95], cover: 0.78, thick: 0.085,
        ivy: [0.3, 0.9, [0.2, 1, 0.5]],
        curtain: [[0.1, 0.3, 8]],
        tips: true,
      },
      {
        // draped over the eave further back, down the wall into the soil
        id: 'drape',
        pts: [trunkAt(-76, 4.5, 0.55), trunkAt(-74, 3.95, -0.04), [3.55, 3.22, -1.58], [3.1, 2.58, -1.46], [3.02, 1.9, -1.36], [3.0, 1.0, -1.26], [3.04, 0.35, -1.16], [3.12, -0.22, -1.04]],
        radius: (t) => 0.12 - 0.03 * t + 0.3 * Math.exp(-t * 8) + 0.05 * smooth(t, 0.85, 1),
        flat: 0.85, tubular: segs(30, 14), radial: segs(12, 7),
        moss: [0.08, 0.45], curtain: [[0.12, 0.3, 6]],
      },
      {
        // a fat buttress swallowing the back corner
        id: 'buttress',
        pts: [trunkAt(-84, 3.1, 0.75), [3.8, 2.55, -2.08], [3.18, 1.85, -2.3], [2.97, 1.0, -2.45], [2.96, 0.25, -2.55], [3.02, -0.25, -2.66]],
        radius: (t) => 0.3 + 0.45 * Math.exp(-t * 4),
        flat: 1.25, tubular: segs(24, 12), radial: segs(14, 8),
        moss: [0.04, 0.5],
      },
      // low roots gripping the plinth: the front corner and the middle of the wall
      { pts: [trunkAt(-40, 1.25, 0.4), [3.42, 0.98, 1.38], [3.05, 0.66, 1.96], [2.97, 0.58, 2.3], [2.98, 0.3, 2.55], [3.02, -0.2, 2.64]], r0: 0.34, r1: 0.09, moss: [0.1, 0.65] },
      { pts: [trunkAt(-62, 0.85, 0.4), [3.36, 0.98, -0.32], [3.03, 0.66, 0.04], [3.07, 0.38, 0.38], [3.22, -0.18, 0.6]], r0: 0.28, r1: 0.07, moss: [0.1, 0.6] },
    ];
    // the root post and its twin stand outside the annex's collider: keep walkers off them
    {
      const rp = annexToWorld(P.x + 0.06, 0, P.z + 0.06);
      ctx.colliders?.addCircle?.(rp.x, rp.z, 0.32, 'schreinerei-root-post');
    }
    const built = {};
    for (const r of roots) {
      const flat = r.flat ?? 0.85;
      const { geo, curve, radiusAt } = rootGeo(rng, r.pts, { r0: r.r0, r1: r.r1, radius: r.radius, flat, radial: r.radial ?? segs(12, 7), tubular: r.tubular ?? segs(24, 12) });
      if (r.tone) {
        // paler and a touch greyer than the bole's bark
        const ca = geo.attributes.color.array;
        for (let i = 0; i < ca.length; i += 3) {
          const l = (ca[i] + ca[i + 1] + ca[i + 2]) / 3;
          for (let k = 0; k < 3; k++) ca[i + k] = (ca[i + k] * 0.82 + l * 0.18) * r.tone;
        }
      }
      F.add(rootMat, geo);
      if (r.id) built[r.id] = { curve, radiusAt, flat };
      // the tip splays into thin rootlets gripping the shakes
      if (r.tips) {
        const c = new THREE.Vector3(), tg = new THREE.Vector3();
        curve.getPointAt(0.97, c);
        curve.getTangentAt(0.97, tg);
        for (let k = 0; k < 3; k++) {
          const spread = (k - 1) * 0.55 + rng.jitter(0.15);
          const dx = tg.x * Math.cos(spread) - tg.z * Math.sin(spread), dz = tg.x * Math.sin(spread) + tg.z * Math.cos(spread);
          const pts = [];
          for (let i = 0; i <= 3; i++) {
            const u = (i / 3) * rng.range(0.4, 0.6);
            const x = c.x + dx * u, z = c.z + dz * u;
            // hug the left slope (the rootlets run down it)
            pts.push([x, roofSurfAt(Math.abs(x)) + 0.09 - u * 0.05, z]);
          }
          F.add(rootMat, rootGeo(rng, pts, { r0: 0.045, r1: 0.014, flat: 0.8, radial: 6, tubular: 8 }).geo);
        }
      }
      // a moss shell over its back: lumpy cushions with a broken, fuzzy rim
      if (r.moss) {
        const cap = mossCapGeo(rng, curve, radiusAt, { flat, t0: r.moss[0], t1: r.moss[1], cover: r.cover ?? 0.5, thick: r.thick ?? 0.045, radial: segs(10, 6), tubular: segs(20, 10) });
        F.add(mossVC, cap, { cast: false });
      }
      // … and down the flank of its upright stretch
      if (r.flank) {
        const [fa, fb, side, cover] = r.flank;
        const cap = mossCapGeo(rng, curve, radiusAt, { flat, t0: fa, t1: fb, cover, thick: 0.05, side, radial: segs(8, 5), tubular: segs(12, 6) });
        F.add(mossVC, cap, { cast: false });
      }
      // ivy climbing it: short runs that follow the root's surface on one side
      if (r.ivy) {
        const [ia, ib, sd] = r.ivy;
        const side = new THREE.Vector3(sd[0], sd[1], sd[2]).normalize();
        const c = new THREE.Vector3(), tg = new THREE.Vector3(), n = new THREE.Vector3();
        const runs = Math.max(2, Math.round(Math.abs(ib - ia) * 12 * Math.sqrt(LOD.k)));
        for (let i = 0; i < runs; i++) {
          const t = ia + ((ib - ia) * (i + rng.next() * 0.4)) / runs;
          curve.getPointAt(t, c);
          curve.getTangentAt(t, tg);
          if (ib < ia) tg.negate();
          n.copy(side).addScaledVector(tg, -tg.dot(side)).normalize();
          const rr = radiusAt(t) * 0.98;
          const st = [c.x + n.x * rr, c.y + n.y * rr * flat, c.z + n.z * rr];
          addIvy(F, mats, rng, st, [tg.x, tg.y, tg.z], { length: 0.42, droop: -0.2, size: 0.075, normal: [n.x, n.y, n.z], density: 1.1 });
        }
      }
      // moss curtains hanging from the underside of its arch (never through the roofs below)
      for (const [ta, tb, n] of r.curtain ?? []) {
        const c = new THREE.Vector3();
        for (let i = 0, nn = count(n, 3); i < nn; i++) {
          const t = ta + (tb - ta) * (i + rng.next()) / nn;
          curve.getPointAt(t, c);
          const rr = radiusAt(t) * flat * 0.8;
          const x0 = c.x + rng.jitter(rr * 0.5), z0 = c.z + rng.jitter(rr * 0.5), y0s = c.y - rr;
          const room = y0s - floorAt(x0, z0);
          if (room < 0.15) continue;
          const len = Math.min(room, rng.range(0.25, 0.8) * (0.6 + 0.4 * Math.sin(((i + 0.5) / nn) * Math.PI)));
          const sway = rng.jitter(0.06);
          const pts = [];
          for (let k = 0; k <= 4; k++) {
            const u = k / 4;
            pts.push([x0 + sway * u * u, y0s - len * u, z0 + rng.jitter(0.015) + sway * 0.5 * u]);
          }
          const strand = tube(pts, 0.016, 4, 6);
          // taper to a wisp
          const pos = strand.attributes.position;
          for (let v = 0; v < pos.count; v++) {
            const k = THREE.MathUtils.clamp((y0s - pos.getY(v)) / len, 0, 1);
            const cx = x0 + sway * k * k, cz = z0 + sway * 0.5 * k;
            const f = 1 - 0.75 * k;
            pos.setX(v, cx + (pos.getX(v) - cx) * f);
            pos.setZ(v, cz + (pos.getZ(v) - cz) * f);
          }
          strand.computeVertexNormals();
          // olive where it hangs from the root, paler, greyer wisps at the tips
          const sc = new Float32Array(pos.count * 3), tc = new THREE.Color(), tip = new THREE.Color('#a4a986');
          for (let v = 0; v < pos.count; v++) {
            const k = THREE.MathUtils.clamp((y0s - pos.getY(v)) / len, 0, 1);
            mossTone(0.55 - 0.25 * k, tc).lerp(tip, k * 0.6);
            sc[v * 3] = tc.r;
            sc[v * 3 + 1] = tc.g;
            sc[v * 3 + 2] = tc.b;
          }
          strand.setAttribute('color', new THREE.BufferAttribute(sc, 3));
          F.add(mossVC, strand, { cast: false });
        }
      }
    }
    // ivy climbing from the great root up the right slope to the ridge (and a
    // runner along the root itself)
    {
      const arch = built.arch;
      const c = new THREE.Vector3(), tng = new THREE.Vector3();
      arch.curve.getPointAt(0.46, c);
      const nrm = [sinPA, cosPA, 0];
      addIvy(FR, mats, rng, [c.x - 0.2, roofSurfAt(c.x - 0.2) + 0.08, c.z - 0.15], [-cosPA, sinPA, -0.3], { length: 3.0, droop: 0, size: 0.085, normal: nrm });
      addIvy(FR, mats, rng, [c.x - 0.18, roofSurfAt(c.x - 0.18) + 0.08, c.z + 0.2], [-cosPA, sinPA, 0.1], { length: 1.6, droop: 0, size: 0.08, normal: nrm });
      arch.curve.getPointAt(0.2, c);
      arch.curve.getTangentAt(0.2, tng);
      const r = arch.radiusAt(0.2) * arch.flat;
      const up = new THREE.Vector3(0, 1, 0).addScaledVector(tng, -tng.y).normalize();
      addIvy(F, mats, rng, [c.x + up.x * r, c.y + up.y * r, c.z + up.z * r], [tng.x, tng.y, tng.z], { length: 1.6, droop: 0.1, size: 0.075, normal: [up.x, up.y, up.z], density: 0.9 });
      // moss cushions where the root rests on the shakes
      for (const t of [0.42, 0.46, 0.5]) {
        arch.curve.getPointAt(t, c);
        const x = c.x - arch.radiusAt(t) - rng.range(0.02, 0.1);
        FR.add(mossVC, xf(paintMoss(mossPadGeo(rng, { r: rng.range(0.1, 0.16), h: 0.06, sx: 1.4, sz: 1, lobes: 1 }), 0.06, { sun: 0.8, seed: t * 9 }), [x, roofSurfAt(x) + 0.06, c.z + rng.jitter(0.1)], [0, 0, -Math.atan(T)]), { cast: false });
      }
    }
    // the oak's moss and ivy spilling over the ridge: a blanket of cushions
    // thickest on the right slope's upper courses behind the dormer, crowding
    // over the ridge and thinning out down the left slope; ivy runners from the
    // oak side across the ridge and down the far slope
    {
      const n = count(15, 8);
      for (let i = 0; i < n; i++) {
        const u = rng.next();
        // across the ridge: x from the right slope (+1.3) to the left (−0.9), denser near the ridge
        const x = 1.3 - 2.2 * Math.pow(u, 0.8) + rng.jitter(0.08);
        const z = rng.range(zB + 0.15, -0.35) + (x < 0 ? rng.range(0, 0.4) : 0);
        if (x < -0.15 && rng.next() < 0.35 + Math.abs(x) * 0.4) continue;
        const sd = x >= 0 ? 1 : -1;
        const r = rng.range(0.1, 0.19) * (x < 0 ? 0.8 : 1);
        const h = r * rng.range(0.6, 0.9);
        const g = paintMoss(mossPadGeo(rng, { r, h, sx: rng.range(1.0, 1.4), sz: rng.range(1.0, 1.5), lobes: 1 }), h, { sun: x < 0 ? 0.6 : 0.45, seed: x * 5 + z });
        const ax = Math.abs(x);
        FR.add(mossVC, xf(g, [x, roofSurfAt(Math.max(ax, 0.12)) + 0.08 + (ax < 0.15 ? 0.04 : 0), z], [0, rng.jitter(0.4), -sd * Math.atan(T) * Math.min(1, ax / 0.15)]), { cast: false });
      }
      // ivy over the ridge and down the left slope
      const nl = [-sinPA, cosPA, 0];
      for (const z of [-2.3, -1.75, -0.95]) {
        addIvy(FR, mats, rng, [-0.04, roofSurfAt(0.04) + 0.14, z + rng.jitter(0.1)], [-cosPA, -sinPA, rng.jitter(0.25)], { length: rng.range(0.9, 1.5), droop: 0, size: 0.08, normal: nl });
      }
    }
    // the moss mantle: over the back third of the roof the oak's moss has
    // grown into one thick, lumpy carpet across both slopes and the ridge — it
    // reaches furthest forward on the oak side, its front edge lobed and
    // broken (thinning to nothing and dipping under the shakes), and it
    // spills over the back verge
    {
      const nx = segs(40, 16), nz = segs(14, 6);
      const xs = [];
      for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        xs.push(-eaveX - 0.02 + u * (2 * eaveX + 0.04));
      }
      if (!xs.some((x) => Math.abs(x) < 1e-3)) xs.push(0);
      xs.sort((a, b) => a - b);
      const zEdge = (x) => -0.95 + 0.42 * smooth(x, -1.2, 1.4) + 0.2 * noiseA(x * 1.6 + 3.1, 0.7) + 0.08 * noiseB(x * 4.3, 1.9);
      const z0 = zB - 0.16;
      const pos = [], col = [], idx = [];
      const tcm = new THREE.Color();
      const rows = nz + 2;
      for (let j = 0; j <= rows; j++) {
        for (const x of xs) {
          const ax = Math.abs(x);
          const ze = zEdge(x);
          // rows: the drape over the back verge, then back edge → front edge
          const z = j === 0 ? z0 : zB + ((ze + 0.08 - zB) * (j - 1)) / rows;
          const e = smooth(ze - z, -0.02, 0.3);
          const lump = 0.55 + 0.45 * noiseA(x * 2.3 + 11, z * 2.3) + 0.3 * noiseB(x * 6.1, z * 6.1 - 4) + 0.25 * noiseA(x * 11 - 3, z * 11);
          const th = (0.06 + 0.07 * (1 - smooth(ax, 0.0, 0.6))) * Math.max(0.15, lump) * e;
          let y = roofSurfAt(Math.max(ax, 0.02)) + 0.072 + th - (1 - e) * 0.03 + (ax < 0.1 ? 0.035 * (1 - ax / 0.1) : 0);
          if (j === 0) y -= 0.22; // hanging over the back bargeboard
          pos.push(x, y, z);
          const k = THREE.MathUtils.clamp((th / 0.11) * (x < 0 ? 0.85 : 0.65) + noiseB(x * 3 + 5, z * 3) * 0.25 + 0.05 - (1 - e) * 0.2, 0, 1);
          mossTone(k, tcm);
          col.push(tcm.r, tcm.g, tcm.b);
        }
      }
      const cols = xs.length;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const a = j * cols + i, b = a + 1, c2 = a + cols, d = c2 + 1;
          idx.push(a, c2, b, b, c2, d);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      uvBox(g, 'y', 2);
      FR.add(mossVC, g, { cast: false });
      // domed cushions crowding along its front edge, so the edge is a
      // broken line of moss, not a cut sheet
      for (let x = -eaveX + 0.15; x < eaveX - 0.1; x += rng.range(0.18, 0.32)) {
        const ax = Math.abs(x), r = rng.range(0.08, 0.15), h = r * rng.range(0.55, 0.85);
        const z = zEdge(x) + rng.range(-0.05, 0.12);
        const g2 = paintMoss(mossPadGeo(rng, { r, h, sx: rng.range(1.0, 1.4), sz: rng.range(0.8, 1.2), lobes: 1 }), h, { sun: x < 0 ? 0.65 : 0.45, seed: x * 3 });
        FR.add(mossVC, xf(g2, [x, roofSurfAt(Math.max(ax, 0.12)) + 0.075, z], [0, rng.jitter(0.5), -Math.sign(x) * Math.atan(T) * Math.min(1, ax / 0.15)]), { cast: false });
      }
    }
    // the right side sits sunk into the oak's root slope: a mossy bank of
    // earth and roots rises against the wall, burying the plinth and the sill
    // (deepest at the back, fading out towards the porch), the low roots
    // and ferns growing out of it
    {
      const nzs = segs(30, 12), nns = segs(10, 6);
      const pos = [], col = [], idx = [];
      const tcm = new THREE.Color(), soil = new THREE.Color('#4d3b29');
      for (let j = 0; j <= nzs; j++) {
        const z = 2.2 - (j / nzs) * 5.15;
        for (let i = 0; i <= nns; i++) {
          const n = -0.08 + (i / nns) * 1.45;
          const x = hx + n;
          const y = bermY(x, z) - (i === 0 ? 0.02 : 0) - (i === nns ? 0.03 : 0);
          pos.push(x, y, z);
          const k = THREE.MathUtils.clamp(0.35 + 0.35 * noiseA(x * 3 + 7, z * 3) + 0.2 * (1 - n), 0, 1);
          mossTone(k, tcm);
          // bare soil peeping out on the steep foot of the bank
          tcm.lerp(soil, THREE.MathUtils.clamp((noiseB(x * 5, z * 5 + 3) - 0.25) * 2, 0, 0.6) * smooth(n, 0.5, 1.1));
          col.push(tcm.r, tcm.g, tcm.b);
        }
      }
      const cols = nns + 1;
      for (let j = 0; j < nzs; j++) {
        for (let i = 0; i < nns; i++) {
          const a = j * cols + i, b = a + 1, c2 = a + cols, d = c2 + 1;
          idx.push(a, b, c2, b, d, c2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      uvBox(g, 'y', 2);
      F.add(mossVC, g, { cast: false });
    }
    // ferns and toadstools at the roots' feet, growing out of the bank
    addFern(F, ctx, rng, 3.3, bermY(3.3, 1.9) - 0.04, 1.9, { size: 0.42, fronds: 7 });
    addFern(F, ctx, rng, 3.55, bermY(3.55, 0.9) - 0.04, 0.9, { size: 0.5, fronds: 7 });
    addFern(F, ctx, rng, 3.45, bermY(3.45, -1.2) - 0.04, -1.2, { size: 0.45, fronds: 6 });
    addFern(F, ctx, rng, P.x + 0.32, 0, P.z + 0.22, { size: 0.36, fronds: 6 });
    for (let i = 0; i < 4; i++) {
      const x = 3.12 + rng.jitter(0.1), z = 2.72 + rng.jitter(0.1);
      addToadstool(F, mats, rng, x, bermY(x, z) - 0.01, z, { size: rng.range(0.05, 0.09), color: i % 2 ? '#b98a4e' : '#c9352a' });
    }
    for (let i = 0; i < 3; i++) {
      const x = 3.4 + rng.jitter(0.08), z = 0.62 + rng.jitter(0.1);
      addToadstool(F, mats, rng, x, bermY(x, z) - 0.01, z, { size: rng.range(0.05, 0.08), color: '#b98a4e' });
    }
    for (let i = 0; i < 3; i++) addToadstool(F, mats, rng, P.x + 0.22 + rng.jitter(0.06), 0, P.z + 0.12 + rng.jitter(0.08), { size: rng.range(0.05, 0.08), color: i ? '#b98a4e' : '#c9352a' });
    for (let i = 0; i < 3; i++) {
      const x = 3.6 + rng.jitter(0.08), z = -2.2 + rng.jitter(0.1);
      addToadstool(F, mats, rng, x, bermY(x, z) - 0.01, z, { size: rng.range(0.05, 0.08), color: '#b98a4e' });
    }
  }

  mark('roots');
  // ── an ivy curtain from the oak over the right eave and verge ──────────────
  {
    const kickAt = (x) => 0.3 * Math.max(0, Math.abs(x) - hx + 0.15) ** 2;
    const eaveTipY = (z) => roofSurfAt(eaveXAt) + kickAt(eaveXAt) - 0.03;
    // a runner from the trunk across to the eave …
    addIvy(F, mats, rng, [3.95, 2.75, -0.2], [-1, -0.25, 0.15], { length: 1.0, droop: 0.25, size: 0.08, normal: [0, 0, 1] });
    // … along the right slope just above the eave …
    addIvy(FR, mats, rng, [eaveXAt - 0.22, roofSurfAt(eaveXAt - 0.22) + 0.06, -2.0], [0, 0, 1], { length: 3.6, droop: 0, size: 0.085, normal: [sinPA, cosPA, 0] });
    // … falling over the eave edge
    for (let z = -2.1; z < zFA - 0.1; z += rng.range(0.32, 0.55)) {
      addIvy(F, mats, rng, [eaveXAt + 0.04, eaveTipY(z), z], [0, -1, rng.jitter(0.3)], { length: rng.range(0.3, 0.85), droop: 1, size: 0.075, normal: [1, 0, 0] });
    }
    // and from the front verge (the right bargeboard), short over the porch roof
    for (let x = 1.95; x < eaveXAt; x += rng.range(0.16, 0.28)) {
      const yb = roofSurfAt(x) + kickAt(x) - 0.27;
      const free = x > ANNEX.porchRoof.x1 + 0.22;
      const len = free ? rng.range(0.45, 1.0) : Math.max(0.12, Math.min(0.55, yb - 2.42));
      addIvy(F, mats, rng, [x, yb, zFA + 0.045], [rng.jitter(0.25), -1, 0], { length: len, droop: 1, size: 0.07, normal: [0, 0, 1] });
    }
  }

  mark('eaveIvy');
  // ── weathering: algae streaks under the sills & in the splash zone, cracks ─
  {
    const dm = decalMaterial();
    const streak = (wall, s, yTop, w, h, color = '#66704f', up = false) => {
      const g = decalGeo(w, h, DECAL.streak);
      if (up) g.rotateZ(Math.PI);
      wall.add(dm, xf(g, [s, yTop - h / 2, -0.0195]), { color, cast: false });
    };
    // under the window sills (W1 has its flower box: the drips start below it)
    streak(front, (W1[0] + W1[1]) / 2 - 0.2, W1[2] - 0.25, 0.5, 0.3);
    streak(front, (W1[0] + W1[1]) / 2 + 0.35, W1[2] - 0.25, 0.4, 0.26);
    streak(front, (W2[0] + W2[1]) / 2, W2[2] - 0.05, 0.6, 0.35);
    streak(left, 2.2, 1.08, 0.8, 0.34);
    // soft green-grey drips under the gable's window-sill rail, the plate ends and the vents
    for (const [a, b] of GW) streak(gable, (a + b) / 2, GF.sillRail - 0.05, 0.55, 0.3, '#6f7860');
    streak(gable, 1.62, GF.plate - 0.07, 0.3, 0.42, '#6f7860');
    for (const sx of [-GF.vent, GF.vent]) streak(gable, sx, 4.37, 0.18, 0.22, '#6f7860');
    streak(gable, GF.spall[0], GF.spall[1] - 0.07, 0.24, 0.16, '#7a7258');
    // the splash zone above the sill beam: greenish, rising from the bottom
    for (const [s0, s1] of [[0.1, door.s0 - 0.15], [door.s1 + 0.15, L - 0.1]]) {
      for (let x = s0 + 0.2; x < s1 - 0.1; x += rng.range(0.35, 0.55)) streak(front, x, sillTop + 0.3, rng.range(0.4, 0.6), 0.3, '#5d6a4c', true);
    }
    for (let x = 0.3; x < Dd - 0.2; x += rng.range(0.45, 0.7)) streak(left, x, sillTop + 0.28, 0.5, 0.28, '#5d6a4c', true);
    // hairline cracks in the plaster, running off the corners of the openings
    const crack = (wall, s, y, len, ang) => {
      wall.add(dm, xf(decalGeo(len, len * 0.22, DECAL.crack), [s, y, -0.0195], [0, 0, ang]), { color: '#6b5a49', cast: false });
    };
    crack(front, W1[1] + 0.02, W1[3] - 0.08, 0.32, 0.7);
    crack(front, W1[0] + 0.12, W1[2] - 0.2, 0.26, -0.5);
    crack(front, W2[1] + 0.06, W2[2] - 0.12, 0.28, -0.6);
    crack(front, door.s1 + 0.3, door.top + 0.22, 0.3, 0.3);
    crack(gable, GF.spall[0] - 0.05, GF.spall[1] + 0.13, 0.16, 1.1);
    crack(gable, 0.35, 4.62, 0.24, -0.8);
    crack(gable, -1.2, 4.24, 0.18, 2.6);
    crack(left, 0.6, 1.5, 0.3, 0.9);
  }

  mark('weathering');
  // moss on the plinth stones & toadstools at the foot of the walls
  for (let i = 0, n = count(26, 12); i < n; i++) {
    const side = rng.int(0, 3);
    let x, z;
    const t = rng.next();
    if (side === 0) {
      x = -hx + t * A.width;
      z = hz + 0.1;
      if (x + hx > door.s0 - 0.1 && x + hx < door.s1 + 0.1) continue;
    } else if (side === 1) {
      x = hx + 0.1;
      z = hz - t * Dd;
      if (bermY(x, z) > plinth - 0.05) continue; // (under the root bank)
    } else if (side === 2) {
      x = hx - t * A.width;
      z = -hz - 0.1;
    } else {
      x = -hx - 0.1;
      z = -hz + t * Dd;
    }
    F.add(mats.moss(), xf(mossGeo(rng, { r: rng.range(0.08, 0.2), h: 0.05 }), [x, plinth - 0.01, z]), { cast: false });
    if (rng.next() < 0.45) F.add(mats.moss(), xf(mossGeo(rng, { r: rng.range(0.15, 0.3), h: 0.07 }), [x * 1.02, 0, z * 1.02]), { cast: false });
    if (rng.next() < 0.35) addToadstool(F, mats, rng, x * 1.04 + rng.jitter(0.1), 0, z * 1.04 + rng.jitter(0.1), { size: rng.range(0.07, 0.12), color: rng.pick(['#c9352a', '#c9352a', '#b98a4e']) });
  }

  mark('plinthMoss');
  // ── the double door: open leaves + threshold ───────────────────────────────
  {
    const dw = (door.s1 - door.s0) / 2;
    // each leaf is built extending from its hinge (x = 0) towards the opening (dir = +1 left leaf, −1 right leaf)
    // the right leaf swings right round (beyond square) so the lit shop shows
    // from the spot camera; both are plain oiled oak, not the painted frame
    const leafWood = mats.timber();
    for (const [dir, ang] of [[1, 1.42], [-1, 2.25]]) {
      const leaf = new Batch();
      for (let k = 0; k < 5; k++) {
        const pw = dw / 5;
        leaf.add(leafWood, xf(board(pw - 0.008, door.top - 0.03, 0.05, { along: 'y', rng, scale: 1 / 1.6 }), [dir * pw * (k + 0.5), (door.top + 0.03) / 2, 0]));
      }
      for (const y of [0.3, door.top - 0.3]) leaf.add(leafWood, xf(board(dw - 0.06, 0.12, 0.035, { along: 'x', rng, scale: 1 / 1.6 }), [dir * dw / 2, y, -0.04]));
      const bl = Math.hypot(dw - 0.12, door.top - 0.72);
      leaf.add(leafWood, xf(board(bl, 0.11, 0.03, { along: 'x', rng }), [dir * dw / 2, door.top / 2, -0.04], [0, 0, dir * Math.atan2(door.top - 0.72, dw - 0.12)]));
      for (const y of [0.3, door.top - 0.3]) {
        leaf.add(mats.metal('#2f2b28'), xf(new THREE.BoxGeometry(dw * 0.75, 0.045, 0.012), [dir * dw * 0.375, y, 0.032]), { cast: false });
        leaf.add(mats.metal('#2f2b28'), xf(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), [0, y, 0.0]), { cast: false });
      }
      // a ring handle on the free edge
      leaf.add(mats.metal('#2f2b28'), xf(new THREE.TorusGeometry(0.05, 0.01, 4, 12), [dir * (dw - 0.12), 1.0, 0.04]), { cast: false });
      const m = new THREE.Matrix4();
      const hingeX = dir > 0 ? door.s0 - hx : door.s1 - hx;
      // opened outwards: the free edge swings towards +z
      m.compose(new THREE.Vector3(hingeX, 0.075, hz + 0.03), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -dir * ang, 0)), new THREE.Vector3(1, 1, 1));
      for (const e of leaf.lists.values()) for (const geo of e.geos) F.add(e.material, geo.applyMatrix4(m), { cast: e.cast });
      leaf.lists.clear();
    }
    // the plinth stops at the opening: an oak threshold (Schwelle) laid flush
    // with the workshop floor, worn into two shallow dips where the
    // Leiterwägeli's wheels run in, two pale wheel tracks and a fan of sawdust
    // on the floor behind it. Outside, the yard's flagged apron (yard.js) lies
    // a couple of centimetres lower — an easy roll in for a handcart.
    {
      const cx = (door.s0 + door.s1) / 2 - hx, dwid = door.s1 - door.s0;
      const sill = board(dwid + 0.1, 0.07, 0.3, { along: 'x', rng, r: 0.02 });
      deform(sill, (v) => {
        if (v.y > 0) v.y -= 0.012 * (Math.exp(-((v.x + 0.32) ** 2) / 0.012) + Math.exp(-((v.x - 0.32) ** 2) / 0.012)) + 0.008 * Math.exp(-(v.x * v.x) / 0.2);
      });
      F.add(mats.wood('#9a7a55'), xf(sill, [cx, ANNEX.floor - 0.035, hz - 0.03]));
      // two pale wheel tracks and the sawdust, inside on the floor
      const dm = decalMaterial();
      for (const s of [-1, 1]) F.add(dm, xf(decalGeo(0.07, 0.62, DECAL.streak).rotateX(-Math.PI / 2), [cx + s * 0.32, ANNEX.floor + 0.002, hz - 0.45]), { color: '#d9c6a0', cast: false });
      F.add(dm, xf(decalGeo(0.9, 0.55, DECAL.blob).rotateX(-Math.PI / 2), [cx + 0.1, ANNEX.floor + 0.003, hz - 0.42], [0, 0.3, 0]), { color: '#e2c792', cast: false });
    }
  }

  mark('doorLeaves');
  const winMatRef = windowMaterial();
  // ── interior (seen through the open door) ──────────────────────────────────
  const interior = buildInterior(ctx, F, mats, rng);
  mark('interior');
  // warm light inside, spilling out of the door and windows (budgeted)
  const light = ctx.lights?.addPoint?.(annexToWorld(-0.6, 1.6, 0.8), { color: '#ffb866', day: 1.2, night: 7, distance: 7 });
  // the closed workshop gets no sun: neither the key light nor its canopy
  // flecks reach inside the walls (the instanced shakes and the thin wall
  // batches are kept out of the shadow pass, so the shadow map alone lets
  // dapples onto the floor boards). The room's interior box, inner wall faces
  // to the ceiling, centred a little towards the oak for the frame's lean.
  ctx.lights?.addIndoorVolume?.(new THREE.Box3(new THREE.Vector3(-hx + 0.24, ANNEX.floor, -hz + 0.2), new THREE.Vector3(hx - 0.17, plateBottom + 0.12, hz - 0.17)), { matrix: annexMatrix });

  // a glow halo in each window at night
  for (const [x, y, z, sz] of [[W1[0] + 0.65 - hx, 1.65, hz + 0.25, 0.95], [W2[0] + 0.5 - hx, 1.5, hz + 0.25, 0.7], [-0.85, 3.5, gz + 0.2, 0.8], [0.85, 3.5, gz + 0.2, 0.8], [dorm.x + 0.12, (dorm.yb + dorm.top) / 2, dorm.z, 0.42]]) {
    pushHalo(annexToWorld(x, y, z), sz);
  }

  return {
    group,
    shingles,
    smoke,
    interior,
    light,
    update(dt, t) {
      smoke.update(dt, t);
      const n = ctx.env?.night ?? 0;
      winMatRef.emissiveIntensity = WIN_DAY + (WIN_NIGHT - WIN_DAY) * n;
    },
    anchors: { chimneyTop: chim.top },
    cost,
  };
}

/**
 * Workshop interior (seen through the open double door): a bright spruce back
 * wall with a dense shadow board (frame saw, hand saws, chisels, brace,
 * hammers, squares …) and a shelf of planes, a rack of F-clamps, a band saw in
 * the back-left corner, an older second bench as the glue-up station (a
 * dovetailed carcass in red clamps, a half-assembled drawer), shavings on the
 * floor, boards leaning on the side wall and a low enamel lamp over it all.
 */
function buildInterior(ctx, F, mats, rng) {
  const { hx, hz, floor } = ANNEX;
  const z0 = -0.55; // the interior partition (the back is storage under the roots)
  const ix0 = -hx + 0.16, ix1 = hx - 0.16;
  const vc = mats.vc();
  // a Schreiner's tools are his pride: clean, bright steel, no rust
  const steel = brightSteel(ctx);
  // floor planks
  for (let x = ix0; x < ix1; x += 0.2) {
    const w = Math.min(0.2, ix1 - x) - 0.008;
    F.add(mats.wood('oak'), xf(board(w, 0.05, hz - z0, { along: 'z', rng }), [x + w / 2, floor - 0.025, (hz + z0) / 2]), { cast: false });
  }
  // back partition: pale spruce boards — a bright wall behind the work
  for (let x = ix0; x < ix1; x += 0.24) {
    F.add(mats.wood('spruce'), xf(board(0.235, 2.3, 0.04, { along: 'y', rng }), [x + 0.12, floor + 1.15, z0]), { color: rng.pick(['#e2cfa6', '#d9c49a', '#e8d6b0']) });
  }
  // inner faces of the side walls & ceiling joists near the door
  for (const s of [-1, 1]) F.add(mats.plaster(), xf(new THREE.BoxGeometry(0.04, 2.3, hz - z0), [s * (hx - 0.17), floor + 1.15, (hz + z0) / 2]), { cast: false });
  for (let x = ix0 + 0.3; x < ix1; x += 0.85) F.add(mats.timber(), xf(board(0.12, 0.14, hz - z0 + 0.2, { along: 'z', rng }), [x, ANNEX.plateBottom + 0.07, (hz + z0) / 2]), { cast: false });
  F.add(mats.wood('spruce'), xf(new THREE.BoxGeometry(ix1 - ix0, 0.03, hz - z0), [0, ANNEX.plateBottom + 0.15, (hz + z0) / 2]), { cast: false });

  // everything in the shop is at the villagers' scale (the glue-up bench's top
  // at 0.44, the porch Hobelbank's at ~0.47): a frame that scales a group of
  // parts about a pivot (annex-local, before the crook)
  const Fscaled = (k, px, py, pz) => {
    const m = new THREE.Matrix4().makeTranslation(px, py, pz).multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(new THREE.Matrix4().makeTranslation(-px, -py, -pz));
    return { add: (mat, geo, opts) => F.add(mat, geo.applyMatrix4(m), opts) };
  };
  // ── the shadow board (painted panel) with its tools ───────────────────────
  // (at villager scale: the board's middle at ~0.86, just above the bench,
  // left of the carcass; the saws as long as the porch tools)
  const sbx = -0.85, sby = 0.86, sbw = 2.0, sbh = 0.92;
  const zt = z0 + 0.07;
  {
  // eslint-disable-next-line no-shadow
  const F = Fscaled(0.62, sbx, sby, z0);
  F.add(vc, xf(rbox(sbw, sbh, 0.03, 0.01), [sbx, sby, z0 + 0.04]), { color: '#3d5a48' });
  // a frame saw with curved arms and its twisted cord
  addBowSaw(F, mats, rng, mat4([sbx - 0.7, sby + 0.04, zt]), { scale: 0.82 });
  // two hand saws, handle up: wide heel tapering to the toe, closed handles
  cleanHandSaw(F, mats, steel, mat4([sbx - 0.3, sby + 0.36, zt], [0, 0, -Math.PI / 2]), { len: 0.5, wood: '#5c4334' });
  cleanHandSaw(F, mats, steel, mat4([sbx - 0.08, sby + 0.36, zt + 0.004], [0, 0, -Math.PI / 2]), { len: 0.44, wood: '#9c5a43' });
  const fine = LOD.tier !== 'low'; // (low tier: the shadow board keeps its saws only)
  // a brace (Bohrwinde): head, crank, chuck
  if (fine) {
    const bx = sbx + 0.16, by = sby + 0.05;
    const crank = [[bx, by + 0.2, zt], [bx, by + 0.12, zt], [bx + 0.09, by + 0.08, zt + 0.01], [bx + 0.09, by - 0.04, zt + 0.01], [bx, by - 0.08, zt], [bx, by - 0.16, zt]];
    F.add(steel, tube(crank, 0.008, 5, 18), { cast: false });
    F.add(mats.wood('#9c5a43'), xf(turned([[0, 0], [0.035, 0.0], [0.04, 0.025], [0.02, 0.045], [0, 0.045]]), [bx, by + 0.2, zt]), { cast: false });
    F.add(mats.wood('#9c5a43'), xf(new THREE.CylinderGeometry(0.018, 0.018, 0.07, 8), [bx + 0.09, by + 0.02, zt + 0.01]), { cast: false });
    F.add(steel, xf(new THREE.CylinderGeometry(0.016, 0.01, 0.06, 8), [bx, by - 0.19, zt]), { cast: false });
  }
  // hammers: a Swiss joiner's hammer and a claw hammer, heads on pegs
  for (const [hx2, w] of fine ? [[sbx + 0.36, 0.1], [sbx + 0.46, 0.12]] : []) {
    F.add(mats.wood('ash'), xf(new THREE.CylinderGeometry(0.011, 0.013, 0.28, 6), [hx2, sby + 0.08, zt]), { cast: false });
    F.add(brightSteel(ctx, '#7d838a'), xf(new THREE.BoxGeometry(w, 0.026, 0.024), [hx2, sby + 0.23, zt + 0.005]), { cast: false });
  }
  // squares (a try square and a big framing square), a sliding bevel, dividers
  if (fine) F.add(mats.wood('walnut'), xf(board(0.035, 0.26, 0.02, { along: 'y' }), [sbx + 0.62, sby + 0.18, zt]), { cast: false });
  F.add(steel, xf(new THREE.BoxGeometry(0.2, 0.026, 0.004), [sbx + 0.72, sby + 0.06, zt]), { cast: false });
  F.add(steel, xf(new THREE.BoxGeometry(0.03, 0.4, 0.004), [sbx + 0.9, sby + 0.12, zt]), { cast: false });
  if (fine) F.add(steel, xf(new THREE.BoxGeometry(0.26, 0.03, 0.004), [sbx + 0.78, sby - 0.07, zt]), { cast: false });
  if (LOD.small) for (const s of [-1, 1]) F.add(steel, xf(new THREE.BoxGeometry(0.008, 0.2, 0.006), [sbx + 0.6 + s * 0.025, sby - 0.22, zt], [0, 0, s * 0.14]), { cast: false });
  // files & rasps, screwdrivers with turned handles (the tiniest decor: high tier only)
  for (let i = 0; i < (LOD.small ? 3 : 0); i++) {
    const x = sbx + 0.36 + i * 0.05;
    F.add(mats.metal('#55595e'), xf(new THREE.BoxGeometry(0.016, 0.2, 0.006), [x, sby - 0.2, zt]), { cast: false });
    F.add(mats.wood('#b07a48'), xf(new THREE.CylinderGeometry(0.012, 0.014, 0.07, 6), [x, sby - 0.06, zt]), { cast: false });
  }
  for (let i = 0; i < (LOD.small ? 3 : 0); i++) {
    const x = sbx + 0.08 + i * 0.06;
    F.add(steel, xf(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 4), [x, sby - 0.28, zt]), { cast: false });
    F.add(mats.wood(['#c4372a', '#e8c22a', '#9c5a43'][i]), xf(new THREE.CylinderGeometry(0.014, 0.012, 0.08, 6), [x, sby - 0.18, zt]), { cast: false });
  }
  // a row of chisels in a rack
  F.add(mats.wood('oak'), xf(board(0.66, 0.05, 0.06, { along: 'x', rng }), [sbx - 0.6, sby - 0.3, zt + 0.02]), { cast: false });
  for (let i = 0, n = fine ? count(8, 4) : 0; i < n; i++) {
    const x = sbx - 0.88 + i * (0.56 / (n - 1));
    F.add(mats.wood('ash'), xf(new THREE.CylinderGeometry(0.014, 0.012, 0.12, 6), [x, sby - 0.22, zt + 0.02]), { cast: false });
    F.add(steel, xf(new THREE.BoxGeometry(0.012 + (i % 3) * 0.006, 0.12, 0.004), [x, sby - 0.34, zt + 0.02]), { cast: false });
  }
  // a shelf of hand planes above the board, jars & an oil can at its end
  F.add(mats.wood('oak'), xf(board(1.9, 0.035, 0.18, { along: 'x', rng }), [sbx, sby + sbh / 2 + 0.06, z0 + 0.1]), { cast: false });
  for (let i = 0; i < 6; i++) {
    const len = [0.26, 0.2, 0.42, 0.16, 0.22, 0.3][i];
    const x = sbx - 0.78 + i * 0.28;
    F.add(mats.wood('beech'), xf(board(len, 0.06, 0.06, { along: 'x', rng }), [x, sby + sbh / 2 + 0.11, z0 + 0.1]), { cast: false });
    F.add(mats.wood('beech'), xf(new THREE.SphereGeometry(0.025, 6, 4), [x + len * 0.35, sby + sbh / 2 + 0.15, z0 + 0.1]), { cast: false });
  }
  for (let i = 0; i < 3; i++) F.add(vc, xf(new THREE.CylinderGeometry(0.035, 0.035, 0.09, 8), [sbx + 0.88 - i * 0.08, sby + sbh / 2 + 0.12, z0 + 0.1]), { color: rng.pick(['#8a5a3b', '#c9a26b', '#5c3d27']), cast: false });

  }

  // ── a rack of F-clamps on the back wall, right of the board ──────────────
  {
    const rx0 = 0.78, rx1 = 1.95, ry = 1.72;
    // eslint-disable-next-line no-shadow
    const F = Fscaled(0.64, (rx0 + rx1) / 2, 0.02, z0);
    F.add(mats.wood('oak'), xf(board(rx1 - rx0 + 0.1, 0.06, 0.07, { along: 'x', rng }), [(rx0 + rx1) / 2, ry, z0 + 0.06]));
    const cols = ['#c4372a', '#c4372a', '#3f6f9a', '#c4372a', '#d9a441', '#c4372a', '#3f6f9a', '#c4372a', '#c4372a'];
    const nClamps = LOD.tier === 'low' ? 5 : cols.length;
    for (let i = 0; i < nClamps; i++) {
      const x = rx0 + (i / (nClamps - 1)) * (rx1 - rx0);
      const len = [0.6, 0.48, 0.8, 0.6, 0.4, 0.7, 0.55, 0.48, 0.62][i];
      // hung by the fixed jaw over the rail: bar down, jaws towards the wall
      addFClamp(F, mats, mat4([x, ry + 0.064 - len, z0 + 0.13], [0, Math.PI / 2, 0]), { len, reach: 0.1, color: cols[i], open: 0.3 + (i % 3) * 0.12 });
    }
  }
  // a lumber rack along the left wall: three battens with cantilevered arms,
  // boards of the shop's woods stored flat on them (oak, walnut, cherry,
  // spruce, ash), a few short offcuts on the bottom arms
  {
    const wx = -hx + 0.19;
    const levels = LOD.tier === 'low' ? [0.62] : [0.34, 0.66, 0.98];
    const posts = [-0.32, 0.55, 1.42];
    for (const z of posts) {
      F.add(mats.wood('#8a6a48'), xf(board(0.05, 1.12, 0.07, { along: 'y', rng }), [wx + 0.025, floor + 0.58, z]));
      for (const y of levels) F.add(mats.wood('#8a6a48'), xf(board(0.3, 0.035, 0.045, { along: 'x', rng }), [wx + 0.17, floor + y, z], [0, 0, 0.06]));
    }
    const woods = ['oak', 'walnut', 'cherry', 'spruce', 'ash', 'oak', 'maple', 'walnut'];
    for (const y of levels) {
      let x = wx + 0.06;
      for (let k = 0; k < 3 + (y > 0.5 ? 1 : 0) && x < wx + 0.3; k++) {
        const bw = rng.range(0.05, 0.09), bt = rng.pick([0.018, 0.025, 0.032]);
        const len = rng.range(1.5, 2.05), zc = 0.55 + rng.jitter(0.12);
        F.add(mats.wood(rng.pick(woods)), xf(board(bw, bt, len, { along: 'z', rng }), [x + bw / 2, floor + y + 0.035 + bt / 2 + 0.012, zc], [0, rng.jitter(0.02), 0]));
        x += bw + 0.008;
      }
    }
  }

  // ── a band saw in the back-left corner (cast-iron frame, two wheel housings) ─
  // clean machine-grey enamel on the castings, a brass maker's badge on the
  // upper wheel housing, a bright ground table and blade
  // (scaled to the villagers: its table ~5 cm above the glue-up bench's top)
  {
    const bx = -1.86, bz = z0 + 0.3;
    // eslint-disable-next-line no-shadow
    const F = Fscaled(0.57, bx, floor, bz);
    const cast = (geo, opts = {}) => F.add(vc, geo, { color: '#6f7a83', ...opts });
    const darkC = (geo) => F.add(vc, geo, { color: '#2a2e32', cast: false });
    cast(xf(rbox(0.5, 0.62, 0.42, 0.03), [bx, floor + 0.31, bz]));
    darkC(xf(new THREE.BoxGeometry(0.52, 0.05, 0.44), [bx, floor + 0.02, bz]));
    cast(xf(rbox(0.11, 1.0, 0.14, 0.02), [bx - 0.2, floor + 1.05, bz]));
    const wheel = new THREE.CylinderGeometry(0.25, 0.25, 0.14, segs(22, 12));
    wheel.rotateX(Math.PI / 2);
    cast(xf(wheel.clone(), [bx - 0.02, floor + 1.55, bz]));
    // a raised rim round the housing door and the hub
    if (LOD.tier !== 'low') cast(xf(new THREE.TorusGeometry(0.24, 0.012, 4, 22), [bx - 0.02, floor + 1.55, bz + 0.072]), { cast: false });
    F.add(vc, xf(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10).rotateX(Math.PI / 2), [bx - 0.02, floor + 1.55, bz]), { color: '#4a5056', cast: false });
    // the maker's badge on the base: a brass oval with a red enamel name strip
    if (LOD.small) F.add(mats.metal('#c9a04a'), xf(new THREE.CylinderGeometry(0.075, 0.075, 0.008, 16).rotateX(Math.PI / 2).scale(1, 0.55, 1), [bx - 0.04, floor + 0.47, bz + 0.214]), { cast: false });
    if (LOD.small) {
      F.add(vc, xf(new THREE.BoxGeometry(0.11, 0.024, 0.004), [bx - 0.04, floor + 0.47, bz + 0.219]), { color: '#a8261c', cast: false });
      F.add(vc, xf(new THREE.BoxGeometry(0.075, 0.006, 0.003), [bx - 0.04, floor + 0.47, bz + 0.2215]), { color: '#f0e2b0', cast: false });
    }
    // the table on its trunnion, the blade guard and the blade
    F.add(brightSteel(ctx, '#c7cdd2'), xf(new THREE.BoxGeometry(0.46, 0.035, 0.44), [bx + 0.02, floor + 0.86, bz + 0.02]), { cast: false });
    darkC(xf(new THREE.BoxGeometry(0.1, 0.18, 0.1), [bx + 0.02, floor + 0.74, bz]));
    cast(xf(new THREE.BoxGeometry(0.04, 0.42, 0.05), [bx + 0.1, floor + 1.1, bz + 0.03]), { cast: false });
    F.add(brightSteel(ctx, '#e8ecef'), xf(new THREE.BoxGeometry(0.004, 0.36, 0.012), [bx + 0.1, floor + 0.98, bz + 0.065]), { cast: false });
    // a switch box and an offcut on the table
    darkC(xf(new THREE.BoxGeometry(0.08, 0.1, 0.05), [bx + 0.27, floor + 0.55, bz + 0.12]));
    F.add(vc, xf(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 8).rotateX(Math.PI / 2), [bx + 0.27, floor + 0.57, bz + 0.15]), { color: '#c4271c', cast: false });
    F.add(mats.wood('cherry'), xf(board(0.2, 0.04, 0.08, { along: 'x', rng }), [bx + 0.06, floor + 0.9, bz + 0.1], [0, 0.4, 0]), { cast: false });
  }

  // ── the glue-up station: an older bench with a carcass in clamps ─────────
  {
    const bx = -0.3, bz = z0 + 0.42, top = 0.44; // lower than the porch Hobelbank
    const oldTop = mats.wood('#b8956c');
    F.add(oldTop, xf(board(1.7, 0.07, 0.5, { along: 'x', rng }), [bx, floor + top - 0.035, bz]));
    for (const s of [-1, 1]) {
      for (const t of [-1, 1]) F.add(mats.wood('#7a5539'), xf(board(0.07, top - 0.07, 0.07, { along: 'y', rng }), [bx + s * 0.72, floor + (top - 0.07) / 2, bz + t * 0.17]));
      F.add(mats.wood('#7a5539'), xf(board(0.08, 0.06, 0.48, { along: 'z', rng }), [bx + s * 0.72, floor + 0.03, bz]));
    }
    F.add(mats.wood('#7a5539'), xf(board(1.4, 0.06, 0.05, { along: 'x', rng }), [bx, floor + 0.14, bz]));
    // the older second Hobelbank: a front vise with a wooden spindle and
    // Knebel, a tail-vise block at the right end, a dog row and a tool tray
    const viseW = mats.wood('#a87d55');
    F.add(viseW, xf(board(0.22, 0.18, 0.05, { along: 'x', rng }), [bx - 0.65, floor + top - 0.09, bz + 0.28]));
    F.add(viseW, xf(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 10).rotateX(Math.PI / 2), [bx - 0.65, floor + top - 0.1, bz + 0.36]));
    F.add(viseW, xf(new THREE.CylinderGeometry(0.01, 0.01, 0.26, 6), [bx - 0.65, floor + top - 0.16, bz + 0.43], [0, 0, 0.3]));
    F.add(viseW, xf(board(0.22, 0.11, 0.3, { along: 'x', rng }), [bx + 0.95, floor + top - 0.045, bz + 0.08]));
    F.add(viseW, xf(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 10).rotateZ(Math.PI / 2), [bx + 1.13, floor + top - 0.06, bz + 0.08]));
    F.add(viseW, xf(new THREE.CylinderGeometry(0.01, 0.01, 0.26, 6), [bx + 1.21, floor + top - 0.12, bz + 0.08], [0.25, 0, 0]));
    for (let i = 0; i < 9; i++) F.add(vc, xf(new THREE.BoxGeometry(0.022, 0.004, 0.03), [bx - 0.4 + i * 0.13, floor + top + 0.001, bz + 0.19]), { color: '#24170e', cast: false });
    F.add(mats.wood('#9c7a55'), xf(board(1.6, 0.02, 0.12, { along: 'x', rng }), [bx, floor + top - 0.05, bz - 0.2]), { cast: false });
    // the carcass: a small oak cabinet with through dovetails, glued up in clamps
    const cx = bx + 0.28, cz = bz - 0.02, cw = 0.64, ch = 0.46, cd = 0.3, t = 0.024;
    const y0 = floor + top;
    const oak = mats.wood('#96714a');
    F.add(oak, xf(board(t, ch, cd, { along: 'y', rng, r: 0.004 }), [cx - cw / 2 + t / 2, y0 + ch / 2, cz]));
    F.add(oak, xf(board(t, ch, cd, { along: 'y', rng, r: 0.004 }), [cx + cw / 2 - t / 2, y0 + ch / 2, cz]));
    F.add(oak, xf(board(cw, t, cd, { along: 'x', rng, r: 0.004 }), [cx, y0 + ch - t / 2, cz]));
    F.add(oak, xf(board(cw, t, cd, { along: 'x', rng, r: 0.004 }), [cx, y0 + t / 2, cz]));
    F.add(mats.wood('#c2a37a'), xf(board(cw - 2 * t, ch - 2 * t, 0.008, { along: 'x', rng }), [cx, y0 + ch / 2, cz - cd / 2 + 0.006]), { cast: false });
    // the dovetails: darker end-grain tails on the sides, pins on the top
    for (const s of LOD.tier === 'low' ? [] : [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const z = cz - cd / 2 + 0.035 + k * ((cd - 0.07) / 3);
        const tail = new THREE.Shape([new THREE.Vector2(-0.014, 0), new THREE.Vector2(0.014, 0), new THREE.Vector2(0.02, t), new THREE.Vector2(-0.02, t)]);
        for (const [yy, flip] of [[y0 + ch - t, 1], [y0, -1]]) {
          const g = new THREE.ShapeGeometry(tail);
          if (flip < 0) g.rotateZ(Math.PI).translate(0, t, 0);
          F.add(vc, xf(g, [cx + s * (cw / 2 + 0.0008), yy, z], [0, s * Math.PI / 2, 0]), { color: '#6e5236', cast: false });
          // and the tail's end grain on the top/bottom face
          F.add(vc, xf(new THREE.PlaneGeometry(t, 0.03), [cx + s * (cw / 2 - t / 2), flip > 0 ? y0 + ch + 0.0008 : y0 + 0.0008, z], [-Math.PI / 2, 0, 0]), { color: '#7d5f40', cast: false });
        }
      }
    }
    // a glue squeeze-out line and the white glue bottle with its orange cap
    F.add(vc, xf(new THREE.BoxGeometry(cw - 0.06, 0.004, 0.004), [cx, y0 + ch - t - 0.002, cz + cd / 2 - 0.004]), { color: '#f4efe2', cast: false });
    F.add(vc, xf(new THREE.CylinderGeometry(0.022, 0.024, 0.085, 10), [bx - 0.2, y0 + 0.043, bz + 0.12]), { color: '#f2f0ea', cast: false });
    F.add(vc, xf(new THREE.ConeGeometry(0.015, 0.035, 8), [bx - 0.2, y0 + 0.1, bz + 0.12]), { color: '#e8772e', cast: false });
    // two clamps across the top (jaws down the sides), one across the front at the bottom
    const clampLen = cw + 0.2;
    const openK = (clampLen - 0.017 - cw - 0.03) / clampLen;
    for (const dz of [cd / 2 - 0.05, -cd / 2 + 0.05]) {
      addFClamp(F, mats, mat4([cx - clampLen / 2 - 0.0, y0 + ch + 0.012 + 0.11, cz + dz], [0, 0, -Math.PI / 2]), { len: clampLen, reach: 0.12, color: '#c4372a', open: openK });
    }
    addFClamp(F, mats, mat4([cx - clampLen / 2, y0 + 0.08, cz + cd / 2 + 0.11], [Math.PI / 2, 0, -Math.PI / 2]), { len: clampLen, reach: 0.12, color: '#3f6f9a', open: openK });
    // two more pressing the top onto the sides, upright on the front
    for (const dx of [-cw / 2 + 0.04, cw / 2 - 0.04]) {
      addFClamp(F, mats, mat4([cx + dx, y0 - 0.02, cz + cd / 2 + 0.03], [0, -Math.PI / 2, 0]), { len: ch + 0.14, reach: 0.1, color: '#c4372a', open: 0.08 });
    }
    // the half-assembled dovetailed drawer: front with one side on, the other side waiting
    {
      const dx = bx - 0.52, dz = bz - 0.05;
      const cherry = mats.wood('cherry');
      F.add(cherry, xf(board(0.34, 0.11, 0.02, { along: 'x', rng, r: 0.003 }), [dx, y0 + 0.055, dz + 0.1]));
      F.add(cherry, xf(board(0.015, 0.11, 0.26, { along: 'z', rng, r: 0.003 }), [dx - 0.16, y0 + 0.055, dz - 0.03]));
      for (let k = 0; k < 3; k++) F.add(vc, xf(new THREE.PlaneGeometry(0.012, 0.022), [dx - 0.1675 - 0.0008, y0 + 0.02 + k * 0.035, dz + 0.09], [0, -Math.PI / 2, 0]), { color: '#5e3424', cast: false });
      // the loose side, its tails cut, lying flat
      F.add(cherry, xf(board(0.26, 0.015, 0.11, { along: 'x', rng, r: 0.003 }), [dx + 0.08, y0 + 0.0075, dz - 0.1], [0, 0.25, 0]));
    }
  }

  // the glue stove (Leimofen) at the bench's left end: a little cast-iron
  // stove with an ember glow in its door, the hide-glue pot (Leimtopf) in its
  // water bath on top, a brush standing in it, amber drips down its side
  {
    const gx = -1.42, gz = z0 + 0.5;
    const iron = mats.metal('#2b2826');
    F.add(iron, xf(new THREE.CylinderGeometry(0.085, 0.095, 0.22, segs(12, 8)), [gx, floor + 0.11, gz]));
    F.add(iron, xf(new THREE.CylinderGeometry(0.1, 0.1, 0.02, segs(12, 8)), [gx, floor + 0.225, gz]), { cast: false });
    for (const a of [0.6, 2.7, 4.8]) F.add(iron, xf(new THREE.CylinderGeometry(0.008, 0.01, 0.06, 4), [gx + Math.cos(a) * 0.08, floor + 0.01, gz + Math.sin(a) * 0.08], [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3]), { cast: false });
    F.add(mats.glow('#ffc46e', 0.4), xf(new THREE.PlaneGeometry(0.06, 0.035), [gx + 0.02, floor + 0.08, gz + 0.093], [0, 0.2, 0]), { cast: false, receive: false });
    // the water bath and the glue pot in it
    F.add(mats.metal('#6b6f73'), xf(new THREE.CylinderGeometry(0.07, 0.065, 0.07, segs(12, 8), 1, true), [gx, floor + 0.27, gz]), { cast: false });
    F.add(mats.clay('#7a4a2a'), xf(new THREE.CylinderGeometry(0.048, 0.044, 0.08, segs(12, 8), 1, true), [gx, floor + 0.3, gz]), { cast: false });
    F.add(vc, xf(new THREE.CircleGeometry(0.046, segs(12, 8)), [gx, floor + 0.325, gz], [-Math.PI / 2, 0, 0]), { color: '#a8661c', cast: false });
    F.add(mats.wood('ash'), xf(new THREE.CylinderGeometry(0.006, 0.007, 0.15, 6), [gx + 0.02, floor + 0.37, gz - 0.01], [0.1, 0, -0.32]), { cast: false });
    F.add(vc, xf(new THREE.CylinderGeometry(0.012, 0.01, 0.03, 6), [gx + 0.004, floor + 0.315, gz - 0.006], [0.1, 0, -0.32]), { color: '#3a2a1c', cast: false });
    for (let k = 0; k < 3; k++) {
      const a = 0.6 + k * 0.5;
      F.add(vc, xf(new THREE.SphereGeometry(0.008, 5, 4), [gx + Math.cos(a) * 0.049, floor + 0.29 - k * 0.012, gz + Math.sin(a) * 0.049], null, [1, 2.4, 1]), { color: '#b5702a', cast: false });
    }
  }
  // a treadle grindstone (Schleifstein) by the clamp rack: a sandstone wheel
  // in a trough on a little trestle, the crank and a water can beside it
  if (LOD.tier !== 'low') {
    const gx = 0.86, gz = z0 + 0.42, wy = floor + 0.33;
    const frame = mats.wood('#7a5539');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.add(frame, xf(board(0.035, 0.24, 0.035, { along: 'y', rng }), [gx + sx * 0.12, floor + 0.12, gz + sz * 0.1], [sz * 0.08, 0, -sx * 0.08]));
    F.add(frame, xf(board(0.3, 0.07, 0.2, { along: 'x', rng }), [gx, floor + 0.235, gz]));
    F.add(vc, xf(new THREE.CylinderGeometry(0.15, 0.15, 0.05, segs(20, 12)).rotateX(Math.PI / 2).rotateY(Math.PI / 2), [gx, wy, gz]), { color: '#b9a98a' });
    F.add(steel, xf(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 6).rotateZ(Math.PI / 2), [gx, wy, gz]), { cast: false });
    F.add(steel, xf(board(0.012, 0.09, 0.012, { along: 'y' }), [gx + 0.13, wy - 0.045, gz]), { cast: false });
    F.add(mats.wood('ash'), xf(new THREE.CylinderGeometry(0.01, 0.01, 0.06, 6).rotateZ(Math.PI / 2), [gx + 0.16, wy - 0.09, gz]), { cast: false });
    F.add(mats.metal('#6b6f73'), xf(new THREE.CylinderGeometry(0.035, 0.04, 0.09, 10), [gx - 0.22, floor + 0.045, gz + 0.12]), { cast: false });
  }
  // boards leaning against the right wall (different species, stickers between)
  {
    const species = ['oak', 'walnut', 'cherry', 'maple', 'spruce', 'ash', 'oak'];
    for (let i = 0; i < species.length; i++) {
      const h = rng.range(1.6, 2.1);
      const z = 0.0 + i * 0.13;
      F.add(mats.wood(species[i]), xf(board(0.03, h, 0.12 + rng.range(0, 0.08), { along: 'y', rng }), [hx - 0.32 - i * 0.02, floor + h / 2 * Math.cos(0.18), z], [0, 0, 0.18 + rng.jitter(0.04)]));
    }
  }
  // soft sawdust drifting into the corners and round the bench and machine
  // legs, small curls (oak and spruce, the two woods on the go) under the bench
  {
    const dm = decalMaterial();
    const drifts = [[-1.86, z0 + 0.62, 0.7, 0.45], [-0.3, z0 + 0.72, 1.1, 0.5], [-1.05, z0 + 0.3, 0.6, 0.35], [-2.3, z0 + 0.25, 0.5, 0.4], [0.6, z0 + 0.4, 0.6, 0.4], [-0.6, 0.9, 0.7, 0.45]];
    for (const [x, z, w, d] of drifts) {
      F.add(dm, xf(decalGeo(w, d, DECAL.blob).rotateX(-Math.PI / 2), [x, floor + 0.004, z], [0, rng.jitter(0.6), 0]), { color: rng.pick(['#e2c792', '#dcc08c', '#e8d4a8']), cast: false });
    }
    for (let k = 0, n = count(6, 3); k < n; k++) {
      F.add(dm, xf(decalGeo(rng.range(0.5, 0.8), rng.range(0.35, 0.5), DECAL.specks).rotateX(-Math.PI / 2), [rng.range(-2.2, 1.2), floor + 0.005, rng.range(z0 + 0.2, hz - 0.3)], [0, rng.next() * 6, 0]), { color: '#e6d0a0', cast: false });
    }
    const sg = doubleFace(shavingGeo(0.032, 0.02, 1.3));
    const tones = ['#c99c63', '#bd8f58', '#e6d3a4', '#ddc690'];
    for (let i = 0, n = count(22, 8); i < n; i++) {
      const a = rng.next() * Math.PI * 2, u = Math.sqrt(rng.next());
      const x = -0.3 + Math.cos(a) * 0.75 * u, z = z0 + 0.7 + Math.sin(a) * 0.32 * u;
      F.add(mats.wood('maple'), xf(sg.clone(), [x, floor + 0.012 + (1 - u) * 0.015, z], [rng.next() * 6, rng.next() * 6, rng.next() * 6], rng.range(0.5, 0.8)), { color: rng.pick(tones), cast: false });
    }
  }
  // a low enamel lamp over the glue-up (glows through the door)
  {
    const lx = -0.3, ly = 1.42, lz = 0.05;
    const enamel = mats.metal('#2f5a46');
    F.add(mats.metal('#2f2b28'), xf(new THREE.CylinderGeometry(0.004, 0.004, ANNEX.plateBottom + 0.15 - ly - 0.05, 3), [lx, (ANNEX.plateBottom + 0.15 + ly + 0.05) / 2, lz]), { cast: false });
    F.add(enamel, xf(new THREE.ConeGeometry(0.17, 0.12, 16, 1, true), [lx, ly, lz]), { cast: false });
    F.add(vc, xf(doubleFace(new THREE.ConeGeometry(0.162, 0.114, 16, 1, true)), [lx, ly - 0.002, lz]), { color: '#f4ecd8', cast: false, receive: false });
    F.add(mats.glow('#fff1c4', 1.5, 4), xf(new THREE.SphereGeometry(0.045, 8, 6), [lx, ly - 0.05, lz]), { cast: false, receive: false });
    pushHalo(annexToWorld(lx, ly - 0.06, lz), 0.5);
  }
  return { z0 };
}
