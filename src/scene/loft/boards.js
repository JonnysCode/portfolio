// ─────────────────────────────────────────────────────────────────────────────
// Painted & chalked boards of the Code Loft — every face shares ONE canvas
// atlas, ONE material and ONE mesh:
//
//   • "Snail Lift" signs (painted letters on a wooden plate)
//   • a slate chalkboard with a hand-sketched architecture diagram of this
//     very portfolio (main → ctx → world modules → three.js), a snail doodle
//     and a TODO list — a developer's scribbles on a cabinetmaker's wall
//
//   const boards = createBoards(ctx);
//   boards.addSign(matrix, width)          plate facing +Z in `matrix` (both sides)
//   boards.addChalkboard(matrix, width)    slate facing +Z (front only)
//   boards.build(parent)                   → the merged Mesh (or null)
//
// The frames / plates themselves are ordinary geometry in the loft's batch;
// only the painted faces live here.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paintWood, drawFittedText, canvasTexture, FONT_HAND } from '../../props/text.js';
import { createRng } from '../../core/rng.js';

const W = 1024;
const H = 512;
/** Atlas regions in canvas pixels [x, y, w, h] (y down). */
const SIGN = [0, 0, 512, 150];
const SLATE = [512, 0, 512, 384];

export function createBoards(ctx) {
  const faces = [];
  let material = null;

  function atlas() {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    // the sign: painted letters on a wooden plate
    g.save();
    g.translate(SIGN[0], SIGN[1]);
    paintWood(g, SIGN[2], SIGN[3], { color: '#b08a5e', seed: 'lift' });
    drawFittedText(g, ['Snail Lift'], { x: 36, y: 16, w: SIGN[2] - 72, h: SIGN[3] - 32 }, { color: '#3b2a1e', style: 'paint' });
    g.restore();
    // the chalkboard
    g.save();
    g.translate(SLATE[0], SLATE[1]);
    drawSlate(g, SLATE[2], SLATE[3]);
    g.restore();
    return canvasTexture(canvas);
  }

  /** A plane (w × h) whose UVs cover atlas region r, facing +Z, pushed `z` out. */
  function face(w, h, r, z = 0, back = false) {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const u = (r[0] + uv.getX(i) * r[2]) / W;
      const v = 1 - (r[1] + (1 - uv.getY(i)) * r[3]) / H;
      uv.setXY(i, u, v);
    }
    if (back) g.rotateY(Math.PI);
    return g.translate(0, 0, back ? -z : z);
  }

  return {
    /** Sign face pair for a plate of width w (height from the atlas aspect), plate thickness ≈ 0.03. */
    addSign(matrix, w = 0.6) {
      const h = (w * SIGN[3]) / SIGN[2];
      faces.push(face(w, h, SIGN, 0.017).applyMatrix4(matrix), face(w, h, SIGN, 0.017, true).applyMatrix4(matrix));
      return h;
    },
    /** Slate face of width w (4:3) — returns its height. */
    addChalkboard(matrix, w = 0.5) {
      const h = (w * SLATE[3]) / SLATE[2];
      faces.push(face(w, h, SLATE, 0.0).applyMatrix4(matrix));
      return h;
    },
    build(parent) {
      if (!faces.length) return null;
      material ??= new THREE.MeshStandardMaterial({ map: atlas(), roughness: 0.9, name: 'loft-boards' });
      const g = mergeGeometries(faces, false);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, material);
      mesh.name = 'loft-boards';
      mesh.matrixAutoUpdate = false;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    },
  };
}

