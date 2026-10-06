// ─────────────────────────────────────────────────────────────────────────────
// UI — the HTML layer on top of the canvas: loader, intro, HUD, content panel,
// guidebook, Schneckenpost destination picker, tooltips and toasts.
// BASELINE: functional; the UI builder will make it delightful.
//
// Public API (used by the world & systems — keep these names):
//   ui.setProgress(0..1, label)    ui.ready()          ui.showIntro()
//   ui.openEntry(id, {hotspot})    ui.openArea(id)     ui.closePanel()
//   ui.showGuidebook()             ui.showDestinations(fromAreaId)
//   ui.showTooltip(label, hotspot) ui.moveTooltip(x,y) ui.hideTooltip()
//   ui.toast(text)                 ui.showAreaBanner(areaId)
//   ui.speech(text, worldPos, {duration})   (speech bubble over a villager)
//   ui.isPanelOpen                 ui.showFallback(reason)
//   ui.showPrompt(text, hotspot)   ui.hidePrompt()     (proximity "press E" prompt)
//   ui.showRideHUD({ from, to, onSkip })  ui.hideRideHUD()   (during snail rides)
//   ui.fade(true|false) → Promise  (fade to/from a soft overlay, for cuts/teleports)
//   ui.showMap()
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { AREAS, AREA_BY_ID } from '../world/layout.js';

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
};

