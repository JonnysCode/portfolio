// ─────────────────────────────────────────────────────────────────────────────
// Villagers — the cutest little people in the woods.
//
//   const p = makePerson({ seed: 'baker', hat: 'mushroom', holding: 'mug' });
//   site.group.add(p.group);
//   p.setAction('work');            // idle | walk | run | wave | work | sit | ride | talk | cheer
//
// Big round head (~42 % of the height), rosy cheeks, blinking dot eyes, a tiny
// smile, a round body, stubby arms with mitten hands and little shoes. Built
// from hierarchical groups (no skinning); every part is ONE vertex-coloured
// mesh, so a villager is ~8 draw calls and ~2k triangles.
//
// UPDATING — pick ONE mechanism (both are safe, they never double-update):
//   • do nothing: the person registers itself in the props ticker and
//     animates whenever it is in the scene (villagers in districts);
//   • or call person.update(dt) yourself every frame (the player does): the
//     first manual call removes the person from the ticker for good.
//
// SIT & RIDE: in these actions the hips move to the group origin, so place the
// group ON the seat surface (bench seat point, snail.seat …), facing +Z.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { palette } from '../core/palette.js';
import { createRng, damp } from '../core/rng.js';
import { Parts, cached, xf, paintFn, deform, meshesFor, shade, opt, blob, revolve } from './util.js';
import { makeManualSwitch, propsSettings } from './ticker.js';
import { toolGeos, TOOL_INFO } from './tools.js';

// ── proportions (unscaled units; total height ≈ 1.1) ─────────────────────────
const HIP_Y = 0.27;
const LEG_X = 0.075;
const TORSO_C = 0.17; // torso centre above the hips
const TR = [0.19, 0.205, 0.17]; // torso radii
const NECK_Y = 0.355; // head pivot above the hips
const HR = 0.235; // head radius
const HS = [1.05, 0.95, 1.0]; // head squash
const HC = 0.215; // head centre above the neck pivot
const SHOULDER = [0.165, 0.285];
const HAND_Y = -0.205;

export const PERSON_HEIGHT = HIP_Y + NECK_Y + HC + HR * HS[1];

const PANTS = ['#3b4a5c', '#4f6d9a', '#6b4430', '#5c3d27', '#7a6a55', '#3f5f4a'];
const SHOES = ['#5c3d27', '#3b2a1e', '#8b5e3c', '#a8583a'];
const HATS = ['none', 'none', 'beanie', 'mushroom', 'straw', 'acorn', 'cap', 'bandana'];
const HAIR_STYLES = ['short', 'short', 'bob', 'bun', 'pony', 'curly', 'spiky', 'long'];
const CHEEK = '#f29a8e';
const EYE = '#2b1d14';
const INK = '#3b2a1e';

/** Channels of a pose (all blended linearly between actions). */
const C = {
  ROOT_Y: 0, ROOT_X: 1, ROOT_Z: 2, TORSO_X: 3, TORSO_Y: 4, TORSO_Z: 5,
  HEAD_X: 6, HEAD_Y: 7, HEAD_Z: 8,
  AL_X: 9, AL_Y: 10, AL_Z: 11, AR_X: 12, AR_Y: 13, AR_Z: 14,
  LL_X: 15, LL_Z: 16, LR_X: 17, LR_Z: 18, BREATH: 19, ROOT_F: 20, SQUASH: 21,
};
const NCH = 22;
const ACTIONS = ['idle', 'walk', 'run', 'wave', 'work', 'sit', 'ride', 'talk', 'cheer'];

// ── geometry helpers ─────────────────────────────────────────────────────────
const _n = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/** Point + outward normal on the (squashed) head surface for an offset (x, y) from its centre. */
function headSurface(x, y, out = new THREE.Vector3(), nrm = _n, grow = 0) {
  const a = HR * HS[0], b = HR * HS[1], c = HR * HS[2];
  const k = 1 - (x / a) ** 2 - (y / b) ** 2;
  const z = c * Math.sqrt(Math.max(k, 0.0001));
  nrm.set(x / (a * a), y / (b * b), z / (c * c)).normalize();
  out.set(x, HC + y, z).addScaledVector(nrm, grow);
  return out;
}

/** Bake a geometry onto the head surface: its +Z along the surface normal. */
function onHead(geo, x, y, grow = 0, roll = 0) {
  const p = headSurface(x, y, new THREE.Vector3(), _n, grow);
  _x.crossVectors(UP, _n).normalize();
  _y.crossVectors(_n, _x);
  _m.makeBasis(_x, _y, _n);
  if (roll) geo.rotateZ(roll);
  geo.applyMatrix4(_m);
  geo.translate(p.x, p.y, p.z);
  return geo;
}

/**
 * A shell around the head (hair, hats) that only keeps the region where
 * cover(d) > 0 (d = unit direction from the head centre); the rest is tucked
 * inside the head so it disappears.
 */
function headShell(scale, cover, seg = [22, 14], flare = null) {
  const g = new THREE.SphereGeometry(HR * scale, seg[0], seg[1]);
  g.scale(HS[0], HS[1], HS[2]);
  const d = new THREE.Vector3();
  deform(g, (v) => {
    d.set(v.x / HS[0], v.y / HS[1], v.z / HS[2]).normalize();
    const c = cover(d);
    if (c < 0) v.multiplyScalar(Math.max(0.82, 1 + c * 1.5) * (0.9 / scale));
    else if (flare) v.multiplyScalar(1 + flare(d));
  });
  g.computeVertexNormals();
  g.translate(0, HC, 0);
  return g;
}

// ── part builders (cached per colour/style combination) ─────────────────────
function legGeos(o) {
  return cached(`p-leg|${o.pants}|${o.shoes}`, () => {
    const P = new Parts();
    P.add('paint', new THREE.CapsuleGeometry(0.063, 0.1, 2, 6).translate(0, -0.1, 0), o.pants);
    // shoe: a chubby rounded toe + sole
    const shoe = blob(0.072, [0.88, 0.62, 1.3], 8, 5);
    P.add('paint', shoe.translate(0, -0.228, 0.028), o.shoes);
    P.add('paint', blob(0.07, [0.86, 0.22, 1.28], 8, 3).translate(0, -0.258, 0.028), shade(o.shoes, -0.12));
    return P.finish();
  });
}

