// ─────────────────────────────────────────────────────────────────────────────
// The Schreinerei yard — the lived-in clutter around the workshop:
//   • a cantilever lumber rack under the left eave: stickered stacks of oak,
//     walnut, cherry, maple, ash and spruce (end grain towards the visitor)
//   • a round Swiss "Holzbeige" (firewood stack) with a little shingled cap
//   • a chopping block with an axe and split logs, a sawbuck with a log
//   • two sawhorses with a board mid-cut, a saw resting in the kerf, sawdust
//   • a wheelbarrow full of offcuts by the porch
//   • a snail delivering a strapped stack of planks, parked by the rack
//   • stepping stones from the workshop door to the main path, moss, ferns,
//     toadstools and wildflowers at every foot
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { getHeight } from '../../world/ground.js';
import { Batch, board, timber, xf, mat4, stoneGeo, mossGeo, uvBox, paintBy, addToadstool, addFern, SPECIES } from './kit.js';
import { ANNEX, annexFrame, annexToWorld } from './annex.js';

export function buildYard(ctx, B, mats) {
  const rng = createRng('yard');
  const group = new THREE.Group();
  group.name = 'schreinerei-yard';
  ctx.scene.add(group);
  const F = annexFrame(B); // annex-local, gently crooked like the house
  const { hx, hz } = ANNEX;
  const tim = mats.timber();
  const iron = mats.metal('#2f2b28');
  // ground height under an annex-local point (the yard reaches into the pad's soft edge)
  const tmpW = new THREE.Vector3();
  const groundY = (x, z) => {
    annexToWorld(x, 0, z, tmpW);
    return getHeight(tmpW.x, tmpW.z);
  };

  // ── lumber rack under the left eave ────────────────────────────────────────
  {
    const rx = -hx - 0.22; // posts stand just off the plinth
    const zs = [-1.7, -0.25, 1.2];
    const arms = [0.42, 0.9, 1.38];
    for (const z of zs) {
      F.add(tim, timber([rx, 0, z], [rx, 1.75, z], 0.12, 0.12, { rng, up: [1, 0, 0] }));
      for (const y of arms) {
        F.add(tim, timber([rx + 0.05, y, z], [rx - 0.52, y + 0.03, z], 0.08, 0.07, { rng, up: [0, 1, 0] }));
        // a little brace under each arm
        F.add(tim, timber([rx - 0.02, y - 0.25, z], [rx - 0.3, y - 0.03, z], 0.05, 0.05, { rng, up: [0, 0, 1] }), { cast: false });
      }
      // ties back to the wall
      F.add(iron, xf(new THREE.BoxGeometry(0.24, 0.03, 0.04), [rx + 0.12, 1.6, z]), { cast: false });
    }
    // stickered stacks: each level a species, thin battens between the layers
    const levels = [
      { y: 0.42, sp: ['spruce', 'ash', 'spruce'], n: 3 },
      { y: 0.9, sp: ['cherry', 'maple', 'cherry'], n: 3 },
      { y: 1.38, sp: ['walnut', 'oak', 'walnut'], n: 2 },
    ];
    for (const lv of levels) {
      let y = lv.y + 0.035;
      for (let layer = 0; layer < lv.n; layer++) {
        let x = rx - 0.06;
        for (let k = 0; k < 3; k++) {
          const w = rng.range(0.11, 0.17), t = rng.range(0.035, 0.05);
          const len = rng.range(3.7, 4.2);
          const z0 = 2.45 + rng.jitter(0.12);
          const sp = lv.sp[(k + layer) % lv.sp.length];
          const b = board(len, t, w, { along: 'x', rng, r: 0.006 });
          F.add(mats.wood(sp), xf(b, [x - w / 2, y + t / 2, z0 - len / 2], [0, Math.PI / 2 + rng.jitter(0.008), 0]));
          // bright end grain on the front ends (sawn, seen by the visitor)
          F.add(mats.wood(sp), xf(new THREE.PlaneGeometry(w * 0.96, t * 0.9), [x - w / 2, y + t / 2, z0 + 0.002]), { color: lighten(SPECIES[sp], 0.12), cast: false });
          x -= w + 0.012;
        }
        y += 0.05;
        // stickers
        if (layer < lv.n - 1) for (const z of zs) F.add(mats.wood('spruce'), xf(board(0.48, 0.016, 0.03, { along: 'x' }), [rx - 0.27, y - 0.004, z + 0.1]), { cast: false });
        y += 0.016;
      }
    }
    // a rough slab with bark edges leaning against the rack end
    const slab = board(0.04, 1.6, 0.3, { along: 'y', rng });
    F.add(mats.wood('oak'), xf(slab, [rx - 0.62, 0.78, 1.95], [0.0, 0.3, -0.25]));
    F.add(mats.bark(), xf(new THREE.BoxGeometry(0.05, 1.58, 0.04), [rx - 0.64, 0.78, 2.1], [0.0, 0.3, -0.25]), { cast: false });
  }

  // ── Holzbeige: a round firewood stack with a shingled cap ──────────────────
  {
    const c = [-hx - 0.45, 0, hz + 0.75];
    c[1] = groundY(c[0], c[2]);
    const R = 0.46, H = 1.1;
    const rings = Math.round(H / 0.1);
    for (let i = 0; i < rings; i++) {
      const y = 0.06 + i * 0.1;
      const r = R * (1 - (i / rings) * 0.08);
      const n = Math.round((Math.PI * 2 * r) / 0.11);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + (i % 2) * (Math.PI / n);
        // logs: bark on the sides, pale end grain on the ends (the visible face)
        const log = new THREE.CylinderGeometry(0.058, 0.062, 0.34, 6);
        const endC = rng.pick(['#c9a476', '#d8bb8c', '#b98d5f', '#cfa982', '#bf9a6c']);
        const barkC = rng.pick(['#4e3b2c', '#5a4434', '#463528']);
        paintBy(log, (nx, ny) => (Math.abs(ny) > 0.7 ? endC : barkC));
        log.rotateX(Math.PI / 2);
        uvBox(log, 'z');
        // logs point radially: end grain shows all round the stack
        F.add(mats.wood('oak'), xf(log, [c[0] + Math.sin(a) * (r - 0.17), c[1] + y, c[2] + Math.cos(a) * (r - 0.17)], [rng.jitter(0.1), a, rng.jitter(0.3)]));
      }
    }
    // cap: a little shingled cone (two layered rings) + a finial
    const capH = 0.42;
    const cone = new THREE.ConeGeometry(R + 0.14, capH, 14, 3, true);
    F.add(mats.shingles(), xf(cone, [c[0], c[1] + H + 0.1 + capH / 2, c[2]]));
    const skirt = new THREE.CylinderGeometry(R + 0.1, R + 0.17, 0.08, 14, 1, true);
    F.add(mats.shingles(), xf(skirt, [c[0], c[1] + H + 0.11, c[2]]), { cast: false });
    F.add(mats.wood('#4e3b2c'), xf(new THREE.CircleGeometry(R + 0.12, 14), [c[0], c[1] + H + 0.09, c[2]], [Math.PI / 2, 0, 0]), { cast: false });
    F.add(mats.wood('oak'), xf(new THREE.ConeGeometry(0.06, 0.2, 6), [c[0], c[1] + H + 0.1 + capH + 0.08, c[2]]));
    F.add(mats.moss(), xf(mossGeo(rng, { r: 0.14, h: 0.05 }), [c[0] + 0.12, c[1] + H + 0.32, c[2] + 0.14], [-0.5, 0.6, 0]), { cast: false });
  }

  // ── a pile of round saw-logs waiting for the mill, by the back corner ─────
  {
    const c = [-hx - 0.6, 0, -hz - 0.25];
    c[1] = groundY(c[0], c[2]);
    const M = mat4(c, [0, 0.35, 0]);
    // three logs below, two on top; they lie along x
    const logs = [[-0.42, 0.17], [0, 0.19], [0.41, 0.16], [-0.2, 0.17], [0.21, 0.16]];
    logs.forEach(([z, r], i) => {
      const y = i < 3 ? r : 0.33 + r * 0.9;
      const len = 1.5 + rng.jitter(0.12);
      const log = new THREE.CylinderGeometry(r, r * 1.05, len, 12, 1);
      // bark around, growth rings on the sawn ends
      const bark = rng.pick(['#4a3828', '#54402e']);
      paintBy(log, (nx, ny, nz, px, py, pz) => {
        if (Math.abs(ny) < 0.7) return bark;
        const rr = Math.hypot(px, pz) / r;
        return rr > 0.88 ? '#5a4330' : Math.sin(rr * 24) > 0.3 ? '#b8946a' : '#cdb08a';
      });
      log.rotateZ(Math.PI / 2);
      F.add(mats.wood('oak'), log.translate(rng.jitter(0.08), y, z).applyMatrix4(M));
    });
    F.add(mats.moss(), xf(mossGeo(rng, { r: 0.2, h: 0.04, sx: 2.6 }), [0, 0.62, 0], [0, 0, 0]).applyMatrix4(M), { cast: false });
    addToadstool(F, mats, rng, c[0] + 0.5, c[1], c[2] + 0.55, { size: 0.1 });
  }

  // ── chopping block, axe, split logs ───────────────────────────────────────
  {
    const c = [-2.62, 0, hz + 1.38];
    const g0 = groundY(c[0], c[2]);
    const blk = new THREE.CylinderGeometry(0.22, 0.26, 0.42, 12);
    uvBox(blk, 'y', 1 / 2.6);
    F.add(mats.bark(), xf(blk, [c[0], g0 + 0.21, c[2]]));
    F.add(mats.wood('oak'), xf(new THREE.CircleGeometry(0.2, 12), [c[0], g0 + 0.422, c[2]], [-Math.PI / 2, 0, 0]), { color: '#c9a476', cast: false });
    // the axe, stuck in the block
    F.add(mats.wood('ash'), xf(board(0.03, 0.55, 0.04, { along: 'y', rng }), [c[0] + 0.12, g0 + 0.6, c[2] + 0.02], [0.1, 0, -0.75]));
    F.add(iron, xf(new THREE.BoxGeometry(0.16, 0.08, 0.025), [c[0] - 0.03, g0 + 0.43, c[2] + 0.0], [0.1, 0, -0.75 + Math.PI / 2]), { cast: false });
    // split logs scattered + a small pile
    for (let i = 0; i < 9; i++) {
      const a = rng.next() * Math.PI * 2, r = rng.range(0.35, 0.75);
      const half = new THREE.CylinderGeometry(0.06, 0.06, 0.3, 6, 1, false, 0, Math.PI);
      uvBox(half, 'y');
      F.add(mats.wood(rng.pick(['oak', 'ash', 'spruce'])), xf(half, [c[0] + Math.cos(a) * r, g0 + 0.05, c[2] + Math.sin(a) * r], [Math.PI / 2, rng.next() * 6, rng.jitter(0.3)]), { cast: false });
    }
    for (let i = 0; i < 18; i++) {
      const a = rng.next() * Math.PI * 2, r = rng.range(0.25, 0.6);
      F.add(mats.wood('ash'), xf(new THREE.BoxGeometry(0.04, 0.006, 0.02), [c[0] + Math.cos(a) * r, g0 + 0.004, c[2] + Math.sin(a) * r], [0, rng.next() * 6, 0]), { color: '#d9c39a', cast: false });
    }
  }

  // ── sawhorses with a board mid-cut ─────────────────────────────────────────
  {
    const c = [-1.95, 0, hz + 0.85];
    c[1] = groundY(c[0], c[2]);
    const rot = 0.55;
    const M = mat4(c, [0, rot, 0]);
    const parts = [];
    for (const sx of [-0.55, 0.55]) {
      parts.push([tim, board(0.08, 0.06, 0.62, { along: 'z', rng, scale: 1 / 1.6 }).translate(sx, 0.46, 0)]);
      for (const sz of [-0.22, 0.22]) {
        for (const lx of [-1, 1]) {
          const leg = board(0.045, 0.5, 0.045, { along: 'y', rng, scale: 1 / 1.6 });
          parts.push([tim, xf(leg, [sx + lx * 0.09, 0.23, sz], [0, 0, lx * 0.2])]);
        }
      }
      parts.push([tim, board(0.03, 0.05, 0.5, { along: 'z', rng, scale: 1 / 1.6 }).translate(sx, 0.18, 0)]);
    }
    // the board (cherry), the saw resting in the kerf, a pencil line
    parts.push([mats.wood('cherry'), board(1.7, 0.04, 0.22, { along: 'x', rng }).translate(0.05, 0.51, 0)]);
    const blade = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.48, 0.02), new THREE.Vector2(0.48, 0.1), new THREE.Vector2(0, 0.13)]);
    parts.push([mats.metal('#a8afb5'), xf(new THREE.ShapeGeometry(blade), [0.32, 0.48, 0.0], [Math.PI / 2 - 0.5, Math.PI / 2, 0])]);
    parts.push([mats.wood('walnut'), xf(board(0.06, 0.12, 0.03, { along: 'y', rng }), [0.32, 0.62, 0.23], [-0.5, 0, 0])]);
    parts.push([mats.vc(), xf(new THREE.BoxGeometry(0.004, 0.002, 0.2), [0.32, 0.531, 0])]);
    for (const [mat, g] of parts) F.add(mat, g.applyMatrix4(M), { cast: mat !== parts[parts.length - 1][0] });
    // sawdust under the cut
    for (let i = 0; i < 5; i++) F.add(mats.vc(), xf(mossGeo(rng, { r: rng.range(0.08, 0.2), h: 0.012 }), [c[0] + 0.3 + rng.jitter(0.25), 0.002, c[2] + rng.jitter(0.25)]), { color: '#e6cc98', cast: false });
  }

  // ── wheelbarrow of offcuts by the porch ────────────────────────────────────
  {
    const c = [3.35, 0, hz + 1.9];
    c[1] = groundY(c[0], c[2]);
    const M = mat4(c, [0, -0.9, 0]);
    const parts = [];
    const sp = tim;
    // tray: four planks + bottom
    parts.push([sp, board(0.5, 0.02, 0.62, { along: 'z', rng }).translate(0, 0.33, 0)]);
    for (const s of [-1, 1]) {
      parts.push([sp, xf(board(0.03, 0.2, 0.68, { along: 'z', rng }), [s * 0.27, 0.42, 0], [0, 0, s * 0.25])]);
      parts.push([sp, xf(board(0.56, 0.2, 0.03, { along: 'x', rng }), [0, 0.42, s * 0.33], [s * -0.25, 0, 0])]);
      // handles and legs
      parts.push([tim, xf(board(0.045, 0.045, 1.25, { along: 'z', rng }), [s * 0.2, 0.32, -0.15], [0.12, 0, 0])]);
      parts.push([tim, xf(board(0.04, 0.3, 0.04, { along: 'y', rng }), [s * 0.2, 0.15, -0.38])]);
    }
    // wheel: solid wooden disc with an iron tyre
    const wheel = new THREE.CylinderGeometry(0.18, 0.18, 0.05, 16);
    wheel.rotateZ(Math.PI / 2);
    parts.push([tim, uvBox(wheel, 'x', 1 / 1.6).translate(0, 0.18, 0.55)]);
    parts.push([iron, new THREE.TorusGeometry(0.18, 0.012, 4, 20).rotateY(Math.PI / 2).translate(0, 0.18, 0.55)]);
    // offcuts (mixed species) piled in the tray
    for (let i = 0; i < 16; i++) {
      const s = rng.pick(['oak', 'walnut', 'cherry', 'maple', 'ash', 'spruce']);
      const g = board(rng.range(0.12, 0.34), rng.range(0.025, 0.05), rng.range(0.05, 0.12), { along: 'x', rng });
      parts.push([mats.wood(s), xf(g, [rng.jitter(0.18), 0.4 + rng.next() * 0.16, rng.jitter(0.22)], [rng.jitter(0.6), rng.next() * 3, rng.jitter(0.6)])]);
    }
    for (const [mat, g] of parts) F.add(mat, g.applyMatrix4(M));
  }

  // ── the delivery snail, parked by the rack with a strapped stack of planks ─
  const snail = ctx.props.makeSnail({ seed: 'schreinerei-delivery', shellColor: '#c98a4b', blanket: '#4f6d9a' });
  {
    const p = annexToWorld(-hx - 1.45, 0, 1.45);
    snail.group.position.set(p.x, getHeight(p.x, p.z), p.z);
    snail.group.rotation.y = ctx.layout.SCHREINEREI.annex.rotY + 0.08;
    snail.group.scale.setScalar(0.92);
    group.add(snail.group);
    snail.setMoving(0);
    // planks strapped on the saddle (built on the seat so they ride along)
    const load = new THREE.Group();
    const Bl = [];
    for (let i = 0; i < 5; i++) {
      const sp = ['oak', 'walnut', 'cherry', 'maple', 'oak'][i];
      const g = board(0.95 + rng.jitter(0.08), 0.035, 0.16, { along: 'x', rng });
      Bl.push([mats.wood(sp), xf(g, [rng.jitter(0.03), 0.04 + i * 0.04, rng.jitter(0.02)], [0, Math.PI / 2 + rng.jitter(0.06), 0])]);
    }
    for (const z of [-0.25, 0.25]) Bl.push([mats.wood('#b89b6a'), xf(new THREE.TorusGeometry(0.13, 0.012, 4, 14), [0, 0.12, z], [0, 0, 0], [1, 0.8, 1])]);
    const tmpB = new Batch();
    for (const [m, g] of Bl) tmpB.add(m, g, { cast: true });
    tmpB.build(load, 'snail-load', { mergeShadow: true });
    load.position.set(0, 0.02, 0);
    snail.seat.add(load);
    // a little parcel tag
    snail.lookAt(annexToWorld(-hx - 0.3, 1.0, 1.6));
  }

  // ── stepping stones: workshop door → main path ─────────────────────────────
  {
    const start = annexToWorld(-0.3, 0, hz + 0.65);
    const end = new THREE.Vector3(-1.2, 0, 3.4);
    const ctrl = new THREE.Vector3(-3.0, 0, 3.0);
    const curve = new THREE.QuadraticBezierCurve3(start, ctrl, end);
    const n = 11;
    for (let i = 0; i < n; i++) {
      const p = curve.getPointAt(i / (n - 1));
      const g = stoneGeo(rng, { r: 1, sx: rng.range(0.2, 0.28), sy: 0.05, sz: rng.range(0.17, 0.24), lump: 0.12 });
      B.add(mats.stone(), xf(g, [p.x + rng.jitter(0.08), getHeight(p.x, p.z) + 0.015, p.z + rng.jitter(0.08)], [0, rng.next() * 3, 0]), { cast: false });
      if (rng.next() < 0.6) B.add(mats.moss(), xf(mossGeo(rng, { r: rng.range(0.06, 0.12), h: 0.025 }), [p.x + rng.jitter(0.25), getHeight(p.x, p.z), p.z + rng.jitter(0.25)]), { cast: false });
    }
    // a flagged apron in front of the workshop door
    for (let i = 0; i < 14; i++) {
      const x = -1.15 + rng.next() * 1.75, z = hz + 0.15 + rng.next() * 0.6;
      const g = stoneGeo(rng, { r: 1, sx: rng.range(0.16, 0.26), sy: 0.035, sz: rng.range(0.14, 0.22), lump: 0.1 });
      F.add(mats.stone(), xf(g, [x, 0.012, z], [0, rng.next() * 3, 0]), { cast: false });
    }
  }

  // ── greenery at every foot: ferns, moss, toadstools, wildflowers ──────────
  {
    const spots = [
      [-hx - 0.2, -2.1], [-hx - 0.7, -1.0], [hx + 0.15, -1.6], [hx + 0.3, 0.6], [-hx - 0.1, hz + 1.4], [0.9, hz + 0.25], [-2.6, hz + 2.6], [2.9, hz + 0.3],
    ];
    for (const [x, z] of spots) {
      addFern(F, ctx, rng, x, 0, z, { size: rng.range(0.4, 0.6) });
      for (let i = 0; i < 2; i++) F.add(mats.moss(), xf(mossGeo(rng, { r: rng.range(0.12, 0.25), h: 0.06 }), [x + rng.jitter(0.3), 0, z + rng.jitter(0.3)]), { cast: false });
      for (let i = 0; i < 3; i++) addToadstool(F, mats, rng, x + rng.jitter(0.4), 0, z + rng.jitter(0.4), { size: rng.range(0.06, 0.12), color: rng.pick(['#c9352a', '#c9352a', '#b98a4e', '#d4772e']) });
    }
    // wildflowers along the front of the annex
    const vc = mats.vc();
    for (let i = 0; i < 40; i++) {
      const x = rng.range(-hx - 0.4, hx + 0.6), z = hz + rng.range(0.1, 0.45);
      if (x > -1.25 && x < 0.7) continue; // keep the doorway clear
      const h = rng.range(0.08, 0.2);
      F.add(vc, xf(new THREE.CylinderGeometry(0.003, 0.004, h, 3), [x, h / 2, z]), { color: '#4f7f36', cast: false });
      F.add(vc, xf(new THREE.SphereGeometry(rng.range(0.014, 0.024), 5, 3), [x, h, z], null, [1, 0.6, 1]), { color: rng.pick(['#f2ead8', '#e8c22a', '#b39ddb', '#ef7a5a', '#ffffff', '#7fb3e0']), cast: false });
    }
  }

  scatterGround(ctx, B, mats, rng);

  return {
    group,
    snail,
    update() {},
  };
}

