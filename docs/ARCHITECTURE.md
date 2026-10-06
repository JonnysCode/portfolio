# Jonny's Woodland — architecture & art bible

A portfolio as a **miniature fantasy forest glen**: one small scene, dense
with handcrafted detail, explored by gliding the camera between *spots* and
clicking the little things you discover. Built **100% procedurally** with
three.js (no model or texture files).

## The glen

| Spot id       | Name              | What's there                                                        |
| ------------- | ----------------- | ------------------------------------------------------------------- |
| `glen`        | Jonny's Woodland  | the whole diorama — overview                                         |
| `woodworking` | Schreinerei       | **the heart** — a workshop built into the roots of the Great Oak     |
| `code`        | Code Loft         | a treehouse halfway up the oak, screens glowing                     |
| `home`        | Jonny's Cottage   | tall red mushroom house — about me & contact (mailbox)               |
| `interior`    | Wohnatelier       | second mushroom house, opened up to show a designed interior         |
| `bikes`       | Velowerkstatt     | stone-walled mushroom workshop across the stone bridge               |

`src/world/layout.js` holds every anchor (oak, door, loft, annex, deck,
cottages, stream, waterfall, bridge, bike shed, paths, spots & their camera
shots). `src/world/ground.js` gives `getHeight`, `getPathDistance`,
`getStreamDistance`, `isInWater`, `getPadAt`, `isFreeForScenery`. Pads (building
plots) are exactly flat at y = 0. `oakRadiusAt(y)` (layout.js) is the trunk's
radius contract that everything attached to the bark relies on.

## ⚠️ Owner feedback — read before anything else

On the first (open low-poly village) version the owner said: *"very cute, the
houses and pond, but the sizing and the woodland are not great yet. There is so
much space that isn't detailed at all, the trees are much too small, it doesn't
really feel like we're in a magical forest."* So:

1. **Keep the cuteness.** The charm of the cute mushroom houses (round friendly
   shapes, little windows, chimneys, flower boxes) and the pond (lily pads,
   reeds, ducks, a jetty) was loved. Target = *cute + magical + richly
   detailed*, never grim or hyper-real.
2. **Colossal trees — we are tiny in a forest of giants.** The Great Oak is
   huge (trunk ⌀ ≈ 7, crown up to ~40). The forest around and *inside* the
   glen must be giants too: trunks ⌀ 2.5–6, rising 40–70 units, mostly
   leaving the top of the frame like columns in a cathedral, their crowns
   forming a high canopy ceiling with light shafts falling through. A few of
   these giants stand inside the glen between the spots (never blocking a spot
   camera), with roots and moss at their feet. Nothing about the trees may
   read as "small decoration".
3. **No empty ground.** The glen is deliberately compact; every square unit
   visible from any spot camera is detailed: moss, ferns, flowers, roots,
   stones, little mushrooms, fallen logs, leaf litter, giant mushrooms. If a
   screenshot shows a bare patch, fill it.
4. **The pond is back:** `STREAM.pond` (layout.js) — the stream widens into a
   lily pond near the front-right before leaving the glen (ground.js carves it,
   `isInWater` includes it). The riverside builder owns it; the first
   version's pond props are in git (`git show 094cf9d:src/world/env/pondProps.js`,
   `094cf9d:src/world/water.js`) — reuse the charm (lily pads with flowers,
   cattails, ducks and ducklings, a little wooden jetty), restyled for the glen.

## Art bible

Reference images live in `/root/.claude/uploads/5671997e-a07c-5490-b81d-336014d01540/`
(`43ca44a8-image.png` giant tree with timber house · `7600c63f` red conical
mushroom houses "Fairy Garden" · `6e5c3de5` stone mushroom cottage + arch bridge
· `3a8d9364` fly-agaric house between giant roots with fairy lights ·
`a248b24e` giant mushrooms + mossy door + waterfall · `55eb4bc1` stone tower
house under a giant tree · `d57db346` fly-agaric forest path · `c0a98773`
mushroom houses on platforms in a giant tree with rope bridges). Look at them.

* **Mood:** magical, cozy, painterly — a Ghibli background painting turned
  into a miniature diorama. Golden afternoon light slanting through a huge
  canopy, cool blue-green misty depth behind, warm glows (windows, lanterns,
  fairy lights) against it. Night = enchanted: fireflies, glowing windows,
  string lights, soft moonlight.
