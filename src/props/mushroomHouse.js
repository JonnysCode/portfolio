// ─────────────────────────────────────────────────────────────────────────────
// The fantasy mushroom house — the glen's signature building (refs: the red
// conical "Fairy Garden" houses, the stone mushroom cottage, the fly agaric
// between the roots).
//
//   const house = makeMushroomHouse({ seed: 'home', height: 9.5, capShape: 'cone', capColor: '#c4301f' });
//   group.add(house);
//   house.userData → { radius, height, door (ground point in front of the door), doorTarget (Object3D
//                      at the door leaf), plaque, capRadius, stemTop, rimY, chimneyTop, windows,
//                      wallPoint(φ, y), capPoint(φ, s), rimPoint(φ), interior?, doorLeaf? }
//   (all house-local; φ = 0 is the front, s = 0 apex … 1 rim)
//
// Anatomy (every part hand-made from seeded jitter, nothing ruler-straight):
//   • a bulging stem — fibrous mushroom flesh, lime plaster or fieldstone —
//     on a ring of footing stones, darkened under the cap and mossy at the foot
//   • a tall cone / bell / dome / parasol cap with a soft tip, a rolled rim
//     (optionally flared a little so the gill fringe shows from above) and a
//     painterly skin: deep crimson at the rim warming to an orange-red crown,
//     mottled with darker clouds and paler dabs, brush streaks (+ fine fibrils and
//     a velvet bloom from the cap material); real radial GILLS underneath (a band
//     of warm tan lamella ends over deep brown gaps under the rolled edge, fine
//     lamellae + lamellulae running in from it over a gill texture); torn cream
//     veil FLAKES — ragged plateaus in loose clusters, big at the crown, a fine
//     sprinkle at the rim, each in a soft contact shadow (only their rims catch a
//     faint mint glint at night); moss cushions and a few fallen leaves
//   • a ledged-and-braced plank door with strap hinges and a ring handle in an
//     arch of individual voussoirs on quoined jambs, a threshold and worn steps
//   • small framed windows (arched, square or round) with mullions, sills,
//     painted shutters and flower boxes; panes glow warm (brighter at night)
//   • a barrel-roofed dormer in the cap, a crooked chimney (stone stack,
//     stove pipe or a tiny mushroom) with curling smoke
//   • ivy climbing the walls and hanging from the rim, moss, ferns and toadstools
//   • optional `open` front: a big arched opening (with folded-back glazed
//     doors) revealing a hollow, plastered interior — the Wohnatelier
//
// Static parts are merged per material. Pass `batch` (+ `frame`) to merge
// several houses and their surroundings into the SAME draw calls (the cottage
// does); without it the house builds its own meshes (~16–19 draw calls,
// 35–55k triangles at full detail).
// Only smoke and night halos stay separate (returned in the group).
//
// Imports: this prop reuses the cottage kit (scene/cottage/kit.js, smoke.js).
// Those are leaf modules (they import only core/ and world/env/fog.js, and
// create their materials lazily on first use), so props/index.js →
// mushroomHouse.js → scene/cottage/kit.js has no import cycle. Keep it that
// way: kit.js and smoke.js must never import from props/.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import {
  Batch, mats, paramSurface, profile, paintFn, xf, mat4, board, boardBetween, rod, stoneGeo, blockStone, mossGeo,
  arcSegment, archShape, tube, Cards, addIvy, addFlower, addGrass, addFern, addToadstool, uvBox, uvPlanar, chordDisc, leafGeo,
  TAU, noiseA, noiseB, WOOD, IRON, IDENTITY, smooth01, lerp,
} from '../scene/cottage/kit.js';
import { makeSmoke } from '../scene/cottage/smoke.js';
import { glowQuads } from './glow.js';
import { propsSettings } from './ticker.js';
import { makeTextTexture } from './text.js';

/** Cap shape names of the first (low-poly) version, still accepted. */
const LEGACY_SHAPES = { tall: 'cone', flat: 'parasol', droopy: 'bell' };

/**
 * Cap profiles: [ρ / capRadius, y / capHeight] from the apex to the rim edge.
 * stem: collar height / total height. skirt: how far the rim hangs below the collar (× cap height).
 */
const CAP_SHAPES = {
  cone: {
    // steep near the soft tip, flaring into a wide skirt at the rim (concave flank)
    pts: [[0, 1], [0.04, 0.993], [0.09, 0.968], [0.15, 0.918], [0.23, 0.835], [0.33, 0.715], [0.44, 0.585], [0.55, 0.455], [0.66, 0.335], [0.76, 0.225], [0.85, 0.135], [0.92, 0.065], [0.97, 0.022], [1, 0]],
    stem: 0.5,
    skirt: 0.16,
  },
  bell: {
    pts: [[0, 1], [0.1, 0.993], [0.25, 0.955], [0.41, 0.875], [0.56, 0.755], [0.69, 0.59], [0.8, 0.4], [0.89, 0.215], [0.96, 0.075], [1, 0]],
    stem: 0.5,
    skirt: 0.13,
  },
  dome: {
    pts: [[0, 1], [0.18, 0.988], [0.36, 0.94], [0.53, 0.85], [0.68, 0.72], [0.8, 0.55], [0.89, 0.36], [0.95, 0.18], [0.985, 0.06], [1, 0]],
    stem: 0.55,
    skirt: 0.17,
  },
  parasol: {
    pts: [[0, 1], [0.14, 0.985], [0.32, 0.92], [0.5, 0.8], [0.66, 0.63], [0.79, 0.44], [0.89, 0.25], [0.96, 0.09], [1, 0]],
    stem: 0.6,
    skirt: 0.06,
  },
};

const STONE_TINTS = ['#c2ab86', '#b3a58c', '#a49c8c', '#bfa57a', '#9c8f7c', '#cbb995', '#9a978c', '#ad9a7c'];
const SHUTTER_COLORS = ['#6f8a5a', '#4f7a86', '#9b3b2c', '#c99a45', '#5d6f8f'];

let houseCount = 0;

/**
 * A fantasy mushroom house. Origin on the ground under the stem centre, front door facing +Z.
 * @param {object} [opts]
 * @param {string|number} [opts.seed]
 * @param {number} [opts.height=7]              ground → cap tip
 * @param {'cone'|'bell'|'dome'|'parasol'} [opts.capShape='cone']  (legacy 'tall' | 'flat' | 'droopy' still accepted)
 * @param {string} [opts.capColor='#c4301f']    fly agaric red (try '#d7832e' ochre, '#a77c52' tan, '#9d86b8' lavender)
 * @param {number} [opts.capRadius]             default ≈ 0.31 × height
 * @param {number} [opts.stemRadius]            default ≈ 0.2 × height
 * @param {number} [opts.stemHeight]            collar height (default by cap shape)
 * @param {'stem'|'plaster'|'stone'} [opts.stem='stem']  wall material
 * @param {string} [opts.stemColor]
 * @param {boolean|number} [opts.warts=true]    number of warts (true = auto)
 * @param {string} [opts.wartColor='#efe6cf']
 * @param {string} [opts.gillColor]             tint of the gills (warm tan by default)
 * @param {false|object} [opts.door]            { phi = 0, width = 1, height = 1.7, color } (false = no door)
 * @param {Array|number} [opts.windows]         [{ phi, y, w, h, shape: 'arch'|'rect'|'round', shutters, box, color, mullions }] or a count
 * @param {boolean} [opts.dormer]               barrel-roofed dormer window in the cap
 * @param {false|'stone'|'pipe'|'mushroom'} [opts.chimney='stone']
 * @param {boolean} [opts.smoke=true]
 * @param {number} [opts.ivy=0.6]               0..1 amount of ivy
 * @param {boolean} [opts.lantern=true]         wall lantern beside the door
 * @param {number} [opts.lean=0.25]             how far the tip leans (units)
 * @param {object} [opts.open]                  { phi = 0, width = 2.6, height = 2.5, depth = 0.55 } big arched opening (interior)
 * @param {object} [opts.capTilt]               { phi, slope } tilt the cap so its rim rises towards φ (shows the gills on that side)
 * @param {number} [opts.capFlare=0]            0..1 flare the outer cap so the rim turns slightly up (the gill fringe shows from above)
 * @param {number} [opts.capMoss=0]             number of small moss patches on the cap
 * @param {number} [opts.capLeaves]             number of fallen leaves caught on the cap (default ≈ 1.6 × capRadius)
 * @param {boolean} [opts.doorLeaf]             build the door leaf as its own little group (userData.doorLeaf, origin at
 *                                              the foot of the leaf) so it can be a hotspot that bounces on hover
 * @param {number} [opts.detail=1]              0.4..1 scales the small-detail counts
 * @param {Batch} [opts.batch]                  merge static parts into this batch …
 * @param {THREE.Matrix4} [opts.frame]          … placed by this matrix (batch space)
 * @param {Array} [opts.halos]                  collect night halos here ({x,y,z,size} in batch space) instead of a mesh
 * @param {Array} [opts.rimHalos]               collect soft warm "bounce" glows under the cap rim (above the lit windows and the
 *                                              door lantern) here ({x,y,z,size}, batch space); without it they are not made
 * @param {Array} [opts.smokeSources]           collect chimney smoke sources here instead of a smoke mesh
 * @param {boolean|string} [opts.plaque]        legacy: a painted board above the door (string = its text)
 * @returns {THREE.Group}
 */
export function makeMushroomHouse(opts = {}) {
  const seed = String(opts.seed ?? `mushroom-house-${houseCount}`);
  houseCount++;
  const rng = createRng(seed);
  const H = opts.height ?? 7;
  const capShape = CAP_SHAPES[opts.capShape] ? opts.capShape : LEGACY_SHAPES[opts.capShape] ?? 'cone';
  const detail = THREE.MathUtils.clamp(opts.detail ?? propsSettings.quality?.density ?? 1, 0.35, 1);
  const o = {
    seed,
    H,
    capShape,
    shape: CAP_SHAPES[capShape],
    Rc: opts.capRadius ?? H * 0.31,
    R: opts.stemRadius ?? H * 0.2,
    stemTop: opts.stemHeight ?? null,
    stemKind: opts.stem ?? 'stem',
    stemColor: opts.stemColor ?? (opts.stem === 'plaster' ? '#f1e4c8' : opts.stem === 'stone' ? '#b3aa98' : '#f2e2c2'),
    capColor: opts.capColor ?? '#c4301f',
    warts: opts.warts ?? true,
    wartColor: opts.wartColor ?? '#efe6cf',
    door: opts.door === false ? null : { phi: 0, width: 1.0, height: 1.72, color: WOOD.door, ...(opts.door || {}) },
    windows: opts.windows,
    dormer: opts.dormer ?? H >= 7.5,
    chimney: opts.chimney === undefined || opts.chimney === true ? 'stone' : opts.chimney,
    smoke: opts.smoke ?? true,
    ivy: opts.ivy ?? 0.6,
    lantern: opts.lantern ?? true,
    lean: opts.lean ?? 0.25,
    leanDir: opts.leanDir ?? rng.range(0, TAU),
    open: opts.open ? { phi: 0, width: 2.6, height: 2.5, depth: 0.55, ...opts.open } : null,
    flowers: opts.flowers ?? true,
    base: opts.base ?? true,
    capTilt: opts.capTilt ?? null,
    capFlare: THREE.MathUtils.clamp(opts.capFlare ?? 0, 0, 1),
    capMoss: opts.capMoss ?? 0,
    capLeaves: opts.capLeaves ?? Math.round(1.6 * (opts.capRadius ?? H * 0.31)),
    doorLeaf: !!opts.doorLeaf,
    detail,
  };
  const own = !opts.batch;
  const batch = opts.batch ?? new Batch();
  const frame = opts.frame ?? IDENTITY;
  const F = batch.at(frame);
  const info = buildHouse(F, o, rng);

  const g = new THREE.Group();
  g.name = 'mushroomHouse';
  if (own) batch.build(g, 'mushroomHouse');
  else g.applyMatrix4(frame);

  // night halos around windows & the lantern (or hand them to the caller's shared halo mesh)
  if (Array.isArray(opts.halos)) {
    const v = new THREE.Vector3();
    for (const h of info.halos) {
      v.set(h.x, h.y, h.z).applyMatrix4(frame);
      opts.halos.push({ x: v.x, y: v.y, z: v.z, size: h.size });
    }
  } else if (info.halos.length) g.add(glowQuads(info.halos, '#ffc477', { day: 0.03, night: 0.38 }));
  if (Array.isArray(opts.rimHalos)) {
    const v = new THREE.Vector3();
    for (const h of info.rimHalos) {
      v.set(h.x, h.y, h.z).applyMatrix4(frame);
      opts.rimHalos.push({ x: v.x, y: v.y, z: v.z, size: h.size });
    }
  }
  // chimney smoke (or a source for the caller's shared smoke mesh)
  if (info.chimneyTop && o.smoke) {
    const src = { x: info.chimneyTop.x, y: info.chimneyTop.y, z: info.chimneyTop.z, scale: Math.max(0.7, H / 9), rise: 2.2 + H * 0.12 };
    if (Array.isArray(opts.smokeSources)) {
      const v = new THREE.Vector3(src.x, src.y, src.z).applyMatrix4(frame);
      opts.smokeSources.push({ ...src, x: v.x, y: v.y, z: v.z });
    } else g.add(makeSmoke([src], { reducedMotion: propsSettings.reducedMotion }));
  }
  // the door leaf as its own little group (a hotspot that can bounce): origin at its foot
  let doorLeaf = null;
  if (info.leafBatch) {
    doorLeaf = new THREE.Group();
    doorLeaf.name = 'door-leaf';
    const pv = info.leafPivot;
    for (const mesh of info.leafBatch.build(doorLeaf, 'door-leaf')) {
      mesh.geometry.translate(-pv.x, -pv.y, -pv.z);
      mesh.geometry.computeBoundingSphere();
      mesh.geometry.computeBoundingBox();
      mesh.castShadow = false; // flush against the wall: its shadow is invisible
    }
    doorLeaf.position.copy(pv);
    g.add(doorLeaf);
  }
  const doorTarget = new THREE.Object3D();
  doorTarget.name = 'door';
  if (info.doorCenter) doorTarget.position.copy(info.doorCenter);
  g.add(doorTarget);

  // plaque above the door (legacy option): an anchor, plus a painted board when given text
  const plaque = new THREE.Object3D();
  plaque.name = 'plaque';
  if (info.doorCenter && o.door) {
    const r = info.collider + 0.2;
    plaque.position.set(Math.sin(o.door.phi) * r, o.door.height + 0.75, Math.cos(o.door.phi) * r);
    plaque.rotation.y = o.door.phi;
  }
  g.add(plaque);
  if (typeof opts.plaque === 'string' && info.doorCenter) {
    const tex = makeTextTexture(opts.plaque, { width: 512, height: 160, color: '#3b2a1e', background: 'wood', padding: 0.14 });
    // (own material: a texture in the materials cache key would be serialised)
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.3, 0.05), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    board.castShadow = true;
    plaque.add(board);
  }

  g.userData = {
    radius: info.collider,
    height: H,
    capRadius: o.Rc,
    stemTop: info.stemTop,
    rimY: info.rimY,
    door: info.doorGround ? info.doorGround.clone() : null,
    doorTarget,
    plaque,
    chimneyTop: info.chimneyTop ? info.chimneyTop.clone() : null,
    windows: info.windows,
    wallPoint: info.wallPoint,
    capPoint: info.capPoint,
    rimPoint: info.rimPoint,
    interior: info.interior,
    doorLeaf,
    /** { phi, s } of the dormer / chimney on the cap (null when there is none). */
    dormer: info.dormer,
    chimney: info.chimney,
    options: o,
  };
  return g;
}

