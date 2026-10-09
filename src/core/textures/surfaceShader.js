// ─────────────────────────────────────────────────────────────────────────────
// Shader patches that turn MeshStandardMaterial into the glen's painterly
// surfaces (used by materials.surface() / materials.foliage()).
//
// SURFACE (defines: SF_TRIPLANAR, SF_COLORIZE, SF_MOSS, SF_WOOD, SF_BARK, SF_LITE)
//   • world position & normal are reconstructed in the fragment shader from
//     vViewPosition / viewMatrix — no vertex changes, so instancing, batching,
//     skinning and wind all keep working
//   • triplanar (world space, whiteout normal blend) or UV mapping with a
//     derivative tangent frame (no tangents needed)
//   • moss creeping onto up-facing surfaces, filling crevices first, with
//     noisy world-space edges (opts.mossy)
//   • painterly world-space value/temperature breakup — nothing is CG-uniform
//   • soft "wrap" terminator and a velvet rim sheen (moss, mushroom caps)
//   • wood (SF_WOOD, uv-mapped wood / planks / timber): light lenticular ray
//     flecks and END GRAIN drawn analytically (crisp at any scale). A face is
//     end grain when its V carries the END_GRAIN_V marker (materials.boxUV adds
//     it on faces across the grain): darker Hirnholz with ring arcs around a
//     pith, rays and (timber) drying checks
//   • bark (SF_BARK): in direct (warm) sun the furrows are lifted and the
//     plates' highlights desaturated, so a sunlit trunk never reads as a tiger
//     stripe; a near-white vertex colour turns it into smooth birch bark
// FOLIAGE
//   • the same wrap lighting + translucency: leaves glow when back-lit by the
//     sun (and by lantern point lights), shadow-aware
//   • optional volumetric normals (normals not flipped on back faces)
//
// Programs are shared through customProgramCacheKey (one per define combo);
// everything per-material lives in uniforms.
// ─────────────────────────────────────────────────────────────────────────────

const NOISE3 = /* glsl */ `
float sfHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float sfNoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = sfHash13(i), b = sfHash13(i + vec3(1, 0, 0));
  float c = sfHash13(i + vec3(0, 1, 0)), d = sfHash13(i + vec3(1, 1, 0));
  float e = sfHash13(i + vec3(0, 0, 1)), f1 = sfHash13(i + vec3(1, 0, 1));
  float g = sfHash13(i + vec3(0, 1, 1)), h = sfHash13(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, f1, f.x), mix(g, h, f.x), f.y), f.z);
}
`;

/** Lighting override: soft wrap terminator (+ translucency for foliage). */
const DIRECT_OVERRIDE = /* glsl */ `
uniform vec4 sfLight; // x: wrap, y: translucency, z: unused, w: unused
#ifdef SF_BARK
vec3 sfDirK = vec3(1.0); // per-fragment albedo multiplier for the sun's light only (set by the surface)
vec3 sfDirN = vec3(0.0); // the unmapped geometry normal (view space), set by the surface
int sfDirectCalls = 0;   // three lights point → spot → sun → directional: counts which one this is
#endif
void RE_Direct_Woodland(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
#ifdef SF_BARK
  // bark in direct sun: the furrows' walls turned from the light would go black
  // against sunlit plates (a painted tiger band) — light it with lifted furrows
  // and the relief partly flattened. Only the warm directional SUN: lanterns &
  // the spot beam (point / spot lights come first in three's light loops) keep
  // the full raking relief, as do the cool moon, shade & ambient.
  float sfSunW = sfDirectCalls >= NUM_POINT_LIGHTS + NUM_SPOT_LIGHTS ? 1.0 : 0.0;
  sfSunW *= clamp((directLight.color.r - directLight.color.b) / max(directLight.color.r, 1e-4) * 4.0, 0.0, 1.0);
  sfDirectCalls++;
  PhysicalMaterial sfMD = material;
  sfMD.diffuseContribution *= mix(vec3(1.0), sfDirK, sfSunW);
  vec3 sfNB = normalize(mix(geometryNormal, sfDirN, 0.6 * sfSunW));
  RE_Direct_Physical(directLight, geometryPosition, sfNB, geometryViewDir, geometryClearcoatNormal, sfMD, reflectedLight);
#else
  RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
#endif
  float ndl = dot(geometryNormal, directLight.direction);
  if (sfLight.x > 0.0) {
    float extra = saturate((ndl + sfLight.x) / (1.0 + sfLight.x)) - saturate(ndl);
    reflectedLight.directDiffuse += extra * 0.7 * directLight.color * BRDF_Lambert(material.diffuseContribution);
  }
  if (sfLight.y > 0.0) {
    // light scattered through thin leaves: strongest when looking towards the light
    float back = saturate(-ndl);
    float toward = pow(saturate(dot(-geometryViewDir, directLight.direction)), 3.0);
    float t = (0.35 * back + 0.9 * toward) * sfLight.y;
    reflectedLight.directDiffuse += t * directLight.color * material.diffuseContribution * vec3(1.05, 1.12, 0.62);
  }
}
#undef RE_Direct
#define RE_Direct RE_Direct_Woodland
`;

