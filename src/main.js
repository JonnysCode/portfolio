// ─────────────────────────────────────────────────────────────────────────────
// Jonny's Woodland — boot sequence.
// See docs/ARCHITECTURE.md for how the pieces fit together.
// ─────────────────────────────────────────────────────────────────────────────
import '@fontsource/fredoka/latin-400.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/patrick-hand/latin-400.css';
import './ui/styles.css';

import * as THREE from 'three';
import { createEngine } from './core/engine.js';
import { materials } from './core/materials.js';
import { palette } from './core/palette.js';
import { createRng } from './core/rng.js';
import * as layout from './world/layout.js';
import * as ground from './world/ground.js';
import { buildWorld, moduleStats } from './world/index.js';
import * as content from './content/content.js';
import * as props from './props/index.js';
import { createColliders } from './systems/colliders.js';
import { createEnv } from './systems/env.js';
import { createInteractions } from './systems/interactions.js';
import { createCameraRig } from './systems/cameraRig.js';
import { createNightSecrets } from './systems/nightSecrets.js';
// (patches a shader chunk: before anything compiles)
import './systems/nearFade.js';
import { createUI } from './ui/index.js';
import { createAudio } from './audio/audio.js';
import { installDebug } from './debug.js';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

async function boot() {
  const canvas = document.getElementById('world');

  /**
   * The shared context handed to every module. See docs/ARCHITECTURE.md.
   */
  const ctx = {
    THREE,
    palette,
    materials,
    layout,
    ground,
    content,
    props,
    rng: createRng,
    sites: {},
    modules: {},
    /** Per-module render cost (debug). */
    moduleStats: () => moduleStats(ctx),
  };

  if (!webglAvailable()) {
    ctx.env = { isNight: false, onChange() {}, toggle() {} };
    ctx.ui = createUI(ctx);
    ctx.ui.showFallback('Your browser does not support WebGL 2, so the 3D woodland cannot be shown — but here is everything in it:');
    return;
  }

  const engine = createEngine(canvas);
  Object.assign(ctx, { engine, scene: engine.scene, camera: engine.camera, quality: engine.quality });
  // Procedural textures are baked on the GPU; give the material factory the renderer up front.
  materials.setRenderer?.(engine.renderer, engine.quality);
  ctx.colliders = createColliders();
  ctx.env = createEnv(engine);
  ctx.ui = createUI(ctx);
  ctx.audio = createAudio(ctx);
  ctx.interactions = createInteractions(ctx);
  const debug = installDebug(ctx);

  // Fonts must be ready before canvas textures (signs) are drawn.
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('600 32px "Fredoka"'),
        document.fonts.load('400 32px "Fredoka"'),
        document.fonts.load('400 32px "Patrick Hand"'),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* fall back to system fonts */
  }

  ctx.ui.setProgress(0.05, 'Planting mushrooms…');
  const labels = {
    lighting: 'Hanging the sun…', sky: 'Painting the sky…', atmosphere: 'Letting the mist in…', terrain: 'Rolling out the moss…',
    oak: 'Growing the Great Oak…', schreinerei: 'Sharpening chisels…', loft: 'Booting the treehouse…', cottage: 'Putting the kettle on…',
    riverside: 'Filling the stream…', vegetation: 'Unfurling ferns…', ambient: 'Waking the fireflies…', post: 'Polishing the lens…',
  };
  const report = await buildWorld(ctx, (p, id) => ctx.ui.setProgress(0.05 + p * 0.85, labels[id]));
  if (report.failed.length) console.warn('[boot] some modules failed:', report.failed.map((f) => f.id));

  engine.addUpdate(props.tickProps, 25);
  // little discoveries that only exist after dark (registered before the UI counts the secrets)
  try {
    ctx.nightSecrets = createNightSecrets(ctx);
  } catch (err) {
    console.warn('[boot] night secrets skipped', err);
  }
  ctx.cameraRig = createCameraRig(ctx);
  // the UI follows the camera (spot bar, labels, banners, keyboard hotspots)
  ctx.ui.bindWorld?.();

  ctx.ui.setProgress(0.95, 'Warming up shaders…');
  // Compile all shaders up front to avoid hitches on first view.
  // Compile against the post chain's HDR target when post-processing is on, so
  // the variants that are actually drawn get compiled (not the sRGB/tone-mapped ones).
  try {
    engine.renderer.setRenderTarget(ctx.post?.target ?? null);
    await engine.renderer.compileAsync(engine.scene, engine.camera);
  } catch {
    /* compileAsync is an optimisation only */
  } finally {
    engine.renderer.setRenderTarget(null);
  }
  engine.step(1 / 60);
  ctx.ui.setProgress(1, 'Welcome!');

  if (engine.params.has('shots')) {
    // Screenshot mode: deterministic, no intro; the harness drives frames.
    ctx.ui.ready();
  } else {
    engine.start();
    ctx.ui.ready();
    ctx.ui.showIntro();
  }
  window.__woodland.ready = true;
  return debug;
}

boot().catch((err) => {
  console.error('[boot] fatal', err);
  const el = document.querySelector('.loader__label');
  if (el) el.textContent = 'Oh no, a branch fell on the path. Please reload the page.';
});