// ─── builder ─────────────────────────────────────────────────────────────────

function buildHouse(F, o, rng) {
  const M = mats();
  const { H, Rc, R, shape } = o;
  const stemTop = o.stemTop ?? H * shape.stem;
  const rimY = stemTop - shape.skirt * (H - stemTop);
  const capH = H - rimY;
  const det = o.detail;
  const halos = [];
  const reserved = []; // wall areas taken: { phi, half (rad), y0, y1 }
  const capReserved = []; // cap areas taken: { phi, s, r }

  // ── lean: the whole house bends a little towards leanDir ──
  const lx = Math.sin(o.leanDir) * o.lean, lz = Math.cos(o.leanDir) * o.lean;
  const bendV = (v) => {
    if (v.y <= 0) return v;
    const k = (v.y / H) ** 2;
    v.x += lx * k;
    v.z += lz * k;
    return v;
  };
  const bendGeo = (geo) => {
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      bendV(v);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    return geo;
  };
  const put = (mat, geo, opts) => F.add(mat, bendGeo(geo), opts);

  // ── stem ──
  const ox = rng.next() * 40, oy = rng.next() * 40;
  const prof = (y) => {
    const t = Math.min(Math.max(y / stemTop, 0), 1.3);
    let r = 1 + 0.085 * Math.sin(Math.PI * Math.min(t, 1) * 0.95) - 0.16 * Math.min(t, 1);
    if (t < 0.08) r += 0.07 * (1 - t / 0.08) ** 2;
    if (t > 1) r -= (t - 1) * 0.55;
    return r * R;
  };
  // the open front: the wall is cut by a vertical plane at distance zf from the axis
  const open = o.open;
  const zf = open ? prof(stemTop * 0.5) * open.depth : 0;
  const cutA = (y) => (open ? Math.acos(Math.min(0.999, zf / prof(y))) : 0);
  const wobAmt = o.stemKind === 'stone' ? 0.02 : 0.032;
  const wob = (phi, y) => {
    const c = Math.cos(phi), s = Math.sin(phi);
    let w = 1 + wobAmt * noiseA(c * 1.2 + ox, s * 1.2 + y * 0.33) + 0.012 * noiseB(c * 3 + oy, s * 3 + y * 0.9);
    if (open) {
      // no wobble at the cut edges so they meet the facade plane exactly
      const d = Math.abs(Math.atan2(Math.sin(phi - open.phi), Math.cos(phi - open.phi))) - cutA(y);
      w = 1 + (w - 1) * smooth01(d / 0.35);
    }
    return w;
  };
  const wallR = (phi, y) => prof(y) * wob(phi, y);
  const wallP = (phi, y, out = new THREE.Vector3()) => {
    const r = wallR(phi, y);
    return out.set(Math.sin(phi) * r, y, Math.cos(phi) * r);
  };

  const yTopStem = stemTop + 0.4, yBot = -0.2;
  const circ = TAU * R;
  const nu = Math.round(56 + 24 * det), nv = Math.round(22 + 10 * det);
  const phi0 = open ? open.phi : 0;
  const stemGeo = paramSurface(
    (u, v, p) => {
      const y = yTopStem - v * (yTopStem - yBot);
      const a = open ? cutA(Math.max(y, 0)) : 0;
      const phi = phi0 + a + u * (TAU - 2 * a);
      wallP(phi, Math.max(y, 0), p);
      p.y = y;
    },
    nu,
    nv,
    {
      closedU: !open,
      uv: (u, v, p) => {
        const phi = Math.atan2(p.x, p.z);
        if (o.stemKind === 'plaster') return [(u * circ) / 2.2, p.y / 2.2];
        void phi;
        return [u * Math.max(2, Math.round(circ / 3.4)), p.y / 2.6];
      },
    }
  );
  const stemBase = new THREE.Color(o.stemColor);
  const shadeC = new THREE.Color('#8d7f68');
  const mossC = new THREE.Color('#6d7a3c');
  const dirtC = new THREE.Color('#7a6648');
  paintFn(stemGeo, o.stemColor, (x, y, z, i, c) => {
    const phi = Math.atan2(x, z);
    c.copy(stemBase);
    // hand-painted blotches & vertical streaks
    const b = noiseA(Math.cos(phi) * 2 + ox, Math.sin(phi) * 2 + y * 0.6) * 0.5 + noiseB(Math.cos(phi) * 9, y * 0.25 + Math.sin(phi) * 9) * 0.5;
    c.multiplyScalar(0.95 + 0.07 * b);
    // occlusion under the cap
    c.lerp(shadeC, 0.55 * smooth01((y - (stemTop - 1.4)) / 1.6));
    // damp, mossy foot
    const foot = 1 - smooth01(y / 0.55);
    c.lerp(dirtC, foot * 0.35);
    c.lerp(mossC, foot * 0.35 * (0.5 + 0.5 * noiseA(phi * 3 + ox, 0.5)));
  });
  const stemMat = o.stemKind === 'plaster' ? M.plaster : o.stemKind === 'stone' ? M.wallStone : M.stem;
  put(stemMat, stemGeo, { cast: true });

  // the open front: facade wall with a big arched opening, interior shell, floor & ceiling
  let interior = null;
  if (open) interior = buildOpenFront(put, o, rng, { prof, zf, stemTop, cutA, wallR, stemMat, halos });

  // ── cap ──
  const topProf = profile(shape.pts.map(([u, v]) => [u * Rc, rimY + v * capH]), 90);
  const rt = 0.08 + 0.035 * Rc; // rim thickness
  const curlPts = [[0, 0], [0.22, -0.3], [0.22, -0.72], [-0.05, -1.02], [-0.45, -1.06], [-0.85, -0.85]].map(([a, b]) => [Rc + a * rt, rimY + b * rt]);
  const curlProf = profile(curlPts, 16);
  // resolution: around ∝ cap radius, rows ∝ cap height (+ 5 rows for the rolled rim) —
  // fine enough to carry the painted mottle and the warts' contact shadows
  const capNU = Math.round((50 + 18 * Rc) * (0.7 + 0.3 * det));
  const capTopRows = Math.round((22 + 3.2 * capH) * (0.75 + 0.25 * det));
  const capCurlRows = 5;
  const VTOP = capTopRows / (capTopRows + capCurlRows);
  const cw = [rng.range(0, 6), rng.range(0, 6), rng.range(0.025, 0.045), rng.range(0.015, 0.03)];
  const tilt = [rng.jitter(0.05), rng.jitter(0.05)];
  if (o.capTilt) {
    // a jaunty tilt: the rim rises towards capTilt.phi (and dips on the far side)
    tilt[0] += Math.sin(o.capTilt.phi ?? 0) * (o.capTilt.slope ?? 0.08);
    tilt[1] += Math.cos(o.capTilt.phi ?? 0) * (o.capTilt.slope ?? 0.08);
  }
  const droopA = rng.range(0.04, 0.1) * capH * 0.12, droopP = rng.range(0, TAU);
  // flare: the outer fifth of the cap (top, rolled rim AND gills alike) lifts a little,
  // so the rim turns slightly up and the outer gill fringe faces the (higher) cameras
  const flareH = o.capFlare * Rc * 0.1;
  const capWob = (phi) => 1 + cw[2] * Math.sin(2 * phi + cw[0]) + cw[3] * Math.sin(3 * phi + cw[1]) + 0.018 * noiseA(Math.cos(phi) * 1.5 + ox, Math.sin(phi) * 1.5);
  const tmp = { r: 0, y: 0 };
  /** Deform a profile point (ρ, y) at azimuth φ into the hand-made cap. */
  const capDeform = (phi, rho, y, out) => {
    const k = Math.min(1, rho / Rc);
    const r = rho * (1 + (capWob(phi) - 1) * k ** 1.2);
    const x = Math.sin(phi) * r, z = Math.cos(phi) * r;
    let yy = y + (x * tilt[0] + z * tilt[1]) * k;
    yy -= droopA * k ** 3 * (0.5 + 0.5 * Math.sin(phi * 2 + droopP));
    if (flareH > 0 && k > 0.8) yy += flareH * ((k - 0.8) / 0.2) ** 2;
    yy += 0.035 * Rc * noiseB(x * 0.7 + oy, z * 0.7) * k * (1 - k * 0.6);
    return out.set(x, yy, z);
  };
  /** Point on the cap (before the lean): s = 0 apex … 1 rim edge (top surface), s > 1 runs over the curl. */
  const capRaw = (phi, s, out = new THREE.Vector3()) => {
    if (s <= 1) topProf.at(s, tmp);
    else curlProf.at(Math.min(1, s - 1), tmp);
    return capDeform(phi, tmp.r, tmp.y, out);
  };
  const capGeo = paramSurface(
    (u, v, p) => {
      const phi = u * TAU;
      if (v <= VTOP) capRaw(phi, v / VTOP, p);
      else capRaw(phi, 1 + (v - VTOP) / (1 - VTOP), p);
    },
    capNU,
    capTopRows + capCurlRows,
    { closedU: true, uv: (u, v) => [u * 2, v <= VTOP ? 1 - v / VTOP : 0] }
  );
  // painterly skin (as in the painted references): never one flat saturated colour. The hue
  // runs from a deep, cool crimson at the rim to a warm orange-red crown (for an ochre cap:
  // rust → golden), broken by soft blotches — darker crimson clouds, paler orange dabs where
  // the skin has stretched — and brush streaks running down from the crown. (The fine
  // fibrils and the velvet bloom are added per pixel by the cap material, kit.js velvetCap.)
  const capBase = new THREE.Color(o.capColor);
  const capHSL = { h: 0, s: 0, l: 0 };
  capBase.getHSL(capHSL);
  const hsl = (dh, ks, kl) => new THREE.Color().setHSL(capHSL.h + dh, Math.min(1, capHSL.s * ks), Math.min(0.88, capHSL.l * kl));
  const capCrown = hsl(0.03, 1.04, 1.2);
  const capRim = hsl(-0.022, 1.0, 0.6);
  const capDark = hsl(-0.014, 1.0, 0.7);
  const capBlot = hsl(-0.022, 0.98, 0.6); // darker crimson clouds
  const capPale = hsl(0.045, 0.95, 1.36); // paler orange dabs where the skin has stretched
  const cTmp = new THREE.Color();
  /** The cap skin's painted colour at a (house-local, un-bent) cap point — also used by the warts' contact shadows. */
  const capPaint = (x, y, z, c) => {
    const k = THREE.MathUtils.clamp((y - rimY) / capH, 0, 1); // 0 rim … 1 apex
    // rim → body → crown
    c.copy(capRim).lerp(capBase, smooth01(k / 0.4)).lerp(capCrown, smooth01((k - 0.42) / 0.5) * 0.85);
    // blotches: broad clouds (≈ 1 per 1.6 units) and smaller dabs
    const b1 = noiseA(x * 0.62 + ox, z * 0.62 + y * 0.45);
    const b2 = noiseB(x * 1.7 - oy, z * 1.7 + y * 0.9);
    c.lerp(capBlot, smooth01((b1 - 0.05) / 0.5) * 0.8 * (0.6 + 0.4 * (1 - k)));
    c.lerp(capPale, smooth01((-b1 - 0.22) / 0.45) * 0.55 * (0.5 + 0.5 * k));
    c.lerp(cTmp.copy(c).multiplyScalar(b2 > 0 ? 0.84 : 1.12), Math.abs(b2) * 0.6);
    // brush streaks running down the cap (coarse; the material adds the fine fibrils)
    const phi = Math.atan2(x, z);
    const st = noiseB(Math.cos(phi) * 7 + oy, Math.sin(phi) * 7 + y * 0.12);
    c.lerp(capDark, Math.max(0, st) * 0.22 * (1 - k * 0.4));
    return c;
  };
  paintFn(capGeo, o.capColor, (x, y, z, i, c) => capPaint(x, y, z, c));
  put(M.cap, capGeo, { cast: true });

  // underside: gill surface from the curl's inner end up to the collar
  const rCollar = prof(stemTop) * 1.02;
  const uStart = curlPts[curlPts.length - 1];
  const gRep = Math.max(1, Math.round((TAU * Rc) / 15)); // ~0.12 between lamellae
  const underRaw = (phi, v, out = new THREE.Vector3()) => {
    // v: 0 at the rim (curl end) → 1 at the collar; slightly concave
    const rho = lerp(uStart[0], rCollar, v);
    const y = lerp(uStart[1], stemTop - 0.02, v) - Math.sin(Math.PI * v) * 0.05 * (stemTop - rimY + 0.4);
    return capDeform(phi, rho, y, out);
  };
  const underGeo = paramSurface((u, v, p) => underRaw(u * TAU, v, p), capNU, 10, {
    closedU: true,
    uv: (u, v) => [u * gRep, v],
  });
  // warm-cream gills (as in the references): the surface between the lamellae is deep
  // in tone, so the pale lamella edges read as fine radial lines with dark gaps between
  // them; darker still towards the collar. (M.gills adds a warm bounce term on top — the
  // underside only sees cool fill light.)
  const gillC = new THREE.Color(o.gillColor ?? '#e6c493');
  const gillDeep = new THREE.Color('#7a4a2a');
  paintFn(underGeo, gillC, (x, y, z, i, c) => {
    const rho = Math.hypot(x, z);
    c.lerp(gillDeep, 0.3 + 0.45 * (1 - smooth01((rho - rCollar) / (Rc * 0.5))));
    c.multiplyScalar(1.15);
  });
  put(M.gills, underGeo, { cast: false, color: null });

  // ── the gill margin ──
  // Every spot camera sees the rim from about its height or above, so what shows of
  // the gills is their margin: the ends of crowded lamellae as a thin warm-cream band
  // just below the rolled edge, with a dark gap between each pair. It is a pleated ring
  // (ridges = lamella ends, grooves = the gaps) hanging from inside the curl to a clean,
  // even line a little below it — it closes the margin, so the bright stem never shows
  // through between the lamellae (which read as saw teeth). From below, fine lamellae
  // run in from each ridge towards the stem: full ones, lamellulae and short ones.
  // (a band of warm tan lamella ends over deep brown gaps: it reads as the shadowed gill
  //  band under the overhang, not as a bright cream fringe)
  const gillEdge = new THREE.Color(o.gillColor ?? '#e6c493').lerp(gillDeep, 0.12).multiplyScalar(0.95);
  const gillGap = gillDeep.clone().multiplyScalar(0.42);
  const gillRoot = new THREE.Color(o.gillColor ?? '#e6c493').lerp(gillDeep, 0.65);
  {
    // (their own generator; the house's main one replays the draws the previous fins made, so
    //  everything built after them — door, windows, dormer, chimney, ivy … — stays where it was)
    for (let i = Math.round(Rc * (40 + 30 * det)); i > 0; i--) rng.next();
    const grng = createRng(`${o.seed}:gill-margin`);
    const nP = Math.max(60, Math.round((TAU * Rc) / (0.064 / (0.55 + 0.45 * det)))); // lamella pitch ≈ 0.064 at full detail
    const rhoC = Rc - 0.58 * rt; // just inside the curl's lowest point
    const groove = 0.024 + 0.006 * Rc;
    const bandH = 0.07 + 0.014 * Rc; // how far the band shows below the rolled edge
    const yTop = rimY - 0.8 * rt; // hidden in the hollow of the curl
    const yMid = rimY - 1.0 * rt; // ≈ the curl's lowest line
    const yBot = rimY - 1.06 * rt - bandH;
    const ridgePhi = [];
    for (let i = 0; i < nP; i++) ridgePhi.push(((i + grng.jitter(0.18)) / nP) * TAU);
    const pos = [], col = [], uv = [], idx = [];
    const a = new THREE.Vector3();
    const rows = [
      // [y, ridge colour, gap colour] — darkest up in the hollow of the curl
      [yTop, gillRoot.clone().multiplyScalar(0.45), gillGap.clone().multiplyScalar(0.6)],
      [yMid, gillEdge.clone().multiplyScalar(0.72), gillGap],
      [yBot, gillEdge, gillGap.clone().lerp(gillEdge, 0.15)],
    ];
    const n2 = nP * 2;
    for (const [y, cR, cG] of rows) {
      for (let i = 0; i < nP; i++) {
        const tone = 0.92 + 0.1 * grng.next();
        const ph0 = ridgePhi[i];
        const ph1 = (ridgePhi[i] + ridgePhi[(i + 1) % nP] + (i === nP - 1 ? TAU : 0)) / 2;
        capDeform(ph0, rhoC, y, a);
        pos.push(a.x, a.y, a.z);
        col.push(cR.r * tone, cR.g * tone, cR.b * tone);
        capDeform(ph1, rhoC - groove, y, a);
        pos.push(a.x, a.y, a.z);
        col.push(cG.r, cG.g, cG.b);
        // (a fixed spot of the gill texture — its "lamella face" — so only the pleats draw lines)
        uv.push(0, 0.5, 0, 0.5);
      }
    }
    for (let r = 0; r < rows.length - 1; r++) {
      const r0 = r * n2, r1 = (r + 1) * n2;
      for (let j = 0; j < n2; j++) {
        const j1 = (j + 1) % n2;
        idx.push(r0 + j, r1 + j, r1 + j1, r0 + j, r1 + j1, r0 + j1);
      }
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    bg.setIndex(idx);
    bg.computeVertexNormals();
    // normals out of the cap (the gills material is double-sided: only the shading needs it)
    const bn = bg.attributes.normal;
    const bp = bg.attributes.position;
    const nIdx = n2; // a mid-row ridge vertex
    if (bn.getX(nIdx) * bp.getX(nIdx) + bn.getZ(nIdx) * bp.getZ(nIdx) < 0) {
      const ia = bg.index.array;
      for (let i = 0; i < ia.length; i += 3) [ia[i + 1], ia[i + 2]] = [ia[i + 2], ia[i + 1]];
      bg.computeVertexNormals();
    }
    put(M.gills, bg, { cast: false, color: null });

    // fine lamellae running in from the margin band (seen from below)
    const fpos = [], fcol = [], fuv = [], fidx = [];
    const dEdge = uStart[1] - yBot; // at the margin a lamella reaches down to the band's lower line
    const concave = 0.05 * (stemTop - rimY + 0.4);
    for (let f = 0; f < nP; f++) {
      const phi = ridgePhi[f];
      // full lamella / lamellula / short lamellula (the margin is crowded, the collar is not)
      const kind = f % 4 === 0 ? 0 : f % 2 === 0 ? 1 : 2;
      const v1 = kind === 0 ? 0.96 : kind === 1 ? 0.5 : 0.22;
      const segs = 4 - kind;
      const uT = Math.round((phi / TAU) * gRep * 120) / 120;
      const base = fpos.length / 3;
      for (let k = 0; k <= segs; k++) {
        const t = k / segs;
        const v = v1 * t;
        const rho = lerp(rhoC, rCollar, v);
        const yU = lerp(uStart[1], stemTop - 0.02, v) - Math.sin(Math.PI * v) * concave;
        // depth: the margin's full depth easing off inwards; tapering to nothing at the inner end
        const d = dEdge * (1 - 0.55 * smooth01(v / 0.6)) * (1 - smooth01((t - 0.55) / 0.45)) ** 0.8;
        capDeform(phi, rho, yU + 0.01, a);
        fpos.push(a.x, a.y, a.z);
        capDeform(phi, rho, yU - Math.max(d, 0.002), a);
        fpos.push(a.x, a.y, a.z);
        fcol.push(gillRoot.r, gillRoot.g, gillRoot.b, gillEdge.r, gillEdge.g, gillEdge.b);
        fuv.push(uT, v, uT + 0.001, v);
      }
      for (let k = 0; k < segs; k++) {
        const i0 = base + k * 2;
        fidx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    fg.setAttribute('color', new THREE.Float32BufferAttribute(fcol, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
    fg.setIndex(fidx);
    fg.computeVertexNormals();
    put(M.gills, fg, { cast: false, color: null });
  }

  // cap helpers (with the lean)
  const capPoint = (phi, s, out = new THREE.Vector3()) => bendV(capRaw(phi, s, out));
  const rimPoint = (phi, out = new THREE.Vector3()) => bendV(capRaw(phi, 1.02, out));
  const wallPoint = (phi, y, out = new THREE.Vector3()) => bendV(wallP(phi, y, out));

  /** Local tangent frame on the cap (un-bent) at (φ, s): { p, n, tPhi, tS, lPhi, lS }. */
  const capFrame = (phi, s) => {
    const e = 1e-3;
    const p = capRaw(phi, s);
    const a = capRaw(phi + e, s), b = capRaw(phi - e, s);
    const c = capRaw(phi, Math.min(1, s + e)), d = capRaw(phi, Math.max(0, s - e));
    const tPhi = a.sub(b).divideScalar(2 * e);
    const tS = c.sub(d).divideScalar(Math.min(1, s + e) - Math.max(0, s - e));
    const lPhi = Math.max(tPhi.length(), 1e-4), lS = Math.max(tS.length(), 1e-4);
    const n = new THREE.Vector3().crossVectors(tS, tPhi).normalize();
    if (n.x * p.x + n.y * (p.y - rimY) + n.z * p.z < 0) n.negate();
    return { p, n, tPhi: tPhi.normalize(), tS: tS.normalize(), lPhi, lS };
  };

  // ── door ──
  let doorCenter = null, doorGround = null;
  const floorY = 0.24;
  let leafBatch = null, leafPivot = null;
  if (o.door) {
    if (o.doorLeaf) leafBatch = new Batch();
    const putLeaf = leafBatch ? (mat, geo, opts) => leafBatch.add(mat, bendGeo(geo), opts) : put;
    const d = buildDoor(put, o, rng, { wallR, floorY, halos, lantern: o.lantern, putLeaf });
    doorCenter = d.center;
    doorGround = d.ground;
    if (leafBatch) leafPivot = bendV(d.pivot);
    reserved.push({ phi: o.door.phi, half: (o.door.width * 0.5 + 0.55) / prof(1), y0: -1, y1: floorY + o.door.height + 0.6 });
  }
  if (open) reserved.push({ phi: open.phi, half: cutA(1) + 0.35, y0: -1, y1: stemTop + 1 });

  // ── windows ──
  const windows = [];
  let winSpecs = o.windows;
  if (!Array.isArray(winSpecs)) {
    const count = typeof winSpecs === 'number' ? winSpecs : stemTop > 3.6 ? 4 : stemTop > 2.6 ? 3 : 2;
    const two = stemTop > 3.6;
    const dp = o.door ? o.door.phi : 0;
    const cands = [
      { phi: dp + rng.range(0.95, 1.2), y: 1.25 },
      { phi: dp - rng.range(0.95, 1.2), y: 1.25, shape: 'round' },
      two ? { phi: dp + rng.jitter(0.25), y: Math.min(stemTop - 0.75, 3.05), w: 0.55, h: 0.7 } : { phi: dp + Math.PI + rng.jitter(0.4), y: 1.25 },
      two ? { phi: dp + Math.PI * 0.75, y: Math.min(stemTop - 0.75, 3.0), w: 0.5, h: 0.62 } : { phi: dp - 2.2, y: 1.2 },
      { phi: dp + Math.PI + rng.jitter(0.3), y: 1.25 },
    ];
    winSpecs = cands.slice(0, count);
  }
  winSpecs.forEach((w, i) => {
    const spec = {
      phi: w.phi,
      y: w.y ?? 1.25,
      w: w.w ?? 0.62,
      h: w.h ?? (w.shape === 'round' ? w.w ?? 0.62 : 0.82),
      shape: w.shape ?? (i % 3 === 2 ? 'rect' : 'arch'),
      shutters: w.shutters ?? (w.shape !== 'round' && rng.chance(0.6)),
      box: w.box ?? (o.flowers && (w.y ?? 1.25) < 2 && w.shape !== 'round' && rng.chance(0.8)),
      color: w.color ?? rng.pick(SHUTTER_COLORS),
      mullions: w.mullions ?? true,
    };
    if (spec.shape === 'round') spec.h = spec.w;
    if (open) {
      const dd = Math.abs(Math.atan2(Math.sin(spec.phi - open.phi), Math.cos(spec.phi - open.phi)));
      if (dd < cutA(spec.y) + 0.45) return;
    }
    windows.push(buildWindow(put, o, rng, spec, { wallR, halos }));
    reserved.push({ phi: spec.phi, half: (spec.w * 0.5 + (spec.shutters ? spec.w * 0.6 : 0.2)) / prof(spec.y), y0: spec.y - spec.h / 2 - 0.5, y1: spec.y + spec.h / 2 + 0.3 });
  });

  // ── footing stones ──
  if (o.base) {
    const n = Math.round(TAU * R / 0.3);
    for (let i = 0; i < n; i++) {
      const phi = (i / n) * TAU + rng.jitter(0.05);
      if (o.door && Math.abs(Math.atan2(Math.sin(phi - o.door.phi), Math.cos(phi - o.door.phi))) < 0.42) continue;
      if (open && Math.abs(Math.atan2(Math.sin(phi - open.phi), Math.cos(phi - open.phi))) < cutA(0.1)) continue;
      const r = wallR(phi, 0.08) + 0.02;
      const sz = rng.range(0.15, 0.24);
      const st = stoneGeo(rng, { r: sz, sx: rng.range(1.1, 1.5), sy: rng.range(0.7, 0.95), sz: 0.8, lump: 0.2, detail: 'low' });
      xf(st, [Math.sin(phi) * r, sz * 0.35, Math.cos(phi) * r], [0, phi + rng.jitter(0.2), 0]);
      put(M.stone, st, { cast: false, color: rng.pick(STONE_TINTS) });
      if (rng.chance(0.3)) {
        const r2 = r + 0.12;
        const s2 = stoneGeo(rng, { r: sz * 0.7, sx: 1.2, sy: 0.7, sz: 0.9, detail: 'low' });
        xf(s2, [Math.sin(phi + 0.07) * r2, sz * 0.2, Math.cos(phi + 0.07) * r2], [0, rng.next() * 3, 0]);
        put(M.stone, s2, { cast: false, color: rng.pick(STONE_TINTS) });
      }
    }
  }

  // ── warts ──
  const dorm = o.dormer ? { phi: (o.door ? o.door.phi : 0) + rng.pick([-1, 1]) * rng.range(0.35, 0.7), s: shape === CAP_SHAPES.cone ? 0.56 : 0.5 } : null;
  const chim = o.chimney ? { phi: (dorm ? dorm.phi : 0) + rng.pick([-1, 1]) * rng.range(1.4, 2.2), s: o.chimney === 'mushroom' ? 0.42 : 0.38 } : null;
  if (dorm) capReserved.push({ phi: dorm.phi, s: dorm.s, r: 0.95 });
  if (chim) capReserved.push({ phi: chim.phi, s: chim.s, r: 0.55 });
  if (o.warts) buildWarts(put, o, rng, { capRaw, capFrame, capReserved, capPaint, count: typeof o.warts === 'number' ? o.warts : Math.round(Rc * Rc * (7 + 4.5 * det)) });
  // a few small cushions of moss that have taken hold on the cap
  if (o.capMoss > 0) {
    const tmpR = new THREE.Vector3();
    const n = Math.round(o.capMoss * (0.5 + 0.5 * det));
    for (let i = 0, tries = 0; i < n && tries < n * 20; tries++) {
      const phi = rng.next() * TAU;
      const s = rng.range(0.3, 0.92);
      const p0 = capRaw(phi, s);
      if (capReserved.some((r) => capRaw(r.phi, r.s, tmpR).distanceTo(p0) < r.r + 0.35)) continue;
      const f = capFrame(phi, s);
      const r = Rc * rng.range(0.035, 0.07);
      const g = mossGeo(rng, { r, h: r * rng.range(0.35, 0.5), sx: rng.range(1, 1.5), sz: rng.range(0.7, 1) });
      g.rotateY(rng.next() * TAU);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), f.n));
      put(M.moss, g.translate(f.p.x - f.n.x * 0.012, f.p.y - f.n.y * 0.012, f.p.z - f.n.z * 0.012), { cast: false });
      i++;
    }
  }
  // a few fallen leaves caught on the cap (own generator: nothing after them moves)
  if (o.capLeaves > 0) {
    const lrng = createRng(`${o.seed}:cap-leaves`);
    const tmpR = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const n = Math.round(o.capLeaves * (0.5 + 0.5 * det));
    for (let i = 0, tries = 0; i < n && tries < n * 20; tries++) {
      const phi = lrng.next() * TAU;
      const s = lrng.range(0.28, 0.9);
      const p0 = capRaw(phi, s);
      if (capReserved.some((r) => capRaw(r.phi, r.s, tmpR).distanceTo(p0) < r.r + 0.3)) continue;
      const f = capFrame(phi, s);
      const len = lrng.range(0.16, 0.26) * Math.min(1.25, 0.7 + Rc * 0.12);
      const g = leafGeo(len, lrng.range(0.5, 0.7), lrng.range(0.3, 0.6), 3);
      g.translate(0, -len * 0.45, 0);
      g.rotateZ(lrng.next() * TAU);
      g.rotateX(-Math.PI / 2);
      g.applyQuaternion(q.setFromUnitVectors(up, f.n));
      put(M.leafy, g.translate(f.p.x + f.n.x * 0.012, f.p.y + f.n.y * 0.012, f.p.z + f.n.z * 0.012), {
        cast: false,
        color: lrng.pick(['#c98a3a', '#b5652e', '#d2a24a', '#9b4f2a', '#a9a046', '#c47a35']),
      });
      i++;
    }
  }

  // ── dormer ── (its barrel roof painted like the skin around it)
  if (dorm) {
    const dp = capRaw(dorm.phi, dorm.s);
    o.dormColor = '#' + capPaint(dp.x, dp.y, dp.z, new THREE.Color()).multiplyScalar(0.92).getHexString();
    buildDormer(put, o, rng, { capFrame, capRaw, dorm, halos });
  }

  // ── chimney ──
  let chimneyTop = null;
  if (chim) chimneyTop = buildChimney(put, o, rng, { capFrame, chim, bendV });

  // ── ivy ──
  if (o.ivy > 0) buildIvy(put, o, rng, { wallR, stemTop, reserved, capRaw, capFrame, open });

  // ── around the base: moss, ferns, grass, toadstools ──
  if (o.base) {
    const nB = Math.round((8 + R * 5) * det);
    for (let i = 0; i < nB; i++) {
      const phi = rng.next() * TAU;
      if (o.door && Math.abs(Math.atan2(Math.sin(phi - o.door.phi), Math.cos(phi - o.door.phi))) < 0.5) continue;
      if (open && Math.abs(Math.atan2(Math.sin(phi - open.phi), Math.cos(phi - open.phi))) < cutA(0.1) + 0.3) continue;
      const r = wallR(phi, 0.05) + rng.range(0.15, 0.55);
      const x = Math.sin(phi) * r, z = Math.cos(phi) * r;
      const roll = rng.next();
      if (roll < 0.3) put(M.moss, xf(mossGeo(rng, { r: rng.range(0.18, 0.34), h: rng.range(0.06, 0.12) }), [x, 0, z], [0, rng.next() * 3, 0]), { cast: false });
      else if (roll < 0.55) addGrass(F, rng, x, 0, z, { size: rng.range(0.25, 0.42), blades: 3 });
      else if (roll < 0.75) addFern(F, rng, x, 0, z, { size: rng.range(0.35, 0.6), fronds: rng.int(5, 8) });
      else addToadstool(F, rng, x, 0, z, { size: rng.range(0.07, 0.14), color: rng.pick(['#c4301f', '#c4301f', '#b8562a', '#a77c52']) });
    }
  }

  // soft warm "bounce" glows under the rim, above the lit windows and the door lantern
  // (the gills catch the window & porch light at night)
  const rimHalos = [];
  {
    const add = (phi, near) => {
      const p = underRaw(phi, 0.38);
      p.y -= 0.12;
      const b = bendV(p);
      rimHalos.push({ x: b.x, y: b.y, z: b.z, size: (0.9 + 0.35 * Rc) * near });
    };
    for (const w of windows) {
      // windows high on the wall light the gills strongly, low ones only a little
      const near = 0.55 + 0.45 * smooth01((w.y - stemTop * 0.35) / (stemTop * 0.5));
      add(w.phi, near);
    }
    if (o.door) add(o.door.phi, 0.9);
  }

  const collider = prof(0.1) * 0.98;
  return {
    halos,
    rimHalos,
    dormer: dorm ? { phi: dorm.phi, s: dorm.s } : null,
    chimney: chim ? { phi: chim.phi, s: chim.s, top: chimneyTop ? chimneyTop.clone() : null } : null,
    collider,
    stemTop,
    rimY,
    doorCenter: doorCenter ? bendV(doorCenter) : null,
    doorGround,
    chimneyTop,
    windows: windows.map((w) => ({ ...w, pos: bendV(w.pos), sill: bendV(w.sill) })),
    wallPoint,
    capPoint,
    rimPoint,
    interior,
    leafBatch,
    leafPivot,
  };
}

// ─── wall frames ─────────────────────────────────────────────────────────────
/**
 * A placement frame for a flat feature on the curved wall spanning [y0, y1] at φ:
 * tilted to the wall's slope and pushed out so its z = 0 plane sits just in
 * front of the plaster. Returns { m (Matrix4), r, yc }.
 */
function wallFrame(wallR, phi, y0, y1, margin = 0.01, halfW = 0.45) {
  const yc = (y0 + y1) / 2;
  const slope = (wallR(phi, y1) - wallR(phi, y0)) / (y1 - y0);
  // the plane must clear the (wobbly, curved) wall across the feature's whole width
  let dev = 0;
  const r0 = wallR(phi, yc);
  for (let i = 0; i <= 8; i++) {
    const y = y0 + ((y1 - y0) * i) / 8;
    const plane = r0 + (y - yc) * slope;
    for (let k = -3; k <= 3; k++) {
      const x = (halfW * k) / 3;
      const da = Math.asin(Math.max(-0.95, Math.min(0.95, x / Math.max(r0, 0.3))));
      const along = wallR(phi + da, y) * Math.cos(da);
      dev = Math.max(dev, along - plane);
    }
  }
  const r = r0 + dev + margin;
  const m = mat4([Math.sin(phi) * r, yc, Math.cos(phi) * r], [Math.atan(slope), phi, 0, 'YXZ']);
  return { m, r, yc };
}

// ─── door ────────────────────────────────────────────────────────────────────
function buildDoor(put, o, rng, { wallR, floorY, halos, lantern, putLeaf = put }) {
  const M = mats();
  const { phi, width: w, height: h, color } = o.door;
  const r = w / 2;
  const hs = h - r; // straight part
  const y0 = floorY;
  const fr = wallFrame(wallR, phi, y0, y0 + h + 0.25, -0.03, w * 0.5);
  const T = new THREE.Matrix4().makeTranslation(0, y0 - fr.yc, 0);
  const at = (geo) => geo.applyMatrix4(T).applyMatrix4(fr.m);
  const atP = (v) => v.applyMatrix4(T).applyMatrix4(fr.m);
  // an untilted frame at the foot of the door for the threshold & steps
  const flat = mat4([Math.sin(phi) * fr.r, y0, Math.cos(phi) * fr.r], [0, phi, 0]);
  const atFlat = (geo) => geo.applyMatrix4(flat);
  const leafZ = -0.02;

  // dark reveal behind the door (reads as depth)
  const rev = new THREE.ShapeGeometry(archShape(w + 0.08, hs, { y: -0.02 }), 8);
  put(M.vc, at(rev.translate(0, 0, leafZ - 0.03)), { color: '#24190f', cast: false });

  // plank leaf
  const nP = Math.max(4, Math.round(w / 0.19));
  const pw = w / nP;
  const yTop = (x) => hs + Math.sqrt(Math.max(0, r * r - x * x));
  for (let i = 0; i < nP; i++) {
    const x0 = -r + i * pw + 0.006, x1 = -r + (i + 1) * pw - 0.006;
    const s = new THREE.Shape();
    s.moveTo(x0, 0);
    s.lineTo(x1, 0);
    const steps = 4;
    for (let k = 0; k <= steps; k++) {
      const x = x1 + ((x0 - x1) * k) / steps;
      s.lineTo(x, yTop(x) - 0.004);
    }
    s.lineTo(x0, 0);
    const pg = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 4 });
    uvBox(pg, 'y', 1 / 1.4, [rng.next() * 7, rng.next() * 7]);
    const tone = new THREE.Color(color).multiplyScalar(rng.range(0.86, 1.1));
    putLeaf(M.wood, at(pg.translate(0, 0, leafZ)), { color: '#' + tone.getHexString(), cast: false });
  }
  const front = leafZ + 0.056;
  // ledges + a diagonal brace
  const ledgeC = new THREE.Color(color).multiplyScalar(0.82).getHexString();
  const ly = [0.3, Math.min(hs - 0.05, h * 0.62)];
  for (const yy of ly) putLeaf(M.wood, at(board(w - 0.06, 0.11, 0.035, { along: 'x', rng }).translate(0, yy, front + 0.017)), { color: '#' + ledgeC, cast: false });
  putLeaf(M.wood, at(boardBetween([-r + 0.12, ly[0] + 0.05, front + 0.012], [r - 0.12, ly[1] - 0.05, front + 0.012], 0.09, 0.03, { up: [0, 0, 1] })), { color: '#' + ledgeC, cast: false });
  // strap hinges with nails (hinge side −x)
  for (const yy of ly) {
    const strap = new THREE.BoxGeometry(w * 0.62, 0.045, 0.012).translate(-r + w * 0.31, yy, front + 0.04);
    putLeaf(M.metal, at(strap), { color: IRON, cast: false });
    putLeaf(M.metal, at(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 8).rotateX(Math.PI / 2).translate(-r + w * 0.62, yy, front + 0.04)), { color: IRON, cast: false });
    for (const k of [0.1, 0.3, 0.5]) putLeaf(M.metal, at(new THREE.SphereGeometry(0.011, 5, 3).translate(-r + w * k, yy, front + 0.048)), { color: '#2a2622', cast: false });
    putLeaf(M.metal, at(new THREE.CylinderGeometry(0.022, 0.022, 0.09, 6).translate(-r - 0.01, yy, front + 0.01)), { color: IRON, cast: false });
  }
  // ring handle, keyhole plate
  const hy = 0.92;
  putLeaf(M.metal, at(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 10).rotateX(Math.PI / 2).translate(r * 0.62, hy, front + 0.008)), { color: IRON, cast: false });
  putLeaf(M.metal, at(new THREE.TorusGeometry(0.06, 0.011, 5, 12).translate(r * 0.62, hy - 0.065, front + 0.025)), { color: '#4a4038', cast: false });
  putLeaf(M.metal, at(new THREE.BoxGeometry(0.05, 0.1, 0.01).translate(r * 0.62, hy - 0.2, front + 0.006)), { color: IRON, cast: false });
  // a little round peep window with bars
  const py = hs + r * 0.25;
  putLeaf(M.glow, at(new THREE.CircleGeometry(0.1, 12).translate(0, py, front + 0.004)), { cast: false });
  putLeaf(M.metal, at(new THREE.TorusGeometry(0.105, 0.016, 5, 14).translate(0, py, front + 0.012)), { color: IRON, cast: false });
  for (const dx of [-0.035, 0.035]) putLeaf(M.metal, at(new THREE.BoxGeometry(0.012, 0.2, 0.012).translate(dx, py, front + 0.016)), { color: IRON, cast: false });

  // stone arch: voussoirs + keystone
  const rin = r + 0.015;
  const nV = 9;
  for (let i = 0; i < nV; i++) {
    const a0 = (i / nV) * Math.PI, a1 = ((i + 1) / nV) * Math.PI;
    const key = i === (nV - 1) / 2;
    const t = (key ? 0.3 : rng.range(0.2, 0.27));
    const dep = rng.range(0.26, 0.32) + (key ? 0.03 : 0);
    const seg = arcSegment(rin, rin + t, a0 + 0.012, a1 - 0.012, dep, 2, 0.012);
    seg.rotateZ(rng.jitter(0.015));
    seg.translate(rng.jitter(0.008), hs + rng.jitter(0.008), rng.jitter(0.015) + (key ? 0.03 : 0));
    put(M.stone, at(seg), { color: rng.pick(STONE_TINTS), cast: false });
  }
  // jambs (quoins): alternating long and short blocks
  for (const side of [-1, 1]) {
    let y = -0.02;
    let k = side > 0 ? 1 : 0;
    while (y < hs - 0.05) {
      const bh = Math.min(rng.range(0.25, 0.34), hs - y + 0.02);
      const bw = k % 2 ? rng.range(0.3, 0.36) : rng.range(0.2, 0.25);
      const bd = rng.range(0.26, 0.32);
      const st = blockStone(rng, bw, bh - 0.02, bd, 0.08);
      st.translate(side * (rin + bw / 2), y + bh / 2, rng.jitter(0.012));
      put(M.stone, at(st), { color: rng.pick(STONE_TINTS), cast: false });
      y += bh;
      k++;
    }
  }
  // threshold & steps
  put(M.stone, atFlat(blockStone(rng, w + 0.5, 0.12, 0.5, 0.06).translate(0, -0.06, 0.14)), { color: '#a39d90', cast: true });
  const steps = [
    { w: w + 0.75, d: 0.55, y: -y0 / 2 - 0.02, z: 0.55 },
    { w: w + 1.1, d: 0.6, y: -y0 + 0.02, z: 1.0 },
  ];
  for (const s of steps) {
    const st = stoneGeo(rng, { r: 1, sx: s.w / 2, sy: 0.09, sz: s.d / 2, lump: 0.12, flatTop: 0.4 });
    put(M.stone, atFlat(st.translate(rng.jitter(0.05), s.y, s.z)), { color: rng.pick(STONE_TINTS), cast: true });
  }

  // wall lantern on an iron bracket beside the door
  if (lantern) {
    const side = rng.chance(0.5) ? 1 : -1;
    const lx = side * (rin + 0.55), ly = hs + 0.25;
    put(M.metal, at(new THREE.BoxGeometry(0.08, 0.22, 0.03).translate(lx, ly, -0.05)), { color: IRON, cast: false });
    const arm = [[lx, ly + 0.05, -0.05], [lx, ly + 0.12, 0.15], [lx, ly + 0.1, 0.3], [lx, ly + 0.02, 0.36]];
    put(M.metal, at(tube(arm, 0.014, 4, 10)), { color: IRON, cast: false });
    put(M.metal, at(tube([[lx, ly - 0.08, -0.05], [lx, ly - 0.02, 0.1], [lx, ly + 0.08, 0.2]], 0.01, 4, 8)), { color: IRON, cast: false });
    addLantern(put, at, lx, ly - 0.08, 0.36, 1, halos, atP);
  }

  const center = atP(new THREE.Vector3(0, hs * 0.75, 0.08));
  const ground = new THREE.Vector3(Math.sin(phi) * (fr.r + 1.3), 0, Math.cos(phi) * (fr.r + 1.3));
  const pivot = atP(new THREE.Vector3(0, 0, leafZ + 0.03)); // foot of the leaf (bounce origin)
  return { center, ground, pivot };
}

