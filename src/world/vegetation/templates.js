// ─────────────────────────────────────────────────────────────────────────────
// Plant & scenery templates — every species of the woodland, built from
// rounded primitives. Each function returns a template (see geo.js). Foliage
// parts carry tint = 1 so one template can be a green oak, an autumn maple or
// a blossoming cherry depending on the colour it is stamped with.
// All templates: origin at the base, ground at y = 0, front = +Z.
// Triangle counts matter (thousands of stamps): small things use octahedra,
// few lathe segments and single-triangle blades.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { palette } from '../../core/palette.js';
import {
  TemplateBuilder, blob, lathe, taperedTube, stick, ribbon, disc, normalsUp, place, noise3, smooth,
  latheWobble, profileRadius,
} from './geo.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C = (hex) => new THREE.Color(hex);
const TAU = Math.PI * 2;
const smoothstep = THREE.MathUtils.smoothstep;
const clamp = THREE.MathUtils.clamp;
const WHITE = '#ffffff';

/** Two-tone foliage shade: cool & dark underneath, warm & bright on top. */
function foliageShade(yMin, yMax, { bottom = [0.56, 0.62, 0.72], top = [1, 1, 0.86], speckle = 0, seed = 0 } = {}) {
  const b = C(0).setRGB(...bottom), t = C(0).setRGB(...top);
  return (x, y, z, nx, ny, nz, out) => {
    const hy = clamp((y - yMin) / (yMax - yMin), 0, 1);
    let k = clamp(hy * 0.55 + (ny * 0.5 + 0.5) * 0.45, 0, 1);
    k = k * k * (3 - 2 * k);
    out.copy(b).lerp(t, k);
    if (speckle) out.multiplyScalar(1 - speckle * 0.5 + speckle * noise3(x * 2.3 + seed, y * 2.3, z * 2.3));
  };
}

/**
 * Bark (absolute colour, use with color WHITE): darker at the roots, moss
 * creeping up from the ground on the upward-facing side.
 */
function barkShade(h, mossy = 0, barkHex = palette.bark) {
  const bark = C(barkHex), moss = C(palette.moss);
  return (x, y, z, nx, ny, nz, out) => {
    const k = 0.72 + 0.28 * smoothstep(y, 0, h * 0.7);
    out.copy(bark).multiplyScalar(k);
    if (mossy && y < h * 0.55) {
      const m = (noise3(x * 2, y * 1.5, z * 2) * 0.5 + 0.5) * mossy * (1 - y / (h * 0.55)) * (0.5 + Math.max(0, ny) + Math.max(0, -nz) * 0.4);
      out.lerp(moss, clamp(m, 0, 0.85));
    }
  };
}

/** sway weight grows with height above `from` up to `amount` at `to`. */
const swayUp = (from, to, amount, pow = 1.6) => (x, y) => amount * Math.pow(clamp((y - from) / (to - from), 0, 1), pow);

// ─── Trees ───────────────────────────────────────────────────────────────────

/**
 * Round puffy broadleaf tree (oak / beech / maple / cherry depending on tint).
 * lod 0 = hero, 1 = mid, 2 = far. shape: 'round' | 'tall' | 'wide'.
 * fruit: null | colour → little apples / blossoms dotted over the crown.
 */
export function puffTree(rng, { lod = 0, shape = 'round', fruit = null, fruitCount = 12 } = {}) {
  const b = new TemplateBuilder();
  const seed = rng.range(0, 100);
  const tall = shape === 'tall', wide = shape === 'wide';
  const H = tall ? rng.range(3.6, 4.2) : wide ? rng.range(2.6, 3.1) : rng.range(2.9, 3.5);
  const bendDir = rng.range(0, TAU), bend = rng.range(0.15, 0.5);
  const R = tall ? rng.range(1.8, 2.05) : wide ? rng.range(2.4, 2.7) : rng.range(2.05, 2.35);
  const cx = Math.cos(bendDir) * bend, cz = Math.sin(bendDir) * bend;
  const cy = H + R * (tall ? 0.95 : 0.55);
  const top = cy + R * (tall ? 1.5 : 1.05);
  const sway = swayUp(0.8, top, 0.26);
  const trunkTop = H + 0.6;
  const trunkR = tall ? 0.24 : 0.29;

  b.add(
    lathe([[trunkR * 2.2, 0], [trunkR * 1.45, 0.16], [trunkR * 1.08, 0.55], [trunkR, H * 0.6], [trunkR * 0.75, trunkTop]], {
      segments: lod === 2 ? 5 : 7, bend, bendDir, wobble: 0.1, seed,
    }),
    { color: WHITE, shade: barkShade(H, lod === 0 ? 0.8 : 0), sway }
  );

  const shade = foliageShade(cy - R, top, { speckle: 0.12, seed });
  const detail = lod === 2 ? 0 : 1;
  const blobs = [];
  // main mass
  blobs.push({ r: R, x: cx, y: cy, z: cz, sy: tall ? 1.32 : wide ? 0.78 : 0.92, sx: wide ? 1.12 : 1 });
  const n = lod === 2 ? 2 : lod === 1 ? 3 : tall ? 4 : wide ? 6 : 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.jitter(0.35);
    const e = rng.range(-0.25, 0.55);
    const d = R * rng.range(0.62, 0.82) * (wide ? 1.25 : 1);
    const r = R * rng.range(0.52, 0.68);
    blobs.push({
      r, x: cx + Math.cos(a) * Math.cos(e) * d, y: cy + Math.sin(e) * d * (tall ? 1.5 : 0.85), z: cz + Math.sin(a) * Math.cos(e) * d,
      sy: tall ? 1.15 : 0.9,
    });
  }
  if (lod < 2) blobs.push({ r: R * 0.6, x: cx + rng.jitter(0.4), y: cy + R * (tall ? 1.05 : 0.62), z: cz + rng.jitter(0.4), sy: 0.9 });
  const puff = { center: V(cx, cy, cz), k: 0.45 };
  for (const bl of blobs) {
    b.add(blob(bl.r, { detail, x: bl.x, y: bl.y, z: bl.z, sx: bl.sx ?? 1, sy: bl.sy, sz: bl.sx ?? 1, lump: 0.1, seed: seed + bl.x }), {
      color: WHITE, shade, tint: 1, sway, puff,
    });
  }
  // a couple of branches reaching into the crown
  if (lod === 0) {
    for (let i = 1; i <= 2; i++) {
      const t = blobs[i];
      const from = V(cx * 0.45, H * 0.75, cz * 0.45);
      const to = V(t.x * 0.8 + cx * 0.2, t.y - t.r * 0.3, t.z * 0.8 + cz * 0.2);
      b.add(stick(from, to, 0.12, 0.06, 4), { color: WHITE, shade: barkShade(H), sway });
    }
  }
  if (fruit) {
    const fruitColor = C(fruit);
    for (let i = 0; i < fruitCount; i++) {
      const bl = blobs[1 + (i % (blobs.length - 1))];
      const a = rng.range(0, TAU), e = rng.range(-0.35, 0.9);
      const d = bl.r * 0.97;
      b.add(
        blob(rng.range(0.12, 0.17), {
          octa: true, x: bl.x + Math.cos(a) * Math.cos(e) * d, y: bl.y + Math.sin(e) * d * (bl.sy ?? 1), z: bl.z + Math.sin(a) * Math.cos(e) * d, lump: 0,
        }),
        { color: fruitColor, shade: (x, y, z, nx, ny, nz, out) => out.setScalar(0.85 + 0.15 * ny), sway }
      );
    }
  }
  return b.build({ kind: 'broadleaf', trunkRadius: trunkR * 1.25, crownY: cy, crownR: R * (wide ? 1.5 : 1.25), lod });
}

