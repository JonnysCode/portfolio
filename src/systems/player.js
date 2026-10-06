// ─────────────────────────────────────────────────────────────────────────────
// Player — Jonny's little avatar (apron + beanie).
//
// Input: click/tap the ground to walk there (routed AROUND obstacles with A*
// on the nav grid, then string-pulled), double-click to run, press-and-hold
// to walk towards the pointer, WASD / arrows (camera-relative, Shift = run).
// Movement has acceleration, turning pivots, a little lean, slope-aware speed,
// footstep dust on paths and idle fidgets when standing still.
//
// Public API (ctx.player):
//   person, group, position (Vector3), radius, facing, area, riding, moving, speed, velocity {x,z}
//   moveTo(x, z, { run, stopDistance, marker=true }) → route | null   (fire & forget)
//   walkTo(x, z, opts) → Promise<boolean>   true on arrival, false if interrupted / unreachable
//   approach(x, z, { distance=1.8 }) → Promise<boolean>   walk up to a thing and face it
//   stop()   teleport(x, z, facing)   face(x, z)   setEnabled(bool)   wave()
//   steerTowards(x, z) / steerEnd()           (hold-to-walk, driven by interactions)
//   mount(seat, { hop=true })                 sit on a seat Object3D (snail.seat); mount(null) = hop off in place
//   dismount(x, z, facing, { hop=true })      hop off to a ground spot → Promise
//   onAreaChange(fn(areaId, prevAreaId))      nav (the shared nav grid used for routing)
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight, getAreaAt, getPathDistance } from '../world/ground.js';
import { SPAWN, POND } from '../world/layout.js';
import { damp, clamp } from '../core/rng.js';
import { palette } from '../core/palette.js';
import { getNavGrid, POND_BLOCK_RADIUS } from './navgrid.js';
import { createDust } from './dust.js';

