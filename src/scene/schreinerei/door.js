// ─────────────────────────────────────────────────────────────────────────────
// The workshop door in the Great Oak (OAK.door).
//
// A big round-arched plank door, slightly ajar with warm light spilling out,
// set in a carved oak frame (bent arch segments, pegs, a keystone with the
// cabinetmakers' guild emblem). The bark has grown around the frame into a
// thick burl collar, two fissured roots — moss only along their top ridge,
// ferns, ivy and toadstools on them — flank worn stone steps. Forged strap
// hinges, a ring pull, a bullseye window, a lantern on a scroll bracket, the
// carved "Schreinerei" sign swinging above and the framed EFZ certificate
// under its own little roof (hotspot 'efz-certificate'). Through the gap a
// real little stair hall, lit by a candle: oak winder treads climbing round a
// turned newel with a rope handrail, a shelf of jars, a try-square on a peg.
// The steps up to it are single worn field stones, moss in their joints.
//
// The frame stands DOOR.z proud of the bark; the oak builder carves a niche
// behind it (scene/oak/shape.js DOOR_NICHE, ~0.95 behind the frame face) and
// rolls its own bark lip around it. Our burl collar reaches ~1 unit into the
// trunk so the two always blend; the stair hall fills the niche, inside the
// frame's 0.9-deep jambs and arch, and its far wall closes it at 0.86.
// Things on the bark (lantern bracket, sign brackets, certificate) are placed
// with barkMount(), which follows the sculpted bark when ctx.oak provides it.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OAK, oakRadiusAt } from '../../world/layout.js';
import { createRng } from '../../core/rng.js';
import { Batch, board, uvBox, xf, deform, mat4, mossGeo, mossPadGeo, tube, archShape, arcSegment, addIvy, addToadstool, addFern, addLantern, pushHalo, peg, noiseA, noiseB, turned, LOD, segs } from './kit.js';

/** Door dimensions (exported so others can align to it). */
export const DOOR = {
  sill: 0.36, // threshold height (two steps up)
  width: 1.2, // clear opening
  straight: 1.12, // straight jamb height above the sill
  frame: 0.17, // frame face width
  /** z of the frame front face (world). Proud of the bark so the lit niche is never swallowed. */
  z: OAK.door.z + 0.47,
  ajar: 0.7, // radians the leaf stands open (outwards, hinged left): a warm wedge of the lit inside shows
};

const IRON = '#2f2b28';

/**
 * Build the door. Static parts go into `B` (world-space Batch).
 * Returns { group, hotspots: [...], update(dt, t), anchors }.
 */
