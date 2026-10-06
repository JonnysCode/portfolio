// Props showcase scene (?scene=showcase) — a flat stage with every prop in a row,
// used while developing the props kit:
//   npm run shots -- --param scene=showcase --custom "row:0,4,12:0,1,0"
import * as THREE from 'three';
import * as props from './index.js';
import { materials } from '../core/materials.js';
import { palette } from '../core/palette.js';

export default async function build(ctx) {
  const stage = new THREE.Mesh(new THREE.CircleGeometry(40, 64), materials.toon(palette.grass));
  stage.rotation.x = -Math.PI / 2;
  stage.receiveShadow = true;
  ctx.scene.add(stage);
  const items = [
    props.makeMushroomHouse({ seed: 1 }),
    props.makePerson({ seed: 2 }).group,
    props.makeSnail({ post: true }).group,
    props.makeSign({ text: 'Schreinerei' }),
    props.makeLampPost(),
    props.makeBench(),
    props.makeBarrel(),
  ];
  items.forEach((o, i) => {
    o.position.x = (i - (items.length - 1) / 2) * 3.2;
    ctx.scene.add(o);
  });
  return {};
}
