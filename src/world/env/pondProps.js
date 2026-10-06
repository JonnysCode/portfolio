// ─────────────────────────────────────────────────────────────────────────────
// Pond furniture for world/water.js: the Schreiner's jetty, a little rowboat,
// lily pads & flowers, reeds & cattails, stepping stones, a frog and a duck
// family. Everything is merged per material / instanced to keep draw calls low.
// World coordinates throughout (the pond is not a district).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { POND } from '../layout.js';
import { getHeight } from '../ground.js';
import { materials, sharedUniforms } from '../../core/materials.js';
import { palette } from '../../core/palette.js';

const WL = POND.waterLevel;
const UP = new THREE.Vector3(0, 1, 0);

/** Water depth at a world point (negative = dry land). */
export const depthAt = (x, z) => WL - getHeight(x, z);

/** Distance from the pond centre to the waterline along an angle (radians, atan2(dz, dx)). */
export function shoreRadius(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let d = 2; d < POND.radius * 1.4; d += 0.05) {
    if (depthAt(POND.center.x + c * d, POND.center.z + s * d) <= 0) return d;
  }
  return POND.radius;
}

/**
 * mergeGeometries that tolerates mixed indexed / non-indexed inputs and only
 * keeps the attributes every input has (position, normal, uv, color).
 */
function mergeAll(list) {
  const keep = ['position', 'normal', 'uv', 'color'].filter((k) => list.every((g) => g.attributes[k]));
  const mixed = list.some((g) => g.index) && list.some((g) => !g.index);
  const prepared = list.map((g) => {
    const h = mixed && g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(h.attributes)) if (!keep.includes(k)) h.deleteAttribute(k);
    return h;
  });
  return mergeGeometries(prepared);
}

function finish(mesh, { cast = true, receive = true } = {}) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

/** Bake a solid colour into a geometry (for vertex-coloured merged meshes). */
function tint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Orient a unit-Y geometry along a segment a→b (both Vector3) and return it. */
function alongSegment(geo, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  geo.scale(1, len, 1);
  geo.translate(0, len / 2, 0);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  geo.translate(a.x, a.y, a.z);
  return geo;
}

// ─── Jetty ───────────────────────────────────────────────────────────────────
/**
 * A small timber jetty where the pond path meets the north shore.
 * Proper carpentry: posts with through-tenoned cross headers locked by oak
 * pegs, two stringers, gapped deck planks with slightly hand-set irregularity,
 * X-bracing below the deck, rope coils and a lantern on the end post.
 */