/** A little iron lantern hanging at (x, top y, z) in a frame (via `at`; atP maps points for the halo), glass glows. */
export function addLantern(put, at, x, y, z, s = 1, halos = null, atP = null) {
  const M = mats();
  const w = 0.17 * s, h = 0.24 * s;
  const yb = y - 0.06 * s - h;
  put(M.metal, at(new THREE.TorusGeometry(0.03 * s, 0.007 * s, 4, 8).translate(x, y, z)), { color: IRON, cast: false });
  // pyramid roof
  const roof = new THREE.ConeGeometry(w * 0.85, 0.11 * s, 4, 1).rotateY(Math.PI / 4).translate(x, yb + h + 0.055 * s, z);
  put(M.metal, at(roof), { color: '#2f2a26', cast: false });
  put(M.metal, at(new THREE.BoxGeometry(w * 1.1, 0.025 * s, w * 1.1).translate(x, yb + h, z)), { color: IRON, cast: false });
  put(M.metal, at(new THREE.BoxGeometry(w * 1.05, 0.03 * s, w * 1.05).translate(x, yb, z)), { color: IRON, cast: false });
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) put(M.metal, at(new THREE.BoxGeometry(0.014 * s, h, 0.014 * s).translate(x + (dx * w) / 2, yb + h / 2, z + (dz * w) / 2)), { color: IRON, cast: false });
  put(M.lamp, at(new THREE.BoxGeometry(w * 0.9, h * 0.92, w * 0.9).translate(x, yb + h / 2, z)), { cast: false });
  if (halos && atP) {
    const p = atP(new THREE.Vector3(x, yb + h / 2, z));
    halos.push({ x: p.x, y: p.y, z: p.z, size: 0.8 * s });
  }
}

