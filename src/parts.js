import * as planck from "../vendor/planck/planck.mjs";
import { parsePitch } from "./pitch.js";

const DEG = Math.PI / 180;
const { Vec2, Box, Circle, Polygon, RevoluteJoint } = planck;

/**
 * Each builder adds bodies to the world and returns body records:
 * { id, part, type, role, body, dynamic, ball? }.
 * Every fixture carries userData = { part, role } so contacts map back to level parts.
 */

function plankBetween(world, part, from, to, thickness, fixture) {
  const [x1, y1] = from, [x2, y2] = to;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  // Shift the centre down along the surface normal so the top face lies on from -> to.
  const cx = (x1 + x2) / 2 + Math.sin(ang) * thickness / 2;
  const cy = (y1 + y2) / 2 - Math.cos(ang) * thickness / 2;
  const body = world.createBody({ type: "static", position: Vec2(cx, cy), angle: ang });
  body.createFixture(new Box(len / 2, thickness / 2), { ...fixture, userData: { part: part.id, role: part.type } });
  return body;
}

function ballRecord(world, id, p, nudge, bullet) {
  const body = world.createBody({ type: "dynamic", position: Vec2(p.x + nudge.dx, p.y + nudge.dy), bullet, linearVelocity: Vec2(p.vx ?? 0, p.vy ?? 0) });
  body.createFixture(new Circle(p.radius), { density: p.density, friction: p.friction, restitution: p.restitution, userData: { part: id, role: "ball" } });
  return { id, part: id, type: p.type ?? "marble", role: "ball", body, dynamic: true, ball: { radius: p.radius } };
}

export const BUILDERS = {
  ball: (world, p, ctx) => [ballRecord(world, p.id, p, ctx.nudge(), false)],
  marble: (world, p, ctx) => [ballRecord(world, p.id, p, ctx.nudge(), true)],

  floor: (world, p, ctx) => {
    const from = p.from ?? [0, 0], to = p.to ?? [ctx.world.width, 0];
    return [{ id: p.id, part: p.id, type: p.type, role: "floor", body: plankBetween(world, p, from, to, p.thickness, { friction: p.friction }), dynamic: false }];
  },

  ramp: (world, p) => [{ id: p.id, part: p.id, type: p.type, role: "ramp", body: plankBetween(world, p, p.from, p.to, p.thickness, { friction: p.friction, restitution: p.restitution }), dynamic: false }],

  domino: (world, p, ctx) => {
    const n = ctx.nudge(), a = p.angle * DEG;
    const cx = p.x + n.dx - Math.sin(a) * p.height / 2, cy = p.y + n.dy + Math.cos(a) * p.height / 2;
    const body = world.createBody({ type: "dynamic", position: Vec2(cx, cy), angle: a });
    body.createFixture(new Box(p.width / 2, p.height / 2), { density: p.density, friction: p.friction, userData: { part: p.id, role: "domino" } });
    return [{ id: p.id, part: p.id, type: p.type, role: "domino", body, dynamic: true }];
  },

  lever: (world, p, ctx) => {
    const n = ctx.nudge();
    const pivot = Vec2(p.x + n.dx, p.y + n.dy);
    const body = world.createBody({ type: "dynamic", position: pivot, angle: p.angle * DEG });
    body.createFixture(new Box(p.length / 2, p.thickness / 2, Vec2((0.5 - p.pivotAt) * p.length, 0), 0), { density: p.density, friction: p.friction, userData: { part: p.id, role: "lever" } });
    const opt = { referenceAngle: 0 };
    if (p.limits) Object.assign(opt, { enableLimit: true, lowerAngle: p.limits[0] * DEG, upperAngle: p.limits[1] * DEG });
    world.createJoint(new RevoluteJoint(opt, ctx.ground, body, pivot));
    return [{ id: p.id, part: p.id, type: p.type, role: "lever", body, dynamic: true, pivot: [pivot.x, pivot.y] }];
  },

  bell: (world, p) => {
    const w = p.width / 2, top = p.width * 0.225, h = p.height / 2;
    const body = world.createBody({ type: "static", position: Vec2(p.x, p.y) });
    body.createFixture(new Polygon([Vec2(-w, -h), Vec2(w, -h), Vec2(top, h), Vec2(-top, h)]), { friction: 0.3, restitution: 0.3, userData: { part: p.id, role: "bell" } });
    return [{ id: p.id, part: p.id, type: p.type, role: "bell", body, dynamic: false }];
  },

  bar: (world, p) => {
    const body = world.createBody({ type: "static", position: Vec2(p.x, p.y), angle: p.angle * DEG });
    body.createFixture(new Box(p.width / 2, p.height / 2), { friction: 0.2, restitution: p.restitution, userData: { part: p.id, role: "bar" } });
    return [{ id: p.id, part: p.id, type: p.type, role: "bar", body, dynamic: false, pitch: parsePitch(p.pitch) }];
  },

  hopper: (world, p, ctx) => {
    const ud = (role) => ({ friction: 0.1, userData: { part: p.id, role } });
    const walls = world.createBody({ type: "static", position: Vec2(p.x, p.y) });
    const half = p.width / 2 + p.wall / 2;
    walls.createFixture(new Box(p.wall / 2, p.height / 2, Vec2(-half, p.height / 2), 0), ud("hopper-wall"));
    walls.createFixture(new Box(p.wall / 2, p.height / 2, Vec2(half, p.height / 2), 0), ud("hopper-wall"));
    const gate = world.createBody({ type: "static", position: Vec2(p.x, p.y - p.wall / 2) });
    gate.createFixture(new Box(p.width / 2 + p.wall, p.wall / 2), ud("hopper-gate"));
    const recs = [
      { id: `${p.id}.walls`, part: p.id, type: p.type, role: "hopper-wall", body: walls, dynamic: false },
      { id: `${p.id}.gate`, part: p.id, type: p.type, role: "hopper-gate", body: gate, dynamic: false, gate: p.gate },
    ];
    const r = p.marbleRadius, perRow = Math.max(1, Math.floor(p.width / (2.02 * r)));
    const x0 = p.x - ((perRow - 1) * 2.02 * r) / 2;
    for (let i = 0; i < p.marbles; i++) {
      const row = Math.floor(i / perRow), col = i % perRow;
      const m = { type: "marble", x: x0 + col * 2.02 * r, y: p.y + r * 1.01 + row * 2.02 * r, radius: r, density: 1, friction: 0.1, restitution: 0.3 };
      recs.push(ballRecord(world, `${p.id}.m${i}`, m, ctx.nudge(), true));
    }
    return recs;
  },
};

/** Shapes of a body in body-local coordinates, for the renderer. */
export function describeShapes(body) {
  const out = [];
  for (let f = body.getFixtureList(); f; f = f.getNext()) {
    const s = f.getShape(), role = f.getUserData().role;
    if (s.getType() === "circle") {
      const c = s.getCenter();
      out.push({ kind: "circle", x: c.x, y: c.y, r: s.getRadius(), role });
    } else {
      out.push({ kind: "poly", points: s.m_vertices.slice(0, s.m_count).map((v) => [v.x, v.y]), role });
    }
  }
  return out;
}
