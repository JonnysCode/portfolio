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
// Hotspots: the front door leaf and a little portrait of Jonny in the upstairs
// window above it → 'about-me' (both bounce on hover), mailbox → 'contact', the cat (secret).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { COTTAGE } from '../../world/layout.js';
import { getHeight } from '../../world/ground.js';
import { createRng } from '../../core/rng.js';
import { makeMushroomHouse } from '../../props/mushroomHouse.js';
import { mats, mat4, xf, mossGeo, stoneGeo, addFern, addGrass, addFlower, addToadstool, FLOWER_COLORS } from './kit.js';
import { fenceArc, gateArch, flagstones, vegBed, pumpkin, gardenBench, woodpile, stringLights, makeWoodlandSign, makeMailbox, makeCat, wateringCan, pot, clothesline, rainBarrel, birdHouse, frog, hedgehog } from './garden.js';
import { whenFontsReady, FONT_HAND } from '../../props/text.js';

/** World azimuth of the home's front door (faces the end of the cottage path). */
export const HOME_DOOR_AZ = 1.0;
const WING_AZ = 2.2;
const WING_DIST = 2.75;

/**
 * Build the home cluster into batch B (world space). Returns
 * { houses, hotspots: [{ object, opts }], updates: [fn(dt, t)], lights: [[pos, opts]], smoke, halos }.
 */
