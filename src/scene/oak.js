// ─────────────────────────────────────────────────────────────────────────────
// THE GREAT OAK — the hero of the glen.
//
// A colossal, gnarled, slowly twisting oak: buttress roots snaking over the
// moss, a bole of fused, wrung stems — broad lobes and irregular sinews that
// spiral ≈ 17°, crowd and spread, fork and merge, and part around the burls
// like wood grain round a knot — that flares like a vase into the fork, a
// door niche at its foot (the Schreinerei door goes there), hollows, burls and
// knots, massive limbs kinked at knobbly elbows (two high ones carry the crown
// past the top of the wide shots), and a crown of tiered cloud masses — one
// per limb, golden on top, cool blue-green beneath, with dark gaps between
// them where the limbs and the lanterns hang (at night a deep blue-green with
// a silver moon rim and warm bounce from the lamps below).
// The long low limb reaches over the cottage path UNDER its raised skirt, with
// a festoon of lanterns, fairy lights, ivy, thin grey-sage beard moss and
// glow-worms on near-invisible silk; one buttress root arches over a mossy
// boulder it grips; bracket fungi grow in overlapping tiers of zoned shelves.
// The bole's bark texture follows the sculpted grain (per vertex), with
// cavity darkening, blocky cross-checks and moss creeping into the crevices;
// the limbs' and branches' bark is UV-mapped so its fissures run ALONG every
// limb. The moss shell hugs the bark and ends in a ragged, dithered edge.
// Three detail tiers (OAK_LOD, OAK_BUDGET). All procedural (see ./oak/*).
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
import { trunkRadius, polar, DOOR_NICHE, FORK_Y } from './oak/shape.js';
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
 * The bark map's furrows are near black and its plates a warm tan: on the
 * oak's huge, regular fissures that read as tiger stripes from the glen. Both
 * oak bark materials compress the map's value range (furrows lifted, plates
 * tamed, the mean kept) before it tints the surface.
 */
const SOFT_BARK = `sfCol = pow(max(sfCol, vec3(1e-4)), vec3(0.8)) * 0.66;`;

/** Limb & branch bark: UV-mapped (oak.js build) with the softened value range. */
function oakLimbMaterial(materials) {
  const base = materials.surface('bark', { mossy: 0.3, scale: 1, triplanar: false });
  const m = base.clone();
  m.name = `${base.name}-oak-limbs`;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    const before = shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('diffuseColor.rgb *= sfCol;', `${SOFT_BARK}\n  diffuseColor.rgb *= sfCol;`);
    if (shader.fragmentShader === before) console.warn('oak: limb bark patch did not apply');
  };
  const key = m.customProgramCacheKey();
  m.customProgramCacheKey = () => `${key}|oak-limbs`;
  return m;
}

/**
 * The trunk & root bark, with the per-vertex `oak` attribute (x moss boost,
 * y cavity, z trunk mask, w grain angle): the bole's bark texture follows its
 * sculpted grain (shape.js grainWarp) — the lookup, position AND normal, is
 * turned about the trunk axis by the grain angle, a local rigid turn, so the
 * fissures lean with the sinews (≈ 17°), crowd and spread with them and part
 * around the burls and hollows, with no stretched projection; moss creeps
 * into the crevices where the shell thins out, the sinew valleys and furrows
 * darken, and staggered horizontal checks (each with a lit lip above it)
 * break the ridges into blocky oak plates. The roots (mask 0, angle 0) keep
 * their own grain.
 */
