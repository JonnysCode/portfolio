// ─────────────────────────────────────────────────────────────────────────────
// Live polaroids — until the owner has real photos, a journal page shows the
// real piece as it stands in the glen: the hotspot's object is rendered ONCE,
// on its own, by a small offscreen camera from a 3/4 angle (across its long
// side, a little from above; flat things — a certificate, a portrait — almost
// head-on), lit by the glen's own sun / moon and lamps, then tone-mapped and
// graded like the scene over a soft out-of-focus "woodland bokeh" backdrop
// with a contact shadow. The result is cached (per entry, day / night) as a
// JPEG data URL, so a page opens instantly the second time.
//
//   const pol = createPolaroids(ctx)
//   pol.available(entryId) → bool        (a 3D object to photograph, post chain on)
//   pol.cached(entryId) → url | null     (already developed for the current light)
//   pol.request(entryId, { live }) → Promise<url | null>   (renders in a coming frame, one at a
//        time; live: its page is open and the camera rig is framing the piece)
//
// How the photo is taken: the object's meshes and every light are put on a
// spare layer; a camera that sees only that layer renders into a half-float
// target (the same program variants as the post chain's HDR scene target, so
// nothing new compiles), the sun's shadow map is redrawn with the object alone
// (clean self-shadows) and flagged for a redraw so the glen's next frame gets
// its full shadows back. A tiny finishing pass tone-maps (the renderer's ACES
// & exposure, the post chain's exposure) and grades, and the pixels are read
// back once. A piece merged into its module's batch (only an invisible pick
// box stands for it) is photographed in place instead: the whole glen, from
// where the camera rig has just framed it for its open page (the rig's clear
// sight line), with a tighter lens and the background softly out of focus;
// without such a view (the guidebook) it keeps its sketch until then. No WebGL /
// post chain off / no hotspot / an empty frame → null (the sketch stays).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SPOT_BY_ID } from '../world/layout.js';

const LAYER = 29;
const W = 630, H = 420; // 3:2 like the polaroid window (≈ 300 css px at DPR 2)
const FOV = 24; // a gentle telephoto: product-shot perspective, nothing too close to the lens

