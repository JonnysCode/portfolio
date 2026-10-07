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
import { OAK, STREAM, COTTAGE, GLEN_RADIUS, SPOTS } from '../layout.js';
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
uniform float uFocus;    // camera → point of interest (the depth of field's focus)
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
  // the near field (well in front of the focus) is out of focus: a firefly
  // there would bloom into a huge soft blob — it shrinks and fades out instead
  float nearK = smoothstep(uFocus * 0.32, uFocus * 0.7, d);
  gl_PointSize = clamp(aParams.w * uScale / max(d, 0.1), 0.0, 22.0) * (0.75 + 0.25 * glow) * (0.45 + 0.55 * nearK);
  // never a blurry blob in front of the lens
  vAlpha *= smoothstep(2.0, 6.0, d) * nearK;
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
  // Keep the spot cameras' near field clear (composed shot and its -wide
  // variant): a fly drifting a few units in front of the lens sits far in
  // front of the focus and the depth of field turns it into a blob.
  const lenses = [];
  for (const s of SPOTS) {
    const P = new THREE.Vector3(...s.camera.position), T = new THREE.Vector3(...s.camera.target);
    const dir = T.clone().sub(P);
    const dist = dir.length();
    dir.normalize();
    lenses.push({ P, dir, dist });
    if (s.id !== 'glen') lenses.push({ P: T.clone().addScaledVector(dir, -dist * 1.8), dir, dist: dist * 1.8 });
  }
  const _q = new THREE.Vector3();
  const inNearField = (x, y, z, wander) => {
    for (const l of lenses) {
      _q.set(x, y, z).sub(l.P);
      const along = _q.dot(l.dir);
      const reach = l.dist * 0.6 + wander;
      if (along < -wander || along > reach) continue;
      const perp = Math.sqrt(Math.max(0, _q.lengthSq() - along * along));
      // a generous cone (wider than the 40° lens) around the view axis
      if (perp < Math.max(0, along) * 0.62 + 1.2 + wander) return true;
    }
    return false;
  };
  const spts = streamPolyline.pts;
  const cottages = [COTTAGE.home, COTTAGE.atelier, COTTAGE.shed];

  for (let i = 0, tries = 0; i < count && tries < count * 6; tries++) {
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
    const fy = y ?? ground(x, z) + rng.range(0.35, 2.6);
    // (swirling flies orbit the oak: test a few points of their circle)
    if (sw) {
      const dx = x - sw[0], dz = z - sw[1];
      let hit = false;
      for (let k = 0; k < 12 && !hit; k++) {
        const a = (k / 12) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        hit = inNearField(sw[0] + dx * c - dz * s, fy, sw[1] + dx * s + dz * c, 1.4);
      }
      if (hit) continue;
    } else if (inNearField(x, fy, z, 1.4)) continue;
    addFly(x, fy, z, { sw });
    i++;
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
      uFocus: { value: 20 },
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
      mat.uniforms.uFocus.value = Math.max(4, ctx.cameraRig?.focusDistance ?? 20);
      points.visible = night > 0.12;
    },
  };
}
