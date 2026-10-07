// ─────────────────────────────────────────────────────────────────────────────
// The illustrated map of the glen — drawn (once) from layout.js like a page of
// an old explorer's journal: parchment, inked forest crowns (the real trees
// when the forest has grown), the stream, pond, bridge and paths, the Great
// Oak, the houses, a compass rose — and a pin for every spot (real buttons).
//
//   createMap(ctx, { onPick(spotId) }) → { el, update(currentSpot) }
// ─────────────────────────────────────────────────────────────────────────────
import { OAK, SCHREINEREI, COTTAGE, STREAM, RIVERSIDE, PATHS, SPOTS } from '../world/layout.js';
import { createRng } from '../core/rng.js';
import { h, svg } from './dom.js';
import { spotIcon } from './icons.js';

const VB = { x: -33, y: -31, w: 66, h: 62 };

/**
 * Where each spot's pin stands on the map (x, z in world units) and which side
 * its label goes. The Wohnatelier and Jonny's cottage, and the Schreinerei and
 * the Code Loft above it, sit close together: their pins are spread apart
 * (>= 44 px between hit areas on a 390 px phone) and their labels kept on
 * opposite sides. The loft is up in the oak, so its pin hangs off the crown on
 * a dotted leader line.
 */
const PIN = {
  interior: { x: -24.5, z: 1.2, label: 'above' },
  home: { x: -14.2, z: 5.6, label: 'below' },
  woodworking: { x: -2.3, z: 0.4, label: 'below' },
  code: { x: 9.5, z: -10.5, label: 'right', leader: [OAK.loft.x, OAK.loft.z] },
  bikes: { x: 17.2, z: 7.4, label: 'below' },
  glen: { x: 0, z: 24, label: 'below' },
};

/** Catmull-Rom → cubic Bézier path through points [{x, z}]. */
function smoothPath(pts, close = false) {
  if (pts.length < 2) return '';
  const P = close ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
  let d = `M${P[1].x.toFixed(2)} ${P[1].z.toFixed(2)}`;
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1z = p1.z + (p2.z - p0.z) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2z = p2.z - (p3.z - p1.z) / 6;
    d += ` C${c1x.toFixed(2)} ${c1z.toFixed(2)} ${c2x.toFixed(2)} ${c2z.toFixed(2)} ${p2.x.toFixed(2)} ${p2.z.toFixed(2)}`;
  }
  return d;
}