* **Detail density is the point.** Every surface tells a story: moss creeping
  on roots, stones and roofs; ivy hanging; little mushrooms at every base;
  ferns and flowers; shingles that are actual shingles; timber framing with
  pegs; stones of an arch that are individual stones; worn steps; tools on
  hooks; smoke from chimneys. Imperfection everywhere — nothing ruler-straight,
  everything slightly crooked, bulging, sagging, hand-made (seeded jitter).
* **Shapes:** organic and exaggerated: tall conical mushroom caps with visible
  gills underneath, bulging stems, round/arched doors with stone or plank
  frames, steep crooked roofs, chimneys that lean, gnarled trunks with
  buttress roots. Cute proportions, but real craftsmanship (this is a
  cabinetmaker's portfolio — joinery must look right).
* **Materials:** `ctx.materials.surface(kind, opts)` (painterly PBR: bark, wood,
  timber, shingles, plaster, stone, cobble, rock, moss, soil, mushroomCap,
  mushroomStem, gills, leaf, fabric, rope, metal, glass, paper, thatch, clay),
  `ctx.materials.foliage(opts)` for leaf cards, `ctx.materials.glow(color, {day, night})`
  for everything that lights up. Characters (villagers, snails) keep their cute
  stylised look. Never mutate a cached material.
* **Light budget:** only `world/lighting.js` creates directional/hemisphere
  lights. Builders may add **warm point lights only through
  `ctx.lights.addPoint(position, opts)`** (budget-managed; see lighting.js), never
  `new THREE.PointLight` directly. Glow = emissive + bloom + glow sprites.
* **Life:** villagers busy with tasks, snails crawling (one is the treehouse
  elevator), smoke, swaying lanterns, fireflies, butterflies, the stream
  flowing, the waterfall foaming, motes drifting in sunbeams.

## Interaction model

The camera director (`systems/cameraRig.js`) glides between spots
(`rig.goTo(id)`), with gentle orbit/zoom/pan around the current one.
Hotspots (`ctx.interactions.add(object, { entryId, area: spotId, label })`)
open content panels; `kind: 'secret'` hotspots are hidden delights counted as
discoveries. Content lives only in `src/content/content.js`.

## Running & checking

```bash
npm run dev
npm run build
npm run shots -- --prefix me- --views glen,woodworking-close   # headless screenshots → shots/
npm run shots -- --prefix me- --param only=oak --views glen      # build only one module (+ light/sky/atmo/post)
```

Views: `overview`, `top`, and for every spot `<id>`, `<id>-wide`, `<id>-close`.
Custom: `--custom "name:px,py,pz:tx,ty,tz"`. Night: `--night`. UI: `--ui`, `--panel <entryId>`.
In page JS: `window.__woodland.debug` (`view`, `free`, `goTo`, `step`, `stats`, `hotspots`,
`activateHotspot`, `setNight`). In `?shots` mode time only advances via `debug.step(n)`.

## Source layout

```
src/main.js            boot; builds the shared ctx
src/content/content.js ✏️ all portfolio text
src/core/              engine, materials (+ textures), palette, rng, noise
src/world/             layout, ground, lighting, sky, atmosphere, terrain, vegetation, ambient, post
src/scene/             oak, schreinerei, loft, cottage, riverside (one module + optional folder each)
src/props/             villagers, snails, signs, lanterns, string lights, tools, decor …
src/systems/           cameraRig (spots), interactions (hotspots), colliders, env (day/night)
src/ui/  src/audio/    HTML overlay & synthesized sound
scripts/shots.mjs      screenshot / smoke harness
```

World modules: `export default async function build(ctx) { …; return { update?(dt, t) } }`,
built in world coordinates; `anchorGroup(ctx, anchor)` from `world/index.js`
gives a group placed/rotated at a layout anchor. A module that throws is
skipped (the rest of the glen still loads).

## Performance budget

* Desktop target 60 fps (mid GPU), phones 30 fps at `medium`/`low` tier.
* Whole scene ≲ 2.5 M triangles and ≲ 450 draw calls at `high`.
  Per scene module ≲ 60 draw calls. Merge static meshes per material
  (`mergeGeometries`), `InstancedMesh` for repeats (shingles, stones, leaves,
  bulbs). Share geometries & materials.
* No per-frame allocations. Small details `castShadow = false`.
* Scale scatter/leaf counts by `ctx.quality.density`.
