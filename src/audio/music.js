// ─────────────────────────────────────────────────────────────────────────────
// The Schreinerei's record player — a lo-fi music-box waltz with vinyl crackle,
// a little wow & flutter, a needle drop when it starts and the platter winding
// down when it stops. Louder the closer the camera is to the record player.
//
//   createMusic(ac, { out, reverb, ctx }) → { play(id), stop(), playing }
// ─────────────────────────────────────────────────────────────────────────────
import { Vector3 } from 'three';
import { SCHREINEREI } from '../world/layout.js';
import { midi, rand } from './synth.js';

const BPM = 92;
const BEAT = 60 / BPM;

// An original little waltz in F major: [bar, beat, midi, beats]
const MELODY = [
  [0, 0, 81, 1], [0, 1, 79, 1], [0, 2, 77, 1],
  [1, 0, 72, 2], [1, 2, 69, 1],
  [2, 0, 70, 1], [2, 1, 74, 1], [2, 2, 77, 1],
  [3, 0, 76, 3],
  [4, 0, 79, 1], [4, 1, 77, 1], [4, 2, 76, 1],
  [5, 0, 74, 1.5], [5, 1.5, 72, 0.5], [5, 2, 70, 1],
  [6, 0, 69, 1], [6, 1, 72, 1], [6, 2, 77, 1],
  [7, 0, 79, 3],
  [8, 0, 81, 1], [8, 1, 82, 1], [8, 2, 81, 1],
  [9, 0, 79, 2], [9, 2, 76, 1],
  [10, 0, 77, 1], [10, 1, 74, 1], [10, 2, 70, 1],
  [11, 0, 72, 3],
  [12, 0, 74, 1], [12, 1, 76, 1], [12, 2, 77, 1],
  [13, 0, 79, 1.5], [13, 1.5, 81, 0.5], [13, 2, 79, 1],
  [14, 0, 77, 1], [14, 1, 76, 1], [14, 2, 79, 1],
  [15, 0, 77, 3],
];
// chord per bar: [bass, tone, tone]
const F = [53, 69, 72], Bb = [58, 70, 74], C = [48, 67, 72], C7 = [48, 70, 76];
const CHORDS = [F, F, Bb, C, C, Bb, F, C, F, C, Bb, F, Bb, C, C7, F];
const BARS = 16;