function armGeos(o, side) {
  return cached(`p-arm|${o.shirt}|${o.skin}|${side}|${o.sleeve}`, () => {
    const P = new Parts();
    const sleeve = new THREE.CapsuleGeometry(0.047, 0.1, 2, 6).translate(0, -0.075, 0);
    paintFn(sleeve, (x, y, z, nx, ny, nz, i, c) => c.set(y < -0.13 && o.sleeve === 'short' ? o.skin : o.shirt));
    P.add('paint', sleeve);
    // cuff
    if (o.sleeve !== 'short') P.add('paint', new THREE.CylinderGeometry(0.05, 0.05, 0.03, 7, 1, true).translate(0, -0.155, 0), shade(o.shirt, -0.06));
    // mitten hand + thumb
    P.add('paint', blob(0.058, [0.95, 1.05, 0.9], 8, 6).translate(0, HAND_Y, 0.004), o.skin);
    P.add('paint', blob(0.026, [1, 1.2, 1], 5, 3).translate(side * -0.04, HAND_Y + 0.012, 0.03), o.skin);
    return P.finish();
  });
}

/** Torso radii (x, z) at torso-local height y (matches the pear deform). */
function torsoRadiusAt(y) {
  const dy = (y - TORSO_C) / TR[1];
  const k = Math.sqrt(Math.max(0, 1 - dy * dy));
  const pear = 1 + (dy < 0 ? -dy * TR[1] * 0.45 : -dy * TR[1] * 0.25);
  return [TR[0] * k * pear, TR[2] * k * pear];
}

/** An elliptical band hugging the torso at height y. */
function band(y, tube, grow = 0.006, seg = 16) {
  const [rx, rz] = torsoRadiusAt(y);
  const g = new THREE.TorusGeometry(1, tube, 3, seg);
  g.rotateX(Math.PI / 2);
  g.scale(rx + grow, 1, rz + grow);
  return g.translate(0, y, 0);
}

function torsoGeos(o) {
  const key = `p-torso|${o.shirt}|${o.pants}|${o.apron}|${o.apronColor}|${o.scarf}|${o.scarfColor}|${o.belt}|${o.buttons}`;
  return cached(key, () => {
    const P = new Parts();
    const body = new THREE.SphereGeometry(1, 13, 9);
    body.scale(TR[0], TR[1], TR[2]);
    // slightly pear shaped: wider bottom
    deform(body, (v) => {
      const k = 1 + (v.y < 0 ? -v.y * 0.45 : -v.y * 0.25);
      v.x *= k;
      v.z *= k;
    });
    body.computeVertexNormals();
    body.translate(0, TORSO_C, 0);
    const shirtLow = shade(o.shirt, -0.05);
    paintFn(body, (x, y, z, nx, ny, nz, i, c) => {
      if (y < 0.075) c.set(o.pants);
      else c.set(o.shirt).lerp(new THREE.Color(shirtLow), Math.max(0, 0.2 - y) * 2);
    });
    P.add('paint', body);
    if (o.belt) {
      P.add('paint', band(0.085, 0.017), '#5c3d27');
      P.add('paint', new THREE.BoxGeometry(0.045, 0.036, 0.014).translate(0, 0.085, torsoRadiusAt(0.085)[1] + 0.02), '#d9a441');
    }
    if (o.buttons && !o.apron) {
      for (let i = 0; i < 2; i++) P.add('paint', new THREE.SphereGeometry(0.014, 6, 4).translate(0, 0.2 + i * 0.075, TR[2] * (i ? 0.93 : 0.98)), palette.spots);
    }
    if (o.apron) addApron(P, o);
    if (o.scarf) {
      const ring = new THREE.TorusGeometry(0.12, 0.045, 6, 14);
      ring.rotateX(Math.PI / 2);
      paintFn(ring, (x, y, z, nx, ny, nz, i, c) => c.set(Math.sin(Math.atan2(x, z) * 6) > 0 ? o.scarfColor : shade(o.scarfColor, 0.12)));
      P.add('paint', ring.translate(0, NECK_Y - 0.01, 0.0));
      const tail = new THREE.BoxGeometry(0.06, 0.15, 0.03);
      tail.translate(0, -0.075, 0);
      paintFn(tail, (x, y, z, nx, ny, nz, i, c) => c.set(Math.sin(y * 50) > 0 ? o.scarfColor : shade(o.scarfColor, 0.12)));
      P.add('paint', xf(tail, [0.065, NECK_Y - 0.02, torsoRadiusAt(NECK_Y - 0.02)[1] + 0.05], [-0.42, 0, 0.1]));
    }
    return P.finish();
  });
}

/** Carpenter's apron: leather bib + waist pocket with a pencil and a folding rule. */
function addApron(P, o) {
  const col = o.apronColor;
  const front = new THREE.SphereGeometry(1, 10, 8, Math.PI / 2 - 0.95, 1.9, Math.PI * 0.3, Math.PI * 0.58);
  front.scale(TR[0] * 1.07, TR[1] * 1.06, TR[2] * 1.12);
  deform(front, (v) => {
    const k = 1 + (v.y < 0 ? -v.y * 0.45 : -v.y * 0.25);
    v.x *= k;
    v.z *= k;
  });
  front.computeVertexNormals();
  front.translate(0, TORSO_C, 0);
  paintFn(front, (x, y, z, nx, ny, nz, i, c) => c.set(col).lerp(new THREE.Color(shade(col, -0.1)), Math.abs(x) > 0.12 ? 0.6 : 0));
  P.add('paint', front);
  // neck strap
  const strap = new THREE.TorusGeometry(0.115, 0.014, 3, 10, Math.PI);
  strap.rotateX(-0.25);
  P.add('paint', strap.translate(0, NECK_Y - 0.06, 0.03), shade(col, -0.12));
  // waist ties (bow at the back)
  P.add('paint', band(0.13, 0.012, 0.012), shade(col, -0.12));
  const backZ = -torsoRadiusAt(0.13)[1] - 0.012;
  for (const s of [-1, 1]) P.add('paint', blob(0.03, [1.4, 0.8, 0.6], 5, 3).translate(s * 0.03, 0.13, backZ), shade(col, -0.12));
  // pocket
  const pocketZ = TR[2] * 1.15;
  P.add('paint', xf(new THREE.BoxGeometry(0.16, 0.08, 0.02), [0, 0.11, pocketZ - 0.01], [-0.25, 0, 0]), shade(col, -0.07));
  P.add('paint', xf(new THREE.BoxGeometry(0.16, 0.012, 0.022), [0, 0.15, pocketZ], [-0.25, 0, 0]), shade(col, -0.18));
  // pencil sticking out of the pocket
  const pencil = new THREE.CylinderGeometry(0.009, 0.009, 0.1, 6);
  P.add('paint', xf(pencil, [-0.045, 0.17, pocketZ + 0.008], [0, 0, 0.18]), palette.postYellow);
  P.add('paint', xf(new THREE.ConeGeometry(0.009, 0.022, 6), [-0.045 - 0.0098, 0.229, pocketZ + 0.008], [0, 0, 0.18]), palette.spruce);
  P.add('paint', xf(new THREE.CylinderGeometry(0.0095, 0.0095, 0.014, 6), [-0.045 + 0.0092, 0.117, pocketZ + 0.008], [0, 0, 0.18]), '#f2a7c3');
  // folding rule
  P.add('paint', xf(new THREE.BoxGeometry(0.024, 0.075, 0.012), [0.045, 0.165, pocketZ + 0.006], [0, 0, -0.12]), palette.postYellow);
}

