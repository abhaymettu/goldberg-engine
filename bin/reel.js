#!/usr/bin/env node
// goldberg-reel <reel-spec.json> --out out/name.reel.json
// A reel spec lists attempt level files (relative to the spec) with one note each.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildReel } from "../src/index.js";

const [spec, flag, out] = process.argv.slice(2);
if (!spec || flag !== "--out" || !out) { console.error("usage: goldberg-reel <reel-spec.json> --out <file>"); process.exit(2); }
const s = JSON.parse(readFileSync(spec, "utf8"));
const attempts = s.attempts.map((a) => ({ level: JSON.parse(readFileSync(resolve(dirname(spec), a.level), "utf8")), note: a.note, seed: a.seed }));
const reel = buildReel(attempts, { title: s.title });
if (s.goalText) reel.goalText = s.goalText;
if (s.provenance) reel.provenance = s.provenance;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(reel));
console.log(JSON.stringify({ out, attempts: reel.attempts.map((a) => ({ index: a.index, met: a.met, goalT: a.replay.trace.goal?.t ?? null, note: a.note })), winner: reel.winner === null ? null : reel.winner + 1 }, null, 2));
