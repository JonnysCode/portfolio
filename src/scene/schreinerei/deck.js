// ─────────────────────────────────────────────────────────────────────────────
// The gallery deck (SCHREINEREI.deck): a small raised oak deck beside the oak
// door where Jonny's finished pieces are shown IN USE.
//
//   • the dining table in oiled oak (glued-up top, breadboard ends with
//     walnut draw-bore pegs, chamfered legs, pegged mortise & tenon aprons, a
//     stretcher with wedged through-tenons), three Swiss Stabellen (plank
//     seats, splayed legs wedged through, carved backrests with a heart
//     cut-out), a tea set and two villagers having tea → 'dining-table'
//   • the record cabinet (sliding doors, LPs inside) → 'record-cabinet'
//   • the record player (cherry plinth, a record turning quietly with the
//     arm down, open dust cover) with two little speakers → 'record-player'
//     (click: opens its entry AND toggles the music, ♪ notes float up)
//   • a low coffee table: a live-edge oak slab whose natural split is held by
//     two walnut butterfly keys, walnut legs through-tenoned and wedged in
//     contrasting maple; a book, a plant, a mug; an armchair with the
//     sleeping cat → 'coffee-table'
//   • railings, lanterns, fairy lights strung above between poles & the oak.
// Every piece is its own group (hotspot root) built from merged parts.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { SCHREINEREI } from '../../world/layout.js';
import { createRng } from '../../core/rng.js';
import { Batch, board, timber, xf, mat4, stoneGeo, mossPadGeo, uvBox, peg, addToadstool, addFern, addLantern, addFairyLights, SPECIES, LOD, segs, noiseA } from './kit.js';
import { makeNotes } from './fx.js';
import { barkMount } from './door.js';

