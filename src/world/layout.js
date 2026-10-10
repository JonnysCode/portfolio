// ─────────────────────────────────────────────────────────────────────────────
// Glen layout — the single source of truth for WHERE everything is.
//
// The woodland is ONE miniature forest glen, rich in detail, explored by
// gliding the camera between "spots". Coordinates are three.js world units,
// Y up. The default camera sits on the +Z side looking towards −Z ("north"),
// so the FRONT of the diorama is +Z and the Great Oak stands at the back.
//
// Scale: a villager ≈ 1.1 units tall. Doors ≈ 1.6. Mushroom houses 5–9.
// The Great Oak is colossal: trunk ⌀ ≈ 7 at the base, canopy up to ~32.
//
//            −Z (back, misty forest)
//      waterfall ▲                       canopy of the Great Oak overhead
//   ┌──────────────────────────────────────────────┐
//   │        ☘          (0,−6) GREAT OAK      ⛰ (17,−13) │
//   │   cottage  ⌂ Schreinerei at the roots    ≈ stream │
//   │  (−14,5)        path ┊          bridge ⌒ (11.5,5)  │
//   │  🍄🍄             ┊               bike shed (18,7) │
//   └──────────────────────┊───────────────────────┘
//            +Z (front, where the camera looks from)
// ─────────────────────────────────────────────────────────────────────────────

/** Half-size of the terrain mesh. The glen itself is ~±26; beyond it the ground rises into misty forest. */
export const TERRAIN_HALF_SIZE = 70;
/** The detailed, explorable part of the glen (radius from the origin). */
export const GLEN_RADIUS = 27;

/** The Great Oak. Trunk base centre on the ground. */
export const OAK = {
  x: 0,
  z: -6,
  baseRadius: 3.6, // trunk radius at the ground (roots flare out to ~rootRadius)
  rootRadius: 9,
  height: 30, // to the top of the canopy
  /** Where the round workshop door sits in the trunk (front face, facing +Z). */
  door: { x: 0, y: 0, z: -6 + 3.45, rotY: 0 },
  /** Treehouse platform (the Code Loft) wrapping the trunk's front-right. */
  loft: { x: 3.6, y: 11.5, z: -3.4, rotY: -0.55, radius: 4.2 },
};

/**
 * The trunk's radius contract: radius of the (round-ish) trunk at height y,
 * EXCLUDING the root flare near the ground and bark relief (±0.2). Anything
 * attached to the bark (door frame, stairs, loft braces, lanterns) uses this.
 * The trunk forks into the main limbs above y ≈ 17.
 */
export function oakRadiusAt(y) {
  const pts = [
    [0, 3.45],
    [2, 3.15],
    [5, 2.85],
    [10, 2.6],
    [14, 2.5],
    [17, 2.7],
  ];
  if (y <= 0) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (y <= pts[i][0]) {
      const [y0, r0] = pts[i - 1], [y1, r1] = pts[i];
      const t = (y - y0) / (y1 - y0);
      return r0 + (r1 - r0) * t;
    }
  }
  return pts[pts.length - 1][1];
}

/** The Schreinerei: workshop annex built against the oak's roots (front-left). */
export const SCHREINEREI = {
  annex: { x: -6.2, z: -2.6, rotY: 0.32, width: 5.6, depth: 4.4 },
  /** Outdoor workbench porch in front of the annex. */
  porch: { x: -3.6, z: 1.2 },
  /** Small gallery deck front-right of the door where finished pieces are shown. */
  deck: { x: 4.2, z: 1.6, rotY: -0.25 },
};

/** Jonny's cottage cluster (tall conical red mushroom houses), front-left. */
export const COTTAGE = {
  home: { x: -15, z: 4, rotY: 0.55 }, // Jonny's own house (about & contact)
  // the Wohnatelier (interior design) — opened like a dollhouse; it stands behind-left of Jonny's
  // house (forming a cluster from the glen) with its open front towards the 'interior' spot camera
  atelier: { x: -21.5, z: 2.5, rotY: -0.3 },
  shed: { x: -19, z: 9.5, rotY: 0.9 }, // a tiny third mushroom (garden shed)
};

