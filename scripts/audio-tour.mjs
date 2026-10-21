#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Audio check: renders a scripted visit through the real sound code
// (src/audio/*) in an OfflineAudioContext — entering the glen, glides between
// every spot, clicks, journal pages, the record player, a secret, nightfall —
// and reports its loudness (ITU-R BS.1770: integrated, short-term, momentary
// LUFS and sample peak), per stem, per sound and per spot. Writes the mix as
// a WAV to listen to.
//
//   node scripts/audio-tour.mjs [--prefix before-] [--only mix|amb|sfx|places|solo]
//
// Timers inside the sound code run on the render clock (virtual; an overdue
// interval catches up instead of coalescing), so the same visit can be compared
// before and after a change; the ~108 s visit takes about 10 s per stem. The
// context always reports 'running' and suspend/resume do nothing, so the
// hidden-tab fade, setEnabled(false), music.js's bar skipping and the bubbles'
// state guard are not exercised here: check those in a real browser. Noise and
// bird phrases are random, so numbers move by a few tenths of a dB between runs.
// Measurements start once the fade-in has settled (the glen's bed at 5.5 s).
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i < 0 ? d : args[i + 1];
};
const prefix = opt('prefix', '');
const only = opt('only', null);
const SR = 48000;
const SOLO = ['click', 'pop', 'page', 'close', 'twinkle', 'chime', 'chirp', 'horn'];
// close-ups and the intro's low pass: [label, camera position, target] (ambience only, 6 s each)
const PLACES = [
  ['intro, low over the meadow', [0.1, 1.45, 21.2], [0, 6.9, -4]],
  ['bridge close-up', [10.2, 1.3, 7.2], [11.6, 0.6, 5]],
  ['bikes close-up', [13.2, 1.1, 9.6], [14.65, 0.6, 8.4]],
  ['pond close-up', [8.6, 1.2, 15.4], [9.8, 0, 18.2]],
  ['plunge pool', [14.2, 1.6, -6.8], [16.5, 0.5, -10.5]],
  ['woodworking close-up', [0.4, 1.6, 4.6], [-1.4, 1.1, -0.8]],
  ['code loft deck', [6.8, 13.4, 2.6], [3.4, 12.6, -3.2]],
];

// ── the visit: [time s, action, arg] ────────────────────────────────────────
const SPOT_SEQ = ['woodworking', 'bikes', 'code', 'home', 'interior', 'glen'];
function visit(stem) {
  if (stem === 'places') {
    const ev = [[0.5, 'enter']];
    PLACES.forEach(([, p, t], i) => ev.push([6 + i * 6, 'place', i]));
    return { events: ev, duration: 6 + PLACES.length * 6 };
  }
  if (stem === 'solo') {
    // every sound alone (ambience off), 4 s apart; the record after a glide to the Schreinerei
    const ev = [[0.5, 'enter']];
    SOLO.forEach((n, i) => ev.push([3 + i * 4, 'sfx', n]));
    const t = 3 + SOLO.length * 4;
    ev.push([t, 'glide', 'woodworking'], [t + 4, 'music', true], [t + 10, 'music', false]);
    return { events: ev, duration: t + 12 };
  }
  const ev = [[0.5, 'enter']];
  let t = 10;
  for (const id of SPOT_SEQ) {
    ev.push([t, 'sfx', 'click'], [t + 0.05, 'glide', id]);
    // a little browsing at each place: hovers, a page opened and closed
    ev.push([t + 5, 'sfx', 'pop'], [t + 5.6, 'sfx', 'pop'], [t + 6.4, 'sfx', 'click'], [t + 6.45, 'sfx', 'page']);
    if (id === 'woodworking') ev.push([t + 7, 'music', true], [t + 13, 'music', false]);
    if (id === 'bikes') ev.push([t + 8.5, 'sfx', 'twinkle'], [t + 9, 'sfx', 'chime']);
    if (id === 'code') ev.push([t + 8.5, 'sfx', 'chirp']);
    ev.push([t + 10, 'sfx', 'close']);
    t += 12;
  }
  ev.push([t, 'night', 1], [t + 14, 'sfx', 'horn']);
  return { events: ev, duration: t + 26 };
}

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch();
const page = await browser.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`[console] ${m.text()}`));
await page.goto(`${base}/favicon.svg`);