/** A scalloped "cloud" tree crown seen from above. */
function crown(x, z, r, rng, fill, extra = '') {
  const n = Math.max(6, Math.round(r * 3.2));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const rr = r * rng.range(0.86, 1.06);
    pts.push({ x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr });
  }
  let d = `M${pts[0].x.toFixed(2)} ${pts[0].z.toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p = pts[(i + 1) % n];
    d += ` A${(r * 0.42).toFixed(2)} ${(r * 0.42).toFixed(2)} 0 0 1 ${p.x.toFixed(2)} ${p.z.toFixed(2)}`;
  }
  return `<path d="${d}z" fill="${fill}" stroke="#3d2f22" stroke-width=".16" ${extra}/>` +
    `<path d="M${(x - r * 0.45).toFixed(2)} ${(z + r * 0.2).toFixed(2)} q${(r * 0.3).toFixed(2)} ${(r * 0.35).toFixed(2)} ${(r * 0.75).toFixed(2)} ${(r * 0.15).toFixed(2)}" fill="none" stroke="#3d2f22" stroke-width=".12" opacity=".55"/>`;
}

/** A mushroom cap seen from above (with spots). */
function cap(x, z, r, fill, rng) {
  let s = `<circle cx="${x}" cy="${z}" r="${r}" fill="${fill}" stroke="#3d2f22" stroke-width=".2"/>`;
  for (let i = 0; i < Math.round(r * 2.4); i++) {
    const a = rng.range(0, Math.PI * 2), rr = rng.range(0.15, 0.75) * r;
    s += `<circle cx="${(x + Math.cos(a) * rr).toFixed(2)}" cy="${(z + Math.sin(a) * rr).toFixed(2)}" r="${(r * rng.range(0.07, 0.13)).toFixed(2)}" fill="#fff8ec" opacity=".9"/>`;
  }
  return s;
}

function label(x, z, text, { size = 1.5, rotate = 0, anchor = 'middle', cls = '' } = {}) {
  return `<text class="map-label ${cls}" x="${x}" y="${z}" font-size="${size}" text-anchor="${anchor}" transform="rotate(${rotate} ${x} ${z})">${text}</text>`;
}

function drawMap(ctx) {
  const rng = createRng('glen-map');
  const parts = [];
  // ── forest: the real trees once the forest has grown, else an inked ring ──
  const trees = ctx.forest?.trees ?? ctx.modules?.vegetation?.trees ?? null;
  const treeMarks = [];
  if (trees?.length) {
    for (const t of trees) {
      if (Math.abs(t.x) > 34 || t.z < -33 || t.z > 33) continue;
      treeMarks.push({ x: t.x, z: t.z, r: Math.min(4.6, 1.6 + t.radius * 0.9), birch: t.kind === 'birch' });
    }
  }
  // fill the margins so the parchment reads as deep forest
  for (let i = 0; i < 70; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(29, 40);
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.95;
    if (z > 24 && Math.abs(x) < 16) continue; // the open front where the path leaves
    treeMarks.push({ x, z, r: rng.range(2.2, 3.6) });
  }
  const greens = ['#8ea35f', '#7b9452', '#9aae69', '#6f8a4b'];
  for (const t of treeMarks.sort((a, b) => a.z - b.z)) parts.push(crown(t.x, t.z, t.r, rng, t.birch ? '#b7bd73' : rng.pick(greens)));

  // ── the stream, the pool under the falls and the lily pond ───────────────
  const streamPts = [{ x: STREAM.falls.lipX, z: STREAM.falls.lipZ }, ...STREAM.points];
  const sd = smoothPath(streamPts);
  parts.push(`<path d="${sd}" fill="none" stroke="#3d2f22" stroke-width="${STREAM.halfWidth * 2 + 0.5}" stroke-linecap="round"/>`);
  parts.push(`<path d="${sd}" fill="none" stroke="#9cc7cf" stroke-width="${STREAM.halfWidth * 2}" stroke-linecap="round"/>`);
  parts.push(`<path d="${sd}" fill="none" stroke="#e8f3ef" stroke-width=".18" stroke-dasharray="1.2 2.4" stroke-linecap="round" opacity=".9"/>`);
  for (const w of [STREAM.pool, STREAM.pond]) {
    parts.push(`<circle cx="${w.x}" cy="${w.z}" r="${w.radius + 0.25}" fill="#3d2f22"/>`, `<circle cx="${w.x}" cy="${w.z}" r="${w.radius}" fill="#9cc7cf"/>`);
    parts.push(`<circle cx="${w.x}" cy="${w.z}" r="${w.radius * 0.62}" fill="none" stroke="#e8f3ef" stroke-width=".14" stroke-dasharray=".8 1.4"/>`);
  }
  // lily pads on the pond
  for (let i = 0; i < 9; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(0.6, STREAM.pond.radius * 0.8);
    const x = STREAM.pond.x + Math.cos(a) * r, z = STREAM.pond.z + Math.sin(a) * r;
    parts.push(`<path d="M${x.toFixed(2)} ${z.toFixed(2)} l.55 -.2 A.6 .6 0 1 0 ${(x + 0.55).toFixed(2)} ${(z + 0.2).toFixed(2)}z" fill="#7b9452" stroke="#3d2f22" stroke-width=".08"/>`);
  }
  // the waterfall's rocks
  const F = STREAM.falls;
  for (let i = 0; i < 14; i++) {
    const a = rng.range(-Math.PI, Math.PI), r = rng.range(1.5, F.radius * 0.9);
    const x = F.x + Math.cos(a) * r, z = F.z + Math.sin(a) * r * 0.8;
    parts.push(`<ellipse cx="${x.toFixed(2)}" cy="${z.toFixed(2)}" rx="${rng.range(0.9, 1.7).toFixed(2)}" ry="${rng.range(0.7, 1.2).toFixed(2)}" fill="#b6ab95" stroke="#3d2f22" stroke-width=".14"/>`);
  }
  parts.push(`<path d="M${F.lipX - 0.6} ${F.lipZ - 0.4}l.3 1.6M${F.lipX} ${F.lipZ - 0.5}l.2 1.8M${F.lipX + 0.6} ${F.lipZ - 0.4}l.1 1.6" stroke="#e8f3ef" stroke-width=".28" stroke-linecap="round"/>`);

  // ── paths ──────────────────────────────────────────────────────────────────
  for (const key of Object.keys(PATHS)) {
    const pd = smoothPath(PATHS[key]);
    parts.push(`<path d="${pd}" fill="none" stroke="#c7a46e" stroke-width="${key === 'main' ? 1.9 : 1.3}" stroke-linecap="round" opacity=".85"/>`);
    parts.push(`<path d="${pd}" fill="none" stroke="#3d2f22" stroke-width=".16" stroke-dasharray=".5 .9" stroke-linecap="round" opacity=".7"/>`);
  }
  // the stone bridge
  const B = RIVERSIDE.bridge;
  const deg = (-B.rotY * 180) / Math.PI + 90;
  parts.push(`<g transform="translate(${B.x} ${B.z}) rotate(${deg})"><rect x="${-B.span / 2}" y="${-B.width / 2}" width="${B.span}" height="${B.width}" rx=".4" fill="#c9bfa9" stroke="#3d2f22" stroke-width=".2"/>` +
    `<path d="M${-B.span / 2 + 0.6} ${-B.width / 2}v${B.width}M${B.span / 2 - 0.6} ${-B.width / 2}v${B.width}" stroke="#3d2f22" stroke-width=".12"/></g>`);

  // ── the Great Oak: crown over its trunk ────────────────────────────────────
  parts.push(crown(OAK.x, OAK.z, 11.5, rng, '#5f7d3f', 'opacity=".9"'));
  parts.push(crown(OAK.x - 2.5, OAK.z - 1.5, 6.5, rng, '#6f8a4b', 'opacity=".75"'));
  parts.push(`<circle cx="${OAK.x}" cy="${OAK.z}" r="${OAK.baseRadius}" fill="#8a6440" stroke="#3d2f22" stroke-width=".22"/>`);
  parts.push(`<circle cx="${OAK.x}" cy="${OAK.z}" r="${OAK.baseRadius * 0.6}" fill="none" stroke="#3d2f22" stroke-width=".1" opacity=".6"/><circle cx="${OAK.x}" cy="${OAK.z}" r="${OAK.baseRadius * 0.28}" fill="none" stroke="#3d2f22" stroke-width=".1" opacity=".6"/>`);
  // the Code Loft's round platform
  parts.push(`<circle cx="${OAK.loft.x}" cy="${OAK.loft.z}" r="${OAK.loft.radius * 0.7}" fill="#c99a62" stroke="#3d2f22" stroke-width=".2" stroke-dasharray=".8 .3"/>`);

  // ── houses ─────────────────────────────────────────────────────────────────
  const A = SCHREINEREI.annex;
  parts.push(`<g transform="translate(${A.x} ${A.z}) rotate(${(-A.rotY * 180) / Math.PI})"><rect x="${-A.width / 2}" y="${-A.depth / 2}" width="${A.width}" height="${A.depth}" fill="#9b6b45" stroke="#3d2f22" stroke-width=".22"/>` +
    `<path d="M${-A.width / 2} 0H${A.width / 2}" stroke="#3d2f22" stroke-width=".16"/>${[...Array(6)].map((_, i) => `<path d="M${-A.width / 2 + 0.5 + i * 0.9} ${-A.depth / 2}v${A.depth}" stroke="#3d2f22" stroke-width=".06" opacity=".6"/>`).join('')}</g>`);
  const D = SCHREINEREI.deck;
  parts.push(`<g transform="translate(${D.x} ${D.z}) rotate(${(-D.rotY * 180) / Math.PI})"><rect x="-2" y="-1.4" width="4" height="2.8" fill="#d2a874" stroke="#3d2f22" stroke-width=".16"/></g>`);
  parts.push(cap(COTTAGE.home.x, COTTAGE.home.z, 3.6, '#c4402f', rng));
  parts.push(cap(COTTAGE.home.x - 2.4, COTTAGE.home.z + 2.2, 2.2, '#c9553a', rng));
  parts.push(cap(COTTAGE.atelier.x, COTTAGE.atelier.z, 3.1, '#d8a640', rng));
  parts.push(cap(COTTAGE.shed.x, COTTAGE.shed.z, 1.7, '#9a6a45', rng));
  parts.push(cap(RIVERSIDE.bikeShed.x, RIVERSIDE.bikeShed.z, 3.2, '#b8562a', rng));
  // giant fly agarics
  for (const g of ctx.forest?.giants ?? []) {
    if (Math.abs(g.x) > 30 || Math.abs(g.z) > 30) continue;
    parts.push(cap(g.x, g.z, Math.max(0.7, Math.min(2.4, (g.R ?? 1) * 0.9)), '#c4402f', rng));
  }

  // the Code Loft's pin hangs off the oak crown on a dotted leader
  for (const p of Object.values(PIN)) {
    if (!p.leader) continue;
    const [lx, lz] = p.leader;
    parts.push(`<path d="M${lx} ${lz} Q${((lx + p.x) / 2 + 2).toFixed(2)} ${((lz + p.z) / 2).toFixed(2)} ${p.x} ${p.z}" fill="none" stroke="#3d2f22" stroke-width=".26" stroke-dasharray=".7 .6" stroke-linecap="round"/>`);
    parts.push(`<circle cx="${lx}" cy="${lz}" r=".75" fill="#f1e3c0" stroke="#3d2f22" stroke-width=".22"/>`);
  }

  // ── lettering ──────────────────────────────────────────────────────────────
  parts.push(label(OAK.x + 0.3, OAK.z - 4.8, 'The Great Oak', { size: 1.9, cls: 'is-big' }));
  parts.push(label(STREAM.points[5].x + 3.4, STREAM.points[5].z - 1, 'the Bächli', { size: 1.4, rotate: -62, cls: 'is-water' }));
  parts.push(label(STREAM.pond.x, STREAM.pond.z + STREAM.pond.radius + 2, 'Lily Pond', { size: 1.3, cls: 'is-water' }));
  parts.push(label(F.x + 1, F.z - F.radius + 0.6, 'Waterfall', { size: 1.3, cls: 'is-water' }));
  parts.push(label(-27, -26.5, 'here be snails', { size: 1.25, rotate: -8, cls: 'is-faint', anchor: 'start' }));
  parts.push(label(24, 29.5, 'to the village ↓', { size: 1.15, cls: 'is-faint' }));

  // ── compass rose ──────────────────────────────────────────────────────────
  parts.push(`<g transform="translate(25.5 22.5)" class="map-compass">
    <circle r="3.4" fill="#f1e3c0" stroke="#3d2f22" stroke-width=".18"/><circle r="2.7" fill="none" stroke="#3d2f22" stroke-width=".08"/>
    <path d="M0 -3.1L.8 0L0 3.1L-.8 0z" fill="#3d2f22"/><path d="M0 -3.1L.8 0H-.8z" fill="#b8432f"/><path d="M-3.1 0L0 .6L3.1 0L0 -.6z" fill="#7a6a55"/>
    <text y="-3.9" font-size="1.4" text-anchor="middle" class="map-label">N</text></g>`);

  return `<svg class="map-svg" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" role="img" aria-label="Illustrated map of the glen">
    <defs>
      <filter id="map-ink" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency=".45" numOctaves="2" seed="5" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale=".35"/></filter>
      <filter id="map-paper"><feTurbulence type="fractalNoise" baseFrequency=".18" numOctaves="4" seed="11"/><feColorMatrix values="0 0 0 0 .52  0 0 0 0 .39  0 0 0 0 .2  0 0 0 -1.5 1.05"/></filter>
      <radialGradient id="map-burn" cx="50%" cy="50%" r="72%"><stop offset="62%" stop-color="#7a5326" stop-opacity="0"/><stop offset="100%" stop-color="#5a3a17" stop-opacity=".55"/></radialGradient>
      <radialGradient id="map-clearing" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#d9d39a"/><stop offset="70%" stop-color="#c9c88a"/><stop offset="100%" stop-color="#c9c88a" stop-opacity="0"/></radialGradient>
    </defs>
    <rect x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}" fill="#ecdcb4"/>
    <rect x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}" filter="url(#map-paper)" opacity=".5"/>
    <ellipse cx="0" cy="2" rx="28" ry="27" fill="url(#map-clearing)" opacity=".8"/>
    <clipPath id="map-clip"><rect x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}"/></clipPath>
    <g clip-path="url(#map-clip)"><g filter="url(#map-ink)">${parts.join('')}</g></g>
    <rect x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}" fill="url(#map-burn)"/>
    <rect x="${VB.x + 0.8}" y="${VB.y + 0.8}" width="${VB.w - 1.6}" height="${VB.h - 1.6}" fill="none" stroke="#3d2f22" stroke-width=".22"/>
    <rect x="${VB.x + 1.3}" y="${VB.y + 1.3}" width="${VB.w - 2.6}" height="${VB.h - 2.6}" fill="none" stroke="#3d2f22" stroke-width=".08"/>
  </svg>`;
}

export function createMap(ctx, { onPick } = {}) {
  let art = null;
  const pins = new Map();
  const stage = h('div', { class: 'map-stage' });
  const el = h(
    'div',
    { class: 'map' },
    h('div', { class: 'map__cartouche' }, h('span', { class: 'map__kicker' }, 'Drawn from memory'), h('span', { class: 'map__title' }, `${ctx.content.profile.name}’s Glen`)),
    stage,
    h('p', { class: 'map__hint' }, 'Pick a place and the camera will take you there.'),
  );

  function build() {
    art = svg(drawMap(ctx));
    stage.replaceChildren(art);
    for (const s of SPOTS) {
      if (s.id === 'glen') continue;
      const place = PIN[s.id] ?? { x: s.focus[0], z: s.focus[2], label: 'below' };
      const left = ((place.x - VB.x) / VB.w) * 100, top = ((place.z - VB.y) / VB.h) * 100;
      const pin = h(
        'button',
        {
          class: `map-pin is-label-${place.label}`,
          type: 'button',
          style: { left: `${left}%`, top: `${top}%` },
          'aria-label': `${s.title} — ${s.subtitle}`,
          onclick: () => onPick?.(s.id),
        },
        h('span', { class: 'map-pin__dot', html: spotIcon(s.id) }),
        h('span', { class: 'map-pin__label' }, s.title),
      );
      pins.set(s.id, pin);
      stage.append(pin);
    }
    // the overview "you are here" pin sits on the front path
    const ov = h(
      'button',
      { class: `map-pin is-overview is-label-${PIN.glen.label}`, type: 'button', style: { left: `${((PIN.glen.x - VB.x) / VB.w) * 100}%`, top: `${((PIN.glen.z - VB.y) / VB.h) * 100}%` }, 'aria-label': 'Overview of the whole glen', onclick: () => onPick?.('glen') },
      h('span', { class: 'map-pin__dot', html: spotIcon('glen') }),
      h('span', { class: 'map-pin__label' }, 'Overview'),
    );
    pins.set('glen', ov);
    stage.append(ov);
  }

  return {
    el,
    update(current) {
      if (!art) build();
      for (const [id, pin] of pins) {
        pin.classList.toggle('is-current', id === current);
        if (id === current) pin.setAttribute('aria-current', 'location');
        else pin.removeAttribute('aria-current');
      }
    },
  };
}
