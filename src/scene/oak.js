// ─────────────────────────────────────────────────────────────────────────────
// THE GREAT OAK — the hero of the glen.
//
// A colossal, gnarled, slowly twisting oak: buttress roots snaking over the
// moss, a bole of fused, wrung stems (broad lobes and cords spiralling a
// quarter turn as it rises, big burls) that flares like a vase into the fork,
// a door niche at its foot (the Schreinerei door goes there), hollows and
// knots, massive limbs kinked at knobbly elbows (two high ones carry the crown
// past the top of the wide shots), and a huge crown of painterly clusters-of-
// clusters with windows onto the limbs and the sky, sun-kissed tops and cool
// bellies (at night a dark blue-green silhouette with a thin silver moon rim).
// The long low limb is a bare, gnarled arm over the cottage path with a few
// high tufts, lanterns, fairy lights, ivy and beard-moss curtains, glow-worms
// on silk; one buttress root arches over a mossy boulder it grips; bracket
// fungi grow in overlapping tiers of zoned shelves. The bark is finely
// fissured (cavity darkening, cross-checks, moss creeping into the crevices)
// and spirals with the bole; the moss shell hugs the bark and ends in a
// ragged, dithered edge. All procedural (see ./oak/*).
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
//     hollows: [{ id, a, y, floor, position, normal }],         // 'owl' (front-left, y≈9.7), 'den' (back), 'nook' (above the door)
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
import { trunkRadius, polar, DOOR_NICHE, FORK_Y, GRAIN_TWIST } from './oak/shape.js';
import { buildTrunkGeometry, buildTrunkMossGeometry, buildHollowCavities } from './oak/trunk.js';
import { buildRoots } from './oak/roots.js';
import { buildLimbs } from './oak/limbs.js';
import { buildCrown } from './oak/crown.js';
import { buildIvy } from './oak/ivy.js';
import { buildDetails, lanternHangs } from './oak/details.js';

/**
 * Merge geometries that share the oak's attribute layout (position/normal/uv,
 * indexed). `extra` = { name: itemSize } attributes to keep (parts without one
 * get zeros).
 */
function merge(list, name, extra = {}) {
  const keepNames = ['position', 'normal', 'uv', ...Object.keys(extra)];
  const clean = list.map((g) => {
    for (const k of Object.keys(g.attributes)) if (!keepNames.includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const [k, size] of Object.entries(extra)) {
      if (!g.attributes[k]) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * size), size));
    }
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

/** Add `attribute <type> <name>` → `varying <type> v<Name>` plumbing to a patched material clone. */
function withVarying(base, { attr, type, tag, fragment }) {
  const m = base.clone();
  m.name = `${base.name}-${tag}`;
  const prev = m.onBeforeCompile;
  const v = 'v' + attr[0].toUpperCase() + attr.slice(1);
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    shader.vertexShader = `attribute ${type} ${attr};\nvarying ${type} ${v};\n` + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n  ${v} = ${attr};`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying ${type} ${v};`);
    fragment(shader);
  };
  const key = m.customProgramCacheKey();
  m.customProgramCacheKey = () => `${key}|${tag}`;
  return m;
}

/**
 * The trunk & root bark: a finer bark scale (plates and furrows read at hero
 * distance), with the per-vertex `oak` attribute (x moss boost, y cavity,
 * z trunk mask): moss creeps into the crevices where the shell thins out, the
 * flute valleys and furrows darken, and short horizontal cross-checks break
 * the long flutes so the bole reads as ancient fissured bark, not a planed board.
 */
function oakBarkMaterial(materials) {
  return withVarying(materials.surface('bark', { mossy: 0.17, scale: 0.95, roughness: 1.15, color: '#73604a' }), {
    attr: 'oak',
    type: 'vec3',
    tag: 'oak-bark',
    fragment(shader) {
      const before = shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader
        // the bole's bark grain spirals with its cords & furrows (shape.js
        // GRAIN_TWIST): turn the triplanar lookup about the trunk axis by an
        // angle that grows with height — the fissures lean ≈ 25°, the roots
        // (trunk mask 0) keep their own grain
        .replace(
          'vec3 sfTP = sfWPos * sfTile.x;',
          `vec3 sfTP;
  {
    vec2 oRel = sfWPos.xz - vec2(${OAK.x.toFixed(3)}, ${OAK.z.toFixed(3)});
    float oTh = (-${GRAIN_TWIST.toFixed(4)} * max(sfWPos.y, 0.0) + 0.45 * (sfNoise3(vec3(oRel * 0.3, sfWPos.y * 0.07)) - 0.5)) * vOak.z;
    float oC = cos(oTh), oS = sin(oTh);
    vec2 oRot = vec2(oRel.x * oC + oRel.y * oS, oRel.y * oC - oRel.x * oS);
    sfTP = vec3(oRot.x + ${OAK.x.toFixed(3)}, sfWPos.y, oRot.y + ${OAK.z.toFixed(3)}) * sfTile.x;
  }`
        )
        .replace('float thr = 1.15 - sfQ.x * 1.75;', 'float thr = 1.15 - clamp(sfQ.x + vOak.x, 0.0, 0.92) * 1.75;')
        .replace(
          'diffuseColor.rgb *= sfCol;',
          `diffuseColor.rgb *= sfCol;
  {
    // deep flute valleys & furrows: painterly cavity darkening
    diffuseColor.rgb *= 1.0 - 0.32 * vOak.y;
    // cross-checks: short horizontal fissures across the ridges of the bole
    vec2 oq = vec2(atan(sfWPos.x - (${OAK.x.toFixed(3)}), sfWPos.z - (${OAK.z.toFixed(3)})), sfWPos.y);
    float ow = sfNoise3(vec3(oq.x * 2.4, oq.y * 0.45, 3.7));
    float ob = abs(fract(oq.y * 1.15 + ow * 1.3) - 0.5);
    float oseg = smoothstep(0.5, 0.62, sfNoise3(vec3(oq.x * 11.0, oq.y * 2.2, 8.1)));
    float ochk = (1.0 - smoothstep(0.012, 0.045, ob)) * oseg * (1.0 - vOak.y) * vOak.z * (1.0 - smoothstep(14.0, 17.0, oq.y));
    diffuseColor.rgb *= 1.0 - 0.45 * ochk;
  }`
        );
      if (shader.fragmentShader === before) console.warn('oak: bark shader patch did not apply');
    },
  });
}

