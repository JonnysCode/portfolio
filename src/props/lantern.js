// ─────────────────────────────────────────────────────────────────────────────
// Lanterns & lamp posts — the village's night lights. The glass glows via
// materials.glow (brighter at night) and a soft additive halo (glow.js).
//
//   makeLantern({ color, frame, hanging, halo })   ~0.5 tall
//   makeLampPost({ color, height, style: 'hook' | 'top' })   ~2.6 tall
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { palette } from '../core/palette.js';
import { Parts, cached, xf, strut, groupFor, opt, shade } from './util.js';
import { makeGlowSprite } from './glow.js';
import { registerAnimated, propsSettings } from './ticker.js';
import { createRng } from '../core/rng.js';

/** Lantern body layer map, origin at the bottom of the lantern. Height ≈ 0.5. */
export function lanternGeos(color = palette.windowGlow, frame = palette.metalDark) {
  return cached(`lantern|${color}|${frame}`, () => {
    const P = new Parts();
    const dark = frame;
    // base plate + foot ring
    P.add('detail', xf(new THREE.CylinderGeometry(0.15, 0.13, 0.04, 4, 1), [0, 0.02, 0], [0, Math.PI / 4, 0]), dark);
    // corner posts
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      P.add('detail', xf(new THREE.BoxGeometry(0.026, 0.27, 0.026), [Math.sin(a) * 0.118, 0.175, Math.cos(a) * 0.118], [0, a, 0]), dark);
    }
    // glass (glow) — a slightly tapered box
    P.add(`glow:${color}`, xf(new THREE.CylinderGeometry(0.1, 0.092, 0.25, 4, 1), [0, 0.17, 0], [0, Math.PI / 4, 0]), color);
    // little cross bars on the glass
    P.add('detail', xf(new THREE.BoxGeometry(0.2, 0.016, 0.2), [0, 0.3, 0]), dark);
    // roof: four-sided pyramid with an overhang + finial + hanging ring
    P.add('detail', xf(new THREE.ConeGeometry(0.2, 0.13, 4, 1), [0, 0.37, 0], [0, Math.PI / 4, 0]), dark);
    P.add('detail', xf(new THREE.CylinderGeometry(0.205, 0.205, 0.02, 4, 1), [0, 0.3, 0], [0, Math.PI / 4, 0]), shade(dark, 0.06));
    P.add('detail', xf(new THREE.SphereGeometry(0.03, 6, 4), [0, 0.45, 0]), dark);
    P.add('detail', xf(new THREE.TorusGeometry(0.035, 0.009, 4, 10), [0, 0.49, 0]), dark);
    return P.finish();
  });
}

/**
 * A little lantern; glows at night.
 * @param {object} [opts] { color (glass colour), frame (metal colour), hanging=false (origin at the ring on top),
 *                          halo=true, haloSize=0.9 }
 */
export function makeLantern(opts = {}) {
  const color = opt(opts, 'color', palette.windowGlow);
  const g = new THREE.Group();
  g.name = 'lantern';
  const body = groupFor(lanternGeos(color, opt(opts, 'frame', palette.metalDark)));
  if (opts.hanging) body.position.y = -0.5;
  g.add(body);
  if (opt(opts, 'halo', true)) {
    const halo = makeGlowSprite(color, opt(opts, 'haloSize', 0.9));
    halo.position.y = body.position.y + 0.17;
    g.add(halo);
  }
  g.userData.height = 0.5;
  return g;
}

let lampCount = 0;

function postGeos(height, style, seed) {
  return cached(`lamppost|${height}|${style}|${seed}`, () => {
    const rng = createRng(seed);
    const P = new Parts();
    // stone footing
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rng.range(0, 0.6);
      const s = rng.range(0.11, 0.16);
      P.add('detail', xf(new THREE.IcosahedronGeometry(s, 0), [Math.sin(a) * 0.17, 0.03, Math.cos(a) * 0.17], [rng.next(), rng.next(), 0], [1, 0.55, 1]), rng.pick([palette.stone, palette.stoneDark, shade(palette.stone, 0.05)]));
    }
    // the post: square timber with chamfered corners (8-sided), slight taper
    const post = new THREE.CylinderGeometry(0.065, 0.085, height, 8, 1);
    post.translate(0, height / 2, 0);
    P.add('wood', post, palette.walnut);
    // collar & cap
    P.add('detail', xf(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 8), [0, 0.35, 0]), palette.metalDark);
    P.add('detail', xf(new THREE.CylinderGeometry(0.095, 0.08, 0.06, 8), [0, height + 0.03, 0]), palette.metalDark);
    if (style === 'hook') {
      P.add('detail', xf(new THREE.SphereGeometry(0.06, 8, 6), [0, height + 0.09, 0]), palette.metalDark);
      // curly iron arm the lantern hangs from
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        pts.push(new THREE.Vector3(0, height - 0.12 + Math.sin(t * Math.PI) * 0.12, t * 0.55));
      }
      P.add('detail', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.022, 5, false), palette.metalDark);
      // decorative curl under the arm
      const curl = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const a = t * Math.PI * 1.6;
        const r = 0.14 * (1 - t * 0.6);
        curl.push(new THREE.Vector3(0, height - 0.18 - Math.sin(a) * r, 0.06 + (1 - Math.cos(a)) * r));
      }
      P.add('detail', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curl), 16, 0.014, 4, false), palette.metalDark);
      P.add('detail', strut([0, height - 0.12, 0.55], [0, height - 0.22, 0.55], 0.01), palette.metalDark);
    }
    return P.finish();
  });
}

/**
 * Street lamp post (~2.6 tall) with a glowing lantern.
 * @param {object} [opts] { color, height=2.4, style: 'hook' (lantern hangs from a curly arm, swings) | 'top', seed }
 */
export function makeLampPost(opts = {}) {
  const height = opt(opts, 'height', 2.4);
  const style = opt(opts, 'style', 'hook');
  const g = new THREE.Group();
  g.name = 'lampPost';
  g.add(groupFor(postGeos(height, style, String(opts.seed ?? 'lamp'))));
  const lantern = makeLantern({ color: opts.color, haloSize: 1.1 });
  if (style === 'hook') {
    const pivot = new THREE.Group();
    pivot.position.set(0, height - 0.22, 0.55);
    lantern.position.y = -0.5;
    pivot.add(lantern);
    g.add(pivot);
    const ph = (lampCount++ * 2.39) % 6.28;
    registerAnimated(g, (dt, t) => {
      if (propsSettings.reducedMotion) return;
      pivot.rotation.x = Math.sin(t * 1.3 + ph) * 0.05;
      pivot.rotation.z = Math.sin(t * 0.9 + ph * 1.7) * 0.035;
    });
  } else {
    lantern.position.y = height + 0.02;
    g.add(lantern);
  }
  g.userData.height = height + 0.5;
  return g;
}
