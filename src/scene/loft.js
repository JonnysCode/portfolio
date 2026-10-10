// ─────────────────────────────────────────────────────────────────────────────
// THE CODE LOFT — a treehouse halfway up the Great Oak ('code' spot).
//
//   loft/deck.js      the plank platform wrapping the trunk's front-right:
//                     joists on a bolted ledger, knee-braces, ropes from the
//                     limbs, a railing of crooked branches, moss & ivy
//   loft/house.js     the crooked timber-framed treehouse: shake roof, dormer,
//                     round gable window, stovepipe; inside the workstation
//                     (monitors + laptop scrolling code) and the rubber duck
//   loft/screens.js   the code / terminal screens and blinking LEDs (shader)
//   loft/props.js     telescope, weather vane, twig antenna, server log,
//                     tinkering bench with a little robot, lanterns, firefly
//                     jars, hanging baskets, fairy lights, plants …
//   loft/boards.js    the painted "Snail Lift" signs and the chalkboard (one
//                     canvas atlas, one mesh)
//   loft/stairs.js    the winding plank stair cantilevered from the bark,
//                     lanterns and fairy lights along its rope handrail
//   loft/elevator.js  the snail lift crawling up and down the bark between a
//                     stilted boarding platform on the roots and the deck
//   loft/kit.js       geometry helpers, materials and per-material batching,
//                     the per-tier level of detail (setDetail)
//
// Detail follows ctx.quality.tier (kit.setDetail): 'high' is the full
// hand-made loft; 'medium' and 'low' build branches, ropes, lashings, moss,
// toadstools and shakes with fewer segments and leave nail heads and tread
// pegs off ('low' also squares the boards' chamfers) — see LOFT_BUDGET.
// Shadows: the batches keep a material's non-casting bulk (flowers, lichen,
// lashings…) out of the shadow pass (Batch.build splitShadow); the interior and
// the duck never cast, and with shadows off ('low') nothing does.
//
// Hotspots (area 'code'): 'this-portfolio' (the workstation behind the big
// window), 'project-backend' (the hollow-log server), 'project-side' (the
// tinkering bench & robot), the rubber duck (kind 'secret') and the snail
// lift — a RIDE (loft/ride.js): the snail itself (up, or down from the Code
// Loft), the bell at its boarding platform on the roots (up; its ✦ beckons
// from the Schreinerei) and the lift gate on the deck (down to the Schreinerei,
// area 'woodworking': its ✦ beckons from the Code Loft).
//
// Exposes ctx.sites.loft = { deck, house, elevator, ride, anchors: { deck, door,
//   window, chimneyTop, telescope, stairBottom, liftBottom, liftTop } }.
// elevator.setPhase(u) / setTime(t) jump the lift (screenshots & debugging);
// ride.start('up' | 'down') rides it (debug.activateHotspot('Snail lift up to
// the Code Loft') does the same as a click).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OAK } from '../world/layout.js';
import { getHeight } from '../world/ground.js';
import { Batch, Halos, smallBitsRemap, makeMats, makeBark, makeRootTop, deckFrame, mergeByMaterial, setDetail } from './loft/kit.js';
import { buildDeck } from './loft/deck.js';
import { buildHouse, LIT_GLASS } from './loft/house.js';
import { createScreens } from './loft/screens.js';
import { createBoards } from './loft/boards.js';
import { buildProps } from './loft/props.js';
import { buildStairs } from './loft/stairs.js';
import { buildElevator } from './loft/elevator.js';
import { createLiftRide } from './loft/ride.js';
import { makeSmoke } from './cottage/smoke.js';
import { sharedUniforms } from '../core/materials.js';

/**
 * Triangle budget per tier (moduleStats: budget / overBudget). Measured with the
 * shared props (lanterns, string lights, the snail, the coder) included:
 * high ≈ 173k, medium ≈ 120k, low ≈ 91k triangles (round 5: + the lift slot's
 * framing; before round 4: 171k / 169k / 168k); shadow-pass triangles high ≈
 * 63k, medium ≈ 40k (were 98k / 92k). (moduleStats also counts the two
 * invisible lift hotspot boxes as draws: they are never rendered.)
 */
export const LOFT_BUDGET = { high: 185000, medium: 130000, low: 110000 };

