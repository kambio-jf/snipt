// mkass.mjs — build an ASS from a Whisper SRT (karaoke word-highlight) + describable cues.
// usage: node cli/mkass.mjs <srt> <cues.json> <out.ass>
//   cues.json = { "cues": [ { when, hold, at, hook?, lines:[ {size, parts:[{t,c}]} ] } ] }
//   "when" = anchor words (Whisper timeline) or "start". "at" = center|upper|lower|<y>.
import { readFileSync, writeFileSync } from "node:fs";
const [, , srtPath, cuesPath, outPath] = process.argv;

const COLORS = { white: "&HFFFFFF&", green: "&H55FF55&", red: "&H0000FF&", gold: "&H00D7FF&", yellow: "&H00FFFF&" };
const srtSec = (s) => { const [h, m, r] = s.replace(",", ".").split(":"); return +h * 3600 + +m * 60 + parseFloat(r); };
const t = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`; };
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);

// --- parse + clean SRT ---
let segs = readFileSync(srtPath, "utf8").split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean).map((b) => {
  const l = b.split(/\r?\n/), mm = (l[1] || "").match(/([\d:,.]+)\s*-->\s*([\d:,.]+)/);
  return mm ? { start: srtSec(mm[1]), end: srtSec(mm[2]), text: l.slice(2).join(" ").replace(/\s+/g, " ").trim() } : null;
}).filter((s) => s && s.text);
segs.sort((a, b) => a.start - b.start);
for (let i = 0; i < segs.length - 1; i++) if (segs[i].end > segs[i + 1].start) segs[i].end = segs[i + 1].start;
segs = segs.filter((s) => s.end - s.start > 0.12);

// --- word timeline (for "when" lookups) ---
const timeline = [];
for (const s of segs) { const w = norm(s.text), dur = (s.end - s.start) / Math.max(1, w.length); w.forEach((word, i) => timeline.push({ word, time: s.start + i * dur })); }
function when2time(anchor) {
  if (anchor === "start" || anchor == null) return 0;
  const aw = norm(anchor);
  for (let len = aw.length; len >= 1; len--) {
    const sub = aw.slice(0, len);
    for (let i = 0; i + sub.length <= timeline.length; i++) if (sub.every((w, j) => timeline[i + j].word === w)) return +timeline[i].time.toFixed(2);
  }
  return 0;
}

// --- karaoke rows ---
const KY = 1660, KSIZE = 66;
const karaoke = segs.map((s) => {
  const words = s.text.split(" "), durcs = Math.max(1, Math.round((s.end - s.start) * 100)), per = Math.max(1, Math.floor(durcs / words.length));
  const kt = words.map((w, i) => `{\\k${i === words.length - 1 ? durcs - per * (words.length - 1) : per}}${w} `).join("").trim();
  return `Dialogue: 0,${t(s.start)},${t(s.end)},Karaoke,,0,0,0,,{\\an5\\pos(540,${KY})}${kt}`;
});

// --- describable cues ---
const vAlign = (a) => a === "center" ? 960 : a === "upper" ? 620 : a === "lower" ? 1300 : Number(a);
const cueRows = [];
for (const cue of JSON.parse(readFileSync(cuesPath, "utf8")).cues) {
  const start = when2time(cue.when), end = start + (cue.hold ?? 4);
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

writeFileSync(outPath, head + [...karaoke, ...cueRows].join("\n") + "\n");
console.log(`✅ ${karaoke.length} karaoke + ${cueRows.length} cue lines -> ${outPath}`);
