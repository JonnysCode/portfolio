// BASELINE (to be replaced by the environment builder): a ring of simple trees.
import * as THREE from 'three';
import { getHeight, isFreeForScenery } from './ground.js';
import { materials } from '../core/materials.js';
import { palette } from '../core/palette.js';
import { createRng } from '../core/rng.js';

export default async function build(ctx) {
  const rng = createRng('veg-baseline');
  const trunk = new THREE.CylinderGeometry(0.3, 0.45, 3, 7);
  trunk.translate(0, 1.5, 0);
  const crown = new THREE.IcosahedronGeometry(2.2, 0);
  crown.translate(0, 4.2, 0);
  const count = 220;
  const tMesh = new THREE.InstancedMesh(trunk, materials.toon(palette.bark), count);
  const cMesh = new THREE.InstancedMesh(crown, materials.toon(palette.leaf, { flatShading: true }), count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let n = 0;
  for (let tries = 0; tries < 4000 && n < count; tries++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(8, 95);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!isFreeForScenery(x, z, 2)) continue;
    const sc = rng.range(0.8, 1.5);
    p.set(x, getHeight(x, z), z); s.set(sc, sc, sc); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, 6.28));
    m.compose(p, q, s);
    tMesh.setMatrixAt(n, m); cMesh.setMatrixAt(n, m);
    if (r < 68) ctx.colliders.addCircle(x, z, 0.5 * sc, 'tree');
    n++;
  }
  tMesh.count = cMesh.count = n;
  tMesh.castShadow = cMesh.castShadow = true;
  ctx.scene.add(tMesh, cMesh);
  return {};
}
