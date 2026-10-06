// ─────────────────────────────────────────────────────────────────────────────
// The mushroom house — the village's signature building.
//
//   const house = makeMushroomHouse({ seed: 'baker', capShape: 'droopy', capColor: palette.capCoral });
//   house.userData → { radius, height, door: Vector3, plaque: Object3D, capRadius }
//
// Bulbous plaster stem (seamless revolve with seeded wobble), a generous cap
// (dome | tall | flat | droopy) with a rolled rim, striped gills underneath and
// raised spots that follow the cap surface; a round-topped plank door with
// frame, hinges & knob; round or arched windows with frames, mullions, sills
// and flower boxes (they glow at night); stone steps & footing stones; an
// optional chimney with animated smoke, a hanging lantern on a bracket, an
// eyebrow dormer on bigger houses and a plaque above the door.
//
// Geometry is cached per resolved option set, so identical houses share GPU
// buffers. ~5–8k triangles, ~10 draw calls (2 shadow casters).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { materials } from '../core/materials.js';
import { palette } from '../core/palette.js';
import { createRng } from '../core/rng.js';
import { Parts, cached, xf, revolve, paintFn, groupFor, shade, mix, opt, strut, grainUV, invert, noRaycast } from './util.js';
import { glowGeometry, glowMesh } from './glow.js';
import { makeLantern } from './lantern.js';
import { addFlowerBox, addTuft, addTinyMushroom } from './bits.js';
import { registerAnimated, propsSettings } from './ticker.js';
import { makeTextTexture } from './text.js';

const CAP_COLORS = [palette.capRed, palette.capCoral, palette.capOchre, palette.capBrown, palette.capLavender, palette.capTeal];
const DOOR_COLORS = [palette.door, palette.door, '#5f8f3f', '#4f6d9a', palette.swissRed, palette.walnut, '#3f8ea6'];

/**
 * Cap profiles as (u = r / capRadius, v = y / capHeight) control points from the
 * top centre over the rim and back in under the cap. `top` = number of points on
 * the upper surface (spots live there). `stem` = stem height / total height.
 */
const SHAPES = {
  dome: {
    stem: 0.5,
    capH: 1,
    top: [[0, 1], [0.3, 0.965], [0.56, 0.86], [0.77, 0.67], [0.91, 0.44], [0.985, 0.2], [1.0, 0.05]],
    rim: [[0.985, -0.045], [0.945, -0.07], [0.905, -0.045]],
    under: [[0.78, 0.0], [0.6, 0.045]],
  },
  tall: {
    stem: 0.42,
    capH: 1,
    top: [[0, 1], [0.16, 0.975], [0.33, 0.89], [0.5, 0.73], [0.66, 0.53], [0.8, 0.33], [0.92, 0.15], [0.995, 0.03]],
    rim: [[0.99, -0.04], [0.955, -0.06], [0.92, -0.04]],
    under: [[0.8, -0.005], [0.6, 0.035]],
  },
  flat: {
    stem: 0.6,
    capH: 1,
    top: [[0, 0.9], [0.24, 0.97], [0.48, 0.96], [0.7, 0.85], [0.87, 0.63], [0.97, 0.36], [1.0, 0.13]],
    rim: [[0.99, 0.0], [0.955, -0.05], [0.915, -0.03]],
    under: [[0.8, 0.03], [0.6, 0.08]],
  },
  droopy: {
    stem: 0.56,
    capH: 1,
    top: [[0, 1], [0.3, 0.96], [0.56, 0.84], [0.76, 0.64], [0.89, 0.4], [0.955, 0.14], [0.965, -0.06], [0.945, -0.18]],
    rim: [[0.92, -0.22], [0.89, -0.21], [0.88, -0.16]],
    under: [[0.8, -0.07], [0.6, 0.02]],
  },
};

let instanceCount = 0;

/**
 * A cute mushroom house. Origin at ground under the stem centre, door facing +Z.
 * @param {object} [opts]
 * @param {string|number} [opts.seed]          drives every unspecified choice
 * @param {'dome'|'tall'|'flat'|'droopy'} [opts.capShape]
 * @param {string} [opts.capColor]            cap colour (palette.capRed …)
 * @param {string} [opts.spotColor]
 * @param {string} [opts.stemColor]
 * @param {string} [opts.doorColor]
 * @param {number} [opts.height=5]            total height to the top of the cap
 * @param {number} [opts.capRadius=3]
 * @param {number} [opts.stemRadius=1.6]
 * @param {number} [opts.windows]             number of windows (2–5)
 * @param {'round'|'arched'|'mixed'} [opts.windowShape]
 * @param {boolean} [opts.chimney]            chimney with smoke puffs
 * @param {boolean} [opts.smoke=true]
 * @param {boolean} [opts.lantern]            hanging lantern next to the door
 * @param {boolean} [opts.flowerBoxes]
 * @param {boolean} [opts.dormer]             eyebrow window in the cap (default on big houses)
 * @param {boolean} [opts.balcony]            little balcony on the upper floor (tall stems)
 * @param {number} [opts.spots]               number of cap spots (0 = none)
 * @param {boolean|string} [opts.plaque]      true = blank plaque above the door, string = painted text
 * @returns {THREE.Group} userData: { radius (stem collider radius), height, door: THREE.Vector3 (local, at ground
 *   in front of the door), plaque: Object3D (centre of the plaque, facing +Z), capRadius, chimneyTop: Vector3|null }
 */