// ─── windows ─────────────────────────────────────────────────────────────────
/**
 * A window pane as a small grid (so a colour gradient can run across it): half width r,
 * straight sides of height hs from y0, then (arch > 0) a semicircular head of radius r.
 */
export function paneGrid(r, hs, y0, arch, cols = 6, rows = 8) {
  const h = hs + arch;
  const pos = [], idx = [];
  for (let j = 0; j <= rows; j++) {
    const y = y0 + (j / rows) * h;
    const dy = y - (y0 + hs);
    const hw = arch > 0 && dy > 0 ? Math.sqrt(Math.max(0, arch * arch - dy * dy)) : r;
    for (let i = 0; i <= cols; i++) pos.push((-1 + (2 * i) / cols) * hw, y, 0);
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + cols + 1;
      idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const PANE_HONEY = new THREE.Color('#ffe2ab');
const PANE_AMBER = new THREE.Color('#e88a3a');
const PANE_EMBER = new THREE.Color('#b8562a');
/**
 * Paint a lamp-lit pane (vertex colours for M.pane): bright honey low in the middle where
 * the lamp stands, deepening to amber towards the head and the frame, and on some windows a
 * drawn curtain darkening one side. The pane spans x ∈ [−r, r], y ∈ [y0, y0 + h].
 */
function warmPane(g, r, y0, h, seedPhi) {
  const curtain = Math.sin(seedPhi * 7.3 + 1.1); // > 0.35: a curtain drawn on one side
  const side = Math.sin(seedPhi * 3.1) > 0 ? 1 : -1;
  return paintFn(g, '#ffffff', (x, y, z, i, c) => {
    const u = x / r, v = (y - y0) / h;
    const hot = Math.exp(-((u * 1.1) ** 2) - ((v - 0.3) / 0.45) ** 2); // the lamp's glow
    c.copy(PANE_AMBER).lerp(PANE_HONEY, 0.25 + 0.75 * hot).multiplyScalar(1.12 - 0.3 * v * v);
    c.lerp(PANE_EMBER, smooth01((Math.abs(u) - 0.55) / 0.45) * 0.45);
    if (curtain > 0.35) c.lerp(PANE_EMBER, smooth01((u * side - 0.25) / 0.3) * 0.55);
  });
}

function buildWindow(put, o, rng, spec, { wallR, halos }) {
  const M = mats();
  const { phi, y, w, h, shape } = spec;
  const fr = wallFrame(wallR, phi, y - h / 2 - 0.12, y + h / 2 + 0.1, 0.012, w * 0.5 + 0.05);
  const T = new THREE.Matrix4().makeTranslation(0, y - fr.yc, 0);
  const at = (geo) => geo.applyMatrix4(T).applyMatrix4(fr.m);
  const frameC = rng.pick([WOOD.walnut, WOOD.oak, '#6b4a33', '#7d5a3c']);
  const fd = 0.12; // frame depth (sticks out of the wall)
  const r = w / 2;
  if (shape === 'round') {
    put(M.vc, at(new THREE.CircleGeometry(r + 0.03, 16).translate(0, 0, -0.02)), { color: '#22180f', cast: false });
    put(M.pane, at(warmPane(new THREE.CircleGeometry(r, 16), r, -r, 2 * r, phi)), { cast: false, color: null });
    const ring = arcSegment(r, r + 0.09, 0, TAU, fd, 18, 0.01);
    put(M.wood, at(uvBox(ring, 'x').translate(0, 0, fd / 2 - 0.03)), { color: frameC, cast: false });
    put(M.wood, at(board(w, 0.035, 0.03, { along: 'x' }).translate(0, 0, 0.02)), { color: frameC, cast: false });
    put(M.wood, at(board(0.035, w, 0.03, { along: 'y' }).translate(0, 0, 0.02)), { color: frameC, cast: false });
  } else {
    const hs = shape === 'arch' ? h - r : h;
    const y0 = -h / 2;
    // dark reveal, then the pane
    const outline = shape === 'arch' ? archShape(w + 0.04, hs, { y: y0 - 0.02 }) : new THREE.Shape().moveTo(-r - 0.02, y0 - 0.02).lineTo(r + 0.02, y0 - 0.02).lineTo(r + 0.02, y0 + h + 0.02).lineTo(-r - 0.02, y0 + h + 0.02).lineTo(-r - 0.02, y0 - 0.02);
    put(M.vc, at(new THREE.ShapeGeometry(outline, 8).translate(0, 0, -0.03)), { color: '#22180f', cast: false });
    const pane = warmPane(paneGrid(r, hs, y0, shape === 'arch' ? r : 0), r, y0, h, phi);
    put(M.pane, at(pane.translate(0, 0, -0.005)), { cast: false, color: null });
    // frame: sides, head, sill
    const fw = 0.075;
    for (const s of [-1, 1]) put(M.wood, at(board(fw, hs + 0.02, fd, { along: 'y', rng }).translate(s * (r + fw / 2), y0 + hs / 2, fd / 2 - 0.03)), { color: frameC, cast: false });
    if (shape === 'arch') {
      const head = arcSegment(r, r + fw, 0, Math.PI, fd, 8, 0.008);
      put(M.wood, at(uvBox(head, 'x').translate(0, y0 + hs, fd / 2 - 0.03)), { color: frameC, cast: false });
    } else {
      put(M.wood, at(board(w + fw * 2 + 0.06, fw * 1.2, fd + 0.02, { along: 'x', rng }).translate(0, y0 + h + fw * 0.6, fd / 2 - 0.02)), { color: frameC, cast: false });
    }
    put(M.wood, at(board(w + 0.26, 0.065, fd + 0.13, { along: 'x', rng }).translate(0, y0 - 0.035, fd / 2 + 0.03)), { color: frameC, cast: true });
    // mullions: cross (+ an extra bar in tall windows)
    if (spec.mullions) {
      put(M.wood, at(board(0.032, hs + (shape === 'arch' ? r * 0.9 : 0), 0.035, { along: 'y' }).translate(0, y0 + (hs + (shape === 'arch' ? r * 0.9 : 0)) / 2, 0.012)), { color: frameC, cast: false });
      put(M.wood, at(board(w, 0.032, 0.035, { along: 'x' }).translate(0, y0 + hs * 0.55, 0.012)), { color: frameC, cast: false });
    }
    // shutters, opened out
    if (spec.shutters) {
      for (const s of [-1, 1]) {
        const sw = w * 0.5 + 0.03;
        const sh = Math.min(hs + r * 0.55, h);
        const hinge = new THREE.Matrix4().makeTranslation(s * (r + fw), y0 + sh / 2 - 0.01, 0.02);
        const open = new THREE.Matrix4().makeRotationY(s * 2.45);
        const nB = 3;
        for (let k = 0; k < nB; k++) {
          const bw = sw / nB;
          const pl = board(bw - 0.008, sh, 0.03, { along: 'y', rng });
          pl.translate(-s * (bw * (k + 0.5)), 0, 0);
          pl.applyMatrix4(open).applyMatrix4(hinge);
          put(M.wood, at(pl), { color: '#' + new THREE.Color(spec.color).multiplyScalar(rng.range(0.9, 1.08)).getHexString(), cast: false });
        }
        for (const by of [-sh * 0.32, sh * 0.32]) {
          const ledge = board(sw - 0.04, 0.06, 0.02, { along: 'x' }).translate(-s * (sw / 2), by, -0.022);
          ledge.applyMatrix4(open).applyMatrix4(hinge);
          put(M.wood, at(ledge), { color: '#' + new THREE.Color(spec.color).multiplyScalar(0.8).getHexString(), cast: false });
        }
      }
    }
  }
  // flower box under the sill
  const sillY = shape === 'round' ? -r - 0.1 : -h / 2 - 0.07;
  if (spec.box) {
    const bw = w + 0.3, bh = 0.17, bd = 0.2;
    const by = sillY - 0.03 - bh / 2;
    const bz = 0.14;
    for (const [sx, sy, sz, px, py, pz] of [
      [bw, bh, 0.025, 0, by, bz + bd / 2],
      [bw, bh, 0.025, 0, by, bz - bd / 2],
      [0.025, bh, bd, -bw / 2, by, bz],
      [0.025, bh, bd, bw / 2, by, bz],
      [bw, 0.025, bd, 0, by - bh / 2, bz],
    ]) put(M.wood, at(board(sx, sy, sz, { along: sx > sz ? 'x' : 'z', rng }).translate(px, py, pz)), { color: WOOD.weathered, cast: false });
    put(M.soil, at(new THREE.BoxGeometry(bw - 0.04, 0.02, bd - 0.03).translate(0, by + bh / 2 - 0.03, bz)), { cast: false });
    // brackets
    for (const s of [-1, 1]) put(M.metal, at(new THREE.BoxGeometry(0.02, 0.16, 0.02).rotateX(0.7).translate(s * bw * 0.35, by - bh / 2 - 0.05, bz - 0.05)), { color: IRON, cast: false });
    // flowers & leaves (into the frame's coordinates through a tiny adapter)
    const FF = { add: (mat, geo, opts) => put(mat, at(geo), opts) };
    const nF = Math.round(5 + w * 6);
    for (let i = 0; i < nF; i++) {
      const fx = rng.range(-bw / 2 + 0.06, bw / 2 - 0.06);
      addFlower(FF, rng, fx, by + bh / 2 - 0.03, bz + rng.jitter(0.06), { size: rng.range(0.045, 0.07), stem: rng.range(0.1, 0.2) });
    }
    for (let i = 0; i < 5; i++) {
      const lf = new THREE.SphereGeometry(rng.range(0.06, 0.09), 6, 4).scale(1.2, 0.7, 1);
      put(M.leafy, at(lf.translate(rng.range(-bw / 2, bw / 2), by + bh / 2, bz + rng.jitter(0.05))), { color: rng.pick(['#4e7a34', '#5f8a3a', '#3f6a2c']), cast: false });
    }
    // trailing strands over the front
    for (let i = 0; i < 3; i++) {
      const sx = rng.range(-bw / 2 + 0.05, bw / 2 - 0.05);
      const pts = [];
      let px = sx, py = by + bh / 2, pz = bz + bd / 2 + 0.01;
      const L = rng.range(0.2, 0.42);
      for (let k = 0; k < 6; k++) {
        pts.push([px, py, pz]);
        py -= L / 5;
        px += rng.jitter(0.03);
        pz += 0.008;
      }
      put(M.vc, at(tube(pts, 0.006, 3, 8)), { color: '#4e6b2e', cast: false });
      for (let k = 1; k < 6; k++) {
        const lf = new THREE.SphereGeometry(0.03, 5, 3).scale(1.3, 0.5, 1);
        put(M.leafy, at(lf.translate(pts[k][0] + rng.jitter(0.02), pts[k][1], pts[k][2] + 0.01)), { color: '#4f7a34', cast: false });
      }
    }
  }
  const c = new THREE.Vector3(0, 0, 0.2).applyMatrix4(T).applyMatrix4(fr.m);
  halos.push({ x: c.x, y: c.y, z: c.z, size: Math.max(w, h) * 1.1 });
  const sill = new THREE.Vector3(0, sillY + 0.04, fd / 2 + 0.05).applyMatrix4(T).applyMatrix4(fr.m);
  // frame: house-local matrix of the window plane (origin at the pane centre, +Z out of the wall)
  return { phi, y, w, h, shape, pos: c, sill, normal: new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi)), box: spec.box, frame: fr.m.clone().multiply(T) };
}

