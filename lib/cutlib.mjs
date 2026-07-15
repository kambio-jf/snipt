// cutlib.mjs — shared word-transcription + keep-span logic for the
// transcript-editor tools (transcribe.mjs, cut.mjs, clean.mjs).
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// repo root (one level up from lib/) — holds models/ and corrections.json
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PAD = 0.06;                                        // keep-span padding so word onsets aren't clipped
export const FILLERS = new Set(["um", "uh", "uhh", "umm", "mm", "mmm", "hmm", "er", "err", "ah", "eh"]);
export const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export const srtSec = (s) => { const [h, m, r] = s.replace(",", ".").split(":"); return +h * 3600 + +m * 60 + parseFloat(r); };
export const ffprobeDur = (f) => +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]).toString().trim();

// --- word-level Whisper ---------------------------------------------------
// The sync and async paths below share arg-building, SRT parsing, and correction
// loading, so there is exactly one definition of "how we transcribe".
// Paths stay RELATIVE to ROOT (cwd) — the whisper filter can't take a Windows
// absolute path without hitting the colon-escaping problem.

const whisperTmpSrt = (clip) => join(dirname(clip), `._words_${Date.now()}_${process.pid}.srt`);
const whisperArgs = (clip, tmp) => ["-y", "-hide_banner", "-i", clip, "-vn", "-af",
  `whisper=model=models/ggml-base.en.bin:language=en:format=srt:destination=${relative(ROOT, tmp).replace(/\\/g, "/")}:max_len=1:use_gpu=false`,
  "-f", "null", "-"];

// Windows reports negative exit codes unsigned (-2 -> 4294967294); show the real one.
const signedExit = (code) => (code > 0x7fffffff ? code - 0x100000000 : code);
// ffmpeg's failure reason is in its last lines; drop progress/config noise.
const ffmpegReason = (stderr) => stderr.split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !/^(configuration|lib\w+\s+\d|built with|\s*Stream|\s*Duration|frame=|size=)/.test(l))
  .slice(-2).join(" | ");

/** Rules from corrections.json, or [] when it's absent. */
export function loadFileCorrections() {
  const cf = join(ROOT, "corrections.json");
  return existsSync(cf) ? JSON.parse(readFileSync(cf, "utf8")).rules || [] : [];
}

/** Word-level SRT -> [{i,start,end,text}], standalone punctuation merged into the prior word. */
export function parseWordSrt(srtPath) {
  const blocks = readFileSync(srtPath, "utf8").split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean);
  const words = [];
  for (const b of blocks) {
    const l = b.split(/\r?\n/), mm = (l[1] || "").match(/([\d:,.]+)\s*-->\s*([\d:,.]+)/);
    if (!mm) continue;
    const text = l.slice(2).join(" ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const isPunct = !/[A-Za-z0-9]/.test(text);
    if (isPunct && words.length) { words[words.length - 1].text += text; words[words.length - 1].end = srtSec(mm[2]); continue; }
    if (isPunct) continue;
    words.push({ i: words.length, start: srtSec(mm[1]), end: srtSec(mm[2]), text });
  }
  words.forEach((w, i) => (w.i = i));
  return words;
}

/**
 * Run word-level Whisper (max_len=1) on a clip -> [{i,start,end,text}].
 * Blocks the event loop for the whole inference — fine for the CLI, never for a server.
 * `rules` overrides the corrections.json dictionary (pass [] to skip corrections).
 */
export function runWordWhisper(clip, { rules } = {}) {
  const tmp = whisperTmpSrt(clip);
  try {
    execFileSync("ffmpeg", whisperArgs(clip, tmp), { stdio: ["ignore", "ignore", "inherit"], cwd: ROOT });
    return applyCorrections(parseWordSrt(tmp), rules ?? loadFileCorrections());
  } finally {
    rmSync(tmp, { force: true });
  }
}

