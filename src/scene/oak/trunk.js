// ─────────────────────────────────────────────────────────────────────────────
// The Great Oak's trunk: a sculpted surface of revolution r = trunkRadius(a, y)
// (see shape.js) from below the ground up to the dome that closes inside the
// fork, plus a moss shell that creeps over its foot, its shady back and the
// fork, and dark cavities that make the hollows read as deep holes.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { TAU, TRUNK_TOP, FORK_Y, polar, trunkRadius, trunkMoss, baseRadius, HOLLOWS, DEG } from './shape.js';
import { smoothstep, clamp } from '../../core/rng.js';
import { weldSeamNormals } from './tubes.js';

/**
 * Row heights: dense near the ground (door niche, flare), coarser up the trunk.
 * `rowK` stretches the spacing on the lower quality tiers (the door arch
 * itself — up to y ≈ 2.6 — keeps rows at most 0.13 apart).
 */
function trunkRows(rowK = 1) {
  const ys = [];
  let y = -0.9;
  while (y < TRUNK_TOP - 0.08) {
    ys.push(y);
    const dy = y < 5.3 ? 0.1 : y < FORK_Y - 1 ? 0.19 : 0.13; // fine up to the nook above the door
    y += y < 2.6 ? Math.min(dy * rowK, 0.13) : dy * rowK;
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

/**
 * The bark surface of the trunk. Carries a per-vertex `oak` attribute
 * (x: moss boost for the bark shader — moss creeping into the crevices where
 * the moss shell thins out, y: cavity — how deep the vertex lies in a furrow
 * or flute, for the painterly crevice darkening) and `userData.grid`
 * ({ ys, cols, moss, cav }) for the moss shell.
 */
export function buildTrunkGeometry({ cols = 176, rowK = 1 } = {}) {
  const ys = trunkRows(rowK);
  const rows = ys.length;
  const c1 = cols + 1;
  const rad = new Float32Array(rows * c1);
  const g = revolveGrid(ys, cols, (a, y, i, j) => {
    const r = i === rows - 1 ? 0 : trunkRadius(a, y);
    rad[i * c1 + j] = r;
    return r;
  });
  // cavity: how far the bark lies below its local average (separable box blur
  // over ±3 columns and ±2 rows) — furrows and the valleys between the flutes
  const tmp = new Float32Array(rows * c1);
  const blur = new Float32Array(rows * c1);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let sum = 0;
      for (let d = -3; d <= 3; d++) sum += rad[i * c1 + ((j + d + cols) % cols)];
      tmp[i * c1 + j] = sum / 7;
    }
    tmp[i * c1 + cols] = tmp[i * c1];
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j <= cols; j++) {
      let sum = 0, n = 0;
      for (let d = -2; d <= 2; d++) {
        const ii = i + d;
        if (ii < 0 || ii >= rows - 1) continue;
        sum += tmp[ii * c1 + j];
        n++;
      }
      blur[i * c1 + j] = n ? sum / n : rad[i * c1 + j];
    }
  }
  const moss = new Float32Array(rows * c1);
  const cav = new Float32Array(rows * c1);
  const oak = new Float32Array(rows * c1 * 2);
  for (let i = 0; i < rows; i++) {
    const y = ys[i];
    for (let j = 0; j <= cols; j++) {
      const k = i * c1 + j;
      const a = ((j % cols) / cols) * TAU;
      const m = i === rows - 1 ? -1 : trunkMoss(a, y);
      moss[k] = m;
      const c = i === rows - 1 ? 0 : smoothstep(0.0, 0.16, blur[k] - rad[k]);
      cav[k] = c;
      // the bark shader's moss creeps a little beyond the shell (into the
      // crevices first: its moss field already favours the texture's valleys)
      // and paints the low, shady bark a little mossier everywhere
      const shade = (0.5 - 0.5 * Math.cos(a)) * (1 - smoothstep(1.5, 6.5, y)); // back & low
      oak[k * 2] = clamp(smoothstep(-0.35, 0.25, m) * 0.5 + c * 0.12 + shade * 0.12, 0, 0.62);
      oak[k * 2 + 1] = c;
    }
  }
  g.setAttribute('oak', new THREE.BufferAttribute(oak, 2));
  g.userData.grid = { ys, cols, moss, cav };
  return g;
}

/**
 * Moss shell over the trunk's foot, its shady back and the fork, built on the
 * bark grid itself (call before the bark geometry is merged): every vertex is
 * the bark vertex pushed out along the BARK's own normal by a thin, clamped
 * amount (thicker only where it fills a furrow), so the moss hugs the flutes
 * instead of bridging them as flat plates. A one-quad apron around the mossy
 * quads is forced back under the bark, so the shell always dips under before
 * it ends; the visible edge is a ragged, per-vertex alpha (`mossA`, dithered
 * alpha test in the moss material — see mossShellMaterial in oak.js).
 */
