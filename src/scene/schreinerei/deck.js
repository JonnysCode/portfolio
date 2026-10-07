// ─────────────────────────────────────────────────────────────────────────────
// The gallery deck (SCHREINEREI.deck): a small raised oak deck beside the oak
// door where Jonny's finished pieces are shown IN USE.
//
//   • the solid-oak dining table (breadboard ends, pegged mortise & tenon
//     base), four chairs, a tea set and two villagers having tea → 'dining-table'
//   • the record cabinet (sliding doors, LPs inside) → 'record-cabinet'
//   • the record player (cherry plinth, a record turning quietly with the
//     arm down, open dust cover) with two little speakers → 'record-player'
//     (click: opens its entry AND toggles the music, ♪ notes float up)
//   • a low coffee table with a book and a plant, an armchair → 'coffee-table'
//   • railings, lanterns, fairy lights strung above between poles & the oak.
// Every piece is its own group (hotspot root) built from merged parts.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { SCHREINEREI } from '../../world/layout.js';
import { createRng } from '../../core/rng.js';
import { Batch, board, xf, mat4, stoneGeo, mossGeo, uvBox, peg, addToadstool, addFern, addLantern, addFairyLights, SPECIES } from './kit.js';
import { makeNotes } from './fx.js';
import { barkMount } from './door.js';

const D = SCHREINEREI.deck;
export const DECK = { hw: 2.0, hd: 1.42, h: 0.3, matrix: mat4([D.x, 0, D.z], [0, D.rotY, 0]) };

/** Deck-local → world. */
function toWorld(x, y, z, out = new THREE.Vector3()) {
  return out.set(x, y, z).applyMatrix4(DECK.matrix);
}

