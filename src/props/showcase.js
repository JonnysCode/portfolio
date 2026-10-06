// Props showcase scene (?scene=showcase) — a flat stage with every prop in rows,
// used while developing the props kit. Close-up camera spots (px,py,pz:tx,ty,tz):
//   houses   "houses:0,7,8:0,2.5,-14"        people  "people:0,1.3,-0.6:0,0.6,-4"
//   snails   "snails:6,2.4,9:6,1,3"          signs   "signs:0,2.6,19:0,1.3,12"
//   decorA   "decorA:0,2.2,23:0,0.5,18"      decorB  "decorB:0,2.2,28:0,0.4,23"
//   strings  "strings:0,3,35:0,1,29"
//   npm run shots -- --prefix props- --param scene=showcase --custom "signs:0,2.6,19:0,1.3,12" --views spawn
import * as THREE from 'three';
import * as props from './index.js';
import { materials } from '../core/materials.js';
import { palette } from '../core/palette.js';
import { DISTRICTS } from '../world/layout.js';

function row(ctx, items, z, gap) {
  items.forEach((o, i) => {
    const obj = o.group ?? o;
    obj.position.set((i - (items.length - 1) / 2) * gap, obj.position.y, z);
    ctx.scene.add(obj);
  });
}

export default async function build(ctx) {
  const stage = new THREE.Mesh(new THREE.CircleGeometry(70, 64), materials.toon(palette.grass));
  stage.rotation.x = -Math.PI / 2;
  stage.receiveShadow = true;
  ctx.scene.add(stage);

  // row 1: houses
  const houses = [
    props.makeMushroomHouse({ seed: 1, capShape: 'dome', plaque: 'Schreinerei' }),
    props.makeMushroomHouse({ seed: 2, capShape: 'tall', height: 6.5, capRadius: 3.2 }),
    props.makeMushroomHouse({ seed: 3, capShape: 'flat', capColor: palette.capOchre }),
    props.makeMushroomHouse({ seed: 4, capShape: 'droopy', height: 6, capRadius: 3.6, capColor: palette.capLavender, balcony: true }),
  ];
  row(ctx, houses, -14, 8.5);

  // row 2: villagers — hats / actions / held items
  const people = [
    props.makePerson({ seed: 'jonny', shirt: '#4f6d9a', pants: '#3b4a5c', hat: 'beanie', hatColor: '#d9673b', apron: true, hairColor: '#6b4430', holding: 'plane', action: 'work' }),
    props.makePerson({ seed: 'a', hat: 'mushroom', action: 'wave' }),
    props.makePerson({ seed: 'b', hat: 'straw', holding: 'hammer', action: 'work' }),
    props.makePerson({ seed: 'c', hat: 'acorn', holding: 'mug', action: 'idle', glasses: true }),
    props.makePerson({ seed: 'd', hat: 'cap', holding: 'wrench', action: 'work' }),
    props.makePerson({ seed: 'e', hat: 'bandana', holding: 'paintbrush', action: 'work', hair: 'pony' }),
    props.makePerson({ seed: 'f', hat: 'none', hair: 'curly', holding: 'laptop', action: 'work' }),
    props.makePerson({ seed: 'g', hat: 'none', hair: 'bun', holding: 'book', action: 'work', scarf: true }),
    props.makePerson({ seed: 'h', hat: 'none', hair: 'spiky', action: 'cheer' }),
    props.makePerson({ seed: 'i', hat: 'none', hair: 'short', beard: true, glasses: true, holding: 'pump', action: 'work' }),
    props.makePerson({ seed: 'k', hat: 'none', hair: 'long', action: 'walk' }),
    props.makePerson({ seed: 'l', hat: 'beanie', action: 'talk' }),
  ];
  row(ctx, people, -4, 1.0);

  // row 3: snails (one ridden)
  const snails = [props.makeSnail({ post: true, seed: 'p1' }), props.makeSnail({ seed: 's2' }), props.makeSnail({ post: true, seed: 'p3' })];
  snails.forEach((s, i) => {
    s.group.position.set(2.5 + i * 3.4, 0, 3);
    s.group.rotation.y = i === 1 ? -0.6 : 0.6;
    ctx.scene.add(s.group);
  });
  snails[2].setMoving(1);
  const rider = props.makePerson({ seed: 'rider', hat: 'cap', hatColor: palette.postYellow, action: 'ride' });
  snails[2].seat.add(rider.group);
  // a sitter on a bench next to the snails
  const bench0 = props.makeBench({ length: 1.4 });
  bench0.position.set(-8, 0, 3);
  ctx.scene.add(bench0);
  const sitter = props.makePerson({ seed: 'sitter', hat: 'straw', action: 'sit', holding: 'book' });
  sitter.group.position.copy(bench0.userData.seats[0]).add(bench0.position);
  ctx.scene.add(sitter.group);

  // row 4: signs
  const arrows = DISTRICTS.map((d) => ({ text: d.title, angle: Math.atan2(d.center.x, d.center.z), color: d.color }));
  const signs = [
    props.makeSign({ text: 'Schreinerei', style: 'post', width: 2.2 }),
    props.makeSign({ text: 'Village Notices', style: 'board', width: 1.8 }),
    props.makeSign({ text: 'Velowerkstatt', style: 'hanging', width: 1.5, color: palette.capOchre }),
    props.makeSign({ text: 'To the pond', style: 'arrow', width: 1.5 }),
    props.makeSignpost(arrows),
    props.makeSign({ text: 'Code\nGrove', style: 'post', width: 1.0, color: palette.capTeal }),
  ];
  row(ctx, signs, 12, 3.6);

  // row 5: furniture & storage
  const decorA = [
    props.makeLampPost(),
    props.makeLampPost({ style: 'top', height: 1.8 }),
    props.makeBench(),
    props.makeBench({ style: 'log', length: 1.4 }),
    props.makeTable({ style: 'round', cloth: palette.capRed }),
    props.makeChair({ cushion: palette.capTeal }),
    props.makeTable({ style: 'picnic' }),
    props.makeBarrel(),
    props.makeBarrel({ contents: 'apples', height: 0.75 }),
    props.makeCrate({ contents: 'apples' }),
    props.makeCrate({ contents: 'planks' }),
    props.makeLogPile(),
    props.makeParcel(),
    props.makeWheelbarrow({ contents: 'logs' }),
  ];
  row(ctx, decorA, 18, 1.9);

  // row 6: nature & village bits
  const decorB = [
    props.makeRock({ seed: 'r1' }),
    props.makeRock({ seed: 'r2', size: 0.9 }),
    props.makeStump({ axe: true }),
    props.makeBush({ seed: 'b1', berries: true }),
    props.makeBush({ seed: 'b2', flowers: '#f2a7c3' }),
    props.makeFlowerPatch({ seed: 'fp' }),
    props.makeSmallMushroom(),
    props.makeMushroomCluster({ seed: 'mc' }),
    props.makeMushroomCluster({ seed: 'gl', glow: true }),
    props.makePottedPlant({ plant: 'leafy', seed: 'p1' }),
    props.makePottedPlant({ plant: 'flower', seed: 'p2' }),
    props.makePottedPlant({ plant: 'sapling', seed: 'p3' }),
    props.makePottedPlant({ plant: 'succulent', seed: 'p4' }),
    props.makeFlowerBox(),
    props.makeMailbox(),
    props.makeWell(),
  ];
  row(ctx, decorB, 23, 1.7);
  const tools = props.TOOL_NAMES.map((n) => props.makeTool(n, { scale: 2 }));
  tools.forEach((t, i) => {
    t.position.set(-6 + i * 1.0, 0.5, 26);
    ctx.scene.add(t);
  });

  // row 7: fences, bunting, string lights, stones
  const fence = props.makeFence([{ x: -14, z: 29 }, { x: -11, z: 29 }, { x: -9, z: 30 }]);
  const rail = props.makeFence([{ x: -8, z: 29 }, { x: -5, z: 29 }, { x: -3, z: 30.5 }], { style: 'rail' });
  const bunting = props.makeBunting([{ x: -2, y: 2.4, z: 29 }, { x: 2, y: 2.2, z: 29 }, { x: 5, y: 2.5, z: 30 }]);
  const lights = props.makeStringLights([{ x: 6, y: 2.2, z: 29 }, { x: 10, y: 2.0, z: 29 }, { x: 13, y: 2.3, z: 30 }]);
  const ring = props.makeStoneCircle(1.6);
  ring.position.set(0, 0, 33);
  const paved = props.makeStoneCircle(1.4, { fill: true, width: 0.45 });
  paved.position.set(5, 0, 33);
  const steps = props.makeSteppingStones([{ x: -6, z: 33 }, { x: -3, z: 34 }, { x: -2, z: 36 }]);
  for (const o of [fence, rail, bunting, lights, ring, paved, steps]) ctx.scene.add(o);
  for (const [x, z] of [[-2, 29], [5, 30], [6, 29], [13, 30]]) {
    const pole = props.makeLampPost({ style: 'top', height: 2.2 });
    pole.position.set(x, 0, z - 0.2);
    ctx.scene.add(pole);
  }

  window.__props = { houses, people, snails, signs, decorA, decorB };
  return {};
}
