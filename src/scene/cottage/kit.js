// ─────────────────────────────────────────────────────────────────────────────
// Cottage kit — geometry helpers for the mushroom houses, the garden and the
// Wohnatelier interior.
//
// Everything is built from hundreds of small hand-made parts (planks, stones,
// warts, ivy leaves, cushions …). Each part is baked (transform + UVs + an
// optional vertex colour) and merged PER MATERIAL by a Batch, so the whole
// cottage cluster costs a few dozen draw calls. Most materials are
// vertex-coloured painterly surfaces: the texture brings the detail, the
// vertex colour brings the hue — so every cap colour, every wood species and
// every stone tint merges into ONE draw call per surface kind.
//
//   const B = new Batch();
//   const F = B.at(matrix);                       // a local frame
//   F.add(mats().wood, board(1, 0.04, 0.2), { color: WOOD.oak });
//   B.build(group, 'cottage');                    // one mesh per (material, shadow)
//
// Conventions: Y up, things face +Z, φ (phi) is an azimuth around Y with
// φ = 0 → +Z and φ = π/2 → +X (x = sin φ · r, z = cos φ · r).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { materials, END_GRAIN_V, sharedUniforms } from '../../core/materials.js';
import { createNoise2D } from '../../core/noise.js';
import { requestBake } from '../../core/textures/bakery.js';
import { mushroomGlowMaterials } from '../../world/vegetation/mushrooms.js';
// (a leaf module: it imports only core/ and world/layout.js — no cycle through props/index.js)
import { LAMP_GLSL, lampUniforms } from '../../props/lamplighter.js';

export const TAU = Math.PI * 2;

/**
 * Detail of the many small parts (stones, moss cushions, toadstools, fern fronds, fairy-light
 * bulbs …): 1 at the high tier, ≈ 0.5 medium, 0.35 low. The cottage sets it once before it
 * builds (setCottageDetail(ctx.quality.density)); it only ever changes tessellation, never
 * the random draws, so placement stays the same on every tier.
 */
export const KIT = { detail: 1 };
export function setCottageDetail(d = 1) {
  KIT.detail = Math.min(1, Math.max(0.35, d));
}
export const noiseA = createNoise2D(41117);
export const noiseB = createNoise2D(9029);

// ─── colours ─────────────────────────────────────────────────────────────────
/** Average colours (sRGB) of the wood species — the vertex colour on the shared wood material. */
export const WOOD = {
  oak: '#a8845a',
  oakLight: '#c29d6c',
  walnut: '#5e4433',
  spruce: '#cbb088',
  cherry: '#985c40',
  weathered: '#8a7766',
  grey: '#9a8f82',
  dark: '#4a3628',
  door: '#7a5236',
};
export const IRON = '#3a3530';

// ─── materials ───────────────────────────────────────────────────────────────
let M = null;
/**
 * The cottage's shared materials (all cached in core/materials.js — never mutate).
 * Vertex-coloured kinds take their hue from Batch.add(…, { color }).
 */
export function mats() {
  if (M) return M;
  const m = materials;
  M = {
    cap: velvetCap(m.surface('mushroomCap', { color: '#ffffff', vertexColors: true, roughness: 2.1 })),
    // the cream warts on the caps: domed, torn veil flakes with a warm lift by day, shaded
    // cream cushions at night — see creamWarts()
    warts: creamWarts(mushroomGlowMaterials({ materials: m }).warts),
    // the cottage's own caps & warts after bakeBulbGlow: the same, plus the fairy lights'
    // night warmth from their baked 'capGlow' attribute (other builders keep cap / warts,
    // whose shaders never read it)
    capLit: null,
    wartsLit: null,
    // window panes: lamp-lit glass with a warm gradient in the vertex colours (see paneGlow)
    pane: paneGlow(),
    // the Wohnatelier's window seen from inside: daylight by day, dark blue at night
    daylight: daylightPane(),
    gills: bounceGills(m.surface('gills', { gills: 'cone', side: THREE.DoubleSide, vertexColors: true })),
    stem: m.surface('mushroomStem', { vertexColors: true }),
    plaster: m.surface('plaster', { vertexColors: true }),
    limewash: limewash(m.surface('plaster', { vertexColors: true })),
    paperLamp: paperLantern(),
    wallStone: m.surface('stone', { vertexColors: true, mossy: 0.3 }),
    stone: m.surface('rock', { vertexColors: true, scale: 0.5, mossy: 0.1 }),
    wood: m.surface('wood', { species: 'oak', vertexColors: true }),
    // oak floorboards (vertex-coloured: the floor's tone is chosen where it is laid)
    floor: m.surface('wood', { species: 'oak', planks: true, vertexColors: true }),
    metal: m.surface('metal', { vertexColors: true }),
    fabric: m.surface('fabric', { vertexColors: true }),
    // a NEUTRAL weave for the Wohnatelier's textiles: the plain vertex-coloured fabric keeps the
    // kind's default beige in its normalised texture (an orange cast: a sage sofa rendered olive,
    // ink turned slate) — with a white base the vertex colour alone sets the hue
    textile: warmTextile(m.surface('fabric', { vertexColors: true, color: '#ffffff' })),
    clay: m.surface('clay', { vertexColors: true }),
    paper: null, // → vc (books & prints: the paper texture is invisible at this size)
    moss: m.surface('moss'),
    soil: m.surface('soil'),
    leafy: m.surface('leaf', { vertexColors: true, side: THREE.DoubleSide }),
    glass: m.surface('glass', { side: THREE.DoubleSide }),
    vc: m.standard('#ffffff', { vertexColors: true, roughness: 0.75 }),
    glossy: null, // → clay (glazed ceramics)
    glow: m.glow('#ffc477', { day: 0.5, night: 1.35 }),
    lamp: m.glow('#ffd9a0', { day: 0.9, night: 1.6 }),
    // the Wohnatelier's lamp shades (linen drum, mushroom-lamp dome): soft by day — the lamp
    // glass's day glow clipped them to white — bright at night
    shade: m.glow('#ffd6a0', { day: 0.22, night: 1.6 }),
    bulb: null, // → glow
    ivy: m.foliage({ variant: 'ivy', wind: { strength: 0.006, base: 0, speed: 1.3 } }),
    fern: m.foliage({ variant: 'fern', wind: { strength: 0.03, base: 0, speed: 1.5 } }),
    grass: m.foliage({ variant: 'grass', wind: { strength: 0.04, base: 0, speed: 1.7 } }),
  };
  M.capLit = velvetCap(m.surface('mushroomCap', { color: '#ffffff', vertexColors: true, roughness: 2.1 }), { bulbs: true });
  M.wartsLit = creamWarts(mushroomGlowMaterials({ materials: m }).warts, { bulbs: true });
  // aliases keep the material count (= draw calls) down
  M.paper = M.vc;
  M.glossy = M.clay;
  M.bulb = M.glow;
  return M;
}

/**
 * Gill undersides only ever see the cool sky/ground fill (the cap shades them
 * from the sun), so they read grey. Painters add the warm light bouncing off
 * the sunlit ground: this clone (never the cached original) adds an emissive
 * "bounce" term proportional to the gill albedo — warm, but the lamellae
 * texture & vertex shading stay readable. Its strength follows day/night
 * through setCottageNight().
 */
const GILL_BOUNCE = { color: '#ffb064', day: 0.4, night: 0.24 };
let gillMat = null;
function bounceGills(base) {
  const g = base.clone();
  g.name = 'cottage-gills';
  g.emissive = new THREE.Color(GILL_BOUNCE.color);
  g.emissiveIntensity = GILL_BOUNCE.day;
  const patch = g.onBeforeCompile;
  g.onBeforeCompile = (shader, renderer) => {
    patch(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= diffuseColor.rgb; // bounce light: tinted by the albedo'
    );
  };
  const key = g.customProgramCacheKey();
  g.customProgramCacheKey = () => key + '|gill-bounce';
  gillMat = g;
  return g;
}

/**
 * The caps' warts: torn cream veil flakes. In the cap's shade a plain standard
 * material would read khaki-grey, so this clone (never the cached original) is
 * white with the true cream (and a per-flake tone) in the vertex colours, plus
 * a faint warm-white "subsurface" lift by day. At night each flake reads as a
 * soft cream cushion under the moon — never a flat chalk chip, never an LED:
 * a cream emissive (≈ half value) SHADED by the flake's own facing to the key
 * light (the moon side of the dome lighter, the underside darker; ctx.lights.keyDir
 * via setCottageKeyDir), scaled by the flake's vertex tone, and warming to amber
 * where a fairy-light bulb hangs close (the baked 'capGlow' attribute, see
 * bakeBulbGlow). The warm cream carries enough chroma that the night grade's moon
 * tint and Purkinje shift (which spare warm hues) leave it cream.
 */
