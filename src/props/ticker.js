// Registry of animated props. A prop calls registerAnimated(object, fn) once;
// tickProps(dt, t) runs fn(dt, t) for every registered prop that is still in
// the scene graph and visible.
const animated = new Set();

/** fn(dt, t) is called every frame while `object` is attached to a scene. */
export function registerAnimated(object, fn) {
  const entry = { object, fn };
  animated.add(entry);
  return () => animated.delete(entry);
}

function inScene(o) {
  while (o) {
    if (o.isScene) return true;
    if (!o.visible) return false;
    o = o.parent;
  }
  return false;
}

export function tickProps(dt, t) {
  for (const e of animated) {
    if (inScene(e.object)) e.fn(dt, t);
  }
}
