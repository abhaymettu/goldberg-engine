import { parsePitch } from "./pitch.js";

// One table drives validation, defaults and docs/level-schema.md (bin/schema-doc.js).
// Units: metres, seconds, degrees for angles. y points up. Origin bottom-left of the board.

const num = (doc, dflt, extra = {}) => ({ kind: "number", doc, default: dflt, ...extra });
const req = (spec) => ({ ...spec, required: true, default: undefined });
const point = (doc) => ({ kind: "point", doc, required: true });

const ballFields = (radius, restitution) => ({
  x: req(num("Centre x")), y: req(num("Centre y")),
  radius: num("Radius", radius, { min: 0.01, max: 2 }),
  density: num("Density (kg/m^2)", 1, { min: 0.01 }),
  friction: num("Friction", 0.3, { min: 0, max: 2 }),
  restitution: num("Bounciness, 0 to 1", restitution, { min: 0, max: 1 }),
  vx: num("Initial x velocity", 0), vy: num("Initial y velocity", 0),
});

export const WORLD_SPEC = {
  width: num("Board width; renderer viewport and out-of-bounds box", 20, { min: 1, max: 200 }),
  height: num("Board height", 12, { min: 1, max: 200 }),
  gravity: num("Gravity along -y (m/s^2)", 9.8, { min: 0, max: 100 }),
  dt: num("Fixed timestep (s). Event times are exact multiples of this", 1 / 240, { min: 1 / 2000, max: 1 / 30 }),
  duration: num("Simulated time (s)", 10, { min: 0.1, max: 120 }),
  velocityIterations: { kind: "int", doc: "Solver velocity iterations", default: 8, min: 1, max: 100 },
  positionIterations: { kind: "int", doc: "Solver position iterations", default: 3, min: 1, max: 100 },
  frameEvery: { kind: "int", doc: "Record a replay frame every N steps (4 at 1/240 s = 60 fps)", default: 4, min: 1, max: 1000 },
  debounce: num("Ignore a repeat contact between the same two parts within this many seconds", 0.05, { min: 0, max: 5 }),
  restSpeed: num("A ball moving slower than this (m/s) counts as resting", 0.02, { min: 0 }),
  contactMinSpeed: num("Raw 'contact' events are logged only when the approach speed (m/s) is at least this, so resting stacks do not flood the trace", 0.05, { min: 0 }),
  jitter: num("Max random nudge (m) added to every dynamic part's position, drawn from the seed. 0 = none", 0, { min: 0, max: 1 }),
};

