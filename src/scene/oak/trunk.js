// ─────────────────────────────────────────────────────────────────────────────
// The Great Oak's trunk: a sculpted surface of revolution r = trunkRadius(a, y)
// (see shape.js) from below the ground up to the dome that closes inside the
// fork, plus a moss shell that creeps over its foot, its shady back and the
// fork, and dark cavities that make the hollows read as deep holes.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { TAU, TRUNK_TOP, FORK_Y, polar, trunkRadius, trunkMoss, baseRadius, HOLLOWS, DEG } from './shape.js';
import { weldSeamNormals } from './tubes.js';

/** Row heights: dense near the ground (door niche, flare), coarser up the trunk. */
function trunkRows() {
  const ys = [];
  let y = -0.9;
  while (y < TRUNK_TOP - 0.08) {
    ys.push(y);
    y += y < 4.8 ? 0.1 : y < FORK_Y - 1 ? 0.19 : 0.13;
  }
  ys.push(TRUNK_TOP);
  return ys;
}

/**
 * Grid surface over (a, y). radiusFn(a, y) → radius; keep(i, j) optional
 * triangle filter on the lower-left vertex. Returns an indexed geometry with
 * position / normal / uv and a welded seam.
 */
function revolveGrid(ys, cols, radiusFn, { keepTri = null, uvScale = [11, 0.42] } = {}) {
  const rows = ys.length;
  const c1 = cols + 1;
  const pos = new Float32Array(rows * c1 * 3);
  const uv = new Float32Array(rows * c1 * 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < rows; i++) {
    const y = ys[i];
    for (let j = 0; j <= cols; j++) {
      const a = ((j % cols) / cols) * TAU;
      const r = radiusFn(a, y, i, j);
      polar(a, Math.max(r, 0), y, v);
      const k = i * c1 + j;
      pos[k * 3] = v.x;
      pos[k * 3 + 1] = v.y;
      pos[k * 3 + 2] = v.z;
      uv[k * 2] = (j / cols) * uvScale[0];
      uv[k * 2 + 1] = y * uvScale[1];
    }
  }
  const index = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols; j++) {
      if (keepTri && !keepTri(i, j)) continue;
      const a = i * c1 + j, b = (i + 1) * c1 + j;
      // outward winding (a grows towards +X from +Z = clockwise seen from above)
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  weldSeamNormals(g, rows, c1);
  return g;
}

/** The bark surface of the trunk. */
export function buildTrunkGeometry({ cols = 176 } = {}) {
  const ys = trunkRows();
  return revolveGrid(ys, cols, (a, y, i) => (i === ys.length - 1 ? 0 : trunkRadius(a, y)));
}

/**
 * Moss shell: the same surface pushed out where trunkMoss() > 0. Where there
 * is no moss the shell dips under the bark, so its edge is the (irregular)
 * line where it pierces the bark — no z-fighting, no hard rim.
 */
export function buildTrunkMossGeometry({ cols = 176 } = {}) {
  const ys = trunkRows().filter((y) => y > -0.4 && (y < 9.5 || (y > FORK_Y - 1.2 && y < TRUNK_TOP - 0.5)));
  const c1 = cols + 1;
  const moss = new Float32Array(ys.length * c1);
  const g = revolveGrid(
    ys,
    cols,
    (a, y, i, j) => {
      const m = trunkMoss(a, y);
      moss[i * c1 + j] = m;
      const r = trunkRadius(a, y);
      // continuous thickness: the shell crosses the bark along a smooth, ragged line
      return r + Math.max(m, -0.5) * 0.17;
    },
    {
      keepTri: (i, j) => {
        // skip quads that are completely under the bark; also never bridge the gap between the two bands
        if (ys[i + 1] - ys[i] > 1) return false;
        const k = i * c1 + j;
        return moss[k] > -0.05 || moss[k + 1] > -0.05 || moss[k + c1] > -0.05 || moss[k + c1 + 1] > -0.05;
      },
      uvScale: [16, 0.7],
    }
  );
  return compact(g);
}

/** Drop unreferenced vertices (after filtering triangles). */
export function compact(g) {
  const idx = g.index.array;
  const map = new Int32Array(g.attributes.position.count).fill(-1);
  let n = 0;
  for (let i = 0; i < idx.length; i++) if (map[idx[i]] < 0) map[idx[i]] = n++;
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) {
    const src = g.attributes[name];
    const isz = src.itemSize;
    const arr = new Float32Array(n * isz);
    for (let v = 0; v < map.length; v++) {
      const m = map[v];
      if (m < 0) continue;
      for (let c = 0; c < isz; c++) arr[m * isz + c] = src.array[v * isz + c];
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, isz));
  }
  const ni = new (n > 65535 ? Uint32Array : Uint16Array)(idx.length);
  for (let i = 0; i < idx.length; i++) ni[i] = map[idx[i]];
  out.setIndex(new THREE.BufferAttribute(ni, 1));
  g.dispose();
  return out;
}

/**
 * Dark cavities sitting inside the hollows so they read as deep holes even in
 * full sun. Returns one merged geometry (position/normal/uv) and the hollow
 * mouths (for the owl & co): [{ id, position, normal, a, y }].
 */
export function buildHollowCavities() {
  const parts = [];
  const mouths = [];
  for (const h of HOLLOWS) {
    const a = h.a * DEG;
    const R0 = baseRadius(h.y);
    const g = new THREE.SphereGeometry(1, 16, 12);
    // stretch to the hollow's mouth and sink it into the trunk
    g.scale(h.rx * 0.95, h.ry * 0.95, h.depth * 0.8);
    const m = new THREE.Matrix4().makeRotationY(a);
    const c = polar(a, R0 - h.depth * 0.78, h.y);
    m.setPosition(c);
    g.applyMatrix4(m);
    parts.push(g);
    mouths.push({
      id: h.id,
      a,
      y: h.y,
      // floor of the hollow (where a creature can sit)
      floor: polar(a, R0 - h.depth * 0.55, h.y - h.ry * 0.62),
      position: polar(a, R0, h.y),
      normal: new THREE.Vector3(Math.sin(a), 0, Math.cos(a)),
    });
  }
  return { parts, mouths };
}