/** Per entry: which of several hotspots to photograph, and framing nudges. */
const TWEAKS = {
  // the door leaf and Jonny's portrait in the window both open "About me": the portrait is the photo
  'about-me': { pick: 'last', flat: true, yaw: 0.16 },
};

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const FRAG = /* glsl */ `
  uniform sampler2D tColor, tDepth;
  uniform float uDof, uNear, uFar, uFocus;
  uniform float uExposure, uTmExposure, uNight, uSat, uWarmSat, uWarmth, uShadow, uSeed;
  uniform vec3 uBgTop, uBgMid, uBgFloor, uBokeh;
  uniform vec4 uShadowBox; // centre uv, half size uv
  varying vec2 vUv;
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
  // three's ACES filmic (the renderer's tone mapping)
  vec3 aces(vec3 color) {
    const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    color *= uTmExposure / 0.6;
    color = O * RRTAndODTFit(I * color);
    return clamp(color, 0.0, 1.0);
  }
  float hueOf(vec3 c) {
    float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b), d = mx - mn;
    if (d < 1e-5) return 0.0;
    float h = mx == c.r ? mod((c.g - c.b) / d, 6.0) : mx == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0;
    return h / 6.0;
  }
  float hueBand(float h, float centre, float full, float fade) {
    float dh = abs(fract(h - centre / 360.0 + 0.5) - 0.5) * 360.0;
    return 1.0 - smoothstep(full, fade, dh);
  }
  float linZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
  // circle of confusion: behind the focus only (0..1)
  float cocAt(vec2 p) { float z = linZ(texture2D(tDepth, p).x); return clamp((z - uFocus) / max(z, 1e-3) * 2.4, 0.0, 1.0); }
  vec3 toSRGB(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  void main() {
    vec2 uv = vUv;
    float aspect = ${(W / H).toFixed(4)};
    // ── the backdrop: a sunlit (moonlit) woodland far out of focus ──
    vec3 bg = mix(uBgFloor, uBgMid, smoothstep(0.02, 0.42, uv.y));
    bg = mix(bg, uBgTop, smoothstep(0.42, 1.0, uv.y));
    // bokeh: soft discs of light through the leaves (fairy lights by night)
    for (int i = 0; i < 11; i++) {
      float fi = float(i) + uSeed * 13.0;
      vec2 c = vec2(hash12(vec2(fi, 3.1)), 0.34 + 0.7 * hash12(vec2(fi, 7.7)));
      float r = mix(0.035, 0.11, hash12(vec2(fi, 1.3)));
      float d = length((uv - c) * vec2(aspect, 1.0));
      float disc = 1.0 - smoothstep(r * 0.82, r, d);
      float ring = smoothstep(r * 0.55, r * 0.95, d) * disc;
      bg += uBokeh * (disc * 0.55 + ring * 0.35) * mix(0.25, 1.0, hash12(vec2(fi, 9.2)));
    }
    // contact shadow on the "floor"
    if (uShadow > 0.0) {
      vec2 q = (uv - uShadowBox.xy) / max(uShadowBox.zw, vec2(1e-3));
      float s = exp(-dot(q, q) * 2.2);
      bg *= 1.0 - uShadow * s;
    }
    // ── the object (premultiplied HDR) ──
    vec4 s = texture2D(tColor, uv);
    if (any(isnan(s)) || any(isinf(s))) s = vec4(0.0);
    // (a photo taken in place: what lies behind the piece goes softly out of focus)
    if (uDof > 0.5) {
      float coc = cocAt(uv);
      if (coc > 0.02) {
        vec4 acc = vec4(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 20; i++) {
          float fi = float(i);
          float r = sqrt((fi + 0.5) / 20.0) * coc * 0.026;
          vec2 o = vec2(cos(fi * 2.39996), sin(fi * 2.39996)) * r * vec2(1.0 / aspect, 1.0);
          float wt = max(cocAt(uv + o), 0.05);
          vec4 c = texture2D(tColor, uv + o);
          if (any(isnan(c)) || any(isinf(c))) continue;
          acc += c * wt;
          wsum += wt;
        }
        s = mix(s, acc / max(wsum, 1e-4), smoothstep(0.03, 0.35, coc));
      }
    }
    float a = clamp(s.a, 0.0, 1.0);
    vec3 obj = a > 1e-4 ? aces(s.rgb / a * uExposure) : vec3(0.0);
    vec3 col = mix(bg, obj, a);
    // ── grade: warm hues keep their colour, greens settle to sage, golden highlights ──
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float cmx = max(max(col.r, col.g), col.b), cmn = min(min(col.r, col.g), col.b);
    float hue = hueOf(col);
    float chroma = smoothstep(0.06, 0.22, (cmx - cmn) / max(cmx, 1e-4));
    float warm = hueBand(hue, 22.0, 24.0, 40.0) * chroma;
    float green = hueBand(hue, 105.0, 38.0, 55.0) * chroma;
    float sat = mix(uSat, uWarmSat, warm) * mix(1.0, 0.8, green);
    if (sat > 1.0 && cmn < l) sat = min(sat, (l - 0.5 * cmn) / max(l - cmn, 1e-5));
    col = mix(vec3(l), col, sat);
    col *= mix(vec3(1.0), vec3(1.0 + uWarmth, 1.0 + uWarmth * 0.35, 1.0 - uWarmth * 0.6), smoothstep(0.25, 0.9, l));
    float sh = (1.0 - l) * (1.0 - l);
    col = mix(col, col * mix(vec3(0.96, 1.0, 1.05), vec3(0.9, 0.98, 1.1), uNight), sh * (1.0 - warm * 0.7));
    // film: lifted, slightly warm blacks; a soft vignette; fine grain
    col = col * 0.965 + mix(vec3(0.028, 0.022, 0.014), vec3(0.012, 0.018, 0.034), uNight);
    vec2 vq = (uv - 0.5) * vec2(aspect, 1.0);
    col *= 1.0 - 0.32 * smoothstep(0.38, 1.05, length(vq));
    vec3 o = toSRGB(col);
    o += (hash12(gl_FragCoord.xy + uSeed * 91.0) - 0.5) * 0.022;
    gl_FragColor = vec4(o, a);
  }
`;