const WART_GLOW = { day: '#fff1d8', dayI: 0.06, cream: '#f4d3a2', amber: '#ffae62', nightI: 0.3 }; // (a warm cream: the night grade's moon tint turned a paler one grey)
const wartMats = [];
const wartUniforms = {
  uWartNight: { value: 0 },
  uWartNightI: { value: WART_GLOW.nightI },
  uWartCream: { value: new THREE.Color(WART_GLOW.cream) },
  uWartAmber: { value: new THREE.Color(WART_GLOW.amber) },
  /** world direction towards the key light (sun by day, moon by night) */
  uWartKey: { value: new THREE.Vector3(-0.4, 0.75, 0.5).normalize() },
};
/** Vertex part of the fairy-light warmth (caps & warts): the baked bulb proximity and the world position. */
function bulbVertex(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float capGlow;\nvarying float vCapGlow;\nvarying vec3 vCapWP;')
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
  vCapGlow = capGlow;
  vCapWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`
    );
}
function creamWarts(base, { bulbs = false } = {}) {
  const w = base.clone();
  w.name = bulbs ? 'cottage-warts' : 'cottage-warts-shared';
  w.color.set('#ffffff');
  w.emissive = new THREE.Color(WART_GLOW.day);
  w.emissiveIntensity = WART_GLOW.dayI;
  if (bulbs) w.defines = { ...(w.defines ?? {}), COTTAGE_BULBS: '' };
  const patch = w.onBeforeCompile;
  w.onBeforeCompile = (shader, renderer) => {
    patch?.(shader, renderer);
    Object.assign(shader.uniforms, wartUniforms, lampUniforms, { uNight: sharedUniforms.uNight });
    if (bulbs) bulbVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform float uWartNight, uWartNightI, uNight;
uniform vec3 uWartCream, uWartAmber, uWartKey;
#ifdef COTTAGE_BULBS
varying float vCapGlow;
varying vec3 vCapWP;
#endif
${LAMP_GLSL}
void main() {`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  {
    // by day a soft even lift; at night a cream cushion shaded by its facing to the moon
    // (lighter on the moon side, darker underneath), warming to amber by the fairy lights
    float wTone = dot(vColor.rgb, vec3(0.3, 0.5, 0.2));
    vec3 wKey = normalize((viewMatrix * vec4(uWartKey, 0.0)).xyz);
    vec3 wUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    float wNL = dot(normal, wKey);
    float wSh = 0.3 + 0.55 * smoothstep(-0.4, 0.85, wNL) + 0.15 * smoothstep(-0.2, 0.9, dot(normal, wUp));
#ifdef COTTAGE_BULBS
    float wB = clamp(vCapGlow, 0.0, 1.0) * uNight * lampOn(vCapWP, 0.0);
#else
    float wB = 0.0;
#endif
    vec3 wE = mix(uWartCream * wSh, uWartAmber * (0.6 + 0.7 * wSh), min(1.0, wB * 1.2)) * wTone * uWartNightI;
    wE += uWartAmber * wB * wTone * 0.3;
    totalEmissiveRadiance = mix(totalEmissiveRadiance, wE, uWartNight);
  }`
      );
  };
  const key = w.customProgramCacheKey();
  w.customProgramCacheKey = () => key + (bulbs ? '|cottage-warts2-lit' : '|cottage-warts2');
  wartMats.push(w);
  return w;
}
/** The warts' night shading follows the live key-light direction (ctx.lights.keyDir: pass the Vector3 itself). */
export function setCottageKeyDir(v) {
  if (v?.isVector3) wartUniforms.uWartKey.value = v;
}

/**
 * The caps' skin: matte, velvety and painterly — like the painted references,
 * never a lacquered lampshade. The texture's roughness is raised and floored
 * at 0.88 (no highlight band), the sun's sheen and the sky reflection are
 * nearly gone, the soft velvet rim brightening is kept faint, and the shader
 * adds what vertex colours cannot carry: fine radial fibrils running from the
 * rim towards the crown (two octaves, low in contrast, faded out where they
 * would get sub-pixel) and a chalky, desaturated velvet bloom at grazing
 * angles, like the bloom on a fresh fly agaric. The mottled hue (crimson rim →
 * orange crown, blotches, crimson-brown clouds) is painted into the vertex
 * colours by the builder.
 * At night the fairy-light strands warm the skin next to each bulb: a baked
 * per-vertex bulb proximity ('capGlow', bakeBulbGlow) drives a soft warm
 * emissive patch — the light the bulb throws on the velvet, tinted by it —
 * lit in the lamplighter's cascade. Geometry without the attribute reads 0.
 * Cap UVs: U = around (× 2), V = 0 at the rim → 1 at the apex.
 */
const CAP_GLOW = { color: '#ffb36b', k: 0.4, base: 0.045 };
const capUniforms = { uCapGlowK: { value: CAP_GLOW.k }, uCapGlowC: { value: new THREE.Color(CAP_GLOW.color) }, uCapNightBase: { value: CAP_GLOW.base } };
function velvetCap(base, { bulbs = false } = {}) {
  const c = base.clone();
  c.name = bulbs ? 'cottage-cap' : 'cottage-cap-shared';
  const u = materials.surfaceUniforms(c);
  if (u?.sfQ) u.sfQ.value.z = 0.16; // a faint velvet rim (the kind's default is 0.35): matte, not a sheen
  if (bulbs) c.defines = { ...(c.defines ?? {}), COTTAGE_BULBS: '' };
  const patch = c.onBeforeCompile;
  c.onBeforeCompile = (shader, renderer) => {
    patch?.(shader, renderer);
    Object.assign(shader.uniforms, capUniforms, lampUniforms, { uNight: sharedUniforms.uNight });
    if (bulbs) bulbVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform float uCapGlowK, uNight, uCapNightBase;\nuniform vec3 uCapGlowC;\n#ifdef COTTAGE_BULBS\nvarying float vCapGlow;\nvarying vec3 vCapWP;\n#endif\n${LAMP_GLSL}\nvoid main() {`)
      // the texture's fine fibril streaks at half their contrast (with the shader's own
      // streaks below they read as brushed metal under a highlight)
      .replace('vec3 sfCol = mix(sfColA, sfColB, sfA.r) * (sfA.g * 2.0);', 'vec3 sfCol = mix(sfColA, sfColB, sfA.r) * (1.0 + (sfA.g * 2.0 - 1.0) * 0.45);')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  // matte suede: never a glossy highlight band
  roughnessFactor = max(roughnessFactor, 0.88);
#if defined(USE_UV) && !defined(SF_TRIPLANAR)
  {
    float cA = vUv.x * 3.14159265;                         // around (seam-free on a circle)
    vec2 cR = vec2(cos(cA), sin(cA));
    float cV = clamp(vUv.y, 0.0, 1.0);
    // fine fibrils (≈ 400 around) and coarser brush streaks (≈ 120 around), long along V
    vec3 q1 = vec3(cR * 64.0, cV * 2.6);
    vec3 q2 = vec3(cR * 19.0, cV * 1.4 + 7.3);
    float w1 = fwidth(q1.x) + fwidth(q1.y);
    float w2 = fwidth(q2.x) + fwidth(q2.y);
    float f1 = (1.0 - smoothstep(0.5, 1.4, w1)) * smoothstep(0.02, 0.2, cV);
    float f2 = 1.0 - smoothstep(0.6, 1.6, w2);
    float s1 = sfNoise3(q1 + vec3(0.0, 0.0, 1.7 * sfNoise3(q2 * 0.5)));
    float s2 = sfNoise3(q2);
    // (soft and low in contrast: strong long streaks read as a lacquered lampshade)
    float streak = (smoothstep(0.55, 0.88, s1) * 0.05 - smoothstep(0.4, 0.1, s1) * 0.02) * f1
                 + (smoothstep(0.5, 0.9, s2) * 0.05 - smoothstep(0.45, 0.12, s2) * 0.025) * f2;
    diffuseColor.rgb *= 1.0 - streak;
    // velvet bloom: chalky and a little desaturated where the skin turns away
    float cF = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 3.0);
    float cL = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(cL) * vec3(1.5, 1.25, 1.15) + diffuseColor.rgb * 0.25, cF * 0.22);
  }
