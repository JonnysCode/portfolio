// ─────────────────────────────────────────────────────────────────────────────
// Wooden signs with painted text (Fredoka on a wood-grain canvas, auto-fitted).
//
//   makeSign({ text: 'Schreinerei', style: 'post' })        plank on one or two posts
//   makeSign({ text: 'Notices', style: 'board' })           notice board with a little roof
//   makeSign({ text: 'Café', style: 'hanging' })            swings from a bracket on chains
//   makeSign({ text: 'Pond', style: 'arrow' })              pointy plank on a post
//   makeSignpost([{ text: 'Schreinerei', angle, color }])   one post, many arrows
//
// Text faces are double-sided (readable from behind) and every face of a sign
// shares ONE canvas texture (an atlas for signposts) → 1 extra draw call.
// Text is drawn at ~420 px per world unit with mipmaps + anisotropy (crisp).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { materials } from '../core/materials.js';
import { palette } from '../core/palette.js';
import { createRng } from '../core/rng.js';
import { Parts, xf, grainUV, groupFor, shade, opt, strut, invert } from './util.js';
import { makeTextTexture, paintWood, drawFittedText, canvasTexture, FONT_DISPLAY, fontWeight, whenFontsReady } from './text.js';
import { registerAnimated, propsSettings } from './ticker.js';

export { makeTextTexture };

const PX_PER_UNIT = 420;
const MAX_TEX = 2048;

/** Light or dark text depending on the background colour. */
function autoInk(bg) {
  const c = new THREE.Color(bg);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // linear
  return lum > 0.22 ? palette.ink : '#fff6e4';
}

/** Wood colour (species name or colour) → hex. */
const woodHex = (w) => palette[w] || w;

/**
 * Paint text panels into one atlas canvas. panels: [{ w, h (world units), text, wood, paint, textColor,
 * align, padX }] → { texture, rects: [{ u0, v0, u1, v1 }] }.
 */
function textAtlas(panels, seed = 'sign') {
  const ppu = Math.min(PX_PER_UNIT, MAX_TEX / Math.max(...panels.map((p) => p.w)));
  const pxW = Math.ceil(Math.max(...panels.map((p) => p.w)) * ppu);
  const rows = panels.map((p) => Math.ceil(p.h * ppu));
  const pxH = Math.min(MAX_TEX, rows.reduce((a, b) => a + b + 4, 0));
  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  const g = canvas.getContext('2d');
  const rects = [];
  const draw = () => {
    let y = 0;
    rects.length = 0;
    panels.forEach((p, i) => {
      const w = Math.ceil(p.w * ppu), h = rows[i];
      g.save();
      g.translate(0, y);
      g.beginPath();
      g.rect(0, 0, w, h);
      g.clip();
      paintWood(g, w, h, { color: woodHex(p.wood ?? 'spruce'), planks: p.planks ?? 1, seed: `${seed}-${i}`, painted: p.paint ?? null });
      const ink = p.textColor ?? autoInk(p.paint ?? woodHex(p.wood ?? 'spruce'));
      const padY = h * (p.padY ?? 0.16);
      const padX = p.padX !== undefined ? p.padX * w : Math.max(h * 0.25, w * 0.05);
      const x0 = p.textX0 !== undefined ? p.textX0 * w : padX;
      const x1 = p.textX1 !== undefined ? p.textX1 * w : w - padX;
      drawFittedText(g, String(p.text ?? '').split('\n'), { x: x0, y: padY, w: x1 - x0, h: h - padY * 2 }, {
        color: ink,
        style: p.carved ? 'carved' : 'paint',
        weight: p.weight ?? 600,
        font: p.font ?? FONT_DISPLAY,
      });
      g.restore();
      rects.push({ u0: 0, u1: w / pxW, v0: 1 - (y + h) / pxH, v1: 1 - y / pxH });
      y += h + 4;
    });
  };
  draw();
  const texture = canvasTexture(canvas);
  // web fonts (Fredoka / Patrick Hand): redraw once they are in, should they not be yet
  const specs = panels.map((p) => `${fontWeight(p.font ?? FONT_DISPLAY, p.weight ?? 600)} 32px ${p.font ?? FONT_DISPLAY}`);
  whenFontsReady(specs, panels.map((p) => p.text ?? '').join(''), () => {
    draw();
    texture.needsUpdate = true;
  });
  return { texture, rects };
}