/**
 * Async word-level Whisper for the job worker: doesn't block the event loop, reports
 * progress, and can be aborted (job cancel kills the ffmpeg child).
 * `onProgress(pct)` is driven by ffmpeg's `time=` against `durationS` — coarse but honest.
 */
export function runWordWhisperAsync(clip, { rules, durationS, onProgress, signal } = {}) {
  const tmp = whisperTmpSrt(clip);
  // `done`/`fail` rather than resolve/reject — `resolve` is node:path's, imported above
  return new Promise((done, fail) => {
    const child = spawn("ffmpeg", whisperArgs(clip, tmp), { cwd: ROOT, windowsHide: true });
    let stderr = "";

    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stderr.on("data", (chunk) => {
      const s = chunk.toString();
      stderr = (stderr + s).slice(-4000); // keep only the tail for error reporting
      if (!onProgress || !durationS) return;
      // ffmpeg emits many time= updates; take the last in this chunk
      const times = [...s.matchAll(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g)];
      const last = times[times.length - 1];
      if (!last) return;
      const t = +last[1] * 3600 + +last[2] * 60 + parseFloat(last[3]);
      onProgress(Math.max(0, Math.min(99, Math.round((t / durationS) * 100))));
    });

    child.on("error", (err) => { signal?.removeEventListener("abort", onAbort); rmSync(tmp, { force: true }); fail(err); });
    child.on("close", (code, sig) => {
      signal?.removeEventListener("abort", onAbort);
      try {
        if (signal?.aborted) throw new Error("aborted");
        if (code !== 0) throw new Error(`ffmpeg exited ${signedExit(code)}${sig ? ` (${sig})` : ""}: ${ffmpegReason(stderr)}`);
        done(applyCorrections(parseWordSrt(tmp), rules ?? loadFileCorrections()));
      } catch (err) {
        fail(err);
      } finally {
        rmSync(tmp, { force: true });
      }
    });
  });
}

// apply a domain correction dictionary to a word array — matches consecutive words
// (case/punctuation-insensitive) against each rule's `from` and replaces the run with
// one word carrying `to` (spanning the matched timestamps). Longest rules win.
export function applyCorrections(words, rules) {
  const nmphrase = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const R = rules.map((r) => ({ toks: nmphrase(r.from), to: r.to })).filter((r) => r.toks.length).sort((a, b) => b.toks.length - a.toks.length);
  const out = [];
  for (let i = 0; i < words.length;) {
    let hit = null;
    for (const r of R) {
      if (i + r.toks.length > words.length) continue;
      let ok = true;
      for (let j = 0; j < r.toks.length; j++) { if ((nmphrase(words[i + j].text)[0] || "") !== r.toks[j]) { ok = false; break; } }
      if (ok) { hit = r; break; }
    }
    if (hit) { const s = words.slice(i, i + hit.toks.length); out.push({ start: s[0].start, end: s[s.length - 1].end, text: hit.to }); i += hit.toks.length; }
    else out.push(words[i++]);
  }
  out.forEach((w, idx) => (w.i = idx));
  return out;
}

