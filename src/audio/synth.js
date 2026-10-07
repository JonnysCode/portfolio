// ─────────────────────────────────────────────────────────────────────────────
// Little WebAudio building blocks shared by the ambience, sound effects and
// the music box: noise buffers, a generated forest reverb, envelopes.
// ─────────────────────────────────────────────────────────────────────────────

/** Seconds of white / pink / brown noise in a (cached) mono buffer. */
export function noiseBuffer(ac, kind = 'white', seconds = 2) {
  const key = `__noise_${kind}_${seconds}`;
  if (ac[key]) return ac[key];
  const n = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'pink') {
      // Paul Kellet's economy pink filter
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  // fade the loop seam
  const f = Math.min(2000, n >> 3);
  for (let i = 0; i < f; i++) {
    const k = i / f;
    d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k;
  }
  ac[key] = buf;
  return buf;
}

/** A looping noise source (started). */
export function noiseSource(ac, kind = 'white', seconds = 2) {
  const s = ac.createBufferSource();
  s.buffer = noiseBuffer(ac, kind, seconds);
  s.loop = true;
  s.loopStart = Math.random() * seconds * 0.5;
  s.start(0, Math.random() * seconds);
  return s;
}

/** A soft, woody forest reverb (generated impulse response). */
export function makeReverb(ac, seconds = 2.4, decay = 3.2) {
  const n = Math.floor(ac.sampleRate * seconds);
  const ir = ac.createBuffer(2, n, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      // darker as it decays (forest absorbs highs), a few early reflections off trunks
      const k = 0.35 + 0.6 * t;
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * Math.pow(1 - t, decay) * (i < ac.sampleRate * 0.06 && i % 997 < 6 ? 2.5 : 1);
    }
  }
  const conv = ac.createConvolver();
  conv.buffer = ir;
  return conv;
}

/** Attack / exponential decay on a gain param. */
export function envelope(param, t, { peak = 1, attack = 0.005, decay = 0.3, hold = 0 } = {}) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + attack);
  if (hold) param.setValueAtTime(peak, t + attack + hold);
  param.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
}

export const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