export function buildDock(ctx, rng) {
  const x0 = POND.center.x;
  const zLand = POND.center.z - POND.radius - 1.0; // where the path arrives
  const zEnd = POND.center.z - POND.radius * 0.53;
  const deckY = 0.1;
  const halfW = 0.95;
  const group = new THREE.Group();
  group.name = 'pond-jetty';

  // deck planks (spruce, long along X, grain along their length)
  const planks = [];
  const pitch = 0.31;
  const count = Math.floor((zEnd - zLand) / pitch);
  for (let k = 0; k < count; k++) {
    const w = halfW * 2 + rng.jitter(0.05);
    const g = new RoundedBoxGeometry(0.27, 0.07, w, 2, 0.022);
    g.rotateY(Math.PI / 2 + rng.jitter(0.018));
    g.translate(x0 + rng.jitter(0.035), deckY - 0.035 + rng.jitter(0.006), zLand + pitch * (k + 0.5));
    planks.push(g);
  }
  group.add(finish(new THREE.Mesh(mergeAll(planks), materials.wood('spruce'))));
  planks.forEach((g) => g.dispose());

  // frame (oak): posts, stringers, cross headers with through tenons, braces
  const frame = [];
  const dark = []; // walnut pegs & wedges
  const postZ = [zLand + 0.35, zLand + 0.35 + (zEnd - zLand - 0.6) / 3, zLand + 0.35 + (2 * (zEnd - zLand - 0.6)) / 3, zEnd - 0.25];
  const postX = [x0 - 1.0, x0 + 1.0];
  const headerY = deckY - 0.07 - 0.14 - 0.07;
  postZ.forEach((pz, pi) => {
    const isEnd = pi === postZ.length - 1;
    postX.forEach((px) => {
      const bottom = getHeight(px, pz) - 0.2;
      const top = deckY + (isEnd ? 0.62 : 0.14);
      const post = new THREE.CylinderGeometry(0.1, 0.11, top - bottom, 10);
      post.translate(px, (top + bottom) / 2, pz);
      frame.push(post);
      // rounded weathered cap
      const cap = new THREE.SphereGeometry(0.1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.scale(1, 0.55, 1);
      cap.translate(px, top, pz);
      frame.push(cap);
      // oak peg locking the tenon (visible end grain on both faces)
      const peg = new THREE.CylinderGeometry(0.024, 0.024, 0.27, 6);
      peg.rotateX(Math.PI / 2);
      peg.translate(px, headerY, pz);
      dark.push(peg);
    });
    // cross header passing through both posts, tenons protruding
    const header = new RoundedBoxGeometry(2.34, 0.14, 0.12, 1, 0.02);
    header.translate(x0, headerY, pz);
    frame.push(header);
    // wedges driven into the tenon ends
    for (const s of [-1, 1]) {
      const wedge = new THREE.BoxGeometry(0.03, 0.16, 0.06);
      wedge.translate(x0 + s * 1.14, headerY, pz);
      dark.push(wedge);
    }
  });
  // two stringers along the jetty
  for (const sx of [-0.62, 0.62]) {
    const len = zEnd - zLand - 0.1;
    const s = new RoundedBoxGeometry(0.12, 0.14, len, 1, 0.02);
    s.translate(x0 + sx, deckY - 0.07 - 0.07, zLand + 0.05 + len / 2);
    frame.push(s);
  }
  // X-bracing between the posts that stand in the water
  for (let i = 1; i < postZ.length - 1; i++) {
    for (const px of [x0 - 0.86, x0 + 0.86]) {
      const za = postZ[i], zb = postZ[i + 1];
      const lowA = Math.max(getHeight(px, za), WL - 0.55) + 0.1;
      const lowB = Math.max(getHeight(px, zb), WL - 0.55) + 0.1;
      const hi = headerY - 0.1;
      for (const [a, b] of [
        [new THREE.Vector3(px, lowA, za), new THREE.Vector3(px, hi, zb)],
        [new THREE.Vector3(px, hi, za), new THREE.Vector3(px, lowB, zb)],
      ]) {
        const board = new THREE.BoxGeometry(0.035, 1, 0.09);
        frame.push(alongSegment(board, a, b));
      }
    }
  }
  group.add(finish(new THREE.Mesh(mergeAll(frame), materials.wood('oak'))));
  group.add(finish(new THREE.Mesh(mergeAll(dark), materials.wood('walnut', { grain: false })), { cast: false }));
  frame.forEach((g) => g.dispose());
  dark.forEach((g) => g.dispose());

  // rope coils on the end posts + a mooring line to the boat
  const rope = [];
  const endZ = postZ[postZ.length - 1];
  for (const px of postX) {
    for (let r = 0; r < 3; r++) {
      const t = new THREE.TorusGeometry(0.125, 0.022, 5, 18);
      t.rotateX(Math.PI / 2);
      t.translate(px, deckY + 0.36 + r * 0.045, endZ);
      rope.push(t);
    }
  }
  const boatAnchor = new THREE.Vector3(x0 + 1.95, WL + 0.26, endZ - 0.35);
  const line = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x0 + 1.0, deckY + 0.4, endZ),
    new THREE.Vector3(x0 + 1.45, WL + 0.12, endZ - 0.1),
    boatAnchor,
  ]);
  rope.push(new THREE.TubeGeometry(line, 12, 0.018, 4, false));
  group.add(finish(new THREE.Mesh(mergeAll(rope), materials.toon('#d8bf8a')), { cast: false }));
  rope.forEach((g) => g.dispose());

  // lantern on the west end post (glows at night)
  if (ctx.props?.makeLantern) {
    try {
      const lantern = ctx.props.makeLantern();
      lantern.position.set(x0 - 1.0, deckY + 0.62 + 0.055, endZ);
      lantern.scale.setScalar(0.8);
      group.add(lantern);
    } catch {
      /* props kit optional */
    }
  }

  // a fishing bucket at the end of the jetty
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.26, 12), materials.wood('ash'));
  bucket.position.set(x0 + 0.55, deckY + 0.13, endZ - 0.5);
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.012, 4, 16), materials.standard(palette.metalDark, { metalness: 0.5, roughness: 0.5 }));
  hoop.rotation.x = Math.PI / 2;
  hoop.position.y = 0.07;
  const inside = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), materials.toon(palette.waterDeep));
  inside.rotation.x = -Math.PI / 2;
  inside.position.y = 0.131;
  bucket.add(hoop, inside);
  group.add(finish(bucket, { cast: true }));

  ctx.scene.add(group);
  return {
    group,
    info: { x: x0, zStart: zLand, zEnd, deckY, halfWidth: halfW, endPostZ: endZ, boatAnchor },
  };
}

