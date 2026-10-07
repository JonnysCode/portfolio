// ─────────────────────────────────────────────────────────────────────────────
// Tiny DOM helpers for the UI layer (no framework).
//
//   h('button', { class: 'x', onclick, 'aria-label': '…' }, child, 'text', [more])
//   svg('<svg …>…</svg>')            → an element from markup we wrote ourselves
//   trapFocus(container) → release   keep Tab inside a dialog
// ─────────────────────────────────────────────────────────────────────────────

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k === 'html') el.innerHTML = v; // only ever used with our own static SVG markup
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    el.append(c.nodeType ? c : String(c));
  }
}

/** Parse trusted, hand-written SVG markup into an element. */
export function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"]), summary';

/** Keep keyboard focus inside `container` while it is open. Returns a release function. */
export function trapFocus(container) {
  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const items = [...container.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}

export const isTypingTarget = (t) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable]');
