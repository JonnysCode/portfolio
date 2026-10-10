# 🍄 Jonny's Woodland

A portfolio you can explore like a miniature diorama: a magical forest glen
under a colossal oak, full of mushroom houses, little villagers, snails and
fireflies — built **entirely procedurally with three.js** (no 3D model or
texture files). Every corner of the glen is one of my passions:

| | Spot | What's there |
|---|---|---|
| 🪚 | **Schreinerei** | a woodworking shop in the roots of the Great Oak: my Schreiner EFZ, the dining table, the record player (click it!) … |
| 💻 | **Code Loft** | a treehouse halfway up the oak — software projects, including this one |
| 🍄 | **Jonny's Cottage** | about me & contact (the mailbox by the gate) |
| 🛋️ | **Wohnatelier** | a mushroom house opened like a dollhouse: interior design |
| 🚲 | **Velowerkstatt** | across the stone bridge: bike builds, restorations, wheels |

Glide between spots with the spot bar (or ← → / 1–6), drag to look around,
scroll to zoom, and click whatever looks interesting. Press **N** for night:
moonbeams, fireflies, a glow-worm canopy and glowing mushrooms. Ten secrets
hide in the glen (three only come out after dark). Prefer reading? The 📖
guidebook lists everything on one page, and the 🗺 map jumps anywhere.

Under the hood: a sculpted Great Oak, GPU-baked painterly textures (bark,
moss, stone, wood grain…), instanced forests of giants, ferns and mushroom
families, a golden-hour light rig with dappled shadows, height fog, light
shafts, bloom and a miniature depth of field — and quality tiers so phones stay
smooth.

## ✏️ Make it yours

All text lives in **[`src/content/content.js`](src/content/content.js)**:
your profile, the intro of each area and every project ("entry"). Entries are
referenced by id from the 3D world, so you can rewrite titles, text, facts,
tags and links without touching any three.js code. Placeholder copy is marked
`DRAFT`: it shows (with a little "draft" marker) while you run `npm run dev`,
and is hidden from visitors in the production build — so replace it before
you publish, and set `profile.email` (the example address is hidden too).
`npm run build` lists what is still a placeholder. Also check the profile
lines that are *not* marked DRAFT but were written for you: `tagline`, `intro`
and `location: 'Switzerland'` — the About and contact pages show them.
Until an entry has photos, its page shows a live "polaroid" of the piece in
the glen; without an email the contact page leads with your strongest link
(add LinkedIn with `icon: 'linkedin'` and it leads with that).

Every place and page has a deep link: `#woodworking`, `#woodworking/dining-table`,
`#guidebook` — handy for sharing a single piece.

Photos: put them in `public/images/` and add them to an entry:

```js
images: [{ src: 'images/dining-table.jpg', alt: 'Oak dining table with breadboard ends' }],
```

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
npm run preview    # serve the build
```

Handy URL flags: `?night=1` (start at night), `?q=low|medium|high` (quality
tier), `?debug`, `?only=oak,terrain` (build only some modules). In the browser
console, `__woodland.debug` has helpers such as `goTo('woodworking')`,
`view('bikes-close')` and `stats()`.

`npm run shots` renders headless screenshots of every spot into `shots/` and
fails on console errors — see [`scripts/shots.mjs`](scripts/shots.mjs).
[`scripts/flow.mjs`](scripts/flow.mjs) runs multi-step interaction flows
(clicks, keys, glides) and screenshots each step.
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) explains how the glen is put
together (layout & anchors, module contract, art bible, performance budget).

## Deploy

`npm run build` produces a fully static `dist/` folder with relative asset
paths, so it works on any static host. A GitHub Actions workflow
([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) publishes to
GitHub Pages on every push to `main` — enable it once under
**Settings → Pages → Source: GitHub Actions**.