// ─── Rowboat ─────────────────────────────────────────────────────────────────
/** A small clinker-style rowboat, painted outside, varnished inside. */
export function buildBoat(ctx, at) {
  const group = new THREE.Group();
  group.name = 'pond-rowboat';
  const L = 1.25, W = 0.55, D = 0.36;
  const hull = new THREE.SphereGeometry(1, 22, 9, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const p = hull.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = z; // −1 stern … 1 bow
    x *= 1 - 0.38 * Math.max(t, 0) ** 2 - 0.12 * Math.max(-t, 0) ** 2; // pointy bow, fuller stern
    y = y * (1 - 0.15 * t * t) + 0.16 * Math.max(t, 0) ** 2 * (1 + y); // sheer: bow rises
    p.setXYZ(i, x * W, y * D, z * L);
  }
  hull.computeVertexNormals();
  const paint = materials.toon(palette.capTeal);
  const outer = finish(new THREE.Mesh(hull, paint));
  // The inside is drawn after the (transparent) pond surface so the water
  // plane that cuts through the hull never shows inside the boat.
  const inner = finish(new THREE.Mesh(hull, materials.wood('oak', { side: THREE.BackSide, transparent: true })), { cast: false });
  inner.renderOrder = 3;
  group.add(outer, inner);
  // painted cream stripe + gunwale (walnut)
  const rimCurve = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const t = Math.cos(a);
    const x = Math.sin(a) * W * (1 - 0.38 * Math.max(t, 0) ** 2 - 0.12 * Math.max(-t, 0) ** 2);
    rimCurve.push(new THREE.Vector3(x, 0.16 * D * Math.max(t, 0) ** 2 * 1.0, t * L));
  }
  const rim = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimCurve, true), 48, 0.035, 5, true);
  group.add(finish(new THREE.Mesh(rim, materials.wood('walnut', { grain: false })), { cast: false }));
  // stripe along the hull just below the gunwale
  const stripe = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(rimCurve.map((v) => new THREE.Vector3(v.x * 0.985, v.y - 0.07, v.z * 0.985)), true),
    48, 0.022, 4, true
  );
  group.add(finish(new THREE.Mesh(stripe, materials.toon(palette.plaster)), { cast: false }));
  // thwarts (seats) and a pair of oars resting across them — one mesh
  const wood = [];
  for (const [z, w] of [[0.15, 0.98], [-0.62, 0.82]]) {
    const seat = new RoundedBoxGeometry(w, 0.04, 0.2, 1, 0.015);
    seat.translate(0, -0.1, z);
    wood.push(seat);
  }
  for (const s of [-1, 1]) {
    const shaft = new THREE.CylinderGeometry(0.018, 0.018, 1.7, 6);
    shaft.rotateX(Math.PI / 2);
    const blade = new RoundedBoxGeometry(0.12, 0.018, 0.36, 1, 0.008);
    blade.translate(0, 0, -0.95);
    const oar = mergeAll([shaft, blade]);
    oar.rotateY(s * 0.22);
    oar.translate(s * 0.22, -0.05, -0.15);
    wood.push(oar);
  }
  group.add(finish(new THREE.Mesh(mergeAll(wood), materials.wood('ash')), { cast: false }));

  group.position.set(at.x, WL + 0.2, at.z);
  group.rotation.y = 0.12;
  ctx.scene.add(group);
  const baseY = group.position.y;
  return {
    group,
    update(t) {
      group.position.y = baseY + Math.sin(t * 1.1) * 0.022;
      group.rotation.z = Math.sin(t * 0.83) * 0.03;
      group.rotation.x = Math.sin(t * 0.61 + 1.2) * 0.018;
    },
  };
}

