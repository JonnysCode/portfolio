// ─────────────────────────────────────────────────────────────────────────────
// The Velowerkstatt (RIVERSIDE.bikeShed) — Jonny's bike workshop: a stone
// mushroom with a rust-orange spotted cap across the bridge (ref: the stone
// mushroom cottage).
//
//   • a bulging drum of rough, mossy fieldstones laid course by course, with
//     an arched doorway: quoined jambs and a ring of dressed voussoirs
//   • ledged-and-braced plank doors cut to the arch, swung open on strap
//     hinges — the left one folded back as a backdrop for the hero bike
//   • a warm lit interior: plank floor, whitewashed walls, a beamed ceiling,
//     the workbench with a vice, a pegboard of tools, wheels and a road bike
//     hanging from hooks, shelves of tyres & parts, a hanging lamp
//   • the cap: a pointed rust-orange bell pushed back like a hat (so its real
//     gills show from the yard), a rolled rim, cream spots, fairy lights
//     along the rim, a crooked stovepipe and a bicycle weathervane
//   • round & square windows glowing, ivy, moss, ferns & toadstools at the foot
//   • out front: the hero gravel bike on a repair stand (cranks & wheels
//     turning), the mechanic with a wrench, a truing stand with a slowly
//     spinning wheel on a stump bench, wheels on wall pegs over a bench,
//     flower pots under a hanging lantern, a split-rail fence with a road
//     bike and a kid's bike, a chalkboard, tyres, a pump, an oil can, a crate
//     of parts and a hanging "Velowerkstatt" sign
//
// Local frame: origin on the pad centre, the doors face +Z.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RIVERSIDE } from '../../world/layout.js';
import { getHeight, getPathDistance, isInWater } from '../../world/ground.js';
import {
  Batch, M, TAU, WOOD, IRON, xf, mat4, deform, stoneGeo, mossGeo, paramSurface, board, boardBetween, rod, tube,
  Cards, plantFern, plantGrass, addFlower, addToadstool, addIvy, flushCards, uvPlanar, noiseA, noiseB, smooth01, sagCurve,
  cushionStone, roundStone, archStone, stoneTint, wallFern, paint, paintFn, taperTube, DRESSED_TINTS, MORTAR,
} from './kit.js';
import { makeBike, makeWheel, makeBareFrame } from './bike.js';
import { makePuffs } from './puffs.js';

// ── dimensions ──
const WALL_TOP = 3.25;
const WALL_T = 0.3;
const OPEN_HALF = 0.84; // half width of the arched door opening
const SPRING_Y = 1.62; // where the door arch springs from the jambs
const ARCH_TOP = SPRING_Y + OPEN_HALF; // intrados crown of the door arch
const ARCH_RING = 0.3; // depth of the voussoir ring around the arch
const CAP_COLOR = '#cc632b';
const CAP_R = 2.95, CAP_RIM_Y = 3.05, CAP_H = 3.15;

/** Outer radius of the stone drum at height y (gently bulging). */
export function wallR(y) {
  const t = Math.min(1, Math.max(0, y / WALL_TOP));
  return 1.98 + 0.16 * Math.sin(t * Math.PI * 0.85) - 0.1 * t * t;
}

/** Intrados height of the door arch at |x| (the straight jambs below SPRING_Y). */
const archTop = (x) => SPRING_Y + Math.sqrt(Math.max(0, OPEN_HALF * OPEN_HALF - x * x));
/** Half width of the door opening at height y (0 above the arch). */
const openingHalf = (y) => (y <= SPRING_Y ? OPEN_HALF : y >= ARCH_TOP ? 0 : Math.sqrt(OPEN_HALF * OPEN_HALF - (y - SPRING_Y) ** 2));
/** Does a wall stone spanning |x| ± len/2 and y0..y1 (front face) clash with the jambs' quoins or the arch ring? */
function clashesOpening(x, len, y0, y1) {
  const xn = Math.max(0, Math.abs(x) - len / 2);
  if (y0 < SPRING_Y && xn < OPEN_HALF + 0.3) return true;
  const yn = Math.min(Math.max(SPRING_Y, y0), y1);
  return Math.hypot(xn, yn - SPRING_Y) < OPEN_HALF + ARCH_RING + 0.02;
}

/**
 * Cap profile from the apex to the rim edge: [r, y] — a pointed bell: a steep,
 * slightly convex crown that flares (concave) into a wide brim (ref: the
 * stone mushroom cottage).
 */