const D = SCHREINEREI.deck;
/** The show pieces' finish: oiled oak (a deeper honey than the raw stock) and its sheen. */
const OILED = '#94704a';
const OIL = { roughness: 0.62 };
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

  // ── structure: a Schreiner's own deck ────────────────────────────────────
  // stone footings → two bearers → nine joists across them → oiled larch boards
  // across the joists (every board its own tone, a slight cup, 5 mm gaps, the
  // ends trimmed flush 1.5 cm past the rim), a pair of screws on every joist
  // line, short drying checks only where the boards end; rim boards in the same
  // larch with a chamfered top edge.
  for (const x of [-hw + 0.18, 0, hw - 0.18]) {
    for (const z of [-hd + 0.2, hd - 0.2]) {
      F.add(mats.stone(), xf(stoneGeo(rng, { r: 1, sx: 0.17, sy: 0.12, sz: 0.17 }), [x, 0.05, z]));
    }
  }
  const tBoard = 0.035, joistH = 0.09, bearerH = 0.08;
  for (const z of [-hd + 0.2, hd - 0.2]) F.add(tim, xf(board(hw * 2 - 0.1, bearerH, 0.1, { along: 'x', rng }), [0, h - tBoard - joistH - bearerH / 2, z]), { cast: false });
  const nJ = 8;
  const joists = [];
  for (let k = 0; k <= nJ; k++) {
    const x = -hw + 0.045 + ((hw * 2 - 0.09) * k) / nJ;
    joists.push(x);
    F.add(tim, xf(board(0.045, joistH, hd * 2 - 0.06, { along: 'z', rng }), [x, h - tBoard - joistH / 2, 0]), { cast: false });
  }
  // (larch oiled a few summers ago: silvering at the surface, still warm
  // underneath — a quieter, greyer honey than the furniture standing on it)
  const LARCH = ['#9a8670', '#91806c', '#a08b73', '#8b7a66', '#968269', '#9d8a75'];
  const nB = 24;
  const pitch = (hd * 2 + 0.015) / nB, gap = 0.005, bw = pitch - gap;
  const bLen = hw * 2 + 0.03;
  const vcD = mats.vc();
  const screw = mats.metal('#45403a');
  for (let i = 0; i < nB; i++) {
    const z = -hd + pitch * (i + 0.5);
    const c = LARCH[rng.int(0, LARCH.length - 1)];
    const g = deckBoardGeo(bLen, tBoard, bw, { cup: 0.0012 + rng.next() * 0.0008 });
    uvBox(g, 'x', 1 / 1.4, [rng.next() * 7, rng.next() * 7]);
    F.add(mats.wood(c), xf(g, [0, h - tBoard / 2 + rng.jitter(0.0006), z], [0, rng.jitter(0.002), rng.jitter(0.004)]));
    // a pair of screws on every joist line (each pair a hair off square: driven by hand)
    if (LOD.small) {
      for (const x of joists) {
        const jx = x + rng.jitter(0.004);
        for (const sz of [-1, 1]) F.add(screw, xf(new THREE.CircleGeometry(0.0055, 6), [jx + rng.jitter(0.002), h + 0.0013, z + sz * (bw / 2 - 0.024)], [-Math.PI / 2, 0, rng.next() * 6]), { cast: false, receive: false });
      }
    }
    // short drying checks along the grain, only in from the board ends
    for (const sx of [-1, 1]) {
      if (rng.next() > 0.38) continue;
      const len = rng.range(0.03, 0.09), cz = z + rng.jitter(bw * 0.3);
      F.add(vcD, xf(new THREE.BoxGeometry(len, 0.0008, rng.range(0.0012, 0.0022)), [sx * (bLen / 2 - len / 2 - 0.003), h + 0.0011, cz], [0, rng.jitter(0.03), 0]), { color: '#3b2a1b', cast: false, receive: false });
    }
  }
  // rim boards (the same larch, chamfered top edge), front and both sides
  const rimH = 0.14, rimT = 0.025;
  const rimY = h - tBoard - rimH / 2;
  F.add(mats.wood(LARCH[1]), xf(board(hw * 2, rimH, rimT, { along: 'x', rng, r: 0.007 }), [0, rimY, hd - rimT / 2 - 0.004]));
  for (const s of [-1, 1]) F.add(mats.wood(LARCH[3]), xf(board(rimT, rimH, hd * 2 - 0.008, { along: 'z', rng, r: 0.007 }), [s * (hw - rimT / 2), rimY, -0.004]));
  // two steps down at the front-left (towards the door path): larch treads on stringers
  for (let i = 0; i < 2; i++) {
    const sy = h * (1 - (i + 1) / 3);
    F.add(mats.wood(LARCH[2]), xf(board(0.9, 0.035, 0.26, { along: 'x', rng, r: 0.006 }), [-hw + 0.55, sy, hd + 0.16 + i * 0.25]));
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
      F.add(oak, xf(new THREE.SphereGeometry(0.05, segs(8, 6), segs(6, 4)), [x, h + railH + 0.08, z], null, [1, 0.8, 1]), { cast: false });
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
      const bal = new THREE.LatheGeometry([[0.018, 0], [0.018, 0.04], [0.026, 0.12], [0.014, 0.22], [0.022, 0.3], [0.014, 0.38], [0.018, 0.47]].map(([r, y]) => new THREE.Vector2(r, y)), segs(6, 4));
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
    F.add(mats.moss(), xf(mossPadGeo(rng, { r: rng.range(0.12, 0.22), h: rng.range(0.05, 0.08) }), [x, 0, z], [0, rng.next() * 6, 0]), { cast: false });
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
  // the rug under it lies on the deck (not part of the piece: its close-up frames the table)
  {
    const R = mat4([0.82, h, 0.78], [0, -0.2, 0], FS);
    F.add(mats.fabric('#8e5a42'), xf(new THREE.CylinderGeometry(0.62, 0.62, 0.008, segs(28, 14)), [0, 0.004, 0], null, [1.25, 1, 0.9]).applyMatrix4(R), { cast: false });
    F.add(mats.fabric('#b89a62'), xf(new THREE.TorusGeometry(0.56, 0.012, 3, segs(28, 14)), [0, 0.009, 0], [Math.PI / 2, 0, 0], [1.25, 0.9, 1]).applyMatrix4(R), { cast: false });
    F.add(mats.fabric('#6f7a5a'), xf(new THREE.TorusGeometry(0.45, 0.01, 3, segs(28, 14)), [0, 0.009, 0], [Math.PI / 2, 0, 0], [1.25, 0.9, 1]).applyMatrix4(R), { cast: false });
  }
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
    // anchor in the bark, high up and to the RIGHT of the EFZ certificate
    // (its board spans x ≈ 1.45–2.25 under a roof topping out at y ≈ 2.1): the
    // string climbs away from the deck pole steeply enough that it stays far
    // above the certificate's close-up — never across the parchment. (It
    // used to end on the bark straight above the board's roof and sagged
    // through that close-up's frame.)
    const ya = 3.9;
    const ax = 2.7;
    const barkW = barkMount(ctx, ax, ya, { spreadA: 0.03, spreadY: 0.08 }).point;
    const barkLocal = barkW.clone().applyMatrix4(DECK.matrix.clone().invert());
    // a forged eye screwed into the bark holds the string's end
    F.add(mats.metal('#2f2b28'), xf(new THREE.TorusGeometry(0.03, 0.008, 4, 8), [barkLocal.x, barkLocal.y, barkLocal.z], [0, 0, Math.PI / 2]), { cast: false });
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
  // oiled oak: deeper honey, a soft sheen (its own material: one draw call)
  const oak = mats.wood(OILED, OIL);
  const L = 1.3, W = 0.64, T = 0.045, H = 0.47;
  // top: 4 glued-up boards (each its own tone, as boards from one log differ)
  // + breadboard ends across the grain; faint glue lines between the boards
  const be = 0.08;
  const oakC = new THREE.Color(OILED);
  const tones = [1.06, 0.95, 1.03, 0.97];
  for (let i = 0; i < 4; i++) {
    const bw = W / 4;
    const c = oakC.clone().multiplyScalar(tones[i]);
    Bt.add(mats.wood('#' + c.getHexString(), OIL), xf(board(L - be * 2, T, bw - 0.002, { along: 'x', rng, r: 0.006 }), [0, H - T / 2, -W / 2 + bw * (i + 0.5)]));
    if (i) Bt.add(mats.vc(), xf(new THREE.BoxGeometry(L - be * 2 - 0.01, 0.0012, 0.0025), [0, H + 0.0004, -W / 2 + bw * i]), { color: '#5e4630', cast: false });
  }
  const walnut = mats.wood('#3e2a1e', OIL);
  for (const s of [-1, 1]) {
    // the breadboard end: cross grain, a shade darker, a hair proud of the top
    Bt.add(mats.wood('#' + oakC.clone().multiplyScalar(0.88).getHexString(), OIL), xf(board(be, T + 0.004, W + 0.012, { along: 'z', rng, r: 0.008 }), [s * (L / 2 - be / 2), H - T / 2 + 0.001, 0]));
    // the shoulder line where the top's tongue goes into the breadboard
    Bt.add(mats.vc(), xf(new THREE.BoxGeometry(0.0022, 0.0012, W + 0.004), [s * (L / 2 - be), H + 0.0012, 0]), { color: '#3a2a1c', cast: false });
    // walnut draw-bore pegs through the breadboard (the outer ones in slotted holes)
    for (const z of [-0.22, 0, 0.22]) Bt.add(walnut, uvBox(xf(new THREE.CylinderGeometry(0.0125, 0.0125, 0.004, segs(10, 6)), [s * (L / 2 - be / 2), H + 0.0026, z], null, [1, 1, z === 0 ? 1 : 1.25]), 'y', 1 / 1.4, [s * 0.3, z]), { cast: false });
  }
  // legs (chamfered) with aprons; pegs show the mortise & tenon joints
  const lx = L / 2 - 0.13, lz = W / 2 - 0.07;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = board(0.068, H - T, 0.068, { along: 'y', rng, r: 0.014 });
      Bt.add(oak, xf(leg, [sx * lx, (H - T) / 2, sz * lz]));
      // peg heads on the outer faces
      for (const dy of [-0.025, 0.025]) {
        Bt.add(walnut, xf(peg(0.008, 0.006), [sx * lx, H - T - 0.06 + dy, sz * (lz + 0.035)], [0, sz < 0 ? Math.PI : 0, 0]), { cast: false });
        Bt.add(walnut, xf(peg(0.008, 0.006), [sx * (lx + 0.035), H - T - 0.06 + dy, sz * lz], [0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, 0]), { cast: false });
      }
    }
    Bt.add(oak, xf(board(0.03, 0.09, W - 0.2, { along: 'z', rng }), [sx * lx, H - T - 0.06, 0]));
  }
  for (const sz of [-1, 1]) Bt.add(oak, xf(board(L - 0.32, 0.09, 0.03, { along: 'x', rng }), [0, H - T - 0.06, sz * lz]));
  // low stretchers: one across each end, and the long one through them with
  // wedged through-tenons standing proud (two dark walnut wedges in each,
  // upright; the tenons' end grain shows — real end grain from the box UVs)
  for (const sx of [-1, 1]) Bt.add(oak, xf(board(0.045, 0.06, W - 0.2, { along: 'z', rng, r: 0.008 }), [sx * lx, 0.1, 0]));
  const tl = lx + 0.0225 + 0.03; // the tenon stands 3 cm proud of the end stretcher
  Bt.add(oak, xf(board(2 * tl, 0.05, 0.036, { along: 'x', rng, r: 0.006 }), [0, 0.1, 0]));
  // the wedges stand VERTICAL in the tenon (kerfs in the tenon's height): they
  // spread it along the end stretcher's grain, against the mortise's end-grain
  // walls — never across the grain, which would split the end stretcher
  for (const sx of [-1, 1]) for (const dz of [-0.009, 0.009]) Bt.add(walnut, uvBox(xf(new THREE.BoxGeometry(0.03, 0.044, 0.005), [sx * (tl - 0.014), 0.1, dz]), 'y', 1 / 1.4, [sx * 0.2, dz * 9]), { cast: false });

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

