// ─────────────────────────────────────────────────────────────────────────────
// Post-processing — the "miniature diorama" finish (only when quality.post).
//
//   RenderPass (MSAA, half-float, linear HDR)
//   → UnrealBloom   tuned to stay out of the way by day; at night only the
//                   genuinely bright things (windows, lanterns, fireflies,
//                   glowing mushrooms, the moon) bloom
//   → TiltShift H   horizontal half of a separable blur whose radius grows
//                   towards the top & bottom of the screen
//   → Finish        vertical half of the tilt-shift + tone mapping (the
//                   renderer's own, e.g. Neutral) + gentle warm grade +
//                   vignette + sRGB output — merged into ONE pass
//
// The middle band stays pin sharp so signs and text read. If anything throws
// (setup or a frame) we fall back to plain rendering for good.
//
// ctx.post = { composer, bloom, enabled, settings } (settings are live-tunable).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** Live-tunable settings (also exposed as ctx.post.settings). */
const SETTINGS = {
  tiltRadius: 3.8, // max blur radius in CSS pixels at the very top/bottom
  tiltBand: 0.2, // half height of the sharp band (0..0.5 of the screen)
  tiltRamp: 0.32, // how quickly the blur ramps up beyond the band
  tiltFocus: 0.48, // vertical centre of the sharp band (0 = bottom)
  bloomDay: { strength: 0.12, radius: 0.35, threshold: 1.05 },
  bloomNight: { strength: 0.85, radius: 0.55, threshold: 0.62 },
  vignette: 0.28,
  saturation: 1.06,
  warmth: 0.025,
};

const BLUR_GLSL = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  uniform vec2 uDir;
  uniform float uRadius, uBand, uRamp, uFocus;
  varying vec2 vUv;
  float tiltAmount(float y) {
    float dy = y - uFocus;
    float k = smoothstep(uBand, uBand + uRamp, abs(dy));
    // the foreground (bottom) blurs a little less than the distance (top)
    return k * (dy < 0.0 ? 0.75 : 1.0);
  }
  vec4 tiltBlur(vec2 uv) {
    float r = tiltAmount(uv.y) * uRadius;
    if (r < 0.35) return texture2D(tDiffuse, uv);
    vec4 sum = vec4(0.0);
    float wsum = 0.0;
    for (int i = -6; i <= 6; i++) {
      float f = float(i) / 6.0;
      float w = exp(-f * f * 2.2);
      sum += texture2D(tDiffuse, uv + uDir * uTexel * f * r) * w;
      wsum += w;
    }
    return sum / wsum;
  }
