// ─────────────────────────────────────────────────────────────────────────────
// Village decor — small charming props for every district. Each builder
// returns a THREE.Group with the origin on the ground and the front facing +Z.
// Static parts are merged per material (1–3 draw calls per prop) and cached per
// variant (seed / size), so many instances are cheap. Animated bits (bunting,
// swinging lanterns) register themselves in the props ticker.
//
// Lights:    makeLantern, makeLampPost, makeGlowSprite, makeStringLights
// Fences:    makeFence(points, { style: 'picket' | 'rail' })
// Furniture: makeBench, makeTable, makeChair
// Storage:   makeBarrel, makeCrate, makeLogPile, makeParcel, makeWheelbarrow
// Nature:    makeRock, makeStump, makeBush, makeFlowerPatch, makeSmallMushroom, makeMushroomCluster,
//            makePottedPlant, makeFlowerBox
// Village:   makeMailbox, makeWell, makeBunting(points), makeStoneCircle(radius), makeSteppingStones(points)
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { materials } from '../core/materials.js';
import { palette } from '../core/palette.js';
import { createRng } from '../core/rng.js';
import { createNoise2D } from '../core/noise.js';
import { Parts, cached, xf, strut, grainUV, groupFor, shade, mix, opt, blob, paintFn, deform, revolve, sagCurve, noRaycast, smooth } from './util.js';
import { addFlower, addTuft, addFlowerBox, addTinyMushroom, addStone, FLOWER_COLORS } from './bits.js';
import { glowQuads, makeGlowSprite } from './glow.js';
import { registerAnimated, propsSettings } from './ticker.js';

export { makeLantern, makeLampPost } from './lantern.js';
export { makeGlowSprite };

const IRON = '#4a4038';
const wood = (w) => palette[w] || w;
const seedOf = (opts, def) => String(opts.seed ?? def);

/** Concentric growth rings on a disc (end grain). Disc lies in XZ facing +Y. */
function ringDisc(radius, color, { rings = 5, seg = 14, y = 0 } = {}) {
  const pos = [0, y, 0];
  const col = [];
  const cLight = new THREE.Color(mix(color, '#fff3d6', 0.35));
  const cDark = new THREE.Color(shade(color, -0.08));
  const cBark = new THREE.Color(palette.barkDark);
  col.push(cLight.r * 0.95, cLight.g * 0.9, cLight.b * 0.85);
  const idx = [];
  for (let r = 1; r <= rings; r++) {
    const rr = (r / rings) * radius;
    const c = r === rings ? cBark : r % 2 ? cDark : cLight;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const wob = 1 + Math.sin(a * 3 + r) * 0.03;
      pos.push(Math.sin(a) * rr * wob, y, Math.cos(a) * rr * wob);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < seg; j++) idx.push(0, 1 + j, 1 + ((j + 1) % seg));
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * seg, b0 = 1 + r * seg;
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      idx.push(a0 + j, b0 + j, b0 + j1, a0 + j, b0 + j1, a0 + j1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // ensure it faces up
  if (g.attributes.normal.getY(0) < 0) {
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i += 3) [ia[i + 1], ia[i + 2]] = [ia[i + 2], ia[i + 1]];
    g.computeVertexNormals();
  }
  return g;
}

/** A log lying along X with bark sides and ringed end grain. */
function addLog(P, { x = 0, y = 0, z = 0, len = 1.2, r = 0.15, rotY = 0, rotZ = 0, rng, layer = 'paint' }) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, rotZ)), new THREE.Vector3(1, 1, 1));
  const side = new THREE.CylinderGeometry(r, r * 1.03, len, 9, 1, true);
  side.rotateZ(Math.PI / 2);
  paintFn(side, (px, py, pz, nx, ny, nz, i, c) => c.set(Math.sin(Math.atan2(py, pz) * 9 + px * 3) > 0.7 ? palette.barkDark : palette.bark));
  P.add(layer, side.applyMatrix4(m));
  for (const s of [-1, 1]) {
    const end = ringDisc(r * (s > 0 ? 1 : 1.03), palette.oak, { rings: 4, seg: 9 });
    end.rotateZ(-s * Math.PI / 2);
    end.translate(s * len / 2, 0, 0);
    P.add(layer, end.applyMatrix4(m));
  }
  void rng;
}

// ─── fences ──────────────────────────────────────────────────────────────────
/**
 * Fence along local XZ points [{x, z}, …].
 * opts: { style: 'picket' | 'rail', height = 0.75 (picket) / 0.8 (rail), color (post wood), paint (picket colour),
 *         heightAt(x, z) (follow uneven ground), closed = false, seed }
 */
export function makeFence(points = [], opts = {}) {
  const style = opt(opts, 'style', 'picket');
  const h = opt(opts, 'height', style === 'picket' ? 0.75 : 0.8);
  const postC = wood(opt(opts, 'color', style === 'picket' ? 'spruce' : 'walnut'));
  const paintC = opts.paint ?? (style === 'picket' ? '#f3ead8' : postC);
  const hAt = opts.heightAt ?? (() => 0);
  const rng = createRng(seedOf(opts, 'fence'));
  const pts = points.slice();
  if (opts.closed && pts.length > 2) pts.push(pts[0]);
  const P = new Parts();
  const post = (x, z) => {
    const y = hAt(x, z);
    if (style === 'picket') {
      P.add('wood', grainUV(new THREE.BoxGeometry(0.1, h + 0.08, 0.1), 'y').translate(x, y + (h + 0.08) / 2 - 0.04, z), postC);
      P.add('wood', new THREE.ConeGeometry(0.085, 0.09, 4).rotateY(Math.PI / 4).translate(x, y + h + 0.08, z), shade(postC, -0.05));
    } else {
      P.add('wood', grainUV(new THREE.CylinderGeometry(0.06, 0.07, h + 0.12, 7), 'y').translate(x, y + (h + 0.12) / 2 - 0.05, z), postC);
      P.add('wood', ringDisc(0.06, palette.oak, { rings: 3, seg: 7 }).translate(x, y + h + 0.07, z), null);
    }
  };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    if (!(opts.closed && i === pts.length - 1)) post(a.x, a.z);
    if (i === pts.length - 1) break;
    const b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const ry = Math.atan2(dx, dz);
    const ya = hAt(a.x, a.z), yb = hAt(b.x, b.z);
    const slope = Math.atan2(yb - ya, len);
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, my = (ya + yb) / 2;
    if (style === 'picket') {
      for (const ry2 of [0.28, 0.68]) {
        const rail = grainUV(new THREE.BoxGeometry(0.035, 0.07, len), 'z');
        xf(rail, [mx, my + h * ry2, mz], [-slope, ry, 0, 'YXZ']);
        P.add('wood', rail, shade(postC, -0.03));
      }
      const n = Math.max(1, Math.floor(len / 0.19));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const x = a.x + dx * t, z = a.z + dz * t;
        const y = hAt(x, z);
        const ph = h * (0.92 + Math.sin(k * 1.7 + i) * 0.04) - 0.06;
        const picket = grainUV(new THREE.BoxGeometry(0.085, ph, 0.025), 'y');
        picket.translate(0, ph / 2, 0);
        const tip = new THREE.ConeGeometry(0.06, 0.08, 4, 1);
        tip.rotateY(Math.PI / 4);
        tip.scale(1, 1, 0.3);
        tip.translate(0, ph + 0.04, 0);
        for (const g of [picket, tip]) {
          xf(g, [x + Math.cos(ry) * 0.035, y, z - Math.sin(ry) * 0.035], [rng.jitter(0.03), ry + Math.PI / 2, rng.jitter(0.04)]);
          P.add('wood', g, k % 5 === 3 ? shade(paintC, -0.04) : paintC);
        }
      }
    } else {
      // rustic split rails, slightly sagging and crossing
      for (const [ry2, sag] of [[0.35, 0.03], [0.72, 0.02]]) {
        const ext = 0.12;
        const rail = new THREE.CylinderGeometry(0.045, 0.05, len + ext * 2, 6);
        rail.rotateX(Math.PI / 2);
        deform(rail, (v) => {
          const t = v.z / (len + ext * 2) + 0.5;
          v.y -= Math.sin(t * Math.PI) * sag;
        });
        grainUV(rail, 'z');
        xf(rail, [mx, my + h * ry2 + rng.jitter(0.02), mz], [-slope, ry, rng.jitter(0.1), 'YXZ']);
        P.add('wood', rail, shade(postC, rng.jitter(0.04) + 0.06));
      }
    }
  }
  const g = groupFor(P.finish(), { name: 'fence' });
  g.name = 'fence';
  return g;
}