/**
 * A Swiss Stabelle (villager scale, seat 0.3): a thick plank seat, four
 * splayed octagonal legs wedged through it (their end grain and the dark
 * wedges show on the seat, the wedges across the seat's grain), two battens
 * slid in under the seat across the grain, and the carved plank backrest —
 * scalloped top, a heart cut out — tenoned through the seat, leaning back.
 * Back towards −Z. Returns { seatY }.
 */
let backrestProto = null;
function chairGeos(Bt, mats, rng, m) {
  const oak = mats.wood(OILED, OIL);
  const seatY = 0.3, sw = 0.36, sd = 0.34, st = 0.045;
  const top = seatY + st / 2;
  const add = (mat, geo, opts = {}) => Bt.add(mat, geo.applyMatrix4(m), opts);
  add(oak, board(sw, st, sd, { along: 'x', rng, r: 0.012 }).translate(0, seatY, 0));
  // battens (Gratleisten) under the seat, across its grain
  for (const x of [-0.105, 0.105]) add(oak, board(0.032, 0.026, sd - 0.05, { along: 'z', rng, r: 0.006 }).translate(x, seatY - st / 2 - 0.013, 0), { cast: false });
  // legs: from through the seat (flush with its top) splayed down and out
  const endGrain = mats.wood('#86643f', OIL);
  const vc = mats.vc();
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const a = [sx * 0.118, top - 0.002, sz * 0.105], b = [sx * 0.175, 0, sz * (0.16 + (sz < 0 ? 0.02 : 0))];
    add(oak, timber(a, b, 0.036, 0.036, { r: 0.011, wobble: 0 }));
    // the wedged tenon on the seat: end grain, a dark wedge across the seat's grain
    add(endGrain, uvBox(xf(new THREE.CircleGeometry(0.0175, segs(8, 6)), [a[0], top + 0.0006, a[2]], [-Math.PI / 2, 0, 0]), 'y', 1 / 1.4, [sx * 0.31, sz * 0.17]), { cast: false });
    add(vc, new THREE.BoxGeometry(0.0035, 0.001, 0.03).translate(a[0], top + 0.0011, a[2]), { color: '#2a1c12', cast: false });
  }
  // the backrest
  if (!backrestProto) {
    const sh = new THREE.Shape();
    sh.moveTo(-0.085, -0.05);
    sh.lineTo(-0.085, 0.02);
    sh.bezierCurveTo(-0.12, 0.1, -0.165, 0.2, -0.15, 0.3);
    sh.bezierCurveTo(-0.14, 0.38, -0.1, 0.43, -0.06, 0.415);
    sh.bezierCurveTo(-0.03, 0.405, -0.015, 0.385, 0, 0.395);
    sh.bezierCurveTo(0.015, 0.385, 0.03, 0.405, 0.06, 0.415);
    sh.bezierCurveTo(0.1, 0.43, 0.14, 0.38, 0.15, 0.3);
    sh.bezierCurveTo(0.165, 0.2, 0.12, 0.1, 0.085, 0.02);
    sh.lineTo(0.085, -0.05);
    sh.lineTo(-0.085, -0.05);
    const heart = new THREE.Path();
    heart.moveTo(0, 0.2);
    heart.bezierCurveTo(-0.02, 0.225, -0.058, 0.245, -0.052, 0.285);
    heart.bezierCurveTo(-0.046, 0.318, -0.012, 0.322, 0, 0.296);
    heart.bezierCurveTo(0.012, 0.322, 0.046, 0.318, 0.052, 0.285);
    heart.bezierCurveTo(0.058, 0.245, 0.02, 0.225, 0, 0.2);
    sh.holes.push(heart);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.028, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: segs(5, 3) });
    g.translate(0, 0, -0.014);
    // (the scalloped top and the heart's edges cut across the grain: end grain all round)
    backrestProto = uvBox(g, 'y', 1 / 1.4, [0, 0], { endGrain: true });
  }
  add(oak, xf(backrestProto.clone(), [0, top, -sd / 2 + 0.045], [-0.2, 0, 0]));
  return { seatY: top + 0.012 };
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
    const body = new THREE.SphereGeometry(0.075, segs(14, 8), segs(10, 6));
    body.scale(1, 0.82, 1);
    Bt.add(china, xf(body, [tx, top + 0.065, tz]), { color: '#3f6f8f', cast: false });
    Bt.add(china, xf(new THREE.CylinderGeometry(0.04, 0.045, 0.02, segs(12, 6)), [tx, top + 0.125, tz]), { color: '#3f6f8f', cast: false });
    Bt.add(china, xf(new THREE.SphereGeometry(0.014, segs(8, 6), segs(6, 3)), [tx, top + 0.142, tz]), { color: '#f2ead8', cast: false });
    const spout = new THREE.CylinderGeometry(0.008, 0.016, 0.08, segs(8, 6));
    Bt.add(china, xf(spout, [tx + 0.085, top + 0.08, tz], [0, 0, -0.9]), { color: '#3f6f8f', cast: false });
    Bt.add(china, xf(new THREE.TorusGeometry(0.035, 0.008, 6, 12, Math.PI * 1.2), [tx - 0.078, top + 0.07, tz], [0, 0, Math.PI / 2 - 0.3]), { color: '#3f6f8f', cast: false });
    // little white dots painted on the pot
    for (let i = 0, n = LOD.small ? 10 : 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2, e = rng.range(-0.5, 0.8);
      Bt.add(china, xf(new THREE.SphereGeometry(0.006, 4, 3), [tx + Math.cos(a) * Math.cos(e) * 0.074, top + 0.065 + Math.sin(e) * 0.061, tz + Math.sin(a) * Math.cos(e) * 0.074]), { color: '#f2ead8', cast: false });
    }
  }
  // cups on saucers (in front of the guests and two more)
  for (const [x, z, c] of [[-0.3, -0.16, '#f2ead8'], [0.45, -0.05, '#e8c27a'], [0.32, 0.16, '#f2ead8'], [-0.42, 0.14, '#c96a4a']]) {
    Bt.add(china, xf(new THREE.CylinderGeometry(0.045, 0.04, 0.008, segs(14, 6)), [x, top + 0.004, z]), { color: '#f2ead8', cast: false });
    const cup = new THREE.CylinderGeometry(0.03, 0.022, 0.04, 12, 1, true);
    Bt.add(china, xf(cup, [x, top + 0.028, z]), { color: c, cast: false });
    Bt.add(china, xf(new THREE.CircleGeometry(0.028, segs(12, 6)), [x, top + 0.04, z], [-Math.PI / 2, 0, 0]), { color: '#8a4a22', cast: false });
    Bt.add(china, xf(new THREE.TorusGeometry(0.012, 0.004, 4, 8), [x + 0.033, top + 0.03, z]), { color: c, cast: false });
  }
  // plate of cookies
  Bt.add(china, xf(new THREE.CylinderGeometry(0.07, 0.06, 0.01, segs(16, 6)), [-0.12, top + 0.005, 0.07]), { color: '#f2ead8', cast: false });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    Bt.add(china, xf(new THREE.CylinderGeometry(0.022, 0.022, 0.008, segs(10, 6)), [-0.12 + Math.cos(a) * 0.035, top + 0.014 + (i % 2) * 0.005, 0.07 + Math.sin(a) * 0.035], [rng.jitter(0.2), 0, rng.jitter(0.2)]), { color: '#c98a4b', cast: false });
  }
  // wildflowers in a jar
  {
    const jx = -0.48, jz = -0.02;
    Bt.add(mats.glass(), xf(new THREE.CylinderGeometry(0.03, 0.028, 0.08, segs(10, 6)), [jx, top + 0.04, jz]), { cast: false, receive: false });
    for (let i = 0; i < 7; i++) {
      const a = rng.next() * Math.PI * 2, r = rng.range(0.01, 0.05), hh = rng.range(0.1, 0.17);
      const fx = jx + Math.cos(a) * r, fz = jz + Math.sin(a) * r;
      Bt.add(china, xf(new THREE.CylinderGeometry(0.002, 0.002, hh, 3), [(jx + fx) / 2, top + 0.03 + hh / 2, (jz + fz) / 2], [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3]), { color: '#4f7f36', cast: false });
      Bt.add(china, xf(new THREE.SphereGeometry(0.016, segs(6, 6), segs(4, 3)), [fx, top + 0.03 + hh, fz]), { color: rng.pick(['#f2ead8', '#e8c22a', '#b39ddb', '#ef7a5a', '#7fb3e0']), cast: false });
    }
  }
  // a candle in a brass holder (its flame glows at night — returned, the deck
  // merges it into the shared lamp glow)
  Bt.add(mats.wood('#b8893a'), xf(new THREE.CylinderGeometry(0.03, 0.035, 0.01, segs(10, 6)), [0.2, top + 0.005, 0.02]), { cast: false });
  Bt.add(china, xf(new THREE.CylinderGeometry(0.012, 0.012, 0.07, segs(8, 6)), [0.2, top + 0.045, 0.02]), { color: '#f7efdf', cast: false });
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
  // (the sides a hair proud of the top's & bottom's ends, their own ends a hair
  // below the top: no coplanar faces fighting at the corners)
  for (const s of [-1, 1]) Bc.add(walnut, xf(board(t, Hc - 0.002, Dp, { along: 'y', rng, r: 0.004 }), [s * (W / 2 - t / 2 + 0.0008), y0 + Hc / 2, 0]));
  Bc.add(walnut, xf(board(W - 2 * t, Hc - 2 * t, 0.01, { along: 'x', rng }), [0, y0 + Hc / 2, -Dp / 2 + 0.005]));
  Bc.add(walnut, xf(board(0.015, Hc - 2 * t, Dp - 0.02, { along: 'y', rng }), [0, y0 + Hc / 2, 0]), { cast: false });
  // through-dovetails at the top corners (tails on the top, pins on the
  // sides). On each side's outer face the tails come through as RECTANGLES of
  // end grain (full board thickness × the tail's widest width) between the
  // pins' long grain; on the top the pins' end grain shows as narrow wedges
  // between the fanned tails, narrowing towards the corner (1:6 hardwood
  // slope). One species — the end grain reads by itself (real end grain from
  // the box UVs: across the grain, darker, rings).
  {
    const nT = 4;
    const pitch = Dp / nT; // one tail + one pin per pitch, half pins at the edges
    const pinOut = 0.016, slope = t / 6; // pin width at the corner; flare per side over the joint depth
    const yTop = y0 + Hc;
    for (const s of [-1, 1]) {
      for (let k = 0; k < nT; k++) {
        const zc = -Dp / 2 + pitch * (k + 0.5);
        const tw = pitch - pinOut; // the tail at its widest (the corner)
        // tail end grain on the side face: a rectangle, grain along x (the top's grain)
        const r = new THREE.PlaneGeometry(tw - 0.002, t - 0.002).rotateY(s * Math.PI / 2).translate(s * (W / 2 + 0.0016), yTop - t / 2, zc);
        Bc.add(walnut, uvBox(r, 'x', 1 / 1.4, [k * 0.37, s * 0.21]), { cast: false });
      }
      // the pins' end grain on the top: between the tails and at the edges (half pins)
      for (let k = 0; k <= nT; k++) {
        const zc = -Dp / 2 + pitch * k;
        const xo = s * (W / 2), xi = s * (W / 2 - t);
        const half = (w) => [Math.max(-Dp / 2, zc - w / 2), Math.min(Dp / 2, zc + w / 2)];
        const [o0, o1] = half(pinOut), [i0, i1] = half(pinOut + 2 * slope);
        const sh = new THREE.Shape([[xo, o0], [xi, i0], [xi, i1], [xo, o1]].map(([x, z]) => new THREE.Vector2(x, z)));
        const g = new THREE.ShapeGeometry(sh).rotateX(Math.PI / 2);
        // (rotateX(+π/2) turns shape y into +z but faces down: flip the winding up)
        flipWinding(g);
        g.translate(0, yTop + 0.0006, 0);
        Bc.add(walnut, uvBox(g, 'y', 1 / 1.4, [s * 0.3, k * 0.17]), { cast: false });
      }
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
  Bp.add(steel, xf(new THREE.CylinderGeometry(0.112, 0.108, 0.014, segs(32, 14)), [-0.04, PH + 0.019, 0]), { cast: false });
  // speed knob & a little brass power button
  Bp.add(steel, xf(new THREE.CylinderGeometry(0.013, 0.013, 0.014, 10), [-PW / 2 + 0.03, PH + 0.018, PD / 2 - 0.03]), { cast: false });
  Bp.add(mats.metal('#c9a04a'), xf(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 8), [-PW / 2 + 0.06, PH + 0.017, PD / 2 - 0.03]), { cast: false });
  // tonearm base & rest
  const armBase = new THREE.Vector3(0.12, PH + 0.012, -0.08);
  Bp.add(steel, xf(new THREE.CylinderGeometry(0.02, 0.024, 0.03, 12), [armBase.x, armBase.y + 0.015, armBase.z]), { cast: false });
  Bp.add(steel, xf(new THREE.CylinderGeometry(0.005, 0.005, 0.04, 6), [0.13, PH + 0.03, 0.08]), { cast: false });
  // the cueing lever beside the arm post: a little pillar with its flat lever, set down (arm lowered)
  Bp.add(steel, xf(new THREE.CylinderGeometry(0.0045, 0.0055, 0.022, 6), [armBase.x + 0.034, PH + 0.023, armBase.z + 0.012]), { cast: false });
  Bp.add(mats.metal('#2a2624'), xf(new THREE.BoxGeometry(0.026, 0.004, 0.007), [armBase.x + 0.043, PH + 0.035, armBase.z + 0.012], [0, -0.35, -0.12]), { cast: false });
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
  const vinyl = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.004, segs(40, 18)), makeVinylMaterial());
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
  // the headshell, tipped down a little towards the groove, the stylus under its nose
  Ba.add(mats.metal('#2a2624'), xf(new THREE.BoxGeometry(0.026, 0.01, 0.036), [0, -0.001, 0.208], [0.14, 0, 0]), { cast: false });
  Ba.add(mats.metal('#e8e2d0'), xf(new THREE.BoxGeometry(0.004, 0.012, 0.004), [0, -0.01, 0.216], [0.14, 0, 0]), { cast: false });
  Ba.add(steel, xf(new THREE.CylinderGeometry(0.016, 0.016, 0.028, 10), [0, 0.006, -0.032], [Math.PI / 2, 0, 0]), { cast: false });
  Ba.build(arm, 'tonearm', { mergeShadow: true });
  g.add(arm);
  // PLAY: the stylus sits ≈ 0.088 from the spindle — mid-record, in the grooves
  // (the vinyl's radius is 0.1, the label's 0.04), never on the platter's rim
  const REST = 0.12, PLAY = -0.7;
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

