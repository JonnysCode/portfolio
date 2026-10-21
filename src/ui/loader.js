// ─────────────────────────────────────────────────────────────────────────────
// Loader — dusk in the woods before the glen appears: a treeline in silhouette,
// mist and fireflies, and in the middle a little engraved medallion of the
// Great Oak. A ring of gold leaf closes round it as the world is built, a
// firefly riding its tip; leaves sprout along the ring and the oak's windows
// light up one by one. Pure HTML / CSS / inline SVG (it paints before the 3D
// world exists, so nothing heavy).
//
//   createLoader(root, { title, tagline }) → { el, setProgress(p, label), done(), fail(text) }
// ─────────────────────────────────────────────────────────────────────────────
import { h, svg, tagRoles } from './dom.js';

/** Where the leaves sprout round the ring (share of the way round, from the top). */
const LEAVES = [0.07, 0.19, 0.31, 0.43, 0.56, 0.68, 0.8, 0.92];
/** The oak's windows light at these points of the build. */
const LIGHTS = [0.3, 0.6, 0.9];
const R = 52; // ring radius (viewBox 0 0 140 140, centre 70 70)

const leaf = (u, i) => {
  const a = u * 360;
  const side = i % 2 ? 1 : -1;
  return `<g class="loader__leaf" style="--a:${a.toFixed(1)}deg"><g transform="rotate(${a.toFixed(1)} 70 70) translate(70 ${70 - R})"><path transform="rotate(${side * 58 + 90})" d="M0 0 C 2.6 -4.4, 8.6 -4.6, 11 0 C 7.6 3, 2.8 2.8, 0 0 Z"/></g></g>`;
};

const MEDALLION = `<svg class="loader__medal" viewBox="0 0 140 140" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="ld-gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff0bd"/><stop offset=".45" stop-color="#e9bd5b"/><stop offset="1" stop-color="#b7832c"/>
    </linearGradient>
    <radialGradient id="ld-halo">
      <stop offset="0" stop-color="#ffe9a3" stop-opacity=".9"/><stop offset=".35" stop-color="#ffd36e" stop-opacity=".35"/><stop offset="1" stop-color="#ffd36e" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ld-glow" cx=".5" cy=".46" r=".5">
      <stop offset="0" stop-color="#ffe7a6" stop-opacity=".34"/><stop offset=".55" stop-color="#e9bd5b" stop-opacity=".08"/><stop offset="1" stop-color="#e9bd5b" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="70" cy="70" r="66" fill="url(#ld-glow)"/>
  <circle class="loader__disc" cx="70" cy="70" r="${R - 7}"/>
  <circle class="loader__track" cx="70" cy="70" r="${R}"/>
  <circle class="loader__inner-rule" cx="70" cy="70" r="${R - 7}"/>
  <circle class="loader__ring" cx="70" cy="70" r="${R}" pathLength="100" transform="rotate(-90 70 70)"/>
  <g class="loader__leaves">${LEAVES.map(leaf).join('')}</g>
  <g class="loader__oak">
    <path class="loader__ground" d="M34 96 C 46 92, 58 93, 70 93 S 94 92, 106 96"/>
    <path class="loader__trunk" d="M63 93 C 64.5 85, 65 79, 63.6 72 M77 93 C 75.5 85, 75 79, 76.4 72 M63.6 72 C 60 69.5, 56 69, 52.5 70 M76.4 72 C 80 69.5, 84 69, 87.5 70 M66.5 74 C 68 70, 70.6 67.5, 73 66.6 M59 93 C 61 92, 62.6 91, 63 89 M81 93 C 79 92, 77.4 91, 77 89"/>
    <path class="loader__crown" d="M46.5 69.5 C 39 68.5, 36.5 60, 42 55.2 C 38.6 47.6, 45.4 40.4, 52.6 42.6 C 55 34.6, 66 31.6, 71.6 37.4 C 77.6 31.4, 89.4 34.6, 90.4 43.2 C 98 42.4, 103 50.6, 98.4 56.4 C 103.6 61.6, 99.4 70.4, 92.6 69.6 C 89 73.6, 82.6 73.6, 79.4 70 C 76 72.6, 70.6 72.4, 68 69.4 C 64.4 72.6, 58.2 72.6, 55 69.6 C 52.6 71.6, 48.6 71.4, 46.5 69.5 Z"/>
    <path class="loader__curls" d="M86 60 c 1.8 -2 4.6 -2 6 0 M44.6 62 c 1.6 -1.8 4.2 -2 5.8 -.4"/>
    <path class="loader__door" d="M67.6 93 v-5.4 a2.4 2.4 0 0 1 4.8 0 V93"/>
    <g class="loader__windows">
      <circle class="loader__win" cx="58.6" cy="60.8" r="1.7"/>
      <circle class="loader__win" cx="80.4" cy="53.6" r="1.7"/>
      <circle class="loader__win" cx="70" cy="44.2" r="1.5"/>
    </g>
    <path class="loader__cap" d="M44 93 c 0 -4.4 3 -6.6 6.2 -6.6 s 6.2 2.2 6.2 6.6 z M88.6 93 c 0 -3.2 2.2 -4.8 4.5 -4.8 s 4.5 1.6 4.5 4.8 z"/>
    <path class="loader__stalk" d="M48.8 93 v2.6 M51.6 93 v2.6 M92 93 v2 M94.2 93 v2"/>
    <g class="loader__dots"><circle cx="48.4" cy="89.6" r=".8"/><circle cx="52.6" cy="88.6" r=".7"/><circle cx="92.4" cy="90.6" r=".6"/></g>
  </g>
  <g class="loader__head" style="transform: rotate(0deg)"><circle cx="70" cy="${70 - R}" r="9" class="loader__halo" fill="url(#ld-halo)"/><circle cx="70" cy="${70 - R}" r="2.6" class="loader__spark"/></g>
</svg>`;

