// ─────────────────────────────────────────────────────────────────────────────
// Loader — a snail crawls along a growing vine while fireflies drift in the
// dark: the progress bar of the woodland.
//
//   createLoader(root, { title }) → { setProgress(p, label), done(), el }
// ─────────────────────────────────────────────────────────────────────────────
import { h, svg } from './dom.js';

const VINE = 'M10 40 C 60 10, 100 66, 150 38 S 240 12, 290 40 S 380 64, 430 34 S 500 20, 530 38';
const LEAVES = [0.08, 0.17, 0.27, 0.36, 0.46, 0.55, 0.64, 0.74, 0.83, 0.92];

export function createLoader(root, { title, tagline }) {
  const art = svg(`<svg class="loader__vine" viewBox="0 0 540 80" aria-hidden="true">
    <path class="vine-ghost" d="${VINE}"/>
    <path class="vine-grown" d="${VINE}"/>
    <g class="vine-leaves"></g>
    <g class="vine-snail">
      <path d="M-15 2 C-15 -3, -9 -5, -2 -5 L 12 -5 C 15 -5, 17 -3, 18 0 L 18 2 Z" fill="#e9d7b8" stroke="#3d2f22" stroke-width="1.2"/>
      <path d="M14 -4 L17 -13 M11 -4 L12 -12" stroke="#3d2f22" stroke-width="1.2" stroke-linecap="round"/>
      <circle cx="17" cy="-13.5" r="1.6" fill="#3d2f22"/><circle cx="12" cy="-12.5" r="1.4" fill="#3d2f22"/>
      <circle cx="-4" cy="-10" r="9.5" fill="#d9903f" stroke="#3d2f22" stroke-width="1.3"/>
      <path d="M-4 -10 m0 -6 a6 6 0 1 1 -5.6 8.2 a3.8 3.8 0 1 1 5.2 -4.4" fill="none" stroke="#3d2f22" stroke-width="1.1"/>
    </g>
  </svg>`);
  const ghost = art.querySelector('.vine-ghost');
  const grown = art.querySelector('.vine-grown');
  const leavesG = art.querySelector('.vine-leaves');
  const snail = art.querySelector('.vine-snail');
  const total = ghost.getTotalLength?.() ?? 560;
  grown.style.strokeDasharray = `${total}`;
  grown.style.strokeDashoffset = `${total}`;
  const leaves = LEAVES.map((u, i) => {
    const p = ghost.getPointAtLength?.(u * total) ?? { x: u * 540, y: 40 };
    const side = i % 2 ? 1 : -1;
    const g = svg(`<svg><g class="vine-leaf" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${side * 35 - 20})"><path d="M0 0 C 4 ${-8 * side}, 14 ${-8 * side}, 18 0 C 12 ${5 * side}, 5 ${4 * side}, 0 0 Z" fill="#7da24a" stroke="#2f4a22" stroke-width=".9"/><path d="M1 0 L 15 ${-1 * side}" stroke="#2f4a22" stroke-width=".6"/></g></svg>`).firstElementChild;
    leavesG.append(g);
    return { u, g };
  });

  const flies = h('div', { class: 'loader__flies', 'aria-hidden': 'true' });
  for (let i = 0; i < 18; i++) {
    flies.append(h('i', { style: { left: `${(i * 53) % 100}%`, top: `${(i * 37 + 11) % 100}%`, animationDelay: `${-(i * 0.73) % 6}s`, animationDuration: `${5 + (i % 5)}s` } }));
  }
  const label = h('div', { class: 'loader__label' }, 'Planting mushrooms…');
  const bar = h('div', { class: 'loader__bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Loading the woodland' }, art);
  const el = h(
    'div',
    { class: 'loader', role: 'status' },
    flies,
    h('div', { class: 'loader__inner' }, h('div', { class: 'loader__kicker' }, 'Welcome to'), h('h1', { class: 'loader__title' }, title), tagline && h('div', { class: 'loader__tag' }, tagline), bar, label),
  );
  root.append(el);

  let shown = 0;
  return {
    el,
    setProgress(p, text) {
      const k = Math.max(shown, Math.min(1, p));
      shown = k;
      grown.style.strokeDashoffset = `${total * (1 - k)}`;
      const pt = ghost.getPointAtLength?.(k * total) ?? { x: 10 + k * 520, y: 40 };
      const ahead = ghost.getPointAtLength?.(Math.min(total, k * total + 4)) ?? { x: pt.x + 4, y: pt.y };
      const ang = (Math.atan2(ahead.y - pt.y, ahead.x - pt.x) * 180) / Math.PI;
      snail.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${(pt.y - 2).toFixed(1)}) rotate(${ang.toFixed(1)})`);
      for (const l of leaves) l.g.classList.toggle('is-grown', l.u <= k);
      bar.setAttribute('aria-valuenow', String(Math.round(k * 100)));
      if (text) label.textContent = text;
    },
    done() {
      el.classList.add('is-done');
      setTimeout(() => el.remove(), 900);
    },
    fail(text) {
      label.textContent = text;
      el.classList.add('is-failed');
    },
  };
}
