// ─────────────────────────────────────────────────────────────────────────────
// The Velowerkstatt (RIVERSIDE.bikeShed) — Jonny's bike workshop: a stone
// mushroom with a rust-orange spotted cap across the bridge (ref: the stone
// mushroom cottage).
//
//   • a bulging drum of rough, mossy fieldstones laid course by course, quoined
//     jambs and a big oak lintel over a wide opening
//   • ledged-and-braced plank barn doors swung wide open on strap hinges
//   • a warm lit interior: plank floor, whitewashed walls, a beamed ceiling,
//     the workbench with a vice, a pegboard of tools, wheels and a road bike
//     hanging from hooks, shelves of tyres & parts, a hanging lamp
//   • the cap: a rust-orange bell with a rolled rim, cream warts, real gills
//     underneath and fairy lights strung along the rim; a crooked stovepipe
//   • round & square windows glowing, ivy, moss, ferns & toadstools at the foot
//   • out front: the hero gravel bike on a repair stand (cranks & wheels
//     turning), the mechanic with a wrench, a truing stand with a slowly
//     spinning wheel on a stump bench, wheels on wall pegs, tyres, a pump,
//     an oil can, a crate of parts and a hanging "Velowerkstatt" sign
//
// Local frame: origin on the pad centre, the doors face +Z.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RIVERSIDE } from '../../world/layout.js';
import {
  Batch, M, TAU, STONE_TINTS, WOOD, IRON, xf, mat4, deform, blockStone, stoneGeo, mossGeo, paramSurface, board, boardBetween, rod, tube, taperTube,
  Cards, plantFern, plantGrass, addFlower, addToadstool, addIvy, flushCards, uvPlanar, noiseA, noiseB, smooth01, sagCurve,
} from './kit.js';
import { makeBike, makeWheel } from './bike.js';
import { makePuffs } from './puffs.js';

// ── dimensions ──
const WALL_TOP = 3.0;
const WALL_T = 0.3;
const OPEN_HALF = 1.08; // half width of the door opening (planar cut x = ±OPEN_HALF)
const LINTEL_Y = 2.12;
const CAP_COLOR = '#cf6a2e';
const CAP_R = 3.05, CAP_RIM_Y = 2.7, CAP_H = 3.45;

/** Outer radius of the stone drum at height y (gently bulging). */
export function wallR(y) {
  const t = Math.min(1, Math.max(0, y / WALL_TOP));
  return 1.98 + 0.16 * Math.sin(t * Math.PI * 0.85) - 0.1 * t * t;
}

/** Cap profile from the apex to the rim edge: [r, y] — a tall cone flaring into a wide skirt (ref: the stone mushroom cottage). */
const CAP_PROFILE = [
  [0, 1], [0.05, 0.985], [0.11, 0.945], [0.19, 0.872], [0.29, 0.765], [0.4, 0.64], [0.52, 0.505], [0.64, 0.372], [0.76, 0.248], [0.86, 0.145], [0.94, 0.062], [1, 0],
].map(([r, y]) => [r * CAP_R, CAP_RIM_Y + y * CAP_H]);
const capCurve = new THREE.SplineCurve(CAP_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)));
const capPts = capCurve.getSpacedPoints(40);
/** Cap tilt (a cute lean towards the back-left). */
const LEAN = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.05, 0, 0.04));