// ─── warts ───────────────────────────────────────────────────────────────────
// The veil remnants of a fly agaric, as the painted references show them: torn,
// irregular cream FLAKES, not stickers. Big plates at the crown, getting
// smaller down the cap and breaking up into a fine sprinkle at the rim (a size
// gradient), gathered in loose clusters with bare skin between them (where the
// veil tore apart as the cap grew). Each flake is a low plateau with a ragged
// polygonal outline (squashed, notched, every corner at its own radius), an
// uneven, slightly tilted top that catches the light, darker sides, a foot
// sunk a hair into the skin, and — the bigger ones — a soft contact shadow
// painted in the cap material itself (same texture coordinates and colour as
// the skin around it, darkening towards the flake). Every flake has its own
// tone (fresh cream … older, greyer or cap-stained), which the cottage's wart
// material (kit.js) also uses to vary the faint mint glint on the rims at night.
// Profiles: [radius, height] as fractions of the flake's radius / height, top → foot (the foot ring
// sinks into the skin)
const WART_FLAKE = [[0.0, 1.0], [0.74, 0.9], [1.0, 0]];
const WART_DOT = [[0.0, 1.0], [0.68, 0.7], [1.0, 0]];
/** contact shadow ring: [radius (× outline), darkening] from under the flake's foot outwards */
const WART_AO = [[0.92, 0.5], [1.3, 0]];
/**
 * The warts' vertex colour: the cream, whitened and lifted. Under the glen's warm key and grade a
 * plain standard material renders far darker and yellower than the cap's painterly skin around it
 * (#efe6cf came out ≈ rgb(170,165,133), khaki); this lands it on ivory cream on screen (not sticker white).
 */
