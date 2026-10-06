// PLACEHOLDER — the props builder replaces this with real cute villagers.
import * as THREE from 'three';
import { materials } from '../core/materials.js';
import { palette } from '../core/palette.js';
import { createRng } from '../core/rng.js';

/**
 * A little villager. Origin at the feet, facing +Z, ~1.1 units tall.
 * @param {object} [opts] { seed, name, skin, shirt, pants, hat, hatColor, hair, hairColor,
 *                          apron, glasses, beard, scarf, scale }
 * @returns {{ group: THREE.Group, height: number, setAction(name: 'idle'|'walk'|'run'|'wave'|'work'|'sit'|'ride'|'talk'): void,
 *             setSpeed(unitsPerSecond: number): void, update(dt: number): void, action: string }}
 */
export function makePerson(opts = {}) {
  const rng = createRng(opts.seed ?? 'person');
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.35, 4, 10), materials.toon(opts.shirt ?? rng.pick(palette.clothes)));
  body.position.y = 0.42;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), materials.toon(opts.skin ?? rng.pick(palette.skin)));
  head.position.y = 0.92;
  for (const m of [body, head]) { m.castShadow = true; g.add(m); }
  let action = 'idle', t = 0;
  return {
    group: g,
    height: 1.2,
    get action() { return action; },
    setAction(a) { action = a; },
    setSpeed() {},
    update(dt) {
      t += dt;
      body.position.y = 0.42 + (action === 'walk' ? Math.abs(Math.sin(t * 10)) * 0.05 : Math.sin(t * 2) * 0.01);
    },
  };
}