/** Render one stem of the visit in the page; returns interleaved channel data. */
async function render(stem) {
  const { events, duration } = visit(stem);
  const out = await page.evaluate(
    async ({ events, duration, stem, SR, PLACES }) => {
      const { createAudio } = await import('/src/audio/audio.js');
      const { SPOT_BY_ID } = await import('/src/world/layout.js');
      // virtual timers on the render clock
      let vnow = 0, seq = 1;
      const timers = new Map();
      window.setTimeout = (fn, ms = 0) => (timers.set(seq, { fn, at: vnow + ms, every: 0 }), seq++);
      window.setInterval = (fn, ms = 0) => (timers.set(seq, { fn, at: vnow + ms, every: Math.max(ms, 1) }), seq++);
      window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
      const runTimers = () => {
        for (let guard = 0; guard < 1000; guard++) {
          let next = null;
          for (const [id, tm] of timers) if (tm.at <= vnow && (!next || tm.at < next[1].at)) next = [id, tm];
          if (!next) return;
          const [id, tm] = next;
          if (tm.every) tm.at += tm.every;
          else timers.delete(id);
          tm.fn();
        }
      };
      const oac = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(duration * SR), sampleRate: SR });
      const realSuspend = oac.suspend.bind(oac);
      const realResume = oac.resume.bind(oac);
      oac.suspend = () => Promise.resolve();
      oac.resume = () => Promise.resolve();
      // the sound code sees a running real-time context (the render pauses at every step)
      Object.defineProperty(oac, 'state', { get: () => 'running' });
      window.AudioContext = function () {
        return oac;
      };
      // a camera the ambience and the record player can read
      const cam = { position: { x: 0, y: 0, z: 0 }, matrixWorld: { elements: new Array(16).fill(0) } };
      const setCam = (p, target) => {
        cam.position.x = p[0];
        cam.position.y = p[1];
        cam.position.z = p[2];
        const dx = target[0] - p[0], dz = target[2] - p[2];
        const l = Math.hypot(dx, dz) || 1;
        cam.matrixWorld.elements[0] = -dz / l; // camera right = forward × up
        cam.matrixWorld.elements[2] = dx / l;
      };
      const env = { night: 0 };
      const ctx = { camera: cam, env };
      const audio = createAudio(ctx);
      let glide = null;
      let night = null;
      const camOf = (id) => SPOT_BY_ID[id].camera;
      let at = camOf('glen');
      setCam(at.position, at.target);
      const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
      const lerp = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
      const act = {
        enter() {
          audio.unlock();
          audio.setEnabled(true);
          if (stem === 'sfx' || stem === 'solo') audio.stopAmbience();
        },
        place(i) {
          setCam(PLACES[i][1], PLACES[i][2]);
        },
        sfx(name) {
          if (stem !== 'amb') audio.play(name);
        },
        glide(id, t) {
          const to = camOf(id);
          const hop = Math.hypot(...to.position.map((v, i) => v - at.position[i]));
          // the rig's own duration rule (cameraRig.js glideTo)
          const dur = Math.min(3.6, Math.max(1.8, 1.25 + hop * 0.8 * 0.045));
          glide = { from: at, to, t0: t, dur };
          if (stem !== 'amb') audio.play('whoosh');
          at = to;
        },
        music(on) {
          if (stem === 'amb') return;
          if (on) audio.playMusic('record');
          else audio.stopMusic();
        },
        night(v, t) {
          night = { t0: t, from: env.night, to: v, dur: 4 };
        },
      };
      const queue = events.slice().sort((a, b) => a[0] - b[0]);
      const STEP = 0.02;
      const n = Math.floor(duration / STEP);
      for (let i = 1; i < n; i++) {
        const t = i * STEP;
        realSuspend(t).then(() => {
          vnow = t * 1000;
          while (queue.length && queue[0][0] <= t) {
            const [, name, arg] = queue.shift();
            act[name](arg, t);
          }
          if (glide) {
            const k = Math.min(1, (t - glide.t0) / glide.dur);
            const e = ease(k);
            setCam(lerp(glide.from.position, glide.to.position, e), lerp(glide.from.target, glide.to.target, e));
            if (k >= 1) glide = null;
          }
          if (night) {
            const k = Math.min(1, (t - night.t0) / night.dur);
            env.night = night.from + (night.to - night.from) * k;
            if (k >= 1) night = null;
          }
          runTimers();
          realResume();
        });
      }
      const buf = await oac.startRendering();
      // hand the float samples back as base64 (a plain array would be ~10× larger)
      const b64 = (f32) => {
        const u8 = new Uint8Array(f32.buffer);
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return btoa(s);
      };
      return { L: b64(buf.getChannelData(0)), R: b64(buf.getChannelData(1)) };
    },
    { events, duration, stem, SR, PLACES },
  );
  const f32 = (s) => {
    const b = Buffer.from(s, 'base64');
    return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  };
  return { L: f32(out.L), R: f32(out.R), events, duration };
}

