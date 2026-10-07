// ─────────────────────────────────────────────────────────────────────────────
// Sound effects — all synthesized: wooden clicks, paper page flips, a soft
// whoosh for glides, the discovery chime, a secret twinkle, critter babble for
// speech bubbles, and the Swiss PostAuto three-tone horn (C♯–E–A).
//
//   createSfx(ac, { out, reverb }) → play(name, opts)
// ─────────────────────────────────────────────────────────────────────────────
import { noiseBuffer, envelope, midi, rand } from './synth.js';

export function createSfx(ac, { out, reverb }) {
  const wet = ac.createGain();
  wet.gain.value = 0.55;
  wet.connect(reverb);

  function osc(type, f, t, dest) {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.connect(dest);
    o.start(t);
    return o;
  }
  function gain(v = 0, dest = out) {
    const g = ac.createGain();
    g.gain.value = v;
    g.connect(dest);
    return g;
  }
  function noise(t, dur, dest, kind = 'white') {
    const s = ac.createBufferSource();
    s.buffer = noiseBuffer(ac, kind, 2);
    s.connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
    return s;
  }

  /** A bell-ish tone: a sine with an inharmonic partial (music box / chime). */
  function bell(t, f, { peak = 0.2, decay = 1.2, dest = out, send = 0.4 } = {}) {
    const g = gain(0, dest);
    envelope(g.gain, t, { peak, attack: 0.003, decay });
    const o1 = osc('sine', f, t, g);
    const g2 = gain(0, g);
    envelope(g2.gain, t, { peak: 0.35, attack: 0.002, decay: decay * 0.35 });
    const o2 = osc('sine', f * 2.76, t, g2);
    if (send) {
      const s = gain(send, wet);
      g.connect(s);
    }
    o1.stop(t + decay + 0.1);
    o2.stop(t + decay + 0.1);
  }

  const SOUNDS = {
    // a small wooden tick
    click(t) {
      const g = gain(0);
      envelope(g.gain, t, { peak: 0.22, attack: 0.001, decay: 0.07 });
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2400;
      bp.Q.value = 3;
      bp.connect(g);
      noise(t, 0.06, bp);
      const g2 = gain(0);
      envelope(g2.gain, t, { peak: 0.12, attack: 0.001, decay: 0.05 });
      const o = osc('triangle', 900, t, g2);
      o.frequency.exponentialRampToValueAtTime(420, t + 0.05);
      o.stop(t + 0.08);
    },
    // hover: a soft wooden "pok"
    pop(t) {
      const g = gain(0);
      envelope(g.gain, t, { peak: 0.09, attack: 0.002, decay: 0.09 });
      const o = osc('sine', 520, t, g);
      o.frequency.exponentialRampToValueAtTime(880, t + 0.06);
      o.stop(t + 0.12);
    },
    // a secret under the cursor: three high glints
    twinkle(t) {
      [2093, 2794, 3520].forEach((f, i) => bell(t + i * 0.055, f * rand(0.99, 1.01), { peak: 0.045, decay: 0.5, send: 0.8 }));
    },
    // paper: a page turned in the journal
    page(t) {
      const g = gain(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.34, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(900, t);
      bp.frequency.exponentialRampToValueAtTime(4200, t + 0.22);
      bp.connect(g);
      noise(t, 0.35, bp, 'pink');
    },
    open(t) {
      SOUNDS.page(t);
    },
    close(t) {
      const g = gain(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.8;
      bp.frequency.setValueAtTime(3200, t);
      bp.frequency.exponentialRampToValueAtTime(700, t + 0.2);
      bp.connect(g);
      noise(t, 0.25, bp, 'pink');
      const g2 = gain(0);
      envelope(g2.gain, t + 0.16, { peak: 0.08, attack: 0.002, decay: 0.12 });
      const o = osc('sine', 140, t + 0.16, g2);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.3);
      o.stop(t + 0.35);
    },
    // gliding between spots: air through leaves
    whoosh(t) {
      const g = gain(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.24, t + 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.7;
      bp.frequency.setValueAtTime(320, t);
      bp.frequency.exponentialRampToValueAtTime(1300, t + 0.6);
      bp.frequency.exponentialRampToValueAtTime(380, t + 1.6);
      bp.connect(g);
      noise(t, 1.7, bp, 'pink');
    },
    // a discovery: a little rising arpeggio of bells
    chime(t) {
      [72, 76, 79, 84, 88].forEach((n, i) => bell(t + i * 0.085, midi(n), { peak: 0.09 - i * 0.008, decay: 1.6, send: 0.7 }));
    },
    // the Swiss PostAuto three-tone horn: C♯ – E – A (the "Dü-da-do")
    horn(t) {
      const notes = [
        [midi(73), 0, 0.42], // C♯5
        [midi(64), 0.5, 0.42], // E4
        [midi(69), 1.0, 0.85], // A4
      ];
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 2.2;
      const g = gain(0);
      g.gain.value = 0.085;
      lp.connect(g);
      const s = gain(0.5, wet);
      g.connect(s);
      for (const [f, at, dur] of notes) {
        const t0 = t + at;
        const env = ac.createGain();
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.linearRampToValueAtTime(1, t0 + 0.04);
        env.gain.setValueAtTime(0.85, t0 + dur - 0.06);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.08);
        env.connect(lp);
        // the brassy "blat": the filter opens on each attack
        lp.frequency.setValueAtTime(700, t0);
        lp.frequency.exponentialRampToValueAtTime(2600, t0 + 0.07);
        lp.frequency.exponentialRampToValueAtTime(1500, t0 + dur);
        for (const det of [-6, 0, 7]) {
          const o = osc('sawtooth', f, t0, env);
          o.detune.value = det;
          o.frequency.setValueAtTime(f * 0.97, t0);
          o.frequency.exponentialRampToValueAtTime(f, t0 + 0.05);
          o.stop(t0 + dur + 0.12);
        }
      }
    },
    // speech bubble: critter babble (a few voice blips)
    chirp(t) {
      const n = 3 + Math.floor(Math.random() * 3);
      const base = rand(420, 640);
      for (let i = 0; i < n; i++) {
        const t0 = t + i * rand(0.06, 0.09);
        const g = gain(0);
        envelope(g.gain, t0, { peak: 0.05, attack: 0.008, decay: 0.07 });
        const o = osc('triangle', base * rand(0.85, 1.35), t0, g);
        o.frequency.exponentialRampToValueAtTime(base * rand(0.9, 1.5), t0 + 0.06);
        o.stop(t0 + 0.1);
      }
    },
    step(t) {
      const g = gain(0);
      envelope(g.gain, t, { peak: 0.06, attack: 0.002, decay: 0.08 });
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      lp.connect(g);
      noise(t, 0.1, lp, 'brown');
    },
  };

  return function play(name, { delay = 0 } = {}) {
    const fn = SOUNDS[name];
    if (!fn) return;
    fn(ac.currentTime + 0.01 + delay);
  };
}