const SURFACE_PARS = /* glsl */ `
uniform sampler2D sfMap;
uniform sampler2D sfDetail;
uniform vec3 sfColA;
uniform vec3 sfColB;
uniform vec3 sfColC;
uniform vec2 sfTile;   // triplanar: (1/tile, 1/aspect) · uv: repeat (u, v)
uniform vec4 sfP;      // x normal strength, y ao strength, z roughness mul, w breakup
uniform vec4 sfQ;      // x mossy, y moss frequency, z velvet, w metal-rust coupling
uniform vec4 sfR;      // x uv swap (grain along V), y polar mode (1 disc, 2 cone), z metalness, w anti-tile warp (triplanar)
uniform vec4 sfS;      // x moss brightness, y wood ray flecks, z end-grain value, w bark: albedo mean (sun lift)
#ifdef SF_MOSS
uniform sampler2D sfMossMap;
uniform sampler2D sfMossDetail;
#endif
${NOISE3}
vec3 sfUnpack(vec2 xy, float s) {
  vec2 n = xy * 2.0 - 1.0;
  return vec3(n * s, sqrt(saturate(1.0 - dot(n, n))));
}
// asp: the map covers 1/asp tiles along V (tall maps, e.g. bark) — V is scaled on every projection
void sfTriplanar(sampler2D tA, sampler2D tD, vec3 p, vec3 n, float ns, float asp, out vec4 A, out vec4 D, out vec3 N) {
  vec3 w = pow(abs(n), vec3(5.0));
  w /= dot(w, vec3(1.0));
  vec3 sg = vec3(n.x < 0.0 ? -1.0 : 1.0, n.y < 0.0 ? -1.0 : 1.0, n.z < 0.0 ? -1.0 : 1.0);
  A = vec4(0.0); D = vec4(0.0); N = vec3(0.0);
  if (w.x > 0.02) {
    vec2 uvX = vec2(-p.z * sg.x, p.y * asp);
    vec4 a = texture2D(tA, uvX), d = texture2D(tD, uvX);
    vec3 tn = sfUnpack(d.xy, ns);
    tn.x *= -sg.x;
    tn = vec3(tn.xy + n.zy, abs(tn.z) * n.x);
    N += tn.zyx * w.x; A += a * w.x; D += d * w.x;
  }
  if (w.y > 0.02) {
    vec2 uvY = vec2(p.x * sg.y, p.z * asp);
    vec4 a = texture2D(tA, uvY), d = texture2D(tD, uvY);
    vec3 tn = sfUnpack(d.xy, ns);
    tn.x *= sg.y;
    tn = vec3(tn.xy + n.xz, abs(tn.z) * n.y);
    N += tn.xzy * w.y; A += a * w.y; D += d * w.y;
  }
  if (w.z > 0.02) {
    vec2 uvZ = vec2(p.x * sg.z, p.y * asp);
    vec4 a = texture2D(tA, uvZ), d = texture2D(tD, uvZ);
    vec3 tn = sfUnpack(d.xy, ns);
    tn.x *= sg.z;
    tn = vec3(tn.xy + n.xy, abs(tn.z) * n.z);
    N += tn.xyz * w.z; A += a * w.z; D += d * w.z;
  }
  float ws = (w.x > 0.02 ? w.x : 0.0) + (w.y > 0.02 ? w.y : 0.0) + (w.z > 0.02 ? w.z : 0.0);
  A /= ws; D /= ws;
  N = normalize(N);
}
// Cotangent frame from explicit uv derivatives (Schüler) — lets polar UVs pass seam-free derivatives.
mat3 sfTangentFrame(vec3 eye, vec3 N, vec2 st0, vec2 st1) {
  vec3 q0 = dFdx(eye), q1 = dFdy(eye);
  vec3 q1perp = cross(q1, N), q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float sc = det == 0.0 ? 0.0 : inversesqrt(det);
  return mat3(T * sc, B * sc, N);
}
`;