export function buildDeck(ctx, B, mats) {
  const rng = createRng('deck');
  const group = new THREE.Group();
  group.name = 'schreinerei-deck';
  group.position.set(D.x, 0, D.z);
  group.rotation.y = D.rotY;
  ctx.scene.add(group);
  const F = B.at(DECK.matrix);
  const { hw, hd, h } = DECK;
  const oak = mats.wood('oak');
  const tim = mats.timber();

  // ── structure: stone footings, posts, beams, joists, decking, fascia ──────
  for (const x of [-hw + 0.15, 0, hw - 0.15]) {
    for (const z of [-hd + 0.15, hd - 0.15]) {
      F.add(mats.stone(), xf(stoneGeo(rng, { r: 1, sx: 0.17, sy: 0.12, sz: 0.17 }), [x, 0.05, z]));
      F.add(tim, xf(board(0.12, h - 0.14, 0.12, { along: 'y', rng }), [x, (h - 0.14) / 2 + 0.08, z]), { cast: false });
    }
  }
  for (const z of [-hd + 0.15, hd - 0.15]) F.add(tim, xf(board(hw * 2, 0.1, 0.12, { along: 'x', rng }), [0, h - 0.1, z]));
  const boardW = 0.16;
  for (let z = -hd + boardW / 2; z < hd; z += boardW) {
    const bw = boardW - 0.012;
    const g = board(hw * 2 + 0.04 + rng.jitter(0.03), 0.035, bw, { along: 'x', rng, scale: 1 / 1.6 });
    F.add(tim, xf(g, [rng.jitter(0.015), h - 0.0175, z], [0, rng.jitter(0.004), 0]));
    // nail heads at the joists (flush little discs)
    for (const x of [-hw + 0.15, 0, hw - 0.15]) for (const s of [-1, 1]) F.add(mats.metal('#3a332d'), xf(new THREE.CircleGeometry(0.008, 5), [x + rng.jitter(0.01), h + 0.0012, z + s * 0.04], [-Math.PI / 2, 0, 0]), { cast: false, receive: false });
  }
  // fascia boards
  F.add(oak, xf(board(hw * 2 + 0.08, 0.14, 0.03, { along: 'x', rng }), [0, h - 0.08, hd + 0.015]));
  for (const s of [-1, 1]) F.add(oak, xf(board(0.03, 0.14, hd * 2 + 0.06, { along: 'z', rng }), [s * (hw + 0.035), h - 0.08, 0]));
  // two steps down at the front-left (towards the door path)
  for (let i = 0; i < 2; i++) {
    const sy = h * (1 - (i + 1) / 3);
    F.add(oak, xf(board(0.9, 0.035, 0.26, { along: 'x', rng }), [-hw + 0.55, sy, hd + 0.16 + i * 0.25]));
    for (const s of [-1, 1]) F.add(tim, xf(board(0.05, sy, 0.2, { along: 'y', rng }), [-hw + 0.55 + s * 0.4, sy / 2, hd + 0.16 + i * 0.25]), { cast: false });
  }

  // ── railing on the back and right side, carved balusters ─────────────────
  const railH = 0.62;
  const railPosts = [];
  const railRun = (a, b) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / 0.95));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      F.add(tim, xf(board(0.08, railH + 0.06, 0.08, { along: 'y', rng }), [x, h + (railH + 0.06) / 2, z]));
      F.add(oak, xf(new THREE.SphereGeometry(0.05, 8, 6), [x, h + railH + 0.08, z], null, [1, 0.8, 1]), { cast: false });
      railPosts.push([x, z]);
    }
    const ang = Math.atan2(b[0] - a[0], b[1] - a[1]) - Math.PI / 2;
    for (const y of [railH, 0.12]) {
      F.add(oak, xf(board(len + 0.08, 0.055, 0.07, { along: 'x', rng }), [(a[0] + b[0]) / 2, h + y, (a[1] + b[1]) / 2], [0, ang, 0]));
    }
    const nb = Math.round(len / 0.13);
    for (let i = 1; i < nb; i++) {
      const t = i / nb;
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      // turned profile (its ends hide in the rails)
      const bal = new THREE.LatheGeometry([[0.018, 0], [0.018, 0.04], [0.026, 0.12], [0.014, 0.22], [0.022, 0.3], [0.014, 0.38], [0.018, 0.47]].map(([r, y]) => new THREE.Vector2(r, y)), 6);
      F.add(mats.wood('oak'), xf(uvBox(bal, 'y'), [x, h + 0.14, z]), { cast: false });
    }
  };
  railRun([-hw + 0.04, -hd + 0.04], [hw - 0.04, -hd + 0.04]);
  railRun([hw - 0.04, -hd + 0.04], [hw - 0.04, hd - 0.04]);

  // potted plants & moss & toadstools around the footings
  for (let i = 0; i < 12; i++) {
    const side = rng.next() < 0.5;
    const x = side ? rng.range(-hw, hw) : (rng.next() < 0.5 ? -1 : 1) * (hw + 0.15);
    const z = side ? (hd + 0.12) * (rng.next() < 0.3 ? -1 : 1) : rng.range(-hd, hd);
    if (x < -hw + 1.1 && z > 0) continue; // keep the steps clear
    F.add(mats.moss(), xf(mossGeo(rng, { r: rng.range(0.12, 0.25), h: 0.06 }), [x, 0, z]), { cast: false });
    if (rng.next() < 0.5) addToadstool(F, mats, rng, x + rng.jitter(0.1), 0, z + rng.jitter(0.1), { size: rng.range(0.07, 0.12) });
  }
  addFern(F, ctx, rng, hw + 0.35, 0, -hd + 0.2, { size: 0.55 });
  addFern(F, ctx, rng, hw + 0.25, 0, hd - 0.1, { size: 0.45 });

  // ── the pieces ─────────────────────────────────────────────────────────────
  // the furniture is a touch bigger than the villagers' everyday props so the
  // chibi guests sit at it naturally
  const FS = 1.15;
  const pm = mats.piece;
  const table = buildDiningTable(ctx, pm, rng);
  table.position.set(-0.6, h, -0.08);
  table.scale.setScalar(FS);
  group.add(table);
  // the candle's flame rides in the Schreinerei's shared lamp-glow mesh
  {
    const f = table.userData.flame;
    F.add(mats.glow('#ffcf7a', 0.6), xf(new THREE.SphereGeometry(0.008, 6, 4), [table.position.x + f.x * FS, h + f.y * FS, table.position.z + f.z * FS], null, [FS, 1.8 * FS, FS]), { cast: false, receive: false });
  }
  const cabX = 0.55;
  const cabinet = buildRecordCabinet(ctx, pm, rng);
  cabinet.position.set(cabX, h, -hd + 0.3);
  cabinet.scale.setScalar(FS);
  group.add(cabinet);
  // the record player is the deck's star: a touch over-sized (cute) so the
  // spinning record and its tonearm read from the woodworking camera
  const PS = 1.45;
  const reduced = !!ctx.engine?.reducedMotion;
  const player = buildRecordPlayer(ctx, pm, rng, { idleSpin: !reduced });
  player.group.position.set(cabX, h + cabinet.userData.topY * FS, -hd + 0.33);
  player.group.scale.setScalar(PS);
  group.add(player.group);
  const coffee = buildCoffeeTable(ctx, pm, rng);
  coffee.position.set(0.82, h, 0.78);
  coffee.rotation.y = -0.2;
  coffee.scale.setScalar(FS);
  group.add(coffee);
  const chair = buildArmchair(ctx, pm, rng);
  chair.position.set(1.62, h, -0.88);
  chair.rotation.y = -0.75;
  chair.scale.setScalar(FS);
  group.add(chair);

  // ── a ginger cat asleep on the armchair cushion (breathes slowly) ────────
  const cat = makeSleepingCat(ctx);
  cat.group.position.set(0.02, 0.33, 0.04);
  cat.group.rotation.y = 0.6;
  chair.add(cat.group);

  // ── the tea party: two villagers on the chairs at the back of the table ───
  const guests = [];
  {
    const seats = table.userData.seats;
    const looks = [
      { seed: 'tea-mira', hat: 'straw', holding: 'mug', hair: 'bun', scarf: true },
      { seed: 'tea-ueli', hat: 'mushroom', holding: 'mug', beard: true, glasses: true },
    ];
    table.updateMatrix();
    seats.slice(0, 2).forEach((s, i) => {
      const p = ctx.props.makePerson({ ...looks[i], action: 'sit' });
      p.group.position.set(s.x, s.y, s.z).applyMatrix4(table.matrix);
      p.group.rotation.y = s.rotY + table.rotation.y;
      group.add(p.group);
      guests.push(p);
    });
    // they look at each other now and then
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    guests[0].group.updateWorldMatrix(true, false);
    guests[1].group.updateWorldMatrix(true, false);
    guests[0].lookAt(guests[1].group.getWorldPosition(b).setY(b.y + 0.55));
    guests[1].lookAt(guests[0].group.getWorldPosition(a).setY(a.y + 0.55));
  }

  // ── fairy lights on poles and into the oak ────────────────────────────────
  {
    const poleH = 2.35;
    const poles = [[-hw + 0.04, -hd + 0.04], [hw - 0.04, -hd + 0.04]];
    for (const [x, z] of poles) {
      F.add(tim, xf(board(0.07, poleH - railH, 0.07, { along: 'y', rng }), [x, h + railH + (poleH - railH) / 2, z]));
      F.add(mats.metal('#2f2b28'), xf(new THREE.TorusGeometry(0.03, 0.008, 4, 8), [x, h + poleH + 0.02, z], [Math.PI / 2, 0, 0]), { cast: false });
    }
    // anchor in the bark: the trunk near the door, right side
    const ya = 2.7;
    const ax = 2.05;
    const barkW = barkMount(ctx, ax, ya, { spreadA: 0.02, spreadY: 0.05 }).point;
    const barkLocal = barkW.clone().applyMatrix4(DECK.matrix.clone().invert());
    const pts = [
      { x: barkLocal.x, y: barkLocal.y, z: barkLocal.z },
      { x: poles[0][0], y: h + poleH, z: poles[0][1] },
      { x: poles[1][0], y: h + poleH, z: poles[1][1] },
      { x: -hw + 0.2, y: h + poleH - 0.25, z: hd + 0.4 },
    ];
    addFairyLights(F, mats, pts.map((p) => [p.x, p.y, p.z]), (v) => v.applyMatrix4(DECK.matrix), { sag: 0.09, spacing: 0.27 });
    // a lantern hanging from the front-right pole
    const lp = [hw - 0.04 - 0.16, h + poleH - 0.3, -hd + 0.04];
    addLantern(F, mats, lp, toWorld(...lp), { scale: 0.85 });
    F.add(mats.metal('#2f2b28'), xf(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 4), [hw - 0.13, h + poleH - 0.28, -hd + 0.04], [0, 0, Math.PI / 2]), { cast: false });
    // the pole on the front-left stands in a planter box full of flowers
    {
      const px = -hw + 0.2, pz = hd + 0.4;
      F.add(tim, xf(board(0.07, poleH + h - 0.1, 0.07, { along: 'y', rng }), [px, (poleH + h - 0.1) / 2 + 0.1, pz]), { cast: false });
      F.add(mats.wood('oak'), xf(board(0.46, 0.3, 0.34, { along: 'x', rng }), [px, 0.15, pz]));
      F.add(mats.soil(), xf(new THREE.BoxGeometry(0.4, 0.02, 0.28), [px, 0.3, pz]), { cast: false });
      const vc = mats.vc();
      for (let i = 0; i < 14; i++) {
        const x = px + rng.jitter(0.18), z = pz + rng.jitter(0.12), hh = rng.range(0.08, 0.22);
        F.add(vc, xf(new THREE.CylinderGeometry(0.004, 0.005, hh, 3), [x, 0.3 + hh / 2, z]), { color: '#4f7f36', cast: false });
        F.add(vc, xf(new THREE.SphereGeometry(rng.range(0.02, 0.035), 6, 4), [x, 0.3 + hh, z], null, [1, 0.6, 1]), { color: rng.pick(['#d6332a', '#f2ead8', '#e8c22a', '#b39ddb', '#ef7a5a']), cast: false });
      }
      addFern(F, ctx, rng, px + 0.12, 0.3, pz - 0.05, { size: 0.3, fronds: 5 });
    }
  }
  const light = ctx.lights?.addPoint?.(toWorld(0, h + 1.9, 0), { color: '#ffc477', day: 0.3, night: 3.2, distance: 6 });

  // ── record player behaviour ────────────────────────────────────────────────
  const notes = makeNotes(ctx, { origin: toWorld(cabX, h + cabinet.userData.topY * FS + 0.26, -hd + 0.3) });
  ctx.scene.add(notes.object);
  // `playing` = the music. Until the visitor first touches it the record turns
  // quietly with the arm down (a lived-in deck); a click starts the music and
  // the notes, the next click lifts the arm and stops the platter.
  let playing = false;
  function togglePlaying() {
    playing = !playing;
    player.setPlaying(playing);
    notes.setPlaying(playing);
    if (playing) ctx.audio?.playMusic?.('record');
    else ctx.audio?.stopMusic?.();
  }

  return {
    group,
    table,
    cabinet,
    player: player.group,
    coffee,
    cat: cat.group,
    light,
    togglePlaying,
    get playing() {
      return playing;
    },
    update(dt, t) {
      player.update(dt, t);
      notes.update(dt, t);
      cat.update(dt, t);
    },
  };
}

