// ─────────────────────────────────────────────────────────────────────────────
// Static chunk batcher. Instead of one InstancedMesh per species (dozens of
// draw calls, no culling), every plant is stamped into a merged world-space
// geometry per (layer, chunk). A chunk is one draw call no matter how many
// species it holds, and chunks are frustum-culled (and shadow-culled)
// individually. Per-vertex attributes are packed tightly:
//   position Float32×3 · normal Int8×3 · color Uint8×3 · aSway Uint8×2
// aSway = (bend weight / SWAY_MAX, phase) feeds the wind in foliageMaterial.js.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

/** World units represented by aSway.x = 1. */
export const SWAY_MAX = 0.6;

const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);

export function createBatcher() {
  /** key → { layer, key, items[] } */
  const chunks = new Map();
  let instances = 0;
  /** kind → { n, tris } (debug breakdown) */
  const breakdown = {};

  const api = {
    get instances() {
      return instances;
    },
    breakdown,
    /**
     * Stamp `template` at world (x, y, z).
     * o: { rotY, scale | sx, sy, sz, tiltX, tiltZ, normal (THREE.Vector3 → align up to it, by `align` 0..1),
     *      tint (THREE.Color), bright, phase (0..1), swayScale }
     */
    add(layer, chunkKey, template, x, y, z, o = {}) {
      const key = layer + ':' + chunkKey;
      let c = chunks.get(key);
      if (!c) chunks.set(key, (c = { layer, key, items: [] }));
      const sc = o.scale ?? 1;
      _s.set(o.sx ?? sc, o.sy ?? sc, o.sz ?? sc);
      _q.setFromEuler(_e.set(o.tiltX ?? 0, o.rotY ?? 0, o.tiltZ ?? 0, 'YXZ'));
      if (o.normal) {
        _q2.setFromUnitVectors(_up, o.normal);
        _q2.slerp(_q.identity(), 1 - (o.align ?? 1));
        _q.setFromEuler(_e.set(o.tiltX ?? 0, o.rotY ?? 0, o.tiltZ ?? 0, 'YXZ')).premultiply(_q2);
      }
      _m.compose(_p.set(x, y, z), _q, _s);
      const t = o.tint;
      c.items.push({
        t: template,
        e: Float32Array.from(_m.elements),
        tr: t ? t.r : 1, tg: t ? t.g : 1, tb: t ? t.b : 1,
        bright: o.bright ?? 1,
        phase: o.phase ?? 0,
        sway: o.swayScale ?? Math.max(_s.x, _s.y),
      });
      instances++;
      const bk = `${layer}:${template.kind ?? '?'}${template.lod ? template.lod : ''}`;
      const b = breakdown[bk] || (breakdown[bk] = { n: 0, tris: 0 });
      b.n++;
      b.tris += template.indexCount / 3;
    },

    /**
     * Build one mesh per chunk. layers: { [layer]: { material, castShadow, receiveShadow, depthMaterial } }
     * Returns { meshes, triangles, vertices }.
     */
    finalize(layers) {
      const meshes = [];
      let triangles = 0, vertices = 0;
      for (const c of chunks.values()) {
        const L = layers[c.layer];
        if (!L || !c.items.length) continue;
        const geo = buildGeometry(c.items);
        const mesh = new THREE.Mesh(geo, L.material);
        mesh.name = `veg:${c.key}`;
        mesh.castShadow = !!L.castShadow;
        mesh.receiveShadow = L.receiveShadow ?? true;
        if (L.depthMaterial) mesh.customDepthMaterial = L.depthMaterial;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.userData.layer = c.layer;
        meshes.push(mesh);
        triangles += geo.index.count / 3;
        vertices += geo.attributes.position.count;
      }
      chunks.clear();
      return { meshes, triangles, vertices };
    },
  };
  return api;
}

function buildGeometry(items) {
  let vc = 0, ic = 0;
  for (const it of items) {
    vc += it.t.vertexCount;
    ic += it.t.indexCount;
  }
  const pos = new Float32Array(vc * 3);
  const nrm = new Int8Array(vc * 3);
  const col = new Uint8Array(vc * 3);
  const sway = new Uint8Array(vc * 2);
  const index = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0, io = 0;
  for (const it of items) {
    const t = it.t, e = it.e;
    _m.fromArray(e);
    _nm.getNormalMatrix(_m);
    const n = _nm.elements;
    const n0 = n[0], n1 = n[1], n2 = n[2], n3 = n[3], n4 = n[4], n5 = n[5], n6 = n[6], n7 = n[7], n8 = n[8];
    const e0 = e[0], e1 = e[1], e2 = e[2], e4 = e[4], e5 = e[5], e6 = e[6], e8 = e[8], e9 = e[9], e10 = e[10];
    const e12 = e[12], e13 = e[13], e14 = e[14];
    const P = t.positions, N = t.normals, Cc = t.colors, T = t.tint, S = t.sway;
    const swayK = (it.sway / SWAY_MAX) * 255;
    const phase = Math.round(it.phase * 255) & 255;
    const b = it.bright * 255;
    const tr = it.tr, tg = it.tg, tb = it.tb;
    const count = t.vertexCount;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3, o3 = (vo + i) * 3;
      const px = P[i3], py = P[i3 + 1], pz = P[i3 + 2];
      pos[o3] = e0 * px + e4 * py + e8 * pz + e12;
      pos[o3 + 1] = e1 * px + e5 * py + e9 * pz + e13;
      pos[o3 + 2] = e2 * px + e6 * py + e10 * pz + e14;
      const nx = N[i3], ny = N[i3 + 1], nz = N[i3 + 2];
      const ox = n0 * nx + n3 * ny + n6 * nz;
      const oy = n1 * nx + n4 * ny + n7 * nz;
      const oz = n2 * nx + n5 * ny + n8 * nz;
      const l = 127 / (Math.sqrt(ox * ox + oy * oy + oz * oz) || 1);
      nrm[o3] = ox * l;
      nrm[o3 + 1] = oy * l;
      nrm[o3 + 2] = oz * l;
      const k = T[i], k1 = 1 - k;
      // Uint8Array assignment clamps nothing (it wraps), so clamp by hand
      let r = Cc[i3] * (k1 + k * tr) * b + 0.5, g = Cc[i3 + 1] * (k1 + k * tg) * b + 0.5, bl = Cc[i3 + 2] * (k1 + k * tb) * b + 0.5;
      col[o3] = r > 255 ? 255 : r;
      col[o3 + 1] = g > 255 ? 255 : g;
      col[o3 + 2] = bl > 255 ? 255 : bl;
      const w = S[i] * swayK + 0.5;
      const o2 = (vo + i) * 2;
      sway[o2] = w > 255 ? 255 : w;
      sway[o2 + 1] = phase;
    }
    const I = t.index;
    for (let j = 0; j < t.indexCount; j++) index[io + j] = I[j] + vo;
    vo += count;
    io += t.indexCount;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  geo.setAttribute('aSway', new THREE.BufferAttribute(sway, 2, true));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.boundingSphere.radius += SWAY_MAX; // wind can push vertices a little outside
  return geo;
}
