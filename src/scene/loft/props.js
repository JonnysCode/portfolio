// ─────────────────────────────────────────────────────────────────────────────
// The little things on the Code Loft's deck and roof:
//
//   • the hollow-log server ('project-backend'): an upright oak log with a
//     plank door standing open, rack units with blinking LEDs inside, a
//     pinwheel "fan" spinning on top, a cable bundle snaking to the house
//   • the tinkering bench ('project-side'): a small joiner's bench with a
//     wooden vice, a breadboard, a soldering iron, a multimeter, spools of
//     wire — and a little robot that waves
//   • a brass telescope on a wooden tripod pointing at the sky
//   • a weather vane (a little fish) on the front finial, a twig antenna with
//     a blinking red light at the back of the ridge
//   • a crooked lantern post (the deck's point light), lanterns on posts,
//     fairy lights along the eaves and the railing, potted ferns and flowers,
//     crates of old parts, a stool, a hanging "Code Loft" sign
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { DEG, TAU, IRON, BRASS, COPPER, lodRadial, lodSegs, addFlowerTuft, Batch, smallBitsRemap, shelfFungus, radial, polar, board, timber, branch, tubeAlong, xf, mat4, alongX, mossGeo, addToadstool, ivyCard, deform, noiseA } from './kit.js';

// one bulb colour: every colour of string light costs two more draw calls
const FAIRY = ['#ffd9a0'];

