# Jonny's Woodland — architecture & art direction

A portfolio as a tiny explorable world: a cozy woodland village of mushroom
houses, little villagers and rideable snails, built **100% procedurally** with
three.js (no 3D model files). Each district shows one passion:

| Area id       | Name             | Theme                                   |
| ------------- | ---------------- | --------------------------------------- |
| `plaza`       | Village Square   | hub: signposts, Schneckenpost stop      |
| `woodworking` | Schreinerei      | **the heart** — woodworking, Schreiner EFZ |
| `bikes`       | Velowerkstatt    | bike building                           |
| `interior`    | Wohnatelier      | interior design                         |
| `code`        | Code Grove       | software engineering                    |
| `home`        | Jonny's Cottage  | about me & contact                      |

## Running

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # static site in dist/
npm run shots -- --views woodworking,woodworking-close   # headless screenshots → shots/
```

`npm run shots` is the main feedback loop: it boots the world in headless
Chromium, renders camera views to `shots/*.png`, prints render stats and fails on
any console error. See the header of `scripts/shots.mjs` for all flags
(`--night`, `--ui`, `--panel <entryId>`, `--eval <js>`, `--custom name:px,py,pz:tx,ty,tz`).
In the browser, `window.__woodland.debug` exposes the same helpers
(`view('bikes')`, `free()`, `teleportToArea('home')`, `stats()`, `hotspots()` …).
Add `?debug` to the URL for extra logging, `?q=low|medium|high` to force a
quality tier, `?night=1` to start at night.

## Source layout

```
src/
  main.js              boot sequence, builds the shared `ctx`
  debug.js             window.__woodland.debug (views, stats, hotspots)
  content/content.js   ✏️ ALL portfolio text & projects (the only file to edit for content)
  core/
    engine.js          renderer, scene, camera, update loop, quality tiers
    materials.js       cached toon/wood/glow materials, wind shader helper
    palette.js         the colour palette — use it
    rng.js, noise.js   seeded randomness, simplex noise, math helpers
  world/
    layout.js          WHERE everything is (areas, paths, pond, spawn) — single source of truth
    ground.js          getHeight(x,z), getPathDistance, isFreeForScenery … (baked heightfield)
    index.js           loads world modules + districts (dynamic import, failure-isolated)
    lighting.js sky.js terrain.js water.js vegetation.js ambient.js
  props/               reusable procedural props (mushroom house, person, snail, signs, decor)
  districts/           one builder per area: plaza, woodworking, bikes, interior, code, home
  systems/             player, cameraRig, interactions (hotspots), transport (snails), colliders, env (day/night)
  ui/                  HTML overlay (loader, HUD, panels, guidebook) + styles.css
  audio/               synthesized WebAudio sfx
scripts/shots.mjs      screenshot / smoke-test harness
```

## The shared context (`ctx`)

Every module receives `ctx`:

| key | what |
| --- | --- |
| `engine` | `{ renderer, scene, camera, quality, params, isTouch, reducedMotion, addUpdate(fn, order), setRenderFn(fn), onResize(fn), step(dt) }` |
| `scene`, `camera`, `THREE` | the obvious |
| `quality` | `{ tier: 'high'\|'medium'\|'low', shadows, shadowMapSize, density (0..1 scatter density), post }` |
| `palette`, `materials` | shared colours / cached materials (`toon`, `wood`, `standard`, `basic`, `glow`) |
| `layout`, `ground` | modules `world/layout.js`, `world/ground.js` |
| `content` | module `content/content.js` (`profile`, `areas`, `entries`, `getEntry`, `entriesForArea`) |
| `props` | module `props/index.js` |
| `rng(seed)` | seeded RNG factory (`range`, `int`, `pick`, `chance`, `jitter`, `fork`) |
| `colliders` | `addCircle(x,z,r)`, `addBox(x,z,hw,hd,rotY)`, `resolve(pos, radius)`, `isBlocked` — WORLD coords |
| `env` | day/night: `env.night` (0..1, eased), `env.isNight`, `setNight(bool)`, `toggle()`, `onChange(fn)` |
| `interactions` | `add(object, { entryId, label, onActivate, area, focus })`, `onGroundClick(fn)`, `hotspots` |
| `ui` | `openEntry(id)`, `openArea(id)`, `toast(text)`, `speech(text, object3d)`, `showDestinations(areaId)`, … |
| `audio` | `play(name)` |
| `sites` | district `site` objects by id (after build) |
| `player`, `cameraRig`, `transport` | created after the world is built (read lazily inside update functions) |
| `lights` | set by `world/lighting.js`: `{ sun, hemi, … }` |

Update order convention for `engine.addUpdate(fn, order)`: env 5, input/interactions 1–9,
player 10, world & districts 20, camera 80, effects/UI projection 90+.

## District contract

```js
// src/districts/<id>.js
export default async function build(ctx, site) {
  // build in LOCAL coordinates: origin = clearing centre, ground y = 0,
  // local +Z points to the plaza (where visitors arrive from).
  site.group.add(mesh);
  site.addCollider(x, z, r);                    // local circle collider
  site.addBoxCollider(x, z, halfW, halfD, rotY); // local oriented box collider
  site.addHotspot(object, { entryId: 'dining-table', focus: { distance: 7, height: 0.5 } });
  site.addUpdate((dt, t) => { /* animate */ });
  return {};
}
```

`site` also has `id, area, radius, facing, rng, toWorld(x,z), toLocal(x,z), heightAt(x,z)`,
`stationLocal` (the snail stop — keep a 2.5-unit circle around it clear) and
`entranceLocal` (`{x:0, z:radius}` — keep the corridor |x| < 2.2 for z > radius − 6 clear so
the path flows into the clearing). Keep content inside `radius − 0.5`; the
ground outside a clearing is not flat (use `site.heightAt`).

Every content entry of a district (`content.entriesForArea(id)`) must be
reachable through at least one hotspot in that district.

## Art direction

* **Storybook woodland at golden hour.** Think Animal Crossing × Ghibli × a
  tabletop diorama: chunky, rounded, soft, slightly exaggerated, warm. Nothing
  sharp, grim or realistic. Cute > accurate, but the *woodworking* should still
  read as real craftsmanship (visible joinery, grain, proper proportions).
* **Shapes:** prefer rounded primitives — `CapsuleGeometry`, scaled spheres,
  `LatheGeometry` profiles, `RoundedBoxGeometry` (`three/addons/geometries/RoundedBoxGeometry.js`),
  `ExtrudeGeometry` with bevels, tubes along curves. Slight irregularity (seeded
  jitter in rotation/scale) keeps things hand-made.
* **Scale:** villager ≈ 1.1 units tall with a big head (~40 % of height);
  door ≈ 1.5; mushroom house 4–7; big tree 8–14; riding snail ≈ 2.3 long.
* **Colour:** take colours from `palette.js`. Warm, saturated, never pure
  black/white. Wood via `materials.wood('oak' | 'walnut' | 'spruce' | 'ash' | 'cherry' | 'maple')`.
* **Materials:** `materials.toon()` for almost everything (cel-shaded with a
  soft 4-step ramp), `materials.standard()` only for metal/glass, `materials.glow()`
  for anything that should light up at night (windows, lanterns, screens,
  glowing mushrooms). Never mutate a cached material.
* **Lights:** districts must NOT add lights. Night glow = `materials.glow()` +
  additive glow sprites. Only `world/lighting.js` owns lights.
* **Life:** everything should feel alive — subtle bobbing, swaying, blinking,
  smoke from chimneys, villagers busy with tasks. Use `dt`; respect
  `ctx.engine.reducedMotion` for big motions.

## Performance budget

* Target 60 fps on a mid laptop, 30+ on phones. Whole scene ≲ 600 draw calls, ≲ 1.5 M triangles at `high`.
* Per district: ≲ 120 draw calls, ≲ 150k triangles. Merge static meshes that
  share a material (`mergeGeometries` from `three/addons/utils/BufferGeometryUtils.js`)
  and use `InstancedMesh` for repeats.
* No allocations in per-frame code (reuse vectors/quaternions).
* Small details: `castShadow = false`. Big shapes cast; ground-ish things receive.
* Scale scatter counts with `ctx.quality.density`.
