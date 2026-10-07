// ─────────────────────────────────────────────────────────────────────────────
// The riding snail — and its yellow "Schneckenpost" livery (a pun on the Swiss
// PostAuto). Soft body with a lifted head, eye stalks with googly eyes, a
// seamless logarithmic-spiral shell, a leather saddle with stirrups on top.
//
//   const s = makeSnail({ post: true });
//   s.group                 → add to the scene; origin on the ground under the body, facing +Z
//   s.seat                  → Object3D where a rider's hips go (rider faces +Z)
//   s.setMoving(0..1)       → crawl animation (body ripple, stretch, stalk bob)
//   s.update(dt)            → optional manual update (see ticker.js: the first manual call
//                             switches the snail from self-ticking to manual mode)
//
// The body ripple runs in the vertex shader (one material per snail, shared
// program), the eye stalks follow the same maths on the CPU. Body, shell,
// saddle, collar, stalks and eyes are ONE rigidly skinned mesh (each part
// follows its Object3D "bone"): a snail is 1 draw call + 1 shadow draw.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { palette } from '../core/palette.js';
import { materials } from '../core/materials.js';
import { createRng, damp } from '../core/rng.js';
import { Parts, cached, xf, paintFn, shade, mix, opt, blob, strut, restMatrix, mergeSkinned, skinnedMesh } from './util.js';
import { makeManualSwitch, propsSettings } from './ticker.js';

const BODY = palette.snailBody;
const LEATHER = '#8b5a33';
const GOLD = '#e8b13a';

// ── geometry helpers ─────────────────────────────────────────────────────────
/**
 * Loft an elliptical cross-section along a centre curve lying in the YZ plane.
 * radius(s) → [rx, ry]; both ends close with single-vertex poles.
 */
