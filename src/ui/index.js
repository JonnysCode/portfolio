// ─────────────────────────────────────────────────────────────────────────────
// UI — the HTML layer on top of the glen, styled like an old storybook /
// cabinetmaker's field journal: loader (a snail on a growing vine), intro
// card, HUD (carved wooden name plate + round buttons), spot bar, floating
// spot labels in the overview, hotspot tooltips, journal pages for entries,
// the guidebook (complete accessible portfolio + no-WebGL fallback), the
// illustrated map, arrival banners, speech bubbles, toasts and the secrets
// counter.
//
// Public API (used by the world & systems — keep these names):
//   ui.setProgress(0..1, label)    ui.ready()          ui.showIntro()
//   ui.bindWorld()                 (main.js, once the camera rig exists)
//   ui.openEntry(id, {hotspot})    ui.openArea(id)     ui.closePanel()
//   ui.showGuidebook()             ui.showMap()        ui.showHelp()
//   ui.showDestinations(fromAreaId)  (= the map)
//   ui.showTooltip(label, hotspot) ui.moveTooltip(x,y) ui.hideTooltip()
//   ui.toast(text, ms?, { icon })  ui.showAreaBanner(spotId)
//   ui.speech(text, object3d | Vector3, { duration })   (speech bubble; an Object3D
//        gets it just above its bounds, a Vector3 1.6 above the point)
//   ui.isPanelOpen / ui.isModalOpen   ui.showFallback(reason)
//   ui.fade(true|false) → Promise  (soft cross-fade, used for reduced-motion cuts)
//   ui.showPrompt / hidePrompt / showRideHUD / hideRideHUD   (legacy no-ops)
//   ui.followLink('#spot/entryId')  ui.swipeTravelled(fromId, toId)  (undo toast)
// Keyboard: ←/→ previous/next spot (or page while a journal page is open),
// 1–6 jump to a spot, G guidebook, M map, N day/night, H help, Esc closes.
// Deep links & history: #spot, #spot/entryId (and #guidebook); every place, page
// and book pushes a history entry, so Back (Android's gesture too) closes the
// open page / book or glides back to the previous place. A link on load skips
// the intro and goes straight there.
// Places with things beyond the edge of the frame (phones!) get little edge
// chips ("‹ 2 more") that swing the camera round to them.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { SPOTS, SPOT_BY_ID, SPOT_FOR_AREA } from '../world/layout.js';
import { h, svg, trapFocus, isTypingTarget } from './dom.js';
import { icon, spotIcon } from './icons.js';
import { createLoader } from './loader.js';
import { createJournal } from './panel.js';
import { renderGuidebook } from './guidebook.js';
import { createMap } from './map.js';
import { reportDrafts } from './draft.js';

const HINT_KEY = 'woodland:hinted';
/**
 * Framing tweaks per entry on top of the hotspot's own `focus` options (the
 * rig frames the centre of the object's bounds and fits it beside the page).
 * faceAzimuth is measured from the object's own front (+Z).
 */
const FOCUS_TWEAKS = {
  // the Hobelbank: a 3/4 front view slightly above the top — vises, board, shavings and Jonny planing
  'workbench-wip': { radius: 0.9, lift: 0.35, distance: 2.4, polar: 1.22 },
};
const GLEN_CAM = new THREE.Vector3(...SPOT_BY_ID.glen.camera.position);
/** How high above each spot's focus its floating overview label hangs (clear of caps & roofs). */
const LABEL_LIFT = { woodworking: 4.1, code: 2.4, home: 7.2, interior: 5.4, bikes: 5.8 };