/** Tall soft fir: stacked droopy skirts. */
export function pineTree(rng, { lod = 0 } = {}) {
  const b = new TemplateBuilder();
  const seed = rng.range(0, 100);
  const tiers = lod === 2 ? 3 : 4;
  const baseY = rng.range(0.9, 1.3);
  const CH = rng.range(7.0, 8.6);
  const R0 = rng.range(2.0, 2.4);
  const top = baseY + CH + 0.5;
  const sway = swayUp(1, top, 0.2, 1.8);
  b.add(lathe([[0.45, 0], [0.3, 0.25], [0.22, baseY + 1], [0.1, top - 1]], { segments: lod === 2 ? 4 : 6, wobble: 0.08, seed }), {
    color: WHITE, shade: barkShade(baseY + 1, lod ? 0 : 0.6, palette.barkDark), sway,
  });
  const segs = lod === 2 ? 6 : lod === 1 ? 7 : 8;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const R = R0 * (1 - t * 0.62) * rng.range(0.94, 1.06);
    const yb = baseY + (CH * 0.86) * (i / tiers);
    const h = (CH / tiers) * 1.75;
    const prof = lod === 2
      ? [[R * 0.25, yb], [R, yb + h * 0.04], [1e-6, yb + h]]
      : lod === 1
        ? [[0.15, yb + h * 0.05], [R, yb], [R * 0.82, yb + h * 0.2], [R * 0.3, yb + h * 0.82], [1e-6, yb + h]]
        : [[0.15, yb + h * 0.05], [R * 0.85, yb - h * 0.05], [R, yb + h * 0.03], [R * 0.82, yb + h * 0.2], [R * 0.48, yb + h * 0.6], [1e-6, yb + h]];
    const geo = lathe(prof, { segments: segs, wobble: lod === 2 ? 0.04 : 0.09, seed: seed + i * 7 });
    place(geo, { ry: rng.range(0, TAU) });
    b.add(geo, {
      color: WHITE, tint: 1, sway,
      shade: (x, y, z, nx, ny, nz, out) => {
        // lighter on the rim and the upper surfaces, dark in the folds underneath
        const rim = clamp(Math.hypot(x, z) / R, 0, 1);
        let k = clamp(0.2 + 0.5 * (ny * 0.5 + 0.5) + 0.35 * rim * rim + 0.15 * t, 0, 1);
        k = k * k * (3 - 2 * k);
        out.setRGB(0.5 + 0.5 * k, 0.56 + 0.44 * k, 0.66 + 0.26 * k);
      },
    });
  }
  return b.build({ kind: 'pine', trunkRadius: 0.32, crownY: baseY + CH * 0.4, crownR: R0, lod });
}

