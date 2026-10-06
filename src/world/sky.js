// BASELINE (to be replaced by the environment builder): flat background colour.
import * as THREE from 'three';
import { palette } from '../core/palette.js';

export default async function build(ctx) {
  const day = new THREE.Color(palette.skyTop), night = new THREE.Color(palette.skyTopNight);
  const fogDay = new THREE.Color(palette.fogDay), fogNight = new THREE.Color(palette.fogNight);
  return {
    update() {
      ctx.scene.background.copy(day).lerp(night, ctx.env.night);
      ctx.scene.fog.color.copy(fogDay).lerp(fogNight, ctx.env.night);
    },
  };
}