/** Map a geometry's XY bbox onto an atlas rect (optionally mirrored for back faces). */
function mapUV(geo, rect, mirror = false) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    let u = (pos.getX(i) - b.min.x) / (b.max.x - b.min.x || 1);
    const v = (pos.getY(i) - b.min.y) / (b.max.y - b.min.y || 1);
    if (mirror) u = 1 - u;
    uv[i * 2] = rect.u0 + u * (rect.u1 - rect.u0);
    uv[i * 2 + 1] = rect.v0 + v * (rect.v1 - rect.v0);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Merge text faces into one mesh using the atlas texture. */
function facesMesh(faces, texture) {
  const list = faces.map((g) => {
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.index) {
      const n = g.attributes.position.count;
      g.setIndex([...Array(n).keys()]);
    }
    return g;
  });
  const merged = list.length === 1 ? list[0] : mergeList(list);
  const mesh = new THREE.Mesh(merged, materials.toon('#ffffff', { map: texture }));
  mesh.name = 'sign-text';
  mesh.receiveShadow = true;
  return mesh;
}

function mergeList(list) {
  // tiny local merge (avoids importing BufferGeometryUtils here twice)
  let vCount = 0, iCount = 0;
  for (const g of list) {
    vCount += g.attributes.position.count;
    iCount += g.index.count;
  }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo;
    vo += g.attributes.position.count;
    io += ia.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** Plank body (rounded box) + front/back face planes for a rectangular board. */
function addBoard(P, faces, rect, { w, h, d = 0.08, x = 0, y = 0, z = 0, ry = 0, color, doubleSided = true, nails = true }) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
  const body = new RoundedBoxGeometry(w, h, d, 2, Math.min(0.03, d * 0.4));
  grainUV(body, 'x');
  P.add('wood', body.applyMatrix4(m), color);
  const inset = 0.03;
  const front = new THREE.PlaneGeometry(w - inset * 2, h - inset * 2);
  mapUV(front, rect);
  front.translate(0, 0, d / 2 + 0.002);
  faces.push(front.applyMatrix4(m));
  if (doubleSided) {
    const back = new THREE.PlaneGeometry(w - inset * 2, h - inset * 2);
    mapUV(back, rect);
    back.rotateY(Math.PI);
    back.translate(0, 0, -d / 2 - 0.002);
    faces.push(back.applyMatrix4(m));
  }
  if (nails) {
    for (const sx of [-1, 1]) {
      const n = new THREE.SphereGeometry(0.018, 6, 3);
      n.scale(1, 1, 0.5);
      n.translate(sx * (w / 2 - 0.07), 0, d / 2 + 0.006);
      P.add('detail', n.applyMatrix4(m), '#4a4038');
    }
  }
}

/** Arrow plank pointing to local +X: shape, body and both faces. */
function addArrow(P, faces, rect, { len, h = 0.3, d = 0.07, color, matrix }) {
  const tip = h * 0.55;
  const s = new THREE.Shape();
  s.moveTo(0, -h / 2);
  s.lineTo(len - tip, -h / 2);
  s.lineTo(len, 0);
  s.lineTo(len - tip, h / 2);
  s.lineTo(0, h / 2);
  s.lineTo(0.09, 0); // swallow-tail notch
  s.lineTo(0, -h / 2);
  const body = new THREE.ExtrudeGeometry(s, { depth: d - 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.014, bevelSegments: 1, curveSegments: 1 });
  body.translate(0, 0, -(d - 0.03) / 2);
  grainUV(body, 'x');
  P.add('wood', body.applyMatrix4(matrix), color);
  const faceShape = new THREE.ShapeGeometry(s);
  const front = faceShape.clone();
  mapUV(front, rect);
  front.translate(0, 0, d / 2 + 0.003);
  faces.push(front.applyMatrix4(matrix));
  // back face: same outline facing −Z, text mirrored so it reads correctly from behind
  const back = faceShape;
  mapUV(back, rect, true);
  invert(back);
  back.translate(0, 0, -d / 2 - 0.003);
  faces.push(back.applyMatrix4(matrix));
  // nail where it meets the post
  const n = new THREE.SphereGeometry(0.02, 6, 3);
  n.scale(1, 1, 0.5);
  P.add('detail', n.translate(0.06, 0, d / 2 + 0.008).applyMatrix4(matrix), '#4a4038');
}