export default async function build(ctx) {
  const root = new THREE.Group();
  root.name = 'code-loft';
  ctx.scene.add(root);
  const tick = () => new Promise((r) => window.setTimeout(r, 0));
  const shadows = ctx.quality?.shadows !== false;
  setDetail(ctx.quality?.tier ?? 'high');

  const mats = makeMats(ctx);
  const B = new Batch();
  const halos = new Halos();
  const env = {
    root,
    frame: deckFrame(),
    bark: makeBark(ctx),
    rootTop: makeRootTop(ctx, getHeight),
    rng: ctx.rng('code-loft'),
    halos,
    reduced: !!ctx.engine?.reducedMotion,
    density: ctx.quality?.density ?? 1,
  };
  const screens = createScreens(ctx);
  env.boards = createBoards(ctx); // painted signs & the chalkboard: one atlas, one mesh
  const updates = [];

  const deck = buildDeck(ctx, B, mats, env);
  await tick();
  const house = buildHouse(ctx, B, mats, env, screens);
  await tick();
  const props = buildProps(ctx, B, mats, env, { deck, house, screens, updates });
  env.extraLights = props.lightsGroup;
  await tick();
  const stairs = buildStairs(ctx, B, mats, env, { deck });
  await tick();
  const elevator = buildElevator(ctx, B, mats, env, { deck, updates });

  // ── merge the static geometry ─────────────────────────────────────────────
  B.build(root, 'loft', { mergeShadow: true, splitShadow: shadows, remap: smallBitsRemap(mats) });
  const scr = screens.build(root);
  env.boards.build(root);
  halos.build(ctx, root, { day: 0.06, night: 0.5 });
  if (props.lightsGroup) root.add(mergeFairyLights(props.lightsGroup));

  // chimney smoke from the stovepipe
  if (house.chimneyTop) {
    const smoke = makeSmoke([{ x: house.chimneyTop.x, y: house.chimneyTop.y, z: house.chimneyTop.z, scale: 0.75, puffs: 9, rise: 2.4 }], { reducedMotion: env.reduced });
    root.add(smoke);
  }

  // ── lights: a warm glow inside the house, the deck lantern ────────────────
  ctx.lights?.addPoint?.(house.interior.light, { color: '#ffb866', day: 0.5, night: 4.2, distance: 4.5 });
  if (props.lanternLight) ctx.lights?.addPoint?.(props.lanternLight, { color: '#ffb35c', day: 0.0, night: 5, distance: 8 });

  // the lamp-lit room glows through the big window's transom at night
  if (house.litGlass) {
    const m = house.litGlass;
    updates.push(() => {
      m.emissiveIntensity = LIT_GLASS.day + (LIT_GLASS.night - LIT_GLASS.day) * sharedUniforms.uNight.value;
    });
  }

  // ── hotspots ──────────────────────────────────────────────────────────────
  const area = 'code';
  // 'This Woodland' (the featured project): the camera looks straight in
  // through the big front window (faceAzimuth: from the house front, +X local,
  // turned a touch towards the window's middle), nearly level so the line of
  // sight passes under the transom and between the open casements, and lands
  // on the glowing screens (the hotspot's bounds are centred on them, house.js).
  ctx.interactions?.add?.(house.interior.workstation, {
    entryId: 'this-portfolio',
    area,
    focus: { faceAzimuth: Math.PI / 2 - 0.135, polar: 1.45, distance: 3.2, radius: 0.42 },
    approach: false,
    markerHeight: 0.85,
  });
  if (props.server) ctx.interactions?.add?.(props.server, { entryId: 'project-backend', area, focus: { distance: 3, height: 0.4 }, approach: false });
  if (props.bench) ctx.interactions?.add?.(props.bench, { entryId: 'project-side', area, focus: { distance: 3, height: 0.4 }, approach: false });
  const duck = house.interior.duck;
  if (duck) {
    let quackT = -10;
    // ui.speech lifts the bubble 1.6 above its anchor (villager height): anchor
    // it below the duck so the bubble pops up right above the little thing
    const speechAt = new THREE.Vector3();
    ctx.interactions?.add?.(duck, {
      kind: 'secret',
      area,
      label: 'A rubber duck…',
      approach: false,
      onActivate: () => {
        quackT = performance.now() / 1000;
        ctx.audio?.play?.('pop');
        duck.getWorldPosition(speechAt).y -= 1.3;
        ctx.ui?.speech?.('Quack. Have you tried explaining it to me?', speechAt);
      },
    });
    // a little squeeze-hop when it is clicked
    updates.push(() => {
      const k = performance.now() / 1000 - quackT;
      if (k < 0 || k > 0.6) {
        if (duck.scale.y !== 1 && !duck.userData.__hotspot?.__bounce) duck.scale.set(1, 1, 1);
        return;
      }
      const s = Math.sin((k / 0.6) * Math.PI);
      duck.position.y = HOUSE_DESK_TOP + s * 0.06;
      duck.scale.set(1 + s * 0.12, 1 - s * 0.15, 1 + s * 0.12);
    });
  }
  // the snail lift is a RIDE ("hop on a snail"): the camera rides along up the
  // trunk (or down it) beside the basket — loft/ride.js
  let ride = null;
  if (elevator?.hotspot) {
    ride = createLiftRide(ctx, { elevator, deck });
    updates.push((dt) => ride.update(dt));
    const UP = 'Snail lift up to the Code Loft', DOWN = 'Snail lift down to the Schreinerei';
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    /** an invisible box to click (excluded from the solid things that hide hotspots) */
    const proxy = (centre, size, name) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), hidden);
      m.name = name;
      m.position.copy(centre);
      m.rotation.y = elevator.axis.a;
      m.userData.__hotspotProxy = true;
      m.castShadow = m.receiveShadow = false;
      root.add(m);
      m.updateMatrixWorld(true);
      return m;
    };
    // the snail itself: up from anywhere, down from the Code Loft (no ✦ of its
    // own — the stations' ✦ stay put while it crawls)
    const snailHs = ctx.interactions?.add?.(elevator.hotspot, {
      area,
      label: UP,
      summary: 'Hop on: it carries you up the trunk.',
      approach: false,
      marker: false,
      onActivate: () => ride.start(ctx.cameraRig?.spot === 'code' ? 'down' : 'up'),
    });
    if (snailHs) {
      updates.push(() => {
        const down = ctx.cameraRig?.spot === 'code';
        if (snailHs.label !== (down ? DOWN : UP)) {
          snailHs.label = down ? DOWN : UP;
          snailHs.summary = down ? 'Hop on: it carries you down to the workshop.' : 'Hop on: it carries you up the trunk.';
        }
      });
    }
    // the bell at the boarding platform on the roots: its ✦ beckons from the
    // Schreinerei and the places around (a ride UP, to the Code Loft)
    ctx.interactions?.add?.(proxy(elevator.boarding.centre, elevator.boarding.size, 'lift-bell-hotspot'), {
      area,
      label: UP,
      summary: 'Ring the bell and ride the snail up the trunk.',
      approach: false,
      onActivate: () => ride.start('up'),
    });
    // the lift gate up on the deck: a ride DOWN to the Schreinerei (it belongs
    // there, so its ✦ beckons from the Code Loft)
    if (deck.slot?.outer) {
      ctx.interactions?.add?.(proxy(deck.slot.outer.clone().add(new THREE.Vector3(0, 0.85, 0)), [1.45, 1.7, 0.4], 'lift-gate-hotspot'), {
        area: 'woodworking',
        label: DOWN,
        summary: 'Ride the snail down the trunk to the workshop.',
        approach: false,
        onActivate: () => ride.start('down'),
      });
    }
  }

  ctx.colliders?.addCircle?.(stairs.bottom.x, stairs.bottom.z, 0.5, 'loft-stair');

  // shadow casters: the room's furniture and the duck sit under the house's own
  // shadow (the walls and roof cast it); with shadows off nothing needs to cast
  const noCast = (o) => o.isMesh && (o.castShadow = false);
  house.interior.workstation?.traverse(noCast);
  duck?.parent?.traverse(noCast);
  if (!shadows) root.traverse(noCast);

  ctx.sites.loft = {
    root,
    deck,
    house,
    elevator,
    ride,
    anchors: {
      deck: new THREE.Vector3(OAK.loft.x, OAK.loft.y, OAK.loft.z),
      door: house.door.centre,
      window: house.front.windowCentre,
      chimneyTop: house.chimneyTop,
      telescope: props.telescope,
      stairBottom: stairs.bottom,
      liftBottom: elevator?.bottom,
      liftTop: elevator?.top,
    },
    screens: scr,
  };
  root.userData.stats = { tris: B.tris };
  // screenshot harness probe: draw calls / triangles of this module (eval window.__loftStats())
  if (ctx.engine?.params?.has?.('shots')) {
    window.__loftStats = () => {
      let meshes = 0, casters = 0, tris = 0;
      root.traverseVisible((o) => {
        if (!o.isMesh) return;
        meshes++;
        if (o.castShadow) casters++;
        const g = o.geometry;
        const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
        tris += n * (o.isInstancedMesh ? o.count : 1);
      });
      const names = [];
      root.traverseVisible((o) => o.isMesh && names.push((o.name || o.parent?.name || '?') + ':' + (o.material?.name || '')));
      return { meshes, casters, tris: Math.round(tris), names: names.join(' ') };
    };
  }

  return {
    budget: LOFT_BUDGET,
    update(dt, t) {
      for (const u of updates) u(dt, t);
    },
  };
}

const HOUSE_DESK_TOP = 0.5;

/**
 * The loft's lanterns and fairy lights are the shared props (makeLantern,
 * makeStringLights): they keep the shared look — small warm bulbs with small
 * soft per-bulb halos — exactly like every other string in the glen. Only
 * their geometry is merged per material (dozens of strings → a few draw calls);
 * materials and halo sizes stay untouched.
 */
function mergeFairyLights(group) {
  return mergeByMaterial(group, 'loft-fairy-lights');
}
