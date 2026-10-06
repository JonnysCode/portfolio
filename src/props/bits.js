// ─────────────────────────────────────────────────────────────────────────────
// Little reusable part adders (flowers, flower boxes, grass tufts, tiny
// mushrooms, pebbles). They add coloured primitives into a Parts collector so
// bigger props (houses, decor) can sprinkle them in without extra draw calls.
// All positions are in the collector's local space.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { palette } from '../core/palette.js';
import { xf, strut, grainUV, shade } from './util.js';

export const FLOWER_COLORS = ['#ef7a5a', '#fff8ec', '#efc85a', '#b39ddb', '#e2553f', '#f2a7c3', '#7fb2e6'];

/**
 * A simple flower: stem + petals + centre (≈ 70 tris).
 * size = petal ring radius. `layer` should usually be 'plant' (wind sway).
 */
export function addFlower(P, x, y, z, { size = 0.06, height = 0.18, color, rng, layer = 'plant', tilt = 0.2 } = {}) {
  const c = color ?? (rng ? rng.pick(FLOWER_COLORS) : FLOWER_COLORS[0]);
  const tx = rng ? rng.jitter(tilt) : 0;
  const tz = rng ? rng.jitter(tilt) : 0;
  const top = [x + tx * height, y + height, z + tz * height];
  P.add(layer, strut([x, y, z], top, 0.008, 0.008, 3), palette.leafDark);
  // petals: a flattened 5-lobed blob made of a squashed icosahedron ring
  const petals = new THREE.CylinderGeometry(size, size * 0.6, size * 0.35, 5, 1);
  xf(petals, top, [rng ? rng.jitter(0.3) : 0, rng ? rng.next() * 6 : 0, rng ? rng.jitter(0.3) : 0]);
  P.add(layer, petals, c);
  P.add(layer, xf(new THREE.IcosahedronGeometry(size * 0.42, 0), [top[0], top[1] + size * 0.2, top[2]]), c === '#efc85a' ? '#a8653b' : '#efc85a');
  // a leaf
  if (!rng || rng.chance(0.6)) {
    const a = rng ? rng.next() * 6.28 : 0;
    P.add(layer, xf(new THREE.IcosahedronGeometry(size * 0.6, 0), [x + Math.sin(a) * size * 0.8, y + height * 0.35, z + Math.cos(a) * size * 0.8], [0, a, 0.6], [1.4, 0.35, 0.8]), palette.leafLight);
  }
}

/** A clump of grass blades (3–5 thin cones). */
export function addTuft(P, x, y, z, { height = 0.28, rng, color = palette.grassDark, layer = 'plant', blades = 4 } = {}) {
  for (let i = 0; i < blades; i++) {
    const a = rng ? rng.next() * 6.28 : i * 1.7;
    const lean = rng ? rng.range(0.15, 0.45) : 0.3;
    const h = height * (rng ? rng.range(0.6, 1.1) : 1);
    const cone = new THREE.ConeGeometry(0.03, h, 3, 1);
    cone.translate(0, h / 2, 0);
    xf(cone, [x + Math.sin(a) * 0.04, y, z + Math.cos(a) * 0.04], [Math.cos(a) * lean, 0, -Math.sin(a) * lean]);
    P.add(layer, cone, i % 2 ? color : shade(color, 0.07));
  }
}

/** A tiny toadstool (stem + cap + 2 dots). */
export function addTinyMushroom(P, x, y, z, { size = 0.12, color = palette.capRed, rng, layer = 'detail' } = {}) {
  const h = size * 1.2;
  const lean = rng ? rng.jitter(0.25) : 0;
  P.add(layer, xf(new THREE.CylinderGeometry(size * 0.28, size * 0.36, h, 5, 1, true), [x, y + h / 2, z], [lean * 0.5, 0, lean]), palette.stem);
  const cap = new THREE.SphereGeometry(size * 0.75, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.75, 1);
  P.add(layer, xf(cap, [x + lean * h * 0.5, y + h * 0.95, z], [lean * 0.5, 0, lean]), color);
  if (color !== palette.capBrown) {
    P.add(layer, xf(new THREE.IcosahedronGeometry(size * 0.12, 0), [x + lean * h * 0.5 + size * 0.3, y + h * 0.95 + size * 0.38, z + size * 0.2]), palette.spots);
    P.add(layer, xf(new THREE.IcosahedronGeometry(size * 0.1, 0), [x + lean * h * 0.5 - size * 0.25, y + h * 0.95 + size * 0.42, z - size * 0.15]), palette.spots);
  }
}

/**
 * Wooden flower box (local: centred at x,y,z = bottom centre, long side along X,
 * front facing +Z) planted with flowers.
 */
export function addFlowerBox(P, x, y, z, rotY = 0, { width = 0.7, rng, wood = palette.oak, layer = 'wood', flowers = 6, plantLayer = 'plant' } = {}) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), new THREE.Vector3(1, 1, 1));
  const box = grainUV(new THREE.BoxGeometry(width, 0.16, 0.2), 'x');
  box.translate(0, 0.08, 0);
  P.add(layer, box.applyMatrix4(m), wood);
  // rim batten + soil
  P.add(layer, grainUV(new THREE.BoxGeometry(width + 0.04, 0.035, 0.03), 'x').translate(0, 0.15, 0.1).applyMatrix4(m), shade(wood, -0.06));
  P.add('detail', new THREE.BoxGeometry(width - 0.04, 0.02, 0.16).translate(0, 0.155, 0).applyMatrix4(m), palette.dirtDark);
  // brackets under the box
  for (const s of [-1, 1]) P.add(layer, grainUV(new THREE.BoxGeometry(0.04, 0.12, 0.16), 'y').translate(s * width * 0.32, -0.04, -0.02).applyMatrix4(m), shade(wood, -0.1));
  // planting: leafy blobs + flower heads
  const local = new THREE.Vector3();
  for (let i = 0; i < flowers; i++) {
    const fx = -width / 2 + 0.08 + ((i + 0.5) / flowers) * (width - 0.16) + (rng ? rng.jitter(0.03) : 0);
    local.set(fx, 0.16, rng ? rng.jitter(0.04) : 0).applyMatrix4(m);
    const leaf = new THREE.IcosahedronGeometry(0.075, 0);
    leaf.scale(1.2, 0.8, 1);
    leaf.translate(local.x, local.y + 0.03, local.z);
    P.add(plantLayer, leaf, i % 2 ? palette.leaf : palette.leafLight);
    local.set(fx + (rng ? rng.jitter(0.03) : 0), 0.16, rng ? rng.jitter(0.05) : 0).applyMatrix4(m);
    const color = rng ? rng.pick(FLOWER_COLORS) : FLOWER_COLORS[i % FLOWER_COLORS.length];
    const head = new THREE.IcosahedronGeometry(0.045, 0);
    head.translate(local.x, local.y + 0.1 + (rng ? rng.range(0, 0.05) : 0), local.z);
    P.add(plantLayer, head, color);
  }
}

/** A flattened pebble / stone. */
export function addStone(P, x, y, z, { size = 0.2, rng, color, layer = 'detail', flat = 0.55 } = {}) {
  const g = new THREE.IcosahedronGeometry(size, 0);
  xf(g, [x, y, z], [rng ? rng.next() * 3 : 0, rng ? rng.next() * 3 : 0, 0], [1, flat, rng ? rng.range(0.8, 1.2) : 1]);
  P.add(layer, g, color ?? (rng ? rng.pick([palette.stone, palette.stoneDark, shade(palette.stone, 0.06)]) : palette.stone));
}
