// ─────────────────────────────────────────────────────────────────────────────
// makePuffs(ctx, opts) — a cloud of soft round puffs animated entirely in the
// vertex shader (no per-frame CPU work, one draw call): waterfall spray and
// mist, chimney smoke …
//
//   const smoke = makePuffs(ctx, {
//     emitters: [{ p: Vector3, n: 40, spread: 0.1 }],
//     color: '#d9d4cc', rise: 2.2, spreadOut: 0.4, drift: Vector3(0.3, 0, -0.1),
//     size: [0.18, 0.5], grow: 2.5, life: [0.12, 0.2], opacity: 0.35,
//   });
//   scene.add(smoke.points); … smoke.update(t)
//
// Each particle loops through its life (phase + t × speed): it fades in,
// rises (with a little sideways puff), drifts with `drift`, grows and fades
// out. Sizes are in world units (scaled by the drawing buffer height).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { fogUniforms } from '../../world/env/fog.js';
import { envUniforms } from '../../world/env/celestial.js';
import { sharedUniforms } from '../../core/materials.js';
import { createRng } from '../../core/rng.js';

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aSeed; // x: phase, y: speed, z: angle, w: random 0..1
uniform float uTime;
uniform float uScale;
uniform vec3 uDrift;
uniform vec4 uMotion; // x: rise, y: sideways puff, z: size min, w: size max
uniform float uGrow;
varying float vAlpha;
varying float vRand;
void main() {
  float life = fract(uTime * aSeed.y + aSeed.x);
  vec3 p = position;
  vec3 side = vec3(cos(aSeed.z), 0.0, sin(aSeed.z));
  p += side * (0.15 + life) * uMotion.y * (0.5 + aSeed.w);
  p += uDrift * life * (0.7 + 0.6 * aSeed.w);
  p.y += uMotion.x * (life * 0.8 + sin(life * 3.14159) * 0.2) * (0.6 + 0.6 * aSeed.w);
  vec4 mvPosition = viewMatrix * modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float size = mix(uMotion.z, uMotion.w, aSeed.w) * (1.0 + life * uGrow);
  gl_PointSize = uScale * size / max(-mvPosition.z, 0.1);
  vAlpha = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.4, 1.0, life));
  vRand = aSeed.w;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform vec3 uSkyHorizon;
uniform vec3 uKeyColor;
uniform float uNight;
uniform float uOpacity;
varying float vAlpha;
varying float vRand;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  // a soft puff, lit a little from the top
  float a = pow(smoothstep(0.5, 0.0, d), 1.4) * vAlpha * uOpacity * (0.75 + 0.25 * vRand);
  float lit = 0.75 + 0.25 * smoothstep(0.3, -0.3, c.y);
  vec3 col = uColor * lit * (uKeyColor * 0.35 + uSkyHorizon * 0.6) * (1.0 - 0.6 * uNight);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function makePuffs(ctx, opts = {}) {
  const rng = createRng(String(opts.seed ?? 'puffs'));
  const density = Math.max(0.4, ctx.quality?.density ?? 1);
  const emitters = opts.emitters ?? [];
  const total = Math.max(1, Math.round(emitters.reduce((a, e) => a + e.n, 0) * density));
  const pos = new Float32Array(total * 3), seed = new Float32Array(total * 4);
  const life = opts.life ?? [0.15, 0.3];
  let k = 0;
  const bounds = new THREE.Box3();
  for (const e of emitters) {
    const n = Math.round(e.n * density);
    const across = e.across ?? new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < n && k < total; i++, k++) {
      const o = (rng.next() - 0.5) * 2 * (e.spread ?? 0);
      const oz = (rng.next() - 0.5) * 2 * (e.depth ?? 0);
      pos.set([e.p.x + across.x * o - across.z * oz, e.p.y, e.p.z + across.z * o + across.x * oz], k * 3);
      seed.set([rng.next(), rng.range(life[0], life[1]), rng.next() * Math.PI * 2, rng.next()], k * 4);
      bounds.expandByPoint(e.p);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  sphere.radius += (opts.rise ?? 1) + 2;
  g.boundingSphere = sphere;
  const size = opts.size ?? [0.1, 0.3];
  const u = {
    ...fogUniforms(),
    uTime: { value: 0 },
    uScale: { value: 600 },
    uDrift: { value: (opts.drift ?? new THREE.Vector3()).clone() },
    uMotion: { value: new THREE.Vector4(opts.rise ?? 1, opts.spreadOut ?? 0.3, size[0], size[1]) },
    uGrow: { value: opts.grow ?? 1.5 },
    uColor: { value: new THREE.Color(opts.color ?? '#f2f7f6') },
    uOpacity: { value: opts.opacity ?? 0.3 },
    uSkyHorizon: envUniforms.uSkyHorizon,
    uKeyColor: envUniforms.uKeyColor,
    uNight: sharedUniforms.uNight,
  };
  const mat = new THREE.ShaderMaterial({ name: opts.name ?? 'puffs', uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true });
  const points = new THREE.Points(g, mat);
  points.name = opts.name ?? 'puffs';
  points.renderOrder = 3;
  const renderer = ctx.engine?.renderer;
  const buf = new THREE.Vector2();
  const animate = !ctx.engine?.reducedMotion;
  return {
    points,
    uniforms: u,
    update(t) {
      u.uTime.value = animate ? t : t * 0.2;
      if (renderer) {
        renderer.getDrawingBufferSize(buf);
        u.uScale.value = buf.y * 0.9;
      }
    },
  };
}
