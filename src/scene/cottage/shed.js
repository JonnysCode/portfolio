// ─────────────────────────────────────────────────────────────────────────────
// The garden shed — a tiny penny-bun mushroom (tan cap, no warts) with a
// plank door, a round window and everything a gardener leaves lying around:
// rake, spade and fork leaning on the wall, a potting bench with seedling
// trays, stacked terracotta pots, a watering can, a sack of soil and a
// wheelbarrow.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { COTTAGE } from '../../world/layout.js';
import { createRng } from '../../core/rng.js';
import { makeMushroomHouse } from '../../props/mushroomHouse.js';
import { mats, mat4, xf, board, boardBetween, rod, deform, uvBox, addFern, addGrass, addFlower, addToadstool, mossGeo, TAU, WOOD, IRON } from './kit.js';
import { local, pot, wateringCan } from './garden.js';

/** World azimuth the shed's door faces (towards the cottage gardens). */
const SHED_DOOR_AZ = 1.35;

export function buildShed(ctx, B, root, halos = null, rimHalos = null) {
  const rng = createRng('garden-shed');
  const S = COTTAGE.shed;
  const out = { hotspots: [], updates: [], lights: [], colliders: [], keepOut: [] };
  const frame = mat4([S.x, 0, S.z], [0, SHED_DOOR_AZ, 0]);
  const shed = makeMushroomHouse({
    seed: 'garden-shed',
    height: 3.9,
    capShape: 'dome',
    capColor: '#93623a',
    capRadius: 1.75,
    stemRadius: 0.98,
    stemHeight: 2.15,
    stem: 'plaster',
    stemColor: '#ece0c8',
    warts: 26,
    wartColor: '#d8c39a',
    gillColor: '#d9c08a',
    door: { width: 0.74, height: 1.28, color: '#5d6f8f' },
    windows: [{ phi: 1.45, y: 1.15, shape: 'round', w: 0.36 }],
    chimney: false,
    dormer: false,
    lantern: false,
    ivy: 0.7,
    lean: 0.15,
    detail: ctx.quality?.density ?? 1,
    batch: B,
    halos: halos ?? undefined,
    rimHalos: rimHalos ?? undefined,
    frame,
  });
  root.add(shed);
  out.colliders.push([S.x, S.z, shed.userData.radius]);
  out.keepOut.push([S.x, S.z, 2.15]);
  const M = mats();
  const F = B.at(frame); // shed-local: door faces +Z
  const R = shed.userData.radius;

  // moss cushions & a few fallen leaves on the cap
  {
    const cp = shed.userData.capPoint;
    for (let i = 0; i < 9; i++) {
      const phi = rng.next() * TAU, sC = rng.range(0.05, 0.55);
      const p = cp(phi, sC);
      const g = mossGeo(rng, { r: rng.range(0.12, 0.26), h: rng.range(0.04, 0.08) });
      const n = new THREE.Vector3(p.x, p.y - (shed.userData.rimY - 0.6), p.z).normalize();
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n));
      F.add(M.moss, g.translate(p.x, p.y - 0.02, p.z), { cast: false });
    }
    for (let i = 0; i < 7; i++) {
      const p = cp(rng.next() * TAU, rng.range(0.1, 0.6));
      const lf = new THREE.PlaneGeometry(0.1, 0.14).rotateX(-Math.PI / 2 + 0.3).rotateY(rng.next() * TAU);
      F.add(M.leafy, lf.translate(p.x, p.y + 0.015, p.z), { color: rng.pick(['#b8762e', '#c98a3a', '#9a5a2a']), cast: false });
    }
  }
  // tools leaning against the wall beside the door
  const lean = (phi, len, head) => {
    const r = R + 0.05;
    const base = [Math.sin(phi) * (r + 0.35), 0, Math.cos(phi) * (r + 0.35)];
    const top = [Math.sin(phi) * (r + 0.02), len * 0.96, Math.cos(phi) * (r + 0.02)];
    F.add(M.wood, rod(base, top, 0.018, 0.016, 6), { color: WOOD.oakLight, cast: false });
    head(base, top);
  };
  // rake
  lean(0.62, 1.55, (b) => {
    const m = mat4([b[0], 0.06, b[2]], [0, 0.62, 0]);
    const L = local(F, m);
    L.add(M.metal, new THREE.BoxGeometry(0.34, 0.03, 0.03), { color: IRON, cast: false });
    for (let i = 0; i < 9; i++) L.add(M.metal, new THREE.BoxGeometry(0.008, 0.06, 0.008).translate(-0.16 + i * 0.04, -0.035, 0.0), { color: IRON, cast: false });
  });
  // spade (blade at the bottom, D handle at the top)
  lean(0.78, 1.25, (b, t) => {
    F.add(M.metal, xf(new THREE.BoxGeometry(0.17, 0.24, 0.012), [b[0], 0.12, b[2]], [0, 0.78, 0]), { color: '#6c6e70', cast: false });
    F.add(M.wood, xf(new THREE.TorusGeometry(0.06, 0.012, 4, 10), [t[0], t[1] + 0.06, t[2]], [0, 0.78, 0]), { color: WOOD.oakLight, cast: false });
  });
  // garden fork
  lean(-0.65, 1.35, (b) => {
    const m = mat4([b[0], 0.0, b[2]], [0, -0.65, 0]);
    const L = local(F, m);
    for (let i = 0; i < 4; i++) L.add(M.metal, new THREE.BoxGeometry(0.012, 0.22, 0.012).translate(-0.06 + i * 0.04, 0.11, 0), { color: IRON, cast: false });
    L.add(M.metal, new THREE.BoxGeometry(0.16, 0.03, 0.02).translate(0, 0.23, 0), { color: IRON, cast: false });
  });

  // potting bench on the right side of the door, with seedling trays
  {
    const phi = -1.25;
    const r = R + 0.4;
    const m = mat4([Math.sin(phi) * r, 0, Math.cos(phi) * r], [0, phi, 0]);
    const L = local(F, m);
    const w = 1.0, d = 0.45, h = 0.78;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.add(M.wood, board(0.05, h, 0.05, { along: 'y', rng }).translate(sx * (w / 2 - 0.04), h / 2, sz * (d / 2 - 0.04)), { color: WOOD.weathered });
    for (let i = 0; i < 4; i++) L.add(M.wood, board(w, 0.03, d / 4 - 0.01, { along: 'x', rng }).translate(0, h, -d / 2 + (d / 4) * (i + 0.5)), { color: WOOD.weathered });
    L.add(M.wood, board(w - 0.08, 0.025, d - 0.06, { along: 'x', rng }).translate(0, 0.25, 0), { color: WOOD.grey, cast: false });
    // seedling trays
    for (let k = 0; k < 2; k++) {
      const tx = -0.22 + k * 0.42;
      L.add(M.clay, new THREE.BoxGeometry(0.34, 0.06, 0.26).translate(tx, h + 0.045, 0), { color: '#5a4636', cast: false });
      for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
        const x = tx - 0.13 + i * 0.052, z = -0.09 + j * 0.06;
        const leaf = new THREE.SphereGeometry(0.018, 5, 3).scale(1.4, 0.4, 0.8).rotateY(rng.next() * 3);
        L.add(M.leafy, leaf.translate(x, h + 0.1 + rng.range(0, 0.02), z), { color: rng.pick(['#7fae4a', '#8fbf54', '#6f9a40']), cast: false });
      }
    }
    // a stack of pots on the shelf below and a trowel
    for (let i = 0; i < 3; i++) pot(L, rng, -0.3 + i * 0.05, 0.27 + i * 0.07, 0.02, 0.12, false);
    pot(L, rng, 0.25, 0.27, 0, 0.13, true);
    L.add(M.metal, xf(new THREE.ConeGeometry(0.04, 0.14, 4).scale(1, 1, 0.2), [0.35, h + 0.03, 0.12], [Math.PI / 2, 0, 0.4]), { color: '#6c6e70', cast: false });
  }
  // watering can, soil sack, wheelbarrow on the other side
  wateringCan(F, mat4([Math.sin(1.25) * (R + 0.55), 0, Math.cos(1.25) * (R + 0.55)], [0, 2.2, 0]), '#5f7f7a');
  {
    const phi = 1.8;
    const r = R + 0.4;
    const sack = new THREE.SphereGeometry(0.22, 10, 8);
    deform(sack, (v) => {
      v.y = v.y > 0 ? v.y * 1.5 : v.y * 0.5;
      v.x *= 1 - Math.max(0, v.y) * 0.3;
    });
    F.add(M.fabric, uvBox(sack, 'y', 3).translate(Math.sin(phi) * r, 0.12, Math.cos(phi) * r), { color: '#b8a17a' });
  }
  wheelbarrow(F, rng, mat4([Math.sin(2.35) * (R + 0.95), 0, Math.cos(2.35) * (R + 0.95)], [0, 2.35 + 1.2, 0]));

  // greenery & toadstools round the foot, a few flowers
  for (let i = 0; i < 18; i++) {
    const phi = rng.next() * TAU;
    if (Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi))) < 0.45) continue;
    const r = R + rng.range(0.4, 1.4);
    const x = Math.sin(phi) * r, z = Math.cos(phi) * r;
    const roll = rng.next();
    if (roll < 0.35) addFern(F, rng, x, 0, z, { size: rng.range(0.4, 0.7) });
    else if (roll < 0.55) addGrass(F, rng, x, 0, z, { size: 0.35 });
    else if (roll < 0.75) addFlower(F, rng, x, 0, z, { size: 0.06, stem: 0.3 });
    else if (roll < 0.88) addToadstool(F, rng, x, 0, z, { size: rng.range(0.08, 0.16), color: rng.pick(['#c4301f', '#a77c52']) });
    else F.add(M.moss, xf(mossGeo(rng, { r: 0.25, h: 0.07 }), [x, 0, z]), { cast: false });
  }
  out.pads = [{ cx: S.x, cz: S.z, r0: 2.1, r1: 3.1, glow: 1 }];
  out.houses = { shed };
  return out;
}

