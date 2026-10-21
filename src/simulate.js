import * as planck from "../vendor/planck/planck.mjs";
import { validateLevel } from "./schema.js";
import { BUILDERS, describeShapes } from "./parts.js";
import { makeRng } from "./rng.js";

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

export class LevelError extends Error {
  constructor(errors) {
    super(`invalid level:\n  ${errors.join("\n  ")}`);
    this.errors = errors;
  }
}

/**
 * Run a level headless with a fixed timestep.
 *
 * Deterministic: the same level and seed give an identical result on the same JS engine.
 * Event times are step * dt, where step is the first step whose start-of-step state has the
 * two shapes touching (Box2D detects contacts before integrating), so a touch is reported at
 * most one dt after it physically happened.
 *
 * @param {object} levelInput  a goldberg-level/1 object
 * @param {{ seed?: number, frames?: boolean }} [opts]
 * @returns {{ trace: object, replay?: object }}
 */
export function simulate(levelInput, { seed = 1, frames = true } = {}) {
  const v = validateLevel(levelInput);
  if (!v.ok) throw new LevelError(v.errors);
  const level = v.level, W = level.world;
  const rng = makeRng(seed);

  const world = new planck.World({ gravity: planck.Vec2(0, -W.gravity) });
  const ground = world.createBody({ type: "static" });
  const ctx = {
    world: W,
    ground,
    nudge: () => (W.jitter > 0 ? { dx: (rng() * 2 - 1) * W.jitter, dy: (rng() * 2 - 1) * W.jitter } : { dx: 0, dy: 0 }),
  };

  const records = level.parts.flatMap((p) => BUILDERS[p.type](world, p, ctx));
  const byPart = new Map();
  for (const r of records) if (!byPart.has(r.part)) byPart.set(r.part, r);
  const pitchOf = new Map(records.filter((r) => r.pitch).map((r) => [r.part, r.pitch]));
  const minSpeedOf = new Map(level.parts.filter((p) => p.minSpeed !== undefined).map((p) => [p.id, p.minSpeed]));
  // Ball parts are named by their own id (hopper marbles are "<hopper>.mN").
  const balls = records.filter((r) => r.ball);
  const dynamic = records.filter((r) => r.dynamic);
  const gates = records.filter((r) => r.gate);

  const dt = W.dt, steps = Math.round(W.duration / dt);
  const events = [];
  const lastPair = new Map();
  let pending = [];
  let step = 0;

  world.on("begin-contact", (c) => {
    const fa = c.getFixtureA(), fb = c.getFixtureB();
    const a = fa.getUserData(), b = fb.getUserData();
    const ida = idOf(fa, a), idb = idOf(fb, b);
    if (ida === idb) return;
    const wm = c.getWorldManifold(null);
    if (!wm || wm.pointCount === 0) return;
    let px = 0, py = 0;
    for (let i = 0; i < wm.pointCount; i++) { px += wm.points[i].x; py += wm.points[i].y; }
    px /= wm.pointCount; py /= wm.pointCount;
    const p = planck.Vec2(px, py);
    const va = fa.getBody().getLinearVelocityFromWorldPoint(p), vb = fb.getBody().getLinearVelocityFromWorldPoint(p);
    // Normal points from A to B, so A approaching B is a positive dot product.
    const speed = Math.max(0, (va.x - vb.x) * wm.normal.x + (va.y - vb.y) * wm.normal.y);
    pending.push({ a: { id: ida, role: a.role }, b: { id: idb, role: b.role }, speed, point: [px, py] });
  });
  function idOf(f, ud) {
    const body = f.getBody();
    const rec = bodyRec.get(body);
    return rec?.ball ? rec.id : ud.part;
  }
  const bodyRec = new Map(records.map((r) => [r.body, r]));

  const frameBodies = dynamic.map((r) => r.id);
  const frameData = [];
  const snap = () => {
    const f = [];
    for (const r of dynamic) { const pos = r.body.getPosition(); f.push(r4(pos.x), r4(pos.y), r4(r.body.getAngle())); }
    frameData.push(f);
  };

  const gateOpen = new Map(gates.map((g) => [g.id, true]));
  const lastMoving = new Map(balls.map((b) => [b.id, -1]));
  const outOfBounds = new Set();
  const emit = (e) => events.push({ t: r6(step * dt), step, ...e });

  for (step = 0; step <= steps; step++) {
    const t = step * dt;
    // Gate schedule: closed unless some window has open <= t < close.
    for (const g of gates) {
      const shouldBeClosed = !g.gate.some((w) => t >= w.open - 1e-12 && (w.close === undefined || t < w.close - 1e-12));
      if (shouldBeClosed !== gateOpen.get(g.id)) {
        gateOpen.set(g.id, shouldBeClosed);
        g.body.setActive(shouldBeClosed);
        if (step > 0 || !shouldBeClosed) emit({ type: shouldBeClosed ? "gate-close" : "gate-open", part: g.part });
      }
    }
    if (frames && step % W.frameEvery === 0) snap();
    if (step === steps) break;

    pending = [];
    world.step(dt, W.velocityIterations, W.positionIterations);
    for (const c of pending) logContact(c);

    for (const b of balls) {
      const vel = b.body.getLinearVelocity(), w = b.body.getAngularVelocity();
      if (Math.hypot(vel.x, vel.y) > W.restSpeed || Math.abs(w) * b.ball.radius > W.restSpeed) lastMoving.set(b.id, step);
      if (!outOfBounds.has(b.id)) {
        const pos = b.body.getPosition();
        if (pos.y < -2 || pos.x < -2 || pos.x > W.width + 2) { outOfBounds.add(b.id); emit({ type: "out-of-bounds", part: b.id, point: [r4(pos.x), r4(pos.y)] }); }
      }
    }
  }

  function logContact(c) {
    const key = c.a.id < c.b.id ? `${c.a.id}|${c.b.id}` : `${c.b.id}|${c.a.id}`;
    const prev = lastPair.get(key);
    lastPair.set(key, step);
    if (prev !== undefined && (step - prev) * dt < W.debounce) return;
    const base = { speed: r4(c.speed), point: c.point.map(r4) };
    if (c.speed >= W.contactMinSpeed) emit({ type: "contact", a: c.a.id, b: c.b.id, ...base });
    for (const [hit, other] of [[c.a, c.b], [c.b, c.a]]) {
      if (hit.role === "bell" && c.speed >= minSpeedOf.get(hit.id)) emit({ type: "bell-rung", part: hit.id, by: other.id, ...base });
      if (hit.role === "bar" && c.speed >= minSpeedOf.get(hit.id)) {
        const p = pitchOf.get(hit.id);
        emit({ type: "bar-hit", part: hit.id, by: other.id, pitch: p.name, midi: p.midi, freq: r4(p.freq), ...base });
      }
    }
  }

  const rest = balls.map((b) => {
    const pos = b.body.getPosition();
    const touching = new Set();
    for (let ce = b.body.getContactList(); ce; ce = ce.next) {
      if (!ce.contact.isTouching()) continue;
      const other = bodyRec.get(ce.other);
      if (other) touching.add(other.ball ? other.id : other.part);
    }
    const lm = lastMoving.get(b.id);
    return {
      part: b.id,
      x: r4(pos.x), y: r4(pos.y),
      restedAt: lm >= steps - 1 ? null : r6((lm + 1) * dt),
      touching: [...touching].sort(),
      outOfBounds: outOfBounds.has(b.id),
    };
  });

  let goal = null;
  if (level.goal) {
    const g = level.goal;
    const hit = events.find((e) => e.type === g.event && (!g.part || e.part === g.part) && (!g.by || e.by === g.by));
    goal = { ...g, met: Boolean(hit), t: hit ? hit.t : null, step: hit ? hit.step : null };
  }

  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const trace = { schema: "goldberg-trace/1", level: level.name, seed, dt, steps, duration: r6(steps * dt), goal, events, rest, counts };
  if (!frames) return { trace };

  const bodies = records.map((r) => {
    const pos = r.body.getPosition();
    return { id: r.id, part: r.part, type: r.type, role: r.role, dynamic: r.dynamic, x: r4(pos.x), y: r4(pos.y), angle: r4(r.body.getAngle()), shapes: describeShapes(r.body), ...(r.pitch ? { pitch: r.pitch.name, midi: r.pitch.midi } : {}), ...(r.pivot ? { pivot: r.pivot.map(r4) } : {}) };
  });
  // Static bodies report their (unchanging) pose above; dynamic ones start from frame 0.
  for (const b of bodies) if (b.dynamic) { const i = frameBodies.indexOf(b.id); Object.assign(b, { x: frameData[0][i * 3], y: frameData[0][i * 3 + 1], angle: frameData[0][i * 3 + 2] }); }
  const replay = { schema: "goldberg-replay/1", level, seed, dt, frameEvery: W.frameEvery, frameBodies, bodies, frames: frameData, trace };
  return { trace, replay };
}