function wartAlbedo(color, out = new THREE.Color()) {
  return out.set(color).lerp(new THREE.Color('#ffffff'), 0.12).multiplyScalar(1.3);
}
function buildWarts(put, o, houseRng, { capRaw, capFrame, capReserved, capPaint, count }) {
  skipLegacyWartDraws(houseRng, o.Rc, count, capRaw, capReserved);
  const rng = createRng(`${o.seed}:flakes`);
  const M = mats();
  const { Rc } = o;
  const det = o.detail;
  // about twice as many as the old rounded warts (fewer on the lower tiers)
  const target = Math.round(count * 2 * (0.62 + 0.38 * det));
  const aoR = WART_AO[WART_AO.length - 1][0];
  const placed = [];
  const tmp = new THREE.Vector3();
  /** a torn outline: k corners of a squashed polygon, each at its own radius, maybe a notch; returns { pts, hts, ext } */
  const makeOutline = (k, ragged = 1) => {
    const rot = rng.next() * TAU;
    const ax = rng.range(0.78, 1.3);
    const h2 = rng.range(0.04, 0.13), p2 = rng.next() * TAU;
    const h3 = rng.range(0.02, 0.09), p3 = rng.next() * TAU;
    const notch = rng.chance(0.4) ? rng.int(0, k - 1) : -1;
    const pts = [], hts = [];
    let ext = 0;
    for (let i = 0; i < k; i++) {
      const t = ((i + rng.jitter(0.28)) / k) * TAU;
      let r = 1 + h2 * Math.sin(2 * t + p2) + h3 * Math.sin(3 * t + p3) + rng.jitter(0.15 * ragged);
      if (i === notch) r *= rng.range(0.58, 0.78);
      const x = Math.cos(t + rot) * r * ax, y = (Math.sin(t + rot) * r) / ax;
      pts.push([x, y]);
      hts.push(1 + rng.jitter(0.14 * ragged));
      ext = Math.max(ext, Math.hypot(x, y));
    }
    return { pts, hts, ext };
  };
  /** footprint radius on the cap (with the contact ring when it has one) */
  const reach = (w) => w.size * w.ext * (w.ao ? aoR : 1);
  const free = (w, margin) => {
    for (const p of placed) if (p.c.distanceTo(w.c) < reach(p) + reach(w) + margin) return false;
    for (const r of capReserved) if (capRaw(r.phi, r.s, tmp).distanceTo(w.c) < r.r + reach(w)) return false;
    return true;
  };
  /** graded size: big plates at the crown, small flakes down the cap, a fine sprinkle at the rim */
  const sizeAt = (s) => Rc * 0.074 * Math.max(0.2, 1.38 - 1.12 * s) ** 1.25;
  // 1. the flakes, in loose clusters (with bare skin between them) plus a few strays
  const clusters = [];
  const nCl = Math.max(5, Math.round(target / 13));
  for (let i = 0; i < nCl; i++) {
    const s = Math.sqrt(rng.range(0.006, 0.8));
    const phi = rng.next() * TAU;
    const f = capFrame(phi, s);
    clusters.push({ phi, s, lPhi: f.lPhi, lS: f.lS, spread: rng.range(0.8, 1.7) });
  }
  for (let tries = 0, n = 0; n < target && tries < target * 30; tries++) {
    let s, phi;
    if (rng.chance(0.88)) {
      const c = clusters[rng.int(0, clusters.length - 1)];
      // a gaussian-ish offset in the tangent plane, scaled to the flakes' size there
      const sig = c.spread * sizeAt(c.s) * 2.4;
      const a = (rng.next() + rng.next() + rng.next() - 1.5) * sig * 1.4;
      const b = (rng.next() + rng.next() + rng.next() - 1.5) * sig * 1.4;
      phi = c.phi + a / c.lPhi;
      s = Math.min(0.9, Math.max(0.006, c.s + b / c.lS));
    } else {
      s = Math.sqrt(rng.range(0.006, 0.82));
      phi = rng.next() * TAU;
    }
    const size = sizeAt(s) * (rng.chance(0.3) ? rng.range(0.35, 0.6) : rng.range(0.7, 1.3)) * (s < 0.1 ? 0.8 : 1);
    const k = Math.max(7, Math.round((size > Rc * 0.05 ? 12 : size > Rc * 0.03 ? 10 : 8) * (0.65 + 0.35 * det)));
    const w = { c: capRaw(phi, s), size, s, phi, ao: size > Rc * 0.022, k, ...makeOutline(k) };
    if (!free(w, size * 0.1)) continue;
    placed.push(w);
    n++;
  }
  // 2. a sprinkle of tiny speckles towards the rim (the veil breaks up finest at the margin)
  const nSpeck = Math.round(target * 0.25 * (0.5 + 0.5 * det));
  for (let tries = 0, n = 0; n < nSpeck && tries < nSpeck * 30; tries++) {
    const s = rng.range(0.55, 0.96);
    const phi = rng.next() * TAU;
    const size = Rc * 0.013 * rng.range(0.7, 1.35);
    const k = det > 0.7 ? 7 : 6;
    const w = { c: capRaw(phi, s), size, s, phi, ao: false, k, ...makeOutline(k, 0.6) };
    if (!free(w, size * 0.5)) continue;
    placed.push(w);
    n++;
  }
  if (!placed.length) return;

  const cTop = wartAlbedo(o.wartColor);
  const cFoot = wartAlbedo(o.wartColor).lerp(new THREE.Color('#9c8064'), 0.55);
  const cOld = new THREE.Color('#cfc4ae'); // older, greyer flakes
  const cStain = new THREE.Color(o.capColor).lerp(new THREE.Color('#ffffff'), 0.55); // flakes stained by the cap
  const cW = new THREE.Color(), cWF = new THREE.Color(), cV = new THREE.Color();
  const pos = [], col = [], uv = [], idx = [];
  const aPos = [], aNor = [], aCol = [], aUv = [], aIdx = [];
  const p = new THREE.Vector3();
  for (const w of placed) {
    const f = capFrame(w.phi, w.s);
    const { k, pts, hts } = w;
    /** the cap point at the tangent-plane offset (a, b) from the flake's centre → out; returns [φ, s] */
    const onCap = (a, b, out) => {
      const ph = w.phi + a / f.lPhi;
      const ss = Math.min(1, Math.max(0.0005, w.s + b / f.lS));
      capRaw(ph, ss, out);
      return [ph, ss];
    };
    // its own tone: mostly fresh cream, some older and greyer, some stained pinkish by the cap
    const tone = rng.range(0.74, 1.0);
    cW.copy(cTop);
    const age = rng.next();
    if (age < 0.22) cW.lerp(cOld, rng.range(0.3, 0.6));
    else if (age < 0.36) cW.lerp(cStain, rng.range(0.15, 0.35));
    cW.multiplyScalar(tone);
    cWF.copy(cFoot).multiplyScalar(tone);
    // the plateau: low and flat-topped (a third to a quarter as high as wide), its top a little
    // uneven and tilted; the speckles are tiny low dots
    const prof = w.ao ? WART_FLAKE : WART_DOT;
    const h = w.size * (w.ao ? rng.range(0.24, 0.36) : 0.3);
    const tiltA = rng.next() * TAU, tiltK = w.ao ? rng.range(0.05, 0.16) : 0;
    const base = pos.length / 3;
    for (let ri = 0; ri < prof.length; ri++) {
      const [rf, hf] = prof[ri];
      const last = ri === prof.length - 1;
      // cream on top, darker & warmer down the sides into the crease where it meets the skin
      cV.copy(cW).lerp(cWF, smooth01((rf - 0.45) / 0.55) * 0.85);
      const n = ri === 0 ? 1 : k;
      for (let i = 0; i < n; i++) {
        const [ox, oz] = ri === 0 ? [0, 0] : pts[i];
        const ht = ri === 0 ? 1 : hts[i];
        const lift = last ? -0.012 : h * hf * (1 + (ht - 1) * rf) * (1 + tiltK * (ox * Math.cos(tiltA) + oz * Math.sin(tiltA)) * rf);
        const [ph, ss] = onCap(ox * rf * w.size, oz * rf * w.size, p);
        p.addScaledVector(f.n, lift);
        pos.push(p.x, p.y, p.z);
        col.push(cV.r, cV.g, cV.b);
        uv.push(ph * 0.5, ss);
      }
    }
    for (let i = 0; i < k; i++) idx.push(base, base + 1 + i, base + 1 + ((i + 1) % k));
    for (let ri = 1; ri < prof.length - 1; ri++) {
      const a0 = base + 1 + (ri - 1) * k, b0 = base + 1 + ri * k;
      for (let i = 0; i < k; i++) {
        const i1 = (i + 1) % k;
        idx.push(a0 + i, b0 + i, b0 + i1, a0 + i, b0 + i1, a0 + i1);
      }
    }
    // the soft contact shadow: rings in the cap material lying a hair above the skin, with the
    // skin's own colour (darkened towards the flake), texture coordinates and analytic normals
    if (w.ao) {
      const aBase = aPos.length / 3;
      for (const [rf, dark] of WART_AO) {
        for (let i = 0; i < k; i++) {
          const [ox, oz] = pts[i];
          const [ph, ss] = onCap(ox * rf * w.size, oz * rf * w.size, p);
          const fr = capFrame(ph, ss);
          aPos.push(p.x + fr.n.x * 0.006, p.y + fr.n.y * 0.006, p.z + fr.n.z * 0.006);
          aNor.push(fr.n.x, fr.n.y, fr.n.z);
          capPaint(p.x, p.y, p.z, cV).multiplyScalar(1 - dark);
          aCol.push(cV.r, cV.g, cV.b);
          aUv.push((ph / TAU) * 2, 1 - ss);
        }
      }
      for (let r = 0; r < WART_AO.length - 1; r++) {
        const r0 = aBase + r * k, r1 = aBase + (r + 1) * k;
        for (let i = 0; i < k; i++) {
          const i1 = (i + 1) % k;
          aIdx.push(r0 + i, r1 + i, r1 + i1, r0 + i, r1 + i1, r0 + i1);
        }
      }
    }
  }
  /** flip the winding of `g` when its first triangle faces against `nrm` */
  const faceOut = (g, nrm) => {
    const P = g.attributes.position, I = g.index.array;
    const A = new THREE.Vector3().fromBufferAttribute(P, I[0]);
    const B = new THREE.Vector3().fromBufferAttribute(P, I[1]).sub(A);
    const C = new THREE.Vector3().fromBufferAttribute(P, I[2]).sub(A);
    if (B.cross(C).dot(nrm) < 0) for (let i = 0; i < I.length; i += 3) [I[i + 1], I[i + 2]] = [I[i + 2], I[i + 1]];
  };
  const f0 = capFrame(placed[0].phi, placed[0].s);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  faceOut(g, f0.n);
  g.computeVertexNormals();
  put(M.warts, g, { cast: false, color: null });
  if (aIdx.length) {
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.Float32BufferAttribute(aPos, 3));
    ag.setAttribute('normal', new THREE.Float32BufferAttribute(aNor, 3));
    ag.setAttribute('color', new THREE.Float32BufferAttribute(aCol, 3));
    ag.setAttribute('uv', new THREE.Float32BufferAttribute(aUv, 2));
    ag.setIndex(aIdx);
    faceOut(ag, new THREE.Vector3(aNor[0], aNor[1], aNor[2]));
    put(M.cap, ag, { cast: false, color: null });
  }
}

