// ─────────────────────────────────────────────────────────────────────────────
// ✏️  PORTFOLIO CONTENT — edit this file to make the woodland yours.
//
// Everything visitors can read lives here: your profile, the intro of every
// district, and every project ("entry"). The 3D world only references entries
// by id, so you can freely rewrite titles, text, years, tags, images and links
// without touching any three.js code.
//
// Images: drop files into /public/images/ and reference them as
//   images: [{ src: 'images/dining-table-1.jpg', alt: 'Walnut dining table' }]
// Entries without images get a hand-drawn placeholder card.
//
// Text marked "DRAFT" is placeholder copy written to show the format. Replace it
// with your real stories before publishing.
// ─────────────────────────────────────────────────────────────────────────────

export const profile = {
  name: 'Jonny',
  // DRAFT: your full name, as you'd like it on the site
  fullName: 'Jonny',
  tagline: 'Software engineer · Schreiner EFZ · tinkerer',
  intro:
    'Welcome to my little woodland! I build software for a living and furniture, bikes and cozy rooms for joy. Wander around, hop on a snail, and poke at anything that looks interesting.',
  location: 'Switzerland',
  // DRAFT: put your real address here (or remove the line to hide the button)
  email: 'hello@example.com',
  links: [
    { label: 'GitHub', href: 'https://github.com/JonnysCode', icon: 'github' },
    // { label: 'LinkedIn', href: 'https://www.linkedin.com/in/your-handle', icon: 'linkedin' },
    // { label: 'Instagram (woodworking)', href: 'https://instagram.com/your-handle', icon: 'instagram' },
  ],
};

/** Intro cards for each area of the village (ids match src/world/layout.js). */
export const areas = {
  plaza: {
    title: 'Village Square',
    kicker: 'Start here',
    text: 'The heart of the woodland. Signposts point to every corner of my interests, and the yellow Schneckenpost will carry you anywhere — slowly, but in style.',
  },
  woodworking: {
    title: 'Schreinerei',
    kicker: 'Woodworking · Schreiner EFZ',
    text: 'I trained as a Schreiner (cabinetmaker/joiner, Swiss federal VET diploma EFZ). Wood is still my favourite material: honest, warm and unforgiving of shortcuts. This workshop holds the pieces I have designed and built.',
  },
  bikes: {
    title: 'Velowerkstatt',
    kicker: 'Bike building',
    text: 'Frames, wheels and a lot of grease. I love building bikes from the ground up — choosing every part, truing every wheel and getting the fit just right.',
  },
  interior: {
    title: 'Wohnatelier',
    kicker: 'Interior design',
    text: 'Rooms are furniture at a bigger scale. Here I collect layouts, material boards and the little decisions that make a space feel like home.',
  },
  code: {
    title: 'Code Grove',
    kicker: 'Software engineering',
    text: 'Where the mushrooms glow and the fireflies carry packets. My software projects, tools and experiments — including the code behind this very woodland.',
  },
  home: {
    title: "Jonny's Cottage",
    kicker: 'About me & contact',
    text: 'Make yourself at home. Here is a bit about who I am — and the mailbox is always open.',
  },
};

/**
 * Entries — the things you can click on in the world.
 * Fields:
 *   area       id of the district it belongs to
 *   kind       'project' | 'credential' | 'about' | 'contact' | 'note'
 *   title, subtitle, year
 *   summary    one sentence, shown in tooltips and the guidebook
 *   body       array of paragraphs
 *   facts      [label, value] pairs (materials, dimensions, time spent, stack …)
 *   tags       short keywords
 *   images     [{ src, alt }]
 *   links      [{ label, href }]
 *   featured   shown first in the guidebook
 */
