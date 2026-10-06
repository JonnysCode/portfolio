// ─────────────────────────────────────────────────────────────────────────────
// Foliage leaf cards — alpha-tested sprites painted in GLSL (Surf.ao = alpha).
//
// Card convention (every variant): the stem / attachment point is at the
// BOTTOM CENTRE of the card (uv 0.5, 0) and the foliage grows towards +V.
// Leaves are composited back-to-front with soft drop shadows so a single card
// already reads as a little 3D cluster. Outside the leaves the colour is a
// dilated leaf colour (alpha 0) so mipmaps never fringe dark.
// ─────────────────────────────────────────────────────────────────────────────

const COMMON = /* glsl */ `
const float AA = 0.0035;
// leaf-local coordinates: origin at the petiole, leaf axis along +y, angle phi from +y (CCW)
vec2 leafLocal(vec2 p, vec2 o, float phi) { return rot2(p - o, -phi); }
void put(inout vec4 acc, vec3 c, float a) { acc.rgb = mix(acc.rgb, c, a); acc.a = max(acc.a, a); }
void shade(inout vec4 acc, float a, float k) { acc.rgb *= 1.0 - k * a * step(0.01, acc.a); }
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = sat(dot(pa, ba) / dot(ba, ba));
  return length(pa - ba * h);
}
// quadratic bezier sample
vec2 qbez(vec2 a, vec2 b, vec2 c, float t) { return mix(mix(a, b, t), mix(b, c, t), t); }
`;

export const FOLIAGE_VARIANTS = {
  oak: { size: [512, 512], ref: '#4d7a31' },
  fern: { size: [512, 512], ref: '#4f8a34' },
  ivy: { size: [512, 512], ref: '#2f5a26' },
  grass: { size: [256, 512], ref: '#6a9a3c' },
  needle: { size: [512, 512], ref: '#2d5238' },
  blossom: { size: [512, 512], ref: '#e7b8c4' },
};