export function buildDoor(ctx, B, mats) {
  const rng = createRng('oak-door');
  const { props } = ctx;
  const group = new THREE.Group();
  group.name = 'oak-door';
  ctx.scene.add(group);

  const W = DOOR.width, R = W / 2, Hs = DOOR.straight, y0 = DOOR.sill, F = DOOR.frame;
  const archY = y0 + Hs; // centre of the arch
  const topY = archY + R; // top of the opening
  // Local frame D: origin on the ground under the door centre at the frame front plane.
  const D = B.at(mat4([OAK.door.x, 0, DOOR.z], [0, OAK.door.rotY ?? 0, 0]));
  const oak = mats.wood('oak');
  const oakDark = mats.wood('walnut');
  const iron = mats.metal(IRON);
  // (triangles each part adds to the shared batch — ctx.sites.schreinerei.door.cost)
  const cost = {};
  let costMark = B.added;
  const mark = (name) => {
    cost[name] = Math.round(B.added - costMark);
    costMark = B.added;
  };

  // ── frame: two jambs, five bent arch segments, a keystone, the sill ────────
  for (const s of [-1, 1]) {
    const jamb = board(F, Hs + 0.02, 0.9, { along: 'y', r: 0.025, rng });
    D.add(oak, xf(jamb, [s * (R + F / 2), y0 + Hs / 2, -0.43]));
    // chamfer stop & carved rosette at the jamb foot
    const ros = new THREE.CylinderGeometry(0.045, 0.05, 0.03, 10);
    ros.rotateX(Math.PI / 2);
    D.add(oakDark, xf(uvBox(ros, 'y'), [s * (R + F / 2), y0 + 0.22, 0.028]), { cast: false });
    for (let k = 0; k < 6; k++) {
      const petal = new THREE.SphereGeometry(0.018, 5, 4);
      const a = (k / 6) * Math.PI * 2;
      D.add(oak, xf(petal, [s * (R + F / 2) + Math.cos(a) * 0.04, y0 + 0.22 + Math.sin(a) * 0.04, 0.03], null, [1, 1, 0.5]), { cast: false });
    }
    // pegs holding the jamb to the sill & arch
    for (const py of [y0 + 0.08, y0 + Hs - 0.08]) D.add(oakDark, xf(peg(0.016), [s * (R + F / 2), py, 0.02]), { cast: false });
  }
  const nSeg = 5;
  for (let i = 0; i < nSeg; i++) {
    const a0 = (i / nSeg) * Math.PI + 0.002, a1 = ((i + 1) / nSeg) * Math.PI - 0.002;
    const seg = arcSegment(R, R + F, a0, a1, 0.9, 8);
    uvBox(seg, 'x', undefined, [rng.next() * 5, rng.next() * 5]);
    D.add(oak, xf(seg, [0, archY, -0.43]));
    // joint pegs
    const am = a1 + 0.004;
    if (i < nSeg - 1) D.add(oakDark, xf(peg(0.015), [Math.cos(am) * (R + F / 2), archY + Math.sin(am) * (R + F / 2), 0.02]), { cast: false });
  }
  // keystone with the guild emblem (square & dividers on a shield)
  {
    const ks = board(0.24, 0.3, 0.12, { along: 'y', r: 0.02, rng });
    D.add(oak, xf(ks, [0, topY + F * 0.45, 0.0]));
    const shield = new THREE.Shape();
    shield.moveTo(-0.075, 0.08);
    shield.lineTo(0.075, 0.08);
    shield.lineTo(0.075, -0.01);
    shield.quadraticCurveTo(0.07, -0.07, 0, -0.1);
    shield.quadraticCurveTo(-0.07, -0.07, -0.075, -0.01);
    shield.lineTo(-0.075, 0.08);
    const sg = new THREE.ExtrudeGeometry(shield, { depth: 0.02, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1 });
    uvBox(sg, 'y');
    D.add(oakDark, xf(sg, [0, topY + F * 0.45, 0.06]), { cast: false });
    // crossed square (Winkel) and dividers (Zirkel) in brass
    const brass = mats.metal('#b8893a');
    const sq1 = new THREE.BoxGeometry(0.11, 0.016, 0.01);
    const sq2 = new THREE.BoxGeometry(0.016, 0.07, 0.01);
    D.add(brass, xf(sq1, [0, -0.025, 0], [0, 0, 0.6]).translate(0, topY + F * 0.45, 0.092), { cast: false });
    D.add(brass, xf(sq2, [0.045, 0.0, 0], [0, 0, 0.6]).translate(0, topY + F * 0.45, 0.092), { cast: false });
    for (const s of [-1, 1]) {
      const leg = new THREE.BoxGeometry(0.01, 0.12, 0.01);
      D.add(brass, xf(leg, [s * 0.022, 0.0, 0], [0, 0, s * 0.35]).translate(0, topY + F * 0.45, 0.094), { cast: false });
    }
    D.add(brass, xf(new THREE.SphereGeometry(0.012, 6, 4), [0, topY + F * 0.45 + 0.06, 0.094]), { cast: false });
  }
  // oak threshold (worn in the middle)
  {
    const th = board(W + F * 2 + 0.1, 0.09, 0.5, { along: 'x', r: 0.02, rng });
    deform(th, (v) => {
      if (v.y > 0) v.y -= 0.018 * Math.exp(-(v.x * v.x) / 0.08);
    });
    D.add(oak, xf(th, [0, y0 - 0.045, -0.2]));
  }

  mark('frame');
  // ── the lit stair hall behind the door ─────────────────────────────────────
  // The oak builder carves its niche ~0.95 behind the frame face and the
  // frame's jambs & arch (0.9 deep) line its sides, so there is a real little
  // room in there: plank reveals, an oak floor, the first turns of a spiral
  // stair winding up round a turned newel with a rope handrail, a shelf of
  // jars and a try-square on a peg on the back wall, a candle sconce. Only the
  // far wall is still a painted card (the warm gradient and the lamp's glow).
  const nicheDepth = 0.86;
  const room = buildNicheRoom(D, mats, rng, { R, y0, archY, depth: nicheDepth });
  pushHalo(room.sconce.clone().applyMatrix4(D.matrix), 0.26);
  // the far wall: a painted, softly glowing card (lamp-lit planks)
  const glimpse = makeGlimpseMaterial();
  {
    const shape = archShape(W - 0.06, Hs, { y: 0 });
    const g = new THREE.ShapeGeometry(shape, 12);
    // UV 0..1 over the opening
    const pos = g.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i) / (W - 0.06) + 0.5;
      uv[i * 2 + 1] = pos.getY(i) / (Hs + R);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, glimpse);
    m.position.set(OAK.door.x, y0, DOOR.z - nicheDepth - 0.005);
    m.name = 'door-glimpse';
    m.castShadow = false;
    group.add(m);
  }

  mark('room');
  // ── the door leaf: 6 V-grooved boards, ledges & brace, strap hinges ──────
  // Boards of slightly different widths and tones (real stock), chamfered
  // where they meet so each joint reads as a V-groove, nailed to the ledges
  // and the brace from the front and clinched over on the back.
  const leaf = new Batch();
  const LW = W + 0.06, LR = LW / 2, LT = 0.065;
  const leafBottom = y0 + 0.012;
  const nPl = 6;
  const leafTop = (x) => archY + Math.sqrt(Math.max(0, LR * LR - x * x));
  const bw = [];
  for (let i = 0; i < nPl; i++) bw.push(1 + rng.jitter(0.13));
  const bwSum = bw.reduce((a, b) => a + b, 0);
  const boardX = []; // [x0, x1] of each board
  {
    const tones = ['#a77a52', '#966c47', '#a07450', '#8f6643', '#a87d55', '#9a6f4a'];
    let xa = -LR;
    for (let i = 0; i < nPl; i++) {
      const pw = (bw[i] / bwSum) * LW;
      const x0 = xa + 0.003, x1 = xa + pw - 0.003;
      boardX.push([xa, xa + pw]);
      xa += pw;
      const s = new THREE.Shape();
      s.moveTo(x0, leafBottom);
      s.lineTo(x1, leafBottom);
      const steps = 6;
      for (let k = 0; k <= steps; k++) {
        const x = x1 + ((x0 - x1) * k) / steps;
        s.lineTo(x, leafTop(x) - 0.002);
      }
      s.lineTo(x0, leafBottom);
      // the deep chamfers of neighbouring boards meet in a V
      const g = new THREE.ExtrudeGeometry(s, { depth: LT, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.01, bevelSegments: 1, curveSegments: 2 });
      // a little warp per plank
      const wob = rng.jitter(0.006);
      deform(g, (v) => {
        v.z += wob * Math.sin(((v.y - y0) / (Hs + R)) * Math.PI);
      });
      uvBox(g, 'y', undefined, [rng.next() * 9, rng.next() * 9]);
      leaf.add(oak, g, { color: tones[i] });
    }
  }
  // hand-forged nails: two per board through each ledge and one through the
  // brace (heads on the front), their tips clinched over on the back
  {
    const ly0 = leafBottom + 0.175, ly1 = archY - 0.05;
    const bl0 = leafBottom + 0.22, bl1 = archY - 0.05;
    const braceY = (x) => (bl0 + bl1) / 2 + (x / (LW - 0.2)) * (bl1 - bl0);
    const nail = (x, y) => {
      const head = new THREE.SphereGeometry(0.0085, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2);
      head.rotateX(Math.PI / 2);
      leaf.add(iron, xf(head, [x + rng.jitter(0.004), y + rng.jitter(0.004), LT + 0.009]), { cast: false });
      // (the clinched tips on the back: only where a close-up could catch them)
      if (LOD.small) {
        const tip = new THREE.TorusGeometry(0.008, 0.0022, 3, 6, Math.PI);
        leaf.add(iron, xf(tip, [x, y, -0.04], [0, Math.PI / 2, rng.next() < 0.5 ? 0 : Math.PI]), { cast: false });
      }
    };
    for (const [xa, xb] of boardX) {
      const xc = (xa + xb) / 2, q = (xb - xa) * 0.26;
      for (const y of [ly0, ly1]) for (const x of [xc - q, xc + q]) nail(x, y);
      if (Math.abs(xc) < LR - 0.12) nail(xc, braceY(xc));
    }
  }
  // inside ledges + a diagonal brace (Z), hidden mostly but honest: the brace
  // rises from the hinge side (−x) at the bottom ledge to the latch side at the
  // top ledge, so it works in compression and the leaf cannot sag
  for (const ly of [leafBottom + 0.22, archY - 0.05]) leaf.add(oak, xf(board(LW - 0.12, 0.12, 0.035, { along: 'x', rng }), [0, ly, -0.02]));
  {
    const len = Math.hypot(LW - 0.2, archY - 0.05 - (leafBottom + 0.22));
    const ang = Math.atan2(archY - 0.05 - (leafBottom + 0.22), LW - 0.2);
    leaf.add(oak, xf(board(len, 0.1, 0.03, { along: 'x', rng }), [0, (archY - 0.05 + leafBottom + 0.22) / 2, -0.02], [0, 0, ang]));
  }
  // strap hinges (front), with fleur ends and nail heads
  const hingeYs = [leafBottom + 0.25, leafBottom + 0.95, archY + 0.25];
  hingeYs.forEach((hy, i) => {
    const len = i === 2 ? LW * 0.62 : LW * 0.8;
    const strap = new THREE.BoxGeometry(len, 0.05, 0.012);
    deform(strap, (v) => {
      const t = (v.x + len / 2) / len;
      v.y *= 1 - t * 0.45; // tapering
    });
    leaf.add(iron, xf(strap, [-LR + len / 2, hy, LT + 0.012]), { cast: false });
    // fleur-de-lis-ish end: a diamond + two curls
    const tip = new THREE.CylinderGeometry(0.045, 0.045, 0.012, 4);
    tip.rotateX(Math.PI / 2);
    leaf.add(iron, xf(tip, [-LR + len + 0.015, hy, LT + 0.012], null, [0.75, 1, 1]), { cast: false });
    for (const s of [-1, 1]) {
      const curl = new THREE.TorusGeometry(0.022, 0.007, 4, 10, Math.PI * 1.3);
      leaf.add(iron, xf(curl, [-LR + len - 0.04, hy + s * 0.035, LT + 0.012], [0, 0, s > 0 ? -0.4 : Math.PI + 0.4]), { cast: false });
    }
    // knuckle on the hinge side
    const knuckle = new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8);
    leaf.add(iron, xf(knuckle, [-LR - 0.012, hy, LT * 0.5]), { cast: false });
    for (let k = 0; k < 4; k++) {
      const nail = new THREE.SphereGeometry(0.011, 5, 3, 0, Math.PI * 2, 0, Math.PI / 2);
      nail.rotateX(Math.PI / 2);
      leaf.add(iron, xf(nail, [-LR + 0.06 + (k / 3) * (len - 0.12), hy, LT + 0.018]), { cast: false });
    }
  });
  // ring pull on a round back plate + keyhole
  {
    const px = LR - 0.17, py = leafBottom + 0.95;
    const plate = new THREE.CylinderGeometry(0.055, 0.055, 0.012, 12);
    plate.rotateX(Math.PI / 2);
    leaf.add(iron, xf(plate, [px, py, LT + 0.01]), { cast: false });
    const ring = new THREE.TorusGeometry(0.07, 0.011, 6, 18);
    leaf.add(iron, xf(ring, [px, py - 0.075, LT + 0.032], [0.35, 0, 0]), { cast: false });
    const kh = new THREE.BoxGeometry(0.05, 0.08, 0.008);
    leaf.add(iron, xf(kh, [px, py - 0.2, LT + 0.006]), { cast: false });
    leaf.add(iron, xf(new THREE.BoxGeometry(0.012, 0.03, 0.004), [px, py - 0.205, LT + 0.012]), { color: '#0d0a08', cast: false });
  }
  // bullseye window with a cross muntin (glows)
  {
    const wy = archY + 0.12, wr = 0.12;
    const rim = new THREE.TorusGeometry(wr, 0.022, 6, 20);
    leaf.add(oakDark, xf(uvBox(rim, 'y'), [0, wy, LT + 0.01]), { cast: false });
    const glass = new THREE.CircleGeometry(wr, 18);
    leaf.add(mats.glow('#ffc66b', 0.5, 2.6), xf(glass, [0, wy, LT - 0.01]), { cast: false });
    leaf.add(oakDark, xf(new THREE.BoxGeometry(wr * 2, 0.02, 0.02), [0, wy, LT]), { cast: false });
    leaf.add(oakDark, xf(new THREE.BoxGeometry(0.02, wr * 2, 0.02), [0, wy, LT]), { cast: false });
  }
  // the leaf stands still (ajar): bake its hinge transform and merge it into
  // the shared batch
  {
    const hingeM = mat4([OAK.door.x - LR - 0.012, 0, DOOR.z + 0.04], [0, -DOOR.ajar, 0]).multiply(mat4([LR + 0.012, 0, 0]));
    for (const e of leaf.lists.values()) for (const g of e.geos) B.add(e.material, g.applyMatrix4(hingeM), { cast: e.cast });
    leaf.lists.clear();
  }

  mark('leaf');
  // ── bark collar: the trunk has grown around the frame ──────────────────────
  {
    const outer = R + F + 0.42;
    const inner = R + F + 0.06; // the bevel rolls the bark inwards over the frame's outer edge
    const s = new THREE.Shape();
    const bottom = -0.02;
    s.moveTo(-outer - 0.25, bottom);
    s.lineTo(-outer, archY - 0.1);
    s.absarc(0, archY, outer, Math.PI, 0, true);
    s.lineTo(outer + 0.25, bottom);
    s.lineTo(inner, bottom);
    s.lineTo(inner, archY);
    s.absarc(0, archY, inner, 0, Math.PI, false);
    s.lineTo(-inner, bottom);
    s.lineTo(-outer - 0.25, bottom);
    const depth = 1.05;
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.16, bevelThickness: 0.2, bevelSegments: 3, curveSegments: 22, steps: 3 });
    g.translate(0, 0, -depth - 0.08);
    g.deleteAttribute('uv');
    const ox = rng.next() * 30;
    deform(g, (v) => {
      // bark ridges running roughly radially/up + lumps; the lip swells forward at the top
      const r = Math.hypot(v.x, v.y - archY);
      const ang = Math.atan2(v.y - archY, v.x);
      const front = THREE.MathUtils.smoothstep(v.z, -0.7, 0.1);
      const ridge = Math.abs(noiseA(ang * 3.2 + ox, r * 1.5)) * 0.09 + noiseB(v.x * 3 + ox, v.y * 3) * 0.05;
      v.z += ridge * front + front * 0.06 * Math.max(0, v.y - archY);
      v.x += noiseB(v.y * 2.1 + ox, v.z * 2) * 0.05;
      v.y += noiseA(v.x * 2.4, v.z * 2.4 + ox) * 0.04;
      // lean the whole collar back with the taper of the trunk
      v.z -= Math.max(0, v.y) * 0.06;
    });
    uvBox(g, 'y', 1.2);
    D.add(mats.bark(), g);
    // moss on the collar's shoulders and top
    for (let i = 0; i < 16; i++) {
      const a = rng.range(0.15, Math.PI - 0.15);
      const rr = (inner + outer) / 2 + rng.jitter(0.12);
      const x = Math.cos(a) * rr, y = archY + Math.sin(a) * rr;
      const m = mossGeo(rng, { r: rng.range(0.1, 0.2), h: rng.range(0.04, 0.08) });
      D.add(mats.moss(), xf(m, [x, y + 0.02, -0.12 - y * 0.12 + rng.jitter(0.08)], [rng.jitter(0.3) - 0.35, rng.next() * 6, rng.jitter(0.3)]), { cast: false });
    }
  }

  mark('collar');
  // ── two roots flanking the steps ───────────────────────────────────────────
  // Fissured bark with moss only along the top ridge (mossy 0.22: the bark
  // reads through and nothing competes with the lit door), dark vertex-colour
  // AO in the furrows, underneath and where they dive into the soil; each
  // carries a fern, an ivy runner and a toadstool cluster.
  const rootMat = rootBarkMaterial(ctx);
  for (const s of [-1, 1]) {
    const pts = [];
    const x0 = s * (R + F + 0.5);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push([x0 + s * t * 0.75 + Math.sin(t * 5 + s) * 0.06, (1 - t) * 1.05 + Math.sin(t * Math.PI) * 0.1, -0.55 + t * 1.55]);
    }
    const { geo, curve, radiusAt } = rootGeo(rng, pts, { r0: 0.34, r1: 0.1, flat: 0.75 });
    D.add(rootMat, geo);
    const c = new THREE.Vector3(), T = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0), S = new THREE.Vector3(), N = new THREE.Vector3();
    const frame = (t) => {
      curve.getPointAt(t, c);
      curve.getTangentAt(t, T);
      S.crossVectors(T, Y).normalize();
      N.crossVectors(S, T).normalize();
      return radiusAt(t);
    };
    // a toadstool cluster growing out of the root's outer flank
    {
      frame(0.5);
      const side = S.clone().multiplyScalar(Math.sign(S.x) === s ? 1 : -1);
      for (let i = 0; i < 4; i++) {
        const t = 0.44 + i * 0.05 + rng.jitter(0.02);
        const rr = frame(t);
        const p = c.clone().addScaledVector(side, rr * 0.62).addScaledVector(N, rr * 0.42 * 0.75);
        addToadstool(D, mats, rng, p.x, p.y - 0.02, p.z, { size: rng.range(0.045, 0.075), color: i % 3 ? '#b98a4e' : '#c9352a', lean: 0.25 });
      }
    }
    // a fern where the root leaves the bark, another at its foot
    frame(0.12);
    addFern(D, ctx, rng, c.x + s * 0.18, c.y - 0.25, c.z + 0.12, { size: 0.36, fronds: 6 });
    frame(0.9);
    addFern(D, ctx, rng, c.x + s * 0.22, 0, c.z + 0.08, { size: 0.32, fronds: 5 });
    // an ivy runner along the top ridge
    {
      const r = frame(0.22);
      const start = c.clone().addScaledVector(N, r * 0.78);
      addIvy(D, mats, rng, [start.x, start.y, start.z], [T.x, T.y, T.z], { length: 0.75, droop: 0.15, size: 0.055, normal: [N.x, N.y, N.z], density: 0.8 });
    }
    // a couple of toadstools nestled at the root's foot
    for (let i = 0; i < 3; i++) {
      addToadstool(D, mats, rng, x0 + s * (0.75 + rng.range(0.1, 0.4)), 0, 0.9 + rng.jitter(0.3), { size: rng.range(0.07, 0.13) });
    }
  }

  mark('roots');
  // ── glowing toadstools at the roots' feet (they wake up at night) ─────────
  {
    const glowCap = ctx.materials.glow('#8af0d8', { day: 0.12, night: 1.5 });
    const stem = mats.vc();
    const clusters = [[-(R + F + 1.05), 0.95], [R + F + 1.15, 0.75], [-(R + F + 0.35), 1.15], [R + F + 0.62, -0.05]];
    for (const [cx, cz] of clusters) {
      const n = rng.int(3, 6);
      for (let i = 0; i < n; i++) {
        const x = cx + rng.jitter(0.16), z = cz + rng.jitter(0.12);
        const hgt = rng.range(0.05, 0.13), cr = hgt * rng.range(0.32, 0.5);
        const tilt = [rng.jitter(0.25), 0, rng.jitter(0.25)];
        D.add(stem, xf(new THREE.CylinderGeometry(cr * 0.18, cr * 0.25, hgt, segs(5, 4), 1, LOD.tier === 'low'), [x, hgt / 2, z], tilt), { color: '#e9f2e6', cast: false });
        const cap = new THREE.SphereGeometry(cr, segs(8, 6), segs(4, 2), 0, Math.PI * 2, 0, Math.PI / 2);
        cap.scale(1, 0.75, 1);
        D.add(glowCap, xf(cap, [x + tilt[2] * -hgt, hgt, z + tilt[0] * hgt], tilt), { cast: false, receive: false });
      }
    }
  }

  mark('glowCaps');
  // ── a broom leaning by the door ───────────────────────────────────────────
  {
    // foot on the ground beside the steps, handle resting against the collar
    const foot = new THREE.Vector3(-(R + F + 0.62), 0.0, 0.62);
    const top = new THREE.Vector3(-(R + F + 0.42), 1.25, 0.12);
    const dir = top.clone().sub(foot).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const at = (t) => foot.clone().addScaledVector(dir, t);
    const place = (g, t) => g.applyQuaternion(q).translate(at(t).x, at(t).y, at(t).z);
    D.add(mats.wood('ash'), place(new THREE.CylinderGeometry(0.014, 0.016, 1.0, 6), 0.72));
    D.add(mats.wood('#b8964e'), place(new THREE.CylinderGeometry(0.035, 0.1, 0.3, 9, 1), 0.15));
    D.add(mats.metal('#6a4a2a'), place(new THREE.CylinderGeometry(0.037, 0.037, 0.03, 8), 0.27), { cast: false });
  }

  mark('broom');
  // ── worn stone steps up to the threshold ──────────────────────────────────
  // Individual field stones, not cast slabs: each its own width, height and
  // tone, the arrises rounded and here and there chipped, the treads dished
  // where feet have worn them (deepest on the walking line through the open
  // half of the doorway), damp and darker down their sides, moss in the
  // joints and tufts at the ends.
  {
    const stepMat = stepStoneMaterial(ctx);
    const walk = 0.18; // the walking line (x) through the open half of the doorway
    const rows = [
      { top: y0, z0: -0.04, depth: 0.52, w: W + F * 2 + 0.22, n: 3 },
      { top: y0 / 2, z0: 0.47, depth: 0.5, w: W + F * 2 + 0.72, n: 4 },
    ];
    for (const row of rows) {
      const ws = [];
      for (let i = 0; i < row.n; i++) ws.push(1 + rng.jitter(0.3));
      const sum = ws.reduce((a, b) => a + b, 0);
      let x = -row.w / 2;
      const joints = [];
      for (let i = 0; i < row.n; i++) {
        const full = (ws[i] / sum) * row.w;
        const cx = x + full / 2 + rng.jitter(0.01);
        const sw = full - 0.035 - rng.next() * 0.02;
        const h = row.top + 0.08;
        const d = row.depth + rng.jitter(0.05);
        const top = row.top + rng.jitter(0.012);
        const g = wornStone(rng, sw, h, d, { walkX: walk - cx, tone: rng.pick(STEP_TONES) });
        D.add(stepMat, xf(g, [cx, top - h / 2, row.z0 + d / 2 + rng.jitter(0.015)], [0, rng.jitter(0.05), 0]));
        x += full;
        if (i < row.n - 1) joints.push(x);
      }
      // moss in the joints and at the outer ends, a fern tuft at each end
      for (const jx of joints) {
        for (let k = 0; k < 2; k++) {
          const m = mossPadGeo(rng, { r: 0.05, h: 0.022, sx: 0.55, sz: 2.4, lobes: 1 });
          D.add(mats.moss(), xf(m, [jx + rng.jitter(0.01), row.top - 0.012, row.z0 + row.depth * (0.3 + k * 0.42)], [0, rng.jitter(0.15), 0]), { cast: false });
        }
      }
      for (const s of [-1, 1]) {
        const ex = s * (row.w / 2 + 0.02);
        D.add(mats.moss(), xf(mossPadGeo(rng, { r: 0.11, h: 0.05, sx: 0.9, sz: 1.8 }), [ex, row.top - 0.035, row.z0 + row.depth * 0.5], [0, rng.jitter(0.3), s * 0.25]), { cast: false });
      }
    }
    // a few fallen leaves on the treads (not on the walking line)
    if (LOD.small) {
      for (const [lx, lz, ly] of [[-0.62, 0.15, y0], [0.72, 0.62, y0 / 2], [-0.85, 0.75, y0 / 2]]) {
        D.add(mats.vc(), xf(new THREE.CircleGeometry(0.035, 6).scale(1, 0.6, 1), [lx, ly + 0.004, lz], [-Math.PI / 2, 0, rng.next() * 6]), { color: rng.pick(['#b8742f', '#c99a3e', '#9a5a2a']), cast: false });
      }
    }
  }

  mark('steps');
  // ── forged lantern bracket + lantern (left) ─────────────────────────────────
  const lanternPos = new THREE.Vector3();
  {
    const by = 2.05, bx = -(R + F + 0.62);
    const barkZ = barkMount(ctx, bx, by, { spreadA: 0.02, spreadY: 0.05 }).point.z;
    const arm = [[bx, by, barkZ - 0.1], [bx, by + 0.02, DOOR.z + 0.15], [bx, by - 0.02, DOOR.z + 0.42]];
    B.add(iron, tube(arm, 0.018, 5, 10), { cast: false });
    // scroll under the arm
    const scroll = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14, a = t * Math.PI * 1.7;
      const r = 0.16 * (1 - t * 0.65);
      scroll.push([bx, by - 0.04 - Math.sin(a) * r, DOOR.z + 0.05 - (1 - Math.cos(a)) * r * -1 - 0.1]);
    }
    B.add(iron, tube(scroll, 0.011, 4, 18), { cast: false });
    B.add(iron, xf(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 8), [bx, by, barkZ - 0.05], [Math.PI / 2, 0, 0]), { cast: false });
    addLantern(B, mats, [bx, by - 0.03, DOOR.z + 0.4], new THREE.Vector3(bx, by - 0.03, DOOR.z + 0.4), { scale: 1.1 });
    lanternPos.set(bx, by - 0.35, DOOR.z + 0.4);
  }

  mark('lantern');
  // ── the hanging sign above the door (two forged brackets + a rod) ──────────
  let sign = null;
  {
    const rodY = topY + 1.25;
    const rodZ = DOOR.z + 0.12;
    for (const s of [-1, 1]) {
      const bx = s * 0.72;
      const bz = barkMount(ctx, bx, rodY, { spreadA: 0.02, spreadY: 0.05 }).point.z;
      B.add(iron, tube([[bx, rodY + 0.04, bz - 0.12], [bx, rodY + 0.05, (bz + rodZ) / 2], [bx, rodY, rodZ]], 0.016, 5, 8), { cast: false });
      const sc = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12, a = t * Math.PI * 1.6;
        const r = 0.12 * (1 - t * 0.6);
        sc.push([bx, rodY - 0.02 - Math.sin(a) * r, bz + 0.05 + (1 - Math.cos(a)) * r]);
      }
      B.add(iron, tube(sc, 0.01, 4, 14), { cast: false });
    }
    B.add(iron, xf(new THREE.CylinderGeometry(0.014, 0.014, 1.6, 6), [0, rodY, rodZ], [0, 0, Math.PI / 2]), { cast: false });
    sign = props.makeSign({ text: 'Schreinerei', style: 'hanging', bracket: false, width: 1.36, wood: 'oak', carved: true, seed: 'schreinerei-door' });
    sign.position.set(0, rodY - 0.01, rodZ);
    group.add(sign);
  }

  mark('sign');
  // ── the EFZ certificate under its little roof (hotspot) ────────────────────
  // An important credential: big enough to read from the woodworking close
  // view, at eye height beside the door, lit by a little forged picture lamp.
  const cert = makeCertificate(ctx, mats.piece, rng);
  {
    const cx = R + F + 1.08, cy = 1.42;
    // stand proud of the bark ridges either side, so nothing cuts into it
    const mount = barkMount(ctx, cx, cy, { spreadA: 0.17, spreadY: 0.42 });
    const yaw = mount.a;
    cert.position.copy(mount.point).addScaledVector(mount.normal, 0.17);
    cert.rotation.y = yaw;
    cert.userData.yaw = yaw;
    group.add(cert);
    const { bw, bh, roofTop } = cert.userData;
    const at = (x, y, z) => new THREE.Vector3(x, y, z).applyEuler(cert.rotation).add(cert.position);
    // two little brackets into the bark
    for (const s of [-1, 1]) {
      const p = at(s * bw * 0.32, -bh / 2 + 0.03, -0.1);
      const q = at(s * bw * 0.32, -bh / 2 + 0.03, -0.7);
      B.add(oakDark, xf(board(0.045, 0.055, 0.65, { along: 'z', rng }), [(p.x + q.x) / 2, p.y, (p.z + q.z) / 2], [0, yaw, 0]), { cast: false });
    }
    // a little forged picture lamp on a swan-neck arm under the eave (merged
    // into the shared metal & lamp-glow meshes: no extra draw call)
    const ly = roofTop - 0.2;
    const arm = [at(0, ly - 0.02, 0.0), at(0, ly + 0.02, 0.1), at(0, ly - 0.04, 0.2)].map((v) => [v.x, v.y, v.z]);
    B.add(iron, tube(arm, 0.009, 4, 8), { cast: false });
    // half-round hood, its opening turned down and back onto the parchment
    const hood = new THREE.CylinderGeometry(0.045, 0.045, bw * 0.5, 10, 1, false, 0, Math.PI);
    hood.rotateZ(Math.PI / 2).rotateX(0.7);
    const hp = at(0, ly - 0.06, 0.21);
    B.add(iron, xf(hood, [hp.x, hp.y, hp.z], [0, yaw, 0]), { cast: false });
    const bulb = new THREE.CylinderGeometry(0.012, 0.012, bw * 0.44, 8);
    bulb.rotateZ(Math.PI / 2);
    const bp = at(0, ly - 0.065, 0.2);
    B.add(mats.glow('#ffd79a', 0.9), xf(bulb, [bp.x, bp.y, bp.z], [0, yaw, 0]), { cast: false, receive: false });
    pushHalo(at(0, ly - 0.12, 0.2), 0.32);
  }

  mark('cert');
  // ── ivy creeping over the collar and down the bark ─────────────────────────
  {
    const ivyF = D;
    // on the collar's front face (it leans back by 0.06 per unit of height)
    const zf = (y) => 0.16 - 0.06 * y;
    const starts = [
      { p: [-(R + F + 0.3), topY + 0.25], d: [-0.4, -1, 0], len: 1.7 },
      { p: [R + F + 0.2, topY + 0.35], d: [0.5, -1, 0], len: 1.3 },
      { p: [-0.3, topY + 0.62], d: [-1, -0.2, 0], len: 1.0 },
      { p: [-(R + F + 0.45), 1.6], d: [-0.3, -1, 0], len: 1.2 },
    ];
    for (const s of starts) addIvy(ivyF, mats, rng, [s.p[0], s.p[1], zf(s.p[1])], s.d, { length: s.len, droop: 0.7, size: 0.085, normal: [0, 0.06, 1] });
  }

  mark('ivy');
  // ── warm light from inside (budgeted; may be null) ─────────────────────────
  const light = ctx.lights?.addPoint?.(new THREE.Vector3(OAK.door.x + 0.25, y0 + 0.9, DOOR.z + 0.05), { color: '#ffb35c', day: 0.6, night: 5.5, distance: 5.5 });
  // light spill on the steps (additive decal, mostly at night)
  const spill = makeSpill(ctx);
  spill.position.set(OAK.door.x + 0.15, 0.003, DOOR.z + 0.15);
  group.add(spill);

  const paper = cert.userData.paper;
  const still = !!ctx.engine?.reducedMotion;
  function update(dt, t) {
    const n = ctx.env?.night ?? 0;
    // (the candle's flicker; a steady flame with reduced motion)
    const flicker = still ? 0 : Math.sin(t * 7.3) * 0.03 * n + Math.sin(t * 13.1) * 0.02 * n;
    glimpse.emissiveIntensity = 0.5 + n * 0.75 + flicker;
    room.glow.value = ROOM_GLOW.day + (ROOM_GLOW.night - ROOM_GLOW.day) * n + flicker * 1.5;
    spill.material.uniforms.uK.value = 0.05 + n * 0.6;
    // the parchment catches the picture lamp (a little by day, warmly at night)
    paper.emissiveIntensity = 0.3 + n * 0.45;
  }

  return {
    group,
    cert,
    update,
    anchors: { lantern: lanternPos, sign },
    cost,
  };
}

