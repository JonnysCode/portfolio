// ─────────────────────────────────────────────────────────────────────────────
// The Riverside — work in progress.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { Batch } from './riverside/kit.js';
import { buildWater } from './riverside/water.js';
import { buildBridge } from './riverside/bridge.js';
import { buildWorkshop } from './riverside/workshop.js';
import { makeBike } from './riverside/bike.js';
import { buildFalls } from './riverside/falls.js';
import { planStreamRocks, buildBanks, buildPond, buildDrifters } from './riverside/banks.js';

export default async function build(ctx) {
  const root = new THREE.Group();
  root.name = 'riverside';
  ctx.scene.add(root);
  const B = new Batch('riverside');
  const halos = [];
  const bridge = buildBridge(ctx, B, createRng('riverside-bridge'));
  const shop = buildWorkshop(ctx, B, createRng('velowerkstatt'), halos);

  // the vintage bike with its flower basket, leaning on the bridge's east parapet
  const vintage = makeBike({ style: 'vintage', seed: 'vintage', scale: 0.66 });
  {
    const bx = 3.05, side = 1;
    const p = bridge.toWorld(bx, 0, side * (bridge.halfWidth + 0.24));
    p.y = bridge.ground(bx, side * (bridge.halfWidth + 0.24));
    vintage.group.position.copy(p);
    // runs along the bridge towards the east bank, drive side to the camera, leaning back onto the parapet
    const yaw = Math.atan2(-bridge.X.z, bridge.X.x);
    vintage.group.rotation.set(0, yaw, 0);
    vintage.group.rotateX(-0.2);
    root.add(vintage.group);
  }
  const falls = buildFalls(ctx, B, createRng('riverside-falls'));
  const rocks = planStreamRocks(createRng('riverside-rocks'));
  buildBanks(ctx, B, createRng('riverside-banks'), rocks);
  const pond = buildPond(ctx, B, createRng('riverside-pond'));
  const drifters = buildDrifters(ctx, createRng('riverside-drift'));
  const water = buildWater(ctx, { rocks, impacts: falls.impacts });
  B.build(root, 'riverside');
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

  console.info('[riverside] tris', Math.round(B.tris));
  return {
    update(dt, t) {
      water.update(dt, t);
      falls.update(dt, t);
      pond.update(dt, t);
      drifters.update(dt, t);
      shop.update(dt, t);
    },
  };
}