// ─── furniture ───────────────────────────────────────────────────────────────
/**
 * Park bench with slatted seat & back and through-tenoned legs (a Schreiner would approve).
 * opts: { length = 1.6, wood = 'oak', style: 'park' | 'log', seed }
 * userData.seats: local hip points (Vector3) for villagers sitting (face +Z).
 */
export function makeBench(opts = {}) {
  const L = opt(opts, 'length', 1.6);
  const w = wood(opt(opts, 'wood', 'oak'));
  const style = opt(opts, 'style', 'park');
  const seatY = 0.34;
  const geos = cached(`bench|${L}|${w}|${style}`, () => {
    const P = new Parts();
    if (style === 'log') {
      // a thick slab with bark edges on two stumps
      const slab = new THREE.BoxGeometry(L, 0.09, 0.38, 6, 1, 2);
      deform(slab, (v) => {
        if (Math.abs(v.z) > 0.15) v.y -= 0.02;
      });
      slab.computeVertexNormals();
      paintFn(slab, (x, y, z, nx, ny, nz, i, c) => c.set(ny > 0.8 ? mix(palette.oak, '#fff3d6', 0.15) : Math.sin(x * 23) > 0.2 ? palette.barkDark : palette.bark));
      P.add('wood', grainUV(slab.translate(0, seatY - 0.045, 0), 'x'));
      for (const sx of [-1, 1]) {
        const st = revolve([[0.0, seatY - 0.09], [0.13, seatY - 0.09], [0.14, seatY * 0.5], [0.17, 0.04], [0.2, -0.02]], 9);
        paintFn(st, (x, y, z, nx, ny, nz, i, c) => c.set(ny > 0.9 ? palette.oak : Math.sin(Math.atan2(x, z) * 9) > 0.3 ? palette.barkDark : palette.bark));
        P.add('paint', st.translate(sx * (L / 2 - 0.28), 0, 0));
      }
      return P.finish();
    }
    const legX = L / 2 - 0.16;
    for (const sx of [-1, 1]) {
      const x = sx * legX;
      // front & back legs (back leg continues up as the back support, slightly raked)
      P.add('wood', grainUV(new THREE.BoxGeometry(0.07, seatY, 0.07), 'y').translate(x, seatY / 2, 0.16), w);
      const back = grainUV(new THREE.BoxGeometry(0.07, seatY + 0.42, 0.07), 'y');
      back.translate(0, (seatY + 0.42) / 2, 0);
      xf(back, [x, 0, -0.17], [-0.12, 0, 0]);
      P.add('wood', back, w);
      // side rail with through-tenons poking out + wedges
      P.add('wood', grainUV(new THREE.BoxGeometry(0.05, 0.07, 0.48), 'z').translate(x, seatY - 0.08, 0), shade(w, -0.04));
      P.add('wood', grainUV(new THREE.BoxGeometry(0.045, 0.05, 0.04), 'z').translate(x, seatY - 0.08, 0.215), shade(w, 0.06));
      P.add('detail', new THREE.BoxGeometry(0.008, 0.052, 0.042).translate(x, seatY - 0.08, 0.237), palette.walnut);
      // stretcher low between legs
      P.add('wood', grainUV(new THREE.BoxGeometry(0.04, 0.045, 0.34), 'z').translate(x, 0.08, 0), shade(w, -0.04));
      // armrest
      const arm = grainUV(new THREE.BoxGeometry(0.08, 0.04, 0.46), 'z');
      P.add('wood', arm.translate(x, seatY + 0.2, -0.01), shade(w, 0.03));
      P.add('wood', grainUV(new THREE.BoxGeometry(0.05, 0.2, 0.05), 'y').translate(x, seatY + 0.1, 0.16), w);
    }
    // seat slats
    for (let i = 0; i < 4; i++) {
      const slat = new THREE.BoxGeometry(L, 0.035, 0.095);
      grainUV(slat, 'x', 0.55, i * 0.37);
      P.add('wood', slat.translate(0, seatY + 0.01, 0.17 - i * 0.11), i % 2 ? w : shade(w, 0.03));
    }
    // back slats
    for (let i = 0; i < 2; i++) {
      const slat = new THREE.BoxGeometry(L - 0.02, 0.09, 0.03);
      grainUV(slat, 'x', 0.55, i * 0.5);
      xf(slat, [0, seatY + 0.2 + i * 0.15, -0.2 - (0.2 + i * 0.15) * 0.12], [-0.12, 0, 0]);
      P.add('wood', slat, i % 2 ? w : shade(w, 0.03));
    }
    // a long rail under the seat
    P.add('wood', grainUV(new THREE.BoxGeometry(L - 0.3, 0.06, 0.04), 'x').translate(0, seatY - 0.1, -0.12), shade(w, -0.06));
    return P.finish();
  });
  const g = groupFor(geos, { name: 'bench' });
  g.name = 'bench';
  const n = Math.max(1, Math.round(L / 0.62));
  g.userData.seats = [];
  for (let i = 0; i < n; i++) g.userData.seats.push(new THREE.Vector3((i - (n - 1) / 2) * (L / n), seatY + 0.03, 0.03));
  g.userData.seatHeight = seatY + 0.03;
  return g;
}

/**
 * Outdoor village table. opts: { style: 'round' | 'plank' | 'picnic', wood = 'oak', size = 1, cloth (colour) }
 * userData.topY = height of the table top.
 */
export function makeTable(opts = {}) {
  const style = opt(opts, 'style', 'round');
  const w = wood(opt(opts, 'wood', 'oak'));
  const size = opt(opts, 'size', 1);
  const cloth = opts.cloth ?? null;
  const topY = 0.46;
  const geos = cached(`table|${style}|${w}|${size}|${cloth}`, () => {
    const P = new Parts();
    if (style === 'round') {
      const r = 0.5 * size;
      P.add('wood', grainUV(new THREE.CylinderGeometry(r, r, 0.05, 20), 'x').translate(0, topY - 0.025, 0), w);
      P.add('wood', new THREE.CylinderGeometry(r * 0.94, r * 0.9, 0.04, 20).translate(0, topY - 0.07, 0), shade(w, -0.08));
      P.add('wood', grainUV(new THREE.CylinderGeometry(0.06, 0.08, topY - 0.08, 8), 'y').translate(0, (topY - 0.08) / 2, 0), shade(w, -0.04));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const foot = grainUV(new THREE.BoxGeometry(0.05, 0.05, 0.32), 'z');
        foot.translate(0, 0.025, 0.14);
        P.add('wood', foot.rotateY(a), shade(w, -0.04));
      }
      if (cloth) {
        const c = new THREE.CylinderGeometry(r * 1.02, r * 1.12, 0.14, 20, 1, true);
        paintFn(c, (x, y, z, nx, ny, nz, i, col) => col.set(Math.sin(Math.atan2(x, z) * 10) > 0 ? cloth : palette.paper));
        P.add('detail', c.translate(0, topY - 0.06, 0));
        P.add('detail', new THREE.CircleGeometry(r * 1.02, 20).rotateX(-Math.PI / 2).translate(0, topY + 0.004, 0), palette.paper);
      }
    } else {
      // plank / picnic table: planked top on trestle legs (picnic adds benches)
      const L = 1.5 * size, D = 0.7;
      for (let i = 0; i < 4; i++) {
        const plank = new THREE.BoxGeometry(L, 0.045, D / 4 - 0.012);
        grainUV(plank, 'x', 0.55, i * 0.41);
        P.add('wood', plank.translate(0, topY - 0.0225, -D / 2 + (i + 0.5) * (D / 4)), i % 2 ? w : shade(w, 0.03));
      }
      for (const sx of [-1, 1]) {
        const x = sx * (L / 2 - 0.2);
        P.add('wood', grainUV(new THREE.BoxGeometry(0.06, 0.05, D - 0.06), 'z').translate(x, topY - 0.07, 0), shade(w, -0.06));
        for (const s of [-1, 1]) {
          const leg = grainUV(new THREE.BoxGeometry(0.06, topY + 0.02, 0.06), 'y');
          leg.translate(0, (topY - 0.06) / 2, 0);
          xf(leg, [x, 0, s * 0.12], [s * 0.3, 0, 0]);
          P.add('wood', leg, w);
        }
        if (style === 'picnic') {
          for (const s of [-1, 1]) {
            P.add('wood', grainUV(new THREE.BoxGeometry(0.05, 0.05, 1.3), 'z').translate(x, 0.2, 0), shade(w, -0.06));
            const seat = grainUV(new THREE.BoxGeometry(L, 0.04, 0.24), 'x');
            P.add('wood', seat.translate(0, 0.26, s * 0.55), shade(w, 0.02));
          }
        }
      }
      P.add('wood', grainUV(new THREE.BoxGeometry(L - 0.4, 0.05, 0.05), 'x').translate(0, 0.14, 0), shade(w, -0.06));
      if (cloth) {
        const runner = new THREE.BoxGeometry(L * 0.3, 0.008, D + 0.12);
        paintFn(runner, (x, y, z, nx, ny, nz, i, col) => col.set(Math.sin(z * 30) > 0 ? cloth : palette.paper));
        P.add('detail', runner.translate(0, topY + 0.004, 0));
      }
    }
    return P.finish();
  });
  const g = groupFor(geos, { name: 'table' });
  g.name = 'table';
  g.userData.topY = topY;
  return g;
}

