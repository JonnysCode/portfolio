// ─────────────────────────────────────────────────────────────────────────────
// The workshop door in the Great Oak (OAK.door).
//
// A big round-arched plank door, slightly ajar with warm light spilling out,
// set in a carved oak frame (bent arch segments, pegs, a keystone with the
// cabinetmakers' guild emblem). The bark has grown around the frame into a
// thick burl collar, two mossy roots flank worn stone steps. Forged strap
// hinges, a ring pull, a bullseye window, a lantern on a scroll bracket, the
// carved "Schreinerei" sign swinging above and the framed EFZ certificate
// under its own little roof (hotspot 'efz-certificate').
//
// The frame stands DOOR.z proud of the bark; the oak builder carves a niche
// behind it (scene/oak/shape.js DOOR_NICHE) and rolls its own bark lip around
// it. Our burl collar reaches ~1 unit into the trunk so the two always blend,
// and the lit doorway is a shallow niche in front of the bark, never inside it.
// Things on the bark (lantern bracket, sign brackets, certificate) are placed
// with barkMount(), which follows the sculpted bark when ctx.oak provides it.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OAK, oakRadiusAt } from '../../world/layout.js';
import { createRng } from '../../core/rng.js';
import { Batch, board, uvBox, xf, deform, mat4, mossGeo, tube, archShape, arcSegment, addIvy, addToadstool, addLantern, peg, noiseA, noiseB } from './kit.js';