const CAP_PROFILE = [
  [0, 1], [0.06, 0.982], [0.13, 0.935], [0.2, 0.86], [0.27, 0.765], [0.335, 0.655], [0.4, 0.54], [0.48, 0.42], [0.58, 0.3], [0.7, 0.19], [0.82, 0.105], [0.92, 0.045], [1, 0],
].map(([r, y]) => [r * CAP_R, CAP_RIM_Y + y * CAP_H]);
const capCurve = new THREE.SplineCurve(CAP_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)));
/** Cap tilt: pushed back like a hat (so the gills show from the yard) with a cute lean, pivoting on the wall top. */
const LEAN = new THREE.Matrix4()
  .makeTranslation(0, WALL_TOP, 0)
  .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.1, 0, 0.045)))
  .multiply(new THREE.Matrix4().makeTranslation(0, -WALL_TOP, 0));

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
  const windows = [
    { phi: -1.05, y: 1.45, r: 0.3, kind: 'round' },
    { phi: 1.2, y: 1.35, r: 0.27, kind: 'square' },
    { phi: 2.6, y: 1.5, r: 0.24, kind: 'round' },
    // a little loft window up under the cap
    { phi: 0.78, y: 2.72, r: 0.19, kind: 'round' },
  ];
  const nearWindow = (phi, y, half) => windows.some((w) => {
    const d = Math.abs(Math.atan2(Math.sin(phi - w.phi), Math.cos(phi - w.phi))) * wallR(y);
    return d < w.r + half + 0.04 && Math.abs(y - w.y) < w.r + 0.14;
  });
  // rough fieldstones laid course by course: each one an irregular cushion
  // bulging out of dark, mossy mortar (bent around the drum), every stone its
  // own value & hue; moss cushions on the ledges and little ferns in the joints
  const wallFerns = [];
  {
    let y = -0.1;
    let row = 0;
    while (y < WALL_TOP - 0.05) {
      const hc = Math.min(rng.range(0.17, 0.27), WALL_TOP - y);
      const yc = y + hc / 2;
      const r = wallR(yc);
      let phi = rng.next() * 0.3 + row * 0.41;
      const end = phi + TAU;
      while (phi < end - 0.05) {
        // mostly modest stones, now and then a big one or a pair of small ones
        const big = rng.chance(0.14);
        const len = Math.min(big ? rng.range(0.5, 0.7) : rng.range(0.26, 0.48), (end - phi) * r + 0.02);
        const dphi = len / r;
        const pc = phi + dphi / 2;
        phi += dphi;
        const x = Math.sin(pc) * r, z = Math.cos(pc) * r;
        if (z > 0 && clashesOpening(x, len, y, y + hc)) continue;
        if (nearWindow(pc, yc, len / 2)) continue;
        // follow the bulge (lean back) and hug the curve of the drum
        const slope = (wallR(yc + 0.05) - wallR(yc - 0.05)) / 0.1;
        const pair = !big && hc > 0.2 && rng.chance(0.12);
        const parts = pair ? [[-hc / 4, hc / 2], [hc / 4, hc / 2]] : [[0, big ? Math.min(hc * rng.range(1.0, 1.2), hc + 0.04) : hc]];
        for (const [dy, hh] of parts) {
          const g = cushionStone(rng, len - 0.04, hh - 0.04, rng.range(0.045, 0.085), {
            // greener, damper stones towards the foot
            color: yc < 0.55 && rng.chance(0.5) ? stoneTint(rng, ['#717559', '#6a7352', '#7a7b62']) : stoneTint(rng),
            segs: len > 0.45 ? 12 : 10,
          });
          g.rotateX(-Math.atan(slope) + rng.jitter(0.05));
          g.rotateZ(rng.jitter(0.06));
          const rr = r - 0.02;
          const y0 = yc + dy + rng.jitter(0.012);
          deform(g, (v) => {
            const a = pc + v.x / rr, R = rr + v.z;
            v.set(Math.sin(a) * R, y0 + v.y, Math.cos(a) * R);
          });
          F.add(MM.wallStone, g);
        }
        // a cushion of moss on some ledges, more of it low down
        if (rng.chance(yc < 1 ? 0.2 : 0.08)) {
          const m = mossGeo(rng, { r: rng.range(0.06, 0.13), h: 0.04, sx: 1.7, sz: 0.6, seg: 7 });
          xf(m, [x * (1 + 0.035 / r), yc + hc / 2 - 0.02, z * (1 + 0.035 / r)], [0, pc + Math.PI / 2, 0]);
          F.add(MM.moss, m, { color: rng.pick(['#6f8f3a', '#5d7d30', '#7f9a44']), cast: false });
        }
        if (yc > 0.3 && yc < 2.5 && rng.chance(0.012)) wallFerns.push([pc, yc + hc / 2]);
      }
      y += hc;
      row++;
    }
  }
  // the mortar behind the stones (dark, damp, mossy — every joint reads as a
  // shadowed groove) + whitewashed interior
  const aOpen = (y) => {
    const hw = openingHalf(y);
    return hw > 0 ? Math.asin(Math.min(0.999, (hw + 0.02) / wallR(Math.max(0, y)))) : 0;
  };
  const shell = (inset, mat, inside, colorize) => {
    const g = paramSurface(
      (u, v, p) => {
        const y = -0.1 + (1 - v) * (WALL_TOP + 0.1);
        const ao = aOpen(y);
        const phi = ao + u * (TAU - 2 * ao);
        const r = wallR(Math.max(0, y)) - inset;
        p.set(Math.sin(phi) * r, y, Math.cos(phi) * r);
      },
      52,
      inside ? 24 : 22,
      { uv: (u, v, p) => [Math.atan2(p.x, p.z) * 0.9, p.y / 2], flip: inside }
    );
    colorize(g);
    F.add(mat, g, { cast: false });
  };
  const mortarDark = new THREE.Color(MORTAR), mortarMoss = new THREE.Color('#3c5021');
  shell(0.055, MM.moss, false, (g) =>
    paintFn(g, MORTAR, (x, y, z, i, c) => {
      const k = smooth01(0.25 + noiseA(x * 1.7 + z * 1.3, y * 2.2) * 0.8 - y * 0.25);
      c.copy(mortarDark).lerp(mortarMoss, k);
    })
  );
  shell(WALL_T, MM.plaster, true, (g) => paint(g, '#efe4cf'));
  // the reveal of the arched opening (jambs + soffit), from the outer face to the inner one
  {
    // outline: up the left jamb, over the arch, down the right jamb
    const outline = [];
    for (let i = 0; i <= 6; i++) outline.push([-OPEN_HALF - 0.02, -0.05 + (SPRING_Y + 0.05) * (i / 6)]);
    for (let i = 1; i < 24; i++) {
      const a = Math.PI - (i / 24) * Math.PI;
      outline.push([Math.cos(a) * (OPEN_HALF + 0.02), SPRING_Y + Math.sin(a) * (OPEN_HALF + 0.02)]);
    }
    for (let i = 0; i <= 6; i++) outline.push([OPEN_HALF + 0.02, SPRING_Y - (SPRING_Y + 0.05) * (i / 6)]);
    const n = outline.length - 1;
    const reveal = paramSurface(
      (u, v, p) => {
        const [x, y] = outline[Math.round(u * n)];
        const yy = Math.max(0, y);
        const zo = Math.sqrt(Math.max(0, (wallR(yy) - 0.06) ** 2 - x * x));
        const zi = Math.sqrt(Math.max(0, (wallR(yy) - WALL_T - 0.01) ** 2 - x * x));
        p.set(x, y, zo + (zi - zo) * v);
      },
      n,
      2,
      { uv: (u, v, p) => [p.z * 0.6, u * 4] }
    );
    // dressed stone, darker towards the inside
    paintFn(reveal, '#958a74', (x, y, z, i, c) => c.multiplyScalar(0.62 + 0.38 * smooth01((z - 1.6) / 0.3)));
    F.add(MM.stone, reveal, { cast: false });
  }
  // quoins: alternating long & short dressed blocks up both jambs
  for (const sx of [-1, 1]) {
    let y = -0.06;
    let k = sx > 0 ? 0 : 1;
    while (y < SPRING_Y - 0.05) {
      const h = Math.min(rng.range(0.25, 0.3), SPRING_Y - y);
      const long = k % 2 === 0;
      const w = long ? 0.42 : 0.29;
      const xc = sx * (OPEN_HALF + w / 2 - 0.01);
      const zo = zFront(Math.abs(xc), y + h / 2);
      const g = roundStone(rng, w - 0.03, h - 0.035, 0.34, { color: stoneTint(rng, DRESSED_TINTS, 0.7), box: 0.3, under: 0.25 });
      xf(g, [xc, y + h / 2, zo - 0.13], [rng.jitter(0.03), Math.asin(Math.min(0.99, xc / wallR(y + h / 2))) * 0.6, rng.jitter(0.03)]);
      F.add(MM.stone, g);
      y += h;
      k++;
    }
  }
  // the arch ring: dressed sandstone voussoirs, the keystone proud and taller
  {
    const NV = 11;
    for (let i = 0; i < NV; i++) {
      const a0 = Math.PI - (i / NV) * Math.PI, a1 = Math.PI - ((i + 1) / NV) * Math.PI;
      const key = i === (NV - 1) / 2;
      const r1 = OPEN_HALF + ARCH_RING * rng.range(0.92, 1.1) + (key ? 0.12 : 0);
      const seg = archStone(rng, OPEN_HALF - 0.01, r1, a1 + 0.02, a0 - 0.02, 0.36, { color: key ? '#c4ae84' : stoneTint(rng, DRESSED_TINTS, 0.7), box: 0.34 });
      const am = (a0 + a1) / 2;
      const xm = Math.cos(am) * (OPEN_HALF + 0.15), ym = SPRING_Y + Math.sin(am) * (OPEN_HALF + 0.15);
      const zo = zFront(Math.abs(xm), ym);
      seg.translate(0, SPRING_Y, zo - 0.13 + (key ? 0.04 : 0));
      F.add(MM.stone, seg);
    }
    // a worn stone threshold
    const sill = roundStone(rng, OPEN_HALF * 2 + 0.36, 0.14, 0.62, { color: '#8f8676', box: 0.28, sag: -0.04 });
    xf(sill, [0, 0.0, zFront(0.6, 0) - 0.12]);
    F.add(MM.stone, sill);
  }
  // little ferns sprouting from the joints, ivy-free spots only
  for (const [pc, y] of wallFerns) {
    const r = wallR(y) + 0.02;
    if (Math.cos(pc) * r > 0 && Math.abs(Math.sin(pc) * r) < OPEN_HALF + 0.5) continue;
    wallFern(F, rng, [Math.sin(pc) * r, y, Math.cos(pc) * r], [Math.sin(pc), 0, Math.cos(pc)], { size: rng.range(0.22, 0.34) });
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
        const g = cushionStone(rng, 0.17, 0.13, 0.06, { color: stoneTint(rng, DRESSED_TINTS, 0.7), segs: 8 });
        xf(g, [Math.sin(a) * (w.r + 0.12), Math.cos(a) * (w.r + 0.12), 0.0], [0, 0, -a]);
        W.add(MM.stone, g, { cast: false });
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
      W.add(MM.stone, roundStone(rng, s * 2.4, 0.09, 0.24, { color: stoneTint(rng, DRESSED_TINTS, 0.6), box: 0.3 }).translate(0, -s - 0.08, 0.06));
    }
    // window boxes with flowers under the square window
    if (w.kind === 'square') {
      W.add(MM.wood, board(w.r * 2.2, 0.14, 0.18, { rng }).translate(0, -w.r - 0.22, 0.14), { color: WOOD.oak });
      for (let i = 0; i < 7; i++) addFlower(W, rng, -w.r + (i / 6) * w.r * 2, -w.r - 0.15, 0.14 + rng.jitter(0.04), { size: 0.06, stem: 0.12 });
    }
    halos.push({ ...toWorld(...new THREE.Vector3(0, 0, 0.12).applyMatrix4(fm).toArray()), size: w.r * 2.6 });
  }

  // ── arched plank doors, swung open: the left one folded right back (a warm
  // wooden backdrop for the hero bike), the right one standing out into the yard
  for (const sx of [-1, 1]) {
    const hz = zFront(OPEN_HALF, 1) + 0.02;
    const a = sx < 0 ? 2.86 : 1.8; // opening angle
    const dir = new THREE.Vector3(sx * -Math.cos(a), 0, Math.sin(a));
    const leafW = OPEN_HALF + 0.02;
    const hingeX = OPEN_HALF + 0.04;
    /** Top of the leaf at leaf-x lx (follows the arch, a finger's gap below it). */
    const leafTop = (lx) => archTop(Math.min(OPEN_HALF, Math.max(0, hingeX - lx))) - 0.04 - 0.05;
    const leafH = leafTop(leafW);
    // leaf frame (right-handed): local x from the hinge along `dir`, y up, z = dir × up.
    // The leaf's INNER face (ledges & brace, now facing the yard) is on local z·sx.
    const nrm = new THREE.Vector3(-dir.z, 0, dir.x);
    const zin = sx;
    const m = new THREE.Matrix4().makeBasis(dir, new THREE.Vector3(0, 1, 0), nrm).setPosition(sx * hingeX, 0.04, hz);
    const D = F.at(m);
    const nP = 6;
    for (let i = 0; i < nP; i++) {
      const pw = leafW / nP;
      const ph = leafH;
      const g = board(pw - 0.012, ph, 0.05, { along: 'y', rng });
      g.translate(pw * (i + 0.5), ph / 2, 0);
      // cut the plank tops to the curve of the arch
      deform(g, (v) => {
        if (v.y > ph - 1e-3) v.y = leafTop(v.x) - rng.range(0, 0.012);
      });
      D.add(MM.timber, g, { color: rng.pick(['#8a7360', '#7f6a58', '#937a63']) });
    }
    // ledges & brace on the (now visible) inner face
    const ledges = [0.25, SPRING_Y - 0.32];
    for (const ly of ledges) D.add(MM.wood, board(leafW - 0.06, 0.13, 0.04, { rng }).translate(leafW / 2, ly, zin * 0.045), { color: WOOD.oak });
    D.add(MM.wood, boardBetween([0.1, ledges[0] + 0.06, zin * 0.045], [leafW - 0.1, ledges[1] - 0.06, zin * 0.045], 0.12, 0.035, { rng, up: [0, 0, 1] }), { color: WOOD.oak });
    // strap hinges on the outer face + a ring pull
    for (const ly of ledges) {
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

  // ── interior: a real tiny bike shop, packed into what the open doors show ──
  // (from the yard the doorway frames the back wall: the workbench with a frame
  // in its jig under a pegboard full of tools, a bike up on a wall hook, tyres
  // on a peg, a parts shelf of jars, a worn rug with the shop cat asleep on it)
  {
    const top = 0.78; // bench top
    const bx = 0.15; // bench centre (x) — the wall-hook bike stands left of it
    const BW = 1.5;
    const zb = -(rIn(0.9) - 0.4);
    // bench top (thick, two boards), legs, stretchers, lower shelf
    for (const dz of [-0.13, 0.13]) F.add(MM.wood, board(BW, 0.07, 0.26, { rng }).translate(bx, top - 0.035, zb + dz), { color: WOOD.oak });
    for (const lx of [-BW / 2 + 0.07, BW / 2 - 0.07]) for (const lz of [-0.2, 0.2]) F.add(MM.wood, board(0.08, top - 0.07, 0.08, { along: 'y', rng }).translate(bx + lx, (top - 0.07) / 2, zb + lz), { color: WOOD.oakLight });
    F.add(MM.wood, board(0.72, 0.04, 0.46, { rng }).translate(bx + 0.34, 0.2, zb), { color: WOOD.oakLight, cast: false });
    // vice on the right end
    const vx = bx + BW / 2 - 0.12;
    F.add(MM.glossy, new THREE.BoxGeometry(0.14, 0.12, 0.18).translate(vx, top + 0.06, zb + 0.2), { color: '#3f5f73', cast: false });
    F.add(MM.metal, rod([vx, top + 0.05, zb + 0.29], [vx, top + 0.05, zb + 0.42], 0.012, 0.012, 6), { color: '#c9cdd0', cast: false });
    F.add(MM.metal, rod([vx - 0.07, top + 0.05, zb + 0.42], [vx + 0.07, top + 0.05, zb + 0.42], 0.008, 0.008, 4), { color: '#c9cdd0', cast: false });

    // the frame jig: a steel rail on the bench, posts with blue clamps holding
    // a half-built steel frame upright (brass fillets at the joints)
    {
      const fs = 0.72;
      const fx = bx - 0.12, fy = top + 0.16 - 0.275 * fs, fz = zb + 0.02;
      const k = makeBareFrame({ batch: F, matrix: mat4([fx, fy, fz]), scale: fs });
      const at = (p) => [fx + p.x, fy + p.y, fz + p.z];
      const bbP = at(k.bb), htP = at(k.htBot), stP = at(k.stTop), rP = at(k.rear);
      F.add(MM.metal, new THREE.BoxGeometry(0.86, 0.045, 0.09).translate(fx + 0.02, top + 0.022, fz), { color: '#5a6066', cast: false });
      const JIG = '#2f6f8f';
      for (const [p, dz] of [[bbP, 0], [htP, 0], [stP, 0], [rP, 0.04]]) {
        F.add(MM.glossy, rod([p[0], top + 0.04, fz + dz], [p[0], p[1] - 0.02, fz + dz], 0.016, 0.014, 6), { color: JIG, cast: false });
        F.add(MM.glossy, new THREE.BoxGeometry(0.06, 0.05, 0.07).translate(p[0], p[1] - 0.01, fz + dz), { color: JIG, cast: false });
        F.add(MM.metal, rod([p[0], p[1] - 0.01, fz + dz + 0.035], [p[0], p[1] - 0.01, fz + dz + 0.09], 0.006, 0.006, 4), { color: '#c9cdd0', cast: false });
      }
      // a brazing torch lying on the bench, hoses down to the gas bottles below
      const tp = [bx + 0.38, top + 0.02, zb + 0.16];
      F.add(MM.metal, rod(tp, [tp[0] + 0.2, tp[1] + 0.01, tp[2] - 0.04], 0.012, 0.008, 6), { color: '#c9a24a', cast: false });
      F.add(MM.vc, tube([[tp[0] - 0.01, tp[1], tp[2]], [tp[0] - 0.12, tp[1] - 0.02, tp[2] + 0.12], [bx - 0.42, 0.62, zb + 0.24], [bx - 0.5, 0.58, zb + 0.06]], 0.008, 4, 14), { color: '#a83a2c', cast: false });
      F.add(MM.vc, tube([[tp[0] - 0.01, tp[1], tp[2] - 0.01], [tp[0] - 0.14, tp[1] - 0.03, tp[2] + 0.1], [bx - 0.3, 0.6, zb + 0.24], [bx - 0.3, 0.58, zb + 0.06]], 0.008, 4, 14), { color: '#2f6a46', cast: false });
      // two gas bottles under the bench (oxygen & acetylene), chained to a leg
      for (const [x, c, h] of [[bx - 0.5, '#2f5f8f', 0.48], [bx - 0.3, '#8a2f2a', 0.44]]) {
        F.add(MM.glossy, new THREE.CylinderGeometry(0.07, 0.07, h, 12, 1, true).translate(x, 0.05 + h / 2, zb + 0.02), { color: c });
        F.add(MM.glossy, new THREE.SphereGeometry(0.07, 12, 4, 0, TAU, 0, Math.PI / 2).translate(x, 0.05 + h, zb + 0.02), { color: c, cast: false });
        F.add(MM.metal, new THREE.CylinderGeometry(0.025, 0.03, 0.06, 8).translate(x, 0.08 + h + 0.04, zb + 0.02), { color: '#c9a24a', cast: false });
      }
    }
    // a little cabinet of parts drawers on the bench's left end (a cabinetmaker's touch)
    {
      const cx = bx - BW / 2 + 0.2, cz = zb - 0.06;
      F.add(MM.wood, board(0.32, 0.27, 0.2, { rng }).translate(cx, top + 0.135, cz), { color: WOOD.walnut });
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const x = cx - 0.1 + c * 0.1, y = top + 0.05 + r * 0.085;
          const out = (r * 3 + c) % 4 === 1 ? 0.03 : 0;
          F.add(MM.wood, board(0.088, 0.072, 0.02, { rng }).translate(x, y, cz + 0.105 + out), { color: rng.pick([WOOD.oakLight, '#c9a77a', WOOD.spruce]), cast: false });
          F.add(MM.metal, new THREE.SphereGeometry(0.008, 5, 3).translate(x, y, cz + 0.12 + out), { color: '#c9a24a', cast: false });
        }
      }
    }
    // on the bench: a mug, a rag, the spoke key that belongs on the pegboard, a box of bearings
    F.add(MM.glossy, new THREE.CylinderGeometry(0.04, 0.035, 0.085, 10).translate(bx + 0.25, top + 0.042, zb - 0.1), { color: '#e9e2d2', cast: false });
    F.add(MM.vc, new THREE.CircleGeometry(0.034, 8).rotateX(-Math.PI / 2).translate(bx + 0.25, top + 0.08, zb - 0.1), { color: '#4a2e1c', cast: false });
    F.add(MM.vc, new THREE.CylinderGeometry(0.045, 0.045, 0.015, 10).translate(bx + 0.5, top + 0.008, zb + 0.15), { color: '#b03a2e', cast: false });
    F.add(MM.vc, new THREE.BoxGeometry(0.14, 0.05, 0.1).translate(bx + 0.02, top + 0.025, zb + 0.17), { color: '#d9c39a', cast: false });
    // under the bench: tyres & a crate
    for (let k = 0; k < 3; k++) F.add(MM.vc, new THREE.TorusGeometry(0.2, 0.035, 5, 18).rotateX(Math.PI / 2).translate(bx + 0.4, 0.26 + k * 0.07, zb), { color: k === 1 ? '#b8925e' : '#2a2622', cast: false });

    // pegboard: a shadow board of tools — every tool has its painted outline,
    // one outline is empty (its spoke key lies on the bench)
    const PZ = -Math.sqrt(rIn(1.4) ** 2 - 0.8 ** 2) + 0.01;
    const PX = bx - 0.05;
    const P0 = 1.0, P1 = 1.8;
    F.add(MM.wood, board(1.6, P1 - P0, 0.025, { rng }).translate(PX, (P0 + P1) / 2, PZ), { color: '#c9a77a', cast: false });
    // battens & a frame around it
    for (const y of [P0 - 0.02, P1 + 0.02]) F.add(MM.wood, board(1.66, 0.04, 0.035, { rng }).translate(PX, y, PZ + 0.005), { color: WOOD.walnut, cast: false });
    for (let i = 0; i < 64; i++) F.add(MM.vc, new THREE.CircleGeometry(0.007, 4).translate(PX - 0.75 + (i % 16) * 0.1, P0 + 0.07 + Math.floor(i / 16) * 0.2, PZ + 0.014), { color: '#6b5236', cast: false });
    const SZ = PZ + 0.0135; // the board's face
    const OUT = '#3a2c22';
    /** A flat tool part w × h at (x, y), rotated a, with its painted outline behind it. */
    const part = (mat, x, y, w, h, color, { a = 0, d = 0.012, outline = true, tool = true } = {}) => {
      if (outline) F.add(MM.vc, new THREE.PlaneGeometry(w + 0.018, h + 0.018).rotateZ(a).translate(x, y, SZ + 0.001), { color: OUT, cast: false });
      if (tool) F.add(mat, new THREE.BoxGeometry(w, h, d).rotateZ(a).translate(x, y, SZ + 0.004 + d / 2), { color, cast: false });
    };
    const ring = (x, y, r, color, outline = true) => {
      if (outline) F.add(MM.vc, new THREE.CircleGeometry(r + 0.012, 8).translate(x, y, SZ + 0.001), { color: OUT, cast: false });
      F.add(MM.metal, new THREE.TorusGeometry(r, r * 0.35, 3, 8).translate(x, y, SZ + 0.01), { color, cast: false });
    };
    const STEEL = '#b9bec2';
    // a graded row of combination wrenches
    for (let i = 0; i < 8; i++) {
      const x = PX - 0.68 + i * 0.062;
      const L = 0.17 + i * 0.013;
      const yt = P1 - 0.1;
      part(MM.metal, x, yt - L / 2, 0.02, L, STEEL);
      ring(x, yt + 0.005, 0.02 + i * 0.001, STEEL, false);
      part(MM.metal, x, yt - L - 0.01, 0.04, 0.03, STEEL);
    }
    // screwdrivers with coloured handles
    const HANDLES = ['#b03a2e', '#d9a441', '#3f5f73', '#2b2b2b', '#4f7a34'];
    for (let i = 0; i < 5; i++) {
      const x = PX - 0.12 + i * 0.07;
      const L = 0.1 + (i % 3) * 0.03;
      part(MM.glossy, x, P1 - 0.12, 0.03, 0.11, HANDLES[i]);
      part(MM.metal, x, P1 - 0.18 - L / 2, 0.008, L, '#c9cdd0', { d: 0.008 });
    }
    // hammer
    part(MM.wood, PX + 0.32, P1 - 0.24, 0.028, 0.26, WOOD.oakLight);
    part(MM.metal, PX + 0.32, P1 - 0.1, 0.13, 0.042, '#3a3a3a', { d: 0.03 });
    // two pairs of pliers (crossed handles)
    for (const [x, c] of [[PX + 0.45, '#b03a2e'], [PX + 0.53, '#3f5f73']]) {
      part(MM.glossy, x - 0.012, P1 - 0.2, 0.018, 0.17, c, { a: 0.12 });
      part(MM.glossy, x + 0.012, P1 - 0.2, 0.018, 0.17, c, { a: -0.12 });
      part(MM.metal, x, P1 - 0.09, 0.022, 0.07, STEEL);
    }
    // tyre levers
    for (let i = 0; i < 3; i++) part(MM.glossy, PX + 0.63 + i * 0.035, P1 - 0.14, 0.018, 0.11, ['#3a7bd5', '#f2c14e', '#3a7bd5'][i]);
    // a Y-wrench, a chain whip and a coil of brake cable on the lower half
    {
      const x = PX + 0.62, y = P0 + 0.22;
      for (const a of [0, 2.09, 4.19]) part(MM.metal, x + Math.sin(a) * 0.045, y + Math.cos(a) * 0.045, 0.02, 0.09, '#d9a441', { a: -a });
    }
    part(MM.wood, PX + 0.38, P0 + 0.2, 0.03, 0.2, '#2b2b2b', { a: 0.5 });
    F.add(MM.metal, new THREE.TorusGeometry(0.07, 0.008, 3, 14, Math.PI * 1.4).rotateZ(-0.2).translate(PX + 0.27, P0 + 0.13, SZ + 0.012), { color: '#4a4744', cast: false });
    F.add(MM.vc, new THREE.TorusGeometry(0.1, 0.012, 4, 18).translate(PX - 0.55, P0 + 0.18, SZ + 0.015), { color: '#2a2622', cast: false });
    F.add(MM.vc, new THREE.TorusGeometry(0.085, 0.01, 4, 18).translate(PX - 0.53, P0 + 0.17, SZ + 0.022), { color: '#2a2622', cast: false });
    // the empty outline of the spoke key (it's on the bench)
    part(MM.metal, PX - 0.12, P0 + 0.2, 0.06, 0.06, STEEL, { a: 0.785, tool: false });
    // a little hacksaw
    part(MM.metal, PX - 0.06, P0 + 0.32, 0.36, 0.014, STEEL);
    part(MM.metal, PX - 0.06, P0 + 0.25, 0.32, 0.006, '#d9dcdf', { outline: false, d: 0.004 });
    part(MM.glossy, PX + 0.15, P0 + 0.28, 0.03, 0.09, '#b03a2e');
    // a shelf of glass jars (screws, bearings, brass nipples) & boxes above it
    {
      const y = P1 + 0.08;
      const z = PZ + 0.11;
      F.add(MM.wood, board(1.3, 0.035, 0.2, { rng }).translate(PX, y, z), { color: WOOD.oak, cast: false });
      for (const x of [-0.5, 0.5]) F.add(MM.wood, board(0.03, 0.12, 0.16, { rng, along: 'y' }).translate(PX + x, y - 0.075, z - 0.01), { color: WOOD.oak, cast: false });
      const FILL = ['#7c8287', '#c9cdd0', '#c9a24a', '#5a5550', '#9aa0a4', '#b07a4a'];
      let x = PX - 0.6;
      while (x < PX + 0.6) {
        if (rng.chance(0.3)) {
          const w = rng.range(0.1, 0.16), h = rng.range(0.06, 0.1);
          F.add(MM.vc, new THREE.BoxGeometry(w, h, 0.12).translate(x + w / 2, y + 0.018 + h / 2, z), { color: rng.pick(['#d9c39a', '#c2a878', '#b03a2e', '#e8dcc0']), cast: false });
          x += w + 0.015;
        } else {
          const r = rng.range(0.035, 0.05), h = rng.range(0.08, 0.12);
          F.add(MM.glossy, new THREE.CylinderGeometry(r, r, h, 8, 1, true).translate(x + r, y + 0.018 + h / 2, z), { color: rng.pick(FILL) });
          F.add(MM.glossy, new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.025, 8).translate(x + r, y + 0.018 + h + 0.012, z), { color: rng.pick(['#b03a2e', '#d9a441', '#3f5f73', '#e9e2d2']), cast: false });
          x += r * 2 + 0.012;
        }
      }
    }

    // a second bike up on a wall hook at the back-left: rear wheel on the floor,
    // front wheel hooked high, parallel to the wall
    {
      const phi = -2.62;
      const rw = rIn(0.6) - 0.27;
      const yaw = Math.atan2(-Math.sin(phi), -Math.cos(phi));
      const bm4 = mat4([Math.sin(phi) * rw, 0.43, Math.cos(phi) * rw], [0, yaw, 1.25, 'YXZ']);
      makeBike({ style: 'road', color: '#3a7a9a', tape: '#2b2b2b', detail: 'lite', batch: F, matrix: bm4, scale: 0.6, seed: 'hooked' });
      const hook = new THREE.Vector3(0.6 - 0.02, 0.34 + 0.33, 0).applyMatrix4(new THREE.Matrix4().makeScale(0.6, 0.6, 0.6)).applyMatrix4(bm4);
      const wallP = [Math.sin(phi) * (rIn(1.0) - 0.01), hook.y + 0.05, Math.cos(phi) * (rIn(1.0) - 0.01)];
      F.add(MM.metal, tube([wallP, [hook.x * 0.6 + wallP[0] * 0.4, hook.y + 0.07, hook.z * 0.6 + wallP[2] * 0.4], [hook.x, hook.y + 0.02, hook.z], [hook.x * 1.02, hook.y - 0.03, hook.z * 1.02]], 0.009, 4, 10), { color: IRON, cast: false });
    }
    // a little poster of the Gotthard pass above it: sky, two peaks with snow, the sun
    {
      const phi = -2.48, y = 1.38;
      const r = rIn(y) - 0.015;
      const PS = F.at(mat4([Math.sin(phi) * r, y, Math.cos(phi) * r], [0, phi + Math.PI, 0]));
      PS.add(MM.wood, board(0.34, 0.26, 0.015, { rng }), { color: WOOD.dark, cast: false });
      PS.add(MM.vc, new THREE.PlaneGeometry(0.3, 0.22).translate(0, 0, 0.009), { color: '#e8c79a', cast: false });
      const peaks = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.15, -0.11, 0.011), new THREE.Vector3(0.0, -0.11, 0.011), new THREE.Vector3(-0.07, 0.05, 0.011),
        new THREE.Vector3(-0.06, -0.11, 0.012), new THREE.Vector3(0.15, -0.11, 0.012), new THREE.Vector3(0.06, 0.09, 0.012),
      ]);
      PS.add(MM.vc, peaks, { color: '#4f6a7a', cast: false });
      const snow = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0.025, 0.035, 0.013), new THREE.Vector3(0.095, 0.035, 0.013), new THREE.Vector3(0.06, 0.09, 0.013),
        new THREE.Vector3(-0.09, 0.015, 0.013), new THREE.Vector3(-0.05, 0.015, 0.013), new THREE.Vector3(-0.07, 0.05, 0.013),
      ]);
      PS.add(MM.vc, snow, { color: '#f4f0e6', cast: false });
      PS.add(MM.vc, new THREE.CircleGeometry(0.03, 8).translate(0.09, 0.05, 0.01), { color: '#e8763a', cast: false });
      PS.add(MM.vc, new THREE.PlaneGeometry(0.3, 0.035).translate(0, -0.09, 0.014), { color: '#b03a2e', cast: false });
    }
    // tyres hanging on a peg at the back-right, above the tool chest
    {
      const phi = 2.56, y = 1.55;
      const r = rIn(y);
      const p = [Math.sin(phi) * r, y, Math.cos(phi) * r];
      const n = [-Math.sin(phi), 0, -Math.cos(phi)];
      F.add(MM.wood, rod([p[0], y, p[2]], [p[0] + n[0] * 0.2, y + 0.03, p[2] + n[2] * 0.2], 0.018, 0.016, 5), { color: WOOD.walnut, cast: false });
      for (let k = 0; k < 3; k++) {
        const d = 0.06 + k * 0.045;
        F.add(MM.vc, xf(new THREE.TorusGeometry(0.21 - k * 0.01, 0.03, 5, 18), [p[0] + n[0] * d, y - 0.2 + k * 0.01, p[2] + n[2] * d], [0.05 * k, phi + Math.PI, 0]), { color: k === 1 ? '#b8925e' : '#2a2622', cast: false });
      }
    }
    // a worn woven rug on the floor, fringed at the ends
    {
      const RM = F.at(mat4([0.0, 0.058, 0.42], [0, 0.14, 0]));
      const L = 1.45, Wd = 0.92;
      const STRIPES = ['#9a3a2c', '#c98a3c', '#e8dcc0', '#3f5a7a', '#c98a3c', '#9a3a2c', '#7a4a2a'];
      const nS = 15;
      const c0 = new THREE.Color(), faded = new THREE.Color('#d8c6a4');
      for (let i = 0; i < nS; i++) {
        const x0 = -L / 2 + (i / nS) * L, x1 = x0 + L / nS;
        const g = new THREE.PlaneGeometry(x1 - x0, Wd, 1, 2).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0, 0);
        const ci = Math.abs(i - (nS - 1) / 2) < 1 ? 3 : i % STRIPES.length;
        c0.set(STRIPES[ci]);
        paintFn(g, STRIPES[ci], (x, y, z, k, c) => c.copy(c0).lerp(faded, 0.38 * (1 - smooth01(Math.hypot(x / 0.5, z / 0.35) - 0.2))));
        RM.add(MM.fabric, g, { cast: false });
      }
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 14; i++) {
          const z = -Wd / 2 + 0.04 + (i / 13) * (Wd - 0.08);
          RM.add(MM.fabric, new THREE.PlaneGeometry(0.06, 0.012).rotateX(-Math.PI / 2).translate(sx * (L / 2 + 0.028), -0.001, z), { color: '#e8dcc0', cast: false });
        }
      }
    }
    // the shop cat, an orange tabby, curled up asleep on the rug
    {
      const C = F.at(mat4([-0.28, 0.06, 0.58], [0, 0.5, 0]));
      const ORANGE = new THREE.Color('#d98b3a'), DARK = new THREE.Color('#a05a22'), WHITE = new THREE.Color('#f1e8d6');
      const tabby = (g, chestAt = null) => paintFn(g, '#d98b3a', (x, y, z, i, c) => {
        c.copy(ORANGE).lerp(DARK, 0.65 * smooth01(Math.sin(x * 46 + z * 12) * 2 - 0.4) * smooth01(y * 18 - 0.3));
        if (chestAt && Math.hypot(x - chestAt[0], y - chestAt[1], z - chestAt[2]) < chestAt[3]) c.copy(WHITE);
      });
      // body: a curled loaf
      const body = new THREE.SphereGeometry(1, 12, 8);
      deform(body, (v) => {
        const bend = v.x * v.x * 0.35;
        v.set(v.x * 0.19, Math.max(v.y, -0.6) * 0.085 + 0.075, v.z * 0.13 + bend * 0.13);
      });
      C.add(MM.vc, tabby(body, [0.13, 0.05, 0.08, 0.06]));
      // head resting on the front paws, ears up
      const head = new THREE.SphereGeometry(0.068, 10, 7).scale(1, 0.82, 0.95).translate(0.15, 0.085, 0.12);
      C.add(MM.vc, tabby(head, [0.19, 0.06, 0.17, 0.035]));
      for (const sz of [-1, 1]) {
        const ear = new THREE.ConeGeometry(0.026, 0.05, 4).rotateZ(sz * 0.25).rotateX(0.2);
        C.add(MM.vc, ear.translate(0.15 + sz * 0.036, 0.15, 0.11), { color: '#c97a30', cast: false });
      }
      // paws & the tail wrapped round the front
      for (const dx of [0.08, 0.14]) C.add(MM.vc, new THREE.SphereGeometry(0.022, 6, 4).scale(1.4, 0.7, 1).translate(dx + 0.06, 0.03, 0.19), { color: '#f1e8d6', cast: false });
      const tail = taperTube([[-0.17, 0.04, 0.04], [-0.15, 0.03, 0.15], [-0.02, 0.025, 0.2], [0.1, 0.03, 0.2]], 0.026, 0.018, 6, 14);
      C.add(MM.vc, tabby(tail));
    }
    // a three-legged stool by the bench
    {
      const T = F.at(mat4([0.42, 0.05, -0.48], [0, 0.4, 0]));
      T.add(MM.wood, new THREE.CylinderGeometry(0.17, 0.17, 0.05, 14).translate(0, 0.5, 0), { color: WOOD.oak });
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU;
        T.add(MM.wood, rod([Math.sin(a) * 0.1, 0.48, Math.cos(a) * 0.1], [Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2], 0.022, 0.02, 6), { color: WOOD.oakLight, cast: false });
      }
    }
    // an anglepoise work lamp clamped to the bench, its warm pool on the jig
    {
      const base = [bx + 0.52, top, zb - 0.12];
      const elbow = [bx + 0.5, top + 0.55, zb + 0.02];
      const head = [bx + 0.22, top + 0.62, zb + 0.32];
      F.add(MM.glossy, new THREE.CylinderGeometry(0.06, 0.07, 0.03, 12).translate(base[0], top + 0.015, base[2]), { color: '#2f5a4f', cast: false });
      F.add(MM.metal, rod(base, elbow, 0.01, 0.01, 4), { color: '#c9cdd0', cast: false });
      F.add(MM.metal, rod(elbow, head, 0.01, 0.01, 4), { color: '#c9cdd0', cast: false });
      F.add(MM.metal, new THREE.SphereGeometry(0.018, 6, 4).translate(...elbow), { color: '#3a3a3a', cast: false });
      const shade = new THREE.ConeGeometry(0.1, 0.13, 12, 1, true).rotateZ(-0.6).translate(head[0] - 0.03, head[1] - 0.06, head[2]);
      F.add(MM.glossy, shade, { color: '#2f5a4f', cast: false });
      F.add(MM.bulb, new THREE.SphereGeometry(0.04, 8, 6).translate(head[0] - 0.06, head[1] - 0.1, head[2]), { cast: false });
      halos.push({ ...toWorld(head[0] - 0.07, head[1] - 0.12, head[2] + 0.02), size: 0.9 });
    }
    // plank wainscot around the lower interior wall (a workshop, not a parlour)
    {
      const n = 56;
      for (let i = 0; i < n; i++) {
        const phi = (i / n) * TAU;
        const r = rIn(0.5) - 0.025;
        const x = Math.sin(phi) * r, z = Math.cos(phi) * r;
        if (z > 0 && Math.abs(x) < OPEN_HALF + 0.12) continue;
        const h = 0.92 + rng.jitter(0.02);
        const g = board((TAU * r) / n - 0.012, h, 0.025, { along: 'y', rng, segs: 1 });
        xf(g, [x, h / 2 + 0.05, z], [0, phi + Math.PI, 0]);
        F.add(MM.wood, g, { color: rng.pick(['#9a7350', '#8f6a48', '#a47a55']), cast: false });
      }
      for (let i = 0; i < 32; i++) {
        const phi = (i / 32) * TAU;
        const r = rIn(1.0) - 0.04;
        const x = Math.sin(phi) * r, z = Math.cos(phi) * r;
        if (z > 0 && Math.abs(x) < OPEN_HALF + 0.12) continue;
        F.add(MM.wood, xf(board((TAU * r) / 32 + 0.01, 0.05, 0.05, { rng }), [x, 1.0, z], [0, phi + Math.PI, 0]), { color: WOOD.walnut, cast: false });
      }
    }
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
      for (const [x, z] of [[-0.26, -0.15], [0.26, -0.15], [-0.26, 0.15], [0.26, 0.15]]) T.add(MM.vc, new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8).rotateZ(Math.PI / 2).translate(x, 0.04, z), { color: '#1f1e1d', cast: false });
      // things on top: a pump head, a coffee tin, a spoke tension meter
      T.add(MM.vc, new THREE.CylinderGeometry(0.04, 0.035, 0.08, 10).translate(-0.18, 0.87, 0.05), { color: '#f1ece2', cast: false });
      T.add(MM.metal, new THREE.BoxGeometry(0.22, 0.03, 0.05).translate(0.1, 0.845, 0.0), { color: '#d9a441', cast: false });
    }
    // tyres leaning against the right wall on the floor
    for (let k = 0; k < 3; k++) {
      const phi = 1.95 + k * 0.16;
      const r = rIn(0.4) - 0.12 - k * 0.04;
      F.add(MM.vc, xf(new THREE.TorusGeometry(0.25, 0.035, 5, 20), [Math.sin(phi) * r, 0.3, Math.cos(phi) * r], [0.12, phi, 0]), { color: k === 1 ? '#b8925e' : '#2a2622', cast: false });
    }
    // wheels on the side walls (seen when the camera swings round)
    for (const [phi, y, st] of [[-1.95, 1.5, 'vintage'], [1.85, 1.45, 'gravel']]) {
      const r = rIn(y) - 0.05;
      const p = [Math.sin(phi) * r, y, Math.cos(phi) * r];
      makeWheel({ style: st, batch: F, matrix: mat4(p, [0, phi, 0]), scale: 0.6, seed: `wall-${phi}`, lite: true });
      F.add(MM.metal, rod([p[0], y + 0.24, p[2]], [p[0] * 1.08, y + 0.24, p[2] * 1.08], 0.012, 0.012, 4), { color: IRON, cast: false });
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
  const capTop = paramSurface((u, v, p) => capPoint(u * TAU, v, p), 80, 36, { uv: (u, v) => [u * 4, 1 - v] });
  {
    // painterly gradient: a sun-bleached orange crown, burnt orange body, deep
    // rust towards the rim — with soft blotches and faint vertical streaks
    const top = new THREE.Color('#e3904a'), mid = new THREE.Color(CAP_COLOR), rim = new THREE.Color('#8e3c1a');
    const pos = capTop.attributes.position;
    const uv = capTop.attributes.uv;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = uv.getY(i); // 0 rim → 1 apex
      const ph = uv.getX(i) * 1.5708;
      c.copy(rim).lerp(mid, smooth01(t * 3.4)).lerp(top, smooth01((t - 0.5) * 1.9));
      c.multiplyScalar(0.92 + 0.1 * noiseA(Math.cos(ph) * 2.2 + t * 2, Math.sin(ph) * 2.2) + 0.04 * noiseB(ph * 9, t * 1.5));
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
  // gills: the underside from the wall top (which doesn't tilt) out to the
  // tilted rim (disc UVs for the lamellae texture) + real lamella fins
  {
    const R0 = wallR(WALL_TOP) - 0.06;
    const y0 = WALL_TOP + 0.04;
    const inner = (phi, out) => out.set(Math.sin(phi) * R0, y0, Math.cos(phi) * R0);
    const outer = (phi, out) => {
      capPoint(phi, 1, out);
      // a little inside and above the rolled rim
      const k = (Math.hypot(out.x, out.z) - 0.07) / Math.hypot(out.x, out.z);
      return out.set(out.x * k, out.y + 0.02, out.z * k);
    };
    const _i = new THREE.Vector3(), _o = new THREE.Vector3();
    const gillAt = (phi, v, out) => {
      inner(phi, _i);
      outer(phi, _o);
      return out.copy(_i).lerp(_o, v).setY(_i.y + (_o.y - _i.y) * v + Math.sin(v * Math.PI) * 0.1);
    };
    const RD = CAP_R + 0.1;
    const gills = paramSurface((u, v, p) => gillAt(u * TAU, v, p), 80, 6, { uv: (u, v, p) => [p.x / (2 * RD) + 0.5, p.z / (2 * RD) + 0.5], flip: true });
    // the underside casts: it closes the cap's shell, so the shadow is solid (not a ring)
    F.add(MM.gills, gills, { color: '#e3cfa8', cast: true });
    // lamellae hanging below the underside, deepest in the middle of their run
    const nF = 110;
    const pos = [], idx = [];
    const p = new THREE.Vector3();
    const NS = 6;
    for (let i = 0; i < nF; i++) {
      const phi = (i / nF) * TAU + rng.jitter(0.008);
      const depth = rng.range(0.13, 0.2);
      const base = pos.length / 3;
      for (let k = 0; k <= NS; k++) {
        const v = 0.04 + (k / NS) * 0.94;
        gillAt(phi, v, p);
        pos.push(p.x, p.y + 0.005, p.z);
        pos.push(p.x, p.y - depth * Math.pow(Math.sin(v * Math.PI), 0.7) * (0.6 + 0.4 * v), p.z);
      }
      for (let k = 0; k < NS; k++) {
        const a = base + k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const fins = new THREE.BufferGeometry();
    fins.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fins.setIndex(idx);
    fins.computeVertexNormals();
    uvPlanar(fins, 'x', 'z', 1 / (2 * RD), [0.5, 0.5]);
    F.add(MM.gills, fins, { color: '#d8c39a', cast: false });
  }
  // spots: cream, softly raised patches following the cap surface — larger
  // round ones on the body, a scatter of freckles towards the rim (none
  // overlapping, a little blue-grey shade at their edges from the vertex tint)
  {
    const p0 = new THREE.Vector3(), pu = new THREE.Vector3(), pv = new THREE.Vector3();
    const placed = [];
    for (let tries = 0; tries < 900 && placed.length < 170; tries++) {
      const v = Math.pow(rng.next(), 0.8) * 0.94 + 0.03;
      const phi = rng.next() * TAU;
      capPoint(phi, v, p0);
      const size = (rng.chance(0.25) ? rng.range(0.11, 0.17) : rng.range(0.045, 0.1)) * (1.1 - v * 0.45);
      if (placed.some((q) => q.p.distanceTo(p0) < (q.s + size) * 1.15)) continue;
      placed.push({ p: p0.clone(), s: size });
      capPoint(phi + 0.01, v, pu).sub(p0);
      capPoint(phi, v + 0.01, pv).sub(p0);
      const nrm = new THREE.Vector3().crossVectors(pv, pu).normalize();
      if (nrm.y < 0) nrm.negate();
      const g = new THREE.SphereGeometry(1, size > 0.09 ? 9 : 6, 3, 0, TAU, 0, Math.PI / 2);
      deform(g, (q) => {
        const k = 1 + 0.18 * noiseA(q.x * 2.5 + size * 97, q.z * 2.5 + placed.length);
        q.set(q.x * k, q.y, q.z * k);
      });
      g.scale(size, size * 0.22, size * rng.range(0.7, 1));
      g.translate(0, -size * 0.06, 0);
      g.rotateY(rng.next() * TAU);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm));
      g.translate(p0.x, p0.y, p0.z);
      F.add(MM.vc, g, { color: rng.pick(['#f2e9d6', '#efe3c9', '#f6efe0', '#ece0c4']), cast: false });
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

  // a weathervane on the cap's tip: an iron arrow and a tiny bicycle riding the
  // wind. The mast merges into the shop; the turning part is ONE iron mesh.
  {
    const tip = capPoint(0, 0);
    const vm = mat4([tip.x, tip.y + 0.02, tip.z], [0, 0.6, 0]);
    const V = F.at(vm);
    V.add(MM.metal, rod([0, -0.05, 0], [0, 0.75, 0], 0.016, 0.012, 6), { color: IRON });
    V.add(MM.metal, new THREE.SphereGeometry(0.035, 8, 6).translate(0, 0.42, 0), { color: '#b8892e' });
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) V.add(MM.metal, rod([0, 0.3, 0], [dx * 0.16, 0.3, dz * 0.16], 0.006, 0.006, 3), { color: IRON });
    const spin = new THREE.Group();
    spin.position.set(tip.x, tip.y + 0.02 + 0.62, tip.z);
    spin.rotation.y = 0.6;
    group.add(spin);
    const VS = new Batch('vane-spin');
    // every part of the turning vane (the tiny bike too) in one iron material
    const ironOnly = (mx = new THREE.Matrix4()) => ({
      add: (m, g) => {
        g.applyMatrix4(mx);
        return VS.add(MM.metal, g, { color: '#3a3530', cast: false });
      },
      at: (child) => ironOnly(mx.clone().multiply(child)),
    });
    const I = ironOnly();
    I.add(null, rod([-0.3, 0, 0], [0.3, 0, 0], 0.008, 0.008, 4));
    I.add(null, new THREE.ConeGeometry(0.035, 0.09, 4).rotateZ(-Math.PI / 2).translate(0.33, 0, 0));
    I.add(null, new THREE.BoxGeometry(0.01, 0.1, 0.12).translate(-0.3, 0, 0));
    makeBike({ style: 'road', batch: I, matrix: mat4([-0.08, 0.01, 0], [0, 0, 0]), scale: 0.22, lite: true, seed: 'vane' });
    VS.build(spin, 'vane');
    updates.push((dt, t) => {
      spin.rotation.y = 0.6 + 0.4 + Math.sin(t * 0.23) * 0.5 + Math.sin(t * 0.71) * 0.15;
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
  const hero = makeBike({ style: 'gravel', spin: true, spinFront: false, seed: 'hero', scale: 0.8, color: '#2e6a66', tape: '#6b4a2e' });
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
    mechanic = ctx.props.makePerson({ seed: 'velo-mechanic', name: 'Mechanic', holding: 'wrench', action: 'work', apron: true, apronColor: '#3f5f73', hat: 'bandana', hatColor: '#b03a2e', hair: 'curly', shirt: '#e8a838', beard: true });
    // at the front of the bike, turned three-quarters to the yard, wrench at the bars
    const mp = new THREE.Vector3(-0.56, 0, 3.3);
    mechanic.group.position.copy(mp);
    mechanic.group.rotation.y = -0.78;
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
    T.add(MM.wood, stump, { color: '#6e5643' });
    T.add(MM.vc, new THREE.CylinderGeometry(0.33, 0.33, 0.01, 18).translate(0, top + 0.002, 0), { color: '#a88a64', cast: false });
    for (let k = 1; k <= 3; k++) T.add(MM.vc, new THREE.TorusGeometry(0.08 * k, 0.004, 3, 24).rotateX(Math.PI / 2).translate(0.01, top + 0.008, -0.01), { color: '#8a6e4e', cast: false });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.5;
      T.add(MM.wood, rod([Math.sin(a) * 0.2, top - 0.12, Math.cos(a) * 0.2], [Math.sin(a) * 0.33, 0, Math.cos(a) * 0.33], 0.035, 0.03, 6), { color: '#7d6550' });
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

  // a bench against the wall under the wheels on their pegs: a thick oak
  // plank on two log-round legs, a coffee mug and a rag on it
  {
    const phi = 0.98;
    const r = wallR(0.3) + 0.32;
    const S = F.at(mat4([Math.sin(phi) * r, 0, Math.cos(phi) * r], [0, phi, 0]));
    const seat = board(1.05, 0.07, 0.3, { rng, c: 0.012 });
    deform(seat, (v) => {
      v.y -= Math.cos((v.x / 1.05) * Math.PI) * 0.008;
    });
    S.add(MM.wood, seat.translate(0, 0.42, 0), { color: '#9a7a55' });
    for (const lx of [-0.38, 0.38]) {
      S.add(MM.wood, new THREE.CylinderGeometry(0.11, 0.13, 0.39, 10).translate(lx, 0.195, 0), { color: '#7a5f45' });
      S.add(MM.vc, new THREE.CircleGeometry(0.105, 12).rotateX(-Math.PI / 2).translate(lx, 0.392, 0), { color: '#cfae80', cast: false });
    }
    S.add(MM.glossy, new THREE.CylinderGeometry(0.045, 0.04, 0.09, 12).translate(0.25, 0.505, 0.02), { color: '#e9e2d2', cast: false });
    S.add(MM.vc, new THREE.TorusGeometry(0.025, 0.008, 4, 10).translate(0.3, 0.51, 0.02), { color: '#e9e2d2', cast: false });
    S.add(MM.vc, new THREE.CircleGeometry(0.038, 10).rotateX(-Math.PI / 2).translate(0.25, 0.545, 0.02), { color: '#4a2e1c', cast: false });
    const rag = new THREE.PlaneGeometry(0.28, 0.2, 4, 3).rotateX(-Math.PI / 2);
    deform(rag, (v) => {
      v.y += noiseA(v.x * 9, v.z * 9) * 0.012 + (Math.abs(v.z) > 0.08 ? -0.02 : 0);
    });
    S.add(MM.vc, rag.translate(-0.2, 0.47, 0.03), { color: '#b8483a', cast: false });
  }
  // flower pots and a watering can by the right jamb, under a lantern hanging from the cap
  {
    for (const [x, z, s, col] of [[1.42, 2.06, 1, '#f29bb8'], [1.66, 1.86, 0.8, '#f2c14e'], [1.3, 2.32, 0.7, '#f4f0e6']]) {
      const pot = new THREE.CylinderGeometry(0.14 * s, 0.1 * s, 0.22 * s, 12, 1).translate(x, 0.11 * s, z);
      F.add(MM.vc, pot, { color: '#c06a42' });
      F.add(MM.vc, new THREE.TorusGeometry(0.14 * s, 0.022 * s, 4, 14).rotateX(Math.PI / 2).translate(x, 0.215 * s, z), { color: '#b55f3a', cast: false });
      F.add(MM.soil, new THREE.CircleGeometry(0.125 * s, 12).rotateX(-Math.PI / 2).translate(x, 0.2 * s, z), { color: '#5a4430', cast: false });
      plantFern(F, rng, x, 0.2 * s, z, { size: 0.28 * s, fronds: 7, tilt: 0.9 });
      for (let f = 0; f < 4; f++) addFlower(F, rng, x + rng.jitter(0.07 * s), 0.2 * s, z + rng.jitter(0.07 * s), { color: col, size: 0.05, stem: 0.2 * s });
    }
    const wc = F.at(mat4([1.88, 0, 2.2], [0, -0.6, 0]));
    wc.add(MM.metal, new THREE.CylinderGeometry(0.1, 0.11, 0.2, 12).translate(0, 0.1, 0), { color: '#5f7f6a' });
    wc.add(MM.metal, rod([0.08, 0.08, 0], [0.26, 0.24, 0], 0.014, 0.01, 5), { color: '#5f7f6a', cast: false });
    wc.add(MM.metal, new THREE.TorusGeometry(0.08, 0.01, 4, 12, Math.PI).translate(-0.02, 0.2, 0), { color: '#5f7f6a', cast: false });
    // the lantern hangs on a chain from the gills, lighting the doorway at night
    const lp = capPoint(0.62, 1);
    const lx = lp.x * 0.84, lz = lp.z * 0.84, ly = 2.38;
    F.add(MM.metal, rod([lx, lp.y + 0.25, lz], [lx, ly + 0.27, lz], 0.006, 0.006, 3), { color: IRON, cast: false });
    for (const [g, m, c] of [
      [new THREE.TorusGeometry(0.03, 0.007, 4, 10).translate(0, 0.27, 0), MM.metal, IRON],
      [new THREE.ConeGeometry(0.13, 0.1, 6, 1).translate(0, 0.21, 0), MM.metal, IRON],
      [new THREE.CylinderGeometry(0.075, 0.065, 0.18, 6, 1).translate(0, 0.07, 0), MM.lamp, null],
      [new THREE.CylinderGeometry(0.09, 0.08, 0.03, 6, 1).translate(0, -0.035, 0), MM.metal, IRON],
    ]) F.add(m, g.translate(lx, ly, lz), { color: c, cast: false });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      F.add(MM.metal, new THREE.BoxGeometry(0.014, 0.18, 0.014).translate(lx + Math.sin(a) * 0.075, ly + 0.07, lz + Math.cos(a) * 0.075), { color: IRON, cast: false });
    }
    halos.push({ ...toWorld(lx, ly + 0.07, lz), size: 0.8 });
  }

  // the front-right of the yard: a short split-rail fence with a customer's
  // road bike and a little kid's bike leaning on it, a chalkboard, grass & flowers
  {
    const fz = 3.3;
    const posts = [2.1, 3.0, 3.9];
    for (const px of posts) {
      const h = 0.62 + rng.jitter(0.04);
      F.add(MM.timber, rod([px + rng.jitter(0.02), -0.15, fz], [px + rng.jitter(0.03), h, fz + rng.jitter(0.02)], 0.055, 0.045, 7), { color: '#8d8274' });
      F.add(MM.timber, new THREE.ConeGeometry(0.058, 0.08, 7).translate(px, h + 0.04, fz), { color: '#8d8274', cast: false });
    }
    for (const ry of [0.24, 0.5]) {
      F.add(MM.timber, boardBetween([posts[0] - 0.12, ry + rng.jitter(0.02), fz - 0.05], [posts[2] + 0.14, ry + rng.jitter(0.03), fz - 0.05], 0.06, 0.07, { rng, bow: 0.02 }), { color: '#9a8a76' });
    }
    // moss on the rails, grass at the posts
    for (const px of posts) {
      plantGrass(F, rng, px + 0.06, 0, fz + 0.05, { size: 0.32, blades: 5 });
      if (rng.chance(0.6)) addToadstool(F, rng, px - 0.1, 0, fz + 0.1, { size: 0.08 });
    }
    // the bikes lean back against the top rail
    const road = { style: 'road', color: '#b0392c', tape: '#f1ece2', lite: true, seed: 'customer', scale: 0.62 };
    makeBike({ ...road, batch: F, matrix: new THREE.Matrix4().makeTranslation(2.62, 0, fz + 0.2).multiply(new THREE.Matrix4().makeRotationX(-0.16)) });
    makeBike({ style: 'vintage', color: '#f2c14e', basket: false, lite: true, seed: 'kid', scale: 0.42, batch: F, matrix: new THREE.Matrix4().makeTranslation(3.62, 0, fz + 0.16).multiply(new THREE.Matrix4().makeRotationX(-0.2)) });
    // a little chalkboard on an A-frame: "Velo-Service · offen"
    try {
      const tex = ctx.props.makeTextTexture(['Velo-Service', 'heute offen!'], { width: 384, height: 256, background: '#27322c', color: '#f1eee4', font: '"Patrick Hand", "Comic Sans MS", cursive', weight: 400, style: 'plain', padding: 0.14 });
      const cm = mat4([1.05, 0, 4.15], [0, 0.35, 0]);
      // (a clone of the shared matte material with the chalk texture — passing the
      // texture through the material cache would serialise it into the cache key)
      const chalkMat = ctx.materials.standard('#ffffff', { roughness: 0.95 }).clone();
      chalkMat.map = tex;
      const chalk = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.31), chalkMat);
      const cw = frame.clone().multiply(cm);
      chalk.position.set(0, 0.4, 0.052).applyMatrix4(cw);
      chalk.quaternion.setFromRotationMatrix(cw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.28));
      chalk.castShadow = false;
      chalk.name = 'velowerkstatt-chalkboard';
      ctx.scene.add(chalk);
      const C = F.at(cm);
      for (const sx of [-1, 1]) {
        C.add(MM.wood, boardBetween([sx * 0.25, 0, 0.12], [sx * 0.25, 0.62, -0.02], 0.035, 0.03, { rng }), { color: WOOD.oak });
        C.add(MM.wood, boardBetween([sx * 0.25, 0, -0.26], [sx * 0.25, 0.6, -0.04], 0.035, 0.03, { rng }), { color: WOOD.oak, cast: false });
      }
      C.add(MM.wood, board(0.56, 0.04, 0.03, { rng }).translate(0, 0.6, -0.03), { color: WOOD.oak, cast: false });
      C.add(MM.wood, board(0.52, 0.36, 0.02, { rng }).rotateX(-0.28).translate(0, 0.4, 0.035), { color: '#4a3a2a' });
    } catch (err) {
      console.warn('[riverside] chalkboard skipped', err);
    }
    // grass tufts, clover & flowers fill the yard's edges (never the apron or the paths)
    for (let i = 0; i < 46; i++) {
      const x = rng.range(-3.6, 4.2), z = rng.range(0.5, 4.8);
      if (Math.hypot(x, z) < wallR(0) + 0.5) continue;
      if (Math.abs(x) < 1.6 && z > 1.6 && z < 4.0) continue; // the apron & the door
      if (x < -0.6 && z > 2.3 && z < 4.3) continue; // the repair stand
      if (x > 1.4 && x < 2.6 && z > 2.6 && z < 3.5) continue; // the truing stand
      const wp = toWorld(x, 0, z);
      if (getPathDistance(wp.x, wp.z) < 1.2 || isInWater(wp.x, wp.z, 0.3)) continue;
      const gy = getHeight(wp.x, wp.z);
      const k = rng.next();
      if (k < 0.5) plantGrass(F, rng, x, gy, z, { size: rng.range(0.22, 0.4), blades: rng.int(3, 5) });
      else if (k < 0.8) for (let f = 0; f < 3; f++) addFlower(F, rng, x + rng.jitter(0.15), gy, z + rng.jitter(0.15), { size: 0.045, stem: 0.14 });
      else plantFern(F, rng, x, gy, z, { size: rng.range(0.35, 0.6), fronds: 7 });
    }
  }

  // a hanging sign on a bracket left of the doors
  let sign = null;
  try {
    sign = ctx.props.makeSign({ text: 'Velowerkstatt', style: 'hanging', bracket: false, width: 1.25, wood: 'oak', seed: 'velowerkstatt' });
    const phi = -1.32, y = 2.62;
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
