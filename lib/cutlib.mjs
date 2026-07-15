// cutlib.mjs — shared word-transcription + keep-span logic for the
// transcript-editor tools (transcribe.mjs, cut.mjs, clean.mjs).
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// repo root (one level up from lib/) — holds models/ and corrections.json
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PAD = 0.06;                                        // keep-span padding so word onsets aren't clipped
export const FILLERS = new Set(["um", "uh", "uhh", "umm", "mm", "mmm", "hmm", "er", "err", "ah", "eh"]);
export const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export const srtSec = (s) => { const [h, m, r] = s.replace(",", ".").split(":"); return +h * 3600 + +m * 60 + parseFloat(r); };
export const ffprobeDur = (f) => +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]).toString().trim();

// run word-level Whisper (max_len=1) on a clip, return [{i,start,end,text}]
// (standalone punctuation merged into the prior word).
export function runWordWhisper(clip) {
  const tmp = join(dirname(clip), `._words_${Date.now()}.srt`);
  const destRel = relative(ROOT, tmp).replace(/\\/g, "/");
  execFileSync("ffmpeg", ["-y", "-i", clip, "-vn", "-af",
    `whisper=model=models/ggml-base.en.bin:language=en:format=srt:destination=${destRel}:max_len=1:use_gpu=false`,
    "-f", "null", "-"], { stdio: ["ignore", "ignore", "inherit"], cwd: ROOT });
  const blocks = readFileSync(tmp, "utf8").split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean);
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
  rmSync(tmp, { force: true });
  const cf = join(ROOT, "corrections.json");
  return existsSync(cf) ? applyCorrections(words, JSON.parse(readFileSync(cf, "utf8")).rules || []) : words;
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