export function buildProps(ctx, B, mats, env, { deck, house, screens, updates }) {
  const { frame, rng, halos, root, reduced } = env;
  const out = {};
  const local = (x, y, z) => frame.toWorld(x, y, z);
  const lightsGroup = new THREE.Group();
  out.lightsGroup = lightsGroup;

  // ── the hollow-log server ─────────────────────────────────────────────────
  {
    const g = new THREE.Group();
    g.name = 'loft-server-log';
    const SB = new Batch();
    const R = 0.36, Hh = 1.05;
    const open = 1.25; // radians of the front opening
    // bark shell with a gap at the front (+X of the piece), inner dark wall, a rim of end grain
    const shell = new THREE.CylinderGeometry(R, R * 1.06, Hh, 18, 3, true, open / 2, TAU - open);
    deform(shell, (v) => {
      const a = Math.atan2(v.x, v.z);
      const k = 1 + 0.05 * noiseA(a * 2, v.y * 3) + (v.y < -Hh / 2 + 0.1 ? 0.06 : 0);
      v.x *= k;
      v.z *= k;
    });
    xf(shell, [0, Hh / 2, 0], [0, Math.PI / 2, 0]);
    SB.add(mats.bark(), shell);
    const inner = new THREE.CylinderGeometry(R - 0.05, R - 0.04, Hh - 0.02, 16, 1, true, open / 2, TAU - open);
    flipFaces(inner);
    SB.add(mats.wood('#5a3e2a'), xf(inner, [0, Hh / 2, 0], [0, Math.PI / 2, 0]), { cast: false });
    // end-grain top ring and the floor of the hollow
    const top = new THREE.RingGeometry(R - 0.05, R + 0.01, 18, 1, open / 2 + Math.PI / 2, TAU - open);
    top.rotateX(-Math.PI / 2);
    SB.add(mats.wood('#c9a374'), xf(top, [0, Hh + 0.001, 0], [0, 0, 0]), { cast: false });
    SB.add(mats.wood('#c9a374'), xf(new THREE.CircleGeometry(R - 0.04, 16).rotateX(-Math.PI / 2), [0, 0.03, 0]), { cast: false });
    // the cut edges of the opening
    for (const s of [-1, 1]) {
      const a = s * open / 2;
      SB.add(mats.wood('#b48d60'), xf(new THREE.BoxGeometry(0.05, Hh, 0.03), [Math.cos(a) * (R - 0.02), Hh / 2, Math.sin(a) * (R - 0.02)], [0, -a, 0]), { cast: false });
    }
    // a roof disc of end grain with growth rings, moss & a toadstool on top
    SB.add(mats.wood('#c9a374'), xf(new THREE.CylinderGeometry(R + 0.04, R + 0.04, 0.06, 20), [0, Hh + 0.03, 0]));
    for (let k = 1; k <= 4; k++) SB.add(mats.paint('#9a7650'), xf(new THREE.TorusGeometry((R * k) / 4.5, 0.004, 3, 24).rotateX(Math.PI / 2), [0, Hh + 0.062, 0]), { cast: false });
    // rack units: dark boxes with vents and LEDs (LEDs go in the screens' LED mesh)
    const units = [];
    for (let i = 0; i < 5; i++) {
      const y = 0.12 + i * 0.17;
      SB.add(mats.metal('#2c2f33'), xf(new THREE.BoxGeometry(0.34, 0.13, 0.44), [0.02, y + 0.065, 0]));
      SB.add(mats.metal('#1c1e21'), xf(new THREE.BoxGeometry(0.01, 0.1, 0.4), [0.195, y + 0.065, 0]), { cast: false });
      for (let v = 0; v < 6; v++) SB.add(mats.paint('#0d0e10'), xf(new THREE.BoxGeometry(0.004, 0.06, 0.012), [0.202, y + 0.065, -0.17 + v * 0.025]), { cast: false });
      units.push(y + 0.065);
    }
    // the plank door, open to the side
    const dm = mat4([Math.cos(open / 2) * R, 0.04, Math.sin(open / 2) * R], [0, -1.7, 0]);
    const DD = SB.at(dm);
    for (let k = 0; k < 3; k++) DD.add(mats.wood(rng.pick(['#7a5236', '#6f4a30', '#835a3b'])), xf(board(0.14, Hh - 0.1, 0.03, { along: 'y', rng }), [0.07 + k * 0.145, (Hh - 0.1) / 2, 0]));
    for (const hv of [0.2, Hh - 0.3]) DD.add(mats.metal(IRON), xf(new THREE.BoxGeometry(0.3, 0.03, 0.01), [0.15, hv, 0.02]), { cast: false });
    // a brass plaque
    SB.add(mats.metal(BRASS), xf(new THREE.BoxGeometry(0.01, 0.07, 0.16), [Math.cos(-1.2) * (R + 0.01), Hh - 0.15, Math.sin(-1.2) * (R + 0.01)], [0, 1.2, 0]), { cast: false });
    // the pinwheel's stick (the blades spin, see below)
    SB.add(mats.wood('#5e4433'), xf(new THREE.CylinderGeometry(0.008, 0.008, 0.36, 5), [0.12, Hh + 0.22, -0.1]), { cast: false });
    SB.build(g, 'loft-server', { mergeShadow: true, remap: smallBitsRemap(mats) });
    // place it against the trunk on the left wing, opening towards the camera
    const pos = local(-1.3, 0, 0.86);
    g.position.copy(pos);
    g.rotation.y = -1.0;
    root.add(g);
    g.updateMatrixWorld(true);
    // LEDs (world positions)
    const toW = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(g.matrixWorld);
    // moss and a toadstool on the log's top (static, in the main batch)
    const GW = B.at(g.matrixWorld);
    GW.add(mats.moss(), xf(mossGeo(rng, { r: 0.2, h: 0.06, sx: 1.3 }), [-0.08, Hh + 0.06, 0.12]), { cast: false });
    addToadstool(GW, mats, rng, -0.18, Hh + 0.06, -0.12, { size: 0.09 });
    const ledCols = ['#4dff7a', '#4dff7a', '#ffb02e', '#3ec9ff', '#4dff7a'];
    units.forEach((y, i) => {
      for (let k = 0; k < 5; k++) screens.addLed(toW(0.205, y + 0.03, -0.15 + k * 0.035), rng.pick(ledCols), { rate: k === 0 ? 0 : rng.pick([0.4, 3.5, 5, 2.6]), phase: rng.next() * 20, size: 0.016 });
      screens.addLed(toW(0.205, y - 0.03, 0.15), i % 2 ? '#ff4d3a' : '#4dff7a', { rate: 0.7, phase: i, size: 0.014 });
    });
    halos.push(toW(0.3, 0.5, 0), 0.7, '#9fd6ff');
    // a pinwheel "fan" spinning on top
    const fan = new THREE.Group();
    const cols = ['#e2553f', '#ffd166', '#5fb8c9', '#7aa65a'];
    const blades = new THREE.Group();
    const BB = new Batch();
    for (let k = 0; k < 4; k++) {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.lineTo(0.11, 0.02);
      s.lineTo(0.09, 0.075);
      s.lineTo(0, 0);
      const bg = new THREE.ShapeGeometry(s);
      bg.rotateZ((k / 4) * TAU);
      BB.add(mats.paint(cols[k]), bg, { cast: false });
      BB.add(mats.paint(cols[k]), bg.clone().rotateY(Math.PI), { cast: false });
    }
    BB.add(mats.metal(BRASS), new THREE.SphereGeometry(0.014, 6, 4), { cast: false });
    BB.build(blades, 'pinwheel', { mergeShadow: true, remap: smallBitsRemap(mats) });
    blades.position.set(0, 0.0, 0.02);
    fan.add(blades);
    fan.position.set(0.12, Hh + 0.4, -0.08);
    g.add(fan);
    if (!reduced) updates.push((dt) => (blades.rotation.z -= dt * 3.2));
    out.server = g;
    // cable bundle from the log to the house's left wall (lying on the deck)
    {
      const a = toW(-0.25, 0.04, -0.25);
      const door = house.door.centre;
      const pts = [a, a.clone().lerp(door, 0.3).add(new THREE.Vector3(0.1, -0.02, 0.1)), a.clone().lerp(door, 0.65).add(new THREE.Vector3(-0.15, -0.02, 0)), door.clone().add(new THREE.Vector3(-0.2, -0.75, -0.05))];
      pts.forEach((p, i) => (p.y = deck.y + 0.03 + (i === 3 ? 0.04 : 0)));
      for (let k = 0; k < 3; k++) {
        const off = new THREE.Vector3(k * 0.015, k * 0.01, k * 0.012);
        B.add(mats.paint(['#202020', '#3a4a6a', '#a8402a'][k]), tubeAlong(pts.map((p) => p.clone().add(off)), 0.011, 5), { cast: false });
      }
    }
  }

  // ── the tinkering bench with the little robot ─────────────────────────────
  {
    const g = new THREE.Group();
    g.name = 'loft-tinker-bench';
    const SB = new Batch();
    const W = 1.05, Dp = 0.46, Ht = 0.5;
    const top = mats.wood('#b08a5e');
    SB.add(top, xf(board(W, 0.06, Dp, { along: 'x', rng }), [0, Ht - 0.03, 0]));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) SB.add(mats.wood('#9a774e'), xf(board(0.06, Ht - 0.06, 0.06, { along: 'y', rng }), [sx * (W / 2 - 0.08), (Ht - 0.06) / 2, sz * (Dp / 2 - 0.06)]));
    for (const sx of [-1, 1]) SB.add(mats.wood('#9a774e'), xf(board(0.05, 0.05, Dp - 0.1, { along: 'z', rng }), [sx * (W / 2 - 0.08), 0.1, 0]), { cast: false });
    SB.add(mats.wood('#9a774e'), xf(board(W - 0.16, 0.05, 0.05, { along: 'x', rng }), [0, 0.1, 0]), { cast: false });
    // a shelf under the top with a crate of parts
    SB.add(mats.wood('#8c6a46'), xf(board(W - 0.2, 0.025, Dp - 0.12, { along: 'x', rng }), [0, 0.14, 0]), { cast: false });
    SB.add(mats.wood('#a07a50'), xf(new THREE.BoxGeometry(0.3, 0.14, 0.24), [-0.22, 0.225, 0]));
    for (let k = 0; k < 6; k++) SB.add(mats.paint(rng.pick(['#3f8f4f', '#2c5f8a', '#c9b79a', '#2a2a2a'])), xf(new THREE.BoxGeometry(0.06, 0.012, 0.08), [-0.3 + rng.next() * 0.16, 0.3, rng.jitter(0.07)], [rng.jitter(0.5), rng.jitter(1), rng.jitter(0.4)]), { cast: false });
    // the wooden vice at the front-left with its screw & handle
    SB.add(mats.wood('#8c6a46'), xf(board(0.26, 0.2, 0.05, { along: 'x', rng }), [-W / 2 + 0.2, Ht - 0.12, Dp / 2 + 0.03]));
    SB.add(mats.wood('#6b4a30'), xf(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8).rotateX(Math.PI / 2), [-W / 2 + 0.2, Ht - 0.12, Dp / 2 + 0.12]), { cast: false });
    SB.add(mats.wood('#6b4a30'), xf(new THREE.CylinderGeometry(0.01, 0.01, 0.22, 6).rotateZ(Math.PI / 2), [-W / 2 + 0.2, Ht - 0.12, Dp / 2 + 0.2]), { cast: false });
    // on top: a breadboard with chips, a multimeter, spools, a soldering iron, a lamp
    SB.add(mats.paint('#2f7a4a'), xf(new THREE.BoxGeometry(0.24, 0.012, 0.16), [0.05, Ht + 0.006, 0.04]), { cast: false });
    for (let k = 0; k < 5; k++) SB.add(mats.paint('#1d1d1f'), xf(new THREE.BoxGeometry(0.035, 0.012, 0.022), [-0.03 + (k % 3) * 0.06, Ht + 0.018, 0.0 + Math.floor(k / 3) * 0.07]), { cast: false });
    for (let k = 0; k < 6; k++) {
      const a = new THREE.Vector3(-0.05 + rng.next() * 0.2, Ht + 0.015, -0.03 + rng.next() * 0.14);
      const b = new THREE.Vector3(-0.05 + rng.next() * 0.2, Ht + 0.015, -0.03 + rng.next() * 0.14);
      const m = a.clone().lerp(b, 0.5);
      m.y += 0.04;
      SB.add(mats.paint(rng.pick(['#e2553f', '#ffd166', '#5fb8c9', '#7aa65a'])), tubeAlong([a, m, b], 0.004, 3, 6), { cast: false });
    }
    SB.add(mats.paint('#e8c33a'), xf(new THREE.BoxGeometry(0.09, 0.03, 0.14), [0.32, Ht + 0.015, 0.06], [0, -0.3, 0]));
    SB.add(mats.paint('#1d1d1f'), xf(new THREE.CylinderGeometry(0.025, 0.025, 0.006, 12), [0.32, Ht + 0.032, 0.05]), { cast: false });
    for (const [sx, c] of [[0.4, '#b87333'], [0.45, '#c0c0c0']]) SB.add(mats.metal(c), xf(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 12), [sx, Ht + 0.025, -0.14]), { cast: false });
    SB.add(mats.metal('#555b60'), xf(new THREE.CylinderGeometry(0.03, 0.035, 0.03, 8), [-0.3, Ht + 0.015, -0.12]), { cast: false });
    SB.add(mats.paint('#2a2a2a'), alongX(new THREE.CylinderGeometry(0.009, 0.012, 0.2, 6).rotateZ(Math.PI / 2), [-0.3, Ht + 0.03, -0.12], [-0.18, Ht + 0.11, -0.12]), { cast: false });
    // a magnifier lamp on an arm
    SB.add(mats.metal(BRASS), alongX(new THREE.CylinderGeometry(0.008, 0.008, 0.4, 5).rotateZ(Math.PI / 2), [W / 2 - 0.12, Ht, -Dp / 2 + 0.08], [W / 2 - 0.2, Ht + 0.38, -0.05]), { cast: false });
    SB.add(mats.metal(BRASS), xf(new THREE.TorusGeometry(0.06, 0.01, 5, 14), [W / 2 - 0.22, Ht + 0.36, 0.0], [1.0, 0, 0]), { cast: false });
    SB.add(mats.paint('#cfe3e0'), xf(new THREE.CircleGeometry(0.055, 14), [W / 2 - 0.22, Ht + 0.36, 0.0], [1.0 - Math.PI / 2, 0, 0]), { cast: false });
    // hand tools hanging from a little rail at the back — a cabinetmaker's touch
    SB.add(mats.wood('#6b4a30'), xf(board(W - 0.1, 0.04, 0.03, { along: 'x', rng }), [0, Ht + 0.32, -Dp / 2 - 0.02]), { cast: false });
    for (const sx of [-1, 1]) SB.add(mats.wood('#6b4a30'), xf(board(0.04, 0.34, 0.03, { along: 'y', rng }), [sx * (W / 2 - 0.06), Ht + 0.15, -Dp / 2 - 0.02]), { cast: false });
    for (let k = 0; k < 5; k++) {
      const x = -0.35 + k * 0.17;
      SB.add(mats.metal('#9aa3ab'), xf(new THREE.BoxGeometry(0.012, 0.16, 0.004), [x, Ht + 0.2, -Dp / 2 - 0.0]), { cast: false });
      SB.add(mats.wood(rng.pick(['#c9a374', '#8c3b2e', '#3f5f6a'])), xf(new THREE.CylinderGeometry(0.014, 0.012, 0.09, 6), [x, Ht + 0.3, -Dp / 2 - 0.0]), { cast: false });
    }
    SB.build(g, 'loft-bench', { mergeShadow: true, remap: smallBitsRemap(mats) });
    // the robot: body (+ the resting arm), head (turns, glowing eyes, antenna LED), waving arm
    const robot = new THREE.Group();
    const RB = new Batch();
    const tin = mats.paint('#c9cdd2');
    RB.add(tin, xf(new THREE.BoxGeometry(0.15, 0.15, 0.12), [0, 0.11, 0]));
    RB.add(mats.paint('#b8693a'), xf(new THREE.BoxGeometry(0.08, 0.05, 0.005), [0, 0.12, 0.062]), { cast: false });
    for (const sx of [-1, 1]) RB.add(tin, xf(new THREE.CylinderGeometry(0.025, 0.025, 0.04, 8).rotateX(Math.PI / 2), [sx * 0.05, 0.025, 0]), { cast: false }); // wheels
    // the left arm hangs at rest (static)
    RB.add(tin, xf(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6).translate(0, 0.06, 0), [-0.085, 0.15, 0], [0, 0, 2.7]), { cast: false });
    RB.build(robot, 'robot-body', { mergeShadow: true, remap: smallBitsRemap(mats) });
    const head = new THREE.Group();
    const HB = new Batch();
    HB.add(tin, xf(new THREE.BoxGeometry(0.13, 0.1, 0.11), [0, 0.05, 0]));
    for (const sx of [-1, 1]) {
      HB.add(mats.paint('#1d2a33'), xf(new THREE.CylinderGeometry(0.024, 0.024, 0.01, 12).rotateX(Math.PI / 2), [sx * 0.032, 0.055, 0.056]), { cast: false });
      HB.add(env.eyeGlow ?? (env.eyeGlow = ctx.materials.glow('#7ff0ff', { day: 1.2, night: 2.6 })), xf(new THREE.CircleGeometry(0.014, 10), [sx * 0.032, 0.055, 0.0625]), { cast: false });
    }
    HB.add(tin, xf(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 4), [0.03, 0.14, 0]), { cast: false });
    HB.add(tin, xf(new THREE.SphereGeometry(0.012, 6, 4), [0.03, 0.185, 0]), { cast: false });
    HB.build(head, 'robot-head', { mergeShadow: true, remap: smallBitsRemap(mats) });
    head.position.set(0, 0.19, 0);
    robot.add(head);
    const arm = new THREE.Group();
    const AB = new Batch();
    AB.add(tin, xf(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6), [0, 0.06, 0]));
    AB.add(tin, xf(new THREE.SphereGeometry(0.02, 6, 4), [0, 0.125, 0]), { cast: false });
    AB.build(arm, 'robot-arm', { mergeShadow: true, remap: smallBitsRemap(mats) });
    arm.position.set(0.085, 0.15, 0);
    robot.add(arm);
    robot.position.set(-0.22, Ht, 0.05);
    robot.rotation.y = 0.4;
    g.add(robot);
    const pos = local(1.0, 0, 2.55);
    g.position.copy(pos);
    g.rotation.y = 0.35;
    root.add(g);
    g.updateMatrixWorld(true);
    halos.push(new THREE.Vector3(0, 0.06, 0.1).applyMatrix4(head.matrixWorld), 0.22, '#9fd6ff');
    // a blinking status LED on the robot's chest (in the shared LED mesh)
    screens.addLed(new THREE.Vector3(0.04, 0.16, 0.064).applyMatrix4(robot.matrixWorld), '#ff4d3a', { rate: 0.8, phase: 1, size: 0.014 });
    if (!reduced) {
      let t = rng.next() * 10;
      updates.push((dt) => {
        t += dt;
        // a wave every few seconds, a curious head turn in between
        const w = t % 6;
        arm.rotation.z = w < 1.6 ? -2.4 + Math.sin(w * 9) * 0.35 : -0.25;
        head.rotation.y = Math.sin(t * 0.6) * 0.5 + (w < 1.6 ? 0.3 : 0);
      });
    } else arm.rotation.z = -0.25;
    out.bench = g;
    out.robot = robot;
  }

  // ── the telescope on its tripod ───────────────────────────────────────────
  {
    const m = new THREE.Matrix4().multiplyMatrices(frame.matrix, mat4([3.0, 0, 1.25], [0, 0.35, 0]));
    const F = B.at(m);
    const legTop = new THREE.Vector3(0, 0.78, 0);
    const legs = [0, 1, 2].map((k) => {
      const a = (k / 3) * TAU + 0.4;
      return new THREE.Vector3(Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32);
    });
    for (const f of legs) {
      F.add(mats.wood('#8a6440'), timber(f, legTop.clone().add(f.clone().multiplyScalar(0.12)), 0.035, 0.035, { rng, wobble: 0.004 }));
      F.add(mats.metal(BRASS), xf(new THREE.CylinderGeometry(0.022, 0.018, 0.04, 6), [f.x, 0.02, f.z]), { cast: false });
    }
    // spreader & mount
    F.add(mats.metal(BRASS), xf(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), [0, 0.8, 0]));
    // the tube: three telescoping brass sections, elevation ~38°, looking out of the tree
    const el = 38 * DEG;
    const dir = new THREE.Vector3(Math.cos(el), Math.sin(el), 0.18).normalize();
    const pivot = new THREE.Vector3(0, 0.86, 0);
    const secs = [[-0.32, 0.12, 0.062], [0.12, 0.42, 0.055], [0.42, 0.62, 0.048]];
    for (const [s0, s1, r] of secs) {
      const a = pivot.clone().addScaledVector(dir, s0), b = pivot.clone().addScaledVector(dir, s1);
      F.add(mats.metal(BRASS), alongX(new THREE.CylinderGeometry(r, r, s1 - s0, lodRadial(14, 8)).rotateZ(Math.PI / 2), a, b));
      F.add(mats.metal('#6a4a2a'), alongX(new THREE.CylinderGeometry(r + 0.008, r + 0.008, 0.03, lodRadial(14, 8)).rotateZ(Math.PI / 2), b.clone().addScaledVector(dir, -0.015), b.clone().addScaledVector(dir, 0.015)), { cast: false });
    }
    // dew shield & lens, eyepiece, finder scope
    const front = pivot.clone().addScaledVector(dir, 0.62);
    F.add(mats.paint('#1c2a33'), xf(new THREE.CircleGeometry(0.044, 14), [0, 0, 0]).applyMatrix4(new THREE.Matrix4().lookAt(new THREE.Vector3(), dir.clone().negate(), new THREE.Vector3(0, 1, 0)).setPosition(front.clone().addScaledVector(dir, 0.016))), { cast: false });
    const back = pivot.clone().addScaledVector(dir, -0.32);
    F.add(mats.metal('#2a2a2a'), alongX(new THREE.CylinderGeometry(0.018, 0.022, 0.1, 8).rotateZ(Math.PI / 2), back.clone().addScaledVector(dir, -0.09), back), { cast: false });
    const fa = pivot.clone().addScaledVector(dir, -0.05).add(new THREE.Vector3(0, 0.09, 0));
    F.add(mats.metal(BRASS), alongX(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 8).rotateZ(Math.PI / 2), fa, fa.clone().addScaledVector(dir, 0.22)), { cast: false });
    out.telescope = new THREE.Vector3(0, 0.9, 0).applyMatrix4(m);
    // a little stool to sit at it
    const sm = mat4([-0.42, 0, -0.2]);
    const S = F.at(sm);
    S.add(mats.wood('#9a6f45'), xf(new THREE.CylinderGeometry(0.13, 0.12, 0.05, 12), [0, 0.32, 0]));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      S.add(mats.wood('#8a6440'), alongX(new THREE.CylinderGeometry(0.015, 0.018, 0.33, 5).rotateZ(Math.PI / 2), [Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12], [Math.cos(a) * 0.07, 0.31, Math.sin(a) * 0.07]), { cast: false });
    }
  }

  // ── weather vane on the front finial: a little fish on an arrow ───────────
  {
    const base = house.ridge.front.clone();
    B.add(mats.metal(IRON), xf(new THREE.CylinderGeometry(0.012, 0.016, 0.62, 6), [base.x, base.y + 0.3, base.z]));
    // compass arms (N E S W) with little balls
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU;
      B.add(mats.metal(IRON), alongX(new THREE.CylinderGeometry(0.006, 0.006, 0.36, 4).rotateZ(Math.PI / 2), [base.x - Math.cos(a) * 0.18, base.y + 0.36, base.z - Math.sin(a) * 0.18], [base.x + Math.cos(a) * 0.18, base.y + 0.36, base.z + Math.sin(a) * 0.18]), { cast: false });
      B.add(mats.metal(BRASS), xf(new THREE.SphereGeometry(0.02, 6, 4), [base.x + Math.cos(a) * 0.19, base.y + 0.36, base.z + Math.sin(a) * 0.19]), { cast: false });
    }
    const vane = new THREE.Group();
    const VB = new Batch();
    VB.add(mats.metal(IRON), alongX(new THREE.CylinderGeometry(0.007, 0.007, 0.62, 4).rotateZ(Math.PI / 2), [-0.3, 0, 0], [0.32, 0, 0]), { cast: false });
    VB.add(mats.metal(IRON), xf(new THREE.ConeGeometry(0.035, 0.09, 4).rotateZ(-Math.PI / 2), [0.36, 0, 0]), { cast: false });
    // the fish (flat, both sides)
    const fs = new THREE.Shape();
    fs.moveTo(0.12, 0);
    fs.quadraticCurveTo(0.04, 0.09, -0.08, 0.02);
    fs.lineTo(-0.16, 0.08);
    fs.lineTo(-0.14, 0);
    fs.lineTo(-0.16, -0.08);
    fs.lineTo(-0.08, -0.02);
    fs.quadraticCurveTo(0.04, -0.09, 0.12, 0);
    const fish = new THREE.ExtrudeGeometry(fs, { depth: 0.01, bevelEnabled: false, curveSegments: 6 });
    VB.add(mats.metal(COPPER), xf(fish, [-0.14, 0.08, -0.005]));
    VB.add(mats.metal(IRON), xf(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 4), [-0.14, 0.04, 0]), { cast: false });
    VB.build(vane, 'vane', { mergeShadow: true, remap: smallBitsRemap(mats) });
    vane.position.set(base.x, base.y + 0.62, base.z);
    root.add(vane);
    let yaw = rng.next() * TAU;
    vane.rotation.y = yaw;
    if (!reduced) updates.push((dt, t) => (vane.rotation.y = yaw + Math.sin(t * 0.21) * 0.8 + Math.sin(t * 0.67) * 0.18));
  }

  // ── a robin perched on the ridge log, near the vane ──────────────────────
  {
    const r0 = house.ridge.front.clone().lerp(house.ridge.back, 0.3);
    const yaw = frame.yaw + 0.9;
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(r0.x, r0.y - 0.02, r0.z);
    const F = B.at(m);
    const paint = mats.paint();
    F.add(paint, xf(new THREE.SphereGeometry(0.075, 10, 7), [0, 0.09, 0], null, [0.9, 0.85, 1.25]), { color: '#6b5444' });
    F.add(paint, xf(new THREE.SphereGeometry(0.06, 10, 7), [0, 0.075, 0.045], null, [0.85, 0.85, 0.8]), { color: '#d8642e' }); // red breast
    F.add(paint, xf(new THREE.SphereGeometry(0.05, 10, 7), [0, 0.16, 0.06]), { color: '#6b5444' });
    F.add(paint, xf(new THREE.ConeGeometry(0.012, 0.04, 5).rotateX(Math.PI / 2), [0, 0.16, 0.12]), { color: '#2a2018' });
    for (const sx of [-1, 1]) {
      F.add(paint, xf(new THREE.SphereGeometry(0.009, 5, 4), [sx * 0.03, 0.175, 0.095]), { color: '#111111' });
      F.add(paint, xf(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 3), [sx * 0.02, 0.025, 0.0]), { color: '#3a2a20' });
    }
    F.add(paint, xf(new THREE.BoxGeometry(0.05, 0.012, 0.1), [0, 0.1, -0.12], [0.5, 0, 0]), { color: '#5a4436' }); // tail
  }

  // ── the twig antenna at the back of the ridge (blinking red light) ────────
  {
    const b = house.ridge.back.clone();
    const pts = [b.clone(), b.clone().add(new THREE.Vector3(0.03, 0.45, 0.02)), b.clone().add(new THREE.Vector3(-0.02, 0.9, 0.05)), b.clone().add(new THREE.Vector3(0.04, 1.3, 0.03))];
    B.add(mats.bark(), branch(pts, 0.03, 0.014, { radial: 5, seed: 9 }));
    const dir = new THREE.Vector3(Math.cos(frame.yaw), 0, -Math.sin(frame.yaw)); // roughly out of the tree
    const side = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    for (let k = 0; k < 4; k++) {
      const y = 0.32 + k * 0.26;
      const L = 0.5 - k * 0.09;
      const c = b.clone().add(new THREE.Vector3(0, y, 0));
      const p0 = c.clone().addScaledVector(side, -L / 2).add(new THREE.Vector3(0, rng.jitter(0.03), 0));
      const p1 = c.clone().addScaledVector(side, L / 2).add(new THREE.Vector3(0, rng.jitter(0.03), 0));
      B.add(mats.bark(), branch([p0, p0.clone().lerp(p1, 0.5).add(new THREE.Vector3(0, 0.015, 0)), p1], 0.012, 0.009, { radial: 4, seed: k }), { cast: false });
      B.add(mats.metal(COPPER), xf(new THREE.TorusGeometry(0.02, 0.005, 3, 8), [c.x, c.y, c.z], [Math.PI / 2, 0, 0]), { cast: false });
    }
    const tip = pts[3].clone().add(new THREE.Vector3(0, 0.02, 0));
    screens.addLed(tip, '#ff3b2e', { rate: 0.5, phase: 0, size: 0.05 });
    // its cable down the roof to the dormer
    const cab = [tip.clone().add(new THREE.Vector3(0, -0.6, 0.0)), b.clone().add(new THREE.Vector3(0.1, 0.0, 0.2)), house.dormer.window.clone().add(new THREE.Vector3(-0.1, 0.25, 0))];
    B.add(mats.paint('#202020'), tubeAlong(cab, 0.008, 4), { cast: false });
  }

  // ── the lantern post at the front-right edge (the deck's point light) ─────
  {
    const p0 = local(2.45, -0.05, -2.85);
    const top = p0.clone().add(new THREE.Vector3(0.05, 1.75, 0.04));
    const pts = [p0, p0.clone().add(new THREE.Vector3(-0.04, 0.6, 0.03)), p0.clone().add(new THREE.Vector3(0.05, 1.2, -0.02)), top];
    B.add(mats.bark(), branch(pts, 0.07, 0.05, { radial: 7, seed: 21 }));
    // a crooked arm reaching over the deck (towards the house)
    const toward = local(1.4, 1.75, -1.7).sub(top).setY(0).normalize();
    const armEnd = top.clone().addScaledVector(toward, 0.55).add(new THREE.Vector3(0, 0.08, 0));
    B.add(mats.bark(), branch([top.clone().add(new THREE.Vector3(0, -0.1, 0)), top.clone().addScaledVector(toward, 0.25).add(new THREE.Vector3(0, 0.1, 0)), armEnd], 0.04, 0.025, { radial: 6, seed: 22 }));
    // chain + lantern
    const hook = armEnd.clone().add(new THREE.Vector3(0, -0.02, 0));
    for (let k = 0; k < 4; k++) B.add(mats.metal(IRON), xf(new THREE.TorusGeometry(0.02, 0.005, 3, 8), [hook.x, hook.y - k * 0.035, hook.z], [0, (k % 2) * Math.PI / 2, 0]), { cast: false });
    const lantern = ctx.props.makeLantern({ hanging: true, color: '#ffc46b', halo: false });
    lantern.scale.setScalar(1.25);
    lantern.position.set(hook.x, hook.y - 0.12, hook.z);
    lightsGroup.add(lantern);
    const glass = new THREE.Vector3(hook.x, hook.y - 0.12 - 0.5 * 1.25 + 0.17 * 1.25, hook.z);
    halos.push(glass, 0.9, '#ffc46e');
    out.lanternLight = glass;
    // moss & a toadstool at its foot, ivy up the post
    B.add(mats.moss(), xf(mossGeo(rng, { r: 0.22, h: 0.07 }), [p0.x, deck.y + 0.01, p0.z]), { cast: false });
    for (let s = 0.1; s < 1.2; s += 0.25) B.add(mats.ivy(), ivyCard(p0.clone().add(new THREE.Vector3(0.06, s, 0.04)), new THREE.Vector3(rng.jitter(0.4), 1, rng.jitter(0.4)), new THREE.Vector3(1, 0, 1).normalize(), rng.range(0.25, 0.4)), { cast: false });
  }

  // small lanterns on two railing posts and at the lift
  {
    const posts = deck.railPosts;
    const pick = [Math.floor(posts.length * 0.15), Math.floor(posts.length * 0.55)];
    for (const i of pick) {
      const p = posts[i];
      if (!p) continue;
      const l = ctx.props.makeLantern({ color: '#ffc46b', halo: false });
      l.scale.setScalar(0.75);
      l.position.copy(p).add(new THREE.Vector3(0, 0.02, 0));
      lightsGroup.add(l);
      halos.push(p.clone().add(new THREE.Vector3(0, 0.15, 0)), 0.7, '#ffc46e');
    }
    if (deck.slot.postL) {
      const l = ctx.props.makeLantern({ color: '#ffc46b', halo: false, hanging: true });
      l.scale.setScalar(0.8);
      l.position.copy(deck.slot.postL).add(new THREE.Vector3(0, -0.02, 0));
      lightsGroup.add(l);
      halos.push(deck.slot.postL.clone().add(new THREE.Vector3(0, -0.28, 0)), 0.7, '#ffc46e');
    }
  }

  // ── fairy lights: eaves, the porch festoon, along the railing ─────────────
  {
    for (const pts of house.lightPts) lightsGroup.add(ctx.props.makeStringLights(pts, { sag: 0.06, spacing: 0.42, colors: FAIRY }));
    // festoon from the front gable to the lantern post
    if (out.lanternLight) {
      const a = house.lightPts[0][house.lightPts[0].length - 1];
      lightsGroup.add(ctx.props.makeStringLights([a, out.lanternLight.clone().add(new THREE.Vector3(0, 0.55, 0))], { sag: 0.12, spacing: 0.4, colors: FAIRY }));
    }
    // along the railing tops (every other post, sagging between)
    const posts = deck.railPosts;
    // a festoon along part of the front railing only (not a wall of light)
    const n0 = Math.floor(posts.length * 0.12), n1 = Math.floor(posts.length * 0.62);
    for (let i = n0; i + 2 <= n1; i += 2) {
      if (posts[i].distanceTo(posts[i + 2]) > 2.2) continue;
      lightsGroup.add(ctx.props.makeStringLights([posts[i].clone().add(new THREE.Vector3(0, 0.02, 0)), posts[i + 2].clone().add(new THREE.Vector3(0, 0.02, 0))], { sag: 0.16, spacing: 0.56, colors: FAIRY }));
    }
    // up the bark above the deck (like the trunk in the fly-agaric reference)
    const bark = env.bark;
    const pts = [];
    for (let d = -6; d <= 30; d += 9) {
      const a = d * DEG;
      const y = deck.y + 2.3 + Math.sin(d * 0.15) * 0.25 + (d % 18 === 0 ? 0.25 : 0);
      const r = bark(a, y) + 0.1;
      pts.push(new THREE.Vector3(Math.sin(a) * r, y, -6 + Math.cos(a) * r));
    }
    lightsGroup.add(ctx.props.makeStringLights(pts, { sag: 0.1, spacing: 0.42, colors: FAIRY }));
  }

  // ── firefly jars & hanging baskets: little hanging things everywhere ──────
  {
    const ropeMat = mats.rope();
    const wisp = mats.wisp();
    /** a glass jar full of fireflies hanging on a string from `hook` */
    const jar = (hook, drop = 0.35, s = 1) => {
      const c = hook.clone().add(new THREE.Vector3(rng.jitter(0.02), -drop, rng.jitter(0.02)));
      B.add(ropeMat, tubeAlong([hook, hook.clone().lerp(c, 0.5).add(new THREE.Vector3(0.01, 0, 0)), c.clone().add(new THREE.Vector3(0, 0.02, 0))], 0.006, 3, 4), { cast: false });
      // wire handle, cork, the softly glowing jar (a little bulge, a neck)
      B.add(mats.metal(IRON), xf(new THREE.TorusGeometry(0.045 * s, 0.004, 3, 10, Math.PI), [c.x, c.y - 0.02 * s, c.z], [0, rng.next() * 3, 0]), { cast: false });
      B.add(mats.wood('#8a6440'), xf(new THREE.CylinderGeometry(0.036 * s, 0.03 * s, 0.035 * s, 8), [c.x, c.y - 0.03 * s, c.z]), { cast: false });
      const body = new THREE.LatheGeometry([[0.001, 0], [0.05, 0.004], [0.058, 0.04], [0.056, 0.1], [0.04, 0.125], [0.034, 0.14]].map(([r, y]) => new THREE.Vector2(r * s, y * s)), 10);
      B.add(wisp, xf(body, [c.x, c.y - 0.19 * s, c.z]), { cast: false });
      halos.push(new THREE.Vector3(c.x, c.y - 0.12 * s, c.z), 0.38 * s, '#9fd6ff');
    };
    /** a moss-lined hanging basket overflowing with trailing ivy and flowers */
    const basket = (hook, drop = 0.42) => {
      const c = hook.clone().add(new THREE.Vector3(0, -drop, 0));
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU;
        const rim = c.clone().add(new THREE.Vector3(Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15));
        B.add(ropeMat, tubeAlong([hook, rim], 0.006, 3, 2), { cast: false });
      }
      const bowl = new THREE.SphereGeometry(0.17, 12, 5, 0, TAU, Math.PI / 2, Math.PI / 2);
      B.add(mats.wood('#7a5a3e'), xf(bowl, [c.x, c.y + 0.02, c.z], null, [1, 0.8, 1]));
      B.add(mats.moss(), xf(mossGeo(rng, { r: 0.16, h: 0.07 }), [c.x, c.y, c.z]), { cast: false });
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * TAU + rng.jitter(0.3);
        const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        B.add(mats.ivy(), ivyCard(c.clone().addScaledVector(out, 0.14).add(new THREE.Vector3(0, 0.02, 0)), new THREE.Vector3(out.x * 0.25, -1, out.z * 0.25), out, rng.range(0.28, 0.55), rng.next() < 0.5), { cast: false });
      }
      addFlowerTuft(B.at(new THREE.Matrix4()), mats, rng, c.x, c.y + 0.04, c.z, { r: 0.11, h: 0.16, blooms: 6 });
    };
    // from the front eave corners of the house
    const L0 = house.lightPts[0], L1 = house.lightPts[1];
    if (L0?.length) jar(L0[0].clone().add(new THREE.Vector3(0, -0.02, 0)), 0.32, 1.1);
    if (L1?.length) basket(L1[L1.length - 1].clone().add(new THREE.Vector3(0, -0.02, 0)), 0.36);
    // from the middle of the left eave, over the open door
    const L2 = house.lightPts[2];
    if (L2?.length > 2) jar(L2[2].clone().lerp(L2[3], 0.5).add(new THREE.Vector3(0, -0.04, 0)), 0.36);
    // from the deck's hanging ropes, just above the railing
    for (const r of deck.ropes.slice(0, 3)) {
      const h = r.low.clone().lerp(r.top, 0.3);
      jar(h, 0.28, 0.9);
    }
  }

  // ── pots, ferns, flowers, crates, a watering can ──────────────────────────
  {
    const pot = (x, z, r, color, kind) => {
      const p = local(x, 0, z);
      const pr = lodRadial(12, 8);
      B.add(mats.clay(color), xf(new THREE.CylinderGeometry(r, r * 0.78, r * 1.3, pr), [p.x, p.y + r * 0.65, p.z]));
      B.add(mats.clay(color), xf(new THREE.TorusGeometry(r, r * 0.12, lodSegs(5, 3), lodRadial(14, 8)).rotateX(Math.PI / 2), [p.x, p.y + r * 1.3, p.z]), { cast: false });
      B.add(mats.paint('#3d2b1e'), xf(new THREE.CircleGeometry(r * 0.92, pr).rotateX(-Math.PI / 2), [p.x, p.y + r * 1.22, p.z]), { cast: false });
      if (kind === 'fern') {
        for (let k = 0; k < 10; k++) {
          const ang = (k / 10) * TAU + rng.jitter(0.3);
          const dir = new THREE.Vector3(Math.cos(ang) * 0.7, rng.range(0.5, 1.2), Math.sin(ang) * 0.7);
          B.add(mats.ivy(), ivyCard(new THREE.Vector3(p.x, p.y + r * 1.2, p.z), dir, new THREE.Vector3(Math.cos(ang), 0.6, Math.sin(ang)), r * rng.range(2.4, 3.4), rng.next() < 0.5), { cast: false });
        }
      }
      else {
        const F0 = B.at(new THREE.Matrix4());
        addFlowerTuft(F0, mats, rng, p.x, p.y + r * 1.22, p.z, { r: r * 0.75, h: r * 1.6, blooms: rng.int(5, 8) });
        addFlowerTuft(F0, mats, rng, p.x + rng.jitter(r * 0.3), p.y + r * 1.22, p.z + rng.jitter(r * 0.3), { r: r * 0.5, h: r * 1.1, blooms: 3 });
      }
    };
    const hf = house.footprint;
    const hp = (dx, dz) => {
      // a point relative to the house (house-local dx, dz) in deck-local coords
      const c = Math.cos(hf.yaw), s = Math.sin(hf.yaw);
      return [hf.x + dx * c + dz * s, hf.z - dx * s + dz * c];
    };
    let [x, z] = hp(1.45, 1.05);
    pot(x, z, 0.15, '#b5633e', 'fern');
    [x, z] = hp(1.4, -1.1);
    pot(x, z, 0.12, '#a85a3a', 'flowers');
    [x, z] = hp(1.62, -0.85);
    pot(x, z, 0.09, '#c27a4e', 'flowers');
    pot(0.2, 3.35, 0.13, '#b5633e', 'fern');
    pot(2.85, -1.55, 0.11, '#a85a3a', 'flowers');
    // crates of old parts by the house's right side
    [x, z] = hp(0.2, -1.75);
    const cp = local(x, 0, z);
    for (let k = 0; k < 2; k++) {
      const c = new THREE.Vector3(cp.x + k * 0.05, cp.y + 0.15 + k * 0.3, cp.z + k * 0.04);
      const g = new THREE.Group();
      g.position.copy(c);
      g.rotation.y = frame.yaw + rng.jitter(0.3);
      g.updateMatrixWorld(true);
      const F = B.at(g.matrixWorld);
      for (const sy of [-0.1, 0.0, 0.1]) {
        F.add(mats.wood('#a07a50'), xf(board(0.46, 0.08, 0.02, { rng }), [0, sy, 0.17]));
        F.add(mats.wood('#a07a50'), xf(board(0.46, 0.08, 0.02, { rng }), [0, sy, -0.17]));
        F.add(mats.wood('#a07a50'), xf(board(0.02, 0.08, 0.32, { along: 'z', rng }), [0.22, sy, 0]));
        F.add(mats.wood('#a07a50'), xf(board(0.02, 0.08, 0.32, { along: 'z', rng }), [-0.22, sy, 0]));
      }
      F.add(mats.wood('#8a6440'), xf(board(0.44, 0.02, 0.32, { rng }), [0, -0.14, 0]), { cast: false });
      if (k === 1) {
        // floppy disks and an old keyboard poking out
        for (let i = 0; i < 4; i++) F.add(mats.paint(rng.pick(['#2c5f8a', '#1d1d1f', '#c9b79a'])), xf(new THREE.BoxGeometry(0.09, 0.09, 0.006), [-0.12 + i * 0.06, 0.12, rng.jitter(0.06)], [rng.jitter(0.3), 0, rng.jitter(0.2)]), { cast: false });
        F.add(mats.paint('#d8cfbd'), xf(new THREE.BoxGeometry(0.4, 0.02, 0.12), [0.02, 0.13, -0.06], [0.5, 0.1, 0]), { cast: false });
      }
    }
    // a watering can by the fern
    {
      const wp = local(0.45, 0, 3.2);
      B.add(mats.metal('#5d7a72'), xf(new THREE.CylinderGeometry(0.08, 0.09, 0.16, 12), [wp.x, wp.y + 0.08, wp.z]));
      B.add(mats.metal('#5d7a72'), alongX(new THREE.CylinderGeometry(0.012, 0.018, 0.22, 6).rotateZ(Math.PI / 2), [wp.x + 0.06, wp.y + 0.08, wp.z], [wp.x + 0.22, wp.y + 0.2, wp.z + 0.04]), { cast: false });
      B.add(mats.metal('#5d7a72'), xf(new THREE.TorusGeometry(0.06, 0.01, 4, 10, Math.PI), [wp.x - 0.01, wp.y + 0.16, wp.z]), { cast: false });
    }
  }

  // ── shelf fungi on the knee-braces and the rim; glow-caps by the bark ────
  {
    const fungusTop = mats.paint('#b06a34'), fungusUnder = mats.paint('#efe0c0');
    const place = (pos, normal, r) => {
      const { top, under } = shelfFungus(r, rng);
      const n = normal.clone().setY(0).normalize();
      const x = new THREE.Vector3(0, 1, 0).cross(n).normalize();
      const m = new THREE.Matrix4().makeBasis(x, new THREE.Vector3(0, 1, 0), n).setPosition(pos);
      m.multiply(new THREE.Matrix4().makeRotationX(rng.jitter(0.12)));
      B.add(fungusTop, top.applyMatrix4(m), { color: rng.pick(['#b06a34', '#c47f45', '#9a5a2e', '#d2a060']), cast: false });
      B.add(fungusUnder, under.applyMatrix4(m), { cast: false });
    };
    for (const br of deck.braces) {
      const side = new THREE.Vector3(Math.cos(br.a), 0, -Math.sin(br.a)).multiplyScalar(rng.next() < 0.5 ? 1 : -1);
      const k = rng.int(2, 4);
      for (let i = 0; i < k; i++) {
        const p = br.foot.clone().lerp(br.top, 0.16 + i * 0.1 + rng.jitter(0.02)).addScaledVector(side, 0.075);
        place(p, side, rng.range(0.12, 0.19) * (1 - i * 0.12));
      }
    }
    // glow-caps: a cluster of tiny luminous toadstools by the bark, between the stairwell and the lift
    const glowCap = mats.wisp();
    const stemMat = mats.paint('#e8f0e0');
    // a cluster of glow-caps on the bark above the server log (they light up at night)
    for (let i = 0; i < 13; i++) {
      const a = (38 + rng.range(-7, 7)) * DEG;
      const y = deck.y + 0.35 + Math.abs(rng.jitter(1)) * 1.25;
      const pos = polar(a, env.bark(a, y) - 0.005, y);
      const cr = rng.range(0.035, 0.075) * (1.3 - (y - deck.y) / 2.5);
      const n = radial(a);
      // a short stem out of the bark, the cap turned up and out
      const stem = new THREE.CylinderGeometry(cr * 0.22, cr * 0.3, cr * 1.2, lodRadial(5, 4)).translate(0, cr * 0.6, 0);
      const cap = new THREE.SphereGeometry(cr, lodRadial(8, 6), lodSegs(4, 3), 0, TAU, 0, Math.PI / 2).scale(1, 0.7, 1).translate(0, cr * 1.15, 0);
      const m = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(0.9 + rng.jitter(0.25))).setPosition(pos);
      B.add(stemMat, stem.applyMatrix4(m), { cast: false });
      B.add(glowCap, cap.applyMatrix4(m), { cast: false });
      halos.push(pos.clone().addScaledVector(n, cr * 1.2).add(new THREE.Vector3(0, cr, 0)), cr * 6, '#9fd6ff');
    }
  }

  // ── a villager coding on the porch: a laptop on the knees, on a stump stool ─
  if (ctx.props.makePerson) {
    const seatH = 0.34;
    const c = local(2.55, 0, -2.1);
    const stump = new THREE.CylinderGeometry(0.19, 0.22, seatH, 12, 2);
    B.add(mats.bark(), xf(stump, [c.x, c.y + seatH / 2, c.z]));
    B.add(mats.wood('#c9a374'), xf(new THREE.CircleGeometry(0.19, 12).rotateX(-Math.PI / 2), [c.x, c.y + seatH + 0.002, c.z]), { cast: false });
    B.add(mats.moss(), xf(mossGeo(rng, { r: 0.16, h: 0.05 }), [c.x + 0.12, c.y + 0.02, c.z - 0.1]), { cast: false });
    const person = ctx.props.makePerson({ seed: 'loft-coder', hat: 'beanie', hatColor: '#3f6f8f', shirt: '#e8a838', holding: 'laptop', glasses: true, scarf: false });
    person.setAction?.('sit');
    person.group.position.set(c.x, c.y + seatH, c.z);
    // facing the Code Loft camera (and the view out of the tree)
    person.group.rotation.y = 0.55;
    root.add(person.group);
    out.person = person;
  }

  // ── the "Snail Lift" plate, nailed to the bark high above the lift gate —
  //    over the snail's head when it rests at the top, clear of the server log
  if (env.boards) {
    const a = deck.slot.a;
    const y = deck.y + 2.38;
    const c = polar(a, env.bark(a, y) + 0.1, y);
    const m = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationZ(0.04)).setPosition(c);
    addSignPlate(B, mats, rng, env.boards, m, 0.66);
    // hung from two iron spikes driven into the bark
    for (const sx of [-1, 1]) {
      const sp = c.clone().add(new THREE.Vector3(Math.cos(a) * sx * 0.25, 0.14, -Math.sin(a) * sx * 0.25));
      B.add(mats.metal(IRON), xf(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 5).rotateX(Math.PI / 2), [sp.x, sp.y, sp.z], [0, a, 0]), { cast: false });
      B.add(mats.rope(), tubeAlong([sp, c.clone().add(new THREE.Vector3(Math.cos(a) * sx * 0.25, 0.06, -Math.sin(a) * sx * 0.25)).addScaledVector(radial(a), 0.01)], 0.005, 3, 2), { cast: false });
    }
  }

  return out;
}

/** A wooden plate with two nails and the painted "Snail Lift" faces (boards atlas). */
export function addSignPlate(B, mats, rng, boards, m, w = 0.6) {
  const F = B.at(m);
  const h = boards.addSign(m, w);
  F.add(mats.wood('#6b4a30'), board(w + 0.05, h + 0.05, 0.03, { rng }));
  for (const sx of [-1, 1]) F.add(mats.metal(IRON), xf(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 6).rotateX(Math.PI / 2), [sx * (w / 2 - 0.02), 0, 0.022]), { cast: false });
}

/** Reverse a geometry's faces (for the inside of the hollow log). */
function flipFaces(geo) {
  if (geo.index) {
    const ia = geo.index.array;
    for (let i = 0; i < ia.length; i += 3) [ia[i + 1], ia[i + 2]] = [ia[i + 2], ia[i + 1]];
  }
  const n = geo.attributes.normal;
  for (let i = 0; i < n.array.length; i++) n.array[i] = -n.array[i];
  return geo;
}
