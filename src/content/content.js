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
  fullName: 'Jonathan Gruss',
  tagline: 'Software Engineer @ ipt · Co-founder of Via Communa · Cabinetmaker',
  intro:
    'Welcome to my little woodland! I’m a software engineer at ipt, I build Via Communa in my free time, and furniture, bikes and cozy rooms for joy. Wander around, hop on a snail, and poke at anything that looks interesting.',
  location: 'Winterthur, Switzerland',
  email: 'jonathangruss@gmail.com',
  links: [
    { label: 'GitHub', href: 'https://github.com/JonnysCode', icon: 'github' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/jonathangruss', icon: 'linkedin' },
    // { label: 'Instagram (woodworking)', href: 'https://instagram.com/your-handle', icon: 'instagram' },
  ],
};

/** Intro cards for each area of the village (ids match src/world/layout.js). */
export const areas = {
  glen: {
    title: 'Jonny’s Woodland',
    kicker: 'Start here',
    text: 'A little glen under a very old oak. Every house here holds one of the things I love making — glide between them, peek into windows and click whatever catches your eye.',
  },
  woodworking: {
    title: 'Schreinerei',
    kicker: 'Woodworking · Cabinetmaker',
    text: 'I trained as a cabinetmaker and hold the Swiss federal VET diploma, the Schreiner EFZ. Wood is still my favourite material: honest, warm and unforgiving of shortcuts. This workshop holds the pieces I have designed and built.',
  },
  bikes: {
    title: 'Velowerkstatt',
    kicker: 'Bike building',
    text: 'Across the stone bridge, in the mushroom with the big doors: frames, wheels and a lot of grease. I love building bikes from the ground up — choosing every part, truing every wheel and getting the fit just right.',
  },
  interior: {
    title: 'Wohnatelier',
    kicker: 'Interior design',
    text: 'Rooms are furniture at a bigger scale. Here I collect layouts, material boards and the little decisions that make a space feel like home.',
  },
  code: {
    title: 'Code Loft',
    kicker: 'Software engineering',
    text: 'A treehouse halfway up the Great Oak, where the screens glow late into the night. By day I build software as a consultant at ipt; in my free time, up here, Via Communa and Via Physio — and the code behind this very woodland.',
  },
  home: {
    title: 'Jonny’s Cottage',
    kicker: 'About me & contact',
    text: 'The tall red mushroom with the crooked chimney is mine. Here is a bit about who I am — and the mailbox by the gate is always open.',
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
  'project-backend': {
    area: 'code',
    kind: 'project',
    title: 'Consulting at ipt',
    subtitle: 'What I build by day',
    year: '2023–',
    summary: 'My day job: Senior Consultant and software engineer at ipt, currently for the Swiss Armed Forces.',
    body: [
      'By day I am a Senior Consultant at ipt, a Swiss software engineering consultancy, where I work as a software engineer.',
      'Right now I work with BIT (the Swiss federal IT office) and the Swiss Armed Forces on rebuilding the army’s personnel management software. Besides building features end to end, I lead the AI side of the project: AI-assisted development in our team, the AI tooling around it, and AI inside the new product itself.',
      'Right now I am prototyping the new product twice over: once designed in Figma with the help of the Figma MCP server, once built entirely in code.',
      'Earlier at ipt I worked on Kafka-based event-streaming and integration platforms for banking and financial clients.',
    ],
    facts: [
      ['Role', 'Senior Consultant (software engineer)'],
      ['Company', 'ipt, Zurich'],
      ['Now', 'Personnel management software for the Swiss Armed Forces, with BIT'],
      ['Stack', 'Java, Spring Boot, Angular, Kafka, Kubernetes / OpenShift'],
    ],
    tags: ['Consulting', 'Java', 'Spring Boot', 'Angular', 'Kafka', 'AI engineering'],
    featured: true,
  },
  'project-side': {
    area: 'code',
    kind: 'project',
    title: 'Via Communa',
    subtitle: 'A companion app for stroke recovery — and the web dashboard behind it',
    year: '2024–',
    summary: 'The startup I co-founded in my free time: a stroke-recovery app for patients and relatives, with a web dashboard for clinics.',
    body: [
      'Via Communa is a digital companion for stroke survivors and for the relatives who support them. The app offers guided exercises for the body, the mind and everyday life, explains what happens after a stroke, and comes with Simi, a friendly turtle who stands for patience, consistency and steady progress.',
      'Via Communa has four co-founders, from healthcare, technology and psychology; I am the technology one, its CTO and only software engineer. I design and build the whole platform myself: the mobile app for iOS and Android, the backend, and the web dashboard. There, therapists create exercise content and clinics follow their patients’ progress.',
      'It is meant to complement therapy, not replace it: something to practise with between sessions and back at home. It is developed and hosted in Switzerland.',
    ],
    facts: [
      ['Role', 'Co-founder & CTO'],
      ['Platform', 'Mobile app (iOS & Android) · web dashboard · website'],
      ['Stack', 'React Native & Expo, Next.js, TypeScript, Supabase (Postgres)'],
    ],
    tags: ['Startup', 'Digital health', 'React Native', 'Next.js', 'Supabase'],
    images: [{ src: 'images/via-communa-app.webp', alt: 'The Via Communa app, with Simi the turtle' }],
    links: [{ label: 'viacommuna.com', href: 'https://www.viacommuna.com' }],
    featured: true,
  },
  'via-physio': {
    area: 'code',
    kind: 'project',
    title: 'Via Physio',
    subtitle: 'Home exercises for physio practices: filmed at the appointment, practised at home',
    year: '2026',
    summary: 'A home-exercise app for physiotherapy practices, with a practice dashboard and its own landing page.',
    body: [
      'Via Physio is another product from Via Communa, made for physiotherapy practices. The therapist films an exercise on their phone while the patient does it. At home, the patient practises with exactly that video — timer and set counter included — and after each exercise reports pain and difficulty, straight to the therapist’s inbox.',
      'Around the app sit a practice dashboard (“Praxis”), where owners invite their therapists and keep an eye on team, patients, seats and video storage, and a landing page that explains it all to practices and their patients. I build all three.',
    ],
    facts: [
      ['Parts', 'Mobile app · practice dashboard · landing page'],
      ['Status', 'Pilot phase — practices can join the pilot'],
      ['Stack', 'Expo & React Native, React, Next.js, TypeScript, Supabase'],
    ],
    tags: ['Digital health', 'Physiotherapy', 'Expo', 'Next.js'],
    images: [
      { src: 'images/via-physio-dashboard.webp', alt: 'The practice dashboard (sample data)' },
      { src: 'images/via-physio-app.webp', alt: 'Via Physio: a patient’s progress, week by week (sample data)' },
    ],
    links: [{ label: 'viaphysio.app', href: 'https://www.viaphysio.app/en/' }],
    featured: true,
  },
  'this-portfolio': {
    area: 'code',
    kind: 'project',
    title: 'This Woodland',
    subtitle: 'A miniature forest glen, built entirely in code',
    year: '2026',
    summary: 'Every mushroom, plank, leaf and snail in this glen is generated in code — no 3D models or textures were harmed.',
    body: [
      'The whole glen is procedural three.js: the Great Oak is sculpted from noise and curves, every shingle, stone and leaf card is placed by code, and the painterly bark, moss and stone textures are baked on the GPU when the page loads.',
      'Light does the rest: a low golden sun through the canopy, height fog and mist, light shafts with drifting motes, bloom and a miniature depth of field — and at night, moonlight, fireflies and glowing mushrooms.',
      'All the portfolio text lives in a single content file, so updating it never means touching the 3D code.',
    ],
    facts: [
      ['Stack', 'three.js, Vite, vanilla JS'],
      ['Assets', '100% procedural — no model or texture files'],
      ['Extras', 'day/night, secrets to find, synthesized sound'],
    ],
    tags: ['three.js', 'WebGL', 'Creative coding', 'Procedural'],
    links: [{ label: 'Source on GitHub', href: 'https://github.com/JonnysCode/portfolio' }],
    featured: true,
  },

  // ─── Home ─────────────────────────────────────────────────────────────────
  'about-me': {
    area: 'home',
    kind: 'about',
    title: 'About Me',
    subtitle: 'A software engineer with sawdust in the pockets',
    summary: 'Who lives in this cottage.',
    body: [
      'Hi, I am Jonny. I started out as a cabinetmaker: an apprenticeship, then several years at the bench and as an assembly carpenter in Swiss joineries. Then I went back to school — a professional baccalaureate, a bachelor’s in computer science at ZHAW (with an exchange semester in Seoul) and a master’s in computer science at the University of St. Gallen.',
      'Today I am a Senior Consultant at ipt, where I work as a software engineer. In my free time I build Via Communa, an app for people after a stroke, as its co-founder and CTO. Through all of it, I never stopped making things with my hands.',
      'DRAFT — A few sentences about what drives you, and what you are looking for.',
    ],
    facts: [
      ['Based in', 'Winterthur, Switzerland'],
      ['Day job', 'Senior Consultant at ipt'],
      ['Free time', 'Via Communa · Via Physio'],
      ['Studied', 'BSc ZHAW · MSc HSG'],
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