// ─── furniture ───────────────────────────────────────────────────────────────
/**
 * Solid-oak dining table: a glued-up top with breadboard ends (pegged, with
 * the tongue's end visible), four legs joined by pegged mortise & tenon
 * aprons and a low stretcher; four chairs; a tea set. userData.seats.
 */
function buildDiningTable(ctx, mats, rng) {
  const g = new THREE.Group();
  g.name = 'dining-table';
  const Bt = new Batch();
  const oak = mats.wood('oak');
  const L = 1.3, W = 0.64, T = 0.045, H = 0.47;
  // top: 4 glued-up boards (each its own tone, as boards from one log differ)
  // + breadboard ends across the grain; faint glue lines between the boards
  const be = 0.07;
  const oakC = new THREE.Color(SPECIES.oak);
  const tones = [1.05, 0.95, 1.03, 0.96];
  for (let i = 0; i < 4; i++) {
    const bw = W / 4;
    const c = oakC.clone().multiplyScalar(tones[i]);
    Bt.add(mats.wood('#' + c.getHexString()), xf(board(L - be * 2, T, bw - 0.002, { along: 'x', rng, r: 0.004 }), [0, H - T / 2, -W / 2 + bw * (i + 0.5)]));
    if (i) Bt.add(mats.vc(), xf(new THREE.BoxGeometry(L - be * 2 - 0.01, 0.0012, 0.0025), [0, H + 0.0004, -W / 2 + bw * i]), { color: '#6b5236', cast: false });
  }
  for (const s of [-1, 1]) {
    Bt.add(oak, xf(board(be, T + 0.004, W + 0.01, { along: 'z', rng, r: 0.006 }), [s * (L / 2 - be / 2), H - T / 2, 0]));
    // draw-bore pegs through the breadboard
    for (const z of [-0.2, 0, 0.2]) Bt.add(mats.wood('walnut'), xf(new THREE.CylinderGeometry(0.009, 0.009, 0.004, 8), [s * (L / 2 - be / 2), H + 0.001, z]), { cast: false });
  }
  // legs (slightly tapered) with aprons; pegs show the mortise & tenon joints
  const lx = L / 2 - 0.13, lz = W / 2 - 0.07;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = board(0.06, H - T, 0.06, { along: 'y', rng });
      Bt.add(oak, xf(leg, [sx * lx, (H - T) / 2, sz * lz]));
      // peg heads on the outer faces
      for (const dy of [-0.025, 0.025]) {
        Bt.add(mats.wood('walnut'), xf(peg(0.007, 0.006), [sx * lx, H - T - 0.06 + dy, sz * (lz + 0.031)], [0, sz < 0 ? Math.PI : 0, 0]), { cast: false });
        Bt.add(mats.wood('walnut'), xf(peg(0.007, 0.006), [sx * (lx + 0.031), H - T - 0.06 + dy, sz * lz], [0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, 0]), { cast: false });
      }
    }
    Bt.add(oak, xf(board(0.03, 0.09, W - 0.2, { along: 'z', rng }), [sx * lx, H - T - 0.06, 0]));
  }
  for (const sz of [-1, 1]) Bt.add(oak, xf(board(L - 0.32, 0.09, 0.03, { along: 'x', rng }), [0, H - T - 0.06, sz * lz]));
  // low stretcher with wedged through-tenons
  for (const sx of [-1, 1]) Bt.add(oak, xf(board(0.04, 0.05, W - 0.2, { along: 'z', rng }), [sx * lx, 0.1, 0]));
  Bt.add(oak, xf(board(L - 0.18, 0.05, 0.04, { along: 'x', rng }), [0, 0.1, 0]));
  for (const sx of [-1, 1]) Bt.add(mats.wood('walnut'), xf(new THREE.BoxGeometry(0.006, 0.055, 0.042), [sx * (lx + 0.04), 0.1, 0]), { cast: false });

  // chairs: two behind the table (guests), one at each end
  const seats = [];
  const chairAt = (x, z, rotY, pull = 0) => {
    const c = chairGeos(Bt, mats, rng, mat4([x, 0, z], [0, rotY, 0]));
    seats.push({ x: x + Math.sin(rotY) * (0.02 + pull), y: c.seatY + 0.03, z: z + Math.cos(rotY) * (0.02 + pull), rotY });
  };
  // (no chair at the right end: nothing may hide the record player)
  chairAt(-0.3, -W / 2 - 0.2, 0, 0);
  chairAt(0.3, -W / 2 - 0.22, 0.1);
  chairAt(-L / 2 - 0.26, 0.08, Math.PI / 2 - 0.25);
  // the tea set (teapot, cups on saucers, cookies, flowers, a candle)
  g.userData.flame = addTeaSet(Bt, mats, rng, H);
  Bt.build(g, 'dining-table', { mergeShadow: true });
  // guests: the one behind the table and the one at the left end
  g.userData.seats = [seats[0], seats[2]];
  g.userData.topY = H;
  return g;
}