function addPost(P, { x = 0, z = 0, h, r = 0.075, color = palette.walnut, cap = 'point' }) {
  const post = new THREE.CylinderGeometry(r * 0.92, r, h, 7, 1);
  post.translate(x, h / 2, z);
  grainUV(post, 'y');
  P.add('wood', post, color);
  if (cap === 'point') P.add('wood', grainUV(new THREE.ConeGeometry(r, r * 1.4, 7), 'y').translate(x, h + r * 0.7, z), shade(color, -0.04));
  else if (cap === 'ball') P.add('wood', new THREE.SphereGeometry(r * 1.25, 10, 8).translate(x, h + r * 0.9, z), shade(color, 0.04));
  else if (cap === 'roof') {
    const roof = new THREE.ConeGeometry(r * 3.2, r * 2.4, 4, 1);
    roof.rotateY(Math.PI / 4);
    P.add('paint', roof.translate(x, h + r * 1.1, z), palette.capRed);
    P.add('detail', new THREE.SphereGeometry(r * 0.5, 6, 4).translate(x, h + r * 2.4, z), palette.spots);
  }
  // a grass tuft-ish dark ring where it enters the ground
  P.add('detail', new THREE.CylinderGeometry(r * 1.5, r * 1.9, 0.06, 7).translate(x, 0.03, z), palette.dirtDark);
}

/**
 * A wooden sign.
 * @param {object} opts
 * @param {string} opts.text                    ('\n' for several lines)
 * @param {'post'|'board'|'hanging'|'arrow'} [opts.style='post']
 * @param {number} [opts.width=2]               plank width (arrow: length)
 * @param {number} [opts.height]                plank height (auto from width & line count)
 * @param {string} [opts.wood='spruce']         plank species/colour   @param {string} [opts.postWood='walnut']
 * @param {string} [opts.color]                 paint colour washed over the plank (e.g. a district colour)
 * @param {string} [opts.textColor]             (auto contrast by default)
 * @param {boolean} [opts.carved]               engraved instead of painted letters
 * @param {number} [opts.boardY]                height of the plank centre (post / arrow)
 * @param {boolean} [opts.bracket=true]         hanging: include the post + bracket (false → origin at the hook, for walls)
 * @param {'right'|'left'} [opts.direction]     arrow direction
 * @param {number} [opts.notes=4]               board: pinned paper notes
 * @param {boolean} [opts.doubleSided=true]
 * @returns {THREE.Group} userData: { width, height, face: Mesh (the text mesh) }
 */