/**
 * Low coffee table: a live-edge oak slab (oiled) whose natural split is held
 * by two walnut butterfly keys; four walnut legs come through the top as
 * wedged through-tenons (dark end grain, pale maple wedges across), joined
 * below by an H of stretchers. A book, a plant and a mug, kept clear of the
 * joinery. (The rug lies on the deck — buildDeck.)
 */
function buildCoffeeTable(ctx, mats, rng) {
  const g = new THREE.Group();
  g.name = 'coffee-table';
  const Bk = new Batch();
  const L = 0.76, W = 0.42, H = 0.24, T = 0.042;
  const slab = '#a07a4e';
  // the slab: square-cut ends, wavy live edges along both long sides
  {
    const sh = new THREE.Shape();
    const n = segs(26, 14), ox = rng.next() * 30;
    const edge = (u, side) => side * (W / 2 + 0.018 * noiseA(u * 4.1 + ox + side * 7, side) + 0.012 * Math.sin(u * 9 + side * 2));
    sh.moveTo(-L / 2, edge(0, -1));
    for (let i = 1; i <= n; i++) sh.lineTo(-L / 2 + (L * i) / n, edge(i / n, -1));
    for (let i = n; i >= 0; i--) sh.lineTo(-L / 2 + (L * i) / n, edge(i / n, 1));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: T, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
    geo.rotateX(-Math.PI / 2).translate(0, H - T, 0);
    // (shape y → −z: mirrored edges are fine, the slab is symmetric in spirit)
    uvBox(geo, 'x', 1 / 1.4, [rng.next() * 7, rng.next() * 7]);
    Bk.add(mats.wood(slab, OIL), geo);
  }
  const top = H + 0.0045;
  const vc = mats.vc();
  // the natural split: a drying check that opened ALONG the grain from the
  // slab's right square end (where wood checks: the end grain dries first),
  // wandering a little with the fibres and closing towards its tip at ~35 %
  // of the length; a dark sliver shows where it breaks through the end
  const zc0 = 0.045;
  const check = [];
  {
    const xEnd = L / 2 - 0.0005, xTip = L / 2 - L * 0.35;
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      check.push({ x: xEnd + (xTip - xEnd) * t, z: zc0 + 0.007 * Math.sin(t * 5.2 + 0.6) + 0.004 * t * t, w: 0.0055 * (1 - t) + 0.0007 });
    }
    for (let i = 0; i < n; i++) {
      const p = check[i], q = check[i + 1];
      const len = Math.hypot(q.x - p.x, q.z - p.z) + 0.0015;
      // (each piece a thin wedge: as wide as the crack where it starts, a hair narrower where it ends)
      const g = new THREE.BoxGeometry(len, 0.001, 1, 1, 1, 1);
      const pa = g.attributes.position;
      for (let k = 0; k < pa.count; k++) pa.setZ(k, pa.getZ(k) * (pa.getX(k) < 0 ? p.w : q.w));
      Bk.add(vc, xf(g, [(p.x + q.x) / 2, top + 0.0003, (p.z + q.z) / 2], [0, -Math.atan2(q.z - p.z, q.x - p.x), 0]), { color: '#1f140c', cast: false, receive: false });
    }
    // where it breaks through the square end: a dark notch down the end grain
    Bk.add(vc, xf(new THREE.BoxGeometry(0.001, T * 0.7, check[0].w * 1.2), [L / 2 + 0.0045, H - T * 0.38, check[0].z]), { color: '#1f140c', cast: false, receive: false });
  }
  // two walnut butterfly keys (bow ties) holding it: each waist centred ON the
  // crack, the long axis across it, let into a routed recess a hair proud of
  // the oiled top (the recess shows as a fine dark outline round each key)
  {
    const bow = (k) => new THREE.Shape([[-0.034, -0.019], [0, -0.0065], [0.034, -0.019], [0.034, 0.019], [0, 0.0065], [-0.034, 0.019]].map(([a, b]) => new THREE.Vector2(a * k, b * k)));
    const key = new THREE.ShapeGeometry(bow(1)).rotateX(-Math.PI / 2);
    // (the key's grain runs along its length, across the slab's: box UVs along its long axis)
    uvBox(key, 'x', 1 / 1.4, [0.3, 0.7]);
    const recess = new THREE.ShapeGeometry(bow(1.09)).rotateX(-Math.PI / 2);
    const at = (x) => {
      // the crack's centre line and direction at x
      for (let i = 0; i < check.length - 1; i++) {
        const p = check[i], q = check[i + 1];
        if ((x - p.x) * (x - q.x) <= 0) {
          const t = (x - p.x) / (q.x - p.x);
          return { z: p.z + (q.z - p.z) * t, a: Math.atan2(q.z - p.z, q.x - p.x) };
        }
      }
      return { z: zc0, a: 0 };
    };
    for (const x of [L / 2 - 0.075, L / 2 - 0.185]) {
      const c = at(x);
      // long axis across the crack: the shape's x turned onto the slab's z (square to the crack's run)
      const yaw = Math.PI / 2 - c.a;
      Bk.add(vc, xf(recess.clone(), [x, top + 0.0001, c.z], [0, yaw, 0]), { color: '#24160d', cast: false, receive: false });
      Bk.add(mats.wood('#3e2a1e', OIL), xf(key.clone(), [x, top + 0.0005, c.z], [0, yaw, 0]), { cast: false, receive: true });
    }
  }
  // walnut legs, through-tenoned into the slab and wedged with maple
  const walnut = mats.wood('#4a3326', OIL);
  const lx = L / 2 - 0.08, lz = W / 2 - 0.075;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      Bk.add(walnut, xf(board(0.044, H - T, 0.044, { along: 'y', rng, r: 0.008 }), [sx * lx, (H - T) / 2, sz * lz]));
      // the tenon's end grain flush in the top, the wedge across the slab's grain
      // (real end grain: box UVs mark the face across the leg's grain)
      Bk.add(mats.wood('#5a3e2c', OIL), uvBox(xf(new THREE.PlaneGeometry(0.032, 0.032), [sx * lx, top + 0.0004, sz * lz], [-Math.PI / 2, 0, 0]), 'y', 1 / 1.4, [sx * 0.37, sz * 0.21]), { cast: false });
      Bk.add(mats.wood('#e2cfa8'), xf(new THREE.BoxGeometry(0.0045, 0.001, 0.034), [sx * lx, top + 0.0009, sz * lz]), { cast: false });
    }
    Bk.add(walnut, xf(board(0.03, 0.034, W - 0.15 + 0.04, { along: 'z', rng, r: 0.006 }), [sx * lx, 0.065, 0]), { cast: false });
  }
  Bk.add(walnut, xf(board(2 * lx, 0.03, 0.03, { along: 'x', rng, r: 0.006 }), [0, 0.065, 0]), { cast: false });
  // an open book at the left end
  for (const s of [-1, 1]) {
    Bk.add(vc, xf(new THREE.BoxGeometry(0.1, 0.012, 0.14), [-0.2 + s * 0.05, top + 0.008, -0.03], [0, 0.25, s * 0.08]), { color: '#f7efdf', cast: false });
  }
  Bk.add(vc, xf(new THREE.BoxGeometry(0.21, 0.004, 0.15), [-0.2, top + 0.002, -0.03], [0, 0.25, 0]), { color: '#2f5d8a', cast: false });
  // potted plant at the right end: clay pot + leafy fronds
  {
    const px = 0.25, pz = -0.06;
    Bk.add(mats.clay('#b8653f'), xf(uvBox(new THREE.CylinderGeometry(0.045, 0.035, 0.07, segs(12, 7)), 'y'), [px, top + 0.035, pz]), { cast: false });
    Bk.add(mats.wood('#3a2a1e'), xf(new THREE.CircleGeometry(0.042, segs(10, 6)), [px, top + 0.068, pz], [-Math.PI / 2, 0, 0]), { cast: false });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rng.jitter(0.3);
      const leaf = new THREE.SphereGeometry(0.035, 6, 4);
      leaf.scale(0.55, 0.12, 1.3);
      leaf.translate(0, 0, 0.04);
      Bk.add(vc, xf(leaf, [px, top + 0.09 + rng.range(0, 0.04), pz], [-0.7 + rng.jitter(0.2), a, 0]), { color: rng.pick(['#4f7f36', '#5e8c3a', '#3f6b2f']), cast: false });
    }
  }
  // a mug, behind the keys
  Bk.add(vc, xf(new THREE.CylinderGeometry(0.025, 0.022, 0.05, segs(10, 6)), [0.13, top + 0.025, -0.13]), { color: '#e8c27a', cast: false });
  Bk.add(vc, xf(new THREE.TorusGeometry(0.014, 0.004, 4, 8), [0.156, top + 0.026, -0.13]), { color: '#e8c27a', cast: false });
  Bk.build(g, 'coffee-table', { mergeShadow: true });
  return g;
}