export function makeMushroomHouse(opts = {}) {
  const seed = String(opts.seed ?? `house-${instanceCount}`);
  instanceCount++;
  const rng = createRng(seed);
  const height = opt(opts, 'height', 5);
  const capShape = opts.capShape && SHAPES[opts.capShape] ? opts.capShape : rng.pick(['dome', 'dome', 'tall', 'flat', 'droopy']);
  const o = {
    seed,
    capShape,
    height,
    capRadius: opt(opts, 'capRadius', 3),
    stemRadius: opt(opts, 'stemRadius', 1.6),
    capColor: opts.capColor ?? rng.pick(CAP_COLORS),
    spotColor: opts.spotColor ?? palette.spots,
    stemColor: opts.stemColor ?? palette.stem,
    doorColor: opts.doorColor ?? rng.pick(DOOR_COLORS),
    windows: opts.windows ?? rng.int(2, 3) + (height >= 5.5 ? 1 : 0),
    windowShape: opts.windowShape ?? rng.pick(['round', 'round', 'arched', 'mixed']),
    chimney: opts.chimney ?? rng.chance(0.75),
    lantern: opts.lantern ?? rng.chance(0.85),
    flowerBoxes: opts.flowerBoxes ?? rng.chance(0.75),
    dormer: opts.dormer ?? (height >= 5.5 && rng.chance(0.7)),
    balcony: opts.balcony ?? false,
    spots: opts.spots ?? rng.int(9, 15),
    plaque: !!opts.plaque,
    lanternSide: rng.chance(0.5) ? -1 : 1,
  };
  const key = 'house|' + JSON.stringify(o);
  const built = cached(key, () => buildHouse(o));

  const g = new THREE.Group();
  g.name = 'mushroomHouse';
  g.add(groupFor(built.geos, { name: 'house' }));
  if (built.glowGeo) g.add(glowMesh(built.glowGeo, palette.windowGlow, { day: 0.12, night: 0.95 }));

  // plaque anchor (+ painted text)
  const plaque = new THREE.Object3D();
  plaque.name = 'plaque';
  plaque.position.copy(built.plaque.pos);
  g.add(plaque);
  if (typeof opts.plaque === 'string') {
    const tex = makeTextTexture(opts.plaque, {
      width: 512,
      height: 160,
      color: '#fff3dc',
      background: null,
      style: 'paint',
      padding: 0.16,
    });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(built.plaque.w * 0.92, built.plaque.h * 0.86), materials.toon('#ffffff', { map: tex, transparent: true }));
    face.position.z = 0.032;
    plaque.add(face);
  }

  // hanging lantern (separate so it can swing)
  let lanternPivot = null;
  if (built.lantern) {
    lanternPivot = new THREE.Group();
    lanternPivot.position.copy(built.lantern.pos);
    lanternPivot.rotation.y = built.lantern.rotY;
    const lantern = makeLantern({ hanging: true, haloSize: 1.0 });
    lantern.position.y = -0.02;
    lanternPivot.add(lantern);
    g.add(lanternPivot);
  }

  // chimney smoke: a few instanced puffs rising, drifting and fading by scale
  let smoke = null;
  if (built.chimneyTop && opt(opts, 'smoke', true)) {
    const N = 6;
    smoke = new THREE.InstancedMesh(smokeGeo(), materials.toon(palette.paper), N);
    smoke.name = 'smoke';
    smoke.castShadow = false;
    smoke.receiveShadow = false;
    smoke.position.copy(built.chimneyTop);
    smoke.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.6, 1.4, 0), 2.4);
    smoke.frustumCulled = true;
    noRaycast(smoke);
    g.add(smoke);
  }

  const ph = rng.next() * 10;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const driftX = 0.75, driftZ = 0.25;
  function updateSmoke(t) {
    const N = smoke.count;
    for (let i = 0; i < N; i++) {
      const life = ((t * 0.16 + ph) + i / N) % 1;
      const k = Math.sin(Math.PI * Math.min(1, life * 1.15));
      const sc = (0.14 + life * 0.34) * Math.pow(Math.max(k, 0), 0.6);
      p.set(driftX * life * life + Math.sin(life * 6 + i) * 0.06, life * 2.1, driftZ * life + Math.cos(life * 5 + i * 2) * 0.05);
      e.set(life * 2 + i, life * 3, 0);
      q.setFromEuler(e);
      s.set(sc, sc * 0.9, sc);
      m4.compose(p, q, s);
      smoke.setMatrixAt(i, m4);
    }
    smoke.instanceMatrix.needsUpdate = true;
  }
  if (smoke) updateSmoke(0);

  if (smoke || lanternPivot) {
    registerAnimated(g, (dt, t) => {
      if (propsSettings.reducedMotion) return;
      if (smoke) updateSmoke(t);
      if (lanternPivot) {
        lanternPivot.rotation.x = Math.sin(t * 1.4 + ph) * 0.06;
        lanternPivot.rotation.z = Math.sin(t * 1.0 + ph * 2) * 0.04;
      }
    });
  }

  g.userData = {
    radius: built.collider,
    height: o.height,
    capRadius: o.capRadius,
    door: built.door.clone(),
    plaque,
    chimneyTop: built.chimneyTop ? built.chimneyTop.clone() : null,
    options: o,
    triangles: built.tris,
  };
  return g;
}

function smokeGeo() {
  return cached('smoke-geo', () => new THREE.IcosahedronGeometry(1, 1));
}

// ─── builder ─────────────────────────────────────────────────────────────────

