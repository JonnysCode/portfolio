// ─────────────────────────────────────────────────────────────────────────────
// Hand tools & held items — used by villagers (setHolding) and handy as
// standalone props on workbenches / shelves:
//
//   makeTool('plane')   → THREE.Group (origin = grip point; see TOOL_INFO for axes)
//
// Items: plane (Swiss smoothing plane, "Hobel"), hammer, saw, wrench, pump,
// laptop, mug, paintbrush, book, chisel, mallet, ruler (folding rule).
// Geometry is built once per item and shared.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { palette } from '../core/palette.js';
import { Parts, cached, xf, grainUV, groupFor, shade } from './util.js';

const STEEL = '#aeb6be';
const IRON = '#5b636b';
const BRASS = '#d9a441';

/**
 * Builders draw the tool in GRIP space: origin = where the hand holds it.
 * mount: 'hand' (right hand anchor; the hand frame is the arm frame: the arm
 *        hangs along −Y, +Z is forward) or 'front' (held in front of the
 *        chest with both hands).
 */
const BUILDERS = {
  // Swiss smoothing plane (Hobel): beech body with a front horn, blade + wedge
  plane(P) {
    const beech = '#d9b27c';
    // body: long along Z, sole at y = -0.11 so the hand grips the top
    P.add('wood', grainUV(new THREE.BoxGeometry(0.075, 0.07, 0.26), 'z').translate(0, -0.075, 0.06), beech);
    P.add('wood', grainUV(new THREE.BoxGeometry(0.06, 0.012, 0.25), 'z').translate(0, -0.116, 0.06), shade(beech, -0.08));
    // horn at the front
    const horn = new THREE.CylinderGeometry(0.022, 0.03, 0.08, 8);
    P.add('wood', xf(horn, [0, -0.02, 0.15], [0.35, 0, 0]), shade(beech, -0.04));
    P.add('wood', xf(new THREE.SphereGeometry(0.026, 8, 6), [0, 0.02, 0.165]), shade(beech, -0.04));
    // blade + wedge in the mouth
    P.add('detail', xf(new THREE.BoxGeometry(0.05, 0.11, 0.008), [0, -0.02, 0.04], [-0.75, 0, 0]), STEEL);
    P.add('wood', xf(new THREE.BoxGeometry(0.04, 0.09, 0.022), [0, -0.01, 0.025], [-0.75, 0, 0]), palette.walnut);
    // handle knob at the back (the grip)
    P.add('wood', xf(new THREE.SphereGeometry(0.03, 8, 6), [0, -0.025, -0.05], [0, 0, 0], [1, 1.3, 1.2]), shade(beech, -0.04));
  },
  hammer(P) {
    P.add('wood', grainUV(new THREE.CylinderGeometry(0.014, 0.018, 0.3, 6), 'y').translate(0, 0.09, 0), palette.ash);
    P.add('detail', new THREE.BoxGeometry(0.035, 0.04, 0.13).translate(0, 0.235, 0.015), IRON);
    P.add('detail', new THREE.CylinderGeometry(0.024, 0.024, 0.03, 8).rotateX(Math.PI / 2).translate(0, 0.235, 0.09), IRON);
    // claw
    P.add('detail', xf(new THREE.BoxGeometry(0.03, 0.02, 0.07), [0, 0.225, -0.075], [0.45, 0, 0]), IRON);
  },
  mallet(P) {
    P.add('wood', grainUV(new THREE.CylinderGeometry(0.014, 0.017, 0.26, 6), 'y').translate(0, 0.08, 0), palette.ash);
    P.add('wood', grainUV(new THREE.BoxGeometry(0.07, 0.075, 0.13), 'z').translate(0, 0.23, 0), '#c98a4b');
  },
  saw(P) {
    // Japanese-style pull saw is too thin to read; a classic hand saw with a fat handle
    const blade = new THREE.Shape();
    blade.moveTo(0, -0.03);
    blade.lineTo(0.36, 0.005);
    blade.lineTo(0.36, 0.045);
    blade.lineTo(0, 0.07);
    blade.lineTo(0, -0.03);
    const g = new THREE.ExtrudeGeometry(blade, { depth: 0.006, bevelEnabled: false });
    g.translate(0, 0, -0.003);
    g.rotateY(-Math.PI / 2); // blade points forward (+Z)
    P.add('detail', g.translate(0, 0.0, 0.04), STEEL);
    const handle = new THREE.TorusGeometry(0.045, 0.02, 5, 10);
    handle.rotateY(Math.PI / 2);
    P.add('wood', handle.translate(0, 0.01, 0), '#b4673e');
    P.add('wood', new THREE.BoxGeometry(0.03, 0.12, 0.05).translate(0, 0.01, 0.04), '#b4673e');
  },
  wrench(P) {
    P.add('detail', new THREE.BoxGeometry(0.018, 0.035, 0.24).translate(0, 0, 0.07), STEEL);
    const jaw = new THREE.TorusGeometry(0.03, 0.013, 4, 8, Math.PI * 1.35);
    jaw.rotateY(Math.PI / 2);
    jaw.rotateX(Math.PI * 0.82);
    P.add('detail', jaw.translate(0, 0, 0.205), STEEL);
    P.add('detail', new THREE.TorusGeometry(0.025, 0.012, 4, 10).rotateY(Math.PI / 2).translate(0, 0, -0.06), STEEL);
    P.add('detail', new THREE.BoxGeometry(0.022, 0.04, 0.1).translate(0, 0, 0.02), palette.swissRed);
  },
  // bike floor pump: T-handle at the grip, barrel down to the floor
  pump(P) {
    P.add('detail', new THREE.CylinderGeometry(0.016, 0.016, 0.2, 6).rotateZ(Math.PI / 2), '#3b2a1e');
    P.add('detail', new THREE.CylinderGeometry(0.008, 0.008, 0.12, 5).translate(0, -0.06, 0), STEEL);
    P.add('paint', new THREE.CylinderGeometry(0.03, 0.03, 0.3, 10).translate(0, -0.27, 0), palette.swissRed);
    P.add('detail', new THREE.CylinderGeometry(0.034, 0.034, 0.025, 10).translate(0, -0.13, 0), '#3b2a1e');
    P.add('detail', new THREE.BoxGeometry(0.18, 0.02, 0.06).translate(0, -0.43, 0), '#3b2a1e');
    P.add('detail', xf(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 10), [0.0, -0.25, 0.032], [Math.PI / 2, 0, 0]), '#f7efdf');
    // hose
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.03, -0.4, 0),
      new THREE.Vector3(0.1, -0.36, 0.05),
      new THREE.Vector3(0.09, -0.2, 0.06),
      new THREE.Vector3(0.04, -0.16, 0.04),
    ]);
    P.add('detail', new THREE.TubeGeometry(curve, 8, 0.008, 4, false), '#2a2a2a');
  },
  // open laptop, held flat in front of the chest
  laptop(P) {
    P.add('paint', new THREE.BoxGeometry(0.26, 0.016, 0.18).translate(0, 0, 0), '#c7ced6');
    P.add('detail', new THREE.BoxGeometry(0.22, 0.004, 0.08).translate(0, 0.009, -0.015), '#8f98a2');
    const screen = new THREE.BoxGeometry(0.26, 0.17, 0.01);
    screen.translate(0, 0.085, 0);
    xf(screen, [0, 0.008, -0.09], [-0.25, 0, 0]);
    P.add('paint', screen, '#c7ced6');
    const glass = new THREE.PlaneGeometry(0.23, 0.14);
    glass.translate(0, 0.088, 0.0055);
    xf(glass, [0, 0.008, -0.09], [-0.25, 0, 0]);
    P.add(`glow:${palette.glowCyan}:0.5:1.4`, glass, palette.glowCyan);
    // sticker (a tiny mushroom) on the back of the lid
    const st = new THREE.CircleGeometry(0.02, 8);
    st.rotateY(Math.PI);
    st.translate(0, 0.09, -0.0055);
    xf(st, [0, 0.008, -0.09], [-0.25, 0, 0]);
    P.add('detail', st, palette.capRed);
  },
  mug(P) {
    P.add('paint', new THREE.CylinderGeometry(0.042, 0.038, 0.09, 10, 1, true).translate(0, 0.03, 0.03), palette.capRed);
    P.add('paint', new THREE.CircleGeometry(0.038, 10).rotateX(-Math.PI / 2).translate(0, 0.064, 0.03), '#6b4430');
    P.add('paint', new THREE.CircleGeometry(0.038, 10).rotateX(Math.PI / 2).translate(0, -0.015, 0.03), palette.capRed);
    P.add('detail', new THREE.TorusGeometry(0.023, 0.008, 4, 8, Math.PI).rotateZ(-Math.PI / 2).rotateY(Math.PI / 2).translate(0, 0.03, -0.012), palette.capRed);
    // white dots
    for (let i = 0; i < 4; i++) {
      const a = i * 1.57 + 0.8;
      P.add('detail', new THREE.SphereGeometry(0.008, 4, 3).translate(Math.sin(a) * 0.041, 0.035 + (i % 2) * 0.02, 0.03 + Math.cos(a) * 0.041), palette.spots);
    }
  },
  paintbrush(P) {
    P.add('wood', grainUV(new THREE.CylinderGeometry(0.01, 0.014, 0.2, 6), 'y').translate(0, 0.06, 0), palette.capTeal);
    P.add('detail', new THREE.CylinderGeometry(0.017, 0.015, 0.04, 8).translate(0, 0.18, 0), STEEL);
    P.add('detail', new THREE.CylinderGeometry(0.009, 0.019, 0.06, 8).translate(0, 0.23, 0), '#3b2a1e');
    P.add('detail', new THREE.ConeGeometry(0.012, 0.03, 8).translate(0, 0.275, 0), palette.capCoral);
  },
  // open book, held in front of the chest
  book(P) {
    for (const s of [-1, 1]) {
      const cover = new THREE.BoxGeometry(0.13, 0.008, 0.18);
      cover.translate(s * 0.065, 0, 0);
      P.add('paint', xf(cover, [0, 0, 0], [0, 0, s * 0.18]), '#4f6d9a');
      const pages = new THREE.BoxGeometry(0.12, 0.02, 0.17);
      pages.translate(s * 0.062, 0.014, 0);
      P.add('paint', xf(pages, [0, 0, 0], [0, 0, s * 0.18]), palette.paper);
      // lines of text
      for (let i = 0; i < 5; i++) P.add('detail', xf(new THREE.BoxGeometry(0.08, 0.002, 0.008).translate(s * 0.065, 0.025, -0.06 + i * 0.03), [0, 0, 0], [0, 0, s * 0.18]), '#b9b1a3');
    }
  },
  chisel(P) {
    P.add('wood', grainUV(new THREE.CylinderGeometry(0.016, 0.014, 0.12, 8), 'y').translate(0, 0.0, 0), '#c98a4b');
    P.add('detail', new THREE.CylinderGeometry(0.018, 0.018, 0.012, 8).translate(0, -0.065, 0), BRASS);
    P.add('detail', new THREE.BoxGeometry(0.024, 0.13, 0.006).translate(0, -0.13, 0), STEEL);
  },
  ruler(P) {
    // folding rule, partially unfolded (zig-zag)
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.BoxGeometry(0.02, 0.006, 0.16);
      seg.translate(0, 0, 0.08);
      xf(seg, [0, 0, i * 0.14], [0, (i % 2 ? -1 : 1) * 0.5, 0]);
      P.add('detail', seg, palette.postYellow);
    }
  },
};

