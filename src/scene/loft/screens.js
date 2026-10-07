// ─────────────────────────────────────────────────────────────────────────────
// Glowing screens of the Code Loft: monitors and a laptop scrolling through
// syntax-coloured JavaScript (and a terminal), with a typing line and a
// blinking cursor — plus tiny blinking LEDs for the server log and gadgets.
//
// One CanvasTexture atlas holds a few "documents" (columns of code lines);
// the scrolling, typing and blinking all happen in the fragment shader from
// the shared time uniform, so the screens cost nothing on the CPU and the
// texture is uploaded once. Every screen of the loft is ONE mesh / material.
//
//   const S = createScreens(ctx);
//   S.addScreen(matrix, w, h, { doc: 0, rows: 14, speed: 1.6, phase: 3 })  // a quad facing +Z
//   S.addLed(position, color, { rate, phase, size })
//   S.build(parent)    → { screens: Mesh, leds: Mesh }
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sharedUniforms } from '../../core/materials.js';
import { fogUniforms } from '../../world/env/fog.js';

const COLS = 3; // documents side by side in the atlas
const LINES = 64; // lines per document
const ATLAS_W = 1536;
const ATLAS_H = 1024;

// ─── the documents ───────────────────────────────────────────────────────────
const CODE_A = `// woodland/src/scene/loft.js
import * as THREE from 'three';
import { OAK } from '../world/layout.js';

/** The Code Loft: a treehouse up the Great Oak. */
export default async function build(ctx) {
  const deck = buildDeck(ctx, { planks: 'oak' });
  const house = buildHouse(ctx, deck);
  const snail = makeSnail({ seed: 'lift' });

  // the snail elevator: up, rest, down, rest
  let t = 0, phase = 'up';
  function update(dt) {
    t += dt * SPEED;
    if (t > 1) phase = next(phase);
    snail.setMoving(phase === 'rest' ? 0 : 1);
  }

  ctx.interactions.add(house.screen, {
    entryId: 'this-portfolio',
    area: 'code',
  });
  return { update };
}

function makePlank(rng, length) {
  const w = 0.26 + rng.jitter(0.02);
  // every board is a little bit different
  return board(w, 0.07, length, { rng });
}

const ROOF_PITCH = 58 * DEG; // steep & cosy
for (let row = 0; row < rows; row++) {
  const off = (row % 2) * 0.5; // stagger the shakes
  layShingles(field, { row, off, mossy: 0.3 });
}

async function brewCoffee(cups = 2) {
  const beans = await grind('arabica', 18);
  return pour(beans, { temp: 93, cups });
}

export const SNAIL_SPEED = 0.32; // units per second
export const QUACK = 'Have you tried explaining it?';

class Workbench {
  constructor(wood = 'oak') {
    this.wood = wood;
    this.tools = ['plane', 'chisel', 'saw'];
  }
  sharpen(tool) {
    return this.tools.includes(tool) && hone(tool, 8000);
  }
}

// TODO: more mushrooms
const glen = await grow({ trees: 70, ferns: 900 });
console.log('the woodland is ready', glen.size);`;

const CODE_B = `$ npm run build
> jonnys-woodland@0.1.0 build
> vite build

vite v6.3 building for production...
transforming (42) src/scene/oak.js
transforming (77) src/props/snail.js
✓ 128 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html          1.92 kB
dist/assets/index.css   12.40 kB
dist/assets/three.js   612.33 kB
dist/assets/glen.js    148.07 kB
✓ built in 3.41s

$ npm test
 PASS  tests/layout.test.js
 PASS  tests/ground.test.js
 PASS  tests/snail.test.js
   ✓ crawls up the oak (31 ms)
   ✓ rests at the top (2 ms)
   ✓ never drops the basket
 Tests: 24 passed, 24 total
 Time:  1.84 s

$ git status
On branch main
Changes to be committed:
  modified: src/scene/loft.js
  new file: src/scene/loft/deck.js

$ git commit -m "loft: add the snail lift"
[main 3f9c2e1] loft: add the snail lift
 3 files changed, 412 insertions(+)

$ ssh glen@oak.local
Welcome to OakOS 2.4 (GNU/Linux)
glen@oak:~$ uptime
 21:42  up 312 days,  load: 0.08
glen@oak:~$ sensors
 trunk:     +14.2°C
 roots:     +11.8°C
 server-log: +31.5°C (high)
glen@oak:~$ tail -f /var/log/snail
[ok] arrived at loft
[ok] basket secured
[..] resting
[ok] departing to ground
glen@oak:~$ _`;