export function createMusic(ac, { out, reverb, ctx }) {
  let bus = null, lp = null, pan = null, crackle = null, wow = null, flutter = null, wowGain = null, flutterGain = null, slow = null, slowGain = null;
  let playing = false;
  let timer = 0;
  let nextBar = 0, barIndex = 0, loop = 0;
  let stopTimer = 0;
  const playerPos = { x: SCHREINEREI.deck.x, y: 1, z: SCHREINEREI.deck.z };

  function build() {
    bus = ac.createGain();
    bus.gain.value = 0;
    lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3600;
    lp.Q.value = 0.5;
    pan = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
    bus.connect(lp).connect(pan).connect(out);
    const send = ac.createGain();
    send.gain.value = 0.22;
    lp.connect(send).connect(reverb);
    // wow & flutter: shared detune modulators for every note
    wow = ac.createOscillator();
    wow.frequency.value = 0.55;
    wowGain = ac.createGain();
    wowGain.gain.value = 9;
    wow.connect(wowGain);
    flutter = ac.createOscillator();
    flutter.frequency.value = 6.2;
    flutterGain = ac.createGain();
    flutterGain.gain.value = 2.5;
    flutter.connect(flutterGain);
    // the platter speed (cents) — wound down when the record stops
    slow = ac.createConstantSource ? ac.createConstantSource() : null;
    if (slow) {
      slow.offset.value = 0;
      slowGain = slow;
      slow.start();
    }
    wow.start();
    flutter.start();
    // vinyl crackle: sparse clicks + a faint hiss, looping
    const n = Math.floor(ac.sampleRate * 3.7);
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      let v = (Math.random() * 2 - 1) * 0.012;
      if (Math.random() < 0.00045) v += (Math.random() < 0.5 ? -1 : 1) * rand(0.15, 0.7);
      d[i] = v;
    }
    for (let i = 1; i < n; i++) d[i] = d[i] * 0.6 + d[i - 1] * 0.4; // soften
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;
    crackle = ac.createGain();
    crackle.gain.value = 0;
    src.connect(hp).connect(crackle).connect(pan);
    src.start();
  }

  /** One music-box tine: a sine with a quickly fading inharmonic partial and a tiny pluck. */
  function tine(t, n, vel) {
    const f = midi(n);
    const decay = 2.4 - (n - 50) * 0.028;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(bus);
    const partials = [
      [1, 1],
      [2, 0.16],
      [5.4, 0.07],
    ];
    for (const [k, a] of partials) {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * k;
      wowGain.connect(o.detune);
      flutterGain.connect(o.detune);
      if (slowGain) slowGain.connect(o.detune);
      const pg = ac.createGain();
      pg.gain.setValueAtTime(a, t);
      if (k > 1) pg.gain.exponentialRampToValueAtTime(0.0001, t + decay * (k > 3 ? 0.08 : 0.3));
      o.connect(pg).connect(g);
      o.start(t);
      o.stop(t + decay + 0.05);
      o.onended = () => {
        try {
          wowGain.disconnect(o.detune);
          flutterGain.disconnect(o.detune);
          slowGain?.disconnect(o.detune);
        } catch {
          /* already gone */
        }
        pg.disconnect();
      };
    }
    setTimeout(() => g.disconnect(), (decay + 0.5) * 1000 + (t - ac.currentTime) * 1000);
  }

  function scheduleBar(t0, bar) {
    const human = () => rand(-0.008, 0.012);
    const [bass, a, b] = CHORDS[bar];
    tine(t0 + human(), bass, 0.16);
    for (const beat of [1, 2]) {
      tine(t0 + beat * BEAT + human(), a, 0.06);
      tine(t0 + beat * BEAT + human(), b, 0.055);
    }
    for (const [mb, beat, n, len] of MELODY) {
      if (mb !== bar) continue;
      // second time round: the melody an octave higher in the last half, like a wound-up box
      const up = loop % 2 === 1 && bar >= 8 ? 12 : 0;
      tine(t0 + beat * BEAT + human(), n + up, (len > 1.5 ? 0.2 : 0.17) * rand(0.88, 1.05));
    }
  }

  function pump() {
    if (!playing) return;
    const now = ac.currentTime;
    while (nextBar < now + 0.6) {
      scheduleBar(nextBar, barIndex);
      nextBar += 3 * BEAT;
      barIndex++;
      if (barIndex >= BARS) {
        barIndex = 0;
        loop++;
        nextBar += BEAT; // a little breath before it repeats
      }
    }
    // proximity & direction to the record player
    const cam = ctx.camera?.position;
    if (cam) {
      const p = ctx.interactions?.findByEntry?.('record-player')?.object;
      if (p) {
        const w = p.getWorldPosition?.(tmp);
        if (w) {
          playerPos.x = w.x;
          playerPos.y = w.y;
          playerPos.z = w.z;
        }
      }
      const dx = playerPos.x - cam.x, dy = playerPos.y - cam.y, dz = playerPos.z - cam.z;
      const d = Math.hypot(dx, dy, dz);
      const near = Math.min(1, Math.max(0.12, 1.25 - d / 26));
      bus.gain.setTargetAtTime(0.85 * near, now, 0.4);
      crackle.gain.setTargetAtTime(0.5 * near, now, 0.4);
      if (pan.pan && ctx.camera) {
        // which side of the screen is the player on?
        const m = ctx.camera.matrixWorld.elements;
        const rx = m[0], rz = m[2];
        const side = (dx * rx + dz * rz) / Math.max(d, 0.001);
        pan.pan.setTargetAtTime(Math.max(-0.7, Math.min(0.7, side * 0.8)), now, 0.3);
      }
    }
  }
  const tmp = new Vector3();

  return {
    get playing() {
      return playing;
    },
    play() {
      if (playing) return;
      if (!bus) build();
      clearTimeout(stopTimer);
      playing = true;
      const t = ac.currentTime;
      if (slow) {
        slow.offset.cancelScheduledValues(t);
        slow.offset.setValueAtTime(-500, t);
        slow.offset.exponentialRampToValueAtTime(-1, t + 0.7);
        slow.offset.setValueAtTime(0, t + 0.71);
      }
      // the needle drops: a soft thump, then crackle, then the tune
      const thump = ac.createOscillator();
      const tg = ac.createGain();
      thump.frequency.setValueAtTime(90, t);
      thump.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      tg.gain.setValueAtTime(0.0001, t);
      tg.gain.linearRampToValueAtTime(0.18, t + 0.01);
      tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      thump.connect(tg).connect(pan);
      thump.start(t);
      thump.stop(t + 0.25);
      crackle.gain.setTargetAtTime(0.5, t, 0.1);
      bus.gain.setTargetAtTime(0.85, t, 0.2);
      nextBar = t + 0.7;
      barIndex = 0;
      loop = 0;
      timer = setInterval(pump, 90);
      pump();
    },
    stop() {
      if (!playing) return;
      playing = false;
      clearInterval(timer);
      const t = ac.currentTime;
      // the platter winds down
      if (slow) {
        slow.offset.cancelScheduledValues(t);
        slow.offset.setValueAtTime(0, t);
        slow.offset.linearRampToValueAtTime(-900, t + 1.1);
      }
      bus.gain.setTargetAtTime(0, t + 0.2, 0.35);
      crackle.gain.setTargetAtTime(0, t + 0.6, 0.3);
      stopTimer = setTimeout(() => {
        if (!playing && slow) slow.offset.setValueAtTime(0, ac.currentTime);
      }, 2500);
    },
  };
}