function wheelbarrow(F, rng, m) {
  const M = mats();
  const L = local(F, m);
  // tub of boards
  const tub = [
    [0.62, 0.025, 0.5, 0, 0.38, 0, 0],
    [0.62, 0.22, 0.025, 0, 0.48, 0.26, -0.35],
    [0.62, 0.22, 0.025, 0, 0.48, -0.26, 0.35],
  ];
  for (const [w, h, d, x, y, z, rx] of tub) L.add(M.wood, xf(board(w, h, d, { along: 'x', rng }), [x, y, z], [rx, 0, 0]), { color: WOOD.weathered });
  for (const s of [-1, 1]) L.add(M.wood, xf(board(0.025, 0.22, 0.6, { along: 'z', rng }), [s * 0.32, 0.48, 0], [0, 0, s * 0.3]), { color: WOOD.weathered });
  // handles & legs
  for (const s of [-1, 1]) {
    L.add(M.wood, boardBetween([0.2, 0.36, s * 0.2], [-0.75, 0.62, s * 0.24], 0.04, 0.04, { rng }), { color: WOOD.oak });
    L.add(M.wood, boardBetween([-0.25, 0.36, s * 0.2], [-0.3, 0, s * 0.22], 0.04, 0.04), { color: WOOD.oak, cast: false });
  }
  // wheel with spokes
  const wheel = new THREE.TorusGeometry(0.18, 0.035, 6, 18).rotateY(Math.PI / 2);
  L.add(M.metal, wheel.translate(0.42, 0.2, 0), { color: IRON });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    L.add(M.wood, rod([0.42, 0.2, 0], [0.42, 0.2 + Math.cos(a) * 0.17, Math.sin(a) * 0.17], 0.01, 0.01, 4), { color: WOOD.oak, cast: false });
  }
  L.add(M.soil, new THREE.SphereGeometry(0.24, 10, 6, 0, TAU, 0, Math.PI / 2).scale(1.1, 0.4, 0.9).translate(0, 0.45, 0), { cast: false });
}