function headGeos(o) {
  const key = `p-head|${o.skin}|${o.hairStyle}|${o.hairColor}|${o.hat}|${o.hatColor}|${o.glasses}|${o.beard}|${o.brows}`;
  return cached(key, () => {
    const P = new Parts();
    const skinDark = shade(o.skin, -0.06);
    const head = new THREE.SphereGeometry(HR, 16, 12);
    head.scale(HS[0], HS[1], HS[2]);
    head.translate(0, HC, 0);
    P.add('paint', head, o.skin);
    P.add('paint', new THREE.CylinderGeometry(0.06, 0.07, 0.08, 7, 1, true).translate(0, 0.02, 0), skinDark);
    // ears
    for (const s of [-1, 1]) P.add('paint', blob(0.046, [0.55, 1, 0.8], 5, 4).translate(s * HR * HS[0] * 0.98, HC - 0.01, -0.01), o.skin);
    // nose, cheeks, smile, brows
    P.add('paint', onHead(blob(0.024, [1.1, 0.9, 0.8], 5, 3), 0, -0.045, 0.004), shade(o.skin, -0.03));
    for (const s of [-1, 1]) P.add('paint', onHead(blob(0.044, [1.15, 0.72, 0.25], 7, 3), s * 0.128, -0.075, 0.004), CHEEK);
    const smile = new THREE.TorusGeometry(0.03, 0.0085, 3, 8, Math.PI);
    smile.rotateZ(Math.PI);
    P.add('paint', onHead(smile, 0, -0.085, 0.004), INK);
    if (o.brows) {
      for (const s of [-1, 1]) {
        const brow = new THREE.TorusGeometry(0.034, 0.008, 3, 5, Math.PI * 0.6);
        brow.rotateZ(Math.PI * 0.2);
        P.add('paint', onHead(brow, s * 0.088, 0.072, 0.004, s * 0.12), shade(o.hairColor, -0.05));
      }
    }
    if (o.beard) addBeard(P, o);
    if (o.glasses) addGlasses(P, o);
    addHair(P, o);
    addHat(P, o);
    return P.finish();
  });
}

function eyeGeos() {
  return cached('p-eyes', () => {
    const P = new Parts();
    for (const s of [-1, 1]) {
      // geometry relative to the eye line so the mesh can blink by scaling Y
      const eye = onHead(blob(0.033, [0.82, 1.22, 0.45], 8, 5), s * 0.083, 0.0, 0.002);
      P.add('paint', eye.translate(0, -HC, 0), EYE);
      const hi = onHead(blob(0.0105, [1, 1, 0.6], 4, 2), s * 0.083 + 0.011, 0.016, 0.016);
      P.add('paint', hi.translate(0, -HC, 0), '#fff8ec');
    }
    return P.finish();
  });
}

function addBeard(P, o) {
  const beard = headShell(1.06, (d) => (d.z > -0.15 && d.y < -0.18 + Math.abs(d.x) * 0.25 ? 1 : -1), [16, 11], (d) => (d.y < -0.3 ? (-d.y - 0.3) * 0.25 : 0));
  P.add('paint', beard, o.hairColor);
  for (const s of [-1, 1]) P.add('paint', onHead(blob(0.034, [1.5, 0.7, 0.7], 8, 5), s * 0.03, -0.068, 0.012, s * 0.25), o.hairColor);
}

function addGlasses(P) {
  const frame = INK;
  for (const s of [-1, 1]) {
    P.add('paint', onHead(new THREE.TorusGeometry(0.048, 0.0085, 3, 12), s * 0.085, 0.0, 0.03), frame);
    // temple arms back to the ears
    const p = headSurface(s * 0.13, 0.0, new THREE.Vector3(), _n, 0.03);
    const e = new THREE.Vector3(s * HR * HS[0] * 0.98, HC + 0.005, -0.01);
    const len = p.distanceTo(e);
    const arm = new THREE.CylinderGeometry(0.006, 0.006, len, 4);
    arm.translate(0, len / 2, 0);
    const dir = e.clone().sub(p).normalize();
    arm.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
    P.add('paint', arm.translate(p.x, p.y, p.z), frame);
  }
  const bridge = new THREE.TorusGeometry(0.02, 0.007, 3, 6, Math.PI);
  P.add('paint', onHead(bridge, 0, 0.005, 0.036), frame);
}