/** Slender white birch with dark bark marks and an airy light crown. */
export function birchTree(rng, { lod = 0, twin = false } = {}) {
  const b = new TemplateBuilder();
  const seed = rng.range(0, 100);
  const trunks = lod === 0 && twin ? 2 : 1;
  const bark = C(palette.plaster);
  const marks = C(palette.ink).lerp(C(palette.stoneDark), 0.3);
  let top = 0;
  const crowns = [];
  for (let k = 0; k < trunks; k++) {
    const H = rng.range(6.4, 7.6) * (k ? 0.82 : 1);
    const bendDir = rng.range(0, TAU), bend = rng.range(0.3, 0.8) * (k ? 1.6 : 1);
    const ox = k ? rng.jitter(0.25) : 0, oz = k ? rng.jitter(0.25) : 0;
    top = Math.max(top, H + 1.6);
    const sway = swayUp(0.5, H + 1.6, 0.3, 1.4);
    const prof = [[0.27, 0], [0.19, 0.25], [0.16, H * 0.5], [0.09, H]];
    const tr = lathe(prof, { segments: lod === 2 ? 4 : 6, bend, bendDir, seed: seed + k });
    place(tr, { x: ox, z: oz });
    b.add(tr, { color: bark, shade: (x, y, z, nx, ny, nz, out) => out.setScalar(0.86 + 0.14 * clamp(y / 2, 0, 1)), sway });
    if (lod === 0) {
      // dark lenticel bands wrapping part of the trunk
      for (let i = 0; i < 6; i++) {
        const y = rng.range(0.4, H * 0.85);
        const r = profileRadius(prof, y) + 0.012;
        const t = (y / H) * (y / H) * bend;
        const g = new THREE.CylinderGeometry(r, r, rng.range(0.05, 0.12), 4, 1, true, rng.range(0, TAU), rng.range(1.2, 2.6));
        place(g, { x: ox + Math.cos(bendDir) * t, y, z: oz + Math.sin(bendDir) * t });
        b.add(g, { color: marks, sway });
      }
    }
    // airy crown: a few small blobs up the top third
    const n = lod === 2 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const f = 0.62 + (i / n) * 0.42;
      const y = H * f + 0.4;
      const t = (y / H) * (y / H) * bend;
      const a = rng.range(0, TAU);
      const d = rng.range(0.3, 0.8);
      const r = rng.range(0.95, 1.3) * (1 - i * 0.08);
      crowns.push({ r, x: ox + Math.cos(bendDir) * t + Math.cos(a) * d, y, z: oz + Math.sin(bendDir) * t + Math.sin(a) * d, sway });
    }
  }
  const shade = foliageShade(top * 0.5, top + 0.8, { bottom: [0.62, 0.68, 0.68], top: [1, 1, 0.82], speckle: 0.15, seed });
  for (const c of crowns) {
    b.add(blob(c.r, { detail: lod === 2 ? 0 : 1, x: c.x, y: c.y, z: c.z, sy: 1.15, lump: 0.14, seed: seed + c.y }), {
      color: WHITE, tint: 1, shade, sway: c.sway,
    });
  }
  return b.build({ kind: 'birch', trunkRadius: 0.25, crownY: top * 0.75, crownR: 1.6, lod });
}

/**
 * Giant ancient tree: gnarly flared trunk, big roots, a huge cloud of a crown
 * and a tiny round door at its foot (someone lives here!).
 */
export function giantTree(rng) {
  const b = new TemplateBuilder();
  const seed = rng.range(0, 100);
  const H = rng.range(7.5, 8.5);
  const top = H + 9;
  const sway = swayUp(4, top, 0.3, 1.8);
  const trunkProfile = [[2.5, -0.2], [1.85, 0.25], [1.55, 0.9], [1.42, 2.4], [1.3, 4.5], [1.2, H - 1], [1.05, H + 0.6]];
  const wob = 0.16;
  const trunkR = (y) => profileRadius(trunkProfile, y) * latheWobble(Math.PI / 2, y, wob, seed);
  // the door niche: on the +Z side the root flare is pressed flat so the door sits flush
  const nicheR = trunkR(1.9);
  const trunk = lathe(trunkProfile, { segments: 20, wobble: wob, seed, bend: 0.4, bendDir: rng.range(0, TAU) });
  {
    const p = trunk.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const da = Math.abs(Math.atan2(x, z)); // 0 = straight +Z
      if (da > 0.62 || y > 2.3 || z <= 0) continue;
      const w = (1 - smoothstep(da, 0.3, 0.62)) * (1 - smoothstep(y, 1.7, 2.3));
      const r = Math.hypot(x, z), rr = Math.min(r, nicheR / Math.max(Math.cos(da), 0.6));
      const k = (r + (rr - r) * w) / r;
      p.setX(i, x * k);
      p.setZ(i, z * k);
    }
    trunk.computeVertexNormals();
  }
  b.add(trunk, { color: WHITE, shade: barkShade(H, 1.0), sway });
  const moss = C(palette.moss), barkC = C(palette.bark);
  const rootShade = (x, y, z, nx, ny, nz, out) => {
    out.copy(barkC).multiplyScalar(0.8 + 0.2 * clamp(y, 0, 1));
    const m = clamp((ny - 0.2) * 1.6 + noise3(x * 1.4, y, z * 1.4) * 0.4, 0, 0.9);
    out.lerp(moss, m * 0.8);
  };
  // roots arching out of the trunk, avoiding the door (+Z)
  const nRoots = 6;
  for (let i = 0; i < nRoots; i++) {
    const a = Math.PI / 2 + 0.75 + (i / (nRoots - 1)) * (TAU - 1.5) + rng.jitter(0.12);
    const ca = Math.cos(a), sa = Math.sin(a);
    const len = rng.range(3.2, 4.4);
    const pts = [V(ca * 1.0, 1.5, sa * 1.0), V(ca * 2.0, 0.95, sa * 2.0), V(ca * (len - 0.6), 0.25, sa * (len - 0.6)), V(ca * len, -0.25, sa * len)];
    b.add(taperedTube(pts, rng.range(0.5, 0.62), 0.12, 6), { color: WHITE, shade: rootShade });
  }
  // the little door (front = +Z): frame, door, knob, step stone
  const doorY = 0.72, doorZ = nicheR;
  const frame = new THREE.CylinderGeometry(0.62, 0.62, 0.16, 16);
  place(frame, { y: doorY, z: doorZ - 0.02, rx: Math.PI / 2, sx: 1, sz: 1.3 });
  b.add(frame, { color: palette.barkDark, shade: (x, y, z, nx, ny, nz, out) => out.setScalar(0.8) });
  const door = new THREE.CylinderGeometry(0.5, 0.5, 0.12, 16);
  place(door, { y: doorY, z: doorZ + 0.04, rx: Math.PI / 2, sz: 1.3 });
  b.add(door, {
    color: palette.door,
    shade: (x, y, z, nx, ny, nz, out) => out.setScalar(Math.abs(Math.sin(x * 14)) < 0.12 ? 0.62 : 1), // plank seams
  });
  b.add(blob(0.06, { octa: true, x: 0.28, y: doorY - 0.05, z: doorZ + 0.12 }), { color: palette.capOchre });
  const step = blob(0.42, { detail: 1, x: 0, y: 0.02, z: doorZ + 0.55, sx: 1.4, sy: 0.32, sz: 0.9, lump: 0.15 });
  b.add(step, { color: palette.stone, shade: (x, y, z, nx, ny, nz, out) => out.setScalar(0.8 + 0.2 * ny) });
  // little round window frame above the door (the glass glows: see vegetation.js)
  const winZ = trunkR(2.55) + 0.02;
  const win = new THREE.TorusGeometry(0.24, 0.06, 5, 12);
  place(win, { y: 2.55, z: winZ });
  b.add(win, { color: palette.windowFrame });

  // branches + crown
  const crownY = H + 4.2;
  const shade = foliageShade(crownY - 4, top, { speckle: 0.14, seed });
  const blobs = [{ r: 4.2, x: 0, y: crownY, z: 0, sy: 0.75 }];
  const ring = 7;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * TAU + rng.jitter(0.2);
    const d = rng.range(4.0, 4.9);
    blobs.push({ r: rng.range(2.5, 3.1), x: Math.cos(a) * d, y: crownY + rng.range(-1.1, 0.4), z: Math.sin(a) * d, sy: 0.8 });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + rng.jitter(0.4);
    blobs.push({ r: rng.range(2.3, 2.8), x: Math.cos(a) * 2.2, y: crownY + rng.range(1.6, 2.4), z: Math.sin(a) * 2.2, sy: 0.85 });
  }
  blobs.push({ r: 2.4, x: rng.jitter(0.5), y: crownY + 3.4, z: rng.jitter(0.5), sy: 0.8 });
  for (let i = 1; i <= 5; i++) {
    const t = blobs[i];
    b.add(taperedTube([V(0, H - 1.5, 0), V(t.x * 0.35, H + 0.6, t.z * 0.35), V(t.x * 0.7, t.y - 1.2, t.z * 0.7)], 0.55, 0.2, 6), {
      color: WHITE, shade: barkShade(H), sway,
    });
  }
  const puff = { center: V(0, crownY, 0), k: 0.4 };
  for (const bl of blobs) {
    b.add(blob(bl.r, { detail: 1, x: bl.x, y: bl.y, z: bl.z, sy: bl.sy, lump: 0.12, seed: seed + bl.x * 3 }), {
      color: WHITE, tint: 1, shade, sway, puff,
    });
  }
  return b.build({
    kind: 'giant', trunkRadius: 1.7, crownY, crownR: 7.5, lod: 0,
    window: { x: 0, y: 2.55, z: winZ + 0.005, r: 0.2 },
  });
}

