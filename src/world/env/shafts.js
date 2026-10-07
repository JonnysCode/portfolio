// ─────────────────────────────────────────────────────────────────────────────
// God rays — soft slanted shafts of golden light falling through the canopy.
//
// Each shaft is an axial billboard (a quad that turns around the light axis to
// face the camera), instanced: one draw call for all of them. In the fragment
// shader every pixel of a shaft asks the sun's shadow map whether that bit of
// air is lit (env/sunlight.js) — so the shafts are carved by the real canopy
// gaps into bundles of thinner beams and simply vanish under dense foliage.
// On top: drifting noise streaks, a forward-scattering phase (much brighter
// when looking towards the sun), soft ends, fades when seen end-on, when the
// camera gets too close, and at night.
//
// A few big far shafts stand in the back-left forest (outside the shadow map:
// always lit) to give the misty depth its golden slant.
//
// Beams with their own axis (addBeam) don't follow the sun: the canopy-gap
// sunbeam that pools on the Schreinerei (lighting.js' SpotLight) gets one.
// By night a handful of shafts (addMoonbeam: the fairy ring, the lily pond,
// the plunge pool …) stay on as cool silver moonbeams along the moonlight
// (~35 % of the day strength, slower drift); everything else fades at dusk.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { getHeight, getPadAt } from '../ground.js';
import { envUniforms, GLSL_NOISE } from './celestial.js';
import { sunlightUniforms, SUNLIGHT_GLSL } from './sunlight.js';

/** Moonbeams: ~35 % of the day strength, times this (they are seen against the dark). */
const NIGHT_BOOST = 1.4;