/**
 * Replays, on the house's main generator, the random draws the previous (flat-flake) wart
 * builder made, so everything built after the warts — cap moss, dormer, chimney, ivy, the
 * plants at the foot — keeps exactly the placement the glen was composed with. (The new
 * warts draw from their own generator.)
 */
function skipLegacyWartDraws(rng, Rc, count, capRaw, capReserved) {
  const placed = [];
  const tmp = new THREE.Vector3();
  for (let tries = 0; placed.length < count && tries < count * 40; tries++) {
    const s = Math.sqrt(rng.range(0.0006, 0.84));
    const phi = rng.next() * TAU;
    const size = Rc * 0.046 * rng.range(0.45, 1.5) * (1.5 - 0.85 * s) * (s < 0.1 ? 0.8 : 1);
    const c = capRaw(phi, s);
    if (placed.some((p) => p.c.distanceTo(c) < (p.size + size) * 1.08)) continue;
    if (capReserved.some((r) => capRaw(r.phi, r.s, tmp).distanceTo(c) < r.r + size)) continue;
    placed.push({ c, size });
  }
  for (let i = 0; i < placed.length; i++) {
    const k = rng.int(6, 9);
    for (let j = 5 + 2 * k; j > 0; j--) rng.next();
  }
}

// ─── dormer ──────────────────────────────────────────────────────────────────
function buildDormer(put, o, rng, { capFrame, capRaw, dorm, halos }) {
  const M = mats();
  const f = capFrame(dorm.phi, dorm.s);
  const d = new THREE.Vector3(Math.sin(dorm.phi), 0, Math.cos(dorm.phi));
  const scale = THREE.MathUtils.clamp(o.Rc / 3, 0.65, 1.2);
  const bw = 0.95 * scale, bh = 0.85 * scale, depth = 1.5 * scale;
  // the front face sits a little proud of the cap surface
  const front = f.p.clone().addScaledVector(d, 0.22 * scale);
  front.y -= bh * 0.18;
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(d.z, 0, -d.x), new THREE.Vector3(0, 1, 0), d).setPosition(front);
  const at = (geo) => geo.applyMatrix4(m);
  // body: cream walls (cheeks), back buried in the cap
  const body = new THREE.BoxGeometry(bw, bh, depth, 2, 2, 2).translate(0, 0, -depth / 2);
  uvPlanar(body, 'x', 'y', 0.6);
  put(M.cap, at(body), { color: o.dormColor ?? o.capColor, cast: true });
  // barrel roof in cap colour (half cylinder along −z) with a little ridge lift
  const roofR = bw / 2 + 0.1 * scale;
  const roof = new THREE.CylinderGeometry(roofR, roofR, depth + 0.18, 14, 1, true, Math.PI / 2, Math.PI);
  roof.rotateX(Math.PI / 2);
  roof.scale(1, 0.75, 1);
  roof.translate(0, bh / 2 - 0.02, -depth / 2 + 0.09);
  const ru = roof.attributes.uv;
  for (let i = 0; i < ru.count; i++) ru.setXY(i, ru.getX(i) * 0.3, 0.12 + ru.getY(i) * 0.1);
  put(M.cap, at(roof), { color: o.dormColor ?? o.capColor, cast: true });
  // gable end: the roof's front cap (a half disc) in timber
  const gable = new THREE.CircleGeometry(roofR, 12, 0, Math.PI).scale(1, 0.75, 1).translate(0, bh / 2 - 0.02, 0.0);
  uvBox(gable, 'x');
  put(M.wood, at(gable.translate(0, 0, 0.005)), { color: WOOD.weathered, cast: false });
  // the window: arched, framed, glowing
  const w = 0.42 * scale, wh = 0.55 * scale, r = w / 2;
  const wy = -bh * 0.08;
  put(M.vc, at(new THREE.ShapeGeometry(archShape(w + 0.05, wh - r, { y: wy - wh / 2 - 0.02 }), 8).translate(0, 0, 0.01)), { color: '#22180f', cast: false });
  put(M.pane, at(warmPane(paneGrid(r, wh - r, wy - wh / 2, r), r, wy - wh / 2, wh, dorm.phi).translate(0, 0, 0.016)), { cast: false, color: null });
  const fw = 0.06 * scale;
  for (const s of [-1, 1]) put(M.wood, at(board(fw, wh - r, 0.08, { along: 'y' }).translate(s * (r + fw / 2), wy - wh / 2 + (wh - r) / 2, 0.04)), { color: WOOD.oak, cast: false });
  put(M.wood, at(uvBox(arcSegment(r, r + fw, 0, Math.PI, 0.08, 8, 0.006), 'x').translate(0, wy - wh / 2 + wh - r, 0.04)), { color: WOOD.oak, cast: false });
  put(M.wood, at(board(w + 0.2, 0.05, 0.14, { along: 'x' }).translate(0, wy - wh / 2 - 0.03, 0.06)), { color: WOOD.oak, cast: false });
  put(M.wood, at(board(0.028, wh * 0.85, 0.03, { along: 'y' }).translate(0, wy - wh * 0.05, 0.03)), { color: WOOD.oak, cast: false });
  put(M.wood, at(board(w, 0.028, 0.03, { along: 'x' }).translate(0, wy - wh * 0.08, 0.03)), { color: WOOD.oak, cast: false });
  const c = new THREE.Vector3(0, wy, 0.3).applyMatrix4(m);
  halos.push({ x: c.x, y: c.y, z: c.z, size: 0.75 * scale });
  void capRaw;
}

// ─── chimney ─────────────────────────────────────────────────────────────────
function buildChimney(put, o, rng, { capFrame, chim, bendV }) {
  const M = mats();
  const f = capFrame(chim.phi, chim.s);
  const scale = THREE.MathUtils.clamp(o.Rc / 3, 0.6, 1.2);
  const p = f.p.clone();
  if (o.chimney === 'pipe') {
    const d = new THREE.Vector3(f.n.x, 0, f.n.z).normalize();
    const pts = [
      p.clone().addScaledVector(f.n, -0.3),
      p.clone().addScaledVector(f.n, 0.12),
      p.clone().addScaledVector(d, 0.32 * scale).add(new THREE.Vector3(0, 0.22 * scale, 0)),
      p.clone().addScaledVector(d, 0.42 * scale).add(new THREE.Vector3(0.04, 0.75 * scale, 0)),
      p.clone().addScaledVector(d, 0.38 * scale).add(new THREE.Vector3(-0.03, 1.15 * scale, 0.02)),
    ];
    put(M.metal, tube(pts, 0.085 * scale, 10, 24), { color: '#6e4a32', cast: true });
    const top = pts[pts.length - 1];
    for (const t of [0.35, 0.7]) {
      const q = new THREE.CatmullRomCurve3(pts).getPointAt(t);
      put(M.metal, new THREE.TorusGeometry(0.095 * scale, 0.018 * scale, 5, 12).rotateX(Math.PI / 2).translate(q.x, q.y, q.z), { color: '#3e3a35', cast: false });
    }
    put(M.metal, new THREE.ConeGeometry(0.2 * scale, 0.14 * scale, 10, 1, true).translate(top.x, top.y + 0.2 * scale, top.z), { color: '#3e3a35', cast: true });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      put(M.metal, rod([top.x + Math.cos(a) * 0.07, top.y, top.z + Math.sin(a) * 0.07], [top.x + Math.cos(a) * 0.12, top.y + 0.14 * scale, top.z + Math.sin(a) * 0.12], 0.008, 0.008, 3), { color: '#3e3a35', cast: false });
    }
    return bendV(top.clone().add(new THREE.Vector3(0, 0.12 * scale, 0)));
  }
  if (o.chimney === 'mushroom') {
    // a tiny mushroom growing out of the cap: its hollow stem is the flue
    const h = 0.95 * scale;
    const pts = [p.clone().addScaledVector(f.n, -0.25), p.clone().add(new THREE.Vector3(0, h * 0.4, 0)), p.clone().add(new THREE.Vector3(0.05, h, -0.03))];
    put(M.stem, tube(pts, 0.13 * scale, 10, 10), { color: '#ece2cc', cast: true });
    const top = pts[2];
    const mc = new THREE.SphereGeometry(0.34 * scale, 14, 7, 0, TAU, 0, Math.PI / 2).scale(1, 0.62, 1);
    const mu = mc.attributes.uv;
    for (let i = 0; i < mu.count; i++) mu.setXY(i, mu.getX(i), 1 - mu.getY(i) * 0.9);
    put(M.cap, mc.translate(top.x, top.y + 0.12, top.z), { color: o.capColor, cast: true });
    put(M.gills, new THREE.CircleGeometry(0.33 * scale, 14).rotateX(Math.PI / 2).translate(top.x, top.y + 0.125, top.z), { cast: false });
    for (let i = 0; i < 5; i++) {
      const a = rng.next() * TAU, el = rng.range(0.5, 1.2);
      const rr = 0.34 * scale;
      const sp = new THREE.SphereGeometry(0.03 * scale, 5, 3).scale(1, 0.5, 1);
      sp.translate(Math.cos(a) * Math.cos(el) * rr, top.y + 0.12 + Math.sin(el) * rr * 0.62, Math.sin(a) * Math.cos(el) * rr);
      sp.translate(top.x, 0, top.z);
      put(M.warts, sp, { color: wartAlbedo(o.wartColor), cast: false });
    }
    return bendV(top.clone().add(new THREE.Vector3(0.18 * scale, 0.05, 0)));
  }
  // stone stack: courses of rough stones around a square flue
  const side = 0.46 * scale;
  const y0 = p.y - 0.55 * scale;
  const y1 = p.y + 1.05 * scale;
  const course = 0.14 * scale;
  const lean = rng.jitter(0.035);
  let k = 0;
  for (let y = y0; y < y1; y += course) {
    const off = (y - y0) * lean;
    const sh = (k % 2) * 0.5;
    for (let face = 0; face < 4; face++) {
      const a = (face * Math.PI) / 2;
      const nS = 2;
      for (let s = 0; s < nS; s++) {
        const t = (s + 0.5) / nS - 0.5 + (sh ? 0.1 : -0.1);
        const sw = side / nS + rng.range(0.04, 0.08);
        const st = blockStone(rng, sw, course * rng.range(0.85, 0.98), 0.13 * scale, 0.14, [2, 1, 1]);
        st.translate(t * side, 0, side / 2 - 0.05);
        st.rotateY(a);
        st.translate(p.x + off, y + course / 2, p.z);
        put(M.stone, st, { color: rng.pick(STONE_TINTS), cast: face === 0 });
      }
    }
    k++;
  }
  const off = (y1 - y0) * lean;
  put(M.stone, blockStone(rng, side + 0.12, 0.08, side + 0.12, 0.08).translate(p.x + off, y1 + 0.04, p.z), { color: '#8f8a80', cast: true });
  put(M.clay, new THREE.CylinderGeometry(0.1 * scale, 0.12 * scale, 0.22 * scale, 10, 1, true).translate(p.x + off, y1 + 0.18 * scale, p.z), { color: '#9a5a3a', cast: false });
  put(M.vc, new THREE.CircleGeometry(0.095 * scale, 10).rotateX(-Math.PI / 2).translate(p.x + off, y1 + 0.26 * scale, p.z), { color: '#1a120c', cast: false });
  return bendV(new THREE.Vector3(p.x + off, y1 + 0.32 * scale, p.z));
}

