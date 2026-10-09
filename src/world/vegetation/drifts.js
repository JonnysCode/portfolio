// ─────────────────────────────────────────────────────────────────────────────
// Colour on the forest floor (refs: the fairy garden's blue, pink, white and
// yellow clumps; the stone tower's flower beds along the paths).
//
//   flower drifts   elongated drifts of one species (plus a stray companion)
//                   — 10–18 bloom cushions each, every cushion a dozen to
//                   fifty heads (vegetation/blooms.js) — strung along the
//                   paths' edges, hugging the houses' bases and filling the
//                   lawn wedges between the paths: forget-me-not and bluebell
//                   blue, wood-anemone white, campion pink, buttercup yellow.
//                   Read from the glen's overview as washes of colour.
//   accent shrubs   low hydrangeas (blue, pink, white mopheads) by the
//                   cottages and knee-high ones on the lawn by the Schreinerei
//                   and the bridge path
//   leaf drifts     ochre & russet leaves blown into drifts on the lawns, in
//                   the floor's own litter-drift patches (handed to litter.js:
//                   same instanced leaf mesh)
//   signpost        a small wooden signpost at the path fork (props.makeSignpost)
//
// Its own random streams: the rest of the vegetation's placement is untouched.
// buildDrifts(ctx, opts) → { meshes, objects, cover, flowerPatches, leaves, zones, stats }
// (built before the undergrowth scatter: inside the zones only low plants grow)
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { getHeight, getNormal, getPathDistance, pathPolylines, PADS } from '../ground.js';
import { SPOTS } from '../layout.js';
import { TAU, GeoBuilder, instanced, staticMesh, fieldAlt, groundPatches } from './common.js';
import { canGrow, isClearOfViews, isClearOfSubjects, cameraClearance, inShot, padClearance, oakDist, viewsBlocking } from './zones.js';
import { pickWeighted } from './families.js';
import { bloomTemplate, hydrangea, BLOOM_KINDS, BLOOM_HEIGHT } from './blooms.js';

const MIX = {
  path: { forgetMeNot: 3, buttercup: 2.5, anemone: 2.5, campion: 1.6, bluebell: 1.2 },
  house: { campion: 3, forgetMeNot: 2.4, bluebell: 2, anemone: 2, buttercup: 1.4 },
  wedge: { bluebell: 3, anemone: 2.5, buttercup: 2.5, campion: 2, forgetMeNot: 1.6 },
};
/** A companion that grows at a drift's fringe. */
const COMPANION = { forgetMeNot: 'anemone', bluebell: 'anemone', anemone: 'forgetMeNot', campion: 'buttercup', buttercup: 'forgetMeNot' };
/** The colour a drift washes the ground with (terrain aBloom; linear via THREE.Color). */
const WASH = {
  forgetMeNot: new THREE.Color('#6a9cf2'),
  bluebell: new THREE.Color('#6c64e0'),
  anemone: new THREE.Color('#f4f2ea'),
  campion: new THREE.Color('#e2589c'),
  buttercup: new THREE.Color('#ffe23a'),
};
const LEAF_TONES = ['#c8862e', '#b5652a', '#d49a3c', '#a4502a', '#c27430', '#8e4a24', '#dcae4c', '#b8402a', '#cf8a34'];
const FORK = { x: 0, z: 9.3 };

