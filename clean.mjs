// clean.mjs — full-video "master" cleaner (dead-air auto-removal + your filler pass).
// Phase 1 (no script yet): word-transcribe the full video -> <name>.words.json + <name>.script.txt, then stop.
// Phase 2 (script exists): --tighten removes dead air automatically; any words you DELETED
//   from script.txt are cut too; renders a clean landscape master <name>-CLEAN.mp4.
//
// usage:
//   node clean.mjs "path/to/recording.mp4"                                        (phase 1: transcribe)
//   node clean.mjs "…mp4" --dry-run          (phase 2 preview: cut summary, no render)
//   node clean.mjs "…mp4" [--tighten 350] [--defiller]   (phase 2: render CLEAN master)
//   node clean.mjs "…mp4" --transcribe       (force re-transcribe)
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { dirname, basename, resolve, join } from "node:path";
import { runWordWhisper, computeKeep, cutFilter, ffprobeDur, raw2final, subtractRanges } from "./cutlib.mjs";

// parse repeatable --cut MM:SS-MM:SS (or seconds) redaction ranges (RAW timeline)
const clk = (s) => s.includes(":") ? s.split(":").reduce((a, x) => a * 60 + +x, 0) : +s;
const cuts = [];

const args = process.argv.slice(2);
const videoArg = args[0];
if (!videoArg) { console.error('usage: node clean.mjs "<full-video>" [--tighten 350] [--defiller] [--cut MM:SS-MM:SS] [--dry-run] [--transcribe]'); process.exit(1); }
const video = resolve(videoArg);
const dir = dirname(video);
const name = basename(video).replace(/\.[^.]+$/, "");
const scriptPath = join(dir, `${name}.script.txt`);
const wordsPath = join(dir, `${name}.words.json`);
const dryRun = args.includes("--dry-run");
const defiller = args.includes("--defiller");
const tighten = args.includes("--tighten") ? +args[args.indexOf("--tighten") + 1] : 350;
for (let i = 0; i < args.length; i++) if (args[i] === "--cut") { const [a, b] = args[i + 1].split("-"); cuts.push([clk(a), clk(b)]); }

// ---------- phase 1: transcribe ----------
if (args.includes("--transcribe") || !existsSync(scriptPath)) {
  console.log(`▶ transcribing full video (word-level) — this is the slow step…`);
  const words = runWordWhisper(video);
  writeFileSync(wordsPath, JSON.stringify(words));
  writeFileSync(scriptPath, words.map((w) => w.text).join(" ") + "\n");
  const mins = (ffprobeDur(video) / 60).toFixed(1);
  console.log(`✅ ${words.length} words over ${mins} min -> ${name}.script.txt`);
  console.log(`   Next: delete filler words in ${name}.script.txt, then:`);
  console.log(`   node clean.mjs "${videoArg}" --dry-run     (preview the cuts)`);
  console.log(`   node clean.mjs "${videoArg}"               (render ${name}-CLEAN.mp4; dead air auto-removed)`);
  process.exit(0);
}

// ---------- phase 2: compute cuts ----------
const words = JSON.parse(readFileSync(wordsPath, "utf8"));
const editedText = readFileSync(scriptPath, "utf8");
const dur = ffprobeDur(video);
let { keep, matched, keptWords } = computeKeep({ words, editedText, dur, tighten, defiller });
if (cuts.length) {
  keep = subtractRanges(keep, cuts);
  const inCut = (t) => cuts.some(([a, b]) => t >= a && t < b);
  keptWords = keptWords.filter((w) => !inCut(w.start));
}
if (!keep.length) { console.error("nothing survived — aborting"); process.exit(1); }
const kd = keep.reduce((a, [s, e]) => a + (e - s), 0);
const deleted = words.length - matched;
console.log(`\n${name}: ${deleted} filler word(s) deleted, dead air tightened @ ${tighten}ms${defiller ? " (+um/uh)" : ""}${cuts.length ? `, ${cuts.length} manual cut(s)` : ""}`);
console.log(`${keep.length} keep-span(s) · ${(kd / 60).toFixed(1)} min of ${(dur / 60).toFixed(1)} min  (removed ${((dur - kd) / 60).toFixed(1)} min, ${((1 - kd / dur) * 100).toFixed(0)}% shorter)`);
writeFileSync(join(dir, `${name}.clean.json`), JSON.stringify({ source: video, tighten, defiller, keep }, null, 2));

// transcript of the POSTED (clean) video: surviving words with remapped timestamps,
// grouped into [M:SS] lines — no YouTube auto-caption wait needed.
const r2f = raw2final(keep);
const stamp = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const lines = []; let cur = [], curStart = null;
for (const w of keptWords) {
  if (curStart == null) curStart = r2f(w.start);
  cur.push(w.text);
  const chars = cur.join(" ").length;
  if ((/[.?!]$/.test(w.text) && cur.length >= 5) || chars >= 90) { lines.push(`${stamp(curStart)}  ${cur.join(" ")}`); cur = []; curStart = null; }
}
if (cur.length) lines.push(`${stamp(curStart)}  ${cur.join(" ")}`);
writeFileSync(join(dir, `${name}.transcript.txt`), lines.join("\n") + "\n");
console.log(`📄 ${name}.transcript.txt — clean-timeline transcript ready (no YT wait)`);
if (dryRun) { console.log(`(dry run — no render. drop --dry-run to build ${name}-CLEAN.mp4)`); process.exit(0); }

// ---------- phase 2: render ----------
// Hundreds of precise cuts don't fit one filtergraph (giant split = slow) or a
// select expression (parser OOMs). So extract each keep-span accurately in
// parallel (fast keyframe seek + accurate discard, QSV) then concat-copy.
const segDir = join(dir, `${name}.segs`);
mkdirSync(segDir, { recursive: true });
const jobs = keep.map(([s, e], i) => ({ s, dur: +(e - s).toFixed(3), out: join(segDir, `s${String(i).padStart(4, "0")}.mp4`) }));
console.log(`▶ extracting ${jobs.length} segments (QSV, parallel)…`);

const CONC = 4;
let done = 0;
const runJob = (j) => new Promise((res, rej) => {
  const p = spawn("ffmpeg", ["-y", "-ss", String(j.s), "-i", video, "-t", String(j.dur),
    "-c:v", "h264_qsv", "-global_quality", "23", "-c:a", "aac", "-b:a", "192k",
    "-avoid_negative_ts", "make_zero", j.out], { stdio: "ignore" });
  p.on("exit", (c) => { if (c === 0) { if (++done % 50 === 0) console.log(`   ${done}/${jobs.length}`); res(); } else rej(new Error(`segment failed: ${j.out}`)); });
});
const queue = [...jobs];
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) await runJob(queue.shift()); }));

const listFile = join(segDir, "list.txt");
writeFileSync(listFile, jobs.map((j) => `file '${j.out.replace(/\\/g, "/")}'`).join("\n") + "\n");
console.log(`▶ joining → ${name}-CLEAN.mp4 …`);
execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", `${name}-CLEAN.mp4`], { stdio: "inherit", cwd: dir });
rmSync(segDir, { recursive: true, force: true });
console.log(`✅ ${join(dir, `${name}-CLEAN.mp4`)}`);
