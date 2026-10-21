// Each part does what its doc says, checked from the trace and the final replay frame.
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../src/index.js";
import { level, DEG } from "./helpers.js";

// Final [x, y, angle] of a dynamic body from the replay.
function finalPose(replay, id) {
  const i = replay.frameBodies.indexOf(id);
  assert.ok(i >= 0, `no dynamic body ${id}`);
  const f = replay.frames.at(-1);
  return { x: f[i * 3], y: f[i * 3 + 1], angle: f[i * 3 + 2] };
}

test("floor with no endpoints spans the board; a ball comes to rest on it at y = radius", () => {
  const { trace } = simulate(level([{ id: "floor", type: "floor" }, { id: "b", type: "ball", x: 17, y: 2 }]));
  const r = trace.rest[0];
  assert.ok(Math.abs(r.y - 0.25) < 0.02, `y ${r.y}`);
  assert.notEqual(r.restedAt, null);
  assert.deepEqual(r.touching, ["floor"]);
});

test("ramp: a ball rolls downhill along it and leaves the low end", () => {
  const { trace } = simulate(level([{ id: "floor", type: "floor" }, { id: "r", type: "ramp", from: [1, 4], to: [6, 1] }, { id: "b", type: "ball", x: 1.5, y: 4.2 }], { duration: 5 }));
  assert.ok(trace.events.some((e) => e.type === "contact" && [e.a, e.b].includes("r")), "touched the ramp");
  assert.ok(trace.rest[0].x > 6, `ended at x ${trace.rest[0].x}`);
});

test("domino: stands when untouched, topples when hit, and passes the hit down a line", () => {
  const still = simulate(level([{ id: "floor", type: "floor" }, { id: "d", type: "domino", x: 5, y: 0 }]));
  assert.ok(Math.abs(finalPose(still.replay, "d").angle) < 0.01, "untouched domino stays up");

  const parts = [{ id: "floor", type: "floor" }, { id: "b", type: "ball", x: 2, y: 0.25, vx: 3 }];
  for (let i = 0; i < 5; i++) parts.push({ id: `d${i}`, type: "domino", x: 3 + i * 0.35, y: 0 });
  const { trace, replay } = simulate(level(parts));
  for (let i = 0; i < 5; i++) assert.ok(Math.abs(finalPose(replay, `d${i}`).angle) * DEG > 45, `d${i} fell`);
  for (let i = 0; i < 4; i++) assert.ok(trace.events.some((e) => e.type === "contact" && [e.a, e.b].sort().join() === [`d${i}`, `d${i + 1}`].sort().join()), `d${i} hit d${i + 1}`);
});

test("lever: weight on the left end tips it counterclockwise, within its limits", () => {
  const parts = [{ id: "floor", type: "floor" }, { id: "l", type: "lever", x: 5, y: 2, length: 3, limits: [-20, 20] }, { id: "b", type: "ball", x: 3.9, y: 4, density: 4 }];
  const { trace, replay } = simulate(level(parts));
  const a = finalPose(replay, "l").angle * DEG;
  assert.ok(a > 15 && a < 20.5, `angle ${a}`);
  assert.ok(trace.events.some((e) => e.type === "contact" && [e.a, e.b].includes("l")));
  const pivot = replay.bodies.find((b) => b.id === "l").pivot;
  const f = finalPose(replay, "l");
  assert.ok(Math.hypot(f.x - pivot[0], f.y - pivot[1]) < 0.01, "the plank stays on its pivot");
});

test("bell: a hit rings it, a gentle touch does not", () => {
  const hard = simulate(level([{ id: "bell", type: "bell", x: 5, y: 1 }, { id: "b", type: "ball", x: 5, y: 4 }]), { frames: false }).trace;
  assert.ok(hard.events.some((e) => e.type === "bell-rung" && e.part === "bell" && e.by === "b"));
  // Ball placed 2 mm above the bell top (y = 1.35): arrives at about 0.2 m/s, under minSpeed 0.3.
  const soft = simulate(level([{ id: "bell", type: "bell", x: 5, y: 1 }, { id: "b", type: "ball", x: 5, y: 1.35 + 0.25 + 0.002 }]), { frames: false }).trace;
  assert.ok(soft.events.length === 0 || soft.events.every((e) => e.type !== "bell-rung"), JSON.stringify(soft.events));
});

test("bar: a marble strike fires bar-hit with the bar's pitch, name, MIDI number and frequency", () => {
  const { trace } = simulate(level([{ id: "bar", type: "bar", x: 5, y: 2, pitch: "A4", angle: -15 }, { id: "m", type: "marble", x: 5, y: 4 }]), { frames: false });
  const hits = trace.events.filter((e) => e.type === "bar-hit");
  assert.ok(hits.length >= 1);
  assert.deepEqual({ part: hits[0].part, by: hits[0].by, pitch: hits[0].pitch, midi: hits[0].midi, freq: hits[0].freq }, { part: "bar", by: "m", pitch: "A4", midi: 69, freq: 440 });
});

test("hopper: holds its marbles until the gate opens, releases them, and logs the gate times exactly", () => {
  const parts = [{ id: "floor", type: "floor" }, { id: "h", type: "hopper", x: 5, y: 6, marbles: 3, gate: [{ open: 1.0, close: 2.0 }] }];
  const { trace, replay } = simulate(level(parts));
  const gate = trace.events.filter((e) => e.type.startsWith("gate"));
  assert.deepEqual(gate.map((e) => [e.type, e.t, e.step]), [["gate-open", 1, 240], ["gate-close", 2, 480]]);
  // Just before opening, every marble is still above the gate.
  const before = replay.frames[Math.floor(239 / replay.frameEvery)];
  for (const id of ["h.m0", "h.m1", "h.m2"]) {
    const i = replay.frameBodies.indexOf(id);
    assert.ok(before[i * 3 + 1] > 6, `${id} inside before open`);
  }
  // At the end all three are out of the hopper, in a small pile on the floor.
  for (const r of trace.rest) assert.ok(r.y < 0.5, `${r.part} at y ${r.y}`);
});

test("hopper: a gate that never opens keeps its marbles", () => {
  const { trace } = simulate(level([{ id: "floor", type: "floor" }, { id: "h", type: "hopper", x: 5, y: 6, marbles: 2 }]), { frames: false });
  assert.ok(trace.rest.every((r) => r.y > 6), JSON.stringify(trace.rest));
  assert.ok(!trace.events.some((e) => e.type === "gate-open"));
});

test("out of bounds: a ball that leaves the board is reported once", () => {
  const { trace } = simulate(level([{ id: "b", type: "ball", x: 1, y: 1, vx: -5 }]), { frames: false });
  const oob = trace.events.filter((e) => e.type === "out-of-bounds");
  assert.equal(oob.length, 1);
  assert.equal(trace.rest[0].outOfBounds, true);
});