function addHair(P, o) {
  const c = o.hairColor;
  const style = o.hairStyle;
  if (style === 'bald' || style === 'none') return;
  const hairlineFront = 0.42;
  const coverShort = (d) => {
    const front = THREE.MathUtils.smoothstep(d.z, 0.0, 0.85);
    const back = THREE.MathUtils.smoothstep(-d.z, 0.0, 0.85);
    const cut = -0.08 + front * (hairlineFront + 0.08) - back * 0.42;
    return d.y - cut;
  };
  const coverBob = (d) => {
    const front = THREE.MathUtils.smoothstep(d.z, 0.15, 0.85);
    const back = THREE.MathUtils.smoothstep(-d.z, 0.0, 0.8);
    const cut = -0.55 + front * (hairlineFront + 0.55) - back * 0.1;
    return d.y - cut;
  };
  if (style === 'bob' || style === 'long') {
    P.add('paint', headShell(1.085, coverBob, [16, 11], (d) => (d.y < 0 ? -d.y * 0.12 : 0)), c);
    if (style === 'long') {
      P.add('paint', xf(new THREE.CapsuleGeometry(0.15, 0.16, 4, 10), [0, HC - 0.2, -0.13], [0.15, 0, 0], [1.25, 1, 0.65]), c);
    }
  } else {
    P.add('paint', headShell(1.075, coverShort, [15, 10]), c);
  }
  // bangs along the hairline
  if (style !== 'spiky' && !(o.hat === 'beanie' || o.hat === 'acorn' || o.hat === 'bandana')) {
    const n = style === 'curly' ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * (0.24 / n);
      P.add('paint', onHead(blob(0.06, [1.2, 0.7, 0.55], 5, 3), x, 0.11 + Math.cos(x * 6) * 0.015, 0.012, x * 2), c);
    }
  }
  const hatted = o.hat && o.hat !== 'none';
  if (style === 'bun' && !hatted) P.add('paint', blob(0.085, [1, 0.95, 1], 9, 6).translate(0, HC + HR * 0.95, -0.09), c);
  if (style === 'pony') {
    P.add('paint', xf(new THREE.CapsuleGeometry(0.055, 0.14, 4, 8), [0, HC - 0.02, -0.27], [-0.5, 0, 0]), c);
    P.add('paint', xf(new THREE.TorusGeometry(0.045, 0.014, 4, 10), [0, HC + 0.06, -0.24], [Math.PI / 2 - 0.5, 0, 0]), palette.capCoral);
  }
  if (style === 'curly') {
    if (hatted) return;
    const rng = createRng('curls|' + c);
    for (let i = 0; i < 12; i++) {
      const a = rng.range(-Math.PI, Math.PI);
      const el = rng.range(-0.1, 1.2);
      const d = new THREE.Vector3(Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el));
      if (d.z > 0.45 && d.y < 0.55) continue;
      const p = new THREE.Vector3(d.x * HR * HS[0] * 1.07, HC + d.y * HR * HS[1] * 1.07, d.z * HR * HS[2] * 1.07);
      P.add('paint', blob(rng.range(0.055, 0.075), [1, 1, 1], 6, 5).translate(p.x, p.y, p.z), i % 3 ? c : shade(c, 0.05));
    }
  }
  if (style === 'spiky' && !hatted) {
    // soft tufts sticking up (rounded cones)
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const el = 0.95 + (i % 2) * 0.3;
      const d = new THREE.Vector3(Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el) - 0.1).normalize();
      const cone = new THREE.ConeGeometry(0.055, 0.12, 5, 1, true);
      cone.translate(0, 0.05, 0);
      cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d));
      P.add('paint', cone.translate(d.x * HR * 0.98, HC + d.y * HR * 0.93, d.z * HR * 0.98), c);
    }
  }
}

function addHat(P, o) {
  const c = o.hatColor;
  const top = HC + HR * HS[1];
  switch (o.hat) {
    case 'beanie': {
      const cover = (d) => d.y - (0.1 + d.z * 0.14);
      const shell = headShell(1.085, cover, [16, 10], (d) => Math.max(0, d.y - 0.6) * 0.12);
      paintFn(shell, (x, y, z, nx, ny, nz, i, col) => col.set(Math.sin(Math.atan2(x, z) * 9) > 0 ? c : shade(c, -0.05)));
      P.add('paint', shell);
      const brim = new THREE.TorusGeometry(HR * 1.02, 0.036, 5, 18);
      brim.rotateX(Math.PI / 2);
      brim.scale(HS[0], 1.15, HS[2]);
      xf(brim, [0, HC + HR * 0.16, -0.012], [-0.14, 0, 0]);
      P.add('paint', brim, shade(c, -0.08));
      P.add('paint', new THREE.IcosahedronGeometry(0.068, 1).translate(0, top + 0.06, -0.035), palette.spots);
      break;
    }
    case 'mushroom': {
      const R = HR * 1.45;
      const capPts = [[0, 0.2], [R * 0.45, 0.185], [R * 0.78, 0.13], [R * 0.97, 0.04], [R, -0.005], [R * 0.9, -0.02], [R * 0.5, 0.0], [0, 0.0]];
      const nonIdx = revolve(capPts, 13);
      paintFn(nonIdx, (x, y, z, nx, ny, nz, i, col) => col.set(ny < -0.2 ? palette.stemShade : c));
      xf(nonIdx, [0, top - 0.07, -0.02], [-0.12, 0, 0.08]);
      P.add('paint', nonIdx);
      const rng = createRng('mhat');
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + rng.jitter(0.3);
        const rr = R * (i % 2 ? 0.62 : 0.35);
        const y = 0.2 - (rr / R) ** 2 * 0.12;
        const spot = blob(0.032 + (i % 2) * 0.01, [1, 0.35, 1], 6, 2);
        xf(spot, [Math.sin(a) * rr, y + 0.004, Math.cos(a) * rr], [Math.cos(a) * (rr / R) * 0.5, 0, -Math.sin(a) * (rr / R) * 0.5]);
        xf(spot, [0, top - 0.07, -0.02], [-0.12, 0, 0.08]);
        P.add('paint', spot, palette.spots);
      }
      break;
    }
    case 'straw': {
      const brim = new THREE.CylinderGeometry(0.4, 0.41, 0.018, 18);
      paintFn(brim, (x, y, z, nx, ny, nz, i, col) => col.set(Math.sin(Math.hypot(x, z) * 90) > 0 ? c : shade(c, -0.06)));
      xf(brim, [0, top - 0.06, -0.01], [-0.1, 0, 0]);
      P.add('paint', brim);
      const crown = new THREE.CylinderGeometry(0.19, 0.225, 0.14, 14);
      paintFn(crown, (x, y, z, nx, ny, nz, i, col) => col.set(Math.sin(y * 120) > 0 ? c : shade(c, -0.06)));
      xf(crown, [0, top + 0.01, -0.02], [-0.1, 0, 0]);
      P.add('paint', crown);
      P.add('paint', xf(new THREE.CylinderGeometry(0.228, 0.228, 0.035, 14, 1, true), [0, top - 0.035, -0.015], [-0.1, 0, 0]), palette.swissRed);
      P.add('paint', xf(blob(0.04, [1, 0.7, 0.4], 6, 4), [0.2, top - 0.03, 0.08], [0, 0.9, 0]), palette.capCoral);
      break;
    }
    case 'acorn': {
      const cover = (d) => d.y - (0.18 + d.z * 0.08);
      const shell = headShell(1.14, cover, [16, 9]);
      // scaly cup pattern
      paintFn(shell, (x, y, z, nx, ny, nz, i, col) => {
        const a = Math.atan2(x, z);
        const k = Math.sin(a * 8 + y * 60) * Math.sin(y * 70);
        col.set(c).lerp(new THREE.Color(shade(c, -0.12)), k > 0 ? 0.7 : 0);
      });
      P.add('paint', shell);
      const rim = new THREE.TorusGeometry(HR * 1.1, 0.03, 4, 16);
      rim.rotateX(Math.PI / 2);
      rim.scale(HS[0], 1, HS[2]);
      xf(rim, [0, HC + HR * 0.21, 0], [-0.08, 0, 0]);
      P.add('paint', rim, shade(c, -0.1));
      P.add('paint', xf(new THREE.CylinderGeometry(0.018, 0.026, 0.09, 6), [0.01, top + 0.06, -0.01], [0, 0, -0.35]), palette.barkDark);
      break;
    }
    case 'cap': {
      const cover = (d) => d.y - (0.18 + d.z * 0.05);
      P.add('paint', headShell(1.1, cover, [16, 9]), c);
      const visor = new THREE.CylinderGeometry(0.17, 0.17, 0.016, 10, 1, false, -Math.PI / 2, Math.PI);
      visor.scale(1.1, 1, 0.9);
      xf(visor, [0, HC + 0.13, HR * 0.8], [-0.12, 0, 0]);
      P.add('paint', visor, shade(c, -0.08));
      P.add('paint', new THREE.SphereGeometry(0.022, 6, 4).translate(0, top + 0.022, 0), shade(c, 0.1));
      break;
    }
    case 'bandana': {
      const cover = (d) => d.y - (0.08 + d.z * 0.2);
      const shell = headShell(1.09, cover, [16, 9]);
      paintFn(shell, (x, y, z, nx, ny, nz, i, col) => {
        const dots = Math.sin(x * 70) * Math.sin(y * 70) * Math.sin(z * 70);
        col.set(dots > 0.55 ? palette.spots : c);
      });
      P.add('paint', shell);
      P.add('paint', blob(0.045, [1, 0.9, 0.8], 8, 6).translate(0, HC + 0.04, -HR - 0.01), shade(c, -0.05));
      for (const s of [-1, 1]) P.add('paint', xf(new THREE.ConeGeometry(0.035, 0.12, 5), [s * 0.04, HC - 0.03, -HR - 0.02], [0.3, 0, s * 0.45]), c);
      break;
    }
    default:
      break;
  }
}