export function createUI(ctx) {
  const root = document.getElementById('ui');
  const { content } = ctx;

  // ── loader ──
  const bar = h('div', { class: 'loader__bar-fill' });
  const loaderLabel = h('div', { class: 'loader__label' }, 'Planting mushrooms…');
  const loader = h(
    'div',
    { class: 'loader', role: 'status' },
    h('div', { class: 'loader__title' }, `${content.profile.name}'s Woodland`),
    h('div', { class: 'loader__bar' }, bar),
    loaderLabel
  );
  root.append(loader);

  // ── HUD ──
  const brand = h(
    'div',
    { class: 'hud-brand' },
    h('div', { class: 'hud-brand__name' }, `${content.profile.name}'s Woodland`),
    h('div', { class: 'hud-brand__tag' }, content.profile.tagline)
  );
  const btn = (icon, label, onclick) =>
    h('button', { class: 'hud-btn', type: 'button', 'aria-label': label, title: label, onclick }, icon);
  const nightBtn = btn('🌙', 'Toggle day / night', () => ctx.env.toggle());
  ctx.env.onChange((t) => (nightBtn.textContent = t > 0.5 ? '☀️' : '🌙'));
  nightBtn.textContent = ctx.env.isNight ? '☀️' : '🌙';
  const hud = h(
    'div',
    { class: 'hud' },
    brand,
    h(
      'div',
      { class: 'hud-actions' },
      btn('📖', 'Guidebook — everything at a glance', () => ui.showGuidebook()),
      btn('🐌', 'Schneckenpost — travel', () => ui.showDestinations(ctx.player?.area ?? 'plaza')),
      nightBtn
    )
  );
  hud.hidden = true;
  root.append(hud);

  // ── tooltip ──
  const tooltip = h('div', { class: 'tooltip', role: 'tooltip' });
  tooltip.hidden = true;
  root.append(tooltip);

  // ── toast ──
  const toastEl = h('div', { class: 'toast' });
  root.append(toastEl);
  let toastTimer = 0;

  // ── area banner ──
  const banner = h('div', { class: 'area-banner' });
  root.append(banner);
  let bannerTimer = 0;

  // ── panel ──
  const panelBody = h('div', { class: 'panel__body' });
  const panel = h(
    'aside',
    { class: 'panel', 'aria-hidden': 'true', tabindex: '-1' },
    h('button', { class: 'panel__close', type: 'button', 'aria-label': 'Close', onclick: () => ui.closePanel() }, '×'),
    panelBody
  );
  root.append(panel);

  // ── proximity prompt, ride HUD, fader ──
  const prompt = h('div', { class: 'prompt' });
  prompt.hidden = true;
  const rideHud = h('div', { class: 'ride-hud' });
  rideHud.hidden = true;
  const fader = h('div', { class: 'fader' });
  root.append(prompt, rideHud, fader);

  // ── modal (guidebook / destinations) ──
  const modalBody = h('div', { class: 'modal__body' });
  const modal = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', hidden: true, onclick: (e) => e.target === modal && closeModal() },
    h(
      'div',
      { class: 'modal__card' },
      h('button', { class: 'panel__close', type: 'button', 'aria-label': 'Close', onclick: () => closeModal() }, '×'),
      modalBody
    )
  );
  root.append(modal);
  function openModal(...children) {
    modalBody.replaceChildren(...children);
    modal.hidden = false;
  }
  function closeModal() {
    modal.hidden = true;
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!modal.hidden) closeModal();
      else ui.closePanel();
    }
  });

  function renderEntry(entry) {
    const area = AREA_BY_ID[entry.area];
    return [
      h('div', { class: 'panel__kicker' }, [area?.icon, area?.title].filter(Boolean).join(' ')),
      h('h2', { class: 'panel__title' }, entry.title),
      entry.subtitle && h('p', { class: 'panel__subtitle' }, entry.subtitle),
      entry.images?.length
        ? h('div', { class: 'panel__images' }, entry.images.map((im) => h('img', { src: im.src, alt: im.alt ?? '' })))
        : h('div', { class: 'panel__placeholder' }, '📷 photos coming soon'),
      ...(entry.body ?? []).map((p) => h('p', {}, p)),
      entry.facts?.length &&
        h('dl', { class: 'panel__facts' }, entry.facts.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      entry.tags?.length && h('div', { class: 'panel__tags' }, entry.tags.map((t) => h('span', { class: 'tag' }, t))),
      entry.kind === 'contact' &&
        h(
          'div',
          { class: 'panel__links' },
          content.profile.email && h('a', { class: 'btn', href: `mailto:${content.profile.email}` }, '✉️ Write me'),
          content.profile.links.map((l) => h('a', { class: 'btn', href: l.href, target: '_blank', rel: 'noopener' }, l.label))
        ),
      entry.links?.length &&
        h('div', { class: 'panel__links' }, entry.links.map((l) => h('a', { class: 'btn', href: l.href, target: '_blank', rel: 'noopener' }, l.label))),
    ];
  }

  const ui = {
    root,
    isPanelOpen: false,
    setProgress(p, label) {
      bar.style.width = `${Math.round(p * 100)}%`;
      if (label) loaderLabel.textContent = label;
    },
    ready() {
      loader.classList.add('is-done');
      setTimeout(() => loader.remove(), 800);
      hud.hidden = false;
    },
    showIntro() {
      ui.toast(`Welcome! Click the ground to walk · drag to look around · click glowing things to explore`);
    },
    openEntry(id, opts = {}) {
      const entry = content.getEntry(id);
      if (!entry) return console.warn('[ui] unknown entry', id);
      panelBody.replaceChildren(...renderEntry(entry).filter(Boolean));
      panel.classList.add('is-open');
      panel.setAttribute('aria-hidden', 'false');
      ui.isPanelOpen = true;
      panel.focus({ preventScroll: true });
      if (opts.hotspot) ctx.cameraRig?.focus(opts.hotspot.object, opts.hotspot.focus ?? {});
    },
    openArea(id) {
      const a = content.areas[id];
      if (!a) return;
      const list = content.entriesForArea(id);
      panelBody.replaceChildren(
        h('div', { class: 'panel__kicker' }, a.kicker),
        h('h2', { class: 'panel__title' }, a.title),
        h('p', {}, a.text),
        h('ul', { class: 'panel__list' }, list.map((e) => h('li', {}, h('button', { type: 'button', class: 'linkish', onclick: () => ui.openEntry(e.id) }, e.title))))
      );
      panel.classList.add('is-open');
      ui.isPanelOpen = true;
    },
    closePanel() {
      panel.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'true');
      ui.isPanelOpen = false;
      ctx.cameraRig?.release();
    },
    showGuidebook() {
      const sections = AREAS.map((a) => {
        const list = content.entriesForArea(a.id);
        const info = content.areas[a.id];
        return h(
          'section',
          { class: 'guide__area' },
          h('h3', {}, `${a.icon} ${info?.title ?? a.title}`),
          info && h('p', {}, info.text),
          list.length > 0 &&
            h('ul', {}, list.map((e) => h('li', {}, h('button', { type: 'button', class: 'linkish', onclick: () => { closeModal(); ui.openEntry(e.id); } }, e.title), e.summary ? ` — ${e.summary}` : '')))
        );
      });
      openModal(h('h2', {}, '📖 Guidebook'), h('p', {}, content.profile.intro), ...sections);
    },
    showDestinations(fromAreaId) {
      openModal(
        h('h2', {}, '🐌 Schneckenpost'),
        h('p', {}, 'Where would you like to go?'),
        h(
          'div',
          { class: 'dest-grid' },
          AREAS.filter((a) => a.id !== fromAreaId).map((a) =>
            h(
              'button',
              { type: 'button', class: 'dest', onclick: () => { closeModal(); ctx.transport?.travelTo(a.id); } },
              h('span', { class: 'dest__icon' }, a.icon),
              h('span', { class: 'dest__title' }, a.title),
              h('span', { class: 'dest__sub' }, a.subtitle)
            )
          )
        )
      );
    },
    showTooltip(label, hotspot) {
      tooltip.textContent = label;
      tooltip.hidden = !label;
    },
    moveTooltip(x, y) {
      tooltip.style.transform = `translate(${x + 16}px, ${y + 12}px)`;
    },
    hideTooltip() {
      tooltip.hidden = true;
    },
    toast(text, ms = 4200) {
      toastEl.textContent = text;
      toastEl.classList.add('is-visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), ms);
    },
    showAreaBanner(areaId) {
      const a = AREA_BY_ID[areaId];
      if (!a) return;
      const info = content.areas[areaId];
      banner.replaceChildren(h('div', { class: 'area-banner__kicker' }, info?.kicker ?? a.subtitle), h('div', { class: 'area-banner__title' }, `${a.icon} ${info?.title ?? a.title}`));
      banner.classList.add('is-visible');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('is-visible'), 3200);
    },
    speech(text, worldPos, { duration = 3500 } = {}) {
      const el = h('div', { class: 'speech' }, text);
      root.append(el);
      const v = new THREE.Vector3();
      const stop = ctx.engine.addUpdate(() => {
        v.copy(worldPos?.isObject3D ? worldPos.getWorldPosition(v) : worldPos);
        v.y += 1.6;
        v.project(ctx.camera);
        el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px)`;
        el.style.opacity = v.z < 1 ? '1' : '0';
      }, 95);
      setTimeout(() => { stop(); el.remove(); }, duration);
    },
    showPrompt(text) {
      prompt.textContent = text;
      prompt.hidden = false;
    },
    hidePrompt() {
      prompt.hidden = true;
    },
    showRideHUD({ from, to, onSkip } = {}) {
      rideHud.replaceChildren(
        h('span', {}, `🐌 ${AREA_BY_ID[from]?.title ?? ''} → ${AREA_BY_ID[to]?.title ?? ''}`),
        onSkip && h('button', { type: 'button', class: 'btn', onclick: onSkip }, 'Skip ⏩')
      );
      rideHud.hidden = false;
    },
    hideRideHUD() {
      rideHud.hidden = true;
    },
    fade(on) {
      fader.classList.toggle('is-on', !!on);
      return new Promise((r) => setTimeout(r, 450));
    },
    showMap() {
      ui.showDestinations(ctx.player?.area ?? 'plaza');
    },
    showFallback(reason) {
      loader.remove();
      openModal(h('h2', {}, `${content.profile.name}'s Woodland`), h('p', {}, reason));
      ui.showGuidebook();
    },
  };
  return ui;
}
