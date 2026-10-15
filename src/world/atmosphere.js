// ─────────────────────────────────────────────────────────────────────────────
// Atmosphere — the air of the glen.
//
//   aerial perspective  global fog-chunk override (env/fog.js): distance haze +
//                       ground-hugging height mist, warm towards the sun, cool
//                       blue-green elsewhere. Installed before anything compiles.
//   god rays            slanted golden shafts carved by the real canopy gaps
//                       (env/shafts.js, shadow-map driven) + the canopy-gap
//                       sunbeam onto the Schreinerei (lighting's SpotLight);
//                       by night two hero moonbeams (one slanting down from
//                       the moon's side through the crown gap right of the
//                       loft onto the path to the bridge — seen from the glen,
//                       the overview, the eye-level intro and the bikes, never
//                       across the Schreinerei porch — and one from the moon's
//                       gap by the falls onto the plunge pool) + a quieter one
//                       on the lily pond stay on
//   sunbeam dust        glittering motes that only sparkle in sunlight
//                       (env/sunmotes.js)
//   pixie dust          bigger twinkling gold & mint sparkles swirling around
//                       the magical places (oak door, fairy ring, lily pond,
//                       waterfall pool) and flashing in the god rays — the
//                       daytime magic (env/sparkles.js)
//   low mist            drifting veils over the stream, the pool and the glen's
//                       rim, thicker & moonlit at night (env/groundMist.js)
//
// ctx.atmosphere = { fogParams, shafts, motes, sparkles, mist, settings, moonbeams, addShaft(x, z, opts), addMoonbeam(x, z, opts) }
//   moonbeams — the hero moonbeams once placed: [{ foot, axis, width, length }]
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
import { dirFromAngles, SUN_LIGHT_DIR } from './env/celestial.js';
import { updateSunlight } from './env/sunlight.js';
import { buildShafts } from './env/shafts.js';
import { buildSunMotes } from './env/sunmotes.js';
import { buildSparkles } from './env/sparkles.js';
import { buildGroundMist } from './env/groundMist.js';

installFog();

/**
 * The hero moonbeam: from the moon's side (between the moon disc's azimuth and
 * the moonlight's), slanting down through the crown gap right of the loft onto
 * the path to the bridge. From the glen camera it stands in the dark air
 * between the oak's stairs and the falls (clear of the Schreinerei porch and
 * the door), from the overview likewise, at the eye-level intro on the right,
 * on the bikes' wide shot on the left. (A beam rising from the fairy ring
 * could not avoid the porch: from every composed camera the ring lies right
 * in front of the Schreinerei.)
 */
const HERO_BEAM = { x: 6.2, z: 6.4, elevation: 60, azimuth: 30, length: 21, width: 3.4, intensity: 0.9 };
/** The plunge-pool beam: from the gap below-right of the moon (from the glen), down onto the pool. */
const FALLS_BEAM = { elevation: 60, azimuth: 40, length: 24, width: 4.0, intensity: 1.45 };

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
  // two broad golden shafts slanting right across the glen's middle (the
  // meadow in front of the oak, the path to the bridge) — chosen stages like
  // the Schreinerei's beam, so the zoomed-out shots get their god rays too
  if (shafts) {
    for (const [x, z, w, i] of [[-1, 7, 3.6, 1.7], [6, 9, 3.0, 1.4]]) {
      shafts.addBeam(x, getHeight(x, z), z, SUN_LIGHT_DIR, { length: 26, width: w, intensity: i });
    }
  }
  // moonbeams: placed on the first frame after the build, once the fairy ring
  // stands (its pixie dust gathers there). Two hero beams, each landing in a
  // little pool of glowing mist with slow silver motes drifting down inside:
  // the path beam (HERO_BEAM) and one falling from the moon's canopy gap by
  // the waterfall onto the plunge pool. The lily pond gets a quieter one.
  let moonbeams = false;
  const ringBox = new THREE.Box3();
  /**
   * The fairy ring's centre on the ground: the centre of the vegetation's
   * secret hotspot (or of its 'fairy-ring' group). Never the group's own
   * position — its meshes are merged in world space, so that is the origin.
   */
  function ringCentre() {
    const c = new THREE.Vector3();
    const spot = ctx.interactions?.hotspots?.find((h) => /fairy ring/i.test(h.label ?? ''));
    let found = false;
    try {
      if (spot?.center) {
        spot.center(c);
        found = Number.isFinite(c.x) && Math.hypot(c.x, c.z) > 0.5;
      }
    } catch {
      found = false;
    }
    if (!found) {
      const obj = scene.getObjectByName('fairy-ring');
      if (!obj) return null;
      ringBox.setFromObject(obj);
      if (ringBox.isEmpty()) return null;
      ringBox.getCenter(c);
    }
    c.y = getHeight(c.x, c.z);
    return c;
  }
  function placeMoonbeams() {
    moonbeams = true;
    const ring = ringCentre();
    // the pixie dust gathers on the fairy ring
    if (ring && sparkles) sparkles.anchors.ring.set(ring.x, ring.y + 0.05, ring.z);
    if (!shafts) return;
    const heroes = [];
    for (const [b, foot] of [
      [HERO_BEAM, new THREE.Vector3(HERO_BEAM.x, getHeight(HERO_BEAM.x, HERO_BEAM.z), HERO_BEAM.z)],
      [FALLS_BEAM, new THREE.Vector3(STREAM.pool.x, getHeight(STREAM.pool.x, STREAM.pool.z), STREAM.pool.z)],
    ]) {
      const axis = dirFromAngles(b.elevation, b.azimuth);
      shafts.addMoonbeam(foot.x, foot.z, { length: b.length, width: b.width, intensity: b.intensity, axis });
      heroes.push({ foot, axis, width: b.width, length: b.length });
    }
    // a quieter, short one on the lily pond (steep: it never climbs across
    // the bridge or the Velowerkstatt cap in the glen shot)
    shafts.addMoonbeam(STREAM.pond.x, STREAM.pond.z, { length: 10, width: 3.0, intensity: 0.6, axis: dirFromAngles(68, 20) });
    mist?.setBeams(heroes);
    sparkles?.setBeams(heroes);
    if (ctx.atmosphere) ctx.atmosphere.moonbeams = heroes;
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
    moonbeams: [],
    addShaft: (x, z, opts) => shafts?.addShaft(x, z, opts) ?? false,
    addMoonbeam: (x, z, opts) => shafts?.addMoonbeam(x, z, opts) ?? false,
  };

  return {
    update(dt, t) {
      updateSunlight(ctx);
      // (once the whole world is built: the fairy ring is the vegetation's)
      if (!moonbeams && ctx.buildReport) placeMoonbeams();
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