// ─── ivy ─────────────────────────────────────────────────────────────────────
function buildIvy(put, o, rng, { wallR, stemTop, reserved, capRaw, capFrame, open }) {
  const M = mats();
  const amount = o.ivy * o.detail;
  const cards = new Cards();
  // put through the lean, then into the batch
  const PF = { add: (mat, geo, opts) => put(mat, geo, opts) };
  const blocked = (phi, y) =>
    reserved.some((r) => Math.abs(Math.atan2(Math.sin(phi - r.phi), Math.cos(phi - r.phi))) < r.half && y > r.y0 && y < r.y1);
  const wallSurf = (p, n) => {
    const phi = Math.atan2(p.x, p.z);
    const y = Math.max(0.02, p.y);
    const r = wallR(phi, y) + 0.025;
    p.set(Math.sin(phi) * r, p.y, Math.cos(phi) * r);
    n.set(Math.sin(phi), 0, Math.cos(phi));
  };
  // climbing vines from the foot of the wall
  const nClimb = Math.round(2 + amount * 4);
  for (let i = 0; i < nClimb; i++) {
    let phi = 0;
    for (let t = 0; t < 12; t++) {
      phi = rng.next() * TAU;
      if (!blocked(phi, 0.3) && !blocked(phi, 1.2)) break;
    }
    const r = wallR(phi, 0.05) + 0.03;
    const len = rng.range(1.2, Math.min(stemTop * 0.9, 3.6)) * (0.6 + amount * 0.5);
    addIvy(PF, rng, [Math.sin(phi) * r, 0.02, Math.cos(phi) * r], [rng.jitter(0.4), 1, rng.jitter(0.4)], {
      length: len,
      droop: -0.35,
      size: 0.3,
      density: 1.5,
      normal: [Math.sin(phi), 0, Math.cos(phi)],
      surface: wallSurf,
      cards,
    });
  }
  // curtains hanging from the rim
  const nHang = Math.round(1 + amount * 4);
  for (let i = 0; i < nHang; i++) {
    let phi = 0;
    for (let t = 0; t < 12; t++) {
      phi = rng.next() * TAU;
      if (!blocked(phi, stemTop - 0.6) && !(open && Math.abs(Math.atan2(Math.sin(phi - open.phi), Math.cos(phi - open.phi))) < 1.1)) break;
    }
    const strands = rng.int(2, 4);
    for (let k = 0; k < strands; k++) {
      const ph = phi + (k - strands / 2) * 0.08 + rng.jitter(0.03);
      const p = capRaw(ph, 1.02);
      const len = rng.range(0.4, 1.6) * (0.6 + amount * 0.6);
      addIvy(PF, rng, [p.x, p.y, p.z], [0, -1, 0], { length: len, droop: 1.2, size: 0.27, density: 1.6, normal: [Math.sin(ph), 0, Math.cos(ph)], cards });
    }
    // and creeping up over the cap from the rim
    const creep = [];
    const frames = [];
    let ph = phi + rng.jitter(0.1), s = 0.99;
    const steps = Math.round(rng.range(10, 26) * (0.5 + amount));
    for (let k = 0; k < steps; k++) {
      const fr = capFrame(ph, s);
      creep.push(fr.p.clone().addScaledVector(fr.n, 0.025));
      frames.push(fr);
      s -= 0.035 + rng.next() * 0.02;
      ph += rng.jitter(0.06);
      if (s < 0.25) break;
    }
    if (creep.length > 2) {
      put(M.vc, tube(creep, 0.009, 3, creep.length), { color: '#5a4a32', cast: false });
      for (let k = 0; k < creep.length * 1.6; k++) {
        const j = Math.floor(rng.next() * creep.length);
        const q = creep[j];
        const fr = frames[j];
        const up = new THREE.Vector3(rng.jitter(1), rng.jitter(1), rng.jitter(1)).normalize();
        up.addScaledVector(fr.n, -up.dot(fr.n)).normalize();
        cards.add(q.clone().addScaledVector(fr.n, 0.01), up, fr.n.clone(), 0.28 * rng.range(0.7, 1.2), { aspect: 0.9, flip: rng.chance(0.5) });
      }
    }
  }
  if (cards.count) put(M.ivy, cards.geometry(), { cast: false });
}

// ─── the open front (Wohnatelier) ────────────────────────────────────────────
function buildOpenFront(put, o, rng, { prof, zf, stemTop, cutA, wallR, stemMat, halos }) {
  const M = mats();
  const { open } = o;
  const thick = 0.17;
  const d = new THREE.Vector3(Math.sin(open.phi), 0, Math.cos(open.phi));
  const right = new THREE.Vector3(d.z, 0, -d.x);
  // facade frame: x along `right`, y up, z along d; origin on the axis at z = zf
  const m = new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), d).setPosition(d.clone().multiplyScalar(zf));
  const at = (geo) => geo.applyMatrix4(m);
  const yTop = stemTop + 0.35;
  const halfW = (y) => Math.sqrt(Math.max(0, prof(Math.min(y, stemTop + 0.3)) ** 2 - zf * zf)) + 0.01;
  // outline of the facade (follows the stem's cut edge), with the arched opening as a hole
  const s = new THREE.Shape();
  const N = 16;
  s.moveTo(-halfW(-0.05), -0.05);
  s.lineTo(halfW(-0.05), -0.05);
  for (let i = 1; i <= N; i++) {
    const y = -0.05 + ((yTop + 0.05) * i) / N;
    s.lineTo(halfW(y), y);
  }
  for (let i = N; i >= 0; i--) {
    const y = -0.05 + ((yTop + 0.05) * i) / N;
    s.lineTo(-halfW(y), y);
  }
  const aw = open.width, ah = open.height;
  const ar = aw / 2;
  const floorY = 0.24;
  const hole = archShape(aw, ah - ar, { y: floorY - 0.02, path: new THREE.Path(), reverse: true });
  s.holes.push(hole);
  const fac = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 14 });
  fac.translate(0, 0, -thick);
  uvPlanar(fac, 'x', 'y', 1 / 2.6);
  // darken the top under the cap like the stem
  paintFn(fac, o.stemColor, (x, y, z, i, c) => {
    c.lerp(new THREE.Color('#8d7f68'), 0.55 * smooth01((y - (stemTop - 1.4)) / 1.6));
    if (z < -thick + 0.01) c.set('#efe6d6'); // inner face: whitewashed plaster
  });
  put(stemMat, at(fac), { cast: true });

  // stone arch around the opening
  const rin = ar + 0.01;
  const nV = 13;
  const hs = ah - ar;
  for (let i = 0; i < nV; i++) {
    const a0 = (i / nV) * Math.PI, a1 = ((i + 1) / nV) * Math.PI;
    const key = i === (nV - 1) / 2;
    const t = key ? 0.3 : rng.range(0.2, 0.26);
    const seg = arcSegment(rin, rin + t, a0 + 0.01, a1 - 0.01, thick + 0.16, 2, 0.012);
    seg.translate(rng.jitter(0.006), floorY - 0.02 + hs + rng.jitter(0.006), -thick / 2 + 0.06 + rng.jitter(0.012) + (key ? 0.03 : 0));
    put(M.stone, at(seg), { color: rng.pick(STONE_TINTS), cast: false });
  }
  for (const side of [-1, 1]) {
    let y = floorY - 0.04;
    let k = side > 0 ? 1 : 0;
    while (y < floorY + hs - 0.05) {
      const bh = Math.min(rng.range(0.25, 0.33), floorY + hs - y);
      const bw = k % 2 ? rng.range(0.3, 0.36) : rng.range(0.2, 0.25);
      const st = blockStone(rng, bw, bh - 0.02, thick + 0.16, 0.08);
      st.translate(side * (rin + bw / 2), y + bh / 2, -thick / 2 + 0.06);
      put(M.stone, at(st), { color: rng.pick(STONE_TINTS), cast: false });
      y += bh;
      k++;
    }
  }
  // threshold beam & a worn stone sill
  put(M.stone, at(blockStone(rng, aw + 0.4, 0.14, thick + 0.5, 0.05).translate(0, floorY - 0.09, 0.08)), { color: '#a39d90', cast: true });

  // folding glazed doors, opened out against the facade (3 leaves per side)
  const leafW = aw / 6;
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const lh = hs - 0.06;
      // folded concertina: leaves zig-zag just outside the jamb
      const ang = side * (Math.PI / 2 + (k % 2 ? -0.35 : 0.35));
      const base = new THREE.Vector3(side * (rin + 0.08 + k * 0.05), floorY, 0.12 + k * leafW * 0.92);
      const L = new THREE.Matrix4().makeRotationY(ang).setPosition(base);
      const parts = [];
      const fw = 0.04;
      const fc = '#4e3a2a';
      for (const sx of [-1, 1]) parts.push([board(fw, lh, 0.045, { along: 'y', rng }).translate(sx * (leafW / 2 - fw / 2), lh / 2, 0), M.wood, fc]);
      for (const yy of [fw / 2, lh * 0.33, lh * 0.66, lh - fw / 2]) parts.push([board(leafW, fw * 0.8, 0.045, { along: 'x', rng }).translate(0, yy, 0), M.wood, fc]);
      parts.push([board(0.018, lh, 0.03, { along: 'y' }).translate(0, lh / 2, 0), M.wood, fc]);
      parts.push([new THREE.PlaneGeometry(leafW - fw * 2, lh - fw * 2).translate(0, lh / 2, 0), M.glass, null]);
      for (const [g, mat, c] of parts) {
        g.applyMatrix4(L);
        put(mat, at(g), { color: c, cast: false });
      }
    }
  }

  // interior shell: plastered inner wall, floor and a beamed ceiling
  const ceilY = Math.min(stemTop - 0.05, floorY + ah + 0.55);
  const inner = paramSurface(
    (u, v, p) => {
      const y = floorY - 0.05 + v * (ceilY + 0.1 - floorY);
      const a = cutA(Math.max(y, 0));
      const phi = open.phi + a + u * (TAU - 2 * a);
      const r = wallR(phi, Math.max(y, 0)) - thick;
      p.set(Math.sin(phi) * r, y, Math.cos(phi) * r);
    },
    48,
    10,
    { uv: (u, v, p) => [(u * TAU * prof(1)) / 2.2, p.y / 2.2] }
  );
  // a designed home, not a ruin: crack-free warm off-white limewash (the outside keeps its weathered plaster)
  paintFn(inner, '#f0e7d8', (x, y, z, i, c) => {
    c.multiplyScalar(0.96 + 0.04 * noiseA(x * 2, z * 2 + y));
    c.lerp(new THREE.Color('#cdb592'), 0.22 * (1 - smooth01((y - floorY) / 0.35))); // skirting shadow
  });
  put(M.limewash, inner, { cast: false });
  // floor disc (oak boards)
  const fr = prof(floorY) - thick + 0.03;
  const zCut = zf - thick * 0.5;
  const floorGeo = chordDisc(fr, zCut, floorY, open.phi, true);
  uvPlanar(floorGeo, 'x', 'z', 1 / 1.6);
  put(M.floor, floorGeo, { cast: false });
  // ceiling: boards + radial beams (clipped at the facade)
  const cr = prof(ceilY) - thick + 0.04;
  const ceil = chordDisc(cr, zCut, ceilY, open.phi, false);
  uvPlanar(ceil, 'x', 'z', 1 / 1.4);
  put(M.wood, ceil, { color: WOOD.oakLight, cast: true });
  for (let i = 0; i < 7; i++) {
    const a = open.phi + Math.PI + ((i - 3) / 7) * TAU;
    const c = Math.cos(a - open.phi);
    const L = c > 0.05 ? Math.min(cr, (zCut - 0.08) / c) : cr;
    put(M.wood, boardBetween([0, ceilY - 0.06, 0], [Math.sin(a) * L, ceilY - 0.06, Math.cos(a) * L], 0.11, 0.12, { rng }), { color: WOOD.walnut, cast: false });
  }
  put(M.wood, new THREE.CylinderGeometry(0.16, 0.16, 0.16, 10).translate(0, ceilY - 0.08, 0), { color: WOOD.walnut, cast: false });

  return {
    floorY,
    ceilY,
    facadeZ: zf,
    phi: open.phi,
    width: aw,
    height: ah,
    thick,
    /** Inner wall radius at height y (towards azimuth φ). */
    radiusAt: (phi, y) => wallR(phi, y) - thick,
    frame: m.clone(),
    cutA,
  };
}

export { CAP_SHAPES };