// ─── Shrubs, rocks & deadwood ────────────────────────────────────────────────

/** Round bush, optionally with berries or tiny blossoms. */
export function bush(rng, { berries = null, count = 10 } = {}) {
  const b = new TemplateBuilder();
  const seed = rng.range(0, 100);
  const n = 3;
  const R = rng.range(0.6, 0.85);
  const blobs = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.jitter(0.5);
    const d = i === 0 ? 0 : R * rng.range(0.55, 0.85);
    const r = i === 0 ? R : R * rng.range(0.62, 0.8);
    blobs.push({ r, x: Math.cos(a) * d, y: r * 0.72, z: Math.sin(a) * d });
  }
  const top = R * 1.7;
  const shade = foliageShade(0, top, { bottom: [0.52, 0.6, 0.68], top: [1, 1, 0.86], speckle: 0.14, seed });
  const sway = swayUp(0.2, top, 0.08);
  const puff = { center: V(0, R * 0.6, 0), k: 0.4 };
  for (const bl of blobs) {
    b.add(blob(bl.r, { detail: 1, x: bl.x, y: bl.y, z: bl.z, sy: 0.85, lump: 0.14, seed: seed + bl.x }), {
      color: WHITE, tint: 1, shade, sway, puff,
    });
  }
  if (berries) {
    const bc = C(berries);
    for (let i = 0; i < count; i++) {
      const bl = blobs[i % blobs.length];
      const a = rng.range(0, TAU), e = rng.range(0.0, 1.1);
      const d = bl.r * 0.97;
      b.add(
        blob(rng.range(0.06, 0.085), {
          octa: true, x: bl.x + Math.cos(a) * Math.cos(e) * d, y: bl.y + Math.sin(e) * d * 0.85, z: bl.z + Math.sin(a) * Math.cos(e) * d, lump: 0,
        }),
        { color: bc, sway }
      );
    }
  }
  return b.build({ kind: 'bush', radius: R * 1.4 });
}

/** Smooth boulder with a mossy cap. */
export function rock(rng, { size = 1, detail = 1, mossy = 0.6 } = {}) {
  const b = new TemplateBuilder();
  const seed = rng.range(0, 100);
  const sx = rng.range(0.9, 1.35), sy = rng.range(0.55, 0.8), sz = rng.range(0.85, 1.2);
  const g = blob(size, { detail, sx, sy, sz, lump: 0.22, seed });
  place(g, { y: size * sy * 0.45, ry: rng.range(0, TAU), rz: rng.jitter(0.12) });
  const stone = C(palette.stone), dark = C(palette.stoneDark), moss = C(palette.moss);
  const tone = rng.range(-0.05, 0.05);
  b.add(g, {
    color: WHITE,
    shade: (x, y, z, nx, ny, nz, out) => {
      out.copy(dark).lerp(stone, clamp(0.35 + ny * 0.5 + noise3(x * 3, y * 3, z * 3) * 0.2, 0, 1)).offsetHSL(0, 0, tone);
      const m = clamp((ny - 0.45) * 2.2 + noise3(x * 1.8 + seed, y * 2, z * 1.8) * 0.8, 0, 1) * mossy;
      out.lerp(moss, m);
    },
  });
  return b.build({ kind: 'rock', radius: size * Math.max(sx, sz) });
}

/** End-grain cap for logs & stumps: concentric growth rings. */
function ringCap(r, rings = 4) {
  return new THREE.RingGeometry(0.001, r, 9, rings);
}
function ringShade(r) {
  const light = C(palette.maple), mid = C(palette.oak), barkC = C(palette.bark);
  return (out, rr) => {
    const t = rr / r;
    if (t > 0.9) out.copy(barkC);
    else out.copy(light).lerp(mid, Math.abs(Math.sin(t * 9.5)) * 0.6 + (t > 0.78 ? 0.4 : 0));
  };
}

