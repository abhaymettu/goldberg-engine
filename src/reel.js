import { simulate } from "./simulate.js";

/**
 * A reel is several attempts at one goal, played as a single clip: failed attempts as
 * fast ghosts, then the winner at real speed. Each attempt keeps its full replay, so
 * what the renderer shows is exactly what was simulated.
 *
 * @param {{ level: object, note?: string, seed?: number }[]} attempts
 * @param {{ title?: string }} [opts]
 */
export function buildReel(attempts, { title } = {}) {
  if (!attempts.length) throw new Error("buildReel: no attempts");
  const runs = attempts.map((a, i) => {
    const { replay } = simulate(a.level, { seed: a.seed ?? 1 });
    return { index: i + 1, note: a.note ?? "", met: replay.trace.goal?.met ?? false, replay };
  });
  const winner = runs.findIndex((r) => r.met);
  return {
    schema: "goldberg-reel/1",
    title: title ?? runs[0].replay.level.name,
    goal: runs[0].replay.level.goal ?? null,
    winner: winner === -1 ? null : winner,
    attempts: runs,
  };
}
