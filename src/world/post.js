// ─────────────────────────────────────────────────────────────────────────────
// Post-processing — the final image: a painted miniature seen through a macro
// lens.
//
//   scene      rendered once into an HDR (half-float, MSAA) target, with a
//              depth texture on 'high'
//   bloom      UnrealBloom mip chain with a soft knee: fairy lights, windows,
//              lanterns, fireflies and sun glints glow; stronger at night.
//              (Only the blur chain is used — the result is added in the
//              finish pass, so the HDR scene is never re-resolved.)
//   DOF        ('high') depth of field around ctx.cameraRig.focusDistance:
//              half-resolution prefilter (colour + signed circle of
//              confusion) → 28-tap golden-angle gather with scatter-as-gather
//              weights (foreground bleeds over sharp things, background never
//              bleeds onto them) → mixed back at full resolution by CoC.
//   finish     ONE pass: DOF composite + bloom + the renderer's tone mapping &
//              exposure + colour grade (warm highlights, teal-green shadows,
//              softly lifted blacks, a touch of saturation) + warm vignette +
//              fine animated grain + sRGB output.
//
// Tiers: high = everything; medium = bloom + grade (no depth/DOF); low = plain
// renderer (tone mapping only). If anything throws — setup or a frame — we
// fall back to plain rendering for good.
//
// ctx.post = { composer (null — custom chain), bloom, settings, enabled, setEnabled(on) }
//   settings are live-tunable (see SETTINGS).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** Live-tunable settings (also exposed as ctx.post.settings). */
const SETTINGS = {
  bloomDay: { strength: 0.32, radius: 0.55, threshold: 1.0, knee: 0.6 },
  bloomNight: { strength: 0.9, radius: 0.7, threshold: 0.42, knee: 0.5 },
  dof: true,
  /** CoC scale in px (at 720p): blur of something infinitely far behind the focus. */
  aperture: 12,
  /** In-focus dead zone (px) so the subject stays pin sharp. */
  focusBand: 0.9,
  maxBlur: 11, // px at 720p
  saturation: 1.08,
  warmth: 0.035,
  shadowTint: [-0.012, 0.006, 0.012], // added in the shadows (teal-green)
  lift: 0.018,
  vignette: 0.32,
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
  float viewDepth(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    // perspective depth → positive view distance
    return (uNear * uFar) / ((uFar - uNear) * d - uFar);
  }
  // signed circle of confusion in px (−: in front of the focus, +: behind)
  float cocAt(vec2 uv) {
    float z = -viewDepth(uv);
    float c = uAperture * (z - uFocus) / max(z, 1e-3);
    c = sign(c) * max(abs(c) - uBand, 0.0);
    return clamp(c, -uMaxBlur * 1.25, uMaxBlur);
  }
`;

/** Half-res: colour (4-tap box) + signed CoC (in half-res px). */
const PrefilterShader = {
  uniforms: {
    tColor: { value: null },
    tDepth: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uNear: { value: 0.1 },
    uFar: { value: 100 },
    uFocus: { value: 20 },
    uAperture: { value: 10 },
    uBand: { value: 1 },
    uMaxBlur: { value: 10 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor;
    uniform vec2 uTexel; // full-res texel
    varying vec2 vUv;
    ${COC_GLSL}
    void main() {
      vec2 o = uTexel * 0.5;
      vec3 c = texture2D(tColor, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tColor, vUv + vec2(o.x, -o.y)).rgb
             + texture2D(tColor, vUv + vec2(-o.x, o.y)).rgb + texture2D(tColor, vUv + vec2(o.x, o.y)).rgb;
      c *= 0.25;
      // tame fireflies so single hot pixels do not become big discs
      c = c / (1.0 + max(max(c.r, c.g), c.b) * 0.12);
      float coc = cocAt(vUv) * 0.5; // half-res px
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
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tPre;
    uniform vec2 uTexel;
    uniform float uMaxR;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tPre, vUv);
      float cocC = c.a;
      vec3 sum = c.rgb;
      float wsum = 1.0;
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
        sum += s.rgb * w;
        wsum += w;
        fg = max(fg, w * smoothstep(0.6, 1.8, -cs));
      }
      gl_FragColor = vec4(sum / wsum, fg);
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
        tDepth: { value: null },
        uUseBloom: { value: 0 },
        uUseDof: { value: 0 },
        uNear: { value: 0.1 },
        uFar: { value: 100 },
        uFocus: { value: 20 },
        uAperture: { value: 10 },
        uBand: { value: 1 },
        uMaxBlur: { value: 10 },
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
        uniform sampler2D tColor, tBloom, tBokeh;
        uniform float uUseBloom, uUseDof;
        uniform float uSaturation, uWarmth, uLift, uVignette, uGrain, uAspect, uNight, uTime;
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
          if (uUseDof > 0.5) {
            vec4 b = texture2D(tBokeh, vUv);
            float coc = abs(cocAt(vUv));
            float k = max(smoothstep(0.35, 2.2, coc), b.a);
            col = mix(col, b.rgb, k);
          }
          if (uUseBloom > 0.5) col += texture2D(tBloom, vUv).rgb;

          // the renderer's tone mapping (exposure included)
          col = toneMapping(col);
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

  let sceneRT, bloom, preRT, bokehRT, finishMat, quads;
  try {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: pr >= 1.75 ? 2 : 4,
      depthTexture: useDof ? new THREE.DepthTexture(size.x, size.y) : undefined,
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
  }

  function frame(dt) {
    renderer.info.reset();
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);

    const bloomTex = bloom.strength > 0.001 ? bloom.renderBloom(renderer, sceneRT.texture) : null;

    const dofOn = useDof && SETTINGS.dof;
    if (dofOn) {
      const H = sceneRT.height;
      const pu = quads.pre.material.uniforms;
      pu.tColor.value = sceneRT.texture;
      pu.tDepth.value = sceneRT.depthTexture;
      cocUniforms(pu, H);
      renderer.setRenderTarget(preRT);
      quads.pre.render(renderer);
      const bu = quads.bokeh.material.uniforms;
      bu.tPre.value = preRT.texture;
      bu.uMaxR.value = (SETTINGS.maxBlur * (H / 720)) / 2;
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
        fu.uVignetteColor.value.copy(vignetteDay).lerp(vignetteNight, n);
        fu.uLiftColor.value.copy(liftDay).lerp(liftNight, n);
        fu.uNight.value = n;
      }
      fu.uVignette.value = SETTINGS.vignette * (1 + 0.3 * n);
      fu.uSaturation.value = SETTINGS.saturation;
      fu.uWarmth.value = SETTINGS.warmth * (1 - n);
      fu.uShadowTint.value.set(...SETTINGS.shadowTint);
      fu.uLift.value = SETTINGS.lift;
      fu.uGrain.value = SETTINGS.grain;
    },
  };
}
