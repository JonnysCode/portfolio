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
import { releaseStaticArrays } from './core/memory.js';
import { waitForPrograms } from './core/shaders.js';
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

/**
 * Compile every program the scene needs (against the post chain's HDR target
 * when post-processing is on, so the variants actually drawn get compiled) and
 * wait until they are linked, reporting progress 0…1 (core/shaders.js).
 */
async function warmUpShaders(engine, target, onProgress) {
  const { renderer, scene, camera } = engine;
  let used;
  renderer.setRenderTarget(target);
  try {
    used = renderer.compile(scene, camera);
  } finally {
    renderer.setRenderTarget(null);
  }
  const programs = [...new Set([...(used ?? [])].map((m) => renderer.properties.get(m).currentProgram).filter(Boolean))];
  await waitForPrograms(renderer, programs, onProgress);
}

/**
 * Wait until the GPU has finished everything submitted so far (a fence): a
 * frame submitted is not a frame drawn — without three's shader diagnostics
 * the driver may still be compiling the first frame's shaders when step()
 * returns. Resolves early after `timeoutMs` or without fenceSync. onTick(ms)
 * is called while waiting (the loader eases on: the GPU gives no fraction).
 */
async function gpuIdle(renderer, timeoutMs, onTick = () => {}) {
  const gl = renderer.getContext();
  const sync = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) return;
  gl.flush();
  const t0 = performance.now();
  try {
    while (gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED && performance.now() - t0 < timeoutMs) {
      onTick(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 25));
    }
  } finally {
    gl.deleteSync(sync);
  }
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

/** Boot phase marker (scripts/profile.mjs reads `woodland:*` marks). */
const mark = (name) => performance.mark?.(`woodland:${name}`);

async function boot() {
  mark('boot');
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
  // A lost WebGL context cannot be restored (geometry arrays and baked maps are not
  // kept on the CPU): stop drawing and ask for a reload instead of freezing silently.
  canvas.addEventListener(
    'webglcontextlost',
    () => {
      engine.stop();
      ctx.ui?.toast?.('The woodland lost its graphics — please reload the page.', 600000);
    },
    { once: true },
  );
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

  mark('fonts');
  ctx.ui.setProgress(0.05, 'Planting mushrooms…');
  const labels = {
    lighting: 'Hanging the sun…', sky: 'Painting the sky…', atmosphere: 'Letting the mist in…', terrain: 'Rolling out the moss…',
    oak: 'Growing the Great Oak…', schreinerei: 'Sharpening chisels…', loft: 'Booting the treehouse…', cottage: 'Putting the kettle on…',
    riverside: 'Filling the stream…', vegetation: 'Unfurling ferns…', ambient: 'Waking the fireflies…', post: 'Polishing the lens…',
  };
  // (texture bakes wait until the world is built — see materials.holdBakes — so
  //  the shaders each module queues compile while the next one builds)
  materials.holdBakes?.(true);
  const report = await buildWorld(ctx, (p, id) => ctx.ui.setProgress(0.05 + p * 0.55, labels[id]));
  mark('world');
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
  // (every hotspot exists now: free the geometry arrays nothing reads again, on upload)
  try {
    ctx.releasedArrays = releaseStaticArrays(ctx);
  } catch (err) {
    console.warn('[boot] array release skipped', err);
  }

  // Loader bands after the build (0.05–0.60): the shaders queued while building
  // (0.60–0.80), the texture bakes (0.80–0.86), the rest of the warm-up
  // (0.86–0.90), the GPU drawing the first frame (0.90–0.99).
  materials.holdBakes?.(false);
  try {
    await materials.flushBakes?.({
      onCompile: (k) => ctx.ui.setProgress(0.6 + k * 0.2, 'Warming up shaders…'),
      onBake: (k) => ctx.ui.setProgress(0.8 + k * 0.06, 'Painting the bark and moss…'),
    });
  } catch (err) {
    console.warn('[boot] texture bakes failed', err);
  }
  mark('baked');
  ctx.ui.setProgress(0.86, 'Warming up shaders…');
  // Compile all shaders up front to avoid hitches on first view.
  try {
    await warmUpShaders(engine, ctx.post?.target ?? null, (k) => ctx.ui.setProgress(0.86 + k * 0.04));
  } catch {
    /* the warm-up is an optimisation only */
  }
  mark('compiled');
  engine.step(1 / 60);
  mark('first-frame');
  // (production: the link checks three's diagnostics would have done, once, now that everything is linked)
  materials.verifyBakes?.();
  engine.verifyPrograms?.();
  // the loader never says "Welcome!" before the GPU has drawn that first frame
  // (shaders still compiling would freeze the intro flight instead)
  try {
    await gpuIdle(engine.renderer, 20000, (ms) => ctx.ui.setProgress(0.9 + 0.09 * (1 - Math.exp(-ms / 8000)), 'Warming up shaders…'));
  } catch {
    /* a fence is an optimisation only */
  }
  mark('first-frame-gpu');
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
