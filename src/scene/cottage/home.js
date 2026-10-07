// ─────────────────────────────────────────────────────────────────────────────
// Jonny's home — a cluster like the "Fairy Garden" reference: a tall red fly
// agaric house with a shorter wing-mushroom leaning against it, fairy lights
// draped along the rim, smoke curling from a tiny mushroom chimney.
//
// The garden faces the end of the cottage path (east): a crooked picket fence
// with a gate under a rose arch, flagstones up to the stone steps, a raised
// vegetable bed and pumpkins, a joiner-made bench by the wall with a sleeping
// cat, a woodpile, the carved "Jonny's Woodland" sign and the mailbox (flag up).
//
// Hotspots: front door → 'about-me', mailbox → 'contact', the cat (secret).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { COTTAGE } from '../../world/layout.js';
import { getHeight } from '../../world/ground.js';
import { createRng } from '../../core/rng.js';
import { makeMushroomHouse } from '../../props/mushroomHouse.js';
import { mats, mat4, xf, mossGeo, stoneGeo, addFern, addGrass, addFlower, addToadstool, FLOWER_COLORS } from './kit.js';
import { fenceArc, gateArch, flagstones, vegBed, pumpkin, gardenBench, woodpile, stringLights, makeWoodlandSign, makeMailbox, makeCat, hitProxy, wateringCan, pot, clothesline, rainBarrel, birdHouse, frog, hedgehog } from './garden.js';

/** World azimuth of the home's front door (faces the end of the cottage path). */
export const HOME_DOOR_AZ = 1.0;
const WING_AZ = 2.2;
const WING_DIST = 2.75;

/**
 * Build the home cluster into batch B (world space). Returns
 * { houses, hotspots: [{ object, opts }], updates: [fn(dt, t)], lights: [[pos, opts]], smoke, halos }.
 */