// ── BS.1770 loudness ────────────────────────────────────────────────────────
function biquad(x, [b0, b1, b2, a1, a2]) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}
// 48 kHz K-weighting (pre-filter shelf + RLB high-pass)
const SHELF = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
const RLB = [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621];
function kPower(L, R) {
  const kl = biquad(biquad(L, SHELF), RLB), kr = biquad(biquad(R, SHELF), RLB);
  const p = new Float64Array(L.length);
  for (let i = 0; i < L.length; i++) p[i] = kl[i] * kl[i] + kr[i] * kr[i];
  return p;
}
const lufs = (ms) => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity);
function windows(p, win, hop, from = 0, to = p.length) {
  const out = [];
  const w = Math.round(win * SR), h = Math.round(hop * SR);
  // prefix sums for speed
  const cs = new Float64Array(p.length + 1);
  for (let i = 0; i < p.length; i++) cs[i + 1] = cs[i] + p[i];
  for (let s = from; s + w <= to; s += h) out.push({ t: s / SR, ms: (cs[s + w] - cs[s]) / w });
  return out;
}
function integrated(p, from = 0, to = p.length) {
  const blocks = windows(p, 0.4, 0.1, from, to).filter((b) => lufs(b.ms) > -70);
  if (!blocks.length) return -Infinity;
  const mean = (bs) => bs.reduce((a, b) => a + b.ms, 0) / bs.length;
  const rel = lufs(mean(blocks)) - 10;
  const gated = blocks.filter((b) => lufs(b.ms) > rel);
  return lufs(mean(gated.length ? gated : blocks));
}
const maxOf = (ws) => ws.reduce((m, b) => Math.max(m, lufs(b.ms)), -Infinity);
function peak(L, R, from = 0, to = L.length) {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i]));
  return 20 * Math.log10(m || 1e-9);
}
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1).padStart(6) : '  -inf');

function wav(L, R) {
  const n = L.length;
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  const s = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  for (let i = 0; i < n; i++) { b.writeInt16LE(s(L[i]), 44 + i * 4); b.writeInt16LE(s(R[i]), 46 + i * 4); }
  return b;
}

// ── run ─────────────────────────────────────────────────────────────────────
const outDir = path.join(root, 'shots', 'audio');
await mkdir(outDir, { recursive: true });
const stems = only ? [only] : ['mix', 'amb', 'sfx', 'places', 'solo'];
const results = {};
for (const stem of stems) {
  const r = await render(stem);
  r.p = kPower(r.L, r.R);
  results[stem] = r;
  await writeFile(path.join(outDir, `${prefix}${stem === 'mix' ? 'tour' : stem}.wav`), wav(r.L, r.R));
}