#endif
  // night: a whisper of the cap's own red (the glen's warm air) so the velvet away from the
  // lights reads deep red, never a maroon-black hole
  totalEmissiveRadiance += diffuseColor.rgb * uCapNightBase * uNight;
#ifdef COTTAGE_BULBS
  {
    // the fairy lights warm the velvet beside each bulb (night, in the lamplighter's cascade)
    // (soft saturation: where several bulbs overlap the patch glows a little more, never a hot band)
    float cg = (1.0 - exp(-1.3 * max(vCapGlow, 0.0))) * uNight * lampOn(vCapWP, 0.0);
    totalEmissiveRadiance += cg * uCapGlowK * uCapGlowC * (diffuseColor.rgb * 1.5 + vec3(0.07, 0.035, 0.009));
  }
#endif`
      )
      // matte, not satin: a cap's skin is fibrous suede — the broad sky reflection and the
      // sun's sheen are all but gone
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
  reflectedLight.directSpecular *= 0.12;
  reflectedLight.indirectSpecular *= 0.2;`
      );
  };
  const key = c.customProgramCacheKey();
  c.customProgramCacheKey = () => key + (bulbs ? '|cottage-cap3-lit' : '|cottage-cap3');
  return c;
}

/** Fairy-light bulbs (world / batch space) collected by stringLights (garden.js) for bakeBulbGlow. */
export const FAIRY_BULBS = [];

/** A spatial hash of bulb positions ({x, y, z}) with cell size `reach`. */
function bulbGrid(bulbs, reach) {
  const grid = new Map();
  for (const b of bulbs) {
    const k = `${Math.floor(b.x / reach)},${Math.floor(b.y / reach)},${Math.floor(b.z / reach)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(b);
  }
  return grid;
}

/**
 * Give `geo` (positions in the same space as the bulbs) the float 'capGlow' attribute the
 * cap & wart materials turn into the fairy lights' night warmth: Σ (1 − d / reach)² over the
 * bulbs within `reach`, capped. (Other builders that want it — e.g. the Velowerkstatt — call it on
 * their cap geometry with their own bulb positions and draw that with mats().capLit / wartsLit.)
 * Returns the number of lit vertices.
 */
export function bulbGlowAttribute(geo, bulbs, { reach = 0.62, grid = null } = {}) {
  const P = geo.attributes.position;
  const a = new Float32Array(P.count);
  let lit = 0;
  if (bulbs.length) {
    const g = grid ?? bulbGrid(bulbs, reach);
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const ix = Math.floor(x / reach), iy = Math.floor(y / reach), iz = Math.floor(z / reach);
      let sum = 0;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const list = g.get(`${ix + dx},${iy + dy},${iz + dz}`);
            if (!list) continue;
            for (const b of list) {
              const d = Math.hypot(x - b.x, y - b.y, z - b.z);
              if (d < reach) sum += (1 - d / reach) ** 2;
            }
          }
      a[i] = Math.min(1.4, sum);
      if (sum > 0) lit++;
    }
  }
  geo.setAttribute('capGlow', new THREE.BufferAttribute(a, 1));
  return lit;
}

/**
 * Bake the fairy lights' warmth into the caps (and their warts): every cap & wart geometry in
 * batch B gets the 'capGlow' attribute (bulbGlowAttribute) — all of them, so they still merge —
 * and moves to the lit material variants (capLit / wartsLit) whose shaders read it. Call after
 * everything is added, before B.build(). (Other batches keep the shared cap / warts materials,
 * which never read the attribute.)
 */
export function bakeBulbGlow(B, bulbs, { reach = 0.62 } = {}) {
  const M2 = mats();
  // cap → capLit, warts → wartsLit: the batch's caps & warts move to the variants that read the attribute
  const swap = new Map([[M2.cap, M2.capLit], [M2.warts, M2.wartsLit], [M2.capLit, M2.capLit], [M2.wartsLit, M2.wartsLit]]);
  const grid = bulbGrid(bulbs, reach);
  let lit = 0;
  for (const e of B.lists.values()) {
    const to = swap.get(e.material);
    if (!to) continue;
    e.material = to;
    for (const g of e.geos) lit += bulbGlowAttribute(g, bulbs, { reach, grid });
  }
  return lit;
}

/**
 * Lamp-lit window glass: the emissive is tinted by the vertex colours, so each
 * pane carries a warm gradient (bright honey low in the middle where the lamp
 * stands, deeper amber towards the top and the frame) instead of a flat
 * emissive sheet. Follows day/night through setCottageNight().
 */
const PANE_GLOW = { day: 0.5, night: 1.35 };
let paneMat = null;
function paneGlow() {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: PANE_GLOW.day, roughness: 0.9, vertexColors: true });
  m.name = 'cottage-pane';
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor.rgb;');
  };
  m.customProgramCacheKey = () => 'cottage-pane';
  paneMat = m;
  return m;
}

/**
 * Glass seen from INSIDE a room (the Wohnatelier's arched window): bright
 * daylight by day (sky above, sunlit foliage below, from the vertex colours),
 * nearly dark at night.
 */
const DAYLIGHT = { day: 1.0, night: 0.06 };
let daylightMat = null;
function daylightPane() {
  const m = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, toneMapped: true });
  m.name = 'cottage-daylight';
  m.color.setScalar(DAYLIGHT.day);
  daylightMat = m;
  return m;
}

/**
 * Interior limewash (Wohnatelier): the plaster surface material re-pointed at
 * its own GPU bake — soft cloudy mottling of several brushed coats in warm
 * off-white, faint overlapping trowel sweeps with a gentle burnished sheen and
 * NO cracks or fallen-off patches (the exterior plaster keeps its weathering).
 * Same shader program as the plaster (a clone with its own maps), so it costs
 * no extra compile.
 */
const LIMEWASH_GLSL = /* glsl */ `
Surf kind_cottageLimewash(vec2 uv) {
  float m1 = fbmu(uv, 2.0, 5);
  float m2 = fbmu(uv + vec2(0.37, 0.11), 5.0, 4);
  float m3 = fbmu(uv + vec2(0.71, 0.53), 11.0, 3);
  vec3 col = C(0xece1ca);
  col = mix(col, C(0xe0d1b2), sat(m1 * 0.9 + 0.05) * 0.75);   // cloudy darker coats
  col = mix(col, C(0xf7f1e3), sat(-m2 * 1.3) * 0.7);          // thin, bright wash
  col = mix(col, C(0xe7dac0), sat(m3 * 1.2) * 0.3);           // fine brush mottle
  // broad trowel sweeps: softly overlapping laps, burnished (smoother) in the middle
  vec2 w = vec2(fbmu(uv, 3.0, 2), fbmu(uv + vec2(0.5), 3.0, 2)) * 0.09;
  vec4 tv = voronoi((uv + w) * 3.0, vec2(3.0), 1.0);
  float lap = 1.0 - smoothstep(0.0, 0.1, tv.y);
  float burnish = smoothstep(0.08, 0.38, tv.y) * (0.6 + 0.4 * tv.z);
  float sweep = gnoise(rot2(uv * 3.0, tv.z * 6.28) * vec2(2.0, 22.0), vec2(1000.0));
  col *= 1.0 - 0.025 * lap + 0.012 * sweep;
  float h = 0.6 + 0.025 * m1 + 0.02 * lap + 0.006 * sweep + 0.003 * gnoise(uv * 140.0, vec2(140.0));
  float rough = 0.74 - 0.2 * burnish + 0.04 * m3;
  return surf(col, h, rough, 1.0);
}`;
function limewash(base) {
  const c = base.clone();
  c.name = 'cottage-limewash';
  const u = materials.surfaceUniforms(c);
  const maps = requestBake('surface:cottage-limewash', {
    glslKey: 'cottage-limewash',
    glsl: LIMEWASH_GLSL,
    fn: 'kind_cottageLimewash',
    mode: 'rgb',
    size: [512, 512],
    bump: 0.004,
    cavity: 1,
    mean: '#ebdfc5',
    seed: 0,
  });
  if (u?.sfMap && u?.sfDetail) {
    u.sfMap.value = maps.map;
    u.sfDetail.value = maps.detail;
    u.sfP.value.w *= 0.5; // calmer painterly breakup: the bake already carries the mottling
  }
  // the room sits deep in the cap's shade, lit by cool sky fill; its lamps and the oak floor
  // bounce warm light onto the pale walls — a small albedo-tinted warm term keeps the
  // limewash reading as warm off-white instead of grey (follows day/night, setCottageNight)
  c.emissive = new THREE.Color(LIME_BOUNCE.color);
  c.emissiveIntensity = LIME_BOUNCE.day;
  const patch = c.onBeforeCompile;
  c.onBeforeCompile = (shader, renderer) => {
    patch(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= diffuseColor.rgb; // warm bounce, tinted by the albedo'
    );
  };
  const key = c.customProgramCacheKey();
  c.customProgramCacheKey = () => key + '|lime-bounce';
  limeMat = c;
  return c;
}
const LIME_BOUNCE = { color: '#ffcf9a', day: 0.2, night: 0.32 };
let limeMat = null;

