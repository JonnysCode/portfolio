// ─────────────────────────────────────────────────────────────────────────────
// Aerial perspective — a global replacement for three.js' fog shader chunks.
//
// Every built-in material (and every ShaderMaterial with `fog: true` that
// includes the fog chunks) gets the glen's atmosphere instead of plain linear
// fog:
//
//   • distance haze   ramps from fogNear to fogFar (scene.fog, adapted to the
//                     camera every frame by sky.js) with a soft filmic curve,
//                     so the glen stays crisp and the far forest dissolves;
//   • height mist     the analytic integral of an exponential ground-hugging
//                     density along the view ray — low hollows, the stream and
//                     the feet of the far trunks sink into mist while canopy
//                     tops stay readable;
//   • sun in-scatter  the mist colour shifts from cool blue-green towards a
//                     warm golden haze when looking towards the sun (fades
//                     out at night, when the moon gives a faint cool glow).
//
// The extra parameters travel in four vec4 uniforms whose VALUES are shared
// Float32Arrays. UniformsUtils.clone() copies typed arrays by reference, so
// adding them to ShaderLib / UniformsLib.fog once makes every material that
// is compiled afterwards read the live values — no per-material bookkeeping.
// Materials that lack them (a ShaderMaterial built from its own uniform list)
// see zeros and fall back to classic linear fog (fogMisc.w = 0).
//
// Like three's own chunk, <fog_fragment> must come AFTER <tonemapping_fragment>
// and <colorspace_fragment> (it converts the mist colour to display space
// itself, which is a no-op when rendering into the HDR post target).
//
// installFog() is idempotent and runs on import, so importing this file from
// the first world module (lighting.js) patches the chunks before anything
// compiles. Custom shaders:  uniforms: { ...fogUniforms(), ...mine }, fog: true
// and the usual  #include <fog_pars_vertex> / <fog_vertex> (after mvPosition)
// / <fog_pars_fragment> / <fog_fragment>.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

/** Live fog parameters (linear colours). atmosphere/sky write these each frame. */
export const fogParams = {
  /** xyz: direction towards the sun/moon glow, w: in-scatter strength (0..1). */
  sun: new Float32Array([0, 0.5, -1, 0.85]),
  /** rgb: warm in-scatter colour (linear), w: exponent of the sun lobe. */
  warm: new Float32Array([1.0, 0.72, 0.38, 5.0]),
  /** x: ground mist density, y: height falloff, z: mist base height, w: max fog opacity. */
  height: new Float32Array([0.018, 0.32, -0.6, 0.985]),
  /** x: distance curve exponent, y: distance strength, z: night, w: 1 = enabled. */
  misc: new Float32Array([1.6, 2.2, 0, 1]),
};

const EXTRA_UNIFORMS = {
  fogSun: { value: fogParams.sun },
  fogWarm: { value: fogParams.warm },
  fogHeight: { value: fogParams.height },
  fogMisc: { value: fogParams.misc },
};

const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif
`;

const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // view space → world space (the view matrix is a rigid transform: R^T (p - t))
  vFogWorldPos = ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );
#endif
`;

const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  uniform vec4 fogSun;
  uniform vec4 fogWarm;
  uniform vec4 fogHeight;
  uniform vec4 fogMisc;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif

  // Aerial perspective for a world-space point: rgb = mist colour (linear), a = opacity.
  vec4 woodlandFog( vec3 worldPos ) {
    vec3 ray = worldPos - cameraPosition;
    float dist = length( ray );
    vec3 dir = ray / max( dist, 1e-4 );
    #ifdef FOG_EXP2
      float distF = 1.0 - exp( - fogDensity * fogDensity * dist * dist );
    #else
      float t = max( dist - fogNear, 0.0 ) / max( fogFar - fogNear, 1e-3 );
      float distF = 1.0 - exp( - pow( t, fogMisc.x ) * fogMisc.y );
    #endif
    // ground mist: ∫ a·exp(−b·(y − y0)) along the ray, in closed form
    float a = fogHeight.x;
    float b = max( fogHeight.y, 1e-3 );
    float hc = cameraPosition.y - fogHeight.z;
    float hp = worldPos.y - fogHeight.z;
    float mist;
    if ( abs( dir.y ) > 1e-3 ) {
      mist = a * ( exp( - b * hc ) - exp( - b * hp ) ) / ( b * dir.y );
    } else {
      mist = a * dist * exp( - b * hc );
    }
    mist = max( mist, 0.0 );
    float f = 1.0 - ( 1.0 - distF ) * exp( - mist );
    // looking into the sun the mist glows warm; elsewhere it stays cool
    float sunLobe = pow( max( dot( dir, fogSun.xyz ), 0.0 ), fogWarm.w ) * fogSun.w;
    vec3 col = mix( fogColor, fogWarm.rgb, clamp( sunLobe, 0.0, 1.0 ) );
    return vec4( col, min( f, fogHeight.w ) );
  }
