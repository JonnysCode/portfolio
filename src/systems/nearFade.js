// ─────────────────────────────────────────────────────────────────────────────
// Near-lens fade — anything that comes within a hand's width of the lens (a
// fairy-light wire, a bulb, a lamp post, a fern frond while the camera glides
// low along the path) dissolves with a screen-space dither instead of filling
// the frame as a hard, out-of-focus blob. The depth of field smooths the
// dither out.
//
// A global patch of three's `dithering_fragment` chunk (the last chunk of the
// basic / lambert / phong / standard / physical / toon / matcap shaders; the
// depth & distance shaders used for shadow maps don't include it, so shadows
// are untouched). Orthographic cameras are never faded. The view depth comes
// from gl_FragCoord.w, so no new uniforms are needed. Must run before the
// first shader compiles (imported by main.js).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

/** Fully gone closer than START, fully there beyond END (view-space depth, world units). */
const START = 0.25;
const END = 0.72;

const CHUNK = /* glsl */ `
#ifndef NEAR_FADE_OFF
	if ( ! isOrthographic && gl_FragCoord.w > ${(1 / END).toFixed(4)} ) {
		float nfDepth = 1.0 / gl_FragCoord.w;
		// interleaved gradient noise (Jimenez 2014): an even, stable dither
		float nfNoise = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
		if ( nfNoise > smoothstep( ${START.toFixed(3)}, ${END.toFixed(3)}, nfDepth ) ) discard;
	}
#endif
`;

let patched = false;
export function installNearFade() {
  if (patched) return;
  patched = true;
  const c = THREE.ShaderChunk;
  if (!c.dithering_fragment.includes('nfNoise')) c.dithering_fragment = c.dithering_fragment + CHUNK;
}

installNearFade();
