// ─────────────────────────────────────────────────────────────────────────────
// Texture bakery — renders procedural GLSL patterns into mip-mapped render
// targets ONCE at startup (GPU baking: a few ms per map on a real GPU).
//
//   const tex = requestBake('bark', def)   → { map, detail } (render-target textures)
//
// Every bake is two passes:
//   1. the kind's GLSL → MRT (half float): albedo | (height, roughness, ao)
//   2. finalize → two 8-bit maps that the materials sample:
//        map    = albedo (sRGB, or raw control channels for 'colorize' kinds) + height in A
//        detail = normal.xy (from a Sobel of the precise height) | roughness | ao·cavity
//
// The renderer arrives through setBakeRenderer() (materials.setRenderer) — or,
// if nobody called that, through the first surface material that gets drawn
// (material.onBeforeRender), which bakes everything pending right then, saving
// and restoring the renderer's current target. Bakes requested once a renderer
// is known happen immediately. Textures are valid objects from the start, so
// materials can be created (and compiled) before anything is baked.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { NOISE_GLSL } from './noise.glsl.js';

let renderer = null;
const entries = new Map();
const pending = [];
const programs = new Map();
let finalizeMat = null;
let quad = null;
let quadCam = null;
const scratch = new Map(); // 'wxh' → MRT scratch target (freed shortly after the last bake)
let scratchTimer = 0;
let floatOK = true;
let sizeScale = 1;
const stats = { bakes: 0, ms: 0, bytes: 0, programs: 0 };

