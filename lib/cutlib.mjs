// cutlib.mjs — shared word-transcription + keep-span logic for the
// transcript-editor tools (transcribe.mjs, cut.mjs, clean.mjs).
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
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

// Model: small.en by default. base.en decodes non-speech (a swallow, a lip smack)
// into plausible-looking words — on 2026-07-30 it invented the phrase "350, 450"
// inside a silent gap, which then reached the cut list AND the karaoke. small.en
// leaves that gap empty. Costs ~1.7x the time (1.1x realtime vs 1.8x); the daily
// master transcribes in the background, so accuracy wins. Override for a one-off:
//   WHISPER_MODEL=ggml-base.en.bin node cli/transcribe.mjs …
export const WHISPER_MODEL = process.env.WHISPER_MODEL || "ggml-small.en.bin";

// queue = how many seconds of audio the filter buffers before handing a chunk to
// whisper. It MUST be 30: whisper decodes in 30s windows, so a smaller queue
// splits that window at an arbitrary boundary and the decode changes run to run.
// Measured on one 50s clip: queue=3 gave 170 / 156 / 179 words across three runs;
// queue=30 gave 185 / 185. A non-reproducible transcript silently corrupts cut
// points, karaoke text and chapter timestamps, so determinism is the whole point.
const WHISPER_QUEUE = 30;

