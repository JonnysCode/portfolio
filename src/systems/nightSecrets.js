// ─────────────────────────────────────────────────────────────────────────────
// Night secrets — little discoveries that only exist after dark (press N).
// They count towards "secrets found" like the daytime ones, but are disabled
// (unpickable, uncounted by the day hint) while the sun is up.
//
//   • the moon in the lily pond — make a wish (a swirl of golden sparks)
//   • the Code Loft's telescope — someone left it pointed at Saturn
//   • the heart of the fairy ring — wisps rise and dance
//
// Each is an invisible pick proxy (material.visible = false: never drawn, but
// raycastable) registered with ctx.interactions ({ kind: 'secret', night: true }).
// One small Points burst (drawn only while it plays) is the shared effect.
//
//   createNightSecrets(ctx) → { burst(position, { radius, color }) } | null
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { STREAM } from '../world/layout.js';
import { getHeight } from '../world/ground.js';

const N = 48;

export function createNightSecrets(ctx) {
  const it = ctx.interactions;
  if (!it?.add) return null;
  const reduced = !!ctx.engine?.reducedMotion;
  const group = new THREE.Group();
  group.name = 'night-secrets';
  ctx.scene.add(group);
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  function proxy(geo, pos, name) {
    const m = new THREE.Mesh(geo, hidden);
    m.name = name;
    m.position.copy(pos);
    m.userData.__hotspotProxy = true;
    m.castShadow = m.receiveShadow = false;
    group.add(m);
    m.updateMatrixWorld(true);
    return m;
  }

  // ── the shared burst: sparks spiralling up from a disc ────────────────────
  const seeds = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    seeds[i * 4] = Math.random() * Math.PI * 2; // angle
    seeds[i * 4 + 1] = Math.sqrt(Math.random()); // radius 0..1
    seeds[i * 4 + 2] = 0.6 + Math.random() * 0.8; // speed
    seeds[i * 4 + 3] = Math.random(); // phase
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uR: { value: 1 }, uColor: { value: new THREE.Color('#ffe08a') }, uColor2: { value: new THREE.Color('#c8fff0') }, uPx: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uT;
      uniform float uR;
      uniform float uPx;
      varying float vA;
      varying float vMix;
      void main() {
        float t = uT * aSeed.z;
        float a = aSeed.x + t * (1.6 + aSeed.w);
        float r = uR * aSeed.y * (1.0 - 0.45 * smoothstep(0.0, 2.6, t));
        vec3 p = position + vec3(cos(a) * r, t * 0.9 + sin(t * 3.0 + aSeed.w * 6.0) * 0.08, sin(a) * r);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float life = smoothstep(0.0, 0.25, uT - aSeed.w * 0.5) * (1.0 - smoothstep(2.2, 3.4, uT));
        vA = life * (0.65 + 0.35 * sin(uT * 9.0 + aSeed.w * 20.0));
        vMix = aSeed.w;
        gl_PointSize = clamp(90.0 / max(0.5, -mv.z), 3.0, 22.0) * uPx;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uColor2;
      varying float vA;
      varying float vMix;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r = length(q);
        float a = (exp(-r * r * 9.0) + exp(-abs(q.x) * 18.0) * exp(-abs(q.y) * 3.0) * 0.4 + exp(-abs(q.y) * 18.0) * exp(-abs(q.x) * 3.0) * 0.4) * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(mix(uColor, uColor2, vMix) * 1.6, a);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'night-secret-burst';
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 7;
  group.add(points);
  let burstT = -1;
  function burst(pos, { radius = 1, color = '#ffe08a', color2 = '#c8fff0' } = {}) {
    if (reduced) return;
    points.position.copy(pos);
    mat.uniforms.uR.value = radius;
    mat.uniforms.uColor.value.set(color);
    mat.uniforms.uColor2.value.set(color2);
    burstT = 0;
    points.visible = true;
  }
  ctx.engine.addUpdate((dt) => {
    if (burstT < 0) return;
    burstT += dt;
    mat.uniforms.uT.value = burstT;
    mat.uniforms.uPx.value = ctx.engine.renderer.getPixelRatio() || 1;
    if (burstT > 3.6) {
      burstT = -1;
      points.visible = false;
    }
  }, 30);

  const speak = (text, at) => ctx.ui?.speech?.(text, at);

  // ── 1. the moon in the lily pond: make a wish ─────────────────────────────
  {
    const P = STREAM.pond;
    const y = (STREAM.waterLevel ?? -0.5) + 0.03;
    const disc = proxy(new THREE.CylinderGeometry(P.radius * 0.72, P.radius * 0.72, 0.12, 20), new THREE.Vector3(P.x, y, P.z), 'night-secret-pond');
    const at = new THREE.Vector3(P.x, y, P.z);
    it.add(disc, {
      kind: 'secret',
      night: true,
      area: 'glen',
      secretId: 'night:pond-moon',
      label: 'The moon in the lily pond…',
      focus: { distance: 6.5, lift: 0.4 },
      markerHeight: 0.9,
      onActivate: () => {
        burst(at, { radius: P.radius * 0.55, color: '#ffe3a0', color2: '#fff8e6' });
        speak('You made a wish on the moon. Shh — it only works if you don’t tell.', at);
      },
    });
  }

  // ── 2. the telescope on the Code Loft ─────────────────────────────────────
  {
    const tp = ctx.sites?.loft?.anchors?.telescope;
    if (tp) {
      const sphere = proxy(new THREE.SphereGeometry(0.55, 10, 8), new THREE.Vector3(tp.x, tp.y + 0.05, tp.z), 'night-secret-telescope');
      const at = new THREE.Vector3(tp.x, tp.y + 0.2, tp.z);
      it.add(sphere, {
        kind: 'secret',
        night: true,
        area: 'code',
        secretId: 'night:telescope',
        label: 'A telescope, pointed at the sky…',
        focus: { distance: 2.6, lift: 0.1 },
        onActivate: () => {
          burst(new THREE.Vector3(tp.x, tp.y + 0.9, tp.z), { radius: 0.35, color: '#e9f0ff', color2: '#ffe9b0' });
          speak('Saturn, with its rings! And the moon is so close tonight.', at);
        },
      });
    }
  }

  // ── 3. the heart of the fairy ring: wisps ─────────────────────────────────
  {
    const ring = ctx.scene.getObjectByName('fairy-ring');
    if (ring) {
      const box = new THREE.Box3().setFromObject(ring);
      if (!box.isEmpty()) {
        const c = box.getCenter(new THREE.Vector3());
        const gy = getHeight(c.x, c.z);
        // only the ring's mossy heart (the toadstools themselves stay the daytime secret)
        const heart = proxy(new THREE.CylinderGeometry(0.62, 0.62, 0.5, 14), new THREE.Vector3(c.x, gy + 0.2, c.z), 'night-secret-ring');
        const at = new THREE.Vector3(c.x, gy + 0.2, c.z);
        it.add(heart, {
          kind: 'secret',
          night: true,
          area: 'glen',
          secretId: 'night:fairy-wisps',
          label: 'Something stirs in the fairy ring…',
          focus: { distance: 3.4, lift: 0.3 },
          onActivate: () => {
            burst(at, { radius: 1.05, color: '#c8fff0', color2: '#d9c8ff' });
            speak('The wisps are dancing! They only come out by moonlight.', at);
          },
        });
      }
    }
  }

  return { burst };
}