function loftYZ(curve, radius, rings = 36, seg = 14, floorY = 0.012) {
  const pos = [];
  const idx = [];
  const C = new THREE.Vector3();
  const T = new THREE.Vector3();
  const U = new THREE.Vector3();
  const X = new THREE.Vector3(1, 0, 0);
  const starts = [];
  for (let i = 0; i <= rings; i++) {
    const s = i / rings;
    curve.getPointAt(s, C);
    curve.getTangentAt(s, T);
    U.set(0, T.z, -T.y).normalize(); // up, perpendicular to the tangent in YZ
    const [rx, ry] = radius(s);
    starts.push(pos.length / 3);
    if (i === 0 || i === rings) {
      pos.push(C.x, Math.max(C.y, floorY), C.z);
      continue;
    }
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const x = C.x + X.x * Math.cos(a) * rx;
      let y = C.y + U.y * Math.sin(a) * ry;
      const z = C.z + U.z * Math.sin(a) * ry;
      if (y < floorY) y = floorY + (y - floorY) * 0.05; // flat sole
      pos.push(x, y, z);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      if (i === 0) idx.push(starts[0], starts[1] + j1, starts[1] + j);
      else if (i === rings - 1) idx.push(starts[i] + j, starts[i] + j1, starts[rings]);
      else {
        const a = starts[i], b = starts[i + 1];
        idx.push(a + j, a + j1, b + j, a + j1, b + j1, b + j);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A round, fat "cinnamon roll" shell: a surface of revolution around the X
 * axis whose outline grows with the angle (so the lip of the last whorl steps
 * over the first one), with a raised logarithmic-spiral ridge on both sides.
 * φ is measured from +Y towards +Z. Returns { geo, point(u, φ, grow), ... }.
 */
function roundShell({ center, R = 0.66, W = 0.42, step = 0.1, lipPhi = 2.35, color, stripe, cols = 28 }) {
  // lateral profile (x, radial) from the −X dimple to the +X dimple
  const prof = [[-0.8, 0.0], [-0.9, 0.16], [-0.985, 0.42], [-0.95, 0.66], [-0.8, 0.86], [-0.5, 0.97], [0, 1.0], [0.5, 0.97], [0.8, 0.86], [0.95, 0.66], [0.985, 0.42], [0.9, 0.16], [0.8, 0.0]];
  const curve = new THREE.SplineCurve(prof.map(([x, r]) => new THREE.Vector2(x, r)));
  const v2 = new THREE.Vector2();
  const grow = (phi) => {
    // 0 just after the lip, 1 just before it → outline spirals outwards
    let f = (phi - lipPhi) / (Math.PI * 2);
    f -= Math.floor(f);
    return 1 - step + step * f;
  };
  const point = (u, phi, out = new THREE.Vector3(), lift = 0) => {
    curve.getPoint(u, v2);
    const r = v2.y * R * grow(phi) + lift;
    return out.set(center.x + v2.x * W * (1 + lift / W), center.y + Math.cos(phi) * r, center.z + Math.sin(phi) * r);
  };
  const rows = 14;
  const pos = [], col = [], idx = [];
  const cA = new THREE.Color(color), cS = new THREE.Color(stripe), cD = new THREE.Color(shade(color, -0.13)), cL = new THREE.Color(shade(color, 0.08));
  const tmp = new THREE.Color();
  const p = new THREE.Vector3();
  const b = Math.log((0.95 * R) / 0.07) / (Math.PI * 2 * 2.2);
  // distance (in log-polar terms) to the painted spiral band on the sides
  const spiralBand = (x, y, z) => {
    const rr = Math.hypot(y - center.y, z - center.z);
    if (rr < 0.02) return 1;
    const ang = Math.atan2(z - center.z, y - center.y);
    const turns = (Math.log(rr / 0.07) / b - (ang - lipPhi)) / (Math.PI * 2);
    return Math.abs(turns - Math.round(turns));
  };
  for (let i = 0; i <= rows; i++) {
    const u = i / rows;
    const pole = i === 0 || i === rows;
    const n = pole ? 1 : cols;
    for (let j = 0; j < n; j++) {
      const phi = lipPhi + 0.0001 + (j / cols) * Math.PI * 2;
      point(u, phi, p);
      if (pole) p.set(center.x + prof[i === 0 ? 0 : prof.length - 1][0] * W, center.y, center.z);
      pos.push(p.x, p.y, p.z);
      // colours: lighter crown, darker sides, a painted band following the spiral
      curve.getPoint(u, v2);
      tmp.copy(cA);
      const side = Math.abs(v2.x);
      if (side < 0.6) tmp.lerp(cL, (0.6 - side) * 0.8);
      else tmp.lerp(cD, (side - 0.6) * 0.6);
      if (side > 0.7 && spiralBand(p.x, p.y, p.z) < 0.12) tmp.lerp(cS, 0.75);
      if (side < 0.2) {
        // growth lines across the crown
        if (Math.sin(phi * 14) > 0.85) tmp.lerp(cD, 0.25);
      }
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  const start = (i) => (i === 0 ? 0 : 1 + (i - 1) * cols);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const j1 = (j + 1) % cols;
      if (i === 0) idx.push(0, start(1) + j, start(1) + j1);
      else if (i === rows - 1) idx.push(start(i) + j, start(rows), start(i) + j1);
      else {
        const a0 = start(i), b0 = start(i + 1);
        idx.push(a0 + j, b0 + j, a0 + j1, a0 + j1, b0 + j, b0 + j1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // orient outwards (probe the crown)
  const k = start(Math.floor(rows / 2)) + Math.floor(cols / 2);
  const nn = g.attributes.normal, pp = g.attributes.position;
  if (nn.getY(k) * (pp.getY(k) - center.y) + nn.getZ(k) * (pp.getZ(k) - center.z) < 0) {
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i += 3) [ia[i + 1], ia[i + 2]] = [ia[i + 2], ia[i + 1]];
    g.computeVertexNormals();
  }
  // raised spiral ridges on both sides
  const ridges = [];
  for (const sgn of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 44; i++) {
      const th = (i / 44) * Math.PI * 2 * 2.2;
      const rr = 0.07 * Math.exp(b * th);
      const ang = lipPhi + th;
      // lateral position of the side surface at radial distance rr (search the profile)
      let best = 0;
      for (let q = 0; q <= 60; q++) {
        curve.getPoint(sgn < 0 ? q / 120 : 1 - q / 120, v2);
        if (v2.y * R * grow(ang) >= rr) {
          best = v2.x;
          break;
        }
        best = v2.x;
      }
      pts.push(new THREE.Vector3(center.x + best * W + sgn * 0.012, center.y + Math.cos(ang) * rr, center.z + Math.sin(ang) * rr));
    }
    ridges.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 44, 0.026, 3, false));
  }
  return { geo: g, ridges, point, grow };
}

// ── body material with the crawl ripple ──────────────────────────────────────
function makeBodyMaterial(uniforms) {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: materials.gradientMap });
  m.name = 'snail-body';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPhase = uniforms.uPhase;
    shader.uniforms.uMove = uniforms.uMove;
    shader.uniforms.uHead = uniforms.uHead;
    shader.vertexShader =
      'uniform float uPhase;\nuniform float uMove;\nuniform vec2 uHead;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_SKINNING
        if (skinIndex.x < 0.5) // only the body ripples (bone 0); shell, collar & eyes ride their bones
        #endif
        {
          float zz = position.z;
          float back = 1.0 - smoothstep(0.25, 0.6, zz);
          float w = sin(zz * 8.0 - uPhase);
          float top = smoothstep(0.03, 0.2, position.y);
          transformed.y += w * 0.028 * uMove * back * top;
          transformed.x *= 1.0 + w * 0.05 * uMove * back;
          transformed.z += sin(uPhase * 0.5) * 0.045 * uMove * (zz + 1.25) / 2.5;
          float hd = smoothstep(0.42, 0.78, zz);
          transformed.y += uHead.x * hd;
          transformed.z += uHead.y * hd;
        }`
      );
  };
  m.customProgramCacheKey = () => 'snail-body-ripple';
  return m;
}

// ── builders ─────────────────────────────────────────────────────────────────
const BODY_CURVE = [
  [-1.2, 0.05], [-0.95, 0.12], [-0.55, 0.2], [-0.1, 0.25], [0.3, 0.28], [0.6, 0.4], [0.78, 0.62], [0.86, 0.84], [0.9, 0.98],
];

function bodyGeos(bodyColor) {
  return cached(`snail-body|${bodyColor}`, () => {
    const P = new Parts();
    const curve = new THREE.CatmullRomCurve3(BODY_CURVE.map(([z, y]) => new THREE.Vector3(0, y, z)));
    const len = curve.getLength();
    const headS = 1 - 0.3 / len; // spherical head over the last 0.3 units
    const radius = (s) => {
      let r;
      if (s < 0.08) r = 0.06 + (s / 0.08) * 0.16;
      else if (s < 0.45) r = 0.22 + ((s - 0.08) / 0.37) * 0.12;
      else if (s < 0.72) r = 0.34 - ((s - 0.45) / 0.27) * 0.12;
      else if (s < headS) r = 0.22 + ((s - 0.72) / (headS - 0.72)) * 0.09;
      else r = 0.31 * Math.sqrt(Math.max(0, 1 - ((s - headS) / (1 - headS)) ** 2));
      const flat = s < 0.62 ? 1.3 : 1.0;
      return [r * flat, r * (s < 0.62 ? 0.82 : 1)];
    };
    const body = loftYZ(curve, radius, 30, 13);
    const cBody = new THREE.Color(bodyColor);
    const cDark = new THREE.Color(shade(bodyColor, -0.1));
    const cLight = new THREE.Color(shade(bodyColor, 0.05));
    const cSole = new THREE.Color(mix(bodyColor, palette.dirt, 0.35));
    paintFn(body, (x, y, z, nx, ny, nz, i, c) => {
      c.copy(cBody);
      if (y < 0.06) c.lerp(cSole, 0.7);
      else if (ny > 0.4) c.lerp(cLight, 0.6);
      // soft freckles on the back
      const f = Math.sin(x * 40) * Math.sin(z * 23) * Math.sin(y * 31);
      if (f > 0.6 && z < 0.4) c.lerp(cDark, 0.6);
      // a darker skirt line along the foot edge
      if (y > 0.05 && y < 0.1 && z < 0.5) c.lerp(cDark, 0.35);
    });
    P.add('paint', body);
    // head features (they ride the shader's head offset because they live at z > 0.78)
    const hc = curve.getPointAt(headS);
    const headR = 0.31;
    const face = (x, y) => {
      // point on the head sphere front for offsets x, y
      const z = Math.sqrt(Math.max(0.0001, headR * headR - x * x - y * y));
      return new THREE.Vector3(hc.x + x, hc.y + y, hc.z + z);
    };
    const orient = (geo, p) => {
      const n = p.clone().sub(hc).normalize();
      const xA = new THREE.Vector3(0, 1, 0).cross(n).normalize();
      const yA = n.clone().cross(xA);
      geo.applyMatrix4(new THREE.Matrix4().makeBasis(xA, yA, n));
      return geo.translate(p.x, p.y, p.z);
    };
    const smile = new THREE.TorusGeometry(0.075, 0.016, 3, 9, Math.PI * 0.9);
    smile.rotateZ(Math.PI + Math.PI * 0.05);
    P.add('paint', orient(smile, face(0, -0.08)), '#7a4a3a');
    for (const s of [-1, 1]) {
      P.add('paint', orient(blob(0.06, [1.2, 0.7, 0.25], 7, 3), face(s * 0.16, -0.06)), '#f2a7a0');
      // little lower tentacles
      const p = face(s * 0.11, -0.2);
      P.add('paint', strut([p.x, p.y, p.z - 0.04], [p.x + s * 0.05, p.y - 0.04, p.z + 0.07], 0.022, 0.016, 6), bodyColor);
      P.add('paint', blob(0.022, [1, 1, 1], 6, 4).translate(p.x + s * 0.05, p.y - 0.04, p.z + 0.07), bodyColor);
    }
    // glossy highlights
    P.add('paint', orient(blob(0.05, [1.4, 0.55, 0.2], 6, 3), face(-0.1, 0.22)), mix(bodyColor, '#ffffff', 0.7));
    P.add('paint', xf(blob(0.1, [0.6, 0.18, 1.6], 6, 3), [0.12, 0.37, 0.55], [0.6, 0, -0.5]), mix(bodyColor, '#ffffff', 0.6));
    const geos = P.finish();
    return { geos, headCenter: hc.clone(), headR };
  });
}

function shellGeos(o) {
  return cached(`snail-shell|${o.shellColor}|${o.stripe}|${o.post}|${o.saddle}|${o.blanket}`, () => {
    const P = new Parts();
    const center = new THREE.Vector3(0, 0.92, -0.3);
    const R = 0.66, W = 0.42;
    const shell = roundShell({ center, R, W, step: 0.12, lipPhi: 2.5, color: o.shellColor, stripe: o.stripe });
    P.add('paint', shell.geo);
    for (const r of shell.ridges) P.add('paint', r, shade(o.stripe, -0.05));
    const top = shell.point(0.5, 0);
    const seatY = top.y;
    const seatZ = top.z;
    if (o.saddle) {
      // blanket: a patch of the shell surface around the crown, lifted a little
      const us = 12, ps = 7;
      const bp = [], bc = [], bi = [];
      const cB = new THREE.Color(o.blanket), cT = new THREE.Color(o.trim);
      const q = new THREE.Vector3();
      for (let i = 0; i <= us; i++) {
        const u = 0.14 + (i / us) * 0.72;
        for (let j = 0; j <= ps; j++) {
          const phi = -0.42 + (j / ps) * 0.84;
          shell.point(u, phi, q, 0.025);
          bp.push(q.x, q.y, q.z);
          const edge = i <= 1 || i >= us - 1 || j === 0 || j === ps;
          const c = edge ? cT : cB;
          bc.push(c.r, c.g, c.b);
        }
      }
      for (let i = 0; i < us; i++) {
        for (let j = 0; j < ps; j++) {
          const a0 = i * (ps + 1) + j, b0 = (i + 1) * (ps + 1) + j;
          bi.push(a0, a0 + 1, b0, b0, a0 + 1, b0 + 1);
        }
      }
      const blanket = new THREE.BufferGeometry();
      blanket.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
      blanket.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
      blanket.setIndex(bi);
      blanket.computeVertexNormals();
      const mid = Math.floor(us / 2) * (ps + 1) + Math.floor(ps / 2);
      if (blanket.attributes.normal.getY(mid) < 0) {
        for (let i = 0; i < bi.length; i += 3) [bi[i + 1], bi[i + 2]] = [bi[i + 2], bi[i + 1]];
        blanket.setIndex(bi);
        blanket.computeVertexNormals();
      }
      P.add('paint', blanket);
      // leather seat with a low pommel & cantle
      const seat = new THREE.SphereGeometry(1, 10, 6);
      seat.scale(0.19, 0.055, 0.23);
      P.add('paint', seat.translate(0, seatY + 0.05, seatZ), LEATHER);
      const cantle = new THREE.TorusGeometry(0.12, 0.04, 4, 8, Math.PI);
      cantle.scale(1.25, 0.45, 1);
      xf(cantle, [0, seatY + 0.06, seatZ - 0.19], [-0.35, 0, 0]);
      P.add('paint', cantle, shade(LEATHER, -0.06));
      P.add('paint', blob(0.045, [1, 1.3, 1], 6, 4).translate(0, seatY + 0.1, seatZ + 0.2), shade(LEATHER, -0.06));
      P.add('paint', blob(0.024, [1, 1, 1], 6, 4).translate(0, seatY + 0.155, seatZ + 0.2), GOLD);
      const edge = new THREE.TorusGeometry(1, 0.011, 3, 16);
      edge.rotateX(Math.PI / 2);
      edge.scale(0.19, 1, 0.23);
      P.add('paint', edge.translate(0, seatY + 0.055, seatZ), shade(LEATHER, 0.14));
      // straps down the sides + stirrups
      for (const s of [-1, 1]) {
        const u0 = s < 0 ? 0.2 : 0.8;
        const pTop = shell.point(u0, 0.12, new THREE.Vector3(), 0.035);
        const pLow = shell.point(s < 0 ? 0.1 : 0.9, 0.62, new THREE.Vector3(), 0.04);
        P.add('paint', strut([s * 0.15, seatY + 0.05, seatZ + 0.05], [pTop.x, pTop.y, pTop.z], 0.016, 0.016, 4), shade(LEATHER, -0.15));
        P.add('paint', strut([pTop.x, pTop.y, pTop.z], [pLow.x + s * 0.03, pLow.y, pLow.z], 0.016, 0.016, 4), shade(LEATHER, -0.15));
        const stirrup = new THREE.TorusGeometry(0.05, 0.013, 3, 8);
        stirrup.rotateY(Math.PI / 2);
        P.add('paint', stirrup.translate(pLow.x + s * 0.03, pLow.y - 0.05, pLow.z), GOLD);
        if (o.post) {
          // post-horn badge on the blanket flank
          const bpnt = shell.point(s < 0 ? 0.19 : 0.81, -0.22, new THREE.Vector3(), 0.03);
          const n = new THREE.Vector3(s, 0.35, 0).normalize();
          const qn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
          P.add('paint', new THREE.CylinderGeometry(0.085, 0.085, 0.014, 12).applyQuaternion(qn).translate(bpnt.x, bpnt.y, bpnt.z), palette.postYellow);
          const coil = new THREE.TorusGeometry(0.03, 0.009, 3, 9);
          coil.rotateX(Math.PI / 2);
          coil.applyQuaternion(qn);
          P.add('paint', coil.translate(bpnt.x + n.x * 0.012, bpnt.y + n.y * 0.012, bpnt.z - 0.012), '#2a2a2a');
          const bell = new THREE.ConeGeometry(0.024, 0.055, 8, 1, true);
          bell.rotateX(Math.PI / 2);
          bell.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n));
          P.add('paint', bell.translate(bpnt.x + n.x * 0.012, bpnt.y + n.y * 0.012, bpnt.z + 0.035), '#2a2a2a');
        }
      }
    }
    return { geos: P.finish(), seatY: seatY + 0.08, seatZ, top };
  });
}

function stalkGeos(bodyColor) {
  return cached(`snail-stalk|${bodyColor}`, () => {
    const P = new Parts();
    const stalk = new THREE.CylinderGeometry(0.03, 0.042, 0.36, 7, 1, true);
    stalk.translate(0, 0.18, 0);
    P.add('paint', stalk, bodyColor);
    return P.finish();
  });
}

function eyeGeos() {
  return cached('snail-eye', () => {
    const P = new Parts();
    P.add('paint', new THREE.SphereGeometry(0.1, 9, 7), '#fffaf0');
    P.add('paint', blob(0.052, [1, 1.1, 0.55], 7, 5).translate(0, 0, 0.078), '#2b1d14');
    P.add('paint', blob(0.017, [1, 1, 0.6], 5, 3).translate(0.018, 0.022, 0.104), '#ffffff');
    return P.finish();
  });
}

function collarGeos(post) {
  return cached(`snail-collar|${post}`, () => {
    const P = new Parts();
    const ring = new THREE.TorusGeometry(0.262, 0.03, 4, 16);
    ring.scale(1.06, 1, 1);
    xf(ring, [0, 0.5, 0.68], [-0.87, 0, 0]);
    P.add('paint', ring, post ? palette.swissRed : '#4f6d9a');
    // bell
    const bell = new THREE.LatheGeometry([[0.0, 0.0], [0.05, 0.005], [0.055, 0.03], [0.04, 0.07], [0.025, 0.09], [0.0, 0.095]].map(([r, y]) => new THREE.Vector2(r, y)), 10);
    bell.translate(0, -0.1, 0);
    P.add('paint', xf(bell, [0, 0.33, 0.89], [0.15, 0, 0]), GOLD);
    P.add('paint', new THREE.SphereGeometry(0.018, 6, 4).translate(0, 0.225, 0.905), shade(GOLD, -0.2));
    return P.finish();
  });
}

/** Generous culling volume (unscaled, group space) covering the crawl + a rider's seat. */
const SNAIL_BOUNDS = { center: [0, 0.8, -0.1], radius: 1.55, pad: 0.06 };

/**
 * Body, shell + saddle, collar, stalks and eyes merged into one rigidly
 * skinned geometry (bone order: body, shell, collar, stalkL, eyeL, stalkR, eyeR).
 */
function snailGeometry(o, body, shell, rest) {
  const key = `snail-skin|${o.bodyColor}|${o.shellColor}|${o.stripe}|${o.post}|${o.saddle}|${o.blanket}`;
  return cached(key, () => {
    const parts = [
      { geo: body.geos.paint, bone: 0, matrix: rest[0] },
      { geo: shell.geos.paint, bone: 1, matrix: rest[1] },
      { geo: collarGeos(o.post).paint, bone: 2, matrix: rest[2] },
    ];
    for (const k of [0, 1]) {
      parts.push({ geo: stalkGeos(o.bodyColor).paint, bone: 3 + k * 2, matrix: rest[3 + k * 2] });
      parts.push({ geo: eyeGeos().paint, bone: 4 + k * 2, matrix: rest[4 + k * 2] });
    }
    return mergeSkinned(parts);
  });
}

let snailCount = 0;

/**
 * A rideable snail. Origin at ground under the body centre, facing (crawling towards) +Z. ≈2.3 long.
 * @param {object} [opts] { seed, shellColor, bodyColor, stripe, saddle=true, blanket, post=false (yellow
 *   Schneckenpost livery: yellow shell, red blanket with post-horn badges, collar with a bell), scale=1 }
 * @returns {{ group: THREE.Group, seat: THREE.Object3D, length: number, setMoving(amount: number): void,
 *   update(dt: number): void, lookAt(target: THREE.Vector3|null): void, moving: number }}
 */
export function makeSnail(opts = {}) {
  const rng = createRng(String(opts.seed ?? `snail-${snailCount}`));
  snailCount++;
  const post = !!opts.post;
  const o = {
    post,
    shellColor: opts.shellColor ?? (post ? palette.postYellow : rng.pick(palette.shell)),
    stripe: opts.stripe ?? (post ? '#e8892a' : palette.spots),
    bodyColor: opts.bodyColor ?? palette.snailBody,
    saddle: opt(opts, 'saddle', true),
    blanket: opts.blanket ?? (post ? palette.swissRed : rng.pick(['#4f6d9a', '#7aa65a', palette.capCoral, '#b39ddb'])),
    trim: post ? palette.postYellow : palette.paper,
  };
  const scale = opt(opts, 'scale', 1);

  const group = new THREE.Group();
  group.name = post ? 'schneckenpost' : 'snail';
  group.scale.setScalar(scale);

  // ── hierarchy (bones) ──
  // body (static frame), shell + saddle (sway together; the seat rides on it),
  // collar & bell, two eye stalks with googly eyes — all drawn as ONE skinned
  // mesh with the ripple material (the ripple only moves the body's vertices).
  const bodyBone = new THREE.Group();
  bodyBone.name = 'snail-frame';
  group.add(bodyBone);
  const shellPivot = new THREE.Group();
  shellPivot.position.set(0, 0.3, -0.28);
  const shellInner = new THREE.Group();
  shellInner.position.set(0, -0.3, 0.28);
  shellPivot.add(shellInner);
  group.add(shellPivot);
  const body = bodyGeos(o.bodyColor);
  const shell = shellGeos(o);
  const seat = new THREE.Object3D();
  seat.name = 'seat';
  seat.position.set(0, shell.seatY, shell.seatZ);
  shellInner.add(seat);
  const collar = new THREE.Group();
  group.add(collar);

  // eye stalks
  const head = body.headCenter;
  const stalks = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    const base = new THREE.Vector3(s * 0.1, head.y + 0.2, head.z - 0.04);
    pivot.position.copy(base);
    pivot.userData.base = base;
    pivot.rotation.set(-0.25, 0, -s * 0.28);
    const eye = new THREE.Group();
    eye.position.y = 0.38;
    pivot.add(eye);
    group.add(pivot);
    stalks.push({ pivot, eye, side: s, wob: 0, wobV: 0, look: 0, lookT: 0, lookTarget: 0, pitch: 0, pitchTarget: 0 });
  }

  // body material: own instance for the ripple uniforms (program shared)
  const uniforms = { uPhase: { value: 0 }, uMove: { value: 0 }, uHead: { value: new THREE.Vector2() } };
  const bodyMat = makeBodyMaterial(uniforms);
  const bones = [bodyBone, shellInner, collar, stalks[0].pivot, stalks[0].eye, stalks[1].pivot, stalks[1].eye];
  const rest = bones.map((b) => restMatrix(b, group));
  const mesh = skinnedMesh(snailGeometry(o, body, shell, rest), bodyMat, bones, rest, SNAIL_BOUNDS, post ? 'schneckenpost-body' : 'snail-body');
  group.add(mesh);

  // ── animation ──
  let moving = 0, movingTarget = 0;
  let phase = rng.next() * 6;
  let t = rng.next() * 50;
  let blinkT = rng.range(1.5, 4), blink = 0;
  let lookTarget = null;
  const tmp = new THREE.Vector3();

  function tick(dt) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    const rm = propsSettings.reducedMotion;
    t += dt;
    moving += (movingTarget - moving) * damp(3, dt);
    phase += dt * (1.2 + moving * 6.5);
    const m = rm ? moving * 0.3 : moving;
    uniforms.uPhase.value = phase;
    uniforms.uMove.value = m;
    // head bob: slow breathing when idle, a nodding bob while crawling
    const headY = Math.sin(t * 1.6) * 0.012 + Math.sin(phase * 0.5) * 0.025 * m;
    const headZ = Math.sin(phase * 0.5 + 1) * 0.02 * m;
    uniforms.uHead.value.set(headY, headZ);
    const stretchZ = Math.sin(phase * 0.5) * 0.045 * m;
    // shell sways with the crawl
    shellPivot.rotation.z = Math.sin(phase * 0.5) * 0.035 * m + Math.sin(t * 0.9) * 0.008;
    shellPivot.rotation.x = Math.sin(phase * 0.5 + 0.8) * 0.02 * m;
    shellPivot.position.z = -0.28 + stretchZ * 0.3;
    collar.position.set(0, headY * 0.8, headZ * 0.8 + stretchZ * 0.85);

    // blink
    blinkT -= dt;
    if (blinkT <= 0) {
      blink = 0.18;
      blinkT = rng.range(2.5, 6);
    }
    if (blink > 0) blink -= dt;
    const lid = blink > 0 ? Math.max(0.1, Math.abs(blink - 0.09) / 0.09) : 1;

    for (const st of stalks) {
      const b = st.pivot.userData.base;
      // follow the head (same offsets as the shader at z ≈ head)
      st.pivot.position.set(b.x, b.y + headY, b.z + headZ + stretchZ * ((b.z + 1.25) / 2.5) * 2);
      // look around (independently — snails are like that)
      st.lookT -= dt;
      if (lookTarget) {
        group.updateWorldMatrix(true, false);
        tmp.copy(lookTarget);
        group.worldToLocal(tmp);
        st.lookTarget = THREE.MathUtils.clamp(Math.atan2(tmp.x - b.x, tmp.z - b.z), -0.8, 0.8);
        st.pitchTarget = 0;
      } else if (st.lookT <= 0) {
        st.lookT = rng.range(1.2, 4);
        st.lookTarget = rm ? 0 : rng.range(-0.6, 0.6);
        st.pitchTarget = rm ? 0 : rng.range(-0.2, 0.25);
      }
      st.look += (st.lookTarget - st.look) * damp(3, dt);
      st.pitch += (st.pitchTarget - st.pitch) * damp(3, dt);
      // googly wobble: a spring kicked by the crawl
      const kick = Math.cos(phase * 0.5) * m * 6;
      st.wobV += (-st.wob * 60 - st.wobV * 4 + kick) * dt;
      st.wob += st.wobV * dt;
      const bob = Math.sin(phase * 0.5 + st.side) * 0.12 * m;
      st.pivot.rotation.set(-0.25 + st.pitch * 0.5 + bob, st.look * 0.4, -st.side * (0.28 + Math.sin(t * 1.1 + st.side) * 0.05));
      st.eye.rotation.set(st.pitch + st.wob * 0.25, st.look * 0.8, st.wob * 0.3 * st.side);
      st.eye.scale.set(1, lid, 1);
    }
  }

  const sw = makeManualSwitch(group, (dt) => tick(dt));
  tick(1 / 60);

  const snail = {
    group,
    seat,
    length: 2.3 * scale,
    get moving() {
      return movingTarget;
    },
    /** 0 = resting, 1 = full crawl. */
    setMoving(amount) {
      movingTarget = THREE.MathUtils.clamp(+amount || 0, 0, 1);
    },
    /** Both eyes follow a world point (null = look around). */
    lookAt(target) {
      lookTarget = target ? (lookTarget || new THREE.Vector3()).copy(target) : null;
    },
    update(dt) {
      sw.manual();
      tick(dt);
    },
  };
  group.userData.snail = snail;
  return snail;
}