/** A sturdy oak chair (villager scale, seat 0.3): pegged joints, spindle back. Returns { seatY }. */
function chairGeos(Bt, mats, rng, m) {
  const oak = mats.wood('oak');
  const seatY = 0.3, s = 0.36;
  const parts = [];
  parts.push([oak, board(s, 0.035, s, { along: 'x', rng }).translate(0, seatY, 0)]);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const tall = z < 0;
    const hh = tall ? seatY + 0.44 : seatY;
    parts.push([oak, board(0.04, hh, 0.04, { along: 'y', rng }).translate(x * (s / 2 - 0.03), hh / 2, z * (s / 2 - 0.03))]);
  }
  parts.push([oak, board(s, 0.07, 0.03, { along: 'x', rng }).translate(0, seatY + 0.4, -s / 2 + 0.03)]);
  parts.push([oak, board(s, 0.04, 0.025, { along: 'x', rng }).translate(0, seatY + 0.16, -s / 2 + 0.03)]);
  for (let i = 0; i < 4; i++) parts.push([oak, board(0.018, 0.22, 0.018, { along: 'y', rng }).translate(-0.09 + i * 0.06, seatY + 0.27, -s / 2 + 0.03)]);
  for (const x of [-1, 1]) parts.push([oak, board(0.025, 0.025, s - 0.06, { along: 'z', rng }).translate(x * (s / 2 - 0.03), 0.1, 0)]);
  parts.push([mats.fabric('#9c4a3a'), new THREE.CylinderGeometry(0.15, 0.16, 0.035, 12).translate(0, seatY + 0.03, 0.01)]);
  for (const [mat, geo] of parts) Bt.add(mat, geo.applyMatrix4(m), { cast: mat === oak });
  return { seatY: seatY + 0.035 };
}

/** Teapot, cups & saucers, a plate of cookies, wildflowers in a jar, a candle. */
function addTeaSet(Bt, mats, rng, H) {
  const china = mats.vc();
  const top = H + 0.001;
  // a linen runner
  Bt.add(mats.fabric('#efe2c4'), xf(new THREE.BoxGeometry(0.95, 0.004, 0.24), [0, top + 0.002, 0]), { cast: false });
  // teapot: round body, lid with knob, spout, handle
  {
    const tx = 0.05, tz = 0.0;
    const body = new THREE.SphereGeometry(0.075, 14, 10);
    body.scale(1, 0.82, 1);
    Bt.add(china, xf(body, [tx, top + 0.065, tz]), { color: '#3f6f8f', cast: false });
    Bt.add(china, xf(new THREE.CylinderGeometry(0.04, 0.045, 0.02, 12), [tx, top + 0.125, tz]), { color: '#3f6f8f', cast: false });
    Bt.add(china, xf(new THREE.SphereGeometry(0.014, 8, 6), [tx, top + 0.142, tz]), { color: '#f2ead8', cast: false });
    const spout = new THREE.CylinderGeometry(0.008, 0.016, 0.08, 8);
    Bt.add(china, xf(spout, [tx + 0.085, top + 0.08, tz], [0, 0, -0.9]), { color: '#3f6f8f', cast: false });
    Bt.add(china, xf(new THREE.TorusGeometry(0.035, 0.008, 6, 12, Math.PI * 1.2), [tx - 0.078, top + 0.07, tz], [0, 0, Math.PI / 2 - 0.3]), { color: '#3f6f8f', cast: false });
    // little white dots painted on the pot
    for (let i = 0; i < 10; i++) {
      const a = rng.next() * Math.PI * 2, e = rng.range(-0.5, 0.8);
      Bt.add(china, xf(new THREE.SphereGeometry(0.006, 4, 3), [tx + Math.cos(a) * Math.cos(e) * 0.074, top + 0.065 + Math.sin(e) * 0.061, tz + Math.sin(a) * Math.cos(e) * 0.074]), { color: '#f2ead8', cast: false });
    }
  }
  // cups on saucers (in front of the guests and two more)
  for (const [x, z, c] of [[-0.3, -0.16, '#f2ead8'], [0.45, -0.05, '#e8c27a'], [0.32, 0.16, '#f2ead8'], [-0.42, 0.14, '#c96a4a']]) {
    Bt.add(china, xf(new THREE.CylinderGeometry(0.045, 0.04, 0.008, 14), [x, top + 0.004, z]), { color: '#f2ead8', cast: false });
    const cup = new THREE.CylinderGeometry(0.03, 0.022, 0.04, 12, 1, true);
    Bt.add(china, xf(cup, [x, top + 0.028, z]), { color: c, cast: false });
    Bt.add(china, xf(new THREE.CircleGeometry(0.028, 12), [x, top + 0.04, z], [-Math.PI / 2, 0, 0]), { color: '#8a4a22', cast: false });
    Bt.add(china, xf(new THREE.TorusGeometry(0.012, 0.004, 4, 8), [x + 0.033, top + 0.03, z]), { color: c, cast: false });
  }
  // plate of cookies
  Bt.add(china, xf(new THREE.CylinderGeometry(0.07, 0.06, 0.01, 16), [-0.12, top + 0.005, 0.07]), { color: '#f2ead8', cast: false });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    Bt.add(china, xf(new THREE.CylinderGeometry(0.022, 0.022, 0.008, 10), [-0.12 + Math.cos(a) * 0.035, top + 0.014 + (i % 2) * 0.005, 0.07 + Math.sin(a) * 0.035], [rng.jitter(0.2), 0, rng.jitter(0.2)]), { color: '#c98a4b', cast: false });
  }
  // wildflowers in a jar
  {
    const jx = -0.48, jz = -0.02;
    Bt.add(mats.glass(), xf(new THREE.CylinderGeometry(0.03, 0.028, 0.08, 10), [jx, top + 0.04, jz]), { cast: false, receive: false });
    for (let i = 0; i < 7; i++) {
      const a = rng.next() * Math.PI * 2, r = rng.range(0.01, 0.05), hh = rng.range(0.1, 0.17);
      const fx = jx + Math.cos(a) * r, fz = jz + Math.sin(a) * r;
      Bt.add(china, xf(new THREE.CylinderGeometry(0.002, 0.002, hh, 3), [(jx + fx) / 2, top + 0.03 + hh / 2, (jz + fz) / 2], [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3]), { color: '#4f7f36', cast: false });
      Bt.add(china, xf(new THREE.SphereGeometry(0.016, 6, 4), [fx, top + 0.03 + hh, fz]), { color: rng.pick(['#f2ead8', '#e8c22a', '#b39ddb', '#ef7a5a', '#7fb3e0']), cast: false });
    }
  }
  // a candle in a brass holder (its flame glows at night — returned, the deck
  // merges it into the shared lamp glow)
  Bt.add(mats.wood('#b8893a'), xf(new THREE.CylinderGeometry(0.03, 0.035, 0.01, 10), [0.2, top + 0.005, 0.02]), { cast: false });
  Bt.add(china, xf(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 8), [0.2, top + 0.045, 0.02]), { color: '#f7efdf', cast: false });
  return new THREE.Vector3(0.2, top + 0.088, 0.02);
}

