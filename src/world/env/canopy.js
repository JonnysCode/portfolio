// ─────────────────────────────────────────────────────────────────────────────
// Canopy cookie — dappled sunlight on everything the sun touches.
//
// The glen is a clearing under a high canopy: real sunlight there arrives as
// flecks — round-ish pools of light (pinhole images of the sun through leaf
// gaps) drifting gently as the leaves move — over a softer, leaf-filtered
// half shade. The shadow map gives the big shapes (trunks, crowns); this adds
// the leaf-scale breakup that the shadow map cannot resolve.
//
// A global patch of three's light chunks (like env/fog.js does for fog), so
// EVERY lit built-in material (standard, physical, lambert, phong, toon — and
// every onBeforeCompile variant of them: terrain, vegetation, buildings,
// props, water) gets the same cookie without any per-material work:
//
//   • the key light (directional light 0 — the sun by day, the moon by night;
//     lighting.js adds it before the rim light) is multiplied by a world-space
//     leaf-gap pattern, projected ALONG the light direction from a virtual
//     canopy plane, so the flecks on the ground, on walls, roofs and trunks
//     all agree (vertical surfaces get the long slanted streaks of real dapples);
//   • the pattern: two drifting value-noise octaves thresholded into
//     high-contrast flecks (≈ 0.5–2.5 units), with a slow regional density so
//     sunny openings alternate with denser shade instead of an even leopard
//     print; fades out up in the canopy (the crowns are the occluders);
//   • a CLEARING (canopyParams.c): a soft round opening over the middle of
//     the glen where the flecks grow denser and merge into a sunlit meadow —
//     the bright heart of the composition (golden ground under the god rays);
//   • the uniforms are shared live Float32Arrays (UniformsUtils.clone copies
//     typed arrays by reference), registered in ShaderLib / UniformsLib.lights
//     before anything compiles. A material compiled without them sees zeros,
//     which means "off".
//
// Cost: only fragments the key light actually reaches evaluate it (shadowed
// ones skip it), 2–3 value-noise lookups; the detail octave is off on the
// phone tiers (lighting.js sets b.w from ctx.quality).
//
// canopyParams.a = [time, strength, canopy plane height, fade start height]
// canopyParams.b = [shade level, fleck gain, pattern frequency, detail octave (0/1)]
// canopyParams.c = [clearing centre x, z, radius, strength (0 = none)]
// canopyParams.d = [fleck threshold bias (+ = fewer, smaller flecks), extra bias up
//   in the crowns, the height where that bias starts (+10 to full), –]
//   ('low' — no shadow map — leans on the cookie alone: it reaches up into the
//   crowns there and its flecks are sparser; lighting.js sets a.w and d.x)
// installCanopy() is idempotent and runs on import.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

export const canopyParams = {
  a: new Float32Array([0, 1, 22, 15]),
  b: new Float32Array([0.3, 1.3, 0.42, 1]),
  c: new Float32Array([0, 0, 1, 0]),
  d: new Float32Array([0, 0, 0, 0]),
};

const EXTRA_UNIFORMS = {
  woodlandCanopyA: { value: canopyParams.a },
  woodlandCanopyB: { value: canopyParams.b },
  woodlandCanopyC: { value: canopyParams.c },
  woodlandCanopyD: { value: canopyParams.d },
};