function buildHouse(o) {
  const rng = createRng(o.seed + '|geo');
  const P = new Parts();
  const shape = SHAPES[o.capShape];
  const H = o.height;
  const R = o.stemRadius;
  const Rc = o.capRadius;
  const stemTop = Math.max(2.35, H * shape.stem); // where the cap sits
  const capH = H - stemTop;

  // ── stem: bulbous profile, wider at the base ──
  const sw = [rng.range(0, 6), rng.range(0, 6), rng.range(0.015, 0.03), rng.range(0.008, 0.016)];
  const stemProfile = (y) => {
    const t = THREE.MathUtils.clamp(y / stemTop, 0, 1.2);
    let r = 1.12 - 0.22 * t + 0.1 * Math.sin(Math.PI * Math.min(t, 1) * 0.9);
    if (t < 0.1) r += 0.07 * (1 - t / 0.1) ** 2; // base flare
    return r * R;
  };
  const wob = (phi) => 1 + sw[2] * Math.sin(3 * phi + sw[0]) + sw[3] * Math.sin(5 * phi + sw[1]);
  const wallR = (y, phi = 0) => stemProfile(y) * wob(phi);

  const stemRows = [];
  stemRows.push([0, stemTop + capH * 0.25]);
  const ys = [stemTop + capH * 0.18, stemTop, stemTop * 0.9, stemTop * 0.78, stemTop * 0.64, stemTop * 0.5, stemTop * 0.36, stemTop * 0.24, stemTop * 0.14, stemTop * 0.07, stemTop * 0.025, 0, -0.12];
  for (const y of ys) stemRows.push([stemProfile(Math.max(y, 0)) * (y < 0 ? 1.02 : 1), y]);
  const stem = revolve(stemRows, 24, (v, row, phi) => {
    const k = wob(phi);
    v.x *= k;
    v.z *= k;
  });
  const plaster = o.stemColor;
  const plasterShade = mix(plaster, palette.stemShade, 0.85);
  paintFn(stem, (x, y, z, nx, ny, nz, i, c) => {
    const phi = Math.atan2(x, z);
    const blotch = Math.sin(phi * 7 + y * 2.3) * Math.sin(phi * 3 - y * 1.7) * 0.5 + 0.5;
    c.set(plaster).lerp(new THREE.Color(plasterShade), 0.22 * blotch);
    if (y > stemTop - 0.55) c.lerp(new THREE.Color(palette.stemShade), THREE.MathUtils.smoothstep(y, stemTop - 0.55, stemTop) * 0.7);
    if (y < 0.3) c.lerp(new THREE.Color(mix(palette.stemShade, palette.dirt, 0.4)), (1 - y / 0.3) * 0.55);
  });
  P.add('paint', stem);

  // ── cap ──
  const ST = (stemProfile(stemTop) / Rc) * 1.02;
  const ctrl = [...shape.top, ...shape.rim, ...shape.under, [ST, shape.under[1][1] + 0.05], [ST * 0.55, 0.28], [0, 0.32]];
  const curve = new THREE.SplineCurve(ctrl.map(([u, v]) => new THREE.Vector2(u, v)));
  const nCtrl = ctrl.length;
  const tTopEnd = (shape.top.length - 1) / (nCtrl - 1);
  const tRimEnd = (shape.top.length - 1 + shape.rim.length) / (nCtrl - 1);
  const cw = [rng.range(0, 6), rng.range(0, 6), rng.range(0, 6), rng.range(0.025, 0.05), rng.range(0.015, 0.035), rng.range(0.006, 0.014)];
  const tilt = [rng.jitter(0.05), rng.jitter(0.05)];
  const capWob = (phi) => 1 + cw[3] * Math.sin(2 * phi + cw[0]) + cw[4] * Math.sin(3 * phi + cw[1]) + cw[5] * Math.sin(7 * phi + cw[2]);
  const v2 = new THREE.Vector2();
  /** Cap surface point for (phi, t) where t runs along the profile curve. */
  const capPoint = (phi, t, out = new THREE.Vector3()) => {
    curve.getPoint(THREE.MathUtils.clamp(t, 0, 1), v2);
    const u = v2.x, v = v2.y;
    const r = u * Rc * (1 + (capWob(phi) - 1) * Math.min(1, u * 1.6));
    const x = Math.sin(phi) * r, z = Math.cos(phi) * r;
    let y = stemTop + v * capH + (x * tilt[0] + z * tilt[1]) * Math.min(1, u * 2);
    if (o.capShape === 'droopy') y -= capH * 0.06 * u ** 3 * (0.5 + 0.5 * Math.sin(phi * 3 + cw[0]));
    return out.set(x, y, z);
  };
  const capRows = [];
  const tVals = [];
  const nFine = shape.top.length - 1 + shape.rim.length;
  for (let k = 0; k < nCtrl - 1; k++) {
    const sub = k < nFine ? 2 : 1;
    for (let j = 0; j < sub; j++) tVals.push((k + j / sub) / (nCtrl - 1));
  }
  tVals.push(1);
  for (const t of tVals) {
    curve.getPoint(t, v2);
    capRows.push([v2.x * Rc, t]); // y is replaced in deform via capPoint
  }
  const capCols = 28;
  const cap = revolve(capRows.map(([r, t]) => [r < 1e-3 ? 0 : r, t]), capCols, (v, row, phi) => {
    capPoint(phi, tVals[row], v);
  });
  cap.computeVertexNormals();
  const capC = new THREE.Color(o.capColor);
  const capLight = new THREE.Color(shade(o.capColor, 0.06));
  const capDark = new THREE.Color(shade(o.capColor, -0.08));
  const gill = new THREE.Color(mix(palette.stemShade, o.capColor, 0.12));
  const gillDark = new THREE.Color(shade(mix(palette.stemShade, o.capColor, 0.2), -0.1));
  // which row each vertex belongs to → colour by profile section
  const rowOf = [];
  capRows.forEach(([r], ri) => {
    const n = r < 1e-3 ? 1 : capCols;
    for (let k = 0; k < n; k++) rowOf.push(ri);
  });
  paintFn(cap, (x, y, z, nx, ny, nz, i, c) => {
    const t = tVals[rowOf[i]];
    const phi = Math.atan2(x, z);
    if (t <= tTopEnd + 1e-4) {
      // upper surface: lighter crown, darker towards the rim, hand-painted blotches
      const k = t / tTopEnd;
      c.copy(capLight).lerp(capC, Math.min(1, k * 1.6)).lerp(capDark, Math.max(0, k - 0.75) * 1.6);
      const b = Math.sin(phi * 5 + t * 9) * Math.sin(phi * 2 - t * 13) * 0.5 + 0.5;
      c.lerp(capDark, b * 0.12);
    } else if (t <= tRimEnd + 1e-4) {
      c.copy(capDark).lerp(capC, 0.4);
    } else {
      // gills: soft radial stripes
      const st = Math.sin(phi * capCols * 0.5) * 0.5 + 0.5;
      c.copy(gill).lerp(gillDark, st * 0.6);
    }
  });
  P.add('paint', cap);

  // ── features on the wall ──
  /**
   * A placement frame for a flat feature spanning [y0, y1] at angle phi: tilted
   * to the wall's slope and pushed out so the feature's local z=0 plane sits
   * just in front of the (curved, tapering) plaster everywhere along x=0.
   * Features are built facing +Z with local y=0 at the frame centre.
   */
  const wallFrame = (phi, y0, y1, margin = 0.012) => {
    const yc = (y0 + y1) / 2;
    const slope = (wallR(y1, phi) - wallR(y0, phi)) / (y1 - y0);
    let dev = 0;
    for (let i = 0; i <= 8; i++) {
      const y = y0 + ((y1 - y0) * i) / 8;
      dev = Math.max(dev, wallR(y, phi) - (wallR(yc, phi) + (y - yc) * slope));
    }
    const r = wallR(yc, phi) + dev + margin;
    return { pos: [Math.sin(phi) * r, yc, Math.cos(phi) * r], rot: [Math.atan(slope), phi, 0, 'YXZ'], r, yc };
  };
  const onFrame = (geo, f) => xf(geo, f.pos, f.rot);
  const onWall = (geo, phi, y, out = 0) => {
    const r = wallR(y, phi) + out;
    return xf(geo, [Math.sin(phi) * r, y, Math.cos(phi) * r], [0, phi, 0]);
  };
  const frameWood = palette.walnut;
  const reserved = []; // [phi, yMin, yMax] wall areas taken

  // door
  const doorW = THREE.MathUtils.clamp(R * 0.58, 0.82, 1.02);
  const doorH = 1.52;
  const doorY = 0.16;
  const doorF = wallFrame(0, doorY, doorY + doorH);
  const doorZ = doorF.r;
  buildDoor(P, rng, { w: doorW, h: doorH, frame: doorF, onFrame, color: o.doorColor, frameColor: frameWood, porthole: rng.chance(0.45) });
  reserved.push([0, 0, doorY + doorH + 0.5, 0.55]);

  // steps
  const stepC = [palette.stone, shade(palette.stone, 0.05), palette.stoneDark];
  P.add('paint', xf(new THREE.CylinderGeometry(0.55, 0.6, 0.16, 14), [0, 0.08, doorZ + 0.18], [0, 0, 0], [1.25, 1, 0.75]), stepC[0]);
  P.add('paint', xf(new THREE.CylinderGeometry(0.58, 0.63, 0.1, 14), [rng.jitter(0.05), 0.04, doorZ + 0.62], [0, rng.jitter(0.2), 0], [1.3, 1, 0.75]), stepC[1]);

  // footing stones around the base
  const nStones = 12;
  for (let i = 0; i < nStones; i++) {
    const phi = (i / nStones) * Math.PI * 2 + rng.jitter(0.12);
    const wrapped = Math.atan2(Math.sin(phi), Math.cos(phi));
    if (Math.abs(wrapped) < 0.5) continue;
    const r = wallR(0.05, phi) + 0.04;
    const sz = rng.range(0.16, 0.24);
    const st = new THREE.IcosahedronGeometry(sz, 0);
    xf(st, [Math.sin(phi) * r, 0.06, Math.cos(phi) * r], [rng.next() * 3, phi, rng.next() * 3], [1.3, 0.6, 0.9]);
    P.add('detail', st, rng.pick(stepC));
  }

  // windows
  const glowPts = [];
  const twoFloors = stemTop > 3.2;
  const winSpecs = [];
  const lowerY = 1.25;
  const upperY = Math.min(stemTop - 0.7, lowerY + 1.55);
  const sideA = rng.range(0.82, 0.98);
  const candidates = [
    { phi: -sideA - (o.lanternSide < 0 ? 0.14 : 0), y: lowerY },
    { phi: sideA + (o.lanternSide > 0 ? 0.14 : 0), y: lowerY },
    { phi: Math.PI + rng.jitter(0.5), y: lowerY },
  ];
  if (twoFloors) {
    candidates.splice(2, 0, { phi: rng.chance(0.5) ? 0 : rng.jitter(0.7), y: upperY, upper: true });
    candidates.push({ phi: Math.PI * 0.7 * (rng.chance(0.5) ? 1 : -1), y: upperY, upper: true });
  } else {
    candidates.push({ phi: -2.1, y: lowerY });
  }
  for (let i = 0; i < Math.min(o.windows, candidates.length); i++) winSpecs.push(candidates[i]);
  winSpecs.forEach((w, i) => {
    const shapeName = o.windowShape === 'mixed' ? (i % 2 ? 'arched' : 'round') : o.windowShape;
    const upper = !!w.upper;
    const r = upper ? 0.26 : 0.3;
    buildWindow(P, rng, {
      shape: shapeName,
      r,
      phi: w.phi,
      y: w.y,
      wallR,
      frame: frameWood,
      box: o.flowerBoxes && !upper && Math.abs(Math.atan2(Math.sin(w.phi), Math.cos(w.phi))) < 2.4,
      glowPts,
      wallFrame,
      onFrame,
    });
    reserved.push([w.phi, w.y - 0.6, w.y + 0.6, 0.35]);
  });

  // plaque above the door
  const plaqueY = doorY + doorH + 0.24;
  const plaqueW = 0.82, plaqueH = 0.26;
  let plaquePos = new THREE.Vector3(0, plaqueY, wallR(plaqueY, 0) + 0.06);
  if (o.plaque) {
    const board = new THREE.BoxGeometry(plaqueW, plaqueH, 0.05);
    grainUV(board, 'x');
    P.add('wood', onWall(board, 0, plaqueY, 0.0), palette.oak);
    for (const s of [-1, 1]) P.add('detail', onWall(new THREE.SphereGeometry(0.018, 6, 4), 0, plaqueY, 0.03).translate(s * (plaqueW / 2 - 0.06), 0, 0), palette.metalDark);
    plaquePos = new THREE.Vector3(0, plaqueY, wallR(plaqueY, 0) + 0.0);
  }

  // hanging lantern on a wall bracket beside the door
  let lantern = null;
  if (o.lantern) {
    const phi = o.lanternSide * 0.5;
    const y = doorY + doorH + 0.15;
    const r0 = wallR(y, phi);
    const arm = 0.42;
    const base = [Math.sin(phi) * (r0 - 0.05), y, Math.cos(phi) * (r0 - 0.05)];
    const tip = [Math.sin(phi) * (r0 + arm), y, Math.cos(phi) * (r0 + arm)];
    P.add('detail', strut(base, tip, 0.028, 0.022, 5), palette.metalDark);
    const brace = [Math.sin(phi) * (r0 - 0.03), y - 0.28, Math.cos(phi) * (r0 - 0.03)];
    const mid = [Math.sin(phi) * (r0 + arm * 0.6), y, Math.cos(phi) * (r0 + arm * 0.6)];
    P.add('detail', strut(brace, mid, 0.016, 0.016, 4), palette.metalDark);
    P.add('detail', xf(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 6), [base[0], y, base[2]], [Math.PI / 2, phi, 0, 'YXZ']), palette.metalDark);
    lantern = { pos: new THREE.Vector3(tip[0], y - 0.02, tip[2]), rotY: phi };
  }

  // chimney: stacked irregular stones poking out of the cap
  let chimneyTop = null;
  if (o.chimney) {
    const phi = rng.pick([-1, 1]) * rng.range(1.25, 1.9);
    const t = tTopEnd * rng.range(0.42, 0.55);
    const basePt = capPoint(phi, t);
    const top = basePt.y + rng.range(0.75, 1.0);
    const lean = rng.jitter(0.04);
    let y = basePt.y - 0.45;
    let i = 0;
    while (y < top) {
      const r = 0.24 + rng.jitter(0.025);
      const ring = new THREE.CylinderGeometry(r, r * 1.03, 0.2, 7, 1, true);
      xf(ring, [basePt.x * 0.98 + lean * (y - basePt.y), y + 0.1, basePt.z * 0.98], [0, rng.next(), 0]);
      P.add('paint', ring, i % 2 ? palette.stone : shade(palette.stoneDark, 0.04 * rng.next()));
      y += 0.19;
      i++;
    }
    P.add('paint', xf(new THREE.CylinderGeometry(0.3, 0.28, 0.1, 8), [basePt.x * 0.98 + lean * (y - basePt.y), y + 0.05, basePt.z * 0.98]), palette.stoneDark);
    P.add('detail', xf(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 8), [basePt.x * 0.98 + lean * (y - basePt.y), y + 0.105, basePt.z * 0.98]), '#3b2a1e');
    chimneyTop = new THREE.Vector3(basePt.x * 0.98 + lean * (y - basePt.y), y + 0.2, basePt.z * 0.98);
    reserved.push(['cap', phi, t, 0.7]);
  }

  // attic window in the cap: a little bulge with a round window and an eyebrow
  if (o.dormer) {
    const phi = (o.lanternSide > 0 ? -1 : 1) * rng.range(0.45, 0.8);
    const t = tTopEnd * 0.6;
    const p = capPoint(phi, t);
    const a = capPoint(phi + 1e-3, t), b = capPoint(phi - 1e-3, t), c = capPoint(phi, t + 1e-3), d = capPoint(phi, t - 1e-3);
    const n = new THREE.Vector3().crossVectors(a.sub(b), c.sub(d)).normalize();
    if (n.x * p.x + n.z * p.z < 0) n.negate();
    // lean the window a bit more upright than the cap so it reads as a window
    n.y *= 0.6;
    n.normalize();
    const zA = n.clone();
    const xA = new THREE.Vector3(0, 1, 0).cross(zA).normalize();
    const yA = zA.clone().cross(xA);
    const basis = new THREE.Matrix4().makeBasis(xA, yA, zA);
    const at = (geo, off) => {
      geo.applyMatrix4(basis);
      return geo.translate(p.x + n.x * off, p.y + n.y * off, p.z + n.z * off);
    };
    const wr = 0.3;
    const bump = new THREE.SphereGeometry(0.62, 12, 8);
    bump.scale(1, 0.9, 0.5);
    P.add('paint', at(bump, -0.02), shade(o.capColor, 0.02));
    const ring = new THREE.Shape();
    ring.absarc(0, 0, wr + 0.09, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, wr, 0, Math.PI * 2, true);
    ring.holes.push(hole);
    const fr = new THREE.ExtrudeGeometry(ring, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 7 });
    fr.translate(0, 0, -0.12);
    grainUV(fr, 'y');
    P.add('wood', at(fr, 0.26), frameWood);
    P.add(`glow:${palette.windowGlow}`, at(new THREE.CircleGeometry(wr + 0.01, 14), 0.25), palette.windowGlow);
    P.add('wood', at(new THREE.BoxGeometry(wr * 2, 0.035, 0.03), 0.27), frameWood);
    P.add('wood', at(new THREE.BoxGeometry(0.035, wr * 2, 0.03), 0.27), frameWood);
    const brow = new THREE.TorusGeometry(wr + 0.2, 0.075, 5, 9, Math.PI);
    brow.scale(1, 0.8, 1);
    P.add('paint', at(brow, 0.2), shade(o.capColor, -0.06));
    const gp = p.clone().addScaledVector(n, 0.42);
    glowPts.push({ x: gp.x, y: gp.y, z: gp.z, size: 0.75 });
    reserved.push(['cap', phi, t, 0.85]);
  }

  // balcony on the upper floor
  if (o.balcony && twoFloors) buildBalcony(P, rng, { y: upperY - 0.45, phi: -o.lanternSide * 1.25, wallR, frame: frameWood });

  // spots that follow the cap surface
  buildSpots(P, rng, { count: o.spots, capPoint, tTopEnd, Rc, color: o.spotColor, reserved, mid: stemTop - capH * 0.2 });

  // grass tufts & tiny shrooms around the base
  for (let i = 0; i < 9; i++) {
    const phi = rng.range(0.6, Math.PI * 2 - 0.6);
    const r = wallR(0.05, phi) + rng.range(0.1, 0.35);
    addTuft(P, Math.sin(phi) * r, 0, Math.cos(phi) * r, { rng, height: rng.range(0.22, 0.38) });
  }
  for (let i = 0; i < 2; i++) {
    const phi = rng.range(0.9, Math.PI * 2 - 0.9);
    const r = wallR(0.05, phi) + rng.range(0.2, 0.4);
    addTinyMushroom(P, Math.sin(phi) * r, 0, Math.cos(phi) * r, { rng, size: rng.range(0.09, 0.15), color: rng.pick([palette.capRed, palette.capOchre, palette.capBrown]) });
  }

  const geos = P.finish();
  let tris = 0;
  for (const g of Object.values(geos)) tris += g.index.count / 3;
  const glowGeo = glowPts.length ? glowGeometry(glowPts) : null;
  return {
    geos,
    glowGeo,
    tris,
    collider: wallR(0.05, 0) * 0.98,
    door: new THREE.Vector3(0, 0, doorZ + 1.05),
    plaque: { pos: plaquePos, w: plaqueW, h: plaqueH },
    lantern,
    chimneyTop,
  };
}