function oakBarkMaterial(materials) {
  const OX = OAK.x.toFixed(3), OZ = OAK.z.toFixed(3);
  return withVarying(materials.surface('bark', { mossy: 0.17, scale: 1.25, roughness: 1.15, color: '#73604a' }), {
    attr: 'oak',
    type: 'vec4',
    tag: 'oak-bark',
    fragment(shader) {
      const before = shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'vec3 sfTP = sfWPos * sfTile.x;',
          `vec3 sfTP;
  float oakC = cos(vOak.w), oakS = sin(vOak.w);
  {
    vec2 oRel = sfWPos.xz - vec2(${OX}, ${OZ});
    vec2 oRot = vec2(oRel.x * oakC + oRel.y * oakS, oRel.y * oakC - oRel.x * oakS);
    sfTP = vec3(oRot.x + ${OX}, sfWPos.y, oRot.y + ${OZ}) * sfTile.x;
  }`
        )
        .replace(
          'sfTriplanar(sfMap, sfDetail, sfTP, sfGN, sfP.x, sfTile.y, sfA, sfD, sfN);',
          `sfTriplanar(sfMap, sfDetail, sfTP, vec3(sfGN.x * oakC + sfGN.z * oakS, sfGN.y, sfGN.z * oakC - sfGN.x * oakS), sfP.x, sfTile.y, sfA, sfD, sfN);
  sfN = vec3(sfN.x * oakC - sfN.z * oakS, sfN.y, sfN.z * oakC + sfN.x * oakS);`
        )
        .replace('float thr = 1.15 - sfQ.x * 1.75;', 'float thr = 1.15 - clamp(sfQ.x + vOak.x, 0.0, 0.92) * 1.75;')
        .replace(
          'diffuseColor.rgb *= sfCol;',
          `${SOFT_BARK}
  diffuseColor.rgb *= sfCol;
  {
    // deep sinew valleys & furrows: painterly cavity darkening
    diffuseColor.rgb *= 1.0 - 0.36 * vOak.y;
    // checks: short horizontal fissures across the ridges of the bole, a row
    // every ≈ 0.6 (wavy, staggered, broken into short runs), each with the
    // plate's lit lower lip just above it — blocky oak plates, not long pipes
    vec2 oD = sfWPos.xz - vec2(${OX}, ${OZ});
    float oGa = atan(oD.x, oD.y) + vOak.w;
    vec2 oCs = vec2(cos(oGa), sin(oGa));
    float ow = sfNoise3(vec3(oCs * 1.7, sfWPos.y * 0.4 + 3.7));
    float ofr = fract(sfWPos.y * 1.75 + ow * 1.5);
    float ob = abs(ofr - 0.5);
    float oseg = smoothstep(0.44, 0.58, sfNoise3(vec3(oCs * 7.5, sfWPos.y * 2.0 + 8.1)));
    float oFade = oseg * (1.0 - vOak.y) * vOak.z * (1.0 - smoothstep(14.0, 17.0, sfWPos.y)) * smoothstep(0.3, 1.2, sfWPos.y);
    float ochk = (1.0 - smoothstep(0.022, 0.075, ob)) * oFade;
    float olip = smoothstep(0.52, 0.56, ofr) * (1.0 - smoothstep(0.6, 0.72, ofr)) * oFade;
    diffuseColor.rgb *= (1.0 - 0.55 * ochk) * (1.0 + 0.18 * olip);
  }`
        );
      if ((shader.fragmentShader.match(/oakC/g) ?? []).length < 4 || !shader.fragmentShader.includes('olip') || shader.fragmentShader === before) console.warn('oak: bark shader patch did not apply');
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

/**
 * Per-tier detail. high: the hero; medium (phones): ≈ ⅔ of the vertices
 * around and along every tube; low: half — no ivy stems or beard moss, the
 * details merged into fewer materials (details.js). The crown's card budget
 * follows ctx.quality.density (crown.js).
 */
const OAK_LOD = {
  high: { cols: 176, rowK: 1, rootRadialK: 1, segK: 1, limbDetail: 1, ivyStems: true, beard: true },
  medium: { cols: 120, rowK: 1.3, rootRadialK: 0.75, segK: 1.3, limbDetail: 0.68, ivyStems: true, beard: true },
  low: { cols: 84, rowK: 1.6, rootRadialK: 0.55, segK: 1.7, limbDetail: 0.46, ivyStems: false, beard: false },
};
/**
 * Triangle budget per tier (moduleStats: budget / overBudget), measured with
 * every oak mesh (bark, moss, crown, ivy, details, lanterns, fairy lights).
 */
export const OAK_BUDGET = { high: 340000, medium: 200000, low: 150000 };

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
  const tier = ctx.quality?.tier ?? (density >= 0.9 ? 'high' : density >= 0.45 ? 'medium' : 'low');
  const lod = OAK_LOD[tier] ?? OAK_LOD.high;
  const rng = ctx.rng('great-oak');
  const debug = ctx.engine?.params?.get('oak') ?? ''; // ?oak=nomoss,noleaves
  // yield between heavy steps so the loader can paint
  const tick = () => new Promise((r) => setTimeout(r, 0));

  const group = new THREE.Group();
  group.name = 'great-oak';
  ctx.scene.add(group);

  // ── bark: trunk + roots (mossy), limbs + branches ────────────────────────
  const trunkGeo = buildTrunkGeometry({ cols: lod.cols, rowK: lod.rowK });
  const roots = buildRoots({ radialK: lod.rootRadialK, segK: lod.segK });
  await tick();
  const skeleton = buildLimbs(rng.fork('limbs'), { detail: lod.limbDetail, segK: lod.segK });
  await tick();

  // the moss shell is built on the bark grid (its normals), before the merge
  const trunkMossGeo = buildTrunkMossGeometry(trunkGeo);
  for (const g of roots.bark) g.setAttribute('oak', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 4), 4));
  {
    // trunk: (moss, cavity) + trunk mask 1 (the roots keep 0) + grain angle
    const src = trunkGeo.attributes.oak.array;
    const n = src.length / 3;
    const oak4 = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) oak4.set([src[i * 3], src[i * 3 + 1], 1, src[i * 3 + 2]], i * 4);
    trunkGeo.setAttribute('oak', new THREE.BufferAttribute(oak4, 4));
  }
  const barkLow = merge([trunkGeo, ...roots.bark], 'trunk', { oak: 4 });
  group.add(staticMesh(barkLow, oakBarkMaterial(materials), { name: 'oak-trunk' }));
  // ivy: woody stems join the limb bark, the leaf cards are one mesh
  const ivy = buildIvy(rng.fork('ivy'), skeleton.limbs, { density, stems: lod.ivyStems, beard: lod.beard });
  const barkHigh = merge([...skeleton.tubes, ...ivy.stems], 'limbs');
  // UV-mapped along the tubes (u around, v along — tubes.js): the fissures
  // run ALONG every limb and branch. (World-space triplanar bark projected
  // the bole's vertical furrows across the near-horizontal limbs as dark
  // helical rings — the zebra / barber-pole bands.) uvScale ≈ 0.55–0.7 in
  // limbs.js → fissures ≈ 0.2 apart; the moss still creeps over the tops.
  group.add(staticMesh(barkHigh, oakLimbMaterial(materials), { name: 'oak-limbs' }));

  // ── moss: the trunk's foot, the shady back, the fork, the root tops ─────
  const mossGeo = merge([trunkMossGeo, ...roots.moss], 'moss', { mossA: 1 });
  const mossMesh = staticMesh(mossGeo, mossShellMaterial(materials), { cast: false, name: 'oak-moss' });
  mossMesh.visible = !debug.includes('nomoss');
  group.add(mossMesh);

  // ── ivy leaf cards (climbing the bark, running along the low limb, hanging) ─
  group.add(staticMesh(ivy.leaves, materials.foliage({ variant: 'ivy', color: '#3d6b2c' }), { cast: false, name: 'oak-ivy' }));
  // ── grey-sage beard moss hanging in thin tufts from the limbs ─────────────
  // (muted & only half translucent: a soft lichen grey, never white icicles)
  if (ivy.beard) group.add(staticMesh(ivy.beard, materials.foliage({ variant: 'grass', color: '#9aa585', volume: false, wrap: 0.8, translucency: 0.5 }), { cast: false, name: 'oak-beard-moss' }));

  // ── hollows: dark linings so they read as deep holes (merged with the details)
  const hollows = buildHollowCavities();
  await tick();

  // ── crown ────────────────────────────────────────────────────────────────
  // (the crown's bellies catch a warm bounce from the lanterns at night)
  // (three of the low limb's lanterns, spread along it: the shader has six slots)
  const bounce = lanternHangs(skeleton.limbs)
    .filter((h) => h.id === 'front-left-low' && h.light === true)
    .concat(lanternHangs(skeleton.limbs).filter((h) => h.id === 'front-left-low' && Math.abs(h.u - 0.86) < 0.01))
    .map(({ glass }) => [glass.x, glass.y + 1.4, glass.z, 4.2, 0.75]);
  const crown = buildCrown(ctx, rng.fork('crown'), skeleton.clumps, { density, limbs: skeleton.limbs, branches: skeleton.branches, bounce });
  if (!debug.includes('noleaves')) for (const m of crown.meshes) group.add(m);

  // ── the little things: fungi, toadstools, lanterns, fairy lights, swing,
  //    bird house, the owl and the secret mouse door ─────────────────────────
  await tick();
  const details = buildDetails(ctx, rng.fork('details'), group, {
    limbs: skeleton.limbs,
    branches: skeleton.branches,
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
  group.userData.stats = { leafCards: crown.cards, curtainCards: crown.curtains, clumps: skeleton.clumps.length, crownGaps: crown.gaps, gapFraction: +crown.gapFraction.toFixed(2), ivyCards: ivy.cards, beardCards: ivy.beardCards };
  return { update: details.update, budget: OAK_BUDGET };
}