/**
 * Little wooden chair (villager scale). opts: { wood = 'oak', cushion (colour), seed }
 * userData.seat: local hip point (place a sitting person's group there).
 */
export function makeChair(opts = {}) {
  const w = wood(opt(opts, 'wood', 'oak'));
  const cushion = opts.cushion ?? null;
  const seatY = 0.3;
  const geos = cached(`chair|${w}|${cushion}`, () => {
    const P = new Parts();
    const s = 0.36;
    P.add('wood', grainUV(new THREE.BoxGeometry(s, 0.04, s), 'x').translate(0, seatY, 0), w);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const tall = z < 0;
      const hh = tall ? seatY + 0.42 : seatY;
      const leg = grainUV(new THREE.BoxGeometry(0.045, hh, 0.045), 'y');
      leg.translate(x * (s / 2 - 0.03), hh / 2, z * (s / 2 - 0.03));
      P.add('wood', leg, shade(w, -0.04));
    }
    // back: two rails with a heart cut-out panel (well, a heart-shaped plaque)
    P.add('wood', grainUV(new THREE.BoxGeometry(s, 0.06, 0.03), 'x').translate(0, seatY + 0.38, -s / 2 + 0.03), w);
    P.add('wood', grainUV(new THREE.BoxGeometry(s, 0.05, 0.03), 'x').translate(0, seatY + 0.18, -s / 2 + 0.03), w);
    const heart = new THREE.Shape();
    heart.moveTo(0, -0.05);
    heart.bezierCurveTo(-0.08, 0.0, -0.06, 0.07, 0, 0.035);
    heart.bezierCurveTo(0.06, 0.07, 0.08, 0.0, 0, -0.05);
    const hg = new THREE.ExtrudeGeometry(heart, { depth: 0.02, bevelEnabled: false, curveSegments: 5 });
    P.add('paint', hg.translate(0, seatY + 0.28, -s / 2 + 0.035), palette.capRed);
    // stretchers
    for (const x of [-1, 1]) P.add('wood', grainUV(new THREE.BoxGeometry(0.03, 0.03, s - 0.06), 'z').translate(x * (s / 2 - 0.03), 0.1, 0), shade(w, -0.06));
    if (cushion) P.add('paint', new THREE.CylinderGeometry(0.15, 0.16, 0.05, 12).scale(1, 1, 1).translate(0, seatY + 0.045, 0.01), cushion);
    return P.finish();
  });
  const g = groupFor(geos, { name: 'chair' });
  g.name = 'chair';
  g.userData.seat = new THREE.Vector3(0, seatY + (cushion ? 0.07 : 0.03), 0.02);
  return g;
}

// ─── storage ─────────────────────────────────────────────────────────────────
/** Oak barrel with bulged staves, iron hoops and a planked lid. opts: { height = 0.9, contents: null | 'water' | 'apples', seed } */
export function makeBarrel(opts = {}) {
  const H = opt(opts, 'height', 0.9);
  const contents = opts.contents ?? null;
  const geos = cached(`barrel|${H}|${contents}`, () => {
    const P = new Parts();
    const R = H * 0.42;
    const prof = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      prof.push([R * (0.84 + Math.sin(t * Math.PI) * 0.16), H * (1 - t)]);
    }
    const body = revolve([[0, H - 0.03], ...prof.map(([r, y], i) => (i === 0 ? [r, y] : [r, y]))], 20);
    const staves = 14;
    paintFn(body, (x, y, z, nx, ny, nz, i, c) => {
      const a = Math.atan2(x, z);
      const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * staves);
      c.set(k % 2 ? palette.oak : shade(palette.oak, -0.05));
      if (ny > 0.9) c.set(contents === 'water' ? palette.waterDeep : shade(palette.oak, -0.08));
    });
    P.add('wood', grainUV(body, 'y'));
    for (const t of [0.12, 0.32, 0.68, 0.88]) {
      const r = R * (0.84 + Math.sin(t * Math.PI) * 0.16) + 0.008;
      const hoop = new THREE.TorusGeometry(r, 0.016, 4, 22);
      hoop.rotateX(Math.PI / 2);
      hoop.scale(1, 2.2, 1);
      P.add('detail', hoop.translate(0, H * (1 - t), 0), IRON);
    }
    if (contents === 'apples') {
      const rng = createRng('barrel-apples');
      for (let i = 0; i < 9; i++) {
        const a = rng.next() * 6.28, rr = rng.range(0, R * 0.62);
        P.add('detail', new THREE.SphereGeometry(0.075, 8, 6).translate(Math.sin(a) * rr, H - 0.01 + rng.range(0, 0.06), Math.cos(a) * rr), rng.pick([palette.capRed, '#c43a2a', '#7fb33f']));
      }
    } else if (contents !== 'water') {
      // lid planks + handle
      for (let i = 0; i < 3; i++) P.add('detail', new THREE.BoxGeometry(R * 1.55, 0.008, 0.004).translate(0, H - 0.024, -R * 0.4 + i * R * 0.4), shade(palette.oak, -0.2));
      P.add('wood', grainUV(new THREE.BoxGeometry(0.06, 0.04, R * 1.2), 'z').translate(0, H - 0.005, 0), shade(palette.oak, -0.1));
    }
    return P.finish();
  });
  const g = groupFor(geos, { name: 'barrel' });
  g.name = 'barrel';
  return g;
}

/** Slatted wooden crate. opts: { size = 0.6, contents: null | 'apples' | 'planks' | 'tools', stencil = true, seed } */
export function makeCrate(opts = {}) {
  const S = opt(opts, 'size', 0.6);
  const contents = opts.contents ?? null;
  const geos = cached(`crate|${S}|${contents}`, () => {
    const P = new Parts();
    const c = palette.spruce;
    const t = 0.04;
    // slats on 4 sides (with gaps) + bottom
    for (let side = 0; side < 4; side++) {
      const ry = (side * Math.PI) / 2;
      for (let i = 0; i < 3; i++) {
        const slat = grainUV(new THREE.BoxGeometry(S - 0.02, S * 0.27, 0.025), 'x', 0.55, side * 0.3 + i * 0.7);
        slat.translate(0, S * 0.17 + i * S * 0.32, S / 2 - 0.0125);
        P.add('wood', slat.rotateY(ry), i === 1 ? shade(c, 0.03) : c);
      }
    }
    P.add('wood', grainUV(new THREE.BoxGeometry(S - 0.04, 0.03, S - 0.04), 'x').translate(0, 0.03, 0), shade(c, -0.08));
    // corner posts
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      P.add('wood', grainUV(new THREE.BoxGeometry(t * 1.5, S, t * 1.5), 'y').translate(x * (S / 2 - 0.005), S / 2, z * (S / 2 - 0.005)), shade(c, -0.1));
    }
    // stencilled tag on the front
    P.add('detail', new THREE.PlaneGeometry(S * 0.32, S * 0.14).translate(0, S * 0.5, S / 2 + 0.002), palette.swissRed);
    P.add('detail', new THREE.PlaneGeometry(S * 0.07, S * 0.025).translate(0, S * 0.5, S / 2 + 0.004), palette.spots);
    P.add('detail', new THREE.PlaneGeometry(S * 0.025, S * 0.07).translate(0, S * 0.5, S / 2 + 0.004), palette.spots);
    const rng = createRng('crate-' + contents);
    if (contents === 'apples') {
      for (let i = 0; i < 12; i++) P.add('detail', new THREE.SphereGeometry(0.07, 8, 6).translate(rng.jitter(S * 0.32), S - 0.04 + rng.range(0, 0.06), rng.jitter(S * 0.32)), rng.pick([palette.capRed, '#c43a2a', '#7fb33f', palette.autumnYellow]));
    } else if (contents === 'planks') {
      for (let i = 0; i < 5; i++) {
        const p = grainUV(new THREE.BoxGeometry(0.06 + rng.range(0, 0.06), S * rng.range(1.1, 1.6), 0.025), 'y');
        p.translate(0, (S * 1.3) / 2, 0);
        xf(p, [rng.jitter(S * 0.3), 0.05, rng.jitter(S * 0.3)], [rng.jitter(0.25), rng.next() * 3, rng.jitter(0.25)]);
        P.add('wood', p, rng.pick([palette.oak, palette.walnut, palette.cherry, palette.maple, palette.ash]));
      }
    } else if (contents === 'tools') {
      P.add('wood', xf(grainUV(new THREE.CylinderGeometry(0.02, 0.02, S * 1.2, 6), 'y'), [-S * 0.15, S * 0.8, 0], [0.3, 0, 0.2]), palette.ash);
      P.add('detail', xf(new THREE.BoxGeometry(0.1, 0.05, 0.05), [-S * 0.15 - 0.13, S * 1.3, 0.16], [0.3, 0, 0.2]), IRON);
      P.add('wood', xf(grainUV(new THREE.CylinderGeometry(0.018, 0.018, S * 1.1, 6), 'y'), [S * 0.15, S * 0.75, 0.05], [-0.25, 0, -0.25]), palette.cherry);
    }
    return P.finish();
  });
  const g = groupFor(geos, { name: 'crate' });
  g.name = 'crate';
  return g;
}