/** Arch outline (flat bottom, semicircular top) as a THREE.Shape / Path. */
function archPath(w, h, path = new THREE.Shape(), reverse = false) {
  const r = w / 2;
  const straight = h - r;
  if (!reverse) {
    path.moveTo(-r, 0);
    path.lineTo(r, 0);
    path.lineTo(r, straight);
    path.absarc(0, straight, r, 0, Math.PI, false);
    path.lineTo(-r, 0);
  } else {
    path.moveTo(-r, 0);
    path.lineTo(-r, straight);
    path.absarc(0, straight, r, Math.PI, 0, true);
    path.lineTo(r, 0);
    path.lineTo(-r, 0);
  }
  return path;
}

function buildDoor(P, rng, { w, h, frame: F, onFrame, color, frameColor, porthole }) {
  // built facing +Z with the bottom at y = -h/2 (frame centre at y = 0)
  const place = (geo) => onFrame(geo.translate(0, -h / 2, 0), F);
  // frame: arch ring, deep enough to bury itself in the curved wall
  const fw = 0.13;
  const outer = archPath(w + fw * 2, h + fw);
  outer.holes.push(archPath(w, h, new THREE.Path(), true));
  const frameGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 1, curveSegments: 6 });
  frameGeo.translate(0, 0, -0.34);
  grainUV(frameGeo, 'y');
  P.add('wood', place(frameGeo), frameColor);
  // threshold
  P.add('wood', place(grainUV(new THREE.BoxGeometry(w + 0.1, 0.05, 0.3), 'x').translate(0, 0.0, -0.02)), shade(frameColor, 0.04));
  // the door leaf: planks in front of the plaster, slightly recessed in the frame
  const leaf = new THREE.ExtrudeGeometry(archPath(w + 0.01, h + 0.005), { depth: 0.04, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1, curveSegments: 6 });
  leaf.translate(0, 0, -0.02);
  grainUV(leaf, 'y', 0.8);
  P.add('wood', place(leaf), color);
  const front = 0.032;
  // plank grooves
  const r = (w - 0.01) / 2;
  const straight = h - r;
  const grooveC = shade(color, -0.14);
  for (const fx of [-0.5, 0, 0.5]) {
    const x = fx * r * 0.98;
    const top = straight + Math.sqrt(Math.max(0, r * r - x * x)) - 0.05;
    P.add('detail', place(new THREE.BoxGeometry(0.02, top - 0.04, 0.012).translate(x, (top + 0.04) / 2, front)), grooveC);
  }
  // iron hinge straps with round ends and nails
  const iron = '#4a4038';
  for (const hy of [0.32, h - r - 0.12]) {
    P.add('detail', place(new THREE.BoxGeometry(w * 0.56, 0.06, 0.016).translate(-w / 2 + w * 0.28, hy, front + 0.004)), iron);
    P.add('detail', place(new THREE.CylinderGeometry(0.045, 0.045, 0.018, 10).rotateX(Math.PI / 2).translate(-w / 2 + w * 0.56, hy, front + 0.004)), iron);
    for (const nx of [0.12, 0.42]) P.add('detail', place(new THREE.SphereGeometry(0.014, 4, 2).translate(-w / 2 + w * nx, hy, front + 0.014)), '#2e2620');
  }
  // knob + back plate
  P.add('detail', place(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 10).rotateX(Math.PI / 2).translate(w * 0.32, 0.74, front + 0.004)), iron);
  P.add('detail', place(new THREE.SphereGeometry(0.045, 8, 5).translate(w * 0.32, 0.74, front + 0.05)), palette.autumnYellow);
  // porthole window in the door
  if (porthole) {
    const py = straight + 0.02;
    P.add(`glow:${palette.windowGlow}`, place(new THREE.CircleGeometry(0.13, 10).translate(0, py, front + 0.003)), palette.windowGlow);
    P.add('wood', place(new THREE.TorusGeometry(0.14, 0.03, 4, 12).translate(0, py, front + 0.01)), shade(color, -0.1));
    P.add('detail', place(new THREE.BoxGeometry(0.26, 0.02, 0.012).translate(0, py, front + 0.01)), shade(color, -0.1));
  }
}