/** The stream: waterfall at the back-right, flowing towards the front-right edge. */
export const STREAM = {
  /** Centre line control points (x, z); y follows the carved channel. */
  points: [
    { x: 16.5, z: -10.5 }, // plunge pool below the waterfall
    { x: 14.5, z: -5 },
    { x: 12.2, z: 0.5 },
    { x: 11.5, z: 5 }, // under the bridge
    { x: 12.5, z: 10.5 },
    { x: 10.5, z: 16 },
    { x: 8.5, z: 22 },
    { x: 7.5, z: 30 }, // leaves the glen
  ],
  halfWidth: 1.7,
  depth: 0.9,
  waterLevel: -0.55,
  /** Mossy rock outcrop the waterfall pours from. */
  falls: { x: 18.5, z: -14.5, top: 5.2, radius: 6.5, lipX: 17.2, lipZ: -12.2 },
  pool: { x: 16.2, z: -10, radius: 3.2 },
  /**
   * Lily pond where the stream widens near the front-right before leaving the
   * glen (the owner loved the pond of the first version: lily pads, reeds,
   * ducks, a little wooden jetty).
   */
  pond: { x: 9.8, z: 18.2, radius: 4.6 },
};

/** Stone arch bridge crossing the stream, and the bike workshop on the far bank. */
export const RIVERSIDE = {
  bridge: { x: 11.6, z: 5, rotY: Math.PI / 2 - 0.12, span: 5.2, width: 2.2 },
  bikeShed: { x: 18.2, z: 7.4, rotY: -0.9 },
};

/** The main winding path: front edge → oak door. Side paths branch to the cottage and the bridge. */
export const PATHS = {
  main: [
    { x: 1.5, z: 27 },
    { x: -1.5, z: 20 },
    { x: 1.2, z: 13 },
    { x: -0.6, z: 6.5 },
    { x: 0, z: 0.4 }, // at the door step
  ],
  cottage: [
    { x: -0.8, z: 9.5 },
    { x: -5.5, z: 8.6 },
    { x: -9, z: 6.8 },
    { x: -12.5, z: 5.6 },
  ],
  bridge: [
    { x: 0.6, z: 8.5 },
    { x: 4.5, z: 6.8 },
    { x: 8.4, z: 5.4 }, // bridge west abutment
  ],
  farBank: [
    { x: 14.8, z: 4.7 }, // bridge east abutment
    { x: 16.6, z: 6.2 },
  ],
};
export const PATH_HALF_WIDTH = { main: 1.15, cottage: 0.85, bridge: 0.85, farBank: 0.75 };

/**
 * SPOTS — the places the camera glides to. `focus` is the point of interest
 * (used for depth of field and markers); `camera` is the composed shot (16:9).
 * Optional `portrait: { position, target, fov?, focus? }` is the shot on a tall
 * phone screen (blended in on portrait tablets), `portraitMore: [ {…} ]` further
 * phone stops of the same place (a flick steps through them), `close: { position, target }`
 * the '<id>-close' screenshot view (debug.js).
 * `areas` lists the content areas (src/content/content.js) presented here.
 */
