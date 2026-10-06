// BLOCKOUT — the Schreinerei builder replaces this.
import * as THREE from 'three';
import { OAK, SCHREINEREI } from '../world/layout.js';
import { anchorGroup } from '../world/index.js';

export default async function build(ctx) {
  const { materials } = ctx;
  const door = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.2, 24, 1, false, 0, Math.PI), materials.surface('wood', { species: 'oak' }));
  door.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  door.position.set(OAK.door.x, 0.9, OAK.door.z);
  ctx.scene.add(door);
  ctx.interactions.add(door, { entryId: 'efz-certificate', area: 'woodworking' });
  const annex = anchorGroup(ctx, SCHREINEREI.annex, 'annex');
  const box = new THREE.Mesh(new THREE.BoxGeometry(SCHREINEREI.annex.width, 3.2, SCHREINEREI.annex.depth), materials.surface('plaster'));
  box.position.y = 1.6;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.3, 2.4, 4), materials.surface('shingles'));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 4.4;
  annex.add(box, roof);
  const porch = anchorGroup(ctx, SCHREINEREI.porch, 'porch');
  const bench = new THREE.Mesh(new THREE.BoxGeometry(2, 0.9, 0.8), materials.surface('wood', { species: 'ash' }));
  bench.position.y = 0.45;
  porch.add(bench);
  ctx.interactions.add(bench, { entryId: 'workbench-wip', area: 'woodworking' });
  const deck = anchorGroup(ctx, SCHREINEREI.deck, 'deck');
  const table = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 1.1), materials.surface('wood', { species: 'oak' }));
  table.position.y = 0.4;
  const player = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.55), materials.surface('wood', { species: 'walnut' }));
  player.position.set(1.8, 0.9, 0.2);
  deck.add(table, player);
  ctx.interactions.add(table, { entryId: 'dining-table', area: 'woodworking' });
  ctx.interactions.add(player, { entryId: 'record-player', area: 'woodworking' });
  for (const o of [door, box, roof, bench, table, player]) { o.castShadow = o.receiveShadow = true; }
  return {};
}