function buildWindow(P, rng, { shape, r, phi, y, wallR, wallFrame, onFrame, frame, box, glowPts }) {
  const parts = [];
  const add = (layer, geo, color) => parts.push([layer, geo, color]);
  const glass = palette.windowGlow;
  let F;
  if (shape === 'round') {
    F = wallFrame(phi, y - r - 0.1, y + r + 0.1);
    // frame: a thick ring that buries itself in the wall + a rounded lip
    const ring = new THREE.Shape();
    ring.absarc(0, 0, r + 0.1, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, r, 0, Math.PI * 2, true);
    ring.holes.push(hole);
    const fr = new THREE.ExtrudeGeometry(ring, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.022, bevelSegments: 1, curveSegments: 7 });
    fr.translate(0, 0, -0.25);
    grainUV(fr, 'y');
    add('wood', fr, frame);
    add(`glow:${glass}`, new THREE.CircleGeometry(r + 0.01, 12).translate(0, 0, 0.0), glass);
    add('wood', new THREE.BoxGeometry(r * 2 + 0.02, 0.04, 0.035).translate(0, 0, 0.02), frame);
    add('wood', new THREE.BoxGeometry(0.04, r * 2 + 0.02, 0.035).translate(0, 0, 0.02), frame);
    add('wood', grainUV(new THREE.BoxGeometry(r * 2.3, 0.07, 0.22), 'x').translate(0, -r - 0.1, 0.03), shade(frame, 0.08));
  } else {
    const w = r * 1.75, h = r * 2.5;
    F = wallFrame(phi, y - h / 2 - 0.1, y + h / 2 + 0.08);
    const outer = archPath(w + 0.16, h + 0.08);
    outer.holes.push(archPath(w, h, new THREE.Path(), true));
    const fr = new THREE.ExtrudeGeometry(outer, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 1, curveSegments: 5 });
    fr.translate(0, -h / 2, -0.25);
    grainUV(fr, 'y');
    add('wood', fr, frame);
    const pane = new THREE.ShapeGeometry(archPath(w + 0.01, h + 0.005), 5);
    pane.translate(0, -h / 2, 0.0);
    add(`glow:${glass}`, pane, glass);
    add('wood', new THREE.BoxGeometry(0.04, h, 0.035).translate(0, 0, 0.02), frame);
    add('wood', new THREE.BoxGeometry(w, 0.04, 0.035).translate(0, -h * 0.08, 0.02), frame);
    add('wood', grainUV(new THREE.BoxGeometry(w + 0.28, 0.07, 0.22), 'x').translate(0, -h / 2 - 0.06, 0.03), shade(frame, 0.08));
    // shutters, painted, with Z-braces
    const sc = rng.pick([palette.capTeal, '#5f8f3f', palette.capCoral, palette.door]);
    for (const s of [-1, 1]) {
      const sx = s * (w / 2 + 0.1 + w * 0.24);
      const sh = grainUV(new THREE.BoxGeometry(w * 0.48, h * 0.86, 0.04), 'y');
      sh.translate(sx, -h * 0.04, -0.01);
      add('wood', sh, sc);
      for (const by of [h * 0.22, -h * 0.3]) add('detail', new THREE.BoxGeometry(w * 0.4, 0.035, 0.012).translate(sx, by, 0.015), shade(sc, -0.15));
    }
  }
  for (const [layer, geo, color] of parts) P.add(layer, onFrame(geo.translate(0, y - F.yc, 0), F), color);
  if (box) {
    const bw = shape === 'round' ? r * 2.5 : r * 2.4;
    const by = y - (shape === 'round' ? r + 0.14 : r * 1.25 + 0.1) - 0.2;
    const rr = wallR(by, phi) + 0.1;
    addFlowerBox(P, Math.sin(phi) * rr, by, Math.cos(phi) * rr, phi, { width: bw, rng, plantLayer: 'detail', flowers: 5 });
  }
  const rr = F.r + 0.16;
  glowPts.push({ x: Math.sin(phi) * rr, y, z: Math.cos(phi) * rr, size: r * 2.6 });
}

