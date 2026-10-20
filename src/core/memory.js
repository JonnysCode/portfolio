// ─────────────────────────────────────────────────────────────────────────────
// Memory: CPU copies of static geometry.
//
// Every BufferAttribute keeps its typed array after WebGL has a copy — tens of
// MB for the glen's merged meshes (a tab-kill risk on iOS Safari). Once the
// world is built, releaseStaticArrays() frees the arrays nothing reads again,
// right after their upload (attr.onUpload). terrain.js and the vegetation
// (freeAfterUpload) release their own; this covers everything else.
//
// What is kept, because something reads it after the build:
//   • position + index of every mesh — occlusion rays (systems/triGrid.js,
//     interactions.firstSolidHit), polaroid framing (ui/polaroid.js);
//   • every attribute of meshes that Mesh.raycast may test, which interpolates
//     uv and normal at the hit: hotspots (and anything inside them) and the
//     small occluders (≤ GRID_MIN_TRIS triangles: firstSolidHit raycasts those
//     directly; bigger ones go through their triangle grid);
//   • instanced, skinned, morphed meshes, points, lines and sprites (animated,
//     ray-tested or tiny), glow halos (systems/cameraObstacles.js reads them),
//     anything flagged userData.keepCpu / keepRaycast (mesh or geometry);
//   • attributes not marked static (setUsage(DynamicDrawUsage) …): updated later.
// A geometry shared by several meshes is released only if every user allows it.
// ?keepArrays keeps everything (A/B checks).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { GRID_MIN_TRIS } from '../systems/interactions.js';

const dropArray = function () {
  this.array = null;
};

const triCount = (g) => (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;

/**
 * Register the release of every static attribute array (but position and
 * index) the rules above allow, effective on each attribute's next upload.
 * Call once the world (and every hotspot) exists, before the first frame.
 * Returns { geometries, mb } — what will be released.
 */
export function releaseStaticArrays(ctx) {
  if (ctx.engine?.params?.has('keepArrays')) return { geometries: 0, mb: 0 };
  // everything a hotspot can be raycast through (interactions: intersectObject(h.object, true))
  const hotspotRoots = new Set((ctx.interactions?.hotspots ?? []).map((h) => h.object).filter(Boolean));
  const inHotspot = (o) => {
    for (let q = o; q; q = q.parent) if (hotspotRoots.has(q)) return true;
    return false;
  };
  /** geometry → may its arrays go (false once any user needs them) */
  const verdict = new Map();
  ctx.scene.traverse((o) => {
    const g = o.geometry;
    if (!g?.isBufferGeometry) return;
    const ok =
      o.isMesh &&
      !o.isInstancedMesh &&
      !o.isSkinnedMesh &&
      !o.isSprite &&
      !o.morphTargetInfluences &&
      !Object.keys(g.morphAttributes ?? {}).length &&
      !o.userData.keepCpu &&
      !o.userData.keepRaycast &&
      !g.userData.keepCpu &&
      o.material?.name !== 'props-glow-halo' &&
      triCount(g) > GRID_MIN_TRIS &&
      !inHotspot(o);
    verdict.set(g, (verdict.get(g) ?? true) && ok);
  });
  let geometries = 0;
  let bytes = 0;
  for (const [g, ok] of verdict) {
    if (!ok) continue;
    // (bounds first: culling and the occlusion tests use them)
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingBox) g.computeBoundingBox();
    let n = 0;
    for (const [name, a] of Object.entries(g.attributes)) {
      if (name === 'position' || !a.isBufferAttribute || !a.array || a.usage !== THREE.StaticDrawUsage) continue;
      a.onUpload(dropArray);
      bytes += a.array.byteLength;
      n++;
    }
    if (n) geometries++;
  }
  return { geometries, mb: +(bytes / 1048576).toFixed(1) };
}
