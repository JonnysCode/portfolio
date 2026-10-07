// ─────────────────────────────────────────────────────────────────────────────
// Canvas text helpers shared by signs, labels and screens.
//
//   makeTextTexture('Schreinerei', { width: 1024, height: 256, background: 'wood' })
//   paintWood(g, w, h, { color, planks })      wood-grain plank background
//   drawFittedText(g, lines, box, opts)        auto-sized text inside a box
//
// Text is always auto-fitted: the largest font size that fits every line in
// the box (minus padding) is used, capped by opts.maxSize.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { palette } from '../core/palette.js';

export const FONT_DISPLAY = '"Fredoka", "Trebuchet MS", system-ui, sans-serif';
export const FONT_HAND = '"Patrick Hand", "Comic Sans MS", cursive';

/** The weight a font stack is actually shipped in (Patrick Hand only has 400). */
export const fontWeight = (font, weight = 600) => (String(font).includes('Patrick Hand') ? 400 : weight);

/**
 * Canvas text can only use a web font whose glyphs are already loaded — it
 * silently falls back to a system font otherwise. main.js awaits Fredoka and
 * Patrick Hand before the world builds, but a texture drawn earlier (or text
 * needing another unicode subset, e.g. latin-ext) is redrawn here as soon as
 * its font has arrived. specs: CSS font shorthands ('600 32px "Fredoka", …').
 */
export function whenFontsReady(specs, text, redraw) {
  const fonts = typeof document !== 'undefined' ? document.fonts : null;
  if (!fonts || typeof fonts.check !== 'function') return false;
  const sample = String(text || ' ');
  const missing = [...new Set(specs)].filter((spec) => {
    try {
      return !fonts.check(spec, sample);
    } catch {
      return false;
    }
  });
  if (!missing.length) return false;
  Promise.all(missing.map((spec) => fonts.load(spec, sample)))
    .then((loaded) => {
      if (loaded.some((list) => list.length)) redraw();
    })
    .catch(() => {});
  return true;
}

/** Max anisotropy we ask for; three clamps it to what the GPU supports. */
export const TEXT_ANISOTROPY = 8;