export function buildHome(ctx, B, root, halos, smoke = []) {
  const rng = createRng('jonny-home-garden');
  const M = mats();
  const H0 = COTTAGE.home;
  const at = (az, r) => [H0.x + Math.sin(az) * r, H0.z + Math.cos(az) * r];
  const F = B.at(new THREE.Matrix4());
  const out = { hotspots: [], updates: [], lights: [], colliders: [], keepOut: [] };
  const keep = (az, r, rr) => {
    const [x, z] = at(az, r);
    out.keepOut.push([x, z, rr]);
  };

  // ── the houses ──
  const main = makeMushroomHouse({
    seed: 'jonny-home',
    height: 9.2,
    capShape: 'cone',
    capColor: '#c4301f',
    capRadius: 3.25,
    stemColor: '#f3dfbd',
    stemRadius: 1.95,
    chimney: 'mushroom',
    dormer: true,
    lean: 0.3,
    leanDir: 2.6,
    ivy: 0.8,
    windows: [
      { phi: 1.05, y: 1.25, shape: 'arch', shutters: true, box: true, color: '#6f8a5a' },
      { phi: -1.0, y: 1.3, shape: 'round', w: 0.56 },
      { phi: 0.35, y: 3.05, shape: 'rect', w: 0.56, h: 0.66, shutters: true, color: '#4f7a86' },
      { phi: -2.3, y: 3.0, shape: 'arch', w: 0.5, h: 0.7 },
      { phi: 2.75, y: 1.25, shape: 'rect', box: true },
    ],
    detail: ctx.quality?.density ?? 1,
    batch: B,
    halos,
    smokeSources: smoke,
    frame: mat4([H0.x, 0, H0.z], [0, HOME_DOOR_AZ, 0]),
  });
  root.add(main);
  const [wx, wz] = at(WING_AZ, WING_DIST);
  const wing = makeMushroomHouse({
    seed: 'jonny-wing',
    height: 6.0,
    capShape: 'cone',
    capColor: '#b9361f',
    capRadius: 2.4,
    stemRadius: 1.3,
    stemHeight: 2.75,
    chimney: 'stone',
    door: false,
    lantern: false,
    ivy: 0.7,
    windows: [
      { phi: -0.15, y: 1.2, shape: 'arch', shutters: true, box: true, color: '#9b3b2c' },
      { phi: 0.95, y: 1.3, shape: 'round', w: 0.5 },
      { phi: -1.2, y: 1.2, shape: 'rect', box: true },
    ],
    dormer: false,
    lean: 0.22,
    leanDir: 2.2,
    detail: ctx.quality?.density ?? 1,
    batch: B,
    halos,
    smokeSources: smoke,
    frame: mat4([wx, 0, wz], [0, 1.55, 0]),
  });
  root.add(wing);
  out.colliders.push([H0.x, H0.z, main.userData.radius], [wx, wz, wing.userData.radius]);
  out.keepOut.push([H0.x, H0.z, main.userData.radius + 0.2], [wx, wz, wing.userData.radius + 0.25]);
  keep(HOME_DOOR_AZ, 2.95, 0.9);
  for (const r of [3.6, 4.3, 5.0, 5.6]) keep(HOME_DOOR_AZ, r, 0.62);

  // fairy lights draped along the main cap's rim and across to the wing
  {
    const toWorld = (v) => v.applyMatrix4(main.matrix);
    const rimLine = [];
    for (let i = 0; i <= 8; i++) {
      const phi = -0.75 + (i / 8) * 2.6;
      const p = main.userData.rimPoint(phi).multiplyScalar(0.985);
      p.y -= 0.12;
      rimLine.push(toWorld(p));
    }
    stringLights(F, [rimLine], halos, { spacing: 0.3, sag: 0.09 });
    const wingRim = wing.userData.rimPoint(-1.4).applyMatrix4(wing.matrix);
    wingRim.y -= 0.1;
    stringLights(F, [[rimLine[rimLine.length - 1], wingRim]], halos, { spacing: 0.3, sag: 0.14 });
  }

  // ── garden ──
  const R = 4.25;
  const gateHalf = 0.15;
  fenceArc(F, rng, { cx: H0.x, cz: H0.z, r: R, a0: 0.15, a1: 2.15, gaps: [[HOME_DOOR_AZ, gateHalf]] });
  const g0 = at(HOME_DOOR_AZ - gateHalf, R), g1 = at(HOME_DOOR_AZ + gateHalf, R);
  const arch = gateArch(F, rng, { p0: g0, p1: g1, open: 0.55, inward: 1, halos });
  // lights from the arch to the cap rim above the door
  {
    const top = new THREE.Vector3(arch.width / 2, arch.top - 0.05, -0.12).applyMatrix4(arch.matrix);
    const rim = main.userData.rimPoint(0.05).applyMatrix4(main.matrix);
    rim.y -= 0.15;
    stringLights(F, [[top, rim]], halos, { spacing: 0.3, sag: 0.1 });
  }
  // flagstones: from the dirt path through the gate to the steps
  flagstones(F, rng, [at(HOME_DOOR_AZ + 0.02, 5.6), at(HOME_DOOR_AZ, R), at(HOME_DOOR_AZ - 0.02, 3.55)], { width: 0.95, step: 0.42 });

  // raised vegetable bed + pumpkins (left of the gate, inside the fence)
  {
    const [x, z] = at(0.42, 3.15);
    vegBed(F, rng, mat4([x, 0, z], [0, 0.42 + Math.PI / 2, 0]), { w: 1.7, d: 0.9 });
    const [px, pz] = at(0.78, 3.55);
    pumpkin(F, rng, px, 0, pz, 0.26);
    const [px2, pz2] = at(0.67, 3.85);
    pumpkin(F, rng, px2, 0, pz2, 0.17, '#e08a2e');
    const [wx2, wz2] = at(0.12, 3.6);
    wateringCan(F, mat4([wx2, 0, wz2], [0, 1.9, 0]));
    keep(0.42, 3.15, 1.05);
    keep(0.78, 3.55, 0.35);
    keep(0.67, 3.85, 0.25);
    keep(0.12, 3.6, 0.3);
  }
  // a coopered rain barrel by the door, a bird house with a robin, the clothesline round the side
  {
    const [bx, bz] = at(0.55, 2.42);
    rainBarrel(F, rng, bx, bz);
    frog(F, rng, bx + 0.22, 0.85, bz + 0.12, 1.4, 1.1);
    keep(0.55, 2.42, 0.42);
    const [hx, hz] = at(0.06, 3.85);
    birdHouse(F, rng, mat4([hx, 0, hz], [0, 0.6, 0]));
    keep(0.06, 3.85, 0.25);
    const a = at(-0.45, 3.95), b = at(-1.38, 3.85);
    clothesline(F, rng, a, b);
    out.keepOut.push([a[0], a[1], 0.25], [b[0], b[1], 0.25]);
  }

  // the bench against the wall between the door and the wing, with the cat
  {
    const az = 1.52;
    const [x, z] = at(az, 2.6);
    const m = mat4([x, 0, z], [0, az, 0]);
    const seat = gardenBench(F, rng, m, { w: 1.25 });
    const cat = makeCat(rng);
    cat.group.position.copy(seat.clone().add(new THREE.Vector3(0.3, 0, 0.0)).applyMatrix4(m));
    cat.group.rotation.y = az - 0.35;
    root.add(cat.group);
    if (!ctx.engine?.reducedMotion) out.updates.push((dt, t) => cat.update(t));
    keep(az, 2.6, 0.85);
    out.hotspots.push([cat.group, { kind: 'secret', area: 'home', label: 'A sleepy cat…', focus: { distance: 2.2, height: 0.15 }, onActivate: () => ctx.ui?.speech?.('Mrrrp.', cat.group) }]);
    // a mug and a book left on the bench
    const L = { add: (mat, geo, opts) => F.add(mat, geo.applyMatrix4(m), opts) };
    L.add(M.clay, new THREE.CylinderGeometry(0.045, 0.04, 0.09, 10).translate(-0.4, seat.y + 0.045, 0.05), { color: '#e9e2d4', cast: false });
    L.add(M.paper, xf(new THREE.BoxGeometry(0.2, 0.035, 0.15), [-0.15, seat.y + 0.02, 0.02], [0, 0.4, 0]), { color: '#7a3b2e', cast: false });
  }

  // woodpile on the far side of the wing
  {
    const az = 2.62;
    const [x, z] = at(az, 3.95);
    woodpile(F, rng, mat4([x, 0, z], [0, az + 0.15, 0]), { w: 1.4, h: 0.95, d: 0.5 });
    keep(az, 3.95, 0.95);
    const [hx, hz] = at(az - 0.32, 4.0);
    hedgehog(F, rng, hx, 0, hz, az + 1.2);
    keep(az - 0.32, 4.0, 0.3);
  }

  // flowers & ferns along the inside of the fence, moss and toadstools by the houses
  for (let i = 0; i < 46; i++) {
    const az = rng.range(0.2, 2.1);
    if (Math.abs(az - HOME_DOOR_AZ) < 0.28) continue;
    const r = R - rng.range(0.15, 0.6);
    const [x, z] = at(az, r);
    if (az > 0.25 && az < 0.95 && r < 3.75) continue; // the veg bed
    const roll = rng.next();
    if (roll < 0.55) addFlower(F, rng, x, 0, z, { size: rng.range(0.05, 0.08), stem: rng.range(0.18, 0.42), color: rng.pick(FLOWER_COLORS) });
    else if (roll < 0.75) addFern(F, rng, x, 0, z, { size: rng.range(0.35, 0.6) });
    else addGrass(F, rng, x, 0, z, { size: rng.range(0.25, 0.4), blades: 3 });
  }
  // outside the fence: a few big ferns, mossy stones and fly agarics
  for (let i = 0; i < 26; i++) {
    const az = rng.range(-0.4, 2.6);
    if (Math.abs(az - HOME_DOOR_AZ) < 0.32) continue;
    const r = rng.range(R + 0.25, R + 0.75);
    const [x, z] = at(az, r);
    const y = getHeight(x, z);
    const roll = rng.next();
    if (roll < 0.3) addFern(F, rng, x, y, z, { size: rng.range(0.5, 0.8), fronds: 8 });
    else if (roll < 0.5) F.add(M.moss, xf(mossGeo(rng, { r: rng.range(0.2, 0.4), h: 0.08 }), [x, y, z]), { cast: false });
    else if (roll < 0.65) F.add(M.stone, xf(stoneGeo(rng, { r: rng.range(0.15, 0.3) }), [x, y + 0.05, z], [0, rng.next() * 3, 0]), { color: '#a49c8c', cast: false });
    else if (roll < 0.85) addToadstool(F, rng, x, y, z, { size: rng.range(0.1, 0.2) });
    else addGrass(F, rng, x, y, z, { size: 0.4, blades: 4 });
  }
  // terracotta pots by the steps
  {
    const [x, z] = at(HOME_DOOR_AZ + 0.42, 2.75);
    pot(F, rng, x, 0, z, 0.2);
    const [x2, z2] = at(HOME_DOOR_AZ + 0.55, 2.95);
    pot(F, rng, x2, 0, z2, 0.14);
    keep(HOME_DOOR_AZ + 0.48, 2.85, 0.35);
  }

  // ── the sign and the mailbox at the gate ──
  {
    const [x, z] = at(0.8, 5.15);
    const m = mat4([x, getHeight(x, z), z], [0, 1.25, 0]);
    const sign = makeWoodlandSign(rng, { F: B.at(m) });
    sign.applyMatrix4(m);
    root.add(sign);
    keep(0.8, 5.15, 0.55);
  }
  {
    const [x, z] = at(1.32, 4.8);
    const mailbox = makeMailbox(rng);
    mailbox.position.set(x, getHeight(x, z), z);
    mailbox.rotation.y = 1.15;
    root.add(mailbox);
    keep(1.32, 4.8, 0.4);
    out.hotspots.push([mailbox, { entryId: 'contact', area: 'home', focus: { distance: 2.8, height: 0.45 } }]);
  }

  // ── the front door → about me ──
  {
    const proxy = hitProxy(1.25, 2.0, 0.5, 'front-door');
    proxy.position.copy(main.userData.doorTarget.position);
    proxy.position.y = 1.05;
    proxy.rotation.y = 0;
    main.add(proxy);
    out.hotspots.push([proxy, { entryId: 'about-me', area: 'home', focus: { distance: 4.4, height: 0.9 } }]);
    // a warm light over the door
    const lp = main.userData.doorTarget.position.clone().applyMatrix4(main.matrix);
    lp.y = 2.3;
    lp.x += Math.sin(HOME_DOOR_AZ) * 0.8;
    lp.z += Math.cos(HOME_DOOR_AZ) * 0.8;
    out.lights.push([lp, { color: '#ffb46a', day: 0.4, night: 2.6, distance: 6 }]);
  }

  // the fence band
  for (let az = 0.15; az <= 2.15; az += 0.1) keep(az, 4.25, 0.22);
  out.pads = [{ cx: H0.x, cz: H0.z, r0: 2.0, r1: 4.85, glow: 3 }];
  out.houses = { main, wing };
  return out;
}