/**
 * Sideboard for LPs: walnut carcass with dovetailed corners, two sliding
 * doors (one slid aside to show the records), on a tapered-leg stand.
 */
function buildRecordCabinet(ctx, mats, rng) {
  const g = new THREE.Group();
  g.name = 'record-cabinet';
  const Bc = new Batch();
  const walnut = mats.wood('walnut');
  const W = 0.92, Dp = 0.3, Hc = 0.3, legH = 0.12;
  const y0 = legH;
  const t = 0.022;
  // carcass
  Bc.add(walnut, xf(board(W, t, Dp, { along: 'x', rng, r: 0.004 }), [0, y0 + Hc - t / 2, 0]));
  Bc.add(walnut, xf(board(W, t, Dp, { along: 'x', rng, r: 0.004 }), [0, y0 + t / 2, 0]));
  for (const s of [-1, 1]) Bc.add(walnut, xf(board(t, Hc, Dp, { along: 'y', rng, r: 0.004 }), [s * (W / 2 - t / 2), y0 + Hc / 2, 0]));
  Bc.add(walnut, xf(board(W - 2 * t, Hc - 2 * t, 0.01, { along: 'x', rng }), [0, y0 + Hc / 2, -Dp / 2 + 0.005]));
  Bc.add(walnut, xf(board(0.015, Hc - 2 * t, Dp - 0.02, { along: 'y', rng }), [0, y0 + Hc / 2, 0]), { cast: false });
  // through-dovetails at the top corners: the tails' end grain shows on the
  // sides — darker than the walnut's long grain (one species, no contrast inlay)
  const tailEnd = mats.wood('#35251b');
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const z = -Dp / 2 + 0.04 + k * ((Dp - 0.08) / 3);
      const tail = new THREE.Shape([new THREE.Vector2(-0.012, 0), new THREE.Vector2(0.012, 0), new THREE.Vector2(0.018, t), new THREE.Vector2(-0.018, t)]);
      const tg = new THREE.ShapeGeometry(tail);
      Bc.add(tailEnd, xf(tg, [s * (W / 2 + 0.0005), y0 + Hc - t, z], [0, s * Math.PI / 2, 0]), { cast: false });
    }
  }
  // sliding doors: two panels with a finger pull; the left one slid right
  const dw = (W - 2 * t) / 2 + 0.01;
  Bc.add(mats.wood('oak'), xf(board(dw, Hc - 2 * t - 0.01, 0.014, { along: 'x', rng }), [W / 2 - t - dw / 2, y0 + Hc / 2, Dp / 2 - 0.012]));
  Bc.add(mats.wood('oak'), xf(board(dw, Hc - 2 * t - 0.01, 0.014, { along: 'x', rng }), [W / 2 - t - dw / 2 - 0.06, y0 + Hc / 2, Dp / 2 - 0.03]));
  Bc.add(mats.vc(), xf(new THREE.BoxGeometry(0.012, 0.06, 0.004), [W / 2 - t - dw + 0.04, y0 + Hc / 2, Dp / 2 - 0.004]), { color: '#2a1b10', cast: false });
  // LPs standing in the open half (colourful spines)
  const spineCols = ['#d6332a', '#e8c22a', '#2f5d8a', '#1c1c1c', '#f2ead8', '#3e7a4a', '#c96a4a', '#7a4a9a', '#e2553f', '#1c1c1c', '#5fb8c9', '#d9a441'];
  const vc = mats.vc();
  for (let i = 0; i < 26; i++) {
    const x = -W / 2 + t + 0.01 + i * 0.0155;
    if (x > -0.02) break;
    const lean = i > 20 ? 0.12 : rng.jitter(0.03);
    Bc.add(vc, xf(new THREE.BoxGeometry(0.012, Hc - 2 * t - 0.03, Dp - 0.06), [x, y0 + Hc / 2 - 0.01, 0.0], [0, 0, lean]), { color: rng.pick(spineCols), cast: false });
  }
  // stand: tapered legs, splayed
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.014, 0.009, legH + 0.01, 8);
      Bc.add(walnut, xf(uvBox(leg, 'y'), [sx * (W / 2 - 0.08), legH / 2, sz * (Dp / 2 - 0.05)], [sz * 0.12, 0, -sx * 0.12]));
    }
  }
  // a few LPs leaning in a crate beside the cabinet
  {
    const cx = -W / 2 - 0.2, cz = 0.04;
    for (const [x, w, d] of [[0, 0.02, 0.36], [0.2, 0.02, 0.36]]) Bc.add(mats.wood('spruce'), xf(board(w, 0.2, d, { along: 'y', rng }), [cx - 0.1 + x, 0.1, cz]));
    Bc.add(mats.wood('spruce'), xf(board(0.22, 0.02, 0.36, { along: 'x', rng }), [cx, 0.01, cz]));
    for (let i = 0; i < 8; i++) {
      Bc.add(vc, xf(new THREE.BoxGeometry(0.008, 0.3, 0.3), [cx - 0.08 + i * 0.022, 0.16, cz], [0, 0, -0.35 + i * 0.04]), { color: rng.pick(spineCols), cast: false });
    }
  }
  Bc.build(g, 'record-cabinet', { mergeShadow: true });
  g.userData.topY = y0 + Hc;
  return g;
}