#endif
`;

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  {
    vec4 fogV;
    if ( fogMisc.w > 0.5 ) {
      fogV = woodlandFog( vFogWorldPos );
    } else {
      #ifdef FOG_EXP2
        fogV = vec4( fogColor, 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth ) );
      #else
        fogV = vec4( fogColor, smoothstep( fogNear, fogFar, vFogDepth ) );
      #endif
    }
    vec3 fogCol = fogV.rgb;
    // Built-in materials apply fog after tone mapping & output encoding; bring the
    // mist colour into the same space so it matches the HDR (post) path exactly.
    float fogA = fogV.a;
    #ifdef TONE_MAPPING
      fogCol = toneMapping( fogCol );
      // mixing in display space reads thinner than in linear HDR — compensate
      fogA = 1.0 - pow( 1.0 - fogA, 1.6 );
    #endif
    fogCol = linearToOutputTexel( vec4( fogCol, 1.0 ) ).rgb;
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogA );
  }
#endif
`;

/**
 * GLSL for custom shaders that want the same aerial perspective without the
 * fog chunks (e.g. the sky dome & backdrop): declares the uniforms above plus
 *   vec4 woodlandFogAt(vec3 worldPos, vec3 fogColor, float fogNear, float fogFar)
 * Pass `fogUniforms()` in the material's uniforms.
 */
export const FOG_GLSL = /* glsl */ `
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform vec4 fogSun;
  uniform vec4 fogWarm;
  uniform vec4 fogHeight;
  uniform vec4 fogMisc;
  vec3 woodlandFogColor( vec3 dir ) {
    float sunLobe = pow( max( dot( dir, fogSun.xyz ), 0.0 ), fogWarm.w ) * fogSun.w;
    return mix( fogColor, fogWarm.rgb, clamp( sunLobe, 0.0, 1.0 ) );
  }
  vec4 woodlandFogAt( vec3 worldPos ) {
    vec3 ray = worldPos - cameraPosition;
    float dist = length( ray );
    vec3 dir = ray / max( dist, 1e-4 );
    float t = max( dist - fogNear, 0.0 ) / max( fogFar - fogNear, 1e-3 );
    float distF = 1.0 - exp( - pow( t, fogMisc.x ) * fogMisc.y );
    float a = fogHeight.x;
    float b = max( fogHeight.y, 1e-3 );
    float hc = cameraPosition.y - fogHeight.z;
    float hp = worldPos.y - fogHeight.z;
    float mist = abs( dir.y ) > 1e-3 ? a * ( exp( - b * hc ) - exp( - b * hp ) ) / ( b * dir.y ) : a * dist * exp( - b * hc );
    float f = 1.0 - ( 1.0 - distF ) * exp( - max( mist, 0.0 ) );
    return vec4( woodlandFogColor( dir ), min( f, fogHeight.w ) );
  }
`;

let installed = false;

/** Patch three's fog chunks + register the extra uniforms. Safe to call repeatedly. */
export function installFog() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = FOG_PARS_VERTEX;
  THREE.ShaderChunk.fog_vertex = FOG_VERTEX;
  THREE.ShaderChunk.fog_pars_fragment = FOG_PARS_FRAGMENT;
  THREE.ShaderChunk.fog_fragment = FOG_FRAGMENT;
  // Built-in materials clone their ShaderLib uniforms when compiled …
  for (const key of Object.keys(THREE.ShaderLib)) {
    const u = THREE.ShaderLib[key].uniforms;
    if (u && u.fogColor) Object.assign(u, EXTRA_UNIFORMS);
  }
  // … and custom shaders usually merge UniformsLib.fog.
  Object.assign(THREE.UniformsLib.fog, EXTRA_UNIFORMS);
}

/**
 * Fog uniforms for a custom ShaderMaterial with `fog: true` (the renderer keeps
 * fogColor/near/far in sync with scene.fog; the extras are shared live arrays).
 */
export function fogUniforms() {
  installFog();
  return THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
}

installFog();