/** Stacked logs with ringed end grain. opts: { length = 1.4, rows = 3, seed } */
export function makeLogPile(opts = {}) {
  const L = opt(opts, 'length', 1.4);
  const rows = opt(opts, 'rows', 3);
  const seed = seedOf(opts, 'logs');
  const geos = cached(`logpile|${L}|${rows}|${seed}`, () => {
    const rng = createRng(seed);
    const P = new Parts();
    const r = 0.14;
    for (let row = 0; row < rows; row++) {
      const n = rows - row + 1;
      for (let i = 0; i < n; i++) {
        const z = (i - (n - 1) / 2) * r * 2.02;
        const y = r + row * r * 1.74;
        addLog(P, { x: rng.jitter(0.06), y, z, len: L + rng.jitter(0.12), r: r * rng.range(0.9, 1.05), rotY: rng.jitter(0.04), rng });
      }
    }
    // stakes holding the pile
    for (const s of [-1, 1]) {
      const st = grainUV(new THREE.CylinderGeometry(0.03, 0.035, rows * r * 1.9 + 0.2, 6), 'y');
      st.translate(0, (rows * r * 1.9 + 0.2) / 2, 0);
      xf(st, [0, 0, s * ((rows + 1) / 2) * r * 2.05 + s * 0.04], [s * -0.08, 0, 0]);
      P.add('wood', st, palette.barkDark);
    }
    return P.finish();
  });
  const g = groupFor(geos, { name: 'logpile' });
  g.name = 'logPile';
  return g;
}

/** A parcel wrapped in paper and string — Schneckenpost cargo. opts: { size = 0.35, color, seed } */
export function makeParcel(opts = {}) {
  const S = opt(opts, 'size', 0.35);
  const rng = createRng(seedOf(opts, 'parcel'));
  const color = opts.color ?? rng.pick(['#c9a26b', '#d9b27c', palette.paper, '#e8c27a']);
  const geos = cached(`parcel|${S}|${color}`, () => {
    const P = new Parts();
    const w = S, h = S * 0.62, d = S * 0.8;
    P.add('paint', new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), color);
    const string = palette.swissRed;
    P.add('detail', new THREE.BoxGeometry(w + 0.006, h + 0.006, 0.018).translate(0, h / 2, 0), string);
    P.add('detail', new THREE.BoxGeometry(0.018, h + 0.006, d + 0.006).translate(0, h / 2, 0), string);
    for (const s of [-1, 1]) P.add('detail', xf(new THREE.TorusGeometry(0.035, 0.009, 4, 8), [s * 0.03, h + 0.025, 0], [0, 0, s * 0.6]), string);
    // address label with a stamp
    P.add('detail', new THREE.PlaneGeometry(w * 0.4, d * 0.3).rotateX(-Math.PI / 2).translate(w * 0.22, h + 0.004, d * 0.22), palette.paper);
    P.add('detail', new THREE.PlaneGeometry(w * 0.09, d * 0.1).rotateX(-Math.PI / 2).translate(w * 0.34, h + 0.006, d * 0.15), palette.postYellow);
    return P.finish();
  });
  const g = groupFor(geos, { name: 'parcel' });
  g.name = 'parcel';
  return g;
}

/** Wooden wheelbarrow. opts: { wood = 'spruce', contents: null | 'logs' | 'soil' | 'flowers', seed } */
export function makeWheelbarrow(opts = {}) {
  const w = wood(opt(opts, 'wood', 'spruce'));
  const contents = opts.contents ?? null;
  const geos = cached(`wheelbarrow|${w}|${contents}`, () => {
    const P = new Parts();
    const rng = createRng('wb');
    const trayY = 0.36;
    // tray: tapered planked box (narrow front at +Z)
    const tray = new THREE.CylinderGeometry(0.42, 0.3, 0.26, 4, 1, true);
    tray.rotateY(Math.PI / 4);
    tray.scale(1, 1, 1.25);
    deform(tray, (v) => {
      if (v.z > 0) v.x *= 0.82;
    });
    tray.computeVertexNormals();
    paintFn(tray, (x, y, z, nx, ny, nz, i, c) => c.set(Math.sin(y * 70) > 0.6 ? shade(w, -0.12) : w));
    P.add('wood', grainUV(tray.translate(0, trayY + 0.13, 0.05), 'x'));
    const inner = tray.clone();
    const ia = inner.index.array;
    for (let i = 0; i < ia.length; i += 3) [ia[i + 1], ia[i + 2]] = [ia[i + 2], ia[i + 1]];
    inner.computeVertexNormals();
    paintFn(inner, (x, y, z, nx, ny, nz, i, c) => c.set(shade(w, -0.08)));
    P.add('wood', inner);
    P.add('wood', grainUV(new THREE.BoxGeometry(0.42, 0.03, 0.62), 'z').translate(0, trayY + 0.015, 0.05), shade(w, -0.1));
    // handles running from the wheel to the back
    for (const s of [-1, 1]) {
      P.add('wood', strut([s * 0.12, 0.2, 0.62], [s * 0.26, 0.48, -0.62], 0.025, 0.025, 6), shade(w, -0.04));
      P.add('wood', new THREE.CapsuleGeometry(0.03, 0.12, 3, 6).rotateX(Math.PI / 2 - 0.35).translate(s * 0.27, 0.5, -0.72), palette.walnut);
      // legs
      P.add('wood', strut([s * 0.2, trayY, -0.3], [s * 0.22, 0, -0.38], 0.022, 0.022, 5), shade(w, -0.04));
    }
    // wheel: tyre, rim, spokes, hub
    const wz = 0.62, wy = 0.2;
    const tyre = new THREE.TorusGeometry(0.17, 0.035, 6, 18);
    tyre.rotateY(Math.PI / 2);
    P.add('paint', tyre.translate(0, wy, wz), '#3b3633');
    const rim = new THREE.TorusGeometry(0.15, 0.015, 4, 18);
    rim.rotateY(Math.PI / 2);
    P.add('wood', rim.translate(0, wy, wz), w);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      P.add('detail', xf(new THREE.BoxGeometry(0.02, 0.3, 0.02), [0, wy, wz], [a, 0, 0]), shade(w, -0.1));
    }
    P.add('detail', new THREE.CylinderGeometry(0.03, 0.03, 0.27, 8).rotateZ(Math.PI / 2).translate(0, wy, wz), IRON);
    if (contents === 'soil') P.add('detail', blob(0.3, [1.1, 0.3, 1.3], 10, 6).translate(0, trayY + 0.22, 0.05), palette.dirtDark);
    if (contents === 'logs') for (let i = 0; i < 4; i++) addLog(P, { x: rng.jitter(0.06), y: trayY + 0.12 + (i > 2 ? 0.13 : 0), z: -0.12 + (i % 3) * 0.13 + 0.02, len: 0.55, r: 0.065, rotY: Math.PI / 2 + rng.jitter(0.2), layer: 'detail' });
    if (contents === 'flowers') {
      P.add('detail', blob(0.28, [1.1, 0.25, 1.3], 10, 6).translate(0, trayY + 0.2, 0.05), palette.dirtDark);
      for (let i = 0; i < 9; i++) addFlower(P, rng.jitter(0.2), trayY + 0.23, 0.05 + rng.jitter(0.25), { rng, size: 0.05, height: 0.15, layer: 'detail' });
    }
    return P.finish();
  });
  const g = groupFor(geos, { name: 'wheelbarrow' });
  g.name = 'wheelbarrow';
  return g;
}

