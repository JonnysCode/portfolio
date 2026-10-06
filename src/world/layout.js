// ─────────────────────────────────────────────────────────────────────────────
// World layout — the single source of truth for WHERE things are.
//
// Coordinates: three.js world units, Y is up, the ground plane is XZ.
// Scale: 1 unit ≈ 1 "villager metre". A villager is ~1.1 units tall, a
// mushroom house 4–7 units, a big tree 8–14 units, a riding snail ~2.2 long.
//
// Every district is a flat circular clearing (ground height exactly 0 inside
// `radius`). District builders work in LOCAL coordinates: the clearing centre
// is the origin and local +Z points towards the plaza (the entrance side).
// ─────────────────────────────────────────────────────────────────────────────

/** Player can walk anywhere inside this radius (minus colliders). */
export const WORLD_RADIUS = 66;
/** Terrain mesh extent (half size). Beyond the walkable radius it rises into hills. */
export const TERRAIN_HALF_SIZE = 150;

export const PLAZA = {
  id: 'plaza',
  title: 'Village Square',
  subtitle: 'Start here',
  center: { x: 0, z: 0 },
  radius: 12,
  color: '#d9b26f',
  icon: '⛲',
};

/**
 * Districts, clockwise starting at the north (−Z is "north", the direction the
 * camera looks on spawn).
 */
export const DISTRICTS = [
  {
    id: 'woodworking',
    title: 'Schreinerei',
    subtitle: 'Woodworking workshop',
    center: { x: 0, z: -40 },
    radius: 16,
    color: '#c98a4b',
    icon: '🪚',
    bend: 2.5,
  },
  {
    id: 'bikes',
    title: 'Velowerkstatt',
    subtitle: 'Bike building',
    center: { x: 38, z: -11 },
    radius: 12.5,
    color: '#e8a838',
    icon: '🚲',
    bend: -3,
  },
  {
    id: 'code',
    title: 'Code Grove',
    subtitle: 'Software engineering',
    center: { x: 29, z: 30 },
    radius: 12.5,
    color: '#5fb8c9',
    icon: '💻',
    bend: 3,
  },
  {
    id: 'home',
    title: "Jonny's Cottage",
    subtitle: 'About me & contact',
    center: { x: -29, z: 29 },
    radius: 12,
    color: '#e2553f',
    icon: '🏡',
    bend: -2.5,
  },
  {
    id: 'interior',
    title: 'Wohnatelier',
    subtitle: 'Interior design studio',
    center: { x: -38, z: -12 },
    radius: 12.5,
    color: '#b39ddb',
    icon: '🛋️',
    bend: 3,
  },
];

/** Scenic features that are not districts but shape the terrain. */
export const POND = { id: 'pond', center: { x: 2, z: 41 }, radius: 9, waterLevel: -0.45, depth: 1.6 };

/** Where the player appears, and the direction they face (towards −Z / north). */
export const SPAWN = { x: 0, z: 8, facing: Math.PI };

// ─── Derived data ────────────────────────────────────────────────────────────

for (const d of DISTRICTS) {
  const dx = PLAZA.center.x - d.center.x;
  const dz = PLAZA.center.z - d.center.z;
  /**
   * rotation.y applied to the district group so that local +Z points to the
   * plaza: local (0,0,1) → world (sin θ, 0, cos θ).
   */
  d.facing = Math.atan2(dx, dz);
  /** Local position of the district's snail stop (right of the entrance path). */
  d.stationLocal = { x: 3.6, z: d.radius - 2.4 };
  /** Local position where the main path enters the clearing. */
  d.entranceLocal = { x: 0, z: d.radius };
  d.station = localToWorld(d, d.stationLocal.x, d.stationLocal.z);
  d.entrance = localToWorld(d, 0, d.radius);
}

export const DISTRICT_BY_ID = Object.fromEntries(DISTRICTS.map((d) => [d.id, d]));
export const AREAS = [PLAZA, ...DISTRICTS];
export const AREA_BY_ID = Object.fromEntries(AREAS.map((a) => [a.id, a]));

/** The plaza-side snail stop for rides out to each district. */
PLAZA.station = { x: -4.2, z: 4.6 };

/** Convert district-local XZ to world XZ. */
export function localToWorld(district, lx, lz) {
  const s = Math.sin(district.facing);
  const c = Math.cos(district.facing);
  // rotation.y = θ: x' = x cosθ + z sinθ ; z' = −x sinθ + z cosθ
  return {
    x: district.center.x + lx * c + lz * s,
    z: district.center.z - lx * s + lz * c,
  };
}

/** Convert world XZ to district-local XZ. */
export function worldToLocal(district, wx, wz) {
  const s = Math.sin(district.facing);
  const c = Math.cos(district.facing);
  const x = wx - district.center.x;
  const z = wz - district.center.z;
  return { x: x * c - z * s, z: x * s + z * c };
}

/**
 * Main dirt paths: plaza edge → district entrance, as XZ control points for a
 * Catmull-Rom curve. A gentle sideways `bend` keeps them from looking ruler-straight.
 */
export const PATHS = {};
for (const d of DISTRICTS) {
  const len = Math.hypot(d.center.x, d.center.z);
  const ux = d.center.x / len;
  const uz = d.center.z / len;
  const px = -uz; // perpendicular
  const pz = ux;
  const start = PLAZA.radius - 1.5;
  const end = len - d.radius + 1.5;
  const pts = [];
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const along = start + (end - start) * t;
    const bend = Math.sin(t * Math.PI) * d.bend;
    pts.push({ x: ux * along + px * bend, z: uz * along + pz * bend });
  }
  PATHS[d.id] = pts;
}
/** A small trail from the plaza to the pond's north shore. */
PATHS.pond = (() => {
  const pts = [];
  const sx = 0, sz = PLAZA.radius - 1.5;
  const ex = POND.center.x, ez = POND.center.z - POND.radius - 1.2;
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    pts.push({ x: sx + (ex - sx) * t + Math.sin(t * Math.PI) * 2, z: sz + (ez - sz) * t });
  }
  return pts;
})();

/** Path half-widths (the walkable dirt ribbon). */
export const PATH_WIDTH = { default: 1.7, pond: 1.1 };
