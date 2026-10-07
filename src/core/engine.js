// ─────────────────────────────────────────────────────────────────────────────
// Engine — renderer, scene, camera, the update loop and quality settings.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

const params = new URLSearchParams(location.search);

function detectQuality() {
  const forced = params.get('q') || params.get('quality');
  if (forced === 'low' || forced === 'medium' || forced === 'high') return forced;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const small = Math.min(innerWidth, innerHeight) < 600;
  if (coarse && small) return 'medium';
  if (cores <= 2) return 'low';
  return 'high';
}

const QUALITY_PRESETS = {
  high: { pixelRatio: 2, shadows: true, shadowMapSize: 2048, density: 1, post: true },
  medium: { pixelRatio: 1.5, shadows: true, shadowMapSize: 1024, density: 0.6, post: false },
  low: { pixelRatio: 1, shadows: false, shadowMapSize: 512, density: 0.35, post: false },
};

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createEngine(canvas) {
  const tier = detectQuality();
  const quality = { tier, ...QUALITY_PRESETS[tier] };

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: tier !== 'low',
    powerPreference: 'high-performance',
    preserveDrawingBuffer: params.has('shots'),
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  // Colour pipeline (owned by the light/post builder): linear HDR lighting,
  // filmic tone mapping, sRGB output. The post chain (world/post.js) applies
  // the same tone mapping in its finish pass. ?tm=aces|agx|neutral&exposure=1.1
  // override it for look-dev comparisons.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const TONE_MAPPINGS = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping };
  renderer.toneMapping = TONE_MAPPINGS[params.get('tm')] ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = Number(params.get('exposure')) || 1.12;
  renderer.shadowMap.enabled = quality.shadows;
  // PCF with a Vogel-disk kernel (shadow.radius) — soft, dappled canopy shadows.
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bfe0f0');
  scene.fog = new THREE.Fog('#e9dcc0', 60, 190);

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.3, 600);
  camera.position.set(0, 14, 26);
  camera.lookAt(0, 0, 0);

  let lastTime = -1;
  /** @type {{fn:(dt:number, t:number)=>void, order:number}[]} */
  const updaters = [];
  let renderFn = () => renderer.render(scene, camera);
  const resizeListeners = new Set();
  let elapsed = 0;
  let running = false;
  let frame = 0;

  const engine = {
    THREE,
    renderer,
    scene,
    camera,
    quality,
    params,
    debug: params.has('debug'),
    isTouch: matchMedia('(pointer: coarse)').matches,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    get elapsed() { return elapsed; },
    get frame() { return frame; },
    /**
     * Register a per-frame callback. Lower `order` runs first.
     * Conventional orders: input 0, systems 10, world 20, camera 80, effects 90.
     * Returns an unsubscribe function.
     */
    addUpdate(fn, order = 20) {
      const entry = { fn, order };
      updaters.push(entry);
      updaters.sort((a, b) => a.order - b.order);
      return () => {
        const i = updaters.indexOf(entry);
        if (i >= 0) updaters.splice(i, 1);
      };
    },
    /** Replace the default render call (used by post-processing). */
    setRenderFn(fn) {
      renderFn = fn;
    },
    onResize(fn) {
      resizeListeners.add(fn);
      return () => resizeListeners.delete(fn);
    },
    /**
     * Advance (and by default render) a single frame. Also used by the
     * screenshot harness, which drives time manually with ?shots.
     */
    step(dtOverride, render = true) {
      let dt = dtOverride;
      if (dt === undefined) {
        const now = performance.now();
        dt = lastTime < 0 ? 1 / 60 : Math.min((now - lastTime) / 1000, 1 / 20);
        lastTime = now;
      }
      elapsed += dt;
      frame++;
      for (const u of updaters) {
        try {
          u.fn(dt, elapsed);
        } catch (err) {
          // One broken updater must not freeze the whole world.
          console.error('[engine] update failed', err);
          const i = updaters.indexOf(u);
          if (i >= 0) updaters.splice(i, 1);
        }
      }
      if (render) renderFn(dt);
    },
    start() {
      if (running) return;
      running = true;
      lastTime = -1;
      renderer.setAnimationLoop(() => engine.step());
    },
    stop() {
      running = false;
      renderer.setAnimationLoop(null);
    },
  };

  function resize() {
    // the canvas is CSS-sized to the visible viewport (inset: 0)
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    for (const fn of resizeListeners) fn(w, h);
  }
  window.addEventListener('resize', resize);
  // mobile URL bars and on-screen keyboards change the visual viewport without always firing window resize
  window.visualViewport?.addEventListener('resize', resize);

  return engine;
}
