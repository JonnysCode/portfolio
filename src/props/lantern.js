// ─────────────────────────────────────────────────────────────────────────────
// Lanterns & lamp posts — the village's night lights. An iron frame (corner
// posts, rails, cage bars) holds four panes of candle-lit amber glass
// (lanternGlassMaterial: a candle and its flame drawn in the glass, lit in the
// lamplighter cascade) plus a soft additive halo (glow.js).
//
//   makeLantern({ color, frame, hanging, halo })   ~0.5 tall
//   lanternGlassMaterial(color) + lanternPanes({ half, y0, y1 })  the candle-lit
//       glass for lanterns built elsewhere (bridge, door, porch …)
//   makeLampPost({ color, height, style: 'hook' | 'top' })   ~2.6 tall
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { palette } from '../core/palette.js';
import { Parts, cached, xf, strut, groupFor, opt, shade, defineLayer } from './util.js';
import { sharedUniforms } from '../core/materials.js';
import { LAMP_GLSL, lampUniforms, isWarmLight } from './lamplighter.js';
import { makeGlowSprite } from './glow.js';
import { registerAnimated, propsSettings } from './ticker.js';
import { createRng } from '../core/rng.js';

// ── candle-lit glass ─────────────────────────────────────────────────────────
// The glass is never a flat glowing block: a fragment shader draws what you
// would see through amber glass with a candle inside — deep amber at the
// corners and under the roof, warmer where the flame lights the pane, the
// cream wax candle and a small teardrop flame with a hot yellow-white core
// that sways and breathes (and holds still under reduced motion). The flame sits in the
// lantern's middle: each pane looks along the view ray to the mid plane
// (parallax), so seen across a corner both panes show the SAME flame. Only the
// flame's core crosses the night bloom threshold — the panes stay amber, the
// iron frame and cage bars in front of them stay dark. The night part follows
// the lamplighter cascade like every other lamp (lamplighter.js).
//
// Pane geometry carries uv = (across the pane, up) in units of half the glass
// width, 0 at the pane's centre (see GLASS below).
const GLASS = { half: 0.07, y0: 0.045, y1: 0.295, cy: 0.17 };
/** Blackened iron: the frame must stay dark against the lit glass and its halo. */
const IRON = '#3b3633';
const FLAME = { y: -0.28, up: 0.7, down: 0.2, w: 0.3, waxTop: -0.52, waxW: 0.2 };

const _hsl = { h: 0, s: 0, l: 0 };
const _c = new THREE.Color();
/** Linear-RGB colour of hue/sat/light (sRGB HSL) × intensity. */
function hslLin(h, s, l, k) {
  _c.setHSL(h, s, l, THREE.SRGBColorSpace);
  return new THREE.Vector3(_c.r * k, _c.g * k, _c.b * k);
}

/** Candle palette (linear, absolute night intensities) for a glass colour: warm colours become amber candlelight, others keep their hue. */
function candlePalette(color) {
  new THREE.Color(color).getHSL(_hsl, THREE.SRGBColorSpace);
  const warm = isWarmLight(color);
  const h = warm ? THREE.MathUtils.clamp(_hsl.h > 0.95 ? 0.07 : _hsl.h, 0.065, 0.088) : _hsl.h;
  const s = warm ? 0.95 : Math.max(_hsl.s, 0.6);
  return {
    deep: hslLin(h - 0.015, s, 0.36, 0.45),
    mid: hslLin(h - 0.005, s, 0.56, 0.8),
    flame: hslLin(h + 0.03, 1, 0.62, 1.6),
    core: hslLin(0.125, 1, 0.86, 2.0),
    wax: hslLin(0.1, 0.55, 0.78, 0.55),
    day: '#' + new THREE.Color().setHSL(h, s * 0.75, 0.42, THREE.SRGBColorSpace).getHexString(),
  };
}

