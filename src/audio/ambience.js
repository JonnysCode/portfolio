// ─────────────────────────────────────────────────────────────────────────────
// The glen's ambience — synthesized and mixed by where the camera is:
//   day    birdsong (robin warbles, tit "tee-cha"s, a finch trill, now and then
//          a distant cuckoo) and leaves rustling in slow gusts
//   night  crickets in the grass, a tawny owl, quieter leaves
//   always a soft forest room tone, the stream's babble — a low rush and
//          little bubbles, louder near the bridge, the Velowerkstatt and the
//          pond — and the waterfall's hush (louder towards the back-right)
//
// Levels are set so that no place is more than ~4 LU louder than the glen's
// bed (node scripts/audio-tour.mjs measures them): the water is a babble you
// notice when you are close, never a wall of noise.
//
//   createAmbience(ac, { out, reverb, ctx }) → { start(), stop(), tick() }
// ─────────────────────────────────────────────────────────────────────────────
import { STREAM } from '../world/layout.js';
import { getStreamDistance } from '../world/ground.js';
import { noiseSource, envelope, rand, pick } from './synth.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const TICK = 0.12; // s between mixing updates
const BUBBLE_AHEAD = 0.35; // s of bubbles scheduled ahead of the audio clock

/** The noise beds: [noise, buffer seconds, filter, frequency, Q, starting gain]. */
const BEDS = {
  room: ['brown', 7.3, 'lowpass', 320, 0.4, 0.05], // the forest breathing
  leaves: ['pink', 9.1, 'bandpass', 1500, 0.6, 0], // soft pink noise in the mids, gusting
  brook: ['pink', 6.7, 'lowpass', 760, 0.5, 0], // the stream's low rush (the babble itself is the bubbles)
  fallLo: ['brown', 8.3, 'lowpass', 520, 0.6, 0], // the waterfall's deep hush
};
/** The noise the beds need, for synth.js prepareNoise() (generated during the loading screen). */
export const AMBIENCE_NOISE = Object.values(BEDS).map(([kind, seconds]) => [kind, seconds]);