function buildBalcony(P, rng, { y, phi, wallR, frame }) {
  const r0 = wallR(y, phi);
  const depth = 0.75;
  const deck = new THREE.CylinderGeometry(r0 + depth, r0 + depth, 0.1, 20, 1, false, phi - 0.55, 1.1);
  deck.translate(0, y, 0);
  grainUV(deck, 'x');
  P.add('wood', deck, palette.oak);
  // spindles + rail along the outer arc
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const a = phi - 0.52 + (i / n) * 1.04;
    const rr = r0 + depth - 0.06;
    P.add('wood', xf(new THREE.CylinderGeometry(0.025, 0.025, 0.42, 5), [Math.sin(a) * rr, y + 0.26, Math.cos(a) * rr]), shade(palette.oak, 0.05));
  }
  const rail = new THREE.TorusGeometry(r0 + depth - 0.06, 0.035, 4, 16, 1.06);
  rail.rotateX(Math.PI / 2);
  rail.rotateY(phi + 0.53 - Math.PI / 2);
  // torus arc lies in XY after creation → rotated into XZ; align start angle
  rail.translate(0, y + 0.48, 0);
  P.add('wood', rail, palette.oak);
  // brackets
  for (const s of [-0.35, 0.35]) {
    const a = phi + s;
    P.add('wood', strut([Math.sin(a) * (r0 - 0.05), y - 0.5, Math.cos(a) * (r0 - 0.05)], [Math.sin(a) * (r0 + depth * 0.7), y - 0.04, Math.cos(a) * (r0 + depth * 0.7)], 0.035, 0.035, 4), palette.walnut);
  }
}

