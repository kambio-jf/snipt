// build.mjs — one-command KFTP Short renderer.
// Reads a day's shorts.json and, per short: (1) cuts in/out + interior `remove`
// snippets, (2) remaps Whisper-SRT karaoke + cue/pan anchors onto the cut
// timeline, (3) renders the split PiP+screen vertical layout with a keyframed
// pan and burned-in ASS captions.  Consolidates panshort.mjs + mkass.mjs.
//
// usage: node cli/build.mjs clips/2026-07-08/shorts.json [name]     (name = render one short)
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, basename, resolve } from "node:path";

const [, , jsonPath, only] = process.argv;
if (!jsonPath) { console.error("usage: node cli/build.mjs <shorts.json> [name]"); process.exit(1); }
const cfg = JSON.parse(readFileSync(jsonPath, "utf8"));

// ---- geometry (fixed OBS layout) ----
const FRAME_W = 1920, FRAME_H = 1080;
const WIN_W = cfg.layout?.window?.w ?? 640, WIN_H = cfg.layout?.window?.h ?? 790;
const PIP = cfg.layout?.pip ?? { x: 30, y: 858, w: 342, h: 188 };
const PIP_H = 594, CONTENT_H = 1326;               // 594 + 1326 = 1920
const MAXX = FRAME_W - WIN_W, MAXY = FRAME_H - WIN_H;
const clampX = (v) => Math.max(0, Math.min(MAXX, Math.round(v)));
const clampY = (v) => Math.max(0, Math.min(MAXY, Math.round(v)));
const D = 0.6;                                     // pan slide duration (s)