// LCS-align edited text to the original words, then build keep-spans.
// Cuts snap to gap midpoints (+PAD); `tighten` (ms) collapses pauses between
// kept words longer than that; `defiller` also drops bare um/uh words.
export function computeKeep({ words, editedText, dur, tighten = 0, defiller = false }) {
  const orig = words.map((w) => norm(w.text));
  const edit = editedText.split(/\s+/).map(norm).filter(Boolean);
  const n = orig.length, m = edit.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = orig[i] === edit[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const matched = new Set();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (orig[i] === edit[j]) { matched.add(i); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  let kept = words.filter((w) => matched.has(w.i));
  if (defiller) kept = kept.filter((w) => !FILLERS.has(norm(w.text)));
  if (!kept.length) return { keep: [], matched: 0, kept: 0 };

  const T = tighten / 1000, round = (x) => +x.toFixed(3);
  const spans = [];
  let openStart = Math.max(0, kept[0].start - PAD);
  for (let k = 1; k < kept.length; k++) {
    const p = kept[k - 1], c = kept[k];
    const deleteCut = c.i !== p.i + 1;
    const gap = c.start - p.end;
    const tightenCut = !deleteCut && T > 0 && gap > T;
    if (!deleteCut && !tightenCut) continue;
    const endTime = deleteCut ? Math.min(p.end + PAD, (p.end + words[p.i + 1].start) / 2) : p.end + T / 2;
    spans.push([openStart, endTime]);
    openStart = deleteCut ? Math.max(c.start - PAD, (words[c.i - 1].end + c.start) / 2) : c.start - T / 2;
  }
  spans.push([openStart, Math.min(dur, kept[kept.length - 1].end + PAD)]);

  const merged = [];
  for (const [s, e] of spans) {
    if (e - s < 0.02) continue;
    if (merged.length && s <= merged[merged.length - 1][1] + 0.001) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    else merged.push([s, e]);
  }
  return { keep: merged.map(([s, e]) => [round(s), round(e)]), matched: matched.size, kept: kept.length, keptWords: kept };
}

// map a raw-clip time onto the cut (post-remove) timeline, given keep-spans
export function raw2final(keep) {
  return (raw) => {
    let acc = 0;
    for (const [s, e] of keep) {
      if (raw < s) return acc;
      if (raw <= e) return acc + (raw - s);
      acc += e - s;
    }
    return acc;
  };
}

// word-level timeline from a (proofread) SRT — each word interpolated within its segment
export function srtWordTimeline(srtPath) {
  const segs = readFileSync(srtPath, "utf8").split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean).map((b) => {
    const l = b.split(/\r?\n/), mm = (l[1] || "").match(/([\d:,.]+)\s*-->\s*([\d:,.]+)/);
    return mm ? { start: srtSec(mm[1]), end: srtSec(mm[2]), text: l.slice(2).join(" ").trim() } : null;
  }).filter((s) => s && s.text);
  const tl = [];
  for (const s of segs) { const w = s.text.split(/\s+/).filter(Boolean); const d = (s.end - s.start) / Math.max(1, w.length); w.forEach((word, i) => tl.push({ text: word, start: s.start + i * d })); }
  return tl;
}

// resolve an anchor phrase (spoken words, or "start") to its time in a words.json
export function anchorTime(words, anchor) {
  if (!anchor || anchor === "start") return 0;
  const nm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const aw = nm(anchor);
  const toks = words.map((w) => nm(w.text)[0] || "");
  for (let len = aw.length; len >= 1; len--) {
    const sub = aw.slice(0, len);
    for (let i = 0; i + sub.length <= toks.length; i++)
      if (sub.every((x, j) => toks[i + j] === x)) return +words[i].start.toFixed(2);
  }
  return 0;
}

// subtract time ranges (e.g. manual redactions) from a set of keep-spans
export function subtractRanges(spans, cuts) {
  let out = spans.map((s) => [...s]);
  for (const [a, b] of cuts) {
    out = out.flatMap(([s, e]) => {
      if (b <= s || a >= e) return [[s, e]];
      const r = [];
      if (a > s) r.push([s, a]);
      if (b < e) r.push([b, e]);
      return r;
    });
  }
  return out.filter(([s, e]) => e - s > 0.02);
}

// single-pass select/aselect filter for keep-spans — decodes the source once and
// keeps only the wanted frames (scales to hundreds of cuts; trim+concat does not).
export function cutFilter(keep) {
  const ranges = keep.map(([s, e]) => `between(t,${s},${e})`).join("+");
  return `[0:v]select='${ranges}',setpts=N/FRAME_RATE/TB[vout];[0:a]aselect='${ranges}',asetpts=N/SR/TB[aout]`;
}
