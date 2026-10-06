// PLACEHOLDER — the props builder replaces this with the real riding snail.
import * as THREE from 'three';
import { materials } from '../core/materials.js';
import { palette } from '../core/palette.js';

/**
 * A rideable snail. Origin at ground under the body centre, facing (crawling towards) +Z.
 * @param {object} [opts] { seed, shellColor, bodyColor, saddle=true, post=false (yellow Schneckenpost livery), scale=1 }
 * @returns {{ group: THREE.Group, seat: THREE.Object3D, length: number, setMoving(amount: number): void, update(dt: number): void }}
 */
export function makeSnail(opts = {}) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.6, 4, 12), materials.toon(opts.bodyColor ?? palette.snailBody));
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.32;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.85, 18, 14), materials.toon(opts.post ? palette.postYellow : opts.shellColor ?? palette.shell[0]));
  shell.position.set(0, 1.05, -0.25);
  for (const m of [body, shell]) { m.castShadow = true; g.add(m); }
  const seat = new THREE.Object3D();
  seat.position.set(0, 1.85, -0.2);
  g.add(seat);
  if (opts.scale) g.scale.setScalar(opts.scale);
  return { group: g, seat, length: 2.3, setMoving() {}, update() {} };
}
