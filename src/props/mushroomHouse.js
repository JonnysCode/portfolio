// PLACEHOLDER — the props builder replaces this with the real mushroom house.
import * as THREE from 'three';
import { materials } from '../core/materials.js';
import { palette } from '../core/palette.js';

/**
 * A cute mushroom house.
 * @param {object} [opts]
 * @param {string} [opts.capColor]   cap colour (palette.capRed …)
 * @param {string} [opts.spotColor]
 * @param {string} [opts.stemColor]
 * @param {number} [opts.height=5]   total height to the top of the cap
 * @param {number} [opts.capRadius=3]
 * @param {number} [opts.stemRadius=1.6]
 * @param {number} [opts.windows=2]
 * @param {boolean} [opts.chimney=false]
 * @param {string|number} [opts.seed]
 * @returns {THREE.Group} userData: { radius (collider radius for the stem), height, door: THREE.Vector3 (local, at ground) }
 */
export function makeMushroomHouse(opts = {}) {
  const { capColor = palette.capRed, stemColor = palette.stem, height = 5, capRadius = 3, stemRadius = 1.6 } = opts;
  const g = new THREE.Group();
  const stemH = height * 0.6;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(stemRadius * 0.9, stemRadius, stemH, 16), materials.toon(stemColor));
  stem.position.y = stemH / 2;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(capRadius, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), materials.toon(capColor));
  cap.scale.y = (height - stemH) / capRadius;
  cap.position.y = stemH * 0.95;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.2), materials.toon(palette.door));
  door.position.set(0, 0.75, stemRadius - 0.02);
  for (const m of [stem, cap, door]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  g.userData = { radius: stemRadius, height, door: new THREE.Vector3(0, 0, stemRadius + 0.6) };
  return g;
}