export const entries = {
  // ─── Woodworking ──────────────────────────────────────────────────────────
  'efz-certificate': {
    area: 'woodworking',
    kind: 'credential',
    title: 'Schreiner EFZ',
    subtitle: 'Swiss federal VET diploma — cabinetmaker / joiner',
    year: 'DRAFT',
    summary: 'Four years of apprenticeship in a Swiss Schreinerei: joinery, furniture and interior fittings.',
    body: [
      'DRAFT — The Schreiner EFZ is the Swiss federal certificate for cabinetmakers and joiners. The apprenticeship combines years of hands-on work in a workshop with vocational school: technical drawing, material science, machine work and a lot of hand-tool practice.',
      'DRAFT — Tell the story of your apprenticeship here: the workshop you trained in, the kind of work you did (furniture, kitchens, windows, interior fittings), and your final exam piece.',
    ],
    facts: [
      ['Diploma', 'Eidgenössisches Fähigkeitszeugnis (EFZ)'],
      ['Trade', 'Schreiner/in — Möbel & Innenausbau'],
      ['Duration', '4 years'],
    ],
    tags: ['Joinery', 'Furniture', 'Hand tools', 'CNC'],
    featured: true,
  },
  'dining-table': {
    area: 'woodworking',
    kind: 'project',
    title: 'Dining Table',
    subtitle: 'Solid wood, traditional joinery',
    year: 'DRAFT',
    summary: 'A solid wood dining table built to be used every day for decades.',
    body: [
      'DRAFT — Describe the design idea, the wood you chose and why, and the joinery (mortise & tenon, bridle joints, breadboard ends …).',
      'DRAFT — What was the hardest part? How did you finish it? Who sits at it now?',
    ],
    facts: [
      ['Wood', 'DRAFT — e.g. oak'],
      ['Finish', 'DRAFT — e.g. hardwax oil'],
      ['Size', 'DRAFT — e.g. 200 × 95 cm'],
    ],
    tags: ['Furniture', 'Solid wood', 'Joinery'],
    featured: true,
  },
  'record-player': {
    area: 'woodworking',
    kind: 'project',
    title: 'Record Player',
    subtitle: 'A turntable with a handmade wooden plinth',
    year: 'DRAFT',
    summary: 'A record player built around a hand-crafted wooden plinth — click it in the workshop to give it a spin.',
    body: [
      'DRAFT — Explain how the record player came together: the plinth, the mechanics you used, how you dealt with vibration and resonance.',
      'DRAFT — Mention the details you are proud of: grain matching, the tonearm base, the dust cover, the switches.',
    ],
    facts: [
      ['Plinth', 'DRAFT — e.g. walnut'],
      ['Drive', 'DRAFT — belt / direct'],
    ],
    tags: ['Furniture', 'Audio', 'Electronics'],
    featured: true,
  },
  'coffee-table': {
    area: 'woodworking',
    kind: 'project',
    title: 'Coffee Table',
    subtitle: 'Low table for the living room',
    year: 'DRAFT',
    summary: 'A low table with a clean top and exposed joinery.',
    body: ['DRAFT — Your coffee/side table story goes here.'],
    facts: [['Wood', 'DRAFT']],
    tags: ['Furniture'],
  },
  'record-cabinet': {
    area: 'woodworking',
    kind: 'project',
    title: 'Record Cabinet',
    subtitle: 'A home for the vinyl collection',
    year: 'DRAFT',
    summary: 'Sideboard-style cabinet sized for LPs, with sliding doors.',
    body: ['DRAFT — A second furniture piece. Replace or delete as you like.'],
    facts: [['Wood', 'DRAFT']],
    tags: ['Furniture', 'Casework'],
  },
  'workbench-wip': {
    area: 'woodworking',
    kind: 'note',
    title: 'On the Workbench',
    subtitle: 'Work in progress',
    year: 'now',
    summary: 'Whatever is currently clamped to my bench.',
    body: ['DRAFT — Share what you are working on right now. Visitors love a peek behind the scenes.'],
    tags: ['WIP'],
  },

  // ─── Bikes ────────────────────────────────────────────────────────────────
  'bike-build': {
    area: 'bikes',
    kind: 'project',
    title: 'Custom Bike Build',
    subtitle: 'Built up from a bare frame',
    year: 'DRAFT',
    summary: 'A bike assembled part by part — from bare frame to first ride.',
    body: [
      'DRAFT — Which frame did you start from? What was the goal: gravel, road, commuting, bikepacking?',
      'DRAFT — Walk through the groupset, wheels and contact points you chose and why.',
    ],
    facts: [
      ['Frame', 'DRAFT'],
      ['Groupset', 'DRAFT'],
      ['Wheels', 'DRAFT'],
    ],
    tags: ['Bikes', 'Mechanics'],
    featured: true,
  },
  'bike-restoration': {
    area: 'bikes',
    kind: 'project',
    title: 'Vintage Restoration',
    subtitle: 'Bringing an old steel frame back to life',
    year: 'DRAFT',
    summary: 'Stripping, fixing and rebuilding an old bike.',
    body: ['DRAFT — Before/after story of a restoration project.'],
    tags: ['Bikes', 'Restoration'],
  },
  'wheel-building': {
    area: 'bikes',
    kind: 'project',
    title: 'Wheel Building',
    subtitle: 'Lacing and truing by hand',
    year: 'DRAFT',
    summary: 'Hubs, spokes, rims and a lot of patience.',
    body: ['DRAFT — Lacing patterns, spoke tension, the zen of truing.'],
    tags: ['Bikes', 'Wheels'],
  },

  // ─── Interior design ──────────────────────────────────────────────────────
  'living-room': {
    area: 'interior',
    kind: 'project',
    title: 'Living Room Concept',
    subtitle: 'Warm minimalism with natural materials',
    year: 'DRAFT',
    summary: 'A full room concept: layout, light, materials and the furniture to match.',
    body: [
      'DRAFT — Describe the brief, the mood, and the key decisions: palette, textures, lighting plan, furniture layout.',
    ],
    facts: [
      ['Palette', 'DRAFT — e.g. oak, linen, terracotta'],
      ['Tools', 'DRAFT — e.g. hand sketches, SketchUp'],
    ],
    tags: ['Interior', 'Concept', 'Lighting'],
    featured: true,
  },
  'moodboards': {
    area: 'interior',
    kind: 'project',
    title: 'Material Boards',
    subtitle: 'Colours, textures and samples',
    year: 'DRAFT',
    summary: 'How I collect and combine materials before anything gets built.',
    body: ['DRAFT — Show a few of your material/colour boards and what they became.'],
    tags: ['Interior', 'Materials'],
  },
  'small-space': {
    area: 'interior',
    kind: 'project',
    title: 'Small Space Layout',
    subtitle: 'Making a tiny flat feel generous',
    year: 'DRAFT',
    summary: 'Built-ins and clever layout for a small apartment.',
    body: ['DRAFT — A space-planning project, ideally with custom built-in furniture.'],
    tags: ['Interior', 'Built-ins'],
  },

  // ─── Software ─────────────────────────────────────────────────────────────
  'this-portfolio': {
    area: 'code',
    kind: 'project',
    title: 'This Woodland',
    subtitle: 'A procedural three.js world as a portfolio',
    year: '2026',
    summary: 'Every mushroom, snail and plank here is generated in code — no 3D models were harmed.',
    body: [
      'The whole village is built procedurally with three.js: terrain, trees, mushroom houses, villagers and snails are all generated from code at load time, with cel-shaded materials, instanced vegetation and a day/night cycle.',
      'All the content lives in a single file, so updating the portfolio never requires touching the 3D code.',
    ],
    facts: [
      ['Stack', 'three.js, Vite, vanilla JS'],
      ['Assets', '100% procedural'],
    ],
    tags: ['three.js', 'WebGL', 'Creative coding'],
    links: [{ label: 'Source on GitHub', href: 'https://github.com/JonnysCode/portfolio' }],
    featured: true,
  },
  'project-backend': {
    area: 'code',
    kind: 'project',
    title: 'Professional Work',
    subtitle: 'What I build day to day',
    year: 'DRAFT',
    summary: 'The kind of software I build professionally.',
    body: ['DRAFT — Describe your role, the systems you work on and the technologies you use.'],
    facts: [['Stack', 'DRAFT']],
    tags: ['Software'],
  },
  'project-side': {
    area: 'code',
    kind: 'project',
    title: 'Side Projects',
    subtitle: 'Experiments and tools',
    year: 'DRAFT',
    summary: 'Things I built because I was curious.',
    body: ['DRAFT — A favourite side project, hackathon entry or open-source contribution.'],
    links: [{ label: 'GitHub profile', href: 'https://github.com/JonnysCode' }],
    tags: ['Open source'],
  },

  // ─── Home ─────────────────────────────────────────────────────────────────
  'about-me': {
    area: 'home',
    kind: 'about',
    title: 'About Me',
    subtitle: 'A software engineer with sawdust in the pockets',
    summary: 'Who lives in this cottage.',
    body: [
      'DRAFT — Hi, I am Jonny. I trained as a Schreiner before moving into software engineering, and I never stopped making things with my hands.',
      'DRAFT — Write a few sentences about your path, what drives you, and what you are looking for.',
    ],
    facts: [
      ['Based in', 'Switzerland'],
      ['Day job', 'Software engineering'],
      ['Hands-on', 'Woodworking · Bikes · Interiors'],
    ],
    featured: true,
  },
  'contact': {
    area: 'home',
    kind: 'contact',
    title: 'Say Hello',
    subtitle: 'The mailbox is always open',
    summary: 'Get in touch — for work, collaborations or a chat about wood.',
    body: ['Want to work together, commission a piece of furniture, or just talk about bikes? Drop me a line.'],
  },
};

/** Entry ids per area, in display order. */
export function entriesForArea(areaId) {
  return Object.entries(entries)
    .filter(([, e]) => e.area === areaId)
    .map(([id, e]) => ({ id, ...e }));
}

export function getEntry(id) {
  const e = entries[id];
  return e ? { id, ...e } : null;
}

export default { profile, areas, entries, entriesForArea, getEntry };