export function buildDrifts(ctx, { occ, density = 1, tier = 'high', flowerMat, leafMat, ringAt = null }) {
  const t0 = performance.now();
  const rng = createRng('vegetation:drifts');
  const lite = tier !== 'high';
  const dk = Math.min(1, Math.sqrt(density));
  const items = Object.fromEntries(BLOOM_KINDS.map((k) => [k, []]));
  const cover = [];
  const flowerPatches = [];
  const sites = [];
  /** The drifts' ellipses (the scatter keeps them low): { x, z, ax, az (unit axis), hl, hw (half axes), R2 } */
  const zones = [];
  const near = (x, z, d) => sites.some((s) => Math.hypot(s.x - x, s.z - z) < d);
  const ringClear = (x, z, d = 0.4) => !ringAt || Math.hypot(x - ringAt.x, z - ringAt.z) > ringAt.r + d;
  const stats = { sites: 0, cushions: 0, hydrangeas: 0, leafDrifts: 0, leaves: 0, signpost: false };

  /** Where a cushion of height h may grow: free floor, out of the lenses' sight lines. */
  const cushionY = (x, z, h, r) => {
    if (!canGrow(x, z, { path: 1.08 }) || !ringClear(x, z, 0.25)) return null;
    if (occ.clearance(x, z, 2) < 0.04) return null;
    if (cameraClearance(x, z) < 1.3) return null;
    const y = getHeight(x, z);
    if (h > 0.55 ? !isClearOfViews(x, y, z, h, r) : !isClearOfSubjects(x, y, z, h, r, ['glen'])) return null;
    return y;
  };
  /** A drift: an ellipse (length L along axis az, width W) of cushions of `kind`. */
  const drift = (cx, cz, az, L, W, kind, n, sizeK = 1) => {
    const ax = Math.sin(az), azz = Math.cos(az);
    let placed = 0;
    const comp = COMPANION[kind];
    for (let i = 0; i < n * 2 && placed < n; i++) {
      const a = rng.range(0, TAU), d = Math.sqrt(rng.next());
      const u = Math.cos(a) * d * L * 0.5, v = Math.sin(a) * d * W * 0.5;
      const x = cx + ax * u + azz * v, z = cz + azz * u - ax * v;
      // (a stray companion at the fringe now and then)
      const k = d > 0.7 && rng.chance(0.22) ? comp : kind;
      const s = rng.range(1.0, 1.35) * (1.12 - 0.3 * d) * sizeK;
      const h = BLOOM_HEIGHT[k] * s;
      const y = cushionY(x, z, h, 0.28 * s);
      if (y === null) continue;
      items[k].push({ x, y: y - 0.01, z, ry: rng.range(0, TAU), s, sy: rng.range(0.85, 1.15), color: new THREE.Color(1, 1, 1).offsetHSL(rng.jitter(0.012), 0, rng.jitter(0.04)) });
      cover.push({ x, z, r: 0.3 * s });
      placed++;
    }
    if (placed) {
      sites.push({ x: cx, z: cz, kind, n: placed });
      zones.push({ x: cx, z: cz, ax, az: azz, hl: L * 0.5 + 0.25, hw: W * 0.5 + 0.25, R2: (L * 0.5 + 0.3) ** 2, color: WASH[kind], k: Math.min(1, 0.55 + placed * 0.05) });
      flowerPatches.push({ x: cx, y: getHeight(cx, cz) + 0.25, z: cz, r: Math.max(L, W) * 0.5, kind });
      stats.sites++;
      stats.cushions += placed;
    }
    return placed;
  };
  const pick = (mix, avoidKind) => {
    let k = pickWeighted(rng, mix);
    if (k === avoidKind) k = pickWeighted(rng, mix);
    return k;
  };
  // (phones: as many drifts, fewer and bigger cushions in each)
  const ck = Math.pow(Math.min(1, density), 0.6);
  const count = (a, b) => Math.max(3, Math.round(rng.int(a, b) * ck));
  // (the open glen is seen from afar: its drifts a touch bigger)
  const sizeAt = (x, z) => (Math.hypot(x, z) < 22 ? 1.25 : 1) * (1 + 0.25 * (1 - dk));

  // ── 1. along the paths' edges ──
  for (const p of pathPolylines) {
    const pts = p.pts;
    let s = 0, next = rng.range(1.5, 3), last = null, side = rng.chance(0.5) ? 1 : -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i];
      s += Math.hypot(b.x - a.x, b.z - a.z);
      if (s < next) continue;
      next = s + rng.range(2.8, 4.4);
      const c = pts[i + 1];
      let tx = c.x - a.x, tz = c.z - a.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      side = rng.chance(0.7) ? -side : side;
      const off = p.halfWidth * rng.range(1.55, 1.95) + 0.3;
      const x = b.x - tz * off * side, z = b.z + tx * off * side;
      if (oakDist(x, z) < 10 || near(x, z, 2.2) || !canGrow(x, z, { path: 1.2 }) || !inShot(x, getHeight(x, z) + 0.2, z, 0.5)) continue;
      const kind = pick(MIX.path, last);
      if (drift(x, z, Math.atan2(tx, tz), rng.range(1.8, 3.0), rng.range(0.55, 0.85), kind, count(7, 11), sizeAt(x, z))) last = kind;
    }
  }

  // ── 2. at the houses' feet (just outside their dressed rings) ──
  const housePads = PADS.filter((p) => !['oak', 'door', 'bridgeW', 'bridgeE'].includes(p.id));
  const shrubs = [];
  for (const p of housePads) {
    let made = 0, last = null;
    const a0 = rng.range(0, TAU);
    for (let k = 0; k < 10 && made < (p.r > 3 ? 3 : 2); k++) {
      const a = a0 + (k / 10) * TAU * 1.0 + rng.jitter(0.2);
      let x = 0, z = 0, ok = false;
      for (let d = p.r; d < p.r + 3.5; d += 0.2) {
        x = p.x + Math.sin(a) * d;
        z = p.z + Math.cos(a) * d;
        const pc = padClearance(x, z);
        if (pc > 0.3 && pc < 1.2) {
          ok = true;
          break;
        }
      }
      if (!ok || near(x, z, 2.2) || !canGrow(x, z, { path: 1.2 }) || !inShot(x, getHeight(x, z) + 0.2, z, 0.5)) continue;
      const kind = pick(MIX.house, last);
      // (hugging the wall: the drift runs round the house)
      if (drift(x, z, a + Math.PI / 2, rng.range(1.6, 2.6), rng.range(0.6, 0.9), kind, count(7, 10), sizeAt(x, z))) {
        last = kind;
        made++;
      }
    }
  }

  // ── 3. accent shrubs: hydrangeas by the cottages and in the wedge between
  //       the Schreinerei and the bridge path ──
  const shrubB = new GeoBuilder();
  {
    const srng = createRng('vegetation:hydrangeas');
    const want = [
      { at: PADS.find((p) => p.id === 'home'), n: 2, hues: ['blue', 'pink'] },
      { at: PADS.find((p) => p.id === 'atelier'), n: 1, hues: ['white', 'blue'] },
      { at: PADS.find((p) => p.id === 'shed'), n: 1, hues: ['pink'] },
      // (the deck's ring, the bridge path and the oak's roots fill the wedge
      //  behind the bridge path: the low shrubs stand in the lawn in front of it)
      { box: [2, 9, 0.5, 12.5], n: 2, hues: ['blue', 'pink'] },
    ];
    for (const w of want) {
      let made = 0;
      for (let k = 0; k < 40 && made < w.n; k++) {
        let x, z;
        if (w.at) {
          const a = srng.range(0, TAU);
          let found = false;
          for (let d = w.at.r; d < w.at.r + 3; d += 0.2) {
            x = w.at.x + Math.sin(a) * d;
            z = w.at.z + Math.cos(a) * d;
            const pc = padClearance(x, z);
            if (pc > 0.55 && pc < 1.5) {
              found = true;
              break;
            }
          }
          if (!found) continue;
        } else {
          x = srng.range(w.box[0], w.box[1]);
          z = srng.range(w.box[2], w.box[3]);
        }
        // (in the open wedge a LOW shrub, knee-high, that keeps out of the subjects only)
        const low = !w.at;
        const s = low ? srng.range(0.68, 0.85) : srng.range(0.95, 1.3);
        const R = 0.6 * s;
        if (!canGrow(x, z, { margin: R * 0.6, path: 1.25 }) || occ.clearance(x, z, 3) < R * 0.6) continue;
        if (shrubs.some((o) => Math.hypot(o.x - x, o.z - z) < 2.2) || cameraClearance(x, z) < 2.5) continue;
        const y = getHeight(x, z);
        const clear = low ? isClearOfSubjects(x, y, z, 1.05 * s, R, ['glen']) : isClearOfViews(x, y, z, 1.05 * s, R);
        if (!clear || !inShot(x, y + 0.5, z, 0.6)) continue;
        hydrangea(shrubB, srng, x, y - 0.02, z, s, w.hues[made % w.hues.length], { lite });
        shrubs.push({ x, z });
        (stats.shrubs ??= []).push([+x.toFixed(1), +z.toFixed(1)]);
        occ.add(x, z, R, 'shrub');
        cover.push({ x, z, r: R });
        flowerPatches.push({ x, y: y + 0.8 * s, z, r: R, kind: 'hydrangea' });
        made++;
        stats.hydrangeas++;
        // a drift of anemones or forget-me-nots tucked in front of it
        drift(x + srng.jitter(0.6), z + R + 0.5, srng.range(0, TAU), 1.8, 0.7, srng.chance(0.5) ? 'anemone' : 'forgetMeNot', count(4, 6), sizeAt(x, z));
      }
    }
  }

  // ── 4. the lawn wedges between the paths ──
  {
    const cands = [];
    for (let z = -1; z < 25; z += 1.3) {
      for (let x = -17; x < 15; x += 1.3) {
        const px = x + rng.range(0, 1.3), pz = z + rng.range(0, 1.3);
        if (getPathDistance(px, pz) < 2.6 || oakDist(px, pz) < 10.5 || padClearance(px, pz) < 0.8) continue;
        if (!canGrow(px, pz, { margin: 0.6 }) || !ringClear(px, pz, 1.2)) continue;
        if (!inShot(px, getHeight(px, pz) + 0.2, pz, 0.5)) continue;
        // (the Schreinerei / bridge-path wedge is always dressed)
        const wedge = px > 2 && px < 9 && pz > 0.5 && pz < 7.5 ? 0.5 : 0;
        cands.push({ x: px, z: pz, score: fieldAlt(px, pz) + wedge + rng.range(0, 0.15) });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    let made = 0, last = null;
    const want = Math.round(11 * Math.max(0.7, dk));
    for (const c of cands) {
      if (made >= want) break;
      if (near(c.x, c.z, 3.2)) continue;
      const kind = pick(MIX.wedge, last);
      if (drift(c.x, c.z, rng.range(0, TAU), rng.range(2.2, 3.4), rng.range(0.9, 1.4), kind, count(9, 14), sizeAt(c.x, c.z))) {
        last = kind;
        made++;
      }
    }
  }

  // ── 5. the signpost at the path fork ──
  const objects = [];
  {
    // (the Schreinerei's wide shot looks across the fork: the sign may stand
    //  at its side — never in front of the porch)
    const ww = SPOTS.find((p) => p.id === 'woodworking');
    const wide = new THREE.PerspectiveCamera(ww?.camera.fov ?? 40, 16 / 9, 0.1, 200);
    if (ww) {
      const P = ww.camera.position, T = ww.camera.target;
      wide.position.set(T[0] + (P[0] - T[0]) * 1.8, T[1] + (P[1] - T[1]) * 1.8, T[2] + (P[2] - T[2]) * 1.8);
      wide.lookAt(T[0], T[1], T[2]);
      wide.updateMatrixWorld(true);
      wide.updateProjectionMatrix();
    }
    const _v = new THREE.Vector3();
    // (at the frame's side, where a blurred foreground post reads as framing —
    //  in the lower middle it was a dark stick across the lawn)
    const lowInWide = (x, y, z) => {
      _v.set(x, y + 0.8, z).project(wide);
      return Math.abs(_v.x) > 0.6;
    };
    let best = null;
    for (let r = 1.8; r < 6.6; r += 0.3) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * TAU;
        const x = FORK.x + Math.sin(a) * r, z = FORK.z + Math.cos(a) * r;
        if (getPathDistance(x, z) < 1.4 || !canGrow(x, z, { margin: 0.3, path: 1.3 }) || !ringClear(x, z, 0.8)) continue;
        if (cameraClearance(x, z) < 2.2 || occ.clearance(x, z, 2) < 0.3) continue;
        const y = getHeight(x, z);
        // (the overview may see it — that is the point — every other shot keeps clear)
        let blocked = false;
        const lowWide = lowInWide(x, y, z);
        for (let h = 0.2; h < 1.7 && !blocked; h += 0.45) blocked = viewsBlocking(x, y + h, z, 0.4).some((id) => id !== 'glen' && id !== 'overview' && !(id === 'woodworking-wide' && lowWide));
        if (blocked || !inShot(x, y + 1, z, 0.3)) continue;
        // (closest to the fork wins; the front, where the glen's camera sees it, a little preferred)
        const score = r - (z > FORK.z ? 0.4 : 0);
        if (!best || score < best.score) best = { x, z, y, score };
      }
    }
    if (best && ctx.props?.makeSignpost) {
      const target = (s) => SPOTS.find((p) => p.id === s)?.focus ?? [0, 0, 0];
      const head = (t) => Math.atan2(t[0] - best.x, t[2] - best.z);
      const sign = ctx.props.makeSignpost([
        { text: 'Schreinerei', angle: head(target('woodworking')) },
        { text: 'Velowerkstatt', angle: head(target('bikes')) },
        { text: 'Cottage', angle: head(target('home')) },
      ], { seed: 'glen-fork', length: 1.25, cap: 'roof' });
      sign.name = 'fork-signpost';
      sign.scale.setScalar(0.58);
      sign.position.set(best.x, best.y - 0.05, best.z);
      sign.rotation.set(0, 0, 0.03);
      sign.updateMatrixWorld(true);
      objects.push(sign);
      occ.add(best.x, best.z, 0.35, 'signpost');
      cover.push({ x: best.x, z: best.z, r: 0.4 });
      stats.signpost = [+best.x.toFixed(2), +best.z.toFixed(2)];
      // buttercups and forget-me-nots at its foot
      drift(best.x, best.z, rng.range(0, TAU), 1.3, 1.0, rng.chance(0.5) ? 'buttercup' : 'forgetMeNot', count(6, 9), 1);
    }
  }

  // ── 6. ochre & russet leaf drifts on the lawns (into litter's leaf mesh) ──
  const leaves = [];
  {
    const lrng = createRng('vegetation:leaf-drifts');
    const nrm = new THREE.Vector3();
    const gp = {};
    const centres = [];
    const want = Math.round(16 * Math.max(0.4, dk));
    for (let k = 0; k < 600 && centres.length < want; k++) {
      const x = lrng.range(-22, 20), z = lrng.range(-4, 30);
      if (Math.hypot(x, z) > 30 || oakDist(x, z) < 10) continue;
      groundPatches(x, z, gp);
      const pd = getPathDistance(x, z);
      // in the floor's own litter drifts, against the path edges, now and then anywhere
      const w = gp.drift * 1.2 + (pd > 1.4 && pd < 2.6 ? 0.35 : 0) + 0.08 - gp.cushion * 0.5;
      if (!lrng.chance(w)) continue;
      if (!canGrow(x, z, { path: 1.05 }) || centres.some((c) => Math.hypot(c.x - x, c.z - z) < 3)) continue;
      if (!inShot(x, getHeight(x, z), z, 0.6)) continue;
      centres.push({ x, z });
    }
    // (wind-blown streaks along the floor drifts' own axis)
    const wa = Math.atan2(0.8, 0.6);
    for (const c of centres) {
      const L = lrng.range(1.6, 3.0), W = lrng.range(0.6, 1.1);
      const az = wa + lrng.jitter(0.5);
      const ax = Math.sin(az), azz = Math.cos(az);
      const n = Math.round(lrng.int(70, 130) * dk);
      const tones = [lrng.pick(LEAF_TONES), lrng.pick(LEAF_TONES), lrng.pick(LEAF_TONES)];
      let made = 0;
      for (let i = 0; i < n; i++) {
        const a = lrng.range(0, TAU), d = Math.pow(lrng.next(), 0.7);
        const u = Math.cos(a) * d * L * 0.5, v = Math.sin(a) * d * W * 0.5;
        const x = c.x + ax * u + azz * v, z = c.z + azz * u - ax * v;
        if (!canGrow(x, z, { path: 0.9 }) || !ringClear(x, z, 0.1)) continue;
        getNormal(x, z, nrm);
        leaves.push({
          x,
          y: getHeight(x, z) + 0.006 + (1 - d) * 0.012 * lrng.next(),
          z,
          ry: lrng.range(0, TAU),
          tx: lrng.jitter(0.3) - nrm.z * 0.6,
          tz: lrng.jitter(0.3) + nrm.x * 0.6,
          s: lrng.range(1.3, 2.1),
          color: new THREE.Color(lrng.pick(tones)).offsetHSL(lrng.jitter(0.015), lrng.jitter(0.06), lrng.jitter(0.06)),
        });
        made++;
      }
      if (made) stats.leafDrifts++;
    }
    stats.leaves = leaves.length;
  }

  // ── meshes ──
  const meshes = [];
  const bRng = createRng('vegetation:bloom-templates');
  for (const kind of BLOOM_KINDS) {
    if (!items[kind].length) continue;
    meshes.push(instanced(`blooms-${kind}`, bloomTemplate(kind, bRng, { lite }), flowerMat, items[kind], { cast: false }));
  }
  if (shrubB.count) meshes.push(staticMesh('hydrangeas', shrubB.build(), leafMat, { cast: false, receive: true }));
  stats.ms = Math.round(performance.now() - t0);
  stats.list = sites.map((q) => `${q.kind}@${q.x.toFixed(1)},${q.z.toFixed(1)}×${q.n}`);
  return { meshes: meshes.filter(Boolean), objects, cover, flowerPatches, leaves, zones, stats };
}
