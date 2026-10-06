// ─────────────────────────────────────────────────────────────────────────────
// GLSL library for the texture bakery: TILEABLE noise on the unit square.
//
// Every pattern is evaluated in "cell space" p = uv * period with an integer
// period, and every lattice lookup wraps with mod(cell, period) — so a baked
// map repeats seamlessly. Octaves double both p and the period, which keeps
// fbm periodic too.
//
// Colours are authored as sRGB hex ints: C(0x8a7560). Kind functions mix in
// sRGB (painterly, perceptual) and the bake pass converts to linear at the end.
// ─────────────────────────────────────────────────────────────────────────────

export const NOISE_GLSL = /* glsl */ `
uniform float uSeed;

// ── hashing (integer, platform-stable) ──────────────────────────────────────
uint sfHashU(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}
uint sfHashCell(vec2 c, uint salt) {
  uvec2 u = uvec2(ivec2(floor(c + 0.5)) + 4096);
  return sfHashU(u.x ^ sfHashU(u.y ^ sfHashU(salt + uint(uSeed * 977.0))));
}
float hash1(vec2 c, uint salt) { return float(sfHashCell(c, salt) & 0xffffffu) / 16777215.0; }
float hash1(vec2 c) { return hash1(c, 11u); }
vec2 hash2(vec2 c, uint salt) {
  uint h = sfHashCell(c, salt);
  return vec2(float(h & 0xffffu), float(h >> 16)) / 65535.0;
}
vec2 hash2(vec2 c) { return hash2(c, 23u); }
vec3 hash3(vec2 c) { return vec3(hash2(c, 31u), hash1(c, 47u)); }

vec2 wrapc(vec2 c, vec2 per) { return mod(c, per); }

// ── periodic gradient noise, ~[-1, 1] ───────────────────────────────────────
vec2 sfGrad(vec2 c) { float a = hash1(c, 5u) * 6.2831853; return vec2(cos(a), sin(a)); }
float gnoise(vec2 p, vec2 per) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(sfGrad(wrapc(i, per)), f);
  float b = dot(sfGrad(wrapc(i + vec2(1.0, 0.0), per)), f - vec2(1.0, 0.0));
  float c = dot(sfGrad(wrapc(i + vec2(0.0, 1.0), per)), f - vec2(0.0, 1.0));
  float d = dot(sfGrad(wrapc(i + vec2(1.0, 1.0), per)), f - vec2(1.0, 1.0));
  return 1.45 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
/** Periodic value noise in [0, 1] — blobbier than gradient noise. */
float vnoise(vec2 p, vec2 per) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash1(wrapc(i, per), 3u), b = hash1(wrapc(i + vec2(1.0, 0.0), per), 3u);
  float c = hash1(wrapc(i + vec2(0.0, 1.0), per), 3u), d = hash1(wrapc(i + vec2(1.0, 1.0), per), 3u);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/** Periodic fBm of gradient noise, ~[-1, 1]. p is in cell space of 'per'. */
float fbm(vec2 p, vec2 per, int oct, float gain) {
  float s = 0.0, a = 1.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * gnoise(p, per);
    n += a;
    p = p * 2.0 + vec2(13.0, 7.0);
    per *= 2.0;
    a *= gain;
  }
  return s / n;
}
float fbm(vec2 p, vec2 per, int oct) { return fbm(p, per, oct, 0.5); }
/** fBm on the unit square: uv in [0,1), 'f' = base frequency (integer). */
float fbmu(vec2 uv, float f, int oct) { return fbm(uv * f, vec2(f), oct, 0.5); }
float fbmu(vec2 uv, vec2 f, int oct) { return fbm(uv * f, f, oct, 0.5); }
/** Ridged fBm in [0, 1] (sharp crests). */
float ridged(vec2 p, vec2 per, int oct) {
  float s = 0.0, a = 1.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float r = 1.0 - abs(gnoise(p, per));
    s += a * r * r;
    n += a;
    p = p * 2.0 + vec2(5.0, 11.0);
    per *= 2.0;
    a *= 0.5;
  }
  return s / n;
}

// ── periodic Voronoi ────────────────────────────────────────────────────────
// x: distance to the nearest feature point, y: distance to the cell border
// (exact, IQ), z: cell id hash [0,1), w: second id hash. 'cellOut' = the
// nearest cell's integer coords (wrapped) for further hashing.
vec4 voronoi(vec2 p, vec2 per, float jitter, out vec2 cellOut, out vec2 toCenter) {
  vec2 n = floor(p), f = fract(p);
  vec2 mg = vec2(0.0), mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = 0.5 + (hash2(wrapc(n + g, per)) - 0.5) * jitter;
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  float bd = 8.0;
  for (int j = -2; j <= 2; j++)
  for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 o = 0.5 + (hash2(wrapc(n + g, per)) - 0.5) * jitter;
    vec2 r = g + o - f;
    vec2 dr = r - mr;
    if (dot(dr, dr) > 1e-5) bd = min(bd, dot(0.5 * (mr + r), normalize(dr)));
  }
  cellOut = wrapc(n + mg, per);
  toCenter = mr;
  return vec4(sqrt(md), bd, hash1(cellOut, 101u), hash1(cellOut, 202u));
}
vec4 voronoi(vec2 p, vec2 per, float jitter) {
  vec2 c, t;
  return voronoi(p, per, jitter, c, t);
}

// ── shaping & colour helpers ────────────────────────────────────────────────
vec3 C(int hex) {
  return vec3(float((hex >> 16) & 255), float((hex >> 8) & 255), float(hex & 255)) / 255.0;
}
float sat(float x) { return clamp(x, 0.0, 1.0); }
vec3 sat(vec3 x) { return clamp(x, 0.0, 1.0); }
float remap(float x, float a, float b) { return sat((x - a) / (b - a)); }
float band(float x, float a, float b, float soft) { return smoothstep(a - soft, a, x) * (1.0 - smoothstep(b, b + soft, x)); }
vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec2 rot2(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
/** Wrapped difference on the unit torus (for distances to points near the seam). */
vec2 tdiff(vec2 a, vec2 b) { vec2 d = a - b; return d - floor(d + 0.5); }
/** Shift hue-ish towards warm (+) / cool (-) — cheap painterly temperature. */
vec3 temp(vec3 c, float t) { return c * vec3(1.0 + 0.10 * t, 1.0 + 0.02 * t, 1.0 - 0.12 * t); }

// Output of every surface kind (albedo is sRGB for 'rgb' kinds, control
// channels for 'colorize' kinds).
struct Surf { vec3 col; float h; float rough; float ao; };
Surf surf(vec3 col, float h, float rough, float ao) { Surf s; s.col = col; s.h = h; s.rough = rough; s.ao = ao; return s; }
`;
