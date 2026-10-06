// ─────────────────────────────────────────────────────────────────────────────
// Jonny's Woodland — boot sequence.
// See docs/ARCHITECTURE.md for how the pieces fit together.
// ─────────────────────────────────────────────────────────────────────────────
import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/patrick-hand/400.css';
import './ui/styles.css';

import * as THREE from 'three';
import { createEngine } from './core/engine.js';
import { materials } from './core/materials.js';
import { palette } from './core/palette.js';
import { createRng } from './core/rng.js';
import * as layout from './world/layout.js';
import * as ground from './world/ground.js';
import { buildWorld } from './world/index.js';
import * as content from './content/content.js';
import * as props from './props/index.js';
import { createColliders } from './systems/colliders.js';
import { createEnv } from './systems/env.js';
import { createInteractions } from './systems/interactions.js';
import { createPlayer } from './systems/player.js';
import { createCameraRig } from './systems/cameraRig.js';
import { createTransport } from './systems/transport.js';
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
  };

  if (!webglAvailable()) {
    ctx.env = { isNight: false, onChange() {}, toggle() {} };
    ctx.ui = createUI(ctx);
    ctx.ui.showFallback('Your browser does not support WebGL 2, so the 3D woodland cannot be shown — but here is everything in it:');
    return;
  }

  const engine = createEngine(canvas);
  Object.assign(ctx, { engine, scene: engine.scene, camera: engine.camera, quality: engine.quality });
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
    lighting: 'Hanging the sun…', sky: 'Fluffing clouds…', terrain: 'Rolling out the meadow…', water: 'Filling the pond…',
    vegetation: 'Growing trees…', ambient: 'Waking the fireflies…', plaza: 'Sweeping the square…',
    woodworking: 'Sharpening chisels…', bikes: 'Truing wheels…', interior: 'Fluffing cushions…', code: 'Compiling mushrooms…', home: 'Putting the kettle on…',
  };
  const report = await buildWorld(ctx, (p, id) => ctx.ui.setProgress(0.05 + p * 0.85, labels[id]));
  if (report.failed.length) console.warn('[boot] some modules failed:', report.failed.map((f) => f.id));

  engine.addUpdate(props.tickProps, 25);
  ctx.player = createPlayer(ctx);
  ctx.cameraRig = createCameraRig(ctx);
  ctx.transport = createTransport(ctx);
  ctx.player.onAreaChange((id) => id && ctx.ui.showAreaBanner(id));

  ctx.ui.setProgress(0.95, 'Warming up shaders…');
  // Compile all shaders up front to avoid hitches on first view.
  try {
    await engine.renderer.compileAsync(engine.scene, engine.camera);
  } catch {
    /* compileAsync is an optimisation only */
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