/** A Schreiner-made armchair: ash frame, loose cushions. */
function buildArmchair(ctx, mats, rng) {
  const g = new THREE.Group();
  g.name = 'armchair';
  const Ba = new Batch();
  // (ash: pale and creamy beside the oak table, the walnut cabinet and the cherry plinth)
  const oak = mats.wood('ash');
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
 * A ginger tabby curled up asleep (cute stylised, like the villagers): a round
 * curled body with tabby stripes, the head resting on two white paws turned to
 * the visitor (+Z), two big ears with pink insides, closed eyes, a pink nose,
 * and the striped tail wrapped round the front with a white tip. Breathes.
 */
function makeSleepingCat(ctx) {
  const g = new THREE.Group();
  g.name = 'sleeping-cat';
  const Bc = new Batch();
  const mat = ctx.materials.toon('#ffffff', { vertexColors: true, name: 'props-vc' });
  const ginger = '#e08a3c', light = '#f8e2c2', dark = '#a8551f', pink = '#e89a9a';
  const stripes = (geo, base, k = 70) => {
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      c.set(y < -0.025 ? light : Math.sin(Math.atan2(z, x) * 9) > 0.55 && y > -0.01 ? dark : base);
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  };
  // the curled body: a round loaf turned into a doughnut by the tail
  const body = new THREE.SphereGeometry(0.1, segs(16, 9), segs(10, 6));
  body.scale(1.0, 0.6, 0.92);
  Bc.add(mat, stripes(body, ginger).translate(-0.02, 0.058, -0.01));
  // the head on its paws, lifted clear of the body so it reads at a glance
  const hx = 0.075, hy = 0.095, hz = 0.075;
  const head = new THREE.SphereGeometry(0.066, segs(14, 8), segs(10, 6));
  head.scale(1.12, 0.92, 1);
  Bc.add(mat, head.translate(hx, hy, hz), { color: ginger });
  // a pale muzzle and chin
  Bc.add(mat, new THREE.SphereGeometry(0.032, 8, 6).scale(1.25, 0.75, 0.9).translate(hx + 0.002, hy - 0.026, hz + 0.05), { color: light });
  for (const s of [-1, 1]) {
    // big ears with pink insides
    const ear = new THREE.ConeGeometry(0.026, 0.05, 4);
    Bc.add(mat, xf(ear, [hx + s * 0.036, hy + 0.06, hz - 0.004], [-0.15, s * 0.6, -s * 0.38]), { color: ginger });
    Bc.add(mat, xf(new THREE.ConeGeometry(0.014, 0.032, 4), [hx + s * 0.035, hy + 0.055, hz + 0.008], [-0.15, s * 0.6, -s * 0.38]), { color: pink });
    // closed eyes: little dark arcs, smiling
    Bc.add(mat, xf(new THREE.TorusGeometry(0.01, 0.0026, 3, 6, Math.PI), [hx + s * 0.025, hy + 0.004, hz + 0.062], [0, s * 0.25, Math.PI]), { color: '#3b2a1e' });
    // white front paws under the chin
    Bc.add(mat, new THREE.SphereGeometry(0.022, 8, 6).scale(1, 0.7, 1.35).translate(hx + s * 0.03, 0.03, hz + 0.055), { color: light });
    // whiskers (two each side)
    for (const dy of [-0.004, 0.004]) Bc.add(mat, xf(new THREE.BoxGeometry(0.04, 0.0016, 0.0016), [hx + s * 0.045, hy - 0.024 + dy, hz + 0.074], [0, -s * 0.3, s * dy * 30]), { color: '#fff6e6' });
  }
  Bc.add(mat, new THREE.SphereGeometry(0.0075, 6, 4).translate(hx + 0.002, hy - 0.014, hz + 0.074), { color: pink });
  // the tail: round the body's right side and across the front, white tip by the paws
  {
    const pts = [[-0.11, 0.035, -0.05], [-0.1, 0.03, 0.05], [-0.04, 0.026, 0.1], [0.03, 0.024, 0.12], [0.075, 0.03, 0.12]].map((p) => new THREE.Vector3(...p));
    const curve = new THREE.CatmullRomCurve3(pts);
    const tail = new THREE.TubeGeometry(curve, segs(16, 8), 0.02, segs(7, 5), false);
    const pos = tail.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const n = pos.count;
    for (let i = 0; i < n; i++) {
      const u = Math.floor(i / (segs(7, 5) + 1)) / segs(16, 8);
      c.set(u > 0.86 ? light : Math.sin(u * 30) > 0.3 ? dark : ginger);
      col.set([c.r, c.g, c.b], i * 3);
    }
    tail.setAttribute('color', new THREE.BufferAttribute(col, 3));
    Bc.add(mat, tail);
    Bc.add(mat, new THREE.SphereGeometry(0.02, 8, 6).translate(0.075, 0.03, 0.12), { color: light });
  }
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

/** Reverse a geometry's triangle winding and normals in place (a flat shape turned face-down → face-up). */
function flipWinding(g) {
  if (g.index) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.index.needsUpdate = true;
  }
  const n = g.attributes.normal;
  if (n) for (let i = 0; i < n.array.length; i++) n.array[i] = -n.array[i];
  return g;
}

/**
 * A deck board along X: len × t × w, chamfered long edges (c), the top cupped
 * (edges up by `cup`, smooth normals across), flat end caps. ≈ 44 triangles.
 */
function deckBoardGeo(len, t, w, { c = 0.004, cup = 0.0015 } = {}) {
  const hh = t / 2, hw = w / 2;
  const nTop = 4;
  const yTop = (z) => hh - cup / 2 + cup * (z / (hw - c)) ** 2;
  const dTop = (z) => (2 * cup * z) / (hw - c) ** 2;
  // the section (y, z) counter-clockwise seen from +X, with a normal per point (per facet edge)
  const pts = [];
  const nrm = (ny, nz) => {
    const l = Math.hypot(ny, nz) || 1;
    return [ny / l, nz / l];
  };
  const facet = (a, b, na = null, nb = null) => {
    const n = nrm(b[1] - a[1], -(b[0] - a[0]));
    pts.push([a, b, na ?? n, nb ?? n]);
  };
  const L0 = [-hh + c, -hw], L1 = [hh - c, -hw];
  const T0 = [yTop(-hw + c), -hw + c], T1 = [yTop(hw - c), hw - c];
  const R0 = [hh - c, hw], R1 = [-hh + c, hw];
  const B0 = [-hh, hw - c], B1 = [-hh, -hw + c];
  facet(L0, L1);
  facet(L1, T0);
  for (let j = 0; j < nTop; j++) {
    const za = -hw + c + ((2 * hw - 2 * c) * j) / nTop, zb = -hw + c + ((2 * hw - 2 * c) * (j + 1)) / nTop;
    facet([yTop(za), za], [yTop(zb), zb], nrm(1, -dTop(za)), nrm(1, -dTop(zb)));
  }
  facet(T1, R0);
  facet(R0, R1);
  facet(R1, B0);
  facet(B0, B1);
  facet(B1, L0);
  const pos = [], nor = [], idx = [];
  for (const [a, b, na, nb] of pts) {
    const base = pos.length / 3;
    for (const x of [-len / 2, len / 2]) {
      pos.push(x, a[0], a[1], x, b[0], b[1]);
      nor.push(0, na[0], na[1], 0, nb[0], nb[1]);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  // end caps: a fan over the section outline
  const outline = pts.map((p) => p[0]);
  for (const sx of [-1, 1]) {
    const base = pos.length / 3;
    for (const [y, z] of outline) {
      pos.push((sx * len) / 2, y, z);
      nor.push(sx, 0, 0);
    }
    for (let i = 1; i < outline.length - 1; i++) {
      if (sx > 0) idx.push(base, base + i, base + i + 1);
      else idx.push(base, base + i + 1, base + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