export const FOLIAGE_GLSL = {
  // ── OAK — a twig of lobed oak leaves ──
  oak: COMMON + /* glsl */ `
float oakLeaf(vec2 l, float len, out float rib, out float along) {
  float x = l.y / len;
  along = x;
  float y = l.x / len;
  float base = pow(max(x, 0.0), 0.75) * pow(max(1.0 - x, 0.0), 0.45) * 1.25;
  float lobes = 0.72 + 0.28 * cos(x * 6.2831853 * 4.2 + 0.6);
  float w = 0.36 * base * lobes;
  rib = (1.0 - smoothstep(0.0, 0.025, abs(y))) * step(0.02, x) * step(x, 0.95);
  float lat = fract((x - abs(y) * 1.2) * 4.2 + 0.1);
  rib = max(rib, 0.5 * (1.0 - smoothstep(0.0, 0.08, min(lat, 1.0 - lat))) * step(abs(y), w * 0.85));
  float d = (w - abs(y)) * len;
  return smoothstep(-AA, AA, d) * step(0.0, x) * step(x, 1.0);
}
Surf card_oak(vec2 uv) {
  vec3 bg = C(0x4d7a31);
  vec4 acc = vec4(bg, 0.0);
  // twig
  vec2 a = vec2(0.5, 0.0), b = vec2(0.47, 0.45), c = vec2(0.55, 0.86);
  for (int i = 0; i < 15; i++) {
    float fi = float(i);
    float t = 0.12 + fi * 0.055;
    vec2 o = qbez(a, b, c, t);
    float side = mod(fi, 2.0) < 1.0 ? -1.0 : 1.0;
    float rnd = hash1(vec2(fi, 3.0), 9u);
    float phi = side * (0.75 + 0.5 * rnd) * (1.0 - t * 0.55);
    float len = (0.2 + 0.12 * hash1(vec2(fi, 4.0), 9u)) * (1.0 - 0.25 * t) * (i == 14 ? 1.15 : 1.0);
    if (i == 14) phi = 0.08;
    vec2 l = leafLocal(uv, o, phi);
    float rib, along;
    // drop shadow of this leaf onto what is below
    float sh = oakLeaf(leafLocal(uv + vec2(0.012, 0.016), o, phi), len * 1.04, rib, along);
    shade(acc, sh, 0.35);
    float m = oakLeaf(l, len, rib, along);
    if (m > 0.0) {
      float tone = hash1(vec2(fi, 7.0), 9u);
      vec3 col = mix(C(0x3a6a28), C(0x6c9a3a), tone);
      col = mix(col, C(0x9aae46), step(0.82, tone) * 0.6);
      col *= 0.82 + 0.3 * along;
      col *= 0.9 + 0.2 * sat(0.5 + l.x / len * 2.0 * side);
      col = mix(col, col * 1.35 + 0.03, rib * 0.55);
      col *= 0.92 + 0.08 * gnoise(uv * 90.0, vec2(90.0));
      put(acc, col, m);
    }
  }
  float tw = 1.0 - smoothstep(0.004, 0.009, length(uv - qbez(a, b, c, sat((uv.y) / 0.86))) - 0.002 * (1.0 - uv.y));
  tw *= step(uv.y, 0.86);
  put(acc, C(0x5a4630), tw);
  return surf(acc.rgb, 0.5, 0.7, acc.a);
}`,

  // ── FERN — one arching frond, pinnae with toothed pinnules ──
  fern: COMMON + /* glsl */ `
Surf card_fern(vec2 uv) {
  vec4 acc = vec4(C(0x4f8a34), 0.0);
  vec2 a = vec2(0.5, 0.0), b = vec2(0.46, 0.5), c = vec2(0.6, 0.98);
  const int N = 22;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    float t = 0.1 + fi / float(N) * 0.86;
    vec2 o = qbez(a, b, c, t);
    vec2 o2 = qbez(a, b, c, t + 0.01);
    vec2 dir = normalize(o2 - o);
    float rach = atan(-dir.x, dir.y);
    float lenBase = 0.36 * pow(sin(3.14159 * (0.12 + t * 0.85)), 0.7) * (1.0 - 0.35 * t);
    for (int s = 0; s < 2; s++) {
      float side = s == 0 ? -1.0 : 1.0;
      vec2 base = o + side * vec2(dir.y, -dir.x) * 0.004;
      float phi = rach + side * (1.05 - 0.25 * t);
      vec2 l = leafLocal(uv, base, phi);
      float len = lenBase * (0.92 + 0.12 * hash1(vec2(fi, float(s)), 4u));
      float x = l.y / len;
      if (x < 0.0 || x > 1.0) continue;
      // curve the pinna slightly upward
      float yy = l.x + side * 0.06 * x * x * len;
      float w = len * 0.13 * pow(1.0 - x, 0.8) * (0.75 + 0.25 * abs(sin(x * 3.14159 * 9.0)));
      float d = w - abs(yy);
      float m = smoothstep(-AA, AA, d);
      float shm = smoothstep(-AA * 3.0, AA * 3.0, w * 1.05 - abs(yy + 0.008));
      shade(acc, shm, 0.25);
      if (m > 0.0) {
        float rib = 1.0 - smoothstep(0.0, 0.004, abs(yy));
        vec3 col = mix(C(0x3d7a2c), C(0x79ab45), sat(0.25 + 0.65 * x + 0.2 * t));
        col *= 0.85 + 0.25 * sat(0.5 + yy / (w + 1e-4) * 0.5);
        col = mix(col, C(0x9cc25e), rib * 0.6);
        put(acc, col, m);
      }
    }
  }
  vec2 q = vec2(0.0);
  float best = 1e3;
  for (int i = 0; i <= 24; i++) {
    float t = float(i) / 24.0;
    best = min(best, length(uv - qbez(a, b, c, t)));
  }
  float rw = 0.006 * (1.0 - 0.7 * uv.y);
  put(acc, mix(C(0x55702e), C(0x7d9a46), uv.y), 1.0 - smoothstep(rw, rw + AA, best));
  return surf(acc.rgb, 0.5, 0.75, acc.a);
}`,

  // ── IVY — a meandering vine with glossy three/five-lobed leaves ──
  ivy: COMMON + /* glsl */ `
float ivyLeaf(vec2 l, float R, out float vein) {
  float r = length(l);
  float th = atan(l.x, l.y);
  float at = abs(th);
  float lobes = 0.5 + 0.5 * pow(0.5 + 0.5 * cos(th * 5.2), 1.6);
  float heart = 1.0 - 0.55 * smoothstep(1.5, 3.0, at);
  float rmax = R * (0.52 + 0.48 * lobes) * heart * (1.0 - 0.18 * smoothstep(0.0, 1.3, at));
  float v0 = abs(fract(th / 1.2 + 0.5) - 0.5) * r;
  vein = (1.0 - smoothstep(0.0, 0.006, v0)) * step(r, rmax * 0.85) * step(at, 1.9);
  return smoothstep(-AA, AA, rmax - r);
}
Surf card_ivy(vec2 uv) {
  vec4 acc = vec4(C(0x2f5a26), 0.0);
  vec2 a = vec2(0.5, 0.0), b = vec2(0.25, 0.55), c = vec2(0.62, 1.0);
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float t = 0.08 + fi * 0.11;
    vec2 o = qbez(a, b, c, t);
    float side = mod(fi, 2.0) < 1.0 ? -1.0 : 1.0;
    float rnd = hash1(vec2(fi, 1.0), 5u);
    vec2 tip = o + rot2(vec2(0.0, 0.07 + 0.04 * rnd), side * (0.9 + 0.4 * rnd));
    float R = 0.1 + 0.05 * hash1(vec2(fi, 2.0), 5u);
    float phi = side * (0.4 + 0.5 * rnd);
    // petiole
    float pd = segDist(uv, o, tip);
    put(acc, C(0x6a5a32), 1.0 - smoothstep(0.003, 0.006, pd));
    vec2 l = leafLocal(uv, tip, phi);
    float vein;
    float sh = ivyLeaf(leafLocal(uv + vec2(0.012, 0.015), tip, phi), R * 1.04, vein);
    shade(acc, sh, 0.4);
    float m = ivyLeaf(l, R, vein);
    if (m > 0.0) {
      float tone = hash1(vec2(fi, 9.0), 5u);
      vec3 col = mix(C(0x234a1e), C(0x41702e), tone);
      col *= 0.85 + 0.35 * sat(1.0 - length(l) / R);
      col = mix(col, C(0x9fb880), vein * 0.75);
      // glossy highlight band
      col += 0.06 * smoothstep(0.3, 0.0, abs(l.x / R + 0.25));
      put(acc, col, m);
    }
  }
  float best = 1e3;
  for (int i = 0; i <= 24; i++) best = min(best, length(uv - qbez(a, b, c, float(i) / 24.0)));
  put(acc, C(0x5c4a2c), 1.0 - smoothstep(0.005, 0.009, best));
  return surf(acc.rgb, 0.5, 0.45, acc.a);
}`,

  // ── GRASS — a tuft of tapered, curving blades ──
  grass: COMMON + /* glsl */ `
Surf card_grass(vec2 uv) {
  vec4 acc = vec4(C(0x6a9a3c), 0.0);
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    vec3 r = hash3(vec2(fi, 11.0));
    float x0 = 0.5 + (r.x - 0.5) * 0.35;
    float hgt = 0.55 + 0.45 * r.y;
    float lean = (r.z - 0.5) * 0.7;
    float t = uv.y / hgt;
    if (t < 0.0 || t > 1.0) continue;
    float cx = x0 + lean * t * t;
    float w = 0.03 * pow(1.0 - t, 0.7) * (0.7 + 0.5 * r.y) + 0.001;
    float d = w - abs(uv.x - cx);
    float sh = smoothstep(-AA * 2.0, AA * 2.0, w - abs(uv.x - cx - 0.012));
    shade(acc, sh * (1.0 - t), 0.25);
    float m = smoothstep(-AA * 0.6, AA * 0.6, d);
    if (m > 0.0) {
      vec3 col = mix(C(0x3f6e28), C(0x8db24c), sat(t * 1.1 + r.x * 0.2));
      col = mix(col, C(0xc4c46a), smoothstep(0.75, 1.0, t) * r.z * 0.8);
      float rib = 1.0 - smoothstep(0.0, 0.5, abs(uv.x - cx) / w);
      col *= 0.85 + 0.25 * rib;
      put(acc, col, m);
    }
  }
  return surf(acc.rgb, 0.5, 0.7, acc.a);
}`,

  // ── NEEDLE — a conifer sprig with side shoots ──
  needle: COMMON + /* glsl */ `
void sprig(inout vec4 acc, vec2 uv, vec2 a, vec2 b, float nlen, float seed) {
  vec2 ab = b - a;
  float L = length(ab);
  vec2 dir = ab / L;
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 p = uv - a;
  float s = dot(p, dir), q = dot(p, nrm);
  if (s < -0.02 || s > L + nlen) return;
  float spacing = 0.011;
  float k = floor(s / spacing);
  for (int j = -3; j <= 0; j++) {
    float kk = k + float(j);
    float s0 = kk * spacing;
    if (s0 < 0.0 || s0 > L) continue;
    float taper = 1.0 - 0.5 * smoothstep(L * 0.6, L, s0);
    for (int side = 0; side < 2; side++) {
      float sg = side == 0 ? -1.0 : 1.0;
      float rr = hash1(vec2(kk + seed * 31.0, float(side)), 13u);
      vec2 nd = normalize(dir * 0.75 + nrm * sg * (0.9 + 0.3 * rr));
      vec2 o = a + dir * s0;
      vec2 e = o + nd * nlen * taper * (0.85 + 0.3 * rr);
      float d = segDist(uv, o, e);
      float w = 0.0032 * (1.0 - 0.5 * sat(dot(uv - o, nd) / (nlen * taper)));
      float m = 1.0 - smoothstep(w, w + AA * 0.8, d);
      if (m > 0.0) {
        float along = sat(dot(uv - o, nd) / (nlen * taper));
        vec3 col = mix(C(0x1f4030), C(0x4a7a4c), along);
        col = mix(col, C(0x7aa060), smoothstep(0.8, 1.0, along) * 0.5);
        col *= 0.85 + 0.3 * rr;
        put(acc, col, m);
      }
    }
  }
  float td = segDist(uv, a, b);
  put(acc, C(0x6a5034), 1.0 - smoothstep(0.004, 0.007, td));
}
Surf card_needle(vec2 uv) {
  vec4 acc = vec4(C(0x2d5238), 0.0);
  sprig(acc, uv, vec2(0.5, 0.35), vec2(0.28, 0.82), 0.075, 1.0);
  sprig(acc, uv, vec2(0.5, 0.45), vec2(0.74, 0.86), 0.075, 2.0);
  sprig(acc, uv, vec2(0.5, 0.0), vec2(0.5, 0.97), 0.09, 3.0);
  return surf(acc.rgb, 0.5, 0.7, acc.a);
}`,

  // ── BLOSSOM — a cluster of five-petal flowers over a few leaves ──
  blossom: COMMON + /* glsl */ `
Surf card_blossom(vec2 uv) {
  vec4 acc = vec4(C(0xe7b8c4), 0.0);
  // leaves behind
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 o = vec2(0.5, 0.05) + vec2((fi - 2.0) * 0.07, fi * 0.05);
    float phi = (fi - 2.0) * 0.55;
    vec2 l = leafLocal(uv, o, phi);
    float len = 0.36;
    float x = l.y / len;
    float w = len * 0.3 * pow(max(x, 0.0), 0.6) * pow(max(1.0 - x, 0.0), 0.8) * 1.6;
    float m = smoothstep(-AA, AA, w - abs(l.x)) * step(0.0, x) * step(x, 1.0);
    if (m > 0.0) {
      vec3 col = mix(C(0x3d6e2c), C(0x6d9a3e), x);
      col = mix(col, col * 1.3, (1.0 - smoothstep(0.0, 0.006, abs(l.x))) * 0.6);
      put(acc, col, m);
    }
  }
  // flowers
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    vec3 r = hash3(vec2(fi, 21.0));
    vec2 c = vec2(0.5 + (r.x - 0.5) * 0.62, 0.42 + r.y * 0.48);
    float R = 0.085 + 0.04 * r.z;
    vec2 p = uv - c;
    float rr = length(p);
    float th = atan(p.y, p.x) + r.x * 6.28;
    float pet = abs(cos(th * 2.5));
    float notch = 1.0 - 0.12 * pow(abs(sin(th * 5.0)), 8.0) * step(0.6, pet);
    float rmax = R * (0.55 + 0.45 * pow(pet, 0.5)) * notch;
    float sh = smoothstep(-AA * 3.0, AA * 3.0, rmax * 1.05 - length(uv + vec2(0.01, 0.012) - c));
    shade(acc, sh, 0.3);
    float m = smoothstep(-AA, AA, rmax - rr);
    if (m > 0.0) {
      vec3 col = mix(C(0xfff4f2), C(0xeb9cb4), smoothstep(0.25, 1.0, rr / rmax) * (0.5 + 0.5 * r.z));
      col *= 0.88 + 0.12 * pet;
      float veinP = abs(sin(th * 15.0)) * smoothstep(0.2, 0.9, rr / rmax);
      col *= 1.0 - 0.06 * veinP;
      float centre = 1.0 - smoothstep(R * 0.14, R * 0.24, rr);
      col = mix(col, C(0xf2c94a), centre);
      // stamens
      float st = step(0.7, hash1(floor(p * 260.0), 3u)) * band(rr, R * 0.18, R * 0.34, 0.004);
      col = mix(col, C(0xc98a2a), st * 0.8);
      put(acc, col, m);
    }
  }
  return surf(acc.rgb, 0.5, 0.6, acc.a);
}`,
};
