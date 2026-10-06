// ─────────────────────────────────────────────────────────────────────────────
// Transport — the Schneckenpost (snail post), the village's PostAuto.
//
// A yellow post snail waits at every station. travelTo(areaId):
//   1. Jonny walks to the nearest station (or, if far away, the screen fades
//      and he's there), hops onto the saddle;
//   2. the PostAuto three-tone horn plays and the snail crawls "express"
//      along the dirt paths (out of the district, across the village square —
//      routed around whatever stands there — and into the destination);
//   3. on arrival: horn, Jonny hops off beside the snail facing into the
//      district, the area banner shows — and the snail crawls back home empty
//      (or quietly reappears at home once it's off-screen).
// Everything is frame-driven (no timers), so it behaves under debug.step().
//
//   ctx.transport.travelTo(areaId) → Promise<boolean>   resolved on arrival (false if refused / cancelled)
//   ctx.transport.skip()            jump to the arrival (fade) while riding
//   ctx.transport.cancel()          abort a trip that hasn't departed yet (or skip if riding)
//   ctx.transport.stations          [{ areaId, x, z, snail, heading, bay, dismount, state, hotspot }]
//   ctx.transport.busy              true from travelTo() until the rider has hopped off
//   ctx.transport.trip              { from, to, phase } while busy
//   ctx.transport.onArrive(fn(areaId, fromAreaId)) → unsubscribe
//   ctx.transport.stationFor(areaId)   ctx.transport.routeBetween(fromId, toId) → { length, points }
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { AREAS, AREA_BY_ID, PLAZA, localToWorld } from '../world/layout.js';
import { getHeight, pathPolylines } from '../world/ground.js';
import { damp, clamp } from '../core/rng.js';
import { palette } from '../core/palette.js';
import { getNavGrid } from './navgrid.js';

const EXPRESS = 7.2; // units/s
const HOMEWARD = 4.4;
const ACCEL = 3.4; // units/s²
const BRAKE = 3.2;
const TURN_RATE = 2.4; // rad/s when pivoting in place
const SNAIL_RADIUS = 0.85;
const FAR = 18; // further than this from the station → fade there instead of walking
const SAMPLE = 0.5; // route resampling step

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** Pale, glistening slime-trail droplets. */
const TRAIL = new THREE.Color(palette.water).lerp(new THREE.Color(palette.spots), 0.72);

