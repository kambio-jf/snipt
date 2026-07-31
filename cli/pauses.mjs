// pauses.mjs — print the measured silences in a clip.
//
// The debugging tool of last resort when a cut sounds wrong. Whisper's word timings
// are an estimate and it will decode a swallow into words; the waveform won't lie.
// If a seam clicks or clips, run this and cut on a pause instead.
//
// usage: node cli/pauses.mjs clips/2026-07-31/race-raw.mp4 [startS] [endS]
//        node cli/pauses.mjs clip.mp4 --db -38 --min 60      (more sensitive)
import { resolve } from "node:path";
import { detectPauses, ffprobeDur } from "../lib/cutlib.mjs";

const args = process.argv.slice(2);
const clip = args[0];
if (!clip) {
  console.error("usage: node cli/pauses.mjs <clip> [startS] [endS] [--db -42] [--min 80]");
  process.exit(1);
}
const num = (flag, dflt) => (args.includes(flag) ? +args[args.indexOf(flag) + 1] : dflt);
const noiseDb = num("--db", -42);
const minS = num("--min", 80) / 1000;
const range = args.slice(1).filter((a) => !a.startsWith("--") && !Number.isNaN(+a)).map(Number);
const [from = 0, to = Infinity] = range;

const path = resolve(clip);
const dur = ffprobeDur(path);
const pauses = detectPauses(path, { noiseDb, minS }).filter(([s]) => s >= from && s <= to);

console.log(`${clip} — ${dur.toFixed(1)}s · silence < ${noiseDb}dB for >= ${Math.round(minS * 1000)}ms`);
if (!pauses.length) {
  console.log("  (none — try a higher --db or a lower --min)");
} else {
  for (const [s, e] of pauses) console.log(`  PAUSE ${s.toFixed(2).padStart(7)} - ${e.toFixed(2).padStart(7)}  (${Math.round((e - s) * 1000)}ms)`);
  const talk = dur - pauses.reduce((a, [s, e]) => a + (e - s), 0);
  console.log(`\n  ${pauses.length} pause(s) · ~${talk.toFixed(1)}s speech of ${dur.toFixed(1)}s`);
}