function buildSpots(P, rng, { count, capPoint, tTopEnd, Rc, color, reserved, mid }) {
  const placed = [];
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpD = new THREE.Vector3();
  const nrm = new THREE.Vector3(), dphi = new THREE.Vector3(), dt = new THREE.Vector3();
  const eps = 1e-3;
  const frame = (phi, t) => {
    capPoint(phi + eps, t, tmpA);
    capPoint(phi - eps, t, tmpB);
    dphi.subVectors(tmpA, tmpB).divideScalar(2 * eps);
    capPoint(phi, t + eps, tmpC);
    capPoint(phi, t - eps, tmpD);
    dt.subVectors(tmpC, tmpD).divideScalar(2 * eps);
    nrm.crossVectors(dphi, dt).normalize();
    // outwards = away from a point inside the cap
    if (nrm.x * tmpA.x + nrm.y * (tmpA.y - mid) + nrm.z * tmpA.z < 0) nrm.negate();
    return nrm;
  };
  const edgeC = shade(color, -0.06);
  let tries = 0;
  while (placed.length < count && tries < count * 30) {
    tries++;
    const t = rng.range(0.03, tTopEnd * 0.86);
    const phi = rng.range(0, Math.PI * 2);
    const rad = Rc * rng.range(0.07, 0.15) * (t < tTopEnd * 0.2 ? 1.2 : 1);
    const c = capPoint(phi, t);
    let ok = true;
    for (const p of placed) if (p.c.distanceTo(c) < (p.r + rad) * 1.25) ok = false;
    for (const res of reserved) {
      if (res[0] !== 'cap') continue;
      const rc = capPoint(res[1], res[2]);
      if (rc.distanceTo(c) < rad + res[3]) ok = false;
    }
    if (!ok) continue;
    placed.push({ c, r: rad, t, phi });
  }
  const rings = 3;
  for (const s of placed) {
    const segs = s.r > 0.32 ? 11 : 8;
    // param-space scale: how far (phi, t) move per unit of surface distance
    frame(s.phi, s.t);
    const kPhi = 1 / Math.max(dphi.length(), 1e-3);
    const kT = 1 / Math.max(dt.length(), 1e-3);
    const thick = s.r * 0.22;
    const ax = rng.range(0.85, 1.15), ay = 1 / ax;
    const rot = rng.next() * Math.PI;
    const pos = [];
    const col = [];
    const cA = new THREE.Color(color), cE = new THREE.Color(edgeC);
    const pushV = (u, v, h, c) => {
      const ru = u * Math.cos(rot) - v * Math.sin(rot);
      const rv = u * Math.sin(rot) + v * Math.cos(rot);
      const ph = s.phi + ru * kPhi;
      const tt = s.t + rv * kT;
      const p = capPoint(ph, tt, new THREE.Vector3());
      const n = frame(ph, tt);
      p.addScaledVector(n, h);
      pos.push(p.x, p.y, p.z);
      col.push(c.r, c.g, c.b);
    };
    pushV(0, 0, thick + 0.012, cA);
    for (let k = 1; k <= rings; k++) {
      const f = k / rings;
      const h = thick * Math.sqrt(Math.max(0, 1 - f * f * 0.92)) + 0.012;
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const wobble = 1 + 0.08 * Math.sin(a * 3 + s.phi * 5);
        pushV(Math.cos(a) * s.r * f * ax * wobble, Math.sin(a) * s.r * f * ay * wobble, k === rings ? 0.004 : h, k === rings ? cE : cA);
      }
    }
    const idx = [];
    for (let j = 0; j < segs; j++) idx.push(0, 1 + j, 1 + ((j + 1) % segs));
    for (let k = 1; k < rings; k++) {
      const a0 = 1 + (k - 1) * segs, b0 = 1 + k * segs;
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        idx.push(a0 + j, b0 + j, b0 + j1, a0 + j, b0 + j1, a0 + j1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // make sure the winding faces outwards
    const n0 = g.attributes.normal;
    frame(s.phi, s.t);
    if (n0.getX(0) * nrm.x + n0.getY(0) * nrm.y + n0.getZ(0) * nrm.z < 0) invert(g);
    P.add('detail', g);
  }
}