const WALK_SPEED = 4.2;
const RUN_SPEED = 7.5;
const RADIUS = 0.35;
const ACCEL = 15;
const DECEL = 24;
const TURN = 13;
const HOP_TIME = 0.42;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** Footstep dust tints: dirt paths and the stone-flagged clearings. */
const DUST_PATH = new THREE.Color(palette.dirt).lerp(new THREE.Color(palette.paper), 0.62);
const DUST_STONE = new THREE.Color(palette.stone).lerp(new THREE.Color(palette.paper), 0.55);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function createPlayer(ctx) {
  const { engine, colliders, interactions } = ctx;
  const reduced = engine.reducedMotion;
  const person = ctx.props.makePerson({
    seed: 'jonny',
    name: 'Jonny',
    shirt: '#4f6d9a',
    pants: '#3b4a5c',
    hat: 'beanie',
    hatColor: '#d9673b',
    apron: true,
    hairColor: '#6b4430',
  });
  const group = person.group;
  group.name = 'player';
  group.rotation.order = 'YXZ';
  ctx.scene.add(group);

  const nav = getNavGrid(ctx, RADIUS);
  const dust = createDust(ctx);
  const marker = makeClickMarker(ctx);
  const prints = makeFootprints(ctx);

  const position = new THREE.Vector3(SPAWN.x, getHeight(SPAWN.x, SPAWN.z), SPAWN.z);
  const velocity = { x: 0, z: 0 };
  let facing = SPAWN.facing;
  let speed = 0;
  let visualY = position.y;
  let enabled = true;
  let area = getAreaAt(position.x, position.z);
  const areaListeners = new Set();
  const keys = new Set();

  /** Active route: { points, index, run, stopDistance, resolve, stuck, tx, tz, replanned } */
  let route = null;
  /** Hold-to-walk target. */
  let steer = null;
  /** Desired facing while standing (face()). */
  let faceTarget = null;

  // riding / hop transitions
  let seat = null;
  let hop = null; // { t, dur, from: Vector3, fromQ, toSeat|toPos, toQ, height, onDone }

  // footsteps & fidgets
  let strideAcc = 0;
  let footSide = 1;
  let idleTime = 0;
  let nextFidget = 5 + Math.random() * 4;
  let fidget = null; // { kind, t, dur, yaw }
  let fidgetYaw = 0;
  let squash = 0;
  let hopY = 0;
  let lastTurn = 0;

  // double-click to run
  let lastClick = { t: -10, x: 0, z: 0 };

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  interactions.onGroundClick((p) => {
    if (!enabled || seat || hop) return;
    const now = engine.elapsed;
    const dbl = now - lastClick.t < 0.38 && Math.hypot(p.x - lastClick.x, p.z - lastClick.z) < 3;
    lastClick = { t: now, x: p.x, z: p.z };
    const r = player.moveTo(p.x, p.z, { run: dbl || undefined });
    if (r && !r.reached) marker.nudge();
  });

  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const next = { x: 0, z: 0 };

  function finishRoute(ok) {
    const r = route;
    route = null;
    if (ok) marker.arrive();
    else marker.hide();
    prints.hide();
    r?.opts?.onDone?.(ok);
    r?.resolve?.(ok);
  }

  function plan(x, z, opts = {}) {
    const r = nav.findPath(position.x, position.z, x, z);
    if (!r) return null;
    const run = opts.run ?? r.length > 16;
    return { ...r, index: 0, run, stopDistance: opts.stopDistance ?? 0.12, tx: x, tz: z, stuck: 0, replanned: 0, opts };
  }

  const player = {
    person,
    group,
    position,
    velocity,
    radius: RADIUS,
    nav,
    dust,
    get facing() {
      return facing;
    },
    get area() {
      return area;
    },
    get riding() {
      return !!seat;
    },
    /** The seat Object3D while riding (or null). */
    get seat() {
      return seat;
    },
    get moving() {
      return person.action === 'walk' || person.action === 'run';
    },
    get speed() {
      return speed;
    },
    get busy() {
      return !!hop;
    },
    /** The current route's remaining waypoints (read-only), or null. */
    get route() {
      return route;
    },
    /**
     * Walk to (x, z) around obstacles. If the spot is unreachable, walks to the
     * nearest reachable spot instead. Returns the planned route (or null).
     * opts: { run, stopDistance, marker = true, onDone(ok) } — onDone fires synchronously
     * from the update loop (true on arrival, false if interrupted / stuck / unreachable).
     */
    moveTo(x, z, opts = {}) {
      if (seat) {
        opts.onDone?.(false);
        return null;
      }
      if (route) finishRoute(false);
      steer = null;
      faceTarget = null;
      const r = plan(x, z, opts);
      if (!r) {
        marker.hide();
        opts.onDone?.(false);
        return null;
      }
      route = r;
      if (opts.marker !== false) {
        marker.show(r.end.x, r.end.z);
        prints.show(position.x, position.z, r.points);
      }
      return r;
    },
    /** Promise flavour of moveTo: resolves true on arrival, false if interrupted. */
    walkTo(x, z, opts = {}) {
      return new Promise((resolve) => {
        const r = player.moveTo(x, z, opts);
        if (!r) return resolve(false);
        r.resolve = resolve;
      });
    },
    /** Walk up to a point of interest (stopping `distance` short) and face it. */
    approach(x, z, { distance = 1.8, run } = {}) {
      return new Promise((resolve) => {
        const d = Math.hypot(x - position.x, z - position.z);
        if (d <= distance + 0.2) {
          player.face(x, z);
          return resolve(true);
        }
        const r = player.moveTo(x, z, { stopDistance: distance, run, marker: false });
        if (!r) return resolve(false);
        r.resolve = (ok) => {
          player.face(x, z);
          resolve(ok);
        };
      });
    },
    stop() {
      if (route) finishRoute(false);
      steer = null;
      marker.hide();
      prints.hide();
    },
    teleport(x, z, face = facing) {
      if (route) finishRoute(false);
      steer = null;
      position.set(x, getHeight(x, z), z);
      visualY = position.y;
      velocity.x = velocity.z = 0;
      speed = 0;
      facing = face;
      faceTarget = null;
      updateArea();
      group.position.copy(position);
      group.rotation.set(0, facing, 0);
    },
    /** Turn (smoothly) to look at a world point while standing. */
    face(x, z) {
      faceTarget = Math.atan2(x - position.x, z - position.z);
    },
    setEnabled(on) {
      enabled = on;
      if (!on) player.stop();
    },
    wave() {
      startFidget('wave');
    },
    steerTowards(x, z) {
      if (!enabled || seat || hop) return;
      if (route) finishRoute(false);
      if (!steer) steer = { x, z };
      steer.x = x;
      steer.z = z;
    },
    steerEnd() {
      steer = null;
    },
    /**
     * Sit on a seat Object3D (e.g. snail.seat). Pass null to hop off in place.
     * opts: { hop = true, onDone() } (onDone fires synchronously once seated).
     */
    mount(target, { hop: doHop = !reduced, onDone } = {}) {
      if (!target) {
        if (!seat) return Promise.resolve();
        // hop off to the side of the seat
        target = seat;
        target.getWorldQuaternion(tmpQ);
        fwd.set(1, 0, 0).applyQuaternion(tmpQ);
        const side = { x: position.x + fwd.x * 1.3, z: position.z + fwd.z * 1.3 };
        colliders.resolve(side, RADIUS);
        return player.dismount(side.x, side.z, facing, { hop: doHop, onDone });
      }
      if (route) finishRoute(false);
      steer = null;
      fidgetEnd();
      velocity.x = velocity.z = 0;
      speed = 0;
      if (!doHop) {
        seat = target;
        person.setAction('ride');
        onDone?.();
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        hop = {
          t: 0, dur: HOP_TIME, from: group.position.clone(), fromQ: group.quaternion.clone(),
          toSeat: target, height: 0.9,
          onDone: () => {
            seat = target;
            person.setAction('ride');
            onDone?.();
            resolve();
          },
        };
        person.setAction('idle');
      });
    },
    /** Hop off the seat to (x, z), facing `face`. opts: { hop = true, onDone() } */
    dismount(x, z, face = facing, { hop: doHop = !reduced, onDone } = {}) {
      const from = group.position.clone();
      const fromQ = group.quaternion.clone();
      seat = null;
      person.setAction('idle');
      person.setSpeed(0);
      if (!doHop) {
        player.teleport(x, z, face);
        onDone?.();
        return Promise.resolve();
      }
      const toPos = new THREE.Vector3(x, getHeight(x, z), z);
      const toQ = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, face);
      return new Promise((resolve) => {
        hop = {
          t: 0, dur: HOP_TIME, from, fromQ, toPos, toQ, height: 0.7,
          onDone: () => {
            player.teleport(x, z, face);
            land(1);
            onDone?.();
            resolve();
          },
        };
      });
    },
    onAreaChange(fn) {
      areaListeners.add(fn);
      return () => areaListeners.delete(fn);
    },
  };

  function updateArea() {
    const a = getAreaAt(position.x, position.z, 1);
    if (a !== area) {
      const prev = area;
      area = a;
      for (const fn of areaListeners) fn(a, prev);
    }
  }

  function land(strength) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      dust.puff(position.x + Math.cos(a) * 0.25, position.y, position.z + Math.sin(a) * 0.25, {
        size: 0.13 * strength, rise: 0.35, outward: 0.9, spread: 0.02, life: 0.5,
      });
    }
    squash = 0.16 * strength;
  }

  // ── idle fidgets ──
  function startFidget(kind) {
    const k = kind ?? pickFidget();
    let yaw = 0;
    if (k === 'look') yaw = (Math.random() < 0.5 ? -1 : 1) * (0.55 + Math.random() * 0.4);
    if (k === 'wave') {
      // turn towards the camera
      const cam = ctx.camera.position;
      yaw = wrap(Math.atan2(cam.x - position.x, cam.z - position.z) - facing);
      yaw = clamp(yaw, -2.2, 2.2);
    }
    fidget = { kind: k, t: 0, dur: k === 'wave' ? 2.6 : k === 'hop' ? 0.9 : 2.8, yaw, waved: false };
  }
  function pickFidget() {
    if (reduced) return 'look';
    const r = Math.random();
    return r < 0.45 ? 'look' : r < 0.75 ? 'wave' : 'hop';
  }
  function fidgetEnd() {
    if (fidget?.kind === 'wave' && person.action === 'wave') person.setAction('idle');
    fidget = null;
    idleTime = 0;
    nextFidget = 6 + Math.random() * 6;
  }
  function updateFidget(dt) {
    if (!fidget) {
      fidgetYaw += (0 - fidgetYaw) * damp(4, dt);
      hopY = 0;
      return;
    }
    const f = fidget;
    f.t += dt;
    const u = f.t / f.dur;
    if (f.kind === 'look' || f.kind === 'wave') {
      // turn → hold → turn back
      const env = u < 0.2 ? easeInOut(u / 0.2) : u > 0.8 ? easeInOut((1 - u) / 0.2) : 1;
      fidgetYaw = f.yaw * env;
      if (f.kind === 'wave') {
        if (!f.waved && u > 0.18) {
          person.setAction('wave');
          f.waved = true;
        }
        if (f.waved && u > 0.78 && person.action === 'wave') person.setAction('idle');
      }
    } else if (f.kind === 'hop') {
      // two little happy hops
      const ph = (u * 2) % 1;
      hopY = Math.sin(ph * Math.PI) * 0.16;
      if (ph < 0.06 && f.t > 0.1) squash = 0.1;
    }
    if (u >= 1) fidgetEnd();
  }

  engine.addUpdate((dt) => {
    // ── hop transitions (mounting / dismounting) ──
    if (hop) {
      group.scale.set(1, 1, 1);
      hop.t += dt;
      const u = Math.min(1, hop.t / hop.dur);
      const e = easeInOut(u);
      if (hop.toSeat) {
        hop.toSeat.getWorldPosition(tmpV);
        hop.toSeat.getWorldQuaternion(tmpQ);
      } else {
        tmpV.copy(hop.toPos);
        tmpQ.copy(hop.toQ);
      }
      group.position.lerpVectors(hop.from, tmpV, e);
      group.position.y += Math.sin(u * Math.PI) * hop.height;
      group.quaternion.slerpQuaternions(hop.fromQ, tmpQ, e);
      position.copy(group.position);
      person.update(dt);
      if (u >= 1) {
        const done = hop.onDone;
        hop = null;
        done?.();
      }
      return;
    }

    // ── riding: glued to the seat ──
    if (seat) {
      group.scale.set(1, 1, 1);
      seat.getWorldPosition(tmpV);
      seat.getWorldQuaternion(tmpQ);
      position.copy(tmpV);
      group.position.copy(tmpV);
      group.quaternion.copy(tmpQ);
      fwd.set(0, 0, 1).applyQuaternion(tmpQ);
      facing = Math.atan2(fwd.x, fwd.z);
      person.update(dt);
      updateArea();
      return;
    }

    // ── gather intent ──
    let dirX = 0, dirZ = 0, want = 0;
    let ix = 0, iz = 0;
    if (enabled) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) iz += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) iz -= 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    }
    if (ix || iz) {
      if (route) finishRoute(false);
      steer = null;
      faceTarget = null;
      ctx.camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      right.crossVectors(fwd, THREE.Object3D.DEFAULT_UP).normalize();
      dirX = fwd.x * iz + right.x * ix;
      dirZ = fwd.z * iz + right.z * ix;
      const l = Math.hypot(dirX, dirZ) || 1;
      dirX /= l;
      dirZ /= l;
      want = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
    } else if (steer) {
      const dx = steer.x - position.x, dz = steer.z - position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.6) {
        dirX = dx / d;
        dirZ = dz / d;
        want = d > 7 ? RUN_SPEED : WALK_SPEED * clamp(d / 1.5, 0.35, 1);
      }
    } else if (route) {
      let wp = route.points[route.index];
      const last = route.index === route.points.length - 1;
      let dx = wp.x - position.x, dz = wp.z - position.z;
      let d = Math.hypot(dx, dz);
      // advance when close, or when the next corner is already in sight
      if (!last && (d < 0.45 || nav.clearLine(position.x, position.z, route.points[route.index + 1].x, route.points[route.index + 1].z))) {
        route.index++;
        wp = route.points[route.index];
        dx = wp.x - position.x;
        dz = wp.z - position.z;
        d = Math.hypot(dx, dz);
      }
      const isLast = route.index === route.points.length - 1;
      const toGoal = Math.hypot(route.tx - position.x, route.tz - position.z);
      if (isLast && (d < 0.12 || toGoal <= route.stopDistance)) {
        finishRoute(true);
      } else {
        dirX = dx / (d || 1);
        dirZ = dz / (d || 1);
        // remaining distance along the route (for a soft arrival)
        let rem = d;
        for (let i = route.index + 1; i < route.points.length; i++) {
          rem += Math.hypot(route.points[i].x - route.points[i - 1].x, route.points[i].z - route.points[i - 1].z);
        }
        rem = Math.max(0, Math.min(rem, toGoal) - route.stopDistance);
        want = Math.min(route.run ? RUN_SPEED : WALK_SPEED, Math.sqrt(2 * DECEL * 0.45 * Math.max(rem, 0)) + 0.6);
      }
    }

    // ── turning pivot: slow down for sharp turns ──
    if (want > 0) {
      const diff = Math.abs(wrap(Math.atan2(dirX, dirZ) - facing));
      if (diff > 0.6) want *= clamp(1 - (diff - 0.6) / 2.0, 0.2, 1);
      // slope: a bit slower uphill, a touch faster downhill
      const ahead = getHeight(position.x + dirX * 0.6, position.z + dirZ * 0.6) - getHeight(position.x, position.z);
      want *= clamp(1 - (ahead / 0.6) * 0.7, 0.72, 1.12);
    }

    // ── accelerate towards the wanted velocity ──
    const tvx = dirX * want, tvz = dirZ * want;
    let dvx = tvx - velocity.x, dvz = tvz - velocity.z;
    const dl = Math.hypot(dvx, dvz);
    const maxStep = (want > speed ? ACCEL : DECEL) * dt;
    if (dl > maxStep) {
      dvx *= maxStep / dl;
      dvz *= maxStep / dl;
    }
    velocity.x += dvx;
    velocity.z += dvz;

    let moved = 0;
    if (velocity.x !== 0 || velocity.z !== 0) {
      next.x = position.x + velocity.x * dt;
      next.z = position.z + velocity.z * dt;
      colliders.resolve(next, RADIUS);
      // the pond is a soft wall: slide along the shore
      const px = next.x - POND.center.x, pz = next.z - POND.center.z;
      const pd = Math.hypot(px, pz);
      if (pd < POND_BLOCK_RADIUS) {
        next.x = POND.center.x + (px / (pd || 1)) * POND_BLOCK_RADIUS;
        next.z = POND.center.z + (pz / (pd || 1)) * POND_BLOCK_RADIUS;
      }
      const mx = next.x - position.x, mz = next.z - position.z;
      moved = Math.hypot(mx, mz);
      position.x = next.x;
      position.z = next.z;
      // keep only the velocity we actually achieved (sliding along walls)
      if (dt > 0) {
        velocity.x = mx / dt;
        velocity.z = mz / dt;
      }
    }
    speed = dt > 0 ? moved / dt : 0;
    if (speed < 0.02 && want === 0) {
      velocity.x = velocity.z = 0;
      speed = 0;
    }

    // stuck on a route (e.g. pushed by a villager): replan once, then give up
    if (route && want > 0.5) {
      if (speed < want * 0.2) route.stuck += dt;
      else route.stuck = Math.max(0, route.stuck - dt);
      if (route.stuck > 0.7) {
        if (route.replanned < 2) {
          const r = plan(route.tx, route.tz, route.opts);
          if (r) {
            r.resolve = route.resolve;
            r.replanned = route.replanned + 1;
            route = r;
          } else finishRoute(false);
        } else finishRoute(false);
      }
    }

    // ── facing ──
    const prevFacing = facing;
    if (speed > 0.25 || want > 0) {
      const target = speed > 0.25 ? Math.atan2(velocity.x, velocity.z) : Math.atan2(dirX, dirZ);
      facing += wrap(target - facing) * damp(TURN, dt);
      faceTarget = null;
    } else if (faceTarget !== null) {
      const diff = wrap(faceTarget - facing);
      facing += diff * damp(7, dt);
      if (Math.abs(diff) < 0.01) faceTarget = null;
    }
    facing = wrap(facing);
    const turnRate = dt > 0 ? wrap(facing - prevFacing) / dt : 0;
    lastTurn += (turnRate - lastTurn) * damp(10, dt);

    // ── animation state ──
    if (speed > 0.2) {
      person.setAction(speed > WALK_SPEED + 0.6 ? 'run' : 'walk');
      person.setSpeed(speed);
      if (fidget) fidgetEnd();
      idleTime = 0;
    } else {
      if (person.action === 'walk' || person.action === 'run') {
        person.setAction('idle');
        person.setSpeed(0);
      }
      if ((enabled && !route && !steer && person.action === 'idle') || fidget) {
        idleTime += dt;
        if (!fidget && idleTime > nextFidget && !ctx.ui?.isPanelOpen) startFidget();
      }
    }
    updateFidget(dt);

    // ── footsteps ──
    if (speed > 1.2) {
      strideAcc += moved;
      const stride = speed > WALK_SPEED + 0.6 ? 0.95 : 0.66;
      if (strideAcc > stride) {
        strideAcc = 0;
        footSide = -footSide;
        const onPath = getPathDistance(position.x, position.z) < 1.15;
        const inClearing = !onPath && area !== null;
        const lowTier = ctx.quality?.tier === 'low';
        if ((onPath || inClearing) && !(lowTier && footSide > 0)) {
          const rx = Math.cos(facing) * 0.13 * footSide, rz = -Math.sin(facing) * 0.13 * footSide;
          const bx = -Math.sin(facing) * 0.12, bz = -Math.cos(facing) * 0.12;
          const running = speed > WALK_SPEED + 0.6;
          dust.puff(position.x + rx + bx, position.y, position.z + rz + bz, {
            size: (running ? 0.17 : 0.12) * (onPath ? 1 : 0.75),
            count: running && onPath ? 2 : 1,
            rise: running ? 0.6 : 0.4,
            outward: running ? 0.5 : 0.25,
            color: onPath ? DUST_PATH : DUST_STONE,
          });
        }
      }
    } else strideAcc = 0.4;

    prints.update(dt, position.x, position.z);

    // ── place the avatar ──
    const gy = getHeight(position.x, position.z);
    visualY += (gy - visualY) * damp(22, dt);
    if (Math.abs(gy - visualY) > 0.5) visualY = gy;
    position.y = gy;
    squash += (0 - squash) * damp(9, dt);
    group.position.set(position.x, visualY + hopY, position.z);
    const lean = reduced ? 0 : clamp(speed / RUN_SPEED, 0, 1) * 0.12;
    const bank = reduced ? 0 : clamp(-lastTurn * speed * 0.008, -0.14, 0.14);
    group.rotation.set(lean, facing + fidgetYaw, bank);
    group.scale.set(1 + squash * 0.6, 1 - squash, 1 + squash * 0.6);
    person.update(dt);
    updateArea();
  }, 10);

  return player;
}

