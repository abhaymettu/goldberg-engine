import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("sim --out writes into a directory that does not exist yet", () => {
  const out = join(mkdtempSync(join(tmpdir(), "gb-sim-")), "fresh", "nested", "replay.json");
  const p = spawnSync(process.execPath, ["bin/sim.js", "examples/levels/ring-the-bell-easy.json", "--out", out], { cwd: root, encoding: "utf8" });
  assert.equal(p.status, 0, p.stderr);
  assert.ok(existsSync(out));
  assert.equal(JSON.parse(readFileSync(out, "utf8")).schema, "goldberg-replay/1");
});

test("vendor/planck/SHA256 covers every vendored file and every hash matches", () => {
  const lines = readFileSync(join(root, "vendor/planck/SHA256"), "utf8").trim().split("\n").map((l) => l.split(/\s+/));
  assert.deepEqual(lines.map(([, f]) => f).sort(), ["vendor/planck/LICENSE.txt", "vendor/planck/planck.d.ts", "vendor/planck/planck.mjs"]);
  for (const [hash, f] of lines) assert.equal(createHash("sha256").update(readFileSync(join(root, f))).digest("hex"), hash, f);
});
