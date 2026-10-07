// ─────────────────────────────────────────────────────────────────────────────
// The journal page — an entry opened from the glen, styled like a page of a
// cabinetmaker's field journal: kraft paper held by washi tape, a hand-lettered
// title, polaroids (or a pencil sketch while there are no photos), the facts
// as a Stückliste (cut list), paper tags, stamped links and prev/next within
// the area. Desktop: a page on the right. Phones: a bottom sheet you can pull
// down to close.
//
//   createJournal(ctx, { onClose, onNavigate(entryId) }) →
//     { el, open(entry, { siblings }), close(), isOpen, inset() → { right, bottom } }
// ─────────────────────────────────────────────────────────────────────────────
import { AREA_BY_ID } from '../world/layout.js';
import { h, svg, trapFocus } from './dom.js';
import { icon, spotIcon } from './icons.js';
import { sketchFor } from './sketches.js';

const FLOURISH = `<svg class="journal__flourish" viewBox="0 0 220 14" aria-hidden="true"><path d="M2 8 C 40 2, 70 12, 110 7 S 180 3, 218 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M104 7 c 3 -5 9 -5 9 0 c 0 4 -6 5 -8 2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;

const KIND_LABEL = { project: 'Project', credential: 'Credential', about: 'About', contact: 'Contact', note: 'Note' };

export function createJournal(ctx, { onClose, onNavigate } = {}) {
  const { content } = ctx;
  const body = h('div', { class: 'journal__content' });
  const closeBtn = h('button', { class: 'journal__close', type: 'button', 'aria-label': 'Close the journal page', html: icon('close'), onclick: () => onClose?.() });
  const grip = h('div', { class: 'journal__grip', 'aria-hidden': 'true' }, h('span'));
  const sheet = h('div', { class: 'journal__sheet' }, grip, closeBtn, body);
  const el = h('aside', { class: 'journal', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'journal-title', 'aria-hidden': 'true', tabindex: '-1' }, h('i', { class: 'journal__tape is-left', 'aria-hidden': 'true' }), h('i', { class: 'journal__tape is-right', 'aria-hidden': 'true' }), sheet);
  let releaseTrap = null;
  let isOpen = false;
  let lastFocus = null;

  // ── pull the bottom sheet down to close it (phones) ──────────────────────
  let drag = null;
  const startDrag = (e) => {
    if (!matchMedia('(max-width: 720px)').matches) return;
    if (e.target.closest('button, a') && e.target !== grip) return;
    if (sheet.scrollTop > 2 && !grip.contains(e.target)) return;
    drag = { y: e.clientY, dy: 0, id: e.pointerId };
    el.classList.add('is-dragging');
  };
  sheet.addEventListener('pointerdown', startDrag);
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dy = Math.max(0, e.clientY - drag.y);
    el.style.transform = `translateY(${drag.dy}px)`;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = drag.dy;
    drag = null;
    el.classList.remove('is-dragging');
    el.style.transform = '';
    if (dy > 90) onClose?.();
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  function figure(entry) {
    if (entry.images?.length) {
      return h(
        'div',
        { class: 'journal__photos' },
        entry.images.map((im, i) =>
          h('figure', { class: 'polaroid', style: { '--tilt': `${(i % 2 ? 1 : -1) * (1.5 + (i % 3))}deg` } }, h('img', { src: im.src, alt: im.alt ?? '', loading: 'lazy' }), im.alt && h('figcaption', {}, im.alt)),
        ),
      );
    }
    return h('figure', { class: 'polaroid is-sketch', style: { '--tilt': '-2deg' } }, svg(sketchFor(entry)), h('figcaption', {}, 'sketch · photos coming soon'));
  }

  function cutList(entry) {
    if (!entry.facts?.length) return null;
    return h(
      'section',
      { class: 'cutlist', 'aria-label': 'Facts' },
      h('h3', { class: 'cutlist__title' }, 'Stückliste ', h('span', {}, '· cut list')),
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Pos.'), h('th', { scope: 'col' }, 'Part'), h('th', { scope: 'col' }, 'Spec'))),
        h('tbody', {}, entry.facts.map(([k, v], i) => h('tr', {}, h('td', { class: 'cutlist__pos' }, String(i + 1).padStart(2, '0')), h('th', { scope: 'row' }, k), h('td', {}, v)))),
      ),
    );
  }

  function links(entry) {
    const out = [];
    if (entry.kind === 'contact') {
      if (content.profile.email) out.push(h('a', { class: 'stamp-btn is-primary', href: `mailto:${content.profile.email}` }, h('span', { html: icon('mail') }), 'Write me a letter'));
      for (const l of content.profile.links ?? []) out.push(h('a', { class: 'stamp-btn', href: l.href, target: '_blank', rel: 'noopener' }, h('span', { html: icon(l.icon === 'github' ? 'github' : 'link') }), l.label));
    }
    for (const l of entry.links ?? []) out.push(h('a', { class: 'stamp-btn', href: l.href, target: '_blank', rel: 'noopener' }, h('span', { html: icon('link') }), l.label));
    return out.length ? h('div', { class: 'journal__links' }, out) : null;
  }

  function nav(entry, siblings) {
    if (!siblings || siblings.length < 2) return null;
    const i = siblings.findIndex((s) => s.id === entry.id);
    const prev = siblings[(i - 1 + siblings.length) % siblings.length];
    const next = siblings[(i + 1) % siblings.length];
    return h(
      'nav',
      { class: 'journal__nav', 'aria-label': 'More from this place' },
      h('button', { type: 'button', class: 'journal__navbtn', onclick: () => onNavigate?.(prev.id), 'aria-label': `Previous: ${prev.title}` }, h('span', { html: icon('left') }), h('span', { class: 'journal__navtitle' }, prev.title)),
      h('span', { class: 'journal__count' }, `${i + 1} / ${siblings.length}`),
      h('button', { type: 'button', class: 'journal__navbtn is-next', onclick: () => onNavigate?.(next.id), 'aria-label': `Next: ${next.title}` }, h('span', { class: 'journal__navtitle' }, next.title), h('span', { html: icon('right') })),
    );
  }

  function render(entry, siblings) {
    const area = AREA_BY_ID[entry.area];
    const info = content.areas[entry.area];
    const visited = ctx.interactions?.isVisited?.(entry.id);
    return [
      h(
        'header',
        { class: 'journal__head' },
        h('div', { class: 'journal__kicker' }, h('span', { class: 'journal__kicon', html: spotIcon(entry.area) }), info?.title ?? area?.title ?? '', h('span', { class: 'journal__kdot' }, '·'), KIND_LABEL[entry.kind] ?? 'Entry'),
        h('h2', { id: 'journal-title', class: 'journal__title' }, entry.title),
        svg(FLOURISH),
        entry.subtitle && h('p', { class: 'journal__subtitle' }, entry.subtitle),
        entry.year && h('span', { class: 'journal__stamp', 'aria-label': `Year: ${entry.year}` }, entry.year),
        visited && h('span', { class: 'journal__visited', title: 'Already in your journal', html: icon('leaf') }),
      ),
      figure(entry),
      h('div', { class: 'journal__body' }, (entry.body ?? []).map((p) => h('p', {}, p))),
      cutList(entry),
      entry.tags?.length && h('ul', { class: 'journal__tags', 'aria-label': 'Tags' }, entry.tags.map((t) => h('li', { class: 'paper-tag' }, t))),
      links(entry),
      nav(entry, siblings),
    ];
  }

  const api = {
    el,
    get isOpen() {
      return isOpen;
    },
    open(entry, { siblings } = {}) {
      const was = isOpen;
      if (!was) lastFocus = document.activeElement;
      body.replaceChildren(...render(entry, siblings).filter(Boolean));
      sheet.scrollTop = 0;
      el.setAttribute('aria-hidden', 'false');
      el.classList.add('is-open');
      // a page turn when flipping between entries
      if (was) {
        el.classList.remove('is-flip');
        void el.offsetWidth;
        el.classList.add('is-flip');
      }
      isOpen = true;
      releaseTrap?.();
      releaseTrap = trapFocus(el);
      requestAnimationFrame(() => body.querySelector('#journal-title')?.focus?.({ preventScroll: true }));
      body.querySelector('#journal-title')?.setAttribute('tabindex', '-1');
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      el.classList.remove('is-open', 'is-flip');
      el.setAttribute('aria-hidden', 'true');
      releaseTrap?.();
      releaseTrap = null;
      if (lastFocus && document.contains(lastFocus) && lastFocus !== document.body) lastFocus.focus?.({ preventScroll: true });
      else ctx.engine?.renderer?.domElement?.focus?.({ preventScroll: true });
    },
    /** Screen space the page covers (for the camera's framing). */
    inset() {
      if (!isOpen) return { right: 0, bottom: 0 };
      if (matchMedia('(max-width: 720px)').matches) return { right: 0, bottom: el.getBoundingClientRect().height * 0.92 };
      return { right: el.getBoundingClientRect().width + 24, bottom: 0 };
    },
  };
  return api;
}
