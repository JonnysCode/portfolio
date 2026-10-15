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
//   in the crowns, the height where that bias starts (+10 to full), number of
//   indoor volumes]
//   ('low' — no shadow map — leans on the cookie alone: it reaches up into the
//   crowns there and its flecks are sparser; lighting.js sets a.w and d.x)
//
// INDOOR VOLUMES (addIndoorVolume, exposed as ctx.lights.addIndoorVolume): up
// to MAX_INDOOR yawed boxes (room interiors: the annex workshop, …) inside
// which every directional light — the sun / moon key with its flecks and the
// rim — is switched off. A closed room under a roof never gets canopy flecks
// on its floor, whatever the shadow map resolves (thin roofs, small casters
// trimmed out of the shadow pass, gaps between shingles). The hemisphere, the
// environment and the warm point lights keep lighting the room. 8 floats per
// box: indoorA = centre xyz + cos(yaw), indoorB = half size xyz + sin(yaw).
// installCanopy() is idempotent and runs on import.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

/** Most indoor volumes (room interiors without sun) at once. */
export const MAX_INDOOR = 8;

export const canopyParams = {
  a: new Float32Array([0, 1, 22, 15]),
  b: new Float32Array([0.3, 1.3, 0.42, 1]),
  c: new Float32Array([0, 0, 1, 0]),
  d: new Float32Array([0, 0, 0, 0]),
  /** indoor volumes: centre xyz + cos(yaw) per box (d.w = how many are live) */
  indoorA: new Float32Array(MAX_INDOOR * 4),
  /** indoor volumes: half size xyz + sin(yaw) per box */
  indoorB: new Float32Array(MAX_INDOOR * 4),
};

const EXTRA_UNIFORMS = {
  woodlandCanopyA: { value: canopyParams.a },
  woodlandCanopyB: { value: canopyParams.b },
  woodlandCanopyC: { value: canopyParams.c },
  woodlandCanopyD: { value: canopyParams.d },
  woodlandIndoorA: { value: canopyParams.indoorA },
  woodlandIndoorB: { value: canopyParams.indoorB },
};

const _c = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
/**
 * Switch the directional lights (sun / moon key incl. its canopy flecks, and the
 * rim) off inside a room. `box` (THREE.Box3) is the room's INTERIOR: the inner
 * faces of its walls, floor to ceiling. It is padded a little (0.04 sideways and
 * up — the outer faces of a wall ≥ 0.1 thick stay sunlit — and 0.3 down, so the
 * floor boards are well inside). opts:
 *   rotY     yaw of the room about the box centre (a world-space box that is
 *            really rotated — the annex), or
 *   matrix   a Matrix4 (e.g. object.matrixWorld): `box` is in that local space
 *            (position, yaw and scale are taken from it).
 *   pad      sideways / up padding (default 0.04), padDown (default 0.3).
 * Returns the volume's index, or -1 when all MAX_INDOOR slots are taken.
 */
export function addIndoorVolume(box, opts = {}) {
  const n = canopyParams.d[3] | 0;
  if (!box || box.isEmpty?.() || n >= MAX_INDOOR) return -1;
  box.getCenter(_c);
  box.getSize(_s).multiplyScalar(0.5);
  let yaw = opts.rotY ?? 0;
  if (opts.matrix) {
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    opts.matrix.decompose(pos, _q, sc);
    _c.applyMatrix4(opts.matrix);
    _s.multiply(sc.set(Math.abs(sc.x), Math.abs(sc.y), Math.abs(sc.z)));
    yaw = _e.setFromQuaternion(_q, 'YXZ').y;
  }
  const pad = opts.pad ?? 0.04, padDown = opts.padDown ?? 0.3;
  // (the box grows down by padDown and up by pad: shift the centre to match)
  _c.y += (pad - padDown) / 2;
  _s.y += (pad + padDown) / 2;
  _s.x += pad;
  _s.z += pad;
  canopyParams.indoorA.set([_c.x, _c.y, _c.z, Math.cos(yaw)], n * 4);
  canopyParams.indoorB.set([_s.x, _s.y, _s.z, Math.sin(yaw)], n * 4);
  canopyParams.d[3] = n + 1;
  return n;
}

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
uniform vec4 woodlandIndoorA[ ${MAX_INDOOR} ];
uniform vec4 woodlandIndoorB[ ${MAX_INDOOR} ];
// 0 inside a room (no sun, no moon), 1 outside (a 4 cm soft edge)
float woodlandIndoorK( vec3 wp ) {
	float k = 1.0;
	for ( int i = 0; i < ${MAX_INDOOR}; i ++ ) {
		if ( float( i ) >= woodlandCanopyD.w ) break;
		vec4 A = woodlandIndoorA[ i ];
		vec4 B = woodlandIndoorB[ i ];
		vec3 d = wp - A.xyz;
		// into the room's frame (A.w = cos, B.w = sin of its yaw)
		vec3 r = vec3( A.w * d.x - B.w * d.z, d.y, B.w * d.x + A.w * d.z );
		vec3 q = abs( r ) - B.xyz;
		k = min( k, smoothstep( - 0.02, 0.02, max( max( q.x, q.y ), q.z ) ) );
	}
	return k;
}
float wcNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( wcHash( i ), wcHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( wcHash( i + vec2( 0.0, 1.0 ) ), wcHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
// Leaf-gap cookie for the key light at a view-space position (light direction in view space).
vec3 woodlandCanopy( vec3 viewPos, vec3 lightDirView ) {
	vec3 wp = ( viewPos - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );
	// inside a room: no sun at all (and no flecks on its floor)
	float indoor = woodlandCanopyD.w > 0.5 ? woodlandIndoorK( wp ) : 1.0;
	if ( indoor <= 0.0 ) return vec3( 0.0 );
	if ( woodlandCanopyA.y <= 0.0 ) return vec3( indoor );
	float k = woodlandCanopyA.y * ( 1.0 - smoothstep( woodlandCanopyA.w, woodlandCanopyA.w + 14.0, wp.y ) );
	if ( k <= 0.002 ) return vec3( indoor );
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
	return mix( vec3( 1.0 ), c, k ) * indoor;
}
`;

const DIR_BLOCK = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const DIR_CALL = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const COOKIE = /* glsl */ `
		#if UNROLLED_LOOP_INDEX == 0
		if ( directLight.color.r + directLight.color.g + directLight.color.b > 1e-4 ) directLight.color *= woodlandCanopy( geometryPosition, directLight.direction );
		#else
		if ( woodlandCanopyD.w > 0.5 && directLight.color.r + directLight.color.g + directLight.color.b > 1e-4 ) directLight.color *= woodlandIndoorK( ( geometryPosition - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix ) );
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