/** Fallen mossy log with end-grain caps and two tiny toadstools. */
export function log(rng) {
  const b = new TemplateBuilder();
  const L = rng.range(2.6, 3.6), r = rng.range(0.3, 0.4);
  const cyl = new THREE.CylinderGeometry(r * 0.92, r, L, 8, 3, true);
  // bulge & wobble a little so it is not a perfect tube
  const p = cyl.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = 1 + 0.08 * Math.sin(y * 2.3 + 1) + 0.05 * noise3(p.getX(i) * 3, y * 2, p.getZ(i) * 3);
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  const body = smooth(cyl);
  place(body, { y: r * 0.8, rz: Math.PI / 2 });
  const moss = C(palette.moss), barkC = C(palette.bark);
  b.add(body, {
    color: WHITE,
    shade: (x, y, z, nx, ny, nz, out) => {
      out.copy(barkC).multiplyScalar(0.85 + 0.15 * ny);
      const m = clamp((ny - 0.35) * 2 + noise3(x * 2.2, y, z * 2.2) * 0.7, 0, 1);
      out.lerp(moss, m * 0.9);
    },
  });
  const rs = ringShade(r);
  for (const s of [-1, 1]) {
    const cap = ringCap(r * (s < 0 ? 0.92 : 1), 3);
    place(cap, { x: (s * L) / 2, y: r * 0.8, ry: s * Math.PI / 2 });
    b.add(cap, { color: WHITE, shade: (x, y, z, nx, ny, nz, out) => rs(out, Math.hypot(y - r * 0.8, z)) });
  }
  // a stubby broken branch
  b.add(stick(V(rng.jitter(L * 0.25), r * 1.4, 0), V(rng.jitter(0.4), r * 2.4, rng.jitter(0.3)), 0.1, 0.07, 4), { color: palette.bark });
  // little toadstools growing on top
  for (let i = 0; i < 2; i++) {
    for (const part of toadstoolGeo(rng, rng.range(0.55, 0.8))) {
      place(part.geo, { x: rng.range(-L * 0.35, L * 0.35), y: r * 1.55, z: rng.jitter(0.12), ry: rng.range(0, TAU) });
      b.add(part.geo, part.opts);
    }
  }
  return b.build({ kind: 'log', length: L, radius: r });
}

/** Cut tree stump with growth rings — a Schreiner's favourite sight. */
export function stump(rng) {
  const b = new TemplateBuilder();
  const h = rng.range(0.45, 0.75), r = rng.range(0.42, 0.58);
  b.add(lathe([[r * 1.55, -0.05], [r * 1.15, 0.12], [r, 0.35], [r * 0.98, h]], { segments: 9, wobble: 0.12, seed: rng.range(0, 9) }), {
    color: WHITE, shade: barkShade(h, 0.8),
  });
  const cap = ringCap(r * 0.98, 5);
  place(cap, { y: h, rx: -Math.PI / 2 });
  const rs = ringShade(r);
  b.add(cap, { color: WHITE, shade: (x, y, z, nx, ny, nz, out) => rs(out, Math.hypot(x, z)) });
  return b.build({ kind: 'stump', radius: r * 1.2 });
}

// ─── Mushrooms ───────────────────────────────────────────────────────────────

/** One toadstool as parts (stem + cap + spots); scale s ≈ 1 → ~0.4 tall. */
function toadstoolGeo(rng, s = 1, { spots = 3 } = {}) {
  const h = rng.range(0.22, 0.34) * s;
  const cr = rng.range(0.15, 0.2) * s;
  const lean = rng.jitter(0.25);
  const stem = lathe([[0.065 * s, 0], [0.042 * s, h]], { segments: 5 });
  const cap = lathe([[0.03 * s, h - 0.01 * s], [cr, h + 0.03 * s], [cr * 0.62, h + cr * 0.72], [1e-6, h + cr * 0.92]], { segments: 7 });
  const capShade = C(palette.stemShade);
  const parts = [
    { geo: stem, opts: { color: palette.stem, shade: (x, y, z, nx, ny, nz, out) => out.setScalar(0.85 + 0.15 * (y / h)) } },
    {
      geo: cap,
      opts: {
        color: WHITE, tint: (x, y) => (y < h + 0.012 * s ? 0 : 1),
        shade: (x, y, z, nx, ny, nz, out) => (y < h + 0.012 * s ? out.copy(capShade) : out.setScalar(0.84 + 0.16 * ny)),
      },
    },
  ];
  for (let i = 0; i < spots; i++) {
    const a = (i / spots) * TAU + rng.jitter(0.6), e = rng.range(0.45, 1.0);
    const x = Math.cos(a) * Math.cos(e) * cr * 0.82, z = Math.sin(a) * Math.cos(e) * cr * 0.82;
    const y = h + 0.03 * s + Math.sin(e) * cr * 0.7;
    parts.push({ geo: blob(0.032 * s, { octa: true, x, y, z, sy: 0.45, lump: 0 }), opts: { color: palette.spots } });
  }
  for (const p of parts) place(p.geo, { rz: lean });
  return parts;
}

/** Cluster of 2–3 toadstools (cap colour = tint). */
export function toadstools(rng) {
  const b = new TemplateBuilder();
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) {
    const s = i === 0 ? rng.range(1.1, 1.6) : rng.range(0.55, 1.0);
    const a = rng.range(0, TAU), d = i ? rng.range(0.15, 0.4) : 0;
    for (const part of toadstoolGeo(rng, s, { spots: i === 0 ? 4 : 2 })) {
      place(part.geo, { x: Math.cos(a) * d, z: Math.sin(a) * d, ry: rng.range(0, TAU) });
      b.add(part.geo, part.opts);
    }
  }
  return b.build({ kind: 'toadstools' });
}

/**
 * Glowing mushrooms: only the stems go into the batch; cap geometry is
 * returned separately (world-placed later into one glow mesh).
 */
