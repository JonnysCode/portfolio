// ─────────────────────────────────────────────────────────────────────────────
// Audio — everything synthesized with WebAudio (no audio files): the glen's
// ambience (ambience.js), sound effects (sfx.js) and the record player's
// music box (music.js). Silent until the visitor enters the woodland (browser
// autoplay rules); the sound button's choice is remembered.
//
//   ctx.audio.play('click' | 'pop' | 'twinkle' | 'page' | 'open' | 'close' | 'whoosh'
//                  | 'chime' | 'horn' | 'chirp' | 'step')
//   ctx.audio.enabled / ctx.audio.setEnabled(bool, { remember }) / ctx.audio.unlock()
//   ctx.audio.preference          the remembered choice (default true)
//   ctx.audio.onChange(fn(enabled)) → unsubscribe
//   ctx.audio.playMusic('record') / ctx.audio.stopMusic()   (record player tune)
//   ctx.audio.musicPlaying
//   ctx.audio.startAmbience() / stopAmbience()               (birds by day, crickets by night …)
// ─────────────────────────────────────────────────────────────────────────────
import { makeReverb, prepareNoise } from './synth.js';
import { createSfx, SFX_NOISE } from './sfx.js';
import { createAmbience, AMBIENCE_NOISE } from './ambience.js';
import { createMusic } from './music.js';

const PREF_KEY = 'woodland:sound';
/** Bus levels — measure with `node scripts/audio-tour.mjs` after changing them (they include the limiter's makeup gain, see build()). */
const BUS = { sfx: 0.45, ambience: 0.56, music: 0.27 };

export function createAudio(ctx = {}) {
  let ac = null;
  let master = null;
  let sfx = null;
  let ambience = null;
  let music = null;
  let wantMusic = false;
  const listeners = new Set();
  let pref = null;
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw === '1' || raw === '0') pref = raw === '1';
  } catch {
    /* private mode */
  }
  // the sound starts inside the visitor's first click: generate its noise now,
  // while the loading screen is up, so that click only has to copy it
  if (pref !== false) prepareNoise([...AMBIENCE_NOISE, ...SFX_NOISE]);

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC({ latencyHint: 'interactive' });
    // master → safety limiter → speakers. The mix sits well below it (the
    // glen's bed around −39 LUFS, the loudest events around −29): a visitor
    // listens with the volume set for everything else on their computer.
    // DynamicsCompressorNode adds its own makeup gain, (1/curve(0 dBFS))^0.6 —
    // about +4.4 dB with these settings, on everything — so changing
    // threshold/knee/ratio moves the whole mix: re-measure after.
    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -9;
    limiter.knee.value = 3;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    master = ac.createGain();
    master.gain.value = 0;
    master.connect(limiter).connect(ac.destination);
    const reverb = makeReverb(ac);
    const rv = ac.createGain();
    rv.gain.value = 0.3;
    reverb.connect(rv).connect(master);
    const sfxBus = ac.createGain();
    sfxBus.gain.value = BUS.sfx;
    sfxBus.connect(master);
    const ambBus = ac.createGain();
    ambBus.gain.value = BUS.ambience;
    ambBus.connect(master);
    const musicBus = ac.createGain();
    musicBus.gain.value = BUS.music;
    musicBus.connect(master);
    sfx = createSfx(ac, { out: sfxBus, reverb });
    ambience = createAmbience(ac, { out: ambBus, reverb, ctx });
    music = createMusic(ac, { out: musicBus, reverb, ctx });
  }

  // a hidden tab goes quiet: fade out and suspend the context (timers are
  // throttled in the background anyway); fade back in when the visitor returns
  let hiddenTimer = 0;
  document.addEventListener('visibilitychange', () => {
    if (!ac || !master) return;
    const t = ac.currentTime;
    clearTimeout(hiddenTimer);
    if (document.hidden) {
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(0, t, 0.08);
      hiddenTimer = setTimeout(() => document.hidden && ac.suspend?.(), 400);
    } else if (audio.enabled) {
      Promise.resolve(ac.resume?.()).then(() => {
        const t1 = ac.currentTime;
        master.gain.cancelScheduledValues(t1);
        master.gain.setValueAtTime(master.gain.value, t1);
        master.gain.setTargetAtTime(1, t1, 0.5);
      }, () => {});
    }
  });

  const audio = {
    enabled: false,
    get preference() {
      return pref ?? true;
    },
    get musicPlaying() {
      return wantMusic;
    },
    /** Create the AudioContext (must happen inside a user gesture). */
    unlock() {
      if (ac) {
        if (audio.enabled && ac.state === 'suspended') ac.resume?.();
        return;
      }
      try {
        build();
      } catch (err) {
        console.warn('[audio] WebAudio unavailable', err);
        ac = null;
      }
    },
    setEnabled(on, { remember = false } = {}) {
      on = !!on;
      if (remember) {
        pref = on;
        try {
          localStorage.setItem(PREF_KEY, on ? '1' : '0');
        } catch {
          /* ignore */
        }
      }
      if (on) audio.unlock();
      if (!ac) {
        audio.enabled = false;
        for (const fn of listeners) fn(false);
        return;
      }
      audio.enabled = on;
      const t = ac.currentTime;
      if (on) {
        if (!document.hidden) ac.resume?.();
        master.gain.cancelScheduledValues(t);
        master.gain.setTargetAtTime(1, t, 0.8); // the forest fades in, it doesn't switch on
        ambience.start();
        if (wantMusic) music.play();
      } else {
        master.gain.cancelScheduledValues(t);
        master.gain.setTargetAtTime(0, t, 0.15);
        setTimeout(() => {
          if (!audio.enabled) {
            ambience.stop();
            music.stop();
            ac.suspend?.();
          }
        }, 700);
      }
      for (const fn of listeners) fn(on);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    play(name, opts) {
      if (!audio.enabled || !ac || !sfx) return;
      try {
        sfx(name, opts);
      } catch {
        /* a missing node type on an old browser must never break a click */
      }
    },
    playMusic(id = 'record') {
      wantMusic = id;
      if (audio.enabled && music) music.play(id);
    },
    stopMusic() {
      wantMusic = false;
      music?.stop();
    },
    startAmbience() {
      if (audio.enabled) ambience?.start();
    },
    stopAmbience() {
      ambience?.stop();
    },
  };
  return audio;
}