// ── poses ────────────────────────────────────────────────────────────────────
function workPose(item, t, out, rm) {
  const s = rm ? 0.35 : 1;
  out[C.HEAD_X] = 0.28;
  out[C.AL_X] = -0.75;
  out[C.AL_Z] = 0.2;
  switch (item) {
    case 'hammer':
    case 'mallet': {
      // quick strike, slow lift
      const f = (t * 1.6) % 1;
      const k = f < 0.22 ? 1 - f / 0.22 : (f - 0.22) / 0.78;
      out[C.AR_X] = -0.75 - k * 1.6 * s;
      out[C.AR_Z] = -0.1;
      out[C.TORSO_X] = 0.12 + (1 - k) * 0.08 * s;
      out[C.AL_X] = -0.8;
      break;
    }
    case 'saw': {
      const k = Math.sin(t * 7) * s;
      out[C.AR_X] = -1.1 + k * 0.3;
      out[C.AR_Z] = 0.15;
      out[C.TORSO_Y] = k * 0.06;
      out[C.TORSO_X] = 0.18;
      out[C.AL_X] = -0.9;
      out[C.AL_Z] = 0.3;
      break;
    }
    case 'plane': {
      const k = (Math.sin(t * 3) * 0.5 + 0.5) * s;
      out[C.AR_X] = -1.0 - k * 0.45;
      out[C.AL_X] = -1.05 - k * 0.4;
      out[C.AR_Z] = 0.25;
      out[C.AL_Z] = -0.15;
      out[C.TORSO_X] = 0.15 + k * 0.18;
      out[C.ROOT_F] = k * 0.04;
      break;
    }
    case 'wrench': {
      out[C.AR_X] = -1.25;
      out[C.AR_Y] = Math.sin(t * 5) * 0.5 * s;
      out[C.AR_Z] = 0.2;
      out[C.AL_X] = -1.0;
      out[C.TORSO_X] = 0.22;
      break;
    }
    case 'pump': {
      const k = (Math.sin(t * 5) * 0.5 + 0.5) * s;
      out[C.AR_X] = -0.55 - k * 0.35;
      out[C.AR_Z] = 0.35;
      out[C.AL_X] = -0.55 - k * 0.35;
      out[C.AL_Z] = -0.35;
      out[C.ROOT_Y] = -k * 0.05;
      out[C.TORSO_X] = 0.25 + k * 0.1;
      out[C.HEAD_X] = 0.15;
      break;
    }
    case 'laptop': {
      out[C.AR_X] = -1.0 + Math.sin(t * 17) * 0.05 * s;
      out[C.AL_X] = -1.0 + Math.sin(t * 15 + 1) * 0.05 * s;
      out[C.AR_Z] = 0.28;
      out[C.AL_Z] = -0.28;
      out[C.HEAD_X] = 0.32 + Math.sin(t * 0.7) * 0.04;
      break;
    }
    case 'book': {
      const flip = Math.max(0, Math.sin(t * 0.6)) ** 12;
      out[C.AR_X] = -1.0;
      out[C.AL_X] = -1.0 - flip * 0.4 * s;
      out[C.AR_Z] = 0.28;
      out[C.AL_Z] = -0.28 + flip * 0.3 * s;
      out[C.HEAD_X] = 0.35;
      out[C.HEAD_Z] = Math.sin(t * 0.4) * 0.06;
      break;
    }
    case 'mug': {
      const sip = THREE.MathUtils.smoothstep(Math.sin(t * 0.9), 0.55, 0.9);
      out[C.AR_X] = -0.65 - sip * 1.35;
      out[C.AR_Z] = 0.08 + sip * 0.3;
      out[C.HEAD_X] = -0.1 * sip + 0.05;
      out[C.AL_X] = -0.1;
      out[C.AL_Z] = 0.12;
      break;
    }
    case 'paintbrush': {
      const k = Math.sin(t * 4) * s;
      out[C.AR_X] = -1.35 + k * 0.35;
      out[C.AR_Z] = 0.1 + Math.sin(t * 2) * 0.1;
      out[C.HEAD_X] = 0.0;
      out[C.AL_X] = -0.15;
      break;
    }
    default: {
      // generic busy hands (kneading, sorting)
      out[C.AR_X] = -0.9 + Math.sin(t * 4) * 0.12 * s;
      out[C.AL_X] = -0.9 + Math.sin(t * 4 + 2) * 0.12 * s;
      out[C.AR_Z] = 0.25;
      out[C.AL_Z] = -0.25;
      out[C.TORSO_X] = 0.12;
    }
  }
}