export function makeSign(opts = {}) {
  const style = opt(opts, 'style', 'post');
  const text = String(opts.text ?? '');
  const lines = text.split('\n').length;
  const width = opt(opts, 'width', 2);
  const wood = opt(opts, 'wood', 'spruce');
  const postWood = woodHex(opt(opts, 'postWood', 'walnut'));
  const plankColor = opts.color ?? woodHex(wood);
  const seed = String(opts.seed ?? text);
  const rng = createRng(seed);
  const P = new Parts();
  const faces = [];
  const g = new THREE.Group();
  g.name = `sign:${style}`;
  let boardH;

  if (style === 'arrow') {
    const h = opt(opts, 'height', 0.34 * Math.max(1, lines * 0.8));
    const len = width;
    const tf = (h * 0.55) / len + 0.02;
    const { texture, rects } = textAtlas([{ w: len, h, text, wood, paint: opts.color, textColor: opts.textColor, carved: opts.carved, textX0: tf, textX1: 1 - tf }], seed);
    const boardY = opt(opts, 'boardY', 1.35);
    addPost(P, { h: boardY + h / 2 + 0.16, color: postWood, cap: 'ball', rng });
    const dir = opts.direction === 'left' ? Math.PI : 0;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(0, boardY, 0.0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, dir, 0)), new THREE.Vector3(1, 1, 1));
    m.multiply(new THREE.Matrix4().makeTranslation(-0.12, 0, 0.11));
    addArrow(P, faces, rects[0], { len, h, color: plankColor, matrix: m });
    g.add(groupFor(P.finish(), { name: 'sign' }));
    g.add(facesMesh(faces, texture));
    boardH = h;
  } else if (style === 'board') {
    // notice board: two posts, a planked board, a header with the text, a little roof
    const w = width;
    const bh = opt(opts, 'height', w * 0.55);
    const headerH = Math.max(0.26, w * 0.13) * Math.max(1, lines * 0.8);
    const y0 = 0.55;
    const top = y0 + bh + headerH + 0.06;
    const { texture, rects } = textAtlas([{ w: w + 0.1, h: headerH, text, wood, paint: opts.color, textColor: opts.textColor, carved: opts.carved }], seed);
    for (const sx of [-1, 1]) addPost(P, { x: sx * (w / 2 + 0.02), z: -0.08, h: top + 0.12, color: postWood, cap: 'none', rng });
    // backing planks
    const back = new RoundedBoxGeometry(w, bh, 0.07, 2, 0.02);
    grainUV(back, 'x');
    P.add('wood', back.translate(0, y0 + bh / 2, 0), shade(woodHex(wood), -0.05));
    // cork-ish inner panel + frame battens
    P.add('paint', new THREE.BoxGeometry(w - 0.16, bh - 0.16, 0.02).translate(0, y0 + bh / 2, 0.04), '#c9a26b');
    for (const [fx, fy, fw, fh] of [[0, y0 + 0.04, w, 0.08], [0, y0 + bh - 0.04, w, 0.08], [-w / 2 + 0.04, y0 + bh / 2, 0.08, bh], [w / 2 - 0.04, y0 + bh / 2, 0.08, bh]]) {
      P.add('wood', grainUV(new THREE.BoxGeometry(fw, fh, 0.05), fw > fh ? 'x' : 'y').translate(fx, fy, 0.05), shade(woodHex(wood), -0.12));
    }
    // pinned notes
    const notes = opt(opts, 'notes', 4);
    const noteColors = [palette.paper, '#fff3b0', '#d8f0e0', '#ffe0e0', palette.paper];
    for (let i = 0; i < notes; i++) {
      const nw = rng.range(0.22, 0.34), nh = rng.range(0.24, 0.36);
      const nx = -w / 2 + 0.2 + ((i + 0.5) / notes) * (w - 0.4) + rng.jitter(0.05);
      const ny = y0 + bh * rng.range(0.32, 0.68);
      const note = new THREE.PlaneGeometry(nw, nh);
      xf(note, [nx, ny, 0.056 + i * 0.001], [0, 0, rng.jitter(0.15)]);
      P.add('detail', note, noteColors[i % noteColors.length]);
      for (let l = 0; l < 3; l++) {
        const line = new THREE.PlaneGeometry(nw * 0.7, 0.012);
        xf(line, [nx, ny + nh * 0.2 - l * nh * 0.2, 0.058 + i * 0.001], [0, 0, rng.jitter(0.15)]);
        P.add('detail', line, '#b9b1a3');
      }
      P.add('detail', new THREE.SphereGeometry(0.02, 6, 4).translate(nx, ny + nh / 2 - 0.04, 0.07), rng.pick([palette.swissRed, palette.capTeal, palette.postYellow]));
    }
    // header plank with text
    addBoard(P, faces, rects[0], { w: w + 0.1, h: headerH, d: 0.08, y: y0 + bh + headerH / 2 + 0.03, z: 0.02, color: plankColor, doubleSided: false });
    // little gabled roof
    const roofW = w + 0.5;
    for (const s of [-1, 1]) {
      const plank = new THREE.BoxGeometry(roofW, 0.04, 0.38);
      grainUV(plank, 'x');
      xf(plank, [0, top + 0.12 + 0.08, s * 0.15], [s * 0.5, 0, 0]);
      P.add('wood', plank, palette.roofShingle);
    }
    P.add('wood', grainUV(new THREE.BoxGeometry(roofW + 0.04, 0.06, 0.06), 'x').translate(0, top + 0.31, 0), shade(palette.roofShingle, -0.1));
    g.add(groupFor(P.finish(), { name: 'sign' }));
    g.add(facesMesh(faces, texture));
    boardH = bh + headerH;
  } else if (style === 'hanging') {
    const w = width;
    const h = opt(opts, 'height', w * 0.42 * Math.max(1, lines * 0.75));
    const { texture, rects } = textAtlas([{ w, h, text, wood, paint: opts.color, textColor: opts.textColor, carved: opts.carved }], seed);
    const bracket = opt(opts, 'bracket', true);
    const armY = opt(opts, 'boardY', 1.55) + h / 2 + 0.35;
    const pivot = new THREE.Group();
    const SP = new Parts();
    const sfaces = [];
    // chains (little links) + the board, built relative to the pivot (hook line)
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const link = new THREE.TorusGeometry(0.03, 0.008, 4, 8);
        link.scale(1, 1.5, 1);
        if (k % 2) link.rotateY(Math.PI / 2);
        SP.add('detail', link.translate(sx * (w / 2 - 0.12), -0.05 - k * 0.075, 0), palette.metalDark);
      }
    }
    addBoard(SP, sfaces, rects[0], { w, h, d: 0.07, y: -0.33 - h / 2, color: plankColor, nails: true });
    pivot.add(groupFor(SP.finish(), { name: 'sign-board' }));
    pivot.add(facesMesh(sfaces, texture));
    if (bracket) {
      const armLen = w + 0.45;
      addPost(P, { x: -armLen / 2 - 0.05, h: armY + 0.25, color: postWood, cap: 'ball', rng });
      // arm + diagonal brace + scroll
      P.add('wood', grainUV(new THREE.BoxGeometry(armLen + 0.1, 0.09, 0.09), 'x').translate(0, armY, 0), postWood);
      P.add('wood', strut([-armLen / 2 - 0.05, armY - 0.5, 0], [-armLen / 2 + 0.45, armY - 0.02, 0], 0.035, 0.035, 5), postWood);
      for (const sx of [-1, 1]) P.add('detail', new THREE.TorusGeometry(0.035, 0.01, 4, 8).translate(sx * (w / 2 - 0.12), armY - 0.07, 0), palette.metalDark);
      pivot.position.set(0, armY - 0.07, 0);
      g.add(groupFor(P.finish(), { name: 'sign' }));
    }
    g.add(pivot);
    const ph = rng.next() * 6;
    registerAnimated(g, (dt, t) => {
      if (propsSettings.reducedMotion) return;
      pivot.rotation.x = Math.sin(t * 1.25 + ph) * 0.06 + Math.sin(t * 2.7 + ph) * 0.015;
    });
    boardH = h;
  } else {
    // 'post': plank on one (narrow) or two (wide) posts
    const w = width;
    const h = opt(opts, 'height', Math.max(0.36, w * 0.3) * Math.max(1, lines * 0.75));
    const boardY = opt(opts, 'boardY', 1.15);
    const { texture, rects } = textAtlas([{ w, h, text, wood, paint: opts.color, textColor: opts.textColor, carved: opts.carved }], seed);
    const two = w > 1.3;
    const postH = boardY + h / 2 + 0.12;
    if (two) for (const sx of [-1, 1]) addPost(P, { x: sx * (w / 2 - 0.2), z: -0.11, h: postH, color: postWood, cap: 'point', rng });
    else addPost(P, { z: -0.11, h: postH, color: postWood, cap: 'point', rng });
    addBoard(P, faces, rects[0], { w, h, d: 0.08, y: boardY, z: 0.0, color: plankColor });
    g.add(groupFor(P.finish(), { name: 'sign' }));
    g.add(facesMesh(faces, texture));
    boardH = h;
  }
  g.traverse((o) => {
    if (o.isMesh && o.name.startsWith('sign:wood')) o.castShadow = true;
  });
  g.userData = { width, height: boardH, face: g.getObjectByName('sign-text') };
  return g;
}

