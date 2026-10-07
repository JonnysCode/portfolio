// ─────────────────────────────────────────────────────────────────────────────
// THE GREAT OAK — the hero of the glen.
//
// A colossal, gnarled, slowly twisting oak: buttress roots snaking over the
// moss, a door niche at its foot (the Schreinerei door goes there), hollows,
// burls and knots, a fork at y ≈ 17 into massive sweeping limbs, and a huge
// crown of painterly leaf masses. All procedural (see ./oak/*).
//
// Exposes for other builders:
//   ctx.oak = {
//     group,                       // THREE.Group holding everything
//     limbs: [CatmullRomCurve3],   // the main limbs (world space), see limbInfo for radii
//     limbInfo: [{ id, curve, radiusAt(u), length }],
//     crownBounds: THREE.Box3,     // leaf masses
//     barkRadius(a, y),            // sculpted bark radius at azimuth a (rad, 0 = +Z, +π/2 = +X) & height y
//     barkPoint(a, y, lift = 0),   // world point on the bark (lifted along the radial direction)
//     roots: [{ id, a0, curve, size(t, out, tp), length }],  // buttress roots (curve is flat; add getHeight)
//     hollows: [{ id, a, y, floor, position, normal }],         // 'owl' (front-left, y≈9.7) and 'den' (back)
//     doorNiche: { halfWidth, spring, top, backZ },             // niche carved behind the Schreinerei door
//     forkY, lanterns: [Vector3],                                // fork height, hanging lantern glass positions
//   }
//
// Secrets: a tiny mouse door in the front-right root and an owl in its hollow
// are kind:'secret' hotspots (area 'woodworking'). Debug: ?oak=nomoss,noleaves
// hides moss / leaves; ?oakcards=N overrides the leaf-card budget.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OAK } from '../world/layout.js';
import { trunkRadius, polar, DOOR_NICHE, FORK_Y } from './oak/shape.js';
import { buildTrunkGeometry, buildTrunkMossGeometry, buildHollowCavities } from './oak/trunk.js';
import { buildRoots } from './oak/roots.js';
import { buildLimbs } from './oak/limbs.js';
import { buildCrown } from './oak/crown.js';
import { buildIvy } from './oak/ivy.js';
import { buildDetails } from './oak/details.js';

/** Merge geometries that share the oak's attribute layout (position/normal/uv, indexed). */
function merge(list, name) {
  const clean = list.map((g) => {
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.index) {
      const n = g.attributes.position.count;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    return g;
  });
  const out = clean.length === 1 ? clean[0] : mergeGeometries(clean, false);
  if (!out) throw new Error(`oak: could not merge ${name}`);
  if (clean.length > 1) clean.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

function staticMesh(geo, material, { cast = true, receive = true, name = '' } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.name = name;
  m.castShadow = cast;
  m.receiveShadow = receive;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

export default async function build(ctx) {
  const { materials } = ctx;
  const density = ctx.quality?.density ?? 1;
  const hi = density >= 0.9;
  const rng = ctx.rng('great-oak');
  const debug = ctx.engine?.params?.get('oak') ?? ''; // ?oak=nomoss,noleaves
  // yield between heavy steps so the loader can paint
  const tick = () => new Promise((r) => setTimeout(r, 0));

  const group = new THREE.Group();
  group.name = 'great-oak';
  ctx.scene.add(group);

  // ── bark: trunk + roots (mossy), limbs + branches ────────────────────────
  const trunkGeo = buildTrunkGeometry({ cols: hi ? 176 : 120 });
  const roots = buildRoots();
  await tick();
  const skeleton = buildLimbs(rng.fork('limbs'), { detail: hi ? 1 : 0.7 });
  await tick();

  const barkLow = merge([trunkGeo, ...roots.bark], 'trunk');
  group.add(staticMesh(barkLow, materials.surface('bark', { mossy: 0.17, scale: 1.6 }), { name: 'oak-trunk' }));
  // ivy: woody stems join the limb bark, the leaf cards are one mesh
  const ivy = buildIvy(rng.fork('ivy'), skeleton.limbs, { density });
  const barkHigh = merge([...skeleton.tubes, ...ivy.stems], 'limbs');
  group.add(staticMesh(barkHigh, materials.surface('bark', { mossy: 0.3, scale: 1.25 }), { name: 'oak-limbs' }));

  // ── moss: the trunk's foot, the shady back, the fork, the root tops ─────
  const mossGeo = merge([buildTrunkMossGeometry({ cols: hi ? 176 : 120 }), ...roots.moss], 'moss');
  const mossMesh = staticMesh(mossGeo, materials.surface('moss'), { cast: false, name: 'oak-moss' });
  mossMesh.visible = !debug.includes('nomoss');
  group.add(mossMesh);

  // ── ivy leaf cards (climbing the bark, running along the low limb, hanging) ─
  group.add(staticMesh(ivy.leaves, materials.foliage({ variant: 'ivy', color: '#3d6b2c' }), { cast: false, name: 'oak-ivy' }));

  // ── hollows: dark linings so they read as deep holes (merged with the details)
  const hollows = buildHollowCavities();
  await tick();

  // ── crown ────────────────────────────────────────────────────────────────
  const crown = buildCrown(ctx, rng.fork('crown'), skeleton.clumps, { density });
  if (!debug.includes('noleaves')) for (const m of crown.meshes) group.add(m);

  // ── the little things: fungi, toadstools, lanterns, fairy lights, swing,
  //    bird house, the owl and the secret mouse door ─────────────────────────
  await tick();
  const details = buildDetails(ctx, rng.fork('details'), group, {
    limbs: skeleton.limbs,
    roots: roots.roots,
    hollows: hollows.mouths,
    hollowLinings: hollows.parts,
    ivyLeaves: ivy.leaves,
  });

  ctx.colliders?.addCircle?.(OAK.x, OAK.z, OAK.baseRadius + 0.3, 'oak');

  ctx.oak = {
    group,
    limbs: skeleton.limbs.map((l) => l.curve),
    limbInfo: skeleton.limbs,
    crownBounds: crown.bounds,
    barkRadius: trunkRadius,
    barkPoint: (a, y, lift = 0) => polar(a, trunkRadius(a, y) + lift, y),
    roots: roots.roots,
    hollows: hollows.mouths,
    /** the carved niche behind the Schreinerei door (world units) */
    doorNiche: DOOR_NICHE,
    forkY: FORK_Y,
    lanterns: details.lanterns,
  };
  group.userData.stats = { leafCards: crown.cards, clumps: skeleton.clumps.length, ivyCards: ivy.cards };
  return { update: details.update };
}
