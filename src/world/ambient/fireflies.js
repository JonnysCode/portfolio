// ─────────────────────────────────────────────────────────────────────────────
// Night glows: hundreds of fireflies (drifting, blinking, densest by the pond
// and the forest edge) plus soft halos breathing around the glowing mushrooms.
// One additive Points draw call, animated entirely on the GPU. Invisible (and
// free) by day.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { getHeight, getAreaAt } from '../ground.js';
import { WORLD_RADIUS, POND, AREAS } from '../layout.js';
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
attribute vec2 aBlink;   // blink rate, resting brightness
varying vec3 vColor;
varying float vAlpha;
${DIST_FADE}
void main() {
  float ph = aParams.x;
  float t = uTime * aParams.y * uMotion + ph * 17.0;
  float rad = aParams.z;
  vec3 p = position + vec3(
    sin(t * 0.71 + ph * 3.1) * rad + sin(t * 1.93) * rad * 0.3,
    sin(t * 1.13 + ph * 5.0) * rad * 0.32 + sin(t * 0.37 + ph) * rad * 0.2,
    cos(t * 0.59 + ph * 2.3) * rad + cos(t * 1.71 + ph) * rad * 0.3
  );
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  float pulse = 0.5 + 0.5 * sin(uTime * aBlink.x + ph * 6.2831);
  float glow = aBlink.y + (1.0 - aBlink.y) * pulse * pulse * pulse;
  vAlpha = uNight * glow * distFade(d);
  vColor = aColor;
  gl_PointSize = clamp(aParams.w * uScale / max(d, 0.1), 0.0, 90.0) * (0.75 + 0.25 * glow);
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
  const pos = [], params = [], colors = [], blink = [];
  const warm = new THREE.Color(palette.windowGlow).lerp(new THREE.Color(palette.leafLight), 0.35);
  const warm2 = new THREE.Color(palette.windowGlow).lerp(new THREE.Color('#fff2a8'), 0.4);
  const cyan = new THREE.Color(palette.glowCyan);

  const addFly = (x, y, z) => {
    pos.push(x, y, z);
    params.push(rng.range(0, 1), rng.range(0.25, 0.55), rng.range(0.5, 1.6), rng.range(0.26, 0.4));
    const c = rng.chance(0.7) ? warm : warm2;
    colors.push(c.r, c.g, c.b);
    blink.push(rng.range(0.6, 1.6), rng.range(0.22, 0.45));
  };
  const ground = (x, z) => Math.max(getHeight(x, z), POND.waterLevel);

  for (let i = 0; i < count; i++) {
    const mode = rng.next();
    let x, z;
    if (mode < 0.24) {
      // the pond: over the water and along the banks
      const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * (POND.radius + 6);
      x = POND.center.x + Math.cos(a) * d;
      z = POND.center.z + Math.sin(a) * d;
    } else if (mode < 0.52) {
      // the forest edge
      const a = rng.range(0, Math.PI * 2), r = rng.range(WORLD_RADIUS - 9, WORLD_RADIUS + 3);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    } else if (mode < 0.6 && glowSpots.length) {
      const g = rng.pick(glowSpots), a = rng.range(0, Math.PI * 2), d = rng.range(0.5, 3);
      x = g.x + Math.cos(a) * d;
      z = g.z + Math.sin(a) * d;
    } else if (mode < 0.75) {
      // around the rims of the clearings, where visitors spend their time
      const area = rng.pick(AREAS), a = rng.range(0, Math.PI * 2), d = area.radius + rng.range(-1, 6);
      x = area.center.x + Math.cos(a) * d;
      z = area.center.z + Math.sin(a) * d;
    } else {
      // meadows between the districts (not right on the clearings)
      const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.range(14 * 14, (WORLD_RADIUS - 4) ** 2));
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      if (getAreaAt(x, z, -2)) continue;
    }
    addFly(x, ground(x, z) + rng.range(0.4, 2.6), z);
  }
  // breathing halos around glowing mushrooms
  for (const g of glowSpots) {
    pos.push(g.x, g.y + 0.05, g.z);
    params.push(rng.range(0, 1), 0.05, 0.02, rng.range(0.9, 1.3));
    colors.push(cyan.r * 0.3, cyan.g * 0.3, cyan.b * 0.3);
    blink.push(rng.range(0.4, 0.8), 0.55);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aParams', new THREE.Float32BufferAttribute(params, 4));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aBlink', new THREE.Float32BufferAttribute(blink, 2));
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
  ctx.scene.add(points);

  return {
    object: points,
    count: pos.length / 3,
    update(night) {
      mat.uniforms.uNight.value = night;
      points.visible = night > 0.02;
    },
  };
}