/**
 * How each item sits in the hand. pos/rot place GRIP space inside the hand
 * anchor; `mount` = 'hand' | 'front'; `twoHanded` → both arms reach forward.
 */
export const TOOL_INFO = {
  plane: { mount: 'hand', pos: [0.05, -0.02, 0.02], rot: [1.15, 0, 0], twoHanded: true },
  hammer: { mount: 'hand', pos: [0, 0, 0], rot: [Math.PI / 2 + 0.6, 0, 0] },
  mallet: { mount: 'hand', pos: [0, 0, 0], rot: [Math.PI / 2 + 0.6, 0, 0] },
  saw: { mount: 'hand', pos: [0, 0, 0], rot: [0.2, 0, 0] },
  wrench: { mount: 'hand', pos: [0, 0, 0], rot: [0.5, 0, 0] },
  pump: { mount: 'hand', pos: [0, 0.03, 0.02], rot: [0, 0, 0], twoHanded: true },
  laptop: { mount: 'front', pos: [0, 0, 0], rot: [0, 0, 0], twoHanded: true },
  mug: { mount: 'hand', pos: [0, 0, 0.02], rot: [0, 0, 0] },
  paintbrush: { mount: 'hand', pos: [0, 0, 0], rot: [Math.PI / 2 - 0.3, 0, 0] },
  book: { mount: 'front', pos: [0, 0, 0], rot: [-0.5, 0, 0], twoHanded: true },
  chisel: { mount: 'hand', pos: [0, 0, 0], rot: [Math.PI / 2 + 0.4, 0, 0] },
  ruler: { mount: 'hand', pos: [0, 0, 0], rot: [0, 0, 0] },
};

export const TOOL_NAMES = Object.keys(BUILDERS);

/** Cached layer map for an item. */
export function toolGeos(name) {
  if (!BUILDERS[name]) return null;
  return cached(`tool|${name}`, () => {
    const P = new Parts();
    // tools never cast shadows, so 'paint' and 'detail' are the same thing:
    // fold them into one layer (one draw call less per tool)
    const T = { add: (layer, geo, color) => P.add(layer === 'paint' ? 'detail' : layer, geo, color) };
    BUILDERS[name](T);
    return P.finish();
  });
}

/**
 * A hand tool / held item as a standalone prop (origin = grip point).
 * @param {string} name  one of TOOL_NAMES
 * @param {object} [opts] { scale=1 }
 */
export function makeTool(name, opts = {}) {
  const geos = toolGeos(name);
  const g = geos ? groupFor(geos, { cast: false }) : new THREE.Group();
  g.name = `tool:${name}`;
  if (opts.scale) g.scale.setScalar(opts.scale);
  return g;
}

