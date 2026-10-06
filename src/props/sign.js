// PLACEHOLDER — the props builder replaces this with real wooden signs.
import * as THREE from 'three';
import { materials } from '../core/materials.js';
import { palette } from '../core/palette.js';
import { FONT_DISPLAY } from './text.js';

/**
 * Draw text onto a canvas texture.
 * @param {string|string[]} text  one string or several lines
 * @param {object} [opts] { width=512, height=128, font, color, background, padding, align }
 * @returns {THREE.CanvasTexture}
 */
export function makeTextTexture(text, opts = {}) {
  const { width = 512, height = 128, color = palette.ink, background = null, font = FONT_DISPLAY, weight = 600 } = opts;
  const lines = Array.isArray(text) ? text : [text];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (background) { g.fillStyle = background; g.fillRect(0, 0, width, height); }
  const size = Math.floor((height / lines.length) * 0.62);
  g.font = `${weight} ${size}px ${font}`;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, width / 2, (height / lines.length) * (i + 0.5), width * 0.92));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * A wooden sign.
 * @param {object} opts { text, style: 'post'|'board'|'hanging'|'arrow', width=2, color, textColor, height }
 * @returns {THREE.Group}
 */
export function makeSign(opts = {}) {
  const { text = '', width = 2, style = 'post' } = opts;
  const g = new THREE.Group();
  const boardH = width * 0.35;
  const board = new THREE.Mesh(new THREE.BoxGeometry(width, boardH, 0.1), materials.wood('spruce'));
  board.position.y = style === 'board' ? boardH / 2 : 1.4;
  g.add(board);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.95, boardH * 0.9),
    new THREE.MeshBasicMaterial({ map: makeTextTexture(text, { width: 512, height: Math.round(512 * 0.35) }), transparent: true })
  );
  face.position.set(0, board.position.y, 0.051);
  g.add(face);
  if (style !== 'board') {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.4, 0.14), materials.wood('oak'));
    post.position.y = 0.7;
    g.add(post);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
