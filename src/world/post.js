// ─────────────────────────────────────────────────────────────────────────────
// Post-processing — the final image: a painted miniature seen through a macro
// lens.
//
//   scene      rendered once into an HDR (half-float, MSAA) target, with a
//              depth texture on 'high'
//   bloom      UnrealBloom mip chain with a soft knee: fairy lights, windows,
//              lanterns, fireflies and sun glints glow; stronger at night.
//              At night only the light ABOVE the threshold blooms (soft-knee
//              subtraction) and the halo is kept tight, so lights read as
//              small warm points with a gentle halo — never white blobs.
//              (Only the blur chain is used — the result is added in the
//              finish pass, so the HDR scene is never re-resolved.)
//   AO         ('high') half-res depth-only ambient occlusion (normals rebuilt
//              from depth, 12 spiral taps, depth-aware blur) — contact shadows
//              in the nooks of shingles, stones and timber; never dims glows.
//   DOF        ('high') depth of field around ctx.cameraRig.focusDistance:
//              half-resolution prefilter (colour + signed circle of
//              confusion) → 28-tap golden-angle gather with scatter-as-gather
//              weights (foreground bleeds over sharp things, background never
//              bleeds onto them) → mixed back at full resolution by CoC.
//              The near field is gentler than the far field (soft-saturating
//              CoC, wider in-focus band) so big foreground framing stays soft
//              but readable; the gather is luminance-weighted (Karis) and hot
//              pixels get a smaller CoC, so tiny bright things (fireflies,
//              bulbs) never explode into big bokeh discs.
//   finish     ONE pass: AO + DOF composite + bloom + the renderer's tone mapping &
//              exposure + colour grade + warm vignette + fine animated grain +
//              sRGB output. The grade is a golden storybook afternoon painted
//              with a restrained palette: a highlight shoulder lifts sunlit cap
//              tops, roofs and path stones to real highlights, overall
//              saturation is lower by day, warm hues (reds, caps, wood,
//              lamplight) keep theirs and glow honey-amber (olive is nudged
//              back to amber), yellow-greens (hue ≈ 70–140°: lawns, ferns,
//              leaves) are pulled towards sage — shaded greens drift towards a
//              cool teal depth, sunlit greens towards a warm gold-green — and
//              shadows get a cool teal-blue tint that spares warm hues.
//              Night: a moonlit blue shadow tint that is MULTIPLICATIVE
//              (hue-preserving — dark reds never clip to black) and spares
//              warm hues, so red & ochre caps stay burgundy & ochre; mid and
//              shadow greens lose their colour towards moonlit blue-teal
//              (Purkinje), lamps & fireflies keep theirs.
//              Saturation has a soft floor (never pushes a channel below 0).
//
// Tiers (quality.post): 'full' (high) = everything; 'lite' (medium) = bloom +
// grade, 2× MSAA (no depth → no AO/DOF); false (low) = a grade-only finishing
// pass (quality.grade: the same tone curve & grade at DPR 1, no bloom, AO, DOF
// or MSAA) — or the plain renderer (tone mapping only) where float targets are
// not renderable or with ?grade=0. The engine's frame-time governor may switch
// quality.ao / dof / bloom off at runtime. NaN/Inf pixels from any material
// are dropped before they can be smeared by the blurs. If anything throws —
// setup or a frame — we fall back to plain rendering for good.
//
// ctx.post = { composer (null — custom chain), bloom, settings, target, enabled, setEnabled(on) }
//   settings are live-tunable (see SETTINGS).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** Live-tunable settings (also exposed as ctx.post.settings). */
const SETTINGS = {
  // excess: 0 = classic UnrealBloom high pass (the whole pixel blooms once it
  // passes the threshold), 1 = only the energy above the threshold blooms.
  bloomDay: { strength: 0.32, radius: 0.55, threshold: 1.0, knee: 0.6, excess: 0 },
  bloomNight: { strength: 0.42, radius: 0.18, threshold: 1.25, knee: 0.7, excess: 1 },
  dof: true,
  /** Contact shadows in nooks ('high'): strength 0..1 and world radius. */
  ao: 0.7,
  aoRadius: 0.55,
  /** CoC scale in px (at 720p): blur of something infinitely far behind the focus. */
  aperture: 10,
  /** In-focus dead zone (px) so the subject stays pin sharp. */
  focusBand: 0.9,
  maxBlur: 9, // px at 720p (behind the focus; enough for the macro look, the far forest keeps its trunks)
  /** Near field (in front of the focus): wider dead zone, CoC scale, and a
   *  soft saturation towards nearMaxBlur so big foreground framing stays readable. */
  nearBand: 1.2,
  nearScale: 0.75,
  nearMaxBlur: 5, // px at 720p
  /** Luminance weighting of the bokeh gather (0 = off): tiny hot points stay small & dim. */
  dofBrightTame: 0.7,
  /** Extra exposure of the HDR path: additive light (shafts, halos, mist) is
   *  compressed by the tone curve here but not in the plain path — keep parity. */
  exposure: 1.06,
  /** Day exposure (the night keeps `exposure`). */
  exposureDay: 1.06,
  /** Global saturation by day / night (night: the moonlit look, unchanged). */
  saturationDay: 0.87,
  saturation: 1.12,
  /** Warm hues (reds, wood, caps, lamplight) keep at least this saturation by day. */
  warmSaturationDay: 1.1,
  /**
   * Yellow-greens (hue ≈ 65–145°): saturation × this (sage, not neon) — 0..1
   * strength in `sage`. By day shaded greens lose more colour than sunlit ones
   * (greenSaturationDay → greenSaturationSunDay across `greenPivot`).
   */
  greenSaturationDay: 0.57,
  greenSaturationSunDay: 0.82,
  greenSaturation: 0.84,
  sage: 1,
  /**
   * Painterly greens by day (degrees of hue rotation, greens only): greens in
   * shade turn towards a cool teal depth, sunlit greens towards a warm
   * gold-green; `pivot` = display luminance [shade end, sun start]. (Moderate:
   * stronger turns ice the moss & ivy cyan.)
   */
  greenShade: 30,
  greenSun: -20,
  greenPivot: [0.014, 0.1],
  /** Night: Purkinje shift — mid & shadow greens drift towards moonlit blue-teal (0..1). */
  purkinje: 0.3,
  /**
   * Highlight shoulder (day): a lift of the upper tones in perceptual space
   * (v = √luminance; v += gain·v(1−v)·smoothstep(start, full, v)), so sunlit cap
   * tops, roofs and path stones reach a real highlight instead of compressing
   * into the mid tones. [gain, start, full].
   */
  highlightLiftDay: [0.55, 0.28, 0.55],
  /**
   * 'low' (grade-only pass): no canopy shadow map, so the unshadowed glen is
   * brighter — a little less exposure and a softer highlight lift keep it from
   * washing out. [exposure ×, highlight-lift gain ×]
   */
  gradeLow: [0.92, 0.55],
  /** Highlights keep their hue (0..1) instead of bleaching to white — warm lights stay warm. */
  highlightHueDay: 0.2,
  highlightHueNight: 0.55,
  /** Day: golden warmth of the upper mid tones & highlights. */
  warmth: 0.12,
  /**
   * Shadow tint — MULTIPLICATIVE (hue-preserving: a dark red stays a dark red,
   * it is never subtracted to black) plus a tiny additive lift, weighted
   * towards the shadows. Day: a cool teal-blue depth (warm hues are spared, so
   * wood & caps stay warm in the shade); night: a gentle moonlit blue.
   */
  shadowTintDay: { mul: [0.95, 1.0, 1.07], add: [0.0, 0.002, 0.004] },
  shadowTintNight: { mul: [0.92, 1.0, 1.06], add: [0.0, 0.003, 0.008] },
  /** Warm hues (wood, red & ochre caps, lamplight) are protected from the cool night grade (0..1). */
  warmProtect: 0.7,
  /** Day: warm hues get a little extra glow (honey wood) and olive is nudged back to amber (0..1). */
  woodGlow: 1,
  lift: 0.018,
  vignette: 0.3,
  grain: 0.022,
};

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const COC_GLSL = /* glsl */ `
  uniform sampler2D tDepth;
  uniform float uNear, uFar, uFocus, uAperture, uBand, uMaxBlur;
  uniform float uNearBand, uNearScale, uNearMax;
  float viewDepth(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    // perspective depth → positive view distance
    return (uNear * uFar) / ((uFar - uNear) * d - uFar);
  }
  // signed circle of confusion in px (−: in front of the focus, +: behind)
  float cocAt(vec2 uv) {
    float z = -viewDepth(uv);
    float c = uAperture * (z - uFocus) / max(z, 1e-3);
    if (c >= 0.0) return min(max(c - uBand, 0.0), uMaxBlur);
    // near field: wider dead zone, then a soft saturation towards uNearMax
    float n = max(-c - uNearBand, 0.0) * uNearScale;
    return -uNearMax * (1.0 - exp(-n / max(uNearMax, 1e-3)));
  }
`;

