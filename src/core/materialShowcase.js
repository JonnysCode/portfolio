// ─────────────────────────────────────────────────────────────────────────────
// Material showcase (?scene=materials) — every surface kind and foliage
// variant on simple shapes under the glen lighting, for look-dev.
//
//   npm run shots -- --prefix materials- --param scene=materials --views glen \
//     --custom "all:0,14,34:0,1,0" --custom "organic:-7.8,1.7,16.4:-7.8,1,12"
//
// Rows (z): 12 organic spheres (triplanar) · 6 wood & building boxes (uv)
//           0 roofs, cloth, rope, glass, paper, clay, leaf · −6 mushrooms & gills
//         −12 foliage cards (flat card + crossed cluster per variant)
//         −22 builder-scale look-dev: giant trunk (bark scale 1.6), limb (1.25),
//             forest giant (1.8), boxy field stones (stone / mossy / rock), cobbles
//   npm run shots -- --param scene=materials --custom "trunk:-8,3,-12.5:-8,4.5,-20" \
//     --custom "stones:5,1.5,-15.5:5,0.35,-20.5"
// Columns are 2.6 apart, centred on x = 0. Rows are 6 apart so a close-up
// camera fits between them (e.g. "row:x,1.7,z+4.4:x,1,z").
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { materials } from './materials.js';

const GAP = 2.6;

function label(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,16,12,0.55)';
  g.fillRect(0, 0, 256, 48);
  g.fillStyle = '#fff6e0';
  g.font = '600 26px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 25);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, toneMapped: false }));
  s.scale.set(1.6, 0.3, 1);
  return s;
}

function place(ctx, obj, i, n, z, name, y = 0) {
  const x = (i - (n - 1) / 2) * GAP;
  obj.position.x += x;
  obj.position.z += z;
  obj.position.y += y;
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  ctx.scene.add(obj);
  const l = label(name);
  l.position.set(x, 2.45, z);
  ctx.scene.add(l);
}

function mesh(geo, mat, y = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  return m;
}

/** Lathe profile for a cap: listed from the rim (v = 0) to the apex (v = 1). */
function capGeometry(r = 1, h = 0.9, shape = 'dome') {
  const pts = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 rim → 1 apex
    let rr, yy;
    if (shape === 'cone') {
      rr = r * (1 - t) ** 1.15;
      yy = h * Math.sin(t * Math.PI * 0.5) ** 0.9;
    } else {
      const a = t * Math.PI * 0.5;
      rr = r * Math.cos(a) * (1 + 0.08 * Math.sin(t * Math.PI));
      yy = h * Math.sin(a);
    }
    pts.push(new THREE.Vector2(Math.max(rr, 0.0001), yy - 0.06 * (1 - t) ** 3));
  }
  return new THREE.LatheGeometry(pts, 48);
}

function mushroom(capMat, { r = 1, h = 0.9, shape = 'dome', stemH = 1.1 } = {}) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, stemH, 24, 4), materials.surface('mushroomStem', { repeat: [2, 1] }));
  stem.position.y = stemH / 2;
  const cap = new THREE.Mesh(capGeometry(r, h, shape), capMat);
  cap.position.y = stemH - 0.05;
  const gills = new THREE.Mesh(new THREE.RingGeometry(0.25, r * 0.98, 64, 1), materials.surface('gills', { side: THREE.DoubleSide }));
  gills.rotation.x = Math.PI / 2;
  gills.position.y = stemH - 0.04;
  g.add(stem, cap, gills);
  return g;
}

function cardCluster(mat, size = 1.4, cards = 5) {
  const g = new THREE.Group();
  const geos = [];
  for (let i = 0; i < cards; i++) {
    const q = new THREE.PlaneGeometry(size, size);
    q.translate(0, size / 2, 0);
    q.rotateX(-0.35 - 0.25 * (i % 2));
    q.rotateY((i / cards) * Math.PI * 2);
    geos.push(q);
  }
  for (const q of geos) {
    materials.foliageNormals(q, new THREE.Vector3(0, size * 0.35, 0));
    g.add(new THREE.Mesh(q, mat));
  }
  return g;
}