export function glowShrooms(rng) {
  const b = new TemplateBuilder();
  const caps = [];
  const n = rng.int(3, 5);
  for (let i = 0; i < n; i++) {
    const s = rng.range(0.6, 1.2);
    const a = rng.range(0, TAU), d = i ? rng.range(0.15, 0.45) : 0;
    const h = rng.range(0.25, 0.42) * s;
    const lean = rng.jitter(0.3);
    const stem = lathe([[0.05 * s, 0], [0.035 * s, h]], { segments: 5 });
    place(stem, { rz: lean });
    place(stem, { x: Math.cos(a) * d, z: Math.sin(a) * d });
    b.add(stem, { color: palette.stem });
    const cap = lathe([[0.02 * s, h - 0.02 * s], [0.13 * s, h], [0.1 * s, h + 0.07 * s], [1e-6, h + 0.1 * s]], { segments: 7 });
    place(cap, { rz: lean });
    place(cap, { x: Math.cos(a) * d, z: Math.sin(a) * d });
    caps.push(cap);
  }
  return { template: b.build({ kind: 'glowShrooms' }), caps };
}

// ─── Ground cover ────────────────────────────────────────────────────────────

/**
 * Grass tuft: a fan of single-triangle blades, root colour = the meadow,
 * tips sunny. Normals point up so the tuft shades like the ground it grows on.
 */
export function grassTuft(rng, { blades = 10, height = 0.42, spread = 0.13 } = {}) {
  const b = new TemplateBuilder();
  const pos = [], idx = [];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * TAU + rng.jitter(0.5);
    const h = height * rng.range(0.55, 1.15);
    const lean = rng.range(0.15, 0.45) * h;
    const d = rng.range(0.0, spread);
    const ox = Math.cos(a) * d, oz = Math.sin(a) * d;
    const w = rng.range(0.03, 0.045);
    const sx = -Math.sin(a), sz = Math.cos(a);
    const o = pos.length / 3;
    pos.push(ox - sx * w, 0, oz - sz * w, ox + sx * w, 0, oz + sz * w, ox + Math.cos(a) * lean, h, oz + Math.sin(a) * lean);
    idx.push(o, o + 1, o + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  normalsUp(g, 0.2);
  b.add(g, {
    color: WHITE, tint: 1,
    shade: (x, y, z, nx, ny, nz, out) => {
      const t = clamp(y / height, 0, 1);
      out.setRGB(0.86 + 0.14 * t, 0.88 + 0.12 * t, 0.84 + 0.04 * t);
    },
    sway: (x, y) => 0.13 * (y / height) * (y / height),
  });
  return b.build({ kind: 'grass' });
}

/** Fern: arching fronds with a folded spine. */
export function fern(rng) {
  const b = new TemplateBuilder();
  const n = rng.int(5, 7);
  const L0 = rng.range(0.85, 1.15);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.jitter(0.3);
    const L = L0 * rng.range(0.8, 1.1);
    const rise = rng.range(0.55, 0.8);
    const ca = Math.cos(a), sa = Math.sin(a);
    const spine = (t) => [ca * L * t, L * (rise * t - 0.62 * t * t) + 0.02, sa * L * t];
    const width = (t) => 0.4 * L * Math.sin(Math.PI * Math.min(1, t * 1.05)) * (1 - 0.35 * t) + 0.01;
    b.add(ribbon(spine, width, { segments: 3, fold: 0.35 }), {
      color: WHITE, tint: 1,
      shade: (x, y, z, nx, ny, nz, out) => {
        const t = clamp(Math.hypot(x, z) / L, 0, 1);
        out.setRGB(0.6 + 0.4 * t, 0.66 + 0.34 * t, 0.66 + 0.18 * t);
      },
      sway: (x, y, z) => 0.12 * clamp(Math.hypot(x, z) / L, 0, 1),
    });
  }
  return b.build({ kind: 'fern' });
}

const stemSway = (h) => (x, y) => 0.13 * clamp(y / h, 0, 1) ** 1.5;

/** Flat 2-triangle stem from a to b (the ground material is double-sided). */
function stem(a, b, w = 0.022) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l = Math.hypot(dx, dz);
  // side vector: perpendicular to the lean, or along X for straight stems
  const sx = l > 1e-4 ? -dz / l : 1, sz = l > 1e-4 ? dx / l : 0;
  const pos = [a.x - sx * w, a.y, a.z - sz * w, a.x + sx * w, a.y, a.z + sz * w, b.x - sx * w * 0.6, b.y, b.z - sz * w * 0.6, b.x + sx * w * 0.6, b.y, b.z + sz * w * 0.6];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  g.computeVertexNormals();
  return normalsUp(g, 0.6);
}

/** Simple leaf blades (1 quad each) at the base of flower clumps. */
function addLeaves(b, rng, n, len = 0.3, color = palette.leaf) {
  const pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU), ca = Math.cos(a), sa = Math.sin(a);
    const L = len * rng.range(0.7, 1.2), w = 0.06;
    const o = pos.length / 3;
    pos.push(-sa * w, 0, ca * w, sa * w, 0, -ca * w, ca * L * 0.5, L * 0.45, sa * L * 0.5, ca * L, L * 0.2, sa * L);
    idx.push(o, o + 1, o + 2, o + 2, o + 1, o + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  normalsUp(g, 0.4);
  b.add(g, { color, shade: (x, y, z, nx, ny, nz, out) => out.setScalar(0.8 + 0.2 * clamp(y / (len * 0.4), 0, 1)), sway: stemSway(0.5) });
}

