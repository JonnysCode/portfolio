// ─────────────────────────────────────────────────────────────────────────────
// The Riverside — the stream, the waterfall, the stone bridge, the lily pond
// and the Velowerkstatt (the 'bikes' spot). Refs: the stone mushroom cottage
// with its arch bridge, the painterly mossy waterfall, the stone tower house.
//
//   riverside/kit.js      shared materials, Batch (merge per material), stones,
//                         boulders, moss, planks, leaf cards, ivy, toadstools …
//   riverside/water.js    ONE animated water surface for stream + plunge pool +
//                         lily pond (flow-aligned ripples, foam, depth tint,
//                         sparkles, night glints) — exports flowAt/depthAt/calmAt
//   riverside/falls.js    the mossy boulder outcrop, three falling tiers, spray
//   riverside/bridge.js   the humpbacked stone arch bridge with lanterns
//   riverside/banks.js    stream rocks, bank vegetation, the lily pond (pads,
//                         lilies, jetty, frog, duck family), drifting leaves
//   riverside/workshop.js the Velowerkstatt (stone drum, arched doors, bell cap)
//   riverside/bike.js     makeBike({ style: 'gravel'|'road'|'vintage', … }), makeWheel()
//   riverside/puffs.js    makePuffs() — vertex-animated spray / smoke clouds
//
// Module result (ctx.modules.riverside): { update, anchors, stats } with world-space
// anchors { bridgeLanterns, bridgeCentre, workshopDoor, chimneyTop, heroBike,
// truingStand, vintageBike } for anyone who wants to point at them (ambient
// life, signposts, the camera rig …).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { Batch } from './riverside/kit.js';
import { buildWater } from './riverside/water.js';
import { buildBridge, BIKE_SPOT } from './riverside/bridge.js';
import { buildWorkshop } from './riverside/workshop.js';
import { makeBike } from './riverside/bike.js';
import { buildFalls } from './riverside/falls.js';
import { planStreamRocks, buildBanks, buildPond, buildDrifters } from './riverside/banks.js';

export default async function build(ctx) {
  const before = new Set(ctx.scene.children);
  const timings = {};
  let tLast = performance.now();
  const lap = (name) => {
    const now = performance.now();
    timings[name] = Math.round(now - tLast);
    tLast = now;
  };
  const root = new THREE.Group();
  root.name = 'riverside';
  ctx.scene.add(root);
  const B = new Batch('riverside');
  const halos = [];
  const bridge = buildBridge(ctx, B, createRng('riverside-bridge'));
  lap('bridge');
  const shop = buildWorkshop(ctx, B, createRng('velowerkstatt'), halos);
  lap('workshop');

  // the vintage bike with its flower basket, leaning on the bridge's east
  // parapet. It never moves, so it merges into the riverside batch; an
  // invisible box stands in for it as the 'bike-restoration' hotspot.
  const vintage = { group: new THREE.Group() };
  {
    const { x: bx, side, offset } = BIKE_SPOT;
    const p = bridge.toWorld(bx, 0, side * (bridge.halfWidth + offset));
    p.y = bridge.ground(bx, side * (bridge.halfWidth + offset));
    // runs along the bridge towards the east bank, drive side to the camera, leaning back onto the parapet
    const yaw = Math.atan2(-bridge.X.z, bridge.X.x);
    vintage.group.name = 'vintage-bike';
    vintage.group.position.copy(p);
    vintage.group.rotation.set(0, yaw, 0);
    vintage.group.rotateX(-0.2);
    vintage.group.updateMatrix();
    const bike = makeBike({ style: 'vintage', seed: 'vintage', scale: 0.72, batch: B, matrix: vintage.group.matrix });
    const d = bike.dims;
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(d.length, d.height, 0.42), ctx.materials.basic('#ffffff', { visible: false }));
    proxy.position.set((d.frontAxle.x + d.rearAxle.x) / 2, d.height / 2, 0);
    proxy.name = 'vintage-bike-hotspot';
    proxy.castShadow = false;
    vintage.group.add(proxy);
    root.add(vintage.group);
  }
  lap('vintage');
  const falls = buildFalls(ctx, B, createRng('riverside-falls'));
  lap('falls');
  const rocks = planStreamRocks(createRng('riverside-rocks'));
  buildBanks(ctx, B, createRng('riverside-banks'), rocks);
  lap('banks');
  const pond = buildPond(ctx, B, createRng('riverside-pond'));
  const drifters = buildDrifters(ctx, createRng('riverside-drift'));
  lap('pond');
  const water = buildWater(ctx, { rocks, impacts: falls.impacts });
  lap('water');
  B.build(root, 'riverside');
  lap('merge');
  for (const p of bridge.anchors.lanterns) halos.push({ x: p.x, y: p.y, z: p.z, size: 1.0 });
  if (pond.lantern) halos.push({ x: pond.lantern.x, y: pond.lantern.y, z: pond.lantern.z, size: 0.8 });
  // warm light from the bridge's east lantern (by the workshop)
  const east = bridge.anchors.lanterns.reduce((a, b) => (b.x > a.x ? b : a), bridge.anchors.lanterns[0]);
  if (east) ctx.lights?.addPoint?.(east.clone().add(new THREE.Vector3(0, -0.1, 0)), { color: '#ffbf70', day: 0, night: 3.5, distance: 6 });
  if (halos.length) root.add(ctx.props.glowQuads(halos, '#ffc46e', { day: 0.05, night: 0.5 }));
  if (falls.halos.length) root.add(ctx.props.glowQuads(falls.halos, '#86e6d6', { day: 0.02, night: 0.45 }));

  // ── hotspots ──
  const area = 'bikes';
  ctx.interactions.add(shop.hero.group, { entryId: 'bike-build', area, focus: { distance: 3.2, height: 0.4 } });
  ctx.interactions.add(vintage.group, { entryId: 'bike-restoration', area, focus: { distance: 3.0, height: 0.4 } });
  ctx.interactions.add(shop.truing, { entryId: 'wheel-building', area, focus: { distance: 2.6, height: 0.7 } });

  // what this module costs: objects it added to the scene (for the perf budget)
  const stats = { meshes: 0, casters: 0, triangles: 0, timings };
  for (const c of ctx.scene.children) {
    if (before.has(c)) continue;
    c.traverse((o) => {
      if (!o.isMesh && !o.isPoints) return;
      stats.meshes++;
      (stats.list ??= []).push(`${o.name || o.type}${o.castShadow ? '*' : ''}`);
      if (o.castShadow) stats.casters++;
      const g = o.geometry;
      if (o.isMesh) stats.triangles += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
    });
  }
  stats.triangles = Math.round(stats.triangles);
  const worldOf = (o) => o.getWorldPosition(new THREE.Vector3());
  const anchors = {
    bridgeLanterns: bridge.anchors.lanterns,
    bridgeCentre: bridge.anchors.centre,
    workshopDoor: shop.anchors.door,
    chimneyTop: shop.anchors.chimneyTop,
    heroBike: worldOf(shop.hero.group),
    truingStand: worldOf(shop.truing),
    vintageBike: worldOf(vintage.group),
  };
  return {
    anchors,
    stats,
    update(dt, t) {
      water.update(dt, t);
      falls.update(dt, t);
      pond.update(dt, t);
      drifters.update(dt, t);
      shop.update(dt, t);
    },
  };
}