// ── the person ───────────────────────────────────────────────────────────────
let personCount = 0;

/**
 * A little villager. Origin at the feet, facing +Z, ~1.1 units tall (× scale).
 * @param {object} [opts]
 * @param {string|number} [opts.seed]   drives every unspecified look
 * @param {string} [opts.name]
 * @param {string} [opts.skin] @param {string} [opts.shirt] @param {string} [opts.pants] @param {string} [opts.shoes]
 * @param {'short'|'bob'|'long'|'bun'|'pony'|'curly'|'spiky'|'bald'} [opts.hair]  hair style
 * @param {string} [opts.hairColor]
 * @param {'beanie'|'mushroom'|'straw'|'acorn'|'cap'|'bandana'|'none'} [opts.hat]
 * @param {string} [opts.hatColor]
 * @param {boolean} [opts.apron]        carpenter's apron with pencil & folding rule
 * @param {string} [opts.apronColor]
 * @param {boolean} [opts.glasses] @param {boolean} [opts.beard] @param {boolean} [opts.scarf] @param {string} [opts.scarfColor]
 * @param {'short'|'long'} [opts.sleeve]
 * @param {string|null} [opts.holding]  'plane'|'hammer'|'saw'|'wrench'|'pump'|'laptop'|'mug'|'paintbrush'|'book'|'chisel'|'mallet'|'ruler'|null
 * @param {string} [opts.action='idle']
 * @param {number} [opts.scale=1]
 * @returns {{ group: THREE.Group, height: number, hipHeight: number, action: string, name: string,
 *   setAction(name: string): void, setSpeed(unitsPerSecond: number): void, update(dt: number): void,
 *   setHolding(item: string|null): void, lookAt(target: THREE.Vector3|null): void,
 *   hand: THREE.Object3D, head: THREE.Object3D }}
 */
