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

  console.info('[materials] textures', JSON.stringify(materials.textureStats()));
  return {};
}
