// ─────────────────────────────────────────────────────────────────────────────
// The Schneckenpost — the glen's slowest and most reliable postal service.
// A yellow post snail with a little postie riding in the saddle crawls the
// paths: from the main path past the Schreinerei, along the bridge path,
// over the humpbacked stone bridge to the Velowerkstatt on the far bank —
// and back again, pausing at either end (deliveries!) and for a breather on
// the bridge's crest.
//
// Plus the wild ones: two tiny snails grazing on mossy rocks; one of them is
// a 'secret' hotspot.
//
// The snail sits on getHeight() (or on the bridge deck, which follows the
// riverside builder's deck profile), faces its direction of travel and
// pitches with the slope. CPU: one tiny update per frame, no allocations.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight, pathPolylines } from '../ground.js';
import { PATHS, OAK } from '../layout.js';
import { palette } from '../../core/palette.js';

/** Height of the stone bridge's walking surface at local x (matches scene/riverside/bridge.js deckY). */
function deckHeight(x) {
  const k = Math.min(1, Math.abs(x) / 3.5);
  return 0.05 + (1.3 - 0.05) * Math.pow(Math.cos((k * Math.PI) / 2), 1.1);
}

/** The route: main path (front) → junction → bridge path → over the bridge → far bank. */
function buildRoute() {
  const pts = [];
  const main = pathPolylines.find((p) => p.id === 'main');
  const bridgePath = pathPolylines.find((p) => p.id === 'bridge');
  const far = pathPolylines.find((p) => p.id === 'farBank');
  const j = PATHS.bridge[0];
  // main path from z ≈ 17 down to the junction with the bridge path
  let jIdx = 0, best = Infinity;
  main.pts.forEach((p, i) => {
    const d = Math.hypot(p.x - j.x, p.z - j.z);
    if (d < best) {
      best = d;
      jIdx = i;
    }
  });
  for (let i = 0; i <= jIdx; i++) if (main.pts[i].z < 17.5) pts.push({ x: main.pts[i].x, z: main.pts[i].z, bridge: false });
  for (const p of bridgePath.pts) pts.push({ x: p.x, z: p.z, bridge: false });
  // over the bridge
  const A = PATHS.bridge[PATHS.bridge.length - 1], Bp = PATHS.farBank[0];
  const cx = (A.x + Bp.x) / 2, cz = (A.z + Bp.z) / 2;
  const L = Math.hypot(Bp.x - A.x, Bp.z - A.z);
  const ux = (Bp.x - A.x) / L, uz = (Bp.z - A.z) / L;
  for (let i = 1; i < 16; i++) {
    const t = i / 16;
    const x = A.x + (Bp.x - A.x) * t, z = A.z + (Bp.z - A.z) * t;
    pts.push({ x, z, bridge: true, lx: (x - cx) * ux + (z - cz) * uz });
  }
  // the far bank, stopping short of the workshop's door
  const fp = far.pts;
  for (let i = 0; i < fp.length * 0.55; i++) pts.push({ x: fp[i].x, z: fp[i].z, bridge: false });
  // arc length
  let s = 0;
  pts[0].s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    pts[i].s = s;
  }
  const crest = pts.reduce((a, p) => (p.bridge && Math.abs(p.lx) < Math.abs(a.lx ?? 99) ? p : a), {});
  return { pts, length: s, crestS: crest.s ?? s * 0.7 };
}

const _a = { x: 0, y: 0, z: 0, bridge: false };
function sample(route, s, out = _a) {
  const pts = route.pts;
  s = Math.max(0, Math.min(route.length, s));
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].s < s) lo = mid;
    else hi = mid;
  }
  const a = pts[lo], b = pts[hi];
  const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  if (a.bridge || b.bridge) {
    const ya = a.bridge ? deckHeight(a.lx) : getHeight(a.x, a.z);
    const yb = b.bridge ? deckHeight(b.lx) : getHeight(b.x, b.z);
    out.y = ya + (yb - ya) * t;
  } else out.y = getHeight(out.x, out.z);
  return out;
}