/**
 * The record player: cherry plinth on brass feet, aluminium platter with a
 * spinning record (big red label), a pale tonearm resting on the record,
 * open dust cover, and two little walnut speakers on either side.
 * opts.idleSpin: the record turns quietly (arm down) until first toggled.
 */
function buildRecordPlayer(ctx, mats, rng, { idleSpin = true } = {}) {
  const g = new THREE.Group();
  g.name = 'record-player';
  const Bp = new Batch();
  const plinth = mats.wood('cherry');
  const walnut = mats.wood('walnut');
  const PW = 0.34, PD = 0.27, PH = 0.055;
  Bp.add(plinth, xf(board(PW, PH, PD, { along: 'x', rng, r: 0.008 }), [0, PH / 2 + 0.012, 0]));
  // a thin maple stringer along the plinth's front edge
  Bp.add(mats.wood('maple'), xf(new THREE.BoxGeometry(PW - 0.02, 0.006, 0.003), [0, PH / 2 + 0.012, PD / 2 + 0.001]), { cast: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) Bp.add(mats.metal('#b8893a'), xf(new THREE.CylinderGeometry(0.014, 0.016, 0.012, 10), [sx * (PW / 2 - 0.03), 0.006, sz * (PD / 2 - 0.03)]), { cast: false });
  const steel = mats.metal('#d4d6d8');
  // platter: its bright rim frames the black record
  Bp.add(steel, xf(new THREE.CylinderGeometry(0.112, 0.108, 0.014, 32), [-0.04, PH + 0.019, 0]), { cast: false });
  // speed knob & a little brass power button
  Bp.add(steel, xf(new THREE.CylinderGeometry(0.013, 0.013, 0.014, 10), [-PW / 2 + 0.03, PH + 0.018, PD / 2 - 0.03]), { cast: false });
  Bp.add(mats.metal('#c9a04a'), xf(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 8), [-PW / 2 + 0.06, PH + 0.017, PD / 2 - 0.03]), { cast: false });
  // tonearm base & rest
  const armBase = new THREE.Vector3(0.12, PH + 0.012, -0.08);
  Bp.add(steel, xf(new THREE.CylinderGeometry(0.02, 0.024, 0.03, 12), [armBase.x, armBase.y + 0.015, armBase.z]), { cast: false });
  Bp.add(steel, xf(new THREE.CylinderGeometry(0.005, 0.005, 0.04, 6), [0.13, PH + 0.03, 0.08]), { cast: false });
  // dust cover, hinged open at the back (opened past upright, resting on its
  // hinges' stops — clear of the platter) with two little hinge blocks
  const cover = new THREE.BoxGeometry(PW - 0.01, 0.04, PD - 0.03);
  cover.translate(0, 0.02, (PD - 0.03) / 2);
  xf(cover, [0, PH + 0.014, -PD / 2 + 0.024], [-1.62, 0, 0]);
  Bp.add(ctx.materials.surface('glass'), cover, { cast: false, receive: false });
  for (const sx of [-1, 1]) Bp.add(mats.metal('#2a2624'), xf(new THREE.BoxGeometry(0.03, 0.024, 0.02), [sx * (PW / 2 - 0.05), PH + 0.022, -PD / 2 + 0.02]), { cast: false });
  // speakers
  for (const s of [-1, 1]) {
    const sx = s * 0.3;
    Bp.add(walnut, xf(board(0.12, 0.2, 0.12, { along: 'y', rng, r: 0.008 }), [sx, 0.1, 0.0]));
    Bp.add(mats.fabric('#4a4038'), xf(new THREE.BoxGeometry(0.1, 0.17, 0.004), [sx, 0.105, 0.061]), { cast: false });
    Bp.add(mats.vc(), xf(new THREE.CylinderGeometry(0.03, 0.022, 0.008, 14), [sx, 0.08, 0.064], [Math.PI / 2, 0, 0]), { color: '#1c1a18', cast: false });
    Bp.add(mats.metal('#c9a04a'), xf(new THREE.CylinderGeometry(0.011, 0.011, 0.006, 10), [sx, 0.155, 0.064], [Math.PI / 2, 0, 0]), { cast: false });
  }
  Bp.build(g, 'record-player', { mergeShadow: true });

  // spinning record (own mesh) with a label
  const rec = new THREE.Group();
  rec.position.set(-0.04, PH + 0.028, 0);
  const vinyl = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.004, 40), makeVinylMaterial());
  vinyl.name = 'vinyl';
  rec.add(vinyl);
  g.add(rec);
  // tonearm (pivot group swings): pale, a bit chunky so it reads
  const arm = new THREE.Group();
  arm.position.copy(armBase).add(new THREE.Vector3(0, 0.03, 0));
  const Ba = new Batch();
  const armTube = new THREE.CylinderGeometry(0.0055, 0.0055, 0.2, 6);
  armTube.rotateX(Math.PI / 2);
  armTube.translate(0, 0.004, 0.1);
  Ba.add(steel, armTube, { cast: false });
  Ba.add(mats.metal('#2a2624'), xf(new THREE.BoxGeometry(0.026, 0.01, 0.036), [0, 0.0, 0.208]), { cast: false });
  Ba.add(mats.metal('#e8e2d0'), xf(new THREE.BoxGeometry(0.004, 0.012, 0.004), [0, -0.008, 0.216]), { cast: false });
  Ba.add(steel, xf(new THREE.CylinderGeometry(0.016, 0.016, 0.028, 10), [0, 0.006, -0.032], [Math.PI / 2, 0, 0]), { cast: false });
  Ba.build(arm, 'tonearm', { mergeShadow: true });
  g.add(arm);
  const REST = 0.12, PLAY = -0.58;
  // start in the playing pose when the record turns idly
  let target = idleSpin ? 1 : 0;
  let spin = target, armK = target;
  arm.rotation.y = REST + (PLAY - REST) * armK;
  return {
    group: g,
    setPlaying(on) {
      target = on ? 1 : 0;
    },
    update(dt) {
      dt = Math.min(dt, 0.1);
      // the arm lifts over first, then the platter spins up
      armK += (target - armK) * Math.min(1, dt * 2.2);
      arm.rotation.y = REST + (PLAY - REST) * armK;
      arm.rotation.x = -Math.sin(Math.PI * armK) * 0.06;
      spin += ((target > 0.5 && armK > 0.6 ? 1 : 0) - spin) * Math.min(1, dt * 1.5);
      rec.rotation.y -= dt * spin * 3.49;
    },
  };
}

