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
// Keyboard: ←/→ previous/next spot (or page while a journal page is open),
// 1–6 jump to a spot, G guidebook, M map, N day/night, H help, Esc closes.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { SPOTS, SPOT_BY_ID, SPOT_FOR_AREA } from '../world/layout.js';
import { h, svg, trapFocus, isTypingTarget } from './dom.js';
import { icon, spotIcon } from './icons.js';
import { createLoader } from './loader.js';
import { createJournal } from './panel.js';
import { renderGuidebook } from './guidebook.js';
import { createMap } from './map.js';

const HINT_KEY = 'woodland:hinted';

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
  const loader = createLoader(root, { title: `${P.name}'s Woodland`, tagline: P.tagline });

  // ── HUD: carved name plate + round buttons + secrets tag ──────────────────
  const plate = h(
    'div',
    { class: 'plate' },
    h('i', { class: 'plate__nail is-l', 'aria-hidden': 'true' }),
    h('i', { class: 'plate__nail is-r', 'aria-hidden': 'true' }),
    h('div', { class: 'plate__name' }, `${P.name}'s Woodland`),
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
    { class: 'secrets-tag', type: 'button', 'aria-live': 'polite', title: 'Little secrets hide in the glen', onclick: () => ui.toast('Some things in the glen have no sparkle at all. Look closely — hover or tap around…', 5200, { icon: 'sparkle' }) },
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
  function setCurrentSpot(id) {
    for (const [sid, pill] of pills) {
      const on = sid === id;
      pill.classList.toggle('is-current', on);
      if (on) pill.setAttribute('aria-current', 'location');
      else pill.removeAttribute('aria-current');
    }
    if (id && pills.get(id) && spotList.scrollWidth > spotList.clientWidth) pills.get(id).scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }
  function go(id) {
    if (!ctx.cameraRig) return;
    if (ui.isPanelOpen) closeJournal({ release: false });
    ctx.audio?.play?.('whoosh');
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
      h('span', { class: 'spot-label__flag' }, h('span', { class: 'spot-label__icon', html: spotIcon(s.id) }), h('span', { class: 'spot-label__text' }, h('b', {}, s.title), h('small', {}, s.subtitle))),
      h('span', { class: 'spot-label__stem', 'aria-hidden': 'true' }),
    );
    labelLayer.append(el);
    return { spot: s, el, pos: new THREE.Vector3(s.focus[0], s.focus[1] + (s.id === 'code' ? 2.2 : 3.2), s.focus[2]), shown: false };
  });
  const hsLayer = h('div', { class: 'hs-layer', role: 'group', 'aria-label': 'Things to explore here' });
  root.append(labelLayer, hsLayer);
  let hsButtons = [];
  function rebuildHotspotButtons(spotId) {
    const list = ctx.interactions?.forSpot?.(spotId) ?? [];
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
      return { hs, b };
    });
    hsLayer.replaceChildren(...hsButtons.map((x) => x.b));
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

  // ── journal page ──────────────────────────────────────────────────────────
  const journal = createJournal(ctx, { onClose: () => ui.closePanel(), onNavigate: (id) => ui.openEntry(id) });
  root.append(journal.el);
  function closeJournal({ release = true } = {}) {
    if (!journal.isOpen) return;
    journal.close();
    ui.isPanelOpen = false;
    root.classList.remove('has-panel');
    ctx.interactions?.setOpen?.(null);
    ctx.cameraRig?.setInset?.({ right: 0, bottom: 0 });
    ctx.audio?.play?.('close');
    if (release) ctx.cameraRig?.release?.();
  }

  // ── modal (guidebook / map / help / fallback) ─────────────────────────────
  const modalBody = h('div', { class: 'modal__body' });
  const modalClose = h('button', { class: 'modal__close', type: 'button', 'aria-label': 'Close', html: icon('close'), onclick: () => closeModal() });
  const modalCard = h('div', { class: 'modal__card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title', tabindex: '-1' }, modalClose, modalBody);
  const modal = h('div', { class: 'modal', hidden: true, onclick: (e) => e.target === modal && closeModal() }, modalCard);
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
  }
  function closeModal() {
    if (modal.hidden || root.classList.contains('is-fallback')) return;
    modal.hidden = true;
    modalKind = null;
    ui.isModalOpen = false;
    root.classList.remove('has-modal');
    modalRelease?.();
    modalRelease = null;
    ctx.audio?.play?.('close');
    if (modalLastFocus && document.contains(modalLastFocus) && modalLastFocus !== document.body) modalLastFocus.focus({ preventScroll: true });
  }
  const map = createMap(ctx, {
    onPick: (id) => {
      closeModal();
      go(id);
    },
  });

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
      h('h1', { id: 'intro-title', class: 'intro__title' }, `${P.name}'s Woodland`),
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
  function enterWoodland() {
    ctx.audio?.unlock?.();
    ctx.audio?.setEnabled?.(ctx.audio?.preference ?? true);
    syncSound();
    ctx.audio?.play?.('whoosh');
    hideIntro();
    ctx.cameraRig?.playIntro?.().then((ok) => {
      if (ok) showHintOnce();
    });
    ctx.engine?.renderer?.domElement?.focus?.({ preventScroll: true });
  }
  function skipToGuidebook() {
    hideIntro();
    ctx.cameraRig?.goTo?.('glen', { instant: true });
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
    ui.toast(isTouch ? 'Drag to look around · pinch to zoom · tap the ✦ sparkles · swipe to travel' : 'Drag to look around · scroll to zoom · click the ✦ sparkles · ← → to travel', seen ? 4200 : 7000, { icon: 'sparkle' });
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
        closeModal();
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
  function frame() {
    const rig = ctx.cameraRig;
    const cam = ctx.camera;
    if (!rig || !cam) return;
    cam.updateMatrixWorld(); // the rig moved it this frame; project with fresh matrices
    const W = innerWidth, H = innerHeight;
    // floating spot labels in the overview
    const showLabels = rig.spot === 'glen' && !rig.transitioning && !rig.focused && !ui.isModalOpen && !intro;
    for (const l of labels) {
      let on = showLabels;
      if (on) {
        v.copy(l.pos).project(cam);
        on = v.z < 1 && Math.abs(v.x) < 0.94 && v.y < 0.8 && v.y > -0.82;
        if (on) l.el.style.transform = `translate(${((v.x + 1) / 2) * W}px, ${((1 - v.y) / 2) * H}px)`;
      }
      if (on !== l.shown) {
        l.shown = on;
        l.el.classList.toggle('is-shown', on);
        l.el.tabIndex = on ? 0 : -1;
      }
    }
    // keyboard hotspot buttons follow their markers
    for (const x of hsButtons) {
      ctx.interactions.screenPosition(x.hs, sp);
      x.b.style.transform = `translate(${sp.x}px, ${sp.y}px)`;
      x.b.tabIndex = sp.visible && !rig.transitioning ? 0 : -1;
    }
    // speech bubbles
    for (const b of bubbles) b.update();
    // keep the subject framed beside the journal page
    if (journal.isOpen) rig.setInset(journal.inset());
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
        const x = Math.min(innerWidth - 90, Math.max(90, ((v.x + 1) / 2) * innerWidth));
        const y = Math.max(70, ((1 - v.y) / 2) * innerHeight);
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
        if (id === 'glen') banner.classList.remove('is-visible');
      });
      rig?.onArrive?.((id) => {
        if (id && id !== 'glen' && !journal.isOpen) ui.showAreaBanner(id);
      });
      rebuildHotspotButtons(rig?.spot ?? 'glen');
      const it = ctx.interactions;
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
        secretsTag.classList.remove('is-pop');
        void secretsTag.offsetWidth;
        secretsTag.classList.add('is-pop');
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
    },
    showIntro() {
      ctx.cameraRig?.holdIntro?.();
      root.classList.add('is-intro');
      intro = buildIntro();
      requestAnimationFrame(() => intro?.enter.focus({ preventScroll: true }));
    },
    openEntry(id, opts = {}) {
      const entry = content.getEntry(id);
      if (!entry) return console.warn('[ui] unknown entry', id);
      currentEntry = entry;
      closeModal();
      ui.hideTooltip();
      journal.open(entry, { siblings: content.entriesForArea(entry.area) });
      ui.isPanelOpen = true;
      root.classList.add('has-panel');
      banner.classList.remove('is-visible');
      ctx.audio?.play?.('page');
      ctx.interactions?.markVisited?.(id);
      const rig = ctx.cameraRig;
      if (!rig) return;
      rig.setInset(journal.inset());
      const hs = opts.hotspot ?? ctx.interactions?.findByEntry?.(id);
      focusing = true;
      try {
        if (hs) {
          ctx.interactions?.setOpen?.(hs);
          rig.focus(hs.object, { ...(hs.focus ?? {}), spot: SPOT_BY_ID[hs.area] ? hs.area : undefined });
        } else {
          const spotId = SPOT_FOR_AREA[entry.area];
          if (spotId && spotId !== rig.spot) rig.goTo(spotId);
        }
      } finally {
        focusing = false;
      }
    },
    openArea(id) {
      ui.showGuidebook();
      requestAnimationFrame(() => document.getElementById(`guide-${id}`)?.scrollIntoView({ block: 'start' }));
    },
    closePanel() {
      closeJournal({ release: true });
    },
    showGuidebook() {
      openModal(
        'guide',
        renderGuidebook(ctx, {
          show3d: !!ctx.cameraRig,
          onShow: (id) => {
            closeModal();
            ui.openEntry(id);
          },
          onVisit: (id) => {
            closeModal();
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
        h('p', { class: 'help__secret' }, h('span', { html: icon('sparkle') }), 'Not everything here has a sparkle. A few little secrets hide in the glen — hover around and see who answers.'),
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
        secret ? (visited ? 'an old friend' : 'psst… say hello') : hotspot?.entryId ? (visited ? 'read again' : `${isTouch ? 'tap' : 'click'} to open the journal page`) : `${isTouch ? 'tap' : 'click'}`,
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
    toast(text, ms = 4200, { icon: ic, cls = '' } = {}) {
      const el = h('div', { class: `toast ${cls}` }, ic && h('span', { class: 'toast__icon', html: icon(ic) }), h('span', {}, text));
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
