// ─────────────────────────────────────────────────────────────────────────────
// Surface patterns — one tileable GLSL function per material kind.
//
//   Surf kind_x(vec2 uv)   uv ∈ [0,1)², returns { col, h, rough, ao }
//
// 'rgb' kinds return an sRGB albedo. 'colorize' kinds return CONTROL channels
// that the material turns into colour (so one bake serves every tint):
//   r → blend from colour A (0) to colour B (1)
//   g → value modulation around 0.5 (×2 in the material)
//   b → blend towards colour C (knots / pale flecks / rust / faded wear)
//
// Conventions: grain/fibres run along U for wood & timber; shingle/thatch rows
// are stacked along V (V up the roof); mushroom caps are U = around, V = 0 at
// the rim → 1 at the apex; stems U = around, V = up; gills U = around,
// V = 0 at the stem → 1 at the rim (the material converts disc UVs to polar).
// ─────────────────────────────────────────────────────────────────────────────

export const SURFACE_GLSL = {
  // ── BARK — deep, wandering vertical furrows between long fibrous ridges ──
  // The map is TALL (1:2, see KINDS.bark.aspect): u spans one tile, v two —
  // so frequencies along v are doubled to stay isotropic. No cell lattice:
  // every furrow is its own meandering line that deepens, thins out and
  // re-opens (ridges merge and split), ridges carry fine fibrous grooves and
  // only an occasional cross-break, and the material bends it all with a
  // slow world-space warp.
  bark: /* glsl */ `
Surf kind_bark(vec2 uv) {
  const float BN = 8.0;                         // furrows across one tile
  float Y = uv.y;                               // 0..1 over TWO tiles
  // slow lateral meander shared by the furrows and the fibres
  float mx = 0.04 * fbm(vec2(uv.x * 2.0, Y * 3.0), vec2(2.0, 3.0), 3);
  float c = (uv.x + mx) * BN;
  float ci = floor(c);
  float xl = -9.0, xr = 9.0, kl = 0.0, el = 1.0, er = 1.0;
  for (int j = -2; j <= 2; j++) {
    float k = ci + float(j);
    float kw = mod(k, BN);
    vec3 hk = hash3(vec2(kw, 7.0));
    // each furrow wanders on its own, slowly, with a little crook
    float wan = 0.3 * gnoise(vec2(Y * 4.0, kw * 1.37 + 0.5), vec2(4.0, 1000.0))
              + 0.1 * gnoise(vec2(Y * 14.0, kw * 2.11 + 3.0), vec2(14.0, 1000.0));
    float x = k + 0.5 + (hk.x - 0.5) * 0.4 + wan;
    // depth along the furrow: it thins out & re-opens, so ridges merge and split
    float open = gnoise(vec2(Y * 5.0, kw * 3.3 + 9.0), vec2(5.0, 1000.0)) + 0.3 * (hk.y - 0.5) + 0.3;
    float str = smoothstep(-0.3, 0.2, open) * (0.65 + 0.35 * hk.z);
    float e = max(str, 0.025);
    if (x <= c) { if (x > xl) { xl = x; kl = kw; el = e; } }
    else if (x < xr) { xr = x; er = e; }
  }
  // distance to the furrows, widened where a furrow is shallow
  float d = min((c - xl) / el, (xr - c) / er);
  float t = sat((c - xl) / max(xr - xl, 0.05));  // 0..1 across the ridge
  vec3 hp = hash3(vec2(kl, 19.0));               // ridge personality
  float plateIn = smoothstep(0.1, 0.35, d);
  // rare cross-breaks: staggered per ridge, slanted, only part-way across
  float cy = Y * 4.0 + hp.x * 4.0 + (t - 0.5) * (hp.y - 0.5) * 1.2
           + 0.08 * gnoise(vec2(c * 2.0, Y * 16.0), vec2(BN * 2.0, 16.0));
  float row = floor(cy), fr = fract(cy);
  vec3 hr = hash3(vec2(kl, mod(row, 4.0) + 40.0));
  float present = step(0.5, hr.x) * (1.0 - smoothstep(0.0, 0.15, abs(t - hr.y) - 0.3));
  float cd = min(fr, 1.0 - fr) * 4.0;            // in ~physical units (ridge widths)
  float crack = present * (1.0 - smoothstep(0.03, 0.11, cd)) * plateIn;
  float bev = mix(1.0, 0.75 + 0.25 * smoothstep(0.0, 0.5, cd), present);
  // relief: broad dark V furrows, rounded ridges with fibrous grooves
  float prof = smoothstep(0.0, 0.62, d);
  prof = prof * (2.0 - prof);                    // rounded shoulders
  float crev = 1.0 - smoothstep(0.0, 0.24, d);
  float xf = uv.x + mx;
  float groove = 1.0 - abs(gnoise(vec2(xf * 70.0, Y * 7.0), vec2(70.0, 7.0)));     // long fibre ridges
  groove = groove * groove;
  float fib = gnoise(vec2(xf * 170.0, Y * 12.0), vec2(170.0, 12.0));
  float fib2 = gnoise(vec2(xf * 40.0, Y * 5.0), vec2(40.0, 5.0));
  float flake = fbm(vec2(xf * 18.0, Y * 24.0), vec2(18.0, 24.0), 3);
  float bulge = fbm(vec2(uv.x * 3.0, Y * 6.0), vec2(3.0, 6.0), 3);
  float h = 0.06 + prof * (0.55 * bev + 0.1 * groove + 0.05 * fib2 + 0.05 * flake + 0.05 * hp.z + 0.06 * (hr.z - 0.5) * mix(smoothstep(0.0, 0.6, cd), 1.0, present))
          + 0.025 * fib + 0.07 * bulge;
  h -= 0.12 * crack;
  h = sat(h);
  // colour: near-black furrows, warm umber flanks, grey-brown weathered ridges
  vec3 furrow = C(0x1b130d), flank = C(0x5a4635), plateC = C(0x826e5c), crest = C(0xa08e78), bleach = C(0xbcae98);
  vec3 col = mix(furrow, flank, smoothstep(0.05, 0.34, h));
  col = mix(col, plateC, smoothstep(0.34, 0.56, h));
  col = mix(col, crest, smoothstep(0.52, 0.7, h) * sat(0.45 + groove * 0.6 + 0.4 * fib2));
  col = mix(col, bleach, smoothstep(0.68, 0.84, h) * sat(0.25 + fib2 + 0.6 * flake));
  col *= 0.84 + 0.26 * hp.z;
  col = temp(col, (hp.x - 0.5) * 1.1);
  col *= 0.86 + 0.1 * fib + 0.1 * groove;
  col *= mix(1.0, 0.62, crack);
  // green algae down in the furrows (patchy), damp moss-brown on the flanks
  float alg = sat(fbm(vec2(uv.x * 4.0, Y * 8.0) + vec2(3.0), vec2(4.0, 8.0), 3) * 0.9 + 0.35);
  col = mix(col, C(0x33421d), crev * alg * 0.55);
  col = mix(col, col * vec3(0.88, 0.96, 0.72), (1.0 - prof) * alg * 0.35);
  // lichen crusts on the ridges: soft sage patches, a few small pale rosettes
  float lich = fbm(vec2(uv.x * 3.0, Y * 6.0) + vec2(11.0), vec2(3.0, 6.0), 4) + 0.25 * gnoise(vec2(uv.x * 40.0, Y * 80.0), vec2(40.0, 80.0));
  float lm = smoothstep(0.28, 0.44, lich) * smoothstep(0.45, 0.68, h);
  vec2 lc, ltc;
  vec4 lv = voronoi(vec2(uv.x * 22.0, Y * 44.0), vec2(22.0, 44.0), 1.0, lc, ltc);
  float ros = step(0.95, lv.z) * (1.0 - smoothstep(0.12, 0.26, lv.x)) * plateIn * smoothstep(0.2, 0.4, lich);
  col = mix(col, mix(C(0x96a386), C(0xb5bc98), sat(fib2 + 0.5)), lm * 0.72);
  col = mix(col, mix(C(0xbcb172), C(0xd2cdaa), lv.w), ros * 0.6);
  h += (lm + ros) * 0.015;
  // keep the map's mean at KINDS.bark.mean (#6a5845 — builders vertex-colour bark against it)
  col *= vec3(0.93, 0.9, 0.86);
  float rough = 0.94 - 0.05 * lm;
  float ao = mix(0.2, 1.0, smoothstep(0.03, 0.46, h));
  return surf(col, h, rough, ao);
}`,

  // ── MOSS — velvety cushions, fibre fuzz, yellow-green sunlit tips ──
  moss: /* glsl */ `
Surf kind_moss(vec2 uv) {
  vec2 w = vec2(fbmu(uv, 4.0, 3), fbmu(uv + vec2(0.37, 0.11), 4.0, 3));
  vec2 q = uv + w * 0.03;
  vec2 cell, tc;
  vec4 v1 = voronoi(q * 7.0, vec2(7.0), 1.0, cell, tc);
  vec4 v2 = voronoi(q * 19.0 + vec2(3.0), vec2(19.0), 1.0);
  float dome1 = 1.0 - smoothstep(0.05, 0.85, v1.x);
  float dome2 = 1.0 - smoothstep(0.0, 0.75, v2.x);
  float crease = smoothstep(0.0, 0.16, v1.y);
  float fz = gnoise(q * 150.0, vec2(150.0));
  float fz2 = gnoise(q * 64.0 + vec2(5.0), vec2(64.0));
  // star-shaped shoots: tiny radial streaks
  float h = (0.42 * dome1 + 0.3 * dome2) * (0.55 + 0.45 * crease) + 0.13 * fz2 + 0.09 * fz + 0.12;
  vec3 deep = C(0x1c2c13), dark = C(0x35501f), mid = C(0x587829), lite = C(0x809a36), tip = C(0xb2b95a);
  vec3 col = mix(deep, dark, smoothstep(0.1, 0.32, h));
  col = mix(col, mid, smoothstep(0.32, 0.5, h));
  col = mix(col, lite, smoothstep(0.5, 0.68, h));
  col = mix(col, tip, smoothstep(0.66, 0.85, h) * (0.5 + 0.5 * fz));
  // cushion personalities: some yellower, some blue-green, a few rusty-brown
  float pc = v1.z;
  col = mix(col, col * vec3(1.12, 1.06, 0.72), smoothstep(0.55, 0.8, pc) * 0.8);
  col = mix(col, col * vec3(0.82, 0.98, 1.05), smoothstep(0.25, 0.0, pc) * 0.7);
  col = mix(col, C(0x6f5a2a) * (0.7 + 0.5 * h), step(0.93, v1.w) * 0.55);
  // sporophytes: little red-brown capsules on a few tufts
  float spo = step(0.86, v2.z) * (1.0 - smoothstep(0.06, 0.12, v2.x));
  col = mix(col, C(0x9a4a22), spo * 0.8);
  h += spo * 0.1;
  float ao = mix(0.3, 1.0, smoothstep(0.08, 0.6, h));
  return surf(col, h, 0.96, ao);
}`,

  // ── SOIL — humus with crumbs, pebbles, twigs and fallen leaves ──
  soil: /* glsl */ `
float leafShape(vec2 p, float len, float wid, out float vein) {
  float x = p.x / len;
  float prof = wid * (1.0 - x * x) * (1.0 + 0.25 * x);
  float d = prof - abs(p.y);
  vein = (1.0 - smoothstep(0.0, wid * 0.1, abs(p.y))) * step(abs(x), 0.95);
  return step(abs(x), 1.0) * smoothstep(0.0, 0.012, d);
}
Surf kind_soil(vec2 uv) {
  float n1 = fbmu(uv, 5.0, 5);
  float n2 = fbmu(uv + vec2(0.5), 16.0, 3);
  vec3 col = mix(C(0x2c2016), C(0x5a4330), sat(n1 * 0.7 + 0.5));
  col = mix(col, C(0x6a5440), sat(n2 - 0.15) * 0.6);
  float h = 0.3 + 0.12 * n1 + 0.05 * n2;
  // crumbly humus: clumps & dark pores
  float cr = fbm(uv * 60.0, vec2(60.0), 3);
  col *= 0.8 + 0.35 * sat(cr + 0.5);
  h += 0.06 * cr;
  float pore = smoothstep(0.35, 0.6, -gnoise(uv * 110.0, vec2(110.0)));
  col *= 1.0 - 0.35 * pore;
  h -= 0.04 * pore;
  // a few small half-buried pebbles
  vec2 pc, ptc;
  vec4 pv = voronoi(uv * 12.0, vec2(12.0), 0.8, pc, ptc);
  float pr = 0.12 + 0.12 * pv.w;
  float pd = length(rot2(ptc, pv.z * 6.28) * vec2(1.0, 1.4));
  float peb = step(0.78, pv.z) * (1.0 - smoothstep(pr - 0.04, pr, pd));
  vec3 pcol = mix(C(0x6e675c), C(0x8a7f6c), pv.w) * (0.8 + 0.25 * gnoise(uv * 90.0, vec2(90.0)));
  pcol *= 0.75 + 0.35 * sat(1.0 - pd / pr);
  col = mix(col, pcol, peb * 0.9);
  h = mix(h, 0.5 + 0.25 * sat(1.0 - pd / pr), peb);
  // fallen leaves: small, many, decayed — some half buried under humus
  float best = -1.0;
  vec3 lcol = vec3(0.0);
  float lh = 0.0, lcov = 0.0;
  for (int L = 0; L < 2; L++) {
    float sc = L == 0 ? 9.0 : 14.0;
    vec2 p = uv * sc + float(L) * vec2(3.0, 5.0);
    vec2 n = floor(p), f = fract(p);
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 cid = wrapc(n + g, vec2(sc));
      vec3 hh = hash3(cid + float(L) * 17.0);
      if (hh.z < 0.3) continue;
      vec2 o = 0.5 + (hash2(cid + float(L) * 29.0) - 0.5) * 0.8;
      vec2 lp = rot2(f - g - o, hh.x * 6.2831);
      float len = 0.36 + 0.22 * hh.y;
      float vein;
      float ins = leafShape(lp, len, len * 0.42, vein);
      float pri = hh.z + float(L);
      if (ins > 0.5 && pri > best) {
        best = pri;
        float pick = fract(hh.x * 7.3 + hh.y * 3.1);
        vec3 c = pick < 0.25 ? C(0x6e4524) : pick < 0.45 ? C(0x8a5428) : pick < 0.6 ? C(0xa0763a) : pick < 0.78 ? C(0x5a4030) : pick < 0.92 ? C(0x7a6234) : C(0x94402a);
        float decay = sat(gnoise(uv * 40.0 + float(L) * 3.0, vec2(40.0)) * 0.9 + 0.3);
        c = mix(c, C(0x3a2a1c), decay * 0.5);
        c = mix(c, c * 1.2, vein * 0.4);
        lcol = c * (0.85 + 0.2 * sat(1.0 - abs(lp.y) / (len * 0.4)));
        lh = 0.55 + 0.07 * sat(1.0 - abs(lp.y) / (len * 0.42)) - vein * 0.04 + float(L) * 0.05;
        lcov = 1.0 - 0.6 * smoothstep(0.55, 0.75, cr + 0.4 * hh.y);
      }
    }
  }
  if (best > -0.5) { col = mix(col, lcol, 0.92 * lcov); h = mix(h, max(h, lh), lcov); }
  // twigs
  vec2 tcell, ttc;
  vec4 tv = voronoi(uv * 6.0 + vec2(1.0, 2.0), vec2(6.0), 0.8, tcell, ttc);
  vec2 tp = rot2(ttc, hash1(tcell, 88u) * 6.2831);
  float tw = step(0.72, tv.w) * (1.0 - smoothstep(0.015, 0.028, abs(tp.y + 0.02 * sin(tp.x * 12.0)))) * step(abs(tp.x), 0.45);
  col = mix(col, C(0x3e2c1e) * (0.8 + 0.5 * sat(tp.y / 0.025 + 0.5)), tw);
  h = mix(h, 0.7, tw);
  float ao = mix(0.35, 1.0, smoothstep(0.15, 0.6, h));
  return surf(col, h, 0.95 - 0.1 * peb, ao);
}`,

  // ── STONE — rough fieldstone: varied stones, dark recessed earthy joints ──
  stone: /* glsl */ `
Surf kind_stone(vec2 uv) {
  vec2 w = vec2(fbmu(uv, 3.0, 4), fbmu(uv + vec2(0.31, 0.77), 3.0, 4));
  vec2 q = uv + w * 0.04;
  vec2 cell, tc;
  vec4 v = voronoi(q * vec2(4.0, 6.0), vec2(4.0, 6.0), 1.0, cell, tc);
  vec3 hs = hash3(cell + 17.0);
  // every stone sits differently: varying joint width, a tilt, its own colour
  float inset = 0.03 + 0.09 * hs.x * hs.x;
  float grain = fbm(q * 40.0, vec2(40.0), 3);
  // chipped, irregular stone outlines
  float edgeN = 0.03 * gnoise(q * 26.0, vec2(26.0)) + 0.012 * gnoise(q * 90.0, vec2(90.0));
  float e = v.y + edgeN;
  float stoneM = smoothstep(inset, inset + 0.02, e);
  float bevel = smoothstep(inset, inset + 0.4, e);
  vec2 tilt = (hash2(cell, 91u) - 0.5) * 0.8;
  float bump = fbm(q * 14.0 + hs.y * 9.0, vec2(14.0), 5);
  float pits = smoothstep(0.3, 0.75, fbm(q * 52.0 + hs.z * 3.0, vec2(52.0), 2));
  float fine = gnoise(q * 150.0, vec2(150.0));
  float hStone = 0.44 + 0.3 * sqrt(bevel) + 0.11 * bump + dot(-tc, tilt) * 0.28 + 0.08 * hs.z - 0.05 * pits + 0.015 * fine;
  // little filler stones wedged into the wide joints
  vec2 fc, ftc;
  vec4 fv = voronoi(q * vec2(15.0, 22.0), vec2(15.0, 22.0), 1.0, fc, ftc);
  float fill = (1.0 - stoneM) * step(0.4, fv.z) * smoothstep(0.08, 0.16, fv.y) * smoothstep(0.03, 0.065, v.y);
  float hFill = 0.26 + 0.12 * sqrt(smoothstep(0.08, 0.35, fv.y));
  float hMortar = 0.06 + 0.06 * grain;
  float h = mix(mix(hMortar, hFill, fill), hStone, stoneM);
  // stone colours: blue-grey, warm sandstone, pale limestone, dark basalt, rusty
  float pick = hs.y;
  vec3 sc = pick < 0.16 ? C(0x9a958c) : pick < 0.3 ? C(0xae9b7c) : pick < 0.44 ? C(0x7b8286)
          : pick < 0.58 ? C(0xa8a296) : pick < 0.7 ? C(0x69635a) : pick < 0.82 ? C(0xa38a68)
          : pick < 0.92 ? C(0x8a887e) : C(0xbfb8a8);
  sc *= (0.78 + 0.38 * sat(bump * 0.8 + 0.5)) * 1.07;
  sc *= 1.0 + 0.1 * fine;
  // mineral grains: dark & pale specks
  vec4 gv = voronoi(q * 70.0, vec2(70.0), 1.0);
  float dot1 = 1.0 - smoothstep(0.1, 0.24, gv.x);
  sc = mix(sc, sc * 0.58, step(0.8, gv.z) * dot1 * 0.75);
  sc = mix(sc, sc * 1.22 + 0.03, step(0.9, gv.w) * dot1 * 0.6);
  sc *= 1.0 - 0.22 * pits;
  sc = mix(sc, sc * 1.17, sat(dot(-tc, tilt) * 2.0 + 0.3) * bevel);   // facets turned to the light
  sc = mix(sc, sc * 0.68, (1.0 - bevel) * 0.6);                        // grimy, worn edges
  // lichen rosettes & dark water streaks
  vec4 lv = voronoi(q * 24.0, vec2(24.0), 1.0);
  float lic = step(0.88, lv.z) * (1.0 - smoothstep(0.12, 0.3, lv.x)) * stoneM;
  sc = mix(sc, lv.w > 0.5 ? C(0xd6d2ba) : C(0xc4b25e), lic * 0.75);
  float streak = sat(gnoise(vec2(q.x * 30.0, q.y * 3.0), vec2(30.0, 3.0)) * 1.4 - 0.5);
  sc *= 1.0 - 0.2 * streak;
  vec3 fcol = mix(C(0x77716a), C(0x958c7e), fv.w) * (0.75 + 0.3 * fv.z);
  // joints: dark earthy lime, soil & moss creeping in, deepest right under the stones
  float jn = sat(fbm(q * 9.0 + vec2(4.0), vec2(9.0), 3) * 1.4 + 0.15);
  vec3 mortar = mix(C(0x675e50), C(0x8c8270), sat(0.5 + 0.6 * grain));
  mortar = mix(mortar, C(0x4c5626), jn * 0.5);
  mortar *= mix(1.0, 0.5, smoothstep(0.35, 1.0, e / inset));
  vec3 col = mix(mix(mortar, fcol, fill), sc, stoneM);
  float rough = mix(0.97, 0.86 - 0.08 * bevel, stoneM);
  float ao = mix(0.45, 1.0, smoothstep(0.08, 0.5, h));
  return surf(col, h, rough, ao);
}`,

  // ── COBBLE — rounded packed cobbles, soil & moss in the joints ──
  cobble: /* glsl */ `
Surf kind_cobble(vec2 uv) {
  vec2 w = vec2(fbmu(uv, 3.0, 3), fbmu(uv + vec2(0.5, 0.2), 3.0, 3));
  vec2 q = uv + w * 0.03;
  vec2 cell, tc;
  vec4 v = voronoi(q * 7.0, vec2(7.0), 1.0, cell, tc);
  vec3 hs = hash3(cell + 9.0);
  float gap = 0.035 + 0.16 * hs.x * hs.x * hs.x;
  float edgeN = 0.03 * gnoise(q * 40.0, vec2(40.0));
  float stoneM = smoothstep(gap, gap + 0.035, v.y + edgeN);
  float dome = sqrt(smoothstep(gap, gap + 0.4, v.y + edgeN));
  vec2 tilt = (hash2(cell, 37u) - 0.5) * 0.5;
  float bump = fbm(q * 22.0 + hs.y * 5.0, vec2(22.0), 4);
  float fine = gnoise(q * 160.0, vec2(160.0));
  float h = mix(0.2 + 0.05 * fbm(q * 30.0, vec2(30.0), 2), 0.38 + 0.42 * dome + 0.06 * bump + dot(-tc, tilt) * 0.2 + 0.012 * fine, stoneM);
  float pick = hs.y;
  vec3 sc = pick < 0.22 ? C(0xa19b90) : pick < 0.4 ? C(0x8a8a87) : pick < 0.56 ? C(0xad9e84)
          : pick < 0.7 ? C(0x7a7368) : pick < 0.84 ? C(0xb6ad9b) : pick < 0.93 ? C(0x9c8c76) : C(0x6e7377);
  sc *= 0.8 + 0.3 * sat(bump * 0.8 + 0.5);
  sc *= 0.8 + 0.28 * dome;
  sc *= 1.0 + 0.1 * fine;
  vec4 gv = voronoi(q * 90.0, vec2(90.0), 1.0);
  sc = mix(sc, sc * 0.62, step(0.82, gv.z) * (1.0 - smoothstep(0.1, 0.24, gv.x)) * 0.6);   // dark grains
  sc = mix(sc, sc * 1.14, smoothstep(0.55, 1.0, dome));                                   // polished crowns
  // joints: packed earth, grit and moss — lighter, so close-ups stay readable
  float jn = fbm(q * 14.0, vec2(14.0), 3);
  vec3 joint = mix(C(0x8b7659), C(0x7f8d47), sat(jn * 1.2 + 0.35));
  joint *= 0.88 + 0.26 * sat(gnoise(q * 120.0, vec2(120.0)) + 0.5);
  vec3 col = mix(joint, sc, stoneM);
  float rough = mix(0.98, 0.86 - 0.22 * dome, stoneM);
  float ao = mix(0.8, 1.0, smoothstep(0.14, 0.5, h));
  return surf(col, h, rough, ao);
}`,

  // ── ROCK — layered sedimentary boulders with joints & lichen ──
  rock: /* glsl */ `
Surf kind_rock(vec2 uv) {
  vec2 w = vec2(fbmu(uv, 3.0, 4), fbmu(uv + vec2(0.5, 0.2), 3.0, 4));
  vec2 q = uv + w * 0.05;
  // strata: soft horizontal ledges
  float s = q.y * 3.0 + fbmu(q, vec2(2.0, 3.0), 4) * 0.45;
  float fs = fract(s);
  float ledge = smoothstep(0.0, 0.07, fs) * (1.0 - 0.32 * fs);
  // fractured blocks: each a tilted, slightly domed facet
  vec2 cell, tc;
  vec4 v = voronoi(vec2(q.x * 4.0, s), vec2(4.0, 3.0), 0.95, cell, tc);
  vec2 tilt = (hash2(cell, 91u) - 0.5) * 1.3;
  float facet = dot(-tc, tilt) * 0.45 + 0.25 * sqrt(smoothstep(0.0, 0.4, v.y));
  float crack = 1.0 - smoothstep(0.0, 0.045, v.y + 0.02 * gnoise(q * 40.0, vec2(40.0)));
  // second, finer fracture net
  vec4 v2 = voronoi(q * 11.0 + vec2(3.0), vec2(11.0), 1.0);
  float crack2 = (1.0 - smoothstep(0.0, 0.03, v2.y)) * step(0.4, v2.z);
  float grainy = fbm(q * 18.0, vec2(18.0), 5);
  float pits = smoothstep(0.45, 0.8, fbm(q * 40.0, vec2(40.0), 3)) * 0.6;
  float h = 0.42 + 0.3 * ledge + facet + 0.07 * grainy - 0.06 * pits;
  h = mix(h, 0.12, crack) - 0.12 * crack2;
  h = sat(h);
  vec3 hs = hash3(cell + 5.0);
  vec3 base = mix(C(0x8b9096), C(0xa49784), hs.x);
  base = mix(base, C(0x9c9a8e), hs.y * 0.5);
  vec3 col = base * (0.8 + 0.22 * grainy + 0.25 * facet);
  col = mix(col, C(0xc4bfb0), smoothstep(0.62, 0.9, h) * 0.45);
  col = mix(col, C(0x37383a), crack * 0.85 + crack2 * 0.5);
  col *= 1.0 - 0.18 * pits;
  // mineral grains: dark & pale specks, so close-ups read as real, rough stone
  vec4 gv = voronoi(q * 64.0, vec2(64.0), 1.0);
  float gdot = (1.0 - smoothstep(0.1, 0.24, gv.x)) * (1.0 - crack);
  col = mix(col, col * 0.6, step(0.8, gv.z) * gdot * 0.7);
  col = mix(col, col * 1.2 + 0.025, step(0.9, gv.w) * gdot * 0.55);
  col *= 1.0 + 0.08 * gnoise(q * 150.0, vec2(150.0));
  float streak = sat(gnoise(vec2(q.x * 24.0, q.y * 2.0), vec2(24.0, 2.0)) * 1.3 - 0.45);
  col = mix(col, col * vec3(0.72, 0.74, 0.7), streak * 0.6);
  float lich = fbm(q * 6.0 + vec2(9.0), vec2(6.0), 4) + 0.35 * gnoise(q * 50.0, vec2(50.0));
  float lm = smoothstep(0.3, 0.44, lich) * smoothstep(0.4, 0.6, h);
  col = mix(col, mix(C(0xa9b08c), C(0xd5cb8e), sat(grainy + 0.5)), lm * 0.7);
  float rough = 0.9 - 0.06 * lm;
  float ao = mix(0.3, 1.0, smoothstep(0.08, 0.5, h));
  return surf(col, h, rough, ao);
}`,

  // ── PLASTER — mottled lime plaster, trowel marks, hairline cracks, stones peeking through ──
  plaster: /* glsl */ `
Surf kind_plaster(vec2 uv) {
  float m1 = fbmu(uv, 3.0, 5);
  float m2 = fbmu(uv + vec2(0.31), 8.0, 4);
  vec3 col = C(0xefe3c8);
  col = mix(col, C(0xe0cba2), sat(m1 * 0.9 + 0.15));
  col = mix(col, C(0xf6f1e2), sat(-m2 * 1.1));
  col = mix(col, C(0xc9c0a6), sat(m1 - 0.4) * 0.9);
  vec2 w = vec2(fbmu(uv, 4.0, 2), fbmu(uv + vec2(0.5), 4.0, 2)) * 0.05;
  vec4 tv = voronoi((uv + w) * 4.0, vec2(4.0), 1.0);
  float trowel = smoothstep(0.0, 0.07, tv.y);
  float sweep = gnoise(rot2(uv * 4.0 - floor(uv * 4.0), tv.z * 6.28) * vec2(3.0, 30.0), vec2(1000.0));
  float h = 0.62 + 0.05 * m1 + 0.035 * (1.0 - trowel) + 0.012 * sweep + 0.01 * gnoise(uv * 160.0, vec2(160.0));
  col *= 1.0 - 0.03 * (1.0 - trowel);
  // hairline cracks where the plaster is stressed
  vec4 cv = voronoi((uv + w * 0.6) * 5.0 + vec2(2.0), vec2(5.0), 1.0);
  float crackMask = smoothstep(0.15, 0.4, fbmu(uv + vec2(0.7), 4.0, 3));
  float crack = (1.0 - smoothstep(0.0, 0.016, cv.y + 0.01 * gnoise(uv * 80.0, vec2(80.0)))) * crackMask;
  col = mix(col, C(0x8a7a62), crack * 0.75);
  h -= crack * 0.12;
  // fallen-off patches revealing the stones underneath
  float holeN = fbmu(uv + vec2(0.13, 0.4), 3.0, 5);
  float hole = smoothstep(0.4, 0.42, holeN);
  float rim = smoothstep(0.33, 0.4, holeN) * (1.0 - hole);
  vec2 bcell, btc;
  vec4 bv = voronoi(uv * vec2(7.0, 11.0), vec2(7.0, 11.0), 0.8, bcell, btc);
  float brick = smoothstep(0.06, 0.1, bv.y);
  vec3 bcol = (bv.z < 0.35 ? C(0xa0684a) : bv.z < 0.7 ? C(0xa49a88) : C(0x8e8a80)) * (0.8 + 0.3 * sat(fbmu(uv, 30.0, 2) + 0.5));
  bcol *= 0.8 + 0.3 * sqrt(smoothstep(0.06, 0.3, bv.y));
  vec3 under = mix(C(0x8a7e6a), bcol, brick);
  col = mix(col, col * 0.8, rim * 0.5);
  col = mix(col, under, hole);
  h = mix(h + 0.025 * rim, 0.25 + 0.2 * brick * sqrt(smoothstep(0.06, 0.3, bv.y)), hole);
  float ao = mix(0.45, 1.0, smoothstep(0.2, 0.6, h));
  return surf(col, h, 0.96 - 0.1 * hole, ao);
}`,

  // ── TIMBER — weathered structural beams: silvered, checked, stained ──
  timber: /* glsl */ `
Surf kind_timber(vec2 uv) {
  vec2 q = uv + vec2(0.0, 0.025 * fbmu(uv, vec2(2.0, 4.0), 3));
  float streak = gnoise(vec2(q.x * 3.0, q.y * 50.0), vec2(3.0, 50.0));
  float streak2 = gnoise(vec2(q.x * 8.0, q.y * 150.0), vec2(8.0, 150.0));
  float rings = sin((q.y * 14.0 + 1.6 * fbmu(q, vec2(2.0, 3.0), 3)) * 6.2831853);
  float silver = sat(fbmu(uv + vec2(0.2), vec2(3.0, 5.0), 4) * 1.4 + 0.15);
  vec3 col = mix(C(0x6e5440), C(0x8a6c50), sat(rings * 0.35 + 0.5 + streak * 0.35));
  col = mix(col, mix(C(0x8e877c), C(0xa49b8c), sat(streak2 + 0.5)), silver * 0.75);
  col *= 0.9 + 0.12 * streak2;
  // long checks (drying cracks) along the grain
  float r = q.y * 4.0 + 0.15 * gnoise(vec2(q.x * 3.0, q.y * 4.0), vec2(3.0, 4.0));
  float ri = floor(r);
  float off = hash1(vec2(mod(ri, 4.0), 3.0), 9u) - 0.5;
  float dline = abs(fract(r) - 0.5 - off * 0.5);
  float presence = smoothstep(0.05, 0.35, gnoise(vec2(q.x * 3.0, mod(ri, 4.0) * 2.3), vec2(3.0, 1000.0)));
  float width = 0.02 * presence;
  float check = (1.0 - smoothstep(width * 0.3, width, dline)) * step(0.001, presence);
  col = mix(col, C(0x1f1610), check);
  // dark weather stains & nail-hole rust bleed
  float stain = sat(fbmu(uv + vec2(0.8), vec2(6.0, 2.0), 3) * 1.6 - 0.6);
  col = mix(col, C(0x3e2f22), stain * 0.5);
  float h = 0.62 + 0.05 * streak + 0.03 * streak2 + 0.03 * rings - 0.55 * check;
  float ao = mix(0.25, 1.0, 1.0 - check);
  return surf(col, h, 0.88 + 0.06 * silver, ao);
}`,

  // ── WOOD (colorize) — flat-sawn grain along U, optional planks ──
  wood: /* glsl */ `
Surf kind_wood(vec2 uv) {
  vec2 q = uv;
  float seam = 1.0, tone = 0.0, pid = 0.0;
#ifdef WOOD_PLANKS
  const float ROWS = 4.0;
  float rr = uv.y * ROWS;
  pid = floor(rr);
  float fr = fract(rr);
  float off = hash1(vec2(mod(pid, ROWS), 0.0), 61u);
  float uu = fract(uv.x + off);
  float jd = min(uu, 1.0 - uu);
  seam = smoothstep(0.0, 0.022, fr) * smoothstep(0.0, 0.022, 1.0 - fr) * smoothstep(0.0, 0.005, jd);
  tone = hash1(vec2(mod(pid, ROWS), 1.0), 62u) - 0.5;
  q = vec2(uu, fr / ROWS + mod(pid, ROWS) * 0.37);
#endif
#ifdef WOOD_PLANKS
  const float PY = 1000.0;
#else
  const float PY = 1.0;
#endif
  // growth rings of flat-sawn boards: long, dense, gently flowing lines with
  // the occasional cathedral arch
  float warp = gnoise(vec2(q.x * 1.0, q.y * 2.0), vec2(1.0, 2.0 * PY));
  float cath = gnoise(vec2(q.x * 1.0, q.y * 1.0 + pid * 3.1), vec2(1.0, PY));
  float d = q.y * 15.0 + warp * 1.1 + cath * 2.6;
  vec2 kc, ktc;
  vec4 kv = voronoi(uv * vec2(2.0, 3.0), vec2(2.0, 3.0), 0.8, kc, ktc);
  float hasKnot = step(0.84, kv.z);
  vec2 kp = ktc * vec2(2.6, 1.0);
  float kd = length(kp);
  d += hasKnot * 2.0 * exp(-kd * kd * 30.0);
  float ring = fract(d);
  float ringI = hash1(vec2(mod(floor(d), 64.0), 7.0), 63u);
  float late = smoothstep(0.3, 0.85, ring) * (1.0 - smoothstep(0.9, 1.0, ring)) * (0.5 + 0.5 * ringI);
  late = late * late * (3.0 - 2.0 * late);
  float pores = smoothstep(0.5, 0.9, gnoise(vec2(q.x * 36.0, q.y * 420.0), vec2(36.0, 420.0 * PY))) * (1.0 - late);
  float fibre = gnoise(vec2(q.x * 5.0, q.y * 170.0), vec2(5.0, 170.0 * PY));
  float fibre2 = gnoise(vec2(q.x * 2.0, q.y * 60.0), vec2(2.0, 60.0 * PY));
  float knot = hasKnot * (1.0 - smoothstep(0.035, 0.06, kd));
  float knotRim = hasKnot * (1.0 - smoothstep(0.06, 0.16, kd)) * (1.0 - knot);
  float figure = fbm(vec2(q.x * 3.0, q.y * 5.0), vec2(3.0, 5.0 * PY), 3);
  float R = sat(late * 0.72 + 0.22 * pores + 0.12 * fibre2 + 0.08 * figure + 0.35 * knotRim);
  float streaks = gnoise(vec2(q.x * 3.0, q.y * 260.0), vec2(3.0, 260.0 * PY));
  float G = 0.5 + 0.035 * fibre + 0.04 * fibre2 + 0.05 * streaks + 0.1 * tone + 0.03 * figure;
  float B = sat(knot * 0.9 + 0.25 * knotRim);
  R = mix(1.0, R, seam);
  G = mix(0.24, G, seam);
  float h = 0.6 - 0.035 * late + 0.015 * fibre - 0.025 * pores + 0.02 * knot;
  h = mix(0.15, h, seam);
  float ao = mix(0.3, 1.0, seam);
  return surf(vec3(R, G, B), h, 0.6 + 0.1 * late + 0.1 * pores, ao);
}`,

  // ── SHINGLES — staggered rows of split wooden shakes ──
  shingles: /* glsl */ `
float shJ(float i, float row) { return (hash1(vec2(mod(i, 9.0), mod(row, 7.0)), 71u) - 0.5) * 0.5; }
Surf kind_shingles(vec2 uv) {
  const float ROWS = 7.0, COLS = 9.0;
  float r = uv.y * ROWS;
  float row = floor(r), fv = fract(r);
  float x = uv.x * COLS + hash1(vec2(mod(row, ROWS), 5.0), 72u) * COLS;
  float xi = floor(x);
  float b0 = xi + shJ(xi, row), b1 = xi + 1.0 + shJ(xi + 1.0, row);
  float k = x < b0 ? xi - 1.0 : (x >= b1 ? xi + 1.0 : xi);
  float left = k + shJ(k, row), right = k + 1.0 + shJ(k + 1.0, row);
  float sw = right - left;
  float sx = (x - left) / sw;
  float gapD = min(x - left, right - x);
  vec2 sid = vec2(mod(k, COLS), mod(row, ROWS));
  vec3 hh = hash3(sid);
  // butt edge: irregular, with worn rounded corners
  float butt = 0.05 + 0.06 * hh.x + 0.12 * pow(abs(sx - 0.5) * 2.0, 4.0) + 0.02 * gnoise(vec2(x * 6.0, mod(row, ROWS)), vec2(COLS * 6.0, 1000.0));
  float gap = 1.0 - smoothstep(0.025, 0.06, gapD);
  float split = step(0.7, hh.y) * (1.0 - smoothstep(0.0, 0.02, abs(sx - (0.3 + 0.4 * hh.z)))) * smoothstep(0.2, 0.6, fv);
  float t = sat((fv - butt) / (1.0 - butt));
  float below = step(fv, butt);
  float h = below > 0.5 ? 0.18 + 0.12 * (fv / butt) : 1.0 - 0.42 * t;
  h = mix(h, 0.12, gap * (1.0 - below));
  h -= split * 0.4;
  float pick = hh.z;
  vec3 c = pick < 0.2 ? C(0x7e5237) : pick < 0.4 ? C(0x8f6040) : pick < 0.55 ? C(0x6b4d38) : pick < 0.7 ? C(0x9a7350) : pick < 0.85 ? C(0x7a6a5a) : C(0x8c8072);
  float grain = gnoise(vec2(x * 7.0, uv.y * 4.0), vec2(COLS * 7.0, 4.0));
  float grain2 = gnoise(vec2(x * 22.0, uv.y * 10.0), vec2(COLS * 22.0, 10.0));
  c *= 0.86 + 0.16 * grain + 0.08 * grain2;
  c = mix(c, c * 0.72, smoothstep(0.35, 0.0, t) * 0.5);   // weathered, darker butt ends
  c = mix(c, c * 1.12, smoothstep(0.6, 1.0, t) * 0.4);
  vec3 deep = C(0x231811);
  vec3 col = below > 0.5 ? mix(deep, c * 0.45, fv / butt) : c;
  col = mix(col, deep, gap * (1.0 - below) * 0.9);
  col = mix(col, deep, split);
  float ao = below > 0.5 ? 0.3 : mix(1.0, 0.55, smoothstep(0.7, 1.0, t));
  ao *= 1.0 - 0.6 * gap;
  return surf(col, h, 0.86 + 0.08 * grain, ao);
}`,

  // ── THATCH — thick, uneven courses of straw bundles with ragged, overhanging butts ──
  thatch: /* glsl */ `
float thWob(float x, float k) {
  float kk = mod(k, 5.0);
  return 0.24 * gnoise(vec2(x * 3.0, kk * 1.7 + 0.3), vec2(3.0, 1000.0)) + 0.09 * gnoise(vec2(x * 10.0, kk * 2.9 + 1.1), vec2(10.0, 1000.0));
}
Surf kind_thatch(vec2 uv) {
  const float ROWS = 5.0;
  float x0 = uv.x + 0.012 * gnoise(vec2(uv.x * 4.0, uv.y * 12.0), vec2(4.0, 12.0));
  // wavy, uneven course lines — every course waves on its own (no stripes)
  float r0 = uv.y * ROWS;
  float k0 = floor(r0);
  float b0 = k0 + thWob(x0, k0), b1 = k0 + 1.0 + thWob(x0, k0 + 1.0);
  float row = r0 < b0 ? k0 - 1.0 : (r0 >= b1 ? k0 + 1.0 : k0);
  float lo = row + thWob(x0, row), hi = row + 1.0 + thWob(x0, row + 1.0);
  float fv = sat((r0 - lo) / max(hi - lo, 0.2));
  float rk = mod(row, ROWS);
  float x = x0 + hash1(vec2(rk, 2.0), 81u);
  // straw: fine stalks, gathered into bundles of different age/colour
  float strands = ridged(vec2(x * 110.0, uv.y * ROWS * 1.4), vec2(110.0, ROWS * 1.4), 2);
  float strands2 = gnoise(vec2(x * 260.0, uv.y * 4.0), vec2(260.0, 4.0));
  float bundle = gnoise(vec2(x * 14.0, rk * 1.7), vec2(14.0, 1000.0));
  // bundle personality: smooth (no hard blocks), each course its own
  float tone = vnoise(vec2(x * 11.0, rk * 3.1 + 0.5), vec2(11.0, 1000.0));
  float tone2 = vnoise(vec2(x * 7.0, rk * 5.3 + 2.0), vec2(7.0, 1000.0));
  // ragged butt ends: each stalk stops at its own length
  float rag = 0.05 + 0.13 * sat(gnoise(vec2(x * 90.0, rk), vec2(90.0, 1000.0)) * 0.6 + 0.5) + 0.04 * strands2 + 0.05 * bundle + 0.12 * tone2;
  float below = 1.0 - smoothstep(rag - 0.025, rag + 0.025, fv);   // the dark gap under this course's butts
  float t = sat((fv - rag) / (1.0 - rag));
  float hTop = 0.95 - 0.42 * t + 0.07 * bundle + 0.06 * (tone - 0.5);
  float hBelow = 0.12 + 0.35 * (fv / max(rag, 0.05));
  // the overhang shadow is patchy along the course: deep under thick bundles, light where the butts thin out
  float gapK = 0.45 + 0.55 * smoothstep(0.2, 0.8, vnoise(vec2(x * 9.0, rk * 2.3 + 7.0), vec2(9.0, 1000.0)));
  float h = mix(hTop, mix(hTop * 0.75, hBelow, gapK), below) * 0.72 + 0.16 * strands + 0.05 * strands2;
  // colour: golden fresh straw, pale bleached, grey weathered, a few dark damp bundles
  vec3 straw = mix(C(0xc6a764), C(0xd3bf88), smoothstep(0.3, 0.6, tone));
  straw = mix(straw, C(0x9c8e70), smoothstep(0.62, 0.85, tone));
  straw = mix(straw, C(0x7a6646), smoothstep(0.7, 0.95, tone2) * 0.8);
  vec3 c = mix(straw * 0.78, straw * 1.08, sat(strands * 0.9 + 0.05 + 0.3 * bundle));
  float wv = fbmu(vec2(x, uv.y), vec2(3.0, 4.0), 3);
  c = mix(c, C(0x847a62), sat(wv + 0.2) * 0.45);
  c *= 0.86 + 0.14 * strands2;
  c = mix(c, c * 1.1, (1.0 - smoothstep(0.0, 0.25, t)) * (1.0 - below) * 0.5);   // sunlit cut ends
  c = mix(c, c * 0.7, smoothstep(0.6, 1.0, t) * 0.5);                      // shaded under the next course
  vec3 col = mix(c, mix(c * 0.36, c * 0.62, fv / max(rag, 0.05)), below * gapK);
  // a little green algae in the damp, shaded parts
  col = mix(col, col * vec3(0.8, 0.95, 0.62), smoothstep(0.6, 1.0, t) * sat(wv + 0.3) * 0.5);
  float ao = mix(1.0, 0.65, smoothstep(0.6, 1.0, t)) * mix(1.0, 0.6, below * gapK);
  return surf(col, h, 0.95, ao);
}`,

  // ── MUSHROOM CAP (colorize) — velvety skin, radial fibrils, dark rim; V = 0 rim → 1 apex ──
  mushroomCap: /* glsl */ `
Surf kind_mushroomCap(vec2 uv) {
  float fib = gnoise(vec2(uv.x * 180.0, uv.y * 3.0), vec2(180.0, 3.0));
  float fib2 = gnoise(vec2(uv.x * 64.0, uv.y * 6.0), vec2(64.0, 6.0));
  float mot = fbm(uv * vec2(20.0, 7.0), vec2(20.0, 7.0), 4);
  float mot2 = fbm(uv * vec2(30.0, 10.0) + vec2(3.0), vec2(30.0, 10.0), 3);
  float rim = 1.0 - smoothstep(0.0, 0.25, uv.y);
  float apex = smoothstep(0.65, 1.0, uv.y);
  float R = sat(0.3 + 0.2 * mot + 0.55 * rim * rim - 0.3 * apex + 0.1 * fib2 + 0.08 * mot2);
  float G = 0.5 + 0.05 * fib + 0.04 * mot2 + 0.03 * gnoise(uv * vec2(300.0, 60.0), vec2(300.0, 60.0));
  // pale, flaky remnants of the veil (sparse) + a pale rim edge
  vec4 fv = voronoi(uv * vec2(48.0, 16.0), vec2(48.0, 16.0), 0.9);
  float fleck = step(0.88, fv.z) * (1.0 - smoothstep(0.1, 0.2, fv.x)) * (1.0 - rim);
  float edge = 1.0 - smoothstep(0.0, 0.03, uv.y);
  float B = sat(fleck * 0.85 + edge * 0.5);
  float h = 0.5 + 0.1 * mot + 0.025 * fib + 0.12 * fleck;
  float rough = 0.5 - 0.16 * smoothstep(0.0, 0.5, mot) + 0.25 * fleck;
  return surf(vec3(R, G, B), h, rough, 1.0);
}`,

  // ── MUSHROOM STEM — fibrous cream with snakeskin scales; U around, V up ──
  mushroomStem: /* glsl */ `
Surf kind_mushroomStem(vec2 uv) {
  float fib = gnoise(vec2(uv.x * 110.0, uv.y * 4.0), vec2(110.0, 4.0));
  float fib2 = ridged(vec2(uv.x * 36.0, uv.y * 2.0), vec2(36.0, 2.0), 3);
  vec2 cell, tc;
  vec2 sp = vec2(uv.x * 16.0 + 0.5 * floor(uv.y * 10.0), uv.y * 10.0);
  vec4 sv = voronoi(sp, vec2(16.0, 10.0), 0.6, cell, tc);
  float scaleEdge = 1.0 - smoothstep(0.0, 0.08, sv.y);
  float scaleTop = smoothstep(0.0, 0.4, -tc.y) * (1.0 - scaleEdge);
  float scaleMask = smoothstep(0.1, 0.4, fbmu(uv + vec2(0.4), vec2(4.0, 3.0), 3));
  vec3 col = C(0xf2e9d3);
  col = mix(col, C(0xe2d1ac), sat(fib2 * 0.7));
  col = mix(col, C(0xd6c29a), sat(fbmu(uv, vec2(3.0, 2.0), 4) * 0.9) * 0.6);
  col *= 0.95 + 0.06 * fib;
  col = mix(col, C(0xc9b590), scaleEdge * scaleMask * 0.7);
  col = mix(col, C(0xfaf4e6), scaleTop * scaleMask * 0.4);
  float stain = sat(fbmu(uv + vec2(0.9), vec2(5.0, 3.0), 4) * 1.5 - 0.5);
  col = mix(col, C(0xb9a47c), stain * 0.45);
  float h = 0.55 + 0.07 * fib2 + 0.02 * fib + scaleMask * (0.05 * scaleTop - 0.06 * scaleEdge);
  return surf(col, h, 0.78 + 0.1 * scaleMask, 1.0);
}`,

  // ── GILLS — fine radial lamellae; U = angle, V = 0 at the stem → 1 at the rim ──
  gills: /* glsl */ `
Surf kind_gills(vec2 uv) {
  const float N = 120.0;
  float wob = 0.06 * gnoise(vec2(uv.x * 24.0, uv.y * 3.0), vec2(24.0, 3.0));
  float t = fract(uv.x * N + wob);
  float rr = uv.y;
  float dF = min(t, 1.0 - t);
  float dH = abs(t - 0.5);
  float dQ = min(abs(t - 0.25), abs(t - 0.75));
  float gw = 0.12;
  float full = 1.0 - smoothstep(gw * 0.4, gw, dF);
  float halfG = (1.0 - smoothstep(gw * 0.4, gw, dH)) * smoothstep(0.28, 0.34, rr);
  float quarter = (1.0 - smoothstep(gw * 0.35, gw * 0.9, dQ)) * smoothstep(0.6, 0.68, rr);
  float g = max(full, max(halfG, quarter));
  float prof = sqrt(g);
  float var = fbm(vec2(uv.x * 40.0, uv.y * 6.0), vec2(40.0, 6.0), 3);
  vec3 face = mix(C(0xd7c39b), C(0xf0e2c2), prof);
  face *= 0.92 + 0.1 * var;
  vec3 shadow = mix(C(0x8a6f4c), C(0xa88e68), smoothstep(0.0, 1.0, rr));
  vec3 col = mix(shadow, face, smoothstep(0.0, 0.5, g));
  col = mix(col, col * 0.85, 1.0 - smoothstep(0.0, 0.18, rr));         // soft collar at the stem
  col = mix(col, col * 1.08, smoothstep(0.92, 1.0, rr));
  float h = prof * (0.8 + 0.1 * var);
  float ao = mix(0.6, 1.0, smoothstep(0.0, 0.6, g));
  return surf(col, h, 0.85, ao);
}`,

  // ── LEAF — one leaf filling the UV square: base at V=0, tip at V=1, midrib at U=0.5 ──
  leaf: /* glsl */ `
Surf kind_leaf(vec2 uv) {
  vec2 p = uv - vec2(0.5, 0.0);
  float ax = abs(p.x);
  float mid = 1.0 - smoothstep(0.004, 0.014, ax);
  float lat = fract((uv.y - ax * 0.95) * 7.0);
  float vein = (1.0 - smoothstep(0.0, 0.07, min(lat, 1.0 - lat))) * smoothstep(0.015, 0.04, ax) * (1.0 - smoothstep(0.3, 0.48, ax));
  vec4 rv = voronoi(uv * 24.0, vec2(24.0), 1.0);
  float ret = (1.0 - smoothstep(0.0, 0.05, rv.y)) * 0.5;
  float n = fbmu(uv, 4.0, 4);
  vec3 col = mix(C(0x355f26), C(0x5a8a36), sat(n * 0.6 + 0.5));
  col = mix(col, C(0x6f9a3e), sat(uv.y * 0.6 - ax * 0.5));
  col = mix(col, C(0x9fbd62), max(mid, vein * 0.7));
  col = mix(col, col * 1.1, ret);
  col = mix(col, C(0x8f8a3a), smoothstep(0.4, 0.5, ax) * 0.5);
  float h = 0.55 - 0.12 * mid - 0.08 * vein - 0.03 * ret + 0.04 * n + 0.05 * (1.0 - ax * 2.0);
  return surf(col, h, 0.45 + 0.1 * n, 1.0);
}`,

  // ── FABRIC (colorize) — plain weave with slubs and faded wear ──
  fabric: /* glsl */ `
Surf kind_fabric(vec2 uv) {
  const float T = 56.0;
  vec2 p = uv * T;
  vec2 id = floor(p), f = fract(p);
  bool warpOver = mod(id.x + id.y, 2.0) < 1.0;
  float slubA = hash1(vec2(mod(id.x, T), 0.0), 41u), slubB = hash1(vec2(mod(id.y, T), 1.0), 42u);
  float warpP = 1.0 - pow(abs(f.x - 0.5) * 2.0, 2.0);
  float weftP = 1.0 - pow(abs(f.y - 0.5) * 2.0, 2.0);
  float h = warpOver ? warpP * (0.55 + 0.45 * sin(f.y * 3.14159)) : weftP * (0.55 + 0.45 * sin(f.x * 3.14159));
  float fib = gnoise(warpOver ? vec2(p.x * 3.0, p.y * 0.6) : vec2(p.x * 0.6, p.y * 3.0), vec2(T * 3.0, T * 0.6));
  float R = sat((1.0 - h) * 0.7);
  float G = 0.5 + 0.05 * fib + 0.06 * ((warpOver ? slubA : slubB) - 0.5) + 0.03 * fbmu(uv, 6.0, 3);
  float B = sat(fbmu(uv + vec2(0.3), 3.0, 4) * 1.5 - 0.35) * 0.6;
  return surf(vec3(R, G, B), h * 0.8 + 0.1 + 0.03 * fib, 0.96, mix(0.5, 1.0, h));
}`,

  // ── ROPE — three twisted strands (Tube UVs: U along, V around) ──
  rope: /* glsl */ `
Surf kind_rope(vec2 uv) {
  const float K = 4.0;
  float s = uv.x * K * 3.0 + uv.y * 3.0;
  float f = fract(s);
  float strand = pow(sin(f * 3.14159), 0.6);
  // fibres twist the other way within each strand
  float fib = gnoise(vec2(uv.x * K * 3.0 * 8.0 - uv.y * 24.0, f * 6.0 + uv.y * 3.0), vec2(K * 24.0, 1000.0));
  float fuzz = gnoise(uv * vec2(K * 40.0, 48.0), vec2(K * 40.0, 48.0));
  vec3 col = mix(C(0x6e5a3c), C(0xc0a272), strand);
  col *= 0.86 + 0.14 * fib + 0.06 * fuzz;
  col = mix(col, col * vec3(0.9, 0.95, 0.85), sat(fbmu(uv, vec2(K, 2.0), 3) + 0.3) * 0.4);
  float h = strand * 0.75 + 0.1 * fib + 0.03 * fuzz;
  return surf(col, h, 0.96, mix(0.55, 1.0, strand));
}`,

  // ── METAL (colorize) — hand-forged iron: hammer dimples, mill scale, rust ──
  metal: /* glsl */ `
Surf kind_metal(vec2 uv) {
  vec2 cell, tc;
  vec4 v = voronoi(uv * 8.0, vec2(8.0), 1.0, cell, tc);
  float dish = v.x * v.x;
  float scaleN = fbmu(uv, 5.0, 5);
  float fine = gnoise(uv * 120.0, vec2(120.0));
  float rustN = fbmu(uv + vec2(0.6), 4.0, 6) + 0.25 * gnoise(uv * 40.0, vec2(40.0));
  float rust = smoothstep(0.12, 0.42, rustN);
  float R = sat(0.4 + 0.5 * scaleN + 0.12 * (v.z - 0.5));
  float G = 0.5 + 0.07 * fine + 0.12 * (dish - 0.25) + 0.08 * rust * gnoise(uv * 60.0, vec2(60.0));
  float B = rust * 0.9;
  float h = 0.5 + 0.3 * dish + 0.025 * fine + 0.06 * rust * (fbmu(uv, 30.0, 2) + 0.5);
  return surf(vec3(R, G, B), h, 0.42 + 0.12 * scaleN + 0.42 * rust, 1.0);
}`,

  // ── GLASS — old crown glass: gentle waves, seeds (bubbles), smudges ──
  glass: /* glsl */ `
Surf kind_glass(vec2 uv) {
  float w = fbmu(uv, 3.0, 3);
  vec4 bv = voronoi(uv * 18.0, vec2(18.0), 1.0);
  float bub = step(0.85, bv.z) * (1.0 - smoothstep(0.05, 0.09, bv.x));
  float smudge = sat(fbmu(uv + vec2(0.4), 5.0, 4) * 1.5 - 0.2);
  vec3 col = C(0xd8ebe3) * (0.97 + 0.03 * w);
  float h = 0.5 + 0.2 * w + 0.15 * bub;
  return surf(col, h, 0.05 + 0.18 * smudge, 1.0);
}`,

  // ── PAPER — laid paper with fibres and foxing ──
  paper: /* glsl */ `
Surf kind_paper(vec2 uv) {
  float fib = gnoise(uv * vec2(260.0, 50.0), vec2(260.0, 50.0)) + 0.6 * gnoise(uv * vec2(60.0, 300.0), vec2(60.0, 300.0));
  float m = fbmu(uv, 4.0, 4);
  vec3 col = mix(C(0xf4ebd8), C(0xe6d6b4), sat(m * 0.8 + 0.3));
  col *= 0.97 + 0.03 * fib;
  vec4 fv = voronoi(uv * 12.0, vec2(12.0), 1.0);
  float fox = step(0.8, fv.z) * (1.0 - smoothstep(0.05, 0.25, fv.x));
  col = mix(col, C(0xcfb184), fox * 0.25);
  float laid = 0.5 + 0.5 * sin(uv.y * 6.2831853 * 90.0);
  float h = 0.5 + 0.03 * fib + 0.015 * laid;
  return surf(col, h, 0.95, 1.0);
}`,

  // ── CLAY (colorize) — fired terracotta with throwing rings and grog specks ──
  clay: /* glsl */ `
Surf kind_clay(vec2 uv) {
  float rings = sin((uv.y * 22.0 + 1.5 * fbmu(uv, vec2(2.0, 3.0), 3)) * 6.2831853);
  float m = fbmu(uv, 4.0, 5);
  vec4 sv = voronoi(uv * 50.0, vec2(50.0), 1.0);
  float speck = step(0.78, sv.z) * (1.0 - smoothstep(0.08, 0.16, sv.x));
  float R = sat(0.4 + 0.35 * m + 0.06 * rings);
  float G = 0.5 + 0.04 * gnoise(uv * 140.0, vec2(140.0)) - 0.22 * speck;
  float B = sat(fbmu(uv + vec2(0.5), 3.0, 4) * 1.6 - 0.45) * 0.55;
  float h = 0.5 + 0.035 * rings + 0.04 * m - 0.05 * speck;
  return surf(vec3(R, G, B), h, 0.84, 1.0);
}`,
};
