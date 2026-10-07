// ─────────────────────────────────────────────────────────────────────────────
// Registry of animated props. A prop calls registerAnimated(object, fn) once;
// tickProps(dt, t) (wired by main.js at order 25) runs fn(dt, t, near) for every
// registered prop that is attached to the scene and visible.
//
// Distance LOD: when a camera is known (configureProps({ camera }) or, lazily,
// window.__woodland.ctx.camera) props further than `farDistance` from it are
// only ticked every 4th frame, and beyond `cullDistance` not at all — their
// animation simply pauses where nobody can see it. `near` (0..1) tells the
// callback how close it is, so it can skip fine details far away.
//
// Self-ticking vs manual updates (persons, snails): a prop that offers an
// update(dt) method registers itself here AND switches to manual mode the
// first time somebody calls update(dt) — see makeManualSwitch(). That way the
// player (which drives its own person) and the transport system (which drives
// its snails) never double-update, and villagers dropped into a district just
// work without any wiring.
//
// The ticker also runs the lamplighter's dusk clock (lamplighter.js), so every
// warm lamp of the glen lights in its cascade.
// ─────────────────────────────────────────────────────────────────────────────
import { tickLamplighter } from './lamplighter.js';

const animated = new Set();

/** Shared runtime settings for the props kit (quality tier, motion, camera). */
export const propsSettings = {
  camera: null,
  quality: null, // { tier, density, shadows } — ctx.quality
  reducedMotion: typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false,
  farDistance: 45,
  cullDistance: 110,
};

/**
 * Optional: hand the props kit the shared ctx (camera, quality, reduced motion).
 * Without it the kit reads window.__woodland.ctx lazily.
 */
export function configureProps(ctx = {}) {
  if (ctx.camera) propsSettings.camera = ctx.camera;
  if (ctx.quality) propsSettings.quality = ctx.quality;
  if (ctx.engine && typeof ctx.engine.reducedMotion === 'boolean') propsSettings.reducedMotion = ctx.engine.reducedMotion;
  if (typeof ctx.reducedMotion === 'boolean') propsSettings.reducedMotion = ctx.reducedMotion;
}

function lazyCtx() {
  const c = typeof window !== 'undefined' ? window.__woodland?.ctx : null;
  if (!c) return;
  if (!propsSettings.camera && c.camera) propsSettings.camera = c.camera;
  if (!propsSettings.quality && c.quality) propsSettings.quality = c.quality;
  if (c.engine && typeof c.engine.reducedMotion === 'boolean') propsSettings.reducedMotion = c.engine.reducedMotion;
}

/** Quality tier as seen by the props kit ('high' when unknown). */
export function qualityTier() {
  if (!propsSettings.quality) lazyCtx();
  return propsSettings.quality?.tier ?? 'high';
}

/** fn(dt, t, near) is called every frame while `object` is attached to a scene. Returns an unregister fn. */
export function registerAnimated(object, fn) {
  const entry = { object, fn, phase: animated.size & 3 };
  animated.add(entry);
  return () => animated.delete(entry);
}

/**
 * For props with a public update(dt): registers `tick` in the ticker and
 * returns { manual() } — call manual() at the top of the public update() to
 * permanently hand control to the caller (removes the ticker entry).
 */
export function makeManualSwitch(object, tick) {
  let unregister = registerAnimated(object, tick);
  return {
    get selfTicked() {
      return !!unregister;
    },
    manual() {
      if (unregister) {
        unregister();
        unregister = null;
      }
    },
  };
}

function inScene(o) {
  while (o) {
    if (!o.visible) return false;
    if (o.isScene) return true;
    o = o.parent;
  }
  return false;
}

let frame = 0;
const acc = new Map(); // entry → accumulated dt while throttled

export function tickProps(dt, t) {
  frame++;
  if (!propsSettings.camera) lazyCtx();
  tickLamplighter(dt, propsSettings.reducedMotion);
  const cam = propsSettings.camera;
  const cx = cam ? cam.position.x : 0, cy = cam ? cam.position.y : 0, cz = cam ? cam.position.z : 0;
  const far2 = propsSettings.farDistance * propsSettings.farDistance;
  const cull2 = propsSettings.cullDistance * propsSettings.cullDistance;
  for (const e of animated) {
    if (!inScene(e.object)) continue;
    let near = 1;
    if (cam) {
      const m = e.object.matrixWorld.elements;
      const dx = m[12] - cx, dy = m[13] - cy, dz = m[14] - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > cull2) continue;
      if (d2 > far2) {
        // far away: tick at quarter rate with the accumulated time
        const a = (acc.get(e) || 0) + dt;
        if (((frame + e.phase) & 3) !== 0) {
          acc.set(e, a);
          continue;
        }
        acc.set(e, 0);
        e.fn(a, t, 0);
        continue;
      }
      near = 1 - Math.sqrt(d2 / far2);
    }
    e.fn(dt, t, near);
  }
}

/** Number of registered animated props (debug). */
export function animatedCount() {
  return animated.size;
}