export function createPolaroids(ctx) {
  const cache = new Map();
  const pending = new Map();
  const queue = [];
  let gpu = null;
  let releaseTimer = 0;
  let pumping = false;

  const engine = ctx.engine;
  const renderer = engine?.renderer;

  const nightKey = () => (ctx.env?.isNight ? 'n' : 'd');
  const key = (id) => `${id}|${nightKey()}`;

  /** The hotspot to photograph for an entry (null when the glen has none). */
  function hotspotFor(id) {
    const all = (ctx.interactions?.hotspots ?? []).filter((h) => h.entryId === id && h.object);
    if (!all.length) return null;
    return TWEAKS[id]?.pick === 'last' ? all[all.length - 1] : all[0];
  }

  function available(id) {
    return !!(renderer && ctx.scene && ctx.post?.target && hotspotFor(id));
  }

  function setup() {
    if (gpu) return gpu;
    const ext = renderer.extensions;
    const floatOK = renderer.capabilities.isWebGL2 && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
    const samples = Math.min(4, renderer.capabilities.maxSamples ?? 4);
    const hdr = new THREE.WebGLRenderTarget(W, H, { type: floatOK ? THREE.HalfFloatType : THREE.UnsignedByteType, samples, depthTexture: new THREE.DepthTexture(W, H) });
    hdr.texture.name = 'woodland.polaroid.hdr';
    const ldr = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false });
    ldr.texture.name = 'woodland.polaroid.ldr';
    const mat = new THREE.ShaderMaterial({
      name: 'WoodlandPolaroid',
      uniforms: {
        tColor: { value: hdr.texture },
        tDepth: { value: hdr.depthTexture },
        uDof: { value: 0 },
        uNear: { value: 0.1 },
        uFar: { value: 100 },
        uFocus: { value: 3 },
        uExposure: { value: 1 },
        uTmExposure: { value: 1 },
        uNight: { value: 0 },
        uSat: { value: 1 },
        uWarmSat: { value: 1.1 },
        uWarmth: { value: 0.1 },
        uShadow: { value: 0 },
        uSeed: { value: 0 },
        uShadowBox: { value: new THREE.Vector4(0.5, 0.1, 0.3, 0.05) },
        uBgTop: { value: new THREE.Color() },
        uBgMid: { value: new THREE.Color() },
        uBgFloor: { value: new THREE.Color() },
        uBokeh: { value: new THREE.Color() },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const quad = new FullScreenQuad(mat);
    const cam = new THREE.PerspectiveCamera(FOV, W / H, 0.05, 400);
    const pixels = new Uint8Array(W * H * 4);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    gpu = { hdr, ldr, mat, quad, cam, pixels, canvas, g: canvas.getContext('2d'), image: null };
    return gpu;
  }
  /** The targets are freed a while after the last photo (phones: memory). */
  function scheduleRelease() {
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      if (!gpu || queue.length) return;
      gpu.hdr.depthTexture?.dispose();
      gpu.hdr.dispose();
      gpu.ldr.dispose();
      gpu.mat.dispose();
      gpu = null;
    }, 4000);
  }

  // ── framing ──────────────────────────────────────────────────────────────
  const inv = new THREE.Matrix4();
  const m4 = new THREE.Matrix4();
  const lbox = new THREE.Box3();
  const tbox = new THREE.Box3();
  const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  const centre = new THREE.Vector3();
  const axX = new THREE.Vector3(), axZ = new THREE.Vector3();
  const dir = new THREE.Vector3(), f = new THREE.Vector3(), w = new THREE.Vector3(), u = new THREE.Vector3(), vv = new THREE.Vector3();
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  /** The object's bounds in its own frame (an oriented box): drawn meshes only (or the invisible pick boxes too). */
  const drawn = (m) => !!m && m.visible !== false;
  function localBox(obj, withHidden = false) {
    obj.updateWorldMatrix(true, true);
    inv.copy(obj.matrixWorld).invert();
    lbox.makeEmpty();
    obj.traverseVisible((o) => {
      if (!(o.isMesh || o.isLine || o.isPoints) || !o.geometry) return;
      if (!withHidden && !(Array.isArray(o.material) ? o.material.some(drawn) : drawn(o.material))) return;
      let bb;
      if (o.isInstancedMesh) {
        if (!o.boundingBox) o.computeBoundingBox();
        bb = o.boundingBox;
      } else {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        bb = o.geometry.boundingBox;
      }
      if (!bb || bb.isEmpty()) return;
      tbox.copy(bb).applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld));
      lbox.union(tbox);
    });
    return lbox;
  }

  /** The sun (or the moon): the brightest shadow-casting directional light, as a direction towards it. */
  function keyLightDir(out) {
    let best = null;
    ctx.scene.traverse((o) => {
      if (o.isDirectionalLight && o.visible && (!best || o.intensity > best.intensity)) best = o;
    });
    if (!best) return null;
    best.updateWorldMatrix(true, false);
    best.target.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(best.matrixWorld).sub(tmp2.setFromMatrixPosition(best.target.matrixWorld));
    return out.lengthSq() > 1e-8 ? out.normalize() : null;
  }

  /**
   * How much stands between the lens and the piece (in place): every small drawn mesh
   * whose bounds reach into the view cone in front of the piece, weighted by its size.
   */
  const sph = new THREE.Sphere();
  const segDir = new THREE.Vector3(), rel = new THREE.Vector3(), eyeV = new THREE.Vector3();
  function inFront(eye, target, upTo, halfSize, ignore) {
    segDir.subVectors(target, eye);
    const L = segDir.length();
    if (L < 1e-4) return 0;
    segDir.divideScalar(L);
    let cost = 0;
    ctx.scene.traverseVisible((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
      if (!(Array.isArray(o.material) ? o.material.some(drawn) : drawn(o.material))) return;
      for (let p = o; p; p = p.parent) if (p === ignore) return;
      const g = o.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      sph.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
      if (sph.radius > 3 || sph.radius < 0.03) return;
      rel.subVectors(sph.center, eye);
      const t = rel.dot(segDir);
      if (t < 0.05 || t > upTo) return;
      const lim = sph.radius + halfSize * (t / L);
      if (rel.lengthSq() - t * t < lim * lim) cost += sph.radius;
    });
    return cost;
  }

  /** In place, from a given eye (the rig's framing camera): aim at the piece and fit the lens to it. */
  function frameFrom(eye, cam) {
    w.subVectors(eye, centre);
    const D = w.length();
    if (D < 0.3) return null;
    w.divideScalar(D);
    u.crossVectors(UP, w);
    if (u.lengthSq() < 1e-6) return null;
    u.normalize();
    vv.crossVectors(w, u);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of corners) {
      tmp.subVectors(c, centre);
      x0 = Math.min(x0, tmp.dot(u));
      x1 = Math.max(x1, tmp.dot(u));
      y0 = Math.min(y0, tmp.dot(vv));
      y1 = Math.max(y1, tmp.dot(vv));
    }
    const ox = (x0 + x1) / 2, oy = (y0 + y1) / 2;
    let tv = 0;
    for (const c of corners) {
      tmp.subVectors(c, centre);
      const depth = Math.max(0.2, D - tmp.dot(w));
      tv = Math.max(tv, Math.abs(tmp.dot(vv) - oy) / depth / 0.8, Math.abs(tmp.dot(u) - ox) / depth / 0.86 / (W / H));
    }
    cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(tv)), 12, 55);
    cam.position.copy(eye);
    cam.up.copy(UP);
    cam.lookAt(tmp.copy(centre).addScaledVector(u, ox).addScaledVector(vv, oy));
    cam.near = 0.1;
    cam.far = 260;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    return { flat: false, context: true, focus: D, shadow: { x: 0.5, y: 0.1, w: 0.3, h: 0.05 } };
  }

  /** Only an invisible pick box stands for the piece (it is merged into its module's batch)? */
  const placeOnly = new Map();
  function inPlace(id) {
    if (!placeOnly.has(id)) {
      const hs = hotspotFor(id);
      placeOnly.set(id, !!hs && localBox(hs.object, false).isEmpty());
    }
    return placeOnly.get(id);
  }

  /**
   * Aim the polaroid camera at a hotspot → { flat, context, focus, shadow } or null.
   * context: only an invisible pick box stands for the piece (it is merged into its
   * module's batch) — it is photographed in place, from a viewpoint with nothing solid between.
   */
  function frame(hs, cam, tweak, eye = null) {
    const obj = hs.object;
    let b = localBox(obj, false);
    let context = false;
    if (b.isEmpty()) {
      b = localBox(obj, true);
      context = true;
    }
    if (b.isEmpty()) return null;
    const mw = obj.matrixWorld;
    const { min, max } = b;
    let i = 0;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) corners[i++].set(x, y, z).applyMatrix4(mw);
    b.getCenter(centre).applyMatrix4(mw);
    // world extents along the object's own horizontal axes
    axX.setFromMatrixColumn(mw, 0);
    axZ.setFromMatrixColumn(mw, 2);
    const ex = (max.x - min.x) * axX.length();
    const ez = (max.z - min.z) * axZ.length();
    const ey = (max.y - min.y) * tmp.setFromMatrixColumn(mw, 1).length();
    axX.y = 0;
    axZ.y = 0;
    if (axX.lengthSq() < 1e-8 || axZ.lengthSq() < 1e-8) return null;
    axX.normalize();
    axZ.normalize();
    const big = Math.max(ex, ey, ez);
    const flat = tweak?.flat ?? Math.min(ex, ez) < 0.22 * big;
    // the visitor's side: towards the spot's camera
    const spot = SPOT_BY_ID[hs.area];
    if (spot?.camera?.position) dir.set(...spot.camera.position);
    else dir.copy(ctx.camera.position);
    dir.sub(centre).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    // the face to photograph: across the long side (a table, a bench, a bike from the side);
    // a square footprint: whichever face looks at the visitor
    const sq = Math.min(ex, ez) / Math.max(ex, ez, 1e-6) > 0.8;
    if (sq) f.copy(Math.abs(axX.dot(dir)) > Math.abs(axZ.dot(dir)) ? axX : axZ);
    else f.copy(ex < ez ? axX : axZ);
    if (f.dot(dir) < 0) f.negate();
    // a 3/4 turn (flat things: a little), towards the visitor's side — or the lit side when that is clear
    const yaw = tweak?.yaw ?? (flat ? 0.4 : 0.56);
    const side = tmp.crossVectors(UP, f).dot(dir) >= 0 ? 1 : -1;
    let sgn = side;
    const sun = keyLightDir(tmp2);
    if (sun && !flat) {
      const lit = (s) => Math.cos(yaw) * f.dot(sun) + s * Math.sin(yaw) * tmp.crossVectors(UP, f).dot(sun);
      if (lit(-side) > lit(side) + 0.25) sgn = -side;
    }
    const elev = tweak?.elev ?? (flat ? 0.07 : 0.4);
    const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const tanH = tanV * (W / H);
    const mH = 0.86, mV = flat ? 0.84 : 0.8;
    // in place: the first of these turns with a clear view wins (else the closest)
    if (context && eye) return frameFrom(eye, cam);
    // (several turns, and a higher look over things, each scored by what stands in front)
    const turns = context
      ? [[sgn, elev], [-sgn, elev], [sgn * 0.4, elev], [-sgn * 0.4, elev], [sgn, elev + 0.3], [-sgn, elev + 0.3], [0, elev + 0.45]]
      : [[sgn, elev]];
    let fit = null;
    for (const [t, el] of turns) {
      w.copy(f).applyAxisAngle(UP, t * yaw).multiplyScalar(Math.cos(el)).addScaledVector(UP, Math.sin(el)).normalize();
      u.crossVectors(UP, w).normalize();
      vv.crossVectors(w, u);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, zMax = -Infinity;
      for (const c of corners) {
        tmp.subVectors(c, centre);
        const x = tmp.dot(u), y = tmp.dot(vv), z = tmp.dot(w);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
        zMax = Math.max(zMax, z);
      }
      const ox = (x0 + x1) / 2;
      const oy = (y0 + y1) / 2 - (y1 - y0) * (flat ? 0 : 0.04);
      let D = 0;
      for (const c of corners) {
        tmp.subVectors(c, centre);
        const x = tmp.dot(u) - ox, y = tmp.dot(vv) - oy, z = tmp.dot(w);
        D = Math.max(D, z + Math.abs(x) / (tanH * mH), z + Math.abs(y) / (tanV * mV));
      }
      // (the near-lens fade dissolves anything closer than ~0.72)
      D = Math.max(D, zMax + 0.85);
      let cost = 0;
      if (context) {
        // something solid on the sight line (a wall, a deck, the trunk) rules a turn out;
        // small loose things in front of the piece (a villager, a lantern, a barrel) cost by size
        if ((ctx.interactions?.firstSolidHit?.(centre, w, Math.max(0.05, zMax), D + 0.3, obj) ?? Infinity) < Infinity) cost += 100;
        tmp.copy(centre).addScaledVector(u, ox).addScaledVector(vv, oy);
        cost += inFront(eyeV.copy(tmp).addScaledVector(w, D), tmp, D - zMax, Math.max(x1 - x0, y1 - y0) / 2, obj);
      }
      if (!fit || cost < fit.cost) fit = { cost, D, ox, oy, x0, x1, y0, y1, zMax, w: w.clone(), u: u.clone(), v: vv.clone() };
      if (cost === 0) break;
    }
    w.copy(fit.w);
    u.copy(fit.u);
    vv.copy(fit.v);
    const { D, ox, oy, x0, x1, y0, y1, zMax } = fit;
    tmp.copy(centre).addScaledVector(u, ox).addScaledVector(vv, oy);
    cam.position.copy(tmp).addScaledVector(w, D);
    cam.up.copy(UP);
    cam.lookAt(tmp);
    const span = Math.max(x1 - x0, y1 - y0, zMax * 2);
    cam.near = context ? 0.1 : Math.max(0.05, D - zMax - span - 0.5);
    cam.far = context ? 260 : D + span * 2 + 2;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    // where the object stands: its lowest corners' middle, and how wide its footprint looks
    let bx = 0, by = 0, bz = 0, n = 0;
    let lowY = Infinity;
    for (const c of corners) lowY = Math.min(lowY, c.y);
    for (const c of corners) if (c.y < lowY + 1e-4 + (max.y - min.y) * 0.02) (bx += c.x), (by += c.y), (bz += c.z), n++;
    const foot = tmp.set(bx / n, by / n, bz / n).project(cam);
    const halfW = ((x1 - x0) / 2) / (D * tanH);
    return { flat, context, focus: D, shadow: { x: foot.x * 0.5 + 0.5, y: foot.y * 0.5 + 0.5, w: Math.min(0.48, halfW * 0.62), h: Math.min(0.12, halfW * 0.16 + 0.02) } };
  }

  // ── the exposure ─────────────────────────────────────────────────────────
  const saveClear = new THREE.Color();
  function shoot(id, eye = null) {
    const hs = hotspotFor(id);
    if (!hs || !renderer || !ctx.post?.target) return null;
    const G = setup();
    G.cam.fov = FOV;
    const shot = frame(hs, G.cam, TWEAKS[id], eye);
    if (!shot) return null;
    const scene = ctx.scene;
    const n = ctx.env?.night ?? (ctx.env?.isNight ? 1 : 0);
    // the object and every light on the polaroid layer (in place: the whole glen)
    const tagged = [];
    if (shot.context) G.cam.layers.enableAll();
    else {
      G.cam.layers.set(LAYER);
      hs.object.traverse((o) => {
        if (!o.layers.isEnabled(LAYER)) {
          o.layers.enable(LAYER);
          tagged.push(o);
        }
      });
    }
    scene.traverse((o) => {
      if (o.isLight && !o.layers.isEnabled(LAYER)) o.layers.enable(LAYER); // (stays: harmless for the main camera)
    });
    const prevTarget = renderer.getRenderTarget();
    renderer.getClearColor(saveClear);
    const prevAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    const prevBg = scene.background;
    const sm = renderer.shadowMap;
    const prevShadowUpdate = sm.needsUpdate;
    let url = null;
    let coverage = 0;
    try {
      if (!shot.context) scene.background = null;
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 0);
      // isolated: self-shadows only (the glen's map is redrawn on its next frame);
      // in place: the glen's own shadow map as it is
      if (sm.enabled) sm.needsUpdate = !shot.context;
      renderer.setRenderTarget(G.hdr);
      renderer.clear(true, true, true);
      renderer.render(scene, G.cam);
      // finishing: tone curve + grade over the bokeh backdrop
      const U = G.mat.uniforms;
      const S = ctx.post?.settings ?? {};
      const night = n > 0.5;
      U.uExposure.value = (night ? S.exposure ?? 1 : S.exposureDay ?? 1) * (night ? 1.35 : 1.04);
      U.uTmExposure.value = renderer.toneMappingExposure;
      U.uNight.value = n;
      U.uSat.value = night ? 0.95 : 0.98;
      U.uWarmSat.value = night ? 1.05 : 1.12;
      U.uWarmth.value = night ? 0.0 : 0.1;
      U.uSeed.value = (hashStr(id) % 997) / 997;
      U.uShadow.value = shot.flat || shot.context ? 0 : night ? 0.5 : 0.36;
      U.uDof.value = shot.context ? 1 : 0;
      U.uNear.value = G.cam.near;
      U.uFar.value = G.cam.far;
      U.uFocus.value = shot.focus * 1.08;
      U.uShadowBox.value.set(shot.shadow.x, shot.shadow.y, shot.shadow.w, shot.shadow.h);
      // display-referred linear colours
      if (night) {
        U.uBgTop.value.set('#0e1c33').convertSRGBToLinear();
        U.uBgMid.value.set('#1d2d40').convertSRGBToLinear();
        U.uBgFloor.value.set('#2b2a2e').convertSRGBToLinear();
        U.uBokeh.value.set('#ffb860').convertSRGBToLinear().multiplyScalar(0.16);
      } else {
        U.uBgTop.value.set('#9db79a').convertSRGBToLinear();
        U.uBgMid.value.set('#ead9b4').convertSRGBToLinear();
        U.uBgFloor.value.set('#d6c3a1').convertSRGBToLinear();
        U.uBokeh.value.set('#fff3d2').convertSRGBToLinear().multiplyScalar(0.2);
      }
      renderer.setRenderTarget(G.ldr);
      G.quad.render(renderer);
      renderer.readRenderTargetPixels(G.ldr, 0, 0, W, H, G.pixels);
      // flip rows into the 2D canvas (and count what the object covers)
      if (!G.image) G.image = G.g.createImageData(W, H);
      const src = G.pixels, dst = G.image.data;
      const row = W * 4;
      for (let y = 0; y < H; y++) {
        const si = (H - 1 - y) * row, di = y * row;
        for (let x = 0; x < row; x += 4) {
          dst[di + x] = src[si + x];
          dst[di + x + 1] = src[si + x + 1];
          dst[di + x + 2] = src[si + x + 2];
          if (src[si + x + 3] > 127) coverage++;
          dst[di + x + 3] = 255;
        }
      }
      // (an empty frame — the object hidden, or nothing visible to photograph — keeps the sketch)
      if (coverage > W * H * 0.01) {
        G.g.putImageData(G.image, 0, 0);
        url = G.canvas.toDataURL('image/jpeg', 0.88);
      }
    } catch (err) {
      console.warn('[polaroid] could not develop', id, err);
      url = null;
    } finally {
      for (const o of tagged) o.layers.disable(LAYER);
      scene.background = prevBg;
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(saveClear, prevAlpha);
      renderer.autoClear = prevAutoClear;
      if (sm.enabled) sm.needsUpdate = shot.context ? prevShadowUpdate : true;
    }
    return url;
  }

  /** One photo per frame (a burst — the guidebook's thumbnails — never stalls a frame twice). */
  const eyeNow = new THREE.Vector3(), lookTo = new THREE.Vector3(), lookDir = new THREE.Vector3();
  function pump(delay = 0) {
    if (pumping) return;
    pumping = true;
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      pumping = false;
      const job = queue[0];
      if (!job) return;
      // a piece photographed in place waits (≤ 5 s) until the rig has framed it for its page
      const rig = ctx.cameraRig;
      let eye = null;
      if (job.place) {
        const settled = rig && rig.focused && !rig.transitioning;
        if (!settled && performance.now() - job.since < 5000) {
          pump(120);
          return;
        }
        // (and it is this piece the camera looks at — not another one opened meanwhile)
        const hs = hotspotFor(job.id);
        if (settled && hs) {
          hs.center(lookTo).sub(ctx.camera.position);
          const dist = lookTo.length();
          ctx.camera.getWorldDirection(lookDir);
          if (dist < 16 && lookTo.dot(lookDir) > dist * 0.82) eye = eyeNow.copy(ctx.camera.position);
        }
      }
      queue.shift();
      const k = key(job.id);
      let url = cache.get(k) ?? null;
      if (!cache.has(k)) {
        url = shoot(job.id, eye);
        cache.set(k, url);
      }
      pending.delete(job.k);
      for (const r of job.resolve) r(url);
      if (queue.length) pump();
      else scheduleRelease();
    };
    if (delay) setTimeout(run, delay);
    else {
      requestAnimationFrame(run);
      setTimeout(run, 90); // (a hidden tab / the screenshot harness: no animation frames)
    }
  }

  return {
    available,
    cached(id) {
      return cache.get(key(id)) ?? null;
    },
    request(id, { live = false } = {}) {
      const k = key(id);
      if (cache.has(k)) return Promise.resolve(cache.get(k));
      if (!available(id)) return Promise.resolve(null);
      // (in place, a good view needs the rig framing the piece: not from the guidebook)
      const place = inPlace(id);
      if (place && !live) return Promise.resolve(null);
      const p = pending.get(k);
      if (p) return p.promise;
      const job = { id, k, place, since: performance.now(), resolve: [] };
      const promise = new Promise((r) => job.resolve.push(r));
      job.promise = promise;
      pending.set(k, job);
      queue.push(job);
      pump();
      return promise;
    },
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
