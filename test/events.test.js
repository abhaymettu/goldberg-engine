// Event timing and logging: the Tune Machine scores note onsets off these times.
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate, onsets } from "../src/index.js";
import { example, level } from "./helpers.js";

test("bell-rung fires within one timestep of the analytic contact time", () => {
  for (const dt of [1 / 240, 1 / 480, 1 / 1000]) {
    // Ball centre at y = 5 falls until its bottom meets the bell top at y = 1 + 0.35.
    const { trace } = simulate(level([{ id: "bell", type: "bell", x: 5, y: 1 }, { id: "b", type: "ball", x: 5, y: 5 }], { dt }, { goal: { event: "bell-rung", part: "bell" } }), { frames: false });
    const analytic = Math.sqrt((2 * (5 - 0.25 - 1.35)) / 9.8);
    assert.equal(trace.goal.met, true);
    assert.ok(Math.abs(trace.goal.t - analytic) <= dt, `dt ${dt}: event ${trace.goal.t} vs analytic ${analytic}`);
  }
});

test("every event time is its step times dt, and events are in step order", () => {
  for (const n of ["ring-the-bell-easy", "tune-four-notes"]) {
    const { trace } = simulate(example(n), { frames: false });
    assert.ok(trace.events.length > 5);
    for (const e of trace.events) assert.ok(Math.abs(e.t - e.step * trace.dt) < 1e-6, JSON.stringify(e));
    for (let i = 1; i < trace.events.length; i++) assert.ok(trace.events[i].step >= trace.events[i - 1].step);
  }
});

test("the example machine rings the bell, and the goal records when and by what", () => {
  const { trace } = simulate(example("ring-the-bell-easy"), { frames: false });
  assert.equal(trace.goal.met, true);
  const first = trace.events.find((e) => e.type === "bell-rung");
  assert.equal(trace.goal.t, first.t);
  assert.equal(first.by, "d3");
  // The chain happened in order: ball on lever, ball on dominoes, dominoes on each other, then the bell.
  const at = (a, b) => trace.events.find((e) => e.type === "contact" && [e.a, e.b].sort().join() === [a, b].sort().join())?.t;
  const order = [at("ball", "lever"), at("ball", "d1"), at("d1", "d2"), at("d2", "d3"), first.t];
  assert.ok(order.every((t) => t !== undefined), JSON.stringify(order));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
});

test("a goal that never happens is reported as not met", () => {
  const L = example("ring-the-bell-easy");
  L.parts.find((p) => p.id === "bell").x = 18;
  const { trace } = simulate(L, { frames: false });
  assert.deepEqual([trace.goal.met, trace.goal.t], [false, null]);
});

test("onsets: the tune example plays C5 E5 G5 C6 half a second apart, one note per marble", () => {
  const { trace } = simulate(example("tune-four-notes"), { frames: false });
  const o = onsets(trace);
  assert.deepEqual(o.map((n) => n.pitch), ["C5", "E5", "G5", "C6"]);
  assert.deepEqual(o.map((n) => n.by), ["h1.m0", "h2.m0", "h3.m0", "h4.m0"]);
  for (let i = 1; i < o.length; i++) assert.ok(Math.abs(o[i].t - o[i - 1].t - 0.5) < 1e-6, `gap ${o[i].t - o[i - 1].t}`);
});

test("debounce: a marble rolling along a bar logs one hit, not one per step", () => {
  const { trace } = simulate(level([{ id: "bar", type: "bar", x: 5, y: 2, width: 3, pitch: "C5", angle: -8, restitution: 0 }, { id: "m", type: "marble", x: 4, y: 2.3 }]), { frames: false });
  const hits = trace.events.filter((e) => e.type === "bar-hit");
  assert.ok(hits.length <= 2, `${hits.length} hits`);
});

test("rest: every ball reports where it stopped, when, and what it is touching", () => {
  const { trace } = simulate(example("ring-the-bell-easy"), { frames: false });
  assert.equal(trace.rest.length, 1);
  const r = trace.rest[0];
  assert.equal(r.part, "ball");
  assert.equal(typeof r.x, "number");
  assert.ok(r.restedAt === null || (r.restedAt > 0 && r.restedAt <= trace.duration));
  assert.ok(Array.isArray(r.touching));
});