export function createUI(ctx) {
  const root = document.getElementById('ui');
  const { content } = ctx;
  const P = content.profile;
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.classList.add('ui', 'is-loading');
  // only the toasts, the banner and speech bubbles announce themselves (not every label move)
  root.setAttribute('aria-live', 'off');
  if (isTouch) root.classList.add('is-touch');

  // ── loader ────────────────────────────────────────────────────────────────
  const loader = createLoader(root, { title: `${P.name}’s Woodland`, tagline: P.tagline });

  // ── HUD: carved name plate + round buttons + secrets tag ──────────────────
  const plate = h(
    'div',
    { class: 'plate' },
    h('i', { class: 'plate__nail is-l', 'aria-hidden': 'true' }),
    h('i', { class: 'plate__nail is-r', 'aria-hidden': 'true' }),
    h('div', { class: 'plate__name' }, `${P.name}’s Woodland`),
    h('div', { class: 'plate__tag' }, P.tagline),
  );
  const btn = (name, label, onclick, extra = {}) =>
    h('button', { class: 'hud-btn', type: 'button', 'aria-label': label, title: label, onclick, html: icon(name), ...extra });
  const nightBtn = btn('moon', 'Night falls (N)', () => {
    ctx.env.toggle();
    ctx.audio?.play?.('click');
  });
  const soundBtn = btn('soundOff', 'Sound on', () => toggleSound(), { 'aria-pressed': 'false' });
  const secretsTag = h(
    'button',
    { class: 'secrets-tag', type: 'button', 'aria-live': 'polite', title: 'Little secrets hide in the glen', onclick: () => ui.toast(foundAllByDay() ? 'You found every daytime secret. Some things only show themselves after dark — press N or tap the moon.' : isTouch ? 'Some things in the glen have no sparkle at all. Tap anything that looks curious…' : 'Some things in the glen have no sparkle at all. Look closely — hover around…', 5200, { icon: 'sparkle' }) },
    h('span', { html: icon('sparkle') }),
    h('span', { class: 'secrets-tag__n' }, '0/0'),
    h('span', { class: 'secrets-tag__label' }, 'secrets'),
  );
  const hud = h(
    'header',
    { class: 'hud' },
    plate,
    h(
      'div',
      { class: 'hud__right' },
      h('nav', { class: 'hud-actions', 'aria-label': 'Tools' }, btn('book', 'Guidebook — everything at a glance (G)', () => ui.showGuidebook()), btn('map', 'Map of the glen (M)', () => ui.showMap()), nightBtn, soundBtn, btn('help', 'How to explore (H)', () => ui.showHelp())),
      secretsTag,
    ),
  );
  root.append(hud);
  function syncNight(t) {
    const night = t > 0.5;
    nightBtn.innerHTML = icon(night ? 'sun' : 'moon');
    nightBtn.setAttribute('aria-label', night ? 'Morning comes (N)' : 'Night falls (N)');
    nightBtn.title = nightBtn.getAttribute('aria-label');
    root.classList.toggle('is-night', night);
  }
  ctx.env?.onChange?.((t) => syncNight(t));
  syncNight(ctx.env?.isNight ? 1 : 0);
  function syncSound() {
    const on = !!ctx.audio?.enabled;
    soundBtn.innerHTML = icon(on ? 'soundOn' : 'soundOff');
    soundBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    soundBtn.setAttribute('aria-label', on ? 'Sound off' : 'Sound on');
    soundBtn.title = on ? 'Sound off' : 'Sound on';
  }
  function toggleSound() {
    const on = !ctx.audio?.enabled;
    ctx.audio?.setEnabled?.(on, { remember: true });
    syncSound();
    if (on) ctx.audio?.play?.('click');
  }

  /** Every secret that shows by day is found (night-only ones remain): time for a hint. */
  function foundAllByDay() {
    const s = ctx.interactions?.secrets?.({ by: 'day' });
    return !!s && s.total > 0 && s.found >= s.total && (ctx.interactions?.secrets?.().found ?? 0) < (ctx.interactions?.secrets?.().total ?? 0);
  }

  // ── spot bar ──────────────────────────────────────────────────────────────
  const pills = new Map();
  const spotList = h('ol', { class: 'spotbar__list' });
  for (const [i, s] of SPOTS.entries()) {
    const pill = h(
      'button',
      { class: 'spot-pill', type: 'button', 'data-spot': s.id, 'aria-label': `${s.title} — ${s.subtitle} (${i + 1})`, onclick: () => go(s.id) },
      h('span', { class: 'spot-pill__icon', html: spotIcon(s.id) }),
      h('span', { class: 'spot-pill__name' }, s.id === 'glen' ? 'Overview' : s.title),
    );
    pills.set(s.id, pill);
    spotList.append(h('li', {}, pill));
  }
  const spotbar = h(
    'nav',
    { class: 'spotbar', 'aria-label': 'Places in the glen' },
    h('button', { class: 'spotbar__arrow', type: 'button', 'aria-label': 'Previous place (←)', html: icon('left'), onclick: () => step(-1) }),
    spotList,
    h('button', { class: 'spotbar__arrow', type: 'button', 'aria-label': 'Next place (→)', html: icon('right'), onclick: () => step(1) }),
  );
  root.append(spotbar);
  /**
   * Scroll the (phone) spot bar so the current place sits in the middle. Set
   * directly (not scrollIntoView): the pills change width when their names show,
   * and a smooth scroll still running would land on the old position.
   */
  function centerPill(id, smooth = false) {
    const pill = pills.get(id);
    if (!pill || spotList.scrollWidth <= spotList.clientWidth + 1) return;
    const left = pill.offsetLeft + pill.offsetWidth / 2 - spotList.clientWidth / 2; // (the list is the pills' offsetParent)
    if (smooth && !reduced) spotList.scrollTo({ left, behavior: 'smooth' });
    else spotList.scrollLeft = left;
  }
  function setCurrentSpot(id) {
    for (const [sid, pill] of pills) {
      const on = sid === id;
      pill.classList.toggle('is-current', on);
      if (on) pill.setAttribute('aria-current', 'location');
      else pill.removeAttribute('aria-current');
    }
    if (id) centerPill(id, true);
  }
  function go(id) {
    if (!ctx.cameraRig) return;
    // (the same place again with a page open: just close the page — like the ✕)
    if (ui.isPanelOpen) closeJournal({ release: false, user: id === ctx.cameraRig.spot });
    ctx.cameraRig.goTo(id);
  }
  function step(dir) {
    const rig = ctx.cameraRig;
    if (!rig) return;
    const i = Math.max(0, SPOTS.findIndex((s) => s.id === rig.spot));
    go(SPOTS[(i + dir + SPOTS.length) % SPOTS.length].id);
  }

  // ── floating spot labels (overview) & keyboard hotspot buttons ────────────
  const labelLayer = h('div', { class: 'spot-labels', role: 'group', 'aria-label': 'Places to visit' });
  const labels = SPOTS.filter((s) => s.id !== 'glen').map((s) => {
    const el = h(
      'button',
      { class: 'spot-label', type: 'button', 'aria-label': `Visit ${s.title} — ${s.subtitle}`, onclick: () => go(s.id) },
      h(
        'span',
        { class: 'spot-label__flag' },
        h('span', { class: 'spot-label__arrow is-l', 'aria-hidden': 'true', html: icon('left') }),
        h('span', { class: 'spot-label__icon', html: spotIcon(s.id) }),
        h('span', { class: 'spot-label__text' }, h('b', {}, s.title), h('small', {}, s.subtitle)),
        h('span', { class: 'spot-label__count', 'aria-hidden': 'true', hidden: true }),
        h('span', { class: 'spot-label__arrow is-r', 'aria-hidden': 'true', html: icon('right') }),
      ),
      h('span', { class: 'spot-label__stem', 'aria-hidden': 'true' }),
    );
    labelLayer.append(el);
    return { spot: s, el, pos: new THREE.Vector3(s.focus[0], s.focus[1] + (LABEL_LIFT[s.id] ?? 3.2), s.focus[2]), shown: false };
  });
  /** '✦ 3' on each overview label: how many journal pages wait there unread. */
  function syncLabelCounts() {
    for (const l of labels) {
      const list = ctx.interactions?.forSpot?.(l.spot.id) ?? [];
      const n = list.filter((x) => !ctx.interactions.isVisited?.(x.entryId)).length;
      const c = l.el.querySelector('.spot-label__count');
      c.textContent = `✦ ${n}`;
      c.hidden = n === 0;
      l.el.setAttribute('aria-label', `Visit ${l.spot.title} — ${l.spot.subtitle}${n ? ` (${n} to discover)` : ''}`);
      l.measured = -99;
    }
  }
  const hsLayer = h('div', { class: 'hs-layer', role: 'group', 'aria-label': 'Things to explore here' });
  // first in the tab order (before the HUD and the spot bar): Tab steps through
  // the things at this place straight away, as the help card promises
  root.prepend(hsLayer, labelLayer);
  let hsButtons = [];
  function rebuildHotspotButtons(spotId) {
    const list = ctx.interactions?.forSpot?.(spotId) ?? [];
    const s = SPOT_BY_ID[spotId];
    hsLayer.setAttribute('aria-label', list.length && s ? `${list.length} thing${list.length === 1 ? '' : 's'} to explore at ${s.title}` : 'Things to explore here');
    hsButtons = list.map((hs) => {
      const b = h('button', {
        class: 'hs-btn',
        type: 'button',
        'aria-label': hs.summary ? `${hs.label}: ${hs.summary}` : hs.label,
        onfocus: () => {
          ctx.interactions?.setFocused?.(hs);
          const p = ctx.interactions.screenPosition(hs, {});
          ui.showTooltip(hs.label, hs);
          ui.moveTooltip(p.x, p.y + 10);
        },
        onblur: () => {
          ctx.interactions?.setFocused?.(null);
          ui.hideTooltip();
        },
        onclick: () => ctx.interactions?.activate?.(hs, { source: 'key' }),
      });
      // last written position / tab state: the DOM is touched only when they change
      return { hs, b, x: NaN, y: NaN, tab: -2 };
    });
    hsLayer.replaceChildren(...hsButtons.map((x) => x.b));
  }

  // ── edge chips: things of this place beyond the frame's edge ("‹ 2 more") ──
  const makeChip = (side) => {
    const text = h('span', { class: 'edge-chip__text' });
    const el = h(
      'button',
      { class: `edge-chip is-${side}`, type: 'button', tabindex: '-1', onclick: () => showOffscreen(side) },
      side === 'l' && h('span', { class: 'edge-chip__arrow', html: icon('left') }),
      text,
      side === 'r' && h('span', { class: 'edge-chip__arrow', html: icon('right') }),
    );
    root.append(el);
    return { el, text, side, shown: false, label: '', y: NaN, list: [] };
  };
  const chips = { l: makeChip('l'), r: makeChip('r') };
  const chipCenter = new THREE.Vector3();
  const chipTmp = new THREE.Vector3();
  /** Swing the camera round to the things beyond one edge (framed like a detail; the place's pill brings the composition back). */
  function showOffscreen(side) {
    const c = chips[side];
    const rig = ctx.cameraRig;
    if (!rig || !c.list.length) return;
    chipCenter.set(0, 0, 0);
    for (const hs of c.list) chipCenter.add(hs.center(chipTmp));
    chipCenter.divideScalar(c.list.length);
    let r = 0;
    for (const hs of c.list) r = Math.max(r, hs.center(chipTmp).distanceTo(chipCenter) + (hs.bounds?.r ?? 0.6) * 0.8);
    ctx.audio?.play?.('whoosh');
    rig.focus(chipCenter, { radius: Math.max(1.2, r), distance: 3.2 });
  }

  // ── tooltip ───────────────────────────────────────────────────────────────
  const tipTitle = h('div', { class: 'tooltip__title' });
  const tipText = h('div', { class: 'tooltip__text' });
  const tipHint = h('div', { class: 'tooltip__hint' });
  const tooltip = h('div', { class: 'tooltip', role: 'tooltip', 'aria-hidden': 'true' }, tipTitle, tipText, tipHint);
  root.append(tooltip);

  // ── toasts, banner, fader, speech ─────────────────────────────────────────
  const toasts = h('div', { class: 'toasts', 'aria-live': 'polite', role: 'status' });
  const banner = h('div', { class: 'banner', 'aria-live': 'polite' });
  const fader = h('div', { class: 'fader', 'aria-hidden': 'true' });
  const speechLayer = h('div', { class: 'speech-layer' });
  const speechAnnounce = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  root.append(toasts, banner, speechLayer, speechAnnounce, fader);
  let bannerTimer = 0;
  let namedTimer = 0;

  // ── journal page ──────────────────────────────────────────────────────────
  const journal = createJournal(ctx, { onClose: () => ui.closePanel(), onNavigate: (id) => ui.openEntry(id) });
  root.append(journal.el);
  /** user: closed by the visitor (✕, Esc, pull-down, a tap beside it) — history steps back / is rewritten. */
  function closeJournal({ release = true, user = false } = {}) {
    if (!journal.isOpen) return;
    journal.close();
    ui.isPanelOpen = false;
    root.classList.remove('has-panel');
    ctx.interactions?.setOpen?.(null);
    ctx.cameraRig?.setInset?.(ZERO_INSET);
    ctx.audio?.play?.('close');
    if (release) ctx.cameraRig?.release?.();
    if (user) historyClosed('entry');
  }
  const ZERO_INSET = Object.freeze({ right: 0, bottom: 0, top: 0 });

  // ── modal (guidebook / map / help / fallback) ─────────────────────────────
  const modalBody = h('div', { class: 'modal__body' });
  const modalClose = h('button', { class: 'modal__close', type: 'button', 'aria-label': 'Close', html: icon('close'), onclick: () => closeModal('user') });
  const modalCard = h('div', { class: 'modal__card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title', tabindex: '-1' }, modalClose, modalBody);
  const modal = h('div', { class: 'modal', hidden: true, onclick: (e) => e.target === modal && closeModal('user') }, modalCard);
  root.append(modal);
  let modalRelease = null;
  let modalLastFocus = null;
  let modalKind = null;
  function openModal(kind, children, { wide = false } = {}) {
    if (!modal.hidden && modalKind === kind) return;
    if (modal.hidden) modalLastFocus = document.activeElement;
    modalKind = kind;
    modalCard.className = `modal__card is-${kind}${wide ? ' is-wide' : ''}`;
    modalBody.replaceChildren(...[children].flat().filter(Boolean));
    modal.hidden = false;
    ui.isModalOpen = true;
    root.classList.add('has-modal');
    modalCard.scrollTop = 0;
    modalRelease?.();
    modalRelease = trapFocus(modalCard);
    requestAnimationFrame(() => modalCard.focus({ preventScroll: true }));
    ctx.audio?.play?.('page');
    record('push');
  }
  /**
   * how: 'user' (✕, Esc, the backdrop: history steps back), 'nav' (a link in the
   * book / a pin on the map leads on: the next history entry replaces the book's),
   * 'silent' (history itself is moving).
   */
  function closeModal(how = 'user') {
    if (modal.hidden || root.classList.contains('is-fallback')) return;
    modal.hidden = true;
    modalKind = null;
    ui.isModalOpen = false;
    root.classList.remove('has-modal');
    modalRelease?.();
    modalRelease = null;
    ctx.audio?.play?.('close');
    if (how !== 'nav' && modalLastFocus && document.contains(modalLastFocus) && modalLastFocus !== document.body) modalLastFocus.focus({ preventScroll: true });
    if (how === 'user') historyClosed('modal');
    else if (how === 'nav') replaceNextRecord();
  }
  const map = createMap(ctx, {
    onPick: (id) => {
      closeModal('nav');
      go(id);
    },
  });

  // ── deep links & history ──────────────────────────────────────────────────
  // Each place, journal page and book is a history entry: #woodworking,
  // #woodworking/dining-table, #guidebook (the overview keeps a clean URL).
  // Flipping pages within a place rewrites the entry rather than stacking them.
  const hist = { ready: false, syncing: false, replaceNext: false, i: 0, states: [] };
  /** '#spot', '#spot/entry', '#entry' or '#guidebook' → { spot, entry?, modal? } (null when it means nothing here). */
  function parseHash(hash) {
    let raw = '';
    try {
      raw = decodeURIComponent(String(hash ?? '').replace(/^#\/?/, ''));
    } catch {
      return null;
    }
    if (!raw) return null;
    const [a, b] = raw.split('/');
    if (a === 'guidebook' || a === 'guide') return { spot: 'glen', entry: null, modal: 'guide' };
    const entryState = (id) => {
      const e = content.getEntry?.(id);
      return e ? { spot: SPOT_FOR_AREA[e.area] ?? 'glen', entry: id, modal: null } : null;
    };
    if (SPOT_BY_ID[a]) return (b && entryState(b)) || { spot: a, entry: null, modal: null };
    return entryState(a);
  }
  function hashFor(st) {
    if (st.entry) return `#${st.spot}/${st.entry}`;
    if (st.modal === 'guide') return '#guidebook';
    if (st.spot && st.spot !== 'glen') return `#${st.spot}`;
    return location.pathname + location.search;
  }
  /** A shareable link to an entry (or a place). */
  function linkFor(entryId) {
    const e = content.getEntry?.(entryId);
    const spot = e ? SPOT_FOR_AREA[e.area] : SPOT_BY_ID[entryId] ? entryId : null;
    if (!spot) return null;
    return `${location.origin}${location.pathname}#${e ? `${spot}/${entryId}` : spot}`;
  }
  const navState = () => ({ spot: ctx.cameraRig?.spot ?? 'glen', entry: journal.isOpen ? currentEntry?.id ?? null : null, modal: ui.isModalOpen ? modalKind : null });
  const same = (a, b) => !!a && !!b && a.spot === b.spot && (a.entry ?? null) === (b.entry ?? null) && (a.modal ?? null) === (b.modal ?? null);
  /** Write the current state into history: 'push' a new entry or 'replace' the current one. */
  function record(mode = 'push') {
    if (!hist.ready || hist.syncing || !ctx.cameraRig) return;
    const st = navState();
    if (hist.replaceNext) {
      hist.replaceNext = false;
      mode = 'replace';
    }
    if (mode === 'push' && same(hist.states[hist.i], st)) return;
    const i = mode === 'push' ? hist.i + 1 : hist.i;
    try {
      history[mode === 'push' ? 'pushState' : 'replaceState']({ woodland: 1, i, ...st }, '', hashFor(st));
    } catch {
      return; // (sandboxed frames etc.: no history, nothing else changes)
    }
    hist.i = i;
    hist.states.length = i;
    hist.states[i] = st;
  }
  /** The next record (a link out of the book / map) replaces the book's entry; nothing followed → just rewrite it. */
  function replaceNextRecord() {
    hist.replaceNext = true;
    setTimeout(() => {
      if (!hist.replaceNext) return;
      hist.replaceNext = false;
      record('replace');
    }, 0);
  }
  /** The visitor closed a page / the book: step back when the entry below is exactly where we are now, else rewrite. */
  function historyClosed() {
    if (!hist.ready || hist.syncing) return;
    const below = hist.states[hist.i - 1];
    const now = navState();
    if (below && same(below, now) && history.state?.woodland && history.state.i === hist.i) {
      hist.expectPop = true;
      history.back();
    } else record('replace');
  }
  /** Make the glen show a history state (Back / Forward / a followed link) — without recording it again. */
  function applyState(st) {
    if (!st || !ctx.cameraRig) return;
    hist.syncing = true;
    try {
      if (intro) skipIntro();
      if (ui.isModalOpen && st.modal !== modalKind) closeModal('silent');
      if (st.entry) {
        if (!journal.isOpen || currentEntry?.id !== st.entry) ui.openEntry(st.entry);
      } else {
        if (journal.isOpen) closeJournal({ release: true });
        if (st.spot && SPOT_BY_ID[st.spot] && st.spot !== ctx.cameraRig.spot) go(st.spot);
      }
      if (st.modal && !ui.isModalOpen) {
        if (st.modal === 'map') ui.showMap();
        else if (st.modal === 'help') ui.showHelp();
        else ui.showGuidebook();
      }
    } finally {
      hist.syncing = false;
    }
  }
  window.addEventListener('popstate', (e) => {
    if (!hist.ready) return;
    const st = e.state?.woodland ? e.state : parseHash(location.hash) ?? { spot: 'glen', entry: null, modal: null };
    if (e.state?.woodland) {
      hist.i = e.state.i;
      hist.states[hist.i] = { spot: st.spot, entry: st.entry ?? null, modal: st.modal ?? null };
    } else {
      // a hash typed into the address bar: a new entry on top
      hist.i += 1;
      hist.states.length = hist.i;
      hist.states[hist.i] = st;
      try {
        history.replaceState({ woodland: 1, i: hist.i, ...st }, '', hashFor(st));
      } catch {
        /* ignore */
      }
    }
    if (hist.expectPop) {
      // our own step back after a close: the glen already shows it
      hist.expectPop = false;
      if (same(st, navState())) return;
    }
    applyState(st);
  });
  /** Arrived by a link (#woodworking/dining-table): no intro card, straight there. */
  const initialLink = parseHash(location.hash);

  // ── intro card ────────────────────────────────────────────────────────────
  let intro = null;
  function buildIntro() {
    const enter = h('button', { class: 'stamp-btn is-primary is-big', type: 'button', onclick: () => enterWoodland() }, 'Enter the woodland');
    const skip = h('button', { class: 'linkish', type: 'button', onclick: () => skipToGuidebook() }, 'Just show me the guidebook');
    const card = h(
      'section',
      { class: 'intro__card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'intro-title' },
      h('i', { class: 'journal__tape is-left', 'aria-hidden': 'true' }),
      h('i', { class: 'journal__tape is-right', 'aria-hidden': 'true' }),
      h('div', { class: 'intro__emblem', 'aria-hidden': 'true', html: spotIcon('home') }),
      h('div', { class: 'intro__kicker' }, 'Welcome to'),
      h('h1', { id: 'intro-title', class: 'intro__title' }, `${P.name}’s Woodland`),
      svg(`<svg class="intro__flourish" viewBox="0 0 220 14" aria-hidden="true"><path d="M2 8 C 40 2, 70 12, 110 7 S 180 3, 218 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`),
      h('p', { class: 'intro__tag' }, P.tagline),
      h('p', { class: 'intro__text' }, P.intro),
      h('div', { class: 'intro__actions' }, enter, skip),
      h('p', { class: 'intro__note' }, h('span', { html: icon('soundOn') }), isTouch ? 'With sound · drag to look around · tap the sparkles' : 'With sound · drag to look around · click the sparkles'),
    );
    const el = h('div', { class: 'intro' }, card);
    root.append(el);
    trapFocus(card);
    return { el, enter };
  }
  function hideIntro() {
    if (!intro) return;
    const el = intro.el;
    intro = null;
    el.classList.add('is-leaving');
    root.classList.remove('is-intro');
    setTimeout(() => el.remove(), 900);
  }
  /** Leave the intro for a place picked by a link / Back (no descent, no sound: the visitor has not chosen yet). */
  function skipIntro() {
    hideIntro();
  }
  function enterWoodland() {
    ctx.audio?.unlock?.();
    ctx.audio?.setEnabled?.(ctx.audio?.preference ?? true);
    syncSound();
    hideIntro();
    ctx.cameraRig?.playIntro?.().then((ok) => {
      if (ok) showHintOnce();
    });
    ctx.engine?.renderer?.domElement?.focus?.({ preventScroll: true });
  }
  function skipToGuidebook() {
    hideIntro();
    hist.syncing = true; // (the overview is where history already is)
    try {
      ctx.cameraRig?.goTo?.('glen', { instant: true });
    } finally {
      hist.syncing = false;
    }
    ui.showGuidebook();
  }
  function showHintOnce() {
    let seen = false;
    try {
      seen = localStorage.getItem(HINT_KEY) === '1';
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* ignore */
    }
    ui.toast(isTouch ? 'Drag to look around · pinch to zoom · tap the ✦ sparkles · the bar below takes you places' : 'Drag to look around · scroll to zoom · click the ✦ sparkles · ← → to travel', seen ? 4200 : 7000, { icon: 'sparkle' });
  }

  // ── keyboard ──────────────────────────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    if (intro) {
      if (e.key === 'Escape') skipToGuidebook();
      return;
    }
    if (ui.isModalOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal('user');
      }
      return;
    }
    if (e.key === 'Escape') {
      if (journal.isOpen) ui.closePanel();
      return;
    }
    if (!ctx.cameraRig) return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const dir = k === 'ArrowLeft' ? -1 : 1;
      if (journal.isOpen && currentEntry) {
        const sib = content.entriesForArea(currentEntry.area);
        const i = sib.findIndex((s) => s.id === currentEntry.id);
        if (sib.length > 1) ui.openEntry(sib[(i + dir + sib.length) % sib.length].id);
      } else step(dir);
      e.preventDefault();
      return;
    }
    if (/^[1-9]$/.test(k) && SPOTS[Number(k) - 1]) {
      go(SPOTS[Number(k) - 1].id);
      return;
    }
    const lk = k.toLowerCase();
    if (lk === 'g') ui.showGuidebook();
    else if (lk === 'm') ui.showMap();
    else if (lk === 'n') ctx.env?.toggle?.();
    else if (lk === 'h' || k === '?') ui.showHelp();
  });

  // ── per-frame screen-space things (labels, hotspot buttons, speech, inset) ─
  const v = new THREE.Vector3();
  const sp = {};
  const bubbles = new Set();
  /** The canvas box every projection uses (it is sized to the visible viewport, not 100vh). */
  const view = { x: 0, y: 0, w: 1, h: 1 };
  function measureView() {
    const r = ctx.interactions?.canvasRect;
    if (r && r.width > 0) {
      view.x = r.left;
      view.y = r.top;
      view.w = r.width;
      view.h = r.height;
    } else {
      view.x = view.y = 0;
      view.w = innerWidth || 1;
      view.h = innerHeight || 1;
    }
    return view;
  }
  /** World point → client px in the canvas box (v is overwritten). */
  function toScreen(p, out) {
    v.copy(p).project(ctx.camera);
    out.x = view.x + ((v.x + 1) / 2) * view.w;
    out.y = view.y + ((1 - v.y) / 2) * view.h;
    out.z = v.z;
    return out;
  }
  const placed = [];
  function frame() {
    const rig = ctx.cameraRig;
    const cam = ctx.camera;
    if (!rig || !cam) return;
    cam.updateMatrixWorld(); // the rig moved it this frame; project with fresh matrices
    measureView();
    const W = view.w, H = view.h;
    // floating spot labels in the overview
    // (a debug/screenshot camera override shows them only when it looks at the glen from afar)
    const atGlen = rig.overridden ? cam.position.distanceTo(GLEN_CAM) < 14 : rig.spot === 'glen';
    const showLabels = atGlen && !rig.transitioning && !rig.focused && !ui.isModalOpen && !intro;
    placed.length = 0;
    for (const l of labels) {
      let on = showLabels;
      let edge = 0;
      if (on) {
        toScreen(l.pos, sp);
        on = sp.z < 1 && Math.abs(v.x) < 2.6 && v.y < 0.8 && v.y > -0.82;
        if (on) {
          // the flag's size, measured now and then (not every frame: no layout thrash)
          if (!l.fw || ctx.engine.frame - (l.measured ?? -99) > 45) {
            const f = l.el.firstElementChild;
            l.fw = f.offsetWidth || 140;
            l.fh = f.offsetHeight || 40;
            l.measured = ctx.engine.frame;
          }
          let x = sp.x - view.x;
          const y = sp.y - view.y;
          // places beyond the frame (phones!) get a little signpost pinned to the edge
          const half = Math.min(110, l.fw / 2) + 10;
          if (x < half) (edge = -1), (x = half);
          else if (x > W - half) (edge = 1), (x = W - half);
          l.x = view.x + x;
          l.y = view.y + y;
          placed.push(l);
        }
      }
      if (edge !== l.edge) {
        l.edge = edge;
        l.el.classList.toggle('is-edge-l', edge < 0);
        l.el.classList.toggle('is-edge-r', edge > 0);
        l.measured = -99; // edge flags are slimmer: measure again
      }
      if (on !== l.shown) {
        l.shown = on;
        l.el.classList.toggle('is-shown', on);
        l.el.tabIndex = on ? 0 : -1;
      }
    }
    solveLabels(placed);
    for (const l of placed) {
      // (DOM writes only when a whole pixel changed: the breathing camera drifts sub-pixel)
      const lx = Math.round(l.x), ly = Math.round(l.y);
      if (lx !== l.px || ly !== l.py) {
        l.px = lx;
        l.py = ly;
        l.el.style.transform = `translate(${lx}px, ${ly}px)`;
      }
      const lift = Math.round(l.lift ?? 0);
      if (lift !== l.liftPx) {
        l.liftPx = lift;
        l.el.style.setProperty('--lift', `${lift}px`);
      }
    }
    // keyboard hotspot buttons follow their markers; things beyond an edge are counted for the chips
    const moving = rig.transitioning;
    const chipsOn = !moving && !journal.isOpen && !ui.isModalOpen && !intro && !rig.overridden && rig.spot && rig.spot !== 'glen' && (ctx.interactions.gestures?.mode ?? 'none') !== 'drag';
    chips.l.list.length = chips.r.list.length = 0;
    let yl = 0, yr = 0;
    for (const x of hsButtons) {
      ctx.interactions.screenPosition(x.hs, sp);
      const bx = Math.round(sp.x), by = Math.round(sp.y);
      if (bx !== x.x || by !== x.y) {
        x.x = bx;
        x.y = by;
        x.b.style.transform = `translate(${bx}px, ${by}px)`;
      }
      const tab = sp.visible && !moving ? 0 : -1;
      if (tab !== x.tab) {
        x.tab = tab;
        x.b.tabIndex = tab;
      }
      if (chipsOn && !sp.visible && sp.z < 1) {
        if (sp.x < view.x + 2) (chips.l.list.push(x.hs), (yl += sp.y));
        else if (sp.x > view.x + W - 2) (chips.r.list.push(x.hs), (yr += sp.y));
      }
    }
    syncChip(chips.l, yl, H);
    syncChip(chips.r, yr, H);
    // speech bubbles
    for (const b of bubbles) b.update();
    // keep the subject framed beside the journal page — or just above the spot bar
    if (journal.isOpen) rig.setInset(focusInset());
    else {
      freeInset.bottom = intro ? 0 : barInset();
      rig.setInset(freeInset);
    }
  }
  const freeInset = { right: 0, bottom: 0, top: 0 };
  /** Show / move / hide an edge chip (DOM touched only on change). */
  function syncChip(c, ySum, H) {
    const n = c.list.length;
    const show = n > 0;
    if (show) {
      const label = n === 1 ? c.list[0].label : `${n} more`;
      if (label !== c.label) {
        c.label = label;
        c.text.textContent = label;
        c.el.setAttribute('aria-label', n === 1 ? `Look over to ${label}` : `Look over to ${n} more things here`);
      }
      // at the height of the things it points to (kept clear of the HUD, the banner and the spot bar)
      const y = Math.round(Math.min(H * 0.72, Math.max(H * 0.3, ySum / n - view.y)) / 4) * 4 + view.y;
      if (y !== c.y) {
        c.y = y;
        c.el.style.top = `${y}px`;
      }
    }
    if (show !== c.shown) {
      c.shown = show;
      c.el.classList.toggle('is-shown', show);
      c.el.tabIndex = show ? 0 : -1;
    }
  }

  /**
   * Floating labels must never pile up (phones: the cottage, the atelier and
   * the Schreinerei sit close together, edge-pinned ones share an edge).
   * Placed bottom-up: a label overlapping one already placed is lifted above
   * it on a taller stem (edge signposts simply stack); the lift is eased so
   * labels glide rather than jump while the camera breathes.
   */
  const GAP = 6;
  const solved = []; // (reused boxes: nothing allocated per frame)
  function solveLabels(list) {
    const minTop = narrow() ? 104 : 84; // below the HUD
    list.sort((a, b) => b.y - a.y);
    const done = solved;
    let nd = 0;
    for (const l of list) {
      const w = (l.fw ?? 140) + GAP, hh = (l.fh ?? 40) + GAP;
      const left = l.x - w / 2, right = l.x + w / 2;
      let bottom = l.y - 30; // the flag sits on a 30px stem
      for (let pass = 0; pass < 6; pass++) {
        let moved = false;
        for (let k = 0; k < nd; k++) {
          const o = done[k];
          if (right <= o.left || left >= o.right) continue;
          if (bottom <= o.top || bottom - hh >= o.bottom) continue;
          bottom = o.top; // lift above it
          moved = true;
        }
        if (!moved) break;
      }
      // never under the HUD: then rather overlap a little lower down
      bottom = Math.max(bottom, minTop + hh);
      const want = Math.max(0, l.y - 30 - bottom);
      l.lift = l.lift === undefined || !l.wasShown ? want : l.lift + (want - l.lift) * 0.2;
      if (Math.abs(l.lift - want) < 0.5) l.lift = want;
      l.wasShown = true;
      const b = l.y - 30 - l.lift;
      const box = done[nd] ?? (done[nd] = {});
      nd++;
      box.left = left;
      box.right = right;
      box.top = b - hh;
      box.bottom = b;
    }
    for (const l of labels) if (!l.shown) l.wasShown = false;
  }
  const narrow = () => view.w <= 720;

  let barH = 0;
  /** Half the spot bar's height: compositions sit a touch higher so the bar never hides a door. */
  function barInset() {
    if (!barH || ctx.engine.frame % 60 === 0) barH = spotbar.getBoundingClientRect().height + 14;
    return barH * 0.55;
  }
  let hudH = 0;
  const pageInset = { right: 0, bottom: 0, top: 0 };
  /** What the journal leaves free for a framed detail: beside / above the page, below the HUD, above the spot bar. */
  function focusInset() {
    const j = journal.inset();
    if (!hudH || ctx.engine.frame % 60 === 0) hudH = hud.getBoundingClientRect().bottom + 8;
    barInset();
    // a phone held sideways: the page runs the full height and the spot bar steps aside
    const short = !narrow() && view.h <= 520;
    pageInset.right = j.right;
    pageInset.bottom = short ? 0 : Math.max(j.bottom, j.right ? barH : 0);
    pageInset.top = narrow() ? hudH : 0;
    return pageInset;
  }

  // ── speech bubbles ────────────────────────────────────────────────────────
  const tmpBox = new THREE.Box3();
  function makeBubble(text, anchor, duration) {
    for (const b of bubbles) if (b.anchor === anchor) b.remove();
    const textEl = h('span', { class: 'speech__text' });
    const el = h('div', { class: 'speech' }, textEl);
    speechLayer.append(el);
    let lift = 1.6;
    if (anchor?.isObject3D) {
      tmpBox.setFromObject(anchor);
      anchor.getWorldPosition(v);
      lift = tmpBox.isEmpty() ? 0.6 : tmpBox.max.y - v.y + 0.18;
    }
    const born = performance.now();
    const b = {
      anchor,
      update() {
        if (anchor?.isObject3D) anchor.getWorldPosition(v);
        else if (anchor) v.copy(anchor);
        else return;
        v.y += lift;
        v.project(ctx.camera);
        const x = view.x + Math.min(view.w - 90, Math.max(90, ((v.x + 1) / 2) * view.w));
        const y = view.y + Math.max(70, ((1 - v.y) / 2) * view.h);
        el.style.transform = `translate(${x}px, ${y}px)`;
        el.classList.toggle('is-hidden', v.z > 1);
        // typewriter
        const n = reduced ? text.length : Math.min(text.length, Math.floor((performance.now() - born) / 28));
        if (textEl.textContent.length !== n) textEl.textContent = text.slice(0, n);
      },
      remove() {
        bubbles.delete(b);
        el.classList.add('is-leaving');
        setTimeout(() => el.remove(), 350);
      },
    };
    speechAnnounce.textContent = text;
    bubbles.add(b);
    b.update();
    setTimeout(() => bubbles.has(b) && b.remove(), duration);
    return b;
  }

  // ── a found secret: a sparkle flies from it to the counter, the camera has a look ──
  function flySparkle(hs) {
    if (reduced || !ctx.camera) return;
    measureView();
    const p = hs.center?.(new THREE.Vector3()) ?? hs.object.getWorldPosition(new THREE.Vector3());
    toScreen(p, sp);
    if (sp.z > 1) return;
    const to = secretsTag.getBoundingClientRect();
    const el = h('span', { class: 'secret-fly', 'aria-hidden': 'true', html: icon('sparkle') });
    el.style.transform = `translate(${sp.x}px, ${sp.y}px) scale(0.6)`;
    root.append(el);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        el.classList.add('is-flying');
        el.style.transform = `translate(${to.left + 14}px, ${to.top + to.height / 2}px) scale(1)`;
      }),
    );
    setTimeout(() => el.remove(), 900);
  }
  let secretLook = 0;
  /** Frame the secret for a moment (so the speech bubble has a visible subject), then glide back. */
  function lookAtSecret(hs) {
    const rig = ctx.cameraRig;
    if (!rig || journal.isOpen || rig.transitioning || ui.isModalOpen) return;
    const r = hs.bounds?.r ?? 0.6;
    rig.focus(hs.object, { distance: hs.focus?.distance ?? Math.max(2.2, r * 3.2), lift: hs.focus?.lift ?? 0.1, radius: Math.min(r, 1.6) });
    clearTimeout(secretLook);
    secretLook = setTimeout(() => {
      if (rig.focused && !journal.isOpen) rig.release();
    }, 3400);
  }

  /** Share / copy a link to a page of the journal. */
  function copyLink(link, title) {
    const done = () => ui.toast(`Link copied — it opens “${title}” in the woodland`, 3600, { icon: 'link' });
    const show = () => ui.toast(link, 7000, { icon: 'link' });
    if (isTouch && navigator.share) {
      navigator.share({ title: `${title} · ${P.name}’s Woodland`, url: link }).catch(() => {});
      return;
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, show);
    else show();
  }

  let currentEntry = null;
  let focusing = false;

  const ui = {
    root,
    isPanelOpen: false,
    isModalOpen: false,
    setProgress(p, label) {
      loader.setProgress(p, label);
    },
    ready() {
      loader.done();
      root.classList.remove('is-loading');
      root.classList.add('is-ready');
      syncSound();
    },
    /** Wire the UI to the camera rig & interactions (main.js, after the rig exists). */
    bindWorld() {
      const rig = ctx.cameraRig;
      setCurrentSpot(rig?.spot ?? 'glen');
      rig?.onSpotChange?.((id) => {
        setCurrentSpot(id);
        rebuildHotspotButtons(id);
        ui.hideTooltip();
        // travelling elsewhere closes the open page (but not when the page itself flew us there)
        if (!focusing && journal.isOpen) closeJournal({ release: false });
        if (!focusing && id) ctx.audio?.play?.('whoosh');
        if (id === 'glen') banner.classList.remove('is-visible');
        // a new place is a new history entry (a page opening records itself)
        if (!focusing && id) record('push');
      });
      rig?.onArrive?.((id) => {
        if (id && id !== 'glen' && !journal.isOpen) ui.showAreaBanner(id);
        // phones show icons only: name every place for a few seconds after arriving
        if (narrow()) {
          spotbar.classList.add('is-named');
          clearTimeout(namedTimer);
          namedTimer = setTimeout(() => {
            spotbar.classList.remove('is-named');
            centerPill(ctx.cameraRig?.spot, true);
          }, 3200);
          // the pills just grew (names): centre the current one on the new widths
          centerPill(id);
          requestAnimationFrame(() => centerPill(id));
        }
      });
      rebuildHotspotButtons(rig?.spot ?? 'glen');
      const it = ctx.interactions;
      syncLabelCounts();
      it?.onVisit?.(() => syncLabelCounts());
      const syncSecrets = () => {
        const s = it?.secrets?.() ?? { found: 0, total: 0 };
        secretsTag.querySelector('.secrets-tag__n').textContent = `${s.found}/${s.total}`;
        secretsTag.hidden = !s.total;
        secretsTag.setAttribute('aria-label', `${s.found} of ${s.total} secrets found`);
      };
      syncSecrets();
      it?.onSecret?.((hs, s, isNew) => {
        syncSecrets();
        if (!isNew) return;
        flySparkle(hs);
        lookAtSecret(hs);
        setTimeout(() => {
          secretsTag.classList.remove('is-pop');
          void secretsTag.offsetWidth;
          secretsTag.classList.add('is-pop');
        }, reduced ? 0 : 650);
        if (s.found === s.total) {
          ctx.audio?.play?.('horn');
          ui.toast(`You found every secret of the glen! (${s.found}/${s.total}) The Schneckenpost salutes you.`, 6500, { icon: 'sparkle', cls: 'is-gold' });
        } else {
          ctx.audio?.play?.('chime');
          ui.toast(`Secret found: ${hs.label.replace(/…$/, '')} — ${s.found} of ${s.total}`, 4200, { icon: 'sparkle', cls: 'is-gold' });
        }
      });
      ctx.engine.addUpdate(frame, 95);
      syncSound();
      ctx.audio?.onChange?.(() => syncSound());
      // history starts here: the place a link points to, or the overview (clean URL)
      try {
        const st = initialLink ? { spot: initialLink.spot, entry: null, modal: null } : { spot: rig?.spot ?? 'glen', entry: null, modal: null };
        history.replaceState({ woodland: 1, i: 0, ...st }, '', initialLink ? hashFor(st) : location.pathname + location.search);
        hist.states = [st];
        hist.i = 0;
        hist.ready = true;
      } catch {
        /* no history API (sandboxed): links simply do nothing */
      }
      reportDrafts(content);
    },
    showIntro() {
      // arrived by a link to a place / a page: no intro card, straight there
      if (initialLink && ui.followLink(initialLink)) return;
      ctx.cameraRig?.holdIntro?.();
      root.classList.add('is-intro');
      intro = buildIntro();
      requestAnimationFrame(() => intro?.enter.focus({ preventScroll: true }));
    },
    /** Go where a link points ('#woodworking/dining-table' or a parsed state): the place at once, then the page. */
    followLink(link) {
      const st = typeof link === 'string' ? parseHash(link) : link;
      const rig = ctx.cameraRig;
      if (!st || !rig) return false;
      if (intro) skipIntro();
      hist.syncing = true;
      try {
        if (ui.isModalOpen) closeModal('silent');
        if (journal.isOpen) closeJournal({ release: false });
        rig.goTo(st.spot, { instant: true });
      } finally {
        hist.syncing = false;
      }
      record('replace');
      // the page (or the book) opens a moment later, as its own history entry: Back closes it
      const then = () => {
        if (st.entry) ui.openEntry(st.entry);
        else if (st.modal === 'guide') ui.showGuidebook();
        else showHintOnce();
      };
      if (st.entry || st.modal) setTimeout(then, reduced ? 0 : 700);
      else then();
      return true;
    },
    /** A swipe took the visitor on to another place: offer the way back for a moment. */
    swipeTravelled(from, to) {
      const a = SPOT_BY_ID[from];
      if (!a || from === to) return;
      ui.toast(`On to ${SPOT_BY_ID[to]?.title ?? 'the next place'}`, 4200, { icon: 'compass', action: { label: `back to ${a.title}`, arrow: 'left', onClick: () => go(from) } });
    },
    openEntry(id, opts = {}) {
      const entry = content.getEntry(id);
      if (!entry) return console.warn('[ui] unknown entry', id);
      const wasOpen = journal.isOpen;
      currentEntry = entry;
      closeModal('nav');
      // opened from a keyboard hotspot button: its focus ring, tooltip and hover
      // ring must not stay drawn over the subject — focus moves into the page
      // (journal.open focuses the title at once; Esc brings it back to the button)
      ctx.interactions?.setFocused?.(null);
      ui.hideTooltip();
      journal.open(entry, { siblings: content.entriesForArea(entry.area) });
      if (document.activeElement?.classList?.contains('hs-btn')) document.activeElement.blur();
      ui.isPanelOpen = true;
      root.classList.add('has-panel');
      banner.classList.remove('is-visible');
      ctx.audio?.play?.('page');
      ctx.interactions?.markVisited?.(id);
      const rig = ctx.cameraRig;
      if (!rig) return;
      rig.setInset(focusInset());
      const hs = opts.hotspot ?? ctx.interactions?.findByEntry?.(id);
      focusing = true;
      try {
        if (hs) {
          ctx.interactions?.setOpen?.(hs);
          rig.focus(hs.object, { ...(hs.focus ?? {}), ...(FOCUS_TWEAKS[id] ?? {}), spot: SPOT_BY_ID[hs.area] ? hs.area : undefined });
        } else {
          const spotId = SPOT_FOR_AREA[entry.area];
          if (spotId && spotId !== rig.spot) rig.goTo(spotId);
        }
      } finally {
        focusing = false;
      }
      // a page is a history entry (flipping to the next page of the same place rewrites it)
      record(wasOpen ? 'replace' : 'push');
    },
    openArea(id) {
      ui.showGuidebook();
      requestAnimationFrame(() => document.getElementById(`guide-${id}`)?.scrollIntoView({ block: 'start' }));
    },
    closePanel() {
      closeJournal({ release: true, user: true });
    },
    showGuidebook() {
      openModal(
        'guide',
        renderGuidebook(ctx, {
          show3d: !!ctx.cameraRig,
          linkFor,
          onCopyLink: (link, e) => copyLink(link, e.title),
          onShow: (id) => {
            closeModal('nav');
            ui.openEntry(id);
          },
          onVisit: (id) => {
            closeModal('nav');
            go(id);
          },
        }),
        { wide: true },
      );
    },
    showMap() {
      map.update(ctx.cameraRig?.spot ?? 'glen');
      openModal('map', [h('h2', { id: 'modal-title', class: 'sr-only' }, 'Map of the glen'), map.el], { wide: true });
    },
    showDestinations() {
      ui.showMap();
    },
    showHelp() {
      const row = (keys, text) => h('li', {}, h('span', { class: 'help__keys' }, keys.map((k) => h('kbd', {}, k))), h('span', {}, text));
      openModal('help', [
        h('div', { class: 'help__kicker' }, 'A few words before you wander'),
        h('h2', { id: 'modal-title', class: 'help__title' }, 'How to explore'),
        h(
          'ul',
          { class: 'help__list' },
          isTouch
            ? [row(['drag'], 'look around'), row(['pinch'], 'zoom in & out'), row(['two fingers'], 'move sideways'), row(['swipe'], 'travel to the next place'), row(['tap ✦'], 'open a journal page')]
            : [row(['drag'], 'look around'), row(['scroll'], 'zoom in & out'), row(['right-drag', 'shift-drag'], 'move sideways'), row(['click ✦'], 'open a journal page'), row(['←', '→'], 'previous / next place'), row(['1', '–', '6'], 'jump to a place'), row(['G'], 'guidebook'), row(['M'], 'map'), row(['N'], 'day & night'), row(['Esc'], 'close'), row(['Tab'], 'step through the things at a place')],
        ),
        h('p', { class: 'help__secret' }, h('span', { html: icon('sparkle') }), isTouch ? 'Not everything here has a sparkle. A few little secrets hide in the glen — tap anything that looks curious, some things answer.' : 'Not everything here has a sparkle. A few little secrets hide in the glen — hover around and see who answers.', foundAllByDay() && h('span', { class: 'help__night' }, ' Some things only show themselves after dark (N).')),
      ]);
    },
    showTooltip(label, hotspot) {
      if (!label) return ui.hideTooltip();
      const secret = hotspot?.kind === 'secret';
      tipTitle.textContent = label;
      tipText.textContent = secret ? '' : hotspot?.summary ?? '';
      tipText.hidden = !tipText.textContent;
      const visited = hotspot?.visited;
      tipHint.innerHTML = '';
      tipHint.append(
        h('span', { html: icon(secret ? 'sparkle' : visited ? 'leaf' : 'book') }),
        secret
          ? visited ? 'an old friend' : 'psst… say hello'
          : hotspot?.entryId
            ? hotspot.area && SPOT_BY_ID[hotspot.area] && ctx.cameraRig?.spot !== hotspot.area
              ? `fly over to ${SPOT_BY_ID[hotspot.area].title}`
              : visited ? 'read again' : `${isTouch ? 'tap' : 'click'} to open the journal page`
            : `${isTouch ? 'tap' : 'click'}`,
      );
      tooltip.classList.toggle('is-secret', !!secret);
      tooltip.classList.add('is-visible');
    },
    moveTooltip(x, y) {
      const r = tooltip.getBoundingClientRect();
      const w = r.width || 220, hh = r.height || 60;
      let px = x + 18, py = y + 16;
      if (px + w > innerWidth - 8) px = x - w - 14;
      if (py + hh > innerHeight - 90) py = y - hh - 14;
      tooltip.style.transform = `translate(${Math.max(8, px)}px, ${Math.max(8, py)}px)`;
    },
    hideTooltip() {
      tooltip.classList.remove('is-visible');
    },
    toast(text, ms = 4200, { icon: ic, cls = '', action = null } = {}) {
      const act =
        action &&
        h(
          'button',
          {
            type: 'button',
            class: 'toast__action',
            onclick: () => {
              action.onClick?.();
              el.classList.remove('is-visible');
              setTimeout(() => el.remove(), 400);
            },
          },
          action.arrow === 'left' && h('span', { class: 'toast__arrow', html: icon('left') }),
          action.label,
        );
      const el = h('div', { class: `toast ${cls}${act ? ' has-action' : ''}` }, ic && h('span', { class: 'toast__icon', html: icon(ic) }), h('span', {}, text), act);
      toasts.append(el);
      while (toasts.children.length > 3) toasts.firstElementChild.remove();
      requestAnimationFrame(() => el.classList.add('is-visible'));
      setTimeout(() => {
        el.classList.remove('is-visible');
        setTimeout(() => el.remove(), 500);
      }, ms);
    },
    showAreaBanner(spotId) {
      const s = SPOT_BY_ID[spotId];
      if (!s) return;
      const info = content.areas[spotId];
      const n = ctx.interactions?.forSpot?.(spotId)?.length ?? 0;
      banner.replaceChildren(
        h('div', { class: 'banner__kicker' }, info?.kicker ?? s.subtitle),
        h('div', { class: 'banner__title' }, info?.title ?? s.title),
        svg(`<svg class="banner__flourish" viewBox="0 0 220 14" aria-hidden="true"><path d="M2 8 C 40 2, 70 12, 110 7 S 180 3, 218 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`),
        n > 0 && h('div', { class: 'banner__count' }, `${n} thing${n === 1 ? '' : 's'} to discover here`),
      );
      banner.classList.remove('is-visible');
      void banner.offsetWidth;
      banner.classList.add('is-visible');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('is-visible'), 3600);
    },
    speech(text, anchor, { duration } = {}) {
      if (!ctx.camera) return null;
      ctx.audio?.play?.('chirp');
      return makeBubble(String(text), anchor, duration ?? 2600 + String(text).length * 45);
    },
    showPrompt() {},
    hidePrompt() {},
    showRideHUD() {},
    hideRideHUD() {},
    fade(on) {
      fader.classList.toggle('is-on', !!on);
      return new Promise((r) => setTimeout(r, 420));
    },
    showFallback(reason) {
      loader.el.remove();
      root.classList.remove('is-loading');
      root.classList.add('is-fallback');
      openModal('guide', [h('p', { class: 'guide__fallback' }, reason), renderGuidebook(ctx, { show3d: false })], { wide: true });
      modalClose.hidden = true;
    },
  };
  return ui;
}
