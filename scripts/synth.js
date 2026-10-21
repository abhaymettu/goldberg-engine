// Offline audio for a recorded clip: one sound per bell-rung or bar-hit event the
// simulation logged, so what you hear is exactly what was simulated. Mono 16-bit WAV.
const RATE = 44100;
const BELL = [[523.25, 1], [1046.5, 0.5], [1444.2, 0.35], [2825.6, 0.15]];

export function synthWav(events, seconds) {
  const n = Math.ceil(seconds * RATE), buf = new Float32Array(n);
  for (const e of events) {
    const bell = e.type === "bell-rung";
    const partials = bell ? BELL : [[e.freq, 1], [e.freq * 4, 0.12]];
    const decay = bell ? 1.8 : 0.7, level = Math.min(1, 0.25 + e.speed / 6) * 0.3;
    const start = Math.round(e.time * RATE), len = Math.min(n - start, Math.round(decay * 1.2 * RATE));
    for (let i = 0; i < len; i++) {
      const t = i / RATE, env = level * Math.exp((-t * 6.9) / decay) * Math.min(1, t / 0.002);
      let s = 0;
      for (const [f, a] of partials) s += a * Math.sin(2 * Math.PI * f * t);
      buf[start + i] += env * s;
    }
  }
  const out = Buffer.alloc(44 + n * 2);
  out.write("RIFF", 0); out.writeUInt32LE(36 + n * 2, 4); out.write("WAVE", 8);
  out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(RATE, 24); out.writeUInt32LE(RATE * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) out.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(Math.tanh(buf[i]) * 32767))), 44 + i * 2);
  return out;
}
