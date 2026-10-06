// ─────────────────────────────────────────────────────────────────────────────
// "Is this point of air in sunlight?" for custom shaders.
//
// Samples the sun's shadow map (hardware PCF compare) at a world position, so
// god rays, dust motes and mist light up exactly where the canopy lets the
// sun through — they always agree with the dappled shadows on the ground,
// whatever the forest builders grow. Works in vertex and fragment shaders.
//
//   uniforms: { ...sunlightUniforms }          (shared objects — do not clone)
//   GLSL:     ${SUNLIGHT_GLSL}  →  float sunVisibility(vec3 worldPos)   0 = shadowed … 1 = lit
//
// updateSunlight(ctx) is called once per frame by atmosphere.js (the shadow
// map texture only exists after the first shadow render).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

export const sunlightUniforms = {
  uSunShadowMap: { value: null },
  uSunShadowMatrix: { value: new THREE.Matrix4() },
  /** x: 1 = shadow map available, y: compare bias, z: outside-frustum value */
  uSunShadowParams: { value: new THREE.Vector3(0, 0.0012, 1) },
};

export const SUNLIGHT_GLSL = /* glsl */ `
  uniform sampler2DShadow uSunShadowMap;
  uniform mat4 uSunShadowMatrix;
  uniform vec3 uSunShadowParams;
  float sunVisibility(vec3 wp) {
    if (uSunShadowParams.x < 0.5) return 1.0;
    vec4 sc = uSunShadowMatrix * vec4(wp, 1.0);
    vec3 p = sc.xyz / sc.w;
    if (p.x <= 0.001 || p.x >= 0.999 || p.y <= 0.001 || p.y >= 0.999 || p.z >= 1.0) return uSunShadowParams.z;
    return texture(uSunShadowMap, vec3(p.xy, p.z - uSunShadowParams.y));
  }
`;

let bound = false;
let dummy = null;

/**
 * A 1×1 cleared depth target with compare mode, bound until the real shadow map
 * exists (and forever on tiers without shadows): a shadow sampler must never see
 * a non-depth texture, and three does not upload an empty DepthTexture.
 */
function dummyShadowTexture(renderer) {
  if (dummy) return dummy.depthTexture;
  const depthTexture = new THREE.DepthTexture(1, 1);
  depthTexture.compareFunction = THREE.LessEqualCompare;
  depthTexture.minFilter = depthTexture.magFilter = THREE.LinearFilter;
  dummy = new THREE.WebGLRenderTarget(1, 1, { depthTexture });
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(dummy);
  renderer.clear(true, true, false);
  renderer.setRenderTarget(prev);
  return dummy.depthTexture;
}

/** Bind the live shadow map (call every frame; cheap). */
export function updateSunlight(ctx) {
  const sun = ctx.lights?.sun;
  const tex = sun?.castShadow && ctx.engine.renderer.shadowMap.enabled ? sun.shadow.map?.depthTexture : null;
  if (tex) {
    if (!bound) {
      sunlightUniforms.uSunShadowMatrix.value = sun.shadow.matrix; // live reference, updated by three
      bound = true;
    }
    sunlightUniforms.uSunShadowMap.value = tex;
    sunlightUniforms.uSunShadowParams.value.x = 1;
  } else {
    sunlightUniforms.uSunShadowMap.value = dummyShadowTexture(ctx.engine.renderer);
    sunlightUniforms.uSunShadowParams.value.x = 0;
  }
}