// ─── nature ──────────────────────────────────────────────────────────────────
const rockNoise = createNoise2D(4242);

/** A smooth cute rock with moss on top. opts: { size = 0.6, seed, moss = true, flat = 0.65 } */
export function makeRock(opts = {}) {
  const size = opt(opts, 'size', 0.6);
  const seed = seedOf(opts, 'rock');
  const moss = opt(opts, 'moss', true);
  const flat = opt(opts, 'flat', 0.65);
  const geos = cached(`rock|${size}|${seed}|${moss}|${flat}`, () => {
    const rng = createRng(seed);
    const P = new Parts();
    let g = new THREE.IcosahedronGeometry(size, 2);
    const ox = rng.range(0, 50), oz = rng.range(0, 50);
    const sx = rng.range(0.85, 1.25), sz = rng.range(0.8, 1.15);
    deform(g, (v) => {
      const n = rockNoise(v.x * 1.3 / size + ox, v.z * 1.3 / size + v.y * 0.7 / size + oz);
      v.multiplyScalar(1 + n * 0.16);
      v.x *= sx;
      v.z *= sz;
      v.y *= flat;
      if (v.y < -size * 0.15) v.y = -size * 0.15 + (v.y + size * 0.15) * 0.2;
    });
    g = smooth(g);
    g.translate(0, size * 0.13, 0);
    const stone = new THREE.Color(rng.pick([palette.stone, shade(palette.stone, 0.04), palette.stoneDark]));
    const stoneD = new THREE.Color(shade(palette.stoneDark, -0.05));
    const mossC = new THREE.Color(palette.moss), mossL = new THREE.Color(palette.grassLight);
    paintFn(g, (x, y, z, nx, ny, nz, i, c) => {
      c.copy(stone).lerp(stoneD, Math.max(0, -ny) * 0.5 + (rockNoise(x * 6, z * 6) * 0.5 + 0.5) * 0.18);
      if (moss) {
        const m = ny + rockNoise(x * 3 + 9, z * 3) * 0.35;
        if (m > 0.62) c.copy(mossC).lerp(mossL, Math.min(1, (m - 0.62) * 2));
      }
    });
    P.add('paint', g);
    if (moss && rng.chance(0.6)) addTuft(P, size * 0.6 * sx, 0, size * 0.3, { rng, height: 0.22 });
    return P.finish();
  });
  const g = groupFor(geos, { name: 'rock' });
  g.name = 'rock';
  return g;
}

/** Tree stump with root flares, bark ridges and ringed top. opts: { radius = 0.45, height = 0.5, seed, axe = false, mushrooms = true } */
export function makeStump(opts = {}) {
  const R = opt(opts, 'radius', 0.45);
  const H = opt(opts, 'height', 0.5);
  const seed = seedOf(opts, 'stump');
  const axe = !!opts.axe;
  const mush = opt(opts, 'mushrooms', true);
  const geos = cached(`stump|${R}|${H}|${seed}|${axe}|${mush}`, () => {
    const rng = createRng(seed);
    const P = new Parts();
    const roots = rng.int(4, 6);
    const ph = rng.next() * 6;
    const prof = [[R * 0.98, H], [R, H * 0.85], [R * 1.02, H * 0.5], [R * 1.1, H * 0.2], [R * 1.35, H * 0.05], [R * 1.5, -0.05]];
    const trunk = revolve(prof, 22, (v, row, phi) => {
      const ridge = 1 + Math.sin(phi * 11 + ph) * 0.03;
      const root = Math.max(0, Math.sin(phi * roots + ph)) ** 2 * (row >= 3 ? (row - 2) * 0.09 : 0);
      v.x *= ridge + root;
      v.z *= ridge + root;
    });
    paintFn(trunk, (x, y, z, nx, ny, nz, i, c) => c.set(Math.sin(Math.atan2(x, z) * 11 + ph + y * 3) > 0.35 ? palette.barkDark : palette.bark));
    P.add('paint', trunk);
    P.add('paint', ringDisc(R * 0.98, palette.oak, { rings: 7, seg: 22, y: H }), null);
    // a crack
    P.add('detail', xf(new THREE.BoxGeometry(R * 0.7, 0.006, 0.02), [R * 0.3, H + 0.003, 0], [0, 0.4, 0]), shade(palette.oak, -0.25));
    if (mush) {
      const a = rng.next() * 6.28;
      for (let i = 0; i < 3; i++) addTinyMushroom(P, Math.sin(a + i * 0.3) * (R * 1.15), 0, Math.cos(a + i * 0.3) * (R * 1.15), { rng, size: rng.range(0.08, 0.14), color: rng.pick([palette.capRed, palette.capOchre, palette.capBrown]) });
    }
    if (axe) {
      P.add('detail', xf(new THREE.BoxGeometry(0.03, 0.16, 0.2), [0.05, H + 0.04, 0], [0, 0, 0.3]), '#aeb6be');
      P.add('wood', xf(grainUV(new THREE.CylinderGeometry(0.022, 0.026, 0.62, 6), 'y'), [-0.06, H + 0.3, 0.06], [0.15, 0, 0.62]), palette.ash);
    }
    return P.finish();
  });
  const g = groupFor(geos, { name: 'stump' });
  g.name = 'stump';
  g.userData.topY = H;
  return g;
}

/** Round leafy bush (sways a little). opts: { size = 0.8, seed, berries = false, flowers (colour) } */
export function makeBush(opts = {}) {
  const size = opt(opts, 'size', 0.8);
  const seed = seedOf(opts, 'bush');
  const berries = !!opts.berries;
  const flowers = opts.flowers ?? null;
  const geos = cached(`bush|${size}|${seed}|${berries}|${flowers}`, () => {
    const rng = createRng(seed);
    const P = new Parts();
    const n = rng.int(5, 7);
    const base = rng.pick([palette.leaf, palette.leafDark, palette.moss]);
    const top = shade(base, 0.08), bottom = shade(base, -0.1);
    const blobs = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.jitter(0.4);
      const r = size * rng.range(0.38, 0.55);
      const d = i === 0 ? 0 : size * rng.range(0.25, 0.5);
      const c = [Math.sin(a) * d, r * 0.75 + (i === 0 ? size * 0.25 : rng.range(0, size * 0.15)), Math.cos(a) * d];
      blobs.push([c, r]);
      let g = new THREE.IcosahedronGeometry(r, 1);
      deform(g, (v) => v.multiplyScalar(1 + rockNoise(v.x * 4 + i, v.z * 4 + v.y * 3) * 0.08));
      g.scale(1, 0.85, 1);
      g = smooth(g);
      g.translate(c[0], c[1], c[2]);
      paintFn(g, (x, y, z, nx, ny, nz, k, col) => col.set(base).lerp(new THREE.Color(ny > 0.3 ? top : bottom), Math.abs(ny) * 0.8));
      P.add('plantCast', g);
    }
    const dots = berries ? 10 : flowers ? 12 : 0;
    for (let i = 0; i < dots; i++) {
      const [c, r] = rng.pick(blobs);
      const dir = new THREE.Vector3(rng.jitter(1), rng.range(0.1, 1), rng.jitter(1)).normalize();
      const p = [c[0] + dir.x * r, c[1] + dir.y * r * 0.85, c[2] + dir.z * r];
      if (berries) P.add('plant', new THREE.SphereGeometry(0.035, 6, 4).translate(p[0], p[1], p[2]), rng.pick([palette.capRed, '#c43a5a']));
      else P.add('plant', new THREE.IcosahedronGeometry(0.045, 0).translate(p[0], p[1], p[2]), rng.chance(0.25) ? palette.spots : flowers);
    }
    return P.finish();
  });
  const g = groupFor(geos, { name: 'bush' });
  g.name = 'bush';
  return g;
}

/** A patch of flowers and grass tufts. opts: { radius = 0.5, count = 7, colors, seed } */
export function makeFlowerPatch(opts = {}) {
  const radius = opt(opts, 'radius', 0.5);
  const count = opt(opts, 'count', 7);
  const seed = seedOf(opts, 'flowers');
  const colors = opts.colors ?? null;
  const geos = cached(`flowerpatch|${radius}|${count}|${seed}|${colors}`, () => {
    const rng = createRng(seed);
    const P = new Parts();
    const palettePick = colors ?? [rng.pick(FLOWER_COLORS), rng.pick(FLOWER_COLORS)];
    for (let i = 0; i < count; i++) {
      const a = rng.next() * 6.28, r = Math.sqrt(rng.next()) * radius;
      addFlower(P, Math.sin(a) * r, 0, Math.cos(a) * r, { rng, color: rng.pick(palettePick), size: rng.range(0.05, 0.08), height: rng.range(0.14, 0.3) });
    }
    for (let i = 0; i < Math.ceil(count / 2); i++) {
      const a = rng.next() * 6.28, r = Math.sqrt(rng.next()) * radius;
      addTuft(P, Math.sin(a) * r, 0, Math.cos(a) * r, { rng, height: 0.22, color: palette.grassDark });
    }
    return P.finish();
  });
  const g = groupFor(geos, { name: 'flowers' });
  g.name = 'flowerPatch';
  return g;
}