export function createAmbience(ac, { out, reverb, ctx }) {
  const bus = ac.createGain();
  bus.gain.value = 0;
  bus.connect(out);
  const wet = ac.createGain();
  wet.gain.value = 0.5;
  wet.connect(reverb);
  let nodes = [];
  let running = false;
  let nextBird = 0, nextCuckoo = 0, nextOwl = 0, nextCricket = 0, nextBubble = 0;
  let layers = null;
  let beds = [];

  /**
   * A noise bed: two reads of one buffer, half a buffer apart (left and right,
   * so it surrounds the listener instead of sitting inside their head; a mono
   * downmix plays the beds ~3 dB lower against the centred sounds). Each layer
   * gets its own buffer length, so no two layers loop together, and each bed
   * drifts its speed by a few percent (inaudible on noise; see tick()), so its
   * own loop never lines up with itself either. Both reads always drift
   * together, so the left and right stay half a buffer apart.
   */
  function bed(kind, seconds, filterType, freq, q, gain) {
    const m = ac.createChannelMerger(2);
    const o = rand(0, seconds);
    const l = noiseSource(ac, kind, seconds, o), r = noiseSource(ac, kind, seconds, (o + seconds / 2) % seconds);
    l.connect(m, 0, 0);
    r.connect(m, 0, 1);
    const f = ac.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ac.createGain();
    g.gain.value = gain;
    m.connect(f).connect(g).connect(bus);
    nodes.push(l, r);
    return { f, g, reads: [l, r] };
  }

  let bubbleOut = null;
  function build() {
    layers = Object.fromEntries(Object.entries(BEDS).map(([name, spec]) => [name, bed(...spec)]));
    beds = Object.values(layers);
    // bubbles: three fixed pans (left, centre, right) and a gentle top cut
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    lp.connect(bus);
    const send = ac.createGain();
    send.gain.value = 0.25;
    lp.connect(send).connect(wet);
    bubbleOut = [-0.55, 0, 0.55].map((pan) => {
      const p = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
      if (p.pan) p.pan.value = pan;
      p.connect(lp);
      return p;
    });
  }

  /** One water bubble: a short sine blip rising in pitch (the sound of a bubble's cavity closing). */
  function bubble(t, peak) {
    const f0 = rand(380, 1150);
    const dur = rand(0.018, 0.055);
    const e = ac.createGain();
    e.gain.value = 0;
    e.connect(pick(bubbleOut));
    envelope(e.gain, t, { peak, attack: 0.002, decay: dur });
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * rand(1.35, 2.1), t + dur);
    o.connect(e);
    o.start(t);
    o.stop(t + dur + 0.03);
    o.onended = () => e.disconnect();
  }

  // ── voices ────────────────────────────────────────────────────────────────
  function voice(t, pan, gain, send = 0.35) {
    const g = ac.createGain();
    g.gain.value = 0;
    const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
    if (p) {
      p.pan.value = pan;
      g.connect(p).connect(bus);
    } else g.connect(bus);
    const s = ac.createGain();
    s.gain.value = send;
    g.connect(s).connect(wet);
    // let the little graph go once the phrase is over
    setTimeout(() => {
      g.disconnect();
      s.disconnect();
      p?.disconnect();
    }, 6000);
    return { g, peak: gain };
  }
  function tone(t, dest, f0, f1, dur, type = 'sine') {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function note(t, v, f0, f1, dur, peak = 1) {
    const e = ac.createGain();
    e.gain.value = 0;
    e.connect(v.g);
    envelope(e.gain, t, { peak, attack: Math.min(0.012, dur * 0.2), decay: dur });
    tone(t, e, f0, f1, dur);
  }

  const BIRDS = {
    // a robin: tumbling, varied, silvery phrases
    robin(t, v) {
      let tt = t;
      const n = 5 + Math.floor(Math.random() * 6);
      for (let i = 0; i < n; i++) {
        const f = rand(2600, 5200);
        const d = rand(0.05, 0.13);
        note(tt, v, f, f * rand(0.7, 1.4), d, rand(0.5, 1));
        tt += d + rand(0.01, 0.07);
      }
    },
    // a great tit: "tee-cha tee-cha tee-cha"
    tit(t, v) {
      const hi = rand(5200, 6200), lo = hi * 0.62;
      const reps = 3 + Math.floor(Math.random() * 2);
      for (let i = 0; i < reps; i++) {
        const t0 = t + i * 0.28;
        note(t0, v, hi, hi * 0.97, 0.07, 0.9);
        note(t0 + 0.11, v, lo, lo * 0.95, 0.09, 0.8);
      }
    },
    // a chaffinch: an accelerating, descending trill with a flourish
    finch(t, v) {
      let tt = t, f = rand(4800, 5600), d = 0.075;
      for (let i = 0; i < 12; i++) {
        note(tt, v, f, f * 0.9, d * 0.8, 0.8);
        tt += d;
        d *= 0.93;
        f *= 0.975;
      }
      note(tt + 0.02, v, f * 1.3, f * 0.7, 0.18, 1);
    },
    // a wren-like high warble
    warble(t, v) {
      let tt = t;
      for (let i = 0; i < 18; i++) {
        const f = 4200 + Math.sin(i * 1.7) * 900 + rand(-200, 200);
        note(tt, v, f, f * 1.08, 0.035, 0.7);
        tt += 0.045;
      }
    },
  };

  function cuckoo(t) {
    const v = voice(t, rand(-0.8, 0.8), 0.05, 0.6);
    v.g.gain.value = v.peak;
    note(t, v, 760, 740, 0.28, 1);
    note(t + 0.42, v, 620, 600, 0.42, 0.9);
  }

  function owl(t) {
    const v = voice(t, rand(-0.7, 0.7), 0.07, 0.8);
    v.g.gain.value = v.peak;
    // tawny owl: "hoo … hu-hu-hoooo"
    note(t, v, 420, 395, 0.55, 1);
    note(t + 1.3, v, 400, 390, 0.12, 0.6);
    note(t + 1.5, v, 410, 395, 0.12, 0.6);
    note(t + 1.72, v, 425, 380, 0.85, 1);
  }

  function crickets(t, amount) {
    // a short chirp train from one of three crickets
    const who = Math.floor(Math.random() * 3);
    const f = [4350, 4720, 3980][who];
    const v = voice(t, [-0.6, 0.15, 0.7][who] + rand(-0.1, 0.1), 0.02 * amount, 0.15);
    v.g.gain.value = v.peak;
    const pulses = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pulses; i++) note(t + i * 0.042, v, f, f * 0.995, 0.026, 1);
  }

  // ── mixing by place & time ───────────────────────────────────────────────
  function tick() {
    if (!running || !layers) return;
    const t = ac.currentTime;
    const cam = ctx.camera?.position;
    const night = ctx.env?.night ?? 0;
    const day = 1 - night;
    const L = layers;
    const set = (param, v, tc = 0.6) => param.setTargetAtTime(v, t, tc);
    // distance cues
    let brook = 0.2, fall = 0.1, pond = 0;
    if (cam) {
      const sd = Math.max(0, getStreamDistance(cam.x, cam.z) - STREAM.halfWidth);
      const height = Math.max(0, cam.y - 2);
      brook = clamp01(1.15 - (sd + height * 0.6) / 18);
      const fd = Math.hypot(cam.x - STREAM.falls.x, cam.z - STREAM.falls.z) + height * 0.4;
      fall = clamp01(1.1 - fd / 34);
      pond = clamp01(1 - Math.hypot(cam.x - STREAM.pond.x, cam.z - STREAM.pond.z) / 16);
    }
    // leaves gust slowly
    const gust = 0.5 + 0.5 * Math.sin(t * 0.21) * Math.sin(t * 0.077 + 1.3);
    set(L.leaves.g.gain, (0.016 + 0.034 * gust) * (0.45 + 0.55 * day));
    set(L.room.g.gain, 0.045);
    // the stream: a low rush (its centre wanders a little) and bubbles, many
    // and close together beside the water, a few drifting over from afar
    const water = Math.min(1, brook * brook + 0.4 * pond);
    L.brook.f.frequency.setTargetAtTime(rand(560, 900), t, 0.3);
    set(L.brook.g.gain, 0.008 + 0.05 * water, 0.5);
    // bubbles: ~1/s far off, ~40/s beside the water, at random (Poisson)
    // times scheduled ahead on the audio clock up to a horizon, so a busy main
    // thread (a polaroid being developed) leaves no gap in the babble. Each
    // tick fills from where the last one stopped to its own horizon at the
    // current rate (gaps are memoryless, so restarting at the horizon stays
    // Poisson, and a new rate is heard within one look-ahead). Only while the
    // clock runs: a hidden tab suspends it, and bubbles queued at a frozen
    // time would all burst out together when the visitor returns; after a
    // pause the cursor skips the past instead of catching up.
    if (ac.state === 'running') {
      const rate = 1 + 40 * water;
      const end = t + BUBBLE_AHEAD;
      for (let tb = Math.max(nextBubble, t); ; ) {
        tb += -Math.log(1 - Math.random()) / rate;
        if (tb >= end) break;
        bubble(tb, rand(0.006, 0.02) * (0.25 + 0.75 * water));
      }
      nextBubble = end;
    }
    set(L.fallLo.g.gain, 0.02 + 0.06 * fall * fall, 0.8);
    // one bed a tick wanders its speed (each about every half second); both of
    // its reads get the same change, so they stay half a buffer apart
    const b = pick(beds), speed = rand(0.97, 1.03);
    for (const r of b.reads) r.playbackRate.setTargetAtTime(speed, t, 1.5);

    // scheduled voices
    if (day > 0.3 && t > nextBird) {
      const kind = pick(['robin', 'robin', 'tit', 'finch', 'warble']);
      const v = voice(t, rand(-0.85, 0.85), rand(0.02, 0.045) * day);
      v.g.gain.value = v.peak;
      BIRDS[kind](t + 0.05, v);
      nextBird = t + rand(1.6, 5.5) / (0.6 + day * 0.6);
    }
    if (day > 0.6 && t > nextCuckoo) {
      if (nextCuckoo > 0) cuckoo(t + 0.05);
      nextCuckoo = t + rand(28, 60);
    }
    if (night > 0.4 && t > nextCricket) {
      crickets(t + 0.02, night);
      nextCricket = t + rand(0.18, 0.6);
    }
    if (night > 0.6 && t > nextOwl) {
      if (nextOwl > 0) owl(t + 0.05);
      nextOwl = t + rand(16, 34);
    }
  }

  let timer = 0;
  return {
    start() {
      if (running) return;
      running = true;
      if (!layers) build();
      const t = ac.currentTime;
      nextBird = t + 1.2;
      nextCuckoo = t + rand(8, 20);
      nextOwl = t + rand(4, 10);
      bus.gain.cancelScheduledValues(t);
      bus.gain.setTargetAtTime(1, t, 1.2);
      timer = setInterval(tick, TICK * 1000);
      tick();
    },
    stop() {
      if (!running) return;
      running = false;
      clearInterval(timer);
      bus.gain.setTargetAtTime(0, ac.currentTime, 0.3);
    },
    tick,
  };
}
