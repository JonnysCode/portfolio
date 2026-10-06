// ─────────────────────────────────────────────────────────────────────────────
// Camera rig — a cozy third-person "diorama" camera.
//
// Follows the player with soft damping and a little look-ahead in the walking
// direction. Drag to orbit (with inertia), wheel / pinch to zoom (zooming out
// also tilts towards a top-down diorama view), two-finger twist to rotate.
// Never dips into hills: the terrain is sampled along the view line and the
// camera lifts over it. While riding a snail it swings in behind & beside it.
//
//   rig.target                         THREE.Vector3 the camera looks at (lighting/fog/ambient follow it)
//   rig.focus(object3d | point, { distance, height, yaw, pitch })   frame an exhibit nicely
//   rig.release()                      glide back to the player
//   rig.playIntro({ duration }) → Promise   cinematic glide from a village overview to the player
//                                      (skippable by any input; instant with reduced motion)
//   rig.prepareIntro()                 park at the overview (slow drift) until playIntro()
//   rig.autoIntro = false              (UI) don't auto-play the intro on the first frame; by default
//                                      the rig plays it itself unless prepareIntro/playIntro ran first
//                                      (never in ?shots mode or with ?nointro)
//   rig.setRide(object3d | null, { distance, pitch, side })   ride camera (auto while player.riding)
//   rig.setViewInset({ right, bottom })   px of screen covered by UI (panel); framing shifts to the free area
//   rig.setOverride(position, lookAt) / rig.clearOverride()   (debug & cut-scenes)
//   rig.snap()                         jump to the desired pose on the next update
//   rig.yaw / rig.pitch / rig.distance  (get/set)   rig.mode  ('follow'|'focus'|'ride'|'intro'|'override')
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { damp, clamp, lerp } from '../core/rng.js';
import { getHeight } from '../world/ground.js';

