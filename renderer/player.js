// Plays a goldberg-reel/1 (or a single goldberg-replay/1) on a canvas.
// Every pose comes from the recorded frames; nothing is simulated here.
// seek(n) draws output frame n exactly, so the recorder can step frame by frame.

const FPS = 60;
const INTRO = 1.6, OUTRO = 1.8, GHOST_SPEED = 5, GHOST_MAX = 1.5, WIN_TAIL = 2.0, FLASH = 0.35;

const COLORS = {
  floor: "#3a4150", ramp: "#3f4757", ball: "#f2a65a", marble: "#ece6d9", domino: "#e9e4d6",
  lever: "#b98b5b", bell: "#e2b84a", "hopper-wall": "#59606e", "hopper-gate": "#8a6e4a",
};
const barColor = (midi, light = 60) => `hsl(${(midi % 12) * 30} 62% ${light}%)`;

export function reelFromAny(obj) {
  if (obj?.schema === "goldberg-reel/1") return obj;
  if (obj?.schema === "goldberg-replay/1") return { schema: "goldberg-reel/1", title: obj.level.name, goal: obj.level.goal ?? null, winner: obj.trace.goal?.met || !obj.level.goal ? 0 : null, attempts: [{ index: 1, note: "", met: Boolean(obj.trace.goal?.met), replay: obj }] };
  throw new Error("expected a goldberg-reel/1 or goldberg-replay/1 JSON");
}

const lastEventT = (rp) => rp.trace.events.reduce((m, e) => Math.max(m, e.t), 0);
const simEnd = (rp) => rp.trace.duration;

export function buildTimeline(reel) {
  const segs = [];
  let frame = 0;
  const push = (s) => { segs.push({ ...s, start: frame }); frame += s.frames; };
  const first = reel.attempts[0].replay;
  push({ kind: "intro", attempt: 0, frames: Math.round(INTRO * FPS), simStart: 0, speed: 0 });
  const ghostCount = reel.winner ?? reel.attempts.length;
  for (let i = 0; i < ghostCount; i++) {
    const rp = reel.attempts[i].replay;
    const dur = Math.min(simEnd(rp), lastEventT(rp) + 0.6);
    const speed = Math.max(GHOST_SPEED, dur / GHOST_MAX);
    push({ kind: "ghost", attempt: i, frames: Math.max(1, Math.ceil((dur / speed) * FPS)), simStart: 0, speed });
  }
  if (reel.winner !== null && reel.winner !== undefined) {
    const rp = reel.attempts[reel.winner].replay;
    const dur = Math.min(simEnd(rp), (rp.trace.goal?.t ?? lastEventT(rp)) + WIN_TAIL);
    push({ kind: "winner", attempt: reel.winner, frames: Math.ceil(dur * FPS), simStart: 0, speed: 1 });
  }
  const lastSeg = segs.at(-1);
  push({ kind: "outro", attempt: lastSeg.attempt, frames: Math.round(OUTRO * FPS), simStart: lastSeg.kind === "intro" ? 0 : lastSeg.simStart + (lastSeg.frames / FPS) * lastSeg.speed, speed: 0 });
  return { segs, total: frame, first };
}