// ─── the stair hall behind the door ──────────────────────────────────────────
/** Self-glow of the stair hall (× its baked vertex colours) by day / at night. */
const ROOM_GLOW = { day: 0.4, night: 0.68 };
let roomMat = null;
/**
 * One material for everything in the stair hall: vertex colours carry the
 * candle light baked in (bright near the sconce, dim towards the door), and
 * the surfaces glow a little by themselves (emission = albedo × uRoomGlow),
 * so the room reads lit even when no point light reaches it.
 */
function nicheRoomMaterial() {
  if (roomMat) return roomMat;
  const glow = { value: ROOM_GLOW.day };
  roomMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, name: 'door-stair-hall' });
  roomMat.userData.glow = glow;
  roomMat.onBeforeCompile = (sh) => {
    sh.uniforms.uRoomGlow = glow;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRoomGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uRoomGlow;');
  };
  roomMat.customProgramCacheKey = () => 'door-stair-hall';
  return roomMat;
}

/**
 * Build the stair hall into the door frame D (x across the opening, y up,
 * z out of the door; the opening spans |x| < R from the sill y0 up to the
 * arch, the room reaches `depth` behind the frame face). From the spot only
 * the right part of the opening shows past the ajar leaf, so the stair winds
 * up from the front-right round the newel towards the back, and the shelf,
 * the square and the sconce hang on the back wall on that side.
 * Returns { glow (uniform), sconce (frame-space point) }.
 */