const VERT = /* glsl */ `
  attribute vec3 aBase;   // foot of the shaft (world)
  attribute vec4 aShape;  // length, width, intensity, seed
  attribute vec4 aMode;   // xyz: own axis (0 = follow the key light), w: 1 = night moonbeam
  uniform vec3 uAxis;     // towards the sun
  uniform float uDayK, uNightK;
  varying vec2 vUv;
  varying vec3 vW;
  varying float vI;
  varying float vSeed;
  varying float vView;
  varying vec3 vAxis;
  varying vec2 vKind;     // x: own axis (noise-bundled, not shadow-carved), y: moonbeam
  void main() {
    float own = step(0.5, dot(aMode.xyz, aMode.xyz));
    vec3 axis = normalize(mix(uAxis, aMode.xyz, own));
    vAxis = axis;
    vKind = vec2(own, aMode.w);
    // day shafts / moonbeams that are switched off collapse (no fragments)
    float k = mix(uDayK, uNightK, aMode.w);
    if (k < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec3 mid = aBase + axis * aShape.x * 0.5;
    vec3 toCam = cameraPosition - mid;
    float camDist = length(toCam);
    toCam /= camDist;
    vec3 side = cross(axis, toCam);
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
    vec3 wp = aBase + axis * (position.y * aShape.x) + side * (position.x * aShape.y);
    vW = wp;
    vUv = vec2(position.x * 2.0, position.y);
    vSeed = aShape.w;
    // seen end-on the quad degenerates — fade it; also fade when the camera is inside it
    vView = (1.0 - pow(abs(dot(axis, toCam)), 6.0)) * smoothstep(aShape.y * 0.6, aShape.y * 2.2, camDist);
    vI = aShape.z * k;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor, uMoonColor;
  uniform float uTime, uStrength;
  varying vec2 vUv;
  varying vec3 vW;
  varying float vI;
  varying float vSeed;
  varying float vView;
  varying vec3 vAxis;
  varying vec2 vKind;
  ${GLSL_NOISE}
  ${SUNLIGHT_GLSL}
  void main() {
    float across = vUv.x;           // −1 … 1
    float along = vUv.y;            // 0 at the ground … 1 up in the crowns
    float prof = 1.0 - smoothstep(0.25, 1.0, abs(across));
    prof *= prof;
    float ends = smoothstep(0.0, 0.32, along) * (1.0 - smoothstep(0.55, 1.0, along));
    // fine streaks across the beam, slowly drifting dust density along it
    float streak = 0.55 + 0.45 * envNoise(vec2(across * 4.5 + vSeed * 17.0, along * 0.8 + vSeed));
    // moonbeams drift slower
    float tm = uTime * mix(1.0, 0.45, vKind.y);
    float drift = 0.65 + 0.35 * envNoise(vec2(along * 3.0 - tm * 0.07 + vSeed * 9.0, across * 1.5 + tm * 0.02));
    // four taps across the beam soften the canopy-cut edges into bundles of rays
    vec3 sideW = cross(vAxis, normalize(vW - cameraPosition));
    sideW *= inversesqrt(max(dot(sideW, sideW), 1e-8)); // (never NaN, even end-on)
    float bundles = 0.25 + 0.75 * smoothstep(0.35, 0.75, envNoise(vec2(across * 3.5 + vSeed * 31.0, 0.5)));
    float lit = bundles;
    if (vKind.x < 0.5 && uSunShadowParams.x > 0.5) {
      lit = 0.25 * (sunVisibility(vW + sideW * 0.12) + sunVisibility(vW - sideW * 0.12)
          + sunVisibility(vW + sideW * 0.32 + vAxis * 0.4) + sunVisibility(vW - sideW * 0.32 - vAxis * 0.4));
      // moonbeams are chosen stages: carved by the canopy, but never gone entirely
      lit = mix(lit, max(lit, bundles * 0.75), vKind.y);
    }
    // (no shadow map — low tier — or a beam with its own axis: noise bundles fake the canopy cut)
    // forward scattering: brighter when looking into the light
    vec3 v = normalize(vW - cameraPosition);
    float c = dot(v, vAxis);
    float g = 0.55;
    float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
    float phase = 0.25 + hg * 0.22;
    float a = prof * ends * streak * drift * lit * phase * vI * vView * uStrength;
    gl_FragColor = vec4(mix(uColor, uMoonColor, vKind.y) * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Build the shafts. Returns { mesh, uniforms, update(night, t) }.
 * Each instance: foot point (on the ground), length along the light, width,
 * intensity, seed. The shafts always follow the live key-light direction.
 */
export function buildShafts(ctx) {
  const tier = ctx.quality?.tier ?? 'high';
  const rng = createRng('godrays');
  const keyDir = envUniforms.uKeyDir.value;

  const bases = [];
  const shapes = [];
  const modes = [];
  const add = (x, z, length, width, intensity) => {
    bases.push(x, getHeight(x, z) - 0.2, z);
    shapes.push(length, width, intensity, rng.next());
    modes.push(0, 0, 0, 0);
  };

  // Hand-placed hero shafts where the spot cameras look …
  const heroes = [
    [-3.8, 3.2, 26, 3.2, 1.0], // across the Schreinerei porch
    [2.6, 4.5, 24, 2.4, 0.9], // over the main path by the door
    [-9.5, 1.5, 27, 4.0, 0.85], // between annex and cottages
    [-13.5, 9.0, 24, 3.0, 0.9], // the cottage garden
    [-18.5, 2.5, 26, 3.4, 0.8], // behind the cottages
    [7.0, 1.0, 28, 3.6, 0.85], // stream bank
    [13.5, 9.5, 24, 3.0, 0.8], // the bike workshop
    [16.0, -2.5, 26, 3.6, 0.75], // above the stream towards the falls
    [-1.0, 12.0, 22, 2.6, 0.8], // front meadow
    [6.0, -12.0, 30, 4.5, 0.7], // behind the oak
    [-8.0, -12.0, 30, 4.5, 0.7],
    [-22.0, -8.0, 30, 5.0, 0.7],
  ];
  for (const [x, z, l, w, i] of heroes) add(x, z, l, w, i);
  // … big hazy beams standing in the far forest on the sun side (misty depth)
  const far = [
    [-62, 52, 8.0, 0.55],
    [-38, 48, 7.0, 0.5],
    [-80, 56, 9.0, 0.5],
    [-16, 46, 6.5, 0.45],
  ];
  for (const [azDeg, r, w, i] of far) {
    const a = THREE.MathUtils.degToRad(azDeg);
    add(Math.sin(a) * r, -Math.cos(a) * r, r * 1.05, w, i);
  }
  // … plus a scatter of thinner ones; the shadow map decides which of them shine.
  const extra = tier === 'high' ? 22 : tier === 'medium' ? 10 : 4;
  const target = bases.length / 3 + extra;
  let tries = 0;
  while (bases.length / 3 < target && tries++ < 400) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * 26;
    const x = Math.sin(a) * r, z = Math.cos(a) * r * 0.9 + 1;
    if (getPadAt(x, z, 0.5)) continue;
    add(x, z, rng.range(18, 28), rng.range(1.2, 2.8), rng.range(0.5, 0.9));
  }

  const quad = new THREE.PlaneGeometry(1, 1, 1, 6);
  quad.translate(0, 0.5, 0); // x: −0.5…0.5, y: 0…1
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  // spare capacity so other modules can ask for a hero shaft of their own (addShaft)
  const SPARE = 16;
  const builtIn = bases.length / 3;
  const baseArr = new Float32Array((builtIn + SPARE) * 3);
  const shapeArr = new Float32Array((builtIn + SPARE) * 4);
  const modeArr = new Float32Array((builtIn + SPARE) * 4);
  baseArr.set(bases);
  shapeArr.set(shapes);
  modeArr.set(modes);
  const baseAttr = new THREE.InstancedBufferAttribute(baseArr, 3);
  const shapeAttr = new THREE.InstancedBufferAttribute(shapeArr, 4);
  const modeAttr = new THREE.InstancedBufferAttribute(modeArr, 4);
  geo.setAttribute('aBase', baseAttr);
  geo.setAttribute('aShape', shapeAttr);
  geo.setAttribute('aMode', modeAttr);
  geo.instanceCount = builtIn;
  /** Append one instance; returns false when the spare capacity is used up. */
  const push = (x, y, z, shape, mode) => {
    const i = geo.instanceCount;
    if (i >= builtIn + SPARE) return false;
    baseArr.set([x, y, z], i * 3);
    shapeArr.set(shape, i * 4);
    modeArr.set(mode, i * 4);
    baseAttr.needsUpdate = true;
    shapeAttr.needsUpdate = true;
    modeAttr.needsUpdate = true;
    geo.instanceCount = i + 1;
    return true;
  };

  const uniforms = {
    ...sunlightUniforms,
    uAxis: { value: keyDir },
    uColor: { value: new THREE.Color('#ffc978') },
    uMoonColor: { value: new THREE.Color('#a8c0ff') },
    uTime: { value: 0 }, // own clock: slowed down for prefers-reduced-motion
    uStrength: { value: 1 },
    uDayK: { value: 1 },
    uNightK: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'godrays',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'godrays';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};

  // (the HDR post path compresses additive light through the tone curve, so it gets more)
  const base = tier === 'low' ? 0.13 : 0.36;
  return {
    mesh,
    uniforms,
    /**
     * Add a shaft whose foot is at (x, z) on the ground — e.g. a beam falling
     * onto a doorstep. It still only shines where the canopy lets light through.
     * opts: { length = 24, width = 3, intensity = 0.9 }. Returns false when full.
     */
    addShaft(x, z, { length = 24, width = 3, intensity = 0.9 } = {}) {
      return push(x, getHeight(x, z) - 0.2, z, [length, width, intensity, rng.next()], [0, 0, 0, 0]);
    },
    /**
     * A day beam along its own axis (not the sun's), e.g. the canopy-gap
     * sunbeam onto the Schreinerei: foot (x, y, z), axis towards the light.
     */
    addBeam(x, y, z, axis, { length = 24, width = 3, intensity = 0.9 } = {}) {
      const a = axis.clone().normalize();
      return push(x, y - 0.2, z, [length, width, intensity, rng.next()], [a.x, a.y, a.z, 0]);
    },
    /** A night moonbeam falling on (x, z) along the moonlight (axis optional). */
    addMoonbeam(x, z, { length = 24, width = 2.6, intensity = 1, axis = null } = {}) {
      const a = axis ? axis.clone().normalize() : null;
      return push(x, getHeight(x, z) - 0.2, z, [length, width, intensity, rng.next()], [a?.x ?? 0, a?.y ?? 0, a?.z ?? 0, 1]);
    },
    update(night, t = 0) {
      uniforms.uTime.value = t * (ctx.engine.reducedMotion ? 0.15 : 1);
      const k = 1 - THREE.MathUtils.smoothstep(night, 0.05, 0.45);
      const kn = THREE.MathUtils.smoothstep(night, 0.6, 0.95);
      uniforms.uStrength.value = base;
      uniforms.uDayK.value = k;
      uniforms.uNightK.value = kn * 0.35 * NIGHT_BOOST;
      mesh.visible = k > 0.002 || kn > 0.002;
    },
  };
}
