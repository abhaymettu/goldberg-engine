import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLevel, simulate, LevelError } from "../src/index.js";
import { example, level } from "./helpers.js";

test("the shipped example levels are valid", () => {
  for (const n of ["ring-the-bell-easy", "tune-four-notes"]) assert.equal(validateLevel(example(n)).ok, true, n);
});

test("defaults are filled in", () => {
  const v = validateLevel(level([{ id: "b", type: "ball", x: 1, y: 2 }, { id: "m", type: "marble", x: 3, y: 2 }]));
  assert.equal(v.ok, true);
  assert.equal(v.level.world.dt, 1 / 240);
  assert.equal(v.level.world.gravity, 9.8);
  assert.equal(v.level.parts[0].radius, 0.25);
  assert.equal(v.level.parts[1].radius, 0.1);
});

test("garbage input returns errors and never throws", () => {
  for (const bad of [null, undefined, 3, "x", [], {}, { schema: "goldberg-level/1", parts: [] }, { schema: "goldberg-level/1", parts: [null, 7] }]) {
    const v = validateLevel(bad);
    assert.equal(v.ok, false, JSON.stringify(bad));
    assert.ok(v.errors.length > 0);
  }
});

test("each kind of mistake gets a specific error", () => {
  const cases = [
    [{ ...level([{ id: "b", type: "ball", x: 1, y: 1 }]), schema: "goldberg-level/2" }, /schema: expected "goldberg-level\/1"/],
    [level([{ id: "b", type: "ball", y: 1 }]), /\.x: required/],
    [level([{ id: "b", type: "rocket" }]), /unknown part type "rocket"/],
    [level([{ id: "b", type: "ball", x: 1, y: 1, colour: "red" }]), /unknown field\(s\) colour/],
    [level([{ id: "b", type: "ball", x: 1, y: 1 }, { id: "b", type: "ball", x: 2, y: 1 }]), /duplicate id "b"/],
    [level([{ id: "1st", type: "ball", x: 1, y: 1 }]), /\.id: expected a name/],
    [level([{ id: "b", type: "ball", x: "1", y: 1 }]), /\.x: expected a number/],
    [level([{ id: "b", type: "ball", x: 1, y: 1, radius: 0 }]), /radius: 0 is below the minimum/],
    [level([{ id: "bar", type: "bar", x: 1, y: 1, pitch: "H2" }]), /is not a pitch/],
    [level([{ id: "r", type: "ramp", from: [0, 1] }]), /\.to: required/],
    [level([{ id: "r", type: "ramp", from: [0, 1], to: [1] }]), /\.to: expected \[x, y\]/],
    [level([{ id: "h", type: "hopper", x: 1, y: 1, gate: [{ open: 2, close: 1 }] }]), /close: must be after open/],
    [level([{ id: "l", type: "lever", x: 1, y: 1, limits: [30, -30] }]), /limits: expected \[min, max\]/],
    [level([{ id: "b", type: "ball", x: 1, y: 1 }], { dt: 1 }), /world\.dt: 1 is above the maximum/],
    [level([{ id: "b", type: "ball", x: 1, y: 1 }], {}, { goal: { event: "bell-rung", part: "nope" } }), /goal\.part: no part with id "nope"/],
    [level([{ id: "b", type: "ball", x: 1, y: 1 }], {}, { goal: {} }), /goal\.event: required/],
  ];
  for (const [lvl, re] of cases) {
    const v = validateLevel(lvl);
    assert.equal(v.ok, false, String(re));
    assert.ok(v.errors.some((e) => re.test(e)), `${re} not in ${JSON.stringify(v.errors)}`);
  }
});

test("pitch accepts names, sharps, flats and MIDI numbers", () => {
  for (const pitch of ["C5", "F#4", "Bb3", 60, "c4"]) assert.equal(validateLevel(level([{ id: "bar", type: "bar", x: 1, y: 1, pitch }])).ok, true, String(pitch));
  for (const pitch of [128, -1, 60.5, "C", "C#", "Cb-2"]) assert.equal(validateLevel(level([{ id: "bar", type: "bar", x: 1, y: 1, pitch }])).ok, false, String(pitch));
});

test("simulate refuses an invalid level with every error listed", () => {
  assert.throws(() => simulate(level([{ id: "b", type: "ball" }])), (e) => e instanceof LevelError && e.errors.length === 2);
});