export function createSnailPost(ctx, { reduced = false } = {}) {
  const { makeSnail, makePerson } = ctx.props;
  const route = buildRoute();
  const snail = makeSnail({ post: true, seed: 'schneckenpost-glen' });
  snail.group.name = 'ambient:schneckenpost';
  snail.group.rotation.order = 'YXZ';
  const rider = makePerson({ seed: 'postie-ruedi', name: 'Ruedi', hat: 'cap', hatColor: palette.postYellow, shirt: '#3f5f8f', pants: '#2f3b4f', scarf: true, scarfColor: palette.swissRed, action: 'ride' });
  snail.seat.add(rider.group);
  ctx.scene.add(snail.group);
  snail.group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  // a speech bubble when clicked — it counts as a little secret
  const lines = ['Schneckenpost! Parcel for the Velowerkstatt…', 'Express delivery. Very, very express.', 'Grüezi! The bridge is my favourite bit.', 'Mind the ferns, Schnegg.'];
  let line = 0;
  ctx.interactions?.add(snail.group, {
    kind: 'secret',
    label: 'The Schneckenpost',
    area: 'glen',
    approach: false,
    focus: { distance: 4.5, height: 0.8 },
    onActivate: () => ctx.ui?.speech?.(lines[line++ % lines.length], rider.group),
  });

  const speed = reduced ? 0.32 : 0.5;
  // state machine: crawl → pause (ends, bridge crest, now and then)
  let s = route.length * 0.35;
  let dir = 1;
  let pause = 0;
  let crestDone = false;
  let yaw = 0, pitch = 0;
  const p = { x: 0, y: 0, z: 0 }, q = { x: 0, y: 0, z: 0 }, r = { x: 0, y: 0, z: 0 };
  let nextBreather = 12;

  function place(dt) {
    sample(route, s, p);
    sample(route, s + 0.7 * dir, q);
    sample(route, s - 0.7 * dir, r);
    const targetYaw = Math.atan2(q.x - r.x, q.z - r.z);
    let dy = targetYaw - yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    yaw += dy * Math.min(1, dt * 2.5);
    const targetPitch = -Math.atan2(q.y - r.y, Math.hypot(q.x - r.x, q.z - r.z));
    pitch += (targetPitch - pitch) * Math.min(1, dt * 3);
    snail.group.position.set(p.x, p.y, p.z);
    snail.group.rotation.set(pitch, yaw, 0);
  }
  place(10);

  return {
    snail,
    rider,
    route,
    update(dt) {
      if (dt <= 0) return;
      dt = Math.min(dt, 0.1);
      if (pause > 0) {
        pause -= dt;
        snail.setMoving(0);
        // turn around on the spot at the ends
        place(dt);
        return;
      }
      snail.setMoving(1);
      s += dir * speed * dt;
      nextBreather -= dt;
      if (!crestDone && Math.abs(s - route.crestS) < 0.1) {
        crestDone = true;
        pause = 3.5;
      } else if (nextBreather < 0) {
        nextBreather = 14 + Math.random() * 10;
        pause = 1.5 + Math.random() * 2;
      }
      if (s >= route.length) {
        s = route.length;
        dir = -1;
        pause = 6;
        crestDone = false;
      } else if (s <= 0) {
        s = 0;
        dir = 1;
        pause = 5;
        crestDone = false;
      }
      place(dt);
    },
  };
}

/** Wild garden snails on mossy rocks; the first one is a secret. */
export function createWildSnails(ctx, { rocks = [] } = {}) {
  const { makeSnail } = ctx.props;
  const out = [];
  // pick mossy rocks inside the glen that a spot camera can see (not too far out)
  const cands = rocks
    .filter((r) => Math.hypot(r.x, r.z) < 24 && Math.hypot(r.x - OAK.x, r.z - OAK.z) > 9 && r.r > 0.35 && r.r < 1.4)
    .sort((a, b) => Math.hypot(a.x - 2, a.z - 6) - Math.hypot(b.x - 2, b.z - 6));
  const picks = cands.slice(0, 2);
  const shells = ['#c98a4b', '#b39ddb'];
  picks.forEach((rock, i) => {
    const s = makeSnail({ seed: `wild-snail-${i}`, scale: 0.22, shellColor: shells[i], saddle: false, blanket: null });
    s.group.name = 'ambient:wild-snail';
    s.group.position.set(rock.x, rock.y - 0.02, rock.z);
    s.group.rotation.y = i * 2.1;
    ctx.scene.add(s.group);
    const state = { s, rock, a: i * 2.1, wander: 0.08 + rock.r * 0.1, t: 0 };
    if (i === 0) {
      ctx.interactions?.add(s.group, {
        kind: 'secret',
        label: 'A tiny snail on a mossy stone',
        area: 'glen',
        approach: false,
        focus: { distance: 1.6, height: 0.1 },
        onActivate: () => ctx.ui?.speech?.('…slow down. Look closer. There is moss to taste.', s.group),
      });
    }
    out.push(state);
  });
  return {
    snails: out,
    update(dt) {
      for (const w of out) {
        // a very slow loop around the top of its stone
        w.t += dt;
        w.a += dt * 0.05;
        const x = w.rock.x + Math.sin(w.a) * w.wander, z = w.rock.z + Math.cos(w.a) * w.wander;
        w.s.group.position.set(x, w.rock.y - 0.03, z);
        w.s.group.rotation.y = w.a + Math.PI / 2;
        w.s.setMoving(0.6);
      }
    },
  };
}