const SURFACE_MAIN = /* glsl */ `
  // ── woodland surface ──
  vec3 sfWPos = (vec4(-vViewPosition, 0.0) * viewMatrix).xyz + cameraPosition;
  vec3 sfGN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 sfNormal0 = normal;   // interpolated geometry normal (view space), before any map
  vec4 sfA, sfD;
  vec3 sfN;
  float sfEnd = 0.0;         // 1 on end-grain faces (UV marker, see materials.END_GRAIN_V)
#ifdef SF_TRIPLANAR
  vec3 sfTP = sfWPos * sfTile.x;
#ifndef SF_LITE
  if (sfR.w > 0.0) {
    // anti-tiling: a slow world-space warp (≈3 tiles) bends the pattern so
    // repeats never line up — furrows meander, plates never stack in a grid
    vec3 sfWq = sfTP * 0.31;
    sfTP += sfR.w * (vec3(sfNoise3(sfWq), sfNoise3(sfWq + 17.3), sfNoise3(sfWq + 31.7)) - 0.5);
  }
#endif
  sfTriplanar(sfMap, sfDetail, sfTP, sfGN, sfP.x, sfTile.y, sfA, sfD, sfN);
  normal = normalize((viewMatrix * vec4(sfN, 0.0)).xyz);
#else
  vec2 sfUv = vUv;
  // end-grain marker: boxUV adds END_GRAIN_V (1024) to V on faces across the grain
  sfEnd = step(512.0, sfUv.y);
  sfUv.y -= 1024.0 * sfEnd;
  if (sfR.x > 0.5) sfUv = vec2(sfUv.y, -sfUv.x);
  vec2 sfDx, sfDy;
  if (sfR.y > 0.5) {
    if (sfR.y > 1.5) {
      // cone underside: u = angle, v = 1 at the apex (centre)
      sfUv = vec2(sfUv.x, 1.0 - sfUv.y) * sfTile;
      sfDx = dFdx(sfUv); sfDy = dFdy(sfUv);
    } else {
      // disc UVs → polar (u = angle, v = radius), seam-free derivatives
      vec2 c = sfUv - 0.5;
      float ang = atan(c.y, c.x) / 6.2831853 + 0.5;
      float rad = length(c) * 2.0;
      float dax = dFdx(ang), day = dFdy(ang);
      dax -= floor(dax + 0.5); day -= floor(day + 0.5);
      sfUv = vec2(ang, rad) * sfTile;
      sfDx = vec2(dax, dFdx(rad)) * sfTile; sfDy = vec2(day, dFdy(rad)) * sfTile;
    }
  } else {
    sfUv *= sfTile;
    sfDx = dFdx(sfUv); sfDy = dFdy(sfUv);
  }
  sfA = textureGrad(sfMap, sfUv, sfDx, sfDy);
  sfD = textureGrad(sfDetail, sfUv, sfDx, sfDy);
  mat3 sfTbn = sfTangentFrame(-vViewPosition, normal, sfDx, sfDy);
  #ifdef DOUBLE_SIDED
    sfTbn[0] *= faceDirection;
    sfTbn[1] *= faceDirection;
  #endif
  normal = normalize(sfTbn * sfUnpack(sfD.xy, sfP.x));
  sfN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
#endif

#ifdef SF_COLORIZE
  vec3 sfCol = mix(sfColA, sfColB, sfA.r) * (sfA.g * 2.0);
  sfCol = mix(sfCol, sfColC, sfA.b);
#else
  vec3 sfCol = sfA.rgb * sfColA;
#endif
  float sfRough = sfD.z;
  float sfAO = sfD.w;
  float sfMet = sfR.z;
#ifdef SF_COLORIZE
  sfMet *= 1.0 - sfA.b * sfQ.w;
#endif

#ifdef SF_WOOD
  if (sfEnd > 0.5) {
    // ── END GRAIN (Hirnholz): darker, rings as arcs around a pith ──
    // one pith per ~0.4 tile (≈ 56 cm): every part, at its own UV offset, cuts
    // the log somewhere else — near-circles on a post, flat arcs on a board end,
    // almost straight lines on a quarter-sawn one
    vec2 eP = sfUv / 0.4;
    vec2 eC = floor(eP);
    float eBest = 1e9;
    vec2 ePith = vec2(0.0), eId = vec2(0.0);
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 c = eC + vec2(float(i), float(j));
      vec2 pp = c + 0.15 + 0.7 * vec2(sfHash13(vec3(c, 1.7)), sfHash13(vec3(c, 4.3)));
      float dd = dot(eP - pp, eP - pp);
      if (dd < eBest) { eBest = dd; ePith = pp; eId = c; }
    }
    vec2 eD = (eP - ePith) * 0.4;                    // tile units from the pith
    float eR = length(eD * vec2(1.0, 1.07));
    float eA = atan(eD.y, eD.x);
    float eH = sfHash13(vec3(eId, 9.1));
    // rings (≈ the long grain's density): never perfect circles, their width breathes
    float eF = eR * (128.0 + 30.0 * eH)
             + 1.1 * sfNoise3(vec3(cos(eA) * 1.5, sin(eA) * 1.5, eR * 8.0 + eH * 7.0))
             + 2.0 * sfNoise3(vec3(eR * 9.0, eH * 13.0, 0.5));
    float eRing = fract(eF);
    float eW = fwidth(eF);
    float eLate = smoothstep(0.5, 0.86, eRing) * (1.0 - smoothstep(0.88, 1.0, eRing));
    eLate = mix(eLate, 0.27, smoothstep(0.3, 0.8, eW));   // sub-pixel rings → their mean
    // rays: fine pale lines radiating from the pith (strong in oak)
    float eS = (eA / 6.2831853 + 0.5) * (120.0 + 50.0 * eH);
    float eSw = fwidth(eS);
    float eSi = floor(eS + 0.5);
    float eRay = (1.0 - smoothstep(0.04, 0.04 + eSw * 1.2, abs(eS - eSi))) * step(0.6, sfHash13(vec3(eSi, eId)));
    // rays start at different radii and fade where they get sub-pixel (near the pith)
    eRay *= (1.0 - smoothstep(0.25, 0.5, eSw)) * smoothstep(0.01 + 0.05 * sfHash13(vec3(eSi, eId + 3.1)), 0.03 + 0.06 * sfHash13(vec3(eSi, eId + 3.1)), eR);
    float eN = sfNoise3(vec3(sfUv * 60.0, 3.0));
#ifdef SF_COLORIZE
    float eRc = clamp(0.5 + 0.42 * eLate + 0.08 * (eN - 0.5), 0.0, 1.0);
    sfCol = mix(sfColA, sfColB, eRc) * (0.84 + 0.1 * eN);
    sfCol = mix(sfCol, sfColA * 1.0, eRay * sfS.y * 0.35);
#else
    sfCol *= (0.62 + 0.1 * eN) * (1.0 - 0.32 * eLate);
    sfCol = mix(sfCol, sfCol * 1.3, eRay * sfS.y * 0.35);
    // drying check: a dark radial crack from the heart (most timbers have one)
    float eCa = (sfHash13(vec3(eId, 11.0)) - 0.5) * 6.2831853;
    float eDa = abs(mod(eA - eCa + 3.14159265, 6.2831853) - 3.14159265) * eR;   // arc distance
    float eCw = 0.0035 * smoothstep(0.01, 0.05, eR) * (1.0 - smoothstep(0.12, 0.3, eR)) * step(0.3, eH);
    sfCol *= 1.0 - 0.75 * (1.0 - smoothstep(eCw * 0.5, eCw + fwidth(eDa), eDa));
#endif
    sfCol *= sfS.z;
    // end grain is matt and has no long-grain relief
    normal = sfNormal0;
    sfN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    sfRough = 0.86;
    sfAO = 0.95;
  }
#ifdef SF_COLORIZE
  else if (sfS.y > 0.0) {
    // ── ray flecks: short, light, lenticular (spindle) flecks along the grain,
    // ~3 mm × 2–4 cm on oak, a little glossier (the "silver grain")
    vec2 fp = sfUv * vec2(1.0 / 0.035, 1.0 / 0.005);
    fp.x += sfHash13(vec3(floor(fp.y), 3.7, 1.3));          // stagger the rows
    vec2 fc = floor(fp), ff = fract(fp) - 0.5;
    float fh = sfHash13(vec3(fc, 7.1));
    float fwY = fwidth(fp.y);
    float fFade = 1.0 - smoothstep(0.3, 0.75, fwY);           // sub-pixel → off (no shimmer)
    if (fh < 0.3 && fFade > 0.0) {
      float k = fh / 0.3;
      vec2 o = (vec2(sfHash13(vec3(fc, 2.3)), sfHash13(vec3(fc, 5.9))) - 0.5) * vec2(0.25, 0.3);
      float hl = 0.25 + 0.17 * k;                             // half length (cells along)
      float hw = 0.2 + 0.12 * sfHash13(vec3(fc, 8.8));        // half width (cells across)
      vec2 d = ff - o;
      float sx = 1.0 - (d.x / hl) * (d.x / hl);
      float edge = hw * sx - abs(d.y);
      float fleck = smoothstep(-fwY, fwY, edge) * step(0.0, sx) * fFade * sfS.y;
      sfCol = mix(sfCol, sfCol * 1.3 + sfColA * 0.04, fleck * 0.7);
      sfRough *= 1.0 - 0.25 * fleck;
    }
  }
#endif
#endif

#if defined(SF_BARK) && (defined(USE_COLOR) || defined(USE_COLOR_ALPHA))
  {
    // a near-white vertex colour is a silver BIRCH: papery, smooth bark. The
    // deep oak furrows × chalk white read as a black-and-yellow tiger stripe —
    // keep only a trace of them and add fine horizontal lenticels instead
    // (the builder's own dark dashes & patches stay: they are in the colour)
    float birch = smoothstep(0.4, 0.6, dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
    if (birch > 0.0) {
      sfCol = mix(sfCol, vec3(0.86, 0.85, 0.83), 0.8 * birch);
      float ln = sfNoise3(vec3(sfWPos.x * 8.0, sfWPos.y * 42.0, sfWPos.z * 8.0));
      float lnFade = 1.0 - smoothstep(0.4, 0.9, fwidth(sfWPos.y * 42.0));   // sub-pixel → off (no shimmer)
      sfCol *= 1.0 - 0.5 * smoothstep(0.74, 0.86, ln) * birch * lnFade;
      sfCol *= 1.0 + 0.1 * (sfNoise3(sfWPos * vec3(1.3, 4.0, 1.3) + 4.0) - 0.5) * birch;
      normal = normalize(mix(normal, sfNormal0, 0.75 * birch));
      sfN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
      sfAO = mix(sfAO, 1.0, 0.75 * birch);
    }
  }
#endif

  float sfMossM = 0.0;
#ifdef SF_MOSS
  {
    vec4 mA, mD;
    vec3 mN;
    sfTriplanar(sfMossMap, sfMossDetail, sfWPos * sfQ.y, sfGN, 1.0, 1.0, mA, mD, mN);
    float big = sfNoise3(sfWPos * 0.45);
    float small = sfNoise3(sfWPos * 2.3 + 7.0);
    // top faces (stone tops, ledges, sills) catch moss first and clearly once
    // the surface is meant to be properly mossy (≥ 0.3); light moss (paths) unchanged
    float up = smoothstep(0.35, 0.85, sfGN.y);
    float field = sfGN.y * 0.85 + up * 0.3 * smoothstep(0.2, 0.4, sfQ.x) + (big - 0.5) * 0.9 + (small - 0.5) * 0.3 + (0.5 - sfA.a) * 0.7 + (mA.a - 0.5) * 0.6;
    float thr = 1.15 - sfQ.x * 1.75;
    float m = smoothstep(thr - 0.05, thr + 0.05, field);
    float fringe = smoothstep(thr - 0.16, thr - 0.04, field) * (1.0 - m);
    sfCol = mix(sfCol, sfCol * vec3(0.74, 0.84, 0.56), fringe * 0.65);  // damp, greenish edge
    // sunlit cushions on top are a touch brighter & yellower than moss on the sides
    vec3 sfMossCol = mA.rgb * mix(vec3(1.0), vec3(1.1, 1.14, 0.9), up);
#if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
    // the vertex / instance colour tints the BASE albedo only: diffuseColor
    // already carries it, so divide it out of the moss — velvet green moss on
    // every vertex-coloured rock, log and root (not moss × grey = near black)
    sfMossCol /= max(vColor.rgb, vec3(0.04));
#endif
    sfCol = mix(sfCol, sfMossCol * sfS.x, m);
    sfMossM = m;
    sfN = normalize(mix(sfN, mN, m));
    normal = normalize((viewMatrix * vec4(sfN, 0.0)).xyz);
    sfRough = mix(sfRough, mD.z, m);
    sfAO = mix(sfAO, mD.w, m);
    sfMet *= 1.0 - m;
  }
#endif

  // painterly breakup: value + temperature drift in world space
#ifndef SF_LITE
  {
    float b1 = sfNoise3(sfWPos * 0.32);
    float b3 = sfNoise3(sfWPos * vec3(0.19, 0.27, 0.19) + 5.7);
    float k = sfP.w;
    sfCol *= 1.0 + ((b1 - 0.5) * 0.34 + (b3 - 0.5) * 0.1) * k;
    sfCol = mix(sfCol, sfCol * vec3(1.08, 1.0, 0.86), (b3 - 0.5) * 1.3 * k);
  }
#endif
#ifdef SF_BARK
  {
    // Direct sun on bark: deep furrows would turn near-black stripes against
    // bright plates (a painted tiger band). For DIRECT light only, lift the
    // furrows to ≥ 70 % of the map's mean (sfS.w; crevice darkening stays
    // < ~50 % in the sun), settle the plates into a warm, desaturated tan and
    // keep the brightest from blowing out — shade & ambient keep the full depth.
    const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
    float lum = dot(sfCol, LW);
    float lift = mix(clamp(0.7 * sfS.w / max(lum, 1e-4), 1.0, 7.0), 1.0, sfMossM);
    vec3 c = sfCol * lift;
    float l2 = dot(c, LW);
    // the warm sun × warm grade would turn brown plates yellow: desaturate the
    // sunlit bark a little everywhere, the bright plates more (warm grey-tan)
    float hi = smoothstep(1.1, 1.8, l2 / max(sfS.w, 1e-4)) * (1.0 - sfMossM);
    c = mix(c, vec3(l2) * vec3(1.06, 1.0, 0.9), (0.35 + 0.3 * hi) * (1.0 - sfMossM));
    c *= 1.0 - 0.2 * hi;
    // …and no painterly crevice darkening on the sunlit side (it stays on ambient)
    sfDirK = c / max(sfCol, vec3(1e-4)) / mix(1.0, sfAO, sfP.y * 0.3);
    sfDirN = sfNormal0;
  }
#endif
  diffuseColor.rgb *= sfCol;
  roughnessFactor = clamp(sfRough * sfP.z, 0.04, 1.0);
  metalnessFactor = sfMet;
  // painterly crevice darkening also on direct light (subtle)
  diffuseColor.rgb *= mix(1.0, sfAO, sfP.y * 0.3);
`;

