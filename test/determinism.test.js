import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { simulate } from "../src/index.js";
import { example } from "./helpers.js";

const hash = (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex");

test("same level and seed give identical traces and replay frames, in one process", () => {
  for (const n of ["ring-the-bell-easy", "tune-four-notes"]) {
    const a = simulate(example(n), { seed: 7 }), b = simulate(example(n), { seed: 7 });
    assert.deepEqual(a.trace, b.trace, n);
    assert.equal(hash(a.replay), hash(b.replay), n);
  }
});

test("identical traces across two separate Node processes", () => {
  const script = `import { simulate } from "./src/index.js"; import { readFileSync } from "node:fs";
    import { createHash } from "node:crypto";
    const L = JSON.parse(readFileSync("examples/levels/ring-the-bell-easy.json", "utf8"));
    process.stdout.write(createHash("sha256").update(JSON.stringify(simulate(L, { seed: 3 }).replay)).digest("hex"));`;
  const run = () => execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  const h1 = run(), h2 = run();
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(h1, h2);
  assert.equal(h1, hash(simulate(example("ring-the-bell-easy"), { seed: 3 }).replay), "and the same as this process");
});

test("with jitter on, the seed changes the run, and the same seed repeats it", () => {
  const L = example("ring-the-bell-easy");
  L.world.jitter = 0.02;
  const s1 = simulate(L, { seed: 1, frames: false }).trace, s1b = simulate(L, { seed: 1, frames: false }).trace, s2 = simulate(L, { seed: 2, frames: false }).trace;
  assert.deepEqual(s1, s1b);
  assert.notDeepEqual(s1.events, s2.events);
});

test("with jitter off, the seed has no effect", () => {
  const a = simulate(example("tune-four-notes"), { seed: 1, frames: false }).trace;
  const b = simulate(example("tune-four-notes"), { seed: 99, frames: false }).trace;
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.rest, b.rest);
});
