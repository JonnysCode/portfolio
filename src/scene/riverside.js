// BLOCKOUT — the riverside builder replaces this (stream, waterfall, stone bridge, bike workshop).
import * as THREE from 'three';
import { STREAM, RIVERSIDE } from '../world/layout.js';
import { streamPolyline } from '../world/ground.js';
import { anchorGroup } from '../world/index.js';

export default async function build(ctx) {
  const { materials } = ctx;
  // water ribbon
  const pts = streamPolyline.pts;
  const pos = [];
  const idx = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    const w = STREAM.halfWidth * 1.25;
    pos.push(pts[i].x - tz * w, STREAM.waterLevel, pts[i].z + tx * w, pts[i].x + tz * w, STREAM.waterLevel, pts[i].z - tx * w);
    if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const water = new THREE.Mesh(geo, materials.standard('#5fa8b8', { roughness: 0.1, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  ctx.scene.add(water);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(STREAM.pool.radius * 1.1, 32), water.material);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(STREAM.pool.x, STREAM.waterLevel, STREAM.pool.z);
  ctx.scene.add(pool);
  // falls
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(1.6, STREAM.falls.top + 0.5), materials.standard('#d8f0f4', { transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
  fall.position.set(STREAM.falls.lipX, STREAM.falls.top / 2, STREAM.falls.lipZ);
  fall.lookAt(STREAM.pool.x, STREAM.falls.top / 2, STREAM.pool.z);
  ctx.scene.add(fall);
  // bridge
  const b = RIVERSIDE.bridge;
  const bridge = anchorGroup(ctx, { x: b.x, z: b.z, y: 0, rotY: b.rotY }, 'bridge');
  const arch = new THREE.Mesh(new THREE.TorusGeometry(b.span / 2, 0.45, 8, 24, Math.PI), materials.surface('stone'));
  arch.scale.set(1, 0.42, b.width / 0.9);
  bridge.add(arch);
  // bike shed
  const shed = anchorGroup(ctx, RIVERSIDE.bikeShed, 'bike-shed');
  const box = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2, 3, 16), materials.surface('stone'));
  box.position.y = 1.5;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.8, 2.2, 20), materials.surface('mushroomCap', { color: '#d9792f' }));
  cap.position.y = 3.9;
  shed.add(box, cap);
  ctx.interactions.add(shed, { entryId: 'bike-build', area: 'bikes' });
  for (const o of [arch, box, cap]) { o.castShadow = o.receiveShadow = true; }
  return {};
}
