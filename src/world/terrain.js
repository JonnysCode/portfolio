// BASELINE (to be replaced by the environment builder): heightfield mesh with grass/path vertex colours.
import * as THREE from 'three';
import { heightGrid, pathGrid, GRID_RES } from './ground.js';
import { TERRAIN_HALF_SIZE } from './layout.js';
import { palette } from '../core/palette.js';
import { materials } from '../core/materials.js';

export default async function build(ctx) {
  const N = GRID_RES + 1;
  const geo = new THREE.PlaneGeometry(TERRAIN_HALF_SIZE * 2, TERRAIN_HALF_SIZE * 2, GRID_RES, GRID_RES);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(palette.grass), dirt = new THREE.Color(palette.dirt), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // after rotateX(−π/2), PlaneGeometry row iz sits at z = −HALF + iz·CELL — same layout as heightGrid
    const ix = i % N, iz = Math.floor(i / N);
    const gi = iz * N + ix;
    pos.setY(i, heightGrid[gi]);
    const p = pathGrid[gi];
    c.copy(grass).lerp(dirt, 1 - THREE.MathUtils.smoothstep(p, 0.7, 1.1));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, materials.toon('#ffffff', { vertexColors: true }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  ctx.scene.add(mesh);
  ctx.terrainMesh = mesh;
  return {};
}
