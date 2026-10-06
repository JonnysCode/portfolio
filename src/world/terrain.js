// BLOCKOUT — the forest-floor builder replaces this with the painted ground.
import * as THREE from 'three';
import { heightGrid, pathGrid, GRID_RES } from './ground.js';
import { TERRAIN_HALF_SIZE } from './layout.js';

export default async function build(ctx) {
  const N = GRID_RES + 1;
  const geo = new THREE.PlaneGeometry(TERRAIN_HALF_SIZE * 2, TERRAIN_HALF_SIZE * 2, GRID_RES, GRID_RES);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const moss = new THREE.Color('#5d7f34'), dirt = new THREE.Color('#8a6a48'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // after rotateX(−π/2), row iz sits at z = −HALF + iz·CELL — same layout as heightGrid
    const gi = Math.floor(i / N) * N + (i % N);
    pos.setY(i, heightGrid[gi]);
    c.copy(moss).lerp(dirt, 1 - THREE.MathUtils.smoothstep(pathGrid[gi], 0.6, 1.1));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  ctx.scene.add(mesh);
  ctx.terrainMesh = mesh;
  return {};
}
