// ─────────────────────────────────────────────────────────────────────────────
// Environment state — day/night. `env.night` eases between 0 (golden afternoon)
// and 1 (moonlit night). Anything that should react (lights, sky, fireflies,
// window glow, lanterns) reads env.night every frame or subscribes onChange.
// ─────────────────────────────────────────────────────────────────────────────
import { materials } from '../core/materials.js';
import { damp } from '../core/rng.js';

export function createEnv(engine) {
  const params = engine.params;
  let initial = 0;
  if (params.has('night')) initial = params.get('night') === '0' ? 0 : 1;
  else if (!params.has('shots')) {
    const h = new Date().getHours();
    initial = h >= 21 || h < 6 ? 1 : 0;
  }
  const listeners = new Set();
  const env = {
    night: initial,
    target: initial,
    get isNight() {
      return env.target > 0.5;
    },
    setNight(on, instant = false) {
      env.target = on ? 1 : 0;
      if (instant) env.night = env.target;
      for (const fn of listeners) fn(env.target, env);
    },
    toggle() {
      env.setNight(!env.isNight);
    },
    /** fn(targetNight, env) — called when the target changes. */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  engine.addUpdate((dt, t) => {
    env.night += (env.target - env.night) * damp(1.3, dt);
    if (Math.abs(env.target - env.night) < 1e-3) env.night = env.target;
    materials.update(dt, t, env.night);
  }, 5);
  return env;
}