function buildNicheRoom(D, mats, rng, { R, y0, archY, depth }) {
  const mat = nicheRoomMaterial();
  const sconce = new THREE.Vector3(0.3, archY + 0.27, -depth + 0.07);
  const base = new THREE.Color(), col = new THREE.Color();
  const p = new THREE.Vector3();
  // bake the candle into the vertex colours: bright near it, dimmer towards
  // the door and in the low corners, undersides darker
  const lit = (geo, color) => {
    if (!geo.attributes.normal) geo.computeVertexNormals();
    base.set(color);
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const d2 = p.distanceToSquared(sconce);
      const deep = THREE.MathUtils.clamp(-p.z / depth, 0, 1);
      const low = THREE.MathUtils.smoothstep(p.y, y0, y0 + 0.5);
      let k = 0.34 + 0.72 * Math.exp(-d2 / 0.45) + 0.24 * deep + 0.1 * low;
      k *= 0.68 + 0.32 * (nor.getY(i) * 0.5 + 0.5);
      col.copy(base).multiplyScalar(k);
      arr[i * 3] = col.r;
      arr[i * 3 + 1] = col.g;
      arr[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  };
  const add = (geo, color) => D.add(mat, lit(geo, color), { cast: false });
  const nx = 0.13, nz = -0.46; // the newel
  // ── floor: wide oak planks running in from the threshold ──────────────────
  {
    const tones = ['#b58a55', '#a57a48', '#bb9160', '#9f7445'];
    const n = 4, pw = (2 * R) / n;
    for (let i = 0; i < n; i++) {
      add(xf(board(pw - 0.008, 0.03, depth - 0.42, { along: 'z', rng }), [-R + pw * (i + 0.5), y0 - 0.015, -(depth + 0.42) / 2]), tones[i]);
    }
  }
  // ── the reveals: three vertical planks a side, and the planked soffit ─────
  {
    const n = 3, pd = depth / n;
    for (const s of [-1, 1]) {
      for (let i = 0; i < n; i++) {
        add(xf(board(0.035, archY - y0 + 0.02, pd - 0.006, { along: 'y', rng }), [s * (R - 0.018), (archY + y0) / 2, -0.01 - pd * (i + 0.5)]), rng.pick(['#d6bd8c', '#cdb281', '#dcc496']));
      }
    }
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI, a1 = ((i + 1) / 8) * Math.PI;
      add(xf(arcSegment(R - 0.035, R, a0, a1, depth, 2), [0, archY, -depth / 2 - 0.01]), i % 2 ? '#d2b887' : '#c9ad7c');
    }
  }
  // ── the newel: a turned oak post with beads, a carved acorn foot ──────────
  {
    const prof = [[0, y0], [0.062, y0], [0.064, y0 + 0.05], [0.05, y0 + 0.09], [0.044, y0 + 0.12]];
    for (let y = y0 + 0.42; y < archY + 0.75; y += 0.38) prof.push([0.044, y - 0.03], [0.054, y], [0.044, y + 0.03]);
    prof.push([0.044, archY + 0.85], [0, archY + 0.85]);
    add(xf(turned(prof, 12), [nx, 0, nz]), '#9a6c42');
  }
  // ── the winder treads: oak pie slices housed in the newel and the wall ───
  const rise = 0.165, th = 0.042;
  const tread0 = -0.45, dTheta = 0.42;
  const reach = (a) => {
    // the outer end stops at the reveals, the back wall and the door plane
    let r = 0.5;
    const c = Math.cos(a), s = Math.sin(a);
    if (c > 0.01) r = Math.min(r, (R - 0.04 - nx) / c);
    if (c < -0.01) r = Math.min(r, (R - 0.04 + nx) / -c);
    if (s > 0.01) r = Math.min(r, (depth - 0.03 + nz) / s);
    if (s < -0.01) r = Math.min(r, (-nz - 0.06) / -s);
    return r;
  };
  const treadTones = ['#b98d58', '#ad8150', '#c09462', '#a77b4b'];
  const nTreads = 9;
  for (let i = 0; i < nTreads; i++) {
    const a = tread0 + i * dTheta;
    const aa = a - dTheta * 0.62, ab = a + dTheta * 0.5; // each tread laps under the next one's nosing
    const sh = new THREE.Shape();
    const steps = 5;
    sh.moveTo(Math.cos(aa) * 0.05, Math.sin(aa) * 0.05);
    for (let k = 0; k <= steps; k++) {
      const t = aa + ((ab - aa) * k) / steps;
      const r = reach(t);
      sh.lineTo(Math.cos(t) * r, Math.sin(t) * r);
    }
    sh.lineTo(Math.cos(ab) * 0.05, Math.sin(ab) * 0.05);
    const g = new THREE.ExtrudeGeometry(sh, { depth: th, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1, curveSegments: 2 });
    g.rotateX(-Math.PI / 2); // shape y → −z (back), extrusion → up
    const y = y0 + rise * (i + 1) - th - 0.008;
    add(xf(g, [nx, y, nz]), treadTones[i % treadTones.length]);
  }
  // ── a rope handrail on iron eyes along the wall side ──────────────────────
  {
    const pts = [];
    for (let a = tread0 - 0.2; a <= tread0 + dTheta * 5; a += 0.2) {
      const r = Math.max(0.12, reach(a) - 0.07);
      const yy = y0 + rise * ((a - tread0) / dTheta + 1) + 0.6;
      pts.push([nx + Math.cos(a) * r, yy, nz - Math.sin(a) * r]);
    }
    add(tube(pts, 0.011, 5, pts.length * 3), '#c9a86e');
    for (const k of [1, 5, 9]) {
      if (k >= pts.length - 1) continue;
      const q = pts[k];
      add(xf(new THREE.TorusGeometry(0.02, 0.005, 4, 8), [q[0], q[1] + 0.012, q[2]], [Math.PI / 2, 0, 0]), '#3a3430');
    }
    // the rope's end knotted round the newel's foot
    add(xf(new THREE.TorusGeometry(0.06, 0.012, 5, 12), [nx, y0 + 0.3, nz], [Math.PI / 2, 0, 0.2]), '#c9a86e');
  }
  // ── on the back wall, right of the stair: a shelf of jars, a square on a peg, the sconce
  {
    const zw = -depth + 0.01;
    const sy = y0 + 1.0, sx0 = 0.27, sx1 = R - 0.05;
    add(xf(board(sx1 - sx0, 0.022, 0.1, { along: 'x', rng }), [(sx0 + sx1) / 2, sy, zw + 0.05]), '#a37648');
    for (const x of [sx0 + 0.05, sx1 - 0.05]) add(xf(board(0.018, 0.07, 0.08, { along: 'y', rng }), [x, sy - 0.045, zw + 0.045]), '#8f6440');
    const jars = [['#d9a441', 0.1, 0.028], ['#86a06a', 0.08, 0.025], ['#b5633e', 0.07, 0.03], ['#e8dcc0', 0.11, 0.024]];
    jars.forEach(([c, h, r], i) => {
      const x = sx0 + 0.04 + i * 0.065 + rng.jitter(0.006);
      add(xf(new THREE.CylinderGeometry(r, r * 1.05, h, segs(9, 6)), [x, sy + 0.011 + h / 2, zw + 0.05]), c);
      add(xf(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.012, segs(9, 6)), [x, sy + 0.011 + h + 0.006, zw + 0.05]), i === 2 ? '#e8dcc0' : '#6b4a2e');
    });
    // a try-square hung by its stock on a peg
    const qx = 0.47, qy = sy + 0.3;
    add(xf(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 6), [qx, qy + 0.07, zw + 0.02], [Math.PI / 2, 0, 0]), '#7a5539');
    add(xf(board(0.024, 0.15, 0.014, { along: 'y', rng }), [qx, qy, zw + 0.012], [0, 0, 0.06]), '#5c4334');
    add(xf(new THREE.BoxGeometry(0.12, 0.016, 0.003), [qx + 0.066, qy - 0.064, zw + 0.012], [0, 0, 0.06]), '#d4d9dc');
    // the candle sconce: an iron cup on a little arm, a cream candle
    const c = sconce;
    add(xf(new THREE.BoxGeometry(0.012, 0.012, 0.06), [c.x, c.y - 0.06, zw + 0.03]), '#3a3430');
    add(xf(new THREE.CylinderGeometry(0.026, 0.018, 0.02, 8), [c.x, c.y - 0.055, c.z]), '#3a3430');
    add(xf(new THREE.CylinderGeometry(0.012, 0.013, 0.06, 8), [c.x, c.y - 0.018, c.z]), '#f2e6c8');
    D.add(mats.glow('#ffd79a', 0.9), xf(new THREE.SphereGeometry(0.013, 6, 4), [c.x, c.y + 0.022, c.z], null, [1, 1.6, 1]), { cast: false, receive: false });
  }
  return { glow: mat.userData.glow, sconce };
}

