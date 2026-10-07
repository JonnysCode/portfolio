// ─────────────────────────────────────────────────────────────────────────────
// Shader patches that turn MeshStandardMaterial into the glen's painterly
// surfaces (used by materials.surface() / materials.foliage()).
//
// SURFACE (defines: SF_TRIPLANAR, SF_COLORIZE, SF_MOSS, SF_POLAR)
//   • world position & normal are reconstructed in the fragment shader from
//     vViewPosition / viewMatrix — no vertex changes, so instancing, batching,
//     skinning and wind all keep working
//   • triplanar (world space, whiteout normal blend) or UV mapping with a
//     derivative tangent frame (no tangents needed)
//   • moss creeping onto up-facing surfaces, filling crevices first, with
//     noisy world-space edges (opts.mossy)
//   • painterly world-space value/temperature breakup — nothing is CG-uniform
//   • soft "wrap" terminator and a velvet rim sheen (moss, mushroom caps)
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
void RE_Direct_Woodland(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
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
uniform vec2 sfTile;   // triplanar: (1/tile, -) · uv: repeat (u, v)
uniform vec4 sfP;      // x normal strength, y ao strength, z roughness mul, w breakup
uniform vec4 sfQ;      // x mossy, y moss frequency, z velvet, w metal-rust coupling
uniform vec4 sfR;      // x uv swap (grain along V), y polar mode (1 disc, 2 cone), z metalness, w unused
#ifdef SF_MOSS
uniform sampler2D sfMossMap;
uniform sampler2D sfMossDetail;
#endif
${NOISE3}
vec3 sfUnpack(vec2 xy, float s) {
  vec2 n = xy * 2.0 - 1.0;
  return vec3(n * s, sqrt(saturate(1.0 - dot(n, n))));
}
void sfTriplanar(sampler2D tA, sampler2D tD, vec3 p, vec3 n, float ns, out vec4 A, out vec4 D, out vec3 N) {
  vec3 w = pow(abs(n), vec3(5.0));
  w /= dot(w, vec3(1.0));
  vec3 sg = vec3(n.x < 0.0 ? -1.0 : 1.0, n.y < 0.0 ? -1.0 : 1.0, n.z < 0.0 ? -1.0 : 1.0);
  A = vec4(0.0); D = vec4(0.0); N = vec3(0.0);
  if (w.x > 0.02) {
    vec2 uvX = vec2(-p.z * sg.x, p.y);
    vec4 a = texture2D(tA, uvX), d = texture2D(tD, uvX);
    vec3 tn = sfUnpack(d.xy, ns);
    tn.x *= -sg.x;
    tn = vec3(tn.xy + n.zy, abs(tn.z) * n.x);
    N += tn.zyx * w.x; A += a * w.x; D += d * w.x;
  }
  if (w.y > 0.02) {
    vec2 uvY = vec2(p.x * sg.y, p.z);
    vec4 a = texture2D(tA, uvY), d = texture2D(tD, uvY);
    vec3 tn = sfUnpack(d.xy, ns);
    tn.x *= sg.y;
    tn = vec3(tn.xy + n.xz, abs(tn.z) * n.y);
    N += tn.xzy * w.y; A += a * w.y; D += d * w.y;
  }
  if (w.z > 0.02) {
    vec2 uvZ = vec2(p.x * sg.z, p.y);
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
  vec4 sfA, sfD;
  vec3 sfN;
#ifdef SF_TRIPLANAR
  sfTriplanar(sfMap, sfDetail, sfWPos * sfTile.x, sfGN, sfP.x, sfA, sfD, sfN);
  normal = normalize((viewMatrix * vec4(sfN, 0.0)).xyz);
#else
  vec2 sfUv = vUv;
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

#ifdef SF_MOSS
  {
    vec4 mA, mD;
    vec3 mN;
    sfTriplanar(sfMossMap, sfMossDetail, sfWPos * sfQ.y, sfGN, 1.0, mA, mD, mN);
    float big = sfNoise3(sfWPos * 0.45);
    float small = sfNoise3(sfWPos * 2.3 + 7.0);
    float field = sfGN.y * 0.85 + (big - 0.5) * 0.9 + (small - 0.5) * 0.3 + (0.5 - sfA.a) * 0.7 + (mA.a - 0.5) * 0.6;
    float thr = 1.15 - sfQ.x * 1.75;
    float m = smoothstep(thr - 0.05, thr + 0.05, field);
    float fringe = smoothstep(thr - 0.16, thr - 0.04, field) * (1.0 - m);
    sfCol = mix(sfCol, sfCol * vec3(0.78, 0.86, 0.6), fringe * 0.6);  // damp, greenish edge
    sfCol = mix(sfCol, mA.rgb, m);
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
