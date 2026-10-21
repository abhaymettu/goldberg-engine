import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReel, simulate } from "../src/index.js";
import { buildTimeline, reelFromAny } from "../renderer/player.js";
import { schemaDoc } from "../bin/schema-doc.js";
import { synthWav } from "../scripts/synth.js";
import { example } from "./helpers.js";

const attempt = (n) => JSON.parse(readFileSync(new URL(`../examples/attempts/ring-the-bell/attempt-${n}.json`, import.meta.url), "utf8"));

test("docs/level-schema.md matches the spec table", () => {
  assert.equal(readFileSync(new URL("../docs/level-schema.md", import.meta.url), "utf8"), schemaDoc(), "run node bin/schema-doc.js --write");
});

test("example reel: two failures, then a winner that rings the bell", () => {
  const reel = buildReel([1, 2, 3].map((n) => ({ level: attempt(n) })));
  assert.deepEqual(reel.attempts.map((a) => a.met), [false, false, true]);
  assert.equal(reel.winner, 2);
  const tl = buildTimeline(reel);
  assert.deepEqual(tl.segs.map((s) => s.kind), ["intro", "ghost", "ghost", "winner", "outro"]);
  const win = tl.segs[3];
  assert.equal(win.speed, 1);
  assert.ok(win.frames / 60 > reel.attempts[2].replay.trace.goal.t, "winner segment shows the goal moment");
  for (const g of tl.segs.filter((s) => s.kind === "ghost")) assert.ok(g.speed >= 5);
});

test("a bare replay with no goal plays once at real speed", () => {
  const { replay } = simulateTune();
  const reel = reelFromAny(replay);
  assert.equal(reel.winner, 0);
  const tl = buildTimeline(reel);
  assert.deepEqual(tl.segs.map((s) => s.kind), ["intro", "winner", "outro"]);
});

function simulateTune() { return simulate(example("tune-four-notes")); }

test("synthWav writes a valid mono 16-bit WAV with sound at the event time", () => {
  const wav = synthWav([{ time: 0.5, type: "bar-hit", freq: 440, speed: 2 }], 1);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(24), 44100);
  const sample = (t) => Math.abs(wav.readInt16LE(44 + Math.round(t * 44100) * 2));
  assert.equal(sample(0.49), 0);
  assert.ok(Math.max(...Array.from({ length: 100 }, (_, i) => sample(0.51 + i / 44100))) > 1000);
});