const SURFACE_AO = /* glsl */ `
#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= mix(1.0, sfAO, sfP.y);
  reflectedLight.indirectSpecular *= mix(1.0, sfAO, sfP.y);
`;

const SURFACE_VELVET = /* glsl */ `
#include <lights_fragment_end>
  if (sfQ.z > 0.0) {
    float sfFres = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.5);
    reflectedLight.directDiffuse *= 1.0 + sfQ.z * sfFres;
    reflectedLight.indirectDiffuse *= 1.0 + sfQ.z * 1.5 * sfFres;
  }
`;

/**
 * Patch a MeshStandardMaterial shader for a surface. `u` holds the material's
 * own uniform objects (shared by reference so they can be updated later).
 */
export function patchSurface(shader, u) {
  Object.assign(shader.uniforms, u);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + DIRECT_OVERRIDE + SURFACE_PARS)
    .replace('#include <normal_fragment_maps>', SURFACE_MAIN)
    .replace('#include <aomap_fragment>', SURFACE_AO)
    .replace('#include <lights_fragment_end>', SURFACE_VELVET);
}

const FOLIAGE_PARS = /* glsl */ `
uniform vec4 sfFol; // x: volume normals (1 = do not flip on back faces), y: hue variation, z: interior darkening
${NOISE3}
`;