const PARS = /* glsl */ `
uniform vec4 woodlandCanopyA;
uniform vec4 woodlandCanopyB;
uniform vec4 woodlandCanopyC;
uniform vec4 woodlandCanopyD;
float wcHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float wcNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( wcHash( i ), wcHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( wcHash( i + vec2( 0.0, 1.0 ) ), wcHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
// Leaf-gap cookie for the key light at a view-space position (light direction in view space).
vec3 woodlandCanopy( vec3 viewPos, vec3 lightDirView ) {
	if ( woodlandCanopyA.y <= 0.0 ) return vec3( 1.0 );
	vec3 wp = ( viewPos - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );
	float k = woodlandCanopyA.y * ( 1.0 - smoothstep( woodlandCanopyA.w, woodlandCanopyA.w + 14.0, wp.y ) );
	if ( k <= 0.002 ) return vec3( 1.0 );
	vec3 L = lightDirView * mat3( viewMatrix );
	// follow the light ray up to the canopy plane: the leaf gap this point sees
	vec2 q = wp.xz + L.xz * ( ( woodlandCanopyA.z - wp.y ) / max( L.y, 0.3 ) );
	float t = woodlandCanopyA.x;
	// leaves sway (the flecks shimmer and slide back and forth) + a very slow drift
	vec2 sway = vec2( sin( t * 0.37 ) + 0.4 * sin( t * 0.91 + 1.3 ), cos( t * 0.29 ) + 0.35 * sin( t * 0.77 ) ) * 0.12;
	vec2 p = q * woodlandCanopyB.z + sway + vec2( t * 0.012, - t * 0.008 );
	float n = wcNoise( p );
	if ( woodlandCanopyB.w > 0.5 ) {
		vec2 p2 = mat2( 0.8, - 0.6, 0.6, 0.8 ) * p * 2.37 - sway * 1.7 + 17.3;
		n = n * 0.64 + wcNoise( p2 ) * 0.36;
	}
	// sunny openings vs dense leaf cover (a few metres across)
	float region = wcNoise( q * 0.075 + 3.7 );
	// the glen's sunny clearing: denser, merging flecks (ground position)
	vec2 dc = wp.xz - woodlandCanopyC.xy;
	float clearing = woodlandCanopyC.w * exp( - dot( dc, dc ) / max( woodlandCanopyC.z * woodlandCanopyC.z, 1e-3 ) );
	float thr = mix( 0.66, 0.43, region ) - 0.2 * clearing + woodlandCanopyD.x + woodlandCanopyD.y * smoothstep( woodlandCanopyD.z, woodlandCanopyD.z + 10.0, wp.y );
	// crisp edges, widened with distance so they never shimmer into speckle
	// (an estimate of the pattern's change per pixel — no derivatives, so it
	// is safe inside the lit-only branch)
	float aa = 0.03 + 0.0007 * length( viewPos ) * woodlandCanopyB.z;
	float fleck = smoothstep( thr - aa, thr + aa, n );
	// leaf-filtered half shade is a touch cooler; the flecks are pure sun
	vec3 c = mix( woodlandCanopyB.x * vec3( 0.94, 1.0, 1.02 ), vec3( woodlandCanopyB.y ), fleck );
	return mix( vec3( 1.0 ), c, k );
}
`;

const DIR_BLOCK = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const DIR_CALL = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const COOKIE = /* glsl */ `
		#if UNROLLED_LOOP_INDEX == 0
		if ( directLight.color.r + directLight.color.g + directLight.color.b > 1e-4 ) directLight.color *= woodlandCanopy( geometryPosition, directLight.direction );
		#endif
		`;

let installed = false;

/** Patch three's light chunks + register the canopy uniforms. Safe to call repeatedly. */
export function installCanopy() {
  if (installed) return;
  installed = true;
  const begin = THREE.ShaderChunk.lights_fragment_begin;
  const at = begin.indexOf(DIR_BLOCK);
  const call = at >= 0 ? begin.indexOf(DIR_CALL, at) : -1;
  if (call < 0) {
    console.warn('[canopy] three light chunk changed — dappled sunlight disabled');
    return;
  }
  THREE.ShaderChunk.lights_fragment_begin = begin.slice(0, call) + COOKIE + begin.slice(call);
  THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin + PARS;
  for (const key of Object.keys(THREE.ShaderLib)) {
    const u = THREE.ShaderLib[key].uniforms;
    if (u && u.directionalLights) Object.assign(u, EXTRA_UNIFORMS);
  }
  Object.assign(THREE.UniformsLib.lights, EXTRA_UNIFORMS);
}

installCanopy();