export function buildTrunkMossGeometry(trunkGeo) {
  const { ys, cols, moss, cav } = trunkGeo.userData.grid;
  const c1 = cols + 1;
  const rows = ys.length;
  const P = trunkGeo.attributes.position.array;
  const N = trunkGeo.attributes.normal.array;
  const inBand = (y) => y > -0.4 && (y < 9.5 || (y > FORK_Y - 1.2 && y < TRUNK_TOP - 0.5));
  const LIVE = 0.02; // a quad with a vertex above this carries visible moss
  const quadLive = (i, j) => {
    const k = i * c1 + j;
    return moss[k] > LIVE || moss[k + 1] > LIVE || moss[k + c1] > LIVE || moss[k + c1 + 1] > LIVE;
  };
  const qRows = rows - 1;
  const keep = new Uint8Array(qRows * cols); // 1 = mossy quad, 2 = apron
  for (let i = 0; i < qRows; i++) {
    if (!inBand(ys[i]) || !inBand(ys[i + 1])) continue;
    for (let j = 0; j < cols; j++) if (quadLive(i, j)) keep[i * cols + j] = 1;
  }
  for (let i = 0; i < qRows; i++) {
    if (!inBand(ys[i]) || !inBand(ys[i + 1])) continue;
    for (let j = 0; j < cols; j++) {
      if (keep[i * cols + j]) continue;
      let near = false;
      for (let di = -1; di <= 1 && !near; di++) {
        const ii = i + di;
        if (ii < 0 || ii >= qRows) continue;
        for (let dj = -1; dj <= 1; dj++) if (keep[ii * cols + ((j + dj + cols) % cols)] === 1) near = true;
      }
      if (near) keep[i * cols + j] = 2;
    }
  }
  // effective moss per vertex: every vertex of an apron quad is pushed under
  const mEff = Float32Array.from(moss);
  for (let i = 0; i < qRows; i++) {
    for (let j = 0; j < cols; j++) {
      if (keep[i * cols + j] !== 2) continue;
      const k = i * c1 + j;
      for (const q of [k, k + 1, k + c1, k + c1 + 1]) mEff[q] = Math.min(mEff[q], -0.3);
    }
  }
  // the seam column duplicates column 0
  for (let i = 0; i < rows; i++) mEff[i * c1 + cols] = mEff[i * c1] = Math.min(mEff[i * c1], mEff[i * c1 + cols]);
  const pos = new Float32Array(rows * c1 * 3);
  const alpha = new Float32Array(rows * c1);
  for (let k = 0; k < rows * c1; k++) {
    const m = mEff[k];
    // thin velvet (≤ ~0.08) that only swells where it fills a furrow; below
    // zero it sinks under the bark
    let off;
    if (m > 0) off = Math.min(0.012 + 0.07 * smoothstep(0, 0.7, m), 0.03 + cav[k] * 0.09);
    else off = Math.max(m, -0.6) * 0.14;
    pos[k * 3] = P[k * 3] + N[k * 3] * off;
    pos[k * 3 + 1] = P[k * 3 + 1] + N[k * 3 + 1] * off;
    pos[k * 3 + 2] = P[k * 3 + 2] + N[k * 3 + 2] * off;
    alpha[k] = smoothstep(0.0, 0.32, m);
  }
  const index = [];
  for (let i = 0; i < qRows; i++) {
    for (let j = 0; j < cols; j++) {
      if (!keep[i * cols + j]) continue;
      const a = i * c1 + j, b = (i + 1) * c1 + j;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // the moss lies on the bark: shade it with the bark's normals
  g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(N), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(trunkGeo.attributes.uv.array), 2));
  g.setAttribute('mossA', new THREE.BufferAttribute(alpha, 1));
  g.setIndex(index);
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
 * Dark linings for the hollows so they read as deep holes even in full sun:
 * a small grid laid just in front of the carved cup (and tucked under the
 * bark outside it). Returns the geometries and the hollow mouths (for the
 * owl & co): [{ id, a, y, floor, position, normal }].
 */
export function buildHollowCavities() {
  const parts = [];
  const mouths = [];
  for (const h of HOLLOWS) {
    const a0 = h.a * DEG;
    const R0 = baseRadius(h.y);
    const da = (h.rx * 1.08) / R0;
    const ys = [];
    const n = 22;
    for (let i = 0; i <= n; i++) ys.push(h.y - h.ry * 1.08 + (i / n) * h.ry * 2.16);
    const cols = 22;
    const pos = new Float32Array((n + 1) * (cols + 1) * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= cols; j++) {
        const a = a0 - da + (j / cols) * da * 2;
        const y = ys[i];
        const q = Math.hypot(((a - a0) * R0) / h.rx, (y - h.y) / h.ry);
        // inside the mouth just in front of the carved cup; outside it sinks well
        // under the (coarser) bark mesh so no corner of the patch shows
        const r = trunkRadius(a, y) + (q < 0.93 ? 0.03 : -0.4);
        polar(a, r, y, v);
        pos.set([v.x, v.y, v.z], (i * (cols + 1) + j) * 3);
      }
    }
    const index = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < cols; j++) {
        const p = i * (cols + 1) + j, q = (i + 1) * (cols + 1) + j;
        index.push(p, p + 1, q, p + 1, q + 1, q);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    parts.push(g);
    mouths.push({
      id: h.id,
      a: a0,
      y: h.y,
      // floor of the hollow (where a creature can sit)
      floor: polar(a0, R0 - h.depth * 0.45, h.y - h.ry * 0.7),
      position: polar(a0, R0, h.y),
      normal: new THREE.Vector3(Math.sin(a0), 0, Math.cos(a0)),
    });
  }
  return { parts, mouths };
}