function makeVinylMaterial() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#141212';
  x.fillRect(0, 0, 256, 256);
  // grooves, with two darker gaps between tracks and a soft sheen
  for (let r = 54; r < 127; r += 2) {
    const gap = Math.abs(r - 80) < 2 || Math.abs(r - 104) < 2;
    x.strokeStyle = gap ? 'rgba(0,0,0,0.6)' : `rgba(255,255,255,${0.05 + ((r * 7) % 5) * 0.01})`;
    x.beginPath();
    x.arc(128, 128, r, 0, Math.PI * 2);
    x.stroke();
  }
  const sheen = x.createLinearGradient(40, 40, 216, 216);
  sheen.addColorStop(0.0, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  sheen.addColorStop(0.55, 'rgba(255,255,255,0.12)');
  sheen.addColorStop(1.0, 'rgba(255,255,255,0)');
  x.fillStyle = sheen;
  x.beginPath();
  x.arc(128, 128, 127, 0, Math.PI * 2);
  x.fill();
  // big label: red with a cream ring and a yellow half so the turning shows
  x.fillStyle = '#d6332a';
  x.beginPath();
  x.arc(128, 128, 52, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#f2c94a';
  x.beginPath();
  x.arc(128, 128, 52, Math.PI * 0.1, Math.PI * 0.6);
  x.lineTo(128, 128);
  x.fill();
  x.strokeStyle = '#f2ead8';
  x.lineWidth = 4;
  x.beginPath();
  x.arc(128, 128, 49, 0, Math.PI * 2);
  x.stroke();
  x.fillStyle = '#f2ead8';
  x.font = '600 20px "Fredoka", sans-serif';
  x.textAlign = 'center';
  x.fillText('JONNY', 128, 120);
  x.font = '400 12px "Fredoka", sans-serif';
  x.fillText('side A · 33⅓', 128, 148);
  x.fillStyle = '#111';
  x.beginPath();
  x.arc(128, 128, 3, 0, Math.PI * 2);
  x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.32, metalness: 0.1, name: 'vinyl' });
}

/** Low coffee table (oak top on a walnut frame) with a book, a mug and a plant. */
function buildCoffeeTable(ctx, mats, rng) {
  const g = new THREE.Group();
  g.name = 'coffee-table';
  const Bk = new Batch();
  const oak = mats.wood('oak');
  const L = 0.62, W = 0.36, H = 0.22;
  Bk.add(oak, xf(board(L, 0.035, W, { along: 'x', rng, r: 0.008 }), [0, H - 0.0175, 0]));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) Bk.add(mats.wood('walnut'), xf(board(0.035, H - 0.035, 0.035, { along: 'y', rng }), [sx * (L / 2 - 0.06), (H - 0.035) / 2, sz * (W / 2 - 0.05)]));
    Bk.add(mats.wood('walnut'), xf(board(0.03, 0.03, W - 0.1, { along: 'z', rng }), [sx * (L / 2 - 0.06), 0.06, 0]));
  }
  Bk.add(mats.wood('walnut'), xf(board(L - 0.12, 0.02, W - 0.12, { along: 'x', rng }), [0, 0.07, 0]));
  // a rug underneath
  Bk.add(mats.fabric('#8e5a42'), xf(new THREE.CylinderGeometry(0.62, 0.62, 0.008, 28), [0, 0.004, 0.0], null, [1.25, 1, 0.9]), { cast: false });
  Bk.add(mats.fabric('#b89a62'), xf(new THREE.TorusGeometry(0.56, 0.012, 3, 28), [0, 0.009, 0.0], [Math.PI / 2, 0, 0], [1.25, 0.9, 1]), { cast: false });
  Bk.add(mats.fabric('#6f7a5a'), xf(new THREE.TorusGeometry(0.45, 0.01, 3, 28), [0, 0.009, 0.0], [Math.PI / 2, 0, 0], [1.25, 0.9, 1]), { cast: false });
  // an open book
  const vc = mats.vc();
  for (const s of [-1, 1]) {
    Bk.add(vc, xf(new THREE.BoxGeometry(0.1, 0.012, 0.14), [-0.1 + s * 0.05, H + 0.008, 0.02], [0, 0.2, s * 0.08]), { color: '#f7efdf', cast: false });
  }
  Bk.add(vc, xf(new THREE.BoxGeometry(0.21, 0.004, 0.15), [-0.1, H + 0.002, 0.02], [0, 0.2, 0]), { color: '#2f5d8a', cast: false });
  // a stack of two books
  Bk.add(vc, xf(new THREE.BoxGeometry(0.14, 0.025, 0.1), [0.18, H + 0.012, -0.08], [0, -0.2, 0]), { color: '#3e7a4a', cast: false });
  Bk.add(vc, xf(new THREE.BoxGeometry(0.12, 0.022, 0.09), [0.18, H + 0.035, -0.08], [0, 0.1, 0]), { color: '#c96a4a', cast: false });
  // potted plant: clay pot + leafy fronds
  {
    const px = 0.17, pz = 0.07;
    Bk.add(mats.clay('#b8653f'), xf(uvBox(new THREE.CylinderGeometry(0.045, 0.035, 0.07, 12), 'y'), [px, H + 0.035, pz]), { cast: false });
    Bk.add(mats.wood('#3a2a1e'), xf(new THREE.CircleGeometry(0.042, 10), [px, H + 0.068, pz], [-Math.PI / 2, 0, 0]), { cast: false });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rng.jitter(0.3);
      const leaf = new THREE.SphereGeometry(0.035, 6, 4);
      leaf.scale(0.55, 0.12, 1.3);
      leaf.translate(0, 0, 0.04);
      Bk.add(vc, xf(leaf, [px, H + 0.09 + rng.range(0, 0.04), pz], [-0.7 + rng.jitter(0.2), a, 0]), { color: rng.pick(['#4f7f36', '#5e8c3a', '#3f6b2f']), cast: false });
    }
  }
  // a mug
  Bk.add(vc, xf(new THREE.CylinderGeometry(0.025, 0.022, 0.05, 10), [0.0, H + 0.025, -0.1]), { color: '#e8c27a', cast: false });
  Bk.add(vc, xf(new THREE.TorusGeometry(0.014, 0.004, 4, 8), [0.026, H + 0.026, -0.1]), { color: '#e8c27a', cast: false });
  Bk.build(g, 'coffee-table', { mergeShadow: true });
  return g;
}