export class Player {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.ghost = new OffscreenCanvas(canvas.width, canvas.height);
    this.baked = -1;
    this.playing = false;
    this.frame = 0;
  }

  load(obj) {
    this.reel = reelFromAny(obj);
    this.tl = buildTimeline(this.reel);
    this.totalFrames = this.tl.total;
    this.fps = FPS;
    const lvl = this.tl.first.level.world;
    const { width: cw, height: ch } = this.canvas;
    this.scale = Math.min((cw - 80) / lvl.width, (ch - 120) / lvl.height);
    this.ox = (cw - lvl.width * this.scale) / 2;
    this.oy = ch - 50 - (ch - 120 - lvl.height * this.scale) / 2;
    this.baked = -1;
    this.seek(0);
    return this;
  }

  /** Map an output frame to { seg, simTime }. */
  at(n) {
    const seg = this.tl.segs.findLast((s) => n >= s.start) ?? this.tl.segs[0];
    const local = Math.min(n - seg.start, seg.frames - 1);
    return { seg, simTime: seg.simStart + (local / FPS) * seg.speed };
  }

  /** Sounds the clip should carry, in video seconds. Ghost attempts are silent. */
  audioEvents() {
    const out = [];
    for (const seg of this.tl.segs.filter((s) => s.kind === "winner")) {
      const rp = this.reel.attempts[seg.attempt].replay;
      const end = seg.simStart + (seg.frames / FPS) * seg.speed;
      for (const e of rp.trace.events) {
        if (e.t < seg.simStart || e.t >= end) continue;
        if (e.type === "bell-rung" || e.type === "bar-hit") out.push({ time: seg.start / FPS + (e.t - seg.simStart) / seg.speed, type: e.type, freq: e.freq ?? null, speed: e.speed });
      }
    }
    return out;
  }

  seek(n) {
    this.frame = Math.max(0, Math.min(this.totalFrames - 1, n));
    const { seg, simTime } = this.at(this.frame);
    const ghostsDone = this.tl.segs.filter((s) => s.kind === "ghost" && s.start + s.frames <= this.frame).length;
    if (ghostsDone !== this.baked) this.bakeGhosts(ghostsDone);
    const g = this.g, { width, height } = this.canvas;
    g.fillStyle = "#0b0d12";
    g.fillRect(0, 0, width, height);
    if (seg.kind !== "intro") g.drawImage(this.ghost, 0, 0);
    const rp = this.reel.attempts[seg.attempt].replay;
    this.drawRun(g, rp, seg.kind === "intro" ? 0 : simTime, seg.kind === "ghost" ? 0.75 : 1, true);
    this.hud(g, seg, simTime);
    return this.frame;
  }

  bakeGhosts(count) {
    const g = this.ghost.getContext("2d");
    g.clearRect(0, 0, this.ghost.width, this.ghost.height);
    for (let i = 0; i < count; i++) {
      const rp = this.reel.attempts[i].replay;
      const seg = this.tl.segs.find((s) => s.kind === "ghost" && s.attempt === i);
      const tEnd = (seg.frames / FPS) * seg.speed;
      this.trails(g, rp, tEnd, 0.22);
      this.drawRun(g, rp, tEnd, 0.16, false);
    }
    this.baked = count;
  }

  frameIndex(rp, t) {
    return Math.max(0, Math.min(rp.frames.length - 1, Math.round(t / (rp.dt * rp.frameEvery))));
  }

  // World to canvas.
  tx(x) { return this.ox + x * this.scale; }
  ty(y) { return this.oy - y * this.scale; }

  drawRun(g, rp, t, alpha, withStatic) {
    const f = rp.frames[this.frameIndex(rp, t)];
    const gateOpen = new Map();
    for (const e of rp.trace.events) if (e.t <= t && (e.type === "gate-open" || e.type === "gate-close")) gateOpen.set(e.part, e.type === "gate-open");
    const flashes = rp.trace.events.filter((e) => (e.type === "bell-rung" || e.type === "bar-hit") && e.t <= t && e.t > t - FLASH);
    g.save();
    g.globalAlpha = alpha;
    for (const b of rp.bodies) {
      if (!b.dynamic && !withStatic && b.role !== "bell") continue;
      if (b.role === "hopper-gate" && gateOpen.get(b.part)) continue;
      let x = b.x, y = b.y, a = b.angle;
      if (b.dynamic) { const i = rp.frameBodies.indexOf(b.id); x = f[i * 3]; y = f[i * 3 + 1]; a = f[i * 3 + 2]; }
      const flash = flashes.find((e) => e.part === b.part);
      const fill = b.role === "bar" ? barColor(b.midi, flash ? 78 : 58) : flash ? "#fff1b3" : COLORS[b.type === "marble" ? "marble" : b.role] ?? "#888";
      if (flash && withStatic) this.glow(g, b, x, y, a, flash, t);
      this.body(g, b, x, y, a, fill);
      if (b.pivot && withStatic) { g.fillStyle = "#2a2f3a"; g.beginPath(); g.arc(this.tx(b.pivot[0]), this.ty(b.pivot[1]), 4, 0, Math.PI * 2); g.fill(); }
    }
    g.restore();
  }

  body(g, b, x, y, a, fill) {
    const s = this.scale, c = Math.cos(a), sn = Math.sin(a);
    const P = (px, py) => [this.tx(x + px * c - py * sn), this.ty(y + px * sn + py * c)];
    g.fillStyle = fill;
    g.strokeStyle = "rgba(0,0,0,.35)";
    g.lineWidth = 1;
    for (const sh of b.shapes) {
      g.beginPath();
      if (sh.kind === "circle") {
        const [cx, cy] = P(sh.x, sh.y);
        g.arc(cx, cy, sh.r * s, 0, Math.PI * 2);
        g.fill();
        if (b.role === "ball") { // a spoke so rolling is visible
          const [ex, ey] = P(sh.x + sh.r * 0.7, sh.y);
          g.moveTo(cx, cy); g.lineTo(ex, ey); g.stroke();
        }
      } else {
        sh.points.forEach(([px, py], i) => { const [X, Y] = P(px, py); i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
        g.closePath();
        g.fill();
        g.stroke();
      }
    }
  }

  glow(g, b, x, y, a, e, t) {
    const k = 1 - (t - e.t) / FLASH;
    g.save();
    g.globalAlpha *= 0.55 * k;
    g.fillStyle = b.role === "bar" ? barColor(b.midi, 75) : "#ffe27a";
    g.beginPath();
    g.arc(this.tx(e.point[0]), this.ty(e.point[1]), (14 + 40 * (1 - k)), 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  trails(g, rp, tEnd, alpha) {
    const last = this.frameIndex(rp, tEnd);
    g.save();
    g.globalAlpha = alpha;
    g.lineWidth = 2;
    for (const b of rp.bodies.filter((b) => b.dynamic && b.role === "ball")) {
      const i = rp.frameBodies.indexOf(b.id);
      g.strokeStyle = COLORS[b.type === "marble" ? "marble" : "ball"];
      g.beginPath();
      for (let k = 0; k <= last; k++) { const f = rp.frames[k]; const X = this.tx(f[i * 3]), Y = this.ty(f[i * 3 + 1]); k ? g.lineTo(X, Y) : g.moveTo(X, Y); }
      g.stroke();
    }
    g.restore();
  }

  hud(g, seg, simTime) {
    const { width, height } = this.canvas, reel = this.reel, n = reel.attempts.length;
    const goalText = reel.goalText ?? (reel.goal ? `goal: ${reel.goal.event.replace(/-/g, " ")}` : reel.title);
    g.fillStyle = "#e8ebf1";
    g.font = "600 26px ui-monospace, SFMono-Regular, Menlo, monospace";
    const typed = seg.kind === "intro" ? goalText.slice(0, Math.ceil((goalText.length * (this.frame - seg.start + 1)) / (seg.frames * 0.6))) : goalText;
    g.fillText(typed, 40, 52);
    if (seg.kind === "intro") return;
    g.font = "500 18px ui-monospace, SFMono-Regular, Menlo, monospace";
    const att = reel.attempts[seg.attempt];
    g.textAlign = "right";
    g.fillStyle = seg.kind === "ghost" ? "#8b93a3" : "#e8ebf1";
    g.fillText(`attempt ${att.index} / ${n}${seg.kind === "ghost" ? `   ×${seg.speed.toFixed(0)}` : ""}`, width - 40, 52);
    g.fillStyle = "#8b93a3";
    g.fillText(`t = ${simTime.toFixed(2)} s`, width - 40, height - 24);
    g.textAlign = "left";
    if (att.note) { g.fillStyle = seg.kind === "ghost" ? "#a3abba" : "#d6dae3"; g.fillText(att.note, 40, height - 24); }
    if (seg.kind === "outro") {
      const goal = att.replay.trace.goal;
      const hits = att.replay.trace.events.filter((e) => e.type === "bar-hit" || e.type === "bell-rung").length;
      const line = !reel.goal ? `${hits} logged hit${hits === 1 ? "" : "s"}, no goal set` : goal?.met ? `attempt ${att.index} of ${n}: ${goal.event.replace(/-/g, " ")} at t = ${goal.t.toFixed(2)} s` : `no attempt reached the goal in ${n} tries`;
      g.textAlign = "center";
      g.fillStyle = "rgba(11,13,18,.72)";
      g.fillRect(0, height / 2 - 60, width, 104);
      g.fillStyle = "#f3f5f9";
      g.font = "600 30px ui-sans-serif, system-ui, sans-serif";
      g.fillText(line, width / 2, height / 2 - 12);
      g.font = "400 18px ui-sans-serif, system-ui, sans-serif";
      g.fillStyle = "#a3abba";
      g.fillText("every frame is physics", width / 2, height / 2 + 22);
      g.textAlign = "left";
    }
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    const t0 = performance.now() - (this.frame / FPS) * 1000;
    const sounds = this.audioEvents();
    let next = sounds.findIndex((s) => s.time >= this.frame / FPS);
    const tick = (now) => {
      if (!this.playing) return;
      const n = Math.floor(((now - t0) / 1000) * FPS);
      this.seek(n);
      while (next >= 0 && next < sounds.length && sounds[next].time <= n / FPS) this.sound(sounds[next++]);
      if (n < this.totalFrames - 1) requestAnimationFrame(tick); else this.playing = false;
    };
    requestAnimationFrame(tick);
  }

  toggle() { if (this.playing) this.playing = false; else { if (this.frame >= this.totalFrames - 1) this.frame = 0; this.play(); } }

  sound(s) {
    try {
      this.ac ??= new AudioContext();
      const ac = this.ac, gain = ac.createGain(), now = ac.currentTime;
      const level = Math.min(1, 0.25 + s.speed / 6) * 0.3;
      const partials = s.type === "bell-rung" ? [[523.25, 1], [1046.5, 0.5], [1444.2, 0.35], [2825.6, 0.15]] : [[s.freq, 1], [s.freq * 4, 0.12]];
      gain.gain.setValueAtTime(level, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (s.type === "bell-rung" ? 1.8 : 0.7));
      gain.connect(ac.destination);
      for (const [f, a] of partials) {
        const o = ac.createOscillator(), og = ac.createGain();
        o.frequency.value = f; og.gain.value = a;
        o.connect(og).connect(gain); o.start(now); o.stop(now + 2);
      }
    } catch { /* audio is optional */ }
  }
}
