// ─────────────────────────────────────────────────────────────────────────────
// PROPS KIT — reusable, parametric, procedural building blocks for the village.
// Every builder returns plain three.js objects built in LOCAL space with the
// origin at the base (y = 0 is the ground) and the "front" facing +Z.
// Use ctx.materials / the shared materials module for all materials.
//
// Import from here (not from the individual files) so the API stays stable:
//   import { makeMushroomHouse, makePerson, makeSnail, makeSign } from '../props/index.js';
// ─────────────────────────────────────────────────────────────────────────────
export { makeMushroomHouse } from './mushroomHouse.js';
export { makePerson } from './person.js';
export { makeSnail } from './snail.js';
export { makeSign, makeTextTexture } from './sign.js';
export {
  makeLantern,
  makeLampPost,
  makeFence,
  makeBench,
  makeBarrel,
  makeCrate,
  makePottedPlant,
  makeRock,
  makeStump,
  makeBush,
  makeFlowerPatch,
  makeBunting,
  makeMailbox,
  makeSmallMushroom,
  makeLogPile,
} from './decor.js';
