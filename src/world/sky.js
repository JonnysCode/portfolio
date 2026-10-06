// ─────────────────────────────────────────────────────────────────────────────
// Sky & far forest. The glen is enclosed by deep forest, so the sky is only
// glimpsed through canopy gaps and above the far crowns:
//
//   dome      soft blue-green sky, a luminous warm haze around the low sun
//             (back-left), thin painterly cloud wisps; at night deep blue with
//             stars peeking and a haloed moon. At and below the horizon it is
//             exactly the aerial-perspective mist colour, so the fogged far
//             forest melts into it without a seam.
//   backdrop  colossal trunks, canopy masses and mist curtains receding into
//             the haze (env/backdrop.js).
//
// Also keeps scene.fog (colour + adaptive near/far) and the shared fog
// parameters (env/fog.js) in sync with the time of day and the camera: the
// zoomed-out overview stays crisp, close-ups get soft depth.
//
// Exposes ctx.sky = { dome, backdrop, clouds (null — painted into the dome), uniforms (shared envUniforms) }.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { smoothstep } from '../core/rng.js';
import { envUniforms, SKY_COLOR_PAIRS, GLSL_NOISE, SUN_SKY_DIR, MOON_SKY_DIR } from './env/celestial.js';
import { fogParams, fogUniforms, FOG_GLSL, installFog } from './env/fog.js';
import { buildBackdrop } from './env/backdrop.js';

installFog();

const DOME_RADIUS = 450;

const domeVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position * ${DOME_RADIUS.toFixed(1)}, 1.0);
  }
