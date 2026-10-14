// ─────────────────────────────────────────────────────────────────────────────
// makeGlowBeads(ctx, beads, opts) — the glow-worms' sticky silk droplets under
// the escarpment's ledges: ONE additive Points cloud (one draw call), lit only
// after dusk.
//
//   const gw = makeGlowBeads(ctx, [{ p: Vector3 (world), b: 0.3..1, s: 0.04, ph: 0..1 }]);
//   scene.add(gw.points); … gw.update(t)
//
// Each droplet is a soft round glint (a gaussian sprite, never a hard dot):
//   • night only — invisible by day, fading in with smoothstep(0.25, 0.6, night);
//   • at least ~2.5 px wide and at most ~7 px (never a sub-pixel dash that
//     shimmers in motion); a droplet drawn larger than it really is gets
//     fainter by the same factor, so far curtains thin out into a few faint
//     sparks instead of a block of dashes;
//   • fades out with view distance (the glen and overview cameras don't see
//     them at all: there they would only be a dotted texture on the cliff);
//   • a slow, out-of-step twinkle per droplet (still under reduced motion).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { sharedUniforms } from '../../core/materials.js';

const VERT = /* glsl */ `
attribute vec3 aBead; // x: brightness 0..1, y: twinkle phase 0..1, z: size (world units)
uniform float uTime;
uniform float uPx;     // half the drawing buffer's height (px)
uniform float uNight;
uniform vec2 uFade;    // view distance where the droplets fade out
varying float vA;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float dist = max(-mvPosition.z, 0.1);
  float px = aBead.z * projectionMatrix[1][1] * uPx / dist;
  float drawPx = clamp(px, 2.5, 7.0);
  gl_PointSize = drawPx;
  // (a droplet drawn bigger than it is keeps its light: fainter, never a blob)
  float keep = clamp((px * px) / (drawPx * drawPx), 0.0, 1.0);
  float tw = 0.62 + 0.38 * sin(uTime * (0.35 + 0.5 * fract(aBead.y * 7.13)) + aBead.y * 6.2831);
  float night = smoothstep(0.25, 0.6, uNight);
  vA = aBead.x * tw * night * mix(0.5, 1.0, keep) * (1.0 - smoothstep(uFade.x, uFade.y, dist));
  // (nothing to draw: park it outside the clip volume)
  if (vA < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c) * 4.0;
  if (d2 > 1.0) discard;
  // a soft glint: a bright little core in a gaussian glow
  float a = (exp(-d2 * 3.2) * 0.85 + exp(-d2 * 14.0) * 0.6) * vA;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * @param {object} ctx
 * @param {Array<{p: THREE.Vector3, b?: number, s?: number, ph?: number}>} beads world positions
 * @param {{ color?: string, fade?: [number, number], name?: string }} [opts]
 */
export function makeGlowBeads(ctx, beads, opts = {}) {
  const n = beads.length;
  const pos = new Float32Array(n * 3), info = new Float32Array(n * 3);
  const box = new THREE.Box3();
  beads.forEach((d, i) => {
    pos.set([d.p.x, d.p.y, d.p.z], i * 3);
    info.set([d.b ?? 1, d.ph ?? (i * 0.618) % 1, d.s ?? 0.045], i * 3);
    box.expandByPoint(d.p);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aBead', new THREE.BufferAttribute(info, 3));
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  g.boundingSphere.radius += 0.2;
  const fade = opts.fade ?? [17, 28];
  const u = {
    uTime: { value: 0 },
    uPx: { value: 360 },
    uNight: sharedUniforms.uNight,
    uFade: { value: new THREE.Vector2(fade[0], fade[1]) },
    // (a cool blue-green, never so hot that the tone mapping bleaches it white)
    uColor: { value: new THREE.Color(opts.color ?? '#62d8e6').multiplyScalar(1.75) },
  };
  const mat = new THREE.ShaderMaterial({
    name: opts.name ?? 'glow-beads',
    uniforms: u,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(g, mat);
  points.name = opts.name ?? 'glow-beads';
  points.renderOrder = 3;
  points.castShadow = false;
  points.receiveShadow = false;
  // (never a click target)
  points.raycast = () => {};
  const renderer = ctx.engine?.renderer;
  const buf = new THREE.Vector2();
  const animate = !ctx.engine?.reducedMotion;
  return {
    points,
    uniforms: u,
    update(t) {
      // (reduced motion: the twinkle all but stops)
      u.uTime.value = animate ? t : t * 0.05;
      if (renderer) {
        renderer.getDrawingBufferSize(buf);
        u.uPx.value = buf.y * 0.5;
      }
      // the whole cloud is skipped by day
      points.visible = sharedUniforms.uNight.value > 0.2;
    },
  };
}