/**
 * A signpost with several arrow planks pointing in different directions.
 * @param {Array<{ text: string, angle: number, color?: string, textColor?: string, wood?: string }>} arrows
 *   angle = heading in radians in the signpost's local space, same convention as rotation.y
 *   (0 → +Z, π/2 → +X): the arrow points along (sin angle, cos angle).
 * @param {object} [opts] { height (auto), postWood='walnut', cap='roof'|'ball'|'point', seed, length (auto per text) }
 * @returns {THREE.Group}
 */
export function makeSignpost(arrows = [], opts = {}) {
  const P = new Parts();
  const faces = [];
  const seed = String(opts.seed ?? arrows.map((a) => a.text).join('|'));
  const rng = createRng(seed);
  const h = 0.3;
  const gap = 0.37;
  const topY = opt(opts, 'height', 1.35 + arrows.length * gap);
  // measure text to size the planks
  const ctx2d = document.createElement('canvas').getContext('2d');
  ctx2d.font = `600 100px ${FONT_DISPLAY}`; // (main.js loads Fredoka before the world builds)
  const panels = arrows.map((a) => {
    const tw = ctx2d.measureText(String(a.text)).width / 100; // width at 1 unit font size
    const len = opts.length ?? THREE.MathUtils.clamp(tw * h * 0.62 + h * 1.1 + 0.2, 1.0, 2.2);
    const tf = (h * 0.55) / len + 0.02;
    return { w: len, h, text: a.text, wood: a.wood ?? 'spruce', paint: a.color, textColor: a.textColor, textX0: tf, textX1: 1 - tf, padY: 0.18 };
  });
  const { texture, rects } = arrows.length ? textAtlas(panels, seed) : { texture: null, rects: [] };
  addPost(P, { h: topY, r: 0.085, color: woodHex(opt(opts, 'postWood', 'walnut')), cap: opt(opts, 'cap', 'roof'), rng });
  arrows.forEach((a, i) => {
    const y = topY - 0.28 - i * gap;
    const beta = (a.angle ?? 0) - Math.PI / 2;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(0, y, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, beta, rng.jitter(0.04))), new THREE.Vector3(1, 1, 1));
    m.multiply(new THREE.Matrix4().makeTranslation(-0.05, 0, 0.0));
    addArrow(P, faces, rects[i], { len: panels[i].w, h, d: 0.07, color: a.color ?? palette.spruce, matrix: m });
  });
  const g = new THREE.Group();
  g.name = 'signpost';
  const body = groupFor(P.finish(), { name: 'signpost' });
  g.add(body);
  if (faces.length) g.add(facesMesh(faces, texture));
  g.userData = { height: topY + 0.3 };
  return g;
}

/** A small text label on a plank (no post) — e.g. to nail onto walls or the house plaque. */
export function makePlaque(text, opts = {}) {
  const w = opt(opts, 'width', 0.8);
  const h = opt(opts, 'height', 0.26);
  const P = new Parts();
  const faces = [];
  const { texture, rects } = textAtlas([{ w, h, text, wood: opts.wood ?? 'oak', paint: opts.color, textColor: opts.textColor, carved: opts.carved }], String(opts.seed ?? text));
  addBoard(P, faces, rects[0], { w, h, d: 0.05, color: opts.color ?? woodHex(opts.wood ?? 'oak'), doubleSided: false });
  const g = new THREE.Group();
  g.name = 'plaque';
  g.add(groupFor(P.finish(), { name: 'plaque', cast: false }));
  g.add(facesMesh(faces, texture));
  return g;
}

