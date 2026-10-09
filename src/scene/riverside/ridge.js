// ─────────────────────────────────────────────────────────────────────────────
// The escarpment the waterfall pours from (built by falls.js, in the falls
// frame: u across, w forward towards the pool, y up). The old terraced
// outcrop around the plunge pool is the lower cascade; behind it a mossy
// sandstone ridge rises to ~12 units and runs off left and right into the
// forest, so the falls are fed by the land instead of a free-standing rock:
//
//   • ONE heightfield: a crest that dips into a notch behind the falls, cliff
//     faces stepped in three strata, ledges, then scree & fern slopes (talus)
//     melting into the forest floor; behind the crest a long back slope. The
//     triplanar rock material lays moss on every ledge and slope.
//   • a GIANT tree on the crest (trunk ⌀ ≈ 5, rising out of every frame), its
//     buttress roots gripping the rock and pouring over the cliff edge; the
//     spring wells up from under an arching root and runs over the crest to
//     the high lip. The forest's own giants that the ridge buries get roots
//     gripping the rock too.
//   • strata shelves jutting from the faces with moss, ferns & hanging ivy
//     curtains, scree and tumbled blocks at the foot, ferns, grass, moss mats,
//     toadstools and softly glowing blue mushrooms by the spring.
//
// buildRidge(ctx, R, rng, { toWorld, groundAt }) → { spring: [[u, y, w] …],
// glowCaps: [[u, y, w] …], heightAt(u, w) }
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { materials } from '../../core/materials.js';
import { createRng } from '../../core/rng.js';
import { forestPlan } from '../../world/vegetation/plan.js';
import {
  M, TAU, LOD, segs, xf, alignUp, boulderGeo, stoneGeo, mossGeo, paramSurface, plantFern, plantGrass, addToadstool, addFlower, addIvy,
  wallFern, taperTube, Cards, flushCards, noiseA, noiseB, smooth01,
} from './kit.js';

/** Where the spring water leaves the crest (falls frame). */
export const RIDGE = { lipW: -2.95, lipY: 11.15 };

/** Giant tree on the crest (falls frame). */
const TREE = { u: 3.3, w: -7.9, r: 2.45, height: 44 };

const ROCK_TINTS = ['#8e8b80', '#858579', '#97917f', '#7c7e74', '#9a9483', '#888476'];
const MOSS = ['#6f8f3a', '#5d7d30', '#7f9a44', '#86a04a'];

// ── the profile ───────────────────────────────────────────────────────────────
/** Crest edge (w) against |u| — a notch behind the falls, receding at the ends. */
const CREST = [[0, -3.0], [1.6, -3.2], [3.2, -3.5], [4.6, -3.35], [6.2, -3.0], [7.8, -3.2], [9.4, -3.8], [11.2, -4.6], [13.2, -5.6], [16.5, -7.2]];
function table(t, x) {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) {
      const k = smooth01((x - t[i - 1][0]) / (t[i][0] - t[i - 1][0]));
      return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * k;
    }
  }
  return t[t.length - 1][1];
}
const crestW = (u) => table(CREST, Math.abs(u)) + 0.38 * noiseA(u * 0.31 + 7.7, 2.1) * smooth01((Math.abs(u) - 1.2) / 2);
const crestH = (u) => {
  const au = Math.abs(u);
  return 3.6 + 8.2 * (1 - smooth01((au - 4.5) / 12)) + 1.0 * noiseB(u * 0.27 + 3.1, 4.4) * smooth01((au - 1.6) / 2);
};
const footH = (u) => {
  const au = Math.abs(u);
  return 5.05 - 2.9 * smooth01((au - 2) / 6.5) + 0.3 * noiseA(u * 0.5, 9.1) * smooth01((au - 1.5) / 2);
};
/** The back edge of the old terraced outcrop's top terrace (the cliff's foot stays behind it). */
const outcropBack = (u) => {
  const k = 4.75 * 4.75 - (0.72 * u) ** 2;
  return k > 0 ? 3 - Math.sqrt(k) : Infinity;
};
const faceDepth = (u, wc) => {
  const au = Math.abs(u);
  const d = 0.5 + 2.1 * smooth01((au - 0.9) / 1.8) + 0.45 * noiseB(u * 0.4, 1.3) * smooth01((au - 1.5) / 2);
  return Math.max(0.42, Math.min(d, outcropBack(u) - 0.12 - wc));
};
/** Strata: where along the face (0..1) each of the three drops ends, varying along the cliff. */
const strata = (u) => [0.3 + 0.08 * noiseA(u * 0.35, 3.3), 0.64 + 0.08 * noiseB(u * 0.3, 8.1), 1];