export function createTransport(ctx) {
  const { engine, ui, audio } = ctx;
  const reduced = engine.reducedMotion;
  const playerNav = () => ctx.player?.nav;
  const snailNav = getNavGrid(ctx, SNAIL_RADIUS, { margin: 0.5 });
  const pathById = Object.fromEntries(pathPolylines.map((p) => [p.id, p]));
  const arriveListeners = new Set();
  const dust = () => ctx.player?.dust;

  // ─── stations ──────────────────────────────────────────────────────────────
  const stations = [];
  for (const area of AREAS) {
    const pos = area.station ?? PLAZA.station;
    const isPlaza = area.id === 'plaza';
    const heading = isPlaza ? Math.atan2(pos.x, pos.z) : area.facing;
    const snail = ctx.props.makeSnail({ post: true, saddle: true, seed: `post-${area.id}` });
    snail.group.name = `schneckenpost:${area.id}`;
    snail.group.rotation.order = 'YXZ';
    ctx.scene.add(snail.group);
    // an oriented box hugging the parked snail (it's long: head to shell tip)
    const half = (snail.length ?? 2.3) / 2;
    const collider = ctx.colliders.addBox(pos.x, pos.z, 0.6, half * 0.95, heading, 'station');
    const st = {
      areaId: area.id,
      area,
      x: pos.x,
      z: pos.z,
      heading,
      snail,
      collider,
      bay: null, // where arriving snails stop
      dismount: null, // where the rider hops off
      state: 'home', // home | riding | returning
      motion: null,
      // live pose
      px: pos.x,
      pz: pos.z,
      yaw: heading,
      pitch: 0,
      roll: 0,
      seed: stations.length * 1.7,
      offscreen: 0,
      trail: 0,
    };
    stations.push(st);
    st.hotspot = ctx.interactions.add(snail.group, {
      label: 'Schneckenpost — ride a snail',
      area: area.id,
      onActivate: () => ui?.showDestinations?.(area.id),
    });
    placeSnail(st, 0, true);
  }
  const byId = Object.fromEntries(stations.map((s) => [s.areaId, s]));

  // Bays & hop-off spots: checked against the nav grids, with fallbacks.
  for (const st of stations) setupBay(st);

  function setupBay(st) {
    const walkable = (x, z, nav) => !nav || nav.isWalkable(x, z);
    const pNav = getNavGrid(ctx, 0.35);
    if (st.areaId !== 'plaza') {
      const a = st.area;
      const r = a.radius;
      const tries = [[0.8, r - 4.4, -0.75], [0.6, r - 5.6, -0.95], [-0.8, r - 4.4, 0.75], [1.2, r - 3.6, -0.4]];
      for (const [bx, bz, dx] of tries) {
        const b = localToWorld(a, bx, bz);
        const d = localToWorld(a, bx + dx * 2, bz - 0.4);
        st.bay = { x: b.x, z: b.z, heading: a.facing + Math.PI };
        st.dismount = { x: d.x, z: d.z, facing: a.facing + Math.PI };
        if (walkable(b.x, b.z, snailNav) && walkable(d.x, d.z, pNav)) break;
      }
    } else {
      const rs = Math.hypot(st.x, st.z);
      const ang = Math.atan2(st.z, st.x);
      for (const da of [0.45, -0.45, 0.7, -0.7, 0.95, -0.95]) {
        const a = ang + da;
        const bx = Math.cos(a) * rs, bz = Math.sin(a) * rs;
        const dx = bx * (1 - 1.5 / rs), dz = bz * (1 - 1.5 / rs);
        st.bay = { x: bx, z: bz, heading: Math.atan2(-Math.sin(a) * Math.sign(da), Math.cos(a) * Math.sign(da)) };
        st.dismount = { x: dx, z: dz, facing: Math.atan2(-dx, -dz) };
        if (walkable(bx, bz, snailNav) && walkable(dx, dz, pNav)) break;
      }
    }
  }

  // ─── routes ────────────────────────────────────────────────────────────────
  /** Points of a district path from the plaza edge (index 0) into the district. */
  const pathPts = (id) => pathById[id]?.pts ?? [];

  /** Trim `skip` units of arc length off the end (district side) of a polyline. */
  function trimmedPath(id, skip) {
    const pts = pathPts(id);
    let acc = 0, cut = pts.length - 1;
    for (let i = pts.length - 1; i > 0; i--) {
      acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      cut = i - 1;
      if (acc >= skip) break;
    }
    return pts.slice(0, cut + 1);
  }

  function buildRoute(from, to) {
    const raw = [];
    const push = (x, z) => {
      const last = raw[raw.length - 1];
      if (last && Math.hypot(last.x - x, last.z - z) < 0.35) return;
      raw.push({ x, z });
    };
    const fx = Math.sin(from.heading), fz = Math.cos(from.heading);
    push(from.x, from.z);
    let cross0;
    if (from.areaId !== 'plaza') {
      // district stops face the way out: crawl straight ahead onto the path
      push(from.x + fx * 1.6, from.z + fz * 1.6);
      const out = trimmedPath(from.areaId, 4.2).reverse();
      for (const p of out) push(p.x, p.z);
      cross0 = out[out.length - 1];
    }

    let inbound = null;
    let cross1;
    if (to.areaId !== 'plaza') {
      inbound = trimmedPath(to.areaId, 4.2);
      cross1 = inbound[0];
    } else cross1 = to.bay;

    if (from.areaId === 'plaza') {
      // the square's stop: pivot towards where we're going, then crawl off
      const dx = cross1.x - from.x, dz = cross1.z - from.z;
      const l = Math.hypot(dx, dz) || 1;
      push(from.x + (dx / l) * 2.6, from.z + (dz / l) * 2.6);
      cross0 = raw[raw.length - 1];
    }

    // across the square: A* around whatever stands there
    const r = snailNav.findPath(cross0.x, cross0.z, cross1.x, cross1.z);
    if (r) for (const p of r.points) push(p.x, p.z);
    else push(cross1.x, cross1.z);

    if (inbound) {
      for (const p of inbound) push(p.x, p.z);
      const bx = Math.sin(to.bay.heading), bz = Math.cos(to.bay.heading);
      push(to.bay.x - bx * 1.8, to.bay.z - bz * 1.8);
    }
    push(to.bay.x, to.bay.z);
    return resample(raw);
  }

  /** Smooth a polyline with a centripetal Catmull-Rom and resample it evenly. */
  function resample(raw) {
    if (raw.length < 2) raw.push({ x: raw[0].x + 0.01, z: raw[0].z });
    const curve = new THREE.CatmullRomCurve3(raw.map((p) => new THREE.Vector3(p.x, 0, p.z)), false, 'centripetal');
    const len = curve.getLength();
    const n = Math.max(2, Math.ceil(len / SAMPLE) + 1);
    const pts = curve.getSpacedPoints(n - 1);
    const xs = new Float32Array(n), zs = new Float32Array(n), S = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = pts[i].x;
      zs[i] = pts[i].z;
      if (i > 0) S[i] = S[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
    }
    return { xs, zs, S, length: S[n - 1], n };
  }

  /** Sample a route at arc length s → out {x, z, tx, tz}; `cursor` keeps lookups O(1). */
  function sampleRoute(route, s, m, out) {
    const { xs, zs, S, n } = route;
    s = clamp(s, 0, route.length);
    let i = clamp(m.cursor | 0, 0, n - 2);
    while (i < n - 2 && S[i + 1] < s) i++;
    while (i > 0 && S[i] > s) i--;
    m.cursor = i;
    const seg = S[i + 1] - S[i] || 1;
    const u = (s - S[i]) / seg;
    out.x = xs[i] + (xs[i + 1] - xs[i]) * u;
    out.z = zs[i] + (zs[i + 1] - zs[i]) * u;
    // tangent from a slightly wider window for smooth turning
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 2);
    const tx = xs[b] - xs[a], tz = zs[b] - zs[a];
    const tl = Math.hypot(tx, tz) || 1;
    out.tx = tx / tl;
    out.tz = tz / tl;
    return out;
  }

  // ─── snail motion ──────────────────────────────────────────────────────────
  const smp = { x: 0, z: 0, tx: 0, tz: 1 };

  /** Start a snail along a route. dir = 1 forwards, -1 backwards (return trips). */
  function drive(st, route, { dir = 1, vmax = EXPRESS, onDone, delay = 0 } = {}) {
    const m = {
      route, dir, vmax, onDone, delay,
      s: dir > 0 ? 0 : route.length,
      v: 0, cursor: dir > 0 ? 0 : route.n - 2, gait: 0,
      phase: 'pivot',
    };
    sampleRoute(route, m.s + dir * 0.6, m, smp);
    m.pivotTo = Math.atan2(smp.tx * dir, smp.tz * dir);
    st.motion = m;
    return m;
  }

  /** Pivot in place to a heading, then call onDone. */
  function pivot(st, heading, onDone) {
    st.motion = { phase: 'pivot', pivotTo: heading, onDone, pivotOnly: true, v: 0, delay: 0 };
  }

  function updateMotion(st, dt) {
    const m = st.motion;
    if (!m) return 0;
    if (m.delay > 0) {
      m.delay -= dt;
      return 0;
    }
    if (m.phase === 'pivot') {
      const diff = wrap(m.pivotTo - st.yaw);
      const stepA = TURN_RATE * dt * clamp(Math.abs(diff) * 2.5, 0.25, 1);
      if (Math.abs(diff) <= stepA || reduced) {
        st.yaw = m.pivotTo;
        if (m.pivotOnly) {
          st.motion = null;
          m.onDone?.();
          return 0;
        }
        m.phase = 'move';
      } else st.yaw += Math.sign(diff) * stepA;
      return 0.35;
    }
    // move
    const remaining = m.dir > 0 ? m.route.length - m.s : m.s;
    const brakeV = Math.sqrt(2 * BRAKE * Math.max(remaining, 0)) + 0.2;
    let want = Math.min(m.vmax, brakeV);
    // an empty snail politely waits for whoever stands in its way
    const pl = ctx.player;
    if (st.state === 'returning' && pl && !pl.riding) {
      const fx = st.px + Math.sin(st.yaw) * 1.3, fz = st.pz + Math.cos(st.yaw) * 1.3;
      if ((pl.position.x - fx) ** 2 + (pl.position.z - fz) ** 2 < 1.5 * 1.5) want = 0;
    }
    m.v += clamp(want - m.v, -BRAKE * 2 * dt, ACCEL * dt);
    // the "inch-worm" surge of a hurrying snail
    m.gait += m.v * dt * 1.9;
    const surge = reduced ? 1 : 1 + 0.17 * Math.sin(m.gait);
    const ds = m.v * surge * dt;
    m.s += m.dir * ds;
    sampleRoute(m.route, m.s, m, smp);
    st.px = smp.x;
    st.pz = smp.z;
    const want_yaw = Math.atan2(smp.tx * m.dir, smp.tz * m.dir);
    st.yaw += wrap(want_yaw - st.yaw) * damp(7, dt);
    st.accel = (st.accel ?? 0) + ((want - m.v) - (st.accel ?? 0)) * damp(4, dt);
    // a glistening trail behind express snails
    st.trail += ds;
    if (st.trail > 0.7 && m.vmax >= EXPRESS && !reduced && ctx.quality?.tier !== 'low') {
      st.trail = 0;
      const back = 1.05;
      const x = st.px - Math.sin(st.yaw) * back, z = st.pz - Math.cos(st.yaw) * back;
      dust()?.puff(x, getHeight(x, z), z, { size: 0.09, rise: 0.18, outward: 0.35, life: 0.7, color: TRAIL, count: 1 });
    }
    if ((m.dir > 0 && m.s >= m.route.length - 1e-3) || (m.dir < 0 && m.s <= 1e-3)) {
      st.motion = null;
      m.v = 0;
      m.onDone?.();
      return 0;
    }
    return clamp(m.v / EXPRESS, 0.15, 1);
  }

  /** Put the snail on the ground, aligned with the slope. */
  function placeSnail(st, dt, instant = false) {
    const g = st.snail.group;
    const x = st.px, z = st.pz;
    const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw);
    const hf = getHeight(x + fx * 0.9, z + fz * 0.9), hb = getHeight(x - fx * 0.9, z - fz * 0.9);
    const hl = getHeight(x + fz * 0.45, z - fx * 0.45), hr = getHeight(x - fz * 0.45, z + fx * 0.45);
    const pitch = Math.atan2(hf - hb, 1.8);
    const roll = Math.atan2(hl - hr, 0.9) * 0.7;
    const k = instant ? 1 : damp(8, dt);
    // lean back a touch when speeding up, forward when braking
    const lean = reduced ? 0 : clamp(-(st.accel ?? 0) * 0.025, -0.06, 0.06);
    st.pitch += (pitch - st.pitch) * k;
    st.roll += (roll - st.roll) * k;
    g.position.set(x, Math.max(getHeight(x, z), (hf + hb) / 2), z);
    g.rotation.set(-st.pitch + lean, st.yaw, st.roll);
  }

  function sendHome(st, route) {
    st.state = 'returning';
    st.hotspot.enabled = false;
    st.offscreen = 0;
    drive(st, route, { dir: -1, vmax: HOMEWARD, delay: 0.5, onDone: () => pivot(st, st.heading, () => parkHome(st)) });
  }

  function parkHome(st) {
    st.motion = null;
    st.state = 'home';
    st.px = st.x;
    st.pz = st.z;
    st.yaw = st.heading;
    st.hotspot.enabled = true;
    st.snail.setMoving(0);
  }

  // ─── frustum test for "return when off-screen" ────────────────────────────
  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  const bsphere = new THREE.Sphere(new THREE.Vector3(), 2);

  engine.addUpdate((dt, t) => {
    let frustumReady = false;
    for (const st of stations) {
      let moving = 0;
      if (st.motion) moving = updateMotion(st, dt);
      else if (st.state === 'home') {
        // idling: a slow, curious look around
        const sway = reduced ? 0 : Math.sin(t * 0.33 + st.seed) * 0.09 + Math.sin(t * 0.71 + st.seed * 2) * 0.04;
        st.yaw = st.heading + sway;
      }
      // a returning snail that nobody is watching just pops home
      if (st.state === 'returning' && ctx.player) {
        if (!frustumReady) {
          projScreen.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse);
          frustum.setFromProjectionMatrix(projScreen);
          frustumReady = true;
        }
        bsphere.center.set(st.px, getHeight(st.px, st.pz) + 1, st.pz);
        const far = Math.hypot(st.px - ctx.player.position.x, st.pz - ctx.player.position.z) > 22;
        st.offscreen = !frustum.intersectsSphere(bsphere) && far ? st.offscreen + dt : 0;
        if (st.offscreen > 1.2) parkHome(st);
      }
      st.snail.setMoving(moving);
      placeSnail(st, dt);
      st.snail.update(dt);
      // the rider reads the seat right after us (player updates at order 10)
      st.snail.group.updateMatrixWorld(true);
    }
    if (trip) updateTrip(dt);
  }, 9);

  // ─── trips ─────────────────────────────────────────────────────────────────
  let trip = null;
  let lastBanner = { id: null, t: -10 };
  ctx.player?.onAreaChange?.((id) => (lastBanner = { id, t: engine.elapsed }));

  function nearestStation(x, z, exclude) {
    let best = null, bestD = Infinity;
    for (const st of stations) {
      if (st === exclude) continue;
      const d = Math.hypot(st.x - x, st.z - z);
      if (d < bestD) {
        bestD = d;
        best = st;
      }
    }
    return best;
  }

  /** Side of the snail to board from (closest to the player, walkable). */
  function boardingSpot(st) {
    const sx = Math.cos(st.heading), sz = -Math.sin(st.heading);
    const p = ctx.player.position;
    const a = { x: st.x + sx * 1.55, z: st.z + sz * 1.55 };
    const b = { x: st.x - sx * 1.55, z: st.z - sz * 1.55 };
    const nav = playerNav();
    const okA = !nav || nav.isWalkable(a.x, a.z), okB = !nav || nav.isWalkable(b.x, b.z);
    if (okA && okB) return Math.hypot(a.x - p.x, a.z - p.z) <= Math.hypot(b.x - p.x, b.z - p.z) ? a : b;
    if (okB) return b;
    if (okA) return a;
    const back = { x: st.x - Math.sin(st.heading) * 1.9, z: st.z - Math.cos(st.heading) * 1.9 };
    return back;
  }

  function setPhase(phase) {
    trip.phase = phase;
    trip.t = 0;
  }

  function endTrip(ok) {
    const tr = trip;
    trip = null;
    ui?.hideRideHUD?.();
    tr?.resolve?.(ok);
  }

  function updateTrip(dt) {
    const tr = trip;
    tr.t += dt;
    const player = ctx.player;
    switch (tr.phase) {
      case 'walk': {
        // the visitor took over (clicked elsewhere / pressed keys) → cancel quietly
        if (tr.walkResult === false) {
          if (player.route || player.speed > 0.5) return endTrip(false);
          setPhase('fadeOut');
        } else if (tr.walkResult === true) {
          setPhase('board');
        } else if (tr.t > tr.walkTimeout) {
          player.stop();
          setPhase('fadeOut');
        }
        break;
      }
      case 'fadeOut': {
        if (tr.t === dt) ui?.fade?.(true);
        if (tr.t > 0.5) {
          const b = boardingSpot(tr.origin);
          player.teleport(b.x, b.z, Math.atan2(tr.origin.x - b.x, tr.origin.z - b.z));
          ctx.cameraRig?.snap();
          ui?.fade?.(false);
          setPhase('board');
        }
        break;
      }
      case 'board': {
        if (tr.t === dt) {
          player.face(tr.origin.x, tr.origin.z);
          tr.origin.hotspot.enabled = false;
          tr.origin.state = 'riding';
          player.mount(tr.origin.snail.seat, { onDone: () => trip === tr && setPhase('depart') });
        }
        break;
      }
      case 'depart': {
        if (tr.t === dt) {
          audio?.play?.('horn');
          ui?.showRideHUD?.({ from: tr.origin.areaId, to: tr.dest.areaId, onSkip: () => transport.skip() });
          tr.route = buildRoute(tr.origin, tr.dest);
          drive(tr.origin, tr.route, {
            vmax: EXPRESS,
            delay: reduced ? 0.1 : 0.7,
            onDone: () => trip === tr && setPhase('arrive'),
          });
          setPhase('ride');
        }
        break;
      }
      case 'ride':
        break;
      case 'skip': {
        if (tr.t === dt) ui?.fade?.(true);
        if (tr.t > 0.5) {
          // jump the snail to the end of its route
          const st = tr.origin;
          const r = tr.route ?? (tr.route = buildRoute(tr.origin, tr.dest));
          st.motion = null;
          st.px = r.xs[r.n - 1];
          st.pz = r.zs[r.n - 1];
          st.yaw = Math.atan2(r.xs[r.n - 1] - r.xs[Math.max(0, r.n - 4)], r.zs[r.n - 1] - r.zs[Math.max(0, r.n - 4)]);
          placeSnail(st, 0, true);
          st.snail.group.updateMatrixWorld(true);
          ctx.cameraRig?.snap();
          ui?.fade?.(false);
          setPhase('arrive');
        }
        break;
      }
      case 'arrive': {
        if (tr.t === dt) audio?.play?.('horn');
        if (tr.t > (reduced ? 0.1 : 0.55) && !tr.dismounting) {
          tr.dismounting = true;
          const d = tr.dest.dismount;
          player.dismount(d.x, d.z, d.facing, {
            onDone: () => {
              if (trip !== tr) return;
              const arrived = tr.dest.areaId;
              if (lastBanner.id !== arrived || engine.elapsed - lastBanner.t > 2.5) ui?.showAreaBanner?.(arrived);
              sendHome(tr.origin, tr.route);
              endTrip(true);
              for (const fn of arriveListeners) fn(arrived, tr.origin.areaId);
            },
          });
        }
        break;
      }
    }
  }

  const transport = {
    stations,
    get busy() {
      return !!trip;
    },
    /** Current trip info (read-only) or null. */
    get trip() {
      return trip ? { from: trip.origin.areaId, to: trip.dest.areaId, phase: trip.phase } : null;
    },
    stationFor(areaId) {
      return byId[areaId] ?? null;
    },
    /** Debug / UI: the ride route between two stations. */
    routeBetween(fromId, toId) {
      const r = buildRoute(byId[fromId], byId[toId]);
      const points = [];
      for (let i = 0; i < r.n; i += 4) points.push({ x: +r.xs[i].toFixed(2), z: +r.zs[i].toFixed(2) });
      return { length: r.length, points };
    },
    travelTo(areaId) {
      const dest = byId[areaId];
      const player = ctx.player;
      if (!dest || trip || !player || player.riding || player.busy) return Promise.resolve(false);
      const p = player.position;
      if (player.area === areaId) {
        ui?.toast?.(`You're already at ${AREA_BY_ID[areaId]?.title ?? 'your destination'} 🐌`);
        return Promise.resolve(true);
      }
      const origin = player.area && byId[player.area] ? byId[player.area] : nearestStation(p.x, p.z, dest);
      // the ride should be seen: close an open exhibit panel first
      if (ui?.isPanelOpen) ui.closePanel?.();
      // the origin snail must be home (a returning one hops back instantly)
      if (origin.state !== 'home') parkHome(origin);
      return new Promise((resolve) => {
        trip = { origin, dest, phase: 'walk', t: 0, resolve, walkResult: null, walkTimeout: 0 };
        const b = boardingSpot(origin);
        const direct = Math.hypot(b.x - p.x, b.z - p.z);
        const route = direct < FAR ? player.nav.findPath(p.x, p.z, b.x, b.z) : null;
        if (!route || route.length > FAR * 1.4 || !route.reached) {
          player.stop();
          setPhase('fadeOut');
          if (direct < 0.6) setPhase('board');
          return;
        }
        const tr = trip;
        tr.walkTimeout = route.length / 3 + 4;
        player.moveTo(b.x, b.z, {
          stopDistance: 0.2,
          onDone: (ok) => {
            if (trip === tr) tr.walkResult = ok;
          },
        });
      });
    },
    /** Jump straight to the arrival (with a soft fade). */
    skip() {
      if (!trip) return;
      if (trip.phase === 'ride' || trip.phase === 'depart') {
        if (!trip.route) ui?.showRideHUD?.({ from: trip.origin.areaId, to: trip.dest.areaId });
        setPhase('skip');
      }
    },
    /** Abort a trip that hasn't left yet; while riding this skips to the arrival. */
    cancel() {
      if (!trip) return;
      if (trip.phase === 'walk' || trip.phase === 'fadeOut') {
        ctx.player?.stop();
        if (trip.phase === 'fadeOut') ui?.fade?.(false);
        endTrip(false);
      } else transport.skip();
    },
    onArrive(fn) {
      arriveListeners.add(fn);
      return () => arriveListeners.delete(fn);
    },
  };

  // Warm the nav grids up after boot so the first click / ride doesn't hitch.
  const warm = () => {
    try {
      getNavGrid(ctx, 0.35).ensure();
      snailNav.ensure();
      for (const st of stations) if (st.areaId !== 'plaza') buildRoute(st, byId.plaza);
    } catch (err) {
      console.warn('[transport] nav warm-up failed', err);
    }
  };
  if (engine.params.has('shots')) warm();
  else if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 2500 });
  else setTimeout(warm, 1200);

  return transport;
}
