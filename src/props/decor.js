// PLACEHOLDER — the props builder replaces these with detailed versions.
// Each returns a THREE.Group with origin at ground level, front facing +Z.
import * as THREE from 'three';
import { materials } from '../core/materials.js';
import { palette } from '../core/palette.js';

function simple(geo, color, y) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, materials.toon(color));
  m.position.y = y;
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return g;
}

/** Hanging/standing lantern; glows at night. opts { color } */
export function makeLantern(opts = {}) {
  const g = simple(new THREE.BoxGeometry(0.3, 0.4, 0.3), palette.windowFrame, 0.2);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), materials.glow(opts.color ?? palette.windowGlow));
  glow.position.y = 0.2;
  g.add(glow);
  return g;
}
/** Street lamp post ~2.6 tall with a glowing lantern head. */
export function makeLampPost(opts = {}) {
  const g = simple(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 6), palette.barkDark, 1.3);
  const head = makeLantern(opts);
  head.position.y = 2.5;
  g.add(head);
  return g;
}
/** Picket fence along XZ points [{x,z}, …] (local coords). opts { color, height } */
export function makeFence(points = [], opts = {}) {
  const g = new THREE.Group();
  const mat = materials.wood(opts.color ?? 'spruce', { grain: false });
  const h = opts.height ?? 0.7;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, len), mat);
    rail.position.set((a.x + b.x) / 2, h * 0.7, (a.z + b.z) / 2);
    rail.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    g.add(rail);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, h, 0.1), mat);
    post.position.set(a.x, h / 2, a.z);
    g.add(post);
  }
  return g;
}
export const makeBench = () => simple(new THREE.BoxGeometry(1.6, 0.1, 0.5), palette.oak, 0.45);
export const makeBarrel = () => simple(new THREE.CylinderGeometry(0.4, 0.4, 0.9, 12), palette.oak, 0.45);
export const makeCrate = () => simple(new THREE.BoxGeometry(0.7, 0.7, 0.7), palette.spruce, 0.35);
export const makePottedPlant = () => simple(new THREE.CylinderGeometry(0.2, 0.15, 0.35, 10), palette.capCoral, 0.17);
export const makeRock = () => simple(new THREE.DodecahedronGeometry(0.5, 0), palette.stone, 0.3);
export const makeStump = () => simple(new THREE.CylinderGeometry(0.5, 0.6, 0.6, 12), palette.bark, 0.3);
export const makeBush = () => simple(new THREE.IcosahedronGeometry(0.7, 1), palette.leaf, 0.5);
export const makeFlowerPatch = () => simple(new THREE.SphereGeometry(0.25, 8, 6), palette.capCoral, 0.15);
/** Bunting flags strung between local points [{x,y,z}, …]. */
export function makeBunting() { return new THREE.Group(); }
export const makeMailbox = () => simple(new THREE.BoxGeometry(0.4, 0.3, 0.5), palette.swissRed, 1.0);
export const makeSmallMushroom = (opts = {}) => simple(new THREE.SphereGeometry(0.3, 10, 8), opts.color ?? palette.capRed, 0.35);
export const makeLogPile = () => simple(new THREE.CylinderGeometry(0.25, 0.25, 1.6, 10), palette.bark, 0.25);
