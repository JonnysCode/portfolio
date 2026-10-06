// PLACEHOLDER plaza — replaced by the district builder.
import * as THREE from 'three';
import { makeSign } from '../props/index.js';
import { materials } from '../core/materials.js';
import { palette } from '../core/palette.js';

export default async function build(ctx, site) {
  const ground = new THREE.Mesh(new THREE.CircleGeometry(site.radius, 48), materials.toon(palette.stone));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.02;
  ground.receiveShadow = true;
  site.group.add(ground);
  const sign = makeSign({ text: "Jonny's Woodland", width: 3 });
  site.group.add(sign);
  site.addCollider(0, 0, 0.4);
  return {};
}