/** The little "go here" ring: pops in, pulses, and shrinks away on arrival. */
function makeClickMarker(ctx) {
  const mat = ctx.materials.basic(ctx.palette.spots, { transparent: true, depthWrite: false }).clone();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.38, 32), mat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  ring.renderOrder = 2;
  ring.name = 'click-marker';
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), mat);
  dot.position.z = 0.001;
  ring.add(dot);
  ctx.scene.add(ring);
  let t = 0;
  let state = 'hidden'; // shown | leaving | hidden
  let wobble = 0;
  ctx.engine.addUpdate((dt) => {
    if (state === 'hidden') return;
    t += dt;
    if (state === 'shown') {
      // elastic pop-in, then a gentle pulse
      const pop = t < 0.35 ? 1 - Math.cos(t * 18) * Math.exp(-t * 9) : 1;
      const s = pop * (1 + Math.sin(t * 5) * 0.06);
      wobble *= Math.exp(-dt * 6);
      ring.scale.set(s * (1 + Math.sin(t * 40) * wobble), s, s);
      mat.opacity = 0.85;
    } else {
      const u = Math.min(1, t / 0.3);
      ring.scale.setScalar(1 + u * 0.6);
      mat.opacity = 0.85 * (1 - u);
      if (u >= 1) {
        ring.visible = false;
        state = 'hidden';
      }
    }
  }, 30);
  return {
    show(x, z) {
      ring.position.set(x, ctx.ground.getHeight(x, z) + 0.05, z);
      ring.visible = true;
      state = 'shown';
      t = 0;
    },
    /** A little shake: "can't go exactly there, going close by". */
    nudge() {
      wobble = 0.25;
    },
    arrive() {
      if (state !== 'shown') return;
      state = 'leaving';
      t = 0;
    },
    hide() {
      ring.visible = false;
      state = 'hidden';
    },
  };
}