const whisperTmpSrt = (clip, tag = "words") => join(dirname(clip), `._${tag}_${Date.now()}_${process.pid}.srt`);
// max_len=1 gives one SRT cue per token — that's what yields per-word timings, but
// whisper's tokenizer emits SUB-WORD tokens, so it also splits real words
// ("accommod"+"ated", "Schw"+"ab"). Omitting max_len yields whole words in phrase
// cues. We run both and reconcile — see alignTokensToWords.
const whisperArgs = (clip, tmp, { maxLen = 1 } = {}) => ["-y", "-hide_banner", "-i", clip, "-vn", "-af",
  `whisper=model=models/${WHISPER_MODEL}:language=en:format=srt:destination=${relative(ROOT, tmp).replace(/\\/g, "/")}${maxLen ? `:max_len=${maxLen}` : ""}:use_gpu=false:queue=${WHISPER_QUEUE}`,
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

/** Phrases from fillers.json, or [] when it's absent. */
export function loadFileFillers() {
  const ff = join(ROOT, "fillers.json");
  return existsSync(ff) ? JSON.parse(readFileSync(ff, "utf8")).phrases || [] : [];
}

/**
 * Remove filler phrases from a script, word-aware: a phrase matches whole words
 * regardless of punctuation or case, so "you know" catches "You know," and
 * "you know." with one entry. Longest phrase wins ("you know what i mean" beats
 * "you know"), so an entry can't strand a fragment of a longer one.
 *
 * Operates on the script text (what the user edits, what computeKeep LCS-diffs)
 * and only ever DELETES tokens — the alignment to words.json is preserved.
 */
export function removeFillerPhrases(text, phrases) {
  const toks = text.split(/\s+/).filter(Boolean);
  const normed = toks.map(norm);
  const pats = phrases
    .map((p) => ({ phrase: p, toks: p.toLowerCase().split(/\s+/).map(norm).filter(Boolean) }))
    .filter((p) => p.toks.length)
    .sort((a, b) => b.toks.length - a.toks.length); // longest wins

  const counts = new Map();
  const kept = [];
  let removed = 0;

  for (let i = 0; i < toks.length; ) {
    // a filler token can be empty after norm (e.g. bare punctuation) — never match those
    const hit = normed[i]
      ? pats.find((p) => p.toks.every((t, j) => normed[i + j] === t))
      : undefined;
    if (hit) {
      counts.set(hit.phrase, (counts.get(hit.phrase) ?? 0) + 1);
      removed += hit.toks.length;
      i += hit.toks.length;
    } else {
      kept.push(toks[i]);
      i++;
    }
  }

  return { text: kept.join(" "), counts, removed, kept: kept.length, total: toks.length };
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

/** Whole words from a phrase-level SRT (no max_len) — the ground-truth spelling. */
export function parsePhraseSrtWords(srtPath) {
  return readFileSync(srtPath, "utf8")
    .split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean)
    .flatMap((b) => {
      const l = b.split(/\r?\n/);
      return /-->/.test(l[1] || "") ? l.slice(2).join(" ").trim().split(/\s+/) : [];
    })
    .filter(Boolean);
}

const alnum = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Reconcile the two Whisper passes: `tokens` carry the timings (max_len=1, but
 * sub-word split), `words` carry the correct spelling (no max_len, no timings we
 * can use). Walk both in order, consuming tokens until their concatenation equals
 * the next true word, and emit ONE word spanning first.start -> last.end.
 *
 * Deterministic and exact — no wordlist, no heuristics. It fixes splits Whisper
 * itself never made ("accommod"+"ated" -> "accommodated", "Schw"+"ab" -> "Schwab",
 * "re"+"-"+"authent"+"icating" -> "re-authenticating").
 *
 * Both passes decode the same audio with the same model, so they agree in practice.
 * If they ever diverge, we bail and return the tokens untouched — a slightly split
 * transcript is recoverable, a mis-aligned one silently corrupts every timing
 * downstream (keep-spans, karaoke, cue anchors).
 */
export function alignTokensToWords(tokens, words) {
  const out = [];
  let i = 0;
  for (const w of words) {
    const want = alnum(w);
    if (!want) continue;                       // punctuation-only: parseWordSrt already folded it in
    const parts = [];
    let acc = "";
    while (i < tokens.length && acc.length < want.length) { acc += alnum(tokens[i].text); parts.push(tokens[i]); i++; }
    if (acc !== want || !parts.length) return { words: tokens, merged: 0, aligned: false };
    out.push(parts.length === 1 ? parts[0] : { ...parts[0], text: w, end: parts[parts.length - 1].end });
  }
  if (i !== tokens.length) return { words: tokens, merged: 0, aligned: false };
  out.forEach((w, n) => (w.i = n));
  return { words: out, merged: tokens.length - out.length, aligned: true };
}

/**
 * Run word-level Whisper on a clip -> [{i,start,end,text}].
 *
 * Two concurrent passes: one with max_len=1 for per-token timings, one without for
 * correct word spelling. They run in parallel so wall-clock stays close to a single
 * pass. Pass `detokenize:false` to skip the second pass (faster, sub-word splits kept).
 *
 * Blocks the event loop for the whole inference — fine for the CLI, never for a server.
 * `rules` overrides the corrections.json dictionary (pass [] to skip corrections).
 */
const runFfmpeg = (args, showStderr) => new Promise((res, rej) => {
  const k = spawn("ffmpeg", args, { cwd: ROOT, stdio: ["ignore", "ignore", showStderr ? "inherit" : "ignore"], windowsHide: true });
  k.on("error", rej);
  k.on("close", (code) => res(code));
});

/** Fold the phrase pass into the token pass, warning (never throwing) if it can't. */
function detokenizePass(tokens, phraseSrt, code) {
  if (code !== 0) { console.warn("   ⚠ phrase pass failed — keeping sub-word splits"); return tokens; }
  const { words, merged, aligned } = alignTokensToWords(tokens, parsePhraseSrtWords(phraseSrt));
  if (!aligned) console.warn("   ⚠ the two Whisper passes disagreed — keeping sub-word splits (timings stay correct)");
  else if (merged) console.log(`   de-tokenized ${merged} sub-word split(s)`);
  return words;
}

export async function runWordWhisper(clip, { rules, detokenize = true } = {}) {
  const tmpTok = whisperTmpSrt(clip, "words");
  const tmpPhr = whisperTmpSrt(clip, "phrase");
  try {
    // Both passes at once. They decode the same audio with the same model, so this
    // costs CPU contention rather than a second full pass of wall-clock.
    const [cTok, cPhr] = await Promise.all([
      runFfmpeg(whisperArgs(clip, tmpTok), true),
      detokenize ? runFfmpeg(whisperArgs(clip, tmpPhr, { maxLen: 0 }), false) : Promise.resolve(0),
    ]);
    if (cTok !== 0) throw new Error(`ffmpeg (token pass) exited ${signedExit(cTok)}`);
    const tokens = dropNonSpeechMarkers(parseWordSrt(tmpTok));
    const words = detokenize ? detokenizePass(tokens, tmpPhr, cPhr) : tokens;
    return applyCorrections(words, rules ?? loadFileCorrections());
  } finally {
    rmSync(tmpTok, { force: true });
    rmSync(tmpPhr, { force: true });
  }
}

/**
 * Async word-level Whisper for the job worker: doesn't block the event loop, reports
 * progress, and can be aborted (job cancel kills the ffmpeg child).
 * `onProgress(pct)` is driven by ffmpeg's `time=` against `durationS` — coarse but honest.
 */
export function runWordWhisperAsync(clip, { rules, durationS, onProgress, signal, detokenize = true } = {}) {
  const tmp = whisperTmpSrt(clip, "words");
  const tmpPhr = whisperTmpSrt(clip, "phrase");
  // `done`/`fail` rather than resolve/reject — `resolve` is node:path's, imported above
  return new Promise((done, fail) => {
    const child = spawn("ffmpeg", whisperArgs(clip, tmp), { cwd: ROOT, windowsHide: true });
    // concurrent phrase pass for de-tokenization; progress is driven off the token
    // pass only, and a failure here degrades to sub-word splits rather than failing the job
    const phrase = detokenize ? spawn("ffmpeg", whisperArgs(clip, tmpPhr, { maxLen: 0 }), { cwd: ROOT, stdio: "ignore", windowsHide: true }) : null;
    const phraseCode = phrase ? new Promise((r) => { phrase.on("close", r); phrase.on("error", () => r(1)); }) : Promise.resolve(0);
    let stderr = "";

    const onAbort = () => { child.kill("SIGKILL"); phrase?.kill("SIGKILL"); };
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

    const cleanup = () => { rmSync(tmp, { force: true }); rmSync(tmpPhr, { force: true }); };
    child.on("error", (err) => { signal?.removeEventListener("abort", onAbort); phrase?.kill("SIGKILL"); cleanup(); fail(err); });
    child.on("close", async (code, sig) => {
      signal?.removeEventListener("abort", onAbort);
      try {
        if (signal?.aborted) throw new Error("aborted");
        if (code !== 0) throw new Error(`ffmpeg exited ${signedExit(code)}${sig ? ` (${sig})` : ""}: ${ffmpegReason(stderr)}`);
        const tokens = dropNonSpeechMarkers(parseWordSrt(tmp));
        const words = detokenize ? detokenizePass(tokens, tmpPhr, await phraseCode) : tokens;
        done(applyCorrections(words, rules ?? loadFileCorrections()));
      } catch (err) {
        phrase?.kill("SIGKILL");
        fail(err);
      } finally {
        cleanup();
      }
    });
  });
}

// --- measured silence ------------------------------------------------------
// Whisper's word timings are an ESTIMATE. They drift (observed ~0.5-1.0s late on a
// 50s clip) and it will decode non-speech — a swallow, a lip smack — into words that
// sit in an otherwise silent gap. So a cut placed purely from word timings can land
// mid-word or right on a mouth click. The audio itself doesn't lie: measure where the
// silence actually is and put the cuts there.
//
// Split deliberately into an IMPURE detector (spawns ffmpeg) and PURE transforms, so
// the API can persist a clip's pauses once and re-snap on every edit without shelling
// out again.

const SILENCE_DB = -42;      // below this counts as silence; voiced speech sits well above
const SILENCE_MIN_S = 0.08;  // shorter dips are within-word, not a gap you can cut on

const silenceArgs = (clip, noiseDb, minS) =>
  ["-hide_banner", "-v", "info", "-i", clip, "-vn",
    "-af", `silencedetect=noise=${noiseDb}dB:d=${minS}`, "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"];

/** Pair ffmpeg's silence_start/silence_end lines into spans. */
function parseSilence(stderr) {
  const out = [];
  for (const m of stderr.matchAll(/silence_end:\s*([\d.]+)[^\n]*?silence_duration:\s*([\d.]+)/g)) {
    const end = parseFloat(m[1]), dur = parseFloat(m[2]);
    if (Number.isFinite(end) && Number.isFinite(dur)) out.push([+(end - dur).toFixed(3), +end.toFixed(3)]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Measured silences in a clip, as [start,end] spans. Blocks — CLI only. */
export function detectPauses(clip, { noiseDb = SILENCE_DB, minS = SILENCE_MIN_S } = {}) {
  // silencedetect logs to STDERR, so this needs spawnSync — execFileSync only hands
  // back stdout, which is empty here (the -f null output is discarded).
  const res = spawnSync("ffmpeg", silenceArgs(clip, noiseDb, minS), { encoding: "utf8", cwd: ROOT, windowsHide: true });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`ffmpeg exited ${signedExit(res.status)}: ${ffmpegReason(res.stderr ?? "")}`);
  return parseSilence(res.stderr ?? "");
}

/** Async detectPauses for the job worker — non-blocking, abortable. */
export function detectPausesAsync(clip, { noiseDb = SILENCE_DB, minS = SILENCE_MIN_S, signal } = {}) {
  return new Promise((done, fail) => {
    const child = spawn("ffmpeg", silenceArgs(clip, noiseDb, minS), { cwd: ROOT, windowsHide: true });
    let stderr = "";
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("error", (err) => { signal?.removeEventListener("abort", onAbort); fail(err); });
    child.on("close", (code, sig) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return fail(new Error("aborted"));
      if (code !== 0) return fail(new Error(`ffmpeg exited ${signedExit(code)}${sig ? ` (${sig})` : ""}: ${ffmpegReason(stderr)}`));
      done(parseSilence(stderr));
    });
  });
}

/**
 * Drop words whose whole span sits inside a measured silence — they are Whisper
 * decoding non-speech (this is what turned a swallow into the phrase "350, 450").
 * PURE. Re-indexes, since `i` is an ordinal every downstream consumer relies on.
 */
/**
 * Whisper's non-speech annotations, as they actually survive the max_len=1 pass.
 * Two shapes, because the model treats them differently:
 *
 *  1. Parenthesised sound events KEEP their delimiters and may fuse onto a real
 *     word: `that.(` `(keyboard` `clicking)` `(inhales)` `clicking)(`.
 *  2. Bracketed markers LOSE their brackets and arrive as bare sub-word runs:
 *     `[BLANK_AUDIO]` -> `BL ANK AUD IO`, `[INAUDIBLE]` -> `INA UD IBLE`.
 *
 * Shape 2 cannot be recognised by punctuation, so it needs the known-sequence
 * list below. Both are the same class of problem: build.mjs burns SRT text
 * verbatim into the karaoke, so a Short spanning one renders `(inhales)` or
 * `BL ANK AUD IO` across a published video.
 */
const MARKER_SEQUENCES = [
  ["bl", "ank", "aud", "io"],
  ["ina", "ud", "ible"],
  ["blank", "audio"],
  ["inaudible"],
  // 2026-08-26: "[clears throat" — an opening bracket with NO closing one, so the
  // delimiter pass above cannot pair it. Matched here instead, where the key()
  // normaliser strips the bracket. Note this is why bracket markers go in THIS
  // list rather than being handled generically: a first attempt at generic
  // "[...]" support with a bounded scan mis-handled the reopening token
  // "clicking)(" and ate 667 tokens — roughly four minutes of audio — off the
  // end of the 2026-08-21 episode. Add the sequence; do not widen the scanner.
  ["clears", "throat"],
  // 2026-08-27, two more shapes the delimiter pass cannot reach:
  //   "key" "board" "clicking)" — a CLOSING paren with no opening token anywhere,
  //     so marker mode never engages and only the last token carries a delimiter.
  //   "S" "OUND" — [SOUND] with the brackets stripped, like [BLANK_AUDIO].
  ["key", "board", "clicking"],
  ["s", "ound"],
  ["sound"],
];

/**
 * Drop Whisper's non-speech annotations from a word array. PURE; re-indexes `i`.
 *
 * A paren fused onto a real word keeps the real half: `that.(` -> `that.`, and
 * `clicking)(` both closes and re-opens. An unclosed `(` drops to the end of the
 * array rather than silently keeping the rest of a marker.
 */
export function dropNonSpeechMarkers(words) {
  const out = [];
  let open = false;
  for (const w of words) {
    let text = w.text;
    if (open) {
      const close = text.lastIndexOf(")");
      if (close === -1) continue;                    // still inside the marker
      text = text.slice(close + 1);
      open = false;
      if (!/[a-z0-9]/i.test(text)) continue;         // nothing but the delimiter
    }
    const openAt = text.indexOf("(");
    if (openAt !== -1) {
      const before = text.slice(0, openAt);
      const rest = text.slice(openAt);
      // a marker that opens and closes inside one token, e.g. "(inhales)"
      const close = rest.lastIndexOf(")");
      const after = close === -1 ? "" : rest.slice(close + 1);
      open = close === -1;
      text = before + after;
      if (!/[a-z0-9]/i.test(text)) continue;
    }
    out.push({ ...w, text });
  }
  // shape 2: known bare sequences, matched case-insensitively on alphanumerics
  const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const kept = [];
  for (let i = 0; i < out.length;) {
    const seq = MARKER_SEQUENCES.find((s) => s.every((tok, j) => out[i + j] && key(out[i + j].text) === tok));
    if (seq) { i += seq.length; continue; }
    kept.push(out[i++]);
  }
  kept.forEach((w, i) => (w.i = i));
  return kept;
}

export function dropPhantomWords(words, pauses) {
  if (!pauses?.length) return words;
  const inside = (w) => pauses.some(([s, e]) => w.start >= s && w.end <= e && w.end > w.start);
  const kept = words.filter((w) => !inside(w));
  return kept.length === words.length ? words : kept.map((w, i) => ({ ...w, i }));
}

/**
 * Move keep-span boundaries onto measured silence. A span should OPEN just before
 * speech starts and CLOSE just after it stops; snapping there is what stops cuts
 * landing mid-word or on a mouth click.
 *
 * Only boundaries already within `windowS` of a pause move — a boundary with no
 * nearby silence is left alone and reported in `unsnapped`, which is a useful smell:
 * it means the transcript put a word where the audio has none.
 * PURE — feed it pauses from detectPauses (or a cached copy).
 */
export function snapSpansToPauses(keep, pauses, { windowS = 0.4, marginS = 0.03 } = {}) {
  if (!keep?.length || !pauses?.length) return { keep: keep ?? [], snapped: 0, unsnapped: [] };
  const round = (x) => +x.toFixed(3);
  let snapped = 0;
  const unsnapped = [];

  // opening edge -> just before speech resumes (pause end); closing edge -> just
  // after speech stops (pause start)
  const nearest = (t, edge) => {
    let best = null, bestD = Infinity;
    for (const [ps, pe] of pauses) {
      const target = edge === "start" ? pe - marginS : ps + marginS;
      const d = Math.abs(target - t);
      if (d < bestD) { bestD = d; best = target; }
    }
    return bestD <= windowS ? round(best) : null;
  };

  const out = keep.map(([s, e], idx) => {
    const ns = nearest(s, "start"), ne = nearest(e, "end");
    if (ns !== null && ns !== s) snapped++; else if (ns === null) unsnapped.push({ span: idx, edge: "start", t: s });
    if (ne !== null && ne !== e) snapped++; else if (ne === null) unsnapped.push({ span: idx, edge: "end", t: e });
    return [ns ?? s, ne ?? e];
  });

  // snapping can invert or overlap a short span; drop the degenerate ones and merge
  const fixed = [];
  for (const [s, e] of out) {
    if (e - s < 0.02) continue;
    if (fixed.length && s <= fixed[fixed.length - 1][1] + 0.001) fixed[fixed.length - 1][1] = Math.max(fixed[fixed.length - 1][1], e);
    else fixed.push([s, e]);
  }
  return { keep: fixed, snapped, unsnapped };
}

// apply a domain correction dictionary to a word array — matches consecutive words
// (case/punctuation-insensitive) against each rule's `from` and replaces the run with
// one word carrying `to` (spanning the matched timestamps). Longest rules win.
export function applyCorrections(words, rules) {
  // A RULE phrase splits on punctuation — "roll out and away" must become four
  // tokens to match four words. A SOURCE word must not: it is one word however
  // much punctuation it contains.
  //
  // These used to share one function, which compared only element [0] of the
  // split. So "J.O." became ["j","o"] and matched as "j", "P&L" matched as "p",
  // "don't" as "don" — and the rest was silently discarded. A rule written the
  // obvious way against any of those did nothing at all, with no error.
  const nmphrase = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const nmword = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const R = rules.map((r) => ({ toks: nmphrase(r.from), to: r.to })).filter((r) => r.toks.length).sort((a, b) => b.toks.length - a.toks.length);
  const out = [];
  for (let i = 0; i < words.length;) {
    let hit = null;
    for (const r of R) {
      if (i + r.toks.length > words.length) continue;
      let ok = true;
      for (let j = 0; j < r.toks.length; j++) { if (nmword(words[i + j].text) !== r.toks[j]) { ok = false; break; } }
      if (ok) { hit = r; break; }
    }
    if (hit) {
      // A multi-word `to` MUST emit one word per output token. Collapsing it to a
      // single token whose text contains spaces looks harmless — script.txt joins
      // on " " either way — but computeKeep LCS-diffs the edited script (split on
      // whitespace, N tokens) against words.json (1 token). They never match, the
      // word is dropped from keptWords, and its AUDIO is cut from the master.
      // "Kambio for the People" was silently cut out of the show open on
      // 2026-08-19, -20 and -25 for exactly this reason, and I spent weeks
      // blaming Whisper for dropping it.
      const s = words.slice(i, i + hit.toks.length);
      const start = s[0].start, end = s[s.length - 1].end;
      const parts = String(hit.to).split(/\s+/).filter(Boolean);
      if (parts.length <= 1) out.push({ start, end, text: hit.to });
      else {
        const step = (end - start) / parts.length;               // even split; total span preserved
        parts.forEach((p, k) => out.push({ start: start + k * step, end: start + (k + 1) * step, text: p }));
      }
      i += hit.toks.length;
    }
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