/** The shared vertex-coloured, lightly mossy root bark (door roots & annex roots: one draw call). */
export function rootBarkMaterial(ctx) {
  return ctx.materials.surface('bark', { mossy: 0.22, vertexColors: true });
}

const BARK_MEAN = new THREE.Color('#6a5845');
/**
 * A root along `pts` (frame space): an oval tube tapering r0 → r1 (`flat` =
 * height / width), with long bark ridges and furrows that wander a little.
 * Vertex colours carry the AO for rootBarkMaterial: dark in the furrows,
 * underneath and near the ground (y = `ground`). `radius(t)` overrides the
 * plain taper (a buttress that swells where it leaves the bole, a knee, a
 * foot that spreads into the soil). Returns { geo, curve, radiusAt(t) }.
 */
export function rootGeo(rng, pts, { r0 = 0.3, r1 = 0.08, flat = 0.75, radial = 14, tubular = 28, ground = 0, radius = null } = {}) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const g = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Vector3(), d = new THREE.Vector3();
  const ox = rng.next() * 50;
  const radiusAt = radius ?? ((t) => r0 + (r1 - r0) * Math.pow(t, 0.8));
  for (let j = 0; j <= tubular; j++) {
    const t = j / tubular;
    curve.getPointAt(t, c);
    const r = radiusAt(t);
    for (let k = 0; k <= radial; k++) {
      const i = j * (radial + 1) + k;
      const ang = (k / radial) * Math.PI * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      d.fromBufferAttribute(pos, i).sub(c).normalize();
      // ridges along the root (periodic in the angle: no seam)
      const f = Math.sin(ang * 7 + noiseA(t * 3 + ox + ca * 0.8, sa * 0.8) * 2.4 + t * 1.6);
      const rid = Math.sign(f) * Math.pow(Math.abs(f), 0.6);
      const lump = noiseB(c.x * 2.2 + ox + ca * 0.5, c.z * 2.2 + sa * 0.5) * 0.09;
      d.multiplyScalar(r * (1 + 0.065 * rid + lump));
      const under = THREE.MathUtils.smoothstep(-d.y / r, -0.1, 0.8);
      d.y *= flat;
      const y = c.y + d.y;
      pos.setXYZ(i, c.x + d.x, y, c.z + d.z);
      const near = 1 - THREE.MathUtils.smoothstep(y - ground, 0.0, 0.3);
      const ao = THREE.MathUtils.clamp(1.04 - 0.4 * Math.max(0, -rid) + 0.06 * Math.max(0, rid) - 0.3 * under - 0.32 * near, 0.32, 1.12);
      col[i * 3] = BARK_MEAN.r * ao;
      col[i * 3 + 1] = BARK_MEAN.g * ao;
      col[i * 3 + 2] = BARK_MEAN.b * ao;
    }
  }
  g.computeVertexNormals();
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  uvBox(g, 'z', 1.2);
  return { geo: g, curve, radiusAt };
}

