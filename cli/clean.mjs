// clean.mjs — full-video "master" cleaner (dead-air auto-removal + your filler pass).
// Phase 1 (no script yet): word-transcribe the full video -> <name>.words.json + <name>.script.txt, then stop.
// Phase 2 (script exists): --tighten removes dead air automatically; any words you DELETED
//   from script.txt are cut too; renders a clean landscape master <name>-CLEAN.mp4.
//
// usage:
//   node cli/clean.mjs "path/to/recording.mp4"                                        (phase 1: transcribe)
//   node cli/clean.mjs "…mp4" --dry-run          (phase 2 preview: cut summary, no render)
//   node cli/clean.mjs "…mp4" [--tighten 350] [--defiller]   (phase 2: render CLEAN master)
//   node cli/clean.mjs "…mp4" --transcribe       (force re-transcribe)
//   node cli/clean.mjs "…mp4" --seg-timeout 30   (flat per-segment encode limit, s;
//                                                 default max(60, 10 x segment length))
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { dirname, basename, resolve, join } from "node:path";
import { runWordWhisper, computeKeep, cutFilter, ffprobeDur, raw2final, subtractRanges } from "../lib/cutlib.mjs";
import { levelToTarget } from "../lib/loudness.mjs";

// parse repeatable --cut MM:SS-MM:SS (or seconds) redaction ranges (RAW timeline)
const clk = (s) => s.includes(":") ? s.split(":").reduce((a, x) => a * 60 + +x, 0) : +s;
const cuts = [];

const args = process.argv.slice(2);
const videoArg = args[0];
if (!videoArg) { console.error('usage: node cli/clean.mjs "<full-video>" [--tighten 350] [--defiller] [--cut MM:SS-MM:SS] [--dry-run] [--transcribe]'); process.exit(1); }
const video = resolve(videoArg);
const dir = dirname(video);
const name = basename(video).replace(/\.[^.]+$/, "");
const scriptPath = join(dir, `${name}.script.txt`);
const wordsPath = join(dir, `${name}.words.json`);
const dryRun = args.includes("--dry-run");
const defiller = args.includes("--defiller");
const tighten = args.includes("--tighten") ? +args[args.indexOf("--tighten") + 1] : 350;
const segTimeoutFlat = args.includes("--seg-timeout") ? +args[args.indexOf("--seg-timeout") + 1] : null;
for (let i = 0; i < args.length; i++) if (args[i] === "--cut") { const [a, b] = args[i + 1].split("-"); cuts.push([clk(a), clk(b)]); }

// ---------- phase 1: transcribe ----------
if (args.includes("--transcribe") || !existsSync(scriptPath)) {
  console.log(`▶ transcribing full video (word-level) — this is the slow step…`);
  const words = await runWordWhisper(video);
  writeFileSync(wordsPath, JSON.stringify(words));
  writeFileSync(scriptPath, words.map((w) => w.text).join(" ") + "\n");
  const mins = (ffprobeDur(video) / 60).toFixed(1);
  console.log(`✅ ${words.length} words over ${mins} min -> ${name}.script.txt`);
  console.log(`   Next: delete filler words in ${name}.script.txt, then:`);
  console.log(`   node cli/clean.mjs "${videoArg}" --dry-run     (preview the cuts)`);
  console.log(`   node cli/clean.mjs "${videoArg}"               (render ${name}-CLEAN.mp4; dead air auto-removed)`);
  process.exit(0);
}

// ---------- phase 2: compute cuts ----------
const words = JSON.parse(readFileSync(wordsPath, "utf8"));
const editedScript = existsSync(join(dir, `${name}.script-edited.txt`)) ? join(dir, `${name}.script-edited.txt`) : scriptPath;
console.log(`(using ${basename(editedScript)})`);
const editedText = readFileSync(editedScript, "utf8");
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
//
// Written twice on a real render. Before it, only the nominal span lengths exist,
// so the stamps run a few seconds EARLY late in the video (see raw2final). After
// the segments are extracted their real durations are known, and it is rewritten
// on the timeline the posted file actually has. Chapters come from this file.
const stamp = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
function writeTranscript(r2f) {
  const lines = []; let cur = [], curStart = null;
  for (const w of keptWords) {
    if (curStart == null) curStart = r2f(w.start);
    cur.push(w.text);
    const chars = cur.join(" ").length;
    if ((/[.?!]$/.test(w.text) && cur.length >= 5) || chars >= 90) { lines.push(`${stamp(curStart)}  ${cur.join(" ")}`); cur = []; curStart = null; }
  }
  if (cur.length) lines.push(`${stamp(curStart)}  ${cur.join(" ")}`);
  writeFileSync(join(dir, `${name}.transcript.txt`), lines.join("\n") + "\n");
}
writeTranscript(raw2final(keep));
console.log(`📄 ${name}.transcript.txt — clean-timeline transcript ready (no YT wait)`);
if (dryRun) {
  console.log(`   (nominal timing: the render rewrites it from the measured segment lengths, which run a few seconds longer by the end)`);
  console.log(`(dry run — no render. drop --dry-run to build ${name}-CLEAN.mp4)`);
  process.exit(0);
}

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
// Headroom before the AAC encode. Joel's OBS gain now puts the source within a
// few tenths of full scale, and encoding that hot makes the DECODED signal
// overshoot: 2026-08-24 rendered at 0.0 dBFS sample / +3.08 dBTP, 2026-08-25 at
// -0.0 / +1.42, both from sources peaking at -0.3. The bitstream isn't clipped,
// the reconstruction is — which still distorts on playback and survives
// YouTube's re-encode. Limiting each segment to -2.2 dBFS before the encoder
// leaves enough room to absorb it; both days landed near -1.4 dBTP when this
// was applied by hand afterwards. Costs ~0.3 LU of loudness, which is nothing
// against shipping a clipped master.
const AUDIO_CEILING = "alimiter=limit=0.78:attack=5:release=50:level=disabled";