const CODE_C = `// shaders/fireflies.glsl
uniform float uTime;
attribute float aSeed;
varying float vGlow;

void main() {
  vec3 p = position;
  float t = uTime * 0.6 + aSeed * 6.28;
  p.x += sin(t * 1.3) * 0.4;
  p.y += sin(t * 0.7) * 0.3;
  p.z += cos(t * 1.1) * 0.4;
  vGlow = 0.5 + 0.5 * sin(t * 4.0);
  gl_Position = projectionMatrix *
    modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = 6.0 * vGlow;
}

// src/systems/cameraRig.js
export function goTo(id, { duration = 2.4 } = {}) {
  const spot = SPOT_BY_ID[id];
  if (!spot) return;
  from.copy(camera.position);
  to.fromArray(spot.camera.position);
  t = 0;
}

function ease(t) {
  return t < 0.5 ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// src/props/duck.js
export function makeDuck() {
  const body = blob(0.06, [1, 0.8, 1.2]);
  const head = blob(0.04).translate(0, 0.07, 0.04);
  return paint([body, head], '#ffd23f');
}

const reviewers = ['duck', 'owl', 'snail'];
for (const r of reviewers) {
  await requestReview(r, { patience: Infinity });
}`;

// very small JS highlighter → [ [text, colour], … ] per line
const KEYWORDS = new Set('import export default async function const let var return if else for of in new class this await from while true false null undefined typeof extends constructor'.split(' '));
const COLORS = {
  text: '#d7dae0',
  keyword: '#c792ea',
  string: '#a5d6a7',
  number: '#f7a26b',
  comment: '#6f8f7a',
  fn: '#82aaff',
  punct: '#89ddff',
  prompt: '#7fe08a',
  ok: '#7fe08a',
  warn: '#ffcb6b',
  dim: '#8c93a3',
};
function tokenize(line, mode) {
  if (mode === 'term') {
    if (line.startsWith('$') || line.includes('@oak:')) return [[line, COLORS.prompt]];
    if (line.includes('✓') || line.includes('PASS') || line.includes('[ok]')) return [[line, COLORS.ok]];
    if (line.includes('high') || line.includes('[..]')) return [[line, COLORS.warn]];
    return [[line, COLORS.dim]];
  }
  const out = [];
  const ci = line.indexOf('//');
  let code = line, comment = '';
  if (ci >= 0 && !/['"`][^'"`]*\/\//.test(line.slice(0, ci + 2))) {
    code = line.slice(0, ci);
    comment = line.slice(ci);
  }
  const re = /('[^']*'|"[^"]*"|`[^`]*`|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*|\s+|[^\sA-Za-z_$\d])/g;
  let m;
  while ((m = re.exec(code))) {
    const t = m[0];
    let c = COLORS.text;
    if (/^['"`]/.test(t)) c = COLORS.string;
    else if (/^\d/.test(t)) c = COLORS.number;
    else if (KEYWORDS.has(t)) c = COLORS.keyword;
    else if (/^[A-Za-z_$]/.test(t) && code[re.lastIndex] === '(') c = COLORS.fn;
    else if (/^[{}()[\];,.=<>+\-*/!?:&|]/.test(t)) c = COLORS.punct;
    out.push([t, c]);
  }
  if (comment) out.push([comment, COLORS.comment]);
  return out;
}

let atlas = null;
function makeAtlas() {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const g = canvas.getContext('2d');
  const colW = ATLAS_W / COLS;
  const lh = ATLAS_H / LINES;
  const docs = [
    { text: CODE_A, mode: 'js', bg: '#1d2130', gutter: true },
    { text: CODE_B, mode: 'term', bg: '#11161a', gutter: false },
    { text: CODE_C, mode: 'js', bg: '#22192b', gutter: true },
  ];
  docs.forEach((d, col) => {
    const x0 = col * colW;
    g.fillStyle = d.bg;
    g.fillRect(x0, 0, colW, ATLAS_H);
    g.font = `${Math.round(lh * 0.72)}px "DejaVu Sans Mono", Menlo, Consolas, monospace`;
    g.textBaseline = 'middle';
    const lines = d.text.split('\n');
    for (let i = 0; i < LINES; i++) {
      const line = lines[i % lines.length];
      const y = i * lh + lh / 2;
      let x = x0 + 10;
      if (d.gutter) {
        g.fillStyle = '#4b5263';
        g.fillText(String((i % lines.length) + 1).padStart(3, ' '), x, y);
        x += lh * 2.1;
      }
      for (const [t, c] of tokenize(line, d.mode)) {
        g.fillStyle = c;
        g.fillText(t, x, y);
        x += g.measureText(t).width;
        if (x > x0 + colW - 6) break;
      }
    }
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  atlas = tex;
  return tex;
}

// ─── screen shader ───────────────────────────────────────────────────────────
const SCREEN_VERT = /* glsl */ `
  attribute vec4 aDoc; // x: column, y: visible rows, z: lines per second, w: phase
  varying vec2 vUv;
  varying vec4 vDoc;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vDoc = aDoc;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const SCREEN_FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uTime;
  uniform float uNight;
  varying vec2 vUv;
  varying vec4 vDoc;
  #include <fog_pars_fragment>
  const float COLS = ${COLS}.0;
  const float LINES = ${LINES}.0;
  void main() {
    float rows = vDoc.y;
    float tl = uTime * vDoc.z + vDoc.w;     // continuous "line clock"
    float scroll = floor(tl);               // the editor scrolls line by line
    float typed = fract(tl);                // the bottom line is being typed
    float row = floor((1.0 - vUv.y) * rows);
    float inRow = fract((1.0 - vUv.y) * rows);
    float line = mod(scroll + row, LINES);
    // margins inside the screen
    vec2 m = vec2(0.035, 0.0);
    float u = (vUv.x - m.x) / (1.0 - 2.0 * m.x);
    vec2 auv = vec2((vDoc.x + clamp(u, 0.0, 1.0) * 0.98) / COLS, 1.0 - (line + inRow) / LINES);
    vec3 col = texture2D(uAtlas, auv).rgb;
    vec3 bg = texture2D(uAtlas, vec2((vDoc.x + 0.995) / COLS, 0.5 / LINES)).rgb;
    if (u < 0.0 || u > 1.0) col = bg;
    // the line being typed: hide what is not typed yet, blink a cursor at its end
    bool last = row > rows - 1.5;
    if (last && u > typed) col = bg;
    float blink = step(0.5, fract(uTime * 1.6));
    if (last && abs(u - typed) < 0.012 && inRow > 0.15 && inRow < 0.85) col = mix(col, vec3(0.85, 0.95, 1.0), blink);
    // the current line is highlighted a touch
    if (last) col += vec3(0.02, 0.025, 0.04);
    // a soft vignette & faint scanlines — old CRT warmth
    vec2 c = vUv - 0.5;
    float vig = 1.0 - dot(c, c) * 0.9;
    float scan = 0.94 + 0.06 * sin(vUv.y * rows * 6.2832 * 2.0);
    col *= vig * scan;
    // screens glow: brighter at night (bloom picks them up)
    col *= mix(1.25, 1.9, uNight);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// ─── blinking LEDs ───────────────────────────────────────────────────────────
const LED_VERT = /* glsl */ `
  attribute vec3 color;
  attribute vec2 aBlink; // x: rate (Hz), y: phase
  uniform float uTime;
  varying vec3 vColor;
  varying float vOn;
  #include <fog_pars_vertex>
  void main() {
    vColor = color;
    float t = uTime * aBlink.x + aBlink.y;
    // a mix of steady, flickering (disk activity) and slow pulsing LEDs
    float flick = step(0.35, fract(sin(floor(t * 3.0) * 12.9898 + aBlink.y * 78.233) * 43758.5453));
    float pulse = 0.55 + 0.45 * sin(t * 6.2832);
    vOn = aBlink.x > 2.0 ? flick : (aBlink.x > 0.05 ? pulse : 1.0);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const LED_FRAG = /* glsl */ `
  uniform float uNight;
  varying vec3 vColor;
  varying float vOn;
  #include <fog_pars_fragment>
  void main() {
    vec3 col = vColor * mix(0.12, 1.0, vOn) * mix(2.2, 3.4, uNight);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const frozenTime = { value: 7.3 };

export function createScreens(ctx) {
  const reduced = !!ctx.engine?.reducedMotion;
  const time = reduced ? frozenTime : sharedUniforms.uTime;
  const screens = [];
  const leds = [];

  const screenMat = new THREE.ShaderMaterial({
    name: 'loft-screens',
    uniforms: { ...fogUniforms(), uAtlas: { value: makeAtlas() }, uTime: time, uNight: sharedUniforms.uNight },
    vertexShader: SCREEN_VERT,
    fragmentShader: SCREEN_FRAG,
    fog: true,
  });
  const ledMat = new THREE.ShaderMaterial({
    name: 'loft-leds',
    uniforms: { ...fogUniforms(), uTime: time, uNight: sharedUniforms.uNight },
    vertexShader: LED_VERT,
    fragmentShader: LED_FRAG,
    fog: true,
  });

  return {
    /**
     * A screen quad (w × h) facing +Z in the frame `matrix`.
     * opts: { doc 0 (code) | 1 (terminal) | 2 (shader & misc), rows, speed (lines/s), phase }
     */
    addScreen(matrix, w, h, { doc = 0, rows = 14, speed = 1.4, phase = 0 } = {}) {
      const g = new THREE.PlaneGeometry(w, h);
      g.applyMatrix4(matrix);
      const n = g.attributes.position.count;
      const a = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) a.set([doc, rows, speed, phase], i * 4);
      g.setAttribute('aDoc', new THREE.BufferAttribute(a, 4));
      screens.push(g);
      return g;
    },
    /** A tiny LED (a squashed box) at `pos` (world), facing nowhere in particular. rate: 0 steady, <2 pulse, >2 flicker */
    addLed(pos, color = '#6dff8a', { rate = 3.5, phase = Math.random() * 10, size = 0.022, normal = null } = {}) {
      const g = new THREE.BoxGeometry(size, size, size * 0.6);
      if (normal) g.lookAt(normal);
      g.translate(pos.x, pos.y, pos.z);
      const n = g.attributes.position.count;
      const c = new THREE.Color(color);
      const col = new Float32Array(n * 3);
      const bl = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        col.set([c.r, c.g, c.b], i * 3);
        bl.set([rate, phase], i * 2);
      }
      g.deleteAttribute('uv');
      g.deleteAttribute('normal');
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aBlink', new THREE.BufferAttribute(bl, 2));
      leds.push(g);
      return g;
    },
    build(parent) {
      const out = {};
      if (screens.length) {
        const g = mergeGeometries(screens, false);
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, screenMat);
        m.name = 'loft-screens';
        m.matrixAutoUpdate = false;
        parent.add(m);
        out.screens = m;
      }
      if (leds.length) {
        const g = mergeGeometries(leds, false);
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, ledMat);
        m.name = 'loft-leds';
        m.matrixAutoUpdate = false;
        m.raycast = () => {};
        parent.add(m);
        out.leds = m;
      }
      return out;
    },
  };
}
