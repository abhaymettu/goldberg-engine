#!/usr/bin/env node
// goldberg-sim <level.json> [--seed N] [--out replay.json] [--events]
import { readFileSync, writeFileSync } from "node:fs";
import { simulate, LevelError } from "../src/index.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
if (!file) { console.error("usage: goldberg-sim <level.json> [--seed N] [--out replay.json] [--events]"); process.exit(2); }

try {
  const level = JSON.parse(readFileSync(file, "utf8"));
  const out = opt("--out");
  const { trace, replay } = simulate(level, { seed: Number(opt("--seed") ?? 1), frames: Boolean(out) });
  if (out) writeFileSync(out, JSON.stringify(replay));
  const summary = { level: trace.level, seed: trace.seed, goal: trace.goal, counts: trace.counts, rest: trace.rest };
  if (args.includes("--events")) summary.events = trace.events.filter((e) => e.type !== "contact" || args.includes("--contacts"));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(trace.goal && !trace.goal.met ? 1 : 0);
} catch (e) {
  if (e instanceof LevelError) { console.error(e.message); process.exit(3); }
  throw e;
}