/**
 * Ground cover on the Schreinerei's pads (the forest scatter leaves pads
 * alone): grass tufts, clover with tiny flowers, moss cushions, pebbles and
 * fallen leaves — everywhere nothing stands, never on the path.
 */
function scatterGround(ctx, B, mats, rng) {
  const { SCHREINEREI, OAK } = ctx.layout;
  const { getPathDistance, getHeight: gh } = ctx.ground;
  const A = SCHREINEREI.annex;
  const ca = Math.cos(A.rotY), sa = Math.sin(A.rotY);
  const toAnnex = (x, z) => {
    const dx = x - A.x, dz = z - A.z;
    return [dx * ca - dz * sa, dx * sa + dz * ca];
  };
  const D = SCHREINEREI.deck;
  const cd = Math.cos(D.rotY), sd = Math.sin(D.rotY);
  const toDeck = (x, z) => {
    const dx = x - D.x, dz = z - D.z;
    return [dx * cd - dz * sd, dx * sd + dz * cd];
  };
  const blocked = (x, z) => {
    if (getPathDistance(x, z) < 1.15) return true;
    const [ax, az] = toAnnex(x, z);
    if (Math.abs(ax) < ANNEX.hx + 0.25 && Math.abs(az) < ANNEX.hz + 0.25) return true; // the house
    if (ax < -ANNEX.hx - 0.1 && ax > -ANNEX.hx - 0.85 && az > -2.0 && az < 2.6) return true; // lumber rack
    if (ax > 0.6 && ax < 2.95 && az > ANNEX.hz && az < ANNEX.hz + 1.85) return true; // porch floor
    if (ax > -1.3 && ax < 0.8 && az > ANNEX.hz && az < ANNEX.hz + 0.9) return true; // door apron
    const [dx, dz] = toDeck(x, z);
    if (Math.abs(dx) < 2.15 && Math.abs(dz) < 1.6) return true; // deck
    if (dx < -1.0 && dx > -2.3 && dz > 1.3 && dz < 2.2) return true; // deck steps & planter
    if (Math.abs(x - OAK.door.x) < 1.25 && z < OAK.door.z + 1.6 && z > OAK.door.z - 0.5) return true; // door steps
    if (Math.hypot(x - OAK.x, z - OAK.z) < OAK.baseRadius + 0.5) return true; // the trunk
    return false;
  };
  const pads = [
    { x: A.x, z: A.z, r: 4.5 },
    { x: SCHREINEREI.porch.x, z: SCHREINEREI.porch.z, r: 2.7 },
    { x: OAK.door.x, z: OAK.door.z + 1.5, r: 2.7 },
    { x: D.x, z: D.z, r: 3.0 },
  ];
  const density = ctx.quality?.density ?? 1;
  const grass = ctx.materials.foliage({ variant: 'grass', color: '#6a9a40', wind: { strength: 0.05, base: 0.02 } });
  const leaves = ctx.materials.foliage({ variant: 'oak', color: '#b07a3e' });
  const vc = mats.vc();
  const tuft = (x, y, z, h) => {
    for (let k = 0; k < 3; k++) {
      const g = new THREE.PlaneGeometry(h * 0.9, h, 1, 1);
      g.translate(0, h / 2, 0);
      B.add(grass, xf(g, [x, y, z], [rng.jitter(0.15), (k / 3) * Math.PI + rng.jitter(0.3), rng.jitter(0.12)]), { cast: false });
    }
  };
  for (const pad of pads) {
    const n = Math.round(pad.r * pad.r * 9 * density);
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2, r = Math.sqrt(rng.next()) * pad.r;
      const x = pad.x + Math.cos(a) * r, z = pad.z + Math.sin(a) * r;
      if (blocked(x, z)) continue;
      const y = gh(x, z);
      const roll = rng.next();
      if (roll < 0.42) tuft(x, y, z, rng.range(0.12, 0.3));
      else if (roll < 0.58) B.add(mats.moss(), xf(mossGeo(rng, { r: rng.range(0.08, 0.2), h: rng.range(0.025, 0.05) }), [x, y, z]), { cast: false });
      else if (roll < 0.7) B.add(mats.stone(), xf(stoneGeo(rng, { r: rng.range(0.03, 0.07), sy: 0.55 }), [x, y + 0.01, z], [0, rng.next() * 6, 0]), { cast: false });
      else if (roll < 0.88) {
        // a fallen leaf lying flat
        const g = new THREE.PlaneGeometry(0.09, 0.11);
        g.translate(0, 0.055, 0);
        B.add(leaves, xf(g, [x, y + 0.008, z], [-Math.PI / 2 + rng.jitter(0.25), rng.next() * 6, 0, 'YXZ']), { cast: false });
      } else {
        // clover with a tiny white or yellow flower
        for (let k = 0; k < 3; k++) B.add(vc, xf(new THREE.CircleGeometry(0.022, 5), [x + rng.jitter(0.05), y + 0.02, z + rng.jitter(0.05)], [-Math.PI / 2 + rng.jitter(0.3), 0, 0]), { color: '#5e8a3a', cast: false });
        if (rng.next() < 0.6) B.add(vc, xf(new THREE.SphereGeometry(0.014, 5, 3), [x, y + 0.06, z]), { color: rng.pick(['#f2ead8', '#e8c22a', '#f2ead8']), cast: false });
      }
    }
  }
}

function lighten(hex, k) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, -0.05, k);
  return '#' + c.getHexString();
}