const FOLIAGE_MAIN = /* glsl */ `
#include <normal_fragment_begin>
  if (sfFol.x > 0.5) {
    normal = normalize(vNormal);
    nonPerturbedNormal = normal;
  }
  {
    vec3 sfWPos = (vec4(-vViewPosition, 0.0) * viewMatrix).xyz + cameraPosition;
    float b1 = sfNoise3(sfWPos * 0.35);
    float b2 = sfNoise3(sfWPos * 1.3 + 3.1);
    diffuseColor.rgb *= 1.0 + (b2 - 0.5) * 0.35 * sfFol.y;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.06, 0.7), (b1 - 0.5) * 1.6 * sfFol.y);
  }
`;

// Keep leaf cards from thinning out in the distance: lower mips average the
// alpha down, so scale it back up by the mip level before the alpha test.
const FOLIAGE_ALPHA = /* glsl */ `
#ifdef USE_MAP
  {
    vec2 sfTs = vMapUv * vec2(textureSize(map, 0));
    vec2 sfDx = dFdx(sfTs), sfDy = dFdy(sfTs);
    float sfLod = max(0.0, 0.5 * log2(max(dot(sfDx, sfDx), dot(sfDy, sfDy))));
    diffuseColor.a *= 1.0 + sfLod * 0.28;
  }
#endif
#include <alphatest_fragment>
`;