// ---- helpers ----
const COLORS = { white: "&HFFFFFF&", green: "&H55FF55&", red: "&H0000FF&", gold: "&H00D7FF&", yellow: "&H00FFFF&" };
const srtSec = (s) => { const [h, m, r] = s.replace(",", ".").split(":"); return +h * 3600 + +m * 60 + parseFloat(r); };
const t = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.max(0, sec % 60); return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`; };
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
const ffprobeDur = (f) => +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]).toString().trim();

function parseTime(v, dur) {
  if (v === "start" || v == null) return 0;
  if (v === "end") return dur;
  if (typeof v === "number") return v;
  const p = String(v).split(":").map(Number);
  return p.length === 2 ? p[0] * 60 + p[1] : p[0];
}

// keep = [in,out] minus every remove segment (or an explicit `keep` from cut.mjs)
function keepIntervals(short, dur) {
  if (short.keep) return short.keep.map(([s, e]) => [parseTime(s, dur), parseTime(e, dur)]).filter(([s, e]) => e - s > 0.01);
  const lo = parseTime(short.in ?? "start", dur), hi = parseTime(short.out ?? "end", dur);
  let keep = [[lo, hi]];
  for (const [ra, rb] of (short.remove ?? [])) {
    const a = parseTime(ra, dur), b = parseTime(rb, dur);
    keep = keep.flatMap(([s, e]) => {
      if (b <= s || a >= e) return [[s, e]];          // no overlap
      const out = [];
      if (a > s) out.push([s, a]);
      if (b < e) out.push([b, e]);
      return out;
    });
  }
  return keep.filter(([s, e]) => e - s > 0.05);
}

// map a raw-clip time onto the cut (post-remove) timeline
function makeRaw2Final(keep) {
  return (raw) => {
    let acc = 0;
    for (const [s, e] of keep) {
      if (raw < s) return acc;                        // inside a removed gap -> snap to next keep start
      if (raw <= e) return acc + (raw - s);
      acc += e - s;
    }
    return acc;                                       // past end
  };
}

function renderShort(short) {
  const srcRel = short.source;                        // relative to repo-root cwd
  const src = resolve(srcRel);
  const dir = dirname(src);                           // day folder (ffmpeg cwd for pass 2)
  const name = short.name;
  const dur = ffprobeDur(src);
  const keep = keepIntervals(short, dur);
  const raw2final = makeRaw2Final(keep);
  const cutDur = keep.reduce((a, [s, e]) => a + (e - s), 0);
  console.log(`\n▶ ${name}: keep ${JSON.stringify(keep.map(k => k.map(n => +n.toFixed(1))))} -> ${cutDur.toFixed(1)}s`);

  // ---------- pass 1: cut (trim + concat kept segments) ----------
  const cutFile = `${name}-cut.mp4`;
  const vt = keep.map(([s, e], i) => `[0:v]trim=${s}:${e},setpts=PTS-STARTPTS[v${i}]`).join(";");
  const at = keep.map(([s, e], i) => `[0:a]atrim=${s}:${e},asetpts=PTS-STARTPTS[a${i}]`).join(";");
  const vc = keep.map((_, i) => `[v${i}]`).join("") + `concat=n=${keep.length}:v=1:a=0[vout]`;
  const ac = keep.map((_, i) => `[a${i}]`).join("") + `concat=n=${keep.length}:v=0:a=1[aout]`;
  execFileSync("ffmpeg", ["-y", "-i", basename(src), "-filter_complex", `${vt};${at};${vc};${ac}`,
    "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k", cutFile], { stdio: "inherit", cwd: dir });

  // ---------- build ASS (karaoke remapped + describable cues) ----------
  const srt = resolve(short.srt);
  let segs = readFileSync(srt, "utf8").split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean).map((b) => {
    const l = b.split(/\r?\n/), mm = (l[1] || "").match(/([\d:,.]+)\s*-->\s*([\d:,.]+)/);
    return mm ? { start: srtSec(mm[1]), end: srtSec(mm[2]), text: l.slice(2).join(" ").replace(/\s+/g, " ").trim() } : null;
  }).filter((s) => s && s.text);

  // Attach each row's real per-word timings from words.json.
  //
  // transcribe.mjs builds the SRT by grouping words.json IN ORDER, so row k maps to
  // a contiguous slice — take it by index. Matching on the row's time window instead
  // does not work: base.en emits overlapping and near-zero-duration spans (a 10ms
  // "right" followed by a 1.8s "here." that the next word starts inside), so an
  // 8-token row can match 12 words and silently fall back to even interpolation —
  // which then misjudges words at a cut boundary by a whole word.
  // Done before the sort/filter below so dropped rows can't desync the cursor.
  const normOne = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wordsFile = short.words ? resolve(short.words) : srt.replace(/\.srt$/, ".words.json");
  let rawWords = [];
  try { rawWords = JSON.parse(readFileSync(wordsFile, "utf8")); } catch { /* interpolate instead */ }
  {
    let cursor = 0;
    for (const s of segs) {
      const toks = s.text.split(" ").filter(Boolean);
      const slice = rawWords.slice(cursor, cursor + toks.length);
      // sanity-check the head word so a proofread that changed the word count
      // degrades to interpolation instead of silently mistiming everything after it
      s.words = slice.length === toks.length && normOne(slice[0].text) === normOne(toks[0]) ? slice : null;
      cursor += toks.length;
    }
  }

  segs.sort((a, b) => a.start - b.start);
  for (let i = 0; i < segs.length - 1; i++) if (segs[i].end > segs[i + 1].start) segs[i].end = segs[i + 1].start;
  segs = segs.filter((s) => s.end - s.start > 0.12);

  // word timeline on the RAW clip (for anchor lookups)
  const timeline = [];
  for (const s of segs) { const w = norm(s.text), d = (s.end - s.start) / Math.max(1, w.length); w.forEach((word, i) => timeline.push({ word, time: s.start + i * d })); }
  const when2raw = (anchor) => {
    if (anchor === "start" || anchor == null) return 0;
    const aw = norm(anchor);
    for (let len = aw.length; len >= 1; len--) { const sub = aw.slice(0, len); for (let i = 0; i + sub.length <= timeline.length; i++) if (sub.every((w, j) => timeline[i + j].word === w)) return timeline[i].time; }
    return 0;
  };
  const when2final = (anchor) => +raw2final(when2raw(anchor)).toFixed(2);

  // Karaoke rows, remapped onto the cut timeline.
  // The SRT is transcribed from the RAW clip, so a row straddling a cut still
  // contains words that were cut — drop them, or the karaoke sings words the viewer
  // cannot hear. Uses the real per-word timings attached above.
  const KY = 1660, KSIZE = 66;
  const inKeep = (raw) => keep.some(([s, e]) => raw >= s && raw <= e);
  // A word belongs in the karaoke only if most of it survives the cut. Midpoint
  // alone leaves slivers: a word clipped to its last 20ms still "contains" its
  // midpoint on one side of the boundary and gets sung for a frame.
  // (Zero-duration words — base.en emits them — have no overlap to measure, so
  // fall back to the midpoint.)
  const audible = (ws, we) => {
    const dur = we - ws;
    if (dur <= 0) return inKeep(ws);
    let overlap = 0;
    for (const [s, e] of keep) overlap += Math.max(0, Math.min(we, e) - Math.max(ws, s));
    return overlap / dur > 0.5;
  };

  const karaoke = segs.flatMap((s) => {
    const toks = s.text.split(" ").filter(Boolean);
    if (!toks.length) return [];

    const timed = s.words
      ? toks.map((w, i) => ({ w, ws: s.words[i].start, we: s.words[i].end }))
      : toks.map((w, i) => {                                   // fallback: even split
          const per = (s.end - s.start) / toks.length;
          return { w, ws: s.start + i * per, we: s.start + (i + 1) * per };
        });

    const kept = timed
      .filter(({ ws, we }) => audible(ws, we))
      .map(({ w, ws, we }) => ({ w, fa: raw2final(ws), fb: raw2final(we) }));
    if (!kept.length) return [];                               // row fell inside a cut

    const a = kept[0].fa, b = kept[kept.length - 1].fb;
    if (b - a <= 0.12) return [];

    // \k is sequential: each word holds until the next one starts, so inter-word
    // gaps get absorbed by the word before them and the fill tracks real speech.
    const kt = kept
      .map(({ w, fa }, i) => {
        const next = i + 1 < kept.length ? kept[i + 1].fa : b;
        return `{\\k${Math.max(1, Math.round((next - fa) * 100))}}${w} `;
      })
      .join("").trim();
    return [`Dialogue: 0,${t(a)},${t(b)},Karaoke,,0,0,0,,{\\an5\\pos(540,${KY})}${kt}`];
  });

  // describable cues
  const vAlign = (a) => a === "center" ? 960 : a === "upper" ? 620 : a === "lower" ? 1300 : Number(a);
  const cueRows = [];
  for (const cue of (short.cues ?? [])) {
    const start = when2final(cue.when), end = start + (cue.hold ?? 4);
    const lh = cue.lines.map((l) => Math.round(l.size * 1.12));
    const total = lh.reduce((a, b) => a + b, 0), top = vAlign(cue.at ?? "center") - total / 2;
    const pop = cue.hook ? "\\fscx78\\fscy78\\t(0,130,\\fscx104\\fscy104)\\t(130,210,\\fscx100\\fscy100)" : "\\fscx30\\fscy30\\t(0,170,\\fscx110\\fscy110)\\t(170,260,\\fscx100\\fscy100)";
    cue.lines.forEach((l, i) => {
      const cy = Math.round(top + lh.slice(0, i).reduce((a, b) => a + b, 0) + lh[i] / 2);
      const text = l.parts.map((p) => `{\\c${COLORS[p.c ?? "white"]}}${p.t}`).join("");
      cueRows.push(`Dialogue: 0,${t(start)},${t(end)},Cue,,0,0,0,,{\\an5\\pos(540,${cy})\\fad(${cue.hook ? 0 : 100},180)${pop}\\fs${l.size}}${text}`);
    });
  }

  const head = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Cue,Arial,80,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,7,4,5,40,40,40,1",
    `Style: Karaoke,Arial,${KSIZE},&H0055FF55,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,5,3,5,40,40,40,1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n") + "\n";
  const assFile = `${name}.ass`;
  writeFileSync(resolve(dir, assFile), head + [...karaoke, ...cueRows].join("\n") + "\n");
  console.log(`   ${karaoke.length} karaoke + ${cueRows.length} cue lines`);

  // ---------- pan keyframes -> piecewise crop expr ----------
  const keys = (short.pan ?? [{ when: "start", x: MAXX / 2, y: MAXY / 2 }])
    .map((k) => ({ t: when2final(k.when), x: clampX(k.x), y: clampY(k.y) }))
    .sort((a, b) => a.t - b.t);
  const pw = (dim) => {
    let acc = String(keys[0][dim]);
    for (let i = 1; i < keys.length; i++) {
      const tB = keys[i].t, vB = keys[i][dim], vA = keys[i - 1][dim];
      const rs = +(tB - D).toFixed(3), dv = vB - vA;
      const ramp = `(${vA}+(${dv})*(t-${rs})/${D})`;
      acc = `if(gte(t\\,${tB})\\,${vB}\\,if(gte(t\\,${rs})\\,${ramp}\\,${acc}))`;
    }
    return acc;
  };
  console.log(`   pan keys: ${keys.map(k => `${k.t.toFixed(1)}s(${k.x},${k.y})`).join(" -> ")}`);

  // ---------- pass 2: split layout + pan + burn ASS ----------
  const outFile = `${name}-SHORT.mp4`;
  const filter =
    `[0:v]split=2[a][b];` +
    `[a]crop=${PIP.w}:${PIP.h}:${PIP.x}:${PIP.y},scale=1080:${PIP_H}[pip];` +
    `[b]crop=${WIN_W}:${WIN_H}:${pw("x")}:${pw("y")},scale=1080:${CONTENT_H}:force_original_aspect_ratio=increase,crop=1080:${CONTENT_H}[content];` +
    `[pip][content]vstack=inputs=2,ass=${assFile}[v]`;
  execFileSync("ffmpeg", ["-y", "-i", cutFile, "-filter_complex", filter,
    "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
    "-c:a", "aac", "-b:a", "192k", outFile], { stdio: "inherit", cwd: dir });
  console.log(`✅ ${resolve(dir, outFile)}`);
}

for (const short of cfg.shorts) {
  if (only && short.name !== only) continue;
  renderShort(short);
}