/**
 * A moss shell over the top of a root (rootGeo's curve & radius): a partial
 * tube round the up-facing side, lifted off the bark by a lumpy thickness
 * that thins to nothing — and dips back under the bark — towards its flanks,
 * so the rim is broken and fuzzy rather than a painted stripe. Thickest on
 * the near-level stretches, gone where the root runs steeply up or down.
 * `t0..t1` limits it along the root; `cover` (0..1) how far round it reaches.
 */
export function mossCapGeo(rng, curve, radiusAt, { flat = 0.75, t0 = 0.05, t1 = 0.95, cover = 0.55, thick = 0.05, radial = 12, tubular = 22, side = null } = {}) {
  const pos = [];
  const col = [];
  const idx = [];
  const P = new THREE.Vector3(), T = new THREE.Vector3(), N = new THREE.Vector3(), Bn = new THREE.Vector3();
  // (`side`: the moss faces that way instead of up — the damp, shaded flank
  // of a root that stands upright, where moss on its top could never be seen)
  const UP = side ? new THREE.Vector3(side[0], side[1], side[2]).normalize() : new THREE.Vector3(0, 1, 0);
  const ox = rng.next() * 40;
  const span = Math.PI * cover;
  const o = new THREE.Vector3();
  for (let j = 0; j <= tubular; j++) {
    const t = t0 + ((t1 - t0) * j) / tubular;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    N.copy(UP).addScaledVector(T, -T.dot(UP));
    if (N.lengthSq() < 1e-4) N.set(1, 0, 0);
    N.normalize();
    Bn.crossVectors(T, N).normalize();
    const r = radiusAt(t);
    // moss settles where the root is level, not on its steep stretches
    const level = side ? 1 : 1 - THREE.MathUtils.smoothstep(Math.abs(T.y), 0.45, 0.85);
    const ends = THREE.MathUtils.smoothstep(j / tubular, 0, 0.12) * THREE.MathUtils.smoothstep(1 - j / tubular, 0, 0.12);
    for (let k = 0; k <= radial; k++) {
      const u = k / radial;
      const phi = (u * 2 - 1) * span;
      const c = Math.cos(phi), s = Math.sin(phi);
      // lumpy cushions along the root, the rim bitten into lobes
      const lump = 0.55 + 0.45 * noiseA(t * 9 + ox, phi * 1.7) + 0.3 * noiseB(t * 23 - ox, phi * 4.1);
      const rim = Math.pow(Math.max(0, 1 - Math.abs(phi) / span), 0.55);
      const lift = thick * Math.max(0, lump) * rim * level * ends - (1 - rim) * 0.012 - 0.004;
      const rr = r + lift;
      if (side) {
        // the root's own section: squashed vertically (as rootGeo builds it)
        o.copy(N).multiplyScalar(c).addScaledVector(Bn, s);
        o.y *= flat;
        pos.push(P.x + o.x * rr, P.y + o.y * rr, P.z + o.z * rr);
      } else pos.push(P.x + (N.x * c * flat + Bn.x * s) * rr, P.y + (N.y * c * flat + Bn.y * s) * rr, P.z + (N.z * c * flat + Bn.z * s) * rr);
      // sunlit yellow-green on the crowns of the cushions, dark olive at the rim
      mossTone(THREE.MathUtils.clamp(lift / thick, 0, 1) * (0.75 + 0.25 * c), _mc);
      col.push(_mc.r, _mc.g, _mc.b);
    }
  }
  const cols = radial + 1;
  for (let j = 0; j < tubular; j++) {
    for (let k = 0; k < radial; k++) {
      const a = j * cols + k, b = (j + 1) * cols + k;
      // (B = T × N, so (a, a+1, b) winds outwards)
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  uvBox(g, 'y', 2, [ox, ox]);
  return g;
}

// ─── warm, vertex-coloured moss (roots, porch roof) ─────────────────────────
/**
 * Moss with its colour in the vertex colours: one shared material for the
 * cushions that need to grade from a sunlit yellow-green crown to a dark
 * olive rim (the plain moss surface reads flat and cool on a roof).
 */
export function mossVCMaterial(ctx) {
  return ctx.materials.surface('moss', { vertexColors: true, scale: 1.1, bump: 0.8 });
}
const MOSS_RIM = new THREE.Color('#3b4620'), MOSS_MID = new THREE.Color('#6f7f2e'), MOSS_TOP = new THREE.Color('#a6ad50');
const _mc = new THREE.Color();
/** Moss tone for k = 0 (rim, shade) … 1 (sunlit crown). */
export function mossTone(k, out = new THREE.Color()) {
  return k < 0.5 ? out.copy(MOSS_RIM).lerp(MOSS_MID, k * 2) : out.copy(MOSS_MID).lerp(MOSS_TOP, (k - 0.5) * 2);
}
/**
 * Paint a moss cushion lying on y = 0 (mossGeo / mossPadGeo, before it is
 * placed): crown → rim by height, a little darker on its flanks, a few
 * paler, sunnier tufts. `sun` (0..1) lifts the whole cushion.
 */
export function paintMoss(geo, h, { sun = 0.7, seed = 0 } = {}) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = THREE.MathUtils.clamp(pos.getY(i) / Math.max(1e-3, h), 0, 1);
    const n = noiseA(pos.getX(i) * 11 + seed, pos.getZ(i) * 11) * 0.5 + 0.5;
    const k = THREE.MathUtils.clamp(Math.pow(y, 0.7) * (0.55 + 0.45 * Math.max(0, nor.getY(i))) * (0.6 + 0.5 * sun) + (n - 0.5) * 0.25, 0, 1);
    mossTone(k, _mc);
    arr[i * 3] = _mc.r;
    arr[i * 3 + 1] = _mc.g;
    arr[i * 3 + 2] = _mc.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** World z of the oak's (nominal) bark surface in front of the trunk at x, y. */
export function barkZAt(x, y) {
  const r = oakRadiusAt(y);
  const dx = x - OAK.x;
  return OAK.z + Math.sqrt(Math.max(0.01, r * r - dx * dx));
}

/**
 * Where to mount something on the front of the oak at world x, height y:
 * uses the sculpted bark (ctx.oak.barkRadius) when the oak builder provides
 * it, taking the outermost bark within ±spread so a board never sinks into a
 * bulge. Returns { a (azimuth), r, point (Vector3 on the bark), normal }.
 */
export function barkMount(ctx, x, y, { spreadA = 0.05, spreadY = 0.25 } = {}) {
  const rad = (a, yy) => ctx.oak?.barkRadius?.(a, yy) ?? oakRadiusAt(yy);
  let a = Math.asin(THREE.MathUtils.clamp((x - OAK.x) / oakRadiusAt(y), -1, 1));
  for (let i = 0; i < 3; i++) a = Math.asin(THREE.MathUtils.clamp((x - OAK.x) / rad(a, y), -1, 1));
  let r = 0;
  for (const da of [-spreadA, 0, spreadA]) for (const dy of [-spreadY, 0, spreadY]) r = Math.max(r, rad(a + da, y + dy));
  const normal = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
  const point = new THREE.Vector3(OAK.x + normal.x * r, y, OAK.z + normal.z * r);
  return { a, r, point, normal };
}

/** Field-stone tones of the door steps (warm greys, one a little greener, one browner). */
const STEP_TONES = ['#8f897c', '#9a9282', '#857f72', '#a1988a', '#8a8a7a', '#968a78'];
/** The vertex-coloured stone of the steps & thresholds (one draw call for all of them). */
export function stepStoneMaterial(ctx) {
  return ctx.materials.surface('stone', { vertexColors: true, mossy: 0.05 });
}

/**
 * A worn step stone (w × h × d, centred): rounded arrises, a tread dished by
 * feet along `walkX` (most at the nosing), one or two chipped corners, lumpy
 * sides; vertex colours (for stepStoneMaterial) — the stone's own `tone`,
 * paler and smoother where it is worn, darker and greener down the damp
 * sides and towards the ground.
 */
export function wornStone(rng, w, h, d, { walkX = 0, tone = '#928b7e', dish = 0.022, chips = 2 } = {}) {
  const sx = Math.max(3, Math.round((w / 0.085) * LOD.k)), sz = Math.max(3, Math.round((d / 0.085) * LOD.k));
  const g = new THREE.BoxGeometry(w, h, d, sx, 2, sz);
  const ox = rng.next() * 40;
  const hw = w / 2, hd = d / 2, hh = h / 2;
  // chipped corners: a bevel plane cut across a top corner
  const cuts = [];
  for (let i = 0; i < chips; i++) cuts.push({ cx: rng.next() < 0.5 ? -1 : 1, cz: rng.next() < 0.6 ? 1 : -1, r: rng.range(0.05, 0.09) });
  const rr = Math.min(0.05, hw * 0.3, hd * 0.3);
  const topK = [];
  deform(g, (v, i) => {
    const ex = Math.abs(v.x) / hw, ez = Math.abs(v.z) / hd;
    const top = THREE.MathUtils.smoothstep(v.y, hh - 0.06, hh);
    // rounded arrises: the rim of the top sinks and draws in
    const edge = Math.max(THREE.MathUtils.smoothstep(ex, 1 - rr / hw, 1), THREE.MathUtils.smoothstep(ez, 1 - rr / hd, 1));
    v.y -= edge * edge * rr * 0.75 * top;
    v.x -= Math.sign(v.x) * rr * 0.35 * top * THREE.MathUtils.smoothstep(ex, 0.8, 1);
    v.z -= Math.sign(v.z) * rr * 0.35 * top * THREE.MathUtils.smoothstep(ez, 0.8, 1);
    // the worn dish: along the walking line, deepest towards the nosing (+z)
    let wear = 0;
    if (v.y > hh - 0.03) {
      const front = THREE.MathUtils.smoothstep(v.z, -hd, hd);
      wear = Math.exp(-((v.x - walkX) ** 2) / 0.07) * (0.45 + 0.55 * front) * (1 - edge * 0.5);
      v.y -= dish * wear;
      // the nosing itself rounded off where feet land
      v.y -= 0.02 * Math.exp(-((v.x - walkX) ** 2) / 0.09) * THREE.MathUtils.smoothstep(v.z, hd * 0.55, hd);
    }
    // chips
    for (const c of cuts) {
      const px = c.cx * hw, pz = c.cz * hd;
      const dd = Math.abs(v.x - px) + Math.abs(v.z - pz) + (hh - v.y) * 1.4;
      if (dd < c.r) {
        const k = (c.r - dd) / c.r;
        v.x -= c.cx * k * c.r * 0.35;
        v.z -= c.cz * k * c.r * 0.35;
        v.y -= k * c.r * 0.6;
      }
    }
    // lumpy, hand-split sides; a slightly uneven top
    v.x += noiseA(v.z * 5 + ox, v.y * 5) * 0.012 * (1 - top * 0.7);
    v.z += noiseB(v.x * 5 + ox, v.y * 5) * 0.012 * (1 - top * 0.7);
    v.y += noiseA(v.x * 7 - ox, v.z * 7) * 0.004 * top;
    topK[i] = top * (1 - edge * 0.6) + wear * 0.5;
  });
  // vertex colours
  const base = new THREE.Color(tone), c = new THREE.Color(), damp = new THREE.Color('#5d6148'), worn = new THREE.Color('#b9b0a0');
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = topK[i] ?? 0;
    c.copy(base).multiplyScalar(0.72 + 0.28 * t + noiseB(pos.getX(i) * 9 + ox, pos.getZ(i) * 9) * 0.05);
    // worn tread paler and smoother
    c.lerp(worn, THREE.MathUtils.clamp((t - 0.9) * 2.5, 0, 0.35));
    // damp, greener sides towards the ground
    c.lerp(damp, (1 - t) * THREE.MathUtils.smoothstep(-y, -hh * 0.2, hh) * 0.3);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  uvBox(g, 'x', 1.4, [rng.next() * 9, rng.next() * 9]);
  return g;
}

/**
 * The stair hall's far wall, painted: warm planks lit by the candle sconce
 * (upper right), darker towards the floor and the corners. Everything in
 * front of it — stair, newel, shelf, jars, the square — is real geometry.
 * The card spans the opening: u across, v from the sill up to the arch top.
 */
function makeGlimpseMaterial() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 384;
  const g = c.getContext('2d');
  const r = createRng('door-glimpse');
  // planks of slightly different widths & tones, soft seams between them
  let x = 0;
  while (x < 256) {
    const w = 26 + r.next() * 14;
    const l = 58 + r.next() * 10;
    g.fillStyle = `hsl(${30 + r.next() * 6}, ${48 + r.next() * 10}%, ${l}%)`;
    g.fillRect(x, 0, w, 384);
    // faint grain
    g.fillStyle = 'rgba(120,70,30,0.08)';
    for (let k = 0; k < 5; k++) g.fillRect(x + r.next() * w, 0, 1 + r.next() * 2, 384);
    g.fillStyle = 'rgba(70,35,12,0.35)';
    g.fillRect(x + w - 2, 0, 2, 384);
    x += w;
  }
  // the candle's pool of light (upper right) …
  const sx = 195, sy = 73;
  const lg = g.createRadialGradient(sx, sy, 4, sx, sy, 150);
  lg.addColorStop(0, 'rgba(255,246,214,0.95)');
  lg.addColorStop(0.3, 'rgba(255,214,150,0.45)');
  lg.addColorStop(1, 'rgba(255,190,120,0)');
  g.fillStyle = lg;
  g.fillRect(0, 0, 256, 384);
  // … falling off into warm shade away from it and towards the floor
  const sh = g.createRadialGradient(sx, sy, 60, sx, sy + 40, 330);
  sh.addColorStop(0, 'rgba(60,26,8,0)');
  sh.addColorStop(1, 'rgba(60,26,8,0.62)');
  g.fillStyle = sh;
  g.fillRect(0, 0, 256, 384);
  const fl = g.createLinearGradient(0, 300, 0, 384);
  fl.addColorStop(0, 'rgba(50,22,8,0)');
  fl.addColorStop(1, 'rgba(50,22,8,0.45)');
  g.fillStyle = fl;
  g.fillRect(0, 300, 256, 84);
  // corners in shade
  const v = g.createLinearGradient(0, 0, 256, 0);
  v.addColorStop(0, 'rgba(40,18,6,0.5)');
  v.addColorStop(0.2, 'rgba(40,18,6,0)');
  v.addColorStop(0.88, 'rgba(40,18,6,0)');
  v.addColorStop(1, 'rgba(40,18,6,0.35)');
  g.fillStyle = v;
  g.fillRect(0, 0, 256, 384);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ color: '#3a2414', emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.8, roughness: 1, name: 'door-glimpse' });
}