/** Uniforms used by COC_GLSL. */
const cocUniformDefs = () => ({
  tDepth: { value: null },
  uNear: { value: 0.1 },
  uFar: { value: 100 },
  uFocus: { value: 20 },
  uAperture: { value: 10 },
  uBand: { value: 1 },
  uMaxBlur: { value: 10 },
  uNearBand: { value: 1 },
  uNearScale: { value: 1 },
  uNearMax: { value: 5 },
});

/** Half-res: colour (4-tap box) + signed CoC (in half-res px). */
const PrefilterShader = {
  uniforms: {
    tColor: { value: null },
    uTexel: { value: new THREE.Vector2() },
    ...cocUniformDefs(),
    tAO: { value: null },
    uAO: { value: 0 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor, tAO;
    uniform float uAO;
    uniform vec2 uTexel; // full-res texel
    varying vec2 vUv;
    ${COC_GLSL}
    void main() {
      vec2 o = uTexel * 0.5;
      vec3 c = texture2D(tColor, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tColor, vUv + vec2(o.x, -o.y)).rgb
             + texture2D(tColor, vUv + vec2(-o.x, o.y)).rgb + texture2D(tColor, vUv + vec2(o.x, o.y)).rgb;
      c *= 0.25;
      if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
      if (uAO > 0.0) c *= mix(1.0, texture2D(tAO, vUv).r, uAO * (1.0 - smoothstep(1.0, 3.0, max(max(c.r, c.g), c.b))));
      // tame fireflies so single hot pixels do not become big discs
      float hot = max(max(c.r, c.g), c.b);
      c = c / (1.0 + hot * 0.12);
      float coc = cocAt(vUv) * 0.5; // half-res px
      // hot points (bulbs, fireflies, glints) spread over a smaller circle
      coc *= mix(1.0, 0.5, smoothstep(1.2, 4.0, hot));
      gl_FragColor = vec4(c, coc);
    }
  `,
};

const TAPS = 28;
/**
 * Half-res gather blur (scatter-as-gather). Two layers:
 *   far/in-focus  every sample may only spread as far as its own CoC, and a
 *                 sample behind a sharper centre never spreads onto it;
 *   near          foreground samples are gathered separately with their real
 *                 scatter weight (1 / their disc area), which gives a true
 *                 coverage: ½ on the silhouette, fading to 0 one CoC outside
 *                 it — a soft bokeh silhouette instead of a semi-transparent
 *                 ghost with a hard cut edge.
 * Output: rgb = near layer composited over the far layer (premultiplied by
 * the near coverage), a = near coverage.
 */
const BokehShader = {
  uniforms: {
    tPre: { value: null },
    uTexel: { value: new THREE.Vector2() }, // half-res texel
    uMaxR: { value: 6 },
    uTame: { value: 0.7 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tPre;
    uniform vec2 uTexel;
    uniform float uMaxR, uTame;
    varying vec2 vUv;
    // luminance weight (Karis): a few hot taps cannot dominate a disc
    float tame(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)) * uTame); }
    void main() {
      vec4 c = texture2D(tPre, vUv);
      float cocC = c.a;
      float tc = tame(c.rgb);
      // (each tap stands for 1/TAPS of the gather disc's area)
      float area = uMaxR * uMaxR / ${(TAPS + 1).toFixed(1)};
      float nearC = smoothstep(0.6, 1.8, -cocC);
      vec3 farSum = c.rgb * tc * (1.0 - nearC);
      float farW = tc * (1.0 - nearC) + 1e-4;
      float nearScatterC = nearC * area / max(cocC * cocC, 1.0);
      vec3 nearSum = c.rgb * tc * nearScatterC;
      float nearW = tc * nearScatterC;
      float cover = nearScatterC;
      const float GOLDEN = 2.39996323;
      for (int i = 0; i < ${TAPS}; i++) {
        float fi = float(i);
        float r = uMaxR * sqrt((fi + 0.5) / ${TAPS.toFixed(1)});
        float th = fi * GOLDEN;
        vec4 s = texture2D(tPre, vUv + vec2(cos(th), sin(th)) * r * uTexel);
        float cs = s.a;
        float ts = tame(s.rgb);
        float nearS = smoothstep(0.6, 1.8, -cs);
        // far layer: a sample behind a sharper centre must not spread onto it
        float reach = cs > cocC ? min(abs(cs), max(abs(cocC), 0.0) * 1.5 + 0.35) : abs(cs);
        float wf = smoothstep(r - 0.75, r + 0.25, reach) * (1.0 - nearS) * ts;
        farSum += s.rgb * wf;
        farW += wf;
        // near layer: the sample's disc covers this pixel → its energy / disc area
        float wn = smoothstep(r - 0.75, r + 0.25, abs(cs)) * nearS * area / max(cs * cs, 1.0);
        cover += wn;
        nearSum += s.rgb * wn * ts;
        nearW += wn * ts;
      }
      vec3 farCol = farSum / farW;
      vec3 nearCol = nearW > 1e-5 ? nearSum / nearW : farCol;
      float a = clamp(cover, 0.0, 1.0);
      gl_FragColor = vec4(mix(farCol, nearCol, a), a);
    }
  `,
};

const DEPTH_GLSL = /* glsl */ `
  uniform sampler2D tDepth;
  uniform float uNear, uFar;
  uniform vec2 uTanHalf; // tan(fov/2) * (aspect, 1)
  float viewZ(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    return (uNear * uFar) / ((uFar - uNear) * d - uFar);
  }
  vec3 viewPos(vec2 uv) {
    float z = viewZ(uv);
    return vec3((uv * 2.0 - 1.0) * uTanHalf * (-z), z);
  }
`;

const AO_SAMPLES = 12;
/** Half-res depth-only ambient occlusion (Alchemy-style), normals rebuilt from depth. */
const AOShader = {
  uniforms: {
    tDepth: { value: null },
    uNear: { value: 0.1 },
    uFar: { value: 100 },
    uTanHalf: { value: new THREE.Vector2(1, 1) },
    uTexel: { value: new THREE.Vector2() }, // half-res texel
    uRadius: { value: 0.5 },
    uProjScale: { value: 300 }, // px per world unit at distance 1 (half res)
    uIntensity: { value: 1 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform vec2 uTexel;
    uniform float uRadius, uProjScale, uIntensity;
    varying vec2 vUv;
    ${DEPTH_GLSL}
    void main() {
      vec3 P = viewPos(vUv);
      float dist = -P.z;
      if (dist > 70.0 || dist >= uFar * 0.98) { gl_FragColor = vec4(1.0); return; }
      // robust normal: use the neighbour on the side with the smaller depth jump
      vec3 pl = viewPos(vUv - vec2(uTexel.x, 0.0)), pr = viewPos(vUv + vec2(uTexel.x, 0.0));
      vec3 pd = viewPos(vUv - vec2(0.0, uTexel.y)), pu = viewPos(vUv + vec2(0.0, uTexel.y));
      vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
      vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
      vec3 N = normalize(cross(dx, dy));
      float rPx = clamp(uRadius * uProjScale / dist, 1.5, 48.0);
      float rot = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
      float occ = 0.0;
      for (int i = 0; i < ${AO_SAMPLES}; i++) {
        float t = (float(i) + 0.5) / ${AO_SAMPLES.toFixed(1)};
        float a = float(i) * 2.39996323 + rot;
        vec2 off = vec2(cos(a), sin(a)) * rPx * t;
        vec3 S = viewPos(vUv + off * uTexel);
        vec3 v = S - P;
        float vv = dot(v, v);
        float range = 1.0 - smoothstep(uRadius, uRadius * 2.5, sqrt(vv));
        occ += max(dot(v, N) - 0.015 * dist * 0.08, 0.0) / (vv + 0.02) * range;
      }
      float ao = clamp(1.0 - uIntensity * uRadius * occ * (2.0 / ${AO_SAMPLES.toFixed(1)}), 0.0, 1.0);
      // fade out with distance (far things live in the mist)
      ao = mix(ao, 1.0, smoothstep(30.0, 70.0, dist));
      gl_FragColor = vec4(ao, ao, ao, 1.0);
    }
  `,
};

/** Depth-aware 4×4 blur of the half-res AO. */
const AOBlurShader = {
  uniforms: {
    tAO: { value: null },
    tDepth: { value: null },
    uNear: { value: 0.1 },
    uFar: { value: 100 },
    uTanHalf: { value: new THREE.Vector2(1, 1) },
    uTexel: { value: new THREE.Vector2() },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tAO;
    uniform vec2 uTexel;
    varying vec2 vUv;
    ${DEPTH_GLSL}
    void main() {
      float z0 = viewZ(vUv);
      float sum = 0.0, wsum = 0.0;
      for (int y = -2; y <= 1; y++) {
        for (int x = -2; x <= 1; x++) {
          vec2 uv = vUv + (vec2(float(x), float(y)) + 0.5) * uTexel;
          float z = viewZ(uv);
          float w = 1.0 / (0.02 + abs(z - z0) * 4.0 / max(-z0, 1.0));
          sum += texture2D(tAO, uv).r * w;
          wsum += w;
        }
      }
      float ao = sum / wsum;
      gl_FragColor = vec4(ao, ao, ao, 1.0);
    }
  `,
};

class FinishMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      name: 'WoodlandFinish',
      uniforms: {
        tColor: { value: null },
        tBloom: { value: null },
        tBokeh: { value: null },
        ...cocUniformDefs(),
        tAO: { value: null },
        uAO: { value: 0 },
        uUseBloom: { value: 0 },
        uUseDof: { value: 0 },
        uExposure: { value: SETTINGS.exposure },
        uHighlightHue: { value: 0.2 },
        uSaturation: { value: SETTINGS.saturation },
        uGreenSat: { value: SETTINGS.greenSaturation },
        uGreenSatSun: { value: SETTINGS.greenSaturation },
        uWarmSat: { value: SETTINGS.warmSaturationDay },
        uSage: { value: SETTINGS.sage },
        uGreenShift: { value: new THREE.Vector4(SETTINGS.greenShade, SETTINGS.greenSun, ...SETTINGS.greenPivot) },
        uHiLift: { value: new THREE.Vector3(...SETTINGS.highlightLiftDay) },
        uPurkinje: { value: SETTINGS.purkinje },
        uWarmth: { value: SETTINGS.warmth },
        uShadowMul: { value: new THREE.Vector3(...SETTINGS.shadowTintDay.mul) },
        uShadowAdd: { value: new THREE.Vector3(...SETTINGS.shadowTintDay.add) },
        uWarmProtect: { value: SETTINGS.warmProtect },
        uWoodGlow: { value: SETTINGS.woodGlow },
        uLift: { value: SETTINGS.lift },
        uLiftColor: { value: new THREE.Color('#3a3426') },
        uVignette: { value: SETTINGS.vignette },
        uVignetteColor: { value: new THREE.Color('#2a1a10') },
        uGrain: { value: SETTINGS.grain },
        uAspect: { value: 1 },
        uNight: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor, tBloom, tBokeh, tAO;
        uniform float uUseBloom, uUseDof, uAO;
        uniform float uExposure, uSaturation, uWarmth, uLift, uVignette, uGrain, uAspect, uNight, uTime, uHighlightHue;
        uniform float uWarmProtect, uWoodGlow, uGreenSat, uGreenSatSun, uWarmSat, uSage, uPurkinje;
        uniform vec4 uGreenShift;
        uniform vec3 uShadowMul, uShadowAdd, uLiftColor, uVignetteColor, uHiLift;
        varying vec2 vUv;
        ${COC_GLSL}
        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        // hue (0..1) of a colour
        float hueOf(vec3 c) {
          float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
          float d = mx - mn;
          if (d < 1e-5) return 0.0;
          float h = mx == c.r ? mod((c.g - c.b) / d, 6.0) : mx == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0;
          return h / 6.0;
        }
        // 1 inside a hue band (centre & half widths in degrees), 0 outside
        float hueBand(float h, float centre, float full, float fade) {
          float dh = abs(fract(h - centre / 360.0 + 0.5) - 0.5) * 360.0;
          return 1.0 - smoothstep(full, fade, dh);
        }
        // rotate the hue (radians, + = red → green → blue) around the grey axis
        vec3 hueRotate(vec3 c, float a) {
          const vec3 k = vec3(0.57735027);
          float cs = cos(a), sn = sin(a);
          return c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs);
        }
        void main() {
          vec3 col = texture2D(tColor, vUv).rgb;
          if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
          if (uAO > 0.0) {
            // contact shadows — but never dim things that glow
            float glow = smoothstep(1.0, 3.0, max(max(col.r, col.g), col.b));
            col *= mix(1.0, texture2D(tAO, vUv).r, uAO * (1.0 - glow));
          }
          if (uUseDof > 0.5) {
            vec4 b = texture2D(tBokeh, vUv);
            float coc = abs(cocAt(vUv));
            // blurred where the pixel itself is out of focus, or where a
            // foreground bokeh silhouette covers it (b.rgb is already composited)
            float k = max(smoothstep(0.35, 2.2, coc), smoothstep(0.02, 0.3, b.a));
            col = mix(col, b.rgb, k);
          }
          if (uUseBloom > 0.5) col += texture2D(tBloom, vUv).rgb;

          // the renderer's tone mapping (exposure included)
          vec3 hdr = col * uExposure;
          col = toneMapping(hdr);
          // keep lights warm: the filmic curve bleaches bright warm lights to
          // white, so in the highlights blend towards a hue-preserving curve
          // (the max channel goes through the tone curve, the hue is kept)
          float mx = max(max(hdr.r, hdr.g), hdr.b);
          if (mx > 0.9 && uHighlightHue > 0.0) {
            vec3 hp = hdr * (toneMapping(vec3(mx)).g / mx);
            col = mix(col, hp, uHighlightHue * smoothstep(0.9, 3.5, mx));
          }
          col = clamp(col, 0.0, 1.0);

          // grade (display-referred linear)
          float day = 1.0 - uNight;
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          // the highlight shoulder (day): a perceptual lift of the upper tones, so
          // sunlit cap tops, roofs and path stones become real highlights (hue kept;
          // 1.0 stays 1.0, the darks are untouched)
          if (uHiLift.x > 0.0 && day > 0.0 && l > 1e-4) {
            float v = sqrt(l);
            float v2 = v + uHiLift.x * day * v * (1.0 - v) * smoothstep(uHiLift.y, uHiLift.z, v);
            col = min(col * (v2 * v2 / l), vec3(1.0));
            l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          }
          float cmx = max(max(col.r, col.g), col.b), cmn = min(min(col.r, col.g), col.b);
          // warm hues (wood, red & ochre caps, lamplight): reds…ambers with some chroma
          float hue = hueOf(col);
          float chroma = smoothstep(0.06, 0.22, (cmx - cmn) / max(cmx, 1e-4));
          float warm = hueBand(hue, 22.0, 24.0, 40.0) * chroma;
          // yellow-greens (≈ 70–140°: lawns, ferns, sunlit leaves): sage/olive, not neon;
          // by moonlight they lose even more colour (Purkinje: the eye's rods see no green)
          float green = hueBand(hue, 105.0, 38.0, 55.0) * chroma;
          float sageK = uSage * green * (1.0 + 0.5 * uNight);
          // shade (0) … sun (1) for the greens' saturation & hue turn
          float sunK = smoothstep(uGreenShift.z, uGreenShift.w, l);
          // saturation with a soft floor: the boost may never push a channel
          // below half its value (so dark reds are never clipped to black).
          // Day: a painterly, lower overall saturation — warm hues (reds, wood,
          // caps, lamplight) keep theirs; shaded greens lose the most.
          float sat = uSaturation * mix(1.0, mix(uGreenSat, uGreenSatSun, sunK), sageK);
          sat = mix(sat, max(sat, uWarmSat), warm);
          if (sat > 1.0 && cmn < l) sat = min(sat, (l - 0.5 * cmn) / max(l - cmn, 1e-5));
          col = mix(vec3(l), col, sat);
          // painterly greens (day): greens in shade turn towards a cool teal-blue
          // depth, sunlit greens towards a warm yellow-green (luminance mostly kept)
          if (green > 0.0 && day > 0.0) {
            float ang = radians(mix(uGreenShift.x, uGreenShift.y, sunK)) * green * day;
            col = max(hueRotate(col, ang), 0.0);
            float l2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col *= mix(1.0, l / max(l2, 1e-5), 0.65);
          }
          // the brightest acid yellow-greens settle a little (value, not hue) …
          col *= 1.0 - 0.07 * sageK * smoothstep(0.35, 0.8, l) * hueBand(hue, 85.0, 18.0, 30.0);
          // day: wood glows honey/amber instead of olive — warm hues get a touch
          // more warmth, olive (yellow-brown under the green canopy light) is
          // nudged back towards amber. Greens and blues are untouched.
          float dayK = uWoodGlow * (1.0 - uNight);
          float olive = hueBand(hue, 52.0, 7.0, 17.0) * chroma;
          col.g -= (col.g - col.b) * 0.12 * olive * dayK;
          col *= mix(vec3(1.0), vec3(1.05, 1.0, 0.92), warm * dayK * 0.6);
          // shadow tint: multiplicative + a tiny lift — hue-preserving; warm
          // hues keep most of their colour at night
          float sh = (1.0 - l) * (1.0 - l);
          vec3 tintMul = mix(uShadowMul, vec3(1.0), warm * uWarmProtect * mix(0.6, 1.0, uNight));
          col = mix(col, col * tintMul + uShadowAdd, sh);
          // … and green shadows cool a touch towards the misty blue-green depth
          col *= mix(vec3(1.0), vec3(0.95, 1.0, 1.08), min(sageK, 1.0) * sh);
          col *= mix(vec3(1.0), vec3(1.0 + uWarmth, 1.0 + uWarmth * 0.35, 1.0 - uWarmth * 0.6), smoothstep(0.25, 0.9, l));
          // moonlight: cool the greens a little without crushing anything (reds & ochres keep their hue)
          col = mix(col, l * vec3(0.78, 0.9, 1.25), uNight * 0.18 * (1.0 - warm * uWarmProtect));
          // Purkinje (night): mid & shadow greens drift towards a moonlit blue-teal;
          // bright things (fireflies, lamps) and warm hues keep their colour
          col = mix(col, l * vec3(0.7, 0.88, 1.2), uPurkinje * uNight * green * (1.0 - smoothstep(0.1, 0.35, l)));
          col = max(col, 0.0);
          // softly lifted blacks: neutral-warm by day, deep blue by night (never grey)
          col = col * (1.0 - uLift) + uLiftColor * uLift * 2.2;
          // warm, gentle vignette
          vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
          float v = smoothstep(0.42, 1.15, length(q) * 1.1) * uVignette;
          col = mix(col, col * uVignetteColor * 2.4, v);
          col = clamp(col, 0.0, 1.0);

          gl_FragColor = linearToOutputTexel(vec4(col, 1.0));
          // fine film grain (in display space, strongest in the mid tones)
          float g = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 517.0) - 0.5;
          float mid = 1.0 - abs(l * 2.0 - 1.0);
          gl_FragColor.rgb += g * uGrain * (0.4 + 0.6 * mid);
        }
      `,
      depthTest: false,
      depthWrite: false,
      // keeps three's toneMapping()/exposure available in this shader (the
      // tonemapping chunk itself is not included — we call it ourselves)
      toneMapped: true,
    });
  }
}

/** UnrealBloomPass, but we only want its blurred mip composite (added in the finish pass). */
class WoodlandBloom extends UnrealBloomPass {
  constructor(...args) {
    super(...args);
    // A single NaN/Inf pixel from any material would be smeared over the whole
    // screen by the blur chain — drop those, and cap hot spots.
    const m = this.materialHighPassFilter;
    // uExcess blends the classic high pass (whole pixel) with a soft-knee
    // subtraction (only the energy above the threshold blooms).
    this.highPassUniforms.uExcess = { value: 0 };
    m.uniforms.uExcess = this.highPassUniforms.uExcess;
    m.fragmentShader = m.fragmentShader
      .replace('uniform float smoothWidth;', 'uniform float smoothWidth;\nuniform float uExcess;')
      .replace(
        'vec4 texel = texture2D( tDiffuse, vUv );',
        `vec4 texel = texture2D( tDiffuse, vUv );
      if ( any( isnan( texel ) ) || any( isinf( texel ) ) ) texel = vec4( 0.0 );
      texel.rgb = min( texel.rgb, vec3( 24.0 ) );`
      )
      .replace(
        'gl_FragColor = mix( outputColor, texel, alpha );',
        `vec4 classic = mix( outputColor, texel, alpha );
      float br = max( max( texel.r, texel.g ), texel.b );
      float kn = max( smoothWidth, 1e-3 );
      float rq = clamp( br - luminosityThreshold + kn, 0.0, 2.0 * kn );
      rq = rq * rq / ( 4.0 * kn );
      float ex = max( rq, br - luminosityThreshold ) / max( br, 1e-4 );
      gl_FragColor = mix( classic, vec4( texel.rgb * ex, 1.0 ), uExcess );`
      );
    m.needsUpdate = true;
  }

  renderBloom(renderer, input) {
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.getClearColor(this._oldClearColor);
    this._oldClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(this.clearColor, 0);

    this.highPassUniforms.tDiffuse.value = input;
    this.highPassUniforms.luminosityThreshold.value = this.threshold;
    this._fsQuad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    this._fsQuad.render(renderer);

    let inputRT = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const m = this.separableBlurMaterials[i];
      this._fsQuad.material = m;
      m.uniforms.colorTexture.value = inputRT.texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      this._fsQuad.render(renderer);
      m.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      this._fsQuad.render(renderer);
      inputRT = this.renderTargetsVertical[i];
    }

    this._fsQuad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.bloomStrength.value = this.strength;
    this.compositeMaterial.uniforms.bloomRadius.value = this.radius;
    this.compositeMaterial.uniforms.bloomTintColors.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    this._fsQuad.render(renderer);

    renderer.setClearColor(this._oldClearColor, this._oldClearAlpha);
    renderer.autoClear = oldAutoClear;
    return this.renderTargetsHorizontal[0].texture;
  }
}

export default async function build(ctx) {
  const { engine, scene, camera } = ctx;
  const quality = ctx.quality ?? engine.quality;
  // post is the last world module: the world is complete, so the lighting can
  // hand out its point-light budget now — before any shader is compiled.
  ctx.lights?.allocate?.();
  // quality.post: 'full' (high: AO + DOF + bloom + grade), 'lite' (medium:
  // bloom + grade, 2× MSAA), false (low: plain renderer, tone mapping only).
  // 'low' (post false, quality.grade): a grade-only finishing pass — the scene in
  // a half-float target at DPR 1, then ONE fullscreen quad with the same tone
  // curve, lift, gamma, gain and hue-selective saturation (no bloom, AO or DOF),
  // so the low tier keeps the art direction. Needs a renderable float target.
  let mode = quality.post === true ? (quality.tier === 'high' ? 'full' : 'lite') : quality.post;
  const renderer = engine.renderer;
  if (mode !== 'full' && mode !== 'lite' && quality.grade && engine.params?.get('grade') !== '0') {
    const ext = renderer.extensions;
    if (renderer.capabilities.isWebGL2 && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'))) mode = 'grade';
  }
  if (mode !== 'full' && mode !== 'lite' && mode !== 'grade') return {};
  const useDof = mode === 'full';
  const useBloom = mode !== 'grade';

  let sceneRT, bloom, preRT, bokehRT, aoRT, aoBlurRT, finishMat, quads;
  try {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    // (the canvas itself is created without antialiasing whenever post runs —
    // the scene's MSAA happens here)
    sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      // ('grade' — low — keeps the plain renderer's lack of MSAA)
      samples: mode === 'grade' ? 0 : mode === 'lite' || pr >= 1.75 ? 2 : 4,
      depthTexture: useDof ? new THREE.DepthTexture(size.x, size.y) : null,
    });
    sceneRT.texture.name = 'woodland.post.scene';
    const css = renderer.getSize(new THREE.Vector2());
    if (useBloom) {
      bloom = new WoodlandBloom(new THREE.Vector2(css.x, css.y), SETTINGS.bloomDay.strength, SETTINGS.bloomDay.radius, SETTINGS.bloomDay.threshold);
      bloom.highPassUniforms.smoothWidth.value = SETTINGS.bloomDay.knee;
    }
    finishMat = new FinishMaterial();
    quads = { finish: new FullScreenQuad(finishMat) };
    if (useDof) {
      const half = { type: THREE.HalfFloatType, depthBuffer: false };
      preRT = new THREE.WebGLRenderTarget(Math.ceil(size.x / 2), Math.ceil(size.y / 2), half);
      bokehRT = new THREE.WebGLRenderTarget(Math.ceil(size.x / 2), Math.ceil(size.y / 2), half);
      preRT.texture.minFilter = preRT.texture.magFilter = THREE.LinearFilter;
      quads.pre = new FullScreenQuad(new THREE.ShaderMaterial({ ...PrefilterShader, uniforms: THREE.UniformsUtils.clone(PrefilterShader.uniforms), depthTest: false, depthWrite: false }));
      quads.bokeh = new FullScreenQuad(new THREE.ShaderMaterial({ ...BokehShader, uniforms: THREE.UniformsUtils.clone(BokehShader.uniforms), depthTest: false, depthWrite: false }));
      const aoOpts = { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false };
      aoRT = new THREE.WebGLRenderTarget(Math.ceil(size.x / 2), Math.ceil(size.y / 2), aoOpts);
      aoBlurRT = new THREE.WebGLRenderTarget(Math.ceil(size.x / 2), Math.ceil(size.y / 2), aoOpts);
      quads.ao = new FullScreenQuad(new THREE.ShaderMaterial({ ...AOShader, uniforms: THREE.UniformsUtils.clone(AOShader.uniforms), depthTest: false, depthWrite: false }));
      quads.aoBlur = new FullScreenQuad(new THREE.ShaderMaterial({ ...AOBlurShader, uniforms: THREE.UniformsUtils.clone(AOBlurShader.uniforms), depthTest: false, depthWrite: false }));
    }
  } catch (err) {
    console.warn('[post] setup failed, rendering without post-processing', err);
    return {};
  }

  const fu = finishMat.uniforms;
  function resize(w, h) {
    const pr = renderer.getPixelRatio();
    const W = Math.floor(w * pr), H = Math.floor(h * pr);
    sceneRT.setSize(W, H);
    bloom?.setSize(w, h);
    if (useDof) {
      preRT.setSize(Math.ceil(W / 2), Math.ceil(H / 2));
      bokehRT.setSize(Math.ceil(W / 2), Math.ceil(H / 2));
      quads.pre.material.uniforms.uTexel.value.set(1 / W, 1 / H);
      quads.bokeh.material.uniforms.uTexel.value.set(2 / W, 2 / H);
      aoRT.setSize(Math.ceil(W / 2), Math.ceil(H / 2));
      aoBlurRT.setSize(Math.ceil(W / 2), Math.ceil(H / 2));
      quads.ao.material.uniforms.uTexel.value.set(2 / W, 2 / H);
      quads.aoBlur.material.uniforms.uTexel.value.set(2 / W, 2 / H);
    }
    fu.uAspect.value = w / Math.max(h, 1);
  }
  const s0 = renderer.getSize(new THREE.Vector2());
  resize(s0.x, s0.y);
  engine.onResize(resize);

  // Count every pass of a frame in renderer.info (debug.stats()).
  renderer.info.autoReset = false;
  let failed = false;
  let active = true;
  const plain = () => {
    renderer.info.reset();
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  };

  function cocUniforms(u, H) {
    // CoC sizes are authored for a 720 px tall image
    const k = H / 720;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uFocus.value = Math.max(0.5, ctx.cameraRig?.focusDistance ?? 20);
    u.uAperture.value = SETTINGS.aperture * k;
    u.uBand.value = SETTINGS.focusBand * k;
    u.uMaxBlur.value = SETTINGS.maxBlur * k;
    u.uNearBand.value = SETTINGS.nearBand * k;
    u.uNearScale.value = SETTINGS.nearScale;
    u.uNearMax.value = SETTINGS.nearMaxBlur * k;
  }

  function frame(dt) {
    renderer.info.reset();
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);

    // (quality.ao / dof / bloom: live flags the engine's frame-time governor may switch off)
    const bloomTex = bloom && quality.bloom !== false && bloom.strength > 0.001 ? bloom.renderBloom(renderer, sceneRT.texture) : null;

    const aoOn = useDof && SETTINGS.ao > 0.001 && quality.ao !== false;
    if (aoOn) {
      const H = sceneRT.height;
      const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      for (const q of [quads.ao, quads.aoBlur]) {
        const u = q.material.uniforms;
        u.tDepth.value = sceneRT.depthTexture;
        u.uNear.value = camera.near;
        u.uFar.value = camera.far;
        u.uTanHalf.value.set(tanY * camera.aspect, tanY);
      }
      const au = quads.ao.material.uniforms;
      au.uRadius.value = SETTINGS.aoRadius;
      au.uProjScale.value = (H / 2) / (2 * tanY);
      renderer.setRenderTarget(aoRT);
      quads.ao.render(renderer);
      quads.aoBlur.material.uniforms.tAO.value = aoRT.texture;
      renderer.setRenderTarget(aoBlurRT);
      quads.aoBlur.render(renderer);
    }
    const aoK = aoOn ? SETTINGS.ao * (1 - 0.35 * (ctx.env?.night ?? 0)) : 0;
    fu.tAO.value = aoOn ? aoBlurRT.texture : null;
    fu.uAO.value = aoK;

    const dofOn = useDof && SETTINGS.dof && quality.dof !== false;
    if (dofOn) {
      const H = sceneRT.height;
      const pu = quads.pre.material.uniforms;
      pu.tColor.value = sceneRT.texture;
      pu.tDepth.value = sceneRT.depthTexture;
      pu.tAO.value = aoOn ? aoBlurRT.texture : null;
      pu.uAO.value = aoK;
      cocUniforms(pu, H);
      renderer.setRenderTarget(preRT);
      quads.pre.render(renderer);
      const bu = quads.bokeh.material.uniforms;
      bu.tPre.value = preRT.texture;
      bu.uMaxR.value = (Math.max(SETTINGS.maxBlur, SETTINGS.nearMaxBlur) * (H / 720)) / 2;
      bu.uTame.value = SETTINGS.dofBrightTame;
      renderer.setRenderTarget(bokehRT);
      quads.bokeh.render(renderer);
      fu.tDepth.value = sceneRT.depthTexture;
      fu.tBokeh.value = bokehRT.texture;
      cocUniforms(fu, H);
    }
    fu.uUseDof.value = dofOn ? 1 : 0;
    fu.tColor.value = sceneRT.texture;
    fu.tBloom.value = bloomTex;
    fu.uUseBloom.value = bloomTex ? 1 : 0;
    fu.uTime.value += dt || 1 / 60;
    renderer.setRenderTarget(null);
    quads.finish.render(renderer);
  }

  engine.setRenderFn((dt) => {
    if (failed || !active) return plain();
    try {
      frame(dt);
    } catch (err) {
      failed = true;
      console.warn('[post] render failed, falling back to plain rendering', err);
      renderer.setRenderTarget(null);
      plain();
    }
  });

  const vignetteDay = new THREE.Color('#2a1a10');
  const vignetteNight = new THREE.Color('#0a1430');
  // lifted blacks: neutral-warm by day (no teal murk), deep blue by night
  const liftDay = new THREE.Color('#3a3426');
  const liftNight = new THREE.Color('#14223e');
  const tmpV = new THREE.Vector3();
  let lastNight = -1;

  ctx.post = {
    composer: null,
    bloom,
    settings: SETTINGS,
    /** The HDR scene target the world renders into (null when post is off) — main.js warms shaders up against it. */
    get target() {
      return !failed && active ? sceneRT ?? null : null;
    },
    get enabled() {
      return !failed && active;
    },
    /** Toggle the post chain at runtime (debug / A-B comparisons). */
    setEnabled(on) {
      active = !!on;
    },
  };

  return {
    update() {
      const n = ctx.env?.night ?? 0;
      if (n !== lastNight) {
        lastNight = n;
        const D = SETTINGS.bloomDay, N = SETTINGS.bloomNight;
        if (bloom) {
          bloom.strength = D.strength + (N.strength - D.strength) * n;
          bloom.radius = D.radius + (N.radius - D.radius) * n;
          bloom.threshold = D.threshold + (N.threshold - D.threshold) * n;
          bloom.highPassUniforms.smoothWidth.value = D.knee + (N.knee - D.knee) * n;
          bloom.highPassUniforms.uExcess.value = D.excess + (N.excess - D.excess) * n;
        }
        fu.uVignetteColor.value.copy(vignetteDay).lerp(vignetteNight, n);
        fu.uLiftColor.value.copy(liftDay).lerp(liftNight, n);
        fu.uNight.value = n;
      }
      fu.uVignette.value = SETTINGS.vignette * (1 + 0.3 * n);
      // day ↔ night: the night end is the moonlit grade
      fu.uSaturation.value = SETTINGS.saturationDay + (SETTINGS.saturation - SETTINGS.saturationDay) * n;
      fu.uWarmSat.value = SETTINGS.warmSaturationDay + (SETTINGS.saturation - SETTINGS.warmSaturationDay) * n;
      fu.uGreenSat.value = SETTINGS.greenSaturationDay + (SETTINGS.greenSaturation - SETTINGS.greenSaturationDay) * n;
      fu.uGreenSatSun.value = SETTINGS.greenSaturationSunDay + (SETTINGS.greenSaturation - SETTINGS.greenSaturationSunDay) * n;
      fu.uSage.value = SETTINGS.sage;
      fu.uGreenShift.value.set(SETTINGS.greenShade, SETTINGS.greenSun, SETTINGS.greenPivot[0], SETTINGS.greenPivot[1]);
      const low = mode === 'grade' ? SETTINGS.gradeLow : null;
      fu.uHiLift.value.set(...SETTINGS.highlightLiftDay);
      if (low) fu.uHiLift.value.x *= low[1];
      fu.uPurkinje.value = SETTINGS.purkinje;
      fu.uExposure.value = (SETTINGS.exposureDay + (SETTINGS.exposure - SETTINGS.exposureDay) * n) * (low ? low[0] : 1);
      fu.uHighlightHue.value = SETTINGS.highlightHueDay + (SETTINGS.highlightHueNight - SETTINGS.highlightHueDay) * n;
      fu.uWarmth.value = SETTINGS.warmth * (1 - n);
      const sd = SETTINGS.shadowTintDay, sn = SETTINGS.shadowTintNight;
      fu.uShadowMul.value.set(...sd.mul).lerp(tmpV.set(...sn.mul), n);
      fu.uShadowAdd.value.set(...sd.add).lerp(tmpV.set(...sn.add), n);
      fu.uWarmProtect.value = SETTINGS.warmProtect;
      fu.uWoodGlow.value = SETTINGS.woodGlow;
      fu.uLift.value = SETTINGS.lift;
      fu.uGrain.value = SETTINGS.grain;
    },
  };
}
