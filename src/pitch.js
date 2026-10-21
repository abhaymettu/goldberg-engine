const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C5", "F#4", "Bb3" or a MIDI number -> { name, midi, freq }. A4 = MIDI 69 = 440 Hz. */
export function parsePitch(p) {
  let midi;
  if (typeof p === "number" && Number.isInteger(p) && p >= 0 && p <= 127) midi = p;
  else if (typeof p === "string") {
    const m = p.match(/^([A-Ga-g])([#b]?)(-?\d)$/);
    if (!m) return null;
    midi = 12 * (Number(m[3]) + 1) + NAMES[m[1].toUpperCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
    if (midi < 0 || midi > 127) return null;
  } else return null;
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return { name: `${names[midi % 12]}${Math.floor(midi / 12) - 1}`, midi, freq: 440 * 2 ** ((midi - 69) / 12) };
}
