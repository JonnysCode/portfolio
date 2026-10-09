// ─────────────────────────────────────────────────────────────────────────────
// Atmosphere — the air of the glen.
//
//   aerial perspective  global fog-chunk override (env/fog.js): distance haze +
//                       ground-hugging height mist, warm towards the sun, cool
//                       blue-green elsewhere. Installed before anything compiles.
//   god rays            slanted golden shafts carved by the real canopy gaps
//                       (env/shafts.js, shadow-map driven) + the canopy-gap
//                       sunbeam onto the Schreinerei (lighting's SpotLight);
//                       by night two wide hero moonbeams (the fairy ring, and
//                       from the moon's gap onto the plunge pool) + quieter
//                       ones (lily pond, the path) stay on
//   sunbeam dust        glittering motes that only sparkle in sunlight
//                       (env/sunmotes.js)
//   pixie dust          bigger twinkling gold & mint sparkles swirling around
//                       the magical places (oak door, fairy ring, lily pond,
//                       waterfall pool) and flashing in the god rays — the
//                       daytime magic (env/sparkles.js)
//   low mist            drifting veils over the stream, the pool and the glen's
//                       rim, thicker & moonlit at night (env/groundMist.js)
//
// ctx.atmosphere = { fogParams, shafts, motes, sparkles, mist, settings, addShaft(x, z, opts), addMoonbeam(x, z, opts) }
//   settings.shafts / .motes / .sparkles / .mist — live multipliers (debug & tuning)
//   addShaft(x, z, { length, width, intensity }) — ask for a god ray falling on
//     (x, z) (e.g. onto a doorstep); returns false when the budget is used up.
//   Custom shaders can light things only where the sun gets through the
//     canopy with env/sunlight.js (sunVisibility(worldPos)), and get the same
//     aerial perspective with env/fog.js (fogUniforms() + the fog chunks).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { installFog, fogParams } from './env/fog.js';
import { STREAM } from './layout.js';
import { getHeight } from './ground.js';
import { dirFromAngles } from './env/celestial.js';
import { updateSunlight } from './env/sunlight.js';
import { buildShafts } from './env/shafts.js';
import { buildSunMotes } from './env/sunmotes.js';
import { buildSparkles } from './env/sparkles.js';
import { buildGroundMist } from './env/groundMist.js';

installFog();

export default async function build(ctx) {
  const { scene, engine } = ctx;
  const tier = ctx.quality?.tier ?? 'high';
  const settings = { shafts: 1, motes: 1, sparkles: 1, mist: 1 };

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
  // the canopy-gap sunbeam pooling on the Schreinerei (matches lighting's SpotLight)
  const dayBeam = ctx.lights?.beams?.day;
  if (shafts && dayBeam) {
    const axis = new THREE.Vector3().subVectors(dayBeam.pos, dayBeam.target);
    const foot = dayBeam.target;
    shafts.addBeam(foot.x, foot.y - 0.4, foot.z, axis, { length: 22, width: 2.4, intensity: 0.75 });
  }
  // moonbeams: placed on the first frame, once the lighting knows where the fairy ring is.
  // Two hero beams, wide and bright, each landing in a pool of glowing mist
  // with slow silver motes drifting down inside: one on the fairy ring (along
  // the lighting's night beam, so it matches the light pool there — seen from
  // the glen and the overview), one falling from the moon's canopy gap above
  // the waterfall onto the plunge pool. The pond and the path get quieter ones.
  let moonbeams = false;
  function placeMoonbeams() {
    moonbeams = true;
    const ring = ctx.lights?.beams?.night;
    // the pixie dust gathers on the fairy ring the lighting found (vegetation's hotspot)
    if (ring && sparkles) sparkles.anchors.ring.set(ring.target.x, ring.target.y - 0.15, ring.target.z);
    if (!shafts) return;
    const heroes = [];
    if (ring) {
      const axis = new THREE.Vector3().subVectors(ring.pos, ring.target).normalize();
      const foot = new THREE.Vector3(ring.target.x, getHeight(ring.target.x, ring.target.z), ring.target.z);
      shafts.addMoonbeam(foot.x, foot.z, { length: 24, width: 4.5, intensity: 1.8, axis });
      heroes.push({ foot, axis, width: 4.5, length: 24 });
    }
    {
      const axis = dirFromAngles(64, 14);
      const foot = new THREE.Vector3(STREAM.pool.x, getHeight(STREAM.pool.x, STREAM.pool.z), STREAM.pool.z);
      shafts.addMoonbeam(foot.x, foot.z, { length: 30, width: 4.2, intensity: 1.7, axis });
      heroes.push({ foot, axis, width: 4.2, length: 30 });
    }
    shafts.addMoonbeam(STREAM.pond.x, STREAM.pond.z, { length: 26, width: 3.4, intensity: 1.0 });
    shafts.addMoonbeam(1.0, 8.6, { length: 24, width: 2.4, intensity: 0.7 });
    mist?.setBeams(heroes);
    sparkles?.setBeams(heroes);
  }
  const motes = safe('sunbeam dust', () => buildSunMotes(ctx));
  if (motes) {
    scene.add(motes.points);
    const h = engine.renderer.domElement.clientHeight || window.innerHeight;
    motes.resize(h * engine.renderer.getPixelRatio());
    engine.onResize((w, hh) => motes.resize(hh * engine.renderer.getPixelRatio()));
  }
  const sparkles = safe('pixie dust', () => buildSparkles(ctx));
  if (sparkles) {
    scene.add(sparkles.points);
    const h = engine.renderer.domElement.clientHeight || window.innerHeight;
    sparkles.resize(h * engine.renderer.getPixelRatio());
    engine.onResize((w, hh) => sparkles.resize(hh * engine.renderer.getPixelRatio()));
  }
  const mist = tier === 'low' ? null : safe('ground mist', () => buildGroundMist(ctx));
  if (mist) scene.add(mist.mesh);

  updateSunlight(ctx); // bind a valid (dummy) shadow texture before the first frame
  ctx.atmosphere = {
    fogParams,
    shafts,
    motes,
    sparkles,
    mist,
    settings,
    addShaft: (x, z, opts) => shafts?.addShaft(x, z, opts) ?? false,
    addMoonbeam: (x, z, opts) => shafts?.addMoonbeam(x, z, opts) ?? false,
  };

  return {
    update(dt, t) {
      updateSunlight(ctx);
      if (!moonbeams) placeMoonbeams();
      const n = ctx.env?.night ?? 0;
      shafts?.update(n, t);
      if (shafts) shafts.uniforms.uStrength.value *= settings.shafts;
      motes?.update(n);
      if (motes) motes.uniforms.uStrength.value *= settings.motes;
      sparkles?.update(n);
      if (sparkles) {
        sparkles.uniforms.uStrength.value = settings.sparkles;
        sparkles.points.visible = settings.sparkles > 0.001;
      }
      mist?.update(n, t);
      if (mist) mist.uniforms.uStrength.value *= settings.mist;
    },
  };
}
