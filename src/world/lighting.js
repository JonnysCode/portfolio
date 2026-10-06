// BASELINE (to be replaced by the environment builder): sun + sky fill.
import * as THREE from 'three';
import { palette } from '../core/palette.js';

export default async function build(ctx) {
  const { scene, engine, env } = ctx;
  const hemi = new THREE.HemisphereLight('#fff4dd', '#6f8f4a', 1.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(palette.sun, 2.2);
  sun.position.set(30, 50, 20);
  sun.castShadow = engine.quality.shadows;
  sun.shadow.mapSize.set(engine.quality.shadowMapSize, engine.quality.shadowMapSize);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -40;
  cam.right = cam.top = 40;
  cam.near = 1;
  cam.far = 140;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  ctx.lights = { hemi, sun };
  return {
    update() {
      const focus = ctx.cameraRig?.target ?? new THREE.Vector3();
      sun.target.position.copy(focus);
      sun.position.copy(focus).add(new THREE.Vector3(30, 50, 20));
      const n = env.night;
      sun.intensity = 2.2 * (1 - n) + 0.35 * n;
      hemi.intensity = 1.4 * (1 - n) + 0.5 * n;
    },
  };
}
