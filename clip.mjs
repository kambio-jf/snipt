// clip.mjs — chop / compose vertical Shorts from a source video with ffmpeg.
//
// Usage:  node clip.mjs config.json
//
// Two modes per clip (see config.json):
//   simple:  { name, start, end, vertical? }        -> straight cut (optionally center-crop 9:16)
//   split:   { name, layout:"split", pip, content, keep?, captions? }
//            pip/content = crop rects {x,y,w,h} in the source (1920x1080 assumed).
//            keep   = [[start,end], ...] segments to keep+concat (cuts the ramble). Omit = whole clip.
//            captions = [{ start, end, y, size, color, text, hook?, }] animated text events (ASS).
//
// Output: horizontal-source -> 1080x1920. Captions animate (pop + fade). No Opus needed.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const cfg = JSON.parse(readFileSync(process.argv[2] ?? "config.json", "utf8"));
mkdirSync(cfg.outDir, { recursive: true });

const toSec = (t) => String(t).split(":").reduce((a, v) => a * 60 + Number(v), 0);
const even = (n) => Math.round(n / 2) * 2;

// ASS colours are &HBBGGRR&
const COLORS = { white: "&HFFFFFF&", green: "&H55FF55&", red: "&H0000FF&", gold: "&H00D7FF&" };

for (const clip of cfg.clips) {
  (clip.layout === "split" ? renderSplit : renderSimple)(clip);
}

function renderSimple(c) {
  const dur = toSec(c.end) - toSec(c.start);
  const dest = path.join(cfg.outDir, `${c.name}.mp4`);
  const vf = c.vertical ? ["-vf", "crop=ih*9/16:ih,scale=1080:1920"] : [];
  const args = ["-y", "-ss", String(c.start), "-i", cfg.video, "-t", String(dur),
    ...vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-c:a", "aac", dest];
  console.log(`\n▶ ${c.name} (simple ${c.start}-${c.end})`);
  execFileSync("ffmpeg", args, { stdio: "inherit" });
}

function assTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${sec.toFixed(2).padStart(5, "0")}`;
}

function generateAss(events) {
  const head = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920",
    "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Cue,Arial,80,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,7,4,5,40,40,40,1",
    "", "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n") + "\n";

  const rows = events.map((e) => {
    const col = COLORS[e.color ?? "white"];
    const pop = e.hook
      ? "\\fscx78\\fscy78\\t(0,130,\\fscx104\\fscy104)\\t(130,210,\\fscx100\\fscy100)"
      : "\\fscx30\\fscy30\\t(0,170,\\fscx110\\fscy110)\\t(170,260,\\fscx100\\fscy100)";
    const fadeIn = e.hook ? 0 : 100;
    return `Dialogue: 0,${assTime(toSec(e.start))},${assTime(toSec(e.end))},Cue,,0,0,0,,` +
      `{\\pos(540,${e.y})\\fad(${fadeIn},180)${pop}\\fs${e.size}\\c${col}}${e.text}`;
  });
  return head + rows.join("\n") + "\n";
}

function renderSplit(c) {
  const pipH = even(c.pip.h * 1080 / c.pip.w);      // pip scaled to 1080 wide, aspect kept
  const contentH = 1920 - pipH;                     // remaining area for the screen content

  const f = [
    `[0:v]split=2[v0a][v0b]`,
    `[v0a]crop=${c.pip.w}:${c.pip.h}:${c.pip.x}:${c.pip.y},scale=1080:${pipH}[pip]`,
    `[v0b]crop=${c.content.w}:${c.content.h}:${c.content.x}:${c.content.y},` +
      `scale=1080:${contentH}:force_original_aspect_ratio=increase,crop=1080:${contentH}[content]`,
    `[pip][content]vstack=inputs=2,setpts=PTS-STARTPTS[comp]`,
  ];

  let vlab = "comp";
  let amap = "0:a";
  const keep = c.keep;
  if (keep && keep.length) {
    f.push(`[comp]split=${keep.length}${keep.map((_, i) => `[c${i}]`).join("")}`);
    keep.forEach((k, i) => f.push(`[c${i}]trim=${toSec(k[0])}:${toSec(k[1])},setpts=PTS-STARTPTS[kv${i}]`));
    f.push(`${keep.map((_, i) => `[kv${i}]`).join("")}concat=n=${keep.length}:v=1:a=0[vcat]`);
    f.push(`[0:a]asplit=${keep.length}${keep.map((_, i) => `[ac${i}]`).join("")}`);
    keep.forEach((k, i) => f.push(`[ac${i}]atrim=${toSec(k[0])}:${toSec(k[1])},asetpts=PTS-STARTPTS[ka${i}]`));
    f.push(`${keep.map((_, i) => `[ka${i}]`).join("")}concat=n=${keep.length}:v=0:a=1[aout]`);
    vlab = "vcat";
    amap = "[aout]";
  }

  if (c.captions && c.captions.length) {
    writeFileSync(path.join(cfg.outDir, `${c.name}.ass`), generateAss(c.captions));
    f.push(`[${vlab}]ass=${c.name}.ass[vout]`);
    vlab = "vout";
  }

  const dest = path.join(cfg.outDir, `${c.name}.mp4`);
  const args = ["-y", "-i", cfg.video, "-filter_complex", f.join(";"),
    "-map", `[${vlab}]`, "-map", amap,
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-c:a", "aac", "-b:a", "192k", dest];
  console.log(`\n▶ ${c.name} (split, pip ${pipH}px / content ${contentH}px${keep ? `, ${keep.length} kept segs` : ""}${c.captions ? `, ${c.captions.length} captions` : ""})`);
  execFileSync("ffmpeg", args, { stdio: "inherit", cwd: cfg.outDir }); // cwd so ass= path is relative
  console.log(`✅ ${dest}`);
}