/** Door dimensions (exported so others can align to it). */
export const DOOR = {
  sill: 0.36, // threshold height (two steps up)
  width: 1.2, // clear opening
  straight: 1.12, // straight jamb height above the sill
  frame: 0.17, // frame face width
  /** z of the frame front face (world). Proud of the bark so the lit niche is never swallowed. */
  z: OAK.door.z + 0.47,
  ajar: 0.52, // radians the leaf stands open (outwards, hinged left)
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

  // ── the lit niche behind the door: reveals + a painted glimpse inside ──────
  const nicheDepth = 0.3;
  {
    // reveal lining (inside the frame) — warm-lit planks
    const lining = mats.wood('spruce');
    for (const s of [-1, 1]) {
      const p = board(0.04, Hs, nicheDepth, { along: 'y', rng });
      D.add(lining, xf(p, [s * (R - 0.02), y0 + Hs / 2, -nicheDepth / 2 - 0.01]), { cast: false });
    }
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI, a1 = ((i + 1) / 8) * Math.PI;
      const seg = arcSegment(R - 0.04, R, a0, a1, nicheDepth, 2);
      D.add(lining, xf(uvBox(seg, 'z'), [0, archY, -nicheDepth / 2 - 0.01]), { cast: false });
    }
  }
  // the glimpse: a painted interior (spiral stair, shelves, lamp) that glows
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
    m.position.set(OAK.door.x, y0, DOOR.z - nicheDepth);
    m.name = 'door-glimpse';
    group.add(m);
  }

  // ── the door leaf: 6 vertical planks, ledges & brace, strap hinges ──────────
  const leaf = new Batch();
  const LW = W + 0.06, LR = LW / 2, LT = 0.065;
  const leafBottom = y0 + 0.012;
  const nPl = 6;
  const plankW = LW / nPl;
  const leafTop = (x) => archY + Math.sqrt(Math.max(0, LR * LR - x * x));
  for (let i = 0; i < nPl; i++) {
    const x0 = -LR + i * plankW + 0.004, x1 = -LR + (i + 1) * plankW - 0.004;
    const s = new THREE.Shape();
    s.moveTo(x0, leafBottom);
    s.lineTo(x1, leafBottom);
    const steps = 6;
    for (let k = 0; k <= steps; k++) {
      const x = x1 + ((x0 - x1) * k) / steps;
      s.lineTo(x, leafTop(x) - 0.002);
    }
    s.lineTo(x0, leafBottom);
    const g = new THREE.ExtrudeGeometry(s, { depth: LT, bevelEnabled: true, bevelSize: 0.007, bevelThickness: 0.007, bevelSegments: 1, curveSegments: 2 });
    // a little warp per plank
    const wob = rng.jitter(0.006);
    deform(g, (v) => {
      v.z += wob * Math.sin(((v.y - y0) / (Hs + R)) * Math.PI);
    });
    uvBox(g, 'y', undefined, [rng.next() * 9, rng.next() * 9]);
    leaf.add(oak, g, { color: i % 2 ? '#9a7352' : '#8c6846' });
  }
  // inside ledges + a diagonal brace (Z), hidden mostly but honest
  for (const ly of [leafBottom + 0.22, archY - 0.05]) leaf.add(oak, xf(board(LW - 0.12, 0.12, 0.035, { along: 'x', rng }), [0, ly, -0.02]));
  {
    const len = Math.hypot(LW - 0.2, archY - 0.05 - (leafBottom + 0.22));
    const ang = Math.atan2(archY - 0.05 - (leafBottom + 0.22), LW - 0.2);
    leaf.add(oak, xf(board(len, 0.1, 0.03, { along: 'x', rng }), [0, (archY - 0.05 + leafBottom + 0.22) / 2, -0.02], [0, 0, -ang]));
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

  // ── two roots flanking the steps, mossy on top ─────────────────────────────
  for (const s of [-1, 1]) {
    const pts = [];
    const x0 = s * (R + F + 0.5);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push([x0 + s * t * 0.75 + Math.sin(t * 5 + s) * 0.06, (1 - t) * 1.05 + Math.sin(t * Math.PI) * 0.1, -0.55 + t * 1.55]);
    }
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const g = new THREE.TubeGeometry(curve, 24, 1, 9, false);
    // taper + flatten (roots are oval and sink into the ground)
    const pos = g.attributes.position;
    const tmp = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const seg = Math.floor(i / 10);
      const t = seg / 24;
      curve.getPointAt(Math.min(1, t), c);
      tmp.fromBufferAttribute(pos, i).sub(c);
      const r = 0.34 * (1 - t * 0.7);
      tmp.normalize().multiplyScalar(r);
      tmp.y *= 0.75;
      tmp.addScalar(noiseA(c.x * 3 + tmp.x * 4, c.z * 3 + tmp.y * 4) * 0.03);
      tmp.add(c);
      pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    g.computeVertexNormals();
    uvBox(g, 'z', 1.2);
    D.add(mats.bark(), g);
    for (let i = 0; i < 6; i++) {
      const t = rng.range(0.08, 0.85);
      const p = curve.getPointAt(t);
      const r = 0.34 * (1 - t * 0.7);
      D.add(mats.moss(), xf(mossGeo(rng, { r: r * rng.range(0.9, 1.3), h: 0.06 }), [p.x, p.y + r * 0.62, p.z], [rng.jitter(0.2), rng.next() * 6, rng.jitter(0.2)], [1, 1, 1.6]), { cast: false });
    }
    // a couple of toadstools nestled at the root's foot
    for (let i = 0; i < 3; i++) {
      addToadstool(D, mats, rng, x0 + s * (0.75 + rng.range(0.1, 0.4)), 0, 0.9 + rng.jitter(0.3), { size: rng.range(0.07, 0.13) });
    }
  }

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
        D.add(stem, xf(new THREE.CylinderGeometry(cr * 0.18, cr * 0.25, hgt, 5), [x, hgt / 2, z], tilt), { color: '#e9f2e6', cast: false });
        const cap = new THREE.SphereGeometry(cr, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
        cap.scale(1, 0.75, 1);
        D.add(glowCap, xf(cap, [x + tilt[2] * -hgt, hgt, z + tilt[0] * hgt], tilt), { cast: false, receive: false });
      }
    }
  }

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

  // ── worn stone steps up to the threshold ──────────────────────────────────
  {
    const stepH = y0 / 2;
    const rows = [
      { top: y0, z0: -0.02, depth: 0.5, w: W + F * 2 + 0.25, n: 2 },
      { top: stepH, z0: 0.48, depth: 0.46, w: W + F * 2 + 0.7, n: 3 },
    ];
    for (const row of rows) {
      const segW = row.w / row.n;
      for (let i = 0; i < row.n; i++) {
        const sw = segW - 0.035 + rng.jitter(0.04);
        const cx = -row.w / 2 + (i + 0.5) * segW + rng.jitter(0.02);
        const g = slab(rng, sw, row.top + 0.04, row.depth + rng.jitter(0.04));
        D.add(mats.stone(), xf(g, [cx, row.top / 2 - 0.02, row.z0 + row.depth / 2], [0, rng.jitter(0.04), 0]));
      }
      // moss in the joints and on the outer ends
      for (let i = 0; i <= row.n; i++) {
        const x = -row.w / 2 + i * segW;
        D.add(mats.moss(), xf(mossGeo(rng, { r: 0.06, h: 0.03 }), [x, row.top, row.z0 + row.depth * rng.range(0.3, 0.8)], null, [0.6, 1, 2.2]), { cast: false });
      }
    }
  }

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

  // ── the EFZ certificate under its little roof (hotspot) ────────────────────
  const cert = makeCertificate(ctx, mats.piece, rng);
  {
    const cx = R + F + 1.03, cy = 1.32;
    const mount = barkMount(ctx, cx, cy, { spreadA: 0.09, spreadY: 0.32 });
    const yaw = mount.a;
    cert.position.copy(mount.point).addScaledVector(mount.normal, 0.09);
    cert.rotation.y = yaw;
    group.add(cert);
    // two little brackets into the bark
    for (const s of [-1, 1]) {
      const p = new THREE.Vector3(s * 0.2, -0.26, -0.1).applyEuler(cert.rotation).add(cert.position);
      const q = new THREE.Vector3(s * 0.2, -0.26, -0.45).applyEuler(cert.rotation).add(cert.position);
      B.add(oakDark, xf(board(0.04, 0.05, 0.42, { along: 'z', rng }), [(p.x + q.x) / 2, p.y, (p.z + q.z) / 2], [0, yaw, 0]), { cast: false });
    }
  }

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

  // ── warm light from inside (budgeted; may be null) ─────────────────────────
  const light = ctx.lights?.addPoint?.(new THREE.Vector3(OAK.door.x + 0.25, y0 + 0.9, DOOR.z + 0.05), { color: '#ffb35c', day: 0.6, night: 5.5, distance: 5.5 });
  // light spill on the steps (additive decal, mostly at night)
  const spill = makeSpill(ctx);
  spill.position.set(OAK.door.x + 0.15, 0.003, DOOR.z + 0.15);
  group.add(spill);

  function update(dt, t) {
    const n = ctx.env?.night ?? 0;
    glimpse.emissiveIntensity = 0.55 + n * 1.6 + Math.sin(t * 7.3) * 0.03 * n + Math.sin(t * 13.1) * 0.02 * n;
    spill.material.uniforms.uK.value = 0.05 + n * 0.6;
  }

  return {
    group,
    cert,
    update,
    anchors: { lantern: lanternPos, sign },
  };
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