/**
 * Rice-paper lantern (the Wohnatelier's globe pendant): warm amber, glowing
 * through the paper — a little brighter towards the silhouette than in the
 * middle (the light crosses more paper there) and dimmer along the wire ribs
 * (painted into the vertex colours). Its emissive follows day/night through
 * setCottageNight().
 */
const PAPER_LAMP = { color: '#ffc98a', day: 0.54, night: 0.86 };
let paperMat = null;
function paperLantern() {
  const c = new THREE.Color(PAPER_LAMP.color);
  const m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: PAPER_LAMP.day, roughness: 0.92, vertexColors: true });
  m.name = 'cottage-paper-lamp';
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
  float paperRim = 1.0 - abs(dot(normal, normalize(vViewPosition)));
  totalEmissiveRadiance *= vColor.rgb * (0.72 + 0.62 * paperRim * paperRim);`
    );
  };
  m.customProgramCacheKey = () => 'cottage-paper-lamp';
  paperMat = m;
  return m;
}

/**
 * The Wohnatelier's textiles (sofa, rug, cushions, curtain, throws): at night the room's lamps
 * bounce a little warm light about — a small albedo-tinted warm term keeps the sage sofa
 * reading sage (not a moonlit teal-grey) and the cognac warm. Gone by day.
 */
const TEXTILE_BOUNCE = { color: '#ffc890', day: 0.0, night: 0.34 };
let textileMat = null;
function warmTextile(base) {
  const c = base.clone();
  c.name = 'cottage-textile';
  c.emissive = new THREE.Color(TEXTILE_BOUNCE.color);
  c.emissiveIntensity = TEXTILE_BOUNCE.day;
  const patch = c.onBeforeCompile;
  c.onBeforeCompile = (shader, renderer) => {
    patch(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= diffuseColor.rgb; // warm lamp bounce, tinted by the albedo'
    );
  };
  const key = c.customProgramCacheKey();
  c.customProgramCacheKey = () => key + '|textile-bounce';
  textileMat = c;
  return c;
}

/**
 * Pools of lamplight at night (the Wohnatelier's lamps on the chair, table and wall): the
 * additive, unlit feathered patches of lightSpillGeo, but the other way round — gone by day,
 * full at night (follows setCottageNight).
 */
const LAMP_POOL = { day: 0.0, night: 1.0 };
let lampPoolMat = null;
export function lampPoolMaterial() {
  if (lampPoolMat) return lampPoolMat;
  lampPoolMat = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: true,
    fog: false,
    opacity: LAMP_POOL.day,
  });
  lampPoolMat.name = 'cottage-lamp-pool';
  return lampPoolMat;
}

/** Ease the cottage's own day/night-dependent material terms (call every frame; cheap). */
export function setCottageNight(night) {
  if (textileMat) textileMat.emissiveIntensity = TEXTILE_BOUNCE.day + (TEXTILE_BOUNCE.night - TEXTILE_BOUNCE.day) * night;
  if (lampPoolMat) {
    lampPoolMat.opacity = LAMP_POOL.day + (LAMP_POOL.night - LAMP_POOL.day) * night;
    lampPoolMat.visible = lampPoolMat.opacity > 0.003;
  }
  if (gillMat) gillMat.emissiveIntensity = GILL_BOUNCE.day + (GILL_BOUNCE.night - GILL_BOUNCE.day) * night;
  if (paperMat) paperMat.emissiveIntensity = PAPER_LAMP.day + (PAPER_LAMP.night - PAPER_LAMP.day) * night;
  if (limeMat) limeMat.emissiveIntensity = LIME_BOUNCE.day + (LIME_BOUNCE.night - LIME_BOUNCE.day) * night;
  if (paneMat) paneMat.emissiveIntensity = PANE_GLOW.day + (PANE_GLOW.night - PANE_GLOW.day) * night;
  if (daylightMat) daylightMat.color.setScalar(DAYLIGHT.day + (DAYLIGHT.night - DAYLIGHT.day) * night);
  if (lightSpillMat) lightSpillMat.opacity = LIGHT_SPILL.day + (LIGHT_SPILL.night - LIGHT_SPILL.day) * night;
  if (wartMats.length) wartUniforms.uWartNight.value = THREE.MathUtils.smoothstep(night, 0.1, 0.85);
}

/**
 * A soft patch of daylight falling through a window onto the floor / furniture:
 * an additive, unlit quad with a feathered falloff (RGBA vertex colours on a
 * small grid; alpha = brightness). One shared material whose strength follows
 * day/night (gone at night). geo: from lightSpillGeo().
 */
const LIGHT_SPILL = { day: 1.0, night: 0.0 };
let lightSpillMat = null;
export function lightSpillMaterial() {
  if (lightSpillMat) return lightSpillMat;
  lightSpillMat = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: true,
    fog: false,
  });
  lightSpillMat.name = 'cottage-light-spill';
  return lightSpillMat;
}
/**
 * A feathered quad w × h in the XY plane (centred): an elliptical soft patch,
 * colour `color` at peak strength `peak`, `tilt` (−1..1) brightening one end
 * along Y (the end nearest the window).
 */
export function lightSpillGeo(w, h, { color = '#fff1d6', peak = 0.3, tilt = 0, n = 8 } = {}) {
  const g = new THREE.PlaneGeometry(w, h, n, n);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 4);
  const c = new THREE.Color(color);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (w / 2), y = pos.getY(i) / (h / 2);
    const d = Math.min(1, Math.hypot(x, y));
    const a = peak * (1 - d * d * (3 - 2 * d)) * Math.max(0, 1 + tilt * y * 0.6);
    col.set([c.r, c.g, c.b, a], i * 4); // additive: src.rgb × src.a
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return g;
}

// ─── batching ────────────────────────────────────────────────────────────────
const _c = new THREE.Color();

/** Fill a geometry's colour attribute with one colour (sRGB hex → linear). */
export function paint(geo, color) {
  _c.set(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Per-vertex colour from fn(x, y, z, i, outColor) — outColor starts as `base`. */
export function paintFn(geo, base, fn) {
  const pos = geo.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  const b = new THREE.Color(base);
  for (let i = 0; i < pos.count; i++) {
    _c.copy(b);
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), i, _c);
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Make a geometry mergeable: indexed, normal + uv (+ colour), no groups/morphs. */
export function prepare(geo, withColor) {
  if (geo.index === null) {
    const n = geo.attributes.position.count;
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  for (const name of Object.keys(geo.attributes)) {
    if (name === 'position' || name === 'normal' || name === 'uv') continue;
    if (name === 'color' && withColor) continue;
    geo.deleteAttribute(name);
  }
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  if (withColor && !geo.attributes.color) paint(geo, '#ffffff');
  geo.morphAttributes = {};
  geo.clearGroups();
  return geo;
}

/** Collects geometry per material and merges it into one mesh per (material, shadow) pair. */
export class Batch {
  constructor() {
    this.lists = new Map();
    this.tris = 0;
  }
  /** Add a geometry (consumed). opts: { cast = true, receive = true, color (vertex-coloured materials) } */
  add(material, geo, opts = {}) {
    const cast = opts.cast ?? true;
    const receive = opts.receive ?? true;
    const vc = !!material.vertexColors;
    if (vc && opts.color !== undefined && opts.color !== null) paint(geo, opts.color);
    prepare(geo, vc);
    const key = `${material.uuid}|${cast ? 1 : 0}|${receive ? 1 : 0}`;
    let e = this.lists.get(key);
    if (!e) {
      e = { material, cast, receive, geos: [] };
      this.lists.set(key, e);
    }
    e.geos.push(geo);
    return geo;
  }
  /** A view of this batch that applies `matrix` to every added geometry. */
  at(matrix) {
    const parent = this;
    const m = matrix.clone();
    return {
      matrix: m,
      add(material, geo, opts = {}) {
        geo.applyMatrix4(m);
        return parent.add(material, geo, opts);
      },
      at(child) {
        return parent.at(m.clone().multiply(child));
      },
      batch: parent,
    };
  }
  /**
   * Merge everything into meshes added to `parent`. Returns the meshes.
   * opts.mergeShadow: one mesh per material (casting) — for small hotspot pieces.
   * Otherwise a material's casting and non-casting parts are still merged when
   * one side is small (fewer draw calls); the merged mesh casts only when its
   * casting part is a substantial share (a few missing tiny shadows are
   * invisible, while every caster mesh costs a shadow-pass draw and all its
   * triangles).
   */
  build(parent, name = 'batch', { mergeShadow = false, smallTris = 16000 } = {}) {
    const triCount = (e) => e.geos.reduce((n, g) => n + (g.index ? g.index.count : g.attributes.position.count) / 3, 0);
    const byMat = new Map();
    for (const e of this.lists.values()) {
      const k = e.material.uuid;
      if (!byMat.has(k)) byMat.set(k, []);
      byMat.get(k).push(e);
    }
    const lists = [];
    for (const group of byMat.values()) {
      if (group.length === 1) {
        lists.push(mergeShadow ? { ...group[0], cast: true } : group[0]);
        continue;
      }
      const castE = group.filter((e) => e.cast);
      const noE = group.filter((e) => !e.cast);
      const cT = castE.reduce((n, e) => n + triCount(e), 0);
      const nT = noE.reduce((n, e) => n + triCount(e), 0);
      const all = { material: group[0].material, receive: true, geos: group.flatMap((e) => e.geos) };
      if (mergeShadow) lists.push({ ...all, cast: true });
      else if (nT < smallTris || cT < 2500) lists.push({ ...all, cast: cT >= 0.35 * nT });
      else lists.push(...group);
    }
    const out = [];
    for (const e of lists) {
      const g = e.geos.length === 1 ? e.geos[0] : mergeGeometries(e.geos, false);
      if (!g) {
        console.warn(`[cottage] merge failed for ${e.material.name}`);
        continue;
      }
      if (e.geos.length > 1) e.geos.forEach((x) => x.dispose());
      g.computeBoundingSphere();
      g.computeBoundingBox();
      this.tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      const mesh = new THREE.Mesh(g, e.material);
      mesh.name = `${name}:${e.material.name || 'mat'}`;
      mesh.castShadow = e.cast;
      mesh.receiveShadow = e.receive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      out.push(mesh);
    }
    this.lists.clear();
    return out;
  }
}

/** The identity frame — handy default for Batch.at(). */
export const IDENTITY = new THREE.Matrix4();

/**
 * A frame that discards what is added to it. Tier thinning routes the dropped items here, so
 * they still make their random draws and everything placed after them stays where it is on
 * every quality tier.
 */
export const SINK = {
  matrix: IDENTITY,
  add(material, geo) {
    return geo;
  },
  at() {
    return SINK;
  },
};

// ─── transforms ──────────────────────────────────────────────────────────────
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Matrix from position [x,y,z], Euler rotation [rx,ry,rz(,order)] and scale (number | [sx,sy,sz]). */
export function mat4(p = null, r = null, s = null, target = new THREE.Matrix4()) {
  _p.set(0, 0, 0);
  if (p) _p.set(p[0], p[1], p[2]);
  _e.set(0, 0, 0, 'XYZ');
  if (r) _e.set(r[0], r[1], r[2], r[3] || 'XYZ');
  _q.setFromEuler(_e);
  if (s == null) _s.set(1, 1, 1);
  else if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  return target.compose(_p, _q, _s);
}

/** Bake a transform into a geometry (in place). */
export function xf(geo, p = null, r = null, s = null) {
  geo.applyMatrix4(mat4(p, r, s, _m));
  return geo;
}

/** Displace every vertex: fn(v: Vector3, i) mutates v. Recomputes normals unless keepNormals. */
const _v = new THREE.Vector3();
export function deform(geo, fn, keepNormals = false) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    fn(_v, i);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  pos.needsUpdate = true;
  if (!keepNormals) geo.computeVertexNormals();
  return geo;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
/** Orient a geometry built along +X so it runs from a to b, centred between them (its +Y stays close to `up`). */
export function alongX(geo, a, b, up = [0, 1, 0]) {
  _a.set(a[0], a[1], a[2]);
  _b.set(b[0], b[1], b[2]);
  _x.subVectors(_b, _a).normalize();
  _y.set(up[0], up[1], up[2]);
  _z.crossVectors(_x, _y);
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).cross(_x);
  _z.normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  _m.setPosition(_a.lerp(_b, 0.5));
  geo.applyMatrix4(_m);
  return geo;
}

/** A frame matrix whose +Z is `normal` (horizontal-ish), +Y close to world up, origin at `pos`. */
export function frameAt(pos, normal, target = new THREE.Matrix4()) {
  _z.set(normal.x, normal.y, normal.z).normalize();
  _x.set(0, 1, 0).cross(_z);
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
  _x.normalize();
  _y.crossVectors(_z, _x).normalize();
  target.makeBasis(_x, _y, _z);
  target.setPosition(pos.x, pos.y, pos.z);
  return target;
}

// ─── UVs ─────────────────────────────────────────────────────────────────────
const AX = { x: 0, y: 1, z: 2 };
/**
 * Planar "box" UVs in the part's own space × scale, so a texture keeps the
 * same density on every part. U (wood grain) runs along `along`. Faces that cut
 * ACROSS the grain (normal along `along`: board ends, a round table top's edge
 * at its grain ends) get the END_GRAIN_V marker on V, so the wood surfaces draw
 * them as end grain (Hirnholz); every other surface() kind strips it again.
 */
export function uvBox(geo, along = 'x', scale = 1 / 1.4, off = [0, 0]) {
  const pos = geo.attributes.position;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nor = geo.attributes.normal;
  const A = AX[along];
  const uv = new Float32Array(pos.count * 2);
  const p = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    p[0] = pos.getX(i);
    p[1] = pos.getY(i);
    p[2] = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let dom = 0;
    if (ny > nx && ny >= nz) dom = 1;
    else if (nz > nx && nz > ny) dom = 2;
    let u, v, end = 0;
    if (dom === A) {
      u = p[(A + 1) % 3];
      v = p[(A + 2) % 3];
      end = END_GRAIN_V;
    } else {
      u = p[A];
      v = p[3 - A - dom];
    }
    uv[i * 2] = u * scale + off[0];
    uv[i * 2 + 1] = v * scale + off[1] + end;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Planar UVs from two axes (e.g. a flat panel facing +Z: 'x','y'). */
export function uvPlanar(geo, ua = 'x', va = 'y', scale = 1, off = [0, 0]) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const U = AX[ua], V = AX[va];
  const p = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    p[0] = pos.getX(i);
    p[1] = pos.getY(i);
    p[2] = pos.getZ(i);
    uv[i * 2] = p[U] * scale + off[0];
    uv[i * 2 + 1] = p[V] * scale + off[1];
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// ─── parametric surfaces ─────────────────────────────────────────────────────
/**
 * A grid surface P(u, v) for u, v ∈ [0, 1] (fn writes into its Vector3 out).
 * Winding: the outward normal is dP/dv × dP/du — for a surface of revolution
 * with u = φ (x = sin φ·r, z = cos φ·r) that means v runs from the top / inner
 * end towards the bottom / outer end. opts:
 *   uv(u, v, p) → [U, V]   (default [u, v])
 *   closedU                weld the shading across the u = 0 / 1 seam
 *   flip                   reverse the winding
 * Rows that collapse to a point (poles) get one shared averaged normal.
 */
export function paramSurface(fn, nu, nv, { uv = null, closedU = false, flip = false } = {}) {
  const cols = nu + 1, rows = nv + 1;
  const pos = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const p = new THREE.Vector3();
  for (let j = 0; j < rows; j++) {
    const v = j / nv;
    for (let i = 0; i < cols; i++) {
      const u = i / nu;
      fn(u, v, p);
      const k = j * cols + i;
      pos[k * 3] = p.x;
      pos[k * 3 + 1] = p.y;
      pos[k * 3 + 2] = p.z;
      if (uv) {
        const t = uv(u, v, p);
        uvs[k * 2] = t[0];
        uvs[k * 2 + 1] = t[1];
      } else {
        uvs[k * 2] = u;
        uvs[k * 2 + 1] = v;
      }
    }
  }
  const idx = new (cols * rows > 65535 ? Uint32Array : Uint16Array)(nu * nv * 6);
  let n = 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      if (!flip) {
        idx[n++] = a; idx[n++] = c; idx[n++] = b;
        idx[n++] = b; idx[n++] = c; idx[n++] = d;
      } else {
        idx[n++] = a; idx[n++] = b; idx[n++] = c;
        idx[n++] = b; idx[n++] = d; idx[n++] = c;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const nrm = g.attributes.normal.array;
  const avg = (list) => {
    let x = 0, y = 0, z = 0;
    for (const k of list) {
      x += nrm[k * 3];
      y += nrm[k * 3 + 1];
      z += nrm[k * 3 + 2];
    }
    const l = Math.hypot(x, y, z) || 1;
    for (const k of list) {
      nrm[k * 3] = x / l;
      nrm[k * 3 + 1] = y / l;
      nrm[k * 3 + 2] = z / l;
    }
  };
  for (let j = 0; j < rows; j++) {
    const k0 = j * cols, km = j * cols + (nu >> 1);
    const pole = Math.hypot(pos[k0 * 3] - pos[km * 3], pos[k0 * 3 + 1] - pos[km * 3 + 1], pos[k0 * 3 + 2] - pos[km * 3 + 2]) < 1e-5;
    if (pole) {
      const list = [];
      for (let i = 0; i < cols; i++) list.push(k0 + i);
      avg(list);
    } else if (closedU) avg([k0, k0 + nu]);
  }
  return g;
}

/**
 * A sampled profile curve: points [[r, y], …] → evenly (arc length) spaced
 * samples with interpolation helpers. at(t) → { r, y } for t ∈ [0, 1].
 */
export function profile(points, samples = 64) {
  const curve = new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getSpacedPoints(samples);
  const rs = new Float32Array(pts.length);
  const ys = new Float32Array(pts.length);
  pts.forEach((p, i) => {
    rs[i] = p.x;
    ys[i] = p.y;
  });
  return {
    n: pts.length,
    at(t, out = { r: 0, y: 0 }) {
      const f = Math.min(Math.max(t, 0), 1) * (pts.length - 1);
      const i = Math.min(Math.floor(f), pts.length - 2);
      const k = f - i;
      out.r = rs[i] + (rs[i + 1] - rs[i]) * k;
      out.y = ys[i] + (ys[i + 1] - ys[i]) * k;
      return out;
    },
  };
}

// ─── shapes ──────────────────────────────────────────────────────────────────
/**
 * A chamfered beam along X (length len, height h along Y, width w along Z):
 * an 8-sided section with `segs` length segments, flat end caps.
 */
export function beamGeo(len, h, w, c = 0.01, segs = 1) {
  const cc = Math.max(0.0005, Math.min(c, h * 0.3, w * 0.3));
  const hh = h / 2, hw = w / 2;
  // (the low tier drops the chamfers: a plain 4-sided section, half the triangles)
  const sec = KIT.detail < 0.4
    ? [[-hh, -hw], [hh, -hw], [hh, hw], [-hh, hw]]
    : [
      [-hh + cc, -hw], [hh - cc, -hw], [hh, -hw + cc], [hh, hw - cc],
      [hh - cc, hw], [-hh + cc, hw], [-hh, hw - cc], [-hh, -hw + cc],
    ];
  const pos = [];
  const nor = [];
  const idx = [];
  const n = sec.length;
  for (let f = 0; f < n; f++) {
    const a = sec[f], b = sec[(f + 1) % n];
    const ny = b[1] - a[1], nz = -(b[0] - a[0]);
    const nl = Math.hypot(ny, nz) || 1;
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const x = -len / 2 + (len * i) / segs;
      pos.push(x, a[0], a[1], x, b[0], b[1]);
      nor.push(0, ny / nl, nz / nl, 0, ny / nl, nz / nl);
    }
    for (let i = 0; i < segs; i++) {
      const k = base + i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  for (const sx of [-1, 1]) {
    const base = pos.length / 3;
    for (const [y, z] of sec) {
      pos.push((sx * len) / 2, y, z);
      nor.push(sx, 0, 0);
    }
    for (let i = 1; i < n - 1; i++) {
      if (sx > 0) idx.push(base, base + i, base + i + 1);
      else idx.push(base, base + i + 1, base + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/**
 * A wooden part (w × h × d like a BoxGeometry) with chamfered edges and grain
 * UVs along `along`. rng gives each board its own UV offset.
 */
export function board(w, h, d, { along = 'x', c = 0.008, rng = null, segs = 0 } = {}) {
  const len = along === 'x' ? w : along === 'y' ? h : d;
  const s = segs || Math.max(1, Math.round(len / 0.6));
  let g;
  if (along === 'x') g = beamGeo(w, h, d, c, s);
  else if (along === 'y') g = beamGeo(h, w, d, c, s).rotateZ(Math.PI / 2);
  else g = beamGeo(d, h, w, c, s).rotateY(-Math.PI / 2);
  return uvBox(g, along, 1 / 1.4, rng ? [rng.next() * 7, rng.next() * 7] : [0, 0]);
}

/** A board between two points (section w × h), slightly bowed when rng is given. */
export function boardBetween(a, b, w, h, { rng = null, up = [0, 1, 0], bow = 0.01, c = 0.008 } = {}) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const segs = Math.max(1, Math.round(len / 0.4));
  const g = beamGeo(len, h, w, c, segs);
  if (rng && bow > 0) {
    const k1 = rng.jitter(1), k2 = rng.jitter(1);
    deform(g, (v) => {
      const t = v.x / len + 0.5;
      const s = Math.sin(t * Math.PI);
      v.y += s * bow * k1;
      v.z += s * bow * k2;
    });
  }
  uvBox(g, 'x', 1 / 1.4, rng ? [rng.next() * 7, rng.next() * 7] : [0, 0]);
  return alongX(g, a, b, up);
}

/** A cylinder between two points (radius r1 at a, r2 at b). */
export function rod(a, b, r1, r2 = r1, radial = 6) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const g = new THREE.CylinderGeometry(r2, r1, len, radial, 1, false);
  g.rotateZ(-Math.PI / 2); // along +X, r1 at −X
  uvBox(g, 'x', 2);
  return alongX(g, a, b);
}

/**
 * A lumpy stone (flattened noisy icosphere). opts: { r, sx, sy, sz, lump, detail, flatTop }
 * detail: icosphere subdivision (1 = 80 triangles) or 'low' (32 triangles —
 * pebbles, footing stones, flagstones: the many small ones nobody sees up close).
 */
export function stoneGeo(rng, { r = 0.2, sx = 1, sy = 0.6, sz = 1, lump = 0.22, detail = 1, flatTop = 0.55 } = {}) {
  if (detail === 1 && KIT.detail < 0.6) detail = 'low'; // (lower tiers: the small ones lose nothing)
  let g = detail === 'low' ? new THREE.OctahedronGeometry(1, 1) : new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const ox = rng.next() * 50, oy = rng.next() * 50;
  deform(g, (v) => {
    const n = noiseA(v.x * 1.3 + ox, v.y * 1.3 + v.z * 0.7 + oy) * 0.6 + noiseB(v.z * 2.6 + oy, v.x * 2.6 - ox) * 0.4;
    v.multiplyScalar(1 + n * lump);
    if (v.y > flatTop) v.y = flatTop + (v.y - flatTop) * 0.35;
    if (v.y < -0.6) v.y = -0.6 + (v.y + 0.6) * 0.3;
    v.set(v.x * r * sx, v.y * r * sy, v.z * r * sz);
  });
  uvBox(g, 'x', 1.6, [rng.next() * 9, rng.next() * 9]);
  return g;
}

/** A dressed block stone (rounded box with lumpy faces), size w × h × d. segs: box segments (fewer for tiny stones). */
export function blockStone(rng, w, h, d, lump = 0.12, segs = [3, 2, 2]) {
  if (KIT.detail < 0.6) segs = segs.map((n) => Math.max(1, n - 1));
  let g = new THREE.BoxGeometry(w, h, d, segs[0], segs[1], segs[2]);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const ox = rng.next() * 50;
  const m = Math.min(w, h, d);
  deform(g, (v) => {
    // round the corners
    const kx = (2 * v.x) / w, ky = (2 * v.y) / h, kz = (2 * v.z) / d;
    const corner = Math.max(0, Math.abs(kx) * Math.abs(ky) + Math.abs(ky) * Math.abs(kz) + Math.abs(kx) * Math.abs(kz) - 1.2);
    v.multiplyScalar(1 - corner * 0.12);
    v.x += noiseA(v.y * 6 + ox, v.z * 6) * m * lump;
    v.y += noiseB(v.x * 6 + ox, v.z * 6) * m * lump * 0.6;
    v.z += noiseA(v.x * 6 - ox, v.y * 6 + ox) * m * lump;
  });
  uvBox(g, 'x', 1.6, [rng.next() * 9, rng.next() * 9]);
  return g;
}

/** A soft moss cushion (flattened lumpy dome) sitting on y = 0. */
export function mossGeo(rng, { r = 0.25, h = 0.08, sx = 1, sz = 1 } = {}) {
  const lo = KIT.detail < 0.6;
  let g = new THREE.SphereGeometry(1, lo ? 7 : 9, lo ? 3 : 4, 0, Math.PI * 2, 0, Math.PI / 2);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const ox = rng.next() * 40;
  deform(g, (v) => {
    const n = noiseA(v.x * 2.2 + ox, v.z * 2.2 - ox);
    const k = 1 + n * 0.25;
    v.set(v.x * r * sx * k, v.y * h * (0.8 + n * 0.5) - 0.01, v.z * r * sz * k);
  });
  return g;
}

/** Wedge of a ring (voussoir) in the XY plane, depth along Z (centred). */
export function arcSegment(r0, r1, a0, a1, depth, seg = 3, bevel = 0.01) {
  const s = new THREE.Shape();
  const n = Math.max(1, seg);
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const x = Math.cos(a) * r1, y = Math.sin(a) * r1;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  for (let i = n; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / n;
    s.lineTo(Math.cos(a) * r0, Math.sin(a) * r0);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 2 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Round-topped arch outline: width w, straight sides of height h below the half circle. */
export function archShape(w, h, { x = 0, y = 0, path = null, reverse = false } = {}) {
  const s = path ?? new THREE.Shape();
  const r = w / 2;
  if (!reverse) {
    s.moveTo(x - r, y);
    s.lineTo(x + r, y);
    s.lineTo(x + r, y + h);
    s.absarc(x, y + h, r, 0, Math.PI, false);
    s.lineTo(x - r, y);
  } else {
    s.moveTo(x - r, y);
    s.lineTo(x - r, y + h);
    s.absarc(x, y + h, r, Math.PI, 0, true);
    s.lineTo(x + r, y);
    s.lineTo(x - r, y);
  }
  return s;
}

/**
 * A horizontal disc of radius r clipped by the chord z = zMax (in a frame
 * whose +Z is the cut direction), at height y, rotated by `rotY` about Y.
 * up = true → faces +Y (floors), false → faces −Y (ceilings).
 */
export function chordDisc(r, zMax, y, rotY = 0, up = true, segs = 40) {
  const a0 = zMax >= r ? 0 : Math.acos(Math.max(-1, zMax / r));
  const s = new THREE.Shape();
  for (let i = 0; i <= segs; i++) {
    const a = a0 + ((TAU - 2 * a0) * i) / segs;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (i === 0) s.moveTo(x, up ? -z : z);
    else s.lineTo(x, up ? -z : z);
  }
  const g = new THREE.ShapeGeometry(s, 1);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  g.rotateY(rotY);
  g.translate(0, y, 0);
  return g;
}

/** Sagging catenary-ish curve between two points. */
export function sagCurve(a, b, sag, segments = 12) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t));
  }
  return new THREE.CatmullRomCurve3(pts);
}

/** A tube along points (Vector3 or [x,y,z]) — vines, wires, pipes, ropes. */
export function tube(points, radius = 0.01, radial = 4, tubular = null, closed = false) {
  const v = points.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2])));
  const curve = new THREE.CatmullRomCurve3(v, closed, 'centripetal');
  const g = new THREE.TubeGeometry(curve, tubular ?? Math.max(4, v.length * 3), radius, radial, closed);
  return g;
}

/** A tapered tube (radius r0 → r1) along points — branches, stems, horns. */
export function taperTube(points, r0, r1, radial = 5, tubular = null) {
  const v = points.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2])));
  const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal');
  const segs = tubular ?? Math.max(4, v.length * 3);
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  // scale each ring around its centre
  const pos = g.attributes.position;
  const c = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, c);
    const r = r0 + (r1 - r0) * t;
    for (let k = 0; k <= radial; k++) {
      const idx = i * (radial + 1) + k;
      p.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(idx, p.x, p.y, p.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

// ─── leaf cards ──────────────────────────────────────────────────────────────
/**
 * Collects foliage cards (quads with the stem at the bottom centre of the UV
 * square, growing towards +V) into one geometry.
 */
export class Cards {
  /** opts.keep (0..1): keep only that share of the cards added, evenly spread (lower tiers thin
   *  out the leaves without touching the caller's random draws, so the layout stays the same) */
  constructor({ keep = 1 } = {}) {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
    this.keep = Math.min(1, Math.max(0, keep));
    this.seen = 0;
  }
  /** A card with its stem at `base`, growing along `up`, facing `normal`, height s (width s·aspect). */
  add(base, up, normal, s, { aspect = 1, flip = false, bend = 0 } = {}) {
    const i = this.seen++;
    if (this.keep < 1 && Math.floor((i + 1) * this.keep) === Math.floor(i * this.keep)) return;
    const across = _x.crossVectors(up, normal).normalize();
    const n0 = this.pos.length / 3;
    const rows = bend ? (KIT.detail < 0.6 ? 2 : 3) : 1;
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const droop = bend * t * t;
      for (const cx of [-0.5, 0.5]) {
        const x = base.x + across.x * cx * s * aspect + up.x * t * s + normal.x * droop * s;
        const y = base.y + across.y * cx * s * aspect + up.y * t * s + normal.y * droop * s - Math.abs(bend) * t * t * s * 0.3;
        const z = base.z + across.z * cx * s * aspect + up.z * t * s + normal.z * droop * s;
        this.pos.push(x, y, z);
        this.nor.push(normal.x, normal.y, normal.z);
        this.uv.push(flip ? 0.5 - cx : 0.5 + cx, t);
      }
    }
    for (let r = 0; r < rows; r++) {
      const a = n0 + r * 2;
      this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  get count() {
    return this.idx.length / 6;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
}

/** A cupped broad leaf (for the leaf surface): base at origin, tip along +Y, facing +Z. UV over the leaf. */
export function leafGeo(len = 0.2, width = 0.5, cup = 0.25, segs = 4) {
  const g = new THREE.PlaneGeometry(len * width, len, 2, segs);
  g.translate(0, len / 2, 0);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const t = y / len;
    const wq = Math.max(0, Math.sin(Math.min(1, t * 1.05) * Math.PI)) ** 0.8;
    const nx = x / ((len * width) / 2);
    pos.setX(i, x * (0.15 + 0.85 * wq));
    pos.setZ(i, -nx * nx * cup * len * 0.3 + t * t * len * 0.15);
    uv.setXY(i, 0.5 + nx * 0.5, t);
  }
  g.computeVertexNormals();
  return g;
}

// ─── little plants (into a batch frame) ─────────────────────────────────────
export const FLOWER_COLORS = ['#f2c14e', '#e86a5a', '#f4f0e6', '#b48fd6', '#f29bb8', '#7fa7e0', '#ffd88a'];

/** A small flower (petals + centre) into the vc material at p, facing roughly up. */
export function addFlower(F, rng, x, y, z, { color = null, size = 0.06, stem = 0.18 } = {}) {
  const M2 = mats();
  const c = color ?? rng.pick(FLOWER_COLORS);
  const h = stem * rng.range(0.7, 1.2);
  const lean = [rng.jitter(0.25), 0, rng.jitter(0.25)];
  F.add(M2.vc, xf(new THREE.CylinderGeometry(0.006, 0.008, h, 3, 1, true).translate(0, h / 2, 0), [x, y, z], lean), { color: '#4f7a34', cast: false });
  const tip = new THREE.Vector3(0, h, 0).applyEuler(new THREE.Euler(lean[0], 0, lean[2])).add(new THREE.Vector3(x, y, z));
  const petals = rng.int(5, 6);
  const rot = rng.next() * TAU;
  if (KIT.detail < 0.6) {
    // (lower tiers: the petals as one cupped star — 2 triangles a petal instead of 8)
    const star = new THREE.CircleGeometry(size, petals * 2, rot);
    const sp = star.attributes.position;
    for (let i = 1; i < sp.count; i++) {
      const k = (i - 1) % 2 === 0 ? 1 : 0.45;
      sp.setXYZ(i, sp.getX(i) * k, sp.getY(i) * k, size * 0.22 * k);
    }
    star.rotateX(-Math.PI / 2);
    star.computeVertexNormals();
    F.add(M2.vc, star.translate(tip.x, tip.y, tip.z), { color: c, cast: false });
    F.add(M2.vc, new THREE.SphereGeometry(size * 0.28, 4, 2).translate(tip.x, tip.y + size * 0.08, tip.z), { color: '#e8b33a', cast: false });
    return;
  }
  for (let i = 0; i < petals; i++) {
    const a = rot + (i / petals) * TAU;
    const pg = new THREE.SphereGeometry(size * 0.5, 4, 2); // a soft lozenge petal (8 triangles)
    pg.scale(1, 0.3, 0.55);
    pg.translate(size * 0.5, 0, 0);
    pg.rotateY(a);
    pg.rotateZ(0.25);
    F.add(M2.vc, pg.translate(tip.x, tip.y, tip.z), { color: c, cast: false });
  }
  F.add(M2.vc, new THREE.SphereGeometry(size * 0.28, 4, 2).translate(tip.x, tip.y + size * 0.08, tip.z), { color: '#e8b33a', cast: false });
}

/** A tuft of grass cards at (x, y, z). */
export function addGrass(F, rng, x, y, z, { size = 0.32, blades = 3 } = {}) {
  const C = new Cards();
  for (let i = 0; i < blades; i++) {
    const a = rng.next() * Math.PI;
    const n = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    C.add(new THREE.Vector3(x + rng.jitter(0.05), y - 0.02, z + rng.jitter(0.05)), new THREE.Vector3(rng.jitter(0.25), 1, rng.jitter(0.25)).normalize(), n, size * rng.range(0.75, 1.2), { aspect: 0.7 });
  }
  const g = C.geometry();
  materials.foliageNormals(g, new THREE.Vector3(x, y, z), 0.6);
  F.add(mats().grass, g, { cast: false });
}

/** A fern (arched frond cards fanning out) at (x, y, z). */
export function addFern(F, rng, x, y, z, { size = 0.5, fronds = 7 } = {}) {
  const C = new Cards();
  const rot = rng.next() * TAU;
  for (let i = 0; i < fronds; i++) {
    const a = rot + (i / fronds) * TAU + rng.jitter(0.3);
    const out = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const up = new THREE.Vector3(out.x * 0.75, 0.75 + rng.jitter(0.15), out.z * 0.75).normalize();
    const nrm = new THREE.Vector3().crossVectors(up, new THREE.Vector3(Math.cos(a), 0, -Math.sin(a))).normalize();
    if (nrm.y < 0) nrm.negate();
    C.add(new THREE.Vector3(x, y, z), up, nrm, size * rng.range(0.75, 1.15), { aspect: 0.55, bend: 0.25 });
  }
  const g = C.geometry();
  materials.foliageNormals(g, new THREE.Vector3(x, y + size * 0.2, z), 0.7);
  F.add(mats().fern, g, { cast: false });
}

/**
 * A little fly agaric (or other toadstool) — stem, cap with gills hint and
 * white warts — into the vc/stem materials.
 */
export function addToadstool(F, rng, x, y, z, { size = 0.12, color = '#c4301f', lean = 0.18, warts = true } = {}) {
  const M2 = mats();
  const h = size * rng.range(1.1, 1.8);
  const rx = rng.jitter(lean), rz = rng.jitter(lean), ry = rng.next() * TAU;
  const lo = KIT.detail < 0.6;
  const stem = new THREE.CylinderGeometry(size * 0.15, size * 0.22, h, lo ? 5 : 6, 1, true);
  stem.translate(0, h / 2, 0);
  // a little ring (annulus) under the cap
  const ring = new THREE.CylinderGeometry(size * 0.2, size * 0.24, size * 0.06, lo ? 5 : 6, 1, true).translate(0, h * 0.78, 0);
  const capR = size * rng.range(0.5, 0.62);
  const cap = new THREE.SphereGeometry(capR, lo ? 7 : 9, lo ? 3 : 4, 0, TAU, 0, Math.PI / 2);
  cap.scale(1, rng.range(0.55, 0.85), 1);
  cap.translate(0, h - capR * 0.08, 0);
  const under = new THREE.CircleGeometry(capR * 0.98, lo ? 7 : 9).rotateX(Math.PI / 2).translate(0, h - capR * 0.06, 0);
  for (const [g, c, m] of [[stem, '#efe5cf', M2.stem], [ring, '#efe5cf', M2.stem], [cap, color, M2.cap], [under, '#e3cfa8', M2.vc]]) {
    xf(g, [x, y, z], [rx, ry, rz]);
    F.add(m, g, { color: c, cast: false });
  }
  if (warts) {
    const n = rng.int(3, 6);
    for (let i = 0; i < n; i++) {
      const a = rng.next() * TAU, el = rng.range(0.35, 1.25);
      const sp = new THREE.SphereGeometry(size * rng.range(0.04, 0.07), 4, 2);
      sp.scale(1, 0.45, 1);
      const rr = capR * 1.0;
      const cy = Math.sin(el) * rr * 0.7;
      sp.lookAt(new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)));
      sp.translate(Math.cos(a) * Math.cos(el) * rr, h - capR * 0.08 + cy, Math.sin(a) * Math.cos(el) * rr);
      xf(sp, [x, y, z], [rx, ry, rz]);
      F.add(M2.vc, sp, { color: '#f6efe0', cast: false });
    }
  }
}

/**
 * Ivy: a wandering woody stem from `start` along `dir`, hugging a surface
 * with normal `normal` (gravity pulls hanging strands down), with ivy cards.
 * Returns the stem points. Cards go into `cards` (a Cards set) when given.
 */
export function addIvy(F, rng, start, dir, { length = 1.2, droop = 0.6, size = 0.16, density = 1, normal = [0, 0, 1], surface = null, cards = null, stemColor = '#5a4a32' } = {}) {
  const pts = [];
  const p = new THREE.Vector3(start[0], start[1], start[2]);
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const nrm = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
  const step = 0.07;
  const n = Math.max(3, Math.round(length / step));
  for (let i = 0; i < n; i++) {
    pts.push(p.clone());
    d.x += rng.jitter(0.3);
    d.z += rng.jitter(0.3);
    d.y += rng.jitter(0.22) - droop * 0.22;
    if (surface) {
      // stick to a surface: project onto it and take its normal
      surface(p, nrm);
    }
    d.addScaledVector(nrm, -d.dot(nrm)).normalize();
    p.addScaledVector(d, step);
  }
  // (the woody stem: one segment per step, every other step on the lower tiers)
  if (pts.length >= 2) F.add(mats().vc, tube(pts, 0.007, 3, Math.max(4, KIT.detail < 0.6 ? pts.length >> 1 : pts.length)), { color: stemColor, cast: false });
  const C = cards ?? new Cards();
  const count = Math.round(n * 0.75 * density);
  const up = new THREE.Vector3();
  const nn = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const k = Math.min(pts.length - 2, Math.floor(rng.next() * (pts.length - 1)));
    const q = pts[k];
    const along = new THREE.Vector3().subVectors(pts[k + 1], q).normalize();
    // leaves trail along the vine, tilted out from the surface
    up.copy(along).multiplyScalar(rng.chance(0.5) ? 1 : -1);
    up.y -= 0.35;
    up.addScaledVector(nrm, 0.35).normalize();
    nn.copy(nrm);
    if (surface) surface(q.clone(), nn);
    nn.addScaledVector(up, -nn.dot(up)).normalize();
    C.add(q.clone().addScaledVector(nn, 0.012), up.clone(), nn.clone(), size * rng.range(0.7, 1.25), { aspect: 0.9, flip: rng.chance(0.5) });
  }
  if (!cards && C.count) F.add(mats().ivy, C.geometry(), { cast: false });
  return pts;
}

/** Random helpers. */
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const smooth01 = (t) => {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
};
