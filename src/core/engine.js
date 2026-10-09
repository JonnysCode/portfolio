// ─────────────────────────────────────────────────────────────────────────────
// Engine — renderer, scene, camera, the update loop and quality settings.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

const params = new URLSearchParams(location.search);

/** True when ?q= / ?quality= forces a tier (the governor then stays out of it). */
const forcedTier = ['low', 'medium', 'high'].includes(params.get('q') || params.get('quality'));

function detectQuality() {
  const forced = params.get('q') || params.get('quality');
  if (forced === 'low' || forced === 'medium' || forced === 'high') return forced;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8;
  if (cores <= 2 || memory <= 2) return 'low';
  // Every touch-first device (phones AND tablets: iPads, Android tablets) is
  // 'medium' — mobile GPUs at DPR 2 with a 4096 shadow map and AO + DOF are
  // too much. Weaker desktops are caught at runtime by the frame-time governor.
  if (matchMedia('(pointer: coarse)').matches) return 'medium';
  return 'high';
}

/**
 * Per tier. shadowMapSize: the sun's shadow map (fixed frustum over the glen);
 * post: 'full' (AO + DOF + bloom + grade), 'lite' (bloom + grade, 2× MSAA) or
 * false (plain renderer); grade: on 'low' (post false) a single grade-only
 * finishing pass keeps the art direction (no bloom, AO or DOF). 'medium'
 * (phones, 30 fps) also re-renders its shadow maps only every other frame
 * (lighting.js, shadowEvery). ao / dof / bloom are live flags the governor
 * may switch off.
 */
const QUALITY_PRESETS = {
  high: { pixelRatio: 2, shadows: true, shadowMapSize: 4096, shadowEvery: 1, density: 1, post: 'full', ao: true, dof: true, bloom: true },
  medium: { pixelRatio: 1.5, shadows: true, shadowMapSize: 1024, shadowEvery: 2, density: 0.5, post: 'lite', ao: false, dof: false, bloom: true },
  low: { pixelRatio: 1, shadows: false, shadowMapSize: 512, shadowEvery: 1, density: 0.35, post: false, grade: true, ao: false, dof: false, bloom: false },
};

/**
 * Runtime frame-time governor. While the real animation loop runs, the median
 * frame time of the last 90 frames is checked; above the tier's limit the
 * renderer steps down — DPR 2 → 1.5 → 1.25, AO off, DOF off, shadow map
 * 4096 → 2048, then (still slow) shadows every other frame, DPR 1, a 1024 map,
 * bloom off — one step at a time, each followed by a settle period. A step that
 * brings no gain (a vsync- or battery-capped display) is undone and the governor
 * retires. The reached level is remembered in localStorage (per tier, 30 days),
 * so the next visit starts there. Off for ?shots, a forced ?q= tier and
 * ?governor=0; ?governor=reset forgets the stored level.
 */
const GOVERNOR = {
  key: 'woodland.governor.v1',
  window: 90,
  /** median frame time (ms) above which the tier steps down */
  limitMs: { high: 22, medium: 36, low: 40 },
  /** frames ignored after start and after every step (shader warm-up, re-allocation) */
  settle: 75,
  maxAgeMs: 30 * 24 * 3600 * 1000,
};
const GOVERNOR_STEPS = [
  { id: 'dpr-1.5', when: (q, dpr) => dpr > 1.5, apply: (q) => { q.pixelRatio = 1.5; } },
  { id: 'dpr-1.25', when: (q, dpr) => dpr > 1.25, apply: (q) => { q.pixelRatio = 1.25; } },
  { id: 'ao-off', when: (q) => q.ao, apply: (q) => { q.ao = false; } },
  { id: 'dof-off', when: (q) => q.dof, apply: (q) => { q.dof = false; } },
  { id: 'shadow-2048', when: (q) => q.shadows && q.shadowMapSize > 2048, apply: (q) => { q.shadowMapSize = 2048; } },
  { id: 'shadow-every-2', when: (q) => q.shadows && q.shadowEvery < 2, apply: (q) => { q.shadowEvery = 2; } },
  { id: 'dpr-1', when: (q, dpr) => dpr > 1, apply: (q) => { q.pixelRatio = 1; } },
  { id: 'shadow-1024', when: (q) => q.shadows && q.shadowMapSize > 1024, apply: (q) => { q.shadowMapSize = 1024; } },
  { id: 'bloom-off', when: (q) => q.bloom, apply: (q) => { q.bloom = false; } },
];

