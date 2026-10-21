export { simulate, LevelError } from "./simulate.js";
export { validateLevel, PART_SPECS, WORLD_SPEC, GOAL_SPEC } from "./schema.js";
export { parsePitch } from "./pitch.js";
export { makeRng } from "./rng.js";
export { buildReel } from "./reel.js";

/** Note onsets from a trace, in time order: what The Tune Machine scores against its tune. */
export function onsets(trace) {
  return trace.events.filter((e) => e.type === "bar-hit").map((e) => ({ t: e.t, step: e.step, bar: e.part, by: e.by, pitch: e.pitch, midi: e.midi, freq: e.freq, speed: e.speed }));
}
