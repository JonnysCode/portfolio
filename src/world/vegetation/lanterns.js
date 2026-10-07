// ─────────────────────────────────────────────────────────────────────────────
// Warm lanterns hanging from the giants (refs: the fly-agaric house between
// the roots, the elven tree house): a few old iron lanterns on ropes, tied to
// the broken limbs of the bare columns around the glen. By day they are dark
// little silhouettes up in the trees; at night they glow amber among the
// glow-worms' cool stars.
//
// All lanterns merge into three draws (iron & rope, glass, halos); the one or
// two nearest the glen's heart also get a budgeted point light.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { GeoBuilder, staticMesh } from './common.js';
import { tube } from './groundcover.js';
import { blocksView, inShot, inNearField } from './zones.js';
import { glowQuads } from '../../props/glow.js';

const IRON = new THREE.Color('#2e2a26');
const ROPE = new THREE.Color('#6a5640');

/**
 * trees: the forest plan's trees (after buildTree: t.stubs = [{ tip, dir, r }]).
 * Returns { meshes, lanterns: [Vector3] (glass centres), lights }.
 */
export function canopyLanterns(ctx, rng, trees, { max = 8, scale = 1.6, lights = 2 } = {}) {
  const M = ctx.materials;
  const iron = new GeoBuilder();
  const glass = new GeoBuilder();
  const halos = [];
  const lanterns = [];
  const k = scale;
  const cand = trees
    .filter((t) => t.kind !== 'birch' && t.stubs?.length && Math.hypot(t.x, t.z) < 31)
    .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const part = (geo, x, y, z, B, color, sx = 1, sy = 1, sz = 1, ry = 0) => {
    q.setFromEuler(new THREE.Euler(0, ry, 0));
    m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
    B.addGeometry(geo, m4, color);
    geo.dispose();
  };
  for (const t of cand) {
    if (lanterns.length >= max) break;
    // the lowest stub that a composed shot sees, clear of every view and lens
    const stubs = t.stubs.filter((s) => s.tip.y > 7 && s.tip.y < 26).sort((a, b) => a.tip.y - b.tip.y);
    for (const s of stubs) {
      const rope = rng.range(0.5, 1.5) * k;
      const top = s.tip.clone();
      top.y -= s.r * 0.8;
      const c = new THREE.Vector3(top.x, top.y - rope - 0.3 * k, top.z);
      if (!inShot(c.x, c.y, c.z, 0.4) || blocksView(c.x, c.y, c.z, 0.6 * k)) continue;
      if (inNearField(c.x, c.y, c.z, 0.55, 0.8)) continue;
      if (lanterns.some((l) => l.distanceTo(c) < 6)) continue;
      // the rope (a little sag towards the stub)
      tube(iron, [top, top.clone().lerp(c, 0.5).add(new THREE.Vector3(0.03, 0, 0.03)), new THREE.Vector3(c.x, c.y + 0.32 * k, c.z)], [0.025 * k, 0.022 * k, 0.02 * k], 4, { color: () => ROPE });
      const ry = rng.range(0, Math.PI);
      // iron: a ring, a pointed roof with a little finial, posts, a base with a drip
      part(new THREE.TorusGeometry(0.05, 0.012, 4, 8), c.x, c.y + 0.31 * k, c.z, iron, IRON, k, k, k, ry);
      part(new THREE.ConeGeometry(0.2, 0.17, 6, 1), c.x, c.y + 0.2 * k, c.z, iron, IRON, k, k, k, ry);
      part(new THREE.CylinderGeometry(0.21, 0.21, 0.025, 6, 1), c.x, c.y + 0.12 * k, c.z, iron, IRON, k, k, k, ry);
      part(new THREE.CylinderGeometry(0.17, 0.13, 0.05, 6, 1), c.x, c.y - 0.13 * k, c.z, iron, IRON, k, k, k, ry);
      part(new THREE.ConeGeometry(0.05, 0.08, 6, 1).rotateX(Math.PI), c.x, c.y - 0.19 * k, c.z, iron, IRON, k, k, k, ry);
      for (let i = 0; i < 6; i += 2) {
        const a = ry + (i / 6) * Math.PI * 2 + Math.PI / 6;
        part(new THREE.BoxGeometry(0.022, 0.24, 0.022), c.x + Math.sin(a) * 0.165 * k, c.y, c.z + Math.cos(a) * 0.165 * k, iron, IRON, k, k, k, a);
      }
      // the glass: a warm hexagonal glow
      part(new THREE.CylinderGeometry(0.15, 0.13, 0.24, 6, 1), c.x, c.y, c.z, glass, null, k, k, k, ry);
      halos.push({ x: c.x, y: c.y, z: c.z, size: 0.55 * k });
      lanterns.push(c);
      break;
    }
  }
  const meshes = [];
  if (iron.count) meshes.push(staticMesh('canopy-lanterns-iron', iron.build(), M.standard('#ffffff', { roughness: 0.62, vertexColors: true }), { cast: false }));
  if (glass.count) meshes.push(staticMesh('canopy-lanterns-glass', glass.build(), M.glow('#ffc477', { day: 0.2, night: 2.2 }), { cast: false }));
  if (halos.length) meshes.push(glowQuads(halos, '#ffcf87', { day: 0.0, night: 0.85 }));
  // warm light spilling onto the bark (as the budget allows — nearest the glen first)
  const pl = [];
  for (const c of lanterns.slice(0, lights)) {
    const l = ctx.lights?.addPoint?.(c.clone().add(new THREE.Vector3(0, -0.2, 0)), { color: '#ffb866', day: 0, night: 3.2, distance: 8, decay: 2 });
    if (l) pl.push(l);
  }
  for (const m of meshes) m.raycast = () => {};
  return { meshes, lanterns, lights: pl };
}
