// ─────────────────────────────────────────────────────────────────────────────
// The journal page — an entry opened from the glen, styled like a page of a
// cabinetmaker's field journal: kraft paper held by washi tape, a hand-lettered
// title, polaroids (the owner's photos — or, until there are any, a live
// polaroid of the real piece as it stands in the glen with the pencil sketch
// tucked behind it; polaroid.js), the facts as a Stückliste (cut list), paper
// tags, stamped links and prev/next within the area. Desktop: a page on the
// right. Phones: a bottom sheet you can pull down to close.
// Without a mail address the contact & about pages never promise a letter: the
// strongest link leads ("Find me on GitHub").
//
//   createJournal(ctx, { onClose, onNavigate(entryId), polaroids }) →
//     { el, open(entry, { siblings }), close(), isOpen, inset() → { right, bottom } }
// ─────────────────────────────────────────────────────────────────────────────
import { AREA_BY_ID } from '../world/layout.js';
import { h, svg } from './dom.js';
import { icon, spotIcon } from './icons.js';
import { sketchFor } from './sketches.js';
import { presentEntry, reachOut, showDrafts } from './draft.js';

const FLOURISH = `<svg class="journal__flourish" viewBox="0 0 220 14" aria-hidden="true"><path d="M2 8 C 40 2, 70 12, 110 7 S 180 3, 218 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M104 7 c 3 -5 9 -5 9 0 c 0 4 -6 5 -8 2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;

const KIND_LABEL = { project: 'Project', credential: 'Credential', about: 'About', contact: 'Contact', note: 'Note' };

const LINK_ICON = { github: 'github', linkedin: 'linkedin' };
const linkIcon = (l) => LINK_ICON[l.icon] ?? 'link';

export function createJournal(ctx, { onClose, onNavigate, polaroids } = {}) {
  const { content } = ctx;
  const body = h('div', { class: 'journal__content' });
  const closeBtn = h('button', { class: 'journal__close', type: 'button', 'aria-label': 'Close the journal page', html: icon('close'), onclick: () => onClose?.() });
  const grip = h('div', { class: 'journal__grip', 'aria-hidden': 'true' }, h('span'));
  const sheet = h('div', { class: 'journal__sheet' }, grip, closeBtn, body);
  const el = h('aside', { class: 'journal', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'journal-title', 'aria-hidden': 'true', tabindex: '-1' }, h('i', { class: 'journal__tape is-left', 'aria-hidden': 'true' }), h('i', { class: 'journal__tape is-right', 'aria-hidden': 'true' }), sheet);
  let isOpen = false;
  let cachedInset = null;
  let cachedAt = 0;
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

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sketchCard = (entry, cls = '') => h('figure', { class: `polaroid is-sketch${cls}`, style: { '--tilt': '3deg' }, 'aria-hidden': 'true' }, svg(sketchFor(entry)), h('figcaption', {}, 'sketch'));

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
    // no photos yet: a polaroid of the piece itself, taken in the glen (the sketch
    // tucked behind it) — about & contact get theirs (the portrait, the mailbox) without a sketch
    const people = entry.kind === 'contact' || entry.kind === 'about';
    if (polaroids?.available(entry.id)) return livePolaroid(entry, people);
    // no 3D object to photograph: a small pencil sketch pinned beside the text (none
    // for the about / contact pages, where the words and the buttons are the point)
    return people ? null : sketchCard(entry);
  }

  /** The real piece, photographed in the glen (developing in place the first time). */
  function livePolaroid(entry, people) {
    const place = ctx.content.areas[entry.area]?.title ?? AREA_BY_ID[entry.area]?.title ?? '';
    const cached = polaroids.cached(entry.id);
    // ('in the Schreinerei', 'in Jonny’s Cottage')
    const where = place ? `in ${/’s\b|'s\b/.test(place) ? '' : 'the '}${place}` : '';
    const img = h('img', { alt: where ? `${entry.title}, as it stands ${where}` : entry.title, decoding: 'async', width: 630, height: 420 });
    const photo = h(
      'figure',
      { class: `polaroid is-photo${cached ? '' : ' is-developing'}`, style: { '--tilt': '-2.2deg' } },
      h('span', { class: 'polaroid__window' }, img),
      where && h('figcaption', {}, `seen ${where}`),
    );
    const wrap = h('div', { class: `journal__figure${people ? ' is-solo' : ''}` }, photo, !people && sketchCard(entry, ' is-tucked'));
    const develop = (url) => {
      if (!url) {
        // nothing to photograph after all: back to the sketch alone (or nothing)
        wrap.replaceWith(...[people ? null : sketchCard(entry)].filter(Boolean));
        return;
      }
      img.src = url;
      // (a frame later, so the change is seen; the timer when no frames come — a hidden tab)
      const done = () => {
        requestAnimationFrame(() => photo.classList.remove('is-developing'));
        setTimeout(() => photo.classList.remove('is-developing'), 80);
      };
      if (reduced()) photo.classList.remove('is-developing');
      else img.decode?.().then(done, done) ?? done();
    };
    if (cached) img.src = cached;
    else polaroids.request(entry.id, { live: true }).then(develop);
    return wrap;
  }

  function cutList(facts) {
    if (!facts?.length) return null;
    return h(
      'section',
      { class: 'cutlist', 'aria-label': 'Facts' },
      h('h3', { class: 'cutlist__title' }, 'Stückliste ', h('span', {}, '· cut list')),
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Pos.'), h('th', { scope: 'col' }, 'Part'), h('th', { scope: 'col' }, 'Spec'))),
        h('tbody', {}, facts.map(([k, v, draft], i) => h('tr', { class: draft ? 'is-draft' : null }, h('td', { class: 'cutlist__pos' }, String(i + 1).padStart(2, '0')), h('th', { scope: 'row' }, k), h('td', {}, v)))),
      ),
    );
  }

  const linkBtn = (l, primary = false) =>
    h('a', { class: `stamp-btn${primary ? ' is-primary' : ''}`, href: l.href, target: '_blank', rel: 'noopener' }, h('span', { html: icon(linkIcon(l)) }), primary ? `Find me on ${l.label}` : l.label);

  function links(entry, siblings) {
    const out = [];
    if (entry.kind === 'contact' || entry.kind === 'about') {
      // a letter only with a real address; otherwise the strongest link leads ("Find me on GitHub")
      const reach = reachOut(content.profile);
      if (entry.kind === 'contact' && reach.mail) {
        const mail = reach.mail;
        out.push(h('a', { class: `stamp-btn is-primary${mail.draft ? ' is-draft' : ''}`, href: `mailto:${mail.email}`, title: mail.draft ? 'draft: put the real address into content.js' : null }, h('span', { html: icon('mail') }), 'Write me a letter'));
      }
      if (entry.kind === 'about' && reach.mail) {
        // the next step after "who is this?": say hello (only worth a page when there is a mailbox)
        const hello = siblings?.find((s) => s.kind === 'contact');
        if (hello) out.push(h('button', { type: 'button', class: 'stamp-btn is-primary', onclick: () => onNavigate?.(hello.id) }, h('span', { html: icon('mail') }), `${hello.title} `, h('span', { class: 'stamp-btn__arrow', html: icon('right') })));
      }
      if (reach.primary) out.push(linkBtn(reach.primary, true));
      for (const l of reach.others) out.push(linkBtn(l));
    }
    for (const l of entry.links ?? []) out.push(h('a', { class: 'stamp-btn', href: l.href, target: '_blank', rel: 'noopener' }, h('span', { html: icon('link') }), l.label));
    return out.length ? h('div', { class: 'journal__links' }, out) : null;
  }

  function nav(entry, siblings) {
    if (!siblings || siblings.length < 2) return null;
    const i = siblings.findIndex((s) => s.id === entry.id);
    if (siblings.length === 2) {
      // two pages: one clear button to the other (not the same title on both sides)
      const other = siblings[1 - Math.max(0, i)];
      const fwd = i <= 0;
      return h(
        'nav',
        { class: 'journal__nav is-pair', 'aria-label': 'More from this place' },
        h('button', { type: 'button', class: 'journal__navbtn is-pair', onclick: () => onNavigate?.(other.id), 'aria-label': `${fwd ? 'Next' : 'Back to'}: ${other.title}` }, !fwd && h('span', { html: icon('left') }), h('span', { class: 'journal__navtitle' }, fwd ? `Next: ${other.title}` : `Back to ${other.title}`), fwd && h('span', { html: icon('right') })),
      );
    }
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

  /** The words, with the picture after the first paragraph (a pinned sketch floats beside them). */
  function words(entry, shown) {
    const fig = figure(entry);
    const paras = shown.body.map((p) => h('p', { class: p.draft ? 'is-draft' : null }, p.text));
    const block = fig && !fig.classList.contains('is-sketch');
    return h('div', { class: 'journal__body' }, block ? [paras[0], fig, paras.slice(1)] : [fig, paras]);
  }

  function render(entry, siblings) {
    const area = AREA_BY_ID[entry.area];
    const info = content.areas[entry.area];
    const visited = ctx.interactions?.isVisited?.(entry.id);
    const shown = presentEntry(entry);
    // about & contact: the buttons come right under the title (the call to action above the fold)
    const ctaFirst = entry.kind === 'contact' || entry.kind === 'about';
    const cta = links(entry, siblings);
    return [
      h(
        'header',
        { class: 'journal__head' },
        h('div', { class: 'journal__kicker' }, h('span', { class: 'journal__kicon', html: spotIcon(entry.area) }), info?.title ?? area?.title ?? '', h('span', { class: 'journal__kdot' }, '·'), KIND_LABEL[entry.kind] ?? 'Entry'),
        h('h2', { id: 'journal-title', class: 'journal__title' }, entry.title),
        svg(FLOURISH),
        entry.subtitle && h('p', { class: `journal__subtitle${visited ? ' has-leaf' : ''}` }, entry.subtitle),
        shown.year && h('span', { class: `journal__stamp${shown.yearDraft ? ' is-draft' : ''}`, 'aria-label': shown.yearDraft ? 'Year: still a draft' : `Year: ${shown.year}` }, shown.year),
        visited && h('span', { class: 'journal__visited', title: 'Already in your journal', html: icon('leaf') }),
      ),
      ctaFirst && cta,
      words(entry, shown),
      cutList(shown.facts),
      entry.tags?.length && h('ul', { class: 'journal__tags', 'aria-label': 'Tags' }, entry.tags.map((t) => h('li', { class: 'paper-tag' }, t))),
      !ctaFirst && cta,
      // a sticky foot: prev/next always at hand, and a "more ↓" cue while the page scrolls on
      h('div', { class: 'journal__foot' }, moreBtn, nav(entry, siblings)),
    ];
  }
  const moreBtn = h('button', { class: 'journal__more', type: 'button', tabindex: '-1', 'aria-hidden': 'true', onclick: () => sheet.scrollBy({ top: sheet.clientHeight * 0.7, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }, 'more ', h('span', { 'aria-hidden': 'true' }, '↓'));
  /** Is there more of the page below the fold? (the cue shows until the end is reached) */
  function syncMore() {
    const more = isOpen && sheet.scrollHeight - sheet.scrollTop - sheet.clientHeight > 24;
    el.classList.toggle('has-more', more);
  }
  sheet.addEventListener('scroll', syncMore, { passive: true });
  window.addEventListener('resize', () => isOpen && syncMore());

  /** Focus the page's title (retrying a few frames while it cannot take focus yet). */
  function focusTitle(title, tries, first = true) {
    if (!title || !isOpen || !title.isConnected) return;
    const a = document.activeElement;
    // (a retry gives way once the visitor has moved focus on purpose)
    const idle = !a || a === document.body || a === title || a === lastFocus || a.classList?.contains('hs-btn') || a === ctx.engine?.renderer?.domElement;
    if (!first && !idle) return;
    if (a !== title) title.focus({ preventScroll: true });
    if (document.activeElement !== title && tries > 0) requestAnimationFrame(() => focusTitle(title, tries - 1, false));
  }

  const api = {
    el,
    /** Is keyboard focus inside the page? */
    get hasFocus() {
      return el.contains(document.activeElement);
    },
    get isOpen() {
      return isOpen;
    },
    open(entry, { siblings } = {}) {
      const was = isOpen;
      el.classList.toggle('shows-drafts', showDrafts);
      if (!was) lastFocus = document.activeElement;
      cachedInset = null;
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
      // a non-modal page: Tab may still reach the spot bar & HUD (Esc closes it).
      // Focus moves to the title at once — the page is visible as soon as it is
      // open (no visibility transition on the way in; reduced motion too). Should
      // the browser not take it yet, try again on the coming frames.
      const title = body.querySelector('#journal-title');
      title?.setAttribute('tabindex', '-1');
      focusTitle(title, 4);
      requestAnimationFrame(() => syncMore());
      setTimeout(syncMore, 650); // after the slide-in (and the photos' layout)
      for (const img of body.querySelectorAll('img')) img.addEventListener('load', syncMore, { once: true });
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      el.classList.remove('is-open', 'is-flip', 'has-more');
      el.setAttribute('aria-hidden', 'true');
      if (lastFocus && document.contains(lastFocus) && lastFocus !== document.body) lastFocus.focus?.({ preventScroll: true });
      else ctx.engine?.renderer?.domElement?.focus?.({ preventScroll: true });
    },
    /** Screen space the page covers (for the camera's framing; measured now and then, not every frame). */
    inset() {
      if (!isOpen) return { right: 0, bottom: 0 };
      const now = performance.now();
      if (!cachedInset || now - cachedAt > 500) {
        cachedAt = now;
        const r = el.getBoundingClientRect();
        cachedInset = matchMedia('(max-width: 720px)').matches ? { right: 0, bottom: r.height * 0.92 } : { right: r.width + 24, bottom: 0 };
      }
      return cachedInset;
    },
  };
  return api;
}