/** Ridge surface height at (u, w) over terrain height g (falls frame). */
export function ridgeHeight(u, w, g) {
  const au = Math.abs(u);
  const wc = crestW(u), H = crestH(u);
  const F = Math.min(footH(u), H - 0.8);
  const D = faceDepth(u, wc);
  const d = w - wc;
  let h;
  if (d <= 0) {
    // the brow, then a long back slope down into the forest floor
    const back = -d;
    h = H + 0.32 * smooth01(back / 1.1) + 0.45 * noiseA(u * 0.5 + 2, w * 0.5) * smooth01(back / 1.5) - (H + 0.3 - g) * smooth01((back - 4.5) / 13);
  } else if (d < D) {
    // the cliff: three strata, each a near-vertical drop and a narrow ledge
    const st = strata(u);
    const t = d / D;
    const drop = (H - F) / 3;
    h = H;
    let t0 = 0;
    for (let k = 0; k < 3; k++) {
      const t1 = st[k];
      const f = (t - t0) / (t1 - t0);
      if (f <= 0) break;
      h -= drop * smooth01(f / 0.4) * (k === 2 ? 1 : 1 + 0.15 * noiseB(u * 0.6 + k, 2.2));
      t0 = t1;
    }
  } else {
    // talus: scree & fern slopes falling to the floor (steeply behind the old outcrop)
    const slope = 0.6 + 2.4 * (1 - smooth01((au - 3.4) / 2.6));
    h = F - (d - D) * slope + 0.22 * noiseB(u * 0.8 + 5, w * 0.8) * smooth01((d - D) / 0.7);
  }
  // the spring's channel over the crest, cut into the brow down to the lip
  if (au < 1.1 && w > -5.4 && w < -2.6) {
    const gw = 1 - smooth01((au - 0.32) / 0.55);
    const bed = RIDGE.lipY - 0.04 + 0.28 * smooth01((-w - 3.0) / 1.3);
    h += (Math.min(h, bed) - h) * gw;
  }
  // the ends dive into the forest floor
  const end = smooth01((au - 13.2) / 3.2);
  h += (g - 0.35 - h) * end;
  return h;
}