`;

const domeFragment = /* glsl */ `
  uniform vec3 uSkyZenith, uSkyMid, uSkyHorizon, uSunGlow;
  uniform vec3 uSunDir, uMoonDir;
  uniform float uNight, uTime, uStars;
  varying vec3 vDir;
  ${GLSL_NOISE}
  ${FOG_GLSL}

  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    float day = 1.0 - uNight;

    // ── gradient ──
    float t = max(y, 0.0);
    vec3 col = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.3, t));
    col = mix(col, uSkyZenith, smoothstep(0.25, 0.95, t));

    // ── thin painterly wisps (barely seen through the canopy) ──
    vec2 cp = d.xz / max(y + 0.35, 0.05);
    float w = envFbm(cp * vec2(0.55, 1.1) + vec2(uTime * 0.004, 0.0));
    float wisp = smoothstep(0.5, 0.9, w) * smoothstep(0.04, 0.3, y) * (1.0 - smoothstep(0.6, 0.95, y));
    vec3 wispCol = mix(vec3(1.0, 0.96, 0.9), uSkyHorizon * 0.7, uNight);
    col = mix(col, wispCol, wisp * mix(0.35, 0.15, uNight));

    // ── the low sun: a broad luminous golden haze (the disc itself hides behind the crowns) ──
    float sd = max(dot(d, uSunDir), 0.0);
    vec3 haze = uSunGlow * (pow(sd, 3.0) * 0.32 + pow(sd, 14.0) * 0.75 + pow(sd, 160.0) * 2.2);
    col += haze * day;
    // wisps catch the light near the sun
    col += uSunGlow * wisp * pow(sd, 6.0) * 0.9 * day;

    // ── stars peeking through ──
    if (uNight > 0.01 && uStars > 0.5) {
      vec3 sp = d * 70.0;
      vec3 cell = floor(sp);
      float h = envHash(cell.xy + cell.z * 17.31);
      if (h > 0.6) {
        vec3 off = vec3(envHash(cell.yz + 3.1), envHash(cell.zx + 7.7), envHash(cell.xy + 11.3)) - 0.5;
        float dist = length(fract(sp) - 0.5 - off * 0.5);
        float size = mix(0.06, 0.18, pow(fract(h * 13.7), 3.0));
        float tw = 0.55 + 0.45 * sin(uTime * (1.3 + 2.7 * fract(h * 7.3)) + h * 60.0);
        float star = smoothstep(size, size * 0.2, dist) * tw;
        vec3 sc = mix(vec3(1.0, 0.9, 0.75), vec3(0.75, 0.85, 1.0), fract(h * 3.7));
        col += sc * star * uNight * smoothstep(0.05, 0.3, y) * 2.2;
      }
    }

    // ── moon disc + halo ──
    if (uNight > 0.01) {
      float md = max(dot(d, uMoonDir), 0.0);
      vec3 mr = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
      vec3 mu = cross(mr, uMoonDir);
      vec2 ml = vec2(dot(d, mr), dot(d, mu)) / 0.038;
      float r = length(ml);
      vec3 moonCol = vec3(1.25, 1.25, 1.35);
      moonCol *= 0.82 + 0.18 * smoothstep(0.3, 0.7, envNoise(ml * 2.1 + 4.0));
      moonCol *= mix(0.6, 1.0, smoothstep(-0.9, -0.2, dot(ml, vec2(-0.75, -0.2))));
      float disc = smoothstep(1.0, 0.92, r) * step(0.0, dot(d, uMoonDir));
      col += vec3(0.45, 0.55, 0.95) * (pow(md, 600.0) * 0.6 + pow(md, 40.0) * 0.22 + pow(md, 6.0) * 0.06) * uNight;
      col = mix(col, moonCol, disc * uNight);
    }

    // ── at & below the horizon: exactly the (fully fogged) mist colour ──
    vec3 mist = woodlandFogColor(d);
    col = mix(col, mist, 1.0 - smoothstep(-0.02, 0.16, y));

    // ── the endless forest beyond: two soft painted treelines dissolving in the mist ──
    float az = atan(d.x, -d.z);
    float tl1 = 0.07 + 0.05 * envFbm(vec2(az * 9.0, 1.7)) + 0.03 * envNoise(vec2(az * 40.0, 3.1));
    float tl2 = 0.035 + 0.035 * envFbm(vec2(az * 14.0, 7.3)) + 0.02 * envNoise(vec2(az * 70.0, 5.5));
    float fw = fwidth(y) * 1.5 + 0.002;
    vec3 far1 = mix(mist, uSkyZenith * 0.35 + mist * 0.45, 0.32 * day + 0.2 * uNight);
    vec3 far2 = mix(mist, uSkyZenith * 0.3 + mist * 0.4, 0.5 * day + 0.3 * uNight);
    col = mix(col, far1, smoothstep(fw, -fw, y - tl1) * smoothstep(-0.05, 0.02, y));
    col = mix(col, far2, smoothstep(fw, -fw, y - tl2) * smoothstep(-0.05, 0.02, y));
    col = mix(col, mist, 1.0 - smoothstep(-0.03, 0.03, y));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export default async function build(ctx) {
  const { scene, engine, camera } = ctx;
  const U = envUniforms;

  // ── fog & background ──
  if (!scene.fog || !scene.fog.isFog) scene.fog = new THREE.Fog(0xffffff, 40, 160);
  if (!scene.background || !scene.background.isColor) scene.background = new THREE.Color();

  // ── dome ──
  const fogU = fogUniforms();
  // the dome is not fogged itself, but paints the mist colour at the horizon
  fogU.fogColor = { value: scene.fog.color };
  const domeMat = new THREE.ShaderMaterial({
    name: 'sky-dome',
    uniforms: {
      ...fogU,
      uSkyZenith: U.uSkyZenith, uSkyMid: U.uSkyMid, uSkyHorizon: U.uSkyHorizon,
      uSunGlow: U.uSunGlow, uSunDir: U.uSunDir, uMoonDir: U.uMoonDir,
      uNight: U.uNight, uTime: U.uTime,
      uStars: { value: 1 },
    },
    vertexShader: domeVertex,
    fragmentShader: domeFragment,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), domeMat);
  dome.name = 'sky-dome';
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  dome.matrixAutoUpdate = false;
  dome.raycast = () => {};
  scene.add(dome);

  // ── far forest ──
  let backdrop = null;
  try {
    backdrop = buildBackdrop(ctx);
    scene.add(backdrop.group);
  } catch (err) {
    console.warn('[sky] backdrop failed', err);
  }

  const pairs = SKY_COLOR_PAIRS;
  const colourTargets = {
    zenith: U.uSkyZenith.value, mid: U.uSkyMid.value, horizon: U.uSkyHorizon.value, fog: U.uFogColor.value,
    sunGlow: U.uSunGlow.value, cloudLit: U.uCloudLit.value, cloudShade: U.uCloudShade.value,
    mountainFar: U.uMountainFar.value, mountainNear: U.uMountainNear.value,
    snowLit: U.uSnowLit.value, snowShade: U.uSnowShade.value,
  };
  const colourKeys = Object.keys(colourTargets);
  let lastNight = -1;
  const focus = new THREE.Vector3();
  const glowDir = new THREE.Vector3();
  const warm = new THREE.Color();
  const warmDay = new THREE.Color('#f0d6a4');
  const warmNight = new THREE.Color('#3d5a8c');

  function applyNight(n) {
    for (const k of colourKeys) colourTargets[k].copy(pairs[k][0]).lerp(pairs[k][1], n);
    scene.fog.color.copy(U.uFogColor.value);
    scene.background.copy(U.uFogColor.value);
    // in-scatter lobe: golden towards the sun by day, a faint cool moon glow by night
    glowDir.copy(SUN_SKY_DIR).lerp(MOON_SKY_DIR, smoothstep(0.3, 0.7, n)).normalize();
    fogParams.sun[0] = glowDir.x;
    fogParams.sun[1] = glowDir.y;
    fogParams.sun[2] = glowDir.z;
    fogParams.sun[3] = 0.62 - 0.35 * n;
    warm.copy(warmDay).lerp(warmNight, n);
    fogParams.warm[0] = warm.r;
    fogParams.warm[1] = warm.g;
    fogParams.warm[2] = warm.b;
    fogParams.warm[3] = 8 + 3 * n;
    // the ground mist thickens at night
    fogParams.height[0] = 0.0055 + 0.011 * n;
    fogParams.height[1] = 0.42 - 0.06 * n;
    fogParams.misc[2] = n;
    backdrop?.night(n);
  }

  function update() {
    const n = ctx.env?.night ?? 0;
    if (n !== lastNight) {
      lastNight = n;
      applyNight(n);
    }
    // Adaptive distance haze: crisp diorama when zoomed out, soft depth up close.
    const rig = ctx.cameraRig;
    if (rig?.target) focus.copy(rig.target);
    else focus.set(0, 4, -2);
    const camDist = camera.position.distanceTo(focus);
    const nightK = 1 - 0.15 * n;
    scene.fog.near = (14 + camDist * 0.6) * nightK;
    scene.fog.far = (scene.fog.near + 90 + camDist) * nightK;
  }

  // After the camera (order 80) so the fog matches this frame's camera.
  engine.addUpdate(update, 86);
  update();

  ctx.sky = { dome, backdrop, clouds: null, uniforms: U };
  return {};
}
