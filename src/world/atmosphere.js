// ─────────────────────────────────────────────────────────────────────────────
// Atmosphere — the air of the glen.
//
//   aerial perspective  global fog-chunk override (env/fog.js): distance haze +
//                       ground-hugging height mist, warm towards the sun, cool
//                       blue-green elsewhere. Installed before anything compiles.
//   god rays            slanted golden shafts carved by the real canopy gaps
//                       (env/shafts.js, shadow-map driven)
//   sunbeam dust        glittering motes that only sparkle in sunlight
//                       (env/sunmotes.js)
//   low mist            drifting veils over the stream, the pool and the glen's
//                       rim, thicker & moonlit at night (env/groundMist.js)
//
// ctx.atmosphere = { fogParams, shafts, motes, mist, settings, addShaft(x, z, opts) }
//   settings.shafts / .motes / .mist — live multipliers (debug & tuning)
//   addShaft(x, z, { length, width, intensity }) — ask for a god ray falling on
//     (x, z) (e.g. onto a doorstep); returns false when the budget is used up.
//   Custom shaders can light things only where the sun gets through the
//     canopy with env/sunlight.js (sunVisibility(worldPos)), and get the same
//     aerial perspective with env/fog.js (fogUniforms() + the fog chunks).
// ─────────────────────────────────────────────────────────────────────────────
import { installFog, fogParams } from './env/fog.js';
import { updateSunlight } from './env/sunlight.js';
import { buildShafts } from './env/shafts.js';
import { buildSunMotes } from './env/sunmotes.js';
import { buildGroundMist } from './env/groundMist.js';

installFog();

export default async function build(ctx) {
  const { scene, engine } = ctx;
  const tier = ctx.quality?.tier ?? 'high';
  const settings = { shafts: 1, motes: 1, mist: 1 };

  const safe = (name, fn) => {
    try {
      return fn();
    } catch (err) {
      console.warn(`[atmosphere] ${name} failed`, err);
      return null;
    }
  };

  const shafts = safe('god rays', () => buildShafts(ctx));
  if (shafts) scene.add(shafts.mesh);
  const motes = safe('sunbeam dust', () => buildSunMotes(ctx));
  if (motes) {
    scene.add(motes.points);
    const h = engine.renderer.domElement.clientHeight || window.innerHeight;
    motes.resize(h * engine.renderer.getPixelRatio());
    engine.onResize((w, hh) => motes.resize(hh * engine.renderer.getPixelRatio()));
  }
  const mist = tier === 'low' ? null : safe('ground mist', () => buildGroundMist(ctx));
  if (mist) scene.add(mist.mesh);

  updateSunlight(ctx); // bind a valid (dummy) shadow texture before the first frame
  ctx.atmosphere = {
    fogParams,
    shafts,
    motes,
    mist,
    settings,
    addShaft: (x, z, opts) => shafts?.addShaft(x, z, opts) ?? false,
  };

  return {
    update(dt, t) {
      updateSunlight(ctx);
      const n = ctx.env?.night ?? 0;
      shafts?.update(n, t);
      if (shafts) shafts.uniforms.uStrength.value *= settings.shafts;
      motes?.update(n);
      if (motes) motes.uniforms.uStrength.value *= settings.motes;
      mist?.update(n, t);
      if (mist) mist.uniforms.uStrength.value *= settings.mist;
    },
  };
}