export function buildRidge(ctx, R, rng, { toWorld, groundAt }) {
  const MM = M();
  // the cliffs' own rock: bigger strata and cracks than the boulders, moss in every crevice
  const cliffRock = materials.surface('rock', { vertexColors: true, mossy: 0.74, scale: 2.0 });
  const density = ctx.quality?.density ?? 1;
  const heightAt = (u, w) => ridgeHeight(u, w, groundAt(u, w));
  const glowCaps = [];
  const springCaps = [];

  // ── the heightfield ───────────────────────────────────────────────────────
  // a non-uniform grid: fine over the cliffs by the falls, coarse out on the
  // arms and over the back slope (u columns / w rows)
  const k = LOD.k >= 1 ? 1 : LOD.k > 0.5 ? 1.6 : 2.0;
  const axisSteps = (a0, a1, fine, coarse, f0, f1) => {
    const out = [a0];
    for (let x = a0; x < a1; ) {
      x += (x > f0 && x < f1 ? fine : coarse) * k;
      out.push(Math.min(a1, x));
    }
    return out;
  };
  const US = axisSteps(-16.6, 16.6, 0.3, 0.48, -7, 7);
  const WS = axisSteps(-19, 4.6, 0.2, 0.5, -9.5, 5);
  const nu = US.length - 1, nw = WS.length - 1;
  const W = nu + 1;
  const hs = new Float32Array((nu + 1) * (nw + 1));
  const gs = new Float32Array((nu + 1) * (nw + 1));
  const U = (i) => US[i], Wf = (j) => WS[j];
  for (let j = 0; j <= nw; j++) {
    for (let i = 0; i <= nu; i++) {
      const g = groundAt(U(i), Wf(j));
      gs[j * W + i] = g;
      hs[j * W + i] = ridgeHeight(U(i), Wf(j), g);
    }
  }
  {
    const pos = [], col = [], idx = [];
    const vid = new Int32Array((nu + 1) * (nw + 1)).fill(-1);
    // (the material lays its own moss over every ledge and in soft curtains down
    // the faces — per pixel, so its edges are never triangles; the vertex colour
    // only tints: grey-brown sandstone on the faces, damp & dark by the falls,
    // light on the flats so the moss there stays fresh and velvety)
    const base = new THREE.Color('#7c7a6e'), damp = new THREE.Color('#4b5541'), ochre = new THREE.Color('#8f8062'), flat = new THREE.Color('#b9bb98'), back = new THREE.Color('#9b9772'), c = new THREE.Color();
    const at = (i, j) => hs[Math.min(nw, Math.max(0, j)) * W + Math.min(nu, Math.max(0, i))];
    const vert = (i, j) => {
      const k = j * W + i;
      if (vid[k] >= 0) return vid[k];
      let u = U(i), w = Wf(j);
      const y = Math.max(hs[k], gs[k] - 0.5);
      // steepness from the neighbours: bend the faces into bulging, leaning strata
      const su = Math.abs(at(i + 1, j) - at(i - 1, j)) / (U(Math.min(nu, i + 1)) - U(Math.max(0, i - 1))), sw = Math.abs(at(i, j + 1) - at(i, j - 1)) / (Wf(Math.min(nw, j + 1)) - Wf(Math.max(0, j - 1)));
      const steep = smooth01((Math.max(su, sw) - 1.1) / 2.2);
      const wild = steep * smooth01((Math.abs(u) - 1.0) / 0.9) * smooth01((y - gs[k]) / 0.8);
      u += wild * (0.22 * noiseA(y * 1.3 + 11, w * 0.8) + 0.06 * noiseB(y * 5, u * 2));
      w += wild * (0.24 * noiseB(y * 1.3 - 4, u * 0.8) + 0.06 * noiseA(y * 5 + 3, w * 2));
      vid[k] = pos.length / 3;
      pos.push(u, y, w);
      const band = Math.sin(y * 4.3 + noiseA(u * 0.5, w * 0.5) * 1.6);
      c.copy(base).multiplyScalar(0.86 + 0.12 * band - 0.2 * smooth01((band - 0.75) / 0.25) + 0.08 * noiseB(u * 1.9 + y, w * 1.9));
      c.lerp(ochre, 0.3 * smooth01(noiseA(u * 0.21 + 4, y * 0.6) * 1.5));
      c.lerp(damp, 0.55 * (1 - smooth01((Math.abs(u) - 0.6) / 2.6)) * (0.4 + 0.6 * steep) + 0.2 * (1 - smooth01((y - gs[k]) / 1.5)));
      c.lerp(flat, (1 - steep) * 0.75);
      c.lerp(back, 0.5 * smooth01((crestW(u) - w - 2.5) / 4));
      col.push(c.r, c.g, c.b);
      return vid[k];
    };
    for (let j = 0; j < nw; j++) {
      for (let i = 0; i < nu; i++) {
        const a = j * W + i, b = a + 1, cc = a + W, d = cc + 1;
        if (Math.max(hs[a] - gs[a], hs[b] - gs[b], hs[cc] - gs[cc], hs[d] - gs[d]) < 0.05) continue;
        const va = vert(i, j), vb = vert(i + 1, j), vc = vert(i, j + 1), vd = vert(i + 1, j + 1);
        idx.push(va, vc, vb, vb, vc, vd);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // (an open surface: the shadow pass draws back faces, so add them for the ridge's shadow)
    const n0 = idx.length;
    if (LOD.shadows && LOD.k >= 1) for (let i = 0; i < n0; i += 3) idx.push(idx[i], idx[i + 2], idx[i + 1]);
    g.setIndex(idx);
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    R.add(cliffRock, g, { cast: true });
  }

  // slope of the ridge at (u, w): { s, nu, nw } (s = rise per unit, n = downhill direction)
  const slopeAt = (u, w, e = 0.15) => {
    const gu = (heightAt(u + e, w) - heightAt(u - e, w)) / (2 * e), gw = (heightAt(u, w + e) - heightAt(u, w - e)) / (2 * e);
    const s = Math.hypot(gu, gw) || 1e-6;
    return { s, ou: -gu / s, ow: -gw / s };
  };
  const proud = (u, w, k = 0.12) => heightAt(u, w) > groundAt(u, w) + k;
  const inWater = (u, w) => Math.abs(u) < 0.7 && w > -5 && w < 0.5;

  // ── strata shelves on the cliff faces (moss, ferns, ivy curtains) ───────────
  const hangers = [];
  {
    const shelves = [];
    const want = Math.round(46 * (LOD.k < 1 ? 0.45 : 1));
    for (let tries = 0; tries < 1600 && shelves.length < want; tries++) {
      const u = rng.jitter(13), w = rng.range(-9.5, 1.5);
      if (Math.abs(u) < 1.0) continue;
      const sl = slopeAt(u, w);
      if (sl.s < 1.5) continue;
      const y = heightAt(u, w);
      if (y < groundAt(u, w) + 0.6) continue;
      if (shelves.some((q) => Math.hypot(q.u - u, q.w - w) < 1.0 && Math.abs(q.y - y) < 0.7)) continue;
      // (set back into the face: a ledge of the rock itself, never a slab stuck on the moss)
      shelves.push({ u: u - sl.ou * 0.06, w: w - sl.ow * 0.06, y, ou: sl.ou, ow: sl.ow });
    }
    for (const sh of shelves) {
      const len = rng.range(0.8, 1.9), dep = rng.range(0.4, 0.62), th = rng.range(0.12, 0.22);
      const g = boulderGeo(rng, len, th, dep, { strata: 1, lump: 0.14, round: 0.25, detail: 2 });
      xf(g, [sh.u, sh.y - th * 0.7, sh.w], [rng.jitter(0.05), Math.atan2(sh.ou, sh.ow) + Math.PI / 2 + rng.jitter(0.15), rng.jitter(0.06)]);
      R.add(MM.rock, g, { color: rng.pick(ROCK_TINTS), cast: true });
      const top = sh.y + th * 0.35;
      const m = mossGeo(rng, { r: dep * 0.34, h: 0.06, sx: (len / dep) * 0.62, seg: 8 });
      xf(m, [sh.u, top - 0.015, sh.w], [0, Math.atan2(sh.ou, sh.ow) + Math.PI / 2, 0]);
      R.add(MM.moss, m, { color: rng.pick(MOSS), cast: false });
      const fu = sh.u + sh.ou * dep * 0.45, fw = sh.w + sh.ow * dep * 0.45;
      const k = rng.next();
      if (k < 0.55) wallFern(R, rng, [fu, top, fw], [sh.ou, -0.1, sh.ow], { size: rng.range(0.35, 0.55), fronds: rng.int(6, 9) });
      else if (k < 0.7) addToadstool(R, rng, fu, top, fw, { size: rng.range(0.08, 0.13), color: rng.chance(0.6) ? '#c4301f' : '#d7832e' });
      else if (k < 0.82) glowCaps.push([fu, top, fw]);
      hangers.push({ u: fu, w: fw, top, ou: sh.ou, ow: sh.ow, len });
    }
  }
  // ivy & moss curtains hanging from the crest edge and the shelves, hugging the face
  {
    const ivy = new Cards();
    const edges = [];
    for (let k = 0; k < Math.round(44 * (LOD.k < 0.5 ? 0.25 : LOD.k < 1 ? 0.4 : 1)); k++) {
      const u = (rng.chance(0.5) ? 1 : -1) * rng.range(1.0, 12.5);
      const w = crestW(u) + 0.08;
      const y = heightAt(u, w - 0.15);
      if (y < groundAt(u, w) + 1.5) continue;
      edges.push({ u, w, top: y, ou: 0, ow: 1, len: 1.2 });
    }
    for (const hg of [...edges, ...hangers]) {
      const strands = LOD.k < 0.5 ? 1 : LOD.k < 1 ? rng.int(1, 2) : rng.int(1, 3);
      for (let k = 0; k < strands; k++) {
        const ua = hg.u + rng.jitter(hg.len * 0.4) * hg.ow, wa = hg.w - rng.jitter(hg.len * 0.4) * hg.ou;
        const n = new THREE.Vector3();
        addIvy(R, rng, [ua, hg.top, wa], [hg.ou * 0.2 + rng.jitter(0.15), -1, hg.ow * 0.2], {
          length: rng.range(0.9, 2.4),
          droop: 1.5,
          size: 0.17,
          density: 1.4,
          normal: [hg.ou, 0, hg.ow],
          cards: ivy,
          stem: false,
          // hug the face: push the strand out of the rock wherever it sinks in
          surface: (p, nn) => {
            const h = heightAt(p.x, p.z);
            if (p.y < h + 0.02) {
              let tries = 0;
              while (heightAt(p.x, p.z) > p.y && tries++ < 10) {
                p.x += hg.ou * 0.05;
                p.z += hg.ow * 0.05;
              }
            }
            const sl = slopeAt(p.x, p.z, 0.2);
            n.set(sl.ou, 0.35, sl.ow).normalize();
            nn.copy(n);
          },
        });
      }
    }
    flushCards(R, ivy, MM.ivy, null, 0);
  }

  // ferns & little toadstools sprouting from the crevices of the faces
  {
    const want = Math.round(60 * Math.max(0.3, density * 0.7 + (density >= 1 ? 0.3 : 0)));
    for (let tries = 0, placed = 0; tries < 1500 && placed < want; tries++) {
      const u = rng.jitter(13), w = rng.range(-9.5, 2);
      if (Math.abs(u) < 1.1) continue;
      const sl = slopeAt(u, w);
      if (sl.s < 1.8) continue;
      const y = heightAt(u, w);
      if (y < groundAt(u, w) + 0.5) continue;
      placed++;
      const p = [u + sl.ou * 0.06, y, w + sl.ow * 0.06];
      if (rng.chance(0.85)) wallFern(R, rng, p, [sl.ou, 0.1, sl.ow], { size: rng.range(0.3, 0.6), fronds: rng.int(5, 8) });
      else glowCaps.push([p[0] + sl.ou * 0.1, y - 0.05, p[2] + sl.ow * 0.1]);
    }
  }

  // ── scree & tumbled blocks at the foot, stones on the slopes ────────────────
  {
    const nBlocks = Math.round(14 * Math.max(0.5, density));
    for (let i = 0, placed = 0; i < 400 && placed < nBlocks; i++) {
      const u = rng.jitter(12.5), w = rng.range(-6, 3.5);
      if (Math.abs(u) < 3.6) continue;
      const sl = slopeAt(u, w);
      if (sl.s > 1.2 || sl.s < 0.2 || !proud(u, w, 0.25)) continue;
      const y = heightAt(u, w);
      const s = rng.range(0.7, 1.5);
      // (bedded into the slope: tipped most of the way with it and sunk, so no
      // block stands proud of the moss like a box on a hillside)
      const hb = s * rng.range(0.5, 0.72);
      const g = boulderGeo(rng, s * rng.range(1.1, 1.5), hb, s, { strata: 2, lump: 0.22, round: 0.55, detail: 2 });
      g.translate(0, -hb * 0.45, 0);
      g.rotateY(Math.atan2(sl.ou, sl.ow) + Math.PI / 2 + rng.jitter(0.5));
      alignUp(g, sl.ou * sl.s * 0.75, 1, sl.ow * sl.s * 0.75);
      g.translate(u, y - hb * 0.12, w);
      R.add(MM.rock, g, { color: rng.pick(ROCK_TINTS), cast: true });
      if (rng.chance(0.75)) {
        const m = mossGeo(rng, { r: s * 0.38, h: 0.1, sx: 1.2, seg: 8 });
        m.rotateY(rng.next() * TAU).translate(0, hb * 0.5, 0);
        alignUp(m, sl.ou * sl.s * 0.75, 1, sl.ow * sl.s * 0.75);
        R.add(MM.moss, m.translate(u, y - hb * 0.12, w), { color: rng.pick(MOSS), cast: false });
      }
      placed++;
    }
    const nStones = Math.round(90 * Math.max(0.3, density * 0.7 + (density >= 1 ? 0.3 : 0)));
    for (let i = 0, placed = 0; i < 900 && placed < nStones; i++) {
      const u = rng.jitter(13), w = rng.range(-10, 4);
      if (inWater(u, w) || !proud(u, w)) continue;
      const sl = slopeAt(u, w);
      if (sl.s > 1.3) continue;
      const y = heightAt(u, w);
      const r = rng.range(0.08, 0.3);
      const g = stoneGeo(rng, { r, sy: rng.range(0.45, 0.7), detail: LOD.k < 0.5 && r < 0.16 ? 0 : 1, lump: 0.25 });
      xf(g, [u, y + r * 0.1, w], [rng.jitter(0.3), rng.next() * TAU, rng.jitter(0.3)]);
      R.add(MM.pebble, g, { color: rng.pick(ROCK_TINTS), cast: false });
      placed++;
    }
  }

  // ── greenery: ferns, grass, moss mats, flowers & toadstools on every ledge and slope ──
  {
    const n = Math.round(230 * Math.max(0.3, density * 0.8 + (density >= 1 ? 0.2 : 0)));
    for (let i = 0, placed = 0; i < 2400 && placed < n; i++) {
      const u = rng.jitter(14), w = rng.range(-14, 4.2);
      if (inWater(u, w) || !proud(u, w, 0.15)) continue;
      const sl = slopeAt(u, w);
      if (sl.s > 1.25) continue;
      const y = heightAt(u, w) - 0.02;
      placed++;
      const k = rng.next();
      if (k < 0.36) plantFern(R, rng, u, y, w, { size: rng.range(0.55, 1.15), fronds: rng.int(8, 12), tilt: 1.15 });
      else if (k < 0.56) plantGrass(R, rng, u, y, w, { size: rng.range(0.3, 0.55), blades: rng.int(4, 6) });
      else if (k < 0.8) {
        // a moss mat hugging the slope (tipped onto it and sunk, never a lid floating off it)
        const hm = rng.range(0.07, 0.14);
        const m = mossGeo(rng, { r: rng.range(0.25, 0.55), h: hm, sx: rng.range(1, 1.6) });
        m.rotateY(rng.next() * TAU);
        alignUp(m, sl.ou * sl.s, 1, sl.ow * sl.s);
        m.translate(u, y - hm * 0.35, w);
        R.add(MM.moss, m, { color: rng.pick(MOSS), cast: false });
      } else if (k < 0.88) {
        const col = rng.chance(0.6) ? '#c4301f' : '#d7832e';
        for (let q = 0; q < rng.int(1, 3); q++) addToadstool(R, rng, u + rng.jitter(0.15), y, w + rng.jitter(0.15), { size: rng.range(0.08, 0.16), color: col });
      } else if (k < 0.96) {
        const col = rng.pick(['#f4f0e6', '#7fa7e0', '#f29bb8', '#f2c14e']);
        for (let q = 0; q < 3; q++) addFlower(R, rng, u + rng.jitter(0.15), y, w + rng.jitter(0.15), { size: 0.05, color: col });
      } else glowCaps.push([u, y, w]);
    }
  }

  // ── rock outcrops breaking up the mossy slopes: weathered boulders half
  // buried in the moss, moss settled on their tops, a fern at their feet ──
  {
    // (their own random stream: everything after them stays as it was)
    const rng = createRng('ridge-outcrops');
    const want = Math.round(14 * (LOD.k < 0.5 ? 0.4 : LOD.k < 1 ? 0.7 : 1));
    const placed = [];
    for (let i = 0; i < 900 && placed.length < want; i++) {
      const u = rng.jitter(12.5), w = rng.range(-11, 2.5);
      if (inWater(u, w) || Math.abs(u) < 1.6 || !proud(u, w, 0.3)) continue;
      const sl = slopeAt(u, w);
      if (sl.s < 0.3 || sl.s > 1.2) continue;
      if (placed.some((q) => Math.hypot(q[0] - u, q[1] - w) < 2.2)) continue;
      placed.push([u, w]);
      // a weathered boulder half buried in the slope: lumpy, flattened along the
      // slope (its up axis is the slope's normal), sunk to just over half its height
      const r = rng.range(0.4, 0.68), sy = rng.range(0.45, 0.6);
      const dep = r * 2;
      const g = stoneGeo(rng, { r, sx: rng.range(1.2, 1.6), sy, sz: 1, lump: 0.3, detail: 2, flatTop: 0.45, flatBottom: -0.9 });
      g.rotateY(Math.atan2(sl.ou, sl.ow) + Math.PI / 2 + rng.jitter(0.4));
      alignUp(g, sl.ou * sl.s, 1, sl.ow * sl.s);
      const y = heightAt(u, w);
      g.translate(u, y - r * sy * 0.1, w);
      R.add(MM.rock, g, { color: rng.pick(ROCK_TINTS), cast: false });
      const m = mossGeo(rng, { r: r * 0.55, h: 0.05, sx: 1.3 });
      alignUp(m.rotateY(rng.next() * TAU), sl.ou * sl.s, 1, sl.ow * sl.s).translate(u - sl.ou * r * 0.25, y + r * sy * 0.5, w - sl.ow * r * 0.25);
      R.add(MM.moss, m, { color: rng.pick(MOSS), cast: false });
      if (rng.chance(0.6)) wallFern(R, rng, [u + sl.ou * dep * 0.45, y - r * sy * 0.1, w + sl.ow * dep * 0.45], [sl.ou, 0.1, sl.ow], { size: rng.range(0.3, 0.45), fronds: rng.int(6, 8) });
    }
  }

  // ── the giant on the crest ────────────────────────────────────────────────
  const bark = materials.surface('bark', { mossy: 0.3, scale: 1.8, vertexColors: true });
  const BARK = new THREE.Color('#6a5845'), BARK_HI = new THREE.Color('#857a6c'), MOSSY = new THREE.Color('#55702a');
  const tb = { u: TREE.u, w: TREE.w, y: heightAt(TREE.u, TREE.w) };
  const lean = new THREE.Vector2(-0.012, -0.018); // (a touch towards the back of the ridge)
  const lobes = 7, lobePh = rng.next() * TAU;
  /** Trunk radius at height h above its base, azimuth phi (buttress lobes at the foot). */
  const trunkR = (h, phi) => {
    const r = TREE.r * (1 + 0.26 * Math.exp(-Math.max(0, h) / 1.8)) * (1 - 0.0045 * Math.max(0, h));
    const lobe = Math.pow(Math.max(0, Math.cos(lobes * phi * 0.5 + lobePh) ** 2), 2.5) * 0.32 * Math.exp(-Math.max(0, h) / 2.0);
    return r * (1 + lobe + 0.05 * noiseA(Math.cos(phi) * 2 + h * 0.15, Math.sin(phi) * 2));
  };
  const axis = (h) => [tb.u + lean.x * h * h * 0.02 + lean.x * h, tb.w + lean.y * h];
  {
    const H0 = -1.6, H1 = TREE.height;
    const nr = segs(40, 20), nh = segs(46, 22);
    const g = paramSurface(
      (s, t, p) => {
        // denser rings low down (the buttresses), sparse up the column
        const h = H0 + (H1 - H0) * Math.pow(t, 1.6);
        const phi = s * TAU;
        const [cu, cw] = axis(h);
        const r = trunkR(h, phi);
        p.set(cu + Math.sin(phi) * r, tb.y + h, cw + Math.cos(phi) * r);
        // the foot hugs the rock (never a skirt hanging in the air)
        if (h < 0.6) p.y = Math.max(tb.y + h - 1.4, Math.min(p.y, heightAt(p.x, p.z) - 0.25 + (h - H0) * 0.15));
      },
      nr,
      nh,
      { flip: true, uv: (s, t) => [s * 7, Math.pow(t, 1.6) * (H1 - H0) / 2.4] }
    );
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) - tb.y;
      const phi = Math.atan2(pos.getX(i) - tb.u, pos.getZ(i) - tb.w);
      c.copy(BARK).lerp(BARK_HI, smooth01((h - 8) / 20)).multiplyScalar(0.9 + 0.12 * noiseB(phi * 3, h * 0.3));
      // moss up the foot and on the side facing away from the sun (−u)
      c.lerp(MOSSY, (1 - smooth01((h - 1.0) / 5)) * 0.55 + 0.25 * smooth01(-Math.sin(phi) * 1.5) * (1 - smooth01((h - 6) / 12)));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    R.add(bark, g, { cast: true });
  }
  // the crown, far above every frame: three limbs into the canopy ceiling, leaf masses at their ends
  {
    const top = TREE.height;
    const leafMat = materials.foliage({ variant: 'oak', vertexColors: true, translucency: 1.0, wind: { strength: 0.012, base: -0.4, speed: 0.7 } });
    const cards = new Cards();
    const [cu, cw] = axis(top - 6);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + 0.6 + rng.jitter(0.3);
      const end = new THREE.Vector3(cu + Math.sin(a) * 7, tb.y + top + 6 + rng.range(0, 4), cw + Math.cos(a) * 7);
      const pts = [new THREE.Vector3(cu, tb.y + top - 7, cw), new THREE.Vector3(cu + Math.sin(a) * 2.5, tb.y + top + 0.5, cw + Math.cos(a) * 2.5), end];
      R.add(bark, taperTube(pts, TREE.r * 0.62, 0.35, segs(10, 6), 10), { color: '#7c7062', cast: false });
      for (let q = 0; q < 3; q++) {
        const c = end.clone().add(new THREE.Vector3(rng.jitter(3), rng.range(-1, 2.5), rng.jitter(3)));
        const rc = rng.range(3.2, 4.6);
        for (let i = 0; i < Math.round(36 * Math.max(0.5, LOD.k)); i++) {
          const d = new THREE.Vector3(rng.jitter(1), rng.jitter(0.7), rng.jitter(1));
          if (d.lengthSq() > 1) d.setLength(rng.next());
          const p = c.clone().addScaledVector(d, rc);
          const out = d.clone().normalize();
          const up = new THREE.Vector3(rng.jitter(0.4), 1, rng.jitter(0.4)).normalize();
          cards.add(p, up, out.lengthSq() > 0 ? out : new THREE.Vector3(0, 1, 0), rng.range(1.6, 2.4), { aspect: 1, flip: rng.chance(0.5) });
        }
      }
    }
    R.add(leafMat, cards.geometry(), { color: '#5f7d3c', cast: false });
  }

  // roots: from the buttresses over the crest — the front ones pour over the
  // edge and down the cliff, gripping the rock; one arches over the spring
  const rootTube = (pts, r0, r1, mossTop = true) => {
    if (pts.length < 3) return;
    const v = pts.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2])));
    const g = taperTube(v, r0, r1, r0 > 0.3 ? segs(8, 5) : segs(6, 4), Math.max(6, Math.round(v.length * 1.3 * Math.max(0.6, LOD.k))));
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      // up-facing sides mossy
      const ny = g.attributes.normal.getY(i);
      c.copy(BARK).multiplyScalar(0.92 + 0.1 * noiseA(pos.getX(i) * 2, pos.getZ(i) * 2));
      if (mossTop) c.lerp(MOSSY, smooth01((ny - 0.25) / 0.5) * 0.7);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    R.add(bark, g, { cast: r0 > 0.25 });
  };
  /** A root path from (u, w) heading along (du, dw): over the surface, then down any cliff it meets. */
  const rootPath = (u, w, du, dw, y0, len, r0, { hug = 0.55 } = {}) => {
    const pts = [new THREE.Vector3(u, y0, w)];
    let d = new THREE.Vector2(du, dw).normalize();
    let travelled = 0, r = r0, mode = 'over';
    let pu = u, pw = w, py = y0;
    const ph = rng.next() * TAU;
    for (let k = 0; k < 60 && travelled < len; k++) {
      r = r0 * (1 - travelled / len) + 0.03;
      if (mode === 'over') {
        const nu2 = pu + d.x * 0.32, nw2 = pw + d.y * 0.32;
        const h = heightAt(nu2, nw2);
        if (h < py - r - 0.55 && k > 1) {
          mode = 'down';
        } else {
          pu = nu2;
          pw = nw2;
          py = Math.max(h + r * hug, py - 0.45);
          travelled += 0.32;
          d.rotateAround(new THREE.Vector2(), rng.jitter(0.12));
          pts.push(new THREE.Vector3(pu, py, pw));
          continue;
        }
      }
      // down the face: drop, then find the face at that height and sit just outside it
      py -= 0.34;
      let tries = 0;
      while (heightAt(pu, pw) > py - r * 0.2 && tries++ < 16) {
        pu += d.x * 0.05;
        pw += d.y * 0.05;
      }
      while (heightAt(pu - d.x * 0.05, pw - d.y * 0.05) < py - r * 0.2 && tries++ < 24) {
        pu -= d.x * 0.05;
        pw -= d.y * 0.05;
      }
      // (wandering across the face as it creeps down, never a straight drip)
      const lat = 0.16 * Math.sin(k * 1.15 + ph) + rng.jitter(0.05);
      pu += -d.y * lat;
      pw += d.x * lat;
      travelled += 0.36;
      pts.push(new THREE.Vector3(pu + d.x * r * 0.6, py, pw + d.y * r * 0.6));
      if (py < groundAt(pu, pw) + 0.2 || heightAt(pu + d.x * 0.4, pw + d.y * 0.4) > py + 0.4) break;
    }
    return pts;
  };
  const springAt = { u: 0.12, w: -4.5 };
  {
    // big roots reaching for the cliff: over the brow, then creeping down the
    // face either side of the falls; the rest grip the crest and plunge into the moss
    const front = [-0.62, -0.36, 0.06, 0.42]; // azimuths off +w (towards the cliff)
    const plan = [
      ...front.map((a) => ({ phi: a + rng.jitter(0.08), len: rng.range(8, 11.5), r: rng.range(0.55, 0.72), lets: 3 })),
      ...[1.25, 2.0, 2.75, 3.6, 4.4, 5.2].map((a) => ({ phi: a + rng.jitter(0.25), len: rng.range(3, 5.5), r: rng.range(0.5, 0.68), lets: 1 })),
    ];
    for (const rt of plan) {
      const du = Math.sin(rt.phi), dw = Math.cos(rt.phi);
      const start = trunkR(1.0, rt.phi) * 0.82;
      const su = tb.u + du * start, sw = tb.w + dw * start;
      const pts = [new THREE.Vector3(tb.u + du * TREE.r * 0.62, tb.y + 3.0, tb.w + dw * TREE.r * 0.62), ...rootPath(su, sw, du, dw, tb.y + 1.2, rt.len, rt.r)];
      rootTube(pts, rt.r, rt.lets > 1 ? 0.06 : 0.05);
      // rootlets branching off sideways, creeping over the rock
      for (let q = 0; q < (LOD.k < 1 ? Math.min(1, rt.lets) : rt.lets); q++) {
        const p = pts[Math.min(pts.length - 2, 2 + Math.floor(((q + 0.5) / rt.lets) * (pts.length - 3)))];
        if (!p) continue;
        const ph2 = rt.phi + (q % 2 ? 1 : -1) * rng.range(0.7, 1.4);
        const sub = rootPath(p.x, p.z, Math.sin(ph2), Math.cos(ph2), p.y, rng.range(1.5, 3.2), 0.16);
        rootTube([p, ...sub], 0.16, 0.025);
      }
    }
    // the root arching over the spring: the water wells up from under it
    const H = heightAt(springAt.u, springAt.w + 0.1);
    const arch = [
      new THREE.Vector3(tb.u - 1.3, tb.y + 2.6, tb.w + 1.6),
      new THREE.Vector3(tb.u - 2.2, tb.y + 0.9, tb.w + 2.9),
      new THREE.Vector3(1.3, H + 0.95, -5.0),
      new THREE.Vector3(0.5, H + 0.72, springAt.w - 0.05),
      new THREE.Vector3(-0.35, H + 0.55, springAt.w + 0.25),
      new THREE.Vector3(-1.15, heightAt(-1.15, -3.85) + 0.3, -3.85),
      ...rootPath(-1.6, -3.55, -0.6, 1, heightAt(-1.6, -3.55) + 0.25, 6, 0.45).slice(1),
    ];
    rootTube(arch, 0.66, 0.14);
    // the hollow the spring wells out of: dark, damp, ringed with moss and glowing caps
    const hollow = new THREE.SphereGeometry(0.42, segs(12, 8), 6, 0, TAU, 0, Math.PI / 2).scale(1.2, 0.62, 0.8).rotateX(Math.PI / 2).translate(springAt.u, H + 0.14, springAt.w - 0.18);
    R.add(MM.vc, hollow, { color: '#1d211a', cast: false });
    for (const [du, dw, s] of [[-0.75, 0.1, 0.32], [0.85, -0.05, 0.36], [-0.55, 0.7, 0.24], [0.7, 0.75, 0.26]]) {
      const m = mossGeo(rng, { r: s, h: 0.1, sx: 1.3, seg: 9 });
      xf(m, [springAt.u + du, heightAt(springAt.u + du, springAt.w + dw) - 0.02, springAt.w + dw], [0, rng.next() * TAU, 0]);
      R.add(MM.moss, m, { color: rng.pick(MOSS), cast: false });
    }
    springCaps.push([springAt.u + 0.75, heightAt(springAt.u + 0.75, springAt.w + 0.35), springAt.w + 0.35], [springAt.u - 0.7, heightAt(springAt.u - 0.7, springAt.w + 0.5), springAt.w + 0.5], [1.4, heightAt(1.4, -3.4), -3.4], [-1.3, heightAt(-1.3, -3.2), -3.2]);
    // ferns arching over the spring and along the crest by the lip
    for (const [u, w] of [[-1.0, -4.6], [1.05, -4.0], [-0.9, -3.3], [1.0, -3.15], [2.2, -3.6], [-2.0, -3.8]]) plantFern(R, rng, u, heightAt(u, w) - 0.03, w, { size: rng.range(0.75, 1.05), fronds: rng.int(9, 12), tilt: 1.2 });
  }
  // the forest's own giants that the ridge buries: roots gripping the rock round them
  // (a moss collar only on the low tier)
  {
    const { trees } = forestPlan();
    // (to the falls frame: dot with the frame axes)
    const o = toWorld(0, 0, 0), ax = toWorld(1, 0, 0).sub(o), fw = toWorld(0, 0, 1).sub(o);
    for (const t of trees) {
      const dx = t.x - o.x, dz = t.z - o.z;
      const u = dx * ax.x + dz * ax.z, w = dx * fw.x + dz * fw.z;
      if (Math.abs(u) > 15 || w < -12 || w > 4) continue;
      const top = heightAt(u, w);
      if (top < t.y0 + 0.6) continue;
      const rr = t.radius * 1.12;
      const n = LOD.k < 0.5 ? 0 : t.kind === 'birch' ? 4 : LOD.k < 1 ? 4 : 7;
      for (let k = 0; k < n; k++) {
        const phi = (k / n) * TAU + rng.jitter(0.3);
        const du = Math.sin(phi), dw = Math.cos(phi);
        const su = u + du * rr * 0.9, sw = w + dw * rr * 0.9;
        const pts = [new THREE.Vector3(u + du * rr * 0.55, top + 2.4, w + dw * rr * 0.55), ...rootPath(su, sw, du, dw, top + 0.7, rng.range(3, 6), t.radius * 0.28)];
        rootTube(pts, t.radius * rng.range(0.24, 0.32), 0.04);
      }
      const m = mossGeo(rng, { r: rr * 1.25, h: 0.25, seg: 12 });
      xf(m, [u, top - 0.05, w], [0, rng.next() * TAU, 0]);
      R.add(MM.moss, m, { color: '#5d7d30', cast: false });
    }
  }
  if (ctx.colliders?.addCircle) {
    const p = toWorld(tb.u, 0, tb.w);
    ctx.colliders.addCircle(p.x, p.z, TREE.r * 1.1, 'falls-giant');
  }

  return {
    heightAt,
    // (a handful of glowing clusters is magic; dozens would be a runway)
    glowCaps: springCaps.concat(glowCaps.filter((_, i) => i % 3 === 0)).slice(0, 12),
    /** The spring channel's course (u, y, w) from the hollow under the arching root towards the lip. */
    spring: [
      [springAt.u, RIDGE.lipY + 0.27, springAt.w + 0.05],
      [0.05, RIDGE.lipY + 0.18, -3.9],
      [-0.02, RIDGE.lipY + 0.09, -3.3],
    ],
    tree: toWorld(tb.u, tb.y, tb.w),
  };
}