function readGovernor(tier) {
  try {
    if (params.get('governor') === 'reset') localStorage.removeItem(GOVERNOR.key);
    const s = JSON.parse(localStorage.getItem(GOVERNOR.key) || 'null');
    if (!s || s.tier !== tier || !(Date.now() - s.t < GOVERNOR.maxAgeMs)) return [];
    return Array.isArray(s.steps) ? s.steps.filter((id) => GOVERNOR_STEPS.some((g) => g.id === id)) : [];
  } catch {
    return [];
  }
}
function writeGovernor(tier, steps) {
  try {
    if (steps.length) localStorage.setItem(GOVERNOR.key, JSON.stringify({ tier, steps, t: Date.now() }));
    else localStorage.removeItem(GOVERNOR.key);
  } catch {
    /* private mode: just not remembered */
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createEngine(canvas) {
  const tier = detectQuality();
  const quality = { tier, ...QUALITY_PRESETS[tier] };
  const governed = !forcedTier && !params.has('shots') && params.get('governor') !== '0';
  // start where the governor left off last time (before anything is built)
  const govSteps = governed ? readGovernor(tier) : [];
  for (const id of govSteps) GOVERNOR_STEPS.find((g) => g.id === id).apply(quality);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    // With post-processing the scene is rendered into a multisampled HDR target
    // and the canvas only receives a fullscreen quad — a multisampled backbuffer
    // would be wasted. (Texture bake resolution is keyed on quality.tier, not on this.)
    antialias: !quality.post && tier !== 'low',
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
  /** Iteration copy of `updaters`, rebuilt lazily after any add/remove. */
  let snapshot = null;
  let renderFn = () => renderer.render(scene, camera);
  const resizeListeners = new Set();
  let elapsed = 0;
  let running = false;
  let frame = 0;

  // ── the frame-time governor (see GOVERNOR) ──
  const qualityListeners = new Set();
  const gov = {
    active: governed,
    steps: govSteps.slice(),
    samples: new Float32Array(GOVERNOR.window),
    sorted: new Float32Array(GOVERNOR.window),
    n: 0,
    skip: GOVERNOR.settle,
    last: -1,
    median: 0,
    prevMedian: 0,
    noGain: 0,
    /** the quality before each step taken this session (to undo steps that bought nothing) */
    undo: [],
  };
  /** Push a changed `quality` to the renderer and to every listener (post, lighting). */
  function applyQuality(change) {
    const pr = Math.min(window.devicePixelRatio || 1, quality.pixelRatio);
    if (pr !== renderer.getPixelRatio()) {
      renderer.setPixelRatio(pr);
      resize();
    }
    for (const fn of qualityListeners) {
      try {
        fn(quality, change);
      } catch (err) {
        console.warn('[engine] quality listener failed', err);
      }
    }
  }
  /** One step down (the first one that still changes something). Returns its id or null. */
  function governorStep() {
    const dpr = renderer.getPixelRatio();
    const next = GOVERNOR_STEPS.find((g) => !gov.steps.includes(g.id) && g.when(quality, dpr));
    if (!next) {
      gov.active = false;
      return null;
    }
    gov.undo.push({ quality: { ...quality }, steps: gov.steps.slice() });
    next.apply(quality);
    gov.steps.push(next.id);
    if (governed) writeGovernor(tier, gov.steps);
    applyQuality(next.id);
    return next.id;
  }
  function governorSample(now) {
    if (gov.last < 0 || document.hidden) {
      gov.last = now;
      return;
    }
    const ms = now - gov.last;
    gov.last = now;
    if (ms > 250) return; // a hitch or a tab switch, not the steady state
    if (gov.skip > 0) {
      gov.skip--;
      return;
    }
    gov.samples[gov.n++] = ms;
    if (gov.n < GOVERNOR.window) return;
    gov.n = 0;
    gov.sorted.set(gov.samples);
    gov.sorted.sort();
    const median = (gov.median = gov.sorted[GOVERNOR.window >> 1]);
    if (median <= (GOVERNOR.limitMs[tier] ?? 22)) {
      gov.prevMedian = 0;
      gov.noGain = 0;
      return;
    }
    if (gov.prevMedian && median > gov.prevMedian * 0.93) {
      // the last step bought nothing: a vsync / battery-capped display or a
      // CPU-bound device — undo the useless steps and retire
      if (++gov.noGain >= 2) {
        const back = gov.undo[gov.undo.length - gov.noGain];
        if (back) {
          Object.assign(quality, back.quality);
          gov.steps = back.steps;
          writeGovernor(tier, gov.steps);
          applyQuality('undo');
        }
        gov.active = false;
        return;
      }
    } else gov.noGain = 0;
    gov.prevMedian = median;
    governorStep();
    gov.skip = GOVERNOR.settle;
  }

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
      const entry = { fn, order, errors: 0 };
      updaters.push(entry);
      updaters.sort((a, b) => a.order - b.order);
      snapshot = null;
      return () => {
        const i = updaters.indexOf(entry);
        if (i >= 0) updaters.splice(i, 1);
        snapshot = null;
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
     * Called with (quality, changeId) whenever the governor changes `quality`
     * at runtime (pixelRatio, ao, dof, bloom, shadowMapSize, shadowEvery).
     */
    onQualityChange(fn) {
      qualityListeners.add(fn);
      return () => qualityListeners.delete(fn);
    },
    /** The frame-time governor: { active, steps, median (ms), step() — force one step down (debug) }. */
    governor: {
      get active() { return gov.active; },
      get steps() { return gov.steps.slice(); },
      get median() { return gov.median; },
      step: () => governorStep(),
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
      // Iterate a snapshot so adding/removing updaters mid-frame never skips one.
      if (!snapshot) snapshot = updaters.slice();
      for (const u of snapshot) {
        try {
          u.fn(dt, elapsed);
          u.errors = 0;
        } catch (err) {
          // One broken updater must not freeze the whole world: log it, and only
          // retire it if it keeps failing (a single hiccup shouldn't kill the camera).
          u.errors++;
          if (u.errors === 1) console.error('[engine] update failed', err);
          if (u.errors >= 30) {
            console.error('[engine] updater failed 30 frames in a row — disabling it', err);
            const i = updaters.indexOf(u);
            if (i >= 0) updaters.splice(i, 1);
            snapshot = null;
          }
        }
      }
      if (render) renderFn(dt);
    },
    start() {
      if (running) return;
      running = true;
      lastTime = -1;
      gov.last = -1;
      renderer.setAnimationLoop(() => {
        if (gov.active) governorSample(performance.now());
        engine.step();
      });
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
