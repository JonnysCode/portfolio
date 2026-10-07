// ─────────────────────────────────────────────────────────────────────────────
// Pointer gestures — ONE place that turns raw pointer events on the canvas
// into intentions, so a camera drag never becomes a click and a pinch never
// becomes a tap. Shared by interactions (taps, hover) and the camera rig
// (orbit, pan, zoom, swipe between spots).
//
//   tap        quick press + release without moving     { x, y, pointerType, event }
//   dragstart  one pointer moved beyond the slop         { button, pointerType, shift }
//   drag       per move while dragging                  { dx, dy, button, pointerType, shift }
//   dragend    release after a drag                     { vx, vy, totalX, totalY, ms, pointerType }
//              (vx/vy in px/s, smoothed; 0 when the pointer rested before lifting)
//   pinch      two pointers, per move                   { scale, dx, dy, cx, cy }
//   pinchend
//   hover      mouse moved with no button pressed       { x, y }
//   input      any user input at all (pointer, wheel, key)
//
//   const off = gestures.on('tap', (e) => …)
// (Replaces the walk-era gestures.js, which had press-and-hold steering.)
// ─────────────────────────────────────────────────────────────────────────────

export function createPointerGestures(canvas) {
  const listeners = new Map();
  const pointers = new Map(); // id → { x, y, sx, sy, t0, type, button, shift }
  let mode = 'none'; // none | pending | drag | pinch | dead
  let pinch = null;
  let vx = 0, vy = 0, lastMoveT = 0, dragT0 = 0;
  let lastX = 0, lastY = 0;

  canvas.style.touchAction = 'none';

  function emit(type, data) {
    const set = listeners.get(type);
    if (set) for (const fn of set) fn(data);
  }
  const slopFor = (type) => (type === 'mouse' ? 5 : 10);

  function pinchState() {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  canvas.addEventListener('pointerdown', (e) => {
    emit('input', e);
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not supported */
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), type: e.pointerType, button: e.button, shift: e.shiftKey });
    lastX = e.clientX;
    lastY = e.clientY;
    vx = vy = 0;
    lastMoveT = performance.now();
    if (pointers.size === 1) mode = 'pending';
    else if (pointers.size === 2) {
      if (mode === 'drag') emit('dragend', { vx: 0, vy: 0, totalX: 0, totalY: 0, ms: 0, pointerType: e.pointerType });
      mode = 'pinch';
      pinch = pinchState();
    } else mode = 'dead';
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
      emit('pinch', { scale: s.d / Math.max(pinch.d, 1), dx: s.cx - pinch.cx, dy: s.cy - pinch.cy, cx: s.cx, cy: s.cy });
      pinch = s;
      return;
    }
    if (mode === 'pending' && Math.hypot(p.x - p.sx, p.y - p.sy) > slopFor(p.type)) {
      mode = 'drag';
      dragT0 = performance.now();
      emit('dragstart', { button: p.button, pointerType: p.type, shift: p.shift });
    }
    if (mode === 'drag') {
      const now = performance.now();
      const dt = Math.max(1, now - lastMoveT) / 1000;
      lastMoveT = now;
      // smoothed velocity for orbit inertia
      vx += (dx / dt - vx) * 0.45;
      vy += (dy / dt - vy) * 0.45;
      emit('drag', { dx, dy, button: p.button, pointerType: p.type, shift: p.shift || e.shiftKey });
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
      if (mode === 'pinch') {
        mode = 'dead';
        emit('pinchend', {});
      }
      return;
    }
    const m = mode;
    mode = 'none';
    if (m === 'drag') {
      const still = performance.now() - lastMoveT > 90;
      emit('dragend', {
        vx: still ? 0 : vx,
        vy: still ? 0 : vy,
        totalX: e.clientX - p.sx,
        totalY: e.clientY - p.sy,
        ms: performance.now() - dragT0,
        pointerType: p.type,
      });
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
    /** Current gesture: 'none' | 'pending' | 'drag' | 'pinch' | 'dead'. */
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
  };
}
