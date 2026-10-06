// ─────────────────────────────────────────────────────────────────────────────
// PROPS KIT — reusable, parametric, procedural building blocks for the village.
// Every builder returns plain three.js objects built in LOCAL space with the
// origin at the base (y = 0 is the ground) and the "front" facing +Z.
// Static parts are merged per material and geometry is cached per variant, so
// repeated props are cheap. Animated props (smoke, villagers, snails, swinging
// signs, bunting) register themselves in the props ticker (ticker.js), which
// main.js drives — district code never has to wire prop animations by hand.
//
// Import from here (not from the individual files) so the API stays stable:
//   import { makeMushroomHouse, makePerson, makeSnail, makeSign } from '../props/index.js';
//
// Highlights (see each file's header for all options):
//   makeMushroomHouse({ seed, capShape, capColor, height, capRadius, stemRadius, chimney, plaque … })
//       → Group, userData { radius, height, door, plaque, chimneyTop }
//   makePerson({ seed, hat, hair, apron, holding, action, scale … })
//       → { group, setAction, setSpeed, setHolding, lookAt, update, height, hipHeight }
//   makeSnail({ post, seed }) → { group, seat, setMoving, lookAt, update, length }
//   makeSign({ text, style: 'post' | 'board' | 'hanging' | 'arrow', color, width })
//   makeSignpost([{ text, angle, color }]) · makePlaque(text) · makeTextTexture(text, opts)
//   makeTool(name) — hand plane, hammer, saw, chisel, mallet, … as standalone props
//   decor: lanterns & lamp posts, fences, benches, tables, chairs, barrels, crates, logs,
//          rocks, stumps, bushes, flowers, mushrooms, mailbox, well, wheelbarrow, bunting,
//          string lights, stone circles, stepping stones, parcels, glow sprites
// ─────────────────────────────────────────────────────────────────────────────
export { makeMushroomHouse } from './mushroomHouse.js';
export { makePerson, PERSON_HEIGHT } from './person.js';
export { makeSnail } from './snail.js';
export { makeSign, makeSignpost, makePlaque, makeTextTexture } from './sign.js';
export { paintWood, drawFittedText, canvasTexture, FONT_DISPLAY, FONT_HAND } from './text.js';
export { makeTool, TOOL_NAMES } from './tools.js';
export { makeGlowSprite, glowQuads } from './glow.js';
export {
  makeLantern,
  makeLampPost,
  makeFence,
  makeBench,
  makeTable,
  makeChair,
  makeBarrel,
  makeCrate,
  makeLogPile,
  makeParcel,
  makeWheelbarrow,
  makePottedPlant,
  makeFlowerBox,
  makeRock,
  makeStump,
  makeBush,
  makeFlowerPatch,
  makeSmallMushroom,
  makeMushroomCluster,
  makeMailbox,
  makeWell,
  makeBunting,
  makeStringLights,
  makeStoneCircle,
  makeSteppingStones,
} from './decor.js';

/**
 * Per-frame animation hook for animated props (chimney smoke, blinking eyes …).
 * main.js calls this every frame; props register themselves internally.
 * configureProps(ctx) is optional (camera for distance LOD, quality, reduced motion).
 */
export { tickProps, registerAnimated, configureProps, animatedCount } from './ticker.js';