/** A flat star of petals (alternating radius fan) facing +Y. */
function petalStar(petals, r0, r1, cup = 0.012) {
  const pos = [0, cup, 0], idx = [];
  const P = petals * 2;
  for (let k = 0; k < P; k++) {
    const ang = (k / P) * TAU;
    const r = k % 2 ? r1 : r0;
    pos.push(Math.cos(ang) * r, 0, Math.sin(ang) * r);
  }
  for (let k = 0; k < P; k++) idx.push(0, 1 + ((k + 1) % P), 1 + k);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Daisy clump: white star petals, golden hearts. */
export function daisies(rng) {
  const b = new TemplateBuilder();
  const n = rng.int(3, 4);
  addLeaves(b, rng, 3, 0.22);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU), d = rng.range(0, 0.22);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = rng.range(0.22, 0.42);
    const tx = x + rng.jitter(0.06);
    b.add(stem(V(x, 0, z), V(tx, h, z)), { color: palette.grassDark, sway: stemSway(h) });
    const petals = petalStar(6, 0.12, 0.05);
    place(petals, { x: tx, y: h, z, rx: rng.jitter(0.4), rz: rng.jitter(0.4) });
    b.add(petals, { color: palette.spots, sway: stemSway(h) });
    b.add(blob(0.04, { octa: true, x: tx, y: h + 0.015, z, sy: 0.6, lump: 0 }), { color: palette.autumnYellow, sway: stemSway(h) });
  }
  return b.build({ kind: 'flower' });
}

/** Poppies: red cups with dark hearts. */
export function poppies(rng) {
  const b = new TemplateBuilder();
  const n = rng.int(2, 3);
  addLeaves(b, rng, 3, 0.28, palette.grassDark);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU), d = rng.range(0, 0.25);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = rng.range(0.38, 0.62);
    const tx = x + rng.jitter(0.08), tz = z + rng.jitter(0.08);
    b.add(stem(V(x, 0, z), V(tx, h, tz)), { color: palette.grassDark, sway: stemSway(h) });
    const cup = lathe([[0.025, 0], [0.1, 0.06], [0.13, 0.11]], { segments: 6, wobble: 0.25, seed: i });
    place(cup, { x: tx, y: h - 0.02, z: tz, rx: rng.jitter(0.3), rz: rng.jitter(0.3) });
    b.add(cup, { color: palette.swissRed, shade: (X, y, Z, nx, ny, nz, out) => out.setScalar(0.85 + 0.15 * Math.abs(ny)), sway: stemSway(h) });
    b.add(blob(0.035, { octa: true, x: tx, y: h + 0.02, z: tz, lump: 0 }), { color: palette.ink, sway: stemSway(h) });
  }
  return b.build({ kind: 'flower' });
}

/** Lavender: upright stems with purple spikes. */
export function lavender(rng) {
  const b = new TemplateBuilder();
  const n = rng.int(6, 8);
  const purple = C(palette.capLavender).lerp(C('#7b5fb0'), 0.35);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU), d = rng.range(0, 0.18);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = rng.range(0.45, 0.7);
    const tx = x * 2.2 + rng.jitter(0.05), tz = z * 2.2 + rng.jitter(0.05);
    b.add(stem(V(x, 0, z), V(tx, h, tz)), { color: palette.moss, sway: stemSway(h) });
    b.add(blob(0.05, { octa: true, x: tx, y: h + 0.08, z: tz, sy: 2.6, lump: 0 }), {
      color: purple, shade: (X, y, Z, nx, ny, nz, out) => out.setScalar(0.8 + 0.2 * ny), sway: stemSway(h),
    });
  }
  // silvery leaves at the base
  addLeaves(b, rng, 3, 0.22, C(palette.moss).lerp(C(palette.stone), 0.35));
  return b.build({ kind: 'flower' });
}

/** Buttercups: small shiny yellow cups on thin stems. */
export function buttercups(rng) {
  const b = new TemplateBuilder();
  const n = rng.int(4, 5);
  addLeaves(b, rng, 3, 0.2);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU), d = rng.range(0, 0.3);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = rng.range(0.2, 0.38);
    b.add(stem(V(x, 0, z), V(x * 1.2, h, z * 1.2)), { color: palette.grass, sway: stemSway(h) });
    const cup = lathe([[0.012, 0], [0.065, 0.055]], { segments: 5 });
    place(cup, { x: x * 1.2, y: h - 0.01, z: z * 1.2 });
    b.add(cup, { color: palette.postYellow, shade: (X, y, Z, nx, ny, nz, out) => out.setScalar(0.85 + 0.15 * Math.abs(ny)), sway: stemSway(h) });
  }
  return b.build({ kind: 'flower' });
}

/** Bluebells: arching stems with nodding bells. */
export function bluebells(rng) {
  const b = new TemplateBuilder();
  const n = 3;
  const blue = C(palette.clothes[6]).lerp(C(palette.capLavender), 0.45);
  addLeaves(b, rng, 3, 0.28, palette.leafDark);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU), ca = Math.cos(a), sa = Math.sin(a);
    const h = rng.range(0.35, 0.5);
    const spine = (t) => V(ca * 0.16 * t * t, h * Math.sin(t * Math.PI * 0.5), sa * 0.16 * t * t);
    b.add(stem(spine(0), spine(0.6)), { color: palette.grassDark, sway: stemSway(h) });
    b.add(stem(spine(0.6), spine(1), 0.016), { color: palette.grassDark, sway: stemSway(h) });
    for (let k = 0; k < 3; k++) {
      const p = spine(0.55 + k * 0.2);
      const bell = lathe([[1e-6, 0.075], [0.035, 0.055], [0.05, 0]], { segments: 5 });
      place(bell, { x: p.x + ca * 0.02, y: p.y - 0.075, z: p.z + sa * 0.02 });
      b.add(bell, { color: blue, sway: stemSway(h) });
    }
  }
  return b.build({ kind: 'flower' });
}

/** Dandelions: a mix of yellow heads and white seed clocks. */
export function dandelions(rng) {
  const b = new TemplateBuilder();
  const n = rng.int(2, 3);
  addLeaves(b, rng, 4, 0.24, palette.leaf);
  for (let i = 0; i < n; i++) {
    const x = rng.jitter(0.1), z = rng.jitter(0.1);
    const h = rng.range(0.3, 0.5);
    b.add(stem(V(x, 0, z), V(x * 1.5, h, z * 1.5)), { color: palette.grassLight, sway: stemSway(h) });
    if (i === 0 || rng.chance(0.4)) {
      // seed clock
      b.add(blob(0.09, { detail: 0, x: x * 1.5, y: h + 0.07, z: z * 1.5, lump: 0.1, seed: i * 3 }), {
        color: palette.spots, shade: (X, y, Z, nx, ny, nz, out) => out.setScalar(0.88 + 0.12 * ny), sway: stemSway(h),
      });
    } else {
      const head = petalStar(7, 0.075, 0.05, 0.025);
      place(head, { x: x * 1.5, y: h + 0.01, z: z * 1.5 });
      b.add(head, { color: palette.postYellow, sway: stemSway(h) });
    }
  }
  return b.build({ kind: 'flower' });
}