/**
 * A forest edge seen from afar: a row of rounded crowns (arcs between points
 * along a wavy baseline), drawn once from a fixed seed.
 */
function crowns(seed, base, rMin, rMax, wave) {
  let t = seed;
  const rnd = () => ((t = (t * 16807) % 2147483647) / 2147483647);
  let x = -20;
  let y = base + Math.sin(x / 140) * wave;
  let d = `M-20 260 L-20 ${y.toFixed(1)}`;
  while (x < 1220) {
    const r = rMin + rnd() * (rMax - rMin);
    const nx = x + r * (1.1 + rnd() * 0.6);
    const ny = base + Math.sin(nx / 140) * wave + (rnd() - 0.5) * r * 0.5;
    d += ` A${r.toFixed(1)} ${(r * (0.9 + rnd() * 0.3)).toFixed(1)} 0 0 1 ${nx.toFixed(1)} ${ny.toFixed(1)}`;
    x = nx;
    y = ny;
  }
  return `${d} L1220 260 Z`;
}

/** The woods at dusk: two ranks of crowns fading into the mist, then the near dark with two old trees and two mushroom houses. */
const TREELINE = `<svg class="loader__woods" viewBox="0 0 1200 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
  <path class="loader__rank is-far" d="${crowns(7, 150, 16, 30, 10)}"/>
  <path class="loader__rank is-mid" d="${crowns(29, 186, 22, 42, 14)}"/>
  <g class="loader__rank is-near">
    <path d="M0 260 V214 C 60 204, 120 210, 180 214 C 250 220, 320 206, 400 212 C 470 218, 520 222, 600 220 C 680 218, 740 208, 820 212 C 900 216, 960 222, 1040 214 C 1110 208, 1160 212, 1200 216 V260 Z"/>
    <path d="M98 214 C 96 196, 92 180, 96 166 C 74 168, 58 156, 62 142 C 48 132, 56 112, 74 114 C 76 96, 98 90, 110 102 C 124 90, 148 98, 146 116 C 164 116, 170 136, 156 146 C 162 160, 146 170, 128 166 C 124 180, 122 196, 124 214 Z"/>
    <path d="M1080 216 C 1078 200, 1074 186, 1078 172 C 1058 172, 1044 160, 1050 146 C 1038 134, 1048 116, 1064 120 C 1068 102, 1090 98, 1100 110 C 1116 100, 1138 110, 1134 126 C 1150 128, 1154 146, 1140 154 C 1144 166, 1130 174, 1114 170 C 1110 184, 1108 200, 1110 216 Z"/>
    <path d="M226 214 c 0 -8 2 -14 2 -20 c -14 0 -24 -4 -24 -10 c 0 -10 14 -20 32 -20 s 32 10 32 20 c 0 6 -10 10 -24 10 c 0 6 2 12 2 20 z"/>
    <path d="M960 216 c 0 -6 1.6 -11 1.6 -15 c -10 0 -18 -3 -18 -8 c 0 -8 10 -15 24 -15 s 24 7 24 15 c 0 5 -8 8 -18 8 c 0 4 1.6 9 1.6 15 z"/>
  </g>
  <g class="loader__windows-far"><rect x="231" y="200" width="6" height="7" rx="3"/><rect x="964" y="203" width="5" height="6" rx="2.5"/></g>
</svg>`;

