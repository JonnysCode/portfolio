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
//                     tinkering bench with a little robot, lanterns, plants …
//   loft/stairs.js    the winding plank stair cantilevered from the bark
//   loft/elevator.js  the snail lift crawling up and down the bark
//   loft/kit.js       geometry helpers, materials and per-material batching
//
// Hotspots (area 'code'): 'this-portfolio' (the workstation behind the big
// window), 'project-backend' (the hollow-log server), 'project-side' (the
// tinkering bench & robot), the rubber duck (kind 'secret') and the snail
// lift (glides the camera to the loft).
//
// Exposes ctx.sites.loft = { deck, house, elevator, anchors: { deck, door,
//   window, chimneyTop, telescope, stairBottom, liftBottom, liftTop } }.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OAK } from '../world/layout.js';
import { getHeight } from '../world/ground.js';
import { Batch, Halos, smallBitsRemap, makeMats, makeBark, makeRootTop, deckFrame, mergeByMaterial } from './loft/kit.js';
import { buildDeck } from './loft/deck.js';
import { buildHouse } from './loft/house.js';
import { createScreens } from './loft/screens.js';
import { buildProps } from './loft/props.js';
import { buildStairs } from './loft/stairs.js';
import { buildElevator } from './loft/elevator.js';
import { makeSmoke } from './cottage/smoke.js';

export default async function build(ctx) {
  const root = new THREE.Group();
  root.name = 'code-loft';
  ctx.scene.add(root);
  const tick = () => new Promise((r) => window.setTimeout(r, 0));

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
  B.build(root, 'loft', { mergeShadow: true, remap: smallBitsRemap(mats) });
  const scr = screens.build(root);
  halos.build(ctx, root, { day: 0.06, night: 0.5 });
  if (props.lightsGroup) root.add(mergeByMaterial(props.lightsGroup, 'loft-fairy-lights'));

  // chimney smoke from the stovepipe
  if (house.chimneyTop) {
    const smoke = makeSmoke([{ x: house.chimneyTop.x, y: house.chimneyTop.y, z: house.chimneyTop.z, scale: 0.75, puffs: 9, rise: 2.4 }], { reducedMotion: env.reduced });
    root.add(smoke);
  }

  // ── lights: a warm glow inside the house, the deck lantern ────────────────
  ctx.lights?.addPoint?.(house.interior.light, { color: '#ffb866', day: 0.5, night: 4.2, distance: 4.5 });
  if (props.lanternLight) ctx.lights?.addPoint?.(props.lanternLight, { color: '#ffb35c', day: 0.0, night: 5, distance: 8 });

  // ── hotspots ──────────────────────────────────────────────────────────────
  const area = 'code';
  ctx.interactions?.add?.(house.interior.workstation, { entryId: 'this-portfolio', area, focus: { distance: 3.4, height: 0.1 }, approach: false });
  if (props.server) ctx.interactions?.add?.(props.server, { entryId: 'project-backend', area, focus: { distance: 3, height: 0.4 }, approach: false });
  if (props.bench) ctx.interactions?.add?.(props.bench, { entryId: 'project-side', area, focus: { distance: 3, height: 0.4 }, approach: false });
  const duck = house.interior.duck;
  if (duck) {
    let quackT = -10;
    ctx.interactions?.add?.(duck, {
      kind: 'secret',
      area,
      label: 'A rubber duck…',
      approach: false,
      onActivate: () => {
        quackT = performance.now() / 1000;
        ctx.audio?.play?.('pop');
        ctx.ui?.speech?.('Quack. Have you tried explaining it to me?', duck);
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
  if (elevator?.hotspot) {
    ctx.interactions?.add?.(elevator.hotspot, {
      area,
      label: 'Snail lift to the Code Loft',
      approach: false,
      onActivate: () => ctx.cameraRig?.goTo?.('code'),
    });
  }

  ctx.colliders?.addCircle?.(stairs.bottom.x, stairs.bottom.z, 0.5, 'loft-stair');

  ctx.sites.loft = {
    root,
    deck,
    house,
    elevator,
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
    update(dt, t) {
      for (const u of updates) u(dt, t);
    },
  };
}

const HOUSE_DESK_TOP = 0.5;