/** A Schreiner-made armchair: oak frame, loose cushions. */
function buildArmchair(ctx, mats, rng) {
  const g = new THREE.Group();
  g.name = 'armchair';
  const Ba = new Batch();
  const oak = mats.wood('oak');
  const W = 0.5, Dp = 0.46, seat = 0.24;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) Ba.add(oak, xf(board(0.04, sz < 0 ? 0.6 : 0.38, 0.04, { along: 'y', rng }), [sx * (W / 2 - 0.03), (sz < 0 ? 0.6 : 0.38) / 2, sz * (Dp / 2 - 0.03)], [sz < 0 ? -0.12 : 0, 0, 0]));
    Ba.add(oak, xf(board(0.06, 0.03, Dp + 0.04, { along: 'z', rng }), [sx * (W / 2 - 0.03), 0.39, 0.02]));
    Ba.add(oak, xf(board(0.035, 0.035, Dp - 0.06, { along: 'z', rng }), [sx * (W / 2 - 0.03), 0.1, 0]));
  }
  Ba.add(oak, xf(board(W - 0.06, 0.04, Dp - 0.06, { along: 'x', rng }), [0, seat - 0.04, 0]));
  Ba.add(mats.fabric('#5e7a52'), xf(board(W - 0.1, 0.09, Dp - 0.08, { along: 'x', r: 0.035 }), [0, seat + 0.02, 0.02]));
  Ba.add(mats.fabric('#5e7a52'), xf(board(W - 0.1, 0.3, 0.08, { along: 'x', r: 0.035 }), [0, seat + 0.2, -Dp / 2 + 0.06], [-0.18, 0, 0]));
  Ba.add(mats.fabric('#e8c27a'), xf(board(0.18, 0.14, 0.06, { along: 'x', r: 0.03 }), [0.08, seat + 0.13, -0.1], [-0.3, 0.3, 0.2]));
  Ba.build(g, 'armchair', { mergeShadow: true });
  return g;
}

/**
 * A ginger tabby curled up asleep (cute stylised, like the villagers): body,
 * tucked head with ears, tail wrapped round, stripes. Breathes slowly.
 */
function makeSleepingCat(ctx) {
  const g = new THREE.Group();
  g.name = 'sleeping-cat';
  const Bc = new Batch();
  const mat = ctx.materials.toon('#ffffff', { vertexColors: true, name: 'props-vc' });
  const ginger = '#e08a3c', light = '#f6d3a4', dark = '#b5602a';
  const body = new THREE.SphereGeometry(0.1, 14, 10);
  body.scale(1.15, 0.62, 0.95);
  // tabby stripes across the back
  const pos = body.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    c.set(y < -0.02 ? light : Math.sin(x * 70) > 0.45 ? dark : ginger);
    col.set([c.r, c.g, c.b], i * 3);
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  Bc.add(mat, body.translate(0, 0.055, 0));
  // head tucked against the body, nose down, eyes shut
  const head = new THREE.SphereGeometry(0.06, 12, 8);
  head.scale(1.1, 0.9, 1);
  Bc.add(mat, head.translate(0.1, 0.06, 0.035), { color: ginger });
  Bc.add(mat, new THREE.SphereGeometry(0.035, 8, 6).scale(1, 0.7, 1).translate(0.135, 0.045, 0.06), { color: light });
  for (const s of [-1, 1]) {
    Bc.add(mat, xf(new THREE.ConeGeometry(0.022, 0.04, 4), [0.1 + s * 0.028, 0.115, 0.02], [0, 0, -s * 0.35]), { color: dark });
    // closed eyes: little dark arcs
    Bc.add(mat, xf(new THREE.TorusGeometry(0.009, 0.0025, 3, 6, Math.PI), [0.118 + s * 0.022, 0.07, 0.088], [0, 0, Math.PI]), { color: '#3b2a1e' });
  }
  Bc.add(mat, new THREE.SphereGeometry(0.006, 5, 4).translate(0.14, 0.055, 0.094), { color: '#d87a7a' });
  // tail wrapped around the front
  const tail = new THREE.TorusGeometry(0.1, 0.022, 6, 14, Math.PI * 1.1);
  Bc.add(mat, xf(tail, [0.0, 0.02, 0.0], [Math.PI / 2, 0, 0.6], [1.1, 0.95, 1]), { color: ginger });
  Bc.add(mat, new THREE.SphereGeometry(0.024, 8, 6).translate(0.11, 0.022, 0.08), { color: light });
  Bc.build(g, 'cat', { mergeShadow: true });
  const breath = g.children[0];
  return {
    group: g,
    update(dt, t) {
      // a slow sleepy breath
      const k = 1 + Math.sin(t * 1.4) * 0.03;
      breath.scale.set(1, k, 1 + (k - 1) * 0.5);
      breath.updateMatrix();
    },
  };
}