/**
 * Little footprints showing the way a click-walk will take (around obstacles).
 * They pop in one after another and fade as Jonny steps over them.
 */
function makeFootprints(ctx) {
  const MAX = 90;
  const SPACING = 0.5;
  const geo = new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2);
  const mat = ctx.materials.basic(ctx.palette.spots, { transparent: true, opacity: 0.62, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.name = 'footprints';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.count = 0;
  ctx.scene.add(mesh);
  const px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX), rot = new Float32Array(MAX);
  const born = new Float32Array(MAX), gone = new Float32Array(MAX);
  let n = 0, next = 0, t = 0, active = false;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const reduced = ctx.engine.reducedMotion;

  return {
    show(sx, sz, points) {
      n = 0;
      next = 0;
      t = 0;
      let ax = sx, az = sz, carry = 1.0, side = 1;
      let total = 0;
      for (const b of points) {
        total += Math.hypot(b.x - ax, b.z - az);
        ax = b.x;
        az = b.z;
      }
      if (total < 2.2) {
        this.hide();
        return;
      }
      ax = sx;
      az = sz;
      let walked = 0;
      for (const b of points) {
        const dx = b.x - ax, dz = b.z - az;
        const len = Math.hypot(dx, dz);
        if (len < 1e-4) continue;
        const ux = dx / len, uz = dz / len;
        let d = carry;
        while (d <= len && n < MAX && walked + d < total - 0.7) {
          const x = ax + ux * d + uz * 0.11 * side, z = az + uz * d - ux * 0.11 * side;
          px[n] = x;
          pz[n] = z;
          py[n] = ctx.ground.getHeight(x, z) + 0.035;
          rot[n] = Math.atan2(ux, uz);
          born[n] = reduced ? 0 : n * 0.022;
          gone[n] = -1;
          n++;
          side = -side;
          d += SPACING;
        }
        carry = d - len;
        walked += len;
        ax = b.x;
        az = b.z;
      }
      mesh.count = n;
      active = n > 0;
    },
    hide() {
      if (!active) return;
      for (let i = 0; i < n; i++) if (gone[i] < 0) gone[i] = t;
    },
    update(dt, x, z) {
      if (!active) return;
      t += dt;
      // step over the prints: everything up to the nearest one ahead fades
      for (let i = next; i < Math.min(n, next + 4); i++) {
        if ((px[i] - x) ** 2 + (pz[i] - z) ** 2 < 0.55 * 0.55) {
          for (let k = next; k <= i; k++) if (gone[k] < 0) gone[k] = t;
          next = i + 1;
        }
      }
      let alive = 0;
      for (let i = 0; i < n; i++) {
        let s = 0;
        const age = t - born[i];
        if (age > 0) s = age < 0.18 ? 1 - Math.cos(age * 22) * Math.exp(-age * 14) : 1;
        if (gone[i] >= 0) s *= Math.max(0, 1 - (t - gone[i]) / 0.35);
        if (s > 0 || gone[i] < 0) alive++;
        p.set(px[i], py[i], pz[i]);
        q.setFromAxisAngle(up, rot[i]);
        sc.set(0.062 * s, 1, 0.1 * s);
        m4.compose(p, q, sc);
        mesh.setMatrixAt(i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (!alive) {
        active = false;
        mesh.count = 0;
      }
    },
  };
}