export function createLoader(root, { title, tagline }) {
  const art = svg(MEDALLION);
  const ring = art.querySelector('.loader__ring');
  const head = art.querySelector('.loader__head');
  const leaves = [...art.querySelectorAll('.loader__leaf')].map((g, i) => ({ u: LEAVES[i], g }));
  const wins = [...art.querySelectorAll('.loader__win')].map((g, i) => ({ u: LIGHTS[i], g }));

  const flies = h('div', { class: 'loader__flies', 'aria-hidden': 'true' });
  for (let i = 0; i < 16; i++) {
    flies.append(
      h('i', {
        style: {
          left: `${(i * 61 + 7) % 100}%`,
          top: `${38 + ((i * 37) % 58)}%`,
          animationDelay: `${(-(i * 0.91) % 7).toFixed(2)}s, ${(-(i * 0.53) % 3).toFixed(2)}s`,
          animationDuration: `${8 + (i % 5) * 1.6}s, ${2.4 + (i % 4) * 0.7}s`,
          '--s': `${(0.6 + ((i * 7) % 5) * 0.16).toFixed(2)}`,
        },
      }),
    );
  }
  const label = h('div', { class: 'loader__label' }, 'Planting mushrooms…');
  const bar = h('div', { class: 'loader__bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Loading the woodland' }, art);
  const el = h(
    'div',
    { class: 'loader', role: 'status' },
    h('div', { class: 'loader__sky', 'aria-hidden': 'true' }),
    svg(TREELINE),
    h('div', { class: 'loader__mist', 'aria-hidden': 'true' }),
    flies,
    h(
      'div',
      { class: 'loader__inner' },
      bar,
      h('div', { class: 'loader__kicker' }, 'Welcome to'),
      h('h1', { class: 'loader__title' }, title),
      tagline && h('div', { class: 'loader__tag' }, tagRoles(tagline)),
      label,
    ),
  );
  root.append(el);

  // the lettering fades in once its typeface has arrived (no flash of a stand-in serif);
  // a slow network shows it anyway after a moment
  const typeset = () => el.classList.add('is-typeset');
  try {
    Promise.race([
      Promise.all(['400 48px "Fraunces Woodland"', '600 12px "Nunito Woodland"'].map((f) => document.fonts.load(f))),
      new Promise((r) => setTimeout(r, 1400)),
    ]).then(typeset, typeset);
  } catch {
    typeset();
  }

  let shown = 0;
  const api = {
    el,
    setProgress(p, text) {
      const k = Math.max(shown, Math.min(1, p));
      shown = k;
      ring.style.strokeDashoffset = `${(100 * (1 - k)).toFixed(2)}`;
      head.style.transform = `rotate(${(k * 360).toFixed(1)}deg)`;
      head.classList.toggle('is-on', k > 0.004 && k < 0.999);
      for (const l of leaves) l.g.classList.toggle('is-grown', l.u <= k);
      for (const w of wins) w.g.classList.toggle('is-lit', w.u <= k);
      bar.setAttribute('aria-valuenow', String(Math.round(k * 100)));
      if (text && text !== label.textContent) {
        label.textContent = text;
        // (a gentle re-ink of the line on each new step)
        label.classList.remove('is-new');
        void label.offsetWidth;
        label.classList.add('is-new');
      }
    },
    done() {
      el.classList.add('is-done');
      setTimeout(() => el.remove(), 1100);
    },
    fail(text) {
      label.textContent = text;
      el.classList.add('is-failed');
    },
  };
  api.setProgress(0);
  return api;
}