/** A lumpy, roughly dressed field stone (like the builders' stones): box → bulged, jittered. */
function fieldStone(seed, sx, sy, sz) {
  const g = new RoundedBoxGeometry(1, 1, 1, 3, 0.22);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 5.1 + seed) * Math.cos(v.z * 4.3 - seed * 0.7) * 0.05 + Math.sin(v.y * 6.7 + seed * 1.3) * 0.03;
    v.multiplyScalar(1 + n);
    if (v.y > 0) v.y *= 0.92; // flatter top, like a dressed face
    p.setXYZ(i, v.x * sx, v.y * sy, v.z * sz);
  }
  g.computeVertexNormals();
  return g;
}

function buildLookDev(ctx) {
  const Z = -22;
  const add = (geo, mat, x, y, z, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(0, ry, rz);
    m.castShadow = m.receiveShadow = true;
    ctx.scene.add(m);
    return m;
  };
  const tag = (text, x, y, z) => {
    const l = label(text);
    l.position.set(x, y, z);
    ctx.scene.add(l);
  };
  // giant trunk at the oak's scale (diameter ~7)
  add(new THREE.CylinderGeometry(3.2, 3.9, 18, 96, 24), materials.surface('bark', { mossy: 0.17, scale: 1.6 }), -8, 9, Z);
  tag('bark s1.6 m0.17', -8, 0.6, Z + 4.3);
  // a leaning limb at the oak's limb scale
  add(new THREE.CylinderGeometry(0.9, 1.15, 9, 48, 12), materials.surface('bark', { mossy: 0.3, scale: 1.25 }), -1.8, 4.2, Z + 1, 0, 0.35);
  tag('bark s1.25 m0.3', -1.2, 0.6, Z + 2.6);
  // forest giant scale
  add(new THREE.CylinderGeometry(2.0, 2.5, 18, 72, 20), materials.surface('bark', { mossy: 0.3, scale: 1.8 }), -15.5, 9, Z - 1);
  tag('bark s1.8 m0.3', -15.5, 0.6, Z + 2);
  // boxy field stones: plain, mossy, rock — a little course + loose stones
  const kinds = [
    ['stone', {}], ['stone', { mossy: 0.3 }], ['stone', { mossy: 0.4 }], ['rock', { scale: 0.5, mossy: 0.1 }],
  ];
  kinds.forEach(([k, o], i) => {
    const mat = materials.surface(k, o);
    const x0 = 2.2 + i * 2.1;
    for (let j = 0; j < 3; j++) {
      const s = 0.42 + 0.12 * ((i * 3 + j) % 3);
      add(fieldStone(i * 7 + j, s * 1.3, s * 0.8, s), mat, x0 + (j - 1) * 0.62, s * 0.38, Z + 2.3 + (j % 2) * 0.5, (i + j) * 0.7);
    }
    add(fieldStone(i * 11 + 5, 1.1, 0.7, 0.8), mat, x0, 0.33, Z + 1.0, i * 0.4);
    tag(k + (o.mossy ? ` m${o.mossy}` : ''), x0, 1.35, Z + 1.0);
  });
  // cobble patch
  add(new THREE.BoxGeometry(5, 0.12, 3.2), materials.surface('cobble'), 13.5, 0.06, Z + 1.6);
  tag('cobble', 13.5, 0.9, Z + 1.6);

  // row 6 (z = -32) — joinery at builder scale: a partition of single boards
  // (each at its own UV offset, like the builders' board()), a glued-up top,
  // a plank floor, and a patch of moss ground with a doorstep for scale.
  //   --custom "joinery:0,1.6,-27.5:0,0.8,-32.5"   --custom "mossfloor:9,1.4,-29:9,0,-33"
  const Z2 = -32;
  const rand = (() => {
    let s = 7;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();
  const boardGeo = (w, h, d, grain) => materials.boxUV(new THREE.BoxGeometry(w, h, d), 1.4, { grain, offset: [rand() * 7, rand() * 7] });
  const spruce = materials.surface('wood', { species: 'spruce' });
  for (let i = 0; i < 9; i++) add(boardGeo(0.235, 2.3, 0.04, 'y'), spruce, -7.2 + i * 0.24, 1.15, Z2);
  tag('partition (spruce boards)', -6.2, 2.6, Z2 + 0.1);
  const oak = materials.surface('wood', { species: 'oak' });
  for (let i = 0; i < 4; i++) add(boardGeo(1.6, 0.04, 0.18, 'x'), oak, -2.2, 0.9, Z2 - 0.27 + i * 0.181);
  add(new THREE.BoxGeometry(1.4, 0.88, 0.5), materials.surface('wood', { species: 'walnut' }), -2.2, 0.44, Z2);
  tag('glued-up oak top', -2.2, 1.6, Z2);
  const planks = new THREE.PlaneGeometry(4, 3);
  planks.rotateX(-Math.PI / 2);
  add(materials.boxUV(planks, 1.6, { grain: 'x' }), materials.surface('wood', { species: 'oak', planks: true }), 2.4, 0.02, Z2);
  tag('oak planks', 2.4, 0.9, Z2);
  const ground = new THREE.PlaneGeometry(6, 5, 1, 1);
  ground.rotateX(-Math.PI / 2);
  add(ground, materials.surface('moss'), 9, 0.015, Z2);
  add(new THREE.BoxGeometry(0.9, 0.18, 0.5), materials.surface('stone', { mossy: 0.3 }), 9.4, 0.09, Z2 - 0.6);
  tag('moss ground', 9, 0.9, Z2 + 1.5);
}

export default async function build(ctx) {
  // neutral stage
  const stage = new THREE.Mesh(new THREE.CircleGeometry(40, 64), materials.standard('#77736a', { roughness: 0.95 }));
  stage.rotation.x = -Math.PI / 2;
  stage.receiveShadow = true;
  ctx.scene.add(stage);

  const sphere = new THREE.SphereGeometry(0.95, 64, 40);

  // row 0 — organic, triplanar
  const organic = [
    ['bark', {}], ['rock', {}], ['stone', {}], ['cobble', {}], ['moss', {}], ['soil', {}],
    ['metal', {}], ['stone', { mossy: 0.55 }], ['rock', { mossy: 0.8 }], ['bark', { mossy: 0.45 }],
  ];
  organic.forEach(([k, o], i) => place(ctx, mesh(sphere, materials.surface(k, o)), i, organic.length, 12, k + (o.mossy ? ` m${o.mossy}` : '')));

  // row 1 — wood & building, world-sized box UVs
  const box = () => materials.boxUV(new RoundedBoxGeometry(1.7, 1.7, 1.7, 4, 0.12), 1.4, { grain: 'x' });
  const boxes = [
    ['wood', { species: 'oak' }, 'oak'], ['wood', { species: 'walnut' }, 'walnut'], ['wood', { species: 'spruce' }, 'spruce'],
    ['wood', { species: 'ash' }, 'ash'], ['wood', { species: 'cherry' }, 'cherry'], ['wood', { species: 'maple' }, 'maple'],
    ['wood', { species: 'oak', planks: true }, 'oak planks'], ['wood', { species: 'spruce', planks: true }, 'spruce planks'],
    ['timber', {}, 'timber'], ['plaster', {}, 'plaster'],
  ];
  boxes.forEach(([k, o, name], i) => place(ctx, mesh(box(), materials.surface(k, o)), i, boxes.length, 6, name));

  // row 2 — roofs, cloth, rope, glass, paper, clay, leaf
  const roof = (mat) => {
    const g = new THREE.ConeGeometry(1.25, 1.9, 4, 1, true);
    g.rotateY(Math.PI / 4);
    return mesh(g, mat, 0.95);
  };
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.8, 0.3, 0), new THREE.Vector3(-0.3, 1.6, 0.2), new THREE.Vector3(0.4, 0.6, -0.2), new THREE.Vector3(0.8, 1.7, 0),
  ]), 96, 0.14, 16);
  const pot = new THREE.LatheGeometry([
    [0.0, 0], [0.5, 0], [0.62, 0.15], [0.72, 0.6], [0.6, 1.1], [0.42, 1.3], [0.48, 1.42], [0.44, 1.45],
  ].map(([x, y]) => new THREE.Vector2(x, y)), 40);
  const leafGeo = new THREE.PlaneGeometry(0.9, 1.6, 1, 1);
  const row2 = [
    [roof(materials.surface('shingles', { repeat: [4, 2], side: THREE.DoubleSide })), 'shingles'],
    [roof(materials.surface('shingles', { repeat: [4, 2], mossy: 0.5, side: THREE.DoubleSide })), 'shingles m0.5'],
    [roof(materials.surface('thatch', { repeat: [3, 2], side: THREE.DoubleSide })), 'thatch'],
    [mesh(box(), materials.surface('fabric', { color: '#a8452e', repeat: 3 })), 'fabric red'],
    [mesh(box(), materials.surface('fabric', { color: '#4f6d9a', repeat: 3 })), 'fabric blue'],
    [mesh(tube, materials.surface('rope', { repeat: [2, 1] }), 0), 'rope'],
    [mesh(sphere, materials.surface('glass')), 'glass'],
    [mesh(box(), materials.surface('paper')), 'paper'],
    [mesh(pot, materials.surface('clay', { repeat: [3, 1] }), 0), 'clay'],
    [mesh(leafGeo, materials.surface('leaf', { side: THREE.DoubleSide })), 'leaf'],
  ];
  row2.forEach(([o, name], i) => place(ctx, o, i, row2.length, 0, name));

  // row 3 — mushrooms
  const row3 = [
    [mushroom(materials.surface('mushroomCap'), { shape: 'cone', h: 1.3 }), 'cap red cone'],
    [mushroom(materials.surface('mushroomCap', { color: '#d9792f' })), 'cap orange'],
    [mushroom(materials.surface('mushroomCap', { color: '#8a5a3a' }), { h: 0.6 }), 'cap brown'],
    [mushroom(materials.surface('mushroomCap', { color: '#e8c060' }), { h: 0.75 }), 'cap ochre'],
    [mesh(new THREE.CylinderGeometry(0.7, 0.8, 2, 32, 4), materials.surface('mushroomStem', { repeat: [3, 1] })), 'stem'],
    [(() => {
      const d = new THREE.Mesh(new THREE.CircleGeometry(1, 96), materials.surface('gills', { side: THREE.DoubleSide }));
      d.rotation.x = -0.9;
      d.position.y = 1.1;
      return d;
    })(), 'gills disc'],
  ];
  row3.forEach(([o, name], i) => place(ctx, o, i, row3.length, -6, name));

  // row 4 — foliage cards
  const variants = ['oak', 'fern', 'ivy', 'grass', 'needle', 'blossom'];
  variants.forEach((v, i) => {
    const mat = materials.foliage({ variant: v });
    const card = new THREE.Mesh(new THREE.PlaneGeometry(1.8, v === 'grass' ? 1.8 : 1.8), mat);
    card.geometry.translate(0, 0.9, 0);
    if (v === 'grass') card.scale.x = 0.5;
    const g = new THREE.Group();
    card.position.x = -0.55;
    const cl = cardCluster(mat, 1.2, v === 'grass' ? 7 : 5);
    cl.position.x = 0.75;
    g.add(card, cl);
    place(ctx, g, i, variants.length, -12, v);
  });

  // row 5 — builder-scale look-dev (z = -22): a giant trunk & a limb at the
  // scales the oak uses, a forest giant, boxy field stones and a cobble patch
  buildLookDev(ctx);

  console.info('[materials] textures', JSON.stringify(materials.textureStats()));
  return {};
}