export const PART_SPECS = {
  ball: { doc: "Dynamic circle.", fields: ballFields(0.25, 0.2) },
  marble: { doc: "A small, fast ball. Uses continuous collision so it does not tunnel through thin bars.", fields: ballFields(0.1, 0.3) },
  floor: {
    doc: "Static ground segment. With no from/to it spans the whole board at y = 0.",
    fields: { from: { kind: "point", doc: "Start [x, y]" }, to: { kind: "point", doc: "End [x, y]" }, thickness: num("Thickness", 0.2, { min: 0.01 }), friction: num("Friction", 0.6, { min: 0 }) },
  },
  ramp: {
    doc: "Static plank from one point to another. Its top surface is the line from -> to.",
    fields: { from: point("Start [x, y]"), to: point("End [x, y]"), thickness: num("Thickness", 0.1, { min: 0.01 }), friction: num("Friction", 0.2, { min: 0 }), restitution: num("Bounciness", 0.1, { min: 0, max: 1 }) },
  },
  domino: {
    doc: "Dynamic upright block standing on (x, y). Topples when hit.",
    fields: { x: req(num("Centre x of the base")), y: req(num("y of the base (bottom edge)")), width: num("Width", 0.1, { min: 0.01 }), height: num("Height", 0.5, { min: 0.01 }), angle: num("Tilt in degrees, counterclockwise", 0), density: num("Density", 2, { min: 0.01 }), friction: num("Friction", 0.5, { min: 0 }) },
  },
  lever: {
    doc: "Dynamic plank on a fixed pivot (a seesaw). The plank turns freely around (x, y) unless limits are given.",
    fields: {
      x: req(num("Pivot x")), y: req(num("Pivot y")),
      length: num("Plank length", 2, { min: 0.05 }), thickness: num("Plank thickness", 0.1, { min: 0.01 }),
      angle: num("Starting angle in degrees, counterclockwise", 0),
      pivotAt: num("Where the pivot sits along the plank, 0 = left end, 1 = right end", 0.5, { min: 0, max: 1 }),
      density: num("Density", 1, { min: 0.01 }), friction: num("Friction", 0.4, { min: 0 }),
      limits: { kind: "range", doc: "Optional [minDeg, maxDeg] the plank may turn to" },
    },
  },
  bell: {
    doc: "Static bell. Any part hitting it faster than minSpeed fires a 'bell-rung' event.",
    fields: { x: req(num("Centre x")), y: req(num("Centre y")), width: num("Width at the mouth", 0.6, { min: 0.05 }), height: num("Height", 0.7, { min: 0.05 }), minSpeed: num("Slowest approach speed (m/s) that rings it", 0.3, { min: 0 }) },
  },
  bar: {
    doc: "Static xylophone bar with a pitch. A hit faster than minSpeed fires a 'bar-hit' event with the pitch.",
    fields: { x: req(num("Centre x")), y: req(num("Centre y")), pitch: { kind: "pitch", doc: "Note name like \"C5\", \"F#4\", \"Bb3\", or a MIDI number", required: true }, width: num("Width", 0.8, { min: 0.05 }), height: num("Height", 0.12, { min: 0.01 }), angle: num("Tilt in degrees", 0), restitution: num("Bounciness", 0.5, { min: 0, max: 1 }), minSpeed: num("Slowest hit (m/s) that sounds", 0.2, { min: 0 }) },
  },
  hopper: {
    doc: "Static open-topped box holding marbles, with a gate in its floor. The gate opens and closes on a schedule. Marbles get ids '<hopper id>.m0', '.m1', ...",
    fields: {
      x: req(num("Centre x")), y: req(num("y of the gate (bottom)")),
      width: num("Inside width", 0.5, { min: 0.05 }), height: num("Wall height", 1.2, { min: 0.05 }), wall: num("Wall thickness", 0.06, { min: 0.01 }),
      marbles: { kind: "int", doc: "Marbles stacked inside at the start", default: 1, min: 0, max: 200 },
      marbleRadius: num("Marble radius", 0.1, { min: 0.01 }),
      gate: { kind: "schedule", doc: "List of {\"open\": t, \"close\": t?} in seconds. Empty = never opens", default: [] },
    },
  },
};

export const GOAL_SPEC = {
  event: { kind: "string", doc: "Event type that counts as success, e.g. \"bell-rung\"", required: true },
  part: { kind: "string", doc: "Optional: only this part's event counts" },
  by: { kind: "string", doc: "Optional: only when hit by this part" },
};

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function checkField(path, spec, v, errors) {
  switch (spec.kind) {
    case "number":
      if (!isNum(v)) return errors.push(`${path}: expected a number, got ${JSON.stringify(v)}`);
      if (spec.min !== undefined && v < spec.min) errors.push(`${path}: ${v} is below the minimum ${spec.min}`);
      if (spec.max !== undefined && v > spec.max) errors.push(`${path}: ${v} is above the maximum ${spec.max}`);
      return;
    case "int":
      if (!Number.isInteger(v)) return errors.push(`${path}: expected a whole number, got ${JSON.stringify(v)}`);
      if (spec.min !== undefined && v < spec.min) errors.push(`${path}: ${v} is below the minimum ${spec.min}`);
      if (spec.max !== undefined && v > spec.max) errors.push(`${path}: ${v} is above the maximum ${spec.max}`);
      return;
    case "string":
      if (typeof v !== "string" || !v) errors.push(`${path}: expected a non-empty string`);
      return;
    case "point":
      if (!Array.isArray(v) || v.length !== 2 || !v.every(isNum)) errors.push(`${path}: expected [x, y]`);
      return;
    case "range":
      if (!Array.isArray(v) || v.length !== 2 || !v.every(isNum) || v[0] > v[1]) errors.push(`${path}: expected [min, max] with min <= max`);
      return;
    case "pitch":
      if (!parsePitch(v)) errors.push(`${path}: ${JSON.stringify(v)} is not a pitch (use "C5", "F#4", "Bb3" or MIDI 0 to 127)`);
      return;
    case "schedule":
      if (!Array.isArray(v)) return errors.push(`${path}: expected a list of {open, close?}`);
      v.forEach((w, i) => {
        if (!w || !isNum(w.open) || w.open < 0) errors.push(`${path}[${i}].open: expected a time >= 0`);
        if (w && w.close !== undefined && (!isNum(w.close) || w.close <= w.open)) errors.push(`${path}[${i}].close: must be after open`);
        const unknown = w ? Object.keys(w).filter((k) => k !== "open" && k !== "close") : [];
        if (unknown.length) errors.push(`${path}[${i}]: unknown field(s) ${unknown.join(", ")}`);
      });
      return;
  }
}