// ─── Lily pads & flowers ────────────────────────────────────────────────────
function lilyPadGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.absarc(0, 0, 1, 0.28, Math.PI * 2 - 0.28, false);
  s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.03, bevelSegments: 1, curveSegments: 14 });
  g.rotateX(-Math.PI / 2);
  g.deleteAttribute('uv');
  return g;
}

function lilyFlowerGeometry() {
  const parts = [];
  const petal = (len, wid, tilt, yaw, hex) => {
    const g = new THREE.SphereGeometry(1, 7, 5);
    g.scale(wid, 0.035, len);
    g.translate(0, 0, len * 0.9);
    g.rotateX(-tilt);
    g.rotateY(yaw);
    g.deleteAttribute('uv');
    // pink tips, white base
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const base = new THREE.Color(palette.spots), tip = new THREE.Color(hex);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i)) / (len * 1.8);
      c.copy(base).lerp(tip, THREE.MathUtils.smoothstep(r, 0.35, 1));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  };
  for (let i = 0; i < 8; i++) petal(0.13, 0.055, 0.35, (i / 8) * Math.PI * 2, '#f2a0b8');
  for (let i = 0; i < 6; i++) petal(0.1, 0.045, 0.85, (i / 6) * Math.PI * 2 + 0.3, '#f7c3d2');
  const centre = new THREE.SphereGeometry(0.045, 8, 6);
  centre.scale(1, 0.6, 1);
  centre.translate(0, 0.04, 0);
  centre.deleteAttribute('uv');
  parts.push(tint(centre, palette.autumnYellow));
  return mergeAll(parts);
}