// ─── the chalkboard drawing ──────────────────────────────────────────────────
function drawSlate(g, w, h) {
  const rng = createRng('loft-slate');
  // slate with old, half-wiped chalk clouds
  g.fillStyle = '#2c3633';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    const x = rng.range(0, w), y = rng.range(0, h), r = rng.range(20, 80);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(220,230,225,${rng.range(0.03, 0.08)})`);
    grd.addColorStop(1, 'rgba(220,230,225,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // wiping strokes
  g.strokeStyle = 'rgba(210,220,215,0.05)';
  g.lineWidth = 28;
  g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    const y = rng.range(40, h - 40);
    g.moveTo(rng.range(10, 120), y);
    g.bezierCurveTo(w * 0.3, y + rng.jitter(40), w * 0.6, y + rng.jitter(40), rng.range(w - 120, w - 10), y + rng.jitter(30));
    g.stroke();
  }

  const chalk = (color = '#eef2ec', width = 3) => {
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
  };
  /** a wobbly hand-drawn line */
  const line = (x0, y0, x1, y1) => {
    g.beginPath();
    g.moveTo(x0 + rng.jitter(1.5), y0 + rng.jitter(1.5));
    const n = 4;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      g.lineTo(x0 + (x1 - x0) * t + rng.jitter(1.6), y0 + (y1 - y0) * t + rng.jitter(1.6));
    }
    g.stroke();
  };
  const box = (x, y, bw, bh, label, color) => {
    chalk(color, 3);
    line(x, y, x + bw, y);
    line(x + bw, y, x + bw, y + bh);
    line(x + bw, y + bh, x, y + bh);
    line(x, y + bh, x, y);
    chalk('#eef2ec');
    drawFittedText(g, [label], { x: x + 6, y: y + 4, w: bw - 12, h: bh - 8 }, { font: FONT_HAND, weight: 400, color: '#eef2ec', style: 'plain', maxSize: 30 });
  };
  const arrow = (x0, y0, x1, y1, color = '#eef2ec') => {
    chalk(color, 2.5);
    line(x0, y0, x1, y1);
    const a = Math.atan2(y1 - y0, x1 - x0);
    line(x1, y1, x1 - Math.cos(a - 0.5) * 12, y1 - Math.sin(a - 0.5) * 12);
    line(x1, y1, x1 - Math.cos(a + 0.5) * 12, y1 - Math.sin(a + 0.5) * 12);
  };
  const text = (s, x, y, size, color = '#eef2ec', align = 'left') => {
    g.font = `400 ${size}px ${FONT_HAND}`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(s, x, y);
  };

  // title, underlined twice
  text("jonny's woodland", 26, 34, 34, '#ffe7a3');
  chalk('#ffe7a3', 2.5);
  line(24, 56, 250, 54);
  line(30, 62, 236, 61);
  // the architecture sketch
  box(26, 92, 116, 44, 'main.js', '#eef2ec');
  box(196, 92, 92, 44, 'ctx', '#9fd6ff');
  arrow(144, 114, 192, 114);
  const mods = [['oak', '#b8e0a0'], ['loft', '#ffb3c1'], ['cottage', '#ffd27a'], ['riverside', '#9fd6ff']];
  mods.forEach(([m, c], i) => {
    const y = 170 + i * 48;
    box(186, y, 112, 38, m, c);
    arrow(242, 138, 242 + (i - 1.5) * 4, y - 2, '#eef2ec');
  });
  box(26, 300, 116, 44, 'three.js', '#eef2ec');
  arrow(184, 318, 146, 322);
  // a snail doodle with its speed
  chalk('#ffd27a', 3);
  g.beginPath();
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * Math.PI * 5;
    const r = 4 + t * 3.4;
    const x = 410 + Math.cos(t) * r, y = 120 + Math.sin(t) * r;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
  line(360, 178, 470, 176);
  line(470, 176, 490, 150);
  line(486, 148, 482, 128);
  line(490, 150, 500, 132);
  text('SPEED = 0.36', 360, 206, 26, '#ffd27a');
  // the TODO list
  text('TODO', 336, 252, 30, '#ffb3c1');
  chalk('#ffb3c1', 2);
  line(334, 270, 400, 269);
  const todo = [['planks', true], ['shingles', true], ['more moss', false], ['feed the snail', false]];
  todo.forEach(([s, done], i) => {
    const y = 296 + i * 24;
    chalk('#eef2ec', 2);
    line(338, y - 7, 350, y - 7);
    line(350, y - 7, 350, y + 6);
    line(350, y + 6, 338, y + 6);
    line(338, y + 6, 338, y - 7);
    if (done) {
      chalk('#b8e0a0', 2.5);
      line(339, y - 1, 344, y + 5);
      line(344, y + 5, 355, y - 11);
    }
    text(s, 360, y, 22);
  });
  // the chalk tray's dust along the bottom edge
  g.fillStyle = 'rgba(235,240,235,0.18)';
  for (let i = 0; i < 80; i++) g.fillRect(rng.range(0, w), h - rng.range(2, 14), rng.range(1, 4), rng.range(1, 3));
}
