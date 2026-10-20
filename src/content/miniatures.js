// ─────────────────────────────────────────────────────────────────────────────
// "In this miniature — look closer": what is actually BUILT into each piece's
// little model in the glen, for the journal page and the guidebook card.
//
// These lines describe the 3D miniature only (what the code in src/scene/
// models — joints, parts, props), never the owner's real piece, life or
// work: the real story, years, photos and materials belong in content.js
// and are written by the owner. Keep every line true to the model: when a
// builder changes a piece, change its line here (or delete it).
//
//   miniatureFor(entryId) → { glance: string[] (a few words each, for the
//        guidebook card), lines: string[] (the full list, for the page) } | null
// ─────────────────────────────────────────────────────────────────────────────

export const miniatures = {
  // ── Schreinerei (src/scene/schreinerei/deck.js, porch.js, door.js) ─────────
  'dining-table': {
    glance: ['breadboard ends with draw-bore pegs', 'wedged through-tenons', 'three Swiss Stabellen'],
    lines: [
      'A top glued up from four oak boards, each a slightly different tone',
      'Breadboard ends across the grain, held by walnut draw-bore pegs',
      'Chamfered legs; pegs show the mortise-and-tenon joints of the aprons',
      'Wedged through-tenons on the long stretcher, the wedges set to spread against end grain (not split the rail)',
      'Three Swiss Stabellen: plank seats, splayed legs wedged through, a heart cut into each backrest',
      'Laid for tea: a linen runner, a teapot, cups, cookies and a candle',
    ],
  },
  'coffee-table': {
    glance: ['a live-edge slab', 'walnut butterfly keys across a check', 'wedged through-tenons'],
    lines: [
      'A live-edge oak slab with square-cut ends',
      'A drying check running along the grain, held by two walnut butterfly keys set across it',
      'Walnut legs through-tenoned into the slab and wedged with pale maple',
      'Low walnut stretchers between the legs',
      'An open book, a mug and a potted plant on top',
    ],
  },
  'record-cabinet': {
    glance: ['through-dovetailed walnut carcass', 'sliding oak doors', 'a shelf of LPs'],
    lines: [
      'A walnut carcass with through-dovetails at the top corners — tails on the top, pins in the sides',
      'Two oak sliding doors with a finger pull, one slid aside',
      'LPs standing in the open half, more leaning in a spruce crate beside it',
      'Splayed, tapered legs',
    ],
  },
  'record-player': {
    glance: ['cherry plinth on brass feet', 'a record turning, arm in the groove'],
    lines: [
      'A cherry plinth with a thin maple stringer, on brass feet',
      'A record turning on the platter, the tonearm resting in the groove',
      'A cueing lever, a speed knob and a little brass power button',
      'The dust cover hinged open at the back',
      'Two little walnut speakers, one either side',
    ],
  },
  'workbench-wip': {
    glance: ['a Swiss Hobelbank', 'front and tail vise', 'a panel half flattened'],
    lines: [
      'A Swiss Hobelbank: a light beech top on a dark steamed-beech trestle base',
      'Front vise and tail vise with threaded wooden spindles and long tommy bars (Knebel)',
      'A row of dog holes, a tool tray (Beilade) and wedged through-tenons in the base',
      'A glued-up oak panel held between two bench dogs, half flattened',
      'Planes, a square and a round mallet (Klüpfel) in the tray, fresh shavings on the floor',
      'A slatted duckboard (Lattenrost) to stand on, an enamel work lamp overhead',
    ],
  },
  'efz-certificate': {
    glance: ['framed parchment with a red seal', 'its own shingled roof'],
    lines: [
      'A parchment with a red seal in a walnut frame, mitred at the corners, with a thin gilt slip',
      'A little gable roof of tiny shingles over it',
      'A forged picture lamp on a swan-neck arm',
    ],
  },

  // ── Velowerkstatt (src/scene/riverside/bike.js, workshop.js) ─────────────────
  'bike-build': {
    glance: ['cobalt gravel frame', 'the whole drivetrain', 'up on a repair stand'],
    lines: [
      'A cobalt gravel frame with a sloping top tube, flared drop bars and tan-wall tyres',
      'Spoked wheels laced to flanged hubs, disc brakes front and rear',
      'The whole drivetrain: chainring on its spider, cranks and pedals, cassette, rear derailleur with its pulleys, the chain',
      'A bottle in its cage, a little frame bag and a saddle bag',
      'Up on a repair stand, its C-jaw clamped to the seatpost',
    ],
  },
  'bike-restoration': {
    glance: ['lugged step-through frame', 'sprung leather saddle', 'a basket of flowers'],
    lines: [
      'A lugged step-through loop frame in pale mint',
      'Swept-back bars with cork grips, a bell and a sprung leather saddle',
      'Chrome mudguards, a chainguard and a rear rack',
      'A dynamo headlamp that glows after dark',
      'A wicker basket full of flowers',
    ],
  },
  'wheel-building': {
    glance: ['a blue truing stand', 'a wheel turning slowly in it'],
    lines: [
      'A classic blue truing stand: two uprights cradling the axle, caliper arms reaching in at the rim',
      'A road wheel turning slowly in it',
      'On the stump: a spoke key, loose spokes, a tin tray of brass nipples and a coffee mug',
    ],
  },

  // ── Wohnatelier (src/scene/cottage/atelier.js) ─────────────────────────────
  'living-room': {
    glance: ['sage sofa and cognac lounge chair', 'Berber rug', 'a gallery wall'],
    lines: [
      'A sage sofa with an ink velvet cushion and a knitted throw',
      'A walnut-and-cognac lounge chair with its ottoman, beside a little round side table',
      'A cream Berber rug with ink lozenges under the front legs',
      'A ribbed rice-paper globe pendant and a black-metal tripod lamp',
      'A gallery of black, brass and oak frames around one dark print',
      'A sideboard with a mushroom lamp under the arched window and its linen café curtain',
    ],
  },
  moodboards: {
    glance: ['an easel with a cork mood board', 'swatches and paint chips'],
    lines: [
      'A wooden A-frame easel with a clamp holding a cork mood board',
      'Colour chips, fabric samples and sketches pinned to the board',
      'Real fabric swatches and paint chips hanging off the ledge, brushes in a jar',
    ],
  },
  'small-space': {
    glance: ['a foam-board model of a tiny flat', 'a 1:12 scale figure', 'floor plan and scale ruler'],
    lines: [
      'An architect’s model of a tiny flat in white foam board, its grey cut edges showing',
      'Little furniture blocks inside — a sage sofa, a cognac chair, a bed with an ink throw, a kitchen',
      'A 1:12 scale figure for size',
      'A floor plan with a triangular scale ruler across it, a pencil cup, a mug and a roll of masking tape',
      'Rolled drawings, one of them a blueprint, held by a rubber band',
    ],
  },

  // ── Code Loft (src/scene/loft/house.js, props.js, screens.js) ────────────────
  'this-portfolio': {
    glance: ['wood-framed screens scrolling code', 'a brass anglepoise lamp'],
    lines: [
      'Monitors in wooden frames on turned walnut stands, and an open laptop',
      'Screens scrolling syntax-coloured code and a terminal, a cursor blinking on the typing line',
      'A keyboard and mouse, a mug, a notebook and a pencil',
      'A brass anglepoise desk lamp',
    ],
  },
  'via-physio': {
    glance: ['an exercise mat', 'a phone filming it from a tripod'],
    lines: [
      'A lilac exercise mat, one end rolled up',
      'A resistance band and a little dumbbell on it',
      'A phone on a mini tripod pointed at the mat, its red recording light blinking',
    ],
  },
  'project-backend': {
    glance: ['a hollow-log server with blinking LEDs', 'a pinwheel fan'],
    lines: [
      'A hollow oak log standing upright, its plank door open',
      'Rack units inside with blinking LEDs',
      'A pinwheel “fan” spinning on top, a cable bundle snaking over to the house',
    ],
  },
  'project-side': {
    glance: ['Simi the turtle on a tinkering bench', 'a little robot that waves'],
    lines: [
      'A small joiner’s bench with a wooden vice',
      'A breadboard with chips, a soldering iron, a multimeter and spools of wire',
      'A little robot that waves',
      'Simi, Via Communa’s purple turtle, sitting at the front corner',
    ],
  },
};

/** An entry's miniature (null when the glen has none to describe). */
export function miniatureFor(id) {
  const m = Object.prototype.hasOwnProperty.call(miniatures, id) ? miniatures[id] : null;
  if (!m?.lines?.length) return null;
  return { glance: m.glance?.length ? m.glance : [], lines: m.lines };
}