export const SPOTS = [
  {
    id: 'glen',
    title: 'Jonny’s Woodland',
    subtitle: 'The whole glen',
    icon: '🌳',
    areas: [],
    focus: [0, 4, -2],
    camera: { position: [4, 17, 40], target: [0, 6.5, -2], fov: 40 },
    // phones: the village on one tall screen, seen from the east-south-east over
    // the far bank (from there the houses line up in a band ~10 units wide — from
    // the front they spread over 25): the red caps of the cottages on the left,
    // the Schreinerei annex in the middle with the oak door beside it, the deck
    // with the finished pieces below, the trunk with its loft and limbs rising to
    // the top of the frame. Nothing stands between the lens and the village (no
    // bank, stream or Velowerkstatt cap in the foreground), and the village —
    // not the crown — is what the lens is focused on, by day and by night.
    portrait: { position: [25, 16, 5], target: [-7.5, 5.8, -1.5], fov: 52, focus: [-6, 2.5, 0] },
  },
  {
    id: 'woodworking',
    title: 'Schreinerei',
    subtitle: 'Woodworking · Schreiner EFZ',
    icon: '🪚',
    areas: ['woodworking'],
    // lower and closer than before: the porch Hobelbank with Jonny planing sits on
    // the left third, the oak door in the middle, the deck still on the right
    focus: [-1.4, 1.1, -0.8],
    // (trucked right and a step back: the deck's four pieces sit inside the right third, not on the edge)
    camera: { position: [1.6, 3.05, 12.3], target: [0.0, 2.2, -0.8], fov: 40 },
    // phones: two stops (a flick steps from one to the other before travelling on).
    // First, low and close in front of the porch: Jonny planing at the Hobelbank
    // and the sawhorses with the board mid-cut on the left, the round door on the
    // right, only the trunk's foot rising above them. Then the deck, from the
    // stream side: the four finished pieces large in front, the door and the EFZ
    // certificate behind them, the porch at the far left. (No tall frame holds the
    // porch and the deck — 8 units apart — at a size where the craft reads.)
    portrait: { position: [-4.0, 4.0, 8.9], target: [-2.0, 2.9, -1.5], fov: 62, focus: [-3.2, 1.1, 0] },
    portraitMore: [{ position: [8.9, 3.6, 5.6], target: [0.5, 1.5, -1.0], fov: 64, focus: [3.4, 0.8, 0.9] }],
  },
  {
    id: 'code',
    title: 'Code Loft',
    subtitle: 'Software engineering',
    icon: '💻',
    areas: ['code'],
    focus: [3.6, 12.6, -3.4],
    camera: { position: [9.5, 15, 7.5], target: [3.4, 12.6, -3.2], fov: 40 },
    // phones: the whole deck — the rack and the side-project bench on the left, the treehouse on the right
    portrait: { position: [11.6, 17.2, 12.2], target: [3.4, 12.6, -3.6], fov: 52 },
  },
  {
    id: 'home',
    title: 'Jonny’s Cottage',
    subtitle: 'About me & contact',
    icon: '🍄',
    areas: ['home'],
    focus: [-15, 2.4, 4],
    camera: { position: [-2.6, 4.9, 9.9], target: [-14.6, 2.6, 3.9], fov: 40 },
    portrait: { position: [-0.9, 7.5, 17.7], target: [-13.8, 3.2, 4.4] },
    close: { position: [-10.4, 6.5, 10.2], target: [-14.3, 2.0, 4.7] },
  },
  {
    id: 'interior',
    title: 'Wohnatelier',
    subtitle: 'Interior design',
    icon: '🛋️',
    areas: ['interior'],
    focus: [-21.5, 1.8, 2.5],
    camera: { position: [-24.6, 3.8, 12.6], target: [-21.4, 2.0, 2.8], fov: 40 },
    // phones: the open front with the moodboard easel on the left and the model table on the right
    // (from a little higher: the lens looks into the room, and the moss in front is in focus, not a blur)
    portrait: { position: [-24.6, 7.8, 17.2], target: [-22.0, 2.0, 3.4], fov: 52 },
  },
  {
    id: 'bikes',
    title: 'Velowerkstatt',
    subtitle: 'Bike building · by the bridge',
    icon: '🚲',
    areas: ['bikes'],
    focus: [16, 1.6, 6.6],
    camera: { position: [8.5, 4.6, 16.5], target: [15.2, 1.8, 6.2], fov: 40 },
    // phones: at eye level beside the bridge — the hero bike, the mechanic and the
    // open door fill the frame, the bell cap crops off at the top (from above, the
    // cap filled the screen and the bikes were a few pixels tall)
    portrait: { position: [12.6, 2.5, 13.4], target: [15.6, 1.25, 7.4], fov: 55, focus: [15.0, 0.9, 7.6] },
    close: { position: [11.0, 6.6, 13.4], target: [16.2, 1.6, 6.8] },
  },
];
export const SPOT_BY_ID = Object.fromEntries(SPOTS.map((s) => [s.id, s]));
/** Content area id → the spot that presents it. */
export const SPOT_FOR_AREA = Object.fromEntries(SPOTS.flatMap((s) => s.areas.map((a) => [a, s.id])));

/**
 * AREAS — kept for the UI (guidebook, map, banners): one entry per spot,
 * with `center` (x, z) for maps.
 */
export const AREAS = SPOTS.map((s) => ({
  id: s.id,
  title: s.title,
  subtitle: s.subtitle,
  icon: s.icon,
  center: { x: s.focus[0], z: s.focus[2] },
  radius: s.id === 'glen' ? GLEN_RADIUS : 5,
}));
export const AREA_BY_ID = Object.fromEntries(AREAS.map((a) => [a.id, a]));

/** Orbit limits for the free diorama camera (azimuth measured from +Z, radians). */
export const CAMERA_LIMITS = {
  minAzimuth: -1.25,
  maxAzimuth: 1.25,
  minPolar: 0.35, // from straight up
  maxPolar: 1.42,
  minDistance: 5,
  maxDistance: 52,
  /** The orbit target stays inside this box (wide enough for every spot's own target: the Wohnatelier's is at x ≈ −22). */
  targetBox: { minX: -25, maxX: 21, minY: 0.5, maxY: 16, minZ: -14, maxZ: 16 },
};