/** Wooden flower box (standalone, on little feet). opts: { width = 0.8, wood = 'oak', seed } */
export function makeFlowerBox(opts = {}) {
  const width = opt(opts, 'width', 0.8);
  const w = wood(opt(opts, 'wood', 'oak'));
  const seed = seedOf(opts, 'flowerbox');
  const geos = cached(`flowerbox|${width}|${w}|${seed}`, () => {
    const P = new Parts();
    addFlowerBox(P, 0, 0.08, 0, 0, { width, rng: createRng(seed), wood: w, flowers: Math.round(width * 8) });
    for (const s of [-1, 1]) P.add('wood', grainUV(new THREE.BoxGeometry(0.06, 0.08, 0.18), 'y').translate(s * (width / 2 - 0.08), 0.04, 0), shade(w, -0.1));
    return P.finish();
  });
  const g = groupFor(geos, { name: 'flowerbox' });
  g.name = 'flowerBox';
  return g;
}

/** Terracotta pot with a plant. opts: { size = 1, plant: 'leafy' | 'flower' | 'sapling' | 'succulent', seed } */
export function makePottedPlant(opts = {}) {
  const size = opt(opts, 'size', 1);
  const seed = seedOf(opts, 'pot');
  const rng0 = createRng(seed);
  const plant = opts.plant ?? rng0.pick(['leafy', 'flower', 'sapling', 'succulent']);
  const geos = cached(`pot|${size}|${seed}|${plant}`, () => {
    const rng = createRng(seed + 'x');
    const P = new Parts();
    const terra = rng.pick(['#c96f45', '#b65f3a', '#d9825a']);
    const pot = revolve([[0.0, 0.3], [0.17, 0.3], [0.2, 0.29], [0.2, 0.24], [0.17, 0.235], [0.14, 0.02], [0.12, 0.0], [0, 0]], 14);
    paintFn(pot, (x, y, z, nx, ny, nz, i, c) => c.set(y > 0.235 ? shade(terra, 0.05) : terra));
    P.add('paint', pot);
    P.add('detail', new THREE.CircleGeometry(0.16, 12).rotateX(-Math.PI / 2).translate(0, 0.28, 0), palette.dirtDark);
    if (plant === 'leafy') {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * 6.28 + rng.jitter(0.3);
        const leaf = blob(0.09, [0.6, 0.25, 1.4], 8, 5);
        leaf.translate(0, 0, 0.11);
        xf(leaf, [0, 0.36 + rng.range(0, 0.1), 0], [-0.5 - rng.range(0, 0.4), a, 0, 'YXZ']);
        P.add('plant', leaf, i % 2 ? palette.leaf : palette.leafLight);
      }
    } else if (plant === 'flower') {
      for (let i = 0; i < 5; i++) addFlower(P, rng.jitter(0.09), 0.28, rng.jitter(0.09), { rng, size: 0.07, height: rng.range(0.2, 0.32), color: rng.pick(FLOWER_COLORS) });
      for (let i = 0; i < 4; i++) P.add('plant', blob(0.07, [1.2, 0.5, 1.2], 7, 5).translate(rng.jitter(0.1), 0.31, rng.jitter(0.1)), palette.leaf);
    } else if (plant === 'sapling') {
      P.add('plant', strut([0, 0.28, 0], [0.02, 0.62, 0.01], 0.02, 0.012, 5), palette.bark);
      for (let i = 0; i < 4; i++) P.add('plant', blob(0.11, [1, 0.85, 1], 8, 6).translate(rng.jitter(0.08), 0.62 + rng.range(-0.04, 0.1), rng.jitter(0.08)), i % 2 ? palette.leafLight : palette.leaf);
    } else {
      // succulent rosette
      for (let ring = 0; ring < 3; ring++) {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * 6.28 + ring * 0.5;
          const leaf = new THREE.ConeGeometry(0.035, 0.14 - ring * 0.03, 5);
          leaf.translate(0, (0.14 - ring * 0.03) / 2, 0);
          xf(leaf, [0, 0.28, 0], [0.9 - ring * 0.35, a, 0, 'YXZ']);
          P.add('plant', leaf, ring === 2 ? '#a9cf8c' : '#7fae7a');
        }
      }
    }
    return P.finish();
  });
  const g = groupFor(geos, { name: 'pot' });
  g.scale.setScalar(size);
  g.name = 'pottedPlant';
  return g;
}

/**
 * A single toadstool — or a cluster with count > 1. Glowing caps light up at night.
 * opts: { color, size = 0.35, count = 1, glow = false, glowColor, seed }
 */
export function makeSmallMushroom(opts = {}) {
  const size = opt(opts, 'size', 0.35);
  const count = opt(opts, 'count', 1);
  const glow = !!opts.glow;
  const seed = seedOf(opts, 'shroom');
  const color = opts.color ?? (glow ? palette.capTeal : palette.capRed);
  const glowColor = opts.glowColor ?? (glow ? palette.glowCyan : null);
  const built = cached(`shroom|${size}|${count}|${glow}|${seed}|${color}|${glowColor}`, () => {
    const rng = createRng(seed);
    const P = new Parts();
    const glowPts = [];
    for (let i = 0; i < count; i++) {
      const s = size * (i === 0 ? 1 : rng.range(0.45, 0.8));
      const a = rng.next() * 6.28;
      const d = i === 0 ? 0 : size * rng.range(0.45, 0.9);
      const x = Math.sin(a) * d, z = Math.cos(a) * d;
      const lean = i === 0 ? rng.jitter(0.1) : rng.jitter(0.3);
      const h = s * 1.0;
      const stem = revolve([[0, h], [s * 0.2, h * 0.98], [s * 0.22, h * 0.6], [s * 0.27, h * 0.15], [s * 0.3, 0], [s * 0.3, -0.03]], 10);
      xf(stem, [x, 0, z], [lean * 0.5, a, lean]);
      P.add('paint', stem, palette.stem);
      const capR = s * 0.62;
      const cap = revolve([[0, capR * 0.75], [capR * 0.55, capR * 0.68], [capR * 0.9, capR * 0.4], [capR, capR * 0.12], [capR * 0.92, 0], [capR * 0.5, 0.01], [0, 0.02]], 14);
      paintFn(cap, (px, py, pz, nx, ny, nz, k, c) => c.set(ny < -0.3 ? palette.stemShade : color));
      const capM = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(lean * 0.5, a, lean)), new THREE.Vector3(1, 1, 1));
      capM.multiply(new THREE.Matrix4().makeTranslation(0, h * 0.95, 0));
      P.add(glow ? `glow:${glowColor}:0.35:2.2` : 'paint', cap.applyMatrix4(capM), glow ? glowColor : null);
      // spots
      const spots = glow ? 0 : rng.int(3, 5);
      for (let k = 0; k < spots; k++) {
        const sa = (k / spots) * 6.28 + rng.jitter(0.4);
        const sr = capR * (k === 0 ? 0.0 : rng.range(0.45, 0.7));
        const sy = capR * 0.75 * (1 - (sr / capR) ** 2 * 0.65);
        const spot = blob(capR * rng.range(0.13, 0.2), [1, 0.35, 1], 6, 3);
        xf(spot, [Math.sin(sa) * sr, sy, Math.cos(sa) * sr], [Math.cos(sa) * (sr / capR) * 0.6, 0, -Math.sin(sa) * (sr / capR) * 0.6]);
        P.add('detail', spot.applyMatrix4(capM), palette.spots);
      }
      if (glow) {
        const p = new THREE.Vector3(0, capR * 0.4, 0).applyMatrix4(capM);
        glowPts.push({ x: p.x, y: p.y, z: p.z, size: capR * 3.2 });
      }
    }
    return { geos: P.finish(), glowPts };
  });
  const g = groupFor(built.geos, { name: 'shroom' });
  if (built.glowPts.length) g.add(glowQuads(built.glowPts, glowColor, { day: 0.05, night: 1.0 }));
  g.name = count > 1 ? 'mushroomCluster' : 'smallMushroom';
  return g;
}

/** A cluster of 3–5 toadstools (see makeSmallMushroom). */
export function makeMushroomCluster(opts = {}) {
  const rng = createRng(seedOf(opts, 'cluster'));
  return makeSmallMushroom({ count: opts.count ?? rng.int(3, 5), ...opts });
}