export function makePerson(opts = {}) {
  const seed = String(opts.seed ?? `villager-${personCount}`);
  personCount++;
  const rng = createRng(seed);
  const hat = opts.hat ?? rng.pick(HATS);
  const shirt = opts.shirt ?? rng.pick(palette.clothes);
  const o = {
    skin: opts.skin ?? rng.pick(palette.skin),
    shirt,
    pants: opts.pants ?? rng.pick(PANTS),
    shoes: opts.shoes ?? rng.pick(SHOES),
    hairStyle: opts.hair ?? rng.pick(HAIR_STYLES),
    hairColor: opts.hairColor ?? rng.pick(palette.hair),
    hat,
    hatColor: opts.hatColor ?? (hat === 'mushroom' ? rng.pick([palette.capRed, palette.capRed, palette.capCoral, palette.capOchre]) : hat === 'straw' ? '#e8c27a' : hat === 'acorn' ? palette.capBrown : rng.pick(palette.clothes.filter((c) => c !== shirt))),
    apron: !!opts.apron,
    apronColor: opts.apronColor ?? '#b87a4b',
    glasses: opts.glasses ?? rng.chance(0.15),
    beard: opts.beard ?? rng.chance(0.12),
    scarf: opts.scarf ?? rng.chance(0.15),
    scarfColor: opts.scarfColor ?? rng.pick(palette.clothes),
    sleeve: opts.sleeve ?? (rng.chance(0.3) ? 'short' : 'long'),
    belt: opts.belt ?? rng.chance(0.35),
    buttons: rng.chance(0.6),
    brows: true,
  };
  const scale = opt(opts, 'scale', 1);
  const rm = () => propsSettings.reducedMotion;

  // ── hierarchy ──
  const group = new THREE.Group();
  group.name = opts.name ? `person:${opts.name}` : 'person';
  group.scale.setScalar(scale);
  const root = new THREE.Group();
  group.add(root);
  const mk = (geos, cast) => {
    const g = new THREE.Group();
    for (const m of meshesFor(geos, { cast })) g.add(m);
    return g;
  };
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(LEG_X, HIP_Y, 0);
  legR.position.set(-LEG_X, HIP_Y, 0);
  legL.add(mk(legGeos(o), true));
  legR.add(mk(legGeos(o), true));
  const torso = new THREE.Group();
  torso.position.y = HIP_Y;
  torso.add(mk(torsoGeos(o), true));
  const headPivot = new THREE.Group();
  headPivot.position.y = NECK_Y;
  headPivot.add(mk(headGeos(o), true));
  const eyes = mk(eyeGeos(), false);
  eyes.position.y = HC;
  headPivot.add(eyes);
  torso.add(headPivot);
  // arms: left at +X (the person faces +Z, so their right hand is at −X)
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(SHOULDER[0], SHOULDER[1], 0);
  armR.position.set(-SHOULDER[0], SHOULDER[1], 0);
  armL.add(mk(armGeos(o, 1), false));
  armR.add(mk(armGeos(o, -1), false));
  const handR = new THREE.Object3D();
  handR.position.set(0, HAND_Y, 0.01);
  armR.add(handR);
  const handL = new THREE.Object3D();
  handL.position.set(0, HAND_Y, 0.01);
  armL.add(handL);
  const front = new THREE.Object3D();
  front.position.set(0, 0.17, 0.3);
  torso.add(armL, armR, front);
  root.add(legL, legR, torso);

  // slight per-person proportions
  const headScale = rng.range(0.97, 1.05);
  headPivot.scale.setScalar(headScale);
  const girth = rng.range(0.94, 1.08);
  torso.children[0].scale.set(girth, 1, girth);

  // ── held item ──
  let holding = null;
  let toolObj = null;
  function setHolding(item) {
    if (toolObj) {
      toolObj.parent?.remove(toolObj);
      toolObj = null;
    }
    holding = item && toolGeos(item) ? item : null;
    if (!holding) return;
    const info = TOOL_INFO[holding];
    toolObj = new THREE.Group();
    for (const m of meshesFor(toolGeos(holding), { cast: false })) toolObj.add(m);
    toolObj.position.fromArray(info.pos);
    toolObj.rotation.set(info.rot[0], info.rot[1], info.rot[2]);
    (info.mount === 'front' ? front : handR).add(toolObj);
  }
  setHolding(opts.holding ?? null);

  // ── animation state ──
  const weights = new Float32Array(ACTIONS.length);
  const buf = new Float32Array(NCH);
  const pose = new Float32Array(NCH);
  let action = ACTIONS.includes(opts.action) ? opts.action : 'idle';
  weights[ACTIONS.indexOf(action)] = 1;
  let speed = 0;
  let speedSet = false;
  let t = rng.next() * 100;
  let phase = rng.next() * 6;
  let blinkT = rng.range(1, 4);
  let blink = 0;
  let lookT = rng.range(0.5, 3);
  let lookYaw = 0, lookPitch = 0, lookYawTarget = 0, lookPitchTarget = 0;
  let lookTarget = null;
  const tmpV = new THREE.Vector3();

  function evalPose(name, out) {
    out.fill(0);
    const r = rm();
    // shared rest pose
    out[C.AL_Z] = 0.13;
    out[C.AR_Z] = -0.13;
    out[C.BREATH] = Math.sin(t * 1.9) * 0.018;
    const twoHanded = holding && TOOL_INFO[holding]?.twoHanded;
    const frontHold = holding && TOOL_INFO[holding]?.mount === 'front';
    switch (name) {
      case 'idle': {
        out[C.ROOT_Z] = r ? 0 : Math.sin(t * 0.7) * 0.025;
        out[C.HEAD_Y] = lookYaw;
        out[C.HEAD_X] = lookPitch;
        out[C.HEAD_Z] = r ? 0 : Math.sin(t * 0.53) * 0.04;
        out[C.AL_X] = Math.sin(t * 0.9) * 0.04;
        out[C.AR_X] = Math.sin(t * 0.9 + 1) * 0.04;
        if (holding && !frontHold && !twoHanded) out[C.AR_X] = -0.45;
        if (twoHanded || frontHold) {
          out[C.AR_X] = -0.85;
          out[C.AL_X] = -0.85;
          out[C.AR_Z] = 0.28;
          out[C.AL_Z] = -0.28;
          if (holding === 'pump') {
            out[C.AR_X] = -0.5;
            out[C.AL_X] = -0.5;
          }
        }
        break;
      }
      case 'walk':
      case 'run': {
        const run = name === 'run';
        const s = Math.sin(phase);
        const amp = run ? 0.95 : 0.62;
        out[C.LL_X] = -s * amp;
        out[C.LR_X] = s * amp;
        out[C.AL_X] = s * amp * (run ? 1.1 : 0.85);
        out[C.AR_X] = -s * amp * (run ? 1.1 : 0.85);
        out[C.AL_Z] = run ? 0.35 : 0.16;
        out[C.AR_Z] = run ? -0.35 : -0.16;
        out[C.ROOT_Y] = (Math.cos(phase * 2) * 0.5 + 0.5) * (run ? 0.07 : 0.035);
        out[C.ROOT_Z] = s * (run ? 0.05 : 0.075); // cute waddle
        out[C.ROOT_X] = run ? 0.2 : 0.05;
        out[C.TORSO_Y] = s * 0.12;
        out[C.HEAD_Y] = -s * 0.1;
        out[C.HEAD_X] = run ? -0.12 : 0.0;
        out[C.SQUASH] = Math.cos(phase * 2) * (run ? 0.04 : 0.02);
        if (holding && !twoHanded && !frontHold) out[C.AR_X] = -0.5 - s * 0.15;
        if (twoHanded || frontHold) {
          out[C.AR_X] = -0.85 - s * 0.05;
          out[C.AL_X] = -0.85 + s * 0.05;
          out[C.AR_Z] = 0.28;
          out[C.AL_Z] = -0.28;
        }
        break;
      }
      case 'wave': {
        out[C.AR_Z] = -2.45 + (r ? 0 : Math.sin(t * 9) * 0.32);
        out[C.AR_X] = -0.25;
        out[C.AL_X] = 0.05;
        out[C.HEAD_Z] = 0.12;
        out[C.HEAD_X] = -0.08;
        out[C.ROOT_Z] = r ? 0 : Math.sin(t * 4.5) * 0.03;
        out[C.HEAD_Y] = lookYaw * 0.5;
        break;
      }
      case 'work':
        workPose(holding, t, out, r);
        break;
      case 'sit': {
        out[C.ROOT_Y] = -HIP_Y;
        out[C.LL_X] = -1.45 + (r ? 0 : Math.sin(t * 2.1) * 0.14);
        out[C.LR_X] = -1.45 + (r ? 0 : Math.sin(t * 2.1 + 2.4) * 0.14);
        out[C.LL_Z] = 0.06;
        out[C.LR_Z] = -0.06;
        out[C.AL_X] = -0.55;
        out[C.AR_X] = -0.55;
        out[C.AL_Z] = -0.12;
        out[C.AR_Z] = 0.12;
        out[C.TORSO_X] = -0.04;
        out[C.HEAD_Y] = lookYaw;
        out[C.HEAD_X] = lookPitch;
        if (holding) {
          out[C.AR_X] = -0.9;
          out[C.AR_Z] = 0.25;
          if (twoHanded || frontHold) {
            out[C.AL_X] = -0.9;
            out[C.AL_Z] = -0.25;
          }
        }
        break;
      }
      case 'ride': {
        out[C.ROOT_Y] = -HIP_Y + (r ? 0 : Math.abs(Math.sin(t * 3.2)) * 0.012);
        out[C.LL_X] = -1.3;
        out[C.LR_X] = -1.3;
        out[C.LL_Z] = 0.6;
        out[C.LR_Z] = -0.6;
        out[C.AL_X] = -0.95;
        out[C.AR_X] = -0.95;
        out[C.AL_Z] = -0.18;
        out[C.AR_Z] = 0.18;
        out[C.TORSO_X] = 0.06;
        out[C.HEAD_Y] = lookYaw * 0.7;
        out[C.HEAD_X] = lookPitch - 0.05;
        break;
      }
      case 'talk': {
        const k = r ? 0 : 1;
        out[C.HEAD_X] = Math.sin(t * 5.3) * 0.07 * k + lookPitch;
        out[C.HEAD_Y] = lookYaw + Math.sin(t * 1.3) * 0.12 * k;
        out[C.HEAD_Z] = Math.sin(t * 1.7) * 0.07 * k;
        out[C.AR_X] = -0.75 + Math.sin(t * 2.6) * 0.3 * k;
        out[C.AR_Z] = -0.35 + Math.sin(t * 3.1) * 0.2 * k;
        out[C.AL_X] = -0.3 + Math.sin(t * 2.2 + 1) * 0.2 * k;
        out[C.AL_Z] = 0.3;
        out[C.TORSO_Y] = Math.sin(t * 1.3) * 0.08 * k;
        out[C.ROOT_Z] = Math.sin(t * 0.8) * 0.03 * k;
        break;
      }
      case 'cheer': {
        const hop = r ? 0 : Math.abs(Math.sin(t * 5.5));
        out[C.ROOT_Y] = hop * 0.13;
        out[C.SQUASH] = r ? 0 : (1 - hop) * 0.06 - 0.02;
        out[C.AL_Z] = 2.55 + (r ? 0 : Math.sin(t * 11) * 0.2);
        out[C.AR_Z] = -2.55 - (r ? 0 : Math.sin(t * 11 + 1) * 0.2);
        out[C.AL_X] = -0.2;
        out[C.AR_X] = -0.2;
        out[C.HEAD_X] = -0.18;
        out[C.LL_X] = -hop * 0.35;
        out[C.LR_X] = -hop * 0.2;
        break;
      }
    }
  }

  function tick(dt) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    t += dt;
    // weights → current action
    const k = damp(9, dt);
    const ai = ACTIONS.indexOf(action);
    for (let i = 0; i < weights.length; i++) weights[i] += ((i === ai ? 1 : 0) - weights[i]) * k;

    // gait phase: cadence follows the speed (capped so tiny legs never blur)
    const v = speedSet ? speed : action === 'run' ? 3.2 : 1.3;
    const cps = action === 'run' ? Math.min(v / (0.95 * scale), 3.6) : Math.min(v / (0.62 * scale), 2.6);
    phase += dt * Math.PI * 2 * Math.max(cps, 0.6);

    // look-around
    lookT -= dt;
    if (lookTarget) {
      group.updateWorldMatrix(true, false);
      tmpV.copy(lookTarget);
      torso.worldToLocal(tmpV);
      tmpV.y -= NECK_Y + HC;
      lookYawTarget = THREE.MathUtils.clamp(Math.atan2(tmpV.x, tmpV.z), -1.1, 1.1);
      lookPitchTarget = THREE.MathUtils.clamp(-Math.atan2(tmpV.y, Math.hypot(tmpV.x, tmpV.z)), -0.4, 0.4);
    } else if (lookT <= 0) {
      lookT = rng.range(1.8, 5);
      const calm = rng.chance(0.4);
      lookYawTarget = calm || rm() ? 0 : rng.range(-0.75, 0.75);
      lookPitchTarget = calm ? 0 : rng.range(-0.15, 0.12);
    }
    lookYaw += (lookYawTarget - lookYaw) * damp(4, dt);
    lookPitch += (lookPitchTarget - lookPitch) * damp(4, dt);

    // blink
    blinkT -= dt;
    if (blinkT <= 0) {
      blink = 0.16;
      blinkT = rng.chance(0.2) ? 0.25 : rng.range(2, 5);
    }
    if (blink > 0) blink -= dt;
    const lid = blink > 0 ? Math.abs(blink - 0.08) / 0.08 : 1;
    eyes.scale.y = Math.max(0.08, lid);

    // blended pose
    pose.fill(0);
    for (let i = 0; i < ACTIONS.length; i++) {
      const w = weights[i];
      if (w < 0.002) continue;
      evalPose(ACTIONS[i], buf);
      for (let c = 0; c < NCH; c++) pose[c] += buf[c] * w;
    }
    apply();
  }

  function apply() {
    root.position.set(0, pose[C.ROOT_Y], pose[C.ROOT_F]);
    root.rotation.set(pose[C.ROOT_X], 0, pose[C.ROOT_Z]);
    const sq = pose[C.SQUASH];
    root.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
    torso.rotation.set(pose[C.TORSO_X], pose[C.TORSO_Y], pose[C.TORSO_Z]);
    const b = pose[C.BREATH];
    torso.scale.set(1 + b * 0.5, 1 + b, 1 + b * 0.5);
    headPivot.rotation.set(pose[C.HEAD_X], pose[C.HEAD_Y], pose[C.HEAD_Z], 'YXZ');
    armL.rotation.set(pose[C.AL_X], pose[C.AL_Y], pose[C.AL_Z]);
    armR.rotation.set(pose[C.AR_X], pose[C.AR_Y], pose[C.AR_Z]);
    legL.rotation.set(pose[C.LL_X], 0, pose[C.LL_Z]);
    legR.rotation.set(pose[C.LR_X], 0, pose[C.LR_Z]);
  }

  const sw = makeManualSwitch(group, (dt) => tick(dt));

  const person = {
    group,
    name: opts.name ?? '',
    height: PERSON_HEIGHT * scale,
    /** Height of the hip joint above the feet (× scale) — seat offset when not using sit/ride. */
    hipHeight: HIP_Y * scale,
    /** Right hand anchor (tools attach here) and the head pivot (for speech bubbles / look-at). */
    hand: handR,
    handLeft: handL,
    head: headPivot,
    options: o,
    get action() {
      return action;
    },
    get holding() {
      return holding;
    },
    setAction(name) {
      if (ACTIONS.includes(name)) action = name;
    },
    setSpeed(v) {
      speed = Math.max(0, v || 0);
      speedSet = true;
    },
    setHolding,
    /** Make the head follow a world-space point (null = look around on its own). */
    lookAt(target) {
      lookTarget = target ? (lookTarget || new THREE.Vector3()).copy(target) : null;
    },
    /** Manual update — calling this switches the person to manual mode (see header). */
    update(dt) {
      sw.manual();
      tick(dt);
    },
  };
  tick(1 / 60);
  group.userData.person = person;
  return person;
}