`;

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function tiltUniforms() {
  return {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uDir: { value: new THREE.Vector2(1, 0) },
    uRadius: { value: SETTINGS.tiltRadius },
    uBand: { value: SETTINGS.tiltBand },
    uRamp: { value: SETTINGS.tiltRamp },
    uFocus: { value: SETTINGS.tiltFocus },
  };
}

const TiltShiftH = {
  name: 'TiltShiftH',
  uniforms: tiltUniforms(),
  vertexShader: FULLSCREEN_VERT,
  fragmentShader: /* glsl */ `
    ${BLUR_GLSL}
    void main() { gl_FragColor = tiltBlur(vUv); }
  `,
};

/** Final pass: vertical tilt-shift, tone mapping, grade, vignette, sRGB. */
class FinishPass extends Pass {
  constructor() {
    super();
    this.uniforms = {
      ...tiltUniforms(),
      toneMappingExposure: { value: 1 },
      uVignette: { value: SETTINGS.vignette },
      uVignetteColor: { value: new THREE.Color('#5a3a2a') },
      uSaturation: { value: SETTINGS.saturation },
      uWarmth: { value: SETTINGS.warmth },
      uAspect: { value: 1 },
      uNight: { value: 0 },
    };
    this.uniforms.uDir.value.set(0, 1);
    this.material = new THREE.RawShaderMaterial({
      name: 'WoodlandFinish',
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        precision highp float;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        attribute vec3 position;
        attribute vec2 uv;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${BLUR_GLSL}
        uniform float uVignette, uSaturation, uWarmth, uAspect, uNight;
        uniform vec3 uVignetteColor;
        #include <tonemapping_pars_fragment>
        #include <colorspace_pars_fragment>
        void main() {
          vec4 c = tiltBlur(vUv);
          vec3 col = c.rgb;
          #ifdef LINEAR_TONE_MAPPING
            col = LinearToneMapping(col);
          #elif defined(REINHARD_TONE_MAPPING)
            col = ReinhardToneMapping(col);
          #elif defined(CINEON_TONE_MAPPING)
            col = CineonToneMapping(col);
          #elif defined(ACES_FILMIC_TONE_MAPPING)
            col = ACESFilmicToneMapping(col);
          #elif defined(AGX_TONE_MAPPING)
            col = AgXToneMapping(col);
          #elif defined(NEUTRAL_TONE_MAPPING)
            col = NeutralToneMapping(col);
          #endif
          // gentle grade (display-referred linear): a touch more colour, warm gain
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = max(mix(vec3(l), col, uSaturation), 0.0);
          col *= vec3(1.0 + uWarmth, 1.0 + uWarmth * 0.3, 1.0 - uWarmth);
          // moonlight: pull greens towards a cool blue without crushing anything
          col = mix(col, l * vec3(0.72, 0.86, 1.32), uNight * 0.28);
          // soft, warm-tinted vignette (multiplied towards a colour, never grey)
          vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
          float v = smoothstep(0.35, 1.05, length(q) * 1.15) * uVignette;
          col = mix(col, col * uVignetteColor * 1.6, v);
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
          #ifdef SRGB_TRANSFER
            gl_FragColor = sRGBTransferOETF(gl_FragColor);
          #endif
        }
      `,
    });
    this._quad = new FullScreenQuad(this.material);
    this._toneMapping = null;
    this._colorSpace = null;
  }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    if (this._toneMapping !== renderer.toneMapping || this._colorSpace !== renderer.outputColorSpace) {
      this._toneMapping = renderer.toneMapping;
      this._colorSpace = renderer.outputColorSpace;
      const d = {};
      if (THREE.ColorManagement.getTransfer(this._colorSpace) === THREE.SRGBTransfer) d.SRGB_TRANSFER = '';
      const tm = {
        [THREE.LinearToneMapping]: 'LINEAR_TONE_MAPPING',
        [THREE.ReinhardToneMapping]: 'REINHARD_TONE_MAPPING',
        [THREE.CineonToneMapping]: 'CINEON_TONE_MAPPING',
        [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING',
        [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING',
        [THREE.NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING',
      }[this._toneMapping];
      if (tm) d[tm] = '';
      this.material.defines = d;
      this.material.needsUpdate = true;
    }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (!this.renderToScreen && this.clear) renderer.clear();
    this._quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this._quad.dispose();
  }
}

export default async function build(ctx) {
  const { engine, scene, camera } = ctx;
  const quality = ctx.quality ?? engine.quality;
  if (!quality.post) return {};
  const renderer = engine.renderer;

  let composer, bloom, tiltH, finish;
  try {
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
      type: THREE.HalfFloatType,
      samples: pr >= 1.75 ? 2 : 4,
    });
    target.texture.name = 'woodland.post.rt';
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), SETTINGS.bloomDay.strength, SETTINGS.bloomDay.radius, SETTINGS.bloomDay.threshold);
    composer.addPass(bloom);
    tiltH = new ShaderPass(TiltShiftH);
    composer.addPass(tiltH);
    finish = new FinishPass();
    composer.addPass(finish);
  } catch (err) {
    console.warn('[post] setup failed, rendering without post-processing', err);
    return {};
  }

  const tiltPasses = [tiltH.uniforms, finish.uniforms];
  function resize(w, h) {
    const pr = renderer.getPixelRatio();
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    for (const u of tiltPasses) {
      u.uTexel.value.set(1 / (w * pr), 1 / (h * pr));
      u.uRadius.value = SETTINGS.tiltRadius * pr;
    }
    finish.uniforms.uAspect.value = w / Math.max(h, 1);
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
    renderer.render(scene, camera);
  };
  engine.setRenderFn((dt) => {
    if (failed || !active) return plain();
    try {
      renderer.info.reset();
      composer.render(dt);
    } catch (err) {
      failed = true;
      console.warn('[post] render failed, falling back to plain rendering', err);
      renderer.setRenderTarget(null);
      plain();
    }
  });

  const vignetteDay = new THREE.Color('#5a3a2a');
  const vignetteNight = new THREE.Color('#1a2350');
  let lastNight = -1;

  ctx.post = {
    composer,
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
        finish.uniforms.uVignetteColor.value.copy(vignetteDay).lerp(vignetteNight, n);
        finish.uniforms.uVignette.value = SETTINGS.vignette * (1 + 0.35 * n);
        finish.uniforms.uNight.value = n;
      }
      for (const u of tiltPasses) {
        u.uBand.value = SETTINGS.tiltBand;
        u.uRamp.value = SETTINGS.tiltRamp;
        u.uFocus.value = SETTINGS.tiltFocus;
      }
      finish.uniforms.uSaturation.value = SETTINGS.saturation;
      finish.uniforms.uWarmth.value = SETTINGS.warmth;
    },
  };
}