// ─── village ─────────────────────────────────────────────────────────────────
/**
 * Swiss-style letterbox on a post. opts: { color = palette.postYellow, flagUp = true, seed }
 */
export function makeMailbox(opts = {}) {
  const color = opt(opts, 'color', palette.postYellow);
  const flagUp = opt(opts, 'flagUp', true);
  const geos = cached(`mailbox|${color}|${flagUp}`, () => {
    const P = new Parts();
    P.add('wood', grainUV(new THREE.BoxGeometry(0.09, 0.9, 0.09), 'y').translate(0, 0.45, -0.02), palette.walnut);
    P.add('wood', xf(grainUV(new THREE.BoxGeometry(0.06, 0.32, 0.06), 'y'), [0, 0.72, -0.12], [0.75, 0, 0]), palette.walnut);
    const bw = 0.34, bh = 0.26, bd = 0.42, y0 = 0.9;
    P.add('paint', new THREE.BoxGeometry(bw, bh, bd).translate(0, y0 + bh / 2, 0), color);
    const roof = new THREE.CylinderGeometry(bw / 2, bw / 2, bd, 14, 1, false, -Math.PI / 2, Math.PI);
    roof.rotateZ(Math.PI / 2);
    roof.rotateY(Math.PI / 2);
    P.add('paint', roof.translate(0, y0 + bh, 0), color);
    // front door with slot and a post horn
    P.add('paint', new THREE.BoxGeometry(bw - 0.04, bh - 0.04, 0.02).translate(0, y0 + bh / 2, bd / 2 + 0.006), shade(color, -0.06));
    P.add('detail', new THREE.BoxGeometry(0.16, 0.025, 0.01).translate(0, y0 + bh * 0.72, bd / 2 + 0.02), '#2a2a2a');
    P.add('detail', new THREE.TorusGeometry(0.035, 0.01, 4, 10).translate(-0.03, y0 + bh * 0.35, bd / 2 + 0.02), '#2a2a2a');
    P.add('detail', new THREE.ConeGeometry(0.025, 0.06, 6, 1, true).rotateZ(-Math.PI / 2).translate(0.03, y0 + bh * 0.35, bd / 2 + 0.02), '#2a2a2a');
    // flag on the side
    const fy = flagUp ? 0.2 : 0.02;
    P.add('detail', xf(new THREE.BoxGeometry(0.015, 0.24, 0.02), [bw / 2 + 0.012, y0 + 0.12 + fy * 0.5, -0.05], [flagUp ? 0 : Math.PI / 2, 0, 0]), IRON);
    P.add('paint', xf(new THREE.BoxGeometry(0.012, 0.08, 0.11), [bw / 2 + 0.015, y0 + 0.2 + fy, -0.0], [0, 0, 0]), palette.swissRed);
    // name plate
    P.add('detail', new THREE.PlaneGeometry(0.16, 0.05).rotateY(Math.PI / 2).translate(bw / 2 + 0.002, y0 + 0.08, 0.08), palette.paper);
    return P.finish();
  });
  const g = groupFor(geos, { name: 'mailbox' });
  g.name = 'mailbox';
  return g;
}

/** Stone well with a little roof, crank, rope and bucket. opts: { seed, roofColor } */
export function makeWell(opts = {}) {
  const seed = seedOf(opts, 'well');
  const roofColor = opts.roofColor ?? palette.capRed;
  const geos = cached(`well|${seed}|${roofColor}`, () => {
    const rng = createRng(seed);
    const P = new Parts();
    const R = 0.75;
    // two courses of stones
    for (let course = 0; course < 3; course++) {
      const n = 13;
      for (let i = 0; i < n; i++) {
        const a = ((i + (course % 2) * 0.5) / n) * Math.PI * 2;
        const st = new THREE.BoxGeometry(0.34, 0.22, 0.22);
        deform(st, (v) => v.multiplyScalar(1 + rng.jitter(0.02)));
        st.computeVertexNormals();
        xf(st, [Math.sin(a) * R, 0.11 + course * 0.21, Math.cos(a) * R], [rng.jitter(0.05), a, rng.jitter(0.05)]);
        P.add('paint', st, rng.pick([palette.stone, shade(palette.stone, 0.05), palette.stoneDark]));
      }
    }
    // wooden rim cap
    const rim = new THREE.TorusGeometry(R, 0.12, 5, 26);
    rim.rotateX(Math.PI / 2);
    rim.scale(1, 0.45, 1);
    P.add('wood', grainUV(rim.translate(0, 0.66, 0), 'x'), palette.oak);
    P.add('detail', new THREE.CircleGeometry(R - 0.1, 22).rotateX(-Math.PI / 2).translate(0, 0.35, 0), palette.waterDeep);
    // posts, roof, crank
    const postH = 1.95;
    for (const s of [-1, 1]) P.add('wood', grainUV(new THREE.BoxGeometry(0.1, postH, 0.1), 'y').translate(s * (R + 0.02), postH / 2, 0), palette.walnut);
    for (const s of [-1, 1]) {
      const plank = grainUV(new THREE.BoxGeometry(R * 2 + 0.6, 0.05, 0.75), 'x');
      xf(plank, [0, postH + 0.22, s * 0.3], [s * 0.62, 0, 0]);
      plank.translate(0, 0, 0);
      P.add('wood', plank, roofColor);
      // shingle lines
      for (let k = 0; k < 3; k++) {
        const line = new THREE.BoxGeometry(R * 2 + 0.6, 0.02, 0.02);
        xf(line, [0, postH + 0.22 + 0.03 - k * 0.14 * Math.sin(0.62), s * (0.3 - 0.25 + k * 0.17)], [s * 0.62, 0, 0]);
        P.add('detail', line, shade(roofColor, -0.12));
      }
    }
    P.add('wood', grainUV(new THREE.BoxGeometry(R * 2 + 0.7, 0.08, 0.08), 'x').translate(0, postH + 0.47, 0), shade(roofColor, -0.15));
    // gable triangles
    for (const s of [-1, 1]) {
      const tri = new THREE.Shape();
      tri.moveTo(-0.45, 0);
      tri.lineTo(0.45, 0);
      tri.lineTo(0, 0.35);
      tri.lineTo(-0.45, 0);
      const tg = new THREE.ShapeGeometry(tri);
      tg.rotateY(Math.PI / 2 * s);
      P.add('wood', tg.translate(s * (R + 0.08), postH + 0.02, 0), palette.walnut);
    }
    const axleY = postH - 0.35;
    P.add('wood', grainUV(new THREE.CylinderGeometry(0.07, 0.07, R * 2, 10), 'y').rotateZ(Math.PI / 2).translate(0, axleY, 0), palette.oak);
    // crank
    P.add('detail', new THREE.BoxGeometry(0.04, 0.26, 0.04).translate(R + 0.12, axleY - 0.12, 0), IRON);
    P.add('detail', new THREE.CylinderGeometry(0.02, 0.02, 0.18, 6).rotateZ(Math.PI / 2).translate(R + 0.2, axleY - 0.24, 0), IRON);
    P.add('wood', new THREE.CylinderGeometry(0.03, 0.03, 0.14, 6).rotateZ(Math.PI / 2).translate(R + 0.32, axleY - 0.24, 0), palette.cherry);
    // rope + bucket
    P.add('detail', new THREE.CylinderGeometry(0.075, 0.075, 0.18, 10).rotateZ(Math.PI / 2).translate(0.1, axleY, 0), '#d8bf8a');
    P.add('detail', new THREE.CylinderGeometry(0.01, 0.01, 0.75, 4).translate(0.1, axleY - 0.43, 0), '#d8bf8a');
    const bucket = revolve([[0, 0.2], [0.13, 0.2], [0.13, 0.19], [0.1, 0.0], [0, 0.0]], 12);
    paintFn(bucket, (x, y, z, nx, ny, nz, i, c) => c.set(ny > 0.9 ? palette.waterDeep : palette.oak));
    P.add('wood', grainUV(bucket.translate(0.1, axleY - 1.0, 0), 'y'));
    for (const t of [0.05, 0.16]) {
      const hp = new THREE.TorusGeometry(0.11 + t * 0.12, 0.008, 3, 14);
      hp.rotateX(Math.PI / 2);
      P.add('detail', hp.translate(0.1, axleY - 1.0 + t, 0), IRON);
    }
    P.add('detail', new THREE.TorusGeometry(0.12, 0.008, 3, 10, Math.PI).translate(0.1, axleY - 0.8, 0), IRON);
    // flowers at the foot
    for (let i = 0; i < 5; i++) {
      const a = rng.range(0.6, 2.4) * (i % 2 ? 1 : -1);
      addFlower(P, Math.sin(a) * (R + 0.25), 0, Math.cos(a) * (R + 0.25), { rng, size: 0.06, height: 0.22 });
    }
    return P.finish();
  });
  const g = groupFor(geos, { name: 'well' });
  g.name = 'well';
  g.userData.radius = 0.95;
  return g;
}

