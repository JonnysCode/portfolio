// ─────────────────────────────────────────────────────────────────────────────
// Night glows: hundreds of fireflies drifting and blinking — swirling slowly
// around the Great Oak's roots, dancing over the stream and the lily pond,
// around the cottages, along the forest edge, gathering at the glowing
// mushrooms — plus soft halos breathing around those mushrooms.
//
// Each fly has a dusk threshold: as night falls a few come out first, then
// the whole glen fills up. One additive Points draw call, animated entirely
// on the GPU (no CPU per frame); invisible (and free) by day.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight, streamPolyline } from '../ground.js';
import { OAK, STREAM, COTTAGE, GLEN_RADIUS } from '../layout.js';
import { palette } from '../../core/palette.js';
import { sharedUniforms } from '../../core/materials.js';
import { pointUniforms, SOFT_DISC, DIST_FADE } from './points.js';

const VERT = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform float uMotion;
uniform float uScale;
uniform float uFogNear;
uniform float uFogFar;
attribute vec4 aParams;  // phase, speed, wander radius, size
attribute vec3 aColor;
attribute vec3 aBlink;   // blink rate, resting brightness, dusk threshold
attribute vec3 aSwirl;   // swirl centre x, z, angular speed (0 = none)
varying vec3 vColor;
varying float vAlpha;
${DIST_FADE}
void main() {
  float ph = aParams.x;
  float t = uTime * aParams.y * uMotion + ph * 17.0;
  float rad = aParams.z;
  vec3 base = position;
  if (aSwirl.z != 0.0) {
    // slow orbit around a centre (the oak's roots)
    float a = uTime * aSwirl.z * uMotion;
    vec2 d = base.xz - aSwirl.xy;
    float c = cos(a), s = sin(a);
    base.xz = aSwirl.xy + vec2(d.x * c - d.y * s, d.x * s + d.y * c);
  }
  vec3 p = base + vec3(
    sin(t * 0.71 + ph * 3.1) * rad + sin(t * 1.93) * rad * 0.3,
    sin(t * 1.13 + ph * 5.0) * rad * 0.32 + sin(t * 0.37 + ph) * rad * 0.2,
    cos(t * 0.59 + ph * 2.3) * rad + cos(t * 1.71 + ph) * rad * 0.3
  );
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  float pulse = 0.5 + 0.5 * sin(uTime * aBlink.x + ph * 6.2831);
  float glow = aBlink.y + (1.0 - aBlink.y) * pulse * pulse * pulse;
  float awake = smoothstep(aBlink.z, aBlink.z + 0.18, uNight);
  vAlpha = awake * glow * distFade(d);
  vColor = aColor;
  gl_PointSize = clamp(aParams.w * uScale / max(d, 0.1), 0.0, 36.0) * (0.75 + 0.25 * glow);
  // never a blurry blob in front of the lens
  vAlpha *= smoothstep(1.5, 5.0, d);
  if (vAlpha < 0.004) gl_PointSize = 0.0;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
${SOFT_DISC}
void main() {
  float halo;
  float core = softCore(gl_PointCoord, 0.22, halo);
  float a = (core + halo * 0.7) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4((vColor + vec3(core * 0.6)) * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * @param ctx
 * @param {{ glowSpots?: {x,y,z}[], count?: number, reduced?: boolean }} opts
 */
export function createFireflies(ctx, { glowSpots = [], count = 500, reduced = false } = {}) {
  const rng = ctx.rng('ambient-fireflies');
  const pos = [], params = [], colors = [], blink = [], swirl = [];
  const warm = new THREE.Color(palette.windowGlow).lerp(new THREE.Color(palette.leafLight), 0.35);
  const warm2 = new THREE.Color(palette.windowGlow).lerp(new THREE.Color('#fff2a8'), 0.4);
  const mint = new THREE.Color('#c8ffb0');
  const cyan = new THREE.Color(palette.glowCyan);

  const addFly = (x, y, z, { sw = null, thresh = null, size = 1 } = {}) => {
    pos.push(x, y, z);
    params.push(rng.range(0, 1), rng.range(0.25, 0.55), rng.range(0.4, 1.4), rng.range(0.22, 0.36) * size);
    const c = rng.chance(0.55) ? warm : rng.chance(0.6) ? warm2 : mint;
    colors.push(c.r, c.g, c.b);
    // most wake late in the dusk, a few early ones already at twilight
    blink.push(rng.range(0.6, 1.6), rng.range(0.22, 0.45), thresh ?? (rng.chance(0.12) ? rng.range(0.15, 0.3) : rng.range(0.35, 0.75)));
    if (sw) swirl.push(sw[0], sw[1], sw[2]);
    else swirl.push(0, 0, 0);
  };
  const ground = (x, z) => Math.max(getHeight(x, z), STREAM.waterLevel);
  const spts = streamPolyline.pts;
  const cottages = [COTTAGE.home, COTTAGE.atelier, COTTAGE.shed];

  for (let i = 0; i < count; i++) {
    const mode = rng.next();
    let x, z, y = null, sw = null;
    if (mode < 0.24) {
      // swirling around the Great Oak's roots
      const a = rng.range(0, Math.PI * 2), d = rng.range(4.6, 11);
      x = OAK.x + Math.sin(a) * d;
      z = OAK.z + Math.cos(a) * d;
      sw = [OAK.x, OAK.z, rng.range(0.03, 0.08) * (rng.chance(0.85) ? 1 : -1)];
    } else if (mode < 0.44) {
      // over the stream and the lily pond
      if (rng.chance(0.4)) {
        const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * (STREAM.pond.radius + 2.5);
        x = STREAM.pond.x + Math.cos(a) * d;
        z = STREAM.pond.z + Math.sin(a) * d;
      } else {
        const p = spts[Math.floor(rng.next() * spts.length)];
        x = p.x + rng.jitter(3);
        z = p.z + rng.jitter(3);
      }
    } else if (mode < 0.58) {
      // around the cottages
      const c = rng.pick(cottages);
      const a = rng.range(0, Math.PI * 2), d = rng.range(2.5, 7);
      x = c.x + Math.sin(a) * d;
      z = c.z + Math.cos(a) * d;
    } else if (mode < 0.84) {
      // the forest edge
      const a = rng.range(0, Math.PI * 2), r = rng.range(GLEN_RADIUS - 9, GLEN_RADIUS + 5);
      x = Math.sin(a) * r;
      z = Math.cos(a) * r;
    } else if (mode < 0.94 && glowSpots.length) {
      const g = rng.pick(glowSpots), a = rng.range(0, Math.PI * 2), d = rng.range(0.3, 2.2);
      x = g.x + Math.cos(a) * d;
      z = g.z + Math.sin(a) * d;
    } else {
      // high sparkles in the oak's crown
      const a = rng.range(0, Math.PI * 2), d = rng.range(5, 15);
      x = OAK.x + Math.sin(a) * d;
      z = OAK.z + Math.cos(a) * d;
      y = rng.range(6, 15);
    }
    addFly(x, y ?? ground(x, z) + rng.range(0.35, 2.6), z, { sw });
  }
  // breathing halos around glowing mushrooms
  for (const g of glowSpots) {
    pos.push(g.x, g.y + 0.05, g.z);
    params.push(rng.range(0, 1), 0.05, 0.02, rng.range(0.8, 1.1));
    colors.push(cyan.r * 0.3, cyan.g * 0.3, cyan.b * 0.3);
    blink.push(rng.range(0.4, 0.8), 0.55, 0.2);
    swirl.push(0, 0, 0);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aParams', new THREE.Float32BufferAttribute(params, 4));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aBlink', new THREE.Float32BufferAttribute(blink, 3));
  geo.setAttribute('aSwirl', new THREE.Float32BufferAttribute(swirl, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uNight: { value: 0 },
      uMotion: { value: reduced ? 0.4 : 1 },
      ...pointUniforms,
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'ambient:fireflies';
  points.frustumCulled = false;
  points.renderOrder = 5;
  points.raycast = () => {};
  ctx.scene.add(points);

  return {
    object: points,
    count: pos.length / 3,
    update(night) {
      mat.uniforms.uNight.value = night;
      points.visible = night > 0.12;
    },
  };
}