/** Gentle bob for instanced floating things, phase from the instance position. */
function bobbing(material, amp = 0.012) {
  const m = material.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float bobPh = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 1.3;
      #else
        float bobPh = 0.0;
      #endif
      transformed.y += sin(uTime * 1.25 + bobPh) * ${amp.toFixed(4)} + transformed.x * sin(uTime * 0.9 + bobPh) * 0.03;`
    );
  };
  m.customProgramCacheKey = () => `bob-${amp}`;
  return m;
}

export function buildLilies(ctx, rng, avoid) {
  const count = Math.round(16 * Math.max(0.5, ctx.quality?.density ?? 1));
  const spots = [];
  const clusters = [
    { a: 2.35, d: 4.6 },
    { a: 0.25, d: 4.8 },
    { a: 1.35, d: 3.2 },
    { a: 3.6, d: 5.2 },
  ];
  for (let tries = 0; tries < 400 && spots.length < count; tries++) {
    const cl = clusters[tries % clusters.length];
    const a = cl.a + rng.jitter(0.5);
    const d = cl.d + rng.jitter(1.6);
    const x = POND.center.x + Math.cos(a) * d, z = POND.center.z + Math.sin(a) * d;
    if (depthAt(x, z) < 0.25 || avoid(x, z)) continue;
    const s = rng.range(0.32, 0.62);
    if (spots.some((p) => Math.hypot(p.x - x, p.z - z) < (p.s + s) * 1.05)) continue;
    spots.push({ x, z, s, rot: rng.range(0, Math.PI * 2) });
  }
  const padMat = bobbing(materials.toon('#69a94a'));
  const pads = new THREE.InstancedMesh(lilyPadGeometry(), padMat, spots.length);
  const flowersAt = spots.filter((_, i) => i % 3 === 0);
  const flowerMat = bobbing(materials.toon('#ffffff', { vertexColors: true }));
  const flowers = new THREE.InstancedMesh(lilyFlowerGeometry(), flowerMat, Math.max(1, flowersAt.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  spots.forEach((sp, i) => {
    p.set(sp.x, WL + 0.012, sp.z);
    q.setFromAxisAngle(UP, sp.rot);
    sc.set(sp.s, 1, sp.s);
    m.compose(p, q, sc);
    pads.setMatrixAt(i, m);
  });
  flowersAt.forEach((sp, i) => {
    p.set(sp.x + Math.cos(sp.rot) * sp.s * 0.2, WL + 0.05, sp.z - Math.sin(sp.rot) * sp.s * 0.2);
    q.setFromAxisAngle(UP, sp.rot * 3);
    const f = 0.9 + (i % 3) * 0.15;
    sc.set(f, f, f);
    m.compose(p, q, sc);
    flowers.setMatrixAt(i, m);
  });
  flowers.count = flowersAt.length;
  pads.receiveShadow = true;
  pads.castShadow = false;
  flowers.castShadow = false;
  pads.name = 'lily-pads';
  flowers.name = 'lily-flowers';
  ctx.scene.add(pads, flowers);
  return { pads, flowers, spots };
}

// ─── Reeds & cattails ───────────────────────────────────────────────────────
export function buildReeds(ctx, rng, avoid) {
  const density = Math.max(0.45, ctx.quality?.density ?? 1);
  const clumps = Math.round(14 * density);
  const blade = new THREE.ConeGeometry(0.035, 1, 4, 3);
  blade.translate(0, 0.5, 0);
  blade.deleteAttribute('uv');
  // cattail: stem + brown head + tiny spike
  const stem = tint(new THREE.CylinderGeometry(0.014, 0.018, 1.25, 5).translate(0, 0.625, 0), '#6f8f3e');
  const head = tint(new THREE.CapsuleGeometry(0.05, 0.2, 3, 8).translate(0, 1.08, 0), '#7a4a2a');
  const spike = tint(new THREE.CylinderGeometry(0.004, 0.008, 0.16, 4).translate(0, 1.3, 0), '#8a7a4a');
  [stem, head, spike].forEach((g) => g.deleteAttribute('uv'));
  const cattailGeo = mergeAll([stem, head, spike]);

  const blades = [];
  const tails = [];
  for (let c = 0; c < clumps; c++) {
    const a = (c / clumps) * Math.PI * 2 + rng.jitter(0.2);
    const sr = shoreRadius(a);
    const cx = POND.center.x + Math.cos(a) * (sr + rng.range(-0.55, 0.35));
    const cz = POND.center.z + Math.sin(a) * (sr + rng.range(-0.55, 0.35));
    if (avoid(cx, cz)) continue;
    const nBlades = rng.int(8, 14);
    for (let b = 0; b < nBlades; b++) {
      const x = cx + rng.jitter(0.55), z = cz + rng.jitter(0.55);
      blades.push({ x, z, h: rng.range(0.7, 1.55), lean: rng.jitter(0.22), yaw: rng.range(0, 6.28), w: rng.range(0.8, 1.3) });
    }
    const nTails = rng.int(1, 3);
    for (let t = 0; t < nTails; t++) {
      tails.push({ x: cx + rng.jitter(0.35), z: cz + rng.jitter(0.35), h: rng.range(0.85, 1.15), lean: rng.jitter(0.12), yaw: rng.range(0, 6.28) });
    }
  }
  const windMat = materials.toon('#7fa74a', { wind: { strength: 0.1, base: 0.15, speed: 1.9 } });
  const tailMat = materials.toon('#ffffff', { vertexColors: true, wind: { strength: 0.07, base: 0.2, speed: 1.9 } });
  const bladeMesh = new THREE.InstancedMesh(blade, windMat, blades.length);
  const tailMesh = new THREE.InstancedMesh(cattailGeo, tailMat, Math.max(1, tails.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const place = (mesh, list, scaleFn) => {
    list.forEach((it, i) => {
      p.set(it.x, Math.min(getHeight(it.x, it.z), WL + 0.6) - 0.05, it.z);
      e.set(it.lean, it.yaw, it.lean * 0.5);
      q.setFromEuler(e);
      scaleFn(sc, it);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = list.length;
  };
  place(bladeMesh, blades, (s, it) => s.set(it.w, it.h, it.w));
  place(tailMesh, tails, (s, it) => s.set(1, it.h, 1));
  // tint blades individually (a few yellow-green tips of late summer)
  const colours = [new THREE.Color('#ffffff'), new THREE.Color('#e9f0c8'), new THREE.Color('#c9dca0')];
  blades.forEach((_, i) => bladeMesh.setColorAt(i, colours[i % 3]));
  bladeMesh.castShadow = true;
  tailMesh.castShadow = true;
  bladeMesh.name = 'reeds';
  tailMesh.name = 'cattails';
  ctx.scene.add(bladeMesh, tailMesh);
  return { bladeMesh, tailMesh };
}

// ─── Stepping stones, a frog and a duck family ─────────────────────────────
function pebbleGeometry(rng, detail = 1) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + rng.jitter(0.12);
    p.setXYZ(i, p.getX(i) * k, Math.max(p.getY(i) * k, -0.4), p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

export function buildStones(ctx, rng) {
  // A little trail of stones leading from the east bank into the shallows.
  const a0 = -0.15;
  const stones = [];
  for (let i = 0; i < 5; i++) {
    const a = a0 + i * 0.14;
    const sr = shoreRadius(a);
    const d = sr + 0.9 - i * 0.75;
    const x = POND.center.x + Math.cos(a) * d, z = POND.center.z + Math.sin(a) * d;
    const big = i === 4;
    const s = big ? 0.62 : rng.range(0.3, 0.42);
    const top = Math.max(getHeight(x, z), WL) + (big ? 0.12 : 0.07);
    stones.push({ x, z, s, top, big });
  }
  const geo = pebbleGeometry(rng, 1);
  const mesh = new THREE.InstancedMesh(geo, materials.toon(palette.stone), stones.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  stones.forEach((st, i) => {
    const sy = st.s * 0.35;
    p.set(st.x, st.top - sy * 0.6, st.z);
    q.setFromAxisAngle(UP, rng.range(0, 6.28));
    sc.set(st.s, sy, st.s * 0.85);
    m.compose(p, q, sc);
    mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'stepping-stones';
  ctx.scene.add(mesh);
  return { mesh, stones };
}

export function buildFrog(ctx, at) {
  const g = new THREE.Group();
  g.name = 'pond-frog';
  const GREEN = '#7cbf4f';
  const sphere = (r, sx, sy, sz, x, y, z, hex, ws = 10, hs = 7) => {
    const geo = new THREE.SphereGeometry(r, ws, hs);
    geo.scale(sx, sy, sz);
    geo.translate(x, y, z);
    geo.deleteAttribute('uv');
    return tint(geo, hex);
  };
  const parts = [sphere(0.12, 1.1, 0.75, 1.25, 0, 0.08, 0, GREEN, 12, 8)];
  for (const s of [-1, 1]) {
    parts.push(
      sphere(0.045, 1, 1, 1, s * 0.06, 0.16, 0.06, GREEN, 8, 6), // eye bump
      sphere(0.032, 1, 1, 1, s * 0.06, 0.172, 0.08, palette.spots, 8, 6), // white
      sphere(0.016, 1, 1, 1, s * 0.06, 0.176, 0.102, palette.ink, 6, 4), // pupil
      sphere(0.06, 0.7, 0.5, 1.3, s * 0.11, 0.04, -0.05, GREEN, 8, 6), // haunch
      sphere(0.03, 1.4, 0.5, 1, s * 0.09, 0.012, 0.11, GREEN, 6, 4) // front foot
    );
  }
  const body = new THREE.Mesh(mergeAll(parts), materials.toon('#ffffff', { vertexColors: true }));
  const chin = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 6), materials.toon('#e8e2a8'));
  chin.scale.set(1.1, 0.6, 1);
  chin.position.set(0, 0.05, 0.07);
  g.add(body, chin);
  g.scale.setScalar(1.3);
  g.position.set(at.x, at.y, at.z);
  g.rotation.y = at.facing ?? 0;
  ctx.scene.add(g);
  let next = 3;
  return {
    group: g,
    update(t) {
      // breathe, puff the throat, and every few seconds a little hop in place
      body.scale.y = 1 + Math.sin(t * 3.1) * 0.035;
      chin.scale.y = 0.6 + Math.max(0, Math.sin(t * 6.2)) * 0.25;
      const ph = t - next;
      if (ph > 0) {
        const k = Math.min(ph / 0.45, 1);
        g.position.y = at.y + Math.sin(k * Math.PI) * 0.12;
        if (k >= 1) next = t + 3 + ((t * 7.3) % 4);
      }
    },
  };
}

function duckGeometry(scale = 1) {
  const parts = [];
  const body = new THREE.SphereGeometry(0.2, 14, 9);
  body.scale(1.12, 0.6, 1.55);
  body.translate(0, 0.07, -0.02);
  // folded wings make the silhouette read as a duck even from behind
  const wings = [];
  for (const sd of [-1, 1]) {
    const w = new THREE.SphereGeometry(0.13, 10, 7);
    w.scale(0.55, 0.6, 1.5);
    w.rotateY(sd * 0.12);
    w.translate(sd * 0.17, 0.13, -0.06);
    w.deleteAttribute('uv');
    wings.push(tint(w, '#efe2c4'));
  }
  const tail = new THREE.ConeGeometry(0.08, 0.18, 6);
  tail.rotateX(-Math.PI / 2 - 0.7);
  tail.translate(0, 0.16, -0.32);
  const neck = new THREE.CylinderGeometry(0.06, 0.075, 0.16, 8);
  neck.translate(0, 0.19, 0.19);
  const head = new THREE.SphereGeometry(0.1, 12, 8);
  head.scale(1, 0.95, 1.1);
  head.translate(0, 0.29, 0.23);
  const beak = new THREE.ConeGeometry(0.045, 0.13, 6);
  beak.rotateX(Math.PI / 2);
  beak.scale(1.35, 0.55, 1);
  beak.translate(0, 0.27, 0.37);
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.017, 6, 4);
    e.translate(s * 0.07, 0.315, 0.29);
    eyes.push(e);
  }
  neck.deleteAttribute('uv');
  [body, tail, head, beak, ...eyes].forEach((g) => g.deleteAttribute('uv'));
  parts.push(...wings, tint(body, '#fff3d6'), tint(tail, '#fff3d6'), tint(neck, '#fff3d6'), tint(head, '#fff3d6'), tint(beak, '#f0a23a'), ...eyes.map((e) => tint(e, palette.ink)));
  const g = mergeAll(parts);
  g.scale(scale, scale, scale);
  return g;
}

function ducklingGeometry() {
  const g = duckGeometry(0.55);
  // ducklings are yellow
  const col = g.attributes.color;
  const yellow = new THREE.Color('#ffd95a');
  const cream = new THREE.Color('#fff3d6');
  const wing = new THREE.Color('#efe2c4');
  const wingYellow = new THREE.Color('#f2c445');
  for (let i = 0; i < col.count; i++) {
    if (Math.abs(col.getX(i) - cream.r) < 0.02 && Math.abs(col.getY(i) - cream.g) < 0.02) col.setXYZ(i, yellow.r, yellow.g, yellow.b);
    else if (Math.abs(col.getX(i) - wing.r) < 0.02 && Math.abs(col.getY(i) - wing.g) < 0.02) col.setXYZ(i, wingYellow.r, wingYellow.g, wingYellow.b);
  }
  return g;
}

/** A mother duck with ducklings paddling slow loops around the pond. */
export function buildDucks(ctx) {
  const mat = materials.toon('#ffffff', { vertexColors: true });
  const mum = new THREE.Mesh(duckGeometry(1), mat);
  const kids = [0, 1, 2].map(() => new THREE.Mesh(ducklingGeometry(), mat));
  const all = [mum, ...kids];
  all.forEach((m) => {
    m.castShadow = false;
    ctx.scene.add(m);
  });
  mum.name = 'duck';
  const cx = POND.center.x + 0.6, cz = POND.center.z + 0.9;
  const R = 3.1;
  const speed = ctx.engine?.reducedMotion ? 0.04 : 0.11;
  // path: a gently wobbling loop (rad/s along the loop)
  const posAt = (s, out) => {
    const r = R * (1 + 0.18 * Math.sin(s * 2 + 0.6));
    out.set(cx + Math.cos(s) * r * 1.15, WL + 0.02, cz + Math.sin(s) * r);
    return out;
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  function update(t) {
    for (let i = 0; i < all.length; i++) {
      const m = all[i];
      const s = -(t * speed) + i * 0.3 + (i > 0 ? 0.14 : 0);
      posAt(s, a);
      posAt(s + 0.02, b);
      m.position.copy(a);
      m.position.y += Math.sin(t * 2.6 + i) * 0.012;
      m.rotation.y = Math.atan2(a.x - b.x, a.z - b.z);
      m.rotation.z = Math.sin(t * 2.1 + i * 1.7) * 0.05;
    }
  }
  update(0);
  return { meshes: all, update };
}
