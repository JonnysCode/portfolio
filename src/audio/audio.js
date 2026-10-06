// ─────────────────────────────────────────────────────────────────────────────
// Audio — tiny synthesized sound effects via WebAudio (no audio files).
// Muted until the visitor interacts (browser autoplay rules) and toggleable.
// BASELINE: the UI/audio builder adds ambience, the PostAuto horn, etc.
//
//   ctx.audio.play('click' | 'open' | 'close' | 'horn' | 'pop' | 'step' | 'chirp' | 'whoosh')
//   ctx.audio.enabled / ctx.audio.setEnabled(bool) / ctx.audio.unlock()
//   ctx.audio.playMusic('record') / ctx.audio.stopMusic()   (record player tune)
//   ctx.audio.startAmbience()                                (birds by day, crickets by night)
// ─────────────────────────────────────────────────────────────────────────────
export function createAudio() {
  let ac = null;
  let master = null;
  const audio = {
    enabled: false,
    unlock() {
      if (ac) return;
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain();
        master.gain.value = 0.5;
        master.connect(ac.destination);
      } catch {
        ac = null;
      }
    },
    setEnabled(on) {
      audio.enabled = on;
      if (on) audio.unlock();
      if (ac) ac[on ? 'resume' : 'suspend']?.();
    },
    playMusic() {},
    stopMusic() {},
    startAmbience() {},
    play(name) {
      if (!audio.enabled || !ac) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.connect(g).connect(master);
      const f = { click: 660, pop: 520, open: 440, close: 330, horn: 554, chirp: 1800, whoosh: 200, step: 120 }[name] ?? 440;
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.start(t);
      o.stop(t + 0.2);
    },
  };
  return audio;
}