/**
 * A ring of flat stones (stepping-stone circle around a fire pit / tree / fountain),
 * or a paved disc with opts.fill. opts: { width = 0.5, fill = false, seed, color }
 */
export function makeStoneCircle(radius = 2, opts = {}) {
  const width = opt(opts, 'width', 0.5);
  const fill = !!opts.fill;
  const seed = seedOf(opts, 'stones');
  const geos = cached(`stonecircle|${radius}|${width}|${fill}|${seed}`, () => {
    const rng = createRng(seed);
    const P = new Parts();
    const rings = [];
    if (fill) {
      for (let r = width * 0.5; r < radius; r += width * 0.95) rings.push(r);
    } else rings.push(radius);
    for (const r of rings) {
      const n = Math.max(5, Math.round((Math.PI * 2 * r) / (width * 1.15)));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.jitter(0.08);
        const st = new THREE.CylinderGeometry(width * 0.48, width * 0.52, 0.07, 7, 1);
        deform(st, (v) => {
          v.x *= 1 + rng.jitter(0.12);
          v.z *= 1 + rng.jitter(0.12);
        });
        st.computeVertexNormals();
        xf(st, [Math.sin(a) * r, 0.02, Math.cos(a) * r], [0, a + rng.jitter(0.3), 0], [1.2, 1, 0.85]);
        P.add('detail', st, opts.color ?? rng.pick([palette.stone, shade(palette.stone, 0.06), shade(palette.stone, -0.04), palette.stoneDark]));
      }
    }
    return P.finish();
  });
  const g = groupFor(geos, { name: 'stones', cast: false });
  g.name = 'stoneCircle';
  return g;
}

/** Flat stepping stones along local XZ points [{x, z}, …]. opts: { spacing = 0.65, size = 0.32, heightAt, seed } */
export function makeSteppingStones(points = [], opts = {}) {
  const spacing = opt(opts, 'spacing', 0.65);
  const size = opt(opts, 'size', 0.32);
  const hAt = opts.heightAt ?? (() => 0);
  const rng = createRng(seedOf(opts, 'steps'));
  const P = new Parts();
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.floor(len / spacing));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = a.x + (b.x - a.x) * t + rng.jitter(0.08), z = a.z + (b.z - a.z) * t + rng.jitter(0.08);
      const st = new THREE.CylinderGeometry(size, size * 1.06, 0.06, 8);
      deform(st, (v) => {
        v.x *= 1 + rng.jitter(0.1);
        v.z *= 1 + rng.jitter(0.1);
      });
      st.computeVertexNormals();
      xf(st, [x, hAt(x, z) + 0.015, z], [0, rng.next() * 3, 0], [1.15, 1, 0.9]);
      P.add('detail', st, rng.pick([palette.stone, shade(palette.stone, 0.05), palette.stoneDark]));
    }
  }
  const g = groupFor(P.finish(), { name: 'stepping', cast: false });
  g.name = 'steppingStones';
  return g;
}

// ─── strings: bunting & fairy lights ─────────────────────────────────────────
const BUNTING_COLORS = [palette.capRed, palette.postYellow, palette.capTeal, palette.capCoral, '#7aa65a', palette.capLavender, palette.paper];

/**
 * Bunting flags strung between local points [{x, y, z}, …] along sagging ropes;
 * the flags flutter. opts: { sag = 0.06 (× span), colors, flagSize = 0.22, spacing = 0.32, seed }
 */
export function makeBunting(points = [], opts = {}) {
  const sagK = opt(opts, 'sag', 0.06);
  const colors = opts.colors ?? BUNTING_COLORS;
  const fs = opt(opts, 'flagSize', 0.22);
  const spacing = opt(opts, 'spacing', 0.32);
  const g = new THREE.Group();
  g.name = 'bunting';
  if (points.length < 2) return g;
  const P = new Parts();
  const flags = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = new THREE.Vector3(points[i].x, points[i].y, points[i].z);
    const b = new THREE.Vector3(points[i + 1].x, points[i + 1].y, points[i + 1].z);
    const span = a.distanceTo(b);
    const curve = sagCurve(a, b, span * sagK, 16);
    P.add('detail', new THREE.TubeGeometry(curve, 24, 0.012, 4, false), '#e9dcc0');
    const n = Math.max(1, Math.floor(span / spacing));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      flags.push({ p, tan, color: colors[(flags.length) % colors.length] });
    }
  }
  g.add(groupFor(P.finish(), { name: 'bunting-rope', cast: false }));
  // flags: one instanced, double-sided triangle
  const tri = cached('bunting-flag', () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -1, 0], 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    geo.setIndex([0, 2, 1]);
    return geo;
  });
  const mesh = new THREE.InstancedMesh(tri, materials.toon('#ffffff', { side: THREE.DoubleSide }), flags.length);
  mesh.name = 'bunting-flags';
  mesh.castShadow = false;
  const base = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qf = new THREE.Quaternion();
  const sc = new THREE.Vector3(fs * 0.9, fs, 1);
  const xAxis = new THREE.Vector3();
  const col = new THREE.Color();
  flags.forEach((f, i) => {
    // flag plane spans the rope tangent (X) and down (−Y)
    xAxis.copy(f.tan).setY(0).normalize();
    const zAxis = new THREE.Vector3().crossVectors(xAxis, new THREE.Vector3(0, 1, 0)).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
    const bq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    base.push(bq);
    m4.compose(f.p, bq, sc);
    mesh.setMatrixAt(i, m4);
    mesh.setColorAt(i, col.set(f.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  if (mesh.boundingSphere) mesh.boundingSphere.radius += fs * 2;
  noRaycast(mesh);
  g.add(mesh);
  const axis = new THREE.Vector3(1, 0, 0);
  const ph = createRng(seedOf(opts, 'bunting')).next() * 6;
  registerAnimated(g, (dt, t, near) => {
    if (propsSettings.reducedMotion || near <= 0) return;
    for (let i = 0; i < flags.length; i++) {
      const ang = Math.sin(t * 3.1 + i * 0.7 + ph) * 0.32 + Math.sin(t * 5.3 + i * 1.3) * 0.08;
      qf.setFromAxisAngle(axis, ang);
      q.copy(base[i]).multiply(qf);
      m4.compose(flags[i].p, q, sc);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return g;
}

/**
 * Fairy lights: glowing bulbs along sagging wires between local points [{x, y, z}, …].
 * opts: { sag = 0.07, spacing = 0.35, colors = warm mix, seed }
 */
export function makeStringLights(points = [], opts = {}) {
  const sagK = opt(opts, 'sag', 0.07);
  const spacing = opt(opts, 'spacing', 0.35);
  const colors = opts.colors ?? [palette.windowGlow, '#ffb37a', '#fff1c4', '#ffd27a'];
  const g = new THREE.Group();
  g.name = 'stringLights';
  if (points.length < 2) return g;
  const P = new Parts();
  const halos = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = new THREE.Vector3(points[i].x, points[i].y, points[i].z);
    const b = new THREE.Vector3(points[i + 1].x, points[i + 1].y, points[i + 1].z);
    const span = a.distanceTo(b);
    const curve = sagCurve(a, b, span * sagK, 16);
    P.add('detail', new THREE.TubeGeometry(curve, 24, 0.008, 3, false), '#3b3633');
    const n = Math.max(1, Math.floor(span / spacing));
    for (let k = 0; k < n; k++) {
      const p = curve.getPointAt((k + 0.5) / n);
      const c = colors[(i * 7 + k) % colors.length];
      P.add('detail', new THREE.CylinderGeometry(0.016, 0.016, 0.03, 5).translate(p.x, p.y - 0.02, p.z), '#3b3633');
      P.add(`glow:${c}:0.6:2.4`, blob(0.035, [1, 1.3, 1], 6, 5).translate(p.x, p.y - 0.06, p.z), c);
      // small, soft amber halo (tinted per bulb; one halo mesh for the whole string)
      halos.push({ x: p.x, y: p.y - 0.06, z: p.z, size: 0.2, color: c });
    }
  }
  g.add(groupFor(P.finish(), { name: 'lights', cast: false }));
  if (halos.length) g.add(glowQuads(halos, '#ffffff', { day: 0.06, night: 0.85 }));
  return g;
}
