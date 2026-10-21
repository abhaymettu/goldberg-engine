#!/usr/bin/env node
// record <reel.json | replay.json> --out out/clip.mp4 [--no-audio]
// Opens the renderer in headless Chromium, steps it frame by frame (no wall clock),
// pipes PNG frames to ffmpeg, and muxes audio synthesized from the logged events.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, extname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { synthWav } from "./synth.js";

const args = process.argv.slice(2);
const input = args[0], out = args[args.indexOf("--out") + 1];
if (!input || !args.includes("--out")) { console.error("usage: record <reel.json|replay.json> --out <clip.mp4> [--no-audio]"); process.exit(2); }
const root = resolve(dirname(new URL(import.meta.url).pathname), "..");

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  const dir = existsSync(cache) && readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().at(-1);
  const p = dir && join(cache, dir, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
  if (!p || !existsSync(p)) throw new Error("no headless Chromium found; set CHROME_PATH");
  return p;
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
const reelJson = readFileSync(input, "utf8");
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/reel.json") { res.writeHead(200, { "content-type": "application/json" }); return res.end(reelJson); }
  const file = join(root, "renderer", path === "/" ? "index.html" : path.slice(1));
  if (!file.startsWith(join(root, "renderer")) || !existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => { console.error("page error:", e.message); process.exitCode = 1; });
  await page.goto(`http://127.0.0.1:${port}/?record&reel=/reel.json`);
  await page.waitForFunction(() => window.reel?.totalFrames > 0);
  const { total, fps, sounds } = await page.evaluate(() => ({ total: window.reel.totalFrames, fps: window.reel.fps, sounds: window.reel.audioEvents() }));

  mkdirSync(dirname(resolve(out)), { recursive: true });
  const withAudio = !args.includes("--no-audio") && sounds.length > 0;
  const wav = join(tmpdir(), `goldberg-${process.pid}.wav`);
  if (withAudio) writeFileSync(wav, synthWav(sounds, total / fps + 0.5));
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    ...(withAudio ? ["-i", wav, "-c:a", "aac", "-b:a", "160k"] : []),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", ...(withAudio ? ["-shortest"] : []), resolve(out)], { stdio: ["pipe", "inherit", "inherit"] });
  const ffDone = new Promise((r, j) => ff.on("close", (c) => (c === 0 ? r() : j(new Error(`ffmpeg exited ${c}`)))));

  const t0 = Date.now();
  for (let n = 0; n < total; n++) {
    const data = await page.evaluate((i) => { window.reel.seek(i); return document.getElementById("c").toDataURL("image/png"); }, n);
    if (!ff.stdin.write(Buffer.from(data.slice(22), "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await ffDone;
  console.log(JSON.stringify({ out, frames: total, fps, seconds: +(total / fps).toFixed(2), sounds: withAudio ? sounds.length : 0, renderSeconds: +((Date.now() - t0) / 1000).toFixed(1) }));
} finally {
  await browser.close();
  server.close();
}
