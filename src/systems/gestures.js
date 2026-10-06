// ─────────────────────────────────────────────────────────────────────────────
// Gestures — ONE place that turns raw pointer events on the canvas into
// intentions, so a camera drag never becomes a click and a pinch never
// becomes a tap. Shared by interactions (taps, hover, hold-to-walk) and the
// camera rig (orbit, zoom).
//
//   tap        quick press + release without moving (mouse: left button)
//   drag       one pointer moved beyond the slop → orbit   { dx, dy, button, pointerType }
//   dragend    release after a drag                         { vx, vy } px/s for inertia
//   pinch      two pointers                                 { scale, rotate, dx, dy } per move
//   hold       pressed still for HOLD_MS → "walk towards my finger" { x, y }
//   holdmove   pointer moved while holding                  { x, y }
//   holdend
//   hover      mouse moved with no button pressed           { x, y }
//   input      any user input at all (pointer, wheel, key) — e.g. to skip the intro
//
//   const off = gestures.on('tap', (e) => …)
// ─────────────────────────────────────────────────────────────────────────────

const HOLD_MS = 420;

export function createGestures(canvas, { isTouch = false } = {}) {
  const listeners = new Map();
  const pointers = new Map(); // id → { x, y, sx, sy, t0, type, button }
  let mode = 'none'; // none | pending | drag | hold | pinch | dead
  let holdTimer = 0;
  let holdFrame = 0;
  let pinch = null; // { d, a, cx, cy }
  let vx = 0, vy = 0, lastMoveT = 0;
  let lastX = 0, lastY = 0;

  canvas.style.touchAction = 'none';

  function emit(type, data) {
    const set = listeners.get(type);
    if (set) for (const fn of set) fn(data);
  }
  const slopFor = (type) => (type === 'mouse' ? 6 : 11);

  function pinchState() {
    const [a, b] = [...pointers.values()];
    return {
      d: Math.hypot(a.x - b.x, a.y - b.y),
      a: Math.atan2(b.y - a.y, b.x - a.x),
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
    };
  }

  function clearHold() {
    if (holdTimer) clearTimeout(holdTimer);
    if (holdFrame) cancelAnimationFrame(holdFrame);
    holdTimer = holdFrame = 0;
  }

  canvas.addEventListener('pointerdown', (e) => {
    emit('input', e);
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not supported */
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), type: e.pointerType, button: e.button });
    lastX = e.clientX;
    lastY = e.clientY;
    vx = vy = 0;
    lastMoveT = performance.now();
    if (pointers.size === 1) {
      mode = 'pending';
      clearHold();
      if (e.button === 0) {
        // Decide on the next animation frame: queued pointermoves (after a long
        // frame) are dispatched before rAF, so a drag is never mistaken for a hold.
        holdTimer = setTimeout(() => {
          holdTimer = 0;
          holdFrame = requestAnimationFrame(() => {
            holdFrame = 0;
            if (mode !== 'pending' || pointers.size !== 1) return;
            mode = 'hold';
            const p = pointers.values().next().value;
            emit('hold', { x: p.x, y: p.y, pointerType: p.type });
          });
        }, HOLD_MS);
      }
    } else if (pointers.size === 2) {
      clearHold();
      if (mode === 'drag') emit('dragend', { vx: 0, vy: 0 });
      if (mode === 'hold') emit('holdend', {});
      mode = 'pinch';
      pinch = pinchState();
    } else {
      mode = 'dead';
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' && e.buttons === 0) emit('hover', { x: e.clientX, y: e.clientY });
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (mode === 'pinch' && pointers.size === 2) {
      const s = pinchState();
      let rot = s.a - pinch.a;
      rot = Math.atan2(Math.sin(rot), Math.cos(rot));
      emit('pinch', { scale: s.d / Math.max(pinch.d, 1), rotate: rot, dx: s.cx - pinch.cx, dy: s.cy - pinch.cy, cx: s.cx, cy: s.cy });
      pinch = s;
      return;
    }
    if (mode === 'pending' && Math.hypot(p.x - p.sx, p.y - p.sy) > slopFor(p.type)) {
      clearHold();
      mode = 'drag';
      emit('dragstart', { button: p.button, pointerType: p.type });
    }
    if (mode === 'drag') {
      const now = performance.now();
      const dt = Math.max(1, now - lastMoveT) / 1000;
      lastMoveT = now;
      // smoothed velocity for orbit inertia
      vx += (dx / dt - vx) * 0.45;
      vy += (dy / dt - vy) * 0.45;
      emit('drag', { dx, dy, button: p.button, pointerType: p.type });
    } else if (mode === 'hold') {
      emit('holdmove', { x: p.x, y: p.y, pointerType: p.type });
    }
    lastX = p.x;
    lastY = p.y;
  });

  function end(e, cancelled) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (pointers.size > 0) {
      // lifting one finger of a pinch: ignore the rest of the gesture
      if (mode === 'pinch') mode = 'dead';
      return;
    }
    clearHold();
    const m = mode;
    mode = 'none';
    if (m === 'drag') {
      const still = performance.now() - lastMoveT > 90;
      emit('dragend', { vx: still ? 0 : vx, vy: still ? 0 : vy });
    } else if (m === 'hold') {
      emit('holdend', {});
    } else if (m === 'pending' && !cancelled) {
      const dt = performance.now() - p.t0;
      if (p.button === 0 && dt < 900) emit('tap', { x: e.clientX, y: e.clientY, pointerType: p.type, event: e });
    }
  }
  canvas.addEventListener('pointerup', (e) => end(e, false));
  canvas.addEventListener('pointercancel', (e) => end(e, true));
  canvas.addEventListener('lostpointercapture', (e) => end(e, true));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => emit('input', e), { passive: true });
  window.addEventListener('keydown', (e) => emit('input', e));

  return {
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type).delete(fn);
    },
    /** Current gesture: 'none' | 'pending' | 'drag' | 'hold' | 'pinch' | 'dead'. */
    get mode() {
      return mode;
    },
    get pointerCount() {
      return pointers.size;
    },
    /** Last known pointer position (client px). */
    get x() {
      return lastX;
    },
    get y() {
      return lastY;
    },
    isTouch,
  };
}