/** Moss shell with a ragged edge: per-vertex `mossA` + a world-space dithered alpha test. */
function mossShellMaterial(materials) {
  return withVarying(materials.surface('moss'), {
    attr: 'mossA',
    type: 'float',
    tag: 'oak-moss',
    fragment(shader) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `{
    float oakN = sfNoise3(sfWPos * 5.0) * 0.6 + sfNoise3(sfWPos * 17.0 + 3.1) * 0.4;
    if (vMossA < 0.12 + 0.76 * oakN) discard;
  }
#include <emissivemap_fragment>`
      );
    },
  });
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

  // the moss shell is built on the bark grid (its normals), before the merge
  const trunkMossGeo = buildTrunkMossGeometry(trunkGeo);
  for (const g of roots.bark) g.setAttribute('oak', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
  {
    // trunk: (moss, cavity) + trunk mask 1 (the roots keep 0)
    const src = trunkGeo.attributes.oak.array;
    const oak3 = new Float32Array((src.length / 2) * 3);
    for (let i = 0; i < src.length / 2; i++) oak3.set([src[i * 2], src[i * 2 + 1], 1], i * 3);
    trunkGeo.setAttribute('oak', new THREE.BufferAttribute(oak3, 3));
  }
  const barkLow = merge([trunkGeo, ...roots.bark], 'trunk', { oak: 3 });
  group.add(staticMesh(barkLow, oakBarkMaterial(materials), { name: 'oak-trunk' }));
  // ivy: woody stems join the limb bark, the leaf cards are one mesh
  const ivy = buildIvy(rng.fork('ivy'), skeleton.limbs, { density });
  const barkHigh = merge([...skeleton.tubes, ...ivy.stems], 'limbs');
  group.add(staticMesh(barkHigh, materials.surface('bark', { mossy: 0.3, scale: 1.25 }), { name: 'oak-limbs' }));

  // ── moss: the trunk's foot, the shady back, the fork, the root tops ─────
  const mossGeo = merge([trunkMossGeo, ...roots.moss], 'moss', { mossA: 1 });
  const mossMesh = staticMesh(mossGeo, mossShellMaterial(materials), { cast: false, name: 'oak-moss' });
  mossMesh.visible = !debug.includes('nomoss');
  group.add(mossMesh);

  // ── ivy leaf cards (climbing the bark, running along the low limb, hanging) ─
  group.add(staticMesh(ivy.leaves, materials.foliage({ variant: 'ivy', color: '#3d6b2c' }), { cast: false, name: 'oak-ivy' }));
  // ── pale beard moss hanging in tufts from the limbs ───────────────────────
  if (ivy.beard) group.add(staticMesh(ivy.beard, materials.foliage({ variant: 'grass', color: '#a9b78e', volume: false, wrap: 0.8, translucency: 1 }), { cast: false, name: 'oak-beard-moss' }));

  // ── hollows: dark linings so they read as deep holes (merged with the details)
  const hollows = buildHollowCavities();
  await tick();

  // ── crown ────────────────────────────────────────────────────────────────
  // (the crown's bellies catch a warm bounce from the lanterns at night)
  const bounce = lanternHangs(skeleton.limbs).map(({ glass }) => [glass.x, glass.y + 1.2, glass.z, 3.6, 0.7]);
  const crown = buildCrown(ctx, rng.fork('crown'), skeleton.clumps, { density, limbs: skeleton.limbs, branches: skeleton.branches, bounce });
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
  group.userData.stats = { leafCards: crown.cards, clumps: skeleton.clumps.length, crownGaps: crown.gaps, gapFraction: +crown.gapFraction.toFixed(2), ivyCards: ivy.cards, beardCards: ivy.beardCards };
  return { update: details.update };
}