/** A thick worn stone slab (rounded, lumpy edges, dished top). */
function slab(rng, w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d, 6, 2, 4);
  const ox = rng.next() * 40;
  deform(g, (v) => {
    const ex = Math.abs(v.x) / (w / 2), ez = Math.abs(v.z) / (d / 2);
    const edge = Math.max(ex, ez);
    // round the top edges
    if (v.y > 0) {
      v.y -= Math.pow(Math.max(0, edge - 0.6) / 0.4, 2) * 0.05;
      // worn dip near the middle of the front
      v.y -= 0.016 * Math.exp(-(v.x * v.x) / 0.06) * (1 - ez * 0.6);
    }
    v.x += noiseA(v.z * 4 + ox, v.y * 4) * 0.025;
    v.z += noiseB(v.x * 4 + ox, v.y * 4) * 0.025;
    v.y += noiseA(v.x * 6 - ox, v.z * 6) * 0.006;
  });
  uvBox(g, 'x', 1.4, [rng.next() * 9, rng.next() * 9]);
  return g;
}

/**
 * Painted interior glimpse: warm gradient, the first turns of a spiral stair
 * going up inside the oak, a shelf with jars and a hanging lamp.
 */
function makeGlimpseMaterial() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 384;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(150, 250, 10, 128, 220, 260);
  grd.addColorStop(0, '#fff0c2');
  grd.addColorStop(0.35, '#ffc274');
  grd.addColorStop(0.75, '#b8662c');
  grd.addColorStop(1, '#4a2614');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 384);
  // floor
  g.fillStyle = 'rgba(90,45,20,0.55)';
  g.fillRect(0, 330, 256, 54);
  // spiral stair steps (silhouettes) on the right
  g.fillStyle = 'rgba(70,35,15,0.75)';
  for (let i = 0; i < 9; i++) {
    const y = 330 - i * 34;
    const x = 150 + Math.sin(i * 0.8) * 40;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 90, y - 10);
    g.lineTo(x + 90, y - 2);
    g.lineTo(x, y + 9);
    g.closePath();
    g.fill();
  }
  g.fillRect(232, 0, 10, 384);
  // shelf with jars on the left
  g.fillRect(8, 150, 90, 7);
  g.fillRect(8, 220, 90, 7);
  const jar = ['rgba(120,70,25,0.7)', 'rgba(150,90,30,0.65)', 'rgba(90,50,20,0.7)'];
  for (let i = 0; i < 5; i++) {
    g.fillStyle = jar[i % 3];
    g.fillRect(14 + i * 17, 124 + (i % 2) * 6, 12, 26 - (i % 2) * 6);
    g.fillRect(16 + i * 17, 196, 13, 24);
  }
  // hanging lamp (bright)
  g.strokeStyle = 'rgba(60,30,10,0.8)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(110, 0);
  g.lineTo(110, 70);
  g.stroke();
  const lamp = g.createRadialGradient(110, 86, 2, 110, 86, 40);
  lamp.addColorStop(0, 'rgba(255,255,235,1)');
  lamp.addColorStop(0.4, 'rgba(255,220,150,0.6)');
  lamp.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = lamp;
  g.fillRect(60, 40, 100, 100);
  // vignette near the jambs
  const v = g.createLinearGradient(0, 0, 256, 0);
  v.addColorStop(0, 'rgba(40,20,8,0.55)');
  v.addColorStop(0.18, 'rgba(40,20,8,0)');
  v.addColorStop(0.82, 'rgba(40,20,8,0)');
  v.addColorStop(1, 'rgba(40,20,8,0.5)');
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
 */
