// ─────────────────────────────────────────────────────────────────────────────
// Night glows: fireflies drifting and blinking — gathered in four swarms
// (the lily pond, the stream's bend, the fairy ring, under the Great Oak's
// left limb), roaming round the oak's roots, the cottages and the glowing
// mushrooms, a few low at the forest edge, and a handful of big, slow "hero"
// fireflies with long lazy blinks near every spot's focus — plus soft halos
// breathing around the glowing mushrooms. Dark areas stay dark: the lights
// have a hierarchy, not an even sparkle over the frame.
//
// Each fly has a dusk threshold: as night falls a few come out first, then
// the whole glen fills up. One additive Points draw call, animated entirely
// on the GPU (no CPU per frame); invisible (and free) by day.
//
// createGlowWorms(): the glow-worm canopy — hundreds of tiny cool-white and
// cyan lights hanging on silk threads under the Great Oak's limbs and the
// giants' crowns (y ≈ 14–35), twinkling slowly: at night the underside of the
// leaves reads like a starry sky. The same shader and night gate, one more
// Points draw.
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
uniform float uBokeh;    // how hard out-of-focus points are suppressed (0 = never)
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
  // …nor a big bokeh disc anywhere: the post's circle of confusion (px at
  // 720p, same model as post.js) × the fly's size — far out of focus, a fly
  // fades to a faint speck (dust on the lens otherwise, in the close-ups)
  float cocS = 10.0 * (d - uFocus) / max(d, 0.1);
  float coc = cocS >= 0.0 ? min(max(cocS - 0.9, 0.0), 9.0) : 5.0 * (1.0 - exp(-max(-cocS - 1.2, 0.0) * 0.15));
  vAlpha *= 1.0 - 0.88 * uBokeh * smoothstep(3.0, 6.5, coc * clamp(aParams.w / 0.28, 0.6, 2.2));
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

// Keep the spot cameras' near field clear (composed shot and its -wide
// variant): a light drifting a few units in front of the lens sits far in
// front of the focus and the depth of field turns it into a blob.
let lenses = null;
const _q = new THREE.Vector3();
function inNearField(x, y, z, wander, reach = 0.6) {
  if (!lenses) {
    lenses = [];
    for (const s of SPOTS) {
      const P = new THREE.Vector3(...s.camera.position), T = new THREE.Vector3(...s.camera.target);
      const dir = T.clone().sub(P);
      const dist = dir.length();
      dir.normalize();
      lenses.push({ P, dir, dist });
      if (s.id !== 'glen') lenses.push({ P: T.clone().addScaledVector(dir, -dist * 1.8), dir, dist: dist * 1.8 });
      // (and the phone's own composed shot)
      if (s.portrait) {
        const PP = new THREE.Vector3(...(s.portrait.position ?? s.camera.position));
        const d2 = new THREE.Vector3(...(s.portrait.target ?? s.camera.target)).sub(PP);
        const l2 = d2.length();
        lenses.push({ P: PP, dir: d2.normalize(), dist: l2 });
      }
    }
  }
  for (const l of lenses) {
    _q.set(x, y, z).sub(l.P);
    const along = _q.dot(l.dir);
    const r = l.dist * reach + wander;
    if (along < -wander || along > r) continue;
    const perp = Math.sqrt(Math.max(0, _q.lengthSq() - along * along));
    // a generous cone (wider than the 40° lens) around the view axis
    if (perp < Math.max(0, along) * 0.62 + 1.2 + wander) return true;
  }
  return false;
}

