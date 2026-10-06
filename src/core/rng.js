// Small deterministic random helpers. Everything in the world is procedural,
// so seeding keeps the village identical on every visit.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 PRNG. Returns a function producing floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded random generator with convenience helpers.
 * `seed` may be a number or a string.
 */
export function createRng(seed = 1) {
  const next = mulberry32(typeof seed === 'string' ? hashString(seed) : seed);
  const rng = {
    next,
    /** float in [min, max) */
    range: (min, max) => min + (max - min) * next(),
    /** integer in [min, max] */
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    /** symmetric jitter in [-amount, amount) */
    jitter: (amount) => (next() * 2 - 1) * amount,
    /** returns a new independent generator derived from this one */
    fork: (label = '') => createRng(Math.floor(next() * 4294967296) ^ hashString(String(label))),
  };
  return rng;
}

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential damping factor. */
export const damp = (lambda, dt) => 1 - Math.exp(-lambda * dt);