/** Soft additive warm wedge of light on the steps in front of the gap. */
function makeSpill(ctx) {
  const g = new THREE.PlaneGeometry(2.4, 2.2, 1, 44);
  g.rotateX(-Math.PI / 2);
  g.translate(0.3, 0, 1.1);
  // lie on the two steps (the mesh sits 0.15 in front of the frame face)
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const zr = pos.getZ(i) + 0.15;
    pos.setY(i, zr < 0.48 ? DOOR.sill + 0.005 : zr < 0.94 ? DOOR.sill / 2 + 0.005 : 0.0);
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: { uK: { value: 0.3 }, uColor: { value: new THREE.Color('#ffb35c') } },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uK;
      uniform vec3 uColor;
      varying vec2 vP;
      void main() {
        // a fan opening away from the door gap (origin), brighter near it
        float d = length(vP);
        float ang = atan(vP.x, vP.y);
        float fan = smoothstep(0.75, 0.15, abs(ang - 0.25));
        float a = fan * smoothstep(2.1, 0.0, d) * uK;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const m = new THREE.Mesh(g, mat);
  m.name = 'door-spill';
  m.renderOrder = 2;
  m.raycast = () => {};
  m.castShadow = m.receiveShadow = false;
  // follow the steps: lift the far part (lower step)
  return m;
}

/**
 * The Schreiner EFZ certificate: parchment with text & a red seal in an oak
 * frame, on a backing board under a tiny shingled roof. Its own group (hotspot).
 * Sized to be readable from the woodworking views (≈ 0.8 × 0.6 framed).
 * userData: { paper (its material), bw, bh (backing board), roofTop (local y) }.
 */
function makeCertificate(ctx, mats, rng) {
  const g = new THREE.Group();
  g.name = 'efz-certificate';
  const B = new Batch();
  const W = 0.68, H = 0.49; // the paper
  const fw = 0.045; // frame width
  const bw = W + fw * 2 + 0.14, bh = H + fw * 2 + 0.16; // backing board
  // backing board
  B.add(mats.wood('oak'), board(bw, bh, 0.04, { along: 'y', rng }).translate(0, 0.0, -0.045));
  // a little gable roof: two boards, each covered with three rows of tiny shingles
  const ridge = bw / 2 + 0.08; // half-span of the roof along its slope
  const apex = new THREE.Vector3(0, bh / 2 + 0.28, 0.03); // eaves just clear the board's top corners
  for (const s of [-1, 1]) {
    // roof-board frame: x down the slope, y = board normal, z along the ridge
    const M = new THREE.Matrix4().makeRotationZ(-s * 0.5);
    if (s < 0) M.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
    M.setPosition(apex);
    const roof = board(ridge, 0.026, 0.24, { along: 'x', rng });
    B.add(mats.wood('walnut'), roof.translate(ridge / 2, 0, 0).applyMatrix4(M));
    for (let row = 0; row < 3; row++) {
      const n = 6;
      for (let k = 0; k < n; k++) {
        const sh = board(ridge * 0.36, 0.009, 0.24 / n + 0.004, { along: 'x', rng, r: 0.002 });
        sh.translate(ridge - row * ridge * 0.3 - ridge * 0.18, 0.018 + (2 - row) * 0.004, -0.12 + (k + 0.5) * (0.24 / n) + (row % 2) * 0.01);
        B.add(mats.wood('oak'), sh.applyMatrix4(M), { cast: false, color: k % 2 ? '#7d6a55' : '#8f7a60' });
      }
    }
  }
  // oak frame with mitred corners (darker, so the parchment pops)
  for (const [x, y, w, h] of [[0, H / 2 + fw / 2, W + fw * 2, fw], [0, -H / 2 - fw / 2, W + fw * 2, fw], [-W / 2 - fw / 2, 0, fw, H], [W / 2 + fw / 2, 0, fw, H]]) {
    B.add(mats.wood('walnut'), board(w, h, 0.04, { along: w > h ? 'x' : 'y', rng, r: 0.007 }).translate(x, y, 0.0));
  }
  // a thin gilt slip inside the frame
  for (const [x, y, w, h] of [[0, H / 2 + 0.004, W + 0.012, 0.008], [0, -H / 2 - 0.004, W + 0.012, 0.008], [-W / 2 - 0.004, 0, 0.008, H], [W / 2 + 0.004, 0, 0.008, H]]) {
    B.add(mats.metal('#c9a04a'), new THREE.BoxGeometry(w, h, 0.012).translate(x, y, 0.012), { cast: false });
  }
  B.build(g, 'certificate', { mergeShadow: true });
  // the paper (canvas texture): few, large, high-contrast words
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = Math.round((1024 * H) / W);
  const x = c.getContext('2d');
  const cw = c.width, ch = c.height;
  x.fillStyle = '#f7eed8';
  x.fillRect(0, 0, cw, ch);
  // aged edges
  const e = x.createRadialGradient(cw / 2, ch / 2, ch * 0.35, cw / 2, ch / 2, cw * 0.62);
  e.addColorStop(0, 'rgba(0,0,0,0)');
  e.addColorStop(1, 'rgba(150,110,60,0.3)');
  x.fillStyle = e;
  x.fillRect(0, 0, cw, ch);
  // double border
  x.strokeStyle = '#a77d3c';
  x.lineWidth = 9;
  x.strokeRect(26, 26, cw - 52, ch - 52);
  x.lineWidth = 3;
  x.strokeRect(44, 44, cw - 88, ch - 88);
  x.fillStyle = '#2b1d14';
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  x.font = '600 38px "Fredoka", sans-serif';
  x.fillText('EIDGENÖSSISCHES FÄHIGKEITSZEUGNIS', cw / 2, 118);
  x.font = '700 150px "Fredoka", sans-serif';
  x.fillText('Schreiner EFZ', cw / 2, 290);
  x.font = '400 54px "Patrick Hand", cursive';
  x.fillStyle = '#4a3324';
  x.fillText('Möbel- & Innenausbau', cw / 2, 370);
  // signature line + name, and the red seal with the Swiss cross
  x.strokeStyle = '#6b4430';
  x.lineWidth = 2.5;
  x.beginPath();
  x.moveTo(150, 600);
  x.lineTo(430, 600);
  x.stroke();
  x.fillStyle = '#2b1d14';
  x.font = '400 80px "Patrick Hand", cursive';
  x.fillText('Jonny', 290, 585);
  x.fillStyle = '#c4271c';
  x.beginPath();
  x.arc(cw - 250, ch - 175, 82, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = '#8f1a12';
  x.lineWidth = 5;
  x.stroke();
  x.fillStyle = '#ffffff';
  x.fillRect(cw - 250 - 14, ch - 175 - 46, 28, 92);
  x.fillRect(cw - 250 - 46, ch - 175 - 14, 92, 28);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // self-lit a little (the picture lamp) so it stays legible in the oak's shade
  const paperMat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#fff4dc', emissiveMap: tex, emissiveIntensity: 0.3, roughness: 0.9, name: 'efz-paper' });
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(W, H), paperMat);
  paper.position.z = 0.006;
  paper.name = 'efz-paper';
  g.add(paper);
  g.userData = { paper: paperMat, bw, bh, roofTop: apex.y + 0.04 };
  return g;
}