/** Clover patch: low three-leaf clovers with a few pink-white flower balls. */
export function clover(rng) {
  const b = new TemplateBuilder();
  const n = rng.int(6, 8);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU), d = Math.sqrt(rng.next()) * 0.42;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = rng.range(0.05, 0.13);
    const rot = rng.range(0, TAU);
    for (let k = 0; k < 3; k++) {
      const la = rot + (k / 3) * TAU;
      const leaf = disc(0.05, 4, { sx: 1.25, sz: 1 });
      place(leaf, { x: x + Math.cos(la) * 0.05, y: h, z: z + Math.sin(la) * 0.05, ry: -la, rz: 0.25 });
      b.add(leaf, { color: WHITE, tint: 1, shade: (X, y, Z, nx, ny, nz, out) => out.setScalar(0.92), sway: 0.02 });
    }
  }
  const flowerC = C(palette.spots).lerp(C(palette.capCoral), 0.25);
  for (let i = 0; i < rng.int(1, 2); i++) {
    const x = rng.jitter(0.3), z = rng.jitter(0.3), h = rng.range(0.14, 0.2);
    b.add(stem(V(x, 0, z), V(x, h, z)), { color: palette.grassDark, sway: stemSway(h) });
    b.add(blob(0.045, { octa: true, x, y: h + 0.02, z, lump: 0 }), { color: flowerC, sway: stemSway(h) });
  }
  return b.build({ kind: 'clover' });
}

/** Pond reeds with a couple of cattails. */
export function reeds(rng) {
  const b = new TemplateBuilder();
  const n = rng.int(7, 10);
  const pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU), ca = Math.cos(a), sa = Math.sin(a);
    const h = rng.range(0.9, 1.7);
    const lean = rng.range(0.05, 0.3);
    const ox = rng.jitter(0.15), oz = rng.jitter(0.15);
    const w = 0.07;
    const o = pos.length / 3;
    pos.push(ox - sa * w, 0, oz + ca * w, ox + sa * w, 0, oz - ca * w, ox + ca * lean * 0.3 - sa * w * 0.6, h * 0.55, oz + sa * lean * 0.3 + ca * w * 0.6,
      ox + ca * lean * 0.3 + sa * w * 0.6, h * 0.55, oz + sa * lean * 0.3 - ca * w * 0.6, ox + ca * lean, h, oz + sa * lean);
    idx.push(o, o + 1, o + 2, o + 2, o + 1, o + 3, o + 2, o + 3, o + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  normalsUp(g, 0.5);
  b.add(g, {
    color: WHITE, tint: 1,
    shade: (x, y, z, nx, ny, nz, out) => out.setRGB(0.6 + 0.4 * clamp(y / 1.5, 0, 1), 0.65 + 0.35 * clamp(y / 1.5, 0, 1), 0.65 + 0.2 * clamp(y / 1.5, 0, 1)),
    sway: (x, y) => 0.14 * (y / 1.6) ** 1.5,
  });
  for (let i = 0; i < rng.int(1, 3); i++) {
    const ox = rng.jitter(0.2), oz = rng.jitter(0.2);
    const h = rng.range(1.2, 1.6);
    b.add(stem(V(ox, 0, oz), V(ox, h + 0.3, oz)), { color: palette.moss, sway: (x, y) => 0.14 * (y / 1.6) ** 1.5 });
    const head = new THREE.CapsuleGeometry(0.05, 0.22, 2, 5);
    place(head, { x: ox, y: h, z: oz });
    b.add(head, { color: palette.capBrown, shade: (x, y, z, nx, ny, nz, out) => out.setScalar(0.75 + 0.25 * (ny * 0.5 + 0.5)), sway: (x, y) => 0.14 * (y / 1.6) ** 1.5 });
  }
  return b.build({ kind: 'reeds' });
}

/** A scatter of fallen leaves (tinted), lying on the ground. */
export function fallenLeaves(rng, { count = 9, spread = 1.1 } = {}) {
  const b = new TemplateBuilder();
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, TAU), d = Math.sqrt(rng.next()) * spread;
    const leaf = disc(0.075, 4, { sx: 1.7, sz: 1 });
    place(leaf, { x: Math.cos(a) * d, y: 0.02 + i * 0.002, z: Math.sin(a) * d, ry: rng.range(0, TAU), rx: rng.jitter(0.2) });
    const k = rng.range(0.75, 1);
    b.add(leaf, { color: WHITE, tint: 1, shade: (X, y, Z, nx, ny, nz, out) => out.setScalar(k) });
  }
  return b.build({ kind: 'leaves' });
}

/** Pebble cluster for path edges. */
export function pebbles(rng) {
  const b = new TemplateBuilder();
  const n = rng.int(2, 4);
  const stone = C(palette.stone), dark = C(palette.stoneDark);
  for (let i = 0; i < n; i++) {
    const r = rng.range(0.07, 0.15);
    const g = blob(r, { octa: i % 2 === 0, detail: 0, x: rng.jitter(0.3), y: r * 0.25, z: rng.jitter(0.3), sx: rng.range(1, 1.4), sy: 0.55, lump: 0.2, seed: i });
    const tone = rng.range(0, 1);
    b.add(g, { color: WHITE, shade: (x, y, z, nx, ny, nz, out) => out.copy(dark).lerp(stone, 0.4 + 0.4 * tone + 0.2 * ny) });
  }
  return b.build({ kind: 'pebbles' });
}