const f4 = (x) => x.toFixed(4);
function patchCandle(shader, own) {
  Object.assign(shader.uniforms, lampUniforms, own, { uNight: sharedUniforms.uNight });
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aLampDelay;\nvarying vec3 vLampWP;\nvarying float vLampDelay;\nvarying vec2 vCandle;')
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec4 lampWP = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        lampWP = instanceMatrix * lampWP;
      #endif
      vLampWP = (modelMatrix * lampWP).xyz;
      vLampDelay = aLampDelay;
      vCandle = uv;`
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
      ${LAMP_GLSL}
      uniform float uNight;
      uniform float uGlowDay;
      uniform float uGlowNight;
      uniform vec3 uDeep, uMid, uFlame, uCore, uWax;
      varying vec3 vLampWP;
      varying float vLampDelay;
      varying vec2 vCandle;`
    )
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        // the view ray through this pane meets the lantern's mid plane at q
        vec3 cV = normalize(vViewPosition);
        vec3 cN = normalize(vNormal);
        vec3 cU = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vec3 cT = normalize(cross(cU, cN));
        float vn = max(dot(cV, cN), 0.2);
        vec2 q = vCandle - vec2(dot(cV, cT), dot(cV, cU)) / vn;
        float ph = dot(vLampWP, vec3(0.9, 0.5, 0.7));
        float fx = uLampFx;
        float t = uLampTime;
        // the flame: a teardrop above the wick that sways and breathes
        float fy = q.y - ${f4(FLAME.y)};
        float sway = fx * (sin(t * 5.3 + ph * 7.0) * 0.6 + sin(t * 8.9 + ph * 3.0) * 0.4) * 0.07 * clamp(fy + 0.15, 0.0, 1.0);
        float qx = q.x - sway;
        float fh = fy > 0.0 ? ${f4(FLAME.up)} : ${f4(FLAME.down)};
        float fw = ${f4(FLAME.w)} * (1.0 - 0.6 * clamp(fy / ${f4(FLAME.up)}, 0.0, 1.0));
        float flame = exp(-(qx * qx) / (fw * fw) - (fy * fy) / (fh * fh));
        float cy = fy + 0.06;
        float core = exp(-(qx * qx) / (fw * fw * 0.22) - (cy * cy) / (fh * fh * 0.16));
        float breathe = 1.0 + fx * 0.1 * sin(t * 11.0 + ph * 5.0) * sin(t * 6.1 + ph);
        // the candle under it: cream wax, lit from the top, a dark wick
        float wax = (1.0 - smoothstep(${f4(FLAME.waxW)} - 0.04, ${f4(FLAME.waxW)}, abs(q.x))) * (1.0 - smoothstep(${f4(FLAME.waxTop)} - 0.03, ${f4(FLAME.waxTop)}, q.y));
        float waxLit = 0.3 + 0.7 * smoothstep(-1.8, ${f4(FLAME.waxTop)}, q.y);
        float wick = (1.0 - smoothstep(0.02, 0.05, abs(q.x))) * step(${f4(FLAME.waxTop)} - 0.02, q.y) * step(q.y, ${f4(FLAME.waxTop + 0.12)});
        // the amber pane, lit by the flame: warm around it, deep in the corners and under the roof
        vec2 g = vec2(vCandle.x, (vCandle.y - ${f4(FLAME.y)}) * (vCandle.y > ${f4(FLAME.y)} ? 0.75 : 0.95));
        float lit = exp(-dot(g, g));
        vec3 e = mix(uDeep, uMid, lit);
        e = mix(e, uWax * waxLit, wax * (1.0 - wick * 0.85));
        e += (uFlame * flame + uCore * core) * breathe;
        totalEmissiveRadiance = e * (uGlowDay + (uGlowNight - uGlowDay) * uNight * lampOn(vLampWP, vLampDelay));
      }`
    );
}

const glassMats = new Map();
/**
 * The candle-lit lantern glass (MeshStandard + the shader above), cached per
 * colour and day / night intensity (× the candle palette); never mutate it.
 * Geometry needs the pane uv (lanternGeos) and may carry 'aLampDelay'.
 */
export function lanternGlassMaterial(color = palette.windowGlow, { day = 0.3, night = 1 } = {}) {
  const key = `${new THREE.Color(color).getHexString()}|${day}|${night}`;
  let m = glassMats.get(key);
  if (m) return m;
  const pal = candlePalette(color);
  m = new THREE.MeshStandardMaterial({ color: pal.day, emissive: '#ffffff', emissiveIntensity: 1, roughness: 0.45 });
  m.name = 'props-lantern-glass';
  const own = {
    uGlowDay: { value: day },
    uGlowNight: { value: night },
    uDeep: { value: pal.deep },
    uMid: { value: pal.mid },
    uFlame: { value: pal.flame },
    uCore: { value: pal.core },
    uWax: { value: pal.wax },
  };
  m.onBeforeCompile = (shader) => patchCandle(shader, own);
  m.customProgramCacheKey = () => 'props-lantern-glass';
  m.userData.lamp = { day, night };
  glassMats.set(key, m);
  return m;
}

/**
 * The four panes of a square lantern (a BufferGeometry with the pane uv the
 * candle shader needs), for lanterns built elsewhere: draw it with
 * lanternGlassMaterial(color) and put the lantern's own frame / cage bars in
 * front of it. half = half the glass width, y0 / y1 = bottom / top of the
 * glass, cy = the glass centre the flame sits just below. Panes face ±X / ±Z.
 */
export function lanternPanes({ half = GLASS.half, y0 = GLASS.y0, y1 = GLASS.y1, cy = (y0 + y1) / 2 } = {}) {
  const list = [];
  for (let i = 0; i < 4; i++) list.push(pane((i * Math.PI) / 2, { half, y0, y1, cy }));
  const g = mergeGeometries(list, false);
  list.forEach((x) => x.dispose());
  return g;
}

/** One pane of glass facing +Z (uv: across / up in half-widths from the glass centre), turned by `rot` about Y. */
function pane(rot, { half: w, y0, y1, cy } = GLASS) {
  const h = y1 - y0;
  const g = new THREE.PlaneGeometry(2 * w, h, 1, 1);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w, (pos.getY(i) + (y0 + h / 2) - cy) / w);
  g.translate(0, y0 + h / 2, w);
  g.rotateY(rot);
  return g;
}

/** Lantern body layer map, origin at the bottom of the lantern. Height ≈ 0.5, glass centre at y = 0.17. */
export function lanternGeos(color = palette.windowGlow, frame = IRON) {
  return cached(`lantern2|${color}|${frame}`, () => {
    const P = new Parts();
    const dark = frame;
    const glassLayer = defineLayer(`lanternGlass:${color}`, { mat: () => lanternGlassMaterial(color), cast: false, receive: false, uv: true, lamp: true });
    const w = GLASS.half;
    // base plate + foot ring
    P.add('detail', xf(new THREE.CylinderGeometry(0.15, 0.13, 0.04, 4, 1), [0, 0.02, 0], [0, Math.PI / 4, 0]), dark);
    // four panes of candle-lit glass
    for (let i = 0; i < 4; i++) P.add(glassLayer, pane((i * Math.PI) / 2), color);
    // the iron frame in front of the glass: corner posts, a rail along the
    // top and the bottom of every pane, two slim cage bars across each pane
    const fr = shade(dark, 0.03);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const s = Math.sin(a), c = Math.cos(a);
      const cx = (s + c) * w, cz = (c - s) * w;
      P.add('detail', xf(new THREE.BoxGeometry(0.026, 0.275, 0.026), [cx, 0.17, cz], [0, a, 0]), dark);
      for (const y of [0.057, 0.284]) P.add('detail', xf(new THREE.BoxGeometry(2 * w + 0.02, 0.022, 0.014), [s * (w + 0.004), y, c * (w + 0.004)], [0, a, 0]), fr);
      for (const u of [-0.44, 0.44]) {
        P.add('detail', xf(new THREE.BoxGeometry(0.009, GLASS.y1 - GLASS.y0, 0.008), [s * (w + 0.005) + c * u * w, 0.17, c * (w + 0.005) - s * u * w], [0, a, 0]), dark);
      }
    }
    // roof: four-sided pyramid with an overhang + finial + hanging ring
    P.add('detail', xf(new THREE.ConeGeometry(0.2, 0.13, 4, 1), [0, 0.37, 0], [0, Math.PI / 4, 0]), dark);
    P.add('detail', xf(new THREE.CylinderGeometry(0.205, 0.205, 0.02, 4, 1), [0, 0.3, 0], [0, Math.PI / 4, 0]), shade(dark, 0.06));
    P.add('detail', xf(new THREE.SphereGeometry(0.03, 6, 4), [0, 0.45, 0]), dark);
    P.add('detail', xf(new THREE.TorusGeometry(0.035, 0.009, 4, 10), [0, 0.49, 0]), dark);
    return P.finish();
  });
}

/**
 * A little lantern; glows at night.
 * @param {object} [opts] { color (glass colour), frame (iron colour, default blackened iron), hanging=false (origin at the ring on top),
 *                          halo=true, haloSize=0.65 }
 */
export function makeLantern(opts = {}) {
  const color = opt(opts, 'color', palette.windowGlow);
  const g = new THREE.Group();
  g.name = 'lantern';
  const body = groupFor(lanternGeos(color, opt(opts, 'frame', IRON)));
  if (opts.hanging) body.position.y = -0.5;
  g.add(body);
  if (opt(opts, 'halo', true)) {
    // small & soft: the glass blooms, the halo only warms the air around it
    const halo = makeGlowSprite(color, opt(opts, 'haloSize', 0.65), { day: 0.08, night: 0.95 });
    halo.position.y = body.position.y + 0.17;
    g.add(halo);
  }
  g.userData.height = 0.5;
  return g;
}

let lampCount = 0;

function postGeos(height, style, seed) {
  return cached(`lamppost|${height}|${style}|${seed}`, () => {
    const rng = createRng(seed);
    const P = new Parts();
    // stone footing
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rng.range(0, 0.6);
      const s = rng.range(0.11, 0.16);
      P.add('detail', xf(new THREE.IcosahedronGeometry(s, 0), [Math.sin(a) * 0.17, 0.03, Math.cos(a) * 0.17], [rng.next(), rng.next(), 0], [1, 0.55, 1]), rng.pick([palette.stone, palette.stoneDark, shade(palette.stone, 0.05)]));
    }
    // the post: square timber with chamfered corners (8-sided), slight taper
    const post = new THREE.CylinderGeometry(0.065, 0.085, height, 8, 1);
    post.translate(0, height / 2, 0);
    P.add('wood', post, palette.walnut);
    // collar & cap
    P.add('detail', xf(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 8), [0, 0.35, 0]), palette.metalDark);
    P.add('detail', xf(new THREE.CylinderGeometry(0.095, 0.08, 0.06, 8), [0, height + 0.03, 0]), palette.metalDark);
    if (style === 'hook') {
      P.add('detail', xf(new THREE.SphereGeometry(0.06, 8, 6), [0, height + 0.09, 0]), palette.metalDark);
      // curly iron arm the lantern hangs from
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        pts.push(new THREE.Vector3(0, height - 0.12 + Math.sin(t * Math.PI) * 0.12, t * 0.55));
      }
      P.add('detail', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.022, 5, false), palette.metalDark);
      // decorative curl under the arm
      const curl = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const a = t * Math.PI * 1.6;
        const r = 0.14 * (1 - t * 0.6);
        curl.push(new THREE.Vector3(0, height - 0.18 - Math.sin(a) * r, 0.06 + (1 - Math.cos(a)) * r));
      }
      P.add('detail', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curl), 16, 0.014, 4, false), palette.metalDark);
      P.add('detail', strut([0, height - 0.12, 0.55], [0, height - 0.22, 0.55], 0.01), palette.metalDark);
    }
    return P.finish();
  });
}

/**
 * Street lamp post (~2.6 tall) with a glowing lantern.
 * @param {object} [opts] { color, height=2.4, style: 'hook' (lantern hangs from a curly arm, swings) | 'top', seed }
 */
export function makeLampPost(opts = {}) {
  const height = opt(opts, 'height', 2.4);
  const style = opt(opts, 'style', 'hook');
  const g = new THREE.Group();
  g.name = 'lampPost';
  g.add(groupFor(postGeos(height, style, String(opts.seed ?? 'lamp'))));
  const lantern = makeLantern({ color: opts.color, haloSize: 0.8 });
  if (style === 'hook') {
    const pivot = new THREE.Group();
    pivot.position.set(0, height - 0.22, 0.55);
    lantern.position.y = -0.5;
    pivot.add(lantern);
    g.add(pivot);
    const ph = (lampCount++ * 2.39) % 6.28;
    registerAnimated(g, (dt, t) => {
      if (propsSettings.reducedMotion) return;
      pivot.rotation.x = Math.sin(t * 1.3 + ph) * 0.05;
      pivot.rotation.z = Math.sin(t * 0.9 + ph * 1.7) * 0.035;
    });
  } else {
    lantern.position.y = height + 0.02;
    g.add(lantern);
  }
  g.userData.height = height + 0.5;
  return g;
}