const any = results.mix ?? results[stems[0]];
console.log(`\nvisit: ${any.duration.toFixed(0)} s, ${SR} Hz${prefix ? ` (${prefix})` : ''}`);
console.log('\nstem       integrated  max short-term  max momentary  peak dBFS');
for (const stem of stems) {
  const r = results[stem];
  console.log(`${stem.padEnd(10)} ${f1(integrated(r.p))} LUFS  ${f1(maxOf(windows(r.p, 3, 0.1)))}         ${f1(maxOf(windows(r.p, 0.4, 0.05)))}        ${f1(peak(r.L, r.R))}`);
}

// per spot: the ambience while dwelling there (after the glide settles)
if (results.amb) {
  const r = results.amb;
  console.log('\nambience by place (dwell, 4–11 s after arriving)   short-term LUFS mean / max');
  const dwell = [['glen (start)', 5.5, 9.9]];
  let t = 10;
  for (const id of SPOT_SEQ) { dwell.push([id, t + 4, t + 11]); t += 12; }
  dwell.push(['glen at night', t + 6, t + 25]);
  for (const [name, a, b] of dwell) {
    const ws = windows(r.p, 3, 0.25, Math.round(a * SR), Math.round(b * SR));
    const mean = lufs(ws.reduce((s, w) => s + w.ms, 0) / Math.max(1, ws.length));
    console.log(`  ${name.padEnd(16)} ${f1(mean)} / ${f1(maxOf(ws))}`);
  }
}

if (results.places) {
  const r = results.places;
  console.log('\nambience close up (ambience only, 2–6 s after arriving)   short-term LUFS');
  PLACES.forEach(([name], i) => {
    const a = 6 + i * 6 + 2, b = a + 4;
    const ws = windows(r.p, 3, 0.25, Math.round(a * SR), Math.round(b * SR));
    console.log(`  ${name.padEnd(28)} ${f1(lufs(ws.reduce((s, w) => s + w.ms, 0) / Math.max(1, ws.length)))}`);
  });
}

// per sound: momentary max and peak, each sound alone (solo stem)
if (results.solo) {
  const r = results.solo;
  const seen = new Map();
  for (const [t, name, arg] of r.events) {
    const label = name === 'glide' ? 'whoosh' : name === 'music' ? (arg ? 'record' : null) : name === 'sfx' ? arg : null;
    if (!label || seen.has(label)) continue;
    const len = { whoosh: 2.2, record: 5.5, horn: 2.5, chime: 2.2 }[label] ?? 0.6;
    const a = Math.round(t * SR), b = Math.min(r.L.length, Math.round((t + len) * SR));
    seen.set(label, { mom: maxOf(windows(r.p, 0.4, 0.02, a, b)), pk: peak(r.L, r.R, a, b), len });
  }
  console.log('\nsounds (each alone)   max momentary LUFS  peak dBFS  window s');
  for (const [k, v] of seen) console.log(`  ${k.padEnd(10)} ${f1(v.mom)}            ${f1(v.pk)}     ${v.len}`);
}

if (results.mix) {
  // the loudest moments of the mix, with what happened then
  const r = results.mix;
  const st = windows(r.p, 3, 0.5).map((w) => ({ ...w, l: lufs(w.ms) }));
  const top = st.slice().sort((a, b) => b.l - a.l).slice(0, 5);
  console.log('\nloudest 3 s of the mix');
  for (const w of top) {
    const near = r.events.filter(([et]) => et >= w.t - 0.5 && et <= w.t + 3).map(([, n, a]) => (n === 'sfx' ? a : `${n}:${a}`));
    console.log(`  ${w.t.toFixed(1).padStart(5)} s ${f1(w.l)} LUFS  ${near.join(', ')}`);
  }
  console.log(`\nwrote ${path.relative(root, path.join(outDir, `${prefix}tour.wav`))}`);
}
if (problems.length) console.log('\nproblems:\n' + problems.join('\n'));
await browser.close();
await server.close();