function makeCertificate(ctx, mats, rng) {
  const g = new THREE.Group();
  g.name = 'efz-certificate';
  const B = new Batch();
  const W = 0.46, H = 0.34;
  // backing board + roof
  B.add(mats.wood('spruce'), board(W + 0.16, H + 0.22, 0.04, { along: 'y', rng }).translate(0, 0.0, -0.04));
  // a little gable roof: two boards, each covered with three rows of tiny shingles
  const apex = new THREE.Vector3(0, H / 2 + 0.3, 0.03);
  for (const s of [-1, 1]) {
    // roof-board frame: x down the slope, y = board normal, z along the ridge
    const M = new THREE.Matrix4().makeRotationZ(-s * 0.55);
    if (s < 0) M.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
    M.setPosition(apex);
    const roof = board(0.36, 0.022, 0.2, { along: 'x', rng });
    B.add(mats.wood('walnut'), roof.translate(0.17, 0, 0).applyMatrix4(M));
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 5; k++) {
        const sh = board(0.075, 0.008, 0.045, { along: 'x', rng, r: 0.002 });
        sh.translate(0.34 - row * 0.1 - 0.035, 0.016 + (2 - row) * 0.004, -0.09 + k * 0.045 + (row % 2) * 0.022);
        sh.rotateZ(0.0);
        B.add(mats.wood('oak'), sh.applyMatrix4(M), { cast: false, color: k % 2 ? '#8a6a4a' : '#9a7a55' });
      }
    }
  }
  // oak frame with mitred corners
  const fw = 0.035;
  for (const [x, y, w, h] of [[0, H / 2 + fw / 2, W + fw * 2, fw], [0, -H / 2 - fw / 2, W + fw * 2, fw], [-W / 2 - fw / 2, 0, fw, H], [W / 2 + fw / 2, 0, fw, H]]) {
    B.add(mats.wood('oak'), board(w, h, 0.035, { along: w > h ? 'x' : 'y', rng, r: 0.006 }).translate(x, y, 0.0));
  }
  B.build(g, 'certificate', { mergeShadow: true });
  // the paper (canvas texture)
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 380;
  const x = c.getContext('2d');
  x.fillStyle = '#f4ead2';
  x.fillRect(0, 0, 512, 380);
  // aged edges
  const e = x.createRadialGradient(256, 190, 120, 256, 190, 330);
  e.addColorStop(0, 'rgba(0,0,0,0)');
  e.addColorStop(1, 'rgba(150,110,60,0.35)');
  x.fillStyle = e;
  x.fillRect(0, 0, 512, 380);
  x.strokeStyle = '#b08a4a';
  x.lineWidth = 4;
  x.strokeRect(18, 18, 476, 344);
  x.lineWidth = 1.5;
  x.strokeRect(28, 28, 456, 324);
  x.fillStyle = '#3b2a1e';
  x.textAlign = 'center';
  x.font = '600 26px "Fredoka", sans-serif';
  x.fillText('EIDGENÖSSISCHES FÄHIGKEITSZEUGNIS', 256, 82);
  x.font = '600 64px "Fredoka", sans-serif';
  x.fillText('Schreiner EFZ', 256, 168);
  x.font = '400 26px "Patrick Hand", cursive';
  x.fillText('Möbel- & Innenausbau', 256, 212);
  x.strokeStyle = '#6b4430';
  x.lineWidth = 1.2;
  for (const lx of [90, 330]) {
    x.beginPath();
    x.moveTo(lx, 300);
    x.lineTo(lx + 100, 300);
    x.stroke();
  }
  x.font = '400 30px "Patrick Hand", cursive';
  x.fillText('Jonny', 140, 292);
  // red seal with a Swiss cross
  x.fillStyle = '#c4271c';
  x.beginPath();
  x.arc(256, 292, 36, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#ffffff';
  x.fillRect(250, 274, 12, 36);
  x.fillRect(238, 286, 36, 12);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, name: 'efz-paper' }));
  paper.position.z = 0.005;
  paper.name = 'efz-paper';
  g.add(paper);
  return g;
}
