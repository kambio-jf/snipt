// pancaps.mjs — output a screencap at each pan keyframe's `when` anchor, so Joel
// can read the top-left viewport coords off the exact frame that's on screen there.
// usage: node cli/pancaps.mjs clips/2026-07-13/shorts.json delta-safe
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { anchorTime, srtWordTimeline } from "../lib/cutlib.mjs";

const [, , jsonPath, name] = process.argv;
if (!jsonPath || !name) { console.error("usage: node cli/pancaps.mjs <shorts.json> <name>"); process.exit(1); }
const cfg = JSON.parse(readFileSync(jsonPath, "utf8"));
const short = cfg.shorts.find((s) => s.name === name);
if (!short) { console.error(`no short "${name}"`); process.exit(1); }
const dir = dirname(resolve(short.source));
const timeline = srtWordTimeline(resolve(short.srt));
const src = resolve(short.source);
const clk = (s) => s == null ? 0 : String(s).includes(":") ? String(s).split(":").reduce((a, x) => a * 60 + +x, 0) : +s;
const inSec = short.keep && short.keep.length ? +short.keep[0][0] : short.in && short.in !== "start" ? clk(short.in) : 0;

for (const [i, p] of (short.pan ?? []).entries()) {
  const t = p.when === "start" || p.when == null ? inSec : anchorTime(timeline, p.when);
  const out = `${name}-pan${i}.png`;
  execFileSync("ffmpeg", ["-y", "-ss", String(t), "-i", src, "-frames:v", "1", "-q:v", "2", join(dir, out)], { stdio: "ignore" });
  console.log(`pan${i}  "${p.when}"  @ ${t}s  ->  ${out}`);
}