function fill(path, specs, obj, errors, skip = []) {
  const out = {};
  for (const [k, spec] of Object.entries(specs)) {
    if (obj[k] === undefined) {
      if (spec.required) errors.push(`${path}.${k}: required`);
      else if (spec.default !== undefined) out[k] = structuredClone(spec.default);
      continue;
    }
    checkField(`${path}.${k}`, spec, obj[k], errors);
    out[k] = obj[k];
  }
  const unknown = Object.keys(obj).filter((k) => !(k in specs) && !skip.includes(k));
  if (unknown.length) errors.push(`${path}: unknown field(s) ${unknown.join(", ")}`);
  return out;
}

/**
 * Check a level and fill in defaults. Never throws.
 * @returns {{ ok: true, level: object } | { ok: false, errors: string[] }}
 */
export function validateLevel(input) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["level: expected a JSON object"] };
  if (input.schema !== "goldberg-level/1") errors.push(`schema: expected "goldberg-level/1", got ${JSON.stringify(input.schema)}`);
  const known = ["schema", "name", "world", "parts", "goal", "notes"];
  const unknown = Object.keys(input).filter((k) => !known.includes(k));
  if (unknown.length) errors.push(`level: unknown field(s) ${unknown.join(", ")}`);
  if (input.name !== undefined && typeof input.name !== "string") errors.push("name: expected a string");
  const world = fill("world", WORLD_SPEC, input.world ?? {}, errors);
  if (!Array.isArray(input.parts) || input.parts.length === 0) {
    errors.push("parts: expected a non-empty list");
    return { ok: false, errors };
  }
  const ids = new Set();
  const parts = input.parts.map((p, i) => {
    const path = `parts[${i}]`;
    if (!p || typeof p !== "object") { errors.push(`${path}: expected an object`); return null; }
    if (typeof p.id !== "string" || !/^[A-Za-z][\w-]*$/.test(p.id)) errors.push(`${path}.id: expected a name like "ball1" (letters, digits, _ or -, starting with a letter)`);
    else if (ids.has(p.id)) errors.push(`${path}.id: duplicate id "${p.id}"`);
    else ids.add(p.id);
    const spec = PART_SPECS[p.type];
    if (!spec) { errors.push(`${path}.type: unknown part type ${JSON.stringify(p.type)} (known: ${Object.keys(PART_SPECS).join(", ")})`); return null; }
    return { id: p.id, type: p.type, ...fill(`${path} (${p.id ?? p.type})`, spec.fields, p, errors, ["id", "type"]) };
  });
  let goal;
  if (input.goal !== undefined) {
    if (!input.goal || typeof input.goal !== "object") errors.push("goal: expected an object");
    else {
      goal = fill("goal", GOAL_SPEC, input.goal, errors);
      for (const k of ["part", "by"]) if (goal[k] && !ids.has(goal[k]) && !/\.m\d+$/.test(goal[k])) errors.push(`goal.${k}: no part with id "${goal[k]}"`);
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, level: { schema: input.schema, name: input.name ?? "untitled", world, parts, ...(goal ? { goal } : {}), ...(input.notes ? { notes: input.notes } : {}) } };
}
