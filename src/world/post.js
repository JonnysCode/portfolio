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
//              exposure + colour grade (warm highlights, teal-green shadows,
//              softly lifted blacks, a touch of saturation) + warm vignette +
//              fine animated grain + sRGB output.
//
// Tiers: high = everything; medium = bloom + grade (no depth → no AO/DOF);
// low = plain renderer (tone mapping only). NaN/Inf pixels from any material
// are dropped before they can be smeared by the blurs. If anything throws —
// setup or a frame — we fall back to plain rendering for good.
//
// ctx.post = { composer (null — custom chain), bloom, settings, enabled, setEnabled(on) }
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
  saturation: 1.12,
  /** Highlights keep their hue (0..1) instead of bleaching to white — warm lights stay warm. */
  highlightHueDay: 0.2,
  highlightHueNight: 0.55,
  warmth: 0.05,
  shadowTint: [-0.02, 0.008, 0.018], // added in the shadows (teal-green)
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
/** Half-res gather blur. Output: rgb = blurred colour, a = foreground coverage. */
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
      float w0 = tame(c.rgb);
      vec3 sum = c.rgb * w0;
      float wsum = w0;
      float fg = 0.0;
      const float GOLDEN = 2.39996323;
      for (int i = 0; i < ${TAPS}; i++) {
        float fi = float(i);
        float r = uMaxR * sqrt((fi + 0.5) / ${TAPS.toFixed(1)});
        float th = fi * GOLDEN;
        vec4 s = texture2D(tPre, vUv + vec2(cos(th), sin(th)) * r * uTexel);
        float cs = s.a;
        // a sample behind a sharper centre must not spread onto it
        float reach = cs > cocC ? min(abs(cs), max(abs(cocC), 0.0) * 1.5 + 0.35) : abs(cs);
        float w = smoothstep(r - 0.75, r + 0.25, reach);
        fg = max(fg, w * smoothstep(0.6, 1.8, -cs));
        w *= tame(s.rgb);
        sum += s.rgb * w;
        wsum += w;
      }
      gl_FragColor = vec4(sum / wsum, fg);
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
        uWarmth: { value: SETTINGS.warmth },
        uShadowTint: { value: new THREE.Vector3(...SETTINGS.shadowTint) },
        uLift: { value: SETTINGS.lift },
        uLiftColor: { value: new THREE.Color('#2d4a4a') },
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
        uniform vec3 uShadowTint, uLiftColor, uVignetteColor;
        varying vec2 vUv;
        ${COC_GLSL}
        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
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
            float k = max(smoothstep(0.35, 2.2, coc), b.a);
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
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = max(mix(vec3(l), col, uSaturation), 0.0);
          float sh = (1.0 - l) * (1.0 - l);
          col += uShadowTint * sh * (1.0 + uNight);
          col *= mix(vec3(1.0), vec3(1.0 + uWarmth, 1.0 + uWarmth * 0.35, 1.0 - uWarmth * 0.6), smoothstep(0.25, 0.9, l));
          // moonlight: cool the greens a little without crushing anything
          col = mix(col, l * vec3(0.78, 0.9, 1.25), uNight * 0.18);
          // softly lifted blacks, towards a deep teal (never grey)
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
  const tier = quality.tier;
  // high: full chain; medium: bloom + grade; low: plain renderer.
  if (tier === 'low') return {};
  const renderer = engine.renderer;
  const useDof = tier === 'high';

  let sceneRT, bloom, preRT, bokehRT, aoRT, aoBlurRT, finishMat, quads;
  try {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: pr >= 1.75 ? 2 : 4,
      depthTexture: useDof ? new THREE.DepthTexture(size.x, size.y) : null,
    });
    sceneRT.texture.name = 'woodland.post.scene';
    const css = renderer.getSize(new THREE.Vector2());
    bloom = new WoodlandBloom(new THREE.Vector2(css.x, css.y), SETTINGS.bloomDay.strength, SETTINGS.bloomDay.radius, SETTINGS.bloomDay.threshold);
    bloom.highPassUniforms.smoothWidth.value = SETTINGS.bloomDay.knee;
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
    bloom.setSize(w, h);
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

    const bloomTex = bloom.strength > 0.001 ? bloom.renderBloom(renderer, sceneRT.texture) : null;

    const aoOn = useDof && SETTINGS.ao > 0.001;
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

    const dofOn = useDof && SETTINGS.dof;
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
  const liftDay = new THREE.Color('#2d4a4a');
  const liftNight = new THREE.Color('#14223e');
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
        bloom.strength = D.strength + (N.strength - D.strength) * n;
        bloom.radius = D.radius + (N.radius - D.radius) * n;
        bloom.threshold = D.threshold + (N.threshold - D.threshold) * n;
        bloom.highPassUniforms.smoothWidth.value = D.knee + (N.knee - D.knee) * n;
        bloom.highPassUniforms.uExcess.value = D.excess + (N.excess - D.excess) * n;
        fu.uVignetteColor.value.copy(vignetteDay).lerp(vignetteNight, n);
        fu.uLiftColor.value.copy(liftDay).lerp(liftNight, n);
        fu.uNight.value = n;
      }
      fu.uVignette.value = SETTINGS.vignette * (1 + 0.3 * n);
      fu.uSaturation.value = SETTINGS.saturation;
      fu.uExposure.value = SETTINGS.exposure;
      fu.uHighlightHue.value = SETTINGS.highlightHueDay + (SETTINGS.highlightHueNight - SETTINGS.highlightHueDay) * n;
      fu.uWarmth.value = SETTINGS.warmth * (1 - n);
      const st = SETTINGS.shadowTint;
      fu.uShadowTint.value.set(st[0], st[1], st[2]);
      fu.uLift.value = SETTINGS.lift;
      fu.uGrain.value = SETTINGS.grain;
    },
  };
}