function pointsMaterial(reduced, bokeh = 1) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uNight: { value: 0 },
      uMotion: { value: reduced ? 0.4 : 1 },
      uFocus: { value: 20 },
      uBokeh: { value: bokeh },
      ...pointUniforms,
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * @param ctx
 * @param {{ glowSpots?: {x,y,z}[], count?: number, reduced?: boolean, ring?: {x,y,z,r} }} opts
 *
 * Round 5: not uniform sparkle noise any more. A third fewer flies roam
 * freely (round the oak's roots, the cottages, the glowing mushrooms; only a
 * few low ones at the forest edge — none up in the backdrop band); the rest
 * gather in four SWARMS — over the lily pond, at the stream's bend, round the
 * fairy ring and under the Great Oak's left limb — slowly circling their
 * centre; and at every spot a handful of bigger, slower HERO fireflies drift
 * near what the camera came to see, with long, lazy blinks. Out-of-focus
 * flies fade (shader: the post's circle of confusion × their size).
 */
export function createFireflies(ctx, { glowSpots = [], count = 500, reduced = false, ring = null } = {}) {
  const rng = ctx.rng('ambient-fireflies');
  const pos = [], params = [], colors = [], blink = [], swirl = [];
  const warm = new THREE.Color(palette.windowGlow).lerp(new THREE.Color(palette.leafLight), 0.35);
  const warm2 = new THREE.Color(palette.windowGlow).lerp(new THREE.Color('#fff2a8'), 0.4);
  const mint = new THREE.Color('#c8ffb0');
  const cyan = new THREE.Color(palette.glowCyan);
  const stats = { free: 0, swarms: [], heroes: 0 };

  const addFly = (x, y, z, { sw = null, thresh = null, size = 1, speed = null, wander = null, rate = null, rest = null, color = null } = {}) => {
    pos.push(x, y, z);
    params.push(rng.range(0, 1), speed ?? rng.range(0.25, 0.55), wander ?? rng.range(0.4, 1.4), rng.range(0.22, 0.36) * size);
    const c = color ?? (rng.chance(0.55) ? warm : rng.chance(0.6) ? warm2 : mint);
    colors.push(c.r, c.g, c.b);
    // most wake late in the dusk, a few early ones already at twilight
    blink.push(rate ?? rng.range(0.6, 1.6), rest ?? rng.range(0.22, 0.45), thresh ?? (rng.chance(0.12) ? rng.range(0.15, 0.3) : rng.range(0.35, 0.75)));
    if (sw) swirl.push(sw[0], sw[1], sw[2]);
    else swirl.push(0, 0, 0);
  };
  const ground = (x, z) => Math.max(getHeight(x, z), STREAM.waterLevel);
  /** Clear of every lens' near field (a swirling fly: tested round its circle). */
  const clearOfLenses = (x, y, z, sw, wander = 1.4, reach = 0.6) => {
    if (!sw) return !inNearField(x, y, z, wander, reach);
    const dx = x - sw[0], dz = z - sw[1];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      if (inNearField(sw[0] + dx * c - dz * s, y, sw[1] + dx * s + dz * c, wander, reach)) return false;
    }
    return true;
  };
  const spts = streamPolyline.pts;
  const cottages = [COTTAGE.home, COTTAGE.atelier, COTTAGE.shed];
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-6, rng.next()))) * Math.cos(Math.PI * 2 * rng.next());

  // ── the swarms ──
  const swarms = [];
  swarms.push({ id: 'pond', x: STREAM.pond.x, z: STREAM.pond.z, r: STREAM.pond.radius * 0.7, h: [0.25, 1.6], k: 1.2 });
  swarms.push({ id: 'bend', x: 12.4, z: 11.2, r: 2.2, h: [0.25, 1.8], k: 0.9 });
  if (ring) swarms.push({ id: 'ring', x: ring.x, z: ring.z, r: (ring.r ?? 1.2) * 1.5, h: [0.2, 1.5], k: 1 });
  {
    // under the Great Oak's left limb (as the glen's camera sees it: −x)
    let best = null;
    for (const l of ctx.oak?.limbInfo ?? []) {
      if (!l.curve) continue;
      const tip = l.curve.getPoint(1);
      if (!best || tip.x < best.tip.x) best = { l, tip };
    }
    const p = best ? best.l.curve.getPoint(0.62) : new THREE.Vector3(OAK.x - 8, 12, OAK.z + 2);
    swarms.push({ id: 'limb', x: p.x, z: p.z, r: 2.6, h: [1.4, 4.2], k: 1 });
  }
  const total = Math.round(count * 0.65);
  const inSwarms = Math.round(total * 0.46);
  const kSum = swarms.reduce((a, w) => a + w.k, 0);
  for (const w of swarms) {
    const want = Math.round((inSwarms * w.k) / kSum);
    const spin = rng.range(0.04, 0.09) * (rng.chance(0.5) ? 1 : -1);
    let made = 0;
    for (let t = 0; made < want && t < want * 6; t++) {
      const a = rng.range(0, Math.PI * 2), d = Math.min(1.6, Math.abs(gauss()) * 0.6) * w.r;
      const x = w.x + Math.sin(a) * d, z = w.z + Math.cos(a) * d;
      const y = ground(x, z) + rng.range(w.h[0], w.h[1]) * (1 - 0.35 * (d / (w.r * 1.6)));
      const sw = [w.x, w.z, spin * rng.range(0.7, 1.3)];
      // (the swarms are meant to be seen: only the lens' immediate near field is
      //  refused — the shader shrinks & fades whatever sits out of focus)
      if (!clearOfLenses(x, y, z, sw, 0.6, 0.28)) continue;
      addFly(x, y, z, { sw, wander: rng.range(0.25, 0.8), thresh: rng.range(0.3, 0.65) });
      made++;
    }
    stats.swarms.push(`${w.id}:${made}`);
  }

  // ── the free flies ──
  const free = total - inSwarms;
  for (let i = 0, tries = 0; i < free && tries < free * 8; tries++) {
    const mode = rng.next();
    let x, z, y = null, sw = null;
    if (mode < 0.34) {
      // swirling around the Great Oak's roots
      const a = rng.range(0, Math.PI * 2), d = rng.range(4.6, 11);
      x = OAK.x + Math.sin(a) * d;
      z = OAK.z + Math.cos(a) * d;
      sw = [OAK.x, OAK.z, rng.range(0.03, 0.08) * (rng.chance(0.85) ? 1 : -1)];
    } else if (mode < 0.48) {
      // over the stream
      const p = spts[Math.floor(rng.next() * spts.length)];
      x = p.x + rng.jitter(2.2);
      z = p.z + rng.jitter(2.2);
    } else if (mode < 0.68) {
      // around the cottages
      const c = rng.pick(cottages);
      const a = rng.range(0, Math.PI * 2), d = rng.range(2.5, 6.5);
      x = c.x + Math.sin(a) * d;
      z = c.z + Math.cos(a) * d;
    } else if (mode < 0.9 && glowSpots.length) {
      // gathering at the glowing mushrooms
      const g = rng.pick(glowSpots), a = rng.range(0, Math.PI * 2), d = rng.range(0.3, 2.0);
      x = g.x + Math.cos(a) * d;
      z = g.z + Math.sin(a) * d;
    } else if (mode < 0.97) {
      // a few at the forest edge — low, in front of the trunks (never up in the backdrop band)
      const a = rng.range(0, Math.PI * 2), r = rng.range(GLEN_RADIUS - 9, GLEN_RADIUS - 3);
      x = Math.sin(a) * r;
      z = Math.cos(a) * r;
      y = ground(x, z) + rng.range(0.3, 1.4);
    } else {
      // a rare high sparkle in the oak's crown
      const a = rng.range(0, Math.PI * 2), d = rng.range(5, 13);
      x = OAK.x + Math.sin(a) * d;
      z = OAK.z + Math.cos(a) * d;
      y = rng.range(6, 12);
    }
    const fy = y ?? ground(x, z) + rng.range(0.35, 2.4);
    if (!clearOfLenses(x, fy, z, sw)) continue;
    addFly(x, fy, z, { sw });
    i++;
    stats.free++;
  }

  // ── hero fireflies: bigger, slower, long lazy blinks, near what each spot frames ──
  for (const s of SPOTS) {
    const f = s.focus ?? s.camera.target;
    const n = s.id === 'glen' ? 5 : rng.int(5, 8);
    let made = 0;
    for (let t = 0; made < n && t < n * 10; t++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(1.0, s.id === 'glen' ? 6 : 3.2);
      const x = f[0] + Math.sin(a) * d, z = f[2] + Math.cos(a) * d;
      const y = Math.max(ground(x, z) + 0.35, f[1] + rng.range(-0.7, 1.3));
      if (!clearOfLenses(x, y, z, null, 1.0)) continue;
      addFly(x, y, z, { size: rng.range(1.6, 2.0), speed: rng.range(0.1, 0.18), wander: rng.range(0.5, 1.1), rate: rng.range(0.28, 0.45), rest: rng.range(0.05, 0.12), thresh: rng.range(0.25, 0.45), color: rng.chance(0.7) ? warm2 : warm });
      made++;
    }
    stats.heroes += made;
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
  const mat = pointsMaterial(reduced);
  const points = new THREE.Points(geo, mat);
  points.name = 'ambient:fireflies';
  points.frustumCulled = false;
  points.renderOrder = 5;
  points.raycast = () => {};
  ctx.scene.add(points);

  return {
    object: points,
    count: pos.length / 3,
    stats,
    update(night) {
      mat.uniforms.uNight.value = night;
      mat.uniforms.uFocus.value = Math.max(4, ctx.cameraRig?.focusDistance ?? 20);
      points.visible = night > 0.12;
    },
  };
}

