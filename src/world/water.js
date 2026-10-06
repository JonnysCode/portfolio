// BASELINE (to be replaced by the environment builder): flat pond surface.
import * as THREE from 'three';
import { POND } from './layout.js';
import { materials } from '../core/materials.js';
import { palette } from '../core/palette.js';

export default async function build(ctx) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(POND.radius * 1.15, 48),
    materials.toon(palette.water, { transparent: true, opacity: 0.85 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(POND.center.x, POND.waterLevel, POND.center.z);
  ctx.scene.add(mesh);
  return {};
}
