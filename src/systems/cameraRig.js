// ─────────────────────────────────────────────────────────────────────────────
// Camera rig — a soft third-person "diorama" camera that follows the player.
// Drag to orbit, wheel / pinch to zoom. focus() glides to an exhibit,
// release() returns to the player. BASELINE: the systems builder refines feel.
//
//   rig.target           THREE.Vector3 the camera looks at (lighting follows it)
//   rig.focus(point|object3d, { distance, height, duration })
//   rig.release()
//   rig.setOverride(position, lookAt) / rig.clearOverride()   (debug & cut-scenes)
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { damp, clamp } from '../core/rng.js';
import { getHeight } from '../world/ground.js';

export function createCameraRig(ctx) {
  const { engine, camera } = ctx;
  const canvas = engine.renderer.domElement;
  const target = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  let yaw = 0; // 0 → camera sits on +Z side of the target, looking towards −Z
  let pitch = 0.62; // radians above the horizon
  let distance = engine.isTouch ? 20 : 17;
  let desiredDistance = distance;
  const MIN_D = 7, MAX_D = 34;
  let focusPoint = null;
  let focusDistance = null;
  let override = null;
  const pointers = new Map();
  let pinchStart = null;

  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: desiredDistance };
    }
  });
  window.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      desiredDistance = clamp(pinchStart.dist * (pinchStart.d / Math.max(d, 1)), MIN_D, MAX_D);
      return;
    }
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    yaw -= dx * 0.006;
    pitch = clamp(pitch + dy * 0.004, 0.18, 1.25);
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      desiredDistance = clamp(desiredDistance * (1 + Math.sign(e.deltaY) * 0.12), MIN_D, MAX_D);
    },
    { passive: false }
  );
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const offset = new THREE.Vector3();
  const desiredPos = new THREE.Vector3();
  let first = true;

  const rig = {
    target,
    get yaw() {
      return yaw;
    },
    set yaw(v) {
      yaw = v;
    },
    get distance() {
      return desiredDistance;
    },
    set distance(v) {
      desiredDistance = clamp(v, MIN_D, MAX_D);
    },
    focus(what, opts = {}) {
      const p = what?.isObject3D ? what.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3().copy(what);
      if (opts.height) p.y += opts.height;
      focusPoint = p;
      focusDistance = opts.distance ?? 9;
    },
    release() {
      focusPoint = null;
      focusDistance = null;
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
    /** Snap immediately (no easing) on the next update. */
    snap() {
      first = true;
    },
  };

  engine.addUpdate((dt) => {
    if (override) {
      camera.position.copy(override.position);
      camera.lookAt(override.lookAt);
      target.copy(override.lookAt);
      return;
    }
    const player = ctx.player;
    if (focusPoint) desiredTarget.copy(focusPoint);
    else if (player) desiredTarget.set(player.position.x, player.position.y + 1.0, player.position.z);
    const d = focusDistance ?? desiredDistance;
    const k = first ? 1 : damp(focusPoint ? 3.5 : 6, dt);
    target.lerp(desiredTarget, k);
    distance += (d - distance) * (first ? 1 : damp(4, dt));
    offset.set(
      Math.sin(yaw) * Math.cos(pitch) * distance,
      Math.sin(pitch) * distance,
      Math.cos(yaw) * Math.cos(pitch) * distance
    );
    desiredPos.copy(target).add(offset);
    // keep the camera above the hills
    const ground = getHeight(desiredPos.x, desiredPos.z) + 1.2;
    if (desiredPos.y < ground) desiredPos.y = ground;
    camera.position.copy(desiredPos);
    camera.lookAt(target);
    first = false;
  }, 80);

  return rig;
}