export function buildWorkshop(ctx, B, rng, halos) {
  const MM = M();
  const A = RIVERSIDE.bikeShed;
  const frame = new THREE.Matrix4().makeRotationY(A.rotY).setPosition(A.x, 0, A.z);
  const F = B.at(frame);
  const group = new THREE.Group();
  group.name = 'velowerkstatt';
  group.position.set(A.x, 0, A.z);
  group.rotation.y = A.rotY;
  ctx.scene.add(group);
  const toWorld = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(frame);
  const updates = [];

  // ── stone drum ────────────────────────────────────────────────────────────
  const zFront = (x, y) => Math.sqrt(Math.max(0, wallR(y) ** 2 - x * x));
  const inOpening = (x, z, y0, y1) => z > 0 && Math.abs(x) < OPEN_HALF + 0.02 && y0 < LINTEL_Y + 0.22;
  const windows = [
    { phi: -1.05, y: 1.45, r: 0.3, kind: 'round' },
    { phi: 1.2, y: 1.35, r: 0.27, kind: 'square' },
    { phi: 2.6, y: 1.5, r: 0.24, kind: 'round' },
  ];
  const nearWindow = (phi, y, half) => windows.some((w) => {
    const d = Math.abs(Math.atan2(Math.sin(phi - w.phi), Math.cos(phi - w.phi))) * wallR(y);
    return d < w.r + half + 0.04 && Math.abs(y - w.y) < w.r + 0.14;
  });
  const WALL_TINTS = ['#a99c84', '#9b9585', '#b4a283', '#8f897b', '#a59176', '#8a8a80', '#b8a98a', '#9a8c74', '#7f8470', '#a0937a'];
  {
    let y = -0.1;
    let row = 0;
    while (y < WALL_TOP - 0.05) {
      const hc = Math.min(rng.range(0.15, 0.24), WALL_TOP - y);
      const yc = y + hc / 2;
      const r = wallR(yc);
      let phi = rng.next() * 0.3 + row * 0.37;
      const end = phi + TAU;
      while (phi < end - 0.05) {
        // mostly modest stones, now and then a big one or a pair of small ones
        const big = rng.chance(0.12);
        const len = big ? rng.range(0.45, 0.62) : rng.range(0.22, 0.42);
        const dphi = len / r;
        const pc = phi + dphi / 2;
        phi += dphi + 0.012 / r;
        const x = Math.sin(pc) * r, z = Math.cos(pc) * r;
        if (inOpening(x, z, y, y + hc) && Math.abs(x) - len / 2 < OPEN_HALF + 0.1) continue;
        if (nearWindow(pc, yc, len / 2)) continue;
        const d = rng.range(0.16, 0.22);
        const h = (big ? hc * rng.range(1.0, 1.25) : hc) - 0.025;
        const g = blockStone(rng, len - 0.03, h, d, 0.2);
        // follow the bulge (tilt) and sit just proud of the mortar
        const slope = (wallR(yc + 0.05) - wallR(yc - 0.05)) / 0.1;
        xf(g, [0, 0, 0], [-Math.atan(slope) + rng.jitter(0.05), 0, rng.jitter(0.06)]);
        const out = d / 2 - 0.035 + rng.range(0, 0.025);
        xf(g, [x * (1 - out / r), yc + rng.jitter(0.012), z * (1 - out / r)], [0, pc + rng.jitter(0.03), 0]);
        // greener, damper stones towards the foot
        const c = yc < 0.5 && rng.chance(0.6) ? rng.pick(['#7f8466', '#77805c', '#868a6c']) : rng.pick(WALL_TINTS);
        F.add(MM.wallStone, g, { color: c, cast: row % 3 === 0 });
        // a cushion of moss on some ledges
        if (rng.chance(yc < 1 ? 0.16 : 0.07)) {
          const m = mossGeo(rng, { r: rng.range(0.06, 0.12), h: 0.035, sx: 1.6, sz: 0.7 });
          xf(m, [x * (1 + 0.05 / r), yc + h / 2 - 0.01, z * (1 + 0.05 / r)], [0, pc + Math.PI / 2, 0]);
          F.add(MM.moss, m, { color: rng.pick(['#6f8f3a', '#5d7d30', '#7f9a44']), cast: false });
        }
      }
      y += hc + 0.004;
      row++;
    }
  }
  // mortar shell behind the stones + whitewashed interior + the wall top
  const aOpen = (y) => Math.asin(Math.min(0.999, (OPEN_HALF + 0.02) / wallR(y)));
  const shell = (inset, color, mat, inside) => {
    const g = paramSurface(
      (u, v, p) => {
        const y = -0.1 + (1 - v) * (WALL_TOP + 0.1);
        const ao = y < LINTEL_Y + 0.15 ? aOpen(y) : 0;
        const phi = ao + u * (TAU - 2 * ao);
        const r = wallR(Math.max(0, y)) - inset;
        p.set(Math.sin(phi) * r, y, Math.cos(phi) * r);
      },
      64,
      12,
      { uv: (u, v, p) => [Math.atan2(p.x, p.z) * 0.9, p.y / 2], flip: inside }
    );
    F.add(mat, g, { color, cast: !inside });
  };
  shell(0.08, '#6f685c', MM.stone, false);
  shell(WALL_T, '#efe4cf', MM.plaster, true);
  // wall top ring (hidden under the cap but closes the gap) and jamb returns
  for (const sx of [-1, 1]) {
    const zo = zFront(OPEN_HALF + 0.02, 1);
    const zi = Math.sqrt(Math.max(0, (wallR(1) - WALL_T) ** 2 - (OPEN_HALF + 0.02) ** 2));
    const jamb = new THREE.PlaneGeometry(zo - zi + 0.04, LINTEL_Y + 0.12);
    jamb.rotateY(sx > 0 ? -Math.PI / 2 : Math.PI / 2);
    jamb.translate(sx * (OPEN_HALF + 0.02), (LINTEL_Y + 0.12) / 2 - 0.05, (zo + zi) / 2);
    uvPlanar(jamb, 'z', 'y', 0.6);
    F.add(MM.plaster, jamb, { color: '#d8ccb4', cast: false });
    // quoins: alternating long & short dressed blocks on the jambs
    let y = -0.06;
    let k = sx > 0 ? 0 : 1;
    while (y < LINTEL_Y - 0.05) {
      const h = Math.min(rng.range(0.26, 0.32), LINTEL_Y - y);
      const long = k % 2 === 0;
      const w = long ? 0.42 : 0.28;
      const d = (zo - zi) + 0.1;
      const g = blockStone(rng, w, h - 0.02, d, 0.1);
      const xc = sx * (OPEN_HALF + w / 2 - 0.02);
      xf(g, [xc, y + h / 2, (zo + zi) / 2 + 0.03], [0, -sx * 0.25 * (long ? 1 : 0.6), 0]);
      F.add(MM.stone, g, { color: rng.pick(['#c7b892', '#bfae8c', '#cdbd99']) });
      y += h;
      k++;
    }
  }
  // oak lintel (adzed, with peg heads) & a stone sill
  {
    const L = (OPEN_HALF + 0.42) * 2;
    const g = board(L, 0.24, 0.42, { along: 'x', rng, c: 0.03 });
    deform(g, (v) => {
      v.y += Math.sin((v.x / L + 0.5) * Math.PI) * -0.015 + noiseA(v.x * 3, v.z * 3) * 0.008;
    });
    xf(g, [0, LINTEL_Y + 0.12, zFront(0.6, LINTEL_Y) - 0.2]);
    F.add(MM.timber, g, { color: '#7d6550' });
    for (const px of [-0.95, 0.95]) F.add(MM.wood, new THREE.CylinderGeometry(0.035, 0.035, 0.05, 8).rotateX(Math.PI / 2).translate(px, LINTEL_Y + 0.12, zFront(0.6, LINTEL_Y) + 0.02), { color: WOOD.walnut, cast: false });
    const sill = blockStone(rng, OPEN_HALF * 2 + 0.3, 0.12, 0.7, 0.05);
    xf(sill, [0, 0.0, zFront(0.8, 0) - 0.15]);
    F.add(MM.stone, sill, { color: '#a59d8c' });
  }

  // ── windows (frames, mullions, glowing panes, sills, flower boxes) ───────
  for (const w of windows) {
    const r = wallR(w.y);
    const n = new THREE.Vector3(Math.sin(w.phi), 0, Math.cos(w.phi));
    const fm = new THREE.Matrix4().makeRotationY(w.phi).setPosition(n.x * (r - 0.02), w.y, n.z * (r - 0.02));
    const W = F.at(fm);
    if (w.kind === 'round') {
      W.add(MM.lamp, new THREE.CircleGeometry(w.r - 0.02, 20).translate(0, 0, -0.05), { cast: false });
      W.add(MM.wood, new THREE.TorusGeometry(w.r, 0.055, 6, 24), { color: WOOD.door });
      W.add(MM.wood, new THREE.BoxGeometry(w.r * 2, 0.035, 0.04).translate(0, 0, -0.02), { color: WOOD.dark, cast: false });
      W.add(MM.wood, new THREE.BoxGeometry(0.035, w.r * 2, 0.04).translate(0, 0, -0.02), { color: WOOD.dark, cast: false });
      // voussoir ring around it
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * TAU;
        const g = blockStone(rng, 0.16, 0.12, 0.2, 0.1);
        xf(g, [Math.sin(a) * (w.r + 0.12), Math.cos(a) * (w.r + 0.12), 0], [0, 0, -a]);
        W.add(MM.stone, g, { color: rng.pick(['#c7b892', '#bfae8c']), cast: false });
      }
    } else {
      const s = w.r;
      W.add(MM.lamp, new THREE.PlaneGeometry(s * 1.6, s * 2).translate(0, 0, -0.05), { cast: false });
      for (const [gw, gh, x, y] of [[s * 1.9, 0.06, 0, s + 0.02], [s * 1.9, 0.06, 0, -s - 0.02], [0.06, s * 2.1, s * 0.9, 0], [0.06, s * 2.1, -s * 0.9, 0], [0.035, s * 2, 0, 0], [s * 1.7, 0.035, 0, 0]]) {
        W.add(MM.wood, new THREE.BoxGeometry(gw, gh, 0.06).translate(x, y, 0), { color: WOOD.door, cast: false });
      }
      // little shutters, opened
      for (const sx of [-1, 1]) {
        const sh = new THREE.BoxGeometry(s * 0.95, s * 2.05, 0.035);
        sh.translate(sx * s * 0.48, 0, 0);
        sh.rotateY(sx * 1.9);
        sh.translate(sx * s * 0.95, 0, 0.02);
        W.add(MM.wood, sh, { color: '#4f7a86' });
      }
      W.add(MM.stone, blockStone(rng, s * 2.4, 0.08, 0.22, 0.06).translate(0, -s - 0.08, 0.06), { color: '#b8ab90' });
    }
    // window boxes with flowers under the square window
    if (w.kind === 'square') {
      W.add(MM.wood, board(w.r * 2.2, 0.14, 0.18, { rng }).translate(0, -w.r - 0.22, 0.14), { color: WOOD.oak });
      for (let i = 0; i < 7; i++) addFlower(W, rng, -w.r + (i / 6) * w.r * 2, -w.r - 0.15, 0.14 + rng.jitter(0.04), { size: 0.06, stem: 0.12 });
    }
    halos.push({ ...toWorld(...new THREE.Vector3(0, 0, 0.12).applyMatrix4(fm).toArray()), size: w.r * 2.6 });
  }

  // ── barn doors, swung wide open ──────────────────────────────────────────
  for (const sx of [-1, 1]) {
    const hz = zFront(OPEN_HALF, 1) + 0.02;
    const a = 2.5; // opening angle (folded well back)
    const dir = new THREE.Vector3(sx * -Math.cos(a), 0, Math.sin(a));
    const leafW = OPEN_HALF + 0.02, leafH = LINTEL_Y - 0.04;
    // leaf frame (right-handed): local x from the hinge along `dir`, y up, z = dir × up.
    // The leaf's INNER face (ledges & brace, now facing the yard) is on local z·sx.
    const nrm = new THREE.Vector3(-dir.z, 0, dir.x);
    const zin = sx;
    const m = new THREE.Matrix4().makeBasis(dir, new THREE.Vector3(0, 1, 0), nrm).setPosition(sx * (OPEN_HALF + 0.04), 0.04, hz);
    const D = F.at(m);
    const nP = 6;
    for (let i = 0; i < nP; i++) {
      const pw = leafW / nP;
      const ph = leafH - (i === nP - 1 ? 0.02 : rng.range(0, 0.03));
      const g = board(pw - 0.012, ph, 0.05, { along: 'y', rng });
      g.translate(pw * (i + 0.5), ph / 2, 0);
      D.add(MM.timber, g, { color: rng.pick(['#8a7360', '#7f6a58', '#937a63']) });
    }
    // ledges & brace on the (now visible) inner face
    for (const ly of [0.25, leafH - 0.28]) D.add(MM.wood, board(leafW - 0.06, 0.13, 0.04, { rng }).translate(leafW / 2, ly, zin * 0.045), { color: WOOD.oak });
    D.add(MM.wood, boardBetween([0.08, 0.3, zin * 0.045], [leafW - 0.1, leafH - 0.33, zin * 0.045], 0.12, 0.035, { rng, up: [0, 0, 1] }), { color: WOOD.oak });
    // strap hinges on the outer face + a ring pull
    for (const ly of [0.25, leafH - 0.28]) {
      D.add(MM.metal, new THREE.BoxGeometry(leafW * 0.62, 0.05, 0.012).translate(leafW * 0.31, ly, -zin * 0.032), { color: IRON, cast: false });
      D.add(MM.metal, new THREE.CylinderGeometry(0.025, 0.025, 0.1, 8).translate(0.0, ly, 0.0), { color: IRON, cast: false });
      for (let k = 0; k < 3; k++) D.add(MM.metal, new THREE.SphereGeometry(0.012, 5, 3).translate(0.1 + k * 0.18, ly, -zin * 0.04), { color: '#2a2622', cast: false });
      // clinched nail heads showing on the inner face
      for (let k = 0; k < 3; k++) D.add(MM.metal, new THREE.SphereGeometry(0.01, 4, 3).translate(0.1 + k * 0.18, ly, zin * 0.068), { color: '#2a2622', cast: false });
    }
    D.add(MM.metal, new THREE.TorusGeometry(0.05, 0.009, 4, 12).translate(leafW - 0.12, leafH * 0.48, zin * 0.05), { color: IRON, cast: false });
    // a wooden prop wedge holding it open
    D.add(MM.wood, new THREE.BoxGeometry(0.12, 0.06, 0.1).translate(leafW - 0.05, 0.03, zin * 0.08), { color: WOOD.oak, cast: false });
  }

  // ── interior: floor, ceiling, lamp ───────────────────────────────────────
  const rIn = (y) => wallR(y) - WALL_T;
  {
    const floor = new THREE.CircleGeometry(rIn(0) + 0.02, 40).rotateX(-Math.PI / 2).translate(0, 0.05, 0);
    uvPlanar(floor, 'x', 'z', 1 / 1.6);
    F.add(MM.planks, floor, { color: '#b08a60', cast: false });
    const ceilY = WALL_TOP - 0.02;
    const ceil = new THREE.CircleGeometry(rIn(ceilY) + 0.05, 40).rotateX(Math.PI / 2).translate(0, ceilY, 0);
    uvPlanar(ceil, 'x', 'z', 1 / 1.4);
    F.add(MM.planks, ceil, { color: '#9a7a58', cast: false });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.26;
      const L = rIn(ceilY);
      F.add(MM.wood, boardBetween([0, ceilY - 0.06, 0], [Math.sin(a) * L, ceilY - 0.06, Math.cos(a) * L], 0.1, 0.1, { rng }), { color: WOOD.walnut, cast: false });
    }
    // lamp: enamel shade + glowing bulb on a cord
    F.add(MM.vc, rod([0.15, ceilY - 0.1, 0.35], [0.15, 2.35, 0.35], 0.006, 0.006, 4), { color: '#2a2622', cast: false });
    F.add(MM.glossy, new THREE.ConeGeometry(0.2, 0.14, 16, 1, true).translate(0.15, 2.3, 0.35), { color: '#2f5a4f', cast: false });
    F.add(MM.bulb, new THREE.SphereGeometry(0.06, 10, 8).translate(0.15, 2.21, 0.35), { cast: false });
    halos.push({ ...toWorld(0.15, 2.18, 0.35), size: 1.1 });
  }

  // ── interior: workbench, pegboard, shelves, hanging bike & wheels ─────────
  {
    const zb = -(rIn(0.9) - 0.42);
    const top = 0.74;
    // bench top (thick, two boards), legs, stretchers, lower shelf
    for (const dz of [-0.13, 0.13]) F.add(MM.wood, board(1.7, 0.07, 0.26, { rng }).translate(0, top, zb + dz), { color: WOOD.oak });
    for (const lx of [-0.75, 0.75]) for (const lz of [-0.22, 0.22]) F.add(MM.wood, board(0.08, top - 0.03, 0.08, { along: 'y', rng }).translate(lx, (top - 0.03) / 2, zb + lz), { color: WOOD.oakLight });
    F.add(MM.wood, board(1.55, 0.04, 0.46, { rng }).translate(0, 0.2, zb), { color: WOOD.oakLight, cast: false });
    // vice on the left end
    F.add(MM.metal, new THREE.BoxGeometry(0.14, 0.12, 0.18).translate(-0.72, top + 0.09, zb + 0.2), { color: '#3f5f73', cast: false });
    F.add(MM.metal, rod([-0.72, top + 0.08, zb + 0.29], [-0.72, top + 0.08, zb + 0.42], 0.012, 0.012, 6), { color: '#c9cdd0', cast: false });
    // boxes, cans, a wheel lying on the bench, a lamp
    F.add(MM.vc, new THREE.BoxGeometry(0.26, 0.14, 0.18).translate(0.5, top + 0.11, zb - 0.02), { color: '#b03a2e', cast: false });
    F.add(MM.vc, new THREE.CylinderGeometry(0.05, 0.05, 0.13, 10).translate(0.18, top + 0.1, zb + 0.08), { color: '#d9a441', cast: false });
    F.add(MM.vc, new THREE.CylinderGeometry(0.035, 0.04, 0.16, 10).translate(0.3, top + 0.12, zb + 0.12), { color: '#3f6b5a', cast: false });
    makeWheel({ style: 'road', batch: F, matrix: mat4([-0.2, top + 0.06, zb], [Math.PI / 2, 0, 0.3]), scale: 0.55, lite: true });
    // under the bench: tyres & a crate
    for (let k = 0; k < 3; k++) F.add(MM.vc, new THREE.TorusGeometry(0.2, 0.035, 6, 20).rotateX(Math.PI / 2).translate(0.4, 0.26 + k * 0.07, zb), { color: '#2a2622', cast: false });
    F.add(MM.wood, board(0.42, 0.26, 0.32, { rng }).translate(-0.35, 0.36, zb), { color: WOOD.spruce, cast: false });
    // pegboard with tools on the wall above the bench
    const pz = -(rIn(1.3) - 0.07);
    const PY = -0.18; // pegboard sits a little lower so the spot camera sees it under the lintel
    F.add(MM.wood, board(1.5, 0.75, 0.03, { rng }).translate(0, 1.45 + PY, pz), { color: '#c9a77a', cast: false });
    for (let i = 0; i < 60; i++) F.add(MM.vc, new THREE.CircleGeometry(0.008, 5).translate(-0.7 + (i % 15) * 0.1, 1.15 + PY + Math.floor(i / 15) * 0.18, pz + 0.017), { color: '#6b5236', cast: false });
    const TOOLS = ['#2b2b2b', '#b03a2e', '#3f5f73', '#d9a441'];
    for (let i = 0; i < 9; i++) {
      // a graded row of wrenches
      const x = -0.62 + i * 0.07;
      const L = 0.18 + i * 0.012;
      F.add(MM.metal, new THREE.BoxGeometry(0.022, L, 0.012).translate(x, 1.55 + PY - L / 2, pz + 0.03), { color: '#b9bec2', cast: false });
      F.add(MM.metal, new THREE.TorusGeometry(0.022, 0.008, 4, 10).translate(x, 1.57 + PY, pz + 0.03), { color: '#b9bec2', cast: false });
    }
    for (let i = 0; i < 5; i++) {
      const x = 0.08 + i * 0.1;
      F.add(MM.vc, new THREE.CylinderGeometry(0.018, 0.022, 0.12, 6).translate(x, 1.62 + PY, pz + 0.035), { color: TOOLS[i % TOOLS.length], cast: false });
      F.add(MM.metal, new THREE.CylinderGeometry(0.005, 0.005, 0.14, 4).translate(x, 1.49 + PY, pz + 0.035), { color: '#c9cdd0', cast: false });
    }
    // hammer & pliers
    F.add(MM.wood, new THREE.BoxGeometry(0.03, 0.26, 0.02).translate(0.62, 1.42 + PY, pz + 0.035), { color: WOOD.oakLight, cast: false });
    F.add(MM.metal, new THREE.BoxGeometry(0.12, 0.04, 0.035).translate(0.62, 1.56 + PY, pz + 0.04), { color: '#3a3a3a', cast: false });
    F.add(MM.vc, new THREE.BoxGeometry(0.02, 0.2, 0.015).rotateZ(0.12).translate(-0.05, 1.3 + PY, pz + 0.035), { color: '#b03a2e', cast: false });
    F.add(MM.vc, new THREE.BoxGeometry(0.02, 0.2, 0.015).rotateZ(-0.12).translate(0.0, 1.3 + PY, pz + 0.035), { color: '#b03a2e', cast: false });
    // coiled cable / tube on a hook
    F.add(MM.vc, new THREE.TorusGeometry(0.12, 0.014, 5, 18).translate(-0.35, 1.25 + PY, pz + 0.04), { color: '#2a2622', cast: false });
    // plank wainscot around the lower interior wall (a workshop, not a parlour)
    {
      const n = 64;
      for (let i = 0; i < n; i++) {
        const phi = (i / n) * TAU;
        const r = rIn(0.5) - 0.025;
        const x = Math.sin(phi) * r, z = Math.cos(phi) * r;
        if (z > 0 && Math.abs(x) < OPEN_HALF + 0.12) continue;
        const h = 0.92 + rng.jitter(0.02);
        const g = board(0.17, h, 0.025, { along: 'y', rng });
        xf(g, [x, h / 2 + 0.05, z], [0, phi + Math.PI, 0]);
        F.add(MM.wood, g, { color: rng.pick(['#9a7350', '#8f6a48', '#a47a55']), cast: false });
      }
      // a rail capping it, with hooks for small things
      for (let i = 0; i < 40; i++) {
        const phi = (i / 40) * TAU;
        const r = rIn(1.0) - 0.04;
        const x = Math.sin(phi) * r, z = Math.cos(phi) * r;
        if (z > 0 && Math.abs(x) < OPEN_HALF + 0.12) continue;
        F.add(MM.wood, xf(board((TAU * r) / 40 + 0.01, 0.05, 0.05, { rng }), [x, 1.0, z], [0, phi + Math.PI, 0]), { color: WOOD.walnut, cast: false });
      }
    }
    // a bike standing along the left wall, waiting for its turn
    makeBike({ style: 'gravel', color: '#c2703d', tape: '#2b2b2b', batch: F, matrix: mat4([-1.18, 0.05, -0.2], [0, -Math.PI / 2 + 0.25, 0]), scale: 0.62, seed: 'waiting', lite: true });
    // a red rolling tool chest on the right, drawers half open
    {
      const T = F.at(mat4([1.05, 0.05, -0.55], [0, -1.05, 0]));
      T.add(MM.glossy, new THREE.BoxGeometry(0.62, 0.72, 0.4).translate(0, 0.44, 0), { color: '#b03a2e' });
      for (let k = 0; k < 5; k++) {
        const dy = 0.16 + k * 0.13;
        const out = k === 1 ? 0.1 : k === 3 ? 0.05 : 0;
        T.add(MM.glossy, new THREE.BoxGeometry(0.56, 0.1, 0.03).translate(0, dy, 0.2 + out), { color: '#c2483a', cast: false });
        T.add(MM.metal, new THREE.BoxGeometry(0.3, 0.018, 0.02).translate(0, dy + 0.02, 0.225 + out), { color: '#c9cdd0', cast: false });
      }
      T.add(MM.metal, new THREE.BoxGeometry(0.66, 0.03, 0.44).translate(0, 0.815, 0), { color: '#3a3a3a', cast: false });
      for (const [x, z] of [[-0.26, -0.15], [0.26, -0.15], [-0.26, 0.15], [0.26, 0.15]]) T.add(MM.vc, new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10).rotateZ(Math.PI / 2).translate(x, 0.04, z), { color: '#1f1e1d', cast: false });
      // things on top: a work lamp, a coffee mug, a spoke tension meter
      T.add(MM.vc, new THREE.CylinderGeometry(0.04, 0.035, 0.08, 10).translate(-0.18, 0.87, 0.05), { color: '#f1ece2', cast: false });
      T.add(MM.metal, new THREE.BoxGeometry(0.22, 0.03, 0.05).translate(0.1, 0.845, 0.0), { color: '#d9a441', cast: false });
    }
    // a three-legged stool
    {
      const T = F.at(mat4([0.35, 0.05, 0.25], [0, 0.4, 0]));
      T.add(MM.wood, new THREE.CylinderGeometry(0.17, 0.17, 0.05, 14).translate(0, 0.5, 0), { color: WOOD.oak });
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU;
        T.add(MM.wood, rod([Math.sin(a) * 0.1, 0.48, Math.cos(a) * 0.1], [Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2], 0.022, 0.02, 6), { color: WOOD.oakLight, cast: false });
      }
    }
    // tyres leaning against the right wall on the floor
    for (let k = 0; k < 3; k++) {
      const phi = 1.95 + k * 0.16;
      const r = rIn(0.4) - 0.12 - k * 0.04;
      F.add(MM.vc, xf(new THREE.TorusGeometry(0.25, 0.035, 6, 22), [Math.sin(phi) * r, 0.3, Math.cos(phi) * r], [0.12, phi, 0]), { color: k === 1 ? '#b8925e' : '#2a2622', cast: false });
    }
    // a road bike hanging upside down from ceiling hooks
    makeBike({ style: 'road', color: '#2f5a8a', batch: F, matrix: mat4([-0.25, 2.62, -0.95], [Math.PI, 0.25, 0]), scale: 0.6, seed: 'hung', lite: true });
    for (const hx of [-0.5, 0.18]) F.add(MM.metal, rod([hx, WALL_TOP - 0.05, -0.95 - hx * 0.25], [hx, 2.6, -0.95 - hx * 0.25], 0.008, 0.008, 4), { color: IRON, cast: false });
    // wheels on the side walls
    for (const [phi, y, st] of [[-2.0, 1.45, 'gravel'], [-1.6, 1.6, 'vintage'], [2.05, 1.5, 'road'], [1.7, 1.25, 'gravel']]) {
      const r = rIn(y) - 0.05;
      const p = [Math.sin(phi) * r, y, Math.cos(phi) * r];
      makeWheel({ style: st, batch: F, matrix: mat4(p, [0, phi, 0]), scale: 0.6, seed: `wall-${phi}`, lite: true });
      F.add(MM.metal, rod([p[0], y + 0.24, p[2]], [p[0] * 1.08, y + 0.24, p[2] * 1.08], 0.012, 0.012, 4), { color: IRON, cast: false });
    }
    // shelf with tyres & boxes on the right wall
    {
      const phi = 1.35, y = 2.05;
      const r = rIn(y) - 0.2;
      const sm = new THREE.Matrix4().makeRotationY(phi).setPosition(Math.sin(phi) * r, y, Math.cos(phi) * r);
      const S = F.at(sm);
      S.add(MM.wood, board(0.9, 0.04, 0.3, { rng }), { color: WOOD.oak, cast: false });
      for (let k = 0; k < 2; k++) S.add(MM.vc, new THREE.TorusGeometry(0.15, 0.03, 5, 16).rotateX(Math.PI / 2).translate(-0.22, 0.04 + k * 0.06, 0), { color: k ? '#b8925e' : '#2a2622', cast: false });
      S.add(MM.vc, new THREE.BoxGeometry(0.18, 0.14, 0.18).translate(0.15, 0.09, 0), { color: '#d9c39a', cast: false });
      S.add(MM.vc, new THREE.BoxGeometry(0.14, 0.1, 0.14).translate(0.34, 0.07, 0), { color: '#6f8a5a', cast: false });
    }
  }

  // ── the cap ──────────────────────────────────────────────────────────────
  // one shape function for the cap skin, the warts and the chimney: profile ×
  // a wobbly rim × a tip that curls over towards the back-left
  const capPoint = (phi, v, out = new THREE.Vector3()) => {
    const pt = capCurve.getPointAt(Math.min(1, Math.max(0, v)));
    const wob = 1 + 0.035 * noiseA(Math.cos(phi) * 1.5, Math.sin(phi) * 1.5) * smooth01((v - 0.45) * 2.2);
    const y = pt.y + 0.06 * noiseB(Math.cos(phi) * 2, Math.sin(phi) * 2) * smooth01(v * 2 - 1);
    const curl = Math.pow(smooth01((y - (CAP_RIM_Y + CAP_H * 0.55)) / (CAP_H * 0.45)), 2.2);
    out.set(Math.sin(phi) * pt.x * wob - curl * 0.42, y - curl * 0.12, Math.cos(phi) * pt.x * wob - curl * 0.12);
    return out.applyMatrix4(LEAN);
  };
  const capTop = paramSurface((u, v, p) => capPoint(u * TAU, v, p), 80, 32, { uv: (u, v) => [u * 4, 1 - v] });
  {
    // painterly gradient: sunny orange towards the tip, deep rust at the rim, faint streaks
    const top = new THREE.Color('#e98a42'), mid = new THREE.Color(CAP_COLOR), rim = new THREE.Color('#9a4820');
    const pos = capTop.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = (y - CAP_RIM_Y) / CAP_H;
      c.copy(rim).lerp(mid, smooth01(t * 3.2)).lerp(top, smooth01((t - 0.45) * 1.8));
      const ph = Math.atan2(pos.getX(i), pos.getZ(i));
      c.multiplyScalar(0.94 + 0.08 * noiseA(ph * 6, t * 3));
      col.set([c.r, c.g, c.b], i * 3);
    }
    capTop.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  F.add(MM.cap, capTop);
  // rolled rim
  {
    const pts = [];
    const q = new THREE.Vector3();
    for (let i = 0; i <= 80; i++) {
      capPoint((i / 80) * TAU, 1, q);
      pts.push(q.clone().add(new THREE.Vector3(0, -0.035, 0)));
    }
    const rim = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.075, 6, true);
    F.add(MM.cap, rim, { color: '#8e3f1e' });
  }
  // gills: a conical underside from the rim to the wall top (disc UVs) + lamella fins
  {
    const R0 = wallR(WALL_TOP) - 0.05, R1 = CAP_R - 0.06;
    const y0 = WALL_TOP + 0.05, y1 = CAP_PROFILE[CAP_PROFILE.length - 1][1] - 0.02;
    const gills = paramSurface(
      (u, v, p) => {
        const phi = u * TAU;
        const r = R0 + (R1 - R0) * v;
        p.set(Math.sin(phi) * r, y0 + (y1 - y0) * v + Math.sin(v * Math.PI) * 0.12, Math.cos(phi) * r);
      },
      72,
      6,
      { uv: (u, v, p) => [p.x / (2 * R1) + 0.5, p.z / (2 * R1) + 0.5], flip: true }
    );
    gills.applyMatrix4(LEAN);
    F.add(MM.gills, gills, { color: '#e3cfa8', cast: false });
    const nF = 90;
    for (let i = 0; i < nF; i++) {
      const phi = (i / nF) * TAU + rng.jitter(0.01);
      const s = new THREE.Shape();
      const L = R1 - R0;
      s.moveTo(0, 0);
      s.lineTo(L, 0);
      s.quadraticCurveTo(L * 0.6, -0.16 - rng.range(0, 0.05), 0, -0.04);
      const fin = new THREE.ShapeGeometry(s, 3);
      // fin in the radial plane: shape x → radius, y → down
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi)), new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(phi), 0, -Math.sin(phi)));
      fin.applyMatrix4(new THREE.Matrix4().makeShear((y1 - y0) / L, 0, 0, 0, 0, 0));
      fin.applyMatrix4(m);
      fin.translate(Math.sin(phi) * R0, y0 - 0.01, Math.cos(phi) * R0);
      fin.applyMatrix4(LEAN);
      F.add(MM.gills, fin, { color: '#d8c39a', cast: false });
    }
  }
  // warts: cream, raised, following the cap surface — big near the tip, freckles near the rim
  {
    const nW = 120;
    const p0 = new THREE.Vector3(), pu = new THREE.Vector3(), pv = new THREE.Vector3();
    for (let i = 0; i < nW; i++) {
      const v = Math.pow(rng.next(), 0.75) * 0.93 + 0.02;
      const phi = rng.next() * TAU;
      capPoint(phi, v, p0);
      capPoint(phi + 0.01, v, pu).sub(p0);
      capPoint(phi, v + 0.01, pv).sub(p0);
      const nrm = new THREE.Vector3().crossVectors(pv, pu).normalize();
      if (nrm.y < 0) nrm.negate();
      const size = rng.range(0.05, 0.15) * (1.15 - v * 0.6);
      const g = new THREE.IcosahedronGeometry(1, size > 0.09 ? 1 : 0);
      g.scale(size, size * 0.4, size * rng.range(0.65, 1));
      g.rotateY(rng.next() * TAU);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm));
      g.translate(p0.x, p0.y, p0.z);
      F.add(MM.vc, g, { color: rng.pick(['#f2e9d6', '#efe3c9', '#f6efe0', '#e8dcc0']), cast: false });
    }
  }
  // stovepipe chimney poking through the back of the cap, with a rain hat
  const chimneyBase = capPoint(2.5, 0.42);
  const chimneyTop = chimneyBase.clone().add(new THREE.Vector3(0.12, 0.75, -0.05));
  {
    const a = chimneyBase.clone().add(new THREE.Vector3(-0.05, -0.6, 0.02));
    F.add(MM.metal, rod(a.toArray(), chimneyTop.toArray(), 0.09, 0.085, 10), { color: '#4a4440' });
    F.add(MM.metal, new THREE.CylinderGeometry(0.13, 0.13, 0.05, 10).translate(chimneyBase.x, chimneyBase.y + 0.03, chimneyBase.z), { color: '#3a3532', cast: false });
    F.add(MM.metal, new THREE.ConeGeometry(0.2, 0.12, 10).translate(chimneyTop.x, chimneyTop.y + 0.12, chimneyTop.z), { color: '#3a3532' });
    for (const k of [0, 1, 2]) {
      const a2 = (k / 3) * TAU;
      F.add(MM.metal, rod([chimneyTop.x + Math.sin(a2) * 0.08, chimneyTop.y - 0.02, chimneyTop.z + Math.cos(a2) * 0.08], [chimneyTop.x + Math.sin(a2) * 0.12, chimneyTop.y + 0.08, chimneyTop.z + Math.cos(a2) * 0.12], 0.008, 0.008, 3), { color: '#3a3532', cast: false });
    }
  }
  // fairy lights strung under the rim around the front
  {
    const nodes = [];
    for (let i = 0; i <= 8; i++) {
      const phi = -1.9 + (i / 8) * 3.8;
      const q = capPoint(phi, 1);
      nodes.push(new THREE.Vector3(q.x * 0.96, q.y - 0.1, q.z * 0.96));
    }
    for (let i = 0; i < nodes.length - 1; i++) {
      const c = sagCurve(nodes[i], nodes[i + 1], 0.22, 14);
      F.add(MM.vc, new THREE.TubeGeometry(c, 16, 0.008, 3, false), { color: '#2a2622', cast: false });
      for (let k = 1; k < 5; k++) {
        const p = c.getPointAt(k / 5);
        F.add(MM.bulb, new THREE.SphereGeometry(0.035, 6, 5).scale(1, 1.3, 1).translate(p.x, p.y - 0.05, p.z), { cast: false });
        halos.push({ ...toWorld(p.x, p.y - 0.05, p.z), size: 0.42 });
      }
    }
  }

  // ── greenery on & around the drum ────────────────────────────────────────
  {
    const ivy = new Cards();
    for (let i = 0; i < 9; i++) {
      let phi = rng.range(0.7, TAU - 0.7);
      if (windows.some((w) => Math.abs(Math.atan2(Math.sin(phi - w.phi), Math.cos(phi - w.phi))) < 0.3)) phi += 0.45;
      const y0 = WALL_TOP - 0.05;
      const r = wallR(y0);
      addIvy(F, rng, [Math.sin(phi) * r, y0, Math.cos(phi) * r], [rng.jitter(0.3), -1, 0], {
        length: rng.range(0.9, 2.2),
        droop: 1.0,
        size: 0.15,
        density: 1.2,
        cards: ivy,
        surface: (p, n) => {
          const rr = wallR(Math.max(0, p.y)) + 0.05;
          const ph = Math.atan2(p.x, p.z);
          p.x = Math.sin(ph) * rr;
          p.z = Math.cos(ph) * rr;
          n.set(Math.sin(ph), 0, Math.cos(ph));
        },
      });
    }
    flushCards(F, ivy, MM.ivy, null, 0);
    // moss cushions along the foot of the wall
    for (let i = 0; i < 34; i++) {
      const phi = rng.next() * TAU;
      const x = Math.sin(phi) * (wallR(0) + 0.05), z = Math.cos(phi) * (wallR(0) + 0.05);
      if (z > 0 && Math.abs(x) < OPEN_HALF + 0.2) continue;
      const g = mossGeo(rng, { r: rng.range(0.12, 0.28), h: rng.range(0.05, 0.12), sx: 1.4, sz: 0.8 });
      xf(g, [x, 0, z], [0, phi + Math.PI / 2, 0]);
      F.add(MM.moss, g, { color: rng.pick(['#6f8f3a', '#5d7d30', '#7f9a44']), cast: false });
    }
    // ferns, grass, toadstools & flowers around the base (not in front of the door)
    for (let i = 0; i < 42; i++) {
      const phi = rng.next() * TAU;
      const rr = wallR(0) + rng.range(0.15, 0.85);
      const x = Math.sin(phi) * rr, z = Math.cos(phi) * rr;
      if (z > 0.6 && Math.abs(x) < 2.4) continue; // keep the yard clear
      const k = rng.next();
      if (k < 0.35) plantFern(F, rng, x, 0, z, { size: rng.range(0.45, 0.8), fronds: rng.int(6, 9) });
      else if (k < 0.65) plantGrass(F, rng, x, 0, z, { size: rng.range(0.25, 0.42), blades: 4 });
      else if (k < 0.82) addToadstool(F, rng, x, 0, z, { size: rng.range(0.08, 0.15), color: rng.chance(0.6) ? '#c4301f' : '#d7832e' });
      else addFlower(F, rng, x, 0, z, { size: 0.06, stem: 0.2 });
    }
  }

  // a weathervane on the cap's tip: an iron arrow and a tiny bicycle riding the wind
  {
    const tip = capPoint(0, 0);
    const vane = new THREE.Group();
    vane.position.set(tip.x, tip.y + 0.02, tip.z);
    vane.rotation.y = 0.6;
    group.add(vane);
    const V = new Batch('vane');
    V.add(MM.metal, rod([0, -0.05, 0], [0, 0.75, 0], 0.016, 0.012, 6), { color: IRON });
    V.add(MM.metal, new THREE.SphereGeometry(0.035, 8, 6).translate(0, 0.42, 0), { color: '#b8892e' });
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) V.add(MM.metal, rod([0, 0.3, 0], [dx * 0.16, 0.3, dz * 0.16], 0.006, 0.006, 3), { color: IRON });
    const spin = new THREE.Group();
    spin.position.y = 0.62;
    vane.add(spin);
    const VS = new Batch('vane-spin');
    VS.add(MM.metal, rod([-0.3, 0, 0], [0.3, 0, 0], 0.008, 0.008, 4), { color: IRON });
    VS.add(MM.metal, new THREE.ConeGeometry(0.035, 0.09, 4).rotateZ(-Math.PI / 2).translate(0.33, 0, 0), { color: IRON });
    VS.add(MM.metal, new THREE.BoxGeometry(0.01, 0.1, 0.12).translate(-0.3, 0, 0), { color: IRON });
    makeBike({ style: 'road', color: '#3a3530', tape: '#3a3530', saddle: '#3a3530', batch: VS, matrix: mat4([-0.08, 0.01, 0], [0, 0, 0]), scale: 0.22, lite: true, seed: 'vane' });
    V.build(vane, 'vane');
    VS.build(spin, 'vane');
    updates.push((dt, t) => {
      spin.rotation.y = 0.4 + Math.sin(t * 0.23) * 0.5 + Math.sin(t * 0.71) * 0.15;
    });
  }

  // a worn flagstone apron in front of the doors, moss in the joints
  {
    const zc = zFront(0, 0) + 0.15;
    for (let i = 0; i < 26; i++) {
      const a = rng.range(-1.2, 1.2), d = Math.sqrt(rng.next()) * 1.45;
      const x = Math.sin(a) * d, z = zc + Math.cos(a) * d * 0.75;
      const r = rng.range(0.16, 0.26);
      const g = stoneGeo(rng, { r, sx: rng.range(1.0, 1.5), sz: rng.range(0.8, 1.1), sy: 0.18, lump: 0.12, flatTop: 0.1, detail: 1 });
      xf(g, [x, 0.01, z], [0, rng.next() * TAU, 0]);
      F.add(MM.pebble, g, { color: rng.pick(['#8f8778', '#857e70', '#9a8f7a', '#7c776c']) });
      if (rng.chance(0.4)) {
        const m = mossGeo(rng, { r: rng.range(0.06, 0.12), h: 0.025 });
        xf(m, [x + r, 0, z + rng.jitter(0.1)], [0, rng.next() * TAU, 0]);
        F.add(MM.moss, m, { color: '#6f8f3a' });
      }
    }
  }

  // ── the yard: hero bike on a repair stand, truing stand, wheels, bits ────
  const hero = makeBike({ style: 'gravel', spin: true, spinFront: false, seed: 'hero', scale: 0.8, color: '#e3d5b5', tape: '#6b4a2e' });
  const heroPos = new THREE.Vector3(-1.55, 0.2, 3.45);
  hero.group.position.copy(heroPos);
  hero.group.rotation.y = 0.12;
  group.add(hero.group);
  hero.setSpin(0, 0);
  {
    // repair stand: tripod, mast, arm and clamp gripping the seatpost
    const post = hero.dims.saddle.clone().add(new THREE.Vector3(0.05, -0.12, 0)).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.12).add(heroPos);
    const mastX = post.x - 0.32, mastZ = post.z - 0.45;
    F.add(MM.glossy, rod([mastX, 0.1, mastZ], [mastX, post.y + 0.05, mastZ], 0.022, 0.02, 8), { color: '#2f6f8f' });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.4;
      F.add(MM.glossy, rod([mastX, 0.16, mastZ], [mastX + Math.sin(a) * 0.42, 0.01, mastZ + Math.cos(a) * 0.42], 0.016, 0.014, 6), { color: '#2f6f8f' });
      F.add(MM.vc, new THREE.SphereGeometry(0.025, 6, 4).translate(mastX + Math.sin(a) * 0.42, 0.015, mastZ + Math.cos(a) * 0.42), { color: '#1f1e1d', cast: false });
    }
    F.add(MM.metal, rod([mastX, post.y + 0.05, mastZ], [post.x, post.y + 0.02, post.z], 0.016, 0.016, 6), { color: '#9ea2a5' });
    F.add(MM.vc, new THREE.BoxGeometry(0.07, 0.08, 0.09).translate(post.x, post.y, post.z), { color: '#1f1e1d' });
    F.add(MM.vc, new THREE.SphereGeometry(0.035, 8, 6).translate(mastX, post.y + 0.1, mastZ), { color: '#b03a2e', cast: false });
    // a little tray of tools on the mast
    F.add(MM.metal, new THREE.BoxGeometry(0.3, 0.025, 0.2).translate(mastX, 0.62, mastZ - 0.05), { color: '#2f6f8f' });
    F.add(MM.metal, new THREE.BoxGeometry(0.02, 0.012, 0.16).translate(mastX - 0.06, 0.64, mastZ - 0.05), { color: '#c9cdd0', cast: false });
    F.add(MM.vc, new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6).rotateZ(Math.PI / 2).translate(mastX + 0.05, 0.645, mastZ - 0.03), { color: '#d9a441', cast: false });
  }
  // the mechanic
  let mechanic = null;
  try {
    mechanic = ctx.props.makePerson({ seed: 'velo-mechanic', name: 'Mechanic', holding: 'wrench', action: 'work', apron: true, apronColor: '#3f5f73', hat: 'cap', hatColor: '#b03a2e', shirt: '#e8a838' });
    const mp = new THREE.Vector3(-2.72, 0, 3.6);
    mechanic.group.position.copy(mp);
    mechanic.group.rotation.y = Math.atan2(heroPos.x - 0.35 - mp.x, heroPos.z - 0.05 - mp.z);
    group.add(mechanic.group);
  } catch (err) {
    console.warn('[riverside] mechanic skipped', err);
  }

  // truing stand on a stump bench to the right of the doors
  const truing = new THREE.Group();
  truing.name = 'truing-stand';
  const tPos = new THREE.Vector3(1.95, 0, 3.05);
  truing.position.copy(tPos);
  truing.rotation.y = -0.35;
  group.add(truing);
  let truingWheel;
  {
    const tm = new THREE.Matrix4().makeRotationY(-0.35).setPosition(tPos.x, 0, tPos.z);
    const T = F.at(tm);
    // stump bench: a thick log round on three legs
    const top = 0.52;
    const stump = new THREE.CylinderGeometry(0.34, 0.37, 0.16, 16).translate(0, top - 0.08, 0);
    T.add(MM.wood, stump, { color: WOOD.oak });
    T.add(MM.vc, new THREE.CylinderGeometry(0.335, 0.335, 0.01, 18).translate(0, top + 0.002, 0), { color: '#d8b98a', cast: false });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.5;
      T.add(MM.wood, rod([Math.sin(a) * 0.2, top - 0.12, Math.cos(a) * 0.2], [Math.sin(a) * 0.33, 0, Math.cos(a) * 0.33], 0.035, 0.03, 6), { color: WOOD.oakLight });
    }
    // the truing stand: base + two uprights holding the axle, a caliper arm
    const axleY = top + 0.06 + 0.34 * 0.6 + 0.05;
    T.add(MM.glossy, new THREE.BoxGeometry(0.34, 0.04, 0.18).translate(0, top + 0.02, 0), { color: '#2f6f8f' });
    for (const sz of [-1, 1]) T.add(MM.glossy, rod([0, top + 0.03, sz * 0.07], [0, axleY + 0.03, sz * 0.05], 0.014, 0.012, 6), { color: '#2f6f8f' });
    T.add(MM.metal, rod([0.0, top + 0.03, 0.07], [0.17, axleY + 0.15, 0.06], 0.008, 0.008, 4), { color: '#c9cdd0', cast: false });
    T.add(MM.vc, new THREE.BoxGeometry(0.03, 0.04, 0.05).translate(0.17, axleY + 0.17, 0.0), { color: '#1f1e1d', cast: false });
    // spoke key & spare nipples on the stump
    T.add(MM.vc, new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10).translate(-0.2, top + 0.012, 0.12), { color: '#b03a2e', cast: false });
    T.add(MM.metal, new THREE.BoxGeometry(0.1, 0.012, 0.03).translate(0.15, top + 0.008, 0.18), { color: '#b9bec2', cast: false });
    truingWheel = makeWheel({ style: 'road', scale: 0.6, seed: 'truing' });
    truingWheel.position.set(0, axleY, 0);
    truing.add(truingWheel);
  }
  // wheels on wall pegs right of the doors, a tyre stack, pump, oil can, crate
  for (const [phi, y, st] of [[0.78, 1.55, 'vintage'], [0.98, 1.2, 'gravel']]) {
    const r = wallR(y) + 0.12;
    const p = [Math.sin(phi) * r, y, Math.cos(phi) * r];
    makeWheel({ style: st, batch: F, matrix: mat4(p, [0, phi, 0.05]), scale: 0.62, seed: `peg-${phi}`, lite: true });
    F.add(MM.wood, rod([p[0] * 0.95, y + 0.25, p[2] * 0.95], [p[0] * 1.03, y + 0.26, p[2] * 1.03], 0.02, 0.02, 5), { color: WOOD.walnut, cast: false });
  }
  {
    const P = F.at(mat4([-2.35, 0, 0.95], [0, 0.4, 0]));
    for (let k = 0; k < 4; k++) P.add(MM.vc, new THREE.TorusGeometry(0.22, 0.04, 6, 20).rotateX(Math.PI / 2).translate(rng.jitter(0.02), 0.04 + k * 0.08, rng.jitter(0.02)), { color: k === 3 ? '#b8925e' : '#2a2622' });
    // crate of parts
    const C = F.at(mat4([2.45, 0, 1.15], [0, -0.5, 0]));
    for (const [w, h, d, x, y, z] of [[0.5, 0.05, 0.36, 0, 0.03, 0], [0.5, 0.26, 0.03, 0, 0.16, 0.165], [0.5, 0.26, 0.03, 0, 0.16, -0.165], [0.03, 0.26, 0.36, 0.235, 0.16, 0], [0.03, 0.26, 0.36, -0.235, 0.16, 0]]) {
      C.add(MM.wood, board(w, h, d, { rng }).translate(x, y, z), { color: WOOD.spruce });
    }
    for (let i = 0; i < 7; i++) C.add(MM.metal, new THREE.TorusGeometry(rng.range(0.04, 0.08), 0.012, 4, 12).rotateX(rng.range(0, 3)).translate(rng.jitter(0.15), 0.28, rng.jitter(0.1)), { color: rng.pick(['#9ea2a5', '#3a3a3a', '#c9a24a']), cast: false });
    // floor pump leaning by the door
    const pm = F.at(mat4([-1.25, 0, 1.75], [0.12, 0.3, 0.1]));
    pm.add(MM.glossy, new THREE.CylinderGeometry(0.035, 0.035, 0.55, 10).translate(0, 0.32, 0), { color: '#b03a2e' });
    pm.add(MM.vc, new THREE.BoxGeometry(0.26, 0.03, 0.08).translate(0, 0.02, 0), { color: '#1f1e1d' });
    pm.add(MM.vc, new THREE.BoxGeometry(0.22, 0.03, 0.03).translate(0, 0.64, 0), { color: '#1f1e1d' });
    pm.add(MM.metal, new THREE.CylinderGeometry(0.008, 0.008, 0.1, 4).translate(0, 0.6, 0), { color: '#c9cdd0', cast: false });
    pm.add(MM.vc, tube([[0.03, 0.15, 0], [0.15, 0.08, 0.05], [0.2, 0.25, 0.08]], 0.008, 4, 10), { color: '#1f1e1d', cast: false });
    // oil can
    const oc = F.at(mat4([1.4, 0.0, 2.95], [0, 0.6, 0]));
    oc.add(MM.glossy, new THREE.CylinderGeometry(0.07, 0.08, 0.12, 12).translate(0, 0.06, 0), { color: '#c9a24a' });
    oc.add(MM.glossy, new THREE.ConeGeometry(0.07, 0.06, 12).translate(0, 0.15, 0), { color: '#c9a24a' });
    oc.add(MM.metal, rod([0, 0.17, 0], [0.16, 0.26, 0], 0.008, 0.004, 4), { color: '#c9a24a', cast: false });
  }

  // a hanging sign on a bracket left of the doors
  let sign = null;
  try {
    sign = ctx.props.makeSign({ text: 'Velowerkstatt', style: 'hanging', bracket: false, width: 1.25, wood: 'oak', seed: 'velowerkstatt' });
    const phi = -0.82, y = 2.4;
    const r = wallR(y);
    const bx = Math.sin(phi) * (r + 0.55), bz = Math.cos(phi) * (r + 0.55);
    F.add(MM.metal, rod([Math.sin(phi) * (r - 0.05), y + 0.05, Math.cos(phi) * (r - 0.05)], [bx, y + 0.05, bz], 0.018, 0.016, 5), { color: IRON });
    F.add(MM.metal, rod([Math.sin(phi) * (r - 0.02), y - 0.3, Math.cos(phi) * (r - 0.02)], [Math.sin(phi) * (r + 0.32), y + 0.04, Math.cos(phi) * (r + 0.32)], 0.012, 0.012, 4), { color: IRON, cast: false });
    sign.position.set(Math.sin(phi) * (r + 0.42), y + 0.03, Math.cos(phi) * (r + 0.42));
    sign.rotation.y = phi + Math.PI / 2 + Math.PI;
    sign.scale.setScalar(0.8);
    group.add(sign);
  } catch (err) {
    console.warn('[riverside] sign skipped', err);
  }

  // a thin curl of smoke from the stovepipe (the stove is lit for the coffee)
  const smoke = makePuffs(ctx, {
    name: 'velowerkstatt-smoke',
    seed: 'velo-smoke',
    emitters: [{ p: toWorld(chimneyTop.x, chimneyTop.y + 0.18, chimneyTop.z), n: 26, spread: 0.04 }],
    color: '#e2ddd4',
    rise: 2.6,
    spreadOut: 0.25,
    drift: new THREE.Vector3(0.5, 0, -0.35),
    size: [0.16, 0.3],
    grow: 2.6,
    life: [0.09, 0.14],
    opacity: 0.32,
  });
  ctx.scene.add(smoke.points);
  updates.push((dt, t) => smoke.update(t));

  // colliders: the drum, the repair stand and the truing stump
  if (ctx.colliders?.addCircle) {
    const c = toWorld(0, 0, 0);
    ctx.colliders.addCircle(c.x, c.z, wallR(0) + 0.1, 'velowerkstatt');
    const h = toWorld(heroPos.x, 0, heroPos.z);
    ctx.colliders.addCircle(h.x, h.z, 0.55, 'velowerkstatt-repair-stand');
    const tw = toWorld(tPos.x, 0, tPos.z);
    ctx.colliders.addCircle(tw.x, tw.z, 0.42, 'velowerkstatt-truing-stand');
  }

  // warm light inside the workshop (the doors spill it out at night)
  const light = ctx.lights?.addPoint?.(toWorld(0, 2.0, 0.2), { color: '#ffb866', day: 1.2, night: 7, distance: 7.5 });

  const animate = !ctx.engine?.reducedMotion;
  let phase = 0;
  updates.push((dt, t) => {
    if (!animate) return;
    truingWheel.rotation.z -= dt * 1.4;
    // the mechanic turns the cranks every few seconds to check the shifting
    phase = (t % 7) / 7;
    const spinning = phase > 0.55;
    hero.setSpin(spinning ? 6 : 0, spinning ? 2.2 : 0);
    hero.update(dt);
  });

  return {
    group,
    frame,
    toWorld,
    hero,
    truing,
    truingWheel,
    mechanic,
    sign,
    light,
    anchors: { chimneyTop: toWorld(chimneyTop.x, chimneyTop.y + 0.2, chimneyTop.z), door: toWorld(0, 1, zFront(0, 1)) },
    update(dt, t) {
      for (const u of updates) u(dt, t);
    },
  };
}