export function patchFoliage(shader, u) {
  Object.assign(shader.uniforms, u);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + DIRECT_OVERRIDE + FOLIAGE_PARS)
    .replace('#include <alphatest_fragment>', FOLIAGE_ALPHA)
    .replace('#include <normal_fragment_begin>', FOLIAGE_MAIN);
}

// Shadow pass for foliage: sample the leaf alpha at a capped mip so a
// shadow-map texel that covers many card texels still sees individual leaves
// (dappled, coverage-preserving) instead of a mip average that falls below the
// alpha test and makes canopy shadows thin out.
const FOLIAGE_DEPTH_ALPHA = /* glsl */ `
#ifdef USE_MAP
  {
    vec2 sfTs = vMapUv * vec2(textureSize(map, 0));
    vec2 sfDx = dFdx(sfTs), sfDy = dFdy(sfTs);
    float sfLod = clamp(0.5 * log2(max(dot(sfDx, sfDx), dot(sfDy, sfDy))), 0.0, 2.0);
    diffuseColor.a = textureLod(map, vMapUv, sfLod).a * (1.0 + sfLod * 0.2);
  }
#endif
#include <alphatest_fragment>
`;

export function patchFoliageDepth(shader) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', FOLIAGE_DEPTH_ALPHA);
}
