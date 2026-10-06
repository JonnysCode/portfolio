// ─────────────────────────────────────────────────────────────────────────────
// Sky — storybook golden-hour dome, layered Swiss Alps, puffy toon clouds,
// sun & moon discs, twinkling stars. Keeps scene.fog in sync with the horizon.
//
// The dome is a unit sphere re-centred on the camera in the vertex shader (no
// per-frame matrix work, never culled, drawn first). Everything that lives "at
// infinity" is painted in its fragment shader so it composites in the right
// order without extra draw calls:
//   gradient → sun glow & disc / moon & stars → far Alps (+ the Matterhorn) →
//   nearer foothills → below the horizon: exactly the fog colour.
// Clouds are real geometry (one merged mesh, custom toon shader) so they can
// sit in front of the mountains and drift.
//
// Fog: near/far adapt to how far the camera is from what it looks at, so the
// zoomed-out overview stays crisp while ground-level views get soft aerial depth.
//
// Exposes ctx.sky = { dome, clouds, uniforms (shared envUniforms) }.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../core/rng.js';
import { envUniforms, SKY_COLOR_PAIRS, GLSL_NOISE } from './env/celestial.js';

const DOME_RADIUS = 450;

const domeVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position * ${DOME_RADIUS.toFixed(1)}, 1.0);
  }
