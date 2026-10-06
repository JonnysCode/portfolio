// ─────────────────────────────────────────────────────────────────────────────
// Soft point-sprite helpers shared by the ambient particle layers.
// Point sizes are given in WORLD units; uScale converts them to pixels
// (updated from the camera / drawing buffer every frame by updatePointScale).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

/** Shared uniforms for every ambient point layer. */
export const pointUniforms = {
  uScale: { value: 400 },
  uFogNear: { value: 60 },
  uFogFar: { value: 190 },
};

const _size = new THREE.Vector2();

/** Call once per frame (cheap) so sizes follow resizes, FOV and fog changes. */
export function updatePointScale(renderer, camera, fog) {
  renderer.getDrawingBufferSize(_size);
  pointUniforms.uScale.value = _size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
  if (fog && fog.isFog) {
    pointUniforms.uFogNear.value = fog.near;
    pointUniforms.uFogFar.value = fog.far;
  } else if (fog && fog.isFogExp2) {
    pointUniforms.uFogNear.value = 0;
    pointUniforms.uFogFar.value = 2.2 / Math.max(fog.density, 1e-4);
  }
}

/** GLSL: soft disc with a bright core (r = 0 centre → 1 edge). */
export const SOFT_DISC = /* glsl */ `
float softCore(vec2 pc, float coreSize, out float halo) {
  float r = length(pc - 0.5) * 2.0;
  halo = exp(-r * r * 3.2) * (1.0 - smoothstep(0.85, 1.0, r));
  return 1.0 - smoothstep(0.0, coreSize, r);
}
`;

/** GLSL: alpha falloff with distance (fog-ish) and close to the lens. */
export const DIST_FADE = /* glsl */ `
float distFade(float d) {
  return (1.0 - smoothstep(uFogNear + (uFogFar - uFogNear) * 0.2, uFogFar * 0.85, d)) * smoothstep(0.6, 2.5, d);
}
`;
