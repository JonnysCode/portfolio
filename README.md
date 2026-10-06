# 🍄 Jonny's Woodland

A portfolio you can walk around in: a cozy woodland village of mushroom houses,
little villagers and rideable snails, built **entirely procedurally with
three.js** — no 3D model files. Each corner of the village is one of my
passions:

| | Area | What's there |
|---|---|---|
| ⛲ | **Village Square** | signposts, notice board, the Schneckenpost stop |
| 🪚 | **Schreinerei** | woodworking: my Schreiner EFZ, tables, the record player, … |
| 🚲 | **Velowerkstatt** | bike builds, restorations, wheel building |
| 🛋️ | **Wohnatelier** | interior design concepts and material boards |
| 💻 | **Code Grove** | software projects (including this one) |
| 🏡 | **Jonny's Cottage** | about me & contact |

Walk by clicking the ground (or WASD), drag to look around, click glowing things
to read about them, and hop on a yellow **Schneckenpost** snail to travel.
Prefer reading? The 📖 guidebook lists everything on one page.

## ✏️ Make it yours

All text lives in **[`src/content/content.js`](src/content/content.js)**:
your profile, the intro of each area and every project ("entry"). Entries are
referenced by id from the 3D world, so you can rewrite titles, text, facts,
tags and links without touching any three.js code. Placeholder copy is marked
`DRAFT`.

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
tier), `?debug`. In the browser console, `__woodland.debug` has helpers such
as `view('woodworking')`, `teleportToArea('bikes')` and `stats()`.

`npm run shots` renders headless screenshots of every area into `shots/` and
fails on console errors — see [`scripts/shots.mjs`](scripts/shots.mjs).
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) explains how the world is put
together (layout, district contract, art direction, performance budget).

## Deploy

`npm run build` produces a fully static `dist/` folder with relative asset
paths, so it works on any static host. A GitHub Actions workflow
([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) publishes to
GitHub Pages on every push to `main` — enable it once under
**Settings → Pages → Source: GitHub Actions**.