`;

const domeFragment = /* glsl */ `
  uniform vec3 uSkyZenith, uSkyMid, uSkyHorizon, uFogColor, uSunGlow;
  uniform vec3 uSunDir, uMoonDir, uKeyDir;
  uniform vec3 uMountainFar, uMountainNear, uSnowLit, uSnowShade;
  uniform float uNight, uTime, uStars;
  varying vec3 vDir;
  #define TAU 6.28318530718
  ${GLSL_NOISE}

  // Asymmetric peak with concave (sharp > 1) or rounded (sharp < 1) flanks.
  // x in cells relative to the summit.
  float peakShape(float x, float wl, float wr, float sharp) {
    float t = x < 0.0 ? -x / wl : x / wr;
    return pow(clamp(1.0 - t, 0.0, 1.0), sharp);
  }

  // One mountain range around the horizon. u = azimuth in cells.
  // Returns (height, summit u, summit height, 1 if left of summit).
  vec4 range(float u, float cells, float seed, float hMin, float hMax, float wMin, float wMax, float sharp) {
    float k0 = floor(u);
    vec4 best = vec4(0.0);
    for (int i = -2; i <= 2; i++) {
      float k = k0 + float(i);
      float kw = mod(k, cells);
      float h1 = envHash(vec2(kw, seed));
      float h2 = envHash(vec2(kw + 0.37, seed + 7.3));
      float h3 = envHash(vec2(kw + 0.71, seed + 13.1));
      float h4 = envHash(vec2(kw + 0.13, seed + 21.7));
      float c = k + 0.2 + 0.6 * h1;
      float H = mix(hMin, hMax, h2 * h2);
      float p = H * peakShape(u - c, mix(wMin, wMax, h3), mix(wMin, wMax, h4), sharp);
      if (p > best.x) best = vec4(p, c, H, u < c ? 1.0 : 0.0);
    }
    return best;
  }

  // Rolling foothills: a soft sum of gaussian bumps instead of a max of peaks.
  vec4 rollingRange(float u, float cells, float seed, float hMin, float hMax, float wMin, float wMax) {
    float k0 = floor(u);
    float sum = 0.0;
    vec4 best = vec4(0.0);
    for (int i = -2; i <= 2; i++) {
      float k = k0 + float(i);
      float kw = mod(k, cells);
      float c = k + 0.2 + 0.6 * envHash(vec2(kw, seed));
      float H = mix(hMin, hMax, envHash(vec2(kw + 0.37, seed + 7.3)));
      float w = mix(wMin, wMax, envHash(vec2(kw + 0.71, seed + 13.1)));
      float x = (u - c) / w;
      float p = H * exp(-x * x * 2.2);
      sum += p;
      if (p > best.x) best = vec4(p, c, H, u < c ? 1.0 : 0.0);
    }
    best.x = sum * 0.8;
    best.z = max(best.z, best.x);
    return best;
  }

  // Wrapped signed distance between two azimuths (cells).
  float wrapDelta(float a, float b, float cells) {
    return mod(a - b + cells * 0.5, cells) - cells * 0.5;
  }

  vec3 shadeMountain(vec3 base, vec4 m, float u, float cells, float sunU, float frontal, float y, float snowLine, float seed) {
    // Which face are we on, and does it face the light?
    float sunSide = wrapDelta(sunU, m.y, cells) < 0.0 ? 1.0 : 0.0;
    float lit = m.w == sunSide ? 1.0 : 0.0;
    float faceLight = mix(mix(0.7, 0.88, frontal), 1.04, lit);
    // gentle vertical gradient: richer near the ridge, lighter towards the haze
    float rel = clamp(y / max(m.z, 1e-3), 0.0, 1.0);
    vec3 col = base * faceLight * mix(1.06, 0.94, rel);
    if (snowLine > 0.0) {
      float e = envNoise(vec2(u * 11.0, seed)) * 0.6 + envNoise(vec2(u * 31.0, seed + 3.0)) * 0.4;
      float line = m.z * (snowLine + 0.1 * envNoise(vec2(u * 2.5, seed + 9.0))) + (e - 0.5) * m.z * 0.22;
      float snow = smoothstep(line - 0.0015, line + 0.0015, y);
      vec3 snowCol = mix(uSnowShade, uSnowLit, lit * 0.85 + frontal * 0.15);
      col = mix(col, snowCol, snow);
    }
    return col;
  }

  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    float day = 1.0 - uNight;

    // ── gradient ──
    float t = max(y, 0.0);
    vec3 col = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.22, t));
    col = mix(col, uSkyZenith, smoothstep(0.15, 0.85, t));

    // ── warm glow concentrated around the sun's azimuth, hugging the horizon ──
    vec2 dh = normalize(d.xz + 1e-5);
    vec2 sh = normalize(uSunDir.xz);
    float az = dot(dh, sh) * 0.5 + 0.5;
    float sd = max(dot(d, uSunDir), 0.0);
    float band = 1.0 - smoothstep(-0.02, 0.3, t);
    // a rosy veil between the golden band and the blue keeps the blend from going grey
    float rosy = pow(az, 2.0) * smoothstep(0.02, 0.14, t) * (1.0 - smoothstep(0.14, 0.42, t));
    col = mix(col, vec3(0.93, 0.62, 0.7), rosy * 0.32 * (1.0 - uNight));
    float glow = pow(az, 3.0) * band * 0.75 + pow(sd, 16.0) * 0.38;
    col = mix(col, uSunGlow, clamp(glow, 0.0, 1.0) * mix(1.0, 0.35, uNight));

    // ── stars (procedural, so mountains & clouds occlude them correctly) ──
    if (uNight > 0.01 && uStars > 0.5) {
      vec3 sp = d * 62.0;
      vec3 cell = floor(sp);
      float h = envHash(cell.xy + cell.z * 17.31);
      if (h > 0.62) {
        vec3 off = vec3(envHash(cell.yz + 3.1), envHash(cell.zx + 7.7), envHash(cell.xy + 11.3)) - 0.5;
        float dist = length(fract(sp) - 0.5 - off * 0.5);
        float size = mix(0.07, 0.2, pow(fract(h * 13.7), 3.0));
        float tw = 0.6 + 0.4 * sin(uTime * (1.3 + 2.7 * fract(h * 7.3)) + h * 60.0);
        float star = smoothstep(size, size * 0.25, dist) * tw;
        vec3 sc = mix(vec3(1.0, 0.92, 0.78), vec3(0.78, 0.86, 1.0), fract(h * 3.7));
        col += sc * star * uNight * smoothstep(0.03, 0.2, y) * 1.4;
      }
    }

    // ── sun disc + halo ──
    float sunDisc = smoothstep(0.99905, 0.99935, dot(d, uSunDir));
    col += uSunGlow * (pow(sd, 260.0) * 0.9 + pow(sd, 40.0) * 0.25) * day;
    col = mix(col, vec3(1.25, 1.12, 0.9), sunDisc * day);

    // ── moon disc (soft craters, gentle gibbous shading) + halo ──
    float md = max(dot(d, uMoonDir), 0.0);
    if (uNight > 0.01) {
      vec3 mr = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
      vec3 mu = cross(mr, uMoonDir);
      vec2 ml = vec2(dot(d, mr), dot(d, mu)) / 0.042;
      float r = length(ml);
      vec3 moonCol = vec3(0.78, 0.8, 0.9);
      moonCol *= 0.8 + 0.2 * smoothstep(0.3, 0.7, envNoise(ml * 2.1 + 4.0));
      moonCol *= mix(0.55, 1.0, smoothstep(-0.9, -0.2, dot(ml, vec2(-0.75, -0.2))));
      float disc = smoothstep(1.0, 0.94, r) * step(0.0, dot(d, uMoonDir));
      col += vec3(0.5, 0.58, 0.95) * (pow(md, 900.0) * 0.35 + pow(md, 60.0) * 0.14) * uNight;
      col = mix(col, moonCol, disc * uNight);
    }

    // ── mountains ──
    if (y > -0.01 && y < 0.3) {
      float a = atan(d.x, -d.z) / TAU + 0.5;          // 0..1 around the horizon, 0.5 = north
      float sunA = atan(uSunDir.x, -uSunDir.z) / TAU + 0.5;
      float keyA = atan(uKeyDir.x, -uKeyDir.z) / TAU + 0.5;
      float lightA = mix(sunA, keyA, uNight);
      // 1 when the light is behind the viewer (faces turned to us are lit)
      float frontal = clamp(-dot(dh, normalize(uKeyDir.xz)) * 0.5 + 0.5, 0.0, 1.0);
      // the tallest Alps rise in the north, where the camera looks on arrival
      float north = smoothstep(-0.45, 0.85, -dh.y);
      float fw = fwidth(y) * 1.2 + 1e-4;

      // far snowy Alps
      float cellsF = 30.0;
      vec4 mf = range(a * cellsF, cellsF, 3.0, 0.035, 0.19, 0.75, 1.6, 1.3);
      mf.x *= mix(0.55, 1.0, north); mf.z *= mix(0.55, 1.0, north);
      // the Matterhorn: tall, narrow, leaning — slightly west of north
      float mx = wrapDelta(a, 0.468, 1.0) * cellsF;
      float mh = 0.25 * peakShape(mx + 0.08, 0.45, 0.8, 1.15);
      mh += 0.04 * peakShape(mx - 0.55, 0.5, 0.9, 1.3); // the Hörnli shoulder
      if (mh > mf.x) mf = vec4(mh, 0.468 * cellsF - 0.08, 0.25, mx < -0.08 ? 1.0 : 0.0);
      mf.x *= 1.0 + (envNoise(vec2(a * 260.0, 1.0)) - 0.5) * 0.06;
      float inF = smoothstep(-fw, fw, mf.x - y);
      if (inF > 0.0) {
        // the Matterhorn is rockier: its snow starts higher up
        float snowLine = mix(0.5, 0.66, step(abs(mx), 1.2));
        vec3 c = shadeMountain(uMountainFar, mf, a * cellsF, cellsF, lightA * cellsF, frontal, y, snowLine, 1.0);
        c = mix(c, uFogColor, (1.0 - smoothstep(0.0, mf.z * 0.75, y)) * 0.75);
        col = mix(col, c, inF);
      }

      // nearer forested foothills (rounded, no snow), hazier at the base
      float cellsM = 34.0;
      vec4 mm = rollingRange(a * cellsM, cellsM, 11.0, 0.012, 0.04, 0.7, 1.3);
      mm.x *= 1.0 + (envNoise(vec2(a * 420.0, 5.0)) - 0.5) * 0.05;
      float inM = smoothstep(-fw, fw, mm.x - y);
      if (inM > 0.0) {
        // a flat paper-cut layer: just a soft vertical gradient, no faces
        vec3 c = uMountainNear * mix(1.04, 0.9, clamp(y / max(mm.z, 1e-3), 0.0, 1.0)) * mix(0.9, 1.0, frontal);
        c = mix(c, uFogColor, (1.0 - smoothstep(0.0, mm.z * 0.9, y)) * 0.6);
        col = mix(col, c, inM);
      }
    }

    // ── below the horizon: exactly the fog colour, so fogged terrain melts in ──
    col = mix(col, uFogColor, 1.0 - smoothstep(-0.015, 0.008, y));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const cloudVertex = /* glsl */ `
  attribute float aShade;
  varying vec3 vN;
  varying vec3 vWPos;
  varying float vShade;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWPos = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vShade = aShade;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const cloudFragment = /* glsl */ `
  uniform vec3 uKeyDir, uSunDir, uCloudLit, uCloudShade, uSunGlow, uFogColor, uSkyHorizon;
  uniform float uNight;
  varying vec3 vN;
  varying vec3 vWPos;
  varying float vShade;
  void main() {
    vec3 n = normalize(vN);
    vec3 L = normalize(uKeyDir + vec3(0.0, 0.25, 0.0));
    float l = dot(n, L);
    // one soft toon terminator + a gentle top light
    float band = smoothstep(-0.1, 0.12, l) * 0.82 + smoothstep(0.35, 0.8, n.y) * 0.18;
    vec3 col = mix(uCloudShade, uCloudLit, band);
    col *= mix(0.86, 1.0, vShade);
    // warm kiss on the sun-facing side
    col = mix(col, col * vec3(1.04, 0.98, 0.9), smoothstep(0.3, 0.9, l) * (1.0 - uNight));
    // silver lining when looking towards the sun
    vec3 v = normalize(vWPos - cameraPosition);
    float edge = pow(1.0 - abs(dot(n, v)), 3.0);
    float towardSun = pow(max(dot(v, uSunDir), 0.0), 3.0);
    col += uSunGlow * edge * (0.18 + 0.9 * towardSun) * (1.0 - uNight);
    // aerial haze — low clouds melt into the horizon
    float haze = mix(0.38, 0.06, smoothstep(0.0, 0.3, v.y)) + uNight * 0.25;
    col = mix(col, mix(uFogColor, uSkyHorizon, 0.5), haze);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function buildClouds(rng, tier) {
  const count = tier === 'low' ? 8 : tier === 'medium' ? 11 : 14;
  const detail = tier === 'high' ? 2 : 1;
  const unit = new THREE.IcosahedronGeometry(1, detail);
  const parts = [];
  for (let c = 0; c < count; c++) {
    const width = rng.range(50, 95);
    const puffs = rng.int(7, 10);
    const cloud = [];
    const add = (r, x, y, z, flat = 0.85) => {
      const g = unit.clone();
      g.scale(r, r * flat, r * 0.9);
      g.translate(x, y, z);
      cloud.push(g);
    };
    // base row: a chain of flattened puffs, fattest in the middle
    for (let p = 0; p < puffs; p++) {
      const t = p / (puffs - 1) - 0.5;
      const bell = 1 - 4 * t * t;
      const r = width * (0.07 + 0.11 * bell) * rng.range(0.85, 1.15);
      add(r, t * width * 0.88 + rng.jitter(2), r * 0.3 + bell * width * 0.05 + rng.range(0, width * 0.025), rng.jitter(width * 0.06), 0.8);
    }
    // crown: one to three big round puffs
    const crowns = rng.int(1, 3);
    for (let k = 0; k < crowns; k++) {
      const r = width * rng.range(0.15, 0.22);
      add(r, rng.jitter(width * 0.2), width * 0.1 + r * 0.4, rng.jitter(width * 0.05), 0.92);
    }
    const g = mergeGeometries(cloud);
    cloud.forEach((x) => x.dispose());
    // flat bottoms + vertical shade gradient
    const pos = g.attributes.position;
    let maxY = 0;
    for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
    const shade = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const yv = pos.getY(i);
      if (yv < 0) pos.setY(i, yv * 0.18);
      shade[i] = THREE.MathUtils.clamp(pos.getY(i) / (maxY * 0.55), 0, 1);
    }
    g.setAttribute('aShade', new THREE.BufferAttribute(shade, 1));
    // A ring around the valley: most clouds sit just above the treeline.
    const az = (c / count) * Math.PI * 2 + rng.jitter(0.2);
    const dist = rng.range(230, 330);
    const elev = c % 5 === 2 ? rng.range(0.2, 0.3) : rng.range(0.08, 0.17);
    const sc = rng.range(0.9, 1.2);
    g.scale(sc, sc * rng.range(0.85, 1.05), sc);
    g.rotateY(-az + Math.PI / 2 + rng.jitter(0.3));
    g.translate(Math.sin(az) * dist, Math.tan(elev) * dist, -Math.cos(az) * dist);
    parts.push(g);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((x) => x.dispose());
  unit.dispose();
  return merged;
}

export default async function build(ctx) {
  const { scene, engine, camera } = ctx;
  const tier = ctx.quality?.tier ?? 'high';
  const U = envUniforms;

  // ── dome ──
  const domeMat = new THREE.ShaderMaterial({
    name: 'sky-dome',
    uniforms: {
      uSkyZenith: U.uSkyZenith, uSkyMid: U.uSkyMid, uSkyHorizon: U.uSkyHorizon, uFogColor: U.uFogColor,
      uSunGlow: U.uSunGlow, uSunDir: U.uSunDir, uMoonDir: U.uMoonDir, uKeyDir: U.uKeyDir,
      uMountainFar: U.uMountainFar, uMountainNear: U.uMountainNear, uSnowLit: U.uSnowLit, uSnowShade: U.uSnowShade,
      uNight: U.uNight, uTime: U.uTime,
      uStars: { value: 1 },
    },
    vertexShader: domeVertex,
    fragmentShader: domeFragment,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), domeMat);
  dome.name = 'sky-dome';
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  dome.matrixAutoUpdate = false;
  scene.add(dome);

  // ── clouds ──
  const cloudMat = new THREE.ShaderMaterial({
    name: 'sky-clouds',
    uniforms: {
      uKeyDir: U.uKeyDir, uSunDir: U.uSunDir, uCloudLit: U.uCloudLit, uCloudShade: U.uCloudShade,
      uSunGlow: U.uSunGlow, uFogColor: U.uFogColor, uSkyHorizon: U.uSkyHorizon, uNight: U.uNight,
    },
    vertexShader: cloudVertex,
    fragmentShader: cloudFragment,
    fog: false,
    toneMapped: false,
  });
  const clouds = new THREE.Mesh(buildClouds(createRng('clouds'), tier), cloudMat);
  clouds.name = 'sky-clouds';
  clouds.frustumCulled = false;
  clouds.castShadow = false;
  clouds.receiveShadow = false;
  scene.add(clouds);

  // ── fog & background follow the horizon ──
  if (!scene.fog || !scene.fog.isFog) scene.fog = new THREE.Fog(0xffffff, 40, 220);
  if (!scene.background || !scene.background.isColor) scene.background = new THREE.Color();

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
  const drift = engine.reducedMotion ? 0.0012 : 0.004;

  function update(dt) {
    const n = ctx.env?.night ?? 0;
    if (n !== lastNight) {
      lastNight = n;
      for (const k of colourKeys) colourTargets[k].copy(pairs[k][0]).lerp(pairs[k][1], n);
      scene.fog.color.copy(U.uFogColor.value);
      scene.background.copy(U.uFogColor.value);
    }
    // Adaptive fog distance: crisp diorama when zoomed out, soft depth up close.
    const rig = ctx.cameraRig;
    if (rig?.target) focus.copy(rig.target);
    else focus.set(0, 0, 0);
    const camDist = camera.position.distanceTo(focus);
    const nightK = 1 - 0.18 * n;
    scene.fog.near = (30 + camDist * 0.75) * nightK;
    scene.fog.far = (scene.fog.near + 160 + camDist * 1.25) * nightK;

    clouds.rotation.y += dt * drift;
  }

  // After the camera (order 80) so fog matches this frame's camera.
  engine.addUpdate(update, 86);
  update(0);

  ctx.sky = { dome, clouds, uniforms: U };
  return {};
}