/**
 * The glow-worm canopy. anchors: [{ x, y, z, r }] — places under which the
 * worms hang (under limbs, under leaf masses); each anchor gets a few silk
 * threads with 1–4 glowing droplets. count: total lights.
 */
export function createGlowWorms(ctx, { anchors = [], oakN = 0, oakShare = 0.75, count = 450, reduced = false, yRange = [14, 35] } = {}) {
  const rng = ctx.rng('ambient-glowworms');
  const pos = [], params = [], colors = [], blink = [], swirl = [];
  const tints = [new THREE.Color('#eaf8ff'), new THREE.Color('#a6f2ff'), new THREE.Color('#b8ffea'), new THREE.Color('#d6ecff')];
  const add = (x, y, z, size) => {
    pos.push(x, y, z);
    // (they hang on silk: barely any wander, a slow sway)
    params.push(rng.range(0, 1), rng.range(0.12, 0.3), rng.range(0.03, 0.1), rng.range(0.14, 0.21) * size);
    const c = rng.pick(tints).clone().multiplyScalar(rng.range(0.75, 1.05));
    colors.push(c.r, c.g, c.b);
    // slow twinkle around a steady glow; they light up once it is properly dark
    blink.push(rng.range(0.15, 0.45), rng.range(0.6, 0.85), rng.range(0.35, 0.6));
    swirl.push(0, 0, 0);
  };
  if (anchors.length) {
    for (let tries = 0; pos.length / 3 < count && tries < count * 8; tries++) {
      // (three in four under the Great Oak — the crown every overview looks at —
      //  the rest under the giants' crowns)
      const a = oakN && oakN < anchors.length ? (rng.chance(oakShare) ? anchors[rng.int(0, oakN - 1)] : anchors[rng.int(oakN, anchors.length - 1)]) : rng.pick(anchors);
      const ang = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * a.r;
      const x = a.x + Math.sin(ang) * d, z = a.z + Math.cos(ang) * d;
      // (most hang close under the leaves; some on long silk threads below them)
      const y = a.y - (rng.chance(0.65) ? rng.range(0.1, 0.9) : rng.range(0.9, 2.8));
      if (y < yRange[0] || y > yRange[1]) continue;
      if (inNearField(x, y, z, 0.5, 0.75)) continue;
      // a silk thread: droplets of light one under the other, the lowest brightest
      const n = rng.chance(0.55) ? 1 : rng.int(2, 4);
      let yy = y;
      for (let k = 0; k < n && pos.length / 3 < count; k++) {
        add(x + rng.jitter(0.02), yy, z + rng.jitter(0.02), k === n - 1 ? 1 : 0.7);
        yy -= rng.range(0.14, 0.32);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aParams', new THREE.Float32BufferAttribute(params, 4));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aBlink', new THREE.Float32BufferAttribute(blink, 3));
  geo.setAttribute('aSwirl', new THREE.Float32BufferAttribute(swirl, 3));
  const mat = pointsMaterial(reduced, 0.6);
  const points = new THREE.Points(geo, mat);
  points.name = 'ambient:glowworms';
  points.frustumCulled = false;
  points.renderOrder = 5;
  points.raycast = () => {};
  points.visible = false;
  ctx.scene.add(points);
  return {
    object: points,
    count: pos.length / 3,
    update(night) {
      mat.uniforms.uNight.value = night;
      mat.uniforms.uFocus.value = Math.max(4, ctx.cameraRig?.focusDistance ?? 20);
      points.visible = night > 0.3 && pos.length > 0;
    },
  };
}