// A QSV encode can hang while finishing its file and never exit. On 2026-09-23
// s0144 - a 2.55 s segment - wrote its frames in 6 s and then sat for 55 min,
// and because the join waits on every segment the whole render stalled with
// nothing on screen to say so. Segments normally take seconds, so allow generous
// headroom scaled to length, kill an overrun, retry it once, and fail LOUDLY
// (naming the segment and where it sits in the source) if the retry fails too.
// --seg-timeout <s> replaces the scaled limit with a flat one.
const segTimeoutS = (d) => segTimeoutFlat ?? Math.max(60, d * 10);
const encodeOnce = (j) => new Promise((res, rej) => {
  const p = spawn("ffmpeg", ["-y", "-ss", String(j.s), "-i", video, "-t", String(j.dur),
    "-c:v", "h264_qsv", "-global_quality", "23", "-af", AUDIO_CEILING, "-c:a", "aac", "-b:a", "192k",
    "-avoid_negative_ts", "make_zero", j.out], { stdio: "ignore" });
  const limit = segTimeoutS(j.dur);
  const timer = setTimeout(() => { p.kill("SIGKILL"); rej(new Error(`no exit after ${limit}s, killed`)); }, limit * 1000);
  p.on("error", (e) => { clearTimeout(timer); rej(e); });
  p.on("exit", (c) => { clearTimeout(timer); c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)); });
});
const runJob = async (j) => {
  for (let attempt = 1; ; attempt++) {
    try { await encodeOnce(j); break; }
    catch (e) {
      const where = `${basename(j.out)} (source ${stamp(j.s)}, ${j.dur}s)`;
      if (attempt >= 2) throw new Error(`segment ${where} failed twice: ${e.message}`);
      console.log(`   ⚠ ${where}: ${e.message} - retrying`);
    }
  }
  if (++done % 50 === 0) console.log(`   ${done}/${jobs.length}`);
};
const queue = [...jobs];
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) await runJob(queue.shift()); }));

// Put the transcript on the timeline the posted file will actually have. The
// concat below places each segment after the previous one's REAL length, and
// every segment encodes a little long (~26 ms on 2026-09-23), so the nominal
// stamps drift early - 8.1 s by the end of that day's 307 segments, which
// moved late chapters onto the wrong sentence. segDurs goes into clean.json too:
// anything mapping a transcript time back to the source through clean.json
// (cutting Shorts from the original) must walk the same timeline.
const segDurs = jobs.map((j) => +ffprobeDur(j.out).toFixed(3));
const drift = segDurs.reduce((a, d) => a + d, 0) - kd;
writeFileSync(join(dir, `${name}.clean.json`), JSON.stringify({ source: video, tighten, defiller, keep, segDurs }, null, 2));
writeTranscript(raw2final(keep, segDurs));
console.log(`📄 ${name}.transcript.txt rewritten on the rendered timeline (segments run ${drift.toFixed(1)}s long in total)`);

const listFile = join(segDir, "list.txt");
writeFileSync(listFile, jobs.map((j) => `file '${j.out.replace(/\\/g, "/")}'`).join("\n") + "\n");
console.log(`▶ joining → ${name}-CLEAN.mp4 …`);
// Video is copied; audio is re-encoded through the ceiling ONE MORE TIME here.
//
// The per-segment ceiling above is necessary but not sufficient. Measured
// 2026-08-26: a single segment encodes to -2.0 dBFS exactly as intended, yet the
// concatenated master still reached 0.0 dBFS / +0.53 dBTP. The overshoot is
// created AT THE JOINS — concat-copy splices 160 independently-encoded AAC
// streams, and every boundary is a decoder discontinuity. No amount of
// per-segment limiting can reach that, because it does not exist until the
// segments are spliced.
//
// So the last word has to be a whole-file pass. This costs one audio generation
// (video is untouched) and is the same operation that had to be run by hand on
// 2026-08-24, -25 and -26.
execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile,
  "-af", AUDIO_CEILING, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
  "-movflags", "+faststart", `${name}-CLEAN.mp4`], { stdio: "inherit", cwd: dir });
rmSync(segDir, { recursive: true, force: true });

// The ceilings above stop the master CLIPPING; they do nothing about its LEVEL.
// That gap was invisible while Joel's OBS gain stayed put — every master landed
// near -14 because every source did. On 2026-09-02 the source came in at -16.45
// LUFS and the master inherited it at -16.55, about 2.5 LU quiet. YouTube only
// turns loud content DOWN, so that episode would simply have played softer than
// the one before it, and the inconsistency between consecutive episodes is worse
// than either number on its own. build.mjs has solved exactly this for Shorts
// since PR #15; the master path just never got it.
levelToTarget(dir, `${name}-CLEAN.mp4`, { label: "master loudness" });
console.log(`✅ ${join(dir, `${name}-CLEAN.mp4`)}`);
