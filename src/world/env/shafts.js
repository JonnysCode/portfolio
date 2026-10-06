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
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { getHeight, getPadAt } from '../ground.js';
import { envUniforms, GLSL_NOISE } from './celestial.js';
import { sunlightUniforms, SUNLIGHT_GLSL } from './sunlight.js';

const VERT = /* glsl */ `
  attribute vec3 aBase;   // foot of the shaft (world)
  attribute vec4 aShape;  // length, width, intensity, seed
  uniform vec3 uAxis;     // towards the sun
  varying vec2 vUv;
  varying vec3 vW;
  varying float vI;
  varying float vSeed;
  varying float vView;
  void main() {
    vec3 axis = normalize(uAxis);
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
    vI = aShape.z;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uAxis, uColor;
  uniform float uTime, uStrength;
  varying vec2 vUv;
  varying vec3 vW;
  varying float vI;
  varying float vSeed;
  varying float vView;
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
    float drift = 0.65 + 0.35 * envNoise(vec2(along * 3.0 - uTime * 0.07 + vSeed * 9.0, across * 1.5 + uTime * 0.02));
    float lit = sunVisibility(vW);
    // forward scattering: brighter when looking into the light
    vec3 v = normalize(vW - cameraPosition);
    float c = dot(v, normalize(uAxis));
    float g = 0.55;
    float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
    float phase = 0.25 + hg * 0.22;
    float a = prof * ends * streak * drift * lit * phase * vI * vView * uStrength;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Build the shafts. Returns { mesh, update(dt, night) }.
 * `spots` — optional extra foot points [{ x, z, length, width, intensity }].
 */
export function buildShafts(ctx) {
  const tier = ctx.quality?.tier ?? 'high';
  const rng = createRng('godrays');
  const keyDir = envUniforms.uKeyDir.value;

  const bases = [];
  const shapes = [];
  const add = (x, z, length, width, intensity) => {
    bases.push(x, getHeight(x, z) - 0.2, z);
    shapes.push(length, width, intensity, rng.next());
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
  // … plus a scatter of thinner ones; the shadow map decides which of them shine.
  const extra = tier === 'high' ? 22 : tier === 'medium' ? 10 : 4;
  let tries = 0;
  while (bases.length / 3 < heroes.length + extra && tries++ < 400) {
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
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(new Float32Array(bases), 3));
  geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(shapes), 4));
  geo.instanceCount = bases.length / 3;

  const uniforms = {
    ...sunlightUniforms,
    uAxis: { value: keyDir },
    uColor: { value: new THREE.Color('#ffc978') },
    uTime: envUniforms.uTime,
    uStrength: { value: 1 },
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

  const base = tier === 'low' ? 0.22 : 0.34;
  return {
    mesh,
    uniforms,
    update(night) {
      const k = 1 - THREE.MathUtils.smoothstep(night, 0.05, 0.45);
      uniforms.uStrength.value = base * k;
      mesh.visible = k > 0.002;
    },
  };
}
