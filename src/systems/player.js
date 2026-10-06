// ─────────────────────────────────────────────────────────────────────────────
// Player — Jonny's little avatar. Click/tap the ground to walk there, or use
// WASD / arrow keys (camera-relative). BASELINE: the systems builder will add
// path smoothing, footstep dust, etc. on top of the same API.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight, getAreaAt, isInPond } from '../world/ground.js';
import { SPAWN } from '../world/layout.js';
import { damp } from '../core/rng.js';

const WALK_SPEED = 4.2;
const RUN_SPEED = 7.5;
const RADIUS = 0.35;

export function createPlayer(ctx) {
  const { engine, colliders, interactions } = ctx;
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
  ctx.scene.add(group);

  const position = new THREE.Vector3(SPAWN.x, getHeight(SPAWN.x, SPAWN.z), SPAWN.z);
  let facing = SPAWN.facing;
  let target = null; // {x, z}
  let enabled = true;
  let mount = null; // Object3D seat while riding
  let area = getAreaAt(position.x, position.z);
  const areaListeners = new Set();
  const keys = new Set();
  const marker = makeClickMarker(ctx);

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  interactions.onGroundClick((p) => {
    if (!enabled || mount) return;
    if (isInPond(p.x, p.z)) return;
    player.moveTo(p.x, p.z);
  });

  const tmp = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();

  const player = {
    person,
    group,
    position,
    radius: RADIUS,
    get facing() {
      return facing;
    },
    get area() {
      return area;
    },
    get riding() {
      return !!mount;
    },
    get moving() {
      return person.action === 'walk' || person.action === 'run';
    },
    moveTo(x, z) {
      target = { x, z };
      marker.show(x, z);
    },
    stop() {
      target = null;
      marker.hide();
    },
    teleport(x, z, face = facing) {
      position.set(x, getHeight(x, z), z);
      facing = face;
      target = null;
      updateArea();
    },
    setEnabled(on) {
      enabled = on;
      if (!on) player.stop();
    },
    /** Sit on a seat Object3D (e.g. snail.seat). Pass null to dismount. */
    mount(seat) {
      mount = seat;
      target = null;
      marker.hide();
      if (seat) person.setAction('ride');
      else person.setAction('idle');
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

  engine.addUpdate((dt) => {
    if (mount) {
      mount.getWorldPosition(tmp);
      position.copy(tmp);
      const q = new THREE.Quaternion();
      mount.getWorldQuaternion(q);
      group.position.copy(position);
      group.quaternion.copy(q);
      person.update(dt);
      updateArea();
      return;
    }

    // keyboard movement (camera-relative)
    let ix = 0, iz = 0;
    if (enabled) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) iz += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) iz -= 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    }
    let speed = 0;
    let dirX = 0, dirZ = 0;
    if (ix || iz) {
      player.stop();
      ctx.camera.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      right.crossVectors(fwd, THREE.Object3D.DEFAULT_UP).normalize();
      dirX = fwd.x * iz + right.x * ix;
      dirZ = fwd.z * iz + right.z * ix;
      const l = Math.hypot(dirX, dirZ) || 1;
      dirX /= l;
      dirZ /= l;
      speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
    } else if (target) {
      const dx = target.x - position.x, dz = target.z - position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) {
        player.stop();
      } else {
        dirX = dx / d;
        dirZ = dz / d;
        speed = Math.min(d > 10 ? RUN_SPEED : WALK_SPEED, d * 6);
      }
    }

    if (speed > 0) {
      const next = { x: position.x + dirX * speed * dt, z: position.z + dirZ * speed * dt };
      colliders.resolve(next, RADIUS);
      if (isInPond(next.x, next.z, -0.6)) {
        next.x = position.x;
        next.z = position.z;
      }
      const movedX = next.x - position.x, movedZ = next.z - position.z;
      const moved = Math.hypot(movedX, movedZ);
      position.x = next.x;
      position.z = next.z;
      if (target && moved < speed * dt * 0.15) player.stop(); // stuck against something
      const want = Math.atan2(dirX, dirZ);
      let diff = want - facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      facing += diff * damp(14, dt);
      person.setAction(speed > WALK_SPEED + 0.1 ? 'run' : 'walk');
      person.setSpeed(speed);
    } else if (person.action === 'walk' || person.action === 'run') {
      person.setAction('idle');
      person.setSpeed(0);
    }
    position.y = getHeight(position.x, position.z);
    group.position.copy(position);
    group.rotation.set(0, facing, 0);
    person.update(dt);
    updateArea();
  }, 10);

  return player;
}

function makeClickMarker(ctx) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.4, 24),
    new THREE.MeshBasicMaterial({ color: '#fff8ec', transparent: true, opacity: 0.9, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  ring.renderOrder = 2;
  ctx.scene.add(ring);
  let t = 0;
  ctx.engine.addUpdate((dt) => {
    if (!ring.visible) return;
    t += dt;
    const s = 1 + Math.sin(t * 6) * 0.12;
    ring.scale.setScalar(s);
  }, 30);
  return {
    show(x, z) {
      ring.position.set(x, getHeight(x, z) + 0.05, z);
      ring.visible = true;
      t = 0;
    },
    hide() {
      ring.visible = false;
    },
  };
}