/** sRGB hex → [r,g,b] 0..255 without colour management (canvas is sRGB). */
function rgbOf(hex) {
  const c = new THREE.Color();
  c.setStyle(hex, THREE.SRGBColorSpace);
  c.convertLinearToSRGB();
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

const rgba = (rgb, a = 1, k = 1) => `rgba(${Math.round(rgb[0] * k)},${Math.round(rgb[1] * k)},${Math.round(rgb[2] * k)},${a})`;

/**
 * Paint a wood-grain background (one or more planks) into a 2D context.
 * opts: { color (sRGB hex), planks = 1, seed, edge = true (darkened bevel edges),
 *         knots = true, painted = null (paint colour washed over the wood) }
 */
export function paintWood(g, w, h, opts = {}) {
  const { color = palette.spruce, planks = 1, seed = 'plank', edge = true, knots = true, painted = null, vertical = false } = opts;
  const rnd = createRng(String(seed));
  const base = rgbOf(color);
  const paintRgb = painted ? rgbOf(painted) : null;
  const ph = (vertical ? w : h) / planks;
  g.save();
  if (vertical) {
    // draw rotated so the same code paints vertical boards
    g.translate(w, 0);
    g.rotate(Math.PI / 2);
    [w, h] = [h, w];
  }
  for (let p = 0; p < planks; p++) {
    const y0 = p * ph;
    const tone = 0.9 + rnd.next() * 0.2;
    g.fillStyle = rgba(base, 1, tone);
    g.fillRect(0, y0, w, ph);
    // long grain lines
    const lines = Math.round(ph / 5 + 6);
    for (let i = 0; i < lines; i++) {
      const yy = y0 + rnd.next() * ph;
      const amp = 1 + rnd.next() * ph * 0.06;
      const freq = (0.004 + rnd.next() * 0.01) * (512 / w);
      const phase = rnd.next() * 10;
      g.strokeStyle = rgba(base, 0.18 + rnd.next() * 0.22, 0.62 + rnd.next() * 0.15);
      g.lineWidth = 0.6 + rnd.next() * (h / 160);
      g.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = yy + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1 + phase * 2) * amp * 0.25;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // a knot or two
    if (knots && rnd.chance(0.7)) {
      const kx = w * (0.15 + rnd.next() * 0.7), ky = y0 + ph * (0.3 + rnd.next() * 0.4);
      const kr = Math.min(ph * 0.16, 18 + rnd.next() * 10);
      for (let r = kr; r > 1; r -= Math.max(1.5, kr / 6)) {
        g.strokeStyle = rgba(base, 0.25, 0.55);
        g.lineWidth = 1.2;
        g.beginPath();
        g.ellipse(kx, ky, r * 1.9, r * 0.75, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = rgba(base, 0.6, 0.45);
      g.beginPath();
      g.ellipse(kx, ky, kr * 0.35, kr * 0.2, 0, 0, Math.PI * 2);
      g.fill();
    }
    // paint wash (slightly worn, the grain still shows)
    if (paintRgb) {
      g.fillStyle = rgba(paintRgb, 0.78);
      g.fillRect(0, y0, w, ph);
      // worn spots
      for (let i = 0; i < 6; i++) {
        g.fillStyle = rgba(base, 0.12 + rnd.next() * 0.12);
        g.beginPath();
        g.ellipse(rnd.next() * w, y0 + rnd.next() * ph, 6 + rnd.next() * 30, 2 + rnd.next() * 6, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    // bevelled plank edges: light top edge, dark bottom edge + seam
    if (edge) {
      const e = Math.max(2, Math.round(ph * 0.06));
      const grad = g.createLinearGradient(0, y0, 0, y0 + e * 2);
      grad.addColorStop(0, 'rgba(255,240,215,0.35)');
      grad.addColorStop(1, 'rgba(255,240,215,0)');
      g.fillStyle = grad;
      g.fillRect(0, y0, w, e * 2);
      const grad2 = g.createLinearGradient(0, y0 + ph - e * 2.5, 0, y0 + ph);
      grad2.addColorStop(0, 'rgba(40,20,5,0)');
      grad2.addColorStop(1, 'rgba(40,20,5,0.42)');
      g.fillStyle = grad2;
      g.fillRect(0, y0 + ph - e * 2.5, w, e * 2.5);
      if (p > 0) {
        g.fillStyle = 'rgba(40,20,5,0.55)';
        g.fillRect(0, y0 - 1, w, 2);
      }
    }
  }
  if (edge) {
    // darken the left/right ends a touch
    const e = Math.max(4, w * 0.02);
    let grad = g.createLinearGradient(0, 0, e * 2, 0);
    grad.addColorStop(0, 'rgba(40,20,5,0.35)');
    grad.addColorStop(1, 'rgba(40,20,5,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, e * 2, h);
    grad = g.createLinearGradient(w - e * 2, 0, w, 0);
    grad.addColorStop(0, 'rgba(40,20,5,0)');
    grad.addColorStop(1, 'rgba(40,20,5,0.35)');
    g.fillStyle = grad;
    g.fillRect(w - e * 2, 0, e * 2, h);
  }
  g.restore();
}

/**
 * Draw lines of text, auto-fitted into box {x, y, w, h}.
 * opts: { font, weight, color, align ('center'|'left'), maxSize, minSize,
 *         lineHeight = 1.12, style: 'paint' | 'carved' | 'plain', outline (colour), outlineWidth }
 * Returns the font size used.
 */
export function drawFittedText(g, lines, box, opts = {}) {
  const {
    font = FONT_DISPLAY,
    color = palette.ink,
    align = 'center',
    maxSize = 400,
    minSize = 8,
    lineHeight = 1.12,
    style = 'paint',
    outline = null,
    outlineWidth = 0.08,
    letterSpacing = 0,
  } = opts;
  const weight = fontWeight(font, opts.weight ?? 600);
  lines = lines.filter((l) => l !== undefined && l !== null).map(String);
  if (!lines.length) return 0;
  const n = lines.length;
  let size = Math.min(maxSize, box.h / (n * lineHeight));
  g.font = `${weight} ${size}px ${font}`;
  if ('letterSpacing' in g && letterSpacing) g.letterSpacing = `${letterSpacing * size}px`;
  let widest = 0;
  for (const l of lines) widest = Math.max(widest, g.measureText(l).width);
  if (widest > box.w) size *= box.w / widest;
  size = Math.max(minSize, Math.floor(size));
  g.font = `${weight} ${size}px ${font}`;
  if ('letterSpacing' in g && letterSpacing) g.letterSpacing = `${letterSpacing * size}px`;
  g.textBaseline = 'middle';
  g.textAlign = align;
  const lh = size * lineHeight;
  const total = lh * n;
  const x = align === 'center' ? box.x + box.w / 2 : box.x;
  const y0 = box.y + (box.h - total) / 2 + lh / 2 + size * 0.04;
  lines.forEach((l, i) => {
    const y = y0 + i * lh;
    if (style === 'carved') {
      // engraved: dark inner text with a light lower lip
      g.fillStyle = 'rgba(255,240,215,0.45)';
      g.fillText(l, x, y + size * 0.045);
      g.fillStyle = color;
      g.fillText(l, x, y);
      g.fillStyle = 'rgba(30,15,5,0.35)';
      g.fillText(l, x, y - size * 0.03);
    } else if (style === 'paint') {
      if (outline) {
        g.lineJoin = 'round';
        g.lineWidth = size * outlineWidth * 2;
        g.strokeStyle = outline;
        g.strokeText(l, x, y);
      }
      // soft drop shadow so painted letters sit on the wood
      g.fillStyle = 'rgba(30,15,5,0.28)';
      g.fillText(l, x + size * 0.025, y + size * 0.035);
      g.fillStyle = color;
      g.fillText(l, x, y);
    } else {
      if (outline) {
        g.lineJoin = 'round';
        g.lineWidth = size * outlineWidth * 2;
        g.strokeStyle = outline;
        g.strokeText(l, x, y);
      }
      g.fillStyle = color;
      g.fillText(l, x, y);
    }
  });
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  return size;
}

/** Turn a canvas into a crisp, mip-mapped sRGB texture. */
export function canvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = TEXT_ANISOTROPY;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/**
 * Draw text onto a canvas texture.
 * @param {string|string[]} text  one string or several lines ('\n' also splits)
 * @param {object} [opts] { width=512, height=128, font, weight=600, color, background (colour | 'wood' | null),
 *   wood: { color, planks, painted, seed } (when background is 'wood'), padding=0.08 (fraction of height),
 *   align, maxSize, style ('paint' | 'carved' | 'plain'), outline, lineHeight }
 * @returns {THREE.CanvasTexture} (texture.userData.fontSize = the fitted size in px)
 */
export function makeTextTexture(text, opts = {}) {
  const { width = 512, height = 128, background = null, padding = 0.1 } = opts;
  const lines = (Array.isArray(text) ? text : [text]).flatMap((l) => String(l ?? '').split('\n'));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const g = canvas.getContext('2d');
  const draw = () => {
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (background === 'wood') paintWood(g, canvas.width, canvas.height, opts.wood || {});
    else if (background) {
      g.fillStyle = background;
      g.fillRect(0, 0, canvas.width, canvas.height);
    }
    const pad = padding * Math.min(canvas.width, canvas.height);
    const padX = opts.paddingX !== undefined ? opts.paddingX * canvas.width : pad * 1.4;
    return drawFittedText(g, lines, { x: padX, y: pad, w: canvas.width - padX * 2, h: canvas.height - pad * 2 }, {
      style: background ? 'paint' : 'plain',
      ...opts,
    });
  };
  const size = draw();
  const tex = canvasTexture(canvas);
  tex.userData.fontSize = size;
  const font = opts.font ?? FONT_DISPLAY;
  whenFontsReady([`${fontWeight(font, opts.weight ?? 600)} 32px ${font}`], lines.join(''), () => {
    tex.userData.fontSize = draw();
    tex.needsUpdate = true;
  });
  return tex;
}