export function buildHome(ctx, B, root, halos, smoke = [], rimHalos = null) {
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
    capColor: '#c8322a',
    capRadius: 3.25,
    capFlare: 0.8,
    capMoss: 7,
    stemColor: '#f3dfbd',
    stemRadius: 1.95,
    chimney: 'mushroom',
    dormer: true,
    lean: 0.3,
    leanDir: 2.6,
    // a jaunty cap: the rim lifts a little towards the garden gate
    capTilt: { phi: 0.15, slope: 0.06 },
    doorLeaf: true,
    ivy: 0.8,
    windows: [
      { phi: 1.05, y: 1.25, shape: 'arch', shutters: true, box: true, color: '#6f8a5a' },
      { phi: -1.0, y: 1.3, shape: 'round', w: 0.56 },
      // the upstairs window above the door (no glazing bars: Jonny's portrait stands on the sill inside)
      { phi: 0.35, y: 3.05, shape: 'rect', w: 0.56, h: 0.66, shutters: true, color: '#4f7a86', mullions: false },
      { phi: -2.3, y: 3.0, shape: 'arch', w: 0.5, h: 0.7 },
      { phi: 2.75, y: 1.25, shape: 'rect', box: true },
    ],
    detail: ctx.quality?.density ?? 1,
    batch: B,
    halos,
    smokeSources: smoke,
    rimHalos: rimHalos ?? undefined,
    frame: mat4([H0.x, 0, H0.z], [0, HOME_DOOR_AZ, 0]),
  });
  root.add(main);
  const [wx, wz] = at(WING_AZ, WING_DIST);
  const wing = makeMushroomHouse({
    seed: 'jonny-wing',
    height: 6.0,
    capShape: 'cone',
    capColor: '#c23a2b',
    capRadius: 2.4,
    capFlare: 0.8,
    capMoss: 4,
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
    rimHalos: rimHalos ?? undefined,
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
  // … and a strand spiralling up the tall cap to the little mushroom chimney: at night
  // the red cap reads as a lit landmark instead of a dark ceiling over the garden
  {
    const spiral = capSpiral(main, { lift: 0.075 });
    if (spiral) stringLights(F, [spiral.map((p) => p.applyMatrix4(main.matrix))], halos, { spacing: 0.3, sag: 0 });
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
  // (fewer on the lower tiers)
  const dens = 0.45 + 0.55 * Math.min(1, ctx.quality?.density ?? 1);
  for (let i = 0, n = Math.round(46 * dens); i < n; i++) {
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
  for (let i = 0, n = Math.round(26 * dens); i < n; i++) {
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

  // ── the front door (and Jonny's portrait in the window beside it) → about me ──
  {
    const aboutFocus = { distance: 4.4, height: 0.9 };
    const leaf = main.userData.doorLeaf;
    out.hotspots.push([leaf, { entryId: 'about-me', area: 'home', focus: aboutFocus }]);
    const win = main.userData.windows.find((w) => Math.abs(w.phi - 0.35) < 1e-3);
    if (win) {
      const portrait = makePortrait(win);
      main.add(portrait);
      out.hotspots.push([portrait, { entryId: 'about-me', area: 'home', focus: aboutFocus, marker: false }]);
    }
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


// ─── fairy-light spiral ──────────────────────────────────────────────────────
/**
 * House-local points of a fairy-light strand winding up a mushroom house's cap
 * from the rim to the foot of its chimney (lifted `lift` off the cap skin),
 * picking the winding (direction, turns) that keeps clearest of the dormer and
 * passes the front at mid-height. Null when the house has no chimney.
 */
function capSpiral(house, { lift = 0.07, sRim = 0.96 } = {}) {
  const ud = house.userData;
  const chim = ud.chimney;
  if (!chim) return null;
  const cp = ud.capPoint;
  const dorm = ud.dormer ? cp(ud.dormer.phi, ud.dormer.s) : null;
  const sEnd = chim.s + 0.08;
  const N = 140;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  let best = null;
  for (const dir of [1, -1]) {
    for (const turns of [0.9, 1.05, 1.2, 1.35]) {
      let clear = Infinity, front = 0;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const phi = chim.phi - dir * (1 - t) * turns * Math.PI * 2;
        const s = sRim + (sEnd - sRim) * t;
        if (dorm) clear = Math.min(clear, cp(phi, s).distanceTo(dorm));
        if (Math.abs(wrap(phi - 0.15)) < 0.25 && s > 0.55 && s < 0.9) front = 1;
      }
      const score = Math.min(clear, 1.6) + front * 0.8 - turns * 0.15;
      if (clear > 1.0 && (!best || score > best.score)) best = { dir, turns, score };
    }
  }
  if (!best) return null;
  const pts = [];
  const e = 0.004;
  const n = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const phi = chim.phi - best.dir * (1 - t) * best.turns * Math.PI * 2;
    const s = sRim + (sEnd - sRim) * t;
    const p = cp(phi, s);
    a.copy(cp(phi + e, s)).sub(cp(phi - e, s));
    b.copy(cp(phi, s + e)).sub(cp(phi, s - e));
    n.crossVectors(a, b).normalize();
    if (n.y < 0) n.negate();
    pts.push(p.addScaledVector(n, lift));
  }
  return pts;
}

// ─── Jonny's portrait ────────────────────────────────────────────────────────
/**
 * A little framed portrait standing on the sill inside the upstairs window
 * above the door, warmly backlit by the room: Jonny in his workshop shirt, a carpenter's
 * pencil behind the ear. House-local group, origin at the foot of the frame
 * (so it bounces from the sill).
 */
function makePortrait(win) {
  const W = 256, H = 320;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const draw = () => {
    // carved walnut frame with a gilded inner bead
    const fr = g.createLinearGradient(0, 0, W, H);
    fr.addColorStop(0, '#7a5232');
    fr.addColorStop(1, '#4a3020');
    g.fillStyle = fr;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,220,160,0.35)';
    g.lineWidth = 3;
    g.strokeRect(6, 6, W - 12, H - 12);
    g.fillStyle = '#c9a25a';
    g.fillRect(20, 20, W - 40, H - 40);
    // painted backdrop: warm sage with a soft glow behind the head
    const bg = g.createRadialGradient(W / 2, H * 0.4, 10, W / 2, H * 0.45, H * 0.6);
    bg.addColorStop(0, '#d9e2b8');
    bg.addColorStop(0.55, '#8fa878');
    bg.addColorStop(1, '#55704a');
    g.fillStyle = bg;
    g.fillRect(26, 26, W - 52, H - 52);
    const cx = W / 2;
    // shoulders: forest-green work shirt, apron straps
    g.fillStyle = '#3f6a4a';
    g.beginPath();
    g.moveTo(34, H - 26);
    g.bezierCurveTo(40, 215, 80, 198, cx, 196);
    g.bezierCurveTo(W - 80, 198, W - 40, 215, W - 34, H - 26);
    g.closePath();
    g.fill();
    g.fillStyle = '#c9b48e';
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + sx * 34, 204);
      g.lineTo(cx + sx * 50, 204);
      g.lineTo(cx + sx * 40, H - 26);
      g.lineTo(cx + sx * 24, H - 26);
      g.closePath();
      g.fill();
    }
    // neck & head
    g.fillStyle = '#e6b48c';
    g.fillRect(cx - 16, 168, 32, 34);
    g.fillStyle = '#f2c9a2';
    g.beginPath();
    g.ellipse(cx, 136, 48, 54, 0, 0, Math.PI * 2);
    g.fill();
    // ears
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + sx * 47, 140, 9, 13, 0, 0, Math.PI * 2);
      g.fill();
    }
    // tousled brown hair
    g.fillStyle = '#6b4428';
    g.beginPath();
    g.moveTo(cx - 52, 132);
    g.bezierCurveTo(cx - 58, 78, cx - 20, 70, cx + 4, 76);
    g.bezierCurveTo(cx + 40, 68, cx + 62, 96, cx + 50, 132);
    g.bezierCurveTo(cx + 40, 108, cx + 20, 100, cx - 6, 104);
    g.bezierCurveTo(cx - 26, 106, cx - 42, 114, cx - 52, 132);
    g.fill();
    // a short, friendly beard
    g.fillStyle = '#7a5032';
    g.beginPath();
    g.moveTo(cx - 44, 146);
    g.bezierCurveTo(cx - 40, 196, cx + 40, 196, cx + 44, 146);
    g.bezierCurveTo(cx + 30, 170, cx - 30, 170, cx - 44, 146);
    g.fill();
    // smiling eyes, rosy cheeks, a smile
    g.strokeStyle = '#3a2618';
    g.lineWidth = 4;
    g.lineCap = 'round';
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.arc(cx + sx * 18, 136, 8, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
    }
    g.fillStyle = 'rgba(232,120,110,0.45)';
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + sx * 28, 152, 10, 6, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = '#4a2a1a';
    g.lineWidth = 3.5;
    g.beginPath();
    g.arc(cx, 156, 14, Math.PI * 0.15, Math.PI * 0.85);
    g.stroke();
    // carpenter's pencil behind the ear
    g.save();
    g.translate(cx + 50, 120);
    g.rotate(-0.55);
    g.fillStyle = '#d9a83a';
    g.fillRect(-4, -26, 9, 44);
    g.fillStyle = '#f0d9b0';
    g.beginPath();
    g.moveTo(-4, 18);
    g.lineTo(5, 18);
    g.lineTo(0.5, 28);
    g.closePath();
    g.fill();
    g.restore();
    // a name ribbon
    g.fillStyle = '#f3e6c8';
    g.beginPath();
    g.moveTo(52, H - 70);
    g.lineTo(W - 52, H - 70);
    g.lineTo(W - 62, H - 52);
    g.lineTo(W - 52, H - 34);
    g.lineTo(52, H - 34);
    g.lineTo(62, H - 52);
    g.closePath();
    g.fill();
    g.fillStyle = '#4a2c17';
    g.font = `400 34px ${FONT_HAND}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('Jonny', cx, H - 51);
  };
  draw();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  whenFontsReady(['400 34px "Patrick Hand"'], 'Jonny', () => {
    draw();
    tex.needsUpdate = true;
  });
  // lit by the warm room behind the window: a gentle self-lit term keeps it readable against the glowing pane
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color('#ffe8c8'), emissiveIntensity: 0.55, roughness: 0.85, name: 'portrait' });
  const pw = Math.min(0.36, win.w * 0.6), ph = pw * 1.25;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph).translate(0, ph / 2, 0), mat);
  mesh.name = 'jonny-portrait';
  const grp = new THREE.Group();
  grp.name = 'portrait';
  grp.add(mesh);
  // stand it on the sill, a hair in front of the glowing pane (pane at z = −0.005 in the window frame)
  grp.applyMatrix4(win.frame.clone().multiply(new THREE.Matrix4().makeTranslation(0.02, -win.h / 2 + 0.015, -0.001)));
  return grp;
}