const VERT = /* glsl */ `
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function ensureQuad() {
  if (quad) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  quad = new THREE.Mesh(geo);
  quad.frustumCulled = false;
  quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
}

/** Pass-1 program for one pattern function (cached; compiled on first bake). */
function passOneMaterial(def) {
  const key = def.glslKey;
  let m = programs.get(key);
  if (m) return m;
  m = new THREE.RawShaderMaterial({
    name: `bake-${key}`,
    glslVersion: THREE.GLSL3,
    uniforms: { uSize: { value: new THREE.Vector2(1, 1) }, uSeed: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp int;
      uniform vec2 uSize;
      layout(location = 0) out vec4 oAlbedo;
      layout(location = 1) out vec4 oData;
      ${NOISE_GLSL}
      ${def.glsl}
      void main() {
        vec2 uv = gl_FragCoord.xy / uSize;
        Surf s = ${def.fn}(uv);
        ${def.mode === 'colorize' ? 'oAlbedo = vec4(sat(s.col), 1.0);' : 'oAlbedo = vec4(toLinear(s.col), 1.0);'}
        oData = vec4(s.h, s.rough, s.ao, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  programs.set(key, m);
  stats.programs++;
  return m;
}

function getFinalize() {
  if (finalizeMat) return finalizeMat;
  finalizeMat = new THREE.RawShaderMaterial({
    name: 'bake-finalize',
    glslVersion: THREE.GLSL3,
    uniforms: {
      tAlbedo: { value: null },
      tData: { value: null },
      uSize: { value: new THREE.Vector2(1, 1) },
      uBump: { value: 1 },
      uCavity: { value: 1 },
      uOut: { value: 0 },
      uAlpha: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp int;
      uniform sampler2D tAlbedo;
      uniform sampler2D tData;
      uniform vec2 uSize;
      uniform float uBump;
      uniform float uCavity;
      uniform int uOut;
      uniform int uAlpha;
      out vec4 oColor;
      float H(ivec2 c) {
        ivec2 s = ivec2(uSize);
        c = (c % s + s) % s;
        return texelFetch(tData, c, 0).x;
      }
      void main() {
        ivec2 c = ivec2(gl_FragCoord.xy);
        vec4 d = texelFetch(tData, c, 0);
        if (uOut == 0) {
          // albedo (+ height, or + coverage for alpha cards)
          oColor = vec4(texelFetch(tAlbedo, c, 0).rgb, uAlpha == 1 ? d.z : d.x);
          return;
        }
        float tl = H(c + ivec2(-1, 1)), t = H(c + ivec2(0, 1)), tr = H(c + ivec2(1, 1));
        float l = H(c + ivec2(-1, 0)), r = H(c + ivec2(1, 0));
        float bl = H(c + ivec2(-1, -1)), b = H(c + ivec2(0, -1)), br = H(c + ivec2(1, -1));
        float dx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
        float dy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
        vec3 n = normalize(vec3(-dx * uBump, -dy * uBump, 1.0));
        // cavity: how far this texel sits below its neighbourhood (two rings)
        float h = d.x, acc = 0.0;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.785398 + 0.39;
          vec2 o = vec2(cos(a), sin(a));
          acc += H(c + ivec2(o * 3.0)) + H(c + ivec2(o * 8.0));
        }
        float cav = clamp(1.0 - max(acc / 16.0 - h, 0.0) * uCavity, 0.0, 1.0);
        oColor = vec4(n.xy * 0.5 + 0.5, d.y, d.z * cav);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  return finalizeMat;
}

let fillMat = null;
/**
 * Fallback when a pattern cannot be baked (shader failed on this GPU): fill
 * the maps with a flat mean colour (flat normal, matte), leaf cards with
 * transparency — a plain surface instead of a black one. Rendered (not
 * cleared) so the mip chain is generated too.
 */
function fallbackFill(e) {
  fillMat ??= new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uColor: { value: new THREE.Vector4() } },
    vertexShader: VERT,
    fragmentShader: 'precision highp float;\nuniform vec4 uColor;\nout vec4 o;\nvoid main() { o = uColor; }',
    depthTest: false,
    depthWrite: false,
  });
  const mean = new THREE.Color(e.def.mean ?? '#808080');
  if (e.def.mode === 'colorize') fillMat.uniforms.uColor.value.set(0.3, 0.5, 0, 0.5);
  else fillMat.uniforms.uColor.value.set(mean.r, mean.g, mean.b, e.def.alpha ? 0 : 0.5);
  quad.material = fillMat;
  renderer.setRenderTarget(e.a);
  renderer.render(quad, quadCam);
  if (e.b) {
    fillMat.uniforms.uColor.value.set(0.5, 0.5, 0.92, 1);
    renderer.setRenderTarget(e.b);
    renderer.render(quad, quadCam);
  }
  e.baked = true;
  stats.failed = (stats.failed ?? 0) + 1;
}

function getScratch(w, h) {
  const key = w + 'x' + h;
  if (scratch.has(key)) return scratch.get(key);
  const ext = renderer.extensions;
  floatOK = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
  const rt = new THREE.WebGLRenderTarget(w, h, {
    count: 2,
    type: floatOK ? THREE.HalfFloatType : THREE.UnsignedByteType,
    depthBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  });
  scratch.set(key, rt);
  return rt;
}

function scheduleScratchRelease() {
  clearTimeout(scratchTimer);
  scratchTimer = setTimeout(() => {
    for (const rt of scratch.values()) rt.dispose();
    scratch.clear();
  }, 3000);
}

const scaled = (size) => size.map((v) => Math.max(64, Math.round(v * sizeScale)));

/**
 * Scale the resolution of every map not baked yet (e.g. 0.5 on low-end
 * devices). Already-baked maps keep their size.
 */
export function setBakeScale(k) {
  sizeScale = k;
  for (const e of entries.values()) {
    if (e.baked) continue;
    stats.bytes -= e.size[0] * e.size[1] * 4 * (e.b ? 2 : 1) * 1.333;
    e.size = scaled(e.def.size);
    e.a.setSize(e.size[0], e.size[1]);
    e.b?.setSize(e.size[0], e.size[1]);
    stats.bytes += e.size[0] * e.size[1] * 4 * (e.b ? 2 : 1) * 1.333;
  }
}

function makeTarget(w, h, srgb, wrapT = THREE.RepeatWrapping, wrapS = THREE.RepeatWrapping) {
  return new THREE.WebGLRenderTarget(w, h, {
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS,
    wrapT,
    anisotropy: 8,
    colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    type: THREE.UnsignedByteType,
  });
}

/**
 * Request the baked maps for a pattern definition:
 *   def = { glslKey, glsl, fn, mode: 'rgb'|'colorize'|'card', size: [w,h], bump, cavity, seed, wrapT, alpha }
 * Returns { map, detail, def } immediately (filled in once baked).
 */
export function requestBake(key, def) {
  let e = entries.get(key);
  if (e) return e;
  const [w, h] = scaled(def.size);
  const srgb = def.mode !== 'colorize';
  const wrapT = def.wrapT === 'clamp' || def.alpha ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  const wrapS = def.alpha ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  const a = makeTarget(w, h, srgb, wrapT, wrapS);
  const b = def.alpha ? null : makeTarget(w, h, false, wrapT, wrapS);
  a.texture.name = `${key}-map`;
  if (b) b.texture.name = `${key}-detail`;
  e = { key, def, size: [w, h], a, b, map: a.texture, detail: b ? b.texture : null, baked: false };
  entries.set(key, e);
  stats.bytes += w * h * 4 * (b ? 2 : 1) * 1.333;
  if (renderer) bakeNow([e]);
  else pending.push(e);
  return e;
}

function bakeNow(list) {
  if (!list.length) return;
  ensureQuad();
  const r = renderer;
  const prevRT = r.getRenderTarget();
  const prevFace = r.getActiveCubeFace();
  const prevMip = r.getActiveMipmapLevel();
  const prevXR = r.xr.enabled;
  const prevAutoClear = r.autoClear;
  r.xr.enabled = false;
  r.autoClear = false;
  const t0 = performance.now();
  try {
    for (const e of list) {
      if (e.baked) continue;
      const [w, h] = e.size;
      const tmp = getScratch(w, h);
      // pass 1: the pattern
      const m1 = passOneMaterial(e.def);
      m1.uniforms.uSize.value.set(w, h);
      m1.uniforms.uSeed.value = e.def.seed ?? 0;
      quad.material = m1;
      r.setRenderTarget(tmp);
      r.render(quad, quadCam);
      if (r.properties.get(m1).currentProgram?.diagnostics?.runnable === false) {
        console.warn(`[textures] "${e.key}" pattern failed to compile — using a flat colour`);
        fallbackFill(e);
        continue;
      }
      // pass 2: albedo map, then detail map
      const fin = getFinalize();
      fin.uniforms.tAlbedo.value = tmp.textures[0];
      fin.uniforms.tData.value = tmp.textures[1];
      fin.uniforms.uSize.value.set(w, h);
      // Sobel sums 4 texel differences per side → slope per tile = d·size/8
      fin.uniforms.uBump.value = (e.def.bump ?? 0.02) * (w / 8);
      fin.uniforms.uCavity.value = e.def.cavity ?? 2;
      fin.uniforms.uAlpha.value = e.def.alpha ? 1 : 0;
      quad.material = fin;
      fin.uniforms.uOut.value = 0;
      r.setRenderTarget(e.a);
      r.render(quad, quadCam);
      if (e.b) {
        fin.uniforms.uOut.value = 1;
        r.setRenderTarget(e.b);
        r.render(quad, quadCam);
      }
      e.baked = true;
      stats.bakes++;
    }
  } catch (err) {
    console.warn('[textures] bake failed — surfaces fall back to flat colour', err);
    for (const e of list) {
      if (e.baked) continue;
      try {
        fallbackFill(e);
      } catch {
        /* nothing more we can do */
      }
    }
  } finally {
    stats.ms += performance.now() - t0;
    r.setRenderTarget(prevRT, prevFace, prevMip);
    r.xr.enabled = prevXR;
    r.autoClear = prevAutoClear;
    scheduleScratchRelease();
  }
}

/** Give the bakery a renderer; bakes everything requested so far. */
export function setBakeRenderer(r) {
  if (!r || renderer === r) return;
  renderer = r;
  const list = pending.splice(0);
  bakeNow(list);
}

export function hasBakeRenderer() {
  return !!renderer;
}

/** Bake anything still pending (cheap no-op when nothing is). */
export function flushBakes() {
  if (renderer && pending.length) bakeNow(pending.splice(0));
}

export function bakeStats() {
  return { ...stats, mb: +(stats.bytes / 1048576).toFixed(1), maps: entries.size, pending: pending.length, halfFloat: floatOK };
}

/**
 * Debug: average colour of a baked map (renders its smallest mip into 1×1).
 * Returns sRGB hex. Only for look-dev (synchronous readback).
 */
export function measureMean(key) {
  const e = entries.get(key);
  if (!e || !renderer) return null;
  ensureQuad();
  const rt = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, type: THREE.FloatType });
  const m = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { t: { value: e.map } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D t;
      out vec4 o;
      void main() { o = textureLod(t, vec2(0.5), 12.0); }
    `,
  });
  const prev = renderer.getRenderTarget();
  quad.material = m;
  renderer.setRenderTarget(rt);
  renderer.render(quad, quadCam);
  const px = new Float32Array(4);
  renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, px);
  renderer.setRenderTarget(prev);
  rt.dispose();
  m.dispose();
  const c = new THREE.Color(px[0], px[1], px[2]);
  return e.def.mode === 'colorize' ? [px[0], px[1], px[2]].map((v) => +v.toFixed(3)) : '#' + c.getHexString();
}