const MIN_D = 6;
const MAX_D = 42;
const MIN_PITCH = 0.2;
const MAX_PITCH = 1.32;
const BASE_D = 15;
/** The camera never leaves this radius (tree data & the walkable valley end around here). */
const CAMERA_RADIUS = 80;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createCameraRig(ctx) {
  const { engine, camera } = ctx;
  const canvas = engine.renderer.domElement;
  const gestures = ctx.interactions?.gestures ?? null;
  const reduced = engine.reducedMotion;
  const isTouch = engine.isTouch;

  const target = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const lookAhead = new THREE.Vector3();
  const trackVel = new THREE.Vector3();
  const prevFollow = new THREE.Vector3();
  const followPoint = new THREE.Vector3();

  // Desired orbit (input writes here) and the smoothed orbit the camera uses.
  let yaw = 0; // 0 → camera sits on +Z side of the target, looking towards −Z
  let pitch = 0.62;
  let desiredDistance = isTouch ? 18 : BASE_D;
  let camYaw = yaw, camPitch = pitch, distance = desiredDistance;
  let coupling = 1; // how much zoom tilts the view (off while framing an exhibit)
  let glide = 0; // >0 → slow, cinematic angle transitions (focus / release / ride)
  let yawVel = 0, pitchVel = 0;
  let lastUserOrbit = -10;
  let dragging = false;

  // modes
  let focus = null; // { point, distance, saved }
  let ride = null; // { object, distance, pitch, side, saved }
  let override = null;
  let intro = null; // { parked, t } | { t, dur, from, resolve, skipped }
  // The UI normally drives the intro (prepareIntro() under a welcome card, playIntro() on
  // "Enter"). If nobody has by the first live frame, the rig plays it on its own.
  let introClaimed = engine.params.has('shots') || engine.params.has('nointro');
  let first = true;
  let followBlend = 1; // ramps up after a release so the glide back is soft
  let lift = 0;
  let pull = 1; // < 1 when the camera is pulled in to stay out of tree crowns
  const treeBuf = [];
  const inset = { right: 0, bottom: 0 };
  let insetFromUI = false;
  const shift = { x: 0, y: 0 };
  let offsetActive = false;

  const offset = new THREE.Vector3();
  const desiredPos = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const box = new THREE.Box3();
  const sphere = new THREE.Sphere();

  // ── input ──
  function userOrbit() {
    lastUserOrbit = engine.elapsed;
    glide = 0;
  }
  if (gestures) {
    gestures.on('dragstart', () => {
      dragging = true;
      yawVel = pitchVel = 0;
    });
    gestures.on('drag', ({ dx, dy, pointerType }) => {
      if (override || (intro && !intro.parked)) return;
      const k = pointerType === 'touch' ? 0.0068 : 0.0056;
      yaw -= dx * k;
      pitch = clamp(pitch + dy * 0.0042, MIN_PITCH, MAX_PITCH);
      userOrbit();
    });
    gestures.on('dragend', ({ vx, vy }) => {
      dragging = false;
      if (reduced) return;
      yawVel = clamp(-vx * 0.0056, -4, 4);
      pitchVel = clamp(vy * 0.0042 * 0.5, -1.5, 1.5);
    });
    gestures.on('pinch', ({ scale, rotate, dy }) => {
      if (override) return;
      zoomBy(1 / clamp(scale, 0.5, 2));
      if (Math.abs(rotate) > 0.002) yaw += rotate;
      if (Math.abs(dy) > 0.5) pitch = clamp(pitch + dy * 0.003, MIN_PITCH, MAX_PITCH);
      userOrbit();
    });
  }
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (override) return;
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= 400;
      // trackpad pinch arrives as ctrl+wheel with small deltas
      zoomBy(Math.exp(clamp(dy, -200, 200) * (e.ctrlKey ? 0.01 : 0.0011)));
    },
    { passive: false }
  );
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === 'Equal' || e.code === 'NumpadAdd') zoomBy(0.85);
    else if (e.code === 'Minus' || e.code === 'NumpadSubtract') zoomBy(1 / 0.85);
  });

  function zoomBy(f) {
    if (focus) focus.distance = clamp(focus.distance * f, MIN_D * 0.6, MAX_D);
    else desiredDistance = clamp(desiredDistance * f, MIN_D, MAX_D);
  }

  /** Zooming out tilts towards a top-down diorama; zooming in gets cinematic. */
  const pitchFor = (p, d, c = 1) => clamp(p + (d - BASE_D) * 0.011 * c, MIN_PITCH, MAX_PITCH);

  /** Where the follow camera wants to look (player, without look-ahead). */
  function computeFollow(out) {
    const player = ctx.player;
    if (!player) return out.set(0, 1, 0);
    return out.set(player.position.x, player.position.y + (player.riding ? 0.5 : 1.0), player.position.z);
  }

  /** Lift needed so the line target→camera clears the terrain. */
  function terrainLift(tx, ty, tz, px, py, pz) {
    let need = 0;
    for (let i = 1; i <= 7; i++) {
      const f = 0.22 + (i / 7) * 0.78;
      const x = tx + (px - tx) * f, z = tz + (pz - tz) * f;
      const y = ty + (py - ty) * f;
      const clear = getHeight(x, z) + 0.7 + 0.9 * f;
      if (y < clear) need = Math.max(need, (clear - y) / f);
    }
    return need;
  }

  /** Is the point inside a tree crown? (trees come from vegetation's spatial lookup) */
  function inCrown(x, y, z) {
    for (let i = 0; i < treeBuf.length; i++) {
      const t = treeBuf[i];
      const dx = x - t.x, dz = z - t.z;
      const r = t.crownR + 0.7;
      if (dx * dx + dz * dz > r * r) continue;
      // firs are tall cones, broadleaves round puffs
      const top = t.crownY + t.crownR * (t.kind === 'pine' ? 2.4 : 1.35) + 0.5;
      const bottom = Math.min(t.crownY - t.crownR, (t.y ?? 0) + 1.8);
      if (y > bottom && y < top) return true;
    }
    return false;
  }

  /**
   * How far along the view ray the camera may sit: never inside foliage
   * (vegetation's tree lookup) and never out in the far forest beyond the rim.
   */
  function crownPull() {
    let f = 1;
    // stay within CAMERA_RADIUS of the village centre
    const ex = target.x + offset.x, ez = target.z + offset.z;
    if (ex * ex + ez * ez > CAMERA_RADIUS * CAMERA_RADIUS) {
      const a = offset.x * offset.x + offset.z * offset.z;
      const b = 2 * (target.x * offset.x + target.z * offset.z);
      const c = target.x * target.x + target.z * target.z - CAMERA_RADIUS * CAMERA_RADIUS;
      const disc = b * b - 4 * a * c;
      if (a > 1e-6 && disc > 0) f = clamp((-b + Math.sqrt(disc)) / (2 * a), 0.35, 1);
    }
    const veg = ctx.modules?.vegetation;
    if (!veg?.treesNear) return f;
    const qx = target.x + offset.x * 0.7 * f, qz = target.z + offset.z * 0.7 * f;
    veg.treesNear(qx, qz, distance * 0.4 * f + 8, treeBuf);
    if (!treeBuf.length) return f;
    while (f > 0.4 && inCrown(target.x + offset.x * f, target.y + offset.y * f, target.z + offset.z * f)) f -= 0.06;
    return f;
  }

  function placeCamera(dt, instant) {
    const p = pitchFor(camPitch, distance, coupling);
    const cp = Math.cos(p);
    offset.set(Math.sin(camYaw) * cp * distance, Math.sin(p) * distance, Math.cos(camYaw) * cp * distance);
    const want = crownPull();
    pull = instant ? want : pull + (want - pull) * damp(want < pull ? 9 : 1.6, dt);
    offset.multiplyScalar(pull);
    desiredPos.copy(target).add(offset);
    const need = terrainLift(target.x, target.y, target.z, desiredPos.x, desiredPos.y, desiredPos.z);
    // rise quickly over a hill, settle back slowly
    lift = instant ? need : lift + (need - lift) * damp(need > lift ? 10 : 2.5, dt);
    desiredPos.y += lift;
    const floor = getHeight(desiredPos.x, desiredPos.z) + 0.9;
    if (desiredPos.y < floor) desiredPos.y = floor;
    camera.position.copy(desiredPos);
    camera.lookAt(target);
  }

  function updateViewOffset(dt, instant) {
    const panelOpen = !!ctx.ui?.isPanelOpen;
    const wantX = panelOpen ? inset.right / 2 : 0;
    const wantY = panelOpen ? inset.bottom / 2 : 0;
    const k = instant ? 1 : damp(5, dt);
    shift.x += (wantX - shift.x) * k;
    shift.y += (wantY - shift.y) * k;
    if (Math.abs(shift.x) < 0.5 && Math.abs(shift.y) < 0.5) {
      if (offsetActive) {
        camera.clearViewOffset();
        offsetActive = false;
      }
      return;
    }
    const w = window.innerWidth, h = window.innerHeight;
    camera.setViewOffset(w, h, shift.x, shift.y, w, h);
    offsetActive = true;
  }

  /** Measure the content panel (if the UI didn't tell us) so exhibits are framed beside it. */
  function measurePanel() {
    const el = document.querySelector('.panel.is-open') ?? document.querySelector('.panel');
    inset.right = 0;
    inset.bottom = 0;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w > 0 && w < window.innerWidth * 0.7) inset.right = w;
    else if (h > 0 && h < window.innerHeight * 0.8) inset.bottom = h;
  }

  /** Pick a pleasant viewing angle for an object: a ¾ view of its front, unobstructed. */
  function pickFocusYaw(center, radius, obj, opts, dist, p) {
    if (opts.yaw !== undefined) return opts.yaw;
    let base = camYaw;
    if (obj?.isObject3D) {
      obj.getWorldDirection(tmp);
      if (Math.abs(tmp.y) < 0.9) {
        const front = Math.atan2(tmp.x, tmp.z);
        const a = front + 0.42, b = front - 0.42;
        const pick = Math.abs(wrap(a - camYaw)) < Math.abs(wrap(b - camYaw)) ? a : b;
        if (Math.abs(wrap(pick - camYaw)) < 2.4) base = pick;
      }
    }
    const tries = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, Math.PI];
    for (const d of tries) {
      const y = base + d;
      if (viewIsClear(center, radius, y, p, dist)) return y;
    }
    return base;
  }
  function viewIsClear(c, radius, y, p, dist) {
    const cp = Math.cos(p);
    const px = c.x + Math.sin(y) * cp * dist, pz = c.z + Math.cos(y) * cp * dist, py = c.y + Math.sin(p) * dist;
    if (terrainLift(c.x, c.y, c.z, px, py, pz) > 1.5) return false;
    const colliders = ctx.colliders;
    for (let i = 1; i <= 8; i++) {
      const f = i / 8;
      const x = c.x + (px - c.x) * f, z = c.z + (pz - c.z) * f, h = c.y + (py - c.y) * f;
      if (f * dist < radius + 0.4) continue;
      if (h > 5 + getHeight(x, z)) break; // high enough to clear houses & furniture
      if (colliders.isBlocked(x, z, 0.25)) return false;
    }
    return true;
  }

  const rig = {
    target,
    get yaw() {
      return yaw;
    },
    set yaw(v) {
      yaw = v;
    },
    get pitch() {
      return pitch;
    },
    set pitch(v) {
      pitch = clamp(v, MIN_PITCH, MAX_PITCH);
    },
    get distance() {
      return desiredDistance;
    },
    set distance(v) {
      desiredDistance = clamp(v, MIN_D, MAX_D);
    },
    get mode() {
      if (override) return 'override';
      if (intro) return 'intro';
      if (focus) return 'focus';
      if (ride) return 'ride';
      return 'follow';
    },
    get focused() {
      return !!focus;
    },
    /**
     * Frame an object (or a point). opts.height is measured from the object's
     * origin (legacy behaviour); without it the bounding sphere centre is used.
     */
    focus(what, opts = {}) {
      let center, radius = 1.2;
      if (what?.isObject3D) {
        what.updateWorldMatrix(true, true);
        box.setFromObject(what);
        if (!box.isEmpty()) {
          box.getBoundingSphere(sphere);
          center = sphere.center.clone();
          radius = Math.max(0.4, sphere.radius);
        } else center = what.getWorldPosition(new THREE.Vector3());
        if (opts.height !== undefined) center.y = what.getWorldPosition(tmp).y + opts.height;
      } else {
        center = new THREE.Vector3().copy(what);
        if (opts.height !== undefined) center.y += opts.height;
      }
      if (!insetFromUI) measurePanel();
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const fit = Math.min(vFov, hFov) / 2;
      const coverage = 1 + (0.6 * inset.right) / Math.max(1, window.innerWidth);
      const dist = opts.distance ?? clamp((radius / Math.sin(fit)) * 1.05 * coverage, 4, 28);
      const p = opts.pitch ?? clamp(0.3 + radius * 0.03, 0.3, 0.62);
      const fy = pickFocusYaw(center, radius, what, opts, dist, p);
      const saved = focus?.saved ?? { distance: desiredDistance, pitch, yaw };
      focus = { point: center, distance: dist, saved };
      yaw = camYaw + wrap(fy - camYaw);
      pitch = p;
      yawVel = pitchVel = 0;
      glide = 1;
    },
    release() {
      if (!focus) return;
      const s = focus.saved;
      focus = null;
      desiredDistance = s.distance;
      pitch = s.pitch;
      followBlend = 0;
      glide = 1;
      if (!insetFromUI) inset.right = inset.bottom = 0;
    },
    setViewInset({ right = 0, bottom = 0 } = {}) {
      inset.right = right;
      inset.bottom = bottom;
      insetFromUI = true;
    },
    setRide(object, { distance: d = 12.5, pitch: p = 0.42, side = 0.6 } = {}) {
      if (object) {
        if (!ride) {
          ride = { saved: { distance: desiredDistance, pitch } };
          desiredDistance = d;
          glide = 1;
        }
        Object.assign(ride, { object, distance: d, pitch: p, side });
      } else if (ride) {
        desiredDistance = ride.saved.distance;
        pitch = ride.saved.pitch;
        ride = null;
        glide = 1;
      }
    },
    setOverride(position, lookAt) {
      override = { position: new THREE.Vector3().copy(position), lookAt: new THREE.Vector3().copy(lookAt) };
    },
    clearOverride() {
      override = null;
      first = true;
    },
    get overridden() {
      return !!override;
    },
    /** Set false (before the first frame) to stop the rig from auto-playing the intro. */
    get autoIntro() {
      return !introClaimed;
    },
    set autoIntro(v) {
      introClaimed = !v;
    },
    /** Park the camera above the village (slow drift) until playIntro(). */
    prepareIntro() {
      introClaimed = true;
      if (reduced) return;
      intro = { parked: true, t: 0 };
    },
    /** Cinematic glide from a high overview of the village down to the player. */
    playIntro({ duration = 3.6 } = {}) {
      introClaimed = true;
      if (reduced || override) {
        intro = null;
        first = true;
        return Promise.resolve();
      }
      const from = introParkedState(intro?.parked ? intro.t : 0);
      return new Promise((resolve) => {
        intro = { t: 0, dur: duration, from, resolve, skipped: false };
      });
    },
    /** Snap immediately (no easing) on the next update. */
    snap() {
      first = true;
    },
  };

  // ── intro ──
  const OVERVIEW = { target: new THREE.Vector3(0, 0, -6), yaw: 0.6, pitch: 0.98, distance: 112 };
  function introParkedState(t) {
    return { target: OVERVIEW.target.clone(), yaw: OVERVIEW.yaw + t * 0.03, pitch: OVERVIEW.pitch, distance: OVERVIEW.distance };
  }
  if (gestures) {
    gestures.on('input', () => {
      if (intro && !intro.parked && !intro.skipped) {
        intro.skipped = true;
        intro.dur = Math.min(intro.dur, intro.t + 0.5);
      }
    });
  }

  function updateIntro(dt) {
    intro.t += dt;
    if (intro.parked) {
      const s = introParkedState(intro.t);
      target.copy(s.target);
      const cp = Math.cos(s.pitch);
      camera.position.set(s.target.x + Math.sin(s.yaw) * cp * s.distance, s.target.y + Math.sin(s.pitch) * s.distance, s.target.z + Math.cos(s.yaw) * cp * s.distance);
      camera.lookAt(target);
      return;
    }
    const u = Math.min(1, intro.t / intro.dur);
    const e = easeInOutCubic(u);
    const f = intro.from;
    computeFollow(followPoint);
    const toPitch = pitchFor(pitch, desiredDistance);
    target.lerpVectors(f.target, followPoint, e);
    const y = f.yaw + wrap(yaw - f.yaw) * e;
    const pch = lerp(f.pitch, toPitch, e);
    const d = Math.exp(lerp(Math.log(f.distance), Math.log(desiredDistance), easeInOutCubic(Math.min(1, u * 1.08))));
    const cp = Math.cos(pch);
    camera.position.set(target.x + Math.sin(y) * cp * d, target.y + Math.sin(pch) * d, target.z + Math.cos(y) * cp * d);
    const floor = getHeight(camera.position.x, camera.position.z) + 1;
    if (camera.position.y < floor) camera.position.y = floor;
    camera.lookAt(target);
    if (u >= 1) {
      const done = intro.resolve;
      intro = null;
      distance = desiredDistance;
      camYaw = yaw;
      camPitch = pitch;
      prevFollow.copy(followPoint);
      trackVel.set(0, 0, 0);
      lookAhead.set(0, 0, 0);
      lift = 0;
      done?.();
    }
  }

  engine.addUpdate((dt) => {
    if (!introClaimed) {
      introClaimed = true;
      if (!reduced && !override) rig.playIntro({ duration: 4 });
    }
    if (override) {
      camera.position.copy(override.position);
      camera.lookAt(override.lookAt);
      target.copy(override.lookAt);
      if (offsetActive) {
        camera.clearViewOffset();
        offsetActive = false;
        shift.x = shift.y = 0;
      }
      return;
    }
    if (intro) {
      updateIntro(dt);
      return;
    }
    const player = ctx.player;
    const instant = first;

    // ride mode follows the player automatically while they sit on something
    if (player?.riding && !ride) rig.setRide(player.seat ?? player.group);
    else if (!player?.riding && ride) rig.setRide(null);

    // orbit inertia
    if (!dragging && dt > 0 && (yawVel || pitchVel)) {
      yaw += yawVel * dt;
      pitch = clamp(pitch + pitchVel * dt, MIN_PITCH, MAX_PITCH);
      const fr = Math.exp(-4.5 * dt);
      yawVel *= fr;
      pitchVel *= fr;
      if (Math.abs(yawVel) < 1e-3) yawVel = 0;
      if (Math.abs(pitchVel) < 1e-3) pitchVel = 0;
    }

    // ── where to look ──
    computeFollow(followPoint);
    if (instant || dt <= 0) {
      prevFollow.copy(followPoint);
      trackVel.set(0, 0, 0);
    } else {
      tmp.subVectors(followPoint, prevFollow).divideScalar(dt);
      tmp.y = 0;
      if (tmp.lengthSq() > 400) tmp.set(0, 0, 0); // teleports
      trackVel.lerp(tmp, damp(4, dt));
      prevFollow.copy(followPoint);
    }
    const aheadK = reduced ? 0.15 : ride ? 0.55 : 0.38;
    tmp.copy(trackVel).multiplyScalar(aheadK);
    const maxAhead = ride ? 3.5 : 2.2;
    if (tmp.length() > maxAhead) tmp.setLength(maxAhead);
    lookAhead.lerp(tmp, instant ? 1 : damp(2.2, dt));

    let wantDistance = desiredDistance;
    let angleLam = dragging ? 22 : 12;
    if (focus) {
      desiredTarget.copy(focus.point);
      wantDistance = focus.distance;
    } else {
      desiredTarget.copy(followPoint).add(lookAhead);
      if (ride && engine.elapsed - lastUserOrbit > 2.5) {
        // swing in behind & beside the ride, unless the visitor is looking around
        const heading = player?.facing ?? 0;
        yaw = camYaw + wrap(heading + Math.PI + ride.side - camYaw);
        pitch = ride.pitch;
        angleLam = 1.1;
      }
    }
    if (glide > 0) {
      angleLam = Math.min(angleLam, 2.6);
      if (Math.abs(wrap(yaw - camYaw)) < 0.01 && Math.abs(pitch - camPitch) < 0.01) glide = 0;
    }

    // ── damped follow ──
    const ka = instant ? 1 : damp(angleLam, dt);
    camYaw += wrap(yaw - camYaw) * ka;
    camPitch += (pitch - camPitch) * ka;
    coupling += ((focus ? 0 : 1) - coupling) * (instant ? 1 : damp(2.6, dt));
    followBlend = Math.min(1, followBlend + dt * 0.8);
    const kxz = instant ? 1 : damp(focus ? 3.2 : lerp(2.5, 7.5, followBlend), dt);
    const ky = instant ? 1 : damp(focus ? 3.2 : lerp(2.0, 4.5, followBlend), dt);
    target.x += (desiredTarget.x - target.x) * kxz;
    target.z += (desiredTarget.z - target.z) * kxz;
    target.y += (desiredTarget.y - target.y) * ky;
    // zoom in log space so it feels even at every distance
    distance = instant ? wantDistance : Math.exp(Math.log(distance) + (Math.log(wantDistance) - Math.log(distance)) * damp(focus || glide ? 3.5 : 7, dt));

    placeCamera(dt, instant);
    updateViewOffset(dt, instant);
    first = false;
  }, 80);

  return rig;
}
